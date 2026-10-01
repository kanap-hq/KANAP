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

  // Item forms and budget reports read the tree without access to the page.
  @RequireAnyLevel([
    { resource: 'cost_centers', level: 'reader' },
    { resource: 'opex', level: 'reader' },
    { resource: 'capex', level: 'reader' },
    { resource: 'reporting', level: 'reader' },
  ])
  @Get('tree')
  tree(@Tenant() ctx: TenantRequest) {
    return this.svc.tree(context(ctx));
  }

  @RequireLevel('cost_centers', 'admin')
  @Get('export')
  async export(@Query('scope') scopeRaw: string, @Res() res: Response, @Tenant() ctx: TenantRequest) {
    const scope = scopeRaw === 'template' ? 'template' : scopeRaw == null || scopeRaw === 'data' ? 'data' : null;
    if (!scope) throw new BadRequestException("scope must be 'data' or 'template'.");
    const { filename, content } = await this.csv.exportCsv(scope, context(ctx));
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
  import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Tenant() ctx: TenantRequest,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    return this.csv.importCsv({ file, dryRun }, context(ctx));
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
