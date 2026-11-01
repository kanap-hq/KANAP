import { languageOf } from '../common/csv-sheet';
import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { ApplicationsService, ApplicationsRelationsService } from './services';
import { incidentViewerFromContext } from '../incidents/incident-visibility';
import { buildRelationsAccess } from '../common/relations/relations-access';
import { RELATION_READ_RESOURCES, relationKindOrThrow, type RelationsContext } from './services/applications-relations.service';
import { ApplicationsDeleteService } from './applications-delete.service';
import { ApplicationsCsvService } from './applications-csv.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { DataSource, EntityManager } from 'typeorm';
import { attachmentMulterOptions, csvImportMulterOptions, documentImportMulterOptions, inlineImageMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { csvExportFormat } from '../common/csv';
import { csvExportBody } from '../common/csv/send-csv-export';
import { StorageService } from '../common/storage/storage.service';
import { createRequestReleaseConnection } from '../common/import-connection';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { ShareRateLimit } from '../notifications/share-rate-limit';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';
import {
  ParticipationAccessScope,
  resolveBusinessContributorScopeForUser,
} from '../auth/business-contributor-scope';
import {
  CreateApplicationInput,
  UpdateApplicationInput,
  ListApplicationsQueryInput,
  ApplicationListItemResponse,
  ApplicationMapSummaryResponse,
  VersionLineageResponse,
  BulkOperationResponse,
  ApplicationsBulkDeleteResult,
  ApplicationWithServerAssignments,
  CsvImportResult,
} from './dto';
import { Application } from './application.entity';
import { ApplicationOwner } from './application-owner.entity';
import { ApplicationCompany } from './application-company.entity';
import { ApplicationDepartment } from './application-department.entity';
import { ApplicationLink } from './application-link.entity';
import { ApplicationAttachment } from './application-attachment.entity';
import { ApplicationDataResidency } from './application-data-residency.entity';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { NotFoundException } from '@nestjs/common';
import { creationCancelExpired, issueCreationToken, verifyCreationToken } from '../common/creation/creation-token';
import { countChangesSinceCreation, type CreationChanges } from '../common/creation/creation-changes';

@UseGuards(JwtAuthGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly svc: ApplicationsService,
    private readonly storage: StorageService,
    private readonly deleteSvc: ApplicationsDeleteService,
    private readonly csvSvc: ApplicationsCsvService,
    private readonly knowledge: KnowledgeService,
    private readonly integratedDocuments: IntegratedDocumentsService,
    private readonly dataSource: DataSource,
    private readonly tasks: TasksUnifiedService,
    private readonly relations: ApplicationsRelationsService,
  ) {}

  /**
   * The tenant-bound manager for this request. `TenantInitGuard` creates the query runner for every
   * non-public tenant route, so a missing manager means the request has no tenant context.
   */
  private requireManager(ctx: TenantRequest): EntityManager {
    if (!ctx.manager) {
      throw new ForbiddenException('Tenant context is not available');
    }
    return ctx.manager;
  }

  private async participationScope(
    ctx: TenantRequest,
    resource: string,
  ): Promise<ParticipationAccessScope | undefined> {
    if (!ctx.manager) {
      throw new ForbiddenException('Access scope could not be resolved');
    }
    return resolveBusinessContributorScopeForUser({
      manager: ctx.manager,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    }, resource, 'reader');
  }

  private async readApplicationOpts(ctx: TenantRequest) {
    return {
      manager: ctx.manager,
      tenantId: ctx.tenantId,
      accessScope: await this.participationScope(ctx, 'applications'),
    };
  }

  private readsBudget(ctx: TenantRequest): boolean {
    return buildRelationsAccess(ctx, { read: RELATION_READ_RESOURCES }).access.budget_lines;
  }

  private async readProjectScope(ctx: TenantRequest) {
    return this.participationScope(ctx, 'portfolio_projects');
  }

  private async readTaskScope(ctx: TenantRequest) {
    return this.participationScope(ctx, 'tasks');
  }

  /**
   * What the Relations tab may show and change: a section per module the caller reads (by
   * permission level), each under the caller's participation scope when it is a Business Contributor.
   */
  private async relationsContext(ctx: TenantRequest): Promise<RelationsContext> {
    const rights = buildRelationsAccess(ctx, {
      read: RELATION_READ_RESOURCES,
      write: { technologies: 'infrastructure', processes: 'business_processes' },
      contribute: { incidents: 'incidents' },
    });
    const [application, project, request, task] = await Promise.all([
      this.participationScope(ctx, 'applications'),
      this.readProjectScope(ctx),
      this.participationScope(ctx, 'portfolio_requests'),
      this.readTaskScope(ctx),
    ]);
    return {
      manager: this.requireManager(ctx),
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
      access: rights.access,
      writes: {
        technologies: rights.writes.technologies,
        processes: rights.writes.processes,
        incidents: rights.contributes.incidents,
      },
      scopes: { application, project, request, task },
      incidentViewer: incidentViewerFromContext(ctx),
    };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get()
  async list(
    @Query() query: ListApplicationsQueryInput,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: ApplicationListItemResponse[]; total: number; page: number; limit: number }> {
    return this.svc.list(query, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('ids')
  async listIds(
    @Query() query: ListApplicationsQueryInput,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ ids: string[] }> {
    return this.svc.listIds(query, await this.readApplicationOpts(ctx));
  }

  /** Campaign counters (reviewed / to review / to complete) for the same filters and scope as the list. */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('classification-summary')
  async classificationSummary(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.classificationSummary(query, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('filter-values')
  async listFilterValues(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ): Promise<Record<string, Array<string | boolean | null>>> {
    return this.svc.listFilterValues(query, await this.readApplicationOpts(ctx));
  }

  // Export before :id - uses V2 CSV service
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'admin')
  @Get('export')
  async export(
    @Query() query: Record<string, unknown>,
    @Query('language') languageRaw: string | undefined,
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('fields') fields: string | undefined,
    @Query('preset') preset: string | undefined,
    @Query('lifecycle') lifecycle: string | undefined,
    @Query('criticality') criticality: string | undefined,
    @Query('status') status: string | undefined,
    @Query('format') formatRaw: unknown,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const format = csvExportFormat(formatRaw, scope);
    // The screen's language (the user's own when the screen sends none), as every shared-layer file.
    const language = await languageOf(this.requireManager(ctx), ctx.tenantId, ctx.userId ?? null, languageRaw);
    const result = await this.csvSvc.export({
      language,
      manager: this.requireManager(ctx),
      tenantId: ctx.tenantId,
      query,
      scope,
      fields: fields ? fields.split(',').map((f) => f.trim()) : undefined,
      preset,
      lifecycle,
      criticality,
      status,
      format,
    });
    res.send(await csvExportBody(res, result));
  }

  // Attachments: static segment before :id for download
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const meta = await this.svc.downloadAttachment(attachmentId, await this.readApplicationOpts(ctx));
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) res.setHeader('Content-Length', String(obj.contentLength));
    obj.stream.pipe(res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('attachments/:attachmentId/delete')
  deleteAttachment(
    @Param('attachmentId') attachmentId: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ ok: boolean }> {
    return this.svc.deleteAttachment(attachmentId, ctx.userId || null, { manager: ctx.manager });
  }

  // What a delete of `ids` would refuse (applications with interfaces) and take with it, asked before the confirmation.
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'admin')
  @Post('delete-check')
  deleteCheck(@Body() body: { ids: string[] }, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.deleteCheck(Array.isArray(body?.ids) ? body.ids : [], { manager: ctx.manager });
  }

  // Bulk delete before parameterized ':id'
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'admin')
  @Delete('bulk')
  bulkDelete(
    @Body() body: { ids: string[] },
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationsBulkDeleteResult> {
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    return this.deleteSvc.bulkDelete(ids, ctx.userId || null, { manager: ctx.manager });
  }

  // Applications with server assignments (for Connection Map filtering)
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('with-server-assignments')
  async listWithServerAssignments(
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: ApplicationWithServerAssignments[] }> {
    return this.svc.listWithServerAssignments(await this.readApplicationOpts(ctx));
  }

  // ==================== CSV V2 Endpoints ====================
  // Must be before :id route to avoid route conflicts

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'admin')
  @Get('csv-fields')
  getCsvFields() {
    return this.csvSvc.getFieldInfo();
  }

  /** The levels and waves of the classification, read by the applications' and the technologies' Compliance tabs. */
  @UseGuards(PermissionGuard)
  @RequireAnyLevel([{ resource: 'applications', level: 'reader' }, { resource: 'infrastructure', level: 'reader' }])
  @Get('classification-catalog')
  classificationCatalog(@Tenant() ctx: TenantRequest) {
    return this.svc.getClassificationCatalog({ manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/classification-review')
  reviewClassification(@Param('id') id: string, @Body() body: { expected_revision: number }, @Tenant() ctx: TenantRequest) {
    return this.svc.reviewClassification(id, body?.expected_revision, ctx.userId || null, { manager: ctx.manager });
  }

  /** Interfaces to applications restored in a later wave. Same restriction as interface routes: no Business Contributor scope. */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/recovery-dependencies')
  async recoveryDependencies(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    const opts = await this.readApplicationOpts(ctx);
    if (opts.accessScope) throw new ForbiddenException('Business Contributor cannot access interfaces');
    return this.svc.listRecoveryDependencies(id, opts);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Query('include') include: string | string[],
    @Tenant() ctx: TenantRequest,
  ): Promise<Record<string, unknown>> {
    return this.svc.get(id, { ...(await this.readApplicationOpts(ctx)), include });
  }

  @ShareRateLimit()
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Post(':id/share')
  async share(
    @Param('id') id: string,
    @Body() body: ShareItemDto,
    @Tenant() ctx: TenantRequest,
  ) {
    const opts = await this.readApplicationOpts(ctx);
    if (opts.accessScope) {
      throw new ForbiddenException('Business Contributor can only read assigned applications');
    }
    return this.svc.shareApplication(id, body, ctx.tenantId, ctx.userId || '', {
      manager: ctx.manager,
      tenantId: ctx.tenantId,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/related-tasks')
  async listRelatedTasks(
    @Param('id') id: string,
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const app = await this.svc.get(id, await this.readApplicationOpts(ctx));
    return this.tasks.listRelatedTasksForApplication(String((app as any).id), query, {
      manager: ctx.manager,
      tenantId: ctx.tenantId,
      accessScope: await this.readTaskScope(ctx),
      viewer: incidentViewerFromContext(ctx),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/related-tasks/bulk-replace')
  async bulkReplaceRelatedTasks(
    @Param('id') id: string,
    @Body() body: { task_ids?: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const app = await this.svc.get(id, await this.readApplicationOpts(ctx));
    return this.tasks.bulkReplaceTasksForApplication(String((app as any).id), body?.task_ids ?? [], {
      manager: ctx.manager,
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      accessScope: await this.readTaskScope(ctx),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/knowledge')
  async listDocuments(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
    @Req() req: any,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.knowledge.listDocumentsForEntity('applications', id, {
      manager: ctx.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/knowledge-context')
  async getKnowledgeContext(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
    @Req() req: any,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.knowledge.getKnowledgeContextForEntity('applications', id, {
      manager: ctx.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/integrated-documents/:slotKey')
  async getIntegratedDocument(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.getBySource('applications', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/integrated-documents/:slotKey/locks')
  async acquireIntegratedDocumentLock(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.acquireLockBySource('applications', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/integrated-documents/:slotKey/locks/heartbeat')
  async heartbeatIntegratedDocumentLock(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.heartbeatLockBySource(
      'applications',
      id,
      slotKey,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete(':id/integrated-documents/:slotKey/locks')
  async releaseIntegratedDocumentLock(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.releaseLockBySource(
      'applications',
      id,
      slotKey,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch(':id/integrated-documents/:slotKey')
  async updateIntegratedDocument(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Body() body: any,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.updateBySource(
      'applications',
      id,
      slotKey,
      body,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/integrated-documents/:slotKey/attachments/inline')
  @UseInterceptors(FileInterceptor('file', inlineImageMulterOptions))
  async uploadIntegratedDocumentInlineAttachment(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.uploadInlineAttachmentBySource(
      'applications',
      id,
      slotKey,
      file,
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/integrated-documents/:slotKey/attachments/inline/import')
  async importIntegratedDocumentInlineAttachment(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Body() body: { source_url?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.importInlineAttachmentBySourceUrl(
      'applications',
      id,
      slotKey,
      body?.source_url || '',
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.documentImport })
  @Post(':id/integrated-documents/:slotKey/import')
  @UseInterceptors(FileInterceptor('file', documentImportMulterOptions))
  async importIntegratedDocument(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.importDocumentBySource(
      'applications',
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
  @RequireLevel('applications', 'reader')
  @Get(':id/integrated-documents/:slotKey/versions')
  async listIntegratedDocumentVersions(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.listVersionsBySource('applications', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/integrated-documents/:slotKey/revert/:versionNumber')
  async revertIntegratedDocument(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Param('versionNumber') versionNumber: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.svc.assertVisible(id, await this.readApplicationOpts(ctx));
    return this.integratedDocuments.revertBySource(
      'applications',
      id,
      slotKey,
      Number(versionNumber),
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  /**
   * Creates the application and hands its creator a creation token (`common/creation`), which
   * opens "Cancel creation" (`DELETE :id/creation`) for this record and this person only.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post()
  async create(
    @Body() body: CreateApplicationInput,
    @Tenant() ctx: TenantRequest,
  ): Promise<Application & { creation_token: string }> {
    // The service handles date conversion from strings
    const created = await this.svc.create(body as Record<string, unknown>, ctx.userId || null, { manager: ctx.manager });
    const creation_token = issueCreationToken({ tenantId: ctx.tenantId, family: 'applications', recordId: created.id, userId: ctx.userId });
    return Object.assign(created, { creation_token });
  }

  /** The token of `POST /applications` for this record, tenant and person, still valid; a 403 otherwise. */
  private assertCreationToken(id: string, token: unknown, ctx: TenantRequest): void {
    if (!verifyCreationToken(token, { tenantId: ctx.tenantId, family: 'applications', recordId: String(id ?? ''), userId: ctx.userId })) {
      throw creationCancelExpired();
    }
  }

  /**
   * Before "Cancel creation": what was written on the application and its children since its
   * creation (its history's audit rows), plus its written description and managed documents, which
   * their own audit labels record. Nothing is written.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Get(':id/creation')
  async creationChanges(
    @Param('id') id: string,
    @Query('token') token: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ changes: CreationChanges }> {
    this.assertCreationToken(id, token, ctx);
    const manager = this.requireManager(ctx);
    const found = await manager.query('SELECT 1 FROM applications WHERE id = $1 AND tenant_id = $2', [id, ctx.tenantId]);
    if (!found.length) throw new NotFoundException('Application not found');
    const changes = await countChangesSinceCreation(manager, ctx.tenantId, 'applications', id);
    const { removes } = await this.deleteSvc.deleteCheck([id], { manager });
    for (const removed of removes) {
      const kind = removed.type === 'descriptions' ? 'description' : removed.type === 'documents' ? 'document' : null;
      if (kind && removed.total > 0) changes.children[kind] = (changes.children[kind] ?? 0) + removed.total;
    }
    return { changes };
  }

  /**
   * "Cancel creation": the creator deletes the application they just created, with its token,
   * even without the delete right. Same delete as `DELETE :id` (cascades, refusals, audit entry).
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete(':id/creation')
  async cancelCreation(
    @Param('id') id: string,
    @Body() body: { token?: string },
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    this.assertCreationToken(id, body?.token, ctx);
    await this.deleteSvc.delete(id, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateApplicationInput,
    @Tenant() ctx: TenantRequest,
  ): Promise<Application> {
    // The service handles date conversion from strings
    return this.svc.update(id, body as Record<string, unknown>, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/copy')
  copyApplication(@Param('id') id: string, @Body() body: { name?: string }, @Tenant() ctx: TenantRequest) {
    return this.svc.copyApplication(id, body?.name || '', ctx.userId || null, { manager: ctx.manager });
  }

  // Import - uses V2 CSV service
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
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
  @RequireLevel('applications', 'member')
  @Delete(':id')
  delete(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    return this.deleteSvc.delete(id, { manager: ctx.manager, userId: ctx.userId || null });
  }

  // Owners
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/owners')
  async listOwners(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationOwner[]> {
    return this.svc.listOwners(id, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/owners/bulk-replace')
  bulkReplaceOwners(
    @Param('id') id: string,
    @Body() body: { owners: Array<{ user_id: string; owner_type: 'business' | 'it' }> },
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationOwner[]> {
    return this.svc.bulkReplaceOwners(id, body?.owners ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Audience: companies & departments
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/companies')
  async listCompanies(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationCompany[]> {
    return this.svc.listCompanies(id, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/companies/bulk-replace')
  bulkReplaceCompanies(
    @Param('id') id: string,
    @Body() body: { company_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationCompany[]> {
    return this.svc.bulkReplaceCompanies(id, body?.company_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/departments')
  async listDepartments(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationDepartment[]> {
    return this.svc.listDepartments(id, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/departments/bulk-replace')
  bulkReplaceDepartments(
    @Param('id') id: string,
    @Body() body: { department_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationDepartment[]> {
    return this.svc.bulkReplaceDepartments(id, body?.department_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Map-side summaries
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/map-summary')
  async mapSummary(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationMapSummaryResponse> {
    return this.svc.mapSummary(id, await this.readApplicationOpts(ctx));
  }

  // Support contacts
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/support-contacts')
  async listSupportContacts(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<Array<{ id: string; contact_id: string; role: string | null; contact: Record<string, unknown> }>> {
    return this.svc.listSupportContacts(id, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/support-contacts/bulk-replace')
  bulkReplaceSupportContacts(
    @Param('id') id: string,
    @Body() body: { contacts: Array<{ contact_id: string; role?: string | null }> },
    @Tenant() ctx: TenantRequest,
  ): Promise<Array<{ id: string; contact_id: string; role: string | null; contact: Record<string, unknown> }>> {
    return this.svc.bulkReplaceSupportContacts(id, body?.contacts ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Links
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/links')
  async listLinks(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationLink[]> {
    return this.svc.listLinks(id, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/links')
  createLink(
    @Param('id') id: string,
    @Body() body: { description?: string; url: string; purpose?: 'general' | 'recovery_plan' | 'recovery_test' },
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationLink> {
    return this.svc.createLink(id, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch(':id/links/:linkId')
  updateLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() body: { description?: string; url?: string; purpose?: 'general' | 'recovery_plan' | 'recovery_test' },
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationLink> {
    return this.svc.updateLink(id, linkId, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete(':id/links/:linkId')
  deleteLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ ok: boolean }> {
    return this.svc.deleteLink(id, linkId, ctx.userId || null, { manager: ctx.manager });
  }

  // Attachments for app id
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/attachments')
  async listAttachments(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationAttachment[]> {
    return this.svc.listAttachments(id, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationAttachment> {
    return this.svc.uploadAttachment(id, file, ctx.userId || null, { manager: ctx.manager });
  }

  // Data residency
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/data-residency')
  async listDataResidency(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationDataResidency[]> {
    return this.svc.listDataResidency(id, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/data-residency/bulk-replace')
  bulkReplaceDataResidency(
    @Param('id') id: string,
    @Body() body: { countries: string[] },
    @Tenant() ctx: TenantRequest,
  ): Promise<ApplicationDataResidency[]> {
    return this.svc.bulkReplaceDataResidency(id, body?.countries ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/relations-count')
  async relationCounts(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ opex: number; capex: number; budget_lines_hidden: number; contracts: number; projects: number; requests: number; technologies: number; processes: number; links: number; attachments: number; total: number }> {
    // The same rule as the Relations tab for budget lines, contracts, projects and requests: a module
    // the caller cannot read adds nothing to the badge, and a Business Contributor counts only the
    // projects and requests it takes part in.
    const { access } = buildRelationsAccess(ctx, { read: RELATION_READ_RESOURCES });
    return this.svc.relationCounts(id, {
      ...(await this.readApplicationOpts(ctx)),
      readsBudget: access.budget_lines,
      readsContracts: access.contracts,
      readsProjects: access.projects,
      readsProcesses: access.processes,
      readsTechnologies: access.technologies,
      projectAccessScope: access.projects ? await this.readProjectScope(ctx) : undefined,
      requestsAccess: access.requests ? { scope: await this.participationScope(ctx, 'portfolio_requests') } : null,
    });
  }

  /** The Relations tab in one round trip: linked objects, suggestions and other related counts. */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/relations')
  async getRelations(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.relations.getRelations(id, await this.relationsContext(ctx));
  }

  /**
   * Link one object (`kind`: budget_lines, contracts, incidents, processes, projects, requests,
   * tasks, technologies); the caller must read its module, and edit it for processes and
   * technologies (contribute to it for incidents: the link is written in the incident's journal,
   * and a closed incident refuses it).
   * A technology also takes its version (`technology_version_id` or `version_label`, none: unknown)
   * and the deployment servers to record it on (`asset_ids`).
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/relations/:kind')
  async linkRelation(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: { id?: string; technology_version_id?: string | null; version_label?: string; asset_ids?: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const relationKind = relationKindOrThrow(kind);
    const link = relationKind === 'technologies'
      ? { technology_version_id: body?.technology_version_id, version_label: body?.version_label, asset_ids: body?.asset_ids }
      : {};
    return this.relations.setLink(relationKind, id, String(body?.id ?? ''), true, await this.relationsContext(ctx), link);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete(':id/relations/:kind/:targetId')
  async unlinkRelation(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('targetId') targetId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.relations.setLink(relationKindOrThrow(kind), id, targetId, false, await this.relationsContext(ctx));
  }

  // Relations — Requests
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/requests/bulk-replace')
  async bulkReplaceRequests(
    @Param('id') id: string,
    @Body() body: { request_ids?: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.relations.bulkReplaceRequests(id, body?.request_ids ?? [], await this.relationsContext(ctx));
  }

  // Relations — OPEX (spend items)
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/spend-items')
  async listLinkedSpend(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: Array<{ id: string; product_name: string }> }> {
    const linked = await this.svc.listLinkedSpendItems(id, await this.readApplicationOpts(ctx));
    // The names of the lines go to the readers of the budget only (spec §5.4).
    return this.readsBudget(ctx) ? linked : { items: [] };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/spend-items/bulk-replace')
  bulkReplaceLinkedSpend(
    @Param('id') id: string,
    @Body() body: { spend_item_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ): Promise<BulkOperationResponse> {
    return this.svc.bulkReplaceLinkedSpendItems(id, body?.spend_item_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Relations — CAPEX items
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/capex-items')
  async listLinkedCapex(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: Array<{ id: string; description: string }> }> {
    const linked = await this.svc.listLinkedCapexItems(id, await this.readApplicationOpts(ctx));
    return this.readsBudget(ctx) ? linked : { items: [] };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/capex-items/bulk-replace')
  bulkReplaceLinkedCapex(
    @Param('id') id: string,
    @Body() body: { capex_item_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ): Promise<BulkOperationResponse> {
    return this.svc.bulkReplaceLinkedCapexItems(id, body?.capex_item_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Relations — Contracts
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/contracts')
  async listLinkedContracts(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: Array<{ id: string; name: string }> }> {
    return this.svc.listLinkedContracts(id, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/contracts/bulk-replace')
  bulkReplaceLinkedContracts(
    @Param('id') id: string,
    @Body() body: { contract_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ): Promise<BulkOperationResponse> {
    return this.svc.bulkReplaceLinkedContracts(id, body?.contract_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Relations — Projects
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/projects')
  async listProjects(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: Array<{ id: string; name: string }> }> {
    return this.svc.listProjects(id, {
      ...(await this.readApplicationOpts(ctx)),
      projectAccessScope: await this.readProjectScope(ctx),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/projects/bulk-replace')
  bulkReplaceProjects(
    @Param('id') id: string,
    @Body() body: { project_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: Array<{ id: string; name: string }> }> {
    return this.svc.bulkReplaceProjects(id, body?.project_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Structure — Suites and Components
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/suites')
  async listSuites(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: Array<{ id: string; name: string; lifecycle: string; criticality: string }> }> {
    return this.svc.listSuites(id, await this.readApplicationOpts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/suites/bulk-replace')
  bulkReplaceSuites(
    @Param('id') id: string,
    @Body() body: { suite_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ): Promise<BulkOperationResponse> {
    return this.svc.bulkReplaceSuites(id, body?.suite_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/components')
  async listComponents(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: Array<{ id: string; name: string; lifecycle: string; criticality: string }> }> {
    return this.svc.listComponents(id, await this.readApplicationOpts(ctx));
  }

  // Derived total users helper (read-only)
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/total-users')
  async totalUsers(
    @Param('id') id: string,
    @Query('year') yearRaw: string | undefined,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ total: number; year: number | null }> {
    const y = yearRaw ? parseInt(String(yearRaw), 10) : undefined;
    return this.svc.getTotalUsers(id, y, await this.readApplicationOpts(ctx));
  }

  // ==================== VERSION MANAGEMENT ====================

  /**
   * Create a new version of an application with lineage tracking.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/create-version')
  createVersion(
    @Param('id') id: string,
    @Body() body: {
      name: string;
      version?: string;
      go_live_date?: string;
      end_of_support_date?: string;
      copyOwners?: boolean;
      copyCompanies?: boolean;
      copyDepartments?: boolean;
      copyDataResidency?: boolean;
      copyLinks?: boolean;
      copySupportContacts?: boolean;
      copySpendItems?: boolean;
      copyCapexItems?: boolean;
      copyContracts?: boolean;
      copyInstances?: boolean;
      copyBindings?: boolean;
      interfaceIds?: string[];
    },
    @Tenant() ctx: TenantRequest,
  ): Promise<Application> {
    return this.svc.createVersion(id, body, ctx.userId || null, { manager: ctx.manager });
  }

  /**
   * Get version lineage (predecessors and successors) for an application.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/version-lineage')
  async getVersionLineage(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<VersionLineageResponse> {
    return this.svc.getVersionLineage(id, await this.readApplicationOpts(ctx));
  }

  /**
   * Get interfaces involving this application, for migration wizard.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/interfaces-for-migration')
  async getInterfacesForMigration(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<Array<{ id: string; name: string; direction: string }>> {
    return this.svc.getInterfacesForMigration(id, await this.readApplicationOpts(ctx));
  }
}
