import React, { useMemo, useRef, useState } from 'react';
import { Box, IconButton, MenuItem, Paper, Stack, TextField, Typography, Button, Checkbox, FormControlLabel } from '@mui/material';
import DeleteIcon from '@mui/icons-material/RemoveCircleOutline';
import AddIcon from '@mui/icons-material/Add';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import ReportDataStatus from '../../components/reports/ReportDataStatus';
import { MetricKey, metricKeys, resolveMetric } from './reportMetrics';
import { columnsCompareRequest, readColumnsCompare } from './reportAggregates';
import { useBudgetAggregate } from './useBudgetAggregate';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { useTranslation } from 'react-i18next';

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

type ItemType = 'opex' | 'capex';

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
  const [itemType, setItemType] = useState<ItemType>('opex');
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
  const sortedSelections = useMemo(() => {
    return [...selections].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return metricKeys.indexOf(a.metric) - metricKeys.indexOf(b.metric);
    });
  }, [selections]);

  // One total per year and column picked, over the lines the filter bar keeps.
  const request = useMemo(
    () => (reportFilters.queryFilters == null ? null : columnsCompareRequest({ selections: sortedSelections, filters: reportFilters.queryFilters })),
    [reportFilters.queryFilters, sortedSelections],
  );
  const report = useBudgetAggregate(itemType, request, { keepPrevious: true });
  const selectionTotals = useMemo(() => readColumnsCompare(sortedSelections, report.data), [sortedSelections, report.data]);
  // Loading, the filter bar still reading its address, or the last answer kept while the new one loads.
  const busy = reportFilters.queryFilters == null || report.isLoading || report.isPlaceholderData;

  type TableRow = { key: string; selection: string; year: number; column: string; total: number };
  const tableRows = useMemo<TableRow[]>(() => {
    return sortedSelections.map((sel, idx) => {
      const total = selectionTotals[idx] ?? 0;
      const label = `${sel.year} ${metricLabels[sel.metric]}`;
      return { key: `${sel.year}-${sel.metric}-${idx}`, selection: label, year: sel.year, column: metricLabels[sel.metric], total };
    });
  }, [sortedSelections, selectionTotals, metricLabels]);

  const columns = useMemo<ColDef[]>(() => ([
    { field: 'selection', headerName: t('reports.columns.selection'), flex: 1, minWidth: 200 },
    { field: 'year', headerName: t('reports.filters.year'), width: 120 },
    { field: 'column', headerName: t('reports.filters.column'), width: 160 },
    { field: 'total', headerName: t('reports.columns.total'), width: 160, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) },
  ]), []);

  const chartData = useMemo(() => tableRows.map((r) => ({ selection: r.selection, total: r.total })), [tableRows]);
  const chartRef = useRef<ChartCardHandle>(null);
  const gridApiRef = useRef<any>(null);

  // Determine if grouping by metric across years is applicable
  const metricsInUse = useMemo(() => Array.from(new Set(sortedSelections.map((s) => s.metric))) as MetricKey[], [sortedSelections]);
  const distinctYearCountByMetric = useMemo(() => {
    const m = new Map<MetricKey, Set<number>>();
    for (const sel of sortedSelections) {
      if (!m.has(sel.metric)) m.set(sel.metric, new Set<number>());
      m.get(sel.metric)!.add(sel.year);
    }
    const out = new Map<MetricKey, number>();
    for (const key of m.keys()) out.set(key, m.get(key)!.size);
    return out;
  }, [sortedSelections]);
  const groupingEligible = useMemo(() => {
    if (!yearGrouping) return false;
    if (metricsInUse.length === 0) return false;
    for (const m of metricsInUse) {
      const count = distinctYearCountByMetric.get(m) || 0;
      if (count < 2) return false;
    }
    return true;
  }, [yearGrouping, metricsInUse, distinctYearCountByMetric]);

  // Build grouped data when eligible
  const groupedYears = useMemo(() => Array.from(new Set(sortedSelections.map((s) => s.year))).sort((a, b) => a - b), [sortedSelections]);
  const totalsByMetricYear = useMemo(() => {
    const map = new Map<string, number>(); // key: `${year}:${metric}`
    // A year and column picked twice adds up twice, as the table lists it twice.
    sortedSelections.forEach((sel, idx) => {
      const key = `${sel.year}:${sel.metric}`;
      map.set(key, (map.get(key) || 0) + (selectionTotals[idx] ?? 0));
    });
    return map;
  }, [sortedSelections, selectionTotals]);

  const groupedChartData = useMemo(() => {
    return groupedYears.map((year) => {
      const row: any = { year };
      for (const m of metricKeys) {
        if (!metricsInUse.includes(m)) continue;
        const key = `${year}:${m}`;
        row[m] = totalsByMetricYear.has(key) ? totalsByMetricYear.get(key) : null;
      }
      return row;
    });
  }, [groupedYears, metricsInUse, totalsByMetricYear]);

  const chartOptions = useMemo(() => {
    if (groupingEligible) {
      return {
        title: { text: t('reports.budgetColumnsCompare.title') },
        subtitle: { text: t('reports.budgetColumnsCompare.yearGroupingSubtitle', { type: t(`operations.scope.${itemType}`) }) },
        data: groupedChartData,
        axes: [
          { type: 'number', position: 'bottom' },
          { type: 'number', position: 'left' },
        ],
        legend: { enabled: true },
        series: metricsInUse.map((m) => ({ type: 'line', xKey: 'year', yKey: m, yName: metricLabels[m] })),
      } as any;
    }
    return {
      title: { text: t('reports.budgetColumnsCompare.title') },
      subtitle: { text: t('reports.budgetColumnsCompare.selectionsSubtitle', { type: t(`operations.scope.${itemType}`), count: selections.length }) },
      data: chartData,
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left' },
      ],
      legend: { enabled: false },
      series: [
        { type: 'line', xKey: 'selection', yKey: 'total', yName: t('reports.columns.total') },
      ],
    } as any;
  }, [groupingEligible, itemType, groupedChartData, metricsInUse, metricLabels, selections.length, chartData, t]);

  // Grouped table (reflects year grouping) or flat table (per selection)
  const groupedTableRows = useMemo(() => {
    if (!groupingEligible) return [] as any[];
    return groupedYears.map((year) => {
      const row: any = { year };
      for (const m of metricsInUse) {
        const key = `${year}:${m}`;
        row[m] = totalsByMetricYear.has(key) ? totalsByMetricYear.get(key) : null;
      }
      return row;
    });
  }, [groupingEligible, groupedYears, metricsInUse, totalsByMetricYear]);

  const groupedColumns = useMemo<ColDef[]>(() => {
    if (!groupingEligible) return [];
    const cols: ColDef[] = [
      { field: 'year', headerName: t('reports.filters.year'), width: 120 },
    ];
    for (const m of metricsInUse) {
      cols.push({ field: m, headerName: metricLabels[m], width: 160, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) });
    }
    return cols;
  }, [groupingEligible, metricsInUse, metricLabels]);

  const MAX_SELECTIONS = 10;
  const canAdd = selections.length < MAX_SELECTIONS;

  return (
    <ReportLayout
      busy={busy}
      title={t("reports.budgetColumnsCompare.title")}
      subtitle={t("reports.budgetColumnsCompare.subtitle")}
      filters={(
        <>
          <TextField
            select
            size="small"
            label={t("reports.filters.itemType")}
            value={itemType}
            onChange={(e) => setItemType((e.target.value as ItemType) || 'opex')}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="opex">{t('operations.scope.opex')}</MenuItem>
            <MenuItem value="capex">{t('operations.scope.capex')}</MenuItem>
          </TextField>
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
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
      onExportChartPng={() => chartRef.current?.download(`budget-columns-compare-${itemType}`)}
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
            rowData={groupingEligible ? groupedTableRows : tableRows}
            columnDefs={groupingEligible ? groupedColumns : columns}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={(e) => { gridApiRef.current = e.api; }}
          />
        </Paper>
      </Stack>
      <ReportDataStatus loading={busy} error={report.isError} onRetry={() => void report.refetch()} />
    </ReportLayout>
  );
}
