import React, { useMemo, useRef, useState } from 'react';
import { Box, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { trendRequest, type MetricKey } from './reportAggregates';
import { comparisonTable } from './reportTables';
import { useReportTableLabels } from './useReportTableLabels';
import { useBudgetAggregate } from './useBudgetAggregate';
import { useTranslation } from 'react-i18next';
import { metricFileName, useReportMetrics } from './reportMetrics';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { ReportFteNotice, ReportMeasureSelect, useMeasureText, useReportMeasure } from './reportMeasure';

import ItemScopeTabs from '../operations/ItemScopeTabs';
import { useReportScope } from './useReportScope';

export default function ComparisonReport() {
  const { t } = useTranslation(["ops"]);
  const [scope, setScope] = useReportScope();
  const now = new Date();
  const Y = now.getFullYear();
  const allowedYears = [Y - 2, Y - 1, Y, Y + 1, Y + 2];
  // The years read set the window: the lines still active on 1 January of Y-2.
  const reportFilters = useBudgetReportFilters({ scope, years: allowedYears });

  const [startYear, setStartYear] = useState<number>(Y - 1);
  const [endYear, setEndYear] = useState<number>(Y + 1);
  const budgetColumns = useBudgetColumns();
  const [metrics, setMetrics] = useReportMetrics(budgetColumns);
  const [measure, setMeasure] = useReportMeasure();
  const measureText = useMeasureText(measure);
  const formatNumber = measureText.format;
  const tableLabels = useReportTableLabels();

  // Keep range valid and within allowed set
  const years = useMemo(() => allowedYears.filter((yr) => yr >= startYear && yr <= endYear), [allowedYears, startYear, endYear]);
  const metricLabels = useMemo(
    () => Object.fromEntries(budgetColumns.all.map((column) => [column.key, column.label])) as Record<string, string>,
    [budgetColumns],
  );

  // One total per column and year of the range, over the lines the filter bar keeps. The preselected
  // columns follow the tenant default: wait for the setting, or the product default is asked first.
  const request = useMemo(() => (!budgetColumns.ready || reportFilters.queryFilters == null ? null : trendRequest({
    years,
    metrics: metrics as MetricKey[],
    windowYears: allowedYears,
    filters: reportFilters.queryFilters,
    measure,
  })), [budgetColumns.ready, reportFilters.queryFilters, years, metrics, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useBudgetAggregate(scope, request, { keepPrevious: true });
  // Loading, the column setting or the filter bar still unread, or the last answer kept while the new one loads.
  const busy = !budgetColumns.ready || reportFilters.queryFilters == null || report.isLoading || report.isPlaceholderData;
  // The key table (`reportTables.ts`, the same code as the export): one row per column, one column per year.
  const table = useMemo(
    () => comparisonTable({ years, metrics: metrics as MetricKey[], measure }, report.data, tableLabels),
    [years, metrics, measure, report.data, tableLabels],
  );

  const columns = useMemo<ColDef[]>(() => table.columns.map((column) => (column.kind === 'text'
    ? { field: column.key, headerName: column.header, flex: 1, minWidth: 200 }
    : { field: column.key, headerName: column.header, width: 140, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) })), [table, formatNumber]);

  // Chart data: one row per year with each metric as a field
  const chartData = useMemo(() => {
    return years.map((yr) => {
      const row: any = { year: yr };
      metrics.forEach((m, index) => { row[m] = table.rows[index]?.[String(yr)] ?? null; });
      return row;
    });
  }, [years, metrics, table]);

  const chartSeries = useMemo(
    () => metrics.map((m) => ({ type: 'line', xKey: 'year', yKey: m, yName: measureText.column(metricLabels[m]) })),
    [metrics, metricLabels, measureText],
  );
  const chartRef = useRef<ChartCardHandle>(null);

  const chartOptions = useMemo(() => ({
    title: { text: measureText.chartTitle(t('reports.budgetTrendOpex.title')) },
    subtitle: { text: metrics.map((m) => measureText.column(metricLabels[m])).join(' • ') },
    data: chartData,
    series: chartSeries,
    axes: [
      { type: 'category', position: 'bottom' },
      { type: 'number', position: 'left', ...(measureText.axisTitle ? { title: measureText.axisTitle, label: { formatter: ({ value }: { value: number }) => formatNumber(value) } } : {}) },
    ],
    legend: { enabled: true },
  }), [chartData, chartSeries, metrics, metricLabels, measureText, formatNumber, t]);

  return (
    <ReportLayout
      busy={busy}
      fxMissing={report.data?.fxMissing}
      title={t("reports.budgetTrendOpex.title")}
      subtitle={t("reports.budgetTrendOpex.subtitle")}
      filters={(
        <>
          <ItemScopeTabs allowAll value={scope} onChange={setScope} />
          <ReportMeasureSelect value={measure} onChange={setMeasure} />
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
      tableExport={{
        url: '/reports/budget/comparison/export',
        params: { scope, measure, ...reportFilters.exportParams, startYear, endYear, metrics: metrics.join(',') },
        fileBase: measureText.fileName(`comparison-${scope}-${startYear}-${endYear}`),
      }}
      onExportChartPng={() => chartRef.current?.download(measureText.fileName(`comparison-${years[0]}-${years[years.length - 1]}-${metrics.map((m) => metricFileName(budgetColumns, m)).join('_')}`))}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={520} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>{t("reports.shared.keyTable")}</Typography>
          <ReportGrid
            wrapperSx={{ height: 360 }}
            rowData={table.rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true }}
          />
          <ReportFteNotice scope={scope} request={request} result={report.data} columnLabel={(column) => `${metricLabels[column.metric]} ${column.year}`} />
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
