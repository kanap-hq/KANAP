import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, Delete } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContractsService } from './contracts.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { attachmentMulterOptions, csvImportMulterOptions } from '../common/upload';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ContractUpsertDto } from './dto/contract.dto';
import { StorageService } from '../common/storage/storage.service';
import { contentDisposition } from '../common/content-disposition';
import { ContractContactsService } from './contract-contacts.service';
import { SupplierContactRole } from '../contacts/supplier-contact.entity';

@UseGuards(JwtAuthGuard)
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly svc: ContractsService,
    private readonly storage: StorageService,
    private readonly contactsSvc: ContractContactsService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) { return this.svc.list(query, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Req() req: any) { return this.svc.listIds(query, { manager: req?.queryRunner?.manager }); }

  // Export route before :id
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Get('export')
  async export(@Query('scope') scope: 'template' | 'data' = 'data', @Res() res: Response, @Req() req: any) {
    const { filename, content } = await this.svc.exportCsv(scope, { manager: req?.queryRunner?.manager });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  // Attachments: define static segment before parameterized ':id'
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(@Param('attachmentId') attachmentId: string, @Res() res: Response, @Req() req: any) {
    const meta = await this.svc.downloadAttachment(attachmentId, { manager: req?.queryRunner?.manager });
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) res.setHeader('Content-Length', String(obj.contentLength));
    obj.stream.pipe(res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Patch('attachments/:attachmentId/delete')
  deleteAttachment(@Param('attachmentId') attachmentId: string, @Req() req: any) {
    return this.svc.deleteAttachment(attachmentId, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) { return this.svc.get(id, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post()
  create(@Body() body: ContractUpsertDto, @Req() req: any) { return this.svc.create(body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ContractUpsertDto, @Req() req: any) { return this.svc.update(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

  // Links to OPEX
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/spend-items')
  listLinked(@Param('id') id: string, @Req() req: any) { return this.svc.listLinkedSpendItems(id, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/spend-items/bulk-replace')
  bulkReplace(@Param('id') id: string, @Body() body: { spend_item_ids: string[] }, @Req() req: any) {
    return this.svc.bulkReplaceLinkedSpendItems(id, body?.spend_item_ids ?? [], { manager: req?.queryRunner?.manager });
  }

  // Links to CAPEX
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/capex-items')
  listLinkedCapex(@Param('id') id: string, @Req() req: any) { return this.svc.listLinkedCapexItems(id, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/capex-items/bulk-replace')
  bulkReplaceCapex(@Param('id') id: string, @Body() body: { capex_item_ids: string[] }, @Req() req: any) {
    return this.svc.bulkReplaceLinkedCapexItems(id, body?.capex_item_ids ?? [], { manager: req?.queryRunner?.manager });
  }

  // Tasks for contract
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/tasks')
  listTasks(@Param('id') id: string, @Req() req: any) { return this.svc.listTasks(id, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/tasks')
  createTask(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.createTask(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Patch(':id/tasks')
  updateTask(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.updateTask(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager, tenantId });
  }

  // Contacts
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/contacts')
  listContacts(@Param('id') id: string, @Req() req: any) {
    return this.contactsSvc.listForItem(id, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/contacts')
  attachContact(@Param('id') id: string, @Body() body: { contactId: string; role: SupplierContactRole }, @Req() req: any) {
    return this.contactsSvc.attachManual(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Delete(':id/contacts/:linkId')
  detachContact(@Param('id') id: string, @Param('linkId') linkId: string, @Req() req: any) {
    return this.contactsSvc.detach(id, linkId, req.user?.sub ?? null, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/contacts/sync-from-supplier')
  syncContactsFromSupplier(@Param('id') id: string, @Req() req: any) {
    return this.contactsSvc.syncFromSupplierForItem(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
  }

  // URLs
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/links')
  listUrls(@Param('id') id: string, @Req() req: any) { return this.svc.listUrls(id, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/links')
  createUrl(@Param('id') id: string, @Body() body: any, @Req() req: any) { return this.svc.createUrl(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Patch(':id/links/:linkId')
  updateUrl(@Param('id') id: string, @Param('linkId') linkId: string, @Body() body: any, @Req() req: any) { return this.svc.updateUrl(id, linkId, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Delete(':id/links/:linkId')
  deleteUrl(@Param('id') id: string, @Param('linkId') linkId: string, @Req() req: any) { return this.svc.deleteUrl(id, linkId, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(@UploadedFile() file: Express.Multer.File, @Query('dryRun') dryRunRaw: string, @Req() req: any) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    return this.svc.importCsv({ file, dryRun, userId: req.user?.sub ?? null }, { manager: req?.queryRunner?.manager });
  }

  // Attachments
  @Get(':id/attachments')
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  listAttachments(@Param('id') id: string, @Req() req: any) { return this.svc.listAttachments(id, { manager: req?.queryRunner?.manager }); }

  @Post(':id/attachments')
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  uploadAttachment(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    return this.svc.uploadAttachment(id, file, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }
}
