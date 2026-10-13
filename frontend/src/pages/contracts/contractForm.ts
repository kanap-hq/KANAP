import type { StatusValue } from '../../constants/status';

/** A contract as `GET /contracts/:id` returns it. */
export type ContractDetail = {
  id: string;
  name: string;
  status: string;
  disabled_at: string | null;
  company_id: string;
  supplier_id: string;
  owner_user_id: string | null;
  start_date: string;
  duration_months: number;
  auto_renewal: boolean;
  notice_period_months: number;
  yearly_amount_at_signature: string | number;
  currency: string;
  billing_frequency: BillingFrequency;
  notes: string | null;
  created_at: string;
  updated_at: string;
  supplier_name?: string | null;
  company_name?: string | null;
  owner_name?: string | null;
  term_index?: number;
  current_term_end?: string;
  next_cancellation_deadline?: string | null;
  links?: Array<{ id: string; description: string | null; url: string }>;
  attachments?: ContractAttachment[];
};

export type ContractAttachment = { id: string; original_filename: string; size?: number | null; uploaded_at?: string };

export const BILLING_FREQUENCIES = ['annual', 'quarterly', 'monthly', 'other'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

/** The fields a page edit sends (`PATCH /contracts/:id`). */
export type ContractPatch = Partial<{
  name: string;
  supplier_id: string;
  company_id: string;
  owner_user_id: string | null;
  start_date: string;
  duration_months: number;
  notice_period_months: number;
  auto_renewal: boolean;
  yearly_amount_at_signature: number;
  currency: string;
  billing_frequency: BillingFrequency;
  status: StatusValue;
  disabled_at: string | null;
  notes: string | null;
}>;

/** A whole number of months typed in a field; null when it is not one. */
export function parseMonths(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * An amount typed in a field, with at most two decimals: spaces and thousands separators are
 * dropped, the last `.` or `,` is the decimal mark. Null when it is not an amount.
 */
export function parseAmount(text: string): number | null {
  const compact = text.replace(/[\s  ']/g, '');
  if (!compact) return null;
  const lastMark = Math.max(compact.lastIndexOf('.'), compact.lastIndexOf(','));
  let normalized = compact;
  if (lastMark >= 0) {
    const decimals = compact.slice(lastMark + 1);
    const whole = compact.slice(0, lastMark).replace(/[.,]/g, '');
    // `1,000` or `1.000` with three digits after the only mark is a thousands separator.
    const onlyMark = compact.indexOf('.') === compact.lastIndexOf('.') && compact.indexOf(',') === compact.lastIndexOf(',')
      && (compact.indexOf('.') < 0 || compact.indexOf(',') < 0);
    normalized = onlyMark && decimals.length === 3 ? `${whole}${decimals}` : `${whole}.${decimals}`;
  }
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100) / 100;
}

export function formatAmount(value: number | string | null | undefined, locale: string): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '';
  // Whole amounts without decimals, the others with both (12,500.50).
  const decimals = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: 2 }).format(n);
}
