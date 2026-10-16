import React from 'react';
import { Autocomplete, MenuItem, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PropertyGroup, PropertyRow } from '../../../components/design/PropertyRow';
import { drawerSelectSx, drawerMenuItemSx, drawerFieldValueSx } from '../../../theme/formSx';
import CompanySelect from '../../../components/fields/CompanySelect';
import type { CountryOption } from '../../../constants/isoOptions';
import { filterCountryOptions, useCountryOptions } from '../../../i18n/countries';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';

export type LocationDrawerData = {
  hosting_type: string;
  operating_company_id: string | null;
  provider: string | null;
  region: string | null;
  country_iso: string | null;
  city: string | null;
};

type Props = {
  data: LocationDrawerData;
  category: 'on_prem' | 'cloud';
  disabled?: boolean;
  onHostingTypeChange: (next: string) => void;
  onOperatingCompanyChange: (companyId: string | null) => void;
  onProviderChange: (next: string) => void;
  onRegionChange: (next: string) => void;
  onCountryChange: (iso: string) => void;
  onCityChange: (next: string) => void;
};

export default function LocationPropertiesDrawer({
  data,
  category,
  disabled = false,
  onHostingTypeChange,
  onOperatingCompanyChange,
  onProviderChange,
  onRegionChange,
  onCountryChange,
  onCityChange,
}: Props) {
  const { t } = useTranslation('it');
  const { byField } = useItOpsEnumOptions();
  const hostingOptions = byField.hostingType || [];
  const providerOptions = byField.serverProvider || [];

  const countryOptions = useCountryOptions();
  const countryValue: CountryOption | null =
    countryOptions.find((opt) => opt.code === (data.country_iso || '').toUpperCase()) ??
    (data.country_iso
      ? { code: data.country_iso.toUpperCase(), name: t('workspace.location.fields.unknownCountry', { code: data.country_iso.toUpperCase() }) }
      : null);

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('pages.locations.columns.hostingType')} required>
          <TextField
            select
            value={data.hosting_type || ''}
            onChange={(e) => onHostingTypeChange(e.target.value)}
            variant="standard"
            sx={drawerSelectSx}
            disabled={disabled}
          >
            {hostingOptions.map((opt) => (
              <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>
                {opt.deprecated ? t('common.deprecatedOption', { label: opt.label }) : opt.label}
              </MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        {category === 'on_prem' && (
          <PropertyRow label={t('workspace.asset.overview.operatingCompany')}>
            <CompanySelect
              value={data.operating_company_id}
              onChange={onOperatingCompanyChange}
              disabled={disabled}
              hideLabel
              label={t('workspace.asset.overview.operatingCompany')}
              textFieldSx={drawerFieldValueSx}
            />
          </PropertyRow>
        )}
        {category === 'cloud' && (
          <>
            <PropertyRow label={t('workspace.asset.overview.cloudProvider')}>
              <TextField
                select
                value={data.provider || ''}
                onChange={(e) => onProviderChange(e.target.value)}
                variant="standard"
                sx={drawerSelectSx}
                disabled={disabled}
              >
                <MenuItem value="" sx={drawerMenuItemSx}>—</MenuItem>
                {providerOptions.map((opt) => (
                  <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>
                    {opt.deprecated ? t('common.deprecatedOption', { label: opt.label }) : opt.label}
                  </MenuItem>
                ))}
              </TextField>
            </PropertyRow>
            <PropertyRow label={t('workspace.location.fields.region')}>
              <TextField
                value={data.region || ''}
                onChange={(e) => onRegionChange(e.target.value)}
                onBlur={(e) => onRegionChange(e.target.value)}
                variant="standard"
                sx={drawerFieldValueSx}
                placeholder={t('workspace.location.fields.regionPlaceholder')}
                disabled={disabled}
              />
            </PropertyRow>
          </>
        )}
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('pages.locations.columns.country')}>
          <Autocomplete
            value={countryValue}
            options={countryOptions}
            filterOptions={filterCountryOptions}
            disabled={disabled}
            onChange={(_, option) => onCountryChange(option?.code ?? '')}
            getOptionLabel={(opt) => `${opt.name} (${opt.code})`}
            isOptionEqualToValue={(a, b) => a.code === b.code}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="standard"
                sx={drawerFieldValueSx}
                placeholder={t('workspace.location.fields.searchCountries')}
              />
            )}
          />
        </PropertyRow>
        <PropertyRow label={t('pages.locations.columns.city')}>
          <TextField
            value={data.city || ''}
            onChange={(e) => onCityChange(e.target.value)}
            onBlur={(e) => onCityChange(e.target.value)}
            variant="standard"
            sx={drawerFieldValueSx}
            placeholder={t('workspace.location.fields.cityPlaceholder')}
            disabled={disabled}
          />
        </PropertyRow>
      </PropertyGroup>
    </>
  );
}
