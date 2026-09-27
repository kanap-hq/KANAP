import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItemsCsvService } from '../spend-items-csv.service';
import { SpendItemsService } from '../spend-items.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { ItemNumberService } from '../../common/item-number.service';

// One end date per budget item, on OPEX and CAPEX against a real database:
// the CSV files and the API accept the deprecated effective_end as an alias
// of the end of validity (disabled_at), and a date filter on the end of
// validity combines with the default lifecycle filter of the lists.

type Kind = 'opex' | 'capex';

const noAudit = { log: async () => undefined };
const noFreeze = { assertNotFrozen: async () => undefined };
const COMPANY = 'End date test company';

// The header row the importers wrote before the single end date (effective_end included).
const PRE_L_HEADERS: Record<Kind, string[]> = {
  opex: [
    'product_name', 'description', 'supplier_name', 'company_name', 'account_number', 'currency', 'effective_start', 'effective_end',
    'status', 'disabled_at', 'owner_it_email', 'owner_business_email', 'analytics_category', 'notes', 'y_minus1_budget',
    'y_minus1_landing', 'y_budget', 'y_follow_up', 'y_landing', 'y_revision', 'y_plus1_budget', 'y_plus1_revision',
  ],
  capex: [
    'item_number', 'description', 'ppe_type', 'investment_type', 'priority', 'currency', 'effective_start', 'effective_end', 'status',
    'disabled_at', 'notes', 'company_name', 'owner_it_email', 'owner_business_email', 'analytics_category', 'y_minus1_budget',
    'y_minus1_landing', 'y_budget', 'y_follow_up', 'y_landing', 'y_revision', 'y_plus1_budget', 'y_plus1_revision', 'y_plus2_budget',
  ],
};

function csvImporter(kind: Kind): any {
  if (kind === 'opex') {
    const args: any[] = Array.from({ length: 11 }, () => undefined);
    args[7] = noAudit;
    args[8] = noFreeze;
    args[9] = { getSettings: async () => ({ allowedCurrencies: null }) };
    args[10] = new ItemNumberService();
    return new (SpendItemsCsvService as any)(...args);
  }
  return itemService('capex');
}

// The summaries convert amounts to the reporting currency; the seeded items carry no amounts.
const identityFx = {
  resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
  convertValue: (value: number) => value,
};
const noAllocations = { computeForVersions: async () => new Map() };

function itemService(kind: Kind): any {
  if (kind === 'opex') {
    const args: any[] = Array.from({ length: 13 }, () => undefined);
    args[4] = noAudit;
    args[5] = noAllocations;
    args[8] = identityFx;
    args[10] = { syncFromSupplier: async () => undefined };
    args[11] = { notifyStatusChange: () => undefined };
    args[12] = new ItemNumberService();
    return new (SpendItemsService as any)(...args);
  }
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[4] = noAllocations;
  args[5] = noAudit;
  args[6] = noFreeze;
  args[7] = identityFx;
  args[9] = { syncFromSupplier: async () => undefined };
  args[10] = new ItemNumberService();
  args[11] = { notifyStatusChange: () => undefined };
  return new (CapexItemsService as any)(...args);
}

function table(kind: Kind) {
  return kind === 'opex' ? 'spend_items' : 'capex_items';
}

async function withTenant(tag: string, fn: (runner: QueryRunner, tenantId: string, companyId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `eov-${tag}-${tenantId.slice(0, 8)}`, `End of validity test ${tag}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [company] = await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
      [tenantId, COMPANY],
    );
    await fn(runner, tenantId, company.id);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

function csvFile(headers: string[], rows: Array<Record<string, string>>) {
  const lines = rows.map((values) => headers.map((h) => values[h] ?? '').join(';'));
  return { buffer: Buffer.from(`${headers.join(';')}\n${lines.join('\n')}\n`, 'utf8') } as any;
}

function csvRow(kind: Kind, name: string, extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = kind === 'opex'
    ? { product_name: name, company_name: COMPANY, account_number: '6000', currency: 'EUR', effective_start: '2030-01-01', status: 'enabled' }
    : { description: name, ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', currency: 'EUR', effective_start: '2030-01-01', status: 'enabled', company_name: COMPANY };
  return { ...base, ...extra };
}

async function readItem(runner: QueryRunner, kind: Kind, name: string) {
  const nameColumn = kind === 'opex' ? 'product_name' : 'description';
  const rows = await runner.query(
    `SELECT disabled_at, status::text AS status FROM ${table(kind)} WHERE tenant_id = current_setting('app.current_tenant')::uuid AND ${nameColumn} = $1`,
    [name],
  );
  assert.equal(rows.length, 1, `${kind}: one item named ${name}`);
  return { disabled_at: rows[0].disabled_at ? new Date(rows[0].disabled_at).toISOString() : null, status: rows[0].status as string };
}

async function testCsvLegacyEndDate(kind: Kind) {
  await withTenant(`${kind}-csv`, async (runner) => {
    const svc = csvImporter(kind);
    const current: string[] = svc.csvHeaders.call(svc);
    assert.ok(!current.includes('effective_end'), `${kind} CSV headers no longer carry effective_end`);
    const headers = [...current, 'effective_end'];
    const result = await svc.importCsv({
      file: csvFile(headers, [
        csvRow(kind, 'Fills empty', { effective_end: '2031-06-30' }),
        csvRow(kind, 'Never overrides', { disabled_at: '2031-03-01', effective_end: '2031-06-30' }),
        csvRow(kind, 'Empty keeps', { disabled_at: '2031-04-15T08:30:00.000Z', effective_end: '' }),
        csvRow(kind, 'Past legacy', { effective_end: '2020-01-31' }),
        csvRow(kind, 'No end', {}),
      ]),
      dryRun: false,
      userId: null,
    }, { manager: runner.manager });
    assert.equal(result.ok, true, `${kind} CSV with legacy column: accepted (${JSON.stringify(result.errors)})`);

    assert.deepEqual(await readItem(runner, kind, 'Fills empty'), { disabled_at: '2031-06-30T12:00:00.000Z', status: 'enabled' }, `${kind} CSV: legacy effective_end fills an empty end of validity at noon UTC`);
    assert.deepEqual(await readItem(runner, kind, 'Never overrides'), { disabled_at: '2031-03-01T12:00:00.000Z', status: 'enabled' }, `${kind} CSV: a set disabled_at wins, a bare day at noon UTC`);
    assert.deepEqual(await readItem(runner, kind, 'Empty keeps'), { disabled_at: '2031-04-15T08:30:00.000Z', status: 'enabled' }, `${kind} CSV: an empty effective_end clears nothing, a full timestamp is kept`);
    assert.deepEqual(await readItem(runner, kind, 'Past legacy'), { disabled_at: '2020-01-31T12:00:00.000Z', status: 'disabled' }, `${kind} CSV: a past legacy date disables the item`);
    assert.deepEqual(await readItem(runner, kind, 'No end'), { disabled_at: null, status: 'enabled' }, `${kind} CSV: no date, no end`);

    const bad = await svc.importCsv({
      file: csvFile(headers, [csvRow(kind, 'Bad legacy', { effective_end: '2031-02-30' })]),
      dryRun: true,
      userId: null,
    }, { manager: runner.manager });
    assert.equal(bad.ok, false, `${kind} CSV: an impossible legacy date is a row error`);
    assert.equal(bad.errors[0]?.row, 2);
  });
}

async function testCsvExportHasNoEffectiveEnd(kind: Kind) {
  await withTenant(`${kind}-export`, async (runner) => {
    const svc = csvImporter(kind);
    const template = await svc.exportCsv('template', { manager: runner.manager });
    const header = template.content.replace(/^﻿/, '').split('\n')[0].split(';');
    assert.ok(!header.includes('effective_end'), `${kind} template export: no effective_end`);
    assert.ok(header.includes('disabled_at'), `${kind} template export: disabled_at`);
    if (kind === 'opex') {
      await svc.importCsv({ file: csvFile(header, [csvRow(kind, 'Exported', { disabled_at: '2031-06-30' })]), dryRun: false, userId: null }, { manager: runner.manager });
      const data = await svc.exportCsv('data', { manager: runner.manager });
      const [head, row] = data.content.replace(/^﻿/, '').split('\n');
      assert.deepEqual(head.split(';'), header, 'opex data export: same header as the template');
      assert.ok(row.includes('2031-06-30T12:00:00.000Z'), `opex data export: full end of validity timestamp (${row})`);
    }
  });
}

/**
 * CAPEX export then import of the same file: the export writes the UTC day of
 * the end of validity, which re-imports at noon UTC. A noon row (a file, the
 * AI, the migration) comes back identical; a row set in the app keeps its day.
 */
async function testCapexExportImportRoundTrip(kind: Kind) {
  if (kind !== 'capex') return;
  await withTenant('capex-roundtrip', async (runner) => {
    const svc = itemService('capex');
    const opts = { manager: runner.manager };
    const header: string[] = svc.csvHeaders.call(svc);
    const seeded = await svc.importCsv({
      file: csvFile(header, [
        csvRow('capex', 'Noon row', { disabled_at: '2031-06-30' }),
        csvRow('capex', 'App row', { disabled_at: '2031-09-30T21:59:00.000Z' }),
        csvRow('capex', 'Open row', {}),
      ]),
      dryRun: false,
      userId: null,
    }, opts);
    assert.equal(seeded.ok, true, `capex round trip seed: accepted (${JSON.stringify(seeded.errors)})`);
    const names = ['Noon row', 'App row', 'Open row'];
    const before = await Promise.all(names.map((name) => readItem(runner, 'capex', name)));

    const exported = await svc.exportCsv('data', opts);
    const lines = exported.content.replace(/^\uFEFF/, '').trim().split('\n');
    assert.deepEqual(lines[0].split(';'), header, 'capex data export: the import header');
    assert.equal(lines.length, 4, 'capex data export: three rows');
    const reimported = await svc.importCsv({ file: { buffer: Buffer.from(exported.content, 'utf8') }, dryRun: false, userId: null }, opts);
    assert.equal(reimported.ok, true, `capex round trip: accepted (${JSON.stringify(reimported.errors)})`);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM capex_items WHERE tenant_id = current_setting('app.current_tenant')::uuid`);
    assert.equal(n, 3, 'capex round trip: the rows are updated, not duplicated');

    const after = await Promise.all(names.map((name) => readItem(runner, 'capex', name)));
    assert.deepEqual(after[0], before[0], 'capex round trip: a noon end of validity comes back identical');
    assert.deepEqual(before[0], { disabled_at: '2031-06-30T12:00:00.000Z', status: 'enabled' });
    assert.equal(after[1].disabled_at, '2031-09-30T12:00:00.000Z', 'capex round trip: an end of validity set in the app keeps its day');
    assert.deepEqual(after[2], { disabled_at: null, status: 'enabled' }, 'capex round trip: no end stays no end');
  });
}

async function testPreLExportImports(kind: Kind) {
  await withTenant(`${kind}-prel`, async (runner) => {
    const svc = csvImporter(kind);
    // A new line with its amounts, in one go.
    const values = csvRow(kind, 'Pre-L line', { effective_end: '2031-12-31', y_budget: '1200' });
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file: csvFile(PRE_L_HEADERS[kind], [values]), dryRun, userId: null }, { manager: runner.manager });
      assert.equal(result.ok, true, `${kind} pre-L export (dry run ${dryRun}): accepted (${JSON.stringify(result.errors)})`);
      assert.deepEqual(result.errors, [], `${kind} pre-L export (dry run ${dryRun}): zero row errors`);
    }
    assert.deepEqual(await readItem(runner, kind, 'Pre-L line'), { disabled_at: '2031-12-31T12:00:00.000Z', status: 'enabled' });
    const [versionTable, amountTable, itemColumn, nameColumn] = kind === 'opex'
      ? ['spend_versions', 'spend_amounts', 'spend_item_id', 'product_name']
      : ['capex_versions', 'capex_amounts', 'capex_item_id', 'description'];
    const [budget] = await runner.query(
      `SELECT count(a.*)::int AS months, coalesce(sum(a.planned), 0)::numeric AS total
       FROM ${table(kind)} i
       JOIN ${versionTable} v ON v.tenant_id = i.tenant_id AND v.${itemColumn} = i.id AND v.budget_year = $2
       JOIN ${amountTable} a ON a.tenant_id = v.tenant_id AND a.version_id = v.id
       WHERE i.tenant_id = current_setting('app.current_tenant')::uuid AND i.${nameColumn} = $1`,
      ['Pre-L line', new Date().getFullYear()],
    );
    assert.deepEqual({ months: budget.months, total: Number(budget.total) }, { months: 12, total: 1200 }, `${kind} pre-L export: the Budget of the new line`);
  });
}

function createBody(kind: Kind, companyId: string, name: string, extra: Record<string, unknown>) {
  const base = kind === 'opex'
    ? { product_name: name, currency: 'EUR', effective_start: '2030-01-01', paying_company_id: companyId }
    : { description: name, ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', currency: 'EUR', effective_start: '2030-01-01', paying_company_id: companyId };
  return { ...base, ...extra };
}

async function testApiAlias(kind: Kind) {
  await withTenant(`${kind}-api`, async (runner, _tenantId, companyId) => {
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);

    const onlyLegacy = await svc.create(createBody(kind, companyId, 'Api legacy', { effective_end: '2031-06-30' }), undefined, opts);
    assert.equal(iso(onlyLegacy.disabled_at), '2031-06-30T12:00:00.000Z', `${kind} create: effective_end alone sets the end of validity at noon UTC`);
    assert.equal(onlyLegacy.status, 'enabled');

    const both = await svc.create(createBody(kind, companyId, 'Api both', { effective_end: '2031-06-30', disabled_at: '2031-09-30T21:59:00.000Z' }), undefined, opts);
    assert.equal(iso(both.disabled_at), '2031-09-30T21:59:00.000Z', `${kind} create: a given disabled_at wins`);

    const plain = await svc.create(createBody(kind, companyId, 'Api plain', { disabled_at: '2031-01-31T22:59:00.000Z' }), undefined, opts);
    assert.equal(iso(plain.disabled_at), '2031-01-31T22:59:00.000Z', `${kind} create: disabled_at is accepted on create`);

    const updated = await svc.update(plain.id, { effective_end: '2032-03-31' }, undefined, opts);
    assert.equal(iso(updated.disabled_at), '2032-03-31T12:00:00.000Z', `${kind} update: effective_end alone sets the end of validity`);

    const kept = await svc.update(plain.id, { effective_end: '2033-03-31', disabled_at: '2032-12-31T12:00:00.000Z' }, undefined, opts);
    assert.equal(iso(kept.disabled_at), '2032-12-31T12:00:00.000Z', `${kind} update: a given disabled_at wins`);

    const untouched = await svc.update(plain.id, { effective_end: null, notes: 'n' }, undefined, opts);
    assert.equal(iso(untouched.disabled_at), '2032-12-31T12:00:00.000Z', `${kind} update: a null effective_end never clears`);

    const bareDay = await svc.create(createBody(kind, companyId, 'Api bare day', { disabled_at: '2031-06-30' }), undefined, opts);
    assert.equal(iso(bareDay.disabled_at), '2031-06-30T12:00:00.000Z', `${kind} create: a bare disabled_at day is noon UTC, as everywhere else`);

    const legacyTimestamp = await svc.update(bareDay.id, { effective_end: '2031-12-31T00:00:00Z' }, undefined, opts);
    assert.equal(iso(legacyTimestamp.disabled_at), '2031-12-31T00:00:00.000Z', `${kind} update: effective_end takes a full timestamp too`);

    await assert.rejects(
      svc.update(bareDay.id, { disabled_at: 'someday' }, undefined, opts),
      (err: any) => err?.status === 400 && /disabled_at: Invalid date/.test(err.message),
      `${kind} update: a disabled_at that is not a date is refused`,
    );

    const past = await svc.update(plain.id, { effective_end: '2020-06-30' }, undefined, opts);
    assert.equal(past.status, 'disabled', `${kind} update: a past legacy date disables the item`);

    const [row] = await runner.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = 'effective_end'`, [table(kind)]);
    assert.equal(row.n, 0, `${kind}: effective_end is not a column any more`);
  });
}

async function seedListItems(runner: QueryRunner, kind: Kind, tenantId: string) {
  // A Wednesday before a Friday: compared as strings, the later date would sort first.
  const items: Array<[string, string | null]> = [
    ['No end', null],
    ['Ends 2031', '2031-12-31T12:00:00Z'],
    ['Ended 2020', '2020-06-30T12:00:00Z'],
    ['Ends 2032', '2032-01-02T12:00:00Z'],
  ];
  let n = 0;
  for (const [name, disabledAt] of items) {
    n += 1;
    const status = disabledAt && new Date(disabledAt) <= new Date() ? 'disabled' : 'enabled';
    if (kind === 'opex') {
      await runner.query(
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, disabled_at, status)
         VALUES ($1, $2, 'EUR', '2020-01-01', $3, $4, $5)`,
        [tenantId, name, n, disabledAt, status],
      );
    } else {
      await runner.query(
        `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number, disabled_at, status)
         VALUES ($1, $2, 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', $3, $4, $5)`,
        [tenantId, name, n, disabledAt, status],
      );
    }
  }
}

async function testListDateFilterKeepsLifecycle(kind: Kind) {
  await withTenant(`${kind}-list`, async (runner, tenantId) => {
    await seedListItems(runner, kind, tenantId);
    const svc = itemService(kind);
    const nameOf = (row: any) => (kind === 'opex' ? row.product_name : row.description);
    const before2032 = JSON.stringify({ disabled_at: { filterType: 'date', type: 'lessThan', dateFrom: '2032-01-01 00:00:00' } });
    const opts = { manager: runner.manager };

    // CAPEX list rows go through enrichSummaryItems (name lookups): the raw rows are enough here.
    if (kind === 'capex') svc.enrichSummaryItems = async (rows: any[]) => rows;

    const filtered = await svc.list({ filters: before2032, sort: 'item_number:ASC' }, opts);
    assert.deepEqual(filtered.items.map(nameOf), ['Ends 2031'], `${kind} list: date filter AND default lifecycle (enabled)`);

    const all = await svc.list({ sort: 'item_number:ASC' }, opts);
    assert.deepEqual(all.items.map(nameOf), ['No end', 'Ends 2031', 'Ends 2032'], `${kind} list: default lifecycle alone`);

    const withDisabled = await svc.list({ filters: before2032, includeDisabled: 'true', sort: 'item_number:ASC' }, opts);
    assert.deepEqual(withDisabled.items.map(nameOf), ['Ends 2031', 'Ended 2020'], `${kind} list: date filter alone when disabled items are included`);

    // Two conditions on the column (the grid's second condition, or the AI's end_of_validity and effective_end): both apply.
    const range = JSON.stringify({ disabled_at: { filterType: 'date', operator: 'AND', conditions: [
      { filterType: 'date', type: 'greaterThan', dateFrom: '2031-07-01 00:00:00' },
      { filterType: 'date', type: 'lessThan', dateFrom: '2032-06-01 00:00:00' },
    ] } });
    const ranged = await svc.list({ filters: range, includeDisabled: 'true', sort: 'item_number:ASC' }, opts);
    assert.deepEqual(ranged.items.map(nameOf), ['Ends 2031', 'Ends 2032'], `${kind} list: both conditions of a combined date filter`);
    const upper = JSON.stringify({ disabled_at: { filterType: 'date', operator: 'AND', conditions: [
      { filterType: 'date', type: 'greaterThan', dateFrom: '2031-07-01 00:00:00' },
      { filterType: 'date', type: 'lessThan', dateFrom: '2032-01-01 00:00:00' },
    ] } });
    const upperBound = await svc.list({ filters: upper, includeDisabled: 'true', sort: 'item_number:ASC' }, opts);
    assert.deepEqual(upperBound.items.map(nameOf), ['Ends 2031'], `${kind} list: the second condition is applied too`);

    const blank = await svc.list({ filters: JSON.stringify({ disabled_at: { filterType: 'date', type: 'blank' } }), sort: 'item_number:ASC' }, opts);
    assert.deepEqual(blank.items.map(nameOf), ['No end'], `${kind} list: blank end of validity`);

    const sorted = await svc.list({ sort: 'disabled_at:DESC' }, opts);
    assert.deepEqual(sorted.items.map(nameOf), ['No end', 'Ends 2032', 'Ends 2031'], `${kind} list: sorted on the end of validity`);

    if (kind === 'opex') {
      const ids = await svc.summaryIds({ filters: before2032, sort: 'item_number:ASC' }, opts);
      assert.equal(ids.total, 1, 'opex summary ids: date filter AND default lifecycle');
    }
  });
}

/**
 * The summaries sort on the end of validity in memory when a quick search is
 * given (in SQL otherwise): chronological order, blanks last ascending, first descending.
 */
async function testSummarySortsByDate(kind: Kind) {
  await withTenant(`${kind}-sort`, async (runner, tenantId) => {
    await seedListItems(runner, kind, tenantId);
    const svc = itemService(kind);
    const nameOf = (row: any) => (kind === 'opex' ? row.product_name : row.description);
    const opts = { manager: runner.manager };
    // "end" matches every seeded name, so the quick search keeps them all and forces the in-memory sort.
    const search = { q: 'end' };
    const rows = await runner.query(`SELECT id, ${kind === 'opex' ? 'product_name' : 'description'} AS name FROM ${table(kind)} WHERE tenant_id = $1`, [tenantId]);
    const nameById = new Map(rows.map((r: any) => [r.id, r.name]));

    const asc = await svc.summary({ ...search, sort: 'disabled_at:ASC' }, opts);
    assert.deepEqual(asc.items.map(nameOf), ['Ends 2031', 'Ends 2032', 'No end'], `${kind} summary: ascending end of validity`);
    const desc = await svc.summary({ ...search, sort: 'disabled_at:DESC' }, opts);
    assert.deepEqual(desc.items.map(nameOf), ['No end', 'Ends 2032', 'Ends 2031'], `${kind} summary: descending end of validity`);

    const ids = await svc.summaryIds({ ...search, sort: 'disabled_at:ASC' }, opts);
    assert.deepEqual(ids.ids.map((id: string) => nameById.get(id)), ['Ends 2031', 'Ends 2032', 'No end'], `${kind} summary ids: ascending end of validity`);
    const inSql = await svc.summary({ sort: 'disabled_at:ASC' }, opts);
    assert.deepEqual(inSql.items.map(nameOf), ['Ends 2031', 'Ends 2032', 'No end'], `${kind} summary: the same order sorted in SQL`);
  });
}

/** The summaries scope to items active since the first year shown, AND the user's date filter. */
async function testSummaryDateFilterWithActiveSince(kind: Kind) {
  await withTenant(`${kind}-since`, async (runner, tenantId) => {
    await seedListItems(runner, kind, tenantId);
    const svc = itemService(kind);
    const nameOf = (row: any) => (kind === 'opex' ? row.product_name : row.description);
    const opts = { manager: runner.manager };
    const before2032 = JSON.stringify({ disabled_at: { filterType: 'date', type: 'lessThan', dateFrom: '2032-01-01 00:00:00' } });

    const filtered = await svc.summary({ filters: before2032, sort: 'item_number:ASC' }, opts);
    assert.deepEqual(filtered.items.map(nameOf), ['Ends 2031'], `${kind} summary: date filter AND active since the first year shown`);

    const all = await svc.summary({ sort: 'item_number:ASC' }, opts);
    assert.deepEqual(all.items.map(nameOf), ['No end', 'Ends 2031', 'Ends 2032'], `${kind} summary: active since the first year shown`);
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const kind of ['opex', 'capex'] as Kind[]) {
      for (const test of [
        testCsvLegacyEndDate,
        testCsvExportHasNoEffectiveEnd,
        testCapexExportImportRoundTrip,
        testPreLExportImports,
        testApiAlias,
        testListDateFilterKeepsLifecycle,
        testSummarySortsByDate,
        testSummaryDateFilterWithActiveSince,
      ]) {
        try {
          await test(kind);
        } catch (err) {
          failures.push(`${test.name}(${kind}): ${(err as Error).message.split('\n')[0]}`);
        }
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`end-of-validity.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('end-of-validity.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
