import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { TechnologyLinksService, type LinkInput } from '../technologies/technology-links.service';
import { requireManager } from '../technologies/technology-rows';

/**
 * The technologies of an asset, from the asset's side (lot S): installed on it (removable) and
 * carried to it by the asset graph (with the asset they are installed on).
 */
@UseGuards(JwtAuthGuard)
@Controller('assets')
export class AssetTechnologiesController {
  constructor(private readonly links: TechnologyLinksService) {}

  private opts(ctx: TenantRequest) {
    return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/technologies')
  list(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.links.technologiesOfAsset(id, this.opts(ctx));
  }

  /** Install a technology: `{ technology_id, technology_version_id? | version_label?, notes? }`. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/technologies')
  add(@Param('id') id: string, @Body() body: LinkInput & { technology_id?: string }, @Tenant() ctx: TenantRequest) {
    return this.links.addAssetLink(String(body?.technology_id ?? ''), id, body ?? {}, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/technologies/:linkId')
  remove(@Param('id') id: string, @Param('linkId') linkId: string, @Tenant() ctx: TenantRequest) {
    return this.links.removeAssetLinkOfAsset(id, linkId, this.opts(ctx));
  }
}
