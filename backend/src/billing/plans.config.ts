import { PRODUCT_NAME } from '../config/product';
import { StripeConfigService } from './stripe/stripe.config';

export type PlanKey = 'max';
export type IntervalKey = 'monthly' | 'annual';

export const TRIAL_PERIOD_DAYS = 14;

/**
 * When a trial started at `signupAt` ends: 23:59:59.999 UTC on the day
 * `TRIAL_PERIOD_DAYS` after the sign-up's UTC day. The days left round up, so
 * the last day counts in full whatever the hour of sign-up. Admin extensions
 * and the Stripe subscription keep the instant they write themselves.
 */
export function trialEndFromSignup(signupAt: Date): Date {
  return new Date(Date.UTC(
    signupAt.getUTCFullYear(),
    signupAt.getUTCMonth(),
    signupAt.getUTCDate() + TRIAL_PERIOD_DAYS,
    23, 59, 59, 999,
  ));
}

export const FREEZE_GRACE_DAYS = 14;
/** Days a workspace whose trial ended without a subscription is kept before it is deleted. */
export const TRIAL_WORKSPACE_RETENTION_DAYS = 30;
export const HEALTHY_STATUSES = ['active', 'trialing'] as const;
export const BANK_TRANSFER_MIN_AMOUNT_EUR_CENTS = 100000;
/**
 * Days a customer has to pay an invoice by bank transfer (Stripe `days_until_due`). Must match
 * art. 5.4 of the general terms of sale (`sales` in marketing/web/src/content/legal/{fr,en}.ts).
 */
export const INVOICE_PAYMENT_TERM_DAYS = 30;
/** Stripe quantity of every cloud subscription: one subscription covers all users. */
export const CLOUD_SUBSCRIPTION_QUANTITY = 1;

/**
 * Plan name of an internal tenant (demonstration, test): active, unlimited seats,
 * no Stripe subscription and no money flow. Set by a platform administrator through
 * `POST /admin/tenants/:id/mark-internal`. Commercial indicators leave these tenants out.
 */
export const INTERNAL_PLAN_NAME = 'Internal';
/** Plan name of a trial subscription, as activation writes it. Only such a plan is ever deleted at the end of a trial. */
export const TRIAL_PLAN_NAME = 'Trial';

export interface PlanPrices {
  monthly: number; // EUR cents
  annual: number;  // EUR cents
}

export interface PlanDef {
  key: PlanKey;
  displayName: string;
  seatLimit: number | null;
  invoiceEligible: boolean;
  prices: PlanPrices;
}

export const PLANS: Record<PlanKey, PlanDef> = {
  max: { key: 'max', displayName: `Hosted ${PRODUCT_NAME}`, seatLimit: null, invoiceEligible: true, prices: { monthly: 24900, annual: 249000 } },
};

/** Map new env-var price IDs back to a PlanKey. */
export function resolvePlanKeyFromPriceId(priceId: string): PlanKey | null {
  for (const plan of Object.values(PLANS)) {
    for (const interval of ['monthly', 'annual'] as IntervalKey[]) {
      const envKey = `STRIPE_PRICE_${plan.key.toUpperCase()}_${interval.toUpperCase()}`;
      const envVal = (process.env as Record<string, string | undefined>)[envKey]?.trim();
      if (envVal && envVal === priceId) return plan.key;
    }
  }
  return null;
}

/** Plan name stored by versions before the product name became a constant (`subscriptions.plan_name`). */
const LEGACY_PLAN_NAMES: Record<string, PlanKey> = { 'hosted kanap': 'max' };

/**
 * Map a stored plan name (display name, legacy display name or plan key) back to a PlanKey. A
 * subscription keeps the display name of the version that wrote it: the current and the legacy
 * names both resolve, so a product rename needs no data migration.
 */
export function resolvePlanKeyFromLegacyName(name: string | null | undefined): PlanKey | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (lower in LEGACY_PLAN_NAMES) return LEGACY_PLAN_NAMES[lower];
  for (const plan of Object.values(PLANS)) {
    if (plan.displayName.toLowerCase() === lower) return plan.key;
  }
  // Direct match
  if (lower in PLANS) return lower as PlanKey;
  return null;
}

export function getPriceId(config: StripeConfigService, interval: IntervalKey, planKey: PlanKey): string | null {
  return config.getPriceId(interval, planKey);
}

export function toPlanDisplayName(planKey: PlanKey): string {
  return PLANS[planKey]?.displayName ?? planKey;
}

/**
 * The plan name people see for a stored `subscriptions.plan_name`: the current display name of its
 * plan when it resolves to one, else the stored text (Trial, On-Prem, Internal, a Stripe nickname).
 */
export function planNameForDisplay(name: string | null | undefined): string | null {
  const planKey = resolvePlanKeyFromLegacyName(name);
  return planKey ? toPlanDisplayName(planKey) : (name ?? null);
}

export function isBankTransferEligibleAmount(amountCents: number): boolean {
  return amountCents > BANK_TRANSFER_MIN_AMOUNT_EUR_CENTS;
}

export function isBankTransferEligible(planKey: PlanKey, interval: IntervalKey): boolean {
  const plan = PLANS[planKey];
  if (!plan) return false;
  return isBankTransferEligibleAmount(plan.prices[interval]);
}
