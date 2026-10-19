import api from '../api';

export type CurrencySettings = {
  reportingCurrency: string;
  defaultSpendCurrency: string;
  defaultCapexCurrency: string;
  allowedCurrencies: string[] | null;
};

export type RefreshCurrencyRatesResponse = {
  ok: boolean;
  queued: boolean;
  alreadyQueued: boolean;
  years: number[];
};

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
  capturedAt: string;
  source: string;
};

export type MissingRatePair = {
  currency: string;
  year: number;
};

export type ManualRateInput = {
  currency: string;
  year: number;
  rate: number;
};

export type RemoveManualRateResult = {
  ok: boolean;
  refreshQueued: boolean;
};

export async function fetchCurrencyRates(): Promise<CurrencyRateRow[]> {
  const res = await api.get<CurrencyRateRow[]>('/currency/rates');
  return res.data;
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
export async function setManualRate(payload: ManualRateInput): Promise<CurrencyRateRow> {
  const res = await api.put<CurrencyRateRow>('/currency/rates/manual', payload);
  return res.data;
}

/** Removes a manual rate. The automatic rate is fetched again in the background. */
export async function removeManualRate(year: number, currency: string): Promise<RemoveManualRateResult> {
  const res = await api.delete<RemoveManualRateResult>(
    `/currency/rates/manual/${year}/${encodeURIComponent(currency)}`,
  );
  return res.data;
}
