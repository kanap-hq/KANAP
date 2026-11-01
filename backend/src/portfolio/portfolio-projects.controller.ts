import { languageOf } from '../common/csv-sheet';
import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { moduleRightRequired, requestContextMissing } from '../auth/module-right-required';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Public } from '../auth/public.decorator';
import { PortfolioProjectsService } from './services';
import { PortfolioProjectsCsvService } from './portfolio-projects-csv.service';
import { StorageService } from '../common/storage/storage.service';
import { resolveToUuid } from '../common/resolve-item-id';
import { attachmentMulterOptions, csvImportMulterOptions, documentImportMulterOptions, inlineImageMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { csvExportFormat } from '../common/csv';
import { exportListQuery } from '../common/pagination';
import { csvExportBody } from '../common/csv/send-csv-export';
import { createRequestReleaseConnection } from '../common/import-connection';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitGuard } from '../common/rate-limit.guard';
import {
  CreateProjectInput,
  UpdateProjectInput,
  ListProjectsQueryInput,
  ReorderPhasesDto,
} from './dto';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { ShareRateLimit } from '../notifications/share-rate-limit';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { REFRESH_TOKEN_COOKIE_NAME, parseCookieValue } from '../auth/auth-cookie.util';
import { resolveBusinessContributorScopeForUser } from '../auth/business-contributor-scope';
import { PermissionLevel } from '../permissions/permissions.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { buildRelationsAccess, hasLevel } from '../common/relations/relations-access';
import { linkedReadsFromContext } from '../common/relations/linked-reads';
import { assertApplicationsInScope, idsInScope, PortfolioLinkedReads } from './portfolio-linked-reads';
import {
  PortfolioRelationsService,
  PROJECT_RELATION_READS,
  projectRelationKindOrThrow,
} from './portfolio-relations.service';

/**
 * The fields the screens let a contributor change: the purpose (project page), the planned dates
 * (the Gantt of the planning page) and the scheduling mode (its roadmap). Every other field needs
 * `member` (`canManage` on the project page).
 */
const CONTRIBUTOR_PROJECT_FIELDS = new Set(['purpose', 'planned_start', 'planned_end', 'scheduling_mode']);

/** 403 naming the fields a contributor sent that the project page keeps for members. */
function assertContributorProjectFields(ctx: TenantRequest, body: Record<string, unknown>): void {
  if (hasLevel(ctx, 'portfolio_projects', 'member')) return;
  const refused = Object.keys(body ?? {}).filter((key) => !CONTRIBUTOR_PROJECT_FIELDS.has(key));
  if (refused.length > 0) {
    throw moduleRightRequired(
      'portfolio_projects',
      'member',
      `Changing ${refused.join(', ')} needs the member level on projects. A contributor can change the purpose, the planned dates and the scheduling mode.`,
    );
  }
}

// `access=contributor` narrows the list to the projects the user may write to (time entries).
function listAccessLevel(query: ListProjectsQueryInput): PermissionLevel {
  return query?.access === 'contributor' ? 'contributor' : 'reader';
}

@UseGuards(JwtAuthGuard)
@Controller('portfolio/projects')
export class PortfolioProjectsController {
  constructor(
    private readonly svc: PortfolioProjectsService,
    private readonly csvSvc: PortfolioProjectsCsvService,
    private readonly storage: StorageService,
    private readonly knowledge: KnowledgeService,
    private readonly integratedDocuments: IntegratedDocumentsService,
    private readonly dataSource: DataSource,
    private readonly relations: PortfolioRelationsService,
  ) {}

  /**
   * The tenant-bound manager for this request. `TenantInitGuard` creates the query runner for every
   * non-public tenant route, so a missing manager means the request has no tenant context.
   */
  private requireManager(ctx: TenantRequest): EntityManager {
    if (!ctx.manager) {
      throw requestContextMissing('Tenant context is not available');
    }
    return ctx.manager;
  }

  private resolve(idOrRef: string, ctx: TenantRequest): Promise<string> {
    return resolveToUuid(idOrRef, 'project', this.requireManager(ctx));
  }

  private projectAccessScope(ctx: TenantRequest, level: PermissionLevel = 'reader') {
    return resolveBusinessContributorScopeForUser({
      manager: ctx.manager!,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    }, 'portfolio_projects', level);
  }

  private async resolveForAccess(
    idOrRef: string,
    ctx: TenantRequest,
    level: PermissionLevel = 'reader',
  ) {
    const id = await this.resolve(idOrRef, ctx);
    const accessScope = await this.projectAccessScope(ctx, level);
    await this.svc.assertVisible(id, accessScope, { manager: ctx.manager });
    return { id, accessScope };
  }

  /**
   * What the Relations tab may show. One query after the other: the request's connection runs them
   * in turn. A Business Contributor's scope hides an application or a source request they do not
   * take part in.
   */
  private async projectRelationsContext(ctx: TenantRequest) {
    const manager = this.requireManager(ctx);
    const who = { manager, userId: ctx.userId, tenantId: ctx.tenantId };
    const { access } = buildRelationsAccess(ctx, { read: PROJECT_RELATION_READS });
    const applicationScope = await resolveBusinessContributorScopeForUser(who, 'applications', 'reader');
    const requestScope = await resolveBusinessContributorScopeForUser(who, 'portfolio_requests', 'reader');
    return {
      manager,
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      access,
      applicationScope,
      requestScope,
    };
  }

  /** What the project detail may name of other portfolio records (`include=source_requests`). */
  private async projectLinkedReads(ctx: TenantRequest): Promise<PortfolioLinkedReads> {
    const { requestScope } = await this.projectRelationsContext(ctx);
    return { reads: linkedReadsFromContext(ctx), requestScope };
  }

  // ==================== CRUD ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get()
  list(
    @Query() query: ListProjectsQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.projectAccessScope(ctx, listAccessLevel(query)).then((accessScope) =>
      this.svc.list(query, { manager: ctx.manager, accessScope }),
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('ids')
  listIds(
    @Query() query: ListProjectsQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.projectAccessScope(ctx, listAccessLevel(query)).then((accessScope) =>
      this.svc.listIds(query, { manager: ctx.manager, accessScope }),
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('filter-values')
  listFilterValues(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.projectAccessScope(ctx, 'reader').then((accessScope) =>
      this.svc.listFilterValues(query, { manager: ctx.manager, accessScope }),
    );
  }

  // ==================== CSV ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'admin')
  @Get('export')
  async exportCsv(
    @Query() query: Record<string, unknown>,
    @Query('language') languageRaw: string | undefined,
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('fields') fields: string | undefined,
    @Query('preset') preset: string | undefined,
    @Query('status') status: string | undefined,
    @Query('format') formatRaw: unknown,
    @Tenant() ctx: TenantRequest,
    @Res() res: Response,
  ) {
    const format = csvExportFormat(formatRaw, scope);
    // The screen's language (the user's own when the screen sends none), as every shared-layer file.
    const language = await languageOf(this.requireManager(ctx), ctx.tenantId, ctx.userId ?? null, languageRaw);
    // `rows=list` (the dialog): the rows of the list, its filters, search, scope and sort, every page.
    const listQuery = scope === 'template' ? undefined : exportListQuery(query);
    const ids = listQuery
      ? (await this.svc.listIds({ ...listQuery, __export: true }, {
        manager: ctx.manager,
        tenantId: ctx.tenantId,
        accessScope: await this.projectAccessScope(ctx, listAccessLevel(listQuery as ListProjectsQueryInput)),
      })).ids
      : undefined;
    const result = await this.csvSvc.export({
      ids,
      language,
      manager: this.requireManager(ctx),
      tenantId: ctx.tenantId,
      scope,
      fields: fields ? fields.split(',').map((f) => f.trim()) : undefined,
      preset,
      status,
      format,
    });
    res.send(await csvExportBody(res, result));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRun: string = 'true',
    @Query('mode') mode: 'replace' | 'enrich' = 'enrich',
    @Query('operation') operation: 'upsert' | 'update_only' | 'insert_only' = 'upsert',
    @Tenant() ctx: TenantRequest,
  ) {
    return this.csvSvc.import(
      file,
      {
        dryRun: dryRun !== 'false',
        mode,
        operation,
      },
      {
        manager: this.requireManager(ctx),
        tenantId: ctx.tenantId,
        userId: ctx.userId,
      },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'admin')
  @Get('csv-fields')
  getCsvFields() {
    return this.csvSvc.getFieldInfo();
  }

  // Inline view for embedded images
  // No JWT auth required, but tenant ownership is validated via URL parameter
  @Public()
  @Get('inline/:tenantSlug/:attachmentId')
  async viewAttachmentInline(
    @Param('tenantSlug') tenantSlug: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: any,
    @Res() res: Response,
  ): Promise<void> {
    // Private + Vary:Cookie on every response (incl. 404) so no shared cache serves
    // tenant bytes and denials aren't cached across sessions.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Vary', 'Cookie');
    const refreshToken = parseCookieValue(req?.headers?.cookie as string | undefined, REFRESH_TOKEN_COOKIE_NAME);
    const meta = await this.svc.getInlineAttachmentMeta(tenantSlug, attachmentId, refreshToken);
    if (!meta) {
      res.status(404).send('Attachment not found');
      return;
    }
    const obj = await this.storage.getObjectStream(meta.storagePath);
    res.setHeader('Content-Type', obj.contentType || meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition('', 'inline'));
    const contentLength = obj.contentLength ?? meta.size ?? null;
    if (contentLength != null) res.setHeader('Content-Length', String(contentLength));
    obj.stream.pipe(res);
  }

  // Attachment download needs to be before :id route
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const meta = await this.svc.getAttachment(attachmentId, { manager: ctx.manager });
    const accessScope = await this.projectAccessScope(ctx, 'reader');
    await this.svc.assertVisible(meta.project_id, accessScope, { manager: ctx.manager });
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) res.setHeader('Content-Length', String(obj.contentLength));
    obj.stream.pipe(res);
  }

  // ==================== TIMELINE / GANTT DATA ====================
  // Place BEFORE @Get(':id') to avoid route conflict with 'planning' being matched as a project ID

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('planning/timeline')
  async getTimelineData(
    @Query('months') months: string | undefined,
    @Query('category') category: string | undefined,
    @Query('status') status: string[] | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    const accessScope = await this.projectAccessScope(ctx, 'reader');
    return this.svc.getTimelineData(
      {
        months: months ? parseInt(months, 10) : undefined,
        category,
        status,
      },
      { manager: ctx.manager, accessScope },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id')
  async get(
    @Param('id') idOrRef: string,
    @Query() query: Record<string, unknown>,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id, accessScope } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.svc.get(id, query, {
      manager: ctx.manager,
      accessScope,
      readsBudget: hasLevel(ctx, 'budget', 'reader'),
      linked: await this.projectLinkedReads(ctx),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/knowledge')
  async listDocuments(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.knowledge.listDocumentsForEntity('projects', id, {
      manager: ctx.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/knowledge-context')
  async getKnowledgeContext(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.knowledge.getKnowledgeContextForEntity('projects', id, {
      manager: ctx.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/integrated-documents/:slotKey')
  async getIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.integratedDocuments.getBySource('projects', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/integrated-documents/:slotKey/locks')
  async acquireIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.integratedDocuments.acquireLockBySource('projects', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/integrated-documents/:slotKey/locks/heartbeat')
  async heartbeatIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.integratedDocuments.heartbeatLockBySource(
      'projects',
      id,
      slotKey,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Delete(':id/integrated-documents/:slotKey/locks')
  async releaseIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.integratedDocuments.releaseLockBySource(
      'projects',
      id,
      slotKey,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Patch(':id/integrated-documents/:slotKey')
  async updateIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Body() body: any,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.integratedDocuments.updateBySource(
      'projects',
      id,
      slotKey,
      body,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/integrated-documents/:slotKey/attachments/inline')
  @UseInterceptors(FileInterceptor('file', inlineImageMulterOptions))
  async uploadIntegratedDocumentInlineAttachment(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.integratedDocuments.uploadInlineAttachmentBySource(
      'projects',
      id,
      slotKey,
      file,
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/integrated-documents/:slotKey/attachments/inline/import')
  async importIntegratedDocumentInlineAttachment(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Body() body: { source_url?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.integratedDocuments.importInlineAttachmentBySourceUrl(
      'projects',
      id,
      slotKey,
      body?.source_url || '',
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.documentImport })
  @Post(':id/integrated-documents/:slotKey/import')
  @UseInterceptors(FileInterceptor('file', documentImportMulterOptions))
  async importIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.integratedDocuments.importDocumentBySource(
      'projects',
      id,
      slotKey,
      file,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      {
        manager: ctx.manager,
        releaseConnection: createRequestReleaseConnection(req, this.dataSource, ctx.tenantId),
      },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/integrated-documents/:slotKey/versions')
  async listIntegratedDocumentVersions(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.integratedDocuments.listVersionsBySource('projects', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/integrated-documents/:slotKey/revert/:versionNumber')
  async revertIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Param('versionNumber') versionNumber: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.integratedDocuments.revertBySource(
      'projects',
      id,
      slotKey,
      Number(versionNumber),
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post()
  create(
    @Body() body: CreateProjectInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.create(body as Record<string, unknown>, ctx.tenantId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Patch(':id')
  async update(
    @Param('id') idOrRef: string,
    @Body() body: UpdateProjectInput,
    @Tenant() ctx: TenantRequest,
  ) {
    assertContributorProjectFields(ctx, body as Record<string, unknown>);
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.update(id, body as Record<string, unknown>, ctx.tenantId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  // ==================== SHARE ====================

  @ShareRateLimit()
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Post(':id/share')
  async share(
    @Param('id') idOrRef: string,
    @Body() body: ShareItemDto,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.svc.shareProject(id, body, ctx.tenantId, ctx.userId || '', {
      manager: ctx.manager,
    });
  }

  // ==================== SOURCE REQUESTS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/source-requests')
  async linkSourceRequest(
    @Param('id') idOrRef: string,
    @Body() body: { request_id: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.linkSourceRequest(id, body?.request_id, ctx.tenantId, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Delete(':id/source-requests/:requestId')
  async unlinkSourceRequest(
    @Param('id') idOrRef: string,
    @Param('requestId') requestId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.unlinkSourceRequest(id, requestId, {
      manager: ctx.manager,
    });
  }

  // ==================== TEAM MANAGEMENT ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/business-team/bulk-replace')
  async bulkReplaceBusinessTeam(
    @Param('id') idOrRef: string,
    @Body() body: { user_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.bulkReplaceTeam(id, 'business_team', body?.user_ids ?? [], {
      manager: ctx.manager,
      userId: ctx.userId ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/it-team/bulk-replace')
  async bulkReplaceItTeam(
    @Param('id') idOrRef: string,
    @Body() body: { user_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.bulkReplaceTeam(id, 'it_team', body?.user_ids ?? [], {
      manager: ctx.manager,
      userId: ctx.userId ?? null,
    });
  }

  // ==================== EFFORT ALLOCATIONS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/effort-allocations/:effortType')
  async getEffortAllocations(
    @Param('id') idOrRef: string,
    @Param('effortType') effortType: 'it' | 'business',
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.svc.getEffortAllocations(id, effortType, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/effort-allocations/:effortType')
  async setEffortAllocations(
    @Param('id') idOrRef: string,
    @Param('effortType') effortType: 'it' | 'business',
    @Body() body: { allocations: Array<{ user_id: string; allocation_pct: number }> },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.setEffortAllocations(id, effortType, body?.allocations ?? [], {
      manager: ctx.manager,
      userId: ctx.userId,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Delete(':id/effort-allocations/:effortType')
  async resetEffortAllocations(
    @Param('id') idOrRef: string,
    @Param('effortType') effortType: 'it' | 'business',
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.resetEffortAllocations(id, effortType, {
      manager: ctx.manager,
      userId: ctx.userId,
    });
  }

  // ==================== CONTACTS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/contacts/bulk-replace')
  async bulkReplaceContacts(
    @Param('id') idOrRef: string,
    @Body() body: { contact_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.bulkReplaceContacts(id, body?.contact_ids ?? [], {
      manager: ctx.manager,
      userId: ctx.userId,
    });
  }

  // ==================== RELATIONS ====================

  /** Budget lines, applications, assets, technologies and source requests, in one round trip. */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/relations')
  async getRelations(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.relations.getProjectRelations(id, await this.projectRelationsContext(ctx));
  }

  /** Link one budget line, application, asset or technology (`{ id }`). */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/relations/:kind')
  linkRelation(
    @Param('id') idOrRef: string,
    @Param('kind') kind: string,
    @Body() body: { id?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.writeRelation(kind, idOrRef, String(body?.id ?? ''), true, ctx);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Delete(':id/relations/:kind/:targetId')
  unlinkRelation(
    @Param('id') idOrRef: string,
    @Param('kind') kind: string,
    @Param('targetId') targetId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.writeRelation(kind, idOrRef, targetId, false, ctx);
  }

  /** `technologies` also needs a read of the infrastructure, before the service runs. */
  private writeRelation(kind: string, idOrRef: string, targetId: string, add: boolean, ctx: TenantRequest) {
    const relation = projectRelationKindOrThrow(kind);
    if (relation === 'technologies' && !hasLevel(ctx, 'infrastructure', 'reader')) {
      throw moduleRightRequired('infrastructure', 'reader', 'You cannot read technologies.');
    }
    return this.projectRelationsContext(ctx).then((relCtx) =>
      this.relations.setProjectLink(relation, targetId, add, relCtx, async () => {
        const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
        return { id, tenantId: ctx.tenantId };
      }),
    );
  }

  // ==================== LINKED APPLICATIONS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/applications')
  async listLinkedApplications(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    // The applications are the applications module's: listed only to its readers, in their scope.
    if (!hasLevel(ctx, 'applications', 'reader')) throw moduleRightRequired('applications', 'reader', 'You cannot read applications.');
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    const linked = await this.svc.listLinkedApplications(id, { manager: ctx.manager });
    const { applicationScope } = await this.projectRelationsContext(ctx);
    const visible = await idsInScope(this.requireManager(ctx), 'applications', linked.items.map((row: { id: string }) => row.id), applicationScope);
    return { ...linked, items: linked.items.filter((row: { id: string }) => visible.has(String(row.id))) };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/applications/bulk-replace')
  async bulkReplaceLinkedApplications(
    @Param('id') idOrRef: string,
    @Body() body: { application_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    // As the Relations tab: a read of the applications, and only applications in the person's scope.
    if (!hasLevel(ctx, 'applications', 'reader')) throw moduleRightRequired('applications', 'reader', 'You cannot read applications.');
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    const linked = await this.svc.listLinkedApplications(id, { manager: ctx.manager });
    const { applicationScope } = await this.projectRelationsContext(ctx);
    await assertApplicationsInScope(
      this.requireManager(ctx),
      [...linked.items.map((row: { id: string }) => row.id), ...(body?.application_ids ?? [])],
      applicationScope,
    );
    return this.svc.bulkReplaceLinkedApplications(id, body?.application_ids ?? [], {
      manager: ctx.manager,
      userId: ctx.userId ?? null,
    });
  }

  // ==================== LINKED ASSETS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/assets')
  async listLinkedAssets(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    // The assets are the infrastructure's: listed only to its readers.
    if (!hasLevel(ctx, 'infrastructure', 'reader')) throw moduleRightRequired('infrastructure', 'reader', 'You cannot read assets.');
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.svc.listLinkedAssets(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/assets/bulk-replace')
  async bulkReplaceLinkedAssets(
    @Param('id') idOrRef: string,
    @Body() body: { asset_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    if (!hasLevel(ctx, 'infrastructure', 'reader')) throw moduleRightRequired('infrastructure', 'reader', 'You cannot read assets.');
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.bulkReplaceLinkedAssets(id, body?.asset_ids ?? [], {
      manager: ctx.manager,
      userId: ctx.userId ?? null,
    });
  }

  // ==================== CAPEX ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/capex/bulk-replace')
  async bulkReplaceCapex(
    @Param('id') idOrRef: string,
    @Body() body: { capex_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    if (!hasLevel(ctx, 'budget', 'reader')) throw moduleRightRequired('budget', 'reader', 'You cannot read budget lines.');
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.bulkReplaceCapex(id, body?.capex_ids ?? [], {
      manager: ctx.manager,
      userId: ctx.userId ?? null,
    });
  }

  // ==================== OPEX ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/opex/bulk-replace')
  async bulkReplaceOpex(
    @Param('id') idOrRef: string,
    @Body() body: { opex_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    if (!hasLevel(ctx, 'budget', 'reader')) throw moduleRightRequired('budget', 'reader', 'You cannot read budget lines.');
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.bulkReplaceOpex(id, body?.opex_ids ?? [], {
      manager: ctx.manager,
      userId: ctx.userId ?? null,
    });
  }

  // ==================== DEPENDENCIES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/dependencies')
  async addDependency(
    @Param('id') idOrRef: string,
    @Body() body: { target_type: 'request' | 'project'; target_id: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.addDependency(id, body.target_type, body.target_id, ctx.tenantId, {
      manager: ctx.manager,
      userId: ctx.userId ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Delete(':id/dependencies/:targetType/:targetId')
  async removeDependency(
    @Param('id') idOrRef: string,
    @Param('targetType') targetType: 'request' | 'project',
    @Param('targetId') targetId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.removeDependency(id, targetType, targetId, {
      manager: ctx.manager,
      userId: ctx.userId ?? null,
    });
  }

  // ==================== URLs ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/urls')
  async replaceUrls(
    @Param('id') idOrRef: string,
    @Body() body: { urls: Array<{ url: string; label?: string }> },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.replaceUrls(id, body?.urls ?? [], {
      manager: ctx.manager,
      userId: ctx.userId,
    });
  }

  // ==================== COMMENTS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/comments')
  async addComment(
    @Param('id') idOrRef: string,
    @Body() body: {
      content: string;
      context?: string;
      is_decision?: boolean;
      decision_outcome?: string;
      new_status?: string;
    },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.addComment(
      id,
      body?.content ?? '',
      body?.context ?? null,
      ctx.tenantId,
      ctx.userId || null,
      {
        manager: ctx.manager,
        isDecision: body?.is_decision,
        decisionOutcome: body?.decision_outcome,
        newStatus: body?.new_status,
      },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Patch(':id/comments/:activityId')
  async updateComment(
    @Param('id') idOrRef: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() body: { content: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    if (!ctx.userId) {
      throw new Error('User ID required');
    }
    return this.svc.updateComment(id, activityId, body?.content ?? '', ctx.userId, {
      manager: ctx.manager,
    });
  }

  // ==================== ATTACHMENTS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  async uploadAttachment(
    @Param('id') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.uploadAttachment(id, file, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  // Inline attachment upload for rich text editor images
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/attachments/inline')
  @UseInterceptors(FileInterceptor('file', inlineImageMulterOptions))
  async uploadInlineAttachment(
    @Param('id') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('source_field') sourceField: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.uploadInlineAttachment(id, file, sourceField || 'content', ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/attachments/inline/import')
  async importInlineAttachment(
    @Param('id') idOrRef: string,
    @Body() body: { source_field?: string; source_url?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.importInlineAttachmentFromUrl(
      id,
      body?.source_url || '',
      body?.source_field || 'content',
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Delete(':id/attachments/:attachmentId')
  async deleteAttachment(
    @Param('id') idOrRef: string,
    @Param('attachmentId') attachmentId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.deleteAttachment(attachmentId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  // ==================== PHASES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/phases')
  async listPhases(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.svc.listPhases(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/phases')
  async createPhase(
    @Param('id') idOrRef: string,
    @Body() body: { name: string; planned_start?: string; planned_end?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.createPhase(id, body, ctx.tenantId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Patch(':id/phases/:phaseId')
  async updatePhase(
    @Param('id') idOrRef: string,
    @Param('phaseId') phaseId: string,
    @Body() body: { name?: string; planned_start?: string; planned_end?: string; status?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.updatePhase(phaseId, body as Record<string, unknown>, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Delete(':id/phases/:phaseId')
  async deletePhase(
    @Param('id') idOrRef: string,
    @Param('phaseId') phaseId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.deletePhase(phaseId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/phases/reorder')
  async reorderPhases(
    @Param('id') idOrRef: string,
    @Body() body: ReorderPhasesDto,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.reorderPhases(id, body.phase_ids, ctx.tenantId, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/phases/:phaseId/toggle-milestone')
  async togglePhaseMilestone(
    @Param('id') idOrRef: string,
    @Param('phaseId') phaseId: string,
    @Body() body: { enabled: boolean; milestone_name?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.togglePhaseMilestone(
      phaseId,
      body.enabled,
      body.milestone_name || null,
      ctx.tenantId,
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  // ==================== MILESTONES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/milestones')
  async listMilestones(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.svc.listMilestones(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/milestones')
  async createMilestone(
    @Param('id') idOrRef: string,
    @Body() body: { name: string; phase_id?: string; target_date?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.createMilestone(id, body, ctx.tenantId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Patch(':id/milestones/:milestoneId')
  async updateMilestone(
    @Param('id') idOrRef: string,
    @Param('milestoneId') milestoneId: string,
    @Body() body: { name?: string; target_date?: string; status?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.updateMilestone(milestoneId, body as Record<string, unknown>, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Delete(':id/milestones/:milestoneId')
  async deleteMilestone(
    @Param('id') idOrRef: string,
    @Param('milestoneId') milestoneId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.deleteMilestone(milestoneId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  // ==================== APPLY TEMPLATE ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/apply-template')
  async applyPhaseTemplate(
    @Param('id') idOrRef: string,
    @Body() body: { template_id: string; replace?: boolean },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'member');
    return this.svc.applyPhaseTemplate(
      id,
      body.template_id,
      { replace: body.replace },
      ctx.tenantId,
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  // ==================== TIME ENTRIES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get(':id/time-entries')
  async listTimeEntries(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'reader');
    return this.svc.listTimeEntries(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post(':id/time-entries')
  async createTimeEntry(
    @Param('id') idOrRef: string,
    @Body() body: {
      category: 'it' | 'business';
      user_id?: string;
      hours: number;
      notes?: string;
      logged_at: string;
    },
    @Tenant() ctx: TenantRequest,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, ctx, 'contributor');
    return this.svc.createTimeEntry(id, body, ctx.tenantId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Patch(':id/time-entries/:entryId')
  async updateTimeEntry(
    @Param('id') idOrRef: string,
    @Param('entryId') entryId: string,
    @Body() body: {
      category?: 'it' | 'business';
      user_id?: string;
      hours?: number;
      notes?: string;
      logged_at?: string;
    },
    @Req() req: { isAdmin?: boolean },
    @Tenant() ctx: TenantRequest,
  ) {
    await this.resolveForAccess(idOrRef, ctx, 'contributor');
    const isAdmin = req?.isAdmin === true;
    return this.svc.updateTimeEntry(entryId, body, ctx.userId || null, isAdmin, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Delete(':id/time-entries/:entryId')
  async deleteTimeEntry(
    @Param('id') idOrRef: string,
    @Param('entryId') entryId: string,
    @Req() req: { isAdmin?: boolean },
    @Tenant() ctx: TenantRequest,
  ) {
    await this.resolveForAccess(idOrRef, ctx, 'contributor');
    const isAdmin = req?.isAdmin === true;
    return this.svc.deleteTimeEntry(entryId, ctx.userId || null, isAdmin, {
      manager: ctx.manager,
    });
  }
}
