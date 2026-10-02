import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportExclusionPicker from '../../components/reports/ReportExclusionPicker';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { useReportScope } from './useReportScope';
import { useTranslation } from 'react-i18next';
import { isMetricKey, metricFileName, resolveMetric, shownMetricKeys } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { useBudgetColumns, type BudgetColumns } from '../../hooks/useBudgetColumns';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { textTabSx, textTabsSx } from '../../theme/formSx';
import { deltaRequests, deltaYearsRequest, excludedAccountValues, readDelta, readDeltaYears, type MetricKey } from './reportAggregates';
import { useBudgetAggregate, useBudgetAggregates } from './useBudgetAggregate';
import { useAccountLabelOptions, useItemOptions } from './useReportOptions';

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function labelForMetric(metric: string, budgetColumns: BudgetColumns) {
  return isMetricKey(metric) ? budgetColumns.label(metric) : '';
}

const NO_METRICS: readonly string[] = [];

type Direction = 'increase' | 'decrease' | 'both';

export default function OpexDeltaReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const now = new Date();
  const currentYear = now.getFullYear();
  const previousYear = currentYear - 1;

  const [sourceYear, setSourceYear] = useState<number | null>(null);
  const [pickedSourceMetric, setSourceMetric] = useState<string | null>(null);
  const [destinationYear, setDestinationYear] = useState<number | null>(null);
  const [pickedDestinationMetric, setDestinationMetric] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('increase');
  const modes = useMemo<Array<'increase' | 'decrease'>>(
    () => (direction === 'both' ? ['increase', 'decrease'] : [direction]),
    [direction],
  );
  const [topCount, setTopCount] = useState<number>(10);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [excludedAccounts, setExcludedAccounts] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'pie' | 'bar'>('bar');

  const [scope, setScope] = useReportScope();
  const scopeLabel = t(`operations.scope.${scope}`);

  const reportFilters = useBudgetReportFilters({ scope });
  // The exclusion pickers offer every line and account of the window; they load when first opened.
  const [itemsWanted, setItemsWanted] = useState(false);
  const [accountsWanted, setAccountsWanted] = useState(false);
  const itemOptions = useItemOptions(scope, itemsWanted);
  const accountOptions = useAccountLabelOptions(scope, accountsWanted);
  // Lines and the accounts they use differ between OPEX and CAPEX: a type switch drops both exclusions.
  useEffect(() => {
    setExcludedIds([]);
    setExcludedAccounts([]);
  }, [scope]);

  // The years a line of the window holds (filters aside): Y-1 to Y+1, and Y-2 or Y+2 when a line has a version then.
  const yearsQuery = useBudgetAggregate(scope, useMemo(() => deltaYearsRequest(currentYear), [currentYear]));
  const yearOptions = useMemo<number[]>(() => readDeltaYears(yearsQuery.data, currentYear), [yearsQuery.data, currentYear]);

  // Both pickers offer the shown budget columns (no currency or rate keys of the slots) and
  // start on the default column: Y-1 against Y.
  const shownMetrics = useMemo(() => shownMetricKeys(budgetColumns), [budgetColumns]);
  const sourceMetrics = sourceYear == null ? NO_METRICS : shownMetrics;
  const destinationMetrics = destinationYear == null ? NO_METRICS : shownMetrics;
  const sourceMetric = sourceYear == null ? '' : resolveMetric(budgetColumns, pickedSourceMetric);
  const destinationMetric = destinationYear == null ? '' : resolveMetric(budgetColumns, pickedDestinationMetric);

  useEffect(() => {
    if (yearOptions.length === 0) return;
    setDestinationYear((prev) => {
      if (prev != null && yearOptions.includes(prev)) return prev;
      const preferred = yearOptions.includes(currentYear)
        ? currentYear
        : yearOptions[yearOptions.length - 1];
      return preferred ?? null;
    });
  }, [yearOptions, currentYear]);

  useEffect(() => {
    if (yearOptions.length === 0) return;
    setSourceYear((prev) => {
      if (prev != null && yearOptions.includes(prev)) return prev;
      const preferred = yearOptions.includes(previousYear)
        ? previousYear
        : yearOptions.includes(currentYear)
          ? currentYear
          : yearOptions[yearOptions.length - 1];
      return preferred ?? null;
    });
  }, [yearOptions, previousYear, currentYear]);

  useEffect(() => {
    if (modes.length === 2 && chartType !== 'bar') {
      setChartType('bar');
    }
  }, [modes, chartType]);

  // One aggregate per direction: the kept lines whose change goes that way, largest first, and the
  // totals of every line of the state (net, gross increase, gross decrease).
  const requests = useMemo(() => {
    if (
      reportFilters.queryFilters == null
      || sourceYear == null
      || !sourceMetric
      || destinationYear == null
      || !destinationMetric
      || modes.length === 0
    ) {
      return null;
    }
    return deltaRequests({
      scope,
      source: { year: sourceYear, metric: sourceMetric as MetricKey },
      destination: { year: destinationYear, metric: destinationMetric as MetricKey },
      modes,
      topCount,
      excludedIds,
      excludedAccounts: excludedAccountValues(excludedAccounts, accountOptions.options ?? []),
      filters: reportFilters.queryFilters,
    });
  }, [
    reportFilters.queryFilters,
    scope,
    sourceYear,
    sourceMetric,
    destinationYear,
    destinationMetric,
    modes,
    topCount,
    excludedIds,
    excludedAccounts,
    accountOptions.options,
  ]);
  // No previous answer kept while a new one loads: a direction switch would label the old lines with the new one.
  const report = useBudgetAggregates(scope, requests);
  // Loading (the years or the lines), or the filter bar still reading its address.
  const busy = reportFilters.queryFilters == null || yearsQuery.isLoading || report.isLoading || report.isPlaceholderData;
  const { processed, allTotals } = useMemo(
    () => (requests && report.data ? readDelta(modes, report.data) : { processed: [], allTotals: { grossIncrease: 0, grossDecrease: 0, net: 0 } }),
    [requests, report.data, modes],
  );

  const sourceLabel = sourceYear != null && sourceMetric
    ? `${labelForMetric(sourceMetric, budgetColumns)} (${sourceYear})`
    : t('reports.opexDelta.sourceColumn');
  const destinationLabel = destinationYear != null && destinationMetric
    ? `${labelForMetric(destinationMetric, budgetColumns)} (${destinationYear})`
    : t('reports.opexDelta.destinationColumn');

  const columns = useMemo<ColDef[]>(() => [
    { field: 'name', headerName: t('reports.columns.item'), flex: 1, minWidth: 240 },
    { field: 'previous', headerName: sourceLabel, width: 200, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) },
    { field: 'current', headerName: destinationLabel, width: 200, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) },
    { field: 'delta', headerName: t('reports.columns.delta'), width: 140, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) },
    { field: 'pct_increase', headerName: t('reports.columns.pctIncrease'), width: 140, type: 'rightAligned', valueFormatter: (p) => (p.value == null ? '' : `${Number(p.value).toFixed(1)}%`) },
  ], [sourceLabel, destinationLabel, t]);

  const gridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);

  const chartData = useMemo(() => processed
    .filter((r) => r.delta !== 0)
    .map((r) => ({
      name: r.name,
      delta: r.delta,
      direction: r.direction,
      magnitude: Math.abs(r.delta),
    })), [processed]);

  const totalMagnitude = useMemo(() => chartData.reduce((acc: number, d) => acc + (Number(d.magnitude) || 0), 0), [chartData]);

  const topTotals = useMemo(() => processed.reduce((acc, row) => {
    if (row.direction === 'increase') acc.increase += row.delta;
    if (row.direction === 'decrease') acc.decrease += -row.delta;
    return acc;
  }, { increase: 0, decrease: 0 }), [processed]);

  const increaseShare = useMemo(() => (
    allTotals.grossIncrease > 0 ? (topTotals.increase / allTotals.grossIncrease) * 100 : null
  ), [topTotals.increase, allTotals.grossIncrease]);

  const decreaseShare = useMemo(() => (
    allTotals.grossDecrease > 0 ? (topTotals.decrease / allTotals.grossDecrease) * 100 : null
  ), [topTotals.decrease, allTotals.grossDecrease]);

  const netTitle = allTotals.net >= 0 ? t('reports.opexDelta.netIncrease') : t('reports.opexDelta.netDecrease');
  const topSelectionPrevSum = useMemo(() => processed.reduce((acc: number, r) => acc + (Number(r.previous) || 0), 0), [processed]);
  const topSelectionCurrSum = useMemo(() => processed.reduce((acc: number, r) => acc + (Number(r.current) || 0), 0), [processed]);

  const increaseCount = processed.filter((row) => row.direction === 'increase').length;
  const decreaseCount = processed.filter((row) => row.direction === 'decrease').length;

  const chartTitleKey = (() => {
    if (modes.length === 2) return 'reports.opexDelta.chartTitleChanges';
    if (modes[0] === 'increase') return 'reports.opexDelta.chartTitleIncreases';
    return 'reports.opexDelta.chartTitleDecreases';
  })();

  const countLabel = (() => {
    if (modes.length === 2) {
      return `${increaseCount}+${decreaseCount}`;
    }
    return `${processed.length}`;
  })();

  const countSlug = modes.length === 2 ? `${increaseCount}-${decreaseCount}` : `${processed.length}`;

  const selectionFootnote = (() => {
    if (modes.length === 2) {
      return t('reports.opexDelta.selectionTotals', { inc: formatNumber(topTotals.increase), dec: formatNumber(topTotals.decrease) });
    }
    if (modes[0] === 'increase') {
      return t('reports.opexDelta.totalIncrease', { value: formatNumber(topTotals.increase) });
    }
    return t('reports.opexDelta.totalDecrease', { value: formatNumber(topTotals.decrease) });
  })();

  const chartOptions = useMemo(() => {
    const base = {
      title: { text: t(chartTitleKey, { n: countLabel, type: scopeLabel, source: sourceLabel, destination: destinationLabel }) },
      subtitle: { text: t('reports.opexDelta.shareOfChangeMagnitude') },
      footnote: { text: selectionFootnote },
      data: chartData,
      legend: { enabled: false },
      animation: { enabled: true, duration: 800 },
    };
    if (chartType === 'pie' && modes.length === 1) {
      return {
        ...base,
        series: [
          {
            type: 'pie',
            calloutLabelKey: 'name',
            sectorLabelKey: 'magnitude',
            angleKey: 'magnitude',
            calloutLabel: { offset: 20 },
            sectorLabel: {
              positionOffset: 30,
              formatter: ({ datum, angleKey }: any) => {
                const value = Number(datum[angleKey] || 0);
                const pct = totalMagnitude > 0 ? (value / totalMagnitude) * 100 : 0;
                const shown = Math.round(pct);
                return shown >= 5 ? `${shown}%` : '';
              },
            },
            strokeWidth: 1,
            tooltip: {
              enabled: true,
              renderer: ({ datum }: any) => {
                const magnitude = Number(datum.magnitude || 0);
                const pct = totalMagnitude > 0 ? (magnitude / totalMagnitude) * 100 : 0;
                const changeLabel = datum.direction === 'increase' ? t('reports.opexDelta.increase') : t('reports.opexDelta.decrease');
                return {
                  title: escapeTooltipText(datum.name),
                  data: [
                    { label: changeLabel, value: formatNumber(magnitude) },
                    { label: t('reports.shared.share'), value: `${pct.toFixed(1)}%` },
                  ],
                };
              },
            },
          },
        ],
      };
    }
    return {
      ...base,
      axes: [
        { type: 'category', position: 'left', label: { padding: 8 } },
        {
          type: 'number',
          position: 'bottom',
          label: {
            formatter: ({ value }: { value: number }) => formatNumber(value),
          },
        },
      ],
      series: [
        {
          type: 'bar',
          direction: 'horizontal',
          xKey: 'name',
          yKey: 'delta',
          strokeWidth: 0,
          label: {
            formatter: ({ value }: { value: number }) => formatNumber(value),
          },
          tooltip: {
            enabled: true,
            renderer: ({ datum }: any) => {
              const magnitude = Number(datum.magnitude || 0);
              const pct = totalMagnitude > 0 ? (magnitude / totalMagnitude) * 100 : 0;
              const changeLabel = datum.direction === 'increase' ? t('reports.opexDelta.increase') : t('reports.opexDelta.decrease');
              return {
                title: escapeTooltipText(datum.name),
                data: [
                  { label: changeLabel, value: formatNumber(datum.delta) },
                  { label: t('reports.shared.share'), value: `${pct.toFixed(1)}%` },
                ],
              };
            },
          },
        },
      ],
    };
  }, [chartData, totalMagnitude, chartTitleKey, countLabel, scopeLabel, sourceLabel, destinationLabel, chartType, selectionFootnote, modes.length, t]);

  useEffect(() => {
    const api = gridApiRef.current;
    if (!api) return;
    const setSort = (model: Array<{ colId: string; sort?: 'asc' | 'desc' }>) => {
      if (typeof (api as any).setSortModel === 'function') {
        (api as any).setSortModel(model);
        return;
      }
      if (typeof (api as any).applyColumnState === 'function') {
        (api as any).applyColumnState({
          defaultState: { sort: null },
          state: model.map((item) => ({
            colId: item.colId,
            sort: item.sort ?? null,
          })),
        });
      }
    };
    if (modes.length === 1) {
      setSort([{ colId: 'delta', sort: modes[0] === 'increase' ? 'desc' : 'asc' }]);
      return;
    }
    setSort([]);
  }, [modes, processed]);

  const columnSelectDisabled = yearOptions.length === 0;

  const coverageLabel = (() => {
    if (modes.length === 2) {
      const pieces: string[] = [];
      if (increaseShare != null) pieces.push(t('reports.opexDelta.incValue', { value: `${increaseShare.toFixed(1)}%` }));
      if (decreaseShare != null) pieces.push(t('reports.opexDelta.decValue', { value: `${decreaseShare.toFixed(1)}%` }));
      return pieces.length > 0 ? t('reports.opexDelta.coverageSplit', { detail: pieces.join(' · ') }) : t('reports.opexDelta.coverageNa');
    }
    if (modes[0] === 'increase') {
      return increaseShare == null ? t('reports.opexDelta.coverageNa') : t('reports.opexDelta.coveragePct', { pct: increaseShare.toFixed(1) });
    }
    return decreaseShare == null ? t('reports.opexDelta.coverageNa') : t('reports.opexDelta.coveragePct', { pct: decreaseShare.toFixed(1) });
  })();

  const modeSlug = modes.length === 0 ? 'mode' : modes.slice().sort().join('-');
  const sourceSlug = sourceYear != null && sourceMetric ? `${sourceYear}-${metricFileName(budgetColumns, sourceMetric)}` : 'source';
  const destinationSlug = destinationYear != null && destinationMetric ? `${destinationYear}-${metricFileName(budgetColumns, destinationMetric)}` : 'destination';

  return (
    <ReportLayout
      busy={busy}
      title={t("reports.opexDelta.title")}
      subtitle={t('reports.opexDelta.subtitle', { type: scopeLabel })}
      filters={(
        <Box sx={{
          display: 'flex',
          flexWrap: 'wrap',
          columnGap: { xs: 1, md: 1.5 },
          rowGap: { xs: 1, md: 1.5 },
          alignItems: 'flex-start',
        }}
        >
          <ItemScopeTabs value={scope} onChange={setScope} />
          <BudgetReportFilters filters={reportFilters} />
          <TextField
            select
            size="small"
            label={t("reports.filters.sourceYear")}
            value={sourceYear ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setSourceYear(value === '' ? null : Number(value));
            }}
            disabled={columnSelectDisabled}
            sx={{ minWidth: 160 }}
          >
            {columnSelectDisabled ? (
              <MenuItem value="" disabled>{t("reports.filters.noYearsAvailable")}</MenuItem>
            ) : (
              yearOptions.map((year) => (
                <MenuItem key={`source-year-${year}`} value={year}>{year}</MenuItem>
              ))
            )}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.sourceMetric")}
            value={sourceMetric}
            onChange={(e) => setSourceMetric(e.target.value)}
            disabled={columnSelectDisabled || sourceMetrics.length === 0}
            sx={{ minWidth: 200 }}
          >
            {sourceMetrics.length === 0 ? (
              <MenuItem value="" disabled>{t("reports.filters.noMetricsAvailable")}</MenuItem>
            ) : (
              sourceMetrics.map((metric) => (
                <MenuItem key={`source-metric-${metric}`} value={metric}>{labelForMetric(metric, budgetColumns)}</MenuItem>
              ))
            )}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.destinationYear")}
            value={destinationYear ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setDestinationYear(value === '' ? null : Number(value));
            }}
            disabled={columnSelectDisabled}
            sx={{ minWidth: 160 }}
          >
            {columnSelectDisabled ? (
              <MenuItem value="" disabled>{t("reports.filters.noYearsAvailable")}</MenuItem>
            ) : (
              yearOptions.map((year) => (
                <MenuItem key={`dest-year-${year}`} value={year}>{year}</MenuItem>
              ))
            )}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.destinationMetric")}
            value={destinationMetric}
            onChange={(e) => setDestinationMetric(e.target.value)}
            disabled={columnSelectDisabled || destinationMetrics.length === 0}
            sx={{ minWidth: 200 }}
          >
            {destinationMetrics.length === 0 ? (
              <MenuItem value="" disabled>{t("reports.filters.noMetricsAvailable")}</MenuItem>
            ) : (
              destinationMetrics.map((metric) => (
                <MenuItem key={`dest-metric-${metric}`} value={metric}>{labelForMetric(metric, budgetColumns)}</MenuItem>
              ))
            )}
          </TextField>
          <TextField
            size="small"
            type="number"
            label={t("reports.filters.topCount")}
            value={topCount}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10);
              setTopCount(Number.isNaN(next) ? 1 : Math.max(1, next));
            }}
            inputProps={{ min: 1, step: 1 }}
          />
          <TextField
            select
            size="small"
            label={t("reports.filters.chartType")}
            value={chartType}
            onChange={(e) => setChartType(e.target.value as 'pie' | 'bar')}
            helperText={modes.length === 2 ? t('reports.opexDelta.pieAvailableHint') : undefined}
          >
            <MenuItem value="pie" disabled={modes.length === 2}>{t("reports.filters.pieChart")}</MenuItem>
            <MenuItem value="bar">{t("reports.filters.horizontalBarChart")}</MenuItem>
          </TextField>
          <ReportExclusionPicker
            label={t('reports.filters.excludeItems')}
            placeholder={t('reports.filters.excludeItemsPlaceholder')}
            selectedText={(count) => t('reports.filters.itemSelected', { count })}
            noOptionsText={t('reports.filters.noMatchingItems')}
            options={itemOptions.options}
            loading={itemOptions.loading}
            onFirstOpen={() => setItemsWanted(true)}
            value={excludedIds}
            onChange={setExcludedIds}
          />
          <ReportExclusionPicker
            label={t('reports.filters.excludeAccounts')}
            placeholder={t('reports.filters.excludeAccountsPlaceholder')}
            selectedText={(count) => t('reports.filters.accountSelected', { count })}
            noOptionsText={t('reports.filters.noMatchingAccounts')}
            options={accountOptions.options?.map((option) => ({ id: option.id, label: option.name }))}
            loading={accountOptions.loading}
            onFirstOpen={() => setAccountsWanted(true)}
            value={excludedAccounts}
            onChange={setExcludedAccounts}
          />
          <Tabs
            value={direction}
            onChange={(_, next: Direction) => setDirection(next)}
            aria-label={t('reports.opexDelta.directionToggle')}
            sx={[textTabsSx, { alignSelf: 'center' }]}
          >
            <Tab value="increase" label={t('reports.opexDelta.increases')} sx={textTabSx(direction === 'increase')} />
            <Tab value="decrease" label={t('reports.opexDelta.decreases')} sx={textTabSx(direction === 'decrease')} />
            <Tab value="both" label={t('reports.opexDelta.both')} sx={textTabSx(direction === 'both')} />
          </Tabs>
        </Box>
      )}
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
      onExportChartPng={() => {
        const increaseSlug = `inc${increaseCount}`;
        const decreaseSlug = `dec${decreaseCount}`;
        chartRef.current?.download(`top${countSlug}-${scope}-delta-${sourceSlug}-to-${destinationSlug}-${modeSlug}-${increaseSlug}-${decreaseSlug}-${chartType}`);
      }}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={520} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>{t("reports.shared.keyTable")}</Typography>
          <ReportGrid
            rowData={processed}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={(e) => { gridApiRef.current = e.api; }}
            domLayout="autoHeight"
          />
          <Box sx={{ mt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2" color="text.secondary">
                {modes.length === 2
                  ? t('reports.opexDelta.topSelectionTotals', { inc: increaseCount, dec: decreaseCount })
                  : t(modes[0] === 'increase' ? 'reports.opexDelta.topTotalIncrease' : 'reports.opexDelta.topTotalDecrease', { count: processed.length })}
              </Typography>
              <Typography variant="subtitle2">
                {modes.length === 2
                  ? `${t('reports.opexDelta.incValue', { value: formatNumber(topTotals.increase) })} · ${t('reports.opexDelta.decValue', { value: formatNumber(topTotals.decrease) })}`
                  : formatNumber(modes[0] === 'increase' ? topTotals.increase : topTotals.decrease)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('reports.opexDelta.sourceDestinationTotals', { source: formatNumber(topSelectionPrevSum), destination: formatNumber(topSelectionCurrSum) })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2" color="text.secondary">
                {modes.length === 2
                  ? t('reports.opexDelta.grossChanges')
                  : t(modes[0] === 'increase' ? 'reports.opexDelta.grossIncrease' : 'reports.opexDelta.grossDecrease')}
              </Typography>
              <Typography variant="subtitle2">
                {modes.length === 2
                  ? `${t('reports.opexDelta.incValue', { value: formatNumber(allTotals.grossIncrease) })} · ${t('reports.opexDelta.decValue', { value: formatNumber(allTotals.grossDecrease) })}`
                  : formatNumber(modes[0] === 'increase' ? allTotals.grossIncrease : allTotals.grossDecrease)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {coverageLabel}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2" color="text.secondary">{netTitle}</Typography>
              <Typography variant="subtitle2">{formatNumber(allTotals.net)}</Typography>
            </Box>
          </Box>
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError || yearsQuery.isError} onRetry={() => { report.refetch(); void yearsQuery.refetch(); }} />
    </ReportLayout>
  );
}
