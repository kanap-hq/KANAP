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

/**
 * A link written by Plaid from the budget line names the line as parent, as the screens do, so
 * the line's History tab shows it. The same link written from the application carries no parent:
 * one write may touch several lines (`record-history/records/spend_items.ts`).
 */
async function testRelationAuditParentsTheBudgetLine() {
  const line = await runRelation({
    id: 'preview-line',
    target_entity_type: 'budget_lines',
    target_entity_id: LINE_ID,
    relation: 'applications',
    next: [{
      key: APP_ID,
      label: 'APP-36 - CheeseTrack',
      payload: { application_id: APP_ID },
    }],
  });
  assert.equal(line.audited.length, 1);
  assert.equal(line.audited[0].table, 'application_spend_items');
  assert.equal(line.audited[0].recordId, LINE_ID);
  assert.deepEqual(line.audited[0].parent, { table: 'spend_items', id: LINE_ID });

  const application = await runRelation({
    id: 'preview-app',
    target_entity_type: 'applications',
    target_entity_id: APP_ID,
    relation: 'budget_lines',
    next: [{
      key: LINE_ID,
      label: 'BL-7 - Licences',
      payload: { spend_item_id: LINE_ID },
    }],
  });
  assert.equal(application.audited.length, 1);
  assert.equal(application.audited[0].table, 'application_spend_items');
  assert.equal(application.audited[0].recordId, APP_ID);
  assert.equal(application.audited[0].parent, undefined);
  console.log('  relation audit parent: OK');
}

type AuditedRelation = {
  table: string;
  recordId?: string;
  parent?: { table: string; id: string };
};

async function runRelation(input: {
  id: string;
  target_entity_type: string;
  target_entity_id: string;
  relation: string;
  next: Array<{ key: string; label: string; payload: Record<string, unknown> }>;
}): Promise<{ audited: AuditedRelation[] }> {
  const audited: AuditedRelation[] = [];
  const queries: string[] = [];
  const manager = {
    query: async (sql: string) => {
      const text = sql.replace(/\s+/g, ' ').trim();
      queries.push(text);
      if (/FROM\s+users\b|FROM\s+user_roles\b|assigned_roles/.test(text)) return [];
      if (/FOR NO KEY UPDATE/.test(text)) return [{ ok: 1 }];
      if (/SELECT DISTINCT nature FROM spend_items/.test(text)) return [{ nature: 'opex' }];
      if (/SELECT \* FROM spend_items/.test(text)) {
        return [{ id: LINE_ID, item_number: 7, product_name: 'Licences', nature: 'opex' }];
      }
      return [];
    },
  };
  const service = new AiRelationMutationSupportService(
    { log: async (entry: AuditedRelation) => { audited.push(entry); } } as any,
    null as any,
    null as any,
    null as any,
  );
  const context: AiExecutionContextWithManager = {
    tenantId: TENANT_ID,
    userId: USER_ID,
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    conversationId: 'conv-1',
    manager: manager as any,
  };
  try {
    await service.executePreview(context, {
      id: input.id,
      target_entity_type: input.target_entity_type,
      target_entity_id: input.target_entity_id,
      mutation_input: {
        entity_type: input.target_entity_type,
        relation: input.relation,
        next_items: input.next,
      },
      current_values: { items: [] },
    } as any);
  } catch (error) {
    const detail = queries.map((query) => `  ${query}`).join('\n');
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nqueries:\n${detail}`);
  }
  return { audited };
}

async function main(): Promise<void> {
  await testRelationTitleNamesTheReferenceOnce();
  await testRelationAuditParentsTheBudgetLine();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
