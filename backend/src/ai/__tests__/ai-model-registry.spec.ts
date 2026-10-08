import * as assert from 'node:assert/strict';
import { llmCostEur } from '../ai-llm-cost.util';
import { estimateReplySynthesisUsage } from '../control-plane/agent-control/ai-reply-synthesis.service';
import { AiModelConfig } from '../ai-model-config.entity';
import { AiModelConfigService } from '../ai-model-config.service';
import { AiModelResolutionError, AiModelResolverService } from '../ai-model-resolver.service';
import { AiSettings } from '../ai-settings.entity';
import { AiAgentDefinition } from '../control-plane/entities/ai-agent-definition.entity';
import { AiModelConfigs1853400000000 } from '../../migrations/1853400000000-ai-model-configs';
import { Features } from '../../config/features';

// ---------------------------------------------------------------------------
// Shared in-memory state + mock TypeORM plumbing
// ---------------------------------------------------------------------------

type MockAgent = { id: string; tenant_id: string; name: string; llm_model_config_id: string | null };

type State = {
  configs: AiModelConfig[];
  settings: { tenant_id: string; chat_model_config_id: string | null; builtin_accepted_key?: string | null } | null;
  agents: MockAgent[];
  seq: number;
};

function createState(overrides?: Partial<State>): State {
  return {
    configs: [],
    settings: null,
    agents: [],
    seq: 0,
    ...overrides,
  };
}

function createConfig(overrides?: Partial<AiModelConfig>): AiModelConfig {
  return {
    id: 'cfg-1',
    tenant_id: 'tenant-1',
    name: 'My model',
    provider: 'openai',
    model: 'gpt-4o-mini',
    endpoint_url: null,
    api_key_encrypted: null,
    supports_vision: true,
    price_input_eur_per_mtok: null,
    price_output_eur_per_mtok: null,
    llm_timeout_ms: null,
    status: 'active',
    is_default: false,
    updated_by: null,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createConfigRepo(state: State) {
  const repo: any = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      if (!entity.id) entity.id = `cfg-gen-${++state.seq}`;
      if (!entity.created_at) entity.created_at = new Date();
      if (!entity.updated_at) entity.updated_at = new Date();
      const index = state.configs.findIndex((c) => c.id === entity.id);
      if (index >= 0) state.configs[index] = entity;
      else state.configs.push(entity);
      return entity;
    },
    findOne: async ({ where }: any) =>
      state.configs.find((c) => Object.entries(where).every(([k, v]) => (c as any)[k] === v)) ?? null,
    createQueryBuilder: () => {
      const params: Record<string, any> = {};
      const qb: any = {
        addSelect: () => qb,
        select: () => qb,
        orderBy: () => qb,
        addOrderBy: () => qb,
        where: (_cond: string, p?: any) => {
          Object.assign(params, p);
          return qb;
        },
        andWhere: (_cond: string, p?: any) => {
          Object.assign(params, p);
          return qb;
        },
        update: () => qb,
        set: () => qb,
        // Only used by clearDefault(): tenant_id = :tenantId AND is_default = true
        execute: async () => {
          for (const c of state.configs) {
            if (c.tenant_id === params.tenantId && c.is_default) c.is_default = false;
          }
          return {};
        },
        getOne: async () =>
          state.configs.find(
            (c) =>
              (params.id == null || c.id === params.id)
              && (params.configId == null || c.id === params.configId)
              && (params.tenantId == null || c.tenant_id === params.tenantId)
              && (params.status == null || c.status === params.status),
          ) ?? null,
        getMany: async () => state.configs.filter((c) => c.tenant_id === params.tenantId),
      };
      return qb;
    },
  };
  return repo;
}

function createSettingsRepo(state: State) {
  return {
    findOne: async ({ where }: any) =>
      state.settings && state.settings.tenant_id === where.tenant_id ? state.settings : null,
  };
}

function createAgentRepo(state: State) {
  return {
    findOne: async ({ where }: any) =>
      state.agents.find((a) => a.id === where.id && a.tenant_id === where.tenant_id) ?? null,
    createQueryBuilder: () => {
      const params: Record<string, any> = {};
      const qb: any = {
        select: () => qb,
        where: (_cond: string, p?: any) => {
          Object.assign(params, p);
          return qb;
        },
        andWhere: (_cond: string, p?: any) => {
          Object.assign(params, p);
          return qb;
        },
        getMany: async () =>
          state.agents.filter(
            (a) =>
              a.tenant_id === params.tenantId
              && a.llm_model_config_id != null
              && (params.configIds as string[]).includes(a.llm_model_config_id),
          ),
      };
      return qb;
    },
  };
}

function createManager(state: State) {
  const configRepo = createConfigRepo(state);
  const settingsRepo = createSettingsRepo(state);
  const agentRepo = createAgentRepo(state);
  return {
    getRepository(entity: unknown) {
      if (entity === AiModelConfig) return configRepo;
      if (entity === AiSettings) return settingsRepo;
      if (entity === AiAgentDefinition) return agentRepo;
      throw new Error(`Unexpected repository request: ${String(entity)}`);
    },
    query: async () => [],
  };
}

const mockCipher = {
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => (v.startsWith('enc:') ? v.slice('enc:'.length) : v),
  canEncrypt: () => true,
};

function createRegistryMock(validateResult: string[] = []) {
  const calls: any[] = [];
  return {
    calls,
    get: (providerId: string | null | undefined) =>
      ['anthropic', 'openai', 'ollama', 'custom'].includes(providerId ?? '') ? { id: providerId } : null,
    validate: (snapshot: any) => {
      calls.push(snapshot);
      return validateResult;
    },
  };
}

function createResolver(state: State, opts?: { platformConfigured?: boolean; registry?: any }) {
  const manager = createManager(state);
  const platform = {
    isConfigured: async () => opts?.platformConfigured !== false,
    getBuiltinIdentity: async () => ({ name: 'Anthropic', location: 'US', key: 'anthropic||Anthropic|US' }),
    getRuntimeConfig: async () => ({
      provider: 'anthropic',
      model: 'claude-builtin',
      endpoint_url: null,
      apiKey: 'platform-key',
    }),
  };
  const registry = opts?.registry ?? createRegistryMock();
  const resolver = new AiModelResolverService(
    { manager } as any,
    { manager } as any,
    { manager } as any,
    platform as any,
    registry as any,
    mockCipher as any,
  );
  const warnings: string[] = [];
  (resolver as any).logger = {
    warn: (msg: string) => warnings.push(msg),
    log: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  return { resolver, warnings, registry };
}

function createService(state: State, opts?: { registry?: any }) {
  const manager = createManager(state);
  const registry = opts?.registry ?? createRegistryMock();
  const service = new AiModelConfigService({ manager } as any, registry as any, mockCipher as any);
  return { service, registry };
}

// ---------------------------------------------------------------------------
// 1. AiModelResolverService — resolution chain
// ---------------------------------------------------------------------------

async function testResolverExplicitChatAssignment() {
  const state = createState({
    configs: [
      createConfig({
        id: 'cfg-1',
        name: 'Team GPT',
        api_key_encrypted: 'enc:sk-secret',
        price_input_eur_per_mtok: '1.2500',
        price_output_eur_per_mtok: '3.0000',
        llm_timeout_ms: 60000,
        endpoint_url: 'https://api.example.com/v1',
      }),
    ],
    settings: { tenant_id: 'tenant-1', chat_model_config_id: 'cfg-1' },
  });
  const { resolver, warnings } = createResolver(state);

  const resolved = await resolver.resolve('tenant-1', { type: 'chat' });

  assert.equal(resolved.source, 'registry');
  assert.equal(resolved.configId, 'cfg-1');
  assert.equal(resolved.configName, 'Team GPT');
  assert.equal(resolved.provider, 'openai');
  assert.equal(resolved.model, 'gpt-4o-mini');
  assert.equal(resolved.endpointUrl, 'https://api.example.com/v1');
  // Decrypted through the cipher, not the stored ciphertext.
  assert.equal(resolved.apiKey, 'sk-secret');
  // Numeric columns come back as strings from TypeORM; resolver parses them.
  assert.equal(resolved.priceInputEurPerMtok, 1.25);
  assert.equal(resolved.priceOutputEurPerMtok, 3);
  assert.equal(resolved.timeoutMs, 60000);
  assert.equal(resolved.supportsVision, true);
  assert.equal(warnings.length, 0);
}

async function testResolverArchivedAssignmentFallsThroughToDefault() {
  const state = createState({
    configs: [
      createConfig({ id: 'cfg-archived', name: 'Old', status: 'archived' }),
      createConfig({ id: 'cfg-default', name: 'Default', is_default: true, api_key_encrypted: 'enc:default-key' }),
    ],
    settings: { tenant_id: 'tenant-1', chat_model_config_id: 'cfg-archived' },
  });
  const { resolver, warnings } = createResolver(state);

  const resolved = await resolver.resolve('tenant-1', { type: 'chat' });

  assert.equal(resolved.source, 'registry');
  assert.equal(resolved.configId, 'cfg-default');
  assert.equal(resolved.apiKey, 'default-key');
  // The dangling/archived assignment must produce an ops warning, never a silent fallback.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cfg-archived/);
  assert.match(warnings[0], /archived or missing/);
  assert.match(warnings[0], /consumer=chat/);
}

async function testResolverNoAssignmentUsesActiveDefault() {
  const state = createState({
    configs: [
      createConfig({ id: 'cfg-other', name: 'Other' }),
      createConfig({ id: 'cfg-default', name: 'Default', is_default: true }),
    ],
    settings: { tenant_id: 'tenant-1', chat_model_config_id: null },
  });
  const { resolver, warnings } = createResolver(state);

  const resolved = await resolver.resolve('tenant-1', { type: 'chat' });

  assert.equal(resolved.source, 'registry');
  assert.equal(resolved.configId, 'cfg-default');
  assert.equal(warnings.length, 0);
}

async function testResolverBuiltinFallbackInMultiTenant() {
  // Runs without DEPLOYMENT_MODE → multi-tenant (Features.SINGLE_TENANT false).
  assert.equal(Features.SINGLE_TENANT, false, 'spec must run without DEPLOYMENT_MODE set');

  // The workspace confirmed the included model (ai-included-model-confirmation.spec covers the rule).
  const configured = createResolver(createState({
    settings: { tenant_id: 'tenant-1', chat_model_config_id: null, builtin_accepted_key: 'anthropic||Anthropic|US' },
  }));
  const resolved = await configured.resolver.resolve('tenant-1', { type: 'chat' });
  assert.equal(resolved.source, 'builtin');
  assert.equal(resolved.configId, null);
  assert.equal(resolved.configName, null);
  assert.equal(resolved.provider, 'anthropic');
  assert.equal(resolved.model, 'claude-builtin');
  assert.equal(resolved.apiKey, 'platform-key');
  assert.equal(resolved.supportsVision, true);
  // Builtin model is operator-billed: zero tenant-facing prices, not null.
  assert.equal(resolved.priceInputEurPerMtok, 0);
  assert.equal(resolved.priceOutputEurPerMtok, 0);
  assert.equal(resolved.timeoutMs, null);

  const unconfigured = createResolver(createState(), { platformConfigured: false });
  await assert.rejects(
    () => unconfigured.resolver.resolve('tenant-1', { type: 'chat' }),
    (error: any) => error instanceof AiModelResolutionError && error.code === 'builtin_not_configured',
  );
}

async function testResolverSingleTenantWithoutModelThrowsTypedError() {
  const original = Features.SINGLE_TENANT;
  try {
    (Features as any).SINGLE_TENANT = true;
    const { resolver } = createResolver(createState());
    await assert.rejects(
      () => resolver.resolve('tenant-1', { type: 'chat' }),
      (error: any) =>
        error instanceof AiModelResolutionError
        && error.code === 'no_model_available'
        && /No AI model is configured/.test(error.message),
    );
    // tryResolve maps the typed error to null instead of throwing.
    assert.equal(await resolver.tryResolve('tenant-1', { type: 'chat' }), null);
  } finally {
    (Features as any).SINGLE_TENANT = original;
  }
}

async function testResolverAgentConsumerReadsAgentAssignment() {
  const state = createState({
    configs: [createConfig({ id: 'cfg-agent', name: 'Agent model' })],
    settings: { tenant_id: 'tenant-1', chat_model_config_id: null },
    agents: [{ id: 'agent-1', tenant_id: 'tenant-1', name: 'SRE agent', llm_model_config_id: 'cfg-agent' }],
  });
  const { resolver } = createResolver(state);

  const resolved = await resolver.resolve('tenant-1', { type: 'agent', agentId: 'agent-1' });
  assert.equal(resolved.source, 'registry');
  assert.equal(resolved.configId, 'cfg-agent');
}

async function testResolverValidationErrors() {
  // Builtin resolution → no provider validation, empty list.
  const builtin = createResolver(createState({
    settings: { tenant_id: 'tenant-1', chat_model_config_id: null, builtin_accepted_key: 'anthropic||Anthropic|US' },
  }));
  assert.deepEqual(await builtin.resolver.validationErrors('tenant-1', null), []);

  // Registry resolution → delegates to providerRegistry.validate with the config snapshot.
  const registry = createRegistryMock(['API key is required.']);
  const state = createState({
    configs: [
      createConfig({
        id: 'cfg-default',
        is_default: true,
        endpoint_url: 'https://api.example.com/v1',
        api_key_encrypted: 'enc:k',
      }),
    ],
  });
  const withDefault = createResolver(state, { registry });
  assert.deepEqual(await withDefault.resolver.validationErrors('tenant-1', null), ['API key is required.']);
  assert.equal(registry.calls.length, 1);
  assert.deepEqual(registry.calls[0], {
    llm_provider: 'openai',
    llm_model: 'gpt-4o-mini',
    llm_endpoint_url: 'https://api.example.com/v1',
    has_llm_api_key: true,
  });

  // Resolution error → surfaced as a single-message error list.
  const original = Features.SINGLE_TENANT;
  try {
    (Features as any).SINGLE_TENANT = true;
    const empty = createResolver(createState());
    const errors = await empty.resolver.validationErrors('tenant-1', null);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /No AI model is configured/);
  } finally {
    (Features as any).SINGLE_TENANT = original;
  }
}

// ---------------------------------------------------------------------------
// 2. AiModelConfigService — CRUD rules
// ---------------------------------------------------------------------------

async function testCreateEncryptsKeyAndNormalizesPrices() {
  const state = createState();
  const { service } = createService(state);

  const view = await service.create('tenant-1', {
    name: '  Team GPT  ',
    provider: 'openai',
    model: 'gpt-4o-mini',
    api_key: 'sk-secret',
    price_input_eur_per_mtok: 1.25,
    price_output_eur_per_mtok: 0,
  });

  assert.equal(view.name, 'Team GPT');
  assert.equal(view.has_api_key, true);
  assert.equal(view.status, 'active');
  assert.equal(view.is_default, false);
  // View exposes parsed numbers (0 = local/free model, kept distinct from null = unset).
  assert.equal(view.price_input_eur_per_mtok, 1.25);
  assert.equal(view.price_output_eur_per_mtok, 0);

  const stored = state.configs[0];
  assert.equal(stored.api_key_encrypted, 'enc:sk-secret');
  // Prices persisted as 4-decimal strings (numeric(12,4) convention).
  assert.equal(stored.price_input_eur_per_mtok, '1.2500');
  assert.equal(stored.price_output_eur_per_mtok, '0.0000');
}

async function testCreateRejectsBadProviderAndEmptyFields() {
  const { service } = createService(createState());

  await assert.rejects(
    () => service.create('tenant-1', { name: 'X', provider: 'deepmind', model: 'm' }),
    /Unsupported AI provider/,
  );
  await assert.rejects(
    () => service.create('tenant-1', { name: '   ', provider: 'openai', model: 'm' }),
    /name is required/,
  );
  await assert.rejects(
    () => service.create('tenant-1', { name: 'X', provider: 'openai', model: '   ' }),
    /model is required/,
  );
  await assert.rejects(
    () => service.create('tenant-1', { name: 'X', provider: 'openai', model: 'm', price_input_eur_per_mtok: -1 }),
    /price_input_eur_per_mtok must be a non-negative number/,
  );
}

async function testUpdateOnArchivedEntryRejected() {
  const state = createState({
    configs: [createConfig({ id: 'cfg-1', status: 'archived' })],
  });
  const { service } = createService(state);

  await assert.rejects(
    () => service.update('tenant-1', 'cfg-1', { name: 'New name' }),
    /archived AI model configuration cannot be edited/,
  );
}

async function testArchiveBlockedWhileAssigned() {
  const state = createState({
    configs: [createConfig({ id: 'cfg-1' })],
    settings: { tenant_id: 'tenant-1', chat_model_config_id: 'cfg-1' },
    agents: [{ id: 'agent-1', tenant_id: 'tenant-1', name: 'SRE agent', llm_model_config_id: 'cfg-1' }],
  });
  const { service } = createService(state);

  await assert.rejects(
    () => service.archive('tenant-1', 'cfg-1'),
    (error: any) => {
      const response = typeof error.getResponse === 'function' ? error.getResponse() : error.response;
      assert.equal(error.constructor.name, 'ConflictException');
      assert.match(String(response.message), /still assigned and cannot be archived/);
      assert.deepEqual(response.used_by, ['Plaid', 'SRE agent']);
      return true;
    },
  );
  // Nothing was mutated.
  assert.equal(state.configs[0].status, 'active');
}

async function testArchiveSucceedsWhenUnassignedAndClearsDefault() {
  const state = createState({
    configs: [createConfig({ id: 'cfg-1', is_default: true })],
    settings: { tenant_id: 'tenant-1', chat_model_config_id: null },
  });
  const { service } = createService(state);

  const view = await service.archive('tenant-1', 'cfg-1');

  assert.equal(view.status, 'archived');
  assert.equal(view.is_default, false);
  assert.equal(state.configs[0].status, 'archived');
  assert.equal(state.configs[0].is_default, false);
}

async function testSetDefaultOnArchivedEntryRejected() {
  const state = createState({
    configs: [createConfig({ id: 'cfg-1', status: 'archived' })],
  });
  const { service } = createService(state);

  await assert.rejects(
    () => service.setDefault('tenant-1', 'cfg-1'),
    /archived AI model configuration cannot be the default/,
  );
}

async function testSetDefaultDemotesPreviousDefault() {
  const state = createState({
    configs: [
      createConfig({ id: 'cfg-old', name: 'Old default', is_default: true }),
      createConfig({ id: 'cfg-new', name: 'New default' }),
    ],
    settings: { tenant_id: 'tenant-1', chat_model_config_id: null },
  });
  const { service } = createService(state);

  const view = await service.setDefault('tenant-1', 'cfg-new');

  assert.equal(view.is_default, true);
  assert.equal(state.configs.find((c) => c.id === 'cfg-old')!.is_default, false);
  assert.equal(state.configs.find((c) => c.id === 'cfg-new')!.is_default, true);
}

async function testEndpointUrlValidation() {
  const { service } = createService(createState());

  await assert.rejects(
    () => service.create('tenant-1', { name: 'X', provider: 'openai', model: 'm', endpoint_url: 'not a url' }),
    /endpoint_url must be a valid HTTP\(S\) URL/,
  );
  await assert.rejects(
    () => service.create('tenant-1', { name: 'X', provider: 'openai', model: 'm', endpoint_url: 'ftp://example.com' }),
    /endpoint_url must use http:\/\/ or https:\/\//,
  );
  // assertPublicHttpUrl enforces the private-IP block only in multi-tenant mode
  // (the default here: DEPLOYMENT_MODE unset). On-prem would accept this URL.
  await assert.rejects(
    () => service.create('tenant-1', { name: 'X', provider: 'ollama', model: 'm', endpoint_url: 'http://10.0.0.5:11434' }),
    /private or internal/i,
  );

  const state = createState();
  const { service: okService } = createService(state);
  const view = await okService.create('tenant-1', {
    name: 'X',
    provider: 'openai',
    model: 'm',
    endpoint_url: 'https://api.deepseek.com/v1',
  });
  assert.equal(view.endpoint_url, 'https://api.deepseek.com/v1');
}

// ---------------------------------------------------------------------------
// 3. Migration — backfill SQL ordering sanity (no DB)
// ---------------------------------------------------------------------------

async function testMigrationBackfillOrdering() {
  const queries: string[] = [];
  const queryRunner = {
    query: async (sql: string) => {
      queries.push(sql);
      return [];
    },
  };

  const migration = new AiModelConfigs1853400000000();
  await migration.up(queryRunner as any);

  const indexOf = (predicate: (sql: string) => boolean, label: string): number => {
    const index = queries.findIndex(predicate);
    assert.notEqual(index, -1, `expected a query matching: ${label}`);
    return index;
  };

  const createTable = indexOf(
    (sql) => sql.includes('CREATE TABLE IF NOT EXISTS ai_model_configs'),
    'CREATE TABLE ai_model_configs',
  );
  const addChatColumn = indexOf(
    (sql) => sql.includes('ALTER TABLE ai_settings') && sql.includes('ADD COLUMN IF NOT EXISTS chat_model_config_id'),
    'ALTER TABLE ai_settings ADD COLUMN chat_model_config_id',
  );
  const disableRls = indexOf(
    (sql) => sql.includes('ALTER TABLE ai_settings DISABLE ROW LEVEL SECURITY'),
    'ai_settings DISABLE RLS',
  );
  const backfill = indexOf(
    (sql) => sql.includes('INSERT INTO ai_model_configs') && sql.includes('SELECT'),
    'backfill INSERT...SELECT',
  );
  const enableRls = indexOf(
    (sql) => sql.includes('ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY'),
    'ai_settings ENABLE RLS',
  );
  const createPolicy = indexOf(
    (sql) => sql.includes('CREATE POLICY ai_model_configs_tenant_isolation'),
    'ai_model_configs RLS policy',
  );

  // Table must exist before consumers reference it via FK.
  assert.ok(createTable < addChatColumn, 'CREATE TABLE must precede the ai_settings FK column');
  // Backfill runs inside the ai_settings RLS bypass window.
  assert.ok(disableRls < backfill, 'backfill must run after ai_settings RLS is disabled');
  assert.ok(backfill < enableRls, 'backfill must run before ai_settings RLS is re-enabled');
  // RLS on the new table is turned on only after the cross-tenant backfill.
  assert.equal(createPolicy, queries.length - 1, 'ai_model_configs policy creation must be the last statement');

  // Only tenants running a custom provider get a migrated registry entry.
  assert.match(queries[backfill], /provider_source = 'custom'/);
  assert.match(queries[backfill], /llm_provider IS NOT NULL/);
  // The migrated entry becomes the chat assignment for its tenant.
  assert.match(queries[backfill], /SET chat_model_config_id = m\.id/);
}

// ---------------------------------------------------------------------------

async function testLlmCostEurMath() {
  // Real usage priced per direction: 500k in at 3 €/Mtok + 100k out at 15 €/Mtok.
  assert.equal(llmCostEur(500_000, 100_000, { priceInputEurPerMtok: 3, priceOutputEurPerMtok: 15 }), 3);
  // Null, zero, or missing prices → free model, zero cost.
  assert.equal(llmCostEur(1_000_000, 1_000_000, { priceInputEurPerMtok: null, priceOutputEurPerMtok: null }), 0);
  assert.equal(llmCostEur(1_000_000, 1_000_000, { priceInputEurPerMtok: 0, priceOutputEurPerMtok: 0 }), 0);
  assert.equal(llmCostEur(1_000_000, 1_000_000, null), 0);
  // One-sided pricing and rounding to 6 decimals.
  assert.equal(llmCostEur(100, 0, { priceInputEurPerMtok: 2, priceOutputEurPerMtok: null }), 0.0002);
  assert.equal(llmCostEur(1, 1, { priceInputEurPerMtok: 2, priceOutputEurPerMtok: 2 }), 0.000004);
  // Negative token counts (defensive) never produce negative costs.
  assert.equal(llmCostEur(-100, -100, { priceInputEurPerMtok: 2, priceOutputEurPerMtok: 2 }), 0);
}

async function testLoadMessageCountsSumsChatAndAgentRows() {
  const state = createState({
    configs: [
      createConfig({ id: 'cfg-1', provider: 'openai', model: 'deepseek-v4' }),
      createConfig({ id: 'cfg-2', provider: 'anthropic', model: 'claude-sonnet-5' }),
    ],
  });
  const manager = createManager(state);
  (manager as any).query = async (sql: string) => {
    if (sql.includes('ai_messages')) {
      return [
        { provider: 'openai', model: 'deepseek-v4', messages: 4 },
        { provider: 'anthropic', model: 'claude-sonnet-5', messages: 1 },
      ];
    }
    if (sql.includes('ai_runs')) {
      return [
        { model_key: 'openai:deepseek-v4', messages: 7 },
      ];
    }
    return [];
  };
  const registry = createRegistryMock();
  const service = new AiModelConfigService({ manager } as any, registry as any, mockCipher as any);

  const counts = await service.loadMessageCounts('tenant-1', state.configs, manager as any);
  assert.equal(counts.get('cfg-1'), 11);
  assert.equal(counts.get('cfg-2'), 1);
}

async function testEstimatorsPriceByAssignedModel() {
  const prices = { priceInputEurPerMtok: 10, priceOutputEurPerMtok: 20 };
  const input = { systemPrompt: 'x', userPayload: { a: 'b' } };
  const priced = estimateReplySynthesisUsage(input, prices, 1000);
  const free = estimateReplySynthesisUsage(input, null, 1000);
  // Token projection identical; only pricing differs.
  assert.equal(priced.estimatedTokens, free.estimatedTokens);
  assert.equal(free.estimatedCostEur, 0);
  const inputTokens = priced.estimatedTokens - 1000;
  assert.equal(priced.estimatedCostEur, llmCostEur(inputTokens, 1000, prices));
  assert.ok(priced.estimatedCostEur > 0);
}

async function run() {
  const tests = [
    testLlmCostEurMath,
    testEstimatorsPriceByAssignedModel,
    testResolverExplicitChatAssignment,
    testResolverArchivedAssignmentFallsThroughToDefault,
    testResolverNoAssignmentUsesActiveDefault,
    testResolverBuiltinFallbackInMultiTenant,
    testResolverSingleTenantWithoutModelThrowsTypedError,
    testResolverAgentConsumerReadsAgentAssignment,
    testResolverValidationErrors,
    testCreateEncryptsKeyAndNormalizesPrices,
    testCreateRejectsBadProviderAndEmptyFields,
    testUpdateOnArchivedEntryRejected,
    testArchiveBlockedWhileAssigned,
    testArchiveSucceedsWhenUnassignedAndClearsDefault,
    testSetDefaultOnArchivedEntryRejected,
    testSetDefaultDemotesPreviousDefault,
    testEndpointUrlValidation,
    testLoadMessageCountsSumsChatAndAgentRows,
    testMigrationBackfillOrdering,
  ];
  for (const test of tests) {
    await test();
    console.log(`${test.name}: all assertions passed`);
  }
}

void run();
