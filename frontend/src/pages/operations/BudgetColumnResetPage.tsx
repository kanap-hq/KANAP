import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Link,
  MenuItem,
  Stack,
  TextField,
  useTheme,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import { useAgGridLocaleText } from '../../components/grid/useAgGridLocaleText';
import type { ColDef } from 'ag-grid-community';
import { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import ReportExportButton from '../../components/reports/ReportExportButton';
import { useTranslation } from 'react-i18next';
import AgGridBox from '../../components/AgGridBox';
import { SettingsPage } from '../../components/settings/SettingsPage';
import { SettingsSection } from '../../components/settings/SettingsSection';
import { OperationPanel } from '../../components/settings/OperationPanel';
import { operationLinesRequest, readOperationLines } from '../reports/reportAggregates';
import { SUMMARY_QUERY_KEY, useBudgetAggregate } from '../reports/useBudgetAggregate';
import { useQueryClient } from '@tanstack/react-query';
import { forgetAllAllocations } from '../../components/finance/allocationsCache';
import { clearBudgetColumn, BudgetColumn, BudgetOperationScope, BudgetScope } from '../../services/budgetOperations';
import { useFreezeState } from '../../hooks/useFreezeState';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { selectPlaceholderSx } from '../../theme/formSx';
import { useLocale } from '../../i18n/useLocale';
import { drawerMenuItemSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import ItemScopeTabs, { SCOPE_NATURES } from './ItemScopeTabs';
import OperationLineCell from './OperationLineCell';
import { formatOperationAmount } from './operationAmount';

type ProcessedRow = {
  id: string;
  itemNumber: number | null;
  nature: BudgetOperationScope | null;
  product_name: string;
  currentValue: number;
};

export default function BudgetColumnResetPage() {
  const { t } = useTranslation(['ops', 'common']);

  // Shown columns only, none preselected: clearing is destructive, the user names the column.
  const budgetColumns = useBudgetColumns();
  const BUDGET_COLUMNS: { value: BudgetColumn; label: string }[] = budgetColumns.shown.map((c) => ({ value: c.key, label: c.label }));
  const locale = useLocale();
  const gridLocaleText = useAgGridLocaleText();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const now = new Date();
  const Y = now.getFullYear();

  // Generate years from Y-1 to Y+5
  const years = Array.from({ length: 7 }, (_, i) => Y - 1 + i);

  const [scope, setScope] = useState<BudgetScope>('all');
  const [year, setYear] = useState<number>(Y);
  const [pickedColumn, setColumn] = useState<BudgetColumn | null>(null);
  // A column hidden since it was picked is no longer offered.
  const column = pickedColumn && budgetColumns.shown.some((c) => c.key === pickedColumn) ? pickedColumn : null;
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [clearResult, setClearResult] = useState<{ ok: boolean; message: string } | null>(null);
  // The grid of every line, under the panel: opened from the preview.
  const [showAll, setShowAll] = useState(false);

  const { data: freezeData, isLoading: freezeLoading, isError: freezeFailed } = useFreezeState(year);
  // The natures of the scope whose column is frozen: any refuses the whole reset.
  const frozenNatures = column
    ? SCOPE_NATURES[scope].filter((nature) => freezeData?.summary?.scopes[nature][budgetColumns.get(column).freezeKey]?.frozen)
    : [];
  const columnFrozen = frozenNatures.length > 0;

  // Every line of the window from the selected year, with the column's amount in the line's own
  // currency (what the clear removes), from one server aggregate.
  const request = useMemo(
    () => operationLinesRequest(scope, [year], column ? [{ id: 'current', year, metric: column }] : []),
    [scope, year, column],
  );
  const { data: lines, isLoading } = useBudgetAggregate(scope, request);

  const processedData = useMemo<ProcessedRow[]>(() => {
    if (!lines) return [];
    return readOperationLines(lines, scope).map((line) => ({
      id: line.id,
      itemNumber: line.itemNumber,
      nature: line.nature,
      product_name: line.name,
      currentValue: line.values.current ?? 0,
    }));
  }, [lines, scope]);

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

  const columnLabel = column ? budgetColumns.label(column) : '';

  const columns = useMemo<ColDef[]>(() => [
    {
      field: 'product_name',
      headerName: t('operations.columnReset.product'),
      flex: 1,
      minWidth: 220,
      // The line's page opens in a new tab: the preview stays.
      cellRenderer: OperationLineCell,
    },
    ...(scope === 'all' ? [{
      field: 'nature',
      headerName: t('operations.scope.label'),
      width: 110,
      valueFormatter: (p: { value?: string | null }) => (p.value ? t(`operations.scope.${p.value}`) : ''),
      cellStyle: { color: theme.palette.kanap.text.secondary },
    } as ColDef] : []),
    {
      field: 'currentValue',
      headerName: column ? t('operations.columnReset.currentHeader', { column: columnLabel, year }) : String(year),
      width: 200,
      // The first sort lives on the column: a grid `initialState` would drop the name's flex.
      initialSort: 'desc',
      type: 'rightAligned',
      valueFormatter: (p) => formatOperationAmount(p.value),
      // Values that will be cleared stand out by weight; empty ones stay muted.
      cellStyle: (params) => (params.value !== 0
        ? { color: 'inherit', fontWeight: 500 }
        : { color: theme.palette.kanap.text.tertiary, fontWeight: 400 }),
    },
  ], [column, columnLabel, year, locale, theme, t, scope]);

  const runClear = async () => {
    if (!column) return;
    setIsProcessing(true);
    setClearResult(null);

    try {
      const result = await clearBudgetColumn(scope, {
        year,
        column,
      });
      // The lines' Allocations tabs show their totals: their cached years are read again.
      forgetAllAllocations(queryClient);

      // The lines whose amounts went, as the preview counts them. The server also passes over the
      // lines without an amount in the column (no version of the year, or zero months): nothing to
      // say about them. It clears all or nothing, so no line fails on its own.
      const { cleared } = result.summary;
      setClearResult({
        ok: true,
        message: cleared > 0
          ? t('operations.columnReset.clearDone', { count: cleared })
          : t('operations.columnReset.clearDoneNoAmount'),
      });

      // Every list and report of the budget reads again.
      await Promise.all(Object.values(SUMMARY_QUERY_KEY).map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    } catch (error) {
      console.error('Clear operation failed:', error);
      // A frozen column or another operation running (409): the server's refusal, beside the pill.
      setClearResult({ ok: false, message: getApiErrorMessage(error, t, t('operations.columnReset.clearFailed')) });
    } finally {
      setIsProcessing(false);
    }
  };

  // The five lines with the largest amounts, a negative one by its size; the full grid opens below on demand.
  const previewRows = useMemo(
    () => processedData
      .filter((row) => row.currentValue !== 0)
      .sort((a, b) => Math.abs(b.currentValue) - Math.abs(a.currentValue))
      .map((row) => ({
        id: row.id,
        cells: {
          line: row.product_name,
          nature: row.nature ? t(`operations.scope.${row.nature}`) : '',
          amount: formatOperationAmount(row.currentValue),
        },
      })),
    [processedData, t],
  );
  const loaded = !!column && !isLoading;
  const hasAmounts = loaded && stats.itemsWithData > 0;

  const allLinesLink = loaded && stats.totalItems > 0 ? (
    <Link component="button" type="button" onClick={() => setShowAll((open) => !open)} aria-expanded={showAll} sx={{ fontSize: 13 }}>
      {t(showAll ? 'operations.columnReset.hideAllLines' : 'operations.columnReset.showAllLines', { count: stats.totalItems })}
    </Link>
  ) : undefined;

  let message: React.ReactNode;
  if (!column) message = t('operations.columnReset.chooseColumnFirst');
  else if (isLoading) message = t('operations.columnReset.loadingData');
  else if (stats.itemsWithData === 0) message = t('operations.columnReset.noDataInfo', { column: columnLabel, year });

  // The column names or the freeze of the year not read: a column could be cleared under a name
  // that is not the tenant's, or while it is frozen. Nothing is offered.
  const loadFailed = !!budgetColumns.error || (freezeFailed && !freezeData);

  return (
    <SettingsPage title={t('operations.columnReset.title')} error={loadFailed ? t('operations.columnReset.loadError') : undefined}>
      <OperationPanel
        options={
          <>
            <ReportFilter label={t('operations.scope.label')} width={0}>
              <ItemScopeTabs level="admin" allowAll value={scope} onChange={(next) => { setScope(next); setClearResult(null); }} />
            </ReportFilter>
            <ReportFilter label={t('operations.columnReset.year')} width={120}>
              <TextField
                select
                size="small"
                value={year}
                onChange={(e) => { setYear(parseInt(e.target.value, 10)); setClearResult(null); }}
                SelectProps={{ MenuProps: reportFilterMenuProps }}
                inputProps={{ 'aria-label': t('operations.columnReset.year') }}
                sx={reportFilterSelectSx}
              >
                {years.map((y) => (
                  <MenuItem key={y} value={y} sx={drawerMenuItemSx}>{y}</MenuItem>
                ))}
              </TextField>
            </ReportFilter>
            <ReportFilter label={t('operations.columnReset.budgetColumn')} width={220}>
              <TextField
                select
                size="small"
                value={column ?? ''}
                onChange={(e) => { setColumn(e.target.value as BudgetColumn); setClearResult(null); }}
                SelectProps={{
                  MenuProps: reportFilterMenuProps,
                  displayEmpty: true,
                  renderValue: (value) => (value
                    ? budgetColumns.label(String(value))
                    : <Box component="span" sx={selectPlaceholderSx}>{t('operations.columnReset.chooseColumn')}</Box>),
                }}
                inputProps={{ 'aria-label': t('operations.columnReset.budgetColumn') }}
                sx={reportFilterSelectSx}
              >
                {BUDGET_COLUMNS.map((col) => (
                  <MenuItem key={col.value} value={col.value} sx={drawerMenuItemSx}>{col.label}</MenuItem>
                ))}
              </TextField>
            </ReportFilter>
          </>
        }
        // Every line and its amount, as the server writes them: CSV or Excel, once a column is chosen.
        exportSlot={column ? (
          <ReportExportButton
            url="/budget-lines/budget-operations/clear-column/export"
            params={{ scope, year, column }}
            fileBase={`column-reset-${scope}-${year}-${column}`}
            disabled={isLoading}
          />
        ) : undefined}
        notices={columnFrozen ? (
          <Alert severity="error">
            {frozenNatures.length === 1 && scope === 'all'
              ? t('operations.columnReset.columnFrozenNatureError', { year, column: columnLabel, nature: t(`operations.scope.${frozenNatures[0]}`) })
              : t('operations.columnReset.columnFrozenError', { year, column: columnLabel })}
          </Alert>
        ) : undefined}
        message={message}
        stats={hasAmounts ? [
          { label: t('operations.columnReset.totalItems'), value: stats.totalItems.toLocaleString(locale) },
          { label: t('operations.columnReset.itemsWithData'), value: stats.itemsWithData.toLocaleString(locale) },
          { label: t('operations.columnReset.currentTotalValue'), value: formatOperationAmount(stats.totalValue) },
        ] : undefined}
        preview={loaded ? {
          columns: [
            { key: 'line', label: t('operations.columnReset.product') },
            ...(scope === 'all' ? [{ key: 'nature', label: t('operations.scope.label') }] : []),
            { key: 'amount', label: t('operations.columnReset.currentHeader', { column: columnLabel, year }), align: 'right' as const },
          ],
          rows: previewRows,
          allLines: allLinesLink,
        } : undefined}
        consequence={hasAmounts ? t('operations.columnReset.clearWarning', { column: columnLabel, year, count: stats.itemsWithData }) : undefined}
        action={{
          label: t('operations.columnReset.clearColumn'),
          busyLabel: t('operations.columnReset.processing'),
          busy: isProcessing,
          // A column without amounts can still hold spread periods: the server clears them and skips the rest.
          disabled: !column || stats.totalItems === 0 || freezeLoading || columnFrozen,
          confirm: {
            title: t('operations.columnReset.confirmMessage', { column: columnLabel, year }),
            message: (
              <Stack spacing={1}>
                {/* With no amount left, the reset still removes the spread periods (and how the column was produced). */}
                <span>
                  {stats.itemsWithData > 0
                    ? t('operations.columnReset.confirmAffected', { count: stats.itemsWithData, value: formatOperationAmount(stats.totalValue) })
                    : t('operations.columnReset.confirmPeriodsOnly', { column: columnLabel, year })}
                </span>
                <span>{t('operations.columnReset.confirmKept')}</span>
                <span>{t('operations.columnReset.confirmUndoWarning')}</span>
              </Stack>
            ),
            cancelLabel: t('common:buttons.cancel'),
          },
          onRun: runClear,
        }}
        result={clearResult}
      />

      {showAll && loaded && (
        <SettingsSection variant="flat" title={t('operations.columnReset.allLinesTitle')}>
          <Box component={AgGridBox}>
            <AgGridReact
              localeText={gridLocaleText}
              rowData={processedData}
              columnDefs={columns}
              defaultColDef={{ sortable: true, resizable: true }}
              domLayout="autoHeight"
            />
          </Box>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
