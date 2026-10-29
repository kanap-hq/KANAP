import React from 'react';
import { Alert, Stack, useTheme } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { useKanapDialogs } from '../../../components/design';
import useBudgetColumns from '../../../hooks/useBudgetColumns';
import LinksAndFilesSection, { type LinkDraft, type LinksAndFilesFile, type LinksAndFilesLink } from '../../../components/workspace/LinksAndFilesSection';
import { removeWebLinkWithUndo, webLinkDraft, webLinkLabel } from '../../../components/workspace/removeWebLink';
import {
  RelationSections,
  budgetLinesSection,
  contractsSection,
  incidentsSection,
  projectsSection,
  useRelations,
  type BudgetLineRow,
  type ContractRow,
  type IncidentLinkRow,
  type ProjectRow,
  type SectionSpec,
} from '../../../components/workspace/relations';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { EnsureApplicationFeedback, useApplicationFeedback } from '../applicationFeedback';

export type TechnologyRelationKind = 'budget_lines' | 'contracts' | 'projects' | 'incidents';

type DocumentRow = { id: string; original_filename: string; mime_type: string | null; size: number; uploaded_at: string };
type WebLinkRow = { id: string; description: string | null; url: string; created_at: string };

export type TechnologyRelationsData = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: BudgetLineRow[] | null;
  /** The linked lines `budget_lines` leaves out, counted: outside the caller's data access, or all without the budget right. */
  budget_lines_hidden?: number;
  contracts: ContractRow[] | null;
  /** The linked contracts `contracts` leaves out: outside the caller's data access. */
  contracts_hidden?: number;
  projects: ProjectRow[] | null;
  incidents: IncidentLinkRow[] | null;
  documents: DocumentRow[];
  links: WebLinkRow[];
};

type LinkRow = { id: string; description: string | null; url: string; created_at: string | null };
type AttachmentRow = { id: string; original_filename: string; size: number | null; uploaded_at: string | null };

export const technologyRelationsKey = (id: string) => ['technology-relations', id] as const;

export async function fetchTechnologyRelations(id: string): Promise<TechnologyRelationsData> {
  return (await api.get<TechnologyRelationsData>(`/technologies/${id}/relations`)).data;
}

/** The tab badge: the rows of every section the caller can see. */
export function technologyRelationsCount(data: TechnologyRelationsData | undefined): number | undefined {
  if (!data) return undefined;
  // The sections also count the linked rows they do not list (`budget_lines_hidden`, `contracts_hidden`).
  return [data.budget_lines, data.contracts, data.projects, data.incidents, data.documents, data.links]
    .reduce((sum, rows) => sum + (rows ? rows.length : 0), (data.budget_lines_hidden ?? 0) + (data.contracts_hidden ?? 0));
}

/**
 * The Relations tab of a technology: budget lines, contracts, projects and incidents read in one
 * round trip (`GET /technologies/:id/relations`), each linked or unlinked at once. A section whose
 * module the caller cannot read is absent. Documents and web links are the same section as on an
 * application (`LinksAndFilesSection`), saved by the technology's own routes.
 */
function TechnologyRelationsTabView({ id }: { id: string }) {
  const { t, i18n } = useTranslation(['it', 'common', 'portfolio', 'ops']);
  const feedback = useApplicationFeedback();
  const theme = useTheme();
  const { hasLevel } = useAuth();
  const dialogs = useKanapDialogs();
  const canEdit = hasLevel('infrastructure', 'member');
  const queryClient = useQueryClient();
  const budgetColumns = useBudgetColumns();
  const [uploading, setUploading] = React.useState(0);
  const key = technologyRelationsKey(id);
  const lang = i18n.language;
  const { data, error, setError, link, unlink, refresh } = useRelations<TechnologyRelationsData>({
    path: `/technologies/${id}/relations`,
    queryKey: key,
  });

  const linksKey = ['technology-links', id] as const;
  const attachmentsKey = ['technology-attachments', id] as const;
  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: async () => (await api.get<LinkRow[]>(`/technologies/${id}/links`)).data || [],
  });
  const attachmentsQuery = useQuery({
    queryKey: attachmentsKey,
    queryFn: async () => (await api.get<AttachmentRow[]>(`/technologies/${id}/attachments`)).data || [],
  });

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [setError, t]);

  const refreshList = React.useCallback(async (listKey: readonly unknown[]) => {
    await queryClient.invalidateQueries({ queryKey: listKey });
    await refresh();
  }, [queryClient, refresh]);

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
    if (linkRow) await api.patch(`/technologies/${id}/links/${linkRow.id}`, body);
    else await api.post(`/technologies/${id}/links`, body);
    await refreshList(linksKey);
  };

  const removeLink = async (linkRow: LinksAndFilesLink) => {
    setError(null);
    await removeWebLinkWithUndo<LinkRow[]>({
      queryClient,
      queryKey: linksKey,
      without: (rows) => rows.filter((row) => row.id !== linkRow.id),
      commit: () => api.delete(`/technologies/${id}/links/${linkRow.id}`),
      refresh: () => refreshList(linksKey),
      restore: () => saveLink(null, webLinkDraft(linkRow)),
      message: t('common:linksAndFiles.removed', { name: webLinkLabel(linkRow) }),
      feedback,
      onError: failed,
    });
  };

  const uploadFiles = async (chosen: File[]) => {
    setError(null);
    setUploading(chosen.length);
    try {
      for (const file of chosen) {
        const form = new FormData();
        form.append('file', file);
        await api.post(`/technologies/${id}/attachments`, form);
      }
    } catch (e) {
      failed(e);
    } finally {
      setUploading(0);
    }
    await refreshList(attachmentsKey);
  };

  const openFile = async (file: LinksAndFilesFile) => {
    try {
      const res = await api.get(`/technologies/attachments/${file.id}`, { responseType: 'blob' });
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
      message: t('workspace.application.relations.deleteAttachment', { name: file.name }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    });
    if (!ok) return;
    setError(null);
    try {
      await api.delete(`/technologies/attachments/${file.id}`);
    } catch (e) {
      failed(e);
    }
    await refreshList(attachmentsKey);
  };

  const year = data?.year ?? new Date().getFullYear();
  const columnLabel = data ? budgetColumns.label(data.budget_column.key) : '';
  const lineCurrency = data?.budget_lines?.find((line) => line.currency)?.currency ?? null;

  const sections: Array<SectionSpec<any>> = [
    budgetLinesSection({ t, rows: data ? data.budget_lines : [], year, columnLabel, currency: lineCurrency, hidden: data?.budget_lines_hidden }),
    contractsSection({ t, rows: data ? data.contracts : [], lang, hidden: data?.contracts_hidden }),
    projectsSection({ t, rows: data ? data.projects : [], lang }),
    incidentsSection({
      t,
      rows: data ? data.incidents : [],
      lang,
      canEdit: hasLevel('incidents', 'contributor'),
      mode: theme.palette.mode,
    }),
  ];

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <RelationSections
        sections={sections}
        loaded={!!data}
        canEdit={canEdit}
        searchKeyPrefix="technology"
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
export default function TechnologyRelationsTab(props: React.ComponentProps<typeof TechnologyRelationsTabView>) {
  return (
    <EnsureApplicationFeedback>
      <TechnologyRelationsTabView {...props} />
    </EnsureApplicationFeedback>
  );
}
