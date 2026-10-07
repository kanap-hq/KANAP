import React from 'react';
import PageHeader from '../../components/PageHeader';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { ChipProps } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getDotColor } from '../../utils/statusColors';
import { StatusDot } from '../../components/design';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import api from '../../api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '../../i18n/useLocale';
import {
  BillingContact,
  BillingProfileResponse,
  BillingProfileUpdateResponse,
  BillingSubscription,
  BillingInvoice,
  getBillingProfile,
  updateBillingProfile,
} from '../../services/billing';
import PlanSelectionDialog from './PlanSelectionPage';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { isEuCountry } from '../../utils/billingProfile';
import { COUNTRY_OPTIONS } from '../../constants/isoOptions';
import { useCountryName } from '../coa/coaRoles';

type BillingContactForm = {
  name: string;
  company: string;
  email: string;
  phone: string;
  vatNumber: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
};

const EMPTY_FORM: BillingContactForm = {
  name: '',
  company: '',
  email: '',
  phone: '',
  vatNumber: '',
  address: {
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  },
};

function contactToForm(contact: BillingContact | undefined): BillingContactForm {
  if (!contact) return { ...EMPTY_FORM, address: { ...EMPTY_FORM.address } };
  return {
    name: contact.name ?? '',
    company: contact.company ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    vatNumber: contact.vatNumber ?? '',
    address: {
      line1: contact.address?.line1 ?? '',
      line2: contact.address?.line2 ?? '',
      city: contact.address?.city ?? '',
      state: contact.address?.state ?? '',
      postalCode: contact.address?.postalCode ?? '',
      country: contact.address?.country ?? '',
    },
  };
}

function cloneForm(form: BillingContactForm): BillingContactForm {
  return {
    ...form,
    address: { ...form.address },
  };
}

function normaliseValue(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function formToPayload(form: BillingContactForm): Partial<BillingContact> {
  return {
    name: normaliseValue(form.name),
    company: normaliseValue(form.company),
    email: normaliseValue(form.email),
    phone: normaliseValue(form.phone),
    vatNumber: normaliseValue(form.vatNumber),
    address: {
      line1: normaliseValue(form.address.line1),
      line2: normaliseValue(form.address.line2),
      city: normaliseValue(form.address.city),
      state: normaliseValue(form.address.state),
      postalCode: normaliseValue(form.address.postalCode),
      // The picker stores ISO codes; a legacy free-text value is sent back as it was.
      country: normaliseValue(form.address.country),
    },
  };
}

function formsEqual(a: BillingContactForm, b: BillingContactForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatMoney(locale: string, amount?: number | null, currency?: string | null) {
  if (amount == null || !currency) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${amount / 100} ${currency.toUpperCase()}`;
  }
}

function formatDate(locale: string, value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(locale: string, value?: string | null) {
  return formatDate(locale, value);
}

const STATUS_META: Record<string, { label: string; color: ChipProps['color'] }> = {
  active: { label: 'Active', color: 'success' },
  trialing: { label: 'Trialing', color: 'info' },
  incomplete: { label: 'Incomplete', color: 'warning' },
  incomplete_expired: { label: 'Incomplete (expired)', color: 'default' },
  past_due: { label: 'Past due', color: 'warning' },
  canceled: { label: 'Canceled', color: 'default' },
  unpaid: { label: 'Unpaid', color: 'error' },
  paused: { label: 'Paused', color: 'warning' },
};

const INVOICE_STATUS_META: Record<string, { label: string; color: ChipProps['color'] }> = {
  draft: { label: 'Draft', color: 'default' },
  open: { label: 'Open', color: 'warning' },
  paid: { label: 'Paid', color: 'success' },
  void: { label: 'Voided', color: 'default' },
  uncollectible: { label: 'Uncollectible', color: 'error' },
};

function derivePlanLabel(
  subscription: BillingSubscription | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!subscription) return '—';
  // Local trial (no Stripe subscription)
  if (subscription.status === 'trialing' && !subscription.stripe_subscription_id) return t('billing.subscription.planLabels.freeTrial');
  return subscription.plan_name || '—';
}

function formatSubscriptionType(
  subscription: BillingSubscription | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!subscription?.subscription_type) return '—';
  return subscription.subscription_type === 'annual'
    ? t('billing.subscription.values.annual')
    : t('billing.subscription.values.monthly');
}

function formatCollectionMethod(
  subscription: BillingSubscription | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!subscription?.collection_method) return t('billing.subscription.values.automaticCharge');
  return subscription.collection_method === 'send_invoice'
    ? t('billing.subscription.values.invoiceManualPayment')
    : t('billing.subscription.values.automaticCharge');
}

function formatPaymentMode(
  subscription: BillingSubscription | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!subscription?.payment_mode) return t('billing.subscription.values.card');
  return subscription.payment_mode === 'bank_transfer'
    ? t('billing.subscription.values.bankTransfer')
    : t('billing.subscription.values.card');
}

function getStatusMeta(
  subscription: BillingSubscription | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; color: ChipProps['color'] } {
  if (subscription?.status) {
    const meta = STATUS_META[subscription.status];
    return meta
      ? { ...meta, label: t(`billing.statuses.${subscription.status}`, { defaultValue: meta.label }) }
      : { label: subscription.status.replace(/_/g, ' '), color: 'default' };
  }
  if (!subscription?.stripe_subscription_id) {
    return { label: t('billing.statuses.notSubscribed'), color: 'default' };
  }
  return { label: t('billing.statuses.pending'), color: 'default' };
}

function getInvoiceStatusMetaFromStatus(
  status: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; color: ChipProps['color'] } {
  if (!status) return { label: '—', color: 'default' };
  const meta = INVOICE_STATUS_META[status];
  return meta
    ? { ...meta, label: t(`billing.invoiceStatuses.${status}`, { defaultValue: meta.label }) }
    : { label: status.replace(/_/g, ' '), color: 'default' };
}

type CountryChoice = { code: string; name: string };

/**
 * Country picker storing the ISO 3166-1 alpha-2 code and showing the localized name.
 * A stored value that is not a known code (legacy free text) shows as empty.
 */
function CountryPicker({
  value,
  onChange,
  label,
  required,
  disabled,
  fieldKey,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
  required?: boolean;
  disabled?: boolean;
  fieldKey?: string;
}) {
  const countryName = useCountryName();
  const options = React.useMemo<CountryChoice[]>(
    () => COUNTRY_OPTIONS
      .map((option) => ({ code: option.code.toUpperCase(), name: countryName(option.code) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [countryName],
  );
  const code = value.trim().toUpperCase();
  const selected = options.find((option) => option.code === code) ?? null;
  return (
    <Autocomplete<CountryChoice, false, false, false>
      options={options}
      value={selected}
      onChange={(_event, option) => onChange(option?.code ?? '')}
      getOptionLabel={(option) => option.name}
      isOptionEqualToValue={(a, b) => a.code === b.code}
      disabled={disabled}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          inputProps={{ ...params.inputProps, ...(fieldKey ? { 'data-invoice-field': fieldKey } : {}) }}
        />
      )}
    />
  );
}

type SummaryItemProps = {
  label: string;
  children: React.ReactNode;
};

function SummaryItem({ label, children }: SummaryItemProps) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box>{children}</Box>
    </Box>
  );
}

export default function BillingCenter() {
  const { subscription, claims } = useAuth();
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;
  const [portalError, setPortalError] = React.useState<string | null>(null);
  const [planDialogOpen, setPlanDialogOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [formSuccess, setFormSuccess] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState(false);
  const [customerForm, setCustomerForm] = React.useState<BillingContactForm>(cloneForm(EMPTY_FORM));
  const [invoiceForm, setInvoiceForm] = React.useState<BillingContactForm>(cloneForm(EMPTY_FORM));
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = React.useState(false);
  const [showAllInvoices, setShowAllInvoices] = React.useState(false);

  const canManage = !!claims?.isBillingAdmin;
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['billing-profile'],
    queryFn: getBillingProfile,
  });

  React.useEffect(() => {
    if (profileQuery.data) {
      setCustomerForm(contactToForm(profileQuery.data.customer));
      setInvoiceForm(contactToForm(profileQuery.data.invoice));
      setShowAllInvoices(false);
    }
  }, [profileQuery.data]);

  const baseCustomerForm = React.useMemo(
    () => contactToForm(profileQuery.data?.customer),
    [profileQuery.data?.customer],
  );
  const baseInvoiceForm = React.useMemo(
    () => contactToForm(profileQuery.data?.invoice),
    [profileQuery.data?.invoice],
  );

  const isDirty = profileQuery.data
    ? !formsEqual(customerForm, baseCustomerForm) || !formsEqual(invoiceForm, baseInvoiceForm)
    : false;

  const updateMutation = useMutation<
    BillingProfileUpdateResponse,
    any,
    { customer: Partial<BillingContact>; invoice: Partial<BillingContact> }
  >({
    mutationFn: (payload: { customer: Partial<BillingContact>; invoice: Partial<BillingContact> }) =>
      updateBillingProfile(payload),
    onSuccess: (data: BillingProfileUpdateResponse) => {
      setFormError(null);
      setFormSuccess(t('billing.messages.updateSuccess'));
      setCheckoutError(null);
      const nextCustomer = contactToForm(data.customer);
      const nextInvoice = contactToForm(data.invoice);
      setCustomerForm(nextCustomer);
      setInvoiceForm(nextInvoice);
      queryClient.setQueryData<BillingProfileResponse | undefined>(['billing-profile'], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          customer: data.customer,
          invoice: data.invoice,
          invoice_missing_fields: data.invoice_missing_fields,
          invoices: data.invoices,
        };
      });
    },
    onError: (err: any) => {
      setFormSuccess(null);
      setFormError(getApiErrorMessage(err, t, t('billing.messages.saveFailed')));
      setCheckoutError(null);
    },
  });

  const subscriptionSummary = profileQuery.data?.subscription ?? subscription;
  const loadingProfile = (profileQuery.isLoading && !profileQuery.data) || profileQuery.isFetching;
  const hasSubscription = !!subscriptionSummary?.stripe_subscription_id;
  const subscriptionStatus = subscriptionSummary?.status ?? null;
  const planLabel = React.useMemo(() => derivePlanLabel(subscriptionSummary, t), [subscriptionSummary, t]);
  const statusMeta = React.useMemo(() => getStatusMeta(subscriptionSummary, t), [subscriptionSummary, t]);
  const frequencyLabel = React.useMemo(() => formatSubscriptionType(subscriptionSummary, t), [subscriptionSummary, t]);
  const collectionLabel = React.useMemo(() => formatCollectionMethod(subscriptionSummary, t), [subscriptionSummary, t]);
  const paymentModeLabel = React.useMemo(() => formatPaymentMode(subscriptionSummary, t), [subscriptionSummary, t]);
  const amountLabel = formatMoney(
    locale,
    subscriptionSummary?.amount ?? subscriptionSummary?.estimated_amount ?? null,
    subscriptionSummary?.currency ?? subscriptionSummary?.estimated_currency ?? null
  );
  const paymentMethodLabel = (() => {
    if (!subscriptionSummary?.default_payment_method_id) return paymentModeLabel;
    if (subscriptionSummary.default_payment_method_brand && subscriptionSummary.default_payment_method_last4) {
      return `${subscriptionSummary.default_payment_method_brand.toUpperCase()} •••• ${subscriptionSummary.default_payment_method_last4}`;
    }
    if (subscriptionSummary.default_payment_method_brand) return subscriptionSummary.default_payment_method_brand.toUpperCase();
    return paymentModeLabel;
  })();
  const renewalLabel = formatDate(
    locale,
    subscriptionSummary?.renewal_at ??
    subscriptionSummary?.current_period_end ??
    subscriptionSummary?.next_payment_at ??
    subscriptionSummary?.payment_due_at ??
    null
  );
  const trialLabel = subscriptionSummary?.trial_end ? formatDate(locale, subscriptionSummary.trial_end) : null;
  const lastSyncedLabel = formatDateTime(locale, subscriptionSummary?.last_synced_at);
  const allowPortal = hasSubscription;
  const isTrialing = subscriptionStatus === 'trialing';
  const isLocalTrial = isTrialing && !hasSubscription;
  const trialDaysRemaining = subscription?.trial_days_remaining;
  const isHealthy = subscription?.is_subscription_healthy;
  const planActionLabel = hasSubscription ? t('billing.actions.changePlan') : t('billing.actions.choosePlan');
  const invoices = profileQuery.data?.invoices ?? [];
  const invoicesToShow = showAllInvoices ? invoices : invoices.slice(0, 5);
  const canToggleInvoices = invoices.length > 5;
  const invoiceMissingFields = profileQuery.data?.invoice_missing_fields ?? [];
  const invoiceVatRequired = isEuCountry(invoiceForm.address.country);
  const invoiceCardRef = React.useRef<HTMLDivElement>(null);
  const focusInvoiceOnExit = React.useRef(false);

  const handleCompleteInvoiceDetails = () => {
    focusInvoiceOnExit.current = true;
    setPlanDialogOpen(false);
  };

  // Runs once the plan dialog has closed (and given focus back), then moves to the card.
  const handlePlanDialogExited = () => {
    if (!focusInvoiceOnExit.current) return;
    focusInvoiceOnExit.current = false;
    const card = invoiceCardRef.current;
    if (!card) return;
    card.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    const firstMissing = invoiceMissingFields[0];
    const target =
      (firstMissing ? card.querySelector<HTMLInputElement>(`input[data-invoice-field="${firstMissing}"]`) : null) ??
      card.querySelector<HTMLInputElement>('input:not([disabled])');
    target?.focus({ preventScroll: true });
  };

  const openPortal = async () => {
    setPortalError(null);
    setCheckoutError(null);
    setOpening(true);
    try {
      const res = await api.post('/billing/portal', { returnUrl: window.location.origin + '/admin/billing' });
      const url = res.data?.url;
      if (url) window.location.href = url;
      else setPortalError(t('billing.messages.portalUnavailable'));
    } catch (e: any) {
      setPortalError(getApiErrorMessage(e, t, t('billing.messages.portalFailed')));
    } finally {
      setOpening(false);
    }
  };

  // Auto-open plan dialog when subscription is unhealthy
  const isHealthyRef = React.useRef(isHealthy);
  React.useEffect(() => {
    if (isHealthy === false && canManage && isHealthyRef.current === undefined) {
      setPlanDialogOpen(true);
    }
    isHealthyRef.current = isHealthy;
  }, [isHealthy, canManage]);

  const handleContactChange = (section: 'customer' | 'invoice', field: keyof BillingContactForm) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormError(null);
      setFormSuccess(null);
      setCheckoutError(null);
      if (section === 'customer') {
        setCustomerForm((prev) => ({ ...prev, [field]: value }));
      } else {
        setInvoiceForm((prev) => ({ ...prev, [field]: value }));
      }
    };

  const handleAddressChange = (
    section: 'customer' | 'invoice',
    field: keyof BillingContactForm['address'],
  ) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setFormError(null);
    setFormSuccess(null);
    setCheckoutError(null);
    if (section === 'customer') {
      setCustomerForm((prev) => ({ ...prev, address: { ...prev.address, [field]: value } }));
    } else {
      setInvoiceForm((prev) => ({ ...prev, address: { ...prev.address, [field]: value } }));
    }
  };

  const handleCountryChange = (section: 'customer' | 'invoice') => (code: string) => {
    setFormError(null);
    setFormSuccess(null);
    setCheckoutError(null);
    if (section === 'customer') {
      setCustomerForm((prev) => ({ ...prev, address: { ...prev.address, country: code } }));
    } else {
      setInvoiceForm((prev) => ({ ...prev, address: { ...prev.address, country: code } }));
    }
  };

  const handleCopyFromCustomer = () => {
    setFormError(null);
    setFormSuccess(null);
    setCheckoutError(null);
    setInvoiceForm(cloneForm(customerForm));
  };

  const handleReset = () => {
    if (!profileQuery.data) return;
    setFormError(null);
    setFormSuccess(null);
    setCheckoutError(null);
    setCustomerForm(contactToForm(profileQuery.data.customer));
    setInvoiceForm(contactToForm(profileQuery.data.invoice));
  };

  const handleSave = () => {
    if (!profileQuery.data) return;
    setCheckoutError(null);
    updateMutation.mutate({
      customer: formToPayload(customerForm),
      invoice: formToPayload(invoiceForm),
    });
  };

  return (
    <>
      <PageHeader title={t('billing.title')} />
      <Stack spacing={2}>
        {!!checkoutError && <Alert severity="error">{checkoutError}</Alert>}
        {!!portalError && <Alert severity="error">{portalError}</Alert>}
        {profileQuery.isError && (
          <Alert severity="error">{getApiErrorMessage(profileQuery.error, t, t('billing.messages.loadFailed'))}</Alert>
        )}
        {!!formError && <Alert severity="error">{formError}</Alert>}
        {!!formSuccess && <Alert severity="success">{formSuccess}</Alert>}
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">{t('billing.subscription.title')}</Typography>
              <Grid container spacing={3} alignItems="flex-start">
                <Grid item xs={12} sm={6} md={3}>
                  <SummaryItem label={t('billing.subscription.labels.plan')}>
                    <Typography fontWeight={600}>{planLabel}</Typography>
                  </SummaryItem>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <SummaryItem label={t('billing.subscription.labels.status')}>
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                      <StatusDot color={getDotColor(statusMeta.color ?? 'default', mode)} />
                      <Typography variant="body2" sx={{ color: getDotColor(statusMeta.color ?? 'default', mode), fontWeight: 500, fontSize: '0.8125rem', textTransform: 'capitalize' }}>{statusMeta.label}</Typography>
                    </Box>
                  </SummaryItem>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <SummaryItem label={t('billing.subscription.labels.renewalDate')}>
                    <Typography>{renewalLabel}</Typography>
                  </SummaryItem>
                </Grid>
                {!isLocalTrial && (
                  <>
                    <Grid item xs={12} sm={6} md={3}>
                      <SummaryItem label={t('billing.subscription.labels.amountPerPeriod')}>
                        <Typography>{amountLabel}</Typography>
                      </SummaryItem>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <SummaryItem label={t('billing.subscription.labels.billingFrequency')}>
                        <Typography>{frequencyLabel}</Typography>
                      </SummaryItem>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <SummaryItem label={t('billing.subscription.labels.collectionMethod')}>
                        <Typography>{collectionLabel}</Typography>
                      </SummaryItem>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <SummaryItem label={t('billing.subscription.labels.paymentMethod')}>
                        <Typography>{paymentMethodLabel}</Typography>
                      </SummaryItem>
                    </Grid>
                  </>
                )}
                {trialLabel && trialLabel !== '—' && (
                  <Grid item xs={12} sm={6} md={3}>
                    <SummaryItem label={t('billing.subscription.labels.trialEnds')}>
                      <Typography>{trialLabel}</Typography>
                    </SummaryItem>
                  </Grid>
                )}
                {!isLocalTrial && (
                  <Grid item xs={12} sm={6} md={3}>
                    <SummaryItem label={t('billing.subscription.labels.lastStripeSync')}>
                      <Typography>{lastSyncedLabel}</Typography>
                    </SummaryItem>
                  </Grid>
                )}
                {isTrialing && trialDaysRemaining != null && trialDaysRemaining > 0 && (
                  <Grid item xs={12} md={4}>
                    <SummaryItem label={t('billing.subscription.labels.trial')}>
                      <Typography>{t('billing.subscription.values.daysRemaining', { count: trialDaysRemaining })}</Typography>
                    </SummaryItem>
                  </Grid>
                )}
                <Grid item xs={12} md={4}>
                  <SummaryItem label={t('billing.subscription.labels.actions')}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row', md: 'column' }}
                      spacing={1}
                      alignItems={{ xs: 'stretch', sm: 'center', md: 'flex-start' }}
                    >
                      <Button
                        variant={isHealthy ? 'outlined' : 'contained'}
                        onClick={() => setPlanDialogOpen(true)}
                        disabled={!canManage}
                      >
                        {planActionLabel}
                      </Button>
                      {allowPortal && (
                        <Button
                          variant={isHealthy ? 'contained' : 'outlined'}
                          onClick={openPortal}
                          disabled={!canManage || opening}
                        >
                          {opening ? <CircularProgress size={20} sx={{ color: 'inherit' }} /> : t('billing.actions.manageSubscription')}
                        </Button>
                      )}
                    </Stack>
                    {!canManage && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        {t('shared.billingAdminRequired')}
                      </Typography>
                    )}
                  </SummaryItem>
                </Grid>
              </Grid>
            </Stack>
          </CardContent>
        </Card>

        {invoices.length > 0 && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>{t('billing.invoices.title')}</Typography>
              <Stack spacing={1.5}>
                {invoicesToShow.map((invoice: BillingInvoice) => {
                  const statusMeta = getInvoiceStatusMetaFromStatus(invoice.status, t);
                  return (
                    <Stack
                      key={invoice.id}
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={1.5}
                      alignItems={{ xs: 'flex-start', md: 'center' }}
                    >
                      <Box sx={{ minWidth: 160 }}>
                        <Typography fontWeight={600}>{invoice.number || invoice.id}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {invoice.createdAt ? formatDate(locale, invoice.createdAt) : '—'}
                        </Typography>
                      </Box>
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                        <StatusDot color={getDotColor(statusMeta.color ?? 'default', mode)} />
                        <Typography variant="body2" sx={{ color: getDotColor(statusMeta.color ?? 'default', mode), fontWeight: 500, fontSize: '0.8125rem', textTransform: 'capitalize' }}>{statusMeta.label}</Typography>
                      </Box>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography>{formatMoney(locale, invoice.total, invoice.currency)}</Typography>
                      </Box>
                      <Stack direction="row" spacing={1}>
                        {invoice.hostedInvoiceUrl && (
                          <Button
                            component="a"
                            href={invoice.hostedInvoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="small"
                          >
                            {t('billing.invoices.actions.view')}
                          </Button>
                        )}
                        {invoice.invoicePdf && (
                          <Button
                            component="a"
                            href={invoice.invoicePdf}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="small"
                          >
                            {t('billing.invoices.actions.download')}
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  );
                })}
              </Stack>
              {canToggleInvoices && (
                <Button
                  variant="text"
                  size="small"
                  sx={{ mt: 2 }}
                  onClick={() => setShowAllInvoices((prev) => !prev)}
                >
                  {showAllInvoices ? t('billing.invoices.actions.showFewer') : t('billing.invoices.actions.showMore')}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('billing.customer.title')}</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.customerName')}
                  value={customerForm.name}
                  onChange={handleContactChange('customer', 'name')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.company')}
                  value={customerForm.company}
                  onChange={handleContactChange('customer', 'company')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.email')}
                  type="email"
                  value={customerForm.email}
                  onChange={handleContactChange('customer', 'email')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                  autoComplete="email"
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.phone')}
                  value={customerForm.phone}
                  onChange={handleContactChange('customer', 'phone')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.vatNumber')}
                  value={customerForm.vatNumber}
                  onChange={handleContactChange('customer', 'vatNumber')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.addressLine1')}
                  value={customerForm.address.line1}
                  onChange={handleAddressChange('customer', 'line1')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.addressLine2')}
                  value={customerForm.address.line2}
                  onChange={handleAddressChange('customer', 'line2')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label={t('billing.fields.city')}
                  value={customerForm.address.city}
                  onChange={handleAddressChange('customer', 'city')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label={t('billing.fields.stateProvince')}
                  value={customerForm.address.state}
                  onChange={handleAddressChange('customer', 'state')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label={t('billing.fields.postalCode')}
                  value={customerForm.address.postalCode}
                  onChange={handleAddressChange('customer', 'postalCode')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <CountryPicker
                  label={t('billing.fields.country')}
                  value={customerForm.address.country}
                  onChange={handleCountryChange('customer')}
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card variant="outlined" ref={invoiceCardRef}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6">{t('billing.invoiceDetails.title')}</Typography>
              <Button
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={handleCopyFromCustomer}
                disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
              >
                {t('billing.invoiceDetails.copyFromCustomer')}
              </Button>
            </Stack>
            <Grid container spacing={2} sx={{ '& .MuiFormLabel-asterisk': { color: 'warning.main' } }}>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.recipientName')}
                  value={invoiceForm.name}
                  onChange={handleContactChange('invoice', 'name')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.company')}
                  value={invoiceForm.company}
                  onChange={handleContactChange('invoice', 'company')}
                  fullWidth
                  required
                  inputProps={{ 'data-invoice-field': 'company' }}
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.email')}
                  type="email"
                  value={invoiceForm.email}
                  onChange={handleContactChange('invoice', 'email')}
                  fullWidth
                  required
                  inputProps={{ 'data-invoice-field': 'email' }}
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                  autoComplete="email"
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.phone')}
                  value={invoiceForm.phone}
                  onChange={handleContactChange('invoice', 'phone')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.vatNumber')}
                  value={invoiceForm.vatNumber}
                  onChange={handleContactChange('invoice', 'vatNumber')}
                  fullWidth
                  required={invoiceVatRequired}
                  inputProps={{ 'data-invoice-field': 'vatNumber' }}
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.addressLine1')}
                  value={invoiceForm.address.line1}
                  onChange={handleAddressChange('invoice', 'line1')}
                  fullWidth
                  required
                  inputProps={{ 'data-invoice-field': 'addressLine1' }}
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label={t('billing.fields.addressLine2')}
                  value={invoiceForm.address.line2}
                  onChange={handleAddressChange('invoice', 'line2')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label={t('billing.fields.city')}
                  value={invoiceForm.address.city}
                  onChange={handleAddressChange('invoice', 'city')}
                  fullWidth
                  required
                  inputProps={{ 'data-invoice-field': 'city' }}
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label={t('billing.fields.stateProvince')}
                  value={invoiceForm.address.state}
                  onChange={handleAddressChange('invoice', 'state')}
                  fullWidth
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label={t('billing.fields.postalCode')}
                  value={invoiceForm.address.postalCode}
                  onChange={handleAddressChange('invoice', 'postalCode')}
                  fullWidth
                  required
                  inputProps={{ 'data-invoice-field': 'postalCode' }}
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <CountryPicker
                  label={t('billing.fields.country')}
                  value={invoiceForm.address.country}
                  onChange={handleCountryChange('invoice')}
                  required
                  fieldKey="country"
                  disabled={!canManage || loadingProfile || updateMutation.isPending || checkoutLoading}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {canManage && (
          <Stack direction="row" spacing={2} justifyContent="flex-end">
            <Button
              variant="outlined"
              onClick={handleReset}
              disabled={!isDirty || updateMutation.isPending || loadingProfile || checkoutLoading}
            >
              {t('common:buttons.reset')}
            </Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={!isDirty || updateMutation.isPending || loadingProfile || checkoutLoading}
            >
              {updateMutation.isPending ? <CircularProgress size={20} sx={{ color: 'inherit' }} /> : t('common:buttons.saveChanges')}
            </Button>
          </Stack>
        )}
      </Stack>

      <PlanSelectionDialog
        open={planDialogOpen}
        onClose={() => setPlanDialogOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['billing-profile'] });
        }}
        invoiceMissingFields={invoiceMissingFields}
        onCompleteInvoiceDetails={handleCompleteInvoiceDetails}
        onExited={handlePlanDialogExited}
      />
    </>
  );
}
