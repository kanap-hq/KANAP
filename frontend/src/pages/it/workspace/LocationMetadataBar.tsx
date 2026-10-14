import React from 'react';
import { Box, MenuItem, Menu, Popover, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../../api';
import { useCountryOptions } from '../../../i18n/countries';
import {
  PortfolioMetadataItem,
} from '../../portfolio/workspace/PortfolioMetadataBar';
import { drawerMenuItemSx, drawerFieldValueSx, drawerSelectSx } from '../../../theme/formSx';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';

type Props = {
  hostingType: string;
  category: 'on_prem' | 'cloud';
  operatingCompanyId: string | null;
  operatingCompanyName: string | null;
  provider: string | null;
  region: string | null;
  countryIso: string | null;
  city: string | null;
  subLocationsCount: number;
  disabled?: boolean;
  onHostingTypeChange: (next: string) => void;
  onOperatingCompanyChange: (companyId: string | null) => void;
  onProviderChange: (next: string) => void;
  onRegionChange: (next: string) => void;
  onCountryChange: (iso: string) => void;
  onCityChange: (next: string) => void;
  onSubLocationsClick?: () => void;
};

type CompanyOption = { id: string; name: string };

function countryFlag(iso: string | null): string {
  if (!iso || iso.length !== 2) return '';
  const codePoints = iso
    .toUpperCase()
    .split('')
    .map((c) => 0x1f1e6 - 65 + c.charCodeAt(0));
  try {
    return String.fromCodePoint(...codePoints);
  } catch {
    return '';
  }
}

export default function LocationMetadataBar({
  hostingType,
  category,
  operatingCompanyId,
  operatingCompanyName,
  provider,
  region,
  countryIso,
  city,
  subLocationsCount,
  disabled = false,
  onHostingTypeChange,
  onOperatingCompanyChange,
  onProviderChange,
  onRegionChange,
  onCountryChange,
  onCityChange,
  onSubLocationsClick,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const countryOptions = useCountryOptions();
  const { byField, labelFor } = useItOpsEnumOptions();
  const hostingOptions = byField.hostingType || [];
  const providerOptions = byField.serverProvider || [];

  const [hostingAnchor, setHostingAnchor] = React.useState<HTMLElement | null>(null);
  const [geoAnchor, setGeoAnchor] = React.useState<HTMLElement | null>(null);
  const [companyAnchor, setCompanyAnchor] = React.useState<HTMLElement | null>(null);
  const [providerAnchor, setProviderAnchor] = React.useState<HTMLElement | null>(null);

  const hostingLabel = labelFor('hostingType', hostingType) || hostingType || t('workspace.location.meta.setHostingType');

  const geoLabel = (() => {
    const flag = countryFlag(countryIso);
    const cc = countryIso ? countryIso.toUpperCase() : '';
    const parts: string[] = [];
    if (flag) parts.push(flag);
    if (cc) parts.push(cc);
    if (city) parts.push(`· ${city}`);
    return parts.length > 0 ? parts.join(' ') : t('workspace.location.meta.locationMissing');
  })();

  const companyLabel = operatingCompanyName || t('workspace.location.meta.operatingCompanyMissing');
  const providerLabel = (() => {
    const provDisplay = provider ? labelFor('serverProvider', provider) || provider : null;
    if (provDisplay && region) return `${provDisplay} · ${region}`;
    return provDisplay || region || t('workspace.location.meta.cloudProviderMissing');
  })();

  const { data: companies = [] } = useQuery({
    queryKey: ['companies', 'options'],
    queryFn: async () => {
      const res = await api.get<{ items: CompanyOption[] }>('/companies', { params: { limit: 1000 } });
      return (res.data?.items || []) as CompanyOption[];
    },
    enabled: category === 'on_prem',
  });

  const sortedCompanies = React.useMemo(() => {
    return [...companies].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
  }, [companies]);

  return (
    <>
      <PortfolioMetadataItem
        onClick={(event) => setHostingAnchor(event.currentTarget)}
        disabled={disabled}
        title={t('workspace.location.meta.editHostingType')}
      >
        {hostingLabel}
      </PortfolioMetadataItem>
      <Menu
        anchorEl={hostingAnchor}
        open={!!hostingAnchor}
        onClose={() => setHostingAnchor(null)}
      >
        {hostingOptions
          .filter((opt) => !opt.deprecated || opt.code === hostingType)
          .map((opt) => (
            <MenuItem
              key={opt.code}
              selected={opt.code === hostingType}
              onClick={() => {
                onHostingTypeChange(opt.code);
                setHostingAnchor(null);
              }}
              sx={drawerMenuItemSx}
            >
              {opt.label}
            </MenuItem>
          ))}
      </Menu>

      <PortfolioMetadataItem
        onClick={(event) => setGeoAnchor(event.currentTarget)}
        disabled={disabled}
        title={t('workspace.location.meta.editCountryCity')}
      >
        {geoLabel}
      </PortfolioMetadataItem>
      <Popover
        anchorEl={geoAnchor}
        open={!!geoAnchor}
        onClose={() => setGeoAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, minWidth: 280 } } }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TextField
            select
            label={t('pages.locations.columns.country')}
            value={(countryIso || '').toUpperCase()}
            onChange={(e) => onCountryChange(e.target.value)}
            size="small"
            variant="standard"
            sx={drawerSelectSx}
            SelectProps={{
              MenuProps: { PaperProps: { sx: { maxHeight: 280 } } },
            }}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>—</MenuItem>
            {countryOptions.map((opt) => (
              <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>
                {opt.name} ({opt.code})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('pages.locations.columns.city')}
            value={city || ''}
            onChange={(e) => onCityChange(e.target.value)}
            onBlur={(e) => onCityChange(e.target.value)}
            size="small"
            variant="standard"
            placeholder={t('workspace.location.fields.cityPlaceholder')}
            sx={drawerFieldValueSx}
          />
        </Box>
      </Popover>

      {category === 'on_prem' && (
        <>
          <PortfolioMetadataItem
            label={t('workspace.location.meta.company')}
            onClick={(event) => setCompanyAnchor(event.currentTarget)}
            disabled={disabled}
            title={t('workspace.location.meta.editOperatingCompany')}
          >
            {companyLabel}
          </PortfolioMetadataItem>
          <Menu
            anchorEl={companyAnchor}
            open={!!companyAnchor}
            onClose={() => setCompanyAnchor(null)}
            slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 240 } } }}
          >
            {sortedCompanies.length === 0 && (
              <MenuItem disabled sx={drawerMenuItemSx}>
                {t('workspace.location.meta.noCompanies')}
              </MenuItem>
            )}
            {operatingCompanyId && (
              <MenuItem
                onClick={() => {
                  onOperatingCompanyChange(null);
                  setCompanyAnchor(null);
                }}
                sx={drawerMenuItemSx}
              >
                — {t('common:buttons.clear')} —
              </MenuItem>
            )}
            {sortedCompanies.map((option) => (
              <MenuItem
                key={option.id}
                selected={option.id === operatingCompanyId}
                onClick={() => {
                  onOperatingCompanyChange(option.id);
                  setCompanyAnchor(null);
                }}
                sx={drawerMenuItemSx}
              >
                {option.name}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}

      {category === 'cloud' && (
        <>
          <PortfolioMetadataItem
            label={t('workspace.location.meta.cloud')}
            onClick={(event) => setProviderAnchor(event.currentTarget)}
            disabled={disabled}
            title={t('workspace.location.meta.editProviderRegion')}
          >
            {providerLabel}
          </PortfolioMetadataItem>
          <Popover
            anchorEl={providerAnchor}
            open={!!providerAnchor}
            onClose={() => setProviderAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ paper: { sx: { p: 1.5, minWidth: 280 } } }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <TextField
                select
                label={t('workspace.asset.overview.cloudProvider')}
                value={provider || ''}
                onChange={(e) => onProviderChange(e.target.value)}
                size="small"
                variant="standard"
                sx={drawerSelectSx}
              >
                <MenuItem value="" sx={drawerMenuItemSx}>—</MenuItem>
                {providerOptions.map((opt) => (
                  <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>
                    {opt.deprecated ? t('common.deprecatedOption', { label: opt.label }) : opt.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label={t('workspace.location.fields.region')}
                value={region || ''}
                onChange={(e) => onRegionChange(e.target.value)}
                onBlur={(e) => onRegionChange(e.target.value)}
                size="small"
                variant="standard"
                placeholder={t('workspace.location.fields.regionPlaceholder')}
                sx={drawerFieldValueSx}
              />
            </Box>
          </Popover>
        </>
      )}

      {subLocationsCount > 0 && (
        <PortfolioMetadataItem
          onClick={onSubLocationsClick}
          title={t('workspace.location.meta.jumpToSubLocations')}
        >
          {t('workspace.location.meta.subLocationCount', { count: subLocationsCount })}
        </PortfolioMetadataItem>
      )}
    </>
  );
}
