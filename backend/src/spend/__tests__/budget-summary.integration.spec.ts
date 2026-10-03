import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { SpendItemsService } from '../spend-items.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { AiQueryExecutor } from '../../ai/query/ai-query.executor';
import { AiAggregateExecutor } from '../../ai/query/ai-aggregate.executor';
import { getAiEntityRegistry } from '../../ai/query/registries';
import { FIXED_SLOTS, SUMMARY_COLUMNS, SUMMARY_SCOPES } from '../spend-summary.builder';
import * as budgetList from '../budget-list/budget-list.service';
import { exportListQuery } from '../budget-file/export-file';
import {
  assert,
  findVersion,
  inRolledBackTransaction,
  Kind,
  period,
  repeat,
  runSpecs,
  seedItem,
  seedMonths,
  seedTenant,
  seedVersion,
  TABLES,
} from './round-inputs.fixtures';
import { seedCompany as seedCostCenterCompany, seedCostCenter, seedUser } from './cost-center.fixtures';
import { exportBudgetFile, fileRows } from './budget-file.fixtures';

// The OPEX and CAPEX lists on the SQL list engine (`budget-list/`) against the
// database, with the same assertions for both: five columns in every slot, sort and
// filters on any year and column, the Ref filter, quick search on contracts
// and projects, ids and totals aligned with the summary, the lifecycle
// window, exact money; then the AI query layer on CAPEX and the CAPEX budget
// file export.
// @database-spec: runSpecs opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const Y = new Date().getFullYear();
const KINDS: Kind[] = ['opex', 'capex'];
const REF: Record<Kind, string> = { opex: 'OPX', capex: 'CPX' };

const identityFx = {
  resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
  convertValue: (amount: number, rate: number) => amount * rate,
};
const noAllocations = { computeForVersions: async () => new Map() };

function itemService(kind: Kind): any {
  if (kind === 'opex') {
    const args: any[] = Array.from({ length: 11 }, () => undefined);
    args[4] = noAllocations;
    args[6] = identityFx;
    return new (SpendItemsService as any)(...args);
  }
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[4] = noAllocations;
  args[7] = identityFx;
  return new (CapexItemsService as any)(...args);
}

const nameOf = (kind: Kind, row: any) => (kind === 'opex' ? row.product_name : row.description);
const month1 = (value: string) => [value, ...repeat('0', 11)];

type Fixture = { tenantId: string; ids: Record<'alpha' | 'bravo' | 'charlie' | 'delta' | 'echo', string> };

/**
 * Five lines: Alpha (#2, Budget and Forecast, a contract), Bravo (#12, a
 * linked project and an open task), Charlie (#3, three Budget months of 0.10),
 * Delta (#4, ended two years ago), Echo (#5, ended last year). Alpha, Bravo and
 * Charlie each carry 0.10 of Revision in January of this year.
 */
async function seedFixture(runner: QueryRunner, kind: Kind): Promise<Fixture> {
  const tenantId = await seedTenant(runner, `summary-${kind}`);
  const line = async (itemNumber: number, name: string) => seedItem(runner, kind, tenantId, itemNumber, name);
  const year = async (itemId: string, budgetYear: number, values: Parameters<typeof seedMonths>[5]) => {
    const versionId = await seedVersion(runner, kind, tenantId, itemId, budgetYear);
    await seedMonths(runner, kind, tenantId, versionId, budgetYear, values);
  };
  const ids = {
    alpha: await line(2, 'Alpha line'),
    bravo: await line(12, 'Bravo line'),
    charlie: await line(3, 'Charlie line'),
    delta: await line(4, 'Delta ended'),
    echo: await line(5, 'Echo ended'),
  };
  await year(ids.alpha, Y, { planned: repeat('100', 12), forecast: repeat('5', 12), committed: month1('0.10') });
  await year(ids.alpha, Y + 2, { forecast: repeat('7', 12) });
  await year(ids.alpha, Y + 3, { forecast: repeat('9', 12) });
  await year(ids.alpha, Y - 2, { committed: repeat('3', 12) });
  await year(ids.bravo, Y, { planned: repeat('50', 12), committed: month1('0.10') });
  await year(ids.bravo, Y + 3, { forecast: repeat('20', 12) });
  await year(ids.bravo, Y - 2, { committed: repeat('1', 12) });
  await year(ids.charlie, Y, { planned: ['0.10', '0.10', '0.10', ...repeat('0', 9)], committed: month1('0.10') });

  const items = TABLES[kind].items;
  await runner.query(`UPDATE ${items} SET effective_start = '2024-03-01' WHERE id = $1`, [ids.alpha]);
  await runner.query(`UPDATE ${items} SET disabled_at = $2, status = 'disabled' WHERE id = $1`, [ids.delta, `${Y - 2}-06-30T12:00:00Z`]);
  await runner.query(`UPDATE ${items} SET disabled_at = $2, status = 'disabled' WHERE id = $1`, [ids.echo, `${Y - 1}-06-30T12:00:00Z`]);

  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Summary company', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Summary supplier') RETURNING id`, [tenantId]);
  const [contract] = await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Zephyr agreement', $2, $3, '2024-01-01') RETURNING id`,
    [tenantId, company.id, supplier.id],
  );
  const contractLink = kind === 'opex' ? ['contract_spend_items', 'spend_item_id'] : ['contract_capex_items', 'capex_item_id'];
  await runner.query(`INSERT INTO ${contractLink[0]} (tenant_id, contract_id, ${contractLink[1]}) VALUES ($1, $2, $3)`, [tenantId, contract.id, ids.alpha]);

  const [project] = await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Nebula programme', 1) RETURNING id`,
    [tenantId],
  );
  const projectLink = kind === 'opex' ? ['portfolio_project_opex', 'opex_id'] : ['portfolio_project_capex', 'capex_id'];
  await runner.query(`INSERT INTO ${projectLink[0]} (tenant_id, project_id, ${projectLink[1]}) VALUES ($1, $2, $3)`, [tenantId, project.id, ids.bravo]);

  await runner.query(
    `INSERT INTO tasks (tenant_id, title, item_number, status, related_object_type, related_object_id) VALUES ($1, 'Renew licence', 1, 'open', $2, $3)`,
    [tenantId, kind === 'opex' ? 'spend_item' : 'capex_item', ids.bravo],
  );
  return { tenantId, ids };
}

async function withFixture(kind: Kind, fn: (runner: QueryRunner, fixture: Fixture, svc: any) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const fixture = await seedFixture(runner, kind);
    await fn(runner, fixture, itemService(kind));
  });
}

const ALL = { includeDisabled: 'true' };
const filters = (model: Record<string, unknown>) => JSON.stringify(model);

async function testFiveColumnsEverySlot(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const { items } = await svc.summary({ ...ALL, years: String(Y + 3), limit: 100 }, opts);
    const keys: string[] = SUMMARY_COLUMNS.map((c) => c.key).sort();
    for (const row of items) {
      for (const [slotKey, slot] of Object.entries<any>(row.versions)) {
        assert.deepEqual(Object.keys(slot.totals).sort(), keys, `${kind} ${slotKey}: five totals`);
        if (slot.reporting) {
          assert.deepEqual(Object.keys(slot.reporting).filter((k) => keys.includes(k)).sort(), keys, `${kind} ${slotKey}: five reporting totals`);
        }
      }
    }
    const alpha = items.find((row: any) => row.id === ids.alpha);
    assert.equal(alpha.versions.y.totals.forecast, 60, `${kind}: Forecast in Y`);
    assert.equal(alpha.versions.y.reporting.forecast, 60, `${kind}: Forecast in Y, reporting`);
    assert.equal(alpha.versions.yPlus2.totals.forecast, 84, `${kind}: Forecast in Y+2`);
    assert.equal(alpha.versions[`y${Y + 3}`].totals.forecast, 108, `${kind}: Forecast in a requested year`);
    assert.equal(alpha.versions.yMinus2.totals.revision, 36, `${kind}: Revision in Y-2`);

    const totals = await svc.summaryTotals({ ...ALL, years: String(Y + 3) }, opts);
    const expected = [...FIXED_SLOTS.map((s) => s.key as string), `y${Y + 3}`].flatMap((slot) => SUMMARY_COLUMNS.map((c) => `${slot}${c.suffix}`));
    assert.deepEqual(Object.keys(totals).sort(), [...expected, 'reportingCurrency'].sort(), `${kind}: totals carry every fixed slot and column and the requested year`);
    assert.equal(expected.length, 30);
    assert.equal(totals.yForecast, 60);
    assert.equal(totals.yPlus2Forecast, 84);
    assert.equal(totals.yMinus2Revision, 48);
    assert.equal(totals[`y${Y + 3}Forecast`], 348, `${kind}: a requested year's Forecast total`);
    assert.equal(totals.reportingCurrency, 'EUR');
  });
}

async function testSortOnAnyYearAndColumn(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    // The sort field names a year outside the fixed window: its slot is read without `years`.
    const byLaterForecast = await svc.summary({ ...ALL, sort: `y${Y + 3}Forecast:DESC` }, opts);
    assert.deepEqual(byLaterForecast.items.slice(0, 2).map((row: any) => row.id), [ids.bravo, ids.alpha], `${kind}: sorted on y${Y + 3}Forecast`);
    const byOldRevision = await svc.summary({ ...ALL, sort: 'yMinus2Revision:DESC' }, opts);
    assert.deepEqual(byOldRevision.items.slice(0, 2).map((row: any) => row.id), [ids.alpha, ids.bravo], `${kind}: sorted on yMinus2Revision`);

    const query = {
      ...ALL,
      sort: 'yBudget:ASC',
      q: 'line',
      filters: filters({ yBudget: { filterType: 'number', type: 'greaterThan', filter: 0 } }),
    };
    const page = await svc.summary({ ...query, limit: 100 }, opts);
    const navigation = await svc.summaryIds(query, opts);
    assert.deepEqual(navigation.ids, page.items.map((row: any) => row.id), `${kind}: ids follow the summary under sort, filter and search`);
    assert.equal(navigation.total, page.total);
    assert.deepEqual(navigation.ids, [ids.charlie, ids.bravo, ids.alpha]);
  });
}

async function testNumberFilterOnAmounts(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const above = await svc.summary({ ...ALL, filters: filters({ yBudget: { filterType: 'number', type: 'greaterThan', filter: 700 } }) }, opts);
    assert.deepEqual(above.items.map((row: any) => row.id), [ids.alpha], `${kind}: greaterThan on Budget Y`);
    const range = await svc.summary({ ...ALL, filters: filters({ yBudget: { filterType: 'number', type: 'inRange', filter: 500, filterTo: 700 } }) }, opts);
    assert.deepEqual(range.items.map((row: any) => row.id), [ids.bravo], `${kind}: inRange on Budget Y`);
    const later = await svc.summary({ ...ALL, filters: filters({ [`y${Y + 3}Forecast`]: { filterType: 'number', type: 'greaterThanOrEqual', filter: 200 } }) }, opts);
    assert.deepEqual(later.items.map((row: any) => row.id), [ids.bravo], `${kind}: a filter on a year outside the window reads that year`);
  });
}

async function testDateAndRefFilters(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const sorted = { ...ALL, sort: 'item_number:ASC' };
    const since = await svc.summary({ ...sorted, filters: filters({ effective_start: { filterType: 'date', type: 'greaterThan', dateFrom: '2023-01-01 00:00:00' } }) }, opts);
    assert.deepEqual(since.items.map((row: any) => row.id), [ids.alpha], `${kind}: date filter on the effective start`);

    const bare = await svc.summary({ ...sorted, filters: filters({ item_number: { filterType: 'text', type: 'contains', filter: '2' } }) }, opts);
    assert.deepEqual(bare.items.map((row: any) => row.id), [ids.alpha, ids.bravo], `${kind}: Ref contains 2`);
    const ref = await svc.summary({ ...sorted, filters: filters({ item_number: { filterType: 'text', type: 'contains', filter: `${REF[kind]}-2` } }) }, opts);
    assert.deepEqual(ref.items.map((row: any) => row.id), [ids.alpha], `${kind}: Ref contains ${REF[kind]}-2`);
    const lower = await svc.summary({ ...sorted, filters: filters({ item_number: { filterType: 'text', type: 'equals', filter: `${REF[kind].toLowerCase()}-12` } }) }, opts);
    assert.deepEqual(lower.items.map((row: any) => row.id), [ids.bravo], `${kind}: Ref equals, any case`);
    const ids2 = await svc.summaryIds({ ...sorted, filters: filters({ item_number: { filterType: 'text', type: 'contains', filter: '2' } }) }, opts);
    assert.deepEqual(ids2.ids, [ids.alpha, ids.bravo], `${kind}: the ids take the Ref filter too`);
    // Text operators on non-text columns never reach SQL.
    const uuidText = await svc.summary({ ...sorted, filters: filters({ project_id: { filterType: 'text', type: 'contains', filter: 'abc' } }) }, opts);
    assert.equal(uuidText.total, 0, `${kind}: a text filter on an id column answers, empty`);
  });
}

async function testQuickSearchAndFilterValues(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const byContract = await svc.summary({ ...ALL, q: 'zephyr' }, opts);
    assert.deepEqual(byContract.items.map((row: any) => row.id), [ids.alpha], `${kind}: quick search on a contract`);
    assert.equal(byContract.items[0].latest_contract_name, 'Zephyr agreement');
    const byProject = await svc.summary({ ...ALL, q: 'nebula' }, opts);
    assert.deepEqual(byProject.items.map((row: any) => row.id), [ids.bravo], `${kind}: quick search on a linked project`);
    assert.equal(byProject.items[0].project_name, 'Nebula programme', `${kind}: the project column reads the linked projects`);

    const values = await svc.summaryFilterValues({ ...ALL, fields: 'contract_name,project_name,supplier_name' }, opts);
    assert.deepEqual(values.contract_name, ['Zephyr agreement', null]);
    assert.deepEqual(values.project_name, ['Nebula programme', null]);
    assert.deepEqual(values.supplier_name, [null]);
    const narrowed = await svc.summaryFilterValues({
      ...ALL,
      fields: 'contract_name,project_name',
      filters: filters({ project_name: { filterType: 'set', values: ['Nebula programme'] } }),
    }, opts);
    assert.deepEqual(narrowed.contract_name, [null], `${kind}: another column's filter narrows the list`);
    assert.deepEqual(narrowed.project_name, ['Nebula programme', null], `${kind}: a column's own filter does not`);
  });
}

async function testTaskFilterKeepsTotalsAndIdsAligned(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const query = { ...ALL, filters: filters({ latest_task_text: { filterType: 'text', type: 'contains', filter: 'renew' } }) };
    const page = await svc.summary(query, opts);
    assert.deepEqual(page.items.map((row: any) => row.id), [ids.bravo], `${kind}: the task filter keeps Bravo`);
    const navigation = await svc.summaryIds(query, opts);
    assert.deepEqual(navigation.ids, [ids.bravo], `${kind}: the ids read the task too`);
    const totals = await svc.summaryTotals(query, opts);
    assert.equal(totals.yBudget, 600, `${kind}: the totals follow the task filter`);
  });
}

async function testLifecycleWindow(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const later = await svc.summary({ years: String(Y + 2), limit: 100 }, opts);
    const laterIds = later.items.map((row: any) => row.id);
    assert.ok(!laterIds.includes(ids.echo), `${kind}: a requested later year leaves out a line ended before it`);
    assert.ok(laterIds.includes(ids.alpha));
    const plain = await svc.summary({ limit: 100 }, opts);
    const plainIds = plain.items.map((row: any) => row.id);
    assert.ok(plainIds.includes(ids.echo), `${kind}: without years, a line ended last year stays`);
    assert.ok(!plainIds.includes(ids.delta), `${kind}: a line ended two years ago does not`);
  });
}

async function testExplicitStatusWinsOverAll(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const disabled = await svc.summary({ ...ALL, sort: 'item_number:ASC', filters: filters({ status: { filterType: 'set', values: ['disabled'] } }) }, opts);
    assert.deepEqual(disabled.items.map((row: any) => row.id), [ids.delta, ids.echo], `${kind}: a status filter applies with "all"`);
    const enabled = await svc.summaryIds({ ...ALL, status: 'enabled', sort: 'item_number:ASC' }, opts);
    assert.deepEqual(enabled.ids, [ids.alpha, ids.charlie, ids.bravo], `${kind}: an explicit status applies with "all"`);
  });
}

async function testMoneyIsExact(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const [charlie] = await svc.summaryRowsByIds([ids.charlie], {}, opts);
    assert.strictEqual(charlie.versions.y.totals.budget, 0.3, `${kind}: three months of 0.10 are 0.30 in the slot`);
    assert.strictEqual(charlie.versions.y.reporting.budget, 0.3, `${kind}: and in reporting`);
    const totals = await svc.summaryTotals(ALL, opts);
    assert.strictEqual(totals.yRevision, 0.3, `${kind}: three lines of 0.10 are 0.30 in the totals`);
  });
}

/** The engine called directly (no cap since lot 2B: `capped` is never set). */
const engineDeps: any = { allocationCalculator: noAllocations, fxRates: identityFx };

/** One page from the SQL list engine of a type, called directly. */
function engineSummary(kind: Kind, query: any, manager: any): Promise<any> {
  return budgetList.budgetListSummary(SUMMARY_SCOPES[kind], engineDeps, query, manager);
}

/** No cap: the page, its total, the ids, the totals and the filter values read every line. */
async function testEngineReadsEveryLine(kind: Kind) {
  await withFixture(kind, async (runner, { ids }) => {
    const scope = SUMMARY_SCOPES[kind];
    const query = { ...ALL, sort: 'yBudget:DESC', limit: 2 };
    const page = await engineSummary(kind, query, runner.manager);
    assert.equal('capped' in page, false, `${kind}: no cap, never reported`);
    assert.equal(page.items.length, 2);
    assert.equal(page.total, 5);
    assert.deepEqual(page.items.map((row: any) => row.id), [ids.alpha, ids.bravo], `${kind}: the page comes from every line, sorted`);
    const navigation = await budgetList.budgetListIds(scope, engineDeps, query, runner.manager);
    assert.equal(navigation.total, 5);
    assert.deepEqual(navigation.ids.slice(0, 2), [ids.alpha, ids.bravo]);
    const totals = await budgetList.budgetListTotals(scope, engineDeps, query, runner.manager);
    assert.equal(totals.yBudget, 1800.3);
    const values = await budgetList.budgetListFilterValues(scope, engineDeps, { ...ALL, fields: 'currency' }, runner.manager);
    assert.deepEqual(values.currency, ['EUR']);
  });
}

async function testBlankOnAnyColumnRunsInSql(kind: Kind) {
  await withFixture(kind, async (runner) => {
    const blank = await engineSummary(kind, { ...ALL, filters: filters({ owner_it_id: { filterType: 'text', type: 'blank' } }) }, runner.manager);
    assert.equal(blank.total, 5);
    const notBlank = await engineSummary(kind, { ...ALL, filters: filters({ owner_it_id: { filterType: 'text', type: 'notBlank' } }) }, runner.manager);
    assert.equal(notBlank.total, 0, `${kind}: no line has an IT owner`);
  });
}

async function testStatusSortsTheSameEverywhere(kind: Kind) {
  await withFixture(kind, async (runner) => {
    const statuses = (page: any) => page.items.map((row: any) => row.status);
    const expected = ['enabled', 'enabled', 'enabled', 'disabled', 'disabled'];
    // Without a search: the enum order, enabled first.
    const inSql = await engineSummary(kind, { ...ALL, sort: 'status:ASC' }, runner.manager);
    assert.deepEqual(statuses(inSql), expected, `${kind}: status ascending, in SQL`);
    // With a search (every name contains "e"): the same order.
    const searched = await itemService(kind).summary({ ...ALL, sort: 'status:ASC', q: 'e' }, { manager: runner.manager });
    assert.deepEqual(statuses(searched), expected, `${kind}: status ascending, with a search`);
    const descending = await itemService(kind).summary({ ...ALL, sort: 'status:DESC', q: 'e' }, { manager: runner.manager });
    assert.deepEqual(statuses(descending), [...expected].reverse(), `${kind}: status descending, with a search`);
  });
}

async function testTextFilterOnADate(kind: Kind) {
  await withFixture(kind, async (runner, _fixture, svc) => {
    const month = new Date().toISOString().slice(0, 7);
    const created = await svc.summary({ ...ALL, filters: filters({ created_at: { filterType: 'text', type: 'contains', filter: month } }) }, { manager: runner.manager });
    assert.equal(created.total, 5, `${kind}: a text filter on Created reads the ISO date`);
  });
}

async function testSeveralLinkedProjects(kind: Kind) {
  await withFixture(kind, async (runner, { tenantId, ids }, svc) => {
    const opts = { manager: runner.manager };
    const [category] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Run') RETURNING id`, [tenantId]);
    const link = kind === 'opex' ? ['portfolio_project_opex', 'opex_id'] : ['portfolio_project_capex', 'capex_id'];
    for (const [itemNumber, project, stream] of [[2, 'Atlas', 'Digital'], [3, 'Borealis', 'Infra']] as const) {
      const [streamRow] = await runner.query(
        `INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, category.id, stream],
      );
      const [projectRow] = await runner.query(
        `INSERT INTO portfolio_projects (tenant_id, name, item_number, stream_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, project, itemNumber, streamRow.id],
      );
      await runner.query(`INSERT INTO ${link[0]} (tenant_id, project_id, ${link[1]}) VALUES ($1, $2, $3)`, [tenantId, projectRow.id, ids.charlie]);
    }

    const values = await svc.summaryFilterValues({ ...ALL, fields: 'project_name,project_stream_name' }, opts);
    assert.deepEqual(values.project_stream_name, ['Digital', 'Infra', null], `${kind}: each stream is offered on its own`);
    assert.deepEqual(values.project_name, ['Atlas', 'Borealis', 'Nebula programme', null], `${kind}: each project is offered on its own`);
    for (const stream of ['Digital', 'Infra']) {
      const kept = await svc.summary({ ...ALL, filters: filters({ project_stream_name: { filterType: 'set', values: [stream] } }) }, opts);
      assert.deepEqual(kept.items.map((row: any) => row.id), [ids.charlie], `${kind}: a filter on ${stream} keeps the line linked to both`);
      assert.equal(kept.items[0].project_stream_name, 'Digital, Infra');
    }

    const entityType = kind === 'opex' ? 'spend_items' : 'capex_items';
    const context = aiContext(runner, tenantId) as any;
    const query: any = await queryExecutor(svc, kind).execute(context, { entity_type: entityType, filters: { project_stream: ['Infra'] } });
    assert.deepEqual(query.items.map((item: any) => item.label), ['Charlie line'], `${kind}: the AI stream filter keeps the line too`);
    const grouped: any = await aggregateExecutor(svc, kind).execute(context, { entity_type: entityType, group_by: 'project_stream', function: 'count' });
    assert.ok(grouped.groups.some((group: any) => group.key === 'Digital, Infra' && group.count === 1), `${kind}: grouping keeps the combination`);
  });
}

async function testAiAggregateSumsInCents(kind: Kind) {
  await withFixture(kind, async (runner, { tenantId }, svc) => {
    const entityType = kind === 'opex' ? 'spend_items' : 'capex_items';
    const context = aiContext(runner, tenantId) as any;
    const enabled = (result: any) => result.groups.find((group: any) => group.key === 'enabled')?.value;
    const sum = await aggregateExecutor(svc, kind).execute(context, { entity_type: entityType, group_by: 'status', metric: 'y_review', function: 'sum' });
    assert.strictEqual(enabled(sum), 0.3, `${kind}: three amounts of 0.10 sum to 0.30 exactly`);
    const avg = await aggregateExecutor(svc, kind).execute(context, { entity_type: entityType, group_by: 'status', metric: 'y_review', function: 'avg' });
    assert.strictEqual(enabled(avg), 0.1, `${kind}: their average is 0.10`);
  });
}

/**
 * The list engine's aggregate (lot 2B, PR D) on the five lines, numbers
 * worked out by hand: a top 2 of the lines by Y Budget with the others and
 * the total (Alpha 1 200, Bravo 600, the rest 0.30), a variance between two
 * years with its gross decreases and increases, kept by a condition (the
 * total still covers every line), a mean, FTE unknown on every line, and the
 * page's default scope (the window: Delta, ended two years ago, is out).
 */
async function testAggregate(kind: Kind) {
  await withFixture(kind, async (runner, _fixture, svc) => {
    const opts = { manager: runner.manager };
    const name = kind === 'opex' ? 'product_name' : 'description';
    const top: any = await svc.summaryAggregate(ALL, {
      groupBy: [name],
      measures: [{ id: 'budget', fn: 'sum', field: 'yBudget' }],
      order: [{ by: 'measure', id: 'budget', dir: 'DESC' }],
      limit: 2,
      others: true,
    }, opts);
    assert.deepEqual(top.groups.map((g: any) => [g.keys[0], g.count, g.values.budget]), [['Alpha line', 1, 1200], ['Bravo line', 1, 600]], `${kind}: top 2 lines`);
    assert.deepEqual([top.others.count, top.others.values.budget], [3, 0.3], `${kind}: the others add up the rest`);
    assert.deepEqual([top.total.count, top.total.values.budget, top.groupCount, top.reportingCurrency], [5, 1800.3, 5, 'EUR'], `${kind}: the total of every line`);

    // Revision of Y against Revision of Y-2: Alpha 0.10 - 36, Bravo 0.10 - 12, Charlie 0.10, Delta and Echo 0.
    const variance = (id: string, part?: 'positive' | 'negative') => ({ id, fn: 'sum' as const, field: 'yRevision', minus: 'yMinus2Revision', ...(part ? { part } : {}) });
    const down: any = await svc.summaryAggregate(ALL, {
      groupBy: [name],
      measures: [variance('delta'), variance('up', 'positive'), variance('down', 'negative')],
      having: [{ measure: 'delta', op: 'lt', value: 0 }],
      order: [{ by: 'measure', id: 'delta', dir: 'ASC' }],
    }, opts);
    assert.deepEqual(down.groups.map((g: any) => [g.keys[0], g.values.delta]), [['Alpha line', -35.9], ['Bravo line', -11.9]], `${kind}: the decreases, largest first`);
    assert.deepEqual([down.groupCount, down.total.count, down.total.values], [2, 5, { delta: -47.7, up: 0.1, down: -47.8 }], `${kind}: the net and gross variance of every line`);

    const byStatus: any = await svc.summaryAggregate(ALL, {
      groupBy: ['status'],
      measures: [{ id: 'mean', fn: 'avg', field: 'yRevision' }, { id: 'fte', fn: 'sum', field: 'fte_yBudget' }],
    }, opts);
    assert.deepEqual(
      byStatus.groups.map((g: any) => [g.keys[0], g.count, g.values.mean, g.values.fte, g.unknown.fte]),
      [['enabled', 3, 0.1, null, 3], ['disabled', 2, 0, null, 2]],
      `${kind}: count first; a mean to the cent; FTE unknown on every line`,
    );

    const window: any = await svc.summaryAggregate({}, { groupBy: [], measures: [] }, opts);
    const page = await svc.summary({ limit: 1 }, opts);
    assert.deepEqual([window.total.count, window.groups.length], [page.total, 1], `${kind}: without a status, the page's lines`);
    assert.equal(page.total, 4, `${kind}: the window leaves out Delta, ended two years ago`);
  });
}

/**
 * Decision Q4 (lot 2B, PR C): the CAPEX priority, investment type and PPE type
 * sort in their business order (the declaration order of their enums), with
 * or without a search, in the page, the ids and the AI list (before: by code,
 * high < low < mandatory < medium). Their filter values keep the text order.
 */
async function testCapexEnumsSortInBusinessOrder() {
  await withFixture('capex', async (runner, { tenantId, ids }, svc) => {
    const opts = { manager: runner.manager };
    const set: Array<[string, string, string, string]> = [
      [ids.alpha, 'low', 'other', 'software'],
      [ids.bravo, 'mandatory', 'replacement', 'hardware'],
      [ids.charlie, 'high', 'security', 'software'],
      [ids.delta, 'medium', 'capacity', 'hardware'],
      [ids.echo, 'high', 'business_growth', 'software'],
    ];
    for (const [id, priority, investment, ppe] of set) {
      await runner.query(
        `UPDATE capex_items SET priority = $3, investment_type = $4, ppe_type = $5 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, priority, investment, ppe],
      );
    }
    const column = async (field: string, dir: 'ASC' | 'DESC', q?: string) => {
      const query = { ...ALL, sort: `${field}:${dir}`, ...(q ? { q } : {}) };
      const page = await svc.summary({ ...query, limit: 100 }, opts);
      const navigation = await svc.summaryIds(query, opts);
      assert.deepEqual(navigation.ids, page.items.map((row: any) => row.id), `${field} ${dir}: the ids follow the page`);
      return page.items.map((row: any) => row[field]);
    };
    const priorities = ['mandatory', 'high', 'high', 'medium', 'low'];
    assert.deepEqual(await column('priority', 'ASC'), priorities, 'priority ascending: mandatory first');
    assert.deepEqual(await column('priority', 'DESC'), [...priorities].reverse(), 'priority descending');
    assert.deepEqual(await column('priority', 'ASC', 'e'), priorities, 'priority ascending, with a search');
    assert.deepEqual(await column('investment_type', 'ASC'), ['replacement', 'capacity', 'security', 'business_growth', 'other'], 'investment type as declared');
    assert.deepEqual(await column('ppe_type', 'DESC'), ['software', 'software', 'software', 'hardware', 'hardware'], 'PPE type descending');

    const values = await svc.summaryFilterValues({ ...ALL, fields: 'priority,investment_type,ppe_type' }, opts);
    assert.deepEqual(values.priority, ['high', 'low', 'mandatory', 'medium'], 'filter values: text order (the grid orders its options by label)');
    assert.deepEqual(values.ppe_type, ['hardware', 'software']);

    const listed: any = await queryExecutor(svc).execute(aiContext(runner, tenantId) as any, {
      entity_type: 'capex_items',
      sort: { field: 'priority', direction: 'asc' },
    });
    assert.deepEqual(listed.items.map((item: any) => item.metadata.priority), priorities, 'AI: sorted by priority in business order');
  });
}

/** The CAPEX list has no cap (lot 2B, PR C): a page is truncated when the total holds more lines, and `capped` is not read. */
async function testAiMarksAPartialListTruncated() {
  const line = { id: 'capex-1', description: 'Only line', versions: {} };
  // The registry is resolved for the tenant: a tenant without analytics dimensions.
  const context = { tenantId: 'tenant-ai', userId: null, isPlatformHost: false, surface: 'chat', authMethod: 'jwt', manager: { query: async () => [] } } as any;
  const partial: any = await queryExecutor({ summary: async () => ({ items: [line], total: 3, page: 1, limit: 1 }) }).execute(context, { entity_type: 'capex_items' });
  assert.equal(partial.truncated, true, 'AI: a page holding part of the list is truncated');
  assert.equal(partial.complete, false);
  const whole: any = await queryExecutor({ summary: async () => ({ items: [line], total: 1, page: 1, limit: 200, capped: true }) }).execute(context, { entity_type: 'capex_items' });
  assert.equal(whole.truncated, false, 'AI: a former capped flag is not read');
  assert.equal(whole.complete, true);
}

// ----- AI query layer on CAPEX, registries of both types, CAPEX export -----

const aiContext = (runner: QueryRunner, tenantId: string) => ({
  tenantId,
  userId: null as any,
  isPlatformHost: false,
  surface: 'chat' as const,
  authMethod: 'jwt' as const,
  manager: runner.manager,
});

// Constructor positions of the item services: spendItems 5, capexItems 17 (both executors).
function queryExecutor(items: unknown, kind: Kind = 'capex'): AiQueryExecutor {
  const args: any[] = Array.from({ length: 23 }, () => ({}));
  args[kind === 'opex' ? 5 : 17] = items;
  return new (AiQueryExecutor as any)(...args);
}

function aggregateExecutor(items: unknown, kind: Kind = 'capex'): AiAggregateExecutor {
  const args: any[] = Array.from({ length: 22 }, () => ({}));
  args[kind === 'opex' ? 5 : 17] = items;
  return new (AiAggregateExecutor as any)(...args);
}

async function testAiCapexAmountFilter() {
  await withFixture('capex', async (runner, { tenantId }, svc) => {
    const result: any = await queryExecutor(svc).execute(aiContext(runner, tenantId) as any, {
      entity_type: 'capex_items',
      filters: { y_budget: { op: 'gt', value: 700 } },
    });
    assert.deepEqual(result.items.map((item: any) => item.label), ['Alpha line'], 'AI: a CAPEX amount filter keeps the matching line');
    assert.equal(result.complete, true);
    const alpha = result.items[0].metadata;
    assert.equal(alpha.y_budget, 1200);
    assert.equal(alpha.y_forecast, 60, 'AI: CAPEX exposes Forecast');
    assert.equal(alpha.y_plus2_forecast, 84);
    assert.equal(alpha.y_minus2_review, 36, 'AI: CAPEX exposes Revision under the OPEX key');
    assert.equal(alpha.contract, 'Zephyr agreement');
    assert.equal((alpha.yearly_totals as any[]).length, 5);
  });
}

async function testAiCapexDetail() {
  await withFixture('capex', async (runner, { tenantId, ids }, svc) => {
    const [app] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Orion portal') RETURNING id`, [tenantId]);
    await runner.query(
      `INSERT INTO application_capex_items (tenant_id, application_id, capex_item_id) VALUES ($1, $2, $3)`,
      [tenantId, app.id, ids.alpha],
    );
    const args: any[] = Array.from({ length: 23 }, () => ({}));
    args[6] = { listContractsForCapexItem: async () => ({ items: [] }) };
    args[17] = svc;
    // By reference: the detail reads the line under its id.
    const detail: any = await new (AiQueryExecutor as any)(...args).executeDetail(aiContext(runner, tenantId), {
      entity_type: 'capex_items',
      entity_id: 'CPX-2',
    });
    assert.deepEqual(detail.data.linked_applications, { items: [{ id: app.id, name: 'Orion portal' }] }, 'AI: the CAPEX detail lists its applications');
    assert.equal(detail.data.latest_contract_name, 'Zephyr agreement');
    assert.equal(detail.entity.metadata.y_forecast, 60, 'AI: the CAPEX detail reads every column');
  });
}

async function testAiCapexAggregateIsComplete() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'summary-aggregate');
    await runner.query(
      `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
       SELECT $1, 'Bulk line ' || n, 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', n FROM generate_series(1, 1001) AS n`,
      [tenantId],
    );
    const result: any = await aggregateExecutor(itemService('capex')).execute(aiContext(runner, tenantId) as any, {
      entity_type: 'capex_items',
      group_by: 'status',
      function: 'count',
    });
    assert.equal(result.total, 1001);
    assert.deepEqual(result.groups, [{ key: 'enabled', count: 1001 }], 'AI: every CAPEX line counted, beyond 1 000');
    assert.equal(result.complete, true);
  });
}

/**
 * Cost centers: IT department (group) › Applications (group) › IT-200, and a
 * root cost center LG-10. Alpha is on IT-200 (run), Bravo on LG-10 (build).
 */
async function seedCostCenters(runner: QueryRunner, tenantId: string, kind: Kind, ids: Fixture['ids']) {
  const { companyId } = await seedCostCenterCompany(runner, tenantId, 'Cost center company');
  const it = await seedCostCenter(runner, tenantId, { code: 'IT', name: 'IT department', kind: 'group' });
  const apps = await seedCostCenter(runner, tenantId, { code: 'IT-APPS', name: 'Applications', kind: 'group', parentId: it });
  const it200 = await seedCostCenter(runner, tenantId, { code: 'IT-200', name: 'Business apps', parentId: apps, companyId });
  const lg10 = await seedCostCenter(runner, tenantId, { code: 'LG-10', name: 'Logistics IT', companyId });
  const items = TABLES[kind].items;
  await runner.query(`UPDATE ${items} SET cost_center_id = $2, run_build = 'run' WHERE id = $1`, [ids.alpha, it200]);
  await runner.query(`UPDATE ${items} SET cost_center_id = $2, run_build = 'build' WHERE id = $1`, [ids.bravo, lg10]);
  return { it200, lg10 };
}

async function testCostCenterFields(kind: Kind) {
  await withFixture(kind, async (runner, { tenantId, ids }, svc) => {
    const opts = { manager: runner.manager };
    const { it200 } = await seedCostCenters(runner, tenantId, kind, ids);

    const { items } = await svc.summary({ ...ALL, limit: 100 }, opts);
    const alpha = items.find((row: any) => row.id === ids.alpha);
    assert.equal(alpha.cost_center_id, it200);
    assert.equal(alpha.cost_center_code, 'IT-200');
    assert.equal(alpha.cost_center_name, 'Business apps');
    assert.equal(alpha.cost_center_label, 'IT-200 · Business apps');
    assert.equal(alpha.cost_center_path, 'IT department › Applications › Business apps', `${kind}: the path of a three-level node`);
    assert.equal(alpha.run_build, 'run');
    const charlie = items.find((row: any) => row.id === ids.charlie);
    assert.deepEqual(
      [charlie.cost_center_id, charlie.cost_center_code, charlie.cost_center_label, charlie.cost_center_path, charlie.run_build],
      [null, null, null, null, null],
      `${kind}: a line without cost center`,
    );

    const values = await svc.summaryFilterValues({ ...ALL, fields: 'cost_center_label,cost_center_code,cost_center_name,cost_center_path,run_build' }, opts);
    assert.deepEqual(values.cost_center_label, ['IT-200 · Business apps', 'LG-10 · Logistics IT', null]);
    assert.deepEqual(values.cost_center_code, ['IT-200', 'LG-10', null]);
    assert.deepEqual(values.cost_center_path, ['IT department › Applications › Business apps', 'Logistics IT', null]);
    assert.deepEqual(values.run_build, ['build', 'run', null]);

    const byLabel = await svc.summary({ ...ALL, filters: filters({ cost_center_label: { filterType: 'set', values: ['LG-10 · Logistics IT', null] } }) }, opts);
    assert.deepEqual(byLabel.items.map((row: any) => row.id).sort(), [ids.bravo, ids.charlie, ids.delta, ids.echo].sort(), `${kind}: set filter on the label, blanks included`);
    const byGroup = await svc.summary({ ...ALL, filters: filters({ cost_center_path: { filterType: 'text', type: 'contains', filter: 'it department' } }) }, opts);
    assert.deepEqual(byGroup.items.map((row: any) => row.id), [ids.alpha], `${kind}: a group through the path`);

    const build = await engineSummary(kind, { ...ALL, filters: filters({ run_build: { filterType: 'set', values: ['build'] } }) }, runner.manager);
    assert.deepEqual(build.items.map((row: any) => row.id), [ids.bravo]);
    const blankRunBuild = await engineSummary(kind, { ...ALL, filters: filters({ run_build: { filterType: 'set', values: [null] } }) }, runner.manager);
    assert.equal(blankRunBuild.total, 3, `${kind}: blank run or build`);

    const byCode = await svc.summary({ ...ALL, q: 'it-200' }, opts);
    assert.deepEqual(byCode.items.map((row: any) => row.id), [ids.alpha], `${kind}: quick search by code`);
    const byName = await svc.summary({ ...ALL, q: 'logistics it' }, opts);
    assert.deepEqual(byName.items.map((row: any) => row.id), [ids.bravo], `${kind}: quick search by name`);
    const byPath = await svc.summary({ ...ALL, q: 'applications' }, opts);
    assert.deepEqual(byPath.items.map((row: any) => row.id), [ids.alpha], `${kind}: quick search by a group of the path`);

    const labels = (page: any) => page.items.map((row: any) => row.cost_center_label);
    const ascending = await svc.summary({ ...ALL, sort: 'cost_center_label:ASC' }, opts);
    assert.deepEqual(labels(ascending), ['IT-200 · Business apps', 'LG-10 · Logistics IT', null, null, null], `${kind}: label ascending, blanks last`);
    const descending = await svc.summary({ ...ALL, sort: 'cost_center_label:DESC' }, opts);
    assert.deepEqual(labels(descending), [null, null, null, 'LG-10 · Logistics IT', 'IT-200 · Business apps'], `${kind}: label descending`);

    const runBuilds = (page: any) => page.items.map((row: any) => row.run_build);
    const inSql = await engineSummary(kind, { ...ALL, sort: 'run_build:ASC' }, runner.manager);
    assert.deepEqual(runBuilds(inSql), ['run', 'build', null, null, null]);
    const inMemory = await svc.summary({ ...ALL, sort: 'run_build:ASC', q: 'e' }, opts);
    assert.deepEqual(runBuilds(inMemory), ['run', 'build', null, null, null], `${kind}: the same order in memory`);
    const down = await svc.summary({ ...ALL, sort: 'run_build:DESC', q: 'e' }, opts);
    assert.deepEqual(runBuilds(down), [null, null, null, 'build', 'run'], `${kind}: run or build descending`);
    const downSql = await engineSummary(kind, { ...ALL, sort: 'run_build:DESC' }, runner.manager);
    assert.deepEqual(runBuilds(downSql), [null, null, null, 'build', 'run'], `${kind}: run or build descending, in SQL`);
  });
}

/** A user of the tenant with the given name. */
async function seedNamedUser(runner: QueryRunner, tenantId: string, email: string, first: string, last: string): Promise<string> {
  const id = await seedUser(runner, tenantId, email);
  await runner.query(`UPDATE users SET first_name = $3, last_name = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, first, last]);
  return id;
}

/**
 * The budget holder is the owner of the line's cost center, read at build
 * time: Alpha's IT-200 has one, Bravo's LG-10 has none, Charlie has no cost
 * center. Changing the owner of a cost center changes every line on it.
 */
async function testBudgetHolder(kind: Kind) {
  await withFixture(kind, async (runner, { tenantId, ids }, svc) => {
    const opts = { manager: runner.manager };
    const { it200, lg10 } = await seedCostCenters(runner, tenantId, kind, ids);
    const ada = await seedNamedUser(runner, tenantId, `ada-${kind}@summary.test`, 'Ada', 'Holder');
    const bea = await seedNamedUser(runner, tenantId, `bea-${kind}@summary.test`, 'Bea', 'Keeper');
    await runner.query(`UPDATE cost_centers SET owner_user_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, it200, ada]);

    const holders = async () => {
      const { items } = await svc.summary({ ...ALL, limit: 100 }, opts);
      return Object.fromEntries(items.map((row: any) => [row.id, [row.budget_holder_id, row.budget_holder_name]]));
    };
    const before = await holders();
    assert.deepEqual(before[ids.alpha], [ada, 'Ada Holder'], `${kind}: the cost center's owner`);
    assert.deepEqual(before[ids.bravo], [null, null], `${kind}: a cost center without owner`);
    assert.deepEqual(before[ids.charlie], [null, null], `${kind}: a line without cost center`);

    const values = await svc.summaryFilterValues({ ...ALL, fields: 'budget_holder_name' }, opts);
    assert.deepEqual(values.budget_holder_name, ['Ada Holder', null], `${kind}: filter values`);
    const byHolder = await svc.summary({ ...ALL, filters: filters({ budget_holder_name: { filterType: 'set', values: ['Ada Holder'] } }) }, opts);
    assert.deepEqual(byHolder.items.map((row: any) => row.id), [ids.alpha], `${kind}: set filter`);
    const blanks = await svc.summary({ ...ALL, filters: filters({ budget_holder_name: { filterType: 'set', values: [null] } }) }, opts);
    assert.deepEqual(blanks.items.map((row: any) => row.id).sort(), [ids.bravo, ids.charlie, ids.delta, ids.echo].sort(), `${kind}: set filter on blanks`);
    const searched = await svc.summary({ ...ALL, q: 'ada holder' }, opts);
    assert.deepEqual(searched.items.map((row: any) => row.id), [ids.alpha], `${kind}: quick search by budget holder`);

    // The lines carry nothing: a new owner on the cost centers shows on every line at once.
    await runner.query(`UPDATE cost_centers SET owner_user_id = $2 WHERE tenant_id = $1 AND id = ANY($3::uuid[])`, [tenantId, bea, [it200, lg10]]);
    const after = await holders();
    assert.deepEqual(after[ids.alpha], [bea, 'Bea Keeper'], `${kind}: follows the cost center's owner`);
    assert.deepEqual(after[ids.bravo], [bea, 'Bea Keeper']);
    const afterValues = await svc.summaryFilterValues({ ...ALL, fields: 'budget_holder_name' }, opts);
    assert.deepEqual(afterValues.budget_holder_name, ['Bea Keeper', null]);
    const listed: any = await queryExecutor(svc, kind).execute(aiContext(runner, tenantId) as any, {
      entity_type: kind === 'opex' ? 'spend_items' : 'capex_items',
    });
    const holderOf = (label: string) => listed.items.find((item: any) => item.label === label)?.metadata.budget_holder;
    assert.deepEqual([holderOf('Alpha line'), holderOf('Charlie line')], ['Bea Keeper', null], `${kind}: AI item metadata`);

    // The AI dynamic values read the registry's SQL group field: joined on the tenant.
    const registry = getAiEntityRegistry(kind === 'opex' ? 'spend_items' : 'capex_items');
    const group = registry.aggregate!.groupFields.budget_holder;
    const alias = registry.aggregate!.alias;
    const grouped: Array<{ key: string | null; count: number }> = await runner.query(
      `SELECT ${group.expression} AS key, COUNT(*)::int AS count
       FROM ${registry.aggregate!.baseTable} ${alias}
       ${(group.joins ?? []).join('\n')}
       WHERE ${alias}.tenant_id = $1
       GROUP BY 1 ORDER BY 1 NULLS LAST`,
      [tenantId],
    );
    assert.deepEqual(grouped, [{ key: 'Bea Keeper', count: 2 }, { key: null, count: 3 }], `${kind}: the SQL group field`);
  });
}

/**
 * Two analytics dimensions: the default one (no name) and Nature. Alpha holds
 * Licences and Subscriptions, Bravo Services and Maintenance, Charlie nothing
 * on the links but a stale legacy column (Licences): the engine reads the
 * links only.
 */
async function seedAnalytics(runner: QueryRunner, tenantId: string, kind: Kind, ids: Fixture['ids']) {
  const axis = async (code: string, name: string | null, isDefault: boolean, order: number): Promise<string> => {
    const [row] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, is_default, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, code, name, isDefault, order],
    );
    return row.id;
  };
  const value = async (axisId: string, name: string): Promise<string> => {
    const [row] = await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, axisId, name],
    );
    return row.id;
  };
  const defaultAxis = await axis('default', null, true, 0);
  const nature = await axis('nature', 'Nature', false, 1);
  const licences = await value(defaultAxis, 'Licences');
  const services = await value(defaultAxis, 'Services');
  const subscriptions = await value(nature, 'Subscriptions');
  const maintenance = await value(nature, 'Maintenance');
  const link = SUMMARY_SCOPES[kind].analyticsLink.table;
  for (const [itemId, axisId, categoryId] of [
    [ids.alpha, defaultAxis, licences], [ids.alpha, nature, subscriptions],
    [ids.bravo, defaultAxis, services], [ids.bravo, nature, maintenance],
  ]) {
    await runner.query(`INSERT INTO ${link} (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [tenantId, itemId, axisId, categoryId]);
  }
  await runner.query(`UPDATE ${TABLES[kind].items} SET analytics_category_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, ids.charlie, licences]);
  return { defaultAxis, nature, licences, services, subscriptions, maintenance };
}

async function testAnalyticsDimensions(kind: Kind) {
  await withFixture(kind, async (runner, { tenantId, ids }, svc) => {
    const opts = { manager: runner.manager };
    const a = await seedAnalytics(runner, tenantId, kind, ids);
    const natureKey = `analytics_${a.nature}`;
    const defaultKey = `analytics_${a.defaultAxis}`;

    const { items } = await svc.summary({ ...ALL, limit: 100 }, opts);
    const row = (id: string) => items.find((item: any) => item.id === id);
    assert.deepEqual(
      [row(ids.alpha).analytics_category_id, row(ids.alpha).analytics_category_name, row(ids.alpha)[defaultKey], row(ids.alpha)[natureKey]],
      [a.licences, 'Licences', 'Licences', 'Subscriptions'],
      `${kind}: both dimensions on the row, the default under its legacy keys too`,
    );
    assert.deepEqual(row(ids.alpha).analytics_value_ids, { [a.defaultAxis]: a.licences, [a.nature]: a.subscriptions }, `${kind}: value ids by dimension`);
    assert.deepEqual(row(ids.bravo).analytics_value_ids, { [a.defaultAxis]: a.services, [a.nature]: a.maintenance });
    const charlie = row(ids.charlie);
    assert.deepEqual(
      [charlie.analytics_category_id, charlie.analytics_category_name, charlie[defaultKey], charlie[natureKey], charlie.analytics_value_ids],
      [null, null, null, null, {}],
      `${kind}: the stale legacy column never leaks`,
    );

    const values = await svc.summaryFilterValues({ ...ALL, fields: `${natureKey},analytics_category_name,${defaultKey}` }, opts);
    assert.deepEqual(values[natureKey], ['Maintenance', 'Subscriptions', null], `${kind}: filter values of a dimension`);
    assert.deepEqual(values.analytics_category_name, ['Licences', 'Services', null], `${kind}: the default dimension from the links`);
    assert.deepEqual(values[defaultKey], ['Licences', 'Services', null], `${kind}: the default dimension under its own key`);
    const unknown = await svc.summaryFilterValues({ ...ALL, fields: 'analytics_nature,analytics_category_id' }, opts);
    assert.deepEqual(unknown, {}, `${kind}: only a dimension id makes a filter-value key`);

    const idsOf = (page: any) => page.items.map((item: any) => item.id).sort();
    const bySet = await svc.summary({ ...ALL, filters: filters({ [natureKey]: { filterType: 'set', values: ['Maintenance', null] } }) }, opts);
    assert.deepEqual(idsOf(bySet), [ids.bravo, ids.charlie, ids.delta, ids.echo].sort(), `${kind}: set filter on a dimension, blanks included`);
    const byValue = await svc.summary({ ...ALL, filters: filters({ [natureKey]: { filterType: 'set', values: ['Subscriptions'] } }) }, opts);
    assert.deepEqual(idsOf(byValue), [ids.alpha], `${kind}: set filter on one value`);
    const idsForTotals = await svc.summaryIds({ ...ALL, filters: filters({ [natureKey]: { filterType: 'set', values: ['Subscriptions'] } }) }, opts);
    assert.deepEqual(idsForTotals.ids, [ids.alpha], `${kind}: ids follow the same filter`);

    const searched = await svc.summary({ ...ALL, q: 'maintenance' }, opts);
    assert.deepEqual(idsOf(searched), [ids.bravo], `${kind}: quick search by a second-dimension value`);

    const natureOf = (page: any) => page.items.map((item: any) => item[natureKey]);
    const ascending = await svc.summary({ ...ALL, sort: `${natureKey}:ASC` }, opts);
    assert.deepEqual(natureOf(ascending), ['Maintenance', 'Subscriptions', null, null, null], `${kind}: sort ascending on a dimension, blanks last`);
    const descending = await svc.summary({ ...ALL, sort: `${natureKey}:DESC` }, opts);
    assert.deepEqual(natureOf(descending), [null, null, null, 'Subscriptions', 'Maintenance'], `${kind}: sort descending on a dimension`);

    // The legacy column is not read: a filter on the default dimension reads the links.
    const byId = await svc.summary({ ...ALL, filters: filters({ analytics_category_id: { filterType: 'set', values: [a.licences] } }) }, opts);
    assert.deepEqual(idsOf(byId), [ids.alpha], `${kind}: filtered on the link, not on the stale column`);
    const blank = await svc.summary({ ...ALL, filters: filters({ analytics_category_id: { filterType: 'text', type: 'blank' } }) }, opts);
    assert.deepEqual(idsOf(blank), [ids.charlie, ids.delta, ids.echo].sort(), `${kind}: blank on the default dimension reads the links`);
    const byName = await svc.summary({ ...ALL, filters: filters({ analytics_category_name: { filterType: 'set', values: ['Licences'] } }) }, opts);
    assert.deepEqual(idsOf(byName), [ids.alpha], `${kind}: the default dimension by name`);
    const sortedById = await svc.summary({ ...ALL, sort: 'analytics_category_name:ASC' }, opts);
    assert.deepEqual(sortedById.items.map((item: any) => item.analytics_category_name), ['Licences', 'Services', null, null, null], `${kind}: sort on the default dimension`);
  });
}

/**
 * FTE on the fixture, as a lines write stores it on the round: Alpha's Budget
 * of Y 1.5, Bravo's 0 (pieces only), Charlie's round has no lines (unknown),
 * Echo holds lines of Y after its end of validity, Alpha's Forecast of Y+3
 * 0.75.
 */
async function seedFteRounds(runner: QueryRunner, kind: Kind, tenantId: string, ids: Fixture['ids']) {
  const [budget, , forecast] = SUMMARY_COLUMNS;
  const round = async (itemId: string, year: number, measure: string, fte: string | null) => {
    const versionId = (await findVersion(runner, kind, itemId, year))?.id ?? (await seedVersion(runner, kind, tenantId, itemId, year));
    await runner.query(
      `INSERT INTO ${TABLES[kind].rounds} (tenant_id, version_id, measure, period_start, period_end, method, fte)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, versionId, measure, `${year}-01-01`, `${year}-12-31`, fte === null ? 'spread' : 'computed', fte],
    );
    return versionId;
  };
  const alphaBudget = await round(ids.alpha, Y, budget.measure, '1.5');
  await round(ids.bravo, Y, budget.measure, '0');
  await round(ids.charlie, Y, budget.measure, null);
  const echo = await round(ids.echo, Y, budget.measure, '1');
  await seedMonths(runner, kind, tenantId, echo, Y, { [budget.measure]: repeat('100', 12) });
  await round(ids.alpha, Y + 3, forecast.measure, '0.75');
  return { alphaBudget, budget };
}

async function testFteFields(kind: Kind) {
  await withFixture(kind, async (runner, { tenantId, ids }, svc) => {
    const opts = { manager: runner.manager };
    const { alphaBudget, budget } = await seedFteRounds(runner, kind, tenantId, ids);
    const byId = async (field: string, query: Record<string, unknown> = {}) => {
      const { items } = await svc.summary({ ...ALL, limit: 100, ...query }, opts);
      return Object.fromEntries(items.map((row: any) => [row.id, row[field]]));
    };

    assert.deepEqual(
      await byId('fte_yBudget'),
      { [ids.alpha]: 1.5, [ids.bravo]: 0, [ids.charlie]: null, [ids.delta]: null, [ids.echo]: null },
      `${kind}: the stored FTE (0 included); no lines, no version and after the end of validity unknown`,
    );
    const { items } = await svc.summary({ ...ALL, years: String(Y + 3), limit: 100 }, opts);
    const alpha = items.find((row: any) => row.id === ids.alpha);
    const expectedKeys = [...FIXED_SLOTS.map((s) => s.key as string), `y${Y + 3}`].flatMap((slot) => SUMMARY_COLUMNS.map((c) => `fte_${slot}${c.suffix}`));
    assert.deepEqual(expectedKeys.filter((key) => !(key in alpha)), [], `${kind}: every fixed slot and column, the requested year too`);
    assert.deepEqual(
      [alpha[`fte_y${Y + 3}Forecast`], alpha.fte_yForecast, alpha.fte_yRevision],
      [0.75, null, null],
      `${kind}: a later year as stored; a column without a round is unknown`,
    );

    // A month set to zero afterwards leaves the FTE the lines gave.
    await runner.query(
      `UPDATE ${TABLES[kind].amounts} SET ${budget.measure} = 0 WHERE tenant_id = $1 AND version_id = $2 AND period = $3`,
      [tenantId, alphaBudget, period(4, Y)],
    );
    assert.equal((await byId('fte_yBudget'))[ids.alpha], 1.5, `${kind}: the months do not move the FTE`);

    const idsOf = (page: any) => page.items.map((row: any) => row.id).sort();
    const filtered = async (model: Record<string, unknown>) => idsOf(await svc.summary({ ...ALL, filters: filters({ fte_yBudget: model }) }, opts));
    assert.deepEqual(await filtered({ filterType: 'number', type: 'greaterThan', filter: 0 }), [ids.alpha], `${kind}: number filter`);
    assert.deepEqual(await filtered({ filterType: 'number', type: 'equals', filter: 0 }), [ids.bravo], `${kind}: unknown is not 0`);
    assert.deepEqual(await filtered({ filterType: 'number', type: 'lessThan', filter: 5 }), [ids.alpha, ids.bravo].sort(), `${kind}: unknown fails every comparison`);
    assert.deepEqual(await filtered({ filterType: 'number', type: 'blank' }), [ids.charlie, ids.delta, ids.echo].sort(), `${kind}: blank is unknown`);
    assert.deepEqual(await filtered({ filterType: 'number', type: 'notBlank' }), [ids.alpha, ids.bravo].sort());

    const ascending = await svc.summary({ ...ALL, sort: 'fte_yBudget:ASC' }, opts);
    assert.deepEqual(ascending.items.map((row: any) => row.fte_yBudget), [0, 1.5, null, null, null], `${kind}: sort ascending, unknown last`);
    // A sort key naming a year outside the fixed window loads that year.
    const later = await svc.summary({ ...ALL, sort: `fte_y${Y + 3}Forecast:ASC` }, opts);
    assert.deepEqual([later.items[0].id, later.items[0][`fte_y${Y + 3}Forecast`]], [ids.alpha, 0.75], `${kind}: sort on a year outside the window`);
    const navigation = await svc.summaryIds({ ...ALL, sort: 'fte_yBudget:DESC', filters: filters({ fte_yBudget: { filterType: 'number', type: 'greaterThanOrEqual', filter: 0 } }) }, opts);
    assert.deepEqual(navigation.ids, [ids.alpha, ids.bravo], `${kind}: ids follow the FTE sort and filter`);

    const totals = await svc.summaryTotals({ ...ALL, fte: `fte_yBudget,fte_yRevision,fte_y${Y + 3}Forecast,yBudget,fte_nothing` }, opts);
    assert.deepEqual(
      totals.fte,
      {
        fte_yBudget: { total: 1.5, unknown: 3 },
        fte_yRevision: { total: null, unknown: 5 },
        [`fte_y${Y + 3}Forecast`]: { total: 0.75, unknown: 4 },
      },
      `${kind}: FTE totals and unknown counts (no line with an FTE: null, never 0), other keys ignored`,
    );
    assert.equal(totals.yBudget, 1700.3, `${kind}: amounts unchanged alongside (Alpha 1 100, Bravo 600, Charlie 0.30)`);
    const plain = await svc.summaryTotals(ALL, opts);
    assert.equal('fte' in plain, false, `${kind}: no FTE without fte=`);
  });
}

async function testRegistriesExposeEveryAmount() {
  const previous: Record<Kind, Record<string, string>> = {
    opex: {
      y_budget: 'yBudget', y_review: 'yRevision', y_actual: 'yFollowUp', y_landing: 'yLanding',
      y_minus2_budget: 'yMinus2Budget', y_minus1_budget: 'yMinus1Budget', y_plus1_budget: 'yPlus1Budget', y_plus2_budget: 'yPlus2Budget',
    },
    capex: { y_budget: 'yBudget', y_actual: 'yFollowUp', y_landing: 'yLanding', y_plus1_budget: 'yPlus1Budget', y_minus1_landing: 'yMinus1Landing' },
  };
  for (const kind of KINDS) {
    const registry = getAiEntityRegistry(kind === 'opex' ? 'spend_items' : 'capex_items');
    const numberKeys = Object.values(registry.fields).filter((field) => field.type === 'number').map((field) => field.ai);
    const amountKeys = numberKeys.filter((key) => !key.endsWith('_fte'));
    assert.equal(amountKeys.length, 25, `${kind}: 25 amount fields`);
    assert.equal(numberKeys.length - amountKeys.length, 25, `${kind}: and 25 FTE fields`);
    for (const slot of FIXED_SLOTS) {
      for (const column of SUMMARY_COLUMNS) {
        const key = `${slot.ai}_${column.ai}`;
        assert.equal(registry.fields[key]?.grid, `${slot.key}${column.suffix}`, `${kind}: ${key}`);
        assert.equal(registry.fields[key]?.aggregable, true);
        assert.equal(registry.sortFields[key], `${slot.key}${column.suffix}`);
      }
    }
    for (const [key, grid] of Object.entries(previous[kind])) {
      assert.equal(registry.fields[key]?.grid, grid, `${kind}: ${key} keeps its meaning`);
    }
  }
  const capex = getAiEntityRegistry('capex_items');
  for (const key of ['supplier', 'account', 'owner_it', 'owner_business', 'analytics_category', 'allocation_method', 'contract', 'project_name', 'project_stream', 'project_category']) {
    assert.ok(capex.fields[key], `capex: ${key}`);
  }
}

/** All lines of the list (`all=true`, a search dropped) are every line, ended ones included, in the budget file. */
async function testCapexBudgetFileHasEveryLine() {
  await withFixture('capex', async (runner, fixture) => {
    const listed = await budgetList.budgetListIds(SUMMARY_SCOPES.capex, engineDeps, exportListQuery({ q: 'no-such-line' }, true), runner.manager);
    const content = await exportBudgetFile(runner.manager, 'capex', fixture.tenantId, listed.ids, { amountYears: String(Y) });
    const rows = fileRows(content);
    assert.deepEqual(rows.map((row) => row.name).sort(), ['Alpha line', 'Bravo line', 'Charlie line', 'Delta ended', 'Echo ended'], 'export: every line, ended ones included');
    const alpha = rows.find((row) => row.name === 'Alpha line')!;
    assert.equal(alpha[`budget_${Y}`], '1200.00');
  });
}

void runSpecs('budget-summary.integration.spec', [
  ...KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
    [`five columns every slot (${kind})`, () => testFiveColumnsEverySlot(kind)],
    [`sort on any year and column (${kind})`, () => testSortOnAnyYearAndColumn(kind)],
    [`number filter on amounts (${kind})`, () => testNumberFilterOnAmounts(kind)],
    [`date and Ref filters (${kind})`, () => testDateAndRefFilters(kind)],
    [`quick search and filter values (${kind})`, () => testQuickSearchAndFilterValues(kind)],
    [`task filter keeps totals and ids aligned (${kind})`, () => testTaskFilterKeepsTotalsAndIdsAligned(kind)],
    [`lifecycle window (${kind})`, () => testLifecycleWindow(kind)],
    [`explicit status wins over all (${kind})`, () => testExplicitStatusWinsOverAll(kind)],
    [`money is exact (${kind})`, () => testMoneyIsExact(kind)],
    [`engine reads every line (${kind})`, () => testEngineReadsEveryLine(kind)],
    [`blank on any column runs in SQL (${kind})`, () => testBlankOnAnyColumnRunsInSql(kind)],
    [`status sorts the same everywhere (${kind})`, () => testStatusSortsTheSameEverywhere(kind)],
    [`text filter on a date (${kind})`, () => testTextFilterOnADate(kind)],
    [`several linked projects (${kind})`, () => testSeveralLinkedProjects(kind)],
    [`AI aggregate sums in cents (${kind})`, () => testAiAggregateSumsInCents(kind)],
    [`aggregate: top N, others, variance, window (${kind})`, () => testAggregate(kind)],
    [`cost center and run or build (${kind})`, () => testCostCenterFields(kind)],
    [`budget holder from the cost center (${kind})`, () => testBudgetHolder(kind)],
    [`analytics dimensions (${kind})`, () => testAnalyticsDimensions(kind)],
    [`FTE fields and totals (${kind})`, () => testFteFields(kind)],
  ]),
  ['CAPEX enums sort in business order', testCapexEnumsSortInBusinessOrder],
  ['AI: a partial list is truncated', testAiMarksAPartialListTruncated],
  ['AI: CAPEX amount filter', testAiCapexAmountFilter],
  ['AI: CAPEX detail', testAiCapexDetail],
  ['AI: CAPEX aggregate is complete', testAiCapexAggregateIsComplete],
  ['AI: registries expose every amount', testRegistriesExposeEveryAmount],
  ['CAPEX budget file has every line', testCapexBudgetFileHasEveryLine],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
