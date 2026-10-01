import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Menu, MenuItem, TextField, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  incidentsApi,
  type CreateIncidentInput,
  type Incident,
  type IncidentStatus,
  type UpdateIncidentInput,
} from '../../api/endpoints/incidents';
import { useAuth } from '../../auth/AuthContext';
import { PropertyRow, StatusDot, useKanapDialogs } from '../../components/design';
import EntityKnowledgePanel from '../../components/EntityKnowledgePanel';
import type {
  IntegratedDocumentEditorHandle,
  IntegratedDocumentSaveStatus,
} from '../../components/IntegratedDocumentEditor';
import useAutosave, { autosaveErrorMessage } from '../../hooks/useAutosave';
import { sendPatchBuffer, usePatchBuffer } from '../../hooks/patchBuffer';
import { useIncidentItemNav } from '../../hooks/useModuleItemNav';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { drawerFieldValueSx, drawerMenuItemSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { downloadBlob } from '../../utils/downloadBlob';
import { formatItemRef } from '../../utils/item-ref';
import { getDotColor, INCIDENT_STATUS_COLORS } from '../../utils/statusColors';
import ForbiddenPage from '../ForbiddenPage';
import PortfolioDetailWorkspaceShell, {
  type PortfolioDetailWorkspaceTab,
} from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import IncidentAttachmentsTab from './workspace/IncidentAttachmentsTab';
import IncidentJournalTab, { incidentEntriesQueryKey } from './workspace/IncidentJournalTab';
import IncidentMetadataBar from './workspace/IncidentMetadataBar';
import IncidentOverviewTab from './workspace/IncidentOverviewTab';
import IncidentPropertiesDrawer, {
  type IncidentDrawerPatch,
  type IncidentDrawerValues,
} from './workspace/IncidentPropertiesDrawer';
import IncidentRelationsTab from './workspace/IncidentRelationsTab';
import {
  INCIDENT_STATUS_FLOW,
  incidentComposerSx,
  incidentSectionLabelSx,
  incidentStatusLabel,
  isForwardStatusMove,
  isIncidentLocked,
} from './workspace/incidentWorkspace';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';

const TAB_KEYS = ['overview', 'journal', 'relations', 'documents', 'attachments'] as const;
type TabKey = (typeof TAB_KEYS)[number];

type CreateForm = IncidentDrawerValues & { title: string; description: string };

const UUID_ROUTE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** Fields that freeze the review or can take the viewer's access away. */
const ACCESS_SENSITIVE_FIELDS: Array<keyof UpdateIncidentInput> = [
  'status',
  'confidential',
  'owner_user_id',
  'reporter_user_id',
];

function patchNeedsFlush(patch: UpdateIncidentInput): boolean {
  return ACCESS_SENSITIVE_FIELDS.some((field) => field in patch);
}

export function IncidentWorkspacePage() {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel, profile } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const dialogs = useKanapDialogs();
  const theme = useTheme();
  const locale = useLocale();

  const routeId = String(params.id || '');
  const isCreate = routeId === 'new';
  const rawTab = params.tab as TabKey | undefined;
  const validTab: TabKey = rawTab && TAB_KEYS.includes(rawTab) ? rawTab : 'overview';

  const canView = hasLevel('incidents', 'reader');
  const canEdit = hasLevel('incidents', 'contributor');
  const isAdmin = hasLevel('incidents', 'admin');

  const queryKey = React.useMemo(() => ['incident', routeId] as const, [routeId]);
  const { data, isPlaceholderData, error: loadError } = useQuery({
    queryKey,
    queryFn: () => incidentsApi.get(routeId),
    enabled: !isCreate && canView,
    placeholderData: (previous) => previous,
  });
  const stale = isPlaceholderData;
  const locked = !!data && isIncidentLocked(data.status);
  const editable = !!data && canEdit && !locked && !stale;
  const reference = data ? formatItemRef('incident', data.item_number) : null;
  const { addToRecent } = useRecentlyViewed();
  React.useEffect(() => {
    if (!isCreate && !stale && data?.id && data?.title) addToRecent('incident', data.id, data.title, reference || undefined);
  }, [addToRecent, data?.id, data?.title, isCreate, reference, stale]);
  const workspaceRouteId = isCreate ? 'new' : (!stale && reference) || routeId;

  const [error, setError] = React.useState<string | null>(null);
  const [statusAnchor, setStatusAnchor] = React.useState<HTMLElement | null>(null);
  const [createForm, setCreateForm] = React.useState<CreateForm>(() => ({
    title: '',
    description: '',
    category: null,
    severity: '',
    status: 'open',
    started_at: null,
    detected_at: new Date().toISOString(),
    resolved_at: null,
    closed_at: null,
    reporter_user_id: profile?.id ?? null,
    owner_user_id: null,
    source_ref: null,
    personal_data_affected: false,
    authority_notification_required: false,
    authority_notified_at: null,
    notified_parties: null,
    confidential: false,
  }));
  const [createSubmitting, setCreateSubmitting] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = React.useState(false);
  // The incident review is an integrated document: its draft lives in the
  // editor, so every controlled transition has to drain it through this handle.
  const reviewEditorRef = React.useRef<IntegratedDocumentEditorHandle>(null);
  const [reviewSaveStatus, setReviewSaveStatus] = React.useState<IntegratedDocumentSaveStatus>('idle');
  const handleReviewSaveStateChange = React.useCallback((status: IntegratedDocumentSaveStatus) => {
    setReviewSaveStatus(status);
  }, []);
  // The editor remounts with the incident (key={data.id}); its hint must not
  // carry over to the next one.
  React.useEffect(() => { setReviewSaveStatus('idle'); }, [routeId]);

  // Normalise a uuid route to the business ref once the incident is known.
  React.useEffect(() => {
    if (isCreate || stale || !reference || !UUID_ROUTE_RE.test(routeId)) return;
    const qs = searchParams.toString();
    window.history.replaceState(null, '', `/it/incidents/${reference}/${validTab}${qs ? `?${qs}` : ''}`);
  }, [isCreate, reference, routeId, searchParams, stale, validTab]);

  const setIncidentCache = React.useCallback((updater: (previous: Incident) => Incident) => {
    queryClient.setQueryData<Incident>(queryKey, (previous) => (previous ? updater(previous) : previous));
  }, [queryClient, queryKey]);

  const invalidateEntries = React.useCallback((incidentId: string) => {
    void queryClient.invalidateQueries({ queryKey: incidentEntriesQueryKey(incidentId) });
  }, [queryClient]);

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of ['sort', 'q', 'filters']) {
      const value = searchParams.get(key);
      if (value) sp.set(key, value);
    }
    return sp;
  }, [searchParams]);

  const viewerLosesAccess = React.useCallback((next: {
    confidential?: boolean;
    reporter_user_id?: string | null;
    owner_user_id?: string | null;
  }) => {
    if (isAdmin || !profile?.id) return false;
    const confidential = next.confidential ?? (isCreate ? createForm.confidential : data?.confidential) ?? false;
    if (!confidential) return false;
    const reporter = next.reporter_user_id !== undefined
      ? next.reporter_user_id
      : (isCreate ? createForm.reporter_user_id : data?.reporter_user_id);
    const owner = next.owner_user_id !== undefined
      ? next.owner_user_id
      : (isCreate ? createForm.owner_user_id : data?.owner_user_id);
    return reporter !== profile.id && owner !== profile.id;
  }, [createForm.confidential, createForm.owner_user_id, createForm.reporter_user_id, data, isAdmin, isCreate, profile?.id]);

  const confirmLoseAccess = React.useCallback(async () => {
    return dialogs.confirm({
      title: t('workspace.incident.dialogs.loseAccessTitle'),
      message: t('workspace.incident.dialogs.loseAccessMessage'),
      confirmLabel: t('common:buttons.continue'),
      intent: 'danger',
    });
  }, [dialogs, t]);

  const leaveRegister = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['incidents-ids'] });
    const qs = listContextParams.toString();
    navigate(`/it/incidents${qs ? `?${qs}` : ''}`, { replace: true });
  }, [listContextParams, navigate, queryClient]);

  // Debounced autosave for long-form text: the cache is patched immediately so
  // the page never redraws from a server round-trip. The fields typed and not
  // saved yet are kept with the incident they were typed on (the page stays
  // mounted from one incident to the next): a field only ever goes to its own
  // incident.
  const patchBuffer = usePatchBuffer<UpdateIncidentInput>();
  const currentIncidentId = data && !stale ? data.id : null;
  /** Every cached copy of one incident (its route may be a reference or a uuid). */
  const ofIncident = React.useCallback(
    (incidentId: string) => ({ queryKey: ['incident'], predicate: (q: { state: { data?: unknown } }) => (q.state.data as Incident | undefined)?.id === incidentId }),
    [],
  );
  const currentIncidentIdRef = React.useRef(currentIncidentId);
  currentIncidentIdRef.current = currentIncidentId;
  // Bumped after a reload of the incident on screen: its description field shows the reloaded value.
  const [descriptionResync, setDescriptionResync] = React.useState(0);
  /** The incident as stored, with the fields still typed and not saved shown over it. */
  const reloadIncident = React.useCallback(async (incidentId: string) => {
    await queryClient.invalidateQueries(ofIncident(incidentId));
    const held = patchBuffer.held(incidentId);
    if (held) queryClient.setQueriesData<Incident>(ofIncident(incidentId), (current) => (current ? { ...current, ...held } : current));
    if (incidentId === currentIncidentIdRef.current) setDescriptionResync((count) => count + 1);
  }, [ofIncident, patchBuffer, queryClient]);
  const handleAutosaveError = React.useCallback((e: unknown) => {
    // A busy save is still kept (the message says it is not saved yet); a refused one was
    // dropped and its incident reloaded (onRefused below).
    setError(autosaveErrorMessage(e, t, t('workspace.incident.messages.saveFailed')));
  }, [t]);
  const { schedule: scheduleSave, flush: flushSave, status: autosaveStatus, isBusy: isSaveBusy, discard: discardSave } = useAutosave({
    onError: handleAutosaveError,
  });

  const flushPending = React.useCallback(() => sendPatchBuffer(
    patchBuffer,
    async (incidentId, patch) => {
      const saved = await incidentsApi.update(incidentId, patch);
      queryClient.setQueriesData<Incident>(
        ofIncident(incidentId),
        (current) => (current ? { ...current, ...patch, updated_at: saved.updated_at } : current),
      );
    },
    { onRefused: (incidentId) => { void reloadIncident(incidentId); } },
  ), [ofIncident, patchBuffer, queryClient, reloadIncident]);

  const patchDebounced = React.useCallback((patch: UpdateIncidentInput) => {
    if (!editable || !currentIncidentId) return;
    setIncidentCache((current) => ({ ...current, ...patch }));
    patchBuffer.add(currentIncidentId, patch);
    scheduleSave(flushPending);
  }, [currentIncidentId, editable, flushPending, patchBuffer, scheduleSave, setIncidentCache]);

  // An edit still pending for the previous incident (prev/next, back button) goes to that incident now.
  React.useEffect(() => {
    if (currentIncidentId && patchBuffer.holdsOtherThan(currentIncidentId)) void flushSave();
  }, [currentIncidentId, flushSave, patchBuffer]);

  /**
   * Drains both drafts of the overview tab — the debounced property autosave and
   * the incident review document, including a request already in flight — before
   * a transition. Returns false when anything failed: the caller then aborts and
   * the draft stays in place.
   */
  const flushAll = React.useCallback(async (): Promise<boolean> => {
    const propertiesSaved = await flushSave();
    const reviewSaved = reviewEditorRef.current ? await reviewEditorRef.current.save() : true;
    if (propertiesSaved && reviewSaved) return true;
    if (!reviewSaved) setError(t('workspace.incident.messages.reviewSaveFailed'));
    // A property save refused for good was dropped and the incident reloaded:
    // nothing of it is left to lose, the message says why.
    const propertiesKept = !propertiesSaved && isSaveBusy();
    if (reviewSaved && !propertiesKept) return false;
    // Some failures never clear on a retry: the incident was closed elsewhere,
    // the edit lock was taken over, the server stays busy. Without a way out
    // the user is stuck on this incident, unable to close it, change tab or
    // navigate away.
    const discard = await dialogs.confirm(reviewSaved
      ? {
        title: t('common:autosave.leaveTitle'),
        message: t('common:autosave.leaveMessage'),
        confirmLabel: t('common:autosave.leaveConfirm'),
        intent: 'danger',
      }
      : {
        title: t('workspace.incident.dialogs.discardReviewTitle'),
        message: t('workspace.incident.dialogs.discardReviewMessage'),
        confirmLabel: t('workspace.incident.dialogs.discardReviewConfirm'),
        intent: 'danger',
      });
    if (!discard) return false;
    if (!reviewSaved) await reviewEditorRef.current?.reset();
    if (propertiesKept) {
      // Dropped for every incident: none of it may reach the server later, on any incident.
      const incidents = new Set([...patchBuffer.targets(), ...(currentIncidentId ? [currentIncidentId] : [])]);
      discardSave();
      patchBuffer.discard();
      for (const incidentId of incidents) void reloadIncident(incidentId);
    }
    setError(null);
    return true;
  }, [currentIncidentId, dialogs, discardSave, flushSave, isSaveBusy, patchBuffer, reloadIncident, t]);

  /**
   * The row the optimistic update rolls back to. Read after the flush, never
   * from the render that started the transition: flushing writes the saved
   * review and the drained property patch into the cache, so the render-time
   * `data` is already one revision behind by the time a rollback would use it.
   */
  const rollbackSnapshot = React.useCallback(
    () => queryClient.getQueryData<Incident>(queryKey) ?? data,
    [data, queryClient, queryKey],
  );

  const patchNow = React.useCallback(async (patch: UpdateIncidentInput) => {
    if (!data || stale) return;
    // A status/access change freezes or hides the review: persist the draft
    // before the PATCH and the optimistic update, and abort when it fails.
    if (patchNeedsFlush(patch) && !(await flushAll())) return;
    if (viewerLosesAccess(patch) && !(await confirmLoseAccess())) return;
    const previous = rollbackSnapshot();
    if (!previous) return;
    setIncidentCache((current) => ({ ...current, ...patch }));
    setError(null);
    try {
      const saved = await incidentsApi.update(previous.id, patch);
      setIncidentCache(() => saved);
      if ('status' in patch || 'severity' in patch) invalidateEntries(previous.id);
      if (viewerLosesAccess(saved)) leaveRegister();
    } catch (e) {
      setIncidentCache(() => previous);
      setError(getApiErrorMessage(e, t, t('workspace.incident.messages.saveFailed')));
    }
  }, [confirmLoseAccess, data, flushAll, invalidateEntries, leaveRegister, rollbackSnapshot, setIncidentCache, stale, t, viewerLosesAccess]);

  const handleClose = React.useCallback(async () => {
    if (!(await flushAll())) return;
    const qs = listContextParams.toString();
    navigate(`/it/incidents${qs ? `?${qs}` : ''}`);
  }, [flushAll, listContextParams, navigate]);

  const handleTabChange = React.useCallback(async (nextTab: string) => {
    if (nextTab === validTab) return;
    if (!(await flushAll())) return;
    if (validTab === 'documents') void queryClient.invalidateQueries({ queryKey });
    const qs = searchParams.toString();
    navigate(`/it/incidents/${workspaceRouteId}/${nextTab}${qs ? `?${qs}` : ''}`);
  }, [flushAll, navigate, queryClient, queryKey, searchParams, validTab, workspaceRouteId]);

  const navState = useIncidentItemNav({
    id: data && !stale ? data.id : '',
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    enabled: !isCreate && canView,
  });
  const goToIncident = React.useCallback(async (target: string | null) => {
    if (!target) return;
    if (!(await flushAll())) return;
    const qs = searchParams.toString();
    navigate(`/it/incidents/${target}/${validTab}${qs ? `?${qs}` : ''}`);
  }, [flushAll, navigate, searchParams, validTab]);

  const handleTitleSave = React.useCallback((next: string) => {
    const trimmed = next.trim();
    if (!trimmed || !data || trimmed === data.title) return;
    void patchNow({ title: trimmed });
  }, [data, patchNow]);

  const handleConfidentiality = React.useCallback(async (confidential: boolean) => {
    if (!data || stale) return;
    if (!(await flushAll())) return;
    if (viewerLosesAccess({ confidential }) && !(await confirmLoseAccess())) return;
    const previous = rollbackSnapshot();
    if (!previous) return;
    setIncidentCache((current) => ({ ...current, confidential }));
    setError(null);
    try {
      const saved = locked || previous.status === 'closed' || previous.status === 'cancelled'
        ? await incidentsApi.setConfidentiality(previous.id, confidential)
        : await incidentsApi.update(previous.id, { confidential });
      setIncidentCache(() => saved);
      invalidateEntries(previous.id);
      if (viewerLosesAccess(saved)) leaveRegister();
    } catch (e) {
      setIncidentCache(() => previous);
      setError(getApiErrorMessage(e, t, t('workspace.incident.messages.confidentialityFailed')));
    }
  }, [confirmLoseAccess, data, flushAll, invalidateEntries, leaveRegister, locked, rollbackSnapshot, setIncidentCache, stale, t, viewerLosesAccess]);

  const handleDrawerChange = React.useCallback((patch: IncidentDrawerPatch) => {
    if (patch.confidential !== undefined) {
      void handleConfidentiality(patch.confidential);
      return;
    }
    const { severity, detected_at, ...rest } = patch;
    const next: UpdateIncidentInput = { ...rest };
    if (severity) next.severity = severity;
    if (detected_at) next.detected_at = detected_at;
    void patchNow(next);
  }, [handleConfidentiality, patchNow]);

  const handleStatusChange = React.useCallback((next: IncidentStatus) => {
    setStatusAnchor(null);
    if (!data || next === data.status) return;
    void patchNow({ status: next });
  }, [data, patchNow]);

  const handleReopen = React.useCallback(async () => {
    if (!data) return;
    const reason = await dialogs.prompt({
      title: t('workspace.incident.dialogs.reopenTitle'),
      message: t('workspace.incident.dialogs.reopenMessage'),
      placeholder: t('workspace.incident.dialogs.reopenPlaceholder'),
      confirmLabel: t('workspace.incident.dialogs.reopenConfirm'),
      required: true,
    });
    if (!reason?.trim()) return;
    try {
      const saved = await incidentsApi.reopen(data.id, reason.trim());
      setIncidentCache(() => saved);
      invalidateEntries(data.id);
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('workspace.incident.messages.saveFailed')));
    }
  }, [data, dialogs, invalidateEntries, setIncidentCache, t]);

  const handleCancel = React.useCallback(async () => {
    if (!data) return;
    // The prompt comes first: cancelling out of it must not have cost the user
    // their review draft (the flush can end in a discard).
    const reason = await dialogs.prompt({
      title: t('workspace.incident.dialogs.cancelTitle'),
      message: t('workspace.incident.dialogs.cancelMessage'),
      placeholder: t('workspace.incident.dialogs.cancelPlaceholder'),
      confirmLabel: t('workspace.incident.dialogs.cancelConfirm'),
      required: true,
      intent: 'danger',
    });
    if (!reason?.trim()) return;
    // Cancelling freezes the review: persist the draft before the transition.
    if (!(await flushAll())) return;
    try {
      const saved = await incidentsApi.cancel(data.id, reason.trim());
      setIncidentCache(() => saved);
      invalidateEntries(data.id);
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('workspace.incident.messages.saveFailed')));
    }
  }, [data, dialogs, flushAll, invalidateEntries, setIncidentCache, t]);

  const handleCreate = React.useCallback(async () => {
    if (!canEdit || createSubmitting) return;
    const title = createForm.title.trim();
    const severity = createForm.severity;
    const detectedAt = createForm.detected_at;
    if (!title) {
      setCreateError(t('workspace.incident.create.titleRequired'));
      return;
    }
    if (!severity) {
      setCreateError(t('workspace.incident.create.severityRequired'));
      return;
    }
    if (!detectedAt) {
      setCreateError(t('workspace.incident.create.detectedRequired'));
      return;
    }
    if (viewerLosesAccess({
      confidential: createForm.confidential,
      reporter_user_id: createForm.reporter_user_id,
      owner_user_id: createForm.owner_user_id,
    }) && !(await confirmLoseAccess())) {
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const payload: CreateIncidentInput = {
        title,
        severity,
        detected_at: detectedAt,
        category: createForm.category,
        started_at: createForm.started_at,
        reporter_user_id: createForm.reporter_user_id,
        owner_user_id: createForm.owner_user_id,
        source_ref: createForm.source_ref,
        personal_data_affected: createForm.personal_data_affected,
        authority_notification_required: createForm.authority_notification_required,
        authority_notified_at: createForm.authority_notified_at,
        notified_parties: createForm.notified_parties,
        confidential: createForm.confidential,
        description: createForm.description.trim() || null,
      };
      const saved = await incidentsApi.create(payload);
      void queryClient.invalidateQueries({ queryKey: ['incidents-ids'] });
      if (viewerLosesAccess(saved)) {
        leaveRegister();
        return;
      }
      const savedRef = formatItemRef('incident', saved.item_number);
      queryClient.setQueryData<Incident>(['incident', savedRef], saved);
      const qs = listContextParams.toString();
      navigate(`/it/incidents/${savedRef}/overview${qs ? `?${qs}` : ''}`, { replace: true });
    } catch (e) {
      setCreateError(getApiErrorMessage(e, t, t('workspace.incident.messages.createFailed')));
    } finally {
      setCreateSubmitting(false);
    }
  }, [canEdit, confirmLoseAccess, createForm, createSubmitting, leaveRegister, listContextParams, navigate, queryClient, t, viewerLosesAccess]);

  const handleExportPdf = React.useCallback(async () => {
    if (!data || isCreate || exportingPdf) return;
    // The report renders the review document: export what the user just typed.
    if (!(await flushAll())) return;
    setExportingPdf(true);
    try {
      const result = await incidentsApi.exportReport(routeId, locale);
      const fallback = `${formatItemRef('incident', data.item_number)}-incident-report.pdf`;
      downloadBlob(result.blob, result.filename || fallback);
    } catch (e) {
      let message = t('workspace.incident.messages.exportPdfFailed');
      const blobData = (e as { response?: { data?: unknown } })?.response?.data;
      if (blobData instanceof Blob) {
        try {
          const parsed = JSON.parse(await blobData.text()) as { message?: unknown };
          if (typeof parsed?.message === 'string' && parsed.message.trim()) message = parsed.message;
        } catch {
          // keep the fallback
        }
      } else {
        message = getApiErrorMessage(e, t, message);
      }
      await dialogs.alert({ message, intent: 'danger' });
    } finally {
      setExportingPdf(false);
    }
  }, [data, dialogs, exportingPdf, flushAll, isCreate, locale, routeId, t]);

  if (!canView) return <ForbiddenPage />;

  const { total, index, hasPrev, hasNext, prevId, nextId } = navState;
  const counts = data?.counts;
  const tabs: PortfolioDetailWorkspaceTab[] = [
    { key: 'overview', label: t('workspace.incident.tabs.overview') },
    { key: 'journal', label: t('workspace.incident.tabs.journal'), badge: counts?.entries || undefined, disabled: isCreate },
    {
      key: 'relations',
      label: t('workspace.incident.tabs.relations'),
      badge: counts ? (counts.assets + counts.applications + counts.tasks) || undefined : undefined,
      disabled: isCreate,
    },
    { key: 'documents', label: t('workspace.incident.tabs.documents'), badge: counts?.documents || undefined, disabled: isCreate },
    { key: 'attachments', label: t('workspace.incident.tabs.attachments'), badge: counts?.attachments || undefined, disabled: isCreate },
  ];

  const saveHint = (status: IntegratedDocumentSaveStatus) => (
    status === 'saving' || status === 'pending'
      ? t('common:status.saving')
      : status === 'saved'
        ? t('common:status.saved')
        : null
  );
  const savingHint = saveHint(autosaveStatus);
  const reviewHint = saveHint(reviewSaveStatus);
  const lockedBanner = data && locked
    ? t(data.status === 'cancelled' ? 'workspace.incident.overview.cancelledBanner' : 'workspace.incident.overview.closedBanner', {
      date: formatShortDate(data.closed_at || data.updated_at, locale, { year: 'always' }),
    })
    : null;

  const statusColor = (status: string) => getDotColor(INCIDENT_STATUS_COLORS[status], theme.palette.mode);

  const actions = (
    <>
      {isCreate && (
        <Button
          variant="contained"
          size="small"
          onClick={() => void handleCreate()}
          disabled={createSubmitting || !canEdit}
        >
          {t('common:buttons.create')}
        </Button>
      )}
      {!isCreate && data && canView && (
        <Button
          variant="action"
          size="small"
          onClick={() => void handleExportPdf()}
          disabled={exportingPdf}
          startIcon={exportingPdf ? <CircularProgress size={14} /> : undefined}
        >
          {t('workspace.incident.actions.exportPdf')}
        </Button>
      )}
      {!isCreate && data && canEdit && !locked && (
        <>
          <Button
            variant="action"
            size="small"
            onClick={(event) => setStatusAnchor(event.currentTarget)}
            disabled={!editable}
            endIcon={<ArrowDropDownIcon sx={{ fontSize: '16px !important' }} />}
            title={t('workspace.incident.actions.changeStatus')}
          >
            <StatusDot color={statusColor(data.status)} size={8} sx={{ mr: '6px' }} />
            {incidentStatusLabel(t, data.status)}
          </Button>
          <Menu anchorEl={statusAnchor} open={!!statusAnchor} onClose={() => setStatusAnchor(null)}>
            {INCIDENT_STATUS_FLOW.map((status) => {
              const forward = isForwardStatusMove(data.status, status);
              return (
                <MenuItem
                  key={status}
                  selected={status === data.status}
                  disabled={!forward}
                  onClick={() => handleStatusChange(status)}
                  sx={{ ...drawerMenuItemSx, gap: '8px' }}
                >
                  <StatusDot color={statusColor(status)} size={8} />
                  {incidentStatusLabel(t, status)}
                  {!forward && (
                    <Box component="span" sx={{ ml: 'auto', pl: 1.5, fontSize: 11, color: 'kanap.text.tertiary' }}>
                      {t('workspace.incident.actions.useReopen')}
                    </Box>
                  )}
                </MenuItem>
              );
            })}
          </Menu>
        </>
      )}
      {!isCreate && data && isAdmin && (data.status === 'resolved' || locked) && (
        <Button variant="action" size="small" onClick={() => void handleReopen()} disabled={stale}>
          {t('workspace.incident.actions.reopen')}
        </Button>
      )}
      {!isCreate && data && isAdmin && !locked && (
        <Button variant="action-danger" size="small" onClick={() => void handleCancel()} disabled={stale}>
          {t('workspace.incident.actions.cancel')}
        </Button>
      )}
    </>
  );

  const properties = isCreate ? (
    <IncidentPropertiesDrawer
      values={createForm}
      isCreate
      disabled={createSubmitting || !canEdit}
      restrictDisabled={createSubmitting || !canEdit}
      onChange={(patch) => setCreateForm((previous) => ({ ...previous, ...patch }))}
    />
  ) : data ? (
    <IncidentPropertiesDrawer
      key={data.id}
      values={data}
      isCreate={false}
      disabled={!editable}
      restrictDisabled={isAdmin ? false : (!editable || !!data.confidential)}
      onChange={handleDrawerChange}
    />
  ) : (
    <Box />
  );

  const metadata = !isCreate && data ? (
    <IncidentMetadataBar
      incident={data}
      disabled={!editable}
      onSeverityChange={(severity) => void patchNow({ severity })}
      onOwnerChange={(owner_user_id) => void patchNow({ owner_user_id })}
      onDetectedAtChange={(detected_at) => void patchNow({ detected_at })}
    />
  ) : undefined;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {loadError && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }}>
          {getApiErrorMessage(loadError, t, t('workspace.incident.messages.loadFailed'))}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      <PortfolioDetailWorkspaceShell
        activeTab={validTab}
        tabs={tabs}
        onTabChange={(next) => { void handleTabChange(next); }}
        drawerStorageKey="kanap.incidents.drawerOpen"
        backLabel={t('workspace.incident.backLabel')}
        onBack={() => { void handleClose(); }}
        itemReference={!isCreate ? reference : null}
        onCopyReference={!isCreate && reference ? () => { void navigator.clipboard?.writeText(reference); } : undefined}
        title={isCreate ? createForm.title : data?.title || ''}
        titleFallback={isCreate ? t('workspace.incident.newTitle') : t('workspace.incident.untitled')}
        canEditTitle={editable}
        onTitleSave={handleTitleSave}
        isCreate={isCreate}
        forceDrawerOpen={isCreate}
        onSaveShortcut={() => { void flushAll(); }}
        nav={!isCreate && total > 0 ? {
          currentIndex: index + 1,
          totalCount: total,
          hasPrev,
          hasNext,
          onPrev: () => { void goToIncident(prevId); },
          onNext: () => { void goToIncident(nextId); },
          previousLabel: t('workspace.incident.previous'),
          nextLabel: t('workspace.incident.next'),
        } : undefined}
        metadata={metadata}
        actions={actions}
        properties={properties}
      >
        {isCreate ? (
          <Box sx={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
            {/* The TextField sizes to the value column: without `fullWidth` it kept the
                browser's intrinsic ~160px input width, far too short for an incident title. */}
            <PropertyRow label={t('workspace.incident.create.title')} required valueSx={{ maxWidth: 340 }}>
              <TextField
                value={createForm.title}
                onChange={(event) => setCreateForm((previous) => ({ ...previous, title: event.target.value }))}
                placeholder={t('workspace.incident.create.titlePlaceholder')}
                required
                fullWidth
                size="small"
                variant="standard"
                sx={drawerFieldValueSx}
                disabled={createSubmitting || !canEdit}
              />
            </PropertyRow>
            <Box>
              <Typography component="label" sx={incidentSectionLabelSx}>
                {t('workspace.incident.create.description')}
              </Typography>
              <TextField
                value={createForm.description}
                onChange={(event) => setCreateForm((previous) => ({ ...previous, description: event.target.value }))}
                multiline
                minRows={4}
                fullWidth
                variant="standard"
                placeholder={t('workspace.incident.overview.descriptionPlaceholder')}
                sx={incidentComposerSx}
                disabled={createSubmitting || !canEdit}
              />
            </Box>
            {createError && <Alert severity="error">{createError}</Alert>}
          </Box>
        ) : !data ? null : (
          <>
            {validTab === 'overview' && (
              <IncidentOverviewTab
                key={data.id}
                incident={data}
                readOnly={!editable}
                lockedBanner={lockedBanner}
                savingHint={savingHint}
                reviewHint={reviewHint}
                reviewEditorRef={reviewEditorRef}
                onReviewSaveStateChange={handleReviewSaveStateChange}
                onPatchDebounced={patchDebounced}
                descriptionResync={descriptionResync}
              />
            )}
            {validTab === 'journal' && (
              <IncidentJournalTab
                key={data.id}
                incidentId={data.id}
                canAdd={editable}
                onEntryAdded={() => setIncidentCache((current) => ({
                  ...current,
                  counts: { ...current.counts, entries: current.counts.entries + 1 },
                }))}
              />
            )}
            {validTab === 'relations' && (
              <IncidentRelationsTab
                key={data.id}
                incidentId={data.id}
                readOnly={!editable}
                onLinksChange={(kind, count) => setIncidentCache((current) => ({
                  ...current,
                  counts: { ...current.counts, [kind]: count },
                }))}
                onTasksChange={() => { void queryClient.invalidateQueries({ queryKey }); }}
              />
            )}
            {validTab === 'documents' && (
              <EntityKnowledgePanel entityType="incidents" entityId={data.id} canCreate={editable} />
            )}
            {validTab === 'attachments' && (
              <IncidentAttachmentsTab
                key={data.id}
                incidentId={data.id}
                canManage={editable}
                onCountChange={(count) => setIncidentCache((current) => ({
                  ...current,
                  counts: { ...current.counts, attachments: count },
                }))}
              />
            )}
          </>
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}

export default IncidentWorkspacePage;
