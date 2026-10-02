import React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, IconButton, LinearProgress, Stack, Typography, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import api from '../../api';
import { formatShortDate } from '../../lib/dateFormat';
import { useProjectNav } from '../../hooks/useProjectNav';
import { useClassificationDefaults } from '../../hooks/useClassificationDefaults';
import { useAuth } from '../../auth/AuthContext';
import DependencySelector from './components/DependencySelector';
import RelationsSectionTitle from './components/RelationsSectionTitle';
import StatusChangeDialog from './components/StatusChangeDialog';
import { type ProjectScoringEditorHandle } from './editors/ProjectScoringEditor';
import { type EffortAllocationData } from './components/EffortAllocationTable';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { buildInlineImageUrl, resolveInlineImageTenantSlug } from '../../utils/inlineImageUrls';
import { formatItemRef } from '../../utils/item-ref';
import { getDotColor, PROJECT_STATUS_COLORS } from '../../utils/statusColors';
import { type IntegratedDocumentEditorHandle } from '../../components/IntegratedDocumentEditor';
import MetadataUserPicker, { formatMetadataUserName } from '../../components/workspace/MetadataUserPicker';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import PortfolioDetailWorkspaceShell from './workspace/PortfolioDetailWorkspaceShell';
import {
  PortfolioMetadataItem,
  PortfolioProgressMetadata,
  PortfolioScoreMetadata,
  PortfolioStatusMetadata,
} from './workspace/PortfolioMetadataBar';
import ProjectPropertyPanel from './workspace/project/ProjectPropertyPanel';
import ProjectSummaryTab from './workspace/project/ProjectSummaryTab';
import WorkspaceTabLoadingFallback from './workspace/WorkspaceTabLoadingFallback';
import { getProjectWorkspaceInclude } from './workspace/workspace-detail-includes';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import {
  getProjectStatusLabel,
  getProjectStatusOptions,
} from '../../utils/portfolioI18n';
import { useTenant } from '../../tenant/TenantContext';
import { useLocale } from '../../i18n/useLocale';
import { getScoreColor } from '../tasks/theme/taskDetailTokens';
import {
  fetchPortfolioRelationsCount,
  fetchProjectTasksCount,
} from '../../utils/workspaceTabCounts';
import { useKanapDialogs } from '../../components/design';
import { carryListFilters } from '../../lib/listContext';

type TabKey = 'summary' | 'tasks' | 'timeline' | 'effort' | 'scoring' | 'relations' | 'knowledge';
type LegacyPanelRoute = 'overview' | 'activity' | 'team';
type RouteTabKey = TabKey | LegacyPanelRoute;
type DependencyTarget = { type: 'request' | 'project'; id: string; name: string };

const PROJECT_TAB_KEYS: TabKey[] = ['summary', 'tasks', 'timeline', 'effort', 'scoring', 'relations', 'knowledge'];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  waiting_list: ['planned', 'on_hold', 'cancelled'],
  planned: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['in_testing', 'done', 'on_hold', 'cancelled'],
  in_testing: ['in_progress', 'done', 'on_hold', 'cancelled'],
  on_hold: ['waiting_list', 'planned', 'in_progress', 'cancelled'],
  done: [],
  cancelled: [],
};

// Classification interfaces (from API)
interface ClassificationType {
  id: string;
  name: string;
  is_active: boolean;
}
interface ClassificationCategory {
  id: string;
  name: string;
  is_active: boolean;
}
interface ClassificationStream {
  id: string;
  name: string;
  category_id: string;
  is_active: boolean;
}

function formatDate(locale: string, value?: string | null) {
  return formatShortDate(value, locale, { year: 'always' }) || null;
}

const ProjectTimelineTab = React.lazy(() => import('./workspace/project/ProjectTimelineTab'));
const ProjectScoringTab = React.lazy(() => import('./workspace/project/ProjectScoringTab'));
const ProjectEffortTab = React.lazy(() => import('./workspace/project/ProjectEffortTab'));
const ProjectTasksPanel = React.lazy(() => import('./editors/ProjectTasksPanel'));
const ProjectActivityTab = React.lazy(() => import('./workspace/project/ProjectActivityTab'));
const ProjectRelationsPanel = React.lazy(() => import('./editors/ProjectRelationsPanel'));
const ProjectKnowledgeTab = React.lazy(() => import('./workspace/project/ProjectKnowledgeTab'));

export default function ProjectWorkspacePage() {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasLevel, profile } = useAuth();
  const { tenantSlug } = useTenant();
  const { addToRecent } = useRecentlyViewed();
  const inlineImageTenantSlug = resolveInlineImageTenantSlug(tenantSlug, window.location.hostname);

  const idParam = String(params.id || '');
  const isCreate = idParam === 'new';
  const id = idParam;
  const rawRouteTab = (params.tab as RouteTabKey | undefined) || 'summary';
  const routeTab: TabKey = PROJECT_TAB_KEYS.includes(rawRouteTab as TabKey)
    ? (rawRouteTab as TabKey)
    : 'summary';
  const propertyPanelFocusSection = rawRouteTab === 'team'
    ? rawRouteTab
    : null;
  const projectInclude = React.useMemo(() => getProjectWorkspaceInclude(routeTab), [routeTab]);
  const tabs = React.useMemo<Array<{ key: TabKey; label: string }>>(() => [
    { key: 'summary', label: t('portfolio:labels.summary') },
    { key: 'tasks', label: t('portfolio:labels.tasks') },
    { key: 'timeline', label: t('portfolio:labels.timeline') },
    { key: 'effort', label: t('portfolio:labels.progress') },
    { key: 'scoring', label: t('portfolio:labels.scoring') },
    { key: 'relations', label: t('portfolio:labels.relations') },
    { key: 'knowledge', label: t('portfolio:labels.knowledge') },
  ], [t]);
  const statusOptions = React.useMemo(() => getProjectStatusOptions(t), [t]);
  const originOptions = React.useMemo(() => [
    { value: 'fast_track', label: t('portfolio:origin.fast_track') },
    { value: 'legacy', label: t('portfolio:origin.legacy') },
  ], [t]);
  const originLabels = React.useMemo<Record<string, string>>(() => ({
    standard: t('portfolio:workspace.project.origin.standard'),
    fast_track: t('portfolio:workspace.project.origin.fastTrack'),
    legacy: t('portfolio:workspace.project.origin.legacy'),
  }), [t]);

  React.useEffect(() => {
    if (rawRouteTab !== routeTab) {
      navigate(`/portfolio/projects/${id}/summary${location.search}`, { replace: true });
      return;
    }
    if (isCreate && rawRouteTab !== 'summary') {
      navigate(`/portfolio/projects/${id}/summary${location.search}`, { replace: true });
    }
  }, [id, isCreate, location.search, navigate, rawRouteTab, routeTab]);

  // Fetch project data
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['portfolio-project', id, projectInclude],
    queryFn: async () => {
      const res = await api.get(`/portfolio/projects/${id}`, { params: { include: projectInclude } });
      return res.data;
    },
    enabled: !isCreate,
    // Keep the previous project on screen while the next one loads (prev/next,
    // deep-link) so the workspace never blanks to a full-page loading bar.
    placeholderData: (previousData) => previousData,
  });

  // Track recently viewed
  React.useEffect(() => {
    if (data?.id && data?.name) {
      addToRecent('project', data.id, data.name, data.item_number ? `PRJ-${data.item_number}` : undefined);
    }
  }, [data?.id, data?.name, data?.item_number, addToRecent]);

  // Browser tab title
  React.useEffect(() => {
    if (data?.item_number && data?.name) {
      document.title = t('portfolio:workspace.project.browserTitle', {
        ref: `PRJ-${data.item_number}`,
        name: data.name,
      });
    }
    return () => { document.title = 'KANAP'; };
  }, [data?.item_number, data?.name, t]);

  // URL replaceState: swap UUID for human-readable ref
  React.useEffect(() => {
    if (!data?.item_number) return;
    const currentParam = params.id || '';
    const isUuid = /^[0-9a-f]{8}-/.test(currentParam);
    // Only rewrite once the loaded data matches the current route id — during a
    // placeholderData nav, `data` is briefly still the previous item.
    if (isUuid && data.id === currentParam) {
      const ref = formatItemRef('project', data.item_number);
      const newPath = location.pathname.replace(currentParam, ref);
      window.history.replaceState(null, '', newPath + location.search);
    }
  }, [data?.id, data?.item_number, params.id, location.pathname, location.search]);

  const projectMatchesCurrentRoute = React.useMemo(() => {
    const raw = String(idParam || '').trim();
    if (!data || !raw) return false;
    if (data.id && raw.toLowerCase() === String(data.id).toLowerCase()) return true;
    if (data.item_number != null && raw === String(data.item_number)) return true;
    if (data.item_number != null && raw.toUpperCase() === formatItemRef('project', data.item_number)) return true;
    return false;
  }, [data?.id, data?.item_number, idParam]);

  // Fetch classification data (types, categories, streams)
  const { data: classificationData } = useQuery({
    queryKey: ['portfolio-classification'],
    queryFn: async () => {
      const res = await api.get('/portfolio/classification/all');
      return res.data as {
        sources: ClassificationType[];
        categories: ClassificationCategory[];
        streams: ClassificationStream[];
      };
    },
  });

  const canReadPortfolioEvaluationSettings = hasLevel('portfolio_settings', 'reader')
    || hasLevel('portfolio_requests', 'reader')
    || hasLevel('portfolio_projects', 'reader');

  // Fetch portfolio settings for mandatory bypass
  const { data: portfolioSettings } = useQuery({
    queryKey: ['portfolio-settings'],
    queryFn: async () => {
      const res = await api.get('/portfolio/settings');
      return res.data as { mandatory_bypass_enabled: boolean };
    },
    enabled: canReadPortfolioEvaluationSettings,
  });

  // Fetch task time summary for progress breakdown
  const { data: taskTimeSummary } = useQuery({
    queryKey: ['portfolio-project-task-time', id],
    queryFn: async () => {
      const res = await api.get(`/portfolio/projects/${id}/tasks/time-summary`);
      return res.data as { it_hours: number; business_hours: number; total_hours: number };
    },
    enabled: !isCreate && routeTab === 'effort',
  });

  // Fetch task time entries for Time Log display
  const { data: taskTimeEntries = [] } = useQuery({
    queryKey: ['portfolio-project-task-time-entries', id],
    queryFn: async () => {
      const res = await api.get(`/portfolio/projects/${id}/tasks/time-entries`);
      return res.data as any[];
    },
    enabled: !isCreate && routeTab === 'effort',
  });

  // Fetch effort allocations for IT
  const { data: itAllocationData, refetch: refetchItAlloc } = useQuery({
    queryKey: ['project-effort-allocations', id, 'it'],
    queryFn: async () => {
      const res = await api.get(`/portfolio/projects/${id}/effort-allocations/it`);
      return res.data as EffortAllocationData;
    },
    enabled: !!id && !isCreate && routeTab === 'effort',
  });

  // Fetch effort allocations for Business
  const { data: businessAllocationData, refetch: refetchBusinessAlloc } = useQuery({
    queryKey: ['project-effort-allocations', id, 'business'],
    queryFn: async () => {
      const res = await api.get(`/portfolio/projects/${id}/effort-allocations/business`);
      return res.data as EffortAllocationData;
    },
    enabled: !!id && !isCreate && routeTab === 'effort',
  });

  const sources = classificationData?.sources?.filter((t) => t.is_active) || [];
  const categories = classificationData?.categories?.filter((c) => c.is_active) || [];
  const streams = classificationData?.streams?.filter((s) => s.is_active) || [];

  const [form, setForm] = React.useState<any>(isCreate ? { origin: 'fast_track' } : {});
  const [dirty, setDirty] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);
  const [pendingStatus, setPendingStatus] = React.useState<string | null>(null);
  const scoringEditorRef = React.useRef<ProjectScoringEditorHandle>(null);
  const scoringAutosaveTimerRef = React.useRef<number | null>(null);
  const scoringAutosaveInFlightRef = React.useRef(false);
  const [scoringDirty, setScoringDirty] = React.useState(false);
  const purposeEditorRef = React.useRef<IntegratedDocumentEditorHandle>(null);
  const [purposeDirty, setPurposeDirty] = React.useState(false);
  const classificationTouchedRef = React.useRef({
    source_id: false,
    category_id: false,
    stream_id: false,
    company_id: false,
  });
  const defaultsAppliedRef = React.useRef(false);
  const { data: classificationDefaults, isLoading: classificationDefaultsLoading } = useClassificationDefaults();

  const canManage = hasLevel('portfolio_projects', 'manager');
  const canContributeToProject = hasLevel('portfolio_projects', 'contributor');
  const canProjectAdmin = hasLevel('portfolio_projects', 'admin');
  const projectDependenciesCount = Array.isArray(form?.dependencies) ? form.dependencies.length : 0;
  const projectTasksCountQuery = useQuery({
    queryKey: ['project-workspace-tasks-count', form?.id],
    queryFn: () => fetchProjectTasksCount(form.id),
    enabled: !isCreate && !!form?.id,
  });
  const projectRelationsCountQuery = useQuery({
    queryKey: ['project-workspace-relations-count', form?.id, projectDependenciesCount],
    queryFn: () => fetchPortfolioRelationsCount('project', form.id, projectDependenciesCount),
    enabled: !isCreate && !!form?.id,
  });
  const projectKnowledgeContextQuery = useQuery<{ total?: number }>({
    queryKey: ['entity-knowledge-context', 'projects', form?.id],
    queryFn: async () => {
      const res = await api.get(`/portfolio/projects/${form.id}/knowledge-context`);
      return res.data;
    },
    enabled: !isCreate && !!form?.id,
  });

  React.useEffect(() => {
    // For an existing item, keep the current form until the new data syncs in
    // (effect below) so the header/actions don't blank between items. Only the
    // create skeleton needs an explicit reset.
    if (isCreate) setForm({ origin: 'fast_track' });
    setDirty(false);
    setScoringDirty(false);
    setPurposeDirty(false);
    setSaveError(null);
    if (scoringAutosaveTimerRef.current !== null) {
      window.clearTimeout(scoringAutosaveTimerRef.current);
      scoringAutosaveTimerRef.current = null;
    }
    scoringAutosaveInFlightRef.current = false;
    scoringEditorRef.current?.reset?.();
    void purposeEditorRef.current?.reset?.();
  }, [id, isCreate]);

  React.useEffect(() => () => {
    if (scoringAutosaveTimerRef.current !== null) {
      window.clearTimeout(scoringAutosaveTimerRef.current);
    }
  }, []);

  // Sync form with loaded data
  React.useEffect(() => {
    if (data && !isCreate) {
      setForm({ ...data });
    }
  }, [data, isCreate]);

  React.useEffect(() => {
    if (!isCreate) return;
    classificationTouchedRef.current = {
      source_id: false,
      category_id: false,
      stream_id: false,
      company_id: false,
    };
    defaultsAppliedRef.current = false;
  }, [isCreate, id]);

  const update = React.useCallback((patch: any) => {
    setDirty(true);
    setForm((prev: any) => ({ ...prev, ...patch }));
  }, []);

  const updateManagedDocDraft = React.useCallback((patch: any) => {
    if (isCreate) {
      setDirty(true);
    }
    setForm((prev: any) => ({ ...prev, ...patch }));
  }, [isCreate]);

  const applyPanelLocalUpdate = React.useCallback((updater: (prev: any) => any) => {
    setForm((prev: any) => updater(prev || {}));
  }, []);

  const persistPanelPatch = React.useCallback(async (patch: Record<string, any>) => {
    if (!isCreate && !canManage) {
      setSaveError(t('portfolio:workspace.project.messages.permissionSavePanel'));
      await refetch();
      return;
    }

    setForm((prev: any) => ({ ...prev, ...patch }));

    if (isCreate) {
      setDirty(true);
      return;
    }

    setSaveError(null);
    try {
      await api.patch(`/portfolio/projects/${id}`, patch);
      queryClient.setQueriesData({ queryKey: ['portfolio-project', id] }, (old: any) => (
        old ? { ...old, ...patch } : old
      ));
      queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.project.messages.savePanelFailed')));
      await refetch();
    }
  }, [canManage, id, isCreate, queryClient, refetch, t]);

  const handleAddDependency = React.useCallback(async (target: DependencyTarget) => {
    const projectId = form?.id;
    if (!projectId) return;

    setSaveError(null);
    setForm((prev: any) => ({
      ...prev,
      dependencies: [
        ...(Array.isArray(prev?.dependencies) ? prev.dependencies : []),
        {
          id: `optimistic:${target.type}:${target.id}`,
          target_type: target.type,
          target_id: target.id,
          target_name: target.name,
          target_status: '',
        },
      ],
    }));

    try {
      await api.post(`/portfolio/projects/${projectId}/dependencies`, {
        target_type: target.type,
        target_id: target.id,
      });
      queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-workspace-relations-count', projectId] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.project.messages.savePanelFailed')));
      await refetch();
    }
  }, [form?.id, queryClient, refetch, t]);

  const handleRemoveDependency = React.useCallback(async (targetType: 'request' | 'project', targetId: string) => {
    const projectId = form?.id;
    if (!projectId) return;

    setSaveError(null);
    setForm((prev: any) => ({
      ...prev,
      dependencies: (Array.isArray(prev?.dependencies) ? prev.dependencies : []).filter(
        (dep: any) => !(dep?.target_type === targetType && dep?.target_id === targetId),
      ),
    }));

    try {
      await api.delete(`/portfolio/projects/${projectId}/dependencies/${targetType}/${targetId}`);
      queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-workspace-relations-count', projectId] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.project.messages.savePanelFailed')));
      await refetch();
    }
  }, [form?.id, queryClient, refetch, t]);

  React.useEffect(() => {
    if (!isCreate || defaultsAppliedRef.current || classificationDefaultsLoading) return;
    if (!classificationData) return;

    setForm((prev: any) => {
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
        const effectiveCategory = isUnset(next.category_id) ? null : next.category_id;
        const stream = streams.find((s) => s.id === defaultStreamId);
        const matchesCategory = !stream || !effectiveCategory || stream.category_id === effectiveCategory;
        if (matchesCategory) {
          next.stream_id = defaultStreamId;
          changed = true;
        }
      }

      return changed ? next : prev;
    });

    defaultsAppliedRef.current = true;
  }, [
    isCreate,
    classificationDefaultsLoading,
    classificationDefaults,
    classificationData,
    streams,
  ]);

  const handleSave = async (): Promise<boolean> => {
    setSaveError(null);
    try {
      if (isCreate) {
        const res = await api.post('/portfolio/projects', form);
        const newId = res.data?.id;
        if (newId) {
          setDirty(false);
          navigate(`/portfolio/projects/${newId}/summary?${searchParams.toString()}`);
          return true;
        }
        return false;
      } else {
        if (!canManage && (dirty || scoringDirty)) {
          setSaveError(t('portfolio:workspace.project.messages.permissionSaveWorkspace'));
          return false;
        }

        if (canManage) {
          const projectPayload = { ...form };
          delete projectPayload.purpose;
          await api.patch(`/portfolio/projects/${id}`, projectPayload);

          // Save scoring editor data if dirty.
          if (scoringEditorRef.current?.isDirty()) {
            await scoringEditorRef.current.save();
          }
        }

        if (purposeEditorRef.current?.isDirty()) {
          const ok = await purposeEditorRef.current.save();
          if (!ok) return false;
        }

        setDirty(false);
        setScoringDirty(false);
        setPurposeDirty(false);
        await refetch();
        queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
        return true;
      }
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.project.messages.saveFailed')));
      return false;
    }
  };

  const handleScoringAutosave = React.useCallback(async () => {
    if (isCreate || !canManage) {
      return;
    }
    if (scoringAutosaveInFlightRef.current) {
      return;
    }
    const editor = scoringEditorRef.current;
    if (!editor?.isDirty()) {
      setScoringDirty(false);
      return;
    }

    scoringAutosaveInFlightRef.current = true;
    setSaveError(null);
    try {
      const nextScore = await editor.save();
      const scoringPatch = {
        ...editor.getSnapshot(),
        priority_score: nextScore,
      };
      setForm((prev: any) => ({ ...prev, ...scoringPatch }));
      setScoringDirty(false);
      queryClient.setQueriesData({ queryKey: ['portfolio-project', id] }, (old: any) => (
        old ? { ...old, ...scoringPatch } : old
      ));
      queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.project.messages.saveFailed')));
    } finally {
      scoringAutosaveInFlightRef.current = false;
    }
  }, [canManage, id, isCreate, queryClient, t]);

  React.useEffect(() => {
    if (scoringAutosaveTimerRef.current !== null) {
      window.clearTimeout(scoringAutosaveTimerRef.current);
      scoringAutosaveTimerRef.current = null;
    }
    if (!scoringDirty || isCreate || !canManage) return;

    scoringAutosaveTimerRef.current = window.setTimeout(() => {
      scoringAutosaveTimerRef.current = null;
      void handleScoringAutosave();
    }, 900);

    return () => {
      if (scoringAutosaveTimerRef.current !== null) {
        window.clearTimeout(scoringAutosaveTimerRef.current);
        scoringAutosaveTimerRef.current = null;
      }
    };
  }, [canManage, handleScoringAutosave, isCreate, scoringDirty]);

  const handleReset = async () => {
    if (data) {
      setForm({ ...data });
    } else {
      setForm(isCreate ? { origin: 'fast_track' } : {});
    }
    setDirty(false);
    setScoringDirty(false);
    setPurposeDirty(false);
    setSaveError(null);
    scoringEditorRef.current?.reset?.();
    await purposeEditorRef.current?.reset?.();
    classificationTouchedRef.current = {
      source_id: false,
      category_id: false,
      stream_id: false,
      company_id: false,
    };
    defaultsAppliedRef.current = false;
  };

  // Handle status change - show dialog for decision logging
  const handleStatusChange = React.useCallback((newStatus: string) => {
    if (newStatus === form?.status) return;
    setPendingStatus(newStatus);
    setStatusDialogOpen(true);
  }, [form?.status]);

  const handleStatusDialogConfirm = React.useCallback(async (options: {
    isDecision: boolean;
    outcome?: string;
    context?: string;
    rationale?: string;
  }) => {
    if (!pendingStatus) return;

    setStatusDialogOpen(false);
    setSaveError(null);

    try {
      await api.patch(`/portfolio/projects/${id}`, {
        status: pendingStatus,
        is_decision: options.isDecision,
        decision_outcome: options.outcome,
        decision_context: options.context,
        decision_rationale: options.rationale,
      });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.project.messages.updateStatusFailed')));
    } finally {
      setPendingStatus(null);
    }
  }, [id, pendingStatus, refetch, queryClient, t]);

  const handleStatusDialogCancel = React.useCallback(() => {
    setStatusDialogOpen(false);
    setPendingStatus(null);
  }, []);

  const handleAddComment = React.useCallback(async (data: {
    content: string;
    context: string | null;
    is_decision: boolean;
    decision_outcome?: string;
    new_status?: string;
  }) => {
    await api.post(`/portfolio/projects/${id}/comments`, data);
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
  }, [id, refetch, queryClient]);

  const handleUpdateComment = React.useCallback(async (activityId: string, content: string) => {
    await api.patch(`/portfolio/projects/${id}/comments/${activityId}`, { content });
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
  }, [id, refetch, queryClient]);

  // Handle inline image upload for rich text fields
  const handleImageUpload = React.useCallback(async (file: File, sourceField: string): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('source_field', sourceField);
    const res = await api.post<{ id: string }>(`/portfolio/projects/${id}/attachments/inline`, formData);
    return buildInlineImageUrl(`/portfolio/projects/inline/${inlineImageTenantSlug}/${res.data.id}`);
  }, [id, inlineImageTenantSlug]);

  const handleImageUrlImport = React.useCallback(async (sourceUrl: string, sourceField: string): Promise<string> => {
    const res = await api.post<{ id: string }>(`/portfolio/projects/${id}/attachments/inline/import`, {
      source_field: sourceField,
      source_url: sourceUrl,
    });
    return buildInlineImageUrl(`/portfolio/projects/inline/${inlineImageTenantSlug}/${res.data.id}`);
  }, [id, inlineImageTenantSlug]);

  const onTabChange = async (_: React.SyntheticEvent, nextValue: TabKey) => {
    if (isCreate && nextValue !== 'summary') return;
    if (hasUnsavedChanges) {
      const proceed = await dialogs.confirm(t('portfolio:workspace.project.confirmations.unsavedSwitchTabs'));
      if (proceed) {
        void handleSave().then((ok) => {
          if (ok) navigate(`/portfolio/projects/${id}/${nextValue}?${searchParams.toString()}`);
        });
        return;
      } else {
        void handleReset();
      }
    }
    navigate(`/portfolio/projects/${id}/${nextValue}?${searchParams.toString()}`);
  };

  const hasPageDirtyChanges = dirty || scoringDirty;
  const hasUnsavedChanges = hasPageDirtyChanges || purposeDirty;
  const canSaveManagedDocsOnly = !hasPageDirtyChanges && purposeDirty && canContributeToProject;
  const saveDisabled = !hasUnsavedChanges || (!canManage && !canSaveManagedDocsOnly);

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    const sort = searchParams.get('sort');
    const q = searchParams.get('q');
    const projectScope = searchParams.get('projectScope');
    const involvedUserId = searchParams.get('involvedUserId');
    const involvedTeamId = searchParams.get('involvedTeamId');
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    carryListFilters(sp, searchParams);
    if (projectScope) sp.set('projectScope', projectScope);
    if (involvedUserId) sp.set('involvedUserId', involvedUserId);
    if (involvedTeamId) sp.set('involvedTeamId', involvedTeamId);
    return sp;
  }, [searchParams]);

  const taskWorkspaceContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    const sort = searchParams.get('sort');
    const q = searchParams.get('q');
    const filters = searchParams.get('filters');
    const projectScope = searchParams.get('projectScope');
    const involvedUserId = searchParams.get('involvedUserId');
    const involvedTeamId = searchParams.get('involvedTeamId');
    sp.set('projectId', form?.id || id);
    if (sort) sp.set('projectSort', sort);
    if (q) sp.set('projectQ', q);
    if (filters) sp.set('projectFilters', filters);
    if (projectScope) sp.set('projectScope', projectScope);
    if (involvedUserId) sp.set('projectInvolvedUserId', involvedUserId);
    if (involvedTeamId) sp.set('projectInvolvedTeamId', involvedTeamId);
    sp.set('projectTab', routeTab || 'tasks');
    return sp;
  }, [form?.id, id, routeTab, searchParams]);

  const navigateWithTaskWorkspaceContext = React.useCallback((path: string) => {
    if (!path.startsWith('/portfolio/tasks/')) {
      navigate(path);
      return;
    }
    const [pathname, search = ''] = path.split('?');
    const sp = new URLSearchParams(search);
    taskWorkspaceContextParams.forEach((value, key) => {
      if (!sp.has(key)) sp.set(key, value);
    });
    const qs = sp.toString();
    navigate(`${pathname}${qs ? `?${qs}` : ''}`);
  }, [navigate, taskWorkspaceContextParams]);

  // Navigation for prev/next
  const sort = searchParams.get('sort') || 'priority_score:DESC';
  const q = searchParams.get('q') || '';
  const filters = searchParams.get('filters') || '';
  const involvedUserId = searchParams.get('involvedUserId') || undefined;
  const involvedTeamId = searchParams.get('involvedTeamId') || undefined;
  const navExtraParams = React.useMemo(() => {
    const params: Record<string, string | undefined> = {};
    if (involvedUserId) params.involvedUserId = involvedUserId;
    if (involvedTeamId) params.involvedTeamId = involvedTeamId;
    return Object.keys(params).length > 0 ? params : undefined;
  }, [involvedUserId, involvedTeamId]);
  const navCurrentId = projectMatchesCurrentRoute ? data?.id || '' : '';
  const nav = useProjectNav({ id: navCurrentId, sort, q, filters, extraParams: navExtraParams });
  const { total, index, hasPrev, hasNext, prevId, nextId } = isCreate
    ? { total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null as any, nextId: null as any }
    : nav;

  const confirmAndNavigate = React.useCallback(async (targetId: string | null) => {
    if (!targetId) return;
    if (hasUnsavedChanges) {
      const proceed = await dialogs.confirm(t('portfolio:workspace.project.confirmations.unsavedNavigate'));
      if (proceed) {
        const ok = await handleSave();
        if (!ok) return;
      } else {
        await handleReset();
      }
    }
    const qs = listContextParams.toString();
    navigate(`/portfolio/projects/${targetId}/${routeTab}${qs ? `?${qs}` : ''}`);
  }, [dialogs, handleSave, handleReset, hasUnsavedChanges, listContextParams, navigate, routeTab, t]);

  const closeWorkspace = React.useCallback(async () => {
    if (hasUnsavedChanges) {
      const proceed = await dialogs.confirm(t('portfolio:workspace.project.confirmations.unsavedNavigate'));
      if (proceed) {
        const ok = await handleSave();
        if (!ok) return;
      } else {
        await handleReset();
      }
    }
    const qs = listContextParams.toString();
    navigate(`/portfolio/projects${qs ? `?${qs}` : ''}`);
  }, [dialogs, handleSave, handleReset, hasUnsavedChanges, listContextParams, navigate, t]);

  const statusLabel = form?.status ? getProjectStatusLabel(t, form.status) : '';
  const statusColor = (PROJECT_STATUS_COLORS[form?.status] || 'default') as 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
  const statusDotColor = getDotColor(statusColor, theme.palette.mode);
  const statusMenuOptions = statusOptions.map((option) => {
    const optionColor = (PROJECT_STATUS_COLORS[option.value] || 'default') as 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
    return {
      ...option,
      color: getDotColor(optionColor, theme.palette.mode),
    };
  });
  const projectReference = data?.item_number ? `PRJ-${data.item_number}` : null;
  const scoreColor = getScoreColor(Number(form?.priority_score || 0), theme.palette.mode);
  const plannedEndLabel = formatDate(locale, form?.planned_end);
  const sourceRequest = Array.isArray(form?.source_requests) ? form.source_requests[0] : null;
  const sourceRequestReference = sourceRequest?.item_number
    ? `REQ-${sourceRequest.item_number}`
    : null;
  const createDisabled = !String(form?.name || '').trim() || saveDisabled;
  const originLabel = originLabels[form?.origin] || form?.origin || '';
  if (!isCreate && isLoading && !data) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary">
          {t('portfolio:workspace.project.messages.loading')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!!error && <Alert severity="error" sx={{ mx: 2, mt: 1 }}>{t('portfolio:workspace.project.messages.loadFailed')}</Alert>}
      {!!saveError && <Alert severity="error" sx={{ mx: 2, mt: 1 }}>{saveError}</Alert>}

      <PortfolioDetailWorkspaceShell
        activeTab={routeTab}
        tabs={tabs.map((tab) => ({
          ...tab,
          badge: tab.key === 'tasks'
            ? projectTasksCountQuery.data ?? 0
            : tab.key === 'relations'
              ? projectRelationsCountQuery.data ?? 0
              : tab.key === 'knowledge'
                ? Number(projectKnowledgeContextQuery.data?.total || 0)
                : undefined,
          disabled: isCreate && tab.key !== 'summary',
        }))}
        onTabChange={(nextTab) => onTabChange(null as any, nextTab as TabKey)}
        drawerStorageKey="kanap.project.drawerOpen"
        backLabel={t('portfolio:projects.entityName')}
        onBack={() => { void closeWorkspace(); }}
        itemReference={projectReference}
        onCopyReference={projectReference ? () => { void navigator.clipboard?.writeText(projectReference); } : undefined}
        title={form?.name || ''}
        titleFallback={isCreate ? t('portfolio:workspace.project.title.new') : t('portfolio:workspace.project.title.fallback')}
        canEditTitle={isCreate || canManage}
        onTitleSave={(value) => { void persistPanelPatch({ name: value }); }}
        nav={!isCreate && total > 0 ? {
          currentIndex: index + 1,
          totalCount: total,
          hasPrev,
          hasNext,
          onPrev: () => { void confirmAndNavigate(prevId); },
          onNext: () => { void confirmAndNavigate(nextId); },
          previousLabel: t('portfolio:actions.previous'),
          nextLabel: t('portfolio:actions.next'),
        } : undefined}
        onSaveShortcut={hasUnsavedChanges ? () => { void handleSave(); } : undefined}
        metadata={!isCreate ? (
          <>
            {form?.status && (
              <PortfolioStatusMetadata
                value={form.status}
                label={statusLabel}
                color={statusDotColor}
                options={statusMenuOptions}
                onChange={handleStatusChange}
                disabled={!canManage}
              />
            )}
            <PortfolioScoreMetadata
              value={form?.priority_score}
              color={scoreColor}
              title={form?.priority_override ? t('portfolio:workspace.project.priority.overriddenTitle') : t('portfolio:workspace.project.priority.title')}
            />
            <PortfolioProgressMetadata
              label={t('portfolio:workspace.project.summary.fields.executionProgress')}
              value={form?.execution_progress}
            />
            <MetadataUserPicker
              label={t('portfolio:workspace.project.fields.itLead')}
              value={form?.it_lead_id || null}
              displayName={
                form?.it_lead_id && form?.it_lead?.id === form.it_lead_id
                  ? formatMetadataUserName(form.it_lead)
                  : null
              }
              placeholder={t('portfolio:workspace.project.values.itLeadMissing', 'IT lead missing')}
              searchPlaceholder={t('portfolio:workspace.project.fields.itLead')}
              disabled={!canManage}
              onChange={(value) => {
                void (async () => {
                  await persistPanelPatch({ it_lead_id: value });
                  await queryClient.invalidateQueries({ queryKey: ['project-effort-allocations', form.id, 'it'] });
                })();
              }}
            />
            {plannedEndLabel && (
              <PortfolioMetadataItem label={t('portfolio:workspace.project.fields.plannedEnd')}>
                {plannedEndLabel}
              </PortfolioMetadataItem>
            )}
            {originLabel && (
              <PortfolioMetadataItem
                label={t('portfolio:workspace.project.fields.origin')}
                onClick={sourceRequest?.id ? () => navigate(`/portfolio/requests/${sourceRequest.id}/summary`) : undefined}
                title={sourceRequest?.id ? t('portfolio:workspace.project.origin.viewSourceRequest', { name: sourceRequest.name }) : undefined}
                mono={!!sourceRequestReference}
              >
                {sourceRequestReference || originLabel}
              </PortfolioMetadataItem>
            )}
          </>
        ) : undefined}
        actions={(
          <>
            {!isCreate && (
              <SendLinkButton
                itemType="project"
                itemId={form?.id || id}
                itemName={form?.name || t('portfolio:workspace.project.title.fallback')}
                itemNumber={form?.item_number}
              />
            )}
            {isCreate && (
              <Button variant="contained" onClick={() => void handleSave()} disabled={createDisabled} size="small">
                {t('common:buttons.create')}
              </Button>
            )}
            <IconButton
              aria-label={t('common:buttons.close')}
              title={t('common:buttons.close')}
              onClick={() => { void closeWorkspace(); }}
              size="small"
            >
              <CloseIcon />
            </IconButton>
          </>
        )}
        properties={(
          <ProjectPropertyPanel
            canManage={canManage}
            categories={categories}
            form={form}
            focusSection={propertyPanelFocusSection}
            isCreate={isCreate}
            onCategoryChange={(value) => {
              classificationTouchedRef.current.category_id = true;
              classificationTouchedRef.current.stream_id = true;
              void persistPanelPatch({ category_id: value, stream_id: null });
            }}
            onCompanyChange={(value) => {
              classificationTouchedRef.current.company_id = true;
              void persistPanelPatch({ company_id: value });
            }}
            onLocalUpdate={applyPanelLocalUpdate}
            onNameChange={(value) => { void persistPanelPatch({ name: value }); }}
            onOriginChange={(value) => { void persistPanelPatch({ origin: value }); }}
            onPlannedEndChange={(value) => { void persistPanelPatch({ planned_end: value }); }}
            onPlannedStartChange={(value) => { void persistPanelPatch({ planned_start: value }); }}
            onRefetch={refetch}
            onSourceChange={(value) => {
              classificationTouchedRef.current.source_id = true;
              void persistPanelPatch({ source_id: value });
            }}
            onStatusChange={handleStatusChange}
            onStreamChange={(value) => {
              classificationTouchedRef.current.stream_id = true;
              void persistPanelPatch({ stream_id: value });
            }}
            onUpdate={(patch) => { void persistPanelPatch(patch); }}
            originOptions={originOptions}
            originLabels={originLabels}
            sources={sources}
            statusOptions={statusOptions}
            streams={streams}
          />
        )}
      >
        {routeTab === 'summary' && (
          <Stack spacing={3}>
            <ProjectSummaryTab
              canEditManagedDocs={canContributeToProject}
              form={form}
              id={id}
              isCreate={isCreate}
              onPurposeDirtyChange={setPurposeDirty}
              onPurposeDraftChange={(value) => updateManagedDocDraft({ purpose: value })}
              purposeEditorRef={purposeEditorRef}
            />
            {!isCreate && (
              <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.project.loadingTabs.activity')} />}>
                <ProjectActivityTab
                  entityId={form?.id || ''}
                  activities={form?.activities || []}
                  createdAt={form?.created_at || null}
                  createdByName={form?.created_by_name || null}
                  currentStatus={form?.status || ''}
                  allowedTransitions={ALLOWED_TRANSITIONS[form?.status] || []}
                  statusOptions={statusOptions}
                  onAddComment={handleAddComment}
                  onUpdateComment={handleUpdateComment}
                  currentUserId={profile?.id}
                  readOnly={!canManage}
                  onImageUpload={handleImageUpload}
                  onImageUrlImport={handleImageUrlImport}
                />
              </React.Suspense>
            )}
          </Stack>
        )}

        {routeTab === 'scoring' && !isCreate && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.project.loadingTabs.scoring')} />}>
            <ProjectScoringTab
              form={form}
              mandatoryBypassEnabled={portfolioSettings?.mandatory_bypass_enabled ?? false}
              onDirtyChange={setScoringDirty}
              onScoreChange={(newScore) => setForm((prev: any) => ({ ...prev, priority_score: newScore }))}
              readOnly={!canManage}
              scoringEditorRef={scoringEditorRef}
            />
          </React.Suspense>
        )}

        {routeTab === 'timeline' && !isCreate && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.project.loadingTabs.timeline')} />}>
            <ProjectTimelineTab
              canManage={canManage}
              form={form}
              projectId={id}
              onError={setSaveError}
              onNavigateToTask={navigateWithTaskWorkspaceContext}
              onRefetch={refetch}
              onSetForm={setForm}
              onUpdate={update}
            />
          </React.Suspense>
        )}

        {routeTab === 'effort' && !isCreate && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.project.loadingTabs.progress')} />}>
            <ProjectEffortTab
              businessAllocationData={businessAllocationData}
              canContributeToProject={canContributeToProject}
              canManage={canManage}
              canProjectAdmin={canProjectAdmin}
              form={form}
              itAllocationData={itAllocationData}
              onError={setSaveError}
              onRefetch={refetch}
              onRefetchBusinessAlloc={refetchBusinessAlloc}
              onRefetchItAlloc={refetchItAlloc}
              onUpdate={(patch) => { void persistPanelPatch(patch); }}
              profileId={profile?.id}
              projectId={id}
              taskTimeEntries={taskTimeEntries}
              taskTimeSummary={taskTimeSummary}
            />
          </React.Suspense>
        )}

        {routeTab === 'tasks' && !isCreate && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.project.loadingTabs.tasks')} />}>
            <ProjectTasksPanel
              projectId={form?.id || id}
              phases={form?.phases || []}
              disabled={!canManage}
              onTasksChange={() => {
                void projectTasksCountQuery.refetch();
              }}
            />
          </React.Suspense>
        )}

        {routeTab === 'relations' && !isCreate && form?.id && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.project.loadingTabs.relations')} />}>
            <Stack spacing={3}>
              <Stack spacing={1.25}>
                <RelationsSectionTitle>{t('portfolio:workspace.project.sections.dependencies')}</RelationsSectionTitle>
                <DependencySelector
                  entityType="project"
                  entityId={form.id}
                  dependencies={form?.dependencies || []}
                  onAdd={handleAddDependency}
                  onRemove={handleRemoveDependency}
                  disabled={!canManage}
                />
              </Stack>
              <ProjectRelationsPanel
                id={form.id}
                autoSave
                onRelationsChange={() => {
                  void projectRelationsCountQuery.refetch();
                }}
              />
            </Stack>
          </React.Suspense>
        )}

        {routeTab === 'knowledge' && !isCreate && form?.id && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.project.loadingTabs.knowledge')} />}>
            <ProjectKnowledgeTab
              entityId={form.id}
              canCreate={hasLevel('knowledge', 'member')}
            />
          </React.Suspense>
        )}

      </PortfolioDetailWorkspaceShell>

      <StatusChangeDialog
        open={statusDialogOpen}
        currentStatus={form?.status || ''}
        newStatus={pendingStatus || ''}
        onConfirm={handleStatusDialogConfirm}
        onCancel={handleStatusDialogCancel}
      />

    </Box>
  );
}
