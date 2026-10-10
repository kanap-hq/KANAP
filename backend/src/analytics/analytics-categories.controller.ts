import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { contentDisposition } from '../common/content-disposition';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';
import { Tenant, TenantRequest } from '../common/decorators';
import { csvImportMulterOptions } from '../common/upload';
import { AnalyticsCategoriesCsvService } from './analytics-categories-csv.service';
import { AnalyticsCategoriesService } from './analytics-categories.service';
import { AnalyticsContext } from './analytics-context';
import { lookupAnalyticsValues } from '../common/lookup/reference-lookups';
import {
  AnalyticsCategoryBulkDeleteDto,
  AnalyticsCategoryCreateDto,
  AnalyticsCategoryReorderDto,
  AnalyticsCategoryUpdateDto,
} from './dto/analytics.dto';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

export function analyticsContext(ctx: TenantRequest): AnalyticsContext {
  if (!ctx.manager) throw new InternalServerErrorException('Missing request transaction.');
  return { manager: ctx.manager, tenantId: ctx.tenantId, userId: ctx.userId || null };
}

/** Item forms, lists and budget reports read the values without access to the page. */
export const ANALYTICS_READERS = [
  { resource: 'analytics', level: 'reader' as const },
  { resource: 'opex', level: 'reader' as const },
  { resource: 'capex', level: 'reader' as const },
  { resource: 'reporting', level: 'reader' as const },
];

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('analytics-categories')
export class AnalyticsCategoriesController {
  constructor(
    private readonly svc: AnalyticsCategoriesService,
    private readonly csv: AnalyticsCategoriesCsvService,
  ) {}

  @RequireAnyLevel(ANALYTICS_READERS)
  @Get()
  list(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.list(query, analyticsContext(ctx));
  }

  // Picker search within one dimension (`axis_id`) and hydration (`ids`); see common/lookup.
  @RequireAnyLevel(ANALYTICS_READERS)
  @Get('lookup')
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return lookupAnalyticsValues({ manager: ctx.manager, tenantId: ctx.tenantId }, query);
  }

  @RequireAnyLevel(ANALYTICS_READERS)
  @Get('ids')
  listIds(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.listIds(query, analyticsContext(ctx));
  }

  @RequireLevel('analytics', 'admin')
  @Get('export')
  async export(
    @Query('scope') scopeRaw: string,
    @Query('language') languageRaw: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    const scope = scopeRaw === 'template' ? 'template' : scopeRaw == null || scopeRaw === 'data' ? 'data' : null;
    if (!scope) throw new BadRequestException("scope must be 'data' or 'template'.");
    const caller = analyticsContext(ctx);
    const language = await languageOf(caller.manager, caller.tenantId, caller.userId ?? null, languageRaw);
    const { filename, content } = await this.csv.exportCsv(scope, caller, language);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  // The order of one dimension's values (same permission as PATCH :id), before the `:id` routes.
  @RequireLevel('analytics', 'member')
  @Post('reorder')
  reorder(@Body() body: AnalyticsCategoryReorderDto, @Tenant() ctx: TenantRequest) {
    const context = analyticsContext(ctx);
    return this.svc.reorder(body?.axis_id, body?.value_ids, context.userId, context);
  }

  @RequireAnyLevel(ANALYTICS_READERS)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.get(id, analyticsContext(ctx));
  }

  @RequireLevel('analytics', 'member')
  @Post()
  create(@Body() body: AnalyticsCategoryCreateDto, @Tenant() ctx: TenantRequest) {
    const context = analyticsContext(ctx);
    return this.svc.create(body, context.userId, context);
  }

  @RequireLevel('analytics', 'admin')
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
    const caller = analyticsContext(ctx);
    const language = await languageOf(caller.manager, caller.tenantId, caller.userId ?? null, languageRaw);
    return this.csv.importCsv(
      {
        file,
        dryRun,
        language,
        dateOrder: parseDateOrder(dateOrderRaw),
        decimalMark: parseDecimalMark(decimalMarkRaw),
      },
      caller,
    );
  }

  @RequireLevel('analytics', 'member')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AnalyticsCategoryUpdateDto,
    @Tenant() ctx: TenantRequest,
  ) {
    const context = analyticsContext(ctx);
    return this.svc.update(id, body, context.userId, context);
  }

  @RequireLevel('analytics', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: AnalyticsCategoryBulkDeleteDto, @Tenant() ctx: TenantRequest) {
    const context = analyticsContext(ctx);
    return this.svc.bulkDelete(body.ids, context.userId, context);
  }

  @RequireLevel('analytics', 'admin')
  @Delete(':id')
  delete(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    const context = analyticsContext(ctx);
    return this.svc.delete(id, context.userId, context);
  }
}
