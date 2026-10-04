import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { ChartOfAccountsUpsertDto } from './dto/chart-of-accounts.dto';
import { ChartOfAccountsDeleteService } from './chart-of-accounts-delete.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { Response } from 'express';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';

@UseGuards(JwtAuthGuard)
@Controller('chart-of-accounts')
export class ChartOfAccountsController {
  constructor(
    private readonly svc: ChartOfAccountsService,
    private readonly deleteSvc: ChartOfAccountsDeleteService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) {
    return this.svc.list(query, { manager: req?.queryRunner?.manager });
  }

  // Templates catalog visible to tenant users for loading
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'reader')
  @Get('templates')
  listTemplates(@Req() req: any) { return this.svc.listTemplates({ manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'member')
  @Post()
  create(@Body() body: ChartOfAccountsUpsertDto, @Req() req: any) {
    return this.svc.create(body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ChartOfAccountsUpsertDto, @Req() req: any) {
    return this.svc.update(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // Set Global Default (explicit endpoint)
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'member')
  @Patch(':id/global-default')
  setGlobalDefault(@Param('id') id: string, @Req() req: any) {
    return this.svc.setGlobalDefault(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.deleteSvc.bulkDelete(body.ids || [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.deleteSvc.delete(id, { manager: req?.queryRunner?.manager, userId: req.user?.sub ?? null });
  }

  // CoA-scoped Accounts CSV export
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'admin')
  @Get(':id/accounts/export')
  async exportAccounts(
    @Param('id') id: string,
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('language') languageRaw: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, languageRaw);
    const { filename, content } = await this.svc.exportAccountsCsv(id, { manager: req?.queryRunner?.manager, scope, language });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  // CoA-scoped Accounts CSV import
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post(':id/accounts/import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async importAccounts(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Query('language') languageRaw: string | undefined,
    @Query('dateOrder') dateOrderRaw: string | undefined,
    @Query('decimalMark') decimalMarkRaw: string | undefined,
    @Req() req: any,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, languageRaw);
    return this.svc.importAccountsCsv(id, file, dryRun, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
      language,
      dateOrder: parseDateOrder(dateOrderRaw),
      decimalMark: parseDecimalMark(decimalMarkRaw),
    });
  }

  // Load from template into selected CoA
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'member')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post(':id/load-template')
  loadTemplate(
    @Param('id') id: string,
    @Body() body: { template_id: string; dryRun?: boolean; overwrite?: boolean },
    @Req() req: any,
  ) {
    if (!body?.template_id) throw new Error('template_id is required');
    return this.svc.loadTemplateIntoCoa(
      id,
      body.template_id,
      { dryRun: !!body.dryRun, userId: req.user?.sub ?? null, overwrite: body?.overwrite !== false },
      { manager: req?.queryRunner?.manager },
    );
  }

  // Preflight import-from-template for creating a new CoA or targeting an existing one
  @UseGuards(PermissionGuard)
  @RequireLevel('accounts', 'member')
  @Post('import-template/preflight')
  preflightImportFromTemplate(@Body() body: { template_id: string; target_coa_id?: string }, @Req() req: any) {
    if (!body?.template_id) throw new Error('template_id is required');
    return this.svc.preflightTemplateImport(body.template_id, body?.target_coa_id, { manager: req?.queryRunner?.manager });
  }
}
