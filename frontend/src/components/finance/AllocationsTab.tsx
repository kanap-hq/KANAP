import React, { forwardRef, useImperativeHandle } from 'react';
import { Alert, Box, Button, IconButton, Menu, MenuItem, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { formatAmount } from '../../i18n/formatters';
import useAutosave from '../../hooks/useAutosave';
import YearTabs from '../navigation/YearTabs';
import { drawerMenuItemSx, drawerSelectSx, tableCellFieldSx } from '../../theme/formSx';
import { FinanceModuleConfig } from './config';
import { PropertyRow } from '../design';
import { fetchAllocationRule } from '../../services/allocationRules';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import type { AmountMeasure } from './roundPeriod';

type PickerOption = { id: string; label: string };

/**
 * Compact inline picker — a flat MenuItem list anchored to the value (charter:
 * finite lists like companies/departments use a Menu, never a nested Autocomplete).
 * One click opens; a second selects. Optionally auto-opens (e.g. on "Add row").
 */
function InlinePicker({
  value, options, placeholder, emptyLabel, disabled, error, autoOpen, onSelect, onAutoOpened,
}: {
  value: string | null;
  options: PickerOption[];
  placeholder: string;
  emptyLabel: string;
  disabled?: boolean;
  error?: boolean;
  autoOpen?: boolean;
  onSelect: (id: string) => void;
  onAutoOpened?: () => void;
}) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (autoOpen && btnRef.current && !anchorEl) {
      setAnchorEl(btnRef.current);
      onAutoOpened?.();
    }
  }, [autoOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = options.find((o) => o.id === value)?.label ?? null;
  return (
    <>
      <Box
        component="button"
        type="button"
        ref={btnRef}
        disabled={disabled}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.5, maxWidth: '100%',
          border: 0, bgcolor: 'transparent', font: 'inherit', textAlign: 'left', fontSize: 13,
          color: label ? 'kanap.text.primary' : (error ? 'kanap.danger' : 'kanap.text.tertiary'),
          cursor: disabled ? 'default' : 'pointer', p: '3px 6px', m: '-3px -6px', borderRadius: '4px',
          transition: 'background-color 120ms',
          '&:hover': disabled ? {} : { bgcolor: 'kanap.bg.composer' },
        }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label || placeholder}</Box>
        {!disabled && <KeyboardArrowDownIcon sx={{ fontSize: 16, color: 'kanap.text.secondary', flexShrink: 0 }} />}
      </Box>
      <Menu
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 240 } } }}
      >
        {options.length === 0
          ? <MenuItem disabled sx={drawerMenuItemSx}>{emptyLabel}</MenuItem>
          : options.map((o) => (
            <MenuItem key={o.id} selected={o.id === value} sx={drawerMenuItemSx} onClick={() => { onSelect(o.id); setAnchorEl(null); }}>
              {o.label}
            </MenuItem>
          ))}
      </Menu>
    </>
  );
}

export type AllocationsTabHandle = { flush: () => Promise<boolean>; isDirty: () => boolean };

type Props = {
  id: string;
  year: number;
  currency?: string;
  availableYears?: number[];
  onYearChange: (y: number) => void;
  config: FinanceModuleConfig;
};

type Method = 'default' | 'headcount' | 'it_users' | 'turnover' | 'manual_company' | 'manual_department' | 'manual_pct';
type Driver = 'headcount' | 'it_users' | 'turnover';
const METHODS: Method[] = ['default', 'headcount', 'it_users', 'turnover', 'manual_company', 'manual_department', 'manual_pct'];
type Version = { id: string; budget_year?: number; allocation_method?: Method; allocation_driver?: Driver };
type Row = { company_id: string | null; department_id: string | null; allocation_pct: number; pinned?: boolean };
type Company = { id: string; name: string; headcount_year?: number; it_users_year?: number; turnover_year?: number };
type Department = { id: string; name: string; company_id: string };

type ComputedItem = { company_id: string; department_id: string | null; allocation_pct: number };
type YearTotals = Partial<Record<AmountMeasure, number | string>>;
/** The line's allocation for one year, as stored: the tab's server state (React Query). */
type AllocationsSnapshot = { version: Version | null; computed: ComputedItem[]; totals: YearTotals };

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** The companies and departments of a year with their metrics, shared by every line (the drivers read them). */
export const allocationCompaniesKey = (year: number) => ['companies', 'allocation-metrics', year] as const;
export const allocationDepartmentsKey = (year: number) => ['departments', 'allocation-metrics', year] as const;
export const allocationsSnapshotKey = (itemsApi: string, id: string, year: number) => ['finance-allocations', itemsApi, id, year] as const;
const ORGANISATION_STALE_MS = 5 * 60_000;

async function fetchAllocationsSnapshot(config: FinanceModuleConfig, id: string, year: number, signal?: AbortSignal): Promise<AllocationsSnapshot> {
  const versRes = await api.get<Version[]>(`${config.itemsApi}/${id}/versions`, { signal });
  const version = (versRes.data || []).find((vv) => Number(vv.budget_year) === year) || null;
  if (!version) return { version: null, computed: [], totals: {} };
  const [computed, totals] = await Promise.all([
    api.get<{ items: ComputedItem[] }>(`${config.versionsApi}/${version.id}/allocations`, { signal }).then((r) => r.data?.items || []),
    api.get<{ totals?: YearTotals }>(`${config.versionsApi}/${version.id}/amounts`, { params: { year }, signal })
      .then((r) => r.data?.totals ?? {}).catch(() => ({} as YearTotals)),
  ]);
  return { version, computed, totals };
}
const keyOf = (companyId: string | null, departmentId: string | null) => `${companyId ?? ''}|${departmentId ?? ''}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

export default forwardRef<AllocationsTabHandle, Props>(function AllocationsTab({ id, year, currency, availableYears, onYearChange, config }, ref) {
  const { t } = useTranslation(['ops', 'common']);
  const { defaultColumn } = useBudgetColumns();

  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState<Version | null>(null);
  const [method, setMethod] = React.useState<Method>('default');
  const [driver, setDriver] = React.useState<Driver>('headcount');
  const [rows, setRows] = React.useState<Row[]>([]);
  const [computedPct, setComputedPct] = React.useState<Map<string, number>>(new Map());
  // The version's yearly totals; the reference amount is the default column's.
  const [yearTotals, setYearTotals] = React.useState<Partial<Record<AmountMeasure, number | string>>>({});
  const budgetTotal = num(yearTotals[defaultColumn.measure]);
  // Companies (headcount, IT users, turnover of the year) and departments: the full lists, read once per
  // year for every line. A tenant has a bounded set of them, and every driver needs all their metrics.
  const companiesQuery = useQuery({
    queryKey: allocationCompaniesKey(year),
    queryFn: async ({ signal }) => (await api.get<{ items: Company[] }>(`/companies`, { params: { year, page: 1, limit: 1000, sort: 'name:ASC' }, signal })).data?.items || [],
    staleTime: ORGANISATION_STALE_MS,
  });
  const departmentsQuery = useQuery({
    queryKey: allocationDepartmentsKey(year),
    queryFn: async ({ signal }) => (await api.get<{ items: Department[] }>(`/departments`, { params: { year, page: 1, limit: 1000, sort: 'name:ASC' }, signal })
      .catch(() => ({ data: { items: [] as Department[] } }))).data?.items || [],
    staleTime: ORGANISATION_STALE_MS,
  });
  const companies = React.useMemo(() => companiesQuery.data ?? [], [companiesQuery.data]);
  const departments = React.useMemo(() => departmentsQuery.data ?? [], [departmentsQuery.data]);
  // The line's allocation of the year: shown at once when the tab comes back, refreshed in the background.
  const snapshotKey = React.useMemo(() => allocationsSnapshotKey(config.itemsApi, id, year), [config.itemsApi, id, year]);
  const snapshotQuery = useQuery({
    queryKey: snapshotKey,
    queryFn: ({ signal }) => fetchAllocationsSnapshot(config, id, year, signal),
  });
  const loading = !snapshotQuery.data || !companiesQuery.data;
  const [autoOpenIdx, setAutoOpenIdx] = React.useState<number | null>(null);

  const isManualPct = method === 'manual_pct';
  const isManualCompany = method === 'manual_company';
  const isManualDept = method === 'manual_department';
  const isAuto = !isManualPct && !isManualCompany && !isManualDept;

  const autosave = useAutosave({ onError: (e) => setError(getApiErrorMessage(e, t, t(`${config.i18nPrefix}.allocations.failedToSave`))) });

  // Effective default method for this fiscal year (tenant override, else the standard
  // method). Used to label the "default" option; falls back to the static label if the
  // permission or the request is unavailable.
  const { data: allocationRule } = useQuery({
    queryKey: ['allocation-rule', year],
    queryFn: () => fetchAllocationRule(year),
    staleTime: 60_000,
    retry: false,
  });

  // Latest-value refs for the debounced persist.
  const methodRef = React.useRef(method); methodRef.current = method;
  const driverRef = React.useRef(driver); driverRef.current = driver;
  const rowsRef = React.useRef(rows); rowsRef.current = rows;
  const versionRef = React.useRef(version); versionRef.current = version;

  const companyName = React.useCallback((cid: string | null) => companies.find((c) => c.id === cid)?.name ?? '—', [companies]);
  const companyOptions = React.useMemo<PickerOption[]>(() => companies.map((c) => ({ id: c.id, label: c.name })), [companies]);
  const deptOptionsFor = React.useCallback((companyId: string | null): PickerOption[] =>
    departments.filter((d) => !companyId || d.company_id === companyId).map((d) => ({ id: d.id, label: d.name })), [departments]);
  const driverValue = React.useCallback((cid: string | null): number | null => {
    const c = companies.find((x) => x.id === cid);
    if (!c) return null;
    const d = methodRef.current === 'it_users' || driverRef.current === 'it_users' ? c.it_users_year
      : methodRef.current === 'turnover' || driverRef.current === 'turnover' ? c.turnover_year
      : c.headcount_year;
    return d == null ? null : num(d);
  }, [companies]);

  const ensureVersion = React.useCallback(async (): Promise<Version> => {
    if (versionRef.current) return versionRef.current;
    const res = await api.get<Version[]>(`${config.itemsApi}/${id}/versions`);
    const existing = (res.data || []).find((v) => Number(v.budget_year) === year);
    if (existing) { setVersion(existing); return existing; }
    const created = await api.post<Version>(`${config.itemsApi}/${id}/versions`, {
      version_name: `Y${year}`, budget_year: year, as_of_date: `${year}-01-01`, input_grain: 'annual', notes: null,
    });
    setVersion(created.data);
    return created.data;
  }, [id, year]);

  // The stored distribution after a write; the cache follows, so the tab shows it when it comes back.
  // The snapshot this tab wrote into the cache itself: the tab already shows it (rows keep their pins).
  const writtenSnapshotRef = React.useRef<AllocationsSnapshot | null>(null);
  const loadComputed = React.useCallback(async (saved: Version) => {
    const res = await api.get<{ items: ComputedItem[] }>(`${config.versionsApi}/${saved.id}/allocations`);
    const items = res.data?.items || [];
    const map = new Map<string, number>();
    items.forEach((it) => map.set(keyOf(it.company_id, it.department_id), num(it.allocation_pct)));
    setComputedPct(map);
    const previous = queryClient.getQueryData<AllocationsSnapshot>(snapshotKey);
    const next: AllocationsSnapshot = { version: saved, computed: items, totals: previous?.totals ?? {} };
    writtenSnapshotRef.current = next;
    queryClient.setQueryData<AllocationsSnapshot>(snapshotKey, next);
    return items;
  }, [queryClient, snapshotKey]);

  // The loaded allocation becomes the tab's state, unless an edit is waiting to be saved (it is newer).
  const busyRef = React.useRef(autosave.isBusy);
  busyRef.current = autosave.isBusy;
  const snapshot = snapshotQuery.data;
  // Before paint: a cached allocation shows on the first frame, never an empty table first.
  React.useLayoutEffect(() => {
    if (!snapshot || snapshot === writtenSnapshotRef.current || busyRef.current()) return;
    const v = snapshot.version;
    setVersion(v);
    setYearTotals(snapshot.totals);
    const map = new Map<string, number>();
    snapshot.computed.forEach((it) => map.set(keyOf(it.company_id, it.department_id), num(it.allocation_pct)));
    setComputedPct(map);
    if (!v) {
      setMethod('default'); setDriver('headcount'); setRows([]);
      return;
    }
    const rawMethod = String(v.allocation_method ?? 'default');
    const m: Method = (METHODS as string[]).includes(rawMethod) ? (rawMethod as Method) : 'default';
    setMethod(m);
    setDriver((v.allocation_driver ?? 'headcount') as Driver);
    // Seed editable rows from stored distribution for manual methods.
    if (m === 'manual_pct' || m === 'manual_company' || m === 'manual_department') {
      setRows(snapshot.computed.map((it) => ({ company_id: it.company_id, department_id: it.department_id, allocation_pct: num(it.allocation_pct) })));
    } else {
      setRows([]);
    }
  }, [snapshot]);
  React.useEffect(() => {
    if (snapshotQuery.error) setError(getApiErrorMessage(snapshotQuery.error, t, t(`${config.i18nPrefix}.allocations.failedToLoad`)));
  }, [snapshotQuery.error, t, config.i18nPrefix]);

  const persist = React.useCallback(async () => {
    const v = await ensureVersion();
    const m = methodRef.current;
    const d: Driver = m === 'it_users' ? 'it_users' : m === 'turnover' ? 'turnover' : m === 'manual_company' ? driverRef.current : 'headcount';
    let saved: Version = v;
    if (v.allocation_method !== m || v.allocation_driver !== d) {
      await api.patch(`${config.itemsApi}/${id}/versions`, { id: v.id, allocation_method: m, allocation_driver: d });
      saved = { ...v, allocation_method: m, allocation_driver: d };
      setVersion((prev) => (prev ? { ...prev, allocation_method: m, allocation_driver: d } : prev));
    }
    let payload: Array<{ company_id: string; department_id: string | null; allocation_pct?: number }> = [];
    if (m === 'manual_pct') {
      payload = rowsRef.current.filter((r) => r.company_id).map((r) => ({ company_id: r.company_id!, department_id: null, allocation_pct: round2(num(r.allocation_pct)) }));
    } else if (m === 'manual_company') {
      payload = rowsRef.current.filter((r) => r.company_id).map((r) => ({ company_id: r.company_id!, department_id: null }));
    } else if (m === 'manual_department') {
      payload = rowsRef.current.filter((r) => r.company_id && r.department_id).map((r) => ({ company_id: r.company_id!, department_id: r.department_id }));
    }
    const isManual = m === 'manual_pct' || m === 'manual_company' || m === 'manual_department';
    // Manual methods require ≥1 valid row; while the user is still picking, the
    // method is saved (PATCH above) but the empty upsert is skipped to avoid an error.
    if (isManual && payload.length === 0) {
      await loadComputed(saved);
      return;
    }
    await api.post(`${config.versionsApi}/${v.id}/allocations/bulk-upsert`, payload);
    await loadComputed(saved);
  }, [ensureVersion, id, loadComputed]);

  const scheduleSave = React.useCallback(() => { autosave.schedule(persist); }, [autosave, persist]);

  useImperativeHandle(ref, () => ({ flush: () => autosave.flush(), isDirty: () => autosave.isBusy() }), [autosave]);

  const handleYearChange = React.useCallback(async (y: number) => { await autosave.flush(); onYearChange(y); }, [autosave, onYearChange]);

  const onMethodChange = (next: Method) => {
    setMethod(next);
    if (next === 'it_users') setDriver('it_users');
    else if (next === 'turnover') setDriver('turnover');
    else if (next !== 'manual_company') setDriver('headcount');
    // Seed one empty row for manual methods so the user can start picking.
    if (next === 'manual_pct' || next === 'manual_company' || next === 'manual_department') {
      setRows((prev) => (prev.length ? prev : [{ company_id: null, department_id: null, allocation_pct: 0 }]));
    } else {
      setRows([]);
    }
    scheduleSave();
  };

  // ----- manual_pct pin / redistribute -----
  const redistribute = (base: Row[]): Row[] => {
    const next = base.map((r) => ({ ...r }));
    const pinnedSum = next.filter((r) => r.pinned).reduce((a, r) => a + num(r.allocation_pct), 0);
    const remaining = Math.max(0, 100 - pinnedSum);
    const unpinned = next.map((r, i) => (!r.pinned ? i : -1)).filter((i) => i >= 0);
    if (unpinned.length === 0) return next;
    const wSum = unpinned.reduce((a, i) => a + num(next[i].allocation_pct), 0);
    let acc = 0;
    unpinned.forEach((i, k) => {
      let p = wSum > 0 ? remaining * (num(next[i].allocation_pct) / wSum) : remaining / unpinned.length;
      p = round2(p);
      if (k === unpinned.length - 1) p = round2(remaining - acc); else acc += p;
      next[i] = { ...next[i], allocation_pct: Math.max(0, p) };
    });
    return next;
  };

  const onPctEdit = (idx: number, value: number | '') => {
    setRows((prev) => redistribute(prev.map((r, i) => (i === idx ? { ...r, allocation_pct: num(value), pinned: true } : r))));
    scheduleSave();
  };
  const splitEqually = () => {
    setRows((prev) => {
      const n = prev.length || 1;
      const each = round2(100 / n);
      return prev.map((r, i) => ({ ...r, pinned: false, allocation_pct: i === n - 1 ? round2(100 - each * (n - 1)) : each }));
    });
    scheduleSave();
  };
  const clearPins = () => { setRows((prev) => prev.map((r) => ({ ...r, pinned: false }))); };

  const onCompanyChange = (idx: number, cid: string | null) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, company_id: cid, department_id: isManualDept ? null : r.department_id } : r)));
    scheduleSave();
  };
  const onDeptChange = (idx: number, did: string | null) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, department_id: did } : r)));
    scheduleSave();
  };
  const addRow = () => setRows((prev) => { setAutoOpenIdx(prev.length); return [...prev, { company_id: null, department_id: null, allocation_pct: 0 }]; });
  const removeRow = (idx: number) => { setRows((prev) => prev.filter((_, i) => i !== idx)); scheduleSave(); };

  // Display rows: editable rows for manual methods, computed distribution for auto.
  const displayRows: Row[] = React.useMemo(() => {
    if (isAuto) {
      return Array.from(computedPct.entries()).map(([k, pct]) => {
        const [cid, did] = k.split('|');
        return { company_id: cid || null, department_id: did || null, allocation_pct: pct };
      }).sort((a, b) => b.allocation_pct - a.allocation_pct);
    }
    return rows;
  }, [isAuto, computedPct, rows]);

  const pctFor = (r: Row) => isManualPct ? num(r.allocation_pct) : (computedPct.get(keyOf(r.company_id, r.department_id)) ?? 0);
  const totalPct = displayRows.reduce((a, r) => a + pctFor(r), 0);
  const totalValid = Math.abs(totalPct - 100) < 0.01 || (totalPct === 0 && displayRows.length === 0);

  const savingHint = autosave.status === 'saving' || autosave.status === 'pending'
    ? t('common:status.saving', 'Saving…')
    : autosave.status === 'saved' ? t('common:status.saved', 'Saved') : null;

  // "Default" follows the setting configured for the tenant (Administration > Default
  // allocation method); the explicit entries pin a method on this item regardless of
  // later changes to that setting.
  const methodOptionLabels: Record<'headcount' | 'it_users' | 'turnover', string> = {
    headcount: t(`${config.i18nPrefix}.allocations.headcount`),
    it_users: t(`${config.i18nPrefix}.allocations.itUsers`),
    turnover: t(`${config.i18nPrefix}.allocations.turnover`),
  };
  const defaultMethodOptionLabel = allocationRule?.mode === 'manual_company'
    ? t(`${config.i18nPrefix}.allocations.defaultManual`, {
        count: allocationRule.company_ids?.length ?? 0,
        defaultValue: t(`${config.i18nPrefix}.allocations.headcountDefault`),
      })
    : t(`${config.i18nPrefix}.allocations.defaultWithMethod`, {
        method: methodOptionLabels[allocationRule?.method ?? 'headcount'],
        defaultValue: t(`${config.i18nPrefix}.allocations.headcountDefault`),
      });

  const methodOptions: Array<{ value: Method; label: string }> = [
    { value: 'default', label: defaultMethodOptionLabel },
    { value: 'headcount', label: methodOptionLabels.headcount },
    { value: 'it_users', label: methodOptionLabels.it_users },
    { value: 'turnover', label: methodOptionLabels.turnover },
    { value: 'manual_company', label: t(`${config.i18nPrefix}.allocations.manualByCompany`) },
    { value: 'manual_department', label: t(`${config.i18nPrefix}.allocations.manualByDepartment`) },
    { value: 'manual_pct', label: t(`${config.i18nPrefix}.allocations.manualByPct`) },
  ];

  const numHeadSx = { textAlign: 'right', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1.5, py: 0.75, whiteSpace: 'nowrap' } as const;
  const numCellSx = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'kanap.text.primary', px: 1.5, py: 0.5, whiteSpace: 'nowrap' } as const;

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      {!!error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* Saving hint is absolutely positioned so it never reflows the year selector / table. */}
      <Box sx={{ position: 'relative' }}>
        <YearTabs currentYear={year} availableYears={availableYears} onYearChange={(y) => void handleYearChange(y)} disabled={loading} />
        {savingHint && (
          <Typography sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'kanap.text.tertiary', pointerEvents: 'none' }}>
            {savingHint}
          </Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}>
        <PropertyRow label={t(`${config.i18nPrefix}.allocations.method`)} sx={{ minWidth: 200 }}>
          <TextField select fullWidth variant="standard" value={method} onChange={(e) => onMethodChange(e.target.value as Method)} sx={drawerSelectSx}>
            {methodOptions.map((o) => <MenuItem key={o.value} value={o.value} sx={drawerMenuItemSx}>{o.label}</MenuItem>)}
          </TextField>
        </PropertyRow>
        {isManualCompany && (
          <PropertyRow label={t(`${config.i18nPrefix}.allocations.allocateBy`)} sx={{ minWidth: 140 }}>
            <TextField select fullWidth variant="standard" value={driver} onChange={(e) => { setDriver(e.target.value as Driver); scheduleSave(); }} sx={drawerSelectSx}>
              <MenuItem value="headcount" sx={drawerMenuItemSx}>{t(`${config.i18nPrefix}.allocations.headcount`)}</MenuItem>
              <MenuItem value="it_users" sx={drawerMenuItemSx}>{t(`${config.i18nPrefix}.allocations.itUsers`)}</MenuItem>
              <MenuItem value="turnover" sx={drawerMenuItemSx}>{t(`${config.i18nPrefix}.allocations.turnover`)}</MenuItem>
            </TextField>
          </PropertyRow>
        )}
        <Box sx={{ ml: 'auto', textAlign: 'right' }}>
          <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>{t(`${config.i18nPrefix}.allocations.yearTotal`, { column: defaultColumn.label })}{currency ? ` · ${currency.toUpperCase()}` : ''}</Typography>
          <Typography sx={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{formatAmount(budgetTotal)}</Typography>
        </Box>
      </Box>

      {isAuto && (
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t(`${config.i18nPrefix}.allocations.autoDistributeInfo`)}</Typography>
      )}
      {isManualPct && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="action" onClick={splitEqually}>{t(`${config.i18nPrefix}.allocations.splitEqually`)}</Button>
          <Button size="small" variant="action" onClick={clearPins}>{t(`${config.i18nPrefix}.allocations.clearPins`)}</Button>
        </Box>
      )}

      <Box component="table" sx={{ width: 'auto', minWidth: 420, borderCollapse: 'collapse', '& td, & th': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' } }}>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" sx={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1, py: 0.75, minWidth: 220 }}>{isManualDept ? t(`${config.i18nPrefix}.allocations.companyDept`) : t(`${config.i18nPrefix}.allocations.company`)}</Box>
            {!isManualPct && <Box component="th" sx={numHeadSx}>{t(`${config.i18nPrefix}.allocations.driverValue`)}</Box>}
            <Box component="th" sx={numHeadSx}>%</Box>
            <Box component="th" sx={numHeadSx}>{t(`${config.i18nPrefix}.allocations.amount`)}</Box>
            {!isAuto && <Box component="th" sx={{ width: 40 }} />}
          </Box>
        </Box>
        <Box component="tbody">
          {displayRows.map((r, idx) => {
            const pct = pctFor(r);
            return (
              <Box component="tr" key={isAuto ? keyOf(r.company_id, r.department_id) : idx} sx={{ '&:hover': { bgcolor: 'kanap.bg.hover' }, '&:hover .alloc-row-delete': { opacity: 1 } }}>
                <Box component="td" sx={{ px: 1, py: 0.5, fontSize: 13 }}>
                  {isAuto ? (
                    companyName(r.company_id)
                  ) : (
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', minWidth: 0 }}>
                      <InlinePicker
                        value={r.company_id}
                        options={companyOptions}
                        placeholder={t(`${config.i18nPrefix}.allocations.selectCompany`)}
                        emptyLabel={t(`${config.i18nPrefix}.allocations.noCompanies`)}
                        error={!r.company_id}
                        autoOpen={autoOpenIdx === idx}
                        onSelect={(cid) => onCompanyChange(idx, cid)}
                        onAutoOpened={() => setAutoOpenIdx(null)}
                      />
                      {isManualDept && (
                        <InlinePicker
                          value={r.department_id}
                          options={deptOptionsFor(r.company_id)}
                          placeholder={t(`${config.i18nPrefix}.allocations.selectDepartment`)}
                          emptyLabel={t(`${config.i18nPrefix}.allocations.noDepartments`)}
                          disabled={!r.company_id}
                          error={!r.department_id}
                          onSelect={(did) => onDeptChange(idx, did)}
                        />
                      )}
                    </Box>
                  )}
                </Box>
                {!isManualPct && <Box component="td" sx={numCellSx}>{driverValue(r.company_id) ?? '—'}</Box>}
                <Box component="td" sx={{ ...numCellSx, width: isManualPct ? 124 : undefined }}>
                  {isManualPct ? (
                    <TextField
                      type="number" size="small" variant="standard" value={r.allocation_pct}
                      onChange={(e) => onPctEdit(idx, e.target.value === '' ? '' : Number(e.target.value))}
                      inputProps={{ step: 0.01 }}
                      InputProps={{
                        endAdornment: <Box component="span" sx={{ fontSize: 13, color: 'kanap.text.tertiary', pl: 0.25 }}>%</Box>,
                      }}
                      sx={[tableCellFieldSx, { width: '100%' }]}
                    />
                  ) : `${round2(pct)}%`}
                </Box>
                <Box component="td" sx={numCellSx}>{formatAmount((pct / 100) * budgetTotal)}</Box>
                {!isAuto && (
                  <Box component="td" sx={{ textAlign: 'center' }}>
                    <IconButton
                      className="alloc-row-delete"
                      size="small"
                      aria-label={t('common:buttons.remove', 'Remove')}
                      onClick={() => removeRow(idx)}
                      disabled={displayRows.length <= 1}
                      sx={{ opacity: 0, transition: 'opacity 120ms', color: 'kanap.text.tertiary', '&:hover': { color: 'kanap.danger' } }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
        <Box component="tfoot">
          <Box component="tr">
            <Box component="td" sx={{ fontSize: 12, fontWeight: 500, px: 1, py: 0.75 }}>{t(`${config.i18nPrefix}.allocations.total`)}</Box>
            {!isManualPct && <Box component="td" />}
            <Box component="td" sx={{ ...numCellSx, fontWeight: 500, color: totalValid ? 'kanap.text.primary' : 'warning.main' }}>{round2(totalPct)}%</Box>
            <Box component="td" sx={{ ...numCellSx, fontWeight: 500 }}>{formatAmount((totalPct / 100) * budgetTotal)}</Box>
            {!isAuto && <Box component="td" />}
          </Box>
        </Box>
      </Box>

      {!isAuto && (
        <Box>
          <Button size="small" startIcon={<AddIcon />} onClick={addRow}>{t(`${config.i18nPrefix}.allocations.addRow`)}</Button>
        </Box>
      )}
      {isManualPct && !totalValid && (
        <Typography sx={{ fontSize: 12, color: 'warning.main' }}>{t(`${config.i18nPrefix}.allocations.mustSum100`)}</Typography>
      )}
    </Stack>
  );
});
