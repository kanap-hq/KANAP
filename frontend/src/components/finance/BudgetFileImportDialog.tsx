import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Checkbox, Tooltip, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import KanapDialog from '../design/KanapDialog';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import { formatAmount } from '../../i18n/formatters';
import { useBudgetColumns, type BudgetColumns } from '../../hooks/useBudgetColumns';
import { useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import type { AnalyticsAxis } from '../../services/analytics';
import { forgetAllAllocations } from './allocationsCache';
import {
  AmountReading,
  BUDGET_LIST_QUERY_KEYS,
  BudgetFileChoice,
  BudgetFileLoad,
  BudgetFileReport,
  BudgetFileScope,
  DateReading,
  amountReadingOf,
  budgetFileFailure,
  dateReadingOf,
  isBudgetFileReport,
  loadBudgetFile,
  missingSupplierCount,
  preflightBudgetFile,
  screenLanguage,
} from './budgetFile';
import { checkSentence, failureText, serverSentence } from './budgetFileText';
import { useImportFiles } from '../csv/importFiles';
import ImportExampleButton from '../csv/ImportExampleButton';
import ImportMatchesView, { ActionLink, Line, Section, type LineAction } from '../csv/ImportMatchesView';
import ImportLookalikesView from '../csv/ImportLookalikesView';
import { buildEntityUrl } from '../../ai/utils/entityUrls';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const K = 'operations.budgetFile.';

const MISSING_TYPES = new Set(['companies', 'accounts', 'costCenters', 'users', 'projects']);

/** A dimension's column in the file and in the check: `analytics:<code>`. */
const ANALYTICS_COLUMN = 'analytics:';
const SUPPLIER_COLUMN = 'supplier_name';
const COMPANY_COLUMN = 'company_name';
/** Where a line's values go in its sentence (`{{names}}`), so each value can carry its own tooltip. */
const VALUES = '\u2063values\u2063';

type Unmatch = Extract<BudgetFileChoice, { kind: 'unmatch' }>;
type Lookalikes = NonNullable<BudgetFileReport['lookalikes']>;
type Lookalike = Lookalikes['lines'][number];

const LOOKALIKE_REASONS: Record<NonNullable<Lookalike['reason']>, string> = {
  title_supplier: 'reasonTitleSupplier',
  amounts: 'reasonAmounts',
  close_title: 'reasonCloseTitle',
};

type Failure = { text: string; action: 'check' | 'load'; kind: 'stale' | 'retry' | 'final' };

/**
 * Import of a list's budget file. Choosing a file checks it at once (the
 * preflight: nothing is written) and shows what a load would do. Load sends
 * the checked lines' versions back: when a line changed in between, the
 * server refuses the whole load and the dialog offers to check again.
 */
export default function BudgetFileImportDialog({
  open,
  onClose,
  scope,
  canCreateSuppliers,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  scope: BudgetFileScope;
  /** Suppliers at member level, or an administrator: the server's own rule. */
  canCreateSuppliers: boolean;
  onImported?: () => void;
}) {
  const { t, i18n } = useTranslation('ops');
  const { accept } = useImportFiles();
  const screen = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const locale = screen;
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [createSuppliers, setCreateSuppliers] = useState(false);
  const [dateOrder, setDateOrder] = useState<DateReading | null>(null);
  const [amountReading, setAmountReading] = useState<AmountReading | null>(null);
  const [checkNonce, setCheckNonce] = useState(0);
  // The person's choices on the check (matches undone): the check shown and the load follow the same list.
  const [choices, setChoices] = useState<BudgetFileChoice[]>([]);
  // The matches stay unfolded while the file is checked again after an undo.
  const [matchesOpen, setMatchesOpen] = useState(false);
  const [report, setReport] = useState<BudgetFileReport | null>(null);
  const [loaded, setLoaded] = useState<BudgetFileLoad | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [phase, setPhase] = useState<'idle' | 'checking' | 'loading'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const language = screen;
  const appliedAmounts = amountReadingOf(report?.notices.amounts ?? null);
  // Keep the preflight's amount reading for later checks and Load without another request.
  const decimalMark = amountReading ?? appliedAmounts;
  const options = { language, dateOrder, decimalMark, createSuppliers: canCreateSuppliers && createSuppliers, choices };

  useEffect(() => {
    if (open) return;
    requestId.current += 1;
    setFile(null);
    setCreateSuppliers(false);
    setDateOrder(null);
    setAmountReading(null);
    setChoices([]);
    setMatchesOpen(false);
    setReport(null);
    setLoaded(null);
    setFailure(null);
    setPhase('idle');
  }, [open]);

  // Every change of file or option checks the file again: the report always matches what Load sends.
  useEffect(() => {
    if (!open || !file) return;
    const id = ++requestId.current;
    setPhase('checking');
    setFailure(null);
    setLoaded(null);
    preflightBudgetFile(scope, file, options)
      .then((next) => {
        if (id === requestId.current) setReport(next);
      })
      .catch(async (err: unknown) => {
        if (id !== requestId.current) return;
        const kind = await budgetFileFailure(err);
        setReport(null);
        setFailure({ text: failureText(kind, t, 'check'), action: 'check', kind: kind.kind === 'busy' || kind.kind === 'unknown' ? 'retry' : 'final' });
      })
      .finally(() => {
        if (id === requestId.current) setPhase('idle');
      });
    // `options` is derived from the states listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file, createSuppliers, dateOrder, amountReading, choices, checkNonce, scope, screen, t]);

  const chooseFile = (next: File | undefined | null) => {
    if (!next) return;
    setDateOrder(null);
    setAmountReading(null);
    setChoices([]);
    setMatchesOpen(false);
    setReport(null);
    setFile(next);
    setCheckNonce((n) => n + 1);
  };

  const appliedDates = dateReadingOf(report?.notices.dates ?? null);

  const switchDates = () => {
    if (!appliedDates) return;
    setDateOrder(appliedDates === 'day-first' ? 'month-first' : 'day-first');
  };
  const switchAmounts = () => {
    if (!appliedAmounts) return;
    // Keep the date order applied by the preflight when switching amounts.
    if (!dateOrder && appliedDates) setDateOrder(appliedDates);
    setAmountReading(appliedAmounts === 'comma' ? 'dot' : 'comma');
  };

  const load = useCallback(async () => {
    if (!file || !report?.ok) return;
    const id = ++requestId.current;
    setPhase('loading');
    setFailure(null);
    try {
      // The choices of the check shown, as it gave them back: the target of each row it showed included.
      const data = await loadBudgetFile(scope, file, report.snapshot, { ...options, choices: report.matching?.choices ?? choices });
      if (id !== requestId.current) return;
      if (isBudgetFileReport(data)) {
        setReport(data);
        return;
      }
      setLoaded(data);
      forgetAllAllocations(queryClient);
      // Both lists: the file may have held lines of both natures.
      for (const key of BUDGET_LIST_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey: [key] });
      onImported?.();
    } catch (err) {
      if (id !== requestId.current) return;
      const kind = await budgetFileFailure(err);
      setFailure({
        text: failureText(kind, t, 'load'),
        action: 'load',
        kind: kind.kind === 'stale' ? 'stale' : kind.kind === 'busy' || kind.kind === 'running' || kind.kind === 'unknown' ? 'retry' : 'final',
      });
    } finally {
      if (id === requestId.current) setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, report, scope, language, dateOrder, decimalMark, createSuppliers, canCreateSuppliers, choices, queryClient, onImported, t]);

  const onSave = async () => {
    if (loaded) {
      onClose();
      return;
    }
    await load();
  };

  const retry = () => {
    if (!failure) return;
    if (failure.action === 'load' && failure.kind === 'retry') {
      void load();
      return;
    }
    setCheckNonce((n) => n + 1);
  };

  const nothingToLoad = !!report?.ok && report.changes.created === 0 && report.changes.updated === 0;
  const busy = phase !== 'idle';

  return (
    <KanapDialog
      open={open}
      onClose={onClose}
      title={t('budget.importTitle')}
      onSave={onSave}
      saveLabel={loaded ? t(`${K}done`) : t(`${K}load`)}
      saveDisabled={!loaded && (!file || !report?.ok || nothingToLoad || busy || failure?.kind === 'stale')}
      saveLoading={phase === 'loading'}
      showCancel={!loaded}
      sx={{ maxWidth: 640 }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={accept}
          onChange={(event) => {
            chooseFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {file ? (
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.primary', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file.name}
            </Typography>
            {!loaded && (
              <ActionLink onClick={() => inputRef.current?.click()} disabled={phase === 'loading'}>
                {t(`${K}chooseAnother`)}
              </ActionLink>
            )}
          </Box>
        ) : (
          <Box
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                inputRef.current?.click();
              }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              chooseFile(event.dataTransfer.files?.[0]);
            }}
            sx={(theme) => ({
              border: `1px dashed ${theme.palette.kanap.border.default}`,
              borderRadius: '8px',
              px: 2,
              py: 2,
              textAlign: 'center',
              cursor: 'pointer',
              bgcolor: theme.palette.kanap.bg.drawer,
              '&:hover': { borderColor: theme.palette.kanap.text.tertiary },
              '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
            })}
          >
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t(`${K}dropFile`)}</Typography>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mt: 0.25 }}>{t(`${K}dropFileHint`)}</Typography>
          </Box>
        )}
        {!file && (
          <Box>
            <ImportExampleButton
              example="budget-lines"
              onError={(text) => setFailure(text ? { text, action: 'check', kind: 'final' } : null)}
            />
          </Box>
        )}

        {canCreateSuppliers && !loaded && (
          <Box component="label" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, cursor: 'pointer' }}>
            <Checkbox
              size="small"
              checked={createSuppliers}
              disabled={busy}
              onChange={(event) => setCreateSuppliers(event.target.checked)}
              sx={{ p: 0.25 }}
            />
            <Box sx={{ pt: '3px' }}>
              <Typography sx={{ fontSize: 13, color: 'kanap.text.primary', lineHeight: 1.4 }}>{t(`${K}createSuppliers`)}</Typography>
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.4 }}>{t(`${K}createSuppliersHint`)}</Typography>
            </Box>
          </Box>
        )}

        {report && !loaded && (appliedDates || report.notices.dates) && (
          <NoticeLine
            text={appliedDates ? t(appliedDates === 'day-first' ? `${K}datesDayFirst` : `${K}datesMonthFirst`) : report.notices.dates!}
            action={appliedDates ? t(appliedDates === 'day-first' ? `${K}readMonthFirst` : `${K}readDayFirst`) : null}
            onAction={switchDates}
            disabled={busy}
          />
        )}
        {report && !loaded && (appliedAmounts || report.notices.amounts) && (
          <NoticeLine
            text={appliedAmounts ? t(appliedAmounts === 'comma' ? `${K}amountsComma` : `${K}amountsDot`) : report.notices.amounts!}
            action={appliedAmounts ? t(appliedAmounts === 'comma' ? `${K}readDecimalDot` : `${K}readDecimalComma`) : null}
            onAction={switchAmounts}
            disabled={busy}
          />
        )}

        {phase === 'checking' && <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t(`${K}checking`)}</Typography>}
        {phase === 'loading' && <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t(`${K}loading`)}</Typography>}

        {failure && (
          <Box role="alert" sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25 }}>
            <Typography sx={{ fontSize: 13, color: 'kanap.danger' }}>{failure.text}</Typography>
            {failure.kind === 'stale' && <ActionLink onClick={retry}>{t(`${K}checkAgain`)}</ActionLink>}
            {failure.kind === 'retry' && <ActionLink onClick={retry} disabled={busy}>{t(`${K}tryAgain`)}</ActionLink>}
          </Box>
        )}

        {loaded && (
          <Typography role="status" sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            {t(`${K}loaded`, {
              created: t(`${K}linesCreated`, { count: loaded.inserted }),
              updated: t(`${K}linesUpdated`, { count: loaded.updated }),
            })}
          </Typography>
        )}
        {loaded && (loaded.skipped ?? 0) > 0 && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {t(`${K}lookalikes.skipped`, { count: loaded.skipped })}
          </Typography>
        )}

        {report && !loaded && phase !== 'checking' && (
          <ReportView
            report={report}
            locale={locale}
            canCreateSuppliers={canCreateSuppliers}
            nothingToLoad={nothingToLoad}
            onChoices={setChoices}
            choicesDisabled={busy}
            matchesOpen={matchesOpen}
            onMatchesOpen={setMatchesOpen}
          />
        )}
      </Box>
    </KanapDialog>
  );
}

function NoticeLine({ text, action, onAction, disabled }: { text: string; action: string | null; onAction: () => void; disabled: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25 }}>
      <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{text}</Typography>
      {action && <ActionLink onClick={onAction} disabled={disabled}>{action}</ActionLink>}
    </Box>
  );
}

/**
 * The check of a budget file, as this dialog shows it. Plaid's card shows the check of the file it
 * builds, under its own status line (`showStatus` false): it approves where this dialog loads.
 */
export function ReportView({
  report,
  locale,
  canCreateSuppliers,
  nothingToLoad,
  showStatus = true,
  ownScroll = true,
  canOpenLines = true,
  onChoices,
  choicesDisabled = false,
  matchesOpen: openFromParent,
  onMatchesOpen,
}: {
  report: BudgetFileReport;
  locale: string;
  canCreateSuppliers: boolean;
  nothingToLoad: boolean;
  showStatus?: boolean;
  /** The dialog's check scrolls on its own; Plaid's card shows it in the scroll of its panel. */
  ownScroll?: boolean;
  /** The reference of a line the file looks like opens that line: false for a person who may not read budget lines. */
  canOpenLines?: boolean;
  /**
   * Undo a match, or match a value again: receives the whole new list of choices, which the check
   * runs again with. Without it the matches are read only.
   */
  onChoices?: (choices: BudgetFileChoice[]) => void;
  /** A check is running: the choices wait for it. */
  choicesDisabled?: boolean;
  /** The matches unfolded, held by a parent that shows the next check in a new view. */
  matchesOpen?: boolean;
  onMatchesOpen?: (open: boolean) => void;
}) {
  const { t } = useTranslation('ops');
  const columns = useBudgetColumns();
  const axes = useAnalyticsAxes();
  const [ownOpen, setOwnOpen] = useState(false);
  const matchesOpen = openFromParent ?? ownOpen;
  const toggleMatches = () => (onMatchesOpen ?? setOwnOpen)(!matchesOpen);
  const matching = report.matching;
  const matches = matching?.matches ?? [];
  const refusedProposals = matching?.refusedProposals ?? [];
  const choices = matching?.choices ?? [];
  const undone = choices.filter((choice): choice is Unmatch => choice.kind === 'unmatch');
  const dimensionNames = useMemo(() => namesOfDimensions(report, axes.axes), [report, axes.axes]);
  // A dimension by its name (the default one without a name by its label), a column by the list's label: never a code.
  const columnName = (column: string, name?: string | null): string => {
    const own = name?.trim();
    if (own) return own;
    if (column.startsWith(ANALYTICS_COLUMN)) return dimensionNames.get(column.slice(ANALYTICS_COLUMN.length)) ?? axes.label({ name: null });
    return fileColumnLabel(column, columns, t);
  };
  // A field an update changes: a column by the screen's name, an amount by its column's name and its year or month.
  const fieldName = (field: string): string => {
    const amount = /^([a-z_]+) (\d{4})(?:-(\d{2}))?$/.exec(field);
    if (!amount) return columnName(field);
    const label = columnName(amount[1]);
    return amount[3] ? `${label} ${monthName(Number(amount[2]), Number(amount[3]), locale)}` : `${label} ${amount[2]}`;
  };
  const closeTo = (column: string, value: string): string | null => {
    const entry = matching?.candidates.find((item) => item.column === column && sameValue(item.value, value));
    return entry && entry.candidates.length > 0
      ? t(`${K}matching.closeTo`, { names: entry.candidates.map((candidate) => candidate.name).join(', ') })
      : null;
  };
  const companyCloseTo = (error: BudgetFileReport['errors'][number]): string | null => {
    const value = error.params?.value;
    const entry = matching?.candidates.find((item) => item.column === COMPANY_COLUMN
      && (value != null ? sameValue(item.value, String(value)) : item.lines.includes(error.line)));
    return entry && entry.candidates.length > 0 ? closeTo(COMPANY_COLUMN, entry.value) : null;
  };
  const undo = (entry: { column: string; value: string }) => onChoices?.([...choices, { kind: 'unmatch', column: entry.column, value: entry.value }]);
  const redo = (entry: Unmatch) => onChoices?.(choices.filter((choice) => !(choice.kind === 'unmatch' && choice.column === entry.column && choice.value === entry.value)));
  const choiceAction = (label: string, onClick: () => void): LineAction | undefined => (
    onChoices ? { label, onClick, disabled: choicesDisabled } : undefined
  );
  // A value whose match was undone shows where it goes now: among the values created, or with the errors.
  const createdNames = (column: string): string[] => {
    if (column === SUPPLIER_COLUMN) return report.creates.suppliers.map((supplier) => supplier.name);
    if (!column.startsWith(ANALYTICS_COLUMN)) return [];
    const code = column.slice(ANALYTICS_COLUMN.length);
    return report.creates.dimensionValues.find((entry) => entry.dimension === code)?.names ?? [];
  };
  const isUndone = (column: string, value: string) => undone.some((entry) => entry.column === column && sameValue(entry.value, value));
  const undoneCreated = undone.filter((entry) => createdNames(entry.column).some((name) => sameValue(name, entry.value)));
  const undoneRefused = undone.filter((entry) => !undoneCreated.includes(entry));
  const undoneLine = (entry: Unmatch, danger?: boolean) => (
    <Line
      key={`x-${entry.column}-${entry.value}`}
      danger={danger}
      text={t(`${K}dimensionValues`, { dimension: columnName(entry.column), names: entry.value })}
      action={choiceAction(t(`${K}matching.redo`), () => redo(entry))}
    />
  );
  const valueList = (column: string, values: Array<{ name: string; label?: string }>) => values.map((value, index) => (
    <React.Fragment key={value.name}>
      {index > 0 && ', '}
      <ValueName text={value.label ?? value.name} hint={closeTo(column, value.name)} />
    </React.Fragment>
  ));
  const more = (count: number, shown: number) => (count > shown ? t(`${K}andMore`, { count: count - shown }) : null);
  const blocking = !report.ok;
  const supplierCount = missingSupplierCount(report.supplierMessage);
  const hasErrors = report.fileErrors.length > 0 || report.headerErrors.length > 0 || report.errorCount > 0
    || report.missing.length > 0 || report.deletedCount > 0 || !!report.supplierMessage;
  const ignoredCells = report.warnings.ignoredCells ?? [];
  const costCenterCompanies = report.warnings.costCenterCompanies ?? [];
  const calculationLines = report.warnings.calculationLines ?? [];
  const calculationLinesCount = report.warnings.calculationLinesCount ?? calculationLines.length;
  const duplicates = report.warnings.duplicates;
  // Amounts, dates or currency out of line with the stored lines: warnings among the others.
  const consistency = report.warnings.consistency ?? [];
  const consistencyCount = report.warnings.consistencyCount ?? consistency.length;
  const hasWarnings = duplicates.length > 0 || consistency.length > 0 || report.warnings.ignoredColumns.length > 0
    || report.warnings.supplierNames.length > 0 || ignoredCells.length > 0 || costCenterCompanies.length > 0
    || calculationLines.length > 0
    || report.firstSheetOnly !== undefined;
  // A limited person's check names the unknown values of a closed list it refuses (their rows are among the errors).
  const refusedValues = report.creates.refusedDimensionValues ?? [];
  const undoneInErrors = hasErrors ? undoneRefused : [];
  const undoneInCreates = hasErrors ? undoneCreated : undone;
  const suppliersCreated = report.creates.suppliers.filter((supplier) => !isUndone(SUPPLIER_COLUMN, supplier.name));
  const valuesCreated = report.creates.dimensionValues
    .map((entry) => ({ ...entry, names: entry.names.filter((name) => !isUndone(`${ANALYTICS_COLUMN}${entry.dimension}`, name)) }))
    .filter((entry) => entry.names.length > 0);
  // A row whose line changed since the check: its error is among the errors, and Update can be chosen again.
  const lookalikeChanged = new Set(report.errors.filter((error) => error.code === 'BUDGET_FILE_LOOKALIKE_CHANGED').map((error) => error.line));
  // A row in error was not compared with its line: no "nothing changes" for it.
  const lookalikeRefused = new Set(report.errors.map((error) => error.line));
  const hasCreates = suppliersCreated.length > 0 || valuesCreated.length > 0 || refusedValues.length > 0 || undoneInCreates.length > 0;

  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        gap: 1.75,
        ...(ownScroll ? { maxHeight: '48vh', overflowY: 'auto' } : {}),
        borderTop: `1px solid ${theme.palette.kanap.border.soft}`,
        pt: 1.5,
      })}
    >
      {showStatus && (
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>
          {blocking ? t(`${K}notReady`) : nothingToLoad ? t(`${K}nothingToChange`) : t(`${K}ready`)}
        </Typography>
      )}

      {hasErrors && (
        <Section title={t(`${K}errorsTitle`)}>
          {report.fileErrors.map((message) => <Line key={`f-${message}`} text={serverSentence(message, t)} danger />)}
          {report.headerErrors.map((message) => <Line key={`h-${message}`} text={serverSentence(message, t)} danger />)}
          {report.missing.map((item) => <Line key={`m-${item.type}`} text={missingText(item, t)} danger />)}
          {report.supplierMessage && (
            <Line
              danger
              text={supplierCount == null
                ? report.supplierMessage
                : t(canCreateSuppliers ? `${K}suppliersMissing` : `${K}suppliersMissingNoCreate`, { count: supplierCount })}
            />
          )}
          {report.deleted.map((line) => (
            <Line key={`d-${line.line}`} danger text={t(`${K}deletedLine`, { line: line.line, ref: line.itemNumber })} />
          ))}
          {more(report.deletedCount, report.deleted.length) && <Line text={more(report.deletedCount, report.deleted.length)!} />}
          {report.errors.map((error) => {
            // An unknown company: the closest names of the workspace's companies, under its error.
            const near = error.column === COMPANY_COLUMN ? companyCloseTo(error) : null;
            return (
              <React.Fragment key={`e-${error.line}-${error.column ?? ''}-${error.message}`}>
                <Line
                  danger
                  text={error.column
                    ? t(`${K}rowColumn`, { line: error.line, column: columnName(error.column), message: checkSentence(error, t) })
                    : t(`${K}row`, { line: error.line, message: checkSentence(error, t) })}
                />
                {near && <Line muted text={near} />}
              </React.Fragment>
            );
          })}
          {more(report.errorCount, report.errors.length) && <Line text={more(report.errorCount, report.errors.length)!} />}
          {undoneInErrors.map((entry) => undoneLine(entry, true))}
        </Section>
      )}

      {report.fileErrors.length === 0 && report.headerErrors.length === 0 && (
        <Section title={t(`${K}changesTitle`)}>
          <Line text={[
            t(`${K}toCreate`, { count: report.changes.created }),
            t(`${K}toUpdate`, { count: report.changes.updated }),
            t(`${K}unchanged`, { count: report.changes.unchanged }),
          ].join(' · ')}
          />
          {report.changes.createdLines.map((line) => (
            <Line key={`c-${line.line}`} muted text={t(`${K}createdLine`, { line: line.line, name: line.name })} />
          ))}
          {more(report.changes.created, report.changes.createdLines.length) && (
            <Line muted text={more(report.changes.created, report.changes.createdLines.length)!} />
          )}
          {report.changes.updatedLines.map((line) => (
            <Line key={`u-${line.line}`} muted text={t(`${K}updatedLine`, { line: line.line, ref: line.itemNumber, fields: line.fields.map(fieldName).join(', ') })} />
          ))}
          {more(report.changes.updated, report.changes.updatedLines.length) && (
            <Line muted text={more(report.changes.updated, report.changes.updatedLines.length)!} />
          )}
        </Section>
      )}

      {report.changedSinceExportCount > 0 && (
        <Section title={t(`${K}changedTitle`)} hint={t(`${K}changedHint`)}>
          {report.changedSinceExport.map((line) => <Line key={`k-${line.line}`} text={changedText(line, locale, t)} />)}
          {more(report.changedSinceExportCount, report.changedSinceExport.length) && (
            <Line text={more(report.changedSinceExportCount, report.changedSinceExport.length)!} />
          )}
        </Section>
      )}

      {hasWarnings && (
        <Section title={t(`${K}warningsTitle`)}>
          {duplicates.map((warning) => <Line key={`w-${warning.line}`} text={checkSentence(warning, t)} />)}
          {consistency.map((warning, index) => (
            <Line key={`cs-${warning.line}-${index}`} text={t(`${K}row`, { line: warning.line, message: checkSentence(withShortDates(warning, locale), t) })} />
          ))}
          {more(consistencyCount, consistency.length) && <Line text={more(consistencyCount, consistency.length)!} />}
          {report.warnings.supplierNames.map((warning) => <Line key={`s-${warning.line}`} text={checkSentence(warning, t)} />)}
          {costCenterCompanies.map((warning) => (
            <Line
              key={`cc-${warning.line}`}
              text={t(`${K}rowColumn`, {
                line: warning.line,
                column: columnName(COMPANY_COLUMN),
                message: t(`errors:${warning.code}`, { ...warning, defaultValue: warning.message }),
              })}
            />
          ))}
          {calculationLines.map((warning) => (
            <Line key={`cl-${warning.line}-${warning.column}-${warning.year}`} text={calculationLinesText(warning, columns, t)} />
          ))}
          {more(calculationLinesCount, calculationLines.length) && <Line text={more(calculationLinesCount, calculationLines.length)!} />}
          {ignoredCells.map((warning) => (
            <Line key={`c-${warning.line}-${warning.column}`} text={t(`${K}rowColumn`, { line: warning.line, column: columnName(warning.column), message: warning.message })} />
          ))}
          {report.warnings.ignoredColumns.length > 0 && (
            <Line text={t(`${K}ignoredColumns`, { count: report.warnings.ignoredColumns.length, columns: report.warnings.ignoredColumns.join(', ') })} />
          )}
          {report.firstSheetOnly !== undefined && <Line text={t(`${K}firstSheetOnly`, { name: report.firstSheetOnly })} />}
        </Section>
      )}

      <ImportMatchesView
        matches={matches}
        refusedProposals={refusedProposals}
        columnName={columnName}
        open={matchesOpen}
        onToggle={toggleMatches}
        onUndo={onChoices ? undo : undefined}
        disabled={choicesDisabled}
      />

      {report.lookalikes && report.lookalikes.count > 0 && (
        <ImportLookalikesView<Lookalike, BudgetFileChoice>
          lookalikes={report.lookalikes}
          title={t(`${K}lookalikes.title`)}
          choices={choices}
          updateChoice={(look) => ({ kind: 'lookalike', line: look.line, action: 'update', item: look.target.item, state: look.target.state })}
          onChoices={onChoices}
          choicesDisabled={choicesDisabled}
          reasonText={(look) => (look.reason ? t(`${K}lookalikes.${LOOKALIKE_REASONS[look.reason]}`) : null)}
          targetUrl={(look) => (canOpenLines ? buildEntityUrl('budget_lines', look.target.ref) : null)}
          fieldName={fieldName}
          changedLines={lookalikeChanged}
          refusedLines={lookalikeRefused}
        />
      )}

      {hasCreates && (
        <Section title={t(`${K}createsTitle`)}>
          {suppliersCreated.length > 0 && (
            <Line>
              {withValues(t(`${K}createSuppliersList`, { names: VALUES }), valueList(SUPPLIER_COLUMN, suppliersCreated.map((supplier) => ({
                name: supplier.name,
                label: supplier.erpId ? t(`${K}supplierWithErp`, { name: supplier.name, erpId: supplier.erpId }) : supplier.name,
              }))))}
            </Line>
          )}
          {valuesCreated.map((dimension) => (
            <Line key={`v-${dimension.dimension}`}>
              {withValues(
                t(refusedValues.length > 0 ? `${K}dimensionValuesCreated` : `${K}dimensionValues`, { dimension: columnName(`${ANALYTICS_COLUMN}${dimension.dimension}`, dimension.name), names: VALUES }),
                valueList(`${ANALYTICS_COLUMN}${dimension.dimension}`, dimension.names.map((name) => ({ name }))),
              )}
            </Line>
          ))}
          {undoneInCreates.map((entry) => undoneLine(entry))}
          {refusedValues.map((dimension) => (
            <Line key={`r-${dimension.dimension}`} danger>
              {withValues(
                t(`${K}dimensionValuesRefused`, { dimension: columnName(`${ANALYTICS_COLUMN}${dimension.dimension}`, dimension.name), names: VALUES }),
                valueList(`${ANALYTICS_COLUMN}${dimension.dimension}`, dimension.names.map((name) => ({ name }))),
              )}
            </Line>
          ))}
        </Section>
      )}
    </Box>
  );
}

function missingText(item: BudgetFileReport['missing'][number], t: Translate): string {
  if (!MISSING_TYPES.has(item.type)) return item.message;
  const extra = item.count - item.examples.length;
  const examples = extra > 0
    ? `${item.examples.join(', ')} ${t(`${K}andMoreInline`, { count: extra })}`
    : item.examples.join(', ');
  return t(`${K}missing.${item.type}`, { count: item.count, examples });
}

/** The budget list's label of each file column the check can name; a column with none keeps its file name. */
const FILE_COLUMN_LABELS: Record<string, string> = {
  nature: 'budget.type',
  item_number: 'opex.columns.reference',
  name: 'opex.columns.productName',
  description: 'opex.columns.description',
  company_name: 'opex.columns.payingCompany',
  supplier_name: 'opex.columns.supplier',
  supplier: 'opex.columns.supplier',
  account_number: 'opex.columns.account',
  cost_center_code: 'opex.columns.costCenter',
  run_build: 'opex.columns.runBuild',
  owner_it_email: 'opex.columns.itOwner',
  owner_it_id: 'opex.columns.itOwner',
  owner_business_email: 'opex.columns.businessOwner',
  owner_business_id: 'opex.columns.businessOwner',
  project: 'opex.columns.project',
  currency: 'opex.columns.currency',
  effective_start: 'opex.columns.effectiveStart',
  end_of_validity: 'opex.columns.endOfValidity',
  notes: 'opex.columns.notes',
};

/** A file column as the screen names it: `supplier_name` reads "Supplier", `budget` the amount column's label. */
function fileColumnLabel(column: string, columns: BudgetColumns, t: Translate): string {
  const key = FILE_COLUMN_LABELS[column];
  if (key) return t(key);
  return columns.all.find((entry) => entry.freezeKey === column || entry.key === column)?.label ?? column;
}

/** `BL-83 · Revision 2026: 3 calculation lines (281 280) will no longer drive these amounts.` */
function calculationLinesText(
  warning: NonNullable<BudgetFileReport['warnings']['calculationLines']>[number],
  columns: BudgetColumns,
  t: Translate,
): string {
  const column = columns.all.find((entry) => entry.freezeKey === warning.column || entry.key === warning.column)?.label ?? warning.column;
  const total = formatAmount(Number(warning.total));
  return t(`${K}calculationLines`, {
    item: warning.item,
    column,
    year: warning.year,
    count: warning.count,
    total,
    defaultValue: warning.message,
  });
}

/** A month of a year as the screen's language writes it (`janv. 2026`). */
function monthName(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

/** A consistency warning whose days (`start`, `end`) read in the screen's language. */
function withShortDates<T extends { params?: Record<string, unknown> }>(warning: T, locale: string): T {
  const params = warning.params;
  if (!params || (typeof params.start !== 'string' && typeof params.end !== 'string')) return warning;
  const day = (value: unknown) => (typeof value === 'string' ? formatShortDate(value, locale, { year: 'always', empty: value }) : value);
  return { ...warning, params: { ...params, ...('start' in params ? { start: day(params.start) } : {}), ...('end' in params ? { end: day(params.end) } : {}) } };
}

function changedText(line: BudgetFileReport['changedSinceExport'][number], locale: string, t: Translate): string {
  const when = line.at ? formatShortDateTime(line.at, locale) : '';
  if (line.by && when) return t(`${K}changedByAt`, { ref: line.itemNumber, by: line.by, when });
  if (line.by) return t(`${K}changedBy`, { ref: line.itemNumber, by: line.by });
  if (when) return t(`${K}changedAt`, { ref: line.itemNumber, when });
  return t(`${K}changed`, { ref: line.itemNumber });
}

/** One value of a line; its closest names, when it has some, in a tooltip. */
function ValueName({ text, hint }: { text: string; hint: string | null }) {
  if (!hint) return <>{text}</>;
  return (
    <Tooltip title={hint} placement="bottom-start">
      <Box
        component="span"
        sx={(theme) => ({ textDecoration: 'underline dotted', textDecorationColor: theme.palette.kanap.text.tertiary, textUnderlineOffset: '3px' })}
      >
        {text}
      </Box>
    </Tooltip>
  );
}

/** A sentence written with `VALUES` in place of its values, with the values drawn there. */
function withValues(sentence: string, values: React.ReactNode): React.ReactNode {
  const [before, after = ''] = sentence.split(VALUES);
  return <>{before}{values}{after}</>;
}

function sameValue(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/** The names of the dimensions, by code: the tenant's, then those the check gives. */
function namesOfDimensions(report: BudgetFileReport, axes: AnalyticsAxis[]): Map<string, string> {
  const names = new Map<string, string>();
  const note = (code: string, name: string | null | undefined) => {
    if (name?.trim()) names.set(code, name.trim());
  };
  for (const axis of axes) note(axis.code, axis.name);
  for (const entry of [...report.creates.dimensionValues, ...(report.creates.refusedDimensionValues ?? [])]) note(entry.dimension, entry.name);
  const matching = report.matching;
  for (const entry of [...(matching?.matches ?? []), ...(matching?.refusedProposals ?? []), ...(matching?.candidates ?? [])]) {
    if (entry.column.startsWith(ANALYTICS_COLUMN)) note(entry.column.slice(ANALYTICS_COLUMN.length), entry.name);
  }
  return names;
}
