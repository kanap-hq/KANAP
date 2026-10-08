import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { throwFeatureDisabled } from '../common/feature-gates';
import { StripeConfigService } from '../billing/stripe';
import { Subscription } from '../billing/subscription.entity';
import { evaluateSubscriptionAccess } from '../billing/subscription-freeze.util';
import { Features } from '../config/features';
import { PermissionLevel, PermissionsService } from '../permissions/permissions.service';
import { Tenant, TenantStatus } from '../tenants/tenant.entity';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.entity';
import { AiSettingsService } from './ai-settings.service';
import { PlatformAiConfigService } from './platform/platform-ai-config.service';
import { AiProviderRegistry } from './providers/ai-provider-registry.service';
import {
  AI_CONTEXT_ENTITY_TYPES,
  AI_SEARCH_ENTITY_TYPES,
  AiCapabilitiesDto,
  AiContextEntityType,
  AiExecutionContext,
  AiSearchEntityType,
  AiSettingsCapabilityDto,
  AiSurface,
  AiSurfaceCapabilityDto,
} from './ai.types';

const LEVEL_RANK: Record<PermissionLevel, number> = {
  reader: 1,
  contributor: 2,
  member: 3,
  admin: 4,
};

const SURFACE_RESOURCE: Record<AiSurface, 'ai_chat' | 'ai_mcp'> = {
  chat: 'ai_chat',
  mcp: 'ai_mcp',
};

const ENTITY_RESOURCE: Record<AiSearchEntityType | AiContextEntityType, string> = {
  accounts: 'accounts',
  analytics_categories: 'analytics',
  applications: 'applications',
  assets: 'infrastructure',
  business_processes: 'business_processes',
  capex_items: 'capex',
  chart_of_accounts: 'accounts',
  companies: 'companies',
  connections: 'infrastructure',
  contacts: 'contacts',
  contracts: 'contracts',
  departments: 'departments',
  incidents: 'incidents',
  interfaces: 'applications',
  locations: 'locations',
  projects: 'portfolio_projects',
  requests: 'portfolio_requests',
  spend_items: 'opex',
  suppliers: 'suppliers',
  tasks: 'tasks',
  users: 'users',
  documents: 'knowledge',
};

/** The entity types the policy knows; any other requested value is never readable. */
const KNOWN_ENTITY_TYPES: ReadonlySet<string> = new Set<string>([
  ...AI_SEARCH_ENTITY_TYPES,
  ...AI_CONTEXT_ENTITY_TYPES,
]);

type EffectivePermissionState = {
  isAdmin: boolean;
  permissions: Map<string, PermissionLevel>;
};

type AiPolicyAccessContext = Pick<AiExecutionContext, 'tenantId' | 'userId' | 'isPlatformHost'>;

@Injectable()
export class AiPolicyService {
  private readonly logger = new Logger(AiPolicyService.name);

  constructor(
    private readonly users: UsersService,
    private readonly permissions: PermissionsService,
    private readonly aiSettings: AiSettingsService,
    private readonly providerRegistry: AiProviderRegistry,
    private readonly platformAiConfig: PlatformAiConfigService,
    private readonly stripeConfig: StripeConfigService,
  ) {}

  private async getEffectivePermissionStateOrNull(
    userId: string,
    manager: EntityManager,
  ): Promise<EffectivePermissionState | null> {
    const user = await this.users.findById(userId, { manager });
    if (!user || user.status !== 'enabled') {
      return null;
    }

    const roleName = (user.role?.role_name ?? '').toLowerCase();
    if (user.role?.is_system && roleName !== 'administrator') {
      return null;
    }

    const userRoles = await manager.getRepository(UserRole).find({
      where: { user_id: user.id },
      relations: ['role'],
    });

    const roleIds = new Set<string>();
    if (user.role_id) roleIds.add(user.role_id);
    for (const userRole of userRoles) {
      roleIds.add(userRole.role_id);
    }

    const roleNames = userRoles.map((userRole) => userRole.role?.role_name?.toLowerCase() ?? '');
    if (user.role?.role_name) {
      roleNames.push(user.role.role_name.toLowerCase());
    }

    const isAdmin = roleNames.includes('administrator');
    return {
      isAdmin,
      permissions: isAdmin ? new Map() : await this.permissions.listForRoles(Array.from(roleIds), { manager }),
    };
  }

  private async getEffectivePermissionState(
    userId: string,
    manager: EntityManager,
  ): Promise<EffectivePermissionState> {
    const state = await this.getEffectivePermissionStateOrNull(userId, manager);
    if (!state) {
      throw new ForbiddenException('User is not allowed to use AI.');
    }
    return state;
  }

  private hasPermission(
    state: EffectivePermissionState | null,
    resource: string,
    minimumLevel: PermissionLevel,
  ): boolean {
    if (!state) return false;
    if (state.isAdmin) {
      return true;
    }

    const current = state.permissions.get(resource);
    if (!current) return false;
    return (LEVEL_RANK[current] ?? 0) >= (LEVEL_RANK[minimumLevel] ?? 0);
  }

  private assertPlatformHostAllowed(context: Pick<AiExecutionContext, 'isPlatformHost'>): void {
    if (context.isPlatformHost) {
      throw new ForbiddenException('AI is not available on the platform host.');
    }
  }

  private getSurfaceFeature(surface: AiSurface): boolean {
    switch (surface) {
      case 'chat':
        return Features.AI_CHAT_ENABLED;
      case 'mcp':
        return Features.AI_MCP_ENABLED;
      default:
        return false;
    }
  }

  private async assertTenantAvailable(tenantId: string, manager: EntityManager): Promise<void> {
    const tenant = await manager.getRepository(Tenant).findOne({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new ForbiddenException('Tenant not found.');
    }
    if (tenant.status !== TenantStatus.ACTIVE) {
      throw new ForbiddenException('AI is not available for this tenant while it is inactive.');
    }
  }

  private async assertUserPermission(
    userId: string,
    resource: string,
    minimumLevel: PermissionLevel,
    manager: EntityManager,
  ): Promise<void> {
    const state = await this.getEffectivePermissionState(userId, manager);
    if (state.isAdmin) {
      return;
    }

    const current = state.permissions.get(resource);
    if (!current || (LEVEL_RANK[current] ?? 0) < (LEVEL_RANK[minimumLevel] ?? 0)) {
      throw new ForbiddenException(`Missing required permission ${resource}:${minimumLevel}.`);
    }
  }

  async canReadKnowledge(context: AiExecutionContext, manager: EntityManager): Promise<boolean> {
    try {
      await this.assertUserPermission(context.userId, 'knowledge', 'reader', manager);
      return true;
    } catch (error) {
      if (!(error instanceof ForbiddenException)) {
        this.logger.warn(
          `Unexpected error while probing knowledge read access for user ${context.userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return false;
    }
  }

  async getCapabilities(
    context: AiPolicyAccessContext,
    manager: EntityManager,
  ): Promise<AiCapabilitiesDto> {
    this.assertPlatformHostAllowed(context);
    const state = await this.getEffectivePermissionStateOrNull(context.userId, manager);
    const tenant = await manager.getRepository(Tenant).findOne({
      where: { id: context.tenantId },
    });
    const tenantActive = !!tenant && tenant.status === TenantStatus.ACTIVE;
    const settings = tenant ? await this.aiSettings.find(context.tenantId, { manager }) : null;
    const readiness = settings ? await this.aiSettings.getProviderReadiness(settings, manager) : null;
    const providerReady = readiness ? readiness.errors.length === 0 : false;
    // The included model waits for an administrator's confirmation: named apart so
    // the assistant can say so instead of a generic message.
    const providerReason = readiness?.errorCode === 'builtin_not_accepted' ? 'builtin_not_accepted' : 'provider_not_ready';
    // MCP sends nothing to the included model: ready on valid settings, confirmed or not.
    const mcpProviderReady = providerReady
      || (!!settings && (await this.aiSettings.getProviderErrorsWithoutConfirmation(settings, manager)).length === 0);
    const builtinConfirmationNeeded = tenant
      ? await this.aiSettings.isBuiltinConfirmationNeeded(context.tenantId, settings, manager, readiness)
      : false;

    const buildSurfaceCapability = (
      surface: AiSurface,
      opts: {
        tenantEnabled: boolean;
        permissionGranted: boolean;
        providerReady?: boolean;
        providerReason?: string;
      },
    ): AiSurfaceCapabilityDto => {
      const reasons: string[] = [];
      const featureEnabled = this.getSurfaceFeature(surface);
      const providerReady = opts.providerReady ?? true;

      if (!featureEnabled) reasons.push('feature_disabled');
      if (!tenant) reasons.push('tenant_not_found');
      if (tenant && !tenantActive) reasons.push('tenant_inactive');
      if (!opts.tenantEnabled) reasons.push('tenant_disabled');
      if (!providerReady) reasons.push(opts.providerReason ?? 'provider_not_ready');
      if (!state) reasons.push('user_not_allowed');
      if (!opts.permissionGranted) reasons.push('permission_denied');

      return {
        feature_enabled: featureEnabled,
        tenant_enabled: opts.tenantEnabled,
        permission_granted: opts.permissionGranted,
        provider_ready: providerReady,
        available: reasons.length === 0,
        reasons,
      };
    };

    const buildSettingsCapability = (
      permissionGranted: boolean,
    ): AiSettingsCapabilityDto => {
      const reasons: string[] = [];
      if (!Features.AI_SETTINGS_ENABLED) reasons.push('feature_disabled');
      if (!tenant) reasons.push('tenant_not_found');
      if (tenant && !tenantActive) reasons.push('tenant_inactive');
      if (!state) reasons.push('user_not_allowed');
      if (!permissionGranted) reasons.push('permission_denied');

      return {
        feature_enabled: Features.AI_SETTINGS_ENABLED,
        permission_granted: permissionGranted,
        available: reasons.length === 0,
        reasons,
      };
    };

    return {
      instance_features: {
        ai_chat: Features.AI_CHAT_ENABLED,
        ai_mcp: Features.AI_MCP_ENABLED,
        ai_settings: Features.AI_SETTINGS_ENABLED,
        ai_web_search: Features.AI_WEB_SEARCH_READY,
      },
      surfaces: {
        chat: buildSurfaceCapability('chat', {
          tenantEnabled: settings?.chat_enabled === true,
          permissionGranted: this.hasPermission(state, 'ai_chat', 'reader'),
          providerReady,
          providerReason,
        }),
        mcp: buildSurfaceCapability('mcp', {
          tenantEnabled: settings?.mcp_enabled === true,
          permissionGranted: this.hasPermission(state, 'ai_mcp', 'reader'),
          providerReady: mcpProviderReady,
        }),
        settings: buildSettingsCapability(
          this.hasPermission(state, 'ai_settings', 'admin'),
        ),
      },
      builtin_confirmation_needed: builtinConfirmationNeeded,
    };
  }

  async assertSurfaceAccess(context: AiExecutionContext, manager: EntityManager): Promise<void> {
    this.assertPlatformHostAllowed(context);

    if (!this.getSurfaceFeature(context.surface)) {
      throwFeatureDisabled(SURFACE_RESOURCE[context.surface]);
    }

    await this.assertTenantAvailable(context.tenantId, manager);
    await this.assertSubscriptionAllowsAi(context.tenantId, manager);

    const settings = await this.aiSettings.get(context.tenantId, { manager });
    if (context.surface === 'chat') {
      if (!settings.chat_enabled) {
        throw new ForbiddenException('AI chat is disabled for this tenant.');
      }
      // Agent runs and system work pass here to use KANAP tools. Every model call they
      // make goes through the model resolver, which checks the included model's
      // confirmation for the model that call runs on. Here they need the assistant's model
      // set up as before: an agent on its own model keeps working while the assistant
      // waits for the confirmation.
      const runsWithoutTheAssistant = !!context.agentId || !context.userId;
      const providerErrors = runsWithoutTheAssistant
        ? await this.aiSettings.getProviderErrorsWithoutConfirmation(settings, manager)
        : await this.aiSettings.getProviderValidationErrors(settings, manager);
      if (providerErrors.length > 0) {
        throw new ForbiddenException('AI chat is not fully configured for this tenant.');
      }
    }
    if (context.surface === 'mcp') {
      if (!settings.mcp_enabled) {
        throw new ForbiddenException('AI MCP access is disabled for this tenant.');
      }
      // MCP sends KANAP data to the user's own client, never to the included model.
      if ((await this.aiSettings.getProviderErrorsWithoutConfirmation(settings, manager)).length > 0) {
        throw new ForbiddenException('AI MCP is not fully configured for this tenant.');
      }
    }

    await this.assertUserPermission(context.userId, SURFACE_RESOURCE[context.surface], 'reader', manager);
  }

  async assertKeyManagementAccess(
    context: AiPolicyAccessContext,
    manager: EntityManager,
  ): Promise<void> {
    this.assertPlatformHostAllowed(context);

    if (!Features.AI_MCP_ENABLED) {
      throwFeatureDisabled('ai_mcp');
    }

    await this.assertTenantAvailable(context.tenantId, manager);
    await this.assertUserPermission(context.userId, 'ai_mcp', 'reader', manager);
  }

  async assertSettingsAccess(
    context: AiPolicyAccessContext,
    manager: EntityManager,
  ): Promise<void> {
    this.assertPlatformHostAllowed(context);

    if (!Features.AI_SETTINGS_ENABLED) {
      throwFeatureDisabled('ai_settings');
    }

    await this.assertTenantAvailable(context.tenantId, manager);
    await this.assertUserPermission(context.userId, 'ai_settings', 'admin', manager);
  }

  // Model registry reads: settings admins get the full view; agent admins get
  // an assignment tier so they can pick models for agents without seeing
  // provider, endpoint, or pricing details.
  async resolveModelConfigReadTier(
    context: AiPolicyAccessContext,
    manager: EntityManager,
  ): Promise<'full' | 'assignment'> {
    this.assertPlatformHostAllowed(context);

    if (!Features.AI_SETTINGS_ENABLED) {
      throwFeatureDisabled('ai_settings');
    }

    await this.assertTenantAvailable(context.tenantId, manager);
    const state = await this.getEffectivePermissionState(context.userId, manager);
    if (this.hasPermission(state, 'ai_settings', 'admin')) {
      return 'full';
    }
    if (this.hasPermission(state, 'ai_agents', 'admin')) {
      await this.assertSubscriptionAllowsAi(context.tenantId, manager);
      return 'assignment';
    }
    throw new ForbiddenException('Missing required permission ai_settings:admin.');
  }

  private async assertAgentAccess(
    context: AiPolicyAccessContext,
    manager: EntityManager,
    minimumLevel: PermissionLevel,
  ): Promise<void> {
    this.assertPlatformHostAllowed(context);

    if (!Features.AI_SETTINGS_ENABLED) {
      throwFeatureDisabled('ai_settings');
    }

    await this.assertTenantAvailable(context.tenantId, manager);
    await this.assertSubscriptionAllowsAi(context.tenantId, manager);
    const state = await this.getEffectivePermissionState(context.userId, manager);
    if (this.hasPermission(state, 'ai_settings', 'admin')) {
      return;
    }
    if (this.hasPermission(state, 'ai_agents', minimumLevel)) {
      return;
    }
    throw new ForbiddenException(`Missing required permission ai_agents:${minimumLevel}.`);
  }

  async assertAgentRead(
    context: AiPolicyAccessContext,
    manager: EntityManager,
  ): Promise<void> {
    await this.assertAgentAccess(context, manager, 'reader');
  }

  async assertAgentOperate(
    context: AiPolicyAccessContext,
    manager: EntityManager,
  ): Promise<void> {
    await this.assertAgentAccess(context, manager, 'contributor');
  }

  async assertAgentAdmin(
    context: AiPolicyAccessContext,
    manager: EntityManager,
  ): Promise<void> {
    await this.assertAgentAccess(context, manager, 'admin');
  }

  async assertKnowledgeReadAccess(context: AiExecutionContext, manager: EntityManager): Promise<void> {
    await this.assertSurfaceAccess(context, manager);
    await this.assertUserPermission(context.userId, 'knowledge', 'reader', manager);
  }

  async assertBusinessPermission(
    context: AiExecutionContext,
    businessResource: string,
    minimumLevel: PermissionLevel,
    manager: EntityManager,
  ): Promise<void> {
    await this.assertSurfaceAccess(context, manager);
    await this.assertUserPermission(context.userId, businessResource, minimumLevel, manager);
  }

  async assertEntityTypeReadAccess(
    context: AiExecutionContext,
    entityType: AiSearchEntityType | AiContextEntityType,
    manager: EntityManager,
  ): Promise<void> {
    await this.assertBusinessPermission(context, ENTITY_RESOURCE[entityType], 'reader', manager);
  }

  async listReadableEntityTypes(
    context: AiExecutionContext,
    requested: Array<AiSearchEntityType | AiContextEntityType>,
    manager: EntityManager,
  ): Promise<Array<AiSearchEntityType | AiContextEntityType>> {
    await this.assertSurfaceAccess(context, manager);

    const readable: Array<AiSearchEntityType | AiContextEntityType> = [];
    for (const entityType of requested) {
      // Checked before the permissions: an administrator passes every permission check.
      if (!KNOWN_ENTITY_TYPES.has(entityType)) continue;
      try {
        await this.assertUserPermission(context.userId, ENTITY_RESOURCE[entityType], 'reader', manager);
        readable.push(entityType);
      } catch (error) {
        if (!(error instanceof ForbiddenException)) {
          this.logger.warn(
            `Unexpected error while probing ${entityType} read access for user ${context.userId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    return readable;
  }

  async assertWriteAccess(
    context: AiExecutionContext,
    businessResource: string,
    manager: EntityManager,
  ): Promise<void> {
    if (context.surface !== 'chat') {
      throw new ForbiddenException('MCP write access is not available.');
    }

    await this.assertSurfaceAccess(context, manager);
    await this.assertUserPermission(context.userId, 'ai_chat', 'member', manager);
    await this.assertUserPermission(context.userId, businessResource, 'member', manager);
    await this.assertSubscriptionAllowsAi(context.tenantId, manager);
  }

  /**
   * Blocks AI/agent use for tenants whose subscription is frozen (non-payment,
   * past the grace window) or whose trial has expired. No-op when billing isn't
   * configured (on-prem / single-tenant). This is the AI/agent counterpart to
   * PermissionGuard's generic write freeze, and is enforced at every AI entry
   * point — reads included — because a frozen tenant must not consume the
   * built-in free-message quota, which is a direct operator cost.
   */
  async assertSubscriptionAllowsAi(tenantId: string, manager: EntityManager): Promise<void> {
    const configured = this.stripeConfig.isConfigured();
    const subscription = configured
      ? await manager.getRepository(Subscription).findOne({
          where: { tenant_id: tenantId },
          order: { created_at: 'DESC' },
        })
      : null;
    const decision = evaluateSubscriptionAccess(subscription, Date.now(), configured);
    if (!decision.allowed) {
      throw new ForbiddenException({ error: decision.reason, message: decision.message });
    }
  }
}
