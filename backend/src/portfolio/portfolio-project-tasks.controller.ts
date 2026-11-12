import {
  BadRequestException, Body, NotFoundException, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';
import { TasksDeleteService } from '../tasks/tasks-delete.service';
import { cancelTaskCreation, readTaskCreationChanges } from '../tasks/task-creation';
import { creationContextOf, withCreationToken } from '../common/creation/creation-routes';
import type { CreationChanges } from '../common/creation/creation-changes';
import { TaskTimeEntriesService } from '../tasks/task-time-entries.service';
import { TaskActivitiesService, ActivityBodyDto } from '../tasks/task-activities.service';
import { Task } from '../tasks/task.entity';
import { TaskTimeEntryCategory } from '../tasks/task-time-entry.entity';
import { resolveToUuid } from '../common/resolve-item-id';
import { PortfolioProjectsService } from './services';
import { resolveBusinessContributorScope } from '../auth/business-contributor-scope';
import { PermissionLevel } from '../permissions/permissions.service';

@UseGuards(JwtAuthGuard)
@Controller('portfolio/projects/:projectId/tasks')
export class PortfolioProjectTasksController {
  constructor(
    private readonly tasksSvc: TasksUnifiedService,
    private readonly timeEntriesSvc: TaskTimeEntriesService,
    private readonly activitiesSvc: TaskActivitiesService,
    private readonly projectsSvc: PortfolioProjectsService,
    private readonly deleteSvc: TasksDeleteService,
  ) {}

  private resolveProjectId(idOrRef: string, req: any): Promise<string> {
    return resolveToUuid(idOrRef, 'project', req?.queryRunner?.manager);
  }

  private resolveTaskId(idOrRef: string, req: any): Promise<string> {
    return resolveToUuid(idOrRef, 'task', req?.queryRunner?.manager);
  }

  private projectAccessScope(req: any, level: PermissionLevel = 'reader') {
    return resolveBusinessContributorScope(req, 'portfolio_projects', level);
  }

  private async resolveProjectForAccess(idOrRef: string, req: any, level: PermissionLevel = 'reader') {
    const projectId = await this.resolveProjectId(idOrRef, req);
    const accessScope = await this.projectAccessScope(req, level);
    await this.projectsSvc.assertVisible(projectId, accessScope, { manager: req?.queryRunner?.manager });
    return projectId;
  }

  private async resolveProjectTaskForAccess(
    projectId: string,
    taskIdOrRef: string,
    req: any,
  ) {
    const taskId = await this.resolveTaskId(taskIdOrRef, req);
    const rows = await req?.queryRunner?.manager.query(
      `SELECT 1
       FROM tasks
       WHERE id = $1
         AND related_object_type = 'project'
         AND related_object_id = $2
       LIMIT 1`,
      [taskId, projectId],
    );
    if (!rows?.length) {
      throw new BadRequestException('Task does not belong to this project');
    }
    return taskId;
  }

  // ==================== TASKS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get()
  async listTasks(@Param('projectId') projectIdOrRef: string, @Req() req: any) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'reader');
    const tasks = await this.tasksSvc.listForTarget(
      { type: 'project', id: projectId },
      { manager: req?.queryRunner?.manager },
    );
    return this.enrichAssigneeNames(tasks, req?.queryRunner?.manager);
  }

  // Attach a display name for each task's assignee so the timeline can render it
  // without an extra round-trip. Batched by user id (no N+1) and tenant-scoped.
  private async enrichAssigneeNames(tasks: any[], manager: any) {
    const ids = [...new Set((tasks || []).map((task) => task.assignee_user_id).filter(Boolean))];
    if (ids.length === 0) {
      return (tasks || []).map((task) => ({ ...task, assignee_name: null }));
    }
    const rows = await manager.query(
      `SELECT id,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))), ''), email) AS assignee_name
       FROM users
       WHERE tenant_id = app_current_tenant()
         AND id = ANY($1)`,
      [ids],
    );
    const nameById = new Map((rows as Array<{ id: string; assignee_name: string }>).map((row) => [row.id, row.assignee_name]));
    return (tasks || []).map((task) => ({
      ...task,
      assignee_name: task.assignee_user_id ? nameById.get(task.assignee_user_id) ?? null : null,
    }));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('status-summary')
  async getTaskStatusSummary(@Param('projectId') projectIdOrRef: string, @Req() req: any) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'reader');
    const rows = await req?.queryRunner?.manager.query(
      `SELECT status, COUNT(*)::int AS count
       FROM tasks
       WHERE tenant_id = app_current_tenant()
         AND related_object_type = 'project'
         AND related_object_id = $1
       GROUP BY status`,
      [projectId],
    );

    const counts = Object.fromEntries(
      (Array.isArray(rows) ? rows : []).map((row: { status: string; count: number | string }) => [
        row.status,
        Number(row.count) || 0,
      ]),
    );

    return {
      total: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0),
      open: counts.open || 0,
      in_progress: counts.in_progress || 0,
      pending: counts.pending || 0,
      in_testing: counts.in_testing || 0,
      done: counts.done || 0,
      cancelled: counts.cancelled || 0,
    };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post()
  async createTask(
    @Param('projectId') projectIdOrRef: string,
    @Body() body: Partial<Task>,
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'contributor');
    const created = await this.tasksSvc.createForTarget(
      { type: 'project', id: projectId, payload: body },
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id },
    );
    // The token of "Cancel" of a task being created (`tasks/task-creation.ts`).
    return withCreationToken('tasks', created, creationContextOf(req));
  }

  // ==================== PROJECT TIME SUMMARY ====================
  // NOTE: Must be defined before :taskId routes to avoid being captured as taskId

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('time-summary')
  async getProjectTimeSummary(@Param('projectId') projectIdOrRef: string, @Req() req: any) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'reader');
    const byCategory = await this.timeEntriesSvc.sumForProjectByCategory(projectId, { manager: req?.queryRunner?.manager });
    return {
      it_hours: byCategory.it,
      business_hours: byCategory.business,
      total_hours: byCategory.it + byCategory.business,
    };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('time-entries')
  async getProjectTaskTimeEntries(@Param('projectId') projectIdOrRef: string, @Req() req: any) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'reader');
    return this.timeEntriesSvc.listForProject(projectId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Patch(':taskId')
  async updateTask(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskIdOrRef: string,
    @Body() body: Partial<Task>,
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'contributor');
    const taskId = await this.resolveProjectTaskForAccess(projectId, taskIdOrRef, req);
    const tenantId = req?.tenant?.id ?? '';
    return this.tasksSvc.updateById(
      taskId,
      {
        ...body,
        related_object_type: 'project',
        related_object_id: projectId,
      },
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager, tenantId },
    );
  }

  /**
   * Before "Cancel" of a project task being created, at the right that created it: what was
   * written on it since its creation (`tasks/task-creation.ts`). Token first, then the project and
   * the task's place in it. Nothing is written.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Get(':taskId/creation')
  async creationChanges(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskId: string,
    @Query('token') token: string,
    @Req() req: any,
  ): Promise<{ changes: CreationChanges }> {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'contributor');
    await this.resolveProjectTaskForAccess(projectId, taskId, req);
    return readTaskCreationChanges(taskId, token, creationContextOf(req));
  }

  /**
   * "Cancel" of a project task being created: its creator deletes it with its token, at the right
   * that created it (portfolio_projects contributor), the task of this project only. Same delete as
   * `DELETE /tasks/bulk` for one task.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Delete(':taskId/creation')
  async cancelCreation(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskId: string,
    @Body() body: { token?: string },
    @Req() req: any,
  ): Promise<void> {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'contributor');
    await this.resolveProjectTaskForAccess(projectId, taskId, req);
    await cancelTaskCreation(this.deleteSvc, taskId, body?.token, creationContextOf(req));
  }

  // ==================== TIME ENTRIES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':taskId/time-entries')
  async listTimeEntries(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskIdOrRef: string,
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'reader');
    const taskId = await this.resolveProjectTaskForAccess(projectId, taskIdOrRef, req);
    return this.timeEntriesSvc.listForTask(taskId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':taskId/time-entries')
  async createTimeEntry(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskIdOrRef: string,
    @Body() body: { user_id?: string; hours: number; notes?: string; logged_at: string; category?: TaskTimeEntryCategory },
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'contributor');
    const taskId = await this.resolveProjectTaskForAccess(projectId, taskIdOrRef, req);
    const isAdmin = req?.isAdmin === true;
    return this.timeEntriesSvc.create(
      taskId,
      {
        user_id: body.user_id,
        hours: body.hours,
        notes: body.notes,
        logged_at: new Date(body.logged_at),
        category: body.category,
      },
      req.user?.sub ?? null,
      isAdmin,
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Patch(':taskId/time-entries/:entryId')
  async updateTimeEntry(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskIdOrRef: string,
    @Param('entryId') entryId: string,
    @Body() body: { user_id?: string; hours?: number; notes?: string; logged_at?: string; category?: TaskTimeEntryCategory },
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'contributor');
    const taskId = await this.resolveProjectTaskForAccess(projectId, taskIdOrRef, req);
    // An entry of the task of the address: one of another task is not found.
    const entryTaskId = await this.timeEntriesSvc.getTaskIdForEntry(entryId, { manager: req?.queryRunner?.manager });
    if (entryTaskId !== taskId) {
      throw new NotFoundException('Time entry not found');
    }

    const isAdmin = req?.isAdmin === true;
    return this.timeEntriesSvc.update(
      entryId,
      {
        user_id: body.user_id,
        hours: body.hours,
        notes: body.notes,
        logged_at: body.logged_at ? new Date(body.logged_at) : undefined,
        category: body.category,
      },
      req.user?.sub ?? null,
      isAdmin,
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Delete(':taskId/time-entries/:entryId')
  async deleteTimeEntry(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskIdOrRef: string,
    @Param('entryId') entryId: string,
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'contributor');
    const taskId = await this.resolveProjectTaskForAccess(projectId, taskIdOrRef, req);
    // An entry of the task of the address: one of another task is not found.
    const entryTaskId = await this.timeEntriesSvc.getTaskIdForEntry(entryId, { manager: req?.queryRunner?.manager });
    if (entryTaskId !== taskId) {
      throw new NotFoundException('Time entry not found');
    }

    await this.timeEntriesSvc.delete(entryId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      isAdmin: req?.isAdmin === true,
    });
    return { success: true };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':taskId/time-entries/sum')
  async getTimeSum(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskIdOrRef: string,
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'reader');
    const taskId = await this.resolveProjectTaskForAccess(projectId, taskIdOrRef, req);
    const total = await this.timeEntriesSvc.sumForTask(taskId, { manager: req?.queryRunner?.manager });
    return { total };
  }

  // ==================== ACTIVITIES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':taskId/activities')
  async listActivities(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskIdOrRef: string,
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'reader');
    const taskId = await this.resolveProjectTaskForAccess(projectId, taskIdOrRef, req);
    return this.activitiesSvc.listForTask(taskId, { manager: req?.queryRunner?.manager, userId: req?.user?.sub ?? null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':taskId/activities')
  async createActivity(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskIdOrRef: string,
    @Body() body: ActivityBodyDto,
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'contributor');
    const taskId = await this.resolveProjectTaskForAccess(projectId, taskIdOrRef, req);
    const tenantId = req?.tenant?.id ?? '';
    if (body.type === 'unified') {
      return this.activitiesSvc.createUnified(taskId, body, tenantId, req.user?.sub ?? null, {
        manager: req?.queryRunner?.manager,
        isAdmin: req?.isAdmin === true,
      });
    }
    return this.activitiesSvc.create(taskId, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Patch(':taskId/activities/:activityId')
  async updateActivity(
    @Param('projectId') projectIdOrRef: string,
    @Param('taskId') taskIdOrRef: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() body: { content: string },
    @Req() req: any,
  ) {
    const projectId = await this.resolveProjectForAccess(projectIdOrRef, req, 'contributor');
    const taskId = await this.resolveProjectTaskForAccess(projectId, taskIdOrRef, req);
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User ID required');
    }
    return this.activitiesSvc.updateComment(taskId, activityId, body?.content ?? '', userId, {
      manager: req?.queryRunner?.manager,
    });
  }
}
