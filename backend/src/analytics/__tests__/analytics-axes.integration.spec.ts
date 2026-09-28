import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { Role } from '../../roles/role.entity';
import { RolesService } from '../../roles/roles.service';
import { Tenant } from '../../tenants/tenant.entity';
import { TenantsService } from '../../tenants/tenants.service';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { StatusState } from '../../common/status';
import {
  ensureDefaultAnalyticsAxis,
  loadAnalyticsAxes,
  resolveDefaultAxisId,
} from '../analytics-axes.util';
import {
  context,
  expectRefused,
  linkValue,
  runSpecs,
  seedLine,
  seedTenant,
  services,
  withRollback,
} from './analytics-test-helpers';

// Analytics dimensions and their values against a real database: the default
// dimension (one per tenant, locked, an identity that survives renames and
// reorders), codes and names, deletes, a value's fixed dimension, the same
// value name in two dimensions, value deletes (single and bulk), the list
// scope, and the tenant bootstrap. The cross-tenant cases live in
// analytics-axes-tenant-isolation.integration.spec.ts.

async function testOneDefaultPerTenant() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'default');
    // A tenant inserted raw has no dimension: reads never create one.
    assert.equal(await resolveDefaultAxisId(runner.manager, tenantId), null);
    assert.deepEqual(await loadAnalyticsAxes(runner.manager, tenantId), []);

    const first = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    const again = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    assert.equal(again, first, 'ensureDefaultAnalyticsAxis is idempotent');
    assert.equal(await resolveDefaultAxisId(runner.manager, tenantId, { create: true }), first);
    const axes = await loadAnalyticsAxes(runner.manager, tenantId);
    assert.deepEqual(axes.map((axis) => [axis.code, axis.name, axis.is_default, axis.status]), [['default', null, true, 'enabled']]);

    // The database refuses a second default, whatever its code.
    await expectRefused(runner, /uniq_analytics_axes_tenant_default/, () => runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, is_default) VALUES ($1, 'other', 'Other default', true)`,
      [tenantId],
    ));
    // The API never writes is_default.
    const { axes: svc } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await svc.create({ code: 'nature', name: 'Nature', is_default: true } as any, ctx);
    assert.equal(nature.is_default, false);
    await svc.update(nature.id, { is_default: true } as any, ctx);
    assert.equal((await svc.get(nature.id, ctx)).is_default, false);
    assert.equal(await resolveDefaultAxisId(runner.manager, tenantId), first);
  });
}

async function testDefaultIsLocked() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'locked');
    const { axes: svc } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const defaultId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);

    await expectRefused(runner, /^This dimension cannot be disabled: older files and AI questions use it\./, () =>
      svc.update(defaultId, { status: 'disabled' }, ctx));
    await expectRefused(runner, /^This dimension cannot be disabled/, () =>
      svc.update(defaultId, { disabled_at: '2030-01-01' }, ctx));
    // Re-stating the enabled state is not a change.
    await svc.update(defaultId, { status: 'enabled' }, ctx);
    await expectRefused(runner, /^This dimension cannot be deleted: older files and AI questions use it\./, () =>
      svc.delete(defaultId, ctx));
    // After a reorder the message still names the dimension being edited, not a position.
    const first = await svc.create({ code: 'first', name: 'First', sort_order: -10 }, ctx);
    await expectRefused(runner, /^This dimension cannot be deleted/, () => svc.delete(defaultId, ctx));
    await svc.delete(first.id, ctx);
    // The CHECK refuses the same when the service is bypassed.
    await expectRefused(runner, /analytics_axes_default_enabled_check/, () => runner.query(
      `UPDATE analytics_axes SET status = 'disabled', disabled_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, defaultId],
    ));

    // Name NULL only on the default.
    await expectRefused(runner, /analytics_axes_name_required_check/, () => runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'unnamed', NULL)`,
      [tenantId],
    ));
    await expectRefused(runner, /Name is required\./, () => svc.create({ code: 'unnamed' }, ctx));
    const renamed = await svc.update(defaultId, { name: '  Catégorie analytique ' }, ctx);
    assert.equal(renamed.name, 'Catégorie analytique');
    const cleared = await svc.update(defaultId, { name: '' }, ctx);
    assert.equal(cleared.name, null, 'clearing the default name stores NULL');
    const nature = await svc.create({ code: 'nature', name: 'Nature' }, ctx);
    await expectRefused(runner, /Name is required\./, () => svc.update(nature.id, { name: null }, ctx));
    await expectRefused(runner, /analytics_axes_name_check/, () => runner.query(
      `UPDATE analytics_axes SET name = ' Nature' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, nature.id],
    ));
  });
}

async function testDefaultSurvivesRenameAndReorder() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'identity');
    const { axes: svc } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const defaultId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    const nature = await svc.create({ code: 'nature', name: 'Nature' }, ctx);
    assert.equal(nature.sort_order, 1, 'a new dimension goes last');

    await svc.update(nature.id, { sort_order: -5 }, ctx);
    await svc.update(defaultId, { name: 'Catégorie analytique', code: 'categorie' }, ctx);
    const axes = await loadAnalyticsAxes(runner.manager, tenantId);
    assert.deepEqual(axes.map((axis) => axis.code), ['nature', 'categorie'], 'order follows sort_order');
    assert.equal(await resolveDefaultAxisId(runner.manager, tenantId), defaultId, 'the default is an identity');
    assert.equal(axes.find((axis) => axis.is_default)?.id, defaultId);
    // A value created without a dimension still lands in the original default.
    const { values } = services(runner.manager);
    const value = await values.create({ name: 'Licences' }, null, ctx);
    assert.equal(value.axis_id, defaultId);
    assert.equal(value.axis_is_default, true);
  });
}

async function testCodesAndNames() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'codes');
    const { axes: svc } = services(runner.manager);
    const ctx = context(runner.manager, tenantId, null);
    for (const code of ['Nature', 'na ture', '-nature', 'n'.repeat(41), 'nat.ure', '']) {
      await expectRefused(runner, /Use lowercase letters, digits, - or _ \(40 at most\)\.|Code is required\./, () =>
        svc.create({ code, name: `Name ${code}` }, ctx));
    }
    await expectRefused(runner, /analytics_axes_code_check/, () => runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'Bad Code', 'Bad')`,
      [tenantId],
    ));
    const nature = await svc.create({ code: 'n'.repeat(40), name: 'Nature' }, ctx);
    assert.equal(nature.code.length, 40);
    await expectRefused(runner, new RegExp(`A dimension with code ${'n'.repeat(40)} already exists\\.`), () =>
      svc.create({ code: 'n'.repeat(40), name: 'Other' }, ctx));
    await expectRefused(runner, /A dimension named NATURE already exists\./, () =>
      svc.create({ code: 'nature-2', name: 'NATURE' }, ctx));
    // The indexes stay the guarantee: case-insensitive names, one code per tenant.
    await expectRefused(runner, /uniq_analytics_axes_tenant_name/, () => runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'x', 'nature')`,
      [tenantId],
    ));
    await expectRefused(runner, /uniq_analytics_axes_tenant_code/, () => runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, $2, 'Another')`,
      [tenantId, 'n'.repeat(40)],
    ));

    // A code rename is audited.
    const renamed = await svc.update(nature.id, { code: 'nature' }, ctx);
    assert.equal(renamed.code, 'nature');
    const [audit] = await runner.query(
      `SELECT before_json, after_json FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'analytics_axes' AND record_id = $2 AND action = 'update'
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, nature.id],
    );
    assert.ok(audit, 'the rename wrote an audit row');
    assert.equal(audit.before_json.code, 'n'.repeat(40));
    assert.equal(audit.after_json.code, 'nature');
    // An unchanged body writes nothing.
    const [{ n: before }] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    await svc.update(nature.id, { code: 'nature', name: 'Nature' }, ctx);
    const [{ n: after }] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    assert.equal(after, before);
  });
}

async function testDefaultLabelsAreReserved() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'reserved');
    const { axes: svc } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const defaultId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    // The label an unnamed default shows, in any of the four languages and any case.
    for (const name of ['Analytics dimension', 'ANALYTICS DIMENSION', 'dimension analytique', 'Analysedimension', 'Dimensión Analítica', ' Analytics dimension ']) {
      await expectRefused(runner, /^This name is reserved for the default dimension\./, () =>
        svc.create({ code: 'copy', name }, ctx));
    }
    const nature = await svc.create({ code: 'nature', name: 'Nature' }, ctx);
    await expectRefused(runner, /^This name is reserved for the default dimension\./, () =>
      svc.update(nature.id, { name: 'Dimension analytique' }, ctx));
    // Close names stay free, and the default itself may carry one of its labels.
    await svc.update(nature.id, { name: 'Analytics dimensions' }, ctx);
    const named = await svc.update(defaultId, { name: 'Analytics dimension' }, ctx);
    assert.equal(named.name, 'Analytics dimension');
  });
}

async function testDimensionDelete() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'axis-delete');
    const { axes: svc, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await svc.create({ code: 'nature', name: 'Nature' }, ctx);
    const empty = await svc.create({ code: 'empty', name: 'Empty' }, ctx);
    await values.create({ axis_id: nature.id, name: 'Licences' }, null, ctx);
    await values.create({ axis_id: nature.id, name: 'Services' }, null, ctx);

    await expectRefused(runner, /Nature still has 2 values\. Delete them first\./, () => svc.delete(nature.id, ctx));
    await svc.delete(empty.id, ctx);
    await expectRefused(runner, /Dimension not found\./, () => svc.get(empty.id, ctx));
    const [audit] = await runner.query(
      `SELECT action FROM audit_log WHERE tenant_id = $1 AND table_name = 'analytics_axes' AND record_id = $2 AND action = 'delete'`,
      [tenantId, empty.id],
    );
    assert.ok(audit, 'the delete wrote an audit row');
    // The key refuses the same when the service is bypassed.
    await expectRefused(runner, /analytics_categories_axis_fk/, () => runner.query(
      `DELETE FROM analytics_axes WHERE tenant_id = $1 AND id = $2`,
      [tenantId, nature.id],
    ));
  });
}

async function testValueNeedsDimension() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'value-axis');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    await expectRefused(runner, /null value in column "axis_id"/, () => runner.query(
      `INSERT INTO analytics_categories (tenant_id, name) VALUES ($1, 'No dimension')`,
      [tenantId],
    ));

    // Without a dimension a value goes into the default one, created on the way for a raw tenant.
    const licences = await values.create({ name: ' Licences ', description: ' Software ' }, null, ctx);
    const defaultId = await resolveDefaultAxisId(runner.manager, tenantId);
    assert.equal(licences.axis_id, defaultId);
    assert.equal(licences.name, 'Licences');
    assert.equal(licences.description, 'Software');
    assert.equal(licences.axis_is_default, true);
    assert.equal(licences.axis_name, null);

    const nature = await axes.create({ code: 'nature', name: 'Nature' }, ctx);
    const hardware = await values.create({ axis_id: nature.id, name: 'Hardware' }, null, ctx);
    assert.equal(hardware.axis_id, nature.id);
    assert.equal(hardware.axis_name, 'Nature');
    await expectRefused(runner, /Dimension not found\./, () => values.create({ axis_id: randomUUID(), name: 'Lost' }, null, ctx));

    const retired = await axes.create({ code: 'retired', name: 'Retired', status: 'disabled' }, ctx);
    assert.equal(retired.status, 'disabled');
    await expectRefused(runner, /The Retired dimension is disabled\. Enable it to add values\./, () =>
      values.create({ axis_id: retired.id, name: 'Late' }, null, ctx));
  });
}

async function testValueDimensionIsFixed() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'value-fixed');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const defaultId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    const nature = await axes.create({ code: 'nature', name: 'Nature' }, ctx);
    const value = await values.create({ name: 'Licences' }, null, ctx);

    await expectRefused(runner, /A value cannot move to another dimension\./, () =>
      values.update(value.id, { axis_id: nature.id }, null, ctx));
    const same = await values.update(value.id, { axis_id: defaultId, name: 'Licenses' }, null, ctx);
    assert.equal(same.axis_id, defaultId);
    assert.equal(same.name, 'Licenses');

    // Raw SQL: moving a value a line uses breaks the line's key.
    const line = await seedLine(runner, 'opex', tenantId);
    await linkValue(runner, 'opex', tenantId, line, defaultId, value.id);
    await expectRefused(runner, /spend_item_analytics_values_category_fk/, () => runner.query(
      `UPDATE analytics_categories SET axis_id = $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, value.id, nature.id],
    ));
    // A line's value must belong to the dimension the link names.
    const hardware = await values.create({ axis_id: nature.id, name: 'Hardware' }, null, ctx);
    const other = await seedLine(runner, 'capex', tenantId);
    await expectRefused(runner, /capex_item_analytics_values_category_fk/, () =>
      linkValue(runner, 'capex', tenantId, other, defaultId, hardware.id));
    // One value per line and dimension.
    await linkValue(runner, 'capex', tenantId, other, nature.id, hardware.id);
    const soft = await values.create({ axis_id: nature.id, name: 'Software' }, null, ctx);
    await expectRefused(runner, /capex_item_analytics_values_pkey/, () =>
      linkValue(runner, 'capex', tenantId, other, nature.id, soft.id));
  });
}

async function testSameNameInTwoDimensions() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'other');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await axes.create({ code: 'nature', name: 'Nature' }, ctx);
    const inDefault = await values.create({ name: 'Other' }, null, ctx);
    const inNature = await values.create({ axis_id: nature.id, name: 'Other' }, null, ctx);
    assert.notEqual(inDefault.id, inNature.id);

    await expectRefused(runner, /A value named other already exists in Nature\./, () =>
      values.create({ axis_id: nature.id, name: 'other' }, null, ctx));
    // An unnamed default reads in a sentence as "the analytics dimension".
    await expectRefused(runner, /A value named OTHER already exists in the analytics dimension\./, () =>
      values.create({ name: 'OTHER' }, null, ctx));
    const services2 = await values.create({ axis_id: nature.id, name: 'Services' }, null, ctx);
    await expectRefused(runner, /A value named Other already exists in Nature\./, () =>
      values.update(services2.id, { name: 'Other' }, null, ctx));
    // The index refuses it too, and its 23505 is mapped to the same sentence.
    await expectRefused(runner, /uniq_analytics_categories_tenant_axis_name/, () => runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'OTHER')`,
      [tenantId, nature.id],
    ));
    await expectRefused(runner, /A value named OTHER already exists in Nature\./, () =>
      values.persist(ctx, null, { axis_id: nature.id, name: 'OTHER', description: null, status: StatusState.ENABLED, disabled_at: null }, nature));
  });
}

async function testValueDelete() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'value-delete');
    const { values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const licences = await values.create({ name: 'Licences' }, null, ctx);
    const services1 = await values.create({ name: 'Services' }, null, ctx);
    const hardware = await values.create({ name: 'Hardware' }, null, ctx);
    const spare = await values.create({ name: 'Spare' }, null, ctx);
    const opex = await seedLine(runner, 'opex', tenantId);
    const capex = await seedLine(runner, 'capex', tenantId);
    await linkValue(runner, 'opex', tenantId, opex, licences.axis_id, licences.id);
    await linkValue(runner, 'capex', tenantId, capex, licences.axis_id, licences.id);
    const detail = await values.get(licences.id, ctx);
    assert.equal(detail.opex_count, 1);
    assert.equal(detail.capex_count, 1);

    await expectRefused(runner, /Licences is used by 1 OPEX line and 1 CAPEX line\. Disable it instead\./, () =>
      values.delete(licences.id, null, ctx));
    await values.delete(spare.id, null, ctx);
    await expectRefused(runner, /Analytics value not found\./, () => values.get(spare.id, ctx));
    const [audit] = await runner.query(
      `SELECT action FROM audit_log WHERE tenant_id = $1 AND table_name = 'analytics_categories' AND record_id = $2 AND action = 'delete'`,
      [tenantId, spare.id],
    );
    assert.ok(audit, 'the delete wrote an audit row');

    // Bulk: the value in use fails under its savepoint, the others are deleted.
    await linkValue(runner, 'opex', tenantId, await seedLine(runner, 'opex', tenantId), hardware.axis_id, hardware.id);
    const result = await values.bulkDelete([services1.id, licences.id, 'not-a-uuid', hardware.id], null, ctx);
    assert.deepEqual(result.deleted, [services1.id]);
    assert.deepEqual(
      result.failed.map((entry) => [entry.name, entry.reason]),
      [
        ['Licences', 'Licences is used by 1 OPEX line and 1 CAPEX line. Disable it instead.'],
        ['Unknown', 'Analytics value not found.'],
        ['Hardware', 'Hardware is used by 1 OPEX line. Disable it instead.'],
      ],
    );
    // The transaction is still usable and the used values are still there.
    const remaining = await runner.query(
      `SELECT name FROM analytics_categories WHERE tenant_id = $1 ORDER BY name`,
      [tenantId],
    );
    assert.deepEqual(remaining.map((row: any) => row.name), ['Hardware', 'Licences']);
  });
}

async function testListScopeAndFilters() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'list');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await axes.create({ code: 'nature', name: 'Nature' }, ctx);
    await values.create({ name: 'Licences' }, null, ctx);
    const retired = await values.create({ name: 'Retired', status: 'disabled' }, null, ctx);
    assert.equal(retired.status, 'disabled');
    await values.create({ axis_id: nature.id, name: 'Hardware' }, null, ctx);

    const names = (result: { items: Array<{ name: string }> }) => result.items.map((item) => item.name);
    assert.deepEqual(names(await values.list({}, ctx)), ['Hardware', 'Licences'], 'enabled only by default');
    assert.deepEqual(names(await values.list({ includeDisabled: '1' }, ctx)), ['Hardware', 'Licences', 'Retired']);
    assert.deepEqual(names(await values.list({ includeDisabled: true }, ctx)), ['Hardware', 'Licences', 'Retired'], 'the AI passes a boolean');
    assert.deepEqual(names(await values.list({ status: 'disabled' }, ctx)), ['Retired']);
    const byAxis = await values.list({ axis_id: nature.id }, ctx);
    assert.deepEqual(names(byAxis), ['Hardware']);
    assert.equal((byAxis.items[0] as any).axis_id, nature.id, 'list items carry axis_id');
    assert.deepEqual(names(await values.list({ axis_id: 'not-a-uuid' }, ctx)), []);
    assert.deepEqual(
      names(await values.list({ includeDisabled: '1', sort: 'name:DESC' }, ctx)),
      ['Retired', 'Licences', 'Hardware'],
    );
    assert.deepEqual(
      names(await values.list({ filters: JSON.stringify({ axis_code: { filterType: 'set', values: ['nature'] } }) }, ctx)),
      ['Hardware'],
    );
    assert.deepEqual(
      names(await values.list({ filters: JSON.stringify({ axis_name: { filterType: 'set', values: ['Analytics dimension'] } }) }, ctx)),
      ['Licences'],
    );
    assert.deepEqual(names(await values.list({ q: 'lic' }, ctx)), ['Licences']);
    const ids = await values.listIds({ includeDisabled: '1' }, ctx);
    assert.equal(ids.total, 3);
    assert.equal(ids.ids.length, 3);
    // Older callers pass only the manager: the tenant comes from the transaction.
    assert.deepEqual(names(await values.list({}, { manager: runner.manager })), ['Hardware', 'Licences']);

    const listed = await axes.list(ctx);
    assert.deepEqual(listed.items.map((axis) => [axis.code, axis.is_default]), [['default', true], ['nature', false]]);
  });
}

async function testNewTenantHasItsDefault() {
  await withRollback(async (runner) => {
    const manager = runner.manager;
    const tenants = new TenantsService(
      manager.getRepository(Tenant),
      new RolesService(manager.getRepository(Role), manager.getRepository(RolePermission)),
      new PermissionsService(manager.getRepository(UserPageRole), manager.getRepository(RolePermission)),
    );
    const slug = `ax-boot-${randomUUID().slice(0, 8)}`;
    const tenant = await tenants.createTenant({ slug, name: 'Analytics bootstrap' }, { manager });
    const axes = await loadAnalyticsAxes(manager, tenant.id);
    assert.deepEqual(axes.map((axis) => [axis.code, axis.name, axis.is_default]), [['default', null, true]]);
    // Creating the same slug again runs the seeds on the existing tenant: still one default.
    await tenants.createTenant({ slug, name: 'Analytics bootstrap' }, { manager });
    assert.equal((await loadAnalyticsAxes(manager, tenant.id)).length, 1);
  });
}

void dataSource;

runSpecs('analytics-axes.integration.spec', [
  testOneDefaultPerTenant,
  testDefaultIsLocked,
  testDefaultSurvivesRenameAndReorder,
  testCodesAndNames,
  testDefaultLabelsAreReserved,
  testDimensionDelete,
  testValueNeedsDimension,
  testValueDimensionIsFixed,
  testSameNameInTwoDimensions,
  testValueDelete,
  testListScopeAndFilters,
  testNewTenantHasItsDefault,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
