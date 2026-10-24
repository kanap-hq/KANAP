import React from 'react';
import { Autocomplete, Box, CircularProgress, TextField } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { FieldLabel } from '../design';
import OptionWithHint from './OptionWithHint';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';
import { useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { ANALYTICS_VALUES_LOOKUP_ENDPOINT, createAnalyticsValueFromLine, type AnalyticsValue, type AnalyticsValueFromLine } from '../../services/analytics';
import type { LineType } from '../../constants/lineTypeUsage';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/**
 * Where a value added from the picker goes: the line it is chosen on, or the place (company, cost
 * center) of a line being created. The server checks either against the person's access.
 */
export type NewAnalyticsValueTarget =
  | { lineId: string }
  | { payingCompanyId?: string | null; costCenterId?: string | null };

/** The extra option of an open dimension: "Add “…”" for the typed name no value has. */
const ADD_OPTION_ID = '__add_value__';

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
  /**
   * On a budget line the person may edit: an open dimension (`open_values`) offers to add the typed
   * name as a new value. A closed one never does (its values come from the dimension page).
   */
  newValueFor?: NewAnalyticsValueTarget | null;
};

function fromLineBody(axisId: string, name: string, target: NewAnalyticsValueTarget): AnalyticsValueFromLine {
  if ('lineId' in target) return { axis_id: axisId, name, line_id: target.lineId };
  return {
    axis_id: axisId,
    name,
    ...(target.payingCompanyId ? { paying_company_id: target.payingCompanyId } : {}),
    ...(target.costCenterId ? { cost_center_id: target.costCenterId } : {}),
  };
}

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
  newValueFor = null,
}: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const needsAxisLabel = label === undefined && !hideLabel;
  const mayAdd = !!newValueFor && !disabled;
  const axes = useAnalyticsAxes({ enabled: needsAxisLabel || mayAdd });
  const openValues = mayAdd && !!axes.byId.get(axisId)?.open_values;
  const [adding, setAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);

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
  const typed = picker.text.trim();

  // An open dimension offers the typed name as a new value when no value shown has it (any case);
  // the server finds an existing one regardless of case all the same.
  const baseFilter = picker.autocomplete.filterOptions;
  const filterOptions = React.useCallback(
    (list: AnalyticsValue[], state: { getOptionLabel: (option: AnalyticsValue) => string }) => {
      const shown = baseFilter(list, state);
      if (!openValues || !typed) return shown;
      const folded = typed.toLocaleLowerCase();
      if (shown.some((option) => (option.name ?? '').trim().toLocaleLowerCase() === folded)) return shown;
      return [...shown, { id: ADD_OPTION_ID, axis_id: axisId, name: typed } as AnalyticsValue];
    },
    [baseFilter, openValues, typed, axisId],
  );

  const addValue = async (name: string) => {
    if (!newValueFor) return;
    setAdding(true);
    setAddError(null);
    try {
      const value = await createAnalyticsValueFromLine(fromLineBody(axisId, name, newValueFor));
      picker.remember([value]);
      onChange(value.id);
      if (value.created) void queryClient.invalidateQueries({ queryKey: ['lookup', ANALYTICS_VALUES_LOOKUP_ENDPOINT] });
    } catch (e) {
      setAddError(getApiErrorMessage(e, t, t('analytics.messages.valueAddFailed')));
    } finally {
      setAdding(false);
    }
  };
  const resolvedLabel = label ?? axes.label(axes.byId.get(axisId) ?? { name: null });
  const naked = hideLabel || resolvedLabel === '';
  // A hidden label still names the field for assistive technology, when the caller gave one.
  const ariaLabel = hideLabel ? label : resolvedLabel;

  const control = (
    <Autocomplete
      {...picker.autocomplete}
      options={picker.options}
      filterOptions={filterOptions}
      value={selected}
      onChange={(_, newValue) => {
        if (newValue?.id === ADD_OPTION_ID) {
          void addValue(newValue.name);
          return;
        }
        setAddError(null);
        picker.remember([newValue]);
        onChange(newValue?.id ?? null);
      }}
      getOptionLabel={(option) => picker.label(option, (o) => o.name ?? '')}
      renderOption={(props, option) => (option.id === ADD_OPTION_ID ? (
        <OptionWithHint key={option.id} optionProps={props} label={t('analytics.addValue', { value: option.name })} />
      ) : (
        <OptionWithHint
          key={option.id}
          optionProps={props}
          label={option.name}
          hint={option.description}
          trailing={option.status === 'disabled' ? t('common:statuses.disabled') : null}
        />
      ))}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          sx={textFieldSx}
          placeholder={naked ? t('common:selects.notSet') : undefined}
          error={error || !!addError}
          helperText={addError ?? helperText}
          inputProps={ariaLabel ? { ...params.inputProps, 'aria-label': ariaLabel } : params.inputProps}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {picker.loading || adding ? <CircularProgress color="inherit" size={20} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      disabled={disabled || adding}
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
