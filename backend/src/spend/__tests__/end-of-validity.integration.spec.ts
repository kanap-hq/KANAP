import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItemsService } from '../spend-items.service';
import { CapexItemsService } from '../spend-items.service';
import { ItemNumberService } from '../../common/item-number.service';
import { CAPEX_NUMBER_OFFSET } from './round-inputs.fixtures';
import { exportBudgetFile, loadBudgetFile, preflightBudgetFile } from './budget-file.fixtures';

// One end date per budget item, on OPEX and CAPEX against a real database:
// the budget file writes the end of validity (disabled_at) from its
// end_of_validity cell, the API accepts the deprecated effective_end as an
// alias of it, and a date filter on the end of validity combines with the
// default lifecycle filter of the lists.

type Kind = 'opex' | 'capex';

const noAudit = { log: async () => undefined };
const noFreeze = { assertNotFrozen: async () => undefined };
const COMPANY = 'End date test company';

// The summaries convert amounts to the reporting currency; the seeded items carry no amounts.
const identityFx = {
  resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
  convertValue: (value: number) => value,
};
const noAllocations = { computeForVersions: async () => new Map() };

function itemService(kind: Kind): any {
  // Since lot Z1 the CAPEX service is the OPEX one with its nature: the same constructor.
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[3] = noAudit;
  args[4] = noAllocations;
  args[5] = noFreeze;
  args[6] = identityFx;
  args[8] = { syncFromSupplier: async () => undefined };
  args[9] = { notifyStatusChange: () => undefined };
  args[10] = new ItemNumberService();
  return kind === 'opex' ? new (SpendItemsService as any)(...args) : new (CapexItemsService as any)(...args);
}

/** The lines of both natures live in `spend_items` since lot Z1; a CAPEX title is its `product_name`. */
const LINES = 'spend_items';
const natureIs = (kind: Kind) => `nature = '${kind}'`;

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
    // The OPEX rows' account 6000 must exist in the company's chart of accounts.
    const [chart] = await runner.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'EOV', 'End of validity test chart', 'FR') RETURNING id`,
      [tenantId],
    );
    const [company] = await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, $2, 'FR', 'Lyon', $3) RETURNING id`,
      [tenantId, COMPANY, chart.id],
    );
    await runner.query(
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6000, 'End of validity test account')`,
      [tenantId, chart.id],
    );
    await fn(runner, tenantId, company.id);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function readItem(runner: QueryRunner, kind: Kind, name: string) {
  const rows = await runner.query(
    `SELECT disabled_at, status::text AS status FROM ${LINES} WHERE tenant_id = current_setting('app.current_tenant')::uuid AND ${natureIs(kind)} AND product_name = $1`,
    [name],
  );
  assert.equal(rows.length, 1, `${kind}: one item named ${name}`);
  return { disabled_at: rows[0].disabled_at ? new Date(rows[0].disabled_at).toISOString() : null, status: rows[0].status as string };
}

/** A budget file of the type: detail columns, then one row per line (`item_number` blank for a new line). */
function budgetFile(kind: Kind, rows: Array<{ item?: number; name: string; end: string }>): string {
  const prefix = kind === 'opex' ? 'OPX' : 'CPX';
  const header = kind === 'opex'
    ? 'item_number,name,company_name,account_number,currency,effective_start,end_of_validity'
    : 'item_number,name,ppe_type,investment_type,priority,company_name,account_number,currency,effective_start,end_of_validity';
  const line = (row: { item?: number; name: string; end: string }) => {
    const number = row.item ? `${prefix}-${row.item}` : '';
    return kind === 'opex'
      ? `${number},${row.name},${COMPANY},6000,EUR,2019-01-01,${row.end}`
      : `${number},${row.name},hardware,replacement,medium,${COMPANY},6000,EUR,2019-01-01,${row.end}`;
  };
  return `${header}\n${rows.map(line).join('\n')}\n`;
}

/**
 * The end_of_validity cell of the budget file: a bare day is noon UTC, a full
 * ISO timestamp is kept, a passed day ends the line, a blank cell keeps the
 * stored date, `-` clears it, an impossible day is a row error. An export
 * reads back with no end of validity changed, one set in the app included.
 */
async function testBudgetFileEndOfValidity(kind: Kind) {
  await withTenant(`${kind}-file`, async (runner, tenantId) => {
    const created = await loadBudgetFile(runner.manager, kind, tenantId, budgetFile(kind, [
      { name: 'Noon day', end: '2031-06-30' },
      { name: 'Past day', end: '2020-01-31' },
      { name: 'Instant', end: '2031-04-15T08:30:00.000Z' },
      { name: 'No end', end: '' },
    ]));
    assert.equal((created as any).inserted, 4, `${kind} file: four lines created (${JSON.stringify((created as any).errors)})`);
    assert.deepEqual(await readItem(runner, kind, 'Noon day'), { disabled_at: '2031-06-30T12:00:00.000Z', status: 'enabled' }, `${kind} file: a bare day is noon UTC`);
    assert.deepEqual(await readItem(runner, kind, 'Past day'), { disabled_at: '2020-01-31T12:00:00.000Z', status: 'disabled' }, `${kind} file: a passed day ends the line`);
    assert.deepEqual(await readItem(runner, kind, 'Instant'), { disabled_at: '2031-04-15T08:30:00.000Z', status: 'enabled' }, `${kind} file: a full timestamp is kept`);
    assert.deepEqual(await readItem(runner, kind, 'No end'), { disabled_at: null, status: 'enabled' }, `${kind} file: no date, no end`);

    // The number the file names: a CAPEX line's CPX number (`legacy_number`), an OPEX line's own number.
    const numbers: Array<{ n: number; name: string }> = await runner.query(
      `SELECT ${kind === 'opex' ? 'item_number::int' : `(substring(legacy_number FROM '^CPX-([0-9]+)$'))::int`} AS n, product_name AS name
         FROM ${LINES} WHERE tenant_id = $1 AND ${natureIs(kind)} ORDER BY item_number`,
      [tenantId],
    );
    const item = (name: string) => numbers.find((row) => row.name === name)!.n;
    const updated = await loadBudgetFile(runner.manager, kind, tenantId, budgetFile(kind, [
      { item: item('Noon day'), name: 'Noon day', end: '' },
      { item: item('Past day'), name: 'Past day', end: '-' },
      { item: item('No end'), name: 'No end', end: '2032-12-31' },
    ]));
    assert.equal(updated.ok, true, `${kind} file update: accepted (${JSON.stringify((updated as any).errors)})`);
    assert.deepEqual(await readItem(runner, kind, 'Noon day'), { disabled_at: '2031-06-30T12:00:00.000Z', status: 'enabled' }, `${kind} file: a blank cell keeps the date`);
    assert.deepEqual(await readItem(runner, kind, 'Past day'), { disabled_at: null, status: 'enabled' }, `${kind} file: - clears the date and the line is active again`);
    assert.deepEqual(await readItem(runner, kind, 'No end'), { disabled_at: '2032-12-31T12:00:00.000Z', status: 'enabled' }, `${kind} file: a day sets the end`);

    const bad = await preflightBudgetFile(runner.manager, kind, tenantId, budgetFile(kind, [{ item: item('Instant'), name: 'Instant', end: '2031-02-30' }]));
    assert.equal(bad.ok, false, `${kind} file: an impossible day is refused`);
    assert.deepEqual(bad.errors.map((error) => [error.line, error.column]), [[2, 'end_of_validity']], `${kind} file: the row error names its line and column`);

    // A date set in the app (not noon UTC) exports as an instant and reads back as it is.
    await runner.query(
      `UPDATE ${LINES} SET disabled_at = '2031-09-30T21:59:00Z' WHERE tenant_id = $1 AND ${natureIs(kind)} AND product_name = 'Instant'`,
      [tenantId],
    );
    const names = ['Noon day', 'Past day', 'Instant', 'No end'];
    const read = () => Promise.all(names.map((name) => readItem(runner, kind, name)));
    const before = await read();
    const ids: Array<{ id: string }> = await runner.query(`SELECT id FROM ${LINES} WHERE tenant_id = $1 AND ${natureIs(kind)} ORDER BY item_number`, [tenantId]);
    const content = await exportBudgetFile(runner.manager, kind, tenantId, ids.map((row) => row.id));
    const report = await preflightBudgetFile(runner.manager, kind, tenantId, content);
    assert.deepEqual([report.ok, report.changes.unchanged, report.changes.updated], [true, 4, 0], `${kind} round trip: every line unchanged (${JSON.stringify(report.errors)})`);
    await loadBudgetFile(runner.manager, kind, tenantId, content);
    assert.deepEqual(await read(), before, `${kind} round trip: no end of validity changes`);
    assert.equal(before[2].disabled_at, '2031-09-30T21:59:00.000Z');
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

    const [row] = await runner.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = 'effective_end'`, [LINES]);
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
        `INSERT INTO spend_items (tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start, item_number, legacy_number, disabled_at, status)
         VALUES ($1, 'capex', $2, 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', $3, $4, $5, $6)`,
        [tenantId, name, n + CAPEX_NUMBER_OFFSET, `CPX-${n}`, disabledAt, status],
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
    const rows = await runner.query(`SELECT id, product_name AS name FROM ${LINES} WHERE tenant_id = $1 AND ${natureIs(kind)}`, [tenantId]);
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
        testBudgetFileEndOfValidity,
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
