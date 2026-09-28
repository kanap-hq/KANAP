import React, { useCallback, useMemo } from 'react';
import { Box, Link as MLink, MenuItem, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CostCenterSelect from '../fields/CostCenterSelect';
import { useCostCenterTree, type CostCenterTree } from '../../hooks/useCostCenterTree';
import { useAnalyticsAxes, type AnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { analyticsFieldKey, getAnalyticsValue } from '../../services/analytics';
import { drawerMenuItemSx } from '../../theme/formSx';
import { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from './ReportLayout';

/** `none` keeps the lines that say neither run nor build. */
export type RunBuildFilter = 'run' | 'build' | 'none';

const RUN_BUILD_FILTERS: readonly RunBuildFilter[] = ['run', 'build', 'none'];

export const COST_CENTER_PARAM = 'costCenter';
export const RUN_BUILD_PARAM = 'runBuild';
/** `?analytics=<dimension id>:<value id or none>,…`, one pair per narrowed dimension. */
export const ANALYTICS_PARAM = 'analytics';
/** The pick that keeps the lines holding no value on a dimension. */
export const NO_ANALYTICS_VALUE = 'none';

/** The fields of a summary row the bar reads: every budget line of either type carries them. */
export type BudgetReportFilterRow = {
  cost_center_id?: string | null;
  run_build?: string | null;
  /** The line's value on each dimension it has one on, by dimension id. */
  analytics_value_ids?: Record<string, string> | null;
};

export type BudgetRowCriteria = {
  /** The picked node and everything below it, or null for every line. */
  costCenterIds: Set<string> | null;
  runBuild: RunBuildFilter | null;
  /** By dimension id: the value to keep, or `none`. Empty or absent keeps every line. */
  analytics?: ReadonlyMap<string, string> | null;
};

/** Keeps the lines under the picked node, of the picked kind of spend and holding the picked values. */
export function filterBudgetRows<T extends BudgetReportFilterRow>(rows: T[], criteria: BudgetRowCriteria): T[] {
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
        if (pick === NO_ANALYTICS_VALUE ? value !== null : value !== pick) return false;
      }
    }
    return true;
  });
}

/** The pairs of `?analytics=`, in address order; a malformed pair is skipped, a repeated dimension keeps its first. */
export function parseAnalyticsParam(raw: string | null | undefined): Map<string, string> {
  const picks = new Map<string, string>();
  for (const part of (raw ?? '').split(',')) {
    const at = part.indexOf(':');
    if (at <= 0) continue;
    const axisId = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (!axisId || !value || picks.has(axisId)) continue;
    picks.set(axisId, value);
  }
  return picks;
}

function formatAnalyticsParam(picks: ReadonlyMap<string, string>): string | null {
  const parts = Array.from(picks, ([axisId, value]) => `${axisId}:${value}`);
  return parts.length > 0 ? parts.join(',') : null;
}

export type BudgetReportFilterState = {
  tree: CostCenterTree;
  /** The node in the address, once the tree knows it. */
  costCenterId: string | null;
  /** The address names a node the tree failed to load or does not hold: the report shows no line. */
  costCenterMissing: boolean;
  runBuild: RunBuildFilter | null;
  analyticsAxes: AnalyticsAxes;
  /** The applied picks by enabled dimension, in dimension order: a value id or `none`. */
  analytics: ReadonlyMap<string, string>;
  /** The address names dimension values but the dimensions failed to load: the report shows no line. */
  analyticsMissing: boolean;
  setCostCenterId: (id: string | null) => void;
  setRunBuild: (value: RunBuildFilter | null) => void;
  /** A value id, `none`, or null to stop narrowing on that dimension. */
  setAnalyticsValue: (axisId: string, value: string | null) => void;
  /** Drops every dimension pick from the address. */
  clearAnalytics: () => void;
  /** Applied before any total: the report then works on the kept lines only. */
  filterRows: <T extends BudgetReportFilterRow>(rows: T[] | undefined) => T[] | undefined;
};

const NO_ROWS: never[] = [];

/** A one-line notice in the filter row, and its way out. */
const filterNoticeSx = { alignSelf: 'center', fontSize: 13, color: 'kanap.text.secondary' } as const;
const filterNoticeLinkSx = { fontSize: 'inherit', verticalAlign: 'baseline' } as const;

/**
 * Cost center, run/build and analytics values of a budget report, kept in `?costCenter=`, `?runBuild=`
 * and `?analytics=` so a link opens the report already narrowed. A group stands for every node below
 * it, disabled ones included: a line keeps a disabled cost center, and its amounts still belong to the
 * group. A pair naming an unknown or disabled dimension is ignored: the bar has no select to show or
 * clear it. Dimensions that failed to load make every pair unreadable: like a missing cost center, the
 * report then shows nothing and says why.
 */
export function useBudgetReportFilters(): BudgetReportFilterState {
  const tree = useCostCenterTree();
  const analyticsAxes = useAnalyticsAxes();
  const [params, setParams] = useSearchParams();
  const rawCostCenter = params.get(COST_CENTER_PARAM) || null;
  const rawRunBuild = params.get(RUN_BUILD_PARAM);
  const rawAnalytics = params.get(ANALYTICS_PARAM);
  const runBuild = RUN_BUILD_FILTERS.includes(rawRunBuild as RunBuildFilter) ? (rawRunBuild as RunBuildFilter) : null;
  const costCenterId = rawCostCenter && tree.ready && !tree.isError && tree.byId.has(rawCostCenter) ? rawCostCenter : null;
  const waitingForTree = rawCostCenter != null && !tree.ready;
  // A node deleted since the link was made, or a tree that failed to load: whole-tenant totals under a
  // cost center link would be wrong, so the report shows nothing and says why.
  const costCenterMissing = rawCostCenter != null && tree.ready && costCenterId == null;

  const requestedAnalytics = useMemo(() => parseAnalyticsParam(rawAnalytics), [rawAnalytics]);
  // The kept pairs as text, so the map (and every total built on it) only changes when a pick does.
  const appliedAnalytics = analyticsAxes.ready
    ? formatAnalyticsParam(new Map(analyticsAxes.enabled
      .filter((axis) => requestedAnalytics.has(axis.id))
      .map((axis) => [axis.id, requestedAnalytics.get(axis.id) as string]))) ?? ''
    : '';
  const analytics = useMemo(() => parseAnalyticsParam(appliedAnalytics), [appliedAnalytics]);
  const waitingForAxes = requestedAnalytics.size > 0 && !analyticsAxes.ready;
  const analyticsMissing = requestedAnalytics.size > 0 && analyticsAxes.isError;

  const setParam = useCallback((key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }, [setParams]);
  const setCostCenterId = useCallback((id: string | null) => setParam(COST_CENTER_PARAM, id), [setParam]);
  const setRunBuild = useCallback((value: RunBuildFilter | null) => setParam(RUN_BUILD_PARAM, value), [setParam]);
  const setAnalyticsValue = useCallback((axisId: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      const picks = parseAnalyticsParam(prev.get(ANALYTICS_PARAM));
      if (value) picks.set(axisId, value);
      else picks.delete(axisId);
      const formatted = formatAnalyticsParam(picks);
      if (formatted) next.set(ANALYTICS_PARAM, formatted);
      else next.delete(ANALYTICS_PARAM);
      return next;
    }, { replace: true });
  }, [setParams]);
  const clearAnalytics = useCallback(() => setParam(ANALYTICS_PARAM, null), [setParam]);

  const filterRows = useCallback(<T extends BudgetReportFilterRow>(rows: T[] | undefined): T[] | undefined => {
    if (!rows) return rows;
    // Until the tree and the dimensions say what the address means, no total is shown rather than a partial one.
    if (waitingForTree || costCenterMissing || waitingForAxes || analyticsMissing) return NO_ROWS;
    return filterBudgetRows(rows, {
      costCenterIds: costCenterId ? tree.descendantIds(costCenterId) : null,
      runBuild,
      analytics,
    });
  }, [waitingForTree, costCenterMissing, waitingForAxes, analyticsMissing, costCenterId, runBuild, analytics, tree]);

  return useMemo(
    () => ({
      tree,
      costCenterId,
      costCenterMissing,
      runBuild,
      analyticsAxes,
      analytics,
      analyticsMissing,
      setCostCenterId,
      setRunBuild,
      setAnalyticsValue,
      clearAnalytics,
      filterRows,
    }),
    [
      tree, costCenterId, costCenterMissing, runBuild, analyticsAxes, analytics, analyticsMissing,
      setCostCenterId, setRunBuild, setAnalyticsValue, clearAnalytics, filterRows,
    ],
  );
}

type AnalyticsValueOption = { id: string; label: string };

type AnalyticsDimensionFilter = {
  axisId: string;
  label: string;
  /** The values the report's lines hold on this dimension, by name. */
  options: AnalyticsValueOption[];
};

/**
 * One dimension's select. A value picked in the address that none of the lines holds (a link made on
 * the other item type, a value no longer used) is named from the value itself so the select can show it.
 */
function AnalyticsValueSelect({
  filter,
  value,
  onChange,
}: {
  filter: AnalyticsDimensionFilter;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation('ops');
  const unlisted = value && value !== NO_ANALYTICS_VALUE && !filter.options.some((option) => option.id === value) ? value : null;
  const { data: unlistedName } = useQuery({
    queryKey: ['analytics-categories', 'report-filter-name', unlisted],
    queryFn: async () => (await getAnalyticsValue(unlisted as string))?.name ?? null,
    enabled: Boolean(unlisted),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const options = unlisted
    ? [...filter.options, { id: unlisted, label: (unlistedName ?? '').trim() || t('reports.analyticsCategory.unnamed') }]
    : filter.options;

  return (
    <ReportFilter label={filter.label} width={200}>
      <TextField
        select
        size="small"
        value={value ?? ''}
        onChange={(event) => onChange(String(event.target.value) || null)}
        SelectProps={{
          displayEmpty: true,
          MenuProps: reportFilterMenuProps,
          inputProps: { 'aria-label': filter.label },
        }}
        sx={reportFilterSelectSx}
      >
        <MenuItem value="" sx={drawerMenuItemSx}>{t('reports.filters.analyticsAll')}</MenuItem>
        {options.map((option) => (
          <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>{option.label}</MenuItem>
        ))}
        <MenuItem value={NO_ANALYTICS_VALUE} sx={drawerMenuItemSx}>{t('reports.filters.analyticsNone')}</MenuItem>
      </TextField>
    </ReportFilter>
  );
}

/**
 * The bar's pickers, for a report's filter row. The cost center picker shows once the tenant has a
 * node; the run/build picker once a line of the report says run or build (or the address asks for it);
 * one select per enabled dimension once a line holds a value on it (or the address names it), offering
 * the values the lines hold. A node the tree cannot resolve, or dimension picks that cannot be read, get
 * a one-line notice with a way out. With none of these, nothing renders. `rows` are the report's lines
 * before any filter.
 */
export function BudgetReportFilters({
  filters,
  rows,
}: {
  filters: BudgetReportFilterState;
  rows: BudgetReportFilterRow[] | undefined;
}) {
  const { t } = useTranslation('ops');
  const showCostCenter = filters.tree.hasAny;
  const showRunBuild = useMemo(
    () => filters.runBuild != null || (rows ?? []).some((row) => Boolean(row.run_build)),
    [filters.runBuild, rows],
  );
  const { analyticsAxes, analytics } = filters;
  const analyticsFilters = useMemo<AnalyticsDimensionFilter[]>(() => {
    if (!analyticsAxes.ready) return [];
    const out: AnalyticsDimensionFilter[] = [];
    for (const axis of analyticsAxes.enabled) {
      const names = new Map<string, string>();
      const nameKey = analyticsFieldKey(axis.id);
      for (const row of rows ?? []) {
        const id = row.analytics_value_ids?.[axis.id];
        if (!id || names.has(id)) continue;
        const name = (row as Record<string, unknown>)[nameKey];
        names.set(id, (typeof name === 'string' ? name.trim() : '') || t('reports.analyticsCategory.unnamed'));
      }
      if (names.size === 0 && !analytics.has(axis.id)) continue;
      const options = Array.from(names, ([id, label]) => ({ id, label }));
      options.sort((a, b) => a.label.localeCompare(b.label));
      out.push({ axisId: axis.id, label: analyticsAxes.label(axis), options });
    }
    return out;
  }, [analyticsAxes, analytics, rows, t]);
  if (!showCostCenter && !showRunBuild && !filters.costCenterMissing && !filters.analyticsMissing && analyticsFilters.length === 0) {
    return null;
  }

  const runBuildLabels: Record<RunBuildFilter, string> = {
    run: t('reports.filters.runBuildRun'),
    build: t('reports.filters.runBuildBuild'),
    none: t('reports.filters.runBuildNone'),
  };

  return (
    <>
      {showCostCenter && (
        <ReportFilter label={t('reports.filters.costCenter')} width={260}>
          <CostCenterSelect
            value={filters.costCenterId}
            onChange={filters.setCostCenterId}
            selectable="all"
            label={t('reports.filters.costCenter')}
            hideLabel
            placeholder={t('reports.filters.allCostCenters')}
          />
        </ReportFilter>
      )}
      {filters.costCenterMissing && (
        <Box role="status" sx={filterNoticeSx}>
          {t('reports.filters.costCenterMissing')}{' '}
          <MLink component="button" type="button" underline="hover" onClick={() => filters.setCostCenterId(null)} sx={filterNoticeLinkSx}>
            {t('reports.filters.clearCostCenter')}
          </MLink>
        </Box>
      )}
      {showRunBuild && (
        <ReportFilter label={t('reports.filters.runBuild')} width={160}>
          <TextField
            select
            size="small"
            value={filters.runBuild ?? ''}
            onChange={(event) => {
              const next = String(event.target.value);
              filters.setRunBuild(RUN_BUILD_FILTERS.includes(next as RunBuildFilter) ? (next as RunBuildFilter) : null);
            }}
            SelectProps={{
              displayEmpty: true,
              MenuProps: reportFilterMenuProps,
              inputProps: { 'aria-label': t('reports.filters.runBuild') },
            }}
            sx={reportFilterSelectSx}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{t('reports.filters.runBuildAll')}</MenuItem>
            {RUN_BUILD_FILTERS.map((value) => (
              <MenuItem key={value} value={value} sx={drawerMenuItemSx}>{runBuildLabels[value]}</MenuItem>
            ))}
          </TextField>
        </ReportFilter>
      )}
      {filters.analyticsMissing && (
        <Box role="status" sx={filterNoticeSx}>
          {t('reports.filters.analyticsMissing')}{' '}
          <MLink component="button" type="button" underline="hover" onClick={filters.clearAnalytics} sx={filterNoticeLinkSx}>
            {t('reports.filters.clearAnalytics')}
          </MLink>
        </Box>
      )}
      {analyticsFilters.map((filter) => (
        <AnalyticsValueSelect
          key={filter.axisId}
          filter={filter}
          value={analytics.get(filter.axisId) ?? null}
          onChange={(value) => filters.setAnalyticsValue(filter.axisId, value)}
        />
      ))}
    </>
  );
}
