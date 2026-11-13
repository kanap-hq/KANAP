import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// The assistant's read of a task (get_entity_detail, Plaid and MCP; get_entity_context) names the
// applications the person reads, and says when that read is partial or impossible:
// - a person who reads every application: all of them, nothing said;
// - a Business Contributor: the applications of their participation (no longer null as soon as one
//   is outside it), and `fields_partial` says the list holds only those;
// - a person who does not read applications: null, and `fields_withheld` gives the reason, so that
//   the answer never reads "no application linked".

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-task-linked-applications-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-task-linked-applications.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiEntityService } = require('../ai-entity.service');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The surface checks (tenant AI settings, provider, subscription) are not what this spec tests.
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const executor = app.get(AiQueryExecutor);
  const entities = app.get(AiEntityService);
  const aggregates = app.get(AiAggregateExecutor);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const slug = `ai-task-apps-${tenantId.slice(0, 8)}`;
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug, slug],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const role = async (name: string, permissions: Record<string, string>) => {
      const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2)`, [tenantId, name]);
      for (const [resource, level] of Object.entries(permissions)) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
      }
      return { id, permissions };
    };
    const user = async (name: string, roleId: string) => {
      const id = await insertId(runner,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Reader', $4, 'enabled')`,
        [tenantId, `${name}-${tenantId.slice(0, 8)}@example.test`, name, roleId]);
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, roleId]);
      return id;
    };
    const adminRole = await role('Administrator', {});
    const bcRole = await role('Business Contributor', { tasks: 'member', applications: 'reader' });
    const tasksOnly = await role('Task reader', { tasks: 'reader' });
    const adminId = await user('admin', adminRole.id);
    const bcId = await user('bc', bcRole.id);
    const readerId = await user('reader', tasksOnly.id);

    const seen = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Seen app')`, [tenantId]);
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, seen, bcId]);
    const unseen = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Secret app')`, [tenantId]);
    const task = await insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids) VALUES ($1, 1, 'Shared task', 'open', $2, '[]', '[]', '[]')`,
      [tenantId, bcId]);
    await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, task, seen, unseen]);

    const ctx = (userId: string) => ({
      tenantId, userId, isPlatformHost: false, surface: 'mcp' as const, authMethod: 'api_key' as const, manager: runner.manager,
    });
    const detail = (userId: string) => executor.executeDetail(ctx(userId), { entity_type: 'tasks', entity_id: 'T-1' });
    const names = (result: any) => (result.data.applications === null ? null : result.data.applications.map((app: { name: string }) => app.name).sort());
    const contextPartial = async (userId: string) => ((await entities.getEntityContext(ctx(userId), { entity_type: 'tasks', entity_id: task })).fields_partial ?? [])
      .map((entry: { field: string }) => entry.field);
    const contextNames = async (userId: string) => {
      const context = await entities.getEntityContext(ctx(userId), { entity_type: 'tasks', entity_id: task });
      const group = (context.related ?? context.relationships ?? []).find((g: any) => g.relation === 'linked_applications');
      return group ? group.items.map((item: any) => item.label).sort() : [];
    };

    // A person who reads everything: both applications, nothing said.
    const full = await detail(adminId);
    assert.deepEqual(names(full), ['Secret app', 'Seen app'], 'full reader: both applications');
    assert.equal(full.fields_withheld, undefined, 'full reader: nothing withheld');
    assert.equal(full.fields_partial, undefined, 'full reader: nothing partial');
    assert.deepEqual(await contextNames(adminId), ['Secret app', 'Seen app'], 'full reader: context');
    assert.deepEqual(await contextPartial(adminId), [], 'full reader: the context group is whole');
    console.log('  a person who reads everything: every application: OK');

    // A Business Contributor: their application, and the read said partial.
    const bc = await detail(bcId);
    assert.deepEqual(names(bc), ['Seen app'], 'contributor: the application of their participation');
    assert.ok(!JSON.stringify(bc).includes('Secret') && !JSON.stringify(bc).includes(unseen), 'contributor: nothing of the other');
    assert.deepEqual(bc.fields_partial?.map((entry: { field: string }) => entry.field), ['applications'], 'contributor: the read is said partial');
    assert.deepEqual(await contextNames(bcId), ['Seen app'], 'contributor: context');
    assert.deepEqual(await contextPartial(bcId), ['linked_applications'], 'contributor: the context group said partial');
    console.log('  a Business Contributor: their applications, the read said partial: OK');

    // aggregate_entities on tasks grouped by application: the applications the person reads only.
    // A second task, linked only to the application the contributor does not read: it is in no group,
    // and the result says a task outside the groups (or without an application) is not "none".
    const second = await insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids) VALUES ($1, 2, 'Other task', 'open', $2, '[]', '[]', '[]')`,
      [tenantId, bcId]);
    await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3)`, [tenantId, second, unseen]);
    const aggregate = (userId: string) => aggregates.execute(ctx(userId), { entity_type: 'tasks', group_by: 'application', function: 'count' });
    const groups = async (userId: string) => (await aggregate(userId)).groups.map((group: { key: string | null }) => group.key ?? '(none)').sort();
    const partialFields = (result: any) => (result.fields_partial ?? []).map((entry: { field: string }) => entry.field);
    const withheldFields = (result: any) => (result.fields_withheld ?? []).map((entry: { field: string }) => entry.field);
    assert.deepEqual(await groups(adminId), ['Secret app', 'Seen app'], 'full reader: every application group');
    const adminAggregate = await aggregate(adminId);
    assert.deepEqual([partialFields(adminAggregate), withheldFields(adminAggregate)], [[], []], 'full reader: no note on the groups');
    const bcAggregate = await aggregate(bcId);
    // The other task is in no group: its only application is not theirs.
    assert.deepEqual(await groups(bcId), ['Seen app'], 'contributor: the application groups of their participation');
    assert.ok(!JSON.stringify(bcAggregate.groups).includes('Secret'), 'contributor: no unseen application in the groups');
    assert.deepEqual(partialFields(bcAggregate), ['application'], 'contributor: the groups said partial, the group without an application is not "none"');
    console.log('  tasks grouped by application: the applications the person reads, said partial: OK');

    // query_entities on tasks: the same note for the contributor, none for a full reader.
    const list = (userId: string, extra: Record<string, unknown> = {}) => executor.execute(ctx(userId), { entity_type: 'tasks', ...extra });
    const adminList = await list(adminId);
    assert.deepEqual([partialFields(adminList), withheldFields(adminList)], [[], []], 'full reader: no note on the list');
    assert.deepEqual(partialFields(await list(bcId)), ['application'], 'contributor: the list said partial');
    assert.deepEqual(partialFields(await list(bcId, { sort: { field: 'application', direction: 'asc' } })), ['application'], 'contributor: sorted by application, said partial');
    console.log('  tasks listed: the applications column said partial to a contributor: OK');

    // A person who does not read applications: null, and the reason.
    const unread = await detail(readerId);
    assert.equal(unread.data.applications, null, 'no reader of applications: null');
    assert.ok(unread.fields_withheld?.some((entry: { field: string }) => entry.field === 'applications'), 'no reader of applications: withheld, with the reason');
    assert.deepEqual(withheldFields(await list(readerId)), ['application'], 'no reader of applications: the list says the field is withheld');
    const refusedGroup = await aggregate(readerId).then(() => null, (error: any) => error?.getResponse?.() ?? error);
    assert.equal(refusedGroup?.code, 'AI_FIELD_WITHHELD', 'no reader of applications: grouping by application refused with the reason');
    console.log('  a person who does not read applications: withheld, with the reason: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('ai-task-linked-applications.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
