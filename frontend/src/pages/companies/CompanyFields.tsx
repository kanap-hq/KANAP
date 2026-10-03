import React from 'react';
import { useTranslation } from 'react-i18next';
import { Autocomplete, TextField } from '@mui/material';
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS } from '../../constants/isoOptions';
import { drawerAutocompleteListboxSx, drawerFieldValueSx } from '../../theme/formSx';
import type { CoaListItem } from '../coa/useCoaList';

type CodeOption = { code: string; name: string };

/** Charts a company of this country may use: the country's own charts and the global ones. */
export function coaOptionsFor(coas: CoaListItem[], country: string, currentId: string | null): CoaListItem[] {
  return coas.filter((coa) => (
    !country
    || coa.scope === 'GLOBAL'
    || coa.country_iso === country
    // The chart the company already has stays visible, even when it no longer matches.
    || coa.id === currentId
  ));
}

/** The chart the server gives a company of this country: the country default, else the global default. */
export function defaultCoaFor(coas: CoaListItem[], country: string): string | null {
  return coas.find((coa) => coa.scope === 'COUNTRY' && coa.country_iso === country && coa.is_default)?.id
    ?? coas.find((coa) => coa.is_global_default)?.id
    ?? null;
}

function codeLabel(option: CodeOption) {
  return option.name === option.code ? option.code : `${option.name} (${option.code})`;
}

function CodeAutocomplete({
  options,
  value,
  onChange,
  label,
  placeholder,
  clearable,
  disabled,
  error,
}: {
  options: CodeOption[];
  value: string;
  onChange: (code: string) => void;
  label: string;
  placeholder: string;
  clearable: boolean;
  disabled?: boolean;
  error?: string;
}) {
  const code = value.toUpperCase();
  // A stored code missing from the list still shows as itself.
  const selected = options.find((option) => option.code === code) ?? (code ? { code, name: code } : null);
  return (
    <Autocomplete<CodeOption, false, boolean, false>
      options={options}
      value={selected}
      onChange={(_event, option) => onChange(option?.code ?? '')}
      getOptionLabel={codeLabel}
      isOptionEqualToValue={(a, b) => a.code === b.code}
      disableClearable={!clearable}
      disabled={disabled}
      ListboxProps={{ sx: drawerAutocompleteListboxSx }}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          sx={drawerFieldValueSx}
          placeholder={placeholder}
          error={!!error}
          helperText={error}
          inputProps={{ ...params.inputProps, 'aria-label': label }}
        />
      )}
    />
  );
}

type FieldProps = {
  value: string;
  onChange: (code: string) => void;
  clearable: boolean;
  disabled?: boolean;
  error?: string;
};

export function CountryField(props: FieldProps) {
  const { t } = useTranslation(['master-data']);
  return (
    <CodeAutocomplete
      {...props}
      options={COUNTRY_OPTIONS}
      label={t('companies.fields.country')}
      placeholder={t('companies.placeholders.country')}
    />
  );
}

export function CurrencyField(props: FieldProps) {
  const { t } = useTranslation(['master-data']);
  return (
    <CodeAutocomplete
      {...props}
      options={CURRENCY_OPTIONS}
      label={t('companies.fields.baseCurrency')}
      placeholder={t('companies.placeholders.baseCurrency')}
    />
  );
}

export function CoaField({
  coas,
  country,
  value,
  onChange,
  clearable,
  disabled,
  error,
}: {
  coas: CoaListItem[];
  country: string;
  value: string | null;
  onChange: (coaId: string | null) => void;
  clearable: boolean;
  disabled?: boolean;
  error?: string;
}) {
  const { t } = useTranslation(['master-data']);
  const options = React.useMemo(() => coaOptionsFor(coas, country, value), [coas, country, value]);
  const selected = coas.find((coa) => coa.id === value) ?? null;
  const label = t('companies.fields.chartOfAccounts');
  return (
    <Autocomplete<CoaListItem, false, boolean, false>
      options={options}
      value={selected}
      onChange={(_event, option) => onChange(option?.id ?? null)}
      getOptionLabel={(option) => `${option.code} · ${option.name}`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      disableClearable={!clearable}
      disabled={disabled}
      ListboxProps={{ sx: drawerAutocompleteListboxSx }}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          sx={drawerFieldValueSx}
          placeholder={t('companies.placeholders.chartOfAccounts')}
          error={!!error}
          helperText={error}
          inputProps={{ ...params.inputProps, 'aria-label': label }}
        />
      )}
    />
  );
}
