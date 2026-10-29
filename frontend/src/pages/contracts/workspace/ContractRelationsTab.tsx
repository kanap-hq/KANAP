import React from 'react';
import { Alert, Stack, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import ItemContactsSection from '../../../components/contacts/ItemContactsSection';
import { useKanapDialogs } from '../../../components/design';
import LinksAndFilesSection, { type LinkDraft, type LinksAndFilesFile, type LinksAndFilesLink } from '../../../components/workspace/LinksAndFilesSection';
import { removeWebLinkWithUndo, webLinkDraft, webLinkLabel } from '../../../components/workspace/removeWebLink';
import {
  RelationSections,
  RelationSuggestions,
  applicationsSection,
  assetsSection,
  technologiesSection,
  useRelations,
  type ApplicationRelationRow,
  type AssetRelationRow,
  type SectionSpec,
  type TechnologyRelationRow,
} from '../../../components/workspace/relations';
import { useRelationLabels } from '../../../components/workspace/relations/labels';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { buildItemPath } from '../../../utils/item-ref';
import { EnsureApplicationFeedback, useApplicationFeedback } from '../../it/applicationFeedback';

type Suggestion = {
  type: 'application' | 'asset';
  id: string;
  reference: string;
  name: string;
  via: { kind: 'same_supplier'; label: string | null };
};

type ContractRelationsData = {
  /** Null when the caller cannot read the applications. */
  applications: ApplicationRelationRow[] | null;
  /** Null when the caller cannot read the infrastructure. */
  assets: AssetRelationRow[] | null;
  /** Null when the caller cannot read the infrastructure. */
  technologies: TechnologyRelationRow[] | null;
  suggestions: Suggestion[];
};

type WebLinkRow = { id: string; description: string | null; url: string; created_at: string | null };
type AttachmentRow = { id: string; original_filename: string; size: number | null; uploaded_at: string | null };

const SUGGESTION_KIND: Record<Suggestion['type'], 'applications' | 'assets'> = {
  application: 'applications',
  asset: 'assets',
};

/**
 * The Relations tab of a contract: applications, assets and technologies in one round trip
 * (`GET /contracts/:id/relations`), then suggestions, contacts, and links and files.
 * A row opens its record. Editors add from a server search and unlink on hover, each saved at once.
 * A family whose module the caller does not read is absent (`null`): the applications without the
 * applications right, the assets and technologies without the infrastructure right.
 * A contract opened through one of its lines (`closedDocumentsCount` above 0) shows the number of
 * its attachments and documentary links instead of them: those detail other companies (spec §5.4).
 */
function ContractRelationsTabView({
  contractId,
  readOnly,
  closedDocumentsCount = 0,
  onChanged,
}: {
  contractId: string;
  readOnly: boolean;
  /** The attachments and links a limited person cannot open; 0 when they are open. */
  closedDocumentsCount?: number;
  /** The contract's detail and tab counts are read again. */
  onChanged: () => void;
}) {
  const { t } = useTranslation(['it', 'common', 'ops']);
  const feedback = useApplicationFeedback();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const labels = useRelationLabels();
  const canEdit = !readOnly;
  const documentsClosed = closedDocumentsCount > 0;
  const [uploading, setUploading] = React.useState(0);
  const key = ['contract-relations', contractId] as const;
  const { data, error, setError, link, unlink } = useRelations<ContractRelationsData>({
    path: `/contracts/${contractId}/relations`,
    queryKey: key,
    onChange: onChanged,
    dropLinkedSuggestion: true,
  });

  const linksKey = ['contract-links', contractId] as const;
  const attachmentsKey = ['contract-attachments', contractId] as const;
  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: async () => (await api.get<WebLinkRow[]>(`/contracts/${contractId}/links`)).data || [],
    enabled: !documentsClosed,
  });
  const attachmentsQuery = useQuery({
    queryKey: attachmentsKey,
    queryFn: async () => (await api.get<AttachmentRow[]>(`/contracts/${contractId}/attachments`)).data || [],
    enabled: !documentsClosed,
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
  const files: LinksAndFilesFile[] = (attachmentsQuery.data ?? []).map((row) => ({
    id: row.id,
    name: row.original_filename,
    size: row.size,
    added_at: row.uploaded_at,
  }));

  const saveLink = async (linkRow: LinksAndFilesLink | null, draft: LinkDraft) => {
    setError(null);
    const body = { description: draft.name, url: draft.url };
    if (linkRow) await api.patch(`/contracts/${contractId}/links/${linkRow.id}`, body);
    else await api.post(`/contracts/${contractId}/links`, body);
    await queryClient.invalidateQueries({ queryKey: linksKey });
    onChanged();
  };

  const removeLink = async (linkRow: LinksAndFilesLink) => {
    setError(null);
    await removeWebLinkWithUndo<WebLinkRow[]>({
      queryClient,
      queryKey: linksKey,
      without: (rows) => rows.filter((row) => row.id !== linkRow.id),
      commit: () => api.delete(`/contracts/${contractId}/links/${linkRow.id}`),
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: linksKey });
        onChanged();
      },
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
        await api.post(`/contracts/${contractId}/attachments`, form);
        landed = true;
      }
    } catch (e) {
      failed(e);
    } finally {
      setUploading(0);
    }
    if (!landed) return;
    await queryClient.invalidateQueries({ queryKey: attachmentsKey });
    onChanged();
  };

  const openFile = async (file: LinksAndFilesFile) => {
    try {
      const res = await api.get(`/contracts/attachments/${file.id}`, { responseType: 'blob' });
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
      await api.patch(`/contracts/attachments/${file.id}/delete`, {});
    } catch (e) {
      failed(e);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: attachmentsKey });
    onChanged();
  };

  const sections: Array<SectionSpec<any>> = [
    applicationsSection({
      t,
      rows: data ? data.applications : [],
      lifecycleLabel: labels.lifecycle,
      criticalityLabel: labels.criticality,
    }),
    assetsSection({
      t,
      rows: data ? data.assets : [],
      kindLabel: labels.assetKind,
      environmentLabel: labels.environment,
      statusLabel: labels.status,
    }),
    technologiesSection({
      t,
      rows: data ? data.technologies : null,
      familyLabel: labels.family,
    }),
  ];

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <RelationSections
        sections={sections}
        loaded={!!data}
        canEdit={canEdit}
        searchKeyPrefix="contract"
        onLink={(kind, targetId) => { void link(kind, targetId); }}
        onUnlink={(kind, targetId) => { void unlink(kind, targetId); }}
      />

      <RelationSuggestions
        suggestions={data?.suggestions ?? []}
        canEdit={canEdit}
        referenceOf={(row) => row.reference}
        href={(row) => `${buildItemPath(row.type, row.reference || row.id)}/overview`}
        onLink={(row) => { void link(SUGGESTION_KIND[row.type], row.id); }}
      />

      <ItemContactsSection itemType="contracts" itemId={contractId} canManage={canEdit} syncFromSupplier onChanged={onChanged} />

      {documentsClosed ? (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
          {t('ops:contracts.relations.closedDocuments', { count: closedDocumentsCount })}
        </Typography>
      ) : (
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
      )}
    </Stack>
  );
}

/** The tab, with the undo message when the page does not already show one. */
export default function ContractRelationsTab(props: React.ComponentProps<typeof ContractRelationsTabView>) {
  return (
    <EnsureApplicationFeedback>
      <ContractRelationsTabView {...props} />
    </EnsureApplicationFeedback>
  );
}
