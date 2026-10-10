import React, { forwardRef, useImperativeHandle } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { drawerAutocompleteListboxSx, drawerFieldValueSx } from '../../../theme/formSx';
import { RelevantWebsitesList, useKanapDialogs } from '../../../components/design';
import RelationsSectionTitle from '../components/RelationsSectionTitle';

export type PortfolioRelationsEditorHandle = {
  save: () => Promise<void>;
  reset: () => void;
  isDirty: () => boolean;
};

type EntityType = 'request' | 'project';

type LinkItem = {
  id?: string;
  label?: string;
  url: string;
};

type NamedItem = {
  id: string;
  name: string;
  summary?: string | null;
};

type AttachmentItem = {
  id: string;
  original_filename: string;
};

type Props = {
  autoSave?: boolean;
  entityId: string;
  entityType: EntityType;
  onDirtyChange?: (dirty: boolean) => void;
  onRelationsChange?: () => void;
};

const relationTagSx = {
  borderRadius: '6px',
  height: 24,
  '& .MuiChip-label': { px: '8px', fontSize: 12 },
} as const;

const relationControlSx = { maxWidth: 420 } as const;
const relationWideControlSx = { maxWidth: 640 } as const;
const relationAutocompleteSx = [drawerFieldValueSx, { width: '100%' }, relationControlSx] as const;

const endpointBaseByType: Record<EntityType, string> = {
  request: '/portfolio/requests',
  project: '/portfolio/projects',
};

const permissionByType: Record<EntityType, 'portfolio_requests' | 'portfolio_projects'> = {
  request: 'portfolio_requests',
  project: 'portfolio_projects',
};

function sortByName<T extends NamedItem>(items: T[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSummary(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function sameIdList(a: Array<{ id: string }>, b: Array<{ id: string }>) {
  const left = [...a].map((item) => item.id).sort();
  const right = [...b].map((item) => item.id).sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

export default forwardRef<PortfolioRelationsEditorHandle, Props>(function PortfolioRelationsEditor({
  autoSave = false,
  entityId,
  entityType,
  onDirtyChange,
  onRelationsChange,
}, ref) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const dialogs = useKanapDialogs();
  const { hasLevel } = useAuth();
  const readOnly = !hasLevel(permissionByType[entityType], 'manager');
  const endpointBase = `${endpointBaseByType[entityType]}/${entityId}`;
  const attachmentDownloadBase = `${endpointBaseByType[entityType]}/attachments`;

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [linkedOpex, setLinkedOpex] = React.useState<Array<{ id: string; product_name: string }>>([]);
  const [baselineOpex, setBaselineOpex] = React.useState<Array<{ id: string; product_name: string }>>([]);
  const [opexOptions, setOpexOptions] = React.useState<Array<{ id: string; product_name: string }>>([]);
  const [loadingOpexOptions, setLoadingOpexOptions] = React.useState(false);

  const [linkedCapex, setLinkedCapex] = React.useState<Array<{ id: string; description: string }>>([]);
  const [baselineCapex, setBaselineCapex] = React.useState<Array<{ id: string; description: string }>>([]);
  const [capexOptions, setCapexOptions] = React.useState<Array<{ id: string; description: string }>>([]);
  const [loadingCapexOptions, setLoadingCapexOptions] = React.useState(false);

  const [linkedApplications, setLinkedApplications] = React.useState<NamedItem[]>([]);
  const [baselineApplications, setBaselineApplications] = React.useState<NamedItem[]>([]);
  const [applicationOptions, setApplicationOptions] = React.useState<NamedItem[]>([]);
  const [loadingApplications, setLoadingApplications] = React.useState(false);

  const [linkedAssets, setLinkedAssets] = React.useState<NamedItem[]>([]);
  const [baselineAssets, setBaselineAssets] = React.useState<NamedItem[]>([]);
  const [assetOptions, setAssetOptions] = React.useState<NamedItem[]>([]);
  const [loadingAssets, setLoadingAssets] = React.useState(false);

  const [links, setLinks] = React.useState<LinkItem[]>([]);
  const [baselineLinks, setBaselineLinks] = React.useState<LinkItem[]>([]);
  const [attachments, setAttachments] = React.useState<AttachmentItem[]>([]);
  const [hover, setHover] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadCount, setUploadCount] = React.useState(0);
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [linkDraft, setLinkDraft] = React.useState<{ label: string; url: string }>({ label: '', url: '' });
  const [editingLinkIndex, setEditingLinkIndex] = React.useState<number | null>(null);
  const linkNameInputRef = React.useRef<HTMLInputElement | null>(null);

  const dirty = React.useMemo(() => (
    !sameIdList(linkedOpex, baselineOpex)
    || !sameIdList(linkedCapex, baselineCapex)
    || !sameIdList(linkedApplications, baselineApplications)
    || !sameIdList(linkedAssets, baselineAssets)
    || JSON.stringify(links) !== JSON.stringify(baselineLinks)
  ), [
    baselineApplications,
    baselineAssets,
    baselineCapex,
    baselineLinks,
    baselineOpex,
    linkedApplications,
    linkedAssets,
    linkedCapex,
    linkedOpex,
    links,
  ]);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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

  const fetchAllPaged = React.useCallback(async (endpoint: string, sortField: string) => {
    const all: any[] = [];
    let page = 1;
    const limit = 100;
    let total = Infinity;
    while ((page - 1) * limit < total) {
      const res = await api.get(endpoint, { params: { page, limit, sort: `${sortField}:ASC` } });
      const items = (res.data?.items || []) as any[];
      total = Number(res.data?.total || items.length);
      all.push(...items);
      if (items.length < limit) break;
      page += 1;
    }
    return all;
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entityRes, appsRes, assetsRes] = await Promise.allSettled([
        api.get(endpointBase, { params: { include: 'opex,capex,urls,attachments' } }),
        api.get(`${endpointBase}/applications`),
        api.get(`${endpointBase}/assets`),
      ]);

      if (entityRes.status === 'fulfilled') {
        const data = entityRes.value.data || {};
        const opexItems = (data?.opex_items || []).map((item: any) => ({ id: item.id, product_name: item.product_name }));
        const capexItems = (data?.capex_items || []).map((item: any) => ({ id: item.id, description: item.description }));
        const linkItems = (data?.urls || []).map((item: any) => ({ id: item.id, label: item.label, url: item.url }));
        setLinkedOpex(opexItems);
        setBaselineOpex(opexItems);
        setLinkedCapex(capexItems);
        setBaselineCapex(capexItems);
        setLinks(linkItems);
        setBaselineLinks(linkItems);
        setAttachments(data?.attachments || []);
      } else {
        setLinkedOpex([]);
        setBaselineOpex([]);
        setLinkedCapex([]);
        setBaselineCapex([]);
        setLinks([]);
        setBaselineLinks([]);
        setAttachments([]);
      }

      if (appsRes.status === 'fulfilled') {
        const items = sortByName((appsRes.value.data?.items || []).map((item: any) => ({
          id: item.id,
          name: item.name || item.id,
          summary: normalizeSummary(item.description ?? item.summary),
        })));
        setLinkedApplications(items);
        setBaselineApplications(items);
      } else {
        setLinkedApplications([]);
        setBaselineApplications([]);
      }

      if (assetsRes.status === 'fulfilled') {
        const items = sortByName((assetsRes.value.data?.items || []).map((item: any) => ({
          id: item.id,
          name: item.name || item.id,
        })));
        setLinkedAssets(items);
        setBaselineAssets(items);
      } else {
        setLinkedAssets([]);
        setBaselineAssets([]);
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('editors.relations.messages.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [endpointBase, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const loadOpexOptions = React.useCallback(async () => {
    setLoadingOpexOptions(true);
    try {
      const allSpend = await fetchAllPaged('/spend-items', 'product_name');
      const opexMap = new Map<string, { id: string; product_name: string }>();
      for (const item of allSpend) {
        opexMap.set(item.id, { id: item.id, product_name: item.product_name || item.id });
      }
      setOpexOptions([...opexMap.values()].sort((a, b) => a.product_name.localeCompare(b.product_name)));
    } catch {
      setOpexOptions([]);
    } finally {
      setLoadingOpexOptions(false);
    }
  }, [fetchAllPaged]);

  const loadCapexOptions = React.useCallback(async () => {
    setLoadingCapexOptions(true);
    try {
      const allCapex = await fetchAllPaged('/capex-items', 'description');
      const capexMap = new Map<string, { id: string; description: string }>();
      for (const item of allCapex) {
        capexMap.set(item.id, { id: item.id, description: item.description || item.id });
      }
      setCapexOptions([...capexMap.values()].sort((a, b) => a.description.localeCompare(b.description)));
    } catch {
      setCapexOptions([]);
    } finally {
      setLoadingCapexOptions(false);
    }
  }, [fetchAllPaged]);

  const loadNamedOptions = React.useCallback(async (
    endpoint: '/applications' | '/assets',
    query: string,
    setter: React.Dispatch<React.SetStateAction<NamedItem[]>>,
    loadingSetter: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    loadingSetter(true);
    try {
      const params: Record<string, any> = { limit: 50, sort: 'name:ASC' };
      if (query.trim()) params.q = query.trim();
      const res = await api.get(endpoint, { params });
      setter(sortByName((res.data?.items || []).map((item: any) => ({
        id: item.id,
        name: item.name || item.id,
        summary: endpoint === '/applications' ? normalizeSummary(item.description ?? item.summary) : null,
      }))));
    } catch {
      setter([]);
    } finally {
      loadingSetter(false);
    }
  }, []);

  const save = React.useCallback(async () => {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`${endpointBase}/opex/bulk-replace`, {
        opex_ids: linkedOpex.map((item) => item.id),
      });
      setBaselineOpex(linkedOpex);

      await api.post(`${endpointBase}/capex/bulk-replace`, {
        capex_ids: linkedCapex.map((item) => item.id),
      });
      setBaselineCapex(linkedCapex);

      await api.post(`${endpointBase}/applications/bulk-replace`, {
        application_ids: linkedApplications.map((item) => item.id),
      });
      setBaselineApplications(linkedApplications);

      await api.post(`${endpointBase}/assets/bulk-replace`, {
        asset_ids: linkedAssets.map((item) => item.id),
      });
      setBaselineAssets(linkedAssets);

      await api.post(`${endpointBase}/urls`, {
        urls: links
          .filter((item) => String(item.url || '').trim())
          .map((item) => ({
            url: String(item.url || '').trim(),
            label: item.label ? String(item.label).trim() : null,
          })),
      });
      setBaselineLinks(links);
      onRelationsChange?.();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('editors.relations.messages.saveFailed')));
      throw e;
    } finally {
      setSaving(false);
    }
  }, [endpointBase, linkedApplications, linkedAssets, linkedCapex, linkedOpex, links, onRelationsChange, readOnly, t]);

  React.useEffect(() => {
    if (!autoSave || !dirty || saving || loading || readOnly) return undefined;
    const timer = window.setTimeout(() => {
      void save();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [autoSave, dirty, loading, readOnly, save, saving]);

  useImperativeHandle(ref, () => ({
    save,
    reset: () => {
      void load();
    },
    isDirty: () => dirty,
  }), [dirty, load, save]);

  const openAddLinkDialog = () => {
    setEditingLinkIndex(null);
    setLinkDraft({ label: '', url: '' });
    setLinkDialogOpen(true);
  };

  const openEditLinkDialog = (index: number) => {
    const link = links[index];
    if (!link || readOnly) return;
    setEditingLinkIndex(index);
    setLinkDraft({ label: link.label || '', url: link.url || '' });
    setLinkDialogOpen(true);
  };

  const closeLinkDialog = () => {
    setLinkDialogOpen(false);
    setEditingLinkIndex(null);
    setLinkDraft({ label: '', url: '' });
  };

  const saveLinkDraft = () => {
    const url = String(linkDraft.url || '').trim();
    if (!url) return;
    const label = String(linkDraft.label || '').trim() || undefined;
    setLinks((prev) => {
      if (editingLinkIndex === null || !prev[editingLinkIndex]) {
        return [...prev, { label, url }];
      }
      return prev.map((item, index) => (index === editingLinkIndex ? { ...item, label, url } : item));
    });
    closeLinkDialog();
  };

  const handleLinkDialogSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveLinkDraft();
  };

  const handleAttachmentUpload = async (files: File[]) => {
    if (files.length === 0 || readOnly) return;
    setUploading(true);
    setUploadCount(files.length);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        await api.post(`${endpointBase}/attachments`, formData);
      }
      await load();
      onRelationsChange?.();
    } finally {
      setUploading(false);
      setUploadCount(0);
    }
  };

  if (loading) {
    return null;
  }

  return (
    <>
      <Stack spacing={3}>
        {!!error && <Alert severity="error">{error}</Alert>}

        <Stack spacing={1.25}>
          <RelationsSectionTitle>{t('editors.relations.sections.budgetItems')}</RelationsSectionTitle>
          <Autocomplete
            multiple
            options={opexOptions}
            value={linkedOpex}
            getOptionLabel={(option) => option.product_name}
            onChange={(_, value) => setLinkedOpex(value as any)}
            onOpen={() => {
              if (opexOptions.length === 0 && !loadingOpexOptions) {
                void loadOpexOptions();
              }
            }}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>{option.product_name}</li>
            )}
            renderTags={(value, getTagProps) => value.map((option, index) => (
              <Chip {...getTagProps({ index })} key={option.id} label={option.product_name} sx={relationTagSx} />
            ))}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('editors.relations.placeholders.opexItems')}
                variant="standard"
                inputProps={{
                  ...params.inputProps,
                  'aria-label': t('editors.relations.fields.opexItems'),
                }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingOpexOptions ? <CircularProgress color="inherit" size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                sx={drawerFieldValueSx}
              />
            )}
            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
            isOptionEqualToValue={(option, value) => option.id === (value as any).id}
            filterSelectedOptions
            disabled={readOnly}
            sx={relationAutocompleteSx}
          />

          <Autocomplete
            multiple
            options={capexOptions}
            value={linkedCapex}
            getOptionLabel={(option) => option.description}
            onChange={(_, value) => setLinkedCapex(value as any)}
            onOpen={() => {
              if (capexOptions.length === 0 && !loadingCapexOptions) {
                void loadCapexOptions();
              }
            }}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>{option.description}</li>
            )}
            renderTags={(value, getTagProps) => value.map((option, index) => (
              <Chip {...getTagProps({ index })} key={option.id} label={option.description} sx={relationTagSx} />
            ))}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('editors.relations.placeholders.capexItems')}
                variant="standard"
                inputProps={{
                  ...params.inputProps,
                  'aria-label': t('editors.relations.fields.capexItems'),
                }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingCapexOptions ? <CircularProgress color="inherit" size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                sx={drawerFieldValueSx}
              />
            )}
            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
            isOptionEqualToValue={(option, value) => option.id === (value as any).id}
            filterSelectedOptions
            disabled={readOnly}
            sx={relationAutocompleteSx}
          />
        </Stack>

        <Stack spacing={1.25}>
          <RelationsSectionTitle>{t('editors.relations.sections.appsAndAssets')}</RelationsSectionTitle>
          <Autocomplete
            multiple
            options={applicationOptions}
            value={linkedApplications}
            getOptionLabel={(option) => option.name}
            onChange={(_, value) => setLinkedApplications(sortByName(value as NamedItem[]))}
            onOpen={() => {
              if (applicationOptions.length === 0 && !loadingApplications) {
                void loadNamedOptions('/applications', '', setApplicationOptions, setLoadingApplications);
              }
            }}
            onInputChange={(_, value, reason) => {
              if (reason !== 'reset') {
                void loadNamedOptions('/applications', value, setApplicationOptions, setLoadingApplications);
              }
            }}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box sx={{ minWidth: 0, py: 0.25 }}>
                  <Typography variant="body2" sx={{ fontSize: 13 }}>{option.name}</Typography>
                </Box>
              </li>
            )}
            renderTags={(value, getTagProps) => value.map((option, index) => (
              <Chip
                {...getTagProps({ index })}
                key={option.id}
                label={option.name}
                title={option.name}
                onClick={() => window.open(`/it/applications/${option.id}/overview`, '_self')}
                clickable
                sx={relationTagSx}
              />
            ))}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('editors.relations.placeholders.applications')}
                variant="standard"
                inputProps={{
                  ...params.inputProps,
                  'aria-label': t('activity.history.fields.applications'),
                }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingApplications ? <CircularProgress color="inherit" size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                sx={drawerFieldValueSx}
              />
            )}
            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            filterSelectedOptions
            disabled={readOnly}
            sx={relationAutocompleteSx}
          />

          <Autocomplete
            multiple
            options={assetOptions}
            value={linkedAssets}
            getOptionLabel={(option) => option.name}
            onChange={(_, value) => setLinkedAssets(sortByName(value as NamedItem[]))}
            onOpen={() => {
              if (assetOptions.length === 0 && !loadingAssets) {
                void loadNamedOptions('/assets', '', setAssetOptions, setLoadingAssets);
              }
            }}
            onInputChange={(_, value, reason) => {
              if (reason !== 'reset') {
                void loadNamedOptions('/assets', value, setAssetOptions, setLoadingAssets);
              }
            }}
            renderTags={(value, getTagProps) => value.map((option, index) => (
              <Chip
                {...getTagProps({ index })}
                key={option.id}
                label={option.name}
                onClick={() => window.open(`/it/assets/${option.id}/overview`, '_self')}
                clickable
                sx={relationTagSx}
              />
            ))}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('editors.relations.placeholders.assets')}
                variant="standard"
                inputProps={{
                  ...params.inputProps,
                  'aria-label': t('activity.history.fields.assets'),
                }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingAssets ? <CircularProgress color="inherit" size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                sx={drawerFieldValueSx}
              />
            )}
            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            filterSelectedOptions
            disabled={readOnly}
            sx={relationAutocompleteSx}
          />
        </Stack>

        <Stack spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1} sx={relationWideControlSx}>
            <RelationsSectionTitle>{t('editors.relations.sections.externalLinks')}</RelationsSectionTitle>
            {!readOnly && (
              <Button size="small" startIcon={<AddIcon />} onClick={openAddLinkDialog}>
                {t('editors.relations.actions.addUrl')}
              </Button>
            )}
          </Stack>
          <RelevantWebsitesList
            items={links.map((item) => ({
              id: item.id,
              name: String(item.label || '').trim() || item.url,
              url: item.url,
            }))}
            nameHeader={t('editors.relations.fields.name')}
            urlHeader={t('editors.relations.fields.url')}
            emptyLabel={t('editors.relations.states.noExternalLinks')}
            deleteLabel={t('editors.relations.actions.deleteLink')}
            canEdit={!readOnly}
            canDelete={!readOnly}
            onEdit={openEditLinkDialog}
            onDelete={(index) => setLinks((prev) => prev.filter((_, currentIndex) => currentIndex !== index))}
            sx={relationWideControlSx}
          />
        </Stack>

        <Stack spacing={1.25}>
          <RelationsSectionTitle>{t('editors.relations.sections.attachments')}</RelationsSectionTitle>
          <Stack spacing={1} sx={relationControlSx}>
            <Box
              onDragOver={(event) => {
                event.preventDefault();
                setHover(true);
              }}
              onDragLeave={() => setHover(false)}
              onDrop={(event) => {
                event.preventDefault();
                setHover(false);
                void handleAttachmentUpload(Array.from(event.dataTransfer.files || []));
              }}
              sx={(theme) => ({
                border: `1px dashed ${hover ? theme.palette.kanap.teal : theme.palette.kanap.border.default}`,
                borderRadius: '8px',
                p: 2,
                textAlign: 'center',
                cursor: readOnly ? 'default' : 'pointer',
                bgcolor: hover ? theme.palette.kanap.bg.hover : 'transparent',
              })}
            >
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                {t('editors.relations.messages.dragDropFiles')}
              </Typography>
              <Box sx={{ mt: 1 }}>
                <Button component="label" size="small" variant="outlined" disabled={uploading || readOnly}>
                  {t('editors.relations.actions.selectFiles')}
                  <input
                    type="file"
                    hidden
                    multiple
                    onChange={async (event) => {
                      const input = event.currentTarget as HTMLInputElement | null;
                      const files = Array.from(event.target.files || []);
                      await handleAttachmentUpload(files);
                      if (input) input.value = '';
                    }}
                  />
                </Button>
              </Box>
            </Box>

            {uploading && <LinearProgress sx={{ mt: 1 }} />}
            {uploading && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {t('editors.relations.messages.uploadingFiles', { count: uploadCount })}
              </Typography>
            )}

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {attachments.map((attachment) => (
                <Chip
                  key={attachment.id}
                  label={attachment.original_filename}
                  onClick={async () => {
                    const res = await api.get(`${attachmentDownloadBase}/${attachment.id}`, { responseType: 'blob' });
                    const blob = new Blob([res.data]);
                    const url = window.URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = attachment.original_filename;
                    anchor.click();
                    window.URL.revokeObjectURL(url);
                  }}
                  onDelete={!readOnly ? async () => {
                    const confirmed = await dialogs.confirm({
                      message: t('editors.relations.confirmations.deleteAttachment', {
                        name: attachment.original_filename,
                      }),
                      confirmLabel: t('common:buttons.delete'),
                      intent: 'danger',
                    });
                    if (!confirmed) return;
                    try {
                      await api.delete(`${endpointBase}/attachments/${attachment.id}`);
                      await load();
                    } catch {
                      // best effort
                    }
                  } : undefined}
                  deleteIcon={!readOnly ? <DeleteIcon sx={{ fontSize: 16 }} /> : undefined}
                  sx={relationTagSx}
                />
              ))}
            </Stack>
          </Stack>
        </Stack>
      </Stack>

      <Dialog open={linkDialogOpen} onClose={closeLinkDialog} fullWidth maxWidth="xs">
        <Box component="form" onSubmit={handleLinkDialogSubmit}>
          <DialogTitle>
            {editingLinkIndex === null
              ? t('editors.relations.dialogs.addExternalLink.title')
              : t('editors.relations.dialogs.editExternalLink.title')}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                aria-label={t('editors.relations.fields.name')}
                placeholder={t('editors.relations.placeholders.linkDescription')}
                value={linkDraft.label}
                onChange={(event) => setLinkDraft((prev) => ({ ...prev, label: event.target.value }))}
                autoFocus
                inputRef={linkNameInputRef}
                variant="standard"
              />
              <TextField
                aria-label={t('editors.relations.fields.url')}
                placeholder={t('editors.relations.placeholders.url')}
                value={linkDraft.url}
                onChange={(event) => setLinkDraft((prev) => ({ ...prev, url: event.target.value }))}
                variant="standard"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="action" onClick={closeLinkDialog}>{t('common:buttons.cancel')}</Button>
            <Button type="submit" variant="action-primary" disabled={!String(linkDraft.url || '').trim()}>
              {editingLinkIndex === null ? t('common:buttons.add') : t('common:buttons.save')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
});
