import React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, IconButton, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useDataAccessLimited } from '../../auth/dataAccess';
import useAutosave, { useAutosaveRegistry } from '../../hooks/useAutosave';
import { useSupplierNav } from '../../hooks/useSupplierNav';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PortfolioMetadataItem, PortfolioStatusMetadata } from '../portfolio/workspace/PortfolioMetadataBar';
import { PropertyGroup } from '../../components/design';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import {
  STATUS_DISABLED,
  STATUS_ENABLED,
  type StatusValue,
  deriveStatusFromDisabledAt,
  normalizeStatus,
} from '../../constants/status';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';
import { SupplierNameTitle, SupplierNotes, SupplierTextRow } from './SupplierFields';
import SupplierContactsTab, { useSupplierContacts } from './SupplierContactsTab';
import RecordDeleteButton from '../../components/workspace/RecordDeleteButton';
import { CreationActions, useCreationLeave, useCreationTitle, useDraftCreation } from '../../components/workspace/creation';
import RecordUsagesSection, { scrollToUsages, useRecordUsages } from '../../components/usages/RecordUsagesSection';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';
import { SUPPLIERS_PATH, type Supplier, type SupplierPatch, isDuplicateError } from './supplierModel';

// The History tab loads with its tab: opening a supplier reads its overview and contacts only.
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;

type TabKey = 'overview' | 'contacts' | typeof RECORD_HISTORY_TAB_KEY;
const TAB_KEYS: readonly string[] = ['overview', 'contacts', RECORD_HISTORY_TAB_KEY];
const DRAWER_KEY = 'kanap.suppliers.drawerOpen';
const LIST_CONTEXT_KEYS = ['sort', 'q', 'filters', 'scope'];
/** How long Saved stays after a field is saved, as the autosave of the notes. */
const SAVED_LINGER_MS = 1500;

type FieldKey = 'name' | 'erp_supplier_id' | 'notes' | 'status' | 'disabled_at';
type FieldErrors = Partial<Record<FieldKey, string>>;

/** What a new supplier starts from. */
const NEW_SUPPLIER: Supplier = { id: '', name: '', erp_supplier_id: null, notes: null, status: STATUS_ENABLED, disabled_at: null };

/** The list's sort, search, filters and scope, kept in every address of the page. */
function useListContext() {
  const [searchParams] = useSearchParams();
  const context = React.useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of LIST_CONTEXT_KEYS) {
      const value = searchParams.get(key);
      if (value) sp.set(key, value);
    }
    return sp.toString();
  }, [searchParams]);
  return React.useCallback((path: string) => `${path}${context ? `?${context}` : ''}`, [context]);
}

export default function SupplierWorkspacePage() {
  const params = useParams();
  const location = useLocation();
  const id = String(params.id || '');
  // The new page is the supplier's own page on a draft, sent by Create.
  if (id === 'new') return <SupplierEditor key="new" id="new" tab="overview" />;
  // An address without a tab, or with a tab the page no longer has, opens the overview.
  if (!params.tab || !TAB_KEYS.includes(params.tab)) {
    return <Navigate replace to={`${SUPPLIERS_PATH}/${id}/overview${location.search}`} />;
  }
  // Keyed by supplier: drafts and pending saves belong to the supplier they were typed on.
  return <SupplierEditor key={id} id={id} tab={params.tab as TabKey} />;
}

function SupplierEditor({ id, tab }: { id: string; tab: TabKey }) {
  const { t } = useTranslation(['master-data', 'common']);
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { hasLevel } = useAuth();
  // A supplier is common to every data scope: editing it follows the role; deleting one is reserved to
  // people with access to all data.
  const dataAccessLimited = useDataAccessLimited();
  const canEdit = hasLevel('suppliers', 'manager');
  const canDelete = hasLevel('suppliers', 'admin') && !dataAccessLimited;
  const withContext = useListContext();
  const isCreate = id === 'new';

  const nav = useSupplierNav({
    id,
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    statusScope: searchParams.get('scope'),
  });

  const detailKey = React.useMemo(() => ['suppliers', id] as const, [id]);
  // Set once the supplier is deleted: the page leaves without loading it again.
  const [deleted, setDeleted] = React.useState(false);
  const { data: stored, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: async () => (await api.get<Supplier>(`/suppliers/${id}`)).data,
    enabled: !deleted && !isCreate,
  });
  // A new supplier: the fields write here, Create sends it.
  const [draft, setDraft] = React.useState<Supplier>(NEW_SUPPLIER);
  const draftRef = React.useRef(draft);
  const data = isCreate ? draft : stored;
  const { data: contactLinks } = useSupplierContacts(id, !isCreate);
  const { data: usages } = useRecordUsages('suppliers', id, !isCreate);
  // The header's count asked for the "Used by" section from another tab: scroll once the overview shows it.
  const [usagesScrollPending, setUsagesScrollPending] = React.useState(false);

  const [errors, setErrors] = React.useState<FieldErrors>({});
  // Writes queue one after the other: a response never overwrites a newer one.
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const registry = useAutosaveRegistry();
  // The notes save after a pause in typing; their error shows under them (see `save`).
  const autosave = useAutosave({ registry, onError: () => undefined });

  /**
   * Saves fields of the supplier. A status shows its new value at once (`optimistic`); a refusal
   * shows under the field and the stored values come back.
   */
  const save = React.useCallback((patch: SupplierPatch, field: FieldKey, optimistic?: Partial<Supplier>): Promise<void> => {
    if (isCreate) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      draftRef.current = { ...draftRef.current, ...patch };
      setDraft(draftRef.current);
      return Promise.resolve();
    }
    if (!canEdit || !queryClient.getQueryData(detailKey)) return Promise.resolve();
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (optimistic) queryClient.setQueryData<Supplier>(detailKey, (prev) => (prev ? { ...prev, ...optimistic } : prev));
    const run = async () => {
      try {
        const res = await api.patch<Supplier>(`/suppliers/${id}`, patch);
        queryClient.setQueryData<Supplier>(detailKey, (prev) => ({ ...(prev as Supplier), ...res.data }));
        // The list and the pickers show names and statuses.
        void queryClient.invalidateQueries({ queryKey: ['suppliers'], predicate: (query) => query.queryKey[1] !== id });
      } catch (e) {
        const message = field === 'name' && isDuplicateError(e)
          ? t('suppliers.messages.nameTaken')
          : getApiErrorMessage(e, t, t('suppliers.messages.saveFailed'));
        setErrors((prev) => ({ ...prev, [field]: message }));
        if (optimistic) void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
        throw e;
      }
    };
    const result = chainRef.current.then(run, run);
    chainRef.current = result.catch(() => undefined);
    return result;
  }, [canEdit, detailKey, id, isCreate, queryClient, t]);

  // The fields saved at once (name, ERP ID, status, end of validity) show Saving, then Saved, as the notes do.
  const [fieldSaves, setFieldSaves] = React.useState(0);
  const [fieldSaved, setFieldSaved] = React.useState(false);
  const savedTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
  }, []);

  const saveNow = (patch: SupplierPatch, field: FieldKey, optimistic?: Partial<Supplier>) => {
    if (isCreate) {
      void save(patch, field, optimistic);
      return;
    }
    if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
    setFieldSaved(false);
    setFieldSaves((n) => n + 1);
    void save(patch, field, optimistic)
      .then(() => {
        setFieldSaved(true);
        savedTimerRef.current = window.setTimeout(() => {
          savedTimerRef.current = null;
          setFieldSaved(false);
        }, SAVED_LINGER_MS);
      }, () => undefined)
      .finally(() => setFieldSaves((n) => n - 1));
  };

  const changeStatus = (next: StatusValue) => {
    if (!data || next === normalizeStatus(data.status)) return;
    // Disabled with no end of validity: the server sets it to now.
    if (next === STATUS_DISABLED) saveNow({ status: STATUS_DISABLED }, 'status', { status: STATUS_DISABLED });
    else saveNow({ status: STATUS_ENABLED, disabled_at: null }, 'status', { status: STATUS_ENABLED, disabled_at: null });
  };

  const go = async (path: string) => {
    await registry.flushAll();
    navigate(withContext(path));
  };
  const close = () => { void go(SUPPLIERS_PATH); };
  const goTo = (targetId: string | null, nextTab: TabKey = tab) => {
    if (targetId) void go(`${SUPPLIERS_PATH}/${targetId}/${nextTab}`);
  };

  // The draft is created once it has its name; the supplier then opens, every tab available, with
  // Create (kept, back where the creation started) and Cancel (deleted).
  const leave = useCreationLeave(close);
  const title = useCreationTitle({
    requiredMessage: t('suppliers.messages.nameRequired'),
    onCancel: leave,
    onCommit: () => creation.attempt(),
  });
  const [createError, setCreateError] = React.useState<string | null>(null);
  const creation = useDraftCreation({
    isCreate,
    family: 'suppliers',
    apiBase: '/suppliers',
    recordId: stored?.id ?? null,
    listPath: withContext(SUPPLIERS_PATH),
    recordLabel: t('suppliers.creationRecord'),
    queryKeyPrefixes: ['suppliers'],
    ready: () => !!title.current().trim(),
    post: async () => {
      await autosave.flush();
      setCreateError(null);
      try {
        const { erp_supplier_id, notes, status, disabled_at } = draftRef.current;
        const { data: created } = await api.post<Supplier & { creation_token: string }>('/suppliers', {
          name: title.current().trim(), erp_supplier_id, notes, status, disabled_at,
        });
        void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
        return { id: created.id, token: created.creation_token, path: withContext(`${SUPPLIERS_PATH}/${created.id}/overview`) };
      } catch (e) {
        if (isDuplicateError(e)) title.refuse(t('suppliers.messages.nameTaken'));
        else setCreateError(getApiErrorMessage(e, t, t('suppliers.messages.createFailed')));
        return null;
      }
    },
    onError: setCreateError,
  });
  React.useEffect(() => { creation.attempt(); }, [creation.attempt, draft]);
  const handleCreate = async () => {
    await autosave.flush();
    if (creation.beingCreated) {
      creation.finishCreation();
      return;
    }
    if (!canEdit || !title.require()) return;
    void creation.createAndLeave();
  };

  React.useEffect(() => {
    if (!usagesScrollPending || tab !== 'overview' || !data) return;
    setUsagesScrollPending(false);
    scrollToUsages();
  }, [usagesScrollPending, tab, data]);

  const disabled = !canEdit || !data;
  const status = normalizeStatus(data?.status);
  const enabledColor = getDotColor('success', theme.palette.mode);
  const disabledColor = getDotColor('default', theme.palette.mode);
  const statusLabel = (value: StatusValue) => (value === STATUS_DISABLED ? t('suppliers.status.disabled') : t('suppliers.status.enabled'));
  const savingHint = isCreate ? null : autosave.status === 'saving' || autosave.status === 'pending' || fieldSaves > 0
    ? t('common:status.saving')
    : autosave.status === 'saved' || fieldSaved ? t('common:status.saved') : null;

  const metadata = data ? (
    <>
      <PortfolioMetadataItem label={t('suppliers.fields.status')}>
        <PortfolioStatusMetadata
          value={status}
          label={statusLabel(status)}
          color={status === STATUS_DISABLED ? disabledColor : enabledColor}
          options={[
            { value: STATUS_ENABLED, label: statusLabel(STATUS_ENABLED), color: enabledColor },
            { value: STATUS_DISABLED, label: statusLabel(STATUS_DISABLED), color: disabledColor },
          ]}
          onChange={(value) => changeStatus(value as StatusValue)}
          disabled={disabled}
        />
      </PortfolioMetadataItem>
      {!isCreate && (
        <>
      <PortfolioMetadataItem
        label={t('suppliers.fields.contacts')}
        onClick={tab === 'contacts' ? undefined : () => goTo(id, 'contacts')}
        title={tab === 'contacts' ? undefined : t('suppliers.metadata.openContacts')}
      >
        {contactLinks ? contactLinks.length : '…'}
      </PortfolioMetadataItem>
      <PortfolioMetadataItem
        label={t('shared.usages.title')}
        onClick={() => {
          if (tab === 'overview') scrollToUsages();
          else {
            setUsagesScrollPending(true);
            goTo(id, 'overview');
          }
        }}
        title={t('shared.usages.open')}
      >
        {usages ? usages.total : '…'}
      </PortfolioMetadataItem>
        </>
      )}
      {errors.status && (
        <Typography component="span" sx={{ fontSize: 12, color: 'error.main' }}>{errors.status}</Typography>
      )}
    </>
  ) : undefined;

  const properties = data ? (
    <PropertyGroup>
      <SupplierTextRow
        label={t('suppliers.fields.erpSupplierId')}
        placeholder={t('suppliers.placeholders.erpSupplierId')}
        value={data.erp_supplier_id ?? ''}
        disabled={disabled}
        error={errors.erp_supplier_id}
        onCommit={(next) => {
          if (next === (data.erp_supplier_id ?? null)) {
            setErrors((prev) => ({ ...prev, erp_supplier_id: undefined }));
            return;
          }
          saveNow({ erp_supplier_id: next }, 'erp_supplier_id');
        }}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
        <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>
          {t('suppliers.fields.lifecycle')}
        </Typography>
        <StatusLifecycleField
          status={status}
          // The date carries the change (the switch sets it too); the server derives the status from it.
          onStatusChange={() => undefined}
          disabledAt={data.disabled_at}
          onDisabledAtChange={(disabledAt) => {
            if (disabledAt === data.disabled_at) return;
            const nextStatus = deriveStatusFromDisabledAt(disabledAt);
            saveNow({ status: nextStatus, disabled_at: disabledAt }, 'disabled_at', { status: nextStatus, disabled_at: disabledAt });
          }}
          // Disable now: the status alone, the server sets the end of validity from its own clock.
          onDisableNow={() => saveNow({ status: STATUS_DISABLED }, 'disabled_at', { status: STATUS_DISABLED })}
          disabled={disabled}
          disabledAtError={!!errors.disabled_at}
          disabledAtHelperText={errors.disabled_at}
        />
      </Box>
    </PropertyGroup>
  ) : <Box />;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={loadError ? <Alert severity="error">{t('suppliers.loadError')}</Alert> : undefined}
        activeTab={tab}
        tabs={[
          { key: 'overview', label: t('shared.labels.overview') },
          { key: 'contacts', label: t('shared.labels.contacts'), disabled: isCreate },
          { key: RECORD_HISTORY_TAB_KEY, label: t('shared.labels.history'), disabled: isCreate },
        ]}
        onTabChange={(next) => goTo(id, next as TabKey)}
        drawerStorageKey={DRAWER_KEY}
        backLabel={t('suppliers.title')}
        onBack={isCreate ? leave : close}
        {...(isCreate ? title.shellProps : { title: data?.name ?? '' })}
        titleFallback={isCreate ? t('suppliers.newSupplier') : t('suppliers.supplierFallback')}
        isCreate={isCreate}
        // A new record's required fields sit in the drawer: it stays open.
        forceDrawerOpen={isCreate}
        titleEditor={data && !isCreate ? (
          <SupplierNameTitle
            name={data.name}
            fallback={t('suppliers.supplierFallback')}
            canEdit={!disabled}
            error={errors.name}
            onSave={(name) => saveNow({ name }, 'name', { name })}
          />
        ) : undefined}
        // The ERP supplier ID is the supplier's business reference (`SUP-001` in the demo data).
        itemReference={isCreate ? null : data?.erp_supplier_id || null}
        onCopyReference={!isCreate && data?.erp_supplier_id ? () => {
          void navigator.clipboard?.writeText(data.erp_supplier_id as string).catch(() => undefined);
        } : undefined}
        nav={!isCreate && nav.total > 0 ? {
          currentIndex: nav.index + 1,
          totalCount: nav.total,
          hasPrev: nav.hasPrev,
          hasNext: nav.hasNext,
          onPrev: () => goTo(nav.prevId),
          onNext: () => goTo(nav.nextId),
          previousLabel: t('suppliers.previous'),
          nextLabel: t('suppliers.next'),
        } : undefined}
        onSaveShortcut={() => { void autosave.flush(); }}
        metadata={metadata}
        actions={isCreate || creation.beingCreated ? (
          <CreationActions
            onCreate={() => void handleCreate()}
            onCancel={isCreate ? leave : () => { void creation.cancelCreation(); }}
            busy={!canEdit || creation.busy}
          />
        ) : (
          <>
            {savingHint && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center', mr: 0.5 }}>{savingHint}</Typography>
            )}
            {data && canDelete && (
              <RecordDeleteButton
                base="/suppliers"
                id={data.id}
                name={data.name}
                deleteFailed="suppliers.messages.deleteFailed"
                onDeleted={() => { setDeleted(true); navigate(withContext(SUPPLIERS_PATH)); }}
              />
            )}
            <IconButton aria-label={t('common:buttons.close')} title={t('common:buttons.close')} size="small" onClick={close}>
              <CloseIcon />
            </IconButton>
          </>
        )}
        properties={properties}
      >
        {data && tab === 'overview' && (
          <Stack spacing={3} sx={{ maxWidth: 900 }}>
            <SupplierNotes
              value={data.notes ?? ''}
              disabled={disabled}
              error={errors.notes}
              onTyped={(notes) => {
                autosave.schedule(() => save({ notes: notes.trim() ? notes : null }, 'notes'));
              }}
              onCommit={() => { void autosave.flush(); }}
            />
            {!isCreate && <RecordUsagesSection owner="suppliers" id={id} ownerName={data.name} />}
            {createError && <Alert severity="error">{createError}</Alert>}
          </Stack>
        )}
        {tab === 'contacts' && <SupplierContactsTab supplierId={id} canManage={canEdit} />}
        {tab === RECORD_HISTORY_TAB_KEY && data && (
          <WorkspaceTabBoundary resetKey={tab} onRetry={() => historyTab.retry()}>
            <React.Suspense fallback={null}>
              <HistoryTab table="suppliers" recordId={data.id} />
            </React.Suspense>
          </WorkspaceTabBoundary>
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
