/** Domains that deliver to one mailbox whatever the dots in the local part. */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The billing address as the support invoice budget counts it (`RATE_LIMITS.publicSupportInvoiceBillingEmail`):
 * the forms of one mailbox share one budget. Lower case, without spaces, without quotes around the
 * local part, without a `+tag`; for Gmail, without dots in the local part and with one domain.
 * Only the count reads it: the invoice goes to the address as typed.
 */
export function billingEmailRateLimitKey(email: string): string {
  const compact = String(email ?? '').replace(/\s+/g, '').toLowerCase();
  const at = compact.lastIndexOf('@');
  if (at < 0) return compact;
  let local = compact.slice(0, at);
  let domain = compact.slice(at + 1);
  if (local.length >= 2 && local.startsWith('"') && local.endsWith('"')) local = local.slice(1, -1);
  local = local.split('+')[0];
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
