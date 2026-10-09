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

async function testLegacySearchAllCastsNonTextFieldsBeforeLike() {
  await withFlag('false', async () => {
    const sqlStatements: string[] = [];
    const service = createService();
    const context = createContext(async (sql) => {
      sqlStatements.push(sql);
      return [];
    });

    const result = await service.searchAll(context as any, {
      query: 'Eva Fried task',
      entity_types: ['spend_items', 'capex_items'],
      limit: 10,
    });

    assert.equal(result.complete, true);
    assert.equal(result.truncated, false);
    assert.deepEqual((result as any).failed_entity_types, []);
    assert.equal(sqlStatements.some((sql) => sql.includes('acc.account_number::text')), true);
    assert.equal(sqlStatements.some((sql) => sql.includes('ci.ppe_type::text')), true);
    assert.equal(sqlStatements.some((sql) => sql.includes("COALESCE(acc.account_number, '')")), false);
    assert.equal(sqlStatements.some((sql) => sql.includes("COALESCE(ci.ppe_type, '')")), false);
    assert.equal(sqlStatements.some((sql) => sql.includes('ci.priority::text')), true);
    assert.equal(sqlStatements.some((sql) => sql.includes("COALESCE(ci.priority, '')")), false);
  });
}

async function testLegacySearchAllReportsPartialEntityFailures() {
  await withFlag('false', async () => {
    const service = createService();
    const context = createContext(async (sql) => {
      if (sql.includes('FROM capex_items')) {
        throw new Error('invalid input value for enum ppe_type: ""');
      }
      return [];
    });

    const result = await service.searchAll(context as any, {
      query: 'project',
      entity_types: ['spend_items', 'capex_items'],
      limit: 10,
    });

    assert.equal(result.complete, false);
    assert.equal(result.truncated, false);
    assert.deepEqual((result as any).failed_entity_types, ['capex_items']);
    assert.equal((result as any).warnings[0].entity_type, 'capex_items');
  });
}

async function testIndexedSearchAllRunsSingleSearchIndexQuery() {
  const sqlStatements: string[] = [];
  const service = createService();
  const context = createContext(async (sql) => {
    sqlStatements.push(sql);
    return [];
  });

  const result = await service.searchAll(context as any, {
    query: 'billing',
    entity_types: ['spend_items', 'capex_items'],
    limit: 10,
  });

  assert.equal(result.complete, true);
  assert.equal(result.truncated, false);
  assert.deepEqual((result as any).failed_entity_types, []);
  assert.deepEqual((result as any).warnings, []);
  const searchStatements = sqlStatements.filter((sql) => sql.includes('FROM search_index'));
  assert.equal(searchStatements.length, 1);
  assert.equal(sqlStatements.some((sql) => sql.includes('FROM spend_items')), false);
  assert.equal(sqlStatements.some((sql) => sql.includes('SAVEPOINT')), false);
  assert.equal(searchStatements[0].includes(`websearch_to_tsquery('kanap_fr'`), true);
  assert.equal(searchStatements[0].includes('similarity(label,'), true);
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

  const searchSql = sqlStatements.find((sql) => sql.includes('FROM search_index'));
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

  const searchSql = sqlStatements.find((sql) => sql.includes('FROM search_index'));
  assert.ok(searchSql, 'expected a search_index query');
  assert.equal(searchSql!.includes(`search_index.entity_type <> 'documents' OR EXISTS`), true);
  assert.equal(searchSql!.includes('d_acl.library_id = ANY'), true);
}

async function testIndexedRowsMapToLegacyDtoShape(applicationClassifications: Record<string, string | number> = {}) {
  const updatedAt = new Date('2026-06-01T08:00:00.000Z');
  const service = createService();
  const context = createContext(async (sql) => {
    if (!sql.includes('FROM search_index')) return [];
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
        ref_prefix: 'OPX',
        ref_number: 9,
        label: 'License renewal',
        summary: null,
        status: 'active',
        extra_json: { supplier: 'ACME', paying_company: null, account: null, contract: null },
        source_updated_at: updatedAt,
        total_count: 4,
        score: 2,
      },
      {
        entity_type: 'capex_items',
        entity_id: 'capex-1',
        ref_prefix: 'CPX',
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
    entity_types: ['tasks', 'applications', 'spend_items', 'capex_items'],
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

  // …while budget lines build theirs from the item number.
  assert.equal(spend.ref, 'OPX-9');
  assert.equal(capex.ref, 'CPX-3');
  assert.deepEqual(spend.metadata, {
    supplier: 'ACME',
    paying_company: null,
    account: null,
    contract: null,
  });
}

async function testLegacySearchAllGivesBudgetLineReferences() {
  await withFlag('false', async () => {
    const service = createService();
    const context = createContext(async (sql) => {
      const row = { label: 'Line', summary: null, status: 'active', updated_at: null, total_count: 1, score: 3 };
      if (sql.includes('FROM spend_items')) return [{ ...row, id: 'spend-1', item_number: 12 }];
      if (sql.includes('FROM capex_items')) return [{ ...row, id: 'capex-1', item_number: 4 }];
      return [];
    });

    const result = await service.searchAll(context as any, {
      query: 'Line',
      entity_types: ['spend_items', 'capex_items'],
      limit: 10,
    });

    const refs = Object.fromEntries((result.items as any[]).map((item) => [item.type, item.ref]));
    assert.deepEqual(refs, { spend_items: 'OPX-12', capex_items: 'CPX-4' });
  });
}

async function run() {
  await testLegacySearchAllCastsNonTextFieldsBeforeLike();
  await testLegacySearchAllReportsPartialEntityFailures();
  await testLegacySearchAllGivesBudgetLineReferences();
  await testIndexedSearchAllRunsSingleSearchIndexQuery();
  await testIndexedSearchAllAppliesParticipationScope();
  await testIndexedSearchAllAppliesDocumentLibraryAcl();
  await testIndexedRowsMapToLegacyDtoShape();
  await testIndexedRowsMapToLegacyDtoShape({
    criticality: 'business_custom',
    cyber_criticality: 'cyber_custom',
    recovery_wave: 'wave_custom',
    data_class: 'confidentiality_custom',
    rto_minutes: 60,
    rpo_minutes: 0,
  });
}

void run();
