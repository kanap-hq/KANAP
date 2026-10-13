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
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { LocationsService } from './locations.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { ShareRateLimit } from '../notifications/share-rate-limit';

@UseGuards(JwtAuthGuard)
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly svc: LocationsService,
    private readonly knowledge: KnowledgeService,
  ) {}

  private requireTenantId(req: any): string {
    const tenantId: string | undefined = req?.tenant?.id;
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required');
    }
    return tenantId;
  }

  private parseInclude(raw: string | string[] | undefined): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw;
    }
    return String(raw)
      .split(',')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get()
  list(@Query() query: any, @Req() req: any) {
    return this.svc.list(query, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get('ids')
  listIds(@Query() query: any, @Req() req: any) {
    return this.svc.listIds(query, { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Query('include') include: string | string[], @Req() req: any) {
    return this.svc.get(id, {
      manager: req?.queryRunner?.manager,
      tenantId: req?.tenant?.id,
      include: this.parseInclude(include),
    });
  }

  @ShareRateLimit()
  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Post(':id/share')
  share(@Param('id') id: string, @Body() body: ShareItemDto, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    return this.svc.shareLocation(id, body, tenantId, req?.user?.sub ?? '', {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Post()
  create(@Body() body: any, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    return this.svc.create(body, tenantId, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    return this.svc.update(id, body, tenantId, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.svc.delete(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // Internal contacts
  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get(':id/internal-contacts')
  listInternalContacts(@Param('id') id: string, @Req() req: any) {
    return this.svc.listInternalContacts(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Post(':id/internal-contacts')
  addInternalContact(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    return this.svc.addInternalContact(id, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Patch(':id/internal-contacts/:contactId')
  updateInternalContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const tenantId = this.requireTenantId(req);
    return this.svc.updateInternalContact(id, contactId, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Delete(':id/internal-contacts/:contactId')
  deleteInternalContact(@Param('id') id: string, @Param('contactId') contactId: string, @Req() req: any) {
    return this.svc.removeInternalContact(id, contactId, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // External contacts
  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get(':id/external-contacts')
  listExternalContacts(@Param('id') id: string, @Req() req: any) {
    return this.svc.listExternalContacts(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Post(':id/external-contacts')
  addExternalContact(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    return this.svc.addExternalContact(id, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Patch(':id/external-contacts/:linkId')
  updateExternalContact(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const tenantId = this.requireTenantId(req);
    return this.svc.updateExternalContact(id, linkId, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Delete(':id/external-contacts/:linkId')
  deleteExternalContact(@Param('id') id: string, @Param('linkId') linkId: string, @Req() req: any) {
    return this.svc.removeExternalContact(id, linkId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  // Links
  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get(':id/links')
  listLinks(@Param('id') id: string, @Req() req: any) {
    return this.svc.listLinks(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Post(':id/links')
  addLink(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.createLink(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Patch(':id/links/:linkId')
  updateLink(@Param('id') id: string, @Param('linkId') linkId: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateLink(id, linkId, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Delete(':id/links/:linkId')
  deleteLink(@Param('id') id: string, @Param('linkId') linkId: string, @Req() req: any) {
    return this.svc.deleteLink(id, linkId, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // Sub-items (reorder MUST be declared before :subItemId to avoid param capture)
  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Patch(':id/sub-items/reorder')
  reorderSubItems(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    return this.svc.reorderSubItems(id, body?.ordered_ids, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get(':id/sub-items')
  listSubItems(@Param('id') id: string, @Req() req: any) {
    return this.svc.listSubItems(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Post(':id/sub-items')
  createSubItem(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    return this.svc.createSubItem(id, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Patch(':id/sub-items/:subItemId')
  updateSubItem(
    @Param('id') id: string,
    @Param('subItemId') subItemId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const tenantId = this.requireTenantId(req);
    return this.svc.updateSubItem(id, subItemId, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'member')
  @Delete(':id/sub-items/:subItemId')
  deleteSubItem(@Param('id') id: string, @Param('subItemId') subItemId: string, @Req() req: any) {
    return this.svc.deleteSubItem(id, subItemId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  // Relations (endpoint kept as /servers for backwards compatibility)
  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get(':id/servers')
  listServers(@Param('id') id: string, @Req() req: any) {
    return this.svc.listAssets(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get(':id/applications')
  listApplications(@Param('id') id: string, @Req() req: any) {
    return this.svc.listApplications(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get(':id/knowledge-context')
  getKnowledgeContext(@Param('id') id: string, @Req() req: any) {
    return this.knowledge.getKnowledgeContextForEntity('locations', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('locations', 'reader')
  @Get(':id/knowledge-documents')
  listKnowledgeDocuments(@Param('id') id: string, @Req() req: any) {
    return this.knowledge.listDocumentsForEntity('locations', id, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }
}
