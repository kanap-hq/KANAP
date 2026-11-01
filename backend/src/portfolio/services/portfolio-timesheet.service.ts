import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { codedForbidden } from '../../auth/module-right-required';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioProjectTimeEntry, TimeEntryCategory } from '../portfolio-project-time-entry.entity';
import { AuditService } from '../../audit/audit.service';
import { PortfolioProjectsBaseService, ServiceOpts } from './portfolio-projects-base.service';
import { UserTimeAggregateService } from './user-time-aggregate.service';

const LOGGED_AT_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day of `now` in the server's local time zone, as YYYY-MM-DD. */
export function localTodayYmd(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * A project time entry's day. The value is a calendar day (YYYY-MM-DD), not after the server's
 * local today. It is stored at UTC midnight, so the monthly aggregates, which bucket on the UTC
 * month, follow the chosen day.
 */
export function parseLoggedAt(value: unknown, today = new Date()): Date {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) {
    throw new BadRequestException('logged_at is required');
  }
  const stored = new Date(`${text}T00:00:00.000Z`);
  if (!LOGGED_AT_DAY.test(text) || Number.isNaN(stored.getTime()) || stored.toISOString().slice(0, 10) !== text) {
    throw new BadRequestException('logged_at must be a date (YYYY-MM-DD)');
  }
  if (text > localTodayYmd(today)) {
    throw new BadRequestException('logged_at cannot be in the future');
  }
  return stored;
}

/**
 * Service for managing project time entries.
 */
@Injectable()
export class PortfolioTimesheetService extends PortfolioProjectsBaseService {
  constructor(
    @InjectRepository(PortfolioProject) projectRepo: Repository<PortfolioProject>,
    private readonly audit: AuditService,
    private readonly userTimeAggregateService: UserTimeAggregateService,
  ) {
    super(projectRepo);
  }

  /**
   * List all time entries for a project.
   */
  async listTimeEntries(projectId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    return mg.query(
      `SELECT te.*,
              u.email as user_email, u.first_name as user_first_name, u.last_name as user_last_name,
              lb.email as logged_by_email, lb.first_name as logged_by_first_name, lb.last_name as logged_by_last_name
       FROM portfolio_project_time_entries te
       LEFT JOIN users u ON u.id = te.user_id
       LEFT JOIN users lb ON lb.id = te.logged_by_id
       WHERE te.project_id = $1
       ORDER BY te.logged_at DESC`,
      [projectId]
    );
  }

  /**
   * Create a new time entry.
   */
  async createTimeEntry(
    projectId: string,
    body: {
      category: TimeEntryCategory;
      user_id?: string;
      hours: number;
      notes?: string;
      logged_at: string;
    },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const timeEntryRepo = mg.getRepository(PortfolioProjectTimeEntry);

    // Validate category
    if (!body.category || !['it', 'business'].includes(body.category)) {
      throw new BadRequestException('category must be "it" or "business"');
    }

    // Validate hours
    const hours = Number(body.hours);
    if (!Number.isInteger(hours) || hours <= 0) {
      throw new BadRequestException('hours must be a positive integer');
    }

    const loggedAt = parseLoggedAt(body.logged_at);
    await this.ensureProject(projectId, mg);

    const entry = timeEntryRepo.create({
      tenant_id: tenantId,
      project_id: projectId,
      category: body.category,
      user_id: body.user_id || userId || null,
      hours,
      notes: body.notes ? String(body.notes).trim() : null,
      logged_by_id: userId,
      logged_at: loggedAt,
    });

    const saved = await timeEntryRepo.save(entry);

    await this.audit.log(
      {
        table: 'portfolio_project_time_entries',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
      },
      { manager: mg },
    );

    // Recalculate actual effort
    await this.recalculateActualEffort(projectId, mg);
    await this.userTimeAggregateService.recalculateForEntryChange(null, saved, mg);

    return saved;
  }

  /**
   * Update a time entry.
   */
  async updateTimeEntry(
    entryId: string,
    body: {
      category?: TimeEntryCategory;
      user_id?: string;
      hours?: number;
      notes?: string;
      logged_at?: string;
    },
    userId: string | null,
    isAdmin: boolean,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const timeEntryRepo = mg.getRepository(PortfolioProjectTimeEntry);

    const entry = await timeEntryRepo.findOne({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Time entry not found');

    // Permission check: admin OR logger OR target user
    const canEdit =
      isAdmin
      || entry.logged_by_id === userId
      || (entry.user_id != null && entry.user_id === userId);
    if (!canEdit) {
      throw codedForbidden('TIME_ENTRY_EDIT_OWN_OR_ASSIGNED', 'You can only edit your own or assigned time entries');
    }

    const before = { ...entry };
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    if (has('category')) {
      if (!body.category || !['it', 'business'].includes(body.category)) {
        throw new BadRequestException('category must be "it" or "business"');
      }
      entry.category = body.category;
    }

    if (has('user_id')) {
      entry.user_id = body.user_id || null;
    }

    if (has('hours')) {
      const hours = Number(body.hours);
      if (!Number.isInteger(hours) || hours <= 0) {
        throw new BadRequestException('hours must be a positive integer');
      }
      entry.hours = hours;
    }

    if (has('notes')) {
      entry.notes = body.notes ? String(body.notes).trim() : null;
    }

    if (has('logged_at')) {
      entry.logged_at = parseLoggedAt(body.logged_at);
    }

    entry.updated_at = new Date();
    const saved = await timeEntryRepo.save(entry);

    await this.audit.log(
      {
        table: 'portfolio_project_time_entries',
        recordId: entryId,
        action: 'update',
        before,
        after: saved,
        userId,
      },
      { manager: mg },
    );

    // Recalculate actual effort
    await this.recalculateActualEffort(entry.project_id, mg);
    await this.userTimeAggregateService.recalculateForEntryChange(before, saved, mg);

    return saved;
  }

  /**
   * Delete a time entry.
   */
  async deleteTimeEntry(
    entryId: string,
    userId: string | null,
    isAdmin: boolean,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const timeEntryRepo = mg.getRepository(PortfolioProjectTimeEntry);

    const entry = await timeEntryRepo.findOne({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Time entry not found');

    // Permission check: admin OR logger OR target user
    const canDelete =
      isAdmin
      || entry.logged_by_id === userId
      || (entry.user_id != null && entry.user_id === userId);
    if (!canDelete) {
      throw codedForbidden('TIME_ENTRY_DELETE_OWN_OR_ASSIGNED', 'You can only delete your own or assigned time entries');
    }

    const projectId = entry.project_id;

    await timeEntryRepo.delete({ id: entryId });

    await this.audit.log(
      {
        table: 'portfolio_project_time_entries',
        recordId: entryId,
        action: 'delete',
        before: entry,
        after: null,
        userId,
      },
      { manager: mg },
    );

    // Recalculate actual effort
    await this.recalculateActualEffort(projectId, mg);
    await this.userTimeAggregateService.recalculateForEntryChange(entry, null, mg);

    return { ok: true };
  }

  /**
   * Recalculate actual effort IT/Business from time entries.
   * Converts hours to man-days (hours / 8), rounded to 1 decimal.
   */
  async recalculateActualEffort(
    projectId: string,
    mg: EntityManager,
  ) {
    const repo = mg.getRepository(PortfolioProject);

    // Sum hours by category from project time entries
    const projectTotals = await mg.query(
      `SELECT category, SUM(hours) as total_hours
       FROM portfolio_project_time_entries
       WHERE project_id = $1
       GROUP BY category`,
      [projectId]
    );

    // Sum hours by category from task time entries (tasks linked to this project)
    const taskTotals = await mg.query(
      `SELECT tte.category, SUM(tte.hours) as total_hours
       FROM task_time_entries tte
       JOIN tasks t ON tte.task_id = t.id
       WHERE t.related_object_type = 'project'
         AND t.related_object_id = $1
         AND t.tenant_id = app_current_tenant()
       GROUP BY tte.category`,
      [projectId]
    );

    let itHours = 0;
    let businessHours = 0;

    // Add project time entries
    for (const row of projectTotals) {
      if (row.category === 'it') {
        itHours += Number(row.total_hours) || 0;
      } else if (row.category === 'business') {
        businessHours += Number(row.total_hours) || 0;
      }
    }

    // Add task time entries
    for (const row of taskTotals) {
      if (row.category === 'it') {
        itHours += Number(row.total_hours) || 0;
      } else if (row.category === 'business') {
        businessHours += Number(row.total_hours) || 0;
      }
    }

    // Convert to man-days (8 hours per day), round to 1 decimal
    const actualEffortIt = Math.round((itHours / 8) * 10) / 10;
    const actualEffortBusiness = Math.round((businessHours / 8) * 10) / 10;

    await repo.update(
      { id: projectId },
      {
        actual_effort_it: actualEffortIt,
        actual_effort_business: actualEffortBusiness,
        updated_at: new Date(),
      }
    );
  }
}
