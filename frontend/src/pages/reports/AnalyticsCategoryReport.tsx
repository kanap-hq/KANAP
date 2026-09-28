import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete, Box, Checkbox, ListItemText, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import api from '../../api';
import { type BudgetSummaryRow, pickSlot, useBudgetSummaryAll, useReportScope } from './useBudgetSummaryAll';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { BudgetReportFilters, useBudgetReportFilters } from '../../components/reports/BudgetReportFilters';
import { MetricKey, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import type { AnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { ANALYTICS_VALUES_ENDPOINT, analyticsFieldKey, type AnalyticsAxis } from '../../services/analytics';
import { drawerMenuItemSx } from '../../theme/formSx';
import { useTranslation } from 'react-i18next';

type AnalyticsCategory = {
  id: string;
  name: string;
  status?: string | null;
};

type CategoryOption = { id: string; label: string };

/** `?axis=<dimension id>`: the dimension the report groups on. */
const AXIS_PARAM = 'axis';

/**
 * The dimension named in the address when it is enabled, else the default one. Kept in the address
 * with `replace`, like the item type, so a link opens the report on that dimension.
 */
function useReportAxis(axes: AnalyticsAxes): [AnalyticsAxis | null, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(AXIS_PARAM);
  const axis = axes.enabled.find((candidate) => candidate.id === raw) ?? axes.defaultAxis ?? axes.enabled[0] ?? null;
  const setAxis = useCallback((id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(AXIS_PARAM, id);
      return next;
    }, { replace: true });
  }, [setParams]);
  return [axis, setAxis];
}

/**
 * The line's value on the dimension and that value's name. Until the dimensions are known the line's
 * default-dimension value stands in: it is the dimension the report opens on.
 */
function valueOf(row: BudgetSummaryRow, axisId: string | null): { id: string | null; name: string | null } {
  if (!axisId) return { id: row.analytics_category_id ?? null, name: row.analytics_category_name ?? null };
  const name = (row as Record<string, unknown>)[analyticsFieldKey(axisId)];
  return { id: row.analytics_value_ids?.[axisId] ?? null, name: typeof name === 'string' ? name : null };
}

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function AnalyticsCategoryReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const now = new Date();
  const Y = now.getFullYear();
  const allowedYears = [Y - 1, Y, Y + 1];

  const [startYear, setStartYear] = useState<number>(Y);
  const [endYear, setEndYear] = useState<number>(Y);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'pie' | 'bar'>('pie');

  const singleYear = startYear === endYear;
  const years = useMemo(() => allowedYears.filter((yr) => yr >= startYear && yr <= endYear), [allowedYears, startYear, endYear]);

  const [scope, setScope] = useReportScope();
  const scopeLabel = t(`operations.scope.${scope}`);
  const { data: allRows, isLoading } = useBudgetSummaryAll(scope);
  const reportFilters = useBudgetReportFilters();
  const rows = useMemo(() => reportFilters.filterRows(allRows), [allRows, reportFilters.filterRows]);
  const analyticsAxes = reportFilters.analyticsAxes;
  const [axis, setAxis] = useReportAxis(analyticsAxes);
  const axisId = axis?.id ?? null;
  // Headers and the picker take the label; sentences take the name, or a lowercase form for the default
  // dimension without one ("OPEX by analytics dimension").
  const dimensionLabel = axis ? analyticsAxes.label(axis) : t('reports.columns.analyticsCategory');
  const dimensionInSentence = axis?.name?.trim() || t('reports.analyticsCategory.defaultDimensionInSentence');
  // Values belong to one dimension and lines differ between OPEX and CAPEX: either switch drops the exclusions.
  useEffect(() => {
    setExcludedCategories((prev) => (prev.length > 0 ? [] : prev));
  }, [scope, axisId]);
  const { data: categories } = useQuery<AnalyticsCategory[]>({
    queryKey: ['analytics-categories', 'reporting', axisId],
    queryFn: async () => {
      const res = await api.get<{ items: AnalyticsCategory[] }>(ANALYTICS_VALUES_ENDPOINT, {
        params: { axis_id: axisId, limit: 1000, sort: 'name:ASC' },
      });
      return res.data.items;
    },
    enabled: Boolean(axisId),
  });

  const categoryById = useMemo(() => {
    const map = new Map<string, AnalyticsCategory>();
    for (const cat of categories ?? []) {
      map.set(cat.id, cat);
    }
    return map;
  }, [categories]);

  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const map = new Map<string, CategoryOption>();
    for (const cat of categories ?? []) {
      const label = (cat.name ?? '').trim() || t('reports.analyticsCategory.unnamed');
      map.set(cat.id, { id: cat.id, label });
    }
    for (const row of allRows ?? []) {
      const value = valueOf(row, axisId);
      if (!value.id || map.has(value.id)) continue;
      const label = (value.name ?? '').trim() || t('reports.analyticsCategory.unnamed');
      map.set(value.id, { id: value.id, label });
    }
    const list = Array.from(map.values());
    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }, [categories, allRows, axisId, t]);

  const selectedOptions = useMemo<CategoryOption[]>(() => {
    if (excludedCategories.length === 0) return [];
    const lookup = new Map(categoryOptions.map((option) => [option.id, option] as const));
    return excludedCategories
      .map((id) => lookup.get(id))
      .filter((option): option is CategoryOption => Boolean(option));
  }, [excludedCategories, categoryOptions]);

  type Group = {
    key: string;
    label: string;
    values: Record<number, number>;
  };

  const groups = useMemo<Group[]>(() => {
    const acc: Map<string, Group> = new Map();
    const source = rows ?? [];
    const makeKey = (id: string | null | undefined, fallbackName: string | null | undefined): { key: string; label: string } => {
      if (!id) return { key: 'uncategorized', label: t('reports.analyticsCategory.unassigned') };
      const labelFromCatalog = categoryById.get(id)?.name;
      const label = (labelFromCatalog ?? fallbackName ?? '').trim() || t('reports.analyticsCategory.unnamed');
      return { key: `cat_${id}`, label };
    };
    for (const row of source) {
      const value = valueOf(row, axisId);
      const id = value.id;
      if (id && excludedCategories.includes(id)) continue;
      const keyInfo = makeKey(id, value.name);
      let group = acc.get(keyInfo.key);
      if (!group) { group = { key: keyInfo.key, label: keyInfo.label, values: {} }; acc.set(keyInfo.key, group); }
      for (const yr of years) {
        const slot = pickSlot(row, yr);
        const totals = (slot?.reporting ?? slot?.totals) as Record<string, number | undefined> | undefined;
        const total = Number(totals?.[metric] ?? 0);
        group.values[yr] = (group.values[yr] || 0) + total;
      }
    }
    return Array.from(acc.values()).sort((a, b) => {
      const pYear = years[0];
      return (b.values[pYear] || 0) - (a.values[pYear] || 0);
    });
  }, [rows, years, metric, excludedCategories, categoryById, axisId, t]);

  const tableRows = useMemo(() => groups.map((group) => {
    const row: any = { group: group.label };
    for (const yr of years) row[yr] = group.values[yr] || 0;
    return row;
  }), [groups, years]);

  const columns = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      { field: 'group', headerName: dimensionLabel, flex: 1, minWidth: 240 },
    ];
    for (const yr of years) {
      cols.push({ field: String(yr), headerName: String(yr), width: 140, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) });
    }
    return cols;
  }, [years, dimensionLabel]);

  const metricLabel = budgetColumns.label(metric);

  const totalsRow = useMemo(() => {
    const row: any = { group: t('reports.analyticsCategory.totalMetric', { metric: metricLabel }) };
    for (const yr of years) {
      row[yr] = groups.reduce((acc, group) => acc + (Number(group.values[yr]) || 0), 0);
    }
    return row;
  }, [groups, years, metricLabel, t]);

  const gridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);

  const metricsCaption = metricLabel;

  const chartOptions = useMemo(() => {
    if (singleYear) {
      const year = years[0];
      const chartData = groups.map((group) => ({ label: group.label, value: group.values[year] || 0 }));
      const total = chartData.reduce((acc, datum) => acc + (Number(datum.value) || 0), 0);
      const base = {
        title: { text: t('reports.analyticsCategory.chartTitleSingle', { type: scopeLabel, dimension: dimensionInSentence, year }) },
        subtitle: { text: metricsCaption || t('reports.analyticsCategory.shareSubtitle') },
        footnote: { text: t('reports.analyticsCategory.totalLabel', { metric: metricsCaption, value: formatNumber(total) }) },
        data: chartData,
        legend: { enabled: false },
        animation: { enabled: true, duration: 800 },
      } as const;
      if (chartType === 'bar') {
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
              xKey: 'label',
              yKey: 'value',
              strokeWidth: 0,
              label: {
                formatter: ({ value }: { value: number }) => formatNumber(value),
              },
              tooltip: {
                enabled: true,
                renderer: ({ datum }: any) => {
                  const value = Number(datum.value || 0);
                  const pct = total > 0 ? (value / total) * 100 : 0;
                  return {
                    title: escapeTooltipText(datum.label),
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
        series: [
          {
            type: 'pie',
            calloutLabelKey: 'label',
            sectorLabelKey: 'value',
            angleKey: 'value',
            calloutLabel: { offset: 20 },
            sectorLabel: {
              positionOffset: 30,
              formatter: ({ datum, angleKey }: any) => {
                const value = Number(datum[angleKey] || 0);
                const pct = total > 0 ? (value / total) * 100 : 0;
                const shown = Math.round(pct);
                return shown >= 5 ? `${shown}%` : '';
              },
            },
            strokeWidth: 1,
          },
        ],
      };
    }
    const chartData = years.map((yr) => {
      const row: any = { year: yr };
      for (const group of groups) row[group.key] = group.values[yr] || 0;
      return row;
    });
    const series = groups.map((group) => ({ type: 'line', xKey: 'year', yKey: group.key, yName: group.label }));
    return {
      title: { text: t('reports.analyticsCategory.chartTitleRange', { type: scopeLabel, dimension: dimensionInSentence, start: years[0], end: years[years.length - 1] }) },
      subtitle: { text: metricsCaption || t('reports.analyticsCategory.annualSubtitle') },
      data: chartData,
      series,
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left' },
      ],
      legend: { enabled: true },
    };
  }, [groups, singleYear, years, metricsCaption, chartType, metricLabel, scopeLabel, dimensionInSentence, t]);

  return (
    <ReportLayout
      title={t("reports.analyticsCategory.title")}
      subtitle={t('reports.analyticsCategory.subtitle', { type: scopeLabel, dimension: dimensionInSentence })}
      filters={(
        <>
          <ItemScopeTabs value={scope} onChange={setScope} />
          {axis && analyticsAxes.enabled.length >= 2 && (
            <ReportFilter label={t('reports.filters.dimension')} width={200}>
              <TextField
                select
                size="small"
                value={axis.id}
                onChange={(e) => setAxis(String(e.target.value))}
                SelectProps={{
                  MenuProps: reportFilterMenuProps,
                  inputProps: { 'aria-label': t('reports.filters.dimension') },
                }}
                sx={reportFilterSelectSx}
              >
                {analyticsAxes.enabled.map((option) => (
                  <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>{analyticsAxes.label(option)}</MenuItem>
                ))}
              </TextField>
            </ReportFilter>
          )}
          <BudgetReportFilters filters={reportFilters} rows={allRows} />
          <TextField select size="small" label={t("reports.filters.startYear")} value={startYear} onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setStartYear(v);
            if (v > endYear) setEndYear(v);
          }} InputLabelProps={{ shrink: true }}>
            {allowedYears.map((yr) => (<MenuItem key={yr} value={yr}>{yr}</MenuItem>))}
          </TextField>
          <TextField select size="small" label={t("reports.filters.endYear")} value={endYear} onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setEndYear(v);
            if (v < startYear) setStartYear(v);
          }} InputLabelProps={{ shrink: true }}>
            {allowedYears.map((yr) => (<MenuItem key={yr} value={yr}>{yr}</MenuItem>))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.metric")}
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
            sx={{ minWidth: 200 }}
            InputLabelProps={{ shrink: true }}
          >
            {budgetColumns.shown.map((column) => (
              <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.chartType")}
            value={chartType}
            onChange={(e) => setChartType(e.target.value as 'pie' | 'bar')}
            disabled={!singleYear}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="pie">{t("reports.filters.pieChart")}</MenuItem>
            <MenuItem value="bar">{t("reports.filters.horizontalBarChart")}</MenuItem>
          </TextField>
          <Autocomplete
            multiple
            size="small"
            disableCloseOnSelect
            options={categoryOptions}
            value={selectedOptions}
            onChange={(_, next) => {
              setExcludedCategories(next.map((option) => option.id));
            }}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderOption={(props, option, { selected }) => (
              <li {...props}>
                <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                <ListItemText primary={option.label} />
              </li>
            )}
            renderTags={() => []}
            renderInput={(params) => {
              const count = excludedCategories.length;
              return (
                <TextField
                  {...params}
                  label={t("reports.filters.excludeCategories")}
                  placeholder={count === 0 ? t('reports.filters.excludeCategoriesPlaceholder') : ''}
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
                          {t('reports.filters.categorySelected', { count })}
                        </Typography>
                        {params.InputProps.startAdornment}
                      </>
                    ) : params.InputProps.startAdornment,
                  }}
                />
              );
            }}
            sx={{ minWidth: 280 }}
            noOptionsText={t("reports.filters.noMatchingCategories")}
          />
        </>
      )}
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
      onExportChartPng={() => chartRef.current?.download(`analytics-${scope}-${years[0]}-${years[years.length - 1]}`)}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        <Box sx={{ minWidth: 0 }}>
          <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={520} />
        </Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>{t("reports.shared.summaryTable")}</Typography>
          <ReportGrid
            wrapperSx={{ height: 520 }}
            rowData={tableRows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={(e) => { gridApiRef.current = e.api; }}
            pinnedBottomRowData={[totalsRow]}
          />
        </Paper>
      </Stack>
      {isLoading && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t("reports.shared.loadingData")}</Typography>
      )}
    </ReportLayout>
  );
}
