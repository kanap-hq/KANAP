import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import React from 'react';
import { Box, Checkbox, ListItemText, MenuItem, Popover, Typography } from '@mui/material';
import { PortfolioMetadataItem } from '../../portfolio/workspace/PortfolioMetadataBar';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { drawerMenuItemSx } from '../../../theme/formSx';
import { StatusDot } from '../../../components/design';
import { classificationText } from '../../../utils/applicationClassification';
import { useTranslation } from 'react-i18next';

type Props = {
  lifecycle: string;
  topology: 'server_to_server' | 'multi_server';
  criticality: string;
  effectiveCriticality: string;
  riskMode: 'manual' | 'derived';
  derivedInterfaceCount: number;
  classificationIncomplete?: boolean;
  protocolCodes: string[] | undefined;
  protocolLabels: string[] | undefined;
  topologyDisabled?: boolean;
  disabled?: boolean;
  endpointsLabel: string;
  onEndpointsClick?: (anchor: HTMLElement) => void;
  onLifecycleChange: (next: string) => void;
  onTopologyChange: (next: 'server_to_server' | 'multi_server') => void;
  onCriticalityChange: (next: string) => void;
  onProtocolCodesChange: (next: string[]) => void;
};


export default function ConnectionMetadataBar({
  lifecycle,
  topology,
  criticality,
  effectiveCriticality,
  riskMode,
  derivedInterfaceCount,
  classificationIncomplete = false,
  protocolCodes,
  protocolLabels,
  topologyDisabled = false,
  disabled = false,
  endpointsLabel,
  onLifecycleChange,
  onTopologyChange,
  onCriticalityChange,
  onProtocolCodesChange,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const CRITICALITIES = [{ code: '', label: classificationText('Not set') }, ...(classificationCatalog?.businessCriticalityLevels || [])];
  const { byField, labelFor, settings } = useItOpsEnumOptions();
  const lifecycleOptions = byField.lifecycleStatus || [];
  const connectionTypes = settings?.connectionTypes || [];

  const safeProtocolCodes = protocolCodes || [];
  const safeProtocolLabels = protocolLabels && protocolLabels.length > 0 ? protocolLabels : safeProtocolCodes;

  const [lifecycleAnchor, setLifecycleAnchor] = React.useState<HTMLElement | null>(null);
  const [topologyAnchor, setTopologyAnchor] = React.useState<HTMLElement | null>(null);
  const [criticalityAnchor, setCriticalityAnchor] = React.useState<HTMLElement | null>(null);
  const [protocolsAnchor, setProtocolsAnchor] = React.useState<HTMLElement | null>(null);

  const lifecycleLabel = labelFor('lifecycleStatus', lifecycle) || lifecycle || t('it:workspace.connection.metadata.lifecycleMissing');
  const topologyLabel = topology === 'server_to_server' ? t('it:enums.topology.serverToServer') : t('it:enums.topology.multiServer');
  const effectiveCritLabel =
    CRITICALITIES.find((c) => c.code === effectiveCriticality)?.label
      || effectiveCriticality
      || t('it:workspace.connection.metadata.criticalityMissing');
  const protocolsSummary = (() => {
    if (safeProtocolLabels.length === 0) return t('it:workspace.connection.metadata.protocolsMissing');
    const visible = safeProtocolLabels.slice(0, 2).join(', ');
    const extra = safeProtocolLabels.length > 2 ? ` +${safeProtocolLabels.length - 2}` : '';
    return `${visible}${extra}`;
  })();

  const lifecycleColor = (() => {
    switch (lifecycle) {
      case 'active': return '#10B981';
      case 'planned': return '#9CA3AF';
      case 'deprecated': return '#E8920F';
      case 'retired': return '#9CA3AF';
      default: return '#9CA3AF';
    }
  })();
  const criticalityColor = (() => {
    switch (effectiveCriticality) {
      case 'business_critical': return '#E8920F';
      case 'high': return '#F0A830';
      case 'medium': return '#9CA3AF';
      case 'low': return '#6B7280';
      default: return '#9CA3AF';
    }
  })();

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.75, alignItems: 'center' }}>
      <PortfolioMetadataItem
        onClick={(e) => !disabled && setLifecycleAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled}
      >
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>{t('it:common.lifecycle')}</Typography>
        <StatusDot size={8} color={lifecycleColor} sx={{ mr: 0.75 }} />
        <Typography component="span" sx={{ fontSize: 12 }}>{lifecycleLabel}</Typography>
      </PortfolioMetadataItem>

      <PortfolioMetadataItem
        onClick={(e) => !topologyDisabled && !disabled && setTopologyAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled || topologyDisabled}
      >
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>{t('it:workspace.asset.connections.topology')}</Typography>
        <Typography component="span" sx={{ fontSize: 12 }}>{topologyLabel}</Typography>
      </PortfolioMetadataItem>

      <PortfolioMetadataItem
        onClick={(e) => riskMode === 'manual' && !disabled && setCriticalityAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled || riskMode === 'derived'}
      >
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>{t('it:workspace.connection.compliance.criticality')}</Typography>
        <StatusDot size={8} color={criticalityColor} sx={{ mr: 0.75 }} />
        <Typography component="span" sx={{ fontSize: 12 }}>{effectiveCritLabel}</Typography>
        {riskMode === 'derived' && (
          <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', ml: 0.5 }}>
            {t('it:workspace.connection.metadata.derivedFrom', { count: derivedInterfaceCount })}
          </Typography>
        )}
        {classificationIncomplete && (
          <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', ml: 0.5 }}>
            ({classificationText('Incomplete inheritance')})
          </Typography>
        )}
      </PortfolioMetadataItem>

      <PortfolioMetadataItem disabled>
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>{t('it:workspace.connection.create.endpoints')}</Typography>
        <Typography component="span" sx={{ fontSize: 12 }}>{endpointsLabel}</Typography>
      </PortfolioMetadataItem>

      <PortfolioMetadataItem
        onClick={(e) => !disabled && setProtocolsAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled}
      >
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>{t('it:workspace.connection.overview.protocols')}</Typography>
        <Typography component="span" sx={{ fontSize: 12 }}>{protocolsSummary}</Typography>
      </PortfolioMetadataItem>

      <Popover
        open={Boolean(lifecycleAnchor)}
        anchorEl={lifecycleAnchor}
        onClose={() => setLifecycleAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 200, py: 0.5 }}>
          {lifecycleOptions.map((opt) => (
            <MenuItem
              key={opt.code}
              selected={opt.code === lifecycle}
              sx={drawerMenuItemSx}
              onClick={() => {
                onLifecycleChange(opt.code);
                setLifecycleAnchor(null);
              }}
            >
              {opt.deprecated ? `${opt.label} (deprecated)` : opt.label}
            </MenuItem>
          ))}
        </Box>
      </Popover>

      <Popover
        open={Boolean(topologyAnchor)}
        anchorEl={topologyAnchor}
        onClose={() => setTopologyAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 200, py: 0.5 }}>
          <MenuItem
            selected={topology === 'server_to_server'}
            sx={drawerMenuItemSx}
            onClick={() => {
              onTopologyChange('server_to_server');
              setTopologyAnchor(null);
            }}
          >
            {t('it:enums.topology.serverToServer')}
          </MenuItem>
          <MenuItem
            selected={topology === 'multi_server'}
            sx={drawerMenuItemSx}
            onClick={() => {
              onTopologyChange('multi_server');
              setTopologyAnchor(null);
            }}
          >
            {t('it:enums.topology.multiServer')}
          </MenuItem>
        </Box>
      </Popover>

      <Popover
        open={Boolean(criticalityAnchor)}
        anchorEl={criticalityAnchor}
        onClose={() => setCriticalityAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 200, py: 0.5 }}>
          {CRITICALITIES.map((opt) => (
            <MenuItem
              key={opt.code}
              selected={opt.code === criticality}
              sx={drawerMenuItemSx}
              onClick={() => {
                onCriticalityChange(opt.code);
                setCriticalityAnchor(null);
              }}
            >
              {opt.label}
            </MenuItem>
          ))}
        </Box>
      </Popover>

      <Popover
        open={Boolean(protocolsAnchor)}
        anchorEl={protocolsAnchor}
        onClose={() => setProtocolsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 240, maxHeight: 360, overflowY: 'auto', py: 0.5 }}>
          {connectionTypes.map((ct: any) => {
            const isChecked = safeProtocolCodes.includes(ct.code);
            return (
              <MenuItem
                key={ct.code}
                sx={{ ...drawerMenuItemSx, py: 0.25 }}
                onClick={() => {
                  const next = isChecked
                    ? safeProtocolCodes.filter((c) => c !== ct.code)
                    : [...safeProtocolCodes, ct.code];
                  if (next.length === 0) return; // backend requires at least one
                  onProtocolCodesChange(next);
                }}
              >
                <Checkbox size="small" checked={isChecked} sx={{ p: 0.5, mr: 1 }} />
                <ListItemText primaryTypographyProps={{ sx: { fontSize: 13 } }} primary={ct.label || ct.code} />
              </MenuItem>
            );
          })}
        </Box>
      </Popover>
    </Box>
  );
}
