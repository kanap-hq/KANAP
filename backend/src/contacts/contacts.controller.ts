import { ImportRoute } from '../audit/security-events';
import { Body, Controller, Delete, Get, InternalServerErrorException, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { exportListQuery } from '../common/pagination';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ContactsService } from './contacts.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';
import { ContactUpsertDto } from './dto/contact.dto';
import { ContactsDeleteService } from './contacts-delete.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { Tenant, TenantRequest } from '../common/decorators';
import { readContactUsages } from './contact-usages';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { csvExportFormat } from '../common/csv/csv-export.service';
import { csvExportBody } from '../common/csv/send-csv-export';
import { cancelCreation, readCreationChanges, withCreationToken } from '../common/creation/creation-routes';
import { resolveToUuid } from '../common/resolve-item-id';
import { csvCallerAccess } from '../common/csv/csv-field.types';
import { csvUnmatched } from '../common/csv/csv-unmatched';

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly svc: ContactsService, private readonly del: ContactsDeleteService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) { return this.svc.list(query, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id }); }

  // Declared before ':id': Nest matches routes in declaration order, and '/export' would
  // otherwise be taken for an id and fail on the uuid cast.
  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'admin')
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
    const file = await this.svc.exportCsv(scope, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, language, listQuery: exportListQuery(query), format });
    res.send(await csvExportBody(res, file));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'reader')
  @Get(':id')
  async get(@Param('id') idOrRef: string, @Req() req: any) { return this.svc.get(await resolveToUuid(idOrRef, 'contact', req?.queryRunner?.manager), { manager: req?.queryRunner?.manager, tenantId: req.tenant.id }); }

  // Where the contact is used: the groups the caller may read (common/record-usages.ts).
  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'reader')
  @Get(':id/usages')
  async usages(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    if (!ctx.manager) throw new InternalServerErrorException('No request transaction');
    return readContactUsages(ctx.manager, ctx.tenantId, await resolveToUuid(idOrRef, 'contact', ctx.manager), ctx);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Post()
  async create(@Body() body: ContactUpsertDto, @Req() req: any, @Tenant() ctx: TenantRequest) {
    return withCreationToken('contacts', await this.svc.create(body, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null }), ctx);
  }

  // Before Cancel of the contact being created: what was written on it since (common/creation).
  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Get(':id/creation')
  creationChanges(@Param('id', new ParseUUIDPipe()) id: string, @Query('token') token: string, @Tenant() ctx: TenantRequest) {
    return readCreationChanges('contacts', id, token, ctx);
  }

  // Cancel: the creator deletes the contact they just created, with its token, without the delete right.
  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Delete(':id/creation')
  cancelCreation(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: { token?: string }, @Tenant() ctx: TenantRequest) {
    return cancelCreation('contacts', id, body?.token, ctx, () => this.svc.delete(id, { manager: ctx.manager, tenantId: ctx.tenantId, userId: ctx.userId || null }));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Patch(':id')
  async update(@Param('id') idOrRef: string, @Body() body: ContactUpsertDto, @Req() req: any) {
    return this.svc.update(await resolveToUuid(idOrRef, 'contact', req?.queryRunner?.manager), body, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    return this.del.bulkDelete(ids, { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'admin')
  @Delete(':id')
  async remove(@Param('id') idOrRef: string, @Req() req: any) { return this.svc.delete(await resolveToUuid(idOrRef, 'contact', req?.queryRunner?.manager), { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null }); }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @ImportRoute('contacts')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Query('language') languageRaw: string | undefined,
    @Query('dateOrder') dateOrderRaw: string | undefined,
    @Query('decimalMark') decimalMarkRaw: string | undefined,
    @Body('unmatched') unmatchedRaw: unknown,
    @Req() req: any,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, languageRaw);
    return this.svc.importCsv(
      {
        file,
        dryRun,
        language,
        dateOrder: parseDateOrder(dateOrderRaw),
        decimalMark: parseDecimalMark(decimalMarkRaw),
        // The person's rights find a supplier's name beyond case; the matches they undid are not made again.
        access: csvCallerAccess(req),
        unmatched: csvUnmatched(unmatchedRaw),
        // The clearing rule of every import (D21 of 26.11.9): a blank cell keeps, `-` clears.
        mode: 'enrich',
      },
      { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null },
    );
  }
}
