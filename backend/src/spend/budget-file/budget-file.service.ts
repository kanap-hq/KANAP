import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { csvLanguage, CsvDateOrder, CsvLanguage, writeCsv } from '../../common/csv-sheet';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { readBudgetColumns } from '../../budget-columns/budget-columns.util';
import { readBudgetLineMeta } from '../item-meta';
import { buildBudgetExport, fileNameOfExport, parseAmountYears, parseDetail, parseFileColumns, shownFileColumns } from './export-file';
import { importBudgetFile, BudgetFileAudit, BudgetFileFreeze, BudgetFileImportResult, BudgetFileItems, parseBudgetSnapshot } from './import-file';
import { interpretBudgetFile, readBudgetCsv } from './interpret';
import { loadDimensionCodes, loadExportLines, loadPreflight } from './load';
import { buildPreflight, changedSinceText } from './preflight';
import { BudgetFileReport, BudgetFileScope, emptyCatalog } from './types';

const LEVEL_RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

/** Creating a supplier is the suppliers member level, the same as POST /suppliers. */
export function canCreateSuppliers(ctx: { isAdmin?: boolean; permissions?: Record<string, string> } | null | undefined): boolean {
  if (ctx?.isAdmin) return true;
  return (LEVEL_RANK[ctx?.permissions?.suppliers ?? ''] ?? 0) >= LEVEL_RANK.member;
}

export interface BudgetFileCaller {
  manager: EntityManager;
  tenantId: string;
  userId: string | null;
}

/**
 * The budget file: read, match, preflight, export, and the load.
 * The import route calls `analyzeAfterLargeImport` last and does not query
 * after that call. Contract: planning/sfr/briefs/csv-c2.md.
 */
@Injectable()
export class BudgetFileService {
  constructor(private readonly currencySettings: CurrencySettingsService) {}

  async preflight(
    scope: BudgetFileScope,
    file: Buffer,
    caller: BudgetFileCaller,
    options: { language: unknown; dateOrder: unknown; createSuppliers: boolean; canCreateSuppliers: boolean },
  ): Promise<BudgetFileReport> {
    const manager = requireManager(caller.manager);
    const language = await languageOf(manager, caller.tenantId, caller.userId, options.language);
    const dateOrder = parseDateOrder(options.dateOrder);
    const dimensionCodes = await loadDimensionCodes(manager, caller.tenantId);
    const read = await readBudgetCsv(file, { scope, language, dimensionCodes, dateOrder });
    const currentYear = new Date().getFullYear();
    if (read.fileErrors.length > 0 || read.headerErrors.length > 0) {
      return buildPreflight({
        scope, read, catalog: emptyCatalog(),
        stored: [], names: [], createSuppliers: false, canCreateSuppliers: false, currentYear, labels: {},
      });
    }
    const numbers = interpretBudgetFile(scope, read).flatMap((row) => row.itemNumber.kind === 'number' ? [row.itemNumber.n] : []);
    const settings = await this.currencySettings.getSettings(caller.tenantId, { manager });
    const loaded = await loadPreflight(manager, scope, caller.tenantId, numbers, settings.allowedCurrencies);
    const report = buildPreflight({
      scope,
      read,
      catalog: loaded.catalog,
      stored: loaded.stored,
      names: loaded.names,
      createSuppliers: options.createSuppliers,
      canCreateSuppliers: options.canCreateSuppliers,
      currentYear,
      labels: loaded.labels,
    });
    await nameChanges(manager, scope, caller.tenantId, report);
    return report;
  }

  async exportFile(
    scope: BudgetFileScope,
    ids: readonly string[],
    caller: BudgetFileCaller,
    options: { language: unknown; amountYears: unknown; columns: unknown; detail: unknown },
  ): Promise<{ filename: string; content: string }> {
    const manager = requireManager(caller.manager);
    const language = await languageOf(manager, caller.tenantId, caller.userId, options.language);
    const currentYear = new Date().getFullYear();
    const settings = await readBudgetColumns(manager, caller.tenantId);
    const columns = parseFileColumns(options.columns, shownFileColumns(settings.enabled));
    const years = parseAmountYears(options.amountYears, currentYear);
    const detail = parseDetail(options.detail);
    const loaded = await loadExportLines(manager, scope, caller.tenantId, ids);
    const built = buildBudgetExport({
      scope, language, years, columns, detail, lines: loaded.lines, dimensionCodes: loaded.dimensionCodes,
    });
    return { filename: fileNameOfExport(scope), content: writeCsv({ language, headers: built.headers, rows: built.rows }) };
  }

  /**
   * The load. `deps` are the item service of this list, the audit log and the
   * freeze check. The caller runs `analyzeAfterLargeImport` on the result and
   * does not query after that.
   */
  async importFile(
    scope: BudgetFileScope,
    file: Buffer,
    snapshot: unknown,
    caller: BudgetFileCaller,
    options: { language: unknown; dateOrder: unknown; createSuppliers: boolean; canCreateSuppliers: boolean },
    deps: { items: BudgetFileItems; audit: BudgetFileAudit; freeze: BudgetFileFreeze },
  ): Promise<BudgetFileImportResult> {
    const manager = requireManager(caller.manager);
    const language = await languageOf(manager, caller.tenantId, caller.userId, options.language);
    const dateOrder = parseDateOrder(options.dateOrder);
    const settings = await this.currencySettings.getSettings(caller.tenantId, { manager });
    return importBudgetFile({
      scope,
      file,
      snapshot: parseBudgetSnapshot(snapshot),
      manager,
      tenantId: caller.tenantId,
      userId: caller.userId,
      language,
      dateOrder,
      createSuppliers: options.createSuppliers,
      canCreateSuppliers: options.canCreateSuppliers,
      allowedCurrencies: settings.allowedCurrencies,
      items: deps.items,
      audit: deps.audit,
      freeze: deps.freeze,
    });
  }
}

async function nameChanges(manager: EntityManager, scope: BudgetFileScope, tenantId: string, report: BudgetFileReport): Promise<void> {
  for (const entry of report.changedSinceExport) {
    const meta = await readBudgetLineMeta(manager, scope, tenantId, entry.id);
    if (!meta) continue;
    const candidates: Array<{ by: string | null; at: string | null }> = [];
    if (entry.rowMismatch) candidates.push(person(meta.changed_by, meta.changed_at));
    for (const year of entry.years) {
      const version = meta.versions.find((item) => item.budget_year === year);
      candidates.push(version ? person(version.changed_by, version.changed_at) : { by: null, at: null });
    }
    let best = { by: null as string | null, at: null as string | null };
    for (const candidate of candidates) {
      if (candidate.at && (!best.at || candidate.at > best.at)) best = candidate;
    }
    if (!best.at) {
      const named = candidates.find((candidate) => candidate.by);
      if (named) best = named;
    }
    entry.by = best.by;
    entry.at = best.at;
    entry.message = changedSinceText(entry.itemNumber, best.by, best.at);
  }
}

function person(author: { name: string | null } | null, at: string | null): { by: string | null; at: string | null } {
  return { by: author?.name || null, at };
}

export async function languageOf(
  manager: EntityManager,
  tenantId: string,
  userId: string | null,
  requested: unknown,
): Promise<CsvLanguage> {
  if (requested != null && requested !== '') {
    if (requested !== 'en' && requested !== 'fr' && requested !== 'de' && requested !== 'es') {
      throw new BadRequestException('language must be en, fr, de or es.');
    }
    return requested;
  }
  if (!userId) return 'en';
  const rows: Array<{ locale: string | null }> = await manager.query(
    `SELECT locale FROM users WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId],
  );
  return csvLanguage(rows[0]?.locale);
}

export function parseDateOrder(raw: unknown): CsvDateOrder | undefined {
  if (raw == null || raw === '') return undefined;
  if (raw === 'day-first' || raw === 'month-first') return raw;
  throw new BadRequestException('dateOrder must be day-first or month-first.');
}

function requireManager(manager: EntityManager | undefined): EntityManager {
  if (!manager) throw new InternalServerErrorException('The budget file needs the request transaction.');
  return manager;
}
