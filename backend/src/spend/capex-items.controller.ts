import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { canReadResource } from '../common/record-usages';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapexItemsService, SpendItemsService } from './spend-items.service';
import { CapexItemsDeleteService } from './spend-items-delete.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { attachmentMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { PermissionGuard } from '../auth/permission.guard';
import { ReadOnlyRoute, RequireLevel } from '../auth/require-level.decorator';
import { StorageService } from '../common/storage/storage.service';
import { CapexItemContactsService } from './spend-item-contacts.service';
import { SupplierContactRole } from '../contacts/supplier-contact.entity';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { budgetListAccess } from './budget-list/budget-list.runtime';
import { resolveToUuid } from '../common/resolve-item-id';
import { EntityManager } from 'typeorm';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { ShareRateLimit } from '../notifications/share-rate-limit';
import type { BudgetColumn } from './amounts-write.util';
import {
  CreateCapexItemInput,
  UpdateCapexItemInput,
  ListCapexQueryInput,
} from './dto/capex';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { analyzeAfterLargeImport } from './budget-import-statistics';
import { BudgetFileService, canCreateSuppliers } from './budget-file/budget-file.service';
import { exportListQuery } from './budget-file/export-file';
import { budgetFileBody } from './budget-file/send-export';
import { parseExportFormat } from '../common/xlsx';
import { importAnalyzeTables } from './budget-file/import-file';
import { BudgetFileSizeInterceptor, budgetFileMulterOptions } from './budget-file/upload';
import { BudgetLineTypeChangeService } from './budget-line-type-change.service';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

/**
 * The CAPEX routes, kept as aliases until the unified screens (plan planning/budget-unifie.md, lot
 * Z1, G.8): the same paths, guards (`capex` right), route order and messages as before, on the
 * services of the single family for the lines of nature `capex` (`CapexItemsService`), which keep
 * the CAPEX contract (`budget-line-presentation.ts`).
 */
@UseGuards(JwtAuthGuard)
@Controller('capex-items')
export class CapexItemsController {
  constructor(
    private readonly svc: CapexItemsService,
    private readonly deleteSvc: CapexItemsDeleteService,
    private readonly storage: StorageService,
    private readonly contactsSvc: CapexItemContactsService,
    private readonly budgetFile: BudgetFileService,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
    /** The OPEX lines' service: a budget file may hold lines of both natures, each written by its own (lot C1b). */
    private readonly opexSvc: SpendItemsService,
    /** The change of type of a line (lot M), shared by both natures' routes. */
    private readonly typeChange: BudgetLineTypeChangeService,
  ) {}

  private resolveId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'capex', manager);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get()
  list(
    @Query() query: ListCapexQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.list(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary')
  summary(
    @Query() query: ListCapexQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summary(query, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary/filter-values')
  summaryFilterValues(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryFilterValues(query, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary/ids')
  summaryIds(
    @Query() query: ListCapexQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryIds(query, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary/neighbors')
  async summaryNeighbors(
    @Query() query: ListCapexQueryInput & { id?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(String(query?.id ?? ''), ctx.manager as EntityManager);
    return this.svc.summaryNeighbors(query, id, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary/totals')
  summaryTotals(
    @Query() query: ListCapexQueryInput,
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
  @RequireLevel('budget', 'reader')
  @Post('summary/aggregate')
  @HttpCode(200)
  summaryAggregate(
    @Body() body: unknown,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryAggregateRequest(body, { manager: ctx.manager, access: budgetListAccess(ctx) });
  }

  /** The budget file (C2a). A read: a frozen tenant keeps it. `ctx` is merged on GET. */
  @ReadOnlyRoute()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Get('budget-file/export')
  async exportBudgetFile(
    @Query() query: Record<string, string>,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const format = parseExportFormat(query.format);
    const listQuery = exportListQuery(query, query.all === 'true' || query.all === '1');
    const { ids } = await this.svc.summaryIds(listQuery, { manager: ctx.manager, access: budgetListAccess(ctx) });
    const exported = await this.budgetFile.exportFile('capex', ids, {
      manager: ctx.manager as EntityManager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
    }, {
      language: query.language,
      amountYears: query.amountYears,
      columns: query.columns,
      detail: query.detail,
      format,
    });
    res.send(await budgetFileBody(res, exported));
  }

  @ReadOnlyRoute()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-file/preflight')
  @HttpCode(200)
  @UseInterceptors(BudgetFileSizeInterceptor, FileInterceptor('file', budgetFileMulterOptions))
  preflightBudgetFile(
    @UploadedFile() file: Express.Multer.File,
    @Query('language') language: string,
    @Query('dateOrder') dateOrder: string,
    @Query('decimalMark') decimalMark: string,
    @Query('createSuppliers') createSuppliers: string,
    @Tenant() ctx: TenantRequest,
  ) {
    if (!file?.buffer) throw new BadRequestException('Choose a CSV file.');
    return this.budgetFile.preflight('capex', file.buffer, {
      manager: ctx.manager as EntityManager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
    }, {
      language,
      dateOrder,
      decimalMark,
      createSuppliers: createSuppliers === 'true' || createSuppliers === '1',
      canCreateSuppliers: canCreateSuppliers(ctx),
    });
  }

  /** The load (C2b). Not a read. `analyzeAfterLargeImport` is the last call. */
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-file/import')
  @HttpCode(200)
  @UseInterceptors(BudgetFileSizeInterceptor, FileInterceptor('file', budgetFileMulterOptions))
  async importBudgetFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('snapshot') snapshot: string,
    @Query('language') language: string,
    @Query('dateOrder') dateOrder: string,
    @Query('decimalMark') decimalMark: string,
    @Query('createSuppliers') createSuppliers: string,
    @Tenant() ctx: TenantRequest,
    @Req() req: any,
  ) {
    if (!file?.buffer) throw new BadRequestException('Choose a CSV file.');
    const result = await this.budgetFile.importFile('capex', file.buffer, snapshot, {
      manager: ctx.manager as EntityManager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
    }, {
      language,
      dateOrder,
      decimalMark,
      createSuppliers: createSuppliers === 'true' || createSuppliers === '1',
      canCreateSuppliers: canCreateSuppliers(ctx),
    }, { items: { opex: this.opexSvc, capex: this.svc }, audit: this.audit, freeze: this.freeze });
    await analyzeAfterLargeImport(req, importAnalyzeTables('capex', result), result);
    return result;
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
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

  @ShareRateLimit()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
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
  @RequireLevel('budget', 'reader')
  @Get(':id/links')
  async listLinks(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listLinks(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
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
  @RequireLevel('budget', 'member')
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
  @RequireLevel('budget', 'member')
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
  @RequireLevel('budget', 'reader')
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
  @RequireLevel('budget', 'member')
  @Patch('attachments/:attachmentId/delete')
  deleteAttachment(
    @Param('attachmentId') attachmentId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.deleteAttachment(attachmentId, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get(':id/attachments')
  async listAttachments(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listAttachments(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
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
  @RequireLevel('budget', 'reader')
  @Get(':id/contacts')
  async listContacts(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.contactsSvc.listForItem(id, { manager: ctx.manager, tenantId: ctx.tenantId });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
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
  @RequireLevel('budget', 'member')
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
  @RequireLevel('budget', 'member')
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
  @RequireLevel('budget', 'reader')
  @Get(':id/projects')
  async listProjects(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listProjects(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
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
  @RequireLevel('budget', 'reader')
  @Get(':id/applications')
  async listApplications(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.listApplications(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Post(':id/applications/bulk-replace')
  async bulkReplaceApplications(
    @Param('id') idOrRef: string,
    @Body() body: { application_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.bulkReplaceApplications(id, body?.application_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  // Technologies: their section is null without the right to read the infrastructure, and a set the
  // caller cannot read is never replaced (an empty list would remove every link).
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get(':id/technologies')
  async listTechnologies(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    const list = await this.svc.listTechnologies(id, { manager: ctx.manager });
    return canReadResource(ctx, 'infrastructure') ? list : { items: null };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Post(':id/technologies/bulk-replace')
  async bulkReplaceTechnologies(
    @Param('id') idOrRef: string,
    @Body() body: { technology_ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    if (!canReadResource(ctx, 'infrastructure')) throw new ForbiddenException('You cannot read technologies.');
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.bulkReplaceTechnologies(id, body?.technology_ids ?? [], ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
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
  @RequireLevel('budget', 'reader')
  @Get(':id/meta')
  async meta(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.meta(id, ctx.tenantId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get(':id/relation-counts')
  async relationCounts(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.relationCounts(id, { manager: ctx.manager, technologies: canReadResource(ctx, 'infrastructure') });
  }

  /**
   * What the "Change the type" dialog shows (lot M, `budget-line-type-change.service.ts`): the years
   * the change may start from, the frozen columns that refuse it, the account and dimensions to ask
   * for, what it carries. `from_year`: the year chosen (none: the first one). Same level as the change.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Get(':id/change-type/check')
  async changeTypeCheck(
    @Param('id') idOrRef: string,
    @Query('from_year') fromYear: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.typeChange.check('capex', id, { from_year: fromYear }, { manager: ctx.manager as EntityManager, tenantId: ctx.tenantId });
  }

  /**
   * Changes the type of the line, in place from its first year or from a later year with a new line
   * of the other type (lot M). Body: `row_version` (the one the dialog read), `from_year`,
   * `account_id`, `analytics_values`, `reason`. The level of a line's creation and update.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Post(':id/change-type')
  @HttpCode(200)
  async changeType(
    @Param('id') idOrRef: string,
    @Body() body: unknown,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.typeChange.change('capex', id, body, ctx.userId || null, { manager: ctx.manager as EntityManager, tenantId: ctx.tenantId });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Post()
  create(
    @Body() body: CreateCapexItemInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.create(body as Record<string, unknown>, ctx.userId || undefined, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Patch(':id')
  async update(
    @Param('id') idOrRef: string,
    @Body() body: UpdateCapexItemInput,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.svc.update(id, body as Record<string, unknown>, ctx.userId || undefined, { manager: ctx.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
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
      acceptCalendarChanges?: boolean;
    },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.copyBudgetColumn(body, ctx.userId || null, { manager: ctx.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
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

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
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

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Delete('bulk')
  bulkDelete(
    @Body() body: { ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.deleteSvc.bulkDelete(body.ids, ctx.userId || null, { manager: ctx.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @Delete(':id')
  async delete(
    @Param('id') idOrRef: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await this.resolveId(idOrRef, ctx.manager as EntityManager);
    return this.deleteSvc.delete(id, { manager: ctx.manager, userId: ctx.userId || null });
  }
}
