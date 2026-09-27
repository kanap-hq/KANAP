import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { SpendItemsService } from '../spend-items.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { AiQueryExecutor } from '../../ai/query/ai-query.executor';
import { AiAggregateExecutor } from '../../ai/query/ai-aggregate.executor';
import { getAiEntityRegistry } from '../../ai/query/registries';
import { FIXED_SLOTS, SUMMARY_COLUMNS, SUMMARY_SCOPES } from '../spend-summary.builder';
import * as budgetSummary from '../budget-summary';
import {
  assert,
  inRolledBackTransaction,
  Kind,
  repeat,
  runSpecs,
  seedItem,
  seedMonths,
  seedTenant,
  seedVersion,
  TABLES,
} from './round-inputs.fixtures';

// The shared list engine (budget-summary.ts) against the database, with the
// same assertions for OPEX and CAPEX: five columns in every slot, sort and
// filters on any year and column, the Ref filter, quick search on contracts
// and projects, ids and totals aligned with the summary, the lifecycle
// window, exact money; then the AI query layer on CAPEX and the CAPEX export.
// runSpecs opens the data-source, so test:ci runs this file in its database lane.

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
    const args: any[] = Array.from({ length: 13 }, () => undefined);
    args[5] = noAllocations;
    args[8] = identityFx;
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

/** The engine called directly, with a cap small enough to be hit by the five fixture lines. */
function engineDeps(cap: number): any {
  return { allocationCalculator: noAllocations, fxRates: identityFx, memoryRowCap: cap };
}

async function testCapIsReported(kind: Kind) {
  await withFixture(kind, async (runner, { ids }) => {
    const config = SUMMARY_SCOPES[kind];
    const query = { ...ALL, sort: 'yBudget:DESC' };
    // The sort needs every row built: with a cap of 2, the page comes from the two newest lines.
    const capped = await budgetSummary.summary(config, engineDeps(2), query, runner.manager);
    assert.equal(capped.capped, true, `${kind}: the cap is reported`);
    assert.equal(capped.items.length, 2);
    assert.equal(capped.total, 5, `${kind}: the total is the SQL count of every line selected`);
    const whole = await budgetSummary.summary(config, engineDeps(5), query, runner.manager);
    assert.equal(whole.capped, undefined, `${kind}: a cap that is not hit is not reported`);
    assert.equal(whole.total, 5);
    const navigation = await budgetSummary.summaryIds(config, engineDeps(2), query, runner.manager);
    assert.equal(navigation.total, 5, `${kind}: the ids read every line, whatever the cap`);
    assert.deepEqual(navigation.ids.slice(0, 2), [ids.alpha, ids.bravo]);
    const totals = await budgetSummary.summaryTotals(config, engineDeps(2), query, runner.manager);
    assert.equal(totals.yBudget, 1800.3, `${kind}: the totals cover every line`);
    const values = await budgetSummary.summaryFilterValues(config, engineDeps(2), { ...ALL, fields: 'currency' }, runner.manager);
    assert.deepEqual(values.currency, ['EUR'], `${kind}: the filter values read within the cap`);
  });
}

async function testBlankOnAnyColumnRunsInSql(kind: Kind) {
  await withFixture(kind, async (runner) => {
    const config = SUMMARY_SCOPES[kind];
    // With a cap of 1, a filter evaluated in memory would report the cap: this one runs in SQL.
    const blank = await budgetSummary.summary(config, engineDeps(1), { ...ALL, filters: filters({ owner_it_id: { filterType: 'text', type: 'blank' } }) }, runner.manager);
    assert.equal(blank.capped, undefined, `${kind}: a blank filter on owner_it_id runs in SQL`);
    assert.equal(blank.total, 5);
    const notBlank = await budgetSummary.summary(config, engineDeps(1), { ...ALL, filters: filters({ owner_it_id: { filterType: 'text', type: 'notBlank' } }) }, runner.manager);
    assert.equal(notBlank.capped, undefined);
    assert.equal(notBlank.total, 0, `${kind}: no line has an IT owner`);
  });
}

async function testStatusSortsTheSameEverywhere(kind: Kind) {
  await withFixture(kind, async (runner) => {
    const statuses = (page: any) => page.items.map((row: any) => row.status);
    const expected = ['enabled', 'enabled', 'enabled', 'disabled', 'disabled'];
    // In SQL (no search): the enum order, enabled first.
    const inSql = await budgetSummary.summary(SUMMARY_SCOPES[kind], engineDeps(1), { ...ALL, sort: 'status:ASC' }, runner.manager);
    assert.equal(inSql.capped, undefined, `${kind}: the status sort runs in SQL`);
    assert.deepEqual(statuses(inSql), expected, `${kind}: status ascending, in SQL`);
    // In memory (every name contains "e"): the same order.
    const searched = await itemService(kind).summary({ ...ALL, sort: 'status:ASC', q: 'e' }, { manager: runner.manager });
    assert.deepEqual(statuses(searched), expected, `${kind}: status ascending, in memory`);
    const descending = await itemService(kind).summary({ ...ALL, sort: 'status:DESC', q: 'e' }, { manager: runner.manager });
    assert.deepEqual(statuses(descending), [...expected].reverse(), `${kind}: status descending, in memory`);
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

async function testAiMarksACappedListTruncated() {
  const capex = {
    summary: async () => ({ items: [{ id: 'capex-1', description: 'Only line', versions: {} }], total: 1, page: 1, limit: 200, capped: true }),
  };
  const context = { tenantId: 'tenant-ai', userId: null, isPlatformHost: false, surface: 'chat', authMethod: 'jwt', manager: {} } as any;
  const result: any = await queryExecutor(capex).execute(context, { entity_type: 'capex_items' });
  assert.equal(result.truncated, true, 'AI: a capped list is truncated');
  assert.equal(result.complete, false);
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
    const amountKeys = Object.values(registry.fields).filter((field) => field.type === 'number').map((field) => field.ai);
    assert.equal(amountKeys.length, 25, `${kind}: 25 amount fields`);
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

async function testCapexExportHasEveryLine() {
  await withFixture('capex', async (runner, _fixture, svc) => {
    const { content } = await svc.exportCsv('data', { manager: runner.manager });
    const [header, ...lines] = content.replace(/^﻿/, '').trim().split('\n');
    const columns = header.split(';');
    const rows = lines.map((line: string) => Object.fromEntries(line.split(';').map((value, i) => [columns[i], value])));
    assert.deepEqual(rows.map((row: any) => row.description).sort(), ['Alpha line', 'Bravo line', 'Charlie line', 'Delta ended', 'Echo ended'], 'export: every line, ended ones included');
    const alpha = rows.find((row: any) => row.description === 'Alpha line');
    assert.equal(Number(alpha.y_budget), 1200);
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
    [`cap is reported (${kind})`, () => testCapIsReported(kind)],
    [`blank on any column runs in SQL (${kind})`, () => testBlankOnAnyColumnRunsInSql(kind)],
    [`status sorts the same everywhere (${kind})`, () => testStatusSortsTheSameEverywhere(kind)],
    [`text filter on a date (${kind})`, () => testTextFilterOnADate(kind)],
    [`several linked projects (${kind})`, () => testSeveralLinkedProjects(kind)],
    [`AI aggregate sums in cents (${kind})`, () => testAiAggregateSumsInCents(kind)],
  ]),
  ['AI: a capped list is truncated', testAiMarksACappedListTruncated],
  ['AI: CAPEX amount filter', testAiCapexAmountFilter],
  ['AI: CAPEX detail', testAiCapexDetail],
  ['AI: CAPEX aggregate is complete', testAiCapexAggregateIsComplete],
  ['AI: registries expose every amount', testRegistriesExposeEveryAmount],
  ['CAPEX export has every line', testCapexExportHasEveryLine],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
