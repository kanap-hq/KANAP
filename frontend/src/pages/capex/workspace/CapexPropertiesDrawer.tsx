import React from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PropertyGroup, PropertyRow } from '../../../components/design/PropertyRow';
import SupplierSelect from '../../../components/fields/SupplierSelect';
import CompanySelect from '../../../components/fields/CompanySelect';
import AccountSelect from '../../../components/fields/AccountSelect';
import AnalyticsCategorySelect from '../../../components/fields/AnalyticsCategorySelect';
import DateEUField from '../../../components/fields/DateEUField';
import StatusLifecycleField from '../../../components/fields/StatusLifecycleField';
import UserSelect from '../../../components/fields/UserSelect';
import { CURRENCY_OPTIONS, CurrencyOption } from '../../../constants/isoOptions';
import useCurrencySettings from '../../../hooks/useCurrencySettings';
import { STATUS_ENABLED, StatusValue } from '../../../constants/status';
import { formatShortDate } from '../../../lib/dateFormat';
import { isoToLocalDateInput, localDateInputToEndOfDayIso } from '../../../lib/datetime';
import { useLocale } from '../../../i18n/useLocale';
import type { CapexPriority } from './CapexMetadataBar';

export type CapexPpeType = 'hardware' | 'software';
export type CapexInvestmentType = 'replacement' | 'capacity' | 'productivity' | 'security' | 'conformity' | 'business_growth' | 'other';

type Option<T extends string> = { value: T; label: string };

type Props = {
  mode?: 'create' | 'edit';
  supplierId: string;
  payingCompanyId: string;
  accountId: string;
  currency: string;
  ppeType: CapexPpeType;
  investmentType: CapexInvestmentType;
  priority?: CapexPriority;
  analyticsCategoryId: string;
  effectiveStart: string;
  status?: StatusValue;
  disabledAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  ownerItId?: string;
  ownerBusinessId?: string;
  disabled?: boolean;
  onSupplierChange: (next: string) => void;
  onPayingCompanyChange: (next: string) => void;
  onAccountChange: (next: string) => void;
  onCurrencyChange: (next: string) => void;
  onPpeTypeChange: (next: CapexPpeType) => void;
  onInvestmentTypeChange: (next: CapexInvestmentType) => void;
  onPriorityChange?: (next: CapexPriority) => void;
  onAnalyticsCategoryChange: (next: string) => void;
  onEffectiveStartChange: (next: string) => void;
  onStatusChange?: (next: StatusValue) => void;
  onDisabledAtChange?: (next: string | null) => void;
  onOwnerItChange?: (next: string) => void;
  onOwnerBusinessChange?: (next: string) => void;
};

const hideInnerLabelSx = {
  '& .MuiInputLabel-root': { display: 'none' },
  '& .MuiFormControl-root': { m: 0 },
} as const;

function valueOption<T extends string>(options: Option<T>[], value: T): Option<T> {
  return options.find((opt) => opt.value === value) || options[0];
}

export default function CapexPropertiesDrawer({
  mode = 'edit',
  supplierId,
  payingCompanyId,
  accountId,
  currency,
  ppeType,
  investmentType,
  priority = 'medium',
  analyticsCategoryId,
  effectiveStart,
  status = STATUS_ENABLED,
  disabledAt = null,
  createdAt = null,
  updatedAt = null,
  ownerItId = '',
  ownerBusinessId = '',
  disabled = false,
  onSupplierChange,
  onPayingCompanyChange,
  onAccountChange,
  onCurrencyChange,
  onPpeTypeChange,
  onInvestmentTypeChange,
  onPriorityChange,
  onAnalyticsCategoryChange,
  onEffectiveStartChange,
  onStatusChange,
  onDisabledAtChange,
  onOwnerItChange,
  onOwnerBusinessChange,
}: Props) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const { data: currencySettings } = useCurrencySettings();

  const ppeOptions = React.useMemo<Array<Option<CapexPpeType>>>(() => [
    { value: 'hardware', label: t('capex.ppeTypes.hardware') },
    { value: 'software', label: t('capex.ppeTypes.software') },
  ], [t]);
  const investmentOptions = React.useMemo<Array<Option<CapexInvestmentType>>>(() => [
    { value: 'replacement', label: t('capex.investmentTypes.replacement') },
    { value: 'capacity', label: t('capex.investmentTypes.capacity') },
    { value: 'productivity', label: t('capex.investmentTypes.productivity') },
    { value: 'security', label: t('capex.investmentTypes.security') },
    { value: 'conformity', label: t('capex.investmentTypes.conformity') },
    { value: 'business_growth', label: t('capex.investmentTypes.business_growth') },
    { value: 'other', label: t('capex.investmentTypes.other') },
  ], [t]);
  const priorityOptions = React.useMemo<Array<Option<CapexPriority>>>(() => [
    { value: 'mandatory', label: t('capex.priorityTypes.mandatory') },
    { value: 'high', label: t('capex.priorityTypes.high') },
    { value: 'medium', label: t('capex.priorityTypes.medium') },
    { value: 'low', label: t('capex.priorityTypes.low') },
  ], [t]);

  const currencyOptions = React.useMemo<CurrencyOption[]>(() => {
    const allowed = currencySettings?.allowedCurrencies;
    if (allowed && allowed.length > 0) {
      const set = new Set(allowed.map((c: string) => c.toUpperCase()));
      const filtered = CURRENCY_OPTIONS.filter((opt) => set.has(opt.code));
      return filtered.length ? filtered : CURRENCY_OPTIONS;
    }
    return CURRENCY_OPTIONS;
  }, [currencySettings]);

  const currencyValue = React.useMemo<CurrencyOption | null>(() => {
    const code = (currency || '').toUpperCase();
    return currencyOptions.find((opt) => opt.code === code)
      ?? (code ? ({ code, name: code } as CurrencyOption) : null);
  }, [currency, currencyOptions]);

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('capex.fields.supplier')}>
          <Box sx={hideInnerLabelSx}>
            <SupplierSelect value={supplierId} onChange={(v) => onSupplierChange(v ?? '')} disabled={disabled} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('capex.fields.payingCompany')} required>
          <Box sx={hideInnerLabelSx}>
            <CompanySelect value={payingCompanyId || null} onChange={(v) => onPayingCompanyChange(v ?? '')} disabled={disabled} required disableClearable={mode === 'edit'} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('capex.fields.account')} required>
          <Box sx={hideInnerLabelSx}>
            <AccountSelect value={accountId} onChange={(v) => onAccountChange(v ?? '')} companyId={payingCompanyId || undefined} disabled={disabled || !payingCompanyId} required disableClearable={mode === 'edit'} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('capex.fields.currency')} required>
          <Autocomplete<CurrencyOption, false, true, false>
            options={currencyOptions}
            disableClearable
            value={currencyValue ?? undefined}
            onChange={(_e, option) => onCurrencyChange(option?.code ?? currency)}
            getOptionLabel={(option) => `${option.code} - ${option.name}`}
            isOptionEqualToValue={(option, value) => option.code === value.code}
            disabled={disabled}
            renderInput={(params) => (
              <TextField {...params} variant="standard" />
            )}
          />
        </PropertyRow>
        <PropertyRow label={t('capex.fields.ppeType')} required>
          <Autocomplete<Option<CapexPpeType>, false, true, false>
            options={ppeOptions}
            disableClearable
            value={valueOption(ppeOptions, ppeType)}
            onChange={(_e, option) => onPpeTypeChange(option?.value ?? ppeType)}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, value) => option.value === value.value}
            disabled={disabled}
            renderInput={(params) => (
              <TextField {...params} variant="standard" />
            )}
          />
        </PropertyRow>
        <PropertyRow label={t('capex.fields.investmentType')} required>
          <Autocomplete<Option<CapexInvestmentType>, false, true, false>
            options={investmentOptions}
            disableClearable
            value={valueOption(investmentOptions, investmentType)}
            onChange={(_e, option) => onInvestmentTypeChange(option?.value ?? investmentType)}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, value) => option.value === value.value}
            disabled={disabled}
            renderInput={(params) => (
              <TextField {...params} variant="standard" />
            )}
          />
        </PropertyRow>
        {mode === 'create' && onPriorityChange && (
          <PropertyRow label={t('capex.fields.priority')} required>
            <Autocomplete<Option<CapexPriority>, false, true, false>
              options={priorityOptions}
              disableClearable
              value={valueOption(priorityOptions, priority)}
              onChange={(_e, option) => onPriorityChange(option?.value ?? priority)}
              getOptionLabel={(option) => option.label}
              isOptionEqualToValue={(option, value) => option.value === value.value}
              disabled={disabled}
              renderInput={(params) => (
                <TextField {...params} variant="standard" />
              )}
            />
          </PropertyRow>
        )}
        <PropertyRow label={t('capex.fields.analyticsCategory')}>
          <Box sx={hideInnerLabelSx}>
            <AnalyticsCategorySelect value={analyticsCategoryId || null} onChange={(v) => onAnalyticsCategoryChange(v ?? '')} disabled={disabled} />
          </Box>
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('capex.fields.effectiveStart')} required>
          <Box sx={hideInnerLabelSx}>
            <DateEUField label="" valueYmd={effectiveStart || ''} onChangeYmd={onEffectiveStartChange} disabled={disabled} required />
          </Box>
        </PropertyRow>
        {mode === 'create' && onDisabledAtChange && (
          <PropertyRow label={t('capex.fields.endOfValidity')} helperText={t('capex.fields.endOfValidityHint')}>
            <Box sx={hideInnerLabelSx}>
              <DateEUField
                label=""
                valueYmd={isoToLocalDateInput(disabledAt)}
                onChangeYmd={(ymd) => onDisabledAtChange(localDateInputToEndOfDayIso(ymd))}
                disabled={disabled}
              />
            </Box>
          </PropertyRow>
        )}
      </PropertyGroup>

      {mode === 'create' && (onOwnerItChange || onOwnerBusinessChange) && (
        <PropertyGroup>
          <PropertyRow label={t('capex.metadata.itOwner')}>
            <Box sx={hideInnerLabelSx}>
              <UserSelect
                hideLabel
                value={ownerItId || null}
                onChange={(v) => onOwnerItChange?.(v ?? '')}
                disabled={disabled}
                placeholder={t('capex.metadata.itOwnerMissing')}
              />
            </Box>
          </PropertyRow>
          <PropertyRow label={t('capex.metadata.businessOwner')}>
            <Box sx={hideInnerLabelSx}>
              <UserSelect
                hideLabel
                value={ownerBusinessId || null}
                onChange={(v) => onOwnerBusinessChange?.(v ?? '')}
                disabled={disabled}
                placeholder={t('capex.metadata.businessOwnerMissing')}
              />
            </Box>
          </PropertyRow>
        </PropertyGroup>
      )}

      {mode === 'edit' && onStatusChange && onDisabledAtChange && (
        <PropertyGroup>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
            <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>{t('capex.fields.lifecycle')}</Typography>
            <StatusLifecycleField
              status={status}
              onStatusChange={onStatusChange}
              disabledAt={disabledAt}
              onDisabledAtChange={onDisabledAtChange}
              disabled={disabled}
              statusLabel={t('capex.status.enabled')}
              statusOffLabel={t('capex.status.disabled')}
              disabledAtLabel={t('capex.fields.endOfValidity')}
              disabledAtHelperText={t('capex.fields.endOfValidityHint')}
            />
          </Box>
        </PropertyGroup>
      )}

      {mode === 'edit' && (
        <PropertyGroup>
          <PropertyRow label={t('capex.fields.created')}>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(createdAt, locale, { empty: '-' })}</Typography>
          </PropertyRow>
          <PropertyRow label={t('capex.fields.updated')}>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(updatedAt, locale, { empty: '-' })}</Typography>
          </PropertyRow>
        </PropertyGroup>
      )}
    </>
  );
}
