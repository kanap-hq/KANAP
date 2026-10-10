import React from 'react';
import { Autocomplete, Box, CircularProgress, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';
import { useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { ANALYTICS_VALUES_LOOKUP_ENDPOINT, type AnalyticsValue } from '../../services/analytics';
import type { LineType } from '../../constants/lineTypeUsage';

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
  /** The current value's label when the caller holds it (the line's analytics values): no request to show it. */
  selectedOption?: Pick<AnalyticsValue, 'id' | 'name'> & Partial<AnalyticsValue> | null;
  /** Offers only the values this kind of line may use. A held value of the other type still shows. */
  lineType?: LineType;
  /** The value can be changed but not removed (a required dimension on a line holding a value). */
  disableClearable?: boolean;
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
  selectedOption,
  lineType,
  disableClearable = false,
}: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const needsAxisLabel = label === undefined && !hideLabel;
  const axes = useAnalyticsAxes({ enabled: needsAxisLabel });

  // The dimension's values, searched as the user types; the current value keeps its label (disabled,
  // or restricted to the other line type: the read by id ignores `applies_to`).
  const picker = useLookupPicker<AnalyticsValue>({
    endpoint: ANALYTICS_VALUES_LOOKUP_ENDPOINT,
    scope: { axis_id: axisId, applies_to: lineType ?? null },
    enabled: !!axisId,
    value: value ? [value] : [],
    given: [selectedOption as AnalyticsValue | null | undefined],
  });
  const selected = value ? picker.selected[0] ?? null : null;
  const resolvedLabel = label ?? axes.label(axes.byId.get(axisId) ?? { name: null });
  const naked = hideLabel || resolvedLabel === '';
  // A hidden label still names the field for assistive technology, when the caller gave one.
  const ariaLabel = hideLabel ? label : resolvedLabel;

  const control = (
    <Autocomplete
      {...picker.autocomplete}
      options={picker.options}
      value={selected}
      onChange={(_, newValue) => {
        picker.remember([newValue]);
        onChange(newValue?.id ?? null);
      }}
      getOptionLabel={(option) => picker.label(option, (o) => o.name ?? '')}
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
                {picker.loading ? <CircularProgress color="inherit" size={20} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      disabled={disabled}
      disableClearable={disableClearable}
      clearOnBlur
      // Escape clears the value even with `disableClearable`.
      clearOnEscape={!disableClearable}
      noOptionsText={picker.loading ? t('common:status.loading') : t('analytics.noOptions')}
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
