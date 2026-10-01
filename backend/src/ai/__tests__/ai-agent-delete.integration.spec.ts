import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AGENT_AUTONOMY_POLICY_SOURCE } from '../control-plane/agent/ai-agent-autonomy';
import { AiAgentWorkQueueService } from '../control-plane/agent/ai-agent-work-queue.service';
import { AiAgentControlService } from '../control-plane/agent-control/ai-agent-control.service';

async function seedTenant(runner: QueryRunner, tenantId: string, slug: string, name: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, name],
  );
}

async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

function controlContext(runner: QueryRunner, tenantId: string) {
  return {
    tenantId,
    userId: 'user-1',
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    manager: runner.manager,
  };
}

function controlService() {
  return new AiAgentControlService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    new AiAgentWorkQueueService(),
  );
}

async function insertDefinition(runner: QueryRunner, id: string, tenantId: string, agentKey: string) {
  await runner.query(
    `INSERT INTO ai_agent_definitions (
       id, tenant_id, agent_key, name, agent_type, status, environment,
       max_autonomy_level, default_approval_requirement
     )
     VALUES ($1, $2, $3, 'Delete integration agent', 'helpdesk', 'enabled', 'sandbox', 'A3', 'human_for_writes')`,
    [id, tenantId, agentKey],
  );
}

async function insertWorkItem(
  runner: QueryRunner,
  input: { id: string; tenantId: string; definitionId: string; triggerId?: string | null; dedupKey: string; status?: string },
) {
  await runner.query(
    `INSERT INTO ai_agent_work_items (
       id, tenant_id, agent_definition_id, trigger_id, source_provider_kind, source_provider_key,
       source_object_type, source_object_ref, work_kind, status, dedup_key
     )
     VALUES ($1, $2, $3, $4, 'ticketing', 'mock', 'ticket', 'FRO-2213', 'ticket_triage', $6, $5)`,
    [input.id, input.tenantId, input.definitionId, input.triggerId ?? null, input.dedupKey, input.status ?? 'completed'],
  );
}

// Proposals link their agent through metadata only (no FK), exactly like the
// runtime does — so they outlive the agent.
async function insertActionRequest(
  runner: QueryRunner,
  input: {
    id: string;
    tenantId: string;
    definitionId: string;
    status: string;
    errorMessage?: string | null;
    acknowledged?: boolean;
  },
) {
  const metadata: Record<string, unknown> = { agent_definition_id: input.definitionId };
  if (input.acknowledged) {
    metadata.attention_acknowledged = { at: new Date().toISOString(), user_id: 'user-0' };
  }
  await runner.query(
    `INSERT INTO ai_action_requests (
       id, tenant_id, capability_name, capability_version, effect, status, target_type, target_ref,
       provider_kind, provider_key, input_hash, error_message, metadata_json
     )
     VALUES ($1, $2, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', $3, 'ticket', 'FRO-2217',
             'ticketing', 'mock', $4, $5, $6::jsonb)`,
    [input.id, input.tenantId, input.status, `hash-${input.id}`, input.errorMessage ?? null, JSON.stringify(metadata)],
  );
}

async function acknowledgedStamp(runner: QueryRunner, table: 'ai_action_requests' | 'ai_agent_work_items', id: string) {
  const rows = await runner.query(
    `SELECT metadata_json -> 'attention_acknowledged' AS stamp FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0]?.stamp ?? null;
}

async function testDeleteUsedAgentWithWorkItemLinkedAudit() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const tenantId = randomUUID();
  const definitionId = randomUUID();
  const workItemId = randomUUID();
  const auditEventId = randomUUID();
  const policyId = randomUUID();
  try {
    await seedTenant(runner, tenantId, `ai-del-${tenantId.slice(0, 8)}`, 'Agent delete tenant');
    await setCurrentTenant(runner, tenantId);
    await insertDefinition(runner, definitionId, tenantId, 'fromage.service.desk.agent');
    await insertWorkItem(runner, {
      id: workItemId,
      tenantId,
      definitionId,
      dedupKey: `used-audit-${definitionId}`,
    });
    await runner.query(
      `INSERT INTO ai_agent_audit_events (
         id, tenant_id, agent_definition_id, work_item_id, event_type, severity, message
       )
       VALUES ($1, $2, $3, $4, 'work_item_processing_failed', 'error', 'mock triage failed')`,
      [auditEventId, tenantId, definitionId, workItemId],
    );
    await runner.query(
      `INSERT INTO ai_approval_policies (
         id, tenant_id, policy_key, policy_version, name, status, enabled,
         capability_name, capability_version, effect, live_test_safety, metadata_json
       )
       VALUES (
         $1, $2, $3, 1, 'Autonomy grant', 'enabled', true,
         'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'mock_only',
         $4::jsonb
       )`,
      [
        policyId,
        tenantId,
        `agent-autonomy:${definitionId}:internal_note`,
        JSON.stringify({
          created_by: AGENT_AUTONOMY_POLICY_SOURCE,
          agent_definition_id: definitionId,
          action_class: 'internal_note',
        }),
      ],
    );

    const result = await controlService().deleteAgentDefinition(controlContext(runner, tenantId), definitionId);
    assert.equal(result.deleted, true);

    const definitions = await runner.query(`SELECT 1 FROM ai_agent_definitions WHERE id = $1`, [definitionId]);
    assert.equal(definitions.length, 0);
    const workItems = await runner.query(`SELECT 1 FROM ai_agent_work_items WHERE id = $1`, [workItemId]);
    assert.equal(workItems.length, 0);
    const policies = await runner.query(`SELECT 1 FROM ai_approval_policies WHERE id = $1`, [policyId]);
    assert.equal(policies.length, 0);

    const audit = await runner.query(
      `SELECT event_type, agent_definition_id, work_item_id FROM ai_agent_audit_events WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId],
    );
    assert.equal(audit.some((row: { event_type: string }) => row.event_type === 'work_item_processing_failed'), true);
    assert.equal(audit.some((row: { event_type: string }) => row.event_type === 'agent_deleted'), true);
    for (const row of audit) {
      assert.equal(row.agent_definition_id, null);
      assert.equal(row.work_item_id, null);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testDeleteAgentWithTriggerLinkedWorkItem() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const tenantId = randomUUID();
  const definitionId = randomUUID();
  const triggerId = randomUUID();
  const workItemId = randomUUID();
  try {
    await seedTenant(runner, tenantId, `ai-del-tr-${tenantId.slice(0, 8)}`, 'Agent delete trigger tenant');
    await setCurrentTenant(runner, tenantId);
    await insertDefinition(runner, definitionId, tenantId, 'helpdesk.with.trigger');
    await runner.query(
      `INSERT INTO ai_agent_triggers (
         id, tenant_id, agent_definition_id, trigger_key, trigger_kind, status, enabled
       )
       VALUES ($1, $2, $3, 'manual.safe_target', 'manual', 'enabled', true)`,
      [triggerId, tenantId, definitionId],
    );
    await insertWorkItem(runner, {
      id: workItemId,
      tenantId,
      definitionId,
      triggerId,
      dedupKey: `trigger-linked-${definitionId}`,
    });

    const result = await controlService().deleteAgentDefinition(controlContext(runner, tenantId), definitionId);
    assert.equal(result.deleted, true);
    const leftover = await runner.query(`SELECT 1 FROM ai_agent_definitions WHERE id = $1`, [definitionId]);
    assert.equal(leftover.length, 0);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testCrossTenantWorkItemAssignmentStillBlocked() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const tenantOne = randomUUID();
  const tenantTwo = randomUUID();
  const definitionOne = randomUUID();
  const definitionTwo = randomUUID();
  const workItemTwo = randomUUID();
  try {
    await seedTenant(runner, tenantOne, `ai-del-a-${tenantOne.slice(0, 8)}`, 'Agent delete isolation A');
    await seedTenant(runner, tenantTwo, `ai-del-b-${tenantTwo.slice(0, 8)}`, 'Agent delete isolation B');

    await setCurrentTenant(runner, tenantTwo);
    await insertDefinition(runner, definitionTwo, tenantTwo, 'tenant.two.desk');
    await insertWorkItem(runner, {
      id: workItemTwo,
      tenantId: tenantTwo,
      definitionId: definitionTwo,
      dedupKey: `t2-${definitionTwo}`,
    });

    await setCurrentTenant(runner, tenantOne);
    await insertDefinition(runner, definitionOne, tenantOne, 'tenant.one.desk');
    await assert.rejects(
      () => runner.query(
        `INSERT INTO ai_agent_audit_events (
           tenant_id, agent_definition_id, work_item_id, event_type, severity, message
         )
         VALUES ($1, $2, $3, 'cross-work-item', 'warning', 'must stay blocked')`,
        [tenantOne, definitionOne, workItemTwo],
      ),
      (error: unknown) => error instanceof Error
        && error.message.includes('cross-tenant ai_agent_audit_events.work_item_id link'),
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

// The fromage backlog: an agent deleted before this fix left hundreds of expired
// proposals whose metadata still names it. Acknowledging one used to fail on the
// audit-event trigger; it must succeed, with the link nulled and the id kept.
async function testAcknowledgeOrphanedProposalWritesAuditWithoutAgentLink() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const tenantId = randomUUID();
  const definitionId = randomUUID();
  const actionId = randomUUID();
  try {
    await seedTenant(runner, tenantId, `ai-orph-${tenantId.slice(0, 8)}`, 'Orphaned proposal tenant');
    await setCurrentTenant(runner, tenantId);
    await insertDefinition(runner, definitionId, tenantId, 'orphaned.desk');
    await insertActionRequest(runner, {
      id: actionId, tenantId, definitionId, status: 'expired', errorMessage: 'Action request expired before review.',
    });
    // Pre-fix deletion path: the agent row goes, the proposal keeps its metadata id.
    await runner.query(`DELETE FROM ai_agent_definitions WHERE id = $1`, [definitionId]);

    const service = controlService();
    const context = controlContext(runner, tenantId);
    const listed = await service.listActionRequests(context, { status: 'all' });
    const listedRow = listed.items.find((item) => item.id === actionId) as any;
    assert.equal(listedRow.agent_definition_id, definitionId);
    assert.equal(listedRow.agent_exists, false);

    const ack = await service.acknowledgeAttention(context, { kind: 'action', id: actionId });
    assert.equal(ack.already, false);
    assert.ok(await acknowledgedStamp(runner, 'ai_action_requests', actionId));

    const audit = await runner.query(
      `SELECT agent_definition_id, metadata_json FROM ai_agent_audit_events
        WHERE tenant_id = $1 AND event_type = 'agent_attention_acknowledged'`,
      [tenantId],
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0].agent_definition_id, null);
    assert.equal(audit[0].metadata_json.orphaned_agent_definition_id, definitionId);
    assert.equal(audit[0].metadata_json.action_request_id, actionId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testAcknowledgeAllStampsOnlyTerminalUnacknowledgedRows() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const definitionId = randomUUID();
  const otherDefinitionId = randomUUID();
  const expiredIds = [randomUUID(), randomUUID(), randomUUID()];
  const pendingId = randomUUID();
  const alreadyAckedId = randomUUID();
  const approvedRetryingId = randomUUID();
  const failedWorkItemId = randomUUID();
  const completedWorkItemId = randomUUID();
  const otherTenantActionId = randomUUID();
  try {
    await seedTenant(runner, otherTenantId, `ai-ack-o-${otherTenantId.slice(0, 8)}`, 'Ack-all other tenant');
    await setCurrentTenant(runner, otherTenantId);
    await insertDefinition(runner, otherDefinitionId, otherTenantId, 'other.desk');
    await insertActionRequest(runner, {
      id: otherTenantActionId, tenantId: otherTenantId, definitionId: otherDefinitionId, status: 'expired', errorMessage: 'expired',
    });

    await seedTenant(runner, tenantId, `ai-ack-${tenantId.slice(0, 8)}`, 'Ack-all tenant');
    await setCurrentTenant(runner, tenantId);
    await insertDefinition(runner, definitionId, tenantId, 'ack.desk');
    for (const id of expiredIds) {
      await insertActionRequest(runner, { id, tenantId, definitionId, status: 'expired', errorMessage: 'Action request expired before review.' });
    }
    await insertActionRequest(runner, { id: pendingId, tenantId, definitionId, status: 'pending' });
    await insertActionRequest(runner, {
      id: alreadyAckedId, tenantId, definitionId, status: 'expired', errorMessage: 'expired', acknowledged: true,
    });
    await insertActionRequest(runner, {
      id: approvedRetryingId, tenantId, definitionId, status: 'approved', errorMessage: 'Provider timed out; retrying.',
    });
    await insertWorkItem(runner, { id: failedWorkItemId, tenantId, definitionId, dedupKey: `failed-${definitionId}`, status: 'failed' });
    await insertWorkItem(runner, { id: completedWorkItemId, tenantId, definitionId, dedupKey: `done-${definitionId}` });

    const service = controlService();
    const context = controlContext(runner, tenantId);
    assert.deepEqual(await service.getAttentionSummary(context), { actions: 3, work_items: 1, total: 4 });
    assert.deepEqual(
      await service.getAttentionSummary(context, { agentDefinitionId: randomUUID() }),
      { actions: 0, work_items: 0, total: 0 },
    );

    const result = await service.acknowledgeAllAttention(context);
    assert.deepEqual(result, { acknowledged_actions: 3, acknowledged_work_items: 1, total: 4 });
    for (const id of expiredIds) {
      const stamp = await acknowledgedStamp(runner, 'ai_action_requests', id);
      assert.equal(stamp.user_id, context.userId);
      assert.ok(stamp.at);
    }
    assert.ok(await acknowledgedStamp(runner, 'ai_agent_work_items', failedWorkItemId));
    assert.equal(await acknowledgedStamp(runner, 'ai_action_requests', pendingId), null);
    assert.equal(await acknowledgedStamp(runner, 'ai_action_requests', approvedRetryingId), null);
    assert.equal(await acknowledgedStamp(runner, 'ai_agent_work_items', completedWorkItemId), null);
    // The earlier stamp is kept, not overwritten.
    assert.equal((await acknowledgedStamp(runner, 'ai_action_requests', alreadyAckedId)).user_id, 'user-0');

    assert.deepEqual(await service.getAttentionSummary(context), { actions: 0, work_items: 0, total: 0 });
    assert.deepEqual(await service.acknowledgeAllAttention(context), { acknowledged_actions: 0, acknowledged_work_items: 0, total: 0 });

    const audit = await runner.query(
      `SELECT agent_definition_id, metadata_json FROM ai_agent_audit_events
        WHERE tenant_id = $1 AND event_type = 'agent_attention_acknowledged'`,
      [tenantId],
    );
    assert.equal(audit.length, 1, 'one audit event for the batch, none for the empty second call');
    assert.equal(audit[0].metadata_json.kind, 'bulk');
    assert.equal(audit[0].metadata_json.acknowledged_actions, 3);
    assert.equal(audit[0].metadata_json.acknowledged_work_items, 1);

    await setCurrentTenant(runner, otherTenantId);
    assert.equal(await acknowledgedStamp(runner, 'ai_action_requests', otherTenantActionId), null);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testDeleteAgentStampsItsTerminalProposals() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const tenantId = randomUUID();
  const definitionId = randomUUID();
  const keptDefinitionId = randomUUID();
  const expiredIds = [randomUUID(), randomUUID()];
  const pendingId = randomUUID();
  const keptAgentExpiredId = randomUUID();
  try {
    await seedTenant(runner, tenantId, `ai-del-p-${tenantId.slice(0, 8)}`, 'Agent delete proposals tenant');
    await setCurrentTenant(runner, tenantId);
    await insertDefinition(runner, definitionId, tenantId, 'deleted.desk');
    await insertDefinition(runner, keptDefinitionId, tenantId, 'kept.desk');
    for (const id of expiredIds) {
      await insertActionRequest(runner, { id, tenantId, definitionId, status: 'expired', errorMessage: 'expired' });
    }
    await insertActionRequest(runner, { id: pendingId, tenantId, definitionId, status: 'pending' });
    await insertActionRequest(runner, {
      id: keptAgentExpiredId, tenantId, definitionId: keptDefinitionId, status: 'expired', errorMessage: 'expired',
    });

    const result = await controlService().deleteAgentDefinition(controlContext(runner, tenantId), definitionId);
    assert.equal(result.deleted, true);
    for (const id of expiredIds) {
      assert.equal((await acknowledgedStamp(runner, 'ai_action_requests', id)).reason, 'agent_deleted');
    }
    assert.equal(await acknowledgedStamp(runner, 'ai_action_requests', pendingId), null);
    assert.equal(await acknowledgedStamp(runner, 'ai_action_requests', keptAgentExpiredId), null);

    const audit = await runner.query(
      `SELECT metadata_json FROM ai_agent_audit_events WHERE tenant_id = $1 AND event_type = 'agent_deleted'`,
      [tenantId],
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0].metadata_json.acknowledged_actions, 2);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  await dataSource.initialize();
  try {
    await testDeleteUsedAgentWithWorkItemLinkedAudit();
    await testDeleteAgentWithTriggerLinkedWorkItem();
    await testCrossTenantWorkItemAssignmentStillBlocked();
    await testAcknowledgeOrphanedProposalWritesAuditWithoutAgentLink();
    await testAcknowledgeAllStampsOnlyTerminalUnacknowledgedRows();
    await testDeleteAgentStampsItsTerminalProposals();
  } finally {
    await dataSource.destroy();
  }
}

void run();
