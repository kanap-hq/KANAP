import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// A person who writes tasks but does not read applications (or assets) changes none of their links:
// - an id, linked, existing or unknown, is refused the same way (403 LINKED_MODULE_NOT_READABLE),
//   so the answer says nothing of the id;
// - an empty list (a creation form sends one) changes nothing: the stored links stay;
// - saving another field of the task works, as the screen does it;
// - the assistant refuses the field the same way, and its preview names no linked record.
// A person who reads everything still replaces the links, as before.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'task-link-writes-module-read-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for task-link-writes-module-read.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { TasksController } = require('../../spend/tasks.controller');
  const { AiMutationPreviewService } = require('../../ai/ai-mutation-preview.service');
  const { AiPolicyService } = require('../../ai/ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const tasks = app.get(TasksController);
  const previews = app.get(AiMutationPreviewService);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const slug = `task-link-read-${tenantId.slice(0, 8)}`;
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
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Writer', $4, 'enabled')`,
        [tenantId, `${name}-${tenantId.slice(0, 8)}@example.test`, name, roleId]);
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, roleId]);
      return id;
    };
    const adminRole = await role('Administrator', {});
    const tasksOnly = await role('Task writer', { tasks: 'member', ai_chat: 'member' });
    const adminId = await user('admin', adminRole.id);
    const writerId = await user('writer', tasksOnly.id);

    const linkedApp = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Secret app')`, [tenantId]);
    const otherApp = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Other secret app')`, [tenantId]);
    const asset = await insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Secret server', 'server', 'prod')`, [tenantId]);
    const task = await insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids) VALUES ($1, 1, 'Shared task', 'open', $2, '[]', '[]', '[]')`,
      [tenantId, writerId]);
    await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3)`, [tenantId, task, linkedApp]);
    await runner.query(`INSERT INTO task_assets (tenant_id, task_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, task, asset]);
    const links = async () => ({
      applications: (await runner.query(`SELECT application_id AS id FROM task_applications WHERE tenant_id = $1 AND task_id = $2`, [tenantId, task])).map((r: any) => r.id),
      assets: (await runner.query(`SELECT asset_id AS id FROM task_assets WHERE tenant_id = $1 AND task_id = $2`, [tenantId, task])).map((r: any) => r.id),
    });
    const stored = await links();

    const reqOf = (userId: string, permissions: Record<string, string>, isAdmin = false) => ({
      tenantId, userId, isAdmin, permissions, manager: runner.manager, queryRunner: runner, user: { sub: userId }, tenant: { id: tenantId },
    });
    const writer = reqOf(writerId, tasksOnly.permissions);
    const refusal = async (fn: () => Promise<unknown>) => {
      const error = await fn().then(() => null, (caught: any) => caught);
      return { status: error?.getStatus?.(), code: error?.getResponse?.()?.code, message: String(error?.message) };
    };

    // Every id the same refusal, whatever it names; nothing written.
    const expectedApp = await refusal(() => tasks.updateTask(task, { application_ids: [randomUUID()] }, writer));
    assert.deepEqual([expectedApp.status, expectedApp.code], [403, 'LINKED_MODULE_NOT_READABLE'], 'an unknown application id');
    for (const id of [linkedApp, otherApp]) {
      assert.deepEqual(await refusal(() => tasks.updateTask(task, { application_ids: [id] }, writer)), expectedApp, 'a linked or an existing application id: the same answer');
    }
    const expectedAsset = await refusal(() => tasks.updateTask(task, { asset_ids: [randomUUID()] }, writer));
    assert.deepEqual([expectedAsset.status, expectedAsset.code], [403, 'LINKED_MODULE_NOT_READABLE'], 'an unknown asset id');
    assert.deepEqual(await refusal(() => tasks.updateTask(task, { asset_ids: [asset] }, writer)), expectedAsset, 'a linked asset id: the same answer');
    // An empty list changes nothing.
    await tasks.updateTask(task, { application_ids: [], asset_ids: [] }, writer);
    assert.deepEqual(await links(), stored, 'an empty list keeps the links');
    // Another field saves.
    await tasks.updateTask(task, { title: 'Renamed task' }, writer);
    assert.equal((await runner.query(`SELECT title FROM tasks WHERE id = $1`, [task]))[0].title, 'Renamed task', 'another field saves');
    assert.deepEqual(await links(), stored, 'the links stay');
    console.log('  a person who does not read the module changes none of its links: OK');

    // The assistant: refused the same way, and nothing named.
    const ctx = { tenantId, userId: writerId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager, conversationId: null };
    const kad = await refusal(() => previews.createPreview(ctx, 'update_task_fields', { ref: 'T-1', fields: { applications: ['Secret app'] } }));
    assert.equal(kad.code, 'LINKED_MODULE_NOT_READABLE', 'assistant: refused ' + kad.message);
    assert.ok(!/Secret/.test(kad.message), 'assistant: the refusal names nothing');
    const kadAssets = await refusal(() => previews.createPreview(ctx, 'update_task_fields', { ref: 'T-1', fields: { assets: [] } }));
    assert.equal(kadAssets.code, 'LINKED_MODULE_NOT_READABLE', 'assistant: assets refused, even emptied');
    assert.deepEqual(await links(), stored, 'assistant: nothing written');
    console.log('  the assistant refuses the same way and names nothing: OK');

    // A person who reads everything replaces the links, as before.
    await tasks.updateTask(task, { application_ids: [otherApp], asset_ids: [] }, reqOf(adminId, {}, true));
    assert.deepEqual(await links(), { applications: [otherApp], assets: [] }, 'full reader: the links replaced');
    console.log('  a person who reads everything replaces the links: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('task-link-writes-module-read.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
