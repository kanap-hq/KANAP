import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompaniesDeleteService } from './companies-delete.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { ORGANISATION_LOOKUP_READERS } from '../common/lookup/lookup-requirements';
import { lookupReference, COMPANY_LOOKUP } from '../common/lookup/reference-lookups';
import { CompanyUpsertDto } from './dto/company.dto';
import { Tenant, TenantRequest } from '../common/decorators';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly svc: CompaniesService,
    private readonly deleteSvc: CompaniesDeleteService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'reader')
  @Get()
  list(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.list(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.listIds(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'reader')
  @Get('totals')
  totals(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.totals(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(ORGANISATION_LOOKUP_READERS)
  @Get('lookup')
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return lookupReference({ manager: ctx.manager, tenantId: ctx.tenantId }, COMPANY_LOOKUP, query);
  }

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(ORGANISATION_LOOKUP_READERS)
  @Get('lookup/:id')
  lookupById(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.lookupById(id, { manager: ctx.manager });
  }

  // Export route before :id to avoid collisions
  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'admin')
  @Get('export')
  async export(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('year') yearRaw: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    const year = Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : undefined;
    const { filename, content } = await this.svc.exportCsv(scope, { manager: ctx.manager, year });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.get(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'member')
  @Post()
  create(@Body() body: CompanyUpsertDto, @Tenant() ctx: TenantRequest) {
    return this.svc.create(body, ctx.userId || undefined, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: CompanyUpsertDto, @Tenant() ctx: TenantRequest) {
    return this.svc.update(id, body, ctx.userId || undefined, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Query('year') yearRaw: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const year = Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : undefined;
    return this.svc.importCsv({ file, dryRun, userId: ctx.userId || null, year }, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.bulkDelete(body.ids, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.delete(id, { manager: ctx.manager, userId: ctx.userId || null });
  }
}
