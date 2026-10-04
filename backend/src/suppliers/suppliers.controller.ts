import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SuppliersDeleteService } from './suppliers-delete.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators';
import { SUPPLIER_LOOKUP_ACCESS, SUPPLIER_LOOKUP_READERS, assertLookupSearch } from '../common/lookup/lookup-requirements';
import { lookupReference, SUPPLIER_LOOKUP } from '../common/lookup/reference-lookups';
import { SupplierUpsertDto } from './dto/supplier.dto';
import { SupplierContactsService } from './supplier-contacts.service';
import { SupplierContactRole } from '../contacts/supplier-contact.entity';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';

@UseGuards(JwtAuthGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly svc: SuppliersService,
    private readonly deleteSvc: SuppliersDeleteService,
    private readonly links: SupplierContactsService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) { return this.svc.list(query, { manager: req?.queryRunner?.manager }); }
  
  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Req() req: any) {
    return this.svc.listIds(query, { manager: req?.queryRunner?.manager });
  }
  // Picker search (`q`) and hydration of chosen values (`ids`); see common/lookup.
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(SUPPLIER_LOOKUP_READERS)
  @Get('lookup')
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    // A role that only reads a picking page gets the chosen labels (`ids`), not the list.
    assertLookupSearch(SUPPLIER_LOOKUP_ACCESS, ctx, query);
    return lookupReference({ manager: ctx.manager, tenantId: ctx.tenantId }, SUPPLIER_LOOKUP, query);
  }
  // Place static path before parameterized route to avoid collisions with ':id'
  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'admin')
  @Get('export')
  async export(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('language') languageRaw: string | undefined,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, languageRaw);
    const { filename, content } = await this.svc.exportCsv(scope, { manager: req?.queryRunner?.manager, language });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }
  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) { return this.svc.get(id, { manager: req?.queryRunner?.manager }); }
  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'member')
  @Post()
  create(@Body() body: SupplierUpsertDto, @Req() req: any) { return this.svc.create(body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }
  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: SupplierUpsertDto, @Req() req: any) { return this.svc.update(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Query('language') languageRaw: string | undefined,
    @Query('dateOrder') dateOrderRaw: string | undefined,
    @Query('decimalMark') decimalMarkRaw: string | undefined,
    @Req() req: any,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, languageRaw);
    return this.svc.importCsv(
      {
        file,
        dryRun,
        userId: req.user?.sub ?? null,
        language,
        dateOrder: parseDateOrder(dateOrderRaw),
        decimalMark: parseDecimalMark(decimalMarkRaw),
      },
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.deleteSvc.bulkDelete(body.ids, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.deleteSvc.delete(id, { manager: req?.queryRunner?.manager, userId: req.user?.sub ?? null });
  }

  // Supplier ↔ Contact links
  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'reader')
  @Get(':id/contacts')
  listContacts(@Param('id') id: string, @Req() req: any) {
    return this.links.listForSupplier(id, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'member')
  @Post(':id/contacts')
  attachContact(
    @Param('id') id: string,
    @Body() body: { contactId: string; role: SupplierContactRole; isPrimary?: boolean },
    @Req() req: any,
  ) {
    return this.links.attach(
      id,
      { contactId: body.contactId, role: body.role, isPrimary: !!body.isPrimary },
      { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('suppliers', 'member')
  @Delete(':id/contacts/:linkId')
  detachContact(@Param('id') id: string, @Param('linkId') linkId: string, @Req() req: any) {
    return this.links.detach(id, linkId, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id, userId: req.user?.sub ?? null });
  }
}
