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
import { useCostCenterNode } from '../../../hooks/useCostCenterTree';
import type { CostCenterNode } from '../../../services/costCenters';
import { axisRequiredFor, useAnalyticsAxes } from '../../../hooks/useAnalyticsAxes';
import { drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import { matching, type ItemReferences } from '../../../components/finance/itemReferences';

export type RunBuild = 'run' | 'build';

type Props = {
  mode?: 'create' | 'edit';
  supplierId: string;
  payingCompanyId: string;
  accountId: string;
  currency: string;
  /** The line's value per dimension id; a dimension without a value is absent or null. */
  analyticsValues: Record<string, string | null>;
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
  onAnalyticsValueChange: (axisId: string, next: string | null) => void;
  /** `node`: the picked node (from the tree the picker loaded), null when cleared. */
  onCostCenterChange: (next: string, node: CostCenterNode | null) => void;
  onRunBuildChange: (next: RunBuild | '') => void;
  onEffectiveStartChange: (next: string) => void;
  onDisabledAtChange?: (next: string | null) => void;
  onOwnerItChange?: (next: string) => void;
  onOwnerBusinessChange?: (next: string) => void;
  /** Labels of the chosen supplier, company and account from the detail: the pickers show them without a request. */
  references?: Partial<ItemReferences>;
  /** The chosen value's label per dimension id, from the detail. */
  analyticsOptions?: Record<string, { id: string; name: string }>;
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
  analyticsValues,
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
  references,
  analyticsOptions,
  onSupplierChange,
  onPayingCompanyChange,
  onAccountChange,
  onCurrencyChange,
  onAnalyticsValueChange,
  onCostCenterChange,
  onRunBuildChange,
  onEffectiveStartChange,
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
  const costCenter = useCostCenterNode(costCenterId || null, references?.cost_center);
  const costCenterHint = costCenter?.company_id && payingCompanyId && costCenter.company_id !== payingCompanyId
    ? t('opex.fields.costCenterCompanyHint', { company: costCenter.company_name ?? '' })
    : undefined;

  // One select per enabled dimension that applies to OPEX lines, in dimension order. A disabled
  // dimension, or one for CAPEX lines only, shows no select; its value stays on the line. When the
  // dimensions cannot be loaded, one line says so.
  const analyticsAxes = useAnalyticsAxes({ scope: 'opex' });

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('opex.fields.supplier')}>
          <Box sx={hideInnerLabelSx}>
            <SupplierSelect hideLabel label={t('opex.fields.supplier')} value={supplierId} onChange={(v) => onSupplierChange(v ?? '')} disabled={disabled} selectedOption={matching(references?.supplier, supplierId)} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('opex.fields.costCenter')} helperText={costCenterHint}>
          <Box sx={hideInnerLabelSx}>
            <CostCenterSelect
              hideLabel
              label={t('opex.fields.costCenter')}
              selectable="cost_centers"
              value={costCenterId || null}
              selectedOption={matching(references?.cost_center, costCenterId)}
              onChange={(v, node) => onCostCenterChange(v ?? '', node)}
              disabled={disabled}
            />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('opex.fields.payingCompany')} required>
          <Box sx={hideInnerLabelSx}>
            <CompanySelect hideLabel label={t('opex.fields.payingCompany')} value={payingCompanyId || null} onChange={(v) => onPayingCompanyChange(v ?? '')} disabled={disabled} required disableClearable={mode === 'edit'} selectedOption={matching(references?.paying_company, payingCompanyId)} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('opex.fields.account')} required>
          <Box sx={hideInnerLabelSx}>
            <AccountSelect hideLabel label={t('opex.fields.account')} nature="opex" value={accountId} onChange={(v) => onAccountChange(v ?? '')} companyId={payingCompanyId || undefined} disabled={disabled || !payingCompanyId} required disableClearable={mode === 'edit'} selectedOption={matching(references?.account, accountId)} />
          </Box>
        </PropertyRow>
        <PropertyRow label={t('opex.fields.currency')} required>
          <Autocomplete<CurrencyOption, false, true, false>
            options={currencyOptions}
            disableClearable
            value={currencyValue ?? undefined}
            onChange={(_e, option) => onCurrencyChange(option?.code ?? currency)}
            getOptionLabel={(option) => `${option.code} · ${option.name}`}
            isOptionEqualToValue={(option, value) => option.code === value.code}
            disabled={disabled}
            renderInput={(params) => (
              <TextField {...params} variant="standard" />
            )}
          />
        </PropertyRow>
        {analyticsAxes.isError && analyticsAxes.axes.length === 0 ? (
          <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.tertiary', py: '5px' }}>
            {t('shared.dimensionsLoadFailed')}
          </Typography>
        ) : analyticsAxes.enabled.map((axis) => (
          <PropertyRow key={axis.id} label={analyticsAxes.label(axis)} required={axisRequiredFor(axis, 'opex')}>
            <Box sx={hideInnerLabelSx}>
              <AnalyticsCategorySelect
                axisId={axis.id}
                label={analyticsAxes.label(axis)}
                hideLabel
                lineType="opex"
                value={analyticsValues[axis.id] ?? null}
                onChange={(v) => onAnalyticsValueChange(axis.id, v)}
                disabled={disabled}
                // A held value on a required dimension can be replaced, not removed. A line without one stays editable.
                disableClearable={mode === 'edit' && axisRequiredFor(axis, 'opex') && !!analyticsValues[axis.id]}
                selectedOption={matching(analyticsOptions?.[axis.id], analyticsValues[axis.id])}
              />
            </Box>
          </PropertyRow>
        ))}
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

      {mode === 'edit' && onDisabledAtChange && (
        <PropertyGroup>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
            <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>{t('opex.fields.lifecycle')}</Typography>
            <StatusLifecycleField
              status={status}
              // The date handler derives and saves the status; a second write here would race it.
              onStatusChange={() => undefined}
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
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(createdAt, locale, { empty: '-' })}</Typography>
          </PropertyRow>
          <PropertyRow label={t('opex.fields.updated')}>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(updatedAt, locale, { empty: '-' })}</Typography>
          </PropertyRow>
        </PropertyGroup>
      )}
    </>
  );
}
