import React from 'react';
import PageHeader from '../../components/PageHeader';
import { Alert, Autocomplete, Box, Button, CircularProgress, Stack, TextField, Tooltip, Typography } from '@mui/material';
import type { ChipProps } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getDotColor } from '../../utils/statusColors';
import { PropertyRow, StatusDot } from '../../components/design';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import api from '../../api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useLocale } from '../../i18n/useLocale';
import {
  BillingContact,
  BillingContactPatch,
  BillingInvoice,
  BillingProfileResponse,
  BillingSubscription,
  getBillingProfile,
  updateBillingProfile,
} from '../../services/billing';
import PlanSelectionDialog, { subscriptionEndingMessage } from './PlanSelectionPage';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { isEuCountry } from '../../utils/billingProfile';
import { filterCountryOptions, useCountryOptions } from '../../i18n/countries';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import { formatShortDate } from '../../lib/dateFormat';
import { drawerAutocompleteListboxSx, drawerFieldValueSx, tealLinkSx } from '../../theme/formSx';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One field of the invoicing details. `key` is also its name in `invoice_missing_fields`. */
type InvoiceTextField = {
  key: 'company' | 'email' | 'name' | 'phone' | 'addressLine1' | 'addressLine2' | 'postalCode' | 'city' | 'state' | 'vatNumber';
  label: string;
  placeholder: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
};
type InvoiceFieldKey = InvoiceTextField['key'] | 'country';
type FieldErrors = Partial<Record<InvoiceFieldKey, string>>;

const ADDRESS_FIELDS: Partial<Record<InvoiceFieldKey, keyof BillingContact['address']>> = {
  addressLine1: 'line1',
  addressLine2: 'line2',
  postalCode: 'postalCode',
  city: 'city',
  state: 'state',
  country: 'country',
};

/** The saved value of a field. */
function savedValue(contact: BillingContact | undefined, key: InvoiceFieldKey): string {
  if (!contact) return '';
  const addressKey = ADDRESS_FIELDS[key];
  if (addressKey) return contact.address?.[addressKey] ?? '';
  return (contact[key as Exclude<keyof BillingContact, 'address'>] as string | null) ?? '';
}

/** The PATCH body that sets one field; null clears it. */
function fieldPatch(key: InvoiceFieldKey, value: string | null): BillingContactPatch {
  const addressKey = ADDRESS_FIELDS[key];
  if (addressKey) return { address: { [addressKey]: value } };
  return { [key]: value } as BillingContactPatch;
}

/** The saved contact with one field replaced, for a change shown before the server answers. */
function withField(contact: BillingContact, key: InvoiceFieldKey, value: string | null): BillingContact {
  const addressKey = ADDRESS_FIELDS[key];
  if (addressKey) return { ...contact, address: { ...contact.address, [addressKey]: value } };
  return { ...contact, [key]: value };
}

function formatMoney(locale: string, amount?: number | null, currency?: string | null) {
  if (amount == null || !currency) return null;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${amount / 100} ${currency.toUpperCase()}`;
  }
}

const STATUS_META: Record<string, ChipProps['color']> = {
  active: 'success',
  trialing: 'info',
  incomplete: 'warning',
  incomplete_expired: 'default',
  past_due: 'warning',
  canceled: 'default',
  unpaid: 'error',
  paused: 'warning',
};

const INVOICE_STATUS_META: Record<string, ChipProps['color']> = {
  draft: 'default',
  open: 'warning',
  paid: 'success',
  void: 'default',
  uncollectible: 'error',
};

const ENDED_SUBSCRIPTION_STATUSES = ['canceled', 'incomplete_expired'];

/** A Stripe subscription that still runs: its plan, amount and payment details are real. */
function isLiveSubscription(subscription: BillingSubscription | null | undefined): boolean {
  if (!subscription?.stripe_subscription_id) return false;
  return !ENDED_SUBSCRIPTION_STATUSES.includes(subscription.status ?? '');
}

function getStatusMeta(
  subscription: BillingSubscription | null | undefined,
  t: Translate,
): { label: string; color: ChipProps['color'] } {
  if (subscription?.status) {
    const color = STATUS_META[subscription.status];
    return color
      ? { color, label: t(`billing.statuses.${subscription.status}`) }
      : { label: subscription.status.replace(/_/g, ' '), color: 'default' };
  }
  if (!subscription?.stripe_subscription_id) {
    return { label: t('billing.statuses.notSubscribed'), color: 'default' };
  }
  return { label: t('billing.statuses.pending'), color: 'default' };
}

function getInvoiceStatusMeta(status: string | null | undefined, t: Translate): { label: string; color: ChipProps['color'] } {
  if (!status) return { label: '—', color: 'default' };
  const color = INVOICE_STATUS_META[status];
  return color
    ? { color, label: t(`billing.invoiceStatuses.${status}`) }
    : { label: status.replace(/_/g, ' '), color: 'default' };
}

/** "Visa •••• 4242", else the payment mode ("Card", "Bank transfer"). */
function paymentMethodLabel(subscription: BillingSubscription, t: Translate): string {
  const brand = subscription.default_payment_method_brand;
  if (subscription.default_payment_method_id && brand) {
    const name = brand.charAt(0).toUpperCase() + brand.slice(1);
    const last4 = subscription.default_payment_method_last4;
    return last4 ? `${name} •••• ${last4}` : name;
  }
  return subscription.payment_mode === 'bank_transfer'
    ? t('billing.subscription.values.bankTransfer')
    : t('billing.subscription.values.card');
}

/**
 * The two summary lines. Without a live subscription the stored plan, amount and payment
 * details are leftovers: only the status shows, with the trial dates.
 */
function subscriptionLines(subscription: BillingSubscription | null | undefined, t: Translate, locale: string) {
  const live = isLiveSubscription(subscription);
  const isTrialing = subscription?.status === 'trialing';
  const date = (value: string) => formatShortDate(value, locale);

  let plan: string | null = null;
  if (live && subscription) {
    const annual = subscription.subscription_type === 'annual';
    const amount = formatMoney(
      locale,
      subscription.amount ?? subscription.estimated_amount ?? null,
      subscription.currency ?? subscription.estimated_currency ?? null,
    );
    plan = [
      subscription.plan_name,
      subscription.subscription_type
        ? t(annual ? 'billing.subscription.values.annual' : 'billing.subscription.values.monthly')
        : null,
      amount
        ? t(annual ? 'billing.subscription.values.amountPerYear' : 'billing.subscription.values.amountPerMonth', { amount })
        : null,
    ].filter(Boolean).join(' · ') || null;
  }

  const details: string[] = [];
  const trialEnd = subscription?.trial_end ?? null;
  const trialOver = !!trialEnd && new Date(trialEnd).getTime() <= Date.now();
  if (isTrialing && trialEnd && !trialOver) {
    details.push(t('billing.subscription.values.ends', { date: date(trialEnd) }));
  } else if (!live && trialEnd && trialOver) {
    details.push(t('billing.subscription.values.trialEnded', { date: date(trialEnd) }));
  }
  const daysRemaining = subscription?.trial_days_remaining;
  if (isTrialing && daysRemaining != null && daysRemaining > 0) {
    details.push(t('billing.subscription.values.daysRemaining', { count: daysRemaining }));
  }
  // A live subscription whose cancellation is set ends on that date instead of renewing.
  const endsAt = live && !isTrialing ? subscription?.canceled_at_effective ?? null : null;
  if (endsAt) {
    details.push(t('billing.subscription.values.ends', { date: date(endsAt) }));
  } else if (live && subscription && !isTrialing && !isPaymentPending(subscription)) {
    // An unpaid subscription shows its debt instead (unpaidLines): Stripe has opened the next period anyway.
    const renewal = subscription.renewal_at
      ?? subscription.current_period_end
      ?? subscription.next_payment_at
      ?? subscription.payment_due_at
      ?? null;
    if (renewal) details.push(t('billing.subscription.values.renews', { date: date(renewal) }));
  }
  if (live && subscription) details.push(paymentMethodLabel(subscription, t));
  return { plan, details, cancelled: !!endsAt };
}

/** Stripe's refusal codes the screen names; any other reads as a declined card. */
const PAYMENT_ERROR_REASONS = ['insufficient_funds', 'expired_card', 'incorrect_cvc', 'authentication_required', 'processing_error'];
const UNPAID_INVOICE_STATUSES = ['open', 'uncollectible'];
const UNPAID_SUBSCRIPTION_STATUSES = ['past_due', 'unpaid', 'canceled'];

/** A subscription that still runs without being paid: its plan cannot change until the invoice is paid. */
function isPaymentPending(
  subscription: Pick<BillingSubscription, 'stripe_subscription_id' | 'status' | 'is_subscription_healthy'> | null | undefined,
): boolean {
  return isLiveSubscription(subscription) && subscription?.status !== 'trialing' && subscription?.is_subscription_healthy === false;
}

/**
 * The unpaid latest invoice of a subscription past due, unpaid or ended on it: "Payment refused on
 * 10 Nov 2026: insufficient funds." for a card, "Invoice KAN-0041 of €249.00 was due on 3 Nov 2026."
 * for a bank transfer, and when access becomes (or became) limited. Null when nothing is owed.
 */
function unpaidLines(subscription: BillingSubscription | null | undefined, t: Translate, locale: string) {
  if (!subscription?.stripe_subscription_id) return null;
  if (!UNPAID_SUBSCRIPTION_STATUSES.includes(subscription.status ?? '')) return null;
  if (!UNPAID_INVOICE_STATUSES.includes(subscription.latest_invoice_status ?? '')) return null;
  const date = (value: string) => formatShortDate(value, locale, { year: 'always' });
  const transfer = subscription.collection_method
    ? subscription.collection_method === 'send_invoice'
    : subscription.payment_mode === 'bank_transfer';
  const amount = formatMoney(locale, subscription.latest_invoice_amount ?? null, subscription.latest_invoice_currency ?? null);

  let invoice = t('billing.unpaid.overdue');
  if (transfer) {
    if (subscription.latest_invoice_number && amount && subscription.payment_due_at) {
      invoice = t('billing.unpaid.transferOverdue', {
        number: subscription.latest_invoice_number,
        amount,
        date: date(subscription.payment_due_at),
      });
    }
  } else if (subscription.latest_invoice_created) {
    const code = subscription.last_payment_error_code;
    const refusedOn = date(subscription.latest_invoice_created);
    invoice = code
      ? t('billing.unpaid.refusedReason', {
        date: refusedOn,
        reason: t(`billing.unpaid.reasons.${PAYMENT_ERROR_REASONS.includes(code) ? code : 'other'}`),
      })
      : t('billing.unpaid.refused', { date: refusedOn });
  }

  const frozen = subscription.access_allowed === false;
  const freezeAt = subscription.freeze_effective_at ?? null;
  let access: string | null = null;
  if (frozen) access = freezeAt ? t('billing.unpaid.limitedSince', { date: date(freezeAt) }) : t('billing.unpaid.limited');
  else if (freezeAt) access = t('billing.unpaid.limitedOn', { date: date(freezeAt) });
  // Only a subscription that still runs is paid here; an ended one takes a new plan.
  const payable = isLiveSubscription(subscription);
  // A transfer, or an invoice Stripe no longer retries (uncollectible), is paid on its own page.
  const onInvoicePage = transfer || subscription.latest_invoice_status === 'uncollectible';
  return { invoice, access, frozen, payable, onInvoicePage, invoiceUrl: subscription.latest_invoice_url ?? null };
}

/** The outcome of `POST /billing/pay-invoice`, called on the return from the portal. */
type InvoicePaymentStatus = 'paid' | 'payment_failed' | 'processing' | 'requires_action' | 'card_unchanged' | 'nothing_to_pay';
type PaymentNotice = { tone: 'success' | 'info' | 'error'; text: string; invoiceUrl?: string | null };

/** The line the page shows after paying the open invoice, or null when there was nothing to pay. */
function paymentNotice(
  status: InvoicePaymentStatus | undefined,
  subscription: BillingSubscription | null | undefined,
  t: Translate,
): PaymentNotice | null {
  switch (status) {
    case 'paid':
      return { tone: 'success', text: t('billing.payment.paid') };
    case 'payment_failed': {
      const code = subscription?.last_payment_error_code ?? '';
      const reason = t(`billing.unpaid.reasons.${PAYMENT_ERROR_REASONS.includes(code) ? code : 'other'}`);
      return { tone: 'error', text: t('billing.payment.failed', { reason }) };
    }
    case 'processing':
      return { tone: 'info', text: t('billing.payment.processing') };
    case 'requires_action':
      return { tone: 'error', text: t('billing.payment.requiresAction'), invoiceUrl: subscription?.latest_invoice_url ?? null };
    case 'card_unchanged':
      // The invoice page also takes a payment with the same card.
      return { tone: 'error', text: t('billing.payment.cardUnchanged'), invoiceUrl: subscription?.latest_invoice_url ?? null };
    default:
      return null;
  }
}

/**
 * Set in this browser session when the page sends the person to the portal to pay: only that
 * return pays the open invoice, never the address reopened from the history or received by a link.
 */
const PAY_ON_RETURN_MARK = 'billing-pay-on-return';

function markPayOnReturn() {
  try {
    window.sessionStorage.setItem(PAY_ON_RETURN_MARK, '1');
  } catch {
    // No session storage: the return pays nothing, the button stays.
  }
}

/** Whether this session sent the person to the portal to pay; the mark is used once. */
function takePayOnReturnMark(): boolean {
  try {
    const marked = window.sessionStorage.getItem(PAY_ON_RETURN_MARK) === '1';
    window.sessionStorage.removeItem(PAY_ON_RETURN_MARK);
    return marked;
  } catch {
    return false;
  }
}

type BillingInterval = 'monthly' | 'annual';

/** "Switches to monthly on 14 Oct 2027." for a live subscription with a planned switch, else null. */
function scheduledChangeLine(subscription: BillingSubscription | null | undefined, t: Translate, locale: string) {
  const change = isLiveSubscription(subscription) ? subscription?.scheduled_change ?? null : null;
  if (!change) return null;
  const toMonthly = change.interval === 'monthly';
  return {
    text: t(toMonthly ? 'billing.subscription.scheduledChange.monthly' : 'billing.subscription.scheduledChange.annual', {
      date: formatShortDate(change.effective_at, locale, { year: 'always' }),
    }),
    keepLabel: t(toMonthly ? 'billing.subscription.scheduledChange.keepAnnual' : 'billing.subscription.scheduledChange.keepMonthly'),
  };
}

const sectionTitleSx = { fontSize: 16, fontWeight: 500, color: 'kanap.text.primary', lineHeight: 1.4 } as const;
const keepActionSx = {
  ...tealLinkSx,
  fontSize: 13,
  '&:disabled': { color: 'kanap.text.tertiary', cursor: 'default', textDecoration: 'none' },
} as const;
const sectionHeadSx = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1.5 } as const;
const saveStatusSx = { fontSize: 12, color: 'kanap.text.tertiary' } as const;
const twoColumnsSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
  columnGap: 3,
  rowGap: 0.5,
} as const;
const summarySx = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 2,
  p: '12px 16px',
  borderRadius: '8px',
  bgcolor: 'kanap.bg.drawer',
  border: 1,
  borderColor: 'kanap.border.soft',
} as const;
const inlineStatusSx = { display: 'inline-flex', alignItems: 'center', gap: 0.75 } as const;
const unpaidLineSx = { ...inlineStatusSx, fontSize: 13, lineHeight: 1.4, color: 'kanap.text.primary' } as const;
const invoiceNumberSx = {
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: 12,
  color: 'kanap.text.secondary',
  fontVariantNumeric: 'tabular-nums',
} as const;

type CountryChoice = { code: string; name: string };

/**
 * Country picker storing the ISO 3166-1 alpha-2 code and showing the localized name.
 * A stored value that is not a known code (legacy free text) shows as empty.
 */
function CountryPicker({
  value,
  onChange,
  label,
  placeholder,
  disabled,
  error,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
  error?: string;
}) {
  const options: CountryChoice[] = useCountryOptions();
  const code = value.trim().toUpperCase();
  const selected = options.find((option) => option.code === code) ?? null;
  return (
    <Autocomplete<CountryChoice, false, false, false>
      options={options}
      value={selected}
      onChange={(_event, option) => onChange(option?.code ?? '')}
      getOptionLabel={(option) => option.name}
      filterOptions={filterCountryOptions}
      isOptionEqualToValue={(a, b) => a.code === b.code}
      disabled={disabled}
      ListboxProps={{ sx: drawerAutocompleteListboxSx }}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          sx={drawerFieldValueSx}
          placeholder={placeholder}
          error={!!error}
          helperText={error}
          inputProps={{ ...params.inputProps, 'aria-label': label, 'data-invoice-field': 'country' }}
        />
      )}
    />
  );
}

/** A one-line invoicing field: saved on blur (or Enter) when its value changed. */
function InvoiceTextRow({
  field,
  value,
  disabled,
  error,
  invalidMessage,
  onCommit,
}: {
  field: InvoiceTextField;
  value: string;
  disabled: boolean;
  error?: string;
  /** Shown while the field holds its saved value (the server does not accept it). */
  invalidMessage?: string;
  onCommit: (next: string | null) => void;
}) {
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  const message = error ?? (invalidMessage && draft === value ? invalidMessage : undefined);
  return (
    <PropertyRow label={field.label} required={field.required}>
      <TextField
        fullWidth
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          onCommit(draft.trim() || null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        variant="standard"
        type={field.type}
        sx={drawerFieldValueSx}
        placeholder={field.placeholder}
        disabled={disabled}
        error={!!message}
        helperText={message}
        inputProps={{ 'aria-label': field.label, 'data-invoice-field': field.key, autoComplete: field.autoComplete ?? 'off' }}
      />
    </PropertyRow>
  );
}

function InvoicesTable({ invoices, locale, t }: { invoices: BillingInvoice[]; locale: string; t: Translate }) {
  const { mode } = useTheme().palette;
  const [showAll, setShowAll] = React.useState(false);
  const rows = showAll ? invoices : invoices.slice(0, 5);
  return (
    <Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Box
          component="table"
          sx={(theme) => ({
            width: '100%',
            borderCollapse: 'collapse',
            '& th': {
              fontSize: 12,
              fontWeight: 500,
              color: theme.palette.kanap.text.tertiary,
              textAlign: 'left',
              p: '6px 8px',
              borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
              whiteSpace: 'nowrap',
            },
            '& td': {
              fontSize: 13,
              color: theme.palette.kanap.text.primary,
              p: '8px 8px',
              borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
              verticalAlign: 'middle',
              whiteSpace: 'nowrap',
            },
            '& .r': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
            '& tbody tr:hover td': { bgcolor: theme.palette.kanap.bg.hover },
            '& a': { color: theme.palette.kanap.text.primary, textDecoration: 'none' },
            '& a:hover': { color: theme.palette.kanap.teal, textDecoration: 'underline', textUnderlineOffset: '2px' },
          })}
        >
          <thead>
            <tr>
              <th>{t('billing.invoices.columns.number')}</th>
              <th>{t('billing.invoices.columns.date')}</th>
              <th className="r">{t('billing.invoices.columns.amount')}</th>
              <th>{t('billing.invoices.columns.status')}</th>
              <th aria-label={t('billing.invoices.columns.links')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => {
              const status = getInvoiceStatusMeta(invoice.status, t);
              const color = getDotColor(status.color ?? 'default', mode);
              return (
                <tr key={invoice.id}>
                  <td>
                    <Box component="span" sx={invoiceNumberSx}>{invoice.number || '—'}</Box>
                  </td>
                  <td>{formatShortDate(invoice.createdAt, locale, { empty: '—' })}</td>
                  <td className="r">{formatMoney(locale, invoice.total, invoice.currency) ?? '—'}</td>
                  <td>
                    <Box component="span" sx={inlineStatusSx}>
                      <StatusDot color={color} />
                      <Box component="span" sx={{ color, fontWeight: 500 }}>{status.label}</Box>
                    </Box>
                  </td>
                  <td className="r">
                    <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                      {invoice.hostedInvoiceUrl && (
                        <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
                          {t('billing.invoices.actions.view')}
                        </a>
                      )}
                      {invoice.invoicePdf && (
                        <a href={invoice.invoicePdf} target="_blank" rel="noopener noreferrer">
                          {t('billing.invoices.actions.download')}
                        </a>
                      )}
                    </Stack>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Box>
      </Box>
      {invoices.length > 5 && (
        <Box component="button" type="button" onClick={() => setShowAll((prev) => !prev)} sx={{ ...tealLinkSx, fontSize: 13, mt: 1 }}>
          {showAll
            ? t('billing.invoices.actions.showFewer')
            : t('billing.invoices.actions.showAll', { count: invoices.length })}
        </Box>
      )}
    </Box>
  );
}

export default function BillingCenter() {
  const { subscription, claims, refreshMe } = useAuth();
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;
  const [portalError, setPortalError] = React.useState<string | null>(null);
  const [planDialogOpen, setPlanDialogOpen] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [savesInFlight, setSavesInFlight] = React.useState(0);
  const [justSaved, setJustSaved] = React.useState(false);
  const [keeping, setKeeping] = React.useState(false);
  const [keepError, setKeepError] = React.useState<string | null>(null);
  const [payNotice, setPayNotice] = React.useState<PaymentNotice | null>(null);
  const payingRef = React.useRef(false);
  // Back from the card setup page: the plan dialog reopens on the interval to confirm.
  const [confirmInterval, setConfirmInterval] = React.useState<BillingInterval | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const savedTimerRef = React.useRef<number | null>(null);
  // Saves run one after the other, so an answer never overwrites a newer one.
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());

  const canManage = !!claims?.isBillingAdmin;
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['billing-profile'],
    queryFn: getBillingProfile,
  });

  React.useEffect(() => () => {
    if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
  }, []);

  const invoice = profileQuery.data?.invoice;
  const subscriptionSummary = profileQuery.data?.subscription ?? subscription;
  const hasSubscription = !!subscriptionSummary?.stripe_subscription_id;
  const statusMeta = getStatusMeta(subscriptionSummary, t);
  const statusColor = getDotColor(statusMeta.color ?? 'default', mode);
  const { plan: planLine, details: detailParts, cancelled } = subscriptionLines(subscriptionSummary, t, locale);
  const switchLine = scheduledChangeLine(subscriptionSummary, t, locale);
  const isHealthy = subscription?.is_subscription_healthy;
  const unpaid = unpaidLines(subscriptionSummary, t, locale);
  // The plan changes once the invoice is paid (the server refuses it before).
  const paymentPending = isPaymentPending(subscriptionSummary);
  // Nor while its cancellation is set: it is undone first ("Don't cancel").
  const planChangeBlocked = paymentPending
    ? t('planSelection.errors.subscriptionPaymentPending')
    : cancelled ? subscriptionEndingMessage(subscriptionSummary?.canceled_at_effective, t, locale) : null;
  const planActionLabel = hasSubscription ? t('billing.actions.changePlan') : t('billing.actions.choosePlan');
  const invoices = profileQuery.data?.invoices ?? [];
  const invoiceMissingFields = profileQuery.data?.invoice_missing_fields ?? [];
  const savedCountry = savedValue(invoice, 'country');
  const vatRequired = isEuCountry(savedCountry);
  const sectionRef = React.useRef<HTMLDivElement>(null);
  const focusInvoiceOnExit = React.useRef(false);

  const fields: InvoiceTextField[] = [
    { key: 'company', label: t('billing.fields.company'), placeholder: t('billing.placeholders.company'), required: true, autoComplete: 'organization' },
    { key: 'email', label: t('billing.fields.email'), placeholder: t('billing.placeholders.email'), required: true, type: 'email', autoComplete: 'email' },
    { key: 'name', label: t('billing.fields.recipientName'), placeholder: t('billing.placeholders.recipientName') },
    { key: 'phone', label: t('billing.fields.phone'), placeholder: t('billing.placeholders.phone'), autoComplete: 'tel' },
    { key: 'addressLine1', label: t('billing.fields.addressLine1'), placeholder: t('billing.placeholders.addressLine1'), required: true },
    { key: 'addressLine2', label: t('billing.fields.addressLine2'), placeholder: t('billing.placeholders.addressLine2') },
    { key: 'postalCode', label: t('billing.fields.postalCode'), placeholder: t('billing.placeholders.postalCode'), required: true },
    { key: 'city', label: t('billing.fields.city'), placeholder: t('billing.placeholders.city'), required: true },
    { key: 'state', label: t('billing.fields.stateProvince'), placeholder: t('billing.placeholders.stateProvince') },
  ];
  const vatField: InvoiceTextField = {
    key: 'vatNumber',
    label: t('billing.fields.vatNumber'),
    placeholder: t('billing.placeholders.vatNumber'),
    required: vatRequired,
  };

  /**
   * Sends one field. The answer replaces the cached profile's invoicing details, missing
   * fields and invoices, so the plan dialog and the missing line follow what is saved.
   */
  const saveField = (key: InvoiceFieldKey, value: string | null, rollback?: () => void) => {
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    setSavesInFlight((count) => count + 1);
    setJustSaved(false);
    const run = async () => {
      try {
        const data = await updateBillingProfile({ invoice: fieldPatch(key, value) });
        queryClient.setQueryData<BillingProfileResponse | undefined>(['billing-profile'], (prev) => (prev ? {
          ...prev,
          customer: data.customer ?? prev.customer,
          invoice: data.invoice,
          invoice_missing_fields: data.invoice_missing_fields ?? [],
          invoices: data.invoices,
        } : prev));
        return true;
      } catch (error) {
        rollback?.();
        const status = (error as { response?: { status?: number } } | null)?.response?.status;
        const message = key === 'email' && status === 400
          ? t('billing.invoiceDetails.emailFormat')
          : getApiErrorMessage(error, t, t('billing.messages.saveFailed'));
        setFieldErrors((prev) => ({ ...prev, [key]: message }));
        return false;
      }
    };
    const result = chainRef.current.then(run, run);
    chainRef.current = result.catch(() => undefined);
    void result.then((ok) => {
      setSavesInFlight((count) => count - 1);
      if (!ok) return;
      setJustSaved(true);
      if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => {
        savedTimerRef.current = null;
        setJustSaved(false);
      }, 1500);
    });
  };

  const commitText = (key: InvoiceTextField['key'], next: string | null) => {
    if (!invoice || !canManage) return;
    if ((next ?? '') === savedValue(invoice, key)) {
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
      return;
    }
    saveField(key, next);
  };

  /** The country saves at once and shows before the answer (the VAT requirement follows it). */
  const changeCountry = (code: string) => {
    if (!invoice || !canManage) return;
    const next = code || null;
    if ((next ?? '') === savedCountry) return;
    const setCountry = (value: string | null) => queryClient.setQueryData<BillingProfileResponse | undefined>(
      ['billing-profile'],
      (prev) => (prev ? { ...prev, invoice: withField(prev.invoice, 'country', value) } : prev),
    );
    const previous = savedCountry || null;
    setCountry(next);
    saveField('country', next, () => setCountry(previous));
  };

  const handleCompleteInvoiceDetails = () => {
    focusInvoiceOnExit.current = true;
    setPlanDialogOpen(false);
  };

  // Runs once the plan dialog has closed (and given focus back), then moves to the first missing field.
  const handlePlanDialogExited = () => {
    if (!focusInvoiceOnExit.current) return;
    focusInvoiceOnExit.current = false;
    const section = sectionRef.current;
    if (!section) return;
    section.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    const firstMissing = invoiceMissingFields[0];
    const target =
      (firstMissing ? section.querySelector<HTMLInputElement>(`input[data-invoice-field="${firstMissing}"]`) : null) ??
      section.querySelector<HTMLInputElement>('input:not([disabled])');
    target?.focus({ preventScroll: true });
  };

  /** The Stripe customer portal; `payOnReturn` comes back with `pay_invoice=1` to pay the open invoice. */
  const openPortal = async (payOnReturn = false) => {
    setPortalError(null);
    setOpening(true);
    try {
      const returnUrl = window.location.origin + '/admin/billing' + (payOnReturn ? '?pay_invoice=1' : '');
      const res = await api.post('/billing/portal', { returnUrl });
      const url = res.data?.url;
      if (url) {
        if (payOnReturn) markPayOnReturn();
        window.location.href = url;
      } else {
        setPortalError(t('billing.messages.portalUnavailable'));
      }
    } catch (e: any) {
      setPortalError(getApiErrorMessage(e, t, t('billing.messages.portalFailed')));
    } finally {
      setOpening(false);
    }
  };

  /** "Keep annual": cancels the planned switch; the answer is the subscription summary. */
  const keepCurrentPlan = async () => {
    setKeepError(null);
    setKeeping(true);
    try {
      const res = await api.post<BillingSubscription>('/billing/scheduled-change/cancel');
      queryClient.setQueryData<BillingProfileResponse | undefined>(['billing-profile'], (prev) => (
        prev ? { ...prev, subscription: res.data } : prev
      ));
    } catch (e: any) {
      setKeepError(getApiErrorMessage(e, t, t('billing.messages.keepFailed')));
    } finally {
      setKeeping(false);
    }
  };

  // The portal returns with `pay_invoice=1` once the card is updated: the open invoice is charged
  // on it now. Once per return (the server also takes the payment only once), and only when this
  // browser session opened the portal to pay: the address alone pays nothing.
  const payOnReturn = searchParams.get('pay_invoice') === '1';
  React.useEffect(() => {
    if (!payOnReturn) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('pay_invoice');
      return next;
    }, { replace: true });
    if (!canManage || payingRef.current) return;
    if (!takePayOnReturnMark()) return;
    payingRef.current = true;
    void (async () => {
      setPayNotice(null);
      try {
        const res = await api.post<BillingSubscription & { payment?: { status?: InvoicePaymentStatus } }>('/billing/pay-invoice');
        const { payment, ...summary } = res.data ?? {};
        // A read still running started before the payment: drop it, show the answer, then read
        // again for the invoice list.
        await queryClient.cancelQueries({ queryKey: ['billing-profile'] });
        queryClient.setQueryData<BillingProfileResponse | undefined>(['billing-profile'], (prev) => (
          prev ? { ...prev, subscription: summary } : prev
        ));
        void queryClient.invalidateQueries({ queryKey: ['billing-profile'] });
        // The banner and the redirect follow the subscription, whatever the answer (another tab
        // may have paid the invoice).
        void refreshMe?.();
        setPayNotice(paymentNotice(payment?.status, summary, t));
      } catch (e: any) {
        setPayNotice({ tone: 'error', text: getApiErrorMessage(e, t, t('billing.messages.payFailed')) });
      } finally {
        payingRef.current = false;
      }
    })();
  }, [payOnReturn, canManage, setSearchParams, queryClient, refreshMe, t]);

  // The card setup page returns with `card_saved=<interval>`: confirm the switch in the plan dialog.
  const cardSaved = searchParams.get('card_saved');
  React.useEffect(() => {
    if (cardSaved !== 'monthly' && cardSaved !== 'annual') return;
    if (canManage) {
      setConfirmInterval(cardSaved);
      setPlanDialogOpen(true);
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('card_saved');
      return next;
    }, { replace: true });
  }, [cardSaved, canManage, setSearchParams]);

  // Auto-open plan dialog when subscription is unhealthy, unless it still runs unpaid: paying is the way out.
  const signInPaymentPending = isPaymentPending(subscription);
  const isHealthyRef = React.useRef(isHealthy);
  React.useEffect(() => {
    if (isHealthy === false && !signInPaymentPending && canManage && isHealthyRef.current === undefined) {
      setPlanDialogOpen(true);
    }
    isHealthyRef.current = isHealthy;
  }, [isHealthy, signInPaymentPending, canManage]);

  const saveStatus = savesInFlight > 0
    ? t('common:status.saving', { defaultValue: 'Saving…' })
    : justSaved ? t('common:status.saved', { defaultValue: 'Saved' }) : null;
  const missingLine = invoiceMissingFields.length > 0
    ? t('billing.invoiceDetails.missing', {
      fields: invoiceMissingFields
        .map((key) => t(`planSelection.invoiceFields.${key}`, { defaultValue: key }))
        .join(', '),
    })
    : null;
  // The saved VAT number is filled in but the server does not accept its format.
  const vatMalformed = invoiceMissingFields.includes('vatNumber') && savedValue(invoice, 'vatNumber').trim().length > 0;
  const disabled = !canManage;

  const renderTextRow = (field: InvoiceTextField) => (
    <InvoiceTextRow
      key={field.key}
      field={field}
      value={savedValue(invoice, field.key)}
      disabled={disabled}
      error={fieldErrors[field.key]}
      invalidMessage={field.key === 'vatNumber' && vatMalformed ? t('billing.invoiceDetails.vatNumberFormat') : undefined}
      onCommit={(next) => commitText(field.key, next)}
    />
  );

  return (
    <>
      <PageHeader title={t('billing.title')} />
      <Stack spacing={4} sx={{ maxWidth: 960 }}>
        {(!!portalError || !!keepError || profileQuery.isError) && (
          <Stack spacing={1}>
            {!!portalError && <Alert severity="error">{portalError}</Alert>}
            {!!keepError && <Alert severity="error">{keepError}</Alert>}
            {profileQuery.isError && (
              <Alert severity="error">{getApiErrorMessage(profileQuery.error, t, t('billing.messages.loadFailed'))}</Alert>
            )}
          </Stack>
        )}

        <Box component="section">
          <Box sx={sectionHeadSx}>
            <Typography component="h2" sx={sectionTitleSx}>{t('billing.subscription.title')}</Typography>
          </Box>
          <Box sx={summarySx}>
            <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {planLine && (
                <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary', lineHeight: 1.4 }}>
                  {planLine}
                </Typography>
              )}
              <Box sx={{ ...inlineStatusSx, flexWrap: 'wrap', fontSize: 13, lineHeight: 1.4, color: 'kanap.text.secondary' }}>
                <StatusDot color={statusColor} />
                <Box component="span" sx={{ color: statusColor, fontWeight: 500 }}>{statusMeta.label}</Box>
                {detailParts.map((part) => (
                  <Box component="span" key={part}>{`· ${part}`}</Box>
                ))}
                {cancelled && canManage && (
                  // The cancellation is taken back in the Stripe customer portal.
                  <Box component="button" type="button" onClick={() => openPortal()} disabled={opening} sx={keepActionSx}>
                    {t('billing.subscription.keepSubscription')}
                  </Box>
                )}
              </Box>
              {unpaid && (
                <Box sx={unpaidLineSx}>
                  <StatusDot color={getDotColor(unpaid.frozen ? 'error' : 'warning', mode)} />
                  <span>{unpaid.invoice}</span>
                </Box>
              )}
              {unpaid?.access && (
                <Box sx={unpaidLineSx}>
                  <StatusDot color={getDotColor(unpaid.frozen ? 'error' : 'warning', mode)} />
                  <span>{unpaid.access}</span>
                </Box>
              )}
              {switchLine && (
                <Typography component="div" sx={{ fontSize: 13, lineHeight: 1.4, color: 'kanap.text.secondary' }}>
                  {switchLine.text}
                  {canManage && (
                    <>
                      {' '}
                      <Box component="button" type="button" onClick={keepCurrentPlan} disabled={keeping} sx={keepActionSx}>
                        {switchLine.keepLabel}
                      </Box>
                    </>
                  )}
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
              {unpaid?.payable && !unpaid.onInvoicePage && (
                <Button variant="contained" size="small" onClick={() => openPortal(true)} disabled={!canManage || opening}>
                  {t('billing.actions.updateCardAndPay')}
                </Button>
              )}
              {unpaid?.payable && unpaid.onInvoicePage && unpaid.invoiceUrl && (
                <Button
                  variant="contained"
                  size="small"
                  component="a"
                  href={unpaid.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('billing.actions.payInvoice')}
                </Button>
              )}
              {planChangeBlocked ? (
                <Tooltip title={planChangeBlocked}>
                  <span>
                    <Button variant="action" size="small" disabled>
                      {planActionLabel}
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button
                  variant={isHealthy === false ? 'contained' : 'action'}
                  size="small"
                  onClick={() => setPlanDialogOpen(true)}
                  disabled={!canManage}
                >
                  {planActionLabel}
                </Button>
              )}
              {hasSubscription && (
                <Button variant="action" size="small" onClick={() => openPortal()} disabled={!canManage || opening}>
                  {opening ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : t('billing.actions.managePayment')}
                </Button>
              )}
            </Stack>
          </Box>
          {payNotice && (
            <Box role={payNotice.tone === 'error' ? 'alert' : 'status'} sx={{ ...unpaidLineSx, mt: 1 }}>
              <StatusDot color={getDotColor(payNotice.tone, mode)} />
              <span>{payNotice.text}</span>
              {payNotice.invoiceUrl && (
                <Box component="a" href={payNotice.invoiceUrl} target="_blank" rel="noopener noreferrer" sx={{ ...tealLinkSx, fontSize: 13 }}>
                  {t('billing.payment.openInvoice')}
                </Box>
              )}
            </Box>
          )}
          {!canManage && (
            <Typography sx={{ display: 'block', mt: 1, fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('shared.billingAdminRequired')}
            </Typography>
          )}
        </Box>

        <Box component="section" ref={sectionRef}>
          <Box sx={sectionHeadSx}>
            <Typography component="h2" sx={sectionTitleSx}>{t('billing.invoiceDetails.title')}</Typography>
            {saveStatus && <Typography sx={saveStatusSx} role="status">{saveStatus}</Typography>}
          </Box>
          {invoice && (
            <>
              <Box sx={twoColumnsSx}>
                {fields.map(renderTextRow)}
                <PropertyRow label={t('billing.fields.country')} required>
                  <CountryPicker
                    label={t('billing.fields.country')}
                    placeholder={t('billing.placeholders.country')}
                    value={savedCountry}
                    onChange={changeCountry}
                    disabled={disabled}
                    error={fieldErrors.country}
                  />
                </PropertyRow>
                {renderTextRow(vatField)}
              </Box>
              {missingLine && (
                <Box sx={{ ...inlineStatusSx, mt: 1.5, fontSize: 13, color: 'kanap.text.secondary' }}>
                  <StatusDot color={getDotColor('warning', mode)} />
                  <span>{missingLine}</span>
                </Box>
              )}
            </>
          )}
        </Box>

        {invoices.length > 0 && (
          <Box component="section">
            <Box sx={sectionHeadSx}>
              <Typography component="h2" sx={sectionTitleSx}>{t('billing.invoices.title')}</Typography>
            </Box>
            <InvoicesTable invoices={invoices} locale={locale} t={t} />
          </Box>
        )}
      </Stack>

      <PlanSelectionDialog
        open={planDialogOpen}
        onClose={() => {
          setPlanDialogOpen(false);
          setConfirmInterval(null);
        }}
        initialInterval={confirmInterval ?? undefined}
        notice={confirmInterval ? t('planSelection.messages.cardSaved') : null}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['billing-profile'] });
        }}
        invoiceMissingFields={invoiceMissingFields}
        subscription={subscriptionSummary}
        onCompleteInvoiceDetails={handleCompleteInvoiceDetails}
        onExited={handlePlanDialogExited}
      />
    </>
  );
}
