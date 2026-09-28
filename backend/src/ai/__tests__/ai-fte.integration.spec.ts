import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiAggregateExecutor } from '../query/ai-aggregate.executor';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { getAiEntityRegistry } from '../query/registries';
import { budgetAmountFields } from '../query/registries/budget-amount-fields';
import { FIXED_SLOTS, SUMMARY_COLUMNS } from '../../spend/spend-summary.builder';
import {
  assert,
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
} from '../../spend/__tests__/round-inputs.fixtures';
import { itemService } from '../../spend/__tests__/cost-center.fixtures';

// FTE in the AI layer, on OPEX and CAPEX, against the database:
// - both registries list 25 FTE fields, `<slot>_<column>_fte`, reading the
//   engine's `fte_<slot><Suffix>` (number, sortable, aggregable), next to the
//   25 amount fields;
// - a query filters and sorts on them and carries them in the metadata;
// - the aggregate sums them exactly (0.1 + 0.2 is 0.3) and reports, per group,
//   the lines whose FTE is unknown;
// - the detail shows them under the AI keys, never the engine's keys.

const Y = new Date().getFullYear();
const KINDS: Kind[] = ['opex', 'capex'];
const ENTITY: Record<Kind, 'spend_items' | 'capex_items'> = { opex: 'spend_items', capex: 'capex_items' };
const ENGINE_KEY = /^fte_/;

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

// Constructor positions (both executors): spendItems 5, contracts 6, capexItems 17.
function queryExecutor(kind: Kind): AiQueryExecutor {
  const args: any[] = Array.from({ length: 23 }, () => ({}));
  args[kind === 'opex' ? 5 : 17] = itemService(kind);
  args[6] = noContracts;
  return new (AiQueryExecutor as any)(...args);
}

function aggregateExecutor(kind: Kind): AiAggregateExecutor {
  const args: any[] = Array.from({ length: 22 }, () => ({}));
  args[kind === 'opex' ? 5 : 17] = itemService(kind);
  return new (AiAggregateExecutor as any)(...args);
}

type Seed = { tenantId: string; items: Record<'alpha' | 'bravo' | 'charlie' | 'delta', string> };

/**
 * Four lines with a Budget of Y, the FTE as a lines write stores it on the
 * round: Alpha 0.1 (1.2 people in March), Bravo 0.2 (2.4 in March), Charlie
 * has a round without lines (unknown), Delta's lines are units only (0).
 */
async function seedFte(runner: QueryRunner, kind: Kind): Promise<Seed> {
  const [budget] = SUMMARY_COLUMNS;
  const tenantId = await seedTenant(runner, `ai-fte-${kind}`);
  const line = async (itemNumber: number, name: string, fte: string | null) => {
    const itemId = await seedItem(runner, kind, tenantId, itemNumber, name);
    const versionId = await seedVersion(runner, kind, tenantId, itemId, Y);
    await seedMonths(runner, kind, tenantId, versionId, Y, { [budget.measure]: [0, 0, 300, ...repeat(0, 9)] });
    await runner.query(
      `INSERT INTO ${TABLES[kind].rounds} (tenant_id, version_id, measure, period_start, period_end, method, fte)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, versionId, budget.measure, period(3, Y), `${Y}-03-31`, fte === null ? 'spread' : 'computed', fte],
    );
    return itemId;
  };
  return {
    tenantId,
    items: {
      alpha: await line(1, 'Alpha line', '0.1'),
      bravo: await line(2, 'Bravo line', '0.2'),
      charlie: await line(3, 'Charlie line', null),
      delta: await line(4, 'Delta line', '0'),
    },
  };
}

async function withFte(kind: Kind, fn: (runner: QueryRunner, seed: Seed) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => fn(runner, await seedFte(runner, kind)));
}

async function testRegistryListsFteFields() {
  for (const kind of KINDS) {
    const registry = getAiEntityRegistry(ENTITY[kind]);
    const fteKeys = Object.keys(registry.fields).filter((key) => key.endsWith('_fte'));
    assert.equal(fteKeys.length, 25, `${kind}: 25 FTE fields`);
    for (const slot of FIXED_SLOTS) {
      for (const column of SUMMARY_COLUMNS) {
        const key = `${slot.ai}_${column.ai}_fte`;
        const field = registry.fields[key];
        assert.deepEqual(
          [field?.grid, field?.type, field?.sortable, field?.aggregable, field?.groupable],
          [`fte_${slot.key}${column.suffix}`, 'number', true, true, false],
          `${kind}: ${key}`,
        );
        assert.equal(registry.sortFields[key], `fte_${slot.key}${column.suffix}`);
      }
    }
    assert.match(registry.fields.y_plus1_review_fte.description, /column 2 \(named Revision by default\) for Y\+1/);
    assert.match(registry.fields.y_budget_fte.description, /null \(unknown\) when the column has no lines for that year/);
  }
  assert.equal(Object.keys(budgetAmountFields()).length, 25, 'the amount fields are unchanged');
}

async function testQueryFilterSortAndMetadata(kind: Kind) {
  await withFte(kind, async (runner, seed) => {
    const ctx = context(runner, seed.tenantId);
    const query = queryExecutor(kind);
    const labels = (result: any) => result.items.map((item: any) => item.label);

    const counted: any = await query.execute(ctx, { entity_type: ENTITY[kind], filters: { y_budget_fte: { op: 'gt', value: 0 } } });
    assert.deepEqual(labels(counted).sort(), ['Alpha line', 'Bravo line'], `${kind}: filter on FTE`);
    assert.deepEqual(counted.filters_applied, ['y_budget_fte']);
    const zero: any = await query.execute(ctx, { entity_type: ENTITY[kind], filters: { y_budget_fte: { op: 'eq', value: 0 } } });
    assert.deepEqual(labels(zero), ['Delta line'], `${kind}: unknown is not 0`);

    const sorted: any = await query.execute(ctx, { entity_type: ENTITY[kind], sort: { field: 'y_budget_fte', direction: 'desc' } });
    const fteByLabel = Object.fromEntries(sorted.items.map((item: any) => [item.label, item.metadata.y_budget_fte]));
    assert.deepEqual(fteByLabel, { 'Alpha line': 0.1, 'Bravo line': 0.2, 'Charlie line': null, 'Delta line': 0 }, `${kind}: metadata under the AI key`);
    const known = sorted.items.filter((item: any) => item.metadata.y_budget_fte != null).map((item: any) => item.label);
    assert.deepEqual(known, ['Bravo line', 'Alpha line', 'Delta line'], `${kind}: sort descending on FTE`);
    const metadata = sorted.items[0].metadata;
    assert.equal(Object.keys(metadata).filter((key) => key.endsWith('_fte')).length, 25, `${kind}: every fixed year and column`);
    assert.equal(Object.keys(metadata).some((key) => ENGINE_KEY.test(key)), false, `${kind}: no engine key`);
  });
}

async function testAggregateIsExact(kind: Kind) {
  await withFte(kind, async (runner, seed) => {
    const ctx = context(runner, seed.tenantId);
    const aggregate = aggregateExecutor(kind);
    const run = (fn: string) => aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'currency', metric: 'y_budget_fte', function: fn as any });

    const summed: any = await run('sum');
    assert.deepEqual(summed.groups, [{ key: 'EUR', value: 0.3, unknown: 1 }], `${kind}: 0.1 + 0.2 + 0 is exactly 0.3, one line unknown`);
    assert.equal(summed.metric, 'y_budget_fte');
    assert.equal(summed.complete, true);
    assert.deepEqual((await run('avg') as any).groups, [{ key: 'EUR', value: 0.1, unknown: 1 }], `${kind}: the mean of the known lines`);
    assert.deepEqual((await run('min') as any).groups, [{ key: 'EUR', value: 0, unknown: 1 }]);
    assert.deepEqual((await run('max') as any).groups, [{ key: 'EUR', value: 0.2, unknown: 1 }]);

    // A group whose lines are all unknown keeps its count and has no value.
    const unknownOnly: any = await aggregate.execute(ctx, {
      entity_type: ENTITY[kind], group_by: 'currency', metric: 'y_plus1_budget_fte', function: 'sum',
    });
    assert.deepEqual(unknownOnly.groups, [{ key: 'EUR', value: null, unknown: 4 }], `${kind}: no version for Y+1`);

    // The amount metrics keep their shape.
    const amounts: any = await aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'currency', metric: 'y_budget', function: 'sum' });
    assert.deepEqual(amounts.groups, [{ key: 'EUR', value: 1200 }], `${kind}: amount sums unchanged`);
  });
}

async function testDetailUsesAiKeys(kind: Kind) {
  await withFte(kind, async (runner, seed) => {
    const detail: any = await queryExecutor(kind).executeDetail(context(runner, seed.tenantId), { entity_type: ENTITY[kind], entity_id: seed.items.alpha });
    assert.equal(detail.entity.metadata.y_budget_fte, 0.1, `${kind}: detail metadata`);
    assert.equal(detail.data.y_budget_fte, 0.1, `${kind}: detail data under the AI key`);
    assert.equal(detail.data.y_forecast_fte, null, `${kind}: a column without a round is unknown`);
    for (const data of [detail.data, detail.data.financial_summary]) {
      assert.equal(Object.keys(data).some((key) => ENGINE_KEY.test(key)), false, `${kind}: no engine key in the detail`);
    }
  });
}

void runSpecs('ai-fte.integration.spec', [
  ['registry lists the FTE fields', testRegistryListsFteFields],
  ...KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
    [`query filter, sort and metadata (${kind})`, () => testQueryFilterSortAndMetadata(kind)],
    [`aggregate is exact with the unknown count (${kind})`, () => testAggregateIsExact(kind)],
    [`detail uses the AI keys (${kind})`, () => testDetailUsesAiKeys(kind)],
  ]),
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
