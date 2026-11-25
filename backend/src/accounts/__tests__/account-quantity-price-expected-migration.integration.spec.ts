import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AccountQuantityPriceExpected1856280000000 as Migration } from '../../migrations/1856280000000-account-quantity-price-expected';
import { syncUpdatedAtTrigger } from '../../common/updated-at-trigger';

// Migration 1856280000000 (the account setting "quantity and price entry"), against a real
// database, in a transaction that is rolled back. The database is put back in the state before
// the migration (down), an account is seeded, then the migration runs twice:
// - the column is `boolean NULL`, with no default: every account starts unset;
// - nothing else changes on the account (updated_at included), no audit line is written;
// - row level security on `accounts` stays as found (enabled and forced);
// - a stored `false` (left by a run without the check) is set back to NULL, `true` is kept, and
//   the check `accounts_quantity_price_expected_check` then refuses `false`;
// - the repair keeps the repaired account's modification date, even when the date trigger
//   already compares the column (a run interrupted after the column was added);
// - the date trigger (migration 1856270000000) compares the column after up(): a change of the
//   setting dates the account; down() drops the column and keeps the trigger, on the columns left;
// - a second run, on a database already migrated, changes nothing;
// - down() drops the check with the column.

const migration = new Migration();
const UPDATED = '2026-01-01T00:00:00.000Z';

async function columnOf(runner: QueryRunner) {
  const rows = await runner.query(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'accounts' AND column_name = 'quantity_price_expected'`,
  );
  return rows[0] ?? null;
}

async function hasCheck(runner: QueryRunner): Promise<boolean> {
  const rows = await runner.query(
    `SELECT 1 FROM pg_constraint WHERE conrelid = 'accounts'::regclass AND conname = 'accounts_quantity_price_expected_check'`,
  );
  return rows.length === 1;
}

/** Whether the date trigger of `accounts` compares the column; null without the trigger. */
async function triggerComparesColumn(runner: QueryRunner): Promise<boolean | null> {
  const rows = await runner.query(
    `SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid = 'accounts'::regclass AND tgname = 'accounts_updated_at'`,
  );
  return rows[0] ? /\bquantity_price_expected\b/.test(rows[0].definition) : null;
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
    assert.equal(await hasCheck(runner), false, 'down() drops the check');
    assert.equal(await triggerComparesColumn(runner), false, 'down() keeps the date trigger, on the columns left');

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
    // A database where the column exists without its check, the date trigger already comparing it,
    // and holds a `false` and a `true`.
    await runner.query(`ALTER TABLE accounts ADD COLUMN quantity_price_expected boolean NULL`);
    await syncUpdatedAtTrigger(runner, 'accounts');
    const seeded = async (number: number, value: boolean) => (await runner.query(
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, nature, quantity_price_expected, updated_at)
       VALUES ($1, $2, $3, 'Seeded', 'opex', $4, $5) RETURNING id`,
      [tenantId, chart.id, number, value, UPDATED],
    ))[0].id as string;
    const stored = { false: await seeded(6200, false), true: await seeded(6300, true) };

    for (const pass of [1, 2]) {
      await migration.up(runner);
      const values = await runner.query(`SELECT id, quantity_price_expected, updated_at FROM accounts WHERE id = ANY($1::uuid[])`, [[stored.false, stored.true]]);
      const valueOf = new Map(values.map((row: any) => [row.id, row.quantity_price_expected]));
      assert.deepEqual([valueOf.get(stored.false), valueOf.get(stored.true)], [null, true], `pass ${pass}: false set back to NULL, true kept`);
      const dateOf = new Map(values.map((row: any) => [row.id, new Date(row.updated_at).toISOString()]));
      assert.deepEqual([dateOf.get(stored.false), dateOf.get(stored.true)], [UPDATED, UPDATED], `pass ${pass}: the repair keeps the dates`);
      assert.equal(await triggerComparesColumn(runner), true, `pass ${pass}: the date trigger compares the column`);
      assert.equal(await hasCheck(runner), true, `pass ${pass}: the check is there`);
      await runner.query('SAVEPOINT refused');
      await assert.rejects(
        runner.query(`UPDATE accounts SET quantity_price_expected = false WHERE id = $1`, [stored.true]),
        (error: any) => error?.code === '23514' && /accounts_quantity_price_expected_check/.test(error?.constraint ?? error?.message ?? ''),
        `pass ${pass}: false is refused`,
      );
      await runner.query('ROLLBACK TO SAVEPOINT refused');
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
    await migration.down(runner);
    assert.deepEqual([await columnOf(runner), await hasCheck(runner)], [null, false], 'down() drops the check and the column');
    await migration.up(runner);
    assert.equal(await hasCheck(runner), true, 'up() after down() adds them back');
    assert.equal(await triggerComparesColumn(runner), true, 'up() after down(): the date trigger compares the column');
    // The setting alone dates the account (the database's own date, the transaction's now()).
    await runner.query(`UPDATE accounts SET updated_at = $2 WHERE id = $1`, [account.id, UPDATED]);
    await runner.query(`UPDATE accounts SET quantity_price_expected = true WHERE id = $1`, [account.id]);
    const [dated] = await runner.query(`SELECT updated_at = now() AS dated FROM accounts WHERE id = $1`, [account.id]);
    assert.equal(dated.dated, true, 'a change of the setting dates the account');
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
