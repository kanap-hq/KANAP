import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';

type Ref = { id: string; name: string };
type ImpactAsset = { id: string; reference: string | null; name: string; kind: string; depth: number; relation: 'contains' | 'depends_on' | null; via: Ref[] };
type ImpactCluster = { id: string; reference: string | null; name: string; state: 'degraded' | 'down'; members: number; fallen_members: number; via: Ref[] };
type ImpactApplication = { id: string; reference: string | null; name: string; criticality: string | null; environment: string; via: Ref[] };
type ImpactTechnology = { id: string; reference: string; name: string; versions: string[]; via: Ref[] };
type ImpactProcess = { id: string; name: string; via: Ref[] };

/** `GET /assets/:id/impact` (doc/api-reference.md, "Impact"). */
export type AssetImpact = {
  asset: { id: string; reference: string | null; name: string };
  assets: ImpactAsset[];
  clusters: ImpactCluster[];
  applications: ImpactApplication[] | null;
  technologies: ImpactTechnology[];
  processes: ImpactProcess[] | null;
};

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
  const { labelFor } = useItOpsEnumOptions();
  const { data: classification } = useApplicationClassificationCatalog();
  const { data, isError, isSuccess } = useQuery({
    queryKey: ['asset-impact', assetId, version],
    queryFn: async () => (await api.get<AssetImpact>(`/assets/${assetId}/impact`)).data,
    enabled: !!assetId,
  });

  const k = (key: string) => `workspace.asset.impact.${key}`;
  const names = (refs: Ref[]) => refs.map((ref) => (ref.id === assetId ? t(k('via.thisServer')) : ref.name)).join(', ');
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
  const down = data.clusters.filter((row) => row.state === 'down').length;
  const degraded = data.clusters.length - down;
  const summary = [
    applications.length > 0 && t(k('summary.applications'), { count: new Set(applications.map((row) => row.id)).size }),
    assets.length > 0 && t(k('summary.assets'), { count: assets.length }),
    down > 0 && t(k('summary.clustersDown'), { count: down }),
    degraded > 0 && t(k('summary.clustersDegraded'), { count: degraded }),
    data.technologies.length > 0 && t(k('summary.technologies'), { count: data.technologies.length }),
    processes.length > 0 && t(k('summary.processes'), { count: processes.length }),
  ].filter(Boolean) as string[];

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
    { key: 'environment', header: t(k('columns.environment')), width: 110, render: (row) => environment(row.environment) },
    { key: 'criticality', header: t(k('columns.criticality')), width: 130, render: (row) => criticality(row.criticality) },
    { key: 'via', header: t(k('columns.via')), width: 200, render: (row) => <span title={names(row.via)}>{t(k('via.on'), { name: names(row.via) })}</span> },
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
      render: (row) => (row.state === 'down'
        ? t(k('state.down'))
        : t(k('state.degraded'), { fallen: row.fallen_members, members: row.members })),
    },
    { key: 'via', header: t(k('columns.via')), width: 200, render: (row) => names(row.via) },
  ];
  const technologyColumns: Array<RelationsColumn<ImpactTechnology>> = [
    { key: 'ref', header: t(k('columns.reference')), width: 72, render: (row) => <RelationRef>{row.reference}</RelationRef> },
    { key: 'name', header: t(k('columns.name')), render: (row) => row.name },
    { key: 'versions', header: t(k('columns.versions')), width: 130, render: (row) => row.versions.join(', ') },
    { key: 'via', header: t(k('columns.via')), width: 200, render: (row) => <span title={names(row.via)}>{t(k('via.on'), { name: names(row.via) })}</span> },
  ];
  const processColumns: Array<RelationsColumn<ImpactProcess>> = [
    { key: 'name', header: t(k('columns.name')), render: (row) => row.name },
    { key: 'via', header: t(k('columns.via')), width: 280, render: (row) => <span title={names(row.via)}>{names(row.via)}</span> },
  ];

  return (
    <Box component="section" aria-label={t(k('title'))}>
      <Title>{t(k('title'))}</Title>
      {summary.length === 0 ? (
        <RelationsEmpty>{t(k('empty'))}</RelationsEmpty>
      ) : (
        <Stack spacing={2.5}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{summary.join(' · ')}</Typography>
          {applications.length > 0 && (
            <RelationsSection title={t(k('sections.applications'))} count={applications.length}>
              <RelationsTable
                ariaLabel={t(k('sections.applications'))}
                columns={applicationColumns}
                rows={applications}
                rowKey={(row) => `${row.id}|${row.environment}`}
                rowHref={(row) => `/it/applications/${row.id}/overview`}
              />
            </RelationsSection>
          )}
          {assets.length > 0 && (
            <RelationsSection title={t(k('sections.assets'))} count={assets.length}>
              <RelationsTable
                ariaLabel={t(k('sections.assets'))}
                columns={assetColumns}
                rows={assets}
                rowKey={(row) => row.id}
                rowHref={(row) => `/it/assets/${row.id}/overview`}
              />
            </RelationsSection>
          )}
          {data.clusters.length > 0 && (
            <RelationsSection title={t(k('sections.clusters'))} count={data.clusters.length}>
              <RelationsTable
                ariaLabel={t(k('sections.clusters'))}
                columns={clusterColumns}
                rows={data.clusters}
                rowKey={(row) => row.id}
                rowHref={(row) => `/it/assets/${row.id}/overview`}
              />
            </RelationsSection>
          )}
          {data.technologies.length > 0 && (
            <RelationsSection title={t(k('sections.technologies'))} count={data.technologies.length}>
              <RelationsTable
                ariaLabel={t(k('sections.technologies'))}
                columns={technologyColumns}
                rows={data.technologies}
                rowKey={(row) => row.id}
                rowHref={(row) => `/it/technologies/${row.id}`}
              />
            </RelationsSection>
          )}
          {processes.length > 0 && (
            <RelationsSection title={t(k('sections.processes'))} count={processes.length}>
              <RelationsTable
                ariaLabel={t(k('sections.processes'))}
                columns={processColumns}
                rows={processes}
                rowKey={(row) => row.id}
                rowHref={(row) => `/master-data/business-processes/${row.id}`}
              />
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
