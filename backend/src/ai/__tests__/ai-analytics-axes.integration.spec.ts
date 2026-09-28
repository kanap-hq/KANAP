import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { AnalyticsCategoriesService } from '../../analytics/analytics-categories.service';
import { AiToolRegistry } from '../ai-tool.registry';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiAggregateExecutor } from '../query/ai-aggregate.executor';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { getAiEntityRegistry, resolveAiEntityRegistry } from '../query/registries';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import { captureAudit, assert, inRolledBackTransaction, Kind, runSpecs, seedItem, seedTenant, setTenant, TABLES } from '../../spend/__tests__/round-inputs.fixtures';
import { itemService } from '../../spend/__tests__/cost-center.fixtures';

// Analytics dimensions in the AI layer, on OPEX and CAPEX, against the database:
// - the registry resolved for a tenant lists one `analytics:<code>` field per
//   enabled non-default dimension (set, dynamic, sortable, groupable), after
//   `analytics_category`; a disabled dimension, the default one and another
//   tenant's dimensions are absent; the describe tool lists them;
// - a query filters, sorts and carries metadata on `analytics:<code>`, the
//   aggregate groups on it, get_filter_values lists its values; the detail
//   shows it under the AI key, never the engine's per-id keys;
// - `analytics_category` keeps addressing the default dimension after a rename,
//   a new code and a reorder; its SQL group join reads the link with a tenant
//   predicate on every join (a stale legacy column is ignored);
// - the `analytics_categories` entity carries its dimension (`axis`, `axis_code`).

const KINDS: Kind[] = ['opex', 'capex'];
const ENTITY: Record<Kind, 'spend_items' | 'capex_items'> = { opex: 'spend_items', capex: 'capex_items' };
const PER_ID_KEY = /^analytics_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function context(runner: QueryRunner, tenantId: string): AiExecutionContextWithManager {
  return {
    tenantId,
    userId: null as any,
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    manager: runner.manager,
  } as AiExecutionContextWithManager;
}

const noContracts = { listContractsForSpendItem: async () => ({ items: [] }), listContractsForCapexItem: async () => ({ items: [] }) };

function categoriesService(): any {
  // Every AI call passes the request manager; the repository is never used.
  return new (AnalyticsCategoriesService as any)({}, captureAudit());
}

// Constructor positions (both executors): spendItems 5, contracts 6, analyticsCategories 15, capexItems 17.
function queryExecutor(kind: Kind): AiQueryExecutor {
  const args: any[] = Array.from({ length: 23 }, () => ({}));
  args[kind === 'opex' ? 5 : 17] = itemService(kind);
  args[6] = noContracts;
  args[15] = categoriesService();
  return new (AiQueryExecutor as any)(...args);
}

function aggregateExecutor(kind: Kind): AiAggregateExecutor {
  const args: any[] = Array.from({ length: 22 }, () => ({}));
  args[kind === 'opex' ? 5 : 17] = itemService(kind);
  args[15] = categoriesService();
  return new (AiAggregateExecutor as any)(...args);
}

async function insertAxis(runner: QueryRunner, tenantId: string, code: string, name: string | null, opts: { isDefault?: boolean; order?: number; disabled?: boolean } = {}) {
  const [row] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, is_default, sort_order, status, disabled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [tenantId, code, name, opts.isDefault ?? false, opts.order ?? 0, opts.disabled ? 'disabled' : 'enabled', opts.disabled ? new Date(Date.now() - 86_400_000) : null],
  );
  return row.id as string;
}

async function insertValue(runner: QueryRunner, tenantId: string, axisId: string, name: string) {
  const [row] = await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, axisId, name]);
  return row.id as string;
}

type Seed = Awaited<ReturnType<typeof seedDimensions>>;

/**
 * Tenant A: the default dimension (no name), Nature (enabled, second) and
 * Archive (disabled); Alpha holds Licences / Subscriptions / Old, Bravo
 * Services / Maintenance, Charlie nothing but a stale legacy column
 * (Licences). Tenant B: its own default dimension and Region.
 */
async function seedDimensions(runner: QueryRunner, kind: Kind) {
  const other = await seedTenant(runner, `ai-axes-b-${kind}`);
  const otherDefault = await insertAxis(runner, other, 'default', null, { isDefault: true });
  const region = await insertAxis(runner, other, 'region', 'Region', { order: 1 });
  await insertValue(runner, other, otherDefault, 'Licences');

  const tenantId = await seedTenant(runner, `ai-axes-a-${kind}`);
  const defaultAxis = await insertAxis(runner, tenantId, 'default', null, { isDefault: true });
  const nature = await insertAxis(runner, tenantId, 'nature', 'Nature', { order: 1 });
  const archive = await insertAxis(runner, tenantId, 'archive', 'Archive', { order: 2, disabled: true });
  const licences = await insertValue(runner, tenantId, defaultAxis, 'Licences');
  const services = await insertValue(runner, tenantId, defaultAxis, 'Services');
  const subscriptions = await insertValue(runner, tenantId, nature, 'Subscriptions');
  const maintenance = await insertValue(runner, tenantId, nature, 'Maintenance');
  const old = await insertValue(runner, tenantId, archive, 'Old');
  const alpha = await seedItem(runner, kind, tenantId, 1, 'Alpha line');
  const bravo = await seedItem(runner, kind, tenantId, 2, 'Bravo line');
  const charlie = await seedItem(runner, kind, tenantId, 3, 'Charlie line');
  const link = SUMMARY_SCOPES[kind].analyticsLink.table;
  for (const [itemId, axisId, categoryId] of [
    [alpha, defaultAxis, licences], [alpha, nature, subscriptions], [alpha, archive, old],
    [bravo, defaultAxis, services], [bravo, nature, maintenance],
  ]) {
    await runner.query(`INSERT INTO ${link} (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [tenantId, itemId, axisId, categoryId]);
  }
  await runner.query(`UPDATE ${TABLES[kind].items} SET analytics_category_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, charlie, licences]);
  return { tenantId, other, region, defaultAxis, nature, archive, items: { alpha, bravo, charlie } };
}

async function withDimensions(kind: Kind, fn: (runner: QueryRunner, seed: Seed) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedDimensions(runner, kind);
    await fn(runner, seed);
  });
}

async function testResolvedRegistry(kind: Kind) {
  await withDimensions(kind, async (runner, seed) => {
    const registry = await resolveAiEntityRegistry(context(runner, seed.tenantId), ENTITY[kind]);
    const nature = registry.fields['analytics:nature'];
    assert.deepEqual(
      [nature?.grid, nature?.type, nature?.dynamic, nature?.discoverable, nature?.sortable, nature?.groupable],
      [`analytics_${seed.nature}`, 'set', true, true, true, true],
      `${kind}: an enabled dimension is a field`,
    );
    assert.match(nature.description, /Nature/, `${kind}: described by its name`);
    assert.equal(registry.sortFields['analytics:nature'], `analytics_${seed.nature}`);
    const analyticsKeys = Object.keys(registry.fields).filter((key) => key.startsWith('analytics'));
    assert.deepEqual(analyticsKeys, ['analytics_category', 'analytics:nature'], `${kind}: no disabled, default or other tenant's dimension; right after analytics_category`);
    assert.equal(registry.fields.analytics_category.grid, 'analytics_category_name', `${kind}: the default dimension keeps its field`);
    assert.equal(Object.keys(getAiEntityRegistry(ENTITY[kind]).fields).some((key) => key.startsWith('analytics:')), false, `${kind}: the static registry is untouched`);

    await setTenant(runner, seed.other);
    const other = await resolveAiEntityRegistry(context(runner, seed.other), ENTITY[kind]);
    assert.deepEqual(Object.keys(other.fields).filter((key) => key.startsWith('analytics:')), ['analytics:region'], `${kind}: each tenant its own dimensions`);
    await setTenant(runner, seed.tenantId);

    const tasks = await resolveAiEntityRegistry(context(runner, seed.tenantId), 'tasks');
    assert.equal(tasks, getAiEntityRegistry('tasks'), 'other entity types: the static registry');
  });
}

async function testDescribeListsDimensions(kind: Kind) {
  await withDimensions(kind, async (runner, seed) => {
    const args: any[] = Array.from({ length: 9 }, () => undefined);
    args[2] = { assertEntityTypeReadAccess: async () => undefined };
    args[8] = { listOperations: () => [] };
    const describe = (new (AiToolRegistry as any)(...args) as any).definitions.get('describe_entity_filters');
    const result = await describe.execute(context(runner, seed.tenantId), { entity_type: ENTITY[kind] });
    const fields = result.fields.map((field: any) => field.field);
    assert.ok(fields.includes('analytics:nature'), `${kind}: describe lists the dimension`);
    assert.equal(fields.includes('analytics:archive'), false, `${kind}: not the disabled one`);
    const nature = result.fields.find((field: any) => field.field === 'analytics:nature');
    assert.deepEqual([nature.type, nature.discoverable, nature.groupable, nature.sortable], ['set', true, true, true]);
  });
}

async function testQueryAggregateAndValues(kind: Kind) {
  await withDimensions(kind, async (runner, seed) => {
    const ctx = context(runner, seed.tenantId);
    const entityType = ENTITY[kind];
    const query = queryExecutor(kind);

    const filtered: any = await query.execute(ctx, { entity_type: entityType, filters: { 'analytics:nature': ['Maintenance'] } });
    assert.deepEqual(filtered.items.map((item: any) => item.label), ['Bravo line'], `${kind}: filter on a dimension`);
    assert.deepEqual(filtered.filters_applied, ['analytics:nature']);
    const blanks: any = await query.execute(ctx, { entity_type: entityType, filters: { 'analytics:nature': [null] } });
    assert.deepEqual(blanks.items.map((item: any) => item.label), ['Charlie line'], `${kind}: filter on a line without value`);

    const sorted: any = await query.execute(ctx, { entity_type: entityType, sort: { field: 'analytics:nature', direction: 'asc' } });
    assert.deepEqual(sorted.items.map((item: any) => item.label), ['Bravo line', 'Alpha line', 'Charlie line'], `${kind}: sort on a dimension, blanks last`);
    const alpha = sorted.items.find((item: any) => item.label === 'Alpha line').metadata;
    assert.equal(alpha['analytics:nature'], 'Subscriptions', `${kind}: metadata under the AI key`);
    assert.equal(alpha.analytics_category, 'Licences');
    assert.equal(Object.keys(alpha).some((key) => key === 'analytics:archive' || PER_ID_KEY.test(key)), false, `${kind}: no disabled dimension, no per-id key`);

    const disabled: any = await query.execute(ctx, { entity_type: entityType, filters: { 'analytics:archive': ['Old'] } });
    assert.equal(disabled.status, 'invalid_filter', `${kind}: a disabled dimension is not a field`);
    assert.deepEqual(disabled.filters_ignored, ['analytics:archive']);

    const values: any = await query.executeFilterValues(ctx, { entity_type: entityType, fields: ['analytics:nature', 'analytics_category'] });
    assert.deepEqual(values.values['analytics:nature'], ['Maintenance', 'Subscriptions', null], `${kind}: filter values of a dimension`);
    assert.deepEqual(values.values.analytics_category, ['Licences', 'Services', null], `${kind}: the default dimension from the links`);

    const aggregate = aggregateExecutor(kind);
    const grouped: any = await aggregate.execute(ctx, { entity_type: entityType, group_by: 'analytics:nature', function: 'count' });
    const counts = (result: any) => Object.fromEntries(result.groups.map((group: any) => [group.key ?? '(none)', group.count]));
    assert.deepEqual(counts(grouped), { Maintenance: 1, Subscriptions: 1, '(none)': 1 }, `${kind}: group by a dimension`);
    assert.equal(grouped.complete, true);
    const narrowed: any = await aggregate.execute(ctx, {
      entity_type: entityType, group_by: 'analytics_category', function: 'count', filters: { 'analytics:nature': ['Subscriptions', 'Maintenance'] },
    });
    assert.deepEqual(counts(narrowed), { Licences: 1, Services: 1 }, `${kind}: filter on a dimension, group by the default`);
    await assert.rejects(
      () => aggregate.execute(ctx, { entity_type: entityType, group_by: 'analytics:archive', function: 'count' }),
      /Unsupported group_by field/,
      `${kind}: no grouping on a disabled dimension`,
    );

    const detail: any = await query.executeDetail(ctx, { entity_type: entityType, entity_id: seed.items.alpha });
    assert.equal(detail.entity.metadata['analytics:nature'], 'Subscriptions', `${kind}: detail metadata`);
    assert.equal(detail.data['analytics:nature'], 'Subscriptions', `${kind}: detail data under the AI key`);
    assert.equal(detail.data.analytics_category_name, 'Licences');
    for (const data of [detail.data, detail.data.financial_summary]) {
      assert.equal(Object.keys(data).some((key) => PER_ID_KEY.test(key) || key === 'analytics_value_ids'), false, `${kind}: no per-id key in the detail`);
    }
  });
}

async function testDefaultSurvivesRenameAndReorder(kind: Kind) {
  await withDimensions(kind, async (runner, seed) => {
    await runner.query(
      `UPDATE analytics_axes SET name = 'Catégorie analytique', code = 'categorie', sort_order = 5 WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.defaultAxis],
    );
    await runner.query(`UPDATE analytics_axes SET sort_order = 0 WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.nature]);
    const ctx = context(runner, seed.tenantId);
    const registry = await resolveAiEntityRegistry(ctx, ENTITY[kind]);
    assert.deepEqual(Object.keys(registry.fields).filter((key) => key.startsWith('analytics')), ['analytics_category', 'analytics:nature'], `${kind}: the default never becomes a code field`);
    assert.equal(registry.fields.analytics_category.grid, 'analytics_category_name');
    assert.match(registry.fields.analytics_category.description, /Catégorie analytique/, `${kind}: the tenant's name for it`);

    const grouped: any = await aggregateExecutor(kind).execute(ctx, { entity_type: ENTITY[kind], group_by: 'analytics_category', function: 'count' });
    const counts = Object.fromEntries(grouped.groups.map((group: any) => [group.key ?? '(none)', group.count]));
    assert.deepEqual(counts, { Licences: 1, Services: 1, '(none)': 1 }, `${kind}: analytics_category still groups by the default`);
    const filtered: any = await queryExecutor(kind).execute(ctx, { entity_type: ENTITY[kind], filters: { analytics_category: ['Licences'] } });
    assert.deepEqual(filtered.items.map((item: any) => item.label), ['Alpha line'], `${kind}: and filters on it (the stale column ignored)`);
  });
}

async function testDefaultSqlJoin(kind: Kind) {
  await withDimensions(kind, async (runner, seed) => {
    const registry = await resolveAiEntityRegistry(context(runner, seed.tenantId), ENTITY[kind]);
    const alias = registry.aggregate.alias;
    const group = registry.aggregate.groupFields.analytics_category;
    const joins = group.joins ?? [];
    assert.equal(joins.length, 3);
    assert.ok(joins[0].includes(`ax_def.tenant_id = ${alias}.tenant_id`) && joins[0].includes('ax_def.is_default'), `${kind}: the default dimension of the tenant`);
    assert.ok(joins[1].includes(`av_def.tenant_id = ${alias}.tenant_id`) && joins[1].includes(`av_def.item_id = ${alias}.id`), `${kind}: the link of the line, on the tenant`);
    assert.ok(joins[1].includes(SUMMARY_SCOPES[kind].analyticsLink.table), `${kind}: the scope's link table`);
    assert.ok(joins[2].includes('ac.tenant_id = av_def.tenant_id'), `${kind}: the value on the tenant`);
    assert.equal(joins.join(' ').includes('analytics_category_id'), false, `${kind}: never the legacy column`);

    const rows: Array<{ key: string | null; count: number }> = await runner.query(
      `SELECT ${group.expression} AS key, COUNT(*)::int AS count
       FROM ${registry.aggregate.baseTable} ${alias}
       ${joins.join('\n')}
       WHERE ${alias}.tenant_id = $1
       GROUP BY 1 ORDER BY 1 NULLS LAST`,
      [seed.tenantId],
    );
    assert.deepEqual(rows, [{ key: 'Licences', count: 1 }, { key: 'Services', count: 1 }, { key: null, count: 1 }], `${kind}: the SQL group field reads the links`);
  });
}

async function testCategoriesEntityCarriesDimension() {
  await withDimensions('opex', async (runner, seed) => {
    const ctx = context(runner, seed.tenantId);
    const registry = getAiEntityRegistry('analytics_categories');
    assert.deepEqual([registry.fields.axis?.type, registry.fields.axis?.discoverable, registry.fields.axis?.groupable], ['set', true, true]);
    assert.deepEqual([registry.fields.axis_code?.type, registry.fields.axis_code?.discoverable, registry.fields.axis_code?.groupable], ['set', true, true]);
    assert.ok(registry.aggregate.groupFields.axis.joins!.every((join) => join.includes('ax.tenant_id = ac.tenant_id')), 'the dimension joined on the tenant');

    const values: any = await queryExecutor('opex').executeFilterValues(ctx, { entity_type: 'analytics_categories', fields: ['axis', 'axis_code'] });
    assert.deepEqual(values.values.axis, ['Analytics dimension', 'Archive', 'Nature'], 'dimension names, the unnamed default under the product label');
    assert.deepEqual(values.values.axis_code, ['archive', 'default', 'nature']);

    const listed: any = await queryExecutor('opex').execute(ctx, { entity_type: 'analytics_categories', sort: { field: 'name', direction: 'asc' } });
    const metadata = Object.fromEntries(listed.items.map((item: any) => [item.label, [item.metadata.axis, item.metadata.axis_code]]));
    assert.deepEqual(metadata.Maintenance, ['Nature', 'nature'], 'a value carries its dimension');
    assert.deepEqual(metadata.Licences, ['Analytics dimension', 'default']);

    const labels = (result: any) => result.items.map((item: any) => item.label);
    const ofNature: any = await queryExecutor('opex').execute(ctx, { entity_type: 'analytics_categories', filters: { axis: ['Nature'] }, sort: { field: 'name', direction: 'asc' } });
    assert.deepEqual(labels(ofNature), ['Maintenance', 'Subscriptions'], 'the values of one dimension, by name');
    const ofDefault: any = await queryExecutor('opex').execute(ctx, { entity_type: 'analytics_categories', filters: { axis_code: ['default'] }, sort: { field: 'name', direction: 'asc' } });
    assert.deepEqual(labels(ofDefault), ['Licences', 'Services'], 'the values of one dimension, by code');
    const unnamed: any = await queryExecutor('opex').execute(ctx, { entity_type: 'analytics_categories', filters: { axis: ['Analytics dimension'] }, sort: { field: 'name', direction: 'asc' } });
    assert.deepEqual(labels(unnamed), ['Licences', 'Services'], 'the unnamed default under the label get_filter_values lists');

    const grouped: any = await aggregateExecutor('opex').execute(ctx, { entity_type: 'analytics_categories', group_by: 'axis_code', function: 'count' });
    const counts = Object.fromEntries(grouped.groups.map((group: any) => [group.key, group.count]));
    assert.deepEqual(counts, { default: 2, nature: 2, archive: 1 }, 'values grouped by dimension');
    const narrowed: any = await aggregateExecutor('opex').execute(ctx, { entity_type: 'analytics_categories', group_by: 'axis', function: 'count', filters: { axis_code: ['nature', 'archive'] } });
    assert.deepEqual(Object.fromEntries(narrowed.groups.map((group: any) => [group.key, group.count])), { Nature: 2, Archive: 1 }, 'filtered and grouped by dimension');
  });
}

void runSpecs('ai-analytics-axes.integration.spec', [
  ...KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
    [`resolved registry (${kind})`, () => testResolvedRegistry(kind)],
    [`describe lists the dimensions (${kind})`, () => testDescribeListsDimensions(kind)],
    [`query, aggregate and values on a dimension (${kind})`, () => testQueryAggregateAndValues(kind)],
    [`default survives rename and reorder (${kind})`, () => testDefaultSurvivesRenameAndReorder(kind)],
    [`default SQL group join (${kind})`, () => testDefaultSqlJoin(kind)],
  ]),
  ['analytics_categories carries its dimension', testCategoriesEntityCarriesDimension],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});

