import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import React from 'react';
import {
  Autocomplete,
  Box,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '../../../api';
import EntityKnowledgePanel from '../../../components/EntityKnowledgePanel';
// Lazy like the eight other call sites: a static import here pulls the MDX editor and its
// whole Lexical dependency tree into the entry chunk for every user. The Suspense boundary
// below was already in place.
const MarkdownEditor = React.lazy(() => import('../../../components/MarkdownEditor'));
import ConnectionEndpointPicker from './ConnectionEndpointPicker';
import ConnectionLinkInterfacesDialog from './ConnectionLinkInterfacesDialog';
import ConnectionProtocolsTable, { type ConnectionProtocol } from './ConnectionProtocolsTable';
import ConnectionServersPicker from './ConnectionServersPicker';
import type { ServerOption } from '../../../components/fields/serverOptionRender';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { legTypeLabel } from '../../../utils/interfaceLegType';
import { classificationText } from '../../../utils/applicationClassification';

const NOTES_DEBOUNCE_MS = 900;


type ConnectionTypeOption = { code: string; label: string; typicalPorts: string };

export type { ConnectionProtocol };

type LinkedInterfaceRow = {
  id: string;
  binding_id: string;
  interface_id: string;
  interface_reference?: string | null;
  interface_code?: string | null;
  interface_name: string;
  environment: string;
  leg_type: string;
  source_endpoint: string | null;
  target_endpoint: string | null;
  pattern: string;
  binding_status: string;
  interface_criticality?: string;
  interface_data_class?: string;
  interface_contains_pii?: boolean;
};

type Props = {
  connectionId: string;
  topology: 'server_to_server' | 'multi_server';
  initialDescription: string;
  canManage: boolean;
  source: { asset_id: string | null; entity_code: string | null };
  destination: { asset_id: string | null; entity_code: string | null };
  multiServerIds: string[];
  assetMap: Record<string, ServerOption>;
  protocols: ConnectionProtocol[];
  riskMode: 'manual' | 'derived';
  linkedInterfaces: LinkedInterfaceRow[];
  linkedInterfacesLoading: boolean;
  linkedInterfacesError: string | null;
  derivedInterfaceCount: number;
  onDescriptionSaved?: (next: string) => void;
  onEndpointChange: (
    side: 'source' | 'destination',
    next: { asset_id: string | null; entity_code: string | null },
    asset?: ServerOption,
  ) => void;
  onMultiServerChange: (next: ServerOption[]) => void;
  onProtocolsChange: (next: ConnectionProtocol[]) => void;
  onLinkedInterfacesChanged: () => void;
};

function SectionHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.25 }}>
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
        {children}
      </Typography>
      {action}
    </Stack>
  );
}

export default function ConnectionOverviewTab({
  connectionId,
  topology,
  initialDescription,
  canManage,
  source,
  destination,
  multiServerIds,
  assetMap,
  protocols,
  riskMode,
  linkedInterfaces,
  linkedInterfacesLoading,
  linkedInterfacesError,
  derivedInterfaceCount,
  onDescriptionSaved,
  onEndpointChange,
  onMultiServerChange,
  onProtocolsChange,
  onLinkedInterfacesChanged,
}: Props) {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const CRITICALITIES = [{ code: '', label: classificationText('Not set') }, ...(classificationCatalog?.businessCriticalityLevels || [])];
  const { t } = useTranslation(['it', 'common']);
  const navigate = useNavigate();
  const { settings, labelFor } = useItOpsEnumOptions();
  const connectionTypes: ConnectionTypeOption[] = (settings?.connectionTypes || []).map((ct: any) => ({
    code: ct.code,
    label: ct.label || ct.code,
    typicalPorts: ct.typicalPorts || ct.typical_ports || '',
  }));

  const [description, setDescription] = React.useState(initialDescription);
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineRef = React.useRef(initialDescription);

  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [unlinkingLinkId, setUnlinkingLinkId] = React.useState<string | null>(null);
  const [unlinkError, setUnlinkError] = React.useState<string | null>(null);

  const handleUnlink = React.useCallback(
    async (row: LinkedInterfaceRow) => {
      if (!canManage) return;
      setUnlinkingLinkId(row.id);
      setUnlinkError(null);
      try {
        await api.delete(`/interface-bindings/${row.binding_id}/connection-links/${row.id}`);
        onLinkedInterfacesChanged();
      } catch (e: any) {
        setUnlinkError(getApiErrorMessage(e, t, t('workspace.connection.overview.unlinkFailed')));
      } finally {
        setUnlinkingLinkId(null);
      }
    },
    [canManage, onLinkedInterfacesChanged, t],
  );

  React.useEffect(() => {
    setDescription(initialDescription);
    baselineRef.current = initialDescription;
  }, [initialDescription, connectionId]);

  const persistDescription = React.useCallback(
    async (next: string) => {
      if (next === baselineRef.current) return;
      setStatus('saving');
      setError(null);
      try {
        await api.patch(`/connections/${connectionId}`, {
          description: next.trim().length > 0 ? next : null,
        });
        baselineRef.current = next;
        setStatus('saved');
        onDescriptionSaved?.(next);
        setTimeout(() => {
          setStatus((current) => (current === 'saved' ? 'idle' : current));
        }, 1500);
      } catch (e: any) {
        setStatus('error');
        setError(getApiErrorMessage(e, t, t('messages.saveConnectionFailed')));
      }
    },
    [connectionId, onDescriptionSaved, t],
  );

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void persistDescription(value);
    }, NOTES_DEBOUNCE_MS);
  };

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const multiServerOptions = React.useMemo(
    () => multiServerIds.map((id) => assetMap[id] ?? {
      id,
      name: id.slice(0, 8),
      environment: '',
      kind: '',
      provider: '',
    }),
    [multiServerIds, assetMap],
  );

  const selectedProtocols = React.useMemo(
    () =>
      protocols.map((p) => {
        const ct = connectionTypes.find((c) => c.code === p.code);
        return {
          code: p.code,
          label: ct?.label || p.code,
          typicalPorts: ct?.typicalPorts || '',
          port_override: p.port_override,
        };
      }),
    [protocols, connectionTypes],
  );

  const handleProtocolsSelected = (codes: string[]) => {
    if (codes.length === 0) return;
    const existing = new Map(protocols.map((p) => [p.code, p.port_override]));
    onProtocolsChange(codes.map((code) => ({ code, port_override: existing.get(code) ?? null })));
  };

  // One line per interface (its risk fields are the interface's), with the environments it is bound in.
  const derivationRows = React.useMemo(() => {
    if (riskMode !== 'derived') return [];
    const byInterface = new Map<string, LinkedInterfaceRow & { environments: string[] }>();
    for (const row of linkedInterfaces) {
      const existing = byInterface.get(row.interface_id);
      if (!existing) byInterface.set(row.interface_id, { ...row, environments: [row.environment] });
      else if (!existing.environments.includes(row.environment)) existing.environments.push(row.environment);
    }
    return Array.from(byInterface.values());
  }, [riskMode, linkedInterfaces]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box>
        <SectionHeader
          action={
            status === 'saving' ? (
              <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>{t('common:status.saving')}</Typography>
            ) : status === 'saved' ? (
              <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>{t('common:status.saved')}</Typography>
            ) : status === 'error' && error ? (
              <Typography sx={{ fontSize: 11, color: 'error.main' }}>{error}</Typography>
            ) : null
          }
        >
          {t('workspace.connection.create.description')}
        </SectionHeader>
        <React.Suspense
          fallback={
            <Box
              sx={(theme) => ({
                minHeight: 154,
                maxWidth: 900,
                border: `1px solid ${theme.palette.kanap.border.default}`,
                borderRadius: '8px',
                bgcolor: theme.palette.kanap.bg.composer,
              })}
            />
          }
        >
          <MarkdownEditor
            value={description}
            onChange={handleDescriptionChange}
            placeholder={t('workspace.connection.overview.descriptionPlaceholder')}
            minRows={4}
            maxRows={14}
            disabled={!canManage}
            hideToolbarUntilFocus
            surface
          />
        </React.Suspense>
      </Box>

      <Box>
        <SectionHeader>{t('workspace.connection.create.endpoints')}</SectionHeader>
        {topology === 'server_to_server' ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2.5, maxWidth: 760 }}>
            <ConnectionEndpointPicker
              label={t('workspace.connection.layers.source')}
              value={source}
              disabled={!canManage}
              initialAsset={source.asset_id ? assetMap[source.asset_id] : null}
              onChange={(next, asset) => onEndpointChange('source', next, asset)}
            />
            <ConnectionEndpointPicker
              label={t('workspace.connection.layers.destination')}
              value={destination}
              disabled={!canManage}
              initialAsset={destination.asset_id ? assetMap[destination.asset_id] : null}
              onChange={(next, asset) => onEndpointChange('destination', next, asset)}
            />
          </Box>
        ) : (
          <Box sx={{ maxWidth: 760 }}>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 0.25 }}>{t('workspace.connection.overview.serversMin')}</Typography>
            <ConnectionServersPicker
              value={multiServerOptions}
              onChange={onMultiServerChange}
              disabled={!canManage}
              placeholder={t('workspace.connection.overview.addServer')}
            />
            {multiServerIds.length < 2 && (
              <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mt: 0.5 }}>
                {t('workspace.connection.overview.needTwoServers')}
              </Typography>
            )}
          </Box>
        )}
      </Box>

      <Box>
        <SectionHeader>{t('workspace.connection.overview.protocols')}</SectionHeader>
        <Box sx={{ maxWidth: 760 }}>
          <Autocomplete
            size="small"
            multiple
            disableClearable
            disabled={!canManage}
            options={connectionTypes}
            getOptionLabel={(opt) => opt.label}
            isOptionEqualToValue={(opt, val) => opt.code === val.code}
            value={selectedProtocols}
            onChange={(_, val) => handleProtocolsSelected(val.map((v) => v.code))}
            renderTags={(value, getTagProps) =>
              value.map((opt, index) => (
                <Chip {...getTagProps({ index })} key={opt.code} label={opt.label} size="small" />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                variant="standard"
                placeholder={t('workspace.connection.overview.addProtocol')}
                sx={{ '& input': { fontSize: 13, padding: '4px 0 !important' } }}
              />
            )}
          />
          <Box sx={{ mt: 1.5 }}>
            <ConnectionProtocolsTable
              protocols={protocols}
              connectionKey={connectionId}
              editable
              disabled={!canManage}
              onProtocolsChange={onProtocolsChange}
            />
          </Box>
        </Box>
      </Box>

      {riskMode === 'derived' && derivationRows.length > 0 && (
        <Box>
          <SectionHeader>
            {t('workspace.connection.overview.riskDerivation', { count: derivedInterfaceCount })}
          </SectionHeader>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.interfaces.interface')}</TableCell>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.compliance.criticality')}</TableCell>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.compliance.dataClass')}</TableCell>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.compliance.effectivePii')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {derivationRows.map((row) => (
                <TableRow key={row.interface_id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/it/interfaces/${row.interface_reference || row.interface_id}/overview`)}>
                  <TableCell sx={{ fontSize: 13 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography component="span" sx={{ fontSize: 12, fontFamily: "'JetBrains Mono Variable', monospace", color: 'kanap.text.secondary' }}>
                        {row.interface_reference || row.interface_code}
                      </Typography>
                      <Typography component="span" sx={{ fontSize: 13 }}>{row.interface_name}</Typography>
                      <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                        {row.environments.map((env) => env.toUpperCase()).join(', ')}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontSize: 13 }}>
                    {CRITICALITIES.find((c) => c.code === row.interface_criticality)?.label || row.interface_criticality || '—'}
                  </TableCell>
                  <TableCell sx={{ fontSize: 13 }}>
                    {classificationCatalog?.dataClasses.find((item) => item.code === row.interface_data_class)?.label || row.interface_data_class || '—'}
                  </TableCell>
                  <TableCell sx={{ fontSize: 13 }}>{row.interface_contains_pii ? t('it:enums.yesNo.yes') : t('it:enums.yesNo.no')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <Box>
        <SectionHeader
          action={
            canManage ? (
              <Typography
                component="button"
                onClick={() => setLinkDialogOpen(true)}
                sx={{
                  fontSize: 12,
                  color: 'kanap.teal',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 0,
                }}
              >
                <LinkIcon sx={{ fontSize: 14 }} />
                {t('workspace.connection.overview.linkExisting')}
              </Typography>
            ) : null
          }
        >
          {t('workspace.connection.overview.linkedInterfaces', { count: linkedInterfaces.length })}
        </SectionHeader>
        {linkedInterfacesLoading && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('common:status.loading')}</Typography>
        )}
        {linkedInterfacesError && (
          <Typography sx={{ fontSize: 13, color: 'error.main' }}>{linkedInterfacesError}</Typography>
        )}
        {!linkedInterfacesLoading && !linkedInterfacesError && linkedInterfaces.length === 0 && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
            {t('workspace.connection.overview.noLinkedBindings')}{' '}
            {canManage && (
              <Typography
                component="span"
                onClick={() => setLinkDialogOpen(true)}
                sx={{
                  fontSize: 13,
                  color: 'kanap.teal',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {t('workspace.connection.overview.linkBinding')}
              </Typography>
            )}
          </Typography>
        )}
        {unlinkError && (
          <Typography sx={{ fontSize: 12, color: 'error.main', mb: 0.5 }}>{unlinkError}</Typography>
        )}
        {!linkedInterfacesLoading && linkedInterfaces.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.interfaces.interface')}</TableCell>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.interfaces.environment')}</TableCell>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.overview.leg')}</TableCell>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.overview.pattern')}</TableCell>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.layers.source')}</TableCell>
                <TableCell sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.tertiary' }}>{t('workspace.connection.overview.target')}</TableCell>
                <TableCell align="right" sx={{ width: 36, p: 0 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {linkedInterfaces.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  sx={{
                    cursor: 'pointer',
                    '& .row-unlink': { opacity: 0, transition: 'opacity 120ms ease' },
                    '&:hover .row-unlink': { opacity: 1 },
                  }}
                  onClick={() => navigate(`/it/interfaces/${row.interface_reference || row.interface_id}/overview`)}
                >
                  <TableCell sx={{ fontSize: 13 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography component="span" sx={{ fontSize: 12, fontFamily: "'JetBrains Mono Variable', monospace", color: 'kanap.text.secondary' }}>
                        {row.interface_reference || row.interface_code}
                      </Typography>
                      <Typography component="span" sx={{ fontSize: 13 }}>{row.interface_name}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{row.environment.toUpperCase()}</TableCell>
                  <TableCell sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{legTypeLabel(t, row.leg_type)}</TableCell>
                  <TableCell sx={{ fontSize: 13 }}>{labelFor('interfacePattern', row.pattern) || '—'}</TableCell>
                  <TableCell sx={{ fontSize: 13 }}>{row.source_endpoint || '—'}</TableCell>
                  <TableCell sx={{ fontSize: 13 }}>{row.target_endpoint || '—'}</TableCell>
                  <TableCell align="right" sx={{ p: 0, width: 36 }}>
                    {canManage && (
                      <IconButton
                        className="row-unlink"
                        size="small"
                        aria-label={t('workspace.connection.overview.unlinkBinding')}
                        title={t('workspace.connection.overview.unlink')}
                        disabled={unlinkingLinkId === row.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleUnlink(row);
                        }}
                        sx={{
                          color: 'kanap.text.tertiary',
                          '&:hover': { color: 'kanap.danger', bgcolor: 'transparent' },
                        }}
                      >
                        <LinkOffIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>

      <Box>
        <EntityKnowledgePanel entityType="connections" entityId={connectionId} canCreate={canManage} />
      </Box>

      <ConnectionLinkInterfacesDialog
        open={linkDialogOpen}
        connectionId={connectionId}
        onClose={() => setLinkDialogOpen(false)}
        onLinked={() => onLinkedInterfacesChanged()}
      />
    </Box>
  );
}
