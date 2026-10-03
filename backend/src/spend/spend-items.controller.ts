import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SpendItemsService } from './spend-items.service';
import { SpendItemsDeleteService } from './spend-items-delete.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { attachmentMulterOptions, csvImportMulterOptions } from '../common/upload';
import { PermissionGuard } from '../auth/permission.guard';
import { ReadOnlyRoute, RequireLevel } from '../auth/require-level.decorator';
import { StorageService } from '../common/storage/storage.service';
import { contentDisposition } from '../common/content-disposition';
import { SpendItemContactsService } from './spend-item-contacts.service';
import { SupplierContactRole } from '../contacts/supplier-contact.entity';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { budgetListAccess } from './budget-list/budget-list.runtime';
import { resolveToUuid } from '../common/resolve-item-id';
import { EntityManager } from 'typeorm';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import type { BudgetColumn } from './amounts-write.util';
import {
  CreateSpendItemInput,
  UpdateSpendItemInput,
  ListSpendQueryInput,
} from './dto';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { analyzeAfterLargeImport, lineImportTables } from './budget-import-statistics';
import { BudgetFileService, canCreateSuppliers } from './budget-file/budget-file.service';
import { exportListQuery } from './budget-file/export-file';
import { importAnalyzeTables } from './budget-file/import-file';
import { BudgetFileSizeInterceptor, budgetFileMulterOptions } from './budget-file/upload';

@UseGuards(JwtAuthGuard)
@Controller('spend-items')
export class SpendItemsController {
  constructor(
    private readonly svc: SpendItemsService,
    private readonly deleteSvc: SpendItemsDeleteService,
    private readonly storage: StorageService,
    private readonly contactsSvc: SpendItemContactsService,
    private readonly budgetFile: BudgetFileService,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
  ) {}

  /** Every `:id` route takes a UUID or an OPX-N reference; a malformed id is a 400. */
  private resolveId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'spend', manager);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get()
  list(
    @Query() query: ListSpendQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.list(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get('summary')
  summary(
    @Query() query: ListSpendQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summary(query, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get('summary/filter-values')
  summaryFilterValues(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryFilterValues(query, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get('summary/ids')
  summaryIds(
    @Query() query: ListSpendQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryIds(query, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get('summary/neighbors')
  async summaryNeighbors(
    @Query() query: ListSpendQueryInput & { id?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(String(query?.id ?? ''), ctx.manager as EntityManager);
    return this.svc.summaryNeighbors(query, id, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get('summary/totals')
  summaryTotals(
    @Query() query: ListSpendQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryTotals(query, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  /**
   * The lines of a list state grouped and measured on the server (reports,
   * dashboard): body `{ query, spec }`, same read level as the list. A read:
   * a frozen tenant keeps it, like the GET routes.
   */
  @ReadOnlyRoute()
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Post('summary/aggregate')
  @HttpCode(200)
  summaryAggregate(
    @Body() body: unknown,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryAggregateRequest(body, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  // Export before parameterized ':id'
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'admin')
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

  /** The budget file (C2a). A read: a frozen tenant keeps it. `ctx` is merged on GET. */
  @ReadOnlyRoute()
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Get('budget-file/export')
  async exportBudgetFile(
    @Query() query: Record<string, string>,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const listQuery = exportListQuery(query, query.all === 'true' || query.all === '1');
    const { ids } = await this.svc.summaryIds(listQuery, { manager: ctx.manager, access: budgetListAccess(ctx) });
    const { filename, content } = await this.budgetFile.exportFile('opex', ids, {
      manager: ctx.manager as EntityManager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
    }, {
      language: query.language,
      amountYears: query.amountYears,
      columns: query.columns,
      detail: query.detail,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @ReadOnlyRoute()
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-file/preflight')
  @HttpCode(200)
  @UseInterceptors(BudgetFileSizeInterceptor, FileInterceptor('file', budgetFileMulterOptions))
  preflightBudgetFile(
    @UploadedFile() file: Express.Multer.File,
    @Query('language') language: string,
    @Query('dateOrder') dateOrder: string,
    @Query('createSuppliers') createSuppliers: string,
    @Tenant() ctx: TenantRequest,
  ) {
    if (!file?.buffer) throw new BadRequestException('Choose a CSV file.');
    return this.budgetFile.preflight('opex', file.buffer, {
      manager: ctx.manager as EntityManager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
    }, {
      language,
      dateOrder,
      createSuppliers: createSuppliers === 'true' || createSuppliers === '1',
      canCreateSuppliers: canCreateSuppliers(ctx),
    });
  }

  /** The load (C2b). Not a read. `analyzeAfterLargeImport` is the last call. */
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-file/import')
  @HttpCode(200)
  @UseInterceptors(BudgetFileSizeInterceptor, FileInterceptor('file', budgetFileMulterOptions))
  async importBudgetFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('snapshot') snapshot: string,
    @Query('language') language: string,
    @Query('dateOrder') dateOrder: string,
    @Query('createSuppliers') createSuppliers: string,
    @Tenant() ctx: TenantRequest,
    @Req() req: any,
  ) {
    if (!file?.buffer) throw new BadRequestException('Choose a CSV file.');
    const result = await this.budgetFile.importFile('opex', file.buffer, snapshot, {
      manager: ctx.manager as EntityManager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
    }, {
      language,
      dateOrder,
      createSuppliers: createSuppliers === 'true' || createSuppliers === '1',
      canCreateSuppliers: canCreateSuppliers(ctx),
    }, { items: this.svc, audit: this.audit, freeze: this.freeze });
    await analyzeAfterLargeImport(req, importAnalyzeTables('opex', result), result);
    return result;
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get(':id')
  async get(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.getDetail(id, { manager: ctx.manager });
  }

  /**
   * What the workspace polls every 30 seconds to learn that someone else changed the line or its
   * budget (plan planning/perf-scale, lot 3G; `spend/item-meta.ts`): `row_version`, each version's
   * `budget_rev`, who and when. Same read level as the detail.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get(':id/meta')
  async meta(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.meta(id, ctx.tenantId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get(':id/relation-counts')
  async relationCounts(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.relationCounts(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
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
  @RequireLevel('opex', 'reader')
  @Post(':id/share')
  async share(
    @Param('id') idOrRef: string,
    @Body() body: ShareItemDto,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.share(id, body, ctx.tenantId, ctx.userId || '', { manager: ctx.manager });
  }

  // Linked projects (Portfolio workspace)
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get(':id/projects')
  async listProjects(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listProjects(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  @Post(':id/projects/bulk-replace')
  async bulkReplaceProjects(
    @Param('id') idOrRef: string,
    @Body() body: { project_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.bulkReplaceProjects(id, body?.project_ids ?? [], { manager: ctx.manager });
  }

  // Linked applications (Apps & Services workspace)
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get(':id/applications')
  async listApplications(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listApplications(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  @Post(':id/applications/bulk-replace')
  async bulkReplaceApplications(
    @Param('id') idOrRef: string,
    @Body() body: { application_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.bulkReplaceApplications(id, body?.application_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Links (OPEX)
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get(':id/links')
  async listLinks(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listLinks(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
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
  @RequireLevel('opex', 'member')
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
  @RequireLevel('opex', 'member')
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
  @RequireLevel('opex', 'reader')
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
  @RequireLevel('opex', 'member')
  @Patch('attachments/:attachmentId/delete')
  deleteAttachment(
    @Param('attachmentId') attachmentId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.deleteAttachment(attachmentId, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  @Get(':id/attachments')
  async listAttachments(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listAttachments(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
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
  @RequireLevel('opex', 'reader')
  @Get(':id/contacts')
  async listContacts(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.contactsSvc.listForItem(id, { manager: ctx.manager, tenantId: ctx.tenantId });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
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
  @RequireLevel('opex', 'member')
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
  @RequireLevel('opex', 'member')
  @Post(':id/contacts/sync-from-supplier')
  async syncContactsFromSupplier(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.contactsSvc.syncFromSupplierForItem(id, ctx.userId || null, { manager: ctx.manager, tenantId: ctx.tenantId });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  @Post()
  create(
    @Body() body: CreateSpendItemInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.create(body as Record<string, unknown>, ctx.userId || undefined, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  @Patch(':id')
  async update(
    @Param('id') idOrRef: string,
    @Body() body: UpdateSpendItemInput,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.update(id, body as Record<string, unknown>, ctx.userId || undefined, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Tenant() ctx: TenantRequest,
    @Req() req: any,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const result = await this.svc.importCsv({ file, dryRun, userId: ctx.userId || null }, { manager: ctx.manager });
    // A large import: committed here, then its tables analysed (budget-import-statistics.ts).
    await analyzeAfterLargeImport(req, lineImportTables('opex'), result);
    return result;
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'admin')
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
  @RequireLevel('opex', 'admin')
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
  @RequireLevel('opex', 'admin')
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
  @RequireLevel('opex', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Delete('bulk')
  bulkDelete(
    @Body() body: { ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.deleteSvc.bulkDelete(body.ids, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'admin')
  @Delete(':id')
  async delete(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.deleteSvc.delete(id, { manager: ctx.manager, userId: ctx.userId || null });
  }
}
