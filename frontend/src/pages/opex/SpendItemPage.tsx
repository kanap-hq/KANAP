import React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useSpendNav } from '../../hooks/useSpendNav';
import { spendDetailQuery } from '../../hooks/budgetItemDetailQuery';
import { isReportView, useListFilters, writeListSnapshot } from '../../hooks/useListContextSearch';
import { STATUS_SCOPE_PARAM } from '../../utils/statusScopeParams';
import { compactListSearchCached } from '../../lib/listContext';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { axisRequiredFor, isHiddenAxis, useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { dimensionFieldPredicate, explicitSort, filtersStringOnShownColumns } from '../../components/finance/amountColumns';
import useAutosave, { autosaveErrorMessage, useAutosaveRegistry } from '../../hooks/useAutosave';
import { sendPatchBuffer, useSharedPatchBuffer } from '../../hooks/patchBuffer';
import { ConflictChoice, EditConflict, conflictCompanions, useEditConflicts, useOtherConflictTargets } from '../../hooks/editConflicts';
import { useLeaveGuard } from '../../hooks/leaveGuard';
import { useRequiredDimensionsLeave } from '../../hooks/useRequiredDimensionsLeave';
import EditConflictBanner, { OtherConflictsNotice } from '../../components/workspace/EditConflictBanner';
import OthersChangesNotice from '../../components/workspace/OthersChangesNotice';
import { useLineOthersChanges } from '../../components/finance/useLineOthersChanges';
import { useAuth } from '../../auth/AuthContext';
import { PRIMARY_SCROLL_ATTR } from '../../components/appScroll';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import { useKanapDialogs } from '../../components/design';
import { formatItemRef } from '../../utils/item-ref';
import {
  STATUS_DISABLED,
  StatusValue,
  deriveStatusFromDisabledAt,
  normalizeDisabledAtInput,
} from '../../constants/status';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import SpendMetadataBar from './workspace/SpendMetadataBar';
import SpendPropertiesDrawer, { RunBuild } from './workspace/SpendPropertiesDrawer';
import type { BudgetTabHandle } from '../../components/finance/BudgetTab';
import type { AllocationsTabHandle } from '../../components/finance/AllocationsTab';
import { namesInSentence, useHeldChoices } from '../../components/finance/heldChoices';
import { OPEX_FINANCE_CONFIG } from '../../components/finance/config';
import type { RelationsPanelHandle } from './editors/RelationsPanel';
import EntityTasksPanel from '../../components/EntityTasksPanel';
import { readStoredOpexListContext, writeStoredOpexListContext } from './listContextStorage';
import { fetchSpendRelationsCount } from '../../utils/workspaceTabCounts';
import useCurrencySettings from '../../hooks/useCurrencySettings';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { isoToLocalDateInput } from '../../lib/datetime';
import { analyticsValueOptions, itemReferences, matching, ownerName } from '../../components/finance/itemReferences';
import type { ItemAnalyticsValue } from '../../services/analytics';
import type { CostCenterNode } from '../../services/costCenters';

/** The list this workspace belongs to (its saved list contexts). */

// The Budget, Allocations and Relations tabs load with their tab (the Budget tab brings the charts):
// opening a line reads the overview's code only. `preloadTabs` fetches them once the line is shown;
// a tab whose code fails to load shows a retry button in its place (WorkspaceTabBoundary).
const budgetTab = retryableLazy(() => import('../../components/finance/BudgetTab'));
const allocationsTab = retryableLazy(() => import('../../components/finance/AllocationsTab'));
const relationsPanel = retryableLazy(() => import('./editors/RelationsPanel'));
const BudgetTab = budgetTab.Component;
const AllocationsTab = allocationsTab.Component;
const RelationsPanel = relationsPanel.Component;
const LAZY_TABS = [budgetTab, allocationsTab, relationsPanel];
function preloadTabs() {
  LAZY_TABS.forEach((tab) => tab.preload());
}
function retryTabs() {
  LAZY_TABS.forEach((tab) => tab.retry());
}

const LIST_ENDPOINT = '/spend-items/summary';

type TabKey = 'overview' | 'budget' | 'allocations' | 'relations';
const TAB_KEYS: TabKey[] = ['overview', 'budget', 'allocations', 'relations'];

type SpendForm = {
  id?: string;
  item_number?: number;
  product_name: string;
  description: string;
  supplier_id: string;
  currency: string;
  account_id: string;
  paying_company_id: string;
  effective_start: string;
  status: StatusValue;
  disabled_at: string | null;
  owner_it_id: string;
  owner_business_id: string;
  analytics_values: AnalyticsValues;
  cost_center_id: string;
  run_build: RunBuild | '';
  notes: string;
  created_at: string | null;
  updated_at: string | null;
};

/** The line's value per dimension id; null clears that dimension. */
type AnalyticsValues = Record<string, string | null>;

const EMPTY_FORM: SpendForm = {
  product_name: '', description: '', supplier_id: '', currency: 'EUR', account_id: '',
  paying_company_id: '', effective_start: '', status: 'enabled', disabled_at: null,
  owner_it_id: '', owner_business_id: '', analytics_values: {}, cost_center_id: '', run_build: '',
  notes: '', created_at: null, updated_at: null,
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptySpendForm(currency = 'EUR'): SpendForm {
  return {
    ...EMPTY_FORM,
    currency,
    effective_start: todayYmd(),
  };
}

function toNull(value: string): string | null {
  return value === '' ? null : value;
}

// The form keeps '' for an empty picker or text; the API stores null for these columns, as on create.
const NULLABLE_PATCH_FIELDS = new Set([
  'supplier_id',
  'account_id',
  'paying_company_id',
  'owner_it_id',
  'owner_business_id',
  'cost_center_id',
  'run_build',
  'disabled_at',
  'description',
  'notes',
]);

function normalizePatch(patch: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => {
    if (key === 'analytics_values') {
      return [key, Object.fromEntries(Object.entries(value as AnalyticsValues).map(([axisId, id]) => [axisId, id || null]))];
    }
    return [key, NULLABLE_PATCH_FIELDS.has(key) && value === '' ? null : value];
  }));
}

// Analytics values merge per dimension, so a change on one dimension keeps the others.
function mergePatch<T extends { analytics_values?: AnalyticsValues }>(prev: T, patch: Partial<T>): T {
  if (!patch.analytics_values) return { ...prev, ...patch };
  return { ...prev, ...patch, analytics_values: { ...prev.analytics_values, ...patch.analytics_values } };
}

// The detail lists the dimensions that hold a value on the line.
function toAnalyticsValues(data: any): AnalyticsValues {
  const list: ItemAnalyticsValue[] = Array.isArray(data?.analytics_values) ? data.analytics_values : [];
  return Object.fromEntries(list.filter((v) => !!v?.axis_id).map((v) => [String(v.axis_id), v.category_id ?? null]));
}

function toForm(data: any): SpendForm {
  const normalizedDisabledAt = data?.disabled_at ? new Date(data.disabled_at).toISOString() : null;
  return {
    id: data?.id,
    item_number: data?.item_number,
    product_name: data?.product_name || '',
    description: data?.description || '',
    supplier_id: data?.supplier_id || '',
    currency: (data?.currency || 'EUR').toUpperCase(),
    account_id: data?.account_id || '',
    paying_company_id: data?.paying_company_id || '',
    effective_start: data?.effective_start ? String(data.effective_start).slice(0, 10) : '',
    status: deriveStatusFromDisabledAt(normalizedDisabledAt),
    disabled_at: normalizedDisabledAt,
    owner_it_id: data?.owner_it_id || '',
    owner_business_id: data?.owner_business_id || '',
    analytics_values: toAnalyticsValues(data),
    cost_center_id: data?.cost_center_id || '',
    run_build: data?.run_build === 'run' || data?.run_build === 'build' ? data.run_build : '',
    notes: data?.notes || '',
    created_at: data?.created_at || null,
    updated_at: data?.updated_at || null,
  };
}

/** The label of each field the server may name in an edit conflict (lot 3C); analytics dimensions by their name. */
const CONFLICT_FIELD_LABELS: Record<string, string> = {
  product_name: 'opex.columns.productName',
  description: 'opex.fields.description',
  notes: 'opex.fields.notes',
  supplier_id: 'opex.fields.supplier',
  paying_company_id: 'opex.fields.payingCompany',
  account_id: 'opex.fields.account',
  currency: 'opex.fields.currency',
  cost_center_id: 'opex.fields.costCenter',
  run_build: 'opex.fields.runBuild',
  effective_start: 'opex.fields.effectiveStart',
  disabled_at: 'opex.fields.endOfValidity',
  owner_it_id: 'opex.metadata.itOwner',
  owner_business_id: 'opex.metadata.businessOwner',
};
const ANALYTICS_CONFLICT_PREFIX = 'analytics_values.';
const LONG_TEXT_FIELDS = new Set(['description', 'notes']);
const isLongTextField = (field: string) => LONG_TEXT_FIELDS.has(field);
/**
 * User values that go together (`conflictCompanions`): keeping their company drops the account
 * the user's company cleared, and keeping their account drops the user's company (their account
 * is on their company's chart); an end of validity goes with the status it sets.
 */
const CONFLICT_GROUPS = [['paying_company_id', 'account_id'], ['disabled_at', 'status']] as const;
/** The OPX reference of each line shown in the session: a choice waiting on another line is named by it. */
const lineRefs = new Map<string, string>();

/** The form with the stored value the server answered for a conflicting field (`analytics_values.<id>` per dimension). */
function withTheirValue(form: SpendForm, field: string, value: unknown): SpendForm {
  if (field.startsWith(ANALYTICS_CONFLICT_PREFIX)) {
    const axisId = field.slice(ANALYTICS_CONFLICT_PREFIX.length);
    return { ...form, analytics_values: { ...form.analytics_values, [axisId]: typeof value === 'string' && value ? value : null } };
  }
  // The form's own shape for a stored value: '' for empty, capitals for a currency, a date's day.
  const theirs = toForm({ [field]: value });
  if (field === 'disabled_at') return { ...form, disabled_at: theirs.disabled_at, status: theirs.status };
  return field in theirs ? { ...form, [field]: theirs[field as keyof SpendForm] } : form;
}

const sectionLabelSx = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1, display: 'block' } as const;
const composerSx = {
  '& .MuiInputBase-root': {
    bgcolor: 'kanap.bg.composer',
    border: '1px solid',
    borderColor: 'kanap.border.default',
    borderRadius: '8px',
    p: '14px 16px',
    fontSize: 14,
    lineHeight: 1.6,
    alignItems: 'flex-start',
  },
} as const;

export default function SpendItemPage() {
  const { t, i18n } = useTranslation(['ops', 'common']);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsString = searchParams.toString();
  const queryClient = useQueryClient();
  // An item opened from a one-off list view (a report link, `?from=report`) leaves the stored list
  // context alone: the view's state travels in the address.
  const reportView = React.useMemo(() => isReportView(location.search), [location.search]);
  const storedListContext = React.useMemo(() => (isReportView(location.search) ? null : readStoredOpexListContext()), []); // eslint-disable-line react-hooks/exhaustive-deps

  const idParam = String(params.id || '');
  const isCreate = idParam === 'new';
  const routeTab: TabKey = TAB_KEYS.includes(params.tab as TabKey) ? (params.tab as TabKey) : 'overview';

  // What others changed (lot 3G): set once the page's parts are known, below.
  const othersPendingRef = React.useRef<() => boolean>(() => false);
  const noteRowVersionRef = React.useRef<(lineId: string, rowVersion: unknown) => void>(() => undefined);
  const { data, error, isPlaceholderData, isFetchedAfterMount, isStale } = useQuery({
    // Shared with the neighbours' prefetch (previous / next show at once).
    ...spendDetailQuery(idParam),
    enabled: !isCreate,
    // Back on the tab, the line is read again when it is stale, unless something of the user is
    // pending (lot 3G): the poll below then says it changed elsewhere instead.
    refetchOnWindowFocus: () => !othersPendingRef.current(),
    // Keep the previous entry on screen while the next one loads (prev/next nav) —
    // no loading flash, the content swaps in place when ready.
    placeholderData: (previousData) => previousData,
  });

  // While `data` is placeholder it belongs to the PREVIOUS item (the next one is still
  // loading): block writes so an edit in that window can't land on the wrong item.
  const stale = isPlaceholderData;

  // Resolved UUID — every child tab / nested request keys off this, never the route param.
  const uuid = (data?.id as string | undefined) || (isCreate ? idParam : undefined);

  // Show the OPX-N reference in the address bar (router state keeps the UUID it matched).
  React.useEffect(() => {
    if (!data?.item_number) return;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(idParam);
    if (!isUuid) return;
    const ref = formatItemRef('opex', data.item_number);
    window.history.replaceState(null, '', `/ops/opex/${ref}/${routeTab}${location.search}`);
  }, [data?.item_number, idParam, routeTab, location.search]);

  // The other tabs' code loads in the background once a line is shown, so a tab switch does not wait for it.
  const lineShown = !!data?.id;
  React.useEffect(() => {
    if (!lineShown) return undefined;
    const timer = window.setTimeout(preloadTabs, 1000);
    return () => window.clearTimeout(timer);
  }, [lineShown]);

  // Tab badge counts.
  const relationsCountQuery = useQuery({
    // Keyed on the route's id or reference (`OPX-12`, which the endpoint resolves): it starts with the
    // detail, not after it.
    queryKey: ['spend-relations-count', idParam],
    queryFn: ({ signal }) => fetchSpendRelationsCount(idParam, signal),
    enabled: !!idParam && !isCreate,
  });

  const { data: currencySettings } = useCurrencySettings();
  const defaultSpendCurrency = React.useMemo(
    () => currencySettings?.defaultSpendCurrency?.toUpperCase() ?? 'EUR',
    [currencySettings],
  );
  const [form, setForm] = React.useState<SpendForm>(EMPTY_FORM);
  const [createForm, setCreateForm] = React.useState<SpendForm>(() => createEmptySpendForm());
  const [createCurrencyTouched, setCreateCurrencyTouched] = React.useState(false);
  const [createCompanyFromCostCenter, setCreateCompanyFromCostCenter] = React.useState(false);
  const [createSubmitting, setCreateSubmitting] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!isCreate) return;
    setCreateForm(createEmptySpendForm(defaultSpendCurrency));
    setCreateCurrencyTouched(false);
    setCreateCompanyFromCostCenter(false);
    setSaveError(null);
  }, [isCreate, idParam]);
  React.useEffect(() => {
    if (!isCreate || createCurrencyTouched) return;
    setCreateForm((prev) => (
      prev.currency === defaultSpendCurrency ? prev : { ...prev, currency: defaultSpendCurrency }
    ));
  }, [createCurrencyTouched, defaultSpendCurrency, isCreate]);

  const updateCreateForm = React.useCallback((patch: Partial<SpendForm>) => {
    setCreateForm((prev) => mergePatch(prev, patch));
    setSaveError(null);
  }, []);

  // A cost center picked while the paying company is empty brings its company, so the
  // account picker opens on that company's chart of accounts. The company keeps following
  // the cost center until the user picks a company or an account.
  const pickCreateCostCenter = React.useCallback((costCenterId: string, node: CostCenterNode | null) => {
    const companyId = costCenterId ? node?.company_id : null;
    const follow = !!companyId && (
      !createForm.paying_company_id || (createCompanyFromCostCenter && !createForm.account_id)
    );
    updateCreateForm({ cost_center_id: costCenterId, ...(follow && companyId ? { paying_company_id: companyId } : {}) });
    if (follow) setCreateCompanyFromCostCenter(true);
  }, [createCompanyFromCostCenter, createForm.account_id, createForm.paying_company_id, updateCreateForm]);

  const [createAccountCoaId, setCreateAccountCoaId] = React.useState<string | null>(null);
  const [createCompanyCoaId, setCreateCompanyCoaId] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!isCreate || !createForm.paying_company_id) {
        setCreateCompanyCoaId(null);
        return;
      }
      try {
        const res = await api.get(`/companies/${createForm.paying_company_id}`);
        if (alive) setCreateCompanyCoaId(res.data?.coa_id || null);
      } catch {
        if (alive) setCreateCompanyCoaId(null);
      }
    })();
    return () => { alive = false; };
  }, [createForm.paying_company_id, isCreate]);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!isCreate || !createForm.account_id) {
        setCreateAccountCoaId(null);
        return;
      }
      try {
        const res = await api.get(`/accounts/${createForm.account_id}`);
        if (alive) setCreateAccountCoaId(res.data?.coa_id || null);
      } catch {
        if (alive) setCreateAccountCoaId(null);
      }
    })();
    return () => { alive = false; };
  }, [createForm.account_id, isCreate]);
  const hasCreateObsoleteAccount = React.useMemo(() => {
    if (!isCreate || !createForm.account_id || !createForm.paying_company_id) return false;
    if (!createAccountCoaId || !createCompanyCoaId) return false;
    return createAccountCoaId !== createCompanyCoaId;
  }, [createAccountCoaId, createCompanyCoaId, createForm.account_id, createForm.paying_company_id, isCreate]);

  // List context for prev/next + return navigation.
  // The list's sort, '' for the default one: prev/next and the list then use the current default.
  const budgetColumns = useBudgetColumns();
  // The list builds a column for each enabled dimension besides the default one; a sort or filter
  // on another dimension falls back there, and here too.
  const analyticsAxes = useAnalyticsAxes({ scope: 'opex' });
  const isListField = React.useMemo(
    () => dimensionFieldPredicate(analyticsAxes.enabled.filter((axis) => !axis.is_default).map((axis) => axis.id)),
    [analyticsAxes],
  );
  // Filters saved as a context (`ctx`: a link opened in a new tab, a reload) are read first.
  const listFilters = useListFilters(searchParams, storedListContext);
  const listContextReady = budgetColumns.ready && analyticsAxes.ready && listFilters.ready;
  const sort = explicitSort(searchParams.get('sort') || storedListContext?.sort, budgetColumns.shown, budgetColumns.defaultSort, isListField);
  const q = searchParams.get('q') || storedListContext?.q || '';
  // A filter on a column that is not shown falls back like the list's, so prev/next walks the rows on screen.
  const filters = filtersStringOnShownColumns(listFilters.filters, budgetColumns.shown, isListField);
  // Status scope of the list we came from: in the address for a one-off view, else through the
  // stored list context (the grid keeps it in local state); it must be forwarded to prev/next or the navigation
  // walks a different set from the one on screen.
  const statusScope = searchParams.get(STATUS_SCOPE_PARAM) || storedListContext?.statusScope || 'enabled';
  React.useEffect(() => {
    if (listContextReady && !reportView) writeListSnapshot(LIST_ENDPOINT, { sort, q, filters, statusScope }, readStoredOpexListContext, writeStoredOpexListContext);
  }, [listContextReady, reportView, sort, q, filters, statusScope]);
  const buildListContextParams = React.useCallback(() => {
    const sp = new URLSearchParams(searchParamsString);
    if (sort) sp.set('sort', sort); else sp.delete('sort');
    if (!sp.get('q') && q) sp.set('q', q);
    if (!sp.get('filters') && filters) {
      sp.delete('ctx');
      sp.set('filters', filters);
    }
    // Filters too long for a URL go as `ctx` (saved by the navigation request already).
    return new URLSearchParams(compactListSearchCached(sp.toString(), LIST_ENDPOINT));
  }, [filters, q, searchParamsString, sort]);

  // The route's line, not the loaded detail: the position follows a click at once (fast clicks).
  const nav = useSpendNav({ id: idParam, sort: sort || null, q, filters, statusScope, enabled: listContextReady && !isCreate });
  const { index, total, hasPrev, hasNext, prevId, nextId } = isCreate
    ? { index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null as any, nextId: null as any }
    : nav;

  // Year for budget/allocations (?year=YYYY).
  const currentYear = React.useMemo(() => {
    const y = Number(searchParams.get('year'));
    return Number.isFinite(y) && y > 0 ? y : new Date().getFullYear();
  }, [searchParams]);
  const availableYears = React.useMemo(() => {
    const Y = new Date().getFullYear();
    return [Y - 2, Y - 1, Y, Y + 1, Y + 2];
  }, []);
  const setYear = (y: number) => {
    const next = buildListContextParams();
    next.set('year', String(y));
    setSearchParams(next, { replace: true });
  };

  // ----- Autosave (overview metadata / drawer / notes / title) -----
  const dialogs = useKanapDialogs();
  const autosaveRegistry = useAutosaveRegistry();
  const { profile, hasLevel } = useAuth();
  // Fields edited and not saved yet, each with the line it was edited on (the page
  // stays mounted from one line to the next): a field only ever goes to its own line.
  // Each also keeps the value the screen showed when its edit began (its base, lot 3C):
  // the server refuses a field someone else changed meanwhile (409 edit_conflict).
  // Kept for the session, not the page: a line left by the browser's back button, or a
  // save answered once the page went, keeps its choice for the next visit (lot 3C review).
  const patchBuffer = useSharedPatchBuffer<Partial<SpendForm>>('opex', mergePatch);
  const autosave = useAutosave({
    onError: (e) => setSaveError(autosaveErrorMessage(e, t, t('opex.editor.failedToSave'))),
    registry: autosaveRegistry,
    // A conflict waiting for the user's choice keeps the page busy: leaving asks first.
    held: patchBuffer.hasConflicts,
  });
  const conflicts = useEditConflicts(patchBuffer, isCreate ? null : uuid);
  // Lines left with a choice waiting (the browser's back button): named on this one.
  const otherConflictLines = useOtherConflictTargets(patchBuffer, isCreate ? null : uuid);
  React.useEffect(() => {
    if (data?.id && data?.item_number) lineRefs.set(data.id, formatItemRef('opex', data.item_number));
  }, [data?.id, data?.item_number]);
  const lineRef = React.useCallback((lineId: string) => lineRefs.get(lineId) ?? t('opex.workspace.spendItem'), [t]);
  const uuidRef = React.useRef(uuid);
  uuidRef.current = uuid;
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const formRef = React.useRef(form);
  formRef.current = form;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // A line changed during this visit and left without a value on a required dimension: leaving asks (lot D2).
  const requiredLeave = useRequiredDimensionsLeave({
    scope: 'opex',
    lineId: isCreate ? null : uuid,
    canEdit: hasLevel('opex', 'member'),
    axes: analyticsAxes,
    values: () => formRef.current.analytics_values,
    root: rootRef,
  });
  const { noteChange: noteLineChange, isBusy: requiredMissing, confirm: confirmRequired } = requiredLeave;
  // The form from the server copy, except the fields edited and not saved yet
  // (buffered, being sent, or waiting for a conflict choice): they keep the
  // user's values, newer than the server's.
  const syncForm = React.useCallback((stored: unknown) => {
    const next = toForm(stored);
    const held = next.id ? patchBuffer.held(next.id) : undefined;
    setForm(held ? mergePatch(next, held) : next);
  }, [patchBuffer]);
  // Resync the form on every refetch.
  React.useEffect(() => {
    if (!data || isCreate) return;
    syncForm(data);
  }, [data, isCreate, syncForm]);

  // Per field of an edit, the value the screen showed before it: the base the
  // server compares with what is stored (lot 3C). The status follows the end of
  // validity and has none of its own.
  const baseFor = React.useCallback((patch: Partial<SpendForm>): Partial<SpendForm> => {
    const shown = formRef.current;
    const base: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as Array<keyof SpendForm>) {
      if (key === 'status') continue;
      base[key] = key === 'analytics_values'
        ? Object.fromEntries(Object.keys(patch.analytics_values ?? {}).map((axisId) => [axisId, shown.analytics_values[axisId] ?? null]))
        : shown[key];
    }
    return base as Partial<SpendForm>;
  }, []);

  const invalidateLine = React.useCallback((lineId: string) => queryClient.invalidateQueries({
    queryKey: ['spend'],
    predicate: (q) => (q.state.data as { id?: string } | undefined)?.id === lineId,
  }), [queryClient]);

  const flushPending = React.useCallback(() => sendPatchBuffer(
    patchBuffer,
    async (lineId, patch, base) => {
      const body = normalizePatch({ ...patch });
      const baseBody = normalizePatch({ ...base });
      const res = await api.patch(`/spend-items/${lineId}`, Object.keys(baseBody).length > 0 ? { ...body, base: baseBody } : body);
      // The counter this save left: not someone else's change (lot 3G).
      noteRowVersionRef.current(lineId, res?.data?.row_version);
    },
    {
      onSaved: async (lineId) => {
        await invalidateLine(lineId);
        queryClient.invalidateQueries({ queryKey: ['spend-summary'] });
      },
      // Refused for good: the screen shows the line's stored values again for those fields.
      onRefused: (lineId, patch) => {
        const stored = dataRef.current;
        if (lineId === uuidRef.current && stored) {
          setForm((prev) => {
            if (prev.id !== lineId) return prev;
            const server = toForm(stored);
            const fields = (Object.keys(patch) as Array<keyof SpendForm>).filter((field) => !patchBuffer.holds(lineId, field));
            return fields.length ? { ...prev, ...Object.fromEntries(fields.map((field) => [field, server[field]])) } : prev;
          });
        }
        void invalidateLine(lineId);
      },
      // Someone else changed a field meanwhile: the line reloads (their other changes show),
      // the fields waiting for the user's choice keep the user's values.
      onConflict: (lineId) => { void invalidateLine(lineId); },
    },
  ), [patchBuffer, queryClient, invalidateLine]);

  // An edit still pending for the previous line (prev/next, back button) goes to that line now.
  const { flush: flushAutosave } = autosave;
  React.useEffect(() => {
    if (uuid && patchBuffer.holdsOtherThan(uuid)) void flushAutosave();
  }, [uuid, patchBuffer, flushAutosave]);
  // Edits an earlier visit of the page could not send (busy until it went) go now.
  const sendLeftovers = React.useRef(() => {
    if (!patchBuffer.hasUnsent()) return;
    autosave.schedule(flushPending);
    void autosave.flush();
  });
  React.useEffect(() => { sendLeftovers.current(); }, []);

  // Immediate persist — selects, dates, pickers, status, title-on-blur. Through the same
  // buffer as typing, sent at once: the field goes to its own line with its base, a busy
  // answer is retried, a refusal shows the stored value again, a conflict asks the user.
  const patchNow = React.useCallback(async (patch: Partial<SpendForm>) => {
    if (isCreate || !uuid || stale) return;
    noteLineChange(uuid);
    const base = baseFor(patch);
    setForm((prev) => mergePatch(prev, patch));
    setSaveError(null);
    // Text still waiting for its typing pause goes first, in a request of its own: a refusal
    // of one never drops the other (lot 3C review).
    await autosave.flush();
    const toSend = patchBuffer.add(uuid, patch, base);
    // A reload that landed during that save showed the stored value: the pick shows again.
    setForm((prev) => (prev.id === uuid ? mergePatch(prev, patch) : prev));
    // A field waiting for a choice keeps the new value with it, unsent.
    if (!toSend) return;
    autosave.schedule(flushPending);
    await autosave.flush();
  }, [isCreate, uuid, stale, noteLineChange, baseFor, patchBuffer, autosave, flushPending]);

  // The server refuses a company on another chart of accounts than the line's account, and the
  // account picker only lists the current company's chart: clear the account in the same write,
  // so the Account row asks for one on the new chart.
  const changePayingCompany = React.useCallback(async (companyId: string) => {
    const accountId = form.account_id;
    let clearAccount = false;
    if (accountId && companyId && companyId !== form.paying_company_id) {
      try {
        const [company, account] = await Promise.all([
          api.get(`/companies/${companyId}`),
          api.get(`/accounts/${accountId}`),
        ]);
        const companyCoa = company.data?.coa_id || null;
        const accountCoa = account.data?.coa_id || null;
        clearAccount = !!companyCoa && !!accountCoa && companyCoa !== accountCoa;
      } catch {
        // Unknown charts: send the company alone and let the server decide.
      }
    }
    await patchNow(clearAccount ? { paying_company_id: companyId, account_id: '' } : { paying_company_id: companyId });
  }, [form.account_id, form.paying_company_id, patchNow]);

  // Debounced persist — long-form notes / description while typing.
  const patchDebounced = React.useCallback((patch: Partial<SpendForm>) => {
    if (isCreate || !uuid || stale) return;
    noteLineChange(uuid);
    const base = baseFor(patch);
    setForm((prev) => mergePatch(prev, patch));
    // Typed in a field waiting for a choice: it stays with it, nothing is saved yet.
    if (patchBuffer.add(uuid, patch, base)) autosave.schedule(flushPending);
  }, [isCreate, uuid, stale, noteLineChange, autosave, flushPending, patchBuffer, baseFor]);

  // ----- Edit conflicts (lot 3C): someone else changed a field being saved -----
  const resolveConflict = React.useCallback((field: string, choice: ConflictChoice) => {
    if (!uuid) return;
    const asked = patchBuffer.conflictsOf(uuid);
    // Keeping their value of one field of a pair drops the user's value of the other (CONFLICT_GROUPS).
    const companions = choice === 'theirs' ? conflictCompanions(field, patchBuffer.waiting(uuid), CONFLICT_GROUPS) : [];
    const send = patchBuffer.resolve(uuid, field, choice, companions);
    if (choice === 'theirs') {
      // Their values at once, from the answer (the line reloads for the rest).
      const stored = dataRef.current ? toForm(dataRef.current) : null;
      setForm((prev) => {
        if (prev.id !== uuid) return prev;
        let next = prev;
        for (const path of [field, ...companions]) {
          const conflict = asked.find((entry) => entry.field === path);
          if (conflict) next = withTheirValue(next, path, conflict.current);
          else if (stored && path in stored && path !== 'status') next = { ...next, [path]: stored[path as keyof SpendForm] };
        }
        return next;
      });
    }
    void invalidateLine(uuid);
    if (send) {
      autosave.schedule(flushPending);
      void autosave.flush();
    } else {
      autosave.resetConflict();
    }
  }, [uuid, patchBuffer, invalidateLine, autosave, flushPending]);

  // After the last choice the banner goes: the focus moves to the field, or to the workspace's
  // content column (keyboard scrolling works from there), never to the page's body.
  const descriptionInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const notesInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const returnFocus = React.useCallback((field: string) => {
    const input = field === 'description' ? descriptionInputRef.current : field === 'notes' ? notesInputRef.current : null;
    (input ?? rootRef.current?.querySelector<HTMLElement>(`[${PRIMARY_SCROLL_ATTR}]`))?.focus({ preventScroll: true });
  }, []);

  const conflictFieldLabel = React.useCallback((field: string) => {
    if (field.startsWith(ANALYTICS_CONFLICT_PREFIX)) {
      const axisId = field.slice(ANALYTICS_CONFLICT_PREFIX.length);
      return analyticsAxes.label(analyticsAxes.axes.find((axis) => axis.id === axisId) ?? { name: null });
    }
    const key = CONFLICT_FIELD_LABELS[field];
    return key ? t(key) : field;
  }, [analyticsAxes, t]);

  const formatConflictValue = React.useCallback((field: string, value: unknown, conflict: EditConflict): string | undefined => {
    if (field === 'effective_start') return formatShortDate(String(value), locale, { year: 'always' });
    if (field === 'disabled_at') {
      // Two ends of validity on the same day differ by their time: show it.
      const day = (date: unknown) => (date ? formatShortDate(new Date(String(date)), locale, { year: 'always' }) : null);
      const sameDay = day(conflict.current) !== null && day(conflict.current) === day(conflict.mine);
      return sameDay ? formatShortDateTime(String(value), locale) : day(value) ?? undefined;
    }
    if (field === 'run_build' && (value === 'run' || value === 'build')) return t(`opex.runBuild.${value}`);
    return undefined;
  }, [locale, t]);

  // ----- Transitional ref-save tabs (budget / allocations / relations) -----
  const budgetRef = React.useRef<BudgetTabHandle>(null);
  // The paying company's country, for the budget tab: a new costed line starts on its standard calendar.
  const payingCompanyId = form.paying_company_id;
  const payingCompanyQuery = useQuery({
    queryKey: ['companies', payingCompanyId],
    queryFn: async () => (await api.get(`/companies/${payingCompanyId}`)).data,
    enabled: routeTab === 'budget' && !isCreate && !!payingCompanyId,
    staleTime: 5 * 60_000,
  });
  const payingCompanyCountry = (payingCompanyQuery.data as { country_iso?: string | null } | undefined)?.country_iso ?? null;
  const allocRef = React.useRef<AllocationsTabHandle>(null);
  // Budget and allocation choices kept for this line while the user is on another of its tabs.
  const heldChoices = useHeldChoices(uuid);
  const relationsRef = React.useRef<RelationsPanelHandle>(null);

  // Relations autosaves internally; flushAll drains any pending write on navigation.
  const activeRefEditor = React.useCallback(() => {
    if (routeTab === 'relations') return relationsRef.current;
    return null;
  }, [routeTab]);

  // ----- What others changed (lot 3G): the line, and the year's version on Budget and Allocations -----
  const others = useLineOthersChanges({
    itemsApi: '/spend-items',
    lineId: !isCreate && !stale ? uuid ?? null : null,
    // The counter the page starts from: a copy read since the page shows the line, or a fresh one
    // (a copy kept from an earlier visit is read again first: a change made meanwhile is not said).
    rowVersion: isFetchedAfterMount || !isStale ? data?.row_version : undefined,
    tab: routeTab,
    year: currentYear,
    root: rootRef,
    lineSaving: autosave.isSaving,
    linePending: () => !!uuidRef.current && (!!patchBuffer.held(uuidRef.current) || patchBuffer.conflictsOf(uuidRef.current).length > 0),
    budget: budgetRef,
    allocations: allocRef,
    heldChoices,
    otherTabDirty: () => !!activeRefEditor()?.isDirty?.(),
    // The detail again, unless a refetch (window focus) already brought that counter. A read that
    // fails rejects: nothing was shown, the counter stays for the next poll.
    refreshLine: async (rowVersion) => {
      const lineId = uuidRef.current;
      const shown = Number(dataRef.current?.row_version);
      if (!lineId || (rowVersion !== null && Number.isFinite(shown) && shown >= rowVersion)) return;
      await queryClient.invalidateQueries({
        queryKey: ['spend'],
        predicate: (q) => (q.state.data as { id?: string } | undefined)?.id === lineId,
      }, { throwOnError: true });
    },
  });
  othersPendingRef.current = others.hasPending;
  noteRowVersionRef.current = others.noteRowVersion;
  const noteBudgetRev = React.useCallback((year: number, rev: number | null) => {
    if (uuid) others.noteBudgetRev(uuid, year, rev);
  }, [uuid, others]);
  const knownBudgetRev = React.useCallback((year: number) => (uuid ? others.knownBudgetRev(uuid, year) : undefined), [uuid, others]);
  // A conflict banner of the line already says someone else changed it: no mark beside it.
  const conflictBannerShown = conflicts.length > 0
    || (routeTab === 'budget' && (budgetRef.current?.waitingColumns().length ?? 0) > 0)
    || (routeTab === 'allocations' && !!allocRef.current?.hasWaitingChoice());

  // Drain every pending write before a controlled transition. If a save fails we
  // return false so the caller aborts the navigation — no edit is silently lost.
  // The Budget and Allocations choices waiting on this line: the tab shown answers, a tab left
  // meanwhile kept its choice in `heldChoices` (lots 3D, 3E).
  const budgetChoices = React.useCallback((): string[] => (
    budgetRef.current?.waitingColumns() ?? (heldChoices.budget.current?.lineId === uuid ? heldChoices.budget.current?.labels ?? [] : [])
  ), [heldChoices, uuid]);
  const allocationChoice = React.useCallback((): boolean => (
    allocRef.current?.hasWaitingChoice() ?? heldChoices.allocation.current?.lineId === uuid
  ), [heldChoices, uuid]);

  // `ignoreHeld`: edits waiting for a choice stay (the page and its banner stay too).
  const flushAll = React.useCallback(async (options?: { ignoreHeld?: boolean }): Promise<boolean> => {
    const overviewOk = await autosave.flush(options);
    if (!overviewOk) return false;
    // Budget and Allocations autosave internally; flush() resolves false if the save rejected or a choice waits.
    if (routeTab === 'budget') {
      if (!((await budgetRef.current?.flush(options)) ?? true)) return false;
    } else if (routeTab === 'allocations') {
      if (!((await allocRef.current?.flush(options)) ?? true)) return false;
    } else {
      const editor = activeRefEditor();
      if (editor?.isDirty?.()) {
        try { await editor.save(); } catch { return false; }
      }
    }
    // A budget or allocation choice kept from a tab left meanwhile: only a move that keeps the line goes on.
    return !!options?.ignoreHeld || (budgetChoices().length === 0 && !allocationChoice());
  }, [autosave, activeRefEditor, routeTab, budgetChoices, allocationChoice]);

  const tabUnsaved = React.useCallback(() => (routeTab === 'budget' && !!budgetRef.current?.isDirty())
    || (routeTab === 'allocations' && !!allocRef.current?.isDirty())
    || !!activeRefEditor()?.isDirty?.(), [routeTab, activeRefEditor]);
  // Something would be lost by leaving: a save not done, a choice not made (on any line or tab).
  const unsavedWork = React.useCallback(
    () => autosaveRegistry.isBusy() || tabUnsaved() || budgetChoices().length > 0 || allocationChoice(),
    [autosaveRegistry, tabUnsaved, budgetChoices, allocationChoice],
  );

  // A save that still fails once flushed (the server stays busy, a tab keeps its edits) must not
  // trap the user on the line: leaving is offered, and drops what could not be saved.
  // `keepChoices` (a tab change, opening the line a choice waits on): the page stays, so an edit
  // waiting for a choice neither stops the move nor is dropped; only a failed save asks.
  const flushOrLeave = React.useCallback(async (options?: { keepChoices?: boolean }): Promise<boolean> => {
    const keepChoices = !!options?.keepChoices;
    if (await flushAll({ ignoreHeld: keepChoices })) return true;
    const unsaved = keepChoices ? autosave.isSaving() || tabUnsaved() : unsavedWork();
    // Nothing left unsaved (the save was refused and the screen reloaded): stay, the message shows why.
    if (!unsaved) return false;
    const elsewhere = patchBuffer.conflictTargets().filter((lineId) => lineId !== uuid);
    // Leaving the line drops a budget or allocation choice still waiting: the warning names it.
    const columns = keepChoices ? [] : budgetChoices();
    const message = columns.length > 0
      ? t('common:autosave.leaveColumnsMessage', { count: columns.length, columns: namesInSentence(locale, columns) })
      : !keepChoices && allocationChoice() ? t('common:autosave.leaveAllocationMessage')
        : keepChoices || !patchBuffer.hasConflicts() ? t('common:autosave.leaveMessage')
          : elsewhere.length > 0 && !(uuid && patchBuffer.conflictsOf(uuid).length > 0)
            ? t('common:autosave.leaveConflictOtherMessage', { items: elsewhere.map(lineRef).join(', ') })
            : t('common:autosave.leaveConflictMessage');
    const leave = await dialogs.confirm({
      title: t('common:autosave.leaveTitle'),
      message,
      confirmLabel: t('common:autosave.leaveConfirm'),
      intent: 'danger',
    });
    if (!leave) return false;
    autosaveRegistry.discardAll();
    // The budget and allocation choices kept for the line are lost with it.
    if (!keepChoices) {
      heldChoices.budget.current = null;
      heldChoices.allocation.current = null;
    }
    patchBuffer.discard({ keepChoices });
    setSaveError(null);
    if (dataRef.current) syncForm(dataRef.current);
    return true;
  }, [flushAll, autosave, tabUnsaved, unsavedWork, patchBuffer, uuid, t, lineRef, dialogs, autosaveRegistry, syncForm, budgetChoices, allocationChoice, heldChoices, locale]);

  // Leaving the line: what is not saved first, then a required dimension left without a value.
  // A tab change keeps the line and does not ask about the dimension.
  const leaveLine = React.useCallback(async (options?: { keepChoices?: boolean }): Promise<boolean> => (
    (await flushOrLeave(options)) && confirmRequired()
  ), [flushOrLeave, confirmRequired]);
  const leaveAsks = React.useCallback(() => unsavedWork() || requiredMissing(), [unsavedWork, requiredMissing]);

  // A link of the app (left menu, top bar, user menu) asks the same as the close button.
  useLeaveGuard(leaveAsks, leaveLine);

  const goToTab = React.useCallback(async (nextTab: TabKey) => {
    if (isCreate && nextTab !== 'overview') return;
    if (!(await flushOrLeave({ keepChoices: true }))) return;
    const sp = buildListContextParams();
    navigate(`/ops/opex/${idParam}/${nextTab}?${sp.toString()}`);
  }, [isCreate, flushOrLeave, buildListContextParams, navigate, idParam]);

  // The line a choice waits on: going there keeps the choice.
  const openConflictLine = React.useCallback(async (lineId: string) => {
    if (!(await leaveLine({ keepChoices: true }))) return;
    const sp = buildListContextParams();
    navigate(`/ops/opex/${lineId}/${routeTab}?${sp.toString()}`);
  }, [leaveLine, buildListContextParams, navigate, routeTab]);

  const confirmAndNavigate = React.useCallback(async (targetId: string | null) => {
    if (!targetId) return;
    if (!(await leaveLine())) return;
    const sp = buildListContextParams();
    navigate(`/ops/opex/${targetId}/${routeTab}?${sp.toString()}`);
  }, [leaveLine, buildListContextParams, navigate, routeTab]);

  const closeWorkspace = React.useCallback(async () => {
    if (!(await leaveLine())) return;
    const sp = buildListContextParams();
    const qs = sp.toString();
    navigate(`/ops/opex${qs ? `?${qs}` : ''}`);
  }, [leaveLine, buildListContextParams, navigate]);

  const handleCreate = React.useCallback(async () => {
    if (createSubmitting) return; // Ctrl+S bypasses the disabled button — guard double-submit
    const productName = createForm.product_name.trim();
    if (!productName) {
      setSaveError(t('opex.editor.productNameRequired'));
      return;
    }
    if ((createForm.currency || '').trim().length !== 3) {
      setSaveError(t('opex.editor.currencyMust3'));
      return;
    }
    if (!createForm.paying_company_id) {
      setSaveError(t('opex.editor.payingCompanyRequired'));
      return;
    }
    if (!createForm.account_id) {
      setSaveError(t('opex.editor.accountRequired'));
      return;
    }
    if (!createForm.effective_start) {
      setSaveError(t('opex.editor.effectiveStartRequired'));
      return;
    }
    // The server checks it too (and for every other source); the shown dimensions are the ones that apply.
    const missingDimension = analyticsAxes.enabled.find((axis) => axisRequiredFor(axis, 'opex') && !createForm.analytics_values[axis.id]);
    if (missingDimension) {
      setSaveError(t('opex.editor.dimensionRequired', { name: analyticsAxes.label(missingDimension) }));
      return;
    }

    setCreateSubmitting(true);
    setSaveError(null);
    try {
      const payload = {
        product_name: productName,
        description: toNull(createForm.description),
        supplier_id: toNull(createForm.supplier_id),
        currency: createForm.currency.toUpperCase(),
        account_id: createForm.account_id,
        paying_company_id: createForm.paying_company_id,
        effective_start: createForm.effective_start,
        ...(createForm.disabled_at
          ? { disabled_at: createForm.disabled_at, status: deriveStatusFromDisabledAt(createForm.disabled_at) }
          : {}),
        owner_it_id: toNull(createForm.owner_it_id),
        owner_business_id: toNull(createForm.owner_business_id),
        // Only the dimensions given a value: the others stay empty on the new line. A value picked on a
        // dimension since disabled or limited to the other type is no longer shown, and is not sent.
        analytics_values: Object.fromEntries(Object.entries(createForm.analytics_values)
          .filter(([axisId, id]) => !!id && !isHiddenAxis(analyticsAxes, axisId))),
        cost_center_id: toNull(createForm.cost_center_id),
        run_build: toNull(createForm.run_build),
        notes: toNull(createForm.notes),
      };
      const res = await api.post('/spend-items', payload);
      const newId = res.data?.id as string | undefined;
      if (!newId) throw new Error(t('opex.editor.failedToCreate'));
      queryClient.invalidateQueries({ queryKey: ['spend-summary'] });
      queryClient.invalidateQueries({ queryKey: ['spend-items-summary-neighbors'] });
      const sp = buildListContextParams();
      navigate(`/ops/opex/${newId}/overview?${sp.toString()}`);
    } catch (e) {
      setSaveError(getApiErrorMessage(e, t, t('opex.editor.failedToCreate')));
    } finally {
      setCreateSubmitting(false);
    }
  }, [analyticsAxes, buildListContextParams, createForm, createSubmitting, navigate, queryClient, t]);

  // ----- Status lifecycle handlers -----
  const handleStatusChange = (next: StatusValue) => {
    // Disabled with no end of validity: the server sets it (now, or keeps one already passed).
    // Each window sending its own clock's now would make two people disabling the line a
    // conflict on the end of validity (lot 3C review).
    if (next === STATUS_DISABLED && !form.disabled_at) {
      void patchNow({ status: STATUS_DISABLED });
      return;
    }
    const disabled_at = next === STATUS_DISABLED ? form.disabled_at : null;
    void patchNow({ status: deriveStatusFromDisabledAt(disabled_at), disabled_at });
  };
  const handleDisabledAtChange = (next: string | null) => {
    const disabled_at = normalizeDisabledAtInput(next);
    void patchNow({ status: deriveStatusFromDisabledAt(disabled_at), disabled_at });
  };

  // Labels of the line's references, from the detail: the pickers and the owners show them without any request.
  const references = React.useMemo(() => itemReferences(data), [data]);
  // The cost center shown with that reference, read from the same line: on a line switch the detail
  // is the new line's one render before the form follows, and the old line's id would not match the
  // new reference (the pickers would then load the tree to name it).
  const shownCostCenterId = data?.id && form.id !== data.id ? (data.cost_center_id || '') : form.cost_center_id;
  const analyticsOptions = React.useMemo(() => analyticsValueOptions(data), [data]);

  const reference = data?.item_number ? formatItemRef('opex', data.item_number) : null;
  const { addToRecent } = useRecentlyViewed();
  React.useEffect(() => {
    if (!isCreate && data?.id && data?.product_name) addToRecent('spend_item', data.id, data.product_name, reference || undefined);
  }, [addToRecent, data?.id, data?.product_name, isCreate, reference]);

  const tabs = React.useMemo(() => ([
    { key: 'overview', label: t('opex.tabs.overview') },
    { key: 'budget', label: t('opex.tabs.budget') },
    { key: 'allocations', label: t('opex.tabs.allocations') },
    { key: 'relations', label: t('opex.tabs.relations') },
  ] as Array<{ key: TabKey; label: string }>), [t]);

  const savingHint = autosave.status === 'saving' || autosave.status === 'pending'
    ? t('common:status.saving', 'Saving…')
    : autosave.status === 'saved'
      ? t('common:status.saved', 'Saved')
      : null;

  return (
    <Box ref={rootRef} sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!!error && <Alert severity="error" sx={{ mx: 2, mt: 1 }}>{t('opex.workspace.failedToLoad')}</Alert>}
      {!!saveError && <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setSaveError(null)}>{saveError}</Alert>}
      {!isCreate && (
        <EditConflictBanner
          conflicts={conflicts}
          fieldLabel={conflictFieldLabel}
          formatValue={formatConflictValue}
          isLongText={isLongTextField}
          onResolve={resolveConflict}
          busy={autosave.status === 'saving'}
          currentUserId={profile?.id ?? null}
          returnFocus={returnFocus}
        />
      )}
      {!isCreate && (
        <OtherConflictsNotice
          items={otherConflictLines.map((lineId) => ({ id: lineId, label: lineRef(lineId) }))}
          onOpen={(lineId) => { void openConflictLine(lineId); }}
        />
      )}

      <PortfolioDetailWorkspaceShell
        activeTab={routeTab}
        tabs={tabs.map((tab) => ({
          ...tab,
          disabled: isCreate && tab.key !== 'overview',
          badge: tab.key === 'relations' ? (relationsCountQuery.data || undefined) : undefined,
        }))}
        onTabChange={(next) => { void goToTab(next as TabKey); }}
        drawerStorageKey="kanap.opex.drawerOpen"
        backLabel={t('opex.workspace.spendItems', 'Spend items')}
        onBack={() => { void closeWorkspace(); }}
        itemReference={reference}
        onCopyReference={reference ? () => { void navigator.clipboard?.writeText(reference); } : undefined}
        title={isCreate ? createForm.product_name : form.product_name}
        titleFallback={isCreate ? t('opex.workspace.newSpendItem') : t('opex.workspace.spendItem')}
        canEditTitle
        onTitleSave={(value) => {
          if (isCreate) {
            updateCreateForm({ product_name: value });
          } else {
            void patchNow({ product_name: value });
          }
        }}
        isCreate={isCreate}
        forceDrawerOpen={isCreate}
        drawerOpenRequest={requiredLeave.drawerOpenRequest}
        nav={!isCreate && total > 0 ? {
          currentIndex: index + 1,
          totalCount: total,
          hasPrev,
          hasNext,
          onPrev: () => { void confirmAndNavigate(prevId); },
          onNext: () => { void confirmAndNavigate(nextId); },
          previousLabel: t('opex.workspace.prev'),
          nextLabel: t('opex.workspace.next'),
        } : undefined}
        onSaveShortcut={() => { if (isCreate) { void handleCreate(); } else { void flushAll(); } }}
        metadata={!isCreate ? (
          <SpendMetadataBar
            ownerItName={ownerName(references.owner_it, form.owner_it_id)}
            ownerBizName={ownerName(references.owner_business, form.owner_business_id)}
            status={form.status}
            ownerItId={form.owner_it_id || null}
            ownerBizId={form.owner_business_id || null}
            costCenterId={shownCostCenterId || null}
            costCenter={matching(references.cost_center, shownCostCenterId)}
            onStatusChange={handleStatusChange}
            onOwnerItChange={(v) => void patchNow({ owner_it_id: (v || '') as string })}
            onOwnerBizChange={(v) => void patchNow({ owner_business_id: (v || '') as string })}
          />
        ) : undefined}
        actions={(
          <>
            {!isCreate && (
              <OthersChangesNotice
                notice={others.notice}
                gone={others.gone}
                outdated={conflictBannerShown ? null : others.outdated}
                reloading={others.reloading}
                onReload={() => { void others.reload(); }}
                currentUserId={profile?.id ?? null}
              />
            )}
            {savingHint && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center', mr: 0.5 }}>
                {savingHint}
              </Typography>
            )}
            {!isCreate && uuid && (
              <SendLinkButton
                itemType="opex"
                itemId={uuid}
                itemName={form.product_name || t('opex.workspace.spendItem')}
                itemNumber={data?.item_number}
              />
            )}
            {isCreate && (
              <Button variant="contained" size="small" onClick={() => void handleCreate()} disabled={createSubmitting}>
                {t('common:buttons.create')}
              </Button>
            )}
            <IconButton aria-label={t('common:buttons.close')} title={t('common:buttons.close')} size="small" onClick={() => { void closeWorkspace(); }}>
              <CloseIcon />
            </IconButton>
          </>
        )}
        properties={isCreate ? (
          <SpendPropertiesDrawer
            mode="create"
            supplierId={createForm.supplier_id}
            payingCompanyId={createForm.paying_company_id}
            accountId={createForm.account_id}
            currency={createForm.currency}
            analyticsValues={createForm.analytics_values}
            costCenterId={createForm.cost_center_id}
            runBuild={createForm.run_build}
            effectiveStart={createForm.effective_start}
            disabledAt={createForm.disabled_at}
            ownerItId={createForm.owner_it_id}
            ownerBusinessId={createForm.owner_business_id}
            disabled={createSubmitting}
            onSupplierChange={(v) => updateCreateForm({ supplier_id: v })}
            onPayingCompanyChange={(v) => {
              setCreateCompanyFromCostCenter(false);
              updateCreateForm({ paying_company_id: v });
            }}
            onAccountChange={(v) => updateCreateForm({ account_id: v })}
            onCurrencyChange={(v) => {
              setCreateCurrencyTouched(true);
              updateCreateForm({ currency: v.toUpperCase() });
            }}
            onAnalyticsValueChange={(axisId, v) => updateCreateForm({ analytics_values: { [axisId]: v } })}
            onCostCenterChange={pickCreateCostCenter}
            onRunBuildChange={(v) => updateCreateForm({ run_build: v })}
            onEffectiveStartChange={(v) => updateCreateForm({ effective_start: v })}
            onDisabledAtChange={(v) => updateCreateForm({ disabled_at: v, status: deriveStatusFromDisabledAt(v) })}
            onOwnerItChange={(v) => updateCreateForm({ owner_it_id: v })}
            onOwnerBusinessChange={(v) => updateCreateForm({ owner_business_id: v })}
          />
        ) : (
          <SpendPropertiesDrawer
            mode="edit"
            references={references}
            analyticsOptions={analyticsOptions}
            supplierId={form.supplier_id}
            payingCompanyId={form.paying_company_id}
            accountId={form.account_id}
            currency={form.currency}
            analyticsValues={form.analytics_values}
            costCenterId={shownCostCenterId}
            runBuild={form.run_build}
            effectiveStart={form.effective_start}
            status={form.status}
            disabledAt={form.disabled_at}
            createdAt={form.created_at}
            updatedAt={form.updated_at}
            onSupplierChange={(v) => void patchNow({ supplier_id: v })}
            onPayingCompanyChange={(v) => void changePayingCompany(v)}
            onAccountChange={(v) => void patchNow({ account_id: v })}
            onCurrencyChange={(v) => void patchNow({ currency: v.toUpperCase() })}
            onAnalyticsValueChange={(axisId, v) => void patchNow({ analytics_values: { [axisId]: v } })}
            onCostCenterChange={(v) => void patchNow({ cost_center_id: v })}
            onRunBuildChange={(v) => void patchNow({ run_build: v })}
            onEffectiveStartChange={(v) => void patchNow({ effective_start: v })}
            onDisabledAtChange={handleDisabledAtChange}
          />
        )}
      >
        {routeTab === 'overview' && (
          isCreate ? (
            <Stack spacing={3} sx={{ pt: 1 }}>
              {hasCreateObsoleteAccount && (
                <Alert severity="warning">
                  {t('opex.editor.obsoleteAccount')}
                </Alert>
              )}
              <Box>
                <Typography component="label" sx={sectionLabelSx}>{t('opex.fields.description')}</Typography>
                <TextField
                  value={createForm.description}
                  onChange={(e) => updateCreateForm({ description: e.target.value })}
                  multiline minRows={3} fullWidth variant="standard"
                  placeholder={t('opex.fields.descriptionPlaceholder', 'e.g., annual subscription for monitoring')}
                  sx={composerSx}
                  disabled={createSubmitting}
                />
              </Box>
              <Box>
                <Typography component="label" sx={sectionLabelSx}>{t('opex.fields.notes')}</Typography>
                <TextField
                  value={createForm.notes}
                  onChange={(e) => updateCreateForm({ notes: e.target.value })}
                  multiline minRows={3} fullWidth variant="standard"
                  placeholder={t('opex.fields.notesPlaceholder', 'e.g., renewal negotiated in Q3')}
                  sx={composerSx}
                  disabled={createSubmitting}
                />
              </Box>
            </Stack>
          ) : (
            <Stack spacing={3} sx={{ pt: 1 }}>
              <Box>
                <Typography component="label" sx={sectionLabelSx}>{t('opex.fields.description')}</Typography>
                <TextField
                  value={form.description}
                  inputRef={descriptionInputRef}
                  onChange={(e) => patchDebounced({ description: e.target.value })}
                  multiline minRows={3} fullWidth variant="standard"
                  placeholder={t('opex.fields.descriptionPlaceholder', 'e.g., annual subscription for monitoring')}
                  sx={composerSx}
                />
              </Box>
              <Box>
                <Typography component="label" sx={sectionLabelSx}>{t('opex.fields.notes')}</Typography>
                <TextField
                  value={form.notes}
                  inputRef={notesInputRef}
                  onChange={(e) => patchDebounced({ notes: e.target.value })}
                  multiline minRows={3} fullWidth variant="standard"
                  placeholder={t('opex.fields.notesPlaceholder', 'e.g., renewal negotiated in Q3')}
                  sx={composerSx}
                />
              </Box>
              {uuid && <EntityTasksPanel key={uuid} entityType="spend_item" entityId={uuid} />}
            </Stack>
          )
        )}

        {/* No progress bar while a tab's code loads: the empty tab, then its content. */}
        <WorkspaceTabBoundary resetKey={routeTab} onRetry={retryTabs}>
          <React.Suspense fallback={null}>
            {routeTab === 'budget' && !isCreate && uuid && (
              <BudgetTab key={uuid} id={uuid} year={currentYear} currency={form.currency} availableYears={availableYears} onYearChange={setYear} config={OPEX_FINANCE_CONFIG} effectiveStart={form.effective_start} endOfValidity={isoToLocalDateInput(form.disabled_at)} payingCompanyCountry={payingCompanyCountry} held={heldChoices.budget} onBudgetRev={noteBudgetRev} ref={budgetRef} />
            )}
            {routeTab === 'allocations' && !isCreate && uuid && (
              <AllocationsTab key={uuid} id={uuid} year={currentYear} currency={form.currency} availableYears={availableYears} onYearChange={setYear} config={OPEX_FINANCE_CONFIG} held={heldChoices.allocation} onBudgetRev={noteBudgetRev} knownBudgetRev={knownBudgetRev} ref={allocRef} />
            )}
            {routeTab === 'relations' && !isCreate && uuid && (
              <RelationsPanel key={uuid} id={uuid} ref={relationsRef} autoSave onRelationsChange={() => { void relationsCountQuery.refetch(); }} />
            )}
          </React.Suspense>
        </WorkspaceTabBoundary>
      </PortfolioDetailWorkspaceShell>
      {requiredLeave.dialog}
    </Box>
  );
}
