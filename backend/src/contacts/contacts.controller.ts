import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ContactsService } from './contacts.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { ContactUpsertDto } from './dto/contact.dto';
import { ContactsDeleteService } from './contacts-delete.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly svc: ContactsService, private readonly del: ContactsDeleteService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) { return this.svc.list(query, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id }); }

  // Declared before ':id': Nest matches routes in declaration order, and '/export' would
  // otherwise be taken for an id and fail on the uuid cast.
  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'admin')
  @Get('export')
  async export(@Query('scope') scope: 'template' | 'data' = 'data', @Res() res: Response, @Req() req: any) {
    const { filename, content } = await this.svc.exportCsv(scope, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) { return this.svc.get(id, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Post()
  create(@Body() body: ContactUpsertDto, @Req() req: any) {
    return this.svc.create(body, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: ContactUpsertDto, @Req() req: any) {
    return this.svc.update(id, body, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    return this.del.bulkDelete(ids, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'member')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) { return this.svc.delete(id, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('contacts', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(@UploadedFile() file: Express.Multer.File, @Query('dryRun') dryRunRaw: string, @Req() req: any) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    return this.svc.importCsv({ file, dryRun }, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
  }
}
