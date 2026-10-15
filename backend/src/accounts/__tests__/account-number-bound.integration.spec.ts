import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Account } from '../account.entity';
import { AccountsService } from '../accounts.service';
import { AccountUpsertDto } from '../dto/account.dto';
import { readAccountNumber } from '../account-number';

// Account numbers of up to 15 digits (bigint columns, migration 1854060000000), against a real
// database, each test in a transaction that is rolled back:
// - the CSV import loads 615630000012 (the dry run passed and the load failed on the integer
//   column); the list finds it by quick search; the entity reads both numbers as numbers;
// - a number above 15 digits is refused on its row with CSV_ACCOUNT_NUMBER_TOO_LONG, in the dry run;
// - leading zeros give a warning on the row (CSV_ACCOUNT_NUMBER_LEADING_ZEROS), the number is stored
//   without them;
// - the API refuses a number above 15 digits or below 1; a write the database refuses as out of
//   range is a 400.

const HEADER = 'account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature';
const LONG = '615630000012';
const TOO_LONG = '6156300000123456';

function upload(content: string): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8') } as Express.Multer.File;
}

async function withTenant(fn: (manager: EntityManager, tenantId: string, coaId: string) => Promise<void>) {
  const runner: QueryRunner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Account number bound', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `acct-bound-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [coa] = await runner.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'FR-PCG', 'FR-PCG', 'FR') RETURNING id`,
      [tenantId],
    );
    await fn(runner.manager, tenantId, coa.id);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

function serviceFor(manager: EntityManager) {
  return new AccountsService(manager.getRepository(Account), new AuditService(manager.getRepository(AuditLog)));
}

function importInto(svc: AccountsService, manager: EntityManager, coaId: string, rows: string[], dryRun: boolean) {
  return svc.importCsv(
    { file: upload([HEADER, ...rows].join('\n') + '\n'), dryRun, userId: null, language: 'en' },
    { manager, targetCoaId: coaId },
  ) as Promise<any>;
}

function testReading() {
  assert.deepEqual(readAccountNumber(LONG), { value: 615630000012, leadingZeros: false });
  assert.deepEqual(readAccountNumber('999999999999999'), { value: 999999999999999, leadingZeros: false });
  assert.deepEqual(readAccountNumber('06156'), { value: 6156, leadingZeros: true });
  assert.deepEqual(readAccountNumber(TOO_LONG), { value: null, problem: 'too_long' });
  assert.deepEqual(readAccountNumber(1e16), { value: null, problem: 'too_long' });
  for (const invalid of ['', '0', '000', '-5', '61.5', 'abc', 0, -1, 1.5, null]) {
    assert.deepEqual(readAccountNumber(invalid), { value: null, problem: 'invalid' }, String(invalid));
  }
}

async function testImportLongNumber() {
  await withTenant(async (manager, tenantId, coaId) => {
    const svc = serviceFor(manager);
    const rows = [`${LONG};Maintenance;;;${LONG};;;enabled;`];
    const dry = await importInto(svc, manager, coaId, rows, true);
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    const loaded = await importInto(svc, manager, coaId, rows, false);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.equal(loaded.inserted, 1);
    const [stored] = await manager.query(
      `SELECT id, account_number::text AS number, consolidation_account_number::text AS cons FROM accounts WHERE tenant_id = $1`,
      [tenantId],
    );
    assert.deepEqual({ number: stored.number, cons: stored.cons }, { number: LONG, cons: LONG });

    const account = await svc.get(stored.id, { manager });
    assert.equal(account.account_number as unknown, 615630000012, 'the entity reads the number as a number');
    assert.equal(account.consolidation_account_number, 615630000012);
    const found = await svc.list({ q: LONG, coaId }, { manager });
    assert.deepEqual(found.items.map((item: any) => item.id), [stored.id], 'the quick search finds a 12-digit number');
  });
}

async function testImportTooLong() {
  await withTenant(async (manager, _tenantId, coaId) => {
    const svc = serviceFor(manager);
    const dry = await importInto(svc, manager, coaId, [`${TOO_LONG};Too long;;;;;;enabled;`, `6156100;Maintenance;;;${TOO_LONG};;;enabled;`], true);
    assert.equal(dry.ok, false);
    assert.deepEqual(dry.errors, [
      {
        row: 2, column: 'account_number', code: 'CSV_ACCOUNT_NUMBER_TOO_LONG', params: { value: TOO_LONG, max: 15 },
        message: `account_number '${TOO_LONG}' has more than 15 digits. Use at most 15 digits.`,
      },
      {
        row: 3, column: 'consolidation_account_number', code: 'CSV_ACCOUNT_NUMBER_TOO_LONG', params: { value: TOO_LONG, max: 15 },
        message: `consolidation_account_number '${TOO_LONG}' has more than 15 digits. Use at most 15 digits.`,
      },
    ]);
  });
}

async function testImportLeadingZeros() {
  await withTenant(async (manager, tenantId, coaId) => {
    const svc = serviceFor(manager);
    const rows = ['06156;Maintenance;;;;;;enabled;', '6156100;Repairs;;;006156;;;enabled;'];
    const dry = await importInto(svc, manager, coaId, rows, true);
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    assert.deepEqual(dry.warnings, [
      { row: 2, column: 'account_number', code: 'CSV_ACCOUNT_NUMBER_LEADING_ZEROS', params: { value: '06156', stored: 6156 }, message: '06156 will be stored as 6156.' },
      { row: 3, column: 'consolidation_account_number', code: 'CSV_ACCOUNT_NUMBER_LEADING_ZEROS', params: { value: '006156', stored: 6156 }, message: '006156 will be stored as 6156.' },
    ]);
    const loaded = await importInto(svc, manager, coaId, rows, false);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    const stored = await manager.query(
      `SELECT account_number::text AS number, consolidation_account_number::text AS cons FROM accounts WHERE tenant_id = $1 ORDER BY account_number`,
      [tenantId],
    );
    assert.deepEqual(stored, [{ number: '6156', cons: null }, { number: '6156100', cons: '6156' }]);
  });
}

async function dtoErrors(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(AccountUpsertDto, body));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

async function testDto() {
  assert.deepEqual(await dtoErrors({ account_number: LONG, consolidation_account_number: Number(LONG) }), []);
  assert.deepEqual(await dtoErrors({ account_number: 6156100, consolidation_account_number: LONG }), [], 'numbers or their text');
  assert.deepEqual(await dtoErrors({ account_number: TOO_LONG }), ['account_number must be a whole number greater than zero, with at most 15 digits']);
  assert.deepEqual(await dtoErrors({ consolidation_account_number: Number(TOO_LONG) }), ['consolidation_account_number must be a whole number greater than zero, with at most 15 digits']);
  assert.deepEqual(await dtoErrors({ consolidation_account_number: 0 }), ['consolidation_account_number must be a whole number greater than zero, with at most 15 digits']);
  assert.deepEqual(await dtoErrors({ account_number: 'abc' }), ['account_number must be a whole number greater than zero, with at most 15 digits']);
  assert.deepEqual(await dtoErrors({ consolidation_account_number: null }), [], 'null clears the consolidation number');
}

async function testOutOfRangeIsA400() {
  await withTenant(async (manager, _tenantId, coaId) => {
    const svc = serviceFor(manager);
    await manager.query('SAVEPOINT out_of_range');
    // Past the DTO (a caller inside the backend): the database refuses it, the API says 400.
    await assert.rejects(
      () => svc.create({ coa_id: coaId, account_number: '99999999999999999999', account_name: 'Out of range' }, undefined, { manager }),
      (err: unknown) => err instanceof BadRequestException && /at most 15 digits/.test((err as Error).message),
    );
    await manager.query('ROLLBACK TO SAVEPOINT out_of_range');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testReading, testImportLongNumber, testImportTooLong, testImportLeadingZeros, testDto, testOutOfRangeIsA400]) {
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
    throw new Error(`account-number-bound.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('account-number-bound.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
