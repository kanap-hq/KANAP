// @database-spec: uses the PostgreSQL transaction harness.
import 'dotenv/config';
import { toCents } from '../../common/amount';
import { assert, inRolledBackTransaction, runSpecs } from './round-inputs.fixtures';
import { seedListFixture } from './oracle/budget-list.fixture';
import { SUMMARY_SCOPES } from '../spend-summary.builder';
import * as engine from '../budget-list/budget-list.service';
import { deps, seedBudgetLines } from './budget-lines.fixtures';

runSpecs('budget-lines-union.integration.spec', [
  ['union, totals and grouped aggregates against the two existing scopes', async () => {
    await inRolledBackTransaction(async (runner) => {
      await seedListFixture(runner, 20261002);
      const m = runner.manager;
      const base = { includeDisabled: 'true', sort: 'item_number:ASC' };
      const queries = [base, { ...base, filters: { currency: { filterType: 'set', values: ['EUR'] } } },
        { ...base, filters: { run_build: { filterType: 'set', values: ['run'] }, yBudget: { filterType: 'number', type: 'greaterThan', filter: 0 } } }];
      for (const query of queries) {
        const all = await engine.budgetListIds(SUMMARY_SCOPES.all, deps, query, m);
        const opex = await engine.budgetListIds(SUMMARY_SCOPES.opex, deps, query, m);
        const capex = await engine.budgetListIds(SUMMARY_SCOPES.capex, deps, query, m);
        assert.ok(opex.total > 0 && capex.total > 0, 'both subsets must be nonempty');
        assert.deepEqual([...all.ids].sort(), [...opex.ids, ...capex.ids].sort());
        assert.equal(new Set(all.ids).size, all.total);
        const totals = await engine.budgetListTotals(SUMMARY_SCOPES.all, deps, query, m);
        const left = await engine.budgetListTotals(SUMMARY_SCOPES.opex, deps, query, m);
        const right = await engine.budgetListTotals(SUMMARY_SCOPES.capex, deps, query, m);
        for (const key of Object.keys(totals)) {
          if (typeof totals[key] === 'number') assert.equal(toCents(totals[key]), toCents(left[key]) + toCents(right[key]), key);
        }
        const spec = { groupBy: ['nature'], measures: ['yBudget', 'yRevision', 'yForecast', 'yFollowUp', 'yLanding'].map((field) => ({ id: field, fn: 'sum' as const, field })) };
        const aggregate = await engine.budgetListAggregate(SUMMARY_SCOPES.all, deps, query, spec, m);
        assert.equal(aggregate.groups.length, 2);
        assert.deepEqual(aggregate.groups.map((g) => g.keys[0]).sort(), ['capex', 'opex']);
        for (const measure of spec.measures) {
          assert.equal(toCents(aggregate.total.values[measure.id]!), aggregate.groups.reduce((sum, group) => sum + toCents(group.values[measure.id]!), 0n));
          assert.equal(Number(aggregate.total.values[measure.id]), totals[measure.id]);
        }
        const filtered = await engine.budgetListIds(SUMMARY_SCOPES.all, deps, { ...query, filters: { ...('filters' in query ? query.filters : {}), nature: { filterType: 'set', values: ['capex'] } } }, m);
        assert.deepEqual([...filtered.ids].sort(), [...capex.ids].sort());
      }
      // All dimensions are readable on the neutral scope, including nature-specific dimensions.
      const axes = await m.query(`SELECT id FROM analytics_axes WHERE tenant_id = app_current_tenant()`);
      for (const { id } of axes) {
        const query = { ...base, fields: `analytics_${id}` };
        const all = await engine.budgetListFilterValues(SUMMARY_SCOPES.all, deps, query, m);
        const opex = await engine.budgetListFilterValues(SUMMARY_SCOPES.opex, deps, query, m);
        const capex = await engine.budgetListFilterValues(SUMMARY_SCOPES.capex, deps, query, m);
        assert.deepEqual([...new Set(all[`analytics_${id}`])].sort(), [...new Set([...opex[`analytics_${id}`], ...capex[`analytics_${id}`]])].sort());
      }
      console.log('ok - three nonempty unions, totals, nature groups, nature filter and dimensions');
    });
  }],
  ['native rows, BL pagination, quick search, tasks and mixed neighbors', async () => {
    await inRolledBackTransaction(async (runner) => {
      const { tenantId, lines, dimensions } = await seedBudgetLines(runner);
      const m = runner.manager;
      // A stale value of the CAPEX line on the OPEX-only dimension (the values stay in the
      // database): the cell stays blank, and the filter and the quick search both read the link
      // of the line's nature, so neither names the CAPEX line.
      const opexAxis = dimensions.find((axis) => axis.appliesTo === 'opex')!;
      const capexLine = lines.find((line) => line.nature === 'capex')!;
      await runner.query(
        `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id)
         SELECT $1, $2, $3, c.id FROM analytics_categories c WHERE c.tenant_id = $1 AND c.axis_id = $3 LIMIT 1`,
        [tenantId, capexLine.itemId, opexAxis.id],
      );
      const capexRow = (await engine.budgetListSummary(SUMMARY_SCOPES.all, deps, { filters: { nature: { filterType: 'set', values: ['capex'] } }, limit: 10 }, m)).items[0];
      assert.equal(capexRow[`analytics_${opexAxis.id}`] ?? null, null, 'the cell of a dimension of the other nature stays blank');
      const staleSearch = await engine.budgetListIds(SUMMARY_SCOPES.all, deps, { q: 'opex value' }, m);
      assert.deepEqual(
        [...staleSearch.ids].sort(),
        lines.filter((line) => line.nature === 'opex').map((line) => line.itemId).sort(),
        'the quick search reads the dimension link of the line\'s nature',
      );
      for (const axis of dimensions) {
        const field = `analytics_${axis.id}`;
        const values = await engine.budgetListFilterValues(SUMMARY_SCOPES.all, deps, { fields: field }, m);
        assert.ok(values[field].includes(axis.value));
        const ids = await engine.budgetListIds(SUMMARY_SCOPES.all, deps, { filters: { [field]: { filterType: 'set', values: [axis.value] } } }, m);
        assert.deepEqual([...ids.ids].sort(), lines.filter((line) => axis.appliesTo === null || line.nature === axis.appliesTo).map((line) => line.itemId).sort());
      }
      const sortedByNature = await engine.budgetListSummary(SUMMARY_SCOPES.all, deps, { sort: 'nature:ASC' }, m);
      assert.deepEqual(sortedByNature.items.map((row) => row.nature), ['capex', 'opex', 'opex']);
      for (const shape of ['full', 'grid']) {
        const page1 = await engine.budgetListSummary(SUMMARY_SCOPES.all, deps, { sort: 'item_number:ASC', limit: 2, shape }, m);
        const page2 = await engine.budgetListSummary(SUMMARY_SCOPES.all, deps, { sort: 'item_number:ASC', limit: 2, page: 2, shape }, m);
        assert.deepEqual([...page1.items, ...page2.items].map((row) => row.item_number), [7101, 7102, 7103]);
        const capex = page1.items[1];
        assert.equal(capex.product_name, 'UniqueTitle7102');
        assert.equal(capex.description, 'Native description 7102');
        assert.equal(capex.nature, 'capex');
        assert.equal(capex.reference, 'BL-7102');
        assert.equal(capex.legacy_number, 'CPX-21');
        assert.equal(capex.latest_task?.title, 'Task7102');
        assert.equal(capex[`analytics_${dimensions[2].id}`], 'capex value');
        assert.equal(page1.items[0].latest_task?.title, 'Task7101');
      }
      for (const line of lines) {
        for (const q of [`BL-${line.number}`, `bl-${line.number}`, String(line.number), line.legacy.toLowerCase(), `UniqueTitle${line.number}`]) {
          const ids = await engine.budgetListIds(SUMMARY_SCOPES.all, deps, { q }, m);
          assert.deepEqual(ids.ids, [line.itemId], q);
        }
      }
      const neighbors = await engine.budgetListNeighbors(SUMMARY_SCOPES.all, deps, { sort: 'item_number:ASC' }, lines[1].itemId, m);
      assert.deepEqual(neighbors, { index: 1, total: 3, prev: { id: lines[0].itemId, item_number: 7101, nature: 'opex' }, next: { id: lines[2].itemId, item_number: 7103, nature: 'opex' } });
      const taskFiltered = await engine.budgetListIds(SUMMARY_SCOPES.all, deps, { filters: { latest_task_text: { filterType: 'text', type: 'equals', filter: 'Task7102' } } }, m);
      assert.deepEqual(taskFiltered.ids, [lines[1].itemId]);
      const edge = await engine.budgetListNeighbors(SUMMARY_SCOPES.all, deps, { sort: 'item_number:ASC' }, lines[0].itemId, m);
      assert.equal(edge.next?.nature, 'capex');
      assert.deepEqual(await engine.budgetListFilterValues(SUMMARY_SCOPES.all, deps, { fields: 'nature' }, m), { nature: ['capex', 'opex'] });
      console.log('ok - native full/grid rows, two pages, searches, tasks, nature values and neighbors');
    });
  }],
]).catch((err) => { console.error(err); process.exit(1); });
