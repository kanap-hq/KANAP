import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { SpendVersionsService } from './spend-versions.service';
import { SpendAmountsService } from './spend-amounts.service';
import { SpendAllocationsService } from './spend-allocations.service';
import { resolveToUuid } from '../common/resolve-item-id';
import { EntityManager } from 'typeorm';

@UseGuards(JwtAuthGuard)
@Controller()
export class SpendVersionsController {
  constructor(
    private readonly versions: SpendVersionsService,
    private readonly amounts: SpendAmountsService,
    private readonly allocations: SpendAllocationsService,
  ) {}

  private resolveItemId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'spend', manager);
  }

  @Get('spend-items/:id/versions')
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  async listForItem(@Param('id') idOrRef: string, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.versions.listForItem(itemId, { manager });
  }

  @Post('spend-items/:id/versions')
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  async createForItem(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.versions.createForItem(itemId, body, req.user?.sub ?? null, { manager });
  }

  @Patch('spend-items/:id/versions')
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  async updateForItem(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const itemId = await this.resolveItemId(idOrRef, manager);
    return this.versions.updateForItem(itemId, body, req.user?.sub ?? null, { manager });
  }

  @Post('spend-versions/:id/amounts/bulk-upsert')
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  upsertAmounts(@Param('id') versionId: string, @Body() body: any, @Req() req: any) {
    return this.amounts.bulkUpsert(versionId, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Post('spend-versions/:id/allocations/bulk-upsert')
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  upsertAllocations(@Param('id') versionId: string, @Body() body: any, @Req() req: any) {
    const items = Array.isArray(body) ? body : body.items;
    return this.allocations.bulkUpsert(versionId, items, req.user?.sub ?? null, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
  }

  /**
   * Method, driver and rows of the version's allocation in one request, compared with
   * `base_signature` under the version's lock (plan planning/perf-scale lot 3E,
   * `spend/allocation-save.ts`). The method PATCH and the rows POST stay for other callers.
   */
  @Put('spend-versions/:id/allocations')
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  putAllocations(@Param('id') versionId: string, @Body() body: any, @Req() req: any) {
    return this.allocations.put(versionId, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
  }

  @Get('spend-versions/:id/allocations')
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  listAllocations(@Param('id') versionId: string, @Req() req: any) {
    return this.allocations.listForVersion(versionId, { manager: req?.queryRunner?.manager, tenantId: req.tenant.id });
  }

  @Get('spend-versions/:id/amounts')
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  listAmounts(@Param('id') versionId: string, @Query('year') year?: string, @Req() req?: any) {
    const y = year ? parseInt(String(year), 10) : undefined;
    return this.amounts.listByYear(versionId, y as any, { manager: req?.queryRunner?.manager });
  }
}
