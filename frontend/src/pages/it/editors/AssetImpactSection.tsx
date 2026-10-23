import React from 'react';
import { Box, Stack, Typography, useTheme } from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { StatusDot } from '../../../components/design';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import { ASSET_IMPACT_CLUSTER_COLORS, getDotColor } from '../../../utils/statusColors';

type Ref = { id: string; name: string };
type ImpactAsset = { id: string; reference: string | null; name: string; kind: string; depth: number; relation: 'contains' | 'depends_on' | null; via: Ref[] };
type ImpactCluster = { id: string; reference: string | null; name: string; state: 'degraded' | 'down'; members: number; fallen_members: number; via: Ref[]; via_total: number };
type ImpactApplication = { id: string; reference: string | null; name: string; criticality: string | null; environments: string[]; via: Ref[]; via_total: number };
type ImpactTechnology = { id: string; reference: string; name: string; versions: string[]; via: Ref[]; via_total: number };
type ImpactProcess = { id: string; name: string; via: Ref[]; via_total: number };

/** `GET /assets/:id/impact` (doc/api-reference.md, "Impact"). */
export type AssetImpact = {
  asset: { id: string; reference: string | null; name: string };
  assets: ImpactAsset[];
  clusters: ImpactCluster[];
  applications: ImpactApplication[] | null;
  technologies: ImpactTechnology[];
  processes: ImpactProcess[] | null;
  /** Full counts behind the lists, which the server caps; `assets` leaves out the server. */
  totals: { assets: number; applications: number; clusters: number; technologies: number; processes: number };
};

/** Rows shown per table; the rest is counted on one line under it. */
export const IMPACT_ROWS_SHOWN = 50;

type Props = {
  assetId: string;
};

const camel = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * "If this server goes down" (lot T5): what falls with the asset, in dense read-only tables. Empty
 * tables are left out; when nothing else falls, one tertiary line says so.
 */
export default function AssetImpactSection({ assetId }: Props) {
  const { t } = useTranslation('it');
  const theme = useTheme();
  const { labelFor } = useItOpsEnumOptions();
  const { data: classification } = useApplicationClassificationCatalog();
  const { data, isError, isSuccess } = useQuery({
    queryKey: ['asset-impact', assetId],
    queryFn: async () => (await api.get<AssetImpact>(`/assets/${assetId}/impact`)).data,
    enabled: !!assetId,
    // Keep the section on screen while it is read again after a save (the callers invalidate the key).
    placeholderData: keepPreviousData,
  });

  const k = (key: string) => `workspace.asset.impact.${key}`;
  /**
   * The names of a capped `via`, then how many the server left out. When the server itself is in
   * the list, it comes first through a whole-sentence key, so each language words it right.
   * `prefix` adds "On": the sentence then reads "On this server, VM-01".
   */
  const viaNames = (row: { via: Ref[]; via_total: number }, prefix?: 'on') => {
    const self = row.via.some((ref) => ref.id === assetId);
    const others = [
      ...row.via.filter((ref) => ref.id !== assetId).map((ref) => ref.name),
      row.via_total > row.via.length ? t(k('more'), { count: row.via_total - row.via.length }) : '',
    ].filter(Boolean).join(', ');
    if (!self) return prefix ? t(k('via.on'), { name: others }) : others;
    if (prefix) return others ? t(k('via.onThisServerAnd'), { name: others }) : t(k('via.onThisServer'));
    return others ? t(k('via.thisServerAnd'), { name: others }) : t(k('via.thisServer'));
  };
  const environment = (value: string) => t(`enums.environment.${camel(value)}`, { defaultValue: value });
  const criticality = (value: string | null) =>
    value ? classification?.businessCriticalityLevels.find((item) => item.code === value)?.label ?? t(`enums.criticality.${camel(value)}`, { defaultValue: value }) : '';

  if (!isSuccess && !isError) return null;
  if (isError || !data) {
    return (
      <Box component="section" aria-label={t(k('title'))}>
        <Title>{t(k('title'))}</Title>
        <RelationsEmpty>{t(k('loadFailed'))}</RelationsEmpty>
      </Box>
    );
  }

  const assets = data.assets.filter((row) => row.depth > 0);
  const applications = data.applications ?? [];
  const processes = data.processes ?? [];
  const { totals } = data;
  // Clusters past the server's cap (over 200) count as degraded: the split is read from the list.
  const down = data.clusters.filter((row) => row.state === 'down').length;
  const degraded = totals.clusters - down;
  const summary = [
    totals.applications > 0 && t(k('summary.applications'), { count: totals.applications }),
    totals.assets > 0 && t(k('summary.assets'), { count: totals.assets }),
    down > 0 && t(k('summary.clustersDown'), { count: down }),
    degraded > 0 && t(k('summary.clustersDegraded'), { count: degraded }),
    totals.processes > 0 && t(k('summary.processes'), { count: totals.processes }),
  ].filter(Boolean) as string[];
  const shown = <T,>(rows: T[]) => rows.slice(0, IMPACT_ROWS_SHOWN);
  const more = (total: number) => (total > IMPACT_ROWS_SHOWN ? <RelationsEmpty>{t(k('more'), { count: total - IMPACT_ROWS_SHOWN })}</RelationsEmpty> : null);

  const assetVia = (row: ImpactAsset) => {
    const parent = row.via[row.via.length - 1];
    if (!parent) return '';
    if (parent.id === assetId) return t(k(row.relation === 'depends_on' ? 'via.dependsOnThisServer' : 'via.containsThisServer'));
    return t(k(row.relation === 'depends_on' ? 'via.dependsOn' : 'via.contains'), { name: parent.name });
  };
  const path = (row: ImpactAsset) => [...row.via.map((ref) => ref.name), row.name].join(' › ');

  const applicationColumns: Array<RelationsColumn<ImpactApplication>> = [
    { key: 'ref', header: t(k('columns.reference')), width: 72, render: (row) => <RelationRef>{row.reference}</RelationRef> },
    { key: 'name', header: t(k('columns.name')), render: (row) => row.name },
    { key: 'environment', header: t(k('columns.environment')), width: 130, hideOrder: 2, render: (row) => row.environments.map(environment).join(', ') },
    { key: 'criticality', header: t(k('columns.criticality')), width: 130, render: (row) => criticality(row.criticality) },
    { key: 'via', header: t(k('columns.via')), width: 200, hideOrder: 1, render: (row) => <span title={viaNames(row)}>{viaNames(row, 'on')}</span> },
  ];
  const assetColumns: Array<RelationsColumn<ImpactAsset>> = [
    { key: 'ref', header: t(k('columns.reference')), width: 72, render: (row) => <RelationRef>{row.reference}</RelationRef> },
    { key: 'name', header: t(k('columns.name')), render: (row) => row.name },
    { key: 'type', header: t(k('columns.type')), width: 130, render: (row) => labelFor('serverKind', row.kind) || row.kind },
    { key: 'via', header: t(k('columns.via')), width: 240, hideOrder: 1, render: (row) => <span title={path(row)}>{assetVia(row)}</span> },
  ];
  const clusterColumns: Array<RelationsColumn<ImpactCluster>> = [
    { key: 'ref', header: t(k('columns.reference')), width: 72, render: (row) => <RelationRef>{row.reference}</RelationRef> },
    { key: 'name', header: t(k('columns.name')), render: (row) => row.name },
    {
      key: 'state', header: t(k('columns.state')), width: 280,
      render: (row) => (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <StatusDot color={getDotColor(ASSET_IMPACT_CLUSTER_COLORS[row.state], theme.palette.mode)} />
          {row.state === 'down' ? t(k('state.down')) : t(k('state.degraded'), { count: row.fallen_members, members: row.members })}
        </Box>
      ),
    },
    { key: 'via', header: t(k('columns.via')), width: 200, hideOrder: 1, render: (row) => viaNames(row) },
  ];
  const processColumns: Array<RelationsColumn<ImpactProcess>> = [
    { key: 'name', header: t(k('columns.name')), render: (row) => row.name },
    { key: 'via', header: t(k('columns.via')), width: 280, render: (row) => <span title={viaNames(row)}>{viaNames(row)}</span> },
  ];

  return (
    <Box component="section" aria-label={t(k('title'))}>
      <Title>{t(k('title'))}</Title>
      {summary.length === 0 ? (
        <RelationsEmpty>{t(k(data.applications === null ? 'emptyInfrastructure' : 'empty'))}</RelationsEmpty>
      ) : (
        <Stack spacing={2.5}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{summary.join(' · ')}</Typography>
          {applications.length > 0 && (
            <RelationsSection title={t(k('sections.applications'))} count={totals.applications}>
              <RelationsTable
                ariaLabel={t(k('sections.applications'))}
                columns={applicationColumns}
                rows={shown(applications)}
                rowKey={(row) => row.id}
                rowHref={(row) => `/it/applications/${row.id}/overview`}
              />
              {more(totals.applications)}
            </RelationsSection>
          )}
          {assets.length > 0 && (
            <RelationsSection title={t(k('sections.assets'))} count={totals.assets}>
              <RelationsTable
                ariaLabel={t(k('sections.assets'))}
                columns={assetColumns}
                rows={shown(assets)}
                rowKey={(row) => row.id}
                rowHref={(row) => `/it/assets/${row.id}/overview`}
              />
              {more(totals.assets)}
            </RelationsSection>
          )}
          {data.clusters.length > 0 && (
            <RelationsSection title={t(k('sections.clusters'))} count={totals.clusters}>
              <RelationsTable
                ariaLabel={t(k('sections.clusters'))}
                columns={clusterColumns}
                rows={shown(data.clusters)}
                rowKey={(row) => row.id}
                rowHref={(row) => `/it/assets/${row.id}/overview`}
              />
              {more(totals.clusters)}
            </RelationsSection>
          )}
          {processes.length > 0 && (
            <RelationsSection title={t(k('sections.processes'))} count={totals.processes}>
              <RelationsTable
                ariaLabel={t(k('sections.processes'))}
                columns={processColumns}
                rows={shown(processes)}
                rowKey={(row) => row.id}
                rowHref={(row) => `/master-data/business-processes/${row.id}`}
              />
              {more(totals.processes)}
            </RelationsSection>
          )}
        </Stack>
      )}
    </Box>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="h2" sx={{ m: 0, mb: 0.75, fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'kanap.text.primary' }}>
      {children}
    </Typography>
  );
}
