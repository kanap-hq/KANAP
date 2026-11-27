import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Kad and the MCP server read which entry of the technology catalog a technology was adopted
// from: `catalog_entry`, the entry's name as the catalog screen shows it, on the list, the detail
// and the search results of a technology with a catalog key; nothing on a technology typed by
// hand, and never the raw key. The name filter, the quick search and the global search find an
// adopted and renamed technology by the name of its entry. The field follows the technology read:
// a person who cannot read the infrastructure gets nothing of it, and another workspace's
// technologies are never listed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-technology-catalog-entry-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const ENTRY = 'SUSE Linux Enterprise Server';
const KEY = 'sles';
const RENAMED = 'Linux SUSE du siège';
const TYPED = 'SUSE Linux Enterprise';
const OTHER = 'Other workspace SLES';

type Harness = { app: any; dataSource: DataSource; executor: any; entities: any; tools: any };
type Seed = { tenantId: string; users: { reader: string; appsOnly: string } };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-technology-catalog-entry.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiEntityService } = require('../ai-entity.service');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The surface checks (tenant AI settings, provider, subscription) are not what this spec tests.
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return {
    app,
    dataSource: app.get(DataSource),
    executor: app.get(AiQueryExecutor),
    entities: app.get(AiEntityService),
    tools: app.get(AiToolRegistry),
  };
}

async function useTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenantRow(runner: QueryRunner, tenantId: string, slug: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await seedTenantRow(runner, tenantId, `ai-cat-entry-${tag}`);
  await seedTenantRow(runner, otherTenantId, `ai-cat-entry-other-${tag}`);

  // The same entry adopted in another workspace, under the same reference: never seen from here.
  await useTenant(runner, otherTenantId);
  await runner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle, catalog_key)
     VALUES ($1, 19, $2, 'operating_system', 'on_prem', 'active', $3)`,
    [otherTenantId, OTHER, KEY],
  );

  await useTenant(runner, tenantId);
  const role = async (name: string, permissions: string[]) => {
    const rows = await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2) RETURNING id`, [tenantId, name]);
    for (const resource of permissions) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, rows[0].id, resource]);
    }
    return rows[0].id as string;
  };
  const user = async (key: string, roleId: string) => (await runner.query(
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled') RETURNING id`,
    [tenantId, `${key}-${tag}@example.test`, key, roleId],
  ))[0].id as string;
  const users = {
    reader: await user('Reader', await role('Infrastructure reader', ['infrastructure'])),
    appsOnly: await user('AppsOnly', await role('Applications only', ['applications'])),
  };
  // Typed by hand under a close name, and the catalog entry adopted then renamed.
  await runner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family, editor, hosting_type, lifecycle)
     VALUES ($1, 4, $2, 'operating_system', 'SUSE', 'on_prem', 'active')`,
    [tenantId, TYPED],
  );
  await runner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family, editor, hosting_type, lifecycle, catalog_key)
     VALUES ($1, 19, $2, 'operating_system', 'SUSE', 'on_prem', 'active', $3)`,
    [tenantId, RENAMED, KEY],
  );
  return { tenantId, users };
}

function ctx(runner: QueryRunner, s: Seed, user: keyof Seed['users'], surface: 'mcp' | 'chat' = 'mcp') {
  return {
    tenantId: s.tenantId,
    userId: s.users[user],
    isPlatformHost: false,
    surface,
    authMethod: surface === 'mcp' ? 'api_key' as const : 'jwt' as const,
    manager: runner.manager,
  };
}

async function rejects(runner: QueryRunner, fn: () => Promise<unknown>, pattern: RegExp, label: string) {
  await runner.query('SAVEPOINT expected_failure');
  try {
    await fn();
    assert.fail(`${label}: should fail`);
  } catch (error: any) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    assert.match(String(error?.message ?? error), pattern, label);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

const byRef = (items: any[]) => new Map(items.map((item: any) => [item.ref, item]));

/** The raw key never reaches the model as a value. */
function assertNoRawKey(value: unknown, label: string) {
  assert.equal(JSON.stringify(value).includes(`"${KEY}"`), false, `${label}: no raw catalog key`);
}

/** The list, through the executor and through query_entities on the MCP surface. */
async function testList(harness: Harness, runner: QueryRunner, s: Seed) {
  const listed = await harness.executor.execute(ctx(runner, s, 'reader'), { entity_type: 'technologies' });
  const items = byRef(listed.items);
  assert.equal(items.get('TEC-19')?.label, RENAMED);
  assert.equal(items.get('TEC-19')?.metadata?.catalog_entry, ENTRY, 'the adopted technology names its catalog entry');
  assert.equal('catalog_entry' in (items.get('TEC-4')?.metadata ?? {}), false, 'a typed technology carries nothing');
  assertNoRawKey(listed, 'list');

  const viaTool = await harness.tools.execute(ctx(runner, s, 'reader'), 'query_entities', { entity_type: 'technologies' });
  assert.equal(byRef(viaTool.items).get('TEC-19')?.metadata?.catalog_entry, ENTRY, 'the MCP tool reads the same field');
  assertNoRawKey(viaTool, 'MCP list');
}

/** The detail, through the executor and through get_entity_detail on the MCP surface. */
async function testDetail(harness: Harness, runner: QueryRunner, s: Seed) {
  const detail = await harness.executor.executeDetail(ctx(runner, s, 'reader'), { entity_type: 'technologies', entity_id: 'TEC-19' });
  assert.equal(detail.data.name, RENAMED);
  assert.equal(detail.data.catalog_entry, ENTRY, 'the detail names the catalog entry');
  assert.equal(detail.entity.metadata.catalog_entry, ENTRY);
  assertNoRawKey(detail, 'detail');
  const typed = await harness.executor.executeDetail(ctx(runner, s, 'reader'), { entity_type: 'technologies', entity_id: 'TEC-4' });
  assert.equal('catalog_entry' in typed.data, false, 'a typed technology carries nothing');
  const viaTool = await harness.tools.execute(ctx(runner, s, 'reader'), 'get_entity_detail', { entity_type: 'technologies', entity_id: 'TEC-19' });
  assert.equal(viaTool.data.catalog_entry, ENTRY, 'the MCP tool reads the same field');
}

/** The name filter and the quick search find the renamed technology by its entry's name. */
async function testNameFilterAndQuickSearch(harness: Harness, runner: QueryRunner, s: Seed) {
  const byName = await harness.executor.execute(ctx(runner, s, 'reader'), { entity_type: 'technologies', filters: { name: ENTRY } });
  assert.deepEqual(byName.items.map((item: any) => item.ref), ['TEC-19'], 'name filter on the entry name');
  assert.equal(byName.items[0].metadata.catalog_entry, ENTRY);
  const lower = await harness.executor.execute(ctx(runner, s, 'reader'), { entity_type: 'technologies', filters: { name: ENTRY.toLowerCase() } });
  assert.deepEqual(lower.items.map((item: any) => item.ref), ['TEC-19'], 'without case');
  const byQ = await harness.executor.execute(ctx(runner, s, 'reader'), { entity_type: 'technologies', q: ENTRY });
  assert.deepEqual(byQ.items.map((item: any) => item.ref), ['TEC-19'], 'quick search on the entry name');
  const close = await harness.executor.execute(ctx(runner, s, 'reader'), { entity_type: 'technologies', filters: { name: 'SUSE Linux' } });
  assert.deepEqual(close.items.map((item: any) => item.ref).sort(), ['TEC-19', 'TEC-4'], 'both, the adopted one named by its entry');
}

/** The global search, through the entity service and through search_all on the MCP surface. */
async function testGlobalSearch(harness: Harness, runner: QueryRunner, s: Seed) {
  for (const input of [{ query: ENTRY }, { query: ENTRY, entity_types: ['technologies'] }]) {
    const found = await harness.entities.searchAll(ctx(runner, s, 'reader'), input);
    const hit = byRef(found.items).get('TEC-19');
    assert.equal(hit?.label, RENAMED, `${JSON.stringify(input)}: the renamed technology is found by its entry name`);
    assert.equal(hit?.metadata?.catalog_entry, ENTRY, `${JSON.stringify(input)}: and carries the entry name`);
    const typed = byRef(found.items).get('TEC-4');
    if (typed) assert.equal('catalog_entry' in (typed.metadata ?? {}), false, 'a typed technology carries nothing');
    assertNoRawKey(found, 'search');
    assert.equal(JSON.stringify(found).includes(OTHER), false, 'another workspace is never searched');
  }
  const viaTool = await harness.tools.execute(ctx(runner, s, 'reader'), 'search_all', { query: ENTRY });
  assert.equal(byRef(viaTool.items).get('TEC-19')?.metadata?.catalog_entry, ENTRY, 'the MCP tool reads the same field');
}

/** Without the infrastructure right: refused, and the search names no technology. */
async function testWithoutTheRight(harness: Harness, runner: QueryRunner, s: Seed) {
  // The right is checked where the tools run, on the chat and the MCP surface alike.
  for (const surface of ['mcp', 'chat'] as const) {
    const call = (tool: string, input: Record<string, unknown>) => harness.tools.execute(ctx(runner, s, 'appsOnly', surface), tool, input);
    await rejects(runner, () => call('query_entities', { entity_type: 'technologies', filters: { name: ENTRY } }),
      /infrastructure/, `${surface}: list without the right`);
    await rejects(runner, () => call('get_entity_detail', { entity_type: 'technologies', entity_id: 'TEC-19' }),
      /infrastructure/, `${surface}: detail without the right`);
    const found = await call('search_all', { query: ENTRY }) as any;
    const text = JSON.stringify(found.items);
    assert.equal(found.items.some((item: any) => item.type === 'technologies'), false, `${surface}: no technology in the search`);
    assert.equal(text.includes(RENAMED) || text.includes('TEC-19') || text.includes('catalog_entry'), false, text);
  }
}

/** Another workspace's adoption of the same entry is never read from here. */
async function testOtherWorkspace(harness: Harness, runner: QueryRunner, s: Seed) {
  const listed = await harness.executor.execute(ctx(runner, s, 'reader'), { entity_type: 'technologies', filters: { name: ENTRY } });
  assert.equal(listed.total, 1);
  assert.equal(JSON.stringify(listed).includes(OTHER), false);
}

async function run() {
  const harness = await createHarness();
  const tests = [
    ['list', testList],
    ['detail', testDetail],
    ['name filter and quick search', testNameFilterAndQuickSearch],
    ['global search', testGlobalSearch],
    ['without the right', testWithoutTheRight],
    ['other workspace', testOtherWorkspace],
  ] as const;
  let failed = 0;
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      for (const [name, test] of tests) {
        await runner.query('SAVEPOINT catalog_entry_test');
        try {
          await test(harness, runner, s);
          await runner.query('RELEASE SAVEPOINT catalog_entry_test');
          console.log(`PASS ${name}`);
        } catch (error) {
          failed += 1;
          await runner.query('ROLLBACK TO SAVEPOINT catalog_entry_test');
          console.log(`FAIL ${name}`);
          console.log(error instanceof Error ? error.stack ?? error.message : String(error));
        }
      }
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void run();
