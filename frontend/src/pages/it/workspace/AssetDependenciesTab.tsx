import React from 'react';
import { Alert, Stack, Tooltip } from '@mui/material';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { useTheme } from '@mui/material/styles';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import type { RelationsColumn } from '../../../components/workspace/RelationsTable';
import ViaAssetNames from '../../../components/workspace/ViaAssetNames';
import { RelationSections, assetsSection, useRelations, type AssetRelationRow, type SectionSpec } from '../../../components/workspace/relations';
import { useRelationLabels } from '../../../components/workspace/relations/labels';
import { useLocale } from '../../../i18n/useLocale';
import { joinNames } from '../../working-day-calendars/workingDayCalendarFields';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { getDotColor } from '../../../utils/statusColors';
import AssetImpactSection from '../editors/AssetImpactSection';
import { useNotify } from '../../../components/notify/NotifyProvider';
import { useApplicationFeedback } from '../applicationFeedback';
import usePlacementQuestion from '../components/usePlacementQuestion';
import { ASSET_DIRECTIONS, assetRelationsKey, type AssetDirection, type AssetRelationsData } from './assetRelationsData';

/** One host link a cluster replaces when it takes the placement (R1), as the write reports it. */
type ReplacedHostLink = {
  host_id: string;
  host_name: string;
  asset_id: string;
  asset_name: string;
  cluster_id: string;
  cluster_name: string;
};

const DIRECTION_SET = new Set<string>(ASSET_DIRECTIONS);

/** The label key of each direction (`workspace.asset.relations.*`). */
const DIRECTION_KEY: Record<AssetDirection, string> = {
  contains: 'contains',
  contained_by: 'containedBy',
  depends_on: 'dependsOn',
  depended_on_by: 'dependedOnBy',
};

/**
 * The Dependencies tab of an asset: what falls with it first, then the relations between assets in
 * their four directions. It reads and writes through the same query as the Relations tab
 * (`GET /assets/:id/relations-tab`), so both tabs and their badges share one set of data. An
 * infrastructure member adds from a server search and unlinks on hover, each saved at once; the
 * relations and the impact of every asset are read again after each change.
 */
export default function AssetDependenciesTab({
  assetId,
  isServer = false,
}: {
  assetId: string;
  /** Physical servers keep the "server" sentences in the impact. */
  isServer?: boolean;
}) {
  const { t } = useTranslation(['it', 'common']);
  const feedback = useApplicationFeedback();
  const notify = useNotify();
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const labels = useRelationLabels();
  const locale = useLocale();
  const theme = useTheme();
  const placement = usePlacementQuestion();
  const canEdit = hasLevel('infrastructure', 'member');
  const relationsKey = assetRelationsKey(assetId);
  const groupOf = React.useCallback((kind: string) => (DIRECTION_SET.has(kind) ? 'assets' : undefined), []);
  const { data, error, link, unlink, setError, refresh } = useRelations<AssetRelationsData>({
    path: `/assets/${assetId}/relations`,
    queryKey: relationsKey,
    groupOf,
    readPath: `/assets/${assetId}/relations-tab`,
  });

  // A relation links two assets, and the impact reads these relations: the relations and the
  // impact of every asset are read again after each change, the other asset's included.
  const refreshAssets = () => {
    void queryClient.invalidateQueries({ queryKey: ['asset-relations-tab'] });
    void queryClient.invalidateQueries({ queryKey: ['asset-impact'] });
  };
  // A cluster can carry the link in place of its host: the question is asked before writing.
  const placeLink = async (kind: 'contains' | 'contained_by', targetId: string) => {
    const hostId = kind === 'contains' ? assetId : targetId;
    // A contained-by link reads the containers already loaded with the page; a contains link
    // lets the question read the target's own containers.
    const containers = kind === 'contained_by' ? (data?.assets.contained_by ?? []).map((row) => row.id) : [];
    const answer = await placement.resolvePlacement({
      hostId,
      excludeClusterIds: containers,
      placedAssetId: kind === 'contains' ? targetId : undefined,
    });
    if (answer.status === 'cancelled') return;
    // A chosen cluster carries the link, whichever side of the page it sits on.
    const request = answer.clusterId
      ? (kind === 'contains'
        ? { owner: answer.clusterId, direction: 'contains', id: targetId }
        : { owner: assetId, direction: 'contained_by', id: answer.clusterId })
      : { owner: assetId, direction: kind, id: targetId };
    setError(null);
    try {
      const res = await api.post<{ replaced_host_links?: ReplacedHostLink[] }>(
        `/assets/${request.owner}/relations/${request.direction}`,
        { id: request.id },
      );
      const replaced = res.data?.replaced_host_links ?? [];
      if (replaced.length > 0) {
        notify({
          message: t('workspace.asset.relations.placementReplaced', {
            cluster: replaced[0].cluster_name,
            hosts: joinNames(Array.from(new Set(replaced.map((row) => row.host_name))), locale),
            asset: replaced[0].asset_name,
          }),
        });
      } else if (answer.clusterId) {
        // The cluster carries the link: say where it went, the host's own list does not change.
        notify({
          message: t('workspace.asset.relations.placementLinked', {
            cluster: answer.clusterName ?? '',
          }),
        });
      }
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
    }
    await refresh();
    refreshAssets();
  };
  const onLink = async (kind: string, targetId: string) => {
    if (kind === 'contains' || kind === 'contained_by') {
      await placeLink(kind, targetId);
      return;
    }
    await link(kind, targetId);
    refreshAssets();
  };
  const onUnlink = async (kind: string, targetId: string) => {
    const name = data?.assets[kind as AssetDirection]?.find((row) => row.id === targetId)?.name ?? '';
    if (!(await unlink(kind, targetId))) return;
    refreshAssets();
    feedback.undo(t('workspace.asset.relations.feedback.unlinked', { name }), async () => {
      await link(kind, targetId);
      refreshAssets();
    });
  };

  const sections = ASSET_DIRECTIONS.map((direction): SectionSpec<AssetRelationRow> => {
    const key = DIRECTION_KEY[direction];
    const base = assetsSection({
      t,
      rows: data ? data.assets[direction] : [],
      kindLabel: labels.assetKind,
      environmentLabel: labels.environment,
      statusLabel: labels.status,
    });
    // A cluster often has no dependency of its own, but its members have: those rows sit under
    // one folded line of the same table, with the members that carry each one.
    const throughMembers = direction === 'depends_on' ? data?.assets.depends_on_through_members ?? [] : [];
    const viaColumn: RelationsColumn<AssetRelationRow> = {
      key: 'via',
      header: t('workspace.asset.relations.via'),
      width: 160,
      wrap: true,
      // The folded line exists to name the members that carry each row: its Via column never hides.
      render: (row) => (row.via && row.via.length > 0 ? <ViaAssetNames assets={row.via} /> : null),
    };
    // A contained asset held by another container in service is flagged next to its name (R3).
    const columns = direction === 'contains' || direction === 'contained_by'
      ? base.columns.map((column) => (column.key !== 'name' ? column : {
        ...column,
        render: (row: AssetRelationRow) => {
          const others = direction === 'contains'
            ? row.also_contained_by ?? []
            : row.status === 'retired'
              ? []
              : (data?.assets.contained_by ?? []).filter((other) => other.id !== row.id && other.status !== 'retired');
          if (others.length === 0) return row.name;
          const label = t('workspace.asset.relations.alsoContainedBy', {
            names: joinNames(others.map((other) => other.name), locale),
          });
          return (
            <>
              {row.name}
              <Tooltip title={label}>
                <WarningAmberOutlinedIcon
                  role="img"
                  aria-hidden={false}
                  aria-label={label}
                  sx={{
                    fontSize: 14,
                    ml: 0.5,
                    verticalAlign: 'text-bottom',
                    color: getDotColor('warning', theme.palette.mode),
                  }}
                />
              </Tooltip>
            </>
          );
        },
      }))
      : base.columns;
    return {
      ...base,
      kind: direction,
      title: t(`workspace.asset.relations.${key}`),
      hint: direction === 'contains' ? t('workspace.asset.relations.containsHint') : undefined,
      empty: t(`workspace.asset.relations.empty.${key}`),
      // An asset never relates to itself: the picker leaves it out.
      linkedIds: (rows) => new Set([assetId, ...rows.map((row) => row.id)]),
      columns: throughMembers.length > 0
        ? columns.flatMap((column) => (column.key === 'name' ? [column, viaColumn] : [column]))
        : columns,
      // Folded rows show what the members carry, and cannot be unlinked from the cluster.
      folded: throughMembers.length > 0
        ? { label: t('workspace.asset.relations.throughMembers', { count: throughMembers.length }), rows: throughMembers }
        : undefined,
      removable: direction === 'depends_on' ? (row) => !row.via?.length : undefined,
    };
  });

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <AssetImpactSection assetId={assetId} isServer={isServer} />

      <RelationSections
        sections={sections}
        loaded={!!data}
        canEdit={canEdit}
        searchKeyPrefix="asset"
        onLink={(kind, targetId) => { void onLink(kind, targetId); }}
        onUnlink={(kind, targetId) => { void onUnlink(kind, targetId); }}
      />

      {placement.placementDialog}
    </Stack>
  );
}
