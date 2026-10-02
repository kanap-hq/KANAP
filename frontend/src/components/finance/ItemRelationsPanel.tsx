import React, { forwardRef, useImperativeHandle } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, LinearProgress, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import ItemContactsSection from '../contacts/ItemContactsSection';
import { RelevantWebsitesList, useKanapDialogs } from '../design';
import RelationsSectionTitle from '../../pages/portfolio/components/RelationsSectionTitle';
import { drawerAutocompleteListboxSx, drawerFieldValueSx } from '../../theme/formSx';
import { useLookupPicker, type LookupScope } from '../../hooks/useLookupPicker';

/**
 * The Relations tab of an OPEX or CAPEX line: projects, applications and
 * contracts it is linked to, contacts, websites and attachments. The line's
 * relations live in the React Query cache (`itemRelationsKey`), so coming back
 * to the tab shows them at once; each picker searches on the server as the
 * user types (useLookupPicker) instead of reading every project, application
 * or contract page by page.
 */

export type RelationsPanelHandle = {
  isDirty: () => boolean;
  save: () => Promise<void>;
  reset: () => void;
};

export type ItemRelationsKind = 'opex' | 'capex';

type Props = {
  kind: ItemRelationsKind;
  id: string;
  autoSave?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onRelationsChange?: () => void;
};
type Named = { id: string; name: string };
type RelationSet = 'projects' | 'applications' | 'contracts';
type LinkItem = { id?: string; description?: string; url: string };
type Attachment = { id: string; original_filename: string };

/** The line's relations as loaded; a set whose load failed is null (shown read-only, never posted). */
type RelationsData = {
  projects: Named[] | null;
  applications: Named[] | null;
  contracts: Named[] | null;
  links: LinkItem[];
  attachments: Attachment[];
};

const KINDS = {
  opex: { itemsApi: '/spend-items', resource: 'opex', i18n: 'opex', contactsItemType: 'spend-items' },
  capex: { itemsApi: '/capex-items', resource: 'capex', i18n: 'capex', contactsItemType: 'capex-items' },
} as const;

/** The picker searches: projects and applications through their lists (their access rules apply), contracts through their lookup. */
const PICKERS: Record<RelationSet, { endpoint: string; scope?: LookupScope; href: (o: Named) => string }> = {
  projects: { endpoint: '/portfolio/projects', scope: { sort: 'name:ASC' }, href: (o) => `/portfolio/projects/${o.id}` },
  applications: { endpoint: '/applications', scope: { sort: 'name:ASC' }, href: (o) => `/it/applications/${o.id}/overview` },
  contracts: { endpoint: '/contracts/lookup', href: (o) => `/ops/contracts/${o.id}/overview` },
};

export const itemRelationsKey = (kind: ItemRelationsKind, id: string) => ['item-relations', kind, id] as const;

const relationTagSx = { borderRadius: '6px', height: 24, '& .MuiChip-label': { px: '8px', fontSize: 12 } } as const;
const relationControlSx = { maxWidth: 420 } as const;
const relationWideControlSx = { maxWidth: 640 } as const;
const relationAutocompleteSx = [drawerFieldValueSx, { width: '100%' }, relationControlSx] as const;

function sameIds(a: Named[], b: Named[]) {
  const l = a.map((x) => x.id).sort();
  const r = b.map((x) => x.id).sort();
  return JSON.stringify(l) === JSON.stringify(r);
}

const named = (r: PromiseSettledResult<any>): Named[] | null => (
  r.status === 'fulfilled' ? (r.value.data?.items || []).map((x: any) => ({ id: x.id, name: x.name })) : null
);

async function fetchRelations(itemsApi: string, id: string, signal?: AbortSignal): Promise<RelationsData> {
  const [pRes, aRes, cRes, lRes, atRes] = await Promise.allSettled([
    api.get(`${itemsApi}/${id}/projects`, { signal }),
    api.get(`${itemsApi}/${id}/applications`, { signal }),
    api.get(`${itemsApi}/${id}/contracts`, { signal }),
    api.get(`${itemsApi}/${id}/links`, { signal }),
    api.get(`${itemsApi}/${id}/attachments`, { signal }),
  ]);
  return {
    projects: named(pRes),
    applications: named(aRes),
    contracts: named(cRes),
    links: lRes.status === 'fulfilled' ? (lRes.value.data || []).map((x: any) => ({ id: x.id, description: x.description, url: x.url })) : [],
    attachments: atRes.status === 'fulfilled' ? (atRes.value.data || []) : [],
  };
}

/** One relation picker: chips of the linked rows, server search of the others as the user types. */
function RelationPicker({
  set, placeholder, value, onChange, disabled,
}: {
  set: RelationSet;
  placeholder: string;
  value: Named[];
  onChange: (next: Named[]) => void;
  disabled: boolean;
}) {
  const config = PICKERS[set];
  const picker = useLookupPicker<Named>({
    endpoint: config.endpoint,
    scope: config.scope,
    value: value.map((v) => v.id),
    given: value,
    // The search pages hold whole rows: the picker keeps id and name.
  });
  return (
    <Autocomplete
      multiple
      {...picker.autocomplete}
      options={picker.options}
      value={picker.selected}
      getOptionLabel={(o) => o.name ?? ''}
      onChange={(_, v) => {
        const next = (v as Named[]).map((o) => ({ id: o.id, name: o.name }));
        picker.remember(next);
        onChange(next);
      }}
      renderOption={(props, option) => (<li {...props} key={option.id}>{option.name}</li>)}
      renderTags={(vals, getTagProps) => vals.map((option, index) => (
        <Chip
          {...getTagProps({ index })}
          key={option.id}
          label={option.name}
          sx={relationTagSx}
          onClick={() => window.open(config.href(option), '_self')}
          clickable
        />
      ))}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder}
          variant="standard"
          InputProps={{
            ...params.InputProps,
            endAdornment: (<>{picker.loading ? <CircularProgress color="inherit" size={16} /> : null}{params.InputProps.endAdornment}</>),
          }}
          sx={drawerFieldValueSx}
        />
      )}
      ListboxProps={{ sx: drawerAutocompleteListboxSx }}
      filterSelectedOptions
      disabled={disabled}
      sx={relationAutocompleteSx}
    />
  );
}

export default forwardRef<RelationsPanelHandle, Props>(function ItemRelationsPanel({ kind, id, autoSave = true, onDirtyChange, onRelationsChange }, ref) {
  const { itemsApi, resource, i18n, contactsItemType } = KINDS[kind];
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['ops', 'common']);
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const readOnly = !hasLevel(resource, 'manager');

  const relationsQuery = useQuery({
    queryKey: itemRelationsKey(kind, id),
    queryFn: ({ signal }) => fetchRelations(itemsApi, id, signal),
  });
  const data = relationsQuery.data;
  // Fields stay disabled until the line's relations are known (never an edit on an unknown set).
  const loading = !data;

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [projects, setProjects] = React.useState<Named[]>([]);
  const [baselineProjects, setBaselineProjects] = React.useState<Named[]>([]);
  const [apps, setApps] = React.useState<Named[]>([]);
  const [baselineApps, setBaselineApps] = React.useState<Named[]>([]);
  const [contracts, setContracts] = React.useState<Named[]>([]);
  const [baselineContracts, setBaselineContracts] = React.useState<Named[]>([]);
  const [links, setLinks] = React.useState<LinkItem[]>([]);
  const [baselineLinks, setBaselineLinks] = React.useState<LinkItem[]>([]);
  const [hover, setHover] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadCount, setUploadCount] = React.useState(0);

  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [linkDraft, setLinkDraft] = React.useState<{ description: string; url: string }>({ description: '', url: '' });
  const [editingLinkIndex, setEditingLinkIndex] = React.useState<number | null>(null);

  // Sets whose load failed stay read-only and are never posted: saving them would replace the stored links with nothing.
  const failedSets = React.useMemo<ReadonlySet<RelationSet>>(() => {
    const failed = new Set<RelationSet>();
    if (data && !data.projects) failed.add('projects');
    if (data && !data.applications) failed.add('applications');
    if (data && !data.contracts) failed.add('contracts');
    return failed;
  }, [data]);

  const dirty = React.useMemo(() => (
    !sameIds(projects, baselineProjects)
    || !sameIds(apps, baselineApps)
    || !sameIds(contracts, baselineContracts)
    || JSON.stringify(links) !== JSON.stringify(baselineLinks)
  ), [projects, baselineProjects, apps, baselineApps, contracts, baselineContracts, links, baselineLinks]);
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // The loaded relations become the baseline; the shown values follow them unless an edit is pending.
  // Before paint: cached relations show on the first frame.
  React.useLayoutEffect(() => {
    if (!data) return;
    const p = data.projects ?? []; const a = data.applications ?? []; const c = data.contracts ?? [];
    const keepEdits = dirtyRef.current;
    setBaselineProjects(p); setBaselineApps(a); setBaselineContracts(c); setBaselineLinks(data.links);
    if (!keepEdits) { setProjects(p); setApps(a); setContracts(c); setLinks(data.links); }
  }, [data]);
  React.useEffect(() => {
    if (failedSets.size > 0) setError(t(`${i18n}.relations.failedToLoad`));
  }, [failedSets, i18n, t]);

  const reload = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: itemRelationsKey(kind, id) });
  }, [queryClient, kind, id]);

  const save = React.useCallback(async () => {
    if (readOnly || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      // Post a set only when it changed, so an untouched set is not deleted and re-inserted.
      if (!failedSets.has('projects') && !sameIds(projects, baselineProjects)) {
        await api.post(`${itemsApi}/${id}/projects/bulk-replace`, { project_ids: projects.map((x) => x.id) });
      }
      if (!failedSets.has('applications') && !sameIds(apps, baselineApps)) {
        await api.post(`${itemsApi}/${id}/applications/bulk-replace`, { application_ids: apps.map((x) => x.id) });
      }
      if (!failedSets.has('contracts') && !sameIds(contracts, baselineContracts)) {
        await api.post(`${itemsApi}/${id}/contracts/bulk-replace`, { contract_ids: contracts.map((x) => x.id) });
      }
      const currentIds = new Set(links.filter((x) => x.id).map((x) => x.id as string));
      for (const ex of baselineLinks) { if (ex.id && !currentIds.has(ex.id)) await api.delete(`${itemsApi}/${id}/links/${ex.id}`); }
      for (const u of links) {
        if (!String(u.url || '').trim()) continue;
        if (u.id) await api.patch(`${itemsApi}/${id}/links/${u.id}`, { description: u.description ?? null, url: u.url });
        else await api.post(`${itemsApi}/${id}/links`, { description: u.description ?? null, url: u.url });
      }
      // What was saved is the new baseline at once; the reload brings the stored rows (new link ids).
      setBaselineProjects(projects); setBaselineApps(apps); setBaselineContracts(contracts); setBaselineLinks(links);
      dirtyRef.current = false;
      await reload();
      onRelationsChange?.();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t(`${i18n}.relations.failedToSave`)));
      throw e;
    } finally {
      setSaving(false);
    }
  }, [readOnly, dirty, itemsApi, id, failedSets, projects, baselineProjects, apps, baselineApps, contracts, baselineContracts, links, baselineLinks, reload, onRelationsChange, i18n, t]);

  // Debounced autosave on change.
  React.useEffect(() => {
    if (!autoSave || !dirty || saving || loading || readOnly) return undefined;
    const timer = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [autoSave, dirty, saving, loading, readOnly, save]);

  const reset = React.useCallback(() => {
    dirtyRef.current = false;
    if (data) {
      setProjects(data.projects ?? []); setApps(data.applications ?? []); setContracts(data.contracts ?? []); setLinks(data.links);
    }
    void reload();
  }, [data, reload]);

  useImperativeHandle(ref, () => ({ isDirty: () => dirty, save, reset }), [dirty, save, reset]);

  const attachments = data?.attachments ?? [];
  const reloadAttachments = React.useCallback(async () => {
    try {
      const res = await api.get(`${itemsApi}/${id}/attachments`);
      queryClient.setQueryData<RelationsData>(itemRelationsKey(kind, id), (prev) => (prev ? { ...prev, attachments: res.data || [] } : prev));
    } catch { /* best effort */ }
  }, [itemsApi, id, queryClient, kind]);

  const handleUpload = async (files: File[]) => {
    if (files.length === 0 || readOnly) return;
    setUploading(true); setUploadCount(files.length);
    try {
      for (const f of files) { const fd = new FormData(); fd.append('file', f); await api.post(`${itemsApi}/${id}/attachments`, fd); }
      await reloadAttachments();
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

  const sets: Array<{ set: RelationSet; title: string; placeholder: string; value: Named[]; setValue: (v: Named[]) => void }> = [
    { set: 'projects', title: t(`${i18n}.relations.projects`), placeholder: t(`${i18n}.relations.selectProjects`), value: projects, setValue: setProjects },
    { set: 'applications', title: t(`${i18n}.relations.applications`), placeholder: t(`${i18n}.relations.selectApplications`), value: apps, setValue: setApps },
    { set: 'contracts', title: t(`${i18n}.relations.contracts`), placeholder: t(`${i18n}.relations.selectContracts`), value: contracts, setValue: setContracts },
  ];

  return (
    <>
      <Stack spacing={3} sx={{ pt: 1 }}>
        {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        {sets.map((entry) => (
          <Stack key={entry.set} spacing={1.25}>
            <RelationsSectionTitle>{entry.title}</RelationsSectionTitle>
            <RelationPicker
              set={entry.set}
              placeholder={entry.placeholder}
              value={entry.value}
              onChange={entry.setValue}
              disabled={readOnly || loading || failedSets.has(entry.set)}
            />
          </Stack>
        ))}

        <ItemContactsSection itemType={contactsItemType} itemId={id} canManage={!readOnly} />

        <Stack spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1} sx={relationWideControlSx}>
            <RelationsSectionTitle>{t(`${i18n}.relations.relevantWebsites`)}</RelationsSectionTitle>
            {!readOnly && <Button size="small" startIcon={<AddIcon />} onClick={openAddLink}>{t(`${i18n}.relations.addUrl`)}</Button>}
          </Stack>
          <RelevantWebsitesList
            items={links.map((it) => ({ id: it.id, name: String(it.description || '').trim() || it.url, url: it.url }))}
            nameHeader={t(`${i18n}.relations.linkName`, 'Name')}
            urlHeader={t(`${i18n}.relations.linkUrl`, 'URL')}
            emptyLabel={t(`${i18n}.relations.noWebsites`, 'No links added')}
            deleteLabel={t(`${i18n}.relations.deleteWebsite`, 'Delete link')}
            canEdit={!readOnly}
            canDelete={!readOnly}
            onEdit={openEditLink}
            onDelete={(index) => setLinks((prev) => prev.filter((_, i) => i !== index))}
            sx={relationWideControlSx}
          />
        </Stack>

        <Stack spacing={1.25}>
          <RelationsSectionTitle>{t(`${i18n}.relations.attachments`)}</RelationsSectionTitle>
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
                {readOnly ? t(`${i18n}.relations.noUploadPermission`) : t(`${i18n}.relations.dragDrop`)}
              </Typography>
              <Box sx={{ mt: 1 }}>
                <Button component="label" size="small" variant="outlined" disabled={uploading || readOnly}>
                  {t(`${i18n}.relations.selectFiles`)}
                  <input type="file" hidden multiple onChange={async (e) => {
                    const input = e.currentTarget as HTMLInputElement | null;
                    await handleUpload(Array.from(e.target.files || []));
                    if (input) input.value = '';
                  }} />
                </Button>
              </Box>
            </Box>
            {uploading && <LinearProgress sx={{ mt: 1 }} />}
            {uploading && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{t(`${i18n}.relations.uploadingFiles`, { count: uploadCount })}</Typography>}
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {attachments.map((a) => (
                <Chip
                  key={a.id}
                  label={a.original_filename}
                  sx={relationTagSx}
                  onClick={async () => {
                    const res = await api.get(`${itemsApi}/attachments/${a.id}`, { responseType: 'blob' });
                    const url = window.URL.createObjectURL(new Blob([res.data]));
                    const el = document.createElement('a'); el.href = url; el.download = a.original_filename; el.click(); window.URL.revokeObjectURL(url);
                  }}
                  onDelete={!readOnly ? async () => {
                    const ok = await dialogs.confirm({ message: t('confirmations.deleteAttachment', { name: a.original_filename }), confirmLabel: t('common:buttons.delete'), intent: 'danger' });
                    if (!ok) return;
                    try { await api.patch(`${itemsApi}/attachments/${a.id}/delete`, {}); await reloadAttachments(); onRelationsChange?.(); } catch { /* best effort */ }
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
          <DialogTitle>{editingLinkIndex === null ? t(`${i18n}.relations.addLinkTitle`, 'Add link') : t(`${i18n}.relations.editLinkTitle`, 'Edit link')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField autoFocus aria-label={t(`${i18n}.relations.linkName`, 'Name')} placeholder={t(`${i18n}.relations.linkDescriptionPlaceholder`, 'e.g., vendor portal')} value={linkDraft.description} onChange={(e) => setLinkDraft((p) => ({ ...p, description: e.target.value }))} variant="standard" />
              <TextField aria-label={t(`${i18n}.relations.linkUrl`, 'URL')} placeholder="https://..." value={linkDraft.url} onChange={(e) => setLinkDraft((p) => ({ ...p, url: e.target.value }))} variant="standard" />
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
