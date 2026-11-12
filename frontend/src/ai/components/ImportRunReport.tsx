import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AiImportReportMessage, AiImportRun } from '../aiTypes';
import { csvMessageColumn, csvMessageText } from '../../components/csv/csvMessage';
import { ReportView as BudgetFileReportView } from '../../components/finance/BudgetFileImportDialog';

/** The messages shown of each kind, as the import dialog shows them. */
const SHOWN_ERRORS = 10;
const SHOWN_WARNINGS = 5;

const sectionLabelSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.secondary',
} as const;

type ImportRunReportProps = {
  run: AiImportRun;
  /** The title of each template column in the person's language, to name the column of a message. */
  titles: ReadonlyMap<string, string>;
};

/** One message: its line of the person's file, the sentence of the import screen, then its column. */
function MessageLine({ item, titles, tone }: { item: AiImportReportMessage; titles: ReadonlyMap<string, string>; tone: 'error' | 'warning' }) {
  const { t } = useTranslation(['common']);
  const text = csvMessageText(item, t);
  const column = csvMessageColumn(item, text);
  return (
    <Box component="li" sx={{ color: tone === 'error' ? 'error.main' : 'kanap.text.primary' }}>
      {item.row > 0 && <>{t('common:csv.rowPrefix', { row: item.row })}{' '}</>}
      {text}
      {column && <Box component="span" sx={{ color: 'kanap.text.tertiary' }}> ({titles.get(column) ?? column})</Box>}
    </Box>
  );
}

function Messages({ title, items, total, shown, more, titles, tone }: {
  title: string;
  items: AiImportReportMessage[];
  total: number;
  shown: number;
  more: string;
  titles: ReadonlyMap<string, string>;
  tone: 'error' | 'warning';
}) {
  if (total === 0) return null;
  return (
    <Stack spacing={0.25}>
      <Typography component="div" sx={{ ...sectionLabelSx, color: tone === 'error' ? 'error.main' : 'warning.main' }}>{title}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.25, fontSize: 12, lineHeight: 1.5 }}>
        {items.slice(0, shown).map((item, index) => <MessageLine key={index} item={item} titles={titles} tone={tone} />)}
      </Box>
      {total > Math.min(shown, items.length) && (
        <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>{more}</Typography>
      )}
    </Stack>
  );
}

/**
 * The import's check of the file Plaid built, on a pending card, or what the import did, on an
 * approved one: the counts and the messages of the import screen, on the lines of the person's file.
 * The budget file's check shows as its own dialog shows it, under the card's status line.
 */
function ImportRunReport({ run, titles }: ImportRunReportProps) {
  const { t, i18n } = useTranslation(['ai', 'common']);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const check = run.dry_run;
  // The budget file's check lists its own changes, errors and warnings.
  const budgetFile = run.report.kind === 'budget_file' ? run.report.file : null;
  const counts = budgetFile ? '' : (check
    ? [
      run.inserted > 0 && t('common:csv.toInsert', { count: run.inserted }),
      run.updated > 0 && t('common:csv.toUpdate', { count: run.updated }),
    ]
    : [
      run.inserted > 0 && t('common:csv.created', { count: run.inserted }),
      run.updated > 0 && t('common:csv.updated', { count: run.updated }),
    ]).concat([
    run.unchanged > 0 && t('common:csv.unchanged', { count: run.unchanged }),
    run.skipped > 0 && t('common:csv.skipped', { count: run.skipped }),
  ]).filter(Boolean).join(' · ');

  const status = !run.ok
    ? t('common:csv.validationFailed')
    : check ? t('common:csv.validationPassed', { count: run.total }) : t('common:csv.importCompleted');

  return (
    <Stack spacing={0.75}>
      <Typography component="div" sx={sectionLabelSx}>
        {check ? t('ai:previewCard.importRun.check') : t('ai:previewCard.importRun.result')}
      </Typography>
      <Typography sx={{ fontSize: 12, color: run.ok ? 'kanap.text.primary' : 'error.main' }}>
        {status}
        {counts && <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{' '}{counts}</Box>}
      </Typography>
      {budgetFile && (
        <BudgetFileReportView
          report={budgetFile}
          locale={locale}
          canCreateSuppliers={false}
          nothingToLoad={run.inserted + run.updated === 0}
          showStatus={false}
          // The card lists the lookalikes of its check before its actions.
          hideDuplicates={check}
        />
      )}
      {run.report.kind === 'rows' && (
        <>
          <Messages
            title={t('common:csv.errors', { count: run.error_count })}
            items={run.report.errors}
            total={run.error_count}
            shown={SHOWN_ERRORS}
            more={t('common:csv.andMoreErrors2', { count: run.error_count - Math.min(SHOWN_ERRORS, run.report.errors.length) })}
            titles={titles}
            tone="error"
          />
          <Messages
            title={t('common:csv.warnings', { count: run.warning_count })}
            items={run.report.warnings}
            total={run.warning_count}
            shown={SHOWN_WARNINGS}
            more={t('common:csv.andMoreWarnings', { count: run.warning_count - Math.min(SHOWN_WARNINGS, run.report.warnings.length) })}
            titles={titles}
            tone="warning"
          />
        </>
      )}
    </Stack>
  );
}

export default React.memo(ImportRunReport);
