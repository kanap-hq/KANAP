import api from '../api';

/** Plan name of an internal tenant (demonstration, test). Mirrors the backend INTERNAL_PLAN_NAME. */
export const INTERNAL_PLAN_NAME = 'Internal';

/** Subscription statuses, as stored on the tenant's subscription. */
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
  'canceled',
  'incomplete',
  'incomplete_expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type TenantUserStats = {
  total: number;
  enabled: number;
};

export type TenantStats = {
  companies: number;
  headcount: number;
  departments: number;
  suppliers: number;
  opexEntries: number;
  capexEntries: number;
  users: TenantUserStats;
};

export type TenantPlan = {
  plan_name?: string | null;
  /** null means unlimited seats. */
  seat_limit: number | null;
  seats_used: number;
  active_seats?: number;
  subscription_type?: 'monthly' | 'annual';
  payment_mode?: 'card' | 'bank_transfer';
  next_payment_at?: string | null;
  status?: string | null;
  collection_method?: 'charge_automatically' | 'send_invoice' | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  trial_end?: string | null;
  cancel_at?: string | null;
  canceled_at?: string | null;
  currency?: string | null;
  amount?: number | null;
  amount_currency?: string | null;
  estimated_amount?: number | null;
  estimated_currency?: string | null;
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  default_payment_method_id?: string | null;
  default_payment_method_brand?: string | null;
  default_payment_method_last4?: string | null;
  latest_invoice_id?: string | null;
  latest_invoice_status?: string | null;
  latest_invoice_number?: string | null;
  latest_invoice_url?: string | null;
  latest_invoice_pdf?: string | null;
  latest_invoice_amount?: number | null;
  latest_invoice_currency?: string | null;
  latest_invoice_created?: string | null;
  days_until_due?: number | null;
  last_payment_error_code?: string | null;
  last_payment_error_message?: string | null;
  last_synced_at?: string | null;
  stripe_subscription_id?: string | null;
  canceled_at_effective?: string | null;
  stripe_customer_id?: string | null;
};

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'frozen' | 'deleting' | 'deleted';
  is_system_tenant?: boolean;
  frozen_at?: string | null;
  frozen_by?: string | null;
  deletion_requested_at?: string | null;
  deletion_requested_by?: string | null;
  deletion_confirmed_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  stats: TenantStats;
  plan: TenantPlan | null;
  stripe_customer_id?: string | null;
  billing_email?: string | null;
  billing_company_name?: string | null;
  billing_phone?: string | null;
  billing_tax_id?: string | null;
  billing_address?: Record<string, unknown> | null;
  billing_customer_info?: Record<string, unknown> | null;
  billing_invoice_info?: Record<string, unknown> | null;
};

export type TenantDetail = TenantSummary & {
  deletion_reason?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
};

export type TenantListResponse = {
  items: TenantSummary[];
  total: number;
  page: number;
  limit: number;
};

export async function listTenants(params: { page?: number; limit?: number; q?: string; status?: string } = {}) {
  const res = await api.get<TenantListResponse>('/admin/tenants', { params });
  return res.data;
}

export async function getTenant(id: string) {
  const res = await api.get<TenantDetail>(`/admin/tenants/${id}`);
  return res.data;
}

export async function updateTenantPlan(
  id: string,
  payload: Partial<{
    plan_name: string | null;
    seat_limit: number | null;
    active_seats: number;
    subscription_type: 'monthly' | 'annual';
    payment_mode: 'card' | 'bank_transfer';
    next_payment_at: string | null;
    status: SubscriptionStatus;
    trial_end: string | null;
    notes: string | null;
  }>,
) {
  const res = await api.patch<TenantDetail>(`/admin/tenants/${id}/plan`, payload);
  return res.data;
}

export async function markTenantInternal(id: string) {
  const res = await api.post<TenantDetail>(`/admin/tenants/${id}/mark-internal`);
  return res.data;
}

export async function freezeTenant(id: string, payload: { reason?: string }) {
  const res = await api.post<TenantDetail>(`/admin/tenants/${id}/freeze`, payload);
  return res.data;
}

export async function unfreezeTenant(id: string) {
  const res = await api.post<TenantDetail>(`/admin/tenants/${id}/unfreeze`);
  return res.data;
}

export async function deleteTenant(id: string, payload: { confirmSlug: string; reason?: string | null }) {
  const res = await api.post<{ tenant: TenantDetail; purgeReport: { table: string; deleted: number }[] }>(
    `/admin/tenants/${id}/delete`,
    payload,
  );
  return res.data;
}
