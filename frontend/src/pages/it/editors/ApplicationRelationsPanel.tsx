import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { classificationText } from '../../../utils/applicationClassification';
import React from 'react';
import { Alert, Box, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Paper } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';

import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useKanapDialogs } from '../../../components/design';
import LinksAndFilesSection, { type LinkDraft, type LinksAndFilesFile, type LinksAndFilesLink } from '../../../components/workspace/LinksAndFilesSection';
import { removeWebLinkWithUndo, webLinkDraft, webLinkLabel } from '../../../components/workspace/removeWebLink';
import ApplicationRelationsTab from '../workspace/ApplicationRelationsTab';
import { useApplicationFeedback } from '../applicationFeedback';

type Props = { id: string; isSuite?: boolean; onRelationsChange?: () => void; onOpenKnowledge?: () => void };

type LinkRow = { id: string; description: string | null; url: string; created_at: string | null };
type AttachmentRow = { id: string; original_filename: string; size: number | null; uploaded_at: string | null };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      component="h2"
      sx={(theme) => ({
        m: 0,
        fontSize: 14,
        fontWeight: 500,
        lineHeight: 1.4,
        color: theme.palette.kanap.text.primary,
      })}
    >
      {children}
    </Typography>
  );
}

/**
 * The Relations tab of an application: the components of a suite, the linked sections
 * (`ApplicationRelationsTab`), then its web links and files (`LinksAndFilesSection`), each change
 * saved at once by the existing routes (`/applications/:id/links`, `/applications/:id/attachments`).
 */
export default function ApplicationRelationsPanel({ id, isSuite = false, onRelationsChange, onOpenKnowledge }: Props) {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const businessLabel = (code?: string | null) => classificationCatalog?.businessCriticalityLevels.find((item) => item.code === code)?.label || code || classificationText('Not set');
  const { labelFor } = useItOpsEnumOptions();
  const { t } = useTranslation(['it', 'common']);
  const dialogs = useKanapDialogs();
  const { hasLevel } = useAuth();
  const canEdit = hasLevel('applications', 'manager');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const feedback = useApplicationFeedback();
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(0);

  const linksKey = ['application-links', id] as const;
  const attachmentsKey = ['application-attachments', id] as const;
  const linksQuery = useQuery({ queryKey: linksKey, queryFn: async () => (await api.get<LinkRow[]>(`/applications/${id}/links`)).data || [] });
  const attachmentsQuery = useQuery({ queryKey: attachmentsKey, queryFn: async () => (await api.get<AttachmentRow[]>(`/applications/${id}/attachments`)).data || [] });
  // Components (children): only a suite has them.
  const componentsQuery = useQuery({
    queryKey: ['application-components', id],
    queryFn: async () => ((await api.get<{ items: Array<{ id: string; reference?: string | null; name: string; lifecycle: string; criticality: string }> }>(`/applications/${id}/components`)).data?.items || []),
    enabled: isSuite,
  });
  const components = isSuite ? componentsQuery.data ?? [] : [];

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [t]);

  const refresh = React.useCallback(async (key: readonly unknown[]) => {
    await queryClient.invalidateQueries({ queryKey: key });
    onRelationsChange?.();
  }, [onRelationsChange, queryClient]);

  const links: LinksAndFilesLink[] = (linksQuery.data ?? []).map((row) => ({ id: row.id, name: row.description, url: row.url, added_at: row.created_at }));
  const files: LinksAndFilesFile[] = (attachmentsQuery.data ?? []).map((row) => ({ id: row.id, name: row.original_filename, size: row.size, added_at: row.uploaded_at }));

  const saveLink = async (link: LinksAndFilesLink | null, draft: LinkDraft, quiet = false) => {
    setError(null);
    const body = { description: draft.name, url: draft.url };
    if (link) await api.patch(`/applications/${id}/links/${link.id}`, body);
    else await api.post(`/applications/${id}/links`, body);
    // Undo recreates the link through this same write, without a second message.
    if (!quiet) feedback.info(t(link ? 'workspace.application.relations.feedback.linkUpdated' : 'workspace.application.relations.feedback.linkAdded'));
    await refresh(linksKey);
  };

  const removeLink = async (link: LinksAndFilesLink) => {
    setError(null);
    await removeWebLinkWithUndo<LinkRow[]>({
      queryClient,
      queryKey: linksKey,
      without: (rows) => rows.filter((row) => row.id !== link.id),
      commit: () => api.delete(`/applications/${id}/links/${link.id}`),
      refresh: () => refresh(linksKey),
      restore: () => saveLink(null, webLinkDraft(link), true),
      message: t('common:linksAndFiles.removed', { name: webLinkLabel(link) }),
      feedback,
      onError: failed,
    });
  };

  const uploadFiles = async (chosen: File[]) => {
    setError(null);
    setUploading(chosen.length);
    let attached = 0;
    try {
      for (const file of chosen) {
        const form = new FormData();
        form.append('file', file);
        await api.post(`/applications/${id}/attachments`, form);
        attached += 1;
      }
      feedback.info(t('workspace.application.relations.feedback.fileAttached', { count: attached }));
    } catch (e) {
      failed(e);
    } finally {
      setUploading(0);
    }
    await refresh(attachmentsKey);
  };

  const openFile = async (file: LinksAndFilesFile) => {
    try {
      const res = await api.get(`/applications/attachments/${file.id}`, { responseType: 'blob' });
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
      await api.patch(`/applications/attachments/${file.id}/delete`, {});
      feedback.info(t('workspace.application.relations.feedback.fileDeleted'));
    } catch (e) {
      failed(e);
    }
    await refresh(attachmentsKey);
  };

  return (
    <Stack spacing={2}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {isSuite && (
        <>
          <SectionTitle>{t('pages.applications.columns.components')}</SectionTitle>
          {components.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('workspace.application.relations.noChildApps')}</Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" sx={{ '& tbody td': { py: 0.75 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common:selects.application')}</TableCell>
                    <TableCell>{t('common.lifecycle')}</TableCell>
                    <TableCell>{t('workspace.application.overview.criticality')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {components.map((c) => (
                    <TableRow
                      key={c.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={(event) => { if (!(event.target as HTMLElement).closest('a')) navigate(`/it/applications/${c.reference || c.id}/overview`); }}
                    >
                      <TableCell>
                        <Box
                          component={RouterLink}
                          to={`/it/applications/${c.reference || c.id}/overview`}
                          sx={{ color: 'inherit', textDecoration: 'none', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2, borderRadius: '2px' } }}
                        >
                          {c.name}
                        </Box>
                      </TableCell>
                      <TableCell>{labelFor('lifecycleStatus', c.lifecycle)}</TableCell>
                      <TableCell>{businessLabel(c.criticality)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      <ApplicationRelationsTab id={id} onRelationsChange={onRelationsChange} onOpenKnowledge={onOpenKnowledge} />

      <LinksAndFilesSection
        links={links}
        files={files}
        loaded={linksQuery.isSuccess && attachmentsQuery.isSuccess}
        canEdit={canEdit}
        uploading={uploading}
        onAddLink={(draft) => saveLink(null, draft)}
        onEditLink={(link, draft) => saveLink(link, draft)}
        onRemoveLink={(link) => { void removeLink(link); }}
        onUploadFiles={(chosen) => { void uploadFiles(chosen); }}
        onOpenFile={(file) => { void openFile(file); }}
        onRemoveFile={(file) => { void removeFile(file); }}
      />
    </Stack>
  );
}
