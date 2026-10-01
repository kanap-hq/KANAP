import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards, UploadedFile, UseInterceptors, Res } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { MultiTenantOnlyGuard } from '../../common/feature-gates';
import { AdminCoaTemplatesService } from './admin-coa-templates.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../../common/upload';
import { contentDisposition } from '../../common/content-disposition';
import { Response } from 'express';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../../common/request-db-timeouts';

@UseGuards(MultiTenantOnlyGuard, JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/coa-templates')
export class AdminCoaTemplatesController {
  constructor(private readonly svc: AdminCoaTemplatesService) {}

  @Get()
  list(@Query() query: any) { return this.svc.list(query); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  create(@Body() body: { country_iso?: string; template_code?: string; template_name?: string; version?: string; is_global?: boolean; loaded_by_default?: boolean }, @Req() req: any) {
    return this.svc.create(body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<{ country_iso: string | null; template_code: string; template_name: string; version: string; is_global: boolean; loaded_by_default: boolean }>, @Req() req: any) {
    return this.svc.update(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.svc.delete(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Get(':id/export')
  async export(@Param('id') id: string, @Res() res: Response) {
    const { filename, content } = await this.svc.exportCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post(':id/import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  import(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw?: string,
    @Req() req?: any,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    return this.svc.importCsv(id, file, dryRun, req?.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // Standard Accounts management within a Template (platform admin scope)
  @Get(':id/accounts')
  listAccounts(@Param('id') id: string, @Query() query: any, @Req() req: any) {
    return this.svc.listAccounts(id, query, { manager: req?.queryRunner?.manager });
  }

  @Get(':id/accounts/ids')
  listAccountIds(@Param('id') id: string, @Query() query: any, @Req() req: any) {
    return this.svc.listAccountIds(id, query, { manager: req?.queryRunner?.manager });
  }

  @Get(':id/accounts/:accountNumber')
  getAccount(@Param('id') id: string, @Param('accountNumber') accountNumber: string, @Req() req: any) {
    return this.svc.getAccount(id, accountNumber, { manager: req?.queryRunner?.manager });
  }

  @Post(':id/accounts')
  createAccount(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.createAccount(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Patch(':id/accounts/:accountNumber')
  updateAccount(@Param('id') id: string, @Param('accountNumber') accountNumber: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateAccount(id, accountNumber, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Delete(':id/accounts/bulk')
  bulkDeleteAccounts(@Param('id') id: string, @Body() body: { ids: string[] }, @Req() req: any) {
    return this.svc.bulkDeleteAccounts(id, body?.ids || [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Delete(':id/accounts/:accountNumber')
  deleteAccount(@Param('id') id: string, @Param('accountNumber') accountNumber: string, @Req() req: any) {
    return this.svc.deleteAccount(id, accountNumber, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }
}
