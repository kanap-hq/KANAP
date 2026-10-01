import {
  Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Public } from '../auth/public.decorator';
import { PortfolioRequestsService } from './portfolio-requests.service';
import { PortfolioRequestsCsvService } from './portfolio-requests-csv.service';
import { PortfolioProjectsService } from './services';
import { StorageService } from '../common/storage/storage.service';
import { attachmentMulterOptions, csvImportMulterOptions, documentImportMulterOptions, inlineImageMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { createRequestReleaseConnection } from '../common/import-connection';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { resolveToUuid } from '../common/resolve-item-id';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { resolveInlineTenantSlug } from '../common/resolve-inline-tenant-slug';
import { PermissionsService, PermissionLevel } from '../permissions/permissions.service';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { REFRESH_TOKEN_COOKIE_NAME, parseCookieValue } from '../auth/auth-cookie.util';
import { resolveBusinessContributorScope, taskParticipantCondition } from '../auth/business-contributor-scope';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

const RANK: Record<PermissionLevel, number> = {
  reader: 1,
  contributor: 2,
  member: 3,
  admin: 4,
};

@UseGuards(JwtAuthGuard)
@Controller('portfolio/requests')
export class PortfolioRequestsController {
  constructor(
    private readonly svc: PortfolioRequestsService,
    private readonly csvSvc: PortfolioRequestsCsvService,
    private readonly projectsSvc: PortfolioProjectsService,
    private readonly storage: StorageService,
    private readonly permissionsSvc: PermissionsService,
    private readonly knowledge: KnowledgeService,
    private readonly integratedDocuments: IntegratedDocumentsService,
    private readonly dataSource: DataSource,
  ) {}

  private resolve(idOrRef: string, req: any): Promise<string> {
    return resolveToUuid(idOrRef, 'request', req.queryRunner.manager);
  }

  private requestAccessScope(req: any, level: PermissionLevel = 'reader') {
    return resolveBusinessContributorScope(req, 'portfolio_requests', level);
  }

  private async resolveForAccess(idOrRef: string, req: any, level: PermissionLevel = 'reader') {
    const id = await this.resolve(idOrRef, req);
    const accessScope = await this.requestAccessScope(req, level);
    await this.svc.assertVisible(id, accessScope, { manager: req?.queryRunner?.manager });
    return { id, accessScope };
  }

  private async ensureTasksMemberPermission(req: any): Promise<void> {
    if (req?.isAdmin === true) return;

    const userId = req?.user?.sub;
    const manager = req?.queryRunner?.manager;
    if (!userId || !manager) {
      throw new ForbiddenException('Task conversion permission check failed');
    }

    const userRows = await manager.query(
      'SELECT role_id FROM users WHERE id = $1 LIMIT 1',
      [userId],
    ) as Array<{ role_id: string | null }>;
    const userRow = userRows[0];
    if (!userRow) {
      throw new ForbiddenException('User not found');
    }

    const extraRoleRows = await manager.query(
      'SELECT role_id FROM user_roles WHERE user_id = $1',
      [userId],
    ) as Array<{ role_id: string | null }>;
    const roleIds = Array.from(new Set([
      userRow.role_id,
      ...extraRoleRows.map((row) => row.role_id),
    ].filter(Boolean) as string[]));

    const permissions = await this.permissionsSvc.listForRoles(roleIds, { manager });
    const tasksLevel = permissions.get('tasks');
    if (!tasksLevel || RANK[tasksLevel] < RANK.member) {
      throw new ForbiddenException('tasks:member permission is required');
    }
  }

  private async ensureTaskConversionScope(taskId: string, req: any): Promise<void> {
    const accessScope = await resolveBusinessContributorScope(req, 'tasks', 'member');
    if (!accessScope) return;
    const rows = await req?.queryRunner?.manager.query(
      `SELECT 1
       FROM tasks t
       WHERE t.id = $1
         AND ${taskParticipantCondition('t', '$2')}
       LIMIT 1`,
      [taskId, accessScope.userId],
    );
    if (!rows?.length) {
      throw new ForbiddenException('Task is outside your access scope');
    }
  }

  // ==================== CRUD ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get()
  async list(@Query() query: any, @Req() req: any) {
    const accessScope = await this.requestAccessScope(req, 'reader');
    return this.svc.list(query, { manager: req?.queryRunner?.manager, accessScope });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('ids')
  async listIds(@Query() query: any, @Req() req: any) {
    const accessScope = await this.requestAccessScope(req, 'reader');
    return this.svc.listIds(query, { manager: req?.queryRunner?.manager, accessScope });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('filter-values')
  async listFilterValues(@Query() query: any, @Req() req: any) {
    const accessScope = await this.requestAccessScope(req, 'reader');
    return this.svc.listFilterValues(query, { manager: req?.queryRunner?.manager, accessScope });
  }

  // ==================== CSV ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'admin')
  @Get('export')
  async exportCsv(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('fields') fields: string | undefined,
    @Query('preset') preset: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    const result = await this.csvSvc.export({
      manager: req?.queryRunner?.manager,
      tenantId,
      scope,
      fields: fields ? fields.split(',').map((f) => f.trim()) : undefined,
      preset,
      status,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(result.filename));
    res.send(result.content);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'admin')
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
      },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'admin')
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
  ) {
    // Look up tenant by slug and set app.current_tenant for RLS
    // Private + Vary:Cookie on every response (incl. 404) so no shared cache serves
    // tenant bytes and denials aren't cached across sessions.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Vary', 'Cookie');
    const refreshToken = parseCookieValue(req?.headers?.cookie as string | undefined, REFRESH_TOKEN_COOKIE_NAME);
    const effectiveSlug = resolveInlineTenantSlug(tenantSlug);
    const dataSource = this.svc['repo'].manager.connection;
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
      // Only embedded images (source_field set) are served on this inline route.
      const rows = await runner.query(
        `SELECT storage_path, mime_type, size FROM portfolio_request_attachments WHERE id = $1 AND source_field IS NOT NULL LIMIT 1`,
        [attachmentId],
      );
      // Require the caller to be an authenticated tenant user with >= reader on portfolio_requests.
      const allowed = rows.length > 0
        && await this.knowledge.canAccessInlineAttachment(runner.manager, tenantId, refreshToken, 'portfolio_requests');
      if (!allowed) {
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

  // Attachment download needs to be before :id route
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const meta = await this.svc.getAttachment(attachmentId, { manager: req?.queryRunner?.manager });
    const accessScope = await this.requestAccessScope(req, 'reader');
    await this.svc.assertVisible(meta.request_id, accessScope, { manager: req?.queryRunner?.manager });
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) res.setHeader('Content-Length', String(obj.contentLength));
    obj.stream.pipe(res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get(':id')
  async get(@Param('id') idOrRef: string, @Query() query: any, @Req() req: any) {
    const { id, accessScope } = await this.resolveForAccess(idOrRef, req, 'reader');
    return this.svc.get(id, query, { manager: req?.queryRunner?.manager, accessScope });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get(':id/knowledge')
  async listDocuments(@Param('id') idOrRef: string, @Req() req: any) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'reader');
    return this.knowledge.listDocumentsForEntity('requests', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get(':id/knowledge-context')
  async getKnowledgeContext(@Param('id') idOrRef: string, @Req() req: any) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'reader');
    return this.knowledge.getKnowledgeContextForEntity('requests', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get(':id/integrated-documents/:slotKey')
  async getIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'reader');
    return this.integratedDocuments.getBySource('requests', id, slotKey, req?.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/integrated-documents/:slotKey/locks')
  async acquireIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.integratedDocuments.acquireLockBySource('requests', id, slotKey, req?.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/integrated-documents/:slotKey/locks/heartbeat')
  async heartbeatIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.integratedDocuments.heartbeatLockBySource(
      'requests',
      id,
      slotKey,
      req?.user?.sub ?? null,
      req?.headers?.['x-lock-token'],
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Delete(':id/integrated-documents/:slotKey/locks')
  async releaseIntegratedDocumentLock(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.integratedDocuments.releaseLockBySource(
      'requests',
      id,
      slotKey,
      req?.user?.sub ?? null,
      req?.headers?.['x-lock-token'],
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Patch(':id/integrated-documents/:slotKey')
  async updateIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.integratedDocuments.updateBySource(
      'requests',
      id,
      slotKey,
      body,
      req?.user?.sub ?? null,
      req?.headers?.['x-lock-token'],
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/integrated-documents/:slotKey/attachments/inline')
  @UseInterceptors(FileInterceptor('file', inlineImageMulterOptions))
  async uploadIntegratedDocumentInlineAttachment(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.integratedDocuments.uploadInlineAttachmentBySource(
      'requests',
      id,
      slotKey,
      file,
      req?.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/integrated-documents/:slotKey/attachments/inline/import')
  async importIntegratedDocumentInlineAttachment(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Body() body: { source_url?: string },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.integratedDocuments.importInlineAttachmentBySourceUrl(
      'requests',
      id,
      slotKey,
      body?.source_url || '',
      req?.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.documentImport })
  @Post(':id/integrated-documents/:slotKey/import')
  @UseInterceptors(FileInterceptor('file', documentImportMulterOptions))
  async importIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.integratedDocuments.importDocumentBySource(
      'requests',
      id,
      slotKey,
      file,
      req?.user?.sub ?? null,
      req?.headers?.['x-lock-token'],
      {
        manager: req?.queryRunner?.manager,
        releaseConnection: createRequestReleaseConnection(req, this.dataSource, req?.tenant?.id ?? ''),
      },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get(':id/integrated-documents/:slotKey/versions')
  async listIntegratedDocumentVersions(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'reader');
    return this.integratedDocuments.listVersionsBySource('requests', id, slotKey, req?.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/integrated-documents/:slotKey/revert/:versionNumber')
  async revertIntegratedDocument(
    @Param('id') idOrRef: string,
    @Param('slotKey') slotKey: string,
    @Param('versionNumber') versionNumber: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.integratedDocuments.revertBySource(
      'requests',
      id,
      slotKey,
      Number(versionNumber),
      req?.user?.sub ?? null,
      req?.headers?.['x-lock-token'],
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post()
  create(@Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.create(body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Patch(':id')
  async update(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.update(id, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== DELETE ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'admin')
  @Delete(':id')
  async delete(@Param('id') idOrRef: string, @Req() req: any) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'admin');
    return this.svc.delete(id, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== SHARE ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Post(':id/share')
  async share(
    @Param('id') idOrRef: string,
    @Body() body: ShareItemDto,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'reader');
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.shareRequest(id, body, tenantId, req.user?.sub ?? '', {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== TEAM MANAGEMENT ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/business-team/bulk-replace')
  async bulkReplaceBusinessTeam(
    @Param('id') idOrRef: string,
    @Body() body: { user_ids: string[] },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.bulkReplaceTeam(id, 'business_team', body?.user_ids ?? [], {
      manager: req?.queryRunner?.manager,
      userId: req.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/it-team/bulk-replace')
  async bulkReplaceItTeam(
    @Param('id') idOrRef: string,
    @Body() body: { user_ids: string[] },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.bulkReplaceTeam(id, 'it_team', body?.user_ids ?? [], {
      manager: req?.queryRunner?.manager,
      userId: req.user?.sub ?? null,
    });
  }

  // ==================== CONTACTS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/contacts/bulk-replace')
  async bulkReplaceContacts(
    @Param('id') idOrRef: string,
    @Body() body: { contact_ids: string[] },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.bulkReplaceContacts(id, body?.contact_ids ?? [], {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== DEPENDENCIES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/dependencies')
  async addDependency(
    @Param('id') idOrRef: string,
    @Body() body: { target_type: 'request' | 'project'; target_id: string },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.addDependency(id, body.target_type, body.target_id, tenantId, {
      manager: req?.queryRunner?.manager,
      userId: req.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Delete(':id/dependencies/:targetType/:targetId')
  async removeDependency(
    @Param('id') idOrRef: string,
    @Param('targetType') targetType: 'request' | 'project',
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.removeDependency(id, targetType, targetId, {
      manager: req?.queryRunner?.manager,
      userId: req.user?.sub ?? null,
    });
  }

  // ==================== LINKED APPLICATIONS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get(':id/applications')
  async listLinkedApplications(
    @Param('id') idOrRef: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'reader');
    return this.svc.listLinkedApplications(id, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/applications/bulk-replace')
  async bulkReplaceApplications(
    @Param('id') idOrRef: string,
    @Body() body: { application_ids: string[] },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.bulkReplaceApplications(id, body?.application_ids ?? [], {
      manager: req?.queryRunner?.manager,
      userId: req.user?.sub ?? null,
    });
  }

  // ==================== LINKED ASSETS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get(':id/assets')
  async listLinkedAssets(
    @Param('id') idOrRef: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'reader');
    return this.svc.listLinkedAssets(id, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/assets/bulk-replace')
  async bulkReplaceAssets(
    @Param('id') idOrRef: string,
    @Body() body: { asset_ids: string[] },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.bulkReplaceAssets(id, body?.asset_ids ?? [], {
      manager: req?.queryRunner?.manager,
      userId: req.user?.sub ?? null,
    });
  }

  // ==================== CAPEX ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/capex/bulk-replace')
  async bulkReplaceCapex(
    @Param('id') idOrRef: string,
    @Body() body: { capex_ids: string[] },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.bulkReplaceCapex(id, body?.capex_ids ?? [], {
      manager: req?.queryRunner?.manager,
      userId: req.user?.sub ?? null,
    });
  }

  // ==================== OPEX ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/opex/bulk-replace')
  async bulkReplaceOpex(
    @Param('id') idOrRef: string,
    @Body() body: { opex_ids: string[] },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.bulkReplaceOpex(id, body?.opex_ids ?? [], {
      manager: req?.queryRunner?.manager,
      userId: req.user?.sub ?? null,
    });
  }

  // ==================== BUSINESS PROCESSES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/business-processes/bulk-replace')
  async bulkReplaceBusinessProcesses(
    @Param('id') idOrRef: string,
    @Body() body: { business_process_ids: string[] },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.bulkReplaceBusinessProcesses(id, body?.business_process_ids ?? [], {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== URLs ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/urls')
  async replaceUrls(
    @Param('id') idOrRef: string,
    @Body() body: { urls: Array<{ url: string; label?: string }> },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.replaceUrls(id, body?.urls ?? [], {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== COMMENTS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
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
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.addComment(
      id,
      body?.content ?? '',
      body?.context ?? null,
      tenantId,
      req.user?.sub ?? null,
      {
        manager: req?.queryRunner?.manager,
        isDecision: body?.is_decision,
        decisionOutcome: body?.decision_outcome,
        newStatus: body?.new_status,
      },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Patch(':id/comments/:activityId')
  async updateComment(
    @Param('id') idOrRef: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() body: { content: string },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('User ID required');
    }
    return this.svc.updateComment(id, activityId, body?.content ?? '', userId, {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== ATTACHMENTS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  async uploadAttachment(
    @Param('id') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.uploadAttachment(id, file, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  // Inline attachment upload for rich text editor images
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/attachments/inline')
  @UseInterceptors(FileInterceptor('file', inlineImageMulterOptions))
  async uploadInlineAttachment(
    @Param('id') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('source_field') sourceField: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.uploadInlineAttachment(id, file, sourceField || 'content', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post(':id/attachments/inline/import')
  async importInlineAttachment(
    @Param('id') idOrRef: string,
    @Body() body: { source_field?: string; source_url?: string },
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.importInlineAttachmentFromUrl(
      id,
      body?.source_url || '',
      body?.source_field || 'content',
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Delete(':id/attachments/:attachmentId')
  async deleteAttachment(
    @Param('id') idOrRef: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: any,
  ) {
    await this.resolveForAccess(idOrRef, req, 'member');
    return this.svc.deleteAttachment(attachmentId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  // ==================== CONVERSION ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get(':id/estimated-effort')
  async getEstimatedEffort(
    @Param('id') idOrRef: string,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'reader');
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getEstimatedEffort(id, tenantId, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post(':id/convert')
  async convertToProject(
    @Param('id') idOrRef: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const { id } = await this.resolveForAccess(idOrRef, req, 'reader');
    const tenantId = req?.tenant?.id ?? '';
    return this.projectsSvc.convertFromRequest(id, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post('from-task/:taskId')
  async convertFromTask(
    @Param('taskId') taskIdOrRef: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    await this.ensureTasksMemberPermission(req);
    const taskId = await resolveToUuid(taskIdOrRef, 'task', req.queryRunner.manager);
    await this.ensureTaskConversionScope(taskId, req);
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.convertFromTask(taskId, body ?? {}, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }
}
