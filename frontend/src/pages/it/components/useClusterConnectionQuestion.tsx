import React from 'react';
import { Box, Button, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog } from '../../../components/design';
import type { ServerOption } from '../../../components/fields/serverOptionRender';

type AssetRef = { id: string; name: string; status?: string };

type ClusterChoice = { id: string; name: string; count: number };

type Pending = {
  /** The chosen server, as the sentence names it. */
  server: string;
  clusters: ClusterChoice[];
  resolve: (answer: string | null) => void;
};

const SERVER_ONLY = '__server_only__';

function QuestionDialog({ pending }: { pending: Pending }) {
  const { t } = useTranslation('it');
  const [selected, setSelected] = React.useState(pending.clusters[0].id);
  const several = pending.clusters.length > 1;
  const cluster = pending.clusters.find((candidate) => candidate.id === selected) ?? pending.clusters[0];
  return (
    <KanapDialog
      open
      title={t('components.clusterConnection.title')}
      onClose={() => pending.resolve(null)}
      onSave={() => pending.resolve(cluster.id)}
      saveLabel={t('components.clusterConnection.connectToCluster')}
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
            : t('components.clusterConnection.inCluster', {
              server: pending.server,
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
 * The question asked when a server that belongs to a cluster is chosen on a connection: connect the
 * cluster, whose members all carry the line, or this server only. A cluster chosen directly needs no
 * question. `others` holds the assets already on the other side: a line that already reaches the
 * cluster, or another member of it, needs no question either (the server absorbs, or the line is a
 * replication between nodes). Render `questionDialog` once.
 */
export default function useClusterConnectionQuestion() {
  const [pending, setPending] = React.useState<Pending | null>(null);

  const choose = React.useCallback(async (picked: ServerOption, others: string[]): Promise<ServerOption | null> => {
    if (picked.is_cluster) return picked;
    const clusters = ((await api.get<{ items: AssetRef[] }>(`/assets/${picked.id}/clusters`)).data?.items ?? [])
      .filter((cluster) => cluster.status !== 'retired');
    if (clusters.length === 0) return picked;
    const choices: ClusterChoice[] = [];
    for (const cluster of clusters) {
      if (others.includes(cluster.id)) return picked;
      const members = ((await api.get<{ items: AssetRef[] }>(`/assets/${cluster.id}/members`)).data?.items ?? [])
        .filter((member) => member.status !== 'retired');
      // A retired server inherits nothing: its cluster is no choice for it.
      if (!members.some((member) => member.id === picked.id)) continue;
      if (others.some((id) => id !== picked.id && members.some((member) => member.id === id))) return picked;
      choices.push({ id: cluster.id, name: cluster.name, count: members.length });
    }
    if (choices.length === 0) return picked;

    const answer = await new Promise<string | null>((resolve) => {
      setPending({ server: picked.name, clusters: choices, resolve });
    }).finally(() => setPending(null));
    if (answer === null) return null;
    if (answer === SERVER_ONLY) return picked;

    const cluster = choices.find((choice) => choice.id === answer) ?? choices[0];
    try {
      const asset = (await api.get<ServerOption>(`/assets/${cluster.id}`)).data;
      if (asset && asset.id) return asset;
    } catch {
      // The choice is enough to write the line: the asset itself only refreshes the picker.
    }
    return { id: cluster.id, name: cluster.name } as ServerOption;
  }, []);

  const questionDialog = pending
    ? <QuestionDialog key={`${pending.server}|${pending.clusters.map((cluster) => cluster.id).join(',')}`} pending={pending} />
    : null;
  return { choose, questionDialog };
}
