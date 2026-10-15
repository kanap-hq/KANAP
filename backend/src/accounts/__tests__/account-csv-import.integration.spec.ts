import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AccountsService } from '../accounts.service';

// The account CSV import, against a real database, each test in a transaction
// that is rolled back:
// - only `account_number` and `account_name` are required in the header; an
//   absent column keeps what is stored on update and takes the default on create;
// - a header refusal names only the parts that apply and carries a code the
//   interface translates;
// - the row refusals carry codes too, with the value they are about.

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

async function seedTenant(runner: QueryRunner): Promise<{ tenantId: string; chartId: string }> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Account import', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `account-import-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'FR-PCG', 'Plan comptable', 'FR') RETURNING id`,
    [tenantId],
  );
  return { tenantId, chartId: chart.id };
}

function service() {
  return new AccountsService(undefined as any, new AuditService(undefined as any));
}

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(lines.join('\n') + '\n', 'utf8') } as Express.Multer.File;
}

async function testOptionalColumns() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, chartId } = await seedTenant(runner);
    await runner.query(
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, native_name, description,
                             consolidation_account_number, consolidation_account_name, nature, status, disabled_at)
       VALUES ($1, $2, 6156100, 'Maintenance', 'Entretien', 'Kept description', 6150, 'Kept consolidation', 'opex', 'disabled', '2020-01-01T00:00:00Z')`,
      [tenantId, chartId],
    );
    const accounts = service();
    const opts = { manager: runner.manager, targetCoaId: chartId };
    const upload = file(['account_number;account_name', '6156100;Maintenance renamed', '6156200;Repairs']);

    const check: any = await accounts.importCsv({ file: upload, dryRun: true, language: 'en' }, opts);
    assert.equal(check.ok, true, `the two required columns are enough: ${JSON.stringify(check.errors)}`);
    assert.deepEqual([check.inserted, check.updated], [1, 1]);

    const load: any = await accounts.importCsv({ file: upload, dryRun: false, language: 'en' }, opts);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const rows = await runner.query(
      `SELECT account_number::int AS number, account_name, native_name, description, consolidation_account_number,
              consolidation_account_name, nature, status
         FROM accounts WHERE tenant_id = $1 AND coa_id = $2 ORDER BY account_number`,
      [tenantId, chartId],
    );
    assert.deepEqual(rows.map((row: any) => ({ ...row, consolidation_account_number: row.consolidation_account_number == null ? null : Number(row.consolidation_account_number) })), [
      {
        number: 6156100,
        account_name: 'Maintenance renamed',
        native_name: 'Entretien',
        description: 'Kept description',
        consolidation_account_number: 6150,
        consolidation_account_name: 'Kept consolidation',
        nature: 'opex',
        status: 'disabled',
      },
      {
        number: 6156200,
        account_name: 'Repairs',
        native_name: null,
        description: null,
        consolidation_account_number: null,
        consolidation_account_name: null,
        nature: null,
        status: 'enabled',
      },
    ], 'absent columns keep the stored values and give a new account the defaults');

    // A present column still writes its cells, blanks included.
    const blank: any = await accounts.importCsv(
      { file: file(['account_number;account_name;description', '6156100;Maintenance renamed;']), dryRun: false, language: 'en' },
      opts,
    );
    assert.equal(blank.ok, true, JSON.stringify(blank.errors));
    const [after] = await runner.query(
      `SELECT description, native_name FROM accounts WHERE tenant_id = $1 AND coa_id = $2 AND account_number = 6156100`,
      [tenantId, chartId],
    );
    assert.deepEqual(after, { description: null, native_name: 'Entretien' });
  });
}

async function testHeaderRefusal() {
  await inRolledBackTransaction(async (runner) => {
    const { chartId } = await seedTenant(runner);
    const accounts = service();
    const opts = { manager: runner.manager, targetCoaId: chartId };

    const missing: any = await accounts.importCsv({ file: file(['account_number;description', '6156100;x']), dryRun: true, language: 'en' }, opts);
    assert.deepEqual(missing.errors, [{
      row: 0,
      message: 'Header mismatch. Missing: account_name',
      code: 'CSV_HEADER_MISSING_COLUMNS',
      params: { missing: 'account_name', extra: '' },
    }]);

    const both: any = await accounts.importCsv({ file: file(['account_number;label', '6156100;x']), dryRun: true, language: 'en' }, opts);
    assert.deepEqual(both.errors, [{
      row: 0,
      message: 'Header mismatch. Missing: account_name, Extra: label',
      code: 'CSV_HEADER_MISMATCH',
      params: { missing: 'account_name', extra: 'label' },
    }]);
  });
}

async function testRowCodes() {
  await inRolledBackTransaction(async (runner) => {
    const { chartId } = await seedTenant(runner);
    const accounts = service();
    const result: any = await accounts.importCsv(
      {
        file: file([
          'account_number;account_name;consolidation_account_number;status;nature',
          'abc;;x;paused;both',
        ]),
        dryRun: true,
        language: 'en',
      },
      { manager: runner.manager, targetCoaId: chartId },
    );
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.errors.map((error: any) => [error.row, error.code, error.params ?? null]),
      [
        [2, 'CSV_ACCOUNT_NUMBER_REQUIRED', null],
        [2, 'CSV_ACCOUNT_NAME_REQUIRED', null],
        [2, 'CSV_ACCOUNT_STATUS_INVALID', { value: 'paused' }],
        [2, 'CSV_ACCOUNT_CONSOLIDATION_NUMBER_INVALID', null],
        [2, 'CSV_ACCOUNT_NATURE_INVALID', { value: 'both' }],
      ],
    );
    assert.equal(result.errors[0].message, 'account_number is required and must be an integer', 'the English message stays for API clients');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testOptionalColumns, testHeaderRefusal, testRowCodes]) {
      try {
        await test();
        console.log(`ok - ${test.name}`);
      } catch (err) {
        console.error(err);
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`account-csv-import.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('account-csv-import.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
