import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { loadAnalyticsAxes, axisAppliesTo, type AnalyticsAxisInfo } from '../../analytics/analytics-axes.util';
import { readBudgetColumns, type BudgetColumnsSettings } from '../../budget-columns/budget-columns.util';
import { costCenterLabel } from '../../cost-centers/cost-center-tree.util';
import { BUDGET_COLUMN_MEASURE } from '../amounts-write.util';
import {
  MAX_GROUPS,
  METRIC_SUFFIX,
  NO_ANALYTICS_VALUE,
  type BudgetScope,
  type MetricKey,
  type ReportFilterPicks,
  type ReportMeasure,
  type RunBuildPick,
} from './shared/reportAggregates';
import type { ColumnSelection } from './shared/reportTables';

/**
 * The parameters of the budget report exports (`GET reports/budget/<report>/export`), read and
 * checked once for the eight reports. They mirror the screen: its address (`scope`, `measure`,
 * `costCenter`, `runBuild`, `fte=with`, `analytics=<dimension id>:<value id or none>,…`) and the state it
 * holds (years, column keys, selections, top count, exclusions), always explicit: the server computes
 * no year from today except the window the screen allows. Every invalid value is a 400.
 *
 * The filter bar's picks become the `ReportFilterPicks` the screen gives `reportFilterModels`; the
 * cost center is expanded here into itself and every node below it (the screen's
 * `useCostCenterTree.descendantIds`, disabled nodes included).
 */

export type BudgetReport = 'comparison' | 'columns-compare' | 'top-lines';

const COMMON_KEYS = ['scope', 'measure', 'costCenter', 'runBuild', 'fte', 'analytics'] as const;

/** The query keys of each report, besides `format`, `language` and `tz`. */
export const BUDGET_REPORT_KEYS: Record<BudgetReport, readonly string[]> = {
  comparison: [...COMMON_KEYS, 'startYear', 'endYear', 'metrics'],
  'columns-compare': [...COMMON_KEYS, 'selections', 'yearGrouping'],
  'top-lines': [...COMMON_KEYS, 'year', 'metric', 'top', 'excludeIds', 'excludeAccounts'],
};

/** The most selections the columns compare screen holds. */
export const MAX_COLUMN_SELECTIONS = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METRICS = Object.keys(METRIC_SUFFIX) as MetricKey[];

/** The filter bar's picks, with what the Parameters sheet names. */
export interface BudgetReportFilterParams {
  scope: BudgetScope;
  measure: ReportMeasure;
  picks: ReportFilterPicks;
  /** `code · name` of the picked node. */
  costCenter: string | null;
  /** Per analytics pick, in the address order: the dimension and the value (null for "no value"). */
  analytics: Array<{ axis: AnalyticsAxisInfo; valueName: string | null }>;
  columns: BudgetColumnsSettings;
}

export type BudgetReportParams = BudgetReportFilterParams & (
  | { report: 'comparison'; startYear: number; endYear: number; metrics: MetricKey[] }
  | { report: 'columns-compare'; selections: ColumnSelection[]; yearGrouping: boolean }
  | { report: 'top-lines'; year: number; metric: MetricKey; top: number; excludeIds: string[]; excludeAccounts: string[] }
);

type Query = Record<string, unknown>;

function text(query: Query, key: string): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${key} must be given once.`);
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function required(query: Query, key: string): string {
  const value = text(query, key);
  if (value === undefined) throw new BadRequestException(`${key} is required.`);
  return value;
}

function year(raw: string, key: string, from: number, to: number): number {
  if (!/^\d{4}$/.test(raw)) throw new BadRequestException(`${key} must be a year (YYYY).`);
  const value = Number(raw);
  if (value < from || value > to) throw new BadRequestException(`${key} must be between ${from} and ${to}.`);
  return value;
}

function column(raw: string, key: string, columns: BudgetColumnsSettings): MetricKey {
  const metric = METRICS.find((candidate) => candidate === raw);
  if (!metric) throw new BadRequestException(`${key}: unknown column ${raw} (${METRICS.join(', ')}).`);
  if (!columns.enabled[BUDGET_COLUMN_MEASURE[metric]]) throw new BadRequestException(`${key}: the column ${raw} is hidden.`);
  return metric;
}

function list(raw: string): string[] {
  return raw.split(',').map((part) => part.trim());
}

/** The node and every node below it, disabled ones included; null for a node the tenant does not hold. */
async function costCenterSubtree(manager: EntityManager, tenantId: string, id: string): Promise<{ ids: string[]; label: string } | null> {
  const rows: Array<{ id: string; code: string; name: string; root: boolean }> = await manager.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM cost_centers WHERE tenant_id = $1 AND id = $2
       UNION
       SELECT c.id FROM cost_centers c JOIN sub ON c.parent_id = sub.id WHERE c.tenant_id = $1
     )
     SELECT c.id, c.code, c.name, c.id = $2 AS root FROM cost_centers c JOIN sub ON sub.id = c.id WHERE c.tenant_id = $1`,
    [tenantId, id],
  );
  const root = rows.find((row) => row.root);
  return root ? { ids: rows.map((row) => row.id), label: costCenterLabel(root) } : null;
}

/** `?analytics=`: each pair names an enabled dimension of the scope's lines and one of its values, or `none`. */
async function analyticsPicks(
  manager: EntityManager,
  tenantId: string,
  scope: BudgetScope,
  raw: string,
): Promise<Array<{ axis: AnalyticsAxisInfo; value: string; valueName: string | null }>> {
  const axes = (await loadAnalyticsAxes(manager, tenantId))
    .filter((axis) => axis.status === 'enabled' && (scope === 'all' || axisAppliesTo(axis, scope)));
  const pairs = list(raw).map((part) => {
    const at = part.indexOf(':');
    const axisId = at > 0 ? part.slice(0, at).trim() : '';
    const value = at > 0 ? part.slice(at + 1).trim() : '';
    if (!UUID.test(axisId) || !(value === NO_ANALYTICS_VALUE || UUID.test(value))) {
      throw new BadRequestException('analytics must read <dimension id>:<value id or none>,…');
    }
    return { axisId: axisId.toLowerCase(), value: value.toLowerCase() };
  });
  if (new Set(pairs.map((pair) => pair.axisId)).size !== pairs.length) throw new BadRequestException('analytics names a dimension twice.');
  const valueIds = pairs.map((pair) => pair.value).filter((value) => value !== NO_ANALYTICS_VALUE);
  const values: Array<{ id: string; axis_id: string; name: string }> = valueIds.length
    ? await manager.query(`SELECT id, axis_id, name FROM analytics_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, valueIds])
    : [];
  return pairs.map((pair) => {
    const axis = axes.find((candidate) => candidate.id === pair.axisId);
    if (!axis) throw new BadRequestException(`analytics: ${pair.axisId} is not an enabled dimension of these lines.`);
    if (pair.value === NO_ANALYTICS_VALUE) return { axis, value: NO_ANALYTICS_VALUE, valueName: null };
    const value = values.find((candidate) => candidate.id === pair.value && candidate.axis_id === axis.id);
    if (!value) throw new BadRequestException(`analytics: ${pair.value} is not a value of the dimension ${pair.axisId}.`);
    return { axis, value: value.id, valueName: value.name };
  });
}

/**
 * Reads the query of a report (its keys were checked by `reportExportRequest`). `currentYear` sets the
 * windows the screens allow: Y-2..Y+2 for the comparison and the columns compare, Y-1..Y+1 for the top.
 * The exclusions of the top are checked against what the screen offers by the service.
 */
export async function parseBudgetReportParams(
  report: BudgetReport,
  query: Query,
  ctx: { manager: EntityManager; tenantId: string; currentYear: number },
): Promise<BudgetReportParams> {
  const { manager, tenantId, currentYear: Y } = ctx;
  const scopeRaw = text(query, 'scope') ?? 'all';
  if (scopeRaw !== 'all' && scopeRaw !== 'opex' && scopeRaw !== 'capex') throw new BadRequestException('scope must be all, opex or capex.');
  const scope: BudgetScope = scopeRaw;
  const measureRaw = text(query, 'measure') ?? 'amount';
  if (measureRaw !== 'amount' && measureRaw !== 'fte') throw new BadRequestException('measure must be amount or fte.');
  const measure: ReportMeasure = measureRaw;

  const costCenterRaw = text(query, 'costCenter');
  let costCenter: { ids: string[]; label: string } | null = null;
  if (costCenterRaw !== undefined) {
    if (!UUID.test(costCenterRaw)) throw new BadRequestException('costCenter must be a cost center id.');
    costCenter = await costCenterSubtree(manager, tenantId, costCenterRaw);
    if (!costCenter) throw new BadRequestException('costCenter: no such cost center.');
  }
  const runBuildRaw = text(query, 'runBuild');
  if (runBuildRaw !== undefined && runBuildRaw !== 'run' && runBuildRaw !== 'build' && runBuildRaw !== 'none') {
    throw new BadRequestException('runBuild must be run, build or none.');
  }
  const runBuild = (runBuildRaw ?? null) as RunBuildPick | null;
  const fteRaw = text(query, 'fte');
  if (fteRaw !== undefined && fteRaw !== 'with') throw new BadRequestException('fte must be with.');
  const analyticsRaw = text(query, 'analytics');
  const analytics = analyticsRaw === undefined ? [] : await analyticsPicks(manager, tenantId, scope, analyticsRaw);
  const columns = await readBudgetColumns(manager, tenantId);

  const filters: BudgetReportFilterParams = {
    scope,
    measure,
    picks: {
      costCenterIds: costCenter?.ids ?? null,
      runBuild,
      analytics: analytics.map((pick) => [pick.axis.id, pick.value] as const),
      withFte: fteRaw === 'with',
    },
    costCenter: costCenter?.label ?? null,
    analytics: analytics.map((pick) => ({ axis: pick.axis, valueName: pick.valueName })),
    columns,
  };

  if (report === 'comparison') {
    const startYear = year(required(query, 'startYear'), 'startYear', Y - 2, Y + 2);
    const endYear = year(required(query, 'endYear'), 'endYear', Y - 2, Y + 2);
    if (startYear > endYear) throw new BadRequestException('startYear must not be after endYear.');
    const metrics = list(required(query, 'metrics')).map((raw) => column(raw, 'metrics', columns));
    if (new Set(metrics).size !== metrics.length) throw new BadRequestException('metrics names a column twice.');
    return { ...filters, report, startYear, endYear, metrics };
  }

  if (report === 'columns-compare') {
    const selections = list(required(query, 'selections')).map((part): ColumnSelection => {
      const [yearRaw, metricRaw, extra] = part.split(':');
      if (extra !== undefined || !yearRaw || !metricRaw) throw new BadRequestException('selections must read <year>:<column>,…');
      return { year: year(yearRaw.trim(), 'selections', Y - 2, Y + 2), metric: column(metricRaw.trim(), 'selections', columns) };
    });
    if (selections.length > MAX_COLUMN_SELECTIONS) throw new BadRequestException(`selections holds ${MAX_COLUMN_SELECTIONS} pairs at most.`);
    const grouping = text(query, 'yearGrouping') ?? 'false';
    if (grouping !== 'true' && grouping !== 'false') throw new BadRequestException('yearGrouping must be true or false.');
    return { ...filters, report, selections, yearGrouping: grouping === 'true' };
  }

  const topYear = year(required(query, 'year'), 'year', Y - 1, Y + 1);
  const metric = column(required(query, 'metric'), 'metric', columns);
  const topRaw = required(query, 'top');
  if (!/^\d+$/.test(topRaw) || Number(topRaw) < 1) throw new BadRequestException('top must be a whole number of lines, 1 or more.');
  // The screen keeps what was typed; the request asks `MAX_GROUPS` lines at most (`topLimit`).
  const top = Math.min(Number(topRaw), MAX_GROUPS);
  const idsRaw = text(query, 'excludeIds');
  const excludeIds = idsRaw === undefined ? [] : list(idsRaw).map((id) => {
    if (!UUID.test(id)) throw new BadRequestException('excludeIds must be line ids.');
    return id.toLowerCase();
  });
  if (new Set(excludeIds).size !== excludeIds.length) throw new BadRequestException('excludeIds names a line twice.');
  const accountsRaw = text(query, 'excludeAccounts');
  let excludeAccounts: string[] = [];
  if (accountsRaw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(accountsRaw);
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed) || parsed.some((label) => typeof label !== 'string' || label.trim() === '')) {
      throw new BadRequestException('excludeAccounts must be a JSON list of account labels.');
    }
    excludeAccounts = parsed as string[];
    if (new Set(excludeAccounts).size !== excludeAccounts.length) throw new BadRequestException('excludeAccounts names an account twice.');
  }
  return { ...filters, report, year: topYear, metric, top, excludeIds, excludeAccounts };
}
