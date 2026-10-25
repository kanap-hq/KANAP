import React from 'react';
import { Box, Button, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog } from '../../../components/design';

export type PlacementOutcome = { status: 'cancelled' } | { status: 'ok'; clusterId: string | null };

export type PlacementInput = {
  /** The host the link comes from: the page in `contains`, the chosen container in `contained_by`. */
  hostId: string;
  /** Clusters already holding the asset: their hosts do not raise the question again. */
  excludeClusterIds: string[];
};

type ClusterChoice = { id: string; name: string; count: number };
type Pending = { host: string; clusters: ClusterChoice[]; resolve: (answer: string | null) => void };

type AssetRef = { id: string; name: string; status?: string };

const HOST_ONLY = 'host';

function QuestionDialog({ pending }: { pending: Pending }) {
  const { t } = useTranslation('it');
  const [selected, setSelected] = React.useState(pending.clusters[0].id);
  const several = pending.clusters.length > 1;
  const cluster = pending.clusters.find((candidate) => candidate.id === selected) ?? pending.clusters[0];
  return (
    <KanapDialog
      open
      title={t('components.clusterPlacement.title')}
      onClose={() => pending.resolve(null)}
      onSave={() => pending.resolve(cluster.id)}
      saveLabel={t('components.clusterPlacement.placeInCluster')}
      saveAutoFocus
      secondaryActions={(
        <Button variant="action" onClick={() => pending.resolve(HOST_ONLY)}>
          {t('components.clusterPlacement.hostOnly')}
        </Button>
      )}
    >
      <Box sx={{ display: 'grid', gap: 1 }}>
        <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary })}>
          {several
            ? t('components.clusterPlacement.inClusters', { host: pending.host })
            : t('components.clusterPlacement.inCluster', {
              host: pending.host,
              cluster: cluster.name,
              count: cluster.count,
            })}
        </Typography>
        {several && (
          <RadioGroup value={selected} onChange={(event) => setSelected(event.target.value)}>
            {pending.clusters.map((choice) => (
              <FormControlLabel
                key={choice.id}
                value={choice.id}
                control={<Radio size="small" />}
                label={`${choice.name} · ${t('components.clusterAssignment.memberCount', { count: choice.count })}`}
                sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }}
              />
            ))}
          </RadioGroup>
        )}
      </Box>
    </KanapDialog>
  );
}

/**
 * The question asked before a `contains` or `contained_by` link between assets (D9): place the
 * asset in the cluster of the host that would carry the link, or keep the link on this host only.
 *
 * `resolvePlacement` reads the clusters of the host (`GET /assets/:id/clusters`) and their members
 * in service. A host of no cluster, a retired host and a retired cluster raise no question; nor
 * does a cluster already holding the asset (`excludeClusterIds`). A read fails: no question, the
 * server still applies its placement rules. Render `placementDialog` once.
 */
export default function usePlacementQuestion() {
  const [pending, setPending] = React.useState<Pending | null>(null);

  const resolvePlacement = React.useCallback(async (input: PlacementInput): Promise<PlacementOutcome> => {
    try {
      const excluded = new Set(input.excludeClusterIds);
      const clusters = ((await api.get<{ items: AssetRef[] }>(`/assets/${input.hostId}/clusters`)).data?.items ?? [])
        .filter((cluster) => cluster.status !== 'retired' && !excluded.has(cluster.id));
      const choices: ClusterChoice[] = [];
      let host = '';
      for (const cluster of clusters) {
        const members = ((await api.get<{ items: AssetRef[] }>(`/assets/${cluster.id}/members`)).data?.items ?? [])
          .filter((member) => member.status !== 'retired');
        const self = members.find((member) => member.id === input.hostId);
        // A retired host inherits nothing: its cluster is no choice for it.
        if (!self) continue;
        host = self.name;
        choices.push({ id: cluster.id, name: cluster.name, count: members.length });
      }
      if (choices.length === 0) return { status: 'ok', clusterId: null };
      const answer = await new Promise<string | null>((resolve) => {
        setPending({ host, clusters: choices, resolve });
      }).finally(() => setPending(null));
      if (answer === null) return { status: 'cancelled' };
      return { status: 'ok', clusterId: answer === HOST_ONLY ? null : answer };
    } catch {
      return { status: 'ok', clusterId: null };
    }
  }, []);

  const placementDialog = pending
    ? <QuestionDialog key={`${pending.host}|${pending.clusters.map((cluster) => cluster.id).join(',')}`} pending={pending} />
    : null;
  return { resolvePlacement, placementDialog };
}
