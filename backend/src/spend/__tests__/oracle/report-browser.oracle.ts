/**
 * The budget reports, the dashboard tiles and the budget operations pages as
 * the browser computed them before lot 2D (frontend @ 75624e36): every line of
 * the type downloaded through `/summary` (pages of 500, `created_at:DESC`,
 * the report's `years`), then filtered, grouped and summed in JavaScript.
 * Each function below is the component's computation, moved here verbatim
 * (React state and memo hooks removed, the same expressions kept), so the
 * parity spec can run it against the rows the former endpoint returns.
 *
 * Sources: `components/reports/BudgetReportFilters.tsx` (`filterBudgetRows`,
 * the pickers' options), `pages/reports/TopOpexReport.tsx`,
 * `OpexDeltaReport.tsx`, `ConsolidationReport.tsx`,
 * `AnalyticsCategoryReport.tsx`, `ComparisonReport.tsx`,
 * `CapexBudgetTrendReport.tsx`, `BudgetColumnsCompareReport.tsx`,
 * `pages/DashboardPage.tsx`, `pages/operations/BudgetColumnResetPage.tsx`,
 * `CopyBudgetColumnsPage.tsx`, `pages/reports/useOpexSummary.ts`
 * (`pickYearSlot`).
 */

type Row = Record<string, any>;
type Scope = 'opex' | 'capex';

// ----- shared helpers of the former pages -----

/** `pickYearSlot` (useOpexSummary.ts). */
export function pickYearSlot(row: Row, year: number, currentYear = new Date().getFullYear()) {
  const y = currentYear;
  const dynamicKey = `y${year}`;
  if (row.versions?.[dynamicKey]) return row.versions[dynamicKey];
  if (year === y - 2) return row.versions?.yMinus2;
  if (year === y - 1) return row.versions?.yMinus1;
  if (year === y) return row.versions?.y;
  if (year === y + 1) return row.versions?.yPlus1;
  if (year === y + 2) return row.versions?.yPlus2;
  return undefined;
}

/** `itemName` (useBudgetSummaryAll.ts). */
export function itemName(scope: Scope, row: Row): string {
  return (scope === 'capex' ? row.description : row.product_name) ?? '';
}

function reportValue(row: Row, year: number, metric: string): number {
  const slot = pickYearSlot(row, year);
  const totals = (slot?.reporting ?? slot?.totals) as Record<string, number | undefined> | undefined;
  return Number(totals?.[metric] ?? 0);
}

// ----- the filter bar -----

export type BudgetRowCriteria = {
  costCenterIds: Set<string> | null;
  runBuild: 'run' | 'build' | 'none' | null;
  analytics?: ReadonlyMap<string, string> | null;
};

/** `filterBudgetRows` (BudgetReportFilters.tsx). */
export function filterBudgetRows<T extends Row>(rows: T[], criteria: BudgetRowCriteria): T[] {
  const { costCenterIds, runBuild } = criteria;
  const analytics = criteria.analytics && criteria.analytics.size > 0 ? Array.from(criteria.analytics) : null;
  if (!costCenterIds && !runBuild && !analytics) return rows;
  return rows.filter((row) => {
    if (costCenterIds && !(row.cost_center_id && costCenterIds.has(row.cost_center_id))) return false;
    if (runBuild) {
      const value = row.run_build || null;
      if (runBuild === 'none' ? value !== null : value !== runBuild) return false;
    }
    if (analytics) {
      for (const [axisId, pick] of analytics) {
        const value = row.analytics_value_ids?.[axisId] || null;
        if (pick === 'none' ? value !== null : value !== pick) return false;
      }
    }
    return true;
  });
}

/** The bar's options (BudgetReportFilters): run or build shown, and per enabled dimension the values the lines hold. */
export function filterBarOptions(rows: Row[], axisIds: string[], unnamed: string) {
  const showRunBuild = rows.some((row) => Boolean(row.run_build));
  const analytics = new Map<string, Array<{ id: string; label: string }>>();
  for (const axisId of axisIds) {
    const names = new Map<string, string>();
    const nameKey = `analytics_${axisId}`;
    for (const row of rows) {
      const id = row.analytics_value_ids?.[axisId];
      if (!id || names.has(id)) continue;
      const name = row[nameKey];
      names.set(id, (typeof name === 'string' ? name.trim() : '') || unnamed);
    }
    const options = Array.from(names, ([id, label]) => ({ id, label }));
    options.sort((a, b) => a.label.localeCompare(b.label));
    analytics.set(axisId, options);
  }
  return { showRunBuild, analytics };
}

// ----- top items -----

export function topItems(
  scope: Scope,
  rows: Row[],
  p: { year: number; metric: string; topCount: number; excludedIds: string[]; excludedAccounts: string[] },
) {
  const { year, metric, topCount, excludedIds, excludedAccounts } = p;
  const all = rows.map((r) => ({ id: r.id, name: itemName(scope, r), value: reportValue(r, year, metric), account_display: r.account_display ?? null }));
  const filtered = all.filter((item) => {
    if (excludedIds.includes(item.id)) return false;
    if (item.account_display && excludedAccounts.includes(item.account_display)) return false;
    return true;
  });
  const totalMetric = filtered.reduce((acc: number, it) => acc + (Number(it.value) || 0), 0);
  const sorted = [...filtered].sort((a, b) => (b.value - a.value));
  const limit = Number.isFinite(topCount) && topCount > 0 ? Math.floor(topCount) : 1;
  const topEntries = sorted.slice(0, limit);
  const topSelectionTotal = topEntries.reduce((acc: number, it) => acc + (Number(it.value) || 0), 0);
  const processed = topEntries.map((r) => ({
    id: r.id,
    name: r.name,
    value: r.value,
    pct_of_total: totalMetric > 0 ? Math.round((r.value / totalMetric) * 100) : 0,
  }));
  return { processed, totalMetric, topSelectionTotal };
}

/** The item and account exclusion options of the top and variance reports (every line, sorted by name). */
export function itemAndAccountOptions(scope: Scope, allRows: Row[]) {
  const itemOptions = allRows.map((r) => ({ id: r.id, name: itemName(scope, r) })).sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  const accountOptions: Array<{ id: string; name: string }> = [];
  for (const row of allRows) {
    const name = row.account_display?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    accountOptions.push({ id: name, name });
  }
  accountOptions.sort((a, b) => a.name.localeCompare(b.name));
  return { itemOptions, accountOptions };
}

// ----- increases and decreases -----

function inferYearFromVersionKey(key: string, currentYear: number): number | undefined {
  if (key === 'yMinus1') return currentYear - 1;
  if (key === 'y') return currentYear;
  if (key === 'yPlus1') return currentYear + 1;
  const match = /^y(\d{4})$/i.exec(key);
  if (match) return Number(match[1]);
  return undefined;
}

export function deltaYearOptions(allRows: Row[], currentYear: number): number[] {
  const years = new Set<number>();
  for (const row of allRows) {
    for (const [key, version] of Object.entries(row.versions ?? {}) as Array<[string, any]>) {
      if (!version || !(version.reporting ?? version.totals)) continue;
      const year = typeof version.year === 'number' ? version.year : inferYearFromVersionKey(key, currentYear);
      if (year) years.add(year);
    }
  }
  return Array.from(years).sort((a, b) => a - b);
}

export function delta(
  scope: Scope,
  rows: Row[],
  p: {
    sourceYear: number; sourceMetric: string; destinationYear: number; destinationMetric: string;
    modes: Array<'increase' | 'decrease'>; topCount: number; excludedIds: string[]; excludedAccounts: string[];
  },
) {
  const { sourceYear, sourceMetric, destinationYear, destinationMetric, modes, topCount, excludedIds, excludedAccounts } = p;
  const items = rows.map((r) => {
    const curr = reportValue(r, destinationYear, destinationMetric);
    const prev = reportValue(r, sourceYear, sourceMetric);
    const d = curr - prev;
    const pct = prev > 0 ? (d / prev) * 100 : null;
    return { id: r.id, name: itemName(scope, r), current: curr, previous: prev, delta: d, pct_increase: pct, account_display: r.account_display ?? null };
  });
  const filtered = items.filter((item) => {
    if (excludedIds.includes(item.id)) return false;
    if (item.account_display && excludedAccounts.includes(item.account_display)) return false;
    return true;
  });
  const limit = Number.isFinite(topCount) && topCount > 0 ? Math.floor(topCount) : 1;
  const increases = modes.includes('increase')
    ? filtered.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, limit).map((row) => ({ ...row, direction: 'increase' as const }))
    : [];
  const decreases = modes.includes('decrease')
    ? filtered.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, limit).map((row) => ({ ...row, direction: 'decrease' as const }))
    : [];
  const processed = [...increases, ...decreases].map(({ account_display: _a, ...row }) => row);

  let grossIncrease = 0;
  let grossDecrease = 0;
  let net = 0;
  for (const r of rows) {
    if (excludedIds.includes(r.id)) continue;
    const accountName = r.account_display?.trim();
    if (accountName && excludedAccounts.includes(accountName)) continue;
    const curr = reportValue(r, destinationYear, destinationMetric);
    const prev = reportValue(r, sourceYear, sourceMetric);
    const d = curr - prev;
    net += d;
    if (d > 0) grossIncrease += d; else grossDecrease += -d;
  }
  return { processed, allTotals: { grossIncrease, grossDecrease, net } };
}

// ----- consolidation -----

export type ConsolidationAccount = {
  id: string;
  account_number: number;
  account_name: string;
  consolidation_account_number?: number | null;
  consolidation_account_name?: string | null;
};

export function consolidation(rows: Row[], accounts: ConsolidationAccount[], p: { years: number[]; metric: string; excludedAccounts: string[]; unassigned: string }) {
  const { years, metric, excludedAccounts } = p;
  const accountById = new Map<string, ConsolidationAccount>(accounts.map((account) => [account.id, account] as const));
  type Group = { key: string; label: string; values: Record<number, number> };
  const acc: Map<string, Group> = new Map();
  const makeKey = (a?: ConsolidationAccount | null): { key: string; label: string } => {
    const num = a?.consolidation_account_number ?? null;
    const name = (a?.consolidation_account_name ?? '').trim() || null;
    if (num == null && !name) return { key: 'unassigned', label: p.unassigned };
    const label = name && num != null ? `[${num}] ${name}` : (name ?? `[${num}]`);
    const key = `c_${num != null ? num : name!.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
    return { key, label };
  };
  for (const r of rows) {
    const accId = r.account?.id ?? undefined;
    if (accId && excludedAccounts.includes(accId)) continue;
    const a = accId ? accountById.get(accId) : undefined;
    const id = makeKey(a);
    let g = acc.get(id.key);
    if (!g) { g = { key: id.key, label: id.label, values: {} }; acc.set(id.key, g); }
    for (const yr of years) g.values[yr] = (g.values[yr] || 0) + reportValue(r, yr, metric);
  }
  const groups = Array.from(acc.values()).sort((a, b) => {
    const pYear = years[0];
    return (b.values[pYear] || 0) - (a.values[pYear] || 0);
  });
  const totals: Record<number, number> = {};
  for (const yr of years) totals[yr] = groups.reduce((sum, g) => sum + (Number(g.values[yr]) || 0), 0);
  return { groups, totals };
}

/** The Consolidation exclusion options: the accounts of `/accounts?limit=1000`, `[number] name`. */
export function consolidationAccountOptions(accounts: ConsolidationAccount[], unnamed: string) {
  const items: Array<{ id: string; label: string }> = [];
  for (const account of accounts) {
    const labelParts: string[] = [];
    if (account.account_number != null) labelParts.push(`[${account.account_number}]`);
    if (account.account_name) labelParts.push(account.account_name.trim());
    items.push({ id: account.id, label: labelParts.join(' ').trim() || unnamed });
  }
  items.sort((a, b) => a.label.localeCompare(b.label));
  return items;
}

// ----- analytics -----

function valueOf(row: Row, axisId: string | null): { id: string | null; name: string | null } {
  if (!axisId) return { id: row.analytics_category_id ?? null, name: row.analytics_category_name ?? null };
  const name = row[`analytics_${axisId}`];
  return { id: row.analytics_value_ids?.[axisId] ?? null, name: typeof name === 'string' ? name : null };
}

export function analytics(
  rows: Row[],
  catalogue: Array<{ id: string; name: string }>,
  p: { axisId: string | null; years: number[]; metric: string; excludedCategories: string[]; unassigned: string; unnamed: string },
) {
  const { axisId, years, metric, excludedCategories } = p;
  const categoryById = new Map(catalogue.map((cat) => [cat.id, cat] as const));
  type Group = { key: string; label: string; values: Record<number, number> };
  const acc: Map<string, Group> = new Map();
  const makeKey = (id: string | null | undefined, fallbackName: string | null | undefined): { key: string; label: string } => {
    if (!id) return { key: 'uncategorized', label: p.unassigned };
    const labelFromCatalog = categoryById.get(id)?.name;
    const label = (labelFromCatalog ?? fallbackName ?? '').trim() || p.unnamed;
    return { key: `cat_${id}`, label };
  };
  for (const row of rows) {
    const value = valueOf(row, axisId);
    const id = value.id;
    if (id && excludedCategories.includes(id)) continue;
    const keyInfo = makeKey(id, value.name);
    let group = acc.get(keyInfo.key);
    if (!group) { group = { key: keyInfo.key, label: keyInfo.label, values: {} }; acc.set(keyInfo.key, group); }
    for (const yr of years) group.values[yr] = (group.values[yr] || 0) + reportValue(row, yr, metric);
  }
  const groups = Array.from(acc.values()).sort((a, b) => {
    const pYear = years[0];
    return (b.values[pYear] || 0) - (a.values[pYear] || 0);
  });
  const totals: Record<number, number> = {};
  for (const yr of years) totals[yr] = groups.reduce((sum, group) => sum + (Number(group.values[yr]) || 0), 0);
  return { groups, totals };
}

/** The Analytics exclusion options: the dimension's values (catalogue) and the ones the lines hold, by label. */
export function analyticsOptions(allRows: Row[], catalogue: Array<{ id: string; name: string | null }>, axisId: string | null, unnamed: string) {
  const map = new Map<string, { id: string; label: string }>();
  for (const cat of catalogue) map.set(cat.id, { id: cat.id, label: (cat.name ?? '').trim() || unnamed });
  for (const row of allRows) {
    const value = valueOf(row, axisId);
    if (!value.id || map.has(value.id)) continue;
    map.set(value.id, { id: value.id, label: (value.name ?? '').trim() || unnamed });
  }
  const list = Array.from(map.values());
  list.sort((a, b) => a.label.localeCompare(b.label));
  return list;
}

// ----- sums per year and column -----

/** `totalsByMetricAndYear` of the OPEX and CAPEX trend reports. */
export function trend(rows: Row[], p: { years: number[]; metrics: string[] }) {
  const acc: Record<string, Record<number, number>> = {};
  for (const m of p.metrics) acc[m] = {};
  for (const yr of p.years) {
    for (const m of p.metrics) {
      let sum = 0;
      for (const r of rows) sum += reportValue(r, yr, m);
      acc[m][yr] = sum;
    }
  }
  return acc;
}

/** The comparison report's total per selection (sorted selections) and its year pivot. */
export function columnsCompare(rows: Row[], sortedSelections: Array<{ year: number; metric: string }>) {
  const totals = sortedSelections.map((sel) => {
    let total = 0;
    for (const r of rows) total += reportValue(r, sel.year, sel.metric);
    return total;
  });
  const pivot = new Map<string, number>();
  for (const sel of sortedSelections) {
    let total = 0;
    for (const r of rows) total += reportValue(r, sel.year, sel.metric);
    const key = `${sel.year}:${sel.metric}`;
    pivot.set(key, (pivot.get(key) || 0) + total);
  }
  return { totals, pivot };
}

// ----- dashboard -----

function getColumnValueFromRow(row: Row, year: 'y' | 'yMinus1' | 'yPlus1', column: string) {
  const slot = (row?.versions?.[year]) || {};
  const reporting = slot?.reporting || {};
  const totals = slot?.totals || {};
  const v = Number(reporting[column] ?? totals[column] ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export function topIncreases(scope: Scope, rows: Row[], column: string, limit = 5) {
  return rows
    .map((row) => {
      const y = getColumnValueFromRow(row, 'y', column);
      const yMinus1 = getColumnValueFromRow(row, 'yMinus1', column);
      return { id: row.id, name: itemName(scope, row) || '—', y, yMinus1, delta: y - yMinus1 };
    })
    .filter((row) => row.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, limit);
}

/** The dashboard's data hygiene checks (`/summary?limit=1&filters=…`, reading `total`). */
export const HYGIENE_CHECKS = [
  { key: 'noItOwner', filter: { owner_it_id: { filterType: 'text', type: 'blank' } } },
  { key: 'noBusinessOwner', filter: { owner_business_id: { filterType: 'text', type: 'blank' } } },
  { key: 'noPayingCompany', filter: { paying_company_id: { filterType: 'text', type: 'blank' } } },
  { key: 'accountOutsideChart', filter: { account_warning: { filterType: 'text', type: 'notBlank' } } },
] as const;

// ----- budget operations pages -----

/** BudgetColumnResetPage: every line with the column's amount in its own currency. */
export function resetLines(rows: Row[], year: number, column: string | null) {
  return rows.map((r) => {
    const slot = pickYearSlot(r, year);
    const currentValue = column ? Number(slot?.totals?.[column] || 0) : 0;
    return { id: r.id, product_name: r.product_name ?? r.description, currentValue };
  });
}

/** CopyBudgetColumnsPage: every line with both amounts in its own currency. */
export function copyLines(rows: Row[], p: { sourceYear: number; sourceColumn: string; destinationYear: number; destinationColumn: string }) {
  return rows.map((r) => {
    const sourceSlot = pickYearSlot(r, p.sourceYear);
    const destinationSlot = pickYearSlot(r, p.destinationYear);
    return {
      id: r.id,
      product_name: r.product_name ?? r.description,
      sourceValue: Number(sourceSlot?.totals?.[p.sourceColumn] || 0),
      destinationValue: Number(destinationSlot?.totals?.[p.destinationColumn] || 0),
    };
  });
}

/** `formatNumber` of the reports: rounded, thousands separated by a space. */
export function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
