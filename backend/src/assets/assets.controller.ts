import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { AssetsService } from './services';
import { AssetsDeleteService } from './assets-delete.service';
import { AssetsCsvService } from './assets-csv.service';
import { attachmentMulterOptions, csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { StorageService } from '../common/storage/storage.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly svc: AssetsService,
    private readonly deleteSvc: AssetsDeleteService,
    private readonly csvSvc: AssetsCsvService,
    private readonly storage: StorageService,
    private readonly knowledge: KnowledgeService,
    private readonly tasks: TasksUnifiedService,
  ) {}

  // Attachment download/delete (static routes before :id param routes)
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(@Param('attachmentId') attachmentId: string, @Res() res: Response, @Req() req: any) {
    const meta = await this.svc.downloadAttachment(attachmentId, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) res.setHeader('Content-Length', String(obj.contentLength));
    obj.stream.pipe(res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch('attachments/:attachmentId/delete')
  deleteAttachment(@Param('attachmentId') attachmentId: string, @Req() req: any) {
    return this.svc.deleteAttachment(attachmentId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
  }

  // ==================== CSV ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Get('export')
  async exportCsv(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('fields') fields: string | undefined,
    @Query('preset') preset: string | undefined,
    @Query('environment') environment: string | undefined,
    @Query('kind') kind: string | undefined,
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
      environment,
      kind,
      status,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(result.filename));
    if (result.warnings && result.warnings.length > 0) {
      res.setHeader('X-CSV-Warnings', JSON.stringify(result.warnings));
    }
    res.send(result.content);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
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
  @RequireLevel('infrastructure', 'admin')
  @Get('csv-fields')
  getCsvFields() {
    return this.csvSvc.getFieldInfo();
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) {
    return this.svc.list(query, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('filter-values')
  listFilterValues(@Query() query: any, @Req() req: any) {
    return this.svc.listFilterValues(query, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Req() req: any) {
    return this.svc.listIds(query, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('by-ref/:reference')
  getByReference(@Param('reference') reference: string, @Req() req: any) {
    return this.svc.getByReference(reference, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/map-summary')
  mapSummary(@Param('id') id: string, @Req() req: any) {
    return this.svc.mapSummary(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Post(':id/share')
  share(@Param('id') id: string, @Body() body: ShareItemDto, @Req() req: any) {
    return this.svc.shareAsset(id, body, req?.tenant?.id ?? '', req.user?.sub ?? '', {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/related-tasks')
  async listRelatedTasks(@Param('id') id: string, @Query() query: any, @Req() req: any) {
    const asset = /^AST-\d+$/i.test(String(id || '').trim())
      ? await this.svc.getByReference(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id })
      : await this.svc.get(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
    return this.tasks.listRelatedTasksForAsset(asset.id, query, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/related-tasks/bulk-replace')
  async bulkReplaceRelatedTasks(
    @Param('id') id: string,
    @Body() body: { task_ids?: string[] },
    @Req() req: any,
  ) {
    const asset = /^AST-\d+$/i.test(String(id || '').trim())
      ? await this.svc.getByReference(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id })
      : await this.svc.get(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
    return this.tasks.bulkReplaceTasksForAsset(asset.id, body?.task_ids ?? [], {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/knowledge')
  listDocuments(@Param('id') id: string, @Req() req: any) {
    return this.knowledge.listDocumentsForEntity('assets', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/knowledge-context')
  getKnowledgeContext(@Param('id') id: string, @Req() req: any) {
    return this.knowledge.getKnowledgeContextForEntity('assets', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/members')
  listMembers(@Param('id') id: string, @Req() req: any) {
    return this.svc.listClusterMembers(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/clusters')
  listClustersForAsset(@Param('id') id: string, @Req() req: any) {
    return this.svc.listClustersForAsset(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  // Hardware info extension endpoints
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/hardware-info')
  getHardwareInfo(@Param('id') id: string, @Req() req: any) {
    return this.svc.getHardwareInfo(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/hardware-info')
  upsertHardwareInfo(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.upsertHardwareInfo(id, body, tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Delete(':id/hardware-info')
  deleteHardwareInfo(@Param('id') id: string, @Req() req: any) {
    return this.svc.deleteHardwareInfo(id, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
  }

  // Support info extension endpoints
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/support-info')
  getSupportInfo(@Param('id') id: string, @Req() req: any) {
    return this.svc.getSupportInfo(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/support-info')
  upsertSupportInfo(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.upsertSupportInfo(id, body, tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Delete(':id/support-info')
  deleteSupportInfo(@Param('id') id: string, @Req() req: any) {
    return this.svc.deleteSupportInfo(id, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
  }

  // Asset relations endpoints
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/relations')
  listRelations(@Param('id') id: string, @Req() req: any) {
    return this.svc.listRelations(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/relations')
  replaceRelations(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.bulkReplaceRelations(id, body?.relations ?? [], tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  // Financial link endpoints
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/spend-items')
  listLinkedSpendItems(@Param('id') id: string, @Req() req: any) {
    return this.svc.listLinkedSpendItems(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/spend-items')
  replaceLinkedSpendItems(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.bulkReplaceLinkedSpendItems(id, body?.spend_item_ids ?? [], tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/capex-items')
  listLinkedCapexItems(@Param('id') id: string, @Req() req: any) {
    return this.svc.listLinkedCapexItems(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/capex-items')
  replaceLinkedCapexItems(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.bulkReplaceLinkedCapexItems(id, body?.capex_item_ids ?? [], tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/contracts')
  listLinkedContracts(@Param('id') id: string, @Req() req: any) {
    return this.svc.listLinkedContracts(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/contracts')
  replaceLinkedContracts(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.bulkReplaceLinkedContracts(id, body?.contract_ids ?? [], tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  // Support Contacts
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/support-contacts')
  listSupportContacts(@Param('id') id: string, @Req() req: any) {
    return this.svc.listSupportContacts(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/support-contacts/bulk-replace')
  bulkReplaceSupportContacts(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.bulkReplaceSupportContacts(id, body?.contacts ?? [], tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  // Projects
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/projects')
  listProjects(@Param('id') id: string, @Req() req: any) {
    return this.svc.listProjects(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/projects/bulk-replace')
  bulkReplaceProjects(@Param('id') id: string, @Body() body: { project_ids: string[] }, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.bulkReplaceProjects(id, body?.project_ids ?? [], tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  // Links (URLs)
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/links')
  listLinks(@Param('id') id: string, @Req() req: any) {
    return this.svc.listLinks(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/links')
  createLink(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.createLink(id, body, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch(':id/links/:linkId')
  updateLink(@Param('id') id: string, @Param('linkId') linkId: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateLink(id, linkId, body, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/links/:linkId')
  deleteLink(@Param('id') id: string, @Param('linkId') linkId: string, @Req() req: any) {
    return this.svc.deleteLink(id, linkId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
  }

  // Attachments for asset id
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/attachments')
  listAttachments(@Param('id') id: string, @Req() req: any) {
    return this.svc.listAttachments(id, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  uploadAttachment(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    return this.svc.uploadAttachment(id, file, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post()
  create(@Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.create(body, tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/members')
  replaceMembers(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    const assetIds = body?.asset_ids ?? body?.assetIds ?? body?.server_ids ?? body?.serverIds;
    return this.svc.replaceClusterMembers(id, assetIds, tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.update(id, body, tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      tenantId,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    return this.deleteSvc.bulkDelete(ids, req.user?.sub ?? null, tenantId ?? '', { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.deleteSvc.deleteAsset(id, tenantId ?? '', req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }
}
