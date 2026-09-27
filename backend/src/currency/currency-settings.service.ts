import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { ISO_CURRENCIES } from './iso-currencies';
import { AuditService } from '../audit/audit.service';

export interface CurrencySettings {
  reportingCurrency: string;
  defaultSpendCurrency: string;
  defaultCapexCurrency: string;
  allowedCurrencies: string[] | null;
}

type MetadataShape = {
  reporting_currency?: string;
  default_spend_currency?: string;
  default_capex_currency?: string;
  allowed_currencies?: string[];
};

@Injectable()
export class CurrencySettingsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly audit: AuditService,
  ) {}

  async ensureCurrencyRecords(
    codes: Iterable<string>,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    const set = new Set(
      Array.from(codes)
        .map((code) => (typeof code === 'string' ? code.trim().toUpperCase() : ''))
        .filter((code) => code.length === 3),
    );
    if (set.size === 0) return;
    const manager = opts?.manager ?? this.tenants.manager;
    for (const code of set) {
      const name = ISO_CURRENCIES[code] ?? code;
      await manager.query(
        `INSERT INTO currencies(code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [code, name],
      );
    }
  }

  private normalizeCode(code?: string | null, fallback = 'EUR'): string {
    if (!code || typeof code !== 'string') return fallback;
    const trimmed = code.trim().toUpperCase();
    return trimmed.length === 3 ? trimmed : fallback;
  }

  private normalizeList(list?: string[] | null): string[] | null {
    if (!Array.isArray(list)) return null;
    const normalized = Array.from(
      new Set(
        list
          .map((code) => (typeof code === 'string' ? code.trim().toUpperCase() : ''))
          .filter((code) => code.length === 3),
      ),
    );
    return normalized.length ? normalized : null;
  }

  private repo(manager?: EntityManager) {
    return manager ? manager.getRepository(Tenant) : this.tenants;
  }

  async getSettings(tenantId: string, opts?: { manager?: EntityManager }): Promise<CurrencySettings> {
    const repo = this.repo(opts?.manager);
    const tenant = await repo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }
    const metadata = (tenant.metadata as MetadataShape | undefined) ?? {};
    const reportingCurrency = this.normalizeCode(metadata.reporting_currency);
    const defaultSpendCurrency = this.normalizeCode(metadata.default_spend_currency, reportingCurrency);
    const defaultCapexCurrency = this.normalizeCode(metadata.default_capex_currency, reportingCurrency);
    const allowedCurrencies = this.normalizeList(metadata.allowed_currencies);
    await this.ensureCurrencyRecords(
      [reportingCurrency, defaultSpendCurrency, defaultCapexCurrency, ...(allowedCurrencies ?? [])],
      { manager: repo.manager },
    );
    return { reportingCurrency, defaultSpendCurrency, defaultCapexCurrency, allowedCurrencies };
  }

  async updateSettings(
    tenantId: string,
    patch: Partial<CurrencySettings>,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<CurrencySettings> {
    const repo = this.repo(opts?.manager);
    // The whole metadata object is saved below: lock the row first so a
    // concurrent writer of another key is not erased by a stale copy.
    await repo.manager.query('SELECT id FROM tenants WHERE id = $1 FOR NO KEY UPDATE', [tenantId]);
    const tenant = await repo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }
    const beforeSettings = await this.getSettings(tenantId, opts);

    const existing = (tenant.metadata as MetadataShape | undefined) ?? {};
    const merged: MetadataShape = { ...existing };

    if (patch.reportingCurrency) {
      merged.reporting_currency = this.normalizeCode(patch.reportingCurrency);
    }

    if (patch.defaultSpendCurrency) {
      const normalized = this.normalizeCode(patch.defaultSpendCurrency, merged.reporting_currency);
      merged.default_spend_currency = normalized;
    }

    if (patch.defaultCapexCurrency) {
      const normalized = this.normalizeCode(patch.defaultCapexCurrency, merged.reporting_currency);
      merged.default_capex_currency = normalized;
    }

    if (patch.allowedCurrencies !== undefined) {
      const normalized = this.normalizeList(patch.allowedCurrencies);
      if (normalized && normalized.length) {
        merged.allowed_currencies = normalized;
      } else {
        delete merged.allowed_currencies;
      }
    }

    const finalReporting = this.normalizeCode(merged.reporting_currency, 'EUR');
    const finalDefaultSpend = this.normalizeCode(merged.default_spend_currency, finalReporting);
    const finalDefaultCapex = this.normalizeCode(merged.default_capex_currency, finalReporting);
    if (merged.allowed_currencies && merged.allowed_currencies.length) {
      const allowedSet = new Set(
        merged.allowed_currencies.map((code) => this.normalizeCode(code, finalReporting)),
      );
      allowedSet.add(finalReporting);
      allowedSet.add(finalDefaultSpend);
      allowedSet.add(finalDefaultCapex);
      merged.allowed_currencies = Array.from(allowedSet);
    }

    tenant.metadata = merged;
    await this.ensureCurrencyRecords(
      [
        finalReporting,
        finalDefaultSpend,
        finalDefaultCapex,
        ...((merged.allowed_currencies ?? []).map((code) => code.trim().toUpperCase())),
      ],
      { manager: repo.manager },
    );

    await repo.save(tenant);

    const nextSettings = await this.getSettings(tenantId, opts);
    if (JSON.stringify(beforeSettings) !== JSON.stringify(nextSettings)) {
      await this.audit.log(
        {
          table: 'tenants',
          recordId: tenantId,
          action: 'update',
          before: beforeSettings,
          after: nextSettings,
          userId: userId ?? null,
        },
        { manager: opts?.manager ?? repo.manager },
      );
    }

    return nextSettings;
  }
}
