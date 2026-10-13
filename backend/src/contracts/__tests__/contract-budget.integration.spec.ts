import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { ContractsService } from '../contracts.service';
import { CONTRACT_BUDGET_OVER_PERCENT, budgetAmountKey, contractBudgetCurrentYear } from '../contract-budget';
import { toCents } from '../../common/amount';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import * as engine from '../../spend/budget-list/budget-list.service';
import { realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import {
  assert,
  inRolledBackTransaction,
  runSpecs,
  seedItem,
  seedMonths,
  seedTenant,
  seedVersion,
  setTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// A contract against its budget lines (lot CB, contract-budget.ts), on an empty database: the
// linked lines' amounts are the budget list's own for that line, year and column; the list of
// contracts carries the commitment, the linked sum, the gap and the state of a year and column,
// sorts and filters on them on the server and sums them in its totals; the contract page reads
// the same figures for every year. Two currencies besides the reporting one: USD with a rate,
// GBP without.

const Y = contractBudgetCurrentYear();
const N1 = Y + 1;
const deps = realSummaryDeps(SUMMARY_SCOPES.opex);

type Seeded = { tenantId: string; contracts: Record<string, string>; lines: Record<string, string> };

/** Twelve months adding up to `total` (all of it in January). */
const months = (total: number) => [total, ...Array(11).fill(0)];

async function seed(runner: QueryRunner): Promise<Seeded> {
  const tenantId = await seedTenant(runner, 'contract-budget');
  const { companyId } = await seedCompany(runner, tenantId, 'Contract budget company');
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Contract budget supplier') RETURNING id`, [tenantId]);
  // The year's rates: USD has one, GBP none. EUR is the reporting currency (tenant default).
  for (const year of [Y, N1]) {
    await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', $3::jsonb)`,
      [tenantId, year, JSON.stringify({ USD: 0.9 })],
    );
  }
  const contract = async (name: string, amount: number, currency = 'EUR', opts: { start?: string; months?: number; renewal?: boolean } = {}) => {
    const [row] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months,
                              auto_renewal, yearly_amount_at_signature, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, 'enabled') RETURNING id`,
      [tenantId, name, companyId, supplier.id, opts.start ?? `${Y - 1}-01-01`, opts.months ?? 12, opts.renewal ?? true, amount, currency],
    );
    return row.id as string;
  };
  let number = 0;
  const line = async (nature: 'opex' | 'capex', total: number | null, currency = 'EUR', disabledAt: string | null = null) => {
    number += 1;
    const itemId = await seedItem(runner, nature, tenantId, number, `Contract budget line ${number}`);
    await runner.query(`UPDATE spend_items SET currency = $3, disabled_at = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, itemId, currency, disabledAt]);
    if (total !== null) {
      const versionId = await seedVersion(runner, nature, tenantId, itemId, N1);
      await seedMonths(runner, nature, tenantId, versionId, N1, { planned: months(total) });
    }
    return itemId;
  };
  const link = (contractId: string, lineId: string) =>
    runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, contractId, lineId]);

  const contracts: Record<string, string> = {};
  const lines: Record<string, string> = {};
  contracts.covered = await contract('Covered', 1200);
  lines.covered = await line('opex', 1200);
  await link(contracts.covered, lines.covered);

  contracts.under = await contract('Under', 2400);
  lines.under = await line('capex', 1000);
  // Ended in the current year: the list shows nothing for it next year, whatever its version holds.
  lines.ended = await line('opex', 500, 'EUR', `${Y}-06-30T12:00:00Z`);
  await link(contracts.under, lines.under);
  await link(contracts.under, lines.ended);

  contracts.over = await contract('Over', 1000);
  lines.over = await line('opex', 1200);
  await link(contracts.over, lines.over);

  // Exactly 10 % above the commitment: still covered.
  contracts.edge = await contract('Edge', 1000);
  lines.edge = await line('opex', 1100);
  await link(contracts.edge, lines.edge);

  contracts.noLine = await contract('No line', 500);
  // A linked line with no amount in that year counts as no line.
  lines.empty = await line('opex', null);
  await link(contracts.noLine, lines.empty);

  // USD: 1 000 USD committed and budgeted, both 900 EUR.
  contracts.usd = await contract('Dollar', 1000, 'USD');
  lines.usd = await line('opex', 1000, 'USD');
  await link(contracts.usd, lines.usd);

  // GBP has no rate: no committed amount in EUR.
  contracts.gbp = await contract('Sterling', 1000, 'GBP');

  // Ended two years ago without renewal: nothing committed, no line.
  contracts.ended = await contract('Ended', 700, 'EUR', { start: `${Y - 3}-01-01`, renewal: false });

  // Another tenant's contract and line: never read.
  const otherTenant = await seedTenant(runner, 'contract-budget-other');
  const { companyId: otherCompany } = await seedCompany(runner, otherTenant, 'Other tenant company');
  const [otherSupplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Other tenant supplier') RETURNING id`, [otherTenant]);
  const [other] = await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, auto_renewal, yearly_amount_at_signature, currency)
     VALUES ($1, 'Other tenant', $2, $3, $4, 12, true, 99999, 'EUR') RETURNING id`,
    [otherTenant, otherCompany, otherSupplier.id, `${Y - 1}-01-01`],
  );
  const otherLine = await seedItem(runner, 'opex', otherTenant, 1, 'Other tenant line');
  const otherVersion = await seedVersion(runner, 'opex', otherTenant, otherLine, N1);
  await seedMonths(runner, 'opex', otherTenant, otherVersion, N1, { planned: months(99999), committed: months(99999) });
  await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [otherTenant, other.id, otherLine]);

  await setTenant(runner, tenantId);
  return { tenantId, contracts, lines };
}

function service(): ContractsService {
  const args: any[] = Array.from({ length: 10 }, () => undefined);
  args[4] = { log: async () => undefined };
  args[9] = deps.fxRates;
  return new (ContractsService as any)(...args);
}

const budgetQuery = (extra: Record<string, unknown> = {}) => ({ budget_year: String(N1), budget_column: 'planned', ...extra });

async function testLineAmountsAreTheBudgetList() {
  await inRolledBackTransaction(async (runner) => {
    const { lines } = await seed(runner);
    const m = runner.manager;
    const key = budgetAmountKey(N1, 'planned');
    assert.equal(key, `y${N1}Budget`);
    const amounts = await engine.budgetListAmountsByIds(SUMMARY_SCOPES.all, deps, m, Object.values(lines), [key, 'not_an_amount']);
    const page = await engine.budgetListSummary(SUMMARY_SCOPES.all, deps, { years: String(N1), includeDisabled: 'true', limit: 100 }, m);
    assert.equal(page.items.length, Object.keys(lines).length, 'the list holds every line');
    for (const row of page.items) {
      const shown = toCents(row.versions[`y${N1}`]?.reporting?.budget ?? 0);
      assert.equal(amounts.get(row.id)?.[key], shown, `line ${row.product_name}: the list's amount`);
      assert.deepEqual(Object.keys(amounts.get(row.id) ?? {}), [key], 'only the amount keys');
    }
    assert.equal(amounts.get(lines.usd)?.[key], 90000n, 'USD converted with the year rate');
    assert.equal(amounts.get(lines.ended)?.[key], 0n, 'nothing after the end of validity');
    const totals = await engine.budgetListTotals(SUMMARY_SCOPES.all, deps, { amounts: key, includeDisabled: 'true' }, m);
    const sum = Array.from(amounts.values()).reduce((acc, byKey) => acc + byKey[key], 0n);
    assert.equal(toCents(totals[key] as number), sum, 'the footer of the budget list');
    assert.equal((await engine.budgetListAmountsByIds(SUMMARY_SCOPES.all, deps, m, [], [key])).size, 0, 'no line, no statement');
  });
}

async function testListFigures() {
  await inRolledBackTransaction(async (runner) => {
    const { contracts } = await seed(runner);
    const svc = service();
    const opts = { manager: runner.manager, budgetAccess: true };
    const nameOf = new Map(Object.entries(contracts).map(([key, id]) => [id, key]));
    const byKey = (items: any[]) => Object.fromEntries(items.map((row) => [nameOf.get(row.id), row]));

    const page = await svc.list(budgetQuery({ limit: 50 }), opts);
    const rows = byKey(page.items as any[]);
    const figures = Object.fromEntries(Object.entries(rows).map(([key, row]: [string, any]) => [key, [row.budget_committed, row.budget_linked, row.budget_gap, row.budget_state]]));
    assert.deepEqual(figures, {
      covered: [1200, 1200, 0, 'covered'],
      under: [2400, 1000, -1400, 'under'],
      over: [1000, 1200, 200, 'over'],
      edge: [1000, 1100, 100, 'covered'],
      noLine: [500, 0, -500, 'no_line'],
      usd: [900, 900, 0, 'covered'],
      gbp: [null, 0, null, null],
      ended: [0, 0, 0, 'no_commitment'],
    }, 'figures of the year and column');
    assert.equal(CONTRACT_BUDGET_OVER_PERCENT, 10);

    // Without the right to read the budget, or without a year and column: no figures.
    const plain = await svc.list(budgetQuery(), { manager: runner.manager, budgetAccess: false });
    assert.equal((plain.items as any[]).some((row) => 'budget_linked' in row), false, 'no budget access');
    const none = await svc.list({}, opts);
    assert.equal((none.items as any[]).some((row) => 'budget_linked' in row), false, 'no year and column');
    await assert.rejects(svc.list(budgetQuery({ budget_column: 'Budget' }), opts), /budget_column must be one of/, 'a column is named by its key, never by its name');
    await assert.rejects(svc.list(budgetQuery({ budget_year: String(Y + 40) }), opts), /budget_year must be a year/);

    // Sorted on the server, the contract without a rate last both ways.
    const gapAsc = await svc.list(budgetQuery({ sort: 'budget_gap:ASC', limit: 50 }), opts);
    assert.deepEqual((gapAsc.items as any[]).map((row) => nameOf.get(row.id)).slice(0, 2), ['under', 'noLine'], 'largest shortfall first');
    assert.equal(nameOf.get((gapAsc.items as any[]).at(-1).id), 'gbp', 'no gap last ascending');
    const committedDesc = await svc.list(budgetQuery({ sort: 'budget_committed:DESC', limit: 50 }), opts);
    assert.deepEqual((committedDesc.items as any[]).map((row) => nameOf.get(row.id)).slice(0, 2), ['under', 'covered']);
    assert.equal(nameOf.get((committedDesc.items as any[]).at(-1).id), 'gbp', 'no committed amount last descending');
    const linkedPage = await svc.list(budgetQuery({ sort: 'budget_linked:DESC', limit: 2, page: 1 }), opts);
    assert.deepEqual((linkedPage.items as any[]).map((row) => nameOf.get(row.id)).sort(), ['covered', 'over'].sort(), 'a page of the sorted list');
    assert.equal(linkedPage.total, 8);

    // Filtered on the server.
    const under = await svc.list(budgetQuery({ filters: JSON.stringify({ budget_state: { filterType: 'set', values: ['under'] } }) }), opts);
    assert.deepEqual((under.items as any[]).map((row) => nameOf.get(row.id)), ['under'], 'state filter');
    const big = await svc.list(budgetQuery({ filters: JSON.stringify({ budget_committed: { filterType: 'number', type: 'greaterThan', filter: 1000 } }) }), opts);
    assert.deepEqual((big.items as any[]).map((row) => nameOf.get(row.id)).sort(), ['covered', 'under'], 'committed above 1 000');
    const gapRange = await svc.list(budgetQuery({ filters: JSON.stringify({ budget_gap: { filterType: 'number', type: 'inRange', filter: 50, filterTo: 250 } }) }), opts);
    assert.deepEqual((gapRange.items as any[]).map((row) => nameOf.get(row.id)).sort(), ['edge', 'over'], 'gap between 50 and 250');
    const { ids } = await svc.listIds(budgetQuery({ sort: 'budget_gap:ASC', filters: JSON.stringify({ budget_state: { filterType: 'set', values: ['covered', 'under'] } }) }), opts);
    const walked = ids.map((id) => nameOf.get(id));
    // Covered and Dollar tie on a gap of 0 (seeded in one transaction, the id breaks the tie).
    assert.deepEqual([walked[0], [walked[1], walked[2]].sort(), walked[3]], ['under', ['covered', 'usd'], 'edge'], 'ids in the sorted, filtered order');

    // Another column: no line of the tenant has an amount there, the year has not started.
    const revision = await svc.list(budgetQuery({ budget_column: 'committed', limit: 50 }), opts);
    const revisionRows = byKey(revision.items as any[]);
    assert.equal(revisionRows.covered.budget_state, 'not_started', 'no data in the column that year');
    assert.equal(revisionRows.ended.budget_state, 'no_commitment', 'nothing committed comes first');
    assert.equal(revisionRows.covered.budget_linked, 0);
  });
}

async function testTotals() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId } = await seed(runner);
    const svc = service();
    const opts = { manager: runner.manager, tenantId, budgetAccess: true };

    const totals = await svc.totals(budgetQuery(), opts);
    assert.deepEqual(totals.budget, {
      year: N1,
      column: 'planned',
      reporting_currency: 'EUR',
      // 1 200 + 2 400 + 1 000 + 1 000 + 500 + 900 (USD) + 0; the GBP contract is left out.
      committed: 7000,
      linked: 1200 + 1000 + 1200 + 1100 + 900,
      // Over the contracts with a committed amount.
      gap: 0 - 1400 + 200 + 100 - 500 + 0 + 0,
      excluded: [{ currency: 'GBP', count: 1 }],
      no_line_count: 1,
      under_count: 1,
      years: [Y, Y + 1, Y + 2],
    }, 'budget totals');
    assert.equal(totals.count, 8, 'the other figures stay');

    // A filter narrows the sums, never the quick filter counts of the budget state.
    const filtered = await svc.totals(budgetQuery({ filters: JSON.stringify({ budget_state: { filterType: 'set', values: ['under'] } }) }), opts);
    assert.equal(filtered.count, 1);
    assert.deepEqual([filtered.budget?.committed, filtered.budget?.linked, filtered.budget?.gap], [2400, 1000, -1400]);
    assert.deepEqual([filtered.budget?.no_line_count, filtered.budget?.under_count], [1, 1], 'counts ignore the state filter');
    assert.deepEqual(filtered.budget?.excluded, []);

    const plain = await svc.totals(budgetQuery(), { ...opts, budgetAccess: false });
    assert.equal('budget' in plain, false, 'no budget access');
  });
}

async function testContractPage() {
  await inRolledBackTransaction(async (runner) => {
    const { contracts, lines } = await seed(runner);
    const svc = service();
    const opts = { manager: runner.manager, budgetAccess: true };

    const under = await svc.budgetCoverage(contracts.under, { year: String(N1), column: 'planned' }, opts);
    assert.equal(under.reporting_currency, 'EUR');
    assert.deepEqual(
      under.lines.map((line) => [line.id, line.amount]).sort(),
      [[lines.under, 1000], [lines.ended, 0]].sort(),
      'each linked line with its amount of the year and column',
    );
    assert.deepEqual(
      under.years.map((row) => [row.year, row.committed, row.linked, row.gap, row.state]),
      [
        [Y, 2400, 0, 0 - 2400, 'not_started'],
        [N1, 2400, 1000, -1400, 'under'],
        [Y + 2, 2400, 0, -2400, 'not_started'],
      ],
      'every year of the selector: the budget only holds next year',
    );

    const usd = await svc.budgetCoverage(contracts.usd, { year: String(N1), column: 'planned' }, opts);
    assert.equal(usd.currency, 'USD');
    assert.deepEqual(usd.years.find((row) => row.year === N1), { year: N1, committed_local: 1000, committed: 900, linked: 900, gap: 0, state: 'covered' });
    const gbp = await svc.budgetCoverage(contracts.gbp, { year: String(N1), column: 'planned' }, opts);
    assert.deepEqual(gbp.years.find((row) => row.year === N1), { year: N1, committed_local: 1000, committed: null, linked: 0, gap: null, state: null }, 'no rate');

    // A year outside the selector's years joins them.
    const later = await svc.budgetCoverage(contracts.covered, { year: String(Y + 4), column: 'planned' }, opts);
    assert.deepEqual(later.years.map((row) => row.year), [Y, Y + 1, Y + 2, Y + 4]);

    await assert.rejects(svc.budgetCoverage(contracts.covered, { year: String(N1), column: 'planned' }, { manager: runner.manager, budgetAccess: false }), /needs access to the budget/);
    await assert.rejects(svc.budgetCoverage(contracts.covered, {}, opts), /year and column are required/);
    await assert.rejects(svc.budgetCoverage('00000000-0000-4000-8000-000000000000', { year: String(N1), column: 'planned' }, opts), /Contract not found/);
  });
}

void runSpecs('contract-budget.integration.spec', [
  ['testLineAmountsAreTheBudgetList', testLineAmountsAreTheBudgetList],
  ['testListFigures', testListFigures],
  ['testTotals', testTotals],
  ['testContractPage', testContractPage],
]);
