import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import * as express from 'express';
import dataSource from '../../data-source';
import { SUMMARY_COLUMNS, SUMMARY_SCOPES } from '../spend-summary.builder';
import * as engine from '../budget-list/budget-list.service';
import { realSummaryDeps } from './oracle/oracle-deps';
import { seedListFixture } from './oracle/budget-list.fixture';
import { SpendItemsController } from '../spend-items.controller';
import { CapexItemsController } from '../../capex/capex-items.controller';
import { CapexItemsService } from '../../capex/capex-items.service';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { applyListContext } from '../../common/list-context/list-context.interceptor';

// The list contract parameters of lot 2B, PR B2, on the differential fixture in
// a rolled-back transaction:
// - `amounts=` on the footer totals: only the keys asked for, each equal to
//   the default answer's; no parameter keeps today's contract (every key);
// - `shape=grid` with `fte=`: the rows carry only the FTE keys asked for, and
//   the global pipes let `shape`, `fte`, `amounts` and `ctx` through to the
//   OPEX and CAPEX summary handlers;
// - `ctx=<id>`: a saved "every supplier but one" state (about 30 KB inline)
//   gives the page, ids, totals, filter values and neighbours of the inline
//   request; explicit parameters override it;
// - CAPEX `summary/neighbors` until PR C: index, previous and next from the
//   ordered ids.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const SEED = 20261002;
const Y = new Date().getFullYear();
const scope = SUMMARY_SCOPES.opex;
const all = { includeDisabled: 'true' };

function expressRequest(url: string): any {
  const app = express();
  const req = Object.create(app.request);
  req.app = app;
  req.url = url;
  req.method = 'GET';
  return req;
}

async function testPipesLetTheParametersThrough() {
  const query = { shape: 'grid', fte: 'fte_yBudget', amounts: 'yBudget', ctx: 'A'.repeat(22), sort: 'yBudget:DESC', filters: '{}' };
  for (const [label, proto, method] of [
    ['OPEX summary', SpendItemsController.prototype, 'summary'],
    ['OPEX totals', SpendItemsController.prototype, 'summaryTotals'],
    ['OPEX neighbours', SpendItemsController.prototype, 'summaryNeighbors'],
    ['CAPEX summary', CapexItemsController.prototype, 'summary'],
    ['CAPEX totals', CapexItemsController.prototype, 'summaryTotals'],
    ['CAPEX neighbours', CapexItemsController.prototype, 'summaryNeighbors'],
  ] as const) {
    const [metatype] = Reflect.getMetadata('design:paramtypes', proto, method) as unknown[];
    let value: unknown = { ...query };
    for (const pipe of [new ValidationPipe({ whitelist: true, transform: true }), new ZodValidationPipe()]) {
      value = await pipe.transform(value, { type: 'query', metatype: metatype as any, data: undefined });
    }
    assert.deepEqual(value, query, `${label}: the global pipes keep every list parameter`);
  }
}

async function run() {
  await testPipesLetTheParametersThrough();
  console.log('ok - global pipes keep shape, fte, amounts and ctx');

  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const { tenantId } = await seedListFixture(runner, SEED);
    const m = runner.manager;
    const deps = realSummaryDeps(scope);

    // ----- amounts= -----
    const full = await engine.budgetListTotals(scope, deps, { ...all, years: String(Y + 3) }, m);
    const everyKey = [
      ...['yMinus2', 'yMinus1', 'y', 'yPlus1', 'yPlus2', `y${Y + 3}`].flatMap((slot) => SUMMARY_COLUMNS.map((c) => `${slot}${c.suffix}`)),
      'reportingCurrency',
    ];
    assert.deepEqual(Object.keys(full).sort(), everyKey.sort(), 'no amounts=: every key, as today');
    assert.ok(Object.values(full).some((v) => typeof v === 'number' && v !== 0), 'the fixture has amounts');
    const asked = ['yBudget', 'yPlus1Revision', 'yMinus1Landing', `y${Y + 3}Forecast`, `y${Y - 4}Budget`];
    const some = await engine.budgetListTotals(scope, deps, { ...all, years: String(Y + 3), amounts: [...asked, 'nonsense', 'fte_yBudget'].join(',') }, m);
    assert.deepEqual(Object.keys(some).sort(), [...asked, 'reportingCurrency'].sort(), 'amounts=: only the keys asked for (unknown keys left out)');
    for (const key of asked.slice(0, 4)) assert.equal(some[key], full[key], `${key}: same total as the default answer`);
    const older = await engine.budgetListTotals(scope, deps, { ...all, years: String(Y - 4) }, m);
    assert.equal(some[`y${Y - 4}Budget`], older[`y${Y - 4}Budget`], 'a year key outside years= is read too');
    const none = await engine.budgetListTotals(scope, deps, { ...all, amounts: '' }, m);
    assert.deepEqual(Object.keys(none), ['reportingCurrency'], 'amounts= empty: no amount');
    const withFte = await engine.budgetListTotals(scope, deps, { ...all, amounts: 'yBudget', fte: 'fte_yBudget' }, m);
    assert.equal(withFte.yBudget, full.yBudget);
    assert.ok(withFte.fte && 'fte_yBudget' in withFte.fte, 'FTE keys still answered with amounts=');
    const filtered = { ...all, filters: JSON.stringify({ currency: { filterType: 'set', values: ['USD'] } }) };
    assert.equal(
      (await engine.budgetListTotals(scope, deps, { ...filtered, amounts: 'yBudget' }, m)).yBudget,
      (await engine.budgetListTotals(scope, deps, filtered, m)).yBudget,
      'amounts= under a filter',
    );
    await assert.rejects(
      () => engine.budgetListTotals(scope, deps, { ...all, amounts: `y${Y + 11}Budget` }, m),
      (err: unknown) => err instanceof BadRequestException && /budget years/i.test((err as Error).message),
      'an amounts= year beyond Y+10 is bounded like any other',
    );
    console.log('ok - amounts= on the footer totals');

    // ----- shape=grid and fte= -----
    const fteKeysOf = (row: Record<string, unknown>) => Object.keys(row).filter((key) => key.startsWith('fte_')).sort();
    const fullPage = await engine.budgetListSummary(scope, deps, { ...all, limit: '20' }, m);
    assert.equal(fteKeysOf(fullPage.items[0] as any).length, 50, 'full shape: every FTE key of the five slots and of their y<year> twins');
    const gridNoFte = await engine.budgetListSummary(scope, deps, { ...all, limit: '20', shape: 'grid' }, m);
    assert.deepEqual(fteKeysOf(gridNoFte.items[0] as any), [], 'grid shape without fte=: no FTE key');
    const gridFte = await engine.budgetListSummary(scope, deps, { ...all, limit: '20', shape: 'grid', fte: 'fte_yBudget,fte_yPlus1Revision' }, m);
    assert.deepEqual(gridFte.items.map((r) => r.id), fullPage.items.map((r) => r.id), 'same lines in both shapes');
    for (const [i, row] of gridFte.items.entries()) {
      assert.deepEqual(fteKeysOf(row as any), ['fte_yBudget', 'fte_yPlus1Revision'], 'grid shape: the FTE keys asked for');
      assert.equal((row as any).fte_yBudget, (fullPage.items[i] as any).fte_yBudget);
      assert.equal('main_recipient' in row, false, 'grid shape: no recipient');
    }
    console.log('ok - shape=grid with fte=');

    // ----- ctx= -----
    const values = (await engine.budgetListFilterValues(scope, deps, { ...all, fields: 'supplier_name' }, m)).supplier_name;
    assert.ok(values.length > 20, `suppliers in the fixture: ${values.length}`);
    const left = values.find((v) => v != null)!;
    // A tenant with 1,200 more suppliers (no line of this list names them): the selection holds
    // their long names too, so the inline state is far past nginx's 8 KB request line.
    const unused = Array.from({ length: 1200 }, (_, i) => `Fournisseur ${i} sans ligne, Société Générale d'Équipement`);
    const allButOne = { supplier_name: { filterType: 'set', values: [...values.filter((v) => v !== left), ...unused] } };
    assert.ok(encodeURIComponent(JSON.stringify(allButOne)).length > 30_000, 'a state of more than 30 KB in a URL');
    const inline = { ...all, sort: 'supplier_name:ASC', filters: JSON.stringify(allButOne) };
    const contexts = new ListContextsService();
    const { id } = await contexts.save(m, tenantId, 'spend-items', { filters: allButOne, sort: 'supplier_name:ASC', includeDisabled: 'true' });
    const viaContext = async (path: string, extra = '') => {
      const req = expressRequest(`/spend-items/${path}?ctx=${id}${extra}`);
      await applyListContext(contexts, req, m, tenantId);
      return req.query;
    };
    const inlinePage = await engine.budgetListSummary(scope, deps, { ...inline, page: '2', limit: '10', shape: 'grid' }, m);
    const ctxPage = await engine.budgetListSummary(scope, deps, await viaContext('summary', '&page=2&limit=10&shape=grid'), m);
    assert.deepEqual(ctxPage, inlinePage, 'page through ctx = inline page');
    const inlineIds = await engine.budgetListIds(scope, deps, inline, m);
    assert.deepEqual(await engine.budgetListIds(scope, deps, await viaContext('summary/ids'), m), inlineIds, 'ids');
    assert.ok(inlineIds.total > 0 && inlineIds.total < (await engine.budgetListIds(scope, deps, all, m)).total, 'the filter selects some lines');
    assert.deepEqual(await engine.budgetListTotals(scope, deps, await viaContext('summary/totals', '&amounts=yBudget'), m), await engine.budgetListTotals(scope, deps, { ...inline, amounts: 'yBudget' }, m), 'totals');
    assert.deepEqual(
      await engine.budgetListFilterValues(scope, deps, await viaContext('summary/filter-values', '&fields=currency'), m),
      await engine.budgetListFilterValues(scope, deps, { ...inline, fields: 'currency' }, m),
      'filter values',
    );
    const middle = inlineIds.ids[Math.floor(inlineIds.ids.length / 2)];
    assert.deepEqual(
      await engine.budgetListNeighbors(scope, deps, await viaContext('summary/neighbors', `&id=${middle}`), middle, m),
      await engine.budgetListNeighbors(scope, deps, inline, middle, m),
      'neighbours',
    );
    // Explicit parameters override the context: the sort, and the filters.
    assert.deepEqual(
      await engine.budgetListIds(scope, deps, await viaContext('summary/ids', '&sort=supplier_name:DESC'), m),
      await engine.budgetListIds(scope, deps, { ...inline, sort: 'supplier_name:DESC' }, m),
      'explicit sort wins',
    );
    const ownFilters = JSON.stringify({ supplier_name: { filterType: 'set', values: [left] } });
    assert.deepEqual(
      await engine.budgetListIds(scope, deps, await viaContext('summary/ids', `&filters=${encodeURIComponent(ownFilters)}`), m),
      await engine.budgetListIds(scope, deps, { ...inline, filters: ownFilters }, m),
      'explicit filters win',
    );
    // The same lines as the exclude form of the filter (decision Q3).
    const exclude = { ...inline, filters: JSON.stringify({ supplier_name: { filterType: 'set', mode: 'exclude', values: [left] } }) };
    assert.deepEqual((await engine.budgetListIds(scope, deps, exclude, m)).ids, inlineIds.ids, 'exclude mode, one value = every other value');
    console.log(`ok - ctx= (${encodeURIComponent(JSON.stringify(allButOne)).length} URL characters of filters) gives the inline answers`);

    // ----- CAPEX neighbours (the service on the list engine since PR C, the fixture's CAPEX lines) -----
    const capex = SUMMARY_SCOPES.capex;
    const capexDeps = realSummaryDeps(capex);
    const capexService = { summaryDeps: () => capexDeps, repo: { manager: m } } as any;
    const neighbors = (id: string) => CapexItemsService.prototype.summaryNeighbors.call(capexService, all, id, { manager: m });
    const listed = await engine.budgetListIds(capex, capexDeps, all, m);
    assert.ok(listed.total > 2, 'the fixture has CAPEX lines');
    const line = (i: number) => ({ id: listed.ids[i], item_number: listed.item_numbers[i] });
    const last = listed.total - 1;
    assert.deepEqual(await neighbors(listed.ids[0]), { index: 0, total: listed.total, prev: null, next: line(1) });
    assert.deepEqual(await neighbors(listed.ids[1]), { index: 1, total: listed.total, prev: line(0), next: line(2) });
    assert.deepEqual(await neighbors(listed.ids[last]), { index: last, total: listed.total, prev: line(last - 1), next: null });
    assert.deepEqual(await neighbors('00000000-0000-4000-8000-000000000000'), { index: null, total: listed.total, prev: null, next: null });
    console.log('ok - CAPEX neighbours');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
