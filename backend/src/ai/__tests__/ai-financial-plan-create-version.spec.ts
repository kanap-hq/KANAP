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

function preview(entityType: 'spend_items' | 'capex_items'): any {
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
  for (const entityType of ['spend_items', 'capex_items'] as const) {
    const { service, context, audited, calls } = setup(true);
    await assert.rejects(
      service.executePreview(context, preview(entityType)),
      (error: unknown) => error instanceof ConflictException && /already has a budget version for 2027/.test((error as Error).message),
      `${entityType}: a year created since the preview is refused`,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts?.refuseExisting, true, `${entityType}: the AI asks the service to refuse an existing year`);
    assert.deepEqual(audited, [], `${entityType}: no AI "create" is audited`);
  }
}

async function testNewYearIsCreatedAndAudited() {
  const { service, context, audited, calls } = setup(false);
  const target = preview('spend_items');
  // The created version is read back for the preview's reference.
  (service as any).resolveVersionById = async () => ({ id: 'version-1', ref: 'Y2027', label: 'Y2027', row: { id: 'version-1' } });
  await service.executePreview(context, target);
  assert.equal(calls[0].opts?.refuseExisting, true);
  assert.equal(target.mutation_input.version_id, 'version-1');
  assert.equal(audited.length, 1, 'the creation is audited once');
  assert.equal((audited[0] as any).action, 'create');
}

async function main() {
  await testExistingYearIsRefused();
  await testNewYearIsCreatedAndAudited();
  console.log('ai-financial-plan-create-version.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
