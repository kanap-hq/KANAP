import React, { useMemo, useRef, useState } from 'react';
import { Autocomplete, Box, Checkbox, ListItemText, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import { useQuery } from '@tanstack/react-query';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import api from '../../api';
import { BudgetSummaryRow, pickSlot, useBudgetSummaryAll, useReportScope } from './useBudgetSummaryAll';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import { metricKeys, getMetricLabels, MetricKey } from './reportMetrics';
import { useTranslation } from 'react-i18next';

type Account = {
  id: string;
  account_number: number;
  account_name: string;
  consolidation_account_number?: number | null;
  consolidation_account_name?: string | null;
  consolidation_account_description?: string | null;
  status?: string;
};

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function ConsolidationReport() {
  const { t } = useTranslation(["ops"]);
  const metricLabels = useMemo(() => getMetricLabels(t), [t]);
  const now = new Date();
  const Y = now.getFullYear();
  const allowedYears = [Y - 1, Y, Y + 1];

  const [startYear, setStartYear] = useState<number>(Y);
  const [endYear, setEndYear] = useState<number>(Y);
  const [metric, setMetric] = useState<MetricKey>('budget');
  const [excludedAccounts, setExcludedAccounts] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'pie' | 'bar'>('pie');

  const singleYear = startYear === endYear;
  const years = useMemo(() => allowedYears.filter((yr) => yr >= startYear && yr <= endYear), [allowedYears, startYear, endYear]);

  const [scope, setScope] = useReportScope();
  const scopeLabel = t(`operations.scope.${scope}`);
  const { data: rows, isLoading } = useBudgetSummaryAll(scope);
  const { data: accounts } = useQuery<Account[]>({
    queryKey: ['accounts', 'enabled-for-consolidation'],
    queryFn: async () => {
      const res = await api.get<{ items: Account[] }>('/accounts', { params: { limit: 1000 } });
      return res.data.items;
    },
  });

  const accountById = useMemo(() => new Map<string, Account>((accounts ?? []).map((account: Account) => [account.id, account] as const)), [accounts]);
  type AccountOption = { id: string; label: string };

  const accountOptions = useMemo<AccountOption[]>(() => {
    if (!accounts) return [];
    const items: AccountOption[] = [];
    for (const account of accounts) {
      const labelParts: Array<string> = [];
      if (account.account_number != null) labelParts.push(`[${account.account_number}]`);
      if (account.account_name) labelParts.push(account.account_name.trim());
      const label = labelParts.join(' ').trim() || t('reports.shared.unnamedAccount');
      items.push({ id: account.id, label });
    }
    items.sort((a, b) => a.label.localeCompare(b.label));
    return items;
  }, [accounts, t]);

  const selectedAccountOptions = useMemo<AccountOption[]>(() => {
    if (excludedAccounts.length === 0) return [];
    const lookup = new Map(accountOptions.map((entry) => [entry.id, entry] as const));
    return excludedAccounts
      .map((id) => lookup.get(id))
      .filter((entry): entry is AccountOption => Boolean(entry));
  }, [excludedAccounts, accountOptions]);

  type Group = {
    key: string; // internal key (safe)
    label: string; // display label
    values: Record<number, number>; // year -> sum of budget
  };

  // Build groups by consolidation account
  const groups = useMemo<Group[]>(() => {
    const source: BudgetSummaryRow[] = rows ?? [];
    const acc: Map<string, Group> = new Map();
    const makeKey = (a?: Account | null): { key: string; label: string } => {
      const num = a?.consolidation_account_number ?? null;
      const name = (a?.consolidation_account_name ?? '').trim() || null;
      if (num == null && !name) return { key: 'unassigned', label: t('reports.consolidation.unassigned') };
      const label = name && num != null ? `[${num}] ${name}` : (name ?? `[${num}]`);
      // safe key for object props/series yKeys
      const key = `c_${num != null ? num : name!.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
      return { key, label };
    };
    for (const r of source) {
      const accId = r.account?.id ?? undefined;
      if (accId && excludedAccounts.includes(accId)) continue;
      const a = accId ? accountById.get(accId) : undefined;
      const id = makeKey(a);
      let g = acc.get(id.key);
      if (!g) { g = { key: id.key, label: id.label, values: {} }; acc.set(id.key, g); }
      for (const yr of years) {
        const slot = pickSlot(r, yr);
        const totals = (slot?.reporting ?? slot?.totals) as Record<string, number | undefined> | undefined;
        const totalForMetric = Number(totals?.[metric] ?? 0);
        g.values[yr] = (g.values[yr] || 0) + totalForMetric;
      }
    }
    return Array.from(acc.values()).sort((a: Group, b: Group) => {
      // Sort by current period total desc for readability
      const pYear = years[0];
      return (b.values[pYear] || 0) - (a.values[pYear] || 0);
    });
  }, [rows, accountById, years, metric, excludedAccounts, t]);

  // Table rows
  const tableRows = useMemo(() => {
    return groups.map((g) => {
      const row: any = { group: g.label };
      for (const yr of years) row[yr] = g.values[yr] || 0;
      return row;
    });
  }, [groups, years]);

  const columns = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      { field: 'group', headerName: t('reports.columns.consolidationAccount'), flex: 1, minWidth: 240 },
    ];
    for (const yr of years) {
      cols.push({ field: String(yr), headerName: String(yr), width: 140, type: 'rightAligned', valueFormatter: (p) => formatNumber(p.value) });
    }
    return cols;
  }, [years]);

  const metricLabel = metricLabels[metric];

  const totalsRow = useMemo(() => {
    const row: any = { group: t('reports.consolidation.totalMetric', { metric: metricLabel }) };
    for (const yr of years) {
      row[yr] = groups.reduce((acc, g) => acc + (Number(g.values[yr]) || 0), 0);
    }
    return row;
  }, [groups, years, metricLabel, t]);

  const gridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);

  // Chart data and options
  const metricsCaption = metricLabel;

  const chartOptions = useMemo(() => {
    if (singleYear) {
      const year = years[0];
      const chartData = groups.map((g) => ({ label: g.label, value: g.values[year] || 0 }));
      const total = chartData.reduce((acc, d) => acc + (Number(d.value) || 0), 0);
      const base = {
        title: { text: t('reports.consolidation.chartTitleSingle', { type: scopeLabel, year }) },
        subtitle: { text: metricsCaption || t('reports.consolidation.shareSubtitle') },
        footnote: { text: t('reports.consolidation.totalLabel', { metric: metricsCaption, value: formatNumber(total) }) },
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
                    title: datum.label,
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
    // Multi-year: line chart with one series per group
    const chartData = years.map((yr) => {
      const row: any = { year: yr };
      for (const g of groups) row[g.key] = g.values[yr] || 0;
      return row;
    });
    const series = groups.map((g) => ({ type: 'line', xKey: 'year', yKey: g.key, yName: g.label }));
    return {
      title: { text: t('reports.consolidation.chartTitleRange', { type: scopeLabel, start: years[0], end: years[years.length - 1] }) },
      subtitle: { text: metricsCaption || t('reports.consolidation.annualSubtitle') },
      data: chartData,
      series,
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left' },
      ],
      legend: { enabled: true },
    };
  }, [groups, singleYear, years, metricsCaption, chartType, metricLabel, scopeLabel, t]);

  return (
    <ReportLayout
      title={t("reports.consolidation.title")}
      subtitle={t('reports.consolidation.subtitle', { type: scopeLabel })}
      filters={(
        <>
          <ItemScopeTabs value={scope} onChange={setScope} />
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
            {metricKeys.map((key) => (
              <MenuItem key={key} value={key}>{metricLabels[key]}</MenuItem>
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
            options={accountOptions}
            value={selectedAccountOptions}
            onChange={(_, next) => {
              setExcludedAccounts(next.map((option) => option.id));
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
            sx={{ minWidth: 280 }}
            noOptionsText={t("reports.filters.noMatchingAccounts")}
          />
        </>
      )}
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
      onExportChartPng={() => chartRef.current?.download(`consolidation-${scope}-${years[0]}-${years[years.length - 1]}`)}
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
      {(isLoading) && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t("reports.shared.loadingData")}</Typography>
      )}
    </ReportLayout>
  );
}
