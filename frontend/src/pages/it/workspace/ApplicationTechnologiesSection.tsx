import React from 'react';
import { Alert, Box } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { formatShortDate } from '../../../lib/dateFormat';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../../components/workspace/RelationsTable';
import RelationAddPicker from '../../../components/workspace/RelationAddPicker';
import { applicationRelationsKey, type ApplicationRelationsData, type TechnologyRow } from './ApplicationRelationsTab';

const PAGE = 30;

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * The technologies of an application, the same section the Relations tab used to show (lot T2a):
 * declared rows can be added and removed, hosted rows stay, with the server they come from.
 * One read of `GET /applications/:id/relations`, the same writes.
 */
export default function ApplicationTechnologiesSection({ id }: { id: string }) {
  const { t, i18n } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const { labelFor } = useItOpsEnumOptions();
  const queryClient = useQueryClient();
  const [adding, setAdding] = React.useState<HTMLElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const key = applicationRelationsKey(id);
  const lang = i18n.language;
  const canEdit = hasLevel('applications', 'manager') && hasLevel('infrastructure', 'manager');

  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<ApplicationRelationsData>(`/applications/${id}/relations`)).data,
  });

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [t]);

  const link = React.useCallback(async (targetId: string) => {
    setError(null);
    try {
      await api.post(`/applications/${id}/relations/technologies`, { id: targetId });
    } catch (e) {
      failed(e);
    }
    await refresh();
  }, [failed, id, refresh]);

  const unlink = React.useCallback(async (targetId: string) => {
    setError(null);
    const previous = queryClient.getQueryData<ApplicationRelationsData>(key);
    queryClient.setQueryData<ApplicationRelationsData>(key, (prev) => {
      if (!prev?.technologies) return prev;
      // A technology also hosted by a server stays, as hosted only.
      const technologies = prev.technologies
        .map((row) => (row.id === targetId ? { ...row, declared: false } : row))
        .filter((row) => row.declared || row.hosted);
      return { ...prev, technologies };
    });
    try {
      await api.delete(`/applications/${id}/relations/technologies/${targetId}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(key, previous);
      failed(e);
      return;
    }
    await refresh();
  }, [failed, id, key, queryClient, refresh]);

  const search = React.useCallback(async (q: string, signal?: AbortSignal) => {
    const res = await api.get<{ items: Array<{ id: string; name: string; reference: string | null; editor: string | null }> }>('/technologies/lookup', {
      params: { limit: PAGE, ...(q ? { q } : {}) },
      signal,
    });
    return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name, ref: row.reference, hint: row.editor }));
  }, []);

  if (data && data.technologies === null) return null;

  const rows = data?.technologies ?? [];
  const today = todayYmd();
  const dash = '—';
  const title = t('workspace.application.relations.sections.technologies');
  const familyLabel = (code: string | null) => (code ? labelFor('technologyFamily', code) || code : dash);
  const serverLabel = (via: TechnologyRow['via'][number]) => (via.host_name
    ? t('workspace.application.relations.viaHost', { server: via.asset_name ?? dash, host: via.host_name })
    : via.asset_name ?? dash);
  const technologyLink = (row: TechnologyRow) => (row.declared && row.hosted ? 'both' : row.declared ? 'declared' : 'hosted');
  const columns: Array<RelationsColumn<TechnologyRow>> = [
    { key: 'ref', header: t('workspace.application.relations.columns.ref'), width: 72, render: (row) => <RelationRef>{row.reference ?? dash}</RelationRef> },
    { key: 'name', header: t('workspace.application.relations.columns.name'), render: (row) => <span title={row.name ?? undefined}>{row.name ?? dash}</span> },
    { key: 'family', header: t('workspace.application.relations.columns.family'), width: 110, hideOrder: 3, render: (row) => familyLabel(row.family) },
    {
      key: 'version', header: t('workspace.application.relations.columns.version'), width: 72,
      render: (row) => (row.versions.length > 0
        ? <span title={row.versions.join(', ')}>{row.versions.join(', ')}</span>
        : <Box component="span" title={t('workspace.application.relations.versionUnknown')} sx={{ color: 'kanap.text.tertiary' }}>{dash}</Box>),
    },
    {
      key: 'link', header: t('workspace.application.relations.columns.link'), width: 120, hideOrder: 2,
      render: (row) => {
        const label = t(`workspace.application.relations.technologyLink.${technologyLink(row)}`);
        return <span title={label}>{label}</span>;
      },
    },
    {
      key: 'via', header: t('workspace.application.relations.columns.via'), width: 140, hideOrder: 1,
      render: (row) => {
        const servers = row.via.map(serverLabel).join(', ');
        return <span title={servers || undefined}>{servers}</span>;
      },
    },
    {
      key: 'supportEnd', header: t('workspace.application.relations.columns.supportEnd'), width: 100,
      render: (row) => {
        const ended = !!row.standard_support_end && row.standard_support_end < today;
        return (
          <Box component="span" sx={ended ? { color: 'kanap.orange' } : undefined}>
            {row.standard_support_end ? formatShortDate(row.standard_support_end, lang, { year: 'always' }) : dash}
          </Box>
        );
      },
    },
  ];
  const searchLabel = t('workspace.application.relations.search.technologies');

  return (
    <>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <RelationsSection
        title={title}
        count={data ? rows.length : undefined}
        onAdd={canEdit && data ? (anchor) => setAdding(anchor) : undefined}
        adding={!!adding}
        addLabel={t('workspace.application.relations.add')}
      >
        {adding && (
          <RelationAddPicker
            anchorEl={adding}
            searchKey={`application-technologies-${id}`}
            search={search}
            excludeIds={new Set(rows.filter((row) => row.declared).map((row) => row.id))}
            placeholder={searchLabel}
            ariaLabel={searchLabel}
            onPick={(option) => { setAdding(null); void link(option.id); }}
            onClose={() => setAdding(null)}
          />
        )}
        {rows.length === 0 ? (
          <RelationsEmpty>{t('workspace.application.relations.empty.technologies')}</RelationsEmpty>
        ) : (
          <RelationsTable
            ariaLabel={title}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/it/technologies/${row.reference ?? row.id}`}
            onRemove={canEdit ? (row) => { void unlink(row.id); } : undefined}
            removeLabel={(row) => t('workspace.application.relations.remove', { name: row.name ?? row.reference ?? '' })}
            canRemove={(row) => row.declared}
          />
        )}
      </RelationsSection>
    </>
  );
}
