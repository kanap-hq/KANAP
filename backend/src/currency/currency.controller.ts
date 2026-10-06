import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel, RequireAnyLevelMeta } from '../auth/require-level.decorator';
import { CurrencySettingsService } from './currency-settings.service';
import { FxIngestionService } from './fx-ingestion.service';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CurrencyRateSet } from './currency-rate-set.entity';

// Currencies are a budget setting: every budget reader sees them (the OPEX and
// CAPEX forms read the default and allowed currencies of their currency picker),
// budget administrators change them.
const CURRENCY_READERS: RequireAnyLevelMeta = [
  { resource: 'budget_ops', level: 'reader' },
  { resource: 'opex', level: 'reader' },
  { resource: 'capex', level: 'reader' },
];

@UseGuards(JwtAuthGuard)
@Controller('currency')
export class CurrencyController {
  constructor(
    private readonly settings: CurrencySettingsService,
    private readonly fxIngestion: FxIngestionService,
    @InjectRepository(CurrencyRateSet)
    private readonly rateSets: Repository<CurrencyRateSet>,
  ) {}

  private requireTenantId(req: any): string {
    const tenantId: string | undefined = req?.tenant?.id;
    if (!tenantId) {
      throw new Error('Tenant context is required for currency settings');
    }
    return tenantId;
  }

  @Get('settings')
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(CURRENCY_READERS)
  async getSettings(@Req() req: any) {
    const tenantId = this.requireTenantId(req);
    return this.settings.getSettings(tenantId, { manager: req?.queryRunner?.manager });
  }

  @Patch('settings')
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  async updateSettings(@Body() body: any, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    const payload: any = {};

    if (body.reportingCurrency) payload.reportingCurrency = String(body.reportingCurrency).trim().toUpperCase();
    if (body.defaultSpendCurrency) payload.defaultSpendCurrency = String(body.defaultSpendCurrency).trim().toUpperCase();
    if (body.defaultCapexCurrency) payload.defaultCapexCurrency = String(body.defaultCapexCurrency).trim().toUpperCase();
    if (Array.isArray(body.allowedCurrencies)) {
      payload.allowedCurrencies = body.allowedCurrencies.map((code: any) => String(code || '').trim().toUpperCase()).filter((code: string) => code.length === 3);
    }

    const next = await this.settings.updateSettings(tenantId, payload, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
    await this.fxIngestion.refreshTenant(tenantId, new Date().getFullYear(), {
      manual: true,
      manager: req?.queryRunner?.manager,
    });
    return next;
  }

  @Get('rates')
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(CURRENCY_READERS)
  async listRates(@Req() req: any) {
    const tenantId = this.requireTenantId(req);
    const entityManager = req?.queryRunner?.manager ?? this.rateSets.manager;
    await this.ensureTenantContext(entityManager, tenantId);
    const repo = entityManager.getRepository(CurrencyRateSet);
    const rows = await repo.find({
      where: { tenant_id: tenantId },
      order: { fiscal_year: 'ASC' as any, captured_at: 'DESC' as any },
    });

    const latestByYear = new Map<number, CurrencyRateSet>();
    for (const row of rows) {
      const year = row.fiscal_year;
      if (!latestByYear.has(year)) {
        latestByYear.set(year, row);
      }
    }

    return Array.from(latestByYear.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, row]) => ({
        fiscalYear: year,
        baseCurrency: row.base_currency,
        rates: row.rates,
        capturedAt: row.captured_at,
        source: row.source,
      }));
  }

  @Post('rates/refresh')
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  async refreshRates(@Body() body: { years?: number[]; year?: number } | undefined, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    const requested = Array.isArray(body?.years) && body?.years.length
      ? body?.years
      : body?.year != null
        ? [body.year]
        : undefined;
    const entityManager = req?.queryRunner?.manager ?? this.rateSets.manager;
    const years = await this.resolveSyncYears(tenantId, requested, entityManager);
    const status = await this.fxIngestion.queueManualRefresh(tenantId, years, { label: 'manual-api' });
    return {
      ok: true,
      queued: status === 'queued',
      alreadyQueued: status === 'skipped',
      years,
    };
  }

  private async ensureTenantContext(manager: EntityManager, tenantId: string): Promise<void> {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  }

  private parseYearRow(row: any): number | null {
    if (!row) return null;
    const value = row.year ?? row.YEAR ?? null;
    if (value == null) return null;
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.trunc(num);
  }

  private extractYearList(rows: any[] | null | undefined): number[] {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const years: number[] = [];
    rows.forEach((row) => {
      const year = this.parseYearRow(row);
      if (year != null) years.push(year);
    });
    return years;
  }

  private async findBudgetYears(manager: EntityManager): Promise<number[]> {
    const spendRows = await manager.query(`
      SELECT DISTINCT CAST(EXTRACT(YEAR FROM period) AS integer) AS year
      FROM spend_amounts
      WHERE COALESCE(planned, 0) <> 0
         OR COALESCE(forecast, 0) <> 0
         OR COALESCE(committed, 0) <> 0
         OR COALESCE(actual, 0) <> 0
         OR COALESCE(expected_landing, 0) <> 0
    `);
    const capexRows = await manager.query(`
      SELECT DISTINCT CAST(EXTRACT(YEAR FROM period) AS integer) AS year
      FROM capex_amounts
      WHERE COALESCE(planned, 0) <> 0
         OR COALESCE(forecast, 0) <> 0
         OR COALESCE(committed, 0) <> 0
         OR COALESCE(actual, 0) <> 0
         OR COALESCE(expected_landing, 0) <> 0
    `);

    const years = new Set<number>();
    this.extractYearList(spendRows).forEach((year) => years.add(year));
    this.extractYearList(capexRows).forEach((year) => years.add(year));
    return Array.from(years.values());
  }

  private async resolveSyncYears(tenantId: string, requested: number[] | undefined, manager: EntityManager): Promise<number[]> {
    await this.ensureTenantContext(manager, tenantId);

    const yearsSet = new Set<number>();
    if (requested && requested.length) {
      requested.forEach((year) => {
        const num = Number(year);
        if (Number.isFinite(num)) yearsSet.add(Math.trunc(num));
      });
    } else {
      const currentYear = new Date().getFullYear();
      yearsSet.add(currentYear);
    }

    const budgetYears = await this.findBudgetYears(manager);
    budgetYears.forEach((year) => yearsSet.add(year));

    if (!yearsSet.size) {
      const currentYear = new Date().getFullYear();
      yearsSet.add(currentYear);
    }

    return Array.from(yearsSet).sort((a, b) => a - b);
  }
}
