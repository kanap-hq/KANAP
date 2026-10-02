import React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useCapexNav } from '../../hooks/useCapexNav';
import { capexDetailQuery } from '../../hooks/budgetItemDetailQuery';
import { useListFilters, writeListSnapshot } from '../../hooks/useListContextSearch';
import { compactListSearchCached } from '../../lib/listContext';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { dimensionFieldPredicate, explicitSort, filtersStringOnShownColumns } from '../../components/finance/amountColumns';
import useAutosave, { autosaveErrorMessage, useAutosaveRegistry } from '../../hooks/useAutosave';
import { sendPatchBuffer, usePatchBuffer } from '../../hooks/patchBuffer';
import { ConflictChoice, useEditConflicts } from '../../hooks/editConflicts';
import EditConflictBanner from '../../components/workspace/EditConflictBanner';
import { formatShortDate } from '../../lib/dateFormat';
import { useKanapDialogs } from '../../components/design';
import { formatItemRef } from '../../utils/item-ref';
import {
  StatusValue,
  deriveStatusFromDisabledAt,
  normalizeDisabledAtInput,
} from '../../constants/status';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import CapexMetadataBar, { CapexPriority } from './workspace/CapexMetadataBar';
import CapexPropertiesDrawer, { CapexInvestmentType, CapexPpeType, RunBuild } from './workspace/CapexPropertiesDrawer';
import { useCostCenterTree } from '../../hooks/useCostCenterTree';
import BudgetTab, { BudgetTabHandle } from '../../components/finance/BudgetTab';
import AllocationsTab, { AllocationsTabHandle } from '../../components/finance/AllocationsTab';
import { CAPEX_FINANCE_CONFIG } from '../../components/finance/config';
import RelationsPanel, { RelationsPanelHandle } from './editors/RelationsPanel';
import EntityTasksPanel from '../../components/EntityTasksPanel';
import { readStoredCapexListContext, writeStoredCapexListContext } from './listContextStorage';
import { fetchCapexRelationsCount } from '../../utils/workspaceTabCounts';
import useCurrencySettings from '../../hooks/useCurrencySettings';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { isoToLocalDateInput } from '../../lib/datetime';
import type { ItemAnalyticsValue } from '../../services/analytics';

/** The list this workspace belongs to (its saved list contexts). */
const LIST_ENDPOINT = '/capex-items/summary';

type TabKey = 'overview' | 'budget' | 'allocations' | 'relations';
const TAB_KEYS: TabKey[] = ['overview', 'budget', 'allocations', 'relations'];

type CapexForm = {
  id?: string;
  item_number?: number;
  description: string;
  supplier_id: string;
  currency: string;
  account_id: string;
  paying_company_id: string;
  ppe_type: CapexPpeType;
  investment_type: CapexInvestmentType;
  priority: CapexPriority;
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

const EMPTY_FORM: CapexForm = {
  description: '', supplier_id: '', currency: 'EUR', account_id: '', paying_company_id: '',
  ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium',
  effective_start: '', status: 'enabled', disabled_at: null,
  owner_it_id: '', owner_business_id: '', analytics_values: {}, cost_center_id: '', run_build: '', notes: '',
  created_at: null, updated_at: null,
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyCapexForm(currency = 'EUR'): CapexForm {
  return {
    ...EMPTY_FORM,
    currency,
    effective_start: todayYmd(),
  };
}

function toNull(value: string): string | null {
  return value === '' ? null : value;
}

const NULLABLE_PATCH_FIELDS = new Set([
  'supplier_id',
  'account_id',
  'paying_company_id',
  'owner_it_id',
  'owner_business_id',
  'cost_center_id',
  'run_build',
  'disabled_at',
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

function toForm(data: any): CapexForm {
  const normalizedDisabledAt = data?.disabled_at ? new Date(data.disabled_at).toISOString() : null;
  return {
    id: data?.id,
    item_number: data?.item_number,
    description: data?.description || '',
    supplier_id: data?.supplier_id || '',
    currency: (data?.currency || 'EUR').toUpperCase(),
    account_id: data?.account_id || '',
    paying_company_id: data?.paying_company_id || '',
    ppe_type: (data?.ppe_type || 'hardware') as CapexPpeType,
    investment_type: (data?.investment_type || 'replacement') as CapexInvestmentType,
    priority: (data?.priority || 'medium') as CapexPriority,
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
  description: 'capex.fields.description',
  notes: 'capex.fields.notes',
  supplier_id: 'capex.fields.supplier',
  paying_company_id: 'capex.fields.payingCompany',
  account_id: 'capex.fields.account',
  currency: 'capex.fields.currency',
  ppe_type: 'capex.fields.ppeType',
  investment_type: 'capex.fields.investmentType',
  priority: 'capex.fields.priority',
  cost_center_id: 'capex.fields.costCenter',
  run_build: 'capex.fields.runBuild',
  effective_start: 'capex.fields.effectiveStart',
  disabled_at: 'capex.fields.endOfValidity',
  owner_it_id: 'capex.metadata.itOwner',
  owner_business_id: 'capex.metadata.businessOwner',
};
/** The translation key of each enum value the conflict banner shows. */
const CONFLICT_ENUM_KEYS: Record<string, string> = {
  ppe_type: 'capex.ppeTypes',
  investment_type: 'capex.investmentTypes',
  priority: 'capex.priorityTypes',
  run_build: 'opex.runBuild',
};
const ANALYTICS_CONFLICT_PREFIX = 'analytics_values.';
const isLongTextField = (field: string) => field === 'notes';

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

export default function CapexItemPage() {
  const { t, i18n } = useTranslation(['ops', 'common']);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsString = searchParams.toString();
  const queryClient = useQueryClient();
  const storedListContext = React.useMemo(() => readStoredCapexListContext(), []);

  const idParam = String(params.id || '');
  const isCreate = idParam === 'new';
  const routeTab: TabKey = TAB_KEYS.includes(params.tab as TabKey) ? (params.tab as TabKey) : 'overview';

  const { data, error, isPlaceholderData } = useQuery({
    // Shared with the neighbours' prefetch (previous / next show at once).
    ...capexDetailQuery(idParam),
    enabled: !isCreate,
    placeholderData: (previousData) => previousData,
  });
  const stale = isPlaceholderData;
  const uuid = (data?.id as string | undefined) || (isCreate ? idParam : undefined);

  React.useEffect(() => {
    if (!data?.item_number) return;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(idParam);
    if (!isUuid) return;
    const ref = formatItemRef('capex', data.item_number);
    window.history.replaceState(null, '', `/ops/capex/${ref}/${routeTab}${location.search}`);
  }, [data?.item_number, idParam, routeTab, location.search]);

  const relationsCountQuery = useQuery({
    queryKey: ['capex-relations-count', uuid],
    queryFn: () => fetchCapexRelationsCount(uuid as string),
    enabled: !!uuid && !isCreate,
  });

  const { data: currencySettings } = useCurrencySettings();
  const defaultCapexCurrency = React.useMemo(
    () => currencySettings?.defaultCapexCurrency?.toUpperCase() ?? 'EUR',
    [currencySettings],
  );
  const [form, setForm] = React.useState<CapexForm>(EMPTY_FORM);
  const [createForm, setCreateForm] = React.useState<CapexForm>(() => createEmptyCapexForm());
  const [createCurrencyTouched, setCreateCurrencyTouched] = React.useState(false);
  const [createCompanyFromCostCenter, setCreateCompanyFromCostCenter] = React.useState(false);
  const [createSubmitting, setCreateSubmitting] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!isCreate) return;
    setCreateForm(createEmptyCapexForm(defaultCapexCurrency));
    setCreateCurrencyTouched(false);
    setCreateCompanyFromCostCenter(false);
    setSaveError(null);
  }, [isCreate, idParam]);
  React.useEffect(() => {
    if (!isCreate || createCurrencyTouched) return;
    setCreateForm((prev) => (
      prev.currency === defaultCapexCurrency ? prev : { ...prev, currency: defaultCapexCurrency }
    ));
  }, [createCurrencyTouched, defaultCapexCurrency, isCreate]);

  const updateCreateForm = React.useCallback((patch: Partial<CapexForm>) => {
    setCreateForm((prev) => mergePatch(prev, patch));
    setSaveError(null);
  }, []);

  // A cost center picked while the paying company is empty brings its company, so the
  // account picker opens on that company's chart of accounts. The company keeps following
  // the cost center until the user picks a company or an account.
  const costCenterTree = useCostCenterTree();
  const pickCreateCostCenter = React.useCallback((costCenterId: string) => {
    const companyId = costCenterId ? costCenterTree.byId.get(costCenterId)?.company_id : null;
    const follow = !!companyId && (
      !createForm.paying_company_id || (createCompanyFromCostCenter && !createForm.account_id)
    );
    updateCreateForm({ cost_center_id: costCenterId, ...(follow && companyId ? { paying_company_id: companyId } : {}) });
    if (follow) setCreateCompanyFromCostCenter(true);
  }, [costCenterTree, createCompanyFromCostCenter, createForm.account_id, createForm.paying_company_id, updateCreateForm]);

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

  // The list's sort, '' for the default one: prev/next and the list then use the current default.
  const budgetColumns = useBudgetColumns();
  // The list builds a column for each enabled dimension besides the default one; a sort or filter
  // on another dimension falls back there, and here too.
  const analyticsAxes = useAnalyticsAxes();
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
  // Status scope of the list we came from. The grid keeps it in local state, so it reaches
  // us through the stored list context; it must be forwarded to prev/next or the navigation
  // walks a different set from the one on screen.
  const statusScope = storedListContext?.statusScope || 'enabled';
  React.useEffect(() => {
    if (listContextReady) writeListSnapshot(LIST_ENDPOINT, { sort, q, filters, statusScope }, readStoredCapexListContext, writeStoredCapexListContext);
  }, [listContextReady, sort, q, filters, statusScope]);
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
  const nav = useCapexNav({ id: idParam, sort: sort || null, q, filters, statusScope, enabled: listContextReady && !isCreate });
  const { index, total, hasPrev, hasNext, prevId, nextId } = isCreate
    ? { index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null as any, nextId: null as any }
    : nav;

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

  const dialogs = useKanapDialogs();
  const autosaveRegistry = useAutosaveRegistry();
  // Fields edited and not saved yet, each with the line it was edited on (the page
  // stays mounted from one line to the next): a field only ever goes to its own line.
  // Each also keeps the value the screen showed when its edit began (its base, lot 3C):
  // the server refuses a field someone else changed meanwhile (409 edit_conflict).
  const patchBuffer = usePatchBuffer<Partial<CapexForm>>(mergePatch);
  const autosave = useAutosave({
    onError: (e) => setSaveError(autosaveErrorMessage(e, t, t('capex.editor.failedToSave'))),
    registry: autosaveRegistry,
    // A conflict waiting for the user's choice keeps the page busy: leaving asks first.
    held: patchBuffer.hasConflicts,
  });
  const conflicts = useEditConflicts(patchBuffer, isCreate ? null : uuid);
  const uuidRef = React.useRef(uuid);
  uuidRef.current = uuid;
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const formRef = React.useRef(form);
  formRef.current = form;
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
  const baseFor = React.useCallback((patch: Partial<CapexForm>): Partial<CapexForm> => {
    const shown = formRef.current;
    const base: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as Array<keyof CapexForm>) {
      if (key === 'status') continue;
      base[key] = key === 'analytics_values'
        ? Object.fromEntries(Object.keys(patch.analytics_values ?? {}).map((axisId) => [axisId, shown.analytics_values[axisId] ?? null]))
        : shown[key];
    }
    return base as Partial<CapexForm>;
  }, []);

  const invalidateLine = React.useCallback((lineId: string) => queryClient.invalidateQueries({
    queryKey: ['capex'],
    predicate: (q) => (q.state.data as { id?: string } | undefined)?.id === lineId,
  }), [queryClient]);

  const flushPending = React.useCallback(() => sendPatchBuffer(
    patchBuffer,
    async (lineId, patch, base) => {
      const body = normalizePatch({ ...patch });
      const baseBody = normalizePatch({ ...base });
      await api.patch(`/capex-items/${lineId}`, Object.keys(baseBody).length > 0 ? { ...body, base: baseBody } : body);
    },
    {
      onSaved: async (lineId) => {
        await invalidateLine(lineId);
        queryClient.invalidateQueries({ queryKey: ['capex-summary'] });
      },
      // Refused for good: the screen shows the line's stored values again for those fields.
      onRefused: (lineId, patch) => {
        const stored = dataRef.current;
        if (lineId === uuidRef.current && stored) {
          setForm((prev) => {
            if (prev.id !== lineId) return prev;
            const server = toForm(stored);
            const fields = (Object.keys(patch) as Array<keyof CapexForm>).filter((field) => !patchBuffer.holds(lineId, field));
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

  // Immediate persist — selects, dates, pickers, status, title-on-blur. Through the same
  // buffer as typing, sent at once: the field goes to its own line with its base, a busy
  // answer is retried, a refusal shows the stored value again, a conflict asks the user.
  const patchNow = React.useCallback(async (patch: Partial<CapexForm>) => {
    if (isCreate || !uuid || stale) return;
    const base = baseFor(patch);
    setForm((prev) => mergePatch(prev, patch));
    setSaveError(null);
    patchBuffer.add(uuid, patch, base);
    autosave.schedule(flushPending);
    await autosave.flush();
  }, [isCreate, uuid, stale, baseFor, patchBuffer, autosave, flushPending]);

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

  const patchDebounced = React.useCallback((patch: Partial<CapexForm>) => {
    if (isCreate || !uuid || stale) return;
    const base = baseFor(patch);
    setForm((prev) => mergePatch(prev, patch));
    patchBuffer.add(uuid, patch, base);
    autosave.schedule(flushPending);
  }, [isCreate, uuid, stale, autosave, flushPending, patchBuffer, baseFor]);

  // ----- Edit conflicts (lot 3C): someone else changed a field being saved -----
  const resolveConflict = React.useCallback((field: string, choice: ConflictChoice) => {
    if (!uuid) return;
    // Keeping their end of validity drops the status the user's date set; keeping their
    // company drops the account the user's company cleared (it only made sense with it).
    const held = patchBuffer.held(uuid);
    const companions = choice !== 'theirs' ? []
      : field === 'disabled_at' ? ['status']
        : field === 'paying_company_id' && held?.account_id === '' ? ['account_id'] : [];
    const send = patchBuffer.resolve(uuid, field, choice, companions);
    // A field kept as theirs shows the stored value again; the line reloads for the latest one.
    if (dataRef.current) syncForm(dataRef.current);
    void invalidateLine(uuid);
    if (send) {
      autosave.schedule(flushPending);
      void autosave.flush();
    }
  }, [uuid, patchBuffer, syncForm, invalidateLine, autosave, flushPending]);

  const conflictFieldLabel = React.useCallback((field: string) => {
    if (field.startsWith(ANALYTICS_CONFLICT_PREFIX)) {
      const axisId = field.slice(ANALYTICS_CONFLICT_PREFIX.length);
      return analyticsAxes.label(analyticsAxes.axes.find((axis) => axis.id === axisId) ?? { name: null });
    }
    const key = CONFLICT_FIELD_LABELS[field];
    return key ? t(key) : field;
  }, [analyticsAxes, t]);

  const formatConflictValue = React.useCallback((field: string, value: unknown): string | undefined => {
    if (field === 'effective_start') return formatShortDate(String(value), locale, { year: 'always' });
    if (field === 'disabled_at') return formatShortDate(new Date(String(value)), locale, { year: 'always' });
    const enumKey = CONFLICT_ENUM_KEYS[field];
    if (enumKey && typeof value === 'string') return t(`${enumKey}.${value}`, { defaultValue: value });
    return undefined;
  }, [locale, t]);

  const budgetRef = React.useRef<BudgetTabHandle>(null);
  const allocRef = React.useRef<AllocationsTabHandle>(null);
  // The paying company's country, for the budget tab: a new costed line starts on its standard calendar.
  const payingCompanyId = form.paying_company_id;
  const payingCompanyQuery = useQuery({
    queryKey: ['companies', payingCompanyId],
    queryFn: async () => (await api.get(`/companies/${payingCompanyId}`)).data,
    enabled: routeTab === 'budget' && !isCreate && !!payingCompanyId,
    staleTime: 5 * 60_000,
  });
  const payingCompanyCountry = (payingCompanyQuery.data as { country_iso?: string | null } | undefined)?.country_iso ?? null;
  const relationsRef = React.useRef<RelationsPanelHandle>(null);

  const activeRefEditor = React.useCallback(() => {
    if (routeTab === 'relations') return relationsRef.current;
    return null;
  }, [routeTab]);

  const flushAll = React.useCallback(async (): Promise<boolean> => {
    const overviewOk = await autosave.flush();
    if (!overviewOk) return false;
    if (routeTab === 'budget') return (await budgetRef.current?.flush()) ?? true;
    if (routeTab === 'allocations') return (await allocRef.current?.flush()) ?? true;
    const editor = activeRefEditor();
    if (editor?.isDirty?.()) {
      try { await editor.save(); } catch { return false; }
    }
    return true;
  }, [autosave, activeRefEditor, routeTab]);

  // A save that still fails once flushed (the server stays busy, a tab keeps its edits) must not
  // trap the user on the line: leaving is offered, and drops what could not be saved.
  const flushOrLeave = React.useCallback(async (): Promise<boolean> => {
    if (await flushAll()) return true;
    const unsaved = autosaveRegistry.isBusy()
      || (routeTab === 'budget' && !!budgetRef.current?.isDirty())
      || (routeTab === 'allocations' && !!allocRef.current?.isDirty())
      || !!activeRefEditor()?.isDirty?.();
    // Nothing left unsaved (the save was refused and the screen reloaded): stay, the message shows why.
    if (!unsaved) return false;
    const leave = await dialogs.confirm({
      title: t('common:autosave.leaveTitle'),
      message: patchBuffer.hasConflicts() ? t('common:autosave.leaveConflictMessage') : t('common:autosave.leaveMessage'),
      confirmLabel: t('common:autosave.leaveConfirm'),
      intent: 'danger',
    });
    if (!leave) return false;
    autosaveRegistry.discardAll();
    patchBuffer.discard();
    setSaveError(null);
    if (dataRef.current) setForm(toForm(dataRef.current));
    return true;
  }, [flushAll, autosaveRegistry, routeTab, activeRefEditor, dialogs, t, patchBuffer]);

  const goToTab = React.useCallback(async (nextTab: TabKey) => {
    if (isCreate && nextTab !== 'overview') return;
    if (!(await flushOrLeave())) return;
    const sp = buildListContextParams();
    navigate(`/ops/capex/${idParam}/${nextTab}?${sp.toString()}`);
  }, [isCreate, flushOrLeave, buildListContextParams, navigate, idParam]);

  const confirmAndNavigate = React.useCallback(async (targetId: string | null) => {
    if (!targetId) return;
    if (!(await flushOrLeave())) return;
    const sp = buildListContextParams();
    navigate(`/ops/capex/${targetId}/${routeTab}?${sp.toString()}`);
  }, [flushOrLeave, buildListContextParams, navigate, routeTab]);

  const closeWorkspace = React.useCallback(async () => {
    if (!(await flushOrLeave())) return;
    const sp = buildListContextParams();
    const qs = sp.toString();
    navigate(`/ops/capex${qs ? `?${qs}` : ''}`);
  }, [flushOrLeave, buildListContextParams, navigate]);

  const handleCreate = React.useCallback(async () => {
    if (createSubmitting) return; // Ctrl+S bypasses the disabled button — guard double-submit
    const description = createForm.description.trim();
    if (!description) {
      setSaveError(t('capex.editor.descriptionRequired'));
      return;
    }
    if ((createForm.currency || '').trim().length !== 3) {
      setSaveError(t('capex.editor.currencyMust3'));
      return;
    }
    if (!createForm.effective_start) {
      setSaveError(t('capex.editor.effectiveStartRequired'));
      return;
    }
    if (!createForm.paying_company_id) {
      setSaveError(t('capex.editor.payingCompanyRequired'));
      return;
    }
    if (!createForm.account_id) {
      setSaveError(t('capex.editor.accountRequired'));
      return;
    }

    setCreateSubmitting(true);
    setSaveError(null);
    try {
      const payload = {
        description,
        supplier_id: toNull(createForm.supplier_id),
        ppe_type: createForm.ppe_type,
        investment_type: createForm.investment_type,
        priority: createForm.priority,
        currency: createForm.currency.toUpperCase(),
        effective_start: createForm.effective_start,
        ...(createForm.disabled_at
          ? { disabled_at: createForm.disabled_at, status: deriveStatusFromDisabledAt(createForm.disabled_at) }
          : {}),
        notes: toNull(createForm.notes),
        paying_company_id: createForm.paying_company_id,
        account_id: createForm.account_id,
        owner_it_id: toNull(createForm.owner_it_id),
        owner_business_id: toNull(createForm.owner_business_id),
        // Only the dimensions given a value: the others stay empty on the new line.
        analytics_values: Object.fromEntries(Object.entries(createForm.analytics_values).filter(([, id]) => !!id)),
        cost_center_id: toNull(createForm.cost_center_id),
        run_build: toNull(createForm.run_build),
      };
      const res = await api.post('/capex-items', payload);
      const newId = res.data?.id as string | undefined;
      if (!newId) throw new Error(t('capex.editor.failedToCreate'));
      queryClient.invalidateQueries({ queryKey: ['capex-summary'] });
      queryClient.invalidateQueries({ queryKey: ['capex-items-summary-neighbors'] });
      const sp = buildListContextParams();
      navigate(`/ops/capex/${newId}/overview?${sp.toString()}`);
    } catch (e) {
      setSaveError(getApiErrorMessage(e, t, t('capex.editor.failedToCreate')));
    } finally {
      setCreateSubmitting(false);
    }
  }, [buildListContextParams, createForm, createSubmitting, navigate, queryClient, t]);

  const handleStatusChange = (next: StatusValue) => {
    const disabled_at = next === 'disabled' ? (form.disabled_at || new Date().toISOString()) : null;
    void patchNow({ status: deriveStatusFromDisabledAt(disabled_at), disabled_at });
  };
  const handleDisabledAtChange = (next: string | null) => {
    const disabled_at = normalizeDisabledAtInput(next);
    void patchNow({ status: deriveStatusFromDisabledAt(disabled_at), disabled_at });
  };

  const reference = data?.item_number ? formatItemRef('capex', data.item_number) : null;
  const { addToRecent } = useRecentlyViewed();
  React.useEffect(() => {
    if (!isCreate && data?.id && data?.description) addToRecent('capex_item', data.id, data.description, reference || undefined);
  }, [addToRecent, data?.id, data?.description, isCreate, reference]);

  const tabs = React.useMemo(() => ([
    { key: 'overview', label: t('capex.tabs.overview') },
    { key: 'budget', label: t('capex.tabs.budget') },
    { key: 'allocations', label: t('capex.tabs.allocations') },
    { key: 'relations', label: t('capex.tabs.relations') },
  ] as Array<{ key: TabKey; label: string }>), [t]);

  const savingHint = autosave.status === 'saving' || autosave.status === 'pending'
    ? t('common:status.saving', 'Saving...')
    : autosave.status === 'saved'
      ? t('common:status.saved', 'Saved')
      : null;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!!error && <Alert severity="error" sx={{ mx: 2, mt: 1 }}>{t('capex.workspace.failedToLoad')}</Alert>}
      {!!saveError && <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setSaveError(null)}>{saveError}</Alert>}
      {!isCreate && (
        <EditConflictBanner
          conflicts={conflicts}
          fieldLabel={conflictFieldLabel}
          formatValue={formatConflictValue}
          isLongText={isLongTextField}
          onResolve={resolveConflict}
          busy={autosave.status === 'saving'}
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
        drawerStorageKey="kanap.capex.drawerOpen"
        backLabel={t('capex.workspace.capexItems', 'CAPEX items')}
        onBack={() => { void closeWorkspace(); }}
        itemReference={reference}
        onCopyReference={reference ? () => { void navigator.clipboard?.writeText(reference); } : undefined}
        title={isCreate ? createForm.description : form.description}
        titleFallback={isCreate ? t('capex.workspace.newCapexItem') : t('capex.workspace.capexItem')}
        canEditTitle
        onTitleSave={(value) => {
          if (isCreate) {
            updateCreateForm({ description: value });
          } else {
            void patchNow({ description: value });
          }
        }}
        isCreate={isCreate}
        forceDrawerOpen={isCreate}
        nav={!isCreate && total > 0 ? {
          currentIndex: index + 1,
          totalCount: total,
          hasPrev,
          hasNext,
          onPrev: () => { void confirmAndNavigate(prevId); },
          onNext: () => { void confirmAndNavigate(nextId); },
          previousLabel: t('capex.workspace.prev'),
          nextLabel: t('capex.workspace.next'),
        } : undefined}
        onSaveShortcut={() => { if (isCreate) { void handleCreate(); } else { void flushAll(); } }}
        metadata={!isCreate ? (
          <CapexMetadataBar
            status={form.status}
            priority={form.priority}
            ownerItId={form.owner_it_id || null}
            ownerBizId={form.owner_business_id || null}
            costCenterId={form.cost_center_id || null}
            onStatusChange={handleStatusChange}
            onPriorityChange={(v) => void patchNow({ priority: v })}
            onOwnerItChange={(v) => void patchNow({ owner_it_id: (v || '') as string })}
            onOwnerBizChange={(v) => void patchNow({ owner_business_id: (v || '') as string })}
          />
        ) : undefined}
        actions={(
          <>
            {savingHint && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center', mr: 0.5 }}>
                {savingHint}
              </Typography>
            )}
            {!isCreate && uuid && (
              <SendLinkButton
                itemType="capex"
                itemId={uuid}
                itemName={form.description || t('capex.workspace.capexItem')}
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
          <CapexPropertiesDrawer
            mode="create"
            supplierId={createForm.supplier_id}
            payingCompanyId={createForm.paying_company_id}
            accountId={createForm.account_id}
            currency={createForm.currency}
            ppeType={createForm.ppe_type}
            investmentType={createForm.investment_type}
            priority={createForm.priority}
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
            onPpeTypeChange={(v) => updateCreateForm({ ppe_type: v })}
            onInvestmentTypeChange={(v) => updateCreateForm({ investment_type: v })}
            onPriorityChange={(v) => updateCreateForm({ priority: v })}
            onAnalyticsValueChange={(axisId, v) => updateCreateForm({ analytics_values: { [axisId]: v } })}
            onCostCenterChange={pickCreateCostCenter}
            onRunBuildChange={(v) => updateCreateForm({ run_build: v })}
            onEffectiveStartChange={(v) => updateCreateForm({ effective_start: v })}
            onDisabledAtChange={(v) => updateCreateForm({ disabled_at: v, status: deriveStatusFromDisabledAt(v) })}
            onOwnerItChange={(v) => updateCreateForm({ owner_it_id: v })}
            onOwnerBusinessChange={(v) => updateCreateForm({ owner_business_id: v })}
          />
        ) : (
          <CapexPropertiesDrawer
            mode="edit"
            supplierId={form.supplier_id}
            payingCompanyId={form.paying_company_id}
            accountId={form.account_id}
            currency={form.currency}
            ppeType={form.ppe_type}
            investmentType={form.investment_type}
            priority={form.priority}
            analyticsValues={form.analytics_values}
            costCenterId={form.cost_center_id}
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
            onPpeTypeChange={(v) => void patchNow({ ppe_type: v })}
            onInvestmentTypeChange={(v) => void patchNow({ investment_type: v })}
            // priority is edited via the metadata bar in edit mode; the drawer renders it in create mode only
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
                  {t('capex.editor.obsoleteAccount')}
                </Alert>
              )}
              <Box>
                <Typography component="label" sx={sectionLabelSx}>{t('capex.fields.description')}</Typography>
                <TextField
                  value={createForm.notes}
                  onChange={(e) => updateCreateForm({ notes: e.target.value })}
                  multiline minRows={4} fullWidth variant="standard"
                  placeholder={t('capex.fields.notesPlaceholder', 'e.g., approved investment rationale')}
                  sx={composerSx}
                  disabled={createSubmitting}
                />
              </Box>
            </Stack>
          ) : (
            <Stack spacing={3} sx={{ pt: 1 }}>
              <Box>
                <Typography component="label" sx={sectionLabelSx}>{t('capex.fields.description')}</Typography>
                <TextField
                  value={form.notes}
                  onChange={(e) => patchDebounced({ notes: e.target.value })}
                  multiline minRows={4} fullWidth variant="standard"
                  placeholder={t('capex.fields.notesPlaceholder', 'e.g., approved investment rationale')}
                  sx={composerSx}
                />
              </Box>
              {uuid && <EntityTasksPanel key={uuid} entityType="capex_item" entityId={uuid} />}
            </Stack>
          )
        )}

        {routeTab === 'budget' && !isCreate && uuid && (
          <BudgetTab key={uuid} id={uuid} year={currentYear} currency={form.currency} availableYears={availableYears} onYearChange={setYear} config={CAPEX_FINANCE_CONFIG} effectiveStart={form.effective_start} endOfValidity={isoToLocalDateInput(form.disabled_at)} payingCompanyCountry={payingCompanyCountry} ref={budgetRef} />
        )}
        {routeTab === 'allocations' && !isCreate && uuid && (
          <AllocationsTab key={uuid} id={uuid} year={currentYear} currency={form.currency} availableYears={availableYears} onYearChange={setYear} config={CAPEX_FINANCE_CONFIG} ref={allocRef} />
        )}
        {routeTab === 'relations' && !isCreate && uuid && (
          <RelationsPanel key={uuid} id={uuid} ref={relationsRef} autoSave onRelationsChange={() => { void relationsCountQuery.refetch(); }} />
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
