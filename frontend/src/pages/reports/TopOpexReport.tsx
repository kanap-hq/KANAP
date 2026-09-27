import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete, Box, Checkbox, ListItemText, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import { BudgetSummaryRow, itemName, pickSlot, useBudgetSummaryAll, useReportScope } from './useBudgetSummaryAll';
import { metricFileName, MetricKey, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { useTranslation } from 'react-i18next';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function TopOpexReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const now = new Date();
  const Y = now.getFullYear();
  const [year, setYear] = useState<number>(Y);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  const [topCount, setTopCount] = useState<number>(10);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [excludedAccounts, setExcludedAccounts] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'pie' | 'bar'>('pie');
  const metricLabel = budgetColumns.label(metric);
  const [scope, setScope] = useReportScope();
  const scopeLabel = t(`operations.scope.${scope}`);

  const { data: allRows, isLoading } = useBudgetSummaryAll(scope);
  const reportFilters = useBudgetReportFilters();
  // Totals and shares read the kept lines only; the exclusion pickers still offer every line.
  const rows = useMemo(() => reportFilters.filterRows(allRows), [allRows, reportFilters.filterRows]);
  // Lines and the accounts they use differ between OPEX and CAPEX: a type switch drops both exclusions.
  useEffect(() => {
    setExcludedIds([]);
    setExcludedAccounts([]);
  }, [scope]);

  type ProcessedRow = {
    id: string;
    name: string;
    value: number;
    pct_of_total: number;
  };

  type RawRow = {
    id: string;
    name: string;
    value: number;
    account_display: string | null;
  };

  type ItemOption = { id: string; name: string };
  type AccountOption = { id: string; name: string };

  const { processed, totalMetric, topSelectionTotal } = useMemo(() => {
    const all: RawRow[] = (rows ?? []).map((r: BudgetSummaryRow) => {
      const slot = pickSlot(r, year);
      const totals = (slot?.reporting ?? slot?.totals) as Record<string, number | undefined> | undefined;
      const value = Number(totals?.[metric] ?? 0);
      return { id: r.id, name: itemName(scope, r), value, account_display: r.account_display ?? null };
    });
    const filtered = all.filter((item: RawRow) => {
      if (excludedIds.includes(item.id)) return false;
      if (item.account_display && excludedAccounts.includes(item.account_display)) return false;
      return true;
    });
    const totalMetric = filtered.reduce((acc: number, it: RawRow) => acc + (Number(it.value) || 0), 0);
    const sorted = [...filtered].sort((a: RawRow, b: RawRow) => (b.value - a.value));
    const limit = Number.isFinite(topCount) && topCount > 0 ? Math.floor(topCount) : 1;
    const topEntries = sorted.slice(0, limit);
    const topSelectionTotal = topEntries.reduce((acc: number, it: RawRow) => acc + (Number(it.value) || 0), 0);
    const processed = topEntries.map<ProcessedRow>((r) => ({
      id: r.id,
      name: r.name,
      value: r.value,
      pct_of_total: totalMetric > 0 ? Math.round((r.value / totalMetric) * 100) : 0,
    }));
    return { processed, totalMetric, topSelectionTotal };
  }, [rows, scope, year, excludedIds, excludedAccounts, topCount, metric]);

  const itemOptions = useMemo<ItemOption[]>(() => (allRows ?? [])
    .map((r: BudgetSummaryRow) => ({ id: r.id, name: itemName(scope, r) }))
    .sort((a: ItemOption, b: ItemOption) => a.name.localeCompare(b.name)), [allRows, scope]);

  const selectedItemOptions = useMemo<ItemOption[]>(() => {
    if (excludedIds.length === 0) return [];
    const lookup = new Map<string, ItemOption>(itemOptions.map((option) => [option.id, option]));
    return excludedIds
      .map((id) => lookup.get(id))
      .filter((option): option is ItemOption => Boolean(option));
  }, [excludedIds, itemOptions]);

  const accountOptions = useMemo<AccountOption[]>(() => {
    const seen = new Set<string>();
    const options: AccountOption[] = [];
    for (const row of allRows ?? []) {
      const name = row.account_display?.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      options.push({ id: name, name });
    }
    options.sort((a, b) => a.name.localeCompare(b.name));
    return options;
  }, [allRows]);

  const selectedAccountOptions = useMemo<AccountOption[]>(() => {
    if (excludedAccounts.length === 0) return [];
    const lookup = new Map<string, AccountOption>(accountOptions.map((option) => [option.id, option]));
    return excludedAccounts
      .map((id) => lookup.get(id))
      .filter((option): option is AccountOption => Boolean(option));
  }, [excludedAccounts, accountOptions]);

  const columns = useMemo<ColDef[]>(() => [
    { field: 'name', headerName: t('reports.columns.item'), flex: 1, minWidth: 220 },
    { field: 'value', headerName: `${metricLabel} (${year})`, width: 160, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) },
    { field: 'pct_of_total', headerName: t('reports.columns.shareOfTotal'), width: 160, type: 'rightAligned', valueFormatter: (p) => (p.value != null ? `${p.value}%` : '') },
  ], [year, metricLabel, t]);

  const gridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);

  const chartData = useMemo(() => processed.map((r) => ({ name: r.name, value: r.value })), [processed]);
  const chartOptions = useMemo(() => {
    const base = {
      title: { text: t('reports.topOpex.chartTitle', { count: chartData.length, type: scopeLabel, metric: metricLabel, year }) },
      subtitle: { text: t('reports.topOpex.shareSubtitle', { metric: metricLabel }) },
      footnote: { text: `${t('reports.topOpex.totalMetric', { metric: metricLabel })}: ${formatNumber(totalMetric)}` },
      data: chartData,
      legend: { enabled: false },
      animation: { enabled: true, duration: 800 },
    };
    if (chartType === 'pie') {
      return {
        ...base,
        series: [
          {
            type: 'pie',
            calloutLabelKey: 'name',
            sectorLabelKey: 'value',
            angleKey: 'value',
            calloutLabel: { offset: 20 },
            sectorLabel: {
              positionOffset: 30,
              formatter: ({ datum, angleKey }: any) => {
                const value = Number(datum[angleKey] || 0);
                const pct = totalMetric > 0 ? (value / totalMetric) * 100 : 0;
                const shown = Math.round(pct);
                return shown >= 5 ? `${shown}%` : '';
              },
            },
            strokeWidth: 1,
            tooltip: {
              enabled: true,
              renderer: (params: any) => {
                const { datum, angleKey } = params;
                const value = Number(datum[angleKey] || 0);
                const pct = totalMetric > 0 ? (value / totalMetric) * 100 : 0;
                return {
                  title: escapeTooltipText(datum.name),
                  data: [
                    { label: metricLabel, value: formatNumber(value) },
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
          yKey: 'value',
          strokeWidth: 0,
          label: {
            formatter: ({ value }: { value: number }) => formatNumber(value),
          },
          tooltip: {
            enabled: true,
            renderer: ({ datum }: any) => {
              const value = Number(datum.value || 0);
              const pct = totalMetric > 0 ? (value / totalMetric) * 100 : 0;
              return {
                title: escapeTooltipText(datum.name),
                data: [
                  { label: metricLabel, value: formatNumber(value) },
                  { label: t('reports.shared.share'), value: `${pct.toFixed(1)}%` },
                ],
              };
            },
          },
        },
      ],
    };
  }, [chartData, totalMetric, year, chartType, metricLabel, scopeLabel, t]);

  const selectionSharePct = useMemo(() => (
    totalMetric > 0 ? Math.round((topSelectionTotal / totalMetric) * 100) : null
  ), [topSelectionTotal, totalMetric]);

  return (
    <ReportLayout
      title={t("reports.topOpex.title")}
      subtitle={t('reports.topOpex.subtitle', { type: scopeLabel, metric: metricLabel })}
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
          <BudgetReportFilters filters={reportFilters} rows={allRows} />
          <TextField select size="small" label={t("reports.filters.year")} value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} sx={{ minWidth: 140 }}>
            <MenuItem value={Y - 1}>{Y - 1}</MenuItem>
            <MenuItem value={Y}>{Y}</MenuItem>
            <MenuItem value={Y + 1}>{Y + 1}</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.metric")}
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
            sx={{ minWidth: 180 }}
          >
            {budgetColumns.shown.map((column) => (
              <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>
            ))}
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
            sx={{ minWidth: 150 }}
          />
          <TextField
            select
            size="small"
            label={t("reports.filters.chartType")}
            value={chartType}
            onChange={(e) => setChartType(e.target.value as 'pie' | 'bar')}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="pie">{t("reports.filters.pieChart")}</MenuItem>
            <MenuItem value="bar">{t("reports.filters.horizontalBarChart")}</MenuItem>
          </TextField>
          <Autocomplete
            multiple
            size="small"
            disableCloseOnSelect
            options={itemOptions}
            value={selectedItemOptions}
            onChange={(_, next) => {
              setExcludedIds(next.map((option) => option.id));
            }}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderOption={(props, option, { selected }) => (
              <li {...props}>
                <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                <ListItemText primary={option.name} />
              </li>
            )}
            renderTags={() => []}
            renderInput={(params) => {
              const count = excludedIds.length;
              return (
                <TextField
                  {...params}
                  label={t("reports.filters.excludeItems")}
                  placeholder={count === 0 ? t('reports.filters.excludeItemsPlaceholder') : ''}
                  InputLabelProps={{ shrink: true }}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: count > 0 ? (
                      <>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ ml: 0.5, mr: 1, whiteSpace: 'nowrap' }}
                        >
                          {t('reports.filters.itemSelected', { count })}
                        </Typography>
                        {params.InputProps.startAdornment}
                      </>
                    ) : params.InputProps.startAdornment,
                  }}
                />
              );
            }}
            sx={{ minWidth: 260 }}
            noOptionsText={t("reports.filters.noMatchingItems")}
          />
          <Autocomplete
            multiple
            size="small"
            disableCloseOnSelect
            options={accountOptions}
            value={selectedAccountOptions}
            onChange={(_, next) => {
              setExcludedAccounts(next.map((option) => option.id));
            }}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderOption={(props, option, { selected }) => (
              <li {...props}>
                <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                <ListItemText primary={option.name} />
              </li>
            )}
            renderTags={() => []}
            renderInput={(params) => {
              const count = excludedAccounts.length;
              return (
                <TextField
                  {...params}
                  label={t("reports.filters.excludeAccounts")}
                  placeholder={count === 0 ? t('reports.filters.excludeAccountsPlaceholder') : ''}
                  InputLabelProps={{ shrink: true }}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: count > 0 ? (
                      <>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ ml: 0.5, mr: 1, whiteSpace: 'nowrap' }}
                        >
                          {t('reports.filters.accountSelected', { count })}
                        </Typography>
                        {params.InputProps.startAdornment}
                      </>
                    ) : params.InputProps.startAdornment,
                  }}
                />
              );
            }}
            sx={{ minWidth: 260 }}
            noOptionsText={t("reports.filters.noMatchingAccounts")}
          />
        </Box>
      )}
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
      onExportChartPng={() => chartRef.current?.download(`top${processed.length}-${scope}-${year}-${metricFileName(budgetColumns, metric)}-${chartType}`)}
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
          <Box sx={{ mt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2" color="text.secondary">{t('reports.topOpex.topTotal', { count: processed.length })}</Typography>
              <Typography variant="subtitle2">{formatNumber(topSelectionTotal)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {selectionSharePct == null ? '—' : t('reports.topOpex.ofFilteredMetric', { pct: selectionSharePct })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography variant="body2" color="text.secondary">{t('reports.topOpex.totalMetric', { metric: metricLabel })}</Typography>
              <Typography variant="subtitle2">{formatNumber(totalMetric)}</Typography>
            </Box>
          </Box>
        </Paper>
      </Stack>
      {isLoading && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t("reports.shared.loadingData")}</Typography>
      )}
    </ReportLayout>
  );
}
