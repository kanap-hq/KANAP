import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, EntityManager } from 'typeorm';
import { UserPageRole } from './user-page-role.entity';
import { RolePermission } from './role-permission.entity';
import { Role } from '../roles/role.entity';

export type PermissionLevel = 'reader' | 'contributor' | 'member' | 'admin';

// Permission level ranking for union logic (higher = more permissive)
const LEVEL_RANK: Record<PermissionLevel, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

function normalizePermissionLevel(resource: string, level: PermissionLevel): PermissionLevel {
  // Knowledge does not use a contributor tier. Preserve legacy data by folding it down to reader.
  if (normalizeResource(resource) === 'knowledge' && level === 'contributor') {
    return 'reader';
  }
  return level;
}

export const RESOURCES = [
  'opex',
  'capex',
  'projects',
  'contracts',
  'applications',
  'infrastructure',
  'tasks',
  'suppliers',
  'contacts',
  'companies',
  'departments',
  'cost_centers',
  'accounts',
  'analytics',
  'business_processes',
  'knowledge',
  'users',
  'reporting',
  'settings',
  'budget_ops',
  'billing',
  'locations',
  'incidents',
  'portfolio_requests',
  'portfolio_projects',
  'portfolio_planning',
  'portfolio_reports',
  'portfolio_settings',
  'ai_chat',
  'ai_mcp',
  'ai_agents',
  'ai_settings',
] as const;

export type Resource = typeof RESOURCES[number];

const RESOURCE_ALIASES: Record<string, string[]> = {
  reporting: ['reports'],
  budget_ops: ['budget-ops', 'budget_operations', 'budget-admin', 'budget_admin'],
};

function normalizeResource(resource: string): string {
  const entry = Object.entries(RESOURCE_ALIASES).find(([canonical, aliases]) =>
    canonical === resource || aliases.includes(resource)
  );
  return entry ? entry[0] : resource;
}

function aliasGroup(resource: string): string[] {
  const canonical = normalizeResource(resource);
  const aliases = RESOURCE_ALIASES[canonical] ?? [];
  return [canonical, ...aliases];
}

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(UserPageRole)
    private readonly userPageRoleRepo: Repository<UserPageRole>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  // Role-derived permissions (RBAC)

  async listForRole(roleId: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.rolePermissionRepo.manager).getRepository(RolePermission);
    const items = await repo.find({ where: { role_id: roleId } });
    const map = new Map<string, PermissionLevel>();
    for (const i of items) {
      const key = normalizeResource(i.resource);
      const level = normalizePermissionLevel(key, i.level);
      // Prefer explicitly mapped resource; do not overwrite higher privilege with lower
      const existing = map.get(key);
      if (!existing || (LEVEL_RANK[level] ?? 0) > (LEVEL_RANK[existing] ?? 0)) {
        map.set(key, level);
      }
    }
    // Derived: if role has suppliers:member or suppliers:admin, grant contacts:reader unless explicitly set
    const suppliersLevel = map.get('suppliers');
    const contactsLevel = map.get('contacts');
    if (!contactsLevel && suppliersLevel && (LEVEL_RANK[suppliersLevel] ?? 0) >= LEVEL_RANK.contributor) {
      map.set('contacts', 'reader');
    }
    return map;
  }

  async getRolePermissionsMap(roleId: string, opts?: { manager?: EntityManager }) {
    const map = await this.listForRole(roleId, opts);
    const out: Record<string, PermissionLevel> = {} as any;
    for (const [k, v] of map.entries()) out[k] = v;
    return out;
  }

  async setRolePermissionsMap(roleId: string, permissions: Record<string, PermissionLevel | null>, opts?: { manager?: EntityManager }) {
    // Upsert/delete
    const mgr = opts?.manager ?? this.rolePermissionRepo.manager;
    const repo = mgr.getRepository(RolePermission);
    const roleRepo = mgr.getRepository(Role);

    // Fetch the role to get its tenant_id - we must explicitly set it on new permissions
    // to avoid relying on database defaults (which could fail or return wrong value)
    const role = await roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      throw new Error(`Role not found: ${roleId}`);
    }
    const tenantId = role.tenant_id;

    const current = await this.listForRole(roleId, opts);
    const toSave: { resource: string; level: PermissionLevel }[] = [];
    const toDelete: string[] = [];
    for (const [resource, level] of Object.entries(permissions)) {
      const normalized = normalizeResource(resource);
      if (level == null) {
        if (current.has(normalized)) toDelete.push(normalized);
      } else {
        toSave.push({ resource: normalized, level: normalizePermissionLevel(normalized, level) });
      }
    }

    // Auto-grant tasks:reader if any operations resource has access
    const OPERATIONS_RESOURCES = ['opex', 'capex', 'projects', 'contracts'];
    const hasAnyOpsAccess = OPERATIONS_RESOURCES.some(res => {
      const level = permissions[res];
      return level === 'reader' || level === 'member' || level === 'admin';
    });

    // If user has any operations access and tasks is not explicitly set, auto-grant tasks:reader
    if (hasAnyOpsAccess && permissions['tasks'] === undefined && !toDelete.includes('tasks')) {
      toSave.push({ resource: 'tasks', level: 'reader' });
    }
    for (const r of toSave) {
      const where = aliasGroup(r.resource).map((alias) => ({ role_id: roleId, resource: alias }));
      const existing = await repo.findOne({ where });
      if (existing) {
        existing.resource = r.resource;
        existing.level = r.level;
        // Ensure tenant_id matches the role (fix any historical mismatches)
        existing.tenant_id = tenantId;
        await repo.save(existing);
      } else {
        // Explicitly set tenant_id from the role - don't rely on database defaults
        await repo.save(repo.create({
          role_id: roleId,
          resource: r.resource,
          level: r.level,
          tenant_id: tenantId,
        }));
      }
    }
    if (toDelete.length > 0) {
      const resources = new Set<string>();
      for (const res of toDelete) {
        for (const alias of aliasGroup(res)) resources.add(alias);
      }
      await repo.delete({ role_id: roleId, resource: In([...resources]) as any });
    }
    return this.getRolePermissionsMap(roleId, opts);
  }

  /**
   * Compute effective permissions across multiple roles using union logic.
   * For each resource, the highest permission level across all roles is applied.
   */
  async listForRoles(roleIds: string[], opts?: { manager?: EntityManager }): Promise<Map<string, PermissionLevel>> {
    if (roleIds.length === 0) return new Map();
    if (roleIds.length === 1) return this.listForRole(roleIds[0], opts);

    const merged = new Map<string, PermissionLevel>();

    for (const roleId of roleIds) {
      const rolePerms = await this.listForRole(roleId, opts);
      for (const [resource, level] of rolePerms.entries()) {
        const existing = merged.get(resource);
        // Union logic: keep the higher permission level
        if (!existing || LEVEL_RANK[level] > LEVEL_RANK[existing]) {
          merged.set(resource, level);
        }
      }
    }

    return merged;
  }

  /**
   * Get effective permissions map for multiple roles as a plain object.
   */
  async getEffectivePermissionsMap(roleIds: string[], opts?: { manager?: EntityManager }): Promise<Record<string, PermissionLevel>> {
    const map = await this.listForRoles(roleIds, opts);
    const out: Record<string, PermissionLevel> = {};
    for (const [k, v] of map.entries()) out[k] = v;
    return out;
  }
}
