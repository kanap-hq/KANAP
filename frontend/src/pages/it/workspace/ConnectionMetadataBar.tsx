import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import React from 'react';
import { Box, Checkbox, ListItemText, MenuItem, Popover, Typography } from '@mui/material';
import { PortfolioMetadataItem } from '../../portfolio/workspace/PortfolioMetadataBar';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { drawerMenuItemSx } from '../../../theme/formSx';
import { StatusDot } from '../../../components/design';
import { classificationText } from '../../../utils/applicationClassification';

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
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const CRITICALITIES = [{ code: '', label: 'Not set' }, ...(classificationCatalog?.businessCriticalityLevels || [])];
  const { byField, labelFor, settings } = useItOpsEnumOptions();
  const lifecycleOptions = byField.lifecycleStatus || [];
  const connectionTypes = settings?.connectionTypes || [];

  const safeProtocolCodes = protocolCodes || [];
  // Each protocol by its name in the reader's language; a value that is no known code is shown as given.
  const safeProtocolLabels = (protocolLabels && protocolLabels.length > 0 ? protocolLabels : safeProtocolCodes)
    .map((value) => connectionTypes.find((ct: any) => ct.code === value)?.label || value);

  const [lifecycleAnchor, setLifecycleAnchor] = React.useState<HTMLElement | null>(null);
  const [topologyAnchor, setTopologyAnchor] = React.useState<HTMLElement | null>(null);
  const [criticalityAnchor, setCriticalityAnchor] = React.useState<HTMLElement | null>(null);
  const [protocolsAnchor, setProtocolsAnchor] = React.useState<HTMLElement | null>(null);

  const lifecycleLabel = labelFor('lifecycleStatus', lifecycle) || lifecycle || 'Lifecycle missing';
  const topologyLabel = topology === 'server_to_server' ? 'Server to server' : 'Multi-server';
  const effectiveCritLabel =
    CRITICALITIES.find((c) => c.code === effectiveCriticality)?.label
      || effectiveCriticality
      || 'Criticality missing';
  const protocolsSummary = (() => {
    if (safeProtocolLabels.length === 0) return 'Protocols missing';
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
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>Lifecycle</Typography>
        <StatusDot size={8} color={lifecycleColor} sx={{ mr: 0.75 }} />
        <Typography component="span" sx={{ fontSize: 12 }}>{lifecycleLabel}</Typography>
      </PortfolioMetadataItem>

      <PortfolioMetadataItem
        onClick={(e) => !topologyDisabled && !disabled && setTopologyAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled || topologyDisabled}
      >
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>Topology</Typography>
        <Typography component="span" sx={{ fontSize: 12 }}>{topologyLabel}</Typography>
      </PortfolioMetadataItem>

      <PortfolioMetadataItem
        onClick={(e) => riskMode === 'manual' && !disabled && setCriticalityAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled || riskMode === 'derived'}
      >
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>Criticality</Typography>
        <StatusDot size={8} color={criticalityColor} sx={{ mr: 0.75 }} />
        <Typography component="span" sx={{ fontSize: 12 }}>{effectiveCritLabel}</Typography>
        {riskMode === 'derived' && (
          <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', ml: 0.5 }}>
            (derived from {derivedInterfaceCount})
          </Typography>
        )}
        {classificationIncomplete && (
          <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', ml: 0.5 }}>
            ({classificationText('Incomplete inheritance')})
          </Typography>
        )}
      </PortfolioMetadataItem>

      <PortfolioMetadataItem disabled>
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>Endpoints</Typography>
        <Typography component="span" sx={{ fontSize: 12 }}>{endpointsLabel}</Typography>
      </PortfolioMetadataItem>

      <PortfolioMetadataItem
        onClick={(e) => !disabled && setProtocolsAnchor(e.currentTarget as HTMLElement)}
        disabled={disabled}
      >
        <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary', mr: 0.5 }}>Protocols</Typography>
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
            Server to server
          </MenuItem>
          <MenuItem
            selected={topology === 'multi_server'}
            sx={drawerMenuItemSx}
            onClick={() => {
              onTopologyChange('multi_server');
              setTopologyAnchor(null);
            }}
          >
            Multi-server
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
