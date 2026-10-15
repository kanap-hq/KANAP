import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Autocomplete,
  Box,
  CircularProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../../../api';
import ApplicationSelect from '../../../components/fields/ApplicationSelect';
import { PropertyRow } from '../../../components/design';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import type {
  ApplicationOption,
  InterfaceDetail,
  InterfaceLeg,
} from '../components/interface-workspace/types';

type Props = {
  canManage: boolean;
  data: InterfaceDetail | null;
  onPatch: (patch: Partial<InterfaceDetail>) => Promise<void>;
  onReplaceLegs: (legs: InterfaceLeg[]) => Promise<void>;
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      component="h2"
      sx={(theme) => ({
        m: 0,
        mb: 1,
        fontSize: 14,
        fontWeight: 500,
        color: theme.palette.kanap.text.primary,
      })}
    >
      {children}
    </Typography>
  );
}

const compactMiddlewareAutocompleteSx = {
  '& .MuiAutocomplete-inputRoot': {
    flexWrap: 'nowrap',
    rowGap: 0,
    overflow: 'hidden',
  },
  '& .MuiAutocomplete-tag': {
    maxWidth: 300,
    height: 22,
    m: '0 3px 0 0',
  },
  '& .MuiAutocomplete-tag ~ .MuiAutocomplete-input': {
    flexBasis: 'auto !important',
    width: 'auto !important',
    minWidth: '40px !important',
  },
} as const;

export default function InterfaceFlowTab({
  canManage,
  data,
  onPatch,
  onReplaceLegs,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { byField } = useItOpsEnumOptions();
  const disabled = !canManage;
  const legs = React.useMemo(() => (data?.legs || []) as InterfaceLeg[], [data?.legs]);

  const { data: etlAppsData, isLoading: loadingEtlApps } = useQuery({
    queryKey: ['applications', 'select', 'etl-middleware'],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 500, sort: 'name:ASC' };
      params.filters = JSON.stringify({ etl_enabled: { type: 'equals', filter: true } });
      const res = await api.get<{ items: ApplicationOption[] }>('/applications', { params });
      return res.data.items || [];
    },
  });

  const etlApps = React.useMemo(() => (etlAppsData || []) as ApplicationOption[], [etlAppsData]);

  const triggerTypeOptions = React.useMemo(() => {
    const list = byField.interfaceTriggerType || [];
    const base = list.filter((item) => !item.deprecated).map((item) => ({ label: item.label, value: item.code }));
    const usedCodes = new Set<string>(legs.map((leg) => leg.trigger_type).filter(Boolean) as string[]);
    const existing = new Set(base.map((item) => item.value));
    const extras: Array<{ label: string; value: string }> = [];
    for (const code of usedCodes) {
      if (!existing.has(code)) {
        const ref = list.find((item) => item.code === code);
        extras.push({ label: ref?.label || code, value: code });
      }
    }
    return [...base, ...extras];
  }, [byField.interfaceTriggerType, legs]);

  const patternOptions = React.useMemo(() => {
    const list = byField.interfacePattern || [];
    const base = list.filter((item) => !item.deprecated).map((item) => ({ label: item.label, value: item.code }));
    const usedCodes = new Set<string>(legs.map((leg) => leg.integration_pattern).filter(Boolean) as string[]);
    const existing = new Set(base.map((item) => item.value));
    const extras: Array<{ label: string; value: string }> = [];
    for (const code of usedCodes) {
      if (!existing.has(code)) {
        const ref = list.find((item) => item.code === code);
        extras.push({ label: ref?.label || code, value: code });
      }
    }
    return [...base, ...extras];
  }, [byField.interfacePattern, legs]);

  const formatOptions = React.useMemo(() => {
    const list = byField.interfaceFormat || [];
    const base = list.filter((item) => !item.deprecated).map((item) => ({ label: item.label, value: item.code }));
    const usedCodes = new Set<string>(legs.map((leg) => leg.data_format).filter(Boolean) as string[]);
    const existing = new Set(base.map((item) => item.value));
    const extras: Array<{ label: string; value: string }> = [];
    for (const code of usedCodes) {
      if (!existing.has(code)) {
        const ref = list.find((item) => item.code === code);
        extras.push({ label: ref?.label || code, value: code });
      }
    }
    return [...base, ...extras];
  }, [byField.interfaceFormat, legs]);

  const routeOptions = React.useMemo(() => [
    { label: t('it:enums.routeType.direct'), value: 'direct' },
    { label: t('it:enums.routeType.viaMiddleware'), value: 'via_middleware' },
  ], [t]);

  const getRoleLabel = (role: string) => {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'source') return data?.source_application_name || t('it:workspace.interface.flow.source');
    if (normalized === 'target') return data?.target_application_name || t('it:workspace.interface.flow.target');
    if (normalized === 'middleware') return t('it:workspace.interface.flow.middleware');
    return role || '';
  };

  const handleLegChange = (legId: string, patch: Partial<InterfaceLeg>) => {
    const next = legs.map((leg) => (leg.id === legId ? { ...leg, ...patch } : leg));
    void onReplaceLegs(next);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box sx={{ maxWidth: 820 }}>
        <SectionHeader>{t('it:workspace.interface.flow.logicalFlow')}</SectionHeader>
        <Stack spacing={1.25}>
          <PropertyRow label={t('it:workspace.interface.fields.sourceApplication')} required valueSx={{ maxWidth: 560 }}>
            <ApplicationSelect
              value={data?.source_application_id || null}
              onChange={(value) => void onPatch({ source_application_id: value || '' })}
              hideLabel
              textFieldSx={drawerFieldValueSx}
              placeholder={t('it:workspace.interface.fields.selectSource')}
              disabled={disabled}
            />
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.fields.targetApplication')} required valueSx={{ maxWidth: 560 }}>
            <ApplicationSelect
              value={data?.target_application_id || null}
              onChange={(value) => void onPatch({ target_application_id: value || '' })}
              hideLabel
              textFieldSx={drawerFieldValueSx}
              placeholder={t('it:workspace.interface.fields.selectTarget')}
              disabled={disabled}
            />
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.fields.routeType')} valueSx={{ maxWidth: 280 }}>
            <TextField
              select
              value={data?.integration_route_type || 'direct'}
              onChange={(event) => {
                const value = event.target.value as 'direct' | 'via_middleware';
                void onPatch({
                  integration_route_type: value,
                  ...(value === 'direct' ? { middleware_application_ids: [] } : {}),
                });
              }}
              variant="standard"
              sx={drawerSelectSx}
              disabled={disabled}
            >
              {routeOptions.map((option) => (
                <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </PropertyRow>
          {data?.integration_route_type === 'via_middleware' && (
            <PropertyRow label={t('it:workspace.interface.fields.middlewareApplications')} valueSx={{ maxWidth: 560 }}>
              <Autocomplete
                multiple
                size="small"
                limitTags={1}
                options={etlApps}
                value={etlApps.filter((app) => (data?.middleware_application_ids || []).includes(app.id))}
                onChange={(_, value) => {
                  void onPatch({ middleware_application_ids: value.map((item) => item.id) });
                }}
                getOptionLabel={(option) => option.name}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    variant="standard"
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loadingEtlApps ? <CircularProgress color="inherit" size={18} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                    sx={[drawerFieldValueSx, compactMiddlewareAutocompleteSx]}
                    placeholder={t('it:workspace.interface.fields.addMiddleware')}
                  />
                )}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                fullWidth
                disabled={disabled}
              />
            </PropertyRow>
          )}
        </Stack>
      </Box>

      <Box>
        <SectionHeader>{t('it:workspace.interface.flow.legTemplate')}</SectionHeader>
        {legs.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
            {t('it:workspace.interface.flow.noLegs')}
          </Typography>
        ) : (
          <Table size="small" sx={{ maxWidth: 1100 }}>
            <TableHead>
              <TableRow>
                <TableCell>{t('it:workspace.interface.flow.leg')}</TableCell>
                <TableCell>{t('it:workspace.interface.flow.fromTo')}</TableCell>
                <TableCell>{t('it:workspace.interface.flow.triggerType')}</TableCell>
                <TableCell>{t('it:workspace.interface.flow.pattern')}</TableCell>
                <TableCell>{t('it:workspace.interface.flow.format')}</TableCell>
                <TableCell>{t('it:workspace.interface.flow.jobName')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {legs.map((leg) => (
                <TableRow key={leg.id}>
                  <TableCell sx={{ fontWeight: 500 }}>
                    {String(leg.leg_type || '').toUpperCase()}
                  </TableCell>
                  <TableCell>
                    {getRoleLabel(leg.from_role)} / {getRoleLabel(leg.to_role)}
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      value={leg.trigger_type || ''}
                      onChange={(event) => handleLegChange(leg.id, { trigger_type: event.target.value })}
                      variant="standard"
                      sx={drawerSelectSx}
                      disabled={disabled}
                    >
                      {triggerTypeOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      value={leg.integration_pattern || ''}
                      onChange={(event) => handleLegChange(leg.id, { integration_pattern: event.target.value })}
                      variant="standard"
                      sx={drawerSelectSx}
                      disabled={disabled}
                    >
                      {patternOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      value={leg.data_format || ''}
                      onChange={(event) => handleLegChange(leg.id, { data_format: event.target.value })}
                      variant="standard"
                      sx={drawerSelectSx}
                      disabled={disabled}
                    >
                      {formatOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField
                      key={`${leg.id}:${leg.job_name || ''}`}
                      defaultValue={leg.job_name || ''}
                      onBlur={(event) => handleLegChange(leg.id, { job_name: event.target.value || null })}
                      variant="standard"
                      sx={drawerFieldValueSx}
                      placeholder={t('it:workspace.interface.flow.optional')}
                      disabled={disabled}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>
    </Box>
  );
}
