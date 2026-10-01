import React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import api from '../../api';
import { useTaskNav } from '../../hooks/useTaskNav';
import { useClassificationDefaults } from '../../hooks/useClassificationDefaults';
import { useAuth } from '../../auth/AuthContext';
import ExportButton from '../../components/ExportButton';
import ImportButton from '../../components/ImportButton';
import { importDocument as importMarkdownDocument, type ImportDocumentResult } from '../../api/endpoints/import';
import TaskSidebar from './components/TaskSidebar';
import TaskActivity from './components/TaskActivity';
import TaskAttachments, { TaskAttachment } from './components/TaskAttachments';
import TaskDetailHeader from './components/TaskDetailHeader';
import TaskPropertiesDrawer from './components/TaskPropertiesDrawer';
import { taskDetailTokens, type PriorityLevel } from './theme/taskDetailTokens';
import { RelatedObjectType } from '../../components/fields/RelatedObjectSelect';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { useDoneRequiresTime } from './hooks/useDoneRequiresTime';
import { formatItemRef } from '../../utils/item-ref';
import { buildInlineImageUrl, resolveInlineImageTenantSlug } from '../../utils/inlineImageUrls';
import ConvertToRequestDialog from './components/ConvertToRequestDialog';
import {
  TASK_STATUS_COLORS,
  TASK_STATUS_OPTIONS,
} from './task.constants';
import type { TaskStatus } from './task.constants';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';
import {
  getPriorityLabel,
  getTaskStatusLabel,
} from '../../utils/portfolioI18n';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';
import { useTenant } from '../../tenant/TenantContext';
import { StatusDot, useKanapDialogs } from '../../components/design';
import { fieldResetSx } from '../../theme/formSx';
import {
  PROJECT_ORIGIN_TABS,
  buildOriginPath,
  buildTaskBreadcrumbs,
  originMatchesParent,
  parseTaskOrigin,
  remapProjectListContext,
  type RelatedKind,
  type TaskParent,
} from './taskWorkspaceOrigin';
import {
  entityTasksEndpoint,
  entityTasksQueryKey,
  filterEntityTasks,
  navFromTaskList,
  parseEntityTaskListFilters,
} from './entityTaskList';

interface TaskData {
  id: string;
  item_number: number | null;
  title: string | null;
  description: string | null;
  status: TaskStatus;
  task_type_id: string | null;
  task_type_name: string | null;
  priority_level: 'blocker' | 'high' | 'normal' | 'low' | 'optional';
  priority_score: number;
  start_date: string | null;
  due_date: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
  /** Creation author resolved from the audit trail. */
  created_by_name?: string | null;
  owner_ids: string[];
  viewer_ids: string[];
  labels: string[];
  application_ids: string[];
  asset_ids: string[];
  applications?: Array<{ id: string; name?: string | null; sequential_id?: string | null }>;
  assets?: Array<{ id: string; name?: string | null; asset_reference?: string | null; hostname?: string | null }>;
  related_object_type: 'spend_item' | 'contract' | 'capex_item' | 'project' | 'incident' | null;
  related_object_id: string | null;
  related_object_name: string | null;
  phase_id: string | null;
  phase_name: string | null;
  // Classification fields
  source_id: string | null;
  source_name: string | null;
  category_id: string | null;
  category_name: string | null;
  stream_id: string | null;
  stream_name: string | null;
  company_id: string | null;
  company_name: string | null;
  converted_request_id?: string | null;
  converted_request_item_number?: number | null;
  created_at: string;
  updated_at: string;
}

async function fetchRelatedObjectName(kind: RelatedKind, id: string): Promise<string | null> {
  switch (kind) {
    case 'project': {
      const res = await api.get<{ name?: string | null }>(`/portfolio/projects/${id}`);
      return res.data?.name?.trim() || null;
    }
    case 'spend_item': {
      const res = await api.get<{ product_name?: string | null }>(`/spend-items/${id}`);
      return res.data?.product_name?.trim() || null;
    }
    case 'capex_item': {
      const res = await api.get<{ description?: string | null }>(`/capex-items/${id}`);
      return res.data?.description?.trim() || null;
    }
    case 'contract': {
      const res = await api.get<{ name?: string | null }>(`/contracts/${id}`);
      return res.data?.name?.trim() || null;
    }
    case 'incident': {
      const res = await api.get<{ item_number?: number | null; title?: string | null }>(`/incidents/${id}`);
      return formatIncidentName(res.data?.item_number, res.data?.title);
    }
  }
}

// Same shape as the backend's related_object_name for incident tasks ("INC-12 · title").
function formatIncidentName(itemNumber: number | null | undefined, title: string | null | undefined): string | null {
  const name = (title || '').trim();
  if (!itemNumber) return name || null;
  const ref = formatItemRef('incident', itemNumber);
  return name ? `${ref} · ${name}` : ref;
}

function relatedKindFromType(type: TaskData['related_object_type']): RelatedKind | null {
  if (type === 'project' || type === 'spend_item' || type === 'capex_item' || type === 'contract' || type === 'incident') return type;
  return null;
}

function taskMatchesRoute(task: TaskData | null | undefined, routeId: string): boolean {
  if (!task) return false;
  const raw = String(routeId || '').trim();
  if (!raw) return false;
  if (raw.toLowerCase() === task.id.toLowerCase()) return true;
  if (task.item_number != null && raw === String(task.item_number)) return true;
  if (task.item_number != null && raw.toUpperCase() === formatItemRef('task', task.item_number)) return true;
  return false;
}

const MarkdownEditor = React.lazy(() => import('../../components/MarkdownEditor'));

export default function TaskWorkspacePage() {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const cleanedSearchParams = React.useMemo(() => {
    const next = new URLSearchParams(location.search);
    next.delete('action');
    next.delete('status');
    return next;
  }, [location.search]);
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { hasLevel, profile } = useAuth();
  const { tenantSlug } = useTenant();
  const { addToRecent } = useRecentlyViewed();
  const inlineImageTenantSlug = resolveInlineImageTenantSlug(tenantSlug, window.location.hostname);

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const canManage = hasLevel('tasks', 'member');
  const canDelete = hasLevel('tasks', 'admin');
  const canCreateRequest = hasLevel('portfolio_requests', 'member');
  const origin = React.useMemo(() => parseTaskOrigin(cleanedSearchParams), [cleanedSearchParams]);
  const originProjectId = origin.kind === 'project' ? origin.id : null;
  const createSpendItemId = cleanedSearchParams.get('spendItemId');
  const createCapexItemId = cleanedSearchParams.get('capexItemId');
  const createContractId = cleanedSearchParams.get('contractId');
  const createIncidentId = cleanedSearchParams.get('incidentId');
  const createPhaseId = cleanedSearchParams.get('phaseId');
  const originPath = React.useMemo(
    () => buildOriginPath(origin, cleanedSearchParams),
    [origin, cleanedSearchParams],
  );
  const buildProjectWorkspacePath = React.useCallback((projectId: string, tab?: string) => {
    const requestedTab = (tab || '').trim();
    const fallbackTab = origin.kind === 'project' ? (origin.tab || 'tasks') : 'summary';
    const effectiveTab = requestedTab && PROJECT_ORIGIN_TABS.has(requestedTab) ? requestedTab : fallbackTab;
    const qs = remapProjectListContext(cleanedSearchParams).toString();
    return `/portfolio/projects/${projectId}/${effectiveTab}${qs ? `?${qs}` : ''}`;
  }, [cleanedSearchParams, origin]);
  const validTaskStatuses = React.useMemo(
    () => new Set<TaskStatus>(TASK_STATUS_OPTIONS.map((option) => option.value)),
    [],
  );
  const [deepLinkStatus, setDeepLinkStatus] = React.useState<TaskStatus | null>(() => {
    const actionParam = searchParams.get('action');
    const statusParam = searchParams.get('status');
    if (actionParam !== 'set_status' || !statusParam) return null;
    return statusParam as TaskStatus;
  });

  React.useEffect(() => {
    const actionParam = searchParams.get('action');
    const statusParam = searchParams.get('status');
    if (actionParam === 'set_status' && statusParam) {
      setDeepLinkStatus(statusParam as TaskStatus);
      return;
    }
    setDeepLinkStatus(null);
  }, [id]);

  // Create mode state for relation (type can be null for standalone tasks)
  const [createRelation, setCreateRelation] = React.useState<{
    type: RelatedObjectType | null;
    id: string | null;
    name: string | null;
  }>({ type: null, id: null, name: null });
  const [createSaving, setCreateSaving] = React.useState(false);

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [form, setForm] = React.useState<Partial<TaskData>>({});
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [initialized, setInitialized] = React.useState(false);
  const dirtyRef = React.useRef(false);
  const createInitKeyRef = React.useRef<string | null>(null);
  const classificationTouchedRef = React.useRef({
    source_id: false,
    category_id: false,
    stream_id: false,
    company_id: false,
  });
  const sidebarSaveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const pendingSidebarPatchCountRef = React.useRef(0);
  const hydratedTaskIdRef = React.useRef<string | null>(null);
  const currentTaskDraftRef = React.useRef<TaskData | null>(null);
  const [descriptionFocusNonce, setDescriptionFocusNonce] = React.useState(0);
  const [commentFocusNonce, setCommentFocusNonce] = React.useState(0);
  // Description autosave
  const [descSaveStatus, setDescSaveStatus] = React.useState<'idle' | 'saving' | 'saved'>('idle');
  const descAutosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedDescriptionRef = React.useRef('');
  const descSavingRef = React.useRef(false);
  const pendingDescriptionFocusRef = React.useRef(false);
  const autoCommentFocusTaskRef = React.useRef<string | null>(null);
  const [isContentScrolled, setIsContentScrolled] = React.useState(false);
  const priorityLabels = React.useMemo<Record<string, string>>(() => ({
    blocker: getPriorityLabel(t, 'blocker'),
    high: getPriorityLabel(t, 'high'),
    normal: getPriorityLabel(t, 'normal'),
    low: getPriorityLabel(t, 'low'),
    optional: getPriorityLabel(t, 'optional'),
  }), [t]);

  // Sidebar width state with localStorage persistence
  const SIDEBAR_STORAGE_KEY = 'taskSidebarWidth';
  const SIDEBAR_MIN = 240;
  const SIDEBAR_MAX = 400;
  const SIDEBAR_DEFAULT = 300;
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= SIDEBAR_MIN && parsed <= SIDEBAR_MAX) return parsed;
    }
    return SIDEBAR_DEFAULT;
  });
  const [isResizing, setIsResizing] = React.useState(false);
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const { data: classificationDefaults, isLoading: classificationDefaultsLoading } = useClassificationDefaults();

  // Handle sidebar resize
  React.useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return;
      const containerLeft = sidebarRef.current.getBoundingClientRect().left;
      const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX - containerLeft));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth));
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, sidebarWidth]);

  const {
    data: task,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['tasks', id],
    queryFn: async () => {
      const res = await api.get<TaskData>(`/tasks/${id}`);
      return res.data;
    },
    enabled: !!id && !isCreate,
    placeholderData: (previousData) => previousData,
  });
  const taskMatchesCurrentRoute = React.useMemo(() => taskMatchesRoute(task, id), [task, id]);
  const isShowingPreviousTask = Boolean(task && !taskMatchesCurrentRoute);
  const canManageCurrentTask = canManage && !isShowingPreviousTask;
  const canDeleteCurrentTask = canDelete && !isShowingPreviousTask;

  // Track recently viewed
  React.useEffect(() => {
    if (taskMatchesCurrentRoute && task?.id && task?.title) {
      addToRecent('task', task.id, task.title, task.item_number ? `T-${task.item_number}` : undefined);
    }
  }, [taskMatchesCurrentRoute, task?.id, task?.title, task?.item_number, addToRecent]);

  // Browser tab title
  React.useEffect(() => {
    if (taskMatchesCurrentRoute && task?.item_number && task?.title) {
      document.title = t('portfolio:workspace.task.browserTitle', {
        ref: `T-${task.item_number}`,
        title: task.title,
        name: task.title,
      });
    }
    return () => { document.title = 'KANAP'; };
  }, [taskMatchesCurrentRoute, task?.item_number, task?.title, t]);

  // Swap UUID with item ref in URL bar
  React.useEffect(() => {
    if (!task?.item_number || !taskMatchesCurrentRoute) return;
    const currentParam = params.id || '';
    const isUuid = /^[0-9a-f]{8}-/.test(currentParam);
    if (isUuid) {
      const ref = formatItemRef('task', task.item_number);
      const newPath = location.pathname.replace(currentParam, ref);
      window.history.replaceState(null, '', newPath + location.search);
    }
  }, [task?.item_number, taskMatchesCurrentRoute, params.id, location.pathname, location.search]);

  const { data: totalTimeHours = 0 } = useQuery({
    queryKey: ['task-time-entries-sum', task?.id],
    queryFn: async () => {
      try {
        const isProject = task?.related_object_type === 'project';
        const endpoint = isProject
          ? `/portfolio/projects/${task?.related_object_id}/tasks/${task?.id}/time-entries/sum`
          : `/tasks/${task?.id}/time-entries/sum`;
        const res = await api.get<{ total: number }>(endpoint);
        return res.data.total;
      } catch {
        return 0;
      }
    },
    enabled: !!id && !isCreate && !!task && !isShowingPreviousTask,
  });

  // "Done" on a project task requires logged time: intercept and open the Log Time dialog.
  const doneGuard = useDoneRequiresTime();

  const [convertToRequestOpen, setConvertToRequestOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(() => {
    try {
      const stored = localStorage.getItem('kanap.taskDetail.drawerOpen');
      return stored ? JSON.parse(stored) === true : false;
    } catch { return false; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('kanap.taskDetail.drawerOpen', JSON.stringify(drawerOpen)); } catch {}
  }, [drawerOpen]);
  const [descriptionResetNonce, setDescriptionResetNonce] = React.useState(0);
  const resetClassificationTouched = React.useCallback(() => {
    classificationTouchedRef.current = {
      source_id: false,
      category_id: false,
      stream_id: false,
      company_id: false,
    };
  }, []);
  const buildTaskFormFromTask = React.useCallback((source: TaskData): Partial<TaskData> => ({
    status: source.status,
    task_type_id: source.task_type_id,
    task_type_name: source.task_type_name,
    priority_level: source.priority_level,
    start_date: source.start_date,
    due_date: source.due_date,
    assignee_user_id: source.assignee_user_id,
    creator_id: source.creator_id,
    phase_id: source.phase_id,
    labels: source.labels,
    viewer_ids: source.viewer_ids,
    application_ids: source.application_ids || [],
    asset_ids: source.asset_ids || [],
    applications: source.applications || [],
    assets: source.assets || [],
    related_object_type: source.related_object_type,
    related_object_id: source.related_object_id,
    related_object_name: source.related_object_name,
    source_id: source.source_id,
    category_id: source.category_id,
    stream_id: source.stream_id,
    company_id: source.company_id,
  }), []);
  const liveTask = React.useMemo<TaskData | null>(() => (
    task
      ? {
          ...task,
          ...form,
          title,
          description,
        } as TaskData
      : null
  ), [description, form, task, title]);

  // Attachments
  const attachmentTaskId = !isCreate && task ? task.id : null;
  const { data: attachments = [], refetch: refetchAttachments } = useQuery({
    queryKey: ['task-attachments', attachmentTaskId],
    queryFn: async () => {
      const res = await api.get<TaskAttachment[]>(`/tasks/${attachmentTaskId}/attachments`);
      return res.data;
    },
    enabled: !!attachmentTaskId,
  });

  React.useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  React.useEffect(() => {
    currentTaskDraftRef.current = liveTask;
  }, [liveTask]);

  const breadcrumbParent = React.useMemo<TaskParent>(() => {
    const source = liveTask || task;
    const type = relatedKindFromType(source?.related_object_type ?? null);
    const relatedId = source?.related_object_id;
    const relatedName = (source?.related_object_name ?? '').trim();
    if (!type || !relatedId || !relatedName) return null;
    return { type, id: relatedId, name: relatedName };
  }, [liveTask, task]);
  const originMatchesRelated = originMatchesParent(origin, breadcrumbParent);
  const { data: fetchedOriginName = null } = useQuery({
    queryKey: ['task-origin-name', origin.kind, origin.kind === 'tasks' ? '' : origin.id],
    queryFn: () => (origin.kind === 'tasks' ? null : fetchRelatedObjectName(origin.kind, origin.id)),
    enabled: origin.kind !== 'tasks' && !originMatchesRelated,
  });
  const breadcrumbOriginName = originMatchesRelated
    ? breadcrumbParent?.name ?? fetchedOriginName
    : (fetchedOriginName || (isCreate ? createRelation.name : null));
  const breadcrumbLabels = React.useMemo(() => ({
    tasks: t('portfolio:workspace.task.navigation.tasks'),
    typeLabel: (kind: RelatedKind) => t(`portfolio:context.${kind}`),
  }), [t]);
  const taskCrumbs = React.useMemo(() => buildTaskBreadcrumbs({
    origin,
    parent: isCreate ? null : breadcrumbParent,
    originName: breadcrumbOriginName,
    search: cleanedSearchParams,
    labels: breadcrumbLabels,
  }), [breadcrumbLabels, breadcrumbOriginName, breadcrumbParent, cleanedSearchParams, isCreate, origin]);

  React.useEffect(() => {
    if (!location.search.includes('action=') && !location.search.includes('status=')) return;
    const next = new URLSearchParams(location.search);
    next.delete('action');
    next.delete('status');
    const qs = next.toString();
    window.history.replaceState({}, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash || ''}`);
  }, [location.pathname, location.search, location.hash]);

  const initialStatus = React.useMemo<TaskStatus | null>(() => {
    if (!task || isShowingPreviousTask || !deepLinkStatus) return null;
    if (!validTaskStatuses.has(deepLinkStatus)) return null;
    if (deepLinkStatus === task.status) return null;
    return deepLinkStatus;
  }, [task, isShowingPreviousTask, deepLinkStatus, validTaskStatuses]);

  const handleUploadAttachment = async (file: File) => {
    if (!task?.id || !canManageCurrentTask) return;
    const formData = new FormData();
    formData.append('file', file);
    await api.post(`/tasks/${task.id}/attachments`, formData);
    refetchAttachments();
  };

  // Upload image for rich text editor, returns the URL to embed
  const handleUploadImage = async (file: File): Promise<string> => {
    if (!task?.id || !canManageCurrentTask) {
      throw new Error(t('portfolio:workspace.task.messages.saveFailed'));
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('source_field', 'description');
    const res = await api.post<{ id: string }>(`/tasks/${task.id}/attachments`, formData);
    refetchAttachments();
    return buildInlineImageUrl(`/tasks/attachments/${inlineImageTenantSlug}/${res.data.id}/inline`);
  };

  const handleImportImageUrl = async (sourceUrl: string): Promise<string> => {
    if (!task?.id || !canManageCurrentTask) {
      throw new Error(t('portfolio:workspace.task.messages.saveFailed'));
    }
    const res = await api.post<{ id: string }>(`/tasks/${task.id}/attachments/inline/import`, {
      source_field: 'description',
      source_url: sourceUrl,
    });
    refetchAttachments();
    return buildInlineImageUrl(`/tasks/attachments/${inlineImageTenantSlug}/${res.data.id}/inline`);
  };

  const handleDescriptionImport = React.useCallback(async (selectedFile: File): Promise<ImportDocumentResult> => {
    if (isCreate || !task?.id || !canManageCurrentTask) {
      throw new Error(t('portfolio:workspace.task.messages.documentImportAfterCreate'));
    }
    return importMarkdownDocument(`/tasks/${task.id}/import`, selectedFile);
  }, [canManageCurrentTask, isCreate, task?.id, t]);

  const handleDescriptionImported = React.useCallback((result: ImportDocumentResult) => {
    setError(null);
    setDescription(result.markdown);
    savedDescriptionRef.current = result.markdown; // Import endpoint already saved server-side
    setDirty(true);
    setDescriptionResetNonce((prev) => prev + 1);
    window.setTimeout(() => {
      setDescriptionFocusNonce((prev) => prev + 1);
    }, 0);
  }, []);

  const handleDescriptionImportError = React.useCallback((error: unknown) => {
    setError(getApiErrorMessage(error, t, t('portfolio:workspace.task.messages.documentImportFailed')));
  }, [t]);

  const handleDeleteAttachment = async (attachmentId: string) => {
    await api.patch(`/tasks/attachments/${attachmentId}/delete`);
    refetchAttachments();
  };

  // Convert base64 data URL to File object
  const base64ToFile = (dataUrl: string, filename: string): File => {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  // Process description to convert base64 markdown images to S3 attachments
  const convertBase64ImagesToS3 = async (taskId: string, markdown: string): Promise<string> => {
    const base64Regex = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
    const matches = [...markdown.matchAll(base64Regex)];
    if (matches.length === 0) return markdown;

    let updatedMarkdown = markdown;

    for (let i = 0; i < matches.length; i++) {
      const base64Src = matches[i][1];
      try {
        const file = base64ToFile(base64Src, `image-${Date.now()}-${i + 1}.png`);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('source_field', 'description');
        const res = await api.post<{ id: string }>(`/tasks/${taskId}/attachments`, formData);
        const s3Url = buildInlineImageUrl(`/tasks/attachments/${inlineImageTenantSlug}/${res.data.id}/inline`);
        updatedMarkdown = updatedMarkdown.replace(base64Src, s3Url);
      } catch (err) {
        console.error('Failed to upload image to S3:', err);
      }
    }

    return updatedMarkdown;
  };

  // Initialize form from task data
  React.useEffect(() => {
    if (task && taskMatchesCurrentRoute) {
      const taskChanged = hydratedTaskIdRef.current !== task.id;
      if (taskChanged || !dirtyRef.current) {
        setTitle(task.title || '');
        setDescription(task.description || '');
        savedDescriptionRef.current = task.description || '';
      }
      setForm(buildTaskFormFromTask(task));
      if (taskChanged) {
        setDirty(false);
      }
      setInitialized(true);
      resetClassificationTouched();
      hydratedTaskIdRef.current = task.id;
    }
  }, [buildTaskFormFromTask, resetClassificationTouched, task, taskMatchesCurrentRoute]);

  // Fetch task types for default task type
  const { data: taskTypesData } = useQuery({
    queryKey: ['portfolio-task-types'],
    queryFn: async () => {
      const res = await api.get<Array<{ id: string; name: string; is_active: boolean }>>('/portfolio/classification/task-types');
      return res.data;
    },
    enabled: isCreate,
  });

  // Find the default "Task" type ID
  const defaultTaskTypeId = React.useMemo(() => {
    if (!taskTypesData) return null;
    const taskType = taskTypesData.find(t => t.name === 'Task' && t.is_active);
    return taskType?.id || null;
  }, [taskTypesData]);

  const createContextKey = React.useMemo(() => {
    if (!isCreate || !profile?.id) return null;
    return JSON.stringify({
      profileId: profile.id,
      projectId: originProjectId || '',
      spendItemId: createSpendItemId || '',
      capexItemId: createCapexItemId || '',
      contractId: createContractId || '',
      incidentId: createIncidentId || '',
      phaseId: createPhaseId || '',
    });
  }, [
    isCreate,
    profile?.id,
    originProjectId,
    createSpendItemId,
    createCapexItemId,
    createContractId,
    createIncidentId,
    createPhaseId,
  ]);

  // Initialize defaults for create mode (including pre-filled entity from URL params)
  React.useEffect(() => {
    if (!createContextKey || !profile?.id) {
      createInitKeyRef.current = null;
      return;
    }
    if (createInitKeyRef.current === createContextKey) return;
    createInitKeyRef.current = createContextKey;

    let cancelled = false;
    const finishInitialization = () => {
      if (!cancelled) {
        setInitialized(true);
      }
    };
    setInitialized(false);

    // Seed the related-object context synchronously from the URL so the load-bearing
    // { type, id } can't be lost to an async race (the GET below only enriches the name).
    let seedRelation: { type: RelatedObjectType | null; id: string | null; name: string | null } = {
      type: null,
      id: null,
      name: null,
    };
    if (originProjectId) {
      seedRelation = { type: 'project', id: originProjectId, name: t('portfolio:context.project') };
    } else if (createSpendItemId) {
      seedRelation = { type: 'spend_item', id: createSpendItemId, name: t('portfolio:context.spend_item') };
    } else if (createCapexItemId) {
      seedRelation = { type: 'capex_item', id: createCapexItemId, name: t('portfolio:context.capex_item') };
    } else if (createContractId) {
      seedRelation = { type: 'contract', id: createContractId, name: t('portfolio:context.contract') };
    } else if (createIncidentId) {
      seedRelation = { type: 'incident', id: createIncidentId, name: t('portfolio:context.incident') };
    }
    setCreateRelation(seedRelation);
    setCreateSaving(false);
    setDirty(false);
    setError(null);
    setForm({
      status: 'open',
      task_type_id: null,
      priority_level: 'normal',
      assignee_user_id: profile.id,
      creator_id: profile.id,
      start_date: null,
      due_date: null,
      phase_id: createPhaseId || null,
      labels: [],
      viewer_ids: [],
      application_ids: [],
      asset_ids: [],
      applications: [],
      assets: [],
    });
    setTitle('');
    setDescription('');
    resetClassificationTouched();

    // Enrich the seeded relation's display name without ever downgrading its type/id.
    const enrichName = (type: RelatedObjectType, name: string | null | undefined) => {
      if (cancelled || !name) return;
      setCreateRelation((prev) => (prev.type === type ? { ...prev, name } : prev));
    };

    if (originProjectId) {
      api.get<{ id: string; name: string }>(`/portfolio/projects/${originProjectId}`)
        .then((res) => enrichName('project', res.data.name))
        .catch(() => {});
    } else if (createSpendItemId) {
      api.get<{ id: string; product_name: string }>(`/spend-items/${createSpendItemId}`)
        .then((res) => enrichName('spend_item', res.data.product_name))
        .catch(() => {});
    } else if (createCapexItemId) {
      api.get<{ id: string; description: string }>(`/capex-items/${createCapexItemId}`)
        .then((res) => enrichName('capex_item', res.data.description))
        .catch(() => {});
    } else if (createContractId) {
      api.get<{ id: string; name: string }>(`/contracts/${createContractId}`)
        .then((res) => enrichName('contract', res.data.name))
        .catch(() => {});
    } else if (createIncidentId) {
      api.get<{ id: string; item_number: number; title: string }>(`/incidents/${createIncidentId}`)
        .then((res) => enrichName('incident', formatIncidentName(res.data.item_number, res.data.title)))
        .catch(() => {});
    }

    finishInitialization();

    return () => {
      cancelled = true;
    };
  }, [
    createContextKey,
    profile?.id,
    originProjectId,
    createSpendItemId,
    createCapexItemId,
    createContractId,
    createIncidentId,
    createPhaseId,
    resetClassificationTouched,
    t,
  ]);

  React.useEffect(() => {
    if (!isCreate || !initialized || !pendingDescriptionFocusRef.current) return;
    pendingDescriptionFocusRef.current = false;
    setDescriptionFocusNonce((prev) => prev + 1);
  }, [isCreate, initialized]);

  // Auto-focus on comment composer disabled — toolbar loads on user click via hideToolbarUntilFocus

  React.useEffect(() => {
    setIsContentScrolled(false);
  }, [id, isCreate]);

  // Set default task type when task types data loads (separate effect to avoid resetting form)
  React.useEffect(() => {
    if (isCreate && defaultTaskTypeId && !form.task_type_id) {
      setForm(prev => ({ ...prev, task_type_id: defaultTaskTypeId }));
    }
  }, [isCreate, defaultTaskTypeId, form.task_type_id]);

  // Pre-fill classification when a project is selected in create mode
  React.useEffect(() => {
    if (isCreate && createRelation.type === 'project' && createRelation.id) {
      api.get(`/portfolio/projects/${createRelation.id}`)
        .then((res) => {
          setForm(prev => ({
            ...prev,
            source_id: res.data.source_id ?? null,
            category_id: res.data.category_id ?? null,
            stream_id: res.data.stream_id ?? null,
            company_id: res.data.company_id ?? null,
          }));
        })
        .catch(() => {});
    }
  }, [isCreate, createRelation.type, createRelation.id]);

  React.useEffect(() => {
    if (!isCreate || classificationDefaultsLoading) return;
    const canEditClassification = !createRelation.type || createRelation.type === 'project';
    if (!canEditClassification) return;

    setForm((prev) => {
      const next = { ...(prev || {}) } as any;
      const isUnset = (value: any) => value === undefined || value === null || value === '';
      let changed = false;

      const applyField = (
        field: 'source_id' | 'category_id' | 'company_id',
        value: string | null,
      ) => {
        if (!value) return;
        if (classificationTouchedRef.current[field]) return;
        if (!isUnset(next[field])) return;
        next[field] = value;
        changed = true;
      };

      applyField('source_id', classificationDefaults?.source_id ?? null);
      applyField('category_id', classificationDefaults?.category_id ?? null);
      applyField('company_id', classificationDefaults?.company_id ?? null);

      const defaultStreamId = classificationDefaults?.stream_id ?? null;
      if (
        defaultStreamId &&
        !classificationTouchedRef.current.stream_id &&
        isUnset(next.stream_id)
      ) {
        const currentCategory = isUnset(next.category_id) ? null : next.category_id;
        const defaultCategory = classificationDefaults?.category_id ?? null;
        const categoryMismatch = !!currentCategory && !!defaultCategory && currentCategory !== defaultCategory;
        if (!categoryMismatch) {
          next.stream_id = defaultStreamId;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [
    isCreate,
    classificationDefaultsLoading,
    classificationDefaults,
    createRelation.type,
    createRelation.id,
    form.source_id,
    form.category_id,
    form.stream_id,
    form.company_id,
  ]);

  const applyFormPatch = React.useCallback((patch: Record<string, any>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    const nextTouched = { ...classificationTouchedRef.current };
    let touchedChanged = false;
    (['source_id', 'category_id', 'stream_id', 'company_id'] as const).forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) return;
      nextTouched[field] = true;
      touchedChanged = true;
    });
    if (touchedChanged) {
      classificationTouchedRef.current = nextTouched;
    }
  }, []);

  const waitForSidebarSaves = React.useCallback(async () => {
    await sidebarSaveQueueRef.current;
  }, []);

  const invalidateTaskRelationQueries = React.useCallback((
    taskId: string,
    previous: { type: RelatedObjectType; id: string | null },
    next: { type: RelatedObjectType; id: string | null },
  ) => {
    void queryClient.invalidateQueries({ queryKey: ['tasks', taskId] });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['task-activities', taskId] });
    void queryClient.invalidateQueries({ queryKey: ['task-time-entries-sum', taskId] });
    void queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });

    const projectIds = new Set<string>();
    if (previous.type === 'project' && previous.id) projectIds.add(previous.id);
    if (next.type === 'project' && next.id) projectIds.add(next.id);
    for (const projectId of projectIds) {
      void queryClient.invalidateQueries({ queryKey: ['portfolio-project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['portfolio-project-task-time', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['portfolio-project-task-time-entries', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['project-workspace-tasks-count', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['project-tasks', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['project-tasks-time-summary', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    }

    for (const related of [previous, next]) {
      if (related.type && related.id) {
        void queryClient.invalidateQueries({ queryKey: entityTasksQueryKey(related.type, related.id) });
      }
    }
  }, [queryClient]);

  const buildSidebarPatchRequest = React.useCallback((snapshot: TaskData, patch: Record<string, any>) => {
    const requestPayload = { ...patch };
    delete requestPayload.related_object_name;

    const hasRelatedType = Object.prototype.hasOwnProperty.call(requestPayload, 'related_object_type');
    const hasRelatedId = Object.prototype.hasOwnProperty.call(requestPayload, 'related_object_id');
    if (hasRelatedType !== hasRelatedId) {
      throw new Error(t('portfolio:workspace.task.messages.invalidRelationConfiguration'));
    }

    const nextType = hasRelatedType
      ? (requestPayload.related_object_type ?? null) as RelatedObjectType
      : snapshot.related_object_type;
    const nextId = hasRelatedId
      ? (requestPayload.related_object_id ?? null) as string | null
      : snapshot.related_object_id;

    if (nextType === null && nextId !== null) {
      throw new Error(t('portfolio:workspace.task.messages.invalidStandaloneRelation'));
    }
    if (nextType !== null && !nextId) {
      throw new Error(t('portfolio:workspace.task.messages.relatedItemRequired'));
    }

    const isRelationPatch = hasRelatedType || hasRelatedId;
    return {
      endpoint: isRelationPatch
        ? `/tasks/${snapshot.id}/move`
        : nextType === 'project' && nextId
        ? `/portfolio/projects/${nextId}/tasks/${snapshot.id}`
        : `/tasks/${snapshot.id}`,
      payload: requestPayload,
      nextType,
      nextId,
      isRelationPatch,
    };
  }, [t]);

  const enqueueSidebarPatch = React.useCallback((localPatch: Record<string, any>, requestPatch: Record<string, any> = localPatch) => {
    applyFormPatch(localPatch);

    if (isCreate || !task) {
      setDirty(true);
      return;
    }

    const baseSnapshot = currentTaskDraftRef.current ?? liveTask ?? task;
    const snapshot = { ...baseSnapshot, ...localPatch } as TaskData;
    const previousRelatedType = baseSnapshot.related_object_type;
    const previousRelatedId = baseSnapshot.related_object_id;

    setError(null);
    pendingSidebarPatchCountRef.current += 1;
    sidebarSaveQueueRef.current = sidebarSaveQueueRef.current.then(async () => {
      try {
        const { endpoint, payload, nextType, nextId, isRelationPatch } = buildSidebarPatchRequest(snapshot, requestPatch);
        await api.patch(endpoint, payload);
        pendingSidebarPatchCountRef.current = Math.max(0, pendingSidebarPatchCountRef.current - 1);
        if (isRelationPatch) {
          invalidateTaskRelationQueries(
            snapshot.id,
            { type: previousRelatedType, id: previousRelatedId },
            { type: nextType, id: nextId },
          );
        } else if (pendingSidebarPatchCountRef.current === 0) {
          void queryClient.invalidateQueries({ queryKey: ['tasks', snapshot.id] });
          void queryClient.invalidateQueries({ queryKey: ['tasks'] });
          void queryClient.invalidateQueries({ queryKey: ['task-activities', snapshot.id] });
          if (previousRelatedType === 'project' || nextType === 'project') {
            void queryClient.invalidateQueries({ queryKey: ['portfolio-project'] });
            void queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
          }
          if (nextType && nextId) {
            void queryClient.invalidateQueries({ queryKey: entityTasksQueryKey(nextType, nextId) });
          }
        }
      } catch (saveError) {
        pendingSidebarPatchCountRef.current = Math.max(0, pendingSidebarPatchCountRef.current - 1);
        setError(getApiErrorMessage(saveError, t, t('portfolio:workspace.task.messages.saveFailed')));
        await refetch();
      }
    });
  }, [applyFormPatch, buildSidebarPatchRequest, invalidateTaskRelationQueries, isCreate, liveTask, queryClient, refetch, t, task]);

  const handleCreateSidebarPatch = React.useCallback((patch: Record<string, any>) => {
    applyFormPatch(patch);
    setDirty(true);
  }, [applyFormPatch]);

  const handleEditSidebarPatch = React.useCallback((patch: Record<string, any>) => {
    if (!canManageCurrentTask) return;
    const targetTask = currentTaskDraftRef.current ?? liveTask ?? task;
    const isProject = targetTask?.related_object_type === 'project';
    void doneGuard.runWithGuard({
      taskId: targetTask?.id ?? '',
      projectId: isProject ? targetTask?.related_object_id ?? undefined : undefined,
      isProjectTask: isProject,
      nextStatus: patch.status,
      apply: () => enqueueSidebarPatch(patch),
    });
  }, [canManageCurrentTask, enqueueSidebarPatch, doneGuard.runWithGuard, liveTask, task]);

  const handleCreateRelationChange = React.useCallback((params: { type: RelatedObjectType; id: string | null; name: string | null }) => {
    setCreateRelation(params);
    setDirty(true);
  }, []);

  const handleEditRelationChange = React.useCallback((params: { type: RelatedObjectType; id: string | null; name: string | null }) => {
    if (!canManageCurrentTask) return;
    const snapshot = currentTaskDraftRef.current ?? liveTask ?? task;
    const relationChanged = snapshot
      ? snapshot.related_object_type !== params.type || snapshot.related_object_id !== params.id
      : true;
    if (!relationChanged) {
      if (params.name && params.name !== snapshot?.related_object_name) {
        applyFormPatch({ related_object_name: params.name });
      }
      return;
    }
    const localPatch: Record<string, any> = {
      related_object_type: params.type,
      related_object_id: params.id,
      related_object_name: params.name,
      // The relation changed (early return above otherwise): the phase belongs to the old project.
      phase_id: null,
    };

    if (params.type !== null && !params.id) {
      applyFormPatch(localPatch);
      return;
    }

    const requestPatch: Record<string, any> = {
      related_object_type: params.type,
      related_object_id: params.id,
    };
    if (Object.prototype.hasOwnProperty.call(localPatch, 'phase_id')) {
      requestPatch.phase_id = localPatch.phase_id;
    }
    enqueueSidebarPatch(localPatch, requestPatch);
  }, [applyFormPatch, canManageCurrentTask, enqueueSidebarPatch, liveTask, task]);

  // Title blur-to-save: patches only the title field immediately on blur
  const handleTitleSave = React.useCallback(async (newTitle: string) => {
    if (!task || saving || !canManageCurrentTask) return;
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === task.title) return;
    setTitle(trimmed);
    setError(null);
    try {
      await waitForSidebarSaves();
      const isProject = task.related_object_type === 'project';
      const endpoint = isProject && task.related_object_id
        ? `/portfolio/projects/${task.related_object_id}/tasks/${task.id}`
        : `/tasks/${task.id}`;
      await api.patch(endpoint, { title: trimmed });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-activities', task.id] });
    } catch (err) {
      setError(getApiErrorMessage(err, t, t('portfolio:workspace.task.messages.saveFailed')));
    }
  }, [task, saving, canManageCurrentTask, waitForSidebarSaves, queryClient, t]);

  // Description autosave: patches only the description field
  const handleDescriptionAutosave = React.useCallback(async (descToSave: string) => {
    if (!task || isCreate || !canManageCurrentTask || descSavingRef.current) return;
    const trimmed = descToSave.trim() || null;
    const savedTrimmed = savedDescriptionRef.current.trim() || null;
    if (trimmed === savedTrimmed) return;

    descSavingRef.current = true;
    setDescSaveStatus('saving');
    try {
      const isProject = task.related_object_type === 'project';
      const endpoint = isProject && task.related_object_id
        ? `/portfolio/projects/${task.related_object_id}/tasks/${task.id}`
        : `/tasks/${task.id}`;
      await api.patch(endpoint, { description: trimmed });
      savedDescriptionRef.current = descToSave;
      setDescSaveStatus('saved');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-activities', task.id] });
      setTimeout(() => setDescSaveStatus((s) => s === 'saved' ? 'idle' : s), 1500);
    } catch (err) {
      setDescSaveStatus('idle');
      setError(getApiErrorMessage(err, t, t('portfolio:workspace.task.messages.saveFailed')));
    } finally {
      descSavingRef.current = false;
    }
  }, [task, isCreate, canManageCurrentTask, queryClient, t]);

  // Debounced description autosave: fires 2s after last change
  React.useEffect(() => {
    if (isCreate || !initialized || !task || !canManageCurrentTask) return;
    const trimmed = description.trim() || null;
    const savedTrimmed = savedDescriptionRef.current.trim() || null;
    if (trimmed === savedTrimmed) return;

    const timer = setTimeout(() => {
      void handleDescriptionAutosave(description);
    }, 2000);
    descAutosaveTimerRef.current = timer;

    return () => clearTimeout(timer);
  }, [description, isCreate, initialized, task, canManageCurrentTask, handleDescriptionAutosave]);

  const handleSave = async () => {
    if (!task || saving || !canManageCurrentTask) return;
    setSaving(true);
    setError(null);

    try {
      await waitForSidebarSaves();
      const currentType = task.related_object_type;
      const currentId = task.related_object_id;
      const nextType = (form.related_object_type !== undefined ? form.related_object_type : currentType) as RelatedObjectType;
      const nextId = (form.related_object_id !== undefined ? form.related_object_id : currentId) as string | null;
      const relationChanged = nextType !== currentType || nextId !== currentId;

      if (nextType === null && nextId !== null) {
        throw new Error(t('portfolio:workspace.task.messages.invalidStandaloneRelation'));
      }
      if (nextType !== null && !nextId) {
        throw new Error(t('portfolio:workspace.task.messages.relatedItemRequired'));
      }

      const endpoint = nextType === 'project' && nextId
        ? `/portfolio/projects/${nextId}/tasks/${task.id}`
        : `/tasks/${task.id}`;

      const payload: Record<string, any> = {
        title: title.trim(),
        description: description.trim() || null,
      };

      const editableFields = [
        'status',
        'task_type_id',
        'priority_level',
        'start_date',
        'due_date',
        'assignee_user_id',
        'creator_id',
        'phase_id',
        'labels',
        'viewer_ids',
      ] as const;
      for (const field of editableFields) {
        if ((form as any)[field] !== undefined) {
          payload[field] = (form as any)[field];
        }
      }

      const canEditClassification = nextType === null || nextType === 'project';
      if (canEditClassification) {
        const classificationFields = ['source_id', 'category_id', 'stream_id', 'company_id'] as const;
        for (const field of classificationFields) {
          if ((form as any)[field] === undefined) continue;
          if (relationChanged && nextType === 'project' && !classificationTouchedRef.current[field]) continue;
          payload[field] = (form as any)[field];
        }
      }

      if (relationChanged) {
        await api.patch(`/tasks/${task.id}/move`, {
          related_object_type: nextType,
          related_object_id: nextId,
        });
      }

      await api.patch(endpoint, payload);
      savedDescriptionRef.current = description;
      setDirty(false);
      resetClassificationTouched();
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-activities', task.id] });
      if (relationChanged) {
        invalidateTaskRelationQueries(
          task.id,
          { type: currentType, id: currentId },
          { type: nextType, id: nextId },
        );
      }
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('portfolio:workspace.task.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task || !(await dialogs.confirm({
      message: t('portfolio:workspace.task.confirmations.deleteTask'),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    }))) return;
    try {
      await waitForSidebarSaves();
      await api.delete('/tasks/bulk', { data: { ids: [task.id] } });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigate(originPath);
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('portfolio:workspace.task.messages.deleteFailed')));
    }
  };

  const handleBack = async () => {
    await waitForSidebarSaves();
    navigate(originPath);
  };

  // Navigation for prev/next
  const sort = cleanedSearchParams.get('sort') || 'created_at:DESC';
  const q = cleanedSearchParams.get('q') || '';
  const filters = cleanedSearchParams.get('filters') || '';
  // Read scope params for filtered navigation
  const involvedUserId = cleanedSearchParams.get('involvedUserId') || undefined;
  const teamId = cleanedSearchParams.get('teamId') || undefined;
  const applicationId = cleanedSearchParams.get('applicationId') || undefined;
  const assetId = cleanedSearchParams.get('assetId') || undefined;
  const navExtraParams = React.useMemo(() => {
    const params: Record<string, string | undefined> = {};
    if (involvedUserId) params.involvedUserId = involvedUserId;
    if (teamId) params.teamId = teamId;
    if (applicationId) params.applicationId = applicationId;
    if (assetId) params.assetId = assetId;
    return Object.keys(params).length > 0 ? params : undefined;
  }, [involvedUserId, applicationId, assetId, teamId]);
  const navCurrentId = taskMatchesCurrentRoute ? task?.id || '' : '';
  const entityOrigin = origin.kind === 'tasks' ? null : origin;
  const entityListQuery = useQuery({
    queryKey: entityOrigin ? entityTasksQueryKey(entityOrigin.kind, entityOrigin.id) : ['entity-tasks', 'idle'],
    queryFn: async () => {
      if (!entityOrigin) return [] as Array<{ id: string; item_number?: number | null; status: string; phase_id?: string | null }>;
      const res = await api.get<Array<{ id: string; item_number?: number | null; status: string; phase_id?: string | null }>>(
        entityTasksEndpoint(entityOrigin.kind, entityOrigin.id),
      );
      return res.data || [];
    },
    enabled: Boolean(entityOrigin) && !isCreate,
  });
  const entityListFilters = React.useMemo(
    () => parseEntityTaskListFilters(cleanedSearchParams),
    [cleanedSearchParams],
  );
  const entityNav = React.useMemo(() => navFromTaskList(
    navCurrentId,
    filterEntityTasks(entityListQuery.data || [], {
      status: entityListFilters.status,
      phase: origin.kind === 'project' ? entityListFilters.phase : 'all',
    }),
    { isLoading: Boolean(entityOrigin) && entityListQuery.isLoading },
  ), [entityListFilters.phase, entityListFilters.status, entityListQuery.data, entityListQuery.isLoading, entityOrigin, navCurrentId, origin.kind]);
  const globalNav = useTaskNav({
    id: navCurrentId,
    sort,
    q,
    filters,
    extraParams: navExtraParams,
    enabled: origin.kind === 'tasks' && !isCreate,
  });
  const nav = origin.kind === 'tasks' ? globalNav : entityNav;
  const { total, index, hasPrev, hasNext, prevId, nextId } = isCreate
    ? { total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null as any, nextId: null as any }
    : nav;

  const confirmAndNavigate = React.useCallback(async (targetId: string | null) => {
    if (!targetId) return;
    // Flush pending description autosave (handleSave includes description in payload)
    if (descAutosaveTimerRef.current) {
      clearTimeout(descAutosaveTimerRef.current);
      descAutosaveTimerRef.current = null;
    }
    await waitForSidebarSaves();
    if (dirty) {
      const proceed = await dialogs.confirm(t('portfolio:workspace.task.confirmations.unsavedNavigate'));
      if (proceed) {
        setSaving(true);
        try { await handleSave(); } catch { setSaving(false); return; }
        setSaving(false);
      } else {
        // Reset form to task data
        if (task) {
          setTitle(task.title || '');
          setDescription(task.description || '');
          setForm(buildTaskFormFromTask(task));
        }
        resetClassificationTouched();
        setDirty(false);
      }
    }
    const qs = cleanedSearchParams.toString();
    navigate(`/portfolio/tasks/${targetId}${qs ? `?${qs}` : ''}`);
  }, [buildTaskFormFromTask, cleanedSearchParams, dialogs, dirty, handleSave, navigate, resetClassificationTouched, task, t, waitForSidebarSaves]);

  const formatDate = (dateStr: string) => formatShortDateTime(dateStr, locale);

  const handleCreateSave = async () => {
    if (createSaving) return;

    // Validation
    if (!title.trim()) {
      setError(t('portfolio:workspace.task.messages.titleRequired'));
      return;
    }
    // Related item is optional - standalone tasks are allowed
    const isStandaloneCreate = !createRelation.type;

    setCreateSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        title: title.trim(),
        description: description.trim() || null,
        status: form.status || 'open',
        priority_level: form.priority_level || 'normal',
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        assignee_user_id: form.assignee_user_id || null,
        creator_id: form.creator_id || null,
        phase_id: form.phase_id || null,
        viewer_ids: form.viewer_ids || [],
        task_type_id: (form as any).task_type_id || null,
        application_ids: Array.isArray((form as any).application_ids) ? (form as any).application_ids : [],
        asset_ids: Array.isArray((form as any).asset_ids) ? (form as any).asset_ids : [],
        // Classification fields (for standalone and project tasks)
        // Only include fields the user has touched (incl. explicit null); omitted fields let backend default from project
        ...((isStandaloneCreate || createRelation.type === 'project') && (form as any).source_id !== undefined ? { source_id: (form as any).source_id } : {}),
        ...((isStandaloneCreate || createRelation.type === 'project') && (form as any).category_id !== undefined ? { category_id: (form as any).category_id } : {}),
        ...((isStandaloneCreate || createRelation.type === 'project') && (form as any).stream_id !== undefined ? { stream_id: (form as any).stream_id } : {}),
        ...((isStandaloneCreate || createRelation.type === 'project') && (form as any).company_id !== undefined ? { company_id: (form as any).company_id } : {}),
      };

      // Determine endpoint based on relation type
      let endpoint: string;
      if (isStandaloneCreate) {
        // Create standalone task
        endpoint = '/tasks/standalone';
      } else if (createRelation.type && createRelation.id) {
        switch (createRelation.type) {
          case 'project':
            endpoint = `/portfolio/projects/${createRelation.id}/tasks`;
            break;
          case 'spend_item':
            endpoint = `/spend-items/${createRelation.id}/tasks`;
            break;
          case 'contract':
            endpoint = `/contracts/${createRelation.id}/tasks`;
            break;
          case 'capex_item':
            endpoint = `/capex-items/${createRelation.id}/tasks`;
            break;
          case 'incident':
            endpoint = `/incidents/${createRelation.id}/tasks`;
            break;
          default:
            throw new Error(t('portfolio:workspace.task.messages.invalidRelationType'));
        }
      } else {
        throw new Error(t('portfolio:workspace.task.messages.invalidRelationConfiguration'));
      }

      const res = await api.post<{ id: string }>(endpoint, payload);
      const newId = res.data?.id;
      if (newId) {
        // Convert any base64 images in description to S3 attachments
        if (description && description.includes('data:image/')) {
          try {
            const updatedDescription = await convertBase64ImagesToS3(newId, description);
            if (updatedDescription !== description) {
              // Update task with S3 URLs
              const isProject = createRelation.type === 'project';
              const updateEndpoint = isProject
                ? `/portfolio/projects/${createRelation.id}/tasks/${newId}`
                : `/tasks/${newId}`;
              await api.patch(updateEndpoint, { description: updatedDescription });
            }
          } catch (err) {
            console.error('Failed to convert base64 images:', err);
            // Continue anyway - base64 images will still work
          }
        }

        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        if (origin.kind === 'project') {
          queryClient.invalidateQueries({ queryKey: ['project-tasks', origin.id] });
          navigate(originPath, { replace: true });
          return;
        }
        const qs = cleanedSearchParams.toString();
        navigate(`/portfolio/tasks/${newId}/overview${qs ? `?${qs}` : ''}`, { replace: true });
      }
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('portfolio:workspace.task.messages.createFailed')));
    } finally {
      setCreateSaving(false);
    }
  };

  // Check if create form is valid for enabling save button
  // Title is required. Relation is optional (standalone tasks are allowed).
  const isCreateValid = Boolean(title.trim());
  const taskImportDisabled = isCreate || !canManageCurrentTask;
  const taskImportDisabledTitle = isCreate
    ? t('portfolio:workspace.task.messages.importSaveFirst')
    : (!canManageCurrentTask ? t('portfolio:workspace.task.messages.importPermissionRequired') : undefined);
  const contentSpacing = {
    section: 3,
    sectionLarge: 4,
  } as const;
  const headerShadow = isContentScrolled
    ? `0 4px 12px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.35 : 0.08)}`
    : 'none';
  const isTitleMissing = !title.trim();
  const titleBarSx = {
    px: 1.5,
    py: 0.75,
    borderRadius: 1.5,
    border: 1,
    borderColor: isTitleMissing
      ? alpha(theme.palette.info.main, 0.25)
      : 'divider',
    bgcolor: isTitleMissing
      ? alpha(theme.palette.info.main, 0.08)
      : 'background.paper',
    transition: 'border-color 120ms ease, background-color 120ms ease',
  } as const;
  const handleMainContentScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const nextScrolled = event.currentTarget.scrollTop > 4;
    setIsContentScrolled((prev) => (prev === nextScrolled ? prev : nextScrolled));
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();

      if (isCreate) {
        if (!canManage) return;
        if (!isCreateValid || createSaving) return;
        void handleCreateSave();
        return;
      }

      if (!canManageCurrentTask) return;

      // Cancel pending description debounce — handleSave includes description
      if (descAutosaveTimerRef.current) {
        clearTimeout(descAutosaveTimerRef.current);
        descAutosaveTimerRef.current = null;
      }

      if (!dirty || saving) return;
      void handleSave();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canManage, canManageCurrentTask, isCreate, isCreateValid, createSaving, dirty, saving, handleCreateSave, handleSave]);

  // Keyboard shortcuts: J/K/←/→ for navigation, Escape to close
  React.useEffect(() => {
    if (isCreate) return;
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      // Skip if modifier keys are held
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case 'j':
        case 'ArrowLeft':
          if (hasPrev) { e.preventDefault(); void confirmAndNavigate(prevId); }
          break;
        case 'k':
        case 'ArrowRight':
          if (hasNext) { e.preventDefault(); void confirmAndNavigate(nextId); }
          break;
        case 'Escape':
          e.preventDefault();
          void handleBack();
          break;
        case 'p':
          e.preventDefault();
          setDrawerOpen((o: boolean) => !o);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isCreate, hasPrev, hasNext, prevId, nextId, confirmAndNavigate, handleBack]);

  // Create mode UI - full workspace layout
  if (isCreate) {
    const isProjectCreate = createRelation.type === 'project';

    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Box
          sx={{
            p: 2,
            borderBottom: 1,
            borderColor: 'divider',
            boxShadow: headerShadow,
            transition: 'box-shadow 140ms ease',
            zIndex: 2,
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" alignItems="center" spacing={1}>
              <IconButton onClick={handleBack} size="small">
                <ArrowBackIcon />
              </IconButton>
              <Typography variant="body2" color="text.secondary">
                {taskCrumbs[0]?.label || t('portfolio:workspace.task.navigation.tasks')}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button onClick={handleBack} size="small">
                {t('common:buttons.cancel')}
              </Button>
              <Button
                variant="contained"
                onClick={handleCreateSave}
                disabled={!isCreateValid || createSaving || !canManage}
                size="small"
              >
                {createSaving ? t('portfolio:workspace.task.messages.creating') : t('common:buttons.create')}
              </Button>
            </Stack>
          </Stack>

          {/* Title input */}
          <Stack spacing={0.5} sx={{ mt: 2 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 500,
                color: 'text.primary',
              }}
            >
              {t('portfolio:workspace.task.title.label')}
            </Typography>
            <Box sx={titleBarSx}>
              <TextField
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Tab' && !event.shiftKey) {
                    event.preventDefault();
                    if (initialized) {
                      setDescriptionFocusNonce((prev) => prev + 1);
                    } else {
                      pendingDescriptionFocusRef.current = true;
                    }
                  }
                }}
                variant="standard"
                fullWidth
                placeholder={t('portfolio:workspace.task.title.placeholder')}
                sx={fieldResetSx}
                InputProps={{
                  sx: { fontSize: '1.5rem', fontWeight: 500 },
                }}
              />
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box component="span" sx={(theme) => {
                const color = getDotColor(TASK_STATUS_COLORS[(form.status as TaskStatus) || 'open'] || 'default', theme.palette.mode);
                return { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 500, color };
              }}>
                <StatusDot color={getDotColor(TASK_STATUS_COLORS[(form.status as TaskStatus) || 'open'] || 'default', theme.palette.mode)} />
                {getTaskStatusLabel(t, (form.status as TaskStatus) || 'open')}
              </Box>
              <Typography variant="body2" color="text.secondary">
                {priorityLabels[form.priority_level as string] || getPriorityLabel(t, 'normal')}
              </Typography>
            </Stack>
          </Stack>
        </Box>

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mx: 2, mt: 1 }}>
            {error}
          </Alert>
        )}

        {/* Main Content. Below md the sidebar stacks above the editor: natural height, and the
            app scroller scrolls the page (a bounded box would clip the sidebar and the editor). */}
        <Box
          sx={{
            flex: isMobile ? '1 0 auto' : 1,
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            overflow: isMobile ? 'visible' : 'hidden',
          }}
        >
          {/* Sidebar */}
          <Box
            ref={sidebarRef}
            sx={{
              width: isMobile ? '100%' : sidebarWidth,
              flexShrink: 0,
              borderRight: isMobile ? 0 : 1,
              borderBottom: isMobile ? 1 : 0,
              borderColor: 'divider',
              overflow: 'auto',
              p: 2,
              position: 'relative',
            }}
          >
            {/* Resize handle */}
            {!isMobile && (
              <Box
                onMouseDown={() => setIsResizing(true)}
                sx={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: 4,
                  height: '100%',
                  cursor: 'col-resize',
                  '&:hover': { bgcolor: 'primary.main', opacity: 0.3 },
                  ...(isResizing && { bgcolor: 'primary.main', opacity: 0.5 }),
                }}
              />
            )}
            <TaskSidebar
              task={{
                id: '',
                status: (form.status as string) || 'open',
                task_type_id: (form as any).task_type_id || null,
                task_type_name: null,
                priority_level: (form.priority_level as string) || 'normal',
                start_date: form.start_date ?? null,
                due_date: form.due_date ?? null,
                assignee_user_id: form.assignee_user_id ?? null,
                assignee_name: null,
                creator_id: form.creator_id ?? null,
                creator_name: null,
                owner_ids: [],
                viewer_ids: form.viewer_ids || [],
                labels: form.labels || [],
                related_object_type: createRelation.type as string | null,
                related_object_id: createRelation.id || null,
                related_object_name: createRelation.name || null,
                phase_id: form.phase_id ?? null,
                phase_name: null,
                source_id: (form as any).source_id ?? null,
                source_name: null,
                category_id: (form as any).category_id ?? null,
                category_name: null,
                stream_id: (form as any).stream_id ?? null,
                stream_name: null,
                company_id: (form as any).company_id ?? null,
                company_name: null,
              }}
              onPatch={handleCreateSidebarPatch}
              readOnly={false}
              totalTimeHours={0}
              isCreate={true}
              onRelationChange={handleCreateRelationChange}
            />
          </Box>

          {/* Main content area */}
          <Box
            data-primary-scroll={isMobile ? undefined : ''}
            tabIndex={isMobile ? undefined : -1}
            sx={{ flex: isMobile ? 'none' : 1, overflow: isMobile ? 'visible' : 'auto', outline: 'none', p: 3 }}
            onScroll={handleMainContentScroll}
          >
            {/* Description */}
            <Box sx={{ mb: contentSpacing.sectionLarge }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" fontWeight={500}>
                  {t('portfolio:labels.description')}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <ImportButton
                    onImportFile={handleDescriptionImport}
                    onImported={handleDescriptionImported}
                    onError={handleDescriptionImportError}
                    hasContent={!!description.trim()}
                    disabled={taskImportDisabled}
                    disabledTitle={taskImportDisabledTitle}
                    size="small"
                  />
                  <ExportButton
                    content={description}
                    title={title || 'task-description'}
                    disabled={!description.trim()}
                  />
                </Stack>
              </Stack>
              {initialized ? (
                <React.Suspense fallback={<Box sx={{ minHeight: 10 * 24, border: 1, borderColor: 'divider', borderRadius: 1 }} />}>
                  <MarkdownEditor
                    key={`task-description:${id || 'create'}:${descriptionResetNonce}`}
                    value={description}
                    onChange={(val) => setDescription(val)}
                    placeholder={t('portfolio:workspace.task.description.placeholder')}
                    minRows={10}
                    maxRows={26}
                    focusNonce={descriptionFocusNonce}
                    refreshNonce={descriptionResetNonce}
                    hideToolbarUntilFocus
                    surface
                    delegateWheelUntilFocus
                  />
                </React.Suspense>
              ) : (
                <Box sx={{ minHeight: 10 * 24, border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                  <Typography color="text.secondary">{t('common:status.loading')}</Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  if (isLoading && !task) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">{t('portfolio:workspace.task.messages.loading')}</Typography>
      </Box>
    );
  }

  if (!task) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('portfolio:workspace.task.messages.notFound')}</Alert>
        <Button onClick={handleBack} sx={{ mt: 2 }}>{taskCrumbs[0]?.label || t('portfolio:workspace.task.navigation.tasks')}</Button>
      </Box>
    );
  }

  const effectiveTask = liveTask || task;
  const isProjectTask = effectiveTask.related_object_type === 'project';
  const hasConvertedRequest = Boolean(task.converted_request_id);
  const canConvertToRequest = canManageCurrentTask && canCreateRequest;
  const headerRelatedType = effectiveTask.related_object_type;
  const headerRelatedId = effectiveTask.related_object_id;
  const sidebarProjectWorkspaceLink = (
    headerRelatedType === 'project' && headerRelatedId
      ? buildProjectWorkspacePath(headerRelatedId, 'overview')
      : null
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TaskDetailHeader
        taskId={task.id}
        itemNumber={task.item_number}
        title={title}
        status={effectiveTask.status}
        priorityLevel={effectiveTask.priority_level as PriorityLevel}
        priorityScore={task.priority_score}
        assigneeUserId={effectiveTask.assignee_user_id}
        assigneeName={effectiveTask.assignee_name}
        dueDate={effectiveTask.due_date}
        isProjectTask={isProjectTask}
        hasConvertedRequest={hasConvertedRequest}
        projectId={isProjectTask ? effectiveTask.related_object_id : null}
        projectName={isProjectTask ? (effectiveTask.related_object_name ?? null) : null}
        onNavigateToProject={(pid) => navigate(buildProjectWorkspacePath(pid, 'activity'))}
        currentIndex={index}
        totalCount={total}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={() => confirmAndNavigate(prevId)}
        onNext={() => confirmAndNavigate(nextId)}
        onClose={handleBack}
        onConvertToRequest={() => setConvertToRequestOpen(true)}
        onDelete={handleDelete}
        onTitleChange={(v) => { setTitle(v); setDirty(true); }}
        onTitleSave={handleTitleSave}
        onMetadataPatch={handleEditSidebarPatch}
        canManage={canManageCurrentTask}
        canDelete={canDeleteCurrentTask}
        canConvertToRequest={canConvertToRequest}
        convertDisabledTitle={
          hasConvertedRequest
            ? (task.converted_request_item_number
              ? t('portfolio:workspace.task.actions.alreadyConvertedWithReference', { ref: `REQ-${task.converted_request_item_number}` })
              : t('portfolio:workspace.task.actions.alreadyConverted'))
            : (!canCreateRequest ? t('portfolio:workspace.task.actions.convertRequiresPermission') : undefined)
        }
        crumbs={taskCrumbs}
        onOriginClick={handleBack}
        onParentClick={(href) => { void waitForSidebarSaves().then(() => navigate(href)); }}
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mx: 2, mt: 1 }}>
          {error}
        </Alert>
      )}

      {/* Work Area: Content + Tab-anchor + Drawer. Below md the drawer stacks under the content:
          natural height, the app scroller scrolls the page (as PortfolioDetailWorkspaceShell). */}
      <Box
        sx={{
          flex: isMobile ? '1 0 auto' : 1,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          overflow: 'visible',
          position: 'relative',
          minHeight: 380,
        }}
      >
        {/* Content column — 26px right gutter for the tab to sit in */}
        <Box
          data-primary-scroll={isMobile ? undefined : ''}
          tabIndex={isMobile ? undefined : -1}
          sx={{ flex: isMobile ? 'none' : 1, minWidth: 0, overflow: isMobile ? 'visible' : 'auto', outline: 'none', pt: '8px', pl: 3, pr: isMobile ? 3 : '29px', pb: 3 }}
          onScroll={handleMainContentScroll}
        >
          {/* Description */}
          <Box sx={{ mb: contentSpacing.sectionLarge }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={500}>
                {t('portfolio:labels.description')}
              </Typography>
              {descSaveStatus === 'saved' && (
                <Typography
                  sx={{
                    fontSize: 12,
                    color: 'kanap.text.secondary',
                    fontWeight: 400,
                  }}
                >
                  {'✓ '}{t('common:status.saved')}
                </Typography>
              )}
            </Stack>
            {initialized ? (
              <React.Suspense fallback={<Box sx={{ minHeight: 10 * 24, border: 1, borderColor: 'divider', borderRadius: 1 }} />}>
                <MarkdownEditor
                  key={`task-description:${id || 'create'}:${descriptionResetNonce}`}
                  value={description}
                  onChange={(val) => { setDescription(val); setDirty(true); }}
                  placeholder={t('portfolio:workspace.task.description.placeholder')}
                  minRows={10}
                  maxRows={26}
                  collapsedRows={16}
                  disabled={!canManageCurrentTask}
                  onImageUpload={handleUploadImage}
                  onImageUrlImport={handleImportImageUrl}
                  focusNonce={descriptionFocusNonce}
                  refreshNonce={descriptionResetNonce}
                  hideToolbarUntilFocus
                  surface
                  delegateWheelUntilFocus
                />
              </React.Suspense>
            ) : (
              <Box sx={{ minHeight: 10 * 24, border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                <Typography color="text.secondary">{t('common:status.loading')}</Typography>
              </Box>
            )}
          </Box>

          {/* Attachments */}
          {(canManageCurrentTask || attachments.length > 0) && (
            <Box sx={{ mb: contentSpacing.section }}>
              <TaskAttachments
                taskId={task.id}
                attachments={attachments}
                onUpload={handleUploadAttachment}
                onDelete={handleDeleteAttachment}
                canManage={canManageCurrentTask}
              />
            </Box>
          )}

          <Divider sx={{ my: contentSpacing.section }} />

          {/* Activity Section */}
          <TaskActivity
            taskId={task.id}
            projectId={isProjectTask && effectiveTask.related_object_id ? effectiveTask.related_object_id : undefined}
            createdAt={task.created_at ?? null}
            createdByName={task.created_by_name ?? null}
            readOnly={!canManageCurrentTask}
            relatedObjectType={effectiveTask.related_object_type ?? undefined}
            currentStatus={effectiveTask.status}
            totalTimeHours={totalTimeHours}
            initialStatus={initialStatus}
            commentFocusNonce={commentFocusNonce}
          />
        </Box>

        {/* Tab-anchor: zero-width column with absolutely-positioned classeur tab */}
        {!isMobile && (
          <Box sx={{ width: 0, position: 'relative', alignSelf: 'stretch' }}>
            <Box
              component="button"
              onClick={() => setDrawerOpen((o: boolean) => !o)}
              aria-label={drawerOpen ? 'Close properties' : 'Open properties'}
              aria-expanded={drawerOpen}
              sx={(theme) => ({
                position: 'absolute',
                top: taskDetailTokens.drawer.tabTop,
                right: 0,
                width: 26,
                height: 120,
                bgcolor: drawerOpen ? theme.palette.kanap.tab.bgActive : theme.palette.kanap.tab.bg,
                border: `1px solid ${drawerOpen ? theme.palette.kanap.tab.borderActive : theme.palette.kanap.tab.border}`,
                borderRight: 'none',
                borderRadius: '8px 0 0 8px',
                cursor: 'pointer',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 0,
                transition: 'background-color 0.15s, border-color 0.15s',
                '&:hover': {
                  bgcolor: drawerOpen ? theme.palette.kanap.tab.bgActive : theme.palette.kanap.tab.bgHover,
                },
              })}
            >
              <Box
                component="span"
                sx={(theme) => ({
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '0.03em',
                  color: drawerOpen ? theme.palette.kanap.tab.fgActive : theme.palette.kanap.tab.fg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  pointerEvents: 'none',
                })}
              >
                <Box component="span" sx={{ fontSize: '14px', lineHeight: 1 }}>
                  {drawerOpen ? '›' : '‹'}
                </Box>
                <span>Properties</span>
              </Box>
            </Box>
          </Box>
        )}

        {/* Properties drawer (conditionally rendered) */}
        {drawerOpen && (
          <TaskPropertiesDrawer
            task={effectiveTask}
            open={drawerOpen}
            onToggle={() => setDrawerOpen((o: boolean) => !o)}
            onPatch={handleEditSidebarPatch}
            readOnly={!canManageCurrentTask}
            totalTimeHours={totalTimeHours}
            onRelationChange={handleEditRelationChange}
            projectWorkspaceLink={sidebarProjectWorkspaceLink}
          />
        )}
      </Box>

      <ConvertToRequestDialog
        open={convertToRequestOpen}
        onClose={() => setConvertToRequestOpen(false)}
        task={{
          id: task.id,
          item_number: task.item_number,
          title: task.title,
          description: task.description,
        }}
        onSuccess={(requestId) => {
          setConvertToRequestOpen(false);
          queryClient.invalidateQueries({ queryKey: ['tasks', task.id] });
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
          if (requestId) {
            navigate(`/portfolio/requests/${requestId}/summary`);
            return;
          }
          void refetch();
        }}
      />
      {doneGuard.dialog}
    </Box>
  );
}
