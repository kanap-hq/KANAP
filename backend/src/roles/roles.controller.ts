import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, UseGuards, Req } from '@nestjs/common';
import { RolesService } from './roles.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Role } from './role.entity';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { PermissionsService, RESOURCES } from '../permissions/permissions.service';
import { RolePermission } from '../permissions/role-permission.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '../users/user-role.entity';
import { AuditService } from '../audit/audit.service';

/** What the audit log keeps of a role: its name and description, and its permissions when given. */
function roleSnapshot(role: Pick<Role, 'role_name' | 'role_description'>, permissions?: Record<string, unknown>) {
  return {
    role_name: role.role_name,
    role_description: role.role_description ?? null,
    ...(permissions ? { permissions } : {}),
  };
}

/** JSON with object keys in order, so two snapshots compare whatever order their keys came in. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly perms: PermissionsService,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermRepo: Repository<RolePermission>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly audit: AuditService,
  ) {}

  /**
   * A change to a role (creation, rename, permissions, deletion): before, after and who, in the
   * request's transaction. An update that changes nothing is not logged.
   */
  private async logRoleChange(
    req: any,
    roleId: string,
    action: 'create' | 'update' | 'delete',
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) {
    if (action === 'update' && stableJson(before) === stableJson(after)) return;
    const mg: EntityManager | undefined = req?.queryRunner?.manager;
    await this.audit.log(
      { table: 'roles', recordId: roleId, action, before, after, userId: req?.user?.sub ?? null },
      mg ? { manager: mg } : undefined,
    );
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async getRoles(@Req() req: any) {
    const mg: EntityManager | undefined = req?.queryRunner?.manager;
    const items = await this.rolesService.list({ manager: mg });
    const userRolesRepo = (mg ?? this.userRoleRepo.manager).getRepository(UserRole);
    // Attach user counts
    const withCounts = await Promise.all(items.map(async (r) => {
      const count = await userRolesRepo.count({ where: { role_id: r.id } });
      return { ...r, user_count: count } as any;
    }));
    return { items: withCounts };
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async createRole(@Body() body: { role_name?: string; role_description?: string }, @Req() req: any) {
    const mg: EntityManager | undefined = req?.queryRunner?.manager;
    if (!body?.role_name) throw new BadRequestException('role_name is required');
    // An existing name returns that role (its description updated): a change, not a creation.
    const existing = await this.rolesService.findByName(body.role_name, { manager: mg });
    const saved = await this.rolesService.createRole({ role_name: body.role_name, role_description: body.role_description || null }, { manager: mg });
    await this.logRoleChange(req, saved.id, existing ? 'update' : 'create', existing ? roleSnapshot(existing) : null, roleSnapshot(saved));
    return saved;
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async updateRole(@Param('id') id: string, @Body() body: { role_name?: string; role_description?: string | null }, @Req() req: any) {
    const mg: EntityManager | undefined = req?.queryRunner?.manager;
    const role = await (mg ?? this.roleRepo.manager).getRepository(Role).findOne({ where: { id } });
    if (!role) throw new BadRequestException('Role not found');
    if (role.is_system) throw new BadRequestException('Cannot modify a system role');
    if (role.is_built_in) throw new BadRequestException('Cannot modify a built-in role');
    const before = roleSnapshot(role);
    let saved: Role | null;
    try {
      saved = await this.rolesService.updateRole(id, { role_name: body.role_name, role_description: body.role_description }, { manager: mg });
      if (!saved) throw new BadRequestException('Role not found');
    } catch (e: any) {
      if (String(e?.message || '').includes('unique')) throw new BadRequestException('Role name must be unique');
      throw new BadRequestException(e?.message || 'Failed to update role');
    }
    await this.logRoleChange(req, id, 'update', before, roleSnapshot(saved));
    return saved;
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async deleteRole(@Param('id') id: string, @Req() req: any) {
    const mg: EntityManager | undefined = req?.queryRunner?.manager;
    const role = await (mg ?? this.roleRepo.manager).getRepository(Role).findOne({ where: { id } });
    if (!role) throw new BadRequestException('Role not found');
    if (role.is_system) throw new BadRequestException('Cannot delete system role');
    if (role.is_built_in) throw new BadRequestException('Cannot delete built-in role');
    const count = await (mg ?? this.userRoleRepo.manager).getRepository(UserRole).count({ where: { role_id: id } });
    if (count > 0) throw new BadRequestException('Cannot delete role with users assigned');
    const before = roleSnapshot(role, await this.perms.getRolePermissionsMap(id, { manager: mg }));
    await (mg ?? this.roleRepo.manager).getRepository(Role).delete({ id });
    await this.logRoleChange(req, id, 'delete', before, null);
    return { ok: true };
  }

  @Post(':id/duplicate')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async duplicateRole(@Param('id') id: string, @Body() body: { role_name?: string }, @Req() req: any) {
    const mg: EntityManager | undefined = req?.queryRunner?.manager;
    const role = await (mg ?? this.roleRepo.manager).getRepository(Role).findOne({ where: { id } });
    if (!role) throw new BadRequestException('Role not found');
    if (role.is_system) throw new BadRequestException('Cannot duplicate system role');

    // Generate unique name
    let newName = body?.role_name?.trim() || `${role.role_name} (Copy)`;
    const existing = await this.rolesService.findByName(newName, { manager: mg });
    if (existing) {
      // Add suffix to make unique
      let suffix = 2;
      while (await this.rolesService.findByName(`${newName} ${suffix}`, { manager: mg })) {
        suffix++;
      }
      newName = `${newName} ${suffix}`;
    }

    // Create new role (not built-in, not system)
    const saved = await this.rolesService.createRole(
      { role_name: newName, role_description: role.role_description, is_system: false },
      { manager: mg }
    );

    // Copy permissions
    const perms = await this.perms.getRolePermissionsMap(id, { manager: mg });
    if (Object.keys(perms).length > 0) {
      await this.perms.setRolePermissionsMap(saved.id, perms as any, { manager: mg });
    }
    await this.logRoleChange(req, saved.id, 'create', null, {
      ...roleSnapshot(saved, await this.perms.getRolePermissionsMap(saved.id, { manager: mg })),
      duplicated_from: { id: role.id, role_name: role.role_name },
    });

    return saved;
  }

  @Get(':id/permissions')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async getRolePermissions(@Param('id') id: string, @Req() req: any) {
    const mg: EntityManager | undefined = req?.queryRunner?.manager;
    const role = await (mg ?? this.roleRepo.manager).getRepository(Role).findOne({ where: { id } });
    if (!role) throw new BadRequestException('Role not found');
    const map = await this.perms.getRolePermissionsMap(id, { manager: mg });
    // Ensure all resources present (default none)
    const out: Record<string, 'reader'|'contributor'|'member'|'admin'|null> = {} as any;
    for (const r of RESOURCES) out[r] = (map as any)[r] ?? null;
    return out;
  }

  @Put(':id/permissions')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async setRolePermissions(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const mg: EntityManager | undefined = req?.queryRunner?.manager;
    const role = await (mg ?? this.roleRepo.manager).getRepository(Role).findOne({ where: { id } });
    if (!role) throw new BadRequestException('Role not found');
    const key = (role.role_name ?? '').toLowerCase();
    if (role.is_system || key === 'administrator' || key === 'contact') {
      throw new BadRequestException('System role permissions cannot be modified');
    }
    if (role.is_built_in) {
      throw new BadRequestException('Built-in role permissions cannot be modified');
    }
    if (!body || typeof body !== 'object' || !body.permissions) throw new BadRequestException('permissions required');
    const perms = body.permissions as Record<string, 'reader'|'contributor'|'member'|'admin'|null>;
    const before = await this.perms.getRolePermissionsMap(id, { manager: mg });
    const after = await this.perms.setRolePermissionsMap(id, perms as any, { manager: mg });
    await this.logRoleChange(req, id, 'update', roleSnapshot(role, before), roleSnapshot(role, after));
    return after;
  }
}
