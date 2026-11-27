import React from 'react';
import { Box, Checkbox, Link, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AiImportChoice, AiImportHostingSite, AiImportReportMessage, AiImportRun } from '../aiTypes';
import { csvMessageColumn, csvMessageText } from '../../components/csv/csvMessage';
import { withCatalogValueName } from '../../utils/catalogReportMessage';
import { ReportView as BudgetFileReportView } from '../../components/finance/BudgetFileImportDialog';
import { useAuth } from '../../auth/AuthContext';
import ImportMatchesView from '../../components/csv/ImportMatchesView';
import ImportLookalikesView, { applicationLookalikeReason, applicationUpdateChoice } from '../../components/csv/ImportLookalikesView';
import type { CsvImportUpdate, ImportLookalike } from '../../components/csv/csv.types';
import { buildEntityUrl } from '../utils/entityUrls';

/** The messages shown of each kind, as the import dialog shows them. */
const SHOWN_ERRORS = 10;
const SHOWN_WARNINGS = 5;
/** The rows that update a record shown under the counts; the others are counted. */
const SHOWN_UPDATES = 10;

const sectionLabelSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.secondary',
} as const;

type ImportRunReportProps = {
  run: AiImportRun;
  /** The title of each template column in the person's language, to name the column of a message. */
  titles: ReadonlyMap<string, string>;
  /**
   * The person's choices on a pending check, the whole list: a budget file's (matches undone, missing
   * suppliers), or another import's (matches undone, rows that look like an existing application).
   */
  onChoices?: (choices: AiImportChoice[]) => void;
  /** A choice is being applied: the controls wait for the new card. */
  choicesDisabled?: boolean;
};

/** One message: its line of the person's file, the sentence of the import screen, then its column. */
function MessageLine({ item, titles, tone }: { item: AiImportReportMessage; titles: ReadonlyMap<string, string>; tone: 'error' | 'warning' }) {
  const { t } = useTranslation(['common']);
  const text = csvMessageText(withCatalogValueName(item, t), t, (key) => titles.get(key) ?? key);
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
 * The rows of the file that update a record (Q1 of 26.11.9), under the counts: the line of the person's
 * file, the record's reference, linked to the address of its page the server gives (`page_url`), then its name.
 */
function UpdateLines({ updates, total }: { updates: Array<CsvImportUpdate & { page_url?: string }>; total: number }) {
  const { t } = useTranslation(['common', 'ops']);
  const shown = updates.slice(0, SHOWN_UPDATES);
  return (
    <Stack spacing={0.25}>
      <Box component="ul" sx={{ m: 0, pl: 2.25, fontSize: 12, lineHeight: 1.5, color: 'kanap.text.secondary' }}>
        {shown.map((entry) => {
          const url = entry.ref ? entry.page_url : undefined;
          return (
            <Box component="li" key={`${entry.row}-${entry.ref ?? entry.name}`} sx={{ overflowWrap: 'anywhere' }}>
              {t('common:csv.rowPrefix', { row: entry.row })}{' '}
              {entry.ref && (
                <>
                  {url ? <Link href={url} target="_blank" rel="noopener noreferrer" underline="hover">{entry.ref}</Link> : entry.ref}
                  {' · '}
                </>
              )}
              {entry.name}
            </Box>
          );
        })}
      </Box>
      {total > shown.length && (
        <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>{t('ops:operations.budgetFile.andMore', { count: total - shown.length })}</Typography>
      )}
    </Stack>
  );
}

/**
 * How the servers of an import are hosted, in one line (lot I3 of 26.11.9, T-I3f): each site the file
 * names, by its reference and name, with its category (on site, cloud), or its hosting type when the
 * type has none, and its provider.
 */
function HostingLine({ sites }: { sites: AiImportHostingSite[] }) {
  const { t } = useTranslation(['ai']);
  const hosting = (site: AiImportHostingSite) => [
    site.category === 'on_prem' ? t('ai:previewCard.importRun.onPremises') : site.category === 'cloud' ? t('ai:previewCard.importRun.cloud') : site.label,
    site.provider,
  ].filter(Boolean).join(', ');
  const text = sites.map((site) => `${site.ref} ${site.name} (${hosting(site)})`).join(t('ai:previewCard.importRun.hostingSeparator'));
  return (
    <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'kanap.text.secondary', overflowWrap: 'anywhere' }}>
      {t('ai:previewCard.importRun.hosting', { sites: text })}
    </Typography>
  );
}

/**
 * The import's check of the file Plaid built, on a pending card, or what the import did, on an
 * approved one: the counts and the messages of the import screen, on the lines of the person's file.
 * The budget file's check shows as its own dialog shows it, under the card's status line.
 */
function ImportRunReport({ run, titles, onChoices, choicesDisabled }: ImportRunReportProps) {
  const { t, i18n } = useTranslation(['ai', 'common', 'ops']);
  const { hasLevel } = useAuth();
  const [matchesOpen, setMatchesOpen] = React.useState(false);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const check = run.dry_run;
  // The budget file's check lists its own changes, errors and warnings.
  const budgetFile = run.report.kind === 'budget_file' ? run.report.file : null;
  // Choices are made on the check only, never on what the import did.
  const choose = check ? onChoices : undefined;
  const matching = budgetFile?.matching;
  // A row import's choices on this card, the whole list a choice sends again: its matches undone, then
  // the choices the check followed on the rows that look like an existing application, as it gave them
  // back (the targets of the rows it left out included).
  const undone = run.report.kind === 'rows' ? run.report.undone ?? [] : [];
  const lookalikes = run.report.kind === 'rows' && run.report.lookalikes && run.report.lookalikes.count > 0 ? run.report.lookalikes : null;
  const rowChoices: AiImportChoice[] = [
    ...undone.map((item) => ({ kind: 'unmatch' as const, ...item })),
    ...(lookalikes?.choices ?? []),
  ];
  // The server says whether the person may create suppliers, and whether the check created them.
  const suppliersBox = !!choose && !!matching?.createSuppliers.allowed;
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
    // The budget file's skipped rows are those left out because they look like an existing line.
    run.skipped > 0 && (run.report.kind === 'budget_file'
      ? t('ops:operations.budgetFile.lookalikes.skipped', { count: run.skipped })
      : t('common:csv.skipped', { count: run.skipped })),
  ]).filter(Boolean).join(' · ');

  const status = !run.ok
    ? t('common:csv.validationFailed')
    : !check ? t('common:csv.importCompleted')
      // A check that passes with nothing to create or change: nothing to approve, said in the normal colour.
      : run.nothing_to_import ? t('common:csv.nothingToImport') : t('common:csv.validationPassed', { count: run.total });

  return (
    <Stack spacing={0.75}>
      <Typography component="div" sx={sectionLabelSx}>
        {check ? t('ai:previewCard.importRun.check') : t('ai:previewCard.importRun.result')}
      </Typography>
      <Typography sx={{ fontSize: 12, color: run.ok ? 'kanap.text.primary' : 'error.main' }}>
        {status}
        {counts && <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{' '}{counts}</Box>}
      </Typography>
      {run.report.kind === 'rows' && (run.report.updates?.length ?? 0) > 0 && (
        <UpdateLines
          updates={run.report.updates!}
          total={Math.max(run.report.updatesTotal ?? 0, run.report.updates!.length)}
        />
      )}
      {check && (run.cleared ?? 0) > 0 && (
        <Typography sx={{ fontSize: 12, color: 'kanap.text.primary' }}>
          {t('common:csv.valuesWillBeCleared', { count: run.cleared })}
        </Typography>
      )}
      {suppliersBox && matching && (
        <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer', alignSelf: 'flex-start' }}>
          <Checkbox
            size="small"
            checked={matching.createSuppliers.value}
            disabled={choicesDisabled}
            onChange={(event) => choose?.([
              ...matching.choices.filter((choice) => choice.kind !== 'create_suppliers'),
              { kind: 'create_suppliers', value: event.target.checked },
            ])}
            sx={{ p: 0.25 }}
          />
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary', lineHeight: 1.4 }}>
            {t('ops:operations.budgetFile.createSuppliers')}
          </Typography>
        </Box>
      )}
      {budgetFile && (
        <BudgetFileReportView
          report={budgetFile}
          locale={locale}
          canCreateSuppliers={suppliersBox}
          onChoices={choose}
          choicesDisabled={choicesDisabled}
          nothingToLoad={run.nothing_to_import === true}
          showStatus={false}
          ownScroll={false}
          canOpenLines={hasLevel('budget', 'reader')}
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
          {run.report.hosting && run.report.hosting.length > 0 && <HostingLine sites={run.report.hosting} />}
          <ImportMatchesView
            matches={run.report.matches ?? []}
            matchesTotal={run.report.matchesTotal}
            refusedProposals={run.report.refusedProposals ?? []}
            refusedTotal={run.report.refusedProposalsTotal}
            columnName={(column) => titles.get(column) ?? column}
            open={matchesOpen}
            onToggle={() => setMatchesOpen((open) => !open)}
            onUndo={choose ? (entry) => choose([...rowChoices, { kind: 'unmatch', column: entry.column, value: entry.value }]) : undefined}
            undone={undone}
            onRedo={choose ? (entry) => choose(rowChoices.filter((choice) => !(choice.kind === 'unmatch' && choice.column === entry.column && choice.value === entry.value))) : undefined}
            disabled={choicesDisabled}
          />
          {lookalikes && (
            <ImportLookalikesView<ImportLookalike, AiImportChoice>
              lookalikes={lookalikes}
              title={t('ops:operations.budgetFile.lookalikes.applicationsTitle')}
              choices={rowChoices}
              updateChoice={applicationUpdateChoice}
              onChoices={choose}
              choicesDisabled={choicesDisabled}
              reasonText={(look) => applicationLookalikeReason(look, t)}
              targetUrl={(look) => buildEntityUrl('applications', look.target.ref)}
              fieldName={(field) => titles.get(field) ?? field}
              changedLines={new Set(run.report.errors.filter((error) => error.code === 'CSV_LOOKALIKE_CHANGED').map((error) => error.row))}
              refusedLines={new Set(run.report.errors.map((error) => error.row))}
            />
          )}
        </>
      )}
    </Stack>
  );
}

export default React.memo(ImportRunReport);
