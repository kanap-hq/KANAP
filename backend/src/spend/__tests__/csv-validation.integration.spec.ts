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
// OPEX also: a supplier matches its exact name, else case-insensitively; an
// unknown or ambiguous one is a row error; the account number resolves within the paying company's
// chart of accounts (a number found in two charts is the company's), an unknown
// one is a row error; a blank supplier matches only a line without supplier;
// a line repeated in the file is a row error; a CSV update moves updated_at.
// Both types: effective_start is YYYY-MM-DD (a real day) or a row error; a
// blank start is 1 January for a new line and keeps the stored date on an update.
// CAPEX also: a line repeated in the file (same item number, or same
// description without one) is a row error; the currency must be one of the tenant's allowed currencies
// (OPEX's rule and message), a new line needs its paying company, and an
// unmatched item number reports its own line.

const COMPANY = 'Csv validation company';
const KINDS: Kind[] = ['opex', 'capex'];

function csvFile(headers: string[], rows: Array<Record<string, string>>) {
  const lines = rows.map((values) => headers.map((h) => values[h] ?? '').join(';'));
  return { buffer: Buffer.from(`${headers.join(';')}\n${lines.join('\n')}\n`, 'utf8') } as any;
}

function opexImporter(): any {
  const args: any[] = Array.from({ length: 10 }, () => undefined);
  args[6] = captureAudit();
  args[7] = noFreeze;
  args[8] = { getSettings: async () => ({ allowedCurrencies: null }) };
  args[9] = new ItemNumberService();
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

/** A company with its own chart of accounts holding account 6000 (the OPEX base row's). */
async function seedCompany(runner: QueryRunner, tenantId: string, name = COMPANY, chartCode = 'CSV') {
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, $2, $3, 'FR') RETURNING id`,
    [tenantId, chartCode, `${name} chart`],
  );
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, $2, 'FR', 'Lyon', $3) RETURNING id`,
    [tenantId, name, chart.id],
  );
  const [account] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6000, 'Csv test account') RETURNING id`,
    [tenantId, chart.id],
  );
  return { companyId: company.id as string, chartId: chart.id as string, accountId: account.id as string };
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
      assert.deepEqual(result.errors, [{ row: 3, message: 'Company is required unless the line has a cost center.' }], `CAPEX (dry run ${dryRun}): row error`);
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

async function seedSupplier(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  return supplier.id;
}

async function testOpexUnknownSupplierAndAccount() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-lookups');
    await seedCompany(runner, tenantId);
    await seedSupplier(runner, tenantId, 'Acme');
    await seedSupplier(runner, tenantId, 'Twin');
    await seedSupplier(runner, tenantId, 'TWIN');
    const svc = opexImporter();
    const headers = svc.csvHeaders();
    const file = csvFile(headers, [
      row('opex', 'Known supplier, other case', { supplier_name: '  aCME ' }),
      row('opex', 'Unknown supplier', { supplier_name: 'Nobody' }),
      row('opex', 'Unknown account', { account_number: '9999' }),
      row('opex', 'Ambiguous supplier', { supplier_name: 'twin' }),
      row('opex', 'Account beyond the integer range', { account_number: '99999999999' }),
    ]);
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file, dryRun, userId: null }, { manager: runner.manager });
      assert.equal(result.ok, false, `OPEX (dry run ${dryRun}): refused`);
      assert.deepEqual(result.errors, [
        { row: 3, message: "Supplier 'Nobody' not found" },
        { row: 4, message: `Account 9999 not found in ${COMPANY}'s chart of accounts` },
        { row: 5, message: "Supplier 'twin' matches more than one supplier" },
        { row: 6, message: `Account 99999999999 not found in ${COMPANY}'s chart of accounts` },
      ], `OPEX (dry run ${dryRun}): one row error per unknown supplier or account`);
    }
    assert.equal(await count(runner, 'spend_items', tenantId), 0, 'OPEX: nothing is written');

    const valid = await svc.importCsv(
      { file: csvFile(headers, [row('opex', 'Known supplier, other case', { supplier_name: 'acme' })]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.equal(valid.ok, true, `OPEX: a supplier matches whatever its case (${JSON.stringify(valid.errors)})`);
    const [stored] = await runner.query(
      `SELECT s.name FROM spend_items i JOIN suppliers s ON s.id = i.supplier_id WHERE i.tenant_id = $1`,
      [tenantId],
    );
    assert.equal(stored.name, 'Acme', 'OPEX: the supplier is set');

    // An exact name wins over its case variants: "TWIN" is TWIN, "Twin" is Twin.
    const exact = await svc.importCsv(
      { file: csvFile(headers, [row('opex', 'Upper twin line', { supplier_name: 'TWIN' }), row('opex', 'Lower twin line', { supplier_name: ' Twin ' })]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.equal(exact.ok, true, `OPEX: an exact supplier name is accepted beside its case variant (${JSON.stringify(exact.errors)})`);
    const twins = await runner.query(
      `SELECT i.product_name, s.name FROM spend_items i JOIN suppliers s ON s.id = i.supplier_id
       WHERE i.tenant_id = $1 AND i.product_name LIKE '%twin line' ORDER BY i.product_name`,
      [tenantId],
    );
    assert.deepEqual(twins.map((t: any) => [t.product_name, t.name]), [['Lower twin line', 'Twin'], ['Upper twin line', 'TWIN']], 'OPEX: each row gets the exact supplier');
  });
}

async function testOpexRepeatedLine() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-repeated');
    await seedCompany(runner, tenantId);
    await seedSupplier(runner, tenantId, 'Acme');
    await seedSupplier(runner, tenantId, 'Other');
    const svc = opexImporter();
    const headers = svc.csvHeaders();
    const file = csvFile(headers, [
      row('opex', 'Line', { supplier_name: 'Acme', y_budget: '100' }),
      row('opex', 'Line', { supplier_name: 'Other', y_budget: '200' }),
      row('opex', 'Line', { supplier_name: 'ACME ', y_budget: '900' }),
      row('opex', 'Line without supplier'),
      row('opex', 'Line without supplier', { notes: 'Again' }),
    ]);
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file, dryRun, userId: null }, { manager: runner.manager });
      assert.equal(result.ok, false, `OPEX (dry run ${dryRun}): a repeated line is refused`);
      assert.deepEqual(result.errors, [
        { row: 4, message: 'Same line as row 2' },
        { row: 6, message: 'Same line as row 5' },
      ], `OPEX (dry run ${dryRun}): the repeated rows point at the first one`);
    }
    assert.equal(await count(runner, 'spend_items', tenantId), 0, 'OPEX: nothing is written');
  });
}

async function testOpexAccountWithinCompanyChart() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-charts');
    const first = await seedCompany(runner, tenantId, COMPANY, 'CSV-A');
    const second = await seedCompany(runner, tenantId, 'Second csv company', 'CSV-B');
    const svc = opexImporter();
    const headers = svc.csvHeaders();
    const result = await svc.importCsv(
      {
        file: csvFile(headers, [
          row('opex', 'First company line'),
          row('opex', 'Second company line', { company_name: 'Second csv company' }),
        ]),
        dryRun: false,
        userId: null,
      },
      { manager: runner.manager },
    );
    assert.equal(result.ok, true, `OPEX: imported (${JSON.stringify(result.errors)})`);
    const stored = await runner.query(
      `SELECT product_name, account_id FROM spend_items WHERE tenant_id = $1 ORDER BY product_name`,
      [tenantId],
    );
    assert.deepEqual(
      stored.map((s: any) => [s.product_name, s.account_id]),
      [['First company line', first.accountId], ['Second company line', second.accountId]],
      'OPEX: account 6000 exists in both charts and resolves to each company\'s own',
    );
  });
}

async function testOpexBlankSupplierMatch() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-blank-supplier');
    await seedCompany(runner, tenantId);
    const acme = await seedSupplier(runner, tenantId, 'Acme');
    const svc = opexImporter();
    const headers = svc.csvHeaders();
    const seeded = await svc.importCsv(
      { file: csvFile(headers, [row('opex', 'Shared name', { supplier_name: 'Acme', notes: 'Acme line' })]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.equal(seeded.ok, true, `OPEX: seed line imported (${JSON.stringify(seeded.errors)})`);

    const file = csvFile(headers, [row('opex', 'Shared name', { notes: 'Line without supplier' })]);
    const dry = await svc.importCsv({ file, dryRun: true, userId: null }, { manager: runner.manager });
    assert.deepEqual([dry.ok, dry.inserted, dry.updated], [true, 1, 0], 'OPEX: a blank supplier is a new line, not the supplier\'s line');
    const load = await svc.importCsv({ file, dryRun: false, userId: null }, { manager: runner.manager });
    assert.deepEqual([load.ok, load.inserted, load.updated], [true, 1, 0], 'OPEX: the load agrees with the dry run');
    const stored = await runner.query(
      `SELECT supplier_id, notes FROM spend_items WHERE tenant_id = $1 AND product_name = 'Shared name' ORDER BY notes`,
      [tenantId],
    );
    assert.deepEqual(
      stored.map((s: any) => [s.supplier_id, s.notes]),
      [[acme, 'Acme line'], [null, 'Line without supplier']],
      'OPEX: the supplier\'s line keeps its supplier',
    );

    const again = await svc.importCsv(
      { file: csvFile(headers, [row('opex', 'Shared name', { notes: 'Updated without supplier' })]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.deepEqual([again.ok, again.inserted, again.updated], [true, 0, 1], 'OPEX: a blank supplier matches the line without one');
  });
}

async function testCapexRepeatedLine() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-capex-repeated');
    await seedCompany(runner, tenantId);
    await seedItem(runner, 'capex', tenantId, 1, 'Existing line');
    const svc = capexImporter();
    const headers = svc.csvHeaders();
    const file = csvFile(headers, [
      row('capex', 'Existing line', { item_number: 'CPX-1', y_budget: '100' }),
      row('capex', 'Server refresh', { y_budget: '200' }),
      row('capex', 'Renamed existing line', { item_number: '1', y_budget: '900' }),
      row('capex', 'Server refresh', { y_budget: '300' }),
      row('capex', 'server refresh'),
    ]);
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file, dryRun, userId: null }, { manager: runner.manager });
      assert.equal(result.ok, false, `CAPEX (dry run ${dryRun}): a repeated line is refused`);
      assert.deepEqual(result.errors, [
        { row: 4, message: 'Same line as row 2' },
        { row: 5, message: 'Same line as row 3' },
      ], `CAPEX (dry run ${dryRun}): the repeated rows point at the first one`);
    }
    assert.equal(await count(runner, 'capex_items', tenantId), 1, 'CAPEX: nothing is written');
  });
}

async function testEffectiveStartFormat(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `csv-start-${kind}`);
    await seedCompany(runner, tenantId);
    const svc = importer(kind);
    const headers = svc.csvHeaders();
    const file = csvFile(headers, [
      row(kind, 'Good start', { effective_start: '2026-03-01' }),
      row(kind, 'Not a date', { effective_start: 'soon' }),
      row(kind, 'No such day', { effective_start: '2026-02-30' }),
      row(kind, 'Spreadsheet format', { effective_start: '01/03/2026' }),
      row(kind, 'Date and time', { effective_start: '2026-03-01T00:00:00Z' }),
    ]);
    const message = 'effective_start must be a valid date in YYYY-MM-DD format';
    const result = await svc.importCsv({ file, dryRun: true, userId: null }, { manager: runner.manager });
    assert.equal(result.ok, false, `${kind}: a bad effective_start is refused in the dry run`);
    assert.deepEqual(result.errors, [3, 4, 5, 6].map((r) => ({ row: r, message })), `${kind}: YYYY-MM-DD calendar days only`);
  });
}

async function testBlankEffectiveStart(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `csv-blank-start-${kind}`);
    await seedCompany(runner, tenantId);
    const svc = importer(kind);
    const headers = svc.csvHeaders();
    const nameColumn = kind === 'opex' ? 'product_name' : 'description';
    const starts = async () => Object.fromEntries(
      (await runner.query(
        `SELECT ${nameColumn} AS name, to_char(effective_start, 'YYYY-MM-DD') AS start FROM ${itemTable(kind)} WHERE tenant_id = $1`,
        [tenantId],
      )).map((r: any) => [r.name, r.start]),
    );
    const created = await svc.importCsv(
      { file: csvFile(headers, [row(kind, 'Dated line', { effective_start: '2024-05-01' }), row(kind, 'Undated line')]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.equal(created.ok, true, `${kind}: seed lines imported (${JSON.stringify(created.errors)})`);
    const Y = new Date().getFullYear();
    assert.deepEqual(await starts(), { 'Dated line': '2024-05-01', 'Undated line': `${Y}-01-01` }, `${kind}: a new line without a start begins on 1 January`);

    const update = await svc.importCsv(
      { file: csvFile(headers, [row(kind, 'Dated line', { notes: 'Edited' }), row(kind, 'Undated line', { effective_start: '2025-02-01' })]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.deepEqual([update.ok, update.updated], [true, 2], `${kind}: both lines updated (${JSON.stringify(update.errors)})`);
    assert.deepEqual(await starts(), { 'Dated line': '2024-05-01', 'Undated line': '2025-02-01' }, `${kind}: a blank start keeps the stored one; a given start replaces it`);
  });
}

async function testOpexCsvUpdateMovesUpdatedAt() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-updated-at');
    await seedCompany(runner, tenantId);
    const svc = opexImporter();
    const headers = svc.csvHeaders();
    const created = await svc.importCsv({ file: csvFile(headers, [row('opex', 'Edited line')]), dryRun: false, userId: null }, { manager: runner.manager });
    assert.equal(created.ok, true, `OPEX: seed line imported (${JSON.stringify(created.errors)})`);
    await runner.query(`UPDATE spend_items SET created_at = '2020-01-01', updated_at = '2020-01-01' WHERE tenant_id = $1`, [tenantId]);
    const before = Date.now();
    const updated = await svc.importCsv(
      { file: csvFile(headers, [row('opex', 'Edited line', { notes: 'Edited' })]), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.deepEqual([updated.ok, updated.updated], [true, 1]);
    const [stored] = await runner.query(`SELECT created_at, updated_at FROM spend_items WHERE tenant_id = $1`, [tenantId]);
    assert.ok(new Date(stored.updated_at).getTime() >= before - 1000, `OPEX: the CSV update moves updated_at (${stored.updated_at})`);
    assert.equal(new Date(stored.created_at).toISOString(), new Date('2020-01-01').toISOString(), 'OPEX: created_at kept');
  });
}

void runSpecs('csv-validation.integration.spec', [
  ...KINDS.flatMap((kind) => [
    [`testOwnersAreCheckedBeforeWriting(${kind})`, () => testOwnersAreCheckedBeforeWriting(kind)],
    [`testBlankCurrency(${kind})`, () => testBlankCurrency(kind)],
    [`testEffectiveStartFormat(${kind})`, () => testEffectiveStartFormat(kind)],
    [`testBlankEffectiveStart(${kind})`, () => testBlankEffectiveStart(kind)],
  ] as Array<[string, () => Promise<void>]>),
  ['testCapexCurrencyCompanyAndItemNumber', testCapexCurrencyCompanyAndItemNumber],
  ['testOpexUnknownSupplierAndAccount', testOpexUnknownSupplierAndAccount],
  ['testOpexAccountWithinCompanyChart', testOpexAccountWithinCompanyChart],
  ['testOpexBlankSupplierMatch', testOpexBlankSupplierMatch],
  ['testOpexRepeatedLine', testOpexRepeatedLine],
  ['testCapexRepeatedLine', testCapexRepeatedLine],
  ['testOpexCsvUpdateMovesUpdatedAt', testOpexCsvUpdateMovesUpdatedAt],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
