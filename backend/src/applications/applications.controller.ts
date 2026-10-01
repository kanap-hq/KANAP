import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ApplicationsService } from './services';
import { ApplicationsDeleteService } from './applications-delete.service';
import { ApplicationsCsvService } from './applications-csv.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { DataSource, EntityManager } from 'typeorm';
import { attachmentMulterOptions, csvImportMulterOptions, documentImportMulterOptions, inlineImageMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { StorageService } from '../common/storage/storage.service';
import { createRequestReleaseConnection } from '../common/import-connection';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
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

  private async readProjectScope(ctx: TenantRequest) {
    return this.participationScope(ctx, 'portfolio_projects');
  }

  private async readTaskScope(ctx: TenantRequest) {
    return this.participationScope(ctx, 'tasks');
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
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('fields') fields: string | undefined,
    @Query('preset') preset: string | undefined,
    @Query('lifecycle') lifecycle: string | undefined,
    @Query('criticality') criticality: string | undefined,
    @Query('status') status: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const result = await this.csvSvc.export({
      manager: this.requireManager(ctx),
      tenantId: ctx.tenantId,
      query,
      scope,
      fields: fields ? fields.split(',').map((f) => f.trim()) : undefined,
      preset,
      lifecycle,
      criticality,
      status,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(result.filename));
    res.send(result.content);
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

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
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
  acquireIntegratedDocumentLock(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.integratedDocuments.acquireLockBySource('applications', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/integrated-documents/:slotKey/locks/heartbeat')
  heartbeatIntegratedDocumentLock(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
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
  releaseIntegratedDocumentLock(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
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
  updateIntegratedDocument(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Body() body: any,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
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
  uploadIntegratedDocumentInlineAttachment(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Tenant() ctx: TenantRequest,
  ) {
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
  importIntegratedDocumentInlineAttachment(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Body() body: { source_url?: string },
    @Tenant() ctx: TenantRequest,
  ) {
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
  importIntegratedDocument(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
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
  revertIntegratedDocument(
    @Param('id') id: string,
    @Param('slotKey') slotKey: string,
    @Param('versionNumber') versionNumber: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
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

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post()
  create(
    @Body() body: CreateApplicationInput,
    @Tenant() ctx: TenantRequest,
  ): Promise<Application> {
    // The service handles date conversion from strings
    return this.svc.create(body as Record<string, unknown>, ctx.userId || null, { manager: ctx.manager });
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
  ): Promise<{ opex: number; capex: number; contracts: number; projects: number; links: number; attachments: number; total: number }> {
    return this.svc.relationCounts(id, {
      ...(await this.readApplicationOpts(ctx)),
      projectAccessScope: await this.readProjectScope(ctx),
    });
  }

  // Relations — OPEX (spend items)
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/spend-items')
  async listLinkedSpend(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ): Promise<{ items: Array<{ id: string; product_name: string }> }> {
    return this.svc.listLinkedSpendItems(id, await this.readApplicationOpts(ctx));
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
    return this.svc.listLinkedCapexItems(id, await this.readApplicationOpts(ctx));
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
