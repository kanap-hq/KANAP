import api from '../api';

type BillingAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type BillingContact = {
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  address: BillingAddress;
};


export type BillingInvoice = {
  id: string;
  number: string | null;
  status: string | null;
  total: number | null;
  currency: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  createdAt: string | null;
};
export type BillingSubscription = {
  plan_name?: string | null;
  seat_limit: number | null;
  seats_used: number;
  subscription_type?: 'monthly' | 'annual';
  payment_mode?: 'card' | 'bank_transfer';
  next_payment_at?: string | null;
  status?: string | null;
  renewal_at?: string | null;
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
  is_subscription_healthy?: boolean;
  trial_days_remaining?: number | null;
  payment_due_at?: string | null;
  freeze_effective_at?: string | null;
};

export type BillingProfileResponse = {
  subscription: BillingSubscription;
  customer: BillingContact;
  invoice: BillingContact;
  /** Invoice fields still needed before subscribing (`company`, `email`, `addressLine1`, ...). */
  invoice_missing_fields?: string[];
  invoices: BillingInvoice[];
};

export type BillingProfileUpdateResponse = {
  customer: BillingContact;
  invoice: BillingContact;
  invoice_missing_fields?: string[];
  invoices: BillingInvoice[];
};

export async function getBillingProfile() {
  const res = await api.get<BillingProfileResponse>('/billing/profile');
  return res.data;
}

export async function updateBillingProfile(payload: {
  customer: Partial<BillingContact>;
  invoice: Partial<BillingContact>;
}) {
  const res = await api.patch<BillingProfileUpdateResponse>('/billing/profile', payload);
  return res.data;
}
