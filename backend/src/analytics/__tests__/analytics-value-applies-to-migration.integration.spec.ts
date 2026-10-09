import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { AnalyticsValueAppliesTo1853910000000 as Migration } from '../../migrations/1853910000000-analytics-value-applies-to';
import { runSpecs, seedTenant, setCurrentTenant, withRollback } from './analytics-test-helpers';

// Migration 1853910000000 (which line types a value applies to), against a
// real database, in a transaction rolled back at the end: a second up() changes
// nothing and keeps the stored values; down() drops the constraint and the
// column, and up() after it restores them (every value back to NULL); on a
// dirty table (constraint absent, an invalid value, a value restricted to the
// type its dimension excludes) up() run without a tenant repairs the two rows
// to NULL, logs that count, keeps the valid rows, then adds the constraint, and
// leaves row level security on the three tables (the repair rewrites the
// search index rows through the value trigger) as it found it; a second up() then
// logs 0 repaired values.
// @database-spec (the data source opens in analytics-test-helpers).

const migration = new Migration();
const CONSTRAINT = 'analytics_categories_applies_to_check';

async function silently<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.log;
  console.log = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

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
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'analytics_categories' AND column_name = 'applies_to'`,
  );
  const constraints: Array<{ conname: string; def: string }> = await runner.query(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'analytics_categories' AND c.conname = $1`,
    [CONSTRAINT],
  );
  return { column: column.n as number, constraints };
}

async function rowSecurity(runner: QueryRunner) {
  const rows: Array<{ relname: string; enabled: boolean; forced: boolean }> = await runner.query(
    `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
      WHERE oid IN (to_regclass('analytics_categories'), to_regclass('analytics_axes'), to_regclass('search_index'))
      ORDER BY relname`,
  );
  return rows;
}

async function seedAxis(runner: QueryRunner, tenantId: string, code: string, appliesTo: string | null): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, applies_to) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, code, code, appliesTo],
  );
  return row.id;
}

async function seedValue(runner: QueryRunner, tenantId: string, axisId: string, name: string, appliesTo: string | null = null): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, applies_to) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, axisId, name, appliesTo],
  );
  return row.id;
}

async function testRerunAndDownUp() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'value-migration');
    const axisId = await seedAxis(runner, tenantId, 'nature', null);
    const valueId = await seedValue(runner, tenantId, axisId, 'Abonnements SaaS', 'opex');

    const applied = await shape(runner);
    assert.equal(applied.column, 1, 'the column exists after the migration');
    assert.deepEqual(applied.constraints.map((row) => row.conname), [CONSTRAINT]);

    await silently(() => migration.up(runner));
    assert.deepEqual(await shape(runner), applied, 'a second up() changes nothing');
    const [kept] = await runner.query(`SELECT applies_to FROM analytics_categories WHERE tenant_id = $1 AND id = $2`, [tenantId, valueId]);
    assert.equal(kept.applies_to, 'opex', 'a second up() keeps the stored value');

    await migration.down(runner);
    assert.deepEqual(await shape(runner), { column: 0, constraints: [] }, 'down() drops the constraint and the column');

    await silently(() => migration.up(runner));
    assert.deepEqual(await shape(runner), applied, 'up() after down() restores the constraint');
    const [restored] = await runner.query(`SELECT applies_to FROM analytics_categories WHERE tenant_id = $1 AND id = $2`, [tenantId, valueId]);
    assert.equal(restored.applies_to, null, 'no backfill: the value applies to both again');
  });
}

async function testRepairsDirtyRows() {
  await withRollback(async (runner) => {
    const applied = await shape(runner);
    const security = await rowSecurity(runner);
    const tenantId = await seedTenant(runner, 'value-migration-dirty');
    const opexAxis = await seedAxis(runner, tenantId, 'nature', 'opex');
    const bothAxis = await seedAxis(runner, tenantId, 'both', null);
    const invalid = await seedValue(runner, tenantId, bothAxis, 'Invalid');
    const contradiction = await seedValue(runner, tenantId, opexAxis, 'Matériel', 'capex');
    const redundant = await seedValue(runner, tenantId, opexAxis, 'Abonnements SaaS', 'opex');
    const keptCapex = await seedValue(runner, tenantId, bothAxis, 'Serveurs', 'capex');
    const plain = await seedValue(runner, tenantId, opexAxis, 'Licences');
    await runner.query(`ALTER TABLE analytics_categories DROP CONSTRAINT ${CONSTRAINT}`);
    await runner.query(`UPDATE analytics_categories SET applies_to = 'both' WHERE tenant_id = $1 AND id = $2`, [tenantId, invalid]);

    // As a migration runs: no tenant (FORCE RLS would hide every row from the repair and refuse the
    // search index rows its trigger rewrites).
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const lines = await logged(() => migration.up(runner));
    assert.ok(
      lines.some((line) => /, 2 invalid value\(s\) cleared,/.test(line)),
      `the repaired count is logged (the constraint held every other row) (${lines.join(' / ')})`,
    );
    assert.ok(lines.some((line) => line.includes(`constraint added: ${CONSTRAINT}`)), `the constraint is added (${lines.join(' / ')})`);
    assert.deepEqual(await shape(runner), applied, 'the constraint is back');
    assert.deepEqual(await rowSecurity(runner), security, 'row level security as found on the three tables');

    const rerun = await logged(() => migration.up(runner));
    assert.ok(rerun.some((line) => /, 0 invalid value\(s\) cleared, constraint already present/.test(line)), `a second up() repairs nothing (${rerun.join(' / ')})`);

    await setCurrentTenant(runner, tenantId);
    const rows: Array<{ id: string; applies_to: string | null }> = await runner.query(
      `SELECT id, applies_to FROM analytics_categories WHERE tenant_id = $1`,
      [tenantId],
    );
    const byId = new Map(rows.map((row) => [row.id, row.applies_to]));
    assert.equal(byId.get(invalid), null, 'an invalid value is cleared');
    assert.equal(byId.get(contradiction), null, 'a value restricted to the type its dimension excludes is cleared');
    assert.equal(byId.get(redundant), 'opex', "a value restricted to its dimension's own type is kept");
    assert.equal(byId.get(keptCapex), 'capex', 'a valid value under a dimension for both is kept');
    assert.equal(byId.get(plain), null);
  });
}

runSpecs('analytics-value-applies-to-migration.integration.spec', [testRerunAndDownUp, testRepairsDirtyRows]);
