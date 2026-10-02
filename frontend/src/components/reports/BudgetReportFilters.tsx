import React, { useCallback, useMemo } from 'react';
import { Box, Link as MLink, MenuItem, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CostCenterSelect from '../fields/CostCenterSelect';
import { useCostCenterTree, type CostCenterTree } from '../../hooks/useCostCenterTree';
import { useAnalyticsAxes, type AnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { getAnalyticsValue } from '../../services/analytics';
import { drawerMenuItemSx } from '../../theme/formSx';
import { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from './ReportLayout';
import {
  axisValuesRequest,
  NO_ANALYTICS_VALUE,
  NO_LINE,
  readAxisValues,
  readRunBuildPresence,
  reportFilterModels,
  runBuildPresenceRequest,
  type BudgetScope,
  type ColumnFilters,
  type LabelledOption,
  type RunBuildPick,
} from '../../pages/reports/reportAggregates';
import { compareNames, useBudgetAggregate, useBudgetAggregates } from '../../pages/reports/useBudgetAggregate';

/** `none` keeps the lines that say neither run nor build. */
export type RunBuildFilter = RunBuildPick;

const RUN_BUILD_FILTERS: readonly RunBuildFilter[] = ['run', 'build', 'none'];

export { NO_ANALYTICS_VALUE };

export const COST_CENTER_PARAM = 'costCenter';
export const RUN_BUILD_PARAM = 'runBuild';
/** `?analytics=<dimension id>:<value id or none>,…`, one pair per narrowed dimension. */
export const ANALYTICS_PARAM = 'analytics';
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

export type BudgetReportFilterOptions = {
  /** False until the lines' run or build values and dimension values are known. */
  ready: boolean;
  /** Lines in the report's window (filters aside). */
  lineCount: number;
  /** A line of the window says run or build. */
  hasRunBuild: boolean;
  /** Per enabled dimension, the values the window's lines hold on it, by name. */
  analytics: ReadonlyMap<string, LabelledOption[]>;
  /** The options could not be read: the bar says so, with a retry, instead of hiding its selects. */
  isError: boolean;
  retry: () => void;
};

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
  /**
   * The picks as column filters of the report's aggregate, applied before any total. Null while the
   * tree or the dimensions are needed to read the address: no total is shown rather than a partial
   * one. A node or values that cannot be read keep no line.
   */
  queryFilters: ColumnFilters | null;
  /** What the pickers offer, from every line of the report's window. */
  options: BudgetReportFilterOptions;
};

const NO_AXIS_VALUES: ReadonlyMap<string, LabelledOption[]> = new Map();

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
 *
 * `scope` and `years` are the report's: the pickers offer what the lines of its window hold (the
 * lines still active on 1 January of the earliest year it reads), whatever the picks.
 */
export function useBudgetReportFilters({ scope, years }: { scope: BudgetScope; years?: readonly number[] }): BudgetReportFilterState {
  const { t } = useTranslation('ops');
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

  const descendants = useMemo(
    () => (costCenterId ? Array.from(tree.descendantIds(costCenterId)) : null),
    [costCenterId, tree],
  );
  const queryFilters = useMemo<ColumnFilters | null>(() => {
    // Until the tree and the dimensions say what the address means, no total is shown rather than a partial one.
    if (waitingForTree || waitingForAxes) return null;
    if (costCenterMissing || analyticsMissing) return NO_LINE;
    return reportFilterModels({ costCenterIds: descendants, runBuild, analytics: Array.from(analytics) });
  }, [waitingForTree, waitingForAxes, costCenterMissing, analyticsMissing, descendants, runBuild, analytics]);

  // What the pickers offer: every line of the window, picks aside.
  const yearsKey = years?.join(',') ?? '';
  const windowYears = useMemo(() => (yearsKey ? yearsKey.split(',').map(Number) : undefined), [yearsKey]);
  const presence = useBudgetAggregate(scope, useMemo(() => runBuildPresenceRequest(windowYears), [windowYears]));
  const enabledAxes = analyticsAxes.ready ? analyticsAxes.enabled : [];
  const axisIdsKey = enabledAxes.map((axis) => axis.id).join(',');
  const axisRequests = useMemo(
    () => (axisIdsKey ? axisIdsKey.split(',').map((axisId) => axisValuesRequest(axisId, windowYears)) : []),
    [axisIdsKey, windowYears],
  );
  const axisValues = useBudgetAggregates(scope, analyticsAxes.ready ? axisRequests : null);
  const unnamed = t('reports.analyticsCategory.unnamed');
  const options = useMemo<BudgetReportFilterOptions>(() => {
    const { lineCount, hasRunBuild } = readRunBuildPresence(presence.data);
    const byAxis = new Map<string, LabelledOption[]>();
    const ids = axisIdsKey ? axisIdsKey.split(',') : [];
    ids.forEach((axisId, i) => byAxis.set(axisId, readAxisValues(axisValues.data?.[i], unnamed, compareNames)));
    return {
      ready: presence.data != null && (ids.length === 0 || axisValues.data != null),
      lineCount,
      hasRunBuild,
      analytics: ids.length ? byAxis : NO_AXIS_VALUES,
      isError: presence.isError || axisValues.isError,
      retry: () => {
        if (presence.isError) void presence.refetch();
        if (axisValues.isError) axisValues.refetch();
      },
    };
  }, [presence.data, presence.isError, presence.refetch, axisValues, axisIdsKey, unnamed]); // eslint-disable-line react-hooks/exhaustive-deps

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
      queryFilters,
      options,
    }),
    [
      tree, costCenterId, costCenterMissing, runBuild, analyticsAxes, analytics, analyticsMissing,
      setCostCenterId, setRunBuild, setAnalyticsValue, clearAnalytics, queryFilters, options,
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
 * a one-line notice with a way out. With none of these, nothing renders. The options come from every
 * line of the report's window, before any filter.
 */
export function BudgetReportFilters({ filters }: { filters: BudgetReportFilterState }) {
  const { t } = useTranslation(['ops', 'common']);
  const showCostCenter = filters.tree.hasAny;
  const showRunBuild = filters.runBuild != null || filters.options.hasRunBuild;
  const { analyticsAxes, analytics, options } = filters;
  const analyticsFilters = useMemo<AnalyticsDimensionFilter[]>(() => {
    if (!analyticsAxes.ready) return [];
    const out: AnalyticsDimensionFilter[] = [];
    for (const axis of analyticsAxes.enabled) {
      const values = options.analytics.get(axis.id) ?? [];
      if (values.length === 0 && !analytics.has(axis.id)) continue;
      out.push({ axisId: axis.id, label: analyticsAxes.label(axis), options: values });
    }
    return out;
  }, [analyticsAxes, analytics, options.analytics]);
  if (!showCostCenter && !showRunBuild && !filters.costCenterMissing && !filters.analyticsMissing && analyticsFilters.length === 0 && !options.isError) {
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
      {options.isError && (
        <Box role="status" sx={filterNoticeSx}>
          {t('common:messages.loadFailed')}{' '}
          <MLink component="button" type="button" underline="hover" onClick={options.retry} sx={filterNoticeLinkSx}>
            {t('common:buttons.retry')}
          </MLink>
        </Box>
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
