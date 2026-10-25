import React from 'react';
import {
  Alert,
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '../../../api';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import ClusterMark from '../../../components/workspace/ClusterMark';
import ViaAssetNames from '../../../components/workspace/ViaAssetNames';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type ConnectionCluster = { id: string; name: string };

type ConnectionAssetRole = {
  part: 'source' | 'destination' | 'server' | 'hop';
  hop_order: number | null;
  inherited: boolean;
  via_clusters?: ConnectionCluster[];
};

type ConnectionServer = {
  id: string;
  name: string;
  asset_reference?: string | null;
  is_cluster?: boolean;
};

export type ServerConnectionRow = {
  id: string;
  connection_reference: string;
  name: string;
  topology: 'server_to_server' | 'multi_server';
  lifecycle: string;
  protocol_labels?: string[];
  source_label?: string | null;
  destination_label?: string | null;
  asset_roles?: ConnectionAssetRole[];
  inherited?: boolean;
  via_clusters?: ConnectionCluster[];
  servers?: ConnectionServer[];
};

const denseTableSx = {
  '& th': {
    fontSize: 12,
    fontWeight: 500,
    borderBottom: '1px solid',
    borderColor: 'kanap.border.default',
    color: 'kanap.text.tertiary',
    py: 0.75,
  },
  '& td': {
    fontSize: 13,
    borderBottom: '1px solid',
    borderColor: 'kanap.border.soft',
    color: 'kanap.text.primary',
    py: 0.75,
  },
  '& tbody tr:hover': {
    bgcolor: 'kanap.bg.hover',
  },
  '& .MuiButton-root': {
    minWidth: 0,
    p: 0,
    height: 'auto',
    color: 'kanap.text.primary',
    fontSize: 13,
    fontWeight: 400,
    justifyContent: 'flex-start',
    textTransform: 'none',
    '&:hover': {
      bgcolor: 'transparent',
      color: 'kanap.teal',
      textDecoration: 'underline',
    },
  },
} as const;

/**
 * The connections of an asset (Network tab): the hops it carries, the cluster lines it inherits,
 * and, for a multi-server connection, the servers it joins. It reads the asset every time its id
 * changes; no action here, the connection page holds the edits.
 */
export default function AssetConnectionsSection({ assetId }: { assetId: string }) {
  const { t } = useTranslation(['it', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const navigate = useNavigate();
  const [connections, setConnections] = React.useState<ServerConnectionRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    if (!assetId) {
      setConnections([]);
      setError(null);
      setLoading(false);
      return () => { cancelled = true; };
    }
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<{ items: ServerConnectionRow[] }>(`/connections/by-server/${assetId}`);
        if (!cancelled) setConnections(res.data?.items || []);
      } catch (e: any) {
        if (!cancelled) {
          setError(getApiErrorMessage(e, t, t('messages.loadConnectionsFailed')));
          setConnections([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [assetId, t]);

  const topologyLabel = React.useCallback((value?: string) => {
    if (value === 'server_to_server') return t('enums.topology.serverToServer');
    if (value === 'multi_server') return t('enums.topology.multiServer');
    return value || '';
  }, [t]);

  const lineUnderName = (connection: ServerConnectionRow) => {
    const roles = connection.asset_roles ?? [];
    const hops = roles
      .filter((role) => role.part === 'hop')
      .map((role) => ({
        label: t('workspace.connection.path.hop', { index: role.hop_order }),
        via: role.inherited ? role.via_clusters ?? [] : [],
      }));
    // A hop inherited from a cluster says it itself; the other roles of the connection carry the
    // cluster that gives them, when their own role does not.
    const hopVia = hops.some((hop) => hop.via.length > 0);
    const otherVia = Array.from(new Map(
      roles
        .filter((role) => role.part !== 'hop' && role.inherited)
        .flatMap((role) => role.via_clusters ?? [])
        .map((cluster) => [cluster.id, cluster]),
    ).values());
    const trailingVia = !hopVia && connection.inherited && (connection.via_clusters?.length ?? 0) > 0
      ? connection.via_clusters ?? []
      : otherVia;
    if (hops.length === 0 && trailingVia.length === 0) return null;
    return (
      <Box component="div" sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
        {hops.map((hop, index) => (
          <React.Fragment key={`${hop.label}-${index}`}>
            {index > 0 ? ', ' : null}
            {hop.label}
            {hop.via.length > 0 ? (
              <>
                {' · '}
                {t('components.clusterAssignment.via')} <ViaAssetNames assets={hop.via} />
              </>
            ) : null}
          </React.Fragment>
        ))}
        {hops.length > 0 && trailingVia.length > 0 ? ' · ' : null}
        {trailingVia.length > 0 && (
          <>
            {t('components.clusterAssignment.via')} <ViaAssetNames assets={trailingVia} />
          </>
        )}
      </Box>
    );
  };

  const serversCell = (connection: ServerConnectionRow) => {
    const servers = connection.servers ?? [];
    if (servers.length === 0) return '-';
    return servers.map((server, index) => (
      <React.Fragment key={server.id}>
        {index > 0 && ', '}
        {server.name}
        {server.is_cluster ? <> <ClusterMark /></> : null}
      </React.Fragment>
    ));
  };

  if (error) return <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>;
  if (loading) return null;
  if (connections.length === 0) {
    return <Typography variant="body2" color="text.secondary">{t('workspace.asset.connections.noConnections')}</Typography>;
  }

  return (
    <Table size="small" sx={denseTableSx}>
      <TableHead>
        <TableRow>
          <TableCell>{t('workspace.asset.connections.connectionId')}</TableCell>
          <TableCell>{t('workspace.asset.connections.name')}</TableCell>
          <TableCell>{t('workspace.asset.connections.topology')}</TableCell>
          <TableCell>{t('workspace.asset.connections.protocols')}</TableCell>
          <TableCell>{t('workspace.asset.connections.source')}</TableCell>
          <TableCell>{t('workspace.asset.connections.destination')}</TableCell>
          <TableCell>{t('workspace.asset.connections.lifecycle')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {connections.map((connection) => (
          <TableRow key={connection.id} hover>
            <TableCell>
              <Button
                size="small"
                onClick={() => navigate(`/it/connections/${connection.connection_reference || connection.id}/overview`)}
                sx={{ fontFamily: "'JetBrains Mono Variable', monospace", textTransform: 'none' }}
              >
                {connection.connection_reference}
              </Button>
            </TableCell>
            <TableCell>
              <Button size="small" onClick={() => navigate(`/it/connections/${connection.connection_reference || connection.id}/overview`)}>
                {connection.name}
              </Button>
              {lineUnderName(connection)}
            </TableCell>
            <TableCell>{topologyLabel(connection.topology)}</TableCell>
            <TableCell>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 0.5 }}>
                {(connection.protocol_labels || []).map((protocol) => (
                  <Box key={protocol} component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{protocol}</Box>
                ))}
              </Box>
            </TableCell>
            {connection.topology === 'multi_server' ? (
              <TableCell colSpan={2}>{serversCell(connection)}</TableCell>
            ) : (
              <>
                <TableCell>{connection.source_label || '-'}</TableCell>
                <TableCell>{connection.destination_label || '-'}</TableCell>
              </>
            )}
            <TableCell>{labelFor('lifecycleStatus', connection.lifecycle) || connection.lifecycle}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
