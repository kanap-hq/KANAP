import React, { useMemo, useRef, useState } from 'react';
import { Box, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { readTrend, trendRequest, type MetricKey } from './reportAggregates';
import { useBudgetAggregate } from './useBudgetAggregate';
import { useTranslation } from 'react-i18next';
import { metricFileName, useReportMetrics } from './reportMetrics';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function CapexBudgetTrendReport() {
  const { t } = useTranslation(["ops"]);
  const now = new Date();
  const Y = now.getFullYear();
  const allowedYears = [Y - 2, Y - 1, Y, Y + 1, Y + 2];
  // The years read set the window: the lines still active on 1 January of Y-2.
  const reportFilters = useBudgetReportFilters({ scope: 'capex', years: allowedYears });

  const [startYear, setStartYear] = useState<number>(Y - 1);
  const [endYear, setEndYear] = useState<number>(Y + 1);
  const budgetColumns = useBudgetColumns();
  const [metrics, setMetrics] = useReportMetrics(budgetColumns);

  const years = useMemo(() => allowedYears.filter((yr) => yr >= startYear && yr <= endYear), [allowedYears, startYear, endYear]);
  const metricLabels = useMemo(
    () => Object.fromEntries(budgetColumns.all.map((column) => [column.key, column.label])) as Record<string, string>,
    [budgetColumns],
  );

  // One total per column and year of the range, over the lines the filter bar keeps.
  const request = useMemo(() => (reportFilters.queryFilters == null ? null : trendRequest({
    years,
    metrics: metrics as MetricKey[],
    windowYears: allowedYears,
    filters: reportFilters.queryFilters,
  })), [reportFilters.queryFilters, years, metrics]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useBudgetAggregate('capex', request, { keepPrevious: true });
  // Loading, the filter bar still reading its address, or the last answer kept while the new one loads.
  const busy = reportFilters.queryFilters == null || report.isLoading || report.isPlaceholderData;
  const totalsByMetricAndYear = useMemo(() => readTrend({ years, metrics: metrics as MetricKey[] }, report.data), [years, metrics, report.data]);

  const tableRows = useMemo(() => {
    return metrics.map((m) => {
      const row: any = { metric: metricLabels[m], _key: m };
      for (const yr of years) row[yr] = totalsByMetricAndYear[m]?.[yr] || 0;
      return row;
    });
  }, [metrics, metricLabels, years, totalsByMetricAndYear]);

  const columns = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      { field: 'metric', headerName: t('reports.filters.metric'), flex: 1, minWidth: 200 },
    ];
    for (const yr of years) {
      cols.push({ field: String(yr), headerName: String(yr), width: 140, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) });
    }
    return cols;
  }, [years]);

  const chartData = useMemo(() => {
    return years.map((yr) => {
      const row: any = { year: yr };
      for (const m of metrics) row[m] = totalsByMetricAndYear[m]?.[yr] || 0;
      return row;
    });
  }, [years, metrics, totalsByMetricAndYear]);

  const chartSeries = useMemo(() => metrics.map((m) => ({ type: 'line', xKey: 'year', yKey: m, yName: metricLabels[m] })), [metrics, metricLabels]);
  const chartRef = useRef<ChartCardHandle>(null);
  const gridApiRef = useRef<any>(null);

  const chartOptions = useMemo(() => ({
    title: { text: t('reports.budgetTrendCapex.title') },
    subtitle: { text: metrics.map((m) => metricLabels[m]).join(' • ') },
    data: chartData,
    series: chartSeries,
    axes: [
      { type: 'category', position: 'bottom' },
      { type: 'number', position: 'left' },
    ],
    legend: { enabled: true },
  }), [chartData, chartSeries, metrics, metricLabels, t]);

  return (
    <ReportLayout
      busy={busy}
      title={t("reports.budgetTrendCapex.title")}
      subtitle={t("reports.budgetTrendCapex.subtitle")}
      filters={(
        <>
          <BudgetReportFilters filters={reportFilters} />
          <TextField select size="small" label={t("reports.filters.startYear")} value={startYear} onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setStartYear(v);
            if (v > endYear) setEndYear(v);
          }}>
            {allowedYears.map((yr) => (<MenuItem key={yr} value={yr}>{yr}</MenuItem>))}
          </TextField>
          <TextField select size="small" label={t("reports.filters.endYear")} value={endYear} onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setEndYear(v);
            if (v < startYear) setStartYear(v);
          }}>
            {allowedYears.map((yr) => (<MenuItem key={yr} value={yr}>{yr}</MenuItem>))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.metrics")}
            value={metrics}
            SelectProps={{ multiple: true, renderValue: (sel: any) => (sel as string[]).map((s) => metricLabels[s]).join(', ') }}
            onChange={(e) => {
              const value = e.target.value as unknown as string[];
              const arr = Array.isArray(value) ? value : [value];
              setMetrics(arr);
            }}
            sx={{ minWidth: 240 }}
          >
            {budgetColumns.shown.map((column) => (
              <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>
            ))}
          </TextField>
        </>
      )}
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
      onExportChartPng={() => chartRef.current?.download(`capex-trend-${years[0]}-${years[years.length - 1]}-${metrics.map((m) => metricFileName(budgetColumns, m)).join('_')}`)}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={520} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>{t("reports.shared.keyTable")}</Typography>
          <ReportGrid
            wrapperSx={{ height: 360 }}
            rowData={tableRows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={(e) => { gridApiRef.current = e.api; }}
          />
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
