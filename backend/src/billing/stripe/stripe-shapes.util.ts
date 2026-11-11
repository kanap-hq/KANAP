/**
 * Readers for Stripe fields that moved between API versions. The client and the webhook
 * endpoint may run different versions (2023-10-16 or 2025-03-31.basil and later), so
 * each reader accepts both shapes. A refused payment is on the invoice's PaymentIntent in
 * both: never on the invoice itself.
 */

type StripeTimestamp = number;

function timestamp(value: any): StripeTimestamp | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function idOf(value: any): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  return null;
}

/**
 * The current billing period, as Stripe timestamps (seconds). Top level before basil;
 * since basil on each subscription item (KANAP has one: with several, the item whose
 * period ends first). Both null when the payload carries no period.
 */
export function subscriptionPeriod(sub: any): { start: StripeTimestamp | null; end: StripeTimestamp | null } {
  const start = timestamp(sub?.current_period_start);
  const end = timestamp(sub?.current_period_end);
  if (start != null || end != null) return { start, end };

  const items: any[] = Array.isArray(sub?.items?.data) ? sub.items.data : [];
  let chosen: { start: StripeTimestamp | null; end: StripeTimestamp | null } = { start: null, end: null };
  for (const item of items) {
    const itemEnd = timestamp(item?.current_period_end);
    if (itemEnd == null) continue;
    if (chosen.end == null || itemEnd < chosen.end) {
      chosen = { start: timestamp(item?.current_period_start), end: itemEnd };
    }
  }
  return chosen;
}

/**
 * When a subscription whose cancellation is set ends, else null: `cancel_at` (the customer
 * portal sets it since basil, with `cancel_at_period_end` false), else the end of the current
 * period for `cancel_at_period_end`. A payload with the flag but no period keeps `stored`.
 * The webhook and the refresh from Stripe both write `canceled_at_effective` with it.
 */
export function cancellationEffectiveAt(sub: any, stored: Date | null): Date | null {
  const cancelAt = timestamp(sub?.cancel_at);
  if (cancelAt != null) return new Date(cancelAt * 1000);
  if (!sub?.cancel_at_period_end) return null;
  const end = subscriptionPeriod(sub).end;
  return end != null ? new Date(end * 1000) : stored;
}

/**
 * The payment term of an invoice (`days_until_due`) as Stripe sends it: null for a card
 * subscription. A payload without the field keeps `stored`.
 */
export function subscriptionDaysUntilDue(sub: any, stored: number | null): number | null {
  const value = sub?.days_until_due;
  if (typeof value === 'number') return value;
  if (value === null) return null;
  return stored;
}

/**
 * The subscription an invoice bills: `invoice.subscription` before basil, then
 * `invoice.parent.subscription_details.subscription`, else the first line's
 * subscription item details.
 */
export function invoiceSubscriptionId(inv: any): string | null {
  return idOf(inv?.subscription)
    ?? idOf(inv?.parent?.subscription_details?.subscription)
    ?? idOf(inv?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription);
}

/** The refusal of a payment: the code, the message, and the payment method that was refused. */
export type PaymentFailure = { code: string | null; message: string | null; paymentMethodId: string | null };

/**
 * The refusal a PaymentIntent carries (`last_payment_error`), else null. The code is the bank's
 * `decline_code` when there is one (`insufficient_funds`), else the error `code` (`expired_card`).
 */
export function paymentIntentFailure(paymentIntent: any): PaymentFailure | null {
  const error = paymentIntent?.last_payment_error;
  if (!error || typeof error !== 'object') return null;
  const code = error.decline_code || error.code || null;
  const message = error.message || null;
  if (!code && !message) return null;
  return { code, message, paymentMethodId: idOf(error.payment_method) };
}

/**
 * What to expand on `invoices.retrieve` to read the invoice's PaymentIntents: its payments since
 * basil (2025-03-31), its `payment_intent` before. An unknown version is taken as a recent one.
 */
export function invoicePaymentIntentsExpand(apiVersion: string | null | undefined): string {
  return apiVersion && apiVersion < '2025-03-31' ? 'payment_intent' : 'payments.data.payment.payment_intent';
}

/** The PaymentIntents of an invoice, expanded or not, the latest payment first. */
function invoicePaymentIntents(invoice: any): any[] {
  const payments: any[] = Array.isArray(invoice?.payments?.data) ? [...invoice.payments.data] : [];
  payments.sort((a, b) => (timestamp(b?.created) ?? 0) - (timestamp(a?.created) ?? 0));
  const intents = payments.map((payment) => payment?.payment?.payment_intent).filter(Boolean);
  if (invoice?.payment_intent) intents.push(invoice.payment_intent);
  return intents;
}

/** Whether `paymentIntentId` is one of the invoice's PaymentIntents. */
export function invoiceHasPaymentIntent(invoice: any, paymentIntentId: string): boolean {
  return invoicePaymentIntents(invoice).some((intent) => idOf(intent) === paymentIntentId);
}

/** The latest refusal on the invoice's PaymentIntents (they must be expanded), else null. */
export function invoicePaymentFailure(invoice: any): PaymentFailure | null {
  for (const intent of invoicePaymentIntents(invoice)) {
    const failure = typeof intent === 'object' ? paymentIntentFailure(intent) : null;
    if (failure) return failure;
  }
  return null;
}

/** The subscription quantity: top level, else the first item's. */
export function subscriptionQuantity(sub: any): number | null {
  if (typeof sub?.quantity === 'number') return sub.quantity;
  const itemQuantity = sub?.items?.data?.[0]?.quantity;
  return typeof itemQuantity === 'number' ? itemQuantity : null;
}
