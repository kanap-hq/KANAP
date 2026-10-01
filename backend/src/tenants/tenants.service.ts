import { catalogToMetadata, DEFAULT_CLASSIFICATION_CATALOG } from '../it-ops-settings/classification-catalog';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { Tenant, TenantBranding, TenantStatus } from './tenant.entity';
import { RolesService } from '../roles/roles.service';
import { Role } from '../roles/role.entity';
import { PermissionsService, PermissionLevel } from '../permissions/permissions.service';
import { isReservedTenantSlug, normalizeTenantSlug } from './tenant-slug-policy';
import { DEFAULT_TASK_TYPES } from '../portfolio/portfolio-task-type.entity';
import { DEFAULT_EMPLOYMENT_TYPES } from '../portfolio/portfolio-employment-type.entity';
import { seedManagedDocsKnowledgeAssets } from '../knowledge/integrated-document-seed';
import { ensureDefaultAnalyticsAxis } from '../analytics/analytics-axes.util';

// Built-in roles configuration for newly created tenants.
const BUILT_IN_ROLES: Array<{
  name: string;
  description: string;
  permissions: Record<string, PermissionLevel>;
}> = [
  // Budget Roles
  {
    name: 'Budget Administrator',
    description: 'Full control over budget management including OPEX, CAPEX, contracts, and reporting',
    permissions: {
      opex: 'admin', capex: 'admin', budget_ops: 'admin', contracts: 'admin',
      analytics: 'admin', reporting: 'admin', tasks: 'member', users: 'reader',
      companies: 'member', departments: 'member', cost_centers: 'admin', working_day_profiles: 'admin', suppliers: 'member',
      contacts: 'member', accounts: 'member'
    }
  },
  {
    name: 'Budget Member',
    description: 'Can manage budget items, contracts, and view reports',
    permissions: {
      opex: 'member', capex: 'member', budget_ops: 'reader', contracts: 'member',
      analytics: 'member', reporting: 'member', tasks: 'member',
      companies: 'reader', departments: 'member', cost_centers: 'member', working_day_profiles: 'member', suppliers: 'member',
      contacts: 'member', accounts: 'reader'
    }
  },
  {
    name: 'Budget Reader',
    description: 'Read-only access to budget data and reports',
    permissions: {
      opex: 'reader', capex: 'reader', budget_ops: 'reader', contracts: 'reader',
      analytics: 'reader', reporting: 'reader', tasks: 'reader',
      companies: 'reader', departments: 'reader', cost_centers: 'reader', working_day_profiles: 'reader', suppliers: 'reader',
      contacts: 'reader', accounts: 'reader'
    }
  },
  // Portfolio Roles
  {
    name: 'Portfolio Administrator',
    description: 'Full control over portfolio management including requests, projects, and planning',
    permissions: {
      portfolio_requests: 'admin', portfolio_projects: 'admin', portfolio_planning: 'admin',
      portfolio_reports: 'admin', portfolio_settings: 'admin', tasks: 'member', users: 'reader',
      companies: 'reader', departments: 'reader', cost_centers: 'reader', working_day_profiles: 'reader', suppliers: 'member',
      contacts: 'member', accounts: 'member',
      applications: 'reader', infrastructure: 'reader', locations: 'reader', settings: 'reader',
      opex: 'reader', capex: 'reader', contracts: 'reader'
    }
  },
  {
    name: 'Portfolio Member',
    description: 'Can manage portfolio requests, projects, and planning',
    permissions: {
      portfolio_requests: 'member', portfolio_projects: 'member', portfolio_planning: 'member',
      portfolio_reports: 'reader', portfolio_settings: 'reader', tasks: 'member',
      companies: 'reader', departments: 'reader', cost_centers: 'reader', working_day_profiles: 'reader', suppliers: 'reader',
      contacts: 'reader', accounts: 'reader',
      applications: 'reader', infrastructure: 'reader', locations: 'reader'
    }
  },
  {
    name: 'Portfolio Reader',
    description: 'Read-only access to portfolio data',
    permissions: {
      portfolio_requests: 'reader', portfolio_projects: 'reader', portfolio_planning: 'reader',
      portfolio_reports: 'reader', portfolio_settings: 'reader', tasks: 'reader',
      companies: 'reader', departments: 'reader', cost_centers: 'reader', working_day_profiles: 'reader', suppliers: 'reader', contacts: 'reader'
    }
  },
  {
    name: 'Business Contributor',
    description: 'Can submit requests, contribute to projects and tasks, and read assigned applications',
    permissions: {
      portfolio_requests: 'member', portfolio_projects: 'contributor',
      tasks: 'member', applications: 'reader', users: 'reader'
    }
  },
  // IT Landscape Roles
  {
    name: 'IT Landscape Administrator',
    description: 'Full control over IT landscape including applications, infrastructure, and settings',
    permissions: {
      applications: 'admin', infrastructure: 'admin', locations: 'admin', incidents: 'admin', settings: 'admin',
      tasks: 'member', users: 'reader',
      companies: 'reader', departments: 'reader', cost_centers: 'reader', working_day_profiles: 'reader', suppliers: 'member', contacts: 'member',
      opex: 'reader', capex: 'reader', contracts: 'reader',
      portfolio_requests: 'reader', portfolio_projects: 'reader',
      portfolio_planning: 'reader', portfolio_reports: 'reader', portfolio_settings: 'reader'
    }
  },
  {
    name: 'IT Landscape Member',
    description: 'Can manage applications and infrastructure',
    permissions: {
      applications: 'member', infrastructure: 'member', locations: 'member', incidents: 'member', settings: 'member',
      tasks: 'member', users: 'reader',
      companies: 'reader', departments: 'reader', cost_centers: 'reader', working_day_profiles: 'reader', suppliers: 'reader', contacts: 'member',
      opex: 'reader', capex: 'reader', contracts: 'reader',
      portfolio_requests: 'reader', portfolio_projects: 'reader', portfolio_planning: 'reader'
    }
  },
  {
    name: 'IT Landscape Reader',
    description: 'Read-only access to IT landscape data',
    permissions: {
      applications: 'reader', infrastructure: 'reader', locations: 'reader', incidents: 'reader', settings: 'reader',
      tasks: 'reader', users: 'reader',
      companies: 'reader', departments: 'reader', cost_centers: 'reader', working_day_profiles: 'reader', suppliers: 'reader', contacts: 'reader'
    }
  },
  // Master Data Roles
  {
    name: 'Master Data Administrator',
    description: 'Full control over master data including companies, departments, suppliers, and locations',
    permissions: {
      companies: 'admin', departments: 'admin', cost_centers: 'admin', working_day_profiles: 'admin', suppliers: 'admin',
      contacts: 'admin', accounts: 'admin', business_processes: 'admin'
    }
  },
  {
    name: 'Master Data Member',
    description: 'Can manage master data entries',
    permissions: {
      companies: 'member', departments: 'member', cost_centers: 'member', working_day_profiles: 'member', suppliers: 'member',
      contacts: 'member', accounts: 'member', business_processes: 'member'
    }
  },
  {
    name: 'Master Data Reader',
    description: 'Read-only access to master data',
    permissions: {
      companies: 'reader', departments: 'reader', cost_centers: 'reader', working_day_profiles: 'reader', suppliers: 'reader',
      contacts: 'reader', accounts: 'reader', business_processes: 'reader'
    }
  },
  // Knowledge Roles
  {
    name: 'Knowledge Administrator',
    description: 'Full control over knowledge documents, libraries, types, and folders',
    permissions: { knowledge: 'admin' }
  },
  {
    name: 'Knowledge Member',
    description: 'Can create, edit, and relate knowledge documents',
    permissions: { knowledge: 'member' }
  },
  {
    name: 'Knowledge Reader',
    description: 'Read-only access to knowledge documents',
    permissions: { knowledge: 'reader' }
  },
  // Tasks Roles
  {
    name: 'Tasks Administrator',
    description: 'Full control over task management',
    permissions: { tasks: 'admin' }
  },
  {
    name: 'Tasks Member',
    description: 'Can manage and complete tasks',
    permissions: { tasks: 'member' }
  },
  {
    name: 'Tasks Reader',
    description: 'Read-only access to tasks',
    permissions: { tasks: 'reader' }
  },
  // AI Roles
  {
    name: 'AI Chat User',
    description: 'Can use read-only AI chat tools that respect existing business permissions',
    permissions: { ai_chat: 'reader' }
  },
  {
    name: 'AI Chat Operator',
    description: 'Can use AI chat features that prepare future confirmed AI actions',
    permissions: { ai_chat: 'member' }
  },
  {
    name: 'AI MCP User',
    description: 'Can use personal MCP API keys for read-only AI tools',
    permissions: { ai_mcp: 'reader' }
  },
  {
    name: 'AI Administrator',
    description: 'Can manage tenant AI settings and use both native chat and MCP read tools',
    permissions: {
      ai_chat: 'member',
      ai_mcp: 'reader',
      ai_agents: 'admin',
      ai_settings: 'admin',
    }
  },
  {
    name: 'Agent Admin',
    description: 'Configure AI agents, grant autonomy, and manage the agent lifecycle',
    permissions: { ai_agents: 'admin' }
  },
  {
    name: 'Agent Contributor',
    description: 'Review and approve or reject AI agent proposals, run checks, and pause agents',
    permissions: { ai_agents: 'contributor' }
  },
  {
    name: 'Agent Reader',
    description: 'View AI agents, their activity, and performance (read-only)',
    permissions: { ai_agents: 'reader' }
  }
];

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly repo: Repository<Tenant>,
    private readonly roles: RolesService,
    private readonly permissions: PermissionsService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Tenant) : this.repo;
  }

  findBySlug(slug: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    // Only consider non-deleted tenants (deleted_at IS NULL)
    return repo.findOne({ where: { slug, deleted_at: IsNull() } });
  }

  findById(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    return repo.findOne({ where: { id } });
  }

  async updateTenant(id: string, patch: Partial<Tenant>, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new Error('Tenant not found');
    if (typeof patch.slug === 'string') {
      const normalizedSlug = normalizeTenantSlug(patch.slug);
      if (normalizedSlug !== existing.slug && isReservedTenantSlug(normalizedSlug)) {
        throw new BadRequestException('Slug not available');
      }
      patch.slug = normalizedSlug;
    }
    if ('is_system_tenant' in patch && patch.is_system_tenant !== existing.is_system_tenant) {
      throw new BadRequestException('System tenant flag is immutable');
    }
    if (existing.is_system_tenant) {
      const blockedFields = new Set([
        'slug',
        'status',
        'deleted_at',
        'deletion_requested_at',
        'deletion_requested_by',
        'deletion_confirmed_at',
        'deletion_reason',
        'deletion_token',
        'frozen_at',
        'frozen_by',
      ]);
      const attempted = Object.keys(patch).filter((key) => blockedFields.has(key));
      if (attempted.length > 0) {
        throw new BadRequestException('System tenants cannot be modified');
      }
    }
    // Only the patch's columns are written: saving the whole entity would write
    // back every jsonb column (metadata, branding, entra_metadata) as it was
    // loaded, erasing keys another request saved in between. A key that is not
    // a tenant column is refused with a 400 (TypeORM's update would throw a 500,
    // and dropping it silently would hide a typo).
    const columns: Partial<Tenant> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'id' || value === undefined) continue;
      if (!repo.metadata.findColumnWithPropertyName(key)) {
        throw new BadRequestException(`Unknown tenant field: ${key}`);
      }
      (columns as any)[key] = value;
    }
    if (Object.keys(columns).length > 0) {
      await repo.update({ id }, columns);
    }
    const fresh = await repo.findOne({ where: { id } });
    if (!fresh) throw new Error('Tenant not found');
    return fresh;
  }

  /**
   * Merge keys into `branding` in one statement, from the stored value:
   * `set` keys are written, `unset` keys removed, and `bumpLogoVersion`
   * increments the stored `logo_version`, read like `Number()` in the
   * controller: any finite number >= 0 (decimals floored) or a digit string;
   * a missing, negative, non-numeric or out-of-range (>= 1e15) one counts as 0.
   * Returns the stored branding.
   */
  async mergeBranding(
    id: string,
    change: { set?: Partial<TenantBranding>; unset?: Array<keyof TenantBranding>; bumpLogoVersion?: boolean },
    opts?: { manager?: EntityManager },
  ): Promise<TenantBranding> {
    const repo = this.getRepo(opts?.manager);
    // The expressions read `branding` from the row being updated, so a write
    // that waited on a concurrent one merges onto its result. The numeric cast
    // sits in a nested CASE so it only runs on a JSON number.
    const rows: Array<{ branding: TenantBranding }> = await repo.query(
      `WITH updated AS (
         UPDATE tenants
         SET branding = (CASE WHEN jsonb_typeof(branding) = 'object' THEN branding ELSE '{}'::jsonb END - $2::text[])
           || $3::jsonb
           || CASE WHEN $4::boolean THEN jsonb_build_object(
                'logo_version',
                CASE
                  WHEN jsonb_typeof(branding->'logo_version') = 'number' THEN
                    CASE WHEN (branding->>'logo_version')::numeric >= 0 AND (branding->>'logo_version')::numeric < 1e15
                      THEN floor((branding->>'logo_version')::numeric)::bigint ELSE 0 END
                  WHEN branding->>'logo_version' ~ '^[0-9]{1,15}$' THEN (branding->>'logo_version')::bigint
                  ELSE 0
                END + 1
              ) ELSE '{}'::jsonb END
         WHERE id = $1
         RETURNING branding
       )
       SELECT branding FROM updated`,
      [id, change.unset ?? [], JSON.stringify(change.set ?? {}), !!change.bumpLogoVersion],
    );
    if (!rows[0]) throw new NotFoundException('Tenant not found');
    return rows[0].branding;
  }

  /**
   * Write one top-level key of `entra_metadata`, leaving the other keys as stored.
   * With `whenEntraTenantId`, the key is written only while SSO is still Entra on
   * that directory: a sync that started before a disconnect or a reconnect to
   * another directory writes nothing.
   */
  async setEntraMetadataKey(
    id: string,
    key: string,
    value: unknown,
    opts?: { manager?: EntityManager; whenEntraTenantId?: string | null },
  ) {
    const guard = !!opts && 'whenEntraTenantId' in opts;
    await this.getRepo(opts?.manager).query(
      `UPDATE tenants
       SET entra_metadata = jsonb_set(
         CASE WHEN jsonb_typeof(entra_metadata) = 'object' THEN entra_metadata ELSE '{}'::jsonb END,
         ARRAY[$2::text], $3::jsonb, true)
       WHERE id = $1
         AND (NOT $4::boolean OR (sso_provider = 'entra' AND entra_tenant_id = $5::text))`,
      [id, key, JSON.stringify(value ?? null), guard, opts?.whenEntraTenantId ?? null],
    );
  }

  async createTenant(params: { slug: string; name: string }, opts?: { manager?: EntityManager }) {
    if (opts?.manager) {
      return this.createWithManager(params, opts.manager);
    }
    return this.repo.manager.transaction((manager) => this.createWithManager(params, manager));
  }

  private async createWithManager(params: { slug: string; name: string }, manager: EntityManager) {
    const repo = manager.getRepository(Tenant);
    const slug = normalizeTenantSlug(params.slug);
    if (isReservedTenantSlug(slug)) {
      throw new BadRequestException('Slug not available');
    }
    // Ignore tenants that were previously deleted when checking for existing
    const existing = await repo.findOne({ where: { slug, deleted_at: IsNull() } });
    if (existing) {
      await this.ensureSystemRoles(manager, existing.id);
      await ensureDefaultAnalyticsAxis(manager, existing.id);
      await this.seedDefaultTaskTypes(manager, existing.id);
      await this.seedDefaultEmploymentTypes(manager, existing.id);
      await this.seedDefaultDocumentLibraries(manager, existing.id);
      return existing;
    }
    const tenant = repo.create({ slug, name: params.name, status: TenantStatus.ACTIVE, metadata: { it_ops: catalogToMetadata(DEFAULT_CLASSIFICATION_CATALOG) } });
    const saved = await repo.save(tenant);
    await this.ensureSystemRoles(manager, saved.id);
    await ensureDefaultAnalyticsAxis(manager, saved.id);
    await this.seedDefaultTaskTypes(manager, saved.id);
    await this.seedDefaultEmploymentTypes(manager, saved.id);
    await this.seedDefaultDocumentLibraries(manager, saved.id);
    return saved;
  }

  private async seedDefaultTaskTypes(manager: EntityManager, tenantId: string) {
    for (const def of DEFAULT_TASK_TYPES) {
      await manager.query(
        `INSERT INTO portfolio_task_types (tenant_id, name, description, display_order, is_system)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tenantId, def.name, def.description ?? null, def.display_order, def.is_system ?? false],
      );
    }
  }

  // Unlike teams, employment types are seeded here as well as by migration: the
  // list is three universal values, and an empty select reads as a broken field.
  private async seedDefaultEmploymentTypes(manager: EntityManager, tenantId: string) {
    for (const def of DEFAULT_EMPLOYMENT_TYPES) {
      await manager.query(
        `INSERT INTO portfolio_employment_types (tenant_id, name, display_order, is_system)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [tenantId, def.name, def.display_order, def.is_system ?? false],
      );
    }
  }

  private async seedDefaultDocumentLibraries(manager: EntityManager, tenantId: string) {
    await seedManagedDocsKnowledgeAssets(manager, tenantId);
  }

  private async ensureSystemRoles(manager: EntityManager, tenantId: string) {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const rolesRepo = manager.getRepository(Role);

    const ensureSystemRole = async (roleName: string, description: string) => {
      const role = await this.roles.createRole(
        { role_name: roleName, role_description: description, is_system: true },
        { manager },
      );
      if (!role.is_system || role.role_description !== description) {
        role.is_system = true;
        role.role_description = description;
        await rolesRepo.save(role);
      }
    };

    await ensureSystemRole('Administrator', 'Full system administrator with access to all features');
    await ensureSystemRole('Contact', 'Directory contact without app access by default');

    // Create built-in roles with their permissions
    for (const builtIn of BUILT_IN_ROLES) {
      const existing = await rolesRepo.findOne({ where: { role_name: builtIn.name } });
      let role: Role;
      if (existing) {
        if (existing.is_built_in) {
          existing.role_description = builtIn.description;
          await rolesRepo.save(existing);
          role = existing;
        } else {
          // Never promote a tenant-created role to built-in based on a name collision.
          continue;
        }
      } else {
        // Create new built-in role
        role = await this.roles.createRole(
          { role_name: builtIn.name, role_description: builtIn.description, is_built_in: true },
          { manager },
        );
      }
      // Set permissions for the role
      await this.permissions.setRolePermissionsMap(role.id, builtIn.permissions, { manager });
    }
  }
}
