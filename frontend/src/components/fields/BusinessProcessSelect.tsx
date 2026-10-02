import React from 'react';
import { Autocomplete, Box, CircularProgress, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

type BusinessProcessOption = {
  id: string;
  name: string;
};

type BusinessProcessSelectProps = {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  helperText?: React.ReactNode;
  hideLabel?: boolean;
  required?: boolean;
  placeholder?: string;
  textFieldSx?: SxProps<Theme>;
};

function assignRef<T>(target: React.Ref<T | null> | undefined, value: T | null) {
  if (!target) return;
  if (typeof target === 'function') {
    target(value);
  } else {
    (target as React.MutableRefObject<T | null>).current = value;
  }
}

const BusinessProcessSelect = React.forwardRef<HTMLInputElement, BusinessProcessSelectProps>(function BusinessProcessSelect(
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
  },
  ref,
) {
  const { t } = useTranslation('common');
  const label = labelProp ?? t('selects.businessProcess');
  const naked = hideLabel || label === '';
  // Processes searched as the user types; the current one keeps its label (read once by id).
  const picker = useLookupPicker<BusinessProcessOption>({ endpoint: '/business-processes/lookup', value: value ? [value] : [] });
  const selectedOption = value ? picker.selected[0] ?? null : null;

  const control = (
    <Autocomplete
      {...picker.autocomplete}
      options={picker.options}
      value={selectedOption}
      disabled={disabled}
      onChange={(_, newValue) => {
        picker.remember([newValue]);
        onChange(newValue?.id || null);
      }}
      getOptionLabel={(option) => picker.label(option, (o) => o.name ?? '')}
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          {option.name}
        </li>
      )}
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
                {picker.loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
          sx={textFieldSx}
        />
      )}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      noOptionsText={picker.loading ? t('selects.loadingEllipsis') : t('selects.noBusinessProcessesFound')}
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

export default BusinessProcessSelect;
