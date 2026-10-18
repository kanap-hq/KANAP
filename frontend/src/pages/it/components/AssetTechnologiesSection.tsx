import React from 'react';
import { Alert, Box, IconButton, Stack, Tooltip, useTheme } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { useLocale } from '../../../i18n/useLocale';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { formatSupportDate, supportStateColor, supportStateOf } from '../../../utils/supportState';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import RelationAddPicker, { type RelationOption } from '../../../components/workspace/RelationAddPicker';
import { invalidateTechnologyLinks } from './technologyLinkQueries';
import TechnologyVersionPicker, { type VersionChoice, type VersionOption } from './TechnologyVersionPicker';

/** One row of `GET /assets/:id/technologies` (doc/api-reference.md, "From the asset's side"). */
export type AssetTechnologyRow = {
  kind: 'installed' | 'carried';
  removable: boolean;
  link_id: string | null;
  technology_id: string;
  technology_name: string | null;
  technology_reference: string | null;
  family: string | null;
  technology_version_id: string | null;
  version_label: string | null;
  via_asset_id: string | null;
  via_asset_name: string | null;
  /** The server's operating system. The list already puts that link first. */
  is_operating_system?: boolean;
  standard_support_end?: string | null;
  extended_support_end?: string | null;
};

export const assetTechnologiesKey = (assetId: string) => ['asset-technologies', assetId] as const;

const PAGE = 30;

type Props = {
  assetId: string;
  canManage: boolean;
  /** The section title of the page around it (the asset's Technical tab), so it reads like its neighbours. */
  heading?: (title: string) => React.ReactNode;
};

/**
 * What a server carries: technologies installed on it (removable) and carried to it through the
 * server it runs on or its cluster (with that server, not removable). The marked operating system
 * leads the list. Managers add a technology then its version, and change a version from the
 * version or from Edit. Each change is saved at once. One line when empty.
 */
export default function AssetTechnologiesSection({ assetId, canManage, heading }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const theme = useTheme();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const key = assetTechnologiesKey(assetId);
  const [adding, setAdding] = React.useState<{ anchor: HTMLElement; technology: RelationOption | null } | null>(null);
  const [versionEdit, setVersionEdit] = React.useState<{ row: AssetTechnologyRow; anchor: HTMLElement } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ items: AssetTechnologyRow[] }>(`/assets/${assetId}/technologies`)).data,
    enabled: !!assetId,
  });
  const pickedId = adding?.technology?.id ?? versionEdit?.row.technology_id ?? null;
  const { data: versions } = useQuery({
    queryKey: ['technology-versions', pickedId],
    queryFn: async () => (await api.get<{ items: VersionOption[] }>(`/technologies/${pickedId}/versions`)).data.items,
    enabled: !!pickedId,
  });

  const refresh = React.useCallback(async () => {
    await invalidateTechnologyLinks(queryClient);
  }, [queryClient]);

  const failed = (e: unknown) => setError(getApiErrorMessage(e, t, t('workspace.asset.technologies.saveFailed')));

  const add = async (technology: RelationOption, choice: VersionChoice) => {
    setError(null);
    try {
      await api.post(`/assets/${assetId}/technologies`, { technology_id: technology.id, ...choice });
    } catch (e) {
      failed(e);
    }
    await refresh();
  };

  const changeVersion = async (row: AssetTechnologyRow, choice: VersionChoice) => {
    if (!row.link_id) return;
    setError(null);
    try {
      await api.patch(`/technologies/${row.technology_id}/assets/${row.link_id}`, choice);
    } catch (e) {
      failed(e);
    }
    await refresh();
  };

  const openVersion = (row: AssetTechnologyRow, anchor: HTMLElement) => {
    setVersionEdit({ row, anchor });
  };

  const remove = async (row: AssetTechnologyRow) => {
    setError(null);
    const previous = queryClient.getQueryData<{ items: AssetTechnologyRow[] }>(key);
    queryClient.setQueryData<{ items: AssetTechnologyRow[] }>(key, (prev) => (prev ? { items: prev.items.filter((item) => item.link_id !== row.link_id) } : prev));
    try {
      await api.delete(`/assets/${assetId}/technologies/${row.link_id}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(key, previous);
      failed(e);
      return;
    }
    await refresh();
  };

  const search = React.useCallback(async (q: string, signal?: AbortSignal): Promise<RelationOption[]> => {
    const res = await api.get<{ items: Array<{ id: string; name: string; reference: string | null; editor: string | null }> }>('/technologies/lookup', {
      params: { limit: PAGE, ...(q ? { q } : {}) },
      signal,
    });
    return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name, ref: row.reference, hint: row.editor }));
  }, []);

  const rows = data?.items ?? [];
  const dash = '—';
  const columns: Array<RelationsColumn<AssetTechnologyRow>> = [
    { key: 'ref', header: t('workspace.asset.technologies.columns.ref'), width: 64, render: (row) => <RelationRef>{row.technology_reference ?? dash}</RelationRef> },
    { key: 'name', header: t('workspace.asset.technologies.columns.name'), render: (row) => (
      <Box component="span" sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
        <Box component="span" title={row.technology_name ?? undefined} sx={{ flexShrink: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.technology_name ?? dash}
        </Box>
        {row.is_operating_system && (
          // In a narrow table the mark gives way before the name.
          <Box component="span" sx={{ color: 'kanap.text.tertiary', fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t('workspace.asset.technologies.operatingSystem')}
          </Box>
        )}
      </Box>
    ) },
    { key: 'family', header: t('workspace.asset.technologies.columns.family'), width: 180,
      render: (row) => {
        const family = row.family ? labelFor('technologyFamily', row.family) || row.family : dash;
        return <span title={family}>{family}</span>;
      },
    },
    {
      key: 'version', header: t('workspace.asset.technologies.columns.version'), width: 88,
      render: (row) => {
        const standardEnd = row.standard_support_end ?? null;
        const extendedEnd = row.extended_support_end ?? null;
        const color = supportStateColor(supportStateOf(standardEnd, extendedEnd), theme);
        const hint = [
          standardEnd ? t('workspace.asset.technical.standardSupportEnds', { date: formatSupportDate(standardEnd, locale) }) : '',
          extendedEnd ? t('workspace.asset.technical.extendedSupportEnds', { date: formatSupportDate(extendedEnd, locale) }) : '',
        ].filter(Boolean).join(' / ');
        const title = hint || (row.version_label ? row.version_label : t('workspace.technology.versionPicker.unknown'));
        const label = row.version_label
          ? row.version_label
          : <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{dash}</Box>;
        const editable = canManage && row.kind === 'installed' && !!row.link_id;
        if (!editable) {
          return <Box component="span" title={title} sx={{ color }}>{label}</Box>;
        }
        return (
          <Box
            component="button"
            type="button"
            title={title}
            aria-label={t('workspace.asset.technologies.changeVersion', { name: row.technology_name ?? '' })}
            onClick={(event) => {
              event.stopPropagation();
              openVersion(row, event.currentTarget);
            }}
            sx={{
              all: 'unset',
              display: 'inline',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color,
              cursor: 'pointer',
            }}
          >
            {label}
          </Box>
        );
      },
    },
    {
      key: 'via', header: <span title={t('workspace.asset.technologies.columns.viaHint')}>{t('workspace.asset.technologies.columns.via')}</span>, width: 140,
      render: (row) => (row.via_asset_name ? <span title={row.via_asset_name}>{row.via_asset_name}</span> : null),
    },
  ];
  const title = t('workspace.asset.technologies.title');
  const searchLabel = t('workspace.asset.technologies.search');

  return (
    <Stack spacing={1}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <RelationsSection
        title={title}
        heading={heading?.(title)}
        count={data && rows.length > 0 ? rows.length : undefined}
        onAdd={canManage && data ? (anchor) => setAdding({ anchor, technology: null }) : undefined}
        adding={!!adding}
        addLabel={t('workspace.asset.technologies.add')}
      >
        {adding && !adding.technology && (
          <RelationAddPicker
            anchorEl={adding.anchor}
            searchKey={`asset-technologies-${assetId}`}
            search={search}
            excludeIds={new Set()}
            placeholder={searchLabel}
            ariaLabel={searchLabel}
            onPick={(technology) => setAdding({ anchor: adding.anchor, technology })}
            onClose={() => setAdding(null)}
          />
        )}
        {adding?.technology && (
          <TechnologyVersionPicker
            anchorEl={adding.anchor}
            versions={versions}
            onPick={(choice) => { const technology = adding.technology!; setAdding(null); void add(technology, choice); }}
            onClose={() => setAdding(null)}
          />
        )}
        {versionEdit && (
          <TechnologyVersionPicker
            anchorEl={versionEdit.anchor}
            versions={versions}
            current={versionEdit.row.technology_version_id}
            onPick={(choice) => { const row = versionEdit.row; setVersionEdit(null); void changeVersion(row, choice); }}
            onClose={() => setVersionEdit(null)}
          />
        )}
        {data && rows.length === 0 ? (
          <RelationsEmpty>{t('workspace.asset.technologies.empty')}</RelationsEmpty>
        ) : rows.length > 0 ? (
          <RelationsTable
            ariaLabel={title}
            // "Via" only when a row is deduced: a direct link has nothing there.
            columns={rows.some((row) => row.kind === 'carried') ? columns : columns.filter((column) => column.key !== 'via')}
            rows={rows}
            rowKey={(row) => `${row.kind}:${row.link_id ?? ''}:${row.technology_id}:${row.via_asset_id ?? ''}:${row.technology_version_id ?? ''}`}
            rowHref={(row) => `/it/technologies/${row.technology_reference ?? row.technology_id}`}
            onRemove={canManage ? (row) => { void remove(row); } : undefined}
            canRemove={(row) => row.removable && !!row.link_id}
            removeLabel={(row) => t('workspace.asset.technologies.remove', { name: row.technology_name ?? '' })}
            action={canManage ? {
              width: 32,
              render: (row) => (row.kind === 'installed' && row.link_id ? (
                <Tooltip title={t('workspace.asset.technologies.edit')} enterTouchDelay={0}>
                  <IconButton
                    size="small"
                    aria-label={t('workspace.asset.technologies.editNamed', { name: row.technology_name ?? '' })}
                    onClick={(event) => openVersion(row, event.currentTarget)}
                    sx={{ p: '2px', color: 'kanap.text.tertiary' }}
                  >
                    <EditOutlinedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              ) : null),
            } : undefined}
          />
        ) : null}
      </RelationsSection>
    </Stack>
  );
}
