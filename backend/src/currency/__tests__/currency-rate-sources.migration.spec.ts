import * as assert from 'node:assert/strict';
import { CurrencyRateSources1854340000000 } from '../../migrations/1854340000000-currency-rate-sources';

/**
 * The column is added with IF NOT EXISTS and dropped with IF EXISTS, so a
 * rerun on a database that already has it (or already lost it) is a no-op.
 */
async function testMigrationIsRerunSafe() {
  const sql: string[] = [];
  const runner = { query: async (statement: string) => { sql.push(statement); } };
  const migration = new CurrencyRateSources1854340000000();

  await migration.up(runner as any);
  await migration.up(runner as any);
  assert.deepEqual(sql, [
    'ALTER TABLE currency_rate_sets ADD COLUMN IF NOT EXISTS rate_sources jsonb NULL',
    'ALTER TABLE currency_rate_sets ADD COLUMN IF NOT EXISTS rate_sources jsonb NULL',
  ]);

  sql.length = 0;
  await migration.down(runner as any);
  await migration.down(runner as any);
  assert.deepEqual(sql, [
    'ALTER TABLE currency_rate_sets DROP COLUMN IF EXISTS rate_sources',
    'ALTER TABLE currency_rate_sets DROP COLUMN IF EXISTS rate_sources',
  ]);
}

(async () => {
  await testMigrationIsRerunSafe();
  console.log('currency rate_sources migration is rerun-safe.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});