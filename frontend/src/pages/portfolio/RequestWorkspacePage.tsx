import React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button,
  IconButton, LinearProgress, Stack, Typography, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TransformIcon from '@mui/icons-material/Transform';
import api from '../../api';
import { useNotify } from '../../components/notify/NotifyProvider';
import { formatShortDate } from '../../lib/dateFormat';
import { useRequestNav } from '../../hooks/useRequestNav';
import { useClassificationDefaults } from '../../hooks/useClassificationDefaults';
import { useAuth } from '../../auth/AuthContext';
import ConvertToProjectDialog from './components/ConvertToProjectDialog';
import StatusChangeDialog from './components/StatusChangeDialog';
import RecommendationDialog from './components/RecommendationDialog';
import { type RequestScoringEditorHandle } from './editors/RequestScoringEditor';
import DependencySelector from './components/DependencySelector';
import RelationsSectionTitle from './components/RelationsSectionTitle';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { buildInlineImageUrl, resolveInlineImageTenantSlug } from '../../utils/inlineImageUrls';
import { formatItemRef } from '../../utils/item-ref';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import { type IntegratedDocumentEditorHandle } from '../../components/IntegratedDocumentEditor';
import MetadataUserPicker, { formatMetadataUserName } from '../../components/workspace/MetadataUserPicker';
import PortfolioDetailWorkspaceShell from './workspace/PortfolioDetailWorkspaceShell';
import {
  PortfolioMetadataItem,
  PortfolioScoreMetadata,
  PortfolioStatusMetadata,
} from './workspace/PortfolioMetadataBar';
import RequestPropertyPanel from './workspace/request/RequestPropertyPanel';
import RequestSummaryTab from './workspace/request/RequestSummaryTab';
import WorkspaceTabLoadingFallback from './workspace/WorkspaceTabLoadingFallback';
import { getRequestWorkspaceInclude } from './workspace/workspace-detail-includes';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { formatUserName } from '../../utils/userDisplay';
import { getDotColor, REQUEST_STATUS_COLORS } from '../../utils/statusColors';
import {
  getDecisionOutcomeLabel,
  getRequestStatusLabel,
  getRequestStatusOptions,
} from '../../utils/portfolioI18n';
import { useLocale } from '../../i18n/useLocale';
import { useTenant } from '../../tenant/TenantContext';
import { useRecordTitle } from '../../tenant/workspaceTitle';
import { getScoreColor } from '../tasks/theme/taskDetailTokens';
import { portfolioLinksKey, usePortfolioRelationsBadge } from './workspace/portfolioRelations';
import { KanapDialog, unsavedConfirm, useKanapDialogs } from '../../components/design';
import { carryListFilters } from '../../lib/listContext';
import DeleteIconButton from '../../components/workspace/DeleteIconButton';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import { CreationActions, CreationPreview, useCreationReturn, useRecordCreation, useTitleCreation } from '../../components/workspace/creation';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';

type TabKey = 'summary' | 'analysis' | 'scoring' | 'relations' | 'knowledge' | typeof RECORD_HISTORY_TAB_KEY;
type LegacyPanelRoute = 'overview' | 'activity' | 'team';
type RouteTabKey = TabKey | LegacyPanelRoute;
type DependencyTarget = { type: 'request' | 'project'; id: string; name: string };

const REQUEST_TAB_KEYS: TabKey[] = ['summary', 'analysis', 'scoring', 'relations', 'knowledge', RECORD_HISTORY_TAB_KEY];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending_review: ['candidate', 'approved', 'rejected', 'on_hold'],
  candidate: ['approved', 'rejected', 'on_hold'],
  approved: ['converted'],
  on_hold: ['pending_review', 'candidate', 'rejected'],
  rejected: ['pending_review'],
  converted: [],
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

const ANALYSIS_RECOMMENDATION_CONTEXT = 'analysis recommendation';

const DECISION_OUTCOME_COLORS: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  go: 'success',
  no_go: 'error',
  defer: 'warning',
  need_info: 'info',
  analysis_complete: 'info',
};

function formatDate(locale: string, value?: string | null) {
  return formatShortDate(value, locale, { year: 'always' }) || null;
}

/** The preview of a new request (`CreationPreview`) is out of reach: its handlers never run. */
const ignoreDraftChange = () => undefined;
const ignoreDraftRefetch = async () => undefined;

const RequestAnalysisTab = React.lazy(() => import('./workspace/request/RequestAnalysisTab'));
const RequestActivityTab = React.lazy(() => import('./workspace/request/RequestActivityTab'));
const RequestScoringTab = React.lazy(() => import('./workspace/request/RequestScoringTab'));
const PortfolioRelationsTab = React.lazy(() => import('./workspace/PortfolioRelationsTab'));
const RequestKnowledgeTab = React.lazy(() => import('./workspace/request/RequestKnowledgeTab'));
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;

export default function RequestWorkspacePage() {
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
  const routeTab: TabKey = REQUEST_TAB_KEYS.includes(rawRouteTab as TabKey)
    ? (rawRouteTab as TabKey)
    : 'summary';
  const propertyPanelFocusSection = rawRouteTab === 'team'
    ? rawRouteTab
    : null;
  const requestInclude = React.useMemo(() => getRequestWorkspaceInclude(routeTab), [routeTab]);
  const tabs = React.useMemo<Array<{ key: TabKey; label: string }>>(() => [
    { key: 'summary', label: t('portfolio:labels.summary') },
    { key: 'analysis', label: t('portfolio:labels.analysis') },
    { key: 'scoring', label: t('portfolio:labels.scoring') },
    { key: 'relations', label: t('portfolio:labels.relations') },
    { key: 'knowledge', label: t('portfolio:labels.knowledge') },
    { key: RECORD_HISTORY_TAB_KEY, label: t('portfolio:labels.history') },
  ], [t]);
  const statusOptions = React.useMemo(() => getRequestStatusOptions(t), [t]);

  React.useEffect(() => {
    if (rawRouteTab !== routeTab) {
      navigate(`/portfolio/requests/${id}/summary${location.search}`, { replace: true });
      return;
    }
    if (isCreate && rawRouteTab !== 'summary') {
      navigate(`/portfolio/requests/${id}/summary${location.search}`, { replace: true });
    }
  }, [id, isCreate, location.search, navigate, rawRouteTab, routeTab]);

  // Fetch request data
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['portfolio-request', id, requestInclude],
    queryFn: async () => {
      const res = await api.get(`/portfolio/requests/${id}`, { params: { include: requestInclude } });
      return res.data;
    },
    enabled: !isCreate,
    // Keep the previous request on screen while the next one loads (prev/next,
    // deep-link) so the workspace never blanks to a full-page loading bar.
    placeholderData: (previousData) => previousData,
  });

  // Track recently viewed
  React.useEffect(() => {
    if (data?.id && data?.name) {
      addToRecent('request', data.id, data.name, data.item_number ? `REQ-${data.item_number}` : undefined);
    }
  }, [data?.id, data?.name, data?.item_number, addToRecent]);

  // Browser tab title
  useRecordTitle(data?.item_number && data?.name ? `REQ-${data.item_number} ${data.name}` : null);

  // Replace UUID in URL with human-readable ref
  React.useEffect(() => {
    if (!data?.item_number) return;
    const currentParam = params.id || '';
    const isUuid = /^[0-9a-f]{8}-/.test(currentParam);
    // Only rewrite once the loaded data matches the current route id — during a
    // placeholderData nav, `data` is briefly still the previous item.
    if (isUuid && data.id === currentParam) {
      const ref = formatItemRef('request', data.item_number);
      const newPath = location.pathname.replace(currentParam, ref);
      window.history.replaceState(null, '', newPath + location.search);
    }
  }, [data?.id, data?.item_number, params.id, location.pathname, location.search]);

  const requestMatchesCurrentRoute = React.useMemo(() => {
    const raw = String(idParam || '').trim();
    if (!data || !raw) return false;
    if (data.id && raw.toLowerCase() === String(data.id).toLowerCase()) return true;
    if (data.item_number != null && raw === String(data.item_number)) return true;
    if (data.item_number != null && raw.toUpperCase() === formatItemRef('request', data.item_number)) return true;
    return false;
  }, [data?.id, data?.item_number, idParam]);

  // Fetch classification data (types, categories, streams)
  const { data: classificationData, isError: classificationFailed } = useQuery({
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

  const sources = classificationData?.sources?.filter((t) => t.is_active) || [];
  const categories = classificationData?.categories?.filter((c) => c.is_active) || [];
  const streams = classificationData?.streams?.filter((s) => s.is_active) || [];

  const [form, setForm] = React.useState<any>({});
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [convertDialogOpen, setConvertDialogOpen] = React.useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);
  const [recommendationDialogOpen, setRecommendationDialogOpen] = React.useState(false);
  const notify = useNotify();
  const [highlightLatestRecommendation, setHighlightLatestRecommendation] = React.useState(false);
  const [pendingStatus, setPendingStatus] = React.useState<string | null>(null);
  const scoringEditorRef = React.useRef<RequestScoringEditorHandle>(null);
  const purposeEditorRef = React.useRef<IntegratedDocumentEditorHandle>(null);
  const risksEditorRef = React.useRef<IntegratedDocumentEditorHandle>(null);
  const savedScoreRef = React.useRef<number | null>(null);
  const feasibilityAutosaveTimerRef = React.useRef<number | null>(null);
  const scoringAutosaveTimerRef = React.useRef<number | null>(null);
  const scoringAutosaveInFlightRef = React.useRef(false);
  const canManage = hasLevel('portfolio_requests', 'manager');
  const canEditManagedDocs = hasLevel('portfolio_requests', 'member');
  const canAdmin = hasLevel('portfolio_requests', 'admin');
  const [tabDirty, setTabDirty] = React.useState(false);
  const [scoringDirty, setScoringDirty] = React.useState(false);
  const [purposeDirty, setPurposeDirty] = React.useState(false);
  const [risksDirty, setRisksDirty] = React.useState(false);
  const requestDependenciesCount = Array.isArray(form?.dependencies) ? form.dependencies.length : 0;
  const relationsBadge = usePortfolioRelationsBadge('request', !isCreate ? form?.id : undefined, requestDependenciesCount);
  const requestKnowledgeContextQuery = useQuery<{ total?: number }>({
    queryKey: ['entity-knowledge-context', 'requests', form?.id],
    queryFn: async () => {
      const res = await api.get(`/portfolio/requests/${form.id}/knowledge-context`);
      return res.data;
    },
    enabled: !isCreate && !!form?.id,
  });
  const hasTabDirtyChanges = tabDirty || scoringDirty;
  const hasManagedDocumentChanges = purposeDirty || risksDirty;
  const hasUnsavedChanges = hasTabDirtyChanges || hasManagedDocumentChanges;
  const classificationTouchedRef = React.useRef({
    source_id: false,
    category_id: false,
    stream_id: false,
    company_id: false,
  });
  const defaultsAppliedRef = React.useRef(false);
  const { data: classificationDefaults, isLoading: classificationDefaultsLoading } = useClassificationDefaults();

  React.useEffect(() => {
    // For an existing item, keep the current form until the new data syncs in
    // (effect below) so the header/actions don't blank between items.
    if (isCreate) setForm({});
    setTabDirty(false);
    setScoringDirty(false);
    setPurposeDirty(false);
    setRisksDirty(false);
    setSaveError(null);
    savedScoreRef.current = null;
    if (feasibilityAutosaveTimerRef.current !== null) {
      window.clearTimeout(feasibilityAutosaveTimerRef.current);
      feasibilityAutosaveTimerRef.current = null;
    }
    if (scoringAutosaveTimerRef.current !== null) {
      window.clearTimeout(scoringAutosaveTimerRef.current);
      scoringAutosaveTimerRef.current = null;
    }
    scoringAutosaveInFlightRef.current = false;
    scoringEditorRef.current?.reset?.();
    void Promise.all([
      purposeEditorRef.current?.reset?.(),
      risksEditorRef.current?.reset?.(),
    ]);
  }, [id, isCreate]);

  React.useEffect(() => () => {
    if (feasibilityAutosaveTimerRef.current !== null) {
      window.clearTimeout(feasibilityAutosaveTimerRef.current);
    }
    if (scoringAutosaveTimerRef.current !== null) {
      window.clearTimeout(scoringAutosaveTimerRef.current);
    }
  }, []);

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

  // Sync form with loaded data
  React.useEffect(() => {
    if (data && !isCreate) {
      // If we just saved a score, use that instead of potentially stale data
      if (savedScoreRef.current !== null) {
        setForm({
          ...data,
          priority_score: savedScoreRef.current,
        });
        savedScoreRef.current = null;
      } else {
        setForm({ ...data });
      }
    }
  }, [data, isCreate]);

  React.useEffect(() => {
    if (!highlightLatestRecommendation) return;
    const timer = window.setTimeout(() => setHighlightLatestRecommendation(false), 4500);
    return () => window.clearTimeout(timer);
  }, [highlightLatestRecommendation]);

  const update = React.useCallback((patch: any) => {
    setTabDirty(true);
    setForm((prev: any) => ({ ...prev, ...patch }));
  }, []);

  const updateManagedDocDraft = React.useCallback((patch: any) => {
    if (isCreate) {
      setTabDirty(true);
    }
    setForm((prev: any) => ({ ...prev, ...patch }));
  }, [isCreate]);

  const applyPanelLocalUpdate = React.useCallback((updater: (prev: any) => any) => {
    setForm((prev: any) => updater(prev || {}));
  }, []);

  const persistPanelPatch = React.useCallback(async (patch: Record<string, any>) => {
    if (!isCreate && !canManage) {
      setSaveError(t('portfolio:workspace.request.messages.permissionSavePanel'));
      await refetch();
      return;
    }

    setForm((prev: any) => ({ ...prev, ...patch }));

    if (isCreate) {
      setTabDirty(true);
      return;
    }

    setSaveError(null);
    try {
      await api.patch(`/portfolio/requests/${id}`, patch);
      queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.request.messages.savePanelFailed')));
      await refetch();
    }
  }, [canManage, id, isCreate, queryClient, refetch, t]);

  const handleAddDependency = React.useCallback(async (target: DependencyTarget) => {
    const requestId = form?.id;
    if (!requestId) return;

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
      await api.post(`/portfolio/requests/${requestId}/dependencies`, {
        target_type: target.type,
        target_id: target.id,
      });
      queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.request.messages.savePanelFailed')));
      await refetch();
    }
  }, [form?.id, queryClient, refetch, t]);

  const handleRemoveDependency = React.useCallback(async (targetType: 'request' | 'project', targetId: string) => {
    const requestId = form?.id;
    if (!requestId) return;

    setSaveError(null);
    setForm((prev: any) => ({
      ...prev,
      dependencies: (Array.isArray(prev?.dependencies) ? prev.dependencies : []).filter(
        (dep: any) => !(dep?.target_type === targetType && dep?.target_id === targetId),
      ),
    }));

    try {
      await api.delete(`/portfolio/requests/${requestId}/dependencies/${targetType}/${targetId}`);
      queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.request.messages.savePanelFailed')));
      await refetch();
    }
  }, [form?.id, queryClient, refetch, t]);

  const handleFeasibilityReviewChange = React.useCallback((value: any) => {
    setForm((prev: any) => ({ ...prev, feasibility_review: value }));

    if (isCreate) {
      setTabDirty(true);
      return;
    }
    if (!canManage) return;

    if (feasibilityAutosaveTimerRef.current !== null) {
      window.clearTimeout(feasibilityAutosaveTimerRef.current);
    }

    feasibilityAutosaveTimerRef.current = window.setTimeout(() => {
      setSaveError(null);
      void api.patch(`/portfolio/requests/${id}`, { feasibility_review: value })
        .then(() => {
          setTabDirty(false);
          queryClient.setQueriesData({ queryKey: ['portfolio-request', id] }, (old: any) => (
            old ? { ...old, feasibility_review: value } : old
          ));
          queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
        })
        .catch(async (error) => {
          setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.request.messages.savePanelFailed')));
          await refetch();
        });
    }, 700);
  }, [canManage, id, isCreate, queryClient, refetch, t]);

  // The classification a new request takes from the tenant's defaults (source, category, stream,
  // company), on the fields the person has not set: what the create sends besides the name.
  const withClassificationDefaults = React.useCallback((prev: any) => {
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
  }, [classificationDefaults, streams]);
  // The defaults are read (or could not be): a title committed before waits for this.
  const classificationReady = !classificationDefaultsLoading && (!!classificationData || classificationFailed);

  React.useEffect(() => {
    if (!isCreate || defaultsAppliedRef.current || classificationDefaultsLoading) return;
    if (!classificationData) return;
    setForm(withClassificationDefaults);
    defaultsAppliedRef.current = true;
  }, [
    isCreate,
    classificationDefaultsLoading,
    classificationData,
    withClassificationDefaults,
  ]);

  const handleSave = async (): Promise<boolean> => {
    setSaveError(null);
    if (isCreate) return false;
    try {
      if (!canManage && hasTabDirtyChanges) {
        setSaveError(t('portfolio:workspace.request.messages.permissionSaveWorkspace'));
        return false;
      }

      if (canManage) {
        const requestPayload: Record<string, any> = {};
        const editableFields = ['feasibility_review'];
        for (const field of editableFields) {
          if (Object.prototype.hasOwnProperty.call(form, field)) {
            requestPayload[field] = form[field];
          }
        }
        if (Object.keys(requestPayload).length > 0) {
          await api.patch(`/portfolio/requests/${id}`, requestPayload);
        }

        // Save scoring data if the editor is dirty and store the score for the useEffect.
        if (scoringEditorRef.current?.isDirty()) {
          savedScoreRef.current = await scoringEditorRef.current.save();
        }
      }

      if (purposeEditorRef.current?.isDirty()) {
        const ok = await purposeEditorRef.current.save();
        if (!ok) return false;
      }
      if (risksEditorRef.current?.isDirty()) {
        const ok = await risksEditorRef.current.save();
        if (!ok) return false;
      }

      setTabDirty(false);
      setScoringDirty(false);
      setPurposeDirty(false);
      setRisksDirty(false);
      await refetch();

      queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
      return true;
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.request.messages.saveFailed')));
      return false;
    }
  };

  const handleScoringAutosave = React.useCallback(async () => {
    if (isCreate || !canManage || form?.status === 'converted') {
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
      savedScoreRef.current = nextScore;
      setForm((prev: any) => ({ ...prev, ...scoringPatch }));
      setScoringDirty(false);
      queryClient.setQueriesData({ queryKey: ['portfolio-request', id] }, (old: any) => (
        old ? { ...old, ...scoringPatch } : old
      ));
      queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.request.messages.saveFailed')));
    } finally {
      scoringAutosaveInFlightRef.current = false;
    }
  }, [canManage, form?.status, id, isCreate, queryClient, t]);

  React.useEffect(() => {
    if (scoringAutosaveTimerRef.current !== null) {
      window.clearTimeout(scoringAutosaveTimerRef.current);
      scoringAutosaveTimerRef.current = null;
    }
    if (!scoringDirty || isCreate || !canManage || form?.status === 'converted') return;

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
  }, [canManage, form?.status, handleScoringAutosave, isCreate, scoringDirty]);

  const handleReset = async () => {
    if (data) {
      setForm({ ...data });
    } else {
      setForm({});
    }
    setTabDirty(false);
    setScoringDirty(false);
    setPurposeDirty(false);
    setRisksDirty(false);
    setSaveError(null);
    scoringEditorRef.current?.reset?.();
    await Promise.all([
      purposeEditorRef.current?.reset?.(),
      risksEditorRef.current?.reset?.(),
    ]);
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
      await api.patch(`/portfolio/requests/${id}`, {
        status: pendingStatus,
        is_decision: options.isDecision,
        decision_outcome: options.outcome,
        decision_context: options.context,
        decision_rationale: options.rationale,
      });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.request.messages.updateStatusFailed')));
    } finally {
      setPendingStatus(null);
    }
  }, [id, pendingStatus, refetch, queryClient, t]);

  const handleStatusDialogCancel = React.useCallback(() => {
    setStatusDialogOpen(false);
    setPendingStatus(null);
  }, []);

  const handleDelete = React.useCallback(async () => {
    setDeleteConfirmOpen(false);
    try {
      await api.delete(`/portfolio/requests/${id}`);
      queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
      navigate('/portfolio/requests');
    } catch (error) {
      setSaveError(getApiErrorMessage(error, t, t('portfolio:workspace.request.messages.deleteFailed')));
    }
  }, [id, queryClient, navigate, t]);

  const handleAddComment = React.useCallback(async (data: {
    content: string;
    context: string | null;
    is_decision: boolean;
    decision_outcome?: string;
    new_status?: string;
  }) => {
    await api.post(`/portfolio/requests/${id}/comments`, data);
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
  }, [id, refetch, queryClient]);

  const handleUpdateComment = React.useCallback(async (activityId: string, content: string) => {
    await api.patch(`/portfolio/requests/${id}/comments/${activityId}`, { content });
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['portfolio-requests'] });
  }, [id, refetch, queryClient]);

  const handleOpenRecommendationDialog = React.useCallback(async () => {
    if (hasUnsavedChanges) {
      const proceed = await dialogs.confirm(unsavedConfirm(t, 'saveAndContinue'));
      if (!proceed) return;
      const ok = await handleSave();
      if (!ok) return;
    }
    setRecommendationDialogOpen(true);
  }, [dialogs, handleSave, hasUnsavedChanges, t]);

  const handleSubmitRecommendation = React.useCallback(async (payload: {
    content: string;
    context: string | null;
    is_decision: boolean;
    decision_outcome?: string;
    new_status?: string;
  }) => {
    await handleAddComment(payload);
    setRecommendationDialogOpen(false);
    const outcomeLabel = payload.decision_outcome
      ? getDecisionOutcomeLabel(t, payload.decision_outcome)
      : t('portfolio:workspace.request.messages.recommendationSubmittedFallback');
    notify({ message: t('portfolio:workspace.request.messages.recommendationSubmitted', { outcome: outcomeLabel }) });
    setHighlightLatestRecommendation(true);
  }, [handleAddComment, notify, t]);

  // Handle inline image upload for rich text fields
  const handleImageUpload = React.useCallback(async (file: File, sourceField: string): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('source_field', sourceField);
    const res = await api.post<{ id: string }>(`/portfolio/requests/${id}/attachments/inline`, formData);
    return buildInlineImageUrl(`/portfolio/requests/inline/${inlineImageTenantSlug}/${res.data.id}`);
  }, [id, inlineImageTenantSlug]);

  const handleImageUrlImport = React.useCallback(async (sourceUrl: string, sourceField: string): Promise<string> => {
    const res = await api.post<{ id: string }>(`/portfolio/requests/${id}/attachments/inline/import`, {
      source_field: sourceField,
      source_url: sourceUrl,
    });
    return buildInlineImageUrl(`/portfolio/requests/inline/${inlineImageTenantSlug}/${res.data.id}`);
  }, [id, inlineImageTenantSlug]);

  const onTabChange = async (_: React.SyntheticEvent | null, nextValue: TabKey) => {
    if (isCreate && nextValue !== 'summary') return;
    if (hasUnsavedChanges) {
      const proceed = await dialogs.confirm(unsavedConfirm(t, 'saveAndSwitch'));
      if (proceed) {
        void handleSave().then((ok) => {
          if (ok) navigate(`/portfolio/requests/${id}/${nextValue}?${searchParams.toString()}`);
        });
        return;
      } else {
        void handleReset();
      }
    }
    navigate(`/portfolio/requests/${id}/${nextValue}?${searchParams.toString()}`);
  };

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    const sort = searchParams.get('sort');
    const q = searchParams.get('q');
    const requestScope = searchParams.get('requestScope');
    const involvedUserId = searchParams.get('involvedUserId');
    const involvedTeamId = searchParams.get('involvedTeamId');
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    carryListFilters(sp, searchParams);
    if (requestScope) sp.set('requestScope', requestScope);
    if (involvedUserId) sp.set('involvedUserId', involvedUserId);
    if (involvedTeamId) sp.set('involvedTeamId', involvedTeamId);
    return sp;
  }, [searchParams]);

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
  const navCurrentId = requestMatchesCurrentRoute ? data?.id || '' : '';
  const nav = useRequestNav({ id: navCurrentId, sort, q, filters, extraParams: navExtraParams });
  const { total, index, hasPrev, hasNext, prevId, nextId } = isCreate
    ? { total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null as any, nextId: null as any }
    : nav;

  const confirmAndNavigate = React.useCallback(async (targetId: string | null) => {
    if (!targetId) return;
    if (hasUnsavedChanges) {
      const proceed = await dialogs.confirm(unsavedConfirm(t, 'saveAndLeave'));
      if (proceed) {
        const ok = await handleSave();
        if (!ok) return;
      } else {
        await handleReset();
      }
    }
    const qs = listContextParams.toString();
    navigate(`/portfolio/requests/${targetId}/${routeTab}${qs ? `?${qs}` : ''}`);
  }, [dialogs, handleSave, handleReset, hasUnsavedChanges, listContextParams, navigate, routeTab, t]);

  const listPath = React.useMemo(() => {
    const qs = listContextParams.toString();
    return `/portfolio/requests${qs ? `?${qs}` : ''}`;
  }, [listContextParams]);
  // Where the creation started: a new request left empty, or cancelled, goes back there.
  const creationReturn = useCreationReturn(listPath);
  const creation = useRecordCreation({
    family: 'requests',
    apiBase: '/portfolio/requests',
    recordId: !isCreate && requestMatchesCurrentRoute ? data?.id ?? null : null,
    listPath,
    recordLabel: t('portfolio:workspace.request.creation.record'),
    queryKeyPrefixes: ['portfolio-requests'],
    onError: setSaveError,
  });
  // "Cancel" counts what was written: a purpose still typed is saved first.
  const cancelCreation = React.useCallback(async () => {
    if (purposeEditorRef.current?.isDirty() && !(await purposeEditorRef.current.save())) return;
    await creation.cancelCreation();
  }, [creation]);
  // The name committed in the header creates the request at once, with the classification
  // defaults the form would have sent (once they are read); the page moves to it, every tab open,
  // with Create and Cancel (or closes it, kept, when Create was clicked meanwhile).
  const titleCreation = useTitleCreation<{ id: string; item_number: number }>({
    isCreate,
    requiredMessage: t('common:creation.titleRequired'),
    ready: classificationReady,
    post: async (name) => (await api.post('/portfolio/requests', { ...withClassificationDefaults(form), name })).data,
    onCreated: (created, token, finish) => {
      void queryClient.invalidateQueries({ queryKey: ['portfolio-requests'], refetchType: 'none' });
      if (finish) {
        navigate(creationReturn, { replace: true });
        return;
      }
      creation.startCreation({ recordId: created.id, token, returnTo: creationReturn });
      const reference = formatItemRef('request', created.item_number);
      // The page keeps its header while the full request loads.
      queryClient.setQueryData(['portfolio-request', reference, getRequestWorkspaceInclude('summary')], { activities: [], ...created });
      const qs = searchParams.toString();
      navigate(`/portfolio/requests/${reference}/summary${qs ? `?${qs}` : ''}`, { replace: true });
    },
    errorMessage: (err) => getApiErrorMessage(err, t, t('portfolio:workspace.request.messages.saveFailed')),
    onStart: () => setSaveError(null),
  });

  const closeWorkspace = React.useCallback(async () => {
    // A new request left before it has a name goes back where the creation started.
    if (isCreate) {
      navigate(creationReturn);
      return;
    }
    if (hasUnsavedChanges) {
      const proceed = await dialogs.confirm(unsavedConfirm(t, 'saveAndLeave'));
      if (proceed) {
        const ok = await handleSave();
        if (!ok) return;
      } else {
        await handleReset();
      }
    }
    navigate(listPath);
  }, [creationReturn, dialogs, handleSave, handleReset, hasUnsavedChanges, isCreate, listPath, navigate, t]);

  // Create: on the new page, the title is the only field; on a request being created, what is still
  // being typed is saved, then the request is kept and closed.
  const createAction = React.useCallback(async () => {
    if (isCreate) {
      titleCreation.create();
      return;
    }
    if (purposeEditorRef.current?.isDirty() && !(await purposeEditorRef.current.save())) return;
    if (hasUnsavedChanges && !(await handleSave())) return;
    creation.finishCreation();
  }, [creation, handleSave, hasUnsavedChanges, isCreate, titleCreation]);

  const statusLabel = form?.status ? getRequestStatusLabel(t, form.status) : '';
  const statusColor = (REQUEST_STATUS_COLORS[form?.status] || 'default') as 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info';
  const statusDotColor = getDotColor(statusColor, theme.palette.mode);
  const statusMenuOptions = statusOptions.map((option) => {
    const optionColor = (REQUEST_STATUS_COLORS[option.value] || 'default') as 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info';
    return {
      ...option,
      color: getDotColor(optionColor, theme.palette.mode),
    };
  });
  const requestReference = data?.item_number ? `REQ-${data.item_number}` : null;
  const scoreColor = getScoreColor(Number(form?.priority_score || 0), theme.palette.mode);
  const targetDeliveryDateLabel = formatDate(locale, form?.target_delivery_date);
  const originTaskLabel = form?.origin_task?.item_number
    ? `T-${form.origin_task.item_number}`
    : form?.origin_task?.title || null;
  const categoryName = classificationData?.categories?.find((c) => c.id === form?.category_id)?.name;
  const streamName = classificationData?.streams?.find((s) => s.id === form?.stream_id)?.name;
  const analysisRecommendations = React.useMemo(() => {
    const activities = Array.isArray(form?.activities) ? form.activities : [];
    return activities
      .filter((a: any) => (
        a?.type === 'decision' &&
        String(a?.context || '').trim().toLowerCase() === ANALYSIS_RECOMMENDATION_CONTEXT
      ))
      .sort((a: any, b: any) => {
        const aTime = new Date(a?.created_at || 0).getTime();
        const bTime = new Date(b?.created_at || 0).getTime();
        return bTime - aTime;
      });
  }, [form?.activities]);
  const latestAnalysisRecommendation = analysisRecommendations[0] || null;
  const recommendationButtonLabel = latestAnalysisRecommendation
    ? t('portfolio:workspace.request.actions.submitNewRecommendation')
    : t('portfolio:workspace.request.actions.submitRecommendation');
  const latestRecommendationOutcome = latestAnalysisRecommendation?.decision_outcome
    ? getDecisionOutcomeLabel(t, latestAnalysisRecommendation.decision_outcome)
    : null;
  const latestRecommendationOutcomeColor = latestAnalysisRecommendation?.decision_outcome
    ? (DECISION_OUTCOME_COLORS[latestAnalysisRecommendation.decision_outcome] || 'default')
    : 'default';
  const latestRecommendationAuthor = formatUserName(latestAnalysisRecommendation)
    || t('portfolio:activity.authorUnknown');
  const latestRecommendationCreatedAt = latestAnalysisRecommendation?.created_at
    ? new Date(latestAnalysisRecommendation.created_at).toLocaleString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : '';
  const latestRecommendationStatusChange = latestAnalysisRecommendation?.changed_fields?.status;
  if (!isCreate && isLoading && !data) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary">
          {t('portfolio:workspace.request.messages.loading')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={(error || saveError) ? (
          <>
            {!!error && <Alert severity="error">{t('portfolio:workspace.request.messages.loadFailed')}</Alert>}
            {!!saveError && <Alert severity="error">{saveError}</Alert>}
          </>
        ) : undefined}
        activeTab={routeTab}
        tabs={tabs.map((tab) => ({
          ...tab,
          badge: tab.key === 'relations'
            ? relationsBadge ?? 0
            : tab.key === 'knowledge'
              ? Number(requestKnowledgeContextQuery.data?.total || 0)
              : undefined,
          disabled: isCreate && tab.key !== 'summary',
        }))}
        onTabChange={(nextTab) => onTabChange(null, nextTab as TabKey)}
        drawerStorageKey="kanap.request.drawerOpen"
        backLabel={t('portfolio:requests.backToList')}
        onBack={() => { void closeWorkspace(); }}
        itemReference={requestReference}
        onCopyReference={requestReference ? () => { void navigator.clipboard?.writeText(requestReference); } : undefined}
        title={isCreate ? '' : form?.name || ''}
        titleFallback={isCreate ? t('portfolio:workspace.request.title.new') : t('portfolio:workspace.request.title.fallback')}
        canEditTitle={isCreate || (canManage && form?.status !== 'converted')}
        onTitleSave={(value) => {
          if (isCreate) {
            titleCreation.commit(value);
            return;
          }
          void persistPanelPatch({ name: value });
        }}
        onTitleDraftChange={isCreate ? () => titleCreation.setTitleError(null) : undefined}
        titleError={isCreate ? titleCreation.titleError : undefined}
        titleAutoEdit={isCreate}
        titleOnCancel={isCreate ? () => { void closeWorkspace(); } : undefined}
        titleFocusRequest={titleCreation.focusRequest}
        isCreate={isCreate}
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
        onSaveShortcut={isCreate ? ignoreDraftChange : hasUnsavedChanges ? () => { void handleSave(); } : undefined}
        metadata={isCreate ? (
          // The metadata of the request to be, dimmed like the rest, so the page does not move when it is created.
          <CreationPreview sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'inherit' }}>
            <PortfolioStatusMetadata
              value="pending_review"
              label={getRequestStatusLabel(t, 'pending_review')}
              color={getDotColor((REQUEST_STATUS_COLORS.pending_review || 'default') as 'default', theme.palette.mode)}
              options={statusMenuOptions}
              onChange={() => undefined}
              disabled
            />
            <MetadataUserPicker
              label={t('portfolio:workspace.request.fields.requestor')}
              value={null}
              displayName={formatMetadataUserName(profile) || null}
              placeholder={t('portfolio:workspace.request.values.requestorMissing', 'Requestor missing')}
              searchPlaceholder={t('portfolio:workspace.request.fields.requestor')}
              disabled
              onChange={() => undefined}
            />
            <MetadataUserPicker
              label={t('portfolio:workspace.request.fields.itLead', 'IT owner')}
              value={null}
              displayName={null}
              placeholder={t('portfolio:workspace.request.values.itOwnerMissing')}
              searchPlaceholder={t('portfolio:workspace.request.fields.itLead', 'IT owner')}
              disabled
              onChange={() => undefined}
            />
          </CreationPreview>
        ) : (
          <>
            {form?.status && (
              <PortfolioStatusMetadata
                value={form.status}
                label={statusLabel}
                color={statusDotColor}
                options={statusMenuOptions}
                onChange={handleStatusChange}
                disabled={!canManage || form?.status === 'converted'}
              />
            )}
            <PortfolioScoreMetadata
              value={form?.priority_score}
              color={scoreColor}
              title={form?.priority_override ? t('portfolio:workspace.request.priority.overriddenTitle') : t('portfolio:workspace.request.priority.title')}
            />
            <MetadataUserPicker
              label={t('portfolio:workspace.request.fields.requestor')}
              value={form?.requestor_id || null}
              displayName={
                form?.requestor_id && form?.requestor?.id === form.requestor_id
                  ? formatMetadataUserName(form.requestor)
                  : null
              }
              placeholder={t('portfolio:workspace.request.values.requestorMissing', 'Requestor missing')}
              searchPlaceholder={t('portfolio:workspace.request.fields.requestor')}
              disabled={!canManage || form?.status === 'converted'}
              onChange={(value) => { void persistPanelPatch({ requestor_id: value }); }}
            />
            <MetadataUserPicker
              label={t('portfolio:workspace.request.fields.itLead', 'IT owner')}
              value={form?.it_lead_id || null}
              displayName={
                form?.it_lead_id && form?.it_lead?.id === form.it_lead_id
                  ? formatMetadataUserName(form.it_lead)
                  : null
              }
              placeholder={t('portfolio:workspace.request.values.itOwnerMissing')}
              searchPlaceholder={t('portfolio:workspace.request.fields.itLead', 'IT owner')}
              disabled={!canManage || form?.status === 'converted'}
              onChange={(value) => { void persistPanelPatch({ it_lead_id: value }); }}
            />
            {targetDeliveryDateLabel && (
              <PortfolioMetadataItem label={t('portfolio:workspace.request.fields.targetDeliveryDate')}>
                {targetDeliveryDateLabel}
              </PortfolioMetadataItem>
            )}
            {form?.origin_task?.id && originTaskLabel && (
              <PortfolioMetadataItem
                label={t('portfolio:workspace.request.originTask.sourceLabel')}
                onClick={() => navigate(`/portfolio/tasks/${form.origin_task.id}/overview`)}
                title={t('portfolio:workspace.request.originTask.title', { name: form.origin_task.title || form.origin_task.id })}
                mono={!!form.origin_task.item_number}
              >
                {originTaskLabel}
              </PortfolioMetadataItem>
            )}
          </>
        )}
        actions={(
          <>
            {!isCreate && (
              <SendLinkButton
                itemType="request"
                itemId={form?.id || id}
                itemName={form?.name || t('portfolio:workspace.request.title.fallback')}
                itemNumber={form?.item_number}
              />
            )}
            {!isCreate && (form?.status === 'approved' || form?.status === 'converted') && (
              <Button
                variant="action"
                startIcon={<TransformIcon sx={{ fontSize: '14px !important' }} />}
                onClick={() => setConvertDialogOpen(true)}
                size="small"
              >
                {t('portfolio:actions.convertToProject')}
              </Button>
            )}
            {!isCreate && !creation.beingCreated && canAdmin && form?.status !== 'converted' && (
              <DeleteIconButton onClick={() => setDeleteConfirmOpen(true)} />
            )}
            {isCreate || creation.beingCreated ? (
              <CreationActions
                busy={creation.cancelling}
                writing={titleCreation.writing}
                onCreate={() => { void createAction(); }}
                onCancel={() => { if (isCreate) void closeWorkspace(); else void cancelCreation(); }}
              />
            ) : (
              <IconButton
                aria-label={t('common:buttons.close')}
                title={t('common:buttons.close')}
                onClick={() => { void closeWorkspace(); }}
                size="small"
              >
                <CloseIcon />
              </IconButton>
            )}
          </>
        )}
        properties={isCreate ? (
          <CreationPreview>
            <RequestPropertyPanel
              canManage={canManage}
              categories={categories}
              form={{ status: 'pending_review', requestor_id: profile?.id ?? null, ...form }}
              onCategoryChange={ignoreDraftChange}
              onCompanyChange={ignoreDraftChange}
              onLocalUpdate={ignoreDraftChange}
              onRefetch={ignoreDraftRefetch}
              onRequestorChange={ignoreDraftChange}
              onSourceChange={ignoreDraftChange}
              onStatusChange={ignoreDraftChange}
              onStreamChange={ignoreDraftChange}
              onUpdate={ignoreDraftChange}
              sources={sources}
              statusOptions={statusOptions}
              streams={streams}
            />
          </CreationPreview>
        ) : (
          <RequestPropertyPanel
            canManage={canManage}
            categories={categories}
            form={form}
            focusSection={propertyPanelFocusSection}
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
            onRefetch={refetch}
            onRequestorChange={(value) => { void persistPanelPatch({ requestor_id: value }); }}
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
            sources={sources}
            statusOptions={statusOptions}
            streams={streams}
          />
        )}
      >
        {isCreate && (
          <CreationPreview>
            <RequestSummaryTab
              canEditManagedDocs={canEditManagedDocs}
              form={form}
              id={id}
              isCreate
              onPurposeDirtyChange={ignoreDraftChange}
              onPurposeDraftChange={ignoreDraftChange}
              purposeEditorRef={purposeEditorRef}
            />
          </CreationPreview>
        )}
        {routeTab === 'summary' && !isCreate && (
          <Stack spacing={3}>
            <RequestSummaryTab
              canEditManagedDocs={canEditManagedDocs}
              form={form}
              id={id}
              isCreate={isCreate}
              onPurposeDirtyChange={setPurposeDirty}
              onPurposeDraftChange={(value) => updateManagedDocDraft({ purpose: value })}
              purposeEditorRef={purposeEditorRef}
            />
            {!isCreate && (
              <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.request.loadingTabs.activity')} />}>
                <RequestActivityTab
                  entityId={form?.id || ''}
                  activities={form?.activities || []}
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

        {routeTab === 'analysis' && !isCreate && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.request.loadingTabs.analysis')} />}>
            <RequestAnalysisTab
              canEditManagedDocs={canEditManagedDocs}
              canEditProcesses={canManage && hasLevel('business_processes', 'member')}
              canManage={canManage}
              categoryName={categoryName}
              form={form}
              highlightLatestRecommendation={highlightLatestRecommendation}
              id={id}
              latestAnalysisRecommendation={latestAnalysisRecommendation}
              latestRecommendationAuthor={latestRecommendationAuthor}
              latestRecommendationCreatedAt={latestRecommendationCreatedAt}
              latestRecommendationOutcome={latestRecommendationOutcome}
              latestRecommendationOutcomeColor={latestRecommendationOutcomeColor}
              latestRecommendationStatusChange={latestRecommendationStatusChange}
              onBusinessProcessesChange={async (ids) => {
                await api.post(`/portfolio/requests/${form.id}/business-processes/bulk-replace`, {
                  business_process_ids: ids,
                });
                await refetch();
              }}
              onOpenActivity={() => onTabChange(null, 'summary')}
              onOpenRecommendationDialog={() => { void handleOpenRecommendationDialog(); }}
              onRisksDraftChange={(value) => updateManagedDocDraft({ risks: value })}
              onRisksDirtyChange={setRisksDirty}
              onUpdateFeasibilityReview={handleFeasibilityReviewChange}
              recommendationButtonLabel={recommendationButtonLabel}
              risksEditorRef={risksEditorRef}
              streamName={streamName}
            />
          </React.Suspense>
        )}

        {routeTab === 'scoring' && !isCreate && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.request.loadingTabs.scoring')} />}>
            <RequestScoringTab
              form={form}
              mandatoryBypassEnabled={portfolioSettings?.mandatory_bypass_enabled ?? false}
              onDirtyChange={setScoringDirty}
              onScoreChange={(newScore) => {
                setForm((prev: any) => ({ ...prev, priority_score: newScore }));
              }}
              readOnly={!canManage || form?.status === 'converted'}
              scoringEditorRef={scoringEditorRef}
            />
          </React.Suspense>
        )}

        {routeTab === 'relations' && !isCreate && form?.id && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.request.loadingTabs.relations')} />}>
            <Stack spacing={3}>
              <Stack spacing={1.25}>
                <RelationsSectionTitle>{t('portfolio:workspace.request.sections.dependencies')}</RelationsSectionTitle>
                <DependencySelector
                  entityType="request"
                  entityId={form.id}
                  dependencies={form?.dependencies || []}
                  onAdd={handleAddDependency}
                  onRemove={handleRemoveDependency}
                  disabled={!canManage}
                />
              </Stack>
              <PortfolioRelationsTab
                entity="request"
                id={form.id}
                onRelationsChange={() => {
                  void queryClient.invalidateQueries({ queryKey: portfolioLinksKey('request', form.id) });
                }}
              />
            </Stack>
          </React.Suspense>
        )}

        {routeTab === 'knowledge' && !isCreate && form?.id && (
          <React.Suspense fallback={<WorkspaceTabLoadingFallback label={t('portfolio:workspace.request.loadingTabs.knowledge')} />}>
            <RequestKnowledgeTab
              entityId={form.id}
              canCreate={hasLevel('knowledge', 'member')}
            />
          </React.Suspense>
        )}

        {routeTab === RECORD_HISTORY_TAB_KEY && !isCreate && form?.id && (
          <WorkspaceTabBoundary resetKey={routeTab} onRetry={historyTab.retry}>
            <React.Suspense fallback={null}>
              <HistoryTab key={form.id} table="portfolio_requests" recordId={form.id} />
            </React.Suspense>
          </WorkspaceTabBoundary>
        )}

      </PortfolioDetailWorkspaceShell>

      {!isCreate && form && (
        <ConvertToProjectDialog
          open={convertDialogOpen}
          onClose={() => setConvertDialogOpen(false)}
          request={{
            id: form.id,
            name: form.name || '',
            target_delivery_date: form.target_delivery_date,
          }}
          onSuccess={(projectId) => {
            setConvertDialogOpen(false);
            navigate(`/portfolio/projects/${projectId}/summary`);
          }}
        />
      )}

      <RecommendationDialog
        open={recommendationDialogOpen}
        currentStatus={form?.status || ''}
        allowedTransitions={ALLOWED_TRANSITIONS[form?.status] || []}
        statusOptions={statusOptions}
        priorityScore={form?.priority_score}
        onClose={() => setRecommendationDialogOpen(false)}
        onSubmit={handleSubmitRecommendation}
        onImageUpload={handleImageUpload}
        onImageUrlImport={handleImageUrlImport}
      />

      <StatusChangeDialog
        open={statusDialogOpen}
        currentStatus={form?.status || ''}
        newStatus={pendingStatus || ''}
        onConfirm={handleStatusDialogConfirm}
        onCancel={handleStatusDialogCancel}
      />

      <KanapDialog
        open={deleteConfirmOpen}
        title={data?.name ? t('common:delete.recordTitle', { name: data.name }) : t('portfolio:workspace.request.deleteDialog.title')}
        onClose={() => setDeleteConfirmOpen(false)}
        onSave={() => void handleDelete()}
        saveLabel={t('common:buttons.delete')}
        saveVariant="action-danger"
        cancelLabel={t('common:buttons.cancel')}
      >
        <Typography sx={{ fontSize: 13.5, color: 'kanap.text.primary' }}>
          {t('portfolio:workspace.request.deleteDialog.message', { name: form?.name || t('portfolio:workspace.request.title.fallback') })}
        </Typography>
      </KanapDialog>
    </Box>
  );
}
