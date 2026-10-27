import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { KanapDialog, PropertyRow } from '../design';
import AccountSelect from '../fields/AccountSelect';
import AnalyticsCategorySelect from '../fields/AnalyticsCategorySelect';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { accountDisplayText } from '../../utils/accountDisplay';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { formatShortDate } from '../../lib/dateFormat';
import type { LineType } from '../../constants/lineTypeUsage';

/** What `GET …/:id/change-type/check` answers (backend `budget-line-type-change.service.ts`). */
export type ChangeTypeCheck = {
  id: string;
  reference: string | null;
  row_version: number;
  from_nature: LineType;
  to_nature: LineType;
  first_year: number | null;
  last_year: number | null;
  years: number[];
  from_year: number | null;
  mode: 'in_place' | 'dated';
  dated_refusal: 'successor' | 'no_later_year' | 'ends' | 'starts' | null;
  blockers: Array<{ year: number; column: string; column_name: string; nature: LineType }>;
  account: { id: string; account_number: number; account_name: string; fits: boolean; carried: boolean } | null;
  dimensions: Array<{
    axis_id: string;
    axis_name: string | null;
    reason: 'required' | 'value_other_type';
    required: boolean;
    current: { id: string; name: string } | null;
  }>;
  carried: { versions: number; tasks: number; attachments: number; links: number; contacts: number };
  successor: { id: string; reference: string | null; nature: LineType; from_year: number | null } | null;
};

export type ChangeTypeResult = { id: string; reference: string | null; nature: LineType; predecessor_id?: string };

const ITEMS_API: Record<LineType, string> = { opex: '/spend-items', capex: '/capex-items' };

type Props = {
  open: boolean;
  /** The line's type now. */
  nature: LineType;
  lineId: string;
  /** The reference the workspace shows (`OPX-12`, `CPX-3`). */
  lineReference: string | null;
  /** The paying company: the account picker offers its chart. */
  companyId: string | null;
  onClose: () => void;
  onChanged: (result: ChangeTypeResult) => void;
};

const textSx = { fontSize: 13, color: 'kanap.text.secondary', lineHeight: 1.5 } as const;
const placeholderSx = { color: 'kanap.text.tertiary' } as const;

/**
 * "Change type" of a budget line (lot M): from its first year the line changes type and keeps
 * everything; from a later year it ends the year before and a new line of the other type carries
 * the later years. The server decides what is offered and checks everything again
 * (`GET`/`POST …/:id/change-type`); the dialog asks for what the new type needs.
 */
export default function ChangeTypeDialog({ open, nature, lineId, lineReference, companyId, onClose, onChanged }: Props) {
  const { t, i18n } = useTranslation(['ops', 'common']);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const target: LineType = nature === 'opex' ? 'capex' : 'opex';
  const [fromYear, setFromYear] = React.useState<number | null>(null);
  const [accountId, setAccountId] = React.useState<string>('');
  const [values, setValues] = React.useState<Record<string, string | null>>({});
  const [reason, setReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFromYear(null);
    setAccountId('');
    setValues({});
    setReason('');
    setError(null);
  }, [open, lineId]);

  const check = useQuery({
    queryKey: ['change-type-check', nature, lineId, fromYear],
    queryFn: async ({ signal }) => (await api.get<ChangeTypeCheck>(`${ITEMS_API[nature]}/${lineId}/change-type/check`, {
      params: fromYear !== null ? { from_year: fromYear } : {},
      signal,
    })).data,
    enabled: open && !!lineId,
    // Always the line as it is now: the dialog sends its row_version back.
    staleTime: 0,
    gcTime: 0,
    placeholderData: (previous) => previous,
  });
  const data = check.data && check.data.id === lineId ? check.data : undefined;
  const loadError = check.isError ? getApiErrorMessage(check.error, t, t('ops:shared.changeType.loadFailed')) : null;

  // The account the line keeps (in place) or the new line gets (from a year) when it suits the new type.
  const shownMode = data?.mode;
  const suggestedAccount = data?.account && (shownMode === 'dated' ? data.account.carried : data.account.fits) ? data.account.id : '';
  React.useEffect(() => {
    setAccountId(suggestedAccount);
  }, [suggestedAccount, shownMode]);

  const dated = data?.mode === 'dated';
  const typeLabel = (type: LineType) => type.toUpperCase();
  const missingRequired = !!data && data.dimensions.some((dimension) => dimension.required && !values[dimension.axis_id]);
  const blocked = !!data && data.blockers.length > 0;
  const canSave = !!data && !check.isFetching && !blocked && !missingRequired && !submitting;

  const yearOptions = data?.years ?? [];
  const selectedYear = data?.from_year ?? null;

  const handleSave = async () => {
    if (!data || !canSave) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        row_version: data.row_version,
        from_year: dated ? data.from_year : null,
        analytics_values: Object.fromEntries(Object.entries(values).filter(([, value]) => !!value)),
      };
      // In place the line keeps its account unless another one is chosen; a new line gets the one shown.
      if (dated) body.account_id = accountId || null;
      else if (accountId && accountId !== data.account?.id) body.account_id = accountId;
      if (reason.trim()) body.reason = reason.trim();
      const res = await api.post<ChangeTypeResult>(`${ITEMS_API[nature]}/${lineId}/change-type`, body);
      onChanged(res.data);
    } catch (e) {
      // The line changed since the dialog read it: read it again, the user checks and confirms again.
      if ((e as { response?: { data?: { code?: unknown } } })?.response?.data?.code === 'edit_conflict') {
        setError(t('ops:shared.changeType.changedMeanwhile'));
        void check.refetch();
      } else {
        setError(getApiErrorMessage(e, t, t('ops:shared.changeType.failed')));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const endOfOld = selectedYear ? formatShortDate(`${selectedYear - 1}-12-31`, locale, { year: 'always' }) : '';
  const refusal = data?.dated_refusal;
  const refusalText = refusal && data?.first_year
    ? t(`ops:shared.changeType.datedRefusal.${refusal}`, {
      year: data.first_year + 1,
      reference: data.successor?.reference ?? '',
    })
    : null;

  return (
    <KanapDialog
      open={open}
      title={t('ops:shared.changeType.title', { reference: lineReference ?? '' })}
      subtitle={t(`ops:shared.changeType.subtitle.${target}`)}
      onClose={onClose}
      onSave={handleSave}
      saveLabel={t('ops:shared.changeType.save')}
      saveDisabled={!canSave}
      saveLoading={submitting}
      sx={{ maxWidth: 520 }}
    >
      <Stack spacing={1.5}>
        {loadError && <Alert severity="error">{loadError}</Alert>}
        {data && (
          <>
            <PropertyRow label={t('ops:shared.changeType.fromLabel')}>
              {yearOptions.length > 1 ? (
                <Select
                  variant="standard"
                  value={selectedYear ?? ''}
                  onChange={(event) => {
                    const year = Number(event.target.value);
                    setFromYear(year === data.first_year ? null : year);
                    setError(null);
                  }}
                  sx={drawerSelectSx}
                  SelectDisplayProps={{ 'aria-label': t('ops:shared.changeType.fromLabel') } as React.HTMLAttributes<HTMLDivElement>}
                >
                  {yearOptions.map((year) => (
                    <MenuItem key={year} value={year} sx={drawerMenuItemSx}>
                      {year === data.first_year
                        ? t('ops:shared.changeType.fromFirstYear', { year })
                        : t('ops:shared.changeType.fromYear', { year, type: typeLabel(target) })}
                    </MenuItem>
                  ))}
                </Select>
              ) : (
                <Typography sx={{ fontSize: 13, py: '6px' }}>
                  {data.first_year
                    ? t('ops:shared.changeType.fromFirstYear', { year: data.first_year })
                    : t('ops:shared.changeType.fromAllYears')}
                </Typography>
              )}
            </PropertyRow>
            {refusalText && <Typography sx={textSx}>{refusalText}</Typography>}

            <Box>
              {dated ? (
                <>
                  <Typography sx={textSx}>
                    {t('ops:shared.changeType.effects.dated', {
                      end: endOfOld,
                      year: selectedYear,
                      type: typeLabel(target),
                      count: data.carried.versions,
                    })}
                  </Typography>
                  <Typography sx={{ ...textSx, mt: 0.75 }}>
                    {t('ops:shared.changeType.effects.datedStays', { type: typeLabel(target) })}
                  </Typography>
                </>
              ) : (
                <>
                  <Typography sx={textSx}>{t('ops:shared.changeType.effects.inPlace')}</Typography>
                  <Typography sx={{ ...textSx, mt: 0.75 }}>{t(`ops:shared.changeType.effects.reports.${target}`)}</Typography>
                </>
              )}
            </Box>

            {blocked && (
              <Alert severity="warning">
                {data.blockers.map((blocker) => (
                  <Box key={`${blocker.year}-${blocker.column}-${blocker.nature}`}>
                    {t('ops:shared.changeType.frozen', { column: blocker.column_name, year: blocker.year, type: typeLabel(blocker.nature) })}
                  </Box>
                ))}
                <Box sx={{ mt: 0.5 }}>{t('ops:shared.changeType.frozenHelp')}</Box>
              </Alert>
            )}

            <PropertyRow
              label={t('ops:shared.changeType.accountLabel')}
              helperText={data.account && !(dated ? data.account.carried : data.account.fits)
                ? t(dated ? 'ops:shared.changeType.accountNotCopied' : 'ops:shared.changeType.accountUnfit', {
                  account: accountDisplayText(data.account.account_number, data.account.account_name),
                  type: typeLabel(nature),
                  target: typeLabel(target),
                })
                : undefined}
            >
              <AccountSelect
                hideLabel
                label={t('ops:shared.changeType.accountLabel')}
                value={accountId || null}
                onChange={(next) => setAccountId(next || '')}
                companyId={companyId}
                nature={target}
                selectedOption={data.account && accountId === data.account.id ? data.account : null}
              />
            </PropertyRow>

            {data.dimensions.map((dimension) => (
              <PropertyRow
                key={dimension.axis_id}
                label={dimension.axis_name || t('ops:shared.changeType.dimensionFallback')}
                required={dimension.required}
                helperText={dimension.reason === 'value_other_type' && dimension.current
                  ? t(dated ? 'ops:shared.changeType.valueOtherTypeDated' : 'ops:shared.changeType.valueOtherType', {
                    value: dimension.current.name,
                    type: typeLabel(nature),
                  })
                  : t(dated ? 'ops:shared.changeType.requiredDated' : 'ops:shared.changeType.requiredInPlace', { type: typeLabel(target) })}
              >
                <AnalyticsCategorySelect
                  hideLabel
                  label={dimension.axis_name || t('ops:shared.changeType.dimensionFallback')}
                  axisId={dimension.axis_id}
                  value={values[dimension.axis_id] ?? null}
                  onChange={(next) => setValues((prev) => ({ ...prev, [dimension.axis_id]: next }))}
                  lineType={target}
                />
              </PropertyRow>
            ))}

            <PropertyRow label={t('ops:shared.changeType.reasonLabel')}>
              <TextField
                variant="standard"
                fullWidth
                multiline
                minRows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('ops:shared.changeType.reasonPlaceholder')}
                inputProps={{ 'aria-label': t('ops:shared.changeType.reasonLabel'), maxLength: 1000 }}
              />
            </PropertyRow>
          </>
        )}
        {!data && !loadError && <Typography sx={{ ...textSx, ...placeholderSx }}>{t('common:status.loading')}</Typography>}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </KanapDialog>
  );
}
