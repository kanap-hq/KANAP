import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ContractRenewalService } from './contract-renewal.service';

type ReasonBody = { reason?: string | null };

/**
 * The renewal decision of a contract (`contract-renewal.service.ts`): read with the contract, decided
 * by those who edit contracts. One route per action, each in the request's transaction.
 */
@UseGuards(JwtAuthGuard)
@Controller('contracts')
export class ContractRenewalController {
  constructor(private readonly svc: ContractRenewalService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/renewal')
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/renew')
  renew(@Param('id') id: string, @Body() body: ReasonBody, @Req() req: any) {
    return this.svc.act(id, 'renew', body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/terminate')
  terminate(@Param('id') id: string, @Body() body: ReasonBody, @Req() req: any) {
    return this.svc.act(id, 'terminate', body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/renegotiate')
  renegotiate(@Param('id') id: string, @Body() body: ReasonBody, @Req() req: any) {
    return this.svc.act(id, 'renegotiate', body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  /** A contract already renewed ends with its current term (the renewal field's "no" on the contract page). */
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/stop')
  stop(@Param('id') id: string, @Req() req: any) {
    return this.svc.stopRenewal(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/undo')
  undo(@Param('id') id: string, @Body() body: ReasonBody, @Req() req: any) {
    return this.svc.act(id, 'undo', body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }
}
