import React from 'react';
import { Alert, Box, Stack, useTheme } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { useKanapDialogs } from '../../../components/design';
import LinksAndFilesSection, { type LinkDraft, type LinksAndFilesFile, type LinksAndFilesLink } from '../../../components/workspace/LinksAndFilesSection';
import { removeWebLinkWithUndo, webLinkDraft, webLinkLabel } from '../../../components/workspace/removeWebLink';
import {
  DASH,
  RelationSections,
  budgetLinesSection,
  contractsSection,
  incidentsSection,
  pathOf,
  projectsSection,
  relationDate,
  relationRefColumn,
  searchRelationItems,
  todayYmd,
  useRelations,
  type BudgetLineRow,
  type ContractRow,
  type IncidentLinkRow,
  type ProjectRow,
  type SectionSpec,
} from '../../../components/workspace/relations';
import useBudgetColumns from '../../../hooks/useBudgetColumns';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useApplicationFeedback } from '../applicationFeedback';
import { assetRelationsKey, type AssetRelationsData, type AssetTaskRow as TaskRow } from './assetRelationsData';

type WebLinkRow = { id: string; description: string | null; url: string; created_at: string | null };
type AttachmentRow = { id: string; original_filename: string; size: number | null; uploaded_at: string | null };

/** The module a section reads. The server refuses a link without it. */
const SECTION_READ: Record<string, string> = {
  budget_lines: 'budget',
  contracts: 'contracts',
  projects: 'portfolio_projects',
  tasks: 'tasks',
};

const DONE_TASK = new Set(['done', 'cancelled']);

/**
 * The Relations tab of an asset: budget lines, contracts, projects, tasks and incidents, read in
 * one round trip (`GET /assets/:id/relations-tab`, shared with the Dependencies tab), then links
 * and files. A row opens its record. An infrastructure member adds from a server search and
 * unlinks on hover, each saved at once. A section the response leaves null is absent; Add is left
 * out without a read of that module. The relations between assets live in the Dependencies tab.
 */
export default function AssetRelationsTab({ assetId }: { assetId: string }) {
  const { t, i18n } = useTranslation(['it', 'common', 'portfolio', 'ops']);
  const feedback = useApplicationFeedback();
  const theme = useTheme();
  const { hasLevel } = useAuth();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const budgetColumns = useBudgetColumns();
  const canEdit = hasLevel('infrastructure', 'member');
  const [uploading, setUploading] = React.useState(0);
  const relationsKey = assetRelationsKey(assetId);
  const linksKey = ['asset-links', assetId] as const;
  const attachmentsKey = ['asset-attachments', assetId] as const;
  // Links and files are counted by the badge: the shared read is made again.
  const changed = React.useCallback(() => { void queryClient.invalidateQueries({ queryKey: relationsKey }); }, [queryClient, relationsKey]);
  const { data, error, setError, link, unlink } = useRelations<AssetRelationsData>({
    path: `/assets/${assetId}/relations`,
    queryKey: relationsKey,
    readPath: `/assets/${assetId}/relations-tab`,
  });
  const relations = data;
  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: async ({ signal }) => (await api.get<WebLinkRow[]>(`/assets/${assetId}/links`, { signal })).data || [],
  });
  const attachmentsQuery = useQuery({
    queryKey: attachmentsKey,
    queryFn: async ({ signal }) => (await api.get<AttachmentRow[]>(`/assets/${assetId}/attachments`, { signal })).data || [],
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
    if (linkRow) await api.patch(`/assets/${assetId}/links/${linkRow.id}`, body);
    else await api.post(`/assets/${assetId}/links`, body);
    await queryClient.invalidateQueries({ queryKey: linksKey });
    changed();
  };

  const removeLink = async (linkRow: LinksAndFilesLink) => {
    setError(null);
    await removeWebLinkWithUndo<WebLinkRow[]>({
      queryClient,
      queryKey: linksKey,
      without: (rows) => rows.filter((row) => row.id !== linkRow.id),
      commit: () => api.delete(`/assets/${assetId}/links/${linkRow.id}`),
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: linksKey });
        changed();
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
        await api.post(`/assets/${assetId}/attachments`, form);
        landed = true;
      }
    } catch (e) {
      failed(e);
    } finally {
      setUploading(0);
    }
    if (!landed) return;
    await queryClient.invalidateQueries({ queryKey: attachmentsKey });
    changed();
  };

  const openFile = async (file: LinksAndFilesFile) => {
    try {
      const res = await api.get(`/assets/attachments/${file.id}`, { responseType: 'blob' });
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
      message: t('workspace.asset.relations.deleteAttachmentConfirm', { name: file.name }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    });
    if (!ok) return;
    setError(null);
    try {
      await api.patch(`/assets/attachments/${file.id}/delete`, {});
    } catch (e) {
      failed(e);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: attachmentsKey });
    changed();
  };

  const lang = i18n.language;
  const year = relations?.year ?? new Date().getFullYear();
  const today = todayYmd();
  const columnLabel = relations ? budgetColumns.label(relations.budget_column.key) : '';
  const lineCurrency = relations?.budget_lines?.find((line) => line.currency)?.currency ?? null;
  const taskStatus = (status: string | null) => (status ? t(`portfolio:statuses.task.${status}`, { defaultValue: status }) : DASH);
  // While the tab loads, each section is its empty line. A missing read leaves the rows null.
  const rowsOf = <K extends 'budget_lines' | 'contracts' | 'projects' | 'tasks' | 'incidents'>(key: K) => (relations ? relations[key] : []);
  const readable = <T extends { id: string }>(section: SectionSpec<T>): SectionSpec<T> => ({
    ...section,
    editable: hasLevel(SECTION_READ[section.kind], 'reader'),
  });

  const sections: Array<SectionSpec<any>> = [
    readable(budgetLinesSection({ t, rows: rowsOf('budget_lines') as BudgetLineRow[] | null, year, columnLabel, currency: lineCurrency, hidden: relations?.budget_lines_hidden })),
    readable(contractsSection({ t, rows: rowsOf('contracts') as ContractRow[] | null, lang, hidden: relations?.contracts_hidden })),
    readable(projectsSection({ t, rows: rowsOf('projects') as ProjectRow[] | null, lang })),
    readable({
      kind: 'tasks',
      title: t('workspace.application.relations.sections.tasks'),
      empty: t('workspace.application.relations.empty.tasks'),
      searchPlaceholder: t('workspace.application.relations.searchTasks'),
      rows: rowsOf('tasks') as TaskRow[] | null,
      href: (row: TaskRow) => pathOf('task', row),
      label: (row: TaskRow) => row.title,
      columns: [
        relationRefColumn<TaskRow>('task', t('workspace.application.relations.columns.ref')),
        { key: 'title', header: t('workspace.application.relations.columns.title'), render: (row: TaskRow) => row.title },
        { key: 'status', header: t('workspace.application.relations.columns.status'), width: 100, render: (row: TaskRow) => taskStatus(row.status) },
        { key: 'assignee', header: t('workspace.application.relations.columns.assignee'), width: 140, hideOrder: 1, render: (row: TaskRow) => row.assignee_name ?? DASH },
        {
          key: 'due', header: t('workspace.application.relations.columns.due'), width: 110, hideOrder: 2,
          render: (row: TaskRow) => {
            const late = !!row.due_date && row.due_date < today && !DONE_TASK.has(row.status ?? '');
            return <Box component="span" sx={late ? { color: 'kanap.orange' } : undefined}>{relationDate(row.due_date, lang)}</Box>;
          },
        },
      ],
      search: searchRelationItems('/tasks', 'task', (row) => row.title ?? ''),
    }),
    incidentsSection({
      t,
      rows: rowsOf('incidents') as IncidentLinkRow[] | null,
      lang,
      canEdit: hasLevel('incidents', 'contributor'),
      mode: theme.palette.mode,
    }),
  ];

  const nameOf = (kind: string, targetId: string) => {
    const section = sections.find((item) => item.kind === kind);
    const row = (section?.rows as Array<{ id: string }> | null | undefined)?.find((item) => item.id === targetId);
    return section && row ? section.label(row) : '';
  };
  // Unlinking stays immediate. The message offers to put the row back. A removed web link does the same.
  const handleUnlink = async (kind: string, targetId: string) => {
    const name = nameOf(kind, targetId);
    if (await unlink(kind, targetId)) {
      feedback.undo(t('workspace.asset.relations.feedback.unlinked', { name }), async () => { await link(kind, targetId); });
    }
  };

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <RelationSections
        sections={sections}
        loaded={!!relations}
        canEdit={canEdit}
        searchKeyPrefix="asset"
        onLink={(kind, targetId) => { void link(kind, targetId); }}
        onUnlink={(kind, targetId) => { void handleUnlink(kind, targetId); }}
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
