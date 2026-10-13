import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { getAiEntityRegistry } from '../query/registries';
import { AiBusinessRecordMutationSupportService } from '../mutation/ai-business-record-mutation-support.service';
import { AiExecutionContextWithManager } from '../ai.types';
import { inRolledBackTransaction, Kind, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { disableCostCenter, itemService, seedCompany, seedCostCenter } from '../../spend/__tests__/cost-center.fixtures';

// Cost center and run or build in the AI layer, on OPEX and CAPEX:
// - both registries declare cost_center (set, dynamic, groupable, joined on
//   the tenant), cost_center_path (text, groupable), budget_holder (set,
//   dynamic, groupable, the cost center and the user both joined on the
//   tenant) and run_build (set with a blank value);
// - a create or update mutation sets cost_center_id from a code (or a name),
//   refuses another tenant's code as not found, refuses a group or a disabled
//   node as a new value, keeps a disabled current value; the executed create
//   stores the cost center.

const KINDS: Kind[] = ['opex', 'capex'];
const ENTITY: Record<Kind, 'spend_items' | 'capex_items'> = { opex: 'spend_items', capex: 'capex_items' };
/** Both natures are lines of `spend_items` since lot Z1. */
const LINE_TABLE = 'spend_items';

function testRegistries() {
  for (const kind of KINDS) {
    const registry = getAiEntityRegistry(ENTITY[kind]);
    const alias = registry.aggregate!.alias;
    assert.deepEqual(
      [registry.fields.cost_center?.grid, registry.fields.cost_center?.type, registry.fields.cost_center?.dynamic, registry.fields.cost_center?.groupable],
      ['cost_center_label', 'set', true, true],
      `${kind}: cost_center`,
    );
    assert.deepEqual([registry.fields.cost_center_path?.type, registry.fields.cost_center_path?.groupable], ['text', true], `${kind}: cost_center_path`);
    assert.deepEqual(registry.fields.run_build?.values, ['run', 'build', null], `${kind}: run_build lists the blank value`);
    assert.equal(registry.sortFields.cost_center, 'cost_center_label');
    assert.equal(registry.sortFields.run_build, 'run_build');
    const join = registry.aggregate!.groupFields.cost_center.joins!.join(' ');
    assert.ok(join.includes(`cc.tenant_id = ${alias}.tenant_id`), `${kind}: the cost center join names the tenant`);
    const holder = registry.fields.budget_holder;
    assert.deepEqual(
      [holder?.grid, holder?.type, holder?.dynamic, holder?.discoverable, holder?.sortable, holder?.groupable],
      ['budget_holder_name', 'set', true, true, true, true],
      `${kind}: budget_holder`,
    );
    assert.equal(registry.sortFields.budget_holder, 'budget_holder_name');
    const holderJoin = registry.aggregate!.groupFields.budget_holder.joins!.join(' ');
    assert.ok(holderJoin.includes(`cc_bh.tenant_id = ${alias}.tenant_id`), `${kind}: the budget holder's cost center join names the tenant`);
    assert.ok(holderJoin.includes('u_bh.tenant_id = cc_bh.tenant_id'), `${kind}: the budget holder's user join names the tenant`);
  }
}

function mutationSupport(): any {
  return new AiBusinessRecordMutationSupportService(
    {} as any, {} as any, {} as any, itemService('capex'), {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    itemService('opex'), {} as any,
  );
}

function context(runner: QueryRunner, tenantId: string): AiExecutionContextWithManager {
  return {
    tenantId,
    userId: null as any,
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    conversationId: 'cost-center-spec',
    manager: runner.manager,
  } as AiExecutionContextWithManager;
}

function createFields(kind: Kind, company: string, extra: Record<string, unknown>) {
  const base = kind === 'opex'
    ? { product_name: 'AI line', paying_company: company, currency: 'EUR', effective_start: '2026-01-01' }
    : { description: 'AI line', paying_company: company, currency: 'EUR', effective_start: '2026-01-01' };
  return { ...base, ...extra };
}

async function rejection(runner: QueryRunner, fn: () => Promise<unknown>): Promise<string> {
  await runner.query('SAVEPOINT ai_cost_center');
  try {
    await fn();
  } catch (err) {
    await runner.query('ROLLBACK TO SAVEPOINT ai_cost_center');
    return (err as Error).message;
  }
  await runner.query('ROLLBACK TO SAVEPOINT ai_cost_center');
  throw new Error('expected the mutation to be refused');
}

async function testMutations(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const other = await seedTenant(runner, `ai-cc-other-${kind}`);
    const otherCompany = await seedCompany(runner, other, 'AI other company');
    await seedCostCenter(runner, other, { code: 'ELSEWHERE-1', name: 'Elsewhere', companyId: otherCompany.companyId });

    const tenantId = await seedTenant(runner, `ai-cc-${kind}`);
    await setTenant(runner, tenantId);
    await seedCompany(runner, tenantId, 'AI company');
    const [{ id: companyId }] = await runner.query(`SELECT id FROM companies WHERE tenant_id = $1`, [tenantId]);
    const costCenterId = await seedCostCenter(runner, tenantId, { code: 'AI-1', name: 'AI cost center', companyId });
    await seedCostCenter(runner, tenantId, { code: 'AI-GRP', name: 'AI group', kind: 'group' });
    const retired = await seedCostCenter(runner, tenantId, { code: 'AI-OLD', name: 'AI retired', companyId });

    const support = mutationSupport();
    const ctx = context(runner, tenantId);
    const entity_type = ENTITY[kind];

    const prepared = await support.prepareCreatePreview(ctx, { entity_type, fields: createFields(kind, 'AI company', { cost_center: 'ai-1', run_build: 'Build' }) });
    const fields = prepared.mutationInput.fields as Record<string, unknown>;
    assert.equal(fields.cost_center_id, costCenterId, `${kind}: the code resolves to the cost center`);
    assert.equal(fields.run_build, 'build');
    assert.equal((prepared.mutationInput.display_values as any).cost_center_id, 'AI-1 · AI cost center');

    const created: any = await support['createRecord'](ctx, entity_type, fields);
    const [row] = await runner.query(`SELECT cost_center_id, run_build::text AS run_build FROM ${LINE_TABLE} WHERE id = $1 AND nature = $2`, [created.id, kind]);
    assert.deepEqual(row, { cost_center_id: costCenterId, run_build: 'build' }, `${kind}: the executed create stores both`);

    assert.equal(
      await rejection(runner, () => support.prepareCreatePreview(ctx, { entity_type, fields: createFields(kind, 'AI company', { cost_center: 'ELSEWHERE-1' }) })),
      'Cost center not found.',
      `${kind}: another tenant's code is not found`,
    );
    assert.equal(
      await rejection(runner, () => support.prepareCreatePreview(ctx, { entity_type, fields: createFields(kind, 'AI company', { cost_center: 'AI-GRP' }) })),
      'Choose a cost center, not a group.',
    );
    await disableCostCenter(runner, retired);
    assert.equal(
      await rejection(runner, () => support.prepareCreatePreview(ctx, { entity_type, fields: createFields(kind, 'AI company', { cost_center: 'AI-OLD' }) })),
      'This cost center is disabled.',
    );

    // A line whose cost center was disabled afterwards keeps it; another change goes through.
    await runner.query(`UPDATE ${LINE_TABLE} SET cost_center_id = $2 WHERE id = $1 AND nature = $3`, [created.id, retired, kind]);
    const update = await support.prepareUpdatePreview(ctx, { entity_type, ref: created.id, fields: { cost_center: 'AI-OLD', run_build: null } });
    assert.deepEqual(update.mutationInput.fields, { run_build: null }, `${kind}: the kept cost center is not a change`);
  });
}

async function main() {
  testRegistries();
  await dataSource.initialize();
  try {
    for (const kind of KINDS) await testMutations(kind);
  } finally {
    await dataSource.destroy();
  }
  console.log('ai-item-cost-center.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
