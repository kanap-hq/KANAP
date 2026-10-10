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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AnalyticsAxisCreateDto,
  AnalyticsAxisUpdateDto,
  AnalyticsCategoryCreateDto,
  AnalyticsCategoryUpdateDto,
} from '../dto/analytics.dto';
import {
  ensureDefaultAnalyticsAxis,
  loadAnalyticsAxes,
  resolveDefaultAxisId,
} from '../analytics-axes.util';
import { backendPid, closeRunner, committed, openTenantTransaction, waitUntilBlocked } from '../../cost-centers/__tests__/cost-center-test-helpers';
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

// Analytics dimensions and their values against a real database: the default
// dimension (one per tenant, locked, an identity that survives renames and
// reorders), codes and names, deletes, a value's fixed dimension, the same
// value name in two dimensions, value deletes (single and bulk), the list
// scope, the line types a dimension and a value apply to (`applies_to`, with
// their coherence and its race), and the tenant bootstrap. The cross-tenant cases live in
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
      values.persist(ctx, null, { axis_id: nature.id, name: 'OTHER', description: null, applies_to: null, status: StatusState.ENABLED, disabled_at: null }, nature));
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
    assert.deepEqual(names(await values.list({}, ctx)), ['Licences', 'Hardware'], 'enabled only by default, the default dimension first');
    assert.deepEqual(names(await values.list({ includeDisabled: '1' }, ctx)), ['Licences', 'Retired', 'Hardware']);
    assert.deepEqual(names(await values.list({ includeDisabled: true }, ctx)), ['Licences', 'Retired', 'Hardware'], 'the AI passes a boolean');
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
    assert.deepEqual(names(await values.list({}, { manager: runner.manager })), ['Licences', 'Hardware']);

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

async function testAppliesTo() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'applies');
    const { axes: svc } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const defaultId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);

    // Create: absent is both (null), and each value is stored and returned.
    const both = await svc.create({ code: 'both', name: 'Both' }, ctx);
    assert.equal(both.applies_to, null);
    const opex = await svc.create({ code: 'recurrence', name: 'Recurrence', applies_to: 'opex' }, ctx);
    assert.equal(opex.applies_to, 'opex');
    const capex = await svc.create({ code: 'ppe', name: 'PP&E type', applies_to: 'capex' }, ctx);
    assert.equal(capex.applies_to, 'capex');
    const explicitNull = await svc.create({ code: 'nulled', name: 'Nulled', applies_to: null }, ctx);
    assert.equal(explicitNull.applies_to, null);

    // Update: absent keeps, null clears, each value is written.
    assert.equal((await svc.update(opex.id, { name: 'Recurrence 2' }, ctx)).applies_to, 'opex', 'absent keeps');
    assert.equal((await svc.update(opex.id, { applies_to: 'capex' }, ctx)).applies_to, 'capex');
    assert.equal((await svc.update(opex.id, { applies_to: null }, ctx)).applies_to, null, 'null clears');
    assert.equal((await svc.update(both.id, { applies_to: 'opex' }, ctx)).applies_to, 'opex');

    // The audit carries the field before and after.
    const [audit] = await runner.query(
      `SELECT before_json, after_json FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'analytics_axes' AND record_id = $2 AND action = 'update'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [tenantId, both.id],
    );
    assert.equal(audit.before_json.applies_to, null);
    assert.equal(audit.after_json.applies_to, 'opex');

    // An invalid value: refused by the service and by the DTO.
    await expectRefused(runner, /^Used for must be 'opex', 'capex' or empty\./, () =>
      svc.update(capex.id, { applies_to: 'both' }, ctx));
    await expectRefused(runner, /^Used for must be/, () =>
      svc.create({ code: 'bad', name: 'Bad', applies_to: 'everything' }, ctx));
    for (const Dto of [AnalyticsAxisCreateDto, AnalyticsAxisUpdateDto]) {
      const invalid = await validate(plainToInstance(Dto, { code: 'x', applies_to: 'both' }));
      assert.ok(invalid.some((error) => error.property === 'applies_to'), `${Dto.name} refuses 'both'`);
      for (const valid of ['opex', 'capex', null]) {
        const errors = await validate(plainToInstance(Dto, { code: 'x', applies_to: valid }));
        assert.ok(!errors.some((error) => error.property === 'applies_to'), `${Dto.name} accepts ${valid}`);
      }
    }

    // The default dimension applies to both: refused by the service, then by the CHECK.
    await expectRefused(runner, /^The default dimension applies to OPEX and CAPEX lines\./, () =>
      svc.update(defaultId, { applies_to: 'opex' }, ctx));
    await svc.update(defaultId, { applies_to: null }, ctx);
    await expectRefused(runner, /analytics_axes_default_applies_check/, () => runner.query(
      `UPDATE analytics_axes SET applies_to = 'capex' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, defaultId],
    ));
    await expectRefused(runner, /analytics_axes_applies_to_check/, () => runner.query(
      `UPDATE analytics_axes SET applies_to = 'both' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, capex.id],
    ));

    // List, get and the shared loader return it.
    const listed = new Map((await svc.list(ctx)).items.map((axis) => [axis.id, axis.applies_to]));
    assert.equal(listed.get(defaultId), null);
    assert.equal(listed.get(both.id), 'opex');
    assert.equal(listed.get(capex.id), 'capex');
    assert.equal((await svc.get(capex.id, ctx)).applies_to, 'capex');
    const loaded = new Map((await loadAnalyticsAxes(runner.manager, tenantId)).map((axis) => [axis.id, axis.applies_to]));
    assert.equal(loaded.get(capex.id), 'capex');
    assert.equal(loaded.get(opex.id), null);
  });
}

async function testRequired() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'required');
    const { axes: svc } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const defaultId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);

    // Create: absent is optional (false); true is stored and returned.
    const optional = await svc.create({ code: 'optional', name: 'Optional' }, ctx);
    assert.equal(optional.required, false);
    const menu = await svc.create({ code: 'menu', name: 'Menu', required: true }, ctx);
    assert.equal(menu.required, true);

    // Update: absent keeps, a boolean is written; the default dimension may be required.
    assert.equal((await svc.update(menu.id, { name: 'Menu 2' }, ctx)).required, true, 'absent keeps');
    assert.equal((await svc.update(menu.id, { required: null }, ctx)).required, true, 'null keeps');
    assert.equal((await svc.update(menu.id, { required: false }, ctx)).required, false);
    assert.equal((await svc.update(optional.id, { required: true }, ctx)).required, true);
    assert.equal((await svc.update(defaultId, { required: true }, ctx)).required, true, 'the default dimension may be required');

    // The audit carries it before and after.
    const [audit] = await runner.query(
      `SELECT before_json, after_json FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'analytics_axes' AND record_id = $2 AND action = 'update'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [tenantId, optional.id],
    );
    assert.equal(audit.before_json.required, false);
    assert.equal(audit.after_json.required, true);
    const audits = async () => Number((await runner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'analytics_axes' AND record_id = $2`,
      [tenantId, optional.id],
    ))[0].n);
    const before = await audits();
    await svc.update(optional.id, { required: true }, ctx);
    assert.equal(await audits(), before, 'an unchanged setting writes no audit row');

    // Invalid: refused by the service and by the DTO.
    await expectRefused(runner, /^Required must be true or false\./, () => svc.update(menu.id, { required: 'maybe' }, ctx));
    for (const Dto of [AnalyticsAxisCreateDto, AnalyticsAxisUpdateDto]) {
      const invalid = await validate(plainToInstance(Dto, { code: 'x', required: 'yes' }));
      assert.ok(invalid.some((error) => error.property === 'required'), `${Dto.name} refuses a string`);
      for (const valid of [true, false, undefined]) {
        const errors = await validate(plainToInstance(Dto, { code: 'x', required: valid }));
        assert.ok(!errors.some((error) => error.property === 'required'), `${Dto.name} accepts ${valid}`);
      }
    }

    // List, get and the shared loader return it.
    const listed = new Map((await svc.list(ctx)).items.map((axis) => [axis.id, axis.required]));
    assert.equal(listed.get(defaultId), true);
    assert.equal(listed.get(menu.id), false);
    assert.equal(listed.get(optional.id), true);
    assert.equal((await svc.get(optional.id, ctx)).required, true);
    const loaded = new Map((await loadAnalyticsAxes(runner.manager, tenantId)).map((axis) => [axis.id, axis.required]));
    assert.equal(loaded.get(optional.id), true);
    assert.equal(loaded.get(menu.id), false);
  });
}

/**
 * The detail's `opex_missing` / `capex_missing` (lines of every status without a value, 0 for a
 * type the dimension does not apply to) and `unusable_for` (types with no enabled value usable on
 * them), whatever `required` is.
 */
async function testMissingAndUnusable() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'missing');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    await ensureDefaultAnalyticsAxis(runner.manager, tenantId);

    const menu = await axes.create({ code: 'menu', name: 'Menu' }, ctx);
    assert.deepEqual(
      { opex: menu.opex_missing, capex: menu.capex_missing, unusable: menu.unusable_for },
      { opex: 0, capex: 0, unusable: ['opex', 'capex'] },
      'no line, no value: unusable on both types',
    );

    const opexLines = [await seedLine(runner, 'opex', tenantId), await seedLine(runner, 'opex', tenantId), await seedLine(runner, 'opex', tenantId)];
    const capexLines = [await seedLine(runner, 'capex', tenantId), await seedLine(runner, 'capex', tenantId)];
    // A disabled line still counts (the list link shows every status).
    await runner.query(
      `UPDATE spend_items SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, opexLines[2]],
    );
    const saas = await values.create({ axis_id: menu.id, name: 'Abonnements SaaS', applies_to: 'opex' }, null, ctx);
    await linkValue(runner, 'opex', tenantId, opexLines[0], menu.id, saas.id);

    const detail = await axes.get(menu.id, ctx);
    assert.equal(detail.opex_missing, 2, 'two OPEX lines without a value, the disabled one included');
    assert.equal(detail.capex_missing, 2);
    assert.deepEqual(detail.unusable_for, ['capex'], 'every value is OPEX only: unusable on CAPEX lines');

    const shared = await values.create({ axis_id: menu.id, name: 'Licences' }, null, ctx);
    await linkValue(runner, 'capex', tenantId, capexLines[0], menu.id, shared.id);
    const both = await axes.get(menu.id, ctx);
    assert.equal(both.capex_missing, 1);
    assert.deepEqual(both.unusable_for, [], 'a value of both types is usable on both');

    // A disabled value does not count.
    await runner.query(
      `UPDATE analytics_categories SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, shared.id],
    );
    assert.deepEqual((await axes.get(menu.id, ctx)).unusable_for, ['capex'], 'a disabled value is not usable');

    // A dimension for OPEX lines only: CAPEX lines count 0 and are never unusable.
    const recurrence = await axes.create({ code: 'recurrence', name: 'Recurrence', applies_to: 'opex' }, ctx);
    assert.deepEqual(
      { opex: recurrence.opex_missing, capex: recurrence.capex_missing, unusable: recurrence.unusable_for },
      { opex: 3, capex: 0, unusable: ['opex'] },
      'a type the dimension does not apply to: 0 and never unusable',
    );

    // The counts do not depend on the setting.
    const required = await axes.update(menu.id, { required: true }, ctx);
    assert.deepEqual(
      { opex: required.opex_missing, capex: required.capex_missing, unusable: required.unusable_for },
      { opex: 2, capex: 1, unusable: ['capex'] },
    );
  });
}

async function testValueAppliesTo() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'value-applies');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await axes.create({ code: 'nature', name: 'Nature de coût' }, ctx);

    // Create: absent is both (null), and each value is stored and returned.
    const both = await values.create({ axis_id: nature.id, name: 'Licences' }, null, ctx);
    assert.equal(both.applies_to, null);
    const saas = await values.create({ axis_id: nature.id, name: 'Abonnements SaaS', applies_to: 'opex' }, null, ctx);
    assert.equal(saas.applies_to, 'opex');
    const hardware = await values.create({ axis_id: nature.id, name: 'Matériel', applies_to: 'capex' }, null, ctx);
    assert.equal(hardware.applies_to, 'capex');
    const explicitNull = await values.create({ axis_id: nature.id, name: 'Divers', applies_to: null }, null, ctx);
    assert.equal(explicitNull.applies_to, null);

    // Update: absent keeps, null clears, each value is written; a value at its stored state writes nothing.
    assert.equal((await values.update(saas.id, { name: 'Abonnements SaaS 2' }, null, ctx)).applies_to, 'opex', 'absent keeps');
    assert.equal((await values.update(saas.id, { applies_to: 'capex' }, null, ctx)).applies_to, 'capex');
    assert.equal((await values.update(saas.id, { applies_to: null }, null, ctx)).applies_to, null, 'null clears');
    assert.equal((await values.update(both.id, { applies_to: 'opex' }, null, ctx)).applies_to, 'opex');
    const [{ n: auditsBefore }] = await runner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'analytics_categories' AND record_id = $2`,
      [tenantId, both.id],
    );
    await values.update(both.id, { applies_to: 'opex' }, null, ctx);
    const [{ n: auditsAfter }] = await runner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'analytics_categories' AND record_id = $2`,
      [tenantId, both.id],
    );
    assert.equal(auditsAfter, auditsBefore, 'an unchanged applies_to writes no audit row');

    // The audit carries the field before and after.
    const [audit] = await runner.query(
      `SELECT before_json, after_json FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'analytics_categories' AND record_id = $2 AND action = 'update'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [tenantId, both.id],
    );
    assert.equal(audit.before_json.applies_to, null);
    assert.equal(audit.after_json.applies_to, 'opex');

    // An invalid value: refused by the service, the DTO and the CHECK.
    await expectRefused(runner, /^Used for must be 'opex', 'capex' or empty\./, () =>
      values.update(hardware.id, { applies_to: 'both' }, null, ctx));
    await expectRefused(runner, /^Used for must be/, () =>
      values.create({ axis_id: nature.id, name: 'Bad', applies_to: 'everything' }, null, ctx));
    for (const Dto of [AnalyticsCategoryCreateDto, AnalyticsCategoryUpdateDto]) {
      const invalid = await validate(plainToInstance(Dto, { name: 'x', applies_to: 'both' }));
      assert.ok(invalid.some((error) => error.property === 'applies_to'), `${Dto.name} refuses 'both'`);
      for (const valid of ['opex', 'capex', null]) {
        const errors = await validate(plainToInstance(Dto, { name: 'x', applies_to: valid }));
        assert.ok(!errors.some((error) => error.property === 'applies_to'), `${Dto.name} accepts ${valid}`);
      }
    }
    await expectRefused(runner, /analytics_categories_applies_to_check/, () => runner.query(
      `UPDATE analytics_categories SET applies_to = 'both' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, hardware.id],
    ));

    // Get, list (set filter, blank = both, sort) carry it.
    assert.equal((await values.get(hardware.id, ctx)).applies_to, 'capex');
    const names = (result: { items: Array<{ name: string }> }) => result.items.map((item) => item.name);
    const filtered = (valuesOf: unknown[]) =>
      values.list({ axis_id: nature.id, filters: JSON.stringify({ applies_to: { filterType: 'set', values: valuesOf } }) }, ctx);
    assert.deepEqual(names(await filtered(['capex'])), ['Matériel']);
    assert.deepEqual(names(await filtered([''])), ['Abonnements SaaS 2', 'Divers'], 'blank is OPEX and CAPEX');
    assert.deepEqual(names(await filtered([null, 'opex'])), ['Licences', 'Abonnements SaaS 2', 'Divers'], 'in the dimension order');
    assert.equal(((await values.list({ axis_id: nature.id }, ctx)).items.find((item) => item.id === hardware.id) as any)?.applies_to, 'capex');
    assert.deepEqual(
      names(await values.list({ axis_id: nature.id, sort: 'applies_to:ASC' }, ctx)).slice(0, 2),
      ['Matériel', 'Licences'],
      'sorted by applies_to (capex before opex, nulls last)',
    );
  });
}

async function testValueAppliesToFollowsItsDimension() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'value-coherence');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await axes.create({ code: 'nature', name: 'Nature de coût', applies_to: 'opex' }, ctx);

    // A value may not be restricted to the type its dimension excludes, on create and on update.
    await expectRefused(runner, /^The Nature de coût dimension is for OPEX lines only\./, () =>
      values.create({ axis_id: nature.id, name: 'Matériel', applies_to: 'capex' }, null, ctx));
    const plain = await values.create({ axis_id: nature.id, name: 'Licences' }, null, ctx);
    await expectRefused(runner, /^The Nature de coût dimension is for OPEX lines only\./, () =>
      values.update(plain.id, { applies_to: 'capex' }, null, ctx));
    // The refusal names the field, so the page shows it under Used for (a JS refusal: the transaction stays usable).
    const refusal = await values.update(plain.id, { applies_to: 'capex' }, null, ctx).then(() => null, (error) => error);
    assert.equal(refusal?.response?.field, 'applies_to');
  });
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'value-coherence-2');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await axes.create({ code: 'nature', name: 'Nature de coût', applies_to: 'opex' }, ctx);
    // A restriction to the dimension's own type is allowed (redundant, kept if the dimension opens later).
    const saas = await values.create({ axis_id: nature.id, name: 'Abonnements SaaS', applies_to: 'opex' }, null, ctx);
    assert.equal(saas.applies_to, 'opex');
    await axes.update(nature.id, { applies_to: null }, ctx);
    assert.equal((await values.get(saas.id, ctx)).applies_to, 'opex', 'opening the dimension keeps the value restriction');

    // Narrowing the dimension while values are restricted to the other type is refused, naming them
    // (singular, plural, then "and N more" past three, disabled values included).
    const hardware = await values.create({ axis_id: nature.id, name: 'Matériel', applies_to: 'capex' }, null, ctx);
    await expectRefused(
      runner,
      /^1 value of this dimension is for CAPEX lines only \(Matériel\)\. Set it to OPEX and CAPEX first\./,
      () => axes.update(nature.id, { applies_to: 'opex' }, ctx),
    );
    const servers = await values.create({ axis_id: nature.id, name: 'Serveurs', applies_to: 'capex' }, null, ctx);
    await expectRefused(
      runner,
      /^2 values of this dimension are for CAPEX lines only \(Matériel, Serveurs\)\. Set them to OPEX and CAPEX first\./,
      () => axes.update(nature.id, { applies_to: 'opex' }, ctx),
    );
    const archives = await values.create({ axis_id: nature.id, name: 'archives', applies_to: 'capex', status: 'disabled' }, null, ctx);
    const zinc = await values.create({ axis_id: nature.id, name: 'Zinc', applies_to: 'capex' }, null, ctx);
    await expectRefused(
      runner,
      /^4 values of this dimension are for CAPEX lines only \(archives, Matériel, Serveurs and 1 more\)\. Set them to OPEX and CAPEX first\./,
      () => axes.update(nature.id, { applies_to: 'opex' }, ctx),
    );
    await values.update(archives.id, { applies_to: null }, null, ctx);
    await values.update(zinc.id, { applies_to: null }, null, ctx);
    // The values of another dimension do not count.
    const other = await axes.create({ code: 'other', name: 'Other' }, ctx);
    await values.create({ axis_id: other.id, name: 'Elsewhere', applies_to: 'capex' }, null, ctx);
    // Once the values are cleared, the narrowing passes.
    await values.update(hardware.id, { applies_to: null }, null, ctx);
    await values.update(servers.id, { applies_to: null }, null, ctx);
    assert.equal((await axes.update(nature.id, { applies_to: 'opex' }, ctx)).applies_to, 'opex');
    // Under the narrowed dimension the other type is refused for a value again.
    await axes.update(nature.id, { applies_to: 'opex', name: 'Nature' }, ctx);
    await expectRefused(runner, /^The Nature dimension is for OPEX lines only\./, () =>
      values.update(hardware.id, { applies_to: 'capex' }, null, ctx));
    // A dimension restricted to CAPEX: an OPEX value is refused with the CAPEX wording.
    const ppe = await axes.create({ code: 'ppe', name: 'PP&E type', applies_to: 'capex' }, ctx);
    await expectRefused(runner, /^The PP&E type dimension is for CAPEX lines only\./, () =>
      values.create({ axis_id: ppe.id, name: 'Run', applies_to: 'opex' }, null, ctx));
    // The default dimension applies to both: its values may take either type.
    const inDefault = await values.create({ name: 'Default capex', applies_to: 'capex' }, null, ctx);
    assert.equal(inDefault.applies_to, 'capex');
    assert.equal(inDefault.axis_is_default, true);
  });
}

/** Removes a committed race tenant: values before dimensions. */
async function deleteRaceTenant(tenantId: string) {
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (const table of ['analytics_categories', 'analytics_axes', 'audit_log']) {
      await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

/**
 * Two connections: one narrows the dimension to OPEX lines, the other sets a value of it to CAPEX
 * lines only. Whichever locks first wins; the other waits (the dimension FOR UPDATE, the value
 * write FOR SHARE on the dimension), then sees the committed state and is refused. The end state
 * never holds both. The seed is committed, then removed.
 */
async function testNarrowingRacesAValueRestriction() {
  for (const first of ['dimension', 'value'] as const) {
    const seed = await committed(async (runner) => {
      const tenantId = await seedTenant(runner, `value-race-${first}`);
      const { axes, values } = services(runner.manager);
      const ctx = context(runner.manager, tenantId);
      const nature = await axes.create({ code: 'nature', name: 'Nature' }, ctx);
      const value = await values.create({ axis_id: nature.id, name: 'Matériel' }, null, ctx);
      return { tenantId, axisId: nature.id, valueId: value.id };
    });
    const leader = await openTenantTransaction(seed.tenantId);
    const follower = await openTenantTransaction(seed.tenantId);
    try {
      const leaderSvc = services(leader.manager);
      const followerSvc = services(follower.manager);
      const narrow = (svc: ReturnType<typeof services>, runner: typeof leader) =>
        svc.axes.update(seed.axisId, { applies_to: 'opex' }, context(runner.manager, seed.tenantId));
      const restrict = (svc: ReturnType<typeof services>, runner: typeof leader) =>
        svc.values.update(seed.valueId, { applies_to: 'capex' }, null, context(runner.manager, seed.tenantId));
      if (first === 'dimension') await narrow(leaderSvc, leader);
      else await restrict(leaderSvc, leader);
      const pid = await backendPid(follower);
      const blocked = (first === 'dimension' ? restrict(followerSvc, follower) : narrow(followerSvc, follower))
        .then(() => 'saved', (err: any) => err);
      await waitUntilBlocked(pid);
      await leader.commitTransaction();
      const outcome = await blocked;
      assert.notEqual(outcome, 'saved', `${first} first: the second write is refused`);
      assert.equal(outcome?.getStatus?.(), 400, `${first} first: a 400 (${outcome?.message ?? outcome})`);
      assert.match(
        outcome.message,
        first === 'dimension'
          ? /^The Nature dimension is for OPEX lines only\./
          : /^1 value of this dimension is for CAPEX lines only \(Matériel\)\./,
      );
      const state = await committed(async (runner) => {
        await setCurrentTenant(runner, seed.tenantId);
        const [row] = await runner.query(
          `SELECT a.applies_to AS axis, c.applies_to AS value FROM analytics_axes a
             JOIN analytics_categories c ON c.tenant_id = a.tenant_id AND c.axis_id = a.id
            WHERE a.tenant_id = $1 AND a.id = $2 AND c.id = $3`,
          [seed.tenantId, seed.axisId, seed.valueId],
        );
        return row;
      });
      assert.deepEqual(
        state,
        first === 'dimension' ? { axis: 'opex', value: null } : { axis: null, value: 'capex' },
        `${first} first: only the first write is stored`,
      );
    } finally {
      await closeRunner(follower);
      await closeRunner(leader);
      await deleteRaceTenant(seed.tenantId);
    }
  }
}

/**
 * A values CSV import works from an unlocked snapshot: it reads a value restricted to CAPEX lines,
 * and rewrites it unchanged. Meanwhile another transaction clears the value and narrows the
 * dimension to OPEX lines, then commits while the import waits. The import must take the
 * dimension lock and check it even though the value looks unchanged to it: it is refused, and the
 * end state never holds a CAPEX value under an OPEX dimension.
 */
async function testCsvImportRacesAClearAndNarrow() {
  const seed = await committed(async (runner) => {
    const tenantId = await seedTenant(runner, 'value-race-csv');
    const { axes, values } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await axes.create({ code: 'nature', name: 'Nature' }, ctx);
    const value = await values.create({ axis_id: nature.id, name: 'Matériel', applies_to: 'capex' }, null, ctx);
    return { tenantId, axisId: nature.id, valueId: value.id };
  });
  const narrower = await openTenantTransaction(seed.tenantId);
  const importer = await openTenantTransaction(seed.tenantId);
  try {
    const narrowerSvc = services(narrower.manager);
    const narrowerCtx = context(narrower.manager, seed.tenantId);
    await narrowerSvc.values.update(seed.valueId, { applies_to: null }, null, narrowerCtx);
    await narrowerSvc.axes.update(seed.axisId, { applies_to: 'opex' }, narrowerCtx);

    const pid = await backendPid(importer);
    const run = services(importer.manager).csv.importCsv({
      file: csvFile(['axis_code;name;description;status;disabled_at;applies_to', 'nature;Matériel;Edited;enabled;;capex'].join('\n')),
      dryRun: false,
    }, context(importer.manager, seed.tenantId)).then((result) => result, (err: any) => err);
    await waitUntilBlocked(pid);
    await narrower.commitTransaction();
    const outcome: any = await run;
    assert.equal(outcome?.getStatus?.(), 400, `the import is refused (${JSON.stringify(outcome?.errors ?? outcome?.message ?? outcome)})`);
    assert.match(outcome.message, /^The Nature dimension is for OPEX lines only\./);
    await importer.rollbackTransaction();

    const state = await committed(async (runner) => {
      await setCurrentTenant(runner, seed.tenantId);
      const [row] = await runner.query(
        `SELECT a.applies_to AS axis, c.applies_to AS value FROM analytics_axes a
           JOIN analytics_categories c ON c.tenant_id = a.tenant_id AND c.axis_id = a.id
          WHERE a.tenant_id = $1 AND a.id = $2 AND c.id = $3`,
        [seed.tenantId, seed.axisId, seed.valueId],
      );
      return row;
    });
    assert.deepEqual(state, { axis: 'opex', value: null }, 'only the narrowing is stored');
  } finally {
    await closeRunner(importer);
    await closeRunner(narrower);
    await deleteRaceTenant(seed.tenantId);
  }
}

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
  testAppliesTo,
  testRequired,
  testMissingAndUnusable,
  testValueAppliesTo,
  testValueAppliesToFollowsItsDimension,
  testNarrowingRacesAValueRestriction,
  testCsvImportRacesAClearAndNarrow,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
