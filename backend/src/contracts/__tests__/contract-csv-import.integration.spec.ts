import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { ContractsService } from '../contracts.service';
import { seedCompany, seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The contract CSV import, against a real database, each test in a transaction that is
// rolled back: a row identical to the stored contract (resolved company, supplier and owner
// included) counts as unchanged and writes nothing, in the dry run and the load alike.

const HEADER =
  'name;company_name;supplier_name;start_date;duration_months;auto_renewal;notice_period_months;yearly_amount_at_signature;currency;billing_frequency;status;owner_email;notes';

function contracts(): ContractsService {
  const args: any[] = Array.from({ length: 9 }, () => undefined);
  args[4] = new AuditService(undefined as any);
  args[7] = { syncFromSupplier: async () => undefined };
  return new (ContractsService as any)(...args);
}

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(lines.join('\n') + '\n', 'utf8') } as Express.Multer.File;
}

async function seedContract(runner: QueryRunner, values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values);
  const [row] = await runner.query(
    `INSERT INTO contracts (${columns.join(', ')}, updated_at) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}, '2020-01-01T00:00:00Z') RETURNING id`,
    Object.values(values),
  );
  return row.id;
}

async function testIdenticalRowsUnchanged() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'contract-csv');
    const { companyId } = await seedCompany(runner, tenantId, 'Fromage Co');
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Dell') RETURNING id`, [tenantId]);
    const email = `alice-${tenantId.slice(0, 8)}@fromage.co`;
    const ownerId = await seedUser(runner, tenantId, email);
    const common = { tenant_id: tenantId, company_id: companyId, supplier_id: supplier.id, currency: 'EUR', billing_frequency: 'annual' };
    const keptId = await seedContract(runner, {
      ...common, name: 'ESX Support', owner_user_id: ownerId, start_date: '2024-01-15', duration_months: 36,
      auto_renewal: true, notice_period_months: 3, yearly_amount_at_signature: 12000, notes: 'Kept notes',
    });
    const retiredId = await seedContract(runner, {
      ...common, name: 'Old backup', start_date: '2019-03-01', duration_months: 12, auto_renewal: false,
      notice_period_months: 1, yearly_amount_at_signature: 99.5, status: 'disabled', disabled_at: '2021-06-30T00:00:00Z',
    });
    const changedId = await seedContract(runner, {
      ...common, name: 'Laptops', start_date: '2025-02-01', duration_months: 24, auto_renewal: true,
      notice_period_months: 2, yearly_amount_at_signature: 5000,
    });
    const svc = contracts();
    const opts = { manager: runner.manager };
    const upload = file([
      HEADER,
      // The owner's email in another case, the amount without decimals: still the stored values.
      `ESX Support;Fromage Co;Dell;2024-01-15;36;yes;3;12000;eur;annual;enabled;${email.toUpperCase()};Kept notes`,
      'Old backup;Fromage Co;Dell;2019-03-01;12;no;1;99,50;EUR;annual;disabled;;',
      'Laptops;Fromage Co;Dell;2025-02-01;24;yes;2;5500;EUR;annual;enabled;;',
    ]);

    const check: any = await svc.importCsv({ file: upload, dryRun: true }, opts);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.inserted, check.updated, check.unchanged], [0, 1, 2], 'dry run');

    const load: any = await svc.importCsv({ file: upload, dryRun: false }, opts);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual([load.inserted, load.updated, load.unchanged], [0, 1, 2], 'load');

    const audits = await runner.query(
      `SELECT record_id FROM audit_log WHERE tenant_id = $1 AND table_name = 'contracts' ORDER BY record_id`,
      [tenantId],
    );
    assert.deepEqual(audits.map((row: any) => row.record_id), [changedId], 'only the changed contract is written');
    const stamps = await runner.query(
      `SELECT id, updated_at = '2020-01-01T00:00:00Z'::timestamptz AS kept, yearly_amount_at_signature::text AS amount
         FROM contracts WHERE tenant_id = $1 AND id = ANY($2)`,
      [tenantId, [keptId, retiredId, changedId]],
    );
    const byId = new Map(stamps.map((row: any) => [row.id, row]));
    assert.equal((byId.get(keptId) as any).kept, true, 'the identical contract keeps its updated_at');
    assert.equal((byId.get(retiredId) as any).kept, true, 'the identical disabled contract keeps its updated_at');
    assert.equal((byId.get(changedId) as any).amount, '5500.00');
  });
}

function errorsByColumn(result: { errors: Array<{ row?: number; column?: string; code?: string; params?: Record<string, unknown> }> }, row: number) {
  return Object.fromEntries(
    result.errors.filter((error) => error.row === row).map((error) => [error.column, { code: error.code, params: error.params ?? {} }]),
  );
}

// One pass reports every error of a row, in the dry run and the load, and writes nothing.
// A valid row in the same file gets no error of its own and is left as it was.
async function testEveryErrorOfARowIsReportedAndNothingIsWritten() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'contract-csv-errors');
    const { companyId } = await seedCompany(runner, tenantId, 'Fromage Co');
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Dell') RETURNING id`, [tenantId]);
    const keptId = await seedContract(runner, {
      tenant_id: tenantId, company_id: companyId, supplier_id: supplier.id, currency: 'EUR', billing_frequency: 'annual',
      name: 'Kept Deal', start_date: '2024-01-15', duration_months: 36,
      auto_renewal: true, notice_period_months: 3, yearly_amount_at_signature: 12000,
    });
    const svc = contracts();
    const opts = { manager: runner.manager };
    const upload = file([
      HEADER,
      'New Deal;Ghost Corp;Ghost Supplier;2024-01-01;12;maybe;1;0;EUR;annual;enabled;;',
      'Kept Deal;Fromage Co;Dell;2024-01-15;36;yes;3;12000;EUR;annual;enabled;;',
      'Short;Fromage Co;Dell;2024-01-01;soon;no;1;0;EUR;annual;enabled;;',
    ]);
    for (const dryRun of [true, false]) {
      const result: any = await svc.importCsv({ file: upload, dryRun }, opts);
      assert.equal(result.ok, false, JSON.stringify(result.errors));
      assert.deepEqual(errorsByColumn(result, 2), {
        auto_renewal: { code: 'CSV_BOOLEAN_INVALID', params: { value: 'maybe' } },
        company_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Ghost Corp' } },
        supplier_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Ghost Supplier' } },
      }, dryRun ? 'dry run' : 'load');
      assert.deepEqual(errorsByColumn(result, 3), {}, 'the valid row has no error');
      assert.deepEqual(errorsByColumn(result, 4), {
        duration_months: { code: 'CSV_NUMBER_INVALID', params: { value: 'soon' } },
      });
      assert.deepEqual([result.inserted, result.updated, result.unchanged], [0, 0, 0]);
    }
    const names = await runner.query(`SELECT name FROM contracts WHERE tenant_id = $1 ORDER BY name`, [tenantId]);
    assert.deepEqual(names.map((row: { name: string }) => row.name), ['Kept Deal'], 'the load writes nothing');
    const kept = await runner.query(
      `SELECT updated_at = '2020-01-01T00:00:00Z'::timestamptz AS kept FROM contracts WHERE id = $1`,
      [keptId],
    );
    assert.equal(kept[0].kept, true, 'the valid contract keeps its updated_at');

    // A clean file still loads. Blank month cells keep 12 and 1; a written 0 stays 0.
    const clean = file([
      HEADER,
      'Zero;Fromage Co;Dell;2024-02-01;0;no;0;0;EUR;annual;enabled;;',
      'Blank;Fromage Co;Dell;2024-03-01;;;;0;EUR;annual;enabled;;',
    ]);
    const loaded: any = await svc.importCsv({ file: clean, dryRun: false }, opts);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.equal(loaded.inserted, 2);
    const stored = await runner.query(
      `SELECT name, duration_months, notice_period_months, auto_renewal
         FROM contracts WHERE tenant_id = $1 AND name = ANY($2) ORDER BY name`,
      [tenantId, ['Blank', 'Zero']],
    );
    assert.deepEqual(stored, [
      { name: 'Blank', duration_months: 12, notice_period_months: 1, auto_renewal: false },
      { name: 'Zero', duration_months: 0, notice_period_months: 0, auto_renewal: false },
    ]);
  });
}

async function testChangedOwnerIsUpdate() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'contract-csv-owner');
    const { companyId } = await seedCompany(runner, tenantId, 'Fromage Co');
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Dell') RETURNING id`, [tenantId]);
    const ownerId = await seedUser(runner, tenantId, `owner-${tenantId.slice(0, 8)}@fromage.co`);
    await seedContract(runner, {
      tenant_id: tenantId, company_id: companyId, supplier_id: supplier.id, currency: 'EUR', billing_frequency: 'annual',
      name: 'ESX Support', owner_user_id: ownerId, start_date: '2024-01-15', duration_months: 36,
      auto_renewal: true, notice_period_months: 3, yearly_amount_at_signature: 12000,
    });
    // A blank owner clears the stored one: an update.
    const result: any = await contracts().importCsv(
      { file: file([HEADER, 'ESX Support;Fromage Co;Dell;2024-01-15;36;yes;3;12000;EUR;annual;enabled;;']), dryRun: true },
      { manager: runner.manager },
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.inserted, result.updated, result.unchanged], [0, 1, 0]);
  });
}

void runSpecs('contract-csv-import.integration.spec', [
  ['testIdenticalRowsUnchanged', testIdenticalRowsUnchanged],
  ['testChangedOwnerIsUpdate', testChangedOwnerIsUpdate],
  ['testEveryErrorOfARowIsReportedAndNothingIsWritten', testEveryErrorOfARowIsReportedAndNothingIsWritten],
]);
