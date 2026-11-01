import React from 'react';
import { Alert, Box, Stack } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { screenLanguage } from '../../../components/csv/readings';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { downloadBlob, extractFilenameFromDisposition } from '../../../utils/downloadBlob';
import ExportFormatButton from '../../../components/csv/ExportFormatButton';
import type { ExportFormat } from '../../../components/csv/exportFormat';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import RelationAddPicker, { type RelationOption } from '../../../components/workspace/RelationAddPicker';
import { invalidateTechnologyLinks } from '../components/technologyLinkQueries';
import TechnologyVersionPicker, { type VersionChoice, type VersionOption } from '../components/TechnologyVersionPicker';

/** One row of `GET /technologies/:id/applications` (doc/api-reference.md, "Applications"). */
export type TechnologyApplicationRow = {
  kind: 'hosted' | 'declared';
  link_id: string | null;
  application_id: string;
  application_name: string | null;
  application_reference: string | null;
  criticality: string | null;
  external_facing: boolean;
  it_owner_names: string[];
  environment: string | null;
  asset_id: string | null;
  asset_name: string | null;
  via_asset_id: string | null;
  via_asset_name: string | null;
  technology_version_id: string | null;
  version_label: string | null;
};

/** `items` is null for a user who cannot read applications. */
export type TechnologyApplicationsData = { items: TechnologyApplicationRow[] | null };

export const technologyApplicationsKey = (id: string) => ['technology-applications', id] as const;

/** The tab badge: distinct applications, hosted or declared. */
export const countApplications = (rows: TechnologyApplicationRow[]) => new Set(rows.map((row) => row.application_id)).size;

const PAGE = 30;

const camel = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** What an add holds so far: the applications ticked, then their version. */
type Adding =
  | { step: 'applications'; anchor: HTMLElement }
  | { step: 'version'; anchor: HTMLElement; applications: RelationOption[] };

type Props = {
  technologyId: string;
  technologyReference: string;
  versions: VersionOption[];
  canManage: boolean;
};

/**
 * The applications of a technology (lot T1b): hosted on a server that carries it (deduced, per
 * environment and server, not removable) and declared by the application (removable, with a
 * version to change in place). Managers declare several applications at once, then their version,
 * as the Servers tab adds a server then its version; the rows export to CSV. Without the right to
 * read applications, one line says so.
 */
export default function TechnologyApplicationsTab({ technologyId, technologyReference, versions, canManage }: Props) {
  const { t, i18n } = useTranslation(['it', 'common']);
  const queryClient = useQueryClient();
  const { data: catalog } = useApplicationClassificationCatalog();
  const key = technologyApplicationsKey(technologyId);
  const [adding, setAdding] = React.useState<Adding | null>(null);
  const [editingVersion, setEditingVersion] = React.useState<{ anchor: HTMLElement; row: TechnologyApplicationRow } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<TechnologyApplicationsData>(`/technologies/${technologyId}/applications`)).data,
  });

  const refresh = React.useCallback(async () => {
    await invalidateTechnologyLinks(queryClient);
  }, [queryClient]);

  const failed = (e: unknown) => setError(getApiErrorMessage(e, t, t('workspace.technology.applications.saveFailed')));

  const addMany = async (applications: RelationOption[], choice: VersionChoice) => {
    setError(null);
    try {
      await api.post(`/technologies/${technologyId}/applications`, { application_ids: applications.map((option) => option.id), ...choice });
    } catch (e) {
      failed(e);
    }
    await refresh();
  };

  const changeVersion = async (row: TechnologyApplicationRow, choice: object) => {
    setError(null);
    try {
      await api.patch(`/technologies/${technologyId}/application-links/${row.link_id}`, choice);
    } catch (e) {
      failed(e);
    }
    await refresh();
  };

  const remove = async (row: TechnologyApplicationRow) => {
    setError(null);
    const previous = queryClient.getQueryData<TechnologyApplicationsData>(key);
    queryClient.setQueryData<TechnologyApplicationsData>(key, (prev) => (prev?.items
      ? { ...prev, items: prev.items.filter((item) => !(item.kind === 'declared' && item.application_id === row.application_id)) }
      : prev));
    try {
      await api.delete(`/technologies/${technologyId}/applications/${row.application_id}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(key, previous);
      failed(e);
      return;
    }
    await refresh();
  };

  const exportFile = async (format: ExportFormat) => {
    setError(null);
    try {
      const res = await api.get<Blob>(`/technologies/${technologyId}/applications/export`, {
        params: { language: screenLanguage(i18n.resolvedLanguage || i18n.language), format },
        responseType: 'blob',
      });
      const filename = extractFilenameFromDisposition(res.headers?.['content-disposition']) || `${technologyReference}_applications.${format}`;
      downloadBlob(res.data instanceof Blob ? res.data : new Blob([res.data]), filename);
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('workspace.technology.applications.exportFailed')));
    }
  };

  const search = React.useCallback(async (q: string, signal?: AbortSignal): Promise<RelationOption[]> => {
    const res = await api.get<{ items: Array<{ id: string; name: string; sequential_id?: string | null }> }>('/applications', {
      params: { page: 1, limit: PAGE, sort: 'name:ASC', ...(q ? { q } : {}) },
      signal,
    });
    return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name, ref: row.sequential_id ?? null }));
  }, []);

  if (data && data.items === null) {
    return <RelationsEmpty>{t('workspace.technology.applications.noAccess')}</RelationsEmpty>;
  }

  const rows = data?.items ?? [];
  const dash = '—';
  const tertiary = (text: string, title?: string) => <Box component="span" title={title} sx={{ color: 'kanap.text.tertiary' }}>{text}</Box>;
  const criticality = (code: string | null) => (code
    ? catalog?.businessCriticalityLevels?.find((level) => level.code === code)?.label ?? t(`enums.criticality.${camel(code)}`, { defaultValue: code })
    : dash);
  const server = (row: TechnologyApplicationRow) => {
    if (row.kind === 'declared') return t('workspace.technology.applications.declared');
    const name = row.asset_name ?? dash;
    return row.via_asset_name ? t('workspace.technology.applications.viaHost', { server: name, host: row.via_asset_name }) : name;
  };
  const versionText = (row: TechnologyApplicationRow) => (row.version_label
    ? <span title={row.version_label}>{row.version_label}</span>
    : tertiary(dash, t('workspace.technology.versionPicker.unknown')));
  const editable = (row: TechnologyApplicationRow) => canManage && row.kind === 'declared' && !!row.link_id;
  const declaredApps = new Set(rows.filter((row) => row.kind === 'declared').map((row) => row.application_id));
  // The withdrawal takes every declared version of the application: one control, on its first declared row.
  const withdrawRows = new Set<TechnologyApplicationRow>();
  declaredApps.forEach((appId) => {
    const first = rows.find((row) => row.kind === 'declared' && row.application_id === appId);
    if (first) withdrawRows.add(first);
  });

  const columns: Array<RelationsColumn<TechnologyApplicationRow>> = [
    { key: 'ref', header: t('workspace.technology.applications.columns.ref'), width: 64, render: (row) => <RelationRef>{row.application_reference ?? dash}</RelationRef> },
    { key: 'name', header: t('workspace.technology.applications.columns.application'), render: (row) => <span title={row.application_name ?? undefined}>{row.application_name ?? dash}</span> },
    {
      key: 'environment', header: t('workspace.technology.applications.columns.environment'), width: 110, hideOrder: 4,
      render: (row) => (row.environment ? t(`enums.environment.${camel(row.environment)}`, { defaultValue: row.environment }) : dash),
    },
    { key: 'criticality', header: t('workspace.technology.applications.columns.criticality'), width: 100, render: (row) => criticality(row.criticality) },
    {
      key: 'external', header: t('workspace.technology.applications.columns.externalFacing'), width: 64, hideOrder: 2,
      render: (row) => (row.external_facing ? t('workspace.technology.applications.yes') : tertiary(dash)),
    },
    { key: 'server', header: t('workspace.technology.applications.columns.server'), width: 120, hideOrder: 3, render: (row) => <span title={server(row)}>{server(row)}</span> },
    {
      key: 'version', header: t('workspace.technology.applications.columns.version'), width: 64,
      render: (row) => (editable(row) ? (
        <Box
          component="button"
          type="button"
          aria-label={t('workspace.technology.applications.changeVersion', { name: row.application_name ?? '' })}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); setEditingVersion({ anchor: event.currentTarget, row }); }}
          onKeyDown={(event: React.KeyboardEvent) => event.stopPropagation()}
          // The whole cell opens the picker, as in the Servers tab: a click beside the label would open the application.
          sx={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
        >
          {versionText(row)}
        </Box>
      ) : versionText(row)),
    },
    {
      key: 'itOwner', header: t('workspace.technology.applications.columns.itOwner'), width: 140, hideOrder: 1,
      render: (row) => {
        const names = row.it_owner_names.join(', ');
        return names ? <span title={names}>{names}</span> : dash;
      },
    },
  ];
  const title = t('workspace.technology.applications.title');
  const searchLabel = t('workspace.technology.applications.search');

  return (
    <Stack spacing={1}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <RelationsSection
        title={title}
        count={data ? countApplications(rows) : undefined}
        actions={rows.length > 0 ? (
          <ExportFormatButton size="small" label={t('common:export.button')} onExport={exportFile} />
        ) : undefined}
        onAdd={canManage && data ? (anchor) => setAdding({ step: 'applications', anchor }) : undefined}
        adding={!!adding}
        addLabel={t('workspace.technology.applications.add')}
      >
        {adding?.step === 'applications' && (
          <RelationAddPicker
            anchorEl={adding.anchor}
            searchKey={`technology-applications-${technologyId}`}
            search={search}
            excludeIds={declaredApps}
            placeholder={searchLabel}
            ariaLabel={searchLabel}
            onPick={() => undefined}
            onClose={() => setAdding(null)}
            multiple={{
              label: (count) => t('workspace.technology.applications.addCount', { count }),
              onConfirm: async (applications) => {
                setAdding({ step: 'version', anchor: adding.anchor, applications });
                return null;
              },
            }}
          />
        )}
        {adding?.step === 'version' && (
          <TechnologyVersionPicker
            anchorEl={adding.anchor}
            versions={versions}
            onPick={(choice) => { const { applications } = adding; setAdding(null); void addMany(applications, choice); }}
            onClose={() => setAdding(null)}
          />
        )}
        {editingVersion && (
          <TechnologyVersionPicker
            anchorEl={editingVersion.anchor}
            align="right"
            versions={versions}
            current={editingVersion.row.technology_version_id}
            onPick={(choice) => { const { row } = editingVersion; setEditingVersion(null); void changeVersion(row, choice); }}
            onClose={() => setEditingVersion(null)}
          />
        )}
        {data && rows.length === 0 ? (
          <RelationsEmpty>{t('workspace.technology.applications.empty')}</RelationsEmpty>
        ) : rows.length > 0 ? (
          <RelationsTable
            ariaLabel={title}
            columns={columns}
            rows={rows}
            rowKey={(row) => `${row.kind}:${row.link_id ?? ''}:${row.application_id}:${row.environment ?? ''}:${row.asset_id ?? ''}:${row.via_asset_id ?? ''}:${row.technology_version_id ?? ''}`}
            rowHref={(row) => `/it/applications/${row.application_id}/overview`}
            onRemove={canManage ? (row) => { void remove(row); } : undefined}
            canRemove={(row) => withdrawRows.has(row)}
            removeLabel={(row) => t('workspace.technology.applications.remove', { name: row.application_name ?? '' })}
          />
        ) : null}
      </RelationsSection>
    </Stack>
  );
}
