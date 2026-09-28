import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ContractsService } from './contracts.service';
import { resolveToUuid } from '../common/resolve-item-id';
import { EntityManager } from 'typeorm';

@UseGuards(JwtAuthGuard)
@Controller('spend-items/:id/contracts')
export class SpendItemContractsController {
  constructor(private readonly svc: ContractsService) {}

  private resolveItemId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'spend', manager);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'reader')
  async list(@Param('id') idOrRef: string, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const spendItemId = await this.resolveItemId(idOrRef, manager);
    return this.svc.listContractsForSpendItem(spendItemId, { manager });
  }

  @Post('bulk-replace')
  @UseGuards(PermissionGuard)
  @RequireLevel('opex', 'member')
  async bulkReplace(@Param('id') idOrRef: string, @Body() body: { contract_ids: string[] }, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const spendItemId = await this.resolveItemId(idOrRef, manager);
    return this.svc.bulkReplaceContractsForSpendItem(spendItemId, body?.contract_ids ?? [], { manager });
  }
}
