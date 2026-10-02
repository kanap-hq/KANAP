import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsDeleteService } from './accounts-delete.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { ACCOUNT_LOOKUP_ACCESS, ACCOUNT_LOOKUP_READERS, assertLookupSearch } from '../common/lookup/lookup-requirements';
import { lookupAccounts } from '../common/lookup/reference-lookups';
import { AccountUpsertDto } from './dto/account.dto';
import { Tenant, TenantRequest } from '../common/decorators';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly svc: AccountsService,
    private readonly deleteSvc: AccountsDeleteService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'reader')
  @Get()
  list(@Query() query: any, @Tenant() ctx: TenantRequest) { return this.svc.list(query, { manager: ctx.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.listIds(query, { manager: ctx.manager });
  }
  // Picker search within a company's chart (`companyId`) and hydration (`ids`); see common/lookup.
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(ACCOUNT_LOOKUP_READERS)
  @Get('lookup')
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    // A role that only reads a picking page gets the chosen labels (`ids`), not the list.
    assertLookupSearch(ACCOUNT_LOOKUP_ACCESS, ctx, query);
    return lookupAccounts({ manager: ctx.manager, tenantId: ctx.tenantId }, query);
  }
  // Export before parameterized ':id' to avoid collisions
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'admin')
  @Get('export')
  async export(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('coaId') coaId: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    const { filename, content } = await this.svc.exportCsv(scope, { manager: ctx.manager, coaId, includeCoaCode: !coaId });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Tenant() ctx: TenantRequest) { return this.svc.get(id, { manager: ctx.manager }); }
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'member')
  @Post()
  create(@Body() body: AccountUpsertDto, @Query('coaId') coaId: string | undefined, @Tenant() ctx: TenantRequest) {
    const payload = { ...body } as AccountUpsertDto;
    if (!payload.coa_id && coaId) (payload as any).coa_id = coaId;
    return this.svc.create(payload, ctx.userId || undefined, { manager: ctx.manager });
  }
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: AccountUpsertDto, @Tenant() ctx: TenantRequest) { return this.svc.update(id, body, ctx.userId || undefined, { manager: ctx.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Query('coaId') coaId: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    return this.svc.importCsv({ file, dryRun, userId: ctx.userId || null }, { manager: ctx.manager, targetCoaId: coaId, allowCoaCodeColumn: !coaId });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.bulkDelete(body.ids, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.delete(id, { manager: ctx.manager, userId: ctx.userId || null });
  }

}
