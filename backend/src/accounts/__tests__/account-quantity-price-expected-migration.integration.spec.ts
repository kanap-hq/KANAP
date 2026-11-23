import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AccountQuantityPriceExpected1856280000000 as Migration } from '../../migrations/1856280000000-account-quantity-price-expected';

// Migration 1856280000000 (the account setting "quantity and price entry"), against a real
// database, in a transaction that is rolled back. The database is put back in the state before
// the migration (down), an account is seeded, then the migration runs twice:
// - the column is `boolean NULL`, with no default: every account starts unset;
// - nothing else changes on the account (updated_at included), no audit line is written;
// - row level security on `accounts` stays as found (enabled and forced);
// - a second run, on a database already migrated, changes nothing.

const migration = new Migration();
const UPDATED = '2026-01-01T00:00:00.000Z';

async function columnOf(runner: QueryRunner) {
  const rows = await runner.query(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'accounts' AND column_name = 'quantity_price_expected'`,
  );
  return rows[0] ?? null;
}

async function rowSecurity(runner: QueryRunner) {
  const [row] = await runner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'accounts'::regclass`);
  return row;
}

async function testRerun() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const security = await rowSecurity(runner);
    await migration.down(runner);
    assert.equal(await columnOf(runner), null, 'down() drops the column');

    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Quantity migration', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `qp-migration-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [chart] = await runner.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'QPM', 'Migration chart', 'FR') RETURNING id`,
      [tenantId],
    );
    const [account] = await runner.query(
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, nature, updated_at)
       VALUES ($1, $2, 6100, 'Staff', 'opex', $3) RETURNING id`,
      [tenantId, chart.id, UPDATED],
    );
    const auditBefore = Number((await runner.query(`SELECT count(*) FROM audit_log WHERE record_id = $1`, [account.id]))[0].count);

    for (const pass of [1, 2]) {
      await migration.up(runner);
      assert.deepEqual(await columnOf(runner), { data_type: 'boolean', is_nullable: 'YES', column_default: null }, `pass ${pass}: boolean NULL, no default`);
      const [row] = await runner.query(
        `SELECT quantity_price_expected, nature, account_name, updated_at FROM accounts WHERE id = $1`,
        [account.id],
      );
      assert.equal(row.quantity_price_expected, null, `pass ${pass}: the account starts unset`);
      assert.deepEqual([row.nature, row.account_name, new Date(row.updated_at).toISOString()], ['opex', 'Staff', UPDATED], `pass ${pass}: nothing else changes`);
      const audits = Number((await runner.query(`SELECT count(*) FROM audit_log WHERE record_id = $1`, [account.id]))[0].count);
      assert.equal(audits, auditBefore, `pass ${pass}: no audit line`);
      assert.deepEqual(await rowSecurity(runner), security, `pass ${pass}: row level security as found`);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await testRerun();
    console.log('ok - testRerun');
  } finally {
    await dataSource.destroy();
  }
  console.log('account-quantity-price-expected-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
