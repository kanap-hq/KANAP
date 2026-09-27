import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api';
import YearTabs from '../../components/navigation/YearTabs';
import { PropertyRow } from '../../components/design';
import { useFreezeState } from '../../hooks/useFreezeState';
import { drawerFieldValueSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

type Props = {
  departmentId: string;
  year: number;
  onYearChange: (year: number) => void;
  readOnly: boolean;
};

/** Headcount per year; saved for the selected year when the field loses focus. */
export default function DepartmentHeadcountTab({ departmentId, year, onYearChange, readOnly }: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const availableYears = React.useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1, current + 2];
  }, []);

  const metricsKey = React.useMemo(() => ['department-metrics', departmentId, year] as const, [departmentId, year]);
  const { data: stored, isLoading, error: loadError } = useQuery({
    queryKey: metricsKey,
    queryFn: async () => {
      const res = await api.get<{ headcount?: number | string | null } | null>(`/department-metrics/${departmentId}`, { params: { year } });
      return res.data?.headcount != null ? Number(res.data.headcount) : 0;
    },
  });

  const { data: freezeData, isLoading: freezeLoading } = useFreezeState(year);
  const frozen = freezeData?.summary?.scopes?.departments?.frozen ?? false;

  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  // A result arriving after the user moved to another year or department is dropped.
  const currentKeyRef = React.useRef(`${departmentId}:${year}`);
  currentKeyRef.current = `${departmentId}:${year}`;

  React.useEffect(() => {
    setDraft(stored != null ? String(stored) : '');
    setError(null);
  }, [stored, year]);

  const commit = async () => {
    if (readOnly || frozen || stored == null) return;
    const raw = draft.trim();
    const value = Number(raw);
    if (raw === '' || !Number.isInteger(value) || value < 0) {
      setError(t('departments.messages.headcountInvalid'));
      return;
    }
    if (value === stored) {
      setError(null);
      return;
    }
    const key = `${departmentId}:${year}`;
    setError(null);
    try {
      await api.patch(`/department-metrics/${departmentId}`, { headcount: value }, { params: { year } });
      queryClient.setQueryData(metricsKey, value);
      void queryClient.invalidateQueries({ queryKey: ['departments'], predicate: (q) => q.queryKey[1] !== departmentId });
    } catch (e) {
      if (currentKeyRef.current === key) setError(getApiErrorMessage(e, t, t('shared.messages.failedToSaveMetrics')));
    }
  };

  // Not disabled while a save runs (a click on the next year must land); disabled when nothing reliable is loaded.
  const disabled = readOnly || frozen || freezeLoading || isLoading || !!loadError;

  return (
    <Stack spacing={2} sx={{ maxWidth: 560 }}>
      <Box>
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 0.5 }}>{t('departments.fields.year')}</Typography>
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
      <PropertyRow label={t('departments.fields.headcount')} required helperText={t('departments.headcountHint')} valueSx={{ maxWidth: 200 }}>
        <TextField
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          type="number"
          variant="standard"
          sx={drawerFieldValueSx}
          disabled={disabled}
          error={!!error}
          helperText={error}
          inputProps={{ min: 0, step: 1, 'aria-label': t('departments.fields.headcount') }}
        />
      </PropertyRow>
    </Stack>
  );
}
