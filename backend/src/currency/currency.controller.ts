import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel, RequireAnyLevelMeta } from '../auth/require-level.decorator';
import { CurrencySettings, CurrencySettingsService } from './currency-settings.service';
import { FxIngestionService } from './fx-ingestion.service';
import { ManualRatesService, MissingRatePair, ReportingChangeImpact, parseCurrency } from './manual-rates.service';
import { LongRunningRequest, OUTSIDE_WORK_TIMEOUTS } from '../common/request-db-timeouts';
import { EntityManager, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CurrencyRateSet } from './currency-rate-set.entity';

// Currencies are a budget setting: every budget reader sees them (the OPEX and
// CAPEX forms read the default and allowed currencies of their currency picker),
// budget administrators change them.
const CURRENCY_READERS: RequireAnyLevelMeta = [
  { resource: 'budget_ops', level: 'reader' },
  { resource: 'budget', level: 'reader' },
];

/**
 * Settles once the response is sent or the connection closed: the request
 * transaction has committed (or ended) by then. Undefined outside HTTP.
 */
function responseSent(req: any): Promise<void> | undefined {
  const res = req?.res;
  if (!res || typeof res.once !== 'function') return undefined;
  if (res.writableFinished || res.destroyed) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => resolve();
    res.once('finish', done);
    res.once('close', done);
  });
}

@UseGuards(JwtAuthGuard)
@Controller('currency')
export class CurrencyController {
  constructor(
    private readonly settings: CurrencySettingsService,
    private readonly fxIngestion: FxIngestionService,
    private readonly manualRates: ManualRatesService,
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

  /**
   * Saves the settings in the request transaction (the new currency rows with
   * them) and queues the rate refresh without waiting for it: the run starts
   * once this request has committed. `refreshYears` names the years it fetches
   * (every year in use for a new reporting currency, otherwise the current one);
   * `POST /currency/rates/refresh` with those years waits for the result.
   */
  @Patch('settings')
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  async updateSettings(@Body() body: any, @Req() req: any): Promise<CurrencySettings & { refreshYears: number[] }> {
    const tenantId = this.requireTenantId(req);
    const payload: any = {};

    // Checked against the ISO list before any lock or write: 400 `currency_invalid`.
    if (body.reportingCurrency) payload.reportingCurrency = parseCurrency(String(body.reportingCurrency));
    if (body.defaultSpendCurrency) payload.defaultSpendCurrency = String(body.defaultSpendCurrency).trim().toUpperCase();
    if (body.defaultCapexCurrency) payload.defaultCapexCurrency = String(body.defaultCapexCurrency).trim().toUpperCase();
    if (Array.isArray(body.allowedCurrencies)) {
      payload.allowedCurrencies = body.allowedCurrencies.map((code: any) => String(code || '').trim().toUpperCase()).filter((code: string) => code.length === 3);
    }

    const manager = req?.queryRunner?.manager as EntityManager | undefined;
    const before = await this.settings.getSettings(tenantId, { manager });
    // Inserts the currency rows of the new settings in this same transaction.
    const next = await this.settings.updateSettings(tenantId, payload, req.user?.sub ?? null, { manager });
    const startAfter = responseSent(req);
    if (next.reportingCurrency !== before.reportingCurrency) {
      const readManager = manager ?? this.rateSets.manager;
      await this.ensureTenantContext(readManager, tenantId);
      const refreshYears = await this.manualRates.reportingChangeYears(tenantId, readManager);
      await this.fxIngestion.queueManualRefresh(tenantId, refreshYears, {
        label: 'reporting-currency',
        reportingCurrency: next.reportingCurrency,
        startAfter,
      });
      return { ...next, refreshYears };
    }
    const refreshYears = [new Date().getFullYear()];
    await this.fxIngestion.queueManualRefresh(tenantId, refreshYears, { label: 'currency-settings', startAfter });
    return { ...next, refreshYears };
  }

  /** What a change of reporting currency does to manual rates, frozen versions and the allowed list. */
  @Get('reporting-change-impact')
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  async reportingChangeImpact(@Query('to') to: string | undefined, @Req() req: any): Promise<ReportingChangeImpact> {
    const tenantId = this.requireTenantId(req);
    const manager = req?.queryRunner?.manager ?? this.rateSets.manager;
    await this.ensureTenantContext(manager, tenantId);
    return this.manualRates.reportingChangeImpact(tenantId, to, manager);
  }

  @Get('rates')
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(CURRENCY_READERS)
  async listRates(@Req() req: any) {
    const tenantId = this.requireTenantId(req);
    const entityManager = req?.queryRunner?.manager ?? this.rateSets.manager;
    await this.ensureTenantContext(entityManager, tenantId);
    return this.manualRates.listRateMatrix(tenantId, entityManager);
  }

  // Static path: declared before `rates/manual/:year/:currency`.
  @Get('rates/missing')
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(CURRENCY_READERS)
  async listMissingRates(@Req() req: any) {
    const tenantId = this.requireTenantId(req);
    const manager = req?.queryRunner?.manager ?? this.rateSets.manager;
    await this.ensureTenantContext(manager, tenantId);
    const items = await this.manualRates.listMissingPairs(tenantId, manager);
    return { items };
  }

  @Put('rates/manual')
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  async setManualRate(@Body() body: { currency?: string; year?: number; rate?: number }, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    const manager = req?.queryRunner?.manager ?? this.rateSets.manager;
    await this.ensureTenantContext(manager, tenantId);
    const set = await this.manualRates.setManualRate(
      tenantId,
      { currency: body?.currency as string, year: body?.year as number, rate: body?.rate as number },
      req.user?.sub ?? null,
      manager,
    );
    const frozenVersions = await this.manualRates.countFrozenVersions(tenantId, set.fiscal_year, manager);
    return { ...this.presentSet(set), frozenVersions };
  }

  @Delete('rates/manual/:year/:currency')
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  async removeManualRate(@Param('year') yearRaw: string, @Param('currency') currency: string, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    const manager = req?.queryRunner?.manager ?? this.rateSets.manager;
    await this.ensureTenantContext(manager, tenantId);
    const year = Number(yearRaw);
    const removed = await this.manualRates.removeManualRate(
      tenantId,
      { currency, year },
      req.user?.sub ?? null,
      manager,
    );
    const frozenVersions = await this.manualRates.countFrozenVersions(tenantId, year, manager);
    return { ...removed, frozenVersions };
  }

  /**
   * Fetches the years and waits up to 20 s for the run that covers them (one
   * already going, or the next one of the tenant's queue). The request
   * transaction only reads and holds no row lock while it waits. `failed`: the
   * run captured nothing (source unreachable, job error).
   */
  @Post('rates/refresh')
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  async refreshRates(
    @Body() body: { years?: number[]; year?: number } | undefined,
    @Req() req: any,
  ): Promise<
    | { ok: true; completed: false; years: number[] }
    | { ok: true; completed: true; failed: boolean; years: number[]; fetched: number; stillMissing: MissingRatePair[] }
  > {
    const tenantId = this.requireTenantId(req);
    const requested = Array.isArray(body?.years) && body?.years.length
      ? body?.years
      : body?.year != null
        ? [body.year]
        : undefined;
    const entityManager = req?.queryRunner?.manager ?? this.rateSets.manager;
    const years = await this.resolveSyncYears(tenantId, requested, entityManager);
    const { reportingCurrency } = await this.settings.getSettings(tenantId, { manager: entityManager });
    const before = await this.usablePairs(entityManager, tenantId, years, reportingCurrency);
    // The fetch commits on its own connection. This request only waits, then reads.
    const outcome = await this.fxIngestion.refreshWithin(tenantId, years, { label: 'manual-api', reportingCurrency });
    if (!outcome.completed) return { ok: true, completed: false, years };
    let fetched = 0;
    if (!outcome.failed) {
      const after = await this.usablePairs(entityManager, tenantId, years, reportingCurrency);
      for (const pair of after) if (!before.has(pair)) fetched += 1;
    }
    const stillMissing = await this.manualRates.listMissingPairs(tenantId, entityManager, { report: false });
    return { ok: true, completed: true, failed: outcome.failed, years, fetched, stillMissing };
  }

  /**
   * Usable currency-year pairs on the latest set of each year: finite and strictly above 0.
   * `baseCurrency` keeps a single base, so a reporting-currency change counts pairs of the new one.
   */
  private async usablePairs(
    manager: EntityManager,
    tenantId: string,
    years: number[],
    baseCurrency?: string,
  ): Promise<Set<string>> {
    if (!years.length) return new Set();
    const params: unknown[] = [tenantId, years];
    let baseSql = '';
    if (baseCurrency) {
      params.push(baseCurrency.trim().toUpperCase());
      baseSql = 'AND UPPER(TRIM(base_currency)) = $3';
    }
    const rows = await manager.query(
      `SELECT DISTINCT ON (fiscal_year) fiscal_year, rates
         FROM currency_rate_sets
        WHERE tenant_id = $1
          AND fiscal_year = ANY($2::int[])
          ${baseSql}
        ORDER BY fiscal_year, captured_at DESC`,
      params,
    );
    const pairs = new Set<string>();
    for (const row of rows as Array<{ fiscal_year: unknown; rates: unknown }>) {
      const year = typeof row.fiscal_year === 'number' ? row.fiscal_year : Number(row.fiscal_year);
      if (!Number.isInteger(year)) continue;
      const rates = row.rates && typeof row.rates === 'object' ? row.rates as Record<string, unknown> : {};
      for (const [key, value] of Object.entries(rates)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) pairs.add(`${year}:${key.toUpperCase()}`);
      }
    }
    return pairs;
  }

  private presentSet(set: CurrencyRateSet) {
    return {
      fiscalYear: set.fiscal_year,
      baseCurrency: typeof set.base_currency === 'string' ? set.base_currency.trim() : set.base_currency,
      rates: set.rates,
      rateSources: set.rate_sources ?? {},
      capturedAt: set.captured_at,
      source: set.source,
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
    // The months of the budget lines of both natures (one table since lot Z1, `spend/budget-nature.ts`).
    const rows = await manager.query(`
      SELECT DISTINCT CAST(EXTRACT(YEAR FROM a.period) AS integer) AS year
      FROM spend_amounts a
      JOIN spend_versions v ON v.tenant_id = a.tenant_id AND v.id = a.version_id
      JOIN spend_items i ON i.tenant_id = v.tenant_id AND i.id = v.spend_item_id AND i.nature IN ('opex', 'capex')
      WHERE COALESCE(a.planned, 0) <> 0
         OR COALESCE(a.forecast, 0) <> 0
         OR COALESCE(a.committed, 0) <> 0
         OR COALESCE(a.actual, 0) <> 0
         OR COALESCE(a.expected_landing, 0) <> 0
    `);

    const years = new Set<number>();
    this.extractYearList(rows).forEach((year) => years.add(year));
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
      yearsSet.add(currentYear - 1);
      yearsSet.add(currentYear);
      yearsSet.add(currentYear + 1);
      // Read only. Reporting here would queue a refresh, and the forced sync would see it as already running.
      const missing = await this.manualRates.listMissingPairs(tenantId, manager, { report: false });
      missing.forEach((pair) => yearsSet.add(pair.year));
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
