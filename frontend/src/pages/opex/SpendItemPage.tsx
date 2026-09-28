import React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useSpendNav } from '../../hooks/useSpendNav';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { dimensionFieldPredicate, explicitSort, filtersStringOnShownColumns } from '../../components/finance/amountColumns';
import useAutosave from '../../hooks/useAutosave';
import { formatItemRef } from '../../utils/item-ref';
import {
  StatusValue,
  deriveStatusFromDisabledAt,
  normalizeDisabledAtInput,
} from '../../constants/status';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import SpendMetadataBar from './workspace/SpendMetadataBar';
import SpendPropertiesDrawer, { RunBuild } from './workspace/SpendPropertiesDrawer';
import { useCostCenterTree } from '../../hooks/useCostCenterTree';
import BudgetTab, { BudgetTabHandle } from '../../components/finance/BudgetTab';
import AllocationsTab, { AllocationsTabHandle } from '../../components/finance/AllocationsTab';
import { OPEX_FINANCE_CONFIG } from '../../components/finance/config';
import RelationsPanel, { RelationsPanelHandle } from './editors/RelationsPanel';
import EntityTasksPanel from '../../components/EntityTasksPanel';
import { readStoredOpexListContext, writeStoredOpexListContext } from './listContextStorage';
import { fetchSpendRelationsCount } from '../../utils/workspaceTabCounts';
import useCurrencySettings from '../../hooks/useCurrencySettings';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { isoToLocalDateInput } from '../../lib/datetime';
import type { ItemAnalyticsValue } from '../../services/analytics';

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
  const { t } = useTranslation(['ops', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsString = searchParams.toString();
  const queryClient = useQueryClient();
  const storedListContext = React.useMemo(() => readStoredOpexListContext(), []);

  const idParam = String(params.id || '');
  const isCreate = idParam === 'new';
  const routeTab: TabKey = TAB_KEYS.includes(params.tab as TabKey) ? (params.tab as TabKey) : 'overview';

  const { data, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ['spend', idParam],
    queryFn: async () => (await api.get(`/spend-items/${idParam}`)).data,
    enabled: !isCreate,
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

  // Tab badge counts.
  const relationsCountQuery = useQuery({
    queryKey: ['spend-relations-count', uuid],
    queryFn: () => fetchSpendRelationsCount(uuid as string),
    enabled: !!uuid && !isCreate,
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
    if (data && !isCreate) setForm(toForm(data));
  }, [data, isCreate]);
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

  // List context for prev/next + return navigation.
  // The list's sort, '' for the default one: prev/next and the list then use the current default.
  const budgetColumns = useBudgetColumns();
  // The list builds a column for each enabled dimension besides the default one; a sort or filter
  // on another dimension falls back there, and here too.
  const analyticsAxes = useAnalyticsAxes();
  const isListField = React.useMemo(
    () => dimensionFieldPredicate(analyticsAxes.enabled.filter((axis) => !axis.is_default).map((axis) => axis.id)),
    [analyticsAxes],
  );
  const listContextReady = budgetColumns.ready && analyticsAxes.ready;
  const sort = explicitSort(searchParams.get('sort') || storedListContext?.sort, budgetColumns.shown, budgetColumns.defaultSort, isListField);
  const q = searchParams.get('q') || storedListContext?.q || '';
  // A filter on a column that is not shown falls back like the list's, so prev/next walks the rows on screen.
  const filters = filtersStringOnShownColumns(searchParams.get('filters') || storedListContext?.filters, budgetColumns.shown, isListField);
  // Status scope of the list we came from. The grid keeps it in local state, so it reaches
  // us through the stored list context; it must be forwarded to prev/next or the navigation
  // walks a different set from the one on screen.
  const statusScope = storedListContext?.statusScope || 'enabled';
  React.useEffect(() => {
    if (listContextReady) writeStoredOpexListContext({ sort, q, filters, statusScope });
  }, [listContextReady, sort, q, filters, statusScope]);
  const buildListContextParams = React.useCallback(() => {
    const sp = new URLSearchParams(searchParamsString);
    if (sort) sp.set('sort', sort); else sp.delete('sort');
    if (!sp.get('q') && q) sp.set('q', q);
    if (!sp.get('filters') && filters) sp.set('filters', filters);
    return sp;
  }, [filters, q, searchParamsString, sort]);

  const nav = useSpendNav({ id: uuid || idParam, sort: sort || null, q, filters, statusScope, enabled: listContextReady });
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
  const autosave = useAutosave({
    onError: (e) => setSaveError(getApiErrorMessage(e, t, t('opex.editor.failedToSave'))),
  });
  const pendingPatchRef = React.useRef<Record<string, any>>({});

  const flushPending = React.useCallback(async () => {
    if (!uuid) return;
    const keys = Object.keys(pendingPatchRef.current);
    if (keys.length === 0) return;
    const patch = normalizePatch({ ...pendingPatchRef.current });
    pendingPatchRef.current = {};
    await api.patch(`/spend-items/${uuid}`, patch);
    await queryClient.invalidateQueries({ queryKey: ['spend', idParam] });
    queryClient.invalidateQueries({ queryKey: ['spend-summary'] });
  }, [uuid, idParam, queryClient, t]);

  // Immediate persist — selects, dates, pickers, status, title-on-blur.
  const patchNow = React.useCallback(async (patch: Partial<SpendForm>) => {
    if (isCreate || !uuid || stale) return;
    setForm((prev) => mergePatch(prev, patch));
    setSaveError(null);
    try {
      await api.patch(`/spend-items/${uuid}`, normalizePatch(patch));
      await queryClient.invalidateQueries({ queryKey: ['spend', idParam] });
      queryClient.invalidateQueries({ queryKey: ['spend-summary'] });
    } catch (e) {
      setSaveError(getApiErrorMessage(e, t, t('opex.editor.failedToSave')));
      await refetch();
    }
  }, [isCreate, uuid, stale, idParam, queryClient, refetch, t]);

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
    setForm((prev) => mergePatch(prev, patch));
    pendingPatchRef.current = mergePatch(pendingPatchRef.current, patch);
    autosave.schedule(flushPending);
  }, [isCreate, uuid, stale, autosave, flushPending]);

  // ----- Transitional ref-save tabs (budget / allocations / relations) -----
  const budgetRef = React.useRef<BudgetTabHandle>(null);
  const allocRef = React.useRef<AllocationsTabHandle>(null);
  const relationsRef = React.useRef<RelationsPanelHandle>(null);

  // Relations autosaves internally; flushAll drains any pending write on navigation.
  const activeRefEditor = React.useCallback(() => {
    if (routeTab === 'relations') return relationsRef.current;
    return null;
  }, [routeTab]);

  // Drain every pending write before a controlled transition. If a save fails we
  // return false so the caller aborts the navigation — no edit is silently lost.
  const flushAll = React.useCallback(async (): Promise<boolean> => {
    const overviewOk = await autosave.flush();
    if (!overviewOk) return false;
    // Budget and Allocations autosave internally; flush() resolves false if the save rejected.
    if (routeTab === 'budget') return (await budgetRef.current?.flush()) ?? true;
    if (routeTab === 'allocations') return (await allocRef.current?.flush()) ?? true;
    const editor = activeRefEditor();
    if (editor?.isDirty?.()) {
      try { await editor.save(); } catch { return false; }
    }
    return true;
  }, [autosave, activeRefEditor, routeTab]);

  const goToTab = React.useCallback(async (nextTab: TabKey) => {
    if (isCreate && nextTab !== 'overview') return;
    if (!(await flushAll())) return;
    const sp = buildListContextParams();
    navigate(`/ops/opex/${idParam}/${nextTab}?${sp.toString()}`);
  }, [isCreate, flushAll, buildListContextParams, navigate, idParam]);

  const confirmAndNavigate = React.useCallback(async (targetId: string | null) => {
    if (!targetId) return;
    if (!(await flushAll())) return;
    const sp = buildListContextParams();
    navigate(`/ops/opex/${targetId}/${routeTab}?${sp.toString()}`);
  }, [flushAll, buildListContextParams, navigate, routeTab]);

  const closeWorkspace = React.useCallback(async () => {
    if (!(await flushAll())) return;
    const sp = buildListContextParams();
    const qs = sp.toString();
    navigate(`/ops/opex${qs ? `?${qs}` : ''}`);
  }, [flushAll, buildListContextParams, navigate]);

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
        // Only the dimensions given a value: the others stay empty on the new line.
        analytics_values: Object.fromEntries(Object.entries(createForm.analytics_values).filter(([, id]) => !!id)),
        cost_center_id: toNull(createForm.cost_center_id),
        run_build: toNull(createForm.run_build),
        notes: toNull(createForm.notes),
      };
      const res = await api.post('/spend-items', payload);
      const newId = res.data?.id as string | undefined;
      if (!newId) throw new Error(t('opex.editor.failedToCreate'));
      queryClient.invalidateQueries({ queryKey: ['spend-summary'] });
      queryClient.invalidateQueries({ queryKey: ['spend-items-summary-ids'] });
      const sp = buildListContextParams();
      navigate(`/ops/opex/${newId}/overview?${sp.toString()}`);
    } catch (e) {
      setSaveError(getApiErrorMessage(e, t, t('opex.editor.failedToCreate')));
    } finally {
      setCreateSubmitting(false);
    }
  }, [buildListContextParams, createForm, createSubmitting, navigate, queryClient, t]);

  // ----- Status lifecycle handlers -----
  const handleStatusChange = (next: StatusValue) => {
    const disabled_at = next === 'disabled' ? (form.disabled_at || new Date().toISOString()) : null;
    void patchNow({ status: deriveStatusFromDisabledAt(disabled_at), disabled_at });
  };
  const handleDisabledAtChange = (next: string | null) => {
    const disabled_at = normalizeDisabledAtInput(next);
    void patchNow({ status: deriveStatusFromDisabledAt(disabled_at), disabled_at });
  };

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
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!!error && <Alert severity="error" sx={{ mx: 2, mt: 1 }}>{t('opex.workspace.failedToLoad')}</Alert>}
      {!!saveError && <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setSaveError(null)}>{saveError}</Alert>}

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
            status={form.status}
            ownerItId={form.owner_it_id || null}
            ownerBizId={form.owner_business_id || null}
            costCenterId={form.cost_center_id || null}
            onStatusChange={handleStatusChange}
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
            supplierId={form.supplier_id}
            payingCompanyId={form.paying_company_id}
            accountId={form.account_id}
            currency={form.currency}
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
            onAnalyticsValueChange={(axisId, v) => void patchNow({ analytics_values: { [axisId]: v } })}
            onCostCenterChange={(v) => void patchNow({ cost_center_id: v })}
            onRunBuildChange={(v) => void patchNow({ run_build: v })}
            onEffectiveStartChange={(v) => void patchNow({ effective_start: v })}
            onStatusChange={handleStatusChange}
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

        {routeTab === 'budget' && !isCreate && uuid && (
          <BudgetTab key={uuid} id={uuid} year={currentYear} currency={form.currency} availableYears={availableYears} onYearChange={setYear} config={OPEX_FINANCE_CONFIG} effectiveStart={form.effective_start} endOfValidity={isoToLocalDateInput(form.disabled_at)} ref={budgetRef} />
        )}
        {routeTab === 'allocations' && !isCreate && uuid && (
          <AllocationsTab key={uuid} id={uuid} year={currentYear} currency={form.currency} availableYears={availableYears} onYearChange={setYear} config={OPEX_FINANCE_CONFIG} ref={allocRef} />
        )}
        {routeTab === 'relations' && !isCreate && uuid && (
          <RelationsPanel key={uuid} id={uuid} ref={relationsRef} autoSave onRelationsChange={() => { void relationsCountQuery.refetch(); }} />
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
