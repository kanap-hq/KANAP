import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { BusinessProcessesService } from './business-processes.service';
import { BusinessProcessesDeleteService } from './business-processes-delete.service';
import { BusinessProcessUpsertDto } from './dto/business-process.dto';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { BusinessProcessCategoriesService } from './business-process-categories.service';
import { BusinessProcessCategoryUpsertDto } from './dto/business-process-category.dto';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('business-processes')
export class BusinessProcessesController {
  constructor(
    private readonly svc: BusinessProcessesService,
    private readonly deleteSvc: BusinessProcessesDeleteService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) {
    return this.svc.list(query, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Req() req: any) {
    return this.svc.listIds(query, { manager: req?.queryRunner?.manager });
  }

  // Declared before ':id': Nest matches routes in declaration order, and '/export' would
  // otherwise be taken for an id and fail on the uuid cast.
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @Get('export')
  async export(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Res() res: Response,
    @Req() req: any,
  ) {
    const { filename, content } = await this.svc.exportCsv(scope, { manager: req?.queryRunner?.manager });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Post()
  create(@Body() body: BusinessProcessUpsertDto, @Req() req: any) {
    return this.svc.create(body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: BusinessProcessUpsertDto, @Req() req: any) {
    return this.svc.update(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.deleteSvc.bulkDelete(body.ids, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.deleteSvc.delete(id, { manager: req?.queryRunner?.manager, userId: req.user?.sub ?? null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Req() req: any,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    return this.svc.importCsv({ file, dryRun, userId: req.user?.sub ?? null }, { manager: req?.queryRunner?.manager });
  }
}

@UseGuards(JwtAuthGuard)
@Controller('business-process-categories')
export class BusinessProcessCategoriesController {
  constructor(private readonly svc: BusinessProcessCategoriesService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) {
    return this.svc.list(query, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Post()
  create(@Body() body: { name: string } | BusinessProcessCategoryUpsertDto, @Req() req: any) {
    return this.svc.create(body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: BusinessProcessCategoryUpsertDto, @Req() req: any) {
    return this.svc.update(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.svc.delete(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }
}
