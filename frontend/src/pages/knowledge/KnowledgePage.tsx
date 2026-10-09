import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  ListSubheader,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import SettingsIcon from '@mui/icons-material/Settings';
import type { ICellRendererParams } from 'ag-grid-community';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import ChipToggleBar, { ChipToggleContextLine } from '../../components/ChipToggleBar';
import { KanapDialog, PropertyRow, StatusDot } from '../../components/design';
import ServerDataGrid from '../../components/ServerDataGrid';
import type { EnhancedColDef } from '../../components/ServerDataGrid';
import { LinkCellRenderer } from '../../components/grid/renderers';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import { useAuth } from '../../auth/AuthContext';
import { useGridScopePreference } from '../../hooks/useGridScopePreference';
import FolderTreePanel, {
  ROOT_FOLDER_DROP_TARGET,
  type DraggedFolderState as FolderTreeDraggedFolderState,
} from './components/FolderTreePanel';
import KnowledgeFolderMoveDialog from './components/KnowledgeFolderMoveDialog';
import KnowledgeMoveDialog from './components/KnowledgeMoveDialog';
import ValidatedBadge from './components/ValidatedBadge';
import KnowledgeTypesManager from './components/KnowledgeTypesManager';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { getDotColor, KNOWLEDGE_STATUS_COLORS } from '../../utils/statusColors';
import { drawerAutocompleteListboxSx, drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { setListFiltersParam, getWithListContext } from '../../lib/listContext';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  archived: 'Archived',
  obsolete: 'Obsolete',
};

const TEMPLATE_LIBRARY_SLUG = 'templates';
const MANAGED_DOCS_LIBRARY_SLUG = 'managed-docs';

type DocumentRow = {
  id: string;
  item_number: number;
  item_ref: string;
  title: string;
  status: string;
  revision: number | null;
  current_version_number: number | null;
  document_type_name: string | null;
  primary_owner_name: string | null;
  classification_summary: string | null;
  application_names: string | null;
  asset_names: string | null;
  folder_id: string | null;
  library_id: string | null;
  folder_name: string | null;
  template_name: string | null;
  library_name: string | null;
  validated_revision: number | null;
  validated_at: string | null;
  is_validated_current_revision: boolean;
  is_managed_integrated_document?: boolean;
  can_write?: boolean;
  updated_at: string | null;
};

type DocumentLibrary = {
  id: string;
  name: string;
  slug: string;
  is_system: boolean;
  display_order: number;
  access_mode?: 'default' | 'restricted';
  owner_user_id?: string | null;
  is_restricted?: boolean;
  effective_access_level?: 'reader' | 'writer' | 'admin' | null;
  can_manage?: boolean;
  can_write?: boolean;
  can_delete?: boolean;
};

type KnowledgeContributorOption = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  label: string;
};

type KnowledgeLibraryDetail = DocumentLibrary & {
  owner: KnowledgeContributorOption | null;
  readers: KnowledgeContributorOption[];
  writers: KnowledgeContributorOption[];
};

type TemplateListItem = {
  id: string;
  item_number: number;
  title: string;
  document_type_id: string | null;
  document_type_name: string | null;
};

type DraggedDocumentState = {
  ids: string[];
  rows: DocumentRow[];
  libraryId: string;
  librarySlug: string;
  count: number;
};

type DraggedFolderState = FolderTreeDraggedFolderState & {
  librarySlug: string;
  libraryName: string | null;
};

function StatusCellRenderer(props: any) {
  const status = props.value;
  const { t } = useTranslation(['knowledge']);
  const mode = useTheme().palette.mode;
  const colorKey = KNOWLEDGE_STATUS_COLORS[status] || 'default';
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ height: '100%' }}>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
        <StatusDot color={getDotColor(colorKey, mode)} />
        <Typography variant="body2" sx={{ color: getDotColor(colorKey, mode), fontWeight: 500, fontSize: '0.8125rem' }}>
          {t(`knowledge:statuses.${status}`, { defaultValue: STATUS_LABELS[status] || status })}
        </Typography>
      </Box>
      {props.data?.is_validated_current_revision && (
        <ValidatedBadge size="small" iconOnly />
      )}
    </Stack>
  );
}

export default function KnowledgePage() {
  const { hasLevel, profile } = useAuth();
  const { t } = useTranslation(['knowledge', 'common']);
  const locale = useLocale();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const canManageDocuments = hasLevel('knowledge', 'member');
  const canCreateLibraries = hasLevel('knowledge', 'member');
  const canAdminLibraries = hasLevel('knowledge', 'admin');
  const canMoveAcrossLibraries = canAdminLibraries;

  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const urlScope = useMemo(() => {
    const scope = queryParams.get('docScope');
    if (scope === 'my' || scope === 'team' || scope === 'all') return scope;
    return null;
  }, [queryParams]);

  const [docScope, setDocScope] = useGridScopePreference('knowledge', urlScope);

  const searchAllLibraries = queryParams.get('allLibraries') === '1';
  const librarySlugFromUrl = queryParams.get('library') || '';
  const selectedFolderId = searchAllLibraries ? null : (queryParams.get('folder_id') || null);

  const updateQuery = useCallback((patch: Record<string, string | null>, replace = false) => {
    const sp = new URLSearchParams(location.search);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) sp.delete(key);
      else sp.set(key, value);
    });
    const next = sp.toString();
    navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace });
  }, [location.pathname, location.search, navigate]);

  const [createLibraryOpen, setCreateLibraryOpen] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [editingLibrary, setEditingLibrary] = useState<DocumentLibrary | null>(null);
  const [librarySettingsName, setLibrarySettingsName] = useState('');
  const [librarySettingsOwnerId, setLibrarySettingsOwnerId] = useState<string | null>(null);
  const [librarySettingsAccessMode, setLibrarySettingsAccessMode] = useState<'default' | 'restricted'>('default');
  const [librarySettingsReaderIds, setLibrarySettingsReaderIds] = useState<string[]>([]);
  const [librarySettingsWriterIds, setLibrarySettingsWriterIds] = useState<string[]>([]);
  const [accessResetConfirmOpen, setAccessResetConfirmOpen] = useState(false);
  const [deleteLibraryConfirmOpen, setDeleteLibraryConfirmOpen] = useState(false);

  const { data: libraries = [] } = useQuery({
    queryKey: ['knowledge-libraries'],
    queryFn: async () => (await api.get('/knowledge-libraries')).data as DocumentLibrary[],
  });

  const { data: editingLibraryDetail, isLoading: editingLibraryLoading, error: editingLibraryError } = useQuery({
    queryKey: ['knowledge-library', editingLibrary?.id],
    queryFn: async () => (await api.get(`/knowledge-libraries/${editingLibrary?.id}`)).data as KnowledgeLibraryDetail,
    enabled: !!editingLibrary?.id,
  });

  const { data: knowledgeContributorOptions = [] } = useQuery({
    queryKey: ['knowledge-contributor-options'],
    queryFn: async () => (await api.get('/knowledge/contributor-options')).data as KnowledgeContributorOption[],
    enabled: !!editingLibrary,
    staleTime: 5 * 60 * 1000,
  });

  const sortedLibraries = useMemo(() => {
    const userLibraries = libraries.filter((library) => !library.is_system);
    const otherSystemLibraries = libraries.filter(
      (library) => library.is_system
        && library.slug !== MANAGED_DOCS_LIBRARY_SLUG
        && library.slug !== TEMPLATE_LIBRARY_SLUG,
    );
    const managedDocsLibraries = libraries.filter((library) => library.slug === MANAGED_DOCS_LIBRARY_SLUG);
    const templatesLibraries = libraries.filter((library) => library.slug === TEMPLATE_LIBRARY_SLUG);
    return [
      ...userLibraries,
      ...otherSystemLibraries,
      ...managedDocsLibraries,
      ...templatesLibraries,
    ];
  }, [libraries]);

  const activeLibrary = useMemo(() => {
    if (!libraries.length) return null;
    if (librarySlugFromUrl) {
      const match = libraries.find((row) => row.slug === librarySlugFromUrl);
      if (match) return match;
    }
    return libraries.find((row) => !row.is_system) || libraries[0];
  }, [libraries, librarySlugFromUrl]);

  React.useEffect(() => {
    if (!activeLibrary) return;
    const currentSlug = queryParams.get('library');
    if (currentSlug === activeLibrary.slug) return;

    const sp = new URLSearchParams(location.search);
    sp.set('library', activeLibrary.slug);
    const next = sp.toString();
    navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true });
  }, [activeLibrary, location.pathname, location.search, navigate, queryParams]);

  const { data: myTeamConfig, isFetched: isTeamConfigFetched } = useQuery({
    queryKey: ['my-team-config', profile?.id],
    queryFn: async () => {
      const res = await api.get<{ id: string; team_id?: string | null }>(`/portfolio/team-members/by-user/${profile?.id}`);
      return res.data;
    },
    enabled: !!profile?.id,
  });

  const hasTeam = !!myTeamConfig?.team_id;

  React.useEffect(() => {
    if (docScope === 'team' && isTeamConfigFetched && !hasTeam) {
      setDocScope('my');
    }
  }, [docScope, isTeamConfigFetched, hasTeam, setDocScope]);

  const extraParams = useMemo(() => {
    const params: Record<string, any> = {};
    if (docScope === 'my') params.ownerUserId = profile?.id;
    else if (docScope === 'team' && hasTeam) params.teamId = myTeamConfig?.team_id;
    if (!searchAllLibraries && activeLibrary?.id) params.library_id = activeLibrary.id;
    if (!searchAllLibraries) {
      if (selectedFolderId) params.folder_id = selectedFolderId;
      else params.root_folder = '1';
    }
    return params;
  }, [docScope, profile?.id, hasTeam, myTeamConfig?.team_id, searchAllLibraries, activeLibrary?.id, selectedFolderId]);

  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const gridApiRef = useRef<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedRows, setSelectedRows] = useState<DocumentRow[]>([]);
  /** The grid's row count (its filters apply), once a page has loaded. */
  const [documentTotal, setDocumentTotal] = useState<number | null>(null);
  const [draggedDocuments, setDraggedDocuments] = useState<DraggedDocumentState | null>(null);
  const [draggedFolder, setDraggedFolder] = useState<DraggedFolderState | null>(null);
  const [dragHoveredFolderId, setDragHoveredFolderId] = useState<string | null>(null);
  const [dragHoveredLibraryId, setDragHoveredLibraryId] = useState<string | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDialogRowsOverride, setMoveDialogRowsOverride] = useState<DocumentRow[] | null>(null);
  const [moveDialogTargetLibraryId, setMoveDialogTargetLibraryId] = useState<string | null>(null);
  const [folderMoveDialogOpen, setFolderMoveDialogOpen] = useState(false);
  const [folderMoveDialogFolder, setFolderMoveDialogFolder] = useState<DraggedFolderState | null>(null);
  const [folderMoveDialogTargetLibraryId, setFolderMoveDialogTargetLibraryId] = useState<string | null>(null);
  const [moveSnackbar, setMoveSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'updated_at:DESC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    setListFiltersParam(sp, '/knowledge', filters);
    sp.set('docScope', docScope);
    if (activeLibrary?.slug) sp.set('library', activeLibrary.slug);
    sp.set('allLibraries', searchAllLibraries ? '1' : '0');
    if (!searchAllLibraries && selectedFolderId) sp.set('folder_id', selectedFolderId);
    if (docScope === 'my' && profile?.id) {
      sp.set('ownerUserId', profile.id);
    } else if (docScope === 'team' && myTeamConfig?.team_id) {
      sp.set('teamId', myTeamConfig.team_id);
    }
    return sp;
  }, [docScope, activeLibrary?.slug, searchAllLibraries, selectedFolderId, profile?.id, myTeamConfig?.team_id]);

  const clearSelection = useCallback(() => {
    setSelectedRows([]);
    try {
      gridApiRef.current?.deselectAll?.();
    } catch {
      // Ignore grid deselection errors during dataset changes.
    }
  }, []);

  const clearDocumentDragState = useCallback(() => {
    setDraggedDocuments(null);
    setDragHoveredFolderId(null);
    setDragHoveredLibraryId(null);
  }, []);

  const clearFolderDragState = useCallback(() => {
    setDraggedFolder(null);
    setDragHoveredLibraryId(null);
  }, []);

  const resetMoveDialogState = useCallback(() => {
    setMoveDialogRowsOverride(null);
    setMoveDialogTargetLibraryId(null);
  }, []);

  const resetFolderMoveDialogState = useCallback(() => {
    setFolderMoveDialogFolder(null);
    setFolderMoveDialogTargetLibraryId(null);
  }, []);

  const dragToFolderEnabled = canManageDocuments && !searchAllLibraries && !!activeLibrary?.id && !!activeLibrary?.can_write;

  const getDocFilterValues = useCallback((field: string, opts?: { labelMap?: Record<string, string>; order?: Array<string | null>; emptyLabel?: string }) => {
    const labelMap = opts?.labelMap;
    const order = opts?.order;
    const emptyLabel = opts?.emptyLabel ?? t('shared.blank');
    return async ({ context }: any) => {
      const queryState = context?.getQueryState?.() ?? {};
      const filters = { ...(queryState.filters || {}) };
      delete filters[field];
      const params: Record<string, any> = {
        fields: field,
        ...(queryState.extraParams || {}),
      };
      if (queryState.q) params.q = queryState.q;
      if (Object.keys(filters).length > 0) {
        params.filters = JSON.stringify(filters);
      }
      const res = await getWithListContext('/knowledge/filter-values', params);
      const values = (res.data?.[field] || []) as Array<string | null>;
      let options = values.map((value) => {
        if (value == null) return { value, label: emptyLabel };
        const key = String(value);
        const label = labelMap && Object.prototype.hasOwnProperty.call(labelMap, key) ? labelMap[key] : key;
        return { value, label };
      });
      if (order && order.length > 0) {
        const orderMap = new Map(order.map((val, index) => [val, index]));
        options.sort((a, b) => {
          const aIndex = orderMap.has(a.value) ? (orderMap.get(a.value) as number) : Number.MAX_SAFE_INTEGER;
          const bIndex = orderMap.has(b.value) ? (orderMap.get(b.value) as number) : Number.MAX_SAFE_INTEGER;
          if (aIndex !== bIndex) return aIndex - bIndex;
          return (a.label || '').localeCompare(b.label || '');
        });
      } else {
        options.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      }
      return options;
    };
  }, [t]);

  const ClickableCell: React.FC<ICellRendererParams<DocumentRow, any>> = (params) => (
    <LinkCellRenderer
      {...params}
      linkType="internal"
      getHref={(data) => {
        const sp = buildWorkspaceSearch();
        const ref = data?.item_ref || data?.id;
        if (!ref) return null;
        return `/knowledge/${ref}?${sp.toString()}`;
      }}
      onNavigate={(href) => navigate(href)}
    />
  );

  const DragHandleCell: React.FC<ICellRendererParams<DocumentRow, any>> = (params) => {
    const row = params.data;
    const disabled = !dragToFolderEnabled
      || !row?.id
      || row?.can_write === false
      || !!row?.is_managed_integrated_document
      || moveDocumentsMutation.isPending;
    const disabledReason = row?.is_managed_integrated_document
      ? t('messages.managedDocsCannotMove')
      : row?.can_write === false
        ? t('messages.noPermissionMoveSelectedDocuments')
      : t('messages.dragSingleLibraryOnly');
    return (
      <Tooltip title={disabled ? disabledReason : t('messages.dragToFolderOrLibrary')}>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            color: disabled ? 'text.disabled' : 'text.secondary',
            cursor: disabled ? 'not-allowed' : 'grab',
          }}
          draggable={!disabled}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event: React.DragEvent<HTMLSpanElement>) => handleDocumentDragStart(event, row)}
          onDragEnd={handleDocumentDragEnd}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>
      </Tooltip>
    );
  };

  const columns: EnhancedColDef<DocumentRow>[] = useMemo(() => {
    const nextColumns: EnhancedColDef<DocumentRow>[] = [];

    if (dragToFolderEnabled) {
      nextColumns.push({
        colId: '__drag__',
        headerName: '',
        width: 42,
        maxWidth: 42,
        minWidth: 42,
        pinned: 'left',
        lockPinned: true,
        lockPosition: 'left',
        sortable: false,
        filter: false,
        resizable: false,
        suppressMovable: true,
        suppressColumnsToolPanel: true,
        cellRenderer: DragHandleCell,
      });
    }

    nextColumns.push({
      field: 'item_ref',
      headerName: t('columns.ref'),
      width: 100,
      cellRenderer: ClickableCell,
    });
    nextColumns.push({
      field: 'title',
      headerName: t('columns.title'),
      flex: 1.5,
      minWidth: 200,
      filter: 'agTextColumnFilter',
      cellRenderer: ClickableCell,
    });
    nextColumns.push({
      field: 'status',
      headerName: t('columns.status'),
      width: 190,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getDocFilterValues('status', {
          labelMap: STATUS_LABELS,
          order: ['draft', 'in_review', 'published', 'archived', 'obsolete'],
        }),
        searchable: false,
      },
      cellRenderer: StatusCellRenderer,
    });
    nextColumns.push({
      field: 'document_type_name',
      headerName: t('columns.type'),
      width: 160,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
        getValues: getDocFilterValues('document_type_name', { emptyLabel: t('shared.none') }),
      },
      cellRenderer: ClickableCell,
      valueFormatter: (p: any) => p.value || t('shared.document'),
    });
    nextColumns.push({
      field: 'current_version_number',
      headerName: t('columns.version'),
      width: 90,
      cellRenderer: ClickableCell,
      valueFormatter: (p: any) => p.value != null ? `v${p.value}` : '',
    });
    nextColumns.push({
      field: 'primary_owner_name',
      headerName: t('columns.owner'),
      flex: 1,
      minWidth: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getDocFilterValues('primary_owner_name'),
      },
      cellRenderer: ClickableCell,
    });
    nextColumns.push({
      field: 'folder_name',
      headerName: t('columns.folder'),
      width: 150,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getDocFilterValues('folder_name', { emptyLabel: t('shared.unfiled') }),
      },
      cellRenderer: ClickableCell,
      valueFormatter: (p: any) => p.value || t('shared.unfiled'),
    });
    nextColumns.push({
      field: 'template_name',
      headerName: t('columns.template'),
      width: 180,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getDocFilterValues('template_name', { emptyLabel: t('shared.none') }),
      },
      cellRenderer: ClickableCell,
      hide: true,
    });
    nextColumns.push({
      field: 'library_name',
      headerName: t('columns.library'),
      width: 160,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getDocFilterValues('library_name', { emptyLabel: t('shared.unknown') }),
      },
      cellRenderer: ClickableCell,
      hide: !searchAllLibraries,
    });
    nextColumns.push({
      field: 'updated_at',
      headerName: t('columns.updated'),
      width: 120,
      cellRenderer: ClickableCell,
      valueFormatter: (params) => formatShortDate(params.value, locale),
    });

    return nextColumns;
  }, [ClickableCell, DragHandleCell, dragToFolderEnabled, getDocFilterValues, locale, searchAllLibraries, t]);

  const createLibraryMutation = useMutation({
    mutationFn: async () => {
      return (await api.post('/knowledge-libraries', { name: newLibraryName.trim() })).data as DocumentLibrary;
    },
    onSuccess: async (created) => {
      setCreateLibraryOpen(false);
      setNewLibraryName('');
      await qc.invalidateQueries({ queryKey: ['knowledge-libraries'] });
      updateQuery({ library: created.slug, allLibraries: '0', folder_id: null });
    },
  });

  const saveLibraryMutation = useMutation({
    mutationFn: async () => {
      if (!editingLibrary) return null;
      return (await api.patch(`/knowledge-libraries/${editingLibrary.id}`, {
        name: librarySettingsName.trim(),
        owner_user_id: librarySettingsOwnerId,
        access_mode: librarySettingsAccessMode,
        reader_user_ids: librarySettingsAccessMode === 'restricted' ? librarySettingsReaderIds : [],
        writer_user_ids: librarySettingsAccessMode === 'restricted' ? librarySettingsWriterIds : [],
      })).data as DocumentLibrary;
    },
    onSuccess: async (updated) => {
      if (!updated) return;
      setEditingLibrary(null);
      setLibrarySettingsName('');
      setLibrarySettingsOwnerId(null);
      setLibrarySettingsAccessMode('default');
      setLibrarySettingsReaderIds([]);
      setLibrarySettingsWriterIds([]);
      await qc.invalidateQueries({ queryKey: ['knowledge-libraries'] });
      await qc.invalidateQueries({ queryKey: ['knowledge-library', updated.id] });
      if (activeLibrary?.id === updated.id) {
        updateQuery({ library: updated.slug });
      }
    },
  });

  const deleteLibraryMutation = useMutation({
    mutationFn: async () => {
      if (!editingLibrary) return;
      await api.delete(`/knowledge-libraries/${editingLibrary.id}`);
    },
    onSuccess: async () => {
      setEditingLibrary(null);
      setLibrarySettingsName('');
      setLibrarySettingsOwnerId(null);
      setLibrarySettingsAccessMode('default');
      setLibrarySettingsReaderIds([]);
      setLibrarySettingsWriterIds([]);
      await qc.invalidateQueries({ queryKey: ['knowledge-libraries'] });
      updateQuery({ folder_id: null, allLibraries: '0' });
    },
  });

  const openLibraryEdit = (library: DocumentLibrary) => {
    setEditingLibrary(library);
    setLibrarySettingsName(library.name);
    setLibrarySettingsOwnerId(library.owner_user_id || null);
    setLibrarySettingsAccessMode(library.is_restricted ? 'restricted' : 'default');
    setLibrarySettingsReaderIds([]);
    setLibrarySettingsWriterIds([]);
  };

  React.useEffect(() => {
    if (!editingLibraryDetail) return;
    setLibrarySettingsName(editingLibraryDetail.name || '');
    setLibrarySettingsOwnerId(editingLibraryDetail.owner?.id || editingLibraryDetail.owner_user_id || null);
    setLibrarySettingsAccessMode(editingLibraryDetail.is_restricted ? 'restricted' : 'default');
    setLibrarySettingsReaderIds(editingLibraryDetail.readers.map((user) => user.id));
    setLibrarySettingsWriterIds(editingLibraryDetail.writers.map((user) => user.id));
  }, [editingLibraryDetail]);

  const librarySelectableUsers = useMemo(() => {
    const byId = new Map<string, KnowledgeContributorOption>();
    // Later entries win: the contributor options come last, their label is the email when a name is shared.
    [...(editingLibraryDetail?.readers || []), ...(editingLibraryDetail?.writers || []), ...(editingLibraryDetail?.owner ? [editingLibraryDetail.owner] : []), ...knowledgeContributorOptions]
      .forEach((user) => {
        if (user?.id) byId.set(user.id, user);
      });
    const users = Array.from(byId.values());
    users.sort((left, right) => {
      const leftLabel = (left.label || left.email || left.id).trim().toLocaleLowerCase();
      const rightLabel = (right.label || right.email || right.id).trim().toLocaleLowerCase();
      return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base' });
    });
    if (profile?.id) {
      const myIndex = users.findIndex((user) => user.id === profile.id);
      if (myIndex > 0) users.unshift(...users.splice(myIndex, 1));
    }
    return users;
  }, [editingLibraryDetail?.owner, editingLibraryDetail?.readers, editingLibraryDetail?.writers, knowledgeContributorOptions, profile?.id]);

  const userOptionById = useMemo(() => {
    const byId = new Map<string, KnowledgeContributorOption>();
    librarySelectableUsers.forEach((user) => byId.set(user.id, user));
    return byId;
  }, [librarySelectableUsers]);

  const selectedLibraryOwner = librarySettingsOwnerId ? (userOptionById.get(librarySettingsOwnerId) || null) : null;
  const selectedLibraryReaders = librarySettingsReaderIds
    .map((userId) => userOptionById.get(userId))
    .filter((user): user is KnowledgeContributorOption => !!user);
  const selectedLibraryWriters = librarySettingsWriterIds
    .map((userId) => userOptionById.get(userId))
    .filter((user): user is KnowledgeContributorOption => !!user);
  const libraryHasRestrictedMembers = librarySettingsReaderIds.length > 0 || librarySettingsWriterIds.length > 0;

  const getLibrarySelectableUserLabel = useCallback((user: KnowledgeContributorOption) => {
    const baseLabel = user.label || user.email || user.id;
    return user.id === profile?.id ? `${baseLabel} ${t('common:selects.meSuffix')}` : baseLabel;
  }, [profile?.id, t]);

  const renderLibrarySelectableUserOption = useCallback((
    props: React.HTMLAttributes<HTMLLIElement>,
    option: KnowledgeContributorOption,
  ) => (
    <React.Fragment key={option.id}>
      <li {...props}>
        <div style={{ fontWeight: 500 }}>
          {getLibrarySelectableUserLabel(option)}
        </div>
      </li>
      {option.id === profile?.id && <Divider />}
    </React.Fragment>
  ), [getLibrarySelectableUserLabel, profile?.id]);

  const handleLibraryOwnerChange = useCallback((nextOwner: KnowledgeContributorOption | null) => {
    const nextOwnerId = nextOwner?.id || null;
    setLibrarySettingsOwnerId(nextOwnerId);
    if (!nextOwnerId) return;
    setLibrarySettingsReaderIds((current) => current.filter((userId) => userId !== nextOwnerId));
    setLibrarySettingsWriterIds((current) => current.filter((userId) => userId !== nextOwnerId));
  }, []);

  const handleLibraryReadersChange = useCallback((nextUsers: KnowledgeContributorOption[]) => {
    const nextIds = Array.from(new Set(nextUsers.map((user) => user.id)))
      .filter((userId) => userId !== librarySettingsOwnerId && !librarySettingsWriterIds.includes(userId));
    setLibrarySettingsReaderIds(nextIds);
  }, [librarySettingsOwnerId, librarySettingsWriterIds]);

  const handleLibraryWritersChange = useCallback((nextUsers: KnowledgeContributorOption[]) => {
    const nextIds = Array.from(new Set(nextUsers.map((user) => user.id)))
      .filter((userId) => userId !== librarySettingsOwnerId);
    setLibrarySettingsWriterIds(nextIds);
    setLibrarySettingsReaderIds((current) => current.filter((userId) => userId !== librarySettingsOwnerId && !nextIds.includes(userId)));
  }, [librarySettingsOwnerId]);

  const handleLibraryAccessModeChange = useCallback((nextMode: 'default' | 'restricted') => {
    if (nextMode === 'default' && librarySettingsAccessMode === 'restricted' && libraryHasRestrictedMembers) {
      setAccessResetConfirmOpen(true);
      return;
    }
    setLibrarySettingsAccessMode(nextMode);
  }, [libraryHasRestrictedMembers, librarySettingsAccessMode]);

  const confirmResetLibraryAccess = useCallback(() => {
    setLibrarySettingsReaderIds([]);
    setLibrarySettingsWriterIds([]);
    setLibrarySettingsAccessMode('default');
    setAccessResetConfirmOpen(false);
  }, []);

  const [newDocAnchorEl, setNewDocAnchorEl] = useState<null | HTMLElement>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [typesManagerOpen, setTypesManagerOpen] = useState(false);

  React.useEffect(() => {
    clearSelection();
    setDocumentTotal(null);
    clearDocumentDragState();
    clearFolderDragState();
    resetMoveDialogState();
    resetFolderMoveDialogState();
  }, [
    activeLibrary?.id,
    clearDocumentDragState,
    clearFolderDragState,
    clearSelection,
    docScope,
    resetFolderMoveDialogState,
    resetMoveDialogState,
    searchAllLibraries,
    selectedFolderId,
  ]);

  const templatesLibrary = useMemo(
    () => libraries.find((row) => row.slug === TEMPLATE_LIBRARY_SLUG) || null,
    [libraries],
  );

  const moveDialogRows = moveDialogRowsOverride ?? selectedRows;
  const templateLibraryId = templatesLibrary?.id || null;
  const folderMoveTarget = folderMoveDialogFolder
    ? {
      id: folderMoveDialogFolder.id,
      name: folderMoveDialogFolder.name,
      library_id: folderMoveDialogFolder.libraryId,
      library_name: folderMoveDialogFolder.libraryName,
    }
    : null;

  const { data: templatesData } = useQuery({
    queryKey: ['knowledge', 'templates-library', templatesLibrary?.id],
    queryFn: async () => {
      const res = await api.get('/knowledge', {
        params: {
          library_id: templatesLibrary?.id,
          status: 'published',
          limit: 200,
          sort: 'updated_at:DESC',
        },
      });
      return res.data as { items: TemplateListItem[] };
    },
    enabled: templatePickerOpen && !!templatesLibrary?.id,
  });

  const groupedTemplates = useMemo(() => {
    const groups: Array<{ typeName: string; items: TemplateListItem[] }> = [];
    const byType = new Map<string, TemplateListItem[]>();
    for (const item of templatesData?.items || []) {
      const typeName = String(item.document_type_name || 'Document').trim() || 'Document';
      if (!byType.has(typeName)) byType.set(typeName, []);
      byType.get(typeName)!.push(item);
    }
    Array.from(byType.keys())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .forEach((typeName) => {
        groups.push({
          typeName,
          items: (byType.get(typeName) || []).sort((a, b) => {
            if (a.title === b.title) return Number(b.item_number || 0) - Number(a.item_number || 0);
            return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
          }),
        });
      });
    return groups;
  }, [templatesData?.items]);

  const goToBlankDocument = () => {
    if (!activeLibrary?.can_write) return;
    const sp = new URLSearchParams();
    sp.set('library', activeLibrary.slug);
    if (!searchAllLibraries && selectedFolderId) sp.set('folder_id', selectedFolderId);
    navigate(`/knowledge/new?${sp.toString()}`);
  };

  const selectionLibraryIds = useMemo(
    () => Array.from(new Set(selectedRows.map((row) => row.library_id).filter((value): value is string => !!value))),
    [selectedRows],
  );
  const selectionIncludesTemplateLibrary = useMemo(
    () => !!templateLibraryId && selectionLibraryIds.includes(templateLibraryId),
    [selectionLibraryIds, templateLibraryId],
  );
  const selectionIncludesManagedIntegratedDocs = useMemo(
    () => selectedRows.some((row) => !!row.is_managed_integrated_document),
    [selectedRows],
  );
  const selectionIncludesReadOnlyDocuments = useMemo(
    () => selectedRows.some((row) => row.can_write === false),
    [selectedRows],
  );

  const moveDisabledReason = useMemo(() => {
    if (selectedRows.length === 0) return t('messages.selectAtLeastOneDocument');
    if (!canManageDocuments) return t('messages.noPermissionMoveDocuments');
    if (selectionIncludesReadOnlyDocuments) return t('messages.noPermissionMoveSelectedDocuments');
    if (selectionIncludesManagedIntegratedDocs) return t('messages.managedDocsCannotMove');
    if (selectionIncludesTemplateLibrary && selectionLibraryIds.length > 1) {
      return t('messages.moveTemplatesSeparately');
    }
    if (!canMoveAcrossLibraries && selectionLibraryIds.length > 1) {
      return t('messages.selectSingleLibraryToMove');
    }
    return '';
  }, [
    canManageDocuments,
    canMoveAcrossLibraries,
    selectedRows.length,
    selectionIncludesReadOnlyDocuments,
    selectionIncludesManagedIntegratedDocs,
    selectionIncludesTemplateLibrary,
    selectionLibraryIds.length,
    t,
  ]);
  const deleteDisabledReason = useMemo(() => {
    if (selectedRows.length === 0) return t('messages.selectAtLeastOneDocument');
    if (selectionIncludesManagedIntegratedDocs) return t('messages.managedDocsCannotDelete');
    return '';
  }, [selectedRows.length, selectionIncludesManagedIntegratedDocs, t]);

  const moveDocumentsMutation = useMutation({
    mutationFn: async ({
      ids,
      target_library_id,
      target_folder_id,
    }: {
      ids: string[];
      target_library_id: string;
      target_folder_id: string | null;
    }) => {
      await api.post('/knowledge/bulk-move', {
        ids,
        target_library_id,
        target_folder_id,
      });
    },
    onSuccess: (_data, variables) => {
      const movedCount = variables.ids.length;
      setMoveDialogOpen(false);
      clearSelection();
      clearDocumentDragState();
      resetMoveDialogState();
      setRefreshKey((prev) => prev + 1);
      setMoveSnackbar({
        open: true,
        message: movedCount === 1 ? t('messages.documentMoved') : t('messages.documentsMoved', { count: movedCount }),
        severity: 'success',
      });
    },
    onError: (error: any) => {
      setMoveSnackbar({
        open: true,
        message: getApiErrorMessage(error, t, t('messages.moveDocumentsFailed')),
        severity: 'error',
      });
      clearDocumentDragState();
    },
  });

  const moveFolderMutation = useMutation({
    mutationFn: async ({
      id,
      target_library_id,
      target_folder_id,
    }: {
      id: string;
      target_library_id: string;
      target_folder_id: string | null;
    }) => {
      const res = await api.post(`/knowledge-folders/${id}/move`, {
        target_library_id,
        target_folder_id,
      });
      return res.data as { ok: true; id: string; library_id: string; parent_id: string | null };
    },
    onSuccess: async (_data, variables) => {
      const targetLibrary = libraries.find((library) => library.id === variables.target_library_id) || null;
      setFolderMoveDialogOpen(false);
      resetFolderMoveDialogState();
      clearFolderDragState();
      setRefreshKey((prev) => prev + 1);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['knowledge-folders-tree', activeLibrary?.id] }),
        qc.invalidateQueries({ queryKey: ['knowledge-folders-tree', variables.target_library_id] }),
      ]);
      if (targetLibrary) {
        updateQuery({
          library: targetLibrary.slug,
          allLibraries: '0',
          folder_id: variables.id,
        });
      }
      setMoveSnackbar({
        open: true,
        message: t('messages.folderMoved'),
        severity: 'success',
      });
    },
    onError: (error: any) => {
      setMoveSnackbar({
        open: true,
        message: getApiErrorMessage(error, t, t('messages.moveFolderFailed')),
        severity: 'error',
      });
      clearFolderDragState();
    },
  });

  const handleDocumentDragStart = useCallback((event: React.DragEvent<HTMLSpanElement>, row: DocumentRow | undefined) => {
    if (!dragToFolderEnabled || !row?.id || row.can_write === false || !activeLibrary?.id || moveDocumentsMutation.isPending) {
      event.preventDefault();
      return;
    }

    const selectedIds = new Set(selectedRows.map((selectedRow) => selectedRow.id));
    const dragRows = selectedIds.has(row.id) && selectedRows.length > 0 ? selectedRows : [row];
    if (dragRows.some((dragRow) => !!dragRow.is_managed_integrated_document || dragRow.can_write === false)) {
      event.preventDefault();
      return;
    }

    const payload: DraggedDocumentState = {
      ids: dragRows.map((dragRow) => dragRow.id),
      rows: dragRows,
      libraryId: activeLibrary.id,
      librarySlug: activeLibrary.slug,
      count: dragRows.length,
    };

    setDraggedDocuments(payload);
    setDragHoveredFolderId(null);
    setDragHoveredLibraryId(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify({
      type: 'knowledge-documents',
      ids: payload.ids,
      count: payload.count,
    }));
  }, [activeLibrary?.id, dragToFolderEnabled, moveDocumentsMutation.isPending, selectedRows]);

  const handleDocumentDragEnd = useCallback(() => {
    clearDocumentDragState();
  }, [clearDocumentDragState]);

  const handleFolderExternalDragStart = useCallback((folder: FolderTreeDraggedFolderState) => {
    if (!activeLibrary) return;
    setDraggedFolder({
      ...folder,
      librarySlug: activeLibrary.slug,
      libraryName: activeLibrary.name,
    });
    setDragHoveredLibraryId(null);
  }, [activeLibrary]);

  const handleFolderExternalDragEnd = useCallback(() => {
    clearFolderDragState();
  }, [clearFolderDragState]);

  const canDropDraggedDocumentsOnFolder = useCallback((folderId: string | null) => {
    if (!draggedDocuments || !activeLibrary?.id) return false;
    if (draggedDocuments.libraryId !== activeLibrary.id) return false;
    if (draggedDocuments.rows.some((row) => !!row.is_managed_integrated_document)) return false;
    return draggedDocuments.rows.some((row) => (row.folder_id || null) !== folderId);
  }, [activeLibrary?.id, draggedDocuments]);

  const handleFolderDragOver = useCallback((folderId: string | null, event: React.DragEvent<HTMLDivElement>) => {
    if (!canDropDraggedDocumentsOnFolder(folderId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragHoveredLibraryId !== null) {
      setDragHoveredLibraryId(null);
    }
    const hoverId = folderId ?? ROOT_FOLDER_DROP_TARGET;
    if (dragHoveredFolderId !== hoverId) {
      setDragHoveredFolderId(hoverId);
    }
  }, [canDropDraggedDocumentsOnFolder, dragHoveredFolderId, dragHoveredLibraryId]);

  const handleFolderDrop = useCallback((folderId: string | null, event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedDocuments || !activeLibrary?.id || !canDropDraggedDocumentsOnFolder(folderId)) return;
    event.preventDefault();
    setDragHoveredFolderId(null);
    moveDocumentsMutation.mutate({
      ids: draggedDocuments.ids,
      target_library_id: activeLibrary.id,
      target_folder_id: folderId,
    });
  }, [activeLibrary?.id, canDropDraggedDocumentsOnFolder, draggedDocuments, moveDocumentsMutation]);

  const canDropDraggedDocumentsOnLibrary = useCallback((library: DocumentLibrary) => {
    if (!draggedDocuments || !canMoveAcrossLibraries || moveDocumentsMutation.isPending) return false;
    if (!library.id || library.id === draggedDocuments.libraryId) return false;
    if (!library.can_write) return false;
    if (draggedDocuments.librarySlug === TEMPLATE_LIBRARY_SLUG) return false;
    if (draggedDocuments.rows.some((row) => !!row.is_managed_integrated_document)) return false;
    if (library.slug === TEMPLATE_LIBRARY_SLUG) return false;
    return true;
  }, [canMoveAcrossLibraries, draggedDocuments, moveDocumentsMutation.isPending]);

  const canDropDraggedFolderOnLibrary = useCallback((library: DocumentLibrary) => {
    if (!draggedFolder || !canMoveAcrossLibraries || moveFolderMutation.isPending) return false;
    if (!library.id || library.id === draggedFolder.libraryId) return false;
    if (!library.can_write) return false;
    if (draggedFolder.librarySlug === TEMPLATE_LIBRARY_SLUG) return false;
    if (library.slug === TEMPLATE_LIBRARY_SLUG) return false;
    return true;
  }, [canMoveAcrossLibraries, draggedFolder, moveFolderMutation.isPending]);

  const handleLibraryTabDragOver = useCallback((library: DocumentLibrary, event: React.DragEvent<HTMLElement>) => {
    const canDropDocument = canDropDraggedDocumentsOnLibrary(library);
    const canDropFolder = canDropDraggedFolderOnLibrary(library);
    if (!canDropDocument && !canDropFolder) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragHoveredFolderId !== null) {
      setDragHoveredFolderId(null);
    }
    setDragHoveredLibraryId(library.id);
  }, [canDropDraggedDocumentsOnLibrary, canDropDraggedFolderOnLibrary, dragHoveredFolderId]);

  const handleLibraryTabDrop = useCallback((library: DocumentLibrary, event: React.DragEvent<HTMLElement>) => {
    if (draggedDocuments && canDropDraggedDocumentsOnLibrary(library)) {
      event.preventDefault();
      setDragHoveredLibraryId(null);
      setMoveDialogRowsOverride(draggedDocuments.rows);
      setMoveDialogTargetLibraryId(library.id);
      setMoveDialogOpen(true);
      return;
    }
    if (draggedFolder && canDropDraggedFolderOnLibrary(library)) {
      event.preventDefault();
      setDragHoveredLibraryId(null);
      setFolderMoveDialogFolder(draggedFolder);
      setFolderMoveDialogTargetLibraryId(library.id);
      setFolderMoveDialogOpen(true);
    }
  }, [canDropDraggedDocumentsOnLibrary, canDropDraggedFolderOnLibrary, draggedDocuments, draggedFolder]);

  const openTemplatePicker = () => {
    setTemplatePickerOpen(true);
    setSelectedTemplateId('');
  };

  const createFromTemplate = () => {
    if (!activeLibrary || !selectedTemplateId) return;
    const sp = new URLSearchParams();
    sp.set('library', activeLibrary.slug);
    sp.set('template_document_id', selectedTemplateId);
    if (!searchAllLibraries && selectedFolderId) sp.set('folder_id', selectedFolderId);
    navigate(`/knowledge/new?${sp.toString()}`);
    setTemplatePickerOpen(false);
    setSelectedTemplateId('');
  };

  const scopeToolbar = (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap' }}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography variant="body2">{t('scope.show')}</Typography>
        <RadioGroup
          row
          value={docScope}
          onChange={(e) => setDocScope(e.target.value as 'my' | 'team' | 'all')}
          sx={{ '& .MuiFormControlLabel-root': { mr: 1 } }}
        >
          <FormControlLabel value="my" control={<Radio size="small" />} label={t('scope.myDocs')} />
          <Tooltip title={hasTeam ? '' : t('scope.noTeamAssigned')}>
            <span>
              <FormControlLabel
                value="team"
                control={<Radio size="small" />}
                label={t('scope.myTeamsDocs')}
                disabled={!hasTeam}
              />
            </span>
          </Tooltip>
          <FormControlLabel value="all" control={<Radio size="small" />} label={t('scope.allDocs')} />
        </RadioGroup>
      </Stack>
      <FormControlLabel
        control={(
          <Switch
            size="small"
            checked={searchAllLibraries}
            onChange={(_, checked) => {
              if (checked) {
                updateQuery({ allLibraries: '1', folder_id: null });
              } else {
                updateQuery({ allLibraries: '0' });
              }
            }}
          />
        )}
        label={<Typography variant="body2">{t('scope.allLibraries')}</Typography>}
      />
    </Stack>
  );

  const documentActions = (
    <>
      {/* Both halves are the bar's primary action; the group squares the inner corners. */}
      <ButtonGroup variant="action-primary" disableElevation>
        <Button
          startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />}
          onClick={goToBlankDocument}
          disabled={!canManageDocuments || !activeLibrary?.can_write}
        >
          {t('actions.newDocument')}
        </Button>
        <Button
          aria-label={t('actions.newDocumentOptions')}
          onClick={(e) => setNewDocAnchorEl(e.currentTarget)}
          disabled={!canManageDocuments || !activeLibrary?.can_write}
          sx={(theme) => ({
            px: 0.25,
            minWidth: 'auto',
            '&:not(.Mui-disabled)': { borderLeftColor: alpha(theme.palette.primary.contrastText, 0.35) },
          })}
        >
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        </Button>
      </ButtonGroup>
      <Tooltip title={moveDisabledReason}>
        <span>
          <Button
            variant="action"
            onClick={() => {
              resetMoveDialogState();
              setMoveDialogOpen(true);
            }}
            disabled={!!moveDisabledReason || moveDocumentsMutation.isPending}
          >
            {t('actions.moveCount', { count: selectedRows.length })}
          </Button>
        </span>
      </Tooltip>
      {canAdminLibraries && (
        <Tooltip title={deleteDisabledReason}>
          <span>
            <DeleteSelectedButton<DocumentRow>
              selectedRows={selectedRows}
              endpoint="/knowledge/bulk"
              getItemId={(row) => row.id}
              getItemName={(row) => `${row.item_ref}${row.title ? ` - ${row.title}` : ''}`}
              gridApi={gridApiRef.current}
              onDeleteSuccess={() => {
                clearSelection();
                setRefreshKey((prev) => prev + 1);
              }}
              disabled={!!deleteDisabledReason}
            />
          </span>
        </Tooltip>
      )}
    </>
  );

  const libraryActions = (
    <>
      {canCreateLibraries && (
        <Button
          variant="action"
          startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />}
          aria-label={t('libraries.newLibrary')}
          onClick={() => setCreateLibraryOpen(true)}
        >
          {t('libraries.newChip')}
        </Button>
      )}
      {activeLibrary && !activeLibrary.is_system && activeLibrary.can_manage && (
        <Button
          variant="action"
          startIcon={<SettingsIcon sx={{ fontSize: '14px !important' }} />}
          onClick={() => openLibraryEdit(activeLibrary)}
        >
          {t('libraries.manage')}
        </Button>
      )}
      {activeLibrary?.slug === TEMPLATE_LIBRARY_SLUG && canAdminLibraries && (
        <Button
          variant="action"
          onClick={() => setTypesManagerOpen(true)}
        >
          {t('actions.manageTypes')}
        </Button>
      )}
    </>
  );
  const hasLibraryActions = canCreateLibraries
    || (!!activeLibrary && !activeLibrary.is_system && !!activeLibrary.can_manage)
    || (activeLibrary?.slug === TEMPLATE_LIBRARY_SLUG && canAdminLibraries);

  const contextName = searchAllLibraries ? t('scope.allLibraries') : activeLibrary?.name;
  const contextTitle = contextName
    ? [contextName, documentTotal != null ? t('libraries.documentCount', { count: documentTotal }) : null]
      .filter(Boolean)
      .join(' · ')
    : null;

  return (
    <>
      <ChipToggleBar
        ariaLabel={t('libraries.label')}
        selectedId={activeLibrary?.slug ?? null}
        onSelect={(slug) => updateQuery({ library: slug, folder_id: null })}
        sx={{ mb: 2 }}
        items={sortedLibraries.map((library) => ({
          id: library.slug,
          label: (
            <>
              {library.name}
              {library.is_restricted && <LockOutlinedIcon sx={{ ml: 0.5, fontSize: 14, opacity: 0.8 }} />}
            </>
          ),
          onDragOver: (event) => handleLibraryTabDragOver(library, event),
          onDragLeave: () => {
            if (dragHoveredLibraryId === library.id) {
              setDragHoveredLibraryId(null);
            }
          },
          onDrop: (event) => handleLibraryTabDrop(library, event),
          highlighted: dragHoveredLibraryId === library.id,
        }))}
        actions={hasLibraryActions && libraryActions}
      />
      {contextTitle && (
        <ChipToggleContextLine
          testId="knowledge-context"
          title={contextTitle}
          actions={documentActions}
          sx={{ mb: 2 }}
        >
          {!searchAllLibraries && activeLibrary?.is_restricted && (
            <Typography variant="body2" color="text.secondary">{t('libraries.restrictedAccess')}</Typography>
          )}
        </ChipToggleContextLine>
      )}

      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        {!searchAllLibraries && !!activeLibrary?.id && (
          <FolderTreePanel
            libraryId={activeLibrary.id}
            selectedFolderId={selectedFolderId}
            onSelectFolder={(folderId) => {
              updateQuery({ folder_id: folderId || null, allLibraries: '0' });
            }}
            canManage={canManageDocuments && !!activeLibrary?.can_write}
            folderExternalDragAndDrop={{
              onDragStart: handleFolderExternalDragStart,
              onDragEnd: handleFolderExternalDragEnd,
            }}
            documentDragAndDrop={{
              active: !!draggedDocuments,
              hoverFolderId: dragHoveredFolderId,
              canDropOnFolder: canDropDraggedDocumentsOnFolder,
              onFolderDragOver: handleFolderDragOver,
              onFolderDrop: handleFolderDrop,
            }}
          />
        )}

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <ServerDataGrid<DocumentRow>
            columns={columns}
            endpoint="/knowledge"
            queryKey="knowledge"
            getRowId={(r) => r.id}
            enableSearch
            defaultSort={{ field: 'updated_at', direction: 'DESC' }}
            columnPreferencesKey="knowledge"
            extraParams={extraParams}
            refreshKey={refreshKey}
            enableRowSelection={canManageDocuments}
            onSelectionChanged={(rows) => setSelectedRows(rows)}
            onGridApiReady={(api) => { gridApiRef.current = api; }}
            toolbarExtras={scopeToolbar}
            onTotalChange={setDocumentTotal}
            onQueryStateChange={(state) => {
              lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
            }}
          />
        </Box>
      </Stack>

      <Menu
        anchorEl={newDocAnchorEl}
        open={Boolean(newDocAnchorEl)}
        onClose={() => setNewDocAnchorEl(null)}
      >
        <MenuItem onClick={() => { setNewDocAnchorEl(null); goToBlankDocument(); }}>
          {t('menus.blankDocument')}
        </MenuItem>
        <MenuItem onClick={() => { setNewDocAnchorEl(null); openTemplatePicker(); }} disabled={!templatesLibrary}>
          {t('menus.fromTemplate')}
        </MenuItem>
      </Menu>

      <KanapDialog
        open={createLibraryOpen}
        title={t('dialogs.createLibrary.title')}
        onClose={() => setCreateLibraryOpen(false)}
        onSave={() => createLibraryMutation.mutate()}
        saveLabel={t('common:buttons.create')}
        saveDisabled={!newLibraryName.trim() || createLibraryMutation.isPending}
        saveLoading={createLibraryMutation.isPending}
      >
        <Stack spacing={1.5}>
          <PropertyRow label={t('dialogs.createLibrary.fields.libraryName')} required>
            <TextField
              variant="standard"
              fullWidth
              value={newLibraryName}
              onChange={(e) => setNewLibraryName(e.target.value)}
              placeholder={t('dialogs.createLibrary.fields.libraryName')}
            />
          </PropertyRow>
          {createLibraryMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>{t('dialogs.createLibrary.messages.failed')}</Alert>
          )}
        </Stack>
      </KanapDialog>

      <KanapDialog
        open={!!editingLibrary}
        title={t('dialogs.editLibrary.title')}
        onClose={() => setEditingLibrary(null)}
        onSave={() => saveLibraryMutation.mutate()}
        saveLabel={t('common:buttons.save')}
        saveDisabled={!librarySettingsName.trim() || !librarySettingsOwnerId || saveLibraryMutation.isPending || editingLibraryLoading}
        saveLoading={saveLibraryMutation.isPending}
        footerLeft={(
          <Button
            color="error"
            onClick={() => setDeleteLibraryConfirmOpen(true)}
            disabled={!editingLibrary || deleteLibraryMutation.isPending || editingLibraryLoading}
          >
            {t('common:buttons.delete')}
          </Button>
        )}
        sx={{ maxWidth: 720 }}
      >
        {editingLibraryLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 500 }}>
                {t('dialogs.editLibrary.sections.general')}
              </Typography>
              <Stack spacing={1.25}>
                <PropertyRow label={t('dialogs.editLibrary.fields.libraryName')} required>
                  <TextField
                    variant="standard"
                    fullWidth
                    value={librarySettingsName}
                    onChange={(e) => setLibrarySettingsName(e.target.value)}
                    placeholder={t('dialogs.editLibrary.fields.libraryName')}
                  />
                </PropertyRow>
                <Typography variant="body2" color="text.secondary">
                  {t('dialogs.editLibrary.slugWarning')}
                </Typography>
                <PropertyRow label={t('dialogs.editLibrary.fields.owner')} required>
                  <Autocomplete
                    options={librarySelectableUsers}
                    value={selectedLibraryOwner}
                    onChange={(_event, value) => handleLibraryOwnerChange(value)}
                    getOptionLabel={(option) => option.label || option.email || option.id}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    renderOption={renderLibrarySelectableUserOption}
                    noOptionsText={t('common:selects.noUsersFound')}
                    ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        variant="standard"
                        placeholder={t('dialogs.editLibrary.fields.owner')}
                      />
                    )}
                  />
                </PropertyRow>
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 500 }}>
                {t('dialogs.editLibrary.sections.access')}
              </Typography>
              <Stack spacing={1.25}>
                <PropertyRow label={t('dialogs.editLibrary.fields.accessMode')}>
                  <TextField
                    select
                    variant="standard"
                    value={librarySettingsAccessMode}
                    onChange={(event) => handleLibraryAccessModeChange(event.target.value as 'default' | 'restricted')}
                    sx={drawerSelectSx}
                  >
                    <MenuItem value="default" sx={drawerMenuItemSx}>{t('dialogs.editLibrary.values.accessModeDefault')}</MenuItem>
                    <MenuItem value="restricted" sx={drawerMenuItemSx}>{t('dialogs.editLibrary.values.accessModeRestricted')}</MenuItem>
                  </TextField>
                </PropertyRow>

                {librarySettingsAccessMode === 'restricted' && (
                  <>
                    <PropertyRow label={t('dialogs.editLibrary.fields.readers')}>
                      <Autocomplete
                        multiple
                        options={librarySelectableUsers}
                        value={selectedLibraryReaders}
                        onChange={(_event, value) => handleLibraryReadersChange(value)}
                        getOptionLabel={(option) => option.label || option.email || option.id}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        filterSelectedOptions
                        renderOption={renderLibrarySelectableUserOption}
                        noOptionsText={t('common:selects.noUsersFound')}
                        ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            variant="standard"
                            placeholder={t('dialogs.editLibrary.fields.readers')}
                          />
                        )}
                      />
                    </PropertyRow>
                    <PropertyRow label={t('dialogs.editLibrary.fields.writers')}>
                      <Autocomplete
                        multiple
                        options={librarySelectableUsers}
                        value={selectedLibraryWriters}
                        onChange={(_event, value) => handleLibraryWritersChange(value)}
                        getOptionLabel={(option) => option.label || option.email || option.id}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        filterSelectedOptions
                        renderOption={renderLibrarySelectableUserOption}
                        noOptionsText={t('common:selects.noUsersFound')}
                        ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            variant="standard"
                            placeholder={t('dialogs.editLibrary.fields.writers')}
                          />
                        )}
                      />
                    </PropertyRow>
                    {!libraryHasRestrictedMembers && (
                      <Alert severity="info">
                        {t('dialogs.editLibrary.messages.restrictedEmpty')}
                      </Alert>
                    )}
                  </>
                )}
              </Stack>
            </Box>

            {(saveLibraryMutation.isError || deleteLibraryMutation.isError || editingLibraryError) && (
              <Alert severity="error">
                {getApiErrorMessage(
                  saveLibraryMutation.error || deleteLibraryMutation.error || editingLibraryError,
                  t,
                  t('dialogs.editLibrary.messages.failed'),
                )}
              </Alert>
            )}
          </Stack>
        )}
      </KanapDialog>

      <Dialog open={typesManagerOpen} onClose={() => setTypesManagerOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>{t('dialogs.manageTypes.title')}</DialogTitle>
        <DialogContent>
          <KnowledgeTypesManager />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTypesManagerOpen(false)}>{t('common:buttons.close')}</Button>
        </DialogActions>
      </Dialog>

      <KanapDialog
        open={templatePickerOpen}
        title={t('dialogs.selectTemplate.title')}
        onClose={() => setTemplatePickerOpen(false)}
        onSave={createFromTemplate}
        saveLabel={t('dialogs.selectTemplate.actions.useTemplate')}
        saveDisabled={!selectedTemplateId || !activeLibrary}
      >
        <Stack spacing={1.5}>
          <PropertyRow label={t('dialogs.selectTemplate.fields.template')}>
            <TextField
              select
              variant="standard"
              fullWidth
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              sx={drawerSelectSx}
            >
              {groupedTemplates.map((group) => ([
                <ListSubheader key={`${group.typeName}-header`} disableSticky>
                  {group.typeName}
                </ListSubheader>,
                ...group.items.map((row) => (
                  <MenuItem key={row.id} value={row.id} sx={drawerMenuItemSx}>
                    {`DOC-${row.item_number} - ${row.title}`}
                  </MenuItem>
                )),
              ]))}
            </TextField>
          </PropertyRow>
          {!templatesData?.items?.length && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('dialogs.selectTemplate.empty')}
            </Typography>
          )}
        </Stack>
      </KanapDialog>

      <KanapDialog
        open={accessResetConfirmOpen}
        title={t('dialogs.resetLibraryAccess.title')}
        onClose={() => setAccessResetConfirmOpen(false)}
        onSave={confirmResetLibraryAccess}
        saveLabel={t('dialogs.resetLibraryAccess.actions.confirm')}
      >
        <Typography variant="body2" color="text.secondary">
          {t('confirmations.resetLibraryAccess')}
        </Typography>
      </KanapDialog>

      <KanapDialog
        open={deleteLibraryConfirmOpen}
        title={t('dialogs.deleteLibrary.title')}
        onClose={() => setDeleteLibraryConfirmOpen(false)}
        onSave={() => {
          setDeleteLibraryConfirmOpen(false);
          deleteLibraryMutation.mutate();
        }}
        saveLabel={t('dialogs.deleteLibrary.actions.confirm')}
        saveDisabled={!editingLibrary || deleteLibraryMutation.isPending}
        saveLoading={deleteLibraryMutation.isPending}
      >
        <Typography variant="body2" color="text.secondary">
          {t('confirmations.deleteLibrary')}
        </Typography>
      </KanapDialog>

      <KnowledgeMoveDialog
        open={moveDialogOpen}
        selectedRows={moveDialogRows}
        libraries={sortedLibraries}
        activeLibraryId={activeLibrary?.id || null}
        canChangeLibrary={canMoveAcrossLibraries}
        initialTargetLibraryId={moveDialogTargetLibraryId}
        templateLibraryId={templateLibraryId}
        pending={moveDocumentsMutation.isPending}
        onClose={() => {
          if (!moveDocumentsMutation.isPending) {
            setMoveDialogOpen(false);
            resetMoveDialogState();
          }
        }}
        onConfirm={(value) => moveDocumentsMutation.mutate({ ids: moveDialogRows.map((row) => row.id), ...value })}
      />

      <KnowledgeFolderMoveDialog
        open={folderMoveDialogOpen}
        folder={folderMoveTarget}
        libraries={sortedLibraries}
        activeLibraryId={activeLibrary?.id || null}
        canChangeLibrary={canMoveAcrossLibraries}
        initialTargetLibraryId={folderMoveDialogTargetLibraryId}
        templateLibraryId={templateLibraryId}
        pending={moveFolderMutation.isPending}
        onClose={() => {
          if (!moveFolderMutation.isPending) {
            setFolderMoveDialogOpen(false);
            resetFolderMoveDialogState();
          }
        }}
        onConfirm={(value) => {
          if (!folderMoveTarget) return;
          moveFolderMutation.mutate({ id: folderMoveTarget.id, ...value });
        }}
      />

      <Snackbar
        open={moveSnackbar.open}
        autoHideDuration={6000}
        onClose={() => setMoveSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setMoveSnackbar((prev) => ({ ...prev, open: false }))}
          severity={moveSnackbar.severity}
          variant="filled"
        >
          {moveSnackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
