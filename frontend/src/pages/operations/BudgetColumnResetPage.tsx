import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import { useTranslation } from 'react-i18next';
import AgGridBox from '../../components/AgGridBox';
import { useOpexSummaryAll, pickYearSlot } from '../reports/useOpexSummary';
import { useCapexSummaryAll } from '../reports/useCapexSummary';
import { useQueryClient } from '@tanstack/react-query';
import { clearBudgetColumn, BudgetColumn, BudgetScope } from '../../services/budgetOperations';
import { useFreezeState } from '../../hooks/useFreezeState';
import { FreezeColumn } from '../../services/freeze';
import { useLocale } from '../../i18n/useLocale';
import { useKanapDialogs } from '../../components/design';
import { drawerMenuItemSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import ItemScopeTabs, { useDefaultBudgetScope } from './ItemScopeTabs';
import { formatOperationAmount } from './operationAmount';
import { operationSummary } from './operationSummary';

type ProcessedRow = {
  id: string;
  product_name: string;
  currentValue: number;
};


const budgetToFreezeColumn: Record<BudgetColumn, FreezeColumn> = {
  budget: 'budget',
  revision: 'revision',
  follow_up: 'actual',
  landing: 'landing',
};

export default function BudgetColumnResetPage() {
  const { t } = useTranslation(['ops', 'common']);
  const dialogs = useKanapDialogs();

  const BUDGET_COLUMNS: { value: BudgetColumn; label: string }[] = [
    { value: 'budget', label: t('operations.budgetColumns.budget') },
    { value: 'revision', label: t('operations.budgetColumns.revision') },
    { value: 'follow_up', label: t('operations.budgetColumns.followUp') },
    { value: 'landing', label: t('operations.budgetColumns.landing') },
  ];
  const locale = useLocale();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const now = new Date();
  const Y = now.getFullYear();

  // Generate years from Y-1 to Y+5
  const years = Array.from({ length: 7 }, (_, i) => Y - 1 + i);

  const [scope, setScope] = useState<BudgetScope>(useDefaultBudgetScope());
  const [year, setYear] = useState<number>(Y);
  const [column, setColumn] = useState<BudgetColumn>('budget');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [clearResult, setClearResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data: freezeData, isLoading: freezeLoading } = useFreezeState(year);
  const freezeKey = budgetToFreezeColumn[column];
  const columnFrozen = freezeData?.summary?.scopes[scope][freezeKey]?.frozen ?? false;

  // Fetch data for the selected year
  const opexSummary = useOpexSummaryAll([year], { enabled: scope === 'opex' });
  const capexSummary = useCapexSummaryAll([year], { enabled: scope === 'capex' });
  const { data: rows, isLoading } = scope === 'opex' ? opexSummary : capexSummary;

  const processedData = useMemo(() => {
    if (!rows) return [];

    return rows.map((r: any) => {
      const slot = pickYearSlot(r, year);
      const currentValue = Number(slot?.totals?.[column] || 0);

      return {
        id: r.id,
        product_name: r.product_name ?? r.description,
        currentValue,
      };
    });
  }, [rows, year, column]);

  const stats = useMemo(() => {
    const totalItems = processedData.length;
    const itemsWithData = processedData.filter((row: ProcessedRow) => row.currentValue !== 0).length;
    const totalValue = processedData.reduce((sum: number, row: ProcessedRow) => sum + row.currentValue, 0);

    return {
      totalItems,
      itemsWithData,
      totalValue,
    };
  }, [processedData]);

  const columnLabel = BUDGET_COLUMNS.find((c) => c.value === column)?.label || column;

  const columns = useMemo<ColDef[]>(() => [
    {
      field: 'product_name',
      headerName: t('operations.columnReset.product'),
      flex: 1,
      minWidth: 220,
    },
    {
      field: 'currentValue',
      headerName: t('operations.columnReset.currentHeader', { column: columnLabel, year }),
      width: 200,
      type: 'rightAligned',
      valueFormatter: (p) => formatOperationAmount(p.value),
      // Values that will be cleared stand out by weight; empty ones stay muted.
      cellStyle: (params) => (params.value !== 0
        ? { color: 'inherit', fontWeight: 500 }
        : { color: theme.palette.kanap.text.tertiary, fontWeight: 400 }),
    },
  ], [columnLabel, year, locale, theme, t]);

  const gridApiRef = useRef<any>(null);

  const handleClearClick = async () => {
    const confirmed = await dialogs.confirm({
      title: t('operations.columnReset.confirmTitle'),
      message: (
        <Stack spacing={1}>
          <span>{t('operations.columnReset.confirmMessage', { column: columnLabel, year })}</span>
          {/* With no amount left, the reset still removes the spread periods (and how the column was produced). */}
          <span>
            {stats.itemsWithData > 0
              ? t('operations.columnReset.confirmAffected', { count: stats.itemsWithData, value: formatOperationAmount(stats.totalValue) })
              : t('operations.columnReset.confirmPeriodsOnly', { column: columnLabel, year })}
          </span>
          <span>{t('operations.columnReset.confirmUndoWarning')}</span>
        </Stack>
      ),
      confirmLabel: t('operations.columnReset.clearColumn'),
      cancelLabel: t('common:buttons.cancel'),
      intent: 'danger',
    });
    if (!confirmed) return;

    setIsProcessing(true);
    setClearResult(null);

    try {
      const result = await clearBudgetColumn(scope, {
        year,
        column,
      });

      setClearResult({
        ok: true,
        message: operationSummary(t, 'operations.columnReset.clearDone', result.summary.cleared, result.summary.skipped, result.summary.errors),
      });

      // Invalidate and refetch the summary data to show updated values
      await queryClient.invalidateQueries({ queryKey: [scope === 'opex' ? 'spend-items-summary' : 'capex-items-summary'] });
    } catch (error) {
      console.error('Clear operation failed:', error);
      setClearResult({ ok: false, message: getApiErrorMessage(error, t, t('operations.columnReset.clearFailed')) });
    } finally {
      setIsProcessing(false);
    }
  };

  const statSx = { display: 'flex', flexDirection: 'column', gap: '2px' } as const;
  const statLabelSx = { fontSize: 12, color: 'kanap.text.tertiary' } as const;
  const statValueSx = { fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' } as const;

  return (
    <ReportLayout
      rootTo="/ops/operations"
      rootLabel={t('operations.title')}
      title={t('operations.columnReset.title')}
      subtitle={t('operations.columnReset.subtitle')}
      filters={
        <>
          <ItemScopeTabs value={scope} onChange={(next) => { setScope(next); setClearResult(null); }} />
          <ReportFilter label={t('operations.columnReset.year')} width={120}>
            <TextField
              select
              size="small"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              SelectProps={{ MenuProps: reportFilterMenuProps }}
              sx={reportFilterSelectSx}
            >
              {years.map((y) => (
                <MenuItem key={y} value={y} sx={drawerMenuItemSx}>{y}</MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('operations.columnReset.budgetColumn')} width={170}>
            <TextField
              select
              size="small"
              value={column}
              onChange={(e) => setColumn(e.target.value as BudgetColumn)}
              SelectProps={{ MenuProps: reportFilterMenuProps }}
              sx={reportFilterSelectSx}
            >
              {BUDGET_COLUMNS.map((col) => (
                <MenuItem key={col.value} value={col.value} sx={drawerMenuItemSx}>{col.label}</MenuItem>
              ))}
            </TextField>
          </ReportFilter>
        </>
      }
      actions={
        <Button
          variant="action-danger"
          onClick={() => void handleClearClick()}
          // A column without amounts can still hold spread periods: the server clears them and skips the rest.
          disabled={isProcessing || stats.totalItems === 0 || freezeLoading || columnFrozen}
        >
          {isProcessing ? t('operations.columnReset.processing') : t('operations.columnReset.clearColumn')}
        </Button>
      }
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        {columnFrozen && (
          <Alert severity="error">
            {t('operations.columnReset.columnFrozenError', { year, column: columnLabel })}
          </Alert>
        )}

        {stats.itemsWithData === 0 && !isLoading && (
          <Alert severity="info">
            {t('operations.columnReset.noDataInfo', { column: columnLabel, year })}
          </Alert>
        )}

        {stats.itemsWithData > 0 && (
          <Alert severity="warning">
            {t('operations.columnReset.clearWarning', { column: columnLabel, year, count: stats.itemsWithData })}
          </Alert>
        )}

        {clearResult && (
          <Alert severity={clearResult.ok ? 'success' : 'error'}>
            {clearResult.message}
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography sx={{ mb: 1, fontSize: 16, fontWeight: 500 }}>
            {t('operations.columnReset.dataPreview')}
          </Typography>
          <Box component={AgGridBox}>
            <AgGridReact
              rowData={processedData}
              columnDefs={columns}
              defaultColDef={{ sortable: true, resizable: true }}
              initialState={{
                sort: {
                  sortModel: [{ colId: 'currentValue', sort: 'desc' }],
                },
              }}
              onGridReady={(e) => { gridApiRef.current = e.api; }}
              domLayout="autoHeight"
            />
          </Box>

          <Box sx={{ mt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' } }}>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.columnReset.totalItems')}</Typography>
              <Typography sx={statValueSx}>{stats.totalItems.toLocaleString(locale)}</Typography>
            </Box>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.columnReset.itemsWithData')}</Typography>
              <Typography sx={statValueSx}>{stats.itemsWithData.toLocaleString(locale)}</Typography>
            </Box>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.columnReset.currentTotalValue')}</Typography>
              <Typography sx={statValueSx}>{formatOperationAmount(stats.totalValue)}</Typography>
            </Box>
          </Box>
        </Paper>
      </Stack>

      {isLoading && (
        <Typography sx={{ mt: 1, fontSize: 13, color: 'kanap.text.secondary' }}>{t('operations.columnReset.loadingData')}</Typography>
      )}
    </ReportLayout>
  );
}
