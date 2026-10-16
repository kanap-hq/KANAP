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
  /** Bumped by the panel after it saved the asset's relations: the impact is read again. */
  version?: number;
};

const camel = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * "If this server goes down" (lot T5): what falls with the asset, in dense read-only tables. Empty
 * tables are left out; when nothing else falls, one tertiary line says so.
 */
export default function AssetImpactSection({ assetId, version = 0 }: Props) {
  const { t } = useTranslation('it');
  const theme = useTheme();
  const { labelFor } = useItOpsEnumOptions();
  const { data: classification } = useApplicationClassificationCatalog();
  const { data, isError, isSuccess } = useQuery({
    queryKey: ['asset-impact', assetId, version],
    queryFn: async () => (await api.get<AssetImpact>(`/assets/${assetId}/impact`)).data,
    enabled: !!assetId,
    // Keep the section on screen while it is read again after a save.
    placeholderData: keepPreviousData,
  });

  const k = (key: string) => `workspace.asset.impact.${key}`;
  const names = (refs: Ref[]) => refs.map((ref) => (ref.id === assetId ? t(k('via.thisServer')) : ref.name)).join(', ');
  /** The names of a capped `via`, then how many the server left out. */
  const viaNames = (row: { via: Ref[]; via_total: number }) =>
    [names(row.via), row.via_total > row.via.length ? t(k('more'), { count: row.via_total - row.via.length }) : ''].filter(Boolean).join(', ');
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
    totals.technologies > 0 && t(k('summary.technologies'), { count: totals.technologies }),
    totals.processes > 0 && t(k('summary.processes'), { count: totals.processes }),
  ].filter(Boolean) as string[];
  const shown = <T,>(rows: T[]) => rows.slice(0, IMPACT_ROWS_SHOWN);
  const more = (total: number) => (total > IMPACT_ROWS_SHOWN ? <RelationsEmpty>{t(k('more'), { count: total - IMPACT_ROWS_SHOWN })}</RelationsEmpty> : null);

  const assetVia = (row: ImpactAsset) => {
    const parent = row.via[row.via.length - 1];
    if (!parent) return '';
    const name = parent.id === assetId ? t(k('via.thisServer')) : parent.name;
    return t(k(row.relation === 'depends_on' ? 'via.dependsOn' : 'via.contains'), { name });
  };
  const path = (row: ImpactAsset) => [...row.via.map((ref) => ref.name), row.name].join(' › ');

  const applicationColumns: Array<RelationsColumn<ImpactApplication>> = [
    { key: 'ref', header: t(k('columns.reference')), width: 72, render: (row) => <RelationRef>{row.reference}</RelationRef> },
    { key: 'name', header: t(k('columns.name')), render: (row) => row.name },
    { key: 'environment', header: t(k('columns.environment')), width: 130, render: (row) => row.environments.map(environment).join(', ') },
    { key: 'criticality', header: t(k('columns.criticality')), width: 130, render: (row) => criticality(row.criticality) },
    { key: 'via', header: t(k('columns.via')), width: 200, render: (row) => <span title={viaNames(row)}>{t(k('via.on'), { name: viaNames(row) })}</span> },
  ];
  const assetColumns: Array<RelationsColumn<ImpactAsset>> = [
    { key: 'ref', header: t(k('columns.reference')), width: 72, render: (row) => <RelationRef>{row.reference}</RelationRef> },
    { key: 'name', header: t(k('columns.name')), render: (row) => row.name },
    { key: 'type', header: t(k('columns.type')), width: 130, render: (row) => labelFor('serverKind', row.kind) || row.kind },
    { key: 'via', header: t(k('columns.via')), width: 240, render: (row) => <span title={path(row)}>{assetVia(row)}</span> },
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
    { key: 'via', header: t(k('columns.via')), width: 200, render: (row) => viaNames(row) },
  ];
  const technologyColumns: Array<RelationsColumn<ImpactTechnology>> = [
    { key: 'ref', header: t(k('columns.reference')), width: 72, render: (row) => <RelationRef>{row.reference}</RelationRef> },
    { key: 'name', header: t(k('columns.name')), render: (row) => row.name },
    { key: 'versions', header: t(k('columns.versions')), width: 130, render: (row) => row.versions.join(', ') },
    { key: 'via', header: t(k('columns.via')), width: 200, render: (row) => <span title={viaNames(row)}>{t(k('via.on'), { name: viaNames(row) })}</span> },
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
          {data.technologies.length > 0 && (
            <RelationsSection title={t(k('sections.technologies'))} count={totals.technologies}>
              <RelationsTable
                ariaLabel={t(k('sections.technologies'))}
                columns={technologyColumns}
                rows={shown(data.technologies)}
                rowKey={(row) => row.id}
                rowHref={(row) => `/it/technologies/${row.id}`}
              />
              {more(totals.technologies)}
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
