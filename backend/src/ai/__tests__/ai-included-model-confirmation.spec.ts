import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Features } from '../../config/features';
import { Subscription } from '../../billing/subscription.entity';
import { Tenant, TenantStatus } from '../../tenants/tenant.entity';
import { UserRole } from '../../users/user-role.entity';
import { AiMcpController } from '../ai-mcp.controller';
import { AiModelConfig } from '../ai-model-config.entity';
import { AiModelResolutionError, AiModelResolverService, BUILTIN_NOT_ACCEPTED_MESSAGE } from '../ai-model-resolver.service';
import { AiPolicyService } from '../ai-policy.service';
import { AiSettings } from '../ai-settings.entity';
import {
  AiSettingsService,
  BUILTIN_PROVIDER_CHANGED,
  BUILTIN_PROVIDER_CONFIRMATION_REQUIRED,
} from '../ai-settings.service';
import { AiAgentLlmClient } from '../control-plane/agent-control/ai-agent-llm-client';
import {
  AGENT_RUNS_AWAIT_BUILTIN_CONFIRMATION,
  AiAgentBuiltinQuotaService,
} from '../control-plane/agent/ai-agent-builtin-quota.service';
import { AiAgentDefinition } from '../control-plane/entities/ai-agent-definition.entity';
import { UpdateAiSettingsDto } from '../dto/update-ai-settings.dto';
import { PlatformAiConfig } from '../platform/platform-ai-config.entity';
import { builtinProviderKey, endpointHostOf, PlatformAiConfigService } from '../platform/platform-ai-config.service';

// The KANAP included model is used for a workspace only once one of its administrators
// has confirmed the identity the platform shows: technical provider and endpoint host,
// provider name and processing location (a new model alone keeps it). Covers:
// the resolver (single choice point, one read of the platform record), the settings PATCH
// (confirm, activate, withdraw, audit, view), agent runs and the included quota, MCP
// (sends nothing to the included model: works and counts as before), the capabilities the
// interface reads, and the platform fields that define the identity.

const TENANT_ID = 'tenant-1';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const KEY_US = 'anthropic||Anthropic|US';

// ---------------------------------------------------------------------------
// In-memory plumbing
// ---------------------------------------------------------------------------

type Workspace = {
  settings: AiSettings | null;
  configs: AiModelConfig[];
  agents: Array<Pick<AiAgentDefinition, 'id' | 'tenant_id' | 'llm_model_config_id' | 'status'>>;
  users: Array<{ id: string; tenant_id: string; first_name: string | null; last_name: string | null; email: string }>;
  saves: number;
};

function settingsRow(overrides?: Partial<AiSettings>): AiSettings {
  return {
    id: 'settings-1',
    tenant_id: TENANT_ID,
    chat_enabled: false,
    mcp_enabled: false,
    provider_source: 'builtin',
    chat_model_config_id: null,
    llm_provider: null,
    llm_api_key_encrypted: null,
    llm_endpoint_url: null,
    llm_model: null,
    mcp_key_max_lifetime_days: null,
    conversation_retention_days: null,
    web_search_enabled: false,
    llm_supports_vision: true,
    glpi_enabled: false,
    glpi_url: null,
    glpi_user_token_encrypted: null,
    glpi_app_token_encrypted: null,
    builtin_accepted_key: null,
    builtin_accepted_at: null,
    builtin_accepted_by: null,
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    updated_at: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function registryModel(overrides?: Partial<AiModelConfig>): AiModelConfig {
  return {
    id: 'cfg-own',
    tenant_id: TENANT_ID,
    name: 'Our model',
    provider: 'openai',
    model: 'gpt-4o-mini',
    endpoint_url: null,
    api_key_encrypted: 'enc:own-key',
    supports_vision: true,
    price_input_eur_per_mtok: null,
    price_output_eur_per_mtok: null,
    llm_timeout_ms: null,
    status: 'active',
    is_default: false,
    updated_by: null,
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    updated_at: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as AiModelConfig;
}

function workspace(overrides?: Partial<Workspace>): Workspace {
  return {
    settings: settingsRow(),
    configs: [],
    agents: [{ id: 'agent-1', tenant_id: TENANT_ID, llm_model_config_id: null, status: 'enabled' }],
    users: [{ id: ADMIN_ID, tenant_id: TENANT_ID, first_name: 'Ada', last_name: 'Martin', email: 'ada@example.com' }],
    saves: 0,
    ...overrides,
  };
}

function queryBuilder(resolve: (params: Record<string, any>) => any) {
  const params: Record<string, any> = {};
  const qb: any = {
    addSelect: () => qb,
    where: (_condition: string, values?: Record<string, any>) => {
      Object.assign(params, values);
      return qb;
    },
    andWhere: (_condition: string, values?: Record<string, any>) => {
      Object.assign(params, values);
      return qb;
    },
    getOne: async () => resolve(params),
  };
  return qb;
}

function createManager(ws: Workspace) {
  const matches = (row: any, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => row[key] === value);
  const settingsRepo = {
    findOne: async ({ where }: any) => (ws.settings && ws.settings.tenant_id === where.tenant_id ? { ...ws.settings } : null),
    createQueryBuilder: () => queryBuilder((params) => (
      ws.settings && ws.settings.tenant_id === params.tenantId ? { ...ws.settings } : null
    )),
    create: (data: Partial<AiSettings>) => settingsRow({ id: 'settings-created', ...data }),
    save: async (entity: AiSettings) => {
      ws.saves += 1;
      ws.settings = { ...entity };
      return { ...entity };
    },
  };
  const configRepo = {
    findOne: async ({ where }: any) => ws.configs.find((config) => matches(config, where)) ?? null,
    createQueryBuilder: () => queryBuilder((params) => ws.configs.find((config) => (
      config.id === params.configId && config.tenant_id === params.tenantId && config.status === params.status
    )) ?? null),
  };
  const agentRepo = {
    findOne: async ({ where }: any) => ws.agents.find((agent) => matches(agent, where)) ?? null,
  };
  return {
    getRepository(entity: unknown) {
      if (entity === AiSettings) return settingsRepo;
      if (entity === AiModelConfig) return configRepo;
      if (entity === AiAgentDefinition) return agentRepo;
      if (entity === Tenant) return { findOne: async () => ({ id: TENANT_ID, status: TenantStatus.ACTIVE }) };
      if (entity === UserRole) return { find: async () => [] };
      if (entity === Subscription) return { findOne: async () => null };
      throw new Error(`Unexpected repository request: ${String(entity)}`);
    },
    query: async (sql: string, params: unknown[]) => {
      if (/FROM users/.test(sql)) {
        return ws.users
          .filter((user) => user.id === params[0] && user.tenant_id === params[1])
          .map((user) => ({ first_name: user.first_name, last_name: user.last_name }));
      }
      if (/FROM ai_agent_definitions d/.test(sql)) {
        // Enabled agents of the workspace on the fallback model: none of their own, or one no longer active.
        const activeConfig = (id: string) => ws.configs.some((config) => (
          config.id === id && config.tenant_id === params[0] && config.status === 'active'
        ));
        return ws.agents
          .filter((agent) => agent.tenant_id === params[0] && agent.status === 'enabled')
          .filter((agent) => agent.llm_model_config_id == null || !activeConfig(agent.llm_model_config_id))
          .slice(0, 1)
          .map(() => ({ '?column?': 1 }));
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;
}

const cipher = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => (value.startsWith('enc:') ? value.slice(4) : value),
  canEncrypt: () => true,
};

const adapter = { createStream: () => { throw new Error('no LLM call in these tests'); } };
const providerRegistry = {
  get: (id: string | null | undefined) => (['anthropic', 'openai', 'ollama', 'custom'].includes(id ?? '') ? adapter : null),
  validate: () => [] as string[],
  list: () => [],
};

type PlatformRecord = Partial<PlatformAiConfig>;

/** The real PlatformAiConfigService over a one-row store (the platform singleton). */
function createPlatform(record: PlatformRecord | null = {}) {
  const state: { record: PlatformAiConfig | null } = {
    record: record
      ? {
        id: 'platform-1',
        singleton: true,
        provider: 'anthropic',
        model: 'claude-included-1',
        api_key_encrypted: 'enc:platform-key',
        endpoint_url: null,
        rate_limit_tenant_per_minute: 30,
        rate_limit_user_per_hour: 60,
        updated_at: new Date('2026-09-01T00:00:00.000Z'),
        updated_by: null,
        disclosure_name: 'Anthropic',
        disclosure_location: 'US',
        ...record,
      } as PlatformAiConfig
      : null,
  };
  const audits: any[] = [];
  const dataSource = {
    getRepository: () => ({
      createQueryBuilder: () => queryBuilder(() => (state.record ? { ...state.record } : null)),
    }),
    query: async (_sql: string, params: any[]) => {
      const [provider, model, apiKey, endpointUrl, tenantLimit, userLimit, updatedBy, disclosureName, disclosureLocation] = params;
      state.record = {
        ...(state.record ?? { id: 'platform-1', singleton: true }),
        provider,
        model,
        api_key_encrypted: apiKey,
        endpoint_url: endpointUrl,
        rate_limit_tenant_per_minute: tenantLimit,
        rate_limit_user_per_hour: userLimit,
        updated_by: updatedBy,
        updated_at: new Date(),
        disclosure_name: disclosureName,
        disclosure_location: disclosureLocation,
      } as PlatformAiConfig;
      return [{ id: state.record.id }];
    },
  };
  const service = new PlatformAiConfigService(
    dataSource as any,
    providerRegistry as any,
    cipher as any,
    { log: async (entry: any) => { audits.push(entry); } } as any,
  );
  return { service, state, audits };
}

function createStack(ws: Workspace, platform = createPlatform()) {
  const manager = createManager(ws);
  const resolver = new AiModelResolverService(
    { manager } as any,
    { manager } as any,
    { manager } as any,
    platform.service,
    providerRegistry as any,
    cipher as any,
  );
  (resolver as any).logger = { warn: () => undefined, log: () => undefined, error: () => undefined };
  const audits: any[] = [];
  const settings = new AiSettingsService(
    { manager } as any,
    providerRegistry as any,
    cipher as any,
    platform.service,
    resolver,
    { log: async (entry: any) => { audits.push(entry); } } as any,
  );
  return { manager, resolver, settings, platform, audits };
}

async function withFeatures<T>(flags: Partial<Record<'SINGLE_TENANT' | 'AI_CHAT_ENABLED' | 'AI_MCP_ENABLED' | 'AI_SETTINGS_ENABLED', boolean>>, fn: () => Promise<T>): Promise<T> {
  const original: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(flags)) {
    original[name] = (Features as any)[name];
    (Features as any)[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(original)) {
      (Features as any)[name] = value;
    }
  }
}

function isResolutionError(code: string) {
  return (error: unknown) => error instanceof AiModelResolutionError && error.code === code;
}

function badRequestBody(error: unknown): any {
  assert.ok(error instanceof BadRequestException, `expected a 400, got ${String(error)}`);
  return error.getResponse();
}

// ---------------------------------------------------------------------------
// 1. Resolution
// ---------------------------------------------------------------------------

async function testIncludedModelNeedsTheWorkspaceConfirmation() {
  assert.equal(Features.SINGLE_TENANT, false, 'spec must run without DEPLOYMENT_MODE set');

  const unconfirmed = createStack(workspace());
  await assert.rejects(() => unconfirmed.resolver.resolve(TENANT_ID, { type: 'chat' }, unconfirmed.manager), isResolutionError('builtin_not_accepted'));
  await assert.rejects(
    () => unconfirmed.resolver.resolve(TENANT_ID, { type: 'agent', agentId: 'agent-1' }, unconfirmed.manager),
    isResolutionError('builtin_not_accepted'),
  );
  assert.equal(await unconfirmed.resolver.tryResolve(TENANT_ID, { type: 'chat' }, unconfirmed.manager), null);
  assert.deepEqual(await unconfirmed.resolver.validationErrors(TENANT_ID, null, unconfirmed.manager), [BUILTIN_NOT_ACCEPTED_MESSAGE]);

  const confirmed = createStack(workspace({ settings: settingsRow({ builtin_accepted_key: KEY_US }) }));
  const resolved = await confirmed.resolver.resolve(TENANT_ID, { type: 'chat' }, confirmed.manager);
  assert.equal(resolved.source, 'builtin');
  assert.equal(resolved.model, 'claude-included-1');
  assert.equal(resolved.apiKey, 'platform-key');
  assert.deepEqual(await confirmed.resolver.validationErrors(TENANT_ID, null, confirmed.manager), []);

  // A key passed for a payload not saved yet wins over the stored one.
  assert.deepEqual(
    await unconfirmed.resolver.validationErrors(TENANT_ID, null, unconfirmed.manager, { builtinAcceptedKey: KEY_US }),
    [],
  );
}

/**
 * The identity compared with the workspace's confirmation and the runtime returned come
 * from one read of the platform record: when the record changes during a resolution
 * (another process saved a new provider and the cache expired), the result is the
 * record that was confirmed, or a refusal, never the new runtime under the old
 * confirmation.
 */
async function testIdentityAndRuntimeComeFromOneRead() {
  const stack = createStack(workspace({ settings: settingsRow({ builtin_accepted_key: KEY_US }) }));
  const confirmedRecord = { ...stack.platform.state.record! } as PlatformAiConfig;
  const newRecord = {
    ...confirmedRecord,
    provider: 'openai',
    model: 'gpt-other',
    endpoint_url: 'https://other.example.com/v1',
    api_key_encrypted: 'enc:other-key',
    disclosure_name: 'Other provider',
    disclosure_location: 'EU',
  } as PlatformAiConfig;
  let reads = 0;
  (stack.platform.service as any).loadRecord = async () => {
    reads += 1;
    return reads === 1 ? { ...confirmedRecord } : { ...newRecord };
  };

  const resolved = await stack.resolver.resolve(TENANT_ID, { type: 'chat' }, stack.manager);
  assert.equal(reads, 1, 'one read of the platform record per resolution');
  assert.deepEqual(
    {
      provider: resolved.provider,
      model: resolved.model,
      endpointUrl: resolved.endpointUrl,
      apiKey: resolved.apiKey,
      builtinRateLimits: resolved.builtinRateLimits,
    },
    {
      provider: 'anthropic',
      model: 'claude-included-1',
      endpointUrl: null,
      apiKey: 'platform-key',
      builtinRateLimits: { tenantPerMinute: 30, userPerHour: 60 },
    },
    'the runtime of the record whose identity was confirmed',
  );

  // The next resolution reads the new record: refused under the old confirmation.
  await assert.rejects(() => stack.resolver.resolve(TENANT_ID, { type: 'chat' }, stack.manager), isResolutionError('builtin_not_accepted'));
  const agentRuntime = await new AiAgentLlmClient(stack.resolver, providerRegistry as any).resolveRuntime(agentContext(stack.manager) as any);
  assert.equal(agentRuntime, null, 'agents get no runtime either');
}

async function testNewNameOrLocationAsksAgainButNotANewModel() {
  const confirmedSettings = () => settingsRow({ builtin_accepted_key: KEY_US });

  const modelChange = createStack(workspace({ settings: confirmedSettings() }));
  await modelChange.platform.service.updateConfig({ model: 'claude-included-2' }, 'platform-admin');
  const resolved = await modelChange.resolver.resolve(TENANT_ID, { type: 'chat' }, modelChange.manager);
  assert.equal(resolved.model, 'claude-included-2', 'a new model at the same provider keeps the confirmation');

  const nameChange = createStack(workspace({ settings: confirmedSettings() }));
  await nameChange.platform.service.updateConfig({ disclosure_name: 'Anthropic PBC' }, 'platform-admin');
  await assert.rejects(() => nameChange.resolver.resolve(TENANT_ID, { type: 'chat' }, nameChange.manager), isResolutionError('builtin_not_accepted'));

  const locationChange = createStack(workspace({ settings: confirmedSettings() }));
  await locationChange.platform.service.updateConfig({ disclosure_location: 'EU' }, 'platform-admin');
  await assert.rejects(
    () => locationChange.resolver.resolve(TENANT_ID, { type: 'agent', agentId: 'agent-1' }, locationChange.manager),
    isResolutionError('builtin_not_accepted'),
  );
  assert.equal(await locationChange.resolver.tryResolve(TENANT_ID, { type: 'chat' }, locationChange.manager), null);

  // Another provider or endpoint host asks again, even with the shown name and location unchanged.
  const providerChange = createStack(workspace({ settings: confirmedSettings() }));
  await providerChange.platform.service.updateConfig(
    { provider: 'openai', model: 'gpt-included', disclosure_name: 'Anthropic', disclosure_location: 'US' },
    'platform-admin',
  );
  await assert.rejects(() => providerChange.resolver.resolve(TENANT_ID, { type: 'chat' }, providerChange.manager), isResolutionError('builtin_not_accepted'));

  const hostChange = createStack(workspace({ settings: confirmedSettings() }));
  await hostChange.platform.service.updateConfig(
    { endpoint_url: 'https://llm-gateway.example.com/v1', disclosure_name: 'Anthropic', disclosure_location: 'US' },
    'platform-admin',
  );
  await assert.rejects(() => hostChange.resolver.resolve(TENANT_ID, { type: 'chat' }, hostChange.manager), isResolutionError('builtin_not_accepted'));

  // Same host, another path: same endpoint for the key.
  const pathChange = createStack(
    workspace({ settings: settingsRow({ builtin_accepted_key: 'anthropic|api.anthropic.com|Anthropic|US' }) }),
    createPlatform({ endpoint_url: 'https://api.anthropic.com/v1' }),
  );
  await pathChange.platform.service.updateConfig(
    { endpoint_url: 'https://API.anthropic.com/v2', disclosure_name: 'Anthropic', disclosure_location: 'US' },
    'platform-admin',
  );
  assert.equal((await pathChange.resolver.resolve(TENANT_ID, { type: 'chat' }, pathChange.manager)).source, 'builtin');
}

async function testRegistryModelsNeverAskForConfirmation() {
  // Explicit assignment, for the assistant and for an agent.
  const assigned = createStack(workspace({
    settings: settingsRow({ chat_model_config_id: 'cfg-own' }),
    configs: [registryModel()],
    agents: [{ id: 'agent-1', tenant_id: TENANT_ID, llm_model_config_id: 'cfg-own', status: 'enabled' }],
  }));
  assert.equal((await assigned.resolver.resolve(TENANT_ID, { type: 'chat' }, assigned.manager)).source, 'registry');
  assert.equal((await assigned.resolver.resolve(TENANT_ID, { type: 'agent', agentId: 'agent-1' }, assigned.manager)).source, 'registry');

  // Workspace default model.
  const byDefault = createStack(workspace({ configs: [registryModel({ is_default: true })] }));
  assert.equal((await byDefault.resolver.resolve(TENANT_ID, { type: 'chat' }, byDefault.manager)).configId, 'cfg-own');
  assert.deepEqual(await byDefault.resolver.validationErrors(TENANT_ID, null, byDefault.manager), []);
}

async function testIncludedModelWithoutIdentityIsNotConfigured() {
  for (const record of [
    { disclosure_name: null },
    { disclosure_location: null },
    { disclosure_name: '   ' },
    { disclosure_location: 'usa' },
  ]) {
    const stack = createStack(workspace({ settings: settingsRow({ builtin_accepted_key: KEY_US }) }), createPlatform(record));
    await assert.rejects(
      () => stack.resolver.resolve(TENANT_ID, { type: 'chat' }, stack.manager),
      isResolutionError('builtin_not_configured'),
      JSON.stringify(record),
    );
    assert.equal((await stack.platform.service.getBuiltinRuntime())?.identity ?? null, null);
  }
}

async function testSingleTenantIsUnchanged() {
  await withFeatures({ SINGLE_TENANT: true }, async () => {
    const stack = createStack(workspace());
    await assert.rejects(() => stack.resolver.resolve(TENANT_ID, { type: 'chat' }, stack.manager), isResolutionError('no_model_available'));
    const readiness = await stack.resolver.readiness(TENANT_ID, null, stack.manager);
    assert.equal(readiness.errorCode, 'no_model_available');
    assert.equal(readiness.usesBuiltin, false);

    const own = createStack(workspace({ configs: [registryModel({ is_default: true })] }));
    assert.equal((await own.resolver.resolve(TENANT_ID, { type: 'chat' }, own.manager)).source, 'registry');
  });
}

// ---------------------------------------------------------------------------
// 2. Settings PATCH and view
// ---------------------------------------------------------------------------

async function testTurningOnTheAssistantNeedsConfirmation() {
  const ws = workspace();
  const stack = createStack(ws);
  let caught: unknown = null;
  try {
    await stack.settings.update(TENANT_ID, { chat_enabled: true }, { manager: stack.manager, userId: ADMIN_ID });
  } catch (error) {
    caught = error;
  }
  const body = badRequestBody(caught);
  assert.equal(body.code, BUILTIN_PROVIDER_CONFIRMATION_REQUIRED);
  assert.deepEqual(body.builtin_provider, { name: 'Anthropic', location: 'US', key: KEY_US });
  assert.equal(ws.saves, 0, 'nothing is written');
  assert.equal(stack.audits.length, 0, 'nothing is audited');
  assert.equal(ws.settings?.chat_enabled, false);
  assert.equal(ws.settings?.builtin_accepted_key, null);
}

async function testConfirmAndTurnOnInOneWrite() {
  const ws = workspace();
  const stack = createStack(ws);
  const before = Date.now();
  const saved = await stack.settings.update(
    TENANT_ID,
    { chat_enabled: true, accept_builtin_provider_key: KEY_US },
    { manager: stack.manager, userId: ADMIN_ID },
  );
  assert.equal(ws.saves, 1, 'one write');
  assert.equal(saved.chat_enabled, true);
  assert.equal(saved.builtin_accepted_key, KEY_US);
  assert.equal(saved.builtin_accepted_by, ADMIN_ID);
  assert.ok(saved.builtin_accepted_at instanceof Date && saved.builtin_accepted_at.getTime() >= before, 'confirmation date set');

  const view = await stack.settings.toView(saved, { manager: stack.manager });
  assert.equal(view.chat_ready, true);
  assert.deepEqual(view.builtin_provider, {
    in_use: true,
    used_by_assistant: true,
    name: 'Anthropic',
    location: 'US',
    key: KEY_US,
    accepted: true,
    accepted_at: saved.builtin_accepted_at!.toISOString(),
    accepted_by_name: 'Ada Martin',
  });

  // The audit records the confirmation (who, when, which provider), names only.
  assert.equal(stack.audits.length, 1);
  const audit = stack.audits[0];
  assert.equal(audit.table, 'ai_settings');
  assert.equal(audit.userId, ADMIN_ID);
  assert.equal(audit.before.builtin_provider.accepted, false);
  assert.equal(audit.after.builtin_provider.accepted, true);
  assert.equal(audit.after.builtin_provider.key, KEY_US);
  assert.equal(audit.after.builtin_provider.accepted_by_name, 'Ada Martin');
  assert.equal(JSON.stringify(audit.after.builtin_provider).includes('ada@example.com'), false);
  assert.equal(JSON.stringify(audit.after.builtin_provider).includes(ADMIN_ID), false);
}

async function testOutdatedKeyIsRefused() {
  const ws = workspace();
  const stack = createStack(ws);
  let caught: unknown = null;
  try {
    await stack.settings.update(
      TENANT_ID,
      { chat_enabled: true, accept_builtin_provider_key: 'anthropic||Anthropic|EU' },
      { manager: stack.manager, userId: ADMIN_ID },
    );
  } catch (error) {
    caught = error;
  }
  const body = badRequestBody(caught);
  assert.equal(body.code, BUILTIN_PROVIDER_CHANGED);
  assert.deepEqual(body.builtin_provider, { name: 'Anthropic', location: 'US', key: KEY_US }, 'the current identity, to show again');
  assert.equal(ws.saves, 0, 'nothing is written');
  assert.equal(ws.settings?.builtin_accepted_key, null);

  // Confirm only, stale screen: also refused.
  await assert.rejects(
    () => stack.settings.update(TENANT_ID, { accept_builtin_provider_key: 'anthropic||Anthropic|GB' }, { manager: stack.manager, userId: ADMIN_ID }),
    (error: unknown) => badRequestBody(error).code === BUILTIN_PROVIDER_CHANGED,
  );
  assert.equal(ws.saves, 0);
}

async function testWithdrawKeepsOtherSettingsSavable() {
  const ws = workspace({
    settings: settingsRow({
      chat_enabled: true,
      builtin_accepted_key: KEY_US,
      builtin_accepted_at: new Date('2026-09-02T08:00:00.000Z'),
      builtin_accepted_by: ADMIN_ID,
    }),
  });
  const stack = createStack(ws);
  const withdrawn = await stack.settings.update(
    TENANT_ID,
    { accept_builtin_provider_key: null },
    { manager: stack.manager, userId: ADMIN_ID },
  );
  assert.equal(withdrawn.builtin_accepted_key, null);
  assert.equal(withdrawn.builtin_accepted_at, null);
  assert.equal(withdrawn.builtin_accepted_by, null);
  assert.equal(withdrawn.chat_enabled, true, 'the assistant stays on and waits for a new confirmation');

  const view = await stack.settings.toView(withdrawn, { manager: stack.manager });
  assert.equal(view.chat_ready, false);
  assert.deepEqual(view.provider_validation_errors, [BUILTIN_NOT_ACCEPTED_MESSAGE]);
  assert.equal(view.builtin_provider.in_use, true);
  assert.equal(view.builtin_provider.accepted, false);
  assert.equal(view.builtin_provider.accepted_at, null);
  assert.equal(stack.audits[0].before.builtin_provider.accepted, true);
  assert.equal(stack.audits[0].after.builtin_provider.accepted, false);

  // Other settings still save while the assistant waits.
  const saved = await stack.settings.update(TENANT_ID, { mcp_enabled: true }, { manager: stack.manager, userId: ADMIN_ID });
  assert.equal(saved.mcp_enabled, true);

  // Sending chat_enabled: true again without confirming is refused.
  await assert.rejects(
    () => stack.settings.update(TENANT_ID, { chat_enabled: true }, { manager: stack.manager, userId: ADMIN_ID }),
    (error: unknown) => badRequestBody(error).code === BUILTIN_PROVIDER_CONFIRMATION_REQUIRED,
  );
}

async function testOwnModelTurnsOnWithoutConfirmation() {
  const ws = workspace({ configs: [registryModel({ is_default: true })] });
  const stack = createStack(ws);
  const saved = await stack.settings.update(TENANT_ID, { chat_enabled: true }, { manager: stack.manager, userId: ADMIN_ID });
  assert.equal(saved.chat_enabled, true);
  assert.equal(saved.builtin_accepted_key, null);
  const view = await stack.settings.toView(saved, { manager: stack.manager });
  assert.equal(view.chat_ready, true);
  assert.equal(view.builtin_provider.in_use, false);
  assert.equal(view.builtin_provider.accepted, false);
}

/**
 * The Provider card shows the confirmation when the assistant or the workspace's fallback
 * model (agents without a model of their own) lands on the included model.
 */
async function testCardShowsWhenAgentsFallBackOnIt() {
  // Assistant on a registry model of its own, no default model: agents fall back on the included model.
  const split = createStack(workspace({
    settings: settingsRow({ chat_enabled: true, chat_model_config_id: 'cfg-own' }),
    configs: [registryModel()],
  }));
  const splitSettings = await split.settings.get(TENANT_ID, { manager: split.manager });
  const splitView = await split.settings.toView(splitSettings, { manager: split.manager });
  assert.equal(splitView.chat_ready, true, 'the assistant runs on its own model');
  assert.equal(splitView.builtin_provider.in_use, true, 'shown for the agents');
  assert.equal(splitView.builtin_provider.used_by_assistant, false);
  assert.equal(splitView.builtin_provider.accepted, false);
  assert.equal(splitView.builtin_provider.key, KEY_US);

  // Confirming it from there works the same.
  const confirmed = await split.settings.update(TENANT_ID, { accept_builtin_provider_key: KEY_US }, { manager: split.manager, userId: ADMIN_ID });
  const confirmedView = await split.settings.toView(confirmed, { manager: split.manager });
  assert.equal(confirmedView.builtin_provider.in_use, true);
  assert.equal(confirmedView.builtin_provider.accepted, true);

  // A default registry model: everything runs on it, nothing to show.
  const byDefault = createStack(workspace({
    settings: settingsRow({ chat_enabled: true, chat_model_config_id: 'cfg-own' }),
    configs: [registryModel({ is_default: true })],
  }));
  const defaultSettings = await byDefault.settings.get(TENANT_ID, { manager: byDefault.manager });
  const defaultView = await byDefault.settings.toView(defaultSettings, { manager: byDefault.manager });
  assert.equal(defaultView.builtin_provider.in_use, false);
  assert.equal(defaultView.builtin_provider.used_by_assistant, false);
}

/** The confirmation key holds an endpoint host of up to 253 characters and a name of up to 80. */
async function testConfirmationKeyLength() {
  const host = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
  const longKey = builtinProviderKey({ provider: 'anthropic', endpointHost: host, name: 'N'.repeat(80), location: 'US' });
  assert.ok(longKey.length > 300, `long key (${longKey.length})`);
  assert.deepEqual(await validate(plainToInstance(UpdateAiSettingsDto, { accept_builtin_provider_key: longKey })), []);
  assert.deepEqual(await validate(plainToInstance(UpdateAiSettingsDto, { accept_builtin_provider_key: null })), []);
  assert.equal((await validate(plainToInstance(UpdateAiSettingsDto, { accept_builtin_provider_key: 'k'.repeat(513) }))).length, 1);

  // And the settings take it.
  const stack = createStack(
    workspace(),
    createPlatform({ endpoint_url: `https://${host}/v1`, disclosure_name: 'N'.repeat(80) }),
  );
  const saved = await stack.settings.update(TENANT_ID, { accept_builtin_provider_key: longKey }, { manager: stack.manager, userId: ADMIN_ID });
  assert.equal(saved.builtin_accepted_key, longKey);
}

async function testConfirmationByAUserNoLongerFoundAndSingleTenantView() {
  // The administrator who confirmed it was deleted since: confirmed, on a date, no name.
  const authorGone = createStack(workspace({
    settings: settingsRow({
      chat_enabled: true,
      builtin_accepted_key: KEY_US,
      builtin_accepted_at: new Date('2026-10-08T06:00:00.000Z'),
      builtin_accepted_by: '22222222-2222-4222-8222-222222222222',
    }),
  }));
  const stored = await authorGone.settings.get(TENANT_ID, { manager: authorGone.manager });
  const view = await authorGone.settings.toView(stored, { manager: authorGone.manager });
  assert.equal(view.builtin_provider.accepted, true);
  assert.equal(view.builtin_provider.accepted_by_name, null);
  assert.equal(view.builtin_provider.accepted_at, '2026-10-08T06:00:00.000Z');
  assert.equal('presumed' in view.builtin_provider, false, 'no confirmation is presumed');

  await withFeatures({ SINGLE_TENANT: true }, async () => {
    const stack = createStack(workspace({ settings: settingsRow({ provider_source: 'custom' }) }));
    const settings = await stack.settings.get(TENANT_ID, { manager: stack.manager });
    const singleView = await stack.settings.toView(settings, { manager: stack.manager });
    assert.deepEqual(singleView.builtin_provider, {
      in_use: false,
      used_by_assistant: false,
      name: null,
      location: null,
      key: null,
      accepted: false,
      accepted_at: null,
      accepted_by_name: null,
    });
    await assert.rejects(
      () => stack.settings.update(TENANT_ID, { accept_builtin_provider_key: KEY_US }, { manager: stack.manager, userId: ADMIN_ID }),
      (error: unknown) => badRequestBody(error).code === BUILTIN_PROVIDER_CHANGED,
    );
  });
}

// ---------------------------------------------------------------------------
// 3. Agents, included quota, MCP counting
// ---------------------------------------------------------------------------

function agentContext(manager: any, agentId: string | null = 'agent-1') {
  return {
    tenantId: TENANT_ID,
    userId: '',
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    agentId,
    manager,
  };
}

function createUsage() {
  const usage = { reserved: 0, mcpReserved: 0 };
  return {
    usage,
    service: {
      getCurrentUsage: async () => ({ count: 0, limit: 100, year_month: '2026-10', reset_date: '' }),
      getMonthlyLimit: async () => 100,
      reserveMessageDetached: async () => { usage.reserved += 1; return usage.reserved; },
      reserveMessage: async () => { usage.mcpReserved += 1; return usage.mcpReserved; },
    },
  };
}

async function testAgentsWaitWithoutConsumingTheQuota() {
  const stack = createStack(workspace());
  const context = agentContext(stack.manager);

  const llmClient = new AiAgentLlmClient(stack.resolver, providerRegistry as any);
  assert.equal(await llmClient.resolveRuntime(context as any), null, 'no runtime, no exception');
  assert.equal(await llmClient.resolvePrices(context as any), null);

  const { usage, service } = createUsage();
  const quota = new AiAgentBuiltinQuotaService(stack.resolver, service as any);
  await assert.rejects(
    () => quota.assertQuotaAvailable(context as any),
    (error: unknown) => error instanceof ForbiddenException && error.message === AGENT_RUNS_AWAIT_BUILTIN_CONFIRMATION,
  );
  await assert.rejects(
    () => quota.reserveRun(context as any),
    (error: unknown) => error instanceof ForbiddenException && error.message === AGENT_RUNS_AWAIT_BUILTIN_CONFIRMATION,
  );
  assert.equal(usage.reserved, 0, 'the included quota is not consumed');

  // Once confirmed, a run reserves one included message as before.
  const confirmed = createStack(workspace({ settings: settingsRow({ builtin_accepted_key: KEY_US }) }));
  const confirmedQuota = new AiAgentBuiltinQuotaService(confirmed.resolver, service as any);
  await confirmedQuota.assertQuotaAvailable(agentContext(confirmed.manager) as any);
  await confirmedQuota.reserveRun(agentContext(confirmed.manager) as any);
  assert.equal(usage.reserved, 1);
  const runtime = await new AiAgentLlmClient(confirmed.resolver, providerRegistry as any).resolveRuntime(agentContext(confirmed.manager) as any);
  assert.equal(runtime?.source, 'builtin');

  // An agent on the workspace's own model is never held back.
  const own = createStack(workspace({
    configs: [registryModel()],
    agents: [{ id: 'agent-1', tenant_id: TENANT_ID, llm_model_config_id: 'cfg-own', status: 'enabled' }],
  }));
  const ownQuota = new AiAgentBuiltinQuotaService(own.resolver, service as any);
  await ownQuota.assertQuotaAvailable(agentContext(own.manager) as any);
  await ownQuota.reserveRun(agentContext(own.manager) as any);
  assert.equal(usage.reserved, 1, 'own model: nothing reserved');
}

/**
 * MCP sends KANAP data to the user's own client, never to the included model: it works
 * without the confirmation and without the provider name and location, and its requests
 * count against the included volume whenever the assistant would fall back on that model,
 * as before the confirmation existed.
 */
async function testMcpWorksAndCountsAsBefore() {
  await withFeatures({ AI_CHAT_ENABLED: true, AI_MCP_ENABLED: true, AI_SETTINGS_ENABLED: true }, async () => {
    const { usage, service } = createUsage();
    const rateLimits: unknown[] = [];
    const makeController = (stack: ReturnType<typeof createStack>) => new AiMcpController(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      stack.resolver,
      service as any,
      { assertAllowed: (_tenantId: string, _userId: string, limits: unknown) => { rateLimits.push(limits); } } as any,
    );
    const mcpContext = (manager: any) => ({ ...agentContext(manager, null), userId: 'user-2', surface: 'mcp' as const });
    const permissions = new Map([['ai_mcp', 'reader']]);

    // An MCP-only workspace that never confirmed the included model.
    const mcpOnly = createStack(workspace({ settings: settingsRow({ mcp_enabled: true }) }));
    await createPolicy(mcpOnly, permissions).assertSurfaceAccess(mcpContext(mcpOnly.manager), mcpOnly.manager);
    const capabilities = await createPolicy(mcpOnly, permissions).getCapabilities(READER_CONTEXT, mcpOnly.manager);
    assert.equal(capabilities.surfaces.mcp.available, true);
    assert.equal(capabilities.surfaces.mcp.provider_ready, true);
    await (makeController(mcpOnly) as any).assertBuiltinMcpBudget(mcpContext(mcpOnly.manager));
    assert.equal(usage.mcpReserved, 1, 'counted on the included volume, confirmed or not');
    assert.deepEqual(rateLimits, [{ tenantPerMinute: 30, userPerHour: 60 }]);

    // A platform without a provider name or location yet: MCP keeps working and counting.
    const noIdentity = createStack(
      workspace({ settings: settingsRow({ mcp_enabled: true }) }),
      createPlatform({ disclosure_name: null, disclosure_location: null }),
    );
    await createPolicy(noIdentity, permissions).assertSurfaceAccess(mcpContext(noIdentity.manager), noIdentity.manager);
    await (makeController(noIdentity) as any).assertBuiltinMcpBudget(mcpContext(noIdentity.manager));
    assert.equal(usage.mcpReserved, 2);

    // The resolution MCP uses never carries the included model's key.
    const ungated = await mcpOnly.resolver.resolve(TENANT_ID, { type: 'chat' }, mcpOnly.manager, { includedModelGate: 'none' });
    assert.equal(ungated.source, 'builtin');
    assert.equal(ungated.apiKey, null);

    // Assistant on the workspace's own model: nothing counted.
    const own = createStack(workspace({
      settings: settingsRow({ mcp_enabled: true }),
      configs: [registryModel({ is_default: true })],
    }));
    await (makeController(own) as any).assertBuiltinMcpBudget(mcpContext(own.manager));
    assert.equal(usage.mcpReserved, 2, 'own model: nothing counted');

    // No platform row at all: MCP is not ready, as before.
    const noPlatform = createStack(workspace({ settings: settingsRow({ mcp_enabled: true }) }), createPlatform(null));
    await assert.rejects(
      () => createPolicy(noPlatform, permissions).assertSurfaceAccess(mcpContext(noPlatform.manager), noPlatform.manager),
      /AI MCP is not fully configured/,
    );
  });
}

/**
 * Tools that agents and system work run reach the assistant's access check. They send
 * nothing to the included model (each model call goes through the resolver), so an agent
 * on its own model keeps working while the assistant waits for the confirmation, or while
 * the platform has no provider name or location yet.
 */
async function testAgentToolsDoNotWaitForTheAssistant() {
  await withFeatures({ AI_CHAT_ENABLED: true, AI_MCP_ENABLED: true, AI_SETTINGS_ENABLED: true }, async () => {
    const permissions = new Map([['ai_chat', 'reader']]);
    const ownAgent = () => workspace({
      settings: settingsRow({ chat_enabled: true }),
      configs: [registryModel()],
      agents: [{ id: 'agent-1', tenant_id: TENANT_ID, llm_model_config_id: 'cfg-own', status: 'enabled' }],
    });
    const agentRun = { ...READER_CONTEXT, surface: 'chat' as const, authMethod: 'jwt' as const, agentId: 'agent-1' };
    const systemWork = { ...READER_CONTEXT, userId: '', surface: 'chat' as const, authMethod: 'jwt' as const };
    const userChat = { ...READER_CONTEXT, surface: 'chat' as const, authMethod: 'jwt' as const };

    for (const platform of [createPlatform(), createPlatform({ disclosure_name: null, disclosure_location: null })]) {
      const stack = createStack(ownAgent(), platform);
      const policy = createPolicy(stack, permissions);
      await policy.assertSurfaceAccess(agentRun, stack.manager);
      await policy.assertSurfaceAccess(systemWork, stack.manager);
      await assert.rejects(() => policy.assertSurfaceAccess(userChat, stack.manager), ForbiddenException, 'the assistant itself waits');
      const runtime = await new AiAgentLlmClient(stack.resolver, providerRegistry as any).resolveRuntime(agentContext(stack.manager) as any);
      assert.equal(runtime?.source, 'custom', 'the agent calls its own model');
    }

    // No platform row: the assistant has no model at all, and agent tools stop as before.
    const nothing = createStack(ownAgent(), createPlatform(null));
    await assert.rejects(
      () => createPolicy(nothing, permissions).assertSurfaceAccess(agentRun, nothing.manager),
      /AI chat is not fully configured/,
    );
  });
}

// ---------------------------------------------------------------------------
// 4. Capabilities
// ---------------------------------------------------------------------------

function createPolicy(stack: ReturnType<typeof createStack>, permissions: Map<string, string>) {
  return new AiPolicyService(
    {
      findById: async () => ({
        id: 'user-2',
        status: 'enabled',
        role_id: 'role-1',
        role: { role_name: 'Agent reader', is_system: false },
      }),
    } as any,
    { listForRoles: async () => permissions } as any,
    stack.settings,
    providerRegistry as any,
    stack.platform.service,
    { isConfigured: () => false } as any,
  );
}

const READER_CONTEXT = { tenantId: TENANT_ID, userId: 'user-2', isPlatformHost: false };

async function testCapabilitiesNameTheConfirmation() {
  await withFeatures({ AI_CHAT_ENABLED: true, AI_MCP_ENABLED: true, AI_SETTINGS_ENABLED: true }, async () => {
    const permissions = new Map([['ai_chat', 'reader'], ['ai_agents', 'reader']]);

    const waiting = createStack(workspace({ settings: settingsRow({ chat_enabled: true }) }));
    const capabilities = await createPolicy(waiting, permissions).getCapabilities(READER_CONTEXT, waiting.manager);
    assert.equal(capabilities.surfaces.chat.available, false);
    assert.equal(capabilities.surfaces.chat.provider_ready, false);
    assert.deepEqual(capabilities.surfaces.chat.reasons, ['builtin_not_accepted']);
    assert.equal(capabilities.builtin_confirmation_needed, true, 'readable by a user who only sees agents');

    // The assistant itself refuses the request.
    await assert.rejects(
      () => createPolicy(waiting, permissions).assertSurfaceAccess(
        { ...READER_CONTEXT, surface: 'chat', authMethod: 'jwt' },
        waiting.manager,
      ),
      ForbiddenException,
    );

    const confirmed = createStack(workspace({ settings: settingsRow({ chat_enabled: true, builtin_accepted_key: KEY_US }) }));
    const ready = await createPolicy(confirmed, permissions).getCapabilities(READER_CONTEXT, confirmed.manager);
    assert.equal(ready.surfaces.chat.available, true);
    assert.equal(ready.builtin_confirmation_needed, false);

    // Assistant on its own model, an enabled agent falling back on the unconfirmed included model.
    const split = createStack(workspace({
      settings: settingsRow({ chat_enabled: true, chat_model_config_id: 'cfg-own' }),
      configs: [registryModel()],
    }));
    const splitCapabilities = await createPolicy(split, permissions).getCapabilities(READER_CONTEXT, split.manager);
    assert.equal(splitCapabilities.surfaces.chat.available, true);
    assert.equal(splitCapabilities.builtin_confirmation_needed, true);

    // An agent whose model was archived falls back too.
    const archived = createStack(workspace({
      settings: settingsRow({ chat_enabled: true, chat_model_config_id: 'cfg-own' }),
      configs: [registryModel(), registryModel({ id: 'cfg-old', status: 'archived' })],
      agents: [{ id: 'agent-1', tenant_id: TENANT_ID, llm_model_config_id: 'cfg-old', status: 'enabled' }],
    }));
    assert.equal((await createPolicy(archived, permissions).getCapabilities(READER_CONTEXT, archived.manager)).builtin_confirmation_needed, true);

    // No enabled agent on the fallback (none at all, a draft one, or one on its own model): no banner.
    for (const agents of [
      [],
      [{ id: 'agent-1', tenant_id: TENANT_ID, llm_model_config_id: null, status: 'draft' }],
      [{ id: 'agent-1', tenant_id: TENANT_ID, llm_model_config_id: 'cfg-own', status: 'enabled' }],
    ]) {
      const quiet = createStack(workspace({ settings: settingsRow({ chat_enabled: true }), configs: [registryModel()], agents }));
      const quietCapabilities = await createPolicy(quiet, permissions).getCapabilities(READER_CONTEXT, quiet.manager);
      assert.deepEqual(quietCapabilities.surfaces.chat.reasons, ['builtin_not_accepted'], 'the assistant still waits');
      assert.equal(quietCapabilities.builtin_confirmation_needed, false, JSON.stringify(agents));
    }

    // Own default model: nothing to confirm.
    const own = createStack(workspace({
      settings: settingsRow({ chat_enabled: true }),
      configs: [registryModel({ is_default: true })],
    }));
    const ownCapabilities = await createPolicy(own, permissions).getCapabilities(READER_CONTEXT, own.manager);
    assert.equal(ownCapabilities.surfaces.chat.available, true);
    assert.equal(ownCapabilities.builtin_confirmation_needed, false);

    // Another cause keeps the generic reason.
    const noPlatform = createStack(workspace({ settings: settingsRow({ chat_enabled: true }) }), createPlatform(null));
    const notConfigured = await createPolicy(noPlatform, permissions).getCapabilities(READER_CONTEXT, noPlatform.manager);
    assert.deepEqual(notConfigured.surfaces.chat.reasons, ['provider_not_ready']);
    assert.equal(notConfigured.builtin_confirmation_needed, false);
  });
}

// ---------------------------------------------------------------------------
// 5. Platform identity fields
// ---------------------------------------------------------------------------

async function testPlatformFieldsAreValidated() {
  const platform = createPlatform();
  for (const input of [
    { disclosure_name: '' },
    { disclosure_name: '   ' },
    { disclosure_name: 'x'.repeat(81) },
    { disclosure_location: 'us' },
    { disclosure_location: 'USA' },
    { disclosure_location: 'U1' },
    { disclosure_location: '' },
  ]) {
    await assert.rejects(
      () => platform.service.updateConfig(input, 'platform-admin'),
      BadRequestException,
      JSON.stringify(input),
    );
  }
  assert.equal(platform.audits.length, 0, 'nothing saved');

  const saved = await platform.service.updateConfig({ disclosure_name: `  ${'A'.repeat(80)}  `, disclosure_location: 'EU' }, 'platform-admin');
  assert.equal(saved.disclosure_name, 'A'.repeat(80), 'trimmed, 80 characters accepted');
  assert.equal(saved.disclosure_location, 'EU');

  // A new provider or endpoint host needs the shown name and location in the same save.
  const audits = platform.audits.length;
  for (const input of [
    { provider: 'openai', model: 'gpt-included' },
    { endpoint_url: 'https://llm-gateway.example.com/v1' },
    { endpoint_url: 'https://llm-gateway.example.com/v1', disclosure_name: 'Anthropic' },
    { provider: 'openai', disclosure_location: 'US' },
  ]) {
    await assert.rejects(
      () => platform.service.updateConfig(input, 'platform-admin'),
      (error: unknown) => error instanceof BadRequestException
        && /enter or confirm the provider name and the processing location/.test(error.message),
      JSON.stringify(input),
    );
  }
  assert.equal(platform.audits.length, audits, 'nothing saved');
}

async function testPlatformViewShowsTheKeyChange() {
  const platform = createPlatform();
  const before = await platform.service.getConfig();
  assert.equal(before.disclosure_name, 'Anthropic');
  assert.equal(before.disclosure_location, 'US');
  assert.equal(before.disclosure_key, builtinProviderKey({ provider: 'anthropic', endpointHost: '', name: 'Anthropic', location: 'US' }));
  assert.equal(before.disclosure_key, KEY_US);
  assert.equal(
    builtinProviderKey({ provider: 'anthropic', endpointHost: 'api.anthropic.com', name: '  Anthropic ', location: 'US' }),
    'anthropic|api.anthropic.com|Anthropic|US',
    'the name is trimmed',
  );
  assert.equal(endpointHostOf(null), '');
  assert.equal(endpointHostOf('  '), '');
  assert.equal(endpointHostOf('https://API.Anthropic.com/v1'), 'api.anthropic.com');

  // Fields left out keep their values; a new model keeps the key.
  const modelOnly = await platform.service.updateConfig({ model: 'claude-included-2' }, 'platform-admin');
  assert.equal(modelOnly.disclosure_key, KEY_US);

  const moved = await platform.service.updateConfig({ disclosure_location: 'EU' }, 'platform-admin');
  assert.equal(moved.disclosure_key, 'anthropic||Anthropic|EU');
  const audit = platform.audits[platform.audits.length - 1];
  assert.equal(audit.table, 'platform_ai_config');
  assert.equal(audit.before.disclosure_location, 'US');
  assert.equal(audit.after.disclosure_location, 'EU');
  assert.equal(audit.after.disclosure_key, 'anthropic||Anthropic|EU');
  assert.deepEqual((await platform.service.getBuiltinRuntime())?.identity, { name: 'Anthropic', location: 'EU', key: 'anthropic||Anthropic|EU' });

  // A new endpoint host, name and location confirmed in the same save: a new key.
  const gateway = await platform.service.updateConfig(
    { endpoint_url: 'https://llm-gateway.example.com/v1', disclosure_name: 'Anthropic', disclosure_location: 'EU' },
    'platform-admin',
  );
  assert.equal(gateway.disclosure_key, 'anthropic|llm-gateway.example.com|Anthropic|EU');

  // A platform row saved before these fields existed: the included model is not offered.
  const legacy = createPlatform({ disclosure_name: null, disclosure_location: null });
  const legacyView = await legacy.service.getConfig();
  assert.equal(legacyView.disclosure_key, null);
  assert.equal((await legacy.service.getBuiltinRuntime())?.identity, null);
}

async function run() {
  const tests = [
    testIncludedModelNeedsTheWorkspaceConfirmation,
    testIdentityAndRuntimeComeFromOneRead,
    testNewNameOrLocationAsksAgainButNotANewModel,
    testRegistryModelsNeverAskForConfirmation,
    testIncludedModelWithoutIdentityIsNotConfigured,
    testSingleTenantIsUnchanged,
    testTurningOnTheAssistantNeedsConfirmation,
    testConfirmAndTurnOnInOneWrite,
    testOutdatedKeyIsRefused,
    testWithdrawKeepsOtherSettingsSavable,
    testOwnModelTurnsOnWithoutConfirmation,
    testCardShowsWhenAgentsFallBackOnIt,
    testConfirmationKeyLength,
    testConfirmationByAUserNoLongerFoundAndSingleTenantView,
    testAgentsWaitWithoutConsumingTheQuota,
    testMcpWorksAndCountsAsBefore,
    testAgentToolsDoNotWaitForTheAssistant,
    testCapabilitiesNameTheConfirmation,
    testPlatformFieldsAreValidated,
    testPlatformViewShowsTheKeyChange,
  ];
  const failures: string[] = [];
  for (const test of tests) {
    try {
      await test();
    } catch (error) {
      failures.push(`${test.name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`ai-included-model-confirmation.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log(`ai-included-model-confirmation.spec: ${tests.length} tests ok`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
