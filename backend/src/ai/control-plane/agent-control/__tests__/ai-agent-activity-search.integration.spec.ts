import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../../../data-source';
import { AiAgentControlService } from '../ai-agent-control.service';

/**
 * The Activity search finds an entry by the reference the Target column shows (T-15, PRJ-3),
 * while the row still stores the record's id. A ticket number keeps matching the stored text.
 * A reference resolved in another workspace never names a row of this one.
 *
 * Real PostgreSQL, migrations applied. The whole spec rolls back.
 */

const CAPABILITY = 'ticketing.ticket.public_reply.add_approved';

async function seedTenant(runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, tenantId: string, tag: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `activity-search-${tag}-${tenantId.slice(0, 8)}`, `Activity search ${tag}`],
  );
}

async function setCurrentTenant(runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTask(runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, tenantId: string, itemNumber: number): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO tasks (id, tenant_id, item_number, title, status, labels, owner_ids, viewer_ids, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'open', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())`,
    [id, tenantId, itemNumber, `Task ${itemNumber}`],
  );
  return id;
}

async function seedProject(runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, tenantId: string, itemNumber: number): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, origin, status, execution_progress, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'standard', 'planned', 0, now(), now())`,
    [id, tenantId, itemNumber, `Project ${itemNumber}`],
  );
  return id;
}

async function seedAction(
  runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  tenantId: string,
  targetType: string,
  targetRef: string,
  executed: boolean,
): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO ai_action_requests (
       id, tenant_id, capability_name, capability_version, effect, status,
       target_type, target_ref, input_hash, executed_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, '1.0.0', 'write', $4,
       $5, $6, $7, CASE WHEN $8::bool THEN now() ELSE NULL END, now(), now()
     )`,
    [id, tenantId, CAPABILITY, executed ? 'executed' : 'pending', targetType, targetRef, `hash-${id}`, executed],
  );
  return id;
}

async function seedApproval(
  runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  tenantId: string,
  actionId: string,
) {
  await runner.query(
    `INSERT INTO ai_approvals (
       id, tenant_id, action_request_id, capability_name, capability_version,
       source, status, input_hash, expires_at, decided_at, created_at
     ) VALUES (
       $1, $2, $3, $4, '1.0.0',
       'human', 'approved', $5, now() + interval '1 hour', now(), now()
     )`,
    [randomUUID(), tenantId, actionId, CAPABILITY, `approval-${actionId}`],
  );
}

async function seedFailedRun(
  runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  tenantId: string,
  targetType: string,
  targetRef: string,
) {
  await runner.query(
    `INSERT INTO ai_runs (
       id, tenant_id, invocation_channel, trigger_kind, status, metadata_json, created_at, updated_at
     ) VALUES (
       $1, $2, 'internal', 'internal', 'failed', $3::jsonb, now(), now()
     )`,
    [randomUUID(), tenantId, JSON.stringify({ target_type: targetType, target_ref: targetRef })],
  );
}

function contextFor(manager: unknown, tenantId: string) {
  return {
    tenantId,
    userId: randomUUID(),
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    manager,
  };
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    await seedTenant(runner, tenantId, 'a');
    await seedTenant(runner, otherTenantId, 'b');

    await setCurrentTenant(runner, otherTenantId);
    const foreignTaskId = await seedTask(runner, otherTenantId, 15);

    await setCurrentTenant(runner, tenantId);
    const taskId = await seedTask(runner, tenantId, 15);
    const projectId = await seedProject(runner, tenantId, 3);
    const taskActionId = await seedAction(runner, tenantId, 'tasks', taskId, true);
    await seedApproval(runner, tenantId, taskActionId);
    await seedFailedRun(runner, tenantId, 'tasks', taskId);
    await seedAction(runner, tenantId, 'projects', projectId, true);
    // The other workspace's task, recorded here by its id: T-15 of this workspace must not name it.
    await seedAction(runner, tenantId, 'tasks', foreignTaskId, false);
    await seedAction(runner, tenantId, 'ticket', '4711', false);

    await setCurrentTenant(runner, otherTenantId);
    // The other workspace's own T-15 is foreignTaskId. Its only action points at this workspace's id.
    await seedAction(runner, otherTenantId, 'tasks', taskId, true);

    const service = new AiAgentControlService(
      {} as never,
      {} as never,
      {} as never,
      { findEnabledTargets: async () => [] } as never,
      {} as never,
    );

    await setCurrentTenant(runner, tenantId);
    const byReference = await service.listActivity(contextFor(runner.manager, tenantId) as never, {
      targetRef: 'T-15',
      limit: 20,
    });
    const taskRefs = byReference.items.filter((entry) => entry.targetRef === taskId);
    assert.ok(taskRefs.some((entry) => entry.type === 'proposal'), 'the action is found by T-15');
    assert.ok(taskRefs.some((entry) => entry.type === 'execution'), 'the execution is found by T-15');
    assert.ok(taskRefs.some((entry) => entry.type === 'decision'), 'the approval is found by T-15');
    assert.ok(
      byReference.items.some((entry) => entry.type === 'error' && entry.runId && entry.targetRef === taskId),
      'the failed run is found by T-15',
    );
    assert.equal(byReference.items.some((entry) => entry.targetRef === foreignTaskId), false, 'another workspace\'s record is not T-15 here');
    assert.equal(byReference.items.some((entry) => entry.targetRef === '4711'), false, 'a ticket number is not T-15');
    assert.ok(taskRefs.every((entry) => entry.targetDisplay === 'T-15'), 'the column shows the reference that was typed');

    const byLower = await service.listActivity(contextFor(runner.manager, tenantId) as never, {
      targetRef: 't-15',
      limit: 20,
    });
    assert.ok(byLower.items.some((entry) => entry.targetRef === taskId), 'the reference matches without case');

    const byProject = await service.listActivity(contextFor(runner.manager, tenantId) as never, {
      targetRef: 'PRJ-3',
      limit: 20,
    });
    assert.ok(byProject.items.some((entry) => entry.targetRef === projectId), 'a project reference finds its entry');
    assert.equal(byProject.items.some((entry) => entry.targetRef === taskId), false);

    const byTicket = await service.listActivity(contextFor(runner.manager, tenantId) as never, {
      targetRef: '4711',
      limit: 20,
    });
    assert.ok(byTicket.items.some((entry) => entry.targetRef === '4711'), 'a ticket number still finds the ticket');
    assert.equal(byTicket.items.some((entry) => entry.targetRef === taskId), false, 'a ticket number does not return the task');

    const byId = await service.listActivity(contextFor(runner.manager, tenantId) as never, {
      targetRef: taskId,
      limit: 20,
    });
    assert.ok(byId.items.some((entry) => entry.targetRef === taskId), 'a pasted id still finds the entry');

    await setCurrentTenant(runner, otherTenantId);
    const other = await service.listActivity(contextFor(runner.manager, otherTenantId) as never, {
      targetRef: 'T-15',
      limit: 20,
    });
    assert.equal(other.items.length, 0, 'the other workspace\'s T-15 returns nothing of this one');

    console.log('ai-agent-activity-search.integration.spec: ok');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
