import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { AnalyticsValueOrder1853930000000 as Migration } from '../../migrations/1853930000000-analytics-value-order';
import { runSpecs, seedTenant, setCurrentTenant, withRollback } from './analytics-test-helpers';

// Migration 1853930000000 (the manual order of a dimension's values), against a
// real database, in a transaction rolled back at the end: values seeded at 0 in
// two tenants and two dimensions each are numbered 1..n alphabetically per
// dimension (the name in ICU order: "Énergie" before "Matériel", whatever the
// database's collation) by an up() run without a tenant, which logs the count and leaves
// row level security on `analytics_categories` and `search_index` as it found
// it; a second up() numbers 0 values; a dimension reordered by hand is left
// alone by a rerun, while a dimension still all at 0 is numbered; down() drops
// the index and the column, and up() after it restores both. Without the ICU
// collation the backfill falls back to `lower(name), name, id` and says so.
// @database-spec (the data source opens in analytics-test-helpers).

const migration = new Migration();
const INDEX = 'idx_analytics_categories_axis_sort_order';

async function logged(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function shape(runner: QueryRunner) {
  const [column] = await runner.query(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'analytics_categories' AND column_name = 'sort_order'`,
  );
  const indexes: Array<{ indexdef: string }> = await runner.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'analytics_categories' AND indexname = $1`,
    [INDEX],
  );
  return { column: column ?? null, indexes: indexes.map((row) => row.indexdef) };
}

async function rowSecurity(runner: QueryRunner) {
  return runner.query(
    `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
      WHERE oid IN (to_regclass('analytics_categories'), to_regclass('search_index'))
      ORDER BY relname`,
  );
}

async function seedAxis(runner: QueryRunner, tenantId: string, code: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, code, code],
  );
  return row.id;
}

async function seedValues(runner: QueryRunner, tenantId: string, axisId: string, names: string[]) {
  for (const name of names) {
    await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3)`, [tenantId, axisId, name]);
  }
}

async function order(runner: QueryRunner, tenantId: string, axisId: string): Promise<string[]> {
  await setCurrentTenant(runner, tenantId);
  const rows: Array<{ name: string; sort_order: number }> = await runner.query(
    `SELECT name, sort_order FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2 ORDER BY sort_order, id`,
    [tenantId, axisId],
  );
  return rows.map((row) => `${row.sort_order} ${row.name}`);
}

async function asMigration(runner: QueryRunner, fn: () => Promise<unknown>): Promise<string[]> {
  // As a migration runs: no tenant (FORCE RLS would hide every row from the backfill and refuse the
  // search index rows its trigger rewrites).
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  return logged(fn);
}

function numbered(lines: string[]): number | null {
  const match = lines.map((line) => /, (\d+) value\(s\) numbered\b/.exec(line)).find(Boolean);
  return match ? Number(match[1]) : null;
}

async function testBackfill() {
  await withRollback(async (runner) => {
    const applied = await shape(runner);
    assert.deepEqual(applied.column, { data_type: 'integer', is_nullable: 'NO', column_default: '0' }, 'the column after the migration');
    assert.equal(applied.indexes.length, 1, 'the index after the migration');
    const security = await rowSecurity(runner);
    // Rows other specs left at 0 are numbered first, so the counts below are this spec's own.
    await asMigration(runner, () => migration.up(runner));

    const first = await seedTenant(runner, 'order-migration-a');
    const firstMenu = await seedAxis(runner, first, 'menu');
    const firstNature = await seedAxis(runner, first, 'nature');
    await seedValues(runner, first, firstMenu, ['Mains', 'apéritif', 'Dessert', 'Zakouski']);
    await seedValues(runner, first, firstNature, ['Software', 'Matériel', 'Énergie']);
    const second = await seedTenant(runner, 'order-migration-b');
    const secondMenu = await seedAxis(runner, second, 'menu');
    const secondNature = await seedAxis(runner, second, 'nature');
    await seedValues(runner, second, secondMenu, ['Low', 'High']);
    await seedValues(runner, second, secondNature, ['Only']);

    const lines = await asMigration(runner, () => migration.up(runner));
    assert.equal(numbered(lines), 10, `the numbered count is logged (${lines.join(' / ')})`);
    assert.deepEqual(await rowSecurity(runner), security, 'row level security as found on both tables');
    assert.deepEqual(await order(runner, first, firstMenu), ['1 apéritif', '2 Dessert', '3 Mains', '4 Zakouski'], 'alphabetical, case-insensitive');
    assert.deepEqual(await order(runner, first, firstNature), ['1 Énergie', '2 Matériel', '3 Software'], 'per dimension, accents in ICU order');
    assert.deepEqual(await order(runner, second, secondMenu), ['1 High', '2 Low'], 'per tenant');
    assert.deepEqual(await order(runner, second, secondNature), ['1 Only']);

    assert.equal(numbered(await asMigration(runner, () => migration.up(runner))), 0, 'a second up() numbers nothing');

    // A dimension reordered by hand is left alone; one still all at 0 is numbered.
    await setCurrentTenant(runner, first);
    await runner.query(
      `UPDATE analytics_categories SET sort_order = CASE name WHEN 'Zakouski' THEN 1 WHEN 'Mains' THEN 2 WHEN 'Dessert' THEN 3 ELSE 4 END
        WHERE tenant_id = $1 AND axis_id = $2`,
      [first, firstMenu],
    );
    const manual = await order(runner, first, firstMenu);
    await runner.query(`UPDATE analytics_categories SET sort_order = 0 WHERE tenant_id = $1 AND axis_id = $2`, [first, firstNature]);
    await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Added raw')`, [first, firstMenu]);
    assert.equal(numbered(await asMigration(runner, () => migration.up(runner))), 3, 'only the dimension at 0 is numbered');
    assert.deepEqual(await order(runner, first, firstMenu), ['0 Added raw', ...manual], 'a dimension ordered by hand is not touched');
    assert.deepEqual(await order(runner, first, firstNature), ['1 Énergie', '2 Matériel', '3 Software']);
    assert.deepEqual(await rowSecurity(runner), security);
  });
}

async function testDownUp() {
  await withRollback(async (runner) => {
    const applied = await shape(runner);
    const tenantId = await seedTenant(runner, 'order-migration-down');
    const axisId = await seedAxis(runner, tenantId, 'menu');
    await seedValues(runner, tenantId, axisId, ['Low', 'High']);

    await migration.down(runner);
    assert.deepEqual(await shape(runner), { column: null, indexes: [] }, 'down() drops the index and the column');
    // Twice: down() is rerun-safe.
    await migration.down(runner);

    const lines = await asMigration(runner, () => migration.up(runner));
    // Every value of the database is back at 0: all of them are numbered again.
    assert.ok((numbered(lines) ?? 0) >= 2, `up() after down() numbers the values again (${lines.join(' / ')})`);
    assert.deepEqual(await shape(runner), applied, 'up() after down() restores the column and the index');
    assert.deepEqual(await order(runner, tenantId, axisId), ['1 High', '2 Low']);
  });
}

/** The migration on a PostgreSQL built without ICU (an on-premise install may be). */
class MigrationWithoutIcu extends Migration {
  protected async hasIcuCollation(): Promise<boolean> {
    return false;
  }
}

async function testWithoutIcu() {
  await withRollback(async (runner) => {
    // Rows other specs left at 0 are numbered first, so the count below is this spec's own.
    await asMigration(runner, () => migration.up(runner));
    const tenantId = await seedTenant(runner, 'order-migration-no-icu');
    const axisId = await seedAxis(runner, tenantId, 'menu');
    const seeded = ['Zinc', 'Énergie', 'matériel', 'Matériel B'];
    await seedValues(runner, tenantId, axisId, seeded);
    const lines = await asMigration(runner, () => new MigrationWithoutIcu().up(runner));
    assert.equal(numbered(lines), 4, `the values are numbered (${lines.join(' / ')})`);
    assert.ok(lines.some((line) => line.includes('no ICU collation: by lower(name), name')), `the fallback is logged (${lines.join(' / ')})`);
    // The fallback order is the database's own collation: read it from the database.
    const expected: Array<{ name: string }> = await runner.query(
      `SELECT name FROM unnest($1::text[]) AS n(name) ORDER BY lower(name), name`,
      [seeded],
    );
    assert.deepEqual(await order(runner, tenantId, axisId), expected.map((row, index) => `${index + 1} ${row.name}`), 'by lower(name), name');
  });
}

runSpecs('analytics-value-order-migration.integration.spec', [testBackfill, testDownUp, testWithoutIcu]);
