import { exportListQuery } from '../common/pagination';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';
import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators';
import { BUSINESS_PROCESS_LOOKUP_ACCESS, BUSINESS_PROCESS_LOOKUP_READERS, assertLookupSearch } from '../common/lookup/lookup-requirements';
import { BUSINESS_PROCESS_LOOKUP, lookupReference } from '../common/lookup/reference-lookups';
import { BusinessProcessesService } from './business-processes.service';
import { BusinessProcessesDeleteService } from './business-processes-delete.service';
import { BusinessProcessUpsertDto } from './dto/business-process.dto';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { BusinessProcessCategoriesService } from './business-process-categories.service';
import { BusinessProcessCategoryUpsertDto } from './dto/business-process-category.dto';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { csvExportFormat } from '../common/csv/csv-export.service';
import { csvExportBody } from '../common/csv/send-csv-export';
import { creationCancelExpired, issueCreationToken, verifyCreationToken } from '../common/creation/creation-token';
import { assertCreatorAloneSinceCreation, countChangesSinceCreation, type CreationChanges } from '../common/creation/creation-changes';

@UseGuards(JwtAuthGuard)
@Controller('business-processes')
export class BusinessProcessesController {
  constructor(
    private readonly svc: BusinessProcessesService,
    private readonly deleteSvc: BusinessProcessesDeleteService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) {
    return this.svc.list(query, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Req() req: any) {
    return this.svc.listIds(query, { manager: req?.queryRunner?.manager });
  }

  // Picker search (`q`) and hydration of chosen values (`ids`); see common/lookup.
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(BUSINESS_PROCESS_LOOKUP_READERS)
  @Get('lookup')
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    // A role that only reads a picking page gets the chosen labels (`ids`), not the list.
    assertLookupSearch(BUSINESS_PROCESS_LOOKUP_ACCESS, ctx, query);
    return lookupReference({ manager: ctx.manager, tenantId: ctx.tenantId }, BUSINESS_PROCESS_LOOKUP, query);
  }

  // Declared before ':id': Nest matches routes in declaration order, and '/export' would
  // otherwise be taken for an id and fail on the uuid cast.
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @Get('export')
  async export(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('language') languageRaw: string | undefined,
    @Query() query: any,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, languageRaw);
    const format = csvExportFormat(query?.format, scope);
    const file = await this.svc.exportCsv(scope, { manager: req?.queryRunner?.manager, language, listQuery: exportListQuery(query), format });
    res.send(await csvExportBody(res, file));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, { manager: req?.queryRunner?.manager });
  }

  /**
   * Creates the process and hands its creator a creation token (`common/creation`), which opens
   * Cancel (`DELETE :id/creation`) for this record and this person only.
   */
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Post()
  async create(@Body() body: BusinessProcessUpsertDto, @Req() req: any) {
    const created = await this.svc.create(body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
    const creation_token = issueCreationToken({ tenantId: req?.tenant?.id ?? '', family: 'business-processes', recordId: created.id, userId: req.user?.sub ?? '' });
    return Object.assign(created, { creation_token });
  }

  /** The token of `POST /business-processes` for this record, tenant and person, still valid; a 403 otherwise. */
  private assertCreationToken(id: string, token: unknown, req: any): void {
    const subject = { tenantId: req?.tenant?.id ?? '', family: 'business-processes', recordId: String(id ?? ''), userId: req?.user?.sub ?? '' };
    if (!verifyCreationToken(token, subject)) throw creationCancelExpired();
  }

  /**
   * Before Cancel: what was written on the process and its application links since its creation
   * (its history's audit rows). Its categories, which the history does not show, count as one
   * field once set. Nothing is written.
   */
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Get(':id/creation')
  async creationChanges(@Param('id') id: string, @Query('token') token: string, @Req() req: any): Promise<{ changes: CreationChanges }> {
    this.assertCreationToken(id, token, req);
    const manager = req?.queryRunner?.manager;
    const tenantId = req?.tenant?.id ?? '';
    const found = await manager.query('SELECT 1 FROM business_processes WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (!found.length) throw new NotFoundException('Business process not found');
    await assertCreatorAloneSinceCreation(manager, tenantId, 'business_processes', id, req?.user?.sub ?? '');
    const changes = await countChangesSinceCreation(manager, tenantId, 'business_processes', id);
    const [{ total }] = await manager.query(
      'SELECT count(*)::int AS total FROM business_process_category_links WHERE tenant_id = $1 AND process_id = $2',
      [tenantId, id],
    );
    return { changes: total > 0 ? { ...changes, fields: changes.fields + 1 } : changes };
  }

  /**
   * Cancel: the creator deletes the process they just created, with its token, even without the
   * delete right (admin), while nobody else has written on it (403 `CREATION_CANCEL_EXPIRED`
   * otherwise, checked under its lock). The application links made meanwhile go with it; an
   * interface that names it still refuses the delete, as `DELETE :id`.
   */
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Delete(':id/creation')
  async cancelCreation(@Param('id') id: string, @Body() body: { token?: string }, @Req() req: any): Promise<void> {
    this.assertCreationToken(id, body?.token, req);
    const manager = req?.queryRunner?.manager;
    await assertCreatorAloneSinceCreation(manager, req?.tenant?.id ?? '', 'business_processes', id, req?.user?.sub ?? '', { lock: true });
    await this.deleteSvc.cancelCreation(id, { manager, userId: req.user?.sub ?? null });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: BusinessProcessUpsertDto, @Req() req: any) {
    return this.svc.update(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // What a delete of `ids` would refuse, asked before the confirmation.
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @Post('delete-check')
  deleteCheck(@Body() body: { ids?: unknown }, @Req() req: any) {
    return this.deleteSvc.deleteCheck(Array.isArray(body?.ids) ? body.ids : [], { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.deleteSvc.bulkDelete(body.ids, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.deleteSvc.delete(id, { manager: req?.queryRunner?.manager, userId: req.user?.sub ?? null });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
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
}

@UseGuards(JwtAuthGuard)
@Controller('business-process-categories')
export class BusinessProcessCategoriesController {
  constructor(private readonly svc: BusinessProcessCategoriesService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) {
    return this.svc.list(query, { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Post()
  create(@Body() body: { name: string } | BusinessProcessCategoryUpsertDto, @Req() req: any) {
    return this.svc.create(body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: BusinessProcessCategoryUpsertDto, @Req() req: any) {
    return this.svc.update(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.svc.delete(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }
}
