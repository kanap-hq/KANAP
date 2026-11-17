import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { ContractsService } from '../contracts.service';
import { seedCompany, seedUser } from '../../spend/__tests__/cost-center.fixtures';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The contracts import under the clearing rule of every import route (D21 of 26.11.9), called as
// its route calls it (`mode: 'enrich'`), against a real database, each test rolled back:
// - a row finds its contract by `CTR-n`, else by its name and supplier; any other column may be
//   absent, and an absent column is never written;
// - on a stored contract a blank cell keeps the stored value: the defaults of a new contract
//   (12 and 1 months, amount 0, EUR, annual, no renewal) are not written;
// - `-` clears the cost center, the owner and the notes, and the result counts it (`cleared`),
//   the same at the check and at the load; `-` on an empty value changes nothing;
// - `-` on a key, the company, the supplier, the start date, the renewal, the currency, the
//   frequency or the status is a row error (`CSV_VALUE_CANNOT_BE_CLEARED`); on the amount, the
//   duration or the notice it says to write a number (`CSV_NUMBER_CANNOT_BE_CLEARED`);
// - a new contract needs its company, supplier and start date; `-` on an optional value is blank.

const REFUSED = 'CSV_VALUE_CANNOT_BE_CLEARED';
const NUMBER_REFUSED = 'CSV_NUMBER_CANNOT_BE_CLEARED';
const FULL =
  'reference;name;company_name;supplier_name;cost_center;start_date;duration_months;auto_renewal;notice_period_months;yearly_amount_at_signature;currency;billing_frequency;status;owner_email;notes';

function contracts(): ContractsService {
  const args: any[] = Array.from({ length: 9 }, () => undefined);
  args[4] = new AuditService(undefined as any);
  args[7] = { syncFromSupplier: async () => undefined };
  return new (ContractsService as any)(...args);
}

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(lines.join('\n') + '\n', 'utf8') } as Express.Multer.File;
}

type Report = { ok: boolean; inserted: number; updated: number; unchanged: number; cleared?: number; errors: Array<{ row: number; column?: string; code?: string; message: string }> };

function codes(report: Report): string[] {
  return report.errors.map((error) => `${error.row}:${error.column ?? ''}:${error.code ?? error.message}`);
}

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const { companyId } = await seedCompany(runner, tenantId, 'Fromage Co');
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Dell') RETURNING id`, [tenantId]);
  const email = `owner-${tenantId.slice(0, 8)}@fromage.co`;
  const ownerId = await seedUser(runner, tenantId, email);
  const [center] = await runner.query(
    `INSERT INTO cost_centers (tenant_id, code, name, kind, company_id) VALUES ($1, 'OPS', 'Operations', 'cost_center', $2) RETURNING id`,
    [tenantId, companyId],
  );
  const [contract] = await runner.query(
    `INSERT INTO contracts (tenant_id, item_number, name, company_id, supplier_id, cost_center_id, owner_user_id, start_date, duration_months,
                            auto_renewal, notice_period_months, yearly_amount_at_signature, currency, billing_frequency, notes, updated_at)
     VALUES ($1, 41, 'ESX Support', $2, $3, $4, $5, '2024-01-15', 36, true, 3, 12000, 'USD', 'monthly', 'Kept notes', '2020-01-01T00:00:00Z')
     RETURNING id`,
    [tenantId, companyId, supplier.id, center.id, ownerId],
  );
  const svc = contracts();
  const run = (lines: string[], dryRun = true): Promise<Report> =>
    svc.importCsv({ file: file(lines), dryRun, mode: 'enrich' } as any, { manager: runner.manager }) as Promise<Report>;
  const read = async () => (await runner.query(
    `SELECT name, company_id, supplier_id, cost_center_id, owner_user_id, start_date::text AS start_date, duration_months, auto_renewal,
            notice_period_months, yearly_amount_at_signature::text AS amount, currency, billing_frequency, status, notes
       FROM contracts WHERE id = $1`,
    [contract.id],
  ))[0];
  return { tenantId, companyId, supplierId: supplier.id as string, ownerId, centerId: center.id as string, contractId: contract.id as string, email, run, read };
}

/** The check, then the load: both import, with the counts `[inserted, updated, unchanged, cleared]`. */
async function load(run: (lines: string[], dryRun?: boolean) => Promise<Report>, lines: string[], counts: number[], label: string) {
  for (const dryRun of [true, false]) {
    const report = await run(lines, dryRun);
    assert.equal(report.ok, true, `${label} (${dryRun ? 'check' : 'load'}): ${JSON.stringify(report.errors)}`);
    assert.deepEqual([report.inserted, report.updated, report.unchanged, report.cleared], counts, `${label} (${dryRun ? 'check' : 'load'})`);
  }
}

// A file of two columns updates the one it carries; blank cells of a full file keep the stored
// values, defaults included; a row whose filled cells are stored is unchanged.
async function testBlankKeepsAndAbsentColumnIsNeverWritten() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, companyId, supplierId, centerId, ownerId, run, read } = await seed(runner, 'contract-clear-keep');
    const stored = await read();
    await load(run, ['reference;notes', 'CTR-41;Kept notes'], [0, 0, 1, 0], 'the stored notes: unchanged');
    await load(run, ['name;supplier_name;notes', 'ESX Support;Dell;Kept notes'], [0, 0, 1, 0], 'by name and supplier: unchanged');
    await load(run, [FULL, 'CTR-41;;;;;;;;;;;;;;'], [0, 0, 1, 0], 'a row of blank cells: unchanged');
    const audits = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'contracts'`, [tenantId]);
    assert.equal(audits[0].n, 0, 'an unchanged row writes nothing');

    await load(run, ['reference;notes', 'CTR-41;New notes'], [0, 1, 0, 0], 'two columns');
    await load(run, ['name;supplier_name;duration_months', 'ESX Support;Dell;24'], [0, 1, 0, 0], 'by name and supplier');
    await load(run, [FULL, 'CTR-41;;;;;;;;;;;;;;Newer notes'], [0, 1, 0, 0], 'blank cells of a full file');
    assert.deepEqual(await read(), {
      ...stored, duration_months: 24, notes: 'Newer notes',
    }, 'only the written values change: no default is written');
    assert.deepEqual(
      [stored.company_id, stored.supplier_id, stored.cost_center_id, stored.owner_user_id, stored.amount, stored.currency, stored.billing_frequency, stored.auto_renewal],
      [companyId, supplierId, centerId, ownerId, '12000.00', 'USD', 'monthly', true],
    );
  });
}

// `-` clears the cost center, the owner and the notes, counted the same at the check and at the
// load; `-` again on the empty values is unchanged.
async function testDashClearsOptionalLinks() {
  await inRolledBackTransaction(async (runner) => {
    const { run, read } = await seed(runner, 'contract-clear-dash');
    const stored = await read();
    await load(run, ['reference;cost_center;owner_email;notes', 'CTR-41;-;-;-'], [0, 1, 0, 3], 'cleared');
    assert.deepEqual(await read(), { ...stored, cost_center_id: null, owner_user_id: null, notes: null });
    await load(run, ['reference;cost_center;owner_email;notes', 'CTR-41;-;__CLEAR__;-'], [0, 0, 1, 0], 'already empty');
  });
}

// `-` on a value that cannot be cleared refuses the row, named by its column; nothing is written.
async function testDashRefused() {
  await inRolledBackTransaction(async (runner) => {
    const { run, read } = await seed(runner, 'contract-clear-refused');
    const before = await read();
    const values = await run([
      'reference;name;company_name;supplier_name;start_date;auto_renewal;currency;billing_frequency;status',
      'CTR-41;-;-;-;-;-;-;-;-',
    ], false);
    assert.equal(values.ok, false);
    assert.deepEqual(codes(values), [
      `2:name:${REFUSED}`, `2:company_name:${REFUSED}`, `2:supplier_name:${REFUSED}`, `2:start_date:${REFUSED}`,
      `2:auto_renewal:${REFUSED}`, `2:currency:${REFUSED}`, `2:billing_frequency:${REFUSED}`, `2:status:${REFUSED}`,
    ]);
    const numbers = await run(['reference;duration_months;notice_period_months;yearly_amount_at_signature', 'CTR-41;-;-; - '], false);
    assert.deepEqual(codes(numbers), [
      `2:duration_months:${NUMBER_REFUSED}`, `2:notice_period_months:${NUMBER_REFUSED}`, `2:yearly_amount_at_signature:${NUMBER_REFUSED}`,
    ]);
    const key = await run(['reference;notes', '-;x'], false);
    assert.deepEqual(codes(key), [`2:reference:${REFUSED}`]);
    assert.deepEqual(await read(), before, 'nothing written');
  });
}

// A new contract needs its company, supplier and start date: absent, blank or `-`, the row is
// refused. `-` on an optional value reads as blank, and the defaults apply.
async function testCreation() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, run } = await seed(runner, 'contract-clear-create');
    const absent = await run(['name;supplier_name;notes', 'New deal;Dell;x'], false);
    assert.deepEqual(codes(absent), ['2:company_name:CSV_VALUE_REQUIRED', '2:start_date:CSV_VALUE_REQUIRED']);
    const blank = await run([FULL, ';New deal;;Dell;;;;;;;;;;;'], false);
    assert.deepEqual(codes(blank), ['2:company_name:CSV_VALUE_REQUIRED', '2:start_date:CSV_VALUE_REQUIRED']);
    const dash = await run([FULL, ';New deal;-;Dell;;-;;;;;;;;;'], false);
    assert.deepEqual(codes(dash), [`2:company_name:${REFUSED}`, `2:start_date:${REFUSED}`]);
    const noSupplier = await run(['name;company_name;start_date', 'New deal;Fromage Co;2026-01-01'], false);
    assert.equal(noSupplier.ok, false, 'the supplier names a new contract');

    await load(run, [
      'name;company_name;supplier_name;start_date;cost_center;owner_email;notes',
      'New deal;Fromage Co;Dell;2026-01-01;-;-;-',
    ], [1, 0, 0, 0], 'created');
    const [created] = await runner.query(
      `SELECT cost_center_id, owner_user_id, notes, duration_months, notice_period_months, yearly_amount_at_signature::text AS amount,
              currency, billing_frequency, auto_renewal, status
         FROM contracts WHERE tenant_id = $1 AND name = 'New deal'`,
      [tenantId],
    );
    assert.deepEqual(created, {
      cost_center_id: null, owner_user_id: null, notes: null, duration_months: 12, notice_period_months: 1, amount: '0.00',
      currency: 'EUR', billing_frequency: 'annual', auto_renewal: false, status: 'enabled',
    });
  });
}

// Called without a mode (Kad, until its own pass), the service replaces as it always did: a
// blank owner clears the stored one.
async function testWithoutModeReplaces() {
  await inRolledBackTransaction(async (runner) => {
    const { run, read } = await seed(runner, 'contract-clear-replace');
    void run;
    const svc = contracts();
    const report: any = await svc.importCsv({
      file: file([FULL, 'CTR-41;ESX Support;Fromage Co;Dell;Operations;2024-01-15;36;yes;3;12000;USD;monthly;enabled;;Kept notes']),
      dryRun: false,
    }, { manager: runner.manager });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.deepEqual([report.inserted, report.updated, report.unchanged], [0, 1, 0]);
    assert.equal((await read()).owner_user_id, null);
  });
}

void runSpecs('contract-csv-clear.integration.spec', [
  ['testBlankKeepsAndAbsentColumnIsNeverWritten', testBlankKeepsAndAbsentColumnIsNeverWritten],
  ['testDashClearsOptionalLinks', testDashClearsOptionalLinks],
  ['testDashRefused', testDashRefused],
  ['testCreation', testCreation],
  ['testWithoutModeReplaces', testWithoutModeReplaces],
]);
