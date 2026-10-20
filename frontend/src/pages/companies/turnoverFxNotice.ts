import type { TFunction } from 'i18next';

/** One currency and year left out of the companies' turnover total (`companies` is how many). */
export type CompanyTurnoverFxMissing = { currency: string; year: number; companies: number };

/** The pairs a totals answer named. A string list is the old shape and carries no year. */
export function companyTurnoverFxMissing(value: unknown): CompanyTurnoverFxMissing[] {
  if (!Array.isArray(value)) return [];
  const pairs: CompanyTurnoverFxMissing[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { currency?: unknown; year?: unknown; companies?: unknown };
    const currency = typeof row.currency === 'string' ? row.currency.trim() : '';
    const year = Number(row.year);
    const companies = Number(row.companies);
    if (!currency || !Number.isInteger(year) || !Number.isFinite(companies) || companies < 1) continue;
    pairs.push({ currency, year, companies });
  }
  return pairs;
}

/** « Chiffre d'affaires sans taux de change exclu du total : ZAR 2026 (1 société). » */
export function companyTurnoverFxNotice(t: TFunction, items: ReadonlyArray<CompanyTurnoverFxMissing>): string {
  const pairs = items.map((item) => t('master-data:companies.turnoverFxExcludedPair', {
    count: item.companies,
    currency: item.currency,
    year: item.year,
  })).join(', ');
  return t('master-data:companies.turnoverFxExcluded', { pairs });
}
