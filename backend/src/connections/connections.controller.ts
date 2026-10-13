import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ConnectionsService } from './services';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { ShareRateLimit } from '../notifications/share-rate-limit';

@UseGuards(JwtAuthGuard)
@Controller('connections')
export class ConnectionsController {
  constructor(
    private readonly svc: ConnectionsService,
    private readonly knowledge: KnowledgeService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.list(tenantId ?? '', query, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.listIds(tenantId ?? '', query, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('map')
  map(@Req() req: any, @Query() query: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.map(tenantId ?? '', query, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('by-server/:serverId')
  listByServer(@Param('serverId') serverId: string, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.listByServer(serverId, tenantId ?? '', { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/interface-links')
  listInterfaceLinks(@Param('id') id: string, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.listInterfaceLinks(id, tenantId ?? '', { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/interface-link-options')
  listInterfaceLinkOptions(@Param('id') id: string, @Query() query: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.listInterfaceLinkOptions(id, tenantId ?? '', query, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/interface-links')
  bulkLinkInterfaces(@Param('id') id: string, @Body() body: { binding_ids?: string[] }, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    const bindingIds = Array.isArray(body?.binding_ids) ? body.binding_ids : [];
    return this.svc.bulkLinkInterfaceBindings(id, tenantId ?? '', bindingIds, req?.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  // ---- Legs (per-leg CRUD) -------------------------------------------------

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/legs')
  listLegs(@Param('id') id: string, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.listLegs(id, tenantId ?? '', { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/legs')
  createLeg(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.createLeg(id, tenantId ?? '', body, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch(':id/legs/:legId')
  updateLeg(
    @Param('id') id: string,
    @Param('legId') legId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.updateLeg(id, legId, tenantId ?? '', body, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/legs/:legId')
  deleteLeg(@Param('id') id: string, @Param('legId') legId: string, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.deleteLeg(id, legId, tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/legs/:legId/swap')
  swapLegs(
    @Param('id') id: string,
    @Param('legId') legId: string,
    @Body() body: { swap_with_leg_id: string },
    @Req() req: any,
  ) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.reorderLegSwap(id, legId, body?.swap_with_leg_id, tenantId ?? '', req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  // ---- Knowledge ----------------------------------------------------------

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/knowledge-context')
  getKnowledgeContext(@Param('id') id: string, @Req() req: any) {
    return this.knowledge.getKnowledgeContextForEntity('connections', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/knowledge-documents')
  listKnowledgeDocuments(@Param('id') id: string, @Req() req: any) {
    return this.knowledge.listDocumentsForEntity('connections', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  // ---- Share --------------------------------------------------------------

  @ShareRateLimit()
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Post(':id/share')
  share(@Param('id') id: string, @Body() body: ShareItemDto, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.shareConnection(id, body, tenantId ?? '', req?.user?.sub ?? '', {
      manager: req?.queryRunner?.manager,
    });
  }

  // ---- Single connection ---------------------------------------------------

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any, @Query('include') include?: string | string[]) {
    const tenantId: string | undefined = req?.tenant?.id;
    const includeList = Array.isArray(include)
      ? include.map((v) => String(v || '')).join(',')
      : String(include || '');
    const includeLegs = includeList
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .includes('legs');
    return this.svc.get(id, tenantId ?? '', { manager: req?.queryRunner?.manager, includeLegs });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post()
  create(@Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.create(body, tenantId ?? '', req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.update(id, body, tenantId ?? '', req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    return this.svc.bulkDelete(ids, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.svc.delete(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }
}
