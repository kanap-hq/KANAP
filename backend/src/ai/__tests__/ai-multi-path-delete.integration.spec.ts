import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AiAgentActivityRetentionService } from '../control-plane/agent/ai-agent-activity-retention.service';
import { AiAgentWorkQueueService } from '../control-plane/agent/ai-agent-work-queue.service';
import { AiAgentControlService } from '../control-plane/agent-control/ai-agent-control.service';
import { AiConversationRetentionService } from '../../cleanup/ai-conversation-retention.service';

// One DELETE that reaches a row along two FK paths (one ON DELETE SET NULL
// directly, the other through a parent that CASCADEs with the deleted row).
// Two things can break it:
//
// 1. enforce_ai_execution_tenant_graph() re-checking a link the SET NULL left
//    unchanged, whose parent the same DELETE removed. Fixed by 1853710000000;
//    the user and run deletes below fail without it on any database.
// 2. PostgreSQL's own FK check, which re-tests an unchanged key when the row
//    version was written earlier in the same transaction. It fails only when
//    the direct SET NULL fires before the cascade. Referential triggers fire in
//    trigger-name order (RI_ConstraintTrigger_a_<oid>): a migrated database
//    cascades first, a pg_restore'd one may not. The agent delete and both
//    retention purges (scheduled, and startable on demand by a platform admin)
//    unlink the second path explicitly. The tests for this re-create the
//    cascading FK inside the transaction so it fires last, the restored order,
//    on every database, and rewrite the row first where the code path does not.
//
// Seed rows are committed first, like real history. Every operation under test
// runs in a transaction that is rolled back (DDL included); the seed is removed
// in `finally`.

const DAY = 24 * 60 * 60 * 1000;

function ids() {
  return {
    tenantId: randomUUID(),
    roleId: randomUUID(),
    userId: randomUUID(),
    apiKeyId: randomUUID(),
    mcpRunId: randomUUID(),
    conversationId: randomUUID(),
    messageId: randomUUID(),
    previewId: randomUUID(),
    actionRequestId: randomUUID(),
    chatRunId: randomUUID(),
    toolExecutionId: randomUUID(),
    evidenceId: randomUUID(),
    definitionId: randomUUID(),
    workItemId: randomUUID(),
    auditEventId: randomUUID(),
    agentRunId: randomUUID(),
    agentToolExecutionId: randomUUID(),
    terminalActionId: randomUUID(),
    approvalId: randomUUID(),
    keptActionId: randomUUID(),
    agentEvidenceId: randomUUID(),
  };
}
type Seed = ReturnType<typeof ids>;

async function inTenantTransaction<T>(
  tenantId: string,
  outcome: 'commit' | 'rollback',
  fn: (runner: QueryRunner) => Promise<T>,
): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const result = await fn(runner);
    if (outcome === 'commit') {
      await runner.commitTransaction();
    } else {
      await runner.rollbackTransaction();
    }
    return result;
  } catch (error) {
    if (runner.isTransactionActive) {
      await runner.rollbackTransaction();
    }
    throw error;
  } finally {
    await runner.release();
  }
}

// Re-creates an FK (NOT VALID, same definition) so its triggers get new OIDs.
async function recreateForeignKey(runner: QueryRunner, table: string, constraint: string) {
  const [{ def }] = await runner.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
    [constraint, table],
  );
  await runner.query(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
  await runner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} ${def} NOT VALID`);
}

// Re-creates a cascading FK so its action trigger gets the newest OID and fires
// after `sibling`. Rolled back with the transaction.
async function fireLast(runner: QueryRunner, table: string, constraint: string, sibling: string) {
  // Action triggers live on the referenced table; they fire in tgname order.
  const triggers = async (): Promise<Array<{ conname: string; tbl: string; tgname: string }>> => runner.query(
    `SELECT c.conname, c.conrelid::regclass::text AS tbl, t.tgname
       FROM pg_trigger t JOIN pg_constraint c ON c.oid = t.tgconstraint
      WHERE c.conname = ANY($1) AND t.tgrelid = c.confrelid AND t.tgtype & 8 = 8`,
    [[constraint, sibling]],
  );
  await recreateForeignKey(runner, table, constraint);
  let rows = await triggers();
  const find = (conname: string) => rows.find((row) => row.conname === conname);
  const name = (conname: string) => find(conname)?.tgname ?? '';
  // tgname compares as text: once the cluster's OID counter gains a digit, the
  // new name (..._a_1000123) sorts before an older, shorter one (..._a_997583).
  // Re-create the sibling first so both carry new OIDs of the same length.
  const siblingTable = find(sibling)?.tbl;
  if (siblingTable && !(name(constraint) > name(sibling))) {
    await recreateForeignKey(runner, siblingTable, sibling);
    await recreateForeignKey(runner, table, constraint);
    rows = await triggers();
  }
  assert.ok(name(sibling) && name(constraint) > name(sibling), `${constraint} must now fire after ${sibling}`);
}

async function seed(s: Seed) {
  const tag = s.tenantId.slice(0, 8);
  const old = new Date(Date.now() - 60 * DAY).toISOString();
  await inTenantTransaction(s.tenantId, 'commit', async (runner) => {
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Multi-path delete tenant', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [s.tenantId, `ai-mpd-${tag}`],
    );
    await runner.query(
      `INSERT INTO ai_settings (tenant_id, conversation_retention_days) VALUES ($1, 30)`,
      [s.tenantId],
    );
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'Multi-path delete role', 'test', false, false, now(), now())`,
      [s.roleId, s.tenantId],
    );
    await runner.query(
      `INSERT INTO users (id, tenant_id, email, role_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'enabled', now(), now())`,
      [s.userId, s.tenantId, `multi-path-${tag}@example.invalid`, s.roleId],
    );
    // An MCP key and a run it made.
    await runner.query(
      `INSERT INTO ai_api_keys (id, tenant_id, user_id, key_hash, key_prefix, label, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, 'Multi-path key', $3)`,
      [s.apiKeyId, s.tenantId, s.userId, `multi-path-hash-${s.tenantId}`, `mpd${tag}`],
    );
    await runner.query(
      `INSERT INTO ai_runs (id, tenant_id, user_id, ai_api_key_id, invocation_channel, trigger_kind, status)
       VALUES ($1, $2, $3, $4, 'mcp', 'api_key', 'completed')`,
      [s.mcpRunId, s.tenantId, s.userId, s.apiKeyId],
    );
    // A confirmed chat write in a conversation archived long ago: conversation,
    // message, preview, and the action request it produced.
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, archived_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
      [s.conversationId, s.tenantId, s.userId, old],
    );
    await runner.query(
      `INSERT INTO ai_messages (id, tenant_id, conversation_id, role, content) VALUES ($1, $2, $3, 'user', 'import it')`,
      [s.messageId, s.tenantId, s.conversationId],
    );
    await runner.query(
      `INSERT INTO ai_mutation_previews (
         id, tenant_id, user_id, conversation_id, tool_name, target_entity_type, mutation_input, status, expires_at
       )
       VALUES ($1, $2, $3, $4, 'import_ticket', 'task', '{}'::jsonb, 'executed', now() + interval '10 minutes')`,
      [s.previewId, s.tenantId, s.userId, s.conversationId],
    );
    await runner.query(
      `INSERT INTO ai_action_requests (
         id, tenant_id, user_id, conversation_id, preview_id, capability_name, capability_version, effect, input_hash
       )
       VALUES ($1, $2, $3, $4, $5, 'kanap.mutation_preview.execute_approved', '1.0.0', 'write', $6)`,
      [s.actionRequestId, s.tenantId, s.userId, s.conversationId, s.previewId, `multi-path-${s.tenantId}`],
    );
    // A run whose evidence points at both the run and one of its tool executions.
    await runner.query(
      `INSERT INTO ai_runs (id, tenant_id, invocation_channel, trigger_kind, status)
       VALUES ($1, $2, 'chat', 'human_user', 'completed')`,
      [s.chatRunId, s.tenantId],
    );
    await runner.query(
      `INSERT INTO ai_tool_executions (id, tenant_id, run_id, capability_name, capability_version, surface, effect, status)
       VALUES ($1, $2, $3, 'search_all', '1.0.0', 'chat', 'read', 'completed')`,
      [s.toolExecutionId, s.tenantId, s.chatRunId],
    );
    await runner.query(
      `INSERT INTO ai_evidence (
         id, tenant_id, run_id, tool_execution_id, source_provider, source_object_type,
         trust_level, redaction_status, content_hash, summary, retention_class, collected_at
       )
       VALUES ($1, $2, $3, $4, 'kanap_domain', 'search_all', 'system', 'redacted', $5, 'summary', 'standard', now())`,
      [s.evidenceId, s.tenantId, s.chatRunId, s.toolExecutionId, `multi-path-content-${s.tenantId}`],
    );
    // A used agent: a work item, an audit event linked to it.
    await runner.query(
      `INSERT INTO ai_agent_definitions (
         id, tenant_id, agent_key, name, agent_type, status, environment,
         max_autonomy_level, default_approval_requirement, queue_policy_json
       )
       VALUES ($1, $2, 'multi.path.desk', 'Multi-path agent', 'helpdesk', 'enabled', 'sandbox', 'A3', 'human_for_writes',
               '{"activity_retention_days":30}'::jsonb)`,
      [s.definitionId, s.tenantId],
    );
    await runner.query(
      `INSERT INTO ai_agent_work_items (
         id, tenant_id, agent_definition_id, source_provider_kind, source_provider_key,
         source_object_type, source_object_ref, work_kind, status, dedup_key
       )
       VALUES ($1, $2, $3, 'ticketing', 'mock', 'ticket', 'MP-1', 'ticket_triage', 'completed', $4)`,
      [s.workItemId, s.tenantId, s.definitionId, `multi-path-${s.definitionId}`],
    );
    await runner.query(
      `INSERT INTO ai_agent_audit_events (id, tenant_id, agent_definition_id, work_item_id, event_type, severity, message)
       VALUES ($1, $2, $3, $4, 'work_item_processing_failed', 'error', 'mock triage failed')`,
      [s.auditEventId, s.tenantId, s.definitionId, s.workItemId],
    );
    // The agent's old proposal, as the dispatcher writes it: run, tool execution,
    // terminal action request with its approval, evidence carrying all three
    // links. Plus a recent terminal proposal on the same tool execution, which
    // retention keeps.
    const agentMetadata = JSON.stringify({ agent_definition_id: s.definitionId });
    await runner.query(
      `INSERT INTO ai_runs (id, tenant_id, invocation_channel, trigger_kind, status, metadata_json, created_at, updated_at)
       VALUES ($1, $2, 'agent', 'agent_work_item', 'completed', $3::jsonb, $4, $4)`,
      [s.agentRunId, s.tenantId, agentMetadata, old],
    );
    await runner.query(
      `INSERT INTO ai_action_requests (
         id, tenant_id, run_id, capability_name, capability_version, effect, status, input_hash, metadata_json, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'expired', $4, $5::jsonb, $6, $6)`,
      [s.terminalActionId, s.tenantId, s.agentRunId, `multi-path-old-${s.tenantId}`, agentMetadata, old],
    );
    await runner.query(
      `INSERT INTO ai_approvals (
         id, tenant_id, action_request_id, capability_name, capability_version, source, status, input_hash, expires_at
       )
       VALUES ($1, $2, $3, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'human_chat', 'expired', $4, $5)`,
      [s.approvalId, s.tenantId, s.terminalActionId, `multi-path-old-${s.tenantId}`, old],
    );
    await runner.query(
      `INSERT INTO ai_tool_executions (
         id, tenant_id, run_id, action_request_id, approval_id, capability_name, capability_version, surface, effect, status
       )
       VALUES ($1, $2, $3, $4, $5, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'agent', 'write', 'completed')`,
      [s.agentToolExecutionId, s.tenantId, s.agentRunId, s.terminalActionId, s.approvalId],
    );
    await runner.query(
      `INSERT INTO ai_action_requests (
         id, tenant_id, run_id, tool_execution_id, capability_name, capability_version, effect, status, input_hash, metadata_json
       )
       VALUES ($1, $2, $3, $4, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'executed', $5, $6::jsonb)`,
      [s.keptActionId, s.tenantId, s.agentRunId, s.agentToolExecutionId, `multi-path-new-${s.tenantId}`, agentMetadata],
    );
    await runner.query(
      `INSERT INTO ai_evidence (
         id, tenant_id, run_id, tool_execution_id, action_request_id, source_provider, source_object_type,
         trust_level, redaction_status, content_hash, summary, retention_class, collected_at
       )
       VALUES ($1, $2, $3, $4, $5, 'ticketing', 'ticket', 'system', 'redacted', $6, 'summary', 'standard', now())`,
      [s.agentEvidenceId, s.tenantId, s.agentRunId, s.agentToolExecutionId, s.terminalActionId, `multi-path-agent-${s.tenantId}`],
    );
  });
}

async function cleanup(s: Seed) {
  await inTenantTransaction(s.tenantId, 'commit', async (runner) => {
    // Children first, one table at a time, so cleanup itself has no multi-path cascade.
    for (const table of [
      'ai_evidence',
      'ai_tool_executions',
      'ai_approvals',
      'ai_action_requests',
      'ai_runs',
      'ai_agent_audit_events',
      'ai_agent_work_items',
      'ai_agent_definitions',
      'ai_mutation_previews',
      'ai_messages',
      'ai_conversations',
      'ai_api_keys',
      'ai_settings',
      'users',
      'roles',
    ]) {
      await runner.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [s.tenantId]);
    }
    await runner.query(`DELETE FROM tenants WHERE id = $1`, [s.tenantId]);
  });
}

// Admin deletes a user who ran an MCP key and confirmed a chat write. The key,
// conversation and preview CASCADE with the user while ai_runs.user_id and
// ai_action_requests.user_id / conversation_id are SET NULL.
async function testDeleteUserWithMcpRunAndConfirmedChatWrite(s: Seed) {
  await inTenantTransaction(s.tenantId, 'rollback', async (runner) => {
    await runner.query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.userId]);
    const [run] = await runner.query(
      `SELECT user_id, ai_api_key_id FROM ai_runs WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.mcpRunId],
    );
    assert.ok(run, 'the MCP run is kept');
    assert.equal(run.user_id, null);
    assert.equal(run.ai_api_key_id, null);
    const [action] = await runner.query(
      `SELECT user_id, conversation_id, preview_id FROM ai_action_requests WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.actionRequestId],
    );
    assert.ok(action, 'the action request is kept');
    assert.equal(action.user_id, null);
    assert.equal(action.conversation_id, null);
    assert.equal(action.preview_id, null);
  });
}

// A run is deleted: its tool executions CASCADE while ai_evidence.run_id and
// ai_evidence.tool_execution_id are SET NULL.
async function testDeleteRunWithEvidenceOnItsToolExecution(s: Seed) {
  await inTenantTransaction(s.tenantId, 'rollback', async (runner) => {
    await runner.query(`DELETE FROM ai_runs WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.chatRunId]);
    const [evidence] = await runner.query(
      `SELECT run_id, tool_execution_id FROM ai_evidence WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.evidenceId],
    );
    assert.ok(evidence, 'the evidence is kept');
    assert.equal(evidence.run_id, null);
    assert.equal(evidence.tool_execution_id, null);
  });
}

// Changed links are still checked: relinking to a row the tenant cannot see is refused.
async function testChangedLinkStillChecked(s: Seed) {
  await assert.rejects(
    () => inTenantTransaction(s.tenantId, 'rollback', (runner) => runner.query(
      `UPDATE ai_evidence SET tool_execution_id = $3 WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.evidenceId, randomUUID()],
    )),
    (error: unknown) => error instanceof Error
      && error.message.includes('ai_evidence tool_execution_id must belong to the same tenant'),
  );
}

// Agent delete, restored order: the audit SET NULL fires before the work items
// CASCADE, and the audit row was rewritten earlier in the transaction.
async function testAgentDeleteInRestoredOrder(s: Seed) {
  await inTenantTransaction(s.tenantId, 'rollback', async (runner) => {
    await fireLast(
      runner,
      'ai_agent_work_items',
      'ai_agent_work_items_agent_definition_id_fkey',
      'ai_agent_audit_events_agent_definition_id_fkey',
    );
    await runner.query(
      `UPDATE ai_agent_audit_events SET message = message WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.auditEventId],
    );
    const service = new AiAgentControlService({} as any, {} as any, {} as any, {} as any, {} as any, new AiAgentWorkQueueService());
    const result = await service.deleteAgentDefinition({
      tenantId: s.tenantId,
      userId: s.userId,
      isPlatformHost: false,
      surface: 'chat',
      authMethod: 'jwt',
      manager: runner.manager,
    }, s.definitionId);
    assert.equal(result.deleted, true);
    const [audit] = await runner.query(
      `SELECT agent_definition_id, work_item_id FROM ai_agent_audit_events WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.auditEventId],
    );
    assert.ok(audit, 'the audit event is kept');
    assert.equal(audit.agent_definition_id, null);
    assert.equal(audit.work_item_id, null);
  });
}

// Activity retention, restored order. Purging the terminal proposal rewrites the
// evidence row (action_request_id SET NULL); purging the run then reaches it
// twice. The tool execution is rewritten first so the proposal delete, which
// reaches it twice too (action_request_id directly, approval_id through the
// approval), is exercised in the restored order as well.
async function testActivityRetentionPurgeInRestoredOrder(s: Seed) {
  await inTenantTransaction(s.tenantId, 'rollback', async (runner) => {
    await fireLast(runner, 'ai_tool_executions', 'ai_tool_executions_run_id_fkey', 'ai_evidence_run_id_fkey');
    await fireLast(runner, 'ai_tool_executions', 'ai_tool_executions_run_id_fkey', 'ai_action_requests_run_id_fkey');
    await fireLast(
      runner,
      'ai_approvals',
      'ai_approvals_action_request_id_fkey',
      'ai_tool_executions_action_request_id_fkey',
    );
    await runner.query(
      `UPDATE ai_tool_executions SET status = status WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.agentToolExecutionId],
    );
    const service = new AiAgentActivityRetentionService({} as any, { register: () => undefined } as any);
    const result = await service.purgeTenant(runner.manager, s.tenantId, new Date());
    assert.equal(result.counts.actions, 1, 'the old terminal proposal is purged');
    assert.equal(result.counts.runs, 1, 'its run is purged');

    const gone = await runner.query(
      `SELECT 'run' AS kind FROM ai_runs WHERE tenant_id = $1 AND id = $2
       UNION ALL SELECT 'tool' FROM ai_tool_executions WHERE tenant_id = $1 AND id = $3
       UNION ALL SELECT 'action' FROM ai_action_requests WHERE tenant_id = $1 AND id = $4
       UNION ALL SELECT 'approval' FROM ai_approvals WHERE tenant_id = $1 AND id = $5`,
      [s.tenantId, s.agentRunId, s.agentToolExecutionId, s.terminalActionId, s.approvalId],
    );
    assert.deepEqual(gone, []);
    const [evidence] = await runner.query(
      `SELECT run_id, tool_execution_id, action_request_id FROM ai_evidence WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.agentEvidenceId],
    );
    assert.ok(evidence, 'the evidence is kept');
    assert.deepEqual(
      [evidence.run_id, evidence.tool_execution_id, evidence.action_request_id],
      [null, null, null],
    );
    const [kept] = await runner.query(
      `SELECT run_id, tool_execution_id FROM ai_action_requests WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.keptActionId],
    );
    assert.ok(kept, 'the recent proposal is kept');
    assert.equal(kept.run_id, null);
    assert.equal(kept.tool_execution_id, null);
  });
}

// Conversation retention, restored order: the action request's conversation_id
// SET NULL fires before the previews CASCADE, and the action request was
// rewritten earlier in the transaction.
async function testConversationRetentionPurgeInRestoredOrder(s: Seed) {
  await inTenantTransaction(s.tenantId, 'rollback', async (runner) => {
    await fireLast(
      runner,
      'ai_mutation_previews',
      'ai_mutation_previews_conversation_id_fkey',
      'ai_action_requests_conversation_id_fkey',
    );
    await runner.query(
      `UPDATE ai_action_requests SET status = status WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.actionRequestId],
    );
    const service = new AiConversationRetentionService({} as any, { register: () => undefined } as any);
    const summary = { tenantsProcessed: 0, archived: 0, purged_conversations: 0, purged_messages: 0, errors: [] as string[] };
    const processed = await (service as any).runForTenant(runner.manager, s.tenantId, summary);
    assert.equal(processed, true);
    assert.equal(summary.purged_conversations, 1);
    assert.equal(summary.purged_messages, 1);

    const gone = await runner.query(
      `SELECT 'conversation' AS kind FROM ai_conversations WHERE tenant_id = $1 AND id = $2
       UNION ALL SELECT 'preview' FROM ai_mutation_previews WHERE tenant_id = $1 AND id = $3`,
      [s.tenantId, s.conversationId, s.previewId],
    );
    assert.deepEqual(gone, []);
    const [action] = await runner.query(
      `SELECT conversation_id, preview_id FROM ai_action_requests WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.actionRequestId],
    );
    assert.ok(action, 'the action request is kept');
    assert.equal(action.conversation_id, null);
    assert.equal(action.preview_id, null);
  });
}

async function run() {
  await dataSource.initialize();
  const s = ids();
  try {
    await seed(s);
    await testDeleteUserWithMcpRunAndConfirmedChatWrite(s);
    await testDeleteRunWithEvidenceOnItsToolExecution(s);
    await testChangedLinkStillChecked(s);
    await testAgentDeleteInRestoredOrder(s);
    await testActivityRetentionPurgeInRestoredOrder(s);
    await testConversationRetentionPurgeInRestoredOrder(s);
  } finally {
    try {
      await cleanup(s);
    } finally {
      await dataSource.destroy();
    }
  }
}

void run();
