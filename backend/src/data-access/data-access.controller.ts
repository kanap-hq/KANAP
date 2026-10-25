import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { contentDisposition } from '../common/content-disposition';
import { languageOf } from '../common/csv-sheet';
import { Tenant, TenantRequest } from '../common/decorators';
import { csvImportMulterOptions } from '../common/upload';
import { DataAccessAdminService } from './data-access-admin.service';
import { readPlacementOptions } from './placement-options';
import { ReservedToUnscopedDataAccess } from './reserved-operations';

/**
 * Data-scoped access: the person's own placement options (lot 3, not reserved: spec §8) and the
 * administration overview and CSV routes of lot 6 (reserved to unscoped persons who administer
 * users). The literal routes are declared before any parameter route (Nest matches in order).
 */
@UseGuards(JwtAuthGuard)
@Controller('data-access')
export class DataAccessController {
  constructor(private readonly svc: DataAccessAdminService) {}

  /** The companies and cost centers the person may place a budget line on (`placement-options.ts`). */
  @Get('placement-options')
  placementOptions(@Tenant() ctx: TenantRequest) {
    if (!ctx.manager) throw new InternalServerErrorException('Missing request transaction.');
    return readPlacementOptions(ctx.manager);
  }

  /** `GET /data-access` (spec §7.3, §8): limited persons, node and name filters, counters. */
  @Get()
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @ReservedToUnscopedDataAccess()
  overview(@Query() query: any, @Tenant() ctx: TenantRequest) {
    if (!ctx.manager) throw new InternalServerErrorException('Missing request transaction.');
    return this.svc.overview(ctx.manager, query);
  }

  /** `GET /data-access/export` (spec §7.5): the access file of every limited person. */
  @Get('export')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @ReservedToUnscopedDataAccess()
  async export(
    @Query('language') languageRaw: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    if (!ctx.manager) throw new InternalServerErrorException('Missing request transaction.');
    const language = await languageOf(ctx.manager, ctx.tenantId, ctx.userId || null, languageRaw);
    const { filename, content } = await this.svc.exportCsv(ctx.manager, language);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  /** `POST /data-access/import?dryRun=` (spec §7.5): dry run by default, nothing written on any error. */
  @Post('import')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @ReservedToUnscopedDataAccess()
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Query('language') languageRaw: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    if (!ctx.manager) throw new InternalServerErrorException('Missing request transaction.');
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const language = await languageOf(ctx.manager, ctx.tenantId, ctx.userId || null, languageRaw);
    return this.svc.importCsv(ctx.manager, { file, dryRun, language, callerId: ctx.userId || null });
  }
}
