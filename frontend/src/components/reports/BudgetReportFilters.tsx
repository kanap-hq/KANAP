import React, { useCallback, useMemo } from 'react';
import { Box, Link as MLink, MenuItem, TextField } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CostCenterSelect from '../fields/CostCenterSelect';
import { useCostCenterTree, type CostCenterTree } from '../../hooks/useCostCenterTree';
import { drawerMenuItemSx } from '../../theme/formSx';
import { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from './ReportLayout';

/** `none` keeps the lines that say neither run nor build. */
export type RunBuildFilter = 'run' | 'build' | 'none';

const RUN_BUILD_FILTERS: readonly RunBuildFilter[] = ['run', 'build', 'none'];

export const COST_CENTER_PARAM = 'costCenter';
export const RUN_BUILD_PARAM = 'runBuild';

/** The two fields of a summary row the bar reads: every budget line of either type carries them. */
export type BudgetReportFilterRow = {
  cost_center_id?: string | null;
  run_build?: string | null;
};

export type BudgetRowCriteria = {
  /** The picked node and everything below it, or null for every line. */
  costCenterIds: Set<string> | null;
  runBuild: RunBuildFilter | null;
};

/** Keeps the lines under the picked node and of the picked kind of spend. */
export function filterBudgetRows<T extends BudgetReportFilterRow>(rows: T[], criteria: BudgetRowCriteria): T[] {
  const { costCenterIds, runBuild } = criteria;
  if (!costCenterIds && !runBuild) return rows;
  return rows.filter((row) => {
    if (costCenterIds && !(row.cost_center_id && costCenterIds.has(row.cost_center_id))) return false;
    if (runBuild) {
      const value = row.run_build || null;
      if (runBuild === 'none' ? value !== null : value !== runBuild) return false;
    }
    return true;
  });
}

export type BudgetReportFilterState = {
  tree: CostCenterTree;
  /** The node in the address, once the tree knows it. */
  costCenterId: string | null;
  /** The address names a node the tree failed to load or does not hold: the report shows no line. */
  costCenterMissing: boolean;
  runBuild: RunBuildFilter | null;
  setCostCenterId: (id: string | null) => void;
  setRunBuild: (value: RunBuildFilter | null) => void;
  /** Applied before any total: the report then works on the kept lines only. */
  filterRows: <T extends BudgetReportFilterRow>(rows: T[] | undefined) => T[] | undefined;
};

const NO_ROWS: never[] = [];

/**
 * Cost center and run/build of a budget report, kept in `?costCenter=` and `?runBuild=` so a link
 * opens the report already narrowed. A group stands for every node below it, disabled ones included:
 * a line keeps a disabled cost center, and its amounts still belong to the group.
 */
export function useBudgetReportFilters(): BudgetReportFilterState {
  const tree = useCostCenterTree();
  const [params, setParams] = useSearchParams();
  const rawCostCenter = params.get(COST_CENTER_PARAM) || null;
  const rawRunBuild = params.get(RUN_BUILD_PARAM);
  const runBuild = RUN_BUILD_FILTERS.includes(rawRunBuild as RunBuildFilter) ? (rawRunBuild as RunBuildFilter) : null;
  const costCenterId = rawCostCenter && tree.ready && !tree.isError && tree.byId.has(rawCostCenter) ? rawCostCenter : null;
  const waitingForTree = rawCostCenter != null && !tree.ready;
  // A node deleted since the link was made, or a tree that failed to load: whole-tenant totals under a
  // cost center link would be wrong, so the report shows nothing and says why.
  const costCenterMissing = rawCostCenter != null && tree.ready && costCenterId == null;

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

  const filterRows = useCallback(<T extends BudgetReportFilterRow>(rows: T[] | undefined): T[] | undefined => {
    if (!rows) return rows;
    // Until the tree says what the node holds, no total is shown rather than a partial one.
    if (waitingForTree || costCenterMissing) return NO_ROWS;
    return filterBudgetRows(rows, {
      costCenterIds: costCenterId ? tree.descendantIds(costCenterId) : null,
      runBuild,
    });
  }, [waitingForTree, costCenterMissing, costCenterId, runBuild, tree]);

  return useMemo(
    () => ({ tree, costCenterId, costCenterMissing, runBuild, setCostCenterId, setRunBuild, filterRows }),
    [tree, costCenterId, costCenterMissing, runBuild, setCostCenterId, setRunBuild, filterRows],
  );
}

/**
 * The bar's two pickers, for a report's filter row. The cost center picker shows once the tenant has a
 * node; the run/build picker once a line of the report says run or build (or the address asks for it).
 * A node the tree cannot resolve gets a one-line notice with a way out. With none of these, nothing
 * renders. `rows` are the report's lines before any filter.
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
  if (!showCostCenter && !showRunBuild && !filters.costCenterMissing) return null;

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
        <Box role="status" sx={{ alignSelf: 'center', fontSize: 13, color: 'kanap.text.secondary' }}>
          {t('reports.filters.costCenterMissing')}{' '}
          <MLink component="button" type="button" underline="hover" onClick={() => filters.setCostCenterId(null)} sx={{ fontSize: 'inherit', verticalAlign: 'baseline' }}>
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
    </>
  );
}
