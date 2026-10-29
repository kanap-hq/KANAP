import { exportListQuery } from '../common/pagination';
import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, Delete } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContractsService } from './contracts.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { attachmentMulterOptions, csvImportMulterOptions } from '../common/upload';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators';
import { CONTRACT_LOOKUP_ACCESS, CONTRACT_LOOKUP_READERS, assertLookupSearch } from '../common/lookup/lookup-requirements';
import { lookupContracts } from '../common/lookup/reference-lookups';
import { ContractUpsertDto } from './dto/contract.dto';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { ShareRateLimit } from '../notifications/share-rate-limit';
import { StorageService } from '../common/storage/storage.service';
import { contentDisposition } from '../common/content-disposition';
import { ContractContactsService } from './contract-contacts.service';
import { SupplierContactRole } from '../contacts/supplier-contact.entity';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { assertContractBudgetRead, canReadContractBudget } from './contract-budget';
import { canReadResource } from '../common/record-usages';
import { resolveBusinessContributorScope } from '../auth/business-contributor-scope';
import { assertContractRelationRead, contractRelationKindOrThrow, contractRelationsAccess } from './contract-relations';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';
import type { ComplianceItemPatch } from './contract-compliance';
import { ContractsDeleteService } from './contracts-delete.service';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { csvExportFormat } from '../common/csv/csv-export.service';
import { parseExportFormat } from '../common/xlsx/format';
import { csvExportBody } from '../common/csv/send-csv-export';

/**
 * The list's `covered_application` filter, for a reader of the applications only (a Business
 * Contributor's matches the applications they take part in); undefined leaves it unapplied.
 */
async function coveredApplications(req: any): Promise<{ scope?: Awaited<ReturnType<typeof resolveBusinessContributorScope>> } | undefined> {
  if (!canReadResource(req ?? {}, 'applications')) return undefined;
  return { scope: await resolveBusinessContributorScope(req, 'applications') };
}

@UseGuards(JwtAuthGuard)
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly svc: ContractsService,
    private readonly storage: StorageService,
    private readonly contactsSvc: ContractContactsService,
    private readonly deleteSvc: ContractsDeleteService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get()
  async list(@Query() query: any, @Req() req: any) {
    // `budget_year` and `budget_column` add the budget figures for a reader of the budget (contract-budget.ts).
    return this.svc.list(query, { manager: req?.queryRunner?.manager, budgetAccess: canReadContractBudget(req), coveredApplications: await coveredApplications(req) });
  }

  // The list's footer and quick filter counts, for the same search, filters and status scope.
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get('totals')
  async totals(@Query() query: any, @Req() req: any) {
    return this.svc.totals(query, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
      budgetAccess: canReadContractBudget(req),
      coveredApplications: await coveredApplications(req),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get('ids')
  async listIds(@Query() query: any, @Req() req: any) {
    return this.svc.listIds(query, { manager: req?.queryRunner?.manager, budgetAccess: canReadContractBudget(req), coveredApplications: await coveredApplications(req) });
  }

  // Picker search (`q`) and hydration of chosen values (`ids`); see common/lookup.
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(CONTRACT_LOOKUP_READERS)
  @Get('lookup')
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    // A role that only reads a picking page gets the chosen labels (`ids`), not the list.
    assertLookupSearch(CONTRACT_LOOKUP_ACCESS, ctx, query);
    return lookupContracts({ manager: ctx.manager, tenantId: ctx.tenantId }, query);
  }

  // Export route before :id
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Get('export')
  async export(@Query('scope') scope: 'template' | 'data' = 'data', @Query() query: any, @Res() res: Response, @Req() req: any) {
    const format = csvExportFormat(query?.format, scope);
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, query?.language);
    const file = await this.svc.exportCsv(scope, {
      manager: req?.queryRunner?.manager,
      budgetAccess: canReadContractBudget(req),
      coveredApplications: await coveredApplications(req),
      language,
      listQuery: exportListQuery(query),
      format,
    });
    res.send(await csvExportBody(res, file));
  }

  // The compliance register of the contracts the list selects, in its order (CSV or xlsx, contract × requirement); before ':id'.
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Get('compliance-register/export')
  async exportComplianceRegister(@Query() query: any, @Res() res: Response, @Req() req: any) {
    const manager = req?.queryRunner?.manager;
    const language = await languageOf(manager, req.tenant.id, req.user?.sub ?? null, query?.language);
    const format = parseExportFormat(query?.format);
    const file = await this.svc.exportComplianceRegister(query, language, await contractRelationsAccess(req), {
      manager,
      budgetAccess: canReadContractBudget(req),
      coveredApplications: await coveredApplications(req),
      format,
    });
    res.send(await csvExportBody(res, file));
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

  // What deleting the given contracts removes, for the confirmation; before ':id'.
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Post('delete-impact')
  deleteImpact(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.deleteSvc.deleteImpact(Array.isArray(body?.ids) ? body.ids : [], { manager: req?.queryRunner?.manager });
  }

  // Bulk delete before ':id'.
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.deleteSvc.bulkDelete(Array.isArray(body?.ids) ? body.ids : [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.deleteSvc.delete(id, { manager: req?.queryRunner?.manager, userId: req.user?.sub ?? null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) { return this.svc.get(id, { manager: req?.queryRunner?.manager }); }

  @ShareRateLimit()
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Post(':id/share')
  share(@Param('id') id: string, @Body() body: ShareItemDto, @Req() req: any) {
    return this.svc.shareContract(id, body, req.user?.sub ?? '', { manager: req?.queryRunner?.manager });
  }

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
  async listLinked(@Param('id') id: string, @Req() req: any) {
    const linked = await this.svc.listLinkedSpendItems(id, { manager: req?.queryRunner?.manager });
    // The names of the lines go to the readers of the budget only (spec §5.4).
    return canReadContractBudget(req) ? linked : { items: [] };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/spend-items/bulk-replace')
  bulkReplace(@Param('id') id: string, @Body() body: { spend_item_ids: string[] }, @Req() req: any) {
    assertContractBudgetRead(req);
    return this.svc.bulkReplaceLinkedSpendItems(id, body?.spend_item_ids ?? [], { manager: req?.queryRunner?.manager });
  }

  // Links to CAPEX
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/capex-items')
  async listLinkedCapex(@Param('id') id: string, @Req() req: any) {
    const linked = await this.svc.listLinkedCapexItems(id, { manager: req?.queryRunner?.manager });
    return canReadContractBudget(req) ? linked : { items: [] };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/capex-items/bulk-replace')
  bulkReplaceCapex(@Param('id') id: string, @Body() body: { capex_item_ids: string[] }, @Req() req: any) {
    assertContractBudgetRead(req);
    return this.svc.bulkReplaceLinkedCapexItems(id, body?.capex_item_ids ?? [], { manager: req?.queryRunner?.manager });
  }

  // Budget lines of both natures, applications and assets, from the contract's side (`contract-relations.ts`)
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/relation-counts')
  async relationCounts(@Param('id') id: string, @Req() req: any) {
    // A family the caller does not read is not counted (null), as the Relations tab leaves it out.
    return this.svc.relationCounts(id, { manager: req?.queryRunner?.manager, ...(await contractRelationsAccess(req)) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/budget-lines')
  listBudgetLines(@Param('id') id: string, @Req() req: any) {
    // Without the right to read the budget: the number of lines only, never their names (spec §5.4).
    return this.svc.listBudgetLines(id, { manager: req?.queryRunner?.manager, budgetAccess: canReadContractBudget(req) });
  }

  /**
   * The budget-line picker: each candidate the caller can read, with the fields that would differ
   * once linked. Without the budget right the answer is empty and no line is read.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/budget-line-consistency')
  budgetLineConsistency(@Param('id') id: string, @Query('ids') ids: string | undefined, @Req() req: any) {
    return this.svc.budgetLineConsistency(id, ids, { manager: req?.queryRunner?.manager, budgetAccess: canReadContractBudget(req) });
  }

  // The Budget tab's figures for a year and column; also needs the right to read the budget.
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/budget')
  budgetCoverage(@Param('id') id: string, @Query() query: any, @Req() req: any) {
    return this.svc.budgetCoverage(id, query, { manager: req?.queryRunner?.manager, budgetAccess: canReadContractBudget(req) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/budget-lines/bulk-replace')
  bulkReplaceBudgetLines(@Param('id') id: string, @Body() body: { budget_line_ids: string[] }, @Req() req: any) {
    assertContractBudgetRead(req);
    return this.svc.replaceRelations(id, 'budget_lines', body?.budget_line_ids ?? [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // Compliance register of one contract (`contract-compliance.ts`)
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/compliance')
  async compliance(@Param('id') id: string, @Req() req: any) {
    // The reasons name only the applications and assets the Relations tab shows the person.
    return this.svc.compliance(id, await contractRelationsAccess(req), { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Patch(':id/compliance/:requirement')
  async updateCompliance(@Param('id') id: string, @Param('requirement') requirement: string, @Body() body: ComplianceItemPatch, @Req() req: any) {
    return this.svc.updateCompliance(id, requirement, body, req.user?.sub ?? null, await contractRelationsAccess(req), { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/applications')
  async listApplications(@Param('id') id: string, @Req() req: any) {
    // Without the right to read the applications the list is null (the contract is still checked);
    // a Business Contributor's lists the applications they take part in.
    const access = await contractRelationsAccess(req);
    const list = await this.svc.listApplications(id, { manager: req?.queryRunner?.manager, applicationScope: access.applicationScope });
    return access.applications ? list : { items: null };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/applications/bulk-replace')
  async bulkReplaceApplications(@Param('id') id: string, @Body() body: { application_ids: string[] }, @Req() req: any) {
    // A set the caller cannot read is never replaced (an empty list would remove every link).
    assertContractRelationRead(req, 'applications');
    const { applicationScope } = await contractRelationsAccess(req);
    return this.svc.replaceRelations(id, 'applications', body?.application_ids ?? [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager, applicationScope });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/assets')
  async listAssets(@Param('id') id: string, @Req() req: any) {
    // Without the right to read the infrastructure the list is null (the contract is still checked).
    const list = await this.svc.listAssets(id, { manager: req?.queryRunner?.manager });
    return canReadResource(req ?? {}, 'infrastructure') ? list : { items: null };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/assets/bulk-replace')
  bulkReplaceAssets(@Param('id') id: string, @Body() body: { asset_ids: string[] }, @Req() req: any) {
    assertContractRelationRead(req, 'assets');
    return this.svc.replaceRelations(id, 'assets', body?.asset_ids ?? [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/technologies')
  async listTechnologies(@Param('id') id: string, @Req() req: any) {
    // Without the right to read the infrastructure the section is null (the contract is still checked).
    const list = await this.svc.listTechnologies(id, { manager: req?.queryRunner?.manager });
    return canReadResource(req ?? {}, 'infrastructure') ? list : { items: null };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/technologies/bulk-replace')
  bulkReplaceTechnologies(@Param('id') id: string, @Body() body: { technology_ids: string[] }, @Req() req: any) {
    // A set the caller cannot read is never replaced (an empty list would remove every link).
    assertContractRelationRead(req, 'technologies');
    return this.svc.replaceRelations(id, 'technologies', body?.technology_ids ?? [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  /**
   * Applications, assets, technologies and supplier suggestions, in one round trip. A family whose
   * module the caller does not read is null; a Business Contributor sees the applications they take part in.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/relations')
  async relations(@Param('id') id: string, @Req() req: any) {
    return this.svc.getRelations(id, { manager: req?.queryRunner?.manager, ...(await contractRelationsAccess(req)) });
  }

  /** Link one application, asset or technology (`{ id }`). */
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/relations/:kind')
  linkRelation(@Param('id') id: string, @Param('kind') kind: string, @Body() body: { id?: string }, @Req() req: any) {
    return this.writeRelation(kind, id, String(body?.id ?? ''), true, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Delete(':id/relations/:kind/:targetId')
  unlinkRelation(@Param('id') id: string, @Param('kind') kind: string, @Param('targetId') targetId: string, @Req() req: any) {
    return this.writeRelation(kind, id, targetId, false, req);
  }

  /**
   * Each kind also needs a read of its module (applications; infrastructure for assets and
   * technologies), as the bulk replacements do; a Business Contributor links and unlinks the
   * applications they take part in only.
   */
  private async writeRelation(kind: string, id: string, targetId: string, add: boolean, req: any) {
    const relation = contractRelationKindOrThrow(kind);
    assertContractRelationRead(req, relation);
    const { applicationScope } = await contractRelationsAccess(req);
    return this.svc.setRelation(relation, id, targetId, add, req.user?.sub ?? null, { manager: req?.queryRunner?.manager, applicationScope });
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

  // Updates existing contracts by a non-unique key (name and supplier): a hidden homonym would
  // become a duplicate (spec §2.7). The export stays open: it follows the list.
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Query('language') languageRaw: string | undefined,
    @Query('dateOrder') dateOrderRaw: string | undefined,
    @Query('decimalMark') decimalMarkRaw: string | undefined,
    @Req() req: any,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, languageRaw);
    return this.svc.importCsv(
      {
        file,
        dryRun,
        userId: req.user?.sub ?? null,
        language,
        dateOrder: parseDateOrder(dateOrderRaw),
        decimalMark: parseDecimalMark(decimalMarkRaw),
      },
      { manager: req?.queryRunner?.manager },
    );
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
