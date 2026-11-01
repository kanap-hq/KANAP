import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { codedForbidden } from '../auth/module-right-required';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { TaskTimeEntry, TaskTimeEntryCategory } from './task-time-entry.entity';
import { Task } from './task.entity';
import { AuditService } from '../audit/audit.service';
import { PortfolioProjectsService } from '../portfolio/services';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';
import { assertTaskModifiable } from './task-data-access';

export interface CreateTimeEntryDto {
  user_id?: string | null;
  hours: number;
  notes?: string | null;
  logged_at: Date;
  category?: TaskTimeEntryCategory;
}

export interface UpdateTimeEntryDto {
  user_id?: string | null;
  hours?: number;
  notes?: string | null;
  logged_at?: Date;
  category?: TaskTimeEntryCategory;
}

@Injectable()
export class TaskTimeEntriesService {
  constructor(
    @InjectRepository(TaskTimeEntry) private readonly repo: Repository<TaskTimeEntry>,
    @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => PortfolioProjectsService))
    private readonly portfolioProjectsService: PortfolioProjectsService,
    @Inject(forwardRef(() => UserTimeAggregateService))
    private readonly userTimeAggregateService: UserTimeAggregateService,
  ) {}

  async listForTask(taskId: string, opts?: { manager?: EntityManager }): Promise<any[]> {
    const manager = opts?.manager ?? this.repo.manager;
    const result = await manager.query(
      `SELECT tte.*,
              u.email as user_email, u.first_name as user_first_name, u.last_name as user_last_name,
              lb.email as logged_by_email, lb.first_name as logged_by_first_name, lb.last_name as logged_by_last_name
       FROM task_time_entries tte
       LEFT JOIN users u ON u.id = tte.user_id
       LEFT JOIN users lb ON lb.id = tte.logged_by_id
       WHERE tte.task_id = $1
       ORDER BY tte.logged_at DESC`,
      [taskId],
    );

    return result.map((row: any) => ({
      ...row,
      user_name: [row.user_first_name, row.user_last_name].filter(Boolean).join(' ').trim() || null,
      logged_by_name: [row.logged_by_first_name, row.logged_by_last_name].filter(Boolean).join(' ').trim() || null,
    }));
  }

  async sumForTask(taskId: string, opts?: { manager?: EntityManager }): Promise<number> {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(TaskTimeEntry);
    const result = await repo
      .createQueryBuilder('tte')
      .select('SUM(tte.hours)', 'total')
      .where('tte.task_id = :taskId', { taskId })
      .getRawOne();
    return parseFloat(result?.total) || 0;
  }

  async sumForProject(projectId: string, opts?: { manager?: EntityManager }): Promise<number> {
    const manager = opts?.manager ?? this.repo.manager;
    const result = await manager.query(
      `SELECT COALESCE(SUM(tte.hours), 0)::numeric AS total
       FROM task_time_entries tte
       JOIN tasks t ON tte.task_id = t.id
       WHERE t.related_object_type = 'project'
         AND t.related_object_id = $1
         AND t.tenant_id = app_current_tenant()`,
      [projectId],
    );
    return parseFloat(result?.[0]?.total) || 0;
  }

  async sumForProjectByCategory(
    projectId: string,
    opts?: { manager?: EntityManager },
  ): Promise<{ it: number; business: number }> {
    const manager = opts?.manager ?? this.repo.manager;
    const result = await manager.query(
      `SELECT tte.category, COALESCE(SUM(tte.hours), 0)::numeric AS total
       FROM task_time_entries tte
       JOIN tasks t ON tte.task_id = t.id
       WHERE t.related_object_type = 'project'
         AND t.related_object_id = $1
         AND t.tenant_id = app_current_tenant()
       GROUP BY tte.category`,
      [projectId],
    );
    let it = 0;
    let business = 0;
    for (const row of result) {
      if (row.category === 'it') {
        it = parseFloat(row.total) || 0;
      } else if (row.category === 'business') {
        business = parseFloat(row.total) || 0;
      }
    }
    return { it, business };
  }

  async listForProject(projectId: string, opts?: { manager?: EntityManager }): Promise<any[]> {
    const manager = opts?.manager ?? this.repo.manager;
    const result = await manager.query(
      `SELECT tte.*,
              t.title as task_title,
              u.email as user_email, u.first_name as user_first_name, u.last_name as user_last_name,
              lb.email as logged_by_email, lb.first_name as logged_by_first_name, lb.last_name as logged_by_last_name
       FROM task_time_entries tte
       JOIN tasks t ON tte.task_id = t.id
       LEFT JOIN users u ON u.id = tte.user_id
       LEFT JOIN users lb ON lb.id = tte.logged_by_id
       WHERE t.related_object_type = 'project'
         AND t.related_object_id = $1
         AND t.tenant_id = app_current_tenant()
       ORDER BY tte.logged_at DESC`,
      [projectId],
    );
    return result;
  }

  async getProjectIdForTask(taskId: string, opts?: { manager?: EntityManager }): Promise<string | null> {
    const manager = opts?.manager ?? this.repo.manager;
    const task = await manager.getRepository(Task).findOne({
      where: { id: taskId },
      select: ['related_object_type', 'related_object_id'],
    });
    if (task?.related_object_type === 'project' && task?.related_object_id) {
      return task.related_object_id;
    }
    return null;
  }

  async create(
    taskId: string,
    dto: CreateTimeEntryDto,
    userId?: string,
    isAdmin = false,
    opts?: { manager?: EntityManager },
  ): Promise<TaskTimeEntry> {
    const manager = opts?.manager ?? this.repo.manager;
    const taskRepo = manager.getRepository(Task);
    const repo = manager.getRepository(TaskTimeEntry);

    // Verify task exists
    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');

    const hours = Number(dto.hours);
    if (!Number.isInteger(hours) || hours <= 0) {
      throw new BadRequestException('hours must be a positive integer');
    }

    // Validate category if provided
    const category = dto.category || 'it';
    if (!['it', 'business'].includes(category)) {
      throw new BadRequestException('category must be "it" or "business"');
    }

    const targetUserId = dto.user_id ?? userId ?? null;
    if (!isAdmin && (!userId || targetUserId !== userId)) {
      throw codedForbidden('TIME_ENTRY_CREATE_SELF_ONLY', 'You can only create time entries for yourself');
    }
    await assertTaskModifiable(manager, taskId);

    const entity = repo.create({
      task_id: taskId,
      user_id: targetUserId,
      hours,
      category,
      notes: dto.notes ?? null,
      logged_by_id: userId ?? null,
      logged_at: dto.logged_at,
    });

    const saved = await repo.save(entity);
    await this.audit.log(
      { table: 'task_time_entries', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager },
    );

    // Trigger project effort recalculation if task belongs to a project
    if (task.related_object_type === 'project' && task.related_object_id) {
      await this.portfolioProjectsService.recalculateActualEffort(task.related_object_id, manager);
    }
    await this.userTimeAggregateService.recalculateForEntryChange(null, saved, manager);

    return saved;
  }

  async update(
    entryId: string,
    dto: UpdateTimeEntryDto,
    userId?: string,
    isAdmin = false,
    opts?: { manager?: EntityManager },
  ): Promise<TaskTimeEntry> {
    const manager = opts?.manager ?? this.repo.manager;
    const repo = manager.getRepository(TaskTimeEntry);

    const existing = await repo.findOne({ where: { id: entryId } });
    if (!existing) throw new NotFoundException('Time entry not found');

    if (!isAdmin) {
      if (!userId || existing.user_id !== userId) {
        throw codedForbidden('TIME_ENTRY_EDIT_OWN_ONLY', 'You can only edit your own time entries');
      }
      if (dto.user_id !== undefined && dto.user_id !== userId) {
        throw codedForbidden('TIME_ENTRY_EDIT_OWN_ONLY', 'You can only edit your own time entries');
      }
    }

    const normalizedHours = dto.hours !== undefined ? Number(dto.hours) : undefined;
    if (normalizedHours !== undefined && (!Number.isInteger(normalizedHours) || normalizedHours <= 0)) {
      throw new BadRequestException('hours must be a positive integer');
    }

    // Validate category if provided
    if (dto.category !== undefined && !['it', 'business'].includes(dto.category)) {
      throw new BadRequestException('category must be "it" or "business"');
    }
    await assertTaskModifiable(manager, existing.task_id);

    const next = {
      ...existing,
      ...(dto.user_id !== undefined && { user_id: dto.user_id }),
      ...(normalizedHours !== undefined && { hours: normalizedHours }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      ...(dto.logged_at !== undefined && { logged_at: dto.logged_at }),
      ...(dto.category !== undefined && { category: dto.category }),
    };

    const saved = await repo.save(next);
    await this.audit.log(
      { table: 'task_time_entries', recordId: saved.id, action: 'update', before: existing, after: saved, userId },
      { manager },
    );

    // Trigger project effort recalculation if task belongs to a project
    const projectId = await this.getProjectIdForTask(existing.task_id, { manager });
    if (projectId) {
      await this.portfolioProjectsService.recalculateActualEffort(projectId, manager);
    }
    await this.userTimeAggregateService.recalculateForEntryChange(existing, saved, manager);

    return saved;
  }

  async delete(
    entryId: string,
    userId?: string,
    opts?: { manager?: EntityManager; isAdmin?: boolean },
  ): Promise<void> {
    const manager = opts?.manager ?? this.repo.manager;
    const repo = manager.getRepository(TaskTimeEntry);

    const existing = await repo.findOne({ where: { id: entryId } });
    if (!existing) throw new NotFoundException('Time entry not found');

    const isAdmin = opts?.isAdmin ?? false;
    if (!isAdmin && (!userId || existing.user_id !== userId)) {
      throw codedForbidden('TIME_ENTRY_DELETE_OWN_ONLY', 'You can only delete your own time entries');
    }
    await assertTaskModifiable(manager, existing.task_id);

    // Get project ID before deleting
    const projectId = await this.getProjectIdForTask(existing.task_id, { manager });

    await repo.delete(entryId);
    await this.audit.log(
      { table: 'task_time_entries', recordId: entryId, action: 'delete', before: existing, after: null, userId },
      { manager },
    );

    // Trigger project effort recalculation if task belongs to a project
    if (projectId) {
      await this.portfolioProjectsService.recalculateActualEffort(projectId, manager);
    }
    await this.userTimeAggregateService.recalculateForEntryChange(existing, null, manager);
  }

  async getTaskIdForEntry(entryId: string, opts?: { manager?: EntityManager }): Promise<string | null> {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(TaskTimeEntry);
    const entry = await repo.findOne({ where: { id: entryId }, select: ['task_id'] });
    return entry?.task_id ?? null;
  }
}
