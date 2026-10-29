import React, { useMemo, useRef, useState } from 'react';
import { Box, IconButton, MenuItem, Paper, Stack, TextField, Typography, Button, Checkbox, FormControlLabel } from '@mui/material';
import DeleteIcon from '@mui/icons-material/RemoveCircleOutline';
import AddIcon from '@mui/icons-material/Add';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { MetricKey, resolveMetric } from './reportMetrics';
import { columnsCompareRequest } from './reportAggregates';
import { columnsCompareTable, columnsInUse, sortColumnSelections } from './reportTables';
import { useReportTableLabels } from './useReportTableLabels';
import { useReportScope } from './useReportScope';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { useBudgetAggregate } from './useBudgetAggregate';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { useTranslation } from 'react-i18next';
import { ReportFteNotice, ReportMeasureSelect, useMeasureText, useReportMeasure } from './reportMeasure';

type Selection = {
  year: number;
  metric: MetricKey;
};

/** A selection as picked: no column yet means the default column. */
type PickedSelection = {
  year: number;
  metric: MetricKey | null;
};

export default function BudgetColumnsCompareReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const metricLabels = useMemo(
    () => Object.fromEntries(budgetColumns.all.map((column) => [column.key, column.label])) as Record<MetricKey, string>,
    [budgetColumns],
  );
  const now = new Date();
  const Y = now.getFullYear();
  const allowedYears = [Y - 2, Y - 1, Y, Y + 1, Y + 2];
  const [itemType, setItemType] = useReportScope();
  const [measure, setMeasure] = useReportMeasure();
  const measureText = useMeasureText(measure);
  const formatNumber = measureText.format;
  const totalLabel = measureText.fte ? t('reports.measure.totalFte') : t('reports.columns.total');
  const tableLabels = useReportTableLabels();
  const [picked, setSelections] = useState<PickedSelection[]>([
    { year: Y, metric: null },
    { year: Y + 1, metric: null },
  ]);
  // A column not picked yet, or hidden since, is the default column.
  const selections = useMemo<Selection[]>(
    () => picked.map((sel) => ({ year: sel.year, metric: resolveMetric(budgetColumns, sel.metric) })),
    [picked, budgetColumns],
  );
  const [yearGrouping, setYearGrouping] = useState<boolean>(false);

  // The years picked set the window: the lines still active on 1 January of the earliest one.
  const yearsNeeded = useMemo(() => Array.from(new Set(selections.map((s) => s.year))).sort((a, b) => a - b), [selections]);
  const reportFilters = useBudgetReportFilters({ scope: itemType, years: yearsNeeded });

  // Sort selections chronologically for display (chart and table)
  const sortedSelections = useMemo(() => sortColumnSelections(selections), [selections]);

  // One total per year and column picked, over the lines the filter bar keeps. The columns not picked
  // yet are the tenant default: wait for the setting, or the product default is asked first.
  const request = useMemo(
    () => (!budgetColumns.ready || reportFilters.queryFilters == null ? null : columnsCompareRequest({ selections: sortedSelections, filters: reportFilters.queryFilters, measure })),
    [budgetColumns.ready, reportFilters.queryFilters, sortedSelections, measure],
  );
  const report = useBudgetAggregate(itemType, request, { keepPrevious: true });
  // Loading, the column setting or the filter bar still unread, or the last answer kept while the new one loads.
  const busy = !budgetColumns.ready || reportFilters.queryFilters == null || report.isLoading || report.isPlaceholderData;

  // The key table (`reportTables.ts`, the same code as the export): one row per selection, or per year
  // when year grouping applies. FTE: a year and column nobody declares is null (an empty cell, no point).
  const table = useMemo(
    () => columnsCompareTable({ selections: sortedSelections, measure, yearGrouping }, report.data, tableLabels),
    [sortedSelections, measure, yearGrouping, report.data, tableLabels],
  );
  const groupingEligible = table.grouped;
  const metricsInUse = useMemo(() => columnsInUse(sortedSelections), [sortedSelections]);

  const columns = useMemo<ColDef[]>(() => table.columns.map((column): ColDef => {
    if (column.key === 'selection') return { field: column.key, headerName: column.header, flex: 1, minWidth: 200 };
    if (column.key === 'year') return { field: column.key, headerName: column.header, width: 120 };
    if (column.key === 'column') return { field: column.key, headerName: column.header, width: 160 };
    return { field: column.key, headerName: column.header, width: 160, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) };
  }), [table, formatNumber]);

  const chartData = useMemo(() => (table.grouped ? [] : table.rows.map((r) => ({ selection: r.selection, total: r.total }))), [table]);
  const chartRef = useRef<ChartCardHandle>(null);

  // Grouped by year, the chart reads the table's rows: one per year, one field per column in use.
  const groupedChartData = useMemo(() => (table.grouped ? table.rows : []), [table]);

  // FTE: the value axis names the measure and reads FTE.
  const valueAxis = useMemo(() => ({
    type: 'number',
    position: 'left',
    ...(measureText.axisTitle ? { title: measureText.axisTitle, label: { formatter: ({ value }: { value: number }) => formatNumber(value) } } : {}),
  }), [measureText, formatNumber]);

  const chartOptions = useMemo(() => {
    if (groupingEligible) {
      return {
        title: { text: measureText.chartTitle(t('reports.budgetColumnsCompare.title')) },
        subtitle: { text: t('reports.budgetColumnsCompare.yearGroupingSubtitle', { type: t(`operations.scope.${itemType}`), context: itemType }) },
        data: groupedChartData,
        axes: [
          { type: 'number', position: 'bottom' },
          valueAxis,
        ],
        legend: { enabled: true },
        series: metricsInUse.map((m) => ({ type: 'line', xKey: 'year', yKey: m, yName: measureText.column(metricLabels[m]) })),
      } as any;
    }
    return {
      title: { text: measureText.chartTitle(t('reports.budgetColumnsCompare.title')) },
      subtitle: { text: t('reports.budgetColumnsCompare.selectionsSubtitle', { type: t(`operations.scope.${itemType}`), context: itemType, count: selections.length }) },
      data: chartData,
      axes: [
        { type: 'category', position: 'bottom' },
        valueAxis,
      ],
      legend: { enabled: false },
      series: [
        { type: 'line', xKey: 'selection', yKey: 'total', yName: totalLabel },
      ],
    } as any;
  }, [groupingEligible, itemType, groupedChartData, metricsInUse, metricLabels, selections.length, chartData, valueAxis, measureText, totalLabel, t]);

  const MAX_SELECTIONS = 10;
  const canAdd = selections.length < MAX_SELECTIONS;

  return (
    <ReportLayout
      busy={busy}
      fxMissing={report.data?.fxMissing}
      title={t("reports.budgetColumnsCompare.title")}
      subtitle={t("reports.budgetColumnsCompare.subtitle")}
      filters={(
        <>
          <ItemScopeTabs allowAll value={itemType} onChange={setItemType} />
          <ReportMeasureSelect value={measure} onChange={setMeasure} />
          <BudgetReportFilters filters={reportFilters} />

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', minWidth: 300 }}>
            {selections.map((sel, idx) => (
              <Box key={`${sel.year}-${sel.metric}-${idx}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5 }}>
                <TextField
                  select
                  size="small"
                  label={t('reports.filters.year')}
                  value={sel.year}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setSelections((prev) => prev.map((it, i) => (i === idx ? { ...it, year: v } : it)));
                  }}
                  sx={{ minWidth: 92 }}
                >
                  {allowedYears.map((yr) => (<MenuItem key={yr} value={yr}>{yr}</MenuItem>))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t('reports.filters.column')}
                  value={sel.metric}
                  onChange={(e) => {
                    const v = e.target.value as MetricKey;
                    setSelections((prev) => prev.map((it, i) => (i === idx ? { ...it, metric: v } : it)));
                  }}
                  sx={{ minWidth: 140 }}
                >
                  {budgetColumns.shown.map((column) => (
                    <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>
                  ))}
                </TextField>
                <IconButton size="small" aria-label={t("common:buttons.remove")} disabled={selections.length <= 1} onClick={() => {
                  setSelections((prev) => prev.filter((_, i) => i !== idx));
                }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Button size="small" startIcon={<AddIcon />} disabled={!canAdd} onClick={() => setSelections((prev) => prev.concat({ year: Y, metric: null }))}>
              {t('reports.budgetColumnsCompare.addSelection')}
            </Button>
          </Box>
        </>
      )}
      tableExport={{
        url: '/reports/budget/columns-compare/export',
        params: {
          scope: itemType,
          measure,
          ...reportFilters.exportParams,
          selections: sortedSelections.map((sel) => `${sel.year}:${sel.metric}`).join(','),
          yearGrouping: yearGrouping ? 'true' : 'false',
        },
        fileBase: measureText.fileName(`budget-columns-compare-${itemType}`),
      }}
      onExportChartPng={() => chartRef.current?.download(measureText.fileName(`budget-columns-compare-${itemType}`))}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box className="report-print-hide">
          <FormControlLabel
            control={<Checkbox checked={yearGrouping} onChange={(e) => setYearGrouping(e.target.checked)} />}
            label={t("reports.filters.yearGrouping")}
          />
        </Box>
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
          <ReportFteNotice scope={itemType} request={request} result={report.data} columnLabel={(column) => `${metricLabels[column.metric]} ${column.year}`} />
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
