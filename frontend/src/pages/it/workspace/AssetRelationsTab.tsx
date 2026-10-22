import React from 'react';
import { Alert, Box, Stack, useTheme } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { useKanapDialogs } from '../../../components/design';
import LinksAndFilesSection, { type LinkDraft, type LinksAndFilesFile, type LinksAndFilesLink } from '../../../components/workspace/LinksAndFilesSection';
import {
  DASH,
  RelationSections,
  assetsSection,
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
  type AssetRelationRow,
  type BudgetLineRow,
  type ContractRow,
  type IncidentLinkRow,
  type ProjectRow,
  type SectionSpec,
} from '../../../components/workspace/relations';
import { useRelationLabels } from '../../../components/workspace/relations/labels';
import useBudgetColumns from '../../../hooks/useBudgetColumns';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import AssetImpactSection from '../editors/AssetImpactSection';

/** The four directions of a relation between assets, in the order of the tab. */
const DIRECTIONS = ['contains', 'contained_by', 'depends_on', 'depended_on_by'] as const;
type Direction = (typeof DIRECTIONS)[number];
const DIRECTION_SET = new Set<string>(DIRECTIONS);

/** The label key of each direction (`workspace.asset.relations.*`). */
const DIRECTION_KEY: Record<Direction, string> = {
  contains: 'contains',
  contained_by: 'containedBy',
  depends_on: 'dependsOn',
  depended_on_by: 'dependedOnBy',
};

type TaskRow = { id: string; item_number: number | null; title: string; status: string | null; assignee_name: string | null; due_date: string | null };

export type AssetRelationsData = {
  year: number;
  budget_column: { key: string; label: string };
  assets: Record<Direction, AssetRelationRow[]>;
  budget_lines: BudgetLineRow[] | null;
  contracts: ContractRow[] | null;
  projects: ProjectRow[] | null;
  tasks: TaskRow[] | null;
  incidents: IncidentLinkRow[] | null;
  counts: { total: number } & Record<string, number>;
};

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

export const assetRelationsKey = (id: string) => ['asset-relations-tab', id] as const;

/**
 * The Relations tab of an asset (lot R2h): what falls with it first, then the relations between
 * assets in their four directions, budget lines, contracts, projects, tasks and incidents, read in
 * one round trip (`GET /assets/:id/relations-tab`), then links and files. A row opens its record.
 * An infrastructure member adds from a server search and unlinks on hover, each saved at once.
 * A section the response leaves null is absent; Add is left out without a read of that module.
 */
export default function AssetRelationsTab({
  assetId,
  onRelationsChange,
}: {
  assetId: string;
  /** The page reads the relations badge again. */
  onRelationsChange?: () => void;
}) {
  const { t, i18n } = useTranslation(['it', 'common', 'portfolio', 'ops']);
  const theme = useTheme();
  const { hasLevel } = useAuth();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const labels = useRelationLabels();
  const budgetColumns = useBudgetColumns();
  const canEdit = hasLevel('infrastructure', 'member');
  const [uploading, setUploading] = React.useState(0);
  // Bumped once a relation between assets changed: the impact section reads it again.
  const [impactVersion, setImpactVersion] = React.useState(0);
  const relationsKey = assetRelationsKey(assetId);
  const linksKey = ['asset-links', assetId] as const;
  const attachmentsKey = ['asset-attachments', assetId] as const;
  const changed = React.useCallback(() => { onRelationsChange?.(); }, [onRelationsChange]);
  const groupOf = React.useCallback((kind: string) => (DIRECTION_SET.has(kind) ? 'assets' : undefined), []);
  const { data, error, setError, link, unlink } = useRelations<AssetRelationsData>({
    path: `/assets/${assetId}/relations`,
    queryKey: relationsKey,
    onChange: changed,
    groupOf,
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

  const onLink = async (kind: string, targetId: string) => {
    await link(kind, targetId);
    if (DIRECTION_SET.has(kind)) setImpactVersion((value) => value + 1);
  };
  const onUnlink = async (kind: string, targetId: string) => {
    await unlink(kind, targetId);
    if (DIRECTION_SET.has(kind)) setImpactVersion((value) => value + 1);
  };

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
    try {
      if (linkRow) await api.patch(`/assets/${assetId}/links/${linkRow.id}`, body);
      else await api.post(`/assets/${assetId}/links`, body);
    } catch (e) {
      failed(e);
      throw e;
    }
    await queryClient.invalidateQueries({ queryKey: linksKey });
    changed();
  };

  const removeLink = async (linkRow: LinksAndFilesLink) => {
    setError(null);
    const previous = queryClient.getQueryData<WebLinkRow[]>(linksKey);
    queryClient.setQueryData<WebLinkRow[]>(linksKey, (rows) => (rows ? rows.filter((row) => row.id !== linkRow.id) : rows));
    try {
      await api.delete(`/assets/${assetId}/links/${linkRow.id}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(linksKey, previous);
      failed(e);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: linksKey });
    changed();
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
  const rowsOf = <K extends keyof AssetRelationsData>(key: K) => (relations ? relations[key] : []);
  const readable = <T extends { id: string }>(section: SectionSpec<T>): SectionSpec<T> => ({
    ...section,
    editable: hasLevel(SECTION_READ[section.kind], 'reader'),
  });

  const directionSections = DIRECTIONS.map((direction): SectionSpec<AssetRelationRow> => {
    const key = DIRECTION_KEY[direction];
    return {
      ...assetsSection({
        t,
        rows: relations ? relations.assets[direction] : [],
        kindLabel: labels.assetKind,
        environmentLabel: labels.environment,
        statusLabel: labels.status,
      }),
      kind: direction,
      title: t(`workspace.asset.relations.${key}`),
      empty: t(`workspace.asset.relations.empty.${key}`),
      // An asset never relates to itself: the picker leaves it out.
      linkedIds: (rows) => new Set([assetId, ...rows.map((row) => row.id)]),
    };
  });

  const sections: Array<SectionSpec<any>> = [
    ...directionSections,
    readable(budgetLinesSection({ t, rows: rowsOf('budget_lines') as BudgetLineRow[] | null, year, columnLabel, currency: lineCurrency })),
    readable(contractsSection({ t, rows: rowsOf('contracts') as ContractRow[] | null, lang })),
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

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <AssetImpactSection assetId={assetId} version={impactVersion} />

      <RelationSections
        sections={sections}
        loaded={!!relations}
        canEdit={canEdit}
        searchKeyPrefix="asset"
        onLink={(kind, targetId) => { void onLink(kind, targetId); }}
        onUnlink={(kind, targetId) => { void onUnlink(kind, targetId); }}
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
