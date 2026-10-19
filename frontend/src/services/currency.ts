import api from '../api';

export type CurrencySettings = {
  reportingCurrency: string;
  defaultSpendCurrency: string;
  defaultCapexCurrency: string;
  allowedCurrencies: string[] | null;
};

/** One currency and year that still has no usable rate after a sync. */
export type MissingRatePair = {
  currency: string;
  year: number;
};

/** `POST /currency/rates/refresh` once the fetch has finished, and the same block on a reporting-currency save. */
export type RateSyncCompleted = {
  completed: true;
  years: number[];
  fetched: number;
  stillMissing: MissingRatePair[];
};

/** The same endpoints when the fetch is still running. There is no `queued` flag. */
export type RateSyncPending = {
  completed: false;
  years: number[];
};

export type RateSyncOutcome = RateSyncCompleted | RateSyncPending;

export type RefreshCurrencyRatesResponse = RateSyncOutcome & { ok: true };

export function isRateSyncOutcome(value: object): value is RateSyncOutcome {
  return typeof (value as { completed?: unknown }).completed === 'boolean';
}

export async function fetchCurrencySettings(): Promise<CurrencySettings> {
  const res = await api.get('/currency/settings');
  return res.data as CurrencySettings;
}

export async function updateCurrencySettings(payload: Partial<CurrencySettings>): Promise<CurrencySettings> {
  const res = await api.patch('/currency/settings', payload);
  return res.data as CurrencySettings;
}

export async function refreshCurrencyRates(payload?: { years?: number[]; year?: number }): Promise<RefreshCurrencyRatesResponse> {
  const res = await api.post('/currency/rates/refresh', payload ?? {});
  return res.data as RefreshCurrencyRatesResponse;
}

/** Latest rate set of one fiscal year, in the reporting currency. */
export type CurrencyRateRow = {
  fiscalYear: number;
  baseCurrency: string;
  rates: Record<string, number | null>;
  /** Per currency: `world-bank-annual`, `exchangerateapi-spot`, `world-bank-forward`, `estimate`, `identity` or `manual`. */
  rateSources: Record<string, string>;
  capturedAt: string | null;
  source: string | null;
};

/**
 * `GET /currency/rates`. `currencies` is the row order (reporting currency first).
 * `rates` holds one set per year, and only for that reporting currency.
 */
export type CurrencyRateMatrix = {
  currencies: string[];
  rates: CurrencyRateRow[];
};

export type ManualRateInput = {
  currency: string;
  year: number;
  rate: number;
};

export type ManualRateResult = CurrencyRateRow & {
  /** Frozen budget versions of that year. They keep the rate from when they were frozen. */
  frozenVersions: number;
};

export type RemoveManualRateResult = {
  ok: boolean;
  refreshQueued: boolean;
  frozenVersions: number;
};

export async function fetchCurrencyRates(): Promise<CurrencyRateMatrix> {
  const res = await api.get<CurrencyRateMatrix>('/currency/rates');
  const data = res.data;
  return {
    currencies: Array.isArray(data?.currencies)
      ? data.currencies.map((code) => String(code ?? '').trim().toUpperCase()).filter((code) => code.length > 0)
      : [],
    rates: Array.isArray(data?.rates) ? data.rates : [],
  };
}

/** Currency and year pairs in use that have no rate. */
export async function fetchMissingRates(): Promise<MissingRatePair[]> {
  const res = await api.get<{ items?: MissingRatePair[] }>('/currency/rates/missing');
  return (res.data?.items ?? []).map((item) => ({
    currency: String(item.currency ?? '').trim().toUpperCase(),
    year: Number(item.year),
  }));
}

/** Stores a manual rate. It wins over the automatic sources until it is removed. */
export async function setManualRate(payload: ManualRateInput): Promise<ManualRateResult> {
  const res = await api.put<ManualRateResult>('/currency/rates/manual', payload);
  return res.data;
}

/** Removes a manual rate. The automatic rate is fetched again in the background. */
export async function removeManualRate(year: number, currency: string): Promise<RemoveManualRateResult> {
  const res = await api.delete<RemoveManualRateResult>(
    `/currency/rates/manual/${year}/${encodeURIComponent(currency)}`,
  );
  return res.data;
}
