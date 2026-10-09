import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { ExportRoute } from '../audit/security-events';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import {
  attachmentMulterOptions,
  csvImportMulterOptions,
  documentImportMulterOptions,
  inlineImageMulterOptions,
} from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { createRequestReleaseConnection } from '../common/import-connection';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { StorageService } from '../common/storage/storage.service';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { resolveToUuid } from '../common/resolve-item-id';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { InlineImageResolverService } from '../knowledge/inline-image-resolver.service';
import {
  IncidentEntriesService,
  IncidentRelationsService,
  IncidentReportService,
  IncidentsAttachmentsService,
  IncidentsService,
} from './services';
import { IncidentsCsvService } from './incidents-csv.service';
import {
  CreateEntryInput,
  CreateIncidentInput,
  IncidentConfidentialityInput,
  IncidentReasonInput,
  ListIncidentsQueryInput,
  UpdateIncidentInput,
  parseIncidentConfidentiality,
  parseIncidentReason,
} from './dto';
import { incidentViewerFromContext } from './incident-visibility';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS, OUTSIDE_WORK_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(
    private readonly svc: IncidentsService,
    private readonly entries: IncidentEntriesService,
    private readonly relations: IncidentRelationsService,
    private readonly attachments: IncidentsAttachmentsService,
    private readonly csvSvc: IncidentsCsvService,
    private readonly report: IncidentReportService,
    private readonly storage: StorageService,
    private readonly knowledge: KnowledgeService,
    private readonly integratedDocuments: IntegratedDocumentsService,
    private readonly dataSource: DataSource,
    private readonly inlineImages: InlineImageResolverService,
  ) {}

  private resolveId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'incident', manager);
  }

  private opts(ctx: TenantRequest) {
    return { manager: ctx.manager, tenantId: ctx.tenantId, viewer: incidentViewerFromContext(ctx) };
  }

  private async visibleId(idOrRef: string, ctx: TenantRequest): Promise<string> {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    await this.svc.ensureIncident(id, ctx.manager as EntityManager, ctx.tenantId, incidentViewerFromContext(ctx));
    return id;
  }

  /**
   * Visibility + closure lock as a fast fail. Never the only protection: the
   * document service re-evaluates permissions, visibility and the freeze under
   * the transactional lock (planning/incident-review-document.md §3.3/§3.7).
   */
  private async editableId(idOrRef: string, ctx: TenantRequest): Promise<string> {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    await this.svc.ensureEditable(id, this.opts(ctx));
    return id;
  }

  // Static routes first: list, ids, filter-values, attachment download/delete

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get()
  list(@Query() query: ListIncidentsQueryInput, @Tenant() ctx: TenantRequest) {
    return this.svc.list(query, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get('ids')
  listIds(@Query() query: ListIncidentsQueryInput, @Tenant() ctx: TenantRequest) {
    return this.svc.listIds(query, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get('filter-values')
  listFilterValues(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.listFilterValues(query, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const meta = await this.attachments.downloadAttachment(attachmentId, this.opts(ctx));
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) res.setHeader('Content-Length', String(obj.contentLength));
    obj.stream.pipe(res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Patch('attachments/:attachmentId/delete')
  deleteAttachment(@Param('attachmentId') attachmentId: string, @Tenant() ctx: TenantRequest) {
    return this.attachments.deleteAttachment(attachmentId, ctx.userId || null, this.opts(ctx));
  }

  // CSV

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get('export')
  async exportCsv(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('fields') fields: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const result = await this.csvSvc.export({
      manager: ctx.manager as EntityManager,
      tenantId: ctx.tenantId,
      viewer: incidentViewerFromContext(ctx),
      scope,
      fields: fields ? fields.split(',').map((f) => f.trim()) : undefined,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(result.filename));
    if (result.warnings.length > 0) {
      res.setHeader('X-CSV-Warnings', JSON.stringify(result.warnings));
    }
    res.send(result.content);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRun: string = 'true',
    @Query('mode') mode: 'replace' | 'enrich' = 'enrich',
    @Query('operation') operation: 'upsert' | 'update_only' | 'insert_only' = 'upsert',
    @Tenant() ctx: TenantRequest,
  ) {
    const viewer = incidentViewerFromContext(ctx);
    return this.csvSvc.import(
      file,
      { dryRun: dryRun !== 'false', mode, operation },
      {
        manager: ctx.manager as EntityManager,
        tenantId: ctx.tenantId,
        userId: ctx.userId || null,
        isAdmin: viewer.isAdmin,
        viewer,
      },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get('csv-fields')
  getCsvFields() {
    return this.csvSvc.getFieldInfo();
  }

  // PDF fiche (read — works on closed/cancelled records)

  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequireLevel('incidents', 'reader')
  @Throttle({ default: RATE_LIMITS.documentExport })
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @ExportRoute()
  @Get(':id/report')
  async exportReport(
    @Param('id') idOrRef: string,
    @Query('lang') lang: string | undefined,
    @Query('tz') tz: string | undefined,
    @Res() res: Response,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const id = await this.visibleId(idOrRef, ctx);
    const resolveInlineImage = this.inlineImages.exporter(ctx);
    const result = await this.report.exportPdf(id, lang, {
      manager: ctx.manager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
      viewer: incidentViewerFromContext(ctx),
      // Inline images of the review: resolved internally with the caller's
      // identity; the cookie stays as a fallback for unrecognized internal targets.
      imageFetchCookie: req?.headers?.cookie ?? null,
      ...(resolveInlineImage ? { resolveInlineImage } : {}),
    }, tz);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(result.filename));
    res.send(result.buffer);
  }

  // Journal

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get(':id/entries')
  async listEntries(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.entries.list(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post(':id/entries')
  async createEntry(@Param('id') idOrRef: string, @Body() body: CreateEntryInput, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.entries.createNote(id, body, ctx.userId || null, this.opts(ctx));
  }

  // Linked assets / applications

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get(':id/assets')
  async listAssets(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.relations.listAssets(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post(':id/assets/bulk-replace')
  async bulkReplaceAssets(
    @Param('id') idOrRef: string,
    @Body() body: { asset_ids?: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.relations.bulkReplaceAssets(id, body?.asset_ids ?? [], ctx.userId || null, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get(':id/applications')
  async listApplications(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.relations.listApplications(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post(':id/applications/bulk-replace')
  async bulkReplaceApplications(
    @Param('id') idOrRef: string,
    @Body() body: { application_ids?: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.relations.bulkReplaceApplications(id, body?.application_ids ?? [], ctx.userId || null, this.opts(ctx));
  }

  // Documents (knowledge relations live on the knowledge side)

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get(':id/knowledge')
  async listDocuments(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.knowledge.listDocumentsForEntity('incidents', id, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get(':id/knowledge-context')
  async getKnowledgeContext(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.knowledge.getKnowledgeContextForEntity('incidents', id, { manager: ctx.manager, userId: ctx.userId || null });
  }

  // Integrated documents (the `incidents:review` slot, §3.4)
  //
  // `visibleId`/`editableId` resolve INC-N and fail fast; `ctx.userId` is the
  // only identity ever forwarded (never anything read from the body), and the
  // service builds the §3.7 source access context itself.

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get(':id/integrated-documents/:slotKey')
  async getIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.integratedDocuments.getBySource('incidents', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post(':id/integrated-documents/:slotKey/locks')
  async acquireIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.editableId(idOrRef, ctx);
    return this.integratedDocuments.acquireLockBySource('incidents', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post(':id/integrated-documents/:slotKey/locks/heartbeat')
  async heartbeatIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.editableId(idOrRef, ctx);
    return this.integratedDocuments.heartbeatLockBySource(
      'incidents',
      id,
      slotKey,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  /**
   * Releasing one's own lock stays possible after closure: it does not modify
   * the document (§3.3). Hence `visibleId`, not `editableId`.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Delete(':id/integrated-documents/:slotKey/locks')
  async releaseIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.integratedDocuments.releaseLockBySource(
      'incidents',
      id,
      slotKey,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  /** Administrative unlock: register admin only, on top of the route level. */
  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'admin')
  @Delete(':id/integrated-documents/:slotKey/locks/force')
  async forceReleaseIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.integratedDocuments.forceReleaseLockBySource('incidents', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Patch(':id/integrated-documents/:slotKey')
  async updateIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Body() body: any,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.editableId(idOrRef, ctx);
    return this.integratedDocuments.updateBySource(
      'incidents',
      id,
      slotKey,
      body,
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post(':id/integrated-documents/:slotKey/attachments/inline')
  @UseInterceptors(FileInterceptor('file', inlineImageMulterOptions))
  async uploadIntegratedDocumentInlineAttachment(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.editableId(idOrRef, ctx);
    return this.integratedDocuments.uploadInlineAttachmentBySource(
      'incidents',
      id,
      slotKey,
      file,
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post(':id/integrated-documents/:slotKey/attachments/inline/import')
  async importIntegratedDocumentInlineAttachment(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Body() body: { source_url?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.editableId(idOrRef, ctx);
    return this.integratedDocuments.importInlineAttachmentBySourceUrl(
      'incidents',
      id,
      slotKey,
      body?.source_url || '',
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
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
    const id = await this.editableId(idOrRef, ctx);
    return this.integratedDocuments.importDocumentBySource(
      'incidents',
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
  @RequireLevel('incidents', 'reader')
  @Get(':id/integrated-documents/:slotKey/versions')
  async listIntegratedDocumentVersions(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.integratedDocuments.listVersionsBySource('incidents', id, slotKey, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post(':id/integrated-documents/:slotKey/revert/:versionNumber')
  async revertIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Param('versionNumber') versionNumber: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.editableId(idOrRef, ctx);
    return this.integratedDocuments.revertBySource(
      'incidents',
      id,
      slotKey,
      Number(versionNumber),
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  // Attachments

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get(':id/attachments')
  async listAttachments(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.attachments.listAttachments(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  async uploadAttachment(
    @Param('id') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.attachments.uploadAttachment(id, file, ctx.userId || null, this.opts(ctx));
  }

  // Lifecycle (admin)

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'admin')
  @Post(':id/reopen')
  async reopen(@Param('id') idOrRef: string, @Body() body: IncidentReasonInput, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    const { reason } = parseIncidentReason(body);
    return this.svc.reopen(id, reason, ctx.userId || null, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'admin')
  @Post(':id/cancel')
  async cancel(@Param('id') idOrRef: string, @Body() body: IncidentReasonInput, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    const { reason } = parseIncidentReason(body);
    return this.svc.cancel(id, reason, ctx.userId || null, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'admin')
  @Post(':id/confidentiality')
  async setConfidentiality(
    @Param('id') idOrRef: string,
    @Body() body: IncidentConfidentialityInput,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.visibleId(idOrRef, ctx);
    const { confidential } = parseIncidentConfidentiality(body);
    return this.svc.setConfidentiality(id, confidential, ctx.userId || null, this.opts(ctx));
  }

  // CRUD

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'reader')
  @Get(':id')
  async get(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.svc.get(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Post()
  create(@Body() body: CreateIncidentInput, @Tenant() ctx: TenantRequest) {
    return this.svc.create(body, ctx.userId || null, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('incidents', 'contributor')
  @Patch(':id')
  async update(@Param('id') idOrRef: string, @Body() body: UpdateIncidentInput, @Tenant() ctx: TenantRequest) {
    const id = await this.visibleId(idOrRef, ctx);
    return this.svc.update(id, body, ctx.userId || null, this.opts(ctx));
  }
}
