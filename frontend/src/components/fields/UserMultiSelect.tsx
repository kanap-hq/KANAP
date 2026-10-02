import React from 'react';
import { Autocomplete, Box, Divider, TextField, CircularProgress, Chip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { formatUserName } from '../../utils/userDisplay';
import { USERS_LOOKUP_ENDPOINT, useMeOption, withMeFirst, type UserOption } from './userLookup';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

type User = UserOption;

type UserMultiSelectProps = {
  label?: string;
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
  size?: 'small' | 'medium';
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
  /** Labels of chosen people the caller already holds: no request to show them. */
  selectedOptions?: UserOption[];
};

export default function UserMultiSelect({
  label: labelProp,
  value,
  onChange,
  disabled,
  error,
  helperText,
  placeholder,
  required,
  size,
  hideLabel = false,
  textFieldSx,
  selectedOptions,
}: UserMultiSelectProps) {
  const { t } = useTranslation('common');
  const label = labelProp ?? t('selects.users');
  const naked = hideLabel || label === '';
  const me = useMeOption();
  const myId = me?.id ?? null;
  const picker = useLookupPicker<User>({
    endpoint: USERS_LOOKUP_ENDPOINT,
    value,
    given: selectedOptions,
  });
  const options = React.useMemo(() => withMeFirst(picker.options, me, picker.searching), [picker.options, me, picker.searching]);
  const selected = picker.selected;

  // `…` while a chosen person's name loads, "Value no longer available" when it cannot.
  const formatName = (u: User) => picker.label(u, (person) => formatUserName(person) ?? '');

  const control = (
    <Autocomplete
      multiple
      {...picker.autocomplete}
      options={options}
      value={selected}
      onChange={(_, newValue) => {
        picker.remember(newValue);
        onChange(newValue.map((u) => u.id));
      }}
      getOptionLabel={(option) => formatName(option)}
      size={size}
      renderOption={(props, option) => (
        <React.Fragment key={option.id}>
          <li {...props}>
            <div style={{ fontWeight: 500 }}>
              {formatName(option)}{option.id === myId ? ` ${t('selects.meSuffix')}` : ''}
            </div>
          </li>
          {option.id === myId && !picker.searching && <Divider />}
        </React.Fragment>
      )}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => (
          <Chip
            {...getTagProps({ index })}
            key={option.id}
            label={formatName(option)}
            size="small"
          />
        ))
      }
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          size={size}
          variant="standard"
          sx={textFieldSx}
          placeholder={placeholder ?? (naked && selected.length === 0 ? t('selects.notSet') : undefined)}
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
      // A chosen person whose name is still loading cannot be dropped by an edit meanwhile.
      disabled={disabled || picker.hydrating}
      noOptionsText={picker.loading ? t('selects.loading') : t('selects.noUsersFound')}
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
}
