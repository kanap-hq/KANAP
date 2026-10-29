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

  const forReader = await load.call({}, ctx, ['tasks', 'budget_lines']);
  assert.equal(forReader[0].name, 'A0', 'a budget line reader gets the tenant names');
  assert.ok((await load.call({}, ctx, ['budget_lines'])).length === 5, 'the one family covers both natures');
  assert.equal(await load.call({}, ctx, ['tasks', 'projects']), undefined, 'no budget line read: no block');
  assert.equal(queries.length, 2, 'settings are read only for budget line readers');

  const service = new AiSystemPromptService();
  const base = {
    tenantName: 'Test Tenant',
    availableTools: [],
    readableEntityTypes: ['budget_lines'],
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
  const policy = {
    assertEntityTypeReadAccess: async (_ctx: unknown, type: string) => { checked.push(type); },
    adminFamiliesGap: async () => 'right',
    // The linked fields of tasks follow the caller's reads: this caller reads everything.
    canReadEntityType: async () => true,
  };
  const args: any[] = Array.from({ length: 9 }, () => undefined);
  args[2] = policy;
  args[8] = { listOperations: () => [] };
  const registry = new (AiToolRegistry as any)(...args);
  const describe = (registry as any).definitions.get('describe_entity_filters');
  const queries: unknown[][] = [];
  const axisQueries: unknown[][] = [];
  const nature = { id: '00000000-0000-4000-8000-000000000002', code: 'nature', name: 'Nature', is_default: false, status: 'enabled', disabled_at: null, sort_order: 1 };
  const context = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    manager: {
      query: async (...params: unknown[]) => {
        // The tenant's analytics dimensions (the registry is resolved per tenant), then the budget column settings.
        if (/analytics_axes/.test(String(params[0]))) { axisQueries.push(params); return [nature]; }
        // The language of the person's menus, for the screens of `families_not_read`.
        if (/FROM users/.test(String(params[0]))) return [{ locale: 'fr' }];
        queries.push(params);
        return [{ value: { labels: { committed: 'A1' } } }];
      },
    },
  };

  for (const entityType of ['budget_lines']) {
    const result = await describe.execute(context, { entity_type: entityType });
    assert.ok(result.fields.some((field: any) => field.field === 'y_plus1_review'), `${entityType}: fields kept`);
    assert.ok(result.fields.some((field: any) => field.field === 'analytics:nature' && field.groupable), `${entityType}: the tenant's dimension listed`);
    assert.deepEqual(result.budget_columns[1], { column: 2, ai_field_suffix: 'review', measure: 'committed', name: 'A1', shown: true, default: false });
    assert.equal(result.budget_columns.length, 5);
    assert.ok(result.families_not_read.includes('cost centers (Données de référence › Centres de coûts)'), `${entityType}: screens in the profile's language`);
  }
  assert.deepEqual(queries.map((q) => q[1]), [['tenant-1']], 'settings read for the context tenant');
  assert.deepEqual(axisQueries.map((q) => q[1]), [['tenant-1']], 'dimensions read for the context tenant');
  const tasks = await describe.execute(context, { entity_type: 'tasks' });
  assert.equal(tasks.budget_columns, undefined, 'other entity types carry no columns');
  assert.equal(queries.length, 1);
  assert.equal(axisQueries.length, 1, 'no dimension read for other entity types');
  assert.deepEqual(checked, ['budget_lines', 'tasks'], 'read access checked first');
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

// The card writes these amounts in the person's language: the server sends numbers, the year, the
// line's currency and the tenant's column names, whatever the language.
function testApprovalCardAmountsAreNumbers() {
  const proto = AiFinancialPlanMutationSupportService.prototype as any;
  assert.deepEqual(
    proto.previewPayload.call(proto, { kind: 'annual', year: 2026, totals: { planned: '12000.50', expected_landing: '4' } }, SETTINGS, 'eur'),
    {
      year: 2026,
      currency: 'EUR',
      column_names: { planned: 'A0', committed: 'A1', forecast: 'A2', actual: 'A3', expected_landing: 'Réel' },
      totals: { planned: 12000.5, expected_landing: 4 },
    },
  );
  const defaults = normalizeBudgetColumns(undefined);
  assert.deepEqual(
    proto.previewPayload.call(proto, { kind: 'quarterly', year: 2026, measure: 'forecast', Q1: '1' }, defaults, null),
    { year: 2026, currency: null, column_names: {}, quarters: { measure: 'forecast', values: { Q1: 1, Q2: 0, Q3: 0, Q4: 0 } } },
    'no tenant names, no currency',
  );
  assert.deepEqual(
    proto.previewPayload.call(proto, { kind: 'monthly', year: 2026, months: [{ period: '2026-01-01' }, { period: '2026-02-01' }] }, defaults, 'CHF'),
    { year: 2026, currency: 'CHF', column_names: {}, months: 2 },
  );
  assert.deepEqual(
    proto.previewTotals.call(proto, { year: 2026, totals: { planned: 10, forecast: 3 } }, defaults, 'EUR').totals,
    { planned: 10, committed: 0, forecast: 3, actual: 0, expected_landing: 0 },
    'shown columns, and the hidden forecast because it holds an amount',
  );
  assert.deepEqual(
    proto.previewTotals.call(proto, { year: 2026, totals: { planned: 10 } }, defaults, 'EUR').totals,
    { planned: 10, committed: 0, actual: 0, expected_landing: 0 },
    'an empty hidden column is left out',
  );
}

async function main() {
  testFieldDescriptionsAreNeutral();
  testAiContext();
  await testPromptBlockFollowsOpexOrCapexRead();
  await testDescribeEntityFiltersCarriesColumns();
  testApprovalCardUsesNames();
  testApprovalCardAmountsAreNumbers();
  console.log('ai-budget-columns.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
