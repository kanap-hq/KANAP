import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { TeamMemberConfig, SkillProficiency } from './team-member-config.entity';
import { AuditService } from '../audit/audit.service';
import { ItemNumberService } from '../common/item-number.service';
import { UsersService } from '../users/users.service';
import { givenMembership, type MembershipPair, settleRecordMembership } from '../common/record-membership';

/** A contributor's default stream belongs to their default category (`common/record-membership.ts`). */
const DEFAULT_STREAM_PAIR: MembershipPair = { kind: 'stream', child: 'default_stream_id', parent: 'default_category_id' };

/**
 * Who is editing the person behind the contributor. `job_title` lives on
 * `users`, not on the contributor row, so it is written through
 * `UsersService.updateUser`, which enforces its own field allow-list. That
 * method treats a null actor as an internal update and opens every admin
 * field, so this type is deliberately required rather than optional: a caller
 * that cannot name its actor cannot touch the directory.
 */
export type ContributorProfileActor = {
  actorUserId: string | null;
  canManageUsers: boolean;
};

type TeamMemberConfigCreateInput = {
  user_id: string;
  /** On `users`, not on the contributor row. See `applyJobTitle`. */
  job_title?: string | null;
  areas_of_expertise?: string[];
  skills?: SkillProficiency[];
  project_availability?: number;
  notes?: string | null;
  team_id?: string | null;
  manager_user_id?: string | null;
  employment_type_id?: string | null;
  default_source_id?: string | null;
  default_category_id?: string | null;
  default_stream_id?: string | null;
  default_company_id?: string | null;
};

// `manager_source` is deliberately absent: it is derived by the service, never
// accepted from a request body. The Entra sync passes it through `opts` instead.
type TeamMemberConfigUpdateInput = {
  /** On `users`, not on the contributor row. See `applyJobTitle`. */
  job_title?: string | null;
  areas_of_expertise?: string[];
  skills?: SkillProficiency[];
  project_availability?: number;
  notes?: string | null;
  team_id?: string | null;
  manager_user_id?: string | null;
  employment_type_id?: string | null;
  default_source_id?: string | null;
  default_category_id?: string | null;
  default_stream_id?: string | null;
  default_company_id?: string | null;
};

type TeamMemberConfigSelfServiceInput = {
  job_title?: string | null;
  areas_of_expertise?: string[];
  skills?: SkillProficiency[];
  project_availability?: number;
  notes?: string | null;
  default_source_id?: string | null;
  default_category_id?: string | null;
  default_stream_id?: string | null;
  default_company_id?: string | null;
};

@Injectable()
export class TeamMemberConfigService {
  constructor(
    @InjectRepository(TeamMemberConfig)
    private readonly repo: Repository<TeamMemberConfig>,
    private readonly audit: AuditService,
    private readonly itemNumbers: ItemNumberService,
    @Inject(forwardRef(() => UsersService))
    private readonly users: UsersService,
  ) {}

  private getCurrentMonthStartUtc(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private addMonthsUtc(date: Date, months: number): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  }

  private toYearMonthKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private roundDays(hours: number): number {
    return Math.round((hours / 8) * 10) / 10;
  }

  // ==================== MANAGER / EMPLOYMENT TYPE VALIDATION ====================

  private static readonly MAX_MANAGER_CHAIN = 50;

  /**
   * A manager must be a user of the tenant, must not be the contributor
   * themselves, and must not already report to them.
   *
   * The cycle check reads before it writes, so it is serialized per tenant by a
   * transaction-scoped advisory lock: without it two concurrent requests setting
   * A -> B and B -> A would both pass. Requests already run inside a transaction
   * (common/tenant.interceptor.ts), which releases the lock on commit.
   */
  private async assertManagerAssignable(
    mg: EntityManager,
    tenantId: string,
    contributorUserId: string,
    managerUserId: string,
  ) {
    if (managerUserId === contributorUserId) {
      throw new BadRequestException('A contributor cannot be their own manager');
    }

    const managerRows = await mg.query(
      `SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2`,
      [managerUserId, tenantId],
    );
    if (managerRows.length === 0) {
      throw new BadRequestException('Manager not found');
    }

    await mg.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [
      `contributor-manager:${tenantId}`,
    ]);

    // One tenant-scoped read, then the chain is walked in memory: the reporting
    // line is a linked list, and point queries per hop would be an N+1.
    const rows: Array<{ user_id: string; manager_user_id: string }> = await mg.query(
      `SELECT user_id, manager_user_id
       FROM portfolio_team_member_configs
       WHERE tenant_id = $1 AND manager_user_id IS NOT NULL`,
      [tenantId],
    );
    const managerOf = new Map(rows.map((row) => [row.user_id, row.manager_user_id]));

    let current: string | undefined = managerUserId;
    for (let hop = 0; current && hop < TeamMemberConfigService.MAX_MANAGER_CHAIN; hop += 1) {
      if (current === contributorUserId) {
        throw new BadRequestException('That person already reports to this contributor');
      }
      current = managerOf.get(current);
    }
  }

  /** The tenant's first built-in type, Internal unless renamed. */
  private async defaultEmploymentTypeId(mg: EntityManager, tenantId: string): Promise<string | null> {
    const rows = await mg.query(
      `SELECT id FROM portfolio_employment_types
       WHERE tenant_id = $1 AND is_system = true AND is_active = true
       ORDER BY display_order ASC LIMIT 1`,
      [tenantId],
    );
    return rows[0]?.id ?? null;
  }

  private async assertEmploymentTypeUsable(
    mg: EntityManager,
    tenantId: string,
    employmentTypeId: string,
  ) {
    const rows = await mg.query(
      `SELECT 1 FROM portfolio_employment_types
       WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
      [employmentTypeId, tenantId],
    );
    if (rows.length === 0) {
      throw new BadRequestException('Contract type not found');
    }
  }

  // ==================== JOB TITLE (users column) ====================

  /**
   * `job_title` is a column of `users`, shared by the whole application, not a
   * label local to the portfolio. It is written through `UsersService`, which
   * owns the field allow-list, the access rule and the audit row: a raw UPDATE
   * from here would bypass all three.
   *
   * Two refusals of our own sit in front of it:
   * - a directory-managed account, because `mergeScalarFields` overwrites
   *   `job_title` from Entra at every nightly sync and every JIT sign-in, so a
   *   hand-typed value would silently disappear overnight;
   * - a caller with no actor, because `UsersService.updateUser` reads a null
   *   actor as an internal update and opens every admin field without a check.
   *
   * The drawer renders the field read-only in both cases, so reaching here is a
   * client bug and deserves a clear 403 rather than a silent no-op.
   */
  private async applyJobTitle(
    mg: EntityManager,
    tenantId: string,
    targetUserId: string,
    jobTitle: string | null,
    actor: ContributorProfileActor | undefined,
  ) {
    if (!actor) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_PROFILE_UPDATE',
        message: 'The job title can only be changed by an identified user.',
      });
    }

    const rows: Array<{
      job_title: string | null;
      external_auth_provider: string | null;
      sso_provider: string | null;
      sso_enabled: boolean | null;
    }> = await mg.query(
      `SELECT u.job_title, u.external_auth_provider, t.sso_provider, t.sso_enabled
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [targetUserId, tenantId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('User not found');

    // Same three-part condition as the drawer: the account comes from the
    // directory AND the tenant still signs in through it. An Entra account on a
    // tenant whose SSO was turned off is no longer synced, so it stays editable.
    const managedByEntra = row.external_auth_provider === 'entra'
      && row.sso_provider === 'entra'
      && row.sso_enabled === true;
    if (managedByEntra) {
      throw new ForbiddenException({
        code: 'PROFILE_FIELD_FROM_ENTRA',
        message: 'The job title comes from Microsoft Entra and cannot be changed here.',
      });
    }

    const next = jobTitle?.trim() || null;
    // A blur with no edit must not write an audit row per visit.
    if ((row.job_title || null) === next) return;

    await this.users.updateUser(targetUserId, { job_title: next }, actor, { manager: mg });
  }

  // ==================== LIST ====================
  async list(tenantId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;

    // Get all team member configs with user info and team info
    const items = await mg.query(`
      SELECT
        tmc.*,
        TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) as user_display_name,
        u.email as user_email,
        u.job_title as job_title,
        u.status as user_status,
        u.external_auth_provider as external_auth_provider,
        pt.name as team_name,
        TRIM(COALESCE(mgr.first_name, '') || ' ' || COALESCE(mgr.last_name, '')) as manager_name,
        et.name as employment_type_name
      FROM portfolio_team_member_configs tmc
      LEFT JOIN users u ON u.id = tmc.user_id
      LEFT JOIN portfolio_teams pt ON pt.id = tmc.team_id
      LEFT JOIN users mgr ON mgr.id = tmc.manager_user_id
      LEFT JOIN portfolio_employment_types et ON et.id = tmc.employment_type_id
      WHERE tmc.tenant_id = $1
      ORDER BY u.first_name ASC, u.last_name ASC, u.email ASC
    `, [tenantId]);

    return { items };
  }

  // ==================== GET BY ID ====================
  async get(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;

    const rows = await mg.query(`
      SELECT
        tmc.*,
        TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) as user_display_name,
        u.email as user_email,
        u.job_title as job_title,
        u.status as user_status,
        u.external_auth_provider as external_auth_provider,
        pt.name as team_name,
        TRIM(COALESCE(mgr.first_name, '') || ' ' || COALESCE(mgr.last_name, '')) as manager_name,
        et.name as employment_type_name
      FROM portfolio_team_member_configs tmc
      LEFT JOIN users u ON u.id = tmc.user_id
      LEFT JOIN portfolio_teams pt ON pt.id = tmc.team_id
      LEFT JOIN users mgr ON mgr.id = tmc.manager_user_id
      LEFT JOIN portfolio_employment_types et ON et.id = tmc.employment_type_id
      WHERE tmc.id = $1
    `, [id]);

    if (rows.length === 0) {
      throw new NotFoundException('Team member config not found');
    }

    return rows[0];
  }

  // ==================== GET BY USER ID ====================
  async getByUserId(userId: string, tenantId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(TeamMemberConfig);

    return repo.findOne({
      where: { user_id: userId, tenant_id: tenantId },
    });
  }

  /**
   * The self route reads through `get()` so it carries the same joined columns
   * as `:id` -- notably `job_title` and `external_auth_provider`, which the
   * properties drawer needs to decide whether the field is editable. A missing
   * config is still `null` here, not a 404: the page renders an empty profile
   * and the first save creates the row.
   */
  async getMe(userId: string, tenantId: string, opts?: { manager?: EntityManager }) {
    const config = await this.getByUserId(userId, tenantId, opts);
    if (!config) return null;
    return this.get(config.id, opts);
  }

  async upsertMe(
    currentUserId: string,
    body: TeamMemberConfigSelfServiceInput,
    tenantId: string,
    actorUserId: string | null,
    opts?: { manager?: EntityManager; profileActor?: ContributorProfileActor },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(TeamMemberConfig);

    const existing = await repo.findOne({
      where: { user_id: currentUserId, tenant_id: tenantId },
    });

    if (existing) {
      return this.update(existing.id, body, actorUserId, opts);
    }

    return this.create(
      {
        user_id: currentUserId,
        ...body,
      },
      tenantId,
      actorUserId,
      opts,
    );
  }

  // ==================== CREATE ====================
  async create(
    body: TeamMemberConfigCreateInput,
    tenantId: string,
    userId: string | null,
    opts?: {
      manager?: EntityManager;
      managerSource?: 'entra' | 'manual';
      profileActor?: ContributorProfileActor;
    },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(TeamMemberConfig);

    if (body.manager_user_id) {
      await this.assertManagerAssignable(mg, tenantId, body.user_id, body.manager_user_id);
    }
    if (body.employment_type_id) {
      await this.assertEmploymentTypeUsable(mg, tenantId, body.employment_type_id);
    }
    if (body.job_title !== undefined) {
      await this.applyJobTitle(mg, tenantId, body.user_id, body.job_title, opts?.profileActor);
    }
    // A contributor is never without a contract type: Internal unless said otherwise.
    const employmentTypeId = body.employment_type_id || await this.defaultEmploymentTypeId(mg, tenantId);
    const defaults = await settleRecordMembership(mg, [DEFAULT_STREAM_PAIR], givenMembership([DEFAULT_STREAM_PAIR], body as Record<string, unknown>), null, tenantId);

    const entity = repo.create({
      tenant_id: tenantId,
      user_id: body.user_id,
      areas_of_expertise: body.areas_of_expertise || [],
      skills: body.skills || [],
      project_availability: body.project_availability ?? 5,
      notes: body.notes || null,
      team_id: body.team_id ?? undefined,
      manager_user_id: body.manager_user_id ?? null,
      manager_source: body.manager_user_id ? (opts?.managerSource ?? 'manual') : null,
      employment_type_id: employmentTypeId,
      default_source_id: body.default_source_id ?? null,
      default_category_id: defaults.default_category_id ?? null,
      default_stream_id: defaults.default_stream_id ?? null,
      default_company_id: body.default_company_id ?? null,
    });

    entity.item_number = await this.itemNumbers.nextItemNumber('contributor', tenantId, mg);
    const saved = await repo.save(entity);

    await this.audit.log({
      table: 'portfolio_team_member_configs',
      recordId: saved.id,
      action: 'create',
      before: null,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  // ==================== UPDATE ====================
  async update(
    id: string,
    body: TeamMemberConfigUpdateInput,
    userId: string | null,
    opts?: {
      manager?: EntityManager;
      managerSource?: 'entra' | 'manual';
      profileActor?: ContributorProfileActor;
    },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(TeamMemberConfig);

    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Team member config not found');

    const before = { ...existing };

    // Before any contributor field is touched: a refusal here must not leave a
    // half-applied patch behind, even though the request transaction would roll
    // the whole thing back anyway.
    if (body.job_title !== undefined) {
      await this.applyJobTitle(
        mg,
        existing.tenant_id,
        existing.user_id,
        body.job_title,
        opts?.profileActor,
      );
    }

    if (body.areas_of_expertise !== undefined) {
      existing.areas_of_expertise = body.areas_of_expertise;
    }
    if (body.skills !== undefined) {
      existing.skills = body.skills;
    }
    if (body.project_availability !== undefined) {
      existing.project_availability = body.project_availability;
    }
    // Omitted fields stay untouched; an explicit clear must reach the DB as
    // NULL. TypeORM skips `undefined` properties on save, so `|| undefined`
    // silently kept the previous value when the user emptied the field.
    if (body.notes !== undefined) {
      existing.notes = body.notes || null;
    }
    if (body.team_id !== undefined) {
      existing.team_id = body.team_id || null;
    }
    if (body.manager_user_id !== undefined) {
      // A manager that came from Entra is owned by the directory: only the sync
      // itself may rewrite it. The one exception is an orphaned value, whose
      // user was deleted and whose column the foreign key already nulled --
      // that one is editable by hand again.
      const entraOwned = existing.manager_source === 'entra' && !!existing.manager_user_id;
      if (entraOwned && opts?.managerSource !== 'entra') {
        throw new BadRequestException('The manager comes from Microsoft Entra and cannot be changed here');
      }
      if (body.manager_user_id) {
        await this.assertManagerAssignable(mg, existing.tenant_id, existing.user_id, body.manager_user_id);
        existing.manager_user_id = body.manager_user_id;
        existing.manager_source = opts?.managerSource ?? 'manual';
      } else {
        existing.manager_user_id = null;
        existing.manager_source = null;
      }
    }
    if (body.employment_type_id !== undefined) {
      if (body.employment_type_id) {
        await this.assertEmploymentTypeUsable(mg, existing.tenant_id, body.employment_type_id);
      }
      existing.employment_type_id = body.employment_type_id || null;
    }
    if (body.default_source_id !== undefined) {
      existing.default_source_id = body.default_source_id ?? null;
    }
    // The default stream in the default category: a category changed alone drops a stream of another one.
    Object.assign(existing, await settleRecordMembership(
      mg, [DEFAULT_STREAM_PAIR], givenMembership([DEFAULT_STREAM_PAIR], body as Record<string, unknown>), existing as unknown as Record<string, unknown>, existing.tenant_id,
    ));
    if (body.default_company_id !== undefined) {
      existing.default_company_id = body.default_company_id ?? null;
    }

    existing.updated_at = new Date();

    const saved = await repo.save(existing);

    await this.audit.log({
      table: 'portfolio_team_member_configs',
      recordId: id,
      action: 'update',
      before,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  // ==================== DELETE ====================
  async delete(
    id: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(TeamMemberConfig);

    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Team member config not found');

    await repo.delete({ id });

    await this.audit.log({
      table: 'portfolio_team_member_configs',
      recordId: id,
      action: 'delete',
      before: existing,
      after: null,
      userId,
    }, { manager: mg });

    return { ok: true };
  }

  // ==================== TIME STATS ====================
  async getTimeStats(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(TeamMemberConfig);

    const config = await repo.findOne({ where: { id } });
    if (!config) throw new NotFoundException('Team member config not found');

    const userId = config.user_id;
    const currentMonth = this.getCurrentMonthStartUtc();
    const start12 = this.addMonthsUtc(currentMonth, -11);
    const start6 = this.addMonthsUtc(currentMonth, -5);

    const rows = await mg.query(
      `SELECT year_month, project_hours, other_hours, total_hours
       FROM user_time_monthly_aggregates
       WHERE tenant_id = app_current_tenant()
         AND user_id = $1
         AND year_month >= $2::date
         AND year_month <= $3::date
       ORDER BY year_month ASC`,
      [userId, start12, currentMonth],
    );

    const byMonth = new Map<string, { project: number; other: number; total: number }>();
    for (const row of rows) {
      const key = this.toYearMonthKey(new Date(row.year_month as string));
      const project = Number(row.project_hours) || 0;
      const other = Number(row.other_hours) || 0;
      const total = Number(row.total_hours) || 0;
      byMonth.set(key, { project, other, total });
    }

    const monthly: Array<{ yearMonth: string; projectDays: number; otherDays: number; totalDays: number }> = [];
    for (let i = 0; i < 12; i += 1) {
      const month = this.addMonthsUtc(start12, i);
      const key = this.toYearMonthKey(month);
      const row = byMonth.get(key);
      monthly.push({
        yearMonth: key,
        projectDays: this.roundDays(row?.project ?? 0),
        otherDays: this.roundDays(row?.other ?? 0),
        totalDays: this.roundDays(row?.total ?? 0),
      });
    }

    const avgRows = await mg.query(
      `SELECT AVG(project_hours)::numeric AS avg_project_hours
       FROM user_time_monthly_aggregates
       WHERE tenant_id = app_current_tenant()
         AND user_id = $1
         AND year_month >= $2::date
         AND year_month <= $3::date`,
      [userId, start6, currentMonth],
    );

    const avgProjectHours = Number(avgRows?.[0]?.avg_project_hours) || 0;

    return {
      userId,
      averageProjectDays: this.roundDays(avgProjectHours),
      monthly,
    };
  }

  async listTimeEntries(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(TeamMemberConfig);

    const config = await repo.findOne({ where: { id } });
    if (!config) throw new NotFoundException('Team member config not found');

    const rows = await mg.query(
      `SELECT *
       FROM (
         SELECT
           tte.id,
           'task'::text AS source_type,
           tte.task_id,
           CASE WHEN t.related_object_type = 'project' THEN t.related_object_id ELSE NULL END AS project_id,
           COALESCE(NULLIF(t.title, ''), 'Task') AS source_label,
           tte.category,
           tte.hours,
           tte.user_id,
           TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS user_name,
           u.email AS user_email,
           tte.logged_by_id,
           TRIM(COALESCE(lb.first_name, '') || ' ' || COALESCE(lb.last_name, '')) AS logged_by_name,
           lb.email AS logged_by_email,
           tte.notes,
           tte.logged_at
         FROM task_time_entries tte
         JOIN tasks t ON t.id = tte.task_id
         LEFT JOIN users u ON u.id = tte.user_id
         LEFT JOIN users lb ON lb.id = tte.logged_by_id
         WHERE tte.tenant_id = $1
           AND tte.user_id = $2

         UNION ALL

         SELECT
           pte.id,
           'project'::text AS source_type,
           NULL::uuid AS task_id,
           pte.project_id,
           COALESCE(NULLIF(pp.name, ''), 'Project Overhead') AS source_label,
           pte.category,
           pte.hours::numeric AS hours,
           pte.user_id,
           TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS user_name,
           u.email AS user_email,
           pte.logged_by_id,
           TRIM(COALESCE(lb.first_name, '') || ' ' || COALESCE(lb.last_name, '')) AS logged_by_name,
           lb.email AS logged_by_email,
           pte.notes,
           pte.logged_at
         FROM portfolio_project_time_entries pte
         LEFT JOIN portfolio_projects pp ON pp.id = pte.project_id
         LEFT JOIN users u ON u.id = pte.user_id
         LEFT JOIN users lb ON lb.id = pte.logged_by_id
         WHERE pte.tenant_id = $1
           AND pte.user_id = $2
       ) all_entries
       ORDER BY all_entries.logged_at DESC, all_entries.id DESC`,
      [config.tenant_id, config.user_id],
    );

    return rows;
  }

  async getAllTimeStats(tenantId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const currentMonth = this.getCurrentMonthStartUtc();
    const start6 = this.addMonthsUtc(currentMonth, -5);

    const rows = await mg.query(
      `SELECT tmc.id AS config_id,
              AVG(utma.project_hours)::numeric AS avg_project_hours,
              AVG(utma.total_hours)::numeric AS avg_total_hours
       FROM portfolio_team_member_configs tmc
       LEFT JOIN user_time_monthly_aggregates utma
         ON utma.tenant_id = tmc.tenant_id
        AND utma.user_id = tmc.user_id
        AND utma.year_month >= $1::date
        AND utma.year_month <= $2::date
       WHERE tmc.tenant_id = $3
       GROUP BY tmc.id`,
      [start6, currentMonth, tenantId],
    );

    const stats: Record<string, { avgProjectDays: number; avgTotalDays: number }> = {};
    for (const row of rows) {
      if (row.avg_project_hours == null && row.avg_total_hours == null) continue;
      stats[row.config_id] = {
        avgProjectDays: this.roundDays(Number(row.avg_project_hours) || 0),
        avgTotalDays: this.roundDays(Number(row.avg_total_hours) || 0),
      };
    }

    return { stats };
  }

  // ==================== CREATE OR UPDATE BY USER ====================
  async upsertByUser(
    targetUserId: string,
    body: TeamMemberConfigUpdateInput,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager; profileActor?: ContributorProfileActor },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(TeamMemberConfig);

    const existing = await repo.findOne({
      where: { user_id: targetUserId, tenant_id: tenantId },
    });

    if (existing) {
      return this.update(existing.id, body, userId, opts);
    } else {
      return this.create(
        { user_id: targetUserId, ...body },
        tenantId,
        userId,
        opts,
      );
    }
  }
}
