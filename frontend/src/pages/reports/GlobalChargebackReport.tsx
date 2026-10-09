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
import api from '../../api';
import { MetricKey, horizontalBarChartHeight, metricFileName, useReportMetric } from './reportMetrics';
import { escapeTooltipText } from './tooltipText';
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

type GlobalChargebackDetailedRow = {
  companyId: string;
  companyName: string;
  departmentId: string | null;
  departmentName: string | null;
  amount: number;
  amountRaw: number;
  headcount: number | null;
  costPerUser: number | null;
};

type GlobalChargebackCompanyRow = {
  companyId: string;
  companyName: string;
  amount: number;
  amountRaw?: number;
  paid?: number;
  paidRaw?: number;
  net?: number;
  netRaw?: number;
};

type GlobalChargebackKpiRow = {
  companyId: string;
  companyName: string;
  amount: number;
  amountRaw?: number;
  headcount: number | null;
  itUsers: number | null;
  turnover: number | null;
  turnoverRaw?: number | null;
  costPerUser: number | null;
  costPerItUser: number | null;
  costVsTurnoverPct: number | null;
};

type GlobalChargebackDetailedDisplayRow = GlobalChargebackDetailedRow & {
  departmentDisplay: string;
  share: number | null;
  companyDisplay?: string;
  rowType?: 'company' | 'department';
};

type GlobalChargebackReportResponse = {
  year: number;
  metric: MetricKey;
  total: number;
  totalRaw: number;
  detailed: GlobalChargebackDetailedRow[];
  companies: GlobalChargebackCompanyRow[];
  kpis: GlobalChargebackKpiRow[];
  intercompanyFlows?: Array<{
    payerId: string;
    payerName: string;
    consumerId: string;
    consumerName: string;
    amount: number;
    amountRaw?: number;
  }>;
  reportingCurrency?: string;
  warnings?: string[];
};

export default function GlobalChargebackReport() {
  const { t } = useTranslation(["ops"]);
  const budgetColumns = useBudgetColumns();
  const locale = useLocale();
  const now = new Date();
  const currentYear = now.getFullYear();
  const allowedYears = [currentYear - 1, currentYear, currentYear + 1];

  const [year, setYear] = useState<number>(currentYear);
  const [metric, setMetric] = useReportMetric(budgetColumns);
  const [showCompanies, setShowCompanies] = useState(true);
  const [showDetailed, setShowDetailed] = useState(true);
  const [showKpis, setShowKpis] = useState(true);
  const [showFlows, setShowFlows] = useState(true);

  const detailedGridApiRef = useRef<any>(null);
  const companyGridApiRef = useRef<any>(null);
  const chartRef = useRef<ChartCardHandle>(null);
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

  const queryKey = ['global-chargeback-report', year, metric];
  const { data, isLoading, isFetching, refetch } = useQuery<GlobalChargebackReportResponse>({
    queryKey,
    // The preselected column is the tenant's default: wait for it rather than fetch twice.
    enabled: budgetColumns.ready,
    queryFn: async () => {
      const response = await api.get<GlobalChargebackReportResponse>('/reports/chargeback/global', {
        params: { year, metric },
      });
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  const totalAmount = data?.total ?? 0;
  const reportingCurrency = (data?.reportingCurrency || 'EUR').toUpperCase();
  const metricLabel = budgetColumns.label(metric);
  const metricFile = metricFileName(budgetColumns, metric);

  const detailedRows = useMemo<GlobalChargebackDetailedDisplayRow[]>(() => {
    const rows: GlobalChargebackDetailedRow[] = data?.detailed ?? [];
    return rows.map((row: GlobalChargebackDetailedRow) => ({
      ...row,
      departmentDisplay: row.departmentName ?? t('reports.globalChargeback.commonCosts'),
      share: totalAmount > 0 ? (row.amount / totalAmount) * 100 : null,
    }));
  }, [data?.detailed, totalAmount]);

  const companyRows = useMemo(() => {
    const rows: GlobalChargebackCompanyRow[] = data?.companies ?? [];
    return rows.map((row: GlobalChargebackCompanyRow) => ({
      ...row,
      share: totalAmount > 0 ? (row.amount / totalAmount) * 100 : null,
    }));
  }, [data?.companies, totalAmount]);

  const chartData = useMemo(() => {
    const rows: GlobalChargebackCompanyRow[] = data?.companies ?? [];
    return rows.map((row: GlobalChargebackCompanyRow) => ({ label: row.companyName, value: row.amount }));
  }, [data?.companies]);

  const detailedColumns = useMemo<ColDef[]>(() => [
    { field: 'companyDisplay', headerName: t('reports.columns.company'), flex: 1, minWidth: 220 },
    {
      field: 'departmentDisplay',
      headerName: t('reports.columns.department'),
      flex: 1,
      minWidth: 200,
    },
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'share',
      headerName: t('reports.columns.shareOfTotal'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => (params.value != null ? `${params.value.toFixed(1)}%` : ''),
    },
    {
      field: 'headcount',
      headerName: t('reports.columns.headcount'),
      width: 140,
      type: 'rightAligned',
      valueFormatter: (params) => (params.value != null ? formatCount(params.value) : ''),
    },
    {
      field: 'costPerUser',
      headerName: t('reports.columns.costPerUser'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => (params.value != null ? formatCurrency(params.value) : ''),
    },
  ], [formatCount, formatCurrency, formatNumber, metricLabel]);

  const kpiRows: GlobalChargebackKpiRow[] = data?.kpis ?? [];
  const warnings = data?.warnings ?? [];

  const companyTotalsById = useMemo(() => {
    const map = new Map<string, { amount: number; share: number | null; companyName: string }>();
    for (const row of companyRows) {
      map.set(row.companyId, {
        amount: row.amount,
        share: row.share ?? null,
        companyName: row.companyName,
      });
    }
    return map;
  }, [companyRows]);

  const kpiByCompanyId = useMemo(() => {
    const map = new Map<string, GlobalChargebackKpiRow>();
    for (const row of kpiRows) map.set(row.companyId, row);
    return map;
  }, [kpiRows]);

  const groupedDetailedRows = useMemo(() => {
    const byCompany = new Map<string, GlobalChargebackDetailedDisplayRow[]>();
    for (const row of detailedRows) {
      const list = byCompany.get(row.companyId) ?? [];
      list.push(row);
      byCompany.set(row.companyId, list);
    }

    const orderedCompanyIds = companyRows.map((row) => row.companyId);
    for (const row of detailedRows) {
      if (!orderedCompanyIds.includes(row.companyId)) orderedCompanyIds.push(row.companyId);
    }

    const result: Array<GlobalChargebackDetailedDisplayRow & {
      rowType: 'company' | 'department';
      companyDisplay: string;
      share: number | null;
    }> = [];

    for (const companyId of orderedCompanyIds) {
      const companyRowsForId = byCompany.get(companyId) ?? [];
      if (companyRowsForId.length === 0) continue;
      companyRowsForId.sort((a, b) => b.amount - a.amount);
      const companyInfo = companyTotalsById.get(companyId);
      const kpi = kpiByCompanyId.get(companyId);
      const companyName = companyRowsForId[0]?.companyName ?? companyInfo?.companyName ?? t('reports.shared.unknownCompany');
      const companyAmountRaw = companyRowsForId.reduce((sum, row) => sum + row.amountRaw, 0);
      result.push({
        ...companyRowsForId[0],
        rowType: 'company',
        companyDisplay: companyName,
        departmentDisplay: t('reports.columns.total'),
        amount: companyInfo?.amount ?? companyRowsForId.reduce((sum, row) => sum + row.amount, 0),
        amountRaw: companyAmountRaw,
        share: companyInfo?.share ?? (totalAmount > 0 ? (companyAmountRaw / totalAmount) * 100 : null),
        headcount: kpi?.headcount ?? null,
        costPerUser: kpi?.costPerUser ?? null,
      });
      for (const deptRow of companyRowsForId) {
        result.push({
          ...deptRow,
          rowType: 'department',
          companyDisplay: '',
          share: deptRow.share ?? null,
        });
      }
    }

    return result;
  }, [companyRows, detailedRows, companyTotalsById, kpiByCompanyId, totalAmount, t]);

  const companyColumns = useMemo<ColDef[]>(() => [
    { field: 'companyName', headerName: t('reports.columns.company'), flex: 1, minWidth: 220 },
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'paid',
      headerName: t('reports.columns.paidBooked'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'net',
      headerName: t('reports.columns.netConsumedPaid'),
      width: 180,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
    {
      field: 'share',
      headerName: t('reports.columns.shareOfTotal'),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => (params.value != null ? `${params.value.toFixed(1)}%` : ''),
    },
  ], [formatNumber, metricLabel]);

  const flows = data?.intercompanyFlows ?? [];
  // Build netted-by-pair flows: show only net direction per company pair
  const companyNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.companies ?? []) {
      map.set(row.companyId, row.companyName);
    }
    for (const f of flows) {
      if (f.payerId && f.payerName) map.set(f.payerId, f.payerName);
      if (f.consumerId && f.consumerName) map.set(f.consumerId, f.consumerName);
    }
    return map;
  }, [data?.companies, flows]);

  const nettedFlows = useMemo(() => {
    const pairNet = new Map<string, { aId: string; bId: string; net: number }>();
    for (const f of flows) {
      const aId = f.payerId < f.consumerId ? f.payerId : f.consumerId;
      const bId = f.payerId < f.consumerId ? f.consumerId : f.payerId;
      const key = `${aId}|${bId}`;
      const current = pairNet.get(key) ?? { aId, bId, net: 0 };
      // If original payer was aId, add; if original payer was bId, subtract
      const delta = f.payerId === aId ? f.amount : -f.amount;
      current.net += Number(delta || 0);
      pairNet.set(key, current);
    }
    const result: Array<{ payerId: string; payerName: string; consumerId: string; consumerName: string; amount: number }> = [];
    for (const entry of pairNet.values()) {
      const { aId, bId, net } = entry;
      if (!Number.isFinite(net) || Math.abs(net) < 0.0001) continue;
      if (net > 0) {
        result.push({
          payerId: aId,
          payerName: companyNameById.get(aId) || t('reports.shared.unknownCompany'),
          consumerId: bId,
          consumerName: companyNameById.get(bId) || t('reports.shared.unknownCompany'),
          amount: net,
        });
      } else {
        result.push({
          payerId: bId,
          payerName: companyNameById.get(bId) || t('reports.shared.unknownCompany'),
          consumerId: aId,
          consumerName: companyNameById.get(aId) || t('reports.shared.unknownCompany'),
          amount: -net,
        });
      }
    }
    // Sort by amount desc then payer name
    result.sort((x, y) => (y.amount !== x.amount ? y.amount - x.amount : (x.payerName || '').localeCompare(y.payerName || '')));
    return result;
  }, [flows, companyNameById, t]);

  const flowsColumns = useMemo<ColDef[]>(() => [
    { field: 'payerName', headerName: t('reports.columns.payer'), flex: 1, minWidth: 200 },
    { field: 'consumerName', headerName: t('reports.columns.consumer'), flex: 1, minWidth: 200 },
    {
      field: 'amount',
      headerName: t('reports.columns.metricAmount', { metric: metricLabel }),
      width: 160,
      type: 'rightAligned',
      valueFormatter: (params) => formatNumber(params.value),
    },
  ], [formatNumber, metricLabel]);

  const flowsGridApiRef = useRef<any>(null);
  const exportFlowsCsv = () => {
    flowsGridApiRef.current?.exportDataAsCsv?.({ fileName: `global-chargeback-flows-netted-${year}-${metricFile}.csv` });
  };

  const chartOptions = useMemo(() => {
    return {
      title: { text: t('reports.globalChargeback.chartTitle', { year }), fontSize: 14 },
      subtitle: { text: t('reports.globalChargeback.chartSubtitle', { metric: metricLabel }), fontSize: 12 },
      footnote: { text: t('reports.globalChargeback.chartFootnote', { metric: metricLabel, total: formatCurrency(totalAmount) }), fontSize: 11 },
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
              const pct = totalAmount > 0 ? (value / totalAmount) * 100 : 0;
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
      legend: { enabled: false },
      animation: { enabled: true, duration: 700 },
    };
  }, [chartData, formatCurrency, formatNumber, metricLabel, t, totalAmount, year]);

  const exportCsv = () => {
    detailedGridApiRef.current?.exportDataAsCsv?.({ fileName: `global-chargeback-detailed-${year}-${metricFile}.csv` });
  };

  const exportChart = () => {
    chartRef.current?.download(`global-chargeback-company-${year}-${metricFile}`);
  };

  const kpiTotals = useMemo(() => {
    let amountRawTotal = 0;
    let amountDisplayTotal = 0;
    let headcountTotal = 0;
    let itUsersTotal = 0;
    let turnoverRawTotal = 0;
    let turnoverDisplayTotal = 0;
    for (const row of kpiRows) {
      amountRawTotal += Number(row.amountRaw ?? row.amount ?? 0);
      amountDisplayTotal += Number(row.amount ?? 0);
      headcountTotal += Number(row.headcount ?? 0);
      itUsersTotal += Number(row.itUsers ?? 0);
      turnoverRawTotal += Number(row.turnoverRaw ?? row.turnover ?? 0);
      turnoverDisplayTotal += Number(row.turnover ?? 0);
    }
    const costVsTurnover = turnoverRawTotal > 0 ? (amountRawTotal / turnoverRawTotal) * 100 : null;
    const costPerUser = headcountTotal > 0 ? amountRawTotal / headcountTotal : null;
    const costPerItUser = itUsersTotal > 0 ? amountRawTotal / itUsersTotal : null;
    return {
      amountRawTotal,
      amountDisplayTotal,
      headcountTotal,
      itUsersTotal,
      turnoverRawTotal,
      turnoverDisplayTotal,
      costVsTurnover,
      costPerUser,
      costPerItUser,
    };
  }, [kpiRows]);

  return (
    <ReportLayout
      title={t("reports.globalChargeback.title")}
      subtitle={t("reports.globalChargeback.subtitle")}
      filters={(
        <>
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
            control={<Checkbox checked={showCompanies} onChange={(_, checked) => setShowCompanies(checked)} />}
            label={t("reports.globalChargeback.companyTotals")}
          />
          <FormControlLabel
            control={<Checkbox checked={showDetailed} onChange={(_, checked) => setShowDetailed(checked)} />}
            label={t("reports.globalChargeback.detailedAllocations")}
          />
          <FormControlLabel
            control={<Checkbox checked={showKpis} onChange={(_, checked) => setShowKpis(checked)} />}
            label={t("reports.globalChargeback.includeKpis")}
          />
          <FormControlLabel
            control={<Checkbox checked={showFlows} onChange={(_, checked) => setShowFlows(checked)} />}
            label={t("reports.globalChargeback.intercompanyFlows")}
          />
        </>
      )}
      actions={(
        <Button variant="action-primary" onClick={() => refetch()} disabled={isFetching || !budgetColumns.ready}>
          {isFetching ? t('reports.shared.refreshing') : t('reports.shared.run')}
        </Button>
      )}
      onExportTableCsv={exportCsv}
      onExportChartPng={exportChart}
    >
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2 }} className="report-print-summary">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between">
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t("reports.globalChargeback.overallTotal")}</Typography>
              <Typography variant="h5" sx={{ fontWeight: 600 }}>{formatCurrency(totalAmount)}</Typography>
              <Typography variant="body2" color="text.secondary">{`${metricLabel} • ${year}`}</Typography>
            </Box>
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
              <Box>
                <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.companies")}</Typography>
                <Typography variant="subtitle2">{data?.companies?.length ?? 0}</Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.detailedLines")}</Typography>
                <Typography variant="subtitle2">{data?.detailed?.length ?? 0}</Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.kpiCoverage")}</Typography>
                <Typography variant="subtitle2">{kpiRows.filter((k: GlobalChargebackKpiRow) => k.headcount != null).length}/{kpiRows.length}</Typography>
              </Box>
            </Box>
          </Stack>
        </Paper>

        {warnings.length > 0 && (
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

        {showCompanies && (
          <Stack spacing={2} direction={{ xs: 'column', xl: 'row' }} alignItems={{ xs: 'stretch', xl: 'flex-start' }}>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.companyTotalsTitle")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("reports.globalChargeback.companyTotalsDescription")}
              </Typography>
              <ReportGrid
                rowData={companyRows}
                columnDefs={companyColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                onGridReady={(event) => {
                  companyGridApiRef.current = event.api;
                }}
                domLayout="autoHeight"
              />
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.distributionTitle")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("reports.globalChargeback.distributionDescription")}
              </Typography>
              <ChartCard ref={chartRef} title={t('reports.shared.chart')} options={chartOptions} height={horizontalBarChartHeight(chartData.length)} />
            </Paper>
          </Stack>
        )}

        {showDetailed && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.detailedTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.globalChargeback.detailedDescription")}
            </Typography>
            <ReportGrid
              rowData={groupedDetailedRows}
              columnDefs={detailedColumns}
              defaultColDef={{ sortable: true, resizable: true }}
              onGridReady={(event) => {
                detailedGridApiRef.current = event.api;
              }}
              getRowStyle={(params) => (params.data?.rowType === 'company' ? { fontWeight: 600 } : undefined)}
              domLayout="autoHeight"
            />
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.globalTotal")}</Typography>
            <Typography variant="subtitle2">{formatCurrency(totalAmount)}</Typography>
          </Paper>
        )}

        {showFlows && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.flowsTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.globalChargeback.flowsDescription")}
            </Typography>
            {nettedFlows.length > 0 ? (
              <ReportGrid
                rowData={nettedFlows}
                columnDefs={flowsColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                onGridReady={(event) => {
                  flowsGridApiRef.current = event.api;
                }}
                domLayout="autoHeight"
              />
            ) : (
              <Typography variant="body2" color="text.secondary">{t("reports.globalChargeback.noFlows")}</Typography>
            )}
            <Box className="report-print-hide">
              <Divider sx={{ my: 2 }} />
              <Button variant="outlined" size="small" onClick={exportFlowsCsv}>{t("reports.globalChargeback.exportFlowsCsv")}</Button>
            </Box>
          </Paper>
        )}

        {showKpis && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t("reports.globalChargeback.kpisTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("reports.globalChargeback.kpisDescription")}
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
                  {kpiRows.map((row) => (
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
                  {kpiRows.length > 0 && (
                    <TableRow sx={{ '& > *': { fontWeight: 600 } }}>
                      <TableCell>{t("shared.total")}</TableCell>
                      <TableCell align="right">{formatCurrency(kpiTotals.amountDisplayTotal)}</TableCell>
                      <TableCell align="right">{formatCount(kpiTotals.headcountTotal)}</TableCell>
                      <TableCell align="right">{formatCount(kpiTotals.itUsersTotal)}</TableCell>
                      <TableCell align="right">{kpiTotals.turnoverDisplayTotal > 0 ? formatCurrency(kpiTotals.turnoverDisplayTotal, true) : '—'}</TableCell>
                      <TableCell align="right">{kpiTotals.costVsTurnover != null ? formatPercent(kpiTotals.costVsTurnover) : '—'}</TableCell>
                      <TableCell align="right">{kpiTotals.costPerUser != null ? formatCount(Math.round(kpiTotals.costPerUser)) : '—'}</TableCell>
                      <TableCell align="right">{kpiTotals.costPerItUser != null ? formatCount(Math.round(kpiTotals.costPerItUser)) : '—'}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        )}

        {(isLoading || !budgetColumns.ready) && (
          <Typography variant="body2" color="text.secondary">{t("reports.shared.loadingReport")}</Typography>
        )}
      </Stack>
    </ReportLayout>
  );
}
