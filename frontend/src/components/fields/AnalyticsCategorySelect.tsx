import React from 'react';
import { Autocomplete, Box, CircularProgress, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';
import { useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { ANALYTICS_VALUES_ENDPOINT, type AnalyticsValue } from '../../services/analytics';

type Props = {
  /** The dimension whose values the select offers. */
  axisId: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  /** Defaults to the dimension's display name. */
  label?: string;
  helperText?: React.ReactNode;
  error?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
};

/** One dimension's values. The list holds enabled values; the current value stays shown when it is disabled. */
export default function AnalyticsCategorySelect({
  axisId,
  value,
  onChange,
  label,
  helperText,
  error,
  disabled,
  hideLabel = false,
  textFieldSx,
}: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const needsAxisLabel = label === undefined && !hideLabel;
  const axes = useAnalyticsAxes({ enabled: needsAxisLabel });

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-categories', 'axis', axisId],
    enabled: !!axisId,
    queryFn: async () => {
      const res = await api.get<{ items: AnalyticsValue[] }>(ANALYTICS_VALUES_ENDPOINT, {
        params: { axis_id: axisId, limit: 1000, sort: 'name:ASC' },
      });
      return res.data.items;
    },
  });

  const options = React.useMemo(() => {
    // The server filters by dimension; the guard keeps another dimension's value out if it did not.
    const list = (data ?? []).filter((item) => !item.axis_id || item.axis_id === axisId);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [axisId, data]);

  // The current value may be missing from the list (disabled, or beyond the first page).
  const needSelectedFetch = !!value && !isLoading && !options.some((c) => c.id === value);
  const { data: selectedById, isLoading: isLoadingSelected } = useQuery({
    queryKey: ['analytics-categories', 'by-id', value],
    enabled: needSelectedFetch,
    queryFn: async () => {
      const res = await api.get<AnalyticsValue>(`${ANALYTICS_VALUES_ENDPOINT}/${value}`);
      return res.data;
    },
  });

  const mergedOptions = React.useMemo(() => {
    const base = [...options];
    if (selectedById && !base.some((c) => c.id === selectedById.id)) base.unshift(selectedById);
    return base;
  }, [options, selectedById]);

  const selected = React.useMemo(() => mergedOptions.find((item) => item.id === value) ?? null, [mergedOptions, value]);
  const resolvedLabel = label ?? axes.label(axes.byId.get(axisId) ?? { name: null });
  const naked = hideLabel || resolvedLabel === '';
  // A hidden label still names the field for assistive technology, when the caller gave one.
  const ariaLabel = hideLabel ? label : resolvedLabel;
  const loading = isLoading || (needSelectedFetch && isLoadingSelected);

  const control = (
    <Autocomplete
      options={mergedOptions}
      value={selected}
      onChange={(_, newValue) => onChange(newValue?.id ?? null)}
      getOptionLabel={(option) => option.name}
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          <Box>
            <Box sx={{ fontWeight: 500 }}>{option.name}</Box>
            {option.description && (
              <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                {option.description}
              </Box>
            )}
            {option.status === 'disabled' && (
              <Box sx={{ fontSize: '0.75rem', color: 'warning.main' }}>
                {t('common:statuses.disabled')}
              </Box>
            )}
          </Box>
        </li>
      )}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          sx={textFieldSx}
          placeholder={naked ? t('common:selects.notSet') : undefined}
          error={error}
          helperText={helperText}
          inputProps={ariaLabel ? { ...params.inputProps, 'aria-label': ariaLabel } : params.inputProps}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={20} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      disabled={disabled || isLoading}
      loading={loading}
      clearOnBlur
      clearOnEscape
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      noOptionsText={isLoading ? t('common:status.loading') : t('analytics.noOptions')}
      fullWidth
    />
  );

  if (naked || !resolvedLabel) return control;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
      <FieldLabel>{resolvedLabel}</FieldLabel>
      {control}
    </Box>
  );
}
