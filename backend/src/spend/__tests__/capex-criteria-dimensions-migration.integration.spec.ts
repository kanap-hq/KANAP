import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BudgetLinesNature1853960000000 as Z1NatureMigration } from '../../migrations/1853960000000-budget-lines-nature';
import { CapexCriteriaDimensions1853980000000 as Migration } from '../../migrations/1853980000000-capex-criteria-dimensions';

// Migration 1853980000000 (lot C1a of plan planning/budget-unifie.md: the three CAPEX criteria
// become analytics dimensions), against a real database, each test in a transaction rolled back.
// A dirty database, as production may hold it:
// - tenant A: CAPEX lines with the three columns set, one without a priority, one already linked
//   on the tenant's own `priority` dimension ("Urgency", kept as it is) to a value of its own,
//   an OPEX line; a dimension named "Investment type" under another code (the new one gets
//   " (CAPEX)"); its dimensions numbered up to 7;
// - tenant B: dimensions named "Priority" and "Priority (CAPEX)" under other codes, one line;
// - tenant D, deleted, with a CAPEX line: it gets nothing.
// Row level security and triggers are found in an unusual state (`spend_item_analytics_values`
// without FORCE, one of its triggers disabled) and must come back so. Then: dimensions in order
// after the existing ones, values in the enum's order, links by name, the line kept and the line
// without a value logged and named, `row_version` and `updated_at` of the lines untouched, the
// CAPEX search entries rebuilt without the enums; a second run changes nothing; a missing column
// is refused before any write; down() computes the columns again from the values (an unknown value
// gives an empty column; a criterion without a dimension, as for a deleted tenant, keeps its
// column), keeps dimensions, values and links and puts lot Z1's search body back; up() after
// down() names the line whose column the former version changed in between (its link kept). A
// dimension kept as it is whose values of those names are disabled or for OPEX lines only: the
// links are made and named with the reason. The assertions read this test's own rows, never table-wide counts, so the
// spec passes on an empty database (CI) as on a copy of a dev database.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const migration = new Migration();
const LOG_PREFIX = '[Migration] CapexCriteriaDimensions:';
const RLS_TABLES = ['analytics_axes', 'analytics_categories', 'spend_item_analytics_values', 'spend_items', 'search_index'];
const CODES = ['ppe_type', 'investment_type', 'priority'] as const;

type World = {
  a: { id: string; slug: string };
  b: { id: string; slug: string };
  d: { id: string; slug: string };
  a1: string; a2: string; a3: string; a4: string; a5: string; b1: string; d1: string;
  urgencyAxis: string; urgent: string; high: string;
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

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function noTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

/** Rows read as a tenant (row level security applies), the setting cleared afterwards. */
async function readAs(runner: QueryRunner, tenantId: string, sql: string, params: unknown[] = []): Promise<any[]> {
  await asTenant(runner, tenantId);
  try {
    return await runner.query(sql, [tenantId, ...params]);
  } finally {
    await noTenant(runner);
  }
}

/** As a migration runs (no tenant), with its log. */
async function asMigration<T>(runner: QueryRunner, fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  await noTenant(runner);
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

async function seedTenant(runner: QueryRunner, tag: string, deleted = false): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const slug = `c1-${tag}-${id.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now(), $5)`,
    [id, slug, `CAPEX criteria ${tag}`, deleted ? 'deleted' : 'active', deleted ? new Date() : null],
  );
  return { id, slug };
}

let itemNumber = 930_000;

async function seedLine(
  runner: QueryRunner,
  tenantId: string,
  nature: 'opex' | 'capex',
  criteria: [string | null, string | null, string | null] = [null, null, null],
): Promise<string> {
  itemNumber += 1;
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO spend_items (tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start,
                              item_number, legacy_number, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'EUR', '2026-01-01', $7, $8, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z') RETURNING id`,
    [tenantId, nature, `Criteria line ${itemNumber}`, ...criteria, itemNumber, nature === 'capex' ? `CPX-${itemNumber}` : `OPX-${itemNumber}`],
  );
  await noTenant(runner);
  return row.id;
}

async function seedAxis(runner: QueryRunner, tenantId: string, code: string, name: string, sortOrder: number): Promise<string> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, code, name, sortOrder],
  );
  await noTenant(runner);
  return row.id;
}

async function seedValue(
  runner: QueryRunner,
  tenantId: string,
  axisId: string,
  name: string,
  sortOrder: number,
  state: { status?: 'enabled' | 'disabled'; disabledAt?: string | null; appliesTo?: 'opex' | 'capex' | null } = {},
): Promise<string> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order, status, disabled_at, applies_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [tenantId, axisId, name, sortOrder, state.status ?? 'enabled', state.disabledAt ?? null, state.appliesTo ?? null],
  );
  await noTenant(runner);
  return row.id;
}

async function seedWorld(runner: QueryRunner): Promise<World> {
  const a = await seedTenant(runner, 'a');
  await seedAxis(runner, a.id, 'default', 'Domain', 0);
  const urgencyAxis = await seedAxis(runner, a.id, 'priority', 'Urgency', 5);
  const urgent = await seedValue(runner, a.id, urgencyAxis, 'Urgent', 1);
  const high = await seedValue(runner, a.id, urgencyAxis, 'High', 2);
  await seedAxis(runner, a.id, 'invest', 'Investment type', 7);
  const a1 = await seedLine(runner, a.id, 'capex', ['hardware', 'replacement', 'mandatory']);
  const a2 = await seedLine(runner, a.id, 'capex', ['software', 'business_growth', 'high']);
  const a3 = await seedLine(runner, a.id, 'capex', ['hardware', 'other', null]);
  const a4 = await seedLine(runner, a.id, 'capex', ['software', 'capacity', 'low']);
  const a5 = await seedLine(runner, a.id, 'opex');
  await asTenant(runner, a.id);
  await runner.query(
    `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
    [a.id, a4, urgencyAxis, urgent],
  );
  await noTenant(runner);

  const b = await seedTenant(runner, 'b');
  await seedAxis(runner, b.id, 'prio', 'Priority', 1);
  await seedAxis(runner, b.id, 'prio2', 'Priority (CAPEX)', 2);
  const b1 = await seedLine(runner, b.id, 'capex', ['hardware', 'security', 'medium']);

  const d = await seedTenant(runner, 'd', true);
  const d1 = await seedLine(runner, d.id, 'capex', ['hardware', 'replacement', 'mandatory']);
  return { a, b, d, a1, a2, a3, a4, a5, b1, d1, urgencyAxis, urgent, high };
}

async function rowSecurity(runner: QueryRunner) {
  return runner.query(
    `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
      WHERE oid = ANY (SELECT to_regclass(x)::oid FROM unnest($1::text[]) AS x) ORDER BY relname`,
    [RLS_TABLES],
  );
}

async function triggers(runner: QueryRunner) {
  return runner.query(
    `SELECT c.relname, t.tgname, t.tgenabled::text AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relname IN ('spend_item_analytics_values', 'spend_items', 'analytics_categories')
      ORDER BY 1, 2`,
  );
}

async function capexBody(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(
    `SELECT pg_get_functiondef(to_regprocedure('search_index_refresh_capex_items(uuid, uuid[])')) AS body`,
  );
  return row.body;
}

/** The tenant's dimensions in order: code, name, order, use, required, status, values in order. */
async function dimensions(runner: QueryRunner, tenantId: string) {
  const rows = await readAs(runner, tenantId,
    `SELECT a.code, a.name, a.sort_order, a.applies_to, a.required, a.status::text AS status,
            coalesce((SELECT array_agg(c.sort_order || ' ' || c.name ORDER BY c.sort_order, c.name)
                        FROM analytics_categories c WHERE c.tenant_id = $1 AND c.axis_id = a.id), '{}') AS vals
       FROM analytics_axes a WHERE a.tenant_id = $1 ORDER BY a.sort_order, a.code`);
  return rows.map((row: any) => ({ ...row, vals: [...row.vals] }));
}

/** Each line's values on the dimensions of the three codes: `<line>:<code>=<value>`. */
async function links(runner: QueryRunner, tenantId: string, lines: string[]) {
  const rows = await readAs(runner, tenantId,
    `SELECT v.item_id::text AS item, a.code, c.name
       FROM spend_item_analytics_values v
       JOIN analytics_axes a ON a.tenant_id = v.tenant_id AND a.id = v.axis_id
       JOIN analytics_categories c ON c.tenant_id = v.tenant_id AND c.id = v.category_id
      WHERE v.tenant_id = $1 AND v.item_id = ANY($2::uuid[]) AND a.code = ANY($3::text[])`,
    [lines, CODES]);
  const index = new Map(lines.map((id, i) => [id, i]));
  return rows
    .map((row: any) => `${index.get(row.item)}:${row.code}=${row.name}`)
    .sort();
}

async function lineStates(runner: QueryRunner, tenantId: string, lines: string[]) {
  const rows = await readAs(runner, tenantId,
    `SELECT id::text AS id, row_version, updated_at, ppe_type::text AS ppe_type, investment_type::text AS investment_type, priority::text AS priority
       FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id`,
    [lines]);
  return rows.map((row: any) => ({ ...row, updated_at: new Date(row.updated_at).toISOString() }));
}

async function entry(runner: QueryRunner, tenantId: string, lineId: string) {
  const [row] = await readAs(runner, tenantId,
    `SELECT summary, extra_json->>'analytics' AS analytics, search_vector::text AS vector
       FROM search_index WHERE tenant_id = $1 AND entity_type = 'capex_items' AND entity_id = $2`,
    [lineId]);
  return row ?? null;
}

async function linkCount(runner: QueryRunner, tenantId: string): Promise<number> {
  const [row] = await readAs(runner, tenantId, `SELECT count(*)::int AS n FROM spend_item_analytics_values WHERE tenant_id = $1`);
  return row.n;
}

/** Puts row level security and triggers in an unusual state, the one the migration must restore. */
async function unusualState(runner: QueryRunner) {
  await runner.query(`ALTER TABLE spend_item_analytics_values NO FORCE ROW LEVEL SECURITY`);
  await runner.query(`ALTER TABLE spend_item_analytics_values DISABLE TRIGGER spend_item_analytics_values_search_index_update`);
}

async function testUp() {
  await inRolledBackTransaction(async (runner) => {
    await noTenant(runner);
    // Lot Z1's search body, the one the CAPEX entries are written with before this migration.
    await asMigration(runner, () => new Z1NatureMigration().up(runner));
    const world = await seedWorld(runner);
    await unusualState(runner);
    const security = await rowSecurity(runner);
    const triggersFound = await triggers(runner);
    const aLines = [world.a1, world.a2, world.a3, world.a4, world.a5];
    const statesA = await lineStates(runner, world.a.id, aLines);
    const statesB = await lineStates(runner, world.b.id, [world.b1]);
    const before = await entry(runner, world.a.id, world.a1);
    assert.match(before.summary, /hardware \| replacement/, 'before: the summary holds the enums (lot Z1)');

    const { lines } = await asMigration(runner, () => migration.up(runner));

    assert.deepEqual(await rowSecurity(runner), security, 'row level security as found');
    assert.deepEqual(await triggers(runner), triggersFound, 'triggers as found (one disabled stays disabled)');
    assert.deepEqual(await lineStates(runner, world.a.id, aLines), statesA, 'tenant A: row_version, updated_at and columns untouched');
    assert.deepEqual(await lineStates(runner, world.b.id, [world.b1]), statesB, 'tenant B: row_version untouched');

    assert.deepEqual(await dimensions(runner, world.a.id), [
      { code: 'default', name: 'Domain', sort_order: 0, applies_to: null, required: false, status: 'enabled', vals: [] },
      // Kept as it is (name, order, use, required); the values it lacks after its own.
      { code: 'priority', name: 'Urgency', sort_order: 5, applies_to: null, required: false, status: 'enabled', vals: ['1 Urgent', '2 High', '3 Mandatory', '4 Medium', '5 Low'] },
      { code: 'invest', name: 'Investment type', sort_order: 7, applies_to: null, required: false, status: 'enabled', vals: [] },
      { code: 'ppe_type', name: 'PP&E type', sort_order: 8, applies_to: 'capex', required: true, status: 'enabled', vals: ['1 Hardware', '2 Software'] },
      {
        code: 'investment_type', name: 'Investment type (CAPEX)', sort_order: 9, applies_to: 'capex', required: true, status: 'enabled',
        vals: ['1 Replacement', '2 Capacity', '3 Productivity', '4 Security', '5 Conformity', '6 Business growth', '7 Other'],
      },
    ], 'tenant A: dimensions after the existing ones, in order; values in the enum order');
    assert.deepEqual((await dimensions(runner, world.b.id)).map((row: any) => [row.code, row.name, row.sort_order]), [
      ['prio', 'Priority', 1], ['prio2', 'Priority (CAPEX)', 2],
      ['ppe_type', 'PP&E type', 3], ['investment_type', 'Investment type', 4], ['priority', 'Priority (CAPEX 2)', 5],
    ], 'tenant B: a name another dimension holds gets a suffix');
    assert.deepEqual(await dimensions(runner, world.d.id), [], 'a deleted tenant gets no dimension');

    assert.deepEqual(await links(runner, world.a.id, aLines), [
      '0:investment_type=Replacement', '0:ppe_type=Hardware', '0:priority=Mandatory',
      '1:investment_type=Business growth', '1:ppe_type=Software', '1:priority=High',
      '2:investment_type=Other', '2:ppe_type=Hardware',
      '3:investment_type=Capacity', '3:ppe_type=Software', '3:priority=Urgent',
    ], 'tenant A: one link per column set, by name; the link already there kept; none for the OPEX line');
    assert.deepEqual(await links(runner, world.b.id, [world.b1]), ['0:investment_type=Security', '0:ppe_type=Hardware', '0:priority=Medium']);
    assert.equal(await linkCount(runner, world.d.id), 0, 'the deleted tenant gets no link');

    const after = await entry(runner, world.a.id, world.a1);
    assert.equal(after.summary, null, 'the summary loses the enums (no company, no supplier)');
    assert.match(after.analytics, /PP&E type: Hardware; Investment type \(CAPEX\): Replacement/, 'the values are in the entry');
    assert.doesNotMatch(await capexBody(runner), /ppe_type|investment_type|ci\.priority/, 'the CAPEX body reads no enum');

    const logA = lines.find((line) => line.includes(`tenant ${world.a.slug} `) && !line.includes('check:')) ?? '';
    assert.match(logA, /ppe_type created as "PP&E type", 2 value\(s\) created, 4 link\(s\) created/, logA);
    assert.match(logA, /investment_type created as "Investment type \(CAPEX\)", 7 value\(s\) created, 4 link\(s\) created/, logA);
    assert.match(logA, /priority kept \("Urgency"\), 3 value\(s\) created, 2 link\(s\) created, 1 kept \(1 kept link\(s\) name another value/, logA);
    assert.ok(logA.includes(`name another value than the line's column: ${world.a4} (column low, value Urgent))`),
      `the kept link that names another value is named, with the column and the value: ${logA}`);
    assert.ok(!logA.includes('cannot choose'), `no link on an unusable value: ${logA}`);
    assert.ok(logA.includes(`1 without priority: ${world.a3}`), `the line without a value is named: ${logA}`);
    const checkA = lines.find((line) => line.includes('check:') && line.includes(world.a.slug)) ?? '';
    assert.match(checkA, /4 CAPEX line\(s\) to link \(column set: ppe_type 4, investment_type 4, priority 3\)/, checkA);
    assert.match(checkA, /the priority dimension exists \("Urgency", used for both, optional, enabled\): kept as it is/, checkA);
    assert.match(checkA, /another dimension is named "Investment type"/, checkA);
    assert.ok(!lines.some((line) => line.includes(world.d.slug)), 'the deleted tenant is not in the log');
    assert.ok(lines.some((line) => line.startsWith(`${LOG_PREFIX} done in`)), 'the closing line');
  });
}

async function testSecondRun() {
  await inRolledBackTransaction(async (runner) => {
    await noTenant(runner);
    const world = await seedWorld(runner);
    await asMigration(runner, () => migration.up(runner));
    const dims = await dimensions(runner, world.a.id);
    const ids = await readAs(runner, world.a.id, `SELECT id::text AS id FROM analytics_axes WHERE tenant_id = $1 ORDER BY id`);
    const counts = [await linkCount(runner, world.a.id), await linkCount(runner, world.b.id)];
    const states = await lineStates(runner, world.a.id, [world.a1, world.a2, world.a3, world.a4]);

    const { lines } = await asMigration(runner, () => migration.up(runner));

    assert.deepEqual(await dimensions(runner, world.a.id), dims, 'a second run creates and renumbers nothing');
    assert.deepEqual(await readAs(runner, world.a.id, `SELECT id::text AS id FROM analytics_axes WHERE tenant_id = $1 ORDER BY id`), ids);
    assert.deepEqual([await linkCount(runner, world.a.id), await linkCount(runner, world.b.id)], counts, 'no link added');
    assert.deepEqual(await lineStates(runner, world.a.id, [world.a1, world.a2, world.a3, world.a4]), states);
    const logA = lines.find((line) => line.includes(`tenant ${world.a.slug} `) && !line.includes('check:')) ?? '';
    assert.match(logA, /ppe_type kept \("PP&E type"\), 0 value\(s\) created, 0 link\(s\) created, 4 kept/, logA);
  });
}

async function testRefusedBeforeAnyWrite() {
  await inRolledBackTransaction(async (runner) => {
    await noTenant(runner);
    const world = await seedWorld(runner);
    await runner.query(`ALTER TABLE spend_items RENAME COLUMN priority TO priority_renamed_by_spec`);
    let error: Error | null = null;
    try {
      await asMigration(runner, () => migration.up(runner));
    } catch (caught) {
      error = caught as Error;
    }
    assert.ok(error, 'up() refuses');
    assert.match(error!.message, /spend_items lacks priority .*nothing was changed/);
    assert.deepEqual((await dimensions(runner, world.b.id)).map((row: any) => row.code), ['prio', 'prio2'], 'nothing was written');
  });
}

async function testDownThenUp() {
  await inRolledBackTransaction(async (runner) => {
    await noTenant(runner);
    await asMigration(runner, () => new Z1NatureMigration().up(runner));
    const z1Body = await capexBody(runner);
    const world = await seedWorld(runner);
    await asMigration(runner, () => migration.up(runner));
    const dims = await dimensions(runner, world.a.id);

    // Written since the conversion: the columns no longer follow the values (the code reads the
    // values only), and a new line holds values and no column.
    await asTenant(runner, world.a.id);
    await runner.query(`UPDATE spend_items SET ppe_type = NULL, investment_type = NULL, priority = NULL WHERE id = $1`, [world.a1]);
    await runner.query(`UPDATE spend_items SET priority = 'low' WHERE id = $1`, [world.a2]);
    await noTenant(runner);
    const a6 = await seedLine(runner, world.a.id, 'capex');
    const valueOf = async (code: string, name: string) => {
      const [row] = await readAs(runner, world.a.id,
        `SELECT c.id::text AS id, c.axis_id::text AS axis FROM analytics_categories c JOIN analytics_axes a ON a.id = c.axis_id
          WHERE c.tenant_id = $1 AND a.code = $2 AND c.name = $3`, [code, name]);
      return row;
    };
    await asTenant(runner, world.a.id);
    for (const [code, name] of [['ppe_type', 'Software'], ['investment_type', 'Security'], ['priority', 'Low']]) {
      const value = await valueOf(code, name);
      await asTenant(runner, world.a.id);
      await runner.query(`INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
        [world.a.id, a6, value.axis, value.id]);
    }
    await noTenant(runner);
    // Tenant B's priority dimension deleted since (its links, values, then itself): down() keeps
    // that column of its lines as it is.
    await asTenant(runner, world.b.id);
    await runner.query(
      `DELETE FROM spend_item_analytics_values v USING analytics_axes a
        WHERE v.tenant_id = $1 AND a.tenant_id = $1 AND a.id = v.axis_id AND a.code = 'priority'`, [world.b.id]);
    await runner.query(
      `DELETE FROM analytics_categories c USING analytics_axes a
        WHERE c.tenant_id = $1 AND a.tenant_id = $1 AND a.id = c.axis_id AND a.code = 'priority'`, [world.b.id]);
    await runner.query(`DELETE FROM analytics_axes WHERE tenant_id = $1 AND code = 'priority'`, [world.b.id]);
    await noTenant(runner);
    const aLines = [world.a1, world.a2, world.a3, world.a4, a6];
    const linksBefore = await links(runner, world.a.id, aLines);
    const versions = (await lineStates(runner, world.a.id, aLines)).map((row: any) => [row.id, row.row_version, row.updated_at]);

    const { lines } = await asMigration(runner, () => migration.down(runner));

    const restored = (await lineStates(runner, world.a.id, aLines)).map((row: any) => [row.id, row.row_version, row.updated_at]);
    assert.deepEqual(restored, versions, 'down(): row_version and updated_at untouched');
    const columns = new Map((await lineStates(runner, world.a.id, aLines)).map((row: any) => [row.id, [row.ppe_type, row.investment_type, row.priority]]));
    assert.deepEqual(columns.get(world.a1), ['hardware', 'replacement', 'mandatory'], 'computed again from the values');
    assert.deepEqual(columns.get(world.a2), ['software', 'business_growth', 'high'], 'the value wins over the stale column');
    assert.deepEqual(columns.get(world.a3), ['hardware', 'other', null], 'no value: empty');
    assert.deepEqual(columns.get(world.a4), ['software', 'capacity', null], 'a value of its own (Urgent): empty');
    assert.deepEqual(columns.get(a6), ['software', 'security', 'low'], 'a line created since gets its columns');
    assert.deepEqual(await dimensions(runner, world.a.id), dims, 'down(): dimensions and values kept');
    assert.deepEqual(await links(runner, world.a.id, aLines), linksBefore, 'down(): links kept');
    assert.equal(await capexBody(runner), z1Body, "down(): lot Z1's search body back");
    assert.match((await entry(runner, world.a.id, world.a1)).summary, /hardware \| replacement/, 'down(): the entry holds the enums again');
    const logA = lines.find((line) => line.includes(`tenant ${world.a.slug} `)) ?? '';
    assert.match(logA, /down: tenant .*: 4 CAPEX line\(s\) got their columns from their values; 2 line\(s\) with an empty column/, logA);
    assert.ok(logA.includes(world.a3) && logA.includes(world.a4), `the lines with an empty column are named: ${logA}`);
    // A criterion the tenant has no dimension of: its column left as it is, the lines counted.
    assert.deepEqual((await lineStates(runner, world.d.id, [world.d1])).map((row: any) => [row.ppe_type, row.investment_type, row.priority]),
      [['hardware', 'replacement', 'mandatory']], 'a deleted tenant (no dimension): its columns as they were');
    assert.deepEqual((await lineStates(runner, world.b.id, [world.b1])).map((row: any) => [row.ppe_type, row.investment_type, row.priority]),
      [['hardware', 'security', 'medium']], 'a dimension deleted since: that column as it was');
    const logD = lines.find((line) => line.includes(`tenant ${world.d.slug} `)) ?? '';
    assert.match(logD, /0 CAPEX line\(s\) got their columns from their values; 1 line\(s\) left as they are for ppe_type, investment_type, priority \(no dimension of that code\)/, logD);
    const logB = lines.find((line) => line.includes(`tenant ${world.b.slug} `)) ?? '';
    assert.match(logB, /1 line\(s\) left as they are for priority \(no dimension of that code\)/, logB);
    assert.match(lines.find((line) => line.startsWith(`${LOG_PREFIX} reverted in`)) ?? '', /left as they are for a criterion without a dimension/);

    await asMigration(runner, () => migration.down(runner));
    assert.deepEqual((await lineStates(runner, world.a.id, aLines)).map((row: any) => [row.id, row.row_version]), versions.map(([id, version]) => [id, version]), 'down() twice');

    // The former version, run again after the revert, changes a criterion: the link stays as it was,
    // the line is named at the next up().
    await asTenant(runner, world.a.id);
    await runner.query(`UPDATE spend_items SET priority = 'low' WHERE id = $1`, [world.a2]);
    await noTenant(runner);
    const again = await asMigration(runner, () => migration.up(runner));
    assert.deepEqual(await dimensions(runner, world.a.id), dims, 'up() after down(): nothing created');
    assert.deepEqual(await links(runner, world.a.id, aLines), linksBefore, 'up() after down(): the links as they were');
    const againA = again.lines.find((line) => line.includes(`tenant ${world.a.slug} `) && !line.includes('check:')) ?? '';
    assert.ok(againA.includes(`${world.a2} (column low, value High)`), `the line changed by the former version is named: ${againA}`);
    assert.doesNotMatch(await capexBody(runner), /ppe_type/, 'up() after down(): the body without the enums');
    assert.ok(again.lines.some((line) => line.startsWith(`${LOG_PREFIX} done in`)));
  });
}

async function testUnusableValues() {
  await inRolledBackTransaction(async (runner) => {
    await noTenant(runner);
    // A priority dimension kept as it is: values of those names disabled, ended, for OPEX only.
    const e = await seedTenant(runner, 'e');
    const axis = await seedAxis(runner, e.id, 'priority', 'Urgency', 1);
    await seedValue(runner, e.id, axis, 'Medium', 1, { status: 'disabled' });
    await seedValue(runner, e.id, axis, 'High', 2, { disabledAt: '2020-01-01T00:00:00Z' });
    await seedValue(runner, e.id, axis, 'Low', 3, { appliesTo: 'opex' });
    await seedValue(runner, e.id, axis, 'Mandatory', 4);
    const e1 = await seedLine(runner, e.id, 'capex', ['hardware', 'other', 'medium']);
    const e2 = await seedLine(runner, e.id, 'capex', ['hardware', 'other', 'high']);
    const e3 = await seedLine(runner, e.id, 'capex', ['hardware', 'other', 'low']);
    const e4 = await seedLine(runner, e.id, 'capex', ['hardware', 'other', 'mandatory']);

    const { lines } = await asMigration(runner, () => migration.up(runner));

    assert.deepEqual(await links(runner, e.id, [e1, e2, e3, e4]).then((rows) => rows.filter((row: string) => row.includes(':priority='))), [
      '0:priority=Medium', '1:priority=High', '2:priority=Low', '3:priority=Mandatory',
    ], 'the links are made, the data stays');
    const logE = lines.find((line) => line.includes(`tenant ${e.slug} `) && !line.includes('check:')) ?? '';
    // Named in (created_at, id) order; the lines share their created_at.
    const named = [[e1, 'Medium, disabled'], [e2, 'High, disabled'], [e3, 'Low, opex only']]
      .sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([id, why]) => `${id} (${why})`);
    assert.ok(
      logE.includes(`(3 link(s) on a value CAPEX lines cannot choose: ${named.join(', ')})`),
      `the links on a value CAPEX lines cannot choose are named with the reason: ${logE}`,
    );
    assert.ok(!logE.includes(e4), `a usable value is not named: ${logE}`);
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testUp, testSecondRun, testRefusedBeforeAnyWrite, testDownThenUp, testUnusableValues]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 8).join('\n    ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`capex-criteria-dimensions-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('capex-criteria-dimensions-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
