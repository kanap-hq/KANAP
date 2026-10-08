import * as assert from 'node:assert/strict';
import { AiPolicyService } from '../ai-policy.service';
import { Features } from '../../config/features';
import { Tenant, TenantStatus } from '../../tenants/tenant.entity';
import { UserRole } from '../../users/user-role.entity';
import { Subscription, SubscriptionStatus } from '../../billing/subscription.entity';

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
}) {
  const tenant = {
    id: 'tenant-1',
    status: options?.tenantStatus ?? TenantStatus.ACTIVE,
  } as Tenant;
  const userRoles = options?.userRoles ?? [{ role_id: 'role-1', role: { role_name: 'AI Chat User' } }];
  const subscription = options?.subscription ?? null;

  return {
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

async function run() {
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
