import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import { useAgGridLocaleText } from '../../components/grid/useAgGridLocaleText';
import type { CellStyle, ColDef } from 'ag-grid-community';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReportLayout, { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import AgGridBox from '../../components/AgGridBox';
import { forgetAllAllocations } from '../../components/finance/allocationsCache';
import { useKanapDialogs } from '../../components/design';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { useFreezeState } from '../../hooks/useFreezeState';
import FormattedNumberField from '../../components/inputs/FormattedNumberField';
import { decimalMark } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';
import { AllocationRuleResolution, fetchAllocationRule } from '../../services/allocationRules';
import { allocationMethodLabel } from '../../utils/allocationLabels';
import {
  AllocationsPart,
  AmountsPart,
  BudgetColumn,
  BudgetScope,
  CalendarIssue,
  copyBudget,
  CopyBudgetOperation,
  CopyBudgetResponse,
} from '../../services/budgetOperations';
import { drawerMenuItemSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { operationLinesRequest, readOperationLines } from '../reports/reportAggregates';
import { SUMMARY_QUERY_KEY, useBudgetAggregate } from '../reports/useBudgetAggregate';
import ItemScopeTabs, { SCOPE_NATURES } from './ItemScopeTabs';
import OperationLineCell from './OperationLineCell';
import { formatOperationAmount } from './operationAmount';
import { copyAfterValue, copyAllocationsStatus, copyAmountsStatus, copyBudgetRows, type CopyRow, type CopyStatus } from './copyBudgetRows';

/** One budget line of the table: what the aggregate reads, and what the copy answered for it (`copyBudgetRows.ts`). */
type Row = CopyRow<AmountsPart, AllocationsPart>;

/** The copy's answer, for a preview or once done. */
type Outcome = { mode: 'preview' | 'done'; response: CopyBudgetResponse };

type Tone = 'copy' | 'skip' | 'error';
type Status = { text: string; tone: Tone };

const noteSx = { fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 } as const;

/** A calendar change the copy needs confirmed: a replacement calendar, or none. */
export const needsCalendarConfirmation = (issues: CalendarIssue[] | undefined) => !!issues?.some((issue) => issue.kind !== 'disabled');

/**
 * The server refused the copy with a 4xx answer: its transaction rolled back and nothing was written.
 * Without such an answer (no answer in time, a network error, a 5xx) the copy may have been saved: its
 * result is unknown.
 */
export function copyRefusedByServer(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** What the copy says about a line's amounts besides its status: prorated to its dates, or a calendar change on its lines. */
function LineNotes({ part, year }: { part?: AmountsPart; year: number }) {
  const { t } = useTranslation(['ops']);
  if (!part || part.skipped) return null;
  // A line without a description is named by its place, in the user's language.
  const lineName = (issue: CalendarIssue) => (issue.line === `Line ${issue.lineNumber}`
    ? t('operations.copyBudget.lineNumber', { n: issue.lineNumber })
    : issue.line);
  return (
    <>
      {part.prorated && (
        <Tooltip title={t('operations.copyBudget.proratedHelp', { year })}>
          <Box component="span" sx={noteSx}>{t('operations.copyBudget.prorated')}</Box>
        </Tooltip>
      )}
      {part.calendarIssues.length > 0 && (
        <Tooltip
          title={(
            <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {part.calendarIssues.map((issue) => (
                <span key={`${issue.lineNumber}-${issue.kind}`}>
                  {t(`operations.copyBudget.calendarIssue.${issue.kind}`, {
                    line: lineName(issue), calendar: issue.calendar, fallback: issue.fallback, year,
                  })}
                </span>
              ))}
            </Box>
          )}
        >
          <Box component="span" sx={noteSx}>{t('operations.copyBudget.calendarNote')}</Box>
        </Tooltip>
      )}
    </>
  );
}

/**
 * "Copy budget columns" of Budget administration: the amounts of a column (to another year or column, with a
 * percentage), the allocations (to another year), or both, for all lines, OPEX or CAPEX. One preview
 * shows both parts line by line, then one copy writes them (`POST /budget-lines/budget-operations/copy`).
 */
export default function CopyBudgetPage() {
  const { t } = useTranslation(['ops']);
  const dialogs = useKanapDialogs();
  const theme = useTheme();
  const locale = useLocale();
  // The application language decides the decimal mark, not the browser.
  const separator = decimalMark(locale);
  const gridLocaleText = useAgGridLocaleText();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // Shown columns only; both sides default to the default column.
  const budgetColumns = useBudgetColumns();
  const columnOptions: { value: BudgetColumn; label: string }[] = budgetColumns.shown.map((c) => ({ value: c.key, label: c.label }));
  const usableColumn = (picked: BudgetColumn | null): BudgetColumn => (
    picked && budgetColumns.shown.some((c) => c.key === picked) ? picked : budgetColumns.defaultColumn.key
  );
  const Y = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => Y - 1 + i);

  const [scope, setScope] = useState<BudgetScope>('all');
  const [sourceYear, setSourceYear] = useState<number>(Y);
  const [destinationYear, setDestinationYear] = useState<number>(Y + 1);
  // The former allocation copy opens this page with the amounts unticked (`?amounts=0`).
  const [copyAmounts, setCopyAmounts] = useState<boolean>(searchParams.get('amounts') !== '0');
  const [allocationsWanted, setAllocationsWanted] = useState<boolean>(true);
  const [pickedSource, setSourceColumn] = useState<BudgetColumn | null>(null);
  const [pickedDestination, setDestinationColumn] = useState<BudgetColumn | null>(null);
  const sourceColumn = usableColumn(pickedSource);
  const destinationColumn = usableColumn(pickedDestination);
  // Point-decimal text ("" when empty or zero). The field shows the language's
  // decimal mark; blur drops a lone zero and a leading zero ("03" -> "3").
  const [percentageInput, setPercentageInput] = useState('');
  const percentageIncrease = parseFloat(percentageInput) || 0;
  const [overwrite, setOverwrite] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  // Lines whose calendar has no days for the destination year: the user confirms the change after the preview.
  const [acceptCalendarChanges, setAcceptCalendarChanges] = useState<boolean>(false);

  // Allocations belong to a year: offered only between two years, ticked by default there.
  const yearsDiffer = sourceYear !== destinationYear;
  const copyAllocations = yearsDiffer && allocationsWanted;
  const hasPart = copyAmounts || copyAllocations;
  const pickYears = (source: number, destination: number) => {
    setSourceYear(source);
    setDestinationYear(destination);
    if (source === destination) setAllocationsWanted(true);
  };

  const natures = SCOPE_NATURES[scope];
  const { data: freezeData, isLoading: freezeLoading } = useFreezeState(destinationYear);
  const freezeKey = budgetColumns.get(destinationColumn).freezeKey;
  const frozenNatures = copyAmounts ? natures.filter((nature) => freezeData?.summary?.scopes[nature][freezeKey]?.frozen) : [];

  // Every line of the window from the earlier year, with both amounts in the line's own currency, from one server aggregate.
  const request = useMemo(() => operationLinesRequest(
    scope,
    [sourceYear, destinationYear],
    copyAmounts
      ? [{ id: 'source', year: sourceYear, metric: sourceColumn }, { id: 'destination', year: destinationYear, metric: destinationColumn }]
      : [],
  ), [scope, sourceYear, destinationYear, copyAmounts, sourceColumn, destinationColumn]);
  const { data: lines, isLoading } = useBudgetAggregate(scope, request);

  // Lines left on the default allocation follow the default of their own year, which the copy does not
  // carry over: the preview says when the two years differ.
  const ruleQuery = (year: number) => ({ queryKey: ['allocation-rule', year], queryFn: () => fetchAllocationRule(year), staleTime: 60_000, retry: false, enabled: copyAllocations });
  const { data: sourceRule } = useQuery(ruleQuery(sourceYear));
  const { data: destinationRule } = useQuery(ruleQuery(destinationYear));
  const ruleLabel = useCallback((rule: AllocationRuleResolution | undefined): string => {
    if (!rule) return '';
    if (rule.mode === 'manual_company') return t('operations.copyBudget.defaultManualLabel', { count: rule.company_ids?.length ?? 0 });
    return t(`opex.allocations.${rule.method === 'it_users' ? 'itUsers' : rule.method}`);
  }, [t]);

  // An answer belongs to the parameters it ran with: any change drops it, and one that arrives after a change is ignored.
  const paramsKey = JSON.stringify([scope, sourceYear, destinationYear, copyAmounts, sourceColumn, destinationColumn, percentageIncrease, copyAllocations, overwrite]);
  const paramsKeyRef = useRef(paramsKey);
  paramsKeyRef.current = paramsKey;
  useEffect(() => {
    setOutcome(null);
    setAcceptCalendarChanges(false);
  }, [paramsKey]);

  // The window's lines joined with the copy's answer, by the rule the API's export runs too.
  const rows = useMemo<Row[]>(() => copyBudgetRows(readOperationLines(lines, scope), outcome?.response.results), [lines, outcome, scope]);

  const done = outcome?.mode === 'done';
  // A status of `copyBudgetRows.ts` in words: `year`, the method's name and the error fill the message.
  const statusText = useCallback((status: CopyStatus | null): Status | null => {
    if (!status) return null;
    const options: Record<string, unknown> = {};
    if (status.year !== undefined) options.year = status.year;
    if (status.method !== undefined) options.method = allocationMethodLabel(t, status.method);
    if (status.message !== undefined) options.message = status.message;
    const key = `operations.copyBudget.status.${status.key}`;
    return { text: Object.keys(options).length > 0 ? t(key, options) : t(key), tone: status.tone };
  }, [t]);
  const amountsStatus = useCallback((row: Row | undefined): Status | null => (
    outcome && row ? statusText(copyAmountsStatus(row, { done, sourceYear, destinationYear })) : null
  ), [outcome, done, destinationYear, sourceYear, statusText]);
  const allocationsStatus = useCallback((row: Row | undefined): Status | null => (
    outcome && row ? statusText(copyAllocationsStatus(row, { done, sourceYear, destinationYear })) : null
  ), [outcome, done, destinationYear, sourceYear, statusText]);

  const toneStyle = useCallback((status: Status | null): CellStyle => {
    if (status?.tone === 'error') return { color: theme.palette.kanap.danger, fontWeight: 500 };
    if (status?.tone === 'skip') return { color: theme.palette.kanap.text.tertiary, fontWeight: 400 };
    return { color: 'inherit', fontWeight: 500 };
  }, [theme]);

  const stats = useMemo(() => {
    const answered = rows.filter((row) => row.answered);
    return {
      totalLines: rows.length,
      answeredLines: answered.length,
      // Before the preview, an estimate from the totals; the preview decides month by month.
      amountsToCopy: outcome
        ? answered.filter((row) => row.amounts && !row.amounts.skipped).length
        : rows.filter((row) => row.sourceValue !== 0 && (overwrite || row.destinationValue === 0)).length,
      allocationsToCopy: answered.filter((row) => row.allocations?.action === 'copy').length,
      sourceTotal: rows.reduce((sum, row) => sum + row.sourceValue, 0),
      currentTotal: rows.reduce((sum, row) => sum + row.destinationValue, 0),
      afterTotal: rows.reduce((sum, row) => sum + copyAfterValue(row), 0),
      withAmounts: rows.filter((row) => row.destinationValue !== 0).length,
      allocationsKept: answered.filter((row) => row.allocations?.action === 'skip_destination_has_data').length,
      methodsReplaced: answered.filter((row) => row.allocations?.action === 'copy' && row.allocations.destinationAllocationsCount === 0
        && row.allocations.destinationMethod != null && row.allocations.destinationMethod !== row.allocations.resultMethod).length,
      onDefault: answered.filter((row) => row.allocations?.sourceMethod === 'default').length,
      allocationErrors: answered.filter((row) => row.allocations?.action === 'error').length,
      // Lines the copy writes whose lines change calendar or cannot be recalculated.
      calendarChanges: answered.filter((row) => row.amounts && !row.amounts.skipped && needsCalendarConfirmation(row.amounts.calendarIssues)).length,
    };
  }, [rows, outcome, overwrite]);

  const defaultBasisChanged = copyAllocations && !!sourceRule && !!destinationRule
    && (sourceRule.mode !== destinationRule.mode || sourceRule.method !== destinationRule.method);

  const operation = (dryRun: boolean): CopyBudgetOperation => ({
    scope,
    sourceYear,
    destinationYear,
    amounts: copyAmounts
      ? { sourceColumn, destinationColumn, percentageIncrease, ...(dryRun ? {} : { acceptCalendarChanges }) }
      : null,
    allocations: copyAllocations,
    overwrite,
    dryRun,
  });

  /**
   * The preview's or the copy's summary: lines, then what each part does or did, then the allocation errors.
   * The copy answers the lines valid in the destination year; `leftOut` counts the table's other lines, so the
   * count matches the table.
   */
  const summaryText = (response: CopyBudgetResponse, isDone: boolean, leftOut = 0) => {
    const counts = response.summary;
    const part = (name: 'amounts' | 'allocations') => (counts[name]
      ? t(`operations.copyBudget.summary.${name}${isDone ? 'Done' : ''}`, { processed: counts[name]!.processed, skipped: counts[name]!.skipped })
      : null);
    const errors = response.results.filter((line) => line.allocations?.action === 'error').length;
    return [
      t(isDone ? 'operations.copyBudget.summary.done' : 'operations.copyBudget.summary.preview', { count: counts.lines + leftOut }),
      leftOut > 0 ? t('operations.copyBudget.summary.leftOut', { count: leftOut, year: destinationYear }) : null,
      part('amounts'),
      part('allocations'),
      errors > 0 ? t('operations.copyBudget.summary.errors', { count: errors }) : null,
    ].filter(Boolean).join(' ');
  };

  const handlePreview = async () => {
    const runKey = paramsKey;
    setIsProcessing(true);
    // A new preview asks for the calendar confirmation again.
    setAcceptCalendarChanges(false);
    try {
      const response = await copyBudget(operation(true));
      if (paramsKeyRef.current !== runKey) return;
      setOutcome({ mode: 'preview', response });
    } catch (error) {
      console.error('Copy preview failed:', error);
      await dialogs.alert(getApiErrorMessage(error, t, t('operations.copyBudget.previewFailed')));
    } finally {
      setIsProcessing(false);
    }
  };

  // The lines' Allocations tabs and every list and report of the budget read again.
  const refreshBudget = async () => {
    forgetAllAllocations(queryClient);
    await Promise.all(Object.values(SUMMARY_QUERY_KEY).map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };

  const handleCopy = async () => {
    const runKey = paramsKey;
    setIsProcessing(true);
    try {
      const response = await copyBudget(operation(false));
      await refreshBudget();
      setAcceptCalendarChanges(false);
      if (paramsKeyRef.current !== runKey) {
        // The parameters changed meanwhile: the table would show this copy under other headers. Say it is done, without it.
        await dialogs.alert(summaryText(response, true));
        return;
      }
      setOutcome({ mode: 'done', response });
    } catch (error) {
      console.error('Copy failed:', error);
      if (copyRefusedByServer(error)) {
        await dialogs.alert(getApiErrorMessage(error, t, t('operations.copyBudget.copyFailed')));
        return;
      }
      // Maybe saved: the preview is stale and the budget is read again.
      setOutcome(null);
      await refreshBudget();
      await dialogs.alert(t('operations.copyBudget.copyUnknown'));
    } finally {
      setIsProcessing(false);
    }
  };

  const columnName = (value: BudgetColumn) => budgetColumns.label(value);
  const columns = useMemo<ColDef<Row>[]>(() => {
    const defs: ColDef<Row>[] = [
      {
        field: 'name',
        headerName: t('operations.copyBudget.line'),
        flex: 1,
        minWidth: 240,
        cellRenderer: (params: any) => (
          <OperationLineCell {...params} notes={outcome ? <LineNotes part={params.data?.amounts} year={destinationYear} /> : undefined} />
        ),
      },
    ];
    if (scope === 'all') {
      defs.push({
        field: 'nature',
        headerName: t('operations.scope.label'),
        width: 110,
        valueFormatter: (p) => (p.value ? t(`operations.scope.${p.value}`) : ''),
        cellStyle: { color: theme.palette.kanap.text.secondary },
      });
    }
    if (copyAmounts) {
      defs.push(
        {
          field: 'sourceValue',
          headerName: t('operations.copyBudget.sourceHeader', { column: columnName(sourceColumn), year: sourceYear }),
          width: 150,
          type: 'rightAligned',
          valueFormatter: (p) => formatOperationAmount(p.value),
        },
        {
          field: 'destinationValue',
          headerName: t('operations.copyBudget.currentHeader', { column: columnName(destinationColumn), year: destinationYear }),
          width: 170,
          type: 'rightAligned',
          valueFormatter: (p) => formatOperationAmount(p.value),
        },
      );
      if (outcome) {
        defs.push(
          {
            colId: 'afterValue',
            headerName: t('operations.copyBudget.afterHeader', { column: columnName(destinationColumn), year: destinationYear }),
            width: 190,
            type: 'rightAligned',
            valueGetter: (p) => (p.data ? copyAfterValue(p.data) : 0),
            valueFormatter: (p) => formatOperationAmount(p.value),
            // A skipped line keeps its current value: shown muted.
            cellStyle: (p) => (amountsStatus(p.data)?.tone === 'skip' ? { color: theme.palette.kanap.text.tertiary, fontWeight: 400 } : { color: 'inherit', fontWeight: 500 }),
          },
          {
            colId: 'amountsStatus',
            headerName: t('operations.copyBudget.amountsStatus'),
            width: 230,
            valueGetter: (p) => amountsStatus(p.data)?.text ?? '',
            cellStyle: (p) => toneStyle(amountsStatus(p.data)),
          },
        );
      }
    }
    if (copyAllocations && outcome) {
      const method = (pick: (part: AllocationsPart) => string) => (row: Row | undefined) => (row?.allocations ? pick(row.allocations) || '—' : '—');
      defs.push(
        {
          colId: 'allocationSource',
          headerName: t('operations.copyBudget.allocationSource', { year: sourceYear }),
          width: 170,
          valueGetter: (p) => method((part) => allocationMethodLabel(t, part.sourceMethod))(p.data),
        },
        {
          colId: 'allocationCurrent',
          headerName: t('operations.copyBudget.allocationCurrent', { year: destinationYear }),
          width: 190,
          valueGetter: (p) => method((part) => allocationMethodLabel(t, part.destinationMethod))(p.data),
        },
        {
          colId: 'allocationAfter',
          headerName: t('operations.copyBudget.allocationAfter', { year: destinationYear }),
          width: 210,
          valueGetter: (p) => method((part) => allocationMethodLabel(t, part.resultMethod))(p.data),
        },
        {
          colId: 'allocationsStatus',
          headerName: t('operations.copyBudget.allocationsStatus'),
          width: 250,
          valueGetter: (p) => allocationsStatus(p.data)?.text ?? '',
          cellStyle: (p) => toneStyle(allocationsStatus(p.data)),
        },
      );
    }
    return defs;
  }, [scope, copyAmounts, copyAllocations, outcome, sourceColumn, destinationColumn, sourceYear, destinationYear, budgetColumns, locale, theme, t, amountsStatus, allocationsStatus, toneStyle]);

  const statSx = { display: 'flex', flexDirection: 'column', gap: '2px' } as const;
  const statLabelSx = { fontSize: 12, color: 'kanap.text.tertiary' } as const;
  const statValueSx = { fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' } as const;
  const checkboxLabelSx = { fontSize: 13 } as const;
  // Ticks and the switch sit in a box as tall as a field, so they line up with the selects of the bar.
  const controlRowSx = { display: 'flex', alignItems: 'center', gap: 2, height: 32 } as const;
  const controlLabelSx = { ml: -0.75, mr: 0, gap: 0.5 } as const;
  const controlSx = { p: 0.75 } as const;

  const yearSelect = (label: string, value: number, onChange: (next: number) => void) => (
    <ReportFilter label={label} width={120}>
      <TextField
        select
        size="small"
        value={value}
        disabled={isProcessing}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        SelectProps={{ MenuProps: reportFilterMenuProps, SelectDisplayProps: { 'aria-label': label } as React.HTMLAttributes<HTMLDivElement> }}
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
        disabled={isProcessing}
        onChange={(e) => onChange(e.target.value as BudgetColumn)}
        SelectProps={{ MenuProps: reportFilterMenuProps, SelectDisplayProps: { 'aria-label': label } as React.HTMLAttributes<HTMLDivElement> }}
        sx={reportFilterSelectSx}
      >
        {columnOptions.map((col) => (
          <MenuItem key={col.value} value={col.value} sx={drawerMenuItemSx}>{col.label}</MenuItem>
        ))}
      </TextField>
    </ReportFilter>
  );

  const frozenMessage = frozenNatures.length === 1 && scope === 'all'
    ? t('operations.copyBudget.frozenNatureError', { year: destinationYear, column: columnName(destinationColumn), nature: t(`operations.scope.${frozenNatures[0]}`) })
    : t('operations.copyBudget.frozenError', { year: destinationYear, column: columnName(destinationColumn) });

  return (
    <ReportLayout
      title={t('operations.copyBudget.title')}
      subtitle={t('operations.copyBudget.subtitle')}
      filters={
        <>
          <ItemScopeTabs level="admin" allowAll value={scope} onChange={setScope} disabled={isProcessing} />
          {yearSelect(t('operations.copyBudget.sourceYear'), sourceYear, (year) => pickYears(year, destinationYear))}
          {yearSelect(t('operations.copyBudget.destinationYear'), destinationYear, (year) => pickYears(sourceYear, year))}
          <ReportFilter label={t('operations.copyBudget.partsLabel')} width={0}>
            <Box sx={controlRowSx}>
              <Tooltip title={t('operations.copyBudget.amountsHelp')} placement="top" describeChild>
                <FormControlLabel
                  sx={controlLabelSx}
                  control={<Checkbox size="small" sx={controlSx} checked={copyAmounts} disabled={isProcessing} onChange={(e) => setCopyAmounts(e.target.checked)} />}
                  label={<Typography sx={checkboxLabelSx}>{t('operations.copyBudget.amounts')}</Typography>}
                />
              </Tooltip>
              {yearsDiffer && (
                <Tooltip title={t('operations.copyBudget.allocationsHelp')} placement="top" describeChild>
                  <FormControlLabel
                    sx={controlLabelSx}
                    control={<Checkbox size="small" sx={controlSx} checked={allocationsWanted} disabled={isProcessing} onChange={(e) => setAllocationsWanted(e.target.checked)} />}
                    label={<Typography sx={checkboxLabelSx}>{t('operations.copyBudget.allocations')}</Typography>}
                  />
                </Tooltip>
              )}
            </Box>
          </ReportFilter>
          {copyAmounts && (
            <>
              {columnSelect(t('operations.copyBudget.sourceColumn'), sourceColumn, setSourceColumn)}
              {columnSelect(t('operations.copyBudget.destinationColumn'), destinationColumn, setDestinationColumn)}
              <ReportFilter label={t('operations.copyBudget.percentageIncrease')} width={96}>
                <Tooltip title={t('operations.copyBudget.percentageHelp')} placement="top" describeChild>
                  <FormattedNumberField
                    size="small"
                    decimals={1}
                    emit="string"
                    decimalSeparator={separator}
                    value={percentageInput}
                    disabled={isProcessing}
                    placeholder="0"
                    onChange={(e) => setPercentageInput(String(e.target.value ?? ''))}
                    onBlur={(e) => {
                      const parsed = parseFloat(String(e.target.value ?? '').replace(/\s+/g, '').replace(',', '.'));
                      setPercentageInput(Number.isFinite(parsed) && parsed !== 0 ? String(parsed) : '');
                    }}
                    inputProps={{ 'aria-label': t('operations.copyBudget.percentageIncrease') }}
                    InputProps={{ endAdornment: <InputAdornment position="end"><Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>%</Typography></InputAdornment> }}
                    sx={{ ...reportFilterSelectSx, width: 96 }}
                  />
                </Tooltip>
              </ReportFilter>
            </>
          )}
          <Box sx={controlRowSx}>
            <Tooltip title={t('operations.copyBudget.overwriteHelp')} placement="top" describeChild>
              <FormControlLabel
                sx={controlLabelSx}
                control={<Switch size="small" checked={overwrite} disabled={isProcessing} onChange={(e) => setOverwrite(e.target.checked)} />}
                label={<Typography sx={checkboxLabelSx}>{t('operations.copyBudget.overwrite')}</Typography>}
              />
            </Tooltip>
          </Box>
        </>
      }
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            variant="action"
            onClick={handlePreview}
            disabled={isProcessing || !hasPart || rows.length === 0 || (copyAmounts && (freezeLoading || frozenNatures.length > 0)) || !budgetColumns.ready}
          >
            {isProcessing ? t('operations.copyBudget.processing') : t('operations.copyBudget.preview')}
          </Button>
          <Button
            variant="action-primary"
            onClick={handleCopy}
            disabled={
              isProcessing || outcome?.mode !== 'preview' || frozenNatures.length > 0 || stats.allocationErrors > 0
              || (stats.calendarChanges > 0 && !acceptCalendarChanges)
            }
          >
            {isProcessing ? t('operations.copyBudget.processing') : t('operations.copyBudget.copy')}
          </Button>
        </Stack>
      }
      // The preview of these parameters, written by the server (the copy's dry run again): CSV or Excel.
      // Once the copy has run, the table shows what it did, which a preview no longer describes.
      tableExport={{
        url: '/budget-lines/budget-operations/copy/export',
        params: {
          scope,
          sourceYear,
          destinationYear,
          amounts: String(copyAmounts),
          allocations: String(copyAllocations),
          ...(copyAmounts ? { sourceColumn, destinationColumn, percentageIncrease } : {}),
          overwrite: String(overwrite),
        },
        fileBase: `copy-budget-${scope}-${sourceYear}-${destinationYear}`,
        disabled: done || isProcessing || !hasPart || rows.length === 0 || (copyAmounts && frozenNatures.length > 0) || !budgetColumns.ready,
      }}
    >
      <Stack direction="column" spacing={2} alignItems="stretch">
        {!hasPart && <Alert severity="info">{t('operations.copyBudget.chooseParts')}</Alert>}

        {frozenNatures.length > 0 && <Alert severity="error">{frozenMessage}</Alert>}

        {outcome && (
          <Alert severity={done ? 'success' : stats.allocationErrors > 0 ? 'error' : 'info'}>
            {summaryText(outcome.response, done, stats.totalLines - stats.answeredLines)}
          </Alert>
        )}

        {copyAmounts && !overwrite && !done && stats.withAmounts > 0 && (
          <Alert severity="warning">{t('operations.copyBudget.existingAmounts', { count: stats.withAmounts })}</Alert>
        )}

        {outcome && !done && !overwrite && stats.allocationsKept > 0 && (
          <Alert severity="warning">{t('operations.copyBudget.existingAllocations', { count: stats.allocationsKept, year: destinationYear })}</Alert>
        )}

        {outcome && !done && !overwrite && stats.methodsReplaced > 0 && (
          <Alert severity="warning">{t('operations.copyBudget.methodsReplaced', { count: stats.methodsReplaced, year: destinationYear })}</Alert>
        )}

        {outcome && !done && stats.onDefault > 0 && defaultBasisChanged && (
          <Alert severity="warning">
            {t('operations.copyBudget.defaultBasisWarning', {
              count: stats.onDefault,
              sourceYear,
              destinationYear,
              sourceLabel: ruleLabel(sourceRule),
              destinationLabel: ruleLabel(destinationRule),
            })}
          </Alert>
        )}

        {!done && stats.calendarChanges > 0 && (
          <Alert severity="warning">
            <Typography sx={{ fontSize: 13 }}>
              {t('operations.copyBudget.calendarAlert', { count: stats.calendarChanges, year: destinationYear })}
            </Typography>
            <FormControlLabel
              control={<Checkbox size="small" checked={acceptCalendarChanges} onChange={(e) => setAcceptCalendarChanges(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 13 }}>{t('operations.copyBudget.acceptCalendarChanges')}</Typography>}
              sx={{ mt: 0.5 }}
            />
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography sx={{ mb: 1, fontSize: 16, fontWeight: 500 }}>
            {t(done ? 'operations.copyBudget.resultTitle' : 'operations.copyBudget.previewTitle')}
          </Typography>
          {!outcome && hasPart && (
            <Typography sx={{ mb: 1, fontSize: 13, color: 'kanap.text.tertiary' }}>{t('operations.copyBudget.previewPrompt')}</Typography>
          )}
          <Box component={AgGridBox}>
            <AgGridReact<Row>
              localeText={gridLocaleText}
              rowData={rows}
              columnDefs={columns}
              getRowId={(p) => p.data.id}
              defaultColDef={{ sortable: true, resizable: true }}
              initialState={copyAmounts ? { sort: { sortModel: [{ colId: 'sourceValue', sort: 'desc' }] } } : undefined}
              domLayout="autoHeight"
            />
          </Box>

          <Box sx={{ mt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' } }}>
            <Box sx={statSx}>
              <Typography sx={statLabelSx}>{t('operations.copyBudget.totalLines')}</Typography>
              <Typography sx={statValueSx}>{stats.totalLines.toLocaleString(locale)}</Typography>
            </Box>
            {copyAmounts && (
              <>
                <Box sx={statSx}>
                  <Typography sx={statLabelSx}>{t(done ? 'operations.copyBudget.amountsCopied' : 'operations.copyBudget.amountsToCopy')}</Typography>
                  <Typography sx={statValueSx}>{stats.amountsToCopy.toLocaleString(locale)}</Typography>
                </Box>
                <Box sx={statSx}>
                  <Typography sx={statLabelSx}>{t('operations.copyBudget.sourceTotal')}</Typography>
                  <Typography sx={statValueSx}>{formatOperationAmount(stats.sourceTotal)}</Typography>
                </Box>
                <Box sx={statSx}>
                  <Typography sx={statLabelSx}>{t('operations.copyBudget.currentTotal')}</Typography>
                  <Typography sx={statValueSx}>{formatOperationAmount(stats.currentTotal)}</Typography>
                </Box>
                {outcome && !done && (
                  <Box sx={statSx}>
                    <Typography sx={statLabelSx}>{t('operations.copyBudget.afterTotal')}</Typography>
                    <Typography sx={statValueSx}>{formatOperationAmount(stats.afterTotal)}</Typography>
                  </Box>
                )}
              </>
            )}
            {copyAllocations && outcome && (
              <Box sx={statSx}>
                <Typography sx={statLabelSx}>{t(done ? 'operations.copyBudget.allocationsCopied' : 'operations.copyBudget.allocationsToCopy')}</Typography>
                <Typography sx={statValueSx}>{stats.allocationsToCopy.toLocaleString(locale)}</Typography>
              </Box>
            )}
          </Box>
        </Paper>
      </Stack>
      {isLoading && (
        <Typography sx={{ mt: 1, fontSize: 13, color: 'kanap.text.secondary' }}>{t('operations.copyBudget.loadingData')}</Typography>
      )}
    </ReportLayout>
  );
}
