import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import { classificationText } from '../../../utils/applicationClassification';
import React, { forwardRef, useImperativeHandle } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, Stack, TextField, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Paper } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';

import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { KanapDialog, PropertyRow, RelevantWebsitesList, useKanapDialogs } from '../../../components/design';
import { drawerFieldValueSx } from '../../../theme/formSx';
import ApplicationRelationsTab from '../workspace/ApplicationRelationsTab';
export type ApplicationRelationsPanelHandle = {
  save: () => Promise<void>;
  reset: () => void;
};

type Props = { id: string; isSuite?: boolean; onDirtyChange?: (dirty: boolean) => void; onRelationsChange?: () => void; onOpenKnowledge?: () => void };

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

export default forwardRef<ApplicationRelationsPanelHandle, Props>(function ApplicationRelationsPanel({ id, isSuite = false, onDirtyChange, onRelationsChange, onOpenKnowledge }, ref) {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const businessLabel = (code?: string | null) => classificationCatalog?.businessCriticalityLevels.find((item) => item.code === code)?.label || code || classificationText('Not set');
  const { labelFor } = useItOpsEnumOptions();
  const { t } = useTranslation(['it', 'common']);
  const dialogs = useKanapDialogs();
  const { hasLevel } = useAuth();
  const readOnly = !hasLevel('applications', 'manager');

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [urls, setUrls] = React.useState<Array<{ id?: string; description?: string; url: string }>>([]);
  const [baselineUrls, setBaselineUrls] = React.useState<Array<{ id?: string; description?: string; url: string }>>([]);
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [linkDraft, setLinkDraft] = React.useState<{ description: string; url: string }>({ description: '', url: '' });
  const [editingLinkIndex, setEditingLinkIndex] = React.useState<number | null>(null);
  const linkNameInputRef = React.useRef<HTMLInputElement | null>(null);
  const urlsEditedRef = React.useRef(false);

  const [attachments, setAttachments] = React.useState<Array<{ id: string; original_filename: string }>>([]);
  const [hover, setHover] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadCount, setUploadCount] = React.useState(0);

  // Structure: reverse components when this app is a suite
  const [components, setComponents] = React.useState<Array<{ id: string; name: string; lifecycle: string; criticality: string }>>([]);

  // The linked sections save each change at once (ApplicationRelationsTab); only the websites can differ from what is stored.
  const dirty = React.useMemo(() => JSON.stringify(urls) !== JSON.stringify(baselineUrls), [urls, baselineUrls]);
  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  React.useEffect(() => {
    if (!linkDialogOpen) return undefined;
    const timer = window.setTimeout(() => {
      const input = linkNameInputRef.current;
      if (!input) return;
      input.focus();
      const cursorPosition = input.value.length;
      input.setSelectionRange(cursorPosition, cursorPosition);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [editingLinkIndex, linkDialogOpen]);

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // URLs
      try {
        const resUrls = await api.get(`/applications/${id}/links`);
        const urlItems = (resUrls.data || []).map((x: any) => ({ id: x.id, description: x.description, url: x.url }));
        setBaselineUrls(urlItems);
        if (!urlsEditedRef.current) setUrls(urlItems);
      } catch { if (!urlsEditedRef.current) setUrls([]); setBaselineUrls([]); }

      // Attachments
      try {
        const resAtt = await api.get(`/applications/${id}/attachments`);
        setAttachments(resAtt.data || []);
      } catch { setAttachments([]); }
      // Components (children) — only relevant when this app can have children (isSuite=true)
      if (isSuite) {
        try {
          const resComps = await api.get(`/applications/${id}/components`);
          const items = (resComps.data?.items || []) as Array<{ id: string; name: string; lifecycle: string; criticality: string }>;
          setComponents(items);
        } catch { setComponents([]); }
      } else {
        setComponents([]);
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadRelationsFailed')));
    } finally { setLoading(false); }
  }, [id, isSuite]);
  React.useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (readOnly) return;
    setSaving(true); setError(null);
    try {
      const existing = baselineUrls;
      const existingIds = new Set(existing.filter(x => x.id).map(x => x.id as string));
      const currentIds = new Set(urls.filter(x => x.id).map(x => x.id as string));
      for (const ex of existing) { if (ex.id && !currentIds.has(ex.id)) await api.delete(`/applications/${id}/links/${ex.id}`); }
      for (const u of urls) { if (!u.url) continue; if (u.id && existingIds.has(u.id)) await api.patch(`/applications/${id}/links/${u.id}`, { description: u.description ?? null, url: u.url }); else await api.post(`/applications/${id}/links`, { description: u.description ?? null, url: u.url }); }
      setBaselineUrls(urls);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
      throw e;
    } finally { setSaving(false); }
  };

  useImperativeHandle(ref, () => ({ save, reset: () => { urlsEditedRef.current = false; void load(); } }), [save, load]);

  const relationWideControlSx = { maxWidth: 640 } as const;
  const syncUrls = React.useCallback(async (nextUrls: Array<{ id?: string; description?: string; url: string }>) => {
    setUrls(nextUrls);
    if (readOnly) return;
    setSaving(true);
    setError(null);
    try {
      const existingIds = new Set(baselineUrls.filter((item) => item.id).map((item) => item.id as string));
      const currentIds = new Set(nextUrls.filter((item) => item.id).map((item) => item.id as string));
      for (const existing of baselineUrls) {
        if (existing.id && !currentIds.has(existing.id)) {
          await api.delete(`/applications/${id}/links/${existing.id}`);
        }
      }
      for (const link of nextUrls) {
        const url = String(link.url || '').trim();
        if (!url) continue;
        const body = { description: link.description ?? null, url };
        if (link.id && existingIds.has(link.id)) {
          await api.patch(`/applications/${id}/links/${link.id}`, body);
        } else {
          await api.post(`/applications/${id}/links`, body);
        }
      }
      const resUrls = await api.get(`/applications/${id}/links`);
      const urlItems = ((resUrls.data || []) as Array<{ id?: string; description?: string | null; url?: string }>).map((item) => ({ id: item.id, description: item.description || undefined, url: item.url || '' }));
      urlsEditedRef.current = false;
      setBaselineUrls(urlItems);
      setUrls(urlItems);
      onRelationsChange?.();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
    } finally {
      setSaving(false);
    }
  }, [baselineUrls, id, onRelationsChange, readOnly, t]);

  const openAddLinkDialog = React.useCallback(() => {
    setEditingLinkIndex(null);
    setLinkDraft({ description: '', url: '' });
    setLinkDialogOpen(true);
  }, []);

  const openEditLinkDialog = React.useCallback((index: number) => {
    const link = urls[index];
    if (!link || readOnly) return;
    setEditingLinkIndex(index);
    setLinkDraft({ description: link.description || '', url: link.url || '' });
    setLinkDialogOpen(true);
  }, [readOnly, urls]);

  const closeLinkDialog = React.useCallback(() => {
    setLinkDialogOpen(false);
    setEditingLinkIndex(null);
    setLinkDraft({ description: '', url: '' });
  }, []);

  const saveLinkDraft = React.useCallback(async () => {
    const url = String(linkDraft.url || '').trim();
    if (!url) return;
    const description = String(linkDraft.description || '').trim() || undefined;
    const nextLink = { description, url };
    const nextUrls = editingLinkIndex === null || !urls[editingLinkIndex]
      ? [...urls, nextLink]
      : urls.map((link, index) => (index === editingLinkIndex ? { ...link, ...nextLink } : link));
    urlsEditedRef.current = true;
    await syncUrls(nextUrls);
    closeLinkDialog();
  }, [closeLinkDialog, editingLinkIndex, linkDraft.description, linkDraft.url, syncUrls, urls]);

  return (
    <>
      <Stack spacing={2}>
        {!!error && <Alert severity="error">{error}</Alert>}

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
                    <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => window.open(`/it/applications/${c.id}/overview`, '_self')}>
                      <TableCell>{c.name}</TableCell>
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

        <Stack direction="row" alignItems="center" spacing={1} sx={relationWideControlSx}>
          <SectionTitle>{t('workspace.application.relations.relevantWebsites')}</SectionTitle>
          {!readOnly && (
            <Button variant="action" size="small" onClick={openAddLinkDialog}>
              {t('workspace.application.relations.addUrl')}
            </Button>
          )}
        </Stack>
        <Stack spacing={0.75}>
          <RelevantWebsitesList
            items={urls.map((link) => ({
              id: link.id,
              name: String(link.description || '').trim() || link.url,
              url: link.url,
            }))}
            nameHeader={t('common.name')}
            emptyLabel={t('workspace.application.relations.noUrls')}
            deleteLabel={t('workspace.application.relations.deleteUrl')}
            canEdit={!readOnly}
            canDelete={!readOnly}
            onEdit={openEditLinkDialog}
            onDelete={(index) => {
              urlsEditedRef.current = true;
              void syncUrls(urls.filter((_, currentIndex) => currentIndex !== index));
            }}
            sx={relationWideControlSx}
          />
        </Stack>

      <SectionTitle>{t('workspace.application.relations.attachments')}</SectionTitle>
      <Stack spacing={1} sx={relationWideControlSx}>
        <Box
          onDragOver={(e) => { e.preventDefault(); setHover(true); }}
          onDragLeave={() => setHover(false)}
          onDrop={async (e) => {
            e.preventDefault(); setHover(false);
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length === 0) return;
            setUploading(true); setUploadCount(files.length);
            try {
              for (const f of files) { const fd = new FormData(); fd.append('file', f); await api.post(`/applications/${id}/attachments`, fd); }
              const resAtt = await api.get(`/applications/${id}/attachments`);
              setAttachments(resAtt.data || []);
              onRelationsChange?.();
            } finally { setUploading(false); setUploadCount(0); }
          }}
          sx={{ border: '2px dashed', borderColor: hover ? 'primary.main' : 'divider', borderRadius: 1, p: 2, textAlign: 'center', cursor: 'pointer' }}
        >
          <Typography variant="body2" color="text.secondary">{t('workspace.application.relations.dragDrop')}</Typography>
          <Box sx={{ mt: 1 }}>
            <Button component="label" size="small" variant="outlined" disabled={uploading || readOnly}>
              {t('workspace.application.relations.selectFiles')}
              <input type="file" hidden multiple onChange={async (e) => {
                const input = e.currentTarget as HTMLInputElement | null;
                const files = Array.from((e.target as HTMLInputElement)?.files || []);
                if (files.length === 0) return;
                setUploading(true); setUploadCount(files.length);
                try {
                  for (const f of files) { const fd = new FormData(); fd.append('file', f); await api.post(`/applications/${id}/attachments`, fd); }
                  const resAtt = await api.get(`/applications/${id}/attachments`);
                  setAttachments(resAtt.data || []);
                  onRelationsChange?.();
                } finally { setUploading(false); setUploadCount(0); if (input) input.value = ''; }
              }} />
            </Button>
          </Box>
        </Box>
        {uploading && <LinearProgress sx={{ mt: 1 }} />}
        {uploading && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {t('workspace.application.relations.uploadingFiles', { count: uploadCount })}
          </Typography>
        )}
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {attachments.map((a) => {
            const canDelete = hasLevel('applications','manager') && !readOnly;
            const onDelete = async () => {
              if (!canDelete) return;
              const ok = await dialogs.confirm({
                message: t('workspace.application.relations.deleteAttachment', { name: a.original_filename }),
                confirmLabel: t('common:buttons.delete'),
                intent: 'danger',
              });
              if (!ok) return;
              try { await api.patch(`/applications/attachments/${a.id}/delete`, {}); const res = await api.get(`/applications/${id}/attachments`); setAttachments(res.data || []); onRelationsChange?.(); } catch {}
            };
            return (
              <Chip
                key={a.id}
                label={a.original_filename}
                onClick={async () => {
                  const res = await api.get(`/applications/attachments/${a.id}`, { responseType: 'blob' });
                  const blob = new Blob([res.data]);
                  const url = window.URL.createObjectURL(blob);
                  const el = document.createElement('a'); el.href = url; el.download = a.original_filename; el.click(); window.URL.revokeObjectURL(url);
                }}
                onDelete={canDelete ? onDelete : undefined}
                deleteIcon={canDelete ? <DeleteIcon fontSize="small" /> : undefined}
              />
            );
          })}
        </Stack>
      </Stack>

      </Stack>

      <KanapDialog
        open={linkDialogOpen}
        title={editingLinkIndex === null ? t('workspace.application.relations.newUrl') : t('workspace.application.relations.editUrl')}
        onClose={closeLinkDialog}
        onSave={saveLinkDraft}
        saveLabel={editingLinkIndex === null ? t('common:buttons.add') : t('common:buttons.save')}
        saveDisabled={!String(linkDraft.url || '').trim()}
        saveLoading={saving}
      >
        <Stack spacing={1.25}>
          <PropertyRow label={t('common.name')}>
            <TextField
              value={linkDraft.description}
              onChange={(event) => setLinkDraft((prev) => ({ ...prev, description: event.target.value }))}
              autoFocus
              inputRef={linkNameInputRef}
              variant="standard"
              fullWidth
              sx={drawerFieldValueSx}
            />
          </PropertyRow>
          <PropertyRow label="URL" required>
            <TextField
              value={linkDraft.url}
              onChange={(event) => setLinkDraft((prev) => ({ ...prev, url: event.target.value }))}
              variant="standard"
              fullWidth
              sx={drawerFieldValueSx}
            />
          </PropertyRow>
        </Stack>
      </KanapDialog>
    </>
  );
});
