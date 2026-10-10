import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BudgetLineNature1853950000000 as Migration } from '../../migrations/1853950000000-budget-line-nature';
import { SearchIndexAnalyticsValues1853940000000 as SearchIndexMigration } from '../../migrations/1853940000000-search-index-analytics-values';

// Migration 1853950000000 (the nature of a budget line, lot Z0 of plan
// planning/budget-unifie.md), against a real database, each test in a
// transaction that is rolled back. The database is put back in the state before
// the migration (down), then both columns are added by hand, as a database
// someone touched could hold them, so the repair has something to do. Two
// tenants:
// - tenant A: a line with nothing (gets OPX-n), one with a legacy number already
//   set (kept), one whose OPX-n another line holds already (left empty), two
//   lines holding the same legacy number (the later one cleared), a line without
//   nature and one with an invalid nature (both set to opex), a line of nature
//   capex (kept, no OPX number);
// - tenant B: a line with the same item number as one of A (OPX-n per tenant).
// Then: row_version, updated_at and the search entries untouched, row level
// security and the line triggers as found, the constraint and the unique index
// refuse what they should, the default applies to a raw insert, the counts are
// logged, a second run changes nothing, down() refuses while a line is not OPEX
// and otherwise puts back 1853940000000's search body to the character. The
// search index keeps OPEX lines only. The assertions read this test's own rows,
// never table-wide counts (except the counts of the hand repair, which only this
// test's rows can trigger).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const migration = new Migration();
const LOG_PREFIX = '[Migration] BudgetLineNature:';
const RLS_TABLES = ['spend_items', 'search_index'];
const TRIGGERS = ['spend_items_row_version', 'trg_search_index_spend_items'];

type Line = { tenantId: string; id: string; itemNumber: number };
type World = {
  tenantA: string;
  tenantB: string;
  plain: Line;
  kept: Line;
  taken: Line;
  holder: Line;
  dupFirst: Line;
  dupLater: Line;
  noNature: Line;
  badNature: Line;
  capex: Line;
  otherTenant: Line;
};

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function noTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `nature-${tag}-${tenantId.slice(0, 8)}`, `Budget line nature ${tag}`],
  );
  return tenantId;
}

/** A line inserted raw, as the scripts and older specs do; `created` orders the duplicates. */
async function seedLine(
  runner: QueryRunner,
  tenantId: string,
  itemNumber: number,
  options: { legacy?: string | null; nature?: string | null; created?: string } = {},
): Promise<Line> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, created_at, updated_at, legacy_number, nature)
     VALUES ($1, $2, 'EUR', '2026-01-01', $3, $4, $4, $5, $6) RETURNING id`,
    [tenantId, `Nature line ${itemNumber}`, itemNumber, options.created ?? '2026-01-01T00:00:00Z', options.legacy ?? null, 'nature' in options ? options.nature : 'opex'],
  );
  return { tenantId, id: row.id, itemNumber };
}

/** The database before the migration, plus both columns added by hand, then the two tenants and their lines. */
async function seedBeforeMigration(runner: QueryRunner): Promise<World> {
  await migration.down(runner);
  // By hand: no NOT NULL, no CHECK; existing rows get opex, so only this test's rows need a repair.
  await runner.query(`ALTER TABLE spend_items ADD COLUMN nature text DEFAULT 'opex'`);
  await runner.query(`ALTER TABLE spend_items ADD COLUMN legacy_number text`);
  const tenantA = await seedTenant(runner, 'a');
  const tenantB = await seedTenant(runner, 'b');
  const world: World = {
    tenantA,
    tenantB,
    plain: await seedLine(runner, tenantA, 910001),
    kept: await seedLine(runner, tenantA, 910002, { legacy: 'OPX-77' }),
    taken: await seedLine(runner, tenantA, 910003),
    holder: await seedLine(runner, tenantA, 910004, { legacy: 'OPX-910003' }),
    dupFirst: await seedLine(runner, tenantA, 910005, { legacy: 'DUP-1', created: '2025-01-01T00:00:00Z' }),
    dupLater: await seedLine(runner, tenantA, 910006, { legacy: 'DUP-1', created: '2025-06-01T00:00:00Z' }),
    noNature: await seedLine(runner, tenantA, 910007, { nature: null }),
    badNature: await seedLine(runner, tenantA, 910008, { nature: 'OPEX' }),
    capex: await seedLine(runner, tenantA, 910009, { nature: 'capex' }),
    otherTenant: await seedLine(runner, tenantB, 910001),
  };
  // Migrations run without a tenant.
  await noTenant(runner);
  return world;
}

const lineKeys = (world: World) => Object.keys(world).filter((key) => key !== 'tenantA' && key !== 'tenantB') as Array<Exclude<keyof World, 'tenantA' | 'tenantB'>>;

async function readLine(runner: QueryRunner, line: Line) {
  await asTenant(runner, line.tenantId);
  const [row] = await runner.query(
    `SELECT s.nature, s.legacy_number, s.row_version, s.updated_at,
            (SELECT x.indexed_at FROM search_index x WHERE x.tenant_id = s.tenant_id AND x.entity_type = 'spend_items' AND x.entity_id = s.id) AS indexed_at
       FROM spend_items s WHERE s.id = $1`,
    [line.id],
  );
  await noTenant(runner);
  return row as { nature: string; legacy_number: string | null; row_version: number; updated_at: Date; indexed_at: Date | null };
}

async function readWorld(runner: QueryRunner, world: World) {
  const out: Record<string, Awaited<ReturnType<typeof readLine>>> = {};
  for (const key of lineKeys(world)) out[key] = await readLine(runner, world[key] as Line);
  return out;
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return row;
}

async function triggerStates(runner: QueryRunner): Promise<Record<string, string>> {
  const rows: Array<{ tgname: string; tgenabled: string }> = await runner.query(
    `SELECT tgname, tgenabled::text AS tgenabled FROM pg_trigger WHERE tgrelid = 'spend_items'::regclass AND tgname = ANY($1)`,
    [TRIGGERS],
  );
  return Object.fromEntries(rows.map((row) => [row.tgname, row.tgenabled]));
}

async function refreshBody(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(`SELECT pg_get_functiondef('search_index_refresh_spend_items(uuid, uuid[])'::regprocedure) AS def`);
  return row.def;
}

/** Runs `fn`, expecting the database error `code` (and `constraint` when given); the transaction goes on. */
async function expectDbError(runner: QueryRunner, fn: () => Promise<unknown>, code: string, constraint?: string) {
  await runner.query('SAVEPOINT expected_error');
  await assert.rejects(fn, (err: any) => err?.code === code && (!constraint || err?.constraint === constraint), `error ${code} ${constraint ?? ''}`);
  await runner.query('ROLLBACK TO SAVEPOINT expected_error');
}

async function testUp() {
  await inRolledBackTransaction(async (runner) => {
    const security = Object.fromEntries(await Promise.all(RLS_TABLES.map(async (table) => [table, await rowSecurity(runner, table)])));
    const triggers = await triggerStates(runner);
    assert.deepEqual(Object.keys(triggers).sort(), [...TRIGGERS].sort(), 'both line triggers exist');
    const world = await seedBeforeMigration(runner);
    const before = await readWorld(runner, world);
    const { lines } = await captureLog(() => migration.up(runner));
    const after = await readWorld(runner, world);

    const expected: Record<string, { nature: string; legacy_number: string | null }> = {
      plain: { nature: 'opex', legacy_number: 'OPX-910001' },
      kept: { nature: 'opex', legacy_number: 'OPX-77' },
      taken: { nature: 'opex', legacy_number: null },
      holder: { nature: 'opex', legacy_number: 'OPX-910003' },
      dupFirst: { nature: 'opex', legacy_number: 'DUP-1' },
      dupLater: { nature: 'opex', legacy_number: 'OPX-910006' },
      noNature: { nature: 'opex', legacy_number: 'OPX-910007' },
      badNature: { nature: 'opex', legacy_number: 'OPX-910008' },
      capex: { nature: 'capex', legacy_number: null },
      otherTenant: { nature: 'opex', legacy_number: 'OPX-910001' },
    };
    for (const key of lineKeys(world)) {
      assert.deepEqual({ nature: after[key].nature, legacy_number: after[key].legacy_number }, expected[key], `${key}: nature and legacy number`);
      assert.equal(after[key].row_version, before[key].row_version, `${key}: row_version untouched`);
      assert.equal(new Date(after[key].updated_at).toISOString(), new Date(before[key].updated_at).toISOString(), `${key}: updated_at untouched`);
      assert.equal(String(after[key].indexed_at), String(before[key].indexed_at), `${key}: search entry untouched`);
    }
    for (const table of RLS_TABLES) {
      assert.deepEqual(await rowSecurity(runner, table), security[table], `${table}: row level security as found`);
    }
    assert.deepEqual(await triggerStates(runner), triggers, 'the line triggers as found');

    const [column] = await runner.query(
      `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'spend_items' AND column_name = 'nature'`,
    );
    assert.equal(column.is_nullable, 'NO', 'nature is NOT NULL');
    assert.match(String(column.column_default), /'opex'/, 'nature defaults to opex');
    const indexes: Array<{ indexname: string }> = await runner.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'spend_items' AND indexname = ANY($1) ORDER BY indexname`,
      [['idx_spend_items_tenant_nature', 'idx_spend_items_tenant_project', 'uq_spend_items_tenant_legacy_number']],
    );
    assert.equal(indexes.length, 3, 'the three indexes exist');

    // The constraint and the unique index refuse what they should; the default applies to a raw insert.
    await asTenant(runner, world.tenantA);
    await expectDbError(runner, () => runner.query(`UPDATE spend_items SET nature = 'both' WHERE id = $1`, [world.plain.id]), '23514', 'spend_items_nature_check');
    await expectDbError(runner, () => runner.query(`UPDATE spend_items SET legacy_number = 'OPX-77' WHERE id = $1`, [world.plain.id]), '23505', 'uq_spend_items_tenant_legacy_number');
    const [raw] = await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number) VALUES ($1, 'Raw', 'EUR', '2026-01-01', 910099) RETURNING nature, legacy_number`,
      [world.tenantA],
    );
    assert.deepEqual(raw, { nature: 'opex', legacy_number: null }, 'a raw insert is an OPEX line without legacy number');
    await asTenant(runner, world.tenantB);
    await runner.query(`UPDATE spend_items SET legacy_number = 'OPX-77' WHERE id = $1`, [world.otherTenant.id]);
    await noTenant(runner);

    const summary = lines.find((line) => line.startsWith(LOG_PREFIX)) ?? '';
    assert.match(summary, /: columns nature and legacy_number ready, \d+ line\(s\) given their legacy number, /, `the counts are logged (${summary})`);
    assert.ok(Number(/, (\d+) line\(s\) given/.exec(summary)?.[1]) >= 6, 'at least this test\'s lines were numbered');
    assert.match(summary, /, 1 OPEX line\(s\) left without one, 2 invalid nature\(s\) set to opex, 1 duplicate legacy number\(s\) cleared, constraint added: spend_items_nature_check;/);

    // The search index reads OPEX lines only: a CAPEX line written gets no OPEX entry, an OPEX line
    // turned CAPEX loses its entry (the line triggers refresh through the new body).
    await asTenant(runner, world.tenantA);
    await runner.query(`UPDATE spend_items SET product_name = 'Capex renamed' WHERE id = $1`, [world.capex.id]);
    await runner.query(`UPDATE spend_items SET product_name = 'Plain renamed' WHERE id = $1`, [world.plain.id]);
    const entries = async (id: string) => (await runner.query(
      `SELECT ref_prefix, label FROM search_index WHERE tenant_id = $1 AND entity_type = 'spend_items' AND entity_id = $2`,
      [world.tenantA, id],
    ));
    assert.deepEqual(await entries(world.capex.id), [], 'no OPEX entry for a CAPEX line');
    assert.deepEqual(await entries(world.plain.id), [{ ref_prefix: 'OPX', label: 'Plain renamed' }], 'an OPEX line is indexed');
    await runner.query(`UPDATE spend_items SET nature = 'capex' WHERE id = $1`, [world.plain.id]);
    assert.deepEqual(await entries(world.plain.id), [], 'an OPEX line turned CAPEX leaves the OPEX entries');
    await noTenant(runner);
  });
}

/** A second run: nothing set or cleared, the values kept. */
async function testRerun() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    const first = await readWorld(runner, world);
    const body = await refreshBody(runner);
    const second = await captureLog(() => migration.up(runner));
    const summary = second.lines.find((line) => line.startsWith(LOG_PREFIX)) ?? '';
    assert.equal(
      summary,
      `${LOG_PREFIX} columns nature and legacy_number ready, 0 line(s) given their legacy number, 1 OPEX line(s) left without one, `
        + '0 invalid nature(s) set to opex, 0 duplicate legacy number(s) cleared, constraint already present; the search index reads OPEX lines only',
      'a second run changes nothing',
    );
    assert.deepEqual(await readWorld(runner, world), first, 'the lines are kept as the first run left them');
    assert.equal(await refreshBody(runner), body, 'the search body is the same');
  });
}

/** down(): refused while a line is not OPEX; otherwise the columns, indexes and constraint go and 1853940000000's body comes back. */
async function testDown() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seedBeforeMigration(runner);
    await captureLog(() => migration.up(runner));
    const opexOnly = await refreshBody(runner);
    assert.equal((opexOnly.match(/nature = 'opex'/g) ?? []).length, 4, 'both paths read and purge by the nature');

    await runner.query('SAVEPOINT refused_down');
    await assert.rejects(() => migration.down(runner), (err: Error) => /line\(s\) of spend_items are not OPEX/.test(err.message), 'down() refuses while a CAPEX line exists');
    await runner.query('ROLLBACK TO SAVEPOINT refused_down');

    await asTenant(runner, world.tenantA);
    await runner.query(`DELETE FROM spend_items WHERE id = $1`, [world.capex.id]);
    await noTenant(runner);
    await migration.down(runner);
    const columns = await runner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'spend_items' AND column_name IN ('nature', 'legacy_number')`,
    );
    assert.deepEqual(columns, [], 'both columns are dropped');
    const leftovers = await runner.query(
      `SELECT indexname AS name FROM pg_indexes WHERE tablename = 'spend_items' AND indexname IN ('idx_spend_items_tenant_nature', 'idx_spend_items_tenant_project', 'uq_spend_items_tenant_legacy_number')
       UNION ALL SELECT conname FROM pg_constraint WHERE conname = 'spend_items_nature_check'`,
    );
    assert.deepEqual(leftovers, [], 'no index or constraint left');

    const restored = await refreshBody(runner);
    assert.doesNotMatch(restored, /nature/, 'the restored body reads no nature');
    await captureLog(() => new SearchIndexMigration().up(runner));
    assert.equal(restored, await refreshBody(runner), "down() puts back 1853940000000's body to the character");
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testUp, testRerun, testDown]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`budget-line-nature-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('budget-line-nature-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
