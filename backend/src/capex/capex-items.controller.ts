import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapexItemsService } from './capex-items.service';
import { CapexItemsDeleteService } from './capex-items-delete.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { attachmentMulterOptions, csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { StorageService } from '../common/storage/storage.service';
import { CapexItemContactsService } from './capex-item-contacts.service';
import { SupplierContactRole } from '../contacts/supplier-contact.entity';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { resolveToUuid } from '../common/resolve-item-id';
import { EntityManager } from 'typeorm';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import type { BudgetColumn } from '../spend/amounts-write.util';
import {
  CreateCapexItemInput,
  UpdateCapexItemInput,
  ListCapexQueryInput,
} from './dto';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('capex-items')
export class CapexItemsController {
  constructor(
    private readonly svc: CapexItemsService,
    private readonly deleteSvc: CapexItemsDeleteService,
    private readonly storage: StorageService,
    private readonly contactsSvc: CapexItemContactsService,
  ) {}

  private resolveId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'capex', manager);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get()
  list(
    @Query() query: ListCapexQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.list(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get('summary')
  summary(
    @Query() query: ListCapexQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summary(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get('summary/filter-values')
  summaryFilterValues(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryFilterValues(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get('summary/ids')
  summaryIds(
    @Query() query: ListCapexQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryIds(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get('summary/neighbors')
  async summaryNeighbors(
    @Query() query: ListCapexQueryInput & { id?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(String(query?.id ?? ''), ctx.manager as EntityManager);
    return this.svc.summaryNeighbors(query, id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get('summary/totals')
  summaryTotals(
    @Query() query: ListCapexQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryTotals(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'admin')
  @Get('export')
  async export(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const { filename, content } = await this.svc.exportCsv(scope, { manager: ctx.manager });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get(':id/yearly-totals')
  async yearlyTotals(
    @Param('id') idOrRef: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    const Y = new Date().getFullYear();
    const fromY = Number.parseInt(from, 10);
    const toY = Number.parseInt(to, 10);
    return this.svc.yearlyTotals(
      id,
      Number.isFinite(fromY) ? fromY : Y - 3,
      Number.isFinite(toY) ? toY : Y + 1,
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Post(':id/share')
  async share(
    @Param('id') idOrRef: string,
    @Body() body: ShareItemDto,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.share(id, body, ctx.tenantId, ctx.userId || '', { manager: ctx.manager });
  }

  // Links
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get(':id/links')
  async listLinks(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listLinks(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Post(':id/links')
  async createLink(
    @Param('id') idOrRef: string,
    @Body() body: { description?: string; url: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.createLink(id, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Patch(':id/links/:linkId')
  async updateLink(
    @Param('id') idOrRef: string,
    @Param('linkId') linkId: string,
    @Body() body: { description?: string; url?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.updateLink(id, linkId, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Delete(':id/links/:linkId')
  async deleteLink(
    @Param('id') idOrRef: string,
    @Param('linkId') linkId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.deleteLink(id, linkId, ctx.userId || null, { manager: ctx.manager });
  }

  // Attachments: downloads use a static segment before :id routing
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const meta = await this.svc.downloadAttachment(attachmentId, { manager: ctx.manager });
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) res.setHeader('Content-Length', String(obj.contentLength));
    obj.stream.pipe(res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Patch('attachments/:attachmentId/delete')
  deleteAttachment(
    @Param('attachmentId') attachmentId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.deleteAttachment(attachmentId, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get(':id/attachments')
  async listAttachments(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listAttachments(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  async uploadAttachment(
    @Param('id') idOrRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.uploadAttachment(id, file, ctx.userId || null, { manager: ctx.manager });
  }

  // Contacts
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get(':id/contacts')
  async listContacts(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.contactsSvc.listForItem(id, { manager: ctx.manager, tenantId: ctx.tenantId });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Post(':id/contacts')
  async attachContact(
    @Param('id') idOrRef: string,
    @Body() body: { contactId: string; role: SupplierContactRole },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.contactsSvc.attachManual(id, body, ctx.userId || null, { manager: ctx.manager, tenantId: ctx.tenantId });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Delete(':id/contacts/:linkId')
  async detachContact(
    @Param('id') idOrRef: string,
    @Param('linkId') linkId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.contactsSvc.detach(id, linkId, ctx.userId || null, { manager: ctx.manager, tenantId: ctx.tenantId });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Post(':id/contacts/sync-from-supplier')
  async syncContactsFromSupplier(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.contactsSvc.syncFromSupplierForItem(id, ctx.userId || null, { manager: ctx.manager, tenantId: ctx.tenantId });
  }

  // Projects
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get(':id/projects')
  async listProjects(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listProjects(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Post(':id/projects/bulk-replace')
  async bulkReplaceProjects(
    @Param('id') idOrRef: string,
    @Body() body: { project_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.bulkReplaceProjects(id, body?.project_ids ?? [], { manager: ctx.manager });
  }

  // Applications
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get(':id/applications')
  async listApplications(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listApplications(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Post(':id/applications/bulk-replace')
  async bulkReplaceApplications(
    @Param('id') idOrRef: string,
    @Body() body: { application_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.bulkReplaceApplications(id, body?.application_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  @Get(':id')
  async get(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.get(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Post()
  create(
    @Body() body: CreateCapexItemInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.create(body as Record<string, unknown>, ctx.userId || undefined, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  @Patch(':id')
  async update(
    @Param('id') idOrRef: string,
    @Body() body: UpdateCapexItemInput,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.update(id, body as Record<string, unknown>, ctx.userId || undefined, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    return this.svc.importCsv({ file, dryRun, userId: ctx.userId || null }, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-operations/copy-column')
  copyBudgetColumn(
    @Body() body: {
      sourceYear: number;
      sourceColumn: BudgetColumn;
      destinationYear: number;
      destinationColumn: BudgetColumn;
      percentageIncrease: number | string;
      overwrite: boolean;
      dryRun: boolean;
    },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.copyBudgetColumn(body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-operations/copy-allocations')
  copyAllocations(
    @Body() body: {
      sourceYear: number;
      destinationYear: number;
      overwrite?: boolean;
      dryRun?: boolean;
    },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.copyAllocations(body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-operations/clear-column')
  clearBudgetColumn(
    @Body() body: {
      year: number;
      column: BudgetColumn;
    },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.clearBudgetColumn(body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Delete('bulk')
  bulkDelete(
    @Body() body: { ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.deleteSvc.bulkDelete(body.ids, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'admin')
  @Delete(':id')
  async delete(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.deleteSvc.delete(id, { manager: ctx.manager, userId: ctx.userId || null });
  }
}
