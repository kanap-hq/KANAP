import React from 'react';
import { Autocomplete, Box, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PropertyGroup, PropertyRow } from '../../../components/design/PropertyRow';
import SupplierSelect from '../../../components/fields/SupplierSelect';
import CompanySelect from '../../../components/fields/CompanySelect';
import AccountSelect from '../../../components/fields/AccountSelect';
import AnalyticsCategorySelect from '../../../components/fields/AnalyticsCategorySelect';
import CostCenterSelect from '../../../components/fields/CostCenterSelect';
import DateEUField from '../../../components/fields/DateEUField';
import StatusLifecycleField from '../../../components/fields/StatusLifecycleField';
import UserSelect from '../../../components/fields/UserSelect';
import { CURRENCY_OPTIONS, CurrencyOption } from '../../../constants/isoOptions';
import useCurrencySettings from '../../../hooks/useCurrencySettings';
import { STATUS_ENABLED, StatusValue } from '../../../constants/status';
import { formatShortDate } from '../../../lib/dateFormat';
import { isoToLocalDateInput, localDateInputToEndOfDayIso } from '../../../lib/datetime';
import { useLocale } from '../../../i18n/useLocale';
import { useCostCenterTree } from '../../../hooks/useCostCenterTree';
import { drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';

export type RunBuild = 'run' | 'build';

type Props = {
  mode?: 'create' | 'edit';
  supplierId: string;
  payingCompanyId: string;
  accountId: string;
  currency: string;
  analyticsCategoryId: string;
  costCenterId: string;
  runBuild: RunBuild | '';
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
  onAnalyticsCategoryChange: (next: string) => void;
  onCostCenterChange: (next: string) => void;
  onRunBuildChange: (next: RunBuild | '') => void;
  onEffectiveStartChange: (next: string) => void;
  onStatusChange?: (next: StatusValue) => void;
  onDisabledAtChange?: (next: string | null) => void;
  onOwnerItChange?: (next: string) => void;
  onOwnerBusinessChange?: (next: string) => void;
};

// Hides the internal MUI label of complex field components so they render
// label-above-value inside PropertyRow per the design charter.
const hideInnerLabelSx = {
  '& .MuiInputLabel-root': { display: 'none' },
  '& .MuiFormControl-root': { m: 0 },
} as const;

export default function SpendPropertiesDrawer({
  mode = 'edit',
  supplierId,
  payingCompanyId,
  accountId,
  currency,
  analyticsCategoryId,
  costCenterId,
  runBuild,
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
  onAnalyticsCategoryChange,
  onCostCenterChange,
  onRunBuildChange,
  onEffectiveStartChange,
  onStatusChange,
  onDisabledAtChange,
  onOwnerItChange,
  onOwnerBusinessChange,
}: Props) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const { data: currencySettings } = useCurrencySettings();

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

  // A paying company other than the cost center's is kept; the hint only says so.
  const costCenterTree = useCostCenterTree();
  const costCenter = costCenterId ? costCenterTree.byId.get(costCenterId) : undefined;
  const costCenterHint = costCenter?.company_id && payingCompanyId && costCenter.company_id !== payingCompanyId
    ? t('opex.fields.costCenterCompanyHint', { company: costCenter.company_name ?? '' })
    : undefined;

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('opex.fields.supplier')}>
          <Box sx={hideInnerLabelSx}>
            <SupplierSelect value={supplierId} onChange={(v) => onSupplierChange(v ?? '')} disabled={disabled} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('opex.fields.costCenter')} helperText={costCenterHint}>
          <Box sx={hideInnerLabelSx}>
            <CostCenterSelect
              hideLabel
              selectable="cost_centers"
              value={costCenterId || null}
              onChange={(v) => onCostCenterChange(v ?? '')}
              disabled={disabled}
            />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('opex.fields.payingCompany')} required>
          <Box sx={hideInnerLabelSx}>
            <CompanySelect value={payingCompanyId || null} onChange={(v) => onPayingCompanyChange(v ?? '')} disabled={disabled} required disableClearable={mode === 'edit'} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('opex.fields.account')} required>
          <Box sx={hideInnerLabelSx}>
            <AccountSelect value={accountId} onChange={(v) => onAccountChange(v ?? '')} companyId={payingCompanyId || undefined} disabled={disabled || !payingCompanyId} required disableClearable={mode === 'edit'} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('opex.fields.currency')} required>
          <Autocomplete<CurrencyOption, false, true, false>
            options={currencyOptions}
            disableClearable
            value={currencyValue ?? undefined}
            onChange={(_e, option) => onCurrencyChange(option?.code ?? currency)}
            getOptionLabel={(option) => `${option.code} — ${option.name}`}
            isOptionEqualToValue={(option, value) => option.code === value.code}
            disabled={disabled}
            renderInput={(params) => (
              <TextField {...params} variant="standard" />
            )}
          />
        </PropertyRow>
        <PropertyRow label={t('opex.fields.analyticsCategory')}>
          <Box sx={hideInnerLabelSx}>
            <AnalyticsCategorySelect value={analyticsCategoryId || null} onChange={(v) => onAnalyticsCategoryChange(v ?? '')} disabled={disabled} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('opex.fields.runBuild')}>
          <TextField
            select
            variant="standard"
            value={runBuild}
            onChange={(e) => onRunBuildChange(e.target.value as RunBuild | '')}
            SelectProps={{ displayEmpty: true, inputProps: { 'aria-label': t('opex.fields.runBuild') } }}
            sx={drawerSelectSx}
            disabled={disabled}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{t('common:selects.notSet')}</MenuItem>
            <MenuItem value="run" sx={drawerMenuItemSx}>{t('opex.runBuild.run')}</MenuItem>
            <MenuItem value="build" sx={drawerMenuItemSx}>{t('opex.runBuild.build')}</MenuItem>
          </TextField>
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('opex.fields.effectiveStart')} required>
          <Box sx={hideInnerLabelSx}>
            <DateEUField label="" valueYmd={effectiveStart || ''} onChangeYmd={onEffectiveStartChange} disabled={disabled} required />
          </Box>
        </PropertyRow>
        {mode === 'create' && onDisabledAtChange && (
          <PropertyRow label={t('opex.fields.endOfValidity')} helperText={t('opex.fields.endOfValidityHint')}>
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
          <PropertyRow label={t('opex.metadata.itOwner')}>
            <Box sx={hideInnerLabelSx}>
              <UserSelect
                hideLabel
                value={ownerItId || null}
                onChange={(v) => onOwnerItChange?.(v ?? '')}
                disabled={disabled}
                placeholder={t('opex.metadata.itOwnerMissing')}
              />
            </Box>
          </PropertyRow>
          <PropertyRow label={t('opex.metadata.businessOwner')}>
            <Box sx={hideInnerLabelSx}>
              <UserSelect
                hideLabel
                value={ownerBusinessId || null}
                onChange={(v) => onOwnerBusinessChange?.(v ?? '')}
                disabled={disabled}
                placeholder={t('opex.metadata.businessOwnerMissing')}
              />
            </Box>
          </PropertyRow>
        </PropertyGroup>
      )}

      {mode === 'edit' && onStatusChange && onDisabledAtChange && (
        <PropertyGroup>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
            <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>{t('opex.fields.lifecycle')}</Typography>
            <StatusLifecycleField
              status={status}
              onStatusChange={onStatusChange}
              disabledAt={disabledAt}
              onDisabledAtChange={onDisabledAtChange}
              disabled={disabled}
              statusLabel={t('opex.status.enabled')}
              statusOffLabel={t('opex.status.disabled')}
              disabledAtLabel={t('opex.fields.endOfValidity')}
              disabledAtHelperText={t('opex.fields.endOfValidityHint')}
            />
          </Box>
        </PropertyGroup>
      )}

      {mode === 'edit' && (
        <PropertyGroup>
          <PropertyRow label={t('opex.fields.created')}>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(createdAt, locale, { empty: '—' })}</Typography>
          </PropertyRow>
          <PropertyRow label={t('opex.fields.updated')}>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(updatedAt, locale, { empty: '—' })}</Typography>
          </PropertyRow>
        </PropertyGroup>
      )}
    </>
  );
}
