import React from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useCapexNav } from '../../hooks/useCapexNav';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { explicitSort, filtersStringOnShownColumns } from '../../components/finance/amountColumns';
import useAutosave from '../../hooks/useAutosave';
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
  analytics_category_id: string;
  cost_center_id: string;
  run_build: RunBuild | '';
  notes: string;
  created_at: string | null;
  updated_at: string | null;
};

const EMPTY_FORM: CapexForm = {
  description: '', supplier_id: '', currency: 'EUR', account_id: '', paying_company_id: '',
  ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium',
  effective_start: '', status: 'enabled', disabled_at: null,
  owner_it_id: '', owner_business_id: '', analytics_category_id: '', cost_center_id: '', run_build: '', notes: '',
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
  'analytics_category_id',
  'cost_center_id',
  'run_build',
  'disabled_at',
  'notes',
]);

function normalizePatch(patch: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [
    key,
    NULLABLE_PATCH_FIELDS.has(key) && value === '' ? null : value,
  ]));
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
    analytics_category_id: data?.analytics_category_id || '',
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

export default function CapexItemPage() {
  const { t } = useTranslation(['ops', 'common']);
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

  const { data, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ['capex', idParam],
    queryFn: async () => (await api.get(`/capex-items/${idParam}`)).data,
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
    if (data && !isCreate) setForm(toForm(data));
  }, [data, isCreate]);
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
    setCreateForm((prev) => ({ ...prev, ...patch }));
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
  const sort = explicitSort(searchParams.get('sort') || storedListContext?.sort, budgetColumns.shown, budgetColumns.defaultSort);
  const q = searchParams.get('q') || storedListContext?.q || '';
  // A filter on a column that is not shown falls back like the list's, so prev/next walks the rows on screen.
  const filters = filtersStringOnShownColumns(searchParams.get('filters') || storedListContext?.filters, budgetColumns.shown);
  // Status scope of the list we came from. The grid keeps it in local state, so it reaches
  // us through the stored list context; it must be forwarded to prev/next or the navigation
  // walks a different set from the one on screen.
  const statusScope = storedListContext?.statusScope || 'enabled';
  React.useEffect(() => {
    if (budgetColumns.ready) writeStoredCapexListContext({ sort, q, filters, statusScope });
  }, [budgetColumns.ready, sort, q, filters, statusScope]);
  const buildListContextParams = React.useCallback(() => {
    const sp = new URLSearchParams(searchParamsString);
    if (sort) sp.set('sort', sort); else sp.delete('sort');
    if (!sp.get('q') && q) sp.set('q', q);
    if (!sp.get('filters') && filters) sp.set('filters', filters);
    return sp;
  }, [filters, q, searchParamsString, sort]);

  const nav = useCapexNav({ id: uuid || idParam, sort: sort || null, q, filters, statusScope, enabled: budgetColumns.ready });
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

  const autosave = useAutosave({
    onError: (e) => setSaveError(getApiErrorMessage(e, t, t('capex.editor.failedToSave'))),
  });
  const pendingPatchRef = React.useRef<Record<string, any>>({});

  const flushPending = React.useCallback(async () => {
    if (!uuid) return;
    const keys = Object.keys(pendingPatchRef.current);
    if (keys.length === 0) return;
    const patch = normalizePatch({ ...pendingPatchRef.current });
    pendingPatchRef.current = {};
    await api.patch(`/capex-items/${uuid}`, patch);
    await queryClient.invalidateQueries({ queryKey: ['capex', idParam] });
    queryClient.invalidateQueries({ queryKey: ['capex-summary'] });
  }, [uuid, idParam, queryClient]);

  const patchNow = React.useCallback(async (patch: Partial<CapexForm>) => {
    if (isCreate || !uuid || stale) return;
    setForm((prev) => ({ ...prev, ...patch }));
    setSaveError(null);
    try {
      await api.patch(`/capex-items/${uuid}`, normalizePatch(patch));
      await queryClient.invalidateQueries({ queryKey: ['capex', idParam] });
      queryClient.invalidateQueries({ queryKey: ['capex-summary'] });
    } catch (e) {
      setSaveError(getApiErrorMessage(e, t, t('capex.editor.failedToSave')));
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

  const patchDebounced = React.useCallback((patch: Partial<CapexForm>) => {
    if (isCreate || !uuid || stale) return;
    setForm((prev) => ({ ...prev, ...patch }));
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    autosave.schedule(flushPending);
  }, [isCreate, uuid, stale, autosave, flushPending]);

  const budgetRef = React.useRef<BudgetTabHandle>(null);
  const allocRef = React.useRef<AllocationsTabHandle>(null);
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

  const goToTab = React.useCallback(async (nextTab: TabKey) => {
    if (isCreate && nextTab !== 'overview') return;
    if (!(await flushAll())) return;
    const sp = buildListContextParams();
    navigate(`/ops/capex/${idParam}/${nextTab}?${sp.toString()}`);
  }, [isCreate, flushAll, buildListContextParams, navigate, idParam]);

  const confirmAndNavigate = React.useCallback(async (targetId: string | null) => {
    if (!targetId) return;
    if (!(await flushAll())) return;
    const sp = buildListContextParams();
    navigate(`/ops/capex/${targetId}/${routeTab}?${sp.toString()}`);
  }, [flushAll, buildListContextParams, navigate, routeTab]);

  const closeWorkspace = React.useCallback(async () => {
    if (!(await flushAll())) return;
    const sp = buildListContextParams();
    const qs = sp.toString();
    navigate(`/ops/capex${qs ? `?${qs}` : ''}`);
  }, [flushAll, buildListContextParams, navigate]);

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
        analytics_category_id: toNull(createForm.analytics_category_id),
        cost_center_id: toNull(createForm.cost_center_id),
        run_build: toNull(createForm.run_build),
      };
      const res = await api.post('/capex-items', payload);
      const newId = res.data?.id as string | undefined;
      if (!newId) throw new Error(t('capex.editor.failedToCreate'));
      queryClient.invalidateQueries({ queryKey: ['capex-summary'] });
      queryClient.invalidateQueries({ queryKey: ['capex-items-summary-ids'] });
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
            analyticsCategoryId={createForm.analytics_category_id}
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
            onAnalyticsCategoryChange={(v) => updateCreateForm({ analytics_category_id: v })}
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
            analyticsCategoryId={form.analytics_category_id}
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
            onAnalyticsCategoryChange={(v) => void patchNow({ analytics_category_id: v })}
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
          <BudgetTab key={uuid} id={uuid} year={currentYear} currency={form.currency} availableYears={availableYears} onYearChange={setYear} config={CAPEX_FINANCE_CONFIG} effectiveStart={form.effective_start} endOfValidity={isoToLocalDateInput(form.disabled_at)} ref={budgetRef} />
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
