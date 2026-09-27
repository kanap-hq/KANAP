import React, { forwardRef, useImperativeHandle } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, LinearProgress, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import ItemContactsSection from '../../../components/contacts/ItemContactsSection';
import { RelevantWebsitesList, useKanapDialogs } from '../../../components/design';
import RelationsSectionTitle from '../../portfolio/components/RelationsSectionTitle';
import { drawerAutocompleteListboxSx, drawerFieldValueSx } from '../../../theme/formSx';

export type RelationsPanelHandle = {
  isDirty: () => boolean;
  save: () => Promise<void>;
  reset: () => void;
};

type Props = { id: string; autoSave?: boolean; onDirtyChange?: (dirty: boolean) => void; onRelationsChange?: () => void };
type Named = { id: string; name: string };
type RelationSet = 'projects' | 'applications' | 'contracts';
type LinkItem = { id?: string; description?: string; url: string };

const relationTagSx = { borderRadius: '6px', height: 24, '& .MuiChip-label': { px: '8px', fontSize: 12 } } as const;
const relationControlSx = { maxWidth: 420 } as const;
const relationWideControlSx = { maxWidth: 640 } as const;
const relationAutocompleteSx = [drawerFieldValueSx, { width: '100%' }, relationControlSx] as const;

function sameIds(a: Named[], b: Named[]) {
  const l = a.map((x) => x.id).sort();
  const r = b.map((x) => x.id).sort();
  return JSON.stringify(l) === JSON.stringify(r);
}

async function fetchAllPaged(endpoint: string, sortField: string): Promise<Named[]> {
  const all: Named[] = [];
  let page = 1; const limit = 100; let total = Infinity;
  while ((page - 1) * limit < total) {
    const res = await api.get(endpoint, { params: { page, limit, sort: `${sortField}:ASC` } });
    const items = (res.data?.items || []).map((x: any) => ({ id: x.id, name: x.name }));
    total = Number(res.data?.total || items.length);
    all.push(...items);
    if (items.length < limit) break;
    page += 1;
  }
  return all;
}

export default forwardRef<RelationsPanelHandle, Props>(function RelationsPanel({ id, autoSave = true, onDirtyChange, onRelationsChange }, ref) {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['ops', 'common']);
  const dialogs = useKanapDialogs();
  const readOnly = !hasLevel('opex', 'manager');

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [projects, setProjects] = React.useState<Named[]>([]);
  const [baselineProjects, setBaselineProjects] = React.useState<Named[]>([]);
  const [projectOptions, setProjectOptions] = React.useState<Named[]>([]);
  const [loadingProjects, setLoadingProjects] = React.useState(false);

  const [apps, setApps] = React.useState<Named[]>([]);
  const [baselineApps, setBaselineApps] = React.useState<Named[]>([]);
  const [appOptions, setAppOptions] = React.useState<Named[]>([]);
  const [loadingApps, setLoadingApps] = React.useState(false);

  const [contracts, setContracts] = React.useState<Named[]>([]);
  const [baselineContracts, setBaselineContracts] = React.useState<Named[]>([]);
  const [contractOptions, setContractOptions] = React.useState<Named[]>([]);
  const [loadingContracts, setLoadingContracts] = React.useState(false);

  const [links, setLinks] = React.useState<LinkItem[]>([]);
  const [baselineLinks, setBaselineLinks] = React.useState<LinkItem[]>([]);
  const [attachments, setAttachments] = React.useState<Array<{ id: string; original_filename: string }>>([]);
  const [hover, setHover] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadCount, setUploadCount] = React.useState(0);

  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [linkDraft, setLinkDraft] = React.useState<{ description: string; url: string }>({ description: '', url: '' });
  const [editingLinkIndex, setEditingLinkIndex] = React.useState<number | null>(null);

  // Sets whose load failed stay read-only and are never posted: saving them would replace the stored links with nothing.
  const [failedSets, setFailedSets] = React.useState<ReadonlySet<RelationSet>>(new Set());

  const dirty = React.useMemo(() => (
    !sameIds(projects, baselineProjects)
    || !sameIds(apps, baselineApps)
    || !sameIds(contracts, baselineContracts)
    || JSON.stringify(links) !== JSON.stringify(baselineLinks)
  ), [projects, baselineProjects, apps, baselineApps, contracts, baselineContracts, links, baselineLinks]);
  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, aRes, cRes, lRes, atRes] = await Promise.allSettled([
        api.get(`/spend-items/${id}/projects`),
        api.get(`/spend-items/${id}/applications`),
        api.get(`/spend-items/${id}/contracts`),
        api.get(`/spend-items/${id}/links`),
        api.get(`/spend-items/${id}/attachments`),
      ]);
      const named = (r: PromiseSettledResult<any>) => r.status === 'fulfilled' ? (r.value.data?.items || []).map((x: any) => ({ id: x.id, name: x.name })) : [];
      const p = named(pRes); setProjects(p); setBaselineProjects(p);
      const a = named(aRes); setApps(a); setBaselineApps(a);
      const c = named(cRes); setContracts(c); setBaselineContracts(c);
      const failed = new Set<RelationSet>();
      if (pRes.status === 'rejected') failed.add('projects');
      if (aRes.status === 'rejected') failed.add('applications');
      if (cRes.status === 'rejected') failed.add('contracts');
      setFailedSets(failed);
      if (failed.size > 0) setError(t('opex.relations.failedToLoad'));
      const l = lRes.status === 'fulfilled' ? (lRes.value.data || []).map((x: any) => ({ id: x.id, description: x.description, url: x.url })) : [];
      setLinks(l); setBaselineLinks(l);
      setAttachments(atRes.status === 'fulfilled' ? (atRes.value.data || []) : []);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('opex.relations.failedToLoad')));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  React.useEffect(() => { void load(); }, [load]);

  const save = React.useCallback(async () => {
    if (readOnly || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      // Post a set only when it changed, so an untouched set is not deleted and re-inserted.
      if (!failedSets.has('projects') && !sameIds(projects, baselineProjects)) {
        await api.post(`/spend-items/${id}/projects/bulk-replace`, { project_ids: projects.map((x) => x.id) });
      }
      if (!failedSets.has('applications') && !sameIds(apps, baselineApps)) {
        await api.post(`/spend-items/${id}/applications/bulk-replace`, { application_ids: apps.map((x) => x.id) });
      }
      if (!failedSets.has('contracts') && !sameIds(contracts, baselineContracts)) {
        await api.post(`/spend-items/${id}/contracts/bulk-replace`, { contract_ids: contracts.map((x) => x.id) });
      }
      const currentIds = new Set(links.filter((x) => x.id).map((x) => x.id as string));
      for (const ex of baselineLinks) { if (ex.id && !currentIds.has(ex.id)) await api.delete(`/spend-items/${id}/links/${ex.id}`); }
      for (const u of links) {
        if (!String(u.url || '').trim()) continue;
        if (u.id) await api.patch(`/spend-items/${id}/links/${u.id}`, { description: u.description ?? null, url: u.url });
        else await api.post(`/spend-items/${id}/links`, { description: u.description ?? null, url: u.url });
      }
      await load();
      onRelationsChange?.();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('opex.relations.failedToSave')));
      throw e;
    } finally {
      setSaving(false);
    }
  }, [readOnly, dirty, id, failedSets, projects, baselineProjects, apps, baselineApps, contracts, baselineContracts, links, baselineLinks, load, onRelationsChange, t]);

  // Debounced autosave on change.
  React.useEffect(() => {
    if (!autoSave || !dirty || saving || loading || readOnly) return undefined;
    const timer = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [autoSave, dirty, saving, loading, readOnly, save]);

  useImperativeHandle(ref, () => ({ isDirty: () => dirty, save, reset: () => { void load(); } }), [dirty, save, load]);

  const loadOptions = React.useCallback(async (
    endpoint: string, sortField: string, query: string,
    setter: React.Dispatch<React.SetStateAction<Named[]>>, loadingSetter: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    loadingSetter(true);
    try {
      if (query.trim()) {
        const res = await api.get(endpoint, { params: { limit: 50, sort: `${sortField}:ASC`, q: query.trim() } });
        setter((res.data?.items || []).map((x: any) => ({ id: x.id, name: x.name })));
      } else {
        setter(await fetchAllPaged(endpoint, sortField));
      }
    } catch { setter([]); } finally { loadingSetter(false); }
  }, []);

  const loadAttachments = React.useCallback(async () => {
    try { const res = await api.get(`/spend-items/${id}/attachments`); setAttachments(res.data || []); } catch { /* best effort */ }
  }, [id]);

  const handleUpload = async (files: File[]) => {
    if (files.length === 0 || readOnly) return;
    setUploading(true); setUploadCount(files.length);
    try {
      for (const f of files) { const fd = new FormData(); fd.append('file', f); await api.post(`/spend-items/${id}/attachments`, fd); }
      await loadAttachments();
      onRelationsChange?.();
    } finally { setUploading(false); setUploadCount(0); }
  };

  const openAddLink = () => { setEditingLinkIndex(null); setLinkDraft({ description: '', url: '' }); setLinkDialogOpen(true); };
  const openEditLink = (index: number) => { const l = links[index]; if (!l || readOnly) return; setEditingLinkIndex(index); setLinkDraft({ description: l.description || '', url: l.url || '' }); setLinkDialogOpen(true); };
  const saveLinkDraft = (e: React.FormEvent) => {
    e.preventDefault();
    const url = String(linkDraft.url || '').trim();
    if (!url) return;
    const description = String(linkDraft.description || '').trim() || undefined;
    setLinks((prev) => editingLinkIndex === null || !prev[editingLinkIndex]
      ? [...prev, { description, url }]
      : prev.map((it, i) => (i === editingLinkIndex ? { ...it, description, url } : it)));
    setLinkDialogOpen(false);
  };

  const renderMulti = (
    section: string, value: Named[], options: Named[], loadingOpts: boolean,
    setValue: (v: Named[]) => void, ensureOptions: () => void, onSearch: (q: string) => void,
    chipHref?: (o: Named) => string, loadFailed = false,
  ) => (
    <Autocomplete
      multiple
      options={options}
      value={value}
      getOptionLabel={(o) => o.name}
      onChange={(_, v) => setValue(v as Named[])}
      onOpen={() => { if (options.length === 0 && !loadingOpts) ensureOptions(); }}
      onInputChange={(_, v, reason) => { if (reason !== 'reset') onSearch(v); }}
      renderOption={(props, option) => (<li {...props} key={option.id}>{option.name}</li>)}
      renderTags={(vals, getTagProps) => vals.map((option, index) => (
        <Chip
          {...getTagProps({ index })}
          key={option.id}
          label={option.name}
          sx={relationTagSx}
          onClick={chipHref ? () => window.open(chipHref(option), '_self') : undefined}
          clickable={!!chipHref}
        />
      ))}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={section}
          variant="standard"
          InputProps={{
            ...params.InputProps,
            endAdornment: (<>{loadingOpts ? <CircularProgress color="inherit" size={16} /> : null}{params.InputProps.endAdornment}</>),
          }}
          sx={drawerFieldValueSx}
        />
      )}
      ListboxProps={{ sx: drawerAutocompleteListboxSx }}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      filterSelectedOptions
      disabled={readOnly || loading || loadFailed}
      sx={relationAutocompleteSx}
    />
  );

  return (
    <>
      <Stack spacing={3} sx={{ pt: 1 }}>
        {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        <Stack spacing={1.25}>
          <RelationsSectionTitle>{t('opex.relations.projects')}</RelationsSectionTitle>
          {renderMulti(t('opex.relations.selectProjects'), projects, projectOptions, loadingProjects, setProjects,
            () => void loadOptions('/portfolio/projects', 'name', '', setProjectOptions, setLoadingProjects),
            (q) => void loadOptions('/portfolio/projects', 'name', q, setProjectOptions, setLoadingProjects),
            (o) => `/portfolio/projects/${o.id}`, failedSets.has('projects'))}
        </Stack>

        <Stack spacing={1.25}>
          <RelationsSectionTitle>{t('opex.relations.applications')}</RelationsSectionTitle>
          {renderMulti(t('opex.relations.selectApplications'), apps, appOptions, loadingApps, setApps,
            () => void loadOptions('/applications', 'name', '', setAppOptions, setLoadingApps),
            (q) => void loadOptions('/applications', 'name', q, setAppOptions, setLoadingApps),
            (o) => `/it/applications/${o.id}/overview`, failedSets.has('applications'))}
        </Stack>

        <Stack spacing={1.25}>
          <RelationsSectionTitle>{t('opex.relations.contracts')}</RelationsSectionTitle>
          {renderMulti(t('opex.relations.selectContracts'), contracts, contractOptions, loadingContracts, setContracts,
            () => void loadOptions('/contracts', 'name', '', setContractOptions, setLoadingContracts),
            (q) => void loadOptions('/contracts', 'name', q, setContractOptions, setLoadingContracts),
            (o) => `/ops/contracts/${o.id}/overview`, failedSets.has('contracts'))}
        </Stack>

        <ItemContactsSection itemType="spend-items" itemId={id} canManage={!readOnly} />

        <Stack spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1} sx={relationWideControlSx}>
            <RelationsSectionTitle>{t('opex.relations.relevantWebsites')}</RelationsSectionTitle>
            {!readOnly && <Button size="small" startIcon={<AddIcon />} onClick={openAddLink}>{t('opex.relations.addUrl')}</Button>}
          </Stack>
          <RelevantWebsitesList
            items={links.map((it) => ({ id: it.id, name: String(it.description || '').trim() || it.url, url: it.url }))}
            nameHeader={t('opex.relations.linkName', 'Name')}
            urlHeader={t('opex.relations.linkUrl', 'URL')}
            emptyLabel={t('opex.relations.noWebsites', 'No links added')}
            deleteLabel={t('opex.relations.deleteWebsite', 'Delete link')}
            canEdit={!readOnly}
            canDelete={!readOnly}
            onEdit={openEditLink}
            onDelete={(index) => setLinks((prev) => prev.filter((_, i) => i !== index))}
            sx={relationWideControlSx}
          />
        </Stack>

        <Stack spacing={1.25}>
          <RelationsSectionTitle>{t('opex.relations.attachments')}</RelationsSectionTitle>
          <Stack spacing={1} sx={relationControlSx}>
            <Box
              onDragOver={(e) => { if (!readOnly) { e.preventDefault(); setHover(true); } }}
              onDragLeave={() => setHover(false)}
              onDrop={(e) => { e.preventDefault(); setHover(false); void handleUpload(Array.from(e.dataTransfer.files || [])); }}
              sx={(theme) => ({
                border: `1px dashed ${hover ? theme.palette.kanap.teal : theme.palette.kanap.border.default}`,
                borderRadius: '8px', p: 2, textAlign: 'center',
                cursor: readOnly ? 'default' : 'pointer', bgcolor: hover ? theme.palette.kanap.bg.hover : 'transparent',
              })}
            >
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                {readOnly ? t('opex.relations.noUploadPermission') : t('opex.relations.dragDrop')}
              </Typography>
              <Box sx={{ mt: 1 }}>
                <Button component="label" size="small" variant="outlined" disabled={uploading || readOnly}>
                  {t('opex.relations.selectFiles')}
                  <input type="file" hidden multiple onChange={async (e) => {
                    const input = e.currentTarget as HTMLInputElement | null;
                    await handleUpload(Array.from(e.target.files || []));
                    if (input) input.value = '';
                  }} />
                </Button>
              </Box>
            </Box>
            {uploading && <LinearProgress sx={{ mt: 1 }} />}
            {uploading && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{t('opex.relations.uploadingFiles', { count: uploadCount })}</Typography>}
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {attachments.map((a) => (
                <Chip
                  key={a.id}
                  label={a.original_filename}
                  sx={relationTagSx}
                  onClick={async () => {
                    const res = await api.get(`/spend-items/attachments/${a.id}`, { responseType: 'blob' });
                    const url = window.URL.createObjectURL(new Blob([res.data]));
                    const el = document.createElement('a'); el.href = url; el.download = a.original_filename; el.click(); window.URL.revokeObjectURL(url);
                  }}
                  onDelete={!readOnly ? async () => {
                    const ok = await dialogs.confirm({ message: t('confirmations.deleteAttachment', { name: a.original_filename }), confirmLabel: t('common:buttons.delete'), intent: 'danger' });
                    if (!ok) return;
                    try { await api.patch(`/spend-items/attachments/${a.id}/delete`, {}); await loadAttachments(); onRelationsChange?.(); } catch { /* best effort */ }
                  } : undefined}
                  deleteIcon={!readOnly ? <DeleteIcon sx={{ fontSize: 16 }} /> : undefined}
                />
              ))}
            </Stack>
          </Stack>
        </Stack>
      </Stack>

      <Dialog open={linkDialogOpen} onClose={() => setLinkDialogOpen(false)} fullWidth maxWidth="xs">
        <Box component="form" onSubmit={saveLinkDraft}>
          <DialogTitle>{editingLinkIndex === null ? t('opex.relations.addLinkTitle', 'Add link') : t('opex.relations.editLinkTitle', 'Edit link')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField autoFocus aria-label={t('opex.relations.linkName', 'Name')} placeholder={t('opex.relations.linkDescriptionPlaceholder', 'e.g., vendor portal')} value={linkDraft.description} onChange={(e) => setLinkDraft((p) => ({ ...p, description: e.target.value }))} variant="standard" />
              <TextField aria-label={t('opex.relations.linkUrl', 'URL')} placeholder="https://..." value={linkDraft.url} onChange={(e) => setLinkDraft((p) => ({ ...p, url: e.target.value }))} variant="standard" />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLinkDialogOpen(false)}>{t('common:buttons.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={!String(linkDraft.url || '').trim()}>{editingLinkIndex === null ? t('common:buttons.add') : t('common:buttons.save')}</Button>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
});
