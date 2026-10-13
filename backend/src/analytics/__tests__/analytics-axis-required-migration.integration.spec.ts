import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { AnalyticsAxisRequired1853920000000 as Migration } from '../../migrations/1853920000000-analytics-axis-required';
import { runSpecs, seedTenant, withRollback } from './analytics-test-helpers';

// Migration 1853920000000 (whether a dimension is required), against a real
// database, in a transaction rolled back at the end: a second up() changes
// nothing and keeps the stored values; down() drops the column, and up() after
// it restores it (NOT NULL, default false, every dimension back to false).
// @database-spec (the data source opens in analytics-test-helpers).

const migration = new Migration();

async function column(runner: QueryRunner) {
  const rows: Array<{ is_nullable: string; column_default: string | null; data_type: string }> = await runner.query(
    `SELECT is_nullable, column_default, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'analytics_axes' AND column_name = 'required'`,
  );
  return rows[0] ?? null;
}

async function testRerunAndDownUp() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'required-migration');
    const [axis] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, required) VALUES ($1, 'menu', 'Menu', true) RETURNING id`,
      [tenantId],
    );

    const applied = await column(runner);
    assert.deepEqual(applied, { is_nullable: 'NO', column_default: 'false', data_type: 'boolean' }, 'the column after the migration');

    await migration.up(runner);
    assert.deepEqual(await column(runner), applied, 'a second up() changes nothing');
    const [kept] = await runner.query(`SELECT required FROM analytics_axes WHERE tenant_id = $1 AND id = $2`, [tenantId, axis.id]);
    assert.equal(kept.required, true, 'a second up() keeps the stored value');

    await migration.down(runner);
    assert.equal(await column(runner), null, 'down() drops the column');

    await migration.up(runner);
    assert.deepEqual(await column(runner), applied, 'up() after down() restores it');
    const [restored] = await runner.query(`SELECT required FROM analytics_axes WHERE tenant_id = $1 AND id = $2`, [tenantId, axis.id]);
    assert.equal(restored.required, false, 'no backfill: the dimension is optional again');
  });
}

runSpecs('analytics-axis-required-migration.integration.spec', [testRerunAndDownUp]);
