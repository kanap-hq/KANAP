import React from 'react';
import {
  Box,
  Checkbox,
  IconButton,
  ListItemText,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import api from '../../../api';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import ConnectionHopEquipmentPicker from './ConnectionHopEquipmentPicker';
import ConnectionProtocolsTable, { type ConnectionProtocol } from './ConnectionProtocolsTable';
import { drawerMenuItemSx, drawerSelectSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useTranslation } from 'react-i18next';

export type ConnectionPathHop = {
  id: string;
  order_index: number;
  function_code: string | null;
  equipment_asset_id: string | null;
  equipment_entity_code: string | null;
  protocol_codes: string[];
  port_override: string | null;
  notes: string | null;
};

type Props = {
  connectionId: string;
  hops: ConnectionPathHop[];
  canManage: boolean;
  defaultProtocolCodes?: string[];
  /** Connection-level protocols + ports (defined in Overview), shown read-only at the destination. */
  protocols?: ConnectionProtocol[];
  assetMap?: Record<string, { name: string; reference?: string | null }>;
  /** Read-only echo of the connection's source/destination for context. */
  sourceLabel: string;
  destinationLabel: string;
  onChange: (next: ConnectionPathHop[]) => void;
};

const PATCH_DEBOUNCE_MS = 600;
const SOFT_WARNING_HOPS = 5;

export default function ConnectionPathSection({
  connectionId,
  hops,
  canManage,
  defaultProtocolCodes = [],
  protocols = [],
  assetMap = {},
  sourceLabel,
  destinationLabel,
  onChange,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { settings } = useItOpsEnumOptions();
  const connectionTypes = settings?.connectionTypes || [];
  const pathHopFunctions = (settings as any)?.pathHopFunctions || [];

  // Map of protocol code -> typical ports string (e.g. "443", "80, 443"), used
  // to surface the suggested port for a hop and to seed an empty port override
  // when a protocol is picked (mirrors the connection-level Overview behavior).
  const protocolPortMap = React.useMemo(
    () =>
      new Map<string, string>(
        connectionTypes.map((ct: any) => [
          String(ct.code || '').trim().toLowerCase(),
          String(ct.typicalPorts || ct.typical_ports || '').trim(),
        ]),
      ),
    [connectionTypes],
  );

  const suggestedPortFor = React.useCallback(
    (hop: ConnectionPathHop): string => {
      const codes = hop.protocol_codes && hop.protocol_codes.length > 0 ? hop.protocol_codes : defaultProtocolCodes;
      const tokens = (codes || [])
        .flatMap((c) => (protocolPortMap.get(c) || '').split(',').map((s) => s.trim()))
        .filter(Boolean);
      return Array.from(new Set(tokens)).join(', ');
    },
    [protocolPortMap, defaultProtocolCodes],
  );

  const [error, setError] = React.useState<string | null>(null);
  const [protocolsAnchor, setProtocolsAnchor] = React.useState<{ hopId: string; anchor: HTMLElement } | null>(null);
  const debounceRefs = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  React.useEffect(() => {
    return () => {
      Object.values(debounceRefs.current).forEach(clearTimeout);
    };
  }, []);

  const sortedHops = React.useMemo(
    () => [...hops].sort((a, b) => a.order_index - b.order_index),
    [hops],
  );

  const callPatch = React.useCallback(
    async (hopId: string, patch: Partial<ConnectionPathHop>) => {
      try {
        const res = await api.patch<ConnectionPathHop>(`/connections/${connectionId}/legs/${hopId}`, patch);
        onChange(hops.map((l) => (l.id === hopId ? { ...l, ...res.data } : l)));
        setError(null);
      } catch (e: any) {
        setError(getApiErrorMessage(e, t, t('workspace.connection.path.saveFailed')));
      }
    },
    [connectionId, hops, onChange, t],
  );

  const debouncedPatch = React.useCallback(
    (hopId: string, patch: Partial<ConnectionPathHop>) => {
      if (debounceRefs.current[hopId]) clearTimeout(debounceRefs.current[hopId]);
      debounceRefs.current[hopId] = setTimeout(() => {
        void callPatch(hopId, patch);
      }, PATCH_DEBOUNCE_MS);
    },
    [callPatch],
  );

  const updateLocal = (hopId: string, patch: Partial<ConnectionPathHop>) => {
    onChange(hops.map((l) => (l.id === hopId ? { ...l, ...patch } : l)));
  };

  const handleAddHop = async () => {
    if (!canManage) return;
    try {
      const res = await api.post<ConnectionPathHop>(`/connections/${connectionId}/legs`, {
        function_code: null,
        equipment_asset_id: null,
        equipment_entity_code: null,
        protocol_codes: defaultProtocolCodes.length > 0 ? defaultProtocolCodes : ['https'],
        port_override: null,
        notes: null,
      });
      onChange([...hops, res.data]);
      setError(null);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('workspace.connection.path.addFailed')));
    }
  };

  const handleDeleteHop = async (hopId: string) => {
    if (!canManage) return;
    try {
      await api.delete(`/connections/${connectionId}/legs/${hopId}`);
      onChange(hops.filter((l) => l.id !== hopId));
      setError(null);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('workspace.connection.path.removeFailed')));
    }
  };

  const handleSwap = async (hopId: string, neighborId: string) => {
    if (!canManage) return;
    try {
      const res = await api.post<{ a: { id: string; order_index: number }; b: { id: string; order_index: number } }>(
        `/connections/${connectionId}/legs/${hopId}/swap`,
        { swap_with_leg_id: neighborId },
      );
      onChange(
        hops.map((l) => {
          if (l.id === res.data.a.id) return { ...l, order_index: res.data.a.order_index };
          if (l.id === res.data.b.id) return { ...l, order_index: res.data.b.order_index };
          return l;
        }),
      );
      setError(null);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('workspace.connection.path.reorderFailed')));
    }
  };

  const protocolLineFor = (hop: ConnectionPathHop): string => {
    const codes = hop.protocol_codes && hop.protocol_codes.length > 0 ? hop.protocol_codes : defaultProtocolCodes;
    if (!codes || codes.length === 0) return '';
    const labels = codes.map((c) => connectionTypes.find((ct: any) => ct.code === c)?.label || c);
    const portStr = hop.port_override ? `:${hop.port_override}` : '';
    return `${labels.join(', ')}${portStr}`;
  };

  const connectorLineBefore = (idx: number): string => {
    // The label on the arrow ABOVE hop[idx] reflects the protocol of the previous hop
    // (or the connection's default before hop[0]).
    if (idx === 0) {
      if (!defaultProtocolCodes || defaultProtocolCodes.length === 0) return '';
      const labels = defaultProtocolCodes.map(
        (c) => connectionTypes.find((ct: any) => ct.code === c)?.label || c,
      );
      return labels.join(', ');
    }
    return protocolLineFor(sortedHops[idx - 1]);
  };

  const connectorAfterDestination = (): string => {
    const lastHop = sortedHops[sortedHops.length - 1];
    if (lastHop) return protocolLineFor(lastHop);
    if (!defaultProtocolCodes || defaultProtocolCodes.length === 0) return '';
    return defaultProtocolCodes
      .map((c) => connectionTypes.find((ct: any) => ct.code === c)?.label || c)
      .join(', ');
  };

  const renderEndpointCard = (title: string, value: string) => (
    <Box
      sx={(theme) => ({
        border: `1px dashed ${theme.palette.kanap.border.soft}`,
        borderRadius: '6px',
        px: 1.25,
        py: 0.75,
      })}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', minWidth: 64, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{value}</Typography>
      </Stack>
    </Box>
  );

  const renderConnector = (label: string) => (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0.5, py: 0.75 }}>
      <ArrowDownwardIcon sx={{ fontSize: 14, color: 'kanap.text.tertiary' }} />
      {label && (
        <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>{label}</Typography>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography
          component="h2"
          sx={(theme) => ({
            m: 0,
            fontSize: 14,
            fontWeight: 500,
            lineHeight: 1.4,
            color: theme.palette.kanap.text.primary,
          })}
        >
          {t('workspace.connection.path.title', { count: sortedHops.length })}
        </Typography>
      </Box>
      {error && (
        <Typography sx={{ fontSize: 12, color: 'error.main' }}>{error}</Typography>
      )}
      {sortedHops.length > SOFT_WARNING_HOPS && (
        <Box sx={(theme) => ({
          border: `1px solid ${theme.palette.kanap.border.default}`,
          borderRadius: '6px',
          p: 1,
          bgcolor: 'warning.light',
          color: 'warning.dark',
        })}>
          <Typography sx={{ fontSize: 12 }}>
            {t('workspace.connection.path.longWarning', { count: sortedHops.length })}
          </Typography>
        </Box>
      )}

      <Box sx={{ maxWidth: 760 }}>
        {renderEndpointCard('Source', sourceLabel)}
        {renderConnector(connectorLineBefore(0))}
        {sortedHops.map((hop, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === sortedHops.length - 1;
          return (
            <React.Fragment key={hop.id}>
              <Box
                sx={(theme) => ({
                  border: `1px solid ${theme.palette.kanap.border.default}`,
                  borderRadius: '8px',
                  bgcolor: theme.palette.kanap.bg.primary,
                  px: 1.5,
                  py: 1.25,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  transition: 'box-shadow 160ms ease',
                  '&:hover .hop-delete, &:hover .hop-move': { opacity: 1 },
                })}
              >
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box
                    sx={(theme) => ({
                      bgcolor: theme.palette.kanap.navChip.bg,
                      border: `1px solid ${theme.palette.kanap.navChip.border}`,
                      color: theme.palette.kanap.navChip.fg,
                      fontSize: 11,
                      fontWeight: 500,
                      fontFamily: "'JetBrains Mono Variable', monospace",
                      px: 0.75,
                      py: 0.2,
                      borderRadius: '5px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    })}
                  >
                    {t('workspace.connection.path.hop', { index: hop.order_index })}
                  </Box>
                  <TextField
                    select
                    size="small"
                    variant="standard"
                    value={hop.function_code || ''}
                    onChange={(e) => {
                      const next = e.target.value || null;
                      updateLocal(hop.id, { function_code: next });
                      void callPatch(hop.id, { function_code: next });
                    }}
                    disabled={!canManage}
                    sx={{ ...drawerSelectSx, minWidth: 160, flex: 1 }}
                    SelectProps={{ displayEmpty: true }}
                  >
                    <MenuItem value="" sx={drawerMenuItemSx}>
                      <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('workspace.connection.path.functionMissing')}</Typography>
                    </MenuItem>
                    {pathHopFunctions.map((fn: any) => (
                      <MenuItem key={fn.code} value={fn.code} sx={drawerMenuItemSx}>
                        {fn.deprecated ? `${fn.label} (deprecated)` : fn.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {canManage && !isFirst && (
                    <IconButton
                      className="hop-move"
                      size="small"
                      onClick={() => void handleSwap(hop.id, sortedHops[idx - 1].id)}
                      sx={{ opacity: 0, transition: 'opacity 120ms ease', p: 0.5 }}
                      aria-label={t('workspace.connection.path.moveHopUp')}
                      title={t('workspace.connection.path.moveUp')}
                    >
                      <KeyboardArrowUpIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                  {canManage && !isLast && (
                    <IconButton
                      className="hop-move"
                      size="small"
                      onClick={() => void handleSwap(hop.id, sortedHops[idx + 1].id)}
                      sx={{ opacity: 0, transition: 'opacity 120ms ease', p: 0.5 }}
                      aria-label={t('workspace.connection.path.moveHopDown')}
                      title={t('workspace.connection.path.moveDown')}
                    >
                      <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                  {canManage && (
                    <IconButton
                      className="hop-delete"
                      size="small"
                      onClick={() => void handleDeleteHop(hop.id)}
                      sx={{ opacity: 0, transition: 'opacity 120ms ease', p: 0.5 }}
                      aria-label={t('workspace.connection.path.removeHop')}
                      title={t('common:buttons.remove')}
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 15, color: 'kanap.danger' }} />
                    </IconButton>
                  )}
                </Stack>

                <ConnectionHopEquipmentPicker
                  value={{ asset_id: hop.equipment_asset_id, entity_code: hop.equipment_entity_code }}
                  initialAssetName={hop.equipment_asset_id ? assetMap[hop.equipment_asset_id]?.name || null : null}
                  initialAssetReference={hop.equipment_asset_id ? assetMap[hop.equipment_asset_id]?.reference || null : null}
                  disabled={!canManage}
                  onChange={(next) => {
                    updateLocal(hop.id, {
                      equipment_asset_id: next.asset_id,
                      equipment_entity_code: next.entity_code,
                    });
                    void callPatch(hop.id, {
                      equipment_asset_id: next.asset_id,
                      equipment_entity_code: next.entity_code,
                    });
                  }}
                />

                <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 2fr)', gap: 1.5, alignItems: 'baseline' }}>
                  <Box>
                    <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mb: 0.25 }}>{t('workspace.connection.path.protocolsOverride')}</Typography>
                    <Typography
                      component="button"
                      onClick={(e) => setProtocolsAnchor({ hopId: hop.id, anchor: e.currentTarget as HTMLElement })}
                      disabled={!canManage}
                      sx={{
                        fontSize: 13,
                        color: 'kanap.text.primary',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                        p: 0,
                        minHeight: 22,
                        display: 'block',
                      }}
                    >
                      {(hop.protocol_codes || [])
                        .map((c) => connectionTypes.find((ct: any) => ct.code === c)?.label || c)
                        .join(', ') || 'Inherited'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mb: 0.25 }}>{t('workspace.connection.protocolsTable.port')}</Typography>
                    <TextField
                      size="small"
                      variant="standard"
                      disabled={!canManage}
                      value={hop.port_override || ''}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        updateLocal(hop.id, { port_override: next });
                        debouncedPatch(hop.id, { port_override: next });
                      }}
                      placeholder={suggestedPortFor(hop) || 'e.g., 8443'}
                      sx={{ '& input': { fontSize: 13, padding: '2px 0' } }}
                    />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mb: 0.25 }}>{t('common.notes')}</Typography>
                    <TextField
                      size="small"
                      variant="standard"
                      disabled={!canManage}
                      value={hop.notes || ''}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        updateLocal(hop.id, { notes: next });
                        debouncedPatch(hop.id, { notes: next });
                      }}
                      placeholder={t('workspace.connection.path.notesPlaceholder')}
                      sx={{ '& input': { fontSize: 13, padding: '2px 0' } }}
                    />
                  </Box>
                </Box>
              </Box>
              {!isLast && renderConnector(protocolLineFor(hop))}
            </React.Fragment>
          );
        })}
        {sortedHops.length > 0 && renderConnector(connectorAfterDestination())}
        {renderEndpointCard('Destination', destinationLabel)}

        {protocols.length > 0 && (
          <Box sx={{ mt: 1.25, pl: 1.5 }}>
            <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mb: 0.25 }}>
              {t('workspace.connection.path.destinationPorts', { tab: t('workspace.connection.tabs.overview') })}
            </Typography>
            <ConnectionProtocolsTable protocols={protocols} />
          </Box>
        )}

        {canManage && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
            <Typography
              component="button"
              onClick={() => void handleAddHop()}
              sx={(theme) => ({
                fontSize: 12,
                color: theme.palette.kanap.teal,
                border: `1px solid ${theme.palette.kanap.border.default}`,
                bgcolor: 'transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1.5,
                py: 0.5,
                borderRadius: '6px',
                '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
              })}
            >
              <AddIcon sx={{ fontSize: 14 }} />
              {t('workspace.connection.path.addHop')}
            </Typography>
          </Box>
        )}
      </Box>

      <Popover
        open={Boolean(protocolsAnchor)}
        anchorEl={protocolsAnchor?.anchor}
        onClose={() => setProtocolsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 240, maxHeight: 360, overflowY: 'auto', py: 0.5 }}>
          {connectionTypes.map((ct: any) => {
            const hop = protocolsAnchor ? sortedHops.find((l) => l.id === protocolsAnchor.hopId) : null;
            const isChecked = hop ? (hop.protocol_codes || []).includes(ct.code) : false;
            return (
              <MenuItem
                key={ct.code}
                sx={{ ...drawerMenuItemSx, py: 0.25 }}
                onClick={() => {
                  if (!hop || !protocolsAnchor) return;
                  const cur = hop.protocol_codes || [];
                  const adding = !isChecked;
                  const next = adding ? [...cur, ct.code] : cur.filter((c) => c !== ct.code);
                  const patch: Partial<ConnectionPathHop> = { protocol_codes: next };
                  // Seed the suggested port when picking a protocol into an empty
                  // override, so the default is visible and editable.
                  if (adding && !(hop.port_override || '').trim()) {
                    const seed = (protocolPortMap.get(ct.code) || '').trim();
                    if (seed) patch.port_override = seed;
                  }
                  updateLocal(hop.id, patch);
                  void callPatch(hop.id, patch);
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
