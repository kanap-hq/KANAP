import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import React from 'react';
import { Box, MenuItem, Switch, TextField, Typography } from '@mui/material';
import { PropertyGroup, PropertyRow } from '../../../components/design/PropertyRow';
import { drawerSelectSx, drawerMenuItemSx } from '../../../theme/formSx';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { formatShortDate } from '../../../lib/dateFormat';
import { useLocale } from '../../../i18n/useLocale';
import { classificationText } from '../../../utils/applicationClassification';
import { useTranslation } from 'react-i18next';


type Props = {
  lifecycle: string;
  topology: 'server_to_server' | 'multi_server';
  topologyDisabled: boolean;
  riskMode: 'manual' | 'derived';
  criticality: string;
  dataClass: string;
  containsPii: boolean;
  effectiveCriticality: string;
  effectiveDataClass: string;
  effectiveContainsPii: boolean;
  derivedInterfaceCount: number;
  classificationIncomplete?: boolean;
  derivedAvailable: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  disabled?: boolean;
  onLifecycleChange: (next: string) => void;
  onTopologyChange: (next: 'server_to_server' | 'multi_server') => void;
  onRiskModeChange: (next: 'manual' | 'derived') => void;
  onCriticalityChange: (next: string) => void;
  onDataClassChange: (next: string) => void;
  onContainsPiiChange: (next: boolean) => void;
};

export default function ConnectionPropertiesDrawer({
  lifecycle,
  topology,
  topologyDisabled,
  riskMode,
  criticality,
  dataClass,
  containsPii,
  effectiveCriticality,
  effectiveDataClass,
  effectiveContainsPii,
  derivedInterfaceCount,
  classificationIncomplete = false,
  derivedAvailable,
  createdAt,
  updatedAt,
  disabled = false,
  onLifecycleChange,
  onTopologyChange,
  onRiskModeChange,
  onCriticalityChange,
  onDataClassChange,
  onContainsPiiChange,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const CRITICALITIES = [{ code: '', label: classificationText('Not set') }, ...(classificationCatalog?.businessCriticalityLevels || [])];
  const { byField } = useItOpsEnumOptions();
  const locale = useLocale();
  const lifecycleOptions = byField.lifecycleStatus || [];
  const dataClassOptions = classificationCatalog?.dataClasses || [];

  const isDerived = riskMode === 'derived';

  return (
    <>
      <PropertyGroup>
        <PropertyRow label={t('it:common.lifecycle')}>
          <TextField
            select
            value={lifecycle || ''}
            onChange={(e) => onLifecycleChange(e.target.value)}
            variant="standard"
            sx={drawerSelectSx}
            disabled={disabled}
          >
            {lifecycleOptions.map((opt) => (
              <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>
                {opt.deprecated ? `${opt.label} (deprecated)` : opt.label}
              </MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        <PropertyRow label={t('it:workspace.asset.connections.topology')}>
          <TextField
            select
            value={topology}
            onChange={(e) => onTopologyChange(e.target.value as 'server_to_server' | 'multi_server')}
            variant="standard"
            sx={drawerSelectSx}
            disabled={disabled || topologyDisabled}
            helperText={topologyDisabled ? t('it:workspace.connection.properties.removeHops') : undefined}
            FormHelperTextProps={{ sx: { fontSize: 11, mt: 0.5 } }}
          >
            <MenuItem value="server_to_server" sx={drawerMenuItemSx}>{t('it:enums.topology.serverToServer')}</MenuItem>
            <MenuItem value="multi_server" sx={drawerMenuItemSx}>{t('it:enums.topology.multiServer')}</MenuItem>
          </TextField>
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('it:workspace.connection.compliance.riskMode')}>
          <TextField
            select
            value={riskMode}
            onChange={(e) => {
              const next = e.target.value as 'manual' | 'derived';
              if (next === 'derived' && !derivedAvailable) return;
              onRiskModeChange(next);
            }}
            variant="standard"
            sx={drawerSelectSx}
            disabled={disabled}
          >
            <MenuItem value="manual" sx={drawerMenuItemSx}>{t('it:enums.riskMode.manual')}</MenuItem>
            <MenuItem
              value="derived"
              disabled={!derivedAvailable && riskMode !== 'derived'}
              sx={drawerMenuItemSx}
            >
              {t('it:workspace.connection.properties.derivedFromInterfaces')}
            </MenuItem>
          </TextField>
          {!derivedAvailable && riskMode === 'manual' && (
            <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mt: 0.25 }}>
              {t('it:workspace.connection.properties.linkToDerive')}
            </Typography>
          )}
        </PropertyRow>
        <PropertyRow label={t('it:workspace.connection.compliance.criticality')}>
          {isDerived ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 13, color: 'kanap.text.primary' }}>
              {CRITICALITIES.find((c) => c.code === effectiveCriticality)?.label || effectiveCriticality}
              <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
                {t('it:workspace.connection.metadata.derivedFrom', { count: derivedInterfaceCount })}
              </Typography>
              {classificationIncomplete && (
                <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
                  ({classificationText('Incomplete inheritance')})
                </Typography>
              )}
            </Box>
          ) : (
            <TextField
              select
              value={criticality}
              onChange={(e) => onCriticalityChange(e.target.value)}
              variant="standard"
              sx={drawerSelectSx}
              disabled={disabled}
            >
              {CRITICALITIES.map((opt) => (
                <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>{opt.label}</MenuItem>
              ))}
            </TextField>
          )}
        </PropertyRow>
        <PropertyRow label={t('it:workspace.connection.compliance.dataClass')}>
          {isDerived ? (
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
              {classificationCatalog?.dataClasses.find((item) => item.code === effectiveDataClass)?.label || effectiveDataClass || classificationText('Not set')}
            </Typography>
          ) : (
            <TextField
              select
              value={dataClass || ''}
              onChange={(e) => onDataClassChange(e.target.value)}
              variant="standard"
              sx={drawerSelectSx}
              disabled={disabled}
            >
              {dataClassOptions.map((opt) => (
                <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>{opt.label}</MenuItem>
              ))}
            </TextField>
          )}
        </PropertyRow>
        <PropertyRow label={t('it:workspace.connection.compliance.containsPii')}>
          {isDerived ? (
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
              {effectiveContainsPii ? 'Yes' : 'No'}
            </Typography>
          ) : (
            <Switch
              size="small"
              checked={containsPii}
              onChange={(e) => onContainsPiiChange(e.target.checked)}
              disabled={disabled}
            />
          )}
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('it:workspace.connection.properties.created')}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(createdAt, locale, { empty: classificationText('Not set') })}</Typography>
        </PropertyRow>
        <PropertyRow label={t('it:workspace.connection.properties.updated')}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{formatShortDate(updatedAt, locale, { empty: classificationText('Not set') })}</Typography>
        </PropertyRow>
      </PropertyGroup>
    </>
  );
}
