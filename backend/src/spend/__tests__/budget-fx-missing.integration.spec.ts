import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { SUMMARY_SCOPES } from '../spend-summary.builder';
import * as engine from '../budget-list/budget-list.service';
import { realSummaryDeps } from './oracle/oracle-deps';
import { seedCompany } from './cost-center.fixtures';
import { budgetFxMissingYears } from '../../ai/query/ai-query.executor';
import { listRelatedBudgetLines } from '../../common/relations/related-objects';
import { assert, inRolledBackTransaction, runSpecs, seedItem, seedMonths, seedTenant, seedVersion } from './round-inputs.fixtures';

// Amounts without an exchange rate (PR 3, run A): a version whose line currency has no rate for its
// year is left out of every sum, sort and filter in the reporting currency, never counted at 1, and
// the answers say so. EUR is the reporting currency; the year's live set rates USD and GBP, not
// JPY. A version pinned to a snapshot set converts at the snapshot's rate.

const Y = new Date().getFullYear();
const scope = SUMMARY_SCOPES.opex;
const deps = realSummaryDeps(scope);

type Seeded = { tenantId: string; lines: Record<string, string> };

async function seed(runner: QueryRunner): Promise<Seeded> {
  const tenantId = await seedTenant(runner, 'fx-missing');
  await runner.query(
    `INSERT INTO currencies (code, name) VALUES ('EUR', 'Euro'), ('USD', 'US dollar'), ('GBP', 'Pound sterling'), ('JPY', 'Yen')
     ON CONFLICT (code) DO NOTHING`,
  );
  await runner.query(
    `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', $3::jsonb)`,
    [tenantId, Y, JSON.stringify({ USD: 0.5, GBP: 1.2 })],
  );
  const [snapshot] = await runner.query(
    `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, captured_at) VALUES ($1, $2, 'EUR', $3::jsonb, now() - interval '1 year') RETURNING id`,
    [tenantId, Y, JSON.stringify({ USD: 0.25 })],
  );
  let number = 0;
  const line = async (name: string, currency: string, planned: number, opts: { snapshot?: boolean } = {}) => {
    number += 1;
    const itemId = await seedItem(runner, 'opex', tenantId, number, name);
    await runner.query(`UPDATE spend_items SET currency = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, itemId, currency]);
    const versionId = await seedVersion(runner, 'opex', tenantId, itemId, Y);
    if (opts.snapshot) await runner.query(`UPDATE spend_versions SET fx_rate_set_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, versionId, snapshot.id]);
    await seedMonths(runner, 'opex', tenantId, versionId, Y, { planned: [planned, ...Array(11).fill(0)] });
    return itemId;
  };
  const lines: Record<string, string> = {};
  lines.eur = await line('Euro line', 'EUR', 1000);
  lines.usd = await line('Dollar line', 'USD', 400);
  lines.gbp = await line('Pound line', 'GBP', 100);
  lines.pinned = await line('Pinned dollar line', 'USD', 400, { snapshot: true });
  lines.jpy = await line('Yen line', 'JPY', 300);
  lines.jpy2 = await line('Second yen line', 'JPY', 700, { snapshot: true });
  return { tenantId, lines };
}

const all = { includeDisabled: 'true' };
const notYen = { ...all, filters: JSON.stringify({ currency: { filterType: 'set', values: ['EUR', 'USD', 'GBP'] } }) };
const oneYen = { ...all, filters: JSON.stringify({ product_name: { filterType: 'text', type: 'notContains', filter: 'Second' } }) };

const tests: Array<[string, () => Promise<void>]> = [
  ['totals leave out the versions without a rate and name them', () => inRolledBackTransaction(async (runner) => {
    await seed(runner);
    const m = runner.manager;
    // 1000 + 400 × 0.5 + 100 × 1.2 + 400 × 0.25 (snapshot); the 300 and 700 JPY are left out.
    const totals = await engine.budgetListTotals(scope, deps, { ...all, amounts: 'yBudget' }, m);
    assert.equal(totals.yBudget, 1420, 'the reporting currency and the converted lines to the cent');
    assert.equal(totals.reportingCurrency, 'EUR');
    assert.deepEqual(totals.fxMissing, [{ currency: 'JPY', year: Y, lines: 2 }], 'the left-out pair with its lines');
    const scoped = await engine.budgetListTotals(scope, deps, { ...oneYen, amounts: 'yBudget' }, m);
    assert.deepEqual(scoped.fxMissing, [{ currency: 'JPY', year: Y, lines: 1 }], 'only the lines in scope');
    const none = await engine.budgetListTotals(scope, deps, { ...notYen, amounts: 'yBudget' }, m);
    assert.equal(none.yBudget, 1420, 'the same sum without the yen lines');
    assert.deepEqual(none.fxMissing, [], 'a filter that leaves the lines out leaves the pair out');
    const otherYear = await engine.budgetListTotals(scope, deps, { ...all, amounts: `yPlus1Budget` }, m);
    assert.deepEqual(otherYear.fxMissing, [], 'no version that year, nothing left out');
  })],
  ['aggregates leave the amounts out of every measure and name them', () => inRolledBackTransaction(async (runner) => {
    await seed(runner);
    const m = runner.manager;
    const result = await engine.budgetListAggregate(scope, deps, all, {
      groupBy: ['currency'],
      measures: [{ id: 'sum', fn: 'sum', field: 'yBudget' }, { id: 'avg', fn: 'avg', field: 'yBudget' }, { id: 'max', fn: 'max', field: 'yBudget' }],
      order: [{ by: 'key', index: 0, dir: 'ASC' }],
    }, m);
    const jpy = result.groups.find((group) => group.keys[0] === 'JPY')!;
    assert.equal(jpy.count, 2, 'the lines stay in their group');
    assert.deepEqual(jpy.values, { sum: 0, avg: null, max: null }, 'with no amount counted');
    const usd = result.groups.find((group) => group.keys[0] === 'USD')!;
    assert.deepEqual(usd.values, { sum: 300, avg: 150, max: 200 }, 'live and snapshot rates count');
    assert.equal(result.total.count, 6);
    assert.deepEqual(result.total.values, { sum: 1420, avg: 355, max: 1000 }, 'the mean counts the converted lines only');
    assert.deepEqual(result.fxMissing, [{ currency: 'JPY', year: Y, lines: 2 }]);
    const scoped = await engine.budgetListAggregate(scope, deps, notYen, { groupBy: [], measures: [{ id: 'sum', fn: 'sum', field: 'yBudget' }] }, m);
    assert.deepEqual(scoped.fxMissing, [], 'out of scope, not named');
    const local = await engine.budgetListAggregate(scope, deps, all, { groupBy: [], measures: [{ id: 'sum', fn: 'sum', field: 'local_yBudget' }] }, m);
    assert.deepEqual(local.fxMissing, [], 'amounts in the lines\' own currencies leave nothing out');
    const parts = await engine.budgetListAggregate(scope, deps, all, {
      groupBy: [], measures: [{ id: 'up', fn: 'avg', field: 'yBudget', minus: 'yPlus1Budget', part: 'positive' }],
    }, m);
    assert.equal(parts.total.values.up, 355, 'a positive part keeps a line without a rate out of the mean');
  })],
  ['an amount without a rate sorts last both ways and matches no amount filter', () => inRolledBackTransaction(async (runner) => {
    const { lines } = await seed(runner);
    const m = runner.manager;
    const yen = new Set([lines.jpy, lines.jpy2]);
    for (const dir of ['ASC', 'DESC']) {
      const { ids } = await engine.budgetListIds(scope, deps, { ...all, sort: `yBudget:${dir}` }, m);
      assert.deepEqual(ids.slice(-2).sort(), Array.from(yen).sort(), `${dir}: the yen lines last`);
      assert.ok(ids.slice(0, -2).every((id) => !yen.has(id)), `${dir}: the others first`);
    }
    const asc = await engine.budgetListIds(scope, deps, { ...all, sort: 'yBudget:ASC' }, m);
    assert.deepEqual(asc.ids.slice(0, 4), [lines.pinned, lines.gbp, lines.usd, lines.eur], 'the converted amounts in order (100, 120, 200, 1000)');
    const filters: Array<[string, unknown]> = [
      ['greater than 0', { filterType: 'number', type: 'greaterThan', filter: 0 }],
      ['less than a billion', { filterType: 'number', type: 'lessThan', filter: 1e9 }],
      ['not equal to 1', { filterType: 'number', type: 'notEqual', filter: 1 }],
      ['text not contains', { type: 'notContains', filter: 'x' }],
      ['blank', { type: 'blank' }],
      ['not blank', { type: 'notBlank' }],
      ['set exclude', { filterType: 'set', mode: 'exclude', values: ['1'] }],
    ];
    for (const [name, model] of filters) {
      const { ids } = await engine.budgetListIds(scope, deps, { ...all, filters: JSON.stringify({ yBudget: model }) }, m);
      assert.ok(ids.every((id) => !yen.has(id)), `${name}: no yen line`);
    }
    const kept = await engine.budgetListIds(scope, deps, { ...all, filters: JSON.stringify({ yBudget: { filterType: 'number', type: 'greaterThan', filter: 0 } }) }, m);
    assert.equal(kept.ids.length, 4, 'the converted lines still match');
    const empty = await engine.budgetListIds(scope, deps, { ...all, filters: JSON.stringify({ yBudget: { filterType: 'number', type: 'greaterThan' } }) }, m);
    assert.equal(empty.ids.length, 6, 'a filter that filters nothing keeps every line');
  })],
  ['rows: null reporting amounts, the line\'s own under fx_missing', () => inRolledBackTransaction(async (runner) => {
    const { lines } = await seed(runner);
    const m = runner.manager;
    const grid = await engine.budgetListSummary(scope, deps, { ...all, shape: 'grid', limit: 50 }, m);
    const yenRow = grid.items.find((row) => row.id === lines.jpy)!;
    assert.deepEqual(yenRow.versions.y, {
      reporting: { budget: null, revision: null, forecast: null, follow_up: null, landing: null },
      fx_missing: { currency: 'JPY', amounts: { budget: 300, revision: 0, forecast: 0, follow_up: 0, landing: 0 } },
    }, 'the grid slot of a version without a rate');
    const usdRow = grid.items.find((row) => row.id === lines.usd)!;
    assert.deepEqual(usdRow.versions.y, { reporting: { budget: 200, revision: 0, forecast: 0, follow_up: 0, landing: 0 } }, 'a converted slot as before');
    const pinnedRow = grid.items.find((row) => row.id === lines.pinned)!;
    assert.equal(pinnedRow.versions.y.reporting!.budget, 100, 'the snapshot rate');

    const [full] = await engine.budgetListRowsByIds(scope, deps, { ids: [lines.jpy] }, m);
    const slot = full.versions.y;
    assert.equal(slot.totals.budget, 300, 'the line currency amount stays');
    assert.equal(slot.reporting!.budget, null);
    assert.equal(slot.reporting!.fx_rate, null);
    assert.equal(slot.reporting!.fx_source, 'missing');
    assert.deepEqual(budgetFxMissingYears(full, Y), [Y], 'the AI names the year');
    const [eur] = await engine.budgetListRowsByIds(scope, deps, { ids: [lines.eur] }, m);
    assert.equal(eur.versions.y.reporting!.budget, 1000);
    assert.equal(eur.versions.y.reporting!.fx_source, 'identity');
    assert.deepEqual(budgetFxMissingYears(eur, Y), []);

    const amounts = await engine.budgetListAmountsByIds(SUMMARY_SCOPES.all, deps, m, [lines.jpy, lines.usd], ['yBudget']);
    assert.equal(amounts.get(lines.jpy)!.yBudget, null, 'the contracts read no amount');
    assert.equal(amounts.get(lines.usd)!.yBudget, 20000n);
  })],
  ['relations tab: a null amount with fx_missing', () => inRolledBackTransaction(async (runner) => {
    const { tenantId, lines } = await seed(runner);
    const m = runner.manager;
    const { companyId } = await seedCompany(runner, tenantId, 'FX missing company');
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'FX missing supplier') RETURNING id`, [tenantId]);
    const [contract] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months, yearly_amount_at_signature, currency, status)
       VALUES ($1, 'FX missing contract', $2, $3, $4, 12, 1, 0, 'EUR', 'enabled') RETURNING id`,
      [tenantId, companyId, supplier.id, `${Y}-01-01`],
    );
    for (const id of [lines.jpy, lines.usd]) {
      await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, contract.id, id]);
    }
    const related = await listRelatedBudgetLines(m, deps.fxRates, { links: 'contract_spend_items', owner: 'contract_id' }, tenantId, contract.id, Y, 'planned');
    const yen = related.find((row) => row.id === lines.jpy)!;
    assert.equal(yen.amount, null);
    assert.deepEqual(yen.fx_missing, { currency: 'JPY', amount: 300 });
    const usd = related.find((row) => row.id === lines.usd)!;
    assert.equal(usd.amount, 200);
    assert.equal(usd.currency, 'EUR');
    assert.equal(usd.fx_missing, undefined);
  })],
];

void runSpecs('budget-fx-missing.integration.spec', tests);
