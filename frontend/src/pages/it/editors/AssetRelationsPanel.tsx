import React, { forwardRef, useImperativeHandle } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';

import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { KanapDialog, PropertyRow, RelevantWebsitesList, useKanapDialogs } from '../../../components/design';
import { drawerAutocompleteListboxSx, drawerFieldValueSx } from '../../../theme/formSx';
import IncidentRelationsSection from './IncidentRelationsSection';
export type AssetRelationsPanelHandle = {
  save: () => Promise<void>;
  reset: () => void;
  isDirty: () => boolean;
};

type AssetOption = { id: string; name: string; kind: string; environment: string };
type RelatedTaskOption = { id: string; item_number: number | null; title: string | null };

type OutgoingRelation = {
  id: string;
  related_asset_id: string;
  relation_type: 'contains' | 'depends_on';
  notes: string | null;
  related_name: string;
};

type IncomingRelation = {
  id: string;
  asset_id: string;
  relation_type: 'contains' | 'depends_on';
  notes: string | null;
  source_name: string;
};

type Props = {
  assetId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onRelationsChange?: () => void;
};

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

export default forwardRef<AssetRelationsPanelHandle, Props>(function AssetRelationsPanel(
  { assetId, onDirtyChange, onRelationsChange },
  ref
) {
  const { t } = useTranslation(['it', 'common']);
  const dialogs = useKanapDialogs();
  const { hasLevel } = useAuth();
  const readOnly = !hasLevel('infrastructure', 'member');
  const relationTagSx = {
    height: 22,
    borderRadius: '4px',
    fontSize: 12,
    '& .MuiChip-label': { px: '7px' },
  } as const;
  const relationControlSx = { maxWidth: 420 } as const;
  const relationWideControlSx = { maxWidth: 640 } as const;
  const relationAutocompleteSx = [drawerFieldValueSx, { width: '100%' }] as const;
  const relationGridSx = {
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 420px))' },
    columnGap: 2.5,
    rowGap: 1,
  } as const;
  const compactRelationTableSx = {
    maxWidth: 420,
    borderRadius: '6px',
    '& .MuiTableCell-root': {
      py: 0.75,
      px: 1.25,
      fontSize: 13,
    },
  } as const;
  const taskLabel = React.useCallback((task: RelatedTaskOption) => {
    const prefix = task.item_number ? `#${task.item_number}` : '';
    const title = String(task.title || '').trim();
    return [prefix, title].filter(Boolean).join(' ') || task.id;
  }, []);

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Asset relations (contains/depends_on)
  const [containsAssets, setContainsAssets] = React.useState<AssetOption[]>([]);
  const [baselineContains, setBaselineContains] = React.useState<AssetOption[]>([]);
  const [dependsOnAssets, setDependsOnAssets] = React.useState<AssetOption[]>([]);
  const [baselineDependsOn, setBaselineDependsOn] = React.useState<AssetOption[]>([]);
  const [containedBy, setContainedBy] = React.useState<Array<{ id: string; name: string }>>([]);
  const [dependedOnBy, setDependedOnBy] = React.useState<Array<{ id: string; name: string }>>([]);

  // Asset search for autocomplete
  const [assetOptions, setAssetOptions] = React.useState<AssetOption[]>([]);
  const [optionsLoading, setOptionsLoading] = React.useState(false);
  const [assetSearch, setAssetSearch] = React.useState('');

  // Financial links
  const [linkedOpex, setLinkedOpex] = React.useState<Array<{ id: string; product_name: string }>>([]);
  const [baselineOpex, setBaselineOpex] = React.useState<Array<{ id: string; product_name: string }>>([]);
  const [opexOptions, setOpexOptions] = React.useState<Array<{ id: string; product_name: string }>>([]);

  const [linkedCapex, setLinkedCapex] = React.useState<Array<{ id: string; description: string }>>([]);
  const [baselineCapex, setBaselineCapex] = React.useState<Array<{ id: string; description: string }>>([]);
  const [capexOptions, setCapexOptions] = React.useState<Array<{ id: string; description: string }>>([]);

  const [linkedContracts, setLinkedContracts] = React.useState<Array<{ id: string; name: string }>>([]);
  const [baselineContracts, setBaselineContracts] = React.useState<Array<{ id: string; name: string }>>([]);
  const [contractOptions, setContractOptions] = React.useState<Array<{ id: string; name: string }>>([]);

  const [linkedProjects, setLinkedProjects] = React.useState<Array<{ id: string; name: string }>>([]);
  const [baselineProjects, setBaselineProjects] = React.useState<Array<{ id: string; name: string }>>([]);
  const [projectOptions, setProjectOptions] = React.useState<Array<{ id: string; name: string }>>([]);
  const [linkedTasks, setLinkedTasks] = React.useState<RelatedTaskOption[]>([]);
  const [taskOptions, setTaskOptions] = React.useState<RelatedTaskOption[]>([]);
  const [taskOptionsLoading, setTaskOptionsLoading] = React.useState(false);
  const [taskSearch, setTaskSearch] = React.useState('');

  // URLs
  const [urls, setUrls] = React.useState<Array<{ id?: string; description?: string; url: string }>>([]);
  const [baselineUrls, setBaselineUrls] = React.useState<Array<{ id?: string; description?: string; url: string }>>([]);
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [linkDraft, setLinkDraft] = React.useState<{ description: string; url: string }>({ description: '', url: '' });
  const [editingLinkIndex, setEditingLinkIndex] = React.useState<number | null>(null);
  const linkNameInputRef = React.useRef<HTMLInputElement | null>(null);
  const urlsEditedRef = React.useRef(false);
  const failedSaveSignatureRef = React.useRef<string | null>(null);

  // Attachments
  const [attachments, setAttachments] = React.useState<Array<{ id: string; original_filename: string }>>([]);
  const [hover, setHover] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadCount, setUploadCount] = React.useState(0);

  // Dirty tracking
  const dirty = React.useMemo(() => {
    const containsIds = containsAssets.map((a) => a.id).sort().join(',');
    const baselineContainsIds = baselineContains.map((a) => a.id).sort().join(',');
    const dependsOnIds = dependsOnAssets.map((a) => a.id).sort().join(',');
    const baselineDependsOnIds = baselineDependsOn.map((a) => a.id).sort().join(',');
    const a = containsIds !== baselineContainsIds || dependsOnIds !== baselineDependsOnIds;
    const b = JSON.stringify(linkedOpex.map((x) => x.id)) !== JSON.stringify(baselineOpex.map((x) => x.id));
    const c = JSON.stringify(linkedCapex.map((x) => x.id)) !== JSON.stringify(baselineCapex.map((x) => x.id));
    const d = JSON.stringify(linkedContracts.map((x) => x.id)) !== JSON.stringify(baselineContracts.map((x) => x.id));
    const e = JSON.stringify(linkedProjects.map((x) => x.id)) !== JSON.stringify(baselineProjects.map((x) => x.id));
    const f = JSON.stringify(urls) !== JSON.stringify(baselineUrls);
    return a || b || c || d || e || f;
  }, [containsAssets, baselineContains, dependsOnAssets, baselineDependsOn, linkedOpex, baselineOpex, linkedCapex, baselineCapex, linkedContracts, baselineContracts, linkedProjects, baselineProjects, urls, baselineUrls]);

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

  // Combine current selections with search options for autocomplete
  const allContainsOptions = React.useMemo(() => {
    const byId = new Map(assetOptions.map((o) => [o.id, o]));
    for (const a of containsAssets) {
      if (!byId.has(a.id)) byId.set(a.id, a);
    }
    return Array.from(byId.values());
  }, [assetOptions, containsAssets]);

  const allDependsOnOptions = React.useMemo(() => {
    const byId = new Map(assetOptions.map((o) => [o.id, o]));
    for (const a of dependsOnAssets) {
      if (!byId.has(a.id)) byId.set(a.id, a);
    }
    return Array.from(byId.values());
  }, [assetOptions, dependsOnAssets]);

  const allTaskOptions = React.useMemo(() => {
    const byId = new Map(taskOptions.map((option) => [option.id, option]));
    for (const task of linkedTasks) {
      if (!byId.has(task.id)) byId.set(task.id, task);
    }
    return Array.from(byId.values());
  }, [linkedTasks, taskOptions]);

  // Load data
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Asset relations
      try {
        const res = await api.get(`/assets/${assetId}/relations`);
        const outgoing = (res.data?.outgoing || []) as OutgoingRelation[];
        const incoming = (res.data?.incoming || []) as IncomingRelation[];

        const contains: AssetOption[] = [];
        const dependsOn: AssetOption[] = [];
        for (const rel of outgoing) {
          const opt = { id: rel.related_asset_id, name: rel.related_name, kind: '', environment: '' };
          if (rel.relation_type === 'contains') contains.push(opt);
          else if (rel.relation_type === 'depends_on') dependsOn.push(opt);
        }
        setContainsAssets(contains);
        setBaselineContains(contains);
        setDependsOnAssets(dependsOn);
        setBaselineDependsOn(dependsOn);

        const containedByList: Array<{ id: string; name: string }> = [];
        const dependedOnByList: Array<{ id: string; name: string }> = [];
        for (const rel of incoming) {
          if (rel.relation_type === 'contains') containedByList.push({ id: rel.asset_id, name: rel.source_name });
          else if (rel.relation_type === 'depends_on') dependedOnByList.push({ id: rel.asset_id, name: rel.source_name });
        }
        setContainedBy(containedByList);
        setDependedOnBy(dependedOnByList);
      } catch { /* ignore */ }

      // OPEX items
      try {
        const res = await api.get(`/assets/${assetId}/spend-items`);
        const items = (res.data?.items || []) as Array<{ id: string; product_name: string }>;
        setLinkedOpex(items);
        setBaselineOpex(items);
      } catch { setLinkedOpex([]); setBaselineOpex([]); }

      // CAPEX items
      try {
        const res = await api.get(`/assets/${assetId}/capex-items`);
        const items = (res.data?.items || []) as Array<{ id: string; description: string }>;
        setLinkedCapex(items);
        setBaselineCapex(items);
      } catch { setLinkedCapex([]); setBaselineCapex([]); }

      // Contracts
      try {
        const res = await api.get(`/assets/${assetId}/contracts`);
        const items = (res.data?.items || []) as Array<{ id: string; name: string }>;
        setLinkedContracts(items);
        setBaselineContracts(items);
      } catch { setLinkedContracts([]); setBaselineContracts([]); }

      // Projects
      try {
        const res = await api.get(`/assets/${assetId}/projects`);
        const items = (res.data?.items || []) as Array<{ id: string; name: string }>;
        setLinkedProjects(items);
        setBaselineProjects(items);
      } catch { setLinkedProjects([]); setBaselineProjects([]); }

      // Tasks
      try {
        const items: RelatedTaskOption[] = [];
        let page = 1;
        const limit = 100;
        let total = Infinity;
        while ((page - 1) * limit < total) {
          const res = await api.get(`/assets/${assetId}/related-tasks`, { params: { page, limit, sort: 'updated_at:DESC' } });
          const pageItems = (res.data?.items || []) as RelatedTaskOption[];
          total = Number(res.data?.total || pageItems.length);
          items.push(...pageItems);
          if (pageItems.length < limit) break;
          page += 1;
        }
        setLinkedTasks(items);
      } catch { setLinkedTasks([]); }

      // URLs
      try {
        const res = await api.get(`/assets/${assetId}/links`);
        const urlItems = (res.data || []).map((x: any) => ({ id: x.id, description: x.description, url: x.url }));
        setBaselineUrls(urlItems);
        if (!urlsEditedRef.current) setUrls(urlItems);
      } catch { if (!urlsEditedRef.current) setUrls([]); setBaselineUrls([]); }

      // Attachments
      try {
        const res = await api.get(`/assets/${assetId}/attachments`);
        setAttachments(res.data || []);
      } catch { setAttachments([]); }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadRelationsFailed')));
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Load dropdown options
  React.useEffect(() => {
    let alive = true;
    const fetchAllPaged = async (endpoint: string, sortField: string) => {
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
    };
    (async () => {
      try {
        const [allSpend, allCapex, allContracts, allProjects] = await Promise.all([
          fetchAllPaged('/spend-items', 'product_name'),
          fetchAllPaged('/capex-items', 'description'),
          fetchAllPaged('/contracts', 'name'),
          fetchAllPaged('/portfolio/projects', 'name'),
        ]);
        if (!alive) return;
        const dedupById = <T extends { id: string }>(arr: T[]) =>
          Array.from(new Map(arr.map((i) => [i.id, i])).values());
        const opex = dedupById(allSpend.map((x: any) => ({ id: x.id, product_name: x.product_name })));
        const capex = dedupById(allCapex.map((x: any) => ({ id: x.id, description: x.description })));
        const contracts = dedupById(allContracts.map((x: any) => ({ id: x.id, name: x.name })));
        const projects = dedupById(allProjects.map((x: any) => ({ id: x.id, name: x.name })));
        setOpexOptions(opex.sort((a, b) => a.product_name.localeCompare(b.product_name)));
        setCapexOptions(capex.sort((a, b) => a.description.localeCompare(b.description)));
        setContractOptions(contracts.sort((a, b) => a.name.localeCompare(b.name)));
        setProjectOptions(projects.sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        if (!alive) return;
        setOpexOptions([]);
        setCapexOptions([]);
        setContractOptions([]);
        setProjectOptions([]);
      }
    })();
    return () => { alive = false; };
  }, [assetId]);

  // Asset search for contains/depends_on
  React.useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      const query = assetSearch.trim();
      setOptionsLoading(true);
      try {
        const params: Record<string, string | number> = { limit: 50, sort: 'name:ASC' };
        if (query) params.q = query;
        const res = await api.get('/assets', { params });
        if (!alive) return;
        const items = (res.data?.items || [])
          .filter((a: any) => a.id !== assetId)
          .map((a: any) => ({ id: a.id, name: a.name, kind: a.kind || '', environment: a.environment || '' }));
        setAssetOptions(items);
      } catch {
        if (!alive) return;
        setAssetOptions([]);
      } finally {
        if (alive) setOptionsLoading(false);
      }
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [assetSearch, assetId]);

  React.useEffect(() => {
    if (readOnly) {
      setTaskOptions([]);
      setTaskOptionsLoading(false);
      return undefined;
    }

    let alive = true;
    const timer = window.setTimeout(async () => {
      const query = taskSearch.trim();
      setTaskOptionsLoading(true);
      try {
        const params: Record<string, string | number> = { page: 1, limit: 50, sort: 'updated_at:DESC' };
        if (query) params.q = query;
        const res = await api.get('/tasks', { params });
        if (!alive) return;
        const items = (res.data?.items || []).map((task: any) => ({
          id: task.id,
          item_number: task.item_number ?? null,
          title: task.title ?? null,
        })) as RelatedTaskOption[];
        setTaskOptions(items);
      } catch {
        if (!alive) return;
        setTaskOptions([]);
      } finally {
        if (alive) setTaskOptionsLoading(false);
      }
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [readOnly, taskSearch]);

  const saveSignature = React.useMemo(() => JSON.stringify({
    contains: containsAssets.map((item) => item.id).sort(),
    dependsOn: dependsOnAssets.map((item) => item.id).sort(),
    opex: linkedOpex.map((item) => item.id).sort(),
    capex: linkedCapex.map((item) => item.id).sort(),
    contracts: linkedContracts.map((item) => item.id).sort(),
    projects: linkedProjects.map((item) => item.id).sort(),
    urls: urls.map((item) => ({
      id: item.id,
      description: String(item.description || '').trim(),
      url: String(item.url || '').trim(),
    })),
  }), [containsAssets, dependsOnAssets, linkedOpex, linkedCapex, linkedContracts, linkedProjects, urls]);

  const syncUrls = React.useCallback(async (nextUrls: Array<{ id?: string; description?: string; url: string }>) => {
    urlsEditedRef.current = true;
    setUrls(nextUrls);
    if (readOnly) return;
    setSaving(true);
    setError(null);
    try {
      const existingIds = new Set(baselineUrls.filter((item) => item.id).map((item) => item.id as string));
      const currentIds = new Set(nextUrls.filter((item) => item.id).map((item) => item.id as string));
      for (const existing of baselineUrls) {
        if (existing.id && !currentIds.has(existing.id)) {
          await api.delete(`/assets/${assetId}/links/${existing.id}`);
        }
      }
      for (const link of nextUrls) {
        const url = String(link.url || '').trim();
        if (!url) continue;
        const body = { description: String(link.description || '').trim() || null, url };
        if (link.id && existingIds.has(link.id)) {
          await api.patch(`/assets/${assetId}/links/${link.id}`, body);
        } else {
          await api.post(`/assets/${assetId}/links`, body);
        }
      }
      const res = await api.get(`/assets/${assetId}/links`);
      const urlItems = ((res.data || []) as Array<{ id?: string; description?: string | null; url?: string }>).map((item) => ({
        id: item.id,
        description: item.description || undefined,
        url: item.url || '',
      }));
      urlsEditedRef.current = false;
      setBaselineUrls(urlItems);
      setUrls(urlItems);
      onRelationsChange?.();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
    } finally {
      setSaving(false);
    }
  }, [assetId, baselineUrls, onRelationsChange, readOnly, t]);

  const replaceTaskRelations = React.useCallback(async (next: RelatedTaskOption[]) => {
    const previous = linkedTasks;
    setLinkedTasks(next);
    if (readOnly) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/assets/${assetId}/related-tasks/bulk-replace`, { task_ids: next.map((task) => task.id) });
      onRelationsChange?.();
    } catch (e: any) {
      setLinkedTasks(previous);
      setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
    } finally {
      setSaving(false);
    }
  }, [assetId, linkedTasks, onRelationsChange, readOnly, t]);

  const save = React.useCallback(async () => {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    try {
      // Save asset relations
      const relations = [
        ...containsAssets.map((a) => ({ related_asset_id: a.id, relation_type: 'contains' })),
        ...dependsOnAssets.map((a) => ({ related_asset_id: a.id, relation_type: 'depends_on' })),
      ];
      await api.post(`/assets/${assetId}/relations`, { relations });
      setBaselineContains(containsAssets);
      setBaselineDependsOn(dependsOnAssets);

      // Save OPEX
      await api.post(`/assets/${assetId}/spend-items`, { spend_item_ids: linkedOpex.map((x) => x.id) });
      setBaselineOpex(linkedOpex);

      // Save CAPEX
      await api.post(`/assets/${assetId}/capex-items`, { capex_item_ids: linkedCapex.map((x) => x.id) });
      setBaselineCapex(linkedCapex);

      // Save Contracts
      await api.post(`/assets/${assetId}/contracts`, { contract_ids: linkedContracts.map((x) => x.id) });
      setBaselineContracts(linkedContracts);

      // Save Projects
      await api.post(`/assets/${assetId}/projects/bulk-replace`, { project_ids: linkedProjects.map((x) => x.id) });
      setBaselineProjects(linkedProjects);

      // Save URLs
      const existing = baselineUrls;
      const existingIds = new Set(existing.filter((x) => x.id).map((x) => x.id as string));
      const currentIds = new Set(urls.filter((x) => x.id).map((x) => x.id as string));
      for (const ex of existing) {
        if (ex.id && !currentIds.has(ex.id)) await api.delete(`/assets/${assetId}/links/${ex.id}`);
      }
      for (const u of urls) {
        if (!u.url) continue;
        if (u.id && existingIds.has(u.id)) {
          await api.patch(`/assets/${assetId}/links/${u.id}`, { description: u.description ?? null, url: u.url });
        } else {
          await api.post(`/assets/${assetId}/links`, { description: u.description ?? null, url: u.url });
        }
      }
      setBaselineUrls(urls);
      failedSaveSignatureRef.current = null;
      onRelationsChange?.();
    } catch (e: any) {
      failedSaveSignatureRef.current = saveSignature;
      setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
      throw e;
    } finally {
      setSaving(false);
    }
  }, [assetId, baselineUrls, containsAssets, dependsOnAssets, linkedCapex, linkedContracts, linkedOpex, linkedProjects, onRelationsChange, readOnly, saveSignature, t, urls]);

  React.useEffect(() => {
    if (!dirty || loading || saving || readOnly) return undefined;
    if (failedSaveSignatureRef.current === saveSignature) return undefined;
    const timer = window.setTimeout(() => {
      void save();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, loading, readOnly, save, saveSignature, saving]);

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
    await syncUrls(nextUrls);
    closeLinkDialog();
  }, [closeLinkDialog, editingLinkIndex, linkDraft.description, linkDraft.url, syncUrls, urls]);

  const reset = () => {
    urlsEditedRef.current = false;
    void load();
  };

  useImperativeHandle(ref, () => ({ save, reset, isDirty: () => dirty }), [save, dirty]);

  return (
    <>
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}

      <SectionTitle>{t('workspace.asset.relations.assetRelations')}</SectionTitle>
      <Box sx={relationGridSx}>
        <PropertyRow label={t('workspace.asset.relations.dependsOn')}>
          <Autocomplete
            multiple
            options={allDependsOnOptions}
            value={dependsOnAssets}
            getOptionLabel={(o) => o.name}
            onChange={(_, v) => setDependsOnAssets(v as AssetOption[])}
            inputValue={assetSearch}
            onInputChange={(_, v) => setAssetSearch(v)}
            loading={optionsLoading}
            renderOption={(props, option) => {
              const { key, ...optionProps } = props;
              return <li key={key} {...optionProps} title={option.name}>{option.name}</li>;
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => <Chip {...getTagProps({ index })} key={option.id} label={option.name} sx={relationTagSx} />)
            }
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('workspace.asset.relations.searchDependsOn')}
                variant="standard"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {optionsLoading ? <CircularProgress color="inherit" size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                sx={drawerFieldValueSx}
              />
            )}
            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            filterSelectedOptions
            disabled={readOnly}
            sx={relationAutocompleteSx}
          />
        </PropertyRow>

        <PropertyRow label={t('workspace.asset.relations.contains')}>
          <Autocomplete
            multiple
            options={allContainsOptions}
            value={containsAssets}
            getOptionLabel={(o) => o.name}
            onChange={(_, v) => setContainsAssets(v as AssetOption[])}
            inputValue={assetSearch}
            onInputChange={(_, v) => setAssetSearch(v)}
            loading={optionsLoading}
            renderOption={(props, option) => {
              const { key, ...optionProps } = props;
              return <li key={key} {...optionProps} title={option.name}>{option.name}</li>;
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => <Chip {...getTagProps({ index })} key={option.id} label={option.name} sx={relationTagSx} />)
            }
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('workspace.asset.relations.searchContains')}
                variant="standard"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {optionsLoading ? <CircularProgress color="inherit" size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                sx={drawerFieldValueSx}
              />
            )}
            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            filterSelectedOptions
            disabled={readOnly}
            sx={relationAutocompleteSx}
          />
        </PropertyRow>
      </Box>

      {/* Reverse relations (read-only) */}
      {(containedBy.length > 0 || dependedOnBy.length > 0) && (
        <Box sx={relationGridSx}>
          {containedBy.length > 0 && (
            <PropertyRow label={t('workspace.asset.relations.containedBy')}>
              <TableContainer component={Paper} variant="outlined" sx={compactRelationTableSx}>
                <Table size="small" aria-label={t('workspace.asset.relations.containedByAssets')}>
                  <TableBody>
                    {containedBy.map((r) => (
                      <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => window.open(`/it/assets/${r.id}/relations`, '_self')}>
                        <TableCell>{r.name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </PropertyRow>
          )}

          {dependedOnBy.length > 0 && (
            <PropertyRow label={t('workspace.asset.relations.dependedOnBy')}>
              <TableContainer component={Paper} variant="outlined" sx={compactRelationTableSx}>
                <Table size="small" aria-label={t('workspace.asset.relations.dependedOnByAssets')}>
                  <TableBody>
                    {dependedOnBy.map((r) => (
                      <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => window.open(`/it/assets/${r.id}/relations`, '_self')}>
                        <TableCell>{r.name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </PropertyRow>
          )}
        </Box>
      )}

      {/* Relations */}
      <SectionTitle>{t('workspace.asset.tabs.relations')}</SectionTitle>
      <PropertyRow label={t('workspace.asset.relations.opexItems')} valueSx={relationControlSx}>
        <Autocomplete
          multiple
          options={opexOptions}
          value={linkedOpex}
          getOptionLabel={(o) => o.product_name}
          onChange={(_, v) => setLinkedOpex(v as any)}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return <li key={key} {...optionProps}>{option.product_name}</li>;
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => <Chip {...getTagProps({ index })} key={option.id} label={option.product_name} sx={relationTagSx} />)
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={t('workspace.asset.relations.searchOpexItems')}
              variant="standard"
              sx={drawerFieldValueSx}
            />
          )}
          ListboxProps={{ sx: drawerAutocompleteListboxSx }}
          isOptionEqualToValue={(opt, val) => opt.id === (val as any).id}
          filterSelectedOptions
          disabled={readOnly}
          sx={relationAutocompleteSx}
        />
      </PropertyRow>

      <PropertyRow label={t('workspace.asset.relations.capexItems')} valueSx={relationControlSx}>
        <Autocomplete
          multiple
          options={capexOptions}
          value={linkedCapex}
          getOptionLabel={(o) => o.description}
          onChange={(_, v) => setLinkedCapex(v as any)}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return <li key={key} {...optionProps}>{option.description}</li>;
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => <Chip {...getTagProps({ index })} key={option.id} label={option.description} sx={relationTagSx} />)
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={t('workspace.asset.relations.searchCapexItems')}
              variant="standard"
              sx={drawerFieldValueSx}
            />
          )}
          ListboxProps={{ sx: drawerAutocompleteListboxSx }}
          isOptionEqualToValue={(opt, val) => opt.id === (val as any).id}
          filterSelectedOptions
          disabled={readOnly}
          sx={relationAutocompleteSx}
        />
      </PropertyRow>

      <PropertyRow label={t('workspace.asset.relations.contracts')} valueSx={relationControlSx}>
        <Autocomplete
          multiple
          options={contractOptions}
          value={linkedContracts}
          getOptionLabel={(o) => o.name}
          onChange={(_, v) => setLinkedContracts(v as any)}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return <li key={key} {...optionProps}>{option.name}</li>;
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => <Chip {...getTagProps({ index })} key={option.id} label={option.name} sx={relationTagSx} />)
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={t('workspace.asset.relations.searchContracts')}
              variant="standard"
              sx={drawerFieldValueSx}
            />
          )}
          ListboxProps={{ sx: drawerAutocompleteListboxSx }}
          isOptionEqualToValue={(opt, val) => opt.id === (val as any).id}
          filterSelectedOptions
          disabled={readOnly}
          sx={relationAutocompleteSx}
        />
      </PropertyRow>

      <PropertyRow label={t('workspace.asset.relations.projects')} valueSx={relationControlSx}>
        <Autocomplete
          multiple
          options={projectOptions}
          value={linkedProjects}
          getOptionLabel={(o) => o.name}
          onChange={(_, v) => setLinkedProjects(v as any)}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return <li key={key} {...optionProps}>{option.name}</li>;
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => <Chip {...getTagProps({ index })} key={option.id} label={option.name} sx={relationTagSx} />)
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={t('workspace.asset.relations.searchProjects')}
              variant="standard"
              sx={drawerFieldValueSx}
            />
          )}
          ListboxProps={{ sx: drawerAutocompleteListboxSx }}
          isOptionEqualToValue={(opt, val) => opt.id === (val as any).id}
          filterSelectedOptions
          disabled={readOnly}
          sx={relationAutocompleteSx}
        />
      </PropertyRow>

      <PropertyRow label={t('workspace.asset.relations.tasks')} valueSx={relationControlSx}>
        <Autocomplete
          multiple
          options={allTaskOptions}
          value={linkedTasks}
          getOptionLabel={taskLabel}
          onChange={(_, v) => { void replaceTaskRelations(v as RelatedTaskOption[]); }}
          inputValue={taskSearch}
          onInputChange={(_, v) => setTaskSearch(v)}
          loading={taskOptionsLoading}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return <li key={key} {...optionProps}>{taskLabel(option)}</li>;
          }}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => <Chip {...getTagProps({ index })} key={option.id} label={taskLabel(option)} sx={relationTagSx} />)
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={t('workspace.asset.relations.searchTasks')}
              variant="standard"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {taskOptionsLoading ? <CircularProgress color="inherit" size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
              sx={drawerFieldValueSx}
            />
          )}
          ListboxProps={{ sx: drawerAutocompleteListboxSx }}
          isOptionEqualToValue={(opt, val) => opt.id === val.id}
          filterSelectedOptions
          disabled={readOnly}
          sx={relationAutocompleteSx}
        />
      </PropertyRow>

      {/* URLs */}
      <Stack direction="row" alignItems="center" spacing={1} sx={relationWideControlSx}>
        <SectionTitle>{t('workspace.asset.relations.relevantWebsites')}</SectionTitle>
        {!readOnly && (
          <Button size="small" variant="action" onClick={openAddLinkDialog}>
            {t('workspace.asset.relations.addUrl')}
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
            void syncUrls(urls.filter((_, currentIndex) => currentIndex !== index));
          }}
          sx={relationWideControlSx}
        />
      </Stack>

      {/* Attachments */}
      <SectionTitle>{t('workspace.asset.relations.attachments')}</SectionTitle>
      <Stack spacing={1} sx={relationWideControlSx}>
        <Box
          onDragOver={(e) => { e.preventDefault(); setHover(true); }}
          onDragLeave={() => setHover(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setHover(false);
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length === 0) return;
            setUploading(true);
            setUploadCount(files.length);
            try {
              for (const f of files) {
                const fd = new FormData();
                fd.append('file', f);
                await api.post(`/assets/${assetId}/attachments`, fd);
              }
              const res = await api.get(`/assets/${assetId}/attachments`);
              setAttachments(res.data || []);
              onRelationsChange?.();
            } finally {
              setUploading(false);
              setUploadCount(0);
            }
          }}
          sx={{ border: '2px dashed', borderColor: hover ? 'primary.main' : 'divider', borderRadius: 1, p: 2, textAlign: 'center', cursor: 'pointer' }}
        >
          <Typography variant="body2" color="text.secondary">{t('workspace.asset.relations.dropHint')}</Typography>
          <Box sx={{ mt: 1 }}>
            <Button
              component="label"
              size="small"
              variant="outlined"
              disabled={uploading || readOnly}
            >
              {t('workspace.asset.relations.selectFiles')}
              <input
                type="file"
                hidden
                multiple
                onChange={async (e) => {
                  const input = e.currentTarget as HTMLInputElement | null;
                  const files = Array.from((e.target as HTMLInputElement)?.files || []);
                  if (files.length === 0) return;
                  setUploading(true);
                  setUploadCount(files.length);
                  try {
                    for (const f of files) {
                      const fd = new FormData();
                      fd.append('file', f);
                      await api.post(`/assets/${assetId}/attachments`, fd);
                    }
                    const res = await api.get(`/assets/${assetId}/attachments`);
                    setAttachments(res.data || []);
                    onRelationsChange?.();
                  } finally {
                    setUploading(false);
                    setUploadCount(0);
                    if (input) input.value = '';
                  }
                }}
              />
            </Button>
          </Box>
        </Box>
        {uploading && <LinearProgress sx={{ mt: 1 }} />}
        {uploading && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {t('workspace.asset.relations.uploading', { count: uploadCount })}
          </Typography>
        )}
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {attachments.map((a) => {
            const canDelete = hasLevel('infrastructure', 'member') && !readOnly;
            const onDelete = async () => {
              if (!canDelete) return;
              const ok = await dialogs.confirm({
                message: t('workspace.asset.relations.deleteAttachmentConfirm', { name: a.original_filename }),
                confirmLabel: t('common:buttons.delete'),
                intent: 'danger',
              });
              if (!ok) return;
              try {
                await api.patch(`/assets/attachments/${a.id}/delete`, {});
                const res = await api.get(`/assets/${assetId}/attachments`);
                setAttachments(res.data || []);
              } catch { /* ignore */ }
            };
            return (
              <Chip
                key={a.id}
                label={a.original_filename}
                onClick={async () => {
                  const res = await api.get(`/assets/attachments/${a.id}`, { responseType: 'blob' });
                  const blob = new Blob([res.data]);
                  const url = window.URL.createObjectURL(blob);
                  const el = document.createElement('a');
                  el.href = url;
                  el.download = a.original_filename;
                  el.click();
                  window.URL.revokeObjectURL(url);
                }}
                onDelete={canDelete ? onDelete : undefined}
                deleteIcon={canDelete ? <DeleteIcon fontSize="small" /> : undefined}
              />
            );
          })}
        </Stack>
      </Stack>

      <IncidentRelationsSection assetId={assetId} />
    </Stack>

    <KanapDialog
      open={linkDialogOpen}
      title={editingLinkIndex === null ? t('workspace.asset.relations.newUrl') : t('workspace.asset.relations.editUrl')}
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
            placeholder={t('workspace.asset.relations.websiteNamePlaceholder')}
            autoFocus
            inputRef={linkNameInputRef}
            variant="standard"
            fullWidth
            sx={drawerFieldValueSx}
          />
        </PropertyRow>
        <PropertyRow label={t('workspace.asset.relations.url')} required>
          <TextField
            value={linkDraft.url}
            onChange={(event) => setLinkDraft((prev) => ({ ...prev, url: event.target.value }))}
            placeholder="https://example.com"
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
