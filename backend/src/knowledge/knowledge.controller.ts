import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { Public } from '../auth/public.decorator';
import { RequireLevel } from '../auth/require-level.decorator';
import { REFRESH_TOKEN_COOKIE_NAME, parseCookieValue } from '../auth/auth-cookie.util';
import { contentDisposition } from '../common/content-disposition';
import { attachmentMulterOptions, documentImportMulterOptions, inlineImageMulterOptions } from '../common/upload';
import { createRequestReleaseConnection } from '../common/import-connection';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { resolveTenantAppBaseUrl } from '../common/url';
import { StorageService } from '../common/storage/storage.service';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { KnowledgeService, RelationEntityType } from './knowledge.service';
import { InlineImageResolverService } from './inline-image-resolver.service';
import { KnowledgeRelationsService } from './knowledge-relations.service';
import { KnowledgeWorkflowService } from './knowledge-workflow.service';
import { LongRunningRequest, OUTSIDE_WORK_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly docs: KnowledgeService,
    private readonly relations: KnowledgeRelationsService,
    private readonly workflows: KnowledgeWorkflowService,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
    private readonly inlineImages: InlineImageResolverService,
  ) {}

  private resolveWorkflowBaseUrl(req: any): string | null {
    try {
      return resolveTenantAppBaseUrl(req, req?.tenant?.slug || '');
    } catch {
      return null;
    }
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get()
  list(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.docs.list(query, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.docs.listIds(query, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get('filter-values')
  listFilterValues(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.docs.listFilterValues(query, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get('search')
  search(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.docs.search(query, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get('link-options')
  listLinkOptions(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.docs.listLinkOptions(query, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Get('relation-options/:entity')
  listRelationOptions(
    @Param('entity') entity: string,
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.listRelationOptions(entity as any, query, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      tenantId: ctx.tenantId || null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Get('classification-options')
  listClassificationOptions(@Tenant() ctx: TenantRequest) {
    return this.docs.listClassificationOptions({ manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get('contributor-options')
  listContributorOptions(@Tenant() ctx: TenantRequest) {
    return this.docs.listContributorOptions({ manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    const meta = await this.docs.getAttachmentMeta(attachmentId, { manager: ctx.manager, userId: ctx.userId || null });
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) {
      res.setHeader('Content-Length', String(obj.contentLength));
    }
    obj.stream.pipe(res);
  }

  @Public()
  @Get('inline/:tenantSlug/:attachmentId')
  async viewAttachmentInline(
    @Param('tenantSlug') tenantSlug: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const refreshToken = parseCookieValue(req?.headers?.cookie as string | undefined, REFRESH_TOKEN_COOKIE_NAME);
    const meta = await this.docs.getInlineAttachmentMeta(tenantSlug, attachmentId, refreshToken);
    if (!meta) {
      res.status(404).send('Attachment not found');
      return;
    }

    const obj = await this.storage.getObjectStream(meta.storagePath);
    res.setHeader('Content-Type', obj.contentType || meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition('', 'inline'));
    const contentLength = obj.contentLength ?? meta.size ?? null;
    if (contentLength != null) {
      res.setHeader('Content-Length', String(contentLength));
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Vary', 'Cookie');
    obj.stream.pipe(res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post()
  create(@Body() body: any, @Tenant() ctx: TenantRequest) {
    return this.docs.create(body, ctx.tenantId, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] } | any, @Tenant() ctx: TenantRequest) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    return this.docs.bulkRemove(ids, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post('bulk-move')
  bulkMove(
    @Body() body: { ids: string[]; target_library_id?: string; target_folder_id?: string | null; library_id?: string; folder_id?: string | null } | any,
    @Tenant() ctx: TenantRequest,
  ) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    return this.docs.bulkMove(ids, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get(':idOrRef')
  get(@Param('idOrRef') idOrRef: string, @Tenant() ctx: TenantRequest) {
    return this.docs.get(idOrRef, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Post(':idOrRef/share')
  share(@Param('idOrRef') idOrRef: string, @Body() body: ShareItemDto, @Tenant() ctx: TenantRequest) {
    return this.docs.share(idOrRef, body, ctx.tenantId, ctx.userId || '', { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/move')
  move(@Param('idOrRef') idOrRef: string, @Body() body: any, @Tenant() ctx: TenantRequest) {
    return this.docs.move(idOrRef, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Patch(':idOrRef')
  update(
    @Param('idOrRef') idOrRef: string,
    @Body() body: any,
    @Headers('x-lock-token') lockToken: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.update(idOrRef, body, ctx.userId || '', lockToken, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'admin')
  @Delete(':idOrRef')
  remove(@Param('idOrRef') idOrRef: string, @Tenant() ctx: TenantRequest) {
    return this.docs.remove(idOrRef, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/locks')
  acquireLock(@Param('idOrRef') idOrRef: string, @Tenant() ctx: TenantRequest) {
    return this.docs.acquireLock(idOrRef, ctx.userId || '', { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/locks/heartbeat')
  heartbeatLock(
    @Param('idOrRef') idOrRef: string,
    @Headers('x-lock-token') lockToken: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.heartbeatLock(idOrRef, ctx.userId || '', lockToken, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Delete(':idOrRef/locks')
  releaseLock(
    @Param('idOrRef') idOrRef: string,
    @Headers('x-lock-token') lockToken: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.releaseLock(idOrRef, ctx.userId || '', lockToken, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'admin')
  @Post(':idOrRef/locks/force-release')
  forceReleaseLock(@Param('idOrRef') idOrRef: string, @Tenant() ctx: TenantRequest) {
    return this.docs.forceReleaseLock(idOrRef, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get(':idOrRef/versions')
  listVersions(@Param('idOrRef') idOrRef: string, @Tenant() ctx: TenantRequest) {
    return this.docs.listVersions(idOrRef, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/versions')
  createVersion(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { change_note?: string | null },
    @Headers('x-lock-token') lockToken: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.createVersion(idOrRef, body, ctx.userId || '', lockToken, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get(':idOrRef/versions/compare')
  compareVersions(
    @Param('idOrRef') idOrRef: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.compareVersions(idOrRef, Number(from), Number(to), { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get(':idOrRef/versions/:versionNumber')
  getVersion(
    @Param('idOrRef') idOrRef: string,
    @Param('versionNumber') versionNumber: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.getVersion(idOrRef, Number(versionNumber), { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/revert/:versionNumber')
  revert(
    @Param('idOrRef') idOrRef: string,
    @Param('versionNumber') versionNumber: string,
    @Headers('x-lock-token') lockToken: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.revert(idOrRef, Number(versionNumber), ctx.userId || '', lockToken, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/contributors/bulk-replace')
  bulkReplaceContributors(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { contributors: any[] } | any[],
    @Tenant() ctx: TenantRequest,
  ) {
    const contributors = Array.isArray(body) ? body : body?.contributors ?? [];
    return this.docs.bulkReplaceContributors(idOrRef, contributors, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/classifications/bulk-replace')
  bulkReplaceClassifications(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { classifications: any[] } | any[],
    @Tenant() ctx: TenantRequest,
  ) {
    const classifications = Array.isArray(body) ? body : body?.classifications ?? [];
    return this.docs.bulkReplaceClassifications(idOrRef, classifications, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/relations/bulk-replace')
  bulkReplaceRelationSets(
    @Param('idOrRef') idOrRef: string,
    @Body() body:
      | Partial<Record<RelationEntityType, string[]>>
      | { relations?: Partial<Record<RelationEntityType, string[]>> },
    @Tenant() ctx: TenantRequest,
  ) {
    const relationBody = body as any;
    const relations: Partial<Record<RelationEntityType, string[]>> = (
      relationBody
      && typeof relationBody === 'object'
      && !Array.isArray(relationBody)
      && Object.prototype.hasOwnProperty.call(relationBody, 'relations')
        ? relationBody.relations
        : relationBody
    ) ?? {};
    return this.relations.bulkReplaceRelationSets(idOrRef, relations || {}, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/relations/applications/bulk-replace')
  bulkReplaceApplicationRelations(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { application_ids: string[] } | string[],
    @Tenant() ctx: TenantRequest,
  ) {
    const ids = Array.isArray(body) ? body : body?.application_ids ?? [];
    return this.relations.bulkReplaceRelations(idOrRef, 'applications', ids, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/relations/assets/bulk-replace')
  bulkReplaceAssetRelations(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { asset_ids: string[] } | string[],
    @Tenant() ctx: TenantRequest,
  ) {
    const ids = Array.isArray(body) ? body : body?.asset_ids ?? [];
    return this.relations.bulkReplaceRelations(idOrRef, 'assets', ids, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/relations/projects/bulk-replace')
  bulkReplaceProjectRelations(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { project_ids: string[] } | string[],
    @Tenant() ctx: TenantRequest,
  ) {
    const ids = Array.isArray(body) ? body : body?.project_ids ?? [];
    return this.relations.bulkReplaceRelations(idOrRef, 'projects', ids, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/relations/requests/bulk-replace')
  bulkReplaceRequestRelations(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { request_ids: string[] } | string[],
    @Tenant() ctx: TenantRequest,
  ) {
    const ids = Array.isArray(body) ? body : body?.request_ids ?? [];
    return this.relations.bulkReplaceRelations(idOrRef, 'requests', ids, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/relations/tasks/bulk-replace')
  bulkReplaceTaskRelations(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { task_ids: string[] } | string[],
    @Tenant() ctx: TenantRequest,
  ) {
    const ids = Array.isArray(body) ? body : body?.task_ids ?? [];
    return this.relations.bulkReplaceRelations(idOrRef, 'tasks', ids, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/relations/incidents/bulk-replace')
  bulkReplaceIncidentRelations(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { incident_ids: string[] } | string[],
    @Tenant() ctx: TenantRequest,
  ) {
    const ids = Array.isArray(body) ? body : body?.incident_ids ?? [];
    return this.relations.bulkReplaceRelations(idOrRef, 'incidents', ids, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/relations/:entity/bulk-replace')
  bulkReplaceGenericRelations(
    @Param('idOrRef') idOrRef: string,
    @Param('entity') entity: RelationEntityType,
    @Body() body: Record<string, unknown> | string[],
    @Tenant() ctx: TenantRequest,
  ) {
    const bodyKeyByEntity: Record<RelationEntityType, string> = {
      applications: 'application_ids',
      assets: 'asset_ids',
      projects: 'project_ids',
      requests: 'request_ids',
      tasks: 'task_ids',
      locations: 'location_ids',
      connections: 'connection_ids',
      interfaces: 'interface_ids',
      incidents: 'incident_ids',
    };
    const bodyKey = bodyKeyByEntity[entity];
    const ids = Array.isArray(body) ? body : (
      Array.isArray(body?.[bodyKey])
        ? body[bodyKey]
        : Array.isArray(body?.ids)
          ? body.ids
          : []
    );
    return this.relations.bulkReplaceRelations(idOrRef, entity, ids as string[], {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/relations/:entity/items/:targetId')
  addRelation(
    @Param('idOrRef') idOrRef: string,
    @Param('entity') entity: string,
    @Param('targetId') targetId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.relations.addRelation(idOrRef, entity as any, targetId, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Delete(':idOrRef/relations/:entity/items/:targetId')
  removeRelation(
    @Param('idOrRef') idOrRef: string,
    @Param('entity') entity: string,
    @Param('targetId') targetId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.relations.removeRelation(idOrRef, entity as any, targetId, {
      manager: ctx.manager,
      userId: ctx.userId || null,
      guardAgainstActiveLock: true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get(':idOrRef/references/incoming')
  listIncomingReferences(@Param('idOrRef') idOrRef: string, @Tenant() ctx: TenantRequest) {
    return this.docs.listIncomingReferences(idOrRef, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/workflow/request')
  requestWorkflowReview(
    @Param('idOrRef') idOrRef: string,
    @Body() body: any,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const appBaseUrl = this.resolveWorkflowBaseUrl(req);
    return this.workflows.requestWorkflowReview(idOrRef, body, ctx.userId || '', appBaseUrl, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Post(':idOrRef/workflow/approve')
  approveWorkflow(
    @Param('idOrRef') idOrRef: string,
    @Body() body: any,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const appBaseUrl = this.resolveWorkflowBaseUrl(req);
    return this.workflows.approveWorkflow(idOrRef, body, ctx.userId || '', appBaseUrl, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Post(':idOrRef/workflow/request-changes')
  requestWorkflowChanges(
    @Param('idOrRef') idOrRef: string,
    @Body() body: any,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const appBaseUrl = this.resolveWorkflowBaseUrl(req);
    return this.workflows.requestWorkflowChanges(idOrRef, body, ctx.userId || '', appBaseUrl, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/workflow/cancel')
  cancelWorkflowReview(
    @Param('idOrRef') idOrRef: string,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    const appBaseUrl = this.resolveWorkflowBaseUrl(req);
    return this.workflows.cancelWorkflowReview(idOrRef, ctx.userId || '', appBaseUrl, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get(':idOrRef/attachments')
  listAttachments(@Param('idOrRef') idOrRef: string, @Tenant() ctx: TenantRequest) {
    return this.docs.listAttachments(idOrRef, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  uploadAttachment(
    @Param('idOrRef') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.uploadAttachment(idOrRef, file, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/attachments/inline')
  @UseInterceptors(FileInterceptor('file', inlineImageMulterOptions))
  uploadInlineAttachment(
    @Param('idOrRef') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { source_field?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.uploadAttachment(idOrRef, file, ctx.userId || null, {
      manager: ctx.manager,
      sourceField: body?.source_field || 'content_markdown',
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/attachments/inline/import')
  importInlineAttachmentFromUrl(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { source_field?: string; source_url?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.importInlineAttachmentFromUrl(idOrRef, body?.source_url || '', ctx.userId || null, {
      manager: ctx.manager,
      sourceField: body?.source_field || 'content_markdown',
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Delete(':idOrRef/attachments/:attachmentId')
  deleteAttachment(
    @Param('idOrRef') idOrRef: string,
    @Param('attachmentId') attachmentId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.deleteAttachment(idOrRef, attachmentId, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get(':idOrRef/activities')
  listActivities(@Param('idOrRef') idOrRef: string, @Tenant() ctx: TenantRequest) {
    return this.docs.listActivities(idOrRef, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':idOrRef/activities')
  createActivity(@Param('idOrRef') idOrRef: string, @Body() body: any, @Tenant() ctx: TenantRequest) {
    return this.docs.createActivity(idOrRef, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Patch(':idOrRef/activities/:activityId')
  updateActivity(
    @Param('idOrRef') idOrRef: string,
    @Param('activityId') activityId: string,
    @Body() body: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.updateActivity(idOrRef, activityId, body, ctx.userId || '', { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post(':idOrRef/export')
  async exportDocument(
    @Param('idOrRef') idOrRef: string,
    @Body() body: { format?: 'pdf' | 'docx' | 'odt' },
    @Req() req: any,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const format = body?.format || 'pdf';
    const resolveInlineImage = this.inlineImages.exporter(ctx);
    const output = await this.docs.exportDocument(idOrRef, format, {
      manager: ctx.manager,
      imageFetchCookie: req?.headers?.cookie,
      userId: ctx.userId || null,
      ...(resolveInlineImage ? { resolveInlineImage } : {}),
    });

    res.setHeader('Content-Type', output.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(output.filename));
    res.send(output.buffer);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.documentImport })
  @Post(':idOrRef/import')
  @UseInterceptors(FileInterceptor('file', documentImportMulterOptions))
  importDocument(
    @Param('idOrRef') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-lock-token') lockToken: string | undefined,
    @Req() req: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.docs.importDocument(idOrRef, file, ctx.userId || null, lockToken, {
      manager: ctx.manager,
      releaseConnection: createRequestReleaseConnection(req, this.dataSource, ctx.tenantId),
    });
  }
}
