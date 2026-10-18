import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { OperatingSystemService } from '../technologies/operating-system.service';
import { TechnologyLinksService, type LinkInput } from '../technologies/technology-links.service';
import { requireManager } from '../technologies/technology-rows';

/**
 * The technologies of an asset, from the asset's side (lot S): installed on it (removable) and
 * carried to it by the asset graph (with the asset they are installed on).
 */
@UseGuards(JwtAuthGuard)
@Controller('assets')
export class AssetTechnologiesController {
  constructor(
    private readonly links: TechnologyLinksService,
    private readonly operatingSystems: OperatingSystemService,
  ) {}

  private opts(ctx: TenantRequest) {
    return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/technologies')
  list(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.links.technologiesOfAsset(id, this.opts(ctx));
  }

  /**
   * Install a technology: `{ technology_id, technology_version_id? | version_label?, notes?, is_operating_system? }`.
   * `is_operating_system` marks the link as the server's operating system.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/technologies')
  async add(@Param('id') id: string, @Body() body: LinkInput & { technology_id?: string; is_operating_system?: boolean }, @Tenant() ctx: TenantRequest) {
    const opts = this.opts(ctx);
    const result = await this.links.addAssetLink(String(body?.technology_id ?? ''), id, body ?? {}, opts);
    if (body?.is_operating_system && result.link_id) {
      await this.operatingSystems.markLinkById(opts.manager, opts.tenantId, result.link_id, 'manual', opts.userId);
    }
    return result;
  }

  /** Mark a technology as the server's operating system, or clear it when `technology_id` is empty. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Put(':id/operating-system')
  setOperatingSystem(
    @Param('id') id: string,
    @Body() body: { technology_id?: string; technology_version_id?: string | null; version_label?: string | null },
    @Tenant() ctx: TenantRequest,
  ) {
    const opts = this.opts(ctx);
    return this.operatingSystems.setFromBody(opts.manager, opts.tenantId, id, body ?? {}, 'manual', opts.userId);
  }

  /** Remove the server's operating system. The marked link is deleted. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/operating-system')
  clearOperatingSystem(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    const opts = this.opts(ctx);
    return this.operatingSystems.setOperatingSystem(opts.manager, opts.tenantId, id, null, 'manual', opts.userId);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/technologies/:linkId')
  remove(@Param('id') id: string, @Param('linkId') linkId: string, @Tenant() ctx: TenantRequest) {
    return this.links.removeAssetLinkOfAsset(id, linkId, this.opts(ctx));
  }
}
