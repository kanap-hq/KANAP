import React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Divider,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import api from '../../api';
import { useTaskNav } from '../../hooks/useTaskNav';
import { useLeaveGuard } from '../../hooks/leaveGuard';
import { useClassificationDefaults } from '../../hooks/useClassificationDefaults';
import { useLocalizedTaskTypes } from '../../hooks/useLocalizedTaskTypes';
import { useAuth } from '../../auth/AuthContext';
import TaskActivity from './components/TaskActivity';
import TaskAttachments, { TaskAttachment } from './components/TaskAttachments';
import TaskDetailHeader from './components/TaskDetailHeader';
import TaskPropertiesDrawer from './components/TaskPropertiesDrawer';
import { taskDetailTokens, type PriorityLevel } from './theme/taskDetailTokens';
import { RelatedObjectType } from '../../components/fields/RelatedObjectSelect';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { useDoneRequiresTime } from './hooks/useDoneRequiresTime';
import { budgetLineLabel, type BudgetLineLabel } from '../../components/finance/budgetLineLabel';
import { budgetLineDetailQuery } from '../../hooks/budgetItemDetailQuery';
import { formatItemRef } from '../../utils/item-ref';
import { buildInlineImageUrl, resolveInlineImageTenantSlug } from '../../utils/inlineImageUrls';
import ConvertToRequestDialog from './components/ConvertToRequestDialog';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import { CreationActions, CreationPreview, useCreationReturn, useRecordCreation, useTitleCreation } from '../../components/workspace/creation';
import { followCreationFields, useCreationFieldFocus } from '../../components/workspace/creation/creationFieldFocus';
import { TASK_STATUS_OPTIONS } from './task.constants';
import type { TaskStatus } from './task.constants';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useTenant } from '../../tenant/TenantContext';
import { useRecordTitle } from '../../tenant/workspaceTitle';
import { unsavedConfirm, useKanapDialogs } from '../../components/design';
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
  /** The shipped type it started as, null for a tenant's own type. */
  task_type_code?: string | null;
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
  /** Null, with `applications`, for a person who does not read applications: the field is not shown. */
  application_ids: string[] | null;
  /** Null, with `assets`, for a person who does not read the infrastructure. */
  asset_ids: string[] | null;
  applications?: Array<{ id: string; name?: string | null; sequential_id?: string | null }> | null;
  assets?: Array<{ id: string; name?: string | null; asset_reference?: string | null; hostname?: string | null }> | null;
  related_object_type: 'spend_item' | 'contract' | 'capex_item' | 'project' | 'incident' | null;
  related_object_id: string | null;
  related_object_name: string | null;
  /** The task names a budget line the person cannot read: `related_object_name` is its reference alone, without a link. */
  related_object_hidden?: boolean;
  /** A contract outside the access: it has no reference, the screen shows "Contract outside your access". */
  related_object_hidden_kind?: 'contract' | null;
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
    case 'spend_item':
    case 'capex_item': {
      const res = await api.get<BudgetLineLabel>(`/budget-lines/${id}`);
      return budgetLineLabel(res.data);
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

const TASK_TAB_KEYS = ['overview', RECORD_HISTORY_TAB_KEY] as const;
type TaskTabKey = typeof TASK_TAB_KEYS[number];
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;

export default function TaskWorkspacePage() {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const dialogs = useKanapDialogs();
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
  // The tab is part of the address; an address without one, or with an unknown one, opens Overview.
  const rawTab = String(params.tab || '');
  const activeTab: TaskTabKey = (TASK_TAB_KEYS as readonly string[]).includes(rawTab) ? rawTab as TaskTabKey : 'overview';
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

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [form, setForm] = React.useState<Partial<TaskData>>({});
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Handed over a task whose line or contract the person cannot read: they stay an observer.
  const [stillFollowing, setStillFollowing] = React.useState(false);
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
  // Bumped when close is cancelled, so the effect below restarts a timer that close had cleared.
  const [descriptionAutosaveNonce, setDescriptionAutosaveNonce] = React.useState(0);
  const savedDescriptionRef = React.useRef('');
  const descSavingRef = React.useRef(false);
  const autoCommentFocusTaskRef = React.useRef<string | null>(null);
  const [isContentScrolled, setIsContentScrolled] = React.useState(false);
  const { data: classificationDefaults, isLoading: classificationDefaultsLoading } = useClassificationDefaults();

  // Set once this task is deleted: the page leaves without loading it again.
  const [deletedId, setDeletedId] = React.useState<string | null>(null);
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
    enabled: !!id && !isCreate && deletedId !== id,
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
  useRecordTitle(taskMatchesCurrentRoute && task?.item_number && task?.title ? `T-${task.item_number} ${task.title}` : null);

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
    task_type_code: source.task_type_code,
    priority_level: source.priority_level,
    start_date: source.start_date,
    due_date: source.due_date,
    assignee_user_id: source.assignee_user_id,
    creator_id: source.creator_id,
    phase_id: source.phase_id,
    labels: source.labels,
    viewer_ids: source.viewer_ids,
    // Null stays null: the person does not read that module, and the field is not shown.
    application_ids: source.application_ids === null ? null : source.application_ids || [],
    asset_ids: source.asset_ids === null ? null : source.asset_ids || [],
    applications: source.applications === null ? null : source.applications || [],
    assets: source.assets === null ? null : source.assets || [],
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

  const linkedTask = liveTask || task;
  const linkedBudgetId = linkedTask && ['spend_item', 'capex_item'].includes(linkedTask.related_object_type ?? '')
    && !linkedTask.related_object_hidden
    ? linkedTask.related_object_id : null;
  const { data: linkedBudgetLine } = useQuery({
    ...budgetLineDetailQuery(linkedBudgetId ?? ''),
    enabled: !isCreate && !!linkedBudgetId,
  });
  const displayedTask = React.useMemo(() => linkedTask && linkedBudgetLine && linkedBudgetId === linkedBudgetLine.id
    ? { ...linkedTask, related_object_name: budgetLineLabel(linkedBudgetLine) }
    : linkedTask, [linkedTask, linkedBudgetLine, linkedBudgetId]);

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
    const source = displayedTask;
    const type = relatedKindFromType(source?.related_object_type ?? null);
    const relatedId = source?.related_object_id;
    const relatedName = (source?.related_object_name ?? '').trim();
    // A line the person cannot read has no page to go back to.
    if (!type || !relatedId || !relatedName || source?.related_object_hidden) return null;
    return { type, id: relatedId, name: relatedName };
  }, [displayedTask]);
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

  const handleDeleteAttachment = async (attachmentId: string) => {
    await api.patch(`/tasks/attachments/${attachmentId}/delete`);
    refetchAttachments();
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
  const { raw: taskTypesData, status: taskTypesStatus } = useLocalizedTaskTypes({ enabled: isCreate });

  // The default type: the shipped "Task", renamed or not (by name for a tenant created before the codes)
  const defaultTaskTypeId = React.useMemo(() => {
    if (!taskTypesData) return null;
    const taskType = taskTypesData.find(t => t.code === 'task' && t.is_active)
      ?? taskTypesData.find(t => t.name === 'Task' && t.is_active);
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

    setInitialized(false);

    // Seed type and id from the URL. The display name is derived at render from the origin
    // query: seeding the type label here stuck when this effect was cancelled before its read.
    let seedRelation: { type: RelatedObjectType | null; id: string | null; name: string | null } = {
      type: null,
      id: null,
      name: null,
    };
    if (originProjectId) {
      seedRelation = { type: 'project', id: originProjectId, name: null };
    } else if (createSpendItemId) {
      seedRelation = { type: 'spend_item', id: createSpendItemId, name: null };
    } else if (createCapexItemId) {
      seedRelation = { type: 'capex_item', id: createCapexItemId, name: null };
    } else if (createContractId) {
      seedRelation = { type: 'contract', id: createContractId, name: null };
    } else if (createIncidentId) {
      seedRelation = { type: 'incident', id: createIncidentId, name: null };
    }
    setCreateRelation(seedRelation);
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
    setInitialized(true);
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
  ]);

  // Auto-focus on comment composer disabled — toolbar loads on user click via hideToolbarUntilFocus

  React.useEffect(() => {
    setIsContentScrolled(false);
  }, [id, isCreate]);

  // The project a task is created from: its classification is the new task's.
  const { data: createProject, status: createProjectStatus } = useQuery({
    queryKey: ['task-create-project', originProjectId],
    queryFn: async () => (await api.get<{
      source_id?: string | null;
      category_id?: string | null;
      stream_id?: string | null;
      company_id?: string | null;
    }>(`/portfolio/projects/${originProjectId}`)).data,
    enabled: isCreate && !!originProjectId,
  });

  // The classification a standalone or project task is created with: the project's, else the
  // person's defaults (a default stream only within the category it belongs to).
  const createClassification = React.useMemo(() => {
    const out: Partial<Record<'source_id' | 'category_id' | 'stream_id' | 'company_id', string | null>> = {};
    if (!isCreate || (createRelation.type && createRelation.type !== 'project')) return out;
    const isUnset = (value: unknown) => value === undefined || value === null || value === '';
    if (createRelation.type === 'project' && createProject) {
      out.source_id = createProject.source_id ?? null;
      out.category_id = createProject.category_id ?? null;
      out.stream_id = createProject.stream_id ?? null;
      out.company_id = createProject.company_id ?? null;
    }
    for (const field of ['source_id', 'category_id', 'company_id'] as const) {
      const value = classificationDefaults?.[field] ?? null;
      if (value && isUnset(out[field])) out[field] = value;
    }
    const defaultStreamId = classificationDefaults?.stream_id ?? null;
    if (defaultStreamId && isUnset(out.stream_id)) {
      const currentCategory = out.category_id || null;
      const defaultCategory = classificationDefaults?.category_id ?? null;
      if (!(currentCategory && defaultCategory && currentCategory !== defaultCategory)) out.stream_id = defaultStreamId;
    }
    return out;
  }, [classificationDefaults, createProject, createRelation.type, isCreate]);

  // A title committed before these defaults are read creates the task once they are.
  const createDefaultsReady = isCreate
    && !!profile?.id
    && taskTypesStatus !== 'pending'
    && !classificationDefaultsLoading
    && (!originProjectId || createProjectStatus !== 'pending');

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
    const isRelationPatch = hasRelatedType || hasRelatedId;
    // A line the person cannot read comes without its id: the task keeps it while the relation is untouched.
    if (nextType !== null && !nextId && (isRelationPatch || !snapshot.related_object_hidden)) {
      throw new Error(t('portfolio:workspace.task.messages.relatedItemRequired'));
    }

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
        const res = await api.patch(endpoint, payload);
        if ((res?.data as { stillFollowing?: unknown } | undefined)?.stillFollowing === true) setStillFollowing(true);
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
  }, [description, descriptionAutosaveNonce, isCreate, initialized, task, canManageCurrentTask, handleDescriptionAutosave]);

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
      // A line the person cannot read comes without its id: the task keeps it while the relation is untouched.
      if (nextType !== null && !nextId && (relationChanged || !task.related_object_hidden)) {
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
      // The page leaves first. This task's query (keyed by T-n or by its id) is dropped
      // so it is not read again, then the lists read again.
      setDeletedId(id);
      navigate(originPath);
      queryClient.removeQueries({ queryKey: ['tasks', id], exact: true });
      if (task.id !== id) queryClient.removeQueries({ queryKey: ['tasks', task.id], exact: true });
      void queryClient.invalidateQueries({
        queryKey: ['tasks'],
        predicate: (q) => q.queryKey[1] !== id && q.queryKey[1] !== task.id,
      });
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('portfolio:workspace.task.messages.deleteFailed')));
    }
  };

  // Close, back, the parent breadcrumb, the project link and a menu link share one question.
  // A saved task: Stay, Save and leave, Leave without saving. A new task with typed content:
  // Stay, Leave without saving. The link guard and the clicked control can both ask, so one
  // click keeps a single answer. Clearing the description debounce does not re-run the effect
  // that owns it, so Stay starts it again.
  const leaveInFlightRef = React.useRef<Promise<boolean> | null>(null);
  const confirmUnsavedLeave = async (): Promise<boolean> => {
    if (leaveInFlightRef.current) return leaveInFlightRef.current;
    const run = (async (): Promise<boolean> => {
      if (isCreate) {
        if (!dirtyRef.current) return true;
        const leave = await dialogs.confirm(unsavedConfirm(t, 'leaveWithoutSaving'));
        if (!leave) return false;
        dirtyRef.current = false;
        setDirty(false);
        return true;
      }

      const resumeDescriptionAutosave = descAutosaveTimerRef.current != null;
      if (descAutosaveTimerRef.current) {
        clearTimeout(descAutosaveTimerRef.current);
        descAutosaveTimerRef.current = null;
      }
      await waitForSidebarSaves();
      if (!dirtyRef.current) return true;
      const outcome = await dialogs.confirmOutcome({
        ...unsavedConfirm(t, 'saveAndLeave'),
        stayLabel: t('common:unsaved.leaveWithoutSaving.cancel'),
      });
      if (outcome === 'stay') {
        if (resumeDescriptionAutosave) setDescriptionAutosaveNonce((n) => n + 1);
        return false;
      }
      if (outcome === 'confirm') {
        setSaving(true);
        try { await handleSave(); } catch { setSaving(false); return false; }
        setSaving(false);
      } else {
        if (task) {
          setTitle(task.title || '');
          setDescription(task.description || '');
          setForm(buildTaskFormFromTask(task));
        }
        resetClassificationTouched();
        setDirty(false);
      }
      // The ref updates in an effect, which is too late for the replayed click of a guarded link.
      dirtyRef.current = false;
      return true;
    })();
    leaveInFlightRef.current = run;
    try {
      return await run;
    } finally {
      if (leaveInFlightRef.current === run) leaveInFlightRef.current = null;
    }
  };
  const handleBack = async () => {
    if (!(await confirmUnsavedLeave())) return;
    navigate(originPath);
  };
  useLeaveGuard(() => dirtyRef.current, confirmUnsavedLeave);

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
      const proceed = await dialogs.confirm(unsavedConfirm(t, 'saveAndLeave'));
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
    navigate(`/portfolio/tasks/${targetId}/${activeTab}${qs ? `?${qs}` : ''}`);
  }, [activeTab, buildTaskFormFromTask, cleanedSearchParams, dialogs, dirty, handleSave, navigate, resetClassificationTouched, task, t, waitForSidebarSaves]);

  // A tab change keeps the page: the pending description and side panel saves go first.
  const handleTabChange = React.useCallback(async (nextTab: string) => {
    if (nextTab === activeTab) return;
    if (descAutosaveTimerRef.current) {
      clearTimeout(descAutosaveTimerRef.current);
      descAutosaveTimerRef.current = null;
      await handleDescriptionAutosave(description);
    }
    await waitForSidebarSaves();
    const qs = cleanedSearchParams.toString();
    navigate(`/portfolio/tasks/${id}/${nextTab}${qs ? `?${qs}` : ''}`);
  }, [activeTab, cleanedSearchParams, description, handleDescriptionAutosave, id, navigate, waitForSidebarSaves]);
  const taskTabs = React.useMemo(() => [
    { key: 'overview', label: t('portfolio:workspace.task.tabs.overview') },
    { key: RECORD_HISTORY_TAB_KEY, label: t('portfolio:workspace.task.tabs.history') },
  ], [t]);

  // Creation at the title: the new page creates the task when its title is committed, then the task
  // shows Create and Cancel until the person leaves it.
  const creationReturn = useCreationReturn(originPath);
  const creation = useRecordCreation({
    family: 'tasks',
    apiBase: task?.related_object_type === 'project' && task.related_object_id
      ? `/portfolio/projects/${task.related_object_id}/tasks`
      : '/tasks',
    recordId: !isCreate && taskMatchesCurrentRoute ? task?.id ?? null : null,
    listPath: originPath,
    recordLabel: t('portfolio:workspace.task.creation.record'),
    queryKeyPrefixes: ['tasks', 'project-tasks'],
    onError: setError,
  });

  // The real name when the origin query has it. The type label stands in only when that name
  // cannot be read (the query failed, or it has not answered yet).
  const createRelationPreviewName = createRelation.name
    ?? fetchedOriginName
    ?? (createRelation.type ? t(`portfolio:context.${createRelation.type}`) : null);

  // The task as the new page shows it, dimmed: the defaults it will be created with.
  const createDraft = React.useMemo<TaskData | null>(() => (isCreate ? {
    id: '',
    item_number: null,
    title: '',
    description: '',
    status: (form.status as TaskStatus) || 'open',
    task_type_id: form.task_type_id || defaultTaskTypeId,
    task_type_name: null,
    priority_level: form.priority_level || 'normal',
    priority_score: null as unknown as number,
    start_date: null,
    due_date: null,
    assignee_user_id: form.assignee_user_id ?? null,
    assignee_name: null,
    creator_id: form.creator_id ?? null,
    creator_name: null,
    owner_ids: [],
    viewer_ids: [],
    labels: [],
    application_ids: [],
    asset_ids: [],
    applications: [],
    assets: [],
    related_object_type: createRelation.type as TaskData['related_object_type'],
    related_object_id: createRelation.id,
    related_object_name: createRelationPreviewName,
    phase_id: form.phase_id ?? null,
    phase_name: null,
    source_id: createClassification.source_id ?? null,
    source_name: null,
    category_id: createClassification.category_id ?? null,
    category_name: null,
    stream_id: createClassification.stream_id ?? null,
    stream_name: null,
    company_id: createClassification.company_id ?? null,
    company_name: null,
    created_at: '',
    updated_at: '',
  } : null), [createClassification, createRelation, createRelationPreviewName, defaultTaskTypeId, form, isCreate]);

  // The title creates the task through the route of its relation, with the defaults the creation
  // form sent with only a title; the page moves to it, every tab open, with Create and Cancel (or
  // closes it, kept, when Create was clicked meanwhile). A title committed before the defaults are
  // read waits for them.
  const titleCreation = useTitleCreation<TaskData>({
    isCreate,
    requiredMessage: t('common:creation.titleRequired'),
    ready: createDefaultsReady,
    post: async (value) => {
      const relation = createRelation;
      const withClassification = !relation.type || relation.type === 'project';
      const payload: Record<string, unknown> = {
        title: value,
        description: null,
        status: form.status || 'open',
        priority_level: form.priority_level || 'normal',
        start_date: null,
        due_date: null,
        assignee_user_id: form.assignee_user_id || null,
        creator_id: form.creator_id || null,
        phase_id: form.phase_id || null,
        viewer_ids: [],
        labels: [],
        task_type_id: form.task_type_id || defaultTaskTypeId || null,
        application_ids: [],
        asset_ids: [],
        ...(withClassification ? createClassification : {}),
      };
      let endpoint = '/tasks/standalone';
      if (relation.type && relation.id) {
        const routes: Record<string, string> = {
          project: `/portfolio/projects/${relation.id}/tasks`,
          spend_item: `/spend-items/${relation.id}/tasks`,
          capex_item: `/capex-items/${relation.id}/tasks`,
          contract: `/contracts/${relation.id}/tasks`,
          incident: `/incidents/${relation.id}/tasks`,
        };
        endpoint = routes[relation.type];
      }
      return (await api.post<TaskData & { creation_token: string }>(endpoint, payload)).data;
    },
    onCreated: async (created, token, finish) => {
      const relation = createRelation;
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (relation.type === 'project' && relation.id) {
        void queryClient.invalidateQueries({ queryKey: ['project-tasks', relation.id] });
      }
      if (finish) {
        navigate(creationReturn, { replace: true });
        return;
      }
      creation.startCreation({ recordId: created.id, token, returnTo: creationReturn });
      const reference = created.item_number ? formatItemRef('task', created.item_number) : created.id;
      // The create answers with the row alone (no names of its linked records): the page opens on
      // the task as read, or on that row with what the new page knew if the read fails.
      const full = await api.get<TaskData>(`/tasks/${created.id}`).then((r) => r.data).catch(() => null);
      queryClient.setQueryData(['tasks', reference], full || {
        ...created,
        application_ids: null,
        asset_ids: null,
        applications: null,
        assets: null,
        related_object_name: createRelationPreviewName,
      });
      const qs = cleanedSearchParams.toString();
      navigate(`/portfolio/tasks/${reference}/overview${qs ? `?${qs}` : ''}`, { replace: true });
    },
    errorMessage: (err) => getApiErrorMessage(err, t, t('portfolio:workspace.task.messages.createFailed')),
    onStart: () => setError(null),
  });

  // What is still being typed or queued on the task being created: saved before Create and Cancel.
  const flushCreatedTask = React.useCallback(async () => {
    if (descAutosaveTimerRef.current) {
      clearTimeout(descAutosaveTimerRef.current);
      descAutosaveTimerRef.current = null;
    }
    if ((description.trim() || null) !== (savedDescriptionRef.current.trim() || null)) {
      await handleDescriptionAutosave(description);
    }
    await waitForSidebarSaves();
  }, [description, handleDescriptionAutosave, waitForSidebarSaves]);

  // Create: on the new page, the title is the only field; on the task being created, what is still
  // being typed is saved, then the task is kept and closed.
  const createAction = React.useCallback(async () => {
    if (isCreate) {
      titleCreation.create();
      return;
    }
    await flushCreatedTask();
    dirtyRef.current = false;
    setDirty(false);
    creation.finishCreation();
  }, [creation, flushCreatedTask, isCreate, titleCreation]);

  // Cancel: the new page is left; the task being created is deleted, after a confirmation when more
  // than its title was given (counted once what is still typed is saved).
  const cancelAction = React.useCallback(async () => {
    if (isCreate) {
      navigate(creationReturn);
      return;
    }
    await flushCreatedTask();
    if (await creation.cancelCreation()) {
      dirtyRef.current = false;
      setDirty(false);
    }
  }, [creation, creationReturn, flushCreatedTask, isCreate, navigate]);

  // The properties panel is open on the new page and on the task being created, whatever its
  // stored state; its toggle works on the created task; afterwards it follows its stored state.
  const creating = isCreate || creation.beingCreated;
  const [creationDrawerOpen, setCreationDrawerOpen] = React.useState(true);
  React.useEffect(() => {
    setCreationDrawerOpen(true);
  }, [task?.id]);
  const shownDrawerOpen = creating ? creationDrawerOpen : drawerOpen;
  const toggleDrawer = React.useCallback(() => {
    if (creating) setCreationDrawerOpen((o) => !o);
    else setDrawerOpen((o: boolean) => !o);
  }, [creating]);

  const contentSpacing = {
    section: 3,
    sectionLarge: 4,
  } as const;
  const handleMainContentScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const nextScrolled = event.currentTarget.scrollTop > 4;
    setIsContentScrolled((prev) => (prev === nextScrolled ? prev : nextScrolled));
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      // A task being created takes it as Create (`CreationActions`).
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
  }, [canManageCurrentTask, dirty, saving, handleSave]);

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
          // While the task is being created, previous and next wait until the person leaves it.
          if (hasPrev && !creation.beingCreated) { e.preventDefault(); void confirmAndNavigate(prevId); }
          break;
        case 'k':
        case 'ArrowRight':
          if (hasNext && !creation.beingCreated) { e.preventDefault(); void confirmAndNavigate(nextId); }
          break;
        case 'Escape':
          e.preventDefault();
          void handleBack();
          break;
        case 'p':
          e.preventDefault();
          toggleDrawer();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isCreate, hasPrev, hasNext, prevId, nextId, confirmAndNavigate, handleBack, creation.beingCreated, toggleDrawer]);

  const workspaceRef = React.useRef<HTMLDivElement>(null);
  useCreationFieldFocus(workspaceRef, `${isCreate ? 'new' : 'record'}:${activeTab}`);

  if (!isCreate && isLoading && !task) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">{t('portfolio:workspace.task.messages.loading')}</Typography>
      </Box>
    );
  }

  if (!isCreate && !task) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('portfolio:workspace.task.messages.notFound')}</Alert>
        <Button onClick={handleBack} sx={{ mt: 2 }}>{taskCrumbs[0]?.label || t('portfolio:workspace.task.navigation.tasks')}</Button>
      </Box>
    );
  }

  // The new page shows the draft; a task page, the task.
  const effectiveTask = (isCreate ? createDraft : displayedTask || task) as TaskData;
  const isProjectTask = effectiveTask.related_object_type === 'project';
  const hasConvertedRequest = Boolean(task?.converted_request_id);
  const canConvertToRequest = canManageCurrentTask && canCreateRequest;
  const headerRelatedType = effectiveTask.related_object_type;
  const headerRelatedId = effectiveTask.related_object_id;
  const sidebarProjectWorkspaceLink = (
    headerRelatedType === 'project' && headerRelatedId
      ? buildProjectWorkspacePath(headerRelatedId, 'overview')
      : null
  );

  // The overview of a task; the new page's, from the draft, with nothing that needs a task id.
  const overview = (
    <>
      {/* Description */}
      <Box sx={{ mb: contentSpacing.sectionLarge }} data-creation-description="">
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
              disabled={!isCreate && !canManageCurrentTask}
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
      {(isCreate || canManageCurrentTask || attachments.length > 0) && (
        <Box sx={{ mb: contentSpacing.section }}>
          <TaskAttachments
            taskId={effectiveTask.id}
            attachments={isCreate ? [] : attachments}
            onUpload={handleUploadAttachment}
            onDelete={handleDeleteAttachment}
            canManage={isCreate || canManageCurrentTask}
          />
        </Box>
      )}

      <Divider sx={{ my: contentSpacing.section }} />

      {/* Activity Section */}
      <TaskActivity
        taskId={effectiveTask.id}
        projectId={isProjectTask && effectiveTask.related_object_id ? effectiveTask.related_object_id : undefined}
        readOnly={!isCreate && !canManageCurrentTask}
        relatedObjectType={effectiveTask.related_object_type ?? undefined}
        currentStatus={effectiveTask.status}
        totalTimeHours={totalTimeHours}
        initialStatus={initialStatus}
        commentFocusNonce={commentFocusNonce}
      />
    </>
  );

  const propertiesDrawer = shownDrawerOpen ? (
    <TaskPropertiesDrawer
      task={effectiveTask}
      open
      onToggle={toggleDrawer}
      onPatch={handleEditSidebarPatch}
      readOnly={!isCreate && !canManageCurrentTask}
      totalTimeHours={totalTimeHours}
      isCreate={isCreate}
      onRelationChange={handleEditRelationChange}
      projectWorkspaceLink={sidebarProjectWorkspaceLink}
    />
  ) : null;

  return (
    <Box ref={workspaceRef} data-workspace-shell="" onKeyDownCapture={followCreationFields} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TaskDetailHeader
        taskId={task?.id ?? ''}
        itemNumber={task?.item_number ?? null}
        title={title}
        status={effectiveTask.status}
        priorityLevel={effectiveTask.priority_level as PriorityLevel}
        priorityScore={task?.priority_score ?? null}
        assigneeUserId={effectiveTask.assignee_user_id}
        assigneeName={effectiveTask.assignee_name}
        dueDate={effectiveTask.due_date}
        isProjectTask={isProjectTask}
        hasConvertedRequest={hasConvertedRequest}
        projectId={isProjectTask ? effectiveTask.related_object_id : null}
        projectName={isProjectTask ? (effectiveTask.related_object_name ?? null) : null}
        onNavigateToProject={(pid) => {
          void confirmUnsavedLeave().then((ok) => {
            if (ok) navigate(buildProjectWorkspacePath(pid, 'activity'));
          });
        }}
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
        onTitleSave={(value) => {
          if (isCreate) {
            titleCreation.commit(value);
            return;
          }
          void handleTitleSave(value);
        }}
        onMetadataPatch={handleEditSidebarPatch}
        canManage={isCreate ? canManage : canManageCurrentTask}
        canDelete={canDeleteCurrentTask}
        canConvertToRequest={canConvertToRequest}
        convertDisabledTitle={
          hasConvertedRequest
            ? (task?.converted_request_item_number
              ? t('portfolio:workspace.task.actions.alreadyConvertedWithReference', { ref: `REQ-${task.converted_request_item_number}` })
              : t('portfolio:workspace.task.actions.alreadyConverted'))
            : (!canCreateRequest ? t('portfolio:workspace.task.actions.convertRequiresPermission') : undefined)
        }
        crumbs={taskCrumbs}
        onOriginClick={handleBack}
        onParentClick={(href) => {
          void confirmUnsavedLeave().then((ok) => {
            if (ok) navigate(href);
          });
        }}
        tabs={isCreate ? taskTabs.map((tab) => ({ ...tab, disabled: true })) : taskTabs}
        activeTab={activeTab}
        onTabChange={(next) => { void handleTabChange(next); }}
        creationActions={creating ? (
          <CreationActions
            busy={creation.cancelling}
            writing={titleCreation.writing}
            onCreate={() => { void createAction(); }}
            onCancel={() => { void cancelAction(); }}
          />
        ) : undefined}
        titleToGive={isCreate}
        titleError={isCreate ? titleCreation.titleError : undefined}
        titleFocusRequest={titleCreation.focusRequest}
        onTitleDraftChange={isCreate ? () => titleCreation.setTitleError(null) : undefined}
        onTitleCancel={isCreate ? () => { void cancelAction(); } : undefined}
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mx: 2, mt: 1 }}>
          {error}
        </Alert>
      )}
      {stillFollowing && (
        <Alert severity="info" onClose={() => setStillFollowing(false)} sx={{ mx: 2, mt: 1 }} data-testid="task-still-following">
          {t('portfolio:workspace.task.messages.stillFollowing')}
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
          data-creation-panel="main"
          data-primary-scroll={isMobile ? undefined : ''}
          tabIndex={isMobile ? undefined : -1}
          sx={{ flex: isMobile ? 'none' : 1, minWidth: 0, overflow: isMobile ? 'visible' : 'auto', outline: 'none', pt: '8px', pl: 3, pr: isMobile ? 3 : '29px', pb: 3 }}
          onScroll={handleMainContentScroll}
        >
          {isCreate ? <CreationPreview>{overview}</CreationPreview> : activeTab === 'overview' && overview}
          {!isCreate && task && activeTab === RECORD_HISTORY_TAB_KEY && (
            <WorkspaceTabBoundary resetKey={activeTab} onRetry={historyTab.retry}>
              <React.Suspense fallback={null}>
                <HistoryTab key={task.id} table="tasks" recordId={task.id} />
              </React.Suspense>
            </WorkspaceTabBoundary>
          )}
        </Box>

        {/* Tab-anchor: zero-width column with absolutely-positioned classeur tab */}
        {!isMobile && (
          <Box sx={{ width: 0, position: 'relative', alignSelf: 'stretch' }}>
            <Box
              component="button"
              onClick={toggleDrawer}
              disabled={isCreate}
              aria-label={shownDrawerOpen ? t('portfolio:workspace.closeProperties') : t('portfolio:workspace.openProperties')}
              aria-expanded={shownDrawerOpen}
              sx={(theme) => ({
                position: 'absolute',
                top: taskDetailTokens.drawer.tabTop,
                right: 0,
                width: 26,
                height: 120,
                bgcolor: shownDrawerOpen ? theme.palette.kanap.tab.bgActive : theme.palette.kanap.tab.bg,
                border: `1px solid ${shownDrawerOpen ? theme.palette.kanap.tab.borderActive : theme.palette.kanap.tab.border}`,
                borderRight: 'none',
                borderRadius: '8px 0 0 8px',
                cursor: isCreate ? 'default' : 'pointer',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 0,
                transition: 'background-color 0.15s, border-color 0.15s',
                '&:hover': {
                  bgcolor: shownDrawerOpen ? theme.palette.kanap.tab.bgActive : theme.palette.kanap.tab.bgHover,
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
                  color: shownDrawerOpen ? theme.palette.kanap.tab.fgActive : theme.palette.kanap.tab.fg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  pointerEvents: 'none',
                })}
              >
                <Box component="span" sx={{ fontSize: '14px', lineHeight: 1 }}>
                  {shownDrawerOpen ? '›' : '‹'}
                </Box>
                <span>{t('workspace.sidebarTitle')}</span>
              </Box>
            </Box>
          </Box>
        )}

        {/* Properties drawer, on the right; the new page's is the draft's, out of reach */}
        {isCreate && propertiesDrawer
          ? <CreationPreview sx={{ display: 'flex', flexShrink: 0 }}>{propertiesDrawer}</CreationPreview>
          : propertiesDrawer}
      </Box>

      {task && (
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
      )}
      {doneGuard.dialog}
    </Box>
  );
}
