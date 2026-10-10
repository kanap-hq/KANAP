import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { backendPid, closeRunner, committed, openTenantTransaction, waitUntilBlocked } from '../../cost-centers/__tests__/cost-center-test-helpers';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { lookupAnalyticsValues } from '../../common/lookup/reference-lookups';
import { budgetListFilterValues } from '../../spend/budget-list/budget-list.service';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import { realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import { ANALYTICS_VALUE_ORDER_SQL, analyticsFieldKey } from '../analytics-axes.util';
import { AnalyticsCategoriesController } from '../analytics-categories.controller';
import { AnalyticsCategoryCreateDto, AnalyticsCategoryReorderDto, AnalyticsCategoryUpdateDto } from '../dto/analytics.dto';
import {
  context,
  csvFile,
  expectRefused,
  linkValue,
  runSpecs,
  seedLine,
  seedTenant,
  services,
  setCurrentTenant,
  withRollback,
} from './analytics-test-helpers';

// The manual order of a dimension's values (lot D3) against a real database, in
// transactions rolled back at the end:
// - a new value goes last in its dimension (create, CSV import in file order);
//   the list, its ids and the CSV export follow the order by default;
// - the reorder: the listed values first, the others after them in their order,
//   renumbered 1..n; refused for another tenant's value, another dimension's
//   value, a duplicate, an unknown dimension; one audit row on the dimension,
//   none when nothing moves; the values keep their `updated_at`;
// - a reorder and a create in the same dimension wait for each other: whichever
//   runs second sees the first (the created value is numbered, or goes last);
//   a values CSV import (a new value, then an edit) and a reorder of the same
//   dimension, in both orders, end without a deadlock; an open reorder never
//   blocks a line linking one of the dimension's values;
// - without a dimension filter, sorting by position keeps the dimensions in
//   their order (never interleaved), descending the exact reverse;
// - `sort_order` is never written by POST or PATCH (DTO whitelist and service);
// - the route: POST /analytics-categories/reorder, the permission of PATCH :id,
//   declared before the `:id` routes;
// - the picker lookup in dimension order, a typed text keeping its rank first;
// - the OPEX and CAPEX list filter values of an analytics column in dimension
//   order, null last;
// - equal positions read by name in ICU order, accents included ("Énergie"
//   before "Matériel", "Sécurité" before "Services"), whatever the database's
//   own collation: list, ids, lookup, filter values and a reorder's renumbering.
// @database-spec (the data source opens in analytics-test-helpers).

const names = (result: { items: Array<{ name: string }> }) => result.items.map((item) => item.name);

async function positions(runner: QueryRunner, tenantId: string, axisId: string): Promise<string[]> {
  const rows: Array<{ name: string; sort_order: number }> = await runner.query(
    `SELECT c.name, c.sort_order FROM analytics_categories c WHERE c.tenant_id = $1 AND c.axis_id = $2 ORDER BY ${ANALYTICS_VALUE_ORDER_SQL}`,
    [tenantId, axisId],
  );
  return rows.map((row) => `${row.sort_order} ${row.name}`);
}

/** A tenant with a "Menu" dimension holding `values`, created in that order through the service. */
async function seedMenu(runner: QueryRunner, tag: string, values: string[]) {
  const tenantId = await seedTenant(runner, tag);
  const svc = services(runner.manager);
  const ctx = context(runner.manager, tenantId);
  const menu = await svc.axes.create({ code: 'menu', name: 'Menu' }, ctx);
  const ids: Record<string, string> = {};
  for (const name of values) ids[name] = (await svc.values.create({ axis_id: menu.id, name }, null, ctx)).id;
  return { tenantId, svc, ctx, axisId: menu.id as string, ids };
}

async function testCreateAppendsLastAndListFollows() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx, axisId, ids } = await seedMenu(runner, 'order-create', ['Zakouski', 'Apéritif', 'Mains']);
    assert.deepEqual(await positions(runner, tenantId, axisId), ['1 Zakouski', '2 Apéritif', '3 Mains'], 'each new value goes last');
    const detail = await svc.values.get(ids.Mains, ctx);
    assert.equal(detail.sort_order, 3, 'the detail carries the position');

    const listed = await svc.values.list({ axis_id: axisId }, ctx);
    assert.deepEqual(names(listed), ['Zakouski', 'Apéritif', 'Mains'], 'the list defaults to the dimension order');
    assert.deepEqual((listed.items as any[]).map((item) => item.sort_order), [1, 2, 3], 'list items carry sort_order');
    assert.deepEqual(names(await svc.values.list({ axis_id: axisId, sort: 'sort_order:DESC' }, ctx)), ['Mains', 'Apéritif', 'Zakouski']);
    assert.deepEqual(names(await svc.values.list({ axis_id: axisId, sort: 'name:ASC' }, ctx)), ['Apéritif', 'Mains', 'Zakouski']);
    assert.deepEqual(names(await svc.values.list({ axis_id: axisId, limit: 2, page: 2 }, ctx)), ['Mains'], 'pages follow the order');
    assert.deepEqual((await svc.values.listIds({ axis_id: axisId }, ctx)).ids, [ids.Zakouski, ids['Apéritif'], ids.Mains], 'prev/next follows');

    // Equal positions (rows inserted raw) read by name, then id.
    await runner.query(`UPDATE analytics_categories SET sort_order = 0 WHERE tenant_id = $1 AND axis_id = $2`, [tenantId, axisId]);
    assert.deepEqual(names(await svc.values.list({ axis_id: axisId }, ctx)), ['Apéritif', 'Mains', 'Zakouski'], 'ties read by name');
    const created = await svc.values.create({ axis_id: axisId, name: 'Dessert' }, null, ctx);
    assert.equal(created.sort_order, 1, 'max + 1 over a dimension of zeros');
  });
}

async function testReorder() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx, axisId, ids } = await seedMenu(runner, 'order-reorder', ['Low', 'Medium', 'High', 'Mandatory']);
    const other = await svc.axes.create({ code: 'other', name: 'Other' }, ctx);
    const elsewhere = await svc.values.create({ axis_id: other.id, name: 'Elsewhere' }, null, ctx);
    const stamps = async () => (await runner.query(
      `SELECT id, updated_at FROM analytics_categories WHERE tenant_id = $1 ORDER BY id`,
      [tenantId],
    )).map((row: { id: string; updated_at: Date }) => `${row.id} ${row.updated_at.toISOString()}`);
    const auditRows = async (table: string) => runner.query(
      `SELECT table_name, record_id, action, before_json, after_json FROM audit_log
        WHERE tenant_id = $1 AND table_name = $2 AND action = 'update'`,
      [tenantId, table],
    );
    // A past stamp: within this transaction now() is the stamp the values were created with.
    await runner.query(`UPDATE analytics_categories SET updated_at = '2020-01-01T00:00:00Z' WHERE tenant_id = $1`, [tenantId]);
    const updatedBefore = await stamps();

    // A partial list: the listed values first, the others after them in their order.
    const result = await svc.values.reorder(axisId, [ids.Mandatory, ids.High], null, ctx);
    assert.deepEqual(result.items.map((item) => item.name), ['Mandatory', 'High', 'Low', 'Medium'], 'returns the values in the new order');
    assert.deepEqual(result.items.map((item) => item.sort_order), [1, 2, 3, 4], 'renumbered 1..n');
    assert.deepEqual(await positions(runner, tenantId, axisId), ['1 Mandatory', '2 High', '3 Low', '4 Medium']);
    assert.deepEqual(await positions(runner, tenantId, other.id), ['1 Elsewhere'], 'another dimension is untouched');
    assert.deepEqual(await stamps(), updatedBefore, 'the values keep their updated_at');

    const audit = await auditRows('analytics_axes');
    assert.equal(audit.length, 1, 'one audit row for the reorder');
    assert.deepEqual(await auditRows('analytics_categories'), [], 'none per value');
    const row = audit[0];
    assert.deepEqual(
      [row.table_name, row.record_id, row.action, row.before_json, row.after_json],
      ['analytics_axes', axisId, 'update', ['Low', 'Medium', 'High', 'Mandatory'], ['Mandatory', 'High', 'Low', 'Medium']],
      'on the dimension, the ordered names before and after',
    );

    // The full list in the same order moves nothing: no audit row.
    await svc.values.reorder(axisId, [ids.Mandatory, ids.High, ids.Low, ids.Medium], null, ctx);
    assert.equal((await auditRows('analytics_axes')).length, 1, 'nothing moved, nothing audited');
    // An empty list keeps the order and renumbers densely.
    await runner.query(`UPDATE analytics_categories SET sort_order = sort_order * 10 WHERE tenant_id = $1 AND axis_id = $2`, [tenantId, axisId]);
    await svc.values.reorder(axisId, [], null, ctx);
    assert.deepEqual(await positions(runner, tenantId, axisId), ['1 Mandatory', '2 High', '3 Low', '4 Medium'], 'dense again');
    // A value created after a reorder goes last.
    await svc.values.create({ axis_id: axisId, name: 'Optional' }, null, ctx);
    assert.deepEqual((await positions(runner, tenantId, axisId)).slice(-1), ['5 Optional']);

    // Refusals: another dimension's value, another tenant's value, a duplicate, an unknown dimension.
    const otherTenant = await seedTenant(runner, 'order-reorder-foreign');
    const foreignAxis = await services(runner.manager).axes.create({ code: 'menu', name: 'Menu' }, context(runner.manager, otherTenant));
    const foreign = await services(runner.manager).values.create({ axis_id: foreignAxis.id, name: 'Foreign' }, null, context(runner.manager, otherTenant));
    await setCurrentTenant(runner, tenantId);
    const refused = 'Only values of the Menu dimension can be ordered in it.';
    await expectRefused(runner, new RegExp(refused), () => svc.values.reorder(axisId, [ids.Low, elsewhere.id], null, ctx));
    await expectRefused(runner, new RegExp(refused), () => svc.values.reorder(axisId, [foreign.id], null, ctx));
    await expectRefused(runner, new RegExp(refused), () => svc.values.reorder(axisId, ['not-a-uuid'], null, ctx));
    await expectRefused(runner, /Each value can appear only once/, () => svc.values.reorder(axisId, [ids.Low, ids.High, ids.Low], null, ctx));
    await expectRefused(runner, /Dimension not found/, () => svc.values.reorder(foreignAxis.id, [], null, ctx));
    await expectRefused(runner, /Dimension not found/, () => svc.values.reorder(randomUUID(), [], null, ctx));
    await expectRefused(runner, /The values must be a list/, () => svc.values.reorder(axisId, ids.Low, null, ctx));
    const status = await svc.values.reorder(axisId, [foreign.id], null, ctx).then(
      () => assert.fail('a foreign value must be refused'),
      (error: any) => [error?.getStatus?.(), error?.getResponse?.().field],
    );
    assert.deepEqual(status, [400, 'value_ids'], 'a refusal is a 400 on value_ids');
    assert.deepEqual(await positions(runner, tenantId, axisId), ['1 Mandatory', '2 High', '3 Low', '4 Medium', '5 Optional'], 'a refusal changes nothing');
  });
}

async function testSortOrderNotWritable() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx, axisId, ids } = await seedMenu(runner, 'order-readonly', ['Low', 'High']);
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const update = await pipe.transform({ name: 'Lower', sort_order: 9 }, { type: 'body', metatype: AnalyticsCategoryUpdateDto });
    assert.equal('sort_order' in update, false, 'PATCH: the whitelist drops sort_order');
    const create = await pipe.transform({ name: 'New', sort_order: 9 }, { type: 'body', metatype: AnalyticsCategoryCreateDto });
    assert.equal('sort_order' in create, false, 'POST: the whitelist drops sort_order');
    const reorder = await pipe.transform({ axis_id: axisId, value_ids: [ids.High], extra: 1 }, { type: 'body', metatype: AnalyticsCategoryReorderDto });
    assert.deepEqual(reorder, Object.assign(new AnalyticsCategoryReorderDto(), { axis_id: axisId, value_ids: [ids.High] }));

    // The service ignores it too, should a caller pass it (the AI passes plain objects).
    await svc.values.update(ids.Low, { name: 'Lower', sort_order: 9 } as any, null, ctx);
    const created = await svc.values.create({ axis_id: axisId, name: 'Mid', sort_order: 9 } as any, null, ctx);
    assert.equal(created.sort_order, 3);
    assert.deepEqual(await positions(runner, tenantId, axisId), ['1 Lower', '2 High', '3 Mid']);
  });
}

function testReorderRoute() {
  const proto = AnalyticsCategoriesController.prototype as any;
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.reorder), 'reorder');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, proto.reorder), RequestMethod.POST);
  assert.deepEqual(
    Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.reorder),
    Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.update),
    'the permission of PATCH :id',
  );
  const order = Object.getOwnPropertyNames(proto);
  const paramRoutes = order.filter((name) => String(Reflect.getMetadata(PATH_METADATA, proto[name]) ?? '').startsWith(':'));
  for (const name of paramRoutes) {
    assert.ok(order.indexOf('reorder') < order.indexOf(name), `reorder is declared before ${name}`);
  }
}

async function testCsvOrder() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx, axisId, ids } = await seedMenu(runner, 'order-csv', ['Low', 'High']);
    const imported = await svc.csv.importCsv({
      file: csvFile(['axis_code;name;description', 'menu;Zakouski;', 'menu;high;Existing', 'menu;Apéritif;'].join('\n')),
      dryRun: false,
    }, ctx);
    assert.deepEqual([imported.ok, imported.inserted, imported.updated], [true, 2, 1], JSON.stringify(imported.errors));
    assert.deepEqual(
      await positions(runner, tenantId, axisId),
      ['1 Low', '2 High', '3 Zakouski', '4 Apéritif'],
      'new values last, in file order; an existing value keeps its position',
    );

    await svc.values.reorder(axisId, [ids.High], null, ctx);
    const exported = await svc.csv.exportCsv('data', ctx);
    const menuLines = exported.content.replace('﻿', '').trim().split('\n').filter((line) => line.startsWith('menu,'));
    assert.deepEqual(menuLines.map((line) => line.split(',')[1]), ['High', 'Low', 'Zakouski', 'Apéritif'], 'the export follows the order');
  });
}

async function testLookupOrder() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx, axisId, ids } = await seedMenu(runner, 'order-lookup', ['Low', 'Low medium', 'Mandatory', 'High', 'Medium']);
    await svc.values.reorder(axisId, [ids.Medium, ids.Mandatory, ids.High, ids['Low medium'], ids.Low], null, ctx);
    const call = { manager: runner.manager, tenantId };
    const lookup = async (query: Record<string, unknown>) => (await lookupAnalyticsValues(call, { axis_id: axisId, ...query })).items as any[];
    const all = await lookup({});
    assert.deepEqual(all.map((row) => row.name), ['Medium', 'Mandatory', 'High', 'Low medium', 'Low'], 'no text: the dimension order');
    assert.deepEqual(all.map((row) => row.sort_order), [1, 2, 3, 4, 5], 'lookup rows carry sort_order');
    assert.deepEqual(
      (await lookup({ q: 'm' })).map((row) => row.name),
      ['Medium', 'Mandatory', 'Low medium'],
      'a typed text: names starting with it first, each rank in the dimension order',
    );
    const hydrated = await lookupAnalyticsValues(call, { ids: [ids.Low, ids.Medium].join(',') });
    assert.deepEqual(hydrated.items.map((row: any) => row.name), ['Medium', 'Low'], 'hydration in the order too');
  });
}

async function testBudgetListFilterValues() {
  for (const kind of ['opex', 'capex'] as const) {
    await withRollback(async (runner) => {
      const { tenantId, svc, ctx, axisId, ids } = await seedMenu(runner, `order-list-${kind}`, ['Low', 'Medium', 'High', 'Unused']);
      await svc.values.reorder(axisId, [ids.High, ids.Unused, ids.Medium, ids.Low], null, ctx);
      for (const name of ['Low', 'High', 'Medium']) {
        await linkValue(runner, kind, tenantId, await seedLine(runner, kind, tenantId), axisId, ids[name]);
      }
      await seedLine(runner, kind, tenantId);
      const scope = SUMMARY_SCOPES[kind];
      const field = analyticsFieldKey(axisId);
      const values = await budgetListFilterValues(scope, realSummaryDeps(scope), { fields: `${field},currency`, includeDisabled: 'true' }, runner.manager);
      assert.deepEqual(values[field], ['High', 'Medium', 'Low', null], `${kind}: the dimension order, null last`);
      assert.deepEqual(values.currency, ['EUR'], `${kind}: other fields as before`);
    });
  }
}

async function testAccentedTiesInIcuOrder() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx, axisId } = await seedMenu(runner, 'order-accents', []);
    const expected = ['Énergie', 'Matériel', 'Sécurité', 'Services', 'Zinc'];
    const ids: Record<string, string> = {};
    for (const name of ['Zinc', 'Services', 'Matériel', 'Sécurité', 'Énergie']) {
      const [row] = await runner.query(
        `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, axisId, name],
      );
      ids[name] = row.id;
    }
    assert.deepEqual(names(await svc.values.list({ axis_id: axisId }, ctx)), expected, 'list: equal positions in ICU order');
    assert.deepEqual(
      names(await svc.values.list({ axis_id: axisId, sort: 'sort_order:DESC' }, ctx)),
      [...expected].reverse(),
      'descending is the exact reverse',
    );
    assert.deepEqual((await svc.values.listIds({ axis_id: axisId }, ctx)).ids, expected.map((name) => ids[name]), 'ids');
    const looked = await lookupAnalyticsValues({ manager: runner.manager, tenantId }, { axis_id: axisId });
    assert.deepEqual(looked.items.map((row: any) => row.name), expected, 'lookup');

    for (const name of expected) await linkValue(runner, 'opex', tenantId, await seedLine(runner, 'opex', tenantId), axisId, ids[name]);
    const scope = SUMMARY_SCOPES.opex;
    const field = analyticsFieldKey(axisId);
    const values = await budgetListFilterValues(scope, realSummaryDeps(scope), { fields: field, includeDisabled: 'true' }, runner.manager);
    assert.deepEqual(values[field], expected, 'filter values');

    await svc.values.reorder(axisId, [], null, ctx);
    assert.deepEqual(await positions(runner, tenantId, axisId), expected.map((name, index) => `${index + 1} ${name}`), 'a reorder numbers them in that order');
  });
}

async function testOrderAcrossDimensions() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'order-across');
    const svc = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const second = await svc.axes.create({ code: 'second', name: 'Second', sort_order: 2 }, ctx);
    const first = await svc.axes.create({ code: 'first', name: 'First', sort_order: 1 }, ctx);
    for (const name of ['Aardvark', 'Bee']) await svc.values.create({ axis_id: second.id, name }, null, ctx);
    const ids: Record<string, string> = {};
    for (const name of ['Yak', 'Zebra']) ids[name] = (await svc.values.create({ axis_id: first.id, name }, null, ctx)).id;
    const expected = ['Yak', 'Zebra', 'Aardvark', 'Bee'];
    assert.deepEqual(names(await svc.values.list({}, ctx)), expected, 'the dimensions in their order, then each one\'s values');
    assert.deepEqual(names(await svc.values.list({ sort: 'sort_order:DESC' }, ctx)), [...expected].reverse(), 'descending is the exact reverse');
    assert.deepEqual(names(await svc.values.list({ limit: 3 }, ctx)), expected.slice(0, 3), 'a page keeps it');
    const listed = (await svc.values.listIds({}, ctx)).ids;
    assert.deepEqual(listed.slice(0, 2), [ids.Yak, ids.Zebra], 'prev/next follows');
    assert.equal(listed.length, 4);
  });
}

/** Removes a committed race tenant: lines and values before dimensions. */
async function deleteRaceTenant(tenantId: string) {
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (const table of ['spend_item_analytics_values', 'spend_items', 'analytics_categories', 'analytics_axes', 'audit_log']) {
      await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

/**
 * Two connections on one dimension holding Low, High. A create holds the dimension FOR SHARE, a
 * reorder takes it FOR NO KEY UPDATE after locking the values: the second waits for the first to
 * commit, then numbers or places the new value after it.
 */
async function testReorderAndCreateRace() {
  for (const first of ['create', 'reorder'] as const) {
    const seed = await committed(async (runner) => {
      const { tenantId, axisId, ids } = await seedMenu(runner, `order-race-${first}`, ['Low', 'High']);
      return { tenantId, axisId, ids };
    });
    const leader = await openTenantTransaction(seed.tenantId);
    const follower = await openTenantTransaction(seed.tenantId);
    try {
      const create = (runner: QueryRunner) =>
        services(runner.manager).values.create({ axis_id: seed.axisId, name: 'Medium' }, null, context(runner.manager, seed.tenantId));
      const reorder = (runner: QueryRunner) =>
        services(runner.manager).values.reorder(seed.axisId, [seed.ids.High], null, context(runner.manager, seed.tenantId));
      if (first === 'create') await create(leader);
      else await reorder(leader);
      const pid = await backendPid(follower);
      const second = (first === 'create' ? reorder(follower) : create(follower)).then((result) => result, (err: any) => err);
      await waitUntilBlocked(pid);
      await leader.commitTransaction();
      const outcome = await second;
      assert.ok(!(outcome instanceof Error), `${first} first: the second write succeeds (${outcome?.message})`);
      await follower.commitTransaction();
      const order = await committed(async (runner) => {
        await setCurrentTenant(runner, seed.tenantId);
        return positions(runner, seed.tenantId, seed.axisId);
      });
      assert.deepEqual(order, ['1 High', '2 Low', '3 Medium'], `${first} first: every value numbered once, in order`);
    } finally {
      await closeRunner(follower);
      await closeRunner(leader);
      await deleteRaceTenant(seed.tenantId);
    }
  }
}

/**
 * A line write takes FOR KEY SHARE on the value it links; the reorder locks the values FOR NO KEY
 * UPDATE, which does not conflict: a line links a value of the dimension while a reorder of that
 * dimension is still open (within a short lock timeout, so a block fails instead of hanging).
 */
async function testReorderDoesNotBlockLines() {
  const seed = await committed(async (runner) => {
    const { tenantId, axisId, ids } = await seedMenu(runner, 'order-lines', ['Low', 'High']);
    const lineId = await seedLine(runner, 'opex', tenantId);
    return { tenantId, axisId, ids, lineId };
  });
  const leader = await openTenantTransaction(seed.tenantId);
  const follower = await openTenantTransaction(seed.tenantId);
  try {
    await services(leader.manager).values.reorder(seed.axisId, [seed.ids.High], null, context(leader.manager, seed.tenantId));
    await follower.query(`SET LOCAL lock_timeout = '3s'`);
    await linkValue(follower, 'opex', seed.tenantId, seed.lineId, seed.axisId, seed.ids.High);
    const [{ n }] = await follower.query(
      `SELECT count(*)::int AS n FROM spend_item_analytics_values WHERE tenant_id = $1 AND item_id = $2`,
      [seed.tenantId, seed.lineId],
    );
    assert.equal(n, 1, 'the line holds the value while the reorder is open');
    await follower.commitTransaction();
    await leader.commitTransaction();
  } finally {
    await closeRunner(follower);
    await closeRunner(leader);
    await deleteRaceTenant(seed.tenantId);
  }
}

/**
 * A values CSV import (a new value, then an edit of an existing one) against a reorder of the same
 * dimension, in both orders. The import locks the existing values it writes before its first write
 * (and so before `persist` takes the dimension), the reorder locks the values before the dimension:
 * the second waits for the first, never a deadlock.
 */
async function testCsvImportAndReorderRace() {
  for (const first of ['import', 'reorder'] as const) {
    const seed = await committed(async (runner) => {
      const { tenantId, axisId, ids } = await seedMenu(runner, `order-csv-race-${first}`, ['Low', 'High']);
      return { tenantId, axisId, ids };
    });
    const leader = await openTenantTransaction(seed.tenantId);
    const follower = await openTenantTransaction(seed.tenantId);
    try {
      const importFile = (runner: QueryRunner) => services(runner.manager).csv.importCsv({
        file: csvFile(['axis_code;name;description', 'menu;Medium;', 'menu;High;Changed'].join('\n')),
        dryRun: false,
      }, context(runner.manager, seed.tenantId));
      const reorder = (runner: QueryRunner) =>
        services(runner.manager).values.reorder(seed.axisId, [seed.ids.High], null, context(runner.manager, seed.tenantId));
      const led: any = first === 'import' ? await importFile(leader) : await reorder(leader);
      if (first === 'import') assert.equal(led.ok, true, JSON.stringify(led.errors));
      const pid = await backendPid(follower);
      const second = (first === 'import' ? reorder(follower) : importFile(follower)).then((result: any) => result, (err: any) => err);
      await waitUntilBlocked(pid);
      await leader.commitTransaction();
      const outcome = await second;
      assert.ok(!(outcome instanceof Error), `${first} first: the second write succeeds, no deadlock (${outcome?.message})`);
      if (first === 'reorder') assert.equal(outcome.ok, true, JSON.stringify(outcome.errors));
      await follower.commitTransaction();
      const state = await committed(async (runner) => {
        await setCurrentTenant(runner, seed.tenantId);
        const [high] = await runner.query(`SELECT description FROM analytics_categories WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.ids.High]);
        return { order: await positions(runner, seed.tenantId, seed.axisId), description: high.description };
      });
      assert.deepEqual(state, { order: ['1 High', '2 Low', '3 Medium'], description: 'Changed' }, `${first} first: both writes kept`);
    } finally {
      await closeRunner(follower);
      await closeRunner(leader);
      await deleteRaceTenant(seed.tenantId);
    }
  }
}

runSpecs('analytics-value-order.integration.spec', [
  testCreateAppendsLastAndListFollows,
  testReorder,
  testSortOrderNotWritable,
  async () => testReorderRoute(),
  testCsvOrder,
  testLookupOrder,
  testBudgetListFilterValues,
  testReorderAndCreateRace,
  testAccentedTiesInIcuOrder,
  testOrderAcrossDimensions,
  testReorderDoesNotBlockLines,
  testCsvImportAndReorderRace,
]);
