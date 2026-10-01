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
  reportingCurrency: string;
  source: FxRateSource;
  capturedAt: Date | null;
}

export interface FxLookupKey {
  key: string;
  rateSetId: string | null;
  fiscalYear: number;
  sourceCurrency: string;
}

function makeKey(rateSetId: string | null, fiscalYear: number, sourceCurrency: string): string {
  return `${rateSetId || 'live'}:${fiscalYear}:${sourceCurrency.toUpperCase()}`;
}

@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);

  constructor(
    @InjectRepository(CurrencyRateSet)
    private readonly rateSets: Repository<CurrencyRateSet>,
    private readonly currencySettings: CurrencySettingsService,
  ) {}

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

  async resolveRates(
    tenantId: string,
    lookups: FxLookupKey[],
    opts?: { manager?: EntityManager },
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
      let rateSet: CurrencyRateSet | null = null;
      let rateSource: FxRateSource = 'missing';

      if (item.rateSetId) {
        rateSet = snapshotById.get(item.rateSetId) ?? null;
        const resolved = this.resolveRateFromSet(rateSet, upperSource);
        rateSource = resolved.source === 'snapshot' ? 'snapshot' : resolved.source;
        if (resolved.source === 'missing' || resolved.rate <= 0) {
          rateSet = null; // fall back to live
        } else {
          result.set(item.key, {
            rate: resolved.rate,
            rateSetId: rateSet?.id ?? null,
            fiscalYear: item.fiscalYear,
            reportingCurrency: rateSet?.base_currency ?? settings.reportingCurrency,
            source: rateSource,
            capturedAt: rateSet?.captured_at ?? null,
          });
          continue;
        }
      }

      // fallback to latest live set
      rateSet = await latestLiveSet(item.fiscalYear);
      const resolved = rateSet
        ? this.resolveRateFromSet(rateSet, upperSource)
        : upperSource === settings.reportingCurrency.toUpperCase()
          ? { rate: 1, source: 'identity' as FxRateSource }
          : this.resolveRateFromSet(rateSet, upperSource);
      rateSource = rateSet ? 'live' : resolved.source;
      if (resolved.source === 'missing' && upperSource !== settings.reportingCurrency.toUpperCase()) {
        this.logger.warn(
          `Missing FX rate for ${upperSource}->${settings.reportingCurrency} ${item.fiscalYear} (tenant ${tenantId})`,
        );
      }
      result.set(item.key, {
        rate: resolved.rate,
        rateSetId: rateSet?.id ?? null,
        fiscalYear: item.fiscalYear,
        reportingCurrency: rateSet?.base_currency ?? settings.reportingCurrency,
        source: rateSource,
        capturedAt: rateSet?.captured_at ?? null,
      });
    }

    return { map: result, settings };
  }

  convertValue(amount: number, rate: number): number {
    if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return 0;
    const converted = amount * rate;
    return Math.round(converted * 100) / 100;
  }
}
