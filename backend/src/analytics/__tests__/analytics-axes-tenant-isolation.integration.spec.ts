import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import { ensureDefaultAnalyticsAxis, loadAnalyticsAxes } from '../analytics-axes.util';
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

// Cross-tenant negative spec for analytics_axes, analytics_categories and the
// two line-value tables: forced RLS with the named policies; tenant B can
// neither read nor change A's dimensions, values or line values through the
// services; B cannot create a value in A's dimension; and the (tenant_id, …)
// keys refuse, even through raw SQL where RLS alone would not (foreign-key
// checks bypass RLS), a B value in A's dimension, a B line value naming A's
// value, and a line value naming a value of another dimension.
// Setting A's value on B's line through the item API is covered by the item
// write-gate spec (spend/__tests__/item-analytics.integration.spec.ts).

const TABLES = ['analytics_axes', 'analytics_categories', 'capex_item_analytics_values', 'spend_item_analytics_values'];

async function testTablesAreTenantIsolated() {
  const flags = await dataSource.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
      ORDER BY c.relname`,
    [TABLES],
  );
  assert.deepEqual(flags.map((row: any) => row.relname), TABLES, 'run the migrations first');
  for (const row of flags) {
    assert.equal(row.relrowsecurity, true, `RLS is not enabled on ${row.relname}`);
    assert.equal(row.relforcerowsecurity, true, `FORCE RLS is not enabled on ${row.relname}`);
  }
  const policies = await dataSource.query(
    `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [TABLES],
  );
  assert.deepEqual(policies.map((row: any) => [row.tablename, row.policyname, row.cmd]), TABLES.map((table) => [table, `${table}_tenant_isolation`, 'ALL']));
  for (const policy of policies) {
    assert.match(policy.qual, /tenant_id = app_current_tenant\(\)/);
    assert.match(policy.with_check, /tenant_id = app_current_tenant\(\)/);
  }
  const keys = await dataSource.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname IN ('analytics_categories_axis_fk', 'spend_item_analytics_values_category_fk', 'capex_item_analytics_values_category_fk')
      ORDER BY conname`,
  );
  assert.deepEqual(keys.map((key: any) => [key.conname, key.def]), [
    ['analytics_categories_axis_fk', 'FOREIGN KEY (tenant_id, axis_id) REFERENCES analytics_axes(tenant_id, id) ON DELETE RESTRICT'],
    ['capex_item_analytics_values_category_fk', 'FOREIGN KEY (tenant_id, category_id, axis_id) REFERENCES analytics_categories(tenant_id, id, axis_id) ON DELETE RESTRICT'],
    ['spend_item_analytics_values_category_fk', 'FOREIGN KEY (tenant_id, category_id, axis_id) REFERENCES analytics_categories(tenant_id, id, axis_id) ON DELETE RESTRICT'],
  ]);
}

async function testOtherTenantIsInvisible() {
  await withRollback(async (runner) => {
    const tenantA = await seedTenant(runner, 'iso-a');
    const a = services(runner.manager);
    const ctxA = context(runner.manager, tenantA);
    const defaultA = await ensureDefaultAnalyticsAxis(runner.manager, tenantA);
    const natureA = await a.axes.create({ code: 'nature', name: 'Nature A' }, ctxA);
    const valueA = await a.values.create({ axis_id: natureA.id, name: 'Licences A' }, null, ctxA);
    const defaultValueA = await a.values.create({ name: 'Default A' }, null, ctxA);
    const lineA = await seedLine(runner, 'opex', tenantA);
    const capexA = await seedLine(runner, 'capex', tenantA);
    await linkValue(runner, 'opex', tenantA, lineA, natureA.id, valueA.id);
    await linkValue(runner, 'capex', tenantA, capexA, defaultA, defaultValueA.id);

    const tenantB = await seedTenant(runner, 'iso-b');
    const b = services(runner.manager);
    const ctxB = context(runner.manager, tenantB);

    // Reads: nothing of A is visible to B.
    assert.deepEqual((await b.axes.list(ctxB)).items, []);
    assert.deepEqual(await loadAnalyticsAxes(runner.manager, tenantB), []);
    await expectRefused(runner, /Dimension not found\./, () => b.axes.get(natureA.id, ctxB));
    assert.equal((await b.values.list({ includeDisabled: '1' }, ctxB)).total, 0);
    assert.equal((await b.values.list({ axis_id: natureA.id, includeDisabled: '1' }, ctxB)).total, 0);
    assert.equal((await b.values.listIds({ includeDisabled: '1' }, ctxB)).total, 0);
    await expectRefused(runner, /Analytics value not found\./, () => b.values.get(valueA.id, ctxB));
    const exported = await b.csv.exportCsv('data', ctxB);
    assert.doesNotMatch(exported.content, /Licences A|Default A|nature/);

    // Writes on A's rows: not found for B.
    await expectRefused(runner, /Dimension not found\./, () => b.axes.update(natureA.id, { name: 'Taken over' }, ctxB));
    await expectRefused(runner, /Dimension not found\./, () => b.axes.delete(natureA.id, ctxB));
    await expectRefused(runner, /Analytics value not found\./, () => b.values.update(valueA.id, { name: 'Taken over' }, null, ctxB));
    await expectRefused(runner, /Analytics value not found\./, () => b.values.delete(valueA.id, null, ctxB));
    const bulk = await b.values.bulkDelete([valueA.id, defaultValueA.id], null, ctxB);
    assert.deepEqual(bulk.deleted, []);
    assert.deepEqual(bulk.failed.map((entry) => entry.name), ['Unknown', 'Unknown'], 'no name of A leaks to B');

    // B cannot create a value in A's dimension, through the service or the CSV.
    await expectRefused(runner, /Dimension not found\./, () => b.values.create({ axis_id: natureA.id, name: 'Intruder' }, null, ctxB));
    const csv = await b.csv.importCsv(
      { file: csvFile('axis_code;name;description;status;disabled_at\nnature;Intruder;;enabled;\n'), dryRun: true },
      ctxB,
    );
    assert.equal(csv.ok, false);
    assert.deepEqual(csv.errors.map((error) => error.message), ["Unknown dimension 'nature'."]);
    // The same code and value names in B are fine: both are unique per tenant only.
    const natureB = await b.axes.create({ code: 'nature', name: 'Nature A' }, ctxB);
    const valueB = await b.values.create({ axis_id: natureB.id, name: 'Licences A' }, null, ctxB);
    const defaultB = (await loadAnalyticsAxes(runner.manager, tenantB)).find((axis) => axis.is_default)!.id;
    const lineB = await seedLine(runner, 'opex', tenantB);
    const capexB = await seedLine(runner, 'capex', tenantB);

    // Raw SQL in B's session: RLS refuses a row for A; the composite keys refuse A's rows on B's.
    await expectRefused(runner, /row-level security/i, () => runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'raw', 'Raw')`,
      [tenantA],
    ));
    await expectRefused(runner, /analytics_categories_axis_fk/, () => runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Raw')`,
      [tenantB, natureA.id],
    ));
    await expectRefused(runner, /spend_item_analytics_values_category_fk/, () =>
      linkValue(runner, 'opex', tenantB, lineB, natureA.id, valueA.id));
    await expectRefused(runner, /capex_item_analytics_values_category_fk/, () =>
      linkValue(runner, 'capex', tenantB, capexB, defaultA, defaultValueA.id));
    // B's own value, named on another of B's dimensions, is refused too.
    await expectRefused(runner, /spend_item_analytics_values_category_fk/, () =>
      linkValue(runner, 'opex', tenantB, lineB, defaultB, valueB.id));
    // B's own value on its own dimension is accepted.
    await linkValue(runner, 'opex', tenantB, lineB, natureB.id, valueB.id);

    // B's session neither sees nor changes A's line values.
    for (const table of ['spend_item_analytics_values', 'capex_item_analytics_values']) {
      const [seen] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenantA]);
      assert.equal(seen.n, 0, `${table}: B reads none of A's rows`);
      const [, updated] = await runner.query(`UPDATE ${table} SET updated_at = now() WHERE tenant_id = $1`, [tenantA]);
      assert.equal(updated, 0, `${table}: B updates none of A's rows`);
      const [, deleted] = await runner.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantA]);
      assert.equal(deleted, 0, `${table}: B deletes none of A's rows`);
    }
    const [, axesDeleted] = await runner.query(`DELETE FROM analytics_axes WHERE tenant_id = $1`, [tenantA]);
    assert.equal(axesDeleted, 0);

    // B's writes left A as it was.
    await setCurrentTenant(runner, tenantA);
    const axesA = await a.axes.list(ctxA);
    assert.deepEqual(axesA.items.map((axis) => [axis.code, axis.name]), [['default', null], ['nature', 'Nature A']]);
    const linksA = await runner.query(
      `SELECT 'opex' AS kind, item_id, category_id FROM spend_item_analytics_values WHERE tenant_id = $1
       UNION ALL
       SELECT 'capex', item_id, category_id FROM capex_item_analytics_values WHERE tenant_id = $1
       ORDER BY 1 DESC`,
      [tenantA],
    );
    assert.deepEqual(linksA.map((row: any) => [row.kind, row.item_id, row.category_id]), [
      ['opex', lineA, valueA.id],
      ['capex', capexA, defaultValueA.id],
    ]);
  });
}

runSpecs('analytics-axes-tenant-isolation.integration.spec', [
  testTablesAreTenantIsolated,
  testOtherTenantIsInvisible,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
