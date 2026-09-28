import React from 'react';
import { Box, Button, FormControlLabel, Link, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useWorkingDayProfiles } from '../../hooks/useWorkingDayProfiles';
import { useAuth } from '../../auth/AuthContext';
import FormattedNumberField from '../inputs/FormattedNumberField';
import DateEUField from '../fields/DateEUField';
import { FieldLabel } from '../design';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import {
  AmountMeasure,
  ComputePreview,
  ComputeRequest,
  PRICING_BASES,
  Period,
  PricingBasis,
  RoundInput,
  computeChangeLines,
  computeLineText,
  hasRecipe,
  periodProblem,
} from './roundPeriod';

/** Wait this long after the last keystroke before asking the server for the result. */
export const PREVIEW_DELAY_MS = 300;
const CALENDARS_PATH = '/master-data/working-day-calendars';

type Form = {
  basis: PricingBasis;
  quantity: string;
  unitPrice: string;
  index: string;
  calendarId: string;
  countsAsFte: boolean;
  start: string;
  end: string;
};

const EMPTY_FORM: Form = {
  basis: 'per_month', quantity: '', unitPrice: '', index: '', calendarId: '', countsAsFte: false, start: '', end: '',
};

/** The column's recipe when it has one; otherwise what the user typed stays, on the column's period. */
function formFor(record: RoundInput | undefined, period: Period | null, typed: Form): Form {
  const dates = { start: period?.start ?? '', end: period?.end ?? '' };
  if (!hasRecipe(record)) return { ...typed, ...dates };
  const index = record.price_index_pct ?? '';
  return {
    basis: record.pricing_basis,
    quantity: record.quantity ?? '',
    unitPrice: record.unit_price ?? '',
    index: Number(index) === 0 ? '' : index,
    calendarId: record.working_day_profile_id ?? '',
    countsAsFte: record.counts_as_fte,
    ...dates,
  };
}

/**
 * A field of the budget tab's panels, label above. It is `width` wide, wider when its label needs
 * more: the label stays on one line, so a row of fields keeps one baseline in every language.
 */
export function PanelField({ label, width, children }: { label: string; width: number; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto', minWidth: width }}>
      <FieldLabel sx={{ mb: '2px', whiteSpace: 'nowrap' }}>{label}</FieldLabel>
      {/* No width of its own: the field fills what the label and `width` give. */}
      <Box sx={{ width: 0, minWidth: '100%' }}>{children}</Box>
    </Box>
  );
}

/** From and To of a panel, kept together: a narrow row wraps the period as a whole. */
export function PanelPeriod({ children }: { children: React.ReactNode }) {
  return <Box sx={{ display: 'flex', alignItems: 'flex-end', columnGap: 1.5 }}>{children}</Box>;
}

/** The number field emits the typed decimal string (or ''); the request carries it as is. */
const asText = (value: unknown): string => (value === '' || value == null ? '' : String(value));

export type ComputePanelProps = {
  year: number;
  measure: AmountMeasure;
  /** Shown columns, fixed order; a frozen one cannot be picked. */
  columns: Array<{ measure: AmountMeasure; label: string; frozen: boolean }>;
  onMeasureChange: (measure: AmountMeasure) => void;
  /** The column's stored record, with its recipe when it has one. */
  record: RoundInput | undefined;
  /** The period the column is edited with (stored, whole year, or the item's dates). */
  period: Period | null;
  frozen: boolean;
  frozenHint: string;
  busy: boolean;
  requestPreview: (body: ComputeRequest) => Promise<ComputePreview>;
  onCompute: (body: ComputeRequest) => void;
  /** Closes the panel; absent where the panel always shows. */
  onCancel?: () => void;
};

/**
 * "Compute from quantity and price": the recipe of one column, the result from the server as the
 * user types (no amount is computed here), and Compute, or Recompute on a column that has a recipe.
 */
export default function ComputePanel({
  year, measure, columns, onMeasureChange, record, period, frozen, frozenHint, busy, requestPreview, onCompute, onCancel,
}: ComputePanelProps) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const { hasLevel } = useAuth();
  const calendars = useWorkingDayProfiles();
  const [form, setForm] = React.useState<Form>(() => formFor(record, period, EMPTY_FORM));
  const set = (patch: Partial<Form>) => setForm((prev) => ({ ...prev, ...patch }));

  // Another column: its own recipe and period.
  const shownMeasure = React.useRef(measure);
  React.useEffect(() => {
    if (shownMeasure.current === measure) return;
    shownMeasure.current = measure;
    setForm((prev) => formFor(record, period, prev));
    // The record and period of the new column are read at the switch only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure]);

  const recompute = hasRecipe(record);
  const perDay = form.basis === 'per_day';
  // Enabled calendars, plus the column's own one even when it was disabled since (marked so,
  // once the list is loaded: before that its state is unknown).
  const calendarOptions = React.useMemo(() => {
    const options = calendars.enabled.map((c) => ({ id: c.id, name: c.name }));
    const currentId = record?.working_day_profile_id;
    if (currentId && !options.some((o) => o.id === currentId)) {
      const name = calendars.byId.get(currentId)?.name ?? record?.working_day_profile_name ?? '';
      const known = calendars.ready && !calendars.isError;
      options.push({ id: currentId, name: known ? t('budgetTab.compute.calendarDisabled', { name }) : name });
    }
    return options;
  }, [calendars.enabled, calendars.byId, calendars.ready, calendars.isError, record, t]);
  // No select to offer: the tenant has no calendar, or the list could not be loaded.
  const calendarNote = calendarOptions.length > 0 ? null
    : calendars.isError ? 'failed'
      : calendars.ready ? 'none' : null;
  // The calendars page takes a member of the calendars; others get the sentence alone.
  const canAddCalendar = hasLevel('working_day_profiles', 'member');

  const problem = periodProblem(year, form.start, form.end);
  const hint = problem
    ? t(`budgetTab.problem.${problem}`, { year })
    : form.quantity === '' || form.unitPrice === ''
      ? t('budgetTab.compute.incomplete')
      : perDay && !form.calendarId
        ? t('budgetTab.compute.chooseCalendar')
        : null;
  const body: ComputeRequest | null = hint ? null : {
    kind: 'computed',
    year,
    measure,
    period_start: form.start,
    period_end: form.end,
    pricing_basis: form.basis,
    quantity: form.quantity,
    unit_price: form.unitPrice,
    price_index_pct: form.index === '' ? '0' : form.index,
    working_day_profile_id: perDay ? form.calendarId : null,
    counts_as_fte: form.countsAsFte,
  };
  const bodyKey = body ? JSON.stringify(body) : '';

  // The result of `bodyKey` from the server, debounced; a late answer to older inputs is dropped.
  const [result, setResult] = React.useState<{ key: string; preview: ComputePreview | null; error: string | null } | null>(null);
  const requestPreviewRef = React.useRef(requestPreview); requestPreviewRef.current = requestPreview;
  React.useEffect(() => {
    if (!bodyKey) return undefined;
    let current = true;
    const timer = window.setTimeout(() => {
      requestPreviewRef.current(JSON.parse(bodyKey) as ComputeRequest)
        .then((preview) => { if (current) setResult({ key: bodyKey, preview, error: null }); })
        .catch((e) => {
          if (current) setResult({ key: bodyKey, preview: null, error: getApiErrorMessage(e, t, t('budgetTab.compute.previewFailed')) });
        });
    }, PREVIEW_DELAY_MS);
    return () => { current = false; window.clearTimeout(timer); };
  }, [bodyKey, t]);

  const fresh = !!bodyKey && result?.key === bodyKey;
  const preview = fresh ? result!.preview : null;
  const error = fresh ? result!.error : null;
  // The previous line stays, dimmed, while the new one is on its way: no flicker on each keystroke.
  const shownPreview = preview ?? (!error && bodyKey && result?.preview ? result.preview : null);
  const changes = recompute && preview ? computeChangeLines(t, locale, preview) : null;

  const captionSx = { fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4 } as const;
  const field = (label: string, width: number, control: React.ReactNode) => (
    <PanelField label={label} width={width}>{control}</PanelField>
  );

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 1.5, rowGap: 1 }}>
        {field(t('budgetTab.column'), 150, (
          <TextField
            select size="small" variant="standard" value={measure}
            onChange={(e) => onMeasureChange(e.target.value as AmountMeasure)}
            inputProps={{ 'aria-label': t('budgetTab.column') }}
            sx={drawerSelectSx}
          >
            {columns.map((c) => (
              <MenuItem key={c.measure} value={c.measure} disabled={c.frozen} sx={drawerMenuItemSx}>{c.label}</MenuItem>
            ))}
          </TextField>
        ))}
        <PanelPeriod>
          <DateEUField label={t('budgetTab.from')} valueYmd={form.start} onChangeYmd={(v) => set({ start: v })} size="small" sx={{ width: 150 }} />
          <DateEUField label={t('budgetTab.to')} valueYmd={form.end} onChangeYmd={(v) => set({ end: v })} size="small" sx={{ width: 150 }} />
        </PanelPeriod>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 1.5, rowGap: 1 }}>
        {field(t('budgetTab.compute.basis'), 170, (
          <TextField
            select size="small" variant="standard" value={form.basis}
            onChange={(e) => set({ basis: e.target.value as PricingBasis })}
            inputProps={{ 'aria-label': t('budgetTab.compute.basis') }}
            sx={drawerSelectSx}
          >
            {PRICING_BASES.map((basis) => (
              <MenuItem key={basis} value={basis} sx={drawerMenuItemSx}>{t(`budgetTab.basis.${basis}`)}</MenuItem>
            ))}
          </TextField>
        ))}
        {field(t('budgetTab.compute.quantity'), 100, (
          <FormattedNumberField
            value={form.quantity} decimals={3} emit="string"
            onChange={(e) => set({ quantity: asText(e.target.value) })}
            variant="standard" size="small" fullWidth
            placeholder={t('budgetTab.compute.quantityPlaceholder')}
            inputProps={{ 'aria-label': t('budgetTab.compute.quantity') }}
          />
        ))}
        {field(t('budgetTab.compute.unitPrice'), 130, (
          <FormattedNumberField
            value={form.unitPrice} decimals={4} emit="string"
            onChange={(e) => set({ unitPrice: asText(e.target.value) })}
            variant="standard" size="small" fullWidth
            placeholder={t('budgetTab.compute.unitPricePlaceholder')}
            inputProps={{ 'aria-label': t('budgetTab.compute.unitPrice') }}
          />
        ))}
        {field(t('budgetTab.compute.index'), 110, (
          <FormattedNumberField
            value={form.index} decimals={4} emit="string"
            onChange={(e) => set({ index: asText(e.target.value) })}
            variant="standard" size="small" fullWidth
            placeholder={t('budgetTab.compute.indexPlaceholder')}
            inputProps={{ 'aria-label': t('budgetTab.compute.index') }}
          />
        ))}
        {perDay && field(t('budgetTab.compute.calendar'), 190, calendarNote ? (
          <Typography sx={{ ...captionSx, minHeight: 32, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {calendarNote === 'failed' ? t('budgetTab.compute.calendarsFailed') : t('budgetTab.compute.noCalendars')}
            {calendarNote === 'none' && canAddCalendar && (
              <Link component={RouterLink} to={CALENDARS_PATH} sx={{ fontSize: 12 }}>{t('budgetTab.compute.addCalendar')}</Link>
            )}
          </Typography>
        ) : (
          <TextField
            select size="small" variant="standard" value={form.calendarId}
            onChange={(e) => set({ calendarId: e.target.value })}
            inputProps={{ 'aria-label': t('budgetTab.compute.calendar') }}
            sx={drawerSelectSx}
          >
            {calendarOptions.map((c) => <MenuItem key={c.id} value={c.id} sx={drawerMenuItemSx}>{c.name}</MenuItem>)}
          </TextField>
        ))}
        <FormControlLabel
          control={<Switch size="small" checked={form.countsAsFte} onChange={(e) => set({ countsAsFte: e.target.checked })} />}
          label={(
            <Tooltip title={t('budgetTab.compute.countsAsFteHint')}>
              <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{t('budgetTab.compute.countsAsFte')}</Typography>
            </Tooltip>
          )}
          sx={{ ml: 0, mb: '4px' }}
        />
      </Box>

      <Box data-testid="compute-notes" aria-live="polite">
        {hint && (
          <Typography sx={{ ...captionSx, color: problem ? 'error.main' : 'kanap.text.tertiary' }}>{hint}</Typography>
        )}
        {!hint && error && <Typography sx={{ ...captionSx, color: 'error.main' }}>{error}</Typography>}
        {!hint && !error && shownPreview && (
          <Typography
            data-testid="compute-line"
            sx={{ fontSize: 13, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums', opacity: preview ? 1 : 0.5 }}
          >
            {computeLineText(t, locale, shownPreview)}
          </Typography>
        )}
        {preview?.warnings.map((warning) => (
          <Typography key={warning} sx={{ ...captionSx, color: 'warning.main' }}>{warning}</Typography>
        ))}
        {changes && changes.days.length > 0 && (
          <Typography sx={{ ...captionSx, color: 'warning.main' }}>
            {t('budgetTab.compute.changedDays')} {changes.days.join(' · ')}
          </Typography>
        )}
        {changes && changes.amounts.length > 0 && (
          <Typography sx={{ ...captionSx, color: 'kanap.text.secondary' }}>
            {t('budgetTab.compute.changedAmounts')} {changes.amounts.join(' · ')}
          </Typography>
        )}
        {changes && changes.days.length === 0 && changes.amounts.length === 0 && (
          <Typography sx={captionSx}>{t('budgetTab.compute.noChange')}</Typography>
        )}
        {frozen && <Typography sx={captionSx}>{frozenHint}</Typography>}
      </Box>

      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          size="small" variant="contained"
          onClick={() => { if (body) onCompute(body); }}
          disabled={!preview || frozen || busy}
        >
          {recompute ? t('budgetTab.compute.recompute') : t('budgetTab.compute.compute')}
        </Button>
        {onCancel && (
          <Button size="small" onClick={onCancel} sx={{ textTransform: 'none' }}>{t('common:buttons.cancel')}</Button>
        )}
      </Stack>
    </>
  );
}
