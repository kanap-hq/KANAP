import React from 'react';
import { useTranslation } from 'react-i18next';
import { TextField, CircularProgress, Autocomplete, Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

type Department = { id: string; name: string; company_id?: string | null };

type DepartmentSelectProps = {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  companyId?: string | null;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
  size?: 'small' | 'medium';
  /** Kept for callers; departments are not year-scoped. */
  year?: number;
  hideLabel?: boolean;
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

const DepartmentSelect = React.forwardRef<HTMLInputElement, DepartmentSelectProps>(function DepartmentSelect(
  {
    label = 'Department',
    value,
    onChange,
    companyId,
    disabled,
    error,
    helperText,
    placeholder,
    required,
    size = 'medium',
    hideLabel = false,
    textFieldSx,
  },
  ref,
) {
  const { t } = useTranslation(['master-data', 'common']);
  const naked = hideLabel || label === '';
  // The company's departments, searched as the user types; nothing before a company is chosen.
  const picker = useLookupPicker<Department>({
    endpoint: '/departments/lookup',
    scope: { company_id: companyId || null },
    enabled: !!companyId,
    value: value ? [value] : [],
  });
  const isDisabled = disabled || !companyId;
  const selected = value ? picker.selected[0] ?? null : null;

  const control = (
    <Box sx={{ position: 'relative' }}>
      <Autocomplete
        {...picker.autocomplete}
        options={picker.options}
        value={selected}
        onChange={(_, v) => {
          picker.remember([v]);
          onChange(v?.id || null);
        }}
        getOptionLabel={(o) => o.name ?? ''}
        renderInput={(params) => (
          <TextField
            {...params}
            inputRef={(node) => {
              assignRef((params.inputProps as any)?.ref, node);
              assignRef(ref, node ?? null);
            }}
            error={error}
            helperText={companyId ? helperText : undefined}
            required={required}
            size={size}
            placeholder={!companyId ? t('departments.selectCompanyFirst') : (placeholder ?? (naked ? t('common:selects.notSet') : undefined))}
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
        disabled={isDisabled}
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
});

export default DepartmentSelect;
