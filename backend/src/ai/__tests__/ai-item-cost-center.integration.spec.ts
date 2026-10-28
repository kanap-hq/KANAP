import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { getAiEntityRegistry } from '../query/registries';
import { AiBusinessRecordMutationSupportService } from '../mutation/ai-business-record-mutation-support.service';
import { AiExecutionContextWithManager } from '../ai.types';
import { inRolledBackTransaction, Kind, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { disableCostCenter, itemService, seedCompany, seedCostCenter } from '../../spend/__tests__/cost-center.fixtures';
import { ContractsService } from '../../contracts/contracts.service';
import { budgetService } from '../../spend/__tests__/budget-lines.fixtures';
import { Contract } from '../../contracts/contract.entity';
import { ContractSpendItem } from '../../contracts/contract-spend-item.entity';
import { ContractLink } from '../../contracts/contract-link.entity';
import { ContractAttachment } from '../../contracts/contract-attachment.entity';

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
const ENTITY: Record<Kind, 'budget_lines'> = { opex: 'budget_lines', capex: 'budget_lines' };
/** Both natures are lines of `spend_items`. */
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

function mutationSupport(runner: QueryRunner, contracts: any = {}): any {
  return new AiBusinessRecordMutationSupportService(
    {} as any, {} as any, {} as any, budgetService(runner), {} as any, contracts, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
}

/** The contract service the AI mutation support calls, on the spec's transaction manager. */
function contractService(runner: QueryRunner): ContractsService {
  const none = undefined as any;
  return new ContractsService(
    runner.manager.getRepository(Contract),
    runner.manager.getRepository(ContractSpendItem),
    runner.manager.getRepository(ContractLink),
    runner.manager.getRepository(ContractAttachment),
    { log: async () => undefined } as any,
    none,
    none,
    { syncFromSupplier: async () => undefined, syncFromSupplierForItem: async () => undefined } as any,
    { notifyStatusChange: () => undefined } as any,
    none,
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
  return {
    nature: kind,
    product_name: 'AI line',
    paying_company: company,
    currency: 'EUR',
    effective_start: '2026-01-01',
    ...extra,
  };
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

    const support = mutationSupport(runner);
    const ctx = context(runner, tenantId);
    const entity_type = 'budget_lines';

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

function testContractRegistry() {
  const registry = getAiEntityRegistry('contracts');
  assert.deepEqual(
    [registry.fields.cost_center?.grid, registry.fields.cost_center?.type, registry.fields.cost_center?.dynamic, registry.fields.cost_center?.groupable],
    ['cost_center_name', 'set', true, true],
    'contracts: cost_center',
  );
  assert.equal(registry.sortFields.cost_center, 'cost_center_name');
  const join = registry.aggregate!.groupFields.cost_center.joins!.join(' ');
  assert.ok(join.includes('cc.tenant_id = c.tenant_id'), 'the cost center join names the tenant');
}

async function testContractMutation() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'ai-cc-contract');
    await setTenant(runner, tenantId);
    await seedCompany(runner, tenantId, 'AI company');
    const [{ id: companyId }] = await runner.query(`SELECT id FROM companies WHERE tenant_id = $1`, [tenantId]);
    const supplierId = (await runner.query(
      `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'AI supplier') RETURNING id`, [tenantId],
    ))[0].id;
    const costCenterId = await seedCostCenter(runner, tenantId, { code: 'AI-1', name: 'AI cost center', companyId });
    const groupId = await seedCostCenter(runner, tenantId, { code: 'AI-GRP', name: 'AI group', kind: 'group' });
    const retired = await seedCostCenter(runner, tenantId, { code: 'AI-OLD', name: 'AI retired', companyId });
    await disableCostCenter(runner, retired);

    const support = mutationSupport(runner, contractService(runner));
    const ctx = context(runner, tenantId);
    const fields = (costCenter: unknown) => ({
      name: `AI contract ${String(costCenter ?? 'none')}`,
      company: 'AI company',
      supplier: 'AI supplier',
      start_date: '2026-01-01',
      ...(costCenter === undefined ? {} : { cost_center: costCenter }),
    });

    const prepared = await support.prepareCreatePreview(ctx, { entity_type: 'contracts', fields: fields('ai-1') });
    assert.equal((prepared.mutationInput.fields as any).cost_center_id, costCenterId, 'a contract takes a cost center by code');
    const created: any = await support['createRecord'](ctx, 'contracts', prepared.mutationInput.fields);
    const [row] = await runner.query(`SELECT cost_center_id FROM contracts WHERE id = $1`, [created.id]);
    assert.equal(row.cost_center_id, costCenterId, 'the created contract stores the cost center');

    const groupPrepared = await support.prepareCreatePreview(ctx, { entity_type: 'contracts', fields: fields('AI-GRP') });
    assert.equal((groupPrepared.mutationInput.fields as any).cost_center_id, groupId, 'a contract takes a group too');
    const grouped: any = await support['createRecord'](ctx, 'contracts', groupPrepared.mutationInput.fields);
    assert.equal((await runner.query(`SELECT cost_center_id FROM contracts WHERE id = $1`, [grouped.id]))[0].cost_center_id, groupId);

    const update = await support.prepareUpdatePreview(ctx, { entity_type: 'contracts', ref: created.id, fields: { cost_center: null } });
    assert.equal((update.mutationInput.fields as any).cost_center_id, null, 'the cost center can be cleared');
    await support['updateRecord'](ctx, 'contracts', created.id, update.mutationInput.fields);
    assert.equal((await runner.query(`SELECT cost_center_id FROM contracts WHERE id = $1`, [created.id]))[0].cost_center_id, null);

    assert.equal(
      await rejection(runner, () => support.prepareCreatePreview(ctx, { entity_type: 'contracts', fields: fields('ELSEWHERE-1') })),
      'Cost center not found.',
      'another tenant\'s code is not found',
    );
    assert.equal(
      await rejection(runner, () => support.prepareCreatePreview(ctx, { entity_type: 'contracts', fields: fields('AI-OLD') })),
      'This cost center is disabled.',
    );
    assert.equal(supplierId.length > 0, true, 'supplier fixture');
  });
}

async function main() {
  testRegistries();
  testContractRegistry();
  await dataSource.initialize();
  try {
    for (const kind of KINDS) await testMutations(kind);
    await testContractMutation();
  } finally {
    await dataSource.destroy();
  }
  console.log('ai-item-cost-center.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
