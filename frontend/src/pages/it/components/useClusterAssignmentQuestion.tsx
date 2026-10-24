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
  /** The asset the edited row sits on today. A cluster whose member is chosen next: the user is taking the row off it, nothing is asked. */
  movingFrom?: string;
};

export type ClusterQuestionOutcome =
  | { status: 'cancelled' }
  /** A3: the server already has this role through `cluster`; nothing is asked. */
  | { status: 'inherited'; cluster: string }
  /** The assets to write the assignment on, one per chosen server: the server itself or its cluster. */
  | { status: 'ok'; targets: string[] };

type ClusterChoice = { id: string; name: string; count: number; absorbed: string[] };
/** `direct`: the cluster itself was chosen; only the members' rows it replaces are said (A4). */
type Pending = { server: string; subject: string; clusters: ClusterChoice[]; direct?: boolean; resolve: (answer: string | null) => void };

type AssetRef = { id: string; name: string; status?: string; is_cluster?: boolean };

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
      secondaryActions={pending.direct ? undefined : (
        <Button variant="action" onClick={() => pending.resolve(SERVER_ONLY)}>
          {t('components.clusterAssignment.serverOnly')}
        </Button>
      )}
    >
      <Box sx={{ display: 'grid', gap: 1 }}>
        {!pending.direct && <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary })}>
          {several
            ? t('components.clusterAssignment.inClusters', { server: pending.server })
            : t('components.clusterAssignment.inCluster', {
              server: pending.server,
              cluster: cluster.name,
              count: cluster.count,
              subject: pending.subject,
            })}
        </Typography>}
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
 * A server of no cluster needs no question. A cluster chosen directly asks only when it would
 * replace direct rows of its members (A4), in one sentence. Render `questionDialog` once.
 */
export default function useClusterAssignmentQuestion() {
  const [pending, setPending] = React.useState<Pending | null>(null);

  const resolveTargets = React.useCallback(async (input: ClusterQuestionInput): Promise<ClusterQuestionOutcome> => {
    const targets: string[] = [];
    const ask = (question: Omit<Pending, 'resolve'>) => new Promise<string | null>((resolve) => {
      setPending({ ...question, resolve });
    }).finally(() => setPending(null));
    const membersInService = async (clusterId: string) =>
      ((await api.get<{ items: AssetRef[] }>(`/assets/${clusterId}/members`)).data?.items ?? [])
        .filter((member) => member.status !== 'retired');
    const holding = (memberId: string) => input.rows.some((row) => row.asset_id === memberId && row.role === input.role);
    for (const assetId of input.assetIds) {
      const clusters = ((await api.get<{ items: AssetRef[] }>(`/assets/${assetId}/clusters`)).data?.items ?? [])
        .filter((cluster) => cluster.status !== 'retired');
      if (clusters.length === 0) {
        // A cluster chosen directly takes the place of its members' identical rows: said first.
        const asset = (await api.get<AssetRef>(`/assets/${assetId}`)).data;
        const absorbed = asset?.is_cluster && asset.status !== 'retired'
          ? (await membersInService(assetId)).filter((member) => holding(member.id)).map((member) => member.name)
          : [];
        if (absorbed.length > 0) {
          const choice = { id: assetId, name: asset.name, count: 0, absorbed };
          if ((await ask({ server: asset.name, subject: input.subject, clusters: [choice], direct: true })) === null) return { status: 'cancelled' };
        }
        targets.push(assetId);
        continue;
      }
      if (input.movingFrom && clusters.some((cluster) => cluster.id === input.movingFrom)) {
        targets.push(assetId);
        continue;
      }
      const choices: ClusterChoice[] = [];
      let server = '';
      let carrying: AssetRef | null = null;
      for (const cluster of clusters) {
        const members = await membersInService(cluster.id);
        const self = members.find((member) => member.id === assetId);
        // A retired server inherits nothing: its cluster is no choice for it, and refuses nothing.
        if (!self) continue;
        server = self.name;
        if (!carrying && input.rows.some((row) => row.asset_id === cluster.id && row.role === input.role)) carrying = cluster;
        choices.push({
          id: cluster.id,
          name: cluster.name,
          count: members.length,
          absorbed: members
            .filter((member) => member.id !== assetId && holding(member.id))
            .map((member) => member.name),
        });
      }
      if (carrying) return { status: 'inherited', cluster: carrying.name };
      if (choices.length === 0) {
        targets.push(assetId);
        continue;
      }
      const answer = await ask({ server, subject: input.subject, clusters: choices });
      if (answer === null) return { status: 'cancelled' };
      targets.push(answer === SERVER_ONLY ? assetId : answer);
    }
    return { status: 'ok', targets: Array.from(new Set(targets)) };
  }, []);

  const questionDialog = pending ? <QuestionDialog key={`${pending.server}|${pending.clusters.map((c) => c.id).join(',')}`} pending={pending} /> : null;
  return { resolveTargets, questionDialog };
}
