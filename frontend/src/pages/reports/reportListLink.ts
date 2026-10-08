import type { BudgetReportFilterState } from '../../components/reports/BudgetReportFilters';
import { compactListSearchCached, filtersNeedContext, saveListContext } from '../../lib/listContext';
import { analyticsFieldKey } from '../../services/analytics';
import { costCenterLabel } from '../../services/costCenters';
import { STATUS_SCOPE_PARAM } from '../../utils/statusScopeParams';
import { keepValues, NO_ANALYTICS_VALUE, type BudgetScope, type ColumnFilters, type FilterModel, type RunBuildPick } from './reportAggregates';
import { SUMMARY_ENDPOINT } from './useReportScope';

/**
 * A report row opening the OPEX or CAPEX list in a new tab, filtered on the row's group and on the
 * report's filter bar. The list filters on its grid columns (the names its cells show), so each
 * group and pick goes to the column that holds it: a cost center to `cost_center_label`
 * (`code · name`), a supplier to `supplier_name`, a dimension value to its dimension's column, run or
 * build to `run_build`, Items with FTE to `has_fte` ("FTE declared"), a consolidation line to the ids of
 * its accounts (`account_id`, a column only links filter: account names repeat across charts of
 * accounts). A row without a value (No cost center, No supplier, No value) keeps the blank value.
 *
 * The list then shows exactly the lines the row counts:
 * - the report's window: a report reads the lines still active on 1 January of its first year
 *   (`windowScope` on the server), so the list opens on every status (`?statusScope=all`) with End of
 *   validity "blank, or after 31 December of the year before" (the same lines, in a filter the user
 *   sees and can change);
 * - a row that counts only lines declaring FTE (staffing, cost per FTE, the FTE measure) adds "FTE
 *   declared".
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
  /** A consolidation line: the ids of its accounts (null: the lines without an account). */
  | { kind: 'account'; ids: ReadonlyArray<string | null> };

/** What a report reads besides its filter bar: its window and whether its rows count only FTE lines. */
export type ReportListScope = {
  /** The first year the report reads: its lines are those still active on 1 January of that year. */
  firstYear: number;
  /** The rows count only the lines that declare FTE (staffing, cost per FTE, the FTE measure). */
  fteOnly: boolean;
};

/** End of validity blank, or after 31 December of the year before `firstYear`: the report's window. */
export function windowFilter(firstYear: number): FilterModel {
  return {
    filterType: 'date',
    operator: 'OR',
    conditions: [
      { filterType: 'date', type: 'blank', dateFrom: null, dateTo: null },
      { filterType: 'date', type: 'greaterThan', dateFrom: `${firstYear - 1}-12-31 00:00:00`, dateTo: null },
    ],
  };
}

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
    default: return ['account_id', [...group.ids]];
  }
}

/**
 * The list filters of a row: the bar's picks, then the group's own filter. A row's lines passed the
 * picks, so its group is inside a pick on the same column (a cost center under the picked node, the
 * picked value of the dimension grouped on): the group's filter replaces it.
 */
export function reportListFilters(group: ReportListGroup, picks: ReportListPicks, scope: ReportListScope): ColumnFilters {
  const filters: ColumnFilters = { disabled_at: windowFilter(scope.firstYear) };
  if (picks.costCenterLabels) filters.cost_center_label = keepValues([...picks.costCenterLabels]);
  if (picks.runBuild) filters.run_build = keepValues([picks.runBuild === 'none' ? null : picks.runBuild]);
  for (const { column, name } of picks.analytics) filters[column] = keepValues([name]);
  if (picks.withFte || scope.fteOnly) filters.has_fte = keepValues(['yes']);
  const [column, values] = groupFilter(group);
  filters[column] = keepValues(values);
  return filters;
}

/** The list a row opens: its href, and how to save its filters when they are too long for a URL. */
export type ReportListLink = {
  /** `/ops/<scope>?filters=…&statusScope=all`, or `?ctx=…` once filters too long for a URL are saved in this tab. */
  href: string;
  /**
   * Present while the filters are too long for a URL and not saved yet: saves them and answers the
   * `ctx` address. Called when the link is used, never before (saves are rate limited).
   */
  save?: () => Promise<string>;
};

/**
 * The list of `scope` filtered on a row's group, the bar's picks and the report's window. Filters too
 * long for a URL go as `ctx` once saved in this tab; until then the href carries them inline (copying
 * the link still works) and `save` gives the `ctx` address.
 */
export function reportListLink(scope: BudgetScope, group: ReportListGroup, picks: ReportListPicks, report: ReportListScope): ReportListLink {
  const filters = JSON.stringify(reportListFilters(group, picks, report));
  const endpoint = SUMMARY_ENDPOINT[scope];
  const address = (search: string) => `/ops/${scope}?${search}`;
  const params = new URLSearchParams({ filters });
  params.set(STATUS_SCOPE_PARAM, 'all');
  const search = compactListSearchCached(params.toString(), endpoint);
  const saved = !new URLSearchParams(search).has('filters');
  if (!filtersNeedContext(filters) || saved) return { href: address(search) };
  return {
    href: address(search),
    save: async () => {
      await saveListContext(endpoint, filters);
      // Now known in this tab: the filters go as `ctx`.
      return address(compactListSearchCached(params.toString(), endpoint));
    },
  };
}

/** The href alone (`reportListLink`). */
export function reportListHref(scope: BudgetScope, group: ReportListGroup, picks: ReportListPicks, report: ReportListScope): string {
  return reportListLink(scope, group, picks, report).href;
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
