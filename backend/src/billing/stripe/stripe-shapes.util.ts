/**
 * Readers for Stripe fields that moved between API versions. The client and the webhook
 * endpoint may run different versions (2023-10-16 or 2025-03-31.basil and later), so
 * each reader accepts both shapes.
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
 * The subscription an invoice bills: `invoice.subscription` before basil, then
 * `invoice.parent.subscription_details.subscription`, else the first line's
 * subscription item details.
 */
export function invoiceSubscriptionId(inv: any): string | null {
  return idOf(inv?.subscription)
    ?? idOf(inv?.parent?.subscription_details?.subscription)
    ?? idOf(inv?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription);
}

/** The subscription quantity: top level, else the first item's. */
export function subscriptionQuantity(sub: any): number | null {
  if (typeof sub?.quantity === 'number') return sub.quantity;
  const itemQuantity = sub?.items?.data?.[0]?.quantity;
  return typeof itemQuantity === 'number' ? itemQuantity : null;
}
