import React from 'react';
import { Alert, Box, Stack, TextField } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { tableCellTextFieldSx } from '../../../theme/formSx';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import RelationAddPicker, { type RelationOption } from '../../../components/workspace/RelationAddPicker';
import TechnologyVersionPicker, { type VersionChoice, type VersionOption } from '../components/TechnologyVersionPicker';

/** One row of `GET /technologies/:id/assets` (doc/api-reference.md, "Servers"). */
export type TechnologyServerRow = {
  link_id: string | null;
  kind: 'installed' | 'carried';
  asset_id: string;
  asset_name: string | null;
  asset_reference: string | null;
  asset_status: string | null;
  environment: string | null;
  operating_system_label: string | null;
  via_asset_id: string | null;
  via_asset_name: string | null;
  technology_version_id: string | null;
  version_label: string | null;
  notes: string | null;
};

export const technologyServersKey = (id: string) => ['technology-servers', id] as const;

/** A link to a retired server stays listed, to be removed; it counts nowhere. */
export const isRetiredServer = (row: Pick<TechnologyServerRow, 'asset_status'>) => row.asset_status === 'retired';

/** The tab badge and the total: distinct servers in service, directly or through another server. */
export const countServers = (rows: TechnologyServerRow[]) => new Set(rows.filter((row) => !isRetiredServer(row)).map((row) => row.asset_id)).size;

/** Totals appear from this many rows on, as in the Relations tabs. */
const TOTALS_FROM = 2;
const PAGE = 30;

const camel = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

type Props = {
  technologyId: string;
  versions: VersionOption[];
  canManage: boolean;
};

type Adding = { anchor: HTMLElement; asset: RelationOption | null };

/**
 * The servers of a technology (lot T1b): installed on them (a direct link, with its version and
 * notes, removable) or carried to them through `contains` or a cluster (with the server it is
 * installed on, not removable). Managers add a server then its version, change the version and
 * the notes in place; each change is saved at once.
 */
export default function TechnologyServersTab({ technologyId, versions, canManage }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const queryClient = useQueryClient();
  const key = technologyServersKey(technologyId);
  const [adding, setAdding] = React.useState<Adding | null>(null);
  const [editingVersion, setEditingVersion] = React.useState<{ anchor: HTMLElement; row: TechnologyServerRow } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ items: TechnologyServerRow[] }>(`/technologies/${technologyId}/assets`)).data,
  });

  // The applications deduced through the servers and the versions' counters follow the links.
  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('technolog') });
  }, [queryClient]);

  const run = React.useCallback(async (call: () => Promise<unknown>) => {
    setError(null);
    try {
      await call();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('workspace.technology.servers.saveFailed')));
    }
    await refresh();
  }, [refresh, t]);

  const add = (asset: RelationOption, choice: VersionChoice) => run(() => api.post(`/technologies/${technologyId}/assets`, { asset_id: asset.id, ...choice }));
  const changeLink = (row: TechnologyServerRow, body: VersionChoice | { notes: string | null }) => run(() => api.patch(`/technologies/${technologyId}/assets/${row.link_id}`, body));
  const remove = async (row: TechnologyServerRow) => {
    const previous = queryClient.getQueryData<{ items: TechnologyServerRow[] }>(key);
    queryClient.setQueryData<{ items: TechnologyServerRow[] }>(key, (prev) => (prev ? { items: prev.items.filter((item) => item.link_id !== row.link_id) } : prev));
    setError(null);
    try {
      await api.delete(`/technologies/${technologyId}/assets/${row.link_id}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(key, previous);
      setError(getApiErrorMessage(e, t, t('workspace.technology.servers.saveFailed')));
      return;
    }
    await refresh();
  };

  const search = React.useCallback(async (q: string, signal?: AbortSignal): Promise<RelationOption[]> => {
    const res = await api.get<{ items: Array<{ id: string; name: string; asset_reference?: string | null; environment?: string | null }> }>('/assets', {
      params: { page: 1, limit: PAGE, sort: 'name:ASC', ...(q ? { q } : {}) },
      signal,
    });
    return (res.data?.items || []).map((row) => ({
      id: row.id,
      label: row.name,
      ref: row.asset_reference ?? null,
      hint: row.environment ? t(`enums.environment.${camel(row.environment)}`, { defaultValue: row.environment }) : null,
    }));
  }, [t]);

  const rows = data?.items ?? [];
  const dash = '—';
  const editable = (row: TechnologyServerRow) => canManage && row.kind === 'installed' && !!row.link_id;
  const muted = (row: TechnologyServerRow, node: React.ReactNode) => (
    isRetiredServer(row) ? <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{node}</Box> : node
  );
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const versionText = (row: TechnologyServerRow) => (row.version_label
    ? <span title={row.version_label}>{row.version_label}</span>
    : <Box component="span" title={t('workspace.technology.versionPicker.unknown')} sx={{ color: 'kanap.text.tertiary' }}>{dash}</Box>);

  const columns: Array<RelationsColumn<TechnologyServerRow>> = [
    { key: 'ref', header: t('workspace.technology.servers.columns.ref'), width: 72, render: (row) => <RelationRef>{row.asset_reference ?? dash}</RelationRef> },
    {
      key: 'name', header: t('workspace.technology.servers.columns.server'),
      render: (row) => (
        <span title={isRetiredServer(row) ? t('workspace.technology.servers.retired') : row.asset_name ?? undefined}>
          {row.asset_name ?? dash}
          {isRetiredServer(row) && ` (${t('workspace.technology.servers.retiredShort')})`}
        </span>
      ),
    },
    {
      key: 'environment', header: t('workspace.technology.servers.columns.environment'), width: 100,
      render: (row) => muted(row, row.environment ? t(`enums.environment.${camel(row.environment)}`, { defaultValue: row.environment }) : dash),
    },
    {
      key: 'os', header: t('workspace.technology.servers.columns.operatingSystem'), width: 150,
      render: (row) => muted(row, <span title={row.operating_system_label ?? undefined}>{row.operating_system_label ?? dash}</span>),
    },
    {
      key: 'version', header: t('workspace.technology.servers.columns.version'), width: 90,
      render: (row) => (editable(row) ? (
        <Box
          component="button"
          type="button"
          aria-label={t('workspace.technology.servers.changeVersion', { name: row.asset_name ?? '' })}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); setEditingVersion({ anchor: event.currentTarget, row }); }}
          onKeyDown={stop}
          sx={{ all: 'unset', cursor: 'pointer', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
        >
          {muted(row, versionText(row))}
        </Box>
      ) : muted(row, versionText(row))),
    },
    {
      key: 'via', header: t('workspace.technology.servers.columns.via'), width: 140,
      render: (row) => (row.via_asset_name ? <span title={row.via_asset_name}>{row.via_asset_name}</span> : null),
    },
    {
      key: 'notes', header: t('workspace.technology.servers.columns.notes'), width: 180,
      render: (row) => (editable(row) ? (
        <Box onClick={stop} onKeyDown={stop}>
          <TextField
            key={`${row.link_id}:${row.notes ?? ''}`}
            defaultValue={row.notes ?? ''}
            variant="standard"
            size="small"
            fullWidth
            placeholder={t('workspace.technology.servers.notesPlaceholder')}
            inputProps={{ 'aria-label': t('workspace.technology.servers.notesOf', { name: row.asset_name ?? '' }), maxLength: 2000 }}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next !== (row.notes ?? '')) void changeLink(row, { notes: next || null });
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
            sx={tableCellTextFieldSx}
          />
        </Box>
      ) : muted(row, <span title={row.notes ?? undefined}>{row.notes ?? ''}</span>)),
    },
  ];

  const totals = rows.length >= TOTALS_FROM
    ? [{ key: 'total', label: t('workspace.technology.servers.total'), cells: { name: t('workspace.technology.servers.serverCount', { count: countServers(rows) }) } }]
    : undefined;
  const title = t('workspace.technology.servers.title');
  const searchLabel = t('workspace.technology.servers.search');

  return (
    <Stack spacing={1}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <RelationsSection
        title={title}
        onAdd={canManage && data ? (anchor) => setAdding({ anchor, asset: null }) : undefined}
        adding={!!adding}
        addLabel={t('workspace.technology.servers.add')}
      >
        {adding && !adding.asset && (
          <RelationAddPicker
            anchorEl={adding.anchor}
            searchKey={`technology-servers-${technologyId}`}
            search={search}
            excludeIds={new Set()}
            placeholder={searchLabel}
            ariaLabel={searchLabel}
            onPick={(asset) => setAdding({ anchor: adding.anchor, asset })}
            onClose={() => setAdding(null)}
          />
        )}
        {adding?.asset && (
          <TechnologyVersionPicker
            anchorEl={adding.anchor}
            versions={versions}
            onPick={(choice) => { const asset = adding.asset!; setAdding(null); void add(asset, choice); }}
            onClose={() => setAdding(null)}
          />
        )}
        {editingVersion && (
          <TechnologyVersionPicker
            anchorEl={editingVersion.anchor}
            versions={versions}
            current={editingVersion.row.technology_version_id}
            onPick={(choice) => { const { row } = editingVersion; setEditingVersion(null); void changeLink(row, choice); }}
            onClose={() => setEditingVersion(null)}
          />
        )}
        {data && rows.length === 0 ? (
          <RelationsEmpty>{t('workspace.technology.servers.empty')}</RelationsEmpty>
        ) : rows.length > 0 ? (
          <RelationsTable
            ariaLabel={title}
            columns={columns}
            rows={rows}
            rowKey={(row) => `${row.kind}:${row.link_id ?? ''}:${row.asset_id}:${row.via_asset_id ?? ''}:${row.technology_version_id ?? ''}`}
            rowHref={(row) => `/it/assets/${row.asset_reference ?? row.asset_id}/overview`}
            rowMuted={isRetiredServer}
            onRemove={canManage ? (row) => { void remove(row); } : undefined}
            canRemove={(row) => row.kind === 'installed' && !!row.link_id}
            removeLabel={(row) => t('workspace.technology.servers.remove', { name: row.asset_name ?? '' })}
            totals={totals}
          />
        ) : null}
      </RelationsSection>
    </Stack>
  );
}
