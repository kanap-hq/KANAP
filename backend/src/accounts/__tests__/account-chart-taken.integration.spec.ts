import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AccountsService } from '../accounts.service';
import { ChartOfAccountsService } from '../chart-of-accounts.service';

// A number or a chart code that already exists is refused with a code the screen
// translates, the English sentence unchanged, and the status the callers already test:
// 400 for an account (create: the selected chart; update: the target chart), 409 for a
// chart (create, and a code change). Each check runs in a savepoint: the unique violation
// aborts the transaction until it rolls back to that point.

const SELECTED = 'An account with this number already exists in the selected Chart of Accounts';
const TARGET = 'An account with this number already exists in the target Chart of Accounts';
const CHART = 'A Chart of Accounts with this code already exists';

function services() {
  const audit = new AuditService(undefined as any);
  const accounts = new AccountsService(undefined as any, audit);
  const charts = new ChartOfAccountsService(undefined as any, undefined as any, undefined as any, audit, accounts);
  return { accounts, charts };
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

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

async function expectRefusal(
  runner: QueryRunner,
  expected: { status: number; code: string; message: string; type: typeof BadRequestException | typeof ConflictException },
  run: () => Promise<unknown>,
) {
  const savepoint = `taken_${randomUUID().replace(/-/g, '')}`;
  await runner.query(`SAVEPOINT ${savepoint}`);
  const error = await run().then(() => null, (caught: unknown) => caught);
  await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  assert.ok(error instanceof expected.type, `${expected.code}: refused`);
  assert.equal((error as BadRequestException).getStatus(), expected.status, `${expected.code}: status`);
  const body = (error as BadRequestException).getResponse() as { code?: string; message?: string };
  assert.equal(body.code, expected.code, expected.message);
  assert.equal(body.message, expected.message, expected.code);
}

async function testAccountAndChartRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `taken-${tenantId.slice(0, 8)}`, 'Taken refusals'],
    );
    await asTenant(runner, tenantId);
    const chart = async (code: string) => {
      const [row] = await runner.query(
        `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, country_iso) VALUES ($1, $2, $2, 'COUNTRY', 'FR') RETURNING id`,
        [tenantId, code],
      );
      return row.id as string;
    };
    const selected = await chart('FR');
    const target = await chart('DE');
    const account = async (coaId: string, number: number) => {
      const [row] = await runner.query(
        `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, coaId, number, `Account ${number}`],
      );
      return row.id as string;
    };
    const onSelected = await account(selected, 6100);
    await account(target, 6100);

    const { accounts, charts } = services();
    const opts = { manager: runner.manager };
    await expectRefusal(runner, { status: 400, code: 'ACCOUNT_NUMBER_TAKEN', message: SELECTED, type: BadRequestException }, () =>
      accounts.create({ coa_id: selected, account_number: '6100', account_name: 'Duplicate' }, undefined, opts));
    await expectRefusal(runner, { status: 400, code: 'ACCOUNT_NUMBER_TAKEN_TARGET', message: TARGET, type: BadRequestException }, () =>
      accounts.update(onSelected, { coa_id: target }, undefined, opts));
    await expectRefusal(runner, { status: 409, code: 'COA_CODE_TAKEN', message: CHART, type: ConflictException }, () =>
      charts.create({ code: 'FR', name: 'Again', scope: 'COUNTRY', country_iso: 'FR' }, null, opts));
    await expectRefusal(runner, { status: 409, code: 'COA_CODE_TAKEN', message: CHART, type: ConflictException }, () =>
      charts.update(target, { code: 'FR' }, null, opts));
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    try {
      await testAccountAndChartRefusals();
      console.log('ok - testAccountAndChartRefusals');
    } catch (err) {
      console.error(err);
      failures.push(`testAccountAndChartRefusals: ${(err as Error).message.split('\n')[0]}`);
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`account-chart-taken.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('account-chart-taken.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
