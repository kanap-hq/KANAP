import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ConnectionsService } from './services';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { ShareRateLimit } from '../notifications/share-rate-limit';
import { assertCreationToken, cancelCreation, creationContextOf, readCreationChanges, withCreationToken } from '../common/creation/creation-routes';
import { withChildCount, type CreationChanges } from '../common/creation/creation-changes';
import { creationIncomplete } from '../common/creation/creation-incomplete';
import { CONNECTION_FIELD_NAMES, missingConnectionFields, type ConnectionCompleteness } from './connection-creation';
import type { EntityManager } from 'typeorm';

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

  /**
   * The screen creates a connection at its title: server to server, without protocol nor end, which
   * "Create" checks (`POST :id/creation/complete`). Hands the creator a creation token
   * (`common/creation`) for "Create" and "Cancel" (`DELETE :id/creation`), on this connection and for
   * this person only. `POST /connections` keeps the full rules.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post('creation')
  async createAtTitle(@Body() body: { name?: unknown }, @Req() req: any) {
    const tenantId: string = req?.tenant?.id ?? '';
    const userId: string = req.user?.sub ?? '';
    const manager = req?.queryRunner?.manager;
    const { absorbed: _absorbed, ...created } = await this.svc.createAtTitle(body?.name, tenantId, userId || null, { manager });
    // The database gives the reference on insert, after the row is built: the page opens the connection under it.
    const [row]: Array<{ connection_reference: string }> = await manager.query(
      'SELECT connection_reference FROM connections WHERE id = $1 AND tenant_id = $2',
      [created.id, tenantId],
    );
    return withCreationToken('connections', { ...created, connection_reference: row?.connection_reference ?? created.connection_reference }, { tenantId, userId });
  }

  /** Before "Cancel": what was written on the connection since its creation, its protocols counted. Nothing is written. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Get(':id/creation')
  creationChanges(@Param('id') id: string, @Query('token') token: string, @Req() req: any): Promise<{ changes: CreationChanges }> {
    const ctx = creationContextOf(req);
    return readCreationChanges('connections', id, token, ctx, {
      // Protocols have no history of their own: what the connection holds is what would go.
      extra: async (changes, manager) => {
        const [{ total }] = await manager.query(
          'SELECT count(*)::int AS total FROM connection_protocols WHERE tenant_id = $1 AND connection_id = $2',
          [ctx.tenantId, id],
        );
        return withChildCount(changes, 'protocol', total);
      },
    });
  }

  /**
   * "Create" of a connection being created: 400 `CREATION_INCOMPLETE` while it lacks a protocol or
   * an end (`params.fields`: `protocols`, `source`, `destination`, `servers`).
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/creation/complete')
  @HttpCode(200)
  async completeCreation(@Param('id') id: string, @Body() body: { token?: string }, @Req() req: any): Promise<{ ok: true }> {
    const ctx = creationContextOf(req);
    assertCreationToken('connections', id, body?.token, ctx);
    const [row]: Array<Omit<ConnectionCompleteness, 'protocolCount' | 'serverCount'> & { protocol_count: number; server_count: number }> = await (ctx.manager as EntityManager).query(
      `SELECT c.topology, c.source_asset_id, c.source_entity_code, c.destination_asset_id, c.destination_entity_code,
              (SELECT count(*)::int FROM connection_protocols p WHERE p.tenant_id = c.tenant_id AND p.connection_id = c.id) AS protocol_count,
              (SELECT count(*)::int FROM connection_servers s WHERE s.tenant_id = c.tenant_id AND s.connection_id = c.id) AS server_count
         FROM connections c
        WHERE c.id = $1 AND c.tenant_id = $2`,
      [id, ctx.tenantId],
    );
    if (!row) throw new NotFoundException('Connection not found');
    const missing = missingConnectionFields({ ...row, protocolCount: row.protocol_count, serverCount: row.server_count });
    if (missing.length > 0) throw creationIncomplete(missing, missing.map((field) => CONNECTION_FIELD_NAMES[field]));
    return { ok: true };
  }

  /**
   * "Cancel" of a connection being created: its creator deletes it with its token while nobody else
   * has written on it (403 `CREATION_CANCEL_EXPIRED` otherwise, checked under its lock). Same delete
   * as `DELETE :id`.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/creation')
  cancelCreation(@Param('id') id: string, @Body() body: { token?: string }, @Req() req: any): Promise<void> {
    const ctx = creationContextOf(req);
    return cancelCreation('connections', id, body?.token, ctx, (manager) => this.svc.delete(id, ctx.userId || null, { manager }));
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
