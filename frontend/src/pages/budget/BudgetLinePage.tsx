import React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, IconButton, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useBudgetLineNav } from '../../hooks/useBudgetLineNav';
import type { LineType } from '../../constants/lineTypeUsage';
import { BUDGET_NATURE_CONFIG } from './natureConfig';
import { budgetLineDetailQuery } from '../../hooks/budgetItemDetailQuery';
import { isReportView, useListFilters, writeListSnapshot } from '../../hooks/useListContextSearch';
import { STATUS_SCOPE_PARAM } from '../../utils/statusScopeParams';
import { compactListSearchCached } from '../../lib/listContext';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { axisRequiredFor, useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { explicitSort, filtersStringOnShownColumns } from '../../components/finance/amountColumns';
import useAutosave, { autosaveErrorMessage, useAutosaveRegistry } from '../../hooks/useAutosave';
import { sendPatchBuffer, useSharedPatchBuffer } from '../../hooks/patchBuffer';
import { ConflictChoice, EditConflict, conflictCompanions, useEditConflicts, useOtherConflictTargets } from '../../hooks/editConflicts';
import { useLeaveGuard } from '../../hooks/leaveGuard';
import { ANALYTICS_AXIS_FIELD_ATTR, useRequiredDimensionsLeave } from '../../hooks/useRequiredDimensionsLeave';
import { useLinePlacementDefault, useLinePlacementFilter } from '../../hooks/usePlacementOptions';
import EditConflictBanner, { OtherConflictsNotice } from '../../components/workspace/EditConflictBanner';
import OthersChangesNotice from '../../components/workspace/OthersChangesNotice';
import { useLineOthersChanges } from '../../components/finance/useLineOthersChanges';
import { useAuth } from '../../auth/AuthContext';
import { isDataAccessLimited } from '../../auth/dataAccess';
import { PRIMARY_SCROLL_ATTR } from '../../components/appScroll';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import { useKanapDialogs } from '../../components/design';
import { formatItemRef } from '../../utils/item-ref';
import {
  STATUS_DISABLED,
  StatusValue,
  deriveStatusFromDisabledAt,
  normalizeDisabledAtInput,
  statusChoicePatch,
} from '../../constants/status';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import RecordDeleteButton from '../../components/workspace/RecordDeleteButton';
import { missingFieldsList } from '../../components/workspace/creation/missingFieldsList';
import ChangeTypeDialog, { type ChangeTypeResult } from '../../components/finance/ChangeTypeDialog';
import LineLineage, { type LineageLine } from '../../components/finance/LineLineage';
import { budgetLinePath, openLineAfterTypeChange } from '../../components/finance/changeTypeNavigation';
import { invalidateBudgetLists } from '../../components/finance/budgetFile';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import BudgetMetadataBar from './workspace/BudgetMetadataBar';
import BudgetPropertiesDrawer, { LINE_FIELD_ATTR, RunBuild } from './workspace/BudgetPropertiesDrawer';
import useIncompleteLeave from '../../components/workspace/creation/useIncompleteLeave';
import { CreationActions, CreationPreview, useCreationReturn, useRecordCreation, useTitleCreation } from '../../components/workspace/creation';
import type { BudgetTabHandle } from '../../components/finance/BudgetTab';
import type { AllocationsTabHandle } from '../../components/finance/AllocationsTab';
import { namesInSentence, useHeldChoices } from '../../components/finance/heldChoices';
import EntityTasksPanel from '../../components/EntityTasksPanel';
import { budgetListFieldPredicate } from './listFields';
import { readStoredBudgetListContext, writeStoredBudgetListContext } from './listContextStorage';
import { fetchBudgetRelationsCount } from '../../utils/workspaceTabCounts';
import useCurrencySettings from '../../hooks/useCurrencySettings';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { isoToLocalDateInput } from '../../lib/datetime';
import { analyticsValueOptions, itemReferences, matching, ownerName } from '../../components/finance/itemReferences';
import type { ItemAnalyticsValue } from '../../services/analytics';
import type { CostCenterNode } from '../../services/costCenters';
import { useCostCenterNode } from '../../hooks/useCostCenterTree';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';

/** The list this workspace belongs to (its saved list contexts). */

// The Budget, Allocations, Relations and History tabs load with their tab (the Budget tab brings
// the charts): opening a line reads the overview's code only. `preloadTabs` fetches them once the
// line is shown; a tab whose code fails to load shows a retry button in its place
// (WorkspaceTabBoundary).
const budgetTab = retryableLazy(() => import('../../components/finance/BudgetTab'));
const allocationsTab = retryableLazy(() => import('../../components/finance/AllocationsTab'));
const relationsTab = retryableLazy(() => import('./workspace/BudgetLineRelationsTab'));
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const BudgetTab = budgetTab.Component;
const AllocationsTab = allocationsTab.Component;
const RelationsTab = relationsTab.Component;
const HistoryTab = historyTab.Component;
const LAZY_TABS = [budgetTab, allocationsTab, relationsTab, historyTab];
function preloadTabs() {
  LAZY_TABS.forEach((tab) => tab.preload());
}
function retryTabs() {
  LAZY_TABS.forEach((tab) => tab.retry());
}


type TabKey = 'overview' | 'budget' | 'allocations' | 'relations' | typeof RECORD_HISTORY_TAB_KEY;
const TAB_KEYS: TabKey[] = ['overview', 'budget', 'allocations', 'relations', RECORD_HISTORY_TAB_KEY];

type BudgetLineForm = {
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

const EMPTY_FORM: BudgetLineForm = {
  product_name: '', description: '', supplier_id: '', currency: 'EUR', account_id: '',
  paying_company_id: '', effective_start: '', status: 'enabled', disabled_at: null,
  owner_it_id: '', owner_business_id: '', analytics_values: {}, cost_center_id: '', run_build: '',
  notes: '', created_at: null, updated_at: null,
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

/** A new line before its title: the draft its preview shows, with the defaults the title creates it with. */
function draftBudgetLineForm(currency = 'EUR'): BudgetLineForm {
  return {
    ...EMPTY_FORM,
    currency,
    effective_start: todayYmd(),
  };
}

/** The preview of a new line is out of reach: its handlers never run. */
const ignoreDraftChange = () => undefined;

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

function toForm(data: any): BudgetLineForm {
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
/** The BL reference of each line shown in the session: a choice waiting on another line is named by it. */
const lineRefs = new Map<string, string>();

/** The form with the stored value the server answered for a conflicting field (`analytics_values.<id>` per dimension). */
function withTheirValue(form: BudgetLineForm, field: string, value: unknown): BudgetLineForm {
  if (field.startsWith(ANALYTICS_CONFLICT_PREFIX)) {
    const axisId = field.slice(ANALYTICS_CONFLICT_PREFIX.length);
    return { ...form, analytics_values: { ...form.analytics_values, [axisId]: typeof value === 'string' && value ? value : null } };
  }
  // The form's own shape for a stored value: '' for empty, capitals for a currency, a date's day.
  const theirs = toForm({ [field]: value });
  if (field === 'disabled_at') return { ...form, disabled_at: theirs.disabled_at, status: theirs.status };
  return field in theirs ? { ...form, [field]: theirs[field as keyof BudgetLineForm] } : form;
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

/** A move off the line, once pending edits are handled: all saved, dropped by the user's choice, or stay. */
type FlushOutcome = 'saved' | 'dropped' | 'stay';

export default function BudgetLinePage({ nature }: { nature: LineType }) {
  const config = BUDGET_NATURE_CONFIG[nature];
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
  const LIST_ENDPOINT = '/budget-lines/summary';
  const storedListContext = React.useMemo(() => (isReportView(location.search) ? null : readStoredBudgetListContext()), []); // eslint-disable-line react-hooks/exhaustive-deps

  const idParam = String(params.ref || (location.pathname.endsWith('/new') ? 'new' : ''));
  const isCreate = idParam === 'new';
  const routeTab: TabKey = TAB_KEYS.includes(params.tab as TabKey) ? (params.tab as TabKey) : 'overview';
  // Once deleted, the line is never loaded again, even while the page waits for the list.
  const [deleted, setDeleted] = React.useState(false);

  // What others changed (lot 3G): set once the page's parts are known, below.
  const othersPendingRef = React.useRef<() => boolean>(() => false);
  const noteRowVersionRef = React.useRef<(lineId: string, rowVersion: unknown) => void>(() => undefined);
  const { data, error, isPlaceholderData, isFetchedAfterMount, isStale } = useQuery({
    // Shared with the neighbours' prefetch (previous / next show at once).
    ...budgetLineDetailQuery(idParam),
    enabled: !isCreate && !deleted,
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

  // The other tabs' code loads in the background once a line is shown, so a tab switch does not wait for it.
  const lineShown = !!data?.id;
  React.useEffect(() => {
    if (!lineShown) return undefined;
    const timer = window.setTimeout(preloadTabs, 1000);
    return () => window.clearTimeout(timer);
  }, [lineShown]);

  // Tab badge counts.
  const relationsCountQuery = useQuery({
    // Keyed on the route's id or reference (`BL-12`, which the endpoint resolves): it starts with the
    // detail, not after it.
    queryKey: ['budget-relations-count', nature, idParam],
    queryFn: ({ signal }) => fetchBudgetRelationsCount(config, idParam, signal),
    enabled: !!idParam && !isCreate,
  });

  const { data: currencySettings, isLoading: currencyLoading } = useCurrencySettings();
  const defaultSpendCurrency = React.useMemo(
    () => currencySettings?.defaultSpendCurrency?.toUpperCase() ?? 'EUR',
    [currencySettings],
  );
  const [form, setForm] = React.useState<BudgetLineForm>(EMPTY_FORM);
  const draftForm = React.useMemo(() => draftBudgetLineForm(defaultSpendCurrency), [defaultSpendCurrency]);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  // A person with limited data access places the new line before its title: filled in when the
  // access allows one company only, chosen on the new page otherwise (`useLinePlacementDefault`).
  const placementDefault = useLinePlacementDefault();
  const placementAsked = isCreate && placementDefault.needsChoice;
  const [placementDraft, setPlacementDraft] = React.useState({ paying_company_id: '', cost_center_id: '', followsCostCenter: false });
  const draftPlacementFilter = useLinePlacementFilter(placementAsked ? placementDraft.paying_company_id || null : null);
  const placementReady = !placementAsked || !!placementDraft.cost_center_id
    || (!!placementDraft.paying_company_id && !draftPlacementFilter?.costCenterRequired);
  React.useEffect(() => {
    if (!isCreate) return;
    setPlacementDraft({ paying_company_id: '', cost_center_id: '', followsCostCenter: false });
    setSaveError(null);
  }, [isCreate, idParam, nature]);
  // A cost center picked while the paying company is empty brings its company; the company keeps
  // following the cost center until the person picks a company.
  const pickDraftCostCenter = React.useCallback((costCenterId: string, node: CostCenterNode | null) => {
    setPlacementDraft((prev) => {
      const companyId = costCenterId ? node?.company_id : null;
      const follow = !!companyId && (!prev.paying_company_id || prev.followsCostCenter);
      return {
        cost_center_id: costCenterId,
        paying_company_id: follow && companyId ? companyId : prev.paying_company_id,
        followsCostCenter: follow,
      };
    });
  }, []);

  // List context for prev/next + return navigation.
  // The list's sort, '' for the default one: prev/next and the list then use the current default.
  const budgetColumns = useBudgetColumns();
  // The list builds a column for each enabled dimension besides the default one; a sort or filter
  // on another dimension falls back there, and here too.
  const analyticsAxes = useAnalyticsAxes({ scope: nature });
  const listAxes = useAnalyticsAxes({ scope: null });
  const isListField = React.useMemo(
    () => budgetListFieldPredicate(listAxes.enabled.filter((axis) => !axis.is_default).map((axis) => axis.id)),
    [listAxes],
  );
  // Filters saved as a context (`ctx`: a link opened in a new tab, a reload) are read first.
  const listFilters = useListFilters(searchParams, storedListContext);
  const listContextReady = budgetColumns.ready && listAxes.ready && listFilters.ready;
  const sort = explicitSort(searchParams.get('sort') || storedListContext?.sort, budgetColumns.shown, budgetColumns.defaultSort, isListField);
  const q = searchParams.get('q') || storedListContext?.q || '';
  // A filter on a column that is not shown falls back like the list's, so prev/next walks the rows on screen.
  const filters = filtersStringOnShownColumns(listFilters.filters, budgetColumns.shown, isListField);
  // Status scope of the list we came from: in the address for a one-off view, else through the
  // stored list context (the grid keeps it in local state); it must be forwarded to prev/next or the navigation
  // walks a different set from the one on screen.
  const statusScope = searchParams.get(STATUS_SCOPE_PARAM) || storedListContext?.statusScope || 'enabled';
  React.useEffect(() => {
    if (listContextReady && !reportView) writeListSnapshot(LIST_ENDPOINT, { sort, q, filters, statusScope }, readStoredBudgetListContext, writeStoredBudgetListContext);
  }, [listContextReady, reportView, sort, q, filters, statusScope, LIST_ENDPOINT]);
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
  }, [filters, q, searchParamsString, sort, LIST_ENDPOINT]);

  // The route's line, not the loaded detail: the position follows a click at once (fast clicks).
  const nav = useBudgetLineNav({ id: idParam, sort: sort || null, q, filters, statusScope, enabled: listContextReady && !isCreate }, nature, true);
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
  const { profile, hasLevel, dataAccess } = useAuth();
  // A budget reader sees the line with no field, menu or tab control that writes; so does a person
  // whose data access leaves this line read only (`editable: false`, absent for unscoped persons).
  const lineEditable = isCreate || data?.editable !== false;
  const readOnlyInAccess = !isCreate && !!data && data.editable === false && hasLevel('budget', 'member');
  const canEdit = hasLevel('budget', 'member') && lineEditable;
  // The same rule as the list: a budget administrator whose access is not limited.
  const canDelete = hasLevel('budget', 'admin') && !isDataAccessLimited(dataAccess);
  // Fields edited and not saved yet, each with the line it was edited on (the page
  // stays mounted from one line to the next): a field only ever goes to its own line.
  // Each also keeps the value the screen showed when its edit began (its base, lot 3C):
  // the server refuses a field someone else changed meanwhile (409 edit_conflict).
  // Kept for the session, not the page: a line left by the browser's back button, or a
  // save answered once the page went, keeps its choice for the next visit (lot 3C review).
  const patchBuffer = useSharedPatchBuffer<Partial<BudgetLineForm>>('budget-line', mergePatch);
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
    if (data?.id && data?.item_number) {
      lineRefs.set(data.id, formatItemRef('budget', data.item_number));
    }
  }, [data?.id, data?.item_number, data?.nature, nature]);
  const lineRef = React.useCallback((lineId: string) => lineRefs.get(lineId) ?? t('budget.line'), [t]);
  const uuidRef = React.useRef(uuid);
  uuidRef.current = uuid;
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const formRef = React.useRef(form);
  formRef.current = form;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // A line changed during this visit and left without a value on a required dimension: leaving asks (lot D2).
  const requiredLeave = useRequiredDimensionsLeave({
    scope: nature,
    lineId: isCreate ? null : idParam,
    canEdit,
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
  // Resync the form on every refetch, before the browser paints: the line never shows with an empty form first.
  React.useLayoutEffect(() => {
    if (!data || isCreate) return;
    syncForm(data);
  }, [data, isCreate, syncForm]);

  // Per field of an edit, the value the screen showed before it: the base the
  // server compares with what is stored (lot 3C). The status follows the end of
  // validity and has none of its own.
  const baseFor = React.useCallback((patch: Partial<BudgetLineForm>): Partial<BudgetLineForm> => {
    const shown = formRef.current;
    const base: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as Array<keyof BudgetLineForm>) {
      if (key === 'status') continue;
      base[key] = key === 'analytics_values'
        ? Object.fromEntries(Object.keys(patch.analytics_values ?? {}).map((axisId) => [axisId, shown.analytics_values[axisId] ?? null]))
        : shown[key];
    }
    return base as Partial<BudgetLineForm>;
  }, []);

  const invalidateLine = React.useCallback((lineId: string) => queryClient.invalidateQueries({
    queryKey: ['budget-line'],
    predicate: (q) => (q.state.data as { id?: string } | undefined)?.id === lineId,
  }), [queryClient]);

  const flushPending = React.useCallback(() => sendPatchBuffer(
    patchBuffer,
    async (lineId, patch, base) => {
      const body = normalizePatch({ ...patch });
      const baseBody = normalizePatch({ ...base });
      const res = await api.patch(`/budget-lines/${lineId}`, Object.keys(baseBody).length > 0 ? { ...body, base: baseBody } : body);
      // The counter this save left: not someone else's change (lot 3G).
      noteRowVersionRef.current(lineId, res?.data?.row_version);
    },
    {
      onSaved: async (lineId) => {
        await invalidateLine(lineId);
        invalidateBudgetLists(queryClient);
      },
      // Refused for good: the screen shows the line's stored values again for those fields.
      onRefused: (lineId, patch) => {
        const stored = dataRef.current;
        if (lineId === uuidRef.current && stored) {
          setForm((prev) => {
            if (prev.id !== lineId) return prev;
            const server = toForm(stored);
            const fields = (Object.keys(patch) as Array<keyof BudgetLineForm>).filter((field) => !patchBuffer.holds(lineId, field));
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
  const patchNow = React.useCallback(async (patch: Partial<BudgetLineForm>) => {
    if (isCreate || !uuid || stale || !canEdit) return;
    noteLineChange();
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
  }, [isCreate, uuid, stale, canEdit, noteLineChange, baseFor, patchBuffer, autosave, flushPending]);

  // Debounced persist — long-form notes / description while typing.
  const patchDebounced = React.useCallback((patch: Partial<BudgetLineForm>) => {
    if (isCreate || !uuid || stale || !canEdit) return;
    noteLineChange();
    const base = baseFor(patch);
    setForm((prev) => mergePatch(prev, patch));
    // Typed in a field waiting for a choice: it stays with it, nothing is saved yet.
    if (patchBuffer.add(uuid, patch, base)) autosave.schedule(flushPending);
  }, [isCreate, uuid, stale, canEdit, noteLineChange, autosave, flushPending, patchBuffer, baseFor]);

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
          else if (stored && path in stored && path !== 'status') next = { ...next, [path]: stored[path as keyof BudgetLineForm] };
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

  // ----- Transitional ref-save tabs (budget / allocations) -----
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

  // ----- What others changed (lot 3G): the line, and the year's version on Budget and Allocations -----
  const others = useLineOthersChanges({
    itemsApi: config.itemsApi,
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
    // The detail again, unless a refetch (window focus) already brought that counter. A read that
    // fails rejects: nothing was shown, the counter stays for the next poll.
    refreshLine: async (rowVersion) => {
      const lineId = uuidRef.current;
      const shown = Number(dataRef.current?.row_version);
      if (!lineId || (rowVersion !== null && Number.isFinite(shown) && shown >= rowVersion)) return;
      await queryClient.invalidateQueries({
        queryKey: ['budget-line'],
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
    }
    // Relations saves each change at once, so a leave never waits on that tab.
    // A budget or allocation choice kept from a tab left meanwhile: only a move that keeps the line goes on.
    return !!options?.ignoreHeld || (budgetChoices().length === 0 && !allocationChoice());
  }, [autosave, routeTab, budgetChoices, allocationChoice]);

  const tabUnsaved = React.useCallback(() => (routeTab === 'budget' && !!budgetRef.current?.isDirty())
    || (routeTab === 'allocations' && !!allocRef.current?.isDirty()), [routeTab]);
  // Something would be lost by leaving: a save not done, a choice not made (on any line or tab).
  const unsavedWork = React.useCallback(
    () => autosaveRegistry.isBusy() || tabUnsaved() || budgetChoices().length > 0 || allocationChoice(),
    [autosaveRegistry, tabUnsaved, budgetChoices, allocationChoice],
  );

  // A save that still fails once flushed (the server stays busy, a tab keeps its edits) must not
  // trap the user on the line: leaving is offered, and drops what could not be saved.
  // `keepChoices` (a tab change, opening the line a choice waits on): the page stays, so an edit
  // waiting for a choice neither stops the move nor is dropped; only a failed save asks.
  const flushOrAsk = React.useCallback(async (options?: { keepChoices?: boolean }): Promise<FlushOutcome> => {
    const keepChoices = !!options?.keepChoices;
    if (await flushAll({ ignoreHeld: keepChoices })) return 'saved';
    const unsaved = keepChoices ? autosave.isSaving() || tabUnsaved() : unsavedWork();
    // Nothing left unsaved (the save was refused and the screen reloaded): stay, the message shows why.
    if (!unsaved) return 'stay';
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
    if (!leave) return 'stay';
    autosaveRegistry.discardAll();
    // The budget and allocation choices kept for the line are lost with it.
    if (!keepChoices) {
      heldChoices.budget.current = null;
      heldChoices.allocation.current = null;
    }
    patchBuffer.discard({ keepChoices });
    setSaveError(null);
    if (dataRef.current) syncForm(dataRef.current);
    return 'dropped';
  }, [flushAll, autosave, tabUnsaved, unsavedWork, patchBuffer, uuid, t, lineRef, dialogs, autosaveRegistry, syncForm, budgetChoices, allocationChoice, heldChoices, locale]);

  const flushOrLeave = React.useCallback(async (options?: { keepChoices?: boolean }): Promise<boolean> => (
    (await flushOrAsk(options)) !== 'stay'
  ), [flushOrAsk]);

  // ----- Creation at the title (lot 1c) -----
  const listPath = React.useMemo(() => {
    const sp = buildListContextParams();
    sp.delete('list');
    sp.delete('nature');
    const qs = sp.toString();
    return `/ops/budget${qs ? `?${qs}` : ''}`;
  }, [buildListContextParams]);
  // Where the creation started: a new line left empty, cancelled or created goes back there.
  const creationReturn = useCreationReturn(listPath);
  const creation = useRecordCreation({
    family: 'budget-lines',
    apiBase: '/budget-lines',
    recordId: !isCreate ? (data?.id as string | undefined) ?? null : null,
    listPath,
    recordLabel: t('budget.creation.record'),
    queryKeyPrefixes: ['budget-lines', 'spend-items', 'capex-items'],
    onError: setSaveError,
  });

  // The fields a line needs before its creation ends, by the keys of `POST :id/creation/complete`,
  // in screen order, as far as the screen knows them (the server also checks the account's chart).
  const linePlacementFilter = useLinePlacementFilter(!isCreate ? form.paying_company_id || null : null);
  const missingOf = React.useCallback((line: BudgetLineForm): string[] => {
    const fields: string[] = [];
    if (!line.paying_company_id) fields.push('paying_company');
    if (!line.account_id) fields.push('account');
    for (const axis of analyticsAxes.enabled) {
      if (axisRequiredFor(axis, nature) && !line.analytics_values[axis.id]) fields.push(`dimension:${axis.id}`);
    }
    if (line.paying_company_id && !line.cost_center_id && linePlacementFilter?.costCenterRequired) fields.push('cost_center');
    return fields;
  }, [analyticsAxes.enabled, linePlacementFilter, nature]);
  const fieldLabel = React.useCallback((key: string): string => {
    if (key === 'paying_company') return t('opex.fields.payingCompany');
    if (key === 'account') return t('opex.fields.account');
    if (key === 'cost_center') return t('opex.fields.costCenter');
    if (key.startsWith('dimension:')) {
      const axis = analyticsAxes.axes.find((candidate) => candidate.id === key.slice('dimension:'.length));
      return axis ? analyticsAxes.label(axis) : key;
    }
    return key;
  }, [analyticsAxes, t]);
  const missingNow = React.useCallback(() => missingOf(formRef.current), [missingOf]);
  // A line being created asks before it is left while it lacks a field; a line left without its
  // paying company earlier (a creation never completed) too, as long as it lacks one.
  const incompleteAsks = React.useCallback(() => {
    if (isCreate || !canEdit || !dataRef.current?.id || formRef.current.id !== dataRef.current.id) return false;
    if (!creation.beingCreated && formRef.current.paying_company_id) return false;
    return missingNow().length > 0;
  }, [canEdit, creation.beingCreated, isCreate, missingNow]);

  // The panel opens and the field of a missing value takes the focus.
  const [fieldDrawerRequest, setFieldDrawerRequest] = React.useState(0);
  const focusLineField = React.useCallback((key: string) => {
    setFieldDrawerRequest((n) => n + 1);
    const selector = key.startsWith('dimension:')
      ? `[${ANALYTICS_AXIS_FIELD_ATTR}="${key.slice('dimension:'.length)}"] input`
      : `[${LINE_FIELD_ATTR}="${key}"] input`;
    let tries = 0;
    const attempt = () => {
      const input = rootRef.current?.querySelector<HTMLElement>(selector);
      if (input) {
        input.focus();
        return;
      }
      tries += 1;
      if (tries < 20) window.setTimeout(attempt, 25);
    };
    window.setTimeout(attempt, 0);
  }, []);
  const incompleteLeave = useIncompleteLeave({
    keys: 'ops:budget.creation',
    beingCreated: creation.beingCreated,
    missing: () => missingNow().map((key) => ({ key, label: fieldLabel(key) })),
    focus: focusLineField,
    onDelete: () => creation.cancelCreation({ leave: false }),
  });

  // Leaving the line: what is not saved first, then a line that lacks a field it needs (being
  // created, or left incomplete), else a required dimension left without a value. One question per
  // move: a user who already chose to leave and drop their edits is not asked again. A tab change
  // keeps the line and does not ask.
  const leaveLine = React.useCallback(async (options?: { keepChoices?: boolean }): Promise<boolean> => {
    const outcome = await flushOrAsk(options);
    if (outcome === 'stay') return false;
    if (outcome === 'dropped') return true;
    if (incompleteAsks()) return incompleteLeave.confirm();
    return confirmRequired();
  }, [flushOrAsk, confirmRequired, incompleteAsks, incompleteLeave]);
  const leaveAsks = React.useCallback(
    () => unsavedWork() || requiredMissing() || incompleteAsks(),
    [unsavedWork, requiredMissing, incompleteAsks],
  );

  // A link of the app (left menu, top bar, user menu) asks the same as the close button.
  useLeaveGuard(leaveAsks, leaveLine);

  const goToTab = React.useCallback(async (nextTab: TabKey) => {
    if (isCreate && nextTab !== 'overview') return;
    if (!(await flushOrLeave({ keepChoices: true }))) return;
    const sp = buildListContextParams();
    navigate(`/ops/budget/${idParam}/${nextTab}?${sp.toString()}`);
  }, [isCreate, flushOrLeave, buildListContextParams, navigate, idParam, nature]);

  // The line a choice waits on: going there keeps the choice.
  const openConflictLine = React.useCallback(async (lineId: string) => {
    if (!(await leaveLine({ keepChoices: true }))) return;
    const sp = buildListContextParams();
    navigate(`/ops/budget/${lineId}/${routeTab}?${sp.toString()}`);
  }, [leaveLine, buildListContextParams, navigate, routeTab, nature]);

  const confirmAndNavigate = React.useCallback(async (targetId: string | null) => {
    if (!targetId) return;
    if (!(await leaveLine())) return;
    const sp = buildListContextParams();
    navigate(`${targetId.startsWith('/ops/') ? targetId : `/ops/budget/${targetId}`}/${routeTab}?${sp.toString()}`);
  }, [leaveLine, buildListContextParams, navigate, routeTab, nature]);

  const closeWorkspace = React.useCallback(async () => {
    // A new line left before it has a title goes back where the creation started.
    if (isCreate) {
      navigate(creationReturn);
      return;
    }
    if (!(await leaveLine())) return;
    navigate(listPath);
  }, [creationReturn, isCreate, leaveLine, listPath, navigate]);

  // The line is already gone: pending edits are dropped, not saved and not asked about, then the list opens.
  const leaveAfterDelete = React.useCallback(() => {
    setDeleted(true);
    autosaveRegistry.discardAll();
    budgetRef.current?.discard();
    allocRef.current?.discard();
    heldChoices.budget.current = null;
    heldChoices.allocation.current = null;
    heldChoices.openings.current = null;
    patchBuffer.discard();
    setSaveError(null);
    invalidateBudgetLists(queryClient);
    const sp = buildListContextParams();
    sp.delete('list');
    const qs = sp.toString();
    navigate(`/ops/budget${qs ? `?${qs}` : ''}`);
  }, [autosaveRegistry, heldChoices, patchBuffer, queryClient, buildListContextParams, navigate]);

  // ----- Change type (lot M): from the "…" menu; pending edits are saved first (the dialog sends the line's row_version) -----
  const [changeTypeOpen, setChangeTypeOpen] = React.useState(false);
  // Not while the line is being created: its type comes from the new page's address.
  const canChangeType = !isCreate && !stale && !!uuid && canEdit && !creation.beingCreated;
  const openChangeType = React.useCallback(async () => {
    if ((await flushOrAsk()) === 'stay') return;
    setChangeTypeOpen(true);
  }, [flushOrAsk]);
  const handleTypeChanged = React.useCallback((result: ChangeTypeResult) => {
    setChangeTypeOpen(false);
    openLineAfterTypeChange(queryClient, navigate, result);
  }, [navigate, queryClient]);
  // The line this one follows or is replaced by: left like any other move off the line.
  const openLineageLine = React.useCallback(async (line: LineageLine) => {
    if (!(await leaveLine())) return;
    navigate(budgetLinePath(line));
  }, [leaveLine, navigate]);

  // ----- Status lifecycle handlers -----
  const handleStatusChange = (next: StatusValue) => {
    // The status shown sends nothing (a future end of validity stays). Disabled goes alone: the
    // server sets the end of validity (now, or keeps one already passed). Each window sending its
    // own clock's now would make two people disabling the line a conflict (lot 3C review).
    const patch = statusChoicePatch(next, form);
    if (patch) void patchNow(patch);
  };
  const handleDisabledAtChange = (next: string | null) => {
    const disabled_at = normalizeDisabledAtInput(next);
    if (disabled_at === normalizeDisabledAtInput(form.disabled_at)) return;
    void patchNow({ status: deriveStatusFromDisabledAt(disabled_at), disabled_at });
  };

  // Labels of the line's references, from the detail: the pickers and the owners show them without any request.
  const references = React.useMemo(() => itemReferences(data), [data]);
  // The cost center shown with that reference, read from the same line: on a line switch the detail
  // is the new line's one render before the form follows, and the old line's id would not match the
  // new reference (the pickers would then load the tree to name it).
  const shownCostCenterId = data?.id && form.id !== data.id ? (data.cost_center_id || '') : form.cost_center_id;
  const analyticsOptions = React.useMemo(() => analyticsValueOptions(data), [data]);
  // The chosen cost center's company: a new paying company drops a cost center of another company.
  const chosenCostCenterId = isCreate ? placementDraft.cost_center_id : shownCostCenterId;
  const chosenCostCenter = useCostCenterNode(
    chosenCostCenterId || null,
    isCreate ? null : matching(references.cost_center, chosenCostCenterId),
  );
  const costCenterElsewhere = React.useCallback((companyId: string) => (
    !!companyId && !!chosenCostCenter?.company_id && chosenCostCenter.id === chosenCostCenterId
      && chosenCostCenter.company_id !== companyId
  ), [chosenCostCenter, chosenCostCenterId]);

  // The server refuses a company on another chart of accounts than the line's account, and the
  // account picker only lists the current company's chart: clear the account in the same write,
  // so the Account row asks for one on the new chart. The cost center picker only lists the new
  // company's cost centers: a cost center of another company goes in the same write.
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
    await patchNow({
      paying_company_id: companyId,
      ...(clearAccount ? { account_id: '' } : {}),
      ...(costCenterElsewhere(companyId) ? { cost_center_id: '' } : {}),
    });
  }, [costCenterElsewhere, form.account_id, form.paying_company_id, patchNow]);

  // ----- The title creates the line; Create and Cancel (lot 1c) -----
  // Create was clicked while the title created the line: its check runs once the line shows.
  const createAfterOpenRef = React.useRef(false);

  // The title creates the line at once with the defaults (the tenant's currency, today, the type of
  // the address) and, for a person with limited access, its place; the page moves to it, every tab
  // open, with Create and Cancel.
  // A title committed before the currency and the person's place were known waits for them.
  const titleCreation = useTitleCreation<{ id: string; nature?: string; reference?: string; item_number: number }>({
    isCreate,
    requiredMessage: t('common:creation.titleRequired'),
    ready: placementDefault.ready && !currencyLoading && placementReady,
    post: async (name) => {
      const place = placementAsked
        ? { paying_company_id: toNull(placementDraft.paying_company_id), cost_center_id: toNull(placementDraft.cost_center_id) }
        : placementDefault.companyId ? { paying_company_id: placementDefault.companyId } : {};
      const res = await api.post('/budget-lines/creation', {
        nature, product_name: name, currency: defaultSpendCurrency, effective_start: todayYmd(), ...place,
      });
      return res.data ?? {};
    },
    onCreated: (created, token, finish) => {
      const lineReference = (created.reference || formatItemRef('budget', created.item_number)) as string;
      if (finish) createAfterOpenRef.current = true;
      creation.startCreation({ recordId: created.id, token, returnTo: creationReturn });
      // The page keeps its header while it moves to the line: no wait on the resolve and the detail.
      queryClient.setQueryData(['budget-line-resolve', lineReference], { id: created.id, nature: created.nature ?? nature, reference: lineReference });
      queryClient.setQueryData(budgetLineDetailQuery(lineReference).queryKey, created);
      invalidateBudgetLists(queryClient);
      const sp = buildListContextParams();
      sp.delete('nature');
      navigate(`/ops/budget/${lineReference}/overview?${sp.toString()}`, { replace: true });
    },
    errorMessage: (e) => getApiErrorMessage(e, t, t(config.createFailed)),
    onStart: () => setSaveError(null),
  });
  const setTitleError = titleCreation.setTitleError;
  // The place first: the title waits, and says so.
  React.useEffect(() => {
    if (titleCreation.pending && placementDefault.ready && !currencyLoading && !placementReady) setTitleError(t('budget.creation.placeFirst'));
  }, [currencyLoading, placementDefault.ready, placementReady, setTitleError, t, titleCreation.pending]);

  // Create on a line being created: what is still being typed is saved, then the server checks the
  // fields the line needs. Missing ones are named once, marked, and the first one gets the focus;
  // otherwise the line is kept and closed.
  const [completing, setCompleting] = React.useState(false);
  const [missingFields, setMissingFields] = React.useState<ReadonlySet<string>>(() => new Set());
  const createAction = React.useCallback(async () => {
    if (isCreate) {
      titleCreation.create();
      return;
    }
    const token = creation.token;
    if (!uuid || !token || completing) return;
    if (!(await flushAll())) return;
    setCompleting(true);
    setSaveError(null);
    try {
      await api.post(`/budget-lines/${uuid}/creation/complete`, { token });
      setMissingFields(new Set());
      invalidateBudgetLists(queryClient);
      creation.finishCreation();
    } catch (e) {
      const answer = (e as { response?: { data?: { code?: unknown; params?: { fields?: unknown } } } })?.response?.data;
      const fields = answer?.code === 'CREATION_INCOMPLETE' && Array.isArray(answer.params?.fields) ? answer.params.fields.map(String) : null;
      if (fields && fields.length > 0) {
        setMissingFields(new Set(fields));
        setSaveError(t('budget.creation.missing', { fields: missingFieldsList(fields.map(fieldLabel), locale) }));
        focusLineField(fields[0]);
      } else {
        setSaveError(getApiErrorMessage(e, t, t('budget.creation.completeFailed')));
      }
    } finally {
      setCompleting(false);
    }
  }, [completing, creation, fieldLabel, flushAll, focusLineField, isCreate, queryClient, t, titleCreation, uuid]);
  // Cancel on a line being created: what is still being typed is saved first, so the confirmation
  // counts it, then the line is deleted (`useRecordCreation`).
  const cancelLine = React.useCallback(async () => {
    if (!(await flushAll())) return;
    await creation.cancelCreation();
  }, [creation, flushAll]);
  React.useEffect(() => {
    if (!createAfterOpenRef.current || !creation.beingCreated || !data?.id || form.id !== data.id) return;
    createAfterOpenRef.current = false;
    void createAction();
  }, [createAction, creation.beingCreated, data?.id, form.id]);
  // The marks follow the fields: a field given a value loses its mark.
  const markedFields = React.useMemo(() => {
    if (missingFields.size === 0) return missingFields;
    const now = new Set(missingOf(form));
    return new Set(Array.from(missingFields).filter((field) => now.has(field)));
  }, [form, missingFields, missingOf]);
  React.useEffect(() => { setMissingFields(new Set()); }, [uuid]);
  // A line left without its paying company (a creation never completed) says what it lacks.
  const incompleteNotice = !isCreate && !creation.beingCreated && canEdit && !!data?.id && form.id === data.id && !form.paying_company_id
    ? missingOf(form)
    : [];

  const reference = data?.item_number ? formatItemRef('budget', data.item_number) : null;
  React.useEffect(() => {
    if (!isCreate && !stale && reference && data?.product_name) {
      document.title = `${reference} · ${data.product_name} | KANAP`;
    }
    return () => { document.title = 'KANAP'; };
  }, [isCreate, stale, reference, data?.product_name]);
  const { addToRecent } = useRecentlyViewed();
  React.useEffect(() => {
    if (!isCreate && !stale && data?.id && data?.product_name) addToRecent(config.taskType, data.id, data.product_name, reference || undefined);
  }, [addToRecent, data?.id, data?.product_name, isCreate, stale, reference, config.taskType]);

  const tabs = React.useMemo(() => ([
    { key: 'overview', label: t('opex.tabs.overview') },
    { key: 'budget', label: t('opex.tabs.budget') },
    { key: 'allocations', label: t('opex.tabs.allocations') },
    { key: 'relations', label: t('opex.tabs.relations') },
    { key: RECORD_HISTORY_TAB_KEY, label: t('opex.tabs.history') },
  ] as Array<{ key: TabKey; label: string }>), [t]);

  const savingHint = autosave.status === 'saving' || autosave.status === 'pending'
    ? t('common:status.saving', 'Saving…')
    : autosave.status === 'saved'
      ? t('common:status.saved', 'Saved')
      : null;

  return (
    <Box ref={rootRef} sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={(!isCreate || !!error || !!saveError) ? (
          <>
            {!!error && <Alert severity="error">{t('opex.workspace.failedToLoad')}</Alert>}
            {!!saveError && <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
            {incompleteNotice.length > 0 && (
              <Alert severity="warning" data-testid="line-incomplete">
                {t('budget.creation.missing', { fields: missingFieldsList(incompleteNotice.map(fieldLabel), locale) })}
              </Alert>
            )}
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
                sx={{ mx: 0, mt: 0 }}
              />
            )}
            {!isCreate && (
              <OtherConflictsNotice
                items={otherConflictLines.map((lineId) => ({ id: lineId, label: lineRef(lineId) }))}
                onOpen={(lineId) => { void openConflictLine(lineId); }}
                sx={{ mx: 0, mt: 0 }}
              />
            )}
          </>
        ) : undefined}
        activeTab={routeTab}
        tabs={tabs.map((tab) => ({
          ...tab,
          disabled: isCreate && tab.key !== 'overview',
          badge: tab.key === 'relations' ? (relationsCountQuery.data || undefined) : undefined,
        }))}
        onTabChange={(next) => { void goToTab(next as TabKey); }}
        drawerStorageKey="kanap.budget.drawerOpen"
        backLabel={t('budget.title')}
        onBack={() => { void closeWorkspace(); }}
        itemReference={reference}
        onCopyReference={reference ? () => { void navigator.clipboard?.writeText(reference); } : undefined}
        title={isCreate ? '' : form.product_name}
        titleFallback={isCreate ? t(config.newTitle) : t('budget.line')}
        canEditTitle={canEdit}
        onTitleSave={(value) => {
          if (isCreate) {
            titleCreation.commit(value);
          } else {
            void patchNow({ product_name: value });
          }
        }}
        onTitleDraftChange={isCreate ? () => setTitleError(null) : undefined}
        titleError={isCreate ? titleCreation.titleError : undefined}
        titleAutoEdit={isCreate}
        titleOnCancel={isCreate ? () => { void closeWorkspace(); } : undefined}
        titleFocusRequest={titleCreation.focusRequest}
        isCreate={isCreate}
        forceDrawerOpen={isCreate}
        drawerOpenRequest={requiredLeave.drawerOpenRequest + fieldDrawerRequest}
        nav={!isCreate && total > 0 ? {
          currentIndex: index + 1,
          totalCount: total,
          hasPrev,
          hasNext,
          onPrev: () => { void confirmAndNavigate(nav.prevPath ?? prevId); },
          onNext: () => { void confirmAndNavigate(nav.nextPath ?? nextId); },
          previousLabel: t('opex.workspace.prev'),
          nextLabel: t('opex.workspace.next'),
        } : undefined}
        // Ctrl+S saves a line, being created or not; on the new page it does nothing.
        onSaveShortcut={isCreate ? ignoreDraftChange : () => { void flushAll(); }}
        metadata={isCreate ? (
          // The metadata of the line to be, dimmed like the rest, so the page does not move when it is created.
          <CreationPreview sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'inherit' }}>
            <BudgetMetadataBar
              ownerItName={null}
              ownerBizName={null}
              status={draftForm.status}
              ownerItId={null}
              ownerBizId={null}
              costCenterId={null}
              lineRef={null}
              disabled
              onStatusChange={ignoreDraftChange}
              onOwnerItChange={ignoreDraftChange}
              onOwnerBizChange={ignoreDraftChange}
            />
          </CreationPreview>
        ) : (
          <BudgetMetadataBar
            ownerItName={ownerName(references.owner_it, form.owner_it_id)}
            ownerBizName={ownerName(references.owner_business, form.owner_business_id)}
            status={form.status}
            ownerItId={form.owner_it_id || null}
            ownerBizId={form.owner_business_id || null}
            costCenterId={shownCostCenterId || null}
            costCenter={matching(references.cost_center, shownCostCenterId)}
            lineRef={uuid || null}
            disabled={!canEdit}
            onStatusChange={handleStatusChange}
            onOwnerItChange={(v) => void patchNow({ owner_it_id: (v || '') as string })}
            onOwnerBizChange={(v) => void patchNow({ owner_business_id: (v || '') as string })}
          />
        )}
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
            {readOnlyInAccess && (
              <Typography data-testid="line-read-only" sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center', mr: 0.5 }}>
                {t('budget.readOnlyInYourAccess')}
              </Typography>
            )}
            {savingHint && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center', mr: 0.5 }}>
                {savingHint}
              </Typography>
            )}
            {!isCreate && uuid && (
              <SendLinkButton
                itemType={nature}
                itemId={uuid}
                itemName={form.product_name || t('budget.line')}
                itemRef={reference}
              />
            )}
            {!isCreate && !creation.beingCreated && uuid && canDelete && (
              <RecordDeleteButton
                base="/budget-lines"
                id={uuid}
                name={form.product_name || t('budget.line')}
                deleteFailed="ops:budget.delete.failed"
                bulk
                onDeleted={leaveAfterDelete}
              />
            )}
            {isCreate || creation.beingCreated ? (
              <CreationActions
                busy={creation.cancelling || completing}
                onCreate={() => { void createAction(); }}
                onCancel={() => { if (isCreate) void closeWorkspace(); else void cancelLine(); }}
              />
            ) : (
              <IconButton aria-label={t('common:buttons.close')} title={t('common:buttons.close')} size="small" onClick={() => { void closeWorkspace(); }}>
                <CloseIcon />
              </IconButton>
            )}
          </>
        )}
        properties={isCreate ? (
          <>
            {/* The place of a limited person's line comes first, live: the title waits for it. */}
            {placementAsked && (
              <BudgetPropertiesDrawer
                nature={nature}
                mode="create"
                section="placement"
                supplierId=""
                payingCompanyId={placementDraft.paying_company_id}
                companyFollowsCostCenter={placementDraft.followsCostCenter}
                accountId=""
                currency={draftForm.currency}
                analyticsValues={{}}
                costCenterId={placementDraft.cost_center_id}
                runBuild=""
                effectiveStart={draftForm.effective_start}
                onSupplierChange={ignoreDraftChange}
                onPayingCompanyChange={(v) => setPlacementDraft((prev) => ({
                  paying_company_id: v,
                  cost_center_id: costCenterElsewhere(v) ? '' : prev.cost_center_id,
                  followsCostCenter: false,
                }))}
                onAccountChange={ignoreDraftChange}
                onCurrencyChange={ignoreDraftChange}
                onAnalyticsValueChange={ignoreDraftChange}
                onCostCenterChange={pickDraftCostCenter}
                onRunBuildChange={ignoreDraftChange}
                onEffectiveStartChange={ignoreDraftChange}
              />
            )}
            <CreationPreview>
              <BudgetPropertiesDrawer
                nature={nature}
                mode="edit"
                section={placementAsked ? 'rest' : 'all'}
                disabled
                supplierId=""
                payingCompanyId={placementDefault.companyId ?? ''}
                accountId=""
                currency={draftForm.currency}
                analyticsValues={{}}
                costCenterId=""
                runBuild=""
                effectiveStart={draftForm.effective_start}
                status={draftForm.status}
                disabledAt={null}
                onSupplierChange={ignoreDraftChange}
                onPayingCompanyChange={ignoreDraftChange}
                onAccountChange={ignoreDraftChange}
                onCurrencyChange={ignoreDraftChange}
                onAnalyticsValueChange={ignoreDraftChange}
                onCostCenterChange={ignoreDraftChange}
                onRunBuildChange={ignoreDraftChange}
                onEffectiveStartChange={ignoreDraftChange}
                onDisabledAtChange={ignoreDraftChange}
                onDisableNow={ignoreDraftChange}
              />
            </CreationPreview>
          </>
        ) : (
          <BudgetPropertiesDrawer
            nature={nature}
            onChangeType={canChangeType ? () => { void openChangeType(); } : undefined}
            mode="edit"
            lineId={data?.id ?? null}
            disabled={!canEdit}
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
            missingFields={markedFields}
            onSupplierChange={(v) => void patchNow({ supplier_id: v })}
            onPayingCompanyChange={(v) => void changePayingCompany(v)}
            onAccountChange={(v) => void patchNow({ account_id: v })}
            onCurrencyChange={(v) => void patchNow({ currency: v.toUpperCase() })}
            onAnalyticsValueChange={(axisId, v) => void patchNow({ analytics_values: { [axisId]: v } })}
            onCostCenterChange={(v) => void patchNow({ cost_center_id: v })}
            onRunBuildChange={(v) => void patchNow({ run_build: v })}
            onEffectiveStartChange={(v) => void patchNow({ effective_start: v })}
            onDisabledAtChange={handleDisabledAtChange}
            // Disable now: the status alone, the server sets the end of validity from its own clock.
            onDisableNow={() => void patchNow({ status: STATUS_DISABLED })}
          />
        )}
      >
        {routeTab === 'overview' && (
          isCreate ? (
            <CreationPreview>
              <Stack spacing={3} sx={{ pt: 1 }}>
                <Box>
                  <Typography component="label" sx={sectionLabelSx}>{t('opex.fields.description')}</Typography>
                  <TextField
                    value=""
                    multiline minRows={3} fullWidth variant="standard"
                    placeholder={t('opex.fields.descriptionPlaceholder', 'e.g., annual subscription for monitoring')}
                    sx={composerSx}
                    disabled
                  />
                </Box>
                <Box>
                  <Typography component="label" sx={sectionLabelSx}>{t('opex.fields.notes')}</Typography>
                  <TextField
                    value=""
                    multiline minRows={3} fullWidth variant="standard"
                    placeholder={t('opex.fields.notesPlaceholder', 'e.g., renewal negotiated in Q3')}
                    sx={composerSx}
                    disabled
                  />
                </Box>
              </Stack>
            </CreationPreview>
          ) : (
            <Stack spacing={3} sx={{ pt: 1 }}>
              <LineLineage lineage={data?.lineage} onOpen={(line) => { void openLineageLine(line); }} />
              <Box>
                <Typography component="label" sx={sectionLabelSx}>{t('opex.fields.description')}</Typography>
                <TextField
                  value={form.description}
                  inputRef={descriptionInputRef}
                  onChange={(e) => patchDebounced({ description: e.target.value })}
                  disabled={!canEdit}
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
                  disabled={!canEdit}
                  multiline minRows={3} fullWidth variant="standard"
                  placeholder={t('opex.fields.notesPlaceholder', 'e.g., renewal negotiated in Q3')}
                  sx={composerSx}
                />
              </Box>
              {!stale && uuid && <EntityTasksPanel key={uuid} entityType={config.taskType} entityId={uuid} disabled={!hasLevel('tasks', 'member') || !lineEditable} />}
            </Stack>
          )
        )}

        {/* No progress bar while a tab's code loads: the empty tab, then its content. */}
        <WorkspaceTabBoundary resetKey={routeTab} onRetry={retryTabs}>
          <React.Suspense fallback={null}>
            {routeTab === 'budget' && !isCreate && !stale && uuid && (
              <BudgetTab key={uuid} id={uuid} year={currentYear} currency={form.currency} availableYears={availableYears} onYearChange={setYear} config={config.finance} effectiveStart={form.effective_start} endOfValidity={isoToLocalDateInput(form.disabled_at)} payingCompanyCountry={payingCompanyCountry} held={heldChoices.budget} openings={heldChoices.openings} onBudgetRev={noteBudgetRev} lineEditable={lineEditable} ref={budgetRef} />
            )}
            {routeTab === 'allocations' && !isCreate && !stale && uuid && (
              <AllocationsTab key={uuid} id={uuid} year={currentYear} currency={form.currency} availableYears={availableYears} onYearChange={setYear} config={config.finance} held={heldChoices.allocation} onBudgetRev={noteBudgetRev} knownBudgetRev={knownBudgetRev} lineEditable={lineEditable} ref={allocRef} />
            )}
            {routeTab === 'relations' && !isCreate && !stale && uuid && (
              <RelationsTab key={uuid} lineId={uuid} nature={nature} lineEditable={lineEditable} onRelationsChange={() => { void relationsCountQuery.refetch(); }} />
            )}
            {routeTab === RECORD_HISTORY_TAB_KEY && !isCreate && !stale && uuid && (
              <HistoryTab key={uuid} table="spend_items" recordId={uuid} />
            )}
          </React.Suspense>
        </WorkspaceTabBoundary>
      </PortfolioDetailWorkspaceShell>
      {canChangeType && uuid && (
        <ChangeTypeDialog
          open={changeTypeOpen}
          nature={nature}
          lineId={uuid}
          lineReference={reference}
          companyId={form.paying_company_id || null}
          onClose={() => setChangeTypeOpen(false)}
          onChanged={handleTypeChanged}
        />
      )}
      {requiredLeave.dialog}
      {incompleteLeave.dialog}
    </Box>
  );
}
