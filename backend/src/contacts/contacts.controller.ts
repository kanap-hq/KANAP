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
import { contentDisposition } from '../common/content-disposition';
import { ContactUpsertDto } from './dto/contact.dto';
import { ContactsDeleteService } from './contacts-delete.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { Tenant, TenantRequest } from '../common/decorators';
import { readContactUsages } from './contact-usages';

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
    const { filename, content } = await this.svc.exportCsv(scope, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, language, listQuery: exportListQuery(query) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) { return this.svc.get(id, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id }); }

  // Where the contact is used: the groups the caller may read (common/record-usages.ts).
  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'reader')
  @Get(':id/usages')
  usages(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    if (!ctx.manager) throw new InternalServerErrorException('No request transaction');
    return readContactUsages(ctx.manager, ctx.tenantId, id, ctx);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Post()
  create(@Body() body: ContactUpsertDto, @Req() req: any) {
    return this.svc.create(body, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ContactUpsertDto, @Req() req: any) {
    return this.svc.update(id, body, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    return this.del.bulkDelete(ids, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) { return this.svc.delete(id, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'admin')
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
      { file, dryRun, language, dateOrder: parseDateOrder(dateOrderRaw), decimalMark: parseDecimalMark(decimalMarkRaw) },
      { manager: req?.queryRunner?.manager, tenantId: req.tenant.id },
    );
  }
}
