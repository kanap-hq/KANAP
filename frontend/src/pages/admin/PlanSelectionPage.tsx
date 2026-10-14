import React from 'react';
import { Box, Button, ButtonBase, Checkbox, CircularProgress, FormControlLabel, Typography } from '@mui/material';
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
  /** The general terms of sale to accept before subscribing (version and links per language). */
  terms?: { version: string; urls: { fr: string; en: string } };
};

type BillingInterval = 'monthly' | 'annual';

/** The outcome of `POST /billing/change-plan`. */
type PlanChange = {
  status: 'paid' | 'requires_payment' | 'scheduled' | 'scheduled_change_cancelled' | 'requires_card';
  invoice?: { number: string | null; amount: number | null; currency: string | null; hosted_invoice_url: string | null };
  effective_at?: string;
  /** requires_card: the Stripe page where the customer saves a card. */
  setup_url?: string;
};

/** The running subscription the dialog compares the selection with. */
type CurrentSubscription = {
  status?: string | null;
  trial_end?: string | null;
  trial_days_remaining?: number | null;
  stripe_subscription_id?: string | null;
  is_subscription_healthy?: boolean;
  plan_name?: string | null;
  subscription_type?: 'monthly' | 'annual' | null;
  /** A planned switch of interval (annual to monthly at the end of the year). */
  scheduled_change?: { interval: 'monthly' | 'annual'; effective_at: string } | null;
};

function formatPrice(cents: number, locale: string, currency = 'EUR'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** "Your plan is now annual. Invoice KAN-0012, 2 241,00 €, paid." */
function paidMessage(change: PlanChange | undefined, interval: BillingInterval, t: TFunction, locale: string): string {
  const now = t(interval === 'annual' ? 'planSelection.messages.nowAnnual' : 'planSelection.messages.nowMonthly');
  const invoice = change?.invoice;
  if (!invoice?.number || invoice.amount == null) return now;
  const amount = formatPrice(invoice.amount, locale, invoice.currency ?? 'EUR');
  return `${now} ${t('planSelection.messages.invoicePaid', { number: invoice.number, amount })}`;
}

/** "Your plan stays annual." once a planned switch is cancelled. */
function keptMessage(interval: BillingInterval, t: TFunction): string {
  return t(interval === 'annual' ? 'planSelection.messages.keptAnnual' : 'planSelection.messages.keptMonthly');
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
  if (message === 'TERMS_NOT_ACCEPTED') {
    return t('planSelection.errors.termsNotAccepted');
  }
  if (message === 'PLAN_UNCHANGED') {
    return t('planSelection.currentPlan');
  }
  return getApiErrorMessage(error, t, t('planSelection.messages.requestFailed'));
}

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

const termsLineSx = {
  mt: '20px',
  mr: 0,
  // Aligns the checkbox box (not its click area) with the content edge.
  ml: '-6px',
  '& .MuiCheckbox-root': { p: '4px', mr: '6px' },
  '& .MuiFormControlLabel-label': { fontSize: 13, lineHeight: 1.5, color: 'kanap.text.primary' },
} as const;

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
  /** The current subscription, fresher than the one read at sign-in (billing page data). */
  subscription?: CurrentSubscription | null;
  /** The interval selected when the dialog opens (monthly otherwise). */
  initialInterval?: BillingInterval;
  /** A line shown when the dialog opens (back from the card setup page). */
  notice?: string | null;
};

export default function PlanSelectionDialog({
  open,
  onClose,
  onSuccess,
  invoiceMissingFields = [],
  onCompleteInvoiceDetails,
  onExited,
  subscription: currentSubscription,
  initialInterval,
  notice = null,
}: PlanSelectionDialogProps) {
  const auth = useAuth();
  const { claims } = auth;
  const subscription: CurrentSubscription | null = currentSubscription ?? auth.subscription ?? null;
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;
  const [billingCycle, setBillingCycle] = React.useState<BillingInterval>(initialInterval ?? 'monthly');
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionInfo, setActionInfo] = React.useState<string | null>(open ? notice : null);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  // The dialog stays mounted between openings: each opening starts without the outcome of
  // the previous attempt (an error from details fixed since, a finished request).
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setActionError(null);
      setActionInfo(notice);
      setActionLoading(null);
      setTermsAccepted(false);
      if (initialInterval) setBillingCycle(initialInterval);
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

  // The catalogue sells one plan (Hosted KANAP); the dialog offers the first one listed.
  const plan = plansQuery.data?.[0] ?? null;
  // The French terms are binding; every other language reads the English translation.
  const termsUrl = plan?.terms ? (locale === 'fr' ? plan.terms.urls.fr : plan.terms.urls.en) : null;

  const handleCardFlow = async (planKey: string) => {
    if (!isBillingAdmin) return;
    setActionError(null);
    setActionInfo(null);
    setActionLoading(`${planKey}:card`);
    try {
      if (hasHealthyStripeSubscription) {
        const res = await api.post<{ change?: PlanChange }>('/billing/change-plan', {
          plan_key: planKey,
          subscription_type: billingCycle,
          terms_version: plan?.terms?.version,
          // A switch from bank transfer to card first needs a card: the setup page returns here.
          success_url: window.location.origin + '/admin/billing',
          cancel_url: window.location.origin + '/admin/billing',
        });
        const change = res.data?.change;
        // The billing page reloads the subscription and the invoice list.
        onSuccess?.();
        if (change?.status === 'requires_card') {
          // Nothing changes until the customer has saved a card on its Stripe page.
          const url = change.setup_url;
          if (url) {
            window.location.href = url;
          } else {
            setActionError(t('planSelection.messages.cardSetupUnavailable'));
          }
          return;
        }
        if (change?.status === 'scheduled_change_cancelled') {
          setActionInfo(keptMessage(billingCycle, t));
          return;
        }
        if (change?.status === 'requires_payment') {
          // The card needs the customer (3-D Secure) or was refused: the plan changes once the
          // invoice is paid on its Stripe page, like a checkout.
          const url = change.invoice?.hosted_invoice_url;
          if (url) {
            window.location.href = url;
          } else {
            setActionError(t('planSelection.messages.paymentRequired'));
          }
          return;
        }
        if (change?.status === 'scheduled') {
          setActionInfo(t('planSelection.messages.switchToMonthly', {
            date: formatShortDate(change.effective_at ?? null, locale, { year: 'always' }),
          }));
          return;
        }
        setActionInfo(paidMessage(change, billingCycle, t, locale));
        return;
      }

      const res = await api.post<{ url: string }>('/billing/checkout', {
        plan_key: planKey,
        interval: billingCycle,
        success_url: window.location.origin + '/admin/billing',
        cancel_url: window.location.origin + '/admin/billing',
        terms_version: plan?.terms?.version,
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

  /** "Keep annual": cancels the planned switch. Keeps the current commitment: no new terms. */
  const handleKeepCurrentPlan = async () => {
    if (!isBillingAdmin) return;
    setActionError(null);
    setActionInfo(null);
    setActionLoading('keep');
    try {
      await api.post('/billing/scheduled-change/cancel');
      onSuccess?.();
      setActionInfo(keptMessage(billingCycle, t));
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
        terms_version: plan?.terms?.version,
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

  const annual = billingCycle === 'annual';
  const price = plan ? (annual ? plan.prices.annual : plan.prices.monthly) : 0;
  const freeMonths = plan ? annualFreeMonths(plan.prices) : null;
  const optionForCycle = annual ? plan?.payment_options?.annual : plan?.payment_options?.monthly;
  const bankTransferEligible = !!optionForCycle?.bank_transfer;
  const cardLoading = !!plan && actionLoading === `${plan.plan_key}:card`;
  const bankTransferLoading = !!plan && actionLoading === `${plan.plan_key}:bank_transfer`;
  const isAnyLoading = !!actionLoading;
  // The selection is the running plan and interval: there is nothing to change.
  const isCurrentPlan = hasHealthyStripeSubscription
    && !!plan
    && subscription?.plan_name === plan.display_name
    && subscription?.subscription_type === billingCycle;
  // A switch of interval planned for the end of the period (annual to monthly).
  const scheduledChange = hasHealthyStripeSubscription ? subscription?.scheduled_change ?? null : null;
  // The current plan selected while a switch is planned: the action keeps it.
  const keepsCurrentPlan = !!scheduledChange && isCurrentPlan;
  // The interval the planned switch moves to: already planned, nothing to change.
  const switchAlreadyPlanned = !!scheduledChange
    && !!plan
    && subscription?.plan_name === plan.display_name
    && billingCycle === scheduledChange.interval;
  const keepLabel = t(billingCycle === 'annual'
    ? 'billing.subscription.scheduledChange.keepAnnual'
    : 'billing.subscription.scheduledChange.keepMonthly');
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
      onSave={() => {
        if (!plan) return undefined;
        return keepsCurrentPlan ? handleKeepCurrentPlan() : handleCardFlow(plan.plan_key);
      }}
      saveLabel={keepsCurrentPlan ? keepLabel : cardLabel}
      saveDisabled={keepsCurrentPlan
        ? !isBillingAdmin || isAnyLoading
        : !plan || !isBillingAdmin || isAnyLoading || cardBlocked || isCurrentPlan || switchAlreadyPlanned || !termsAccepted}
      saveLoading={keepsCurrentPlan ? actionLoading === 'keep' : cardLoading}
      secondaryActions={plan && bankTransferEligible ? (
        <Button
          variant="action"
          onClick={() => handleBankTransferFlow(plan.plan_key)}
          disabled={!isBillingAdmin || isAnyLoading || bankTransferBlocked || isCurrentPlan || !termsAccepted}
          startIcon={bankTransferLoading ? <CircularProgress color="inherit" size={14} /> : undefined}
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
            {annual && freeMonths != null && (
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

          {isCurrentPlan && !keepsCurrentPlan && (
            <Typography sx={{ mt: '16px', fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('planSelection.currentPlan')}
            </Typography>
          )}
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

      {scheduledChange && !actionInfo && (
        <Box sx={statusLineSx}>
          <StatusDot color={getDotColor('info', mode)} sx={statusDotSx} />
          <span>
            {t(scheduledChange.interval === 'monthly' ? 'planSelection.messages.switchToMonthly' : 'planSelection.messages.switchToAnnual', {
              date: formatShortDate(scheduledChange.effective_at, locale, { year: 'always' }),
            })}
          </span>
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

      {plan && !keepsCurrentPlan && (
        <FormControlLabel
          sx={termsLineSx}
          control={(
            <Checkbox
              size="small"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
            />
          )}
          label={(
            <>
              {t('planSelection.terms.accept')}{' '}
              {termsUrl ? (
                <Box component="a" href={termsUrl} target="_blank" rel="noopener noreferrer" sx={inlineLinkSx}>
                  {t('planSelection.terms.link')}
                </Box>
              ) : t('planSelection.terms.link')}
            </>
          )}
        />
      )}
    </KanapDialog>
  );
}
