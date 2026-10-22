import { exportListQuery } from '../common/pagination';
import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, Delete } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContractsService } from './contracts.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { attachmentMulterOptions, csvImportMulterOptions } from '../common/upload';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators';
import { CONTRACT_LOOKUP_ACCESS, CONTRACT_LOOKUP_READERS, assertLookupSearch } from '../common/lookup/lookup-requirements';
import { CONTRACT_LOOKUP, lookupReference } from '../common/lookup/reference-lookups';
import { ContractUpsertDto } from './dto/contract.dto';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { ShareRateLimit } from '../notifications/share-rate-limit';
import { StorageService } from '../common/storage/storage.service';
import { contentDisposition } from '../common/content-disposition';
import { ContractContactsService } from './contract-contacts.service';
import { SupplierContactRole } from '../contacts/supplier-contact.entity';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { canReadContractBudget } from './contract-budget';
import { canReadResource } from '../common/record-usages';
import { resolveBusinessContributorScope } from '../auth/business-contributor-scope';
import { contractRelationKindOrThrow } from './contract-relations';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';
import type { ComplianceItemPatch } from './contract-compliance';
import { ContractsDeleteService } from './contracts-delete.service';

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
  list(@Query() query: any, @Req() req: any) {
    // `budget_year` and `budget_column` add the budget figures for a reader of the budget (contract-budget.ts).
    return this.svc.list(query, { manager: req?.queryRunner?.manager, budgetAccess: canReadContractBudget(req) });
  }

  // The list's footer and quick filter counts, for the same search, filters and status scope.
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get('totals')
  totals(@Query() query: any, @Req() req: any) {
    return this.svc.totals(query, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id, budgetAccess: canReadContractBudget(req) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Req() req: any) {
    return this.svc.listIds(query, { manager: req?.queryRunner?.manager, budgetAccess: canReadContractBudget(req) });
  }

  // Picker search (`q`) and hydration of chosen values (`ids`); see common/lookup.
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(CONTRACT_LOOKUP_READERS)
  @Get('lookup')
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    // A role that only reads a picking page gets the chosen labels (`ids`), not the list.
    assertLookupSearch(CONTRACT_LOOKUP_ACCESS, ctx, query);
    return lookupReference({ manager: ctx.manager, tenantId: ctx.tenantId }, CONTRACT_LOOKUP, query);
  }

  // Export route before :id
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Get('export')
  async export(@Query('scope') scope: 'template' | 'data' = 'data', @Query() query: any, @Res() res: Response, @Req() req: any) {
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, query?.language);
    const { filename, content } = await this.svc.exportCsv(scope, {
      manager: req?.queryRunner?.manager,
      budgetAccess: canReadContractBudget(req),
      language,
      listQuery: exportListQuery(query),
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  // The compliance register of the contracts the list selects (CSV, contract × requirement); before ':id'.
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Get('compliance-register/export')
  async exportComplianceRegister(@Query() query: any, @Res() res: Response, @Req() req: any) {
    const manager = req?.queryRunner?.manager;
    const language = await languageOf(manager, req.tenant.id, req.user?.sub ?? null, query?.language);
    const { filename, content } = await this.svc.exportComplianceRegister(query, language, { manager, budgetAccess: canReadContractBudget(req) });
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

  // What deleting the given contracts removes, for the confirmation; before ':id'.
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Post('delete-impact')
  deleteImpact(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.deleteSvc.deleteImpact(Array.isArray(body?.ids) ? body.ids : [], { manager: req?.queryRunner?.manager });
  }

  // Bulk delete before ':id'.
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.deleteSvc.bulkDelete(Array.isArray(body?.ids) ? body.ids : [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

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

  // Budget lines of both natures, applications and assets, from the contract's side (`contract-relations.ts`)
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/relation-counts')
  relationCounts(@Param('id') id: string, @Req() req: any) {
    return this.svc.relationCounts(id, { manager: req?.queryRunner?.manager, technologies: canReadResource(req ?? {}, 'infrastructure') });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/budget-lines')
  listBudgetLines(@Param('id') id: string, @Req() req: any) { return this.svc.listBudgetLines(id, { manager: req?.queryRunner?.manager }); }

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
    return this.svc.replaceRelations(id, 'budget_lines', body?.budget_line_ids ?? [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // Compliance register of one contract (`contract-compliance.ts`)
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/compliance')
  compliance(@Param('id') id: string, @Req() req: any) { return this.svc.compliance(id, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Patch(':id/compliance/:requirement')
  updateCompliance(@Param('id') id: string, @Param('requirement') requirement: string, @Body() body: ComplianceItemPatch, @Req() req: any) {
    return this.svc.updateCompliance(id, requirement, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/applications')
  listApplications(@Param('id') id: string, @Req() req: any) { return this.svc.listApplications(id, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/applications/bulk-replace')
  bulkReplaceApplications(@Param('id') id: string, @Body() body: { application_ids: string[] }, @Req() req: any) {
    return this.svc.replaceRelations(id, 'applications', body?.application_ids ?? [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/assets')
  listAssets(@Param('id') id: string, @Req() req: any) { return this.svc.listAssets(id, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/assets/bulk-replace')
  bulkReplaceAssets(@Param('id') id: string, @Body() body: { asset_ids: string[] }, @Req() req: any) {
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
    if (!canReadResource(req ?? {}, 'infrastructure')) throw new ForbiddenException('You cannot read technologies.');
    return this.svc.replaceRelations(id, 'technologies', body?.technology_ids ?? [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  /** Applications, assets, technologies and supplier suggestions, in one round trip. */
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/relations')
  async relations(@Param('id') id: string, @Req() req: any) {
    return this.svc.getRelations(id, {
      manager: req?.queryRunner?.manager,
      infrastructure: canReadResource(req ?? {}, 'infrastructure'),
      applicationScope: await resolveBusinessContributorScope(req, 'applications'),
    });
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

  /** `technologies` also needs a read of the infrastructure, as the bulk replacement does. */
  private writeRelation(kind: string, id: string, targetId: string, add: boolean, req: any) {
    const relation = contractRelationKindOrThrow(kind);
    if (relation === 'technologies' && !canReadResource(req ?? {}, 'infrastructure')) {
      throw new ForbiddenException('You cannot read technologies.');
    }
    return this.svc.setRelation(relation, id, targetId, add, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
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
