import React from 'react';
import { Autocomplete, Box, Chip, CircularProgress, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

type BusinessProcess = {
  id: string;
  name: string;
  status: string;
};

type Props = {
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  helperText?: React.ReactNode;
  error?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
};

export default function BusinessProcessMultiSelect({
  value,
  onChange,
  label: labelProp,
  helperText,
  error,
  disabled,
  hideLabel = false,
  textFieldSx,
}: Props) {
  const { t } = useTranslation('common');
  const label = labelProp ?? t('selects.businessProcesses');
  const naked = hideLabel || label === '';
  // Processes searched as the user types; the chosen ones keep their labels (one batch read).
  const picker = useLookupPicker<BusinessProcess>({ endpoint: '/business-processes/lookup', value });

  const control = (
    <Autocomplete<BusinessProcess, true, false, false>
      multiple
      {...picker.autocomplete}
      options={picker.options}
      value={picker.selected}
      // A chosen process whose name is still loading cannot be dropped by an edit meanwhile.
      disabled={disabled || picker.hydrating}
      onChange={(_, newValue) => {
        picker.remember(newValue);
        onChange(newValue.map((opt) => opt.id));
      }}
      getOptionLabel={(option) => option.name ?? ''}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => (
          <Chip
            {...getTagProps({ index })}
            key={option.id}
            label={option.name}
            size="small"
          />
        ))
      }
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          sx={textFieldSx}
          placeholder={t('selects.selectBusinessProcesses')}
          helperText={helperText}
          error={error}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {picker.loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      noOptionsText={picker.loading ? t('selects.loading') : t('selects.noBusinessProcessesFound')}
      fullWidth
    />
  );

  if (naked || !label) return control;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
      <FieldLabel>{label}</FieldLabel>
      {control}
    </Box>
  );
}
