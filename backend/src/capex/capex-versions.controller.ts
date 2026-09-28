import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { CapexVersionsService } from './capex-versions.service';
import { CapexAmountsService } from './capex-amounts.service';
import { CapexAllocationsService } from './capex-allocations.service';
import { resolveToUuid } from '../common/resolve-item-id';
import { EntityManager } from 'typeorm';

@UseGuards(JwtAuthGuard)
@Controller()
export class CapexVersionsController {
  constructor(
    private readonly versions: CapexVersionsService,
    private readonly amounts: CapexAmountsService,
    private readonly allocations: CapexAllocationsService,
  ) {}

  private resolveItemId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'capex', manager);
  }

  @Get('capex-items/:id/versions')
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  async listForItem(@Param('id') idOrRef: string, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.versions.listForItem(itemId, { manager });
  }

  @Post('capex-items/:id/versions')
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  async createForItem(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.versions.createForItem(itemId, body, req.user?.sub ?? null, { manager });
  }

  @Patch('capex-items/:id/versions')
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  async updateForItem(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.versions.updateForItem(itemId, body, req.user?.sub ?? null, { manager });
  }

  @Post('capex-versions/:id/amounts/bulk-upsert')
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  upsertAmounts(@Param('id') versionId: string, @Body() body: any, @Req() req: any) {
    return this.amounts.bulkUpsert(versionId, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Post('capex-versions/:id/allocations/bulk-upsert')
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  upsertAllocations(@Param('id') versionId: string, @Body() body: any, @Req() req: any) {
    const items = Array.isArray(body) ? body : body.items;
    return this.allocations.bulkUpsert(versionId, items, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Get('capex-versions/:id/allocations')
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  listAllocations(@Param('id') versionId: string, @Req() req: any) {
    return this.allocations.listForVersion(versionId, { manager: req?.queryRunner?.manager });
  }

  @Get('capex-versions/:id/amounts')
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  listAmounts(@Param('id') versionId: string, @Req() req: any, @Query('year') year?: string) {
    const y = year ? parseInt(String(year), 10) : undefined;
    return this.amounts.listByYear(versionId, y as any, { manager: req?.queryRunner?.manager });
  }
}
