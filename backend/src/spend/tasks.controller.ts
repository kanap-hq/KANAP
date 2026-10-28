import { languageOf } from '../common/csv-sheet';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { moduleRightRequired } from '../auth/module-right-required';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { Public } from '../auth/public.decorator';
import { TaskLinkedScopes, TasksService } from './tasks.service';
import { TasksDeleteService } from '../tasks/tasks-delete.service';
import { TasksUnifiedService, RelatedType } from '../tasks/tasks-unified.service';
import { TaskActivitiesService, ActivityBodyDto } from '../tasks/task-activities.service';
import { TaskAttachmentsService } from '../tasks/task-attachments.service';
import { TaskTimeEntriesService } from '../tasks/task-time-entries.service';
import { TasksCsvService } from '../tasks/tasks-csv.service';
import { StorageService } from '../common/storage/storage.service';
import { resolveToUuid } from '../common/resolve-item-id';
import { LinkedReads, linkedReadsFromContext } from '../common/relations/linked-reads';
import { attachmentMulterOptions, csvImportMulterOptions, documentImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { csvExportFormat } from '../common/csv';
import { exportListQuery } from '../common/pagination';
import { csvExportBody } from '../common/csv/send-csv-export';
import { createRequestReleaseConnection } from '../common/import-connection';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { resolveInlineTenantSlug } from '../common/resolve-inline-tenant-slug';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { ShareRateLimit } from '../notifications/share-rate-limit';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { REFRESH_TOKEN_COOKIE_NAME, parseCookieValue } from '../auth/auth-cookie.util';
import { projectParticipantCondition, resolveBusinessContributorScope } from '../auth/business-contributor-scope';
import { PermissionLevel } from '../permissions/permissions.service';
import { PermissionsService } from '../permissions/permissions.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { incidentViewerFromRequest, resolveIncidentViewer, taskIncidentVisibilitySql } from '../incidents/incident-visibility';

/**
 * What a task may name of its linked records: the modules the caller reads, and a Business
 * Contributor's projects, requests and applications inside their participation.
 */
async function linkedOfRequest(req: any): Promise<{ linkedReads: LinkedReads; linkedScopes: TaskLinkedScopes }> {
  return {
    linkedReads: linkedReadsFromContext({ isAdmin: req?.isAdmin === true, permissions: req?.permissions }),
    linkedScopes: {
      projects: await resolveBusinessContributorScope(req, 'portfolio_projects', 'reader'),
      requests: await resolveBusinessContributorScope(req, 'portfolio_requests', 'reader'),
      applications: await resolveBusinessContributorScope(req, 'applications', 'reader'),
    },
  };
}

@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly svc: TasksService,
    private readonly deleteSvc: TasksDeleteService,
    private readonly unified: TasksUnifiedService,
    private readonly activitiesSvc: TaskActivitiesService,
    private readonly attachmentsSvc: TaskAttachmentsService,
    private readonly timeEntriesSvc: TaskTimeEntriesService,
    private readonly csvSvc: TasksCsvService,
    private readonly storage: StorageService,
    private readonly knowledge: KnowledgeService,
    private readonly dataSource: DataSource,
    private readonly perms: PermissionsService,
  ) {}

  private resolve(idOrRef: string, req: any): Promise<string> {
    return resolveToUuid(idOrRef, 'task', req.queryRunner.manager);
  }

  private taskAccessScope(req: any, level: PermissionLevel = 'reader') {
    return resolveBusinessContributorScope(req, 'tasks', level);
  }

  private async ensureTaskAccess(id: string, req: any, level: PermissionLevel = 'reader') {
    const accessScope = await this.taskAccessScope(req, level);
    await this.svc.assertVisible(id, accessScope, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
      viewer: incidentViewerFromRequest(req),
    });
    return accessScope;
  }

  private async hasPermission(req: any, resource: string, level: PermissionLevel): Promise<boolean> {
    if (req?.isAdmin === true) return true;
    const userId = String(req?.user?.sub || '').trim();
    if (!userId) return false;

    const manager = req?.queryRunner?.manager ?? this.dataSource.manager;
    // No tenant on the request: the predicates match nothing, so no role and no permission.
    const tenantId = req?.tenant?.id ?? null;
    const rows = await manager.query(
      `
        SELECT DISTINCT
          r.id::text AS role_id,
          LOWER(TRIM(r.role_name)) AS role_name
        FROM (
          SELECT u.role_id
          FROM users u
          WHERE u.id = $1
            AND u.tenant_id = $2::uuid
          UNION
          SELECT ur.role_id
          FROM user_roles ur
          WHERE ur.user_id = $1
            AND ur.tenant_id = $2::uuid
        ) assigned_roles
        JOIN roles r ON r.id = assigned_roles.role_id
        WHERE r.tenant_id = $2::uuid
      `,
      [userId, tenantId],
    );

    if (rows.some((row: { role_name?: string }) => row.role_name === 'administrator')) {
      return true;
    }

    const roleIds = rows.map((row: { role_id: string }) => row.role_id).filter(Boolean);
    if (roleIds.length === 0) return false;

    const rank: Record<PermissionLevel, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
    const effective = await this.perms.listForRoles(roleIds, { manager });
    const current = effective.get(resource);
    return current ? rank[current] >= rank[level] : false;
  }

  private async ensureProjectTargetAccess(projectId: string, req: any) {
    const canContribute = await this.hasPermission(req, 'portfolio_projects', 'contributor');
    if (!canContribute) {
      throw moduleRightRequired('portfolio_projects', 'contributor', 'Insufficient portfolio project permissions');
    }

    const accessScope = await resolveBusinessContributorScope(req, 'portfolio_projects', 'contributor');
    if (!accessScope) return;

    // No tenant on the request: the predicate matches nothing, so the move is refused.
    const tenantId = req?.tenant?.id ?? null;
    const rows = await req?.queryRunner?.manager.query(
      `SELECT 1
       FROM portfolio_projects p
       WHERE p.id = $1
         AND p.tenant_id = $3
         AND ${projectParticipantCondition('p', '$2')}
       LIMIT 1`,
      [projectId, accessScope.userId, tenantId],
    );
    if (!rows?.length) {
      throw new NotFoundException('Project not found');
    }
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get()
  async list(@Query() query: any, @Req() req: any) {
    const accessScope = await this.taskAccessScope(req, 'reader');
    return this.svc.listAllTasks(query, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
      accessScope,
      viewer: incidentViewerFromRequest(req),
      ...await linkedOfRequest(req),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get('ids')
  async listIds(@Query() query: any, @Req() req: any) {
    const accessScope = await this.taskAccessScope(req, 'reader');
    return this.svc.listIds(query, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
      accessScope,
      viewer: incidentViewerFromRequest(req),
      ...await linkedOfRequest(req),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get('filter-values')
  async listFilterValues(@Query() query: any, @Req() req: any) {
    const accessScope = await this.taskAccessScope(req, 'reader');
    return this.svc.listFilterValues(query, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
      accessScope,
      viewer: incidentViewerFromRequest(req),
      ...await linkedOfRequest(req),
    });
  }

  // ==================== CSV ====================

  /**
   * Get CSV field metadata - must be before :id route
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'admin')
  @Get('csv-fields')
  getCsvFields() {
    return this.csvSvc.getFieldInfo();
  }

  /**
   * Export tasks to CSV
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'admin')
  @Get('export')
  async exportCsv(
    @Query() query: Record<string, unknown>,
    @Query('language') languageRaw: string | undefined,
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('fields') fields: string | undefined,
    @Query('preset') preset: string | undefined,
    @Query('related_object_type') relatedObjectType: string | undefined,
    @Query('related_object_id') relatedObjectId: string | undefined,
    @Query('format') formatRaw: unknown,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const format = csvExportFormat(formatRaw, scope);
    const tenantId = req?.tenant?.id ?? '';
    // The screen's language (the user's own when the screen sends none), as every shared-layer file.
    const language = await languageOf(req?.queryRunner?.manager, tenantId, req.user?.sub ?? null, languageRaw);
    // `rows=list` (the dialog): the rows of the list, its filters, search, scope and sort, every page.
    const listQuery = scope === 'template' ? undefined : exportListQuery(query);
    const ids = listQuery
      ? (await this.svc.listIds({ ...listQuery, __export: true }, {
        manager: req?.queryRunner?.manager,
        tenantId: req?.tenant?.id,
        accessScope: await this.taskAccessScope(req, 'reader'),
        viewer: incidentViewerFromRequest(req),
        ...await linkedOfRequest(req),
      })).ids
      : undefined;
    const result = await this.csvSvc.export({
      ids,
      language,
      manager: req?.queryRunner?.manager,
      tenantId,
      scope,
      fields: fields ? fields.split(',').map((f) => f.trim()) : undefined,
      preset,
      relatedObjectType,
      relatedObjectId,
      viewer: incidentViewerFromRequest(req),
      format,
    });
    res.send(await csvExportBody(res, result));
  }

  /**
   * Import tasks from CSV. It updates existing tasks by their reference, whatever the person's
   * access: reserved to unscoped persons, like the supplier and contact imports (spec §2.7 of
   * planning/data-scoped-access).
   */
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRun: string = 'true',
    @Query('mode') mode: 'replace' | 'enrich' = 'enrich',
    @Query('operation') operation: 'upsert' | 'update_only' | 'insert_only' = 'upsert',
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.csvSvc.import(
      file,
      {
        dryRun: dryRun !== 'false',
        mode,
        operation,
      },
      {
        manager: req?.queryRunner?.manager,
        tenantId,
        userId: req.user?.sub,
        viewer: incidentViewerFromRequest(req),
      },
    );
  }

  // ==================== STANDALONE TASKS ====================

  /**
   * Create a standalone task (not linked to any project, contract, or spend item)
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Post('standalone')
  async createStandalone(@Body() body: any, @Req() req: any) {
    if (!body?.title || !body.title.toString().trim()) {
      throw new BadRequestException('title is required');
    }
    return this.unified.createForTarget(
      { type: null, id: null, payload: body },
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get(':id')
  async getOne(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolve(idOrRef, req);
    const accessScope = await this.taskAccessScope(req, 'reader');
    const res = await this.svc.getOne(id, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
      accessScope,
      viewer: incidentViewerFromRequest(req),
      ...await linkedOfRequest(req),
    });
    if (!res) {
      const { NotFoundException } = await import('@nestjs/common');
      throw new NotFoundException('Item not found');
    }
    return res;
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get(':id/knowledge')
  async listDocuments(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'reader');
    return this.knowledge.listDocumentsForEntity('tasks', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get(':id/knowledge-context')
  async getKnowledgeContext(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'reader');
    return this.knowledge.getKnowledgeContextForEntity('tasks', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  // What a delete of `ids` would refuse, asked before the confirmation.
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'admin')
  @Post('delete-check')
  deleteCheck(@Body() body: { ids?: unknown }, @Req() req: any) {
    return this.deleteSvc.deleteCheck(Array.isArray(body?.ids) ? body.ids : [], {
      manager: req?.queryRunner?.manager,
      viewer: incidentViewerFromRequest(req),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'admin')
  @Delete('bulk')
  async bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    return this.deleteSvc.bulkDelete(ids, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      viewer: incidentViewerFromRequest(req),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Patch(':id/move')
  async move(
    @Param('id') idOrRef: string,
    @Body() body: { related_object_type: 'spend_item' | 'contract' | 'capex_item' | 'project' | 'incident' | null; related_object_id: string | null },
    @Req() req: any,
  ) {
    const id = await this.resolve(idOrRef, req);
    const hasType = Object.prototype.hasOwnProperty.call(body ?? {}, 'related_object_type');
    const hasId = Object.prototype.hasOwnProperty.call(body ?? {}, 'related_object_id');
    if (!hasType || !hasId) {
      throw new BadRequestException('related_object_type and related_object_id are required');
    }

    const nextType = (body?.related_object_type ?? null) as RelatedType;
    const nextId = (body?.related_object_id ?? null) as string | null;
    const allowed: RelatedType[] = ['spend_item', 'contract', 'capex_item', 'project', 'incident', null];
    if (!allowed.includes(nextType)) {
      throw new BadRequestException('Invalid related_object_type');
    }
    if (nextType === null && nextId !== null) {
      throw new BadRequestException('related_object_id must be null when related_object_type is null');
    }
    if (nextType !== null && !nextId) {
      throw new BadRequestException('related_object_id is required when related_object_type is set');
    }

    await this.ensureTaskAccess(id, req, 'member');
    if (nextType === 'project' && nextId) {
      await this.ensureProjectTargetAccess(nextId, req);
    }
    return this.unified.moveTask(
      { id, next: { type: nextType, id: nextId } },
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id ?? '' },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Patch(':id')
  async updateTask(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'related_object_type') && body?.related_object_type === 'project') {
      throw new BadRequestException('Use /portfolio/projects/:projectId/tasks/:taskId to target a project');
    }
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'member');
    const tenantId = req?.tenant?.id ?? '';
    return this.unified.updateById(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager, tenantId });
  }

  // ==================== SHARE ====================

  @ShareRateLimit()
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Post(':id/share')
  async share(@Param('id') idOrRef: string, @Body() body: ShareItemDto, @Req() req: any) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'reader');
    const tenantId = req?.tenant?.id ?? '';
    return this.unified.share(id, body, tenantId, req.user?.sub ?? '', {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== TIME ENTRIES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get(':id/time-entries/sum')
  async getTimeSum(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'reader');
    const total = await this.timeEntriesSvc.sumForTask(id, { manager: req?.queryRunner?.manager });
    return { total };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get(':id/time-entries')
  async listTimeEntries(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'reader');
    return this.timeEntriesSvc.listForTask(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Post(':id/time-entries')
  async createTimeEntry(
    @Param('id') idOrRef: string,
    @Body() body: { user_id?: string; hours: number; notes?: string; logged_at: string; category?: 'it' | 'business' },
    @Req() req: any,
  ) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'member');
    const isAdmin = req?.isAdmin === true;
    return this.timeEntriesSvc.create(
      id,
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
  @RequireLevel('tasks', 'member')
  @Patch(':id/time-entries/:entryId')
  async updateTimeEntry(
    @Param('id') idOrRef: string,
    @Param('entryId') entryId: string,
    @Body() body: { user_id?: string; hours?: number; notes?: string; logged_at?: string; category?: 'it' | 'business' },
    @Req() req: any,
  ) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'member');
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
  @RequireLevel('tasks', 'member')
  @Delete(':id/time-entries/:entryId')
  async deleteTimeEntry(
    @Param('id') idOrRef: string,
    @Param('entryId') entryId: string,
    @Req() req: any,
  ) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'member');
    await this.timeEntriesSvc.delete(entryId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      isAdmin: req?.isAdmin === true,
    });
    return { success: true };
  }

  // ==================== ACTIVITIES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get(':id/activities')
  async listActivities(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'reader');
    return this.activitiesSvc.listForTask(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Post(':id/activities')
  async createActivity(
    @Param('id') idOrRef: string,
    @Body() body: ActivityBodyDto,
    @Req() req: any,
  ) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'member');
    const tenantId = req?.tenant?.id ?? '';
    if (body.type === 'unified') {
      return this.activitiesSvc.createUnified(id, body, tenantId, req.user?.sub ?? null, {
        manager: req?.queryRunner?.manager,
        isAdmin: req?.isAdmin === true,
      });
    }
    return this.activitiesSvc.create(id, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Patch(':id/activities/:activityId')
  async updateActivity(
    @Param('id') idOrRef: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() body: { content: string },
    @Req() req: any,
  ) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'member');
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User ID required');
    }
    return this.activitiesSvc.updateComment(id, activityId, body?.content ?? '', userId, {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== ATTACHMENTS ====================

  // Inline view for embedded images
  // No JWT auth required, but tenant ownership is validated via URL parameter
  @Public()
  @Get('attachments/:tenantSlug/:attachmentId/inline')
  async viewAttachmentInline(
    @Param('tenantSlug') tenantSlug: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    // Look up tenant by slug and set app.current_tenant for RLS
    // This validates tenant ownership while satisfying RLS policies
    // Private + Vary:Cookie on every response (incl. 404) so no shared cache serves
    // tenant bytes and denials aren't cached across sessions.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Vary', 'Cookie');
    const refreshToken = parseCookieValue(req?.headers?.cookie as string | undefined, REFRESH_TOKEN_COOKIE_NAME);
    const effectiveSlug = resolveInlineTenantSlug(tenantSlug);
    const dataSource = this.attachmentsSvc['repo'].manager.connection;
    const runner = dataSource.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      // First get tenant ID from slug (tenants table typically has no RLS)
      const tenantRows = await runner.query(
        `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
        [effectiveSlug],
      );
      if (!tenantRows.length) {
        await runner.rollbackTransaction();
        res.status(404).send('Tenant not found');
        return;
      }
      const tenantId = tenantRows[0].id;
      // Set the tenant context for RLS (parameterized to prevent SQL injection)
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      // Require the caller to be an authenticated tenant user with >= reader on tasks; the
      // attachment is then read under the person's data access (spec §6.3).
      const userId = await this.knowledge.inlineAttachmentViewer(
        runner.manager, tenantId, refreshToken, 'tasks', { applyDataAccess: true },
      );
      // Only embedded images (source_field set) are served on this inline route, and
      // only when the image's task is not one of a restricted incident this person cannot see.
      const params: unknown[] = [tenantId, attachmentId];
      const incidentViewer = userId ? await resolveIncidentViewer(runner.manager, userId, tenantId) : null;
      const taskVisibility = userId ? taskIncidentVisibilitySql('t', incidentViewer, params) : '';
      const rows = userId
        ? await runner.query(
          `SELECT ta.storage_path, ta.mime_type, ta.size
           FROM task_attachments ta
           JOIN tasks t ON t.id = ta.task_id AND t.tenant_id = ta.tenant_id
           WHERE ta.tenant_id = $1
             AND ta.id = $2
             AND ta.source_field IS NOT NULL
             ${taskVisibility}
           LIMIT 1`,
          params,
        )
        : [];
      if (!rows.length) {
        await runner.rollbackTransaction();
        res.status(404).send('Attachment not found');
        return;
      }
      await runner.commitTransaction();
      const obj = await this.storage.getObjectStream(rows[0].storage_path);
      res.setHeader('Content-Type', obj.contentType || rows[0].mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', contentDisposition('', 'inline'));
      const contentLength = obj.contentLength ?? rows[0].size ?? null;
      if (contentLength != null) res.setHeader('Content-Length', String(contentLength));
      obj.stream.pipe(res);
    } catch (err) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      throw err;
    } finally {
      await runner.release();
    }
  }

  // Download must be before :id to avoid route conflicts
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const meta = await this.attachmentsSvc.getAttachment(attachmentId, { manager: req?.queryRunner?.manager });
    await this.ensureTaskAccess(meta.task_id, req, 'reader');
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) res.setHeader('Content-Length', String(obj.contentLength));
    obj.stream.pipe(res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Patch('attachments/:attachmentId/delete')
  async deleteAttachmentStatic(
    @Param('attachmentId') attachmentId: string,
    @Req() req: any,
  ) {
    const meta = await this.attachmentsSvc.getAttachment(attachmentId, { manager: req?.queryRunner?.manager });
    await this.ensureTaskAccess(meta.task_id, req, 'member');
    return this.attachmentsSvc.deleteAttachment(attachmentId, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get(':id/attachments')
  async listAttachments(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'reader');
    return this.attachmentsSvc.listAttachments(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  async uploadAttachment(
    @Param('id') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { source_field?: string },
    @Req() req: any,
  ) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'member');
    return this.attachmentsSvc.uploadAttachment(id, file, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      sourceField: body?.source_field || null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Post(':id/attachments/inline/import')
  async importInlineAttachment(
    @Param('id') idOrRef: string,
    @Body() body: { source_field?: string; source_url?: string },
    @Req() req: any,
  ) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'member');
    return this.attachmentsSvc.importInlineAttachmentFromUrl(id, body?.source_url || '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      sourceField: body?.source_field || null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.documentImport })
  @Post(':id/import')
  @UseInterceptors(FileInterceptor('file', documentImportMulterOptions))
  async importDocument(
    @Param('id') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const id = await this.resolve(idOrRef, req);
    await this.ensureTaskAccess(id, req, 'member');
    return this.attachmentsSvc.importDocument(id, file, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      releaseConnection: createRequestReleaseConnection(req, this.dataSource, req?.tenant?.id ?? ''),
      sourceField: 'description',
    });
  }
}
