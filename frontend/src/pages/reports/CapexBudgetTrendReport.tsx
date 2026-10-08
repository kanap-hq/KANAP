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
import { ReportFteNotice, ReportMeasureSelect, useMeasureText, useReportMeasure } from './reportMeasure';

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
  const [measure, setMeasure] = useReportMeasure();
  const measureText = useMeasureText(measure);
  const formatNumber = measureText.format;
  // FTE: a year and column nobody declares stays blank, never a 0 (an empty cell, no point).
  const cell = (value: number | null | undefined) => (measureText.fte ? value ?? null : value || 0);

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
    measure,
  })), [reportFilters.queryFilters, years, metrics, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useBudgetAggregate('capex', request, { keepPrevious: true });
  // Loading, the filter bar still reading its address, or the last answer kept while the new one loads.
  const busy = reportFilters.queryFilters == null || report.isLoading || report.isPlaceholderData;
  const totalsByMetricAndYear = useMemo(() => readTrend({ years, metrics: metrics as MetricKey[] }, report.data, measure), [years, metrics, report.data, measure]);

  const tableRows = useMemo(() => {
    return metrics.map((m) => {
      const row: any = { metric: measureText.column(metricLabels[m]), _key: m };
      for (const yr of years) row[yr] = cell(totalsByMetricAndYear[m]?.[yr]);
      return row;
    });
  }, [metrics, metricLabels, years, totalsByMetricAndYear, measureText]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      { field: 'metric', headerName: t('reports.filters.metric'), flex: 1, minWidth: 200 },
    ];
    for (const yr of years) {
      cols.push({ field: String(yr), headerName: String(yr), width: 140, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) });
    }
    return cols;
  }, [years, formatNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartData = useMemo(() => {
    return years.map((yr) => {
      const row: any = { year: yr };
      for (const m of metrics) row[m] = cell(totalsByMetricAndYear[m]?.[yr]);
      return row;
    });
  }, [years, metrics, totalsByMetricAndYear, measureText]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartSeries = useMemo(
    () => metrics.map((m) => ({ type: 'line', xKey: 'year', yKey: m, yName: measureText.column(metricLabels[m]) })),
    [metrics, metricLabels, measureText],
  );
  const chartRef = useRef<ChartCardHandle>(null);
  const gridApiRef = useRef<any>(null);

  const chartOptions = useMemo(() => ({
    title: { text: measureText.chartTitle(t('reports.budgetTrendCapex.title')) },
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
      title={t("reports.budgetTrendCapex.title")}
      subtitle={t("reports.budgetTrendCapex.subtitle")}
      filters={(
        <>
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
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.(measureText.csvParams(`capex-trend-${years[0]}-${years[years.length - 1]}-${metrics.map((m) => metricFileName(budgetColumns, m)).join('_')}`))}
      onExportChartPng={() => chartRef.current?.download(measureText.fileName(`capex-trend-${years[0]}-${years[years.length - 1]}-${metrics.map((m) => metricFileName(budgetColumns, m)).join('_')}`))}
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
          <ReportFteNotice scope="capex" request={request} result={report.data} columnLabel={(column) => `${metricLabels[column.metric]} ${column.year}`} />
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
