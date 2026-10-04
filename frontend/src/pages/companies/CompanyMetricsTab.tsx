import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api';
import YearTabs from '../../components/navigation/YearTabs';
import { PropertyRow } from '../../components/design';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import { useFreezeState } from '../../hooks/useFreezeState';
import { drawerFieldValueSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

type Props = {
  companyId: string;
  year: number;
  onYearChange: (year: number) => void;
  readOnly: boolean;
};

type Metrics = { headcount: number; it_users: number | null; turnover: number | null };
type MetricField = keyof Metrics;
type MetricErrors = Partial<Record<MetricField, string>>;

type RawMetrics = { headcount?: unknown; it_users?: unknown; turnover?: unknown } | null | undefined;

function toMetrics(raw: RawMetrics): Metrics {
  return {
    headcount: raw?.headcount != null ? Number(raw.headcount) : 0,
    it_users: raw?.it_users != null ? Number(raw.it_users) : null,
    turnover: raw?.turnover != null ? Number(raw.turnover) : null,
  };
}

/** The typed value, `null` for an empty optional field, `undefined` when it is not valid. */
function parseMetric(field: MetricField, raw: string): number | null | undefined {
  if (raw === '') return field === 'headcount' ? undefined : null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  if (field === 'turnover') return (raw.split('.')[1] ?? '').length > 3 ? undefined : value;
  return Number.isInteger(value) ? value : undefined;
}

const INVALID_MESSAGE: Record<MetricField, string> = {
  headcount: 'companies.messages.headcountInvalid',
  it_users: 'companies.messages.itUsersInvalid',
  turnover: 'companies.messages.turnoverInvalid',
};

/**
 * Headcount, IT users and turnover per year; each is saved for the selected year when its field
 * loses focus. The endpoint replaces the whole year, so every write carries the three values.
 */
export default function CompanyMetricsTab({ companyId, year, onYearChange, readOnly }: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const availableYears = React.useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1, current + 2];
  }, []);

  const metricsKey = React.useMemo(() => ['company-metrics', companyId, year] as const, [companyId, year]);
  const { data: stored, isLoading, error: loadError } = useQuery({
    queryKey: metricsKey,
    queryFn: async () => toMetrics((await api.get<RawMetrics>(`/company-metrics/${companyId}`, { params: { year } })).data),
  });

  const { data: freezeData, isLoading: freezeLoading } = useFreezeState(year);
  const frozen = freezeData?.summary?.scopes?.companies?.frozen ?? false;

  const [errors, setErrors] = React.useState<MetricErrors>({});
  // Writes queue one after the other and each starts from the values the previous one stored, so
  // two quick edits never put back a value the other just changed. A result arriving after the
  // user moved to another year or company is dropped.
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const scope = `${companyId}:${year}`;
  const currentScopeRef = React.useRef(scope);
  currentScopeRef.current = scope;

  React.useEffect(() => {
    setErrors({});
  }, [scope]);

  const save = (field: MetricField, value: number | null) => {
    const key = metricsKey;
    const target = scope;
    const run = async () => {
      const base = queryClient.getQueryData<Metrics>(key) ?? stored;
      if (!base || base[field] === value) return;
      const body: Metrics = { ...base, [field]: value };
      try {
        const res = await api.patch<RawMetrics>(`/company-metrics/${companyId}`, body, { params: { year: key[2] } });
        queryClient.setQueryData(key, toMetrics({ ...body, ...(res.data ?? {}) }));
        void queryClient.invalidateQueries({ queryKey: ['companies'], predicate: (q) => q.queryKey[1] !== companyId });
      } catch (e) {
        if (currentScopeRef.current === target) {
          setErrors((prev) => ({ ...prev, [field]: getApiErrorMessage(e, t, t('shared.messages.failedToSaveMetrics')) }));
        }
      }
    };
    const result = chainRef.current.then(run, run);
    chainRef.current = result.catch(() => undefined);
    return result;
  };

  const commit = (field: MetricField, raw: string) => {
    if (readOnly || frozen || !stored) return;
    const value = parseMetric(field, raw.trim());
    if (value === undefined) {
      setErrors((prev) => ({ ...prev, [field]: t(INVALID_MESSAGE[field]) }));
      return;
    }
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    void save(field, value);
  };

  // Not disabled while a save runs (a click on the next year must land); disabled when nothing reliable is loaded.
  const disabled = readOnly || frozen || freezeLoading || isLoading || !!loadError;
  const rows: Array<{ field: MetricField; label: string; required?: boolean; placeholder?: string; step: number }> = [
    { field: 'headcount', label: t('companies.fields.headcount'), required: true, step: 1 },
    { field: 'it_users', label: t('companies.fields.itUsers'), placeholder: t('companies.placeholders.itUsers'), step: 1 },
    { field: 'turnover', label: t('companies.fields.turnover'), placeholder: t('companies.placeholders.turnover'), step: 0.001 },
  ];

  return (
    <Stack spacing={2} sx={{ maxWidth: 560 }}>
      <Box>
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 0.5 }}>{t('companies.fields.year')}</Typography>
        <YearTabs currentYear={year} availableYears={availableYears} onYearChange={onYearChange} />
      </Box>
      {frozen && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {t('shared.messages.metricsFrozen', { year })}
        </Typography>
      )}
      {!!loadError && (
        <Typography role="alert" sx={{ fontSize: 13, color: 'error.main' }}>
          {getApiErrorMessage(loadError, t, t('shared.messages.failedToLoadMetrics'))}
        </Typography>
      )}
      <Box>
        {rows.map((row) => (
          <MetricRow
            // Another year or company starts afresh, even when its stored value reads the same.
            key={`${scope}:${row.field}`}
            label={row.label}
            required={row.required}
            placeholder={row.placeholder}
            step={row.step}
            storedText={stored && stored[row.field] != null ? String(stored[row.field]) : ''}
            disabled={disabled}
            error={errors[row.field]}
            onCommit={(raw) => commit(row.field, raw)}
          />
        ))}
      </Box>
      <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('shared.messages.metricsYearHint')}</Typography>
    </Stack>
  );
}

function MetricRow({
  label,
  required,
  placeholder,
  step,
  storedText,
  disabled,
  error,
  onCommit,
}: {
  label: string;
  required?: boolean;
  placeholder?: string;
  step: number;
  storedText: string;
  disabled: boolean;
  error?: string;
  onCommit: (raw: string) => void;
}) {
  // The field follows the stored value, except while the user is typing in it.
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(storedText);
  return (
    <PropertyRow label={label} required={required} valueSx={{ maxWidth: 200 }}>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        type="number"
        variant="standard"
        sx={drawerFieldValueSx}
        placeholder={placeholder}
        disabled={disabled}
        error={!!error}
        helperText={error}
        inputProps={{ min: 0, step, 'aria-label': label }}
      />
    </PropertyRow>
  );
}
