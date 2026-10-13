import { useQuery } from '@tanstack/react-query';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { PropertyRow } from '../../../components/design';
import DateEUField from '../../../components/fields/DateEUField';
import { formatAmount } from '../../../i18n/formatters';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import { utcTodayYmd } from '../contractTerms';
import { renewalQueryKey, type ContractRenewal } from './ContractRenewalDecision';

/** At most this many names in a consequence line, then "and n more". */
const NAMES_SHOWN = 5;

/** The first day an end may be chosen: today, or the contract's start when it is later. */
export function earliestEndDay(startDate: string | null | undefined): string {
  const today = utcTodayYmd();
  const start = (startDate ?? '').slice(0, 10);
  return start > today ? start : today;
}

/** A day the API takes as an end (`YYYY-MM-DD`, not before `earliestEndDay`). */
export function isValidEnd(value: string, startDate: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= earliestEndDay(startDate);
}

/**
 * The end of a contract that stops renewing (lot CR2, round 1), shared by the termination in the
 * decision box and the renewal field's confirmation: why the proposed day (the notice), a date
 * field holding the day chosen, an orange warning before the day the notice allows, and what
 * ending on that day changes (`GET /contracts/:id/renewal?end_date=`).
 */
export default function ContractEndChoice({
  contractId,
  startDate,
  proposed,
  noticeMonths,
  value,
  onChange,
  proposedImpact,
  disabled,
}: {
  contractId: string;
  startDate: string | null | undefined;
  /** The end the API proposes (`proposed_end_date`). */
  proposed: string | null;
  noticeMonths: number;
  value: string;
  onChange: (next: string) => void;
  /** The consequences of ending on the proposed day, when already known. */
  proposedImpact?: ContractRenewal['impact'];
  disabled?: boolean;
}) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const date = (ymd: string | null | undefined) => formatShortDate(ymd, locale, { year: 'always' });
  const valid = isValidEnd(value, startDate);
  const known = value === proposed && proposedImpact ? proposedImpact : null;
  const impactQuery = useQuery({
    queryKey: [...renewalQueryKey(contractId), 'impact', value],
    queryFn: async () => (await api.get<ContractRenewal>(`/contracts/${contractId}/renewal`, { params: { end_date: value } })).data.impact,
    enabled: valid && !known,
  });
  const impact = known ?? (valid ? impactQuery.data ?? null : null);
  const names = (items: Array<{ name: string }>) => {
    const shown = items.slice(0, NAMES_SHOWN).map((item) => item.name).join(', ');
    return items.length > NAMES_SHOWN ? t('contracts.renewal.andMore', { names: shown, count: items.length - NAMES_SHOWN }) : shown;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {proposed && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {noticeMonths > 0
            ? t('contracts.endChoice.earliest', { count: noticeMonths, date: date(proposed) })
            : t('contracts.endChoice.earliestNoNotice', { date: date(proposed) })}
        </Typography>
      )}
      <Box sx={{ maxWidth: 220 }}>
        <PropertyRow label={t('contracts.endChoice.label')}>
          <DateEUField
            label=""
            hideLabel
            valueYmd={value}
            onChangeYmd={onChange}
            disabled={disabled}
            error={!!value && !valid}
            helperText={!!value && !valid ? t('contracts.endChoice.tooEarly', { date: date(earliestEndDay(startDate)) }) : undefined}
          />
        </PropertyRow>
      </Box>
      {valid && proposed && value < proposed && (
        <Typography data-testid="contract-end-warning" sx={{ fontSize: 12, color: 'kanap.orange' }}>
          {t('contracts.endChoice.beforeAllowed')}
        </Typography>
      )}
      {valid && (
        <Box data-testid="contract-renewal-consequences" sx={{ borderLeft: '2px solid', borderColor: 'kanap.orange', pl: '10px', py: '2px', fontSize: 12, color: 'kanap.text.secondary', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span>{t('contracts.renewal.consequenceEnd', { date: date(value) })}</span>
          {impact?.commitments.map((row) => (
            <span key={row.year}>
              {row.after === 0
                ? t('contracts.renewal.consequenceNoCommitment', { year: row.year, before: formatAmount(row.before), currency: impact.currency })
                : t('contracts.renewal.consequenceCommitment', { year: row.year, before: formatAmount(row.before), after: formatAmount(row.after), currency: impact.currency })}
            </span>
          ))}
          {impact && impact.applications.length > 0 && (
            <span>{t('contracts.renewal.consequenceApplications', { count: impact.applications.length, names: names(impact.applications) })}</span>
          )}
          {impact && impact.assets.length > 0 && (
            <span>{t('contracts.renewal.consequenceAssets', { count: impact.assets.length, names: names(impact.assets) })}</span>
          )}
        </Box>
      )}
    </Box>
  );
}
