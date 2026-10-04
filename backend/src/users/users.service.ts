import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, Repository } from 'typeorm';
import { User } from './user.entity';
import { Role } from '../roles/role.entity';
import { RolesService } from '../roles/roles.service';
import { UserRole } from './user-role.entity';
import * as argon2 from 'argon2';
import { parsePagination } from '../common/pagination';
import {
  buildQuickSearchConditions,
  compileAgFilterCondition,
  createParamNameGenerator,
  FilterTargetConfig,
} from '../common/ag-grid-filtering';
import { compileUserListFilters } from './users-list-filters';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
// import { PermissionsService, PermissionLevel } from '../permissions/permissions.service';
import { Company } from '../companies/company.entity';
import { Department } from '../departments/department.entity';
import * as fs from 'fs';
import { EmailService } from '../email/email.service';
import { createPasswordResetToken as buildPasswordResetToken, getPasswordResetExpirationMinutes } from '../auth/password-reset.util';
import { PasswordResetToken } from '../auth/password-reset-token.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { RolePermission } from '../permissions/role-permission.entity';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { CommitThenRunFn } from '../common/import-connection';
import {
  cellOf,
  CsvDateOrder,
  CsvLanguage,
  DecimalMark,
  readMasterDataFile,
  rowProblems,
  writeCsv,
} from '../common/csv-sheet';

const SUPPORTED_USER_LOCALES = ['en', 'fr', 'de', 'es'] as const;
const SELF_SERVICE_FIELDS = ['first_name', 'last_name', 'job_title', 'business_phone', 'mobile_phone', 'locale'] as const;
const ADMIN_FIELDS = [...SELF_SERVICE_FIELDS, 'email', 'status', 'company_id', 'department_id', 'role_id'] as const;

type UpdateUserField = (typeof ADMIN_FIELDS)[number];
type UpdateUserActor =
  | {
      actorUserId?: string | null;
      canManageUsers?: boolean;
    }
  | string
  | null
  | undefined;

type AiUserQueryOpts = {
  manager?: EntityManager;
  tenantId?: string;
};

const buildAiUserDisplayNameSql = (alias: string): string =>
  `COALESCE(NULLIF(TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), ''), ${alias}.email)`;

const buildAiUserExpertiseSql = (configAlias: string): string =>
  `COALESCE((
    SELECT string_agg(DISTINCT area.value, ', ' ORDER BY area.value)
    FROM jsonb_array_elements_text(COALESCE(${configAlias}.areas_of_expertise, '[]'::jsonb)) area(value)
  ), '')`;

const AI_USER_CONTRIBUTOR_PROFILE_SQL = `CASE WHEN tmc.id IS NULL THEN 'not_configured' ELSE 'configured' END`;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    private readonly rolesService: RolesService,
    private readonly billingService: BillingService,
    // private readonly permsService: PermissionsService,
    private readonly emailService: EmailService,
    private readonly audit?: AuditService,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokens?: Repository<PasswordResetToken>,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(User) : this.repo;
  }

  private buildAiUserBaseQuery(query: any, opts?: AiUserQueryOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(User);
    const tenantId = String(opts?.tenantId || '').trim();
    const { page, limit, skip, sort, status, q, filters } = parsePagination(query, {
      field: 'last_name',
      direction: 'ASC',
    });
    const fm = filters && typeof filters === 'object' ? filters : undefined;
    const nextParam = createParamNameGenerator('u');

    type Target = FilterTargetConfig;
    const displayNameSql = buildAiUserDisplayNameSql('u');
    const expertiseSql = buildAiUserExpertiseSql('tmc');
    const targets: Record<string, Target> = {
      email: { expression: 'u.email', dataType: 'string' },
      first_name: { expression: 'u.first_name', dataType: 'string' },
      last_name: { expression: 'u.last_name', dataType: 'string' },
      status: { expression: 'u.status', dataType: 'string' },
      job_title: { expression: 'u.job_title', dataType: 'string' },
      locale: { expression: 'u.locale', dataType: 'string' },
      company_name: {
        expression: 'u.company_id',
        textExpression: `COALESCE(c.name, '')`,
        dataType: 'string',
      },
      department_name: {
        expression: 'u.department_id',
        textExpression: `COALESCE(d.name, '')`,
        dataType: 'string',
      },
      primary_role_name: {
        expression: 'u.role_id',
        textExpression: `COALESCE(r.role_name, '')`,
        dataType: 'string',
      },
      team_name: {
        expression: 'tmc.team_id',
        textExpression: `COALESCE(pt.name, '')`,
        dataType: 'string',
      },
      contributor_profile: {
        expression: AI_USER_CONTRIBUTOR_PROFILE_SQL,
        textExpression: AI_USER_CONTRIBUTOR_PROFILE_SQL,
        dataType: 'string',
      },
      project_availability: {
        expression: 'tmc.project_availability',
        numericExpression: 'tmc.project_availability',
        dataType: 'number',
      },
      areas_of_expertise: {
        expression: 'u.id',
        textExpression: expertiseSql,
        dataType: 'string',
      },
    };

    const qb = repo.createQueryBuilder('u')
      .leftJoin('roles', 'r', 'r.id = u.role_id AND r.tenant_id = u.tenant_id')
      .leftJoin('companies', 'c', 'c.id = u.company_id AND c.tenant_id = u.tenant_id')
      .leftJoin('departments', 'd', 'd.id = u.department_id AND d.tenant_id = u.tenant_id')
      .leftJoin('portfolio_team_member_configs', 'tmc', 'tmc.user_id = u.id AND tmc.tenant_id = u.tenant_id')
      .leftJoin('portfolio_teams', 'pt', 'pt.id = tmc.team_id AND pt.tenant_id = u.tenant_id');

    if (tenantId) {
      qb.andWhere('u.tenant_id = :tenantId', { tenantId });
    }

    if (status) {
      qb.andWhere('u.status = :status', { status });
    }

    if (fm) {
      for (const [field, model] of Object.entries(fm)) {
        const target = targets[field];
        if (!target) continue;
        const condition = compileAgFilterCondition(model, target, nextParam);
        if (!condition) continue;
        qb.andWhere(new Brackets((sub) => sub.where(condition.sql, condition.params)));
      }
    }

    const quickSearchExpressions = [
      displayNameSql,
      'u.email',
      `COALESCE(u.job_title, '')`,
      `COALESCE(r.role_name, '')`,
      `COALESCE(c.name, '')`,
      `COALESCE(d.name, '')`,
      `COALESCE(pt.name, '')`,
      expertiseSql,
    ];
    const quickSearch = q ? buildQuickSearchConditions(q, quickSearchExpressions, nextParam) : [];
    if (quickSearch.length > 0) {
      qb.andWhere(new Brackets((sub) => {
        quickSearch.forEach((condition, index) => {
          if (index === 0) sub.where(condition.sql, condition.params);
          else sub.orWhere(condition.sql, condition.params);
        });
      }));
    }

    return { qb, page, limit, skip, sort };
  }

  async listForAi(query: any, opts?: AiUserQueryOpts) {
    const { qb, page, limit, skip, sort } = this.buildAiUserBaseQuery(query, opts);
    const total = await qb.clone().getCount();

    const displayNameSql = buildAiUserDisplayNameSql('u');
    const expertiseSql = buildAiUserExpertiseSql('tmc');
    const sortFieldMap: Record<string, string> = {
      display_name: displayNameSql,
      email: 'u.email',
      first_name: 'u.first_name',
      last_name: 'u.last_name',
      status: 'u.status',
      job_title: 'u.job_title',
      company_name: 'c.name',
      department_name: 'd.name',
      primary_role_name: 'r.role_name',
      locale: 'u.locale',
      team_name: 'pt.name',
      contributor_profile: AI_USER_CONTRIBUTOR_PROFILE_SQL,
      project_availability: 'tmc.project_availability',
      created_at: 'u.created_at',
      updated_at: 'u.updated_at',
    };
    const sortField = sortFieldMap[sort.field] ?? 'u.last_name';

    const items = await qb
      .clone()
      .select('u.id', 'id')
      .addSelect('u.first_name', 'first_name')
      .addSelect('u.last_name', 'last_name')
      .addSelect('u.email', 'email')
      .addSelect('u.job_title', 'job_title')
      .addSelect('u.locale', 'locale')
      .addSelect('u.status', 'status')
      .addSelect('u.created_at', 'created_at')
      .addSelect('u.updated_at', 'updated_at')
      .addSelect('c.name', 'company_name')
      .addSelect('d.name', 'department_name')
      .addSelect('r.role_name', 'primary_role_name')
      .addSelect('pt.name', 'team_name')
      .addSelect('tmc.project_availability', 'project_availability')
      .addSelect(AI_USER_CONTRIBUTOR_PROFILE_SQL, 'contributor_profile')
      .addSelect(expertiseSql, 'areas_of_expertise')
      .addSelect(displayNameSql, 'display_name')
      .orderBy(sortField, sort.direction, 'NULLS LAST')
      .addOrderBy('u.email', 'ASC')
      .offset(skip)
      .limit(limit)
      .getRawMany();

    return { items, total, page, limit };
  }

  async listIdsForAi(query: any, opts?: AiUserQueryOpts): Promise<{ ids: string[]; total: number }> {
    const { qb } = this.buildAiUserBaseQuery(query, opts);
    const rows = await qb
      .clone()
      .select('u.id', 'id')
      .orderBy('u.id', 'ASC')
      .getRawMany();
    const ids = rows.map((row: any) => row.id);
    return { ids, total: ids.length };
  }

  async listFilterValuesForAi(query: any, opts?: AiUserQueryOpts): Promise<Record<string, Array<string | null>>> {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = String(opts?.tenantId || '').trim() || null;
    const rawFields = String(query?.fields || query?.field || '').split(',').map((field) => field.trim()).filter(Boolean);
    const result: Record<string, Array<string | null>> = {};

    for (const field of rawFields) {
      if (field === 'company_name') {
        const rows = await mg.query(
          `SELECT DISTINCT c.name AS value
           FROM users u
           LEFT JOIN companies c ON c.id = u.company_id AND c.tenant_id = u.tenant_id
           WHERE u.tenant_id = COALESCE($1, app_current_tenant())
           ORDER BY value ASC NULLS LAST`,
          [tenantId],
        );
        result[field] = rows.map((row: any) => row.value ?? null);
        continue;
      }
      if (field === 'department_name') {
        const rows = await mg.query(
          `SELECT DISTINCT d.name AS value
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id AND d.tenant_id = u.tenant_id
           WHERE u.tenant_id = COALESCE($1, app_current_tenant())
           ORDER BY value ASC NULLS LAST`,
          [tenantId],
        );
        result[field] = rows.map((row: any) => row.value ?? null);
        continue;
      }
      if (field === 'primary_role_name') {
        const rows = await mg.query(
          `SELECT DISTINCT r.role_name AS value
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
           WHERE u.tenant_id = COALESCE($1, app_current_tenant())
           ORDER BY value ASC NULLS LAST`,
          [tenantId],
        );
        result[field] = rows.map((row: any) => row.value ?? null);
        continue;
      }
      if (field === 'locale') {
        const rows = await mg.query(
          `SELECT DISTINCT u.locale AS value
           FROM users u
           WHERE u.tenant_id = COALESCE($1, app_current_tenant())
           ORDER BY value ASC NULLS LAST`,
          [tenantId],
        );
        result[field] = rows.map((row: any) => row.value ?? null);
        continue;
      }
      if (field === 'team_name') {
        const rows = await mg.query(
          `SELECT DISTINCT pt.name AS value
           FROM users u
           LEFT JOIN portfolio_team_member_configs tmc ON tmc.user_id = u.id AND tmc.tenant_id = u.tenant_id
           LEFT JOIN portfolio_teams pt ON pt.id = tmc.team_id AND pt.tenant_id = u.tenant_id
           WHERE u.tenant_id = COALESCE($1, app_current_tenant())
           ORDER BY value ASC NULLS LAST`,
          [tenantId],
        );
        result[field] = rows.map((row: any) => row.value ?? null);
        continue;
      }
      if (field === 'areas_of_expertise') {
        const rows = await mg.query(
          `SELECT DISTINCT area.value AS value
           FROM users u
           JOIN portfolio_team_member_configs tmc ON tmc.user_id = u.id AND tmc.tenant_id = u.tenant_id
           CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(tmc.areas_of_expertise, '[]'::jsonb)) area(value)
           WHERE u.tenant_id = COALESCE($1, app_current_tenant())
           ORDER BY value ASC NULLS LAST`,
          [tenantId],
        );
        result[field] = rows.map((row: any) => row.value ?? null);
        continue;
      }
      result[field] = [];
    }

    return result;
  }

  async list(query: any, opts?: { manager?: EntityManager; adminView?: boolean }) {
    const repo = this.getRepo(opts?.manager);
    const { page, limit, skip, sort, status, q, filters } = parsePagination(query);
    const allowedSortFields = [
      'email', 'first_name', 'last_name', 'job_title', 'status', 'created_at', 'updated_at', 'last_login_at'
    ];
    // 'invited' is a users-only lifecycle status, so the shared pagination
    // parser does not know it; honour it here.
    const statusScope = String(query?.status ?? '').toLowerCase() === 'invited' ? 'invited' : status;
    const nextParam = createParamNameGenerator('uf');
    const compiledFilters = compileUserListFilters(filters, nextParam);
    const quickSearch = q
      ? buildQuickSearchConditions(q, ['u.email', "COALESCE(u.first_name, '')", "COALESCE(u.last_name, '')"], nextParam)
      : [];

    const applyFilters = (builder: ReturnType<typeof repo.createQueryBuilder>) => {
      if (statusScope) {
        builder.andWhere('u.status = :statusScope', { statusScope });
      }
      for (const condition of compiledFilters) {
        builder.andWhere(condition.sql, condition.params);
      }
      if (quickSearch.length > 0) {
        builder.andWhere(new Brackets((sub) => {
          quickSearch.forEach((condition, index) => {
            if (index === 0) sub.where(condition.sql, condition.params);
            else sub.orWhere(condition.sql, condition.params);
          });
        }));
      }
    };

    const qb = repo.createQueryBuilder('u');
    if (opts?.adminView) {
      qb.leftJoinAndSelect('u.role', 'role')
        .leftJoinAndSelect('u.company', 'company')
        .leftJoinAndSelect('u.department', 'department');
    } else {
      qb.leftJoin('u.company', 'company')
        .leftJoin('u.department', 'department');
    }
    applyFilters(qb);

    const sortField = allowedSortFields.includes(sort.field) ? sort.field : 'created_at';
    const direction = sort.direction === 'ASC' ? 'ASC' : 'DESC';
    // "Never signed in" rows sort last in both directions instead of Postgres' NULLS-first-on-DESC.
    if (sortField === 'last_login_at') {
      qb.orderBy('u.last_login_at', direction, 'NULLS LAST');
    } else {
      qb.orderBy(`u.${sortField}`, direction);
    }
    qb.skip(skip).take(limit);
    const [items, total] = await qb.getManyAndCount();

    // Admin view: batch-load every role of the page rows plus an access flag
    // (pending_access = enabled but no role grants any permission). Single
    // queries for the whole page — never per-row lookups.
    let rolesByUser: Map<string, Array<{ id: string; name: string | null }>> | undefined;
    let rolesWithPerms: Set<string> | undefined;
    let adminRoleIds: Set<string> | undefined;
    if (opts?.adminView && items.length > 0) {
      const mg = opts?.manager ?? repo.manager;
      const userRoles = await mg.getRepository(UserRole).find({
        where: { user_id: In(items.map((u) => u.id)) },
        relations: ['role'],
        order: { is_primary: 'DESC', created_at: 'ASC' },
      });
      rolesByUser = new Map();
      adminRoleIds = new Set();
      const allRoleIds = new Set<string>();
      for (const u of items) {
        if (u.role_id) allRoleIds.add(u.role_id);
        if (u.role_id && (u.role?.role_name ?? '').toLowerCase() === 'administrator') adminRoleIds.add(u.role_id);
      }
      for (const ur of userRoles) {
        allRoleIds.add(ur.role_id);
        const list = rolesByUser.get(ur.user_id) ?? [];
        list.push({ id: ur.role_id, name: ur.role?.role_name ?? null });
        rolesByUser.set(ur.user_id, list);
        if ((ur.role?.role_name ?? '').toLowerCase() === 'administrator') adminRoleIds.add(ur.role_id);
      }
      const permRows: Array<{ role_id: string }> = allRoleIds.size > 0
        ? await mg.getRepository(RolePermission)
            .createQueryBuilder('rp')
            .select('DISTINCT rp.role_id', 'role_id')
            .where('rp.role_id IN (:...roleIds)', { roleIds: Array.from(allRoleIds) })
            .getRawMany()
        : [];
      rolesWithPerms = new Set(permRows.map((r) => r.role_id));
    }

    const safe = items.map(u => {
      if (opts?.adminView) {
        const roles = rolesByUser?.get(u.id)
          ?? (u.role_id ? [{ id: u.role_id, name: u.role?.role_name ?? null }] : []);
        const accessRoleIds = new Set(roles.map((r) => r.id));
        if (u.role_id) accessRoleIds.add(u.role_id);
        const hasAccess = Array.from(accessRoleIds).some(
          (rid) => adminRoleIds?.has(rid) || rolesWithPerms?.has(rid),
        );
        return { ...u, password_hash: undefined, roles, pending_access: u.status === 'enabled' && !hasAccess };
      }
      return {
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        status: u.status,
      };
    });
    return { items: safe, total, page, limit };
  }

  findByEmail(email: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    return repo.findOne({ where: { email }, relations: ['role'] });
  }

  async findById(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    return repo.findOne({
      where: { id },
      relations: ['role', 'company', 'department']
    });
  }

  /** Stamp last_login_at on session creation (not on refresh). Not audited: pure telemetry. */
  async touchLastLogin(id: string, opts?: { manager?: EntityManager }) {
    await this.getRepo(opts?.manager).update({ id } as any, { last_login_at: new Date() } as any);
  }

  async createUser(params: {
    email: string;
    password?: string | null;
    role_name?: string | null;
    role_id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    job_title?: string | null;
    business_phone?: string | null;
    mobile_phone?: string | null;
    company_id?: string | null;
    department_id?: string | null;
    status?: string | null;
    tenant_id?: string;
  }, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const existing = await repo.findOne({ where: { email: params.email } });
    if (existing) return existing;

    // Find or create role
    let role: Role | null = null;
    if (params.role_id) {
      role = await this.rolesService.findById(params.role_id, { manager: opts?.manager });
    }
    const roleName = params.role_name ?? 'Contact';
    if (!role) {
      role = await this.rolesService.findByName(roleName, { manager: opts?.manager });
    }
    if (!role) {
      role = await this.rolesService.createRole({
        role_name: roleName,
        role_description: `${roleName} role`,
      }, { manager: opts?.manager });
    }

    const passwordToHash = params.password && params.password.trim().length > 0 ? params.password : null;
    const password_hash = passwordToHash
      ? await argon2.hash(passwordToHash, { type: argon2.argon2id })
      : null;
    const status = (params.status && typeof params.status === 'string'
      ? params.status
      : 'enabled') as any;
    const user = repo.create({
      email: params.email,
      password_hash,
      role_id: role.id,
      tenant_id: params.tenant_id as any,
      first_name: params.first_name ?? null,
      last_name: params.last_name ?? null,
      job_title: params.job_title ?? null,
      business_phone: params.business_phone ?? null,
      mobile_phone: params.mobile_phone ?? null,
      company_id: params.company_id ?? null,
      department_id: params.department_id ?? null,
      status,
    });
    const saved = await repo.save(user);
    const manager = opts?.manager ?? repo.manager;
    const userRoleRepo = manager.getRepository(UserRole);
    const tenantId = saved.tenant_id ?? params.tenant_id ?? (await manager.query(`SELECT app_current_tenant()::text AS tenant_id`))?.[0]?.tenant_id;
    await userRoleRepo.save(userRoleRepo.create({
      tenant_id: tenantId,
      user_id: saved.id,
      role_id: role.id,
      is_primary: true,
    }));
    if (this.audit) {
      await this.audit.log(
        {
          table: 'users',
          recordId: saved.id,
          action: 'create',
          before: null,
          after: { ...saved, password_hash: undefined },
          userId: saved.id,
        },
        { manager: opts?.manager ?? repo.manager },
      );
    }
    return { ...saved, password_hash: undefined } as any;
  }

  async updateUser(
    id: string,
    body: Partial<User> & { password?: string },
    actor?: UpdateUserActor,
    opts?: { manager?: EntityManager },
  ) {
    const repo = this.getRepo(opts?.manager);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }

    const isInternalUpdate = actor == null;
    const actorUserId = typeof actor === 'string' ? actor : actor?.actorUserId ?? null;
    const canManageUsers = typeof actor === 'string' ? false : actor?.canManageUsers === true;
    const isSelfService = actorUserId === id;

    if (!isInternalUpdate && !isSelfService && !canManageUsers) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_PROFILE_UPDATE',
        message: 'You can only update your own profile.',
      });
    }

    const allowedFields = (isInternalUpdate || canManageUsers ? ADMIN_FIELDS : SELF_SERVICE_FIELDS) as readonly UpdateUserField[];
    const safeFields: Partial<User> = {};
    for (const field of allowedFields) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
      const value = body[field];
      if (field === 'locale') {
        if (value === null) {
          safeFields.locale = null;
          continue;
        }
        if (typeof value !== 'string') {
          throw new BadRequestException({
            code: 'INVALID_LOCALE',
            message: `Invalid locale. Allowed: ${SUPPORTED_USER_LOCALES.join(', ')}`,
          });
        }
        const normalizedLocale = value.trim().toLowerCase();
        if (!SUPPORTED_USER_LOCALES.includes(normalizedLocale as (typeof SUPPORTED_USER_LOCALES)[number])) {
          throw new BadRequestException({
            code: 'INVALID_LOCALE',
            message: `Invalid locale. Allowed: ${SUPPORTED_USER_LOCALES.join(', ')}`,
          });
        }
        safeFields.locale = normalizedLocale;
        continue;
      }
      (safeFields as Record<string, unknown>)[field] = value;
    }

    const next = { ...existing, ...safeFields } as User;
    if (body.password) {
      if (!isInternalUpdate) {
        throw new BadRequestException({
          code: 'PASSWORD_UPDATE_NOT_ALLOWED',
          message: 'Password updates are not supported on this endpoint.',
        });
      }
      next.password_hash = await argon2.hash(body.password, { type: argon2.argon2id });
    }
    const saved = await repo.save(next);
    if (this.audit) {
      await this.audit.log(
        {
          table: 'users',
          recordId: saved.id,
          action: 'update',
          before: { ...existing, password_hash: undefined },
          after: { ...saved, password_hash: undefined },
          userId: actorUserId,
        },
        { manager: opts?.manager ?? repo.manager },
      );
    }
    return { ...saved, password_hash: undefined } as any;
  }

  // CSV helpers for Users
  private csvHeaders(): string[] {
    return [
      'email',
      'first_name',
      'last_name',
      'role',
      'company_name',
      'department_name',
      'status',
    ];
  }

  async exportCsv(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; language?: CsvLanguage },
  ): Promise<{ filename: string; content: string }> {
    const language = opts?.language ?? 'en';
    const headers = this.csvHeaders();
    const rows: string[][] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      const items = await repo.find({ order: { created_at: 'DESC' as any }, relations: ['role', 'company', 'department'] });
      for (const u of items) {
        rows.push([
          u.email ?? '',
          u.first_name ?? '',
          u.last_name ?? '',
          u.role?.role_name ?? '',
          u.company?.name ?? '',
          u.department?.name ?? '',
          String(u.status ?? 'enabled'),
        ]);
      }
    }
    const filename = scope === 'template' ? 'users_template.csv' : 'users.csv';
    return { filename, content: writeCsv({ language, headers, rows }) };
  }

  async importCsv(
    {
      file,
      dryRun,
      userId,
      language,
      dateOrder,
      decimalMark,
    }: {
      file: Express.Multer.File;
      dryRun: boolean;
      userId?: string | null;
      language?: CsvLanguage;
      dateOrder?: CsvDateOrder;
      decimalMark?: DecimalMark;
    },
    opts?: { manager?: EntityManager },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const readLanguage = language ?? 'en';
    const expectedHeaders = this.csvHeaders();
    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
    if (!buf) throw new BadRequestException('Empty upload');
    const read = await readMasterDataFile({
      file: buf as Buffer,
      fields: expectedHeaders,
      language: readLanguage,
      dateOrder,
      decimalMark,
    });
    const errors: { row: number; message: string }[] = [];
    if (read.headerError) {
      return {
        ok: false, dryRun, total: 0, inserted: 0, updated: 0,
        errors: [{ row: 0, message: read.headerError }],
        ignoredColumns: read.ignoredColumns, notices: read.notices,
      };
    }
    const repo = this.getRepo(opts?.manager);
    const companiesRepo = opts?.manager ? opts.manager.getRepository(Company) : this.companies;
    const departmentsRepo = opts?.manager ? opts.manager.getRepository(Department) : this.departments;

    // Role lookup/create cache
    const roleCache = new Map<string, Role | null>();
    const getRoleByName = async (name: string): Promise<Role | null> => {
      const key = name.toLowerCase();
      if (roleCache.has(key)) return roleCache.get(key) ?? null;
      let r = await this.rolesService.findByName(name, { manager: opts?.manager });
      if (!r && name) {
        r = await this.rolesService.createRole({ role_name: name, role_description: `${name} role` }, { manager: opts?.manager });
      }
      roleCache.set(key, r ?? null);
      return r ?? null;
    };
    // Company lookup cache
    const companyCache = new Map<string, Company | null>();
    const getCompanyByName = async (name: string): Promise<Company | null> => {
      const key = name.toLowerCase();
      if (companyCache.has(key)) return companyCache.get(key) ?? null;
      const c = await companiesRepo.findOne({ where: { name } });
      companyCache.set(key, c ?? null);
      return c ?? null;
    };
    // Department lookup cache (by company_id + name)
    const deptCache = new Map<string, Department | null>();
    const getDepartmentByName = async (companyId: string, name: string): Promise<Department | null> => {
      const key = `${companyId}|${name.toLowerCase()}`;
      if (deptCache.has(key)) return deptCache.get(key) ?? null;
      const d = await departmentsRepo.findOne({ where: { company_id: companyId, name } });
      deptCache.set(key, d ?? null);
      return d ?? null;
    };

    // Validate and normalize rows
    type Normalized = Partial<User> & { email: string; role_id: string; company_id: string | null; department_id: string | null };
    const normalized: Normalized[] = [];
    for (const row of read.rows) {
      const line = row.line;
      const problems = rowProblems(row);
      if (problems.length > 0) {
        errors.push(...problems.map((message) => ({ row: line, message })));
        continue;
      }
      const email = cellOf(row, 'email');
      const first_name = cellOf(row, 'first_name') || null;
      const last_name = cellOf(row, 'last_name') || null;
      let roleName = cellOf(row, 'role');
      const companyName = cellOf(row, 'company_name');
      const departmentName = cellOf(row, 'department_name');
      const statusRaw = cellOf(row, 'status').toLowerCase();

      if (!email) errors.push({ row: line, message: 'email is required' });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ row: line, message: 'email must be valid' });
      if (statusRaw && !['enabled','disabled','contact','invited'].includes(statusRaw)) {
        errors.push({ row: line, message: `Invalid status '${statusRaw}'. Use 'contact', 'invited', 'enabled' or 'disabled'.` });
      }

      let role: Role | null = null;
      if (!roleName) roleName = 'Contact';
      if (roleName) role = await getRoleByName(roleName);
      if (!role) errors.push({ row: line, message: `Unknown role '${roleName}'` });

      let company: Company | null = null;
      if (companyName) {
        company = await getCompanyByName(companyName);
        if (!company) errors.push({ row: line, message: `Unknown company '${companyName}'` });
      }

      let department: Department | null = null;
      if (departmentName) {
        if (!company) {
          errors.push({ row: line, message: 'department_name provided but company_name is missing or invalid' });
        } else {
          department = await getDepartmentByName(company.id, departmentName);
          if (!department) errors.push({ row: line, message: `Unknown department '${departmentName}' for company '${company.name}'` });
        }
      }

      if (role) {
        normalized.push({
          email,
          first_name,
          last_name,
          role_id: role.id,
          company_id: company ? company.id : null,
          department_id: department ? department.id : null,
          status: (['enabled','disabled','contact','invited'].includes(statusRaw) ? (statusRaw as any) : 'contact'),
        });
      }
    }

    if (errors.length > 0) {
      return { ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, errors, ignoredColumns: read.ignoredColumns, notices: read.notices };
    }

    // Deduplicate by email (lowercased)
    const uniqueByEmail = new Map<string, Normalized>();
    for (const item of normalized) {
      const key = (item.email as string).toLowerCase();
      if (!uniqueByEmail.has(key)) uniqueByEmail.set(key, item);
    }
    const unique = Array.from(uniqueByEmail.values());

    // Count inserts/updates
    let inserted = 0;
    let updated = 0;
    for (const item of unique) {
      const existing = await repo.findOne({ where: { email: item.email } });
      if (existing) updated += 1; else inserted += 1;
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total: read.rows.length, inserted, updated, errors: [], ignoredColumns: read.ignoredColumns, notices: read.notices };
    }

    // Commit: upsert by email
    let processed = 0;
    for (const item of unique) {
      const existing = await repo.findOne({ where: { email: item.email } });
      if (existing) {
        const before = { ...existing };
        const next = { ...existing, ...item } as User;
        const saved = await repo.save(next);
        processed += 1;
        if (this.audit) {
          await this.audit.log(
            {
              table: 'users',
              recordId: saved.id,
              action: 'update',
              before: { ...before, password_hash: undefined },
              after: { ...saved, password_hash: undefined },
              userId: userId ?? null,
            },
            { manager: opts?.manager ?? repo.manager },
          );
        }
      } else {
        const created = repo.create({ ...item, password_hash: null, mfa_enabled: false });
        const saved = await repo.save(created);
        processed += 1;
        if (this.audit) {
          await this.audit.log(
            {
              table: 'users',
              recordId: saved.id,
              action: 'create',
              before: null,
              after: { ...saved, password_hash: undefined },
              userId: userId ?? null,
            },
            { manager: opts?.manager ?? repo.manager },
          );
        }
      }
    }
    return { ok: true, dryRun: false, total: read.rows.length, inserted, updated, processed, errors: [], ignoredColumns: read.ignoredColumns, notices: read.notices };
  }

  async enableUser(id: string, actorId?: string | null, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const user = await repo.findOne({ where: { id } });
    if (!user) throw new BadRequestException('User not found');
    if (user.status === 'enabled') return user;
    const summary = await this.billingService.getSubscriptionSummary({ manager: opts?.manager });
    if (summary.seat_limit !== null && summary.seats_used >= summary.seat_limit) {
      throw new BadRequestException('No seats available. Your plan allows up to ' + summary.seat_limit + ' contributors.');
    }
    const before = { ...user };
    user.status = 'enabled' as any;
    const saved = await repo.save(user);
    if (this.audit) {
      await this.audit.log(
        { table: 'users', recordId: saved.id, action: 'update', before, after: saved, userId: actorId ?? null },
        { manager: opts?.manager ?? repo.manager },
      );
    }
    return { ...saved, password_hash: undefined } as any;
  }

  async disableUser(
    id: string,
    actorId?: string | null,
    opts?: { manager?: EntityManager; sourceRef?: string },
  ) {
    const repo = this.getRepo(opts?.manager);
    const user = await repo.findOne({ where: { id } });
    if (!user) throw new BadRequestException('User not found');
    if (user.status === 'disabled') return user;
    const before = { ...user };
    user.status = 'disabled' as any;
    const saved = await repo.save(user);
    // Kill live sessions immediately: without this the user could keep refreshing
    // tokens for the remainder of the sliding refresh-token window.
    await (opts?.manager ?? repo.manager).getRepository(RefreshToken).delete({ user_id: id });
    if (this.audit) {
      await this.audit.log(
        {
          table: 'users',
          recordId: saved.id,
          action: 'update',
          before,
          after: saved,
          userId: actorId ?? null,
          source: opts?.sourceRef ? 'system' : undefined,
          sourceRef: opts?.sourceRef ?? null,
        },
        { manager: opts?.manager ?? repo.manager },
      );
    }
    return { ...saved, password_hash: undefined } as any;
  }

  /**
   * Invites a user: a password link by e-mail. The token, the status change
   * and the audit row are written first, the e-mail goes last.
   *
   * With `commitThenRun` (the HTTP route) those writes are committed and the
   * request's connection given back before the e-mail waits on the mail
   * queue, whose rate limit and retries can take minutes: the request never
   * holds its transaction open on the mail service (the server would end it
   * after the idle limit, taking the token with it, while the e-mail with its
   * link still went out). A send that fails then leaves the invitation saved
   * without its e-mail: the answer says so, and inviting again sends a new
   * link. Without it (a caller with its own transaction) a failed send fails
   * the call, as before.
   */
  async inviteUser(
    id: string,
    actorId?: string | null,
    baseUrl?: string,
    opts?: { manager?: EntityManager; commitThenRun?: CommitThenRunFn },
  ) {
    const repo = this.getRepo(opts?.manager);
    const user = await repo.findOne({ where: { id }, relations: ['role'] });
    if (!user) throw new BadRequestException('User not found');
    if (!user.email) throw new BadRequestException('User email is missing');
    if (user.external_auth_provider) {
      throw new BadRequestException(
        'This user signs in with Microsoft Entra. Invitations and passwords are managed by the identity provider.',
      );
    }

    let resolvedBaseUrl = baseUrl?.trim();
    if (!resolvedBaseUrl) {
      resolvedBaseUrl = (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || '').trim();
    }
    if (!resolvedBaseUrl) {
      throw new BadRequestException('application url is not configured');
    }
    const normalizedBase = resolvedBaseUrl.replace(/\/$/, '');

    const token = buildPasswordResetToken(
      { id: user.id, email: user.email, tenant_id: user.tenant_id },
      crypto.randomBytes(16).toString('hex'),
    );
    await this.storePasswordResetToken(token, user, opts);
    const expires = getPasswordResetExpirationMinutes();
    const inviteUrl = `${normalizedBase}/accept-invite#token=${encodeURIComponent(token)}`;
    const email = {
      to: user.email,
      inviteUrl,
      expiresInMinutes: expires,
      roleName: user.role?.role_name ?? null,
      locale: user.locale ?? undefined,
    };

    let result: any;
    if (user.status === 'invited' || user.status === 'enabled') {
      // Never demote an active account: for an enabled user the invite email is
      // just a "set your password" onboarding mail. Flipping them to 'invited'
      // would block their existing password login and hide them from the
      // default Users view.
      result = { ...user, password_hash: undefined };
    } else {
      const before = { ...user };
      user.status = 'invited' as any;
      const saved = await repo.save(user);
      if (this.audit) {
        await this.audit.log(
          { table: 'users', recordId: saved.id, action: 'update', before, after: saved, userId: actorId ?? null },
          { manager: opts?.manager ?? repo.manager },
        );
      }
      result = { ...saved, password_hash: undefined };
    }

    if (!opts?.commitThenRun) {
      await this.emailService.sendUserInviteEmail(email);
      return result;
    }
    let sendError: unknown = null;
    await opts.commitThenRun(async () => {
      try {
        await this.emailService.sendUserInviteEmail(email);
      } catch (error) {
        sendError = error;
      }
    });
    if (sendError) {
      // eslint-disable-next-line no-console
      console.error(`[users] invitation of user ${user.id}: saved, but its e-mail could not be sent:`, sendError);
      throw new BadGatewayException('The invitation is saved, but its e-mail could not be sent. Send the invitation again.');
    }
    return result;
  }

  private async storePasswordResetToken(token: string, user: User, opts?: { manager?: EntityManager }) {
    const decoded = jwt.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 60 * 60 * 1000);
    const manager = opts?.manager ?? this.passwordResetTokens?.manager;
    if (!manager) {
      throw new BadRequestException('password reset token storage is not configured');
    }
    const repo = manager.getRepository(PasswordResetToken);
    await repo.save(repo.create({
      tenant_id: user.tenant_id,
      user_id: user.id,
      token_hash: crypto.createHash('sha256').update(token).digest('hex'),
      expires_at: expiresAt,
      used_at: null,
    }));
  }

  // Per-user permission editing removed in RBAC model
}
