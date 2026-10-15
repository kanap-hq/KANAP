import React from 'react';
import { Autocomplete, MenuItem, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { CurrencyOption } from '../../../constants/isoOptions';
import { useCurrencyOptions } from '../../../i18n/currencies';
import useCurrencySettings from '../../../hooks/useCurrencySettings';
import { useFieldDraft } from '../../../hooks/useFieldDraft';
import { useLocale } from '../../../i18n/useLocale';
import { drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import { BILLING_FREQUENCIES, type BillingFrequency, formatAmount, parseAmount, parseMonths } from '../contractForm';

/** The tenant's currencies (Currency settings), all of them when none is set; the contract's own always listed. */
export function useContractCurrencyOptions(current: string): CurrencyOption[] {
  const { data } = useCurrencySettings();
  const currencyOptions = useCurrencyOptions();
  return React.useMemo(() => {
    const allowed = data?.allowedCurrencies;
    let options = currencyOptions;
    if (allowed && allowed.length > 0) {
      const set = new Set(allowed.map((code) => code.toUpperCase()));
      const filtered = currencyOptions.filter((option) => set.has(option.code));
      if (filtered.length) options = filtered;
    }
    const code = (current || '').toUpperCase();
    if (code && !options.some((option) => option.code === code)) {
      options = [...options, currencyOptions.find((option) => option.code === code) ?? ({ code, name: code } as CurrencyOption)];
    }
    return options;
  }, [currencyOptions, current, data?.allowedCurrencies]);
}

/** The tenant's default currency for new contracts. */
export function useDefaultContractCurrency(): string | null {
  const { data } = useCurrencySettings();
  return data?.defaultSpendCurrency?.toUpperCase() ?? null;
}

export function CurrencyField({ value, onChange, disabled, ariaLabel }: { value: string; onChange: (code: string) => void; disabled?: boolean; ariaLabel: string }) {
  const options = useContractCurrencyOptions(value);
  const selected = options.find((option) => option.code === (value || '').toUpperCase()) ?? null;
  return (
    <Autocomplete<CurrencyOption, false, true, false>
      // Remounted when the value appears (the tenant default loads after the first render): the
      // field would stay uncontrolled otherwise.
      key={selected?.code ?? 'none'}
      options={options}
      disableClearable
      value={selected ?? undefined}
      onChange={(_event, option) => { if (option?.code) onChange(option.code); }}
      getOptionLabel={(option) => option.code}
      renderOption={(props, option) => {
        const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
        return <li key={key} {...rest}>{`${option.code} · ${option.name}`}</li>;
      }}
      isOptionEqualToValue={(option, current) => option.code === current.code}
      disabled={disabled}
      renderInput={(params) => (
        <TextField {...params} variant="standard" inputProps={{ ...params.inputProps, 'aria-label': ariaLabel }} />
      )}
    />
  );
}

export function BillingField({ value, onChange, disabled, ariaLabel }: { value: BillingFrequency; onChange: (next: BillingFrequency) => void; disabled?: boolean; ariaLabel: string }) {
  const { t } = useTranslation(['ops']);
  return (
    <TextField
      select
      variant="standard"
      value={value}
      onChange={(event) => onChange(event.target.value as BillingFrequency)}
      SelectProps={{ inputProps: { 'aria-label': ariaLabel } }}
      sx={drawerSelectSx}
      disabled={disabled}
    >
      {BILLING_FREQUENCIES.map((frequency) => (
        <MenuItem key={frequency} value={frequency} sx={drawerMenuItemSx}>{t(`contracts.billing.${frequency}`)}</MenuItem>
      ))}
    </TextField>
  );
}

export function RenewalField({ value, onChange, disabled, ariaLabel }: { value: boolean; onChange: (next: boolean) => void; disabled?: boolean; ariaLabel: string }) {
  const { t } = useTranslation(['ops']);
  return (
    <TextField
      select
      variant="standard"
      value={value ? 'yes' : 'no'}
      onChange={(event) => onChange(event.target.value === 'yes')}
      SelectProps={{ inputProps: { 'aria-label': ariaLabel } }}
      sx={drawerSelectSx}
      disabled={disabled}
    >
      <MenuItem value="yes" sx={drawerMenuItemSx}>{t('contracts.fields.yes')}</MenuItem>
      <MenuItem value="no" sx={drawerMenuItemSx}>{t('contracts.fields.no')}</MenuItem>
    </TextField>
  );
}

/**
 * A number of months or an amount. Each valid value reaches `onValue` as it is typed (the page
 * recomputes the terms, the autosave waits for a pause); `onCommit` runs on blur. An invalid text
 * is flagged and never sent.
 */
export function NumberField({
  kind,
  value,
  onValue,
  onCommit,
  disabled,
  ariaLabel,
  placeholder,
}: {
  kind: 'months' | 'amount';
  value: number | null;
  onValue: (next: number) => void;
  onCommit?: () => void;
  disabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
}) {
  const { t } = useTranslation(['ops']);
  const locale = useLocale();
  const shown = value == null ? '' : kind === 'amount' ? formatAmount(value, locale) : String(value);
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(shown);
  const parse = kind === 'amount' ? parseAmount : parseMonths;
  const invalid = draft.trim() !== '' && parse(draft) === null;
  return (
    <TextField
      variant="standard"
      value={draft}
      onFocus={onFocus}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = parse(event.target.value);
        if (next !== null && next !== value) onValue(next);
      }}
      onBlur={() => {
        onBlur();
        onCommit?.();
        if (invalid || draft.trim() === '') setDraft(shown);
      }}
      onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
      error={invalid}
      helperText={invalid ? t(kind === 'amount' ? 'contracts.messages.invalidAmount' : 'contracts.messages.invalidMonths') : undefined}
      placeholder={placeholder}
      fullWidth
      disabled={disabled}
      inputProps={{ inputMode: kind === 'amount' ? 'decimal' : 'numeric', 'aria-label': ariaLabel, style: kind === 'amount' ? { textAlign: 'right' } : undefined }}
    />
  );
}
