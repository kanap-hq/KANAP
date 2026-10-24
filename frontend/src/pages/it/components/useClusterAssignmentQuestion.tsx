import React from 'react';
import { Box, Button, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog } from '../../../components/design';

/** A row already stored on the deployment (a cluster's or a server's), by server and role. */
export type DeploymentRow = { asset_id: string; role: string };

export type ClusterQuestionInput = {
  /** The servers chosen for the assignment. */
  assetIds: string[];
  /** What they will host, as the dialog says it: "CheeseTrack (prod, db)". */
  subject: string;
  /** Role code of the assignment. */
  role: string;
  /** The rows stored on the deployment: a cluster that carries the role refuses its members (A3), a member's own row is replaced (A4). */
  rows: DeploymentRow[];
};

export type ClusterQuestionOutcome =
  | { status: 'cancelled' }
  /** A3: the server already has this role through `cluster`; nothing is asked. */
  | { status: 'inherited'; cluster: string }
  /** The assets to write the assignment on, one per chosen server: the server itself or its cluster. */
  | { status: 'ok'; targets: string[] };

type ClusterChoice = { id: string; name: string; count: number; absorbed: string[] };
type Pending = { server: string; subject: string; clusters: ClusterChoice[]; resolve: (answer: string | null) => void };

type AssetRef = { id: string; name: string; status?: string };

const SERVER_ONLY = 'server';

function QuestionDialog({ pending }: { pending: Pending }) {
  const { t } = useTranslation('it');
  const [selected, setSelected] = React.useState(pending.clusters[0].id);
  const several = pending.clusters.length > 1;
  const cluster = pending.clusters.find((candidate) => candidate.id === selected) ?? pending.clusters[0];
  return (
    <KanapDialog
      open
      title={t('components.clusterAssignment.title')}
      onClose={() => pending.resolve(null)}
      onSave={() => pending.resolve(cluster.id)}
      saveLabel={t('components.clusterAssignment.assignToCluster')}
      saveAutoFocus
      secondaryActions={(
        <Button variant="action" onClick={() => pending.resolve(SERVER_ONLY)}>
          {t('components.clusterAssignment.serverOnly')}
        </Button>
      )}
    >
      <Box sx={{ display: 'grid', gap: 1 }}>
        <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary })}>
          {several
            ? t('components.clusterAssignment.inClusters', { server: pending.server })
            : t('components.clusterAssignment.inCluster', {
              server: pending.server,
              cluster: cluster.name,
              count: cluster.count,
              subject: pending.subject,
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
        {cluster.absorbed.length > 0 && (
          <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary })}>
            {t('components.clusterAssignment.absorbed', { count: cluster.absorbed.length, names: cluster.absorbed.join(', ') })}
          </Typography>
        )}
      </Box>
    </KanapDialog>
  );
}

/**
 * The question asked when an assignment is created on a server that is a member of a cluster (A2):
 * assign to the cluster, whose members all inherit it, or to this server only. One dialog for the
 * Deployments tab of an application and the Operations tab of an asset.
 *
 * `resolveTargets` reads the clusters of each chosen server (`GET /assets/:id/clusters`) and their
 * members, then asks one question per server (the cluster to choose when it belongs to several).
 * A server of no cluster, or a cluster, needs no question. Render `questionDialog` once.
 */
export default function useClusterAssignmentQuestion() {
  const [pending, setPending] = React.useState<Pending | null>(null);

  const resolveTargets = React.useCallback(async (input: ClusterQuestionInput): Promise<ClusterQuestionOutcome> => {
    const targets: string[] = [];
    for (const assetId of input.assetIds) {
      const clusters = ((await api.get<{ items: AssetRef[] }>(`/assets/${assetId}/clusters`)).data?.items ?? [])
        .filter((cluster) => cluster.status !== 'retired');
      const carrying = clusters.find((cluster) => input.rows.some((row) => row.asset_id === cluster.id && row.role === input.role));
      if (carrying) return { status: 'inherited', cluster: carrying.name };
      const choices: ClusterChoice[] = [];
      let server = '';
      for (const cluster of clusters) {
        const members = ((await api.get<{ items: AssetRef[] }>(`/assets/${cluster.id}/members`)).data?.items ?? [])
          .filter((member) => member.status !== 'retired');
        const self = members.find((member) => member.id === assetId);
        // A retired server inherits nothing: its cluster is no choice for it.
        if (!self) continue;
        server = self.name;
        choices.push({
          id: cluster.id,
          name: cluster.name,
          count: members.length,
          absorbed: members
            .filter((member) => member.id !== assetId && input.rows.some((row) => row.asset_id === member.id && row.role === input.role))
            .map((member) => member.name),
        });
      }
      if (choices.length === 0) {
        targets.push(assetId);
        continue;
      }
      const answer = await new Promise<string | null>((resolve) => {
        setPending({ server, subject: input.subject, clusters: choices, resolve });
      });
      setPending(null);
      if (answer === null) return { status: 'cancelled' };
      targets.push(answer === SERVER_ONLY ? assetId : answer);
    }
    return { status: 'ok', targets: Array.from(new Set(targets)) };
  }, []);

  const questionDialog = pending ? <QuestionDialog key={`${pending.server}|${pending.clusters.map((c) => c.id).join(',')}`} pending={pending} /> : null;
  return { resolveTargets, questionDialog };
}
