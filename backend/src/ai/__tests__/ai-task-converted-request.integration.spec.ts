import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// What the assistant reads of a task converted into a request, a task of a project and a task of a
// contract (get_entity_detail, query_entities and get_entity_context; Plaid and MCP):
// - a person who reads the request: its id and number on the detail, its reference and name in the
//   context, nothing said;
// - a person who does not read the request (no read of Requests, or a Business Contributor outside
//   its participation): the task reads as converted, and `fields_withheld` says so, so that the
//   answer never reads "not converted"; the whole answer holds neither the request's id, nor its
//   reference, nor its name, and no empty request field;
// - a task of a project the person does not read: the project is said withheld, its name absent;
// - a task of a contract the person does not read: it keeps its type, without the contract's id or name.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-task-converted-request-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const REQUEST = 'Hidden converted request';
const PROJECT = 'Hidden linked project';
const CONTRACT = 'Hidden linked contract';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

const fieldsOf = (list: Array<{ field: string }> | undefined) => (list ?? []).map((entry) => entry.field);

function hasNot(value: unknown, needles: string[], label: string) {
  const text = JSON.stringify(value);
  for (const needle of needles) assert.ok(!text.includes(needle), `${label}: "${needle}" must not appear`);
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-task-converted-request.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiEntityService } = require('../ai-entity.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The surface checks (tenant AI settings, provider, subscription) are not what this spec tests.
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const executor = app.get(AiQueryExecutor);
  const entities = app.get(AiEntityService);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const tag = tenantId.slice(0, 8);
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `ai-task-converted-${tag}`, `ai-task-converted-${tag}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const user = async (name: string, roleName: string, permissions: Record<string, string>) => {
      const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2)`, [tenantId, roleName]);
      for (const [resource, level] of Object.entries(permissions)) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
      }
      const id = await insertId(runner,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
        [tenantId, `${name}-${tag}@example.test`, name, roleId]);
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, roleId]);
      return id;
    };
    const users = {
      full: await user('full', 'Administrator', {}),
      requests: await user('requests', 'Tasks and requests', { tasks: 'reader', portfolio_requests: 'reader' }),
      tasks: await user('tasks', 'Tasks only', { tasks: 'reader' }),
      contributor: await user('contributor', 'Business Contributor', { tasks: 'contributor', portfolio_requests: 'contributor', portfolio_projects: 'contributor' }),
    };

    const company = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Company', 'FR', 'Paris')`, [tenantId]);
    const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier')`, [tenantId]);
    const contract = await insertId(runner,
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, '2026-01-01')`,
      [tenantId, CONTRACT, company, supplier]);
    const project = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, 4)`, [tenantId, PROJECT]);
    // Every task is the contributor's (assigned): the project and the request are outside their participation.
    const task = (itemNumber: number, title: string, type: string | null, related: string | null) => insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, description, status, related_object_type, related_object_id, labels, owner_ids, viewer_ids, assignee_user_id)
       VALUES ($1, $2, $3, '', 'open', $4, $5, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $6)`,
      [tenantId, itemNumber, title, type, related, users.contributor]);
    const convertedTask = await task(1, 'Converted task', null, null);
    await task(2, 'Project task', 'project', project);
    await task(3, 'Contract task', 'contract', contract);
    const request = await insertId(runner,
      `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, criteria_values, feasibility_review, priority_override, origin_task_id)
       VALUES ($1, 7, $2, 'approved', '{}'::jsonb, '{}'::jsonb, false, $3)`, [tenantId, REQUEST, convertedTask]);
    const requestTrace = [request, 'REQ-7', REQUEST];

    for (const surface of ['chat', 'mcp'] as const) {
      const ctx = (userId: string) => ({
        tenantId, userId, isPlatformHost: false, surface, authMethod: surface === 'mcp' ? 'api_key' as const : 'session' as const, manager: runner.manager,
      });
      const detail = (userId: string, ref: string) => executor.executeDetail(ctx(userId), { entity_type: 'tasks', entity_id: ref });
      const context = (userId: string, ref: string) => entities.getEntityContext(ctx(userId), { entity_type: 'tasks', entity_id: ref });
      const list = (userId: string) => executor.execute(ctx(userId), { entity_type: 'tasks' });

      // A person who reads the request: the detail gives its id and number, the context its
      // reference and name, and nothing is said withheld.
      for (const profile of ['full', 'requests'] as const) {
        const shown = await detail(users[profile], 'T-1');
        assert.equal(shown.data.converted_request_id, request, `${profile} (${surface}): the request id`);
        assert.equal(shown.data.converted_request_item_number, 7, `${profile} (${surface}): the request number`);
        assert.equal(shown.data.converted_request_hidden, undefined, `${profile} (${surface}): the request is not hidden`);
        assert.ok(!fieldsOf(shown.fields_withheld).includes('converted_request'), `${profile} (${surface}): nothing withheld of the request`);
        const shownContext = await context(users[profile], 'T-1');
        const group = shownContext.related.find((entry: { relation: string }) => entry.relation === 'converted_request');
        assert.equal(group?.items?.[0]?.label, REQUEST, `${profile} (${surface}): the context names the request`);
        assert.ok(JSON.stringify(group).includes('REQ-7'), `${profile} (${surface}): the context gives the request reference`);
        assert.ok(!fieldsOf((shownContext as any).fields_withheld).includes('converted_request'), `${profile} (${surface}): the context withholds nothing`);
      }
      console.log(`  (${surface}) a person who reads the request: its reference and name: OK`);

      // A person who does not read the request: converted, said withheld, nothing of the request.
      for (const profile of ['tasks', 'contributor'] as const) {
        const hidden = await detail(users[profile], 'T-1');
        assert.equal(hidden.data.converted_request_hidden, true, `${profile} (${surface}): the task reads as converted`);
        assert.ok(!('converted_request_id' in hidden.data), `${profile} (${surface}): no empty request id`);
        assert.ok(!('converted_request_item_number' in hidden.data), `${profile} (${surface}): no empty request number`);
        const note = (hidden.fields_withheld ?? []).find((entry: { field: string }) => entry.field === 'converted_request');
        assert.ok(note, `${profile} (${surface}): the detail says the request is withheld`);
        assert.match(note.reason, /was converted into a request/, `${profile} (${surface}): the note says the task is converted`);
        assert.match(note.reason, /never say that the task is not converted/, `${profile} (${surface}): the note forbids "not converted"`);
        hasNot(hidden, requestTrace, `${profile} (${surface}), task detail`);

        const hiddenContext = await context(users[profile], 'T-1');
        assert.ok(!hiddenContext.related.some((entry: { relation: string }) => entry.relation === 'converted_request'), `${profile} (${surface}): no request group`);
        const contextNote = ((hiddenContext as any).fields_withheld ?? []).find((entry: { field: string }) => entry.field === 'converted_request');
        assert.ok(contextNote, `${profile} (${surface}): the context says the request is withheld`);
        assert.equal(contextNote.reason, note.reason, `${profile} (${surface}): the same note on the context`);
        hasNot(hiddenContext, requestTrace, `${profile} (${surface}), task context`);

        const listed = await list(users[profile]);
        assert.equal(listed.total, 3, `${profile} (${surface}): every task listed`);
        hasNot(listed, [...requestTrace, PROJECT, project, CONTRACT, contract], `${profile} (${surface}), task list`);

        // The two neighbours: the project and the contract the person does not read.
        const projectTask = await detail(users[profile], 'T-2');
        assert.ok(fieldsOf(projectTask.fields_withheld).includes('project'), `${profile} (${surface}): the project is said withheld`);
        assert.ok(!fieldsOf(projectTask.fields_withheld).includes('converted_request'), `${profile} (${surface}): an unconverted task says nothing of a request`);
        assert.equal(projectTask.data.related_object_type, 'project', `${profile} (${surface}): the task keeps its project type`);
        hasNot(projectTask, [PROJECT, project], `${profile} (${surface}), project task detail`);
        const contractTask = await detail(users[profile], 'T-3');
        assert.equal(contractTask.data.related_object_type, 'contract', `${profile} (${surface}): the task keeps its contract type`);
        assert.deepEqual([contractTask.data.related_object_id, contractTask.data.related_object_name], [null, null], `${profile} (${surface}): no contract id or name`);
        assert.ok(!fieldsOf(contractTask.fields_withheld).includes('converted_request'), `${profile} (${surface}): nothing said of a request`);
        hasNot(contractTask, [CONTRACT, contract], `${profile} (${surface}), contract task detail`);
      }
      console.log(`  (${surface}) a person who does not read the request: converted, said withheld, nothing of it: OK`);

      // The full reader: the project and the contract are named.
      assert.ok(JSON.stringify(await detail(users.full, 'T-2')).includes(PROJECT), `full (${surface}): the project name`);
      assert.ok(JSON.stringify(await detail(users.full, 'T-3')).includes(CONTRACT), `full (${surface}): the contract name`);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('ai-task-converted-request.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
