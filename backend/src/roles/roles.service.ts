import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Role } from './role.entity';
import { RolePermission } from '../permissions/role-permission.entity';
import { RESOURCES } from '../permissions/permissions.service';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly repo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermRepo: Repository<RolePermission>,
  ) {}

  async list(opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(Role);
    return repo.find({ order: { role_name: 'ASC' } });
  }

  /**
   * The number of people each role is given to, as the Roles screen counts them (`GET /roles`):
   * the rows of `user_roles`, which hold the primary role too. One grouped count on the caller's
   * connection: pg refuses a query sent while another one runs (deprecated since pg 8, an error in
   * pg 9).
   */
  async userCounts(roleIds: string[], opts?: { manager?: EntityManager }): Promise<Map<string, number>> {
    if (roleIds.length === 0) return new Map();
    const rows: Array<{ role_id: string; user_count: number | string }> = await (opts?.manager ?? this.repo.manager).query(
      `SELECT role_id, COUNT(*)::int AS user_count
         FROM user_roles
        WHERE tenant_id = app_current_tenant() AND role_id = ANY($1::uuid[])
        GROUP BY role_id`,
      [roleIds],
    );
    return new Map(rows.map((row) => [row.role_id, Number(row.user_count)]));
  }

  async findByName(role_name: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(Role);
    return repo.findOne({ where: { role_name } });
  }

  async findById(id: string, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(Role);
    return repo.findOne({ where: { id } });
  }

  private async ensureAdministratorPermissions(roleId: string, opts?: { manager?: EntityManager }) {
    const permRepo = (opts?.manager ?? this.rolePermRepo.manager).getRepository(RolePermission);
    for (const r of RESOURCES) {
      const existingPerm = await permRepo.findOne({ where: { role_id: roleId, resource: r } });
      if (existingPerm) {
        if (existingPerm.level !== 'admin') {
          existingPerm.level = 'admin' as any;
          await permRepo.save(existingPerm);
        }
      } else {
        await permRepo.save(permRepo.create({ role_id: roleId, resource: r, level: 'admin' as any }));
      }
    }
  }

  async createRole(
    params: { role_name: string; role_description: string | null; is_system?: boolean; is_built_in?: boolean },
    opts?: { manager?: EntityManager },
  ) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(Role);
    const normalizedName = params.role_name.trim().toLowerCase();
    const shouldBeSystem = params.is_system ?? (normalizedName === 'administrator' || normalizedName === 'contact');
    const shouldBeBuiltIn = params.is_built_in ?? false;
    const existing = await this.findByName(params.role_name, opts);
    if (existing) {
      let shouldPersist = false;
      if (params.role_description !== undefined && existing.role_description !== params.role_description) {
        existing.role_description = params.role_description;
        shouldPersist = true;
      }
      if (shouldBeSystem && !existing.is_system) {
        existing.is_system = true;
        shouldPersist = true;
      }
      if (shouldBeBuiltIn && !existing.is_built_in) {
        existing.is_built_in = true;
        shouldPersist = true;
      }
      if (shouldPersist) {
        await repo.save(existing);
      }
      if (normalizedName === 'administrator') {
        await this.ensureAdministratorPermissions(existing.id, opts);
      }
      return existing;
    }

    const role = repo.create({
      role_name: params.role_name,
      role_description: params.role_description,
      is_system: shouldBeSystem,
      is_built_in: shouldBeBuiltIn,
    });
    const saved = await repo.save(role);
    if (normalizedName === 'administrator') {
      await this.ensureAdministratorPermissions(saved.id, opts);
    }
    return saved;
  }

  async updateRole(id: string, params: { role_name?: string; role_description?: string | null }, opts?: { manager?: EntityManager }) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(Role);
    const role = await repo.findOne({ where: { id } });
    if (!role) return null;
    if (params.role_name && params.role_name !== role.role_name) {
      const exists = await this.findByName(params.role_name, opts);
      if (exists && exists.id !== id) throw new Error('Role name must be unique');
      role.role_name = params.role_name;
    }
    if (params.role_description !== undefined) role.role_description = params.role_description;
    const saved = await repo.save(role);
    return saved;
  }
}
