import React from 'react';
import { Alert, Stack } from '@mui/material';
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
  applicationsSection,
  assetsSection,
  budgetLinesSection,
  conversionSection,
  processesSection,
  technologiesSection,
  useRelations,
  type SectionSpec,
} from '../../../components/workspace/relations';
import { useRelationLabels } from '../../../components/workspace/relations/labels';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { EnsureApplicationFeedback, useApplicationFeedback } from '../../it/applicationFeedback';
import {
  fetchPortfolioLinks,
  portfolioBase,
  portfolioLinksKey,
  portfolioRelationsKey,
  type PortfolioEntity,
  type PortfolioLinksData,
  type PortfolioUrlRow,
  type ProjectRelationsData,
  type RequestRelationsData,
} from './portfolioRelations';

type RelationsData = ProjectRelationsData | RequestRelationsData;

/**
 * The Relations tab of a project and of a request, on the shared model.
 * One dense table per type, saved at once. A section the response leaves null is absent.
 * Source requests and resulting projects are read only (conversion writes them).
 * Technologies also need a read of the infrastructure, processes the right to manage them:
 * without it the section stays, and Add is left out.
 */
function PortfolioRelationsTabView({
  entity,
  id,
  onRelationsChange,
}: {
  entity: PortfolioEntity;
  id: string;
  /** The page is told after a link, an unlink, a web link or a file is saved. */
  onRelationsChange: () => void;
}) {
  const { t } = useTranslation(['it', 'common', 'portfolio', 'ops']);
  const feedback = useApplicationFeedback();
  const { hasLevel } = useAuth();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const labels = useRelationLabels();
  const budgetColumns = useBudgetColumns();
  const domain = entity === 'project' ? 'portfolio_projects' : 'portfolio_requests';
  const canEdit = hasLevel(domain, 'contributor');
  // The server writes a request's web links and files at `member`, a project's at `contributor`.
  const canEditLinksAndFiles = hasLevel(domain, entity === 'project' ? 'contributor' : 'member');
  const [uploading, setUploading] = React.useState(0);
  const base = portfolioBase(entity, id);
  const relationsKey = portfolioRelationsKey(entity, id);
  const linksKey = portfolioLinksKey(entity, id);
  const { data, error, setError, link, unlink } = useRelations<RelationsData>({
    path: `${base}/relations`,
    queryKey: relationsKey,
    onChange: onRelationsChange,
  });

  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: () => fetchPortfolioLinks(entity, id),
  });

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [setError, t]);

  const refreshLinks = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: linksKey });
    onRelationsChange();
  }, [linksKey, onRelationsChange, queryClient]);

  const links: LinksAndFilesLink[] = (linksQuery.data?.urls ?? []).map((row) => ({
    id: row.id,
    name: row.label,
    url: row.url,
    added_at: row.created_at,
  }));
  const files: LinksAndFilesFile[] = (linksQuery.data?.attachments ?? []).map((row) => ({
    id: row.id,
    name: row.original_filename,
    size: row.size,
    added_at: row.created_at,
  }));

  const urlBody = (rows: Array<Pick<PortfolioUrlRow, 'url' | 'label'>>) => rows
    .filter((row) => String(row.url || '').trim())
    .map((row) => ({ url: String(row.url).trim(), label: row.label ? String(row.label).trim() : null }));

  /** The stored list. Absent until the read has landed: a save must not replace it with a fragment. */
  const storedUrls = (): PortfolioUrlRow[] => {
    const current = queryClient.getQueryData<PortfolioLinksData>(linksKey);
    if (!current) throw new Error();
    return current.urls;
  };

  // A project or a request saves its links by replacing the whole list.
  const saveLink = async (linkRow: LinksAndFilesLink | null, draft: LinkDraft) => {
    setError(null);
    const next = { url: draft.url.trim(), label: draft.name?.trim() || null };
    const current = storedUrls();
    const urls = linkRow
      ? current.map((row) => (row.id === linkRow.id ? next : { url: row.url, label: row.label }))
      : [...current.map((row) => ({ url: row.url, label: row.label })), next];
    if (linkRow && !current.some((row) => row.id === linkRow.id)) throw new Error();
    await api.post(`${base}/urls`, { urls: urlBody(urls) });
    await refreshLinks();
  };

  const removeLink = async (linkRow: LinksAndFilesLink) => {
    setError(null);
    const previous = queryClient.getQueryData<PortfolioLinksData>(linksKey);
    // A replacement must not send an empty list when the read has not landed.
    if (!previous) return;
    const remaining = previous.urls.filter((row) => row.id !== linkRow.id);
    await removeWebLinkWithUndo<PortfolioLinksData>({
      queryClient,
      queryKey: linksKey,
      without: (cached) => ({ ...cached, urls: cached.urls.filter((row) => row.id !== linkRow.id) }),
      commit: () => api.post(`${base}/urls`, { urls: urlBody(remaining) }),
      refresh: refreshLinks,
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
        await api.post(`${base}/attachments`, form);
        landed = true;
      }
    } catch (e) {
      failed(e);
    } finally {
      setUploading(0);
    }
    if (!landed) return;
    await refreshLinks();
  };

  const openFile = async (file: LinksAndFilesFile) => {
    const downloadBase = entity === 'project' ? '/portfolio/projects/attachments' : '/portfolio/requests/attachments';
    try {
      const res = await api.get(`${downloadBase}/${file.id}`, { responseType: 'blob' });
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
      await api.delete(`${base}/attachments/${file.id}`);
    } catch (e) {
      failed(e);
      return;
    }
    await refreshLinks();
  };

  const year = data?.year ?? new Date().getFullYear();
  const columnLabel = data ? budgetColumns.label(data.budget_column.key) : '';
  const lineCurrency = data?.budget_lines?.find((line) => line.currency)?.currency ?? null;
  const project = entity === 'project' ? data as ProjectRelationsData | undefined : undefined;
  const request = entity === 'request' ? data as RequestRelationsData | undefined : undefined;
  const budget = budgetLinesSection({
    t,
    rows: data ? data.budget_lines : null,
    year,
    columnLabel,
    currency: lineCurrency,
    hidden: data?.budget_lines_hidden,
  });
  const applications = applicationsSection({
    t,
    rows: data ? data.applications : null,
    lifecycleLabel: labels.lifecycle,
    criticalityLabel: labels.criticality,
  });
  const assets = assetsSection({
    t,
    rows: data ? data.assets : null,
    kindLabel: labels.assetKind,
    environmentLabel: labels.environment,
    statusLabel: labels.status,
  });

  const sections: Array<SectionSpec<any>> = entity === 'project'
    ? [
      budget,
      applications,
      assets,
      {
        ...technologiesSection({
          t,
          rows: project ? project.technologies : null,
          familyLabel: labels.family,
        }),
        // The server refuses a technology link without a read of the infrastructure.
        editable: hasLevel('infrastructure', 'reader'),
      },
      conversionSection({
        t,
        kind: 'source_requests',
        type: 'request',
        title: t('portfolio:workspace.project.sections.sourceRequests'),
        empty: t('workspace.application.relations.empty.sourceRequests'),
        rows: project ? project.source_requests : null,
      }),
    ]
    : [
      budget,
      applications,
      assets,
      processesSection({
        t,
        rows: request ? request.processes : null,
        editable: hasLevel('business_processes', 'member'),
      }),
      conversionSection({
        t,
        kind: 'resulting_projects',
        type: 'project',
        title: t('portfolio:workspace.request.sections.resultingProjects'),
        empty: t('workspace.application.relations.empty.resultingProjects'),
        rows: request ? request.resulting_projects : null,
      }),
    ];

  return (
    <Stack spacing={3}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <RelationSections
        sections={sections}
        loaded={!!data}
        canEdit={canEdit}
        searchKeyPrefix={`portfolio-${entity}`}
        onLink={(kind, targetId) => { void link(kind, targetId); }}
        onUnlink={(kind, targetId) => { void unlink(kind, targetId); }}
      />
      <LinksAndFilesSection
        links={links}
        files={files}
        loaded={linksQuery.isSuccess}
        canEdit={canEditLinksAndFiles}
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
export default function PortfolioRelationsTab(props: React.ComponentProps<typeof PortfolioRelationsTabView>) {
  return (
    <EnsureApplicationFeedback>
      <PortfolioRelationsTabView {...props} />
    </EnsureApplicationFeedback>
  );
}
