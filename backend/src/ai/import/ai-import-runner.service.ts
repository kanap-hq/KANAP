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
import type { BudgetFileMatching, BudgetFileMatchOptions, BudgetFileNatureCounts } from '../../spend/budget-file/types';
import type { BudgetNature } from '../../spend/budget-nature';
import { CapexItemsService, SpendItemsService } from '../../spend/spend-items.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { TasksCsvService } from '../../tasks/tasks-csv.service';
import { TechnologyLinksCsvService } from '../../technologies/technology-links-csv.service';
import { WorkingDayProfilesCsvService } from '../../working-day-profiles/working-day-profiles-csv.service';
import { AiPolicyService } from '../ai-policy.service';
import type { AiExecutionContextWithManager, AiImportReportMessage, AiImportRunDto } from '../ai.types';
import type { AiImportKey } from './ai-import-access';
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
  skipped?: number;
  errors?: AiImportReportMessage[];
  warnings?: AiImportReportMessage[];
};

/** The budget file's report (`BudgetFileReport`) or its load (`BudgetFileImportOk`), as far as the bilan reads it. */
type BudgetFileAnswer = {
  ok: boolean;
  inserted?: number;
  updated?: number;
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
  changes?: { created: number; updated: number; unchanged: number; byNature?: BudgetFileNatureCounts };
  warnings?: Record<string, unknown>;
};

/** How an import is called: the file built in its template's format, the check or the load, the person's language. */
type ImportCall = {
  file: Express.Multer.File;
  dryRun: boolean;
  language: CsvLanguage;
  context: AiExecutionContextWithManager;
  /** The budget file: the person's choices on the card and the model's proposals. */
  matching?: BudgetFileMatchOptions;
};

/**
 * The imports of the screens, called as their routes call them (lot I3 of the Plaid import): the same
 * services, the same options (the screen's "merge" mode, the person's language, the decimal point the
 * file is written with), in the transaction of the person's call, which carries their data access.
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
    options: { dryRun: boolean; language: CsvLanguage; lines: readonly number[]; matching?: BudgetFileMatchOptions },
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
    const call: ImportCall = { file, dryRun: options.dryRun, language: options.language, context, matching: options.matching };
    if (key === 'budget_lines') {
      const answer = await this.runBudgetFile(call);
      // A dimension value the check would create comes with its dimension's values, for the model to read.
      const createsValues = answer.matching?.candidates.some((entry) => entry.outcome === 'create' && entry.column.startsWith('analytics:'));
      const values = options.dryRun && createsValues ? await enabledDimensionValues(context) : undefined;
      return budgetBilan(answer, options.dryRun, options.lines, values);
    }
    return rowsBilan(await this.runRows(key, call), options.dryRun, options.lines);
  }

  private async runRows(key: Exclude<AiImportKey, 'budget_lines'>, { file, dryRun, language, context }: ImportCall): Promise<RowsReport> {
    const manager = context.manager as EntityManager;
    const { tenantId, userId } = context;
    // The file holds numbers as number cells and days as date cells, written with a decimal point.
    const read = { language, decimalMark: '.' as const };
    // The screen's recommended preset: add the new records, update the matched ones, keep what a blank cell does not say.
    const merge = { dryRun, mode: 'enrich' as const, operation: 'upsert' as const };
    const caller = { manager, tenantId, userId: userId || null };
    switch (key) {
      case 'applications':
        return this.applications.import(file, merge, { manager, tenantId, userId, language });
      case 'assets':
        return this.assets.import(file, merge, { manager, tenantId, userId, language });
      case 'portfolio_projects':
        return this.projects.import(file, merge, { manager, tenantId, userId, language });
      case 'portfolio_requests':
        return this.requests.import(file, merge, { manager, tenantId, userId });
      case 'tasks':
        return this.tasks.import(file, merge, { manager, tenantId, userId, viewer: await this.incidentViewer(context) });
      case 'incidents': {
        const viewer = await this.incidentViewer(context);
        return this.incidents.import(file, merge, { manager, tenantId, userId: userId || null, isAdmin: viewer.isAdmin, viewer, language });
      }
      case 'suppliers':
        return this.suppliers.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager });
      case 'contacts':
        return this.contacts.importCsv({ file, dryRun, ...read }, { manager, tenantId });
      case 'contracts':
        return this.contracts.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager });
      case 'companies':
        return this.companies.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager });
      case 'departments':
        return this.departments.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager });
      case 'cost_centers':
        return this.costCenters.importCsv({ file, dryRun, ...read }, caller);
      case 'accounts':
        // The chart of each row is named by its `coa_code` column, as the import of the accounts page.
        return this.accounts.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager, allowCoaCodeColumn: true });
      case 'analytics_categories':
        return this.analytics.importCsv({ file, dryRun, ...read }, caller);
      case 'business_processes':
        return this.businessProcesses.importCsv({ file, dryRun, userId: userId || null, ...read }, { manager });
      case 'working_day_calendars':
        return this.calendars.importCsv({ file, dryRun, ...read }, caller);
      case 'technology_asset_links':
        return this.technologyLinks.importAssetLinks({ file, dryRun, language }, caller);
      case 'technology_application_links': {
        // The applications the person reads: all of them, or a Business Contributor's own, as the route.
        const access = await this.policy.effectiveAccess(context, manager);
        const scope = await resolveBusinessContributorScopeForUser({ manager, userId, tenantId, isAdmin: access.isAdmin }, 'applications', 'reader');
        return this.technologyLinks.importApplicationLinks({ file, dryRun, language }, caller, { scope });
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
    const options = {
      language,
      dateOrder: undefined,
      decimalMark: 'dot',
      createSuppliers: createSuppliersChoice(matching?.choices ?? []) ?? true,
      canCreateSuppliers: canCreateSuppliers(access),
      ...readableLists(access),
      matching,
    };
    const preflight = await this.budgetFile.preflight('opex', file.buffer, caller, options);
    if (dryRun || !preflight.ok) return preflight;
    return this.budgetFile.importFile('opex', file.buffer, preflight.snapshot, caller, options, {
      items: { opex: this.opexItems, capex: this.capexItems },
      audit: this.audit,
      freeze: this.freeze,
    });
  }

  private async incidentViewer(context: AiExecutionContextWithManager) {
    const access = await this.policy.effectiveAccess(context, context.manager as EntityManager);
    return incidentViewerFromContext({ userId: context.userId, ...access });
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
  return {
    row: personLine(item.row, lines),
    ...(item.column ? { column: item.column } : {}),
    message: item.message,
    ...(item.code ? { code: item.code } : {}),
    ...(item.params ? { params: item.params } : {}),
  };
}

/** The bilan of a row import: its counts, its messages on the person's lines, and their tally for the model. */
export function rowsBilan(result: RowsReport, dryRun: boolean, lines: readonly number[]): AiImportRunDto {
  const errors = result.errors ?? [];
  const warnings = result.warnings ?? [];
  const issues: AiImportRunDto['issues'] = [];
  for (const error of errors) tally(issues, 'error', error.code ?? null, error.column ?? null, personLine(error.row, lines));
  for (const warning of warnings) tally(issues, 'warning', warning.code ?? null, warning.column ?? null, personLine(warning.row, lines));
  return {
    ok: result.ok === true && errors.length === 0,
    dry_run: dryRun,
    total: result.total ?? result.processed ?? lines.length,
    inserted: result.inserted ?? 0,
    updated: result.updated ?? 0,
    unchanged: result.unchanged ?? 0,
    skipped: result.skipped ?? 0,
    error_count: errors.length,
    warning_count: warnings.length,
    issues,
    report: {
      kind: 'rows',
      errors: errors.slice(0, KEPT_ERRORS).map((error) => message(error, lines)),
      warnings: warnings.slice(0, KEPT_WARNINGS).map((warning) => message(warning, lines)),
    },
  };
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
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    key,
    key === 'line' && typeof item === 'number'
      ? personLine(item, lines)
      : key === 'lines' && Array.isArray(item) && item.every((entry) => typeof entry === 'number')
        ? (item as number[]).map((entry) => personLine(entry, lines))
      : earlierRow && key === 'params' && item && typeof item === 'object'
        ? relinedRow(relined(item, lines) as Record<string, unknown>, lines)
        : relined(item, lines),
  ]));
}

function relinedRow(params: Record<string, unknown>, lines: readonly number[]): Record<string, unknown> {
  return typeof params.row === 'number' ? { ...params, row: personLine(params.row, lines) } : params;
}

const LOOKS_LIKE_LINE = 'BUDGET_FILE_LOOKS_LIKE_LINE';
const LOOKS_LIKE_ROW = 'BUDGET_FILE_LOOKS_LIKE_ROW';

/** The lookalikes the model reads: the first ones, as the card lists them at once. */
const MODEL_LOOKALIKES = 10;

const SIMILAR_LINES_NOTE = 'New rows of the file that look like a budget line the person can read, or an earlier row of '
  + 'the file: the import would create them as new lines. Tell the person in one sentence before they approve '
  + '(file line and reference); the card lists them.';

type Lookalike = { line?: number; code?: string; params?: Record<string, unknown> };

/** The budget file's lookalikes for the model: their number and the first ones, on the person's lines. */
function similarLines(warnings: Record<string, unknown> | undefined, lines: readonly number[]): AiImportRunDto['similar_lines'] {
  const found = Array.isArray(warnings?.duplicates) ? warnings!.duplicates as Lookalike[] : [];
  if (found.length === 0) return undefined;
  const total = typeof warnings?.duplicatesCount === 'number' ? Math.max(warnings.duplicatesCount, found.length) : found.length;
  type Similar = NonNullable<AiImportRunDto['similar_lines']>['first'][number];
  const first = found.slice(0, MODEL_LOOKALIKES).flatMap((item): Similar[] => {
    const line = typeof item.line === 'number' ? personLine(item.line, lines) : 0;
    if (line <= 0) return [];
    if (item.code === LOOKS_LIKE_LINE && typeof item.params?.ref === 'string') return [{ file_line: line, looks_like: item.params.ref }];
    if (item.code === LOOKS_LIKE_ROW && typeof item.params?.row === 'number') {
      return [{ file_line: line, looks_like_file_line: personLine(item.params.row, lines) }];
    }
    return [];
  });
  return { count: total, first, note: SIMILAR_LINES_NOTE };
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
    choices: matching.choices,
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
 * the suppliers and dimension values it creates (named), and the values of the file it matched to
 * existing ones. The model announces this and nothing else (a small model does not count from the lists).
 */
export function approvalFacts(answer: BudgetFileAnswer, matching: BudgetFileMatching): string {
  if (answer.ok !== true) {
    return 'This card cannot be approved: the check found errors (issues). Nothing is created or imported until they are corrected.';
  }
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
  return `On approval: ${changes.created} lines created${byNature(changes.created, split?.created)}, `
    + `${changes.updated} updated${byNature(changes.updated, split?.updated)}; `
    + `${suppliers} suppliers created${listed(supplierNames, suppliers)}; `
    + `${values} dimension values created${listed(valueNames, values)}; `
    + `${matching.totals.matches} values of the file matched to existing ones${listed(matchNames, matching.totals.matches)}.`;
}

/**
 * The bilan of the budget file: its check as its dialog shows it, or the counts of its load.
 * `dimensionValues`: the enabled values of each dimension, by column, for the dimension values the check creates.
 */
export function budgetBilan(
  answer: BudgetFileAnswer,
  dryRun: boolean,
  lines: readonly number[],
  dimensionValues?: ReadonlyMap<string, readonly string[]>,
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
  const similar = isCheck ? similarLines(answer.warnings, lines) : undefined;
  return {
    ...(isCheck && answer.matching ? { on_approval: approvalFacts(answer, answer.matching) } : {}),
    ok: answer.ok === true,
    dry_run: dryRun,
    total: lines.length,
    inserted: isCheck ? answer.changes!.created : answer.inserted ?? 0,
    updated: isCheck ? answer.changes!.updated : answer.updated ?? 0,
    unchanged: isCheck ? answer.changes!.unchanged : 0,
    skipped: 0,
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
