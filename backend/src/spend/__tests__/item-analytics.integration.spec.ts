import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ensureDefaultAnalyticsAxis } from '../../analytics/analytics-axes.util';
import { backendPid, closeRunner, committed, openTenantTransaction, waitUntilBlocked } from '../../cost-centers/__tests__/cost-center-test-helpers';
import { assert, inRolledBackTransaction, Kind, runSpecs, seedTenant, setTenant } from './round-inputs.fixtures';
import { ITEM_TABLE, itemService, lineBody, refusal, seedCompany } from './cost-center.fixtures';

// Analytics values of OPEX and CAPEX lines, one per line and dimension, through
// the write gate (`item-write.util.ts` → `item-analytics.util.ts`):
// - `analytics_values: { [axis_id]: category_id | null }` sets each named
//   dimension; an omitted dimension is untouched, null clears it;
// - the legacy `analytics_category_id` is the default dimension (an identity:
//   still after a rename and a reorder); sent with a different value for it in
//   `analytics_values`, the body is refused;
// - a value of another dimension, another tenant's dimension or value, a
//   change on a disabled dimension, or a disabled value as a new assignment
//   are refused and nothing is written; a disabled current value is kept, and
//   the unchanged value (or null where there is none) of a disabled dimension
//   passes as a no-op;
// - a value deleted while a line takes it: the save waits for the delete and
//   is refused with a 400, never a database error (the gate's FOR KEY SHARE);
// - a change of analytics values alone moves updated_at and is audited with
//   both snapshots;
// - the detail and the create/update responses carry `analytics_values` in
//   dimension order plus the default dimension's id and name; the legacy list
//   endpoints read the links, never the stale item column.
// runSpecs opens the data-source, so test:ci runs this file in its database lane.

const KINDS: Kind[] = ['opex', 'capex'];
const LINK_TABLE: Record<Kind, string> = { opex: 'spend_item_analytics_values', capex: 'capex_item_analytics_values' };
const CONFLICT = 'Send the analytics category once: analytics_category_id and analytics_values disagree.';

type Setup = {
  tenantId: string;
  companyId: string;
  main: string;
  nature: string;
  old: string;
  licences: string;
  otherMain: string;
  otherNature: string;
  hardware: string;
  retired: string;
  legacy: string;
  foreignAxis: string;
  foreignValue: string;
};

async function seedAxis(runner: QueryRunner, tenantId: string, code: string, name: string, sortOrder: number, disabled = false): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, status, disabled_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, code, name, sortOrder, disabled ? 'disabled' : 'enabled', disabled ? new Date(Date.now() - 86_400_000) : null],
  );
  return row.id;
}

async function seedValue(runner: QueryRunner, tenantId: string, axisId: string, name: string, disabled = false): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, status, disabled_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, axisId, name, disabled ? 'disabled' : 'enabled', disabled ? new Date(Date.now() - 86_400_000) : null],
  );
  return row.id;
}

async function disableValue(runner: QueryRunner, id: string) {
  await runner.query(`UPDATE analytics_categories SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE id = $1`, [id]);
}

/** Tenant A holds a dimension and a value; tenant B (current) has the default dimension, Nature and a disabled one. */
async function setup(runner: QueryRunner, kind: Kind): Promise<Setup> {
  const foreignTenant = await seedTenant(runner, `analytics-a-${kind}`);
  const foreignAxis = await ensureDefaultAnalyticsAxis(runner.manager, foreignTenant);
  const foreignValue = await seedValue(runner, foreignTenant, foreignAxis, 'Foreign');

  const tenantId = await seedTenant(runner, `analytics-b-${kind}`);
  await setTenant(runner, tenantId);
  const { companyId } = await seedCompany(runner, tenantId, 'Analytics company');
  const main = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
  const nature = await seedAxis(runner, tenantId, 'nature', 'Nature', 1);
  const old = await seedAxis(runner, tenantId, 'old', 'Old axis', 2, true);
  return {
    tenantId, companyId, main, nature, old, foreignAxis, foreignValue,
    licences: await seedValue(runner, tenantId, main, 'Licences'),
    otherMain: await seedValue(runner, tenantId, main, 'Other'),
    // Two dimensions each holding "Other".
    otherNature: await seedValue(runner, tenantId, nature, 'Other'),
    hardware: await seedValue(runner, tenantId, nature, 'Hardware'),
    retired: await seedValue(runner, tenantId, nature, 'Retired', true),
    legacy: await seedValue(runner, tenantId, old, 'Legacy'),
  };
}

/** The stored links of a line, by axis id. */
async function links(runner: QueryRunner, kind: Kind, itemId: string): Promise<Record<string, string>> {
  const rows: Array<{ axis_id: string; category_id: string }> = await runner.query(
    `SELECT axis_id, category_id FROM ${LINK_TABLE[kind]} WHERE item_id = $1`,
    [itemId],
  );
  return Object.fromEntries(rows.map((row) => [row.axis_id, row.category_id]));
}

async function linkCount(runner: QueryRunner, kind: Kind, tenantId: string): Promise<number> {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${LINK_TABLE[kind]} WHERE tenant_id = $1`, [tenantId]);
  return n;
}

async function testUpsertAndOmission(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const created = await svc.create(lineBody(kind, 'Two dimensions', {
      paying_company_id: s.companyId,
      analytics_values: { [s.main]: s.licences, [s.nature]: s.otherNature },
    }), undefined, opts);
    assert.deepEqual(await links(runner, kind, created.id), { [s.main]: s.licences, [s.nature]: s.otherNature }, `${kind}: one link per dimension`);

    // The create response and the detail: every dimension holding a value, in dimension order, plus the default's.
    const expected = [
      { axis_id: s.main, axis_code: 'default', axis_name: null, is_default: true, category_id: s.licences, category_name: 'Licences' },
      { axis_id: s.nature, axis_code: 'nature', axis_name: 'Nature', is_default: false, category_id: s.otherNature, category_name: 'Other' },
    ];
    assert.deepEqual(created.analytics_values, expected, `${kind}: the create response carries the values`);
    const detail = await svc.get(created.id, opts);
    assert.deepEqual(detail.analytics_values, expected, `${kind}: the detail carries the values`);
    assert.equal(detail.analytics_category_id, s.licences);
    assert.equal(detail.analytics_category_name, 'Licences');

    // Upsert per dimension: Nature replaced, the default untouched.
    const updated = await svc.update(created.id, { analytics_values: { [s.nature]: s.hardware } }, undefined, opts);
    assert.deepEqual(await links(runner, kind, created.id), { [s.main]: s.licences, [s.nature]: s.hardware }, `${kind}: Nature replaced`);
    assert.equal(updated.analytics_values[1].category_name, 'Hardware', `${kind}: the update response carries the new value`);
    // Omitted: nothing changes; an empty map changes nothing either.
    await svc.update(created.id, { notes: 'unrelated' }, undefined, opts);
    await svc.update(created.id, { analytics_values: {} }, undefined, opts);
    assert.deepEqual(await links(runner, kind, created.id), { [s.main]: s.licences, [s.nature]: s.hardware }, `${kind}: omission leaves the values`);
    // Explicit null clears that dimension only.
    await svc.update(created.id, { analytics_values: { [s.nature]: null } }, undefined, opts);
    assert.deepEqual(await links(runner, kind, created.id), { [s.main]: s.licences }, `${kind}: null clears Nature`);

    // A line without values reads empty.
    const bare = await svc.create(lineBody(kind, 'No value', { paying_company_id: s.companyId }), undefined, opts);
    const bareDetail = await svc.get(bare.id, opts);
    assert.deepEqual(bareDetail.analytics_values, []);
    assert.equal(bareDetail.analytics_category_id, null);
    assert.equal(bareDetail.analytics_category_name, null);
  });
}

async function testLegacyField(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const line = await svc.create(lineBody(kind, 'Legacy', { paying_company_id: s.companyId, analytics_category_id: s.licences }), undefined, opts);
    assert.deepEqual(await links(runner, kind, line.id), { [s.main]: s.licences }, `${kind}: the legacy field writes the default dimension`);
    const [column] = await runner.query(`SELECT analytics_category_id FROM ${ITEM_TABLE[kind]} WHERE id = $1`, [line.id]);
    assert.equal(column.analytics_category_id, null, `${kind}: the item column is not written`);

    await svc.update(line.id, { analytics_category_id: s.otherMain, analytics_values: { [s.nature]: s.hardware } }, undefined, opts);
    assert.deepEqual(await links(runner, kind, line.id), { [s.main]: s.otherMain, [s.nature]: s.hardware }, `${kind}: legacy and new fields together`);
    // Both name the default dimension: accepted when they agree, refused when they differ.
    await svc.update(line.id, { analytics_category_id: s.licences, analytics_values: { [s.main]: s.licences } }, undefined, opts);
    const conflict = await refusal(runner, () => svc.update(line.id, { analytics_category_id: s.licences, analytics_values: { [s.main]: s.otherMain } }, undefined, opts));
    assert.equal(conflict.message, CONFLICT);
    assert.equal((conflict as any).getStatus?.(), 400);
    assert.deepEqual(await links(runner, kind, line.id), { [s.main]: s.licences, [s.nature]: s.hardware }, `${kind}: nothing written on a conflict`);

    const wrongDimension = await refusal(runner, () => svc.update(line.id, { analytics_category_id: s.hardware }, undefined, opts));
    assert.equal(wrongDimension.message, 'Hardware is not a value of the analytics dimension.');
    await svc.update(line.id, { analytics_category_id: null }, undefined, opts);
    assert.deepEqual(await links(runner, kind, line.id), { [s.nature]: s.hardware }, `${kind}: legacy null clears the default dimension only`);
  });
}

async function testRefusals(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const line = await svc.create(lineBody(kind, 'Target', { paying_company_id: s.companyId, analytics_values: { [s.main]: s.licences } }), undefined, opts);
    const [stored] = await runner.query(`SELECT * FROM ${ITEM_TABLE[kind]} WHERE id = $1`, [line.id]);
    const linksBefore = await linkCount(runner, kind, s.tenantId);
    const [{ n: linesBefore }] = await runner.query(`SELECT count(*)::int AS n FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`, [s.tenantId]);

    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['value of another dimension', { analytics_values: { [s.main]: s.hardware } }, 'Hardware is not a value of the analytics dimension.'],
      ['default value on Nature', { analytics_values: { [s.nature]: s.licences } }, 'Licences is not a value of the Nature dimension.'],
      ["another tenant's dimension", { analytics_values: { [s.foreignAxis]: s.foreignValue } }, 'Analytics dimension not found.'],
      ["another tenant's value", { analytics_values: { [s.main]: s.foreignValue } }, 'Analytics value not found.'],
      ["another tenant's value, legacy field", { analytics_category_id: s.foreignValue }, 'Analytics category not found.'],
      ['a key that is not an id', { analytics_values: { nature: s.hardware } }, 'Analytics dimension not found.'],
      ['a value that is not an id', { analytics_values: { [s.nature]: 'Hardware' } }, 'Analytics value not found.'],
      ['not a map', { analytics_values: [s.hardware] }, 'Analytics values must map each dimension to a value or null.'],
      ['a disabled dimension', { analytics_values: { [s.old]: s.legacy } }, 'The Old axis dimension is disabled. Enable it or leave it out.'],
      ['a disabled value', { analytics_values: { [s.nature]: s.retired } }, 'This value is disabled.'],
    ];
    for (const [label, fields, message] of cases) {
      const onCreate = await refusal(runner, () => svc.create(lineBody(kind, `Refused: ${label}`, { paying_company_id: s.companyId, ...fields }), undefined, opts));
      assert.equal(onCreate.message, message, `${kind} create, ${label}`);
      assert.equal((onCreate as any).getStatus?.(), 400, `${kind} create, ${label}: a 400`);
      const onUpdate = await refusal(runner, () => svc.update(line.id, fields, undefined, opts));
      assert.equal(onUpdate.message, message, `${kind} update, ${label}`);
    }
    const [{ n: linesAfter }] = await runner.query(`SELECT count(*)::int AS n FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`, [s.tenantId]);
    assert.equal(linesAfter, linesBefore, `${kind}: no line written`);
    assert.equal(await linkCount(runner, kind, s.tenantId), linksBefore, `${kind}: no link written`);
    assert.deepEqual((await runner.query(`SELECT * FROM ${ITEM_TABLE[kind]} WHERE id = $1`, [line.id]))[0], stored, `${kind}: the line is unchanged`);
    assert.deepEqual(await links(runner, kind, line.id), { [s.main]: s.licences });
  });
}

async function testDisabledValueKeptAsCurrent(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const line = await svc.create(lineBody(kind, 'Holds hardware', { paying_company_id: s.companyId, analytics_values: { [s.nature]: s.hardware } }), undefined, opts);
    await disableValue(runner, s.hardware);
    // The current value stays through any update, repeated or not.
    await svc.update(line.id, { notes: 'edited' }, undefined, opts);
    await svc.update(line.id, { analytics_values: { [s.nature]: s.hardware }, notes: 'edited again' }, undefined, opts);
    assert.deepEqual(await links(runner, kind, line.id), { [s.nature]: s.hardware }, `${kind}: the disabled current value is kept`);
    // As a new assignment it is refused, on another line or on the default dimension's line.
    const other = await svc.create(lineBody(kind, 'Other line', { paying_company_id: s.companyId }), undefined, opts);
    const refused = await refusal(runner, () => svc.update(other.id, { analytics_values: { [s.nature]: s.hardware } }, undefined, opts));
    assert.equal(refused.message, 'This value is disabled.');
    // Clearing it is allowed.
    await svc.update(line.id, { analytics_values: { [s.nature]: null } }, undefined, opts);
    assert.deepEqual(await links(runner, kind, line.id), {});
  });
}

async function testDisabledDimensionNoOp(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const message = 'The Old axis dimension is disabled. Enable it or leave it out.';
    const otherLegacy = await seedValue(runner, s.tenantId, s.old, 'Other legacy');
    // A line holding a value of the dimension from before it was disabled.
    const holder = await svc.create(lineBody(kind, 'Holds legacy', { paying_company_id: s.companyId }), undefined, opts);
    await runner.query(
      `INSERT INTO ${LINK_TABLE[kind]} (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
      [s.tenantId, holder.id, s.old, s.legacy],
    );
    // A client echoing the whole map: the unchanged value passes, the other dimensions are written.
    await svc.update(holder.id, { analytics_values: { [s.old]: s.legacy, [s.main]: s.licences } }, undefined, opts);
    assert.deepEqual(await links(runner, kind, holder.id), { [s.old]: s.legacy, [s.main]: s.licences }, `${kind}: the unchanged value is a no-op`);
    for (const [label, value] of [['cleared', null], ['changed', otherLegacy]] as const) {
      const refused = await refusal(runner, () => svc.update(holder.id, { analytics_values: { [s.old]: value } }, undefined, opts));
      assert.equal(refused.message, message, `${kind}: a disabled dimension ${label} is refused`);
    }
    assert.deepEqual(await links(runner, kind, holder.id), { [s.old]: s.legacy, [s.main]: s.licences }, `${kind}: nothing written`);

    // A line without a value there: null is a no-op on create and update, a value is refused.
    const bare = await svc.create(lineBody(kind, 'Bare', { paying_company_id: s.companyId, analytics_values: { [s.old]: null } }), undefined, opts);
    await svc.update(bare.id, { analytics_values: { [s.old]: null, [s.nature]: s.hardware } }, undefined, opts);
    assert.deepEqual(await links(runner, kind, bare.id), { [s.nature]: s.hardware }, `${kind}: null where there is none is a no-op`);
    const onBare = await refusal(runner, () => svc.update(bare.id, { analytics_values: { [s.old]: s.legacy } }, undefined, opts));
    assert.equal(onBare.message, message);
  });
}

async function testChangeAloneIsAnEdit(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const line = await svc.create(lineBody(kind, 'Audited', { paying_company_id: s.companyId, analytics_category_id: s.licences }), undefined, opts);
    const created = svc.audit.entries.find((entry: any) => entry.recordId === line.id && entry.action === 'create');
    assert.deepEqual(created.after.analytics_values, { [s.main]: s.licences }, `${kind}: the create snapshot carries the values`);
    assert.equal(created.after.analytics_category_id, s.licences);

    await runner.query(`UPDATE ${ITEM_TABLE[kind]} SET updated_at = '2020-01-01T00:00:00Z' WHERE id = $1`, [line.id]);
    await svc.update(line.id, { analytics_values: { [s.nature]: s.hardware } }, undefined, opts);
    const [row] = await runner.query(`SELECT updated_at FROM ${ITEM_TABLE[kind]} WHERE id = $1`, [line.id]);
    assert.ok(new Date(row.updated_at).getUTCFullYear() > 2020, `${kind}: updated_at moves`);
    const entry = svc.audit.entries.filter((e: any) => e.recordId === line.id && e.action === 'update').pop();
    assert.ok(entry, `${kind}: an audit row is written`);
    assert.equal(entry.table, ITEM_TABLE[kind]);
    assert.deepEqual(entry.before.analytics_values, { [s.main]: s.licences }, `${kind}: before snapshot`);
    assert.deepEqual(entry.after.analytics_values, { [s.main]: s.licences, [s.nature]: s.hardware }, `${kind}: after snapshot`);
    assert.equal(entry.before.analytics_category_id, s.licences);
    assert.equal(entry.after.analytics_category_id, s.licences);
  });
}

async function testDefaultIsAnIdentity(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    // Rename the default dimension, change its code and put Nature first.
    await runner.query(`UPDATE analytics_axes SET name = 'Catégorie analytique', code = 'cat', sort_order = 5 WHERE id = $1`, [s.main]);
    await runner.query(`UPDATE analytics_axes SET sort_order = 0 WHERE id = $1`, [s.nature]);
    const line = await svc.create(lineBody(kind, 'Reordered', {
      paying_company_id: s.companyId, analytics_category_id: s.licences, analytics_values: { [s.nature]: s.hardware },
    }), undefined, opts);
    assert.deepEqual(await links(runner, kind, line.id), { [s.main]: s.licences, [s.nature]: s.hardware }, `${kind}: the legacy field still writes the default`);
    const detail = await svc.get(line.id, opts);
    assert.deepEqual(detail.analytics_values.map((v: any) => [v.axis_code, v.axis_name, v.is_default]), [
      ['nature', 'Nature', false],
      ['cat', 'Catégorie analytique', true],
    ], `${kind}: dimension order follows the new order`);
    assert.equal(detail.analytics_category_id, s.licences, `${kind}: the default is not a position`);
    const wrong = await refusal(runner, () => svc.update(line.id, { analytics_category_id: s.otherNature }, undefined, opts));
    assert.equal(wrong.message, 'Other is not a value of the Catégorie analytique dimension.');
  });
}

async function testLegacyListReadsTheLinks(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = itemService(kind);
    const opts = { manager: runner.manager };
    const line = await svc.create(lineBody(kind, 'Listed', { paying_company_id: s.companyId, analytics_category_id: s.licences }), undefined, opts);
    // A stale item column (not written any more) is never read.
    await runner.query(`UPDATE ${ITEM_TABLE[kind]} SET analytics_category_id = $2 WHERE id = $1`, [line.id, s.otherMain]);
    const listed = (await svc.list({ limit: 50 }, opts)).items.find((item: any) => item.id === line.id);
    assert.ok(listed, `${kind}: the line is listed`);
    assert.equal(listed.analytics_category_id, s.licences, `${kind}: the list reads the link`);
    assert.equal(listed.analytics_category_name, 'Licences');
    const detail = await svc.get(line.id, opts);
    assert.equal(detail.analytics_category_id, s.licences, `${kind}: the detail reads the link`);
  });
}

/** Removes the committed race tenant: lines (and their links) before values, values before dimensions. */
async function deleteRaceTenant(tenantId: string) {
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (const table of ['spend_items', 'analytics_categories', 'analytics_axes', 'audit_log', 'companies', 'accounts', 'chart_of_accounts']) {
      await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

/**
 * The value is deleted first (its row locked, no line uses it yet); a save
 * that takes it waits on the gate's FOR KEY SHARE read, then finds nothing: a
 * 400. Without the lock the save would pass the gate and fail on the link's
 * foreign key (a database error). The seed is committed (two connections),
 * then removed.
 */
async function testValueDeletedWhileALineTakesIt() {
  const seed = await committed(async (runner) => {
    const tenantId = await seedTenant(runner, 'analytics-race');
    const { companyId } = await seedCompany(runner, tenantId, 'Race company');
    const main = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
    const value = await seedValue(runner, tenantId, main, 'Doomed');
    const [line] = await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id)
       VALUES ($1, 'Race line', 'EUR', '2026-01-01', 1, $2) RETURNING id`,
      [tenantId, companyId],
    );
    return { tenantId, main, value, line: line.id as string };
  });
  const deleter = await openTenantTransaction(seed.tenantId);
  const writer = await openTenantTransaction(seed.tenantId);
  try {
    await deleter.query(`DELETE FROM analytics_categories WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.value]);
    const pid = await backendPid(writer);
    const save = itemService('opex')
      .update(seed.line, { analytics_values: { [seed.main]: seed.value } }, undefined, { manager: writer.manager })
      .then(() => 'saved', (err: any) => err);
    await waitUntilBlocked(pid);
    await deleter.commitTransaction();
    const outcome = await save;
    assert.ok(outcome instanceof BadRequestException, `the save is a 400, not a database error (${outcome?.message ?? outcome})`);
    assert.equal(outcome.message, 'Analytics value not found.');
  } finally {
    await closeRunner(writer);
    await closeRunner(deleter);
    await deleteRaceTenant(seed.tenantId);
  }
}

void runSpecs('item-analytics.integration.spec', KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
  [`upsert per dimension, omission and null (${kind})`, () => testUpsertAndOmission(kind)],
  [`legacy field and conflicts (${kind})`, () => testLegacyField(kind)],
  [`refusals write nothing (${kind})`, () => testRefusals(kind)],
  [`disabled value kept as current (${kind})`, () => testDisabledValueKeptAsCurrent(kind)],
  [`disabled dimension: no-op passes, change refused (${kind})`, () => testDisabledDimensionNoOp(kind)],
  [`a change of values alone is an edit (${kind})`, () => testChangeAloneIsAnEdit(kind)],
  [`the default dimension is an identity (${kind})`, () => testDefaultIsAnIdentity(kind)],
  [`legacy list reads the links (${kind})`, () => testLegacyListReadsTheLinks(kind)],
]).concat([
  ['a value deleted while a line takes it', () => testValueDeletedWhileALineTakesIt()],
])).catch((err) => {
  console.error(err);
  process.exit(1);
});
