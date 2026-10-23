import React from 'react';
import { Alert, Stack } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../auth/AuthContext';
import { RelationSections, assetsSection, useRelations, type AssetRelationRow, type SectionSpec } from '../../../components/workspace/relations';
import { useRelationLabels } from '../../../components/workspace/relations/labels';
import AssetImpactSection from '../editors/AssetImpactSection';
import { ASSET_DIRECTIONS, assetRelationsKey, type AssetDirection, type AssetRelationsData } from './assetRelationsData';

const DIRECTION_SET = new Set<string>(ASSET_DIRECTIONS);

/** The label key of each direction (`workspace.asset.relations.*`). */
const DIRECTION_KEY: Record<AssetDirection, string> = {
  contains: 'contains',
  contained_by: 'containedBy',
  depends_on: 'dependsOn',
  depended_on_by: 'dependedOnBy',
};

/**
 * The Dependencies tab of an asset: what falls with it first, then, when given, the cluster
 * sections (`clusterSection`), then the relations between assets in their four directions. It reads
 * and writes through the same query as the Relations tab (`GET /assets/:id/relations-tab`), so both
 * tabs and their badges share one set of data. An infrastructure member adds from a server search
 * and unlinks on hover, each saved at once; the relations and the impact of every asset are read
 * again after each change.
 */
export default function AssetDependenciesTab({
  assetId,
  clusterSection,
}: {
  assetId: string;
  /** Rendered as is between the impact and the four directions. */
  clusterSection?: React.ReactNode;
}) {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const labels = useRelationLabels();
  const canEdit = hasLevel('infrastructure', 'member');
  const relationsKey = assetRelationsKey(assetId);
  const groupOf = React.useCallback((kind: string) => (DIRECTION_SET.has(kind) ? 'assets' : undefined), []);
  const { data, error, link, unlink, setError } = useRelations<AssetRelationsData>({
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
  const onLink = async (kind: string, targetId: string) => {
    await link(kind, targetId);
    refreshAssets();
  };
  const onUnlink = async (kind: string, targetId: string) => {
    await unlink(kind, targetId);
    refreshAssets();
  };

  const sections = ASSET_DIRECTIONS.map((direction): SectionSpec<AssetRelationRow> => {
    const key = DIRECTION_KEY[direction];
    return {
      ...assetsSection({
        t,
        rows: data ? data.assets[direction] : [],
        kindLabel: labels.assetKind,
        environmentLabel: labels.environment,
        statusLabel: labels.status,
      }),
      kind: direction,
      title: t(`workspace.asset.relations.${key}`),
      empty: t(`workspace.asset.relations.empty.${key}`),
      // An asset never relates to itself: the picker leaves it out.
      linkedIds: (rows) => new Set([assetId, ...rows.map((row) => row.id)]),
    };
  });

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <AssetImpactSection assetId={assetId} />

      {clusterSection}

      <RelationSections
        sections={sections}
        loaded={!!data}
        canEdit={canEdit}
        searchKeyPrefix="asset"
        onLink={(kind, targetId) => { void onLink(kind, targetId); }}
        onUnlink={(kind, targetId) => { void onUnlink(kind, targetId); }}
      />
    </Stack>
  );
}
