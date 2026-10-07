import React from 'react';
import { Box, Button, ButtonBase, CircularProgress, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import api from '../../api';
import { useQuery } from '@tanstack/react-query';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useLocale } from '../../i18n/useLocale';
import { invoiceProfileIncompleteMessage } from '../../utils/billingProfile';
import { getDotColor } from '../../utils/statusColors';
import { formatShortDate } from '../../lib/dateFormat';
import { KanapDialog, StatusDot } from '../../components/design';

type PlanPrice = {
  monthly: number;
  annual: number;
};

type PlanPaymentOption = {
  card: boolean;
  bank_transfer: boolean;
};

type Plan = {
  plan_key: string;
  display_name: string;
  invoice_eligible: boolean;
  bank_transfer_min_amount?: number;
  payment_options?: {
    monthly: PlanPaymentOption;
    annual: PlanPaymentOption;
  };
  prices: PlanPrice;
};

type BillingInterval = 'monthly' | 'annual';

function formatPrice(cents: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} EUR`;
  }
}

/** Months the annual price saves against twelve monthly payments, when it is a whole number. */
function annualFreeMonths(prices: PlanPrice): number | null {
  if (!(prices.monthly > 0) || !(prices.annual > 0)) return null;
  const free = 12 - prices.annual / prices.monthly;
  const rounded = Math.round(free);
  return rounded >= 1 && Math.abs(free - rounded) < 1e-9 ? rounded : null;
}

function parseApiError(error: any, t: TFunction): string {
  const message = error?.response?.data?.message;
  if (Array.isArray(message)) {
    return getApiErrorMessage(error, t, t('planSelection.messages.requestFailed'));
  }
  if (message === 'PLAN_NOT_BANK_TRANSFER_ELIGIBLE') {
    return t('planSelection.errors.planNotBankTransferEligible');
  }
  if (message === 'NO_ACTIVE_SUBSCRIPTION') {
    return t('planSelection.errors.noActiveSubscription');
  }
  if (message === 'BILLING_PROFILE_INCOMPLETE') {
    const missing = error?.response?.data?.missing;
    return invoiceProfileIncompleteMessage(Array.isArray(missing) ? missing : [], t);
  }
  if (message === 'VAT_NUMBER_INVALID') {
    return t('planSelection.errors.vatNumberInvalid');
  }
  return getApiErrorMessage(error, t, t('planSelection.messages.requestFailed'));
}

// A disabled payment button keeps a visible shape and readable text in both modes:
// the action-pill surface and border with tertiary text, instead of grey on grey.
const disabledContainedSx = (theme: Theme) => ({
  '&.Mui-disabled': {
    color: theme.palette.kanap.text.tertiary,
    backgroundColor: theme.palette.kanap.pill.bg,
    boxShadow: `inset 0 0 0 1px ${theme.palette.kanap.pill.border}`,
  },
});

const disabledOutlinedSx = (theme: Theme) => ({
  '&.Mui-disabled': {
    color: theme.palette.kanap.text.tertiary,
    backgroundColor: theme.palette.kanap.pill.bg,
    borderColor: theme.palette.kanap.pill.border,
  },
});

const segmentGroupSx = {
  display: 'inline-flex',
  p: '2px',
  gap: '2px',
  bgcolor: 'kanap.pill.bg',
  border: '1px solid',
  borderColor: 'kanap.pill.border',
  borderRadius: '6px',
} as const;

const segmentSx = (selected: boolean) => (theme: Theme) => {
  const { kanap } = theme.palette;
  const dark = theme.palette.mode === 'dark';
  return {
    height: 26,
    px: '12px',
    borderRadius: '4px',
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1,
    fontWeight: selected ? 500 : 400,
    color: selected ? kanap.text.primary : kanap.text.secondary,
    // Selected: a raised white segment in light mode, one step lighter than the track in dark mode.
    backgroundColor: selected ? (dark ? kanap.pill.border : kanap.bg.primary) : 'transparent',
    boxShadow: selected && !dark ? `0 0 0 1px ${kanap.border.default}` : 'none',
    transition: 'background-color 120ms ease, color 120ms ease',
    '&:hover': selected ? {} : { color: kanap.text.primary },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 1,
    },
  };
};

const statusLineSx = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 0.75,
  mt: '20px',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'kanap.text.secondary',
} as const;

// Centres the 6px dot on the first 19.5px line of 13px text.
const statusDotSx = { mt: '7px' } as const;

const inlineLinkSx = {
  display: 'inline',
  p: 0,
  border: 0,
  background: 'none',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  color: 'kanap.teal',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  '&:hover': { textDecoration: 'underline', textUnderlineOffset: '2px' },
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2, borderRadius: '2px' },
} as const;

const errorLineSx = { mt: '16px', fontSize: 13, lineHeight: 1.5, color: 'kanap.danger' } as const;

type PlanSelectionDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Invoice fields still needed before subscribing (from the billing profile). */
  invoiceMissingFields?: readonly string[];
  /** Takes the user to the first missing field of the invoicing information. */
  onCompleteInvoiceDetails?: () => void;
  /** Called once the dialog has finished closing. */
  onExited?: () => void;
};

export default function PlanSelectionDialog({
  open,
  onClose,
  onSuccess,
  invoiceMissingFields = [],
  onCompleteInvoiceDetails,
  onExited,
}: PlanSelectionDialogProps) {
  const { subscription, claims } = useAuth();
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;
  const [billingCycle, setBillingCycle] = React.useState<BillingInterval>('monthly');
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionInfo, setActionInfo] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  // The dialog stays mounted between openings: each opening starts without the outcome of
  // the previous attempt (an error from details fixed since, a finished request).
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setActionError(null);
      setActionInfo(null);
      setActionLoading(null);
    }
  }

  const isBillingAdmin = !!claims?.isBillingAdmin;
  const isTrialing = subscription?.status === 'trialing';
  const trialDaysRemaining = subscription?.trial_days_remaining;
  const hasStripeSubscription = !!subscription?.stripe_subscription_id;
  const hasHealthyStripeSubscription = hasStripeSubscription && subscription?.is_subscription_healthy === true;
  // Subscribing (card checkout, bank transfer) needs complete invoice details; a card
  // plan change on a running subscription does not.
  const invoiceProfileIncomplete = invoiceMissingFields.length > 0;
  const cardBlocked = invoiceProfileIncomplete && !hasHealthyStripeSubscription;
  const bankTransferBlocked = invoiceProfileIncomplete;

  const plansQuery = useQuery<Plan[]>({
    queryKey: ['billing-plans'],
    queryFn: async () => {
      const res = await api.get<Plan[]>('/billing/plans');
      return res.data;
    },
    enabled: open,
  });

  const handleCardFlow = async (planKey: string) => {
    if (!isBillingAdmin) return;
    setActionError(null);
    setActionInfo(null);
    setActionLoading(`${planKey}:card`);
    try {
      if (hasHealthyStripeSubscription) {
        await api.post('/billing/change-plan', {
          plan_key: planKey,
          subscription_type: billingCycle,
        });
        onSuccess?.();
        onClose();
        return;
      }

      const res = await api.post<{ url: string }>('/billing/checkout', {
        plan_key: planKey,
        interval: billingCycle,
        success_url: window.location.origin + '/admin/billing',
        cancel_url: window.location.origin + '/admin/billing',
      });
      const url = res.data?.url;
      if (url) {
        window.location.href = url;
      } else {
        setActionError(t('planSelection.messages.checkoutUrlUnavailable'));
      }
    } catch (e: any) {
      setActionError(parseApiError(e, t));
    } finally {
      setActionLoading(null);
    }
  };

  const handleBankTransferFlow = async (planKey: string) => {
    if (!isBillingAdmin) return;
    setActionError(null);
    setActionInfo(null);
    setActionLoading(`${planKey}:bank_transfer`);
    try {
      const res = await api.post<any>('/billing/request-invoice', {
        plan_key: planKey,
        subscription_type: billingCycle,
      });
      onSuccess?.();

      const hostedInvoiceUrl =
        res?.data?.hosted_invoice_url ||
        res?.data?.latest_invoice_url ||
        null;

      if (hostedInvoiceUrl) {
        window.location.href = hostedInvoiceUrl;
      } else {
        setActionInfo(t('planSelection.messages.invoiceCreated'));
      }
    } catch (e: any) {
      setActionError(parseApiError(e, t));
    } finally {
      setActionLoading(null);
    }
  };

  // The catalogue sells one plan (Hosted KANAP); the dialog offers the first one listed.
  const plan = plansQuery.data?.[0] ?? null;
  const annual = billingCycle === 'annual';
  const price = plan ? (annual ? plan.prices.annual : plan.prices.monthly) : 0;
  const freeMonths = plan ? annualFreeMonths(plan.prices) : null;
  const optionForCycle = annual ? plan?.payment_options?.annual : plan?.payment_options?.monthly;
  const bankTransferEligible = !!optionForCycle?.bank_transfer;
  const cardLoading = !!plan && actionLoading === `${plan.plan_key}:card`;
  const bankTransferLoading = !!plan && actionLoading === `${plan.plan_key}:bank_transfer`;
  const isAnyLoading = !!actionLoading;
  const cardLabel = hasHealthyStripeSubscription ? t('planSelection.actions.changePlanCard') : t('planSelection.actions.payByCard');
  const bankTransferLabel = hasHealthyStripeSubscription ? t('planSelection.actions.changePlanBankTransfer') : t('planSelection.actions.payByBankTransfer');

  let subtitle: string | undefined;
  if (isTrialing) {
    if (trialDaysRemaining != null && trialDaysRemaining > 0) {
      subtitle = subscription?.trial_end
        ? [
          t('planSelection.trial.ends', { date: formatShortDate(subscription.trial_end, locale) }),
          t('planSelection.trial.daysLeft', { count: trialDaysRemaining }),
        ].join(' · ')
        : t('planSelection.trial.endsIn', { count: trialDaysRemaining });
    } else {
      subtitle = t('planSelection.trial.ended');
    }
  }

  const intervals: Array<{ value: BillingInterval; label: string }> = [
    { value: 'monthly', label: t('planSelection.billingCycle.monthly') },
    { value: 'annual', label: t('planSelection.billingCycle.annual') },
  ];

  return (
    <KanapDialog
      open={open}
      title={t('planSelection.title')}
      subtitle={subtitle}
      onClose={onClose}
      onExited={onExited}
      onSave={() => (plan ? handleCardFlow(plan.plan_key) : undefined)}
      saveLabel={cardLabel}
      saveDisabled={!plan || !isBillingAdmin || isAnyLoading || cardBlocked}
      saveLoading={cardLoading}
      saveSx={disabledContainedSx}
      secondaryActions={plan && bankTransferEligible ? (
        <Button
          variant="outlined"
          onClick={() => handleBankTransferFlow(plan.plan_key)}
          disabled={!isBillingAdmin || isAnyLoading || bankTransferBlocked}
          startIcon={bankTransferLoading ? <CircularProgress color="inherit" size={14} /> : undefined}
          sx={disabledOutlinedSx}
        >
          {bankTransferLabel}
        </Button>
      ) : undefined}
      sx={{ maxWidth: 520 }}
    >
      {plansQuery.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={20} />
        </Box>
      )}
      {plansQuery.isError && (
        <Typography role="alert" sx={{ ...errorLineSx, mt: 0 }}>
          {getApiErrorMessage(plansQuery.error, t, t('planSelection.messages.loadFailed'))}
        </Typography>
      )}

      {plan && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
            <Box role="group" aria-label={t('planSelection.billingCycle.label')} sx={segmentGroupSx}>
              {intervals.map((interval) => {
                const selected = billingCycle === interval.value;
                return (
                  <ButtonBase
                    key={interval.value}
                    aria-pressed={selected}
                    onClick={() => setBillingCycle(interval.value)}
                    sx={segmentSx(selected)}
                  >
                    {interval.label}
                  </ButtonBase>
                );
              })}
            </Box>
            {freeMonths != null && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                {t('planSelection.annualSavings', { count: freeMonths })}
              </Typography>
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mt: '20px' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 500, lineHeight: 1.4, color: 'kanap.text.primary' }}>
                {plan.display_name}
              </Typography>
              <Typography sx={{ fontSize: 13, lineHeight: 1.5, color: 'kanap.text.secondary' }}>
                {t('planSelection.unlimitedUsers')}
              </Typography>
            </Box>
            <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 0.75 }}>
                <Typography
                  sx={{
                    fontSize: 24,
                    fontWeight: 500,
                    lineHeight: 1.2,
                    color: 'kanap.text.primary',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatPrice(price, locale)}
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
                  {t(annual ? 'planSelection.period.year' : 'planSelection.period.month')}
                </Typography>
              </Box>
              {annual && (
                <Typography sx={{ mt: '2px', fontSize: 12, color: 'kanap.text.tertiary', fontVariantNumeric: 'tabular-nums' }}>
                  {t('planSelection.monthlyEquivalent', { amount: formatPrice(Math.round(plan.prices.annual / 12), locale) })}
                </Typography>
              )}
            </Box>
          </Box>

          {!isBillingAdmin && (
            <Typography sx={{ mt: '16px', fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('shared.billingAdminRequired')}
            </Typography>
          )}
        </>
      )}

      {invoiceProfileIncomplete && (
        <Box sx={statusLineSx}>
          <StatusDot color={getDotColor('warning', mode)} sx={statusDotSx} />
          <Box component="span">
            <span>{invoiceProfileIncompleteMessage(invoiceMissingFields, t)}</span>
            {onCompleteInvoiceDetails && (
              <>
                {' '}
                <Box component="button" type="button" onClick={onCompleteInvoiceDetails} sx={inlineLinkSx}>
                  {t('planSelection.profile.complete')}
                </Box>
              </>
            )}
          </Box>
        </Box>
      )}

      {!!actionInfo && (
        <Box role="status" sx={statusLineSx}>
          <StatusDot color={getDotColor('success', mode)} sx={statusDotSx} />
          <span>{actionInfo}</span>
        </Box>
      )}
      {!!actionError && (
        <Typography role="alert" sx={errorLineSx}>
          {actionError}
        </Typography>
      )}
    </KanapDialog>
  );
}
