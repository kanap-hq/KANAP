import React from 'react';
import { Autocomplete, Box, TextField, CircularProgress } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useLookupPicker } from '../../hooks/useLookupPicker';
import { FieldLabel } from '../design';
import { drawerAutocompleteListboxSx } from '../../theme/formSx';
import type { AccountNature } from '../../constants/accountNature';

export type AccountOption = {
  id: string;
  account_number: number;
  account_name: string;
  description?: string | null;
  /** The lines that may use the account: null for OPEX and CAPEX lines. */
  nature?: AccountNature | null;
};
type Account = AccountOption;

type AccountSelectProps = {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: React.ReactNode;
  required?: boolean;
  companyId?: string | null | undefined;
  hideLabel?: boolean;
  textFieldSx?: SxProps<Theme>;
  disableClearable?: boolean;
  /** The chosen account's label when the caller holds it (the detail's references): no request to show it. */
  selectedOption?: AccountOption | null;
  /** Offers only the accounts this kind of line may use. A stored account of the other kind still shows. */
  nature?: AccountNature;
};

function assignRef<T>(target: React.Ref<T | null> | undefined, value: T | null) {
  if (!target) return;
  if (typeof target === 'function') {
    target(value);
  } else {
    (target as React.MutableRefObject<T | null>).current = value;
  }
}

const AccountSelect = React.forwardRef<HTMLInputElement, AccountSelectProps>(function AccountSelect(
  {
    label: labelProp,
    value,
    onChange,
    disabled,
    error,
    helperText,
    required = false,
    companyId,
    hideLabel = false,
    textFieldSx,
    disableClearable = false,
    selectedOption,
    nature,
  },
  ref,
) {
  const { t } = useTranslation('common');
  const label = labelProp ?? t('selects.account');
  const naked = hideLabel || label === '';
  // A hidden label still names the field for assistive technology; the placeholder must not.
  const ariaLabel = naked && label ? label : undefined;
  // The company's chart of accounts, searched as the user types; nothing before a company is chosen.
  // The chosen account is read by id, whatever its nature: a legacy line keeps showing its account.
  const picker = useLookupPicker<Account>({
    endpoint: '/accounts/lookup',
    scope: { companyId: companyId || null, nature: nature ?? null },
    enabled: !!companyId,
    value: value ? [value] : [],
    given: [selectedOption],
  });
  const selectedAccount: Account | null = value ? picker.selected[0] ?? null : null;
  const accountLabel = (option: Account) => (option.account_name == null ? '' : `[${option.account_number}] ${option.account_name}`);

  const control = (
    <Autocomplete
      {...picker.autocomplete}
      options={picker.options}
      value={selectedAccount}
      onChange={(_, newValue) => {
        picker.remember([newValue]);
        onChange(newValue?.id || null);
      }}
      getOptionLabel={(option) => picker.label(option, accountLabel)}
      disableClearable={disableClearable}
      blurOnSelect
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          {accountLabel(option)}
        </li>
      )}
      ListboxProps={naked ? { sx: drawerAutocompleteListboxSx } : undefined}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          variant="standard"
          sx={textFieldSx}
          inputProps={ariaLabel ? { ...params.inputProps, 'aria-label': ariaLabel } : params.inputProps}
          inputRef={(node) => {
            assignRef((params.inputProps as any)?.ref, node);
            assignRef(ref, node ?? null);
          }}
          placeholder={naked ? t('selects.notSet') : undefined}
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
      noOptionsText={picker.loading ? t('selects.loading') : t('selects.noAccountsFound')}
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

export default AccountSelect;
