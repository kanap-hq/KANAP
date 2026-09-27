import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { FreezeScope, FreezeState } from './freeze-state.entity';
import { FxIngestionService } from '../currency/fx-ingestion.service';
import { FxRateService } from '../currency/fx-rate.service';
import { CurrencySettingsService } from '../currency/currency-settings.service';
import { SpendVersion } from '../spend/spend-version.entity';
import { CapexVersion } from '../capex/capex-version.entity';
import { AmountMeasure, AMOUNT_MEASURES, MEASURE_FREEZE_COLUMN } from '../spend/amounts-write.util';
import { budgetColumnName, readBudgetColumns } from '../budget-columns/budget-columns.util';

export type FreezeColumn = 'budget' | 'revision' | 'forecast' | 'actual' | 'landing';
export type FreezeTarget = { scope: FreezeScope; columns?: FreezeColumn[] };

const COLUMN_MAP: Record<FreezeColumn, FreezeColumn> = {
  budget: 'budget',
  revision: 'revision',
  forecast: 'forecast',
  actual: 'actual',
  landing: 'landing',
};

const FREEZE_COLUMN_MEASURE = Object.fromEntries(
  AMOUNT_MEASURES.map((measure) => [MEASURE_FREEZE_COLUMN[measure], measure]),
) as Record<FreezeColumn, AmountMeasure>;

export const ALL_KEY = '__all__';

function isColumn(value: any): value is FreezeColumn {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COLUMN_MAP, value);
}

@Injectable()
export class FreezeService {
  constructor(
    @InjectRepository(FreezeState)
    private readonly repo: Repository<FreezeState>,
    private readonly fxIngestion: FxIngestionService,
    private readonly fxRates: FxRateService,
    private readonly currencySettings: CurrencySettingsService,
  ) {}

  private manager(opts?: { manager?: EntityManager }) {
    return (opts?.manager ?? this.repo.manager);
  }

  private normalizeScope(raw: string): FreezeScope {
    const val = (raw || '').toLowerCase();
    if (val === 'opex' || val === 'capex' || val === 'companies' || val === 'departments') return val;
    throw new BadRequestException(`Unsupported scope '${raw}'`);
  }

  private normalizeColumn(scope: FreezeScope, column?: FreezeColumn | string | null): string {
    if (scope === 'companies' || scope === 'departments') {
      return ALL_KEY;
    }
    if (!column) {
      throw new BadRequestException(`Columns are required for scope '${scope}'`);
    }
    const normalized = (column || '').toLowerCase();
    if (!isColumn(normalized)) {
      throw new BadRequestException(`Unsupported column '${column}' for scope '${scope}'`);
    }
    return COLUMN_MAP[normalized];
  }

  private async currentTenantId(manager: EntityManager): Promise<string | null> {
    const result = await manager.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
    const tenantId = Array.isArray(result) && result.length > 0 ? result[0]?.tenant_id : null;
    return tenantId && typeof tenantId === 'string' && tenantId.length ? tenantId : null;
  }

  /** Every freeze_states query names the tenant, besides RLS. */
  private async requireTenantId(manager: EntityManager): Promise<string> {
    const tenantId = await this.currentTenantId(manager);
    if (!tenantId) throw new InternalServerErrorException('Freezes need a tenant context.');
    return tenantId;
  }

  /** The column whose freeze pins the year's exchange rates: the tenant's default column. */
  private async fxPinColumn(manager: EntityManager, tenantId: string): Promise<FreezeColumn> {
    const settings = await readBudgetColumns(manager, tenantId);
    return MEASURE_FREEZE_COLUMN[settings.default_column];
  }

  private async attachFxRates(scope: 'opex' | 'capex', year: number, tenantId: string, manager: EntityManager) {
    await this.fxIngestion.refreshTenant(tenantId, year, { manual: true, manager });
    const settings = await this.currencySettings.getSettings(tenantId, { manager });
    const rateSet = await this.fxRates.getLatestRateSet(tenantId, year, settings.reportingCurrency, { manager });
    if (!rateSet) return;

    const repo = manager.getRepository(scope === 'opex' ? SpendVersion : CapexVersion);
    await repo.createQueryBuilder()
      .update()
      .set({
        fx_rate_set_id: rateSet.id,
        reporting_currency: settings.reportingCurrency,
      })
      .where('tenant_id = :tenantId AND budget_year = :year', { tenantId, year })
      .execute();
  }

  private async detachFxRates(scope: 'opex' | 'capex', year: number, tenantId: string, manager: EntityManager) {
    const repo = manager.getRepository(scope === 'opex' ? SpendVersion : CapexVersion);
    await repo.createQueryBuilder()
      .update()
      .set({ fx_rate_set_id: null })
      .where('tenant_id = :tenantId AND budget_year = :year', { tenantId, year })
      .execute();
  }

  async freeze(year: number, targets: FreezeTarget[], userId?: string | null, opts?: { manager?: EntityManager }) {
    if (!Number.isInteger(year)) throw new BadRequestException('Year is required');
    if (!Array.isArray(targets) || targets.length === 0) throw new BadRequestException('No targets provided');
    const mg = this.manager(opts);
    const repo = mg.getRepository(FreezeState);

    const toProcess: Array<{ scope: FreezeScope; columnKey: string }> = [];
    const tenantId = await this.requireTenantId(mg);
    const pinColumn = await this.fxPinColumn(mg, tenantId);
    let pinOpex = false;
    let pinCapex = false;

    for (const target of targets) {
      const scope = this.normalizeScope(target.scope);
      if (scope === 'opex' || scope === 'capex') {
        const cols = Array.from(new Set(target.columns || Object.keys(COLUMN_MAP))) as FreezeColumn[];
        if (cols.length === 0) {
          throw new BadRequestException(`Columns are required for scope '${scope}'`);
        }
        for (const col of cols) {
          const columnKey = this.normalizeColumn(scope, col);
          if (scope === 'opex' && columnKey === pinColumn) pinOpex = true;
          if (scope === 'capex' && columnKey === pinColumn) pinCapex = true;
          toProcess.push({ scope, columnKey });
        }
      } else {
        toProcess.push({ scope, columnKey: this.normalizeColumn(scope) });
      }
    }

    const now = new Date();
    for (const item of toProcess) {
      let state = await repo.findOne({ where: { tenant_id: tenantId, budget_year: year, scope: item.scope, columnKey: item.columnKey } as any });
      if (!state) {
        state = repo.create({
          tenant_id: tenantId,
          budget_year: year,
          scope: item.scope,
          columnKey: item.columnKey,
        });
      }
      state.is_frozen = true;
      state.frozen_at = now;
      state.frozen_by = userId ?? null;
      state.unfrozen_at = null;
      state.unfrozen_by = null;
      await repo.save(state);
    }

    if (pinOpex) {
      await this.attachFxRates('opex', year, tenantId, mg);
    }
    if (pinCapex) {
      await this.attachFxRates('capex', year, tenantId, mg);
    }

    return this.getYearState(year, opts);
  }

  async unfreeze(year: number, targets: FreezeTarget[], userId?: string | null, opts?: { manager?: EntityManager }) {
    if (!Number.isInteger(year)) throw new BadRequestException('Year is required');
    if (!Array.isArray(targets) || targets.length === 0) throw new BadRequestException('No targets provided');
    const mg = this.manager(opts);
    const repo = mg.getRepository(FreezeState);

    const toProcess: Array<{ scope: FreezeScope; columnKey: string }> = [];
    const tenantId = await this.requireTenantId(mg);
    const pinColumn = await this.fxPinColumn(mg, tenantId);
    let unpinOpex = false;
    let unpinCapex = false;

    for (const target of targets) {
      const scope = this.normalizeScope(target.scope);
      if (scope === 'opex' || scope === 'capex') {
        const cols = Array.from(new Set(target.columns || Object.keys(COLUMN_MAP))) as FreezeColumn[];
        if (cols.length === 0) {
          throw new BadRequestException(`Columns are required for scope '${scope}'`);
        }
        for (const col of cols) {
          const columnKey = this.normalizeColumn(scope, col);
          if (scope === 'opex' && columnKey === pinColumn) unpinOpex = true;
          if (scope === 'capex' && columnKey === pinColumn) unpinCapex = true;
          toProcess.push({ scope, columnKey });
        }
      } else {
        toProcess.push({ scope, columnKey: this.normalizeColumn(scope) });
      }
    }

    const now = new Date();
    for (const item of toProcess) {
      await repo.update({ tenant_id: tenantId, budget_year: year, scope: item.scope, columnKey: item.columnKey } as any, {
        is_frozen: false,
        unfrozen_at: now,
        unfrozen_by: userId ?? null,
      });
    }

    if (unpinOpex) {
      await this.detachFxRates('opex', year, tenantId, mg);
    }
    if (unpinCapex) {
      await this.detachFxRates('capex', year, tenantId, mg);
    }

    return this.getYearState(year, opts);
  }

  async getYearState(year: number, opts?: { manager?: EntityManager }) {
    const mg = this.manager(opts);
    const repo = mg.getRepository(FreezeState);
    const entries = await repo.find({ where: { tenant_id: await this.requireTenantId(mg), budget_year: year } as any });
    return entries;
  }

  async isFrozen(params: { scope: FreezeScope; column?: FreezeColumn | null; year: number }, opts?: { manager?: EntityManager }) {
    const { scope, column, year } = params;
    if (!Number.isInteger(year)) throw new BadRequestException('year is required');
    const columnKey = this.normalizeColumn(scope, column ?? undefined);
    const mg = this.manager(opts);
    const repo = mg.getRepository(FreezeState);
    const found = await repo.findOne({
      where: {
        tenant_id: await this.requireTenantId(mg),
        budget_year: year,
        scope,
        columnKey,
        is_frozen: true,
      } as any,
    });
    return !!found;
  }

  async assertNotFrozen(params: { scope: FreezeScope; column?: FreezeColumn | null; year: number; action?: string }, opts?: { manager?: EntityManager }) {
    const frozen = await this.isFrozen(params, opts);
    if (frozen) {
      const column = String(params.column ?? '').toLowerCase();
      const columnLabel = isColumn(column) ? await this.columnName(column, this.manager(opts)) : 'data';
      const what = `${params.scope.toUpperCase()} ${columnLabel} for ${params.year} is frozen`;
      throw new ForbiddenException(params.action ? `${params.action} not allowed: ${what}` : what);
    }
  }

  /** The tenant's name for a column. */
  private async columnName(column: FreezeColumn, manager: EntityManager): Promise<string> {
    const settings = await readBudgetColumns(manager, await this.requireTenantId(manager));
    return budgetColumnName(settings, FREEZE_COLUMN_MEASURE[column]);
  }

  summarize(year: number, entries: FreezeState[]) {
    const summary = {
      year,
      scopes: {
        opex: {
          budget: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
          revision: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
          forecast: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
          actual: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
          landing: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
        },
        capex: {
          budget: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
          revision: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
          forecast: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
          actual: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
          landing: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
        },
        companies: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
        departments: { frozen: false, frozenAt: null as Date | null, frozenBy: null as string | null },
      },
    };

    const apply = (slot: { frozen: boolean; frozenAt: Date | null; frozenBy: string | null }, entry: FreezeState) => {
      slot.frozen = true;
      slot.frozenAt = entry.frozen_at ?? null;
      slot.frozenBy = entry.frozen_by ?? null;
    };

    for (const entry of entries) {
      if (!entry.is_frozen) continue;
      if (entry.scope === 'opex' || entry.scope === 'capex') {
        const key = entry.columnKey as FreezeColumn;
        if (isColumn(key)) {
          apply(summary.scopes[entry.scope][key], entry);
        }
      } else if (entry.scope === 'companies') {
        apply(summary.scopes.companies, entry);
      } else if (entry.scope === 'departments') {
        apply(summary.scopes.departments, entry);
      }
    }

    return summary;
  }
}
