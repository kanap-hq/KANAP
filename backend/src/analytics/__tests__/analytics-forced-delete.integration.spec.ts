import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { resolveItemAnalyticsChanges } from '../../spend/item-analytics.util';
import {
  context,
  expectRefused,
  linkValue,
  runSpecs,
  seedLine,
  seedTenant,
  services,
  setCurrentTenant,
  withRollback,
} from './analytics-test-helpers';

// Forced deletes of analytics dimensions and values (`analytics-forced-delete.ts`), against a real
// database, each test in a transaction rolled back at the end:
// - a dimension used by OPEX and CAPEX lines goes with its values and the lines' values on it;
//   each line's `row_version` grows once, its search entry no longer holds the value, and the
//   audit has one row for the dimension (with the counts), one per value and one per line;
// - without `force` the refusals stay; the default dimension is refused even forced;
// - a value used by lines goes the same way, alone or in a bulk delete;
// - another tenant's dimensions, values and line values are untouched;
// - a required dimension deleted leaves the write gate working.
// @database-spec (the data source opens in analytics-test-helpers).

type Kind = 'opex' | 'capex';
/** The search entry's type of a line: one per nature. */
const ENTITY: Record<Kind, string> = { opex: 'spend_items', capex: 'capex_items' };

async function rowVersion(runner: QueryRunner, tenantId: string, itemId: string): Promise<number> {
  const [row] = await runner.query(`SELECT row_version FROM spend_items WHERE tenant_id = $1 AND id = $2`, [tenantId, itemId]);
  return Number(row.row_version);
}

async function linkCount(runner: QueryRunner, tenantId: string, column: 'axis_id' | 'category_id' | 'item_id', id: string): Promise<number> {
  const [row] = await runner.query(
    `SELECT count(*)::int AS n FROM spend_item_analytics_values WHERE tenant_id = $1 AND ${column} = $2`,
    [tenantId, id],
  );
  return Number(row.n);
}

/** Whether the line's search entry holds `text`, in its vector or in `extra_json.analytics`. */
async function searchHolds(runner: QueryRunner, kind: Kind, itemId: string, text: string): Promise<boolean> {
  const [row] = await runner.query(
    `SELECT search_vector @@ (plainto_tsquery('kanap_fr', $3) || plainto_tsquery('kanap_en', $3)) AS found,
            coalesce(extra_json->>'analytics', '') AS analytics
       FROM search_index WHERE tenant_id = app_current_tenant() AND entity_type = $1 AND entity_id = $2`,
    [ENTITY[kind], itemId, text],
  );
  assert.ok(row, `${kind}: the line has a search entry`);
  return row.found === true || String(row.analytics).includes(text);
}

async function auditRows(runner: QueryRunner, tenantId: string, table: string, recordId: string) {
  return runner.query(
    `SELECT action, before_json, after_json FROM audit_log WHERE tenant_id = $1 AND table_name = $2 AND record_id = $3 ORDER BY created_at`,
    [tenantId, table, recordId],
  );
}

async function testForcedDimensionDelete() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'force-axis');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const menu = await axes.create({ code: 'menu', name: 'Menu', required: true }, ctx);
    const dessert = await values.create({ axis_id: menu.id, name: 'Zabaglione' }, null, ctx);
    const starter = await values.create({ axis_id: menu.id, name: 'Gazpacho' }, null, ctx);
    const unused = await values.create({ axis_id: menu.id, name: 'Vichyssoise' }, null, ctx);
    const run = await values.create({ name: 'Run' }, null, ctx); // the default dimension

    const opex1 = await seedLine(runner, 'opex', tenantId);
    const opex2 = await seedLine(runner, 'opex', tenantId);
    const capex = await seedLine(runner, 'capex', tenantId);
    const untouched = await seedLine(runner, 'opex', tenantId);
    await linkValue(runner, 'opex', tenantId, opex1, menu.id, dessert.id);
    await linkValue(runner, 'opex', tenantId, opex1, run.axis_id, run.id);
    await linkValue(runner, 'opex', tenantId, opex2, menu.id, starter.id);
    await linkValue(runner, 'capex', tenantId, capex, menu.id, dessert.id);
    await linkValue(runner, 'opex', tenantId, untouched, run.axis_id, run.id);
    assert.equal(await searchHolds(runner, 'opex', opex1, 'Zabaglione'), true, 'indexed before the delete');
    assert.equal(await searchHolds(runner, 'capex', capex, 'Zabaglione'), true, 'indexed before the delete');
    // The dimension is required: a new line without a value on it is refused.
    await expectRefused(runner, /Menu dimension is required/, () =>
      resolveItemAnalyticsChanges(runner.manager, 'opex', tenantId, {}, null));

    const versions = new Map<string, number>();
    for (const id of [opex1, opex2, capex, untouched]) versions.set(id, await rowVersion(runner, tenantId, id));

    // Without force: refused, nothing changed.
    await expectRefused(runner, /Menu still has 3 values\. Delete them first\./, () => axes.delete(menu.id, ctx));
    assert.equal(await linkCount(runner, tenantId, 'axis_id', menu.id), 3);

    await axes.delete(menu.id, ctx, { force: true });

    await expectRefused(runner, /Dimension not found\./, () => axes.get(menu.id, ctx));
    assert.equal(await linkCount(runner, tenantId, 'axis_id', menu.id), 0, 'the lines lost their value on it');
    const [left] = await runner.query(
      `SELECT count(*)::int AS n FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2`,
      [tenantId, menu.id],
    );
    assert.equal(left.n, 0, 'its values are gone');
    // The default dimension's values stay on the lines.
    assert.equal(await linkCount(runner, tenantId, 'item_id', opex1), 1);
    assert.equal(await linkCount(runner, tenantId, 'item_id', untouched), 1);

    for (const id of [opex1, opex2, capex]) {
      assert.equal(await rowVersion(runner, tenantId, id), versions.get(id)! + 1, 'row_version grew once');
    }
    assert.equal(await rowVersion(runner, tenantId, untouched), versions.get(untouched), 'a line without the value is untouched');
    assert.equal(await searchHolds(runner, 'opex', opex1, 'Zabaglione'), false, 'the search entry dropped the value');
    assert.equal(await searchHolds(runner, 'opex', opex2, 'Gazpacho'), false);
    assert.equal(await searchHolds(runner, 'capex', capex, 'Zabaglione'), false);

    // Audit: the dimension with the counts, each value, each line.
    const [axisAudit] = await auditRows(runner, tenantId, 'analytics_axes', menu.id).then((rows) => rows.filter((row: any) => row.action === 'delete'));
    assert.ok(axisAudit, 'the dimension delete is audited');
    assert.equal(axisAudit.before_json.name, 'Menu');
    assert.deepEqual(axisAudit.after_json, { forced: true, values: 3, lines: 3, opex_lines: 2, capex_lines: 1 });
    for (const [value, lines] of [[dessert, 2], [starter, 1], [unused, 0]] as const) {
      const [row] = await auditRows(runner, tenantId, 'analytics_categories', value.id).then((rows) => rows.filter((r: any) => r.action === 'delete'));
      assert.ok(row, `${value.name}: the value delete is audited`);
      assert.equal(row.after_json.lines, lines);
    }
    for (const [id, table] of [[opex1, 'spend_items'], [opex2, 'spend_items'], [capex, 'capex_items']] as const) {
      const rows = await auditRows(runner, tenantId, table, id);
      const row = rows.find((r: any) => r.after_json?.operation === 'analytics_dimension_delete');
      assert.ok(row, `${table}: the line's change is audited`);
      assert.equal(row.before_json.row_version, versions.get(id));
      assert.equal(row.after_json.row_version, versions.get(id)! + 1);
      assert.equal(row.after_json.axis_name, 'Menu');
      assert.ok(menu.id in row.before_json.analytics_values, 'before: the value it held');
      assert.ok(!(menu.id in row.after_json.analytics_values), 'after: none on the dimension');
    }
    assert.equal((await auditRows(runner, tenantId, 'spend_items', untouched)).length, 0);

    // The required dimension is gone: the write gate no longer asks for it.
    assert.deepEqual(await resolveItemAnalyticsChanges(runner.manager, 'opex', tenantId, {}, null), []);
  });
}

async function testForcedDimensionWithoutLines() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'force-axis-unused');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const menu = await axes.create({ code: 'menu', name: 'Menu' }, ctx);
    await values.create({ axis_id: menu.id, name: 'Dessert' }, null, ctx);
    await values.create({ axis_id: menu.id, name: 'Starter' }, null, ctx);
    await axes.delete(menu.id, ctx, { force: true });
    await expectRefused(runner, /Dimension not found\./, () => axes.get(menu.id, ctx));
    const [axisAudit] = (await auditRows(runner, tenantId, 'analytics_axes', menu.id)).filter((row: any) => row.action === 'delete');
    assert.deepEqual(axisAudit.after_json, { forced: true, values: 2, lines: 0, opex_lines: 0, capex_lines: 0 });
  });
}

async function testDefaultRefusedEvenForced() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'force-default');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const run = await values.create({ name: 'Run' }, null, ctx);
    const line = await seedLine(runner, 'opex', tenantId);
    await linkValue(runner, 'opex', tenantId, line, run.axis_id, run.id);
    await expectRefused(runner, /^This dimension cannot be deleted: older files and AI questions use it\./, () =>
      axes.delete(run.axis_id, ctx, { force: true }));
    assert.equal((await axes.get(run.axis_id, ctx)).value_count, 1);
    assert.equal(await linkCount(runner, tenantId, 'axis_id', run.axis_id), 1);
  });
}

async function testForcedValueDelete() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'force-value');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const menu = await axes.create({ code: 'menu', name: 'Menu' }, ctx);
    const dessert = await values.create({ axis_id: menu.id, name: 'Zabaglione' }, null, ctx);
    const starter = await values.create({ axis_id: menu.id, name: 'Gazpacho' }, null, ctx);
    const opex = await seedLine(runner, 'opex', tenantId);
    const capex = await seedLine(runner, 'capex', tenantId);
    const other = await seedLine(runner, 'opex', tenantId);
    await linkValue(runner, 'opex', tenantId, opex, menu.id, dessert.id);
    await linkValue(runner, 'capex', tenantId, capex, menu.id, dessert.id);
    await linkValue(runner, 'opex', tenantId, other, menu.id, starter.id);
    const before = { opex: await rowVersion(runner, tenantId, opex), capex: await rowVersion(runner, tenantId, capex), other: await rowVersion(runner, tenantId, other) };

    await expectRefused(runner, /Zabaglione is used by 1 OPEX line and 1 CAPEX line\. Disable it instead\./, () =>
      values.delete(dessert.id, null, ctx));
    // The list gives the counts the values grid confirms on.
    const listed = await values.listWithUsage({ axis_id: menu.id }, ctx);
    const usage = new Map(listed.items.map((item) => [item.id, [item.opex_count, item.capex_count]]));
    assert.deepEqual(usage.get(dessert.id), [1, 1]);
    assert.deepEqual(usage.get(starter.id), [1, 0]);

    await values.delete(dessert.id, null, ctx, { force: true });
    await expectRefused(runner, /Analytics value not found\./, () => values.get(dessert.id, ctx));
    assert.equal(await linkCount(runner, tenantId, 'category_id', dessert.id), 0);
    assert.equal(await linkCount(runner, tenantId, 'category_id', starter.id), 1, 'the other value stays on its line');
    assert.equal(await rowVersion(runner, tenantId, opex), before.opex + 1);
    assert.equal(await rowVersion(runner, tenantId, capex), before.capex + 1);
    assert.equal(await rowVersion(runner, tenantId, other), before.other);
    assert.equal(await searchHolds(runner, 'opex', opex, 'Zabaglione'), false);
    assert.equal(await searchHolds(runner, 'capex', capex, 'Zabaglione'), false);
    assert.equal(await searchHolds(runner, 'opex', other, 'Gazpacho'), true, 'the other line keeps its value in search');
    const [valueAudit] = (await auditRows(runner, tenantId, 'analytics_categories', dessert.id)).filter((row: any) => row.action === 'delete');
    assert.deepEqual(valueAudit.after_json, { forced: true, lines: 2, opex_lines: 1, capex_lines: 1 });
    const capexAudit = (await auditRows(runner, tenantId, 'capex_items', capex)).find((row: any) => row.after_json?.operation === 'analytics_value_delete');
    assert.ok(capexAudit, 'the CAPEX line change is audited');
    assert.equal(capexAudit.after_json.category_name, 'Zabaglione');

    // Bulk: refused without force, deleted with it.
    const spare = await values.create({ axis_id: menu.id, name: 'Spare' }, null, ctx);
    const refused = await values.bulkDelete([starter.id, spare.id], null, ctx);
    assert.deepEqual(refused.deleted, [spare.id]);
    assert.equal(refused.failed.length, 1);
    assert.match(refused.failed[0].reason, /Gazpacho is used by 1 OPEX line\. Disable it instead\./);
    const forced = await values.bulkDelete([starter.id], null, ctx, { force: true });
    assert.deepEqual(forced.deleted, [starter.id]);
    assert.equal(await linkCount(runner, tenantId, 'item_id', other), 0);
    assert.equal(await rowVersion(runner, tenantId, other), before.other + 1);
  });
}

async function testOtherTenantUntouched() {
  await withRollback(async (runner) => {
    const tenantB = await seedTenant(runner, 'force-iso-b');
    const b = services(runner.manager);
    const ctxB = context(runner.manager, tenantB);
    const menuB = await b.axes.create({ code: 'menu', name: 'Menu' }, ctxB);
    const valueB = await b.values.create({ axis_id: menuB.id, name: 'Zabaglione' }, null, ctxB);
    const lineB = await seedLine(runner, 'opex', tenantB);
    await linkValue(runner, 'opex', tenantB, lineB, menuB.id, valueB.id);
    const versionB = await rowVersion(runner, tenantB, lineB);

    const tenantA = await seedTenant(runner, 'force-iso-a');
    const a = services(runner.manager);
    const ctxA = context(runner.manager, tenantA);
    const menuA = await a.axes.create({ code: 'menu', name: 'Menu' }, ctxA);
    const valueA = await a.values.create({ axis_id: menuA.id, name: 'Zabaglione' }, null, ctxA);
    const lineA = await seedLine(runner, 'opex', tenantA);
    await linkValue(runner, 'opex', tenantA, lineA, menuA.id, valueA.id);

    // A cannot force B's dimension or value away.
    await expectRefused(runner, /Dimension not found\./, () => a.axes.delete(menuB.id, ctxA, { force: true }));
    await expectRefused(runner, /Analytics value not found\./, () => a.values.delete(valueB.id, null, ctxA, { force: true }));
    await a.axes.delete(menuA.id, ctxA, { force: true });
    assert.equal(await linkCount(runner, tenantA, 'axis_id', menuA.id), 0);

    await setCurrentTenant(runner, tenantB);
    assert.equal((await b.axes.get(menuB.id, ctxB)).value_count, 1, "B's dimension keeps its value");
    assert.equal(await linkCount(runner, tenantB, 'axis_id', menuB.id), 1, "B's line keeps its value");
    assert.equal(await rowVersion(runner, tenantB, lineB), versionB);
    assert.equal(await searchHolds(runner, 'opex', lineB, 'Zabaglione'), true);
  });
}

runSpecs('analytics-forced-delete.integration.spec', [
  testForcedDimensionDelete,
  testForcedDimensionWithoutLines,
  testDefaultRefusedEvenForced,
  testForcedValueDelete,
  testOtherTenantUntouched,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
