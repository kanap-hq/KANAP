import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AccountNumberBigint1854060000000 as Migration } from '../../migrations/1854060000000-account-number-bigint';

// Migration 1854060000000 (account numbers as bigint), against a real database, each test in a
// transaction that is rolled back. The database is put back in the state before the migration
// (down), then:
// - an integer column refuses 615630000012; after up() both columns are bigint, the stored
//   numbers are kept, 615630000012 is accepted as account and consolidation number;
// - the unique index on (tenant, chart, number) is rebuilt and still refuses a duplicate;
// - a second run changes nothing; down() goes back to integer, and fails on a number it
//   cannot hold.

const migration = new Migration();
const LOG_PREFIX = '[Migration] AccountNumberBigint:';
const LONG = '615630000012';

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

/** The statement's error code, the transaction kept usable through a savepoint. */
async function errorCode(runner: QueryRunner, sql: string, params: unknown[]): Promise<string | null> {
  await runner.query('SAVEPOINT attempt');
  try {
    await runner.query(sql, params);
    await runner.query('RELEASE SAVEPOINT attempt');
    return null;
  } catch (err: any) {
    await runner.query('ROLLBACK TO SAVEPOINT attempt');
    return err?.code ?? err?.driverError?.code ?? 'unknown';
  }
}

async function columnTypes(runner: QueryRunner): Promise<Record<string, string>> {
  const rows: Array<{ column_name: string; data_type: string }> = await runner.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'accounts'
       AND column_name IN ('account_number', 'consolidation_account_number')`,
  );
  return Object.fromEntries(rows.map((row) => [row.column_name, row.data_type]));
}

/** A tenant and a chart, with an account 6156100 mapped to 6156. */
async function seed(runner: QueryRunner) {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `bigint-${tenantId.slice(0, 8)}`, 'Account number bigint'],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, country_iso)
     VALUES ($1, 'FR-PCG', 'FR-PCG', 'COUNTRY', 'FR') RETURNING id`,
    [tenantId],
  );
  const [account] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, consolidation_account_number)
     VALUES ($1, $2, 6156100, 'Maintenance', 6156) RETURNING id`,
    [tenantId, chart.id],
  );
  return { tenantId, chartId: chart.id as string, accountId: account.id as string };
}

const INSERT = `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, consolidation_account_number)
                VALUES ($1, $2, $3, 'Long number', $4)`;

async function testUp() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    assert.deepEqual(await columnTypes(runner), { account_number: 'integer', consolidation_account_number: 'integer' });
    const { tenantId, chartId, accountId } = await seed(runner);
    assert.equal(await errorCode(runner, INSERT, [tenantId, chartId, LONG, null]), '22003', 'an integer column refuses 12 digits');

    const { lines } = await captureLog(() => migration.up(runner));
    assert.ok(lines.includes(`${LOG_PREFIX} 2 column(s) changed to bigint (account_number, consolidation_account_number).`), lines.join(' | '));
    assert.deepEqual(await columnTypes(runner), { account_number: 'bigint', consolidation_account_number: 'bigint' });

    const [kept] = await runner.query(
      `SELECT account_number::text AS number, consolidation_account_number::text AS cons FROM accounts WHERE id = $1`,
      [accountId],
    );
    assert.deepEqual(kept, { number: '6156100', cons: '6156' }, 'the stored numbers are kept');

    assert.equal(await errorCode(runner, INSERT, [tenantId, chartId, LONG, LONG]), null, 'a 12-digit number is accepted');
    const [long] = await runner.query(
      `SELECT account_number::text AS number, consolidation_account_number::text AS cons
       FROM accounts WHERE tenant_id = $1 AND account_number::text = $2::text`,
      [tenantId, LONG],
    );
    assert.deepEqual(long, { number: LONG, cons: LONG });
    assert.equal(await errorCode(runner, INSERT, [tenantId, chartId, LONG, null]), '23505', 'the unique index still refuses a duplicate');

    const [index] = await runner.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_accounts_tenant_coa_number'`,
    );
    assert.match(index?.indexdef ?? '', /UNIQUE INDEX .*\(tenant_id, coa_id, account_number\)/);
  });
}

async function testRerun() {
  await inRolledBackTransaction(async (runner) => {
    await captureLog(() => migration.up(runner));
    const { lines } = await captureLog(() => migration.up(runner));
    assert.ok(lines.includes(`${LOG_PREFIX} 0 column(s) changed to bigint.`), lines.join(' | '));
    assert.deepEqual(await columnTypes(runner), { account_number: 'bigint', consolidation_account_number: 'bigint' });
  });
}

async function testDown() {
  await inRolledBackTransaction(async (runner) => {
    await captureLog(() => migration.up(runner));
    const { tenantId, chartId } = await seed(runner);
    await runner.query(INSERT, [tenantId, chartId, LONG, null]);
    await runner.query('SAVEPOINT down_refused');
    await assert.rejects(() => migration.down(runner), /out of range/, 'down() fails on a number above the integer range');
    await runner.query('ROLLBACK TO SAVEPOINT down_refused');
    await runner.query(`DELETE FROM accounts WHERE tenant_id = $1 AND account_number::text = $2::text`, [tenantId, LONG]);
    await migration.down(runner);
    assert.deepEqual(await columnTypes(runner), { account_number: 'integer', consolidation_account_number: 'integer' });
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
    throw new Error(`account-number-bigint-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('account-number-bigint-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
