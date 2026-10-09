import React from 'react';
import { Autocomplete, Box, Divider, TextField, CircularProgress } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { formatUserOption, USERS_LOOKUP_ENDPOINT, useMeOption, withMeFirst, type UserOption } from './userLookup';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';

type User = UserOption;

type UserSelectProps = {
  label?: string;
  value: string | null | undefined;
  /** The picked record travels with the id so callers can show its name at once. */
  onChange: (v: string | null, user: User | null) => void;
  /** Hide one person from the list, e.g. a contributor cannot manage themselves. */
  excludeUserId?: string | null;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
  size?: 'small' | 'medium';
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
  /** The chosen person's label when the caller holds it: no request to show it. */
  selectedOption?: UserOption | null;
};

function assignRef<T>(target: React.Ref<T | null> | undefined, value: T | null) {
  if (!target) return;
  if (typeof target === 'function') {
    target(value);
  } else {
    (target as React.MutableRefObject<T | null>).current = value;
  }
}

const UserSelect = React.forwardRef<HTMLInputElement, UserSelectProps>(function UserSelect(
  {
    label: labelProp,
    value,
    onChange,
    excludeUserId = null,
    disabled,
    error,
    helperText,
    placeholder,
    required,
    size,
    hideLabel = false,
    textFieldSx,
    selectedOption,
  },
  ref,
) {
  const { t } = useTranslation('common');
  const label = labelProp ?? t('selects.user');
  const naked = hideLabel || label === '';
  const me = useMeOption();
  const myId = me?.id ?? null;
  const picker = useLookupPicker<User>({
    endpoint: USERS_LOOKUP_ENDPOINT,
    value: value ? [value] : [],
    given: [selectedOption],
  });
  const options = React.useMemo(
    () => withMeFirst(picker.options, me, picker.searching, (u) => u.id === excludeUserId)
      .filter((u) => u.id !== excludeUserId),
    [picker.options, me, picker.searching, excludeUserId],
  );
  const selected = value ? picker.selected[0] ?? null : null;

  const formatName = formatUserOption;

  const control = (
    <Autocomplete
      {...picker.autocomplete}
      options={options}
      value={selected}
      onChange={(_, newValue) => {
        picker.remember([newValue]);
        onChange(newValue?.id || null, newValue ?? null);
      }}
      getOptionLabel={(option) => picker.label(option, formatName)}
      size={size}
      renderOption={(props, option) => (
        <React.Fragment key={option.id}>
          <li {...props}>
            <div className="kanap-autocomplete-option-primary">
              {formatName(option)}{option.id === myId ? ` ${t('selects.meSuffix')}` : ''}
            </div>
          </li>
          {option.id === myId && !picker.searching && <Divider />}
        </React.Fragment>
      )}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          size={size}
          variant="standard"
          sx={textFieldSx}
          inputRef={(node) => {
            assignRef((params.inputProps as any)?.ref, node);
            assignRef(ref, node ?? null);
          }}
          placeholder={placeholder ?? (naked ? t('selects.notSet') : undefined)}
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
});

export default UserSelect;
