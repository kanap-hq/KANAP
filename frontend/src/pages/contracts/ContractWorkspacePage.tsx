import React from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, IconButton, Stack, Typography } from '@mui/material';
import { CreationActions, changedFields, useCreatedFromDraft, useCreationLeave, useCreationTitle, useDraftCreation } from '../../components/workspace/creation';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useDataAccessLimited } from '../../auth/dataAccess';
import { useContractNav } from '../../hooks/useContractNav';
import useAutosave, { autosaveErrorMessage, useAutosaveRegistry } from '../../hooks/useAutosave';
import { sendPatchBuffer, usePatchBuffer } from '../../hooks/patchBuffer';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PortfolioMetadataItem, PortfolioStatusMetadata } from '../portfolio/workspace/PortfolioMetadataBar';
import MetadataUserPicker from '../../components/workspace/MetadataUserPicker';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import EntityTasksSection from '../../components/EntityTasksSection';
import RelationsSectionTitle from '../portfolio/components/RelationsSectionTitle';
import { STATUS_DISABLED, STATUS_ENABLED, deriveStatusFromDisabledAt, statusChoicePatch, type StatusValue } from '../../constants/status';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { utcTodayYmd } from './contractTerms';
import { contractSchedule } from './contractSchedule';
import { type BillingFrequency, type ContractDetail, type ContractPatch } from './contractForm';
import ContractDeadlines from './workspace/ContractDeadlines';
import ContractRenewalDecision from './workspace/ContractRenewalDecision';
import { confirmedRenewalOf, renewalQueryKey, useContractRenewal } from './contractRenewal';
import ContractStopRenewalDialog from './workspace/ContractStopRenewalDialog';
import ContractResumeRenewalDialog from './workspace/ContractResumeRenewalDialog';
import ContractPropertiesDrawer, { type ContractFieldErrors, type ContractFormValues } from './workspace/ContractPropertiesDrawer';
import ContractBudgetTab from './workspace/ContractBudgetTab';
import ContractRelationsTab from './workspace/ContractRelationsTab';
import ContractComplianceTab, { useContractCompliance } from './workspace/ContractComplianceTab';
import ContractDeleteButton from './workspace/ContractDeleteButton';
import { contractComplianceKey } from './contractCompliance';
import { useDefaultContractCurrency } from './workspace/ContractFields';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';

const MarkdownEditor = React.lazy(() => import('../../components/MarkdownEditor'));

type TabKey = 'overview' | 'budget' | 'compliance' | 'relations' | typeof RECORD_HISTORY_TAB_KEY;
const TAB_KEYS: TabKey[] = ['overview', 'budget', 'compliance', 'relations', RECORD_HISTORY_TAB_KEY];
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;
/** Tabs of the former page: their address opens the tab that now holds their content. */
const LEGACY_TABS: Record<string, TabKey> = { details: 'overview', tasks: 'overview' };
const LIST_PATH = '/ops/contracts';
// The list's budget year and column too: its order and filters may read them (prev / next).
const LIST_CONTEXT_KEYS = ['sort', 'q', 'filters', 'scope', 'ctx', 'budget_year', 'budget_column'];
const DRAWER_KEY = 'kanap.contracts.drawerOpen';

type ContractForm = ContractFormValues & { id: string; name: string; notes: string };

function toForm(d: ContractDetail): ContractForm {
  const disabledAt = d.disabled_at ? new Date(d.disabled_at).toISOString() : null;
  return {
    id: d.id,
    name: d.name || '',
    notes: d.notes || '',
    supplier_id: d.supplier_id || '',
    company_id: d.company_id || '',
    cost_center_id: d.cost_center_id || '',
    owner_user_id: d.owner_user_id || null,
    start_date: d.start_date ? String(d.start_date).slice(0, 10) : '',
    duration_months: Number(d.duration_months ?? 0),
    notice_period_months: Number(d.notice_period_months ?? 0),
    auto_renewal: Boolean(d.auto_renewal),
    yearly_amount_at_signature: Number(d.yearly_amount_at_signature ?? 0),
    currency: (d.currency || '').toUpperCase(),
    billing_frequency: (d.billing_frequency || 'annual') as BillingFrequency,
    status: deriveStatusFromDisabledAt(disabledAt),
    disabled_at: disabledAt,
    created_at: d.created_at ?? null,
    updated_at: d.updated_at ?? null,
  };
}

// A new contract: the contract page on a draft that Create posts.
const NEW_CONTRACT: ContractForm = {
  id: '',
  name: '',
  notes: '',
  supplier_id: '',
  company_id: '',
  cost_center_id: '',
  owner_user_id: null,
  start_date: '',
  duration_months: null,
  notice_period_months: 0,
  auto_renewal: true,
  yearly_amount_at_signature: 0,
  currency: '',
  billing_frequency: 'annual',
  status: STATUS_ENABLED,
  disabled_at: null,
  created_at: null,
  updated_at: null,
};

const mergePatch = (form: ContractForm, patch: ContractPatch): ContractForm => ({ ...form, ...(patch as Partial<ContractForm>) });

const fetchContract = async (contractId: string) => (await api.get<ContractDetail>(`/contracts/${contractId}`)).data;

/** The draft's fields that Create sends and a patch can change. */
const DRAFT_FIELDS = [
  'supplier_id', 'company_id', 'cost_center_id', 'owner_user_id', 'start_date', 'duration_months', 'notice_period_months',
  'auto_renewal', 'yearly_amount_at_signature', 'currency', 'billing_frequency', 'notes', 'status', 'disabled_at',
] as const;

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
  const withContext = React.useCallback((path: string) => `${path}${context ? `?${context}` : ''}`, [context]);
  return { searchParams, withContext };
}

export default function ContractWorkspacePage() {
  const params = useParams();
  const location = useLocation();
  const id = String(params.id || '');
  const rawTab = params.tab;
  // The contract the draft has just created: the page stays the draft's, so that what is typed
  // while it is written, and the field being typed in, are kept.
  const fromDraft = useCreatedFromDraft('contracts', id);
  if (rawTab && LEGACY_TABS[rawTab]) {
    return <Navigate replace to={`${LIST_PATH}/${id}/${LEGACY_TABS[rawTab]}${location.search}`} />;
  }
  const tab: TabKey = TAB_KEYS.includes(rawTab as TabKey) ? (rawTab as TabKey) : 'overview';
  if (id === 'new') return <ContractEditor key="draft" id="new" tab="overview" />;
  if (fromDraft) return <ContractEditor key="draft" id={id} tab={tab} />;
  return <ContractEditor id={id} tab={tab} />;
}

const sectionStackSx = { pt: 1, maxWidth: 960 } as const;

function ContractEditor({ id, tab }: { id: string; tab: TabKey }) {
  const { t } = useTranslation(['ops', 'common']);
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const isCreate = id === 'new';
  const limited = useDataAccessLimited();
  const canEdit = hasLevel('contracts', 'member');
  // Deleting a contract is reserved to people with access to all data (spec §2.7, §7.7).
  const canDelete = hasLevel('contracts', 'admin') && !limited;
  const { addToRecent } = useRecentlyViewed();
  const { searchParams, withContext } = useListContext();

  const detailKey = React.useMemo(() => ['contracts', id] as const, [id]);
  // Set once the contract is deleted: the page leaves without loading it again.
  const [deletedId, setDeletedId] = React.useState<string | null>(null);
  const { data, error: loadError, isPlaceholderData } = useQuery({
    queryKey: detailKey,
    queryFn: () => fetchContract(id),
    // The previous contract stays on screen while the next one loads (prev / next).
    placeholderData: (previous) => previous,
    enabled: deletedId !== id && !isCreate,
  });
  // While the shown contract is the previous one, nothing is written: an edit could land on the wrong one.
  const stale = isPlaceholderData;
  const countsQuery = useQuery({
    queryKey: ['contract-relation-counts', id],
    queryFn: async () => (await api.get<{ budget_lines: number; relations: number }>(`/contracts/${id}/relation-counts`)).data,
    enabled: !isCreate,
  });
  // The Compliance tab's badge: the expected requirements recorded as absent.
  const complianceQuery = useContractCompliance(id, !isCreate);

  const nav = useContractNav({
    id,
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    statusScope: searchParams.get('scope'),
    extraParams: {
      budget_year: searchParams.get('budget_year') ?? undefined,
      budget_column: searchParams.get('budget_column') ?? undefined,
    },
    enabled: !isCreate,
  });

  React.useEffect(() => {
    if (!stale && data?.id && data.name) addToRecent('contract', data.id, data.name);
  }, [addToRecent, data?.id, data?.name, stale]);

  // ----- Autosave: every field saves itself; typed values after a pause, the rest at once -----
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const registry = useAutosaveRegistry();
  const autosave = useAutosave({
    onError: (e) => setSaveError(autosaveErrorMessage(e, t, t('contracts.messages.saveFailed'))),
    registry,
  });
  // Edits not saved yet, each with the contract it was made on (the page stays mounted from one
  // contract to the next). Contracts have no edit-conflict check: the last save wins.
  const patchBuffer = usePatchBuffer<ContractPatch>();
  const [form, setForm] = React.useState<ContractForm | null>(isCreate ? NEW_CONTRACT : null);
  // A new contract: the required fields Create found empty.
  const [errors, setErrors] = React.useState<ContractFieldErrors>({});
  const defaultCurrency = useDefaultContractCurrency();
  React.useEffect(() => {
    if (isCreate && defaultCurrency) setForm((prev) => (prev && !prev.currency ? { ...prev, currency: defaultCurrency } : prev));
  }, [defaultCurrency, isCreate]);
  const dataRef = React.useRef(data);
  dataRef.current = data;

  // The form follows the stored contract, except the fields edited and not saved yet.
  React.useEffect(() => {
    if (!data) return;
    const next = toForm(data);
    const held = patchBuffer.held(data.id);
    setForm(held ? mergePatch(next, held) : next);
  }, [data, patchBuffer]);

  const flushPending = React.useCallback(() => sendPatchBuffer<ContractPatch>(
    patchBuffer,
    async (contractId, patch) => { await api.patch(`/contracts/${contractId}`, patch); },
    {
      onSaved: async (contractId) => {
        await queryClient.invalidateQueries({ queryKey: ['contracts', contractId], exact: true });
        void queryClient.invalidateQueries({ queryKey: ['contracts-ids'] });
        // The dates and the renewal decide what the decision box shows.
        void queryClient.invalidateQueries({ queryKey: renewalQueryKey(contractId) });
      },
      // Refused: the screen shows the stored values again.
      onRefused: (contractId) => {
        const stored = dataRef.current;
        if (stored && stored.id === contractId) setForm(toForm(stored));
        void queryClient.invalidateQueries({ queryKey: ['contracts', contractId], exact: true });
      },
    },
  ), [patchBuffer, queryClient]);

  // The role says what the person may do; the API's `editable` says where (absent without a data access).
  const editable = isCreate ? canEdit : canEdit && data?.editable !== false && !stale && !!data && form?.id === data.id;
  const readOnlyInAccess = !!data && data.editable === false && canEdit;

  // A new contract keeps its edits in the draft until it is created. A committed change (a picker,
  // a date, a typed field left) may create it; a keystroke does not.
  const [draftCommits, setDraftCommits] = React.useState(0);
  const patchDraft = React.useCallback((patch: ContractPatch) => {
    setForm((prev) => (prev ? mergePatch(prev, patch) : prev));
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch)) delete next[key as keyof ContractFieldErrors];
      return next;
    });
  }, []);

  const patchNow = React.useCallback(async (patch: ContractPatch) => {
    if (isCreate) { patchDraft(patch); setDraftCommits((n) => n + 1); return; }
    if (!editable || !data) return;
    setForm((prev) => (prev ? mergePatch(prev, patch) : prev));
    setSaveError(null);
    // Text still waiting for its pause goes first.
    await autosave.flush();
    if (patchBuffer.add(data.id, patch)) {
      autosave.schedule(flushPending);
      await autosave.flush();
    }
  }, [autosave, data, editable, flushPending, isCreate, patchBuffer, patchDraft]);

  const patchTyped = React.useCallback((patch: ContractPatch) => {
    if (isCreate) { patchDraft(patch); return; }
    if (!editable || !data) return;
    setForm((prev) => (prev ? mergePatch(prev, patch) : prev));
    setSaveError(null);
    if (patchBuffer.add(data.id, patch)) autosave.schedule(flushPending);
  }, [autosave, data, editable, flushPending, isCreate, patchBuffer, patchDraft]);

  const flushNow = React.useCallback(() => {
    if (isCreate) setDraftCommits((n) => n + 1);
    else void autosave.flush();
  }, [autosave, isCreate]);

  // ----- Navigation: pending edits are saved before the page shows another contract or tab -----
  const go = React.useCallback(async (path: string) => {
    await registry.flushAll();
    navigate(withContext(path));
  }, [navigate, registry, withContext]);
  const close = () => { void go(LIST_PATH); };

  const handleStatusChange = (next: StatusValue) => {
    if (!form) return;
    // The status shown sends nothing (a future end of validity stays). Disabled goes alone: the
    // server sets the end of validity to now, or keeps one already passed.
    const patch = statusChoicePatch(next, form);
    if (patch) void patchNow(patch);
  };

  const [drawerOpenRequest, setDrawerOpenRequest] = React.useState(0);
  const openDrawer = () => setDrawerOpenRequest((n) => n + 1);

  // A renewal decided for the term of the next deadline: the timeline no longer asks for a decision.
  const renewalQuery = useContractRenewal(id, !isCreate);
  const confirmedRenewal = React.useMemo(() => confirmedRenewalOf(renewalQuery.data), [renewalQuery.data]);
  // A decision awaited on the end of a contract without renewal: the sentence says so.
  const endDecisionDue = renewalQuery.data?.state === 'pending' && renewalQuery.data.mode === 'end';
  const schedule = React.useMemo(() => (form ? contractSchedule({
    start_date: form.start_date,
    duration_months: form.duration_months,
    notice_period_months: form.notice_period_months,
    auto_renewal: form.auto_renewal,
    disabled_at: form.disabled_at,
  }, utcTodayYmd(), data?.decision_window_days, confirmedRenewal, endDecisionDue) : null), [form, data?.decision_window_days, confirmedRenewal, endDecisionDue]);

  // "No" in the renewal field of a contract already renewed (without an end of validity the term
  // rule would drop its past terms) or awaiting a renewal decision: a confirmation turns the
  // renewal off with an end on a day chosen (`ContractStopRenewalDialog`).
  const [stopRenewalOpen, setStopRenewalOpen] = React.useState(false);
  const renewedSoFar = form?.auto_renewal && schedule ? schedule.renewals : 0;
  const decisionAwaited = !!form?.auto_renewal && renewalQuery.data?.state === 'pending';
  // "Yes" on a contract without renewal that has an end of validity: a confirmation turns the
  // renewal on and removes that end (`ContractResumeRenewalDialog`), whatever set it.
  const [resumeRenewalOpen, setResumeRenewalOpen] = React.useState(false);
  const onPropertiesPatch = (patch: ContractPatch) => {
    if (isCreate) { void patchNow(patch); return; }
    if (patch.auto_renewal === false && (renewedSoFar > 0 || decisionAwaited)) {
      setStopRenewalOpen(true);
      return;
    }
    if (patch.auto_renewal === true && form && !form.auto_renewal && form.disabled_at) {
      setResumeRenewalOpen(true);
      return;
    }
    void patchNow(patch);
  };

  // A renewal decision may change the contract (a termination sets its end of validity) and its task.
  const refreshAfterDecision = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['contracts', id], exact: true });
    void queryClient.invalidateQueries({ queryKey: ['contract-tasks', id] });
    void queryClient.invalidateQueries({ queryKey: ['contracts-ids'] });
  }, [id, queryClient]);

  const refreshRelations = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['contract-relation-counts', id] });
    void queryClient.invalidateQueries({ queryKey: ['contracts', id], exact: true });
    // Linked applications and assets decide what the contract is expected to hold.
    void queryClient.invalidateQueries({ queryKey: contractComplianceKey(id) });
  }, [id, queryClient]);

  const notesTouchedRef = React.useRef(false);
  // Another contract starts untouched; the contract the draft creates is the same page, its notes in hand.
  const notesOfId = React.useRef(id);
  React.useEffect(() => {
    if (notesOfId.current !== 'new') notesTouchedRef.current = false;
    notesOfId.current = id;
  }, [id]);

  const counts = countsQuery.data;
  const tabs = [
    { key: 'overview', label: t('contracts.tabs.overview') },
    { key: 'budget', label: t('contracts.tabs.budget'), badge: counts?.budget_lines || undefined, disabled: isCreate },
    { key: 'compliance', label: t('contracts.tabs.compliance'), badge: complianceQuery.data?.summary?.missing || undefined, disabled: isCreate },
    { key: 'relations', label: t('contracts.tabs.relations'), badge: counts?.relations || undefined, disabled: isCreate },
    { key: RECORD_HISTORY_TAB_KEY, label: t('contracts.tabs.history'), disabled: isCreate },
  ];

  // ----- A new contract: created once it has its name and its required fields; it then opens, every
  // tab available, with Create (kept, back where the creation started) and Cancel (deleted) -----
  const leave = useCreationLeave(close);
  const creationTitle = useCreationTitle({
    requiredMessage: t('contracts.messages.nameRequired'),
    onCancel: leave,
    onCommit: () => creation.attempt(),
  });
  const formRef = React.useRef(form);
  formRef.current = form;
  const missingFields = (draft: ContractForm): ContractFieldErrors => {
    const next: ContractFieldErrors = {};
    if (!draft.supplier_id) next.supplier_id = t('contracts.messages.supplierRequired');
    if (!draft.company_id) next.company_id = t('contracts.messages.companyRequired');
    if (!draft.start_date) next.start_date = t('contracts.messages.startRequired');
    if (!draft.duration_months || draft.duration_months < 1) next.duration_months = t('contracts.messages.durationRequired');
    if (!draft.currency) next.currency = t('contracts.messages.currencyRequired');
    return next;
  };
  const creation = useDraftCreation({
    isCreate,
    family: 'contracts',
    apiBase: '/contracts',
    recordId: data?.id ?? null,
    listPath: withContext(LIST_PATH),
    recordLabel: t('contracts.workspace.creationRecord'),
    queryKeyPrefixes: ['contracts', 'contracts-ids'],
    ready: () => {
      const draft = formRef.current;
      return canEdit && !!draft && !!creationTitle.current().trim() && Object.keys(missingFields(draft)).length === 0;
    },
    post: async () => {
      const draft = formRef.current;
      if (!draft) return null;
      setSaveError(null);
      try {
        const { data: created } = await api.post<{ id: string; creation_token: string }>('/contracts', {
          name: creationTitle.current().trim(),
          supplier_id: draft.supplier_id,
          company_id: draft.company_id,
          ...(draft.cost_center_id ? { cost_center_id: draft.cost_center_id } : {}),
          owner_user_id: draft.owner_user_id,
          start_date: draft.start_date,
          duration_months: draft.duration_months,
          notice_period_months: draft.notice_period_months,
          auto_renewal: draft.auto_renewal,
          yearly_amount_at_signature: draft.yearly_amount_at_signature,
          currency: draft.currency,
          billing_frequency: draft.billing_frequency,
          notes: draft.notes.trim() ? draft.notes : null,
          status: draft.status,
          disabled_at: draft.disabled_at,
        });
        void queryClient.invalidateQueries({ queryKey: ['contracts-ids'] });
        // The page moves to the contract with its data in hand, and keeps what was typed since the
        // draft was sent (the next field, while the contract was written): saved on the contract.
        await queryClient.fetchQuery({ queryKey: ['contracts', created.id], queryFn: () => fetchContract(created.id) }).catch(() => undefined);
        const now = formRef.current;
        const late = now ? changedFields(draft, now, DRAFT_FIELDS) as ContractPatch | null : null;
        if (late && patchBuffer.add(created.id, late)) autosave.schedule(flushPending);
        setForm((prev) => (prev ? { ...prev, id: created.id, name: creationTitle.current().trim() } : prev));
        return { id: created.id, token: created.creation_token, path: withContext(`${LIST_PATH}/${created.id}/overview`) };
      } catch (e) {
        setSaveError(getApiErrorMessage(e, t, t('contracts.messages.createFailed')));
        return null;
      }
    },
    onError: setSaveError,
  });
  React.useEffect(() => { creation.attempt(); }, [creation.attempt, draftCommits]);
  const handleCreate = async () => {
    await autosave.flush();
    if (creation.beingCreated) {
      creation.finishCreation();
      return;
    }
    if (!form || !canEdit) return;
    const name = creationTitle.require();
    const next = missingFields(form);
    setErrors(next);
    if (!name || Object.keys(next).length > 0) return;
    void creation.createAndLeave();
  };

  const savingHint = autosave.status === 'saving' || autosave.status === 'pending'
    ? t('common:status.saving', 'Saving…')
    : autosave.status === 'saved' ? t('common:status.saved', 'Saved') : null;

  const statusEnabled = form?.status !== STATUS_DISABLED;
  const statusOptions = [
    { value: STATUS_ENABLED, label: t('opex.status.enabled'), color: getDotColor('success', theme.palette.mode) },
    { value: STATUS_DISABLED, label: t('opex.status.disabled'), color: getDotColor('default', theme.palette.mode) },
  ];
  const shownData = form && data && form.id === data.id ? data : null;
  const names = {
    supplier: shownData?.supplier_name ?? null,
    company: shownData?.company_name ?? null,
    owner: shownData?.owner_name ?? null,
  };
  const missing = (value: string | null, key: string) => value ?? (
    <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t(key)}</Box>
  );

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={(loadError || saveError) ? (
          <>
            {!!loadError && <Alert severity="error">{t('contracts.messages.loadFailed')}</Alert>}
            {!!saveError && <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
          </>
        ) : undefined}
        activeTab={tab}
        tabs={tabs}
        onTabChange={(next) => { if (!isCreate) void go(`${LIST_PATH}/${id}/${next}`); }}
        drawerStorageKey={DRAWER_KEY}
        drawerOpenRequest={drawerOpenRequest}
        backLabel={t('contracts.title')}
        onBack={isCreate ? leave : close}
        {...(isCreate ? creationTitle.shellProps : {
          title: form?.name ?? '',
          canEditTitle: editable,
          onTitleSave: (next: string) => { if (form && next !== form.name) void patchNow({ name: next }); },
        })}
        titleFallback={isCreate ? t('contracts.workspace.newContract') : t('contracts.workspace.contract')}
        isCreate={isCreate}
        // A new record's required fields sit in the drawer: it stays open.
        forceDrawerOpen={isCreate}
        nav={!isCreate && nav.total > 0 ? {
          currentIndex: nav.index + 1,
          totalCount: nav.total,
          hasPrev: nav.hasPrev,
          hasNext: nav.hasNext,
          onPrev: () => { if (nav.prevId) void go(`${LIST_PATH}/${nav.prevId}/${tab}`); },
          onNext: () => { if (nav.nextId) void go(`${LIST_PATH}/${nav.nextId}/${tab}`); },
          previousLabel: t('contracts.workspace.previous'),
          nextLabel: t('contracts.workspace.next'),
        } : undefined}
        onSaveShortcut={flushNow}
        metadata={form ? (
          <>
            {!isCreate && (
            <>
            <PortfolioMetadataItem label={t('contracts.fields.supplier')} onClick={openDrawer} title={t('contracts.metadata.editInProperties')}>
              {missing(names.supplier, 'contracts.metadata.supplierMissing')}
            </PortfolioMetadataItem>
            <PortfolioMetadataItem label={t('contracts.fields.company')} onClick={openDrawer} title={t('contracts.metadata.editInProperties')}>
              {missing(names.company, 'contracts.metadata.companyMissing')}
            </PortfolioMetadataItem>
            <PortfolioMetadataItem label={t('contracts.fields.owner')}>
              <MetadataUserPicker
                value={form.owner_user_id}
                displayName={names.owner}
                placeholder={t('contracts.metadata.ownerMissing')}
                searchPlaceholder={t('contracts.fields.owner')}
                disabled={!editable}
                onChange={(next) => { void patchNow({ owner_user_id: next }); }}
              />
            </PortfolioMetadataItem>
            </>
            )}
            <PortfolioMetadataItem label={t('contracts.fields.status')}>
              <PortfolioStatusMetadata
                value={form.status}
                label={statusEnabled ? t('opex.status.enabled') : t('opex.status.disabled')}
                color={statusEnabled ? statusOptions[0].color : statusOptions[1].color}
                options={statusOptions}
                onChange={(value) => handleStatusChange(value as StatusValue)}
                disabled={!editable}
              />
            </PortfolioMetadataItem>
          </>
        ) : undefined}
        actions={isCreate || creation.beingCreated ? (
          <CreationActions
            onCreate={() => void handleCreate()}
            onCancel={isCreate ? leave : () => { void creation.cancelCreation(); }}
            busy={!canEdit || creation.cancelling}
            writing={creation.writing}
          />
        ) : (
          <>
            {readOnlyInAccess && (
              <Typography data-testid="contract-read-only" sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center', mr: 0.5 }}>
                {t('contracts.readOnlyInYourAccess')}
              </Typography>
            )}
            {savingHint && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center', mr: 0.5 }}>{savingHint}</Typography>
            )}
            {shownData && (
              <SendLinkButton itemType="contract" itemId={shownData.id} itemName={shownData.name || t('contracts.workspace.contract')} />
            )}
            {shownData && canDelete && !stale && (
              <ContractDeleteButton
                contractId={shownData.id}
                contractName={shownData.name || t('contracts.workspace.contract')}
                beforeDelete={() => registry.flushAll()}
                onDeleted={() => { setDeletedId(id); navigate(withContext(LIST_PATH)); }}
                onError={setSaveError}
              />
            )}
            <IconButton aria-label={t('common:buttons.close')} title={t('common:buttons.close')} size="small" onClick={close}>
              <CloseIcon />
            </IconButton>
          </>
        )}
        properties={form ? (
          <ContractPropertiesDrawer
            values={form}
            isCreate={isCreate}
            errors={errors}
            names={names}
            disabled={!editable}
            onPatch={onPropertiesPatch}
            onTyped={patchTyped}
            onCommit={flushNow}
          />
        ) : <Box />}
      >
        {form && tab === 'overview' && (
          <Stack key={isCreate || creation.beingCreated ? 'draft' : form.id} spacing={4} sx={sectionStackSx}>
            <ContractDeadlines schedule={schedule} />
            {!stale && !isCreate && <ContractRenewalDecision contractId={form.id} startDate={form.start_date} canDecide={editable} onDecided={refreshAfterDecision} />}
            {!isCreate && <EntityTasksSection entityType="contract" entityId={form.id} disabled={!editable} />}
            <Stack spacing={1.25}>
              <RelationsSectionTitle>{t('contracts.fields.notes')}</RelationsSectionTitle>
              <Box onFocusCapture={() => { notesTouchedRef.current = true; }} data-testid="contract-notes" data-creation-description="">
                <React.Suspense fallback={null}>
                  <MarkdownEditor
                    value={form.notes}
                    onChange={(value) => {
                      // Only the user's own typing saves: the editor may normalise the text on load.
                      if (!notesTouchedRef.current || value === form.notes) return;
                      patchTyped({ notes: value.trim() ? value : null });
                    }}
                    placeholder={t('contracts.placeholders.notes')}
                    minRows={4}
                    maxRows={14}
                    disabled={!editable}
                    hideToolbarUntilFocus
                    surface
                  />
                </React.Suspense>
              </Box>
            </Stack>
          </Stack>
        )}
        {form && tab === 'budget' && (
          <ContractBudgetTab
            key={form.id}
            contractId={form.id}
            readOnly={!editable}
            onChanged={refreshRelations}
            terms={shownData ? {
              auto_renewal: shownData.auto_renewal,
              disabled_at: shownData.disabled_at,
              current_term_end: shownData.current_term_end ?? null,
              updated_at: shownData.updated_at,
            } : null}
          />
        )}
        {form && tab === 'compliance' && (
          <ContractComplianceTab key={form.id} contractId={form.id} readOnly={!editable} />
        )}
        {form && tab === 'relations' && shownData && (
          <ContractRelationsTab
            key={form.id}
            contractId={form.id}
            readOnly={!editable}
            closedDocumentsCount={shownData.closed_documents_count ?? 0}
            onChanged={refreshRelations}
          />
        )}
        {form && tab === RECORD_HISTORY_TAB_KEY && (
          <WorkspaceTabBoundary resetKey={tab} onRetry={historyTab.retry}>
            <React.Suspense fallback={null}>
              <HistoryTab key={form.id} table="contracts" recordId={form.id} />
            </React.Suspense>
          </WorkspaceTabBoundary>
        )}
      </PortfolioDetailWorkspaceShell>
      {form?.disabled_at && (
        <ContractResumeRenewalDialog
          open={resumeRenewalOpen}
          contractId={form.id}
          endOfValidity={form.disabled_at}
          beforeResume={() => autosave.flush()}
          onClose={() => setResumeRenewalOpen(false)}
          onResumed={(renewal) => {
            setResumeRenewalOpen(false);
            queryClient.setQueryData(renewalQueryKey(form.id), renewal);
            refreshAfterDecision();
          }}
        />
      )}
      {form && schedule && (
        <ContractStopRenewalDialog
          open={stopRenewalOpen}
          contractId={form.id}
          startDate={form.start_date}
          renewals={renewedSoFar}
          fallbackEnd={schedule.termEnd}
          beforeStop={() => autosave.flush()}
          onClose={() => setStopRenewalOpen(false)}
          onStopped={(renewal) => {
            setStopRenewalOpen(false);
            queryClient.setQueryData(renewalQueryKey(form.id), renewal);
            refreshAfterDecision();
          }}
        />
      )}
    </Box>
  );
}
