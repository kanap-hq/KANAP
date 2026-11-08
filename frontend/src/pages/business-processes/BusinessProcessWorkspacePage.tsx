import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, IconButton, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { useBusinessProcessNav } from '../../hooks/useBusinessProcessNav';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PortfolioMetadataItem, PortfolioStatusMetadata } from '../portfolio/workspace/PortfolioMetadataBar';
import RecordDeleteButton from '../../components/workspace/RecordDeleteButton';
import { CreationActions, CreationPreview, useCreationReturn, useRecordCreation, useTitleCreation } from '../../components/workspace/creation';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';
import { STATUS_DISABLED, STATUS_ENABLED, normalizeStatus, type StatusValue } from '../../constants/status';
import { getApiErrorMessage, isDuplicateError } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';
import BusinessProcessApplicationsSection from './BusinessProcessApplicationsSection';
import {
  BusinessProcessOverview,
  BusinessProcessProperties,
  EMPTY_BUSINESS_PROCESS,
  type BusinessProcess,
  type BusinessProcessPatch,
} from './BusinessProcessFields';

type TabKey = 'overview' | 'relations' | typeof RECORD_HISTORY_TAB_KEY;
const TAB_KEYS: TabKey[] = ['overview', 'relations', RECORD_HISTORY_TAB_KEY];

// The History tab loads its code when opened; a failed load shows a retry in its place.
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;
const LIST_PATH = '/master-data/business-processes';
/** How long Saved stays after a field is saved. */
const SAVED_LINGER_MS = 1500;

/**
 * The preview of a new process (`CreationPreview`) is out of reach: its handlers never run, and
 * its fields are drawn as they will be (not disabled), only dimmed.
 */
const ignore = () => undefined;

export default function BusinessProcessWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const theme = useTheme();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const { addToRecent } = useRecentlyViewed();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const canEdit = hasLevel('business_processes', 'member');
  const canDelete = hasLevel('business_processes', 'admin');
  // The applications of a process show to who reads applications: the Relations tab holds them.
  const canReadApplications = hasLevel('applications', 'reader');
  const rawTab = (params.tab as TabKey) || 'overview';
  const tab: TabKey = TAB_KEYS.includes(rawTab)
    && !(isCreate && rawTab !== 'overview')
    && (rawTab !== 'relations' || canReadApplications)
    ? rawTab
    : 'overview';

  const listContext = React.useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of ['sort', 'q', 'filters', 'scope']) {
      const value = searchParams.get(key);
      if (value) sp.set(key, value);
    }
    return sp.toString();
  }, [searchParams]);
  const withContext = React.useCallback((path: string) => `${path}${listContext ? `?${listContext}` : ''}`, [listContext]);
  const listPath = withContext(LIST_PATH);

  const nav = useBusinessProcessNav({
    id,
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    statusScope: searchParams.get('scope'),
  });

  // Once deleted, the process is never loaded again, even while the page waits for the list.
  const [deletedId, setDeletedId] = React.useState<string | null>(null);
  const { data, error: loadError } = useQuery({
    queryKey: ['business-processes', id],
    queryFn: async () => (await api.get<BusinessProcess>(`/business-processes/${id}`)).data,
    enabled: !isCreate && !!id && deletedId !== id,
  });
  const process = data && data.id === id ? data : undefined;

  React.useEffect(() => {
    if (!isCreate && process?.id && process.name) addToRecent('business_process', process.id, process.name);
  }, [addToRecent, process?.id, process?.name, isCreate]);

  const [saveError, setSaveError] = React.useState<string | null>(null);
  // A refusal of the name given to a process in the header (a name another process has).
  const [titleError, setTitleError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setSaveError(null);
    setTitleError(null);
  }, [id]);

  // Autosave never blocks the fields: writes queue one after the other, so a response never
  // overwrites a newer one, and results for a record the user has left are dropped.
  const chainRef = React.useRef<Promise<boolean>>(Promise.resolve(true));
  const currentIdRef = React.useRef(id);
  currentIdRef.current = id;

  // Fields show Saving, then Saved. A refused save does not.
  const [fieldSaves, setFieldSaves] = React.useState(0);
  const [fieldSaved, setFieldSaved] = React.useState(false);
  const savedTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
  }, []);

  const patch = React.useCallback((body: BusinessProcessPatch): Promise<boolean> => {
    const recordId = process?.id;
    if (!recordId || !canEdit) return Promise.resolve(false);
    if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
    setFieldSaved(false);
    setFieldSaves((n) => n + 1);
    setSaveError(null);
    if (body.name !== undefined) setTitleError(null);
    const run = async (): Promise<boolean> => {
      try {
        const res = await api.patch<BusinessProcess>(`/business-processes/${recordId}`, body);
        queryClient.setQueryData<BusinessProcess>(['business-processes', recordId], (prev) => ({
          ...(prev ?? EMPTY_BUSINESS_PROCESS),
          ...res.data,
        }));
        // The update answers the row alone: a new parent is named by the detail, read again.
        void queryClient.invalidateQueries({
          queryKey: ['business-processes'],
          predicate: (q) => q.queryKey[1] !== recordId || body.parent_id !== undefined,
        });
        return true;
      } catch (e) {
        if (currentIdRef.current !== recordId) return false;
        if (body.name !== undefined) {
          setTitleError(isDuplicateError(e) ? t('businessProcesses.fields.nameTaken') : getApiErrorMessage(e, t, t('shared.messages.failedToSave', { entity: t('businessProcesses.entity') })));
        } else {
          setSaveError(getApiErrorMessage(e, t, t('shared.messages.failedToSave', { entity: t('businessProcesses.entity') })));
        }
        return false;
      }
    };
    const result = chainRef.current.then(run, run);
    chainRef.current = result;
    void result.then((saved) => {
      if (!saved) return;
      setFieldSaved(true);
      savedTimerRef.current = window.setTimeout(() => {
        savedTimerRef.current = null;
        setFieldSaved(false);
      }, SAVED_LINGER_MS);
    }).finally(() => setFieldSaves((n) => n - 1));
    return result;
  }, [canEdit, process?.id, queryClient, t]);
  const onPatch = React.useCallback((body: BusinessProcessPatch) => { void patch(body); }, [patch]);

  // Where the creation started: a new process left empty, or cancelled, goes back there.
  const creationReturn = useCreationReturn(listPath);
  const creation = useRecordCreation({
    family: 'business-processes',
    apiBase: '/business-processes',
    recordId: !isCreate ? process?.id ?? null : null,
    listPath,
    recordLabel: t('businessProcesses.creation.record'),
    queryKeyPrefixes: ['business-processes'],
    onError: setSaveError,
  });
  // The name committed in the header creates the process at once, enabled; the page moves to it,
  // every tab open, with Create and Cancel (or closes it, kept, when Create was clicked meanwhile).
  const titleCreation = useTitleCreation<BusinessProcess>({
    isCreate,
    requiredMessage: t('businessProcesses.fields.nameRequired'),
    post: async (name) => (await api.post<BusinessProcess & { creation_token: string }>('/business-processes', { name })).data,
    onCreated: (created, token, finish) => {
      void queryClient.invalidateQueries({ queryKey: ['business-processes'], refetchType: 'none' });
      if (finish) {
        navigate(creationReturn, { replace: true });
        return;
      }
      creation.startCreation({ recordId: created.id, token, returnTo: creationReturn });
      // The page keeps its header while the process loads again.
      queryClient.setQueryData<BusinessProcess>(['business-processes', created.id], { ...EMPTY_BUSINESS_PROCESS, ...created });
      navigate(withContext(`${LIST_PATH}/${created.id}/overview`), { replace: true });
    },
    errorMessage: (err) => (isDuplicateError(err)
      ? t('businessProcesses.fields.nameTaken')
      : getApiErrorMessage(err, t, t('shared.messages.failedToCreate', { entity: t('businessProcesses.entity') }))),
    onStart: () => setSaveError(null),
  });

  const close = () => navigate(isCreate ? creationReturn : listPath);
  const goTo = (targetId: string | null, nextTab: TabKey = tab) => {
    if (targetId) navigate(withContext(`${LIST_PATH}/${targetId}/${nextTab}`));
  };

  // Create: on the new page, the title is the only field; on a process being created, the field
  // still being typed has left (the click took the focus) and its save is awaited, then the
  // process is kept and closed.
  const createAction = async () => {
    if (isCreate) {
      titleCreation.create();
      return;
    }
    if (!(await chainRef.current)) return;
    creation.finishCreation();
  };
  // Cancel counts what was written: a field still being typed is saved first.
  const cancelAction = async () => {
    if (isCreate) {
      close();
      return;
    }
    await chainRef.current;
    await creation.cancelCreation();
  };

  const disabled = !canEdit;
  const tabs = [
    { key: 'overview', label: t('shared.labels.overview') },
    ...(canReadApplications ? [{ key: 'relations', label: t('businessProcesses.tabs.relations'), disabled: isCreate }] : []),
    { key: RECORD_HISTORY_TAB_KEY, label: t('shared.labels.history'), disabled: isCreate },
  ];

  // The header shows the status: the menu disables at once (end of validity now, set by the
  // server) or enables again (no end of validity).
  const shown = isCreate ? EMPTY_BUSINESS_PROCESS : process;
  const status = normalizeStatus(shown?.status);
  const enabledColor = getDotColor('success', theme.palette.mode);
  const disabledColor = getDotColor('default', theme.palette.mode);
  const statusLabel = (value: StatusValue) => (value === STATUS_DISABLED ? t('common:statuses.disabled') : t('common:statuses.enabled'));
  const changeStatus = (next: StatusValue) => {
    if (!process || next === status) return;
    onPatch(next === STATUS_DISABLED ? { status: STATUS_DISABLED } : { status: STATUS_ENABLED, disabled_at: null });
  };
  const statusItem = shown ? (
    <PortfolioMetadataItem label={t('shared.fields.status')}>
      <PortfolioStatusMetadata
        value={status}
        label={statusLabel(status)}
        color={status === STATUS_DISABLED ? disabledColor : enabledColor}
        options={[
          { value: STATUS_ENABLED, label: statusLabel(STATUS_ENABLED), color: enabledColor },
          { value: STATUS_DISABLED, label: statusLabel(STATUS_DISABLED), color: disabledColor },
        ]}
        onChange={(value) => changeStatus(value as StatusValue)}
        disabled={disabled || isCreate}
      />
    </PortfolioMetadataItem>
  ) : undefined;

  const properties = isCreate ? (
    <CreationPreview>
      <BusinessProcessProperties process={EMPTY_BUSINESS_PROCESS} disabled={false} onPatch={ignore} />
    </CreationPreview>
  ) : process ? (
    <BusinessProcessProperties
      process={process}
      disabled={disabled}
      onPatch={onPatch}
    />
  ) : undefined;

  const beingCreated = isCreate || creation.beingCreated;
  const notices = (loadError || saveError) ? (
    <>
      {!!loadError && <Alert severity="error">{t('businessProcesses.loadError')}</Alert>}
      {!!saveError && <Alert severity="error">{saveError}</Alert>}
    </>
  ) : undefined;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={notices}
        activeTab={tab}
        tabs={tabs}
        onTabChange={(next) => goTo(id, next as TabKey)}
        drawerStorageKey="kanap.businessProcesses.drawerOpen"
        backLabel={t('businessProcesses.title')}
        onBack={close}
        title={isCreate ? '' : process?.name ?? ''}
        titleFallback={isCreate ? t('businessProcesses.newBusinessProcess') : t('businessProcesses.businessProcessFallback')}
        canEditTitle={canEdit}
        readOnly={!isCreate && !!process && !canEdit}
        onTitleSave={(value) => {
          if (isCreate) {
            titleCreation.commit(value);
            return;
          }
          if (value !== process?.name) void patch({ name: value });
        }}
        onTitleDraftChange={() => (isCreate ? titleCreation.setTitleError(null) : setTitleError(null))}
        titleError={isCreate ? titleCreation.titleError : titleError}
        titleAutoEdit={isCreate}
        titleOnCancel={isCreate ? close : undefined}
        titleFocusRequest={titleCreation.focusRequest}
        titleRequiredMessage={t('businessProcesses.fields.nameRequired')}
        isCreate={isCreate}
        forceDrawerOpen={isCreate}
        nav={!isCreate && nav.total > 0 ? {
          currentIndex: nav.index + 1,
          totalCount: nav.total,
          hasPrev: nav.hasPrev,
          hasNext: nav.hasNext,
          onPrev: () => goTo(nav.prevId),
          onNext: () => goTo(nav.nextId),
          previousLabel: t('shared.labels.prev'),
          nextLabel: t('shared.labels.next'),
        } : undefined}
        // Every field saves itself; on the new page the title is the only one.
        onSaveShortcut={ignore}
        metadata={isCreate ? (
          <CreationPreview sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'inherit' }}>
            {statusItem}
          </CreationPreview>
        ) : statusItem}
        actions={(
          <>
            {(fieldSaves > 0 || fieldSaved) && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center' }}>
                {fieldSaves > 0 ? t('common:status.saving') : t('common:status.saved')}
              </Typography>
            )}
            {!beingCreated && process && canDelete && (
              <RecordDeleteButton
                base="/business-processes"
                id={process.id}
                name={process.name}
                deleteFailed="businessProcesses.messages.deleteFailed"
                confirmMessage={t('businessProcesses.deleteWarning', { count: 1 })}
                onDeleted={() => { setDeletedId(process.id); navigate(listPath); }}
              />
            )}
            {beingCreated ? (
              <CreationActions
                busy={creation.cancelling}
                writing={titleCreation.writing}
                onCreate={() => { void createAction(); }}
                onCancel={() => { void cancelAction(); }}
              />
            ) : (
              <IconButton
                aria-label={t('common:buttons.close')}
                title={t('common:buttons.close')}
                onClick={close}
                size="small"
              >
                <CloseIcon />
              </IconButton>
            )}
          </>
        )}
        properties={properties}
      >
        {isCreate && (
          <CreationPreview>
            <BusinessProcessOverview process={EMPTY_BUSINESS_PROCESS} disabled={false} onPatch={ignore} />
          </CreationPreview>
        )}
        {process && tab === 'overview' && (
          // Keyed by process: drafts start afresh on the next record.
          <BusinessProcessOverview key={process.id} process={process} disabled={disabled} onPatch={onPatch} />
        )}
        {process && tab === 'relations' && canReadApplications && (
          <BusinessProcessApplicationsSection id={process.id} />
        )}
        {process && tab === RECORD_HISTORY_TAB_KEY && (
          <WorkspaceTabBoundary resetKey={tab} onRetry={() => historyTab.retry()}>
            <React.Suspense fallback={null}>
              <HistoryTab table="business_processes" recordId={process.id} />
            </React.Suspense>
          </WorkspaceTabBoundary>
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
