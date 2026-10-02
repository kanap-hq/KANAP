import { useTranslation } from 'react-i18next';
import { Autocomplete, Box, Chip, CircularProgress, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';
import { useLookupPicker } from '../../hooks/useLookupPicker';

type Department = { id: string; name: string; company_id?: string | null };

type DepartmentMultiSelectProps = {
  label?: string;
  value: string[];
  onChange: (value: string[]) => void;
  companyId?: string | null;
  disabled?: boolean;
  placeholder?: string;
  size?: 'small' | 'medium';
  /** Kept for callers; departments are not year-scoped. */
  year?: number;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
};

export default function DepartmentMultiSelect({
  label = 'Departments',
  value,
  onChange,
  companyId,
  disabled,
  placeholder,
  size = 'medium',
  hideLabel = false,
  textFieldSx,
}: DepartmentMultiSelectProps) {
  const { t } = useTranslation(['master-data', 'common']);
  const naked = hideLabel || label === '';
  // The company's departments, searched as the user types; nothing before a company is chosen.
  const picker = useLookupPicker<Department>({
    endpoint: '/departments/lookup',
    scope: { company_id: companyId || null },
    enabled: !!companyId,
    value: value || [],
  });
  const selected = picker.selected;
  const isDisabled = disabled || !companyId || picker.hydrating;

  const baseSx: SxProps<Theme> = [
    ...(Array.isArray(textFieldSx) ? textFieldSx : [textFieldSx]),
    {
      '& .MuiInput-root:before': { display: 'none !important' },
      '& .MuiInput-root:after': { display: 'none !important' },
      '& .MuiInput-root:hover:not(.Mui-disabled):before': { display: 'none !important' },
    },
  ];

  const control = (
    <Box sx={{ position: 'relative' }}>
      <Autocomplete
        multiple
        {...picker.autocomplete}
        options={picker.options}
        value={selected}
        onChange={(_, next) => {
          picker.remember(next);
          onChange(next.map((department) => department.id));
        }}
        getOptionLabel={(option) => option.name ?? ''}
        filterSelectedOptions
        renderTags={(tagValue, getTagProps) => tagValue.map((option, index) => (
          <Chip
            {...getTagProps({ index })}
            key={option.id}
            label={option.name}
            size="small"
            sx={(theme) => ({
              height: 20,
              borderRadius: '3px',
              bgcolor: theme.palette.kanap.pill.bg,
              border: `1px solid ${theme.palette.kanap.pill.border}`,
              color: theme.palette.kanap.text.secondary,
              fontSize: 11,
              '& .MuiChip-label': { px: '6px' },
            })}
          />
        ))}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={
              !companyId
                ? t('departments.selectCompanyFirst')
                : (selected.length === 0
                    ? (placeholder ?? (naked ? t('common:selects.notSet') : 'All departments'))
                    : undefined)
            }
            size={size}
            variant="standard"
            sx={baseSx}
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
      <FieldLabel>{label}</FieldLabel>
      {control}
    </Box>
  );
}
