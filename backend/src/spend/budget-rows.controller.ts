import { Controller, Get, InternalServerErrorException, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { EntityManager } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel } from '../auth/require-level.decorator';
import { contentDisposition } from '../common/content-disposition';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { csvImportMulterOptions } from '../common/upload';
import { BudgetRowsCsvService } from './budget-rows-csv.service';

// Five rows per line and year (about 100 to 150 bytes each): the item CSV's
// 1 MB would refuse the export of a mid-size tenant. A year-limited export
// splits a larger file.
export const BUDGET_ROWS_MAX_BYTES = 10 * 1024 * 1024;
const budgetRowsMulterOptions = {
  ...csvImportMulterOptions,
  limits: { ...csvImportMulterOptions.limits, fileSize: BUDGET_ROWS_MAX_BYTES },
};

function requestManager(ctx: TenantRequest): EntityManager {
  if (!ctx.manager) throw new InternalServerErrorException('The budget rows file needs the request transaction.');
  return ctx.manager;
}

/**
 * Budget rows file, tenant-wide over OPEX and CAPEX: the export holds the item
 * types the user can read; the import needs administration of the item type
 * of each row.
 */
@UseGuards(JwtAuthGuard)
@Controller('budget-rows')
export class BudgetRowsController {
  constructor(private readonly svc: BudgetRowsCsvService) {}

  @UseGuards(PermissionGuard)
  @RequireAnyLevel([{ resource: 'opex', level: 'reader' }, { resource: 'capex', level: 'reader' }])
  @Get('export')
  async export(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('year') year: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const { filename, content } = await this.svc.exportCsv(
      { scope, year, access: { isAdmin: ctx.isAdmin, permissions: ctx.permissions } },
      { manager: requestManager(ctx), tenantId: ctx.tenantId },
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @UseGuards(PermissionGuard)
  @RequireAnyLevel([{ resource: 'opex', level: 'admin' }, { resource: 'capex', level: 'admin' }])
  @Post('import')
  @UseInterceptors(FileInterceptor('file', budgetRowsMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    return this.svc.importCsv(
      { file, dryRun, userId: ctx.userId || null, access: { isAdmin: ctx.isAdmin, permissions: ctx.permissions } },
      { manager: requestManager(ctx), tenantId: ctx.tenantId },
    );
  }
}
