import React from 'react';
import { TextField, CircularProgress, Autocomplete, Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

export type CompanyOption = { id: string; name: string };
type Company = CompanyOption;

export default function CompanySelect({
  label = 'Company',
  value,
  onChange,
  disabled,
  error,
  helperText,
  placeholder,
  required,
  size = 'medium',
  excludeCompanyIds,
  hideLabel = false,
  textFieldSx,
  disableClearable = false,
  selectedOption,
}: {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
  size?: 'small' | 'medium';
  excludeCompanyIds?: string[];
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
  disableClearable?: boolean;
  /** The chosen company's label when the caller holds it (the detail's references): no request to show it. */
  selectedOption?: CompanyOption | null;
}) {
  const { t } = useTranslation('common');
  const naked = hideLabel || label === '';
  const picker = useLookupPicker<Company>({
    endpoint: '/companies/lookup',
    value: value ? [value] : [],
    given: [selectedOption],
  });
  const excluded = React.useMemo(() => new Set(excludeCompanyIds ?? []), [excludeCompanyIds]);
  // An excluded company is not offered, but the current one stays visible.
  const options = React.useMemo(
    () => (excluded.size === 0 ? picker.options : picker.options.filter((c) => !excluded.has(c.id) || c.id === value)),
    [excluded, picker.options, value],
  );
  const selected = value ? picker.selected[0] ?? null : null;

  const control = (
    <Box sx={{ position: 'relative' }}>
      <Autocomplete
        {...picker.autocomplete}
        options={options}
        value={selected}
        onChange={(_, v) => {
          picker.remember([v]);
          onChange(v?.id || null);
        }}
        getOptionLabel={(o) => picker.label(o, (c) => c.name ?? '')}
        disableClearable={disableClearable}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={placeholder ?? (naked ? t('selects.notSet') : undefined)}
            error={error}
            helperText={helperText}
            required={required}
            size={size}
            variant="standard"
            sx={textFieldSx}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {picker.loading ? <CircularProgress size={20} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
        disabled={disabled}
        ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
        size={size}
        fullWidth
      />
    </Box>
  );

  if (naked || !label) return control;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {control}
    </Box>
  );
}
