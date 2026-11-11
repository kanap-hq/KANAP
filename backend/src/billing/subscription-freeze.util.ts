import { CollectionMethod, Subscription, SubscriptionStatus } from './subscription.entity';
import { FREEZE_GRACE_DAYS, TRIAL_PLAN_NAME, TRIAL_WORKSPACE_RETENTION_DAYS } from './plans.config';

const GRACE_MS = FREEZE_GRACE_DAYS * 86400000;
const TRIAL_RETENTION_MS = TRIAL_WORKSPACE_RETENTION_DAYS * 86400000;

/**
 * When the grace of an unpaid invoice ends: FREEZE_GRACE_DAYS after the invoice for a card, after
 * its due date (invoice date plus the payment term) for a bank transfer. The invoice date is the
 * later of the latest invoice's and the start of the current period (the renewal that issued
 * it): the same date when the row is current, and the unpaid renewal's when the row still holds
 * the previous, paid invoice. Stripe opens the next period even unpaid, so its end says nothing
 * of the debt. Null without either date (treated as frozen by evaluateSubscriptionAccess).
 */
export function computeFreezeEffectiveAt(subscription: Subscription): number | null {
  const dates = [subscription.latest_invoice_created, subscription.current_period_start]
    .map((date) => (date ? new Date(date).getTime() : NaN))
    .filter((time) => Number.isFinite(time));
  if (!dates.length) return null;
  const invoicedAt = Math.max(...dates);
  const termDays = subscription.collection_method === CollectionMethod.SEND_INVOICE ? subscription.days_until_due ?? 0 : 0;
  return invoicedAt + termDays * 86400000 + GRACE_MS;
}

/**
 * The freeze date of the subscription summary (`freeze_effective_at`), from the one freeze rule:
 * a subscription freezes at status unpaid or canceled, or at the end of the grace of its unpaid
 * invoice (computeFreezeEffectiveAt), whichever comes first. Past due: the end of the grace, ahead
 * or passed. Canceled: its end, or the end of the grace of an invoice left open when earlier.
 * Unpaid: the end of the grace once passed (when Stripe set the status is not stored), else null.
 * Null for any other subscription.
 */
export function computeFreezeDate(subscription: Subscription, now: number): number | null {
  switch (subscription.status) {
    case SubscriptionStatus.PAST_DUE:
      return computeFreezeEffectiveAt(subscription);
    case SubscriptionStatus.UNPAID: {
      const graceEnd = computeFreezeEffectiveAt(subscription);
      return graceEnd != null && graceEnd <= now ? graceEnd : null;
    }
    case SubscriptionStatus.CANCELED: {
      const endedAt = (subscription.canceled_at_effective ?? subscription.canceled_at)?.getTime() ?? null;
      const invoiceLeftOpen = subscription.latest_invoice_status === 'open' || subscription.latest_invoice_status === 'uncollectible';
      const graceEnd = invoiceLeftOpen ? computeFreezeEffectiveAt(subscription) : null;
      const dates = [endedAt, graceEnd].filter((date): date is number => date != null);
      return dates.length ? Math.min(...dates) : null;
    }
    default:
      return null;
  }
}

export type SubscriptionAccessDecision = {
  allowed: boolean;
  /** Set only when allowed is false. */
  reason?: 'TRIAL_EXPIRED' | 'SUBSCRIPTION_FROZEN';
  /** Set only when allowed is false. */
  message?: string;
};

/**
 * Single source of truth for "is this tenant's subscription in good enough
 * standing to keep using paid capability?". Used both by the generic write
 * freeze in PermissionGuard and by the AI/agent gates in AiPolicyService.
 *
 * `stripeConfigured` is the on-prem / single-tenant escape hatch: when billing
 * isn't configured there is no subscription to enforce, so everything is allowed.
 */
export function evaluateSubscriptionAccess(
  subscription: Subscription | null,
  now: number,
  stripeConfigured: boolean,
): SubscriptionAccessDecision {
  if (!stripeConfigured) {
    return { allowed: true };
  }

  if (!subscription) {
    return { allowed: false, reason: 'SUBSCRIPTION_FROZEN', message: 'No active subscription found.' };
  }

  switch (subscription.status) {
    case SubscriptionStatus.TRIALING:
      if (subscription.trial_end && subscription.trial_end.getTime() > now) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'TRIAL_EXPIRED',
        message: 'Your trial has expired. Please choose a plan to continue.',
      };

    case SubscriptionStatus.ACTIVE:
      return { allowed: true };

    case SubscriptionStatus.PAST_DUE: {
      const freezeEffectiveAt = computeFreezeEffectiveAt(subscription);
      if (freezeEffectiveAt && now < freezeEffectiveAt) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'SUBSCRIPTION_FROZEN',
        message: 'Your subscription is frozen due to an overdue payment.',
      };
    }

    default:
      return { allowed: false, reason: 'SUBSCRIPTION_FROZEN', message: 'Your subscription is not active.' };
  }
}

/**
 * The trial runs: status trialing with a trial end still ahead. A workspace whose trial ended,
 * subscribed or not, has none.
 */
export function isTrialRunning(subscription: Pick<Subscription, 'status' | 'trial_end'> | null, now: number): boolean {
  return subscription?.status === SubscriptionStatus.TRIALING && !!subscription.trial_end && subscription.trial_end.getTime() > now;
}

/**
 * Single source of truth for "when is this workspace deleted for a trial that ended without a
 * subscription?": the trial end plus TRIAL_WORKSPACE_RETENTION_DAYS. Read by the daily deletion
 * task (TrialWorkspaceExpiryService), the subscription summary (`trial_deletion_at`) and the
 * trial emails.
 *
 * Only a trial that never became anything else has one: status trialing, a trial end, the
 * trial plan name, and no trace of a subscription (Stripe subscription, invoice, period, cancel
 * date). A tenant that subscribed, even long ended, and a tenant a platform administrator
 * activated (internal tenant, or a plan set by hand: another status or plan name) have none.
 * A trial end moved forward moves the date with it.
 *
 * `billingEnforced` is the on-premise escape hatch of `evaluateSubscriptionAccess`: no billing,
 * no trial lock, no deletion. Pass `!Features.SINGLE_TENANT && stripeConfig.isConfigured()`.
 */
export function computeTrialDeletionAt(
  subscription: Pick<
    Subscription,
    'status' | 'trial_end' | 'plan_name' | 'stripe_subscription_id' | 'latest_invoice_id' | 'current_period_end' | 'canceled_at'
  > | null,
  billingEnforced: boolean,
): Date | null {
  if (!billingEnforced || !subscription || !subscription.trial_end) return null;
  if (subscription.status !== SubscriptionStatus.TRIALING) return null;
  if ((subscription.plan_name ?? TRIAL_PLAN_NAME) !== TRIAL_PLAN_NAME) return null;
  const subscribedOnce = subscription.stripe_subscription_id
    || subscription.latest_invoice_id
    || subscription.current_period_end
    || subscription.canceled_at;
  if (subscribedOnce) return null;
  return new Date(subscription.trial_end.getTime() + TRIAL_RETENTION_MS);
}
