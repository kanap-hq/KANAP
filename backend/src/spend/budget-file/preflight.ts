import { CsvReadResult } from '../../common/csv-sheet';
import { matchCode } from '../../common/csv-sheet';
import { normalizeAnalyticsName } from '../../analytics/analytics-context';
import { AmountMeasure, MEASURE_FREEZE_COLUMN } from '../amounts-write.util';
import { endOfValidityFromDate, isActiveAt } from '../../common/status';
import { firstAmountYear, interpretBudgetFile, InterpretedRow, FieldCell } from './interpret';
import { tokenError } from './token';
import {
  BudgetCatalog,
  BudgetFileAmountChange,
  BudgetFileAnalyticsChange,
  BudgetFileLinePlan,
  BudgetFileReport,
  BudgetFileScope,
  BudgetFileSnapshotLine,
  CatalogCostCenter,
  CatalogSupplier,
  CatalogUser,
  LineHint,
  MISSING_EXAMPLE_LIMIT,
  PREFLIGHT_ERROR_LIMIT,
  PREFLIGHT_LIST_LIMIT,
  StoredLine,
  StoredVersion,
  emptyCatalog,
  lineRef,
} from './types';

const CLEARABLE = new Set([
  'description', 'notes', 'supplier_name', 'supplier_erp_id', 'cost_center_code', 'run_build',
  'owner_it_email', 'owner_business_email', 'project', 'end_of_validity',
]);

const ENUMS: Record<string, readonly string[]> = {
  ppe_type: ['hardware', 'software'],
  investment_type: ['replacement', 'capacity', 'productivity', 'security', 'conformity', 'business_growth', 'other'],
  priority: ['mandatory', 'high', 'medium', 'low'],
  run_build: ['run', 'build'],
};

const CAPEX_REQUIRED = ['ppe_type', 'investment_type', 'priority'];

const MISSING_LABELS: Record<string, { one: string; many: string; where: string }> = {
  companies: { one: 'company', many: 'companies', where: 'Master data > Companies' },
  accounts: { one: 'account', many: 'accounts', where: 'Master data > Accounts' },
  costCenters: { one: 'cost center', many: 'cost centers', where: 'Master data > Cost centers' },
  users: { one: 'user', many: 'users', where: 'Admin > Users' },
  projects: { one: 'project', many: 'projects', where: 'Portfolio > Projects' },
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The write the resolvers record beside the report. Discarded when the row fails. */
interface LineDraft {
  body: Record<string, unknown>;
  analytics: BudgetFileAnalyticsChange[];
  amounts: BudgetFileAmountChange[];
  grains: Map<number, 'annual' | 'monthly'>;
  newSupplier: { name: string; erpId: string | null } | null;
}

function emptyDraft(): LineDraft {
  return { body: {}, analytics: [], amounts: [], grains: new Map(), newSupplier: null };
}

/** A create writes the value; an update writes it only when it differs from the line. */
function writeField(draft: LineDraft, creating: boolean, changed: boolean, key: string, value: unknown): void {
  if (creating || changed) draft.body[key] = value;
}

function nameColumn(scope: BudgetFileScope): 'product_name' | 'description' {
  return scope === 'opex' ? 'product_name' : 'description';
}

export interface PreflightInput {
  scope: BudgetFileScope;
  read: CsvReadResult;
  catalog: BudgetCatalog;
  stored: StoredLine[];
  names: LineHint[];
  createSuppliers: boolean;
  canCreateSuppliers: boolean;
  currentYear: number;
  /** File column name (`budget`) to the tenant's label. */
  labels: Record<string, string>;
}

interface SupplierCreate {
  name: string;
  erpId: string | null;
}

interface Bag {
  errors: Array<{ line: number; column: string | null; message: string }>;
  missing: Map<string, Set<string>>;
  suppliers: Map<string, SupplierCreate>;
  dimensions: Map<string, Map<string, string>>;
  duplicates: Array<{ line: number; message: string }>;
  supplierNames: Array<{ line: number; message: string }>;
  deleted: Array<{ line: number; itemNumber: string }>;
  changed: BudgetFileReport['changedSinceExport'];
  snapshot: BudgetFileSnapshotLine[];
  created: Array<{ line: number; name: string }>;
  updated: Array<{ line: number; itemNumber: string; fields: string[] }>;
  unchanged: number;
  plans: BudgetFileLinePlan[];
}

/** The preflight report. Does not read or write the database. */
export function buildPreflight(input: PreflightInput): BudgetFileReport {
  return planBudgetFile(input).report;
}

/**
 * The report and, for every line it would write, the columns and amounts.
 * The same comparison as the report. Does not read or write the database.
 */
export function planBudgetFile(input: PreflightInput): { report: BudgetFileReport; plans: BudgetFileLinePlan[] } {
  const rows = interpretBudgetFile(input.scope, input.read);
  if (input.read.fileErrors.length > 0 || input.read.headerErrors.length > 0) return { report: refused(input, rows), plans: [] };
  return compared(input, rows);
}

function refused(input: PreflightInput, rows: InterpretedRow[]): BudgetFileReport {
  const errors = rows.flatMap((row) => row.errors.map((error) => ({ line: row.line, column: error.column, message: error.message })));
  return finish(input, errors, emptyBag(), null);
}

function compared(input: PreflightInput, rows: InterpretedRow[]): { report: BudgetFileReport; plans: BudgetFileLinePlan[] } {
  const bag = emptyBag();
  const storedByNumber = new Map(input.stored.map((line) => [line.itemNumber, line]));
  const seen = new Map<number, number>();
  const newKeys = new Map<string, number>();
  for (const row of rows) {
    if (row.itemNumber.kind === 'number') {
      const first = seen.get(row.itemNumber.n);
      if (first !== undefined) {
        bag.errors.push({
          line: row.line,
          column: 'item_number',
          message: `item_number ${lineRef(input.scope, row.itemNumber.n)} already appears on line ${first}.`,
        });
        for (const error of row.errors) bag.errors.push({ line: row.line, column: error.column, message: error.message });
        continue;
      }
      seen.set(row.itemNumber.n, row.line);
    }
    resolveRow(input, row, storedByNumber, newKeys, bag);
  }
  return { report: finish(input, bag.errors, bag, supplierMessage(bag, input)), plans: bag.plans };
}

function resolveRow(
  input: PreflightInput,
  row: InterpretedRow,
  storedByNumber: Map<number, StoredLine>,
  newKeys: Map<string, number>,
  bag: Bag,
): void {
  const errors = [...row.errors];
  const fail = (column: string | null, message: string) => errors.push({ column, message });
  const blocked = (column: string) => errors.some((error) => error.column === column);
  let matched: StoredLine | null = null;
  let creating = false;

  if (row.itemNumber.kind === 'blank') {
    creating = true;
    if (row.token.kind === 'ok' || row.token.kind === 'bad') {
      fail('kanap_token', `kanap_token '${row.token.raw}' is set but item_number is empty. Leave the token empty to add a line.`);
    }
  } else if (row.itemNumber.kind === 'invalid') {
    fail('item_number', row.itemNumber.raw === '-'
      ? 'item_number cannot be cleared. Leave it empty to add a line.'
      : `item_number '${row.itemNumber.raw}' is not a line number.`);
  } else if (row.itemNumber.kind === 'other') {
    const other = input.scope === 'opex' ? 'CAPEX' : 'OPEX';
    fail('item_number', `item_number '${row.itemNumber.raw}' is a ${other} line. Import it from the ${other} list.`);
  } else {
    matched = storedByNumber.get(row.itemNumber.n) ?? null;
    if (!matched) {
      const ref = lineRef(input.scope, row.itemNumber.n);
      if (row.token.kind === 'ok') {
        fail('item_number', `${ref} was deleted since the export.`);
        bag.deleted.push({ line: row.line, itemNumber: ref });
      } else {
        fail('item_number', `item_number '${row.itemNumber.raw}' does not match a line.`);
      }
    }
  }
  if (row.token.kind === 'bad' && row.itemNumber.kind !== 'blank') fail('kanap_token', tokenError(row.token.raw));

  const changes: string[] = [];
  const draft = emptyDraft();
  const live = matched;
  const costCenter = resolveCostCenter(input, row, live, blocked, fail, bag, changes, draft);
  const company = resolveCompany(input, row, live, creating, costCenter, blocked, fail, bag, changes, draft);
  resolveAccount(input, row, live, creating, company, blocked, fail, bag, changes, draft);
  const supplier = resolveSupplier(input, row, live, creating, blocked, fail, bag, changes, draft);
  resolveText(input.scope, row, live, creating, blocked, fail, changes, draft);
  resolveEnums(input.scope, row, live, creating, blocked, fail, changes, draft);
  resolveCurrency(input, row, live, creating, blocked, fail, changes, draft);
  resolveOwners(input, row, live, creating, blocked, fail, bag, changes, draft);
  resolveProject(input, row, live, creating, blocked, fail, bag, changes, draft);
  resolveAnalytics(input, row, live, creating, blocked, fail, bag, changes, draft);
  resolveDates(input, row, live, creating, blocked, fail, changes, draft);
  resolveAmounts(input, row, live, blocked, fail, changes, draft);

  if (creating && row.fields.name?.kind === 'value') {
    const hint = duplicateHint(input.scope, row, supplier, input.names, newKeys);
    if (hint) bag.duplicates.push({ line: row.line, message: hint });
    const key = duplicateKey(input.scope, row.fields.name.text, supplier);
    if (key && !newKeys.has(key)) newKeys.set(key, row.line);
  }

  if (live && row.token.kind === 'ok' && errors.length === row.errors.length) noteFreshness(input.scope, row, live, bag);
  if (live) {
    bag.snapshot.push({
      id: live.id,
      itemNumber: live.itemNumber,
      rowVersion: live.rowVersion,
      years: live.versions.map((version) => ({ year: version.year, versionId: version.id, budgetRev: version.budgetRev })),
    });
  }

  for (const error of errors) bag.errors.push({ line: row.line, column: error.column, message: error.message });

  const failed = errors.length > 0;
  if (failed || !creating && !live) return;
  if (creating || changes.length > 0) bag.plans.push(toPlan(input.scope, row, live, creating, draft));
  if (creating) {
    bag.created.push({ line: row.line, name: textOf(row.fields.name) || '(no name)' });
    return;
  }
  if (changes.length > 0 && live) {
    bag.updated.push({ line: row.line, itemNumber: lineRef(input.scope, live.itemNumber), fields: changes });
    return;
  }
  bag.unchanged += 1;
}

function toPlan(
  scope: BudgetFileScope,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  draft: LineDraft,
): BudgetFileLinePlan {
  const years = Array.from(new Set(draft.amounts.map((amount) => amount.year))).sort((a, b) => a - b);
  return {
    line: row.line,
    creating,
    itemId: live?.id ?? null,
    itemNumber: live?.itemNumber ?? (row.itemNumber.kind === 'number' ? row.itemNumber.n : null),
    body: draft.body,
    analytics: draft.analytics,
    amounts: draft.amounts,
    grains: years.map((year) => ({ year, grain: draft.grains.get(year) ?? 'annual' })),
    newSupplier: draft.newSupplier,
  };
}

type CompanyOutcome = { id: string | null; known: boolean };

function resolveCostCenter(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  bag: Bag,
  changes: string[],
  draft: LineDraft,
): { id: string | null; companyId: string | null } | null {
  const cell = row.fields.cost_center_code ?? { kind: 'absent' as const };
  if (blocked('cost_center_code')) return live ? { id: live.costCenterId, companyId: null } : null;
  if (cell.kind === 'absent' || cell.kind === 'blank') {
    if (!live?.costCenterId) return null;
    const node = input.catalog.costCenters.find((center) => center.id === live.costCenterId);
    return { id: live.costCenterId, companyId: node?.companyId ?? null };
  }
  if (cell.kind === 'clear') {
    if (live?.costCenterId) {
      changes.push('cost_center_code');
      draft.body.cost_center_id = null;
    }
    return { id: null, companyId: null };
  }
  const node = findCostCenter(input.catalog.costCenters, cell.text);
  if (node.kind === 'none') {
    fail('cost_center_code', `Cost center ${cell.text} was not found.`);
    miss(bag, 'costCenters', cell.text);
    return null;
  }
  if (node.kind === 'ambiguous') {
    fail('cost_center_code', `Cost center ${cell.text} matches more than one cost center.`);
    return null;
  }
  if (node.center.kind !== 'cost_center') {
    fail('cost_center_code', `${node.center.code} is a group. Choose a cost center.`);
    return null;
  }
  if (!isActiveAt(node.center.disabledAt) && node.center.id !== (live?.costCenterId ?? null)) {
    fail('cost_center_code', `Cost center ${node.center.code} is disabled.`);
    return null;
  }
  const changed = !!(live && node.center.id !== live.costCenterId);
  if (changed) changes.push('cost_center_code');
  writeField(draft, !live, changed, 'cost_center_id', node.center.id);
  return { id: node.center.id, companyId: node.center.companyId };
}

function resolveCompany(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  costCenter: { id: string | null; companyId: string | null } | null,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  bag: Bag,
  changes: string[],
  draft: LineDraft,
): CompanyOutcome {
  const cell = row.fields.company_name ?? { kind: 'absent' as const };
  if (blocked('company_name')) return { id: live?.companyId ?? null, known: false };
  if (cell.kind === 'clear') {
    fail('company_name', 'company_name is required.');
    return { id: null, known: false };
  }
  if (cell.kind === 'value') {
    const found = matchName(input.catalog.companies, cell.text);
    if (found.kind === 'none') {
      fail('company_name', `Company '${cell.text}' was not found.`);
      miss(bag, 'companies', cell.text);
      return { id: null, known: false };
    }
    if (found.kind === 'many') {
      fail('company_name', `Company '${cell.text}' matches more than one company.`);
      return { id: null, known: false };
    }
    if (!isActiveAt(found.row.disabledAt) && found.row.id !== (live?.companyId ?? null)) {
      fail('company_name', `Company '${found.row.name}' is disabled.`);
      return { id: null, known: false };
    }
    const changed = !!(live && found.row.id !== live.companyId);
    if (changed) changes.push('company_name');
    writeField(draft, creating, changed, 'paying_company_id', found.row.id);
    return { id: found.row.id, known: true };
  }
  if (creating) {
    const fromCenter = costCenter?.companyId ?? null;
    if (!fromCenter) {
      fail('company_name', 'company_name is required.');
      return { id: null, known: false };
    }
    draft.body.paying_company_id = fromCenter;
    return { id: fromCenter, known: true };
  }
  return { id: live?.companyId ?? null, known: !!live?.companyId };
}

function resolveAccount(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  company: CompanyOutcome,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  bag: Bag,
  changes: string[],
  draft: LineDraft,
): void {
  const cell = row.fields.account_number ?? { kind: 'absent' as const };
  if (blocked('account_number')) return;
  if (cell.kind === 'clear') {
    fail('account_number', 'account_number is required.');
    return;
  }
  if (cell.kind === 'absent' || cell.kind === 'blank') {
    if (creating) fail('account_number', 'account_number is required.');
    return;
  }
  const digits = cell.text.replace(/\s+/g, '');
  if (!/^\d+$/.test(digits)) {
    fail('account_number', 'account_number must contain digits only.');
    return;
  }
  if (!company.known || !company.id) return;
  const companyRow = input.catalog.companies.find((item) => item.id === company.id);
  const chartId = companyRow?.coaId ?? input.catalog.defaultCoaId;
  const inChart = input.catalog.accounts.filter((account) => (account.coaId ?? null) === (chartId ?? null));
  const matched = matchCode(digits, inChart.map((account) => account.number));
  if (matched.kind === 'ambiguous') {
    fail('account_number', `account_number '${digits}' matches more than one account.`);
    return;
  }
  if (matched.kind !== 'exact' && matched.kind !== 'stripped') {
    fail('account_number', `Account ${digits} was not found in the company's chart of accounts.`);
    miss(bag, 'accounts', digits);
    return;
  }
  const account = inChart.find((item) => item.number === matched.code);
  if (!account) return;
  if (!isActiveAt(account.disabledAt) && account.id !== (live?.accountId ?? null)) {
    fail('account_number', `Account ${account.number} is disabled.`);
    return;
  }
  // An account kept for the other type of line: refused on a new line or a new account; the
  // line's current account stays, as `resolveItemWrite` lets it.
  if (account.nature && account.nature !== input.scope && account.id !== (live?.accountId ?? null)) {
    fail('account_number', `Account ${account.number} is for ${account.nature === 'capex' ? 'CAPEX' : 'OPEX'} lines only.`);
    return;
  }
  const changed = !!(live && account.id !== live.accountId);
  if (changed) changes.push('account_number');
  writeField(draft, creating, changed, 'account_id', account.id);
}

function resolveSupplier(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  bag: Bag,
  changes: string[],
  draft: LineDraft,
): { id: string | null; createKey: string | null } {
  const nameCell = row.fields.supplier_name ?? { kind: 'absent' as const };
  const erpCell = row.fields.supplier_erp_id ?? { kind: 'absent' as const };
  if (blocked('supplier_name') || blocked('supplier_erp_id')) return { id: live?.supplierId ?? null, createKey: null };
  const name = opinion(nameCell);
  const erp = opinion(erpCell);
  if (name === undefined && erp === undefined) return { id: creating ? null : (live?.supplierId ?? null), createKey: null };
  if (name === null && (erp === undefined || erp === null)) {
    if (live?.supplierId) {
      changes.push('supplier');
      draft.body.supplier_id = null;
    }
    return { id: null, createKey: null };
  }
  if (erp === null && name === undefined) {
    if (live?.supplierId) {
      changes.push('supplier');
      draft.body.supplier_id = null;
    }
    return { id: null, createKey: null };
  }
  const nameText = name ?? '';
  const erpText = erp ?? '';
  const byErp = erpText ? matchErp(input.catalog.suppliers, erpText) : null;
  const byName = nameText ? matchName(input.catalog.suppliers, nameText) : null;
  if (byErp?.kind === 'many') {
    fail('supplier_erp_id', `Several suppliers share ERP id '${erpText}'.`);
    return { id: null, createKey: null };
  }
  if (byName?.kind === 'many' && !erpText) {
    fail('supplier_name', `Supplier '${nameText}' matches more than one supplier.`);
    return { id: null, createKey: null };
  }
  if (byErp?.kind === 'one' && byName?.kind === 'one' && byErp.row.id !== byName.row.id) {
    fail('supplier_name', `supplier_name '${nameText}' and supplier_erp_id '${erpText}' point to different suppliers.`);
    return { id: null, createKey: null };
  }
  if (byErp?.kind === 'one') {
    const supplier = byErp.row;
    if (nameText && supplier.name.trim().toLowerCase() !== nameText.toLowerCase()) {
      bag.supplierNames.push({
        line: row.line,
        message: `supplier_name '${nameText}' does not match the supplier for ERP id '${erpText}' (${supplier.name}).`,
      });
    }
    if (!isActiveAt(supplier.disabledAt) && supplier.id !== (live?.supplierId ?? null)) {
      fail('supplier_name', `Supplier '${supplier.name}' is disabled.`);
      return { id: null, createKey: null };
    }
    const changed = !!(live && supplier.id !== live.supplierId);
    if (changed) changes.push('supplier');
    writeField(draft, creating, changed, 'supplier_id', supplier.id);
    return { id: supplier.id, createKey: null };
  }
  if (erpText && byName?.kind === 'one') {
    fail('supplier_erp_id', `ERP id '${erpText}' is unknown and '${byName.row.name}' is already a supplier. Add the ERP id in Master data > Suppliers or leave it empty.`);
    return { id: null, createKey: null };
  }
  if (!erpText && byName?.kind === 'one') {
    const supplier = byName.row;
    if (!isActiveAt(supplier.disabledAt) && supplier.id !== (live?.supplierId ?? null)) {
      fail('supplier_name', `Supplier '${supplier.name}' is disabled.`);
      return { id: null, createKey: null };
    }
    const changed = !!(live && supplier.id !== live.supplierId);
    if (changed) changes.push('supplier');
    writeField(draft, creating, changed, 'supplier_id', supplier.id);
    return { id: supplier.id, createKey: null };
  }
  if (!nameText) {
    fail('supplier_erp_id', `supplier_erp_id '${erpText}' does not match a supplier.`);
    return { id: null, createKey: null };
  }
  const createKey = `${nameText.toLowerCase()}|${erpText.toLowerCase()}`;
  if (input.createSuppliers && input.canCreateSuppliers) {
    const created = { name: nameText, erpId: erpText || null };
    bag.suppliers.set(createKey, created);
    changes.push('supplier');
    draft.newSupplier = created;
    return { id: null, createKey };
  }
  fail('supplier_name', `Supplier '${nameText}' does not exist.`);
  bag.suppliers.set(createKey, { name: nameText, erpId: erpText || null });
  return { id: null, createKey: null };
}

/** undefined: the column says nothing. null: `-`. string: a value. */
function opinion(cell: FieldCell): string | null | undefined {
  if (cell.kind === 'absent' || cell.kind === 'blank') return undefined;
  if (cell.kind === 'clear') return null;
  return cell.text.trim();
}

function resolveText(
  scope: BudgetFileScope,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  changes: string[],
  draft: LineDraft,
): void {
  const fields: Array<{ id: string; stored: string | null; required: boolean }> = [
    { id: 'name', stored: live?.name ?? null, required: true },
    { id: 'description', stored: live?.description ?? null, required: false },
    { id: 'notes', stored: live?.notes ?? null, required: false },
  ];
  for (const field of fields) {
    if (scope === 'capex' && field.id === 'description') continue;
    const cell = row.fields[field.id] ?? { kind: 'absent' as const };
    if (blocked(field.id)) continue;
    const key = field.id === 'name' ? nameColumn(scope) : field.id;
    if (cell.kind === 'clear') {
      if (field.required || !CLEARABLE.has(field.id)) fail(field.id, `${field.id} is required.`);
      else if (field.stored) {
        changes.push(field.id);
        draft.body[key] = null;
      }
      continue;
    }
    if (cell.kind === 'absent' || cell.kind === 'blank') {
      if (creating && field.required) fail(field.id, `${field.id} is required.`);
      continue;
    }
    const changed = (field.stored ?? '') !== cell.text;
    if (changed) changes.push(field.id);
    writeField(draft, creating, changed, key, cell.text);
  }
}

function resolveEnums(
  scope: BudgetFileScope,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  changes: string[],
  draft: LineDraft,
): void {
  const fields: Array<{ id: string; stored: string | null; required: boolean }> = [
    { id: 'ppe_type', stored: live?.ppeType ?? null, required: scope === 'capex' },
    { id: 'investment_type', stored: live?.investmentType ?? null, required: scope === 'capex' },
    { id: 'priority', stored: live?.priority ?? null, required: scope === 'capex' },
    { id: 'run_build', stored: live?.runBuild ?? null, required: false },
  ];
  for (const field of fields) {
    if (scope === 'opex' && CAPEX_REQUIRED.includes(field.id)) continue;
    const cell = row.fields[field.id] ?? { kind: 'absent' as const };
    if (blocked(field.id)) continue;
    const allowed = ENUMS[field.id];
    if (cell.kind === 'clear') {
      if (field.required) fail(field.id, `${field.id} is required.`);
      else if (field.stored) {
        changes.push(field.id);
        draft.body[field.id] = null;
      }
      continue;
    }
    if (cell.kind === 'absent' || cell.kind === 'blank') {
      if (creating && field.required) fail(field.id, `${field.id} is required.`);
      continue;
    }
    const value = cell.text.toLowerCase();
    if (!allowed.includes(value)) {
      const list = allowed.length <= 2 ? allowed.join(' or ') : allowed.join(', ');
      fail(field.id, `${field.id} '${cell.text}' is not a value. Use ${list}.`);
      continue;
    }
    const changed = (field.stored ?? '') !== value;
    if (changed) changes.push(field.id);
    writeField(draft, creating, changed, field.id, value);
  }
}

function resolveCurrency(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  changes: string[],
  draft: LineDraft,
): void {
  const cell = row.fields.currency ?? { kind: 'absent' as const };
  if (blocked('currency')) return;
  if (cell.kind === 'clear') {
    fail('currency', 'currency is required.');
    return;
  }
  if (cell.kind === 'absent' || cell.kind === 'blank') {
    if (creating) fail('currency', 'currency is required.');
    return;
  }
  if (!/^[A-Za-z]{3}$/.test(cell.text.trim())) {
    fail('currency', 'currency must be 3 letters.');
    return;
  }
  const code = cell.text.trim().toUpperCase();
  const allowed = input.catalog.allowedCurrencies;
  if (allowed && allowed.length > 0 && !allowed.includes(code)) {
    fail('currency', `currency '${code}' is not allowed.`);
    return;
  }
  const changed = (live?.currency ?? '').trim().toUpperCase() !== code;
  if (changed) changes.push('currency');
  writeField(draft, creating, changed, 'currency', code);
}

function resolveOwners(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  bag: Bag,
  changes: string[],
  draft: LineDraft,
): void {
  const owners: Array<{ id: string; column: 'owner_it_id' | 'owner_business_id'; stored: string | null }> = [
    { id: 'owner_it_email', column: 'owner_it_id', stored: live?.ownerItEmail ?? null },
    { id: 'owner_business_email', column: 'owner_business_id', stored: live?.ownerBusinessEmail ?? null },
  ];
  for (const owner of owners) {
    const cell = row.fields[owner.id] ?? { kind: 'absent' as const };
    if (blocked(owner.id)) continue;
    if (cell.kind === 'absent' || cell.kind === 'blank') continue;
    if (cell.kind === 'clear') {
      if (owner.stored) {
        changes.push(owner.id);
        draft.body[owner.column] = null;
      }
      continue;
    }
    if (!EMAIL.test(cell.text)) {
      fail(owner.id, `${owner.id} is invalid.`);
      continue;
    }
    const user = findUser(input.catalog.users, cell.text);
    if (!user) {
      fail(owner.id, `${owner.id} '${cell.text}' was not found.`);
      miss(bag, 'users', cell.text);
      continue;
    }
    const current = (owner.stored ?? '').toLowerCase() === user.email.toLowerCase();
    if (user.status !== 'enabled' && !current) {
      fail(owner.id, `${owner.id} '${cell.text}' is not an active user.`);
      continue;
    }
    if (!current) changes.push(owner.id);
    writeField(draft, creating, !current, owner.column, user.id);
  }
}

function resolveProject(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  bag: Bag,
  changes: string[],
  draft: LineDraft,
): void {
  const cell = row.fields.project ?? { kind: 'absent' as const };
  if (blocked('project')) return;
  if (cell.kind === 'absent' || cell.kind === 'blank') return;
  if (cell.kind === 'clear') {
    if (live?.projectNumber != null) {
      changes.push('project');
      draft.body.project_id = null;
    }
    return;
  }
  const parsed = parseProject(cell.text);
  if (parsed == null) {
    fail('project', `project '${cell.text}' is not a project number.`);
    return;
  }
  const project = input.catalog.projects.find((item) => item.itemNumber === parsed);
  if (!project) {
    fail('project', `project '${cell.text}' was not found.`);
    miss(bag, 'projects', cell.text.trim());
    return;
  }
  const changed = live?.projectNumber !== parsed;
  if (changed) changes.push('project');
  writeField(draft, creating, changed, 'project_id', project.id);
}

function resolveAnalytics(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  bag: Bag,
  changes: string[],
  draft: LineDraft,
): void {
  for (const [code, cell] of Object.entries(row.analytics)) {
    const column = `analytics:${code}`;
    if (blocked(column)) continue;
    const dimension = input.catalog.dimensions.find((item) => item.code === code);
    const current = live?.analytics[code] ?? null;
    if (cell.kind === 'absent' || cell.kind === 'blank') continue;
    if (cell.kind === 'clear') {
      if (current) {
        changes.push(column);
        draft.analytics.push({ code, categoryId: null, createName: null });
      }
      continue;
    }
    if (!dimension) continue;
    const matches = dimension.values.filter((value) => value.name.trim().toLowerCase() === cell.text.toLowerCase());
    if (matches.length > 1) {
      fail(column, `Value '${cell.text}' matches more than one value of ${code}.`);
      continue;
    }
    if (matches.length === 1) {
      const value = matches[0];
      const same = (current ?? '').toLowerCase() === value.name.toLowerCase();
      if (!isActiveAt(value.disabledAt) && !same) {
        fail(column, `${value.name} is disabled. Pick an enabled value.`);
        continue;
      }
      if (value.appliesTo && value.appliesTo !== input.scope && !same) {
        fail(column, `${value.name} is for ${value.appliesTo.toUpperCase()} lines only. Pick a value for ${input.scope.toUpperCase()} lines.`);
        continue;
      }
      if (!same) changes.push(column);
      if (creating || !same) draft.analytics.push({ code, categoryId: value.id, createName: null });
      continue;
    }
    try {
      const name = normalizeAnalyticsName(cell.text);
      const listed = bag.dimensions.get(code) ?? new Map<string, string>();
      listed.set(name.toLowerCase(), name);
      bag.dimensions.set(code, listed);
      changes.push(column);
      draft.analytics.push({ code, categoryId: null, createName: name });
    } catch (err) {
      fail(column, analyticsMessage(err));
    }
  }
}

function resolveDates(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  changes: string[],
  draft: LineDraft,
): void {
  const start = row.fields.effective_start ?? { kind: 'absent' as const };
  if (!blocked('effective_start')) {
    if (start.kind === 'clear') fail('effective_start', 'effective_start cannot be cleared.');
    else if ((start.kind === 'absent' || start.kind === 'blank') && creating) {
      draft.body.effective_start = `${firstAmountYear(row) ?? input.currentYear}-01-01`;
    } else if (start.kind === 'value') {
      const parsedStart = row.dates.effective_start;
      if (parsedStart?.kind === 'date') {
        const changed = (live?.effectiveStart ?? '') !== parsedStart.isoDate;
        if (changed) changes.push('effective_start');
        writeField(draft, creating, changed, 'effective_start', parsedStart.isoDate);
      }
    }
  }
  const end = row.fields.end_of_validity ?? { kind: 'absent' as const };
  if (blocked('end_of_validity')) return;
  if (end.kind === 'absent' || end.kind === 'blank') return;
  if (end.kind === 'clear') {
    if (live?.endOfValidity) {
      changes.push('end_of_validity');
      draft.body.disabled_at = null;
    }
    return;
  }
  const parsed = row.dates.end_of_validity;
  if (!parsed || parsed.kind === 'clear') return;
  const instant = parsed.kind === 'instant' ? parsed.iso : endOfValidityFromDate(parsed.isoDate).toISOString();
  const stored = live?.endOfValidity ? new Date(live.endOfValidity).toISOString() : null;
  const changed = stored !== instant;
  if (changed) changes.push('end_of_validity');
  writeField(draft, creating, changed, 'disabled_at', instant);
}

function resolveAmounts(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  blocked: (column: string) => boolean,
  fail: (column: string | null, message: string) => void,
  changes: string[],
  draft: LineDraft,
): void {
  for (const amount of row.amounts) {
    const seen = draft.grains.get(amount.year);
    if (amount.month != null) draft.grains.set(amount.year, 'monthly');
    else if (seen !== 'monthly') draft.grains.set(amount.year, 'annual');
    if (blocked(amount.id) || amount.cell.kind === 'blank' || amount.cell.kind === 'invalid' || amount.cell.kind === 'clear') continue;
    const version = live?.versions.find((item) => item.year === amount.year);
    const changed = amount.month == null
      ? amount.cell.cents !== yearSum(version, amount.measure)
      : amount.cell.cents !== (version?.months[amount.measure][amount.month - 1]?.cents ?? null);
    if (!changed) continue;
    const frozenKey = `${amount.year}:${MEASURE_FREEZE_COLUMN[amount.measure]}`;
    if (input.catalog.frozen.includes(frozenKey)) {
      const label = input.labels[amount.column] || amount.column;
      fail(amount.id, `${label} for ${amount.year} is frozen.`);
      continue;
    }
    const when = amount.month == null ? String(amount.year) : `${amount.year}-${String(amount.month).padStart(2, '0')}`;
    changes.push(`${amount.column} ${when}`);
    draft.amounts.push({ year: amount.year, measure: amount.measure, month: amount.month, cents: amount.cell.cents });
  }
}

function noteFreshness(scope: BudgetFileScope, row: InterpretedRow, live: StoredLine, bag: Bag): void {
  if (row.token.kind !== 'ok') return;
  const rowMismatch = row.token.rowVersion !== live.rowVersion;
  const years = row.token.years.filter((year) => {
    const version = live.versions.find((item) => item.year === year.year);
    return !version || version.budgetRev !== year.rev;
  }).map((year) => year.year);
  if (!rowMismatch && years.length === 0) return;
  const ref = lineRef(scope, live.itemNumber);
  bag.changed.push({
    line: row.line,
    itemNumber: ref,
    id: live.id,
    by: null,
    at: null,
    message: changedSinceText(ref, null, null),
    rowMismatch,
    years,
  });
}

function duplicateHint(
  scope: BudgetFileScope,
  row: InterpretedRow,
  supplier: { id: string | null; createKey: string | null },
  names: LineHint[],
  newKeys: Map<string, number>,
): string | null {
  const name = textOf(row.fields.name);
  if (!name) return null;
  const key = duplicateKey(scope, name, supplier);
  if (!key) return null;
  if (scope === 'opex') {
    const found = names.find((hint) => hint.name.trim().toLowerCase() === name.toLowerCase()
      && (hint.supplierId ?? null) === (supplier.id ?? null)
      && supplier.createKey == null);
    if (found) return `row ${row.line} looks like ${lineRef(scope, found.itemNumber)}`;
  } else {
    const found = names.find((hint) => hint.name.trim().toLowerCase() === name.toLowerCase());
    if (found) return `row ${row.line} looks like ${lineRef(scope, found.itemNumber)}`;
  }
  const earlier = newKeys.get(key);
  if (earlier !== undefined) return `row ${row.line} looks like row ${earlier}`;
  return null;
}

function duplicateKey(scope: BudgetFileScope, name: string, supplier: { id: string | null; createKey: string | null }): string | null {
  const base = name.trim().toLowerCase();
  if (!base) return null;
  if (scope === 'capex') return `name:${base}`;
  return `name:${base}|${supplier.id ?? supplier.createKey ?? 'none'}`;
}

function yearSum(version: StoredVersion | undefined, measure: AmountMeasure): bigint {
  if (!version) return 0n;
  return version.months[measure].reduce((sum, month) => sum + (month.cents ?? 0n), 0n);
}

function findCostCenter(
  centers: CatalogCostCenter[],
  cell: string,
): { kind: 'none' } | { kind: 'ambiguous' } | { kind: 'one'; center: CatalogCostCenter } {
  const matched = matchCode(cell.trim(), centers.map((center) => center.code));
  if (matched.kind === 'exact' || matched.kind === 'stripped') {
    const center = centers.find((item) => item.code === matched.code);
    return center ? { kind: 'one', center } : { kind: 'none' };
  }
  if (matched.kind === 'ambiguous') return { kind: 'ambiguous' };
  const folded = centers.filter((center) => center.code.trim().toLowerCase() === cell.trim().toLowerCase());
  if (folded.length === 1) return { kind: 'one', center: folded[0] };
  if (folded.length > 1) return { kind: 'ambiguous' };
  return { kind: 'none' };
}

function matchName<T extends { name: string }>(rows: T[], cell: string): { kind: 'none' } | { kind: 'many' } | { kind: 'one'; row: T } {
  const text = cell.trim();
  const exact = rows.filter((row) => row.name.trim() === text);
  if (exact.length === 1) return { kind: 'one', row: exact[0] };
  if (exact.length > 1) return { kind: 'many' };
  const folded = rows.filter((row) => row.name.trim().toLowerCase() === text.toLowerCase());
  if (folded.length === 1) return { kind: 'one', row: folded[0] };
  if (folded.length > 1) return { kind: 'many' };
  return { kind: 'none' };
}

function matchErp(rows: CatalogSupplier[], cell: string): { kind: 'none' } | { kind: 'many' } | { kind: 'one'; row: CatalogSupplier } {
  const text = cell.trim();
  const exact = rows.filter((row) => (row.erpId ?? '').trim() === text);
  if (exact.length === 1) return { kind: 'one', row: exact[0] };
  if (exact.length > 1) return { kind: 'many' };
  const folded = rows.filter((row) => (row.erpId ?? '').trim().toLowerCase() === text.toLowerCase() && (row.erpId ?? '').trim() !== '');
  if (folded.length === 1) return { kind: 'one', row: folded[0] };
  if (folded.length > 1) return { kind: 'many' };
  return { kind: 'none' };
}

function findUser(users: CatalogUser[], email: string): CatalogUser | null {
  const key = email.trim().toLowerCase();
  return users.find((user) => user.email.trim().toLowerCase() === key) ?? null;
}

function parseProject(text: string): number | null {
  const prefixed = /^PRJ-(\d+)$/i.exec(text.trim());
  const digits = prefixed?.[1] ?? (/^\d+$/.test(text.trim()) ? text.trim() : null);
  if (digits == null) return null;
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

function textOf(cell: FieldCell | undefined): string {
  return cell?.kind === 'value' ? cell.text.trim() : '';
}

function miss(bag: Bag, type: string, example: string): void {
  const set = bag.missing.get(type) ?? new Set<string>();
  set.add(example);
  bag.missing.set(type, set);
}

function analyticsMessage(err: unknown): string {
  const response = (err as { getResponse?: () => unknown }).getResponse?.();
  if (response && typeof response === 'object' && 'message' in response) return String((response as { message: unknown }).message);
  return (err as Error).message || 'The dimension value is not valid.';
}

export function changedSinceText(ref: string, by: string | null, at: string | null): string {
  if (by && at) return `${ref} was changed by ${by} at ${at.slice(11, 16)}.`;
  if (by) return `${ref} was changed by ${by}.`;
  return `${ref} was changed since the export.`;
}

function supplierMessage(bag: Bag, input: PreflightInput): string | null {
  if (input.createSuppliers && input.canCreateSuppliers) return null;
  const count = bag.suppliers.size;
  if (count === 0) return null;
  const noun = count === 1 ? '1 supplier does not exist' : `${count} suppliers do not exist`;
  return `${noun}. Create them in Master data > Suppliers, or tick Create missing suppliers.`;
}

function emptyBag(): Bag {
  return {
    errors: [],
    missing: new Map(),
    suppliers: new Map(),
    dimensions: new Map(),
    duplicates: [],
    supplierNames: [],
    deleted: [],
    changed: [],
    snapshot: [],
    created: [],
    updated: [],
    unchanged: 0,
    plans: [],
  };
}

function finish(input: PreflightInput, errors: Bag['errors'], bag: Bag, supplierNote: string | null): BudgetFileReport {
  const missing = [...bag.missing.entries()].map(([type, examples]) => {
    const label = MISSING_LABELS[type];
    const list = [...examples];
    const labelText = label ?? { one: type, many: type, where: type };
    const shown = list.slice(0, MISSING_EXAMPLE_LIMIT);
    const extra = list.length - shown.length;
    const body = extra > 0 ? `${shown.join(', ')}, and ${extra} more` : shown.join(', ');
    const noun = list.length === 1 ? labelText.one : labelText.many;
    return {
      type,
      count: list.length,
      examples: shown,
      where: labelText.where,
      message: `Missing: ${list.length} ${noun} (${body}): ${labelText.where}`,
    };
  });
  const errorCount = errors.length;
  const deletedCount = bag.deleted.length;
  return {
    ok: input.read.fileErrors.length === 0 && input.read.headerErrors.length === 0 && errorCount === 0 && deletedCount === 0,
    scope: input.scope,
    encoding: input.read.encoding,
    separator: input.read.separator,
    notices: { dates: input.read.dates?.notice ?? null, amounts: input.read.amounts?.notice ?? null },
    fileErrors: input.read.fileErrors,
    headerErrors: input.read.headerErrors,
    errors: errors.slice(0, PREFLIGHT_ERROR_LIMIT),
    errorCount,
    missing,
    deleted: bag.deleted.slice(0, PREFLIGHT_LIST_LIMIT),
    deletedCount,
    changes: {
      created: bag.created.length,
      updated: bag.updated.length,
      unchanged: bag.unchanged,
      createdLines: bag.created.slice(0, PREFLIGHT_LIST_LIMIT),
      updatedLines: bag.updated.slice(0, PREFLIGHT_LIST_LIMIT),
    },
    changedSinceExport: bag.changed.slice(0, PREFLIGHT_LIST_LIMIT),
    changedSinceExportCount: bag.changed.length,
    warnings: {
      duplicates: bag.duplicates.slice(0, PREFLIGHT_LIST_LIMIT),
      ignoredColumns: input.read.ignoredColumns,
      supplierNames: bag.supplierNames.slice(0, PREFLIGHT_LIST_LIMIT),
    },
    creates: {
      dimensionValues: [...bag.dimensions.entries()].map(([dimension, names]) => ({
        dimension,
        names: [...names.values()].slice(0, PREFLIGHT_LIST_LIMIT),
      })),
      suppliers: input.createSuppliers && input.canCreateSuppliers
        ? [...bag.suppliers.values()].slice(0, PREFLIGHT_LIST_LIMIT)
        : [],
    },
    supplierMessage: supplierNote,
    snapshot: { lines: bag.snapshot },
  };
}

export function blankPreflightInput(scope: BudgetFileScope, read: CsvReadResult, currentYear: number): PreflightInput {
  return {
    scope,
    read,
    catalog: emptyCatalog(),
    stored: [],
    names: [],
    createSuppliers: false,
    canCreateSuppliers: false,
    currentYear,
    labels: {},
  };
}
