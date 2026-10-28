import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { AiFinancialPlanMutationSupportService } from '../mutation/ai-financial-plan-mutation-support.service';

// The AI's create_version (plan planning/perf-scale, lot 3A review): the
// version services became a get-or-create, so a year created since the
// preview (by a budget tab, an import) would be returned as if the AI had
// created it, and logged as an AI "create" in the audit. The AI asks the
// services to refuse an existing year instead (`refuseExisting`): the preview
// fails with a clear message and nothing is audited.

const ITEM_ID = '11111111-1111-4111-8111-111111111111';

function setup(existing: boolean) {
  const audited: unknown[] = [];
  const calls: Array<{ itemId: string; opts: any }> = [];
  const versions = {
    createForItem: async (itemId: string, _fields: unknown, _userId: unknown, opts: any) => {
      calls.push({ itemId, opts });
      if (existing && opts?.refuseExisting) throw new ConflictException('This line already has a budget version for 2027.');
      return { id: 'version-1' };
    },
  };
  const service = new AiFinancialPlanMutationSupportService(
    { log: async (entry: unknown) => { audited.push(entry); } } as any,
    {} as any, {} as any, versions as any, {} as any, {} as any, versions as any,
  );
  const context: any = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    manager: { query: async () => [{ id: ITEM_ID, product_name: 'Monitoring', description: 'Servers' }] },
  };
  return { service, context, audited, calls };
}

function preview(entityType: 'budget_lines'): any {
  return {
    id: 'preview-1',
    target_entity_type: entityType,
    target_entity_id: ITEM_ID,
    mutation_input: {
      action: 'create_version', entity_type: entityType, item_id: ITEM_ID,
      fields: { version_name: 'Y2027', budget_year: 2027 },
    },
  };
}

async function testExistingYearIsRefused() {
  const { service, context, audited, calls } = setup(true);
  await assert.rejects(
    service.executePreview(context, preview('budget_lines')),
    (error: unknown) => error instanceof ConflictException && /already has a budget version for 2027/.test((error as Error).message),
    'a year created since the preview is refused',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts?.refuseExisting, true, 'the AI asks the service to refuse an existing year');
  assert.deepEqual(audited, [], 'no AI "create" is audited');
}

async function testNewYearIsCreatedAndAudited() {
  const { service, context, audited, calls } = setup(false);
  const target = preview('budget_lines');
  // The created version is read back for the preview's reference.
  (service as any).resolveVersionById = async () => ({ id: 'version-1', ref: 'Y2027', label: 'Y2027', row: { id: 'version-1' } });
  await service.executePreview(context, target);
  assert.equal(calls[0].opts?.refuseExisting, true);
  assert.equal(target.mutation_input.version_id, 'version-1');
  assert.equal(audited.length, 1, 'the creation is audited once');
  assert.equal((audited[0] as any).action, 'create');
}

/**
 * Issue 127: a line created with an amount gets its version and its amounts in the same approval:
 * the version of the amounts' year, named as the budget tab names it, then the amounts, each audited.
 */
async function testNewLineAmountsCreateTheVersionThenTheAmounts() {
  const { service, context, audited, calls } = setup(false);
  const upserts: Array<{ versionId: string; amounts: any }> = [];
  (service as any).resolveVersionById = async () => ({ id: 'version-1', ref: 'Y2026', label: 'Y2026 / 2026', row: { id: 'version-1', budget_year: 2026 } });
  (service as any).listAmounts = async () => ({ items: [], totals: {} });
  (service as any).upsertAmounts = async (_ctx: unknown, _type: unknown, versionId: string, amounts: unknown) => { upserts.push({ versionId, amounts }); };
  const versionFields: unknown[] = [];
  (service as any).createVersion = async (_ctx: unknown, _type: unknown, itemId: string, fields: unknown) => {
    versionFields.push(fields);
    calls.push({ itemId, opts: { refuseExisting: true } });
    return { id: 'version-1' };
  };
  await service.writeNewLineAmounts(context, preview('budget_lines'), ITEM_ID, { kind: 'annual', year: 2026, totals: { planned: 12000 } });
  assert.deepEqual(versionFields, [{ version_name: 'Y2026', budget_year: 2026, as_of_date: '2026-01-01', input_grain: 'annual' }]);
  assert.deepEqual(upserts, [{ versionId: 'version-1', amounts: { kind: 'annual', year: 2026, totals: { planned: '12000' } } }]);
  assert.deepEqual(audited.map((entry: any) => [entry.table, entry.action]), [['spend_versions', 'create'], ['spend_amounts', 'update']]);
}

/** Issue 127: the financial plan tool finds a line by its BL-n reference (the failed step of the old flow). */
async function testLineIsFoundByItsReference() {
  const { service, context } = setup(false);
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  context.manager.query = async (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    return [{ id: ITEM_ID, nature: 'opex', product_name: 'QA Test', item_number: 146 }];
  };
  const item = await (service as any).resolveItem(context, 'BL-146');
  assert.equal(item.id, ITEM_ID);
  assert.equal(item.ref, 'BL-146');
  assert.equal(item.nature, 'opex');
  assert.deepEqual(queries[0].params, ['tenant-1', 'BL-146', 146, null]);
  assert.match(queries[0].sql, /nature IN \('opex', 'capex'\)/);
  await (service as any).resolveItem(context, 'CPX-7');
  assert.deepEqual(queries[1].params, ['tenant-1', 'CPX-7', -1, 'CPX-7']);
  await (service as any).resolveItem(context, 'Monitoring');
  assert.deepEqual(queries[2].params, ['tenant-1', 'Monitoring', -1, null]);
}

async function main() {
  await testExistingYearIsRefused();
  await testNewYearIsCreatedAndAudited();
  await testNewLineAmountsCreateTheVersionThenTheAmounts();
  await testLineIsFoundByItsReference();
  console.log('ai-financial-plan-create-version.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
