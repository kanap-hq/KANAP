import React from 'react';
import { useTranslation } from 'react-i18next';
import { Autocomplete, Box, TextField, CircularProgress } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

export type SupplierOption = {
  id: string;
  name: string;
  erp_supplier_id: string | null;
  status: string;
};
type Supplier = SupplierOption;

type SupplierSelectProps = {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
  /** The chosen supplier's label when the caller holds it (the detail's references): no request to show it. */
  selectedOption?: SupplierOption | null;
};

function assignRef<T>(target: React.Ref<T | null> | undefined, value: T | null) {
  if (!target) return;
  if (typeof target === 'function') {
    target(value);
  } else {
    (target as React.MutableRefObject<T | null>).current = value;
  }
}

const SupplierSelect = React.forwardRef<HTMLInputElement, SupplierSelectProps>(function SupplierSelect(
  {
    label = 'Supplier',
    value,
    onChange,
    disabled,
    error,
    helperText,
    placeholder,
    required = false,
    hideLabel = false,
    textFieldSx,
    selectedOption,
  },
  ref,
) {
  const { t } = useTranslation(['master-data', 'common']);
  const naked = hideLabel || label === '';
  const picker = useLookupPicker<Supplier>({
    endpoint: '/suppliers/lookup',
    value: value ? [value] : [],
    given: [selectedOption],
  });
  const selectedSupplier = value ? picker.selected[0] ?? null : null;

  const control = (
    <Autocomplete
      {...picker.autocomplete}
      options={picker.options}
      value={selectedSupplier}
      onChange={(_, newValue) => {
        picker.remember([newValue]);
        onChange(newValue?.id || null);
      }}
      getOptionLabel={(option) => option.name ?? ''}
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          <div>
            <div className="kanap-autocomplete-option-primary">
              {option.name}
            </div>
            {option.erp_supplier_id && (
              <div className="kanap-autocomplete-option-secondary">
                ERP ID: {option.erp_supplier_id}
              </div>
            )}
            {option.status && option.status.toLowerCase() === 'disabled' && (
              <div className="kanap-autocomplete-option-secondary">(disabled)</div>
            )}
          </div>
        </li>
      )}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          placeholder={placeholder ?? (naked ? t('common:selects.notSet') : undefined)}
          variant="standard"
          sx={textFieldSx}
          inputRef={(node) => {
            assignRef((params.inputProps as any)?.ref, node);
            assignRef(ref, node ?? null);
          }}
          error={error}
          helperText={helperText}
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
      noOptionsText={picker.loading ? t('common:status.loading') : t('master-data:suppliers.noSuppliersFound')}
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

export default SupplierSelect;
