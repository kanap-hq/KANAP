import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import dataSource from '../../data-source';
import { sqlLiteral } from '../../common/list-engine/sql-fragments';
import { FIXED_SORT_ORDERS, loadVersionTotals, SUMMARY_COLUMNS, SUMMARY_SCOPES } from '../spend-summary.builder';
import * as engine from '../budget-list/budget-list.service';
import { BudgetSummaryOracle, loadOracleFold } from './oracle/budget-summary.oracle';
import { realSummaryDeps } from './oracle/oracle-deps';
import { prng, seedListFixture, uuidFrom } from './oracle/budget-list.fixture';

// Edge requests of the OPEX and CAPEX list engine (lot 2B, PR A review and
// PR C), on the differential fixture in a rolled-back transaction:
// - the budget years one request reads are bounded (400 beyond);
// - keys named like inherited members (`constructor`, `__proto__`…) are
//   unknown fields, never a 500;
// - a quick search holding U+001F (the separator of the entries the engine
//   reads as one text) matches like the rows' bag;
// - a page far past the end is an empty page, not a 500;
// - an unknown set filter mode is a 400;
// - a line whose version totals pass a bigint of cents (twelve months of
//   numeric(18,2) near its maximum) is listed, sorted, filtered and totalled
//   like the oracle, and the CAPEX totals reader and list take it too;
// - `sqlLiteral` refuses `$<digit>`, which `finalize` would renumber;
// - every enum the list sorts in a fixed order (status, run or build, and the
//   CAPEX priority, investment type and PPE type of decision Q4) lists exactly
//   the values of its database enum, in their declaration order: a value
//   added by a migration and not here would sort as blank.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const SEED = 20261002;
const Y = new Date().getFullYear();
const scope = SUMMARY_SCOPES.opex;
const ROW_OPTIONS = { includeRecipientDetails: true, includeNextYearAllocation: true };
const f = (model: Record<string, unknown>) => JSON.stringify(model);
const badRequest = (pattern: RegExp) => (err: unknown) => err instanceof BadRequestException && pattern.test((err as Error).message);
/** The largest month a numeric(18,2) column holds. */
const MAX_MONTH = '9999999999999999.99';

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const { tenantId } = await seedListFixture(runner, SEED);
    const m = runner.manager;
    const deps = realSummaryDeps(scope);
    const fold = await loadOracleFold(m);
    const oracle = new BudgetSummaryOracle(scope, deps, m, tenantId, fold, ROW_OPTIONS);
    const all = { includeDisabled: 'true' };

    // ----- years -----
    const years = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    // Twelve distinct years, the fixed window included: read.
    const twelve = await engine.budgetListTotals(scope, deps, { ...all, years: years(Y - 9, Y - 3).join(',') }, m);
    assert.ok(`y${Y - 9}Budget` in twelve);
    for (const [label, call] of [
      ['thirteen years', () => engine.budgetListTotals(scope, deps, { ...all, years: years(Y - 10, Y - 3).join(',') }, m)],
      ['a year beyond Y+10', () => engine.budgetListIds(scope, deps, { ...all, years: String(Y + 11) }, m)],
      ['a filter key beyond Y-10', () => engine.budgetListPageIds(scope, deps, { ...all, filters: f({ [`y${Y - 11}Budget`]: { filterType: 'number', type: 'greaterThan', filter: 0 } }) }, m)],
      ['a sort key beyond Y+10', () => engine.budgetListSummary(scope, deps, { ...all, sort: `y${Y + 20}Forecast:DESC` }, m)],
      ['an FTE key beyond Y-10', () => engine.budgetListTotals(scope, deps, { ...all, fte: `fte_y${Y - 50}Budget` }, m)],
      ['150 filter years', () => engine.budgetListPageIds(scope, deps, { ...all, filters: f(Object.fromEntries(years(2000, 2149).map((year) => [`y${year}Budget`, { filterType: 'number', type: 'greaterThanOrEqual', filter: -1e12 }]))) }, m)],
    ] as const) {
      await assert.rejects(call as () => Promise<unknown>, badRequest(/budget years/i), label);
    }

    // ----- inherited member names -----
    const defaultOrder = (await engine.budgetListIds(scope, deps, { ...all, sort: 'nonexistent_field:ASC' }, m)).ids;
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      for (const dir of ['ASC', 'DESC']) {
        const sorted = await engine.budgetListIds(scope, deps, { ...all, sort: `${key}:${dir}` }, m);
        assert.deepEqual(sorted.ids, defaultOrder, `sort on ${key}: an unknown field, the tie-break order`);
        assert.deepEqual(sorted.ids, (await oracle.summaryIds({ ...all, sort: `${key}:${dir}` })).ids, `oracle sort on ${key}`);
      }
      const filters = `{${JSON.stringify(key)}:{"filterType":"text","type":"contains","filter":"a"}}`;
      assert.equal((await engine.budgetListIds(scope, deps, { ...all, filters }, m)).total, 0, `text filter on ${key}: an unknown field is blank`);
      assert.equal((await oracle.summaryIds({ ...all, filters })).total, 0, `oracle text filter on ${key}`);
      const blank = `{${JSON.stringify(key)}:{"filterType":"set","values":[null]}}`;
      assert.equal((await engine.budgetListIds(scope, deps, { ...all, filters: blank }, m)).total, defaultOrder.length, `blank set on ${key}`);
      assert.deepEqual(await engine.budgetListFilterValues(scope, deps, { ...all, fields: key }, m), {}, `filter values of ${key}`);
    }

    // ----- quick search with the separator -----
    const [line] = await runner.query(`SELECT item_number FROM spend_items WHERE tenant_id = $1 ORDER BY item_number LIMIT 1`, [tenantId]);
    for (const q of ['\u001f', `${line.item_number}\u001fopx-${line.item_number}`, `${line.item_number}\u001f`, 'Électricité\u001fElectricite']) {
      const e = await engine.budgetListIds(scope, deps, { ...all, q }, m);
      const o = await oracle.summaryIds({ ...all, q });
      assert.deepEqual(e, o, `q=${JSON.stringify(q)}`);
      assert.equal(e.total, 0, `q=${JSON.stringify(q)} matches no entry of the bag`);
    }

    // ----- pages far past the end -----
    const lineCount = defaultOrder.length;
    for (const page of ['99999999999', '999999999999999999999999', '3000000']) {
      const result = await engine.budgetListPageIds(scope, deps, { ...all, page, limit: '1000' }, m);
      assert.deepEqual(result.ids, [], `page ${page}`);
      assert.equal(result.total, lineCount, `page ${page}: the count of the list`);
    }

    // ----- set filter modes -----
    await assert.rejects(
      () => engine.budgetListIds(scope, deps, { ...all, filters: f({ supplier_name: { filterType: 'set', mode: 'invert', values: ['ACME'] } }) }, m),
      badRequest(/Unknown set filter mode/),
    );
    assert.ok((await engine.budgetListIds(scope, deps, { ...all, filters: f({ supplier_name: { filterType: 'set', mode: 'include', values: ['ACME'] } }) }, m)).total > 0);

    // ----- sqlLiteral -----
    assert.equal(sqlLiteral("l'été"), "'l''été'");
    assert.throws(() => sqlLiteral('price $1'), /parameter/);

    // ----- an absurd line: version totals beyond a bigint of cents -----
    const ids = prng(SEED + 7);
    const absurd = uuidFrom(ids);
    const negative = uuidFrom(ids);
    await runner.query(
      `INSERT INTO spend_items (id, tenant_id, item_number, product_name, currency, effective_start, status, created_at, updated_at)
       VALUES ($1, $3, 900001, 'Absurd line', 'USD', '2020-01-01', 'enabled', now(), now()),
              ($2, $3, 900002, 'Absurd credit', 'EUR', '2020-01-01', 'enabled', now(), now())`,
      [absurd, negative, tenantId],
    );
    const versions: Array<[string, string, number]> = [[uuidFrom(ids), absurd, Y], [uuidFrom(ids), absurd, Y + 1], [uuidFrom(ids), negative, Y]];
    for (const [versionId, itemId, year] of versions) {
      await runner.query(
        `INSERT INTO spend_versions (id, tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
         VALUES ($1, $2, $3, 'Y' || $5::int, 'monthly', $4::date, $5::int, 'default')`,
        [versionId, tenantId, itemId, `${year}-01-01`, year],
      );
      const month = itemId === negative ? `-${MAX_MONTH}` : MAX_MONTH;
      await runner.query(
        `INSERT INTO spend_amounts (tenant_id, version_id, period, planned, committed, forecast, actual, expected_landing)
         SELECT $1, $2, make_date($3, mo, 1), $4::numeric, $4::numeric, $4::numeric, 1, $4::numeric FROM generate_series(1, 12) AS mo`,
        [tenantId, versionId, year, month],
      );
    }
    const [{ planned }] = await runner.query(`SELECT planned::text FROM spend_version_totals WHERE version_id = $1`, [versions[0][0]]);
    assert.equal(planned, '119999999999999999.88', 'twelve maximal months: 1.2e19 cents, past a bigint');
    const freshOracle = new BudgetSummaryOracle(scope, deps, m, tenantId, fold, ROW_OPTIONS); // the first one cached its rows
    for (const query of [
      { ...all, sort: 'yBudget:DESC', limit: 10 },
      { ...all, sort: 'yPlus1Forecast:ASC', limit: 10, filters: f({ yBudget: { filterType: 'number', type: 'greaterThan', filter: 1e15 } }) },
      { ...all, sort: 'product_name:ASC', limit: 10, filters: f({ yBudget: { filterType: 'text', type: 'contains', filter: '99' } }) },
      { ...all, sort: 'yRevision:DESC', limit: 10, q: 'absurd', fte: 'fte_yBudget' },
    ]) {
      const e = await engine.budgetListSummary(scope, deps, query, m, ROW_OPTIONS);
      const o = await freshOracle.summary(query);
      assert.deepEqual(e.items.map((row) => row.id), o.items.map((row) => row.id), `ids ${JSON.stringify(query)}`);
      assert.deepEqual(JSON.parse(JSON.stringify(e.items)), JSON.parse(JSON.stringify(o.items)), `rows ${JSON.stringify(query)}`);
      assert.equal(e.total, o.total);
      assert.deepEqual(await engine.budgetListTotals(scope, deps, query, m), await freshOracle.summaryTotals(query), `totals ${JSON.stringify(query)}`);
    }
    const top = await engine.budgetListSummary(scope, deps, { ...all, sort: 'yBudget:DESC', limit: 1 }, m, ROW_OPTIONS);
    assert.equal(top.items[0].id, absurd, 'the absurd line sorts first');
    assert.ok((top.items[0] as any).versions.y.totals.budget > 1e17, 'the local amount, 1.2e17');

    // The CAPEX readers share the totals reader (CAPEX list and export): numeric cents, no bigint cast.
    // A CAPEX line lives in the spend_* tables since lot Z1 (nature 'capex', its CPX number in legacy_number).
    const capexItem = uuidFrom(ids);
    const capexVersion = uuidFrom(ids);
    await runner.query(
      `INSERT INTO spend_items (id, tenant_id, nature, item_number, legacy_number, product_name, ppe_type, investment_type, priority, currency, effective_start)
       VALUES ($1, $2, 'capex', 900003, 'CPX-900003', 'Absurd investment', 'hardware', 'other', 'low', 'EUR', '2020-01-01')`,
      [capexItem, tenantId],
    );
    await runner.query(
      `INSERT INTO spend_versions (id, tenant_id, spend_item_id, version_name, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, $3, 'Absurd', $4::date, $5, 'default')`,
      [capexVersion, tenantId, capexItem, `${Y}-01-01`, Y],
    );
    await runner.query(
      `INSERT INTO spend_amounts (tenant_id, version_id, period, planned, committed, forecast, actual, expected_landing)
       SELECT $1, $2, make_date($3, mo, 1), $4::numeric, 0, 0, 0, 0 FROM generate_series(1, 12) AS mo`,
      [tenantId, capexVersion, Y, MAX_MONTH],
    );
    const capex = SUMMARY_SCOPES.capex;
    const capexDeps = realSummaryDeps(capex); // CAPEX shares come from capex_allocations
    const capexTotals = await loadVersionTotals(capex, capexDeps, m, tenantId, [{ id: capexItem, currency: 'EUR' }], [Y], { reporting: false });
    const column = SUMMARY_COLUMNS.find((c) => c.measure === 'planned')!;
    assert.equal(capexTotals.cents.get(capexVersion)?.[column.key], 11999999999999999988n, 'CAPEX version totals read exactly');
    // The CAPEX list (on the engine since PR C) takes it like the oracle.
    const capexOracle = new BudgetSummaryOracle(capex, capexDeps, m, tenantId, fold, ROW_OPTIONS);
    for (const query of [
      { ...all, sort: 'yBudget:DESC', limit: 10 },
      { ...all, sort: 'priority:ASC', limit: 10, filters: f({ yBudget: { filterType: 'number', type: 'greaterThan', filter: 1e15 } }) },
      { ...all, sort: 'description:ASC', limit: 10, q: 'absurd' },
    ]) {
      const e = await engine.budgetListSummary(capex, capexDeps, query, m, ROW_OPTIONS);
      const o = await capexOracle.summary(query);
      assert.deepEqual(JSON.parse(JSON.stringify(e.items)), JSON.parse(JSON.stringify(o.items)), `CAPEX rows ${JSON.stringify(query)}`);
      assert.equal(e.total, o.total);
      assert.deepEqual(await engine.budgetListTotals(capex, capexDeps, query, m), await capexOracle.summaryTotals(query), `CAPEX totals ${JSON.stringify(query)}`);
    }
    const capexTop = await engine.budgetListSummary(capex, capexDeps, { ...all, sort: 'yBudget:DESC', limit: 1 }, m, ROW_OPTIONS);
    assert.equal(capexTop.items[0].id, capexItem, 'the absurd investment sorts first');

    // ----- fixed sort orders against the database enums -----
    for (const [field, order] of Object.entries(FIXED_SORT_ORDERS)) {
      const labels: Array<{ label: string }> = await runner.query(
        `SELECT e.enumlabel AS label
           FROM pg_attribute a JOIN pg_enum e ON e.enumtypid = a.atttypid
          WHERE a.attrelid = 'spend_items'::regclass AND a.attname = $1
          ORDER BY e.enumsortorder`,
        [field],
      );
      assert.deepEqual([...order], labels.map((row) => row.label), `${field}: the declaration order of its enum`);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('budget-list-edges.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
