import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ContractRenewalService, type ContractRenewalView } from './contract-renewal.service';
import { contractRelationsAccess } from './contract-relations';
import { idsInScope } from '../portfolio/portfolio-linked-reads';

type ReasonBody = { reason?: string | null };
/** A termination's end (`YYYY-MM-DD`); absent, the proposed one. */
type EndBody = { reason?: string | null; end_date?: string | null };

/**
 * The renewal decision of a contract (`contract-renewal.service.ts`): read with the contract, decided
 * by those who edit contracts. One route per action, each in the request's transaction. Every answer
 * names, in what a termination changes, only the applications and assets the caller reads
 * (`followRights`).
 */
@UseGuards(JwtAuthGuard)
@Controller('contracts')
export class ContractRenewalController {
  constructor(private readonly svc: ContractRenewalService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get(':id/renewal')
  async get(@Param('id') id: string, @Query('end_date') endDate: string | undefined, @Req() req: any) {
    return this.followRights(await this.svc.get(id, { manager: req?.queryRunner?.manager, endDate }), req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/renew')
  async renew(@Param('id') id: string, @Body() body: ReasonBody, @Req() req: any) {
    return this.followRights(await this.svc.act(id, 'renew', body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }), req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/terminate')
  async terminate(@Param('id') id: string, @Body() body: EndBody, @Req() req: any) {
    return this.followRights(await this.svc.act(id, 'terminate', body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }), req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/renegotiate')
  async renegotiate(@Param('id') id: string, @Body() body: ReasonBody, @Req() req: any) {
    return this.followRights(await this.svc.act(id, 'renegotiate', body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }), req);
  }

  /** The renewal field's "no" on a contract already renewed or awaiting a decision: renewal off, it ends on `end_date` (the proposed end by default). */
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/stop')
  async stop(@Param('id') id: string, @Body() body: EndBody, @Req() req: any) {
    return this.followRights(await this.svc.stopRenewal(id, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }), req);
  }

  /** A contract without renewal whose end is within the window: let it end (lot CR2, round 2). */
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/end')
  async end(@Param('id') id: string, @Body() body: ReasonBody, @Req() req: any) {
    return this.followRights(await this.svc.act(id, 'end', body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }), req);
  }

  /** The renewal field's "yes" on a contract without renewal that has an end of validity: renewal on, the end removed. */
  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/resume')
  async resume(@Param('id') id: string, @Req() req: any) {
    return this.followRights(await this.svc.resumeRenewal(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }), req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'member')
  @Post(':id/renewal/undo')
  async undo(@Param('id') id: string, @Body() body: ReasonBody, @Req() req: any) {
    return this.followRights(await this.svc.act(id, 'undo', body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }), req);
  }

  /**
   * What a termination changes names a linked record only to a reader of its module, as the
   * Relations tab: the applications for a reader of the applications (a Business Contributor's:
   * those they take part in), the assets for a reader of the infrastructure. The others are left
   * out, with no counter.
   */
  private async followRights(view: ContractRenewalView, req: any): Promise<ContractRenewalView> {
    if (!view.impact) return view;
    const access = await contractRelationsAccess(req);
    const applications = access.applications
      ? await idsInScope(req?.queryRunner?.manager, 'applications', view.impact.applications.map((row) => row.id), access.applicationScope)
      : new Set<string>();
    return {
      ...view,
      impact: {
        ...view.impact,
        applications: view.impact.applications.filter((row) => applications.has(row.id)),
        assets: access.infrastructure ? view.impact.assets : [],
      },
    };
  }
}
