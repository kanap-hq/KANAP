import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AccountExpectedUnits1856310000000 as Migration } from '../../migrations/1856310000000-account-expected-units';

// Migration 1856310000000 (the units an account expects), against a real database, in a
// transaction that is rolled back. The database is put back in the state before the migration
// (down), an account is seeded, then the migration runs twice:
// - the column is `text[] NULL`, with no default: every account starts without units;
// - nothing else changes on the account (updated_at included), no audit line is written;
// - row level security on `accounts` stays as found;
// - the check `accounts_expected_units_check` refuses an empty list, an unknown unit, and units on
//   an account without the quantity and price setting; it takes known units on a ticked account;
// - the date trigger compares the column after up(): a change of the units dates the account;
// - a second run, on a database already migrated, changes nothing;
// - down() drops the check with the column and keeps the trigger, on the columns left.

const migration = new Migration();
const UPDATED = '2026-01-01T00:00:00.000Z';

async function columnOf(runner: QueryRunner) {
  const rows = await runner.query(
    `SELECT data_type, udt_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'accounts' AND column_name = 'expected_units'`,
  );
  return rows[0] ?? null;
}

async function hasCheck(runner: QueryRunner): Promise<boolean> {
  const rows = await runner.query(
    `SELECT 1 FROM pg_constraint WHERE conrelid = 'accounts'::regclass AND conname = 'accounts_expected_units_check'`,
  );
  return rows.length === 1;
}

async function triggerComparesColumn(runner: QueryRunner): Promise<boolean | null> {
  const rows = await runner.query(
    `SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid = 'accounts'::regclass AND tgname = 'accounts_updated_at'`,
  );
  return rows[0] ? /\bexpected_units\b/.test(rows[0].definition) : null;
}

async function rowSecurity(runner: QueryRunner) {
  const [row] = await runner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'accounts'::regclass`);
  return row;
}

async function refused(runner: QueryRunner, sql: string, params: unknown[], message: string) {
  await runner.query('SAVEPOINT refused');
  await assert.rejects(
    runner.query(sql, params),
    (error: any) => error?.code === '23514' && /accounts_expected_units_check/.test(error?.constraint ?? error?.message ?? ''),
    message,
  );
  await runner.query('ROLLBACK TO SAVEPOINT refused');
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
       VALUES ($1, $2, 'Units migration', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `units-migration-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [chart] = await runner.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'EUM', 'Migration chart', 'FR') RETURNING id`,
      [tenantId],
    );
    const [account] = await runner.query(
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, quantity_price_expected, updated_at)
       VALUES ($1, $2, 6100, 'Staff', true, $3) RETURNING id`,
      [tenantId, chart.id, UPDATED],
    );
    const [unset] = await runner.query(
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, updated_at)
       VALUES ($1, $2, 6200, 'Licences', $3) RETURNING id`,
      [tenantId, chart.id, UPDATED],
    );
    const auditBefore = Number((await runner.query(`SELECT count(*) FROM audit_log WHERE record_id = $1`, [account.id]))[0].count);

    for (const pass of [1, 2]) {
      await migration.up(runner);
      assert.deepEqual(
        await columnOf(runner),
        { data_type: 'ARRAY', udt_name: '_text', is_nullable: 'YES', column_default: null },
        `pass ${pass}: text[] NULL, no default`,
      );
      assert.equal(await hasCheck(runner), true, `pass ${pass}: the check is there`);
      assert.equal(await triggerComparesColumn(runner), true, `pass ${pass}: the date trigger compares the column`);
      const [row] = await runner.query(`SELECT expected_units, quantity_price_expected, account_name, updated_at FROM accounts WHERE id = $1`, [account.id]);
      assert.equal(row.expected_units, null, `pass ${pass}: the account starts without units`);
      assert.deepEqual([row.quantity_price_expected, row.account_name, new Date(row.updated_at).toISOString()], [true, 'Staff', UPDATED], `pass ${pass}: nothing else changes`);
      const audits = Number((await runner.query(`SELECT count(*) FROM audit_log WHERE record_id = $1`, [account.id]))[0].count);
      assert.equal(audits, auditBefore, `pass ${pass}: no audit line`);
      assert.deepEqual(await rowSecurity(runner), security, `pass ${pass}: row level security as found`);

      const write = `UPDATE accounts SET expected_units = $2::text[] WHERE id = $1`;
      await refused(runner, write, [account.id, []], `pass ${pass}: an empty list is refused (no unit is NULL)`);
      await refused(runner, write, [account.id, ['hours']], `pass ${pass}: an unknown unit is refused`);
      await refused(runner, write, [unset.id, ['people']], `pass ${pass}: units on an account without the setting are refused`);
      await runner.query('SAVEPOINT taken');
      await runner.query(write, [account.id, ['people', 'days']]);
      const [taken] = await runner.query(`SELECT expected_units FROM accounts WHERE id = $1`, [account.id]);
      assert.deepEqual(taken.expected_units, ['people', 'days'], `pass ${pass}: known units on a ticked account are stored`);
      await runner.query('ROLLBACK TO SAVEPOINT taken');
    }
    await migration.down(runner);
    assert.deepEqual([await columnOf(runner), await hasCheck(runner)], [null, false], 'down() drops the check and the column');
    assert.equal(await triggerComparesColumn(runner), false, 'down() keeps the trigger, on the columns left');
    await migration.up(runner);
    assert.equal(await hasCheck(runner), true, 'up() after down() adds the check back');
    // The units alone date the account (the database's own date, the transaction's now()).
    await runner.query(`UPDATE accounts SET expected_units = ARRAY['pieces'] WHERE id = $1`, [account.id]);
    const [dated] = await runner.query(`SELECT updated_at = now() AS dated FROM accounts WHERE id = $1`, [account.id]);
    assert.equal(dated.dated, true, 'a change of the units dates the account');
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
  console.log('account-expected-units-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
