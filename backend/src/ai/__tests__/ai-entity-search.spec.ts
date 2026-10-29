import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AiEntityService } from '../ai-entity.service';

function createService(overrides?: { knowledge?: Record<string, unknown> }) {
  return new AiEntityService(
    {
      searchMentionOptions: async () => ({ items: [], total: 0 }),
      listReadableLibraryIdsForUser: async () => null,
      getKnowledgeContextForEntity: async () => ({
        access: 'granted',
        total: 0,
        groups: [],
      }),
      ...(overrides?.knowledge ?? {}),
    } as any,
    {
      listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
      adminFamiliesGap: async () => 'right',
      canReadKnowledge: async () => true,
      assertEntityTypeReadAccess: async () => undefined,
    } as any,
  );
}

function createContext(query: (sql: string, params?: unknown[]) => Promise<unknown[]>) {
  return {
    tenantId: randomUUID(),
    userId: randomUUID(),
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    manager: { query },
  };
}

async function withFlag<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.AI_SEARCH_INDEX_ENABLED;
  if (value === undefined) {
    delete process.env.AI_SEARCH_INDEX_ENABLED;
  } else {
    process.env.AI_SEARCH_INDEX_ENABLED = value;
  }
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.AI_SEARCH_INDEX_ENABLED;
    } else {
      process.env.AI_SEARCH_INDEX_ENABLED = previous;
    }
  }
}

const isIndexSearch = (sql: string) => sql.includes('FROM search_index');

async function testIndexedSearchAllReadsBothBudgetNatureTypes() {
  const sqlStatements: string[] = [];
  const params: unknown[][] = [];
  const service = createService();
  const context = createContext(async (sql, bound) => {
    sqlStatements.push(sql);
    params.push(bound ?? []);
    return [];
  });

  const result = await service.searchAll(context as any, {
    query: 'billing',
    entity_types: ['budget_lines'],
    limit: 10,
  });

  assert.equal(result.complete, true);
  assert.equal(result.truncated, false);
  assert.deepEqual((result as any).failed_entity_types, []);
  assert.deepEqual((result as any).warnings, []);
  const searchStatements = sqlStatements.filter(isIndexSearch);
  assert.equal(searchStatements.length, 1);
  // The AI family reads the two index types of the budget lines; nothing reads `spend_items` directly.
  const types = params[sqlStatements.indexOf(searchStatements[0])].find((value) => Array.isArray(value)) as string[];
  assert.deepEqual(types, ['spend_items', 'capex_items']);
  assert.equal(sqlStatements.some((sql) => sql.includes('FROM spend_items')), false);
  assert.equal(sqlStatements.some((sql) => sql.includes('SAVEPOINT')), false);
  assert.equal(searchStatements[0].includes(`websearch_to_tsquery('kanap_fr'`), true);
  assert.equal(searchStatements[0].includes('similarity(label,'), true);
}

/** The historical per-nature budget search is gone: with the flag off the family still reads the index. */
async function testNoLegacyBudgetSearch() {
  await withFlag('false', async () => {
    const sqlStatements: string[] = [];
    const service = createService();
    const context = createContext(async (sql) => {
      sqlStatements.push(sql);
      return [];
    });

    await service.searchAll(context as any, {
      query: 'Eva Fried task',
      entity_types: ['budget_lines'],
      limit: 10,
    });

    assert.equal(sqlStatements.some(isIndexSearch), true, 'budget lines read the index');
    assert.equal(sqlStatements.some((sql) => sql.includes('FROM spend_items')), false, 'no legacy budget search');
  });
}

/** A failing legacy search is reported, not fatal: contracts still use the historical path. */
async function testLegacySearchAllReportsPartialEntityFailures() {
  await withFlag('false', async () => {
    const service = createService();
    const context = createContext(async (sql) => {
      if (sql.includes('FROM contracts c')) {
        throw new Error('invalid input value for enum status_state: ""');
      }
      return [];
    });

    const result = await service.searchAll(context as any, {
      query: 'contract',
      entity_types: ['contracts', 'applications'],
      limit: 10,
    });

    assert.equal(result.complete, false);
    assert.equal(result.truncated, false);
    assert.deepEqual((result as any).failed_entity_types, ['contracts']);
    assert.equal((result as any).warnings[0].entity_type, 'contracts');
  });
}

async function testIndexedSearchAllAppliesParticipationScope() {
  const sqlStatements: string[] = [];
  const service = createService();
  const context = createContext(async (sql) => {
    sqlStatements.push(sql);
    if (sql.includes('assigned_roles')) {
      // Business-contributor-only role assignment → scoped access.
      return [{ role_id: randomUUID(), role_name: 'business contributor', level: null }];
    }
    return [];
  });

  await service.searchAll(context as any, {
    query: 'roadmap',
    entity_types: ['projects', 'requests', 'tasks', 'applications', 'companies'],
    limit: 10,
  });

  const searchSql = sqlStatements.find(isIndexSearch);
  assert.ok(searchSql, 'expected a search_index query');
  assert.equal(searchSql!.includes(`search_index.entity_type <> 'projects' OR EXISTS`), true);
  assert.equal(searchSql!.includes('portfolio_project_team pt_scope'), true);
  assert.equal(searchSql!.includes(`search_index.entity_type <> 'requests' OR EXISTS`), true);
  assert.equal(searchSql!.includes('portfolio_request_team rt_scope'), true);
  assert.equal(searchSql!.includes(`search_index.entity_type <> 'tasks' OR EXISTS`), true);
  assert.equal(searchSql!.includes('assignee_user_id'), true);
  assert.equal(searchSql!.includes(`search_index.entity_type <> 'applications' OR EXISTS`), true);
  assert.equal(searchSql!.includes('application_owners ao_scope'), true);
  // Non-participation-scoped types stay unrestricted.
  assert.equal(searchSql!.includes(`search_index.entity_type <> 'companies'`), false);
}

async function testIndexedSearchAllAppliesDocumentLibraryAcl() {
  const sqlStatements: string[] = [];
  const libraryId = randomUUID();
  const service = createService({
    knowledge: {
      listReadableLibraryIdsForUser: async () => [libraryId],
    },
  });
  const context = createContext(async (sql) => {
    sqlStatements.push(sql);
    return [];
  });

  await service.searchAll(context as any, {
    query: 'runbook',
    entity_types: ['documents', 'tasks'],
    limit: 10,
  });

  const searchSql = sqlStatements.find(isIndexSearch);
  assert.ok(searchSql, 'expected a search_index query');
  assert.equal(searchSql!.includes(`search_index.entity_type <> 'documents' OR EXISTS`), true);
  assert.equal(searchSql!.includes('d_acl.library_id = ANY'), true);
}

async function testIndexedRowsMapToTheBudgetLineFamily(applicationClassifications: Record<string, string | number> = {}) {
  const updatedAt = new Date('2026-06-01T08:00:00.000Z');
  const service = createService();
  const context = createContext(async (sql) => {
    if (!isIndexSearch(sql)) return [];
    return [
      {
        entity_type: 'tasks',
        entity_id: 'task-1',
        ref_prefix: 'T',
        ref_number: 42,
        label: 'Patch servers',
        summary: 'Apply June updates',
        status: 'open',
        extra_json: { assignee: 'Eva Fried', creator: null },
        source_updated_at: updatedAt,
        total_count: 4,
        score: 4,
      },
      {
        entity_type: 'applications',
        entity_id: 'app-1',
        ref_prefix: 'APP',
        ref_number: 7,
        label: 'Billing App',
        summary: null,
        status: 'active',
        extra_json: { item_ref: 'APP-7', lifecycle: 'production', criticality: null, ...applicationClassifications },
        source_updated_at: updatedAt,
        total_count: 4,
        score: 3,
      },
      {
        entity_type: 'spend_items',
        entity_id: 'spend-1',
        ref_prefix: 'BL',
        ref_number: 9,
        label: 'License renewal',
        summary: null,
        status: 'active',
        extra_json: { supplier: 'ACME', paying_company: null, account: null, contract: null, analytics: 'Nature: Licences' },
        source_updated_at: updatedAt,
        total_count: 4,
        score: 2,
      },
      {
        entity_type: 'capex_items',
        entity_id: 'capex-1',
        ref_prefix: 'BL',
        ref_number: 3,
        label: 'Server refresh',
        summary: null,
        status: 'active',
        extra_json: null,
        source_updated_at: updatedAt,
        total_count: 4,
        score: 1,
      },
    ];
  });

  const result = await service.searchAll(context as any, {
    query: 'whatever',
    entity_types: ['tasks', 'applications', 'budget_lines'],
    limit: 10,
  });

  assert.equal(result.total, 4);
  const [task, app, spend, capex] = result.items as any[];

  assert.equal(task.type, 'tasks');
  assert.equal(task.ref, 'T-42');
  assert.equal(task.label, 'Patch servers');
  assert.equal(task.match_context, 'Apply June updates');
  assert.equal(task.updated_at, '2026-06-01T08:00:00.000Z');
  assert.deepEqual(task.metadata, { assignee: 'Eva Fried', creator: null });
  assert.equal('_score' in task, false);

  // applications take their text ref from the source sequential_id…
  assert.equal(app.ref, 'APP-7');
  assert.deepEqual(app.metadata, {
    lifecycle: 'production',
    criticality: null,
    cyber_criticality: null,
    recovery_wave: null,
    rto_minutes: null,
    rpo_minutes: null,
    category: null,
    hosting_model: null,
    data_class: null,
    version: null,
    supplier: null,
    business_owner: null,
    it_owner: null,
    ...applicationClassifications,
  });

  // …while budget lines, both natures, are the one AI family, each with its nature.
  assert.equal(spend.type, 'budget_lines');
  assert.equal(capex.type, 'budget_lines');
  assert.equal(spend.ref, 'BL-9');
  assert.equal(capex.ref, 'BL-3');
  assert.deepEqual(spend.metadata, {
    supplier: 'ACME',
    paying_company: null,
    account: null,
    contract: null,
    analytics: 'Nature: Licences',
    nature: 'opex',
  });
  // A line without an indexed analytics value has no `analytics` key in extra_json: null.
  assert.deepEqual(capex.metadata, { supplier: null, paying_company: null, account: null, contract: null, analytics: null, nature: 'capex' });
}

async function testIndexedBudgetLineReferences() {
  const service = createService();
  const context = createContext(async (sql) => {
    if (!isIndexSearch(sql)) return [];
    const row = { label: 'Line', summary: null, status: 'active', extra_json: null, source_updated_at: null, total_count: 2, score: 3 };
    return [
      { ...row, entity_type: 'spend_items', entity_id: 'spend-1', ref_prefix: 'BL', ref_number: 12 },
      { ...row, entity_type: 'capex_items', entity_id: 'capex-1', ref_prefix: 'BL', ref_number: 4 },
    ];
  });

  const result = await service.searchAll(context as any, {
    query: 'Line',
    entity_types: ['budget_lines'],
    limit: 10,
  });

  assert.deepEqual((result.items as any[]).map((item) => [item.type, item.ref]), [
    ['budget_lines', 'BL-12'],
    ['budget_lines', 'BL-4'],
  ]);
}

async function run() {
  await testIndexedSearchAllReadsBothBudgetNatureTypes();
  await testNoLegacyBudgetSearch();
  await testLegacySearchAllReportsPartialEntityFailures();
  await testIndexedSearchAllAppliesParticipationScope();
  await testIndexedSearchAllAppliesDocumentLibraryAcl();
  await testIndexedRowsMapToTheBudgetLineFamily();
  await testIndexedRowsMapToTheBudgetLineFamily({
    criticality: 'business_custom',
    cyber_criticality: 'cyber_custom',
    recovery_wave: 'wave_custom',
    data_class: 'confidentiality_custom',
    rto_minutes: 60,
    rpo_minutes: 0,
  });
  await testIndexedBudgetLineReferences();
}

void run();
