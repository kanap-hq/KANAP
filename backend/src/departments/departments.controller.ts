import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { DepartmentsDeleteService } from './departments-delete.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { ORGANISATION_LOOKUP_READERS } from '../common/lookup/lookup-requirements';
import { lookupDepartments } from '../common/lookup/reference-lookups';
import { DepartmentUpsertDto } from './dto/department.dto';
import { Tenant, TenantRequest } from '../common/decorators';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { EntityManager } from 'typeorm';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';

@UseGuards(JwtAuthGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly svc: DepartmentsService,
    private readonly deleteSvc: DepartmentsDeleteService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'reader')
  @Get()
  list(@Query() query: any, @Tenant() ctx: TenantRequest) { return this.svc.list(query, { manager: ctx.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.listIds(query, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(ORGANISATION_LOOKUP_READERS)
  @Get('lookup')
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return lookupDepartments({ manager: ctx.manager, tenantId: ctx.tenantId }, query);
  }

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(ORGANISATION_LOOKUP_READERS)
  @Get('lookup/:id')
  lookupById(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.lookupById(id, { manager: ctx.manager });
  }

  // Export route before :id to avoid collisions
  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'admin')
  @Get('export')
  async export(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('language') languageRaw: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    const language = await languageOf(ctx.manager as EntityManager, ctx.tenantId, ctx.userId ?? null, languageRaw);
    const { filename, content } = await this.svc.exportCsv(scope, { manager: ctx.manager, language });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Tenant() ctx: TenantRequest) { return this.svc.get(id, { manager: ctx.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'member')
  @Post()
  create(@Body() body: DepartmentUpsertDto, @Tenant() ctx: TenantRequest) { return this.svc.create(body, ctx.userId || undefined, { manager: ctx.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: DepartmentUpsertDto, @Tenant() ctx: TenantRequest) { return this.svc.update(id, body, ctx.userId || undefined, { manager: ctx.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Query('language') languageRaw: string | undefined,
    @Query('dateOrder') dateOrderRaw: string | undefined,
    @Query('decimalMark') decimalMarkRaw: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const language = await languageOf(ctx.manager as EntityManager, ctx.tenantId, ctx.userId ?? null, languageRaw);
    return this.svc.importCsv(
      {
        file,
        dryRun,
        userId: ctx.userId || null,
        language,
        dateOrder: parseDateOrder(dateOrderRaw),
        decimalMark: parseDecimalMark(decimalMarkRaw),
      },
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.bulkDelete(body.ids, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('departments', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.delete(id, { manager: ctx.manager, userId: ctx.userId || null });
  }
}
