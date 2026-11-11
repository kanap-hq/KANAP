import React from 'react';
import { Alert, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTranslation } from 'react-i18next';
import { useFeatures } from '../config/FeaturesContext';
import { useLocale } from '../i18n/useLocale';
import { formatShortDate } from '../lib/dateFormat';

/** "€249.00" from an amount in cents, or null without one. */
function formatAmount(locale: string, cents?: number | null, currency?: string | null): string | null {
  if (cents == null || !currency) return null;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${cents / 100} ${currency.toUpperCase()}`;
  }
}

// Rendered by Layout between the app bar spacer and the page scroller, so it stays put
// while the page scrolls and does not push a full-height workspace past the viewport.
// The scroller's own top padding gives the gap below it.
const bannerSx = { mx: 2, mt: 2, flexShrink: 0 } as const;

export default function SubscriptionBanner() {
  const { t } = useTranslation('common');
  const locale = useLocale();
  const { subscription, claims } = useAuth();
  const navigate = useNavigate();
  const { config, isLoading: featuresLoading } = useFeatures();
  const isBillingAdmin = claims?.isBillingAdmin;

  // Don't show billing banner when billing is disabled
  if (featuresLoading) return null;
  if (!config.features.billing) return null;

  // Don't show the banner if user is platform admin
  if (claims?.isPlatformAdmin) return null;

  // Don't show the banner if no subscription data yet (loading) or subscription is healthy
  if (!subscription || subscription.is_subscription_healthy) return null;

  const status = subscription.status;
  const isTrialing = status === 'trialing';
  const trialDaysRemaining = subscription.trial_days_remaining;

  // Active trial - info banner
  if (isTrialing && trialDaysRemaining != null && trialDaysRemaining > 0) {
    return (
      <Alert
        severity="info"
        sx={bannerSx}
        action={
          isBillingAdmin ? (
            <Button color="inherit" size="small" onClick={() => navigate('/admin/billing')}>
              {t('subscription.choosePlan')}
            </Button>
          ) : undefined
        }
      >
        {t('subscription.trialExpiresIn', { count: trialDaysRemaining })}
        {!isBillingAdmin && ` ${t('subscription.choosePlanToContinue')}`}
      </Alert>
    );
  }

  // Trial expired
  if (isTrialing && (trialDaysRemaining == null || trialDaysRemaining <= 0)) {
    if (isBillingAdmin) {
      return (
        <Alert
          severity="warning"
          sx={bannerSx}
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/admin/billing')}>
              {t('subscription.choosePlanToContinueAction')}
            </Button>
          }
        >
          {t('subscription.trialExpired')}
        </Alert>
      );
    }
    return (
      <Alert severity="warning" sx={bannerSx}>
        {t('subscription.trialExpiredContactAdmin')}
      </Alert>
    );
  }

  // Unpaid invoice during its grace: the workspace stays usable until the freeze date.
  if (subscription.access_allowed === true) {
    const freezeAt = subscription.freeze_effective_at;
    const date = freezeAt ? formatShortDate(freezeAt, locale, { year: 'always' }) : null;
    const amount = formatAmount(locale, subscription.latest_invoice_amount, subscription.latest_invoice_currency);
    let message = t('subscription.subscriptionNeedsAttention');
    if (date) {
      message = isBillingAdmin && amount
        ? t('subscription.paymentOverdueAmount', { amount, date })
        : t('subscription.paymentOverdue', { date });
    }
    return (
      <Alert
        severity="warning"
        sx={bannerSx}
        action={
          isBillingAdmin ? (
            <Button color="inherit" size="small" onClick={() => navigate('/admin/billing')}>
              {t('subscription.goToBilling')}
            </Button>
          ) : undefined
        }
      >
        {message}
        {!isBillingAdmin && ` ${t('subscription.contactBillingAdmin')}`}
      </Alert>
    );
  }

  // Frozen subscription, or a summary that does not say (access_allowed absent): the error
  // banner, as before the grace was shown.
  if (isBillingAdmin) {
    return (
      <Alert
        severity="error"
        sx={bannerSx}
        action={
          <Button color="inherit" size="small" onClick={() => navigate('/admin/billing')}>
            {t('subscription.goToBilling')}
          </Button>
        }
      >
        {t('subscription.subscriptionNeedsAttention')}
      </Alert>
    );
  }

  return (
    <Alert severity="error" sx={bannerSx}>
      {t('subscription.accountAccessLimited')}
    </Alert>
  );
}
