import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { RequireAnyLevel, RequireAnyLevelMeta, RequireLevel } from '../auth/require-level.decorator';
import { contentDisposition } from '../common/content-disposition';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';
import { Tenant, TenantRequest } from '../common/decorators';
import { csvImportMulterOptions } from '../common/upload';
import { CostCentersCsvService } from './cost-centers-csv.service';
import { CostCentersDeleteService } from './cost-centers-delete.service';
import { CostCenterContext, CostCentersService } from './cost-centers.service';
import { CostCenterBulkDeleteDto, CostCenterCreateDto, CostCenterUpdateDto } from './dto/cost-center.dto';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

function context(ctx: TenantRequest): CostCenterContext {
  if (!ctx.manager) throw new InternalServerErrorException('Missing request transaction.');
  return { manager: ctx.manager, tenantId: ctx.tenantId, userId: ctx.userId || null };
}

/** Who reads the tree: the page, and the item forms and budget reports that pick or filter on a node. */
export const TREE_READERS: RequireAnyLevelMeta = [
  { resource: 'cost_centers', level: 'reader' },
  { resource: 'opex', level: 'reader' },
  { resource: 'capex', level: 'reader' },
  { resource: 'reporting', level: 'reader' },
];

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('cost-centers')
export class CostCentersController {
  constructor(
    private readonly svc: CostCentersService,
    private readonly deleteSvc: CostCentersDeleteService,
    private readonly csv: CostCentersCsvService,
  ) {}

  @RequireLevel('cost_centers', 'reader')
  @Get()
  list(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.list(query, context(ctx));
  }

  @RequireLevel('cost_centers', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.svc.listIds(query, context(ctx));
  }

  // Item forms and budget reports read the tree without access to the page. `no-cache`: the
  // browser keeps the answer and asks again with its ETag (Express's, over the body), so an
  // unchanged tree comes back as a bodiless 304.
  @RequireAnyLevel(TREE_READERS)
  @Header('Cache-Control', 'private, no-cache')
  @Get('tree')
  tree(@Tenant() ctx: TenantRequest) {
    return this.svc.tree(context(ctx));
  }

  // Whether a budget report offers the cost center filter, without loading the tree.
  @RequireAnyLevel(TREE_READERS)
  @Header('Cache-Control', 'private, no-cache')
  @Get('tree/count')
  treeCount(@Tenant() ctx: TenantRequest) {
    return this.svc.count(context(ctx));
  }

  @RequireLevel('cost_centers', 'admin')
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

  @RequireLevel('cost_centers', 'reader')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.get(id, context(ctx));
  }

  @RequireLevel('cost_centers', 'member')
  @Post()
  create(@Body() body: CostCenterCreateDto, @Tenant() ctx: TenantRequest) {
    return this.svc.create(body, context(ctx));
  }

  @RequireLevel('cost_centers', 'member')
  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: CostCenterUpdateDto, @Tenant() ctx: TenantRequest) {
    return this.svc.update(id, body, context(ctx));
  }

  @RequireLevel('cost_centers', 'admin')
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

  @RequireLevel('cost_centers', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: CostCenterBulkDeleteDto, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.bulkDelete(body.ids, context(ctx));
  }

  @RequireLevel('cost_centers', 'admin')
  @Delete(':id')
  delete(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.delete(id, context(ctx));
  }
}
