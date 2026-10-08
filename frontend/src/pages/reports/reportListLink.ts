import type { BudgetReportFilterState } from '../../components/reports/BudgetReportFilters';
import { compactListSearchCached, filtersNeedContext, saveListContext } from '../../lib/listContext';
import { analyticsFieldKey } from '../../services/analytics';
import { costCenterLabel } from '../../services/costCenters';
import { keepValues, NO_ANALYTICS_VALUE, type BudgetScope, type ColumnFilters, type RunBuildPick } from './reportAggregates';
import { SUMMARY_ENDPOINT } from './useReportScope';

/**
 * A report row opening the OPEX or CAPEX list in a new tab, filtered on the row's group and on the
 * report's filter bar. The list filters on its grid columns (the names its cells show), so each
 * group and pick goes to the column that holds it: a cost center to `cost_center_label`
 * (`code · name`), a supplier to `supplier_name`, a dimension value to its dimension's column, run or
 * build to `run_build`, Items with FTE to `has_fte` ("FTE declared"). A row without a value (No cost
 * center, No supplier, No value) keeps the blank value.
 */

/** The list column of a dimension: the default one keeps `analytics_category_name`, the others `analytics_<id>`. */
export function axisListColumn(axis: { id: string; is_default?: boolean | null }): string {
  return axis.is_default ? 'analytics_category_name' : analyticsFieldKey(axis.id);
}

/** A report row's group, as the list names it (null: the row of the lines without one). */
export type ReportListGroup =
  | { kind: 'costCenter'; label: string | null }
  | { kind: 'supplier'; name: string | null }
  | { kind: 'axis'; column: string; name: string | null }
  | { kind: 'account'; values: ReadonlyArray<string | null> };

/** The report's filter bar, as the list names it. */
export type ReportListPicks = {
  /**
   * The cost centers under the bar's node (`code · name`), or null without a node. Lines carry cost
   * centers only, so a group stands for the cost centers below it, as the list's group filter ticks them.
   */
  costCenterLabels: readonly string[] | null;
  runBuild: RunBuildPick | null;
  /** Per dimension picked: its list column and the value's name (null: the lines without a value). */
  analytics: ReadonlyArray<{ column: string; name: string | null }>;
  withFte: boolean;
};

export const NO_LIST_PICKS: ReportListPicks = { costCenterLabels: null, runBuild: null, analytics: [], withFte: false };

function groupFilter(group: ReportListGroup): [string, Array<string | null>] {
  switch (group.kind) {
    case 'costCenter': return ['cost_center_label', [group.label]];
    case 'supplier': return ['supplier_name', [group.name]];
    case 'axis': return [group.column, [group.name]];
    default: return ['account_display', [...group.values]];
  }
}

/**
 * The list filters of a row: the bar's picks, then the group's own filter. A row's lines passed the
 * picks, so its group is inside a pick on the same column (a cost center under the picked node, the
 * picked value of the dimension grouped on): the group's filter replaces it.
 */
export function reportListFilters(group: ReportListGroup, picks: ReportListPicks): ColumnFilters {
  const filters: ColumnFilters = {};
  if (picks.costCenterLabels) filters.cost_center_label = keepValues([...picks.costCenterLabels]);
  if (picks.runBuild) filters.run_build = keepValues([picks.runBuild === 'none' ? null : picks.runBuild]);
  for (const { column, name } of picks.analytics) filters[column] = keepValues([name]);
  if (picks.withFte) filters.has_fte = keepValues(['yes']);
  const [column, values] = groupFilter(group);
  filters[column] = keepValues(values);
  return filters;
}

/** The list a row opens: its href, and how to save its filters when they are too long for a URL. */
export type ReportListLink = {
  /** `/ops/<scope>?filters=…`, or `?ctx=…` once filters too long for a URL are saved in this tab. */
  href: string;
  /** Present while the filters are too long for a URL and not saved yet: saves them (`ctx`). */
  save?: () => Promise<string>;
};

/**
 * The list of `scope` filtered on a row's group and the bar's picks. Filters too long for a URL go as
 * `ctx` once saved in this tab; until then the link carries them inline, as the list's own links do.
 */
export function reportListLink(scope: BudgetScope, group: ReportListGroup, picks: ReportListPicks): ReportListLink {
  const filters = JSON.stringify(reportListFilters(group, picks));
  const endpoint = SUMMARY_ENDPOINT[scope];
  const search = compactListSearchCached(new URLSearchParams({ filters }).toString(), endpoint);
  const href = `/ops/${scope}?${search}`;
  const saved = !new URLSearchParams(search).has('filters');
  return filtersNeedContext(filters) && !saved ? { href, save: () => saveListContext(endpoint, filters) } : { href };
}

/** The href alone (`reportListLink`). */
export function reportListHref(scope: BudgetScope, group: ReportListGroup, picks: ReportListPicks): string {
  return reportListLink(scope, group, picks).href;
}

/**
 * The bar's picks as the list names them; null while they cannot be named (the tree or the dimension
 * values still loading, a node or dimensions that failed to load): the rows then link nowhere.
 */
export function reportListPicks(state: Pick<BudgetReportFilterState, 'costCenterId' | 'costCenterMissing' | 'tree' | 'runBuild' | 'withFte' | 'analytics' | 'analyticsAxes' | 'analyticsMissing' | 'options'>): ReportListPicks | null {
  if (state.costCenterMissing || state.analyticsMissing) return null;
  let costCenterLabels: string[] | null = null;
  if (state.costCenterId) {
    // In tree order, as the list's filter lists them.
    const under = state.tree.descendantIds(state.costCenterId);
    costCenterLabels = state.tree.nodes
      .filter((node) => under.has(node.id) && node.kind === 'cost_center')
      .map((node) => costCenterLabel(node));
  }
  const analytics: Array<{ column: string; name: string | null }> = [];
  for (const [axisId, value] of state.analytics) {
    const axis = state.analyticsAxes.enabled.find((candidate) => candidate.id === axisId);
    if (!axis) return null;
    if (value === NO_ANALYTICS_VALUE) {
      analytics.push({ column: axisListColumn(axis), name: null });
      continue;
    }
    const option = state.options.analytics.get(axisId)?.find((candidate) => candidate.id === value);
    if (!option) return null;
    analytics.push({ column: axisListColumn(axis), name: option.name });
  }
  return { costCenterLabels, runBuild: state.runBuild, analytics, withFte: state.withFte };
}

/**
 * The list group of a row grouped by cost center, supplier or dimension value (`name`: the stored name,
 * null for the row without one). Null for a value with a blank name: the list cannot tell it from none.
 */
export function rowListGroup(
  kind: 'costCenter' | 'supplier' | 'axis',
  row: { name: string | null },
  axisColumn?: string | null,
): ReportListGroup | null {
  if (row.name != null && row.name.trim() === '') return null;
  if (kind === 'costCenter') return { kind, label: row.name };
  if (kind === 'supplier') return { kind, name: row.name };
  return axisColumn ? { kind, column: axisColumn, name: row.name } : null;
}
