import React from 'react';
import { Alert, Divider, Stack } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import EntityKnowledgePanel from '../../../components/EntityKnowledgePanel';
import { useKanapDialogs } from '../../../components/design';
import LinksAndFilesSection, { type LinkDraft, type LinksAndFilesFile, type LinksAndFilesLink } from '../../../components/workspace/LinksAndFilesSection';
import { removeWebLinkWithUndo, webLinkDraft, webLinkLabel } from '../../../components/workspace/removeWebLink';
import {
  RelationSections,
  interfacesSection,
  useRelations,
  type InterfaceRelationRow,
  type SectionSpec,
} from '../../../components/workspace/relations';
import { useRelationLabels } from '../../../components/workspace/relations/labels';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { EnsureApplicationFeedback, useApplicationFeedback } from '../applicationFeedback';

type InterfaceRelationsData = {
  upstream: InterfaceRelationRow[];
  downstream: InterfaceRelationRow[];
};

type WebLinkRow = { id: string; description: string | null; url: string; created_at: string | null };
type AttachmentRow = { id: string; original_filename: string; size: number | null; uploaded_at: string | null };

/**
 * The Relations tab of an interface: its documents, then the upstream and downstream interfaces in
 * one round trip (`GET /interfaces/:id/relations`), then links and files. A row opens its interface.
 * A member adds from a server search and unlinks on hover, each saved at once.
 */
function InterfaceRelationsTabView({
  interfaceId,
  onCountChange,
}: {
  /** The interface uuid. */
  interfaceId: string;
  /** What the tab lists (interfaces, links and files), for the tab badge. */
  onCountChange?: (count: number) => void;
}) {
  const { t } = useTranslation(['it', 'common', 'ops']);
  const feedback = useApplicationFeedback();
  const { hasLevel } = useAuth();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const labels = useRelationLabels();
  const canEdit = hasLevel('applications', 'member');
  const [uploading, setUploading] = React.useState(0);
  const base = `/interfaces/${interfaceId}`;
  const linksKey = ['interface-links', interfaceId] as const;
  const attachmentsKey = ['interface-attachments', interfaceId] as const;
  const { data, error, setError, link, unlink } = useRelations<InterfaceRelationsData>({
    path: `${base}/relations`,
    queryKey: ['interface-relations', interfaceId],
  });

  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: async ({ signal }) => (await api.get<WebLinkRow[]>(`${base}/links`, { signal })).data || [],
  });
  const attachmentsQuery = useQuery({
    queryKey: attachmentsKey,
    queryFn: async ({ signal }) => (await api.get<AttachmentRow[]>(`${base}/attachments`, { signal })).data || [],
  });

  const count = data && linksQuery.data && attachmentsQuery.data
    ? data.upstream.length + data.downstream.length + linksQuery.data.length + attachmentsQuery.data.length
    : null;
  React.useEffect(() => {
    if (count != null) onCountChange?.(count);
  }, [count, onCountChange]);

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [setError, t]);

  const links: LinksAndFilesLink[] = (linksQuery.data ?? []).map((row) => ({
    id: row.id,
    name: row.description,
    url: row.url,
    added_at: row.created_at,
  }));
  const files: LinksAndFilesFile[] = (attachmentsQuery.data ?? []).map((row) => ({
    id: row.id,
    name: row.original_filename,
    size: row.size,
    added_at: row.uploaded_at,
  }));

  const saveLink = async (linkRow: LinksAndFilesLink | null, draft: LinkDraft) => {
    setError(null);
    const body = { description: draft.name, url: draft.url };
    if (linkRow) await api.patch(`${base}/links/${linkRow.id}`, body);
    else await api.post(`${base}/links`, body);
    await queryClient.invalidateQueries({ queryKey: linksKey });
  };

  const removeLink = async (linkRow: LinksAndFilesLink) => {
    setError(null);
    await removeWebLinkWithUndo<WebLinkRow[]>({
      queryClient,
      queryKey: linksKey,
      without: (rows) => rows.filter((row) => row.id !== linkRow.id),
      commit: () => api.delete(`${base}/links/${linkRow.id}`),
      refresh: () => queryClient.invalidateQueries({ queryKey: linksKey }),
      restore: () => saveLink(null, webLinkDraft(linkRow)),
      message: t('common:linksAndFiles.removed', { name: webLinkLabel(linkRow) }),
      feedback,
      onError: failed,
    });
  };

  const uploadFiles = async (chosen: File[]) => {
    setError(null);
    setUploading(chosen.length);
    let landed = false;
    try {
      for (const file of chosen) {
        const form = new FormData();
        form.append('file', file);
        form.append('kind', 'functional');
        await api.post(`${base}/attachments`, form);
        landed = true;
      }
    } catch (e) {
      failed(e);
    } finally {
      setUploading(0);
    }
    if (landed) await queryClient.invalidateQueries({ queryKey: attachmentsKey });
  };

  const openFile = async (file: LinksAndFilesFile) => {
    try {
      const res = await api.get(`/interfaces/attachments/${file.id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      failed(e);
    }
  };

  // Deleting a file removes the stored document: it keeps its confirmation.
  const removeFile = async (file: LinksAndFilesFile) => {
    const ok = await dialogs.confirm({
      message: t('ops:confirmations.deleteAttachment', { name: file.name }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    });
    if (!ok) return;
    setError(null);
    try {
      await api.patch(`/interfaces/attachments/${file.id}/delete`, {});
    } catch (e) {
      failed(e);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: attachmentsKey });
  };

  const section = (kind: 'upstream' | 'downstream') => interfacesSection({
    t,
    kind,
    title: t(`workspace.interface.relations.${kind}`),
    empty: t(`workspace.interface.relations.empty.${kind}`),
    rows: data?.[kind] ?? [],
    ownerId: interfaceId,
    lifecycleLabel: labels.lifecycle,
  });
  const sections: Array<SectionSpec<any>> = [section('upstream'), section('downstream')];

  return (
    <Stack spacing={3}>
      <EntityKnowledgePanel entityType="interfaces" entityId={interfaceId} canCreate={canEdit} />

      <Divider />

      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <RelationSections
        sections={sections}
        loaded={!!data}
        canEdit={canEdit}
        searchKeyPrefix="interface"
        onLink={(kind, targetId) => { void link(kind, targetId); }}
        onUnlink={(kind, targetId) => { void unlink(kind, targetId); }}
      />

      <LinksAndFilesSection
        links={links}
        files={files}
        loaded={linksQuery.isSuccess && attachmentsQuery.isSuccess}
        canEdit={canEdit}
        uploading={uploading}
        onAddLink={(draft) => saveLink(null, draft)}
        onEditLink={(linkRow, draft) => saveLink(linkRow, draft)}
        onRemoveLink={(linkRow) => { void removeLink(linkRow); }}
        onUploadFiles={(chosen) => { void uploadFiles(chosen); }}
        onOpenFile={(file) => { void openFile(file); }}
        onRemoveFile={(file) => { void removeFile(file); }}
      />
    </Stack>
  );
}

/** The tab, with the undo message when the page does not already show one. */
export default function InterfaceRelationsTab(props: React.ComponentProps<typeof InterfaceRelationsTabView>) {
  return (
    <EnsureApplicationFeedback>
      <InterfaceRelationsTabView {...props} />
    </EnsureApplicationFeedback>
  );
}
