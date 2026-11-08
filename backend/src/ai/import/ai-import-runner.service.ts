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
import { BudgetFileService, canCreateSuppliers } from '../../spend/budget-file/budget-file.service';
import { CapexItemsService, SpendItemsService } from '../../spend/spend-items.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { TasksCsvService } from '../../tasks/tasks-csv.service';
import { TechnologyLinksCsvService } from '../../technologies/technology-links-csv.service';
import { WorkingDayProfilesCsvService } from '../../working-day-profiles/working-day-profiles-csv.service';
import { AiPolicyService } from '../ai-policy.service';
import type { AiExecutionContextWithManager, AiImportReportMessage, AiImportRunDto } from '../ai.types';
import type { AiImportKey } from './ai-import-access';
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
  errors?: Array<{ line: number; column: string | null; message: string }>;
  errorCount?: number;
  missing?: Array<{ type: string; count: number }>;
  deletedCount?: number;
  supplierMessage?: string | null;
  changes?: { created: number; updated: number; unchanged: number };
  warnings?: Record<string, unknown>;
};

/** How an import is called: the file built in its template's format, the check or the load, the person's language. */
type ImportCall = { file: Express.Multer.File; dryRun: boolean; language: CsvLanguage; context: AiExecutionContextWithManager };

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
    options: { dryRun: boolean; language: CsvLanguage; lines: readonly number[] },
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
    const call: ImportCall = { file, dryRun: options.dryRun, language: options.language, context };
    if (key === 'budget_lines') {
      return budgetBilan(await this.runBudgetFile(call), options.dryRun, options.lines);
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
   * Missing suppliers are not created: the check names them.
   */
  private async runBudgetFile({ file, dryRun, language, context }: ImportCall): Promise<BudgetFileAnswer> {
    const manager = context.manager as EntityManager;
    const caller = { manager, tenantId: context.tenantId, userId: context.userId || null };
    const access = await this.policy.effectiveAccess(context, manager);
    // The route's switches, as the dialog sends them: the file is written with a decimal point.
    const options = {
      language,
      dateOrder: undefined,
      decimalMark: 'dot',
      createSuppliers: false,
      canCreateSuppliers: canCreateSuppliers(access),
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

function tally(issues: AiImportRunDto['issues'], level: 'error' | 'warning', code: string | null, column: string | null): void {
  const found = issues.find((issue) => issue.level === level && issue.code === code && issue.column === column);
  if (found) found.count += 1;
  else issues.push({ level, code, column, count: 1 });
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
  for (const error of errors) tally(issues, 'error', error.code ?? null, error.column ?? null);
  for (const warning of warnings) tally(issues, 'warning', warning.code ?? null, warning.column ?? null);
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

/** A copy of the budget file's report whose `line` fields are the lines of the person's file. */
function relined(value: unknown, lines: readonly number[]): unknown {
  if (Array.isArray(value)) return value.map((item) => relined(item, lines));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    key === 'line' && typeof item === 'number' ? personLine(item, lines) : relined(item, lines),
  ]));
}

/** The bilan of the budget file: its check as its dialog shows it, or the counts of its load. */
export function budgetBilan(answer: BudgetFileAnswer, dryRun: boolean, lines: readonly number[]): AiImportRunDto {
  const issues: AiImportRunDto['issues'] = [];
  const fileErrors = (answer.fileErrors?.length ?? 0) + (answer.headerErrors?.length ?? 0);
  if (fileErrors > 0) issues.push({ level: 'error', code: null, column: null, count: fileErrors });
  for (const error of answer.errors ?? []) tally(issues, 'error', null, error.column ?? null);
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
  return {
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
    report: { kind: 'budget_file', file: isCheck ? relined(shown, lines) as Record<string, unknown> : null },
  };
}
