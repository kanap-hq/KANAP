import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { moduleRightRequired } from '../auth/module-right-required';
import { throwFeatureDisabled } from '../common/feature-gates';
import { StripeConfigService } from '../billing/stripe';
import { Subscription } from '../billing/subscription.entity';
import { evaluateSubscriptionAccess } from '../billing/subscription-freeze.util';
import { Features } from '../config/features';
import { DataAccessReservedException, dataAccessModeOf } from '../data-access/reserved-operations';
import type { AiAdminFamiliesGap } from './ai-unread-families';
import { PermissionLevel, PermissionsService } from '../permissions/permissions.service';
import { Tenant, TenantStatus } from '../tenants/tenant.entity';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.entity';
import { AiSettingsService } from './ai-settings.service';
import { PlatformAiConfigService } from './platform/platform-ai-config.service';
import { AiProviderRegistry } from './providers/ai-provider-registry.service';
import { CONTRIBUTOR_PLAIN_SCOPES, CONTRIBUTOR_WRITABLE_FIELDS } from './mutation/ai-write-levels';
import {
  AI_CONTEXT_ENTITY_TYPES,
  AI_QUERY_ENTITY_TYPES,
  AiCapabilitiesDto,
  AiContextEntityType,
  AiExecutionContext,
  AiQueryEntityType,
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

/**
 * The right each entity type needs. `budget_lines` needs `budget`, the one right on every budget
 * line (lot R), for both natures. The reads that address one line by id or reference resolve its
 * nature (`resolveBudgetLine`, `spend/budget-nature.ts`); the list reads name both natures
 * explicitly (`SUMMARY_SCOPES.all`).
 */
const ENTITY_RESOURCE: Record<AiQueryEntityType | AiContextEntityType, string> = {
  accounts: 'accounts',
  analytics_categories: 'analytics',
  applications: 'applications',
  assets: 'infrastructure',
  budget_lines: 'budget',
  business_processes: 'business_processes',
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
  suppliers: 'suppliers',
  tasks: 'tasks',
  technologies: 'infrastructure',
  // One row per version of a technology, read with the technology right.
  technology_versions: 'infrastructure',
  // The two End of support report lists, read with the report's right.
  support_gaps: 'infrastructure',
  support_deadlines: 'infrastructure',
  users: 'users',
  documents: 'knowledge',
  // The CVE rows of the technologies, as the vulnerabilities page reads them.
  vulnerabilities: 'infrastructure',
  // The roles and their rights, as Admin › Roles reads them (`GET /roles`, `GET /roles/:id/permissions`).
  roles: 'users',
  role_permissions: 'users',
  // The limited persons and their nodes, as Admin › Data access reads them (`GET /data-access`).
  data_access: 'users',
};

/**
 * The families whose screen asks more than the reader level of their right: Admin › Roles and
 * Admin › Data access need users at admin level. Every check of a family reads it (`canReadEntityType`,
 * `assertEntityTypeReadAccess`, `listReadableEntityTypes`); a lower level asked by a caller is
 * raised to it.
 */
const ENTITY_MIN_LEVEL: Partial<Record<AiQueryEntityType | AiContextEntityType, PermissionLevel>> = {
  roles: 'admin',
  role_permissions: 'admin',
  data_access: 'admin',
};

/**
 * The families reserved to people whose access is not limited, as their screen: Admin › Roles is
 * closed to a person in limited access whatever their role (`frontend/src/auth/dataAccess.ts`), and
 * the routes of Admin › Data access refuse them (`@ReservedToUnscopedDataAccess`). The database
 * does not protect the nodes: this check is the only gate.
 * Checked in the person's transaction (`dataAccessModeOf`), refused with the reserved message.
 */
const UNSCOPED_ONLY_ENTITY_TYPES: ReadonlySet<string> = new Set(['roles', 'role_permissions', 'data_access']);

/** The screen whose right a family's refusal names, for the families read as their screen. */
const ENTITY_SCREEN: Partial<Record<AiQueryEntityType | AiContextEntityType, string>> = {
  roles: 'Admin › Roles',
  role_permissions: 'Admin › Roles',
  data_access: 'Admin › Data access',
};

/** The level a family is read at: the caller's, raised to the family's minimum. */
function entityReadLevel(entityType: AiQueryEntityType | AiContextEntityType, level?: PermissionLevel): PermissionLevel {
  const minimum = ENTITY_MIN_LEVEL[entityType] ?? 'reader';
  return level && LEVEL_RANK[level] > LEVEL_RANK[minimum] ? level : minimum;
}

/** Each right in plain words, as a refusal names it to the person (never its code, P4-9). */
const RIGHT_PLAIN_NAMES: Record<string, string> = {
  accounts: 'accounts',
  analytics: 'analytics dimensions',
  applications: 'applications and interfaces',
  budget: 'budget lines',
  business_processes: 'business processes',
  companies: 'companies',
  contacts: 'contacts',
  contracts: 'contracts',
  departments: 'departments',
  incidents: 'incidents',
  infrastructure: 'IT infrastructure (assets, connections, technologies)',
  knowledge: 'knowledge documents',
  locations: 'locations',
  portfolio_projects: 'projects',
  portfolio_requests: 'requests',
  suppliers: 'suppliers',
  tasks: 'tasks',
  users: 'users',
};

const LEVEL_PLAIN_VERBS: Record<PermissionLevel, string> = {
  reader: 'read',
  contributor: 'contribute to',
  member: 'modify',
  admin: 'administer',
};

/**
 * The refusal of a missing right, in plain words: which right, at which level (P4-5, P4-9). The
 * chat model says it again in the person's language; an MCP client reads it as is.
 */
export function missingRightMessage(resource: string, minimumLevel: PermissionLevel, screen?: string): string {
  if (resource === 'ai_chat') {
    return minimumLevel === 'reader'
      ? 'Your role does not give access to Plaid. An administrator can add it to your role.'
      : 'Your role lets you ask Plaid questions but not prepare changes with it: that needs the Plaid right at member level. An administrator can add it to your role.';
  }
  const name = RIGHT_PLAIN_NAMES[resource];
  // The rights of the settings and the MCP surface keep their code: the administration screens read it.
  if (!name) return `Missing required permission ${resource}:${minimumLevel}.`;
  const where = screen ? ` (the right the ${screen} screen asks for)` : '';
  return `You need the right to ${LEVEL_PLAIN_VERBS[minimumLevel] ?? minimumLevel} ${name}${where}, which your role does not give. An administrator can add it to your role.`;
}

/**
 * The refusal of a field a contributor may not change through Plaid, as the screen does not let
 * them (lot D11): which fields, and the right that would.
 */
export function contributorFieldsMessage(resource: string, fieldLabels: string[]): string {
  const name = RIGHT_PLAIN_NAMES[resource] ?? resource;
  return `Your role lets you contribute to ${name} but not change ${fieldLabels.join(', ')}: that needs the right to modify ${name}, which your role does not give. An administrator can add it to your role.`;
}

/** What a write needs beyond its module: its level and, for a record's fields, the fields it changes. */
export type AiWriteAccessRequirement = {
  level?: PermissionLevel;
  toolName?: string;
  family?: string;
  /** The fields the write changes, by name, with their labels for the refusal. */
  fields?: Record<string, string>;
};

/**
 * Whether a message is a refusal of a right or of a data access, as `missingRightMessage` and the
 * data-access checks write it ("This line is read only in your access."): a preview card shows such a
 * refusal as it is, and any other failure as a translated sentence with the message as its detail.
 */
export function isRightRefusalMessage(message: string | null | undefined): boolean {
  const text = String(message ?? '').trim();
  if (!text) return false;
  return text.startsWith('You need the right to ')
    || text.startsWith('Your role does not give access to Plaid.')
    || text.startsWith('Your role lets you ask Plaid questions but not prepare changes')
    || text.startsWith('Your role lets you contribute to ')
    || text.startsWith('Missing required permission ')
    || / in your access\.$/.test(text)
    || / outside your data access\.$/.test(text);
}

/** The entity types the policy knows; any other requested value is never readable. */
const KNOWN_ENTITY_TYPES: ReadonlySet<string> = new Set<string>([
  ...AI_QUERY_ENTITY_TYPES,
  ...AI_CONTEXT_ENTITY_TYPES,
]);

/**
 * A family whose records exist only with a feature on. Off, the family is never readable: left
 * out of the readable families, and refused with the feature's name, as its HTTP routes
 * (`VulnerabilityFeedGuard`). `vulnerabilities` needs the vulnerability feed.
 */
function entityTypeFeature(entityType: string): string | null {
  if (entityType === 'vulnerabilities' && !Features.VULNERABILITY_FEED_ENABLED) return 'vulnerabilityFeed';
  return null;
}

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
    screen?: string,
  ): Promise<void> {
    const state = await this.getEffectivePermissionState(userId, manager);
    if (state.isAdmin) {
      return;
    }

    const current = state.permissions.get(resource);
    if (!current || (LEVEL_RANK[current] ?? 0) < (LEVEL_RANK[minimumLevel] ?? 0)) {
      throw moduleRightRequired(resource, minimumLevel, missingRightMessage(resource, minimumLevel, screen));
    }
  }

  /**
   * Whether a family reserved to people whose access is not limited is closed to this person: their
   * access is limited in the transaction of the call (`app.da_mode`, or their mode and roles).
   */
  private async isReservedFamilyClosed(
    context: Pick<AiExecutionContext, 'userId'>,
    entityType: AiQueryEntityType | AiContextEntityType,
    manager: EntityManager,
  ): Promise<boolean> {
    if (!UNSCOPED_ONLY_ENTITY_TYPES.has(entityType)) return false;
    return (await dataAccessModeOf({ manager, userId: context.userId })) === 'limited';
  }

  /**
   * What this person may change through Plaid, in plain words, for the refusals of the chat:
   * whether their role lets them prepare changes with Plaid, and the modules they may modify.
   */
  async describeWriteRights(
    context: AiExecutionContext,
    manager: EntityManager,
  ): Promise<{ plaidChanges: boolean; modifiableModules: string[]; contributableModules: string[] }> {
    const state = await this.getEffectivePermissionStateOrNull(context.userId, manager);
    const resources = Object.keys(RIGHT_PLAIN_NAMES);
    return {
      plaidChanges: context.surface === 'chat' && this.hasPermission(state, 'ai_chat', 'member'),
      modifiableModules: resources.filter((resource) => this.hasPermission(state, resource, 'member')).map((resource) => RIGHT_PLAIN_NAMES[resource]),
      // The modules the person changes at contributor level only, with what that covers (lot D11).
      contributableModules: Object.keys(CONTRIBUTOR_PLAIN_SCOPES)
        .filter((resource) => this.hasPermission(state, resource, 'contributor') && !this.hasPermission(state, resource, 'member'))
        .map((resource) => CONTRIBUTOR_PLAIN_SCOPES[resource]),
    };
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

  /**
   * Whether the user reads `entityType`, without the surface checks (the tool already made them):
   * for a section of another family inside a record, which is left out rather than refused. The
   * level defaults to the family's (`ENTITY_MIN_LEVEL`), and a family reserved to people whose
   * access is not limited is closed to the others.
   */
  async canReadEntityType(
    context: AiExecutionContext,
    entityType: AiQueryEntityType | AiContextEntityType,
    manager: EntityManager,
    level: PermissionLevel = entityReadLevel(entityType),
  ): Promise<boolean> {
    if (!KNOWN_ENTITY_TYPES.has(entityType) || entityTypeFeature(entityType)) return false;
    try {
      await this.assertUserPermission(context.userId, ENTITY_RESOURCE[entityType], entityReadLevel(entityType, level), manager);
      if (await this.isReservedFamilyClosed(context, entityType, manager)) return false;
      return true;
    } catch (error) {
      if (!(error instanceof ForbiddenException)) {
        this.logger.warn(
          `Unexpected error while probing ${entityType} read access for user ${context.userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return false;
    }
  }

  /**
   * The rights, among `resources`, the user holds at reader level, without the surface checks: the
   * pages of the application a read tool may link to (`ai-page-urls.ts`).
   */
  async readableResources(context: AiExecutionContext, resources: string[], manager: EntityManager): Promise<Set<string>> {
    const state = await this.getEffectivePermissionStateOrNull(context.userId, manager);
    return new Set(resources.filter((resource) => this.hasPermission(state, resource, 'reader')));
  }

  /**
   * Why the families of Admin › Roles and Admin › Data access are closed to this person, for the
   * lists of what the tools do not read (`AiAdminFamiliesGap`): `right` without users at admin
   * level, `all_data` with it in limited access, null when they read them.
   */
  async adminFamiliesGap(
    context: Pick<AiExecutionContext, 'userId'>,
    manager: EntityManager,
  ): Promise<AiAdminFamiliesGap> {
    const state = context.userId ? await this.getEffectivePermissionStateOrNull(context.userId, manager) : null;
    if (!this.hasPermission(state, 'users', 'admin')) return 'right';
    return (await dataAccessModeOf({ manager, userId: context.userId })) === 'limited' ? 'all_data' : null;
  }

  /**
   * The person's rights in the shape a request carries them (`TenantRequest.isAdmin`,
   * `permissions`), for a service of the screens that checks them itself (the record history).
   * The same read as every check of this policy; a person the policy refuses holds nothing.
   */
  async effectiveAccess(
    context: Pick<AiExecutionContext, 'userId'>,
    manager: EntityManager,
  ): Promise<{ isAdmin: boolean; permissions: Record<string, PermissionLevel> }> {
    const state = context.userId ? await this.getEffectivePermissionStateOrNull(context.userId, manager) : null;
    return {
      isAdmin: state?.isAdmin === true,
      permissions: state ? Object.fromEntries(state.permissions) : {},
    };
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
    throw moduleRightRequired('ai_settings', 'admin', 'Missing required permission ai_settings:admin.');
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
    throw moduleRightRequired('ai_agents', minimumLevel, `Missing required permission ai_agents:${minimumLevel}.`);
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

  /**
   * A read of a family: the surface, the family's right at its level (`ENTITY_MIN_LEVEL`), its
   * feature, then, for a family reserved to people whose access is not limited, the person's
   * access (refused with the reserved message, as the screen is closed to them).
   */
  async assertEntityTypeReadAccess(
    context: AiExecutionContext,
    entityType: AiQueryEntityType | AiContextEntityType,
    manager: EntityManager,
  ): Promise<void> {
    await this.assertSurfaceAccess(context, manager);
    await this.assertUserPermission(context.userId, ENTITY_RESOURCE[entityType], entityReadLevel(entityType), manager, ENTITY_SCREEN[entityType]);
    const feature = entityTypeFeature(entityType);
    if (feature) throwFeatureDisabled(feature);
    if (await this.isReservedFamilyClosed(context, entityType, manager)) throw new DataAccessReservedException();
  }

  async listReadableEntityTypes(
    context: AiExecutionContext,
    requested: Array<AiQueryEntityType | AiContextEntityType>,
    manager: EntityManager,
  ): Promise<Array<AiQueryEntityType | AiContextEntityType>> {
    await this.assertSurfaceAccess(context, manager);

    const readable: Array<AiQueryEntityType | AiContextEntityType> = [];
    // Read once, and only when a requested family is reserved to people whose access is not limited.
    let limited: boolean | null = null;
    for (const entityType of requested) {
      // Checked before the permissions: an administrator passes every permission check.
      if (!KNOWN_ENTITY_TYPES.has(entityType) || entityTypeFeature(entityType)) continue;
      try {
        await this.assertUserPermission(context.userId, ENTITY_RESOURCE[entityType], entityReadLevel(entityType), manager);
        if (UNSCOPED_ONLY_ENTITY_TYPES.has(entityType)) {
          limited ??= await this.isReservedFamilyClosed(context, entityType, manager);
          if (limited) continue;
        }
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

  /**
   * A write through Plaid: the chat surface, the Plaid right at member level, and the module at the
   * level of the screen route that makes the same change (`member`, or `contributor` where the
   * screen opens it, `mutation/ai-write-levels.ts`). A person who holds the module at contributor
   * level only changes the fields the screen opens to a contributor; the others are refused with
   * the right they need. The participation scope of the record is checked by the caller
   * (`assertRecordInWriteScope`).
   */
  async assertWriteAccess(
    context: AiExecutionContext,
    businessResource: string,
    manager: EntityManager,
    requirement: AiWriteAccessRequirement = {},
  ): Promise<void> {
    if (context.surface !== 'chat') {
      throw new ForbiddenException('MCP write access is not available.');
    }

    const level = requirement.level ?? 'member';
    await this.assertSurfaceAccess(context, manager);
    await this.assertUserPermission(context.userId, 'ai_chat', 'member', manager);
    await this.assertUserPermission(context.userId, businessResource, level, manager);
    if (LEVEL_RANK[level] < LEVEL_RANK.member && requirement.fields) {
      const allowed = CONTRIBUTOR_WRITABLE_FIELDS[requirement.toolName ?? '']?.[requirement.family ?? ''] ?? [];
      const refused = Object.keys(requirement.fields).filter((field) => !allowed.includes(field));
      if (refused.length > 0) {
        const state = await this.getEffectivePermissionState(context.userId, manager);
        if (!this.hasPermission(state, businessResource, 'member')) {
          throw new ForbiddenException(contributorFieldsMessage(
            businessResource,
            refused.map((field) => requirement.fields?.[field] || field),
          ));
        }
      }
    }
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
