import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { useFeatures } from '../config/FeaturesContext';
import { useLocale } from '../i18n/useLocale';

const chipSx = {
  display: { xs: 'none', sm: 'inline-flex' },
  alignItems: 'center',
  flexShrink: 0,
  mr: 0.5,
  px: 1,
  height: 22,
  border: 1,
  borderColor: 'divider',
  borderRadius: 999,
  fontSize: 12,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  color: 'text.secondary',
  textDecoration: 'none',
} as const;

const linkSx = {
  ...chipSx,
  '&:visited': { color: 'text.secondary' },
  '&:hover': { color: 'text.primary', borderColor: 'text.secondary', textDecoration: 'none' },
} as const;

/**
 * Days left in the trial, in the top bar. Only a running trial shows it: an expired trial and a
 * frozen subscription are the banner's job, a paid subscription has nothing to count.
 */
export default function TrialChip() {
  const { t } = useTranslation('common');
  const locale = useLocale();
  const { subscription, claims } = useAuth();
  const { config, isLoading } = useFeatures();

  if (isLoading || !config.features.billing) return null;
  if (claims?.isPlatformAdmin) return null;
  if (!subscription || subscription.status !== 'trialing' || !subscription.is_subscription_healthy) return null;
  const days = subscription.trial_days_remaining;
  if (days == null || days <= 0) return null;

  const label = t('subscription.trialChip', { count: days });
  const trialEnd = subscription.trial_end ? new Date(subscription.trial_end) : null;
  const tooltip = trialEnd && !Number.isNaN(trialEnd.getTime())
    ? t('subscription.trialEndsOn', { date: trialEnd.toLocaleDateString(locale) })
    : '';

  const chip = claims?.isBillingAdmin ? (
    <Box component={Link} to="/admin/billing" sx={linkSx}>{label}</Box>
  ) : (
    <Box component="span" sx={chipSx}>{label}</Box>
  );
  return tooltip ? <Tooltip title={tooltip} describeChild>{chip}</Tooltip> : chip;
}
