import React from 'react';
import { Autocomplete, Box, CircularProgress, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import OptionWithHint from './OptionWithHint';
import api from '../../api';
import { useRelationLabels } from '../workspace/relations/labels';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

type ApplicationOption = {
  id: string;
  name: string;
  lifecycle: string;
  criticality: string;
};

type ApplicationSelectProps = {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  helperText?: React.ReactNode;
  hideLabel?: boolean;
  required?: boolean;
  placeholder?: string;
  textFieldSx?: SxProps<Theme>;
  // When true, only applications with Data Integration / ETL enabled are listed.
  onlyEtl?: boolean;
};

function assignRef<T>(target: React.Ref<T | null> | undefined, value: T | null) {
  if (!target) return;
  if (typeof target === 'function') {
    target(value);
  } else {
    (target as React.MutableRefObject<T | null>).current = value;
  }
}

const ApplicationSelect = React.forwardRef<HTMLInputElement, ApplicationSelectProps>(function ApplicationSelect(
  {
    label: labelProp,
    value,
    onChange,
    disabled,
    helperText,
    hideLabel,
    required,
    placeholder,
    textFieldSx,
    onlyEtl,
  },
  ref,
) {
  const { t } = useTranslation('common');
  const relationLabels = useRelationLabels();
  const label = labelProp ?? t('selects.application');
  const naked = hideLabel || label === '';
  const { data: applications, isLoading } = useQuery({
    queryKey: ['applications', 'select', onlyEtl ? 'etl' : 'all'],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 500, sort: 'name:ASC' };
      if (onlyEtl) {
        params.filters = JSON.stringify({ etl_enabled: { type: 'equals', filter: true } });
      }
      const res = await api.get<{ items: ApplicationOption[] }>('/applications', { params });
      return res.data.items || [];
    },
  });

  const needSelectedFetch = !!value && !(applications || []).some((a) => a.id === value);
  const { data: selected, isLoading: loadingSelected } = useQuery({
    queryKey: ['applications', 'by-id', value],
    enabled: needSelectedFetch,
    queryFn: async () => {
      const res = await api.get<ApplicationOption>(`/applications/${value}`);
      return res.data as unknown as ApplicationOption;
    },
  });

  const mergedOptions = React.useMemo(() => {
    const list = applications ? [...applications] : [];
    if (selected && !list.some((app) => app.id === selected.id)) {
      list.unshift(selected);
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [applications, selected]);

  const selectedOption = mergedOptions.find((app) => app.id === value) || null;

  const control = (
    <Autocomplete
      options={mergedOptions}
      value={selectedOption}
      disabled={disabled || isLoading || loadingSelected}
      onChange={(_, newValue) => onChange(newValue?.id || null)}
      getOptionLabel={(option) => option.name}
      renderOption={(props, option) => (
        <OptionWithHint
          key={option.id}
          optionProps={props}
          label={option.name}
          hint={[
            option.lifecycle ? relationLabels.lifecycle(option.lifecycle) : '',
            option.criticality ? relationLabels.criticality(option.criticality) : '',
          ].filter(Boolean).join(' · ')}
        />
      )}
      filterOptions={(options, { inputValue }) => {
        const term = inputValue.toLowerCase();
        return options.filter((opt) => opt.name.toLowerCase().includes(term));
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder ?? (naked ? t('selects.notSet') : undefined)}
          required={required}
          helperText={helperText}
          variant="standard"
          inputRef={(node) => {
            assignRef((params.inputProps as any)?.ref, node);
            assignRef(ref, node ?? null);
          }}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {(isLoading || loadingSelected) ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
          sx={textFieldSx}
        />
      )}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      loading={isLoading || loadingSelected}
      noOptionsText={isLoading ? t('selects.loadingEllipsis') : t('selects.noApplicationsFound')}
      fullWidth
    />
  );

  if (naked || !label) return control;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {control}
    </Box>
  );
});

export default ApplicationSelect;
