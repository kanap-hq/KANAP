import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CurrencyRateSet } from './currency-rate-set.entity';
import { CurrencySettingsService } from './currency-settings.service';
import { FxRateService } from './fx-rate.service';
import { Tenant } from '../tenants/tenant.entity';
import { WorldBankClient } from './world-bank-client';
import { withTenantExecution } from '../common/tenant-runner';
import { trackBackgroundWork } from '../common/background-work';

type RateSnapshot = Record<string, number | null>;

/** First year the World Bank official-exchange-rate series carries. */
const WORLD_BANK_SERIES_START = 1960;

/** A usable cross rate: finite and strictly positive. */
function isUsableRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Precedence of one currency's rate. A fresh real value wins, then the value
 * already stored, then a fresh estimate, then a stored estimate. Every source
 * other than `estimate` is real, including a value whose source was not recorded.
 */
function ratePrecedence(source: string | null, fresh: boolean): number {
  if (source === 'estimate') return fresh ? 2 : 1;
  return fresh ? 4 : 3;
}

/**
 * The published year nearest to `year`: the closest earlier year, otherwise
 * the closest later one. The year itself is never a candidate.
 */
function nearestPublished(series: Map<number, number>, year: number): { year: number; value: number } | null {
  let earlier = -Infinity;
  let later = Infinity;
  for (const candidate of series.keys()) {
    if (candidate < year && candidate > earlier) earlier = candidate;
    else if (candidate > year && candidate < later) later = candidate;
  }
  const chosen = earlier !== -Infinity ? earlier : later !== Infinity ? later : null;
  if (chosen == null) return null;
  const value = series.get(chosen);
  if (!isUsableRate(value)) return null;
  return { year: chosen, value };
}

function canonicalJson(record: Record<string, unknown> | null | undefined): string {
  const source = record ?? {};
  const keys = Object.keys(source).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of keys) ordered[key] = source[key];
  return JSON.stringify(ordered);
}

type WorldBankRateSource =
  | 'world-bank-annual'
  | 'world-bank-quarterly'
  | 'world-bank-forward'
  | 'exchangerateapi-spot';

interface YearlySnapshot {
  year: number;
  quotes: RateSnapshot;
  /** Source of each USD quote (`world-bank-annual`, `estimate`, a spot source, or `identity` for USD). */
  quoteSources?: Record<string, string | null>;
  source: WorldBankRateSource;
  forwardSourceYear?: number;
  missingCurrencies: string[];
}

interface TenantCurrencyContext {
  tenantId: string;
  reportingCurrency: string;
  currencies: string[];
}

type RefreshTenantOptions = {
  manual?: boolean;
  label?: string;
  manager?: EntityManager;
};

@Injectable()
export class FxIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FxIngestionService.name);
  private timer: NodeJS.Timeout | null = null;
  private suspendScheduledUntil = 0;
  private readonly manualCooldownMs = 2 * 60 * 1000;
  private manualInProgress = 0;
  private readonly manualJobs = new Map<string, Promise<void>>();
  private readonly loginAutoIntervalMs: number;
  private readonly loginAutoLabel = 'login-auto';
  /** Per `tenant:year`: when a missing rate last queued a refresh of that year. */
  private readonly missingRefreshAt = new Map<string, number>();
  private readonly missingRefreshIntervalMs = 6 * 60 * 60 * 1000;

  private parseIntervalMs(): number {
    const parsed = Number(process.env.FX_LOGIN_REFRESH_INTERVAL_MS);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const daysParsed = Number(process.env.FX_LOGIN_REFRESH_INTERVAL_DAYS);
    if (Number.isFinite(daysParsed) && daysParsed > 0) return daysParsed * 24 * 60 * 60 * 1000;
    return 30 * 24 * 60 * 60 * 1000; // default: 30 days
  }

  // initialize readonly after dependencies constructed
  constructor(
    @InjectRepository(CurrencyRateSet)
    private readonly rateSets: Repository<CurrencyRateSet>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly currencySettings: CurrencySettingsService,
    private readonly fxRates: FxRateService,
    private readonly worldBank: WorldBankClient,
  ) {
    this.loginAutoIntervalMs = this.parseIntervalMs();
  }
  onModuleInit() {
    this.fxRates.onMissingRates((tenantId, years) => this.refreshMissingYears(tenantId, years));
    // Scheduled refresh disabled - rely on per-tenant login-triggered refresh instead
    // this.scheduleRefresh();
  }

  private scheduleRefresh() {
    // Disabled: scheduled refresh would hit all tenants regardless of activity
    // FX rates are now refreshed only on a per-tenant basis via login triggers (every 30 days)
    // and manual refresh from the currency settings page.
    // This prevents excessive API calls when tenants are inactive.

    // Original implementation kept for reference:
    // if (this.timer) {
    //   clearTimeout(this.timer);
    // }
    // this.timer = setTimeout(() => {
    //   this.refreshAllTenants()
    //     .catch((err) => {
    //       this.logger.error(`Scheduled FX refresh failed: ${err instanceof Error ? err.message : err}`);
    //     })
    //     .finally(() => {
    //       const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    //       this.timer = setTimeout(() => this.scheduleRefresh(), ninetyDaysMs);
    //     });
    // }, 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async refreshAllTenants(): Promise<void> {
    if (Date.now() < this.suspendScheduledUntil) {
      this.logger.debug('Skipping scheduled World Bank FX refresh; manual run recently triggered.');
      return;
    }
    if (this.manualInProgress > 0 || this.manualJobs.size > 0) {
      this.logger.debug('Skipping scheduled World Bank FX refresh; manual run currently in progress.');
      return;
    }
    const tenantIds = await this.tenants.find({ select: ['id'], where: { status: 'active' as any } });
    for (const tenant of tenantIds) {
      try {
        await this.refreshTenant(tenant.id, undefined, { manual: false, label: 'scheduled' });
      } catch (err) {
        this.logger.error(`Failed to refresh FX for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async queueManualRefresh(
    tenantId: string,
    years?: number | number[],
    opts?: { label?: string; replace?: boolean },
  ): Promise<'queued' | 'skipped'> {
    const normalizedYears = Array.isArray(years) ? [...years] : years;
    if (!opts?.replace && this.manualJobs.has(tenantId)) {
      this.logger.debug(
        `[manual] FX refresh already queued for tenant ${tenantId}; ignoring duplicate request.`,
      );
      return 'skipped';
    }

    const label = opts?.label ?? 'manual';
    const run = this.refreshTenant(tenantId, normalizedYears, { manual: true, label });
    const job = run
      .then(() => undefined)
      .catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.error(`[${label}] Queued FX refresh failed for tenant ${tenantId}: ${reason}`);
      })
      .finally(() => {
        this.manualJobs.delete(tenantId);
      });

    this.manualJobs.set(tenantId, job);
    // A stop waits for it (background-work.ts) before it closes the pool.
    void trackBackgroundWork(job);
    return 'queued';
  }

  /**
   * A read found no rate for a currency in use in these years: fetch them in
   * the background (the read itself goes on with a rate of 1, marked
   * `missing`). Each tenant year at most once every 6 hours per process, so
   * a rate the sources do not have (or a server without internet) does not
   * call them on every read.
   */
  refreshMissingYears(tenantId: string, years: number[]): void {
    const now = Date.now();
    const keyOf = (year: number) => `${tenantId}:${year}`;
    const due = years.filter((year) => now - (this.missingRefreshAt.get(keyOf(year)) ?? 0) >= this.missingRefreshIntervalMs);
    if (!due.length) return;
    due.forEach((year) => this.missingRefreshAt.set(keyOf(year), now));
    this.logger.log(`[missing-rate] queuing FX refresh for tenant ${tenantId}: years ${due.join(', ')}`);
    void this.queueManualRefresh(tenantId, due, { label: 'missing-rate' }).then((status) => {
      // Another refresh of the tenant was running: the next read asks again.
      if (status === 'skipped') due.forEach((year) => this.missingRefreshAt.delete(keyOf(year)));
    }).catch(() => undefined);
  }

  async maybeRefreshOnLogin(tenantId: string | null | undefined): Promise<void> {
    if (!tenantId) return;
    const manager = this.rateSets.manager;
    let tenantMetadata: Record<string, any> | null = null;
    try {
      const tenant = await manager.getRepository(Tenant).findOne({ where: { id: tenantId }, select: ['id', 'metadata'] });
      if (!tenant) return;
      tenantMetadata = (tenant.metadata ?? {}) as Record<string, any>;
    } catch (err) {
      this.logger.warn(
        `[${this.loginAutoLabel}] Unable to load tenant metadata for ${tenantId}: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }

    const now = new Date();
    const lastIso = typeof tenantMetadata.fx_last_login_refresh_at === 'string'
      ? tenantMetadata.fx_last_login_refresh_at
      : null;
    if (lastIso) {
      const last = new Date(lastIso);
      if (Number.isFinite(last.getTime()) && now.getTime() - last.getTime() < this.loginAutoIntervalMs) {
        return;
      }
    }

    const currentYear = now.getFullYear();
    const years = Array.from(
      new Set(
        [currentYear - 1, currentYear, currentYear + 1]
          .filter((year) => Number.isFinite(year) && year >= 1900),
      ),
    ).sort((a, b) => a - b);

    try {
      // Only these keys are merged in one statement: the metadata read above
      // is stale by now, and writing it back would erase a settings save.
      const refresh = {
        fx_last_login_refresh_at: now.toISOString(),
        fx_last_login_refresh_label: this.loginAutoLabel,
        fx_login_refresh_interval_ms: this.loginAutoIntervalMs,
        fx_last_login_refresh_years: years,
      };
      // Claimed before it is queued: the update lands only if the stored date is still the one
      // read above. Two logins at once, answered by two API processes (API_WORKERS > 1), both
      // read the old date; only one of them queues the refresh.
      const claimed: Array<{ id: string }> = await manager.query(
        `WITH claimed AS (
           UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
            WHERE id = $1
              AND CASE WHEN $3::text IS NULL
                       THEN jsonb_typeof(COALESCE(metadata, '{}'::jsonb) -> 'fx_last_login_refresh_at') IS DISTINCT FROM 'string'
                       ELSE (COALESCE(metadata, '{}'::jsonb) ->> 'fx_last_login_refresh_at') = $3::text
                  END
           RETURNING id
         )
         SELECT id FROM claimed`,
        [tenantId, JSON.stringify(refresh), lastIso],
      );
      if (claimed.length === 0) return;
      const status = await this.queueManualRefresh(tenantId, years, { label: this.loginAutoLabel });
      if (status === 'queued') {
        this.logger.log(
          `[${this.loginAutoLabel}] queued FX refresh for tenant ${tenantId}: years ${years.join(', ')}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[${this.loginAutoLabel}] Unable to queue FX refresh for tenant ${tenantId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async refreshTenant(
    tenantId: string,
    years?: number | number[],
    opts?: RefreshTenantOptions,
  ): Promise<CurrencyRateSet[]> {
    const isManual = opts?.manual ?? false;
    const label = opts?.label ?? (isManual ? 'manual' : 'scheduled');
    const now = new Date().getFullYear();

    if (isManual) {
      this.manualInProgress += 1;
      this.suspendScheduledUntil = Date.now() + this.manualCooldownMs;
    }

    try {
      const requestedYears = Array.isArray(years)
        ? years
        : years != null
          ? [years]
          : [now];
      const uniqueYears = Array.from(new Set(requestedYears.filter((year) => Number.isInteger(year))));
      if (!uniqueYears.length) {
        uniqueYears.push(now);
      }

      return this.withTenantManager(tenantId, opts?.manager, async (manager) => {
        const context = await this.buildTenantContext(tenantId, manager);

        this.logger.log(
          `[${label}] refreshing World Bank FX rates for tenant ${tenantId}: years ${uniqueYears
            .slice()
            .sort((a, b) => a - b)
            .join(', ')}`,
        );

        const supportYears = new Set(uniqueYears);
        const hasFuture = uniqueYears.some((year) => year > now);
        if (hasFuture) {
          supportYears.add(now);
        }

        const snapshots = await this.buildYearlySnapshots(context, Array.from(supportYears).sort((a, b) => a - b));
        const results: CurrencyRateSet[] = [];
        const failures: string[] = [];

        for (const year of uniqueYears.sort((a, b) => a - b)) {
          const snapshot = snapshots.find((entry) => entry.year === year);
          if (!snapshot) {
            failures.push(`year ${year}: World Bank data unavailable`);
            continue;
          }
          const baseCode = context.reportingCurrency.toUpperCase();
          const baseQuote = snapshot.quotes[baseCode];
          if (typeof baseQuote !== 'number' || !Number.isFinite(baseQuote) || baseQuote <= 0) {
            const existing = await this.fxRates.getLatestRateSet(
              context.tenantId,
              year,
              context.reportingCurrency,
              { manager },
            );
            if (existing) {
              this.logger.warn(
                `[${label}] World Bank missing base currency ${baseCode} for ${year}; reusing existing snapshot ${existing.id}`,
              );
              results.push(existing);
              continue;
            }
            failures.push(`year ${year}: missing World Bank rate for base currency ${baseCode}`);
            continue;
          }
          try {
            const set = await this.saveRateSet(context, snapshot, manager);
            if (set) results.push(set);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            failures.push(`year ${year}: ${reason}`);
            this.logger.warn(`[${label}] Unable to store World Bank rates for ${year}: ${reason}`);
          }
        }

        if (!results.length) {
          const detail = failures.length ? ` (${failures.join('; ')})` : '';
          throw new Error(`Failed to capture FX rates${detail}`);
        }
        if (failures.length) {
          this.logger.warn(`[${label}] Partial FX refresh for tenant ${context.tenantId}; skipped ${failures.join(', ')}`);
        }

        return results;
      });
    } finally {
      if (isManual) {
        this.manualInProgress = Math.max(0, this.manualInProgress - 1);
        this.suspendScheduledUntil = Date.now() + this.manualCooldownMs;
      }
    }
  }

  private async buildTenantContext(tenantId: string, manager: EntityManager): Promise<TenantCurrencyContext> {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const settings = await this.currencySettings.getSettings(tenantId, { manager });
    const currencies = new Set<string>([
      settings.reportingCurrency,
      settings.defaultCapexCurrency,
      settings.defaultSpendCurrency,
      'EUR',
    ]);

    (settings.allowedCurrencies ?? []).forEach((code) => currencies.add(code));

    const spendCurrencies = await manager
      // The currencies in use by every budget line, whatever its nature: the FX refresh covers them all.
      .query(`SELECT DISTINCT currency FROM spend_items WHERE currency IS NOT NULL LIMIT 200`);
    spendCurrencies.forEach((row: any) => {
      const code = typeof row.currency === 'string' ? row.currency.trim().toUpperCase() : '';
      if (code.length === 3) currencies.add(code);
    });
    // The base currencies of the companies: their turnovers are converted at the year's rates.
    const companyCurrencies = await manager.query(
      `SELECT DISTINCT UPPER(TRIM(base_currency)) AS currency FROM companies WHERE tenant_id = $1 AND base_currency IS NOT NULL`,
      [tenantId],
    );
    companyCurrencies.forEach((row: any) => {
      const code = typeof row.currency === 'string' ? row.currency : '';
      if (code.length === 3) currencies.add(code);
    });
    // Contract amounts convert at the year's rates, the same way company turnovers do.
    const contractCurrencies = await manager.query(
      `SELECT DISTINCT UPPER(TRIM(currency)) AS currency FROM contracts WHERE tenant_id = $1 AND currency IS NOT NULL`,
      [tenantId],
    );
    contractCurrencies.forEach((row: any) => {
      const code = typeof row.currency === 'string' ? row.currency : '';
      if (code.length === 3) currencies.add(code);
    });

    await this.currencySettings.ensureCurrencyRecords(currencies, { manager });

    return {
      tenantId,
      reportingCurrency: settings.reportingCurrency,
      currencies: Array.from(currencies).map((code) => code.toUpperCase()),
    };
  }

  private async withTenantManager<T>(
    tenantId: string,
    manager: EntityManager | undefined,
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (manager?.queryRunner) {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      return fn(manager);
    }

    const dataSource = manager?.connection ?? this.rateSets.manager.connection;
    return withTenantExecution(dataSource, tenantId, fn, { transaction: true });
  }

  /**
   * Latest published annual for the current-year and future-year fallback.
   * A value already read from the series (a refresh that also asked for past
   * years) is reused. Otherwise the last ten published years are read, so a
   * refresh of the current year alone still has a fallback.
   */
  private async latestPublishedForFallback(
    currency: string,
    currentYear: number,
    knownValue: number | null,
    knownYear: number,
  ): Promise<{ year: number; value: number } | null> {
    if (knownValue != null && knownYear !== -Infinity) return { year: knownYear, value: knownValue };
    try {
      const history = await this.worldBank.fetchAnnualRates(currency, currentYear - 10, currentYear - 1);
      let bestYear = -Infinity;
      let best: number | null = null;
      for (const [year, value] of history) {
        if (year > bestYear && isUsableRate(value)) {
          bestYear = year;
          best = value;
        }
      }
      return best == null ? null : { year: bestYear, value: best };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`World Bank annual fetch failed for ${currency} ${currentYear - 10}-${currentYear - 1}: ${reason}`);
      return null;
    }
  }

  private determineSource(year: number, currentYear: number): WorldBankRateSource {
    if (year > currentYear) return 'world-bank-forward';
    if (year === currentYear) return 'exchangerateapi-spot';
    return 'world-bank-annual';
  }

  private async buildYearlySnapshots(context: TenantCurrencyContext, years: number[]): Promise<YearlySnapshot[]> {
    if (!years.length) return [];
    const currentYear = new Date().getFullYear();
    const baseCode = context.reportingCurrency.toUpperCase();
    const currencies = new Set<string>(context.currencies.map((code) => code.toUpperCase()));
    currencies.add(baseCode);
    currencies.add('EUR');
    currencies.add('USD');

    const annualYears = years.filter((year) => year <= currentYear - 1);
    const futureYears = years.filter((year) => year > currentYear);
    const needCurrentYear = years.includes(currentYear);

    const currencyResults = new Map<string, Map<number, number | null>>();
    const sourceResults = new Map<string, Map<number, string | null>>();
    const missingByYear = new Map<number, Set<string>>();
    const basisByYear = new Map<number, WorldBankRateSource>();

    for (const currency of Array.from(currencies)) {
      const upper = currency.toUpperCase();
      const yearMap = new Map<number, number | null>();
      const sourceByYear = new Map<number, string | null>();
      const isBase = upper === baseCode;
      let latestHistoricalValue: number | null = null;
      let latestHistoricalYear = -Infinity;
      const recordMissing = (year: number) => {
        if (!missingByYear.has(year)) missingByYear.set(year, new Set());
        missingByYear.get(year)?.add(upper);
      };
      const put = (year: number, value: number | null, source: string | null) => {
        yearMap.set(year, value);
        sourceByYear.set(year, value != null ? source : null);
      };

      if (upper === 'USD') {
        years.forEach((year) => put(year, 1, 'identity'));
        currencyResults.set(upper, yearMap);
        sourceResults.set(upper, sourceByYear);
        continue;
      }

      const code = this.worldBank.resolveCode(upper);
      if (!code) {
        years.forEach((year) => {
          recordMissing(year);
          put(year, null, null);
        });
        this.logger.warn(`No World Bank ISO3 mapping for ${upper}`);
        currencyResults.set(upper, yearMap);
        sourceResults.set(upper, sourceByYear);
        continue;
      }

      if (annualYears.length) {
        // The whole series, so a year the World Bank has not published can take
        // the nearest year it has, including one outside the requested range.
        const end = Math.max(currentYear - 1, ...annualYears);
        try {
          const annualMap = await this.worldBank.fetchAnnualRates(upper, WORLD_BANK_SERIES_START, end);
          for (const [publishedYear, publishedValue] of annualMap) {
            if (publishedYear <= currentYear - 1 && publishedYear > latestHistoricalYear && isUsableRate(publishedValue)) {
              latestHistoricalValue = publishedValue;
              latestHistoricalYear = publishedYear;
            }
          }
          annualYears.forEach((year) => {
            const published = annualMap.get(year) ?? null;
            if (isUsableRate(published)) {
              put(year, published, 'world-bank-annual');
              if (isBase) basisByYear.set(year, 'world-bank-annual');
              return;
            }
            this.logger.warn(`No World Bank annual value for ${upper} ${year}`);
            const nearest = nearestPublished(annualMap, year);
            if (nearest) {
              put(year, nearest.value, 'estimate');
              return;
            }
            recordMissing(year);
            put(year, null, null);
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.logger.warn(`World Bank annual fetch failed for ${upper}: ${reason}`);
          annualYears.forEach((year) => {
            recordMissing(year);
            put(year, null, null);
          });
        }
      }

      let currentYearValue: number | null = null;
      let currentYearBasis: WorldBankRateSource | null = null;
      if (needCurrentYear) {
        const spot = await this.worldBank.fetchSpotRate(upper);
        if (spot != null) {
          currentYearValue = spot;
          currentYearBasis = 'exchangerateapi-spot';
        }
        if (currentYearValue == null) {
          try {
            const annualCurrent = await this.worldBank.fetchAnnualRates(upper, currentYear, currentYear);
            const value = annualCurrent.get(currentYear) ?? null;
            if (value != null) {
              currentYearValue = value;
              currentYearBasis = 'world-bank-annual';
            }
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            this.logger.warn(`World Bank annual fetch failed for ${upper} ${currentYear}: ${reason}`);
          }
        }

        if (currentYearValue == null) {
          const latest = await this.latestPublishedForFallback(upper, currentYear, latestHistoricalValue, latestHistoricalYear);
          if (latest) {
            currentYearValue = latest.value;
            latestHistoricalValue = latest.value;
            latestHistoricalYear = latest.year;
            currentYearBasis = 'world-bank-forward';
            this.logger.warn(
              `Using latest World Bank annual value (${latest.year}) for ${upper} in place of ${currentYear}`,
            );
          }
        }

        if (currentYearValue != null) {
          put(currentYear, currentYearValue, currentYearBasis);
          if (isBase && currentYearBasis) {
            basisByYear.set(currentYear, currentYearBasis);
          }
        } else {
          recordMissing(currentYear);
          put(currentYear, null, null);
          this.logger.warn(`Missing World Bank data for ${upper} ${currentYear}`);
        }
      }

      if (futureYears.length && currentYearValue == null && latestHistoricalValue == null) {
        const latest = await this.latestPublishedForFallback(upper, currentYear, null, -Infinity);
        if (latest) {
          latestHistoricalValue = latest.value;
          latestHistoricalYear = latest.year;
        }
      }
      const forwardValue = currentYearValue ?? latestHistoricalValue ?? null;
      if (futureYears.length) {
        if (forwardValue != null) {
          futureYears.forEach((year) => {
            put(year, forwardValue as number, 'world-bank-forward');
            if (isBase) basisByYear.set(year, 'world-bank-forward');
          });
        } else {
          futureYears.forEach((year) => {
            recordMissing(year);
            put(year, null, null);
            this.logger.warn(`Cannot derive World Bank estimate for ${upper} ${year} (no historical data)`);
          });
        }
      }

      years.forEach((year) => {
        if (!yearMap.has(year)) {
          recordMissing(year);
          put(year, null, null);
        }
      });

      currencyResults.set(upper, yearMap);
      sourceResults.set(upper, sourceByYear);
    }

    return years.map((year) => {
      const basis = basisByYear.get(year);
      const source = basis ?? this.determineSource(year, currentYear);
      const quotes: RateSnapshot = {};
      const quoteSources: Record<string, string | null> = {};
      currencyResults.forEach((map, currency) => {
        quotes[currency] = map.get(year) ?? null;
        quoteSources[currency] = sourceResults.get(currency)?.get(year) ?? null;
      });
      quotes.USD = 1;
      quoteSources.USD = 'identity';
      return {
        year,
        quotes,
        quoteSources,
        source,
        forwardSourceYear: source === 'world-bank-forward' ? currentYear : undefined,
        missingCurrencies: Array.from(missingByYear.get(year)?.values() ?? []).filter((code) => code !== 'USD'),
      };
    });
  }

  private buildRateMap(baseCurrency: string, snapshot: YearlySnapshot, targets: string[]): RateSnapshot {
    const upperBase = baseCurrency.toUpperCase();
    const quotes = snapshot.quotes;
    const baseQuoteRaw = upperBase === 'USD' ? 1 : quotes[upperBase];
    if (typeof baseQuoteRaw !== 'number' || !Number.isFinite(baseQuoteRaw) || baseQuoteRaw <= 0) {
      throw new Error(`World Bank payload missing base quote for ${upperBase} ${snapshot.year}`);
    }
    const result: RateSnapshot = {};
    targets.forEach((currency) => {
      const upper = currency.toUpperCase();
      if (upper === upperBase) {
        result[upper] = 1;
        return;
      }
      const quote = upper === 'USD' ? 1 : quotes[upper];
      if (typeof quote !== 'number' || !Number.isFinite(quote) || quote <= 0) {
        result[upper] = null;
        return;
      }
      const rate = baseQuoteRaw / quote;
      result[upper] = Number(rate.toFixed(6));
    });
    return result;
  }

  private rateBasisForSource(source: WorldBankRateSource): string {
    switch (source) {
      case 'world-bank-quarterly':
        return 'quarterly_avg';
      case 'world-bank-forward':
        return 'forward_avg';
      case 'exchangerateapi-spot':
        return 'spot';
      default:
        return 'annual_avg';
    }
  }

  /**
   * Source recorded for a value already stored. A set captured before
   * `rate_sources` existed lends its set-level `source` to each value.
   */
  private existingRateSource(existing: CurrencyRateSet, code: string, value: number | null): string | null {
    if (!isUsableRate(value)) return null;
    const table = existing.rate_sources ?? {};
    const recorded = table[code] ?? table[code.toUpperCase()] ?? table[code.toLowerCase()];
    if (typeof recorded === 'string' && recorded.length > 0) return recorded;
    return existing.source ?? null;
  }

  /**
   * Merges this fetch with the latest set of the same tenant, year and base.
   * A currency the sources miss this time (or that is no longer in the fetch
   * list) keeps its stored value and the source that produced it.
   */
  private mergeWithLatest(
    freshRates: RateSnapshot,
    freshSources: Record<string, string | null>,
    existing: CurrencyRateSet | null,
  ): { rates: RateSnapshot; sources: Record<string, string> } {
    const fresh: RateSnapshot = {};
    const freshSourceByCode: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(freshRates)) {
      const code = key.toUpperCase();
      fresh[code] = value;
      freshSourceByCode[code] = freshSources[key] ?? freshSources[code] ?? null;
    }
    const previous: RateSnapshot = {};
    const previousSourceByCode: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(existing?.rates ?? {})) {
      const code = key.toUpperCase();
      previous[code] = value;
      previousSourceByCode[code] = existing ? this.existingRateSource(existing, code, isUsableRate(value) ? value : null) : null;
    }
    const keys = new Set<string>([...Object.keys(fresh), ...Object.keys(previous)]);
    const rates: RateSnapshot = {};
    const sources: Record<string, string> = {};
    for (const code of keys) {
      const freshValue = isUsableRate(fresh[code]) ? fresh[code] : null;
      const freshSource = freshValue != null ? (freshSourceByCode[code] ?? null) : null;
      const previousValue = isUsableRate(previous[code]) ? previous[code] : null;
      const previousSource = previousValue != null ? (previousSourceByCode[code] ?? null) : null;
      const freshRank = freshValue != null ? ratePrecedence(freshSource, true) : 0;
      const previousRank = previousValue != null ? ratePrecedence(previousSource, false) : 0;
      if (freshRank === 0 && previousRank === 0) {
        if (Object.prototype.hasOwnProperty.call(fresh, code)) rates[code] = null;
        continue;
      }
      const keepFresh = freshRank >= previousRank;
      const value = keepFresh ? freshValue : previousValue;
      const source = keepFresh ? freshSource : previousSource;
      rates[code] = value;
      if (value != null && source) sources[code] = source;
    }
    return { rates, sources };
  }

  /** Source of each fresh cross rate. Per-currency sources win; the set source covers the rest. */
  private freshRateSources(baseCurrency: string, snapshot: YearlySnapshot, rates: RateSnapshot): Record<string, string | null> {
    const upperBase = baseCurrency.toUpperCase();
    const quoteSources = snapshot.quoteSources ?? {};
    const baseQuoteSource = upperBase === 'USD' ? 'identity' : (quoteSources[upperBase] ?? null);
    const sources: Record<string, string | null> = {};
    for (const [code, value] of Object.entries(rates)) {
      if (!isUsableRate(value)) {
        sources[code] = null;
        continue;
      }
      if (code.toUpperCase() === upperBase) {
        sources[code] = 'identity';
        continue;
      }
      if (code.toUpperCase() === 'USD') {
        sources[code] = baseQuoteSource ?? snapshot.source;
        continue;
      }
      sources[code] = quoteSources[code] ?? snapshot.source;
    }
    return sources;
  }

  private async saveRateSet(
    context: TenantCurrencyContext,
    snapshot: YearlySnapshot,
    manager: EntityManager,
  ): Promise<CurrencyRateSet | null> {
    const repo = manager.getRepository(CurrencyRateSet);
    const existing = await repo.findOne({
      where: {
        tenant_id: context.tenantId,
        fiscal_year: snapshot.year,
        base_currency: context.reportingCurrency,
      },
      order: { captured_at: 'DESC' as any },
    });

    const freshRates = this.buildRateMap(context.reportingCurrency, snapshot, context.currencies);
    const merged = this.mergeWithLatest(
      freshRates,
      this.freshRateSources(context.reportingCurrency, snapshot, freshRates),
      existing,
    );
    const rates = merged.rates;
    const upperBase = context.reportingCurrency.toUpperCase();
    const hasNonBase = Object.keys(rates).some((code) => code.toUpperCase() !== upperBase);
    const hasSignal = !hasNonBase || Object.entries(rates).some(([code, value]) => {
      if (code.toUpperCase() === upperBase) return false;
      return typeof value === 'number' && Number.isFinite(value) && Math.abs(value - 1) > 1e-6;
    });
    if (!hasSignal) {
      if (existing) {
        this.logger.warn(
          `World Bank payload for ${snapshot.year} lacked usable rates; keeping existing snapshot ${existing.id}`,
        );
        return existing;
      }
      throw new Error(
        `World Bank payload for ${snapshot.year} did not yield usable rates (reporting currency ${context.reportingCurrency})`,
      );
    }

    const canonical = canonicalJson(rates);
    const existingCanonical = existing ? canonicalJson(existing.rates || {}) : null;
    // An older set has no per-currency sources: identical rates are not rewritten
    // only to fill them in. A stored provenance that changed (an estimate the
    // World Bank has now published, at the same number) is a new set.
    const provenanceUnchanged = !existing?.rate_sources
      || canonicalJson(existing.rate_sources) === canonicalJson(merged.sources);

    if (existing && existingCanonical === canonical && existing.source === snapshot.source && provenanceUnchanged) {
      this.logger.debug(`FX rates unchanged for tenant ${context.tenantId} year ${snapshot.year}`);
      return existing;
    }

    if (snapshot.missingCurrencies.length) {
      this.logger.warn(
        `World Bank data missing for ${snapshot.missingCurrencies.join(', ')} ${snapshot.year} (tenant ${context.tenantId})`,
      );
    }
    if (snapshot.source === 'world-bank-forward') {
      this.logger.log(
        `Using World Bank forward estimate for ${snapshot.year} (tenant ${context.tenantId}) based on ${snapshot.forwardSourceYear}`,
      );
    }

    const set = repo.create({
      tenant_id: context.tenantId,
      fiscal_year: snapshot.year,
      base_currency: context.reportingCurrency,
      rates,
      rate_sources: Object.keys(merged.sources).length ? merged.sources : null,
      rate_basis: this.rateBasisForSource(snapshot.source),
      source: snapshot.source,
    });
    const saved = await repo.save(set);
    this.logger.log(
      `Stored FX rate set ${saved.id} for tenant ${context.tenantId} year ${snapshot.year} (source=${snapshot.source})`,
    );
    return saved;
  }
}
