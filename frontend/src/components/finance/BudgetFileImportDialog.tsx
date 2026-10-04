import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Checkbox, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import KanapDialog from '../design/KanapDialog';
import { formatShortDateTime } from '../../lib/dateFormat';
import { forgetAllAllocations } from './allocationsCache';
import {
  AmountReading,
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
import { failureText, serverSentence } from './budgetFileText';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const K = 'operations.budgetFile.';

const MISSING_TYPES = new Set(['companies', 'accounts', 'costCenters', 'users', 'projects']);

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
  const screen = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const locale = screen;
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [createSuppliers, setCreateSuppliers] = useState(false);
  const [dateOrder, setDateOrder] = useState<DateReading | null>(null);
  const [amountReading, setAmountReading] = useState<AmountReading | null>(null);
  const [checkNonce, setCheckNonce] = useState(0);
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
  const options = { language, dateOrder, decimalMark, createSuppliers: canCreateSuppliers && createSuppliers };

  useEffect(() => {
    if (open) return;
    requestId.current += 1;
    setFile(null);
    setCreateSuppliers(false);
    setDateOrder(null);
    setAmountReading(null);
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
  }, [open, file, createSuppliers, dateOrder, amountReading, checkNonce, scope, screen, t]);

  const chooseFile = (next: File | undefined | null) => {
    if (!next) return;
    setDateOrder(null);
    setAmountReading(null);
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
      const data = await loadBudgetFile(scope, file, report.snapshot, options);
      if (id !== requestId.current) return;
      if (isBudgetFileReport(data)) {
        setReport(data);
        return;
      }
      setLoaded(data);
      forgetAllAllocations(queryClient);
      void queryClient.invalidateQueries({ queryKey: [scope === 'opex' ? 'spend-items-summary' : 'capex-items-summary'] });
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
  }, [file, report, scope, language, dateOrder, decimalMark, createSuppliers, canCreateSuppliers, queryClient, onImported, t]);

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
      title={t(scope === 'opex' ? 'opex.importTitle' : 'capex.importTitle')}
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
          accept=".csv,text/csv"
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

        {report && !loaded && phase !== 'checking' && (
          <ReportView report={report} locale={locale} canCreateSuppliers={canCreateSuppliers} nothingToLoad={nothingToLoad} />
        )}
      </Box>
    </KanapDialog>
  );
}

function ActionLink({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="text"
      size="small"
      onClick={onClick}
      disabled={disabled}
      sx={{ p: 0, minWidth: 0, fontSize: 12, fontWeight: 400, textTransform: 'none', lineHeight: 1.4, whiteSpace: 'nowrap', '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' } }}
    >
      {children}
    </Button>
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

function ReportView({
  report,
  locale,
  canCreateSuppliers,
  nothingToLoad,
}: {
  report: BudgetFileReport;
  locale: string;
  canCreateSuppliers: boolean;
  nothingToLoad: boolean;
}) {
  const { t } = useTranslation('ops');
  const more = (count: number, shown: number) => (count > shown ? t(`${K}andMore`, { count: count - shown }) : null);
  const blocking = !report.ok;
  const supplierCount = missingSupplierCount(report.supplierMessage);
  const hasErrors = report.fileErrors.length > 0 || report.headerErrors.length > 0 || report.errorCount > 0
    || report.missing.length > 0 || report.deletedCount > 0 || !!report.supplierMessage;
  const hasWarnings = report.warnings.duplicates.length > 0 || report.warnings.ignoredColumns.length > 0 || report.warnings.supplierNames.length > 0;
  const hasCreates = report.creates.suppliers.length > 0 || report.creates.dimensionValues.length > 0;

  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        gap: 1.75,
        maxHeight: '48vh',
        overflowY: 'auto',
        borderTop: `1px solid ${theme.palette.kanap.border.soft}`,
        pt: 1.5,
      })}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>
        {blocking ? t(`${K}notReady`) : nothingToLoad ? t(`${K}nothingToChange`) : t(`${K}ready`)}
      </Typography>

      {hasErrors && (
        <Section title={t(`${K}errorsTitle`)}>
          {report.fileErrors.map((message) => <Line key={`f-${message}`} text={serverSentence(message, t)} danger />)}
          {report.headerErrors.map((message) => <Line key={`h-${message}`} text={message} danger />)}
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
          {report.errors.map((error) => (
            <Line
              key={`e-${error.line}-${error.column ?? ''}-${error.message}`}
              danger
              text={error.column
                ? t(`${K}rowColumn`, { line: error.line, column: error.column, message: error.message })
                : t(`${K}row`, { line: error.line, message: error.message })}
            />
          ))}
          {more(report.errorCount, report.errors.length) && <Line text={more(report.errorCount, report.errors.length)!} />}
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
            <Line key={`u-${line.line}`} muted text={t(`${K}updatedLine`, { line: line.line, ref: line.itemNumber, fields: line.fields.join(', ') })} />
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
          {report.warnings.duplicates.map((warning) => <Line key={`w-${warning.line}`} text={warning.message} />)}
          {report.warnings.supplierNames.map((warning) => <Line key={`s-${warning.line}`} text={warning.message} />)}
          {report.warnings.ignoredColumns.length > 0 && (
            <Line text={t(`${K}ignoredColumns`, { count: report.warnings.ignoredColumns.length, columns: report.warnings.ignoredColumns.join(', ') })} />
          )}
        </Section>
      )}

      {hasCreates && (
        <Section title={t(`${K}createsTitle`)}>
          {report.creates.suppliers.length > 0 && (
            <Line text={t(`${K}createSuppliersList`, {
              names: report.creates.suppliers
                .map((supplier) => (supplier.erpId ? t(`${K}supplierWithErp`, { name: supplier.name, erpId: supplier.erpId }) : supplier.name))
                .join(', '),
            })}
            />
          )}
          {report.creates.dimensionValues.map((dimension) => (
            <Line key={`v-${dimension.dimension}`} text={t(`${K}dimensionValues`, { dimension: dimension.dimension, names: dimension.names.join(', ') })} />
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

function changedText(line: BudgetFileReport['changedSinceExport'][number], locale: string, t: Translate): string {
  const when = line.at ? formatShortDateTime(line.at, locale) : '';
  if (line.by && when) return t(`${K}changedByAt`, { ref: line.itemNumber, by: line.by, when });
  if (line.by) return t(`${K}changedBy`, { ref: line.itemNumber, by: line.by });
  if (when) return t(`${K}changedAt`, { ref: line.itemNumber, when });
  return t(`${K}changed`, { ref: line.itemNumber });
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 0.25 }}>{hint}</Typography>}
      {children}
    </Box>
  );
}

function Line({ text, danger, muted }: { text: string; danger?: boolean; muted?: boolean }) {
  return (
    <Typography
      sx={{
        fontSize: 13,
        lineHeight: 1.45,
        color: danger ? 'kanap.danger' : muted ? 'kanap.text.secondary' : 'kanap.text.primary',
        overflowWrap: 'anywhere',
      }}
    >
      {text}
    </Typography>
  );
}
