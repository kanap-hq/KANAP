import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItemsCsvService } from '../spend-items-csv.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { FxRateService } from '../../currency/fx-rate.service';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { ItemNumberService } from '../../common/item-number.service';
import { assert, captureAudit, inRolledBackTransaction, Kind, noFreeze, runSpecs, seedItem, seedTenant, setTenant } from './round-inputs.fixtures';

// Item CSV validation, found in the dry run and before anything is written,
// on OPEX and CAPEX alike:
// - an owner email must name an active (enabled) user of this tenant; an
//   unknown, disabled, invited or contact user, or a user of another tenant,
//   is a row error and nothing of the file is written, not even the analytics
//   category it names;
// - a new line needs its currency; on an update a blank currency keeps the
//   stored one.
// CAPEX also: the currency must be one of the tenant's allowed currencies
// (OPEX's rule and message), a new line needs its paying company, and an
// unmatched item number reports its own line.

const COMPANY = 'Csv validation company';
const KINDS: Kind[] = ['opex', 'capex'];

function csvFile(headers: string[], rows: Array<Record<string, string>>) {
  const lines = rows.map((values) => headers.map((h) => values[h] ?? '').join(';'));
  return { buffer: Buffer.from(`${headers.join(';')}\n${lines.join('\n')}\n`, 'utf8') } as any;
}

function opexImporter(): any {
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[7] = captureAudit();
  args[8] = noFreeze;
  args[9] = { getSettings: async () => ({ allowedCurrencies: null }) };
  args[10] = new ItemNumberService();
  return new (SpendItemsCsvService as any)(...args);
}

function capexImporter(): any {
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[5] = captureAudit();
  args[6] = noFreeze;
  // The real settings path: allowed currencies come from the tenant's metadata.
  args[7] = new FxRateService(undefined as any, new CurrencySettingsService(undefined as any, undefined as any));
  args[9] = { syncFromSupplier: async () => undefined };
  args[10] = new ItemNumberService();
  return new (CapexItemsService as any)(...args);
}

const importer = (kind: Kind) => (kind === 'opex' ? opexImporter() : capexImporter());
const itemTable = (kind: Kind) => (kind === 'opex' ? 'spend_items' : 'capex_items');

/** A valid row of each type; `extra` overrides its cells. */
function row(kind: Kind, name: string, extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = kind === 'opex'
    ? { product_name: name, company_name: COMPANY, account_number: '6000', currency: 'EUR', status: 'enabled' }
    : { description: name, company_name: COMPANY, ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', currency: 'EUR', status: 'enabled' };
  return { ...base, ...extra };
}

async function seedUser(runner: QueryRunner, tenantId: string, email: string, status = 'enabled') {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Csv test role', false, false, now(), now()) RETURNING id`,
    [tenantId, `Csv test role ${email}`],
  );
  await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, 'Csv', 'Owner', $4)`,
    [tenantId, role.id, email, status],
  );
}

async function seedCompany(runner: QueryRunner, tenantId: string) {
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon')`, [tenantId, COMPANY]);
}

async function count(runner: QueryRunner, table: string, tenantId: string) {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return n as number;
}

async function testOwnersAreCheckedBeforeWriting(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const otherTenant = await seedTenant(runner, `csv-owner-other-${kind}`);
    const tag = otherTenant.slice(0, 8);
    await seedUser(runner, otherTenant, `elsewhere-${tag}@example.com`);
    const tenantId = await seedTenant(runner, `csv-owner-${kind}`);
    await setTenant(runner, tenantId);
    await seedCompany(runner, tenantId);
    await seedUser(runner, tenantId, `owner-${tag}@example.com`);
    for (const status of ['disabled', 'invited', 'contact']) await seedUser(runner, tenantId, `${status}-${tag}@example.com`, status);

    const svc = importer(kind);
    const headers = svc.csvHeaders();
    const file = csvFile(headers, [
      row(kind, 'Valid line', { owner_it_email: `OWNER-${tag}@example.com`, analytics_category: 'Created only when valid' }),
      row(kind, 'Unknown owner', { owner_it_email: `nobody-${tag}@example.com` }),
      row(kind, 'Disabled owner', { owner_business_email: `disabled-${tag}@example.com` }),
      row(kind, 'Invited owner', { owner_it_email: `invited-${tag}@example.com` }),
      row(kind, 'Contact owner', { owner_business_email: `contact-${tag}@example.com` }),
      row(kind, 'Owner of another tenant', { owner_it_email: `elsewhere-${tag}@example.com` }),
    ]);
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file, dryRun, userId: null }, { manager: runner.manager });
      assert.equal(result.ok, false, `${kind} (dry run ${dryRun}): refused`);
      assert.deepEqual(result.errors.map((e: any) => [e.row, e.message.toLowerCase()]), [
        [3, `owner it email 'nobody-${tag}@example.com' not found`],
        [4, `owner business email 'disabled-${tag}@example.com' is not an active user`],
        [5, `owner it email 'invited-${tag}@example.com' is not an active user`],
        [6, `owner business email 'contact-${tag}@example.com' is not an active user`],
        [7, `owner it email 'elsewhere-${tag}@example.com' not found`],
      ], `${kind} (dry run ${dryRun}): one row error per owner that is not an active user of this tenant`);
    }
    assert.equal(await count(runner, itemTable(kind), tenantId), 0, `${kind}: nothing of the file is written`);
    assert.equal(await count(runner, 'analytics_categories', tenantId), 0, `${kind}: no analytics category is created`);

    const valid = await svc.importCsv(
      { file: csvFile(headers, [row(kind, 'Valid line', { owner_it_email: `owner-${tag}@example.com` })]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.equal(valid.ok, true, `${kind}: an active owner is accepted (${JSON.stringify(valid.errors)})`);
    const [written] = await runner.query(
      `SELECT u.email FROM ${itemTable(kind)} s JOIN users u ON u.id = s.owner_it_id WHERE s.tenant_id = $1`,
      [tenantId],
    );
    assert.equal(written.email, `owner-${tag}@example.com`, `${kind}: the owner is set`);
  });
}

async function testBlankCurrency(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `csv-currency-${kind}`);
    await seedCompany(runner, tenantId);
    const svc = importer(kind);
    const headers = svc.csvHeaders();
    const existing = row(kind, 'Existing line', { currency: 'USD' });
    const created = await svc.importCsv({ file: csvFile(headers, [existing]), dryRun: false, userId: null }, { manager: runner.manager });
    assert.equal(created.ok, true, `${kind}: seed line imported (${JSON.stringify(created.errors)})`);

    const file = csvFile(headers, [row(kind, 'Existing line', { currency: '' }), row(kind, 'New line without currency', { currency: '' })]);
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file, dryRun, userId: null }, { manager: runner.manager });
      assert.equal(result.ok, false, `${kind} (dry run ${dryRun}): a new line without currency is refused`);
      assert.deepEqual(result.errors, [{ row: 3, message: 'currency is required' }], `${kind} (dry run ${dryRun}): row error on the new line only`);
    }
    assert.equal(await count(runner, itemTable(kind), tenantId), 1, `${kind}: nothing is written`);

    const update = await svc.importCsv(
      { file: csvFile(headers, [row(kind, 'Existing line', { currency: '', notes: 'Updated' })]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.equal(update.ok, true, `${kind}: an update with a blank currency is accepted (${JSON.stringify(update.errors)})`);
    const [stored] = await runner.query(`SELECT currency, notes FROM ${itemTable(kind)} WHERE tenant_id = $1`, [tenantId]);
    assert.deepEqual([stored.currency, stored.notes], ['USD', 'Updated'], `${kind}: the stored currency is kept`);
  });
}

async function testCapexCurrencyCompanyAndItemNumber() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-capex');
    await runner.query(
      `UPDATE tenants SET metadata = '{"reporting_currency":"EUR","allowed_currencies":["EUR","USD"]}'::jsonb WHERE id = $1`,
      [tenantId],
    );
    await seedCompany(runner, tenantId);
    await seedItem(runner, 'capex', tenantId, 1, 'Existing line');

    const svc = capexImporter();
    const headers = svc.csvHeaders();

    const currency = await svc.importCsv(
      { file: csvFile(headers, [row('capex', 'Dollar line', { currency: 'USD' }), row('capex', 'Pound line', { currency: 'GBP' })]), dryRun: true, userId: null },
      { manager: runner.manager },
    );
    assert.equal(currency.ok, false, 'CAPEX: a currency outside the allowed ones is refused in the dry run');
    assert.deepEqual(currency.errors, [{ row: 3, message: "currency 'GBP' is not allowed. allowedCurrencies=EUR,USD" }]);

    const file = csvFile(headers, [row('capex', 'Existing line', { item_number: 'CPX-1', company_name: '' }), row('capex', 'New line without company', { company_name: '' })]);
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file, dryRun, userId: null }, { manager: runner.manager });
      assert.equal(result.ok, false, `CAPEX (dry run ${dryRun}): a new line without company is refused`);
      assert.deepEqual(result.errors, [{ row: 3, message: 'company_name is required for a new line' }], `CAPEX (dry run ${dryRun}): row error`);
    }
    assert.equal(await count(runner, 'capex_items', tenantId), 1, 'CAPEX: nothing is written');

    const unknown = await svc.importCsv(
      { file: csvFile(headers, [row('capex', 'Existing line', { item_number: 'CPX-1' }), row('capex', 'Missing', { item_number: 'CPX-999' })]), dryRun: true, userId: null },
      { manager: runner.manager },
    );
    assert.deepEqual(unknown.errors, [{ row: 3, message: "item_number '999' does not match any CAPEX item" }], 'CAPEX: an unmatched item number reports its line');

    const update = await svc.importCsv(
      { file: csvFile(headers, [row('capex', 'Existing line', { item_number: 'CPX-1', company_name: '' })]), dryRun: true, userId: null },
      { manager: runner.manager },
    );
    assert.deepEqual([update.ok, update.updated], [true, 1], 'CAPEX: an existing line keeps its company without one in the file');
  });
}

void runSpecs('csv-validation.integration.spec', [
  ...KINDS.flatMap((kind) => [
    [`testOwnersAreCheckedBeforeWriting(${kind})`, () => testOwnersAreCheckedBeforeWriting(kind)],
    [`testBlankCurrency(${kind})`, () => testBlankCurrency(kind)],
  ] as Array<[string, () => Promise<void>]>),
  ['testCapexCurrencyCompanyAndItemNumber', testCapexCurrencyCompanyAndItemNumber],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
