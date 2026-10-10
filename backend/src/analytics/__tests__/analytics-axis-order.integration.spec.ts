import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { backendPid, closeRunner, committed, openTenantTransaction, waitUntilBlocked } from '../../cost-centers/__tests__/cost-center-test-helpers';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AnalyticsAxesController } from '../analytics-axes.controller';
import { ensureDefaultAnalyticsAxis } from '../analytics-axes.util';
import { AnalyticsAxisCreateDto, AnalyticsAxisReorderDto, AnalyticsAxisUpdateDto } from '../dto/analytics.dto';
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

// The order of the dimensions (lot D4) against a real database, in transactions
// rolled back at the end:
// - the reorder: the listed dimensions first, the others after them in their
//   order, renumbered 1..n; only the positions that change are written, one
//   audit row per dimension whose position changes (sort_order before and
//   after), none when nothing moves; the dimensions keep their `updated_at`;
// - refused (400 on axis_ids) for another tenant's dimension, an unknown id, a
//   duplicate, a body that is not a list; a refusal changes nothing;
// - POST without sort_order goes last; POST and PATCH with sort_order still
//   write it (API compatibility, the fromage fixture);
// - the route: POST /analytics-axes/reorder, the permission of PATCH :id,
//   declared before the `:id` routes;
// - two connections: a value created on a dimension while a reorder is open
//   waits, then commits; an import of values across two dimensions and a
//   reorder, in both orders, end without a deadlock; an open reorder never
//   blocks a line linking a value.
// @database-spec (the data source opens in analytics-test-helpers).

async function positions(runner: QueryRunner, tenantId: string): Promise<string[]> {
  const rows: Array<{ code: string; sort_order: number }> = await runner.query(
    `SELECT code, sort_order FROM analytics_axes WHERE tenant_id = $1
      ORDER BY sort_order ASC, lower(coalesce(name, '')) ASC, code ASC, id ASC`,
    [tenantId],
  );
  return rows.map((row) => `${row.sort_order} ${row.code}`);
}

/** A tenant with the default dimension (position 0) and `codes`, created in that order through the service. */
async function seedDimensions(runner: QueryRunner, tag: string, codes: string[]) {
  const tenantId = await seedTenant(runner, tag);
  const svc = services(runner.manager);
  const ctx = context(runner.manager, tenantId);
  const ids: Record<string, string> = { default: await ensureDefaultAnalyticsAxis(runner.manager, tenantId) };
  for (const code of codes) ids[code] = (await svc.axes.create({ code, name: code[0].toUpperCase() + code.slice(1) }, ctx)).id;
  return { tenantId, svc, ctx, ids };
}

async function testReorder() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx, ids } = await seedDimensions(runner, 'axis-order', ['nature', 'site', 'project']);
    assert.deepEqual(await positions(runner, tenantId), ['0 default', '1 nature', '2 site', '3 project'], 'each new dimension goes last');
    const auditRows = async () => runner.query(
      `SELECT record_id, before_json, after_json FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'analytics_axes' AND action = 'update'
        ORDER BY record_id`,
      [tenantId],
    );
    const stamps = async () => (await runner.query(
      `SELECT id, updated_at FROM analytics_axes WHERE tenant_id = $1 ORDER BY id`,
      [tenantId],
    )).map((row: { id: string; updated_at: Date }) => `${row.id} ${row.updated_at.toISOString()}`);
    // A past stamp: within this transaction now() is the stamp the dimensions were created with.
    await runner.query(`UPDATE analytics_axes SET updated_at = '2020-01-01T00:00:00Z' WHERE tenant_id = $1`, [tenantId]);
    const updatedBefore = await stamps();

    // A partial list: the listed dimensions first, the others after them in their order.
    const result = await svc.axes.reorder([ids.project, ids.nature], ctx);
    assert.deepEqual(result.items.map((axis) => axis.code), ['project', 'nature', 'default', 'site'], 'returns every dimension in the new order');
    assert.deepEqual(result.items.map((axis) => axis.sort_order), [1, 2, 3, 4], 'renumbered 1..n');
    assert.deepEqual(result.items.map((axis) => axis.status), ['enabled', 'enabled', 'enabled', 'enabled'], 'in the shape of the list');
    assert.deepEqual(result, await svc.axes.list(ctx), 'the same as GET /analytics-axes');
    assert.deepEqual(await stamps(), updatedBefore, 'the dimensions keep their updated_at');

    const sortOrderChange = (id: string, before: number, after: number) => ({
      record_id: id, before_json: { sort_order: before }, after_json: { sort_order: after },
    });
    const byRecord = (rows: Array<{ record_id: string }>) => [...rows].sort((a, b) => a.record_id.localeCompare(b.record_id));
    assert.deepEqual(await auditRows(), byRecord([
      sortOrderChange(ids.project, 3, 1),
      sortOrderChange(ids.nature, 1, 2),
      sortOrderChange(ids.default, 0, 3),
      sortOrderChange(ids.site, 2, 4),
    ]), 'one audit row per dimension whose position changed');

    // Two dimensions swap places: only they are written and audited.
    await runner.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    await svc.axes.reorder([ids.project, ids.default, ids.nature], ctx);
    assert.deepEqual(await positions(runner, tenantId), ['1 project', '2 default', '3 nature', '4 site']);
    assert.deepEqual(await auditRows(), byRecord([
      sortOrderChange(ids.default, 3, 2),
      sortOrderChange(ids.nature, 2, 3),
    ]), 'the dimensions that kept their position are not audited');

    // The full list in the same order moves nothing: no write, no audit row.
    await runner.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    const unchanged = await svc.axes.reorder([ids.project, ids.default, ids.nature, ids.site], ctx);
    assert.deepEqual(unchanged.items.map((axis) => axis.code), ['project', 'default', 'nature', 'site']);
    assert.deepEqual(await auditRows(), [], 'nothing moved, nothing audited');
    assert.deepEqual(await stamps(), updatedBefore, 'still the old updated_at');

    // A new dimension goes last.
    const created = await svc.axes.create({ code: 'owner', name: 'Owner' }, ctx);
    assert.equal(created.sort_order, 5, 'POST without sort_order: max + 1');
  });
}

async function testRefusals() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx, ids } = await seedDimensions(runner, 'axis-order-refused', ['nature', 'site']);
    const otherTenant = await seedTenant(runner, 'axis-order-foreign');
    const foreign = await services(runner.manager).axes.create({ code: 'nature', name: 'Nature' }, context(runner.manager, otherTenant));
    await setCurrentTenant(runner, tenantId);
    const before = await positions(runner, tenantId);

    const missing = /A dimension in this order does not exist/;
    await expectRefused(runner, missing, () => svc.axes.reorder([ids.site, foreign.id], ctx));
    await expectRefused(runner, missing, () => svc.axes.reorder([randomUUID()], ctx));
    await expectRefused(runner, missing, () => svc.axes.reorder(['not-a-uuid'], ctx));
    await expectRefused(runner, /Each dimension can appear only once/, () => svc.axes.reorder([ids.site, ids.nature, ids.site], ctx));
    await expectRefused(runner, /The dimensions must be a list/, () => svc.axes.reorder(ids.site, ctx));
    const status = await svc.axes.reorder([foreign.id], ctx).then(
      () => assert.fail('a foreign dimension must be refused'),
      (error: any) => [error?.getStatus?.(), error?.getResponse?.().field],
    );
    assert.deepEqual(status, [400, 'axis_ids'], 'a refusal is a 400 on axis_ids');
    assert.deepEqual(await positions(runner, tenantId), before, 'a refusal changes nothing');
  });
}

async function testSortOrderStillAccepted() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx, ids } = await seedDimensions(runner, 'axis-order-compat', []);
    // The fromage fixture creates its dimensions at 10, 20, 30.
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const create = await pipe.transform({ code: 'nature', name: 'Nature', sort_order: 10 }, { type: 'body', metatype: AnalyticsAxisCreateDto });
    assert.equal(create.sort_order, 10, 'POST keeps sort_order');
    const update = await pipe.transform({ sort_order: 5 }, { type: 'body', metatype: AnalyticsAxisUpdateDto });
    assert.equal(update.sort_order, 5, 'PATCH keeps sort_order');
    const reorder = await pipe.transform({ axis_ids: [ids.default], extra: 1 }, { type: 'body', metatype: AnalyticsAxisReorderDto });
    assert.deepEqual(reorder, Object.assign(new AnalyticsAxisReorderDto(), { axis_ids: [ids.default] }), 'the reorder body is whitelisted');

    const nature = await svc.axes.create({ code: 'nature', name: 'Nature', sort_order: 10 }, ctx);
    const site = await svc.axes.create({ code: 'site', name: 'Site', sort_order: 20 }, ctx);
    assert.deepEqual([nature.sort_order, site.sort_order], [10, 20], 'POST writes the position given');
    const last = await svc.axes.create({ code: 'owner', name: 'Owner' }, ctx);
    assert.equal(last.sort_order, 21, 'POST without it goes last');
    const moved = await svc.axes.update(site.id, { sort_order: 5 }, ctx);
    assert.equal(moved.sort_order, 5, 'PATCH writes it');
    assert.deepEqual(await positions(runner, tenantId), ['0 default', '5 site', '10 nature', '21 owner']);
    // A reorder makes the positions dense again.
    await svc.axes.reorder([], ctx);
    assert.deepEqual(await positions(runner, tenantId), ['1 default', '2 site', '3 nature', '4 owner']);
  });
}

function testReorderRoute() {
  const proto = AnalyticsAxesController.prototype as any;
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.reorder), 'reorder');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, proto.reorder), RequestMethod.POST);
  assert.deepEqual(
    Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.reorder),
    Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.update),
    'the permission of PATCH :id',
  );
  const order = Object.getOwnPropertyNames(proto);
  const paramRoutes = order.filter((name) => String(Reflect.getMetadata(PATH_METADATA, proto[name]) ?? '').startsWith(':'));
  assert.ok(paramRoutes.length > 0);
  for (const name of paramRoutes) {
    assert.ok(order.indexOf('reorder') < order.indexOf(name), `reorder is declared before ${name}`);
  }
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

async function committedPositions(tenantId: string) {
  return committed(async (runner) => {
    await setCurrentTenant(runner, tenantId);
    return positions(runner, tenantId);
  });
}

/**
 * A value create holds its dimension FOR SHARE; the reorder holds every dimension FOR NO KEY
 * UPDATE: a value created on a dimension while a reorder is open waits for it, then commits.
 */
async function testValueCreateWaitsForReorder() {
  const seed = await committed(async (runner) => {
    const { tenantId, ids } = await seedDimensions(runner, 'axis-order-race', ['nature', 'site']);
    return { tenantId, ids };
  });
  const leader = await openTenantTransaction(seed.tenantId);
  const follower = await openTenantTransaction(seed.tenantId);
  try {
    await services(leader.manager).axes.reorder([seed.ids.site], context(leader.manager, seed.tenantId));
    const pid = await backendPid(follower);
    const create = services(follower.manager).values
      .create({ axis_id: seed.ids.site, name: 'Paris' }, null, context(follower.manager, seed.tenantId))
      .then((result) => result, (err: any) => err);
    await waitUntilBlocked(pid);
    await leader.commitTransaction();
    const outcome = await create;
    assert.ok(!(outcome instanceof Error), `the value create succeeds once the reorder commits (${outcome?.message})`);
    await follower.commitTransaction();
    assert.deepEqual(await committedPositions(seed.tenantId), ['1 site', '2 default', '3 nature']);
    const [{ n }] = await committed(async (runner) => {
      await setCurrentTenant(runner, seed.tenantId);
      return runner.query(`SELECT count(*)::int AS n FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2`, [seed.tenantId, seed.ids.site]);
    });
    assert.equal(n, 1, 'the value is stored');
  } finally {
    await closeRunner(follower);
    await closeRunner(leader);
    await deleteRaceTenant(seed.tenantId);
  }
}

/**
 * A values import spanning two dimensions locks them in id order before its first write, as the
 * reorder does: whichever comes second waits for the first, in both orders, never a deadlock.
 */
async function testImportAcrossDimensionsAndReorder() {
  for (const first of ['import', 'reorder'] as const) {
    const seed = await committed(async (runner) => {
      const { tenantId, ids } = await seedDimensions(runner, `axis-order-csv-${first}`, ['nature', 'site']);
      return { tenantId, ids };
    });
    const leader = await openTenantTransaction(seed.tenantId);
    const follower = await openTenantTransaction(seed.tenantId);
    try {
      const importFile = (runner: QueryRunner) => services(runner.manager).csv.importCsv({
        file: csvFile(['axis_code;name;description', 'site;Paris;', 'nature;Licences;'].join('\n')),
        dryRun: false,
      }, context(runner.manager, seed.tenantId));
      const reorder = (runner: QueryRunner) =>
        services(runner.manager).axes.reorder([seed.ids.site, seed.ids.nature], context(runner.manager, seed.tenantId));
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
      assert.deepEqual(await committedPositions(seed.tenantId), ['1 site', '2 nature', '3 default'], `${first} first: the order is stored`);
    } finally {
      await closeRunner(follower);
      await closeRunner(leader);
      await deleteRaceTenant(seed.tenantId);
    }
  }
}

/**
 * A line write never locks a dimension (FOR KEY SHARE on the value it links): a line links a value
 * while a reorder of the dimensions is still open (within a short lock timeout, so a block fails
 * instead of hanging).
 */
async function testReorderDoesNotBlockLines() {
  const seed = await committed(async (runner) => {
    const { tenantId, svc, ctx, ids } = await seedDimensions(runner, 'axis-order-lines', ['nature']);
    const value = await svc.values.create({ axis_id: ids.nature, name: 'Licences' }, null, ctx);
    const lineId = await seedLine(runner, 'opex', tenantId);
    return { tenantId, ids, valueId: value.id, lineId };
  });
  const leader = await openTenantTransaction(seed.tenantId);
  const follower = await openTenantTransaction(seed.tenantId);
  try {
    await services(leader.manager).axes.reorder([seed.ids.nature], context(leader.manager, seed.tenantId));
    await follower.query(`SET LOCAL lock_timeout = '3s'`);
    await linkValue(follower, 'opex', seed.tenantId, seed.lineId, seed.ids.nature, seed.valueId);
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

runSpecs('analytics-axis-order.integration.spec', [
  testReorder,
  testRefusals,
  testSortOrderStillAccepted,
  async () => testReorderRoute(),
  testValueCreateWaitsForReorder,
  testImportAcrossDimensionsAndReorder,
  testReorderDoesNotBlockLines,
]);
