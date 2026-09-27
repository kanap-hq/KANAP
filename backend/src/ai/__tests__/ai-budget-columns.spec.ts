import * as assert from 'node:assert/strict';
import { AiSystemPromptService } from '../ai-system-prompt.service';
import { AiChatOrchestratorService } from '../ai-chat-orchestrator.service';
import { AiFinancialPlanMutationSupportService } from '../mutation/ai-financial-plan-mutation-support.service';
import { AiToolRegistry } from '../ai-tool.registry';
import { budgetAmountFields } from '../query/registries/budget-amount-fields';
import { budgetColumnsAiContext, normalizeBudgetColumns } from '../../budget-columns/budget-columns.util';

// The AI keeps its keys; the tenant's column names reach it through the
// prompt context, and the approval card shows them.

const SETTINGS = normalizeBudgetColumns({
  labels: { planned: 'A0', committed: 'A1', forecast: 'A2', actual: 'A3', expected_landing: 'Réel' },
  enabled: { forecast: true },
  default_column: 'committed',
});

function testFieldDescriptionsAreNeutral() {
  const fields = budgetAmountFields();
  assert.equal(fields.y_plus1_review.description, 'Total of column 2 (named Revision by default) for Y+1, in the reporting currency.');
  assert.equal(fields.y_forecast.description, 'Total of column 3 (named Forecast by default) for Y, the current year, in the reporting currency.');
  assert.equal(Object.keys(fields).length, 25, 'AI keys unchanged');
}

function testAiContext() {
  assert.deepEqual(budgetColumnsAiContext(SETTINGS), [
    { column: 1, ai_field_suffix: 'budget', measure: 'planned', name: 'A0', shown: true, default: false },
    { column: 2, ai_field_suffix: 'review', measure: 'committed', name: 'A1', shown: true, default: true },
    { column: 3, ai_field_suffix: 'forecast', measure: 'forecast', name: 'A2', shown: true, default: false },
    { column: 4, ai_field_suffix: 'actual', measure: 'actual', name: 'A3', shown: true, default: false },
    { column: 5, ai_field_suffix: 'landing', measure: 'expected_landing', name: 'Réel', shown: true, default: false },
  ]);
}

async function testPromptBlockFollowsOpexOrCapexRead() {
  const queries: string[] = [];
  const manager = {
    query: async (sql: string) => {
      queries.push(sql);
      return [{ value: { labels: { planned: 'A0' } } }];
    },
  };
  const ctx = { tenantId: 'tenant-1', userId: 'user-1', manager } as any;
  const load = (AiChatOrchestratorService.prototype as any).loadBudgetColumnsPromptContext;

  const forReader = await load.call({}, ctx, ['tasks', 'spend_items']);
  assert.equal(forReader[0].name, 'A0', 'an OPEX reader gets the tenant names');
  assert.ok((await load.call({}, ctx, ['capex_items'])).length === 5, 'a CAPEX reader too');
  assert.equal(await load.call({}, ctx, ['tasks', 'projects']), undefined, 'no OPEX or CAPEX read: no block');
  assert.equal(queries.length, 2, 'settings are read only for OPEX or CAPEX readers');

  const service = new AiSystemPromptService();
  const base = {
    tenantName: 'Test Tenant',
    availableTools: [],
    readableEntityTypes: ['spend_items'],
    currentUser: { displayName: 'Alex', email: null, roleNames: [], teamName: null },
  };
  const withColumns = service.build({ ...base, budgetColumns: budgetColumnsAiContext(SETTINGS) });
  assert.match(withColumns, /"budget_columns": \[/);
  assert.match(withColumns, /"name": "Réel"/);
  assert.match(withColumns, /`budget_columns` lists the five amount columns/);
  const without = service.build(base);
  assert.doesNotMatch(without, /budget_columns/);
}

/** MCP clients have no system prompt: the filter description of OPEX and CAPEX items carries the names. */
async function testDescribeEntityFiltersCarriesColumns() {
  const checked: string[] = [];
  const policy = { assertEntityTypeReadAccess: async (_ctx: unknown, type: string) => { checked.push(type); } };
  const args: any[] = Array.from({ length: 9 }, () => undefined);
  args[2] = policy;
  args[8] = { listOperations: () => [] };
  const registry = new (AiToolRegistry as any)(...args);
  const describe = (registry as any).definitions.get('describe_entity_filters');
  const queries: unknown[][] = [];
  const context = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    manager: { query: async (...params: unknown[]) => { queries.push(params); return [{ value: { labels: { committed: 'A1' } } }]; } },
  };

  for (const entityType of ['spend_items', 'capex_items']) {
    const result = await describe.execute(context, { entity_type: entityType });
    assert.ok(result.fields.some((field: any) => field.field === 'y_plus1_review'), `${entityType}: fields kept`);
    assert.deepEqual(result.budget_columns[1], { column: 2, ai_field_suffix: 'review', measure: 'committed', name: 'A1', shown: true, default: false });
    assert.equal(result.budget_columns.length, 5);
  }
  assert.deepEqual(queries.map((q) => q[1]), [['tenant-1'], ['tenant-1']], 'settings read for the context tenant');
  const tasks = await describe.execute(context, { entity_type: 'tasks' });
  assert.equal(tasks.budget_columns, undefined, 'other entity types carry no columns');
  assert.equal(queries.length, 2);
  assert.deepEqual(checked, ['spend_items', 'capex_items', 'tasks'], 'read access checked first');
}

function testApprovalCardUsesNames() {
  const proto = AiFinancialPlanMutationSupportService.prototype as any;
  assert.equal(
    proto.formatAmountSummary.call(proto, { year: 2026, totals: { planned: 10, forecast: 3, committed: 5 } }, SETTINGS),
    '2026 totals (A0: 10, A1: 5, A2: 3, A3: 0, Réel: 0)',
    'fixed column order, tenant names',
  );
  assert.equal(
    proto.formatAmountPayload.call(proto, { kind: 'annual', year: 2026, totals: { expected_landing: 4, planned: 1 } }, SETTINGS),
    '2026 annual totals (A0: 1, Réel: 4)',
  );
  assert.equal(
    proto.formatAmountPayload.call(proto, { kind: 'quarterly', year: 2026, measure: 'forecast', Q1: 1 }, normalizeBudgetColumns(undefined)),
    '2026 quarterly Forecast (Q1: 1, Q2: 0, Q3: 0, Q4: 0)',
    'product names without settings',
  );
}

async function main() {
  testFieldDescriptionsAreNeutral();
  testAiContext();
  await testPromptBlockFollowsOpexOrCapexRead();
  await testDescribeEntityFiltersCarriesColumns();
  testApprovalCardUsesNames();
  console.log('ai-budget-columns.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
