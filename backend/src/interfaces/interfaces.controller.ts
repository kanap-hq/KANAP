import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { InterfacesService } from './services';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { attachmentMulterOptions, documentImportMulterOptions, inlineImageMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { StorageService } from '../common/storage/storage.service';
import { createRequestReleaseConnection } from '../common/import-connection';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitGuard } from '../common/rate-limit.guard';
import {
  CreateInterfaceInput,
  UpdateInterfaceInput,
  ListInterfacesQueryInput,
} from './dto';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { resolveBusinessContributorScopeForUser } from '../auth/business-contributor-scope';

@UseGuards(JwtAuthGuard)
@Controller('interfaces')
export class InterfacesController {
  constructor(
    private readonly svc: InterfacesService,
    private readonly storage: StorageService,
    private readonly integratedDocuments: IntegratedDocumentsService,
    private readonly knowledge: KnowledgeService,
    private readonly dataSource: DataSource,
  ) {}

  private async assertUnrestrictedApplicationReader(ctx: TenantRequest) {
    if (!ctx.manager) {
      throw new ForbiddenException('Access scope could not be resolved');
    }
    const accessScope = await resolveBusinessContributorScopeForUser({
      manager: ctx.manager,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    }, 'applications', 'reader');
    if (accessScope) {
      throw new ForbiddenException('Business Contributor cannot access interfaces');
    }
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get()
  async list(
    @Query() query: ListInterfacesQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.list(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('ids')
  async listIds(
    @Query() query: ListInterfacesQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listIds(query, { manager: ctx.manager });
  }

  // Declared before ':id', which would otherwise take 'filter-values' for an id.
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('filter-values/business-processes')
  async businessProcessFilterValues(@Tenant() ctx: TenantRequest) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.businessProcessFilterValues({ manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('map')
  async getMap(
    @Query() query: ListInterfacesQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.getMap(query, ctx.tenantId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Post(':id/share')
  async share(
    @Param('id') id: string,
    @Body() body: ShareItemDto,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.shareInterface(id, body, ctx.tenantId, ctx.userId || '', {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('by-application/:applicationId')
  async listByApplication(
    @Param('applicationId') applicationId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listByApplication(applicationId, ctx.tenantId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/connection-links')
  async listConnectionLinksForInterface(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listConnectionLinksForInterface(id, ctx.tenantId, query, {
      manager: ctx.manager,
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
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.integratedDocuments.getBySource('interfaces', id, slotKey, ctx.userId || null, {
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
    return this.integratedDocuments.acquireLockBySource('interfaces', id, slotKey, ctx.userId || null, {
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
      'interfaces',
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
      'interfaces',
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
      'interfaces',
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
      'interfaces',
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
      'interfaces',
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
      'interfaces',
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
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.integratedDocuments.listVersionsBySource('interfaces', id, slotKey, ctx.userId || null, {
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
      'interfaces',
      id,
      slotKey,
      Number(versionNumber),
      ctx.userId || null,
      req?.headers?.['x-lock-token'],
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/knowledge-context')
  async getKnowledgeContext(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.knowledge.getKnowledgeContextForEntity('interfaces', id, {
      manager: ctx.manager,
      userId: ctx.userId || null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.get(id, query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/legs')
  async listLegs(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listLegs(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post()
  create(
    @Body() body: CreateInterfaceInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.create(body as Record<string, unknown>, ctx.tenantId, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/duplicate')
  duplicate(
    @Param('id') id: string,
    @Body() body: { copyBindings?: boolean },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.duplicate(id, ctx.tenantId, ctx.userId || null, {
      manager: ctx.manager,
      copyBindings: body?.copyBindings === true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateInterfaceInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.update(id, body as Record<string, unknown>, ctx.tenantId, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch(':id/legs')
  updateLegs(
    @Param('id') id: string,
    @Body() body: { legs: Array<Record<string, unknown>> },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.updateLegs(id, body, ctx.tenantId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'admin')
  @Delete('bulk')
  bulkDelete(
    @Body() body: { ids: string[]; deleteRelatedBindings?: boolean },
    @Tenant() ctx: TenantRequest,
  ) {
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    return this.svc.bulkDelete(ids, ctx.userId || null, {
      manager: ctx.manager,
      deleteRelatedBindings: body?.deleteRelatedBindings === true,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete(':id')
  delete(
    @Param('id') id: string,
    @Body() body: { deleteRelatedBindings?: boolean },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.delete(id, ctx.userId || null, {
      manager: ctx.manager,
      deleteRelatedBindings: body?.deleteRelatedBindings === true,
    });
  }

  // Owners
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/owners')
  async listOwners(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listOwners(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/owners/bulk-replace')
  bulkReplaceOwners(
    @Param('id') id: string,
    @Body() body: { owners: Array<{ user_id: string; owner_type: 'business' | 'it' }> },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.bulkReplaceOwners(id, body?.owners ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Companies
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/companies')
  async listCompanies(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listCompanies(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/companies/bulk-replace')
  bulkReplaceCompanies(
    @Param('id') id: string,
    @Body() body: { company_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.bulkReplaceCompanies(id, body?.company_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Dependencies
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/dependencies')
  async listDependencies(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listDependencies(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/dependencies/bulk-replace')
  bulkReplaceDependencies(
    @Param('id') id: string,
    @Body() body: { upstream_ids?: string[]; downstream_ids?: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.bulkReplaceDependencies(
      id,
      body?.upstream_ids ?? [],
      body?.downstream_ids ?? [],
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }

  // Key identifiers
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/key-identifiers')
  async listKeyIdentifiers(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listKeyIdentifiers(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/key-identifiers/bulk-replace')
  bulkReplaceKeyIdentifiers(
    @Param('id') id: string,
    @Body()
    body: { items: Array<{ source_identifier: string; destination_identifier: string; identifier_notes?: string | null }> },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.bulkReplaceKeyIdentifiers(id, body?.items ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Data residency
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/data-residency')
  async listDataResidency(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listDataResidency(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/data-residency/bulk-replace')
  bulkReplaceDataResidency(
    @Param('id') id: string,
    @Body() body: { countries: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.bulkReplaceDataResidency(id, body?.countries ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Links
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/links')
  async listLinks(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listLinks(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/links/bulk-replace')
  bulkReplaceLinks(
    @Param('id') id: string,
    @Body() body: { links: Array<{ kind?: string; description?: string | null; url: string }> },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.bulkReplaceLinks(id, body?.links ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/links')
  createLink(
    @Param('id') id: string,
    @Body() body: { description?: string; url: string },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.createLink(id, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch(':id/links/:linkId')
  updateLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() body: { description?: string; url?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.updateLink(id, linkId, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete(':id/links/:linkId')
  deleteLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.deleteLink(id, linkId, ctx.userId || null, { manager: ctx.manager });
  }

  // Attachments for interface id
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/attachments')
  async listAttachments(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.svc.listAttachments(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.uploadAttachment(id, file, body, ctx.userId || null, {
      manager: ctx.manager,
    });
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
    await this.assertUnrestrictedApplicationReader(ctx);
    const meta = await this.svc.downloadAttachment(attachmentId, { manager: ctx.manager });
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
  ) {
    return this.svc.deleteAttachment(attachmentId, ctx.userId || null, {
      manager: ctx.manager,
    });
  }
}
