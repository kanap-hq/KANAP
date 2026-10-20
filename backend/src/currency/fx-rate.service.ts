import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { CurrencyRateSet } from './currency-rate-set.entity';
import { CurrencySettingsService, CurrencySettings } from './currency-settings.service';

export type FxRateSource = 'snapshot' | 'live' | 'identity' | 'missing';

export interface FxResolvedRate {
  rate: number;
  rateSetId: string | null;
  fiscalYear: number;
  /** The tenant's current reporting currency. */
  reportingCurrency: string;
  source: FxRateSource;
  capturedAt: Date | null;
  /**
   * Set when a pinned rate set was captured in another base: the rate is
   * `pinned[source → via] × live[via → reporting]` for the same year
   * (`live[via]` alone when the source is `via`). Null on a direct rate.
   */
  via: string | null;
}

export interface FxLookupKey {
  key: string;
  rateSetId: string | null;
  fiscalYear: number;
  sourceCurrency: string;
}

/** Told the years in which a currency in use has no rate (see `FxRateService.onMissingRates`). */
export type MissingRatesListener = (tenantId: string, years: number[]) => void;

function makeKey(rateSetId: string | null, fiscalYear: number, sourceCurrency: string): string {
  return `${rateSetId || 'live'}:${fiscalYear}:${sourceCurrency.toUpperCase()}`;
}

@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);
  private missingRatesListener: MissingRatesListener | null = null;

  constructor(
    @InjectRepository(CurrencyRateSet)
    private readonly rateSets: Repository<CurrencyRateSet>,
    private readonly currencySettings: CurrencySettingsService,
  ) {}

  /**
   * The FX ingestion listens here: `resolveRates` tells it the years whose
   * rates lack a currency in use (no set for the year, or a set captured
   * before the currency was used), and it fetches them in the background.
   */
  onMissingRates(listener: MissingRatesListener | null) {
    this.missingRatesListener = listener;
  }

  /**
   * Tells the missing-rate listener that these years have a currency in use
   * with no rate. The same listener `resolveRates` calls. Never throws: a
   * listener failure leaves the read that noticed the gap alone.
   */
  reportMissingYears(tenantId: string, years: number[]): void {
    if (!this.missingRatesListener || !years.length) return;
    try {
      const unique = Array.from(new Set(years.filter((year) => Number.isInteger(year)))).sort((a, b) => a - b);
      if (unique.length) this.missingRatesListener(tenantId, unique);
    } catch (err) {
      this.logger.warn(`Missing FX rates listener failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private repo(manager?: EntityManager) {
    return manager ? manager.getRepository(CurrencyRateSet) : this.rateSets;
  }

  async getRateSetById(id: string, opts?: { manager?: EntityManager }) {
    if (!id) return null;
    const repo = this.repo(opts?.manager);
    return repo.findOne({ where: { id } });
  }

  async getLatestRateSet(
    tenantId: string,
    fiscalYear: number,
    baseCurrency: string,
    opts?: { manager?: EntityManager },
  ): Promise<CurrencyRateSet | null> {
    const repo = this.repo(opts?.manager);
    return repo.findOne({
      where: {
        tenant_id: tenantId,
        fiscal_year: fiscalYear,
        base_currency: baseCurrency.toUpperCase(),
      },
      order: { captured_at: 'DESC' as any },
    });
  }

  private resolveRateFromSet(
    rateSet: CurrencyRateSet | null,
    sourceCurrency: string,
  ): { rate: number; source: FxRateSource } {
    if (!rateSet) return { rate: 1, source: 'missing' };
    const currency = sourceCurrency.toUpperCase();
    if (currency === rateSet.base_currency.toUpperCase()) {
      return { rate: 1, source: 'identity' };
    }
    const rates = rateSet.rates || {};
    const raw = rates[currency];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return { rate: raw, source: rateSet.id ? 'snapshot' : 'live' };
    }
    return { rate: 1, source: 'missing' };
  }

  /**
   * A usable rate from a set: 1 when the currency is the set's base, the stored
   * value when it is finite and strictly positive, otherwise null.
   */
  private usableRate(rateSet: CurrencyRateSet | null, currency: string): number | null {
    const resolved = this.resolveRateFromSet(rateSet, currency);
    if (resolved.source === 'missing' || !(resolved.rate > 0)) return null;
    return resolved.rate;
  }

  /**
   * A pinned set captured in another base keeps its own rates. The result in
   * that base is brought into the current reporting currency at the live rate
   * of the year: `pinned[source → oldBase] × live[oldBase → reporting]`.
   * The old base itself takes the live rate alone. The new reporting currency
   * goes through the pin as well (the frozen rate stays the anchor).
   * `missing` when that live rate is absent; `fallback` when the pin does not
   * rate the source, which then reads the live set directly.
   */
  private crossPinned(
    pinned: CurrencyRateSet,
    live: CurrencyRateSet | null,
    sourceCurrency: string,
    oldBase: string,
  ): 'fallback' | 'missing' | { rate: number; source: FxRateSource; capturedAt: Date | null } {
    const sourceIsOldBase = sourceCurrency === oldBase;
    const pinnedFactor = sourceIsOldBase ? null : this.usableRate(pinned, sourceCurrency);
    if (!sourceIsOldBase && pinnedFactor == null) return 'fallback';
    const liveOld = this.usableRate(live, oldBase);
    if (liveOld == null) return 'missing';
    if (sourceIsOldBase) {
      return { rate: liveOld, source: 'live', capturedAt: live?.captured_at ?? null };
    }
    return { rate: pinnedFactor! * liveOld, source: 'snapshot', capturedAt: pinned.captured_at ?? null };
  }

  /**
   * Resolves each lookup to a rate (its snapshot set, else the latest live set
   * of its year, else 1 with the source `missing`, also when the year's set
   * exists but does not rate the currency) and warns for each distinct key
   * whose rate is missing. Those years go to the missing-rates listener, which
   * fetches them: the next read finds the rate.
   * A pinned set whose base is no longer the reporting currency keeps its
   * rates and converts them at the live rate of that old base (`via`).
   * `quiet`: no warning, for a caller resolving speculative keys that no
   * version may use (the list engine's rate table).
   */
  async resolveRates(
    tenantId: string,
    lookups: FxLookupKey[],
    opts?: { manager?: EntityManager; quiet?: boolean },
  ): Promise<{ map: Map<string, FxResolvedRate>; settings: CurrencySettings }> {
    if (!lookups.length) {
      const settings = await this.currencySettings.getSettings(tenantId, opts);
      return { map: new Map(), settings };
    }

    const settings = await this.currencySettings.getSettings(tenantId, opts);
    const repo = this.repo(opts?.manager);

    const uniqueKeys = new Map<string, FxLookupKey>();
    for (const lookup of lookups) {
      const key = makeKey(lookup.rateSetId, lookup.fiscalYear, lookup.sourceCurrency);
      if (!uniqueKeys.has(key)) {
        uniqueKeys.set(key, { ...lookup, key });
      }
    }

    const snapshotIds = Array.from(uniqueKeys.values())
      .map((item) => item.rateSetId)
      .filter((id): id is string => !!id);

    const snapshots = snapshotIds.length
      ? await repo.find({ where: { id: In(snapshotIds) as any } })
      : [];
    const snapshotById = new Map(snapshots.map((entry) => [entry.id, entry]));

    const result = new Map<string, FxResolvedRate>();
    const missingYears = new Set<number>();
    // The latest live set depends on the year only: read it once per year, not once per currency and rate set.
    const latestByYear = new Map<number, Promise<CurrencyRateSet | null>>();
    const latestLiveSet = (fiscalYear: number) => {
      let latest = latestByYear.get(fiscalYear);
      if (!latest) {
        latest = this.getLatestRateSet(tenantId, fiscalYear, settings.reportingCurrency, opts);
        latestByYear.set(fiscalYear, latest);
      }
      return latest;
    };

    for (const item of uniqueKeys.values()) {
      const upperSource = item.sourceCurrency.toUpperCase();
      const reporting = settings.reportingCurrency;
      const reportingUpper = reporting.toUpperCase();
      let rateSet: CurrencyRateSet | null = null;
      let rateSource: FxRateSource = 'missing';

      if (item.rateSetId) {
        const pinned = snapshotById.get(item.rateSetId) ?? null;
        const pinnedBase = pinned?.base_currency?.toUpperCase() ?? '';
        if (pinned && pinnedBase && pinnedBase !== reportingUpper) {
          const live = await latestLiveSet(item.fiscalYear);
          const crossed = this.crossPinned(pinned, live, upperSource, pinnedBase);
          if (crossed === 'missing') {
            missingYears.add(item.fiscalYear);
            if (!opts?.quiet) {
              this.logger.warn(
                `Missing FX rate for ${upperSource}->${reporting} ${item.fiscalYear} via ${pinnedBase} (tenant ${tenantId})`,
              );
            }
            result.set(item.key, {
              rate: 1,
              rateSetId: pinned.id,
              fiscalYear: item.fiscalYear,
              reportingCurrency: reporting,
              source: 'missing',
              capturedAt: null,
              via: pinnedBase,
            });
            continue;
          }
          if (crossed !== 'fallback') {
            result.set(item.key, {
              rate: crossed.rate,
              rateSetId: pinned.id,
              fiscalYear: item.fiscalYear,
              reportingCurrency: reporting,
              source: crossed.source,
              capturedAt: crossed.capturedAt,
              via: pinnedBase,
            });
            continue;
          }
        } else if (pinned) {
          const resolved = this.resolveRateFromSet(pinned, upperSource);
          if (resolved.source !== 'missing' && resolved.rate > 0) {
            result.set(item.key, {
              rate: resolved.rate,
              rateSetId: pinned.id,
              fiscalYear: item.fiscalYear,
              reportingCurrency: reporting,
              source: resolved.source === 'snapshot' ? 'snapshot' : resolved.source,
              capturedAt: pinned.captured_at ?? null,
              via: null,
            });
            continue;
          }
        }
      }

      // fallback to latest live set of the current reporting currency
      rateSet = await latestLiveSet(item.fiscalYear);
      const resolved = rateSet
        ? this.resolveRateFromSet(rateSet, upperSource)
        : upperSource === reportingUpper
          ? { rate: 1, source: 'identity' as FxRateSource }
          : this.resolveRateFromSet(rateSet, upperSource);
      // A rate found in the live set is `live`; the reporting currency stays `identity`, and a
      // currency the set does not rate stays `missing` (counted at 1, which the caller must know).
      rateSource = resolved.source === 'snapshot' ? 'live' : resolved.source;
      if (resolved.source === 'missing') missingYears.add(item.fiscalYear);
      if (!opts?.quiet && resolved.source === 'missing' && upperSource !== reportingUpper) {
        this.logger.warn(
          `Missing FX rate for ${upperSource}->${reporting} ${item.fiscalYear} (tenant ${tenantId})`,
        );
      }
      result.set(item.key, {
        rate: resolved.rate,
        rateSetId: rateSet?.id ?? null,
        fiscalYear: item.fiscalYear,
        reportingCurrency: rateSet?.base_currency ?? reporting,
        source: rateSource,
        capturedAt: rateSet?.captured_at ?? null,
        via: null,
      });
    }

    this.reportMissingYears(tenantId, Array.from(missingYears));
    return { map: result, settings };
  }

  convertValue(amount: number, rate: number): number {
    if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return 0;
    const converted = amount * rate;
    return Math.round(converted * 100) / 100;
  }
}
