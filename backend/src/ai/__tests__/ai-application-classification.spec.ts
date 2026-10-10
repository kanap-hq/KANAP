import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { applicationsRegistry } from '../query/registries/applications.registry';
import { adaptFilters } from '../query/ai-filter.adapter';
import { compileAgFilterCondition, createParamNameGenerator } from '../../common/ag-grid-filtering';
import { classificationSqlExpressions } from '../../it-ops-settings/classification-sql';
import { catalogFromMetadata } from '../../it-ops-settings/classification-catalog';
import { AiBusinessRecordMutationSupportService } from '../mutation/ai-business-record-mutation-support.service';
import { AiToolRegistry } from '../ai-tool.registry';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const APP_ID = '11111111-1111-4111-8111-111111111111';

const catalog = catalogFromMetadata({
  business_criticality_levels: [
    { code: 'stop_now', label: 'Immediate', description: 'Four hours or less.', rank: 90, maxMtdMinutes: 240 },
    { code: 'patient', label: 'Can wait', description: 'More than four hours.', rank: 10, maxMtdMinutes: null },
    { code: 'retired_peak', label: 'Former maximum', description: 'Historical only.', rank: 99, maxMtdMinutes: 60, deprecated: true },
  ],
  cyber_criticality_levels: [
    { code: 'custom_calm', label: 'Renamed calm', description: 'Limited impact.', rank: 3 },
    { code: 'custom_peak', label: 'Renamed maximum', description: 'Extreme impact.', rank: 70 },
    { code: 'historic_peak', label: 'Old maximum', description: 'Historical maximum.', rank: 100, deprecated: true },
  ],
  data_classes: [
    { code: 'open_custom', label: 'Shareable', description: 'Public.', rank: 2 },
    { code: 'vault_custom', label: 'Vault', description: 'Restricted.', rank: 80 },
  ],
  recovery_waves: [
    { code: 'base_custom', label: 'Foundation renamed', description: 'Prerequisites.', order: 5 },
    { code: 'later_custom', label: 'Later', description: 'Later recovery.', order: 40 },
  ],
});

function context(surface: 'chat' | 'mcp' = 'chat', query: (sql: string) => Promise<any[]> = async () => []) {
  return {
    tenantId: TENANT_ID,
    userId: USER_ID,
    isPlatformHost: false,
    surface,
    authMethod: surface === 'chat' ? 'jwt' as const : 'api_key' as const,
    ...(surface === 'chat' ? { conversationId: 'conversation-1' } : {}),
    manager: { query } as any,
  };
}

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    tenant_id: TENANT_ID,
    sequential_id: 'APP-42',
    name: 'Atlas',
    status: 'enabled',
    criticality: 'patient',
    cyber_criticality: 'custom_calm',
    data_class: 'open_custom',
    recovery_wave: 'later_custom',
    rto_minutes: 600,
    rpo_minutes: 30,
    classification_justification: 'Business approved.',
    classification_revision: 12,
    classification_review: { user_id: 'human', reviewed_at: '2026-09-01T10:00:00Z', revision: 12 },
    ...overrides,
  };
}

function mutationHarness() {
  let live: Record<string, unknown> = application();
  const calls = { create: [] as any[], update: [] as any[], audit: [] as any[] };
  const applications = {
    get: async () => ({ ...live }),
    create: async (fields: any, userId: string, options: any) => {
      calls.create.push({ fields, userId, options });
      live = application({ ...fields, id: APP_ID, sequential_id: 'APP-42', classification_revision: 1 });
      return live;
    },
    update: async (id: string, fields: any, userId: string, options: any) => {
      calls.update.push({ id, fields, userId, options });
      live = { ...live, ...fields, classification_revision: Number(live.classification_revision) + 1 };
      return live;
    },
  };
  const service = new AiBusinessRecordMutationSupportService(
    applications as any, {} as any,
    { log: async (...args: any[]) => calls.audit.push(args) } as any,
    {} as any, {} as any, {} as any, {} as any,
    { getClassificationCatalog: async () => catalog } as any,
    {} as any, {} as any, {} as any, {} as any,
  );
  const executionContext = context('chat', async (sql) => sql.includes('FROM applications') ? [{ ...live }] : []);
  return { service, calls, context: executionContext, setLive: (value: Record<string, unknown>) => { live = value; } };
}

async function testFullTenantCatalogAndToolPermission() {
  assert.equal(catalog.businessCriticalityLevels.find((level) => level.code === 'retired_peak')?.deprecated, true);
  assert.equal(catalog.cyberCriticalityLevels.find((level) => level.rank === 100)?.label, 'Old maximum');
  // Read order is most severe first, whatever the stored order.
  assert.deepEqual(catalog.businessCriticalityLevels.map((level) => level.code), ['retired_peak', 'stop_now', 'patient']);
  assert.equal(catalog.businessCriticalityLevels.some((level) => level.code === 'medium'), false);

  const permissionCalls: any[] = [];
  const registry = new AiToolRegistry(
    {} as any, {} as any,
    {
      assertSurfaceAccess: async () => undefined,
      assertEntityTypeReadAccess: async (...args: any[]) => permissionCalls.push(args),
      listReadableEntityTypes: async () => ['applications'],
      canReadKnowledge: async () => false,
    } as any,
    {} as any, {} as any, { find: async () => ({ web_search_enabled: false }) } as any,
    {} as any, { hasExecutedUndoablePreviewInConversation: async () => false } as any,
    { listOperations: () => [], getOperationOrNull: () => null } as any,
    { getClassificationCatalog: async () => catalog } as any,
  );
  for (const surface of ['chat', 'mcp'] as const) {
    const tools = await registry.listAvailableTools(context(surface) as any);
    assert.ok(tools.some((tool) => tool.name === 'get_application_classification_catalog'));
    const result: any = await registry.execute(context(surface) as any, 'get_application_classification_catalog', {});
    assert.equal(result.cyberCriticalityLevels[0].code, 'historic_peak');
    assert.match(result.businessPolicy, /chosen directly/);
    assert.equal(result.durationUnit, 'minutes');
    assert.match(result.assignmentPolicy, /Deprecated levels remain readable/);
  }
  assert.equal(permissionCalls.length, 2);
  assert.ok(permissionCalls.every((call) => call[1] === 'applications'));
}

function testRegistryFiltersSortingAggregationAndSql() {
  const adapted = adaptFilters(applicationsRegistry, {
    cyber_criticality: ['custom_peak'],
    rto_minutes: { op: 'lte', value: 1440 },
  });
  assert.deepEqual(adapted.applied, ['cyber_criticality', 'rto_minutes']);
  assert.deepEqual(adapted.filters, {
    cyber_criticality: { filterType: 'set', values: ['custom_peak'] },
    rto_minutes: { filterType: 'number', type: 'lessThanOrEqual', filter: 1440 },
  });
  assert.equal((applicationsRegistry.fields as any).business_mtd_minutes, undefined);
  assert.equal(applicationsRegistry.sortFields.cyber_criticality, 'cyber_criticality');
  assert.equal(applicationsRegistry.sortFields.business_criticality_rank, 'business_criticality_rank');
  assert.equal(applicationsRegistry.fields.cyber_criticality.groupable, true);
  assert.equal(applicationsRegistry.aggregate?.groupFields.cyber_criticality.expression, 'a.cyber_criticality');
  assert.equal(applicationsRegistry.aggregate?.metricFields?.rto_minutes.type, 'number');
  assert.equal(applicationsRegistry.aggregate?.metricFields.cyber_criticality_rank.type, 'number');
  const sql = classificationSqlExpressions('a');
  assert.match(sql.cyber_criticality_rank, /cyber_criticality_levels/);
  assert.match(sql.cyber_criticality_rank, /level->>'rank'/);
  assert.doesNotMatch(sql.classification_review_state, /classification_versions/);
  assert.match(sql.classification_review_state, /BTRIM\(a\.criticality\)/);
  assert.match(applicationsRegistry.aggregate!.metricFields.cyber_criticality_rank.expression, /tenants classification_tenant/);
}

function testLastRecoveryTestFilterSortAndMetric() {
  const field = applicationsRegistry.fields.last_dr_test;
  assert.deepEqual([field.type, field.grid, field.sortable, field.aggregable, field.blankable], ['date', 'last_dr_test', true, true, true]);
  assert.equal(applicationsRegistry.sortFields.last_dr_test, 'last_dr_test');
  assert.deepEqual(applicationsRegistry.aggregate.metricFields?.last_dr_test, { expression: `to_char(a.last_dr_test, 'YYYY-MM-DD')`, type: 'date' });
  // The list compiles the adapted filters on its last_dr_test target: no test, then a test on or before one year ago.
  const target = { expression: 'a.last_dr_test', textExpression: 'CAST(a.last_dr_test AS TEXT)', dataType: 'string' as const };
  const blank = adaptFilters(applicationsRegistry, { last_dr_test: [null] } as any).filters.last_dr_test;
  assert.equal(compileAgFilterCondition(blank, target, createParamNameGenerator())?.sql, 'a.last_dr_test IS NULL');
  const before = adaptFilters(applicationsRegistry, { last_dr_test: { op: 'before', value: '2025-10-11' } }).filters.last_dr_test;
  assert.deepEqual(compileAgFilterCondition(before, target, createParamNameGenerator()), {
    sql: 'CAST(a.last_dr_test AS DATE) < CAST(:p0 AS DATE)', params: { p0: '2025-10-11' },
  });
  // Retired scope of the Compliance tile, as an exclude filter on lifecycle.
  const lifecycle = adaptFilters(applicationsRegistry, { lifecycle: { not: ['retired'] } } as any).filters.lifecycle;
  assert.deepEqual(compileAgFilterCondition(lifecycle, { expression: 'a.lifecycle', dataType: 'string' }, createParamNameGenerator()), {
    sql: 'NOT COALESCE((a.lifecycle IN (:...p0)), FALSE)', params: { p0: ['retired'] },
  });
}

async function testCreateAndUpdatePreviews() {
  const { service, context: executionContext } = mutationHarness();
  const create = await service.prepareCreatePreview(executionContext as any, {
    entity_type: 'applications',
    fields: {
      name: 'New Atlas', business_criticality: 'Immediate', cyber: 'Renamed maximum', confidentiality: null,
      wave: 'Foundation renamed', rto: null, rpo: 0, justification: null,
    },
  });
  assert.deepEqual(create.mutationInput.fields, {
    name: 'New Atlas', criticality: 'stop_now', cyber_criticality: 'custom_peak', data_class: null,
    recovery_wave: 'base_custom', rto_minutes: null, rpo_minutes: 0, classification_justification: null,
  });
  assert.deepEqual(create.mutationInput.classification, { has_classification_input: true, invalidates_review: false });
  assert.equal((create.mutationInput.fields as any).classification_review, undefined);

  const update = await service.prepareUpdatePreview(executionContext as any, {
    entity_type: 'applications', ref: APP_ID,
    fields: { criticality: 'stop_now', cyber_criticality: null },
  });
  assert.deepEqual(update.mutationInput.classification, { has_classification_input: true, invalidates_review: true });
  assert.ok(update.currentValues, 'an update preview must expose the current values');
  assert.deepEqual(update.currentValues.values, { criticality: 'patient', cyber_criticality: 'custom_calm' });
  const shown = service.presentPreview({ id: 'preview-1', status: 'pending', target_entity_type: 'applications', target_entity_id: APP_ID, mutation_input: update.mutationInput, current_values: update.currentValues } as any);
  assert.equal(shown.changes.criticality.to, 'Immediate');
  assert.equal(shown.changes.classification_review_state.to, 'Stale after this change');

  await assert.rejects(() => service.prepareCreatePreview(executionContext as any, {
    entity_type: 'applications', fields: { name: 'Bad', cyber_criticality: 'historic_peak' },
  }), /deprecated and cannot be newly assigned/);
  await assert.rejects(() => service.prepareCreatePreview(executionContext as any, {
    entity_type: 'applications', fields: { name: 'Bad level', criticality: 'retired_peak' },
  }), /deprecated and cannot be newly assigned/);
  await assert.rejects(() => service.prepareCreatePreview(executionContext as any, {
    entity_type: 'applications', fields: { name: 'No downtime field', business_mtd_minutes: 240 },
  }));
}

async function testExecutionControlsConflictsAndUndoInputs() {
  const { service, calls, context: executionContext, setLive } = mutationHarness();
  const prepared = await service.prepareUpdatePreview(executionContext as any, {
    entity_type: 'applications', ref: APP_ID,
    fields: { criticality: 'stop_now', cyber_criticality: null },
  });
  const preview: any = {
    id: 'preview-update', status: 'approved', target_entity_type: 'applications', target_entity_id: APP_ID,
    mutation_input: prepared.mutationInput, current_values: prepared.currentValues,
  };
  await service.executePreview(executionContext as any, preview);
  assert.equal(calls.update.length, 1);
  assert.deepEqual(calls.update[0].fields, { criticality: 'stop_now', cyber_criticality: null });
  assert.equal(calls.update[0].fields.classification_review, undefined);
  assert.equal(calls.audit.length, 1);

  setLive(application({ cyber_criticality: 'custom_peak' }));
  await assert.rejects(() => service.executePreview(executionContext as any, preview), ConflictException);

  setLive(application({ criticality: 'stop_now', cyber_criticality: null, classification_revision: 13 }));
  const reverse = await service.prepareReverseUpdatePreview(executionContext as any, preview);
  assert.deepEqual(reverse.mutationInput.fields, { criticality: 'patient', cyber_criticality: 'custom_calm' });
  assert.equal((reverse.mutationInput.fields as any).classification_review, undefined);
  assert.deepEqual(reverse.mutationInput.classification, { has_classification_input: true, invalidates_review: true });
}

async function main() {
  await testFullTenantCatalogAndToolPermission();
  testRegistryFiltersSortingAggregationAndSql();
  testLastRecoveryTestFilterSortAndMetric();
  await testCreateAndUpdatePreviews();
  await testExecutionControlsConflictsAndUndoInputs();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
