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
    const args: any[] = Array.from({ length: 12 }, () => undefined);
    args[4] = noAllocations;
    args[7] = identityFx;
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
  // The registry is resolved for the tenant: a tenant without analytics dimensions.
  const context = { tenantId: 'tenant-ai', userId: null, isPlatformHost: false, surface: 'chat', authMethod: 'jwt', manager: { query: async () => [] } } as any;
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
    const config = SUMMARY_SCOPES[kind];
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

    // With a cap of 1, a filter or a sort evaluated in memory would report the cap: these run in SQL.
    const build = await budgetSummary.summary(config, engineDeps(1), { ...ALL, filters: filters({ run_build: { filterType: 'set', values: ['build'] } }) }, runner.manager);
    assert.equal(build.capped, undefined, `${kind}: the run or build filter runs in SQL`);
    assert.deepEqual(build.items.map((row: any) => row.id), [ids.bravo]);
    const blankRunBuild = await budgetSummary.summary(config, engineDeps(1), { ...ALL, filters: filters({ run_build: { filterType: 'set', values: [null] } }) }, runner.manager);
    assert.equal(blankRunBuild.capped, undefined);
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
    const inSql = await budgetSummary.summary(config, engineDeps(1), { ...ALL, sort: 'run_build:ASC' }, runner.manager);
    assert.equal(inSql.capped, undefined, `${kind}: the run or build sort runs in SQL`);
    assert.deepEqual(runBuilds(inSql), ['run', 'build', null, null, null]);
    const inMemory = await svc.summary({ ...ALL, sort: 'run_build:ASC', q: 'e' }, opts);
    assert.deepEqual(runBuilds(inMemory), ['run', 'build', null, null, null], `${kind}: the same order in memory`);
    const down = await svc.summary({ ...ALL, sort: 'run_build:DESC', q: 'e' }, opts);
    assert.deepEqual(runBuilds(down), [null, null, null, 'build', 'run'], `${kind}: run or build descending`);
    const downSql = await budgetSummary.summary(config, engineDeps(1), { ...ALL, sort: 'run_build:DESC' }, runner.manager);
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
    const config = SUMMARY_SCOPES[kind];
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

    // The legacy column left the SQL columns: a filter on the default dimension runs in memory on the links.
    const byIdCapped = await budgetSummary.summary(config, engineDeps(1), { ...ALL, filters: filters({ analytics_category_id: { filterType: 'set', values: [a.licences] } }) }, runner.manager);
    assert.equal(byIdCapped.capped, true, `${kind}: the default dimension filter runs in memory`);
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
 * Costing inputs on the fixture: Alpha's Budget of Y counts as FTE (1.5 a
 * month, whole year), Bravo's is costed per day without the flag, Charlie's
 * round has no costing inputs, Echo holds a costed round of Y after its end of
 * validity, Alpha's Forecast of Y+3 counts as FTE from February to October.
 */
async function seedFteRounds(runner: QueryRunner, kind: Kind, tenantId: string, ids: Fixture['ids']) {
  const [budget, , forecast] = SUMMARY_COLUMNS;
  const [calendar] = await runner.query(
    `INSERT INTO working_day_profiles (tenant_id, code, name, days_by_year) VALUES ($1, 'WD20', 'Twenty days', $2::jsonb) RETURNING id`,
    [tenantId, JSON.stringify({ [Y]: repeat('20', 12) })],
  );
  const round = async (
    itemId: string,
    year: number,
    measure: string,
    months: [number, number],
    recipe: { basis: string; quantity: string; fte: boolean; calendar?: string } | null,
  ) => {
    const versionId = (await findVersion(runner, kind, itemId, year))?.id ?? (await seedVersion(runner, kind, tenantId, itemId, year));
    const end = new Date(Date.UTC(year, months[1], 0)).toISOString().slice(0, 10);
    await runner.query(
      `INSERT INTO ${TABLES[kind].rounds}
         (tenant_id, version_id, measure, period_start, period_end, method, pricing_basis, quantity, unit_price, price_index_pct, working_day_profile_id, counts_as_fte)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        tenantId, versionId, measure, period(months[0], year), end, recipe ? 'computed' : 'spread',
        recipe?.basis ?? null, recipe?.quantity ?? null, recipe ? '100' : null, recipe ? '0' : null, recipe?.calendar ?? null, recipe?.fte ?? false,
      ],
    );
    return versionId;
  };
  const alphaBudget = await round(ids.alpha, Y, budget.measure, [1, 12], { basis: 'per_month', quantity: '1.5', fte: true });
  await round(ids.bravo, Y, budget.measure, [1, 12], { basis: 'per_day', quantity: '2', fte: false, calendar: calendar.id });
  await round(ids.charlie, Y, budget.measure, [1, 12], null);
  const echo = await round(ids.echo, Y, budget.measure, [1, 12], { basis: 'per_month', quantity: '1', fte: true });
  await seedMonths(runner, kind, tenantId, echo, Y, { [budget.measure]: repeat('100', 12) });
  await round(ids.alpha, Y + 3, forecast.measure, [2, 10], { basis: 'per_period', quantity: '1', fte: true });
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
      `${kind}: flagged line 1.5, unflagged costed line 0, no costing inputs, no version and after the end of validity unknown`,
    );
    const { items } = await svc.summary({ ...ALL, years: String(Y + 3), limit: 100 }, opts);
    const alpha = items.find((row: any) => row.id === ids.alpha);
    const expectedKeys = [...FIXED_SLOTS.map((s) => s.key as string), `y${Y + 3}`].flatMap((slot) => SUMMARY_COLUMNS.map((c) => `fte_${slot}${c.suffix}`));
    assert.deepEqual(expectedKeys.filter((key) => !(key in alpha)), [], `${kind}: every fixed slot and column, the requested year too`);
    assert.deepEqual(
      [alpha[`fte_y${Y + 3}Forecast`], alpha.fte_yForecast, alpha.fte_yRevision],
      [0.75, null, null],
      `${kind}: nine active months of 1 over 12; a column without a round is unknown`,
    );

    // April at zero drops from the mask: 1.5 × 11 / 12 = 1.375, shown 1.38.
    await runner.query(
      `UPDATE ${TABLES[kind].amounts} SET ${budget.measure} = 0 WHERE tenant_id = $1 AND version_id = $2 AND period = $3`,
      [tenantId, alphaBudget, period(4, Y)],
    );
    assert.equal((await byId('fte_yBudget'))[ids.alpha], 1.38, `${kind}: a zero month drops from the mask`);

    const idsOf = (page: any) => page.items.map((row: any) => row.id).sort();
    const filtered = async (model: Record<string, unknown>) => idsOf(await svc.summary({ ...ALL, filters: filters({ fte_yBudget: model }) }, opts));
    assert.deepEqual(await filtered({ filterType: 'number', type: 'greaterThan', filter: 0 }), [ids.alpha], `${kind}: number filter`);
    assert.deepEqual(await filtered({ filterType: 'number', type: 'equals', filter: 0 }), [ids.bravo], `${kind}: unknown is not 0`);
    assert.deepEqual(await filtered({ filterType: 'number', type: 'lessThan', filter: 5 }), [ids.alpha, ids.bravo].sort(), `${kind}: unknown fails every comparison`);
    assert.deepEqual(await filtered({ filterType: 'number', type: 'blank' }), [ids.charlie, ids.delta, ids.echo].sort(), `${kind}: blank is unknown`);
    assert.deepEqual(await filtered({ filterType: 'number', type: 'notBlank' }), [ids.alpha, ids.bravo].sort());

    const ascending = await svc.summary({ ...ALL, sort: 'fte_yBudget:ASC' }, opts);
    assert.deepEqual(ascending.items.map((row: any) => row.fte_yBudget), [0, 1.38, null, null, null], `${kind}: sort ascending, unknown last`);
    // A sort key naming a year outside the fixed window loads that year.
    const later = await svc.summary({ ...ALL, sort: `fte_y${Y + 3}Forecast:ASC` }, opts);
    assert.deepEqual([later.items[0].id, later.items[0][`fte_y${Y + 3}Forecast`]], [ids.alpha, 0.75], `${kind}: sort on a year outside the window`);
    const navigation = await svc.summaryIds({ ...ALL, sort: 'fte_yBudget:DESC', filters: filters({ fte_yBudget: { filterType: 'number', type: 'greaterThanOrEqual', filter: 0 } }) }, opts);
    assert.deepEqual(navigation.ids, [ids.alpha, ids.bravo], `${kind}: ids follow the FTE sort and filter`);

    const totals = await svc.summaryTotals({ ...ALL, fte: `fte_yBudget,fte_yRevision,fte_y${Y + 3}Forecast,yBudget,fte_nothing` }, opts);
    assert.deepEqual(
      totals.fte,
      {
        fte_yBudget: { total: 1.38, unknown: 3 },
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
    [`cost center and run or build (${kind})`, () => testCostCenterFields(kind)],
    [`budget holder from the cost center (${kind})`, () => testBudgetHolder(kind)],
    [`analytics dimensions (${kind})`, () => testAnalyticsDimensions(kind)],
    [`FTE fields and totals (${kind})`, () => testFteFields(kind)],
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
