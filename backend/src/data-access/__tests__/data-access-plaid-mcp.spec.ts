// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import * as express from 'express';
import { HttpException, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import appDataSource from '../../data-source';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { withTenantExecution } from '../../common/tenant-runner';
import { DATA_ACCESS_READ_ONLY_LINE_MESSAGE } from '../line-write-checks';
import { APP_URL, LIMITED_ROLE, PgClient, connect, roleExists } from './data-access-test-helpers';
import { Label, Seed, seed } from './data-access-line-seed';

process.env.AI_CHAT_ENABLED = 'true';
process.env.AI_SETTINGS_ENABLED = 'true';
process.env.AI_MCP_ENABLED = 'true';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

/**
 * Data-scoped access, lot 4 run 4D (planning/data-scoped-access/spec.md §5.4 last item, §5.6,
 * §10.5): Plaid, MCP, global search and the tasks export, on the reference example of lot 2
 * (`data-access-line-seed.ts`), committed and purged after, every call through the real
 * `AiTenantExecutionService.runWithContext` (the person's access applied in its own transaction).
 *
 * Rita (INF-FR edit, INF read) reads L1 to L4, modifies L1 only; L5, L6 and L7 are out of her
 * access. Ulla (mode all) reads everything: the same call by her shows what Rita's leaves out. An
 * application is linked to L1 and L5; Rita is the assignee of a task of L5.
 *
 * - Plaid reads (query, search, aggregate, detail, context, mention picker, search index): Rita gets
 *   only L1 to L4 and no trace of L5 to L7 (name, id or BL reference anywhere in the answer), not
 *   even on her task of L5 (its object stays a budget line, unnamed); a hidden line by id or BL
 *   reference answers as a missing one.
 * - Plaid writes: a preview of a write on a read-only line (its fields, its relations) is refused
 *   with the lot 3 message; on an editable line it executes; an approval runs in the approver's
 *   access at that time (her edit node removed after the preview: refused). Relation writes from the
 *   application: a hidden line cannot be added (as a missing one), the visible links are the ones
 *   shown and replaced, the hidden link stays, a read-only line can be linked.
 * - MCP (`POST /ai/mcp` behind the real `McpApiKeyAuthGuard` and `AiMcpController`, a personal key
 *   of each person): `query_entities`, `aggregate_entities`, `search_all`, `get_entity_detail` give
 *   what Plaid gives the same person.
 * - Tasks export: Rita's file has her task of L5 without the line's id or name; Ulla's has them.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

let client: PgClient;
let app: INestApplicationContext;
/** The spec's own pool, for the purge: it runs even when the application did not start. */
const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
let s: Seed;
let tag: string;
let applicationId: string;
let projectId: string;
let hiddenTaskId: string;
const itemNumbers = {} as Record<Label, number>;
const conversations: Record<string, string> = {};
const HIDDEN: Label[] = ['L5', 'L6', 'L7'];
const VISIBLE: Label[] = ['L1', 'L2', 'L3', 'L4'];

// ---------------------------------------------------------------------------------------------
// Seed.

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function seedPlaid(): Promise<void> {
  const q = async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows;
  tag = s.tenantId.slice(0, 8);
  await inTenant(async () => {
    await q(
      `UPDATE tenants SET metadata = '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb WHERE id = $1`,
      [s.tenantId],
    );
    const model = (await q(
      `INSERT INTO ai_model_configs (tenant_id, name, provider, model, endpoint_url, api_key_encrypted, supports_vision, is_default, created_at, updated_at)
       VALUES ($1, 'da-4d-model', 'custom', 'da-4d-model', 'https://llm.example.test/v1', 'test-secret', true, true, now(), now()) RETURNING id`,
      [s.tenantId],
    ))[0].id;
    await q(
      `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider, llm_endpoint_url, llm_model,
                                llm_api_key_encrypted, web_search_enabled, glpi_enabled, chat_model_config_id, created_at, updated_at)
       VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1', 'da-4d-model', 'test-secret', false, false, $2, now(), now())`,
      [s.tenantId, model],
    );
    // Rita and Ulla share the role of the seed: the rights are the same, only the access differs.
    const roleId = (await q(`SELECT role_id FROM users WHERE id = $1`, [s.persons.rita]))[0].role_id;
    for (const resource of ['ai_chat', 'ai_mcp', 'budget', 'tasks', 'applications', 'portfolio_projects']) {
      await q(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'member')`, [s.tenantId, roleId, resource]);
    }
    for (const row of await q(`SELECT id, item_number FROM spend_items WHERE tenant_id = $1`, [s.tenantId])) {
      const label = (Object.keys(s.lines) as Label[]).find((l) => s.lines[l] === row.id);
      if (label) itemNumbers[label] = Number(row.item_number);
    }
    applicationId = (await q(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [s.tenantId, `DA 4D application ${tag}`]))[0].id;
    for (const line of [s.lines.L1, s.lines.L5]) {
      await q(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3)`, [s.tenantId, applicationId, line]);
    }
    projectId = (await q(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, 7001) RETURNING id`, [s.tenantId, `DA 4D project ${tag}`]))[0].id;
    for (const line of [s.lines.L1, s.lines.L5]) {
      await q(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3)`, [s.tenantId, projectId, line]);
    }
    hiddenTaskId = (await q(
      `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, assignee_user_id)
       VALUES ($1, $2, 7001, 'spend_item', $3, $4) RETURNING id`,
      [s.tenantId, `DA 4D task ${tag}`, s.lines.L5, s.persons.rita],
    ))[0].id;
    for (const person of [s.persons.rita, s.persons.ulla]) {
      conversations[person] = randomUUID();
      await q(
        `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
         VALUES ($1, $2, $3, 'Data access 4D', 'custom', 'da-4d-model', 'custom', now(), now())`,
        [conversations[person], s.tenantId, person],
      );
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Helpers.

function context(person: string, surface: 'chat' | 'mcp' = 'chat') {
  return {
    tenantId: s.tenantId,
    userId: person,
    isPlatformHost: false,
    surface,
    authMethod: surface === 'chat' ? 'jwt' as const : 'api_key' as const,
    requestId: null,
    aiApiKeyId: null,
    conversationId: conversations[person],
  };
}

/** Runs `fn` as Plaid does: the person's context, in its own transaction with the access applied. */
async function asPerson<T = any>(person: string, fn: (ctx: any) => Promise<T>): Promise<T> {
  const { AiTenantExecutionService } = require('../../ai/execution/ai-tenant-execution.service');
  return (app.get(AiTenantExecutionService) as any).runWithContext(context(person), fn);
}

async function tool(person: string, name: string, input: Record<string, unknown>): Promise<any> {
  const { AiToolRegistry } = require('../../ai/ai-tool.registry');
  return asPerson(person, (ctx) => app.get(AiToolRegistry).execute(ctx, name, input));
}

async function rejection(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected a refusal');
}

/** The traces of a line: its name, its id and its BL reference. */
function tracesOf(label: Label): Array<string | RegExp> {
  return [`DA line ${label} ${tag}`, s.lines[label], new RegExp(`BL-${itemNumbers[label]}(?!\\d)`)];
}

function assertNoTrace(value: unknown, what: string, labels: Label[] = HIDDEN): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const label of labels) {
    for (const trace of tracesOf(label)) {
      const found = typeof trace === 'string' ? text.includes(trace) : trace.test(text);
      assert.ok(!found, `${what}: shows ${label} (${String(trace)})`);
    }
  }
}

function assertShows(value: unknown, label: Label, what: string): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(text.includes(`DA line ${label} ${tag}`), `${what}: ${label} expected`);
}

/** The line labels named in an answer. */
function linesIn(value: unknown): Label[] {
  const text = JSON.stringify(value);
  return (Object.keys(s.lines) as Label[]).filter((label) => text.includes(`DA line ${label} ${tag}`)).sort();
}

/** The same refusal, the record named apart. */
function sameRefusal(a: any, b: any, aRef: string, bRef: string, what: string): void {
  const text = (error: any, ref: string) => String(error?.message ?? error).split(ref).join('<ref>');
  assert.equal(error_status(a), error_status(b), `${what}: status`);
  assert.equal(text(a, aRef), text(b, bRef), `${what}: message`);
}

function error_status(error: any): number | null {
  return error instanceof HttpException ? error.getStatus() : null;
}

function assertReadOnlyRefusal(error: any, what: string): void {
  assert.ok(error instanceof HttpException, `${what}: ${error?.stack ?? error}`);
  assert.equal(error.getStatus(), 403, what);
  assert.equal((error.getResponse() as any)?.code, 'DATA_ACCESS_LIMITED', what);
  assert.equal(error.message, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, what);
}

// ---------------------------------------------------------------------------------------------
// Plaid reads.

async function testPlaidReads(): Promise<void> {
  const { rita, ulla } = s.persons;
  const query = { entity_type: 'spend_items', q: `DA line`, limit: 50 };
  const ritaLines = await tool(rita, 'query_entities', query);
  assert.deepEqual(linesIn(ritaLines), VISIBLE, 'query_entities: Rita lists L1 to L4');
  assert.equal(ritaLines.total, 4, 'query_entities: Rita counts 4 lines');
  assertNoTrace(ritaLines, 'query_entities spend_items (Rita)');
  const ullaLines = await tool(ulla, 'query_entities', query);
  assert.equal(ullaLines.total, 7, 'query_entities: Ulla counts 7 lines');

  const ritaTasks = await tool(rita, 'query_entities', { entity_type: 'tasks', q: `DA 4D task ${tag}` });
  const ritaTask = (ritaTasks.items ?? []).find((item: any) => item.id === hiddenTaskId);
  assert.ok(ritaTask, `query_entities tasks: Rita sees her task of L5 (${JSON.stringify(ritaTasks)})`);
  assert.equal(ritaTask.metadata?.related_label ?? null, null, 'query_entities tasks: the hidden line is not named');
  assertNoTrace(ritaTasks, 'query_entities tasks (Rita)');
  const ullaTasks = await tool(ulla, 'query_entities', { entity_type: 'tasks', q: `DA 4D task ${tag}` });
  assertShows(ullaTasks, 'L5', 'query_entities tasks (Ulla)');

  const ritaSearch = await tool(rita, 'search_all', { query: 'DA line', limit: 100 });
  assert.deepEqual(linesIn(ritaSearch), VISIBLE, 'search_all: Rita finds L1 to L4');
  assertNoTrace(ritaSearch, 'search_all (Rita)');
  assert.deepEqual(linesIn(await tool(ulla, 'search_all', { query: 'DA line', limit: 100 })), [...VISIBLE, ...HIDDEN].sort(), 'search_all: Ulla finds all');
  // The name of a hidden line finds neither the line nor Rita's task of that line (its search entry
  // carries the line's name); the words it shares with visible records find those.
  const byName = await tool(rita, 'search_all', { query: `DA line L5 ${tag}` });
  assertNoTrace(byName, 'search_all by the hidden name (Rita)');
  assert.ok(!(byName.items ?? []).some((item: any) => item.id === hiddenTaskId), 'search_all by the hidden name: not the task of L5');
  const ullaByName = await tool(ulla, 'search_all', { query: `DA line L5 ${tag}` });
  assert.ok((ullaByName.items ?? []).some((item: any) => item.id === s.lines.L5), 'search_all by name: Ulla finds L5');
  const byRef = await tool(rita, 'search_all', { query: `BL-${itemNumbers.L5}` });
  assertNoTrace(byRef, 'search_all by the hidden reference (Rita)');

  const aggregate = { entity_type: 'spend_items', group_by: 'currency', q: 'DA line' };
  const ritaCount = await tool(rita, 'aggregate_entities', aggregate);
  const ullaCount = await tool(ulla, 'aggregate_entities', aggregate);
  assertNoTrace(ritaCount, 'aggregate_entities (Rita)');
  const countOf = (result: any) => (result.groups ?? []).reduce((sum: number, g: any) => sum + Number(g.count ?? g.value ?? 0), 0);
  assert.equal(countOf(ritaCount), 4, `aggregate_entities: Rita counts 4 (${JSON.stringify(ritaCount)})`);
  assert.equal(countOf(ullaCount), 7, `aggregate_entities: Ulla counts 7 (${JSON.stringify(ullaCount)})`);

  const detail = await tool(rita, 'get_entity_detail', { entity_type: 'spend_items', entity_id: s.lines.L1 });
  assertShows(detail, 'L1', 'get_entity_detail L1 (Rita)');
  assertNoTrace(detail, 'get_entity_detail L1 (Rita)');
  const missingId = randomUUID();
  const missing = await rejection(() => tool(rita, 'get_entity_detail', { entity_type: 'spend_items', entity_id: missingId }));
  sameRefusal(
    await rejection(() => tool(rita, 'get_entity_detail', { entity_type: 'spend_items', entity_id: s.lines.L5 })),
    missing, s.lines.L5, missingId, 'get_entity_detail of L5 by id (Rita)',
  );
  const missingRef = await rejection(() => tool(rita, 'get_entity_detail', { entity_type: 'spend_items', entity_id: 'BL-999999' }));
  sameRefusal(
    await rejection(() => tool(rita, 'get_entity_detail', { entity_type: 'spend_items', entity_id: `BL-${itemNumbers.L5}` })),
    missingRef, `BL-${itemNumbers.L5}`, 'BL-999999', 'get_entity_detail of L5 by reference (Rita)',
  );
  assertShows(await tool(ulla, 'get_entity_detail', { entity_type: 'spend_items', entity_id: `BL-${itemNumbers.L5}` }), 'L5', 'get_entity_detail L5 (Ulla)');
  assertNoTrace(await tool(rita, 'get_entity_detail', { entity_type: 'tasks', entity_id: hiddenTaskId }), 'get_entity_detail of the task of L5 (Rita)');

  const appContext = await tool(rita, 'get_entity_context', { entity_type: 'applications', entity_id: applicationId });
  assertNoTrace(appContext, 'get_entity_context of the application (Rita)');
  assertNoTrace(await tool(rita, 'get_entity_detail', { entity_type: 'applications', entity_id: applicationId }), 'get_entity_detail of the application (Rita)');
  const ullaAppContext = await tool(ulla, 'get_entity_context', { entity_type: 'applications', entity_id: applicationId });
  const ullaAppDetail = await tool(ulla, 'get_entity_detail', { entity_type: 'applications', entity_id: applicationId });
  assert.ok(linesIn([ullaAppContext, ullaAppDetail]).includes('L5'), 'the application context or detail names its lines (Ulla)');
  assertNoTrace(await tool(rita, 'get_entity_context', { entity_type: 'tasks', entity_id: hiddenTaskId }), 'get_entity_context of the task of L5 (Rita)');
  const ritaProject = [
    await tool(rita, 'get_entity_detail', { entity_type: 'projects', entity_id: projectId }),
    await tool(rita, 'get_entity_context', { entity_type: 'projects', entity_id: projectId }),
  ];
  assertShows(ritaProject, 'L1', 'the project names its visible line (Rita)');
  assertNoTrace(ritaProject, 'get_entity_detail and get_entity_context of the project (Rita)');
  assertShows([
    await tool(ulla, 'get_entity_detail', { entity_type: 'projects', entity_id: projectId }),
    await tool(ulla, 'get_entity_context', { entity_type: 'projects', entity_id: projectId }),
  ], 'L5', 'the project names its lines (Ulla)');
  console.log('  Plaid reads: query, search, aggregate, detail and context show L1 to L4 only, no trace of L5 to L7: OK');
}

/** The mention picker (`GET /ai/search/entities`) and the search index under the person's access. */
async function testGlobalSearch(): Promise<void> {
  const { rita, ulla } = s.persons;
  const { AiSearchController } = require('../../ai/ai-search.controller');
  const picker = app.get(AiSearchController);
  const req = (person: string) => ({ tenant: { id: s.tenantId }, user: { sub: person }, id: null });
  const ritaPicked = await picker.searchEntities(req(rita), 'DA line');
  assert.deepEqual(linesIn(ritaPicked), VISIBLE, `mention picker: Rita gets L1 to L4 (${JSON.stringify(ritaPicked)})`);
  assertNoTrace(ritaPicked, 'mention picker (Rita)');
  assert.deepEqual(linesIn(await picker.searchEntities(req(ulla), 'DA line')), [...VISIBLE, ...HIDDEN].sort(), 'mention picker: Ulla gets all');
  const recent = await picker.searchEntities(req(rita), '', '50', 'spend_items,tasks');
  assertNoTrace(recent, 'mention picker, recent lines and tasks (Rita)');
  const pickedByName = await picker.searchEntities(req(rita), `DA line L5 ${tag}`);
  assertNoTrace(pickedByName, 'mention picker by the hidden name (Rita)');
  assert.ok(!pickedByName.items.some((item: any) => item.id === hiddenTaskId), 'mention picker by the hidden name: not the task of L5');
  assertNoTrace(await picker.searchEntities(req(rita), `BL-${itemNumbers.L5}`), 'mention picker by the hidden reference (Rita)');

  const entries = (person: string) => asPerson<any[]>(person, (ctx) => ctx.manager.query(
    `SELECT entity_type, entity_id::text AS id FROM search_index WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[]) ORDER BY 1, 2`,
    [s.tenantId, [...HIDDEN.map((l) => s.lines[l]), hiddenTaskId]],
  ));
  assert.deepEqual(await entries(rita), [], 'search index: no entry of L5 to L7 nor of the task of L5 for Rita');
  const ullaEntries = await entries(ulla);
  assert.ok(ullaEntries.some((row: any) => row.id === hiddenTaskId) && ullaEntries.some((row: any) => row.id === s.lines.L5), 'search index: Ulla has them');
  console.log('  global search: the mention picker and the search index hold no entry of a hidden line or of its task: OK');
}

// ---------------------------------------------------------------------------------------------
// Plaid writes.

async function preview(person: string, name: string, input: Record<string, unknown>): Promise<any> {
  const result = await tool(person, name, input);
  assert.equal(result?.status, 'pending', `${name}: a pending preview expected (${JSON.stringify(result)})`);
  return result;
}

async function approve(person: string, previewId: string): Promise<any> {
  const { AiMutationPreviewService } = require('../../ai/ai-mutation-preview.service');
  return asPerson(person, (ctx) => app.get(AiMutationPreviewService).executePreview(ctx, previewId));
}

async function linkedLines(): Promise<Label[]> {
  const rows = await inTenant(() => client.query(
    `SELECT spend_item_id FROM application_spend_items WHERE tenant_id = $1 AND application_id = $2`, [s.tenantId, applicationId],
  ));
  return rows.rows.map((row: any) => (Object.keys(s.lines) as Label[]).find((l) => s.lines[l] === row.spend_item_id)!).sort();
}

async function testPlaidWrites(): Promise<void> {
  const { rita } = s.persons;
  // A read-only line (L3): refused when the preview is asked, its fields and its relations.
  assertReadOnlyRefusal(
    await rejection(() => tool(rita, 'update_business_record', { entity_type: 'spend_items', ref: s.lines.L3, fields: { notes: 'Never written' } })),
    'update_business_record on read-only L3',
  );
  assertReadOnlyRefusal(
    await rejection(() => tool(rita, 'update_entity_relations', { entity_type: 'spend_items', ref: s.lines.L3, relation: 'applications', add: [applicationId] })),
    'update_entity_relations from read-only L3',
  );
  // A hidden line answers as a missing one.
  const missingId = randomUUID();
  sameRefusal(
    await rejection(() => tool(rita, 'update_business_record', { entity_type: 'spend_items', ref: s.lines.L5, fields: { notes: 'Never written' } })),
    await rejection(() => tool(rita, 'update_business_record', { entity_type: 'spend_items', ref: missingId, fields: { notes: 'Never written' } })),
    s.lines.L5, missingId, 'update_business_record on hidden L5',
  );

  // An editable line (L1): previewed, approved, written.
  const notes = await preview(rita, 'update_business_record', { entity_type: 'spend_items', ref: s.lines.L1, fields: { notes: `Rita ${tag}` } });
  assert.equal((await approve(rita, notes.preview_id)).status, 'executed', 'update of L1 executed');
  const written = await inTenant(() => client.query(`SELECT notes FROM spend_items WHERE id = $1`, [s.lines.L1]));
  assert.equal(written.rows[0].notes, `Rita ${tag}`, 'L1 written');

  // The approval runs in the approver's access at that time: her edit node removed, refused.
  const later = await preview(rita, 'update_business_record', { entity_type: 'spend_items', ref: s.lines.L1, fields: { notes: `Later ${tag}` } });
  await inTenant(() => client.query(
    `DELETE FROM user_data_access_nodes WHERE tenant_id = $1 AND user_id = $2 AND cost_center_id = $3 AND access = 'edit'`,
    [s.tenantId, rita, s.infFr],
  ));
  try {
    const refused = await approve(rita, later.preview_id).catch((error) => error);
    if (refused instanceof HttpException) assertReadOnlyRefusal(refused, 'approval after the access shrank');
    else {
      assert.notEqual(refused?.status, 'executed', `approval after the access shrank: ${JSON.stringify(refused)}`);
      assert.equal(refused?.error_message, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, 'approval after the access shrank: the lot 3 message');
    }
    const kept = await inTenant(() => client.query(`SELECT notes FROM spend_items WHERE id = $1`, [s.lines.L1]));
    assert.equal(kept.rows[0].notes, `Rita ${tag}`, 'L1 not written by the refused approval');
  } finally {
    await inTenant(() => client.query(
      `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, cost_center_id, access) VALUES ($1, $2, 'cost_center', $3, 'edit')`,
      [s.tenantId, rita, s.infFr],
    ));
  }
  console.log('  Plaid line writes: read-only refused at the preview (lot 3 message), hidden as missing, approval in the approver\'s access: OK');
}

async function testPlaidRelationWrites(): Promise<void> {
  const { rita, ulla } = s.persons;
  const relation = (extra: Record<string, unknown>) => ({ entity_type: 'applications', ref: applicationId, relation: 'spend_items', ...extra });
  // A hidden line cannot be linked: refused as a missing one.
  const missingId = randomUUID();
  sameRefusal(
    await rejection(() => tool(rita, 'update_entity_relations', relation({ add: [s.lines.L5] }))),
    await rejection(() => tool(rita, 'update_entity_relations', relation({ add: [missingId] }))),
    s.lines.L5, missingId, 'linking hidden L5',
  );
  sameRefusal(
    await rejection(() => tool(rita, 'update_entity_relations', relation({ remove: [s.lines.L5] }))),
    await rejection(() => tool(rita, 'update_entity_relations', relation({ remove: [missingId] }))),
    s.lines.L5, missingId, 'unlinking hidden L5',
  );
  // Removing L1: the preview shows the visible links only; the hidden link to L5 stays.
  const removal = await preview(rita, 'update_entity_relations', relation({ remove: [s.lines.L1] }));
  assertNoTrace(removal, 'relation preview (Rita)');
  assert.equal((await approve(rita, removal.preview_id)).status, 'executed', 'removal of L1 executed');
  assert.deepEqual(await linkedLines(), ['L5'], 'the hidden link to L5 stays');
  // A line read in the access (L3, read only) can be linked from the application (spec §5.4).
  const addition = await preview(rita, 'update_entity_relations', relation({ add: [s.lines.L3] }));
  assertNoTrace(addition, 'relation preview, addition (Rita)');
  assert.equal((await approve(rita, addition.preview_id)).status, 'executed', 'link to read-only L3 executed');
  assert.deepEqual(await linkedLines(), ['L3', 'L5'], 'L3 linked, L5 kept');
  // Ulla sees both links in a preview of her own.
  const ullaPreview = await preview(ulla, 'update_entity_relations', relation({ add: [s.lines.L1] }));
  assertShows(ullaPreview, 'L5', 'relation preview (Ulla)');
  assert.equal((await approve(ulla, ullaPreview.preview_id)).status, 'executed', 'Ulla links L1 back');
  assert.deepEqual(await linkedLines(), ['L1', 'L3', 'L5'], 'Ulla: L1 linked, the rest kept');
  console.log('  Plaid relation writes: hidden line refused as missing, visible links replaced, hidden link kept: OK');
}

// ---------------------------------------------------------------------------------------------
// MCP.

async function createKey(person: string): Promise<string> {
  const { AiApiKeysService } = require('../../ai/ai-api-keys.service');
  const { AiTenantExecutionService } = require('../../ai/execution/ai-tenant-execution.service');
  const created = await app.get(AiTenantExecutionService).run(s.tenantId, (manager: any) =>
    app.get(AiApiKeysService).createKey({ tenantId: s.tenantId, userId: person, label: 'Data access 4D', createdByUserId: person }, { manager }));
  return created.key;
}

async function withMcpServer(fn: (url: string) => Promise<void>): Promise<void> {
  const { AiMcpController } = require('../../ai/ai-mcp.controller');
  const { McpApiKeyAuthGuard } = require('../../ai/auth/mcp-api-key-auth.guard');
  const { AiApiKeysService } = require('../../ai/ai-api-keys.service');
  const { AiTenantExecutionService } = require('../../ai/execution/ai-tenant-execution.service');
  const { McpOAuthService } = require('../../ai/oauth/mcp-oauth.service');
  const controller = app.get(AiMcpController, { strict: false });
  const guard = new McpApiKeyAuthGuard(
    app.get(AiApiKeysService, { strict: false }),
    app.get(AiTenantExecutionService, { strict: false }),
    app.get(McpOAuthService, { strict: false }),
  );
  const server = (express as any)();
  server.use((express as any).json());
  server.post('/ai/mcp', (req: any, res: any, next: any) => {
    req.tenant = { id: s.tenantId };
    const http = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
    guard.canActivate(http).then(() => controller.handlePost(req, res)).catch(next);
  });
  server.use((error: any, _req: any, res: any, _next: any) => {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    res.status(status).json(error instanceof HttpException ? error.getResponse() : { message: String(error) });
  });
  const listening = server.listen(0);
  await new Promise((resolve) => listening.once('listening', resolve));
  try {
    await fn(`http://127.0.0.1:${(listening.address() as AddressInfo).port}/ai/mcp`);
  } finally {
    await new Promise((resolve) => listening.close(resolve));
  }
}

let rpcId = 1;
async function mcpCall(url: string, key: string, name: string, args: Record<string, unknown>): Promise<{ error: string | null; result: any }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `MCP ${name}: ${text}`);
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  const reply = JSON.parse(data ? data.slice('data: '.length) : text);
  assert.equal(reply.error, undefined, `MCP ${name}: ${JSON.stringify(reply.error)}`);
  const content = reply.result.content[0].text;
  return reply.result.isError ? { error: content, result: null } : { error: null, result: JSON.parse(content) };
}

/** The records an answer names, by id, in order: what MCP and Plaid must agree on. */
function idsIn(value: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (key === 'id' && typeof child === 'string') out.push(child);
        else walk(child);
      }
    }
  };
  walk(value);
  return out;
}

async function testMcp(): Promise<void> {
  const { rita, ulla } = s.persons;
  const keys = { [rita]: await createKey(rita), [ulla]: await createKey(ulla) };
  const calls: Array<[string, Record<string, unknown>]> = [
    ['query_entities', { entity_type: 'spend_items', q: 'DA line', limit: 50 }],
    ['query_entities', { entity_type: 'tasks', q: `DA 4D task ${tag}` }],
    ['aggregate_entities', { entity_type: 'spend_items', group_by: 'currency', q: 'DA line' }],
    ['search_all', { query: 'DA line', limit: 100 }],
    ['search_all', { query: `DA line L5 ${tag}` }],
    ['get_entity_detail', { entity_type: 'spend_items', entity_id: s.lines.L1 }],
    ['get_entity_detail', { entity_type: 'tasks', entity_id: hiddenTaskId }],
  ];
  await withMcpServer(async (url) => {
    for (const [name, args] of calls) {
      const what = `MCP ${name} ${JSON.stringify(args)}`;
      const ritaMcp = await mcpCall(url, keys[rita], name, args);
      assert.equal(ritaMcp.error, null, `${what} (Rita): ${ritaMcp.error}`);
      assertNoTrace(ritaMcp.result, `${what} (Rita)`);
      const ritaPlaid = await tool(rita, name, args);
      assert.deepEqual(idsIn(ritaMcp.result), idsIn(ritaPlaid), `${what}: the records Plaid gives Rita`);
      assert.deepEqual(linesIn(ritaMcp.result), linesIn(ritaPlaid), `${what}: the lines Plaid gives Rita`);
      const ullaMcp = await mcpCall(url, keys[ulla], name, args);
      assert.deepEqual(idsIn(ullaMcp.result), idsIn(await tool(ulla, name, args)), `${what}: the records Plaid gives Ulla`);
    }
    assert.deepEqual(linesIn((await mcpCall(url, keys[rita], 'query_entities', calls[0][1])).result), VISIBLE, 'MCP query_entities: Rita lists L1 to L4');
    assert.equal(linesIn((await mcpCall(url, keys[ulla], 'query_entities', calls[0][1])).result).length, 7, 'MCP query_entities: Ulla lists 7');
    // A hidden line answers as a missing one.
    const missingId = randomUUID();
    const hidden = await mcpCall(url, keys[rita], 'get_entity_detail', { entity_type: 'spend_items', entity_id: s.lines.L5 });
    const missing = await mcpCall(url, keys[rita], 'get_entity_detail', { entity_type: 'spend_items', entity_id: missingId });
    assert.ok(hidden.error && missing.error, 'MCP get_entity_detail of L5: refused');
    assert.equal(hidden.error!.split(s.lines.L5).join('<ref>'), missing.error!.split(missingId).join('<ref>'), 'MCP get_entity_detail of L5: as a missing line');
  });
  console.log('  MCP: query_entities, aggregate_entities, search_all and get_entity_detail through the key guard give what Plaid gives: OK');
}

// ---------------------------------------------------------------------------------------------
// Tasks export.

async function testTasksExport(): Promise<void> {
  const { rita, ulla } = s.persons;
  const { TasksCsvService } = require('../../tasks/tasks-csv.service');
  const csv = app.get(TasksCsvService, { strict: false });
  const file = (person: string) => asPerson<any>(person, (ctx) => csv.export({ manager: ctx.manager, tenantId: s.tenantId, language: 'en', scope: 'data' }));
  const ritaFile = (await file(rita)).content as string;
  assert.ok(ritaFile.includes(`DA 4D task ${tag}`), 'tasks export: Rita\'s file has her task of L5');
  assertNoTrace(ritaFile, 'tasks export (Rita)');
  const ullaFile = (await file(ulla)).content as string;
  assert.ok(ullaFile.includes(s.lines.L5) && ullaFile.includes(`DA line L5 ${tag}`), 'tasks export: Ulla\'s file names L5');
  console.log('  tasks export: a task of a hidden line exports without the line: OK');
}

// ---------------------------------------------------------------------------------------------
// Run.

async function cleanup(): Promise<void> {
  if (!s) return;
  await withTenantExecution(dataSource, s.tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
    .catch((error) => console.error(`could not purge ${s.tenantId}:`, error));
  await client.query(`DELETE FROM tenants WHERE id = $1`, [s.tenantId])
    .catch((error: unknown) => console.error(`could not delete ${s.tenantId}:`, error));
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  await dataSource.initialize();
  try {
    const hasRole = await roleExists(client);
    console.log(`data access Plaid, MCP, search and exports (role ${hasRole ? 'installed' : 'absent'})`);
    if (!hasRole) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log('data access Plaid, MCP, search and exports: role absent, skipped');
      return;
    }
    await client.query(`SELECT data_access_sync_policies()`);
    await client.query('BEGIN');
    try {
      s = await seed(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    const { AppModule } = require('../../app.module');
    app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
    await seedPlaid();
    await testPlaidReads();
    await testGlobalSearch();
    await testPlaidWrites();
    await testPlaidRelationWrites();
    await testMcp();
    await testTasksExport();
    console.log('data access Plaid, MCP, search and exports: all scenarios passed');
  } finally {
    try {
      await cleanup();
    } finally {
      if (app) await app.close();
      await dataSource.destroy();
      await client.end();
    }
  }
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
