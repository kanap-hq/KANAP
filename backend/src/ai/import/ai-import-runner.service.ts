import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { CsvLanguage } from '../../common/csv-sheet';
import { XLSX_CONTENT_TYPE } from '../../common/xlsx/write';
import { AccountsService } from '../../accounts/accounts.service';
import { AnalyticsCategoriesCsvService } from '../../analytics/analytics-categories-csv.service';
import { ApplicationsCsvService } from '../../applications/applications-csv.service';
import { AssetsCsvService } from '../../assets/assets-csv.service';
import { AuditService } from '../../audit/audit.service';
import { resolveBusinessContributorScopeForUser } from '../../auth/business-contributor-scope';
import { BusinessProcessesService } from '../../business-processes/business-processes.service';
import { CompaniesService } from '../../companies/companies.service';
import { ContactsService } from '../../contacts/contacts.service';
import { ContractsService } from '../../contracts/contracts.service';
import { CostCentersCsvService } from '../../cost-centers/cost-centers-csv.service';
import { DepartmentsService } from '../../departments/departments.service';
import { FreezeService } from '../../freeze/freeze.service';
import { IncidentsCsvService } from '../../incidents/incidents-csv.service';
import { incidentViewerFromContext } from '../../incidents/incident-visibility';
import { PortfolioProjectsCsvService } from '../../portfolio/portfolio-projects-csv.service';
import { PortfolioRequestsCsvService } from '../../portfolio/portfolio-requests-csv.service';
import { BudgetFileService, canCreateSuppliers, readableLists } from '../../spend/budget-file/budget-file.service';
import { createSuppliersChoice } from '../../spend/budget-file/matching';
import type {
  BudgetFileChoice,
  BudgetFileLookalikes,
  BudgetFileMatching,
  BudgetFileNatureCounts,
} from '../../spend/budget-file/types';
import type { ImportLookalikeChoice, ImportLookalikes } from '../../common/csv/csv-lookalikes';
import type { BudgetNature } from '../../spend/budget-nature';
import type { ImportNameMatch, ImportRefusedProposal } from '../../common/name-matching';
import { CapexItemsService, SpendItemsService } from '../../spend/spend-items.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { TasksCsvService } from '../../tasks/tasks-csv.service';
import { TechnologyLinksCsvService } from '../../technologies/technology-links-csv.service';
import { WorkingDayProfilesCsvService } from '../../working-day-profiles/working-day-profiles-csv.service';
import { AiPolicyService } from '../ai-policy.service';
import type { AiExecutionContextWithManager, AiImportReportMessage, AiImportRunDto } from '../ai.types';
import type { AiImportKey } from './ai-import-access';
import { isImportMatchedColumn, type ImportCardChoice } from './ai-import-targets';
import { enabledDimensionValues } from './ai-import-dimension-values';
import { AI_IMPORT_FILE_NAME } from './ai-import-file';

/** Messages of a row import the card keeps, of each kind: its dialog shows the first ten errors and five warnings. */
const KEPT_ERRORS = 50;
const KEPT_WARNINGS = 20;

/** A row import's report: every import but the budget file answers with these fields. */
type RowsReport = {
  ok: boolean;
  total?: number;
  processed?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  /** The stored values the rows clear with `-` (D21 of 26.11.9): every row import counts them. */
  cleared?: number;
  skipped?: number;
  errors?: AiImportReportMessage[];
  warnings?: AiImportReportMessage[];
  /** The declarative imports: the names found beyond case, on the lines of the built file (lot I3 of 26.11.9). */
  matches?: ImportNameMatch[];
  matchesTotal?: number;
  /** Kad's proposals the import refused, on the lines of the built file. */
  refusedProposals?: ImportRefusedProposal[];
  refusedProposalsTotal?: number;
  /** The applications: the rows that would create one and look like one the person reads, on the lines of the built file (lot I3 of 26.11.9). */
  lookalikes?: ImportLookalikes;
};

/** The person's choices on a card and the model's proposals, as the imports follow them. */
type CardMatching = {
  choices?: readonly ImportCardChoice[];
  proposals?: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

/** The budget file's report (`BudgetFileReport`) or its load (`BudgetFileImportOk`), as far as the bilan reads it. */
type BudgetFileAnswer = {
  ok: boolean;
  inserted?: number;
  updated?: number;
  skipped?: number;
  snapshot?: unknown;
  fileErrors?: string[];
  headerErrors?: string[];
  errors?: Array<{ line: number; column: string | null; message: string; code?: string }>;
  errorCount?: number;
  missing?: Array<{ type: string; count: number }>;
  deletedCount?: number;
  creates?: { supplierCount?: number; dimensionValueCount?: number };
  supplierMessage?: string | null;
  matching?: BudgetFileMatching;
  changes?: { created: number; updated: number; unchanged: number; cleared?: number; byNature?: BudgetFileNatureCounts };
  /** The load: the stored values its `-` cells cleared, as its check counted them. */
  cleared?: number;
  warnings?: Record<string, unknown>;
  lookalikes?: BudgetFileLookalikes;
};

/** How an import is called: the file built in its template's format, the check or the load, the person's language. */
type ImportCall = {
  file: Express.Multer.File;
  dryRun: boolean;
  language: CsvLanguage;
  context: AiExecutionContextWithManager;
  /** The person's choices on the card (a budget file's, the matches undone of any import, an application's lookalikes) and the model's proposals. */
  matching?: CardMatching;
};

/**
 * The imports of the screens, called as their routes call them (lot I3 of the Plaid import): the same
 * services, the same options (the screen's "merge" mode, the clearing rule of every import (D21 of
 * 26.11.9), the person's language, the decimal point the file is written with), in the transaction of the person's call, which carries their data access.
 * Plaid writes nothing itself. The answers become one bilan, whose row numbers are the lines of the
 * person's own file.
 */
@Injectable()
export class AiImportRunnerService {
  constructor(
    private readonly applications: ApplicationsCsvService,
    private readonly assets: AssetsCsvService,
    private readonly projects: PortfolioProjectsCsvService,
    private readonly requests: PortfolioRequestsCsvService,
    private readonly tasks: TasksCsvService,
    private readonly incidents: IncidentsCsvService,
    private readonly suppliers: SuppliersService,
    private readonly contacts: ContactsService,
    private readonly contracts: ContractsService,
    private readonly companies: CompaniesService,
    private readonly departments: DepartmentsService,
    private readonly costCenters: CostCentersCsvService,
    private readonly accounts: AccountsService,
    private readonly analytics: AnalyticsCategoriesCsvService,
    private readonly businessProcesses: BusinessProcessesService,
    private readonly calendars: WorkingDayProfilesCsvService,
    private readonly technologyLinks: TechnologyLinksCsvService,
    private readonly budgetFile: BudgetFileService,
    private readonly opexItems: SpendItemsService,
    private readonly capexItems: CapexItemsService,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
    private readonly policy: AiPolicyService,
  ) {}

  /**
   * Checks (`dryRun`) or loads the file through the import of `key`. `lines` gives the line of the
   * person's file of each data row of the built file, in order.
   */
  async run(
    key: AiImportKey,
    content: Buffer,
    options: { dryRun: boolean; language: CsvLanguage; lines: readonly number[]; matching?: CardMatching },
    context: AiExecutionContextWithManager,
  ): Promise<AiImportRunDto> {
    const file = {
      fieldname: 'file',
      originalname: AI_IMPORT_FILE_NAME,
      encoding: '7bit',
      mimetype: XLSX_CONTENT_TYPE,
      size: content.length,
      buffer: content,
    } as Express.Multer.File;
    // A choice for one row names the line of the person's file: the built file's line goes to the check.
    const matching = options.matching
      ? { ...options.matching, choices: builtLineChoices(options.matching.choices ?? [], options.lines) }
      : undefined;
    const call: ImportCall = { file, dryRun: options.dryRun, language: options.language, context, matching };
    if (key === 'budget_lines') {
      const answer = await this.runBudgetFile(call);
      // A dimension value the check would create comes with its dimension's values, for the model to read.
      const createsValues = answer.matching?.candidates.some((entry) => entry.outcome === 'create' && entry.column.startsWith('analytics:'));
      const values = options.dryRun && createsValues ? await enabledDimensionValues(context) : undefined;
      return budgetBilan(answer, options.dryRun, options.lines, values, options.language);
    }
    return rowsCard(key, rowsBilan(await this.runRows(key, call), options.dryRun, options.lines, options.language), options.matching?.choices ?? []);
  }

  private async runRows(key: Exclude<AiImportKey, 'budget_lines'>, { file, dryRun, language, context, matching }: ImportCall): Promise<RowsReport> {
    const manager = context.manager as EntityManager;
    const { tenantId, userId } = context;
    // The matches the person undid on the card, by column and value (no line: nothing to carry back),
    // and the model's proposals, which the import checks (lot I3 of 26.11.9).
    const names = {
      unmatched: (matching?.choices ?? []).flatMap((choice) => (choice.kind === 'unmatch' ? [{ column: choice.column, value: choice.value }] : [])),
      ...(matching?.proposals ? { proposals: matching.proposals } : {}),
    };
    // The file holds numbers as number cells and days as date cells, written with a decimal point.
    // The clearing rule of every import (D21 of 26.11.9), which the imports of lot I4 take as a mode:
    // a blank cell keeps, `-` clears. The six of the shared import (`merge`) have no other rule.
    const read = { language, decimalMark: '.' as const, mode: 'enrich' as const };
    // The screen's recommended preset: add the new records, update the matched ones, keep what a blank cell does not say.
    const merge = { dryRun, operation: 'upsert' as const, ...names };
    const caller = { manager, tenantId, userId: userId || null };
    // The person's rights, read once: a name is found beyond case in the families they read, as on the screen.
    const rights = () => this.policy.effectiveAccess(context, manager);
    switch (key) {
      case 'applications': {
        // The rows that look like an application: the person's choices on the card (lot I3 of 26.11.9).
        const lookalikes = (matching?.choices ?? []).filter((choice) => choice.kind === 'lookalike' || choice.kind === 'lookalikes') as ImportLookalikeChoice[];
        return this.applications.import(file, { ...merge, lookalikes }, { manager, tenantId, userId, language, access: await rights() });
      }
      case 'assets':
        return this.assets.import(file, merge, { manager, tenantId, userId, language, access: await rights() });
      case 'portfolio_projects':
        return this.projects.import(file, merge, { manager, tenantId, userId, language, access: await rights() });
      case 'portfolio_requests':
        return this.requests.import(file, merge, { manager, tenantId, userId, language, access: await rights() });
      case 'tasks': {
        const access = await rights();
        return this.tasks.import(file, merge, { manager, tenantId, userId, viewer: incidentViewerFromContext({ userId, ...access }), language, access });
      }
      case 'incidents': {
        const access = await rights();
        const viewer = incidentViewerFromContext({ userId, ...access });
        return this.incidents.import(file, merge, { manager, tenantId, userId: userId || null, isAdmin: viewer.isAdmin, viewer, language, access });
      }
      case 'suppliers':
        return this.suppliers.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager });
      case 'contacts':
        return this.contacts.importCsv({ file, dryRun, ...read, access: await rights(), ...names }, caller);
      case 'contracts':
        return this.contracts.importCsv({ file, dryRun, userId: userId || null, ...read, access: await rights(), ...names }, { manager });
      case 'companies':
        return this.companies.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager });
      case 'departments':
        return this.departments.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager });
      case 'cost_centers':
        return this.costCenters.importCsv({ file, dryRun, ...read, access: await rights(), ...names }, caller);
      case 'accounts':
        // The chart of each row is named by its `coa_code` column, as the import of the accounts page.
        return this.accounts.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager, allowCoaCodeColumn: true });
      case 'analytics_categories':
        return this.analytics.importCsv({ file, dryRun, ...read }, caller);
      case 'business_processes':
        return this.businessProcesses.importCsv({ file, dryRun, userId: userId || null, ...read, ...names }, { manager });
      case 'working_day_calendars':
        return this.calendars.importCsv({ file, dryRun, ...read }, caller);
      case 'technology_asset_links':
        return this.technologyLinks.importAssetLinks({ file, dryRun, language, mode: 'enrich', access: await rights(), ...names }, caller);
      case 'technology_application_links': {
        // The applications the person reads: all of them, or a Business Contributor's own, as the route.
        const access = await rights();
        const scope = await resolveBusinessContributorScopeForUser({ manager, userId, tenantId, isAdmin: access.isAdmin }, 'applications', 'reader');
        return this.technologyLinks.importApplicationLinks({ file, dryRun, language, mode: 'enrich', access, ...names }, caller, { scope });
      }
    }
  }

  /**
   * The budget file: its preflight is the check. The load takes the snapshot of a preflight run just
   * before it, as the dialog sends the one it showed: the lines the file names are the ones checked.
   * The card's "Create missing suppliers" box, the dialog's option, is ticked unless the person
   * unticked it (a `create_suppliers` choice); it creates suppliers only for a person who may. The
   * person's undone matches and the model's proposals go to the check and to the load alike.
   */
  private async runBudgetFile({ file, dryRun, language, context, matching }: ImportCall): Promise<BudgetFileAnswer> {
    const manager = context.manager as EntityManager;
    const caller = { manager, tenantId: context.tenantId, userId: context.userId || null };
    const access = await this.policy.effectiveAccess(context, manager);
    // The route's switches, as the dialog sends them: the file is written with a decimal point.
    // The card of a budget file takes the budget file's choices only (`parseImportChoices`).
    const budgetMatching = matching ? { ...matching, choices: (matching.choices ?? []) as BudgetFileChoice[] } : undefined;
    const options = {
      language,
      dateOrder: undefined,
      decimalMark: 'dot',
      createSuppliers: createSuppliersChoice(budgetMatching?.choices ?? []) ?? true,
      canCreateSuppliers: canCreateSuppliers(access),
      ...readableLists(access),
      matching: budgetMatching,
    };
    const preflight = await this.budgetFile.preflight('opex', file.buffer, caller, options);
    if (dryRun || !preflight.ok) return preflight;
    return this.budgetFile.importFile('opex', file.buffer, preflight.snapshot, caller, options, {
      items: { opex: this.opexItems, capex: this.capexItems },
      audit: this.audit,
      freeze: this.freeze,
    });
  }

}

/**
 * The line of the person's file a row of the built file stands for: the built file holds the header
 * on its first line, then one row per data row of the person's file, so line `n` (2 and more) is data
 * row `n - 2`. The header and the file itself are line 0: a message about the file.
 */
export function personLine(row: number, lines: readonly number[]): number {
  if (!Number.isInteger(row) || row < 2) return 0;
  return lines[row - 2] ?? row;
}

/**
 * The choices of the card, whose rows are lines of the person's file, with the line of the built file
 * instead (the inverse of `personLine`): a choice for a line the built file does not hold is dropped.
 */
export function builtLineChoices<T extends ImportCardChoice>(choices: readonly T[], lines: readonly number[]): T[] {
  const built = (line: number) => {
    const index = lines.indexOf(line);
    return index < 0 ? null : index + 2;
  };
  return choices.flatMap((choice): T[] => {
    if (choice.kind === 'lookalikes' && choice.targets) return [{ ...choice, targets: rekeyed(choice.targets as Readonly<Record<string, unknown>>, built) } as T];
    if (choice.kind !== 'lookalike') return [choice];
    const line = built(choice.line);
    return line === null ? [] : [{ ...choice, line }];
  });
}

/** The choices the check followed, on the lines of the person's file. */
function personLineChoices<T extends ImportCardChoice>(choices: readonly T[], lines: readonly number[]): T[] {
  return choices.map((choice): T => {
    if (choice.kind === 'lookalike') return { ...choice, line: personLine(choice.line, lines) };
    if (choice.kind === 'lookalikes' && choice.targets) {
      return { ...choice, targets: rekeyed(choice.targets as Readonly<Record<string, unknown>>, (line) => personLine(line, lines)) } as T;
    }
    return choice;
  });
}

/** A record keyed by line of a file (`targets`), keyed by the line `to` gives instead; a line it drops (null) is dropped. */
function rekeyed<T>(byLine: Readonly<Record<string, T>>, to: (line: number) => number | null): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(byLine)) {
    const line = to(Number(key));
    if (line !== null && line > 0) out[String(line)] = value;
  }
  return out;
}

/** The lines an issue names for the model: the first ones, as the card lists its messages. */
const KEPT_ISSUE_LINES = 20;

/** Counts a message under its code and column, with its line of the person's file (0: the file itself). */
function tally(
  issues: AiImportRunDto['issues'],
  level: 'error' | 'warning',
  code: string | null,
  column: string | null,
  line: number,
): void {
  let found = issues.find((issue) => issue.level === level && issue.code === code && issue.column === column);
  if (found) found.count += 1;
  else issues.push(found = { level, code, column, count: 1 });
  if (line > 0 && (found.file_lines?.length ?? 0) < KEPT_ISSUE_LINES) {
    found.file_lines = [...(found.file_lines ?? []), line];
  }
}

function message(item: AiImportReportMessage, lines: readonly number[]): AiImportReportMessage {
  // The row that already updates the application a row looks like (`CSV_LOOKALIKE_SAME_RECORD`, its `other`).
  const params = item.code === 'CSV_LOOKALIKE_SAME_RECORD' && item.params && typeof item.params.other === 'number'
    ? { ...item.params, other: personLine(item.params.other, lines) }
    : item.params;
  return {
    row: personLine(item.row, lines),
    ...(item.column ? { column: item.column } : {}),
    message: item.message,
    ...(item.code ? { code: item.code } : {}),
    ...(params ? { params } : {}),
  };
}

/** The applications' lookalikes on the lines of the person's file: each row, the targets and the choices followed. */
function personLineLookalikes(lookalikes: ImportLookalikes, lines: readonly number[]): ImportLookalikes {
  return {
    ...lookalikes,
    lines: lookalikes.lines.map((entry) => ({ ...entry, line: personLine(entry.line, lines) })),
    targets: rekeyed(lookalikes.targets, (line) => personLine(line, lines)),
    choices: personLineChoices(lookalikes.choices, lines),
  };
}

/**
 * The bilan of a row import: its counts, its messages on the person's lines, and their tally for the
 * model; the names it found beyond case and Kad's proposals it refused, on the person's lines (the
 * card shows them from lot I3's fifth pass).
 */
/**
 * The card of a row import (lot I3 of 26.11.9, fifth pass): a match is undoable there only in a column
 * the card's choice route takes for the import, and the report gives back the matches the person undid
 * on the card (`undone`), for it to send the whole list with the next one, as a budget file's card
 * sends its choices.
 */
export function rowsCard(key: AiImportKey, run: AiImportRunDto, choices: readonly ImportCardChoice[]): AiImportRunDto {
  if (run.report.kind !== 'rows') return run;
  const undone = choices.flatMap((choice) => (choice.kind === 'unmatch' ? [{ column: choice.column, value: choice.value }] : []));
  const matches = run.report.matches?.map((match) => (
    match.undoable && !isImportMatchedColumn(key, match.column) ? { ...match, undoable: false } : match
  ));
  return { ...run, report: { ...run.report, ...(matches ? { matches } : {}), ...(undone.length > 0 ? { undone } : {}) } };
}

export function rowsBilan(result: RowsReport, dryRun: boolean, lines: readonly number[], language: CsvLanguage = 'en'): AiImportRunDto {
  const errors = result.errors ?? [];
  const warnings = result.warnings ?? [];
  const issues: AiImportRunDto['issues'] = [];
  for (const error of errors) tally(issues, 'error', error.code ?? null, error.column ?? null, personLine(error.row, lines));
  for (const warning of warnings) tally(issues, 'warning', warning.code ?? null, warning.column ?? null, personLine(warning.row, lines));
  const ok = result.ok === true && errors.length === 0;
  const inserted = result.inserted ?? 0;
  const updated = result.updated ?? 0;
  const lookalikes = result.lookalikes ? personLineLookalikes(result.lookalikes, lines) : undefined;
  const similar = dryRun && lookalikes ? similarApplications(lookalikes, language) : undefined;
  return {
    ok,
    ...(dryRun && nothingToImport({ ok, inserted, updated }) ? { nothing_to_import: true as const } : {}),
    ...(similar ? { similar_lines: similar } : {}),
    dry_run: dryRun,
    total: result.total ?? result.processed ?? lines.length,
    inserted,
    updated,
    unchanged: result.unchanged ?? 0,
    cleared: result.cleared ?? 0,
    skipped: result.skipped ?? 0,
    error_count: errors.length,
    warning_count: warnings.length,
    issues,
    report: {
      kind: 'rows',
      errors: errors.slice(0, KEPT_ERRORS).map((error) => message(error, lines)),
      warnings: warnings.slice(0, KEPT_WARNINGS).map((warning) => message(warning, lines)),
      ...(result.matches?.length
        ? {
            matches: result.matches.map((match) => ({ ...match, lines: match.lines.map((line) => personLine(line, lines)) })),
            matchesTotal: result.matchesTotal ?? result.matches.length,
          }
        : {}),
      ...(result.refusedProposals?.length
        ? {
            refusedProposals: result.refusedProposals.map((entry) => ({ ...entry, lines: entry.lines.map((line) => personLine(line, lines)) })),
            refusedProposalsTotal: result.refusedProposalsTotal ?? result.refusedProposals.length,
          }
        : {}),
      ...(lookalikes ? { lookalikes } : {}),
    },
  };
}

/**
 * Whether a check that passed leaves nothing to write (P5 of 26.11.9): no record created or updated
 * and, for the budget file, no supplier or dimension value created. Every import counts what it
 * writes: a row whose owners, data residency, viewers, contacts, metrics, document texts or
 * operating system change is an update (each import's `sameAsStored` or its equivalent compares
 * them), so a file that changes only those is never "nothing to import".
 */
export function nothingToImport(counts: { ok: boolean; inserted: number; updated: number; newSuppliers?: number; newDimensionValues?: number }): boolean {
  return counts.ok
    && counts.inserted + counts.updated + (counts.newSuppliers ?? 0) + (counts.newDimensionValues ?? 0) === 0;
}

/** The facts of the approval of a refused check, for every import. */
const CANNOT_BE_APPROVED = 'This card cannot be approved: the check found errors (issues). Nothing is created or imported until they are corrected.';

function unchangedNote(count: number, what: string): string {
  return count > 0 ? ` (${count} ${what} unchanged)` : '';
}

/** The stored values the approval clears with `-` (D21 of 26.11.9), as the card counts them; nothing when none. */
function clearedNote(count: number): string {
  if (count <= 0) return '';
  return `; ${count} stored ${count === 1 ? 'value' : 'values'} cleared (cells holding "-")`;
}

/** Matches the approval's sentence names; the others are counted ("and N more"). */
const APPROVAL_FACT_MATCHES = 3;

/**
 * The card's words for a supplier found by the application's publisher, after the column's title
 * (`operations.budgetFile.matching.byEditor` of the frontend's `ops` locales; `ai-import-card-texts.spec.ts`).
 */
export const BY_EDITOR: Record<CsvLanguage, string> = {
  en: '{{column}} (publisher)',
  fr: '{{column}} (éditeur)',
  de: '{{column}} (Herausgeber)',
  es: '{{column}} (editor)',
};

/**
 * The check's matches of a row import as the card lists them (lot I3 of 26.11.9, correctifs L): how
 * many, the first ones by the column's title the card shows, with the value of the file and the record
 * (reference, then name); and, for a match found by the publisher (T-I3k), that the application is
 * linked to that supplier. Empty when the check matched nothing.
 */
function rowsMatchFacts(report: AiImportRunDto['report'] | undefined, titles: ReadonlyMap<string, string>, language: CsvLanguage): string {
  const matches = report?.kind === 'rows' ? report.matches ?? [] : [];
  if (matches.length === 0) return '';
  const total = Math.max(report?.kind === 'rows' ? report.matchesTotal ?? 0 : 0, matches.length);
  const names = matches.map((entry) => {
    const title = titles.get(entry.column) ?? entry.column;
    const column = entry.origin === 'editor' ? BY_EDITOR[language].replace('{{column}}', title) : title;
    return `${column}: ${entry.value} → ${entry.ref ? `${entry.ref} ${entry.target}` : entry.target}`;
  });
  const shown = names.slice(0, APPROVAL_FACT_MATCHES);
  const more = total - shown.length;
  return `; ${total} values of the file matched to existing records: ${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}`
    + (matches.some((entry) => entry.origin === 'editor') ? '; each application whose publisher names an existing supplier is linked to that supplier' : '');
}

/**
 * What the approval of a row import's check does, in one sentence (lot I2 of 26.11.9): the records it
 * creates, updates and leaves unchanged, or that there is nothing to import; the stored values it
 * clears with `-` (D21 of 26.11.9, when there are some); then the values the check matched to existing records, as the card names them (`titles`: the card's column titles, by column).
 */
export function rowsApprovalFacts(
  run: Pick<AiImportRunDto, 'ok' | 'inserted' | 'updated' | 'unchanged' | 'cleared'> & { report?: AiImportRunDto['report'] },
  card: { titles?: ReadonlyMap<string, string>; language?: CsvLanguage } = {},
): string {
  if (!run.ok) return CANNOT_BE_APPROVED;
  // The applications that look like a stored one (lot I3 of 26.11.9): left out unless the person chose otherwise.
  const look = run.report?.kind === 'rows' ? run.report.lookalikes : undefined;
  const lookalikes = look && look.count > 0
    ? `; ${look.count} rows of the file look like existing applications: ${look.ignored} left out, ${look.created} created anyway, `
      + `${look.updated} updating the application they look like`
    : '';
  if (nothingToImport(run)) {
    return `Nothing to import: the approval would create and update nothing${unchangedNote(run.unchanged, 'records')}${lookalikes}. `
      + (look && look.ignored > 0
        ? 'Say in one sentence that nothing is imported until a row left out is created anyway or updates the application it looks like, '
          + 'with the card\'s words (`similar_lines.card_choices`).'
        : 'The card cannot be approved.');
  }
  const matches = rowsMatchFacts(run.report, card.titles ?? new Map(), card.language ?? 'en');
  return `On approval: ${run.inserted} records created, ${run.updated} updated, ${run.unchanged} unchanged${clearedNote(run.cleared ?? 0)}${matches}${lookalikes}.`;
}

/**
 * A copy of the budget file's report whose `line` fields are the lines of the person's file, and so
 * is the earlier row a row looks like (`BUDGET_FILE_LOOKS_LIKE_ROW`, its `row`).
 */
function relined(value: unknown, lines: readonly number[]): unknown {
  if (Array.isArray(value)) return value.map((item) => relined(item, lines));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const earlierRow = record.code === LOOKS_LIKE_ROW;
  const sameLine = record.code === LOOKALIKE_SAME_LINE;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    key,
    key === 'line' && typeof item === 'number'
      ? personLine(item, lines)
      : key === 'lines' && Array.isArray(item) && item.every((entry) => typeof entry === 'number')
        ? (item as number[]).map((entry) => personLine(entry, lines))
      : earlierRow && key === 'params' && item && typeof item === 'object'
        ? relinedRow(relined(item, lines) as Record<string, unknown>, lines)
      : sameLine && key === 'params' && item && typeof item === 'object'
        ? relinedOther(relined(item, lines) as Record<string, unknown>, lines)
      : key === 'targets' && item && typeof item === 'object' && !Array.isArray(item)
        ? rekeyed(item as Record<string, unknown>, (line) => personLine(line, lines))
        : relined(item, lines),
  ]));
}

function relinedRow(params: Record<string, unknown>, lines: readonly number[]): Record<string, unknown> {
  return typeof params.row === 'number' ? { ...params, row: personLine(params.row, lines) } : params;
}

/** The row that already updates the line a row looks like (`BUDGET_FILE_LOOKALIKE_SAME_LINE`, its `other`). */
function relinedOther(params: Record<string, unknown>, lines: readonly number[]): Record<string, unknown> {
  return typeof params.other === 'number' ? { ...params, other: personLine(params.other, lines) } : params;
}

const LOOKS_LIKE_ROW = 'BUDGET_FILE_LOOKS_LIKE_ROW';
const LOOKALIKE_SAME_LINE = 'BUDGET_FILE_LOOKALIKE_SAME_LINE';

/** The lookalikes the model reads: the first ones, as the card lists them at once. */
const MODEL_LOOKALIKES = 10;

/**
 * The card's words for the choices of a row that looks like a stored line, keyed by the row's `outcome`,
 * as the screen writes them (`operations.budgetFile.lookalikes.ignore`, `create`, `update` of the
 * frontend's `ops` locales); BL-n stands for the row's `looks_like`.
 */
const CARD_CHOICES: Record<CsvLanguage, { ignored: string; created: string; updated: string }> = {
  en: { ignored: 'Leave out', created: 'Create anyway', updated: 'Update BL-n' },
  fr: { ignored: 'Écarter', created: 'Créer quand même', updated: 'Mettre à jour BL-n' },
  de: { ignored: 'Auslassen', created: 'Trotzdem anlegen', updated: 'BL-n aktualisieren' },
  es: { ignored: 'Descartar', created: 'Crear de todos modos', updated: 'Actualizar BL-n' },
};

/** The card's words for an application's row (lot I3 of 26.11.9), as the screen writes them; APP-n stands for the row's `looks_like`. */
const APPLICATION_CARD_CHOICES: Record<CsvLanguage, { ignored: string; created: string; updated: string }> = {
  en: { ignored: 'Leave out', created: 'Create anyway', updated: 'Update APP-n' },
  fr: { ignored: 'Écarter', created: 'Créer quand même', updated: 'Mettre à jour APP-n' },
  de: { ignored: 'Auslassen', created: 'Trotzdem anlegen', updated: 'APP-n aktualisieren' },
  es: { ignored: 'Descartar', created: 'Crear de todos modos', updated: 'Actualizar APP-n' },
};

/** How the model names the choices of these rows: the prepare tool's hint says it too. */
export const LOOKALIKE_CHOICE_WORDS_RULE = 'Name these choices only by the card\'s words (`similar_lines.card_choices`, BL-n or APP-n standing for the row\'s '
  + '`looks_like`), never by a code (ignore, create, update, ignored, created, updated). Never say the person must choose for each row: '
  + 'a row left out is simply not imported, and the card can be approved as soon as it has something to import.';

const SIMILAR_LINES_NOTE = 'Rows of the file that look like a budget line the person can read (`looks_like`, with the reason): '
  + 'the import leaves them out unless the person chooses on the card to create them anyway or to update that line '
  + '(`outcome`: ignored, created, updated). Rows that look like an earlier row of the file (`looks_like_file_line`) '
  + 'are created. Tell the person in one sentence before they approve (file line and reference); the card lists them '
  + `and holds the choices: never call a row left out created. ${LOOKALIKE_CHOICE_WORDS_RULE}`;

const SIMILAR_APPLICATIONS_NOTE = 'Rows of the file that would create an application and look like an application the person can read '
  + '(`looks_like`, its reference, with the reason: name_accents, the same name but for accents; close_name, a close name with the same '
  + 'supplier or publisher): the import leaves them out unless the person chooses on the card to create them anyway or to update that '
  + 'application (`outcome`: ignored, created, updated); an update keeps the application\'s name. Tell the person in one sentence before '
  + 'they approve (file line and reference); the card lists them, names the applications and holds the choices: never call a row left out '
  + `created. ${LOOKALIKE_CHOICE_WORDS_RULE}`;

/** The applications' lookalikes for the model, on the person's lines: their number, the counts by outcome and the first ones. */
function similarApplications(look: ImportLookalikes, language: CsvLanguage): AiImportRunDto['similar_lines'] {
  if (look.count === 0) return undefined;
  return {
    count: look.count,
    ignored: look.ignored,
    created_anyway: look.created,
    updated: look.updated,
    card_choices: APPLICATION_CARD_CHOICES[language],
    first: look.lines.slice(0, MODEL_LOOKALIKES).map((entry) => ({
      file_line: entry.line, looks_like: entry.target.ref, ...(entry.reason ? { reason: entry.reason } : {}), outcome: entry.outcome,
    })),
    note: SIMILAR_APPLICATIONS_NOTE,
  };
}

type Lookalike = { line?: number; code?: string; params?: Record<string, unknown> };

/**
 * The budget file's lookalikes for the model, on the person's lines: the rows that look like a stored
 * line (`lookalikes`, left out unless the person chose otherwise) and those that look like an earlier
 * row of the file (`warnings.duplicates`), their number and the first ones.
 */
function similarLines(answer: BudgetFileAnswer, lines: readonly number[], language: CsvLanguage): AiImportRunDto['similar_lines'] {
  const stored = answer.lookalikes;
  const warnings = answer.warnings;
  const rows = Array.isArray(warnings?.duplicates) ? warnings!.duplicates as Lookalike[] : [];
  const rowCount = typeof warnings?.duplicatesCount === 'number' ? Math.max(warnings.duplicatesCount, rows.length) : rows.length;
  if ((stored?.count ?? 0) === 0 && rowCount === 0) return undefined;
  type Similar = NonNullable<AiImportRunDto['similar_lines']>['first'][number];
  const first: Similar[] = (stored?.lines ?? []).slice(0, MODEL_LOOKALIKES).map((entry) => ({
    file_line: personLine(entry.line, lines), looks_like: entry.target.ref, reason: entry.reason, outcome: entry.outcome,
  }));
  for (const item of rows.slice(0, Math.max(0, MODEL_LOOKALIKES - first.length))) {
    const line = typeof item.line === 'number' ? personLine(item.line, lines) : 0;
    if (line > 0 && item.code === LOOKS_LIKE_ROW && typeof item.params?.row === 'number') {
      first.push({ file_line: line, looks_like_file_line: personLine(item.params.row, lines) });
    }
  }
  return {
    count: (stored?.count ?? 0) + rowCount,
    ...(stored ? { ignored: stored.ignored, created_anyway: stored.created, updated: stored.updated, card_choices: CARD_CHOICES[language] } : {}),
    first,
    note: SIMILAR_LINES_NOTE,
  };
}

/** Entries of each matching list the model reads: the card lists them all. */
const MODEL_MATCHING_ENTRIES = 60;

const MATCHING_NOTE = 'matches: values of the file the check matched to an existing value beyond case (origin server: accents '
  + 'or another language; origin model: your `values`); the card lists them and the person may undo one. refused_proposals: '
  + 'your `values` whose target is not an enabled value of the workspace: they were not applied. candidates: values nothing '
  + 'matched, created on approval (outcome create, one entry per value created) or refused, with the closest names of the '
  + 'workspace\'s list (`candidates`) and, for a dimension value created, the enabled values of its dimension '
  + '(`dimension_values`, the first ones). Before you present the card, read each dimension value created against its '
  + '`dimension_values`, and any value against its `candidates`: when one is the same thing (a translation, a synonym, a spelling, '
  + 'a shorter or longer form of the same name (`Dell` for `Dell Technologies`)), '
  + 'call again with that column\'s `values` naming it: for a dimension, a value of its `dimension_values`; for a supplier, '
  + 'a supplier of the workspace you recognise as the same, listed or not. The check refuses a target that does not exist. '
  + `Each list holds its first ${MODEL_MATCHING_ENTRIES} entries: \`totals\`, when present, `
  + 'gives the length of every list. choices: the person\'s choices on the card, kept by a new card of the same file.';

/**
 * The check's matching, for the model: on the person's lines, the first entries of each list. A
 * dimension value to create carries its dimension's enabled values (`dimensionValues`, by column), the
 * ones the template lists: a translation is no near name. A supplier keeps its near names only.
 */
function modelMatching(
  matching: BudgetFileMatching,
  lines: readonly number[],
  dimensionValues?: ReadonlyMap<string, readonly string[]>,
): NonNullable<AiImportRunDto['matching']> {
  const fileLines = (entry: { lines: number[] }) => entry.lines.map((line) => personLine(line, lines));
  const totals = matching.totals;
  const cut = Math.max(totals.matches, totals.refusedProposals, totals.candidates) > MODEL_MATCHING_ENTRIES;
  return {
    matches: matching.matches.slice(0, MODEL_MATCHING_ENTRIES).map((entry) => ({
      column: entry.column, ...(entry.name ? { dimension: entry.name } : {}), value: entry.value, target: entry.target,
      origin: entry.origin, count: entry.count, file_lines: fileLines(entry),
    })),
    refused_proposals: matching.refusedProposals.slice(0, MODEL_MATCHING_ENTRIES).map((entry) => ({
      column: entry.column, ...(entry.name ? { dimension: entry.name } : {}), value: entry.value, target: entry.target,
      reason: entry.reason, count: entry.count, file_lines: fileLines(entry),
    })),
    candidates: matching.candidates.slice(0, MODEL_MATCHING_ENTRIES).map((entry) => ({
      column: entry.column, ...(entry.name ? { dimension: entry.name } : {}), value: entry.value, outcome: entry.outcome,
      count: entry.count, file_lines: fileLines(entry), candidates: entry.candidates,
      ...(entry.outcome === 'create' && entry.column.startsWith('analytics:') && dimensionValues?.has(entry.column)
        ? { dimension_values: [...dimensionValues.get(entry.column)!] }
        : {}),
    })),
    // On the person's lines, as the card sends them: the next card keeps them without drift.
    choices: personLineChoices(matching.choices, lines),
    create_suppliers: matching.createSuppliers,
    ...(cut ? { totals: { matches: totals.matches, refused_proposals: totals.refusedProposals, candidates: totals.candidates } } : {}),
    note: MATCHING_NOTE,
  };
}

/** Names listed in the facts of the approval, per kind; the others are counted. */
const APPROVAL_FACT_NAMES = 20;

function listed(names: string[], total: number): string {
  if (total === 0) return '';
  const shown = names.slice(0, APPROVAL_FACT_NAMES);
  const more = total - shown.length;
  return `: ${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
}

/** A count of lines with its split by nature, `5 OPEX, 3 CAPEX`; a nature at zero is not written, a total at zero has none. */
function byNature(total: number, counts: Record<BudgetNature, number> | undefined): string {
  if (total === 0 || !counts) return '';
  const parts = (['opex', 'capex'] as const).filter((nature) => counts[nature] > 0)
    .map((nature) => `${counts[nature]} ${nature.toUpperCase()}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * What the approval of a budget file's check does, in one sentence, from the check itself: the lines,
 * the stored values its `-` cells clear (lot I6 of 26.11.9, when there are some), the suppliers and
 * dimension values it creates (named), and the values of the file it matched to existing ones. The model announces this and nothing else (a small model does not count from the lists).
 */
export function approvalFacts(answer: BudgetFileAnswer, matching: BudgetFileMatching): string {
  if (answer.ok !== true) return CANNOT_BE_APPROVED;
  const created = matching.candidates.filter((entry) => entry.outcome === 'create');
  const suppliers = answer.creates?.supplierCount ?? 0;
  const values = answer.creates?.dimensionValueCount ?? 0;
  const supplierNames = created.filter((entry) => entry.column === 'supplier_name').map((entry) => entry.value);
  const valueNames = created.filter((entry) => entry.column.startsWith('analytics:'))
    .map((entry) => (entry.name ? `${entry.value} (${entry.name})` : entry.value));
  const matchNames = matching.matches.map((entry) => `${entry.value} → ${entry.target}`);
  const changes = answer.changes ?? { created: 0, updated: 0, unchanged: 0 };
  // The lines by nature, from the check: the model never counts them in the file.
  const split = changes.byNature;
  // The rows that look like a stored line: left out unless the person chose otherwise (lot I2 of 26.11.9).
  const look = answer.lookalikes;
  const lookalikes = look && look.count > 0
    ? `; ${look.count} rows of the file look like existing lines: ${look.ignored} left out, ${look.created} created anyway, `
      + `${look.updated} updating the line they look like`
    : '';
  if (nothingToImport({ ok: true, inserted: changes.created, updated: changes.updated, newSuppliers: suppliers, newDimensionValues: values })) {
    return `Nothing to import: the approval would create and update nothing${unchangedNote(changes.unchanged, 'lines')}${lookalikes}. `
      + (look && look.ignored > 0
        ? 'Say in one sentence that nothing is imported until a row left out is created anyway or updates the line it looks like, '
          + 'with the card\'s words (`similar_lines.card_choices`).'
        : 'The card cannot be approved.');
  }
  return `On approval: ${changes.created} lines created${byNature(changes.created, split?.created)}, `
    + `${changes.updated} updated${byNature(changes.updated, split?.updated)}${clearedNote(changes.cleared ?? 0)}; `
    + `${suppliers} suppliers created${listed(supplierNames, suppliers)}; `
    + `${values} dimension values created${listed(valueNames, values)}; `
    + `${matching.totals.matches} values of the file matched to existing ones${listed(matchNames, matching.totals.matches)}`
    + `${lookalikes}.`;
}

/**
 * The bilan of the budget file: its check as its dialog shows it, or the counts of its load.
 * `dimensionValues`: the enabled values of each dimension, by column, for the dimension values the check creates.
 * `language`: the person's, for the card's words the model reads.
 */
export function budgetBilan(
  answer: BudgetFileAnswer,
  dryRun: boolean,
  lines: readonly number[],
  dimensionValues?: ReadonlyMap<string, readonly string[]>,
  language: CsvLanguage = 'en',
): AiImportRunDto {
  const issues: AiImportRunDto['issues'] = [];
  const fileErrors = (answer.fileErrors?.length ?? 0) + (answer.headerErrors?.length ?? 0);
  if (fileErrors > 0) issues.push({ level: 'error', code: null, column: null, count: fileErrors });
  // The code of each error, as the card translates it: the model reads it with its column and the
  // line the card shows.
  for (const error of answer.errors ?? []) tally(issues, 'error', error.code ?? null, error.column ?? null, personLine(error.line, lines));
  for (const missing of answer.missing ?? []) {
    issues.push({ level: 'error', code: `missing_${missing.type}`, column: null, count: missing.count });
  }
  const errorCount = fileErrors
    + (answer.errorCount ?? answer.errors?.length ?? 0)
    + (answer.missing ?? []).reduce((sum, missing) => sum + missing.count, 0);
  const warningCount = Object.values(answer.warnings ?? {})
    .reduce<number>((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  // The snapshot is the load's own check of the lines the file names: not a part of the report.
  const shown: Record<string, unknown> = { ...answer };
  delete shown.snapshot;
  const isCheck = answer.changes !== undefined;
  const similar = isCheck ? similarLines(answer, lines, language) : undefined;
  const nothing = isCheck && nothingToImport({
    ok: answer.ok === true,
    inserted: answer.changes!.created,
    updated: answer.changes!.updated,
    newSuppliers: answer.creates?.supplierCount,
    newDimensionValues: answer.creates?.dimensionValueCount,
  });
  return {
    ...(isCheck && answer.matching ? { on_approval: approvalFacts(answer, answer.matching) } : {}),
    ok: answer.ok === true,
    ...(nothing ? { nothing_to_import: true as const } : {}),
    dry_run: dryRun,
    total: lines.length,
    inserted: isCheck ? answer.changes!.created : answer.inserted ?? 0,
    updated: isCheck ? answer.changes!.updated : answer.updated ?? 0,
    unchanged: isCheck ? answer.changes!.unchanged : 0,
    // The stored values the `-` cells clear, as the check counts them; the load repeats its check's count.
    cleared: isCheck ? answer.changes!.cleared ?? 0 : answer.cleared ?? 0,
    // The rows left out because they look like a stored line.
    skipped: isCheck ? answer.lookalikes?.ignored ?? 0 : answer.skipped ?? 0,
    error_count: errorCount,
    warning_count: warningCount,
    issues,
    new_suppliers: answer.creates?.supplierCount ?? 0,
    ...(isCheck && answer.creates?.dimensionValueCount !== undefined ? { new_dimension_values: answer.creates.dimensionValueCount } : {}),
    ...(similar ? { similar_lines: similar } : {}),
    ...(isCheck && answer.matching ? { matching: modelMatching(answer.matching, lines, dimensionValues) } : {}),
    report: { kind: 'budget_file', file: isCheck ? relined(shown, lines) as Record<string, unknown> : null },
  };
}
