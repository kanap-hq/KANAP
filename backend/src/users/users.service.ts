import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, Repository } from 'typeorm';
import { User } from './user.entity';
import { Role } from '../roles/role.entity';
import { RolesService } from '../roles/roles.service';
import { UserRole } from './user-role.entity';
import * as argon2 from 'argon2';
import { parsePagination, parseExportPagination } from '../common/pagination';
import { orderListQuery, textSortKey } from '../common/list-sort';

const USER_TEXT_SORTS = new Set(['email', 'first_name', 'last_name', 'job_title']);
const AI_USER_TEXT_SORTS = new Set([
  'display_name', 'email', 'first_name', 'last_name', 'job_title', 'company_name', 'department_name',
  'primary_role_name', 'team_name', 'contributor_profile',
]);
import {
  buildQuickSearchConditions,
  compileAgFilterCondition,
  createParamNameGenerator,
  FilterTargetConfig,
  isExcludeSetModel,
  normalizeAgFilterModel,
} from '../common/ag-grid-filtering';
import { compileUserListFilters } from './users-list-filters';
import { userAssignedRolesSql, userDataAccessModeSql } from './user-access-sql';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
// import { PermissionsService, PermissionLevel } from '../permissions/permissions.service';
import { Company } from '../companies/company.entity';
import { Department } from '../departments/department.entity';
import { EmailService } from '../email/email.service';
import { createPasswordResetToken as buildPasswordResetToken, getPasswordResetExpirationMinutes } from '../auth/password-reset.util';
import { PasswordResetToken } from '../auth/password-reset-token.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { RolePermission } from '../permissions/role-permission.entity';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { CommitThenRunFn } from '../common/import-connection';
import { APP_URL_NOT_CONFIGURED_MESSAGE } from '../common/url';
import {
  cellOf,
  CsvDateOrder,
  CsvLanguage,
  DecimalMark,
  readMasterDataFile,
  rowError,
  rowProblemErrors,
} from '../common/csv-sheet';
import { sameStoredValues } from '../common/csv-sheet/unchanged';
import { uploadedBytes } from '../common/upload';
import { ListExportCell, ListExportFile, writeListExport } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';

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
  /**
   * The caller administers users and their own access is not limited, as the users list's access
   * column: each row then carries every role of the user and their effective data-access mode, and
   * the quick search looks in the administration fields too (job, role, company, department, team,
   * expertise). Otherwise it looks in the name and the email only, as the users list for a reader.
   */
  accessView?: boolean;
  /** These users only: the detail of a person reads the list's columns for that one row. */
  ids?: string[];
};

/**
 * A filter on every role a user holds (primary or additional): the user matches when one of their
 * roles does; in exclude mode, when none does.
 */
function compileAiUserRolesFilter(rawModel: any, nextParam: () => string): { sql: string; params: Record<string, any> } | null {
  const model = normalizeAgFilterModel(rawModel);
  const exclude = isExcludeSetModel(model);
  // In exclude mode the condition is the include one, negated around the whole set of roles.
  const { mode: _mode, ...stripped } = model ?? {};
  const include = exclude ? stripped : model;
  const condition = compileAgFilterCondition(include, { expression: 'held_role.role_name', dataType: 'string' }, nextParam);
  if (!condition) return null;
  const held = `EXISTS (
    SELECT 1
      FROM ${userAssignedRolesSql('u')} held_assigned
      JOIN roles held_role ON held_role.id = held_assigned.role_id AND held_role.tenant_id = u.tenant_id
     WHERE ${condition.sql}
  )`;
  return { sql: exclude ? `NOT ${held}` : held, params: condition.params };
}

const buildAiUserDisplayNameSql = (alias: string): string =>
  `COALESCE(NULLIF(TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), ''), ${alias}.email)`;

const buildAiUserExpertiseSql = (configAlias: string): string =>
  `COALESCE((
    SELECT string_agg(DISTINCT area.value, ', ' ORDER BY area.value)
    FROM jsonb_array_elements_text(COALESCE(${configAlias}.areas_of_expertise, '[]'::jsonb)) area(value)
  ), '')`;

const AI_USER_CONTRIBUTOR_PROFILE_SQL = `CASE WHEN tmc.id IS NULL THEN 'not_configured' ELSE 'configured' END`;

/** A user as written to the audit log: a copy without its password hash or MFA secret. */
export function userAuditSnapshot(user: Partial<User>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { ...user };
  delete snapshot.password_hash;
  delete snapshot.mfa_secret;
  return snapshot;
}

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
      // The effective mode: a user holding the Administrator role reads `all` whatever is stored.
      data_access: {
        expression: userDataAccessModeSql('u'),
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

    if (opts?.ids) {
      qb.andWhere('u.id = ANY(:aiUserIds::uuid[])', { aiUserIds: opts.ids });
    }

    if (status) {
      qb.andWhere('u.status = :status', { status });
    }

    if (fm) {
      for (const [field, model] of Object.entries(fm)) {
        if (field === 'roles') {
          const held = compileAiUserRolesFilter(model, nextParam);
          if (held) qb.andWhere(new Brackets((sub) => sub.where(held.sql, held.params)));
          continue;
        }
        const target = targets[field];
        if (!target) continue;
        const condition = compileAgFilterCondition(model, target, nextParam);
        if (!condition) continue;
        qb.andWhere(new Brackets((sub) => sub.where(condition.sql, condition.params)));
      }
    }

    // A word finds a person by a field the caller may read only: the name and the email, plus the
    // administration fields for the administration view.
    const quickSearchExpressions = opts?.accessView
      ? [
        displayNameSql,
        'u.email',
        `COALESCE(u.job_title, '')`,
        `COALESCE(r.role_name, '')`,
        `COALESCE(c.name, '')`,
        `COALESCE(d.name, '')`,
        `COALESCE(pt.name, '')`,
        expertiseSql,
      ]
      : [displayNameSql, 'u.email'];
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
    const rawSortField = sortFieldMap[sort.field] ?? 'u.last_name';
    // Text alphabetically, case and accents ignored (`textSortKey`).
    const sortField = AI_USER_TEXT_SORTS.has(sort.field in sortFieldMap ? sort.field : 'last_name')
      ? (await textSortKey(qb.connection.manager))(rawSortField)
      : rawSortField;

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
      .addSelect('u.role_id', 'role_id')
      .addSelect('pt.name', 'team_name')
      .addSelect('tmc.project_availability', 'project_availability')
      .addSelect(AI_USER_CONTRIBUTOR_PROFILE_SQL, 'contributor_profile')
      .addSelect(expertiseSql, 'areas_of_expertise')
      .addSelect(displayNameSql, 'display_name')
      .orderBy(sortField, sort.direction, 'NULLS LAST')
      // A tie-break on another expression: one on u.email would replace the email sort itself.
      .addOrderBy('u.id', 'ASC')
      .offset(skip)
      .limit(limit)
      .getRawMany();

    // Every role and the effective mode, read as the users list reads them for its access column.
    if (opts?.accessView && items.length > 0) {
      const mg = opts?.manager ?? this.repo.manager;
      const pageUsers = items.map((row: any) => ({ id: row.id, role_id: row.role_id ?? null, role_name: row.primary_role_name ?? null }));
      const { rolesByUser, adminRoleIds } = await this.readUsersRoles(mg, pageUsers);
      const modes = await this.readDataAccessModes(mg, pageUsers, rolesByUser, adminRoleIds);
      for (const row of items) {
        row.roles = (rolesByUser.get(row.id) ?? []).map((role) => role.name).filter((name): name is string => !!name);
        row.data_access = modes.get(row.id)?.mode ?? 'all';
      }
    }

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
      if (field === 'roles') {
        // Every role held by a user of the tenant, primary or additional.
        const rows = await mg.query(
          `SELECT DISTINCT held_role.role_name AS value
           FROM users u
           CROSS JOIN LATERAL ${userAssignedRolesSql('u')} held_assigned
           JOIN roles held_role ON held_role.id = held_assigned.role_id AND held_role.tenant_id = u.tenant_id
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

  /**
   * Every role of these users, primary first, then the others in the order they were given; a user
   * without a row in `user_roles` holds their primary role alone. Also the ids of the Administrator
   * roles among them, and every role id seen. One query for the whole page: the users list's admin
   * columns, and the assistant's users family.
   */
  private async readUsersRoles(
    mg: EntityManager,
    users: Array<{ id: string; role_id: string | null; role_name: string | null }>,
  ): Promise<{
    rolesByUser: Map<string, Array<{ id: string; name: string | null }>>;
    adminRoleIds: Set<string>;
    allRoleIds: Set<string>;
  }> {
    const userRoles = await mg.getRepository(UserRole).find({
      where: { user_id: In(users.map((u) => u.id)) },
      relations: ['role'],
      order: { is_primary: 'DESC', created_at: 'ASC' },
    });
    const rolesByUser = new Map<string, Array<{ id: string; name: string | null }>>();
    const adminRoleIds = new Set<string>();
    const allRoleIds = new Set<string>();
    for (const u of users) {
      if (u.role_id) allRoleIds.add(u.role_id);
      if (u.role_id && (u.role_name ?? '').toLowerCase() === 'administrator') adminRoleIds.add(u.role_id);
    }
    for (const ur of userRoles) {
      allRoleIds.add(ur.role_id);
      const list = rolesByUser.get(ur.user_id) ?? [];
      list.push({ id: ur.role_id, name: ur.role?.role_name ?? null });
      rolesByUser.set(ur.user_id, list);
      if ((ur.role?.role_name ?? '').toLowerCase() === 'administrator') adminRoleIds.add(ur.role_id);
    }
    for (const u of users) {
      if (!rolesByUser.has(u.id)) rolesByUser.set(u.id, u.role_id ? [{ id: u.role_id, name: u.role_name }] : []);
    }
    return { rolesByUser, adminRoleIds, allRoleIds };
  }

  /**
   * The effective data-access mode of these users and, for a limited one, their node names (spec
   * §7.4): a user holding the Administrator role sees all data whatever the stored mode. Two
   * queries for the whole page. The users list's access column, and the assistant's users family.
   */
  private async readDataAccessModes(
    mg: EntityManager,
    users: Array<{ id: string; role_id: string | null }>,
    rolesByUser: Map<string, Array<{ id: string; name: string | null }>>,
    adminRoleIds: Set<string>,
  ): Promise<Map<string, { mode: 'all' | 'limited'; nodes: Array<{ type: 'all' | 'company' | 'cost_center'; name: string | null }> }>> {
    const pageIds = users.map((u) => u.id);
    const modes: Array<{ id: string; data_access_mode: string }> = await mg.query(
      `SELECT id, data_access_mode FROM users WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
      [pageIds],
    );
    const modeById = new Map(modes.map((row) => [row.id, row.data_access_mode]));
    const nodeRows: Array<{
      user_id: string;
      node_type: string;
      company_name: string | null;
      cost_center_code: string | null;
      cost_center_name: string | null;
    }> = await mg.query(
      `SELECT n.user_id, n.node_type, co.name AS company_name,
              cc.code AS cost_center_code, cc.name AS cost_center_name
         FROM user_data_access_nodes n
         LEFT JOIN companies co ON co.tenant_id = n.tenant_id AND co.id = n.company_id
         LEFT JOIN cost_centers cc ON cc.tenant_id = n.tenant_id AND cc.id = n.cost_center_id
        WHERE n.tenant_id = app_current_tenant() AND n.user_id = ANY($1::uuid[])
        ORDER BY CASE n.node_type WHEN 'all' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
                 lower(co.name), lower(cc.code), n.id`,
      [pageIds],
    );
    const names = new Map<string, Array<{ type: 'all' | 'company' | 'cost_center'; name: string | null }>>();
    for (const row of nodeRows) {
      const list = names.get(row.user_id) ?? [];
      // The server sends the node type and its name, never a label: the screen writes
      // "Everything" for an `all` node (spec §7.4). `name` is null for `all`.
      if (row.node_type === 'company') list.push({ type: 'company', name: row.company_name ?? null });
      else if (row.node_type === 'cost_center') list.push({ type: 'cost_center', name: row.cost_center_name ?? row.cost_center_code ?? null });
      else list.push({ type: 'all', name: null });
      names.set(row.user_id, list);
    }
    const out = new Map<string, { mode: 'all' | 'limited'; nodes: Array<{ type: 'all' | 'company' | 'cost_center'; name: string | null }> }>();
    for (const u of users) {
      const roles = rolesByUser.get(u.id) ?? [];
      const isAdministrator = (!!u.role_id && adminRoleIds.has(u.role_id))
        || roles.some((role) => adminRoleIds.has(role.id)
          || (role.name ?? '').trim().toLowerCase() === 'administrator');
      const limited = modeById.get(u.id) === 'limited' && !isAdministrator;
      out.set(u.id, { mode: limited ? 'limited' : 'all', nodes: limited ? names.get(u.id) ?? [] : [] });
    }
    return out;
  }

  async list(query: any, opts?: { manager?: EntityManager; adminView?: boolean; exportAll?: boolean; dataAccessView?: boolean }) {
    const repo = this.getRepo(opts?.manager);
    const { page, limit, skip, sort, status, q, filters } = opts?.exportAll ? parseExportPagination(query) : parsePagination(query);
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
    await orderListQuery(qb, `u.${sortField}`, direction, {
      text: USER_TEXT_SORTS.has(sortField),
      idExpr: 'u.id',
      nulls: sortField === 'last_login_at' ? 'NULLS LAST' : undefined,
    });
    qb.skip(skip).take(limit);
    const [items, total] = await qb.getManyAndCount();

    // Admin view: batch-load every role of the page rows plus an access flag
    // (pending_access = enabled but no role grants any permission). Single
    // queries for the whole page — never per-row lookups.
    let rolesByUser: Map<string, Array<{ id: string; name: string | null }>> | undefined;
    let rolesWithPerms: Set<string> | undefined;
    let adminRoleIds: Set<string> | undefined;
    let dataAccessByUser: Map<string, {
      mode: 'all' | 'limited';
      nodes: Array<{ type: 'all' | 'company' | 'cost_center'; name: string | null }>;
    }> | undefined;
    let dataAccessAnyLimited: boolean | undefined;
    if (opts?.adminView && items.length > 0) {
      const mg = opts?.manager ?? repo.manager;
      const pageUsers = items.map((u) => ({ id: u.id, role_id: u.role_id, role_name: u.role?.role_name ?? null }));
      const read = await this.readUsersRoles(mg, pageUsers);
      rolesByUser = read.rolesByUser;
      adminRoleIds = read.adminRoleIds;
      const allRoleIds = read.allRoleIds;
      if (opts?.dataAccessView) {
        dataAccessByUser = await this.readDataAccessModes(mg, pageUsers, rolesByUser, adminRoleIds);
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

    if (opts?.dataAccessView) {
      const mg = opts?.manager ?? repo.manager;
      const [anyLimited]: Array<{ any_limited: boolean }> = await mg.query(
        `SELECT EXISTS (
           SELECT 1 FROM users u
            WHERE u.tenant_id = app_current_tenant()
              AND u.data_access_mode = 'limited'
              AND NOT EXISTS (
                SELECT 1
                FROM (
                  SELECT u.role_id
                  UNION
                  SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id
                ) assigned
                JOIN roles r ON r.id = assigned.role_id AND r.tenant_id = u.tenant_id
                WHERE lower(trim(r.role_name)) = 'administrator'
              )
         ) AS any_limited`,
      );
      dataAccessAnyLimited = anyLimited?.any_limited === true;
    }
    const safe = items.map(u => {
      if (opts?.adminView) {
        const roles = rolesByUser?.get(u.id) ?? [];
        const accessRoleIds = new Set(roles.map((r) => r.id));
        if (u.role_id) accessRoleIds.add(u.role_id);
        const hasAccess = Array.from(accessRoleIds).some(
          (rid) => adminRoleIds?.has(rid) || rolesWithPerms?.has(rid),
        );
        return {
          ...u,
          password_hash: undefined,
          roles,
          pending_access: u.status === 'enabled' && !hasAccess,
          ...(opts?.dataAccessView && dataAccessByUser
            ? { data_access: dataAccessByUser.get(u.id) ?? { mode: 'all', nodes: [] } }
            : {}),
        };
      }
      return {
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        status: u.status,
      };
    });
    const result: any = { items: safe, total, page, limit };
    if (opts?.dataAccessView) result.data_access_any_limited = dataAccessAnyLimited === true;
    return result;
  }

  findByEmail(email: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    return repo.findOne({ where: { email }, relations: ['role'] });
  }

  /**
   * Sign-in only: the user and its role, with the password hash that no other read of a user
   * selects (`select: false` on the column).
   */
  findByEmailForSignIn(email: string, opts?: { manager?: EntityManager }) {
    return this.getRepo(opts?.manager)
      .createQueryBuilder('u')
      .addSelect('u.password_hash')
      .leftJoinAndSelect('u.role', 'role')
      .where('u.email = :email', { email })
      .getOne();
  }

  /** Every role name of a user, primary first, as the users list's admin columns read them. */
  async rolesOf(
    user: { id: string; role_id: string | null; role?: { role_name?: string | null } | null },
    opts?: { manager?: EntityManager },
  ): Promise<string[]> {
    const mg = opts?.manager ?? this.repo.manager;
    const { rolesByUser } = await this.readUsersRoles(mg, [{ id: user.id, role_id: user.role_id, role_name: user.role?.role_name ?? null }]);
    return (rolesByUser.get(user.id) ?? []).map((role) => role.name).filter((name): name is string => !!name);
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
          after: userAuditSnapshot(saved),
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
          before: userAuditSnapshot(existing),
          after: userAuditSnapshot(saved),
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

  async exportCsv<F extends ExportFileFormat = 'csv'>(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; language?: CsvLanguage; listQuery?: Record<string, unknown>; format?: F },
  ): Promise<ListExportFile<F>> {
    const language = opts?.language ?? 'en';
    const headers = this.csvHeaders();
    const rows: ListExportCell[][] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      // What the list shows (its search, filters, scope and sort), or the whole register, newest first.
      const items: User[] = opts?.listQuery
        ? (await this.list(opts.listQuery, { manager: opts.manager, adminView: true, exportAll: true })).items as any
        : await repo.find({ order: { created_at: 'DESC' as any, id: 'ASC' as any }, relations: ['role', 'company', 'department'] });
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
    const sheetNames = { en: 'Users', fr: 'Utilisateurs', de: 'Benutzer', es: 'Usuarios' };
    return writeListExport({ format: opts?.format ?? ('csv' as F), language, filename, sheetNames, headers, rows });
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
    const buf = uploadedBytes(file);
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
        ok: false, dryRun, total: 0, inserted: 0, updated: 0, unchanged: 0,
        errors: [read.headerError],
        rolesToCreate: [], ignoredColumns: read.ignoredColumns, notices: read.notices,
      };
    }
    const repo = this.getRepo(opts?.manager);
    const companiesRepo = opts?.manager ? opts.manager.getRepository(Company) : this.companies;
    const departmentsRepo = opts?.manager ? opts.manager.getRepository(Department) : this.departments;

    // The roles of the file. A role the tenant does not have is created by the
    // load, never by a check: a check lists it in `rolesToCreate` and writes
    // nothing, so a typo in a role name leaves no trace when the user only
    // looks at the file.
    type FileRole = { name: string; id: string | null };
    const roleByName = new Map<string, FileRole>();
    const rolesToCreate: string[] = [];
    const resolveRole = async (name: string): Promise<FileRole> => {
      const key = name.toLowerCase();
      const known = roleByName.get(key);
      if (known) return known;
      const existing = await this.rolesService.findByName(name, { manager: opts?.manager });
      const role: FileRole = { name, id: existing ? existing.id : null };
      if (!existing) rolesToCreate.push(name);
      roleByName.set(key, role);
      return role;
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
    type Normalized = Omit<Partial<User>, 'role_id' | 'role'> & {
      email: string;
      /** The row's role, its id filled once the load has created it. */
      role: FileRole;
      company_id: string | null;
      department_id: string | null;
    };
    const normalized: Normalized[] = [];
    for (const row of read.rows) {
      const line = row.line;
      const problems = rowProblemErrors(row);
      if (problems.length > 0) {
        errors.push(...problems);
        continue;
      }
      const email = cellOf(row, 'email');
      const first_name = cellOf(row, 'first_name') || null;
      const last_name = cellOf(row, 'last_name') || null;
      let roleName = cellOf(row, 'role');
      const companyName = cellOf(row, 'company_name');
      const departmentName = cellOf(row, 'department_name');
      const statusRaw = cellOf(row, 'status').toLowerCase();

      if (!email) errors.push(rowError(line, 'email', 'CSV_VALUE_REQUIRED', 'email is required'));
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(rowError(line, 'email', 'CSV_EMAIL_INVALID', 'email must be valid', { value: email }));
      if (statusRaw && !['enabled','disabled','contact','invited'].includes(statusRaw)) {
        errors.push(rowError(line, 'status', 'CSV_ENUM_INVALID', `Invalid status '${statusRaw}'. Use 'contact', 'invited', 'enabled' or 'disabled'.`, { value: statusRaw, allowed: 'contact, invited, enabled, disabled' }));
      }

      let role: FileRole | null = null;
      if (!roleName) roleName = 'Contact';
      if (roleName) role = await resolveRole(roleName);

      let company: Company | null = null;
      if (companyName) {
        company = await getCompanyByName(companyName);
        if (!company) errors.push(rowError(line, 'company_name', 'CSV_REFERENCE_NOT_FOUND', `Unknown company '${companyName}'`, { value: companyName }));
      }

      let department: Department | null = null;
      if (departmentName) {
        if (!company) {
          errors.push(rowError(line, 'department_name', 'CSV_DEPARTMENT_COMPANY_REQUIRED', 'department_name provided but company_name is missing or invalid'));
        } else {
          department = await getDepartmentByName(company.id, departmentName);
          if (!department) errors.push(rowError(line, 'department_name', 'CSV_REFERENCE_NOT_FOUND', `Unknown department '${departmentName}' for company '${company.name}'`, { value: departmentName }));
        }
      }

      if (role) {
        normalized.push({
          email,
          first_name,
          last_name,
          role,
          company_id: company ? company.id : null,
          department_id: department ? department.id : null,
          status: (['enabled','disabled','contact','invited'].includes(statusRaw) ? (statusRaw as any) : 'contact'),
        });
      }
    }

    if (errors.length > 0) {
      return {
        ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, unchanged: 0, errors,
        // Nothing would be written: no role is offered for creation either.
        rolesToCreate: [], ignoredColumns: read.ignoredColumns, notices: read.notices,
      };
    }

    // The load creates the roles the file names, once its rows are known good.
    // A check creates nothing and answers with `rolesToCreate` instead.
    if (!dryRun) {
      for (const name of rolesToCreate) {
        const created = await this.rolesService.createRole({ role_name: name, role_description: `${name} role` }, { manager: opts?.manager });
        if (!created) {
          return {
            ok: false, dryRun, total: read.rows.length, inserted: 0, updated: 0, unchanged: 0,
            errors: [{ row: 0, message: `Unknown role '${name}'` }],
            rolesToCreate: [], ignoredColumns: read.ignoredColumns, notices: read.notices,
          };
        }
        roleByName.get(name.toLowerCase())!.id = created.id;
      }
    }

    // Deduplicate by email (lowercased)
    const uniqueByEmail = new Map<string, Normalized>();
    for (const item of normalized) {
      const key = (item.email as string).toLowerCase();
      if (!uniqueByEmail.has(key)) uniqueByEmail.set(key, item);
    }
    const unique = Array.from(uniqueByEmail.values());

    // Count inserts, updates and unchanged rows. A row equal to the stored user is
    // unchanged and is not written: no save, no audit line. The import writes only
    // columns of `users` (the role as `role_id`), so those columns are all it compares.
    // A role the load still has to create has no id yet: the row is an update.
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const toWrite: Array<{ item: Normalized; existing: User | null }> = [];
    for (const item of unique) {
      const existing = await repo.findOne({ where: { email: item.email } });
      if (!existing) {
        inserted += 1;
      } else if (this.importRowUnchanged(existing, item)) {
        unchanged += 1;
        continue;
      } else {
        updated += 1;
      }
      toWrite.push({ item, existing });
    }
    if (dryRun) {
      return {
        ok: true, dryRun: true, total: read.rows.length, inserted, updated, unchanged, errors: [],
        rolesToCreate, ignoredColumns: read.ignoredColumns, notices: read.notices,
      };
    }

    // Commit: upsert by email
    let processed = 0;
    for (const { item, existing } of toWrite) {
      // The role is a lookup of this import, not a column: only its id is written.
      // A check leaves an id unset and writes nothing; a load resolved them all above.
      const { role, ...rest } = item;
      const body = { ...rest, role_id: role.id ?? undefined };
      if (existing) {
        const before = { ...existing };
        const next = { ...existing, ...body } as User;
        const saved = await repo.save(next);
        processed += 1;
        if (this.audit) {
          await this.audit.log(
            {
              table: 'users',
              recordId: saved.id,
              action: 'update',
              before: userAuditSnapshot(before),
              after: userAuditSnapshot(saved),
              userId: userId ?? null,
            },
            { manager: opts?.manager ?? repo.manager },
          );
        }
      } else {
        const created = repo.create({ ...body, password_hash: null, mfa_enabled: false });
        const saved = await repo.save(created);
        processed += 1;
        if (this.audit) {
          await this.audit.log(
            {
              table: 'users',
              recordId: saved.id,
              action: 'create',
              before: null,
              after: userAuditSnapshot(saved),
              userId: userId ?? null,
            },
            { manager: opts?.manager ?? repo.manager },
          );
        }
      }
    }
    return {
      ok: true, dryRun: false, total: read.rows.length, inserted, updated, unchanged, processed, errors: [],
      rolesToCreate, ignoredColumns: read.ignoredColumns, notices: read.notices,
    };
  }

  /** Whether a CSV row sets only what the stored user already holds, its resolved role included. */
  private importRowUnchanged(
    existing: User,
    item: { role: { id: string | null }; [key: string]: unknown },
  ): boolean {
    const { role, ...rest } = item;
    if (!role.id) return false;
    return sameStoredValues(existing as unknown as Record<string, unknown>, { ...rest, role_id: role.id });
  }

  async enableUser(id: string, actorId?: string | null, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const user = await repo.findOne({ where: { id } });
    if (!user) throw new BadRequestException('User not found');
    if (user.status === 'enabled') return user;
    const summary = await this.billingService.getSubscriptionSummary({ manager: opts?.manager });
    if (summary.seat_limit !== null && summary.seats_used >= summary.seat_limit) {
      throw new BadRequestException('This subscription allows ' + summary.seat_limit + ' enabled users. Disable another user first.');
    }
    const before = userAuditSnapshot(user);
    user.status = 'enabled' as any;
    const saved = await repo.save(user);
    if (this.audit) {
      await this.audit.log(
        { table: 'users', recordId: saved.id, action: 'update', before, after: userAuditSnapshot(saved), userId: actorId ?? null },
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
    const before = userAuditSnapshot(user);
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
          after: userAuditSnapshot(saved),
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

    // The caller passes the link base (the HTTP route: `resolveAppBaseUrl`, common/url.ts). No
    // fallback to the configured address: without the tenant it is no tenant's address in
    // multi-tenant mode.
    const resolvedBaseUrl = baseUrl?.trim();
    if (!resolvedBaseUrl) {
      throw new BadRequestException(APP_URL_NOT_CONFIGURED_MESSAGE);
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
      const before = userAuditSnapshot(user);
      user.status = 'invited' as any;
      const saved = await repo.save(user);
      if (this.audit) {
        await this.audit.log(
          { table: 'users', recordId: saved.id, action: 'update', before, after: userAuditSnapshot(saved), userId: actorId ?? null },
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
