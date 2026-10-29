import * as assert from 'node:assert/strict';
import { AiPolicyService, contributorFieldsMessage, missingRightMessage } from '../ai-policy.service';
import { Features } from '../../config/features';
import { Tenant, TenantStatus } from '../../tenants/tenant.entity';
import { UserRole } from '../../users/user-role.entity';
import { Subscription, SubscriptionStatus } from '../../billing/subscription.entity';
import { DATA_ACCESS_RESERVED_MESSAGE } from '../../data-access/reserved-operations';

type TestSettings = {
  tenant_id: string;
  chat_enabled: boolean;
  mcp_enabled: boolean;
  provider_source: 'builtin' | 'custom';
  llm_provider: string | null;
  llm_model: string | null;
  llm_endpoint_url: string | null;
  llm_api_key_encrypted: string | null;
};

function createManager(options?: {
  tenantStatus?: TenantStatus;
  userRoles?: Array<{ role_id: string; role?: { role_name?: string | null } }>;
  subscription?: any;
  /** The person's data access (`dataAccessModeOf`): limited, or all when left out. */
  limited?: boolean;
}) {
  const tenant = {
    id: 'tenant-1',
    status: options?.tenantStatus ?? TenantStatus.ACTIVE,
  } as Tenant;
  const userRoles = options?.userRoles ?? [{ role_id: 'role-1', role: { role_name: 'AI Chat User' } }];
  const subscription = options?.subscription ?? null;

  const limited = options?.limited === true;
  return {
    // `app.da_mode`, then the person's mode and roles: both answer `limited`.
    query: async () => [{ limited }],
    getRepository(entity: unknown) {
      if (entity === UserRole) {
        return {
          find: async () => userRoles,
        };
      }
      if (entity === Tenant) {
        return {
          findOne: async () => tenant,
        };
      }
      if (entity === Subscription) {
        return {
          findOne: async () => subscription,
        };
      }
      throw new Error(`Unexpected repository request: ${String(entity)}`);
    },
  } as any;
}

function createPolicy(options?: {
  user?: any;
  permissions?: Map<string, any>;
  settings?: Partial<TestSettings>;
  providerErrors?: string[];
  stripeConfigured?: boolean;
}) {
  const settings: TestSettings = {
    tenant_id: 'tenant-1',
    chat_enabled: true,
    mcp_enabled: true,
    provider_source: 'custom',
    llm_provider: 'openai',
    llm_model: 'gpt-4o-mini',
    llm_endpoint_url: null,
    llm_api_key_encrypted: 'encrypted',
    ...(options?.settings ?? {}),
  };

  return new AiPolicyService(
    {
      findById: async () => options?.user ?? {
        id: 'user-1',
        status: 'enabled',
        role_id: 'role-1',
        role: { role_name: 'Member', is_system: false },
      },
    } as any,
    {
      listForRoles: async () => options?.permissions ?? new Map([
        ['ai_chat', 'reader'],
        ['ai_mcp', 'reader'],
        ['ai_settings', 'admin'],
        ['applications', 'reader'],
        ['tasks', 'member'],
        ['knowledge', 'reader'],
      ]),
    } as any,
    {
      get: async () => settings,
      find: async () => settings,
      getEffectiveProviderSource: (value: any) => value.provider_source === 'custom' ? 'custom' : 'builtin',
      getProviderValidationErrors: async () => options?.providerErrors ?? [],
      getProviderErrorsWithoutConfirmation: async () => options?.providerErrors ?? [],
      getProviderReadiness: async () => ({
        errors: options?.providerErrors ?? [],
        errorCode: null,
        usesBuiltin: false,
        builtinIdentity: null,
      }),
      isBuiltinConfirmationNeeded: async () => false,
      toProviderSnapshot: (value: any) => ({
        llm_provider: value.llm_provider,
        llm_model: value.llm_model,
        llm_endpoint_url: value.llm_endpoint_url,
        has_llm_api_key: !!value.llm_api_key_encrypted,
      }),
    } as any,
    {
      validate: () => options?.providerErrors ?? [],
    } as any,
    {
      isConfigured: async () => true,
    } as any,
    {
      isConfigured: () => options?.stripeConfigured === true,
    } as any,
  );
}

async function testListReadableEntityTypesFiltersUnreadableFamilies() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;

  const policy = createPolicy({
    permissions: new Map([
      ['ai_chat', 'reader'],
      ['applications', 'reader'],
      ['tasks', 'member'],
    ]),
  });

  const readable = await policy.listReadableEntityTypes(
    {
      tenantId: 'tenant-1',
      userId: 'user-1',
      isPlatformHost: false,
      surface: 'chat',
      authMethod: 'jwt',
    },
    ['applications', 'assets', 'tasks'],
    createManager(),
  );

  assert.deepEqual(readable, ['applications', 'tasks']);

  // Master data (Plaid L9): each family with the right of its page, the budget right alone reads neither.
  const chat = { tenantId: 'tenant-1', userId: 'user-1', isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const };
  const families = ['working_day_calendars', 'analytics_axes'] as any[];
  const readableWith = (rights: Array<[string, string]>) =>
    createPolicy({ permissions: new Map([['ai_chat', 'reader'], ...rights]) as any }).listReadableEntityTypes(chat, families, createManager());
  assert.deepEqual(await readableWith([['working_day_profiles', 'reader']]), ['working_day_calendars']);
  assert.deepEqual(await readableWith([['analytics', 'reader']]), ['analytics_axes']);
  assert.deepEqual(await readableWith([['budget', 'admin'], ['reporting', 'admin']]), []);
  Features.AI_CHAT_ENABLED = originalFeature;
}

async function testSettingsAccessRequiresAiSettingsAdmin() {
  const originalFeature = Features.AI_SETTINGS_ENABLED;
  Features.AI_SETTINGS_ENABLED = true;

  const policy = createPolicy({
    permissions: new Map([
      ['ai_chat', 'reader'],
    ]),
  });

  await assert.rejects(
    () => policy.assertSettingsAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
      },
      createManager(),
    ),
    /Missing required permission ai_settings:admin/,
  );

  Features.AI_SETTINGS_ENABLED = originalFeature;
}

async function testModelConfigReadTierMatrix() {
  const originalFeature = Features.AI_SETTINGS_ENABLED;
  Features.AI_SETTINGS_ENABLED = true;
  const context = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    isPlatformHost: false,
  };

  const settingsAdminPolicy = createPolicy({
    permissions: new Map([
      ['ai_settings', 'admin'],
    ]),
  });
  assert.equal(await settingsAdminPolicy.resolveModelConfigReadTier(context, createManager()), 'full');

  const agentAdminPolicy = createPolicy({
    permissions: new Map([
      ['ai_agents', 'admin'],
    ]),
  });
  assert.equal(await agentAdminPolicy.resolveModelConfigReadTier(context, createManager()), 'assignment');

  const agentContributorPolicy = createPolicy({
    permissions: new Map([
      ['ai_agents', 'contributor'],
    ]),
  });
  await assert.rejects(
    () => agentContributorPolicy.resolveModelConfigReadTier(context, createManager()),
    /Missing required permission ai_settings:admin/,
  );

  await assert.rejects(
    () => agentAdminPolicy.resolveModelConfigReadTier(
      { ...context, isPlatformHost: true },
      createManager(),
    ),
    /platform host/,
  );

  Features.AI_SETTINGS_ENABLED = originalFeature;
}

async function testAgentPermissionMatrixAndSettingsCompatibility() {
  const originalFeature = Features.AI_SETTINGS_ENABLED;
  Features.AI_SETTINGS_ENABLED = true;
  const context = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    isPlatformHost: false,
  };

  const readerPolicy = createPolicy({
    permissions: new Map([
      ['ai_agents', 'reader'],
    ]),
  });
  await readerPolicy.assertAgentRead(context, createManager());
  await assert.rejects(
    () => readerPolicy.assertAgentOperate(context, createManager()),
    /Missing required permission ai_agents:contributor/,
  );
  await assert.rejects(
    () => readerPolicy.assertAgentAdmin(context, createManager()),
    /Missing required permission ai_agents:admin/,
  );

  const contributorPolicy = createPolicy({
    permissions: new Map([
      ['ai_agents', 'contributor'],
    ]),
  });
  await contributorPolicy.assertAgentRead(context, createManager());
  await contributorPolicy.assertAgentOperate(context, createManager());
  await assert.rejects(
    () => contributorPolicy.assertAgentAdmin(context, createManager()),
    /Missing required permission ai_agents:admin/,
  );

  const adminPolicy = createPolicy({
    permissions: new Map([
      ['ai_agents', 'admin'],
    ]),
  });
  await adminPolicy.assertAgentRead(context, createManager());
  await adminPolicy.assertAgentOperate(context, createManager());
  await adminPolicy.assertAgentAdmin(context, createManager());

  const legacySettingsAdminPolicy = createPolicy({
    permissions: new Map([
      ['ai_settings', 'admin'],
    ]),
  });
  await legacySettingsAdminPolicy.assertAgentRead(context, createManager());
  await legacySettingsAdminPolicy.assertAgentOperate(context, createManager());
  await legacySettingsAdminPolicy.assertAgentAdmin(context, createManager());

  Features.AI_SETTINGS_ENABLED = originalFeature;
}

async function testChatSurfaceRequiresFeatureFlag() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = false;

  const policy = createPolicy();
  await assert.rejects(
    () => policy.assertSurfaceAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      createManager(),
    ),
    /ai_chat is not available in this deployment/,
  );

  Features.AI_CHAT_ENABLED = originalFeature;
}

async function testChatSurfaceRequiresTenantEnablement() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;

  const policy = createPolicy({
    settings: { chat_enabled: false },
  });
  await assert.rejects(
    () => policy.assertSurfaceAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      createManager(),
    ),
    /AI chat is disabled for this tenant/,
  );

  Features.AI_CHAT_ENABLED = originalFeature;
}

async function testMcpSurfaceRequiresTenantEnablement() {
  const originalFeature = Features.AI_MCP_ENABLED;
  Features.AI_MCP_ENABLED = true;

  const policy = createPolicy({
    settings: { mcp_enabled: false },
  });
  await assert.rejects(
    () => policy.assertSurfaceAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'mcp',
        authMethod: 'api_key',
      },
      createManager(),
    ),
    /AI MCP access is disabled for this tenant/,
  );

  Features.AI_MCP_ENABLED = originalFeature;
}

async function testChatSurfaceRequiresProviderReadiness() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;

  const policy = createPolicy({
    providerErrors: ['Provider is required.'],
  });
  await assert.rejects(
    () => policy.assertSurfaceAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      createManager(),
    ),
    /AI chat is not fully configured for this tenant/,
  );

  Features.AI_CHAT_ENABLED = originalFeature;
}

async function testSurfaceRequiresActiveTenant() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;

  const policy = createPolicy();
  await assert.rejects(
    () => policy.assertSurfaceAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      createManager({ tenantStatus: TenantStatus.FROZEN }),
    ),
    /inactive/,
  );

  Features.AI_CHAT_ENABLED = originalFeature;
}

async function testSurfaceRejectsDisabledUsers() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;

  const policy = createPolicy({
    user: {
      id: 'user-1',
      status: 'disabled',
      role_id: 'role-1',
      role: { role_name: 'Member', is_system: false },
    },
  });
  await assert.rejects(
    () => policy.assertSurfaceAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      createManager(),
    ),
    /User is not allowed to use AI/,
  );

  Features.AI_CHAT_ENABLED = originalFeature;
}

async function testWriteAccessHonorsBillingFreeze() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;

  const policy = createPolicy({
    permissions: new Map([
      ['ai_chat', 'member'],
      ['tasks', 'member'],
    ]),
    stripeConfigured: true,
  });

  await assert.rejects(
    () => policy.assertWriteAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      'tasks',
      createManager({
        subscription: {
          tenant_id: 'tenant-1',
          status: SubscriptionStatus.PAST_DUE,
          collection_method: 'charge_automatically',
          current_period_end: new Date('2000-01-01T00:00:00.000Z'),
        },
      }),
    ),
    /subscription is frozen due to an overdue payment/i,
  );

  Features.AI_CHAT_ENABLED = originalFeature;
}

// F2: a non-admin user whose email is in PLATFORM_ADMIN_EMAILS gets NO data-plane grant
// (the standalone isPlatformAdmin short-circuit was removed).
async function testPlatformAdminEmailGrantsNoDataPlaneAccess() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  const originalEmails = process.env.PLATFORM_ADMIN_EMAILS;
  Features.AI_CHAT_ENABLED = true;
  process.env.PLATFORM_ADMIN_EMAILS = 'admin@kanap.net';

  const policy = createPolicy({
    user: { id: 'user-1', status: 'enabled', role_id: 'role-1', role: { role_name: 'Member', is_system: false }, email: 'admin@kanap.net' },
    permissions: new Map(), // no ai_chat permission
  });
  await assert.rejects(
    () => policy.assertSurfaceAccess(
      { tenantId: 'tenant-1', userId: 'user-1', isPlatformHost: false, surface: 'chat', authMethod: 'jwt' },
      createManager(),
    ),
  );

  Features.AI_CHAT_ENABLED = originalFeature;
  process.env.PLATFORM_ADMIN_EMAILS = originalEmails;
}

async function testSurfaceAccessHonorsBillingFreeze() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;

  const policy = createPolicy({ stripeConfigured: true });
  await assert.rejects(
    () => policy.assertSurfaceAccess(
      { tenantId: 'tenant-1', userId: 'user-1', isPlatformHost: false, surface: 'chat', authMethod: 'jwt' },
      createManager({
        subscription: {
          tenant_id: 'tenant-1',
          status: SubscriptionStatus.PAST_DUE,
          collection_method: 'charge_automatically',
          current_period_end: new Date('2000-01-01T00:00:00.000Z'),
        },
      }),
    ),
    /subscription is frozen due to an overdue payment/i,
  );

  Features.AI_CHAT_ENABLED = originalFeature;
}

async function testAgentAccessHonorsTrialExpiry() {
  const originalFeature = Features.AI_SETTINGS_ENABLED;
  Features.AI_SETTINGS_ENABLED = true;

  const policy = createPolicy({ stripeConfigured: true });
  await assert.rejects(
    () => policy.assertAgentOperate(
      { tenantId: 'tenant-1', userId: 'user-1', isPlatformHost: false } as any,
      createManager({
        subscription: {
          tenant_id: 'tenant-1',
          status: SubscriptionStatus.TRIALING,
          trial_end: new Date('2000-01-01T00:00:00.000Z'),
        },
      }),
    ),
    /trial has expired/i,
  );

  Features.AI_SETTINGS_ENABLED = originalFeature;
}

async function testAiAccessAllowedWhenBillingUnconfigured() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;

  // stripeConfigured defaults to false (single-tenant / on-prem): the freeze gate
  // must no-op even with no subscription, so AI stays available in both modes.
  const policy = createPolicy();
  await assert.doesNotReject(
    () => policy.assertSurfaceAccess(
      { tenantId: 'tenant-1', userId: 'user-1', isPlatformHost: false, surface: 'chat', authMethod: 'jwt' },
      createManager({ subscription: null }),
    ),
  );

  Features.AI_CHAT_ENABLED = originalFeature;
}

async function testCapabilitiesSummarizeSurfaceAvailability() {
  const originalChat = Features.AI_CHAT_ENABLED;
  const originalMcp = Features.AI_MCP_ENABLED;
  const originalSettings = Features.AI_SETTINGS_ENABLED;
  Features.AI_CHAT_ENABLED = true;
  Features.AI_MCP_ENABLED = true;
  Features.AI_SETTINGS_ENABLED = true;

  const policy = createPolicy({
    permissions: new Map([
      ['ai_settings', 'admin'],
    ]),
    settings: {
      chat_enabled: false,
      mcp_enabled: true,
      llm_provider: null,
      llm_model: null,
      llm_api_key_encrypted: null,
    },
  });

  const capabilities = await policy.getCapabilities(
    {
      tenantId: 'tenant-1',
      userId: 'user-1',
      isPlatformHost: false,
    },
    createManager(),
  );

  assert.equal(capabilities.surfaces.chat.available, false);
  assert.equal(capabilities.surfaces.chat.tenant_enabled, false);
  assert.equal(capabilities.surfaces.chat.permission_granted, false);
  assert.equal(capabilities.surfaces.chat.reasons.includes('tenant_disabled'), true);
  assert.equal(capabilities.surfaces.mcp.available, false);
  assert.equal(capabilities.surfaces.settings.available, true);

  Features.AI_CHAT_ENABLED = originalChat;
  Features.AI_MCP_ENABLED = originalMcp;
  Features.AI_SETTINGS_ENABLED = originalSettings;
}

async function testSurfaceRejectsPlatformHost() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;

  const policy = createPolicy();
  await assert.rejects(
    () => policy.assertSurfaceAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: true,
        surface: 'chat',
        authMethod: 'jwt',
      },
      createManager(),
    ),
    /platform host/,
  );

  Features.AI_CHAT_ENABLED = originalFeature;
}

async function testKeyManagementRejectsPlatformHost() {
  const originalFeature = Features.AI_MCP_ENABLED;
  Features.AI_MCP_ENABLED = true;

  const policy = createPolicy();
  await assert.rejects(
    () => policy.assertKeyManagementAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: true,
      },
      createManager(),
    ),
    /platform host/,
  );

  Features.AI_MCP_ENABLED = originalFeature;
}

async function testSettingsAccessRejectsPlatformHost() {
  const originalFeature = Features.AI_SETTINGS_ENABLED;
  Features.AI_SETTINGS_ENABLED = true;

  const policy = createPolicy();
  await assert.rejects(
    () => policy.assertSettingsAccess(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: true,
      },
      createManager(),
    ),
    /platform host/,
  );

  Features.AI_SETTINGS_ENABLED = originalFeature;
}

async function testCapabilitiesRejectPlatformHost() {
  const policy = createPolicy();

  await assert.rejects(
    () => policy.getCapabilities(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: true,
      },
      createManager(),
    ),
    /platform host/,
  );
}

/** A refusal names the missing right in plain words, never its code (P4-5, P4-9). */
async function testMissingRightIsSaidInPlainWords() {
  assert.equal(missingRightMessage('portfolio_projects', 'member'), 'You need the right to modify projects, which your role does not give. An administrator can add it to your role.');
  assert.equal(missingRightMessage('budget', 'reader'), 'You need the right to read budget lines, which your role does not give. An administrator can add it to your role.');
  assert.match(missingRightMessage('ai_chat', 'member'), /^Your role lets you ask Plaid questions but not prepare changes with it/);
  // Master data (Plaid L9): the right of each page, named in words with its screen.
  assert.equal(
    missingRightMessage('working_day_profiles', 'reader', 'Master data › Working-day calendars'),
    'You need the right to read working-day calendars (the right the Master data › Working-day calendars screen asks for), which your role does not give. An administrator can add it to your role.',
  );
  assert.equal(
    missingRightMessage('analytics', 'reader', 'Master data › Analytics dimensions'),
    'You need the right to read analytics dimensions (the right the Master data › Analytics dimensions screen asks for), which your role does not give. An administrator can add it to your role.',
  );
  for (const [resource, level] of [['budget', 'reader'], ['infrastructure', 'reader'], ['applications', 'member'], ['knowledge', 'reader'], ['working_day_profiles', 'reader']] as const) {
    assert.doesNotMatch(missingRightMessage(resource, level), /:|reader|member/, `${resource}: no permission code`);
  }
}

/**
 * Plaid L9, lot D: the exchange rates are read with the budget right at reader level, as their
 * routes, limited access included; the refusal names the budget right and the exchange rates.
 */
async function testExchangeRatesNeedBudgetReader() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;
  const context = { tenantId: 'tenant-1', userId: 'user-1', isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const };
  try {
    assert.equal(
      missingRightMessage('budget', 'reader', undefined, 'the exchange rates and the currency settings'),
      'You need the right to read budget lines to read the exchange rates and the currency settings, which your role does not give. An administrator can add it to your role.',
    );
    const withoutBudget = createPolicy({ permissions: new Map([['ai_chat', 'reader'], ['budget_ops', 'admin']]) });
    await assert.rejects(
      () => withoutBudget.assertEntityTypeReadAccess(context, 'exchange_rates', createManager()),
      (error: any) => {
        assert.equal(error.message, missingRightMessage('budget', 'reader', undefined, 'the exchange rates and the currency settings'));
        assert.equal(error.getResponse().code, 'MODULE_RIGHT_REQUIRED');
        return true;
      },
    );
    const reader = createPolicy({ permissions: new Map([['ai_chat', 'reader'], ['budget', 'reader']]) });
    await reader.assertEntityTypeReadAccess(context, 'exchange_rates', createManager());
    // Not reserved: a person in limited access reads them, their access is never read for it.
    const noQuery = { ...createManager({ limited: true }), query: async () => { throw new Error('the access is read for the reserved families only'); } } as any;
    assert.equal(await reader.canReadEntityType(context, 'exchange_rates', noQuery), true, 'budget:reader reads them, limited access included');
    assert.deepEqual(await reader.listReadableEntityTypes(context, ['exchange_rates'] as any[], createManager({ limited: true })), ['exchange_rates']);
    assert.deepEqual(await withoutBudget.listReadableEntityTypes(context, ['exchange_rates'] as any[], createManager()), []);
  } finally {
    Features.AI_CHAT_ENABLED = originalFeature;
  }
}

/**
 * Lot D11: a write needs the module at the level of the screen route (`contributor` for a
 * project's fields and relations); a contributor changes only the fields the screen opens to them.
 */
async function testContributorWritesAtTheScreenLevel() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;
  const chat = { tenantId: 'tenant-1', userId: 'user-1', isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const };
  const projectFields = { level: 'contributor' as const, toolName: 'update_business_record', family: 'projects' };
  const contributor = createPolicy({ permissions: new Map([['ai_chat', 'member'], ['portfolio_projects', 'contributor']]) });

  await contributor.assertWriteAccess(chat, 'portfolio_projects', createManager(), { level: 'contributor' });
  await contributor.assertWriteAccess(chat, 'portfolio_projects', createManager(), { ...projectFields, fields: { purpose: 'Purpose' } });
  // Counter-checks: the name is not opened to a contributor; a member write stays at member.
  await assert.rejects(
    () => contributor.assertWriteAccess(chat, 'portfolio_projects', createManager(), { ...projectFields, fields: { name: 'Name', purpose: 'Purpose' } }),
    (error: any) => error.message === contributorFieldsMessage('portfolio_projects', ['Name']),
  );
  await assert.rejects(
    () => contributor.assertWriteAccess(chat, 'portfolio_projects', createManager()),
    (error: any) => error.message === missingRightMessage('portfolio_projects', 'member'),
  );
  assert.equal(
    contributorFieldsMessage('portfolio_projects', ['Name']),
    'Your role lets you contribute to projects but not change Name: that needs the right to modify projects, which your role does not give. An administrator can add it to your role.',
  );

  // A member changes every field; a reader is refused, with the right they miss.
  const member = createPolicy({ permissions: new Map([['ai_chat', 'member'], ['portfolio_projects', 'member']]) });
  await member.assertWriteAccess(chat, 'portfolio_projects', createManager(), { ...projectFields, fields: { name: 'Name' } });
  const reader = createPolicy({ permissions: new Map([['ai_chat', 'member'], ['portfolio_projects', 'reader']]) });
  await assert.rejects(
    () => reader.assertWriteAccess(chat, 'portfolio_projects', createManager(), { level: 'contributor' }),
    (error: any) => error.message === missingRightMessage('portfolio_projects', 'contributor'),
  );
  // MCP stays read only.
  await assert.rejects(
    () => member.assertWriteAccess({ ...chat, surface: 'mcp' }, 'portfolio_projects', createManager(), { level: 'contributor' }),
    /MCP write access is not available/,
  );

  // The rights the refusals name: a contributor contributes to projects, modifies no module.
  const rights = await contributor.describeWriteRights(chat, createManager());
  assert.deepEqual(rights.modifiableModules, []);
  assert.equal(rights.contributableModules.length, 1);
  assert.match(rights.contributableModules[0], /^projects \(their purpose/);
  assert.deepEqual((await member.describeWriteRights(chat, createManager())).contributableModules, []);

  Features.AI_CHAT_ENABLED = originalFeature;
}

/**
 * The roles and their rights (Plaid L7 lot A) are read as Admin › Roles: users at admin level, by a
 * person whose access is not limited. Below that, refused in words and left out of the families.
 */
async function testRolesNeedUsersAdminAndUnlimitedAccess() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;
  const context = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
  };
  const withUsers = (level: string) => createPolicy({ permissions: new Map([['ai_chat', 'reader'], ['users', level]]) });
  const administrator = createPolicy({
    user: { id: 'user-1', status: 'enabled', role_id: 'role-admin', role: { role_name: 'Administrator', is_system: true } },
  });
  const adminManager = (limited = false) => createManager({ limited, userRoles: [{ role_id: 'role-admin', role: { role_name: 'Administrator' } }] });
  try {
    for (const family of ['roles', 'role_permissions'] as const) {
      // users:reader: the right is missing, named in words with its screen.
      const reader = withUsers('reader');
      await assert.rejects(
        () => reader.assertEntityTypeReadAccess(context, family, createManager()),
        (error: any) => {
          assert.equal(error.message, 'You need the right to administer users (the right the Admin › Roles screen asks for), which your role does not give. An administrator can add it to your role.');
          assert.equal(error.getResponse().code, 'MODULE_RIGHT_REQUIRED');
          return true;
        },
        `${family}: users:reader is refused`,
      );
      assert.equal(await reader.canReadEntityType(context, family, createManager()), false, `${family}: users:reader cannot read`);
      assert.equal(await reader.canReadEntityType(context, family, createManager(), 'reader'), false, `${family}: a reader level asked is raised to admin`);

      // users:admin in limited access: reserved to people with access to all data.
      const admin = withUsers('admin');
      await assert.rejects(
        () => admin.assertEntityTypeReadAccess(context, family, createManager({ limited: true })),
        (error: any) => {
          assert.equal(error.message, DATA_ACCESS_RESERVED_MESSAGE);
          assert.equal(error.getResponse().code, 'DATA_ACCESS_LIMITED');
          return true;
        },
        `${family}: users:admin in limited access is refused`,
      );
      assert.equal(await admin.canReadEntityType(context, family, createManager({ limited: true })), false, `${family}: users:admin limited cannot read`);

      // users:admin with access to all data, and an Administrator: read.
      await admin.assertEntityTypeReadAccess(context, family, createManager());
      assert.equal(await admin.canReadEntityType(context, family, createManager()), true, `${family}: users:admin unlimited reads`);
      await administrator.assertEntityTypeReadAccess(context, family, adminManager());
      assert.equal(await administrator.canReadEntityType(context, family, adminManager()), true, `${family}: an Administrator reads`);
    }

    // The readable families (the prompt's "Readable entity types"): the two families only for the
    // last two, users still for the first two.
    const requested = ['users', 'roles', 'role_permissions'] as any[];
    assert.deepEqual(await withUsers('reader').listReadableEntityTypes(context, requested, createManager()), ['users'], 'users:reader');
    assert.deepEqual(await withUsers('admin').listReadableEntityTypes(context, requested, createManager({ limited: true })), ['users'], 'users:admin limited');
    assert.deepEqual(await withUsers('admin').listReadableEntityTypes(context, requested, createManager()), requested, 'users:admin unlimited');
    assert.deepEqual(await administrator.listReadableEntityTypes(context, requested, adminManager()), requested, 'Administrator');

    // Every other family keeps the reader level, without reading the access.
    const noQuery = { ...createManager(), query: async () => { throw new Error('the access is read for the reserved families only'); } } as any;
    assert.equal(await withUsers('reader').canReadEntityType(context, 'users', noQuery), true, 'users stays at reader level');
    assert.equal(await withUsers('reader').canReadEntityType(context, 'users', noQuery, 'admin'), false, 'a level asked above it still applies');
  } finally {
    Features.AI_CHAT_ENABLED = originalFeature;
  }
}

/** Plaid L9, lot A: the cost centers need the right of their page, limited access included, refused in words. */
async function testCostCentersNeedTheirPageRight() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;
  const context = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
  };
  try {
    // budget:reader reads cost_center on its lines, not the family: the right of the page is missing.
    const budgetReader = createPolicy({ permissions: new Map([['ai_chat', 'reader'], ['budget', 'reader']]) });
    await assert.rejects(
      () => budgetReader.assertEntityTypeReadAccess(context, 'cost_centers', createManager()),
      (error: any) => {
        assert.equal(error.message, 'You need the right to read cost centers (the right the Master data › Cost centers screen asks for), which your role does not give. An administrator can add it to your role.');
        assert.equal(error.getResponse().code, 'MODULE_RIGHT_REQUIRED');
        return true;
      },
      'budget:reader is refused',
    );
    assert.equal(await budgetReader.canReadEntityType(context, 'cost_centers', createManager()), false, 'budget:reader cannot read');

    // cost_centers:reader reads, in limited access too: the family is not reserved.
    const reader = createPolicy({ permissions: new Map([['ai_chat', 'reader'], ['cost_centers', 'reader']]) });
    await reader.assertEntityTypeReadAccess(context, 'cost_centers', createManager());
    await reader.assertEntityTypeReadAccess(context, 'cost_centers', createManager({ limited: true }));
    assert.equal(await reader.canReadEntityType(context, 'cost_centers', createManager({ limited: true })), true, 'limited access reads the tree');
    assert.deepEqual(
      await reader.listReadableEntityTypes(context, ['cost_centers', 'budget_lines'] as any[], createManager({ limited: true })),
      ['cost_centers'],
      'listed among the readable families',
    );
  } finally {
    Features.AI_CHAT_ENABLED = originalFeature;
  }
}

async function run() {
  await testRolesNeedUsersAdminAndUnlimitedAccess();
  await testCostCentersNeedTheirPageRight();
  await testExchangeRatesNeedBudgetReader();
  await testContributorWritesAtTheScreenLevel();
  await testMissingRightIsSaidInPlainWords();
  await testListReadableEntityTypesFiltersUnreadableFamilies();
  await testSettingsAccessRequiresAiSettingsAdmin();
  await testModelConfigReadTierMatrix();
  await testAgentPermissionMatrixAndSettingsCompatibility();
  await testChatSurfaceRequiresFeatureFlag();
  await testChatSurfaceRequiresTenantEnablement();
  await testMcpSurfaceRequiresTenantEnablement();
  await testChatSurfaceRequiresProviderReadiness();
  await testSurfaceRequiresActiveTenant();
  await testSurfaceRejectsDisabledUsers();
  await testSurfaceRejectsPlatformHost();
  await testKeyManagementRejectsPlatformHost();
  await testSettingsAccessRejectsPlatformHost();
  await testWriteAccessHonorsBillingFreeze();
  await testPlatformAdminEmailGrantsNoDataPlaneAccess();
  await testSurfaceAccessHonorsBillingFreeze();
  await testAgentAccessHonorsTrialExpiry();
  await testAiAccessAllowedWhenBillingUnconfigured();
  await testCapabilitiesSummarizeSurfaceAvailability();
  await testCapabilitiesRejectPlatformHost();
}

void run();
