import { EntityManager } from 'typeorm';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { BudgetFileService } from '../budget-file/budget-file.service';
import { BudgetFileAudit, BudgetFileImportResult, BudgetFileItems, BudgetFileLineServices } from '../budget-file/import-file';
import { BudgetFileReport } from '../budget-file/types';
import type { BudgetNature } from '../budget-nature';
import { itemService } from './cost-center.fixtures';
import { captureAudit, Kind, noFreeze } from './round-inputs.fixtures';

// Shared fixtures of the specs that load a budget file (not a spec itself):
// the service with its currency settings stubbed (no allowed-currency list),
// a preflight, and the load of a file after its own preflight. Everything runs
// in the caller's transaction (`manager`), with its tenant already set.

export const BUDGET_FILE_OPTIONS = { language: 'en', dateOrder: '', createSuppliers: false, canCreateSuppliers: false };

export function budgetFileService(): BudgetFileService {
  return new BudgetFileService({ getSettings: async () => ({ allowedCurrencies: null }) } as unknown as CurrencySettingsService);
}

/** `natures`: the natures the caller may import (both Admin levels for a mixed file); the route's alone when absent. */
function caller(manager: EntityManager, tenantId: string, natures?: readonly BudgetNature[]) {
  return { manager, tenantId, userId: null, ...(natures ? { natures } : {}) };
}

/** The item service of each nature; `items`, when given, stands for the one of `kind`. */
export function lineServices(kind: Kind, audit: BudgetFileAudit, items?: BudgetFileItems): BudgetFileLineServices {
  return {
    opex: kind === 'opex' && items ? items : itemService('opex', audit),
    capex: kind === 'capex' && items ? items : itemService('capex', audit),
  };
}

/** One line per problem of a report that is not ok, for an assertion message. */
export function reportProblems(report: BudgetFileReport): string {
  return JSON.stringify({
    fileErrors: report.fileErrors,
    headerErrors: report.headerErrors,
    errors: report.errors,
    deleted: report.deleted,
  });
}

/** The preflight of a file: a read, no lock, no write. */
export async function preflightBudgetFile(
  manager: EntityManager,
  kind: Kind,
  tenantId: string,
  csv: string,
  natures?: readonly BudgetNature[],
): Promise<BudgetFileReport> {
  return budgetFileService().preflight(kind, Buffer.from(csv, 'utf8'), caller(manager, tenantId, natures), BUDGET_FILE_OPTIONS);
}

/**
 * The preflight, then the load with that preflight's snapshot, through the
 * item service of each nature (`itemService`; `items` stands for the one of
 * `kind` when given). A preflight that is not ok throws with its problems. The
 * load's own result is returned as it is (a report when the file is refused at
 * the load). `natures`: the natures the caller may import (the route's alone
 * when absent).
 */
export async function loadBudgetFile(
  manager: EntityManager,
  kind: Kind,
  tenantId: string,
  csv: string,
  audit: BudgetFileAudit = captureAudit() as unknown as BudgetFileAudit,
  items?: BudgetFileItems,
  natures?: readonly BudgetNature[],
): Promise<BudgetFileImportResult> {
  const report = await preflightBudgetFile(manager, kind, tenantId, csv, natures);
  if (!report.ok) throw new Error(`the ${kind} budget file preflight is not ok: ${reportProblems(report)}`);
  return budgetFileService().importFile(kind, Buffer.from(csv, 'utf8'), report.snapshot, caller(manager, tenantId, natures), BUDGET_FILE_OPTIONS, {
    items: lineServices(kind, audit, items),
    audit,
    freeze: noFreeze,
  });
}

/**
 * An English export with one column's cell set on every row (`row` picks the
 * rows by their cells). The specs' cells hold no comma or quote.
 */
export function withCell(content: string, column: string, value: string, row: (cells: Record<string, string>) => boolean = () => true): string {
  const [header, ...rows] = content.replace(/^﻿/, '').trim().split('\n');
  const columns = header.split(',');
  const index = columns.indexOf(column);
  if (index < 0) throw new Error(`the file has no column ${column}: ${header}`);
  const edited = rows.map((line) => {
    const cells = line.split(',');
    if (!row(Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? ''])))) return line;
    cells[index] = value;
    return cells.join(',');
  });
  return `${[header, ...edited].join('\n')}\n`;
}

/** The cells of an English export, one record per row. */
export function fileRows(content: string): Array<Record<string, string>> {
  const [header, ...rows] = content.replace(/^﻿/, '').trim().split('\n');
  const columns = header.split(',');
  return rows.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? '']));
  });
}

/** The budget file of the given lines (English, yearly Budget of `year` unless said otherwise). */
export async function exportBudgetFile(
  manager: EntityManager,
  kind: Kind,
  tenantId: string,
  ids: readonly string[],
  options: { amountYears?: string; columns?: string; detail?: 'yearly' | 'months' } = {},
): Promise<string> {
  const exported = await budgetFileService().exportFile(kind, ids, caller(manager, tenantId), {
    language: 'en',
    amountYears: options.amountYears ?? String(new Date().getFullYear()),
    columns: options.columns ?? 'budget',
    detail: options.detail ?? 'yearly',
  });
  return exported.content;
}
