import React from 'react';
import { Alert, Stack } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { RelationRef, RelationsEmpty, RelationsSection, RelationsTable, type RelationsColumn } from '../../components/workspace/RelationsTable';
import RelationAddPicker, { type RelationOption } from '../../components/workspace/RelationAddPicker';

type ApplicationRow = {
  id: string;
  name: string;
  reference: string | null;
  criticality: string | null;
  lifecycle: string | null;
  it_owner_names: string[];
};

const PAGE = 30;

export const businessProcessApplicationsKey = (id: string) => ['business-process-applications', id] as const;

/**
 * The applications of a business process (lot T2a), as a Relations section of lot R1: a dense
 * table that opens the application, an "Add" search and an unlink on hover, each saved at once.
 * Absent when the user cannot read applications (`items: null`).
 */
export default function BusinessProcessApplicationsSection({ id }: { id: string }) {
  const { t } = useTranslation(['master-data', 'common']);
  const { hasLevel } = useAuth();
  const canEdit = hasLevel('business_processes', 'manager');
  const queryClient = useQueryClient();
  const key = businessProcessApplicationsKey(id);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { data: catalog } = useApplicationClassificationCatalog();

  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ items: ApplicationRow[] | null }>(`/business-processes/${id}/applications`)).data,
  });

  const failed = (e: unknown) => setError(getApiErrorMessage(e, t, t('businessProcesses.applications.saveFailed')));

  const link = async (applicationId: string) => {
    setError(null);
    try {
      await api.post(`/business-processes/${id}/applications`, { application_id: applicationId });
    } catch (e) {
      failed(e);
    }
    await queryClient.invalidateQueries({ queryKey: key });
  };

  const unlink = async (applicationId: string) => {
    setError(null);
    const previous = queryClient.getQueryData<{ items: ApplicationRow[] | null }>(key);
    queryClient.setQueryData<{ items: ApplicationRow[] | null }>(key, (prev) => (
      prev?.items ? { items: prev.items.filter((row) => row.id !== applicationId) } : prev
    ));
    try {
      await api.delete(`/business-processes/${id}/applications/${applicationId}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(key, previous);
      failed(e);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: key });
  };

  const search = React.useCallback(async (q: string, signal?: AbortSignal): Promise<RelationOption[]> => {
    const res = await api.get<{ items: Array<{ id: string; name: string; sequential_id?: string | null }> }>('/applications', {
      params: { page: 1, limit: PAGE, sort: 'name:ASC', ...(q ? { q } : {}) },
      signal,
    });
    return (res.data?.items || []).map((row) => ({ id: row.id, label: row.name, ref: row.sequential_id ?? null }));
  }, []);

  if (data && data.items === null) return null;
  const rows = data?.items ?? [];
  const dash = '—';
  const criticalityLabel = (code: string | null) => (
    code ? catalog?.businessCriticalityLevels?.find((level) => level.code === code)?.label ?? code : dash
  );
  const columns: Array<RelationsColumn<ApplicationRow>> = [
    { key: 'ref', header: t('businessProcesses.applications.columns.ref'), width: 72, render: (row) => <RelationRef>{row.reference ?? dash}</RelationRef> },
    { key: 'name', header: t('businessProcesses.applications.columns.name'), render: (row) => row.name },
    { key: 'criticality', header: t('businessProcesses.applications.columns.criticality'), width: 140, render: (row) => criticalityLabel(row.criticality) },
    { key: 'itOwner', header: t('businessProcesses.applications.columns.itOwner'), width: 180, render: (row) => (row.it_owner_names.length ? row.it_owner_names.join(', ') : dash) },
  ];
  const title = t('businessProcesses.applications.title');
  const searchLabel = t('businessProcesses.applications.search');

  return (
    <Stack spacing={1}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <RelationsSection
        title={title}
        count={data ? rows.length : undefined}
        onAdd={canEdit && data ? setAnchor : undefined}
        adding={!!anchor}
        addLabel={t('businessProcesses.applications.add')}
      >
        {anchor && (
          <RelationAddPicker
            anchorEl={anchor}
            searchKey={`business-process-applications-${id}`}
            search={search}
            excludeIds={new Set(rows.map((row) => row.id))}
            placeholder={searchLabel}
            ariaLabel={searchLabel}
            onPick={(option) => { setAnchor(null); void link(option.id); }}
            onClose={() => setAnchor(null)}
          />
        )}
        {rows.length === 0 ? (
          <RelationsEmpty>{t('businessProcesses.applications.empty')}</RelationsEmpty>
        ) : (
          <RelationsTable
            ariaLabel={title}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/it/applications/${row.id}/overview`}
            onRemove={canEdit ? (row) => { void unlink(row.id); } : undefined}
            removeLabel={(row) => t('businessProcesses.applications.remove', { name: row.name })}
          />
        )}
      </RelationsSection>
    </Stack>
  );
}
