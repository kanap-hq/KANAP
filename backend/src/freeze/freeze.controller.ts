import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { FreezeService, FreezeTarget } from './freeze.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { ALL_KEY } from './freeze.service';
import { assertCanManageMasterDataScope, MasterDataAccess } from '../master-data/master-data-access.util';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

const MANAGE_FREEZE_REQUIREMENTS = [
  { resource: 'budget_ops', level: 'admin' as const },
  { resource: 'companies', level: 'admin' as const },
  { resource: 'departments', level: 'admin' as const },
];

// Master data administrators may only (un)freeze their own scopes; OPEX/CAPEX stay budget-only.
function assertCanManageTargets(targets: FreezeTarget[], req: any) {
  const access: MasterDataAccess = { isAdmin: req?.isAdmin, permissions: req?.permissions };
  for (const target of targets) {
    const scope = String(target?.scope ?? '').toLowerCase();
    if (scope === 'companies' || scope === 'departments') {
      assertCanManageMasterDataScope(access, scope, `change the ${scope} freeze`);
    } else if (!access.isAdmin && access.permissions?.budget_ops !== 'admin') {
      throw new ForbiddenException('You need Budget administration admin permissions to change this freeze');
    }
  }
}

@UseGuards(JwtAuthGuard)
@Controller('freeze-states')
export class FreezeController {
  constructor(private readonly freeze: FreezeService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequireAnyLevel([
    { resource: 'budget_ops', level: 'reader' },
    { resource: 'companies', level: 'reader' },
    { resource: 'departments', level: 'reader' },
  ])
  async list(@Query('year') yearRaw: string, @Req() req: any) {
    const parsed = Number(yearRaw ?? new Date().getFullYear());
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException('Invalid year');
    }
    const year = Math.trunc(parsed);
    const entries = await this.freeze.getYearState(year, { manager: req?.queryRunner?.manager });
    return {
      year,
      entries: entries.map((entry) => ({
        id: entry.id,
        scope: entry.scope,
        column: entry.columnKey === ALL_KEY ? null : entry.columnKey,
        isFrozen: entry.is_frozen,
        frozenAt: entry.frozen_at,
        frozenBy: entry.frozen_by,
        unfrozenAt: entry.unfrozen_at,
        unfrozenBy: entry.unfrozen_by,
      })),
      summary: this.freeze.summarize(year, entries),
    };
  }

  private normalizeTargets(raw: any): FreezeTarget[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
      const scope = item?.scope;
      const columns = Array.isArray(item?.columns)
        ? item.columns.map((c: any) => (typeof c === 'string' ? c.toLowerCase() : c))
        : undefined;
      return { scope, columns } as FreezeTarget;
    });
  }

  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('freeze')
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(MANAGE_FREEZE_REQUIREMENTS)
  async freezeAction(@Body() body: any, @Req() req: any) {
    const year = Number(body?.year);
    const targets = this.normalizeTargets(body?.scopes);
    assertCanManageTargets(targets, req);
    const entries = await this.freeze.freeze(year, targets, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
    return {
      year,
      entries: entries.map((entry) => ({
        id: entry.id,
        scope: entry.scope,
        column: entry.columnKey === ALL_KEY ? null : entry.columnKey,
        isFrozen: entry.is_frozen,
        frozenAt: entry.frozen_at,
        frozenBy: entry.frozen_by,
        unfrozenAt: entry.unfrozen_at,
        unfrozenBy: entry.unfrozen_by,
      })),
      summary: this.freeze.summarize(year, entries),
    };
  }

  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('unfreeze')
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(MANAGE_FREEZE_REQUIREMENTS)
  async unfreezeAction(@Body() body: any, @Req() req: any) {
    const year = Number(body?.year);
    const targets = this.normalizeTargets(body?.scopes);
    assertCanManageTargets(targets, req);
    const entries = await this.freeze.unfreeze(year, targets, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
    return {
      year,
      entries: entries.map((entry) => ({
        id: entry.id,
        scope: entry.scope,
        column: entry.columnKey === ALL_KEY ? null : entry.columnKey,
        isFrozen: entry.is_frozen,
        frozenAt: entry.frozen_at,
        frozenBy: entry.frozen_by,
        unfrozenAt: entry.unfrozen_at,
        unfrozenBy: entry.unfrozen_by,
      })),
      summary: this.freeze.summarize(year, entries),
    };
  }
}
