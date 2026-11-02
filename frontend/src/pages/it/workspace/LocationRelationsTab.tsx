import React from 'react';
import { Alert, Stack } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import LinksAndFilesSection, { type LinkDraft, type LinksAndFilesLink } from '../../../components/workspace/LinksAndFilesSection';
import { removeWebLinkWithUndo, webLinkDraft, webLinkLabel } from '../../../components/workspace/removeWebLink';
import {
  RelationSections,
  applicationsSection,
  assetsSection,
  useRelations,
  type AssetRelationRow,
  type SectionSpec,
} from '../../../components/workspace/relations';
import { useRelationLabels } from '../../../components/workspace/relations/labels';
import type { RelationsColumn } from '../../../components/workspace/RelationsTable';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { EnsureApplicationFeedback, useApplicationFeedback } from '../applicationFeedback';

/** An asset at the location, with its provider and sub-location. */
type LocationAssetRow = AssetRelationRow & {
  provider: string | null;
  sub_location_id: string | null;
  sub_location_name: string | null;
};

/** An application with an instance on an asset of the location. */
type LocationApplicationRow = {
  id: string;
  reference: string;
  name: string;
  lifecycle: string;
  status: string;
  environments: string[];
};

type LocationRelationsData = {
  assets: LocationAssetRow[] | null;
  applications: LocationApplicationRow[] | null;
};

type WebLinkRow = { id: string; description: string | null; url: string; created_at: string | null };

const DASH = '—';

/** The factory's columns, in `keys` order, with the extra ones of this tab in between. */
function pick<T>(columns: Array<RelationsColumn<any>>, keys: Array<string | RelationsColumn<T>>): Array<RelationsColumn<T>> {
  return keys.map((key) => (typeof key === 'string' ? columns.find((column) => column.key === key)! : key));
}

/**
 * The Relations tab of a location: the assets placed there and the applications that run on them,
 * read only (`GET /locations/:id/relations`; an asset's location is chosen on the asset), then the
 * location's web links. A row opens its record. A section the response leaves null is absent. A
 * member adds, edits and removes a web link, each saved at once.
 */
function LocationRelationsTabView({
  locationId,
  onRelationsChange,
}: {
  locationId: string;
  /** The page reads the relations badge again. */
  onRelationsChange?: () => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const feedback = useApplicationFeedback();
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const labels = useRelationLabels();
  const { labelFor } = useItOpsEnumOptions();
  const canEdit = hasLevel('locations', 'member');
  const linksKey = ['location-links', locationId] as const;
  const { data, error, setError } = useRelations<LocationRelationsData>({
    path: `/locations/${locationId}/relations`,
    queryKey: ['location-relations', locationId],
  });
  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: async ({ signal }) => (await api.get<WebLinkRow[]>(`/locations/${locationId}/links`, { signal })).data || [],
  });

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [setError, t]);

  const links: LinksAndFilesLink[] = (linksQuery.data ?? []).map((row) => ({
    id: row.id,
    name: row.description,
    url: row.url,
    added_at: row.created_at,
  }));

  const saveLink = async (linkRow: LinksAndFilesLink | null, draft: LinkDraft) => {
    setError(null);
    const body = { description: draft.name, url: draft.url };
    if (linkRow) await api.patch(`/locations/${locationId}/links/${linkRow.id}`, body);
    else await api.post(`/locations/${locationId}/links`, body);
    await queryClient.invalidateQueries({ queryKey: linksKey });
    onRelationsChange?.();
  };

  const removeLink = async (linkRow: LinksAndFilesLink) => {
    setError(null);
    await removeWebLinkWithUndo<WebLinkRow[]>({
      queryClient,
      queryKey: linksKey,
      without: (rows) => rows.filter((row) => row.id !== linkRow.id),
      commit: () => api.delete(`/locations/${locationId}/links/${linkRow.id}`),
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: linksKey });
        onRelationsChange?.();
      },
      restore: () => saveLink(null, webLinkDraft(linkRow)),
      message: t('common:linksAndFiles.removed', { name: webLinkLabel(linkRow) }),
      feedback,
      onError: failed,
    });
  };

  const assets = data?.assets ?? null;
  const hasSubLocations = !!assets?.some((row) => row.sub_location_id);
  const assetBase = assetsSection({
    t,
    rows: assets,
    kindLabel: labels.assetKind,
    environmentLabel: labels.environment,
    statusLabel: labels.status,
  });
  const assetSection: SectionSpec<LocationAssetRow> = {
    ...(assetBase as unknown as SectionSpec<LocationAssetRow>),
    empty: t('workspace.location.relations.noAssets'),
    columns: pick<LocationAssetRow>(assetBase.columns, [
      'ref',
      'name',
      ...(hasSubLocations ? [{
        key: 'subLocation',
        header: t('workspace.location.relations.subLocation'),
        width: 130,
        hideOrder: 2,
        render: (row: LocationAssetRow) => row.sub_location_name || DASH,
      }] : []),
      'type',
      'environment',
      {
        key: 'provider',
        header: t('workspace.location.relations.provider'),
        width: 130,
        hideOrder: 3,
        render: (row: LocationAssetRow) => (row.provider ? labelFor('serverProvider', row.provider) || row.provider : DASH),
      },
      'status',
    ]),
  };

  const appBase = applicationsSection({
    t,
    rows: null,
    lifecycleLabel: labels.lifecycle,
    criticalityLabel: labels.criticality,
  });
  const applicationSection: SectionSpec<LocationApplicationRow> = {
    ...(appBase as unknown as SectionSpec<LocationApplicationRow>),
    rows: data?.applications ?? null,
    empty: t('workspace.location.relations.noApplications'),
    columns: pick<LocationApplicationRow>(appBase.columns, [
      'ref',
      'name',
      {
        key: 'environments',
        header: t('workspace.location.relations.environments'),
        width: 180,
        hideOrder: 1,
        render: (row: LocationApplicationRow) => row.environments.map(labels.environment).join(', ') || DASH,
      },
      'lifecycle',
    ]),
  };

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <RelationSections
        sections={[assetSection, applicationSection]}
        loaded={!!data}
        canEdit={false}
        searchKeyPrefix="location"
        onLink={() => undefined}
        onUnlink={() => undefined}
      />

      <LinksAndFilesSection
        linksOnly
        links={links}
        files={[]}
        loaded={linksQuery.isSuccess}
        canEdit={canEdit}
        onAddLink={(draft) => saveLink(null, draft)}
        onEditLink={(linkRow, draft) => saveLink(linkRow, draft)}
        onRemoveLink={(linkRow) => { void removeLink(linkRow); }}
        onUploadFiles={() => undefined}
        onOpenFile={() => undefined}
        onRemoveFile={() => undefined}
      />
    </Stack>
  );
}

/** The tab, with the undo message when the page does not already show one. */
export default function LocationRelationsTab(props: React.ComponentProps<typeof LocationRelationsTabView>) {
  return (
    <EnsureApplicationFeedback>
      <LocationRelationsTabView {...props} />
    </EnsureApplicationFeedback>
  );
}
