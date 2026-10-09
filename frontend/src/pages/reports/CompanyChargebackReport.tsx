import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef } from 'ag-grid-community';
import ReportLayout from '../../components/reports/ReportLayout';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import CompanySelect from '../../components/fields/CompanySelect';
import api from '../../api';
import { MetricKey, horizontalBarChartHeight, metricFileName, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
import { itemHref } from './useReportScope';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { useLocale } from '../../i18n/useLocale';
import { useTranslation } from 'react-i18next';

function baseFormatNumber(value: number | null | undefined, locale: string): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(n));
}

function baseFormatCurrency(value: number | null | undefined, locale: string, withDecimals = false): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  });
  return formatter.format(n);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}

function baseFormatCount(value: number | null | undefined, locale: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return baseFormatNumber(value, locale);
}

type CompanyChargebackDepartmentRow = {
  departmentId: string | null;
  departmentName: string;
  amount: number;
  amountRaw: number;
  sharePct: number | null;
  headcount: number | null;
  costPerUser: number | null;
};

type CompanyChargebackItemRow = {
  versionId: string;
  itemId: string | null;
  itemName: string;
  allocationMethod: string;
  allocationMethodLabel: string;
  amount: number;
  amountRaw: number;
  sharePct: number | null;
};

type CompanyChargebackSummary = {
  id: string;
  name: string;
  total: number;
  totalRaw: number;
  paid?: number;
  paidRaw?: number;
  net?: number;
  netRaw?: number;
  headcount: number | null;
  itUsers: number | null;
  turnover: number | null;
  turnoverRaw: number | null;
  costPerUser: number | null;
  costPerUserRaw: number | null;
  costPerItUser: number | null;
  costPerItUserRaw: number | null;
  costVsTurnoverPct: number | null;
};

type CompanyChargebackReportResponse = {
  year: number;
  metric: MetricKey;
  total: number;
  totalRaw: number;
  company: CompanyChargebackSummary;
  departments: CompanyChargebackDepartmentRow[];
  items: CompanyChargebackItemRow[];
  itemsTotal: number;
  itemsTotalRaw: number;
  kpis: Array<{
    companyId: string;
    companyName: string;
    amount: number;
    amountRaw: number;
    headcount: number | null;
    itUsers: number | null;
    turnover: number | null;
    turnoverRaw: number | null;
    costPerUser: number | null;
    costPerItUser: number | null;
    costVsTurnoverPct: number | null;
  }>;
  globalKpi: {
    amount: number;
    amountRaw: number;
    headcount: number | null;
    itUsers: number | null;
    turnover: number | null;
    turnoverRaw: number | null;
    costPerUser: number | null;
    costPerItUser: number | null;
    costVsTurnoverPct: number | null;
  };
  intercompany?: {
    receivables: Array<{ consumerId: string; consumerName: string; amount: number; amountRaw: number }>;
    payables: Array<{ payerId: string; payerName: string; amount: number; amountRaw: number }>;
  };
  reportingCurrency?: string;
  warnings?: string[];
};

type CompanyChargebackKpiRow = CompanyChargebackReportResponse['kpis'][number];

export default function CompanyChargebackReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const locale = useLocale();
  const now = new Date();
  const currentYear = now.getFullYear();
  const allowedYears = [currentYear - 1, currentYear, currentYear + 1];

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [year, setYear] = useState<number>(currentYear);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  const [showDepartments, setShowDepartments] = useState(true);
  const [showItems, setShowItems] = useState(true);
  const [showKpis, setShowKpis] = useState(true);
  const [showIntercompany, setShowIntercompany] = useState(true);

  const departmentGridRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);
  const intercompanyGridRef = useRef<any>(null);

  const queryKey = ['company-chargeback-report', companyId, year, metric];
  const { data, isLoading, isFetching, refetch } = useQuery<CompanyChargebackReportResponse>({
    queryKey,
    // The preselected column is the tenant's default: wait for it rather than fetch twice.
    enabled: Boolean(companyId) && budgetColumns.ready,
    queryFn: async () => {
      const response = await api.get<CompanyChargebackReportResponse>('/reports/chargeback/company', {
        params: { companyId, year, metric },
      });
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  const metricLabel = budgetColumns.label(metric);
  const metricFile = metricFileName(budgetColumns, metric);
  const reportingCurrency = (data?.reportingCurrency || 'EUR').toUpperCase();
  const departments = data?.departments ?? [];
  const items = data?.items ?? [];
  const kpiRows = data?.kpis ?? [];
  const globalKpi = data?.globalKpi;
  const warnings = data?.warnings ?? [];
  const formatNumber = React.useCallback(
    (value: number | null | undefined) => baseFormatNumber(value, locale),
    [locale],
  );
  const formatCurrency = React.useCallback(
    (value: number | null | undefined, withDecimals = false) => baseFormatCurrency(value, locale, withDecimals),
    [locale],
  );
  const formatCount = React.useCallback(
    (value: number | null | undefined) => baseFormatCount(value, locale),
    [locale],
  );

  // Intercompany rows (partner, receivables, payables, net)
  const intercompanyColumns = useMemo<ColDef[]>(() => [
    { field: 'partnerName', headerName: t('reports.columns.company'), flex: 1, minWidth: 220 },
    { field: 'receivables', headerName: t('reports.columns.receivables'), width: 160, type: 'rightAligned', valueFormatter: (p: any) => formatNumber(p.value) },
    { field: 'payables', headerName: t('reports.columns.payables'), width: 160, type: 'rightAligned', valueFormatter: (p: any) => formatNumber(p.value) },
    { field: 'net', headerName: t('reports.columns.net'), width: 160, type: 'rightAligned', valueFormatter: (p: any) => formatNumber(p.value) },
  ], [formatNumber]);

  const intercompanyRows = useMemo(() => {
    const receivables = data?.intercompany?.receivables ?? [];
    const payables = data?.intercompany?.payables ?? [];
    type Row = { partnerId: string; partnerName: string; receivables: number; payables: number; net: number };
    const map = new Map<string, Row>();
    for (const r of receivables) {
      const id = r.consumerId;
      const name = r.consumerName || t('reports.shared.unknownCompany');
      const row = map.get(id) ?? { partnerId: id, partnerName: name, receivables: 0, payables: 0, net: 0 };
      row.partnerName = name;
      row.receivables += Number(r.amount || 0);
      map.set(id, row);
    }
    for (const p of payables) {
      const id = p.payerId;
      const name = p.payerName || t('reports.shared.unknownCompany');
      const row = map.get(id) ?? { partnerId: id, partnerName: name, receivables: 0, payables: 0, net: 0 };
      row.partnerName = name;
      row.payables += Number(p.amount || 0);
      map.set(id, row);
    }
    const rows = Array.from(map.values()).map((r) => ({ ...r, net: Number((r.receivables - r.payables) || 0) }));
    rows.sort((a, b) => (b.net !== a.net ? b.net - a.net : a.partnerName.localeCompare(b.partnerName)));
    return rows;
  }, [data?.intercompany, t]);

  const intercompanyPinnedBottom = useMemo(() => {
    if (!intercompanyRows.length) return [];
    const tRec = intercompanyRows.reduce((s, r) => s + (r.receivables || 0), 0);
    const tPay = intercompanyRows.reduce((s, r) => s + (r.payables || 0), 0);
    const tNet = tRec - tPay;
    return [{ partnerName: t('reports.columns.total'), receivables: tRec, payables: tPay, net: tNet } as Partial<any>];
  }, [intercompanyRows, t]);

  const exportIntercompanyCsv = () => {
    if (!companyId) return;
    intercompanyGridRef.current?.exportDataAsCsv?.({ fileName: `company-chargeback-flows-${companyId}-${year}-${metricFile}.csv` });
  };

  const departmentColumns = useMemo<ColDef[]>(() => [
    { field: 'departmentName', headerName: t('reports.columns.department'), flex: 1, minWidth: 200 },
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'sharePct',
      headerName: t('reports.columns.shareOfTotal'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (params) => (params.value != null ? `${Number(params.value).toFixed(2)}%` : ''),
    },
    {
      field: 'headcount',
      headerName: t('reports.columns.headcount'),
      width: 130,
      type: 'rightAligned',
      valueFormatter: (params) => formatCount(params.value),
    },
    {
      field: 'costPerUser',
      headerName: t('reports.columns.costPerUser'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
  ], [formatCount, formatNumber, metricLabel]);

  const itemColumns = useMemo<ColDef[]>(() => [
    {
      field: 'itemName',
      headerName: t('reports.columns.item'),
      flex: 1,
      minWidth: 220,
      cellRenderer: LinkCellRenderer,
      // Chargeback covers OPEX lines; common costs (no line) and the total row stay plain text.
      cellRendererParams: { newTab: true, getHref: (row: Partial<CompanyChargebackItemRow>) => itemHref('opex', row.itemId) },
    },
    { field: 'allocationMethodLabel', headerName: t('reports.columns.allocationMethod'), minWidth: 180 },
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'sharePct',
      headerName: t('reports.columns.shareOfTotal'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (params) => (params.value != null ? `${Number(params.value).toFixed(2)}%` : ''),
    },
  ], [formatNumber, metricLabel]);

  const chartData = useMemo(() => {
    return departments.map((row: CompanyChargebackDepartmentRow) => ({ label: row.departmentName, value: row.amount }));
  }, [departments]);

  const itemsPinnedBottom = useMemo(() => {
    if (!data) return [];
    const total = data.total ?? 0;
    const share = total > 0 ? (data.itemsTotal / total) * 100 : null;
    return [{
      itemName: t('reports.columns.total'),
      allocationMethod: '',
      allocationMethodLabel: '',
      amount: data.itemsTotal,
      amountRaw: data.itemsTotalRaw,
      sharePct: share != null ? Math.round(share * 100) / 100 : null,
    } as Partial<CompanyChargebackItemRow>];
  }, [data, t]);

  const chartOptions = useMemo(() => {
    if (!data?.company) {
      return null;
    }
    return {
      title: { text: t('reports.companyChargeback.chartTitle', { name: data.company.name }), fontSize: 14 },
      subtitle: { text: t('reports.companyChargeback.chartSubtitle', { metric: metricLabel }), fontSize: 12 },
      footnote: { text: t('reports.companyChargeback.chartFootnote', { metric: metricLabel, total: formatCurrency(data.total) }), fontSize: 11 },
      data: chartData,
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
              const total = data?.total ?? 0;
              const pct = total > 0 ? (value / total) * 100 : 0;
              return {
                title: escapeTooltipText(datum.label),
                data: [
                  { label: metricLabel, value: formatNumber(value) },
                  { label: t('reports.shared.share'), value: `${pct.toFixed(2)}%` },
                ],
              };
            },
          },
        },
      ],
      legend: { enabled: false },
      animation: { enabled: true, duration: 700 },
    };
  }, [chartData, data?.company, data?.total, formatCurrency, formatNumber, metricLabel, t]);

  const exportDepartmentsCsv = () => {
    if (!companyId) return;
    departmentGridRef.current?.exportDataAsCsv?.({
      fileName: `company-chargeback-departments-${companyId}-${year}-${metricFile}.csv`,
    });
  };

  const exportChart = () => {
    if (!companyId) return;
    chartRef.current?.download(`company-chargeback-departments-${companyId}-${year}-${metricFile}`);
  };

  const companySummary = data?.company;

  const isReady = Boolean(companyId);

  return (
    <ReportLayout
      title={t("reports.companyChargeback.title")}
      subtitle={t("reports.companyChargeback.subtitle")}
      filters={(
        <>
          <Box sx={{ minWidth: 240 }}>
            <CompanySelect
              label={t("reports.filters.company")}
              value={companyId}
              onChange={setCompanyId}
              size="small"
            />
          </Box>
          <TextField
            select
            size="small"
            label={t("reports.filters.year")}
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            sx={{ minWidth: 120 }}
          >
            {allowedYears.map((yr) => (
              <MenuItem key={yr} value={yr}>{yr}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("reports.filters.column")}
            value={metric}
            onChange={(event) => setMetric(event.target.value as MetricKey)}
            sx={{ minWidth: 160 }}
          >
            {budgetColumns.shown.map((column) => (
              <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Checkbox checked={showDepartments} onChange={(_, checked) => setShowDepartments(checked)} />}
            label={t("reports.companyChargeback.departmentTotals")}
          />
          <FormControlLabel
            control={<Checkbox checked={showItems} onChange={(_, checked) => setShowItems(checked)} />}
            label={t("reports.companyChargeback.chargebackItems")}
          />
          <FormControlLabel
            control={<Checkbox checked={showKpis} onChange={(_, checked) => setShowKpis(checked)} />}
            label={t("reports.companyChargeback.chargebackKpis")}
          />
          <FormControlLabel
            control={<Checkbox checked={showIntercompany} onChange={(_, checked) => setShowIntercompany(checked)} />}
            label={t("reports.companyChargeback.flowsTitle")}
          />
        </>
      )}
      actions={(
        <Button
          variant="action-primary"
          onClick={() => refetch()}
          disabled={!companyId || isFetching || !budgetColumns.ready}
        >
          {!companyId ? t('reports.companyChargeback.selectCompany') : isFetching ? t('reports.shared.refreshing') : t('reports.shared.run')}
        </Button>
      )}
      onExportTableCsv={isReady ? exportDepartmentsCsv : undefined}
      onExportChartPng={isReady ? exportChart : undefined}
    >
      <Stack spacing={2}>
        {!isReady && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.selectCompanyTitle")}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('reports.companyChargeback.selectCompanyDescription')}
            </Typography>
          </Paper>
        )}

        {isReady && companySummary && (
          <Paper variant="outlined" sx={{ p: 2 }} className="report-print-summary">
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between">
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{companySummary.name}</Typography>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>{formatCurrency(companySummary.total)}</Typography>
                <Typography variant="body2" color="text.secondary">{`${metricLabel} • ${year} • ${reportingCurrency}`}</Typography>
              </Box>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' } }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t('reports.columns.headcount')}</Typography>
                  <Typography variant="subtitle2">{formatCount(companySummary.headcount)}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t("reports.columns.itUsers")}</Typography>
                  <Typography variant="subtitle2">{formatCount(companySummary.itUsers)}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t("reports.columns.costPerUser")}</Typography>
                  <Typography variant="subtitle2">{companySummary.costPerUser != null ? formatCurrency(companySummary.costPerUser) : '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t("reports.columns.costPerItUser")}</Typography>
                  <Typography variant="subtitle2">{companySummary.costPerItUser != null ? formatCurrency(companySummary.costPerItUser) : '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">{t("reports.columns.itCostsVsTurnover")}</Typography>
                  <Typography variant="subtitle2">{companySummary.costVsTurnoverPct != null ? formatPercent(companySummary.costVsTurnoverPct) : '—'}</Typography>
                </Box>
              </Box>
            </Stack>
          </Paper>
        )}

        {isReady && warnings.length > 0 && (
          <Alert severity="warning" sx={{ whiteSpace: 'pre-wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{t("reports.shared.warningsTitle")}</Typography>
            <Box component="ul" sx={{ pl: 3, my: 0 }}>
              {warnings.map((warning: string, index: number) => (
                <Typography component="li" variant="body2" key={`${warning}-${index}`}>
                  {warning}
                </Typography>
              ))}
            </Box>
          </Alert>
        )}

        {isReady && showDepartments && departments.length > 0 && (
          <Stack spacing={2} direction={{ xs: 'column', xl: 'row' }} alignItems={{ xs: 'stretch', xl: 'flex-start' }}>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.departmentTotals")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("reports.companyChargeback.departmentTotalsDescription")}
              </Typography>
              <ReportGrid
                rowData={departments}
                columnDefs={departmentColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                onGridReady={(event) => {
                  departmentGridRef.current = event.api;
                }}
                domLayout="autoHeight"
              />
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.departmentDistribution")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("reports.companyChargeback.departmentDistributionDescription")}
              </Typography>
              {chartOptions ? (
                <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={horizontalBarChartHeight(chartData.length)} />
              ) : (
                <Typography variant="body2" color="text.secondary">{t("reports.shared.chartUnavailable")}</Typography>
              )}
            </Paper>
          </Stack>
        )}

        {isReady && showDepartments && departments.length === 0 && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('reports.companyChargeback.departmentTotals')}</Typography>
            <Typography variant="body2" color="text.secondary">{t("reports.companyChargeback.noDepartmentAllocations")}</Typography>
          </Paper>
        )}

        {isReady && showItems && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.chargebackItems")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.companyChargeback.chargebackItemsDescription")}
            </Typography>
            {items.length > 0 ? (
              <ReportGrid
                rowData={items}
                columnDefs={itemColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                pinnedBottomRowData={itemsPinnedBottom}
                domLayout="autoHeight"
              />
            ) : (
              <Typography variant="body2" color="text.secondary">{t("reports.companyChargeback.noChargebackItems")}</Typography>
            )}
          </Paper>
        )}

        {isReady && showIntercompany && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.flowsTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.companyChargeback.flowsDescription")}
            </Typography>
            {intercompanyRows.length > 0 ? (
              <ReportGrid
                rowData={intercompanyRows}
                columnDefs={intercompanyColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                pinnedBottomRowData={intercompanyPinnedBottom}
                onGridReady={(e) => { intercompanyGridRef.current = e.api; }}
                domLayout="autoHeight"
              />
            ) : (
              <Typography variant="body2" color="text.secondary">{t('reports.companyChargeback.noFlows')}</Typography>
            )}
            <Box className="report-print-hide">
              <Divider sx={{ my: 2 }} />
              <Button variant="outlined" size="small" onClick={exportIntercompanyCsv}>{t("reports.companyChargeback.exportFlowsCsv")}</Button>
            </Box>
          </Paper>
        )}

        {isReady && showKpis && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.companyChargeback.kpisTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.companyChargeback.kpisDescription")}
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 720 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t("reports.columns.company")}</TableCell>
                    <TableCell align="right">{metricLabel}</TableCell>
                    <TableCell align="right">{t("reports.columns.headcount")}</TableCell>
                    <TableCell align="right">{t("reports.columns.itUsers")}</TableCell>
                    <TableCell align="right">{t("reports.columns.turnover")}</TableCell>
                    <TableCell align="right">{t("reports.columns.itCostsVsTurnover")}</TableCell>
                    <TableCell align="right">{t("reports.columns.itCostsPerUser")}</TableCell>
                    <TableCell align="right">{t("reports.columns.itCostsPerItUser")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {kpiRows.map((row: CompanyChargebackKpiRow) => (
                    <TableRow key={row.companyId} hover>
                      <TableCell>{row.companyName}</TableCell>
                      <TableCell align="right">{formatCurrency(row.amount)}</TableCell>
                      <TableCell align="right">{formatCount(row.headcount)}</TableCell>
                      <TableCell align="right">{formatCount(row.itUsers)}</TableCell>
                      <TableCell align="right">{row.turnover != null ? formatCurrency(row.turnover, true) : '—'}</TableCell>
                      <TableCell align="right">{row.costVsTurnoverPct != null ? formatPercent(row.costVsTurnoverPct) : '—'}</TableCell>
                      <TableCell align="right">{row.costPerUser != null ? formatCount(Math.round(row.costPerUser)) : '—'}</TableCell>
                      <TableCell align="right">{row.costPerItUser != null ? formatCount(Math.round(row.costPerItUser)) : '—'}</TableCell>
                    </TableRow>
                  ))}
                  {kpiRows.length === 0 && (
                    <TableRow>
                      <TableCell align="center" colSpan={8} sx={{ color: 'text.secondary' }}>
                        {t('reports.shared.noDataForYear')}
                      </TableCell>
                    </TableRow>
                  )}
                  {kpiRows.length > 0 && globalKpi && (
                    <TableRow sx={{ '& > *': { fontWeight: 600 } }}>
                      <TableCell>{t("reports.companyChargeback.globalTotals")}</TableCell>
                      <TableCell align="right">{formatCurrency(globalKpi.amount)}</TableCell>
                      <TableCell align="right">{formatCount(globalKpi.headcount)}</TableCell>
                      <TableCell align="right">{formatCount(globalKpi.itUsers)}</TableCell>
                      <TableCell align="right">{globalKpi.turnover != null ? formatCurrency(globalKpi.turnover, true) : '—'}</TableCell>
                      <TableCell align="right">{globalKpi.costVsTurnoverPct != null ? formatPercent(globalKpi.costVsTurnoverPct) : '—'}</TableCell>
                      <TableCell align="right">{globalKpi.costPerUser != null ? formatCount(Math.round(globalKpi.costPerUser)) : '—'}</TableCell>
                      <TableCell align="right">{globalKpi.costPerItUser != null ? formatCount(Math.round(globalKpi.costPerItUser)) : '—'}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        )}

        {isReady && (isLoading || !budgetColumns.ready) && (
          <Typography variant="body2" color="text.secondary">{t("reports.shared.loadingReport")}</Typography>
        )}
      </Stack>
    </ReportLayout>
  );
}
