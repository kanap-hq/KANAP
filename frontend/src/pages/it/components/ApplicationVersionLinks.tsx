import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { PropertyRow } from '../../../components/design';

type Lineage = { sequential_id?: string | null; id: string; name: string };
type LineageResponse = { predecessors: Lineage[]; successors: Lineage[] };

const nameOf = (item: Lineage) => [item.sequential_id, item.name].filter(Boolean).join(' ');

/**
 * The previous version (the application this one was created from) and the next versions (the
 * applications created from this one), under the Version field of the properties panel: one
 * link per application. Absent when the application has neither.
 */
export default function ApplicationVersionLinks({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation('it');
  const { data } = useQuery({
    queryKey: ['application-version-lineage', applicationId],
    queryFn: async () => (await api.get<LineageResponse>(`/applications/${applicationId}/version-lineage`)).data,
    retry: false,
    // No id yet: the empty draft of a new application (its creation preview) has no version.
    enabled: !!applicationId,
  });
  const previous = data?.predecessors?.[data.predecessors.length - 1] ?? null;
  const next = data?.successors ?? [];
  const link = (item: Lineage) => (
    <RouterLink key={item.id} to={`/it/applications/${item.id}/overview`} style={{ fontSize: 13, color: 'inherit' }}>{nameOf(item)}</RouterLink>
  );
  return (
    <>
      {previous && <PropertyRow label={t('workspace.application.overview.previousVersion')}>{link(previous)}</PropertyRow>}
      {next.length > 0 && <PropertyRow label={t('workspace.application.overview.nextVersion')}><Stack spacing={0.25}>{next.map(link)}</Stack></PropertyRow>}
    </>
  );
}
