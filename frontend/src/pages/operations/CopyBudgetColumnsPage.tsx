import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Stack,
  TextField,
  MenuItem,
  Paper,
  Typography,
  Switch,
  Checkbox,
  FormControlLabel,
  Alert,
  Tooltip,
  useTheme,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import { useTranslation } from 'react-i18next';
import AgGridBox from '../../components/AgGridBox';
import { operationLinesRequest, readOperationLines } from '../reports/reportAggregates';
import { useBudgetAggregate } from '../reports/useBudgetAggregate';
import { useQueryClient } from '@tanstack/react-query';
import { forgetAllAllocations } from '../../components/finance/allocationsCache';
import { copyBudgetColumn, BudgetColumn, BudgetOperationResult, BudgetScope, CalendarIssue } from '../../services/budgetOperations';
import { useFreezeState } from '../../hooks/useFreezeState';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
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
  sourceValue: number;
  destinationValue: number;
  previewValue?: number;
  willBeSkipped?: boolean;
  /** The item is valid for part of the destination year: only those months are copied. */
  prorated?: boolean;
  /** What the copy does with the calendars of the item's lines priced per day. */
  calendarIssues?: CalendarIssue[];
  /** Present once the dry run has answered for this item. */
  inPreview?: boolean;
};

const noteSx = { fontSize: 12, color: 'kanap.text.tertiary' } as const;

/** A calendar change the copy needs confirmed: a replacement calendar, or none. */
export const needsCalendarConfirmation = (issues: CalendarIssue[] | undefined) => !!issues?.some((issue) => issue.kind !== 'disabled');

/** The item name, with what the dry run says about it: skipped, prorated to its validity, or a calendar change on its lines. */
export function ItemNameCell({ name, skipped, prorated, calendarIssues, year }: {
  name: string;
  skipped?: boolean;
  prorated?: boolean;
  calendarIssues?: CalendarIssue[];
  year: number;
}) {
  const { t } = useTranslation(['ops']);
  // A line without a description is named by its place, in the user's language.
  const lineName = (issue: CalendarIssue) => (issue.line === `Line ${issue.lineNumber}`
    ? t('operations.copyBudgetColumns.lineNumber', { n: issue.lineNumber })
    : issue.line);
  return (
    <Box component="span" sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      <span>{name}</span>
      {skipped && <Box component="span" sx={noteSx}>{t('operations.copyBudgetColumns.skipped')}</Box>}
      {!skipped && prorated && (
        <Tooltip title={t('operations.copyBudgetColumns.proratedHelp', { year })}>
          <Box component="span" sx={noteSx}>{t('operations.copyBudgetColumns.prorated')}</Box>
        </Tooltip>
      )}
      {!skipped && !!calendarIssues?.length && (
        <Tooltip
          title={(
            <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {calendarIssues.map((issue) => (
                <span key={`${issue.lineNumber}-${issue.kind}`}>
                  {t(`operations.copyBudgetColumns.calendarIssue.${issue.kind}`, {
                    line: lineName(issue), calendar: issue.calendar, fallback: issue.fallback, year,
                  })}
                </span>
              ))}
            </Box>
          )}
        >
          <Box component="span" sx={noteSx}>{t('operations.copyBudgetColumns.calendarNote')}</Box>
        </Tooltip>
      )}
    </Box>
  );
}


export default function CopyBudgetColumnsPage() {
  const { t } = useTranslation(['ops']);
  const dialogs = useKanapDialogs();

  // Shown columns only; both sides default to the default column.
  const budgetColumns = useBudgetColumns();
  const BUDGET_COLUMNS: { value: BudgetColumn; label: string }[] = budgetColumns.shown.map((c) => ({ value: c.key, label: c.label }));
  const columnName = (value: BudgetColumn) => budgetColumns.label(value);
  const usableColumn = (picked: BudgetColumn | null): BudgetColumn => (
    picked && budgetColumns.shown.some((c) => c.key === picked) ? picked : budgetColumns.defaultColumn.key
  );
  const locale = useLocale();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const now = new Date();
  const Y = now.getFullYear();

  // Generate years from Y-1 to Y+5
  const years = Array.from({ length: 7 }, (_, i) => Y - 1 + i);

  const [scope, setScope] = useState<BudgetScope>(useDefaultBudgetScope('admin'));
  const [sourceYear, setSourceYear] = useState<number>(Y);
  const [pickedSource, setSourceColumn] = useState<BudgetColumn | null>(null);
  const sourceColumn = usableColumn(pickedSource);
  const [destinationYear, setDestinationYear] = useState<number>(Y + 1);
  const [pickedDestination, setDestinationColumn] = useState<BudgetColumn | null>(null);
  const destinationColumn = usableColumn(pickedDestination);
  // The field holds its own text, cleaned on blur ("03" -> "3"): React does not
  // rewrite a number input whose value already matches, so "03" would stay.
  const [percentageInput, setPercentageInput] = useState('');
  const percentageIncrease = parseFloat(percentageInput) || 0;
  const [overwrite, setOverwrite] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<ProcessedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  // Lines whose calendar has no days for the destination year: the user confirms the change after the dry run.
  const [acceptCalendarChanges, setAcceptCalendarChanges] = useState<boolean>(false);

  const { data: freezeData, isLoading: freezeLoading } = useFreezeState(destinationYear);

  // Fetch data for both source and destination years
  const requiredYears = useMemo(() => {
    const yearsSet = new Set([sourceYear, destinationYear]);
    return Array.from(yearsSet).sort((a, b) => a - b);
  }, [sourceYear, destinationYear]);

  // Every line of the window from the earlier year, with both amounts in the line's own currency, from one server aggregate.
  const request = useMemo(() => operationLinesRequest(scope, requiredYears, [
    { id: 'source', year: sourceYear, metric: sourceColumn },
    { id: 'destination', year: destinationYear, metric: destinationColumn },
  ]), [scope, requiredYears, sourceYear, sourceColumn, destinationYear, destinationColumn]);
  const { data: lines, isLoading } = useBudgetAggregate(scope, request);

  const freezeKey = budgetColumns.get(destinationColumn).freezeKey;
  const destinationFrozen = freezeData?.summary?.scopes[scope][freezeKey]?.frozen ?? false;

  const processedData = useMemo(() => {
    if (!lines) return [];
    // Every item shows in the preview, not just the ones with a source amount.
    return readOperationLines(lines).map((line) => ({
      id: line.id,
      product_name: line.name,
      sourceValue: line.values.source ?? 0,
      destinationValue: line.values.destination ?? 0,
    }));
  }, [lines]);

  // A dry run belongs to the parameters it ran with: any change drops it, and
  // an answer that arrives after a change is ignored.
  const paramsKey = JSON.stringify([scope, sourceYear, sourceColumn, destinationYear, destinationColumn, percentageIncrease, overwrite]);
  const paramsKeyRef = useRef(paramsKey);
  paramsKeyRef.current = paramsKey;
  useEffect(() => {
    setPreviewData([]);
    setShowPreview(false);
    setAcceptCalendarChanges(false);
  }, [paramsKey]);

  const handleDryRun = async () => {
    const runKey = paramsKey;
    setIsProcessing(true);
    // A new dry run asks for the confirmation again.
    setAcceptCalendarChanges(false);
    try {
      const result = await copyBudgetColumn(scope, {
        sourceYear,
        sourceColumn,
        destinationYear,
        destinationColumn,
        percentageIncrease,
        overwrite,
        dryRun: true,
      });

      // Convert API result to our display format, preserving original frontend data
      const preview = result.results.map((apiRow: BudgetOperationResult) => {
        const matchingRow = processedData.find((row: ProcessedRow) => row.id === apiRow.itemId);
        // The server decides month by month; totals cannot tell (a +500 / -500 source is copied).
        const willBeSkipped = apiRow.skipped;
        return {
          id: apiRow.itemId,
          product_name: apiRow.itemName,
          sourceValue: matchingRow?.sourceValue || apiRow.sourceValue, // Use frontend value
          destinationValue: matchingRow?.destinationValue || apiRow.currentDestinationValue, // Use frontend value
          previewValue: apiRow.newValue,
          willBeSkipped,
          prorated: apiRow.prorated,
          calendarIssues: apiRow.calendarIssues ?? [],
        };
      });

      if (paramsKeyRef.current !== runKey) return;
      setPreviewData(preview);
      setShowPreview(true);
    } catch (error) {
      console.error('Dry run failed:', error);
      await dialogs.alert(getApiErrorMessage(error, t, t('operations.copyBudgetColumns.dryRunFailed')));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyData = async () => {
    setIsProcessing(true);
    try {
      const result = await copyBudgetColumn(scope, {
        sourceYear,
        sourceColumn,
        destinationYear,
        destinationColumn,
        percentageIncrease,
        overwrite,
        dryRun: false,
        acceptCalendarChanges,
      });
      // The lines' Allocations tabs show their totals: their cached years are read again.
      forgetAllAllocations(queryClient);

      await dialogs.alert(operationSummary(t, 'operations.copyBudgetColumns.copyDone', result.summary.processed, result.summary.skipped, result.summary.errors));

      // Invalidate and refetch the summary data to show updated values
      await queryClient.invalidateQueries({ queryKey: [scope === 'opex' ? 'spend-items-summary' : 'capex-items-summary'] });

      // Clear the preview state so user can see the updated source data
      setPreviewData([]);
      setShowPreview(false);
      setAcceptCalendarChanges(false);
    } catch (error) {
      console.error('Copy data failed:', error);
      await dialogs.alert(getApiErrorMessage(error, t, t('operations.copyBudgetColumns.copyFailed')));
    } finally {
      setIsProcessing(false);
    }
  };

  const columns = useMemo<ColDef[]>(() => {
    const baseColumns: ColDef[] = [
      {
        field: 'product_name',
        headerName: t('operations.copyBudgetColumns.product'),
        flex: 1,
        minWidth: 220,
        cellRenderer: (params: any) => (
          <ItemNameCell
            name={params.value}
            skipped={showPreview && params.data?.willBeSkipped}
            prorated={showPreview && params.data?.prorated}
            calendarIssues={showPreview ? params.data?.calendarIssues : undefined}
            year={destinationYear}
          />
        ),
      },
      {
        field: 'sourceValue',
        headerName: t('operations.copyBudgetColumns.sourceHeader', { column: columnName(sourceColumn), year: sourceYear }),
        width: 160,
        type: 'rightAligned',
        valueFormatter: (p) => formatOperationAmount(p.value),
      },
      {
        field: 'destinationValue',
        headerName: t('operations.copyBudgetColumns.currentHeader', { column: columnName(destinationColumn), year: destinationYear }),
        width: 180,
        type: 'rightAligned',
        valueFormatter: (p) => formatOperationAmount(p.value),
      },
    ];

    if (showPreview) {
      baseColumns.push({
        field: 'previewValue',
        headerName: t('operations.copyBudgetColumns.previewHeader', { column: columnName(destinationColumn), year: destinationYear }),
        width: 180,
        type: 'rightAligned',
        valueFormatter: (p) => formatOperationAmount(p.value),
        // A skipped item keeps its current value: shown muted.
        cellStyle: (params) => (params.data?.willBeSkipped
          ? { color: theme.palette.kanap.text.tertiary, fontWeight: 400 }
          : { color: 'inherit', fontWeight: 500 }),
      });
    }

    return baseColumns;
  }, [budgetColumns, destinationColumn, destinationYear, locale, showPreview, sourceColumn, sourceYear, t, theme]);

  const gridApiRef = useRef<any>(null);

  // Always show original data, but merge in preview values when available
  const displayData = useMemo(() => {
    if (!showPreview) {
      return processedData;
    }

    // Create a map of preview data by id for quick lookup
    const previewMap = new Map(previewData.map(p => [p.id, p]));

    // The dry run answers only for items valid in the destination year; any
    // other item is left alone by the copy, so it shows as skipped and keeps
    // its current destination value.
    return processedData.map((row: ProcessedRow) => {
      const preview = previewMap.get(row.id);
      return {
        ...row,
        previewValue: preview ? preview.previewValue : row.destinationValue,
        willBeSkipped: preview ? preview.willBeSkipped : true,
        prorated: preview?.prorated,
        calendarIssues: preview?.calendarIssues,
        inPreview: !!preview,
      };
    });
  }, [processedData, previewData, showPreview]);

  const stats = useMemo(() => {
    const totalItems = displayData.length;
    const totalSource = displayData.reduce((sum: number, row: ProcessedRow) => sum + row.sourceValue, 0);
    const totalDestinationCurrent = displayData.reduce((sum: number, row: ProcessedRow) => sum + row.destinationValue, 0);
    const totalPreview = showPreview
      ? displayData.reduce((sum: number, row: ProcessedRow) => sum + (row.previewValue || 0), 0)
      : 0;
    const itemsWithExistingData = displayData.filter((row: ProcessedRow) => row.destinationValue !== 0).length;
    const itemsToBeProcessed = showPreview
      ? displayData.filter((row: ProcessedRow) => row.inPreview && !row.willBeSkipped).length
      : displayData.filter((row: ProcessedRow) => row.sourceValue !== 0 && (overwrite || row.destinationValue === 0)).length;

    // Items the copy writes whose lines change calendar or cannot be recalculated.
    const itemsWithCalendarChanges = showPreview
      ? displayData.filter((row: ProcessedRow) => row.inPreview && !row.willBeSkipped && needsCalendarConfirmation(row.calendarIssues)).length
      : 0;

    return {
      totalItems,
      itemsWithCalendarChanges,
      totalSource,
      totalDestinationCurrent,
      totalPreview,
      itemsWithExistingData,
      itemsToBeProcessed,
    };
  }, [displayData, showPreview, overwrite]);

  const statSx = { display: 'flex', flexDirection: 'column', gap: '2px' } as const;
  const statLabelSx = { fontSize: 12, color: 'kanap.text.tertiary' } as const;
  const statValueSx = { fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' } as const;

  const yearSelect = (label: string, value: number, onChange: (next: number) => void) => (
    <ReportFilter label={label} width={120}>
      <TextField
        select
        size="small"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        SelectProps={{ MenuProps: reportFilterMenuProps }}
        sx={reportFilterSelectSx}
      >
        {years.map((year) => (
          <MenuItem key={year} value={year} sx={drawerMenuItemSx}>{year}</MenuItem>
        ))}
      </TextField>
    </ReportFilter>
  );
  const columnSelect = (label: string, value: BudgetColumn, onChange: (next: BudgetColumn) => void) => (
    <ReportFilter label={label} width={170}>
      <TextField
        select
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value as BudgetColumn)}
        SelectProps={{ MenuProps: reportFilterMenuProps }}
        sx={reportFilterSelectSx}
      >
        {BUDGET_COLUMNS.map((col) => (
          <MenuItem key={col.value} value={col.value} sx={drawerMenuItemSx}>{col.label}</MenuItem>
        ))}
      </TextField>
    </ReportFilter>
  );

  return (
    <ReportLayout
      rootTo="/ops/operations"
      rootLabel={t('operations.title')}
      title={t('operations.copyBudgetColumns.title')}
      subtitle={t('operations.copyBudgetColumns.subtitle')}
      filters={
        <>
          <ItemScopeTabs level="admin" value={scope} onChange={setScope} />
          {yearSelect(t('operations.copyBudgetColumns.sourceYear'), sourceYear, setSourceYear)}
          {columnSelect(t('operations.copyBudgetColumns.sourceColumn'), sourceColumn, setSourceColumn)}
          {yearSelect(t('operations.copyBudgetColumns.destinationYear'), destinationYear, setDestinationYear)}
          {columnSelect(t('operations.copyBudgetColumns.destinationColumn'), destinationColumn, setDestinationColumn)}
          <ReportFilter label={t('operations.copyBudgetColumns.percentageIncrease')} width={120}>
            <Tooltip title={t('operations.copyBudgetColumns.roundingNote')} placement="top">
              <TextField
                size="small"
                type="number"
                value={percentageInput}
                placeholder="0"
                onChange={(e) => setPercentageInput(e.target.value)}
                onBlur={(e) => {
                  const parsed = parseFloat(e.target.value);
                  setPercentageInput(Number.isFinite(parsed) && parsed !== 0 ? String(parsed) : '');
                }}
                inputProps={{ step: 0.1, 'aria-label': t('operations.copyBudgetColumns.percentageIncrease') }}
                sx={reportFilterSelectSx}
              />
            </Tooltip>
          </ReportFilter>
          <FormControlLabel
            control={
              <Switch
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                size="small"
              />
            }
            label={<Typography sx={{ fontSize: 13 }}>{t('operations.copyBudgetColumns.overwriteExisting')}</Typography>}
            sx={{ ml: 1 }}
          />
        </>
      }
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            variant="action"
            onClick={handleDryRun}
            disabled={isProcessing || processedData.length === 0 || freezeLoading || destinationFrozen || !budgetColumns.ready}
          >
            {isProcessing ? t('operations.copyBudgetColumns.processing') : t('operations.copyBudgetColumns.dryRun')}
          </Button>
          <Button
            variant="action-primary"
            onClick={handleCopyData}
            disabled={
              isProcessing || processedData.length === 0 || !showPreview || freezeLoading || destinationFrozen
              || (stats.itemsWithCalendarChanges > 0 && !acceptCalendarChanges)
            }
          >
            {isProcessing ? t('operations.copyBudgetColumns.processing') : t('operations.copyBudgetColumns.copyData')}
          </Button>
        </Stack>
      }
      onExportTableCsv={() => gridApiRef.current?.exportDataAsCsv?.()}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        {destinationFrozen && (
          <Alert severity="error">
            {t('operations.copyBudgetColumns.frozenError', { year: destinationYear, column: columnName(destinationColumn) })}
          </Alert>
        )}

        {stats.itemsWithExistingData > 0 && !overwrite && (
          <Alert severity="warning">
            {t('operations.copyBudgetColumns.existingDataWarning', { count: stats.itemsWithExistingData })}
          </Alert>
        )}

        {showPreview && (
          <Alert severity="info">
            {t('operations.copyBudgetColumns.previewInfo', { count: stats.totalItems, toProcess: stats.itemsToBeProcessed, skipped: stats.totalItems - stats.itemsToBeProcessed })}
          </Alert>
        )}

        {stats.itemsWithCalendarChanges > 0 && (
          <Alert severity="warning">
            <Typography sx={{ fontSize: 13 }}>
              {t('operations.copyBudgetColumns.calendarAlert', { count: stats.itemsWithCalendarChanges, year: destinationYear })}
            </Typography>
            <FormControlLabel
              control={(
                <Checkbox
                  size="small"
                  checked={acceptCalendarChanges}
                  onChange={(e) => setAcceptCalendarChanges(e.target.checked)}
                />
              )}
              label={<Typography sx={{ fontSize: 13 }}>{t('operations.copyBudgetColumns.acceptCalendarChanges')}</Typography>}
              sx={{ mt: 0.5 }}
            />
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography sx={{ mb: 1, fontSize: 16, fontWeight: 500 }}>
            {t('operations.copyBudgetColumns.dataPreview')}
          </Typography>
          <Box component={AgGridBox}>
            <AgGridReact
              rowData={displayData}
              columnDefs={columns}
              defaultColDef={{ sortable: true, resizable: true }}
              initialState={{
                sort: {
                  sortModel: [{ colId: 'sourceValue', sort: 'desc' }],
                },
              }}
              onGridReady={(e) => { gridApiRef.current = e.api; }}
              domLayout="autoHeight"
            />
          </Box>

          <Box sx={{ mt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' } }}>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.totalItems')}</Typography>
              <Typography sx={statValueSx}>{stats.totalItems.toLocaleString(locale)}</Typography>
            </Box>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.itemsToProcess')}</Typography>
              <Typography sx={statValueSx}>{stats.itemsToBeProcessed.toLocaleString(locale)}</Typography>
            </Box>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.sourceTotal')}</Typography>
              <Typography sx={statValueSx}>{formatOperationAmount(stats.totalSource)}</Typography>
            </Box>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.currentDestTotal')}</Typography>
              <Typography sx={statValueSx}>{formatOperationAmount(stats.totalDestinationCurrent)}</Typography>
            </Box>
            {showPreview && (
              <Box sx={statSx}>
                <Typography sx={statLabelSx}>{t('operations.copyBudgetColumns.previewTotal')}</Typography>
                <Typography sx={statValueSx}>{formatOperationAmount(stats.totalPreview)}</Typography>
              </Box>
            )}
          </Box>
        </Paper>
      </Stack>
      {isLoading && (
        <Typography sx={{ mt: 1, fontSize: 13, color: 'kanap.text.secondary' }}>{t('operations.copyBudgetColumns.loadingData')}</Typography>
      )}
    </ReportLayout>
  );
}
