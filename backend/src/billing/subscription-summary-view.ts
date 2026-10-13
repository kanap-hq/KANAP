import type { PermissionLevel } from '../permissions/permissions.service';
import type { BillingService } from './billing.service';

export type SubscriptionSummary = Awaited<ReturnType<BillingService['getSubscriptionSummary']>>;

/**
 * The part of the subscription summary every signed-in user reads: the trial and freeze banners
 * and the redirect to billing (frontend `SubscriptionBanner`, `ProtectedRoute`). Amounts, payment
 * method, invoices and Stripe ids stay with the users who hold a billing permission.
 */
const SUBSCRIPTION_STATUS_FIELDS = ['status', 'trial_end', 'trial_days_remaining', 'is_subscription_healthy'] as const;

export type SubscriptionStatusView = Pick<SubscriptionSummary, (typeof SUBSCRIPTION_STATUS_FIELDS)[number]>;

export function subscriptionStatusView(summary: SubscriptionSummary): SubscriptionStatusView {
  return {
    status: summary.status,
    trial_end: summary.trial_end,
    trial_days_remaining: summary.trial_days_remaining,
    is_subscription_healthy: summary.is_subscription_healthy,
  };
}

/** The permission levels that grant billing access: any other value reads the status view. */
const BILLING_LEVELS: readonly PermissionLevel[] = ['reader', 'contributor', 'member', 'admin'];

/** The full summary with a billing permission (any level), the status view otherwise. */
export function subscriptionSummaryFor(
  summary: SubscriptionSummary,
  billingLevel: string | null | undefined,
): SubscriptionSummary | SubscriptionStatusView {
  return BILLING_LEVELS.includes(billingLevel as PermissionLevel) ? summary : subscriptionStatusView(summary);
}
