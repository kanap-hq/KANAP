import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { AnalyticsAxisAppliesTo1853900000000 as Migration } from '../../migrations/1853900000000-analytics-axis-applies-to';
import { runSpecs, seedTenant, setCurrentTenant, withRollback } from './analytics-test-helpers';

// Migration 1853900000000 (which line types a dimension applies to), against a
// real database, in a transaction rolled back at the end: a second up() changes
// nothing and keeps the stored values; down() drops both constraints and the
// column, and up() after it restores them (every dimension back to NULL); on a
// dirty table (constraints absent, an invalid value, a value on a default
// dimension) up() run without a tenant repairs both rows to NULL, then adds the
// constraints, and leaves row level security as it found it.
// @database-spec (the data source opens in analytics-test-helpers).

const migration = new Migration();
const CONSTRAINTS = ['analytics_axes_applies_to_check', 'analytics_axes_default_applies_check'];

async function silently<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.log;
  console.log = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

async function shape(runner: QueryRunner) {
  const [column] = await runner.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'analytics_axes' AND column_name = 'applies_to'`,
  );
  const constraints: Array<{ conname: string; def: string }> = await runner.query(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'analytics_axes' AND c.conname = ANY($1::text[])
      ORDER BY c.conname`,
    [CONSTRAINTS],
  );
  return { column: column.n as number, constraints };
}

async function testRerunAndDownUp() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'migration');
    const [axis] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, applies_to) VALUES ($1, 'recurrence', 'Recurrence', 'capex') RETURNING id`,
      [tenantId],
    );

    const applied = await shape(runner);
    assert.equal(applied.column, 1, 'the column exists after the migration');
    assert.deepEqual(applied.constraints.map((row) => row.conname), [...CONSTRAINTS].sort());

    await silently(() => migration.up(runner));
    assert.deepEqual(await shape(runner), applied, 'a second up() changes nothing');
    const [kept] = await runner.query(`SELECT applies_to FROM analytics_axes WHERE tenant_id = $1 AND id = $2`, [tenantId, axis.id]);
    assert.equal(kept.applies_to, 'capex', 'a second up() keeps the stored value');

    await migration.down(runner);
    assert.deepEqual(await shape(runner), { column: 0, constraints: [] }, 'down() drops both constraints and the column');

    await silently(() => migration.up(runner));
    assert.deepEqual(await shape(runner), applied, 'up() after down() restores both constraints');
    const [restored] = await runner.query(`SELECT applies_to FROM analytics_axes WHERE tenant_id = $1 AND id = $2`, [tenantId, axis.id]);
    assert.equal(restored.applies_to, null, 'no backfill: the dimension applies to both again');
  });
}

async function rowSecurity(runner: QueryRunner) {
  const [state] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass('analytics_axes')`,
  );
  return { enabled: state.enabled, forced: state.forced };
}

async function testRepairsDirtyRows() {
  await withRollback(async (runner) => {
    const applied = await shape(runner);
    const security = await rowSecurity(runner);
    const tenantId = await seedTenant(runner, 'migration-dirty');
    const [defaultAxis] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, is_default) VALUES ($1, 'default', NULL, true) RETURNING id`,
      [tenantId],
    );
    const [invalid] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'invalid', 'Invalid') RETURNING id`,
      [tenantId],
    );
    const [kept] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, applies_to) VALUES ($1, 'kept', 'Kept', 'capex') RETURNING id`,
      [tenantId],
    );
    for (const name of CONSTRAINTS) await runner.query(`ALTER TABLE analytics_axes DROP CONSTRAINT ${name}`);
    await runner.query(`UPDATE analytics_axes SET applies_to = 'both' WHERE tenant_id = $1 AND id = $2`, [tenantId, invalid.id]);
    await runner.query(`UPDATE analytics_axes SET applies_to = 'opex' WHERE tenant_id = $1 AND id = $2`, [tenantId, defaultAxis.id]);

    // As a migration runs: no tenant (FORCE RLS would hide every row from the repair).
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
    try {
      await migration.up(runner);
    } finally {
      console.log = original;
    }
    assert.ok(lines.some((line) => /, 2 invalid value\(s\) cleared,/.test(line)), `the repaired count is logged (the constraints held every other row) (${lines.join(' / ')})`);
    assert.deepEqual(await shape(runner), applied, 'both constraints are back');
    assert.deepEqual(await rowSecurity(runner), security, 'row level security as found');

    await setCurrentTenant(runner, tenantId);
    const rows: Array<{ id: string; applies_to: string | null }> = await runner.query(
      `SELECT id, applies_to FROM analytics_axes WHERE tenant_id = $1`,
      [tenantId],
    );
    const byId = new Map(rows.map((row) => [row.id, row.applies_to]));
    assert.equal(byId.get(invalid.id), null, 'an invalid value is cleared');
    assert.equal(byId.get(defaultAxis.id), null, 'a value on the default dimension is cleared');
    assert.equal(byId.get(kept.id), 'capex', 'a valid value is kept');
  });
}

runSpecs('analytics-axis-applies-to-migration.integration.spec', [testRerunAndDownUp, testRepairsDirtyRows]);
