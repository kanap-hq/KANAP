import { StripeConfigService } from './stripe/stripe.config';

export type PlanKey = 'max';
export type IntervalKey = 'monthly' | 'annual';

export const TRIAL_PERIOD_DAYS = 14;
export const FREEZE_GRACE_DAYS = 14;
export const HEALTHY_STATUSES = ['active', 'trialing'] as const;
export const BANK_TRANSFER_MIN_AMOUNT_EUR_CENTS = 100000;
/** Stripe quantity of every cloud subscription: one subscription covers all users. */
export const CLOUD_SUBSCRIPTION_QUANTITY = 1;

/**
 * Plan name of an internal tenant (demonstration, test): active, unlimited seats,
 * no Stripe subscription and no money flow. Set by a platform administrator through
 * `POST /admin/tenants/:id/mark-internal`. Commercial indicators leave these tenants out.
 */
export const INTERNAL_PLAN_NAME = 'Internal';

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
  max: { key: 'max', displayName: 'Hosted KANAP', seatLimit: null, invoiceEligible: true, prices: { monthly: 24900, annual: 249000 } },
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

/** Map a stored plan name (display name or plan key) back to a PlanKey. */
export function resolvePlanKeyFromLegacyName(name: string | null | undefined): PlanKey | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (lower === 'hosted kanap') return 'max';
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

export function isBankTransferEligibleAmount(amountCents: number): boolean {
  return amountCents > BANK_TRANSFER_MIN_AMOUNT_EUR_CENTS;
}

export function isBankTransferEligible(planKey: PlanKey, interval: IntervalKey): boolean {
  const plan = PLANS[planKey];
  if (!plan) return false;
  return isBankTransferEligibleAmount(plan.prices[interval]);
}
