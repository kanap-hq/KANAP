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

// Lot I3 of 26.11.9: the company, the supplier and the cost center are found by their name exactly,
// case aside, then accents aside (for a person who reads their module), as the other imports. Each
// match beyond case is listed (`matches`) and may be undone (`unmatched`); several names refuse the
// row (`CSV_NAME_AMBIGUOUS_AMONG`); a name nothing finds is refused as before.
async function testNamesBeyondCaseAndAccents() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'contract-csv-names');
    const { companyId } = await seedCompany(runner, tenantId, 'Fromage & Co SA');
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name, item_number) VALUES ($1, 'Société Générale', 7) RETURNING id`, [tenantId]);
    const center = async (code: string, name: string): Promise<string> => (await runner.query(
      `INSERT INTO cost_centers (tenant_id, code, name, kind, company_id) VALUES ($1, $2, $3, 'cost_center', $4) RETURNING id`,
      [tenantId, code, name, companyId],
    ))[0].id;
    const operations = await center('OPS', 'Exploitation réseau');
    await center('HQ1', 'Siège');
    await center('HQ2', 'siège');
    const header = `${HEADER};cost_center`;
    const row = (name: string, company: string, supplierName: string, place = '') =>
      `${name};${company};${supplierName};2026-01-01;12;no;1;100;EUR;annual;enabled;;;${place}`;
    const svc = contracts();
    const admin = { isAdmin: true };
    const upload = file([
      header,
      row('Exact', 'Fromage & Co SA', 'Société Générale', 'Exploitation réseau'),
      row('Case', 'fromage & co sa', 'SOCIÉTÉ GÉNÉRALE', 'exploitation RÉSEAU'),
      row('Accents', 'Fromage & Co SA', 'Societe Generale', 'Exploitation reseau'),
      row('Accents again', 'Fromage & Co SA', 'societe generale'),
    ]);
    for (const dryRun of [true, false]) {
      const result: any = await svc.importCsv({ file: upload, dryRun, access: admin }, { manager: runner.manager });
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.equal(result.inserted, dryRun ? 4 : 4);
      assert.deepEqual(result.matches, [
        { column: 'supplier_name', name: null, value: 'Societe Generale', target: 'Société Générale', ref: 'SUP-7', origin: 'server', reason: 'accents', lines: [4, 5], count: 2, undoable: true },
        { column: 'cost_center', name: null, value: 'Exploitation reseau', target: 'Exploitation réseau', ref: null, origin: 'server', reason: 'accents', lines: [4], count: 1, undoable: true },
      ], dryRun ? 'the check lists the matches' : 'the load lists the matches');
      assert.equal(result.matchesTotal, 2);
      if (!dryRun) {
        const stored = await runner.query(
          `SELECT name, company_id, supplier_id, cost_center_id FROM contracts WHERE tenant_id = $1 ORDER BY name`,
          [tenantId],
        );
        assert.deepEqual(stored.map((item: any) => [item.name, item.company_id, item.supplier_id, item.cost_center_id]), [
          ['Accents', companyId, supplier.id, operations],
          ['Accents again', companyId, supplier.id, null],
          ['Case', companyId, supplier.id, operations],
          ['Exact', companyId, supplier.id, operations],
        ]);
      }
    }

    const refusals = async (lines: string[], params: Record<string, unknown>) => {
      const result: any = await svc.importCsv({ file: file([header, ...lines]), dryRun: true, ...params }, { manager: runner.manager });
      assert.equal(result.ok, false);
      return result;
    };
    // Undone, the value is a name nothing finds; a value case aside is still found.
    const undone = await refusals([row('Undone', 'Fromage & Co SA', 'Societe Generale'), row('Kept', 'FROMAGE & CO SA', 'Société Générale')], {
      access: admin, unmatched: [{ column: 'supplier_name', value: 'societe generale' }],
    });
    assert.deepEqual(errorsByColumn(undone, 2), { supplier_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Societe Generale' } } });
    assert.deepEqual(errorsByColumn(undone, 3), {});
    assert.equal(undone.matches, undefined);
    // A person who does not read the suppliers: no name found beyond case.
    const unread = await refusals([row('Unread', 'Fromage & Co SA', 'Societe Generale')], { access: { permissions: { contracts: 'admin', companies: 'reader' } } });
    assert.deepEqual(errorsByColumn(unread, 2), { supplier_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Societe Generale' } } });
    assert.equal(unread.matches, undefined);
    // Two cost centers of one name case aside, and a name of both accents aside, refuse the row; a name nothing finds too.
    const several = await refusals([
      row('Case twice', 'Fromage & Co SA', 'Société Générale', 'SIÈGE'),
      row('Accents twice', 'Fromage & Co SA', 'Société Générale', 'Siege'),
      row('Exact one', 'Fromage & Co SA', 'Société Générale', 'siège'),
      row('Unknown', 'Fromage & Co SA', 'Ghost', 'Ghost place'),
    ], { access: admin });
    const sorted = (entry: any) => ({ ...entry, params: { ...entry.params, names: String(entry.params.names).split(', ').sort().join(', ') } });
    assert.deepEqual(sorted(errorsByColumn(several, 2).cost_center), { code: 'CSV_NAME_AMBIGUOUS_AMONG', params: { value: 'SIÈGE', names: ['Siège', 'siège'].sort().join(', ') } });
    assert.deepEqual(sorted(errorsByColumn(several, 3).cost_center), { code: 'CSV_NAME_AMBIGUOUS_AMONG', params: { value: 'Siege', names: ['Siège', 'siège'].sort().join(', ') } });
    assert.deepEqual(Object.keys(errorsByColumn(several, 2)), ['cost_center']);
    assert.deepEqual(Object.keys(errorsByColumn(several, 3)), ['cost_center']);
    assert.deepEqual(errorsByColumn(several, 4), {});
    assert.deepEqual(errorsByColumn(several, 5), {
      cost_center: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Ghost place' } },
      supplier_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Ghost' } },
    });
  });
}

void runSpecs('contract-csv-import.integration.spec', [
  ['testIdenticalRowsUnchanged', testIdenticalRowsUnchanged],
  ['testChangedOwnerIsUpdate', testChangedOwnerIsUpdate],
  ['testEveryErrorOfARowIsReportedAndNothingIsWritten', testEveryErrorOfARowIsReportedAndNothingIsWritten],
  ['testNamesBeyondCaseAndAccents', testNamesBeyondCaseAndAccents],
]);
