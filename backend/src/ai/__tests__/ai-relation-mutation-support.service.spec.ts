import * as assert from 'node:assert/strict';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiRelationMutationSupportService } from '../mutation/ai-relation-mutation-support.service';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const APP_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const LINE_ID = '55555555-5555-4555-8555-555555555555';
const LOCATION_ID = '66666666-6666-4666-8666-666666666666';

function createHarness() {
  const manager = {
    query: async (sql: string) => {
      // A role read with no Business Contributor leaves the participation scope empty.
      if (/FROM\s+users\b|FROM\s+user_roles\b|assigned_roles/.test(sql)) return [];
      if (sql.includes('FROM applications')) {
        return [{ id: APP_ID, sequential_id: 'APP-36', name: 'APP-36 - CheeseTrack' }];
      }
      if (sql.includes('FROM assets')) {
        return [{ id: ASSET_ID, asset_reference: 'AST-12', name: 'AST-12 - srv-cheese-01' }];
      }
      if (sql.includes('FROM portfolio_projects')) {
        return [{ id: PROJECT_ID, item_number: 2, name: 'PRJ-2 - Affinage' }];
      }
      if (sql.includes('FROM portfolio_requests')) {
        return [{ id: REQUEST_ID, item_number: 4, name: 'REQ-4 - New cave' }];
      }
      if (sql.includes('FROM spend_items')) {
        return [{ id: LINE_ID, item_number: 7, product_name: 'BL-7 - Licences', nature: 'opex' }];
      }
      if (sql.includes('FROM locations')) {
        return [{ id: LOCATION_ID, location_reference: 'LOC-1', name: 'LOC-1 - Paris DC' }];
      }
      return [];
    },
  };
  const service = new AiRelationMutationSupportService(null as any, null as any, null as any, null as any);
  const context: AiExecutionContextWithManager = {
    tenantId: TENANT_ID,
    userId: USER_ID,
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    conversationId: 'conv-1',
    manager: manager as any,
  };
  return { service, context };
}

function titleOf(prepared: { currentValues?: Record<string, unknown> | null }): string {
  return String(prepared.currentValues?.target_title ?? '');
}

function addedLabel(prepared: { mutationInput: Record<string, unknown> }): string {
  const items = prepared.mutationInput.next_items as Array<{ label: string }>;
  assert.equal(items.length, 1);
  return items[0].label;
}

async function testRelationTitleNamesTheReferenceOnce() {
  const { service, context } = createHarness();

  // Linking APP-36, whose name already starts with its reference, names it once.
  const linked = await service.prepareUpdatePreview(context, {
    entity_type: 'projects',
    ref: 'PRJ-2',
    relation: 'applications',
    add: ['APP-36'],
  });
  assert.equal(titleOf(linked), 'PRJ-2 - Affinage');
  assert.equal(addedLabel(linked), 'APP-36 - CheeseTrack');

  const asset = await service.prepareUpdatePreview(context, {
    entity_type: 'assets',
    ref: 'AST-12',
    relation: 'links',
    add: [{ url: 'https://example.test/asset' }],
  });
  assert.equal(titleOf(asset), 'AST-12 - srv-cheese-01');

  const request = await service.prepareUpdatePreview(context, {
    entity_type: 'requests',
    ref: 'REQ-4',
    relation: 'applications',
    add: ['APP-36'],
  });
  assert.equal(titleOf(request), 'REQ-4 - New cave');
  assert.equal(addedLabel(request), 'APP-36 - CheeseTrack');

  const line = await service.prepareUpdatePreview(context, {
    entity_type: 'budget_lines',
    ref: 'BL-7',
    relation: 'links',
    add: [{ url: 'https://example.test/line' }],
  });
  assert.equal(titleOf(line), 'BL-7 - Licences');

  const site = await service.prepareUpdatePreview(context, {
    entity_type: 'locations',
    ref: 'LOC-1',
    relation: 'links',
    add: [{ url: 'https://example.test/site' }],
  });
  assert.equal(titleOf(site), 'LOC-1 - Paris DC');
  console.log('  relation reference label: OK');
}

testRelationTitleNamesTheReferenceOnce().catch((error) => {
  console.error(error);
  process.exit(1);
});
