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
import {
  WorkingDayProfileBulkDeleteDto,
  WorkingDayProfileCreateDto,
  WorkingDayProfileUpdateDto,
} from './dto/working-day-profile.dto';
import { WorkingDayProfilesCsvService } from './working-day-profiles-csv.service';
import { WorkingDayProfilesDeleteService } from './working-day-profiles-delete.service';
import { WorkingDayProfileContext, WorkingDayProfilesService } from './working-day-profiles.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

function context(ctx: TenantRequest): WorkingDayProfileContext {
  if (!ctx.manager) throw new InternalServerErrorException('Missing request transaction.');
  return { manager: ctx.manager, tenantId: ctx.tenantId, userId: ctx.userId || null };
}

// The budget tab's compute panel lists the calendars without access to the page.
const CALENDAR_READERS = [
  { resource: 'working_day_profiles', level: 'reader' as const },
  { resource: 'opex', level: 'reader' as const },
  { resource: 'capex', level: 'reader' as const },
];

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('working-day-profiles')
export class WorkingDayProfilesController {
  constructor(
    private readonly svc: WorkingDayProfilesService,
    private readonly deleteSvc: WorkingDayProfilesDeleteService,
    private readonly csv: WorkingDayProfilesCsvService,
  ) {}

  @RequireAnyLevel(CALENDAR_READERS)
  @Get()
  list(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.list(query, context(ctx));
  }

  // Before `:id`, which would read these words as an id.
  @RequireAnyLevel(CALENDAR_READERS)
  @Get('countries')
  countries(@Query('lang') lang?: string) {
    return this.svc.countries(lang);
  }

  // The page offers them to users who can create calendars.
  @RequireLevel('working_day_profiles', 'member')
  @Get('suggestions')
  suggestions(@Query('lang') lang: string | undefined, @Tenant() ctx: TenantRequest) {
    return this.svc.suggestions(context(ctx), lang);
  }

  @RequireAnyLevel(CALENDAR_READERS)
  @Get('ids')
  listIds(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.listIds(query, context(ctx));
  }

  @RequireLevel('working_day_profiles', 'admin')
  @Get('export')
  async export(
    @Query('scope') scopeRaw: string,
    @Query('language') languageRaw: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    const scope = scopeRaw === 'template' ? 'template' : scopeRaw == null || scopeRaw === 'data' ? 'data' : null;
    if (!scope) throw new BadRequestException("scope must be 'data' or 'template'.");
    const caller = context(ctx);
    const language = await languageOf(caller.manager, caller.tenantId, caller.userId ?? null, languageRaw);
    const { filename, content } = await this.csv.exportCsv(scope, caller, language);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @RequireAnyLevel(CALENDAR_READERS)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Query('lang') lang: string | undefined, @Tenant() ctx: TenantRequest) {
    return this.svc.get(id, context(ctx), lang);
  }

  @RequireAnyLevel(CALENDAR_READERS)
  @Get(':id/years/:year')
  year(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('year') year: string,
    @Query('lang') lang: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.getYear(id, year, context(ctx), lang);
  }

  @RequireLevel('working_day_profiles', 'member')
  @Post()
  create(@Body() body: WorkingDayProfileCreateDto, @Query('lang') lang: string | undefined, @Tenant() ctx: TenantRequest) {
    return this.svc.create(body, context(ctx), lang);
  }

  @RequireLevel('working_day_profiles', 'member')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: WorkingDayProfileUpdateDto,
    @Query('lang') lang: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.update(id, body, context(ctx), lang);
  }

  @RequireLevel('working_day_profiles', 'admin')
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
    const caller = context(ctx);
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

  @RequireLevel('working_day_profiles', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: WorkingDayProfileBulkDeleteDto, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.bulkDelete(body.ids, context(ctx));
  }

  @RequireLevel('working_day_profiles', 'admin')
  @Delete(':id')
  delete(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.delete(id, context(ctx));
  }
}
