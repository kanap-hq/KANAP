import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ContractsService } from './contracts.service';
import { resolveToUuid } from '../common/resolve-item-id';
import { EntityManager } from 'typeorm';

@UseGuards(JwtAuthGuard)
@Controller('capex-items/:id/contracts')
export class CapexItemContractsController {
  constructor(private readonly svc: ContractsService) {}

  private resolveItemId(id: string, manager: EntityManager): Promise<string> {
    return resolveToUuid(id, 'capex', manager);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'reader')
  async list(@Param('id') idOrRef: string, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const capexItemId = await this.resolveItemId(idOrRef, manager);
    return this.svc.listContractsForCapexItem(capexItemId, { manager });
  }

  @Post('bulk-replace')
  @UseGuards(PermissionGuard)
  @RequireLevel('capex', 'member')
  async bulkReplace(@Param('id') idOrRef: string, @Body() body: { contract_ids: string[] }, @Req() req: any) {
    const manager = req?.queryRunner?.manager as EntityManager;
    const capexItemId = await this.resolveItemId(idOrRef, manager);
    return this.svc.bulkReplaceContractsForCapexItem(capexItemId, body?.contract_ids ?? [], { manager });
  }
}

