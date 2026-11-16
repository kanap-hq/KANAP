import { keepStoredEndOfValidity, matchCode } from '../../common/csv-sheet';
import {
  ANALYTICS_NAME_CHARACTERS_MESSAGE,
  ANALYTICS_NAME_MAX,
  ANALYTICS_NAME_REQUIRED_MESSAGE,
  ANALYTICS_NAME_TOO_LONG_MESSAGE,
  normalizeAnalyticsName,
} from '../../analytics/analytics-context';
import { notApplicableDimensionMessage, requiredDimensionMessage } from '../item-analytics.util';
import { AmountMeasure, MEASURE_FREEZE_COLUMN } from '../amounts-write.util';
import { formatCentsFixed } from '../../common/amount';
import { endOfValidityFromDate, isActiveAt } from '../../common/status';
import type { BudgetNature } from '../budget-nature';
import { BudgetFileRead, firstAmountYear, interpretBudgetFile, InterpretedRow, FieldCell, ItemNumberCell } from './interpret';
import { tokenError } from './token';
import { columnOfMeasure } from './columns';
import { hintState, LineIndex, lineState, RowKeys, rowSums, unusual } from './lookalikes';
import { DATA_ACCESS_LEAVES_ACCESS_MESSAGE, DATA_ACCESS_PLACEMENT_MESSAGE } from '../../data-access/line-write-checks';
import {
  accentFreeKey,
  cellKey,
  closestNames,
  createSuppliersChoice,
  foldKey,
  matchByName,
  NameMatch,
  translatedValues,
  translationTableOf,
} from './matching';
import {
  BudgetCatalog,
  BudgetFileAmountChange,
  BudgetFileAnalyticsChange,
  BudgetFileCandidates,
  BudgetFileChoice,
  BudgetFileLinePlan,
  BudgetFileLookalike,
  BudgetFileLookalikeChoice,
  BudgetFileLookalikeReason,
  BudgetFileLookalikesChoice,
  BudgetFileLookalikeTarget,
  BudgetFileMatch,
  BudgetFileMatchOptions,
  BudgetFileNatureCounts,
  BudgetFileRefusedProposal,
  BudgetFileReport,
  BudgetFileScope,
  BudgetFileSentence,
  BudgetFileSnapshotLine,
  CalculationLinesWarning,
  CatalogCostCenter,
  CostCenterCompanyWarning,
  CatalogSupplier,
  CatalogUser,
  LineHint,
  LOOKALIKE_LIST_LIMIT,
  MATCH_LINE_LIMIT,
  MATCH_LIST_LIMIT,
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
  run_build: ['run', 'build'],
};

const MISSING_LABELS: Record<string, { one: string; many: string; where: string }> = {
  companies: { one: 'company', many: 'companies', where: 'Master data > Companies' },
  accounts: { one: 'account', many: 'accounts', where: 'Master data > Accounts' },
  costCenters: { one: 'cost center', many: 'cost centers', where: 'Master data > Cost centers' },
  users: { one: 'user', many: 'users', where: 'Admin > Users' },
  projects: { one: 'project', many: 'projects', where: 'Portfolio > Projects' },
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Records an error of the row's `column`: its English sentence, and the code and values the interface translates. */
type Fail = (column: string | null, message: string, code?: string, params?: Record<string, string | number>) => void;

/** The write the resolvers record beside the report. Discarded when the row fails. */
interface LineDraft {
  body: Record<string, unknown>;
  analytics: BudgetFileAnalyticsChange[];
  amounts: BudgetFileAmountChange[];
  grains: Map<number, 'annual' | 'monthly'>;
  newSupplier: { name: string; erpId: string | null } | null;
  /** The columns whose calculation lines the amounts stop following, once each. */
  calculationLines: Map<string, Omit<CalculationLinesWarning, 'line'>>;
}

function emptyDraft(): LineDraft {
  return { body: {}, analytics: [], amounts: [], grains: new Map(), newSupplier: null, calculationLines: new Map() };
}

/** A create writes the value; an update writes it only when it differs from the line. */
function writeField(draft: LineDraft, creating: boolean, changed: boolean, key: string, value: unknown): void {
  if (creating || changed) draft.body[key] = value;
}

/** `opex` → `OPEX`. */
function natureLabel(nature: BudgetNature): string {
  return nature.toUpperCase();
}

/** `an OPEX`, `a CAPEX`. */
function aNature(nature: BudgetNature): string {
  return nature === 'opex' ? 'an OPEX' : 'a CAPEX';
}

/** A line the file names with another nature than its own: the type changes from the line itself (lot M). */
export function natureChangeMessage(ref: string, stored: BudgetNature, said: BudgetNature): string {
  return `${ref} is ${aNature(stored)} line, not ${aNature(said)} line. A file does not change the type of a line.`;
}

/**
 * A text cell and a stored text, read the same way before they are compared: the reader trims a
 * cell, and the load writes it trimmed, so a stored value that ends with a line break (typed in
 * the app) reads as unchanged when an export is loaded back.
 */
function storedText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export interface PreflightInput {
  /** The route's nature: the nature of a line when the file has no `nature` column (a file of before lot C1b). */
  scope: BudgetFileScope;
  read: BudgetFileRead;
  catalog: BudgetCatalog;
  stored: StoredLine[];
  names: LineHint[];
  createSuppliers: boolean;
  canCreateSuppliers: boolean;
  currentYear: number;
  /** File column name (`budget`) to the tenant's label. */
  labels: Record<string, string>;
  /** A limited person's access (planning/data-scoped-access spec §4.2); absent for an unscoped person. */
  access?: BudgetFileAccess;
  /**
   * Whether the person reads the suppliers' list, and the companies' (the reader level of their
   * module): the closest names of a value nothing matched name them only then. Absent: not read.
   */
  canReadSuppliers?: boolean;
  canReadCompanies?: boolean;
  /**
   * The person's choices (matches undone; a `create_suppliers` choice wins over `createSuppliers`)
   * and Kad's proposals. The load replays the same.
   */
  matching?: BudgetFileMatchOptions;
}

/** A line's place and owners, as the SQL functions of data-scoped access take them. */
export interface LinePlace {
  companyId: string | null;
  costCenterId: string | null;
  ownerItId: string | null;
  ownerBusinessId: string | null;
}

/**
 * What the file may do for a limited person, from the SQL functions of the database
 * (`budget-file/access.ts`): the plan itself reads nothing. `editable`: the stored lines the
 * person may modify (`data_access_line_editable`). `places`: per place, whether a line may be
 * placed there (`data_access_placable_line`) and stays modifiable with these owners. A place the
 * plan needs and `places` lacks goes to `wanted` and passes; the caller answers `wanted` and plans
 * again.
 */
export interface BudgetFileAccess {
  editable: ReadonlySet<string>;
  places: Map<string, { placable: boolean; editable: boolean }>;
  wanted: Map<string, LinePlace>;
}

export function placeKey(place: LinePlace): string {
  return [place.companyId, place.costCenterId, place.ownerItId, place.ownerBusinessId].map((id) => id ?? '').join('|');
}

function placeAnswer(access: BudgetFileAccess, place: LinePlace): { placable: boolean; editable: boolean } {
  const key = placeKey(place);
  const known = access.places.get(key);
  if (known) return known;
  access.wanted.set(key, place);
  return { placable: true, editable: true };
}

/** A line readable but not modifiable by a limited person: refused when the file changes it. */
export function readOnlyLineMessage(ref: string): string {
  return `${ref} is read only in your access.`;
}

/** A number the file names that has no line the person can read: deleted, or out of their access. */
export function noLongerAvailableMessage(ref: string): string {
  return `${ref} is no longer available since the export.`;
}

/** An unknown value of a closed-list dimension, for a limited person. */
export function closedDimensionValueMessage(name: string, code: string): string {
  return `Value '${name}' is not in the list of ${code}. Pick an existing value.`;
}

interface SupplierCreate {
  name: string;
  erpId: string | null;
}

/** What the matching found over the rows, by column and value of the file (`cellKey`). */
interface MatchState {
  unmatched: Map<string, BudgetFileChoice>;
  proposals: Map<string, string>;
  matches: Map<string, BudgetFileMatch>;
  refused: Map<string, BudgetFileRefusedProposal>;
  candidates: Map<string, BudgetFileCandidates>;
  /** The undone matches the rows would otherwise make: the choices still followed. */
  applied: Set<string>;
}

interface Bag {
  errors: Array<{ line: number; column: string | null } & BudgetFileSentence>;
  matching: MatchState;
  missing: Map<string, Set<string>>;
  suppliers: Map<string, SupplierCreate>;
  dimensions: Map<string, Map<string, string>>;
  refusedDimensions: Map<string, Map<string, string>>;
  duplicates: Array<{ line: number } & BudgetFileSentence>;
  supplierNames: Array<{ line: number } & BudgetFileSentence>;
  costCenterCompanies: CostCenterCompanyWarning[];
  calculationLines: CalculationLinesWarning[];
  /** The consistency warnings of the lines written (lot I2 of 26.11.9). */
  consistency: Array<{ line: number } & BudgetFileSentence>;
  /** The stored lines the person reads, indexed: the lookalikes and the consistency checks read them. */
  index: LineIndex;
  /** The rows that look like a stored line, and the line each looks like. */
  lookalikes: BudgetFileLookalike[];
  lookTargets: Map<number, LineHint>;
  /** The lookalike choices the check followed. */
  lookalikeChoices: BudgetFileChoice[];
  deleted: Array<{ line: number; itemNumber: string }>;
  changed: BudgetFileReport['changedSinceExport'];
  snapshot: BudgetFileSnapshotLine[];
  created: Array<{ line: number; name: string }>;
  updated: Array<{ line: number; itemNumber: string; fields: string[] }>;
  byNature: BudgetFileNatureCounts;
  unchanged: number;
  plans: BudgetFileLinePlan[];
}

/**
 * The stored line a number names, or null: `BL-n` and a bare number its own number; `OPX-n` an
 * OPEX line's own number, else the line that keeps `OPX-n` as its legacy number; `CPX-n` the line
 * that keeps `CPX-n`, else a CAPEX line without a CPX number whose own number it is.
 */
export function findStoredLine(stored: readonly StoredLine[], cell: ItemNumberCell): StoredLine | null {
  if (cell.kind !== 'number') return null;
  const { n, prefix, ref } = cell;
  if (prefix === 'BL') return stored.find((line) => line.itemNumber === n) ?? null;
  if (prefix === 'OPX') {
    return stored.find((line) => line.nature === 'opex' && line.itemNumber === n)
      ?? stored.find((line) => line.legacyNumber === ref)
      ?? null;
  }
  return stored.find((line) => line.legacyNumber === ref)
    ?? stored.find((line) => line.nature === 'capex' && line.itemNumber === n && !/^CPX-\d+$/.test(line.legacyNumber ?? ''))
    ?? null;
}

/** The preflight report. Does not read or write the database. */
export function buildPreflight(input: PreflightInput): BudgetFileReport {
  return planBudgetFile(input).report;
}

/**
 * The report and, for every line it would write, the columns and amounts.
 * The same comparison as the report. Does not read or write the database.
 */
export function planBudgetFile(given: PreflightInput): { report: BudgetFileReport; plans: BudgetFileLinePlan[] } {
  // The person's "Create missing suppliers" choice, when they made one, is the option followed.
  const chosen = createSuppliersChoice(given.matching?.choices ?? []);
  const input = chosen === undefined ? given : { ...given, createSuppliers: chosen };
  const rows = interpretBudgetFile(input.read, input.scope);
  if (input.read.fileErrors.length > 0 || input.read.headerErrors.length > 0) return { report: refused(input, rows), plans: [] };
  return compared(input, rows);
}

function refused(input: PreflightInput, rows: InterpretedRow[]): BudgetFileReport {
  const errors = rows.flatMap((row) => row.errors.map((error) => ({ line: row.line, column: error.column, message: error.message })));
  return finish(input, errors, emptyBag(input), null, false);
}

function compared(input: PreflightInput, rows: InterpretedRow[]): { report: BudgetFileReport; plans: BudgetFileLinePlan[] } {
  const bag = emptyBag(input);
  // The rows that look like a stored line are decided before the rows are read (lot I2 of 26.11.9):
  // a row left out leaves nothing behind (no plan, no supplier or value to create, no match listed).
  const decided = decideLookalikes(input, rows, bag);
  bag.lookalikeChoices = decided.followed;
  // A line named twice, by the same number or by two of its numbers (`BL-n` and `OPX-n`).
  const seen = new Map<string, { line: number; ref: string }>();
  const newKeys = new Map<string, number>();
  for (const given of rows) {
    let row = given;
    const look = decided.decisions.get(row.line);
    let entry: BudgetFileLookalike | null = null;
    if (look) {
      entry = lookalikeEntry(row, look);
      bag.lookalikes.push(entry);
      if (look.action === 'ignore') continue;
      bag.lookTargets.set(row.line, look.hint);
      if (look.action === 'update' && look.live) {
        const ref = lineRef(look.live.itemNumber);
        if (look.stale) {
          bag.errors.push({
            line: row.line, column: null, message: `${ref} changed since the check.`,
            code: 'BUDGET_FILE_LOOKALIKE_CHANGED', params: { ref },
          });
          continue;
        }
        // The update goes through the read: the row names the line, as an exported file would.
        row = { ...row, itemNumber: { kind: 'number', prefix: 'BL', n: look.live.itemNumber, raw: ref, ref } };
      }
    }
    const matched = findStoredLine(input.stored, row.itemNumber);
    if (row.itemNumber.kind === 'number') {
      const key = matched ? `line:${matched.id}` : `ref:${row.itemNumber.ref}`;
      const first = seen.get(key);
      if (first !== undefined) {
        const ref = row.itemNumber.ref;
        bag.errors.push(first.ref === ref || !matched
          ? {
            line: row.line,
            column: 'item_number',
            message: `item_number ${ref} already appears on line ${first.line}.`,
            code: 'BUDGET_FILE_LINE_TWICE',
            params: { ref, line: first.line },
          }
          : {
            line: row.line,
            column: 'item_number',
            message: `item_number ${ref} and ${first.ref} on line ${first.line} are the same line, ${lineRef(matched.itemNumber)}.`,
            code: 'BUDGET_FILE_SAME_LINE_TWICE',
            params: { ref, other: first.ref, line: first.line, item: lineRef(matched.itemNumber) },
          });
        for (const error of row.errors) bag.errors.push({ line: row.line, ...error });
        continue;
      }
      seen.set(key, { line: row.line, ref: row.itemNumber.ref });
    }
    resolveRow(input, row, matched, newKeys, bag);
    if (entry?.outcome === 'updated') entry.fields = bag.updated.find((updated) => updated.line === row.line)?.fields ?? [];
  }
  return { report: finish(input, bag.errors, bag, supplierMessage(bag, input), true), plans: bag.plans };
}

/** What the check does with a row that looks like a stored line. */
interface LookalikeDecision {
  /** The line it looks like (a stand-in holding only its number when the person no longer reads it). */
  hint: LineHint;
  /** Why it looks like it; absent when the row keeps a target it no longer looks like. */
  reason?: BudgetFileLookalikeReason;
  action: 'ignore' | 'create' | 'update';
  updatable: boolean;
  /** For an update: the stored line, and whether it changed since the state the choice carries. */
  live?: StoredLine;
  stale?: boolean;
  /** The line's state now (empty when it is gone). */
  state: string;
}

export function storedState(line: StoredLine): string {
  return lineState(line.rowVersion, line.versions);
}

/**
 * The lines a check must read whole for the choices to update them: the lines the rows to update
 * look like (lot I2 of 26.11.9), the ones a person's choice names and, for a choice for all rows,
 * every line a row looks like; and the ids of all the lines the rows look like, for the person's
 * access. The caller reads them, then plans.
 */
export function lookalikeTargets(input: PreflightInput): { ids: string[]; updates: number[] } {
  const rows = interpretBudgetFile(input.read, input.scope);
  const decided = decideLookalikes({ ...input, stored: [] }, rows, emptyBag(input));
  const ids = [...decided.decisions.values()].map((decision) => decision.hint.id).filter((id): id is string => !!id);
  return { ids, updates: decided.wanted };
}

/** The first year of the file's amount columns, or null when it has none. */
function fileFirstYear(rows: readonly InterpretedRow[]): number | null {
  let year: number | null = null;
  for (const row of rows) for (const amount of row.amounts) if (year == null || amount.year < year) year = amount.year;
  return year;
}

/**
 * For each row to create that looks like a stored line, what the check does with it: left out unless
 * the person chose otherwise (P2), the choice for the row winning over the choice for all rows. A row
 * keeps the target of the check the person chose on (an update's `item` with its `state`, or the
 * `targets` of the choice for all rows) even when it no longer looks like it: an update is then
 * refused when the line changed, and a row left out stays left out. A choice that no longer applies
 * (the person may not update the line, or it is gone) falls back to leaving the row out, and so does a
 * second row that would update a line the file already updates. `wanted`: lines to update that
 * `stored` lacks.
 */
function decideLookalikes(
  input: PreflightInput,
  rows: InterpretedRow[],
  bag: Bag,
): { decisions: Map<number, LookalikeDecision>; followed: BudgetFileChoice[]; wanted: number[] } {
  const decisions = new Map<number, LookalikeDecision>();
  const wanted: number[] = [];
  const choices = input.matching?.choices ?? [];
  const perRow = new Map<number, BudgetFileLookalikeChoice>();
  for (const choice of choices) if (choice.kind === 'lookalike' && !perRow.has(choice.line)) perRow.set(choice.line, choice);
  const all = choices.find((choice): choice is BudgetFileLookalikesChoice => choice.kind === 'lookalikes');
  const memory = all?.targets;
  const followed: BudgetFileChoice[] = [];
  const kept: Record<string, BudgetFileLookalikeTarget> = {};
  const firstYear = fileFirstYear(rows);
  // The lines the file updates, and the row that updates each: the lines it names by number first.
  const claimed = new Map<number, number>();
  for (const row of rows) {
    const named = findStoredLine(input.stored, row.itemNumber);
    if (named && !claimed.has(named.itemNumber)) claimed.set(named.itemNumber, row.line);
  }
  for (const row of rows) {
    const keys = lookalikeKeys(input, row, bag, firstYear);
    if (!keys) continue;
    const found = bag.index.find(keys);
    const chosen = perRow.get(row.line);
    const remembered = memory?.[String(row.line)];
    // The target: an update chosen on a check (its state says so), else the check's the person saw, else the one found now.
    const pinned = chosen?.action === 'update' && (chosen.state !== undefined || chosen.item === found?.hint.itemNumber)
      ? chosen.item
      : remembered?.item;
    const item = pinned ?? found?.hint.itemNumber;
    if (item === undefined) continue;
    const alike = found && found.hint.itemNumber === item ? found : null;
    const known = alike?.hint ?? bag.index.hintOf(item);
    const hint: LineHint = known ?? { nature: keys.nature, itemNumber: item, name: '', supplierId: null };
    const updatable = !!known && (!input.access || (!!known.id && input.access.editable.has(known.id)));
    const live = known ? input.stored.find((line) => line.itemNumber === item && (!known.id || line.id === known.id)) : undefined;
    const state = live ? storedState(live) : known ? hintState(known) : '';
    let action: LookalikeDecision['action'] = 'ignore';
    let expected: string | undefined;
    let follow: BudgetFileChoice | null = null;
    if (chosen) {
      if (chosen.action !== 'update') {
        action = chosen.action;
        follow = chosen;
      } else if (chosen.item === item && updatable) {
        action = 'update';
        expected = chosen.state;
        follow = { ...chosen, state: chosen.state ?? state };
      }
    } else if (all?.action === 'create') {
      action = 'create';
    } else if (all?.action === 'update' && updatable && (!memory || remembered)) {
      // A row the check shown did not name (not in `targets`) is left out.
      action = 'update';
      expected = remembered?.state;
    }
    if (action === 'update') {
      const other = claimed.get(item);
      if (other !== undefined) {
        // Two rows, one line: the first row of the file updates it, the next one is left out.
        const ref = lineRef(item);
        bag.consistency.push({
          line: row.line,
          message: `Looks like ${ref}, already updated by line ${other}. Left out.`,
          code: 'BUDGET_FILE_LOOKALIKE_SAME_LINE',
          params: { line: row.line, other, ref },
        });
        action = 'ignore';
        follow = null;
      } else claimed.set(item, row.line);
    }
    if (follow) followed.push(follow);
    if (remembered || all?.action !== 'update' || action === 'update') kept[String(row.line)] = remembered ?? { item, state };
    if (action === 'update' && !live) wanted.push(item);
    decisions.set(row.line, {
      hint,
      ...(alike ? { reason: alike.reason } : {}),
      action,
      updatable,
      state,
      ...(action === 'update' && live ? { live, stale: expected !== undefined && expected !== state } : {}),
    });
  }
  // The choice for all rows, with the target of every row it covers: what the person saw. Given back
  // even when they chose nothing (`ignore`), so that the load and the card's approval keep it.
  if (Object.keys(kept).length > 0) followed.push({ kind: 'lookalikes', action: all?.action ?? 'ignore', targets: kept });
  return { decisions, followed, wanted };
}

function lookalikeEntry(row: InterpretedRow, look: LookalikeDecision): BudgetFileLookalike {
  const { hint, reason } = look;
  const outcome = look.action === 'ignore' ? 'ignored' : look.action === 'create' ? 'created' : 'updated';
  return {
    line: row.line,
    nature: hint.nature,
    name: textOf(row.fields.name),
    target: { item: hint.itemNumber, ref: lineRef(hint.itemNumber), name: hint.name, state: look.state },
    ...(reason ? { reason } : {}),
    outcome,
    updatable: look.updatable,
  };
}

/**
 * A row to create as the lookalike pass compares it: its nature and title, its supplier, company and
 * account matched as the check matches them (the person's undone matches and Kad's proposals
 * included), its currency and amounts. Null for a row that names a line, or has no nature or title.
 */
function lookalikeKeys(input: PreflightInput, row: InterpretedRow, bag: Bag, firstYear: number | null): RowKeys | null {
  if (row.itemNumber.kind !== 'blank') return null;
  const nature = row.nature.kind === 'value' ? row.nature.nature : row.nature.kind === 'absent' ? input.scope : null;
  const name = textOf(row.fields.name);
  if (!nature || !name) return null;
  const companyId = lookalikeCompany(input, row);
  const currency = row.fields.currency?.kind === 'value' ? row.fields.currency.text.trim().toUpperCase() : null;
  return {
    nature,
    name,
    supplier: lookalikeSupplier(input, row, bag),
    companyId,
    accountId: lookalikeAccount(input, row, companyId),
    currency,
    sums: rowSums(row),
    firstYear,
  };
}

/** The row's supplier as `resolveSupplier` finds it: an id, null for none, undefined for one it creates or refuses. */
function lookalikeSupplier(input: PreflightInput, row: InterpretedRow, bag: Bag): string | null | undefined {
  const name = opinion(row.fields.supplier_name ?? { kind: 'absent' });
  const erp = opinion(row.fields.supplier_erp_id ?? { kind: 'absent' });
  if (!name && !erp) return null;
  const suppliers = input.catalog.suppliers;
  if (erp) {
    const byErp = matchErp(suppliers, erp);
    return byErp.kind === 'one' ? byErp.row.id : undefined;
  }
  const key = cellKey('supplier_name', name!);
  const undone = bag.matching.unmatched.has(key);
  const proposal = bag.matching.proposals.get(key);
  if (proposal !== undefined && !undone && foldKey(proposal) !== foldKey(name!)) {
    const target = matchByName(suppliers, proposal, { beyondCase: false });
    if (target.kind === 'one' && isActiveAt(target.row.disabledAt)) return target.row.id;
  }
  const found = matchByName(suppliers, name!, { beyondCase: !undone });
  return found.kind === 'one' ? found.row.id : undefined;
}

/** The row's paying company as `resolveCompany` finds it for a new line; null when none is found. */
function lookalikeCompany(input: PreflightInput, row: InterpretedRow): string | null {
  const cell = row.fields.company_name ?? { kind: 'absent' as const };
  if (cell.kind === 'value') {
    const found = matchName(input.catalog.companies, cell.text);
    return found.kind === 'one' ? found.row.id : null;
  }
  if (cell.kind === 'clear') return null;
  const centre = row.fields.cost_center_code;
  if (centre?.kind === 'value') {
    const node = findCostCenter(input.catalog.costCenters, centre.text);
    if (node.kind === 'one' && node.center.companyId) return node.center.companyId;
  }
  return onlyCompany(input.catalog);
}

/** The row's account in its company's chart: undefined when the file gives none, null when it matches none. */
function lookalikeAccount(input: PreflightInput, row: InterpretedRow, companyId: string | null): string | null | undefined {
  const cell = row.fields.account_number ?? { kind: 'absent' as const };
  if (cell.kind !== 'value') return undefined;
  if (!companyId) return null;
  const chartId = input.catalog.companies.find((company) => company.id === companyId)?.coaId ?? input.catalog.defaultCoaId;
  const inChart = input.catalog.accounts.filter((account) => (account.coaId ?? null) === (chartId ?? null));
  const matched = matchCode(cell.text.replace(/\s+/g, ''), inChart.map((account) => account.number));
  if (matched.kind !== 'exact' && matched.kind !== 'stripped') return null;
  return inChart.find((account) => account.number === matched.code)?.id ?? null;
}

/**
 * The nature of a row: its `nature` cell; the route's when the file has no such column (a file
 * of before lot C1b); the line's own when the cell is blank on an existing line. Null when the
 * row says none that can be used (the error is recorded).
 */
function rowNature(
  input: PreflightInput,
  row: InterpretedRow,
  fail: Fail,
): BudgetNature | null {
  const cell = row.nature;
  if (cell.kind === 'absent') return input.scope;
  if (cell.kind === 'value') return cell.nature;
  if (cell.kind === 'invalid') {
    fail('nature', `nature '${cell.raw}' is not a value. Use opex or capex.`, 'CSV_ENUM_INVALID', { value: cell.raw, allowed: 'opex, capex' });
  } else if (cell.kind === 'clear') fail('nature', 'nature cannot be cleared.', 'BUDGET_FILE_CANNOT_BE_CLEARED');
  return null;
}

function resolveRow(
  input: PreflightInput,
  row: InterpretedRow,
  matched: StoredLine | null,
  newKeys: Map<string, number>,
  bag: Bag,
): void {
  const errors = [...row.errors];
  const fail: Fail = (column, message, code, params) => errors.push({ column, message, ...(code ? { code } : {}), ...(params ? { params } : {}) });
  const blocked = (column: string) => errors.some((error) => error.column === column);
  const flush = () => {
    for (const error of errors) bag.errors.push({ line: row.line, ...error });
  };
  let creating = false;
  let live: StoredLine | null = null;

  // Every check of a row follows its own nature, never the file's or the route's.
  let nature = rowNature(input, row, fail);
  if (row.itemNumber.kind === 'blank') {
    creating = true;
    if (row.token.kind === 'ok' || row.token.kind === 'bad') {
      fail('kanap_token', `kanap_token '${row.token.raw}' is set but item_number is empty. Leave the token empty to add a line.`,
        'BUDGET_FILE_TOKEN_WITHOUT_NUMBER');
    }
    if (row.nature.kind === 'blank') fail('nature', 'nature is required.', 'CSV_VALUE_REQUIRED');
  } else if (row.itemNumber.kind === 'invalid') {
    if (row.itemNumber.raw === '-') {
      fail('item_number', 'item_number cannot be cleared. Leave it empty to add a line.', 'BUDGET_FILE_NUMBER_CANNOT_BE_CLEARED');
    } else {
      fail('item_number', `item_number '${row.itemNumber.raw}' is not a line number.`, 'BUDGET_FILE_NOT_LINE_NUMBER', { value: row.itemNumber.raw });
    }
  } else if (!matched) {
    const ref = row.itemNumber.ref;
    if (row.token.kind === 'ok') {
      // Deleted, or out of the person's access: the same neutral answer (spec §4.2).
      fail('item_number', noLongerAvailableMessage(ref));
      bag.deleted.push({ line: row.line, itemNumber: ref });
    } else {
      fail('item_number', `item_number '${row.itemNumber.raw}' does not match a line.`, 'CSV_REFERENCE_NOT_FOUND', { value: row.itemNumber.raw });
    }
  } else if (nature && matched.nature !== nature) {
    // A line keeps its nature whatever the file says (changing the type is lot M, from the line).
    // Named as the file names it, with its BL number when that differs (`CPX-2 (BL-3)`).
    const own = lineRef(matched.itemNumber);
    const ref = row.itemNumber.ref === own ? own : `${row.itemNumber.ref} (${own})`;
    fail(row.nature.kind === 'absent' ? 'item_number' : 'nature', natureChangeMessage(ref, matched.nature, nature),
      'BUDGET_FILE_LINE_NATURE', { ref, nature: natureLabel(matched.nature), other: natureLabel(nature) });
    flush();
    return;
  } else {
    live = matched;
    nature = matched.nature;
  }
  if (row.token.kind === 'bad' && row.itemNumber.kind !== 'blank') fail('kanap_token', tokenError(row.token.raw), 'BUDGET_FILE_TOKEN_INVALID');
  if (!nature) {
    // No nature to check the row against: a blank cell on a line not found, or a cell that is not a nature.
    flush();
    return;
  }

  const changes: string[] = [];
  const draft = emptyDraft();
  const costCenter = resolveCostCenter(input, row, live, blocked, fail, bag, changes, draft);
  const company = resolveCompany(input, row, live, creating, costCenter, blocked, fail, bag, changes, draft);
  resolveAccount(input, nature, row, live, creating, company, blocked, fail, bag, changes, draft);
  const supplier = resolveSupplier(input, row, live, creating, blocked, fail, bag, changes, draft);
  resolveText(row, live, creating, blocked, fail, changes, draft);
  resolveEnums(row, live, creating, blocked, fail, changes, draft);
  resolveCurrency(input, row, live, creating, blocked, fail, changes, draft);
  resolveOwners(input, row, live, creating, blocked, fail, bag, changes, draft);
  resolveProject(input, row, live, creating, blocked, fail, bag, changes, draft);
  resolveAnalytics(input, nature, row, live, creating, blocked, fail, bag, changes, draft);
  resolveDates(input, row, live, creating, blocked, fail, changes, draft);
  resolveAmounts(input, nature, row, live, blocked, fail, changes, draft);
  // The load updates the line through its item service, which needs a paying company, or a cost
  // center that has one (`resolveItemWrite`). Amounts alone are written without it.
  const updatesLine = Object.keys(draft.body).length > 0 || draft.analytics.length > 0 || !!draft.newSupplier;
  if (live && updatesLine && !company.id && !costCenter?.companyId && !blocked('company_name') && !blocked('cost_center_code')) {
    fail('company_name', 'company_name is required.', 'CSV_VALUE_REQUIRED');
  }
  if (input.access && (creating || live)) checkAccess(input.access, row, live, creating, changes, draft, errors.length > 0, fail);

  if (creating && row.fields.name?.kind === 'value') {
    const hint = duplicateHint(nature, row, supplier, newKeys);
    if (hint) bag.duplicates.push({ line: row.line, ...hint });
    const key = duplicateKey(nature, row.fields.name.text, supplier);
    if (key && !newKeys.has(key)) newKeys.set(key, row.line);
  }

  if (live && row.token.kind === 'ok' && errors.length === row.errors.length) noteFreshness(row, live, bag);
  if (live) {
    bag.snapshot.push({
      id: live.id,
      itemNumber: live.itemNumber,
      rowVersion: live.rowVersion,
      years: live.versions.map((version) => ({ year: version.year, versionId: version.id, budgetRev: version.budgetRev })),
      ...(input.access ? { editable: input.access.editable.has(live.id) } : {}),
    });
  }

  flush();

  const failed = errors.length > 0;
  if (failed || !creating && !live) return;
  for (const warning of draft.calculationLines.values()) bag.calculationLines.push({ line: row.line, ...warning });
  if (creating || changes.length > 0) {
    bag.plans.push(toPlan(nature, row, live, creating, draft));
    checkConsistency(input, nature, row, live, draft, supplier.id, company.id, bag);
  }
  if (creating) {
    bag.created.push({ line: row.line, name: textOf(row.fields.name) || '(no name)' });
    bag.byNature.created[nature] += 1;
    return;
  }
  if (changes.length > 0 && live) {
    bag.updated.push({ line: row.line, itemNumber: lineRef(live.itemNumber), fields: changes });
    bag.byNature.updated[nature] += 1;
    return;
  }
  bag.unchanged += 1;
}

/**
 * A limited person's row (planning/data-scoped-access spec §4.2), with the rules of the line write
 * gate (`resolveItemWrite`) and its SQL functions:
 * - a stored line they read but may not modify passes unchanged, and is refused when the file
 *   changes it;
 * - a new line, or a new company or cost center, needs a place they may place a line in, owner or
 *   not;
 * - a change of owners must leave the line modifiable by them.
 * The place checks wait for a row without other errors: its values are then the ones written.
 */
function checkAccess(
  access: BudgetFileAccess,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  changes: string[],
  draft: LineDraft,
  hasErrors: boolean,
  fail: Fail,
): void {
  if (live && !access.editable.has(live.id)) {
    const ref = row.itemNumber.kind === 'number' ? row.itemNumber.ref : lineRef(live.itemNumber);
    if (changes.length > 0) fail('item_number', readOnlyLineMessage(ref));
    return;
  }
  if (hasErrors || (live && changes.length === 0)) return;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(draft.body, key);
  const value = (key: string, stored: string | null | undefined) => (has(key) ? (draft.body[key] as string | null) ?? null : stored ?? null);
  const place: LinePlace = {
    companyId: value('paying_company_id', live?.companyId),
    costCenterId: value('cost_center_id', live?.costCenterId),
    ownerItId: value('owner_it_id', live?.ownerItId),
    ownerBusinessId: value('owner_business_id', live?.ownerBusinessId),
  };
  const moved = creating || place.companyId !== (live?.companyId ?? null) || place.costCenterId !== (live?.costCenterId ?? null);
  const answer = placeAnswer(access, place);
  if (moved && !answer.placable) {
    const centre = row.fields.cost_center_code?.kind;
    fail(centre === 'value' || centre === 'clear' ? 'cost_center_code' : 'company_name', DATA_ACCESS_PLACEMENT_MESSAGE);
    return;
  }
  if (live && !answer.editable) fail(has('owner_it_id') ? 'owner_it_email' : 'owner_business_email', DATA_ACCESS_LEAVES_ACCESS_MESSAGE);
}

function toPlan(
  nature: BudgetNature,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  draft: LineDraft,
): BudgetFileLinePlan {
  const years = Array.from(new Set(draft.amounts.map((amount) => amount.year))).sort((a, b) => a - b);
  return {
    line: row.line,
    nature,
    creating,
    itemId: live?.id ?? null,
    itemNumber: live?.itemNumber ?? null,
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
  fail: Fail,
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
    fail('cost_center_code', `Cost center ${cell.text} was not found.`, 'CSV_REFERENCE_NOT_FOUND', { value: cell.text });
    miss(bag, 'costCenters', cell.text);
    return null;
  }
  if (node.kind === 'ambiguous') {
    fail('cost_center_code', `Cost center ${cell.text} matches more than one cost center.`, 'BUDGET_FILE_VALUE_AMBIGUOUS', { value: cell.text });
    return null;
  }
  if (node.center.kind !== 'cost_center') {
    fail('cost_center_code', `${node.center.code} is a group. Choose a cost center.`, 'BUDGET_FILE_COST_CENTER_GROUP', { value: node.center.code });
    return null;
  }
  if (!isActiveAt(node.center.disabledAt) && node.center.id !== (live?.costCenterId ?? null)) {
    fail('cost_center_code', `Cost center ${node.center.code} is disabled.`, 'BUDGET_FILE_DISABLED', { value: node.center.code });
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
  fail: Fail,
  bag: Bag,
  changes: string[],
  draft: LineDraft,
): CompanyOutcome {
  const cell = row.fields.company_name ?? { kind: 'absent' as const };
  if (blocked('company_name')) return { id: live?.companyId ?? null, known: false };
  if (cell.kind === 'clear') {
    fail('company_name', 'company_name is required.', 'CSV_VALUE_REQUIRED');
    return { id: null, known: false };
  }
  if (cell.kind === 'value') {
    const found = matchName(input.catalog.companies, cell.text);
    if (found.kind === 'none') {
      fail('company_name', `Company '${cell.text}' was not found.`, 'CSV_REFERENCE_NOT_FOUND', { value: cell.text });
      miss(bag, 'companies', cell.text);
      const companies = input.canReadCompanies ? input.catalog.companies.filter((company) => isActiveAt(company.disabledAt)) : [];
      noteCandidates(bag, 'company_name', null, cell.text, 'refused', row.line, companies);
      return { id: null, known: false };
    }
    if (found.kind === 'many') {
      fail('company_name', `Company '${cell.text}' matches more than one company.`, 'BUDGET_FILE_VALUE_AMBIGUOUS', { value: cell.text });
      return { id: null, known: false };
    }
    if (!isActiveAt(found.row.disabledAt) && found.row.id !== (live?.companyId ?? null)) {
      fail('company_name', `Company '${found.row.name}' is disabled.`, 'BUDGET_FILE_DISABLED', { value: found.row.name });
      return { id: null, known: false };
    }
    const changed = !!(live && found.row.id !== live.companyId);
    if (changed) changes.push('company_name');
    writeField(draft, creating, changed, 'paying_company_id', found.row.id);
    // Another company than the cost center's is accepted, as in the app; the check says so.
    if (costCenter?.companyId && costCenter.companyId !== found.row.id) {
      const center = input.catalog.costCenters.find((node) => node.id === costCenter.id);
      const owner = input.catalog.companies.find((company) => company.id === costCenter.companyId);
      if (center && owner) {
        bag.costCenterCompanies.push({
          line: row.line,
          code: 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY',
          costCenter: center.code,
          company: found.row.name,
          costCenterCompany: owner.name,
          message: `Cost center ${center.code} belongs to ${owner.name}. The line is paid by ${found.row.name}.`,
        });
      }
    }
    return { id: found.row.id, known: true };
  }
  if (creating) {
    // A new line without a company: the cost center's, else the workspace's only enabled company.
    const company = costCenter?.companyId ?? onlyCompany(input.catalog);
    if (!company) {
      fail('company_name', 'company_name is required.', 'CSV_VALUE_REQUIRED');
      return { id: null, known: false };
    }
    draft.body.paying_company_id = company;
    return { id: company, known: true };
  }
  return { id: live?.companyId ?? null, known: !!live?.companyId };
}

/** The workspace's enabled company when it has exactly one. */
function onlyCompany(catalog: BudgetCatalog): string | null {
  const enabled = catalog.companies.filter((company) => isActiveAt(company.disabledAt));
  return enabled.length === 1 ? enabled[0].id : null;
}

function resolveAccount(
  input: PreflightInput,
  nature: BudgetNature,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  company: CompanyOutcome,
  blocked: (column: string) => boolean,
  fail: Fail,
  bag: Bag,
  changes: string[],
  draft: LineDraft,
): void {
  const cell = row.fields.account_number ?? { kind: 'absent' as const };
  if (blocked('account_number')) return;
  if (cell.kind === 'clear') {
    fail('account_number', 'account_number is required.', 'CSV_VALUE_REQUIRED');
    return;
  }
  if (cell.kind === 'absent' || cell.kind === 'blank') {
    if (creating) fail('account_number', 'account_number is required.', 'CSV_VALUE_REQUIRED');
    return;
  }
  const digits = cell.text.replace(/\s+/g, '');
  if (!/^\d+$/.test(digits)) {
    fail('account_number', 'account_number must contain digits only.', 'CSV_WHOLE_NUMBER_INVALID', { value: cell.text });
    return;
  }
  if (!company.known || !company.id) return;
  const companyRow = input.catalog.companies.find((item) => item.id === company.id);
  const chartId = companyRow?.coaId ?? input.catalog.defaultCoaId;
  const inChart = input.catalog.accounts.filter((account) => (account.coaId ?? null) === (chartId ?? null));
  const matched = matchCode(digits, inChart.map((account) => account.number));
  if (matched.kind === 'ambiguous') {
    fail('account_number', `account_number '${digits}' matches more than one account.`, 'BUDGET_FILE_VALUE_AMBIGUOUS', { value: digits });
    return;
  }
  if (matched.kind !== 'exact' && matched.kind !== 'stripped') {
    fail('account_number', `Account ${digits} was not found in the company's chart of accounts.`, 'BUDGET_FILE_ACCOUNT_NOT_IN_CHART', { value: digits });
    miss(bag, 'accounts', digits);
    return;
  }
  const account = inChart.find((item) => item.number === matched.code);
  if (!account) return;
  if (!isActiveAt(account.disabledAt) && account.id !== (live?.accountId ?? null)) {
    fail('account_number', `Account ${account.number} is disabled.`, 'BUDGET_FILE_DISABLED', { value: account.number });
    return;
  }
  // An account kept for the other type of line than this row's: refused on a new line or a new
  // account; the line's current account stays, as `resolveItemWrite` lets it.
  if (account.nature && account.nature !== nature && account.id !== (live?.accountId ?? null)) {
    fail('account_number', `Account ${account.number} is for ${natureLabel(account.nature)} lines only.`,
      'BUDGET_FILE_FOR_NATURE_ONLY', { value: account.number, nature: natureLabel(account.nature) });
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
  fail: Fail,
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
  const byName = nameText ? findListed(bag, 'supplier_name', null, nameText, row.line, input.catalog.suppliers) : null;
  if (byErp?.kind === 'many') {
    fail('supplier_erp_id', `Several suppliers share ERP id '${erpText}'.`, 'BUDGET_FILE_VALUE_AMBIGUOUS', { value: erpText });
    return { id: null, createKey: null };
  }
  if (byName?.kind === 'many' && !erpText) {
    fail('supplier_name', `Supplier '${nameText}' matches more than one supplier.`, 'BUDGET_FILE_VALUE_AMBIGUOUS', { value: nameText });
    return { id: null, createKey: null };
  }
  if (byErp?.kind === 'one' && byName?.kind === 'one' && byErp.row.id !== byName.row.id) {
    fail('supplier_name', `supplier_name '${nameText}' and supplier_erp_id '${erpText}' point to different suppliers.`,
      'BUDGET_FILE_SUPPLIER_CONFLICT', { name: nameText, erp: erpText });
    return { id: null, createKey: null };
  }
  if (byErp?.kind === 'one') {
    const supplier = byErp.row;
    if (nameText && supplier.name.trim().toLowerCase() !== nameText.toLowerCase()) {
      bag.supplierNames.push({
        line: row.line,
        message: `supplier_name '${nameText}' does not match the supplier for ERP id '${erpText}' (${supplier.name}).`,
        code: 'BUDGET_FILE_SUPPLIER_NAME_DIFFERS',
        params: { name: nameText, erp: erpText, supplier: supplier.name },
      });
    }
    if (!isActiveAt(supplier.disabledAt) && supplier.id !== (live?.supplierId ?? null)) {
      fail('supplier_name', `Supplier '${supplier.name}' is disabled.`, 'BUDGET_FILE_DISABLED', { value: supplier.name });
      return { id: null, createKey: null };
    }
    const changed = !!(live && supplier.id !== live.supplierId);
    if (changed) changes.push('supplier');
    writeField(draft, creating, changed, 'supplier_id', supplier.id);
    return { id: supplier.id, createKey: null };
  }
  if (erpText && byName?.kind === 'one') {
    fail('supplier_erp_id', `ERP id '${erpText}' is unknown and '${byName.row.name}' is already a supplier. Add the ERP id in Master data > Suppliers or leave it empty.`,
      'BUDGET_FILE_SUPPLIER_ERP_UNKNOWN', { erp: erpText, name: byName.row.name });
    return { id: null, createKey: null };
  }
  if (!erpText && byName?.kind === 'one') {
    const supplier = byName.row;
    // Listed before the disabled check, as a dimension value's: the person may undo a match to a disabled supplier.
    noteMatch(bag, row.line, byName);
    if (!isActiveAt(supplier.disabledAt) && supplier.id !== (live?.supplierId ?? null)) {
      fail('supplier_name', `Supplier '${supplier.name}' is disabled.`, 'BUDGET_FILE_DISABLED', { value: supplier.name });
      return { id: null, createKey: null };
    }
    const changed = !!(live && supplier.id !== live.supplierId);
    if (changed) changes.push('supplier');
    writeField(draft, creating, changed, 'supplier_id', supplier.id);
    return { id: supplier.id, createKey: null };
  }
  if (!nameText) {
    fail('supplier_erp_id', `supplier_erp_id '${erpText}' does not match a supplier.`, 'CSV_REFERENCE_NOT_FOUND', { value: erpText });
    return { id: null, createKey: null };
  }
  // Two spellings of one unknown name (`Societe X`, `Société X`) are one supplier: the first one names it.
  const createKey = `${accentFreeKey(nameText)}|${accentFreeKey(erpText)}`;
  const enabledSuppliers = input.canReadSuppliers ? input.catalog.suppliers.filter((supplier) => isActiveAt(supplier.disabledAt)) : [];
  if (input.createSuppliers && input.canCreateSuppliers) {
    const created = bag.suppliers.get(createKey) ?? { name: nameText, erpId: erpText || null };
    bag.suppliers.set(createKey, created);
    changes.push('supplier');
    draft.newSupplier = created;
    // One entry per supplier created, under the name it gets.
    noteCandidates(bag, 'supplier_name', null, created.name, 'create', row.line, enabledSuppliers, createKey);
    return { id: null, createKey };
  }
  fail('supplier_name', `Supplier '${nameText}' does not exist.`, 'CSV_REFERENCE_NOT_FOUND', { value: nameText });
  if (!bag.suppliers.has(createKey)) bag.suppliers.set(createKey, { name: nameText, erpId: erpText || null });
  noteCandidates(bag, 'supplier_name', null, nameText, 'refused', row.line, enabledSuppliers);
  return { id: null, createKey: null };
}

/** undefined: the column says nothing. null: `-`. string: a value. */
function opinion(cell: FieldCell): string | null | undefined {
  if (cell.kind === 'absent' || cell.kind === 'blank') return undefined;
  if (cell.kind === 'clear') return null;
  return cell.text.trim();
}

/**
 * The texts: `name` is the line's `product_name` for both natures, `description` the description
 * of the line. Both natures use the same normalization and writable columns.
 */
function resolveText(
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: Fail,
  changes: string[],
  draft: LineDraft,
): void {
  const fields: Array<{ id: string; stored: string; required: boolean }> = [
    { id: 'name', stored: storedText(live?.name), required: true },
    { id: 'description', stored: storedText(live?.description), required: false },
    { id: 'notes', stored: storedText(live?.notes), required: false },
  ];
  for (const field of fields) {
    const cell = row.fields[field.id] ?? { kind: 'absent' as const };
    if (blocked(field.id)) continue;
    const key = field.id === 'name' ? 'product_name' : field.id;
    if (cell.kind === 'clear') {
      if (field.required || !CLEARABLE.has(field.id)) fail(field.id, `${field.id} is required.`, 'CSV_VALUE_REQUIRED');
      else if (field.stored) {
        changes.push(field.id);
        draft.body[key] = null;
      }
      continue;
    }
    if (cell.kind === 'absent' || cell.kind === 'blank') {
      if (creating && field.required) fail(field.id, `${field.id} is required.`, 'CSV_VALUE_REQUIRED');
      continue;
    }
    const changed = field.stored !== cell.text;
    if (changed) changes.push(field.id);
    writeField(draft, creating, changed, key, cell.text);
  }
}

function resolveEnums(
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: Fail,
  changes: string[],
  draft: LineDraft,
): void {
  // The PP&E type, investment type and priority of a CAPEX line are dimension values since lot C1
  // (`resolveAnalytics`, their `analytics:<code>` columns).
  const fields: Array<{ id: string; stored: string | null; required: boolean }> = [
    { id: 'run_build', stored: live?.runBuild ?? null, required: false },
  ];
  for (const field of fields) {
    const cell = row.fields[field.id] ?? { kind: 'absent' as const };
    if (blocked(field.id)) continue;
    const allowed = ENUMS[field.id];
    if (cell.kind === 'clear') {
      if (field.required) fail(field.id, `${field.id} is required.`, 'CSV_VALUE_REQUIRED');
      else if (field.stored) {
        changes.push(field.id);
        draft.body[field.id] = null;
      }
      continue;
    }
    if (cell.kind === 'absent' || cell.kind === 'blank') {
      if (creating && field.required) fail(field.id, `${field.id} is required.`, 'CSV_VALUE_REQUIRED');
      continue;
    }
    const value = cell.text.toLowerCase();
    if (!allowed.includes(value)) {
      const list = allowed.length <= 2 ? allowed.join(' or ') : allowed.join(', ');
      fail(field.id, `${field.id} '${cell.text}' is not a value. Use ${list}.`, 'CSV_ENUM_INVALID', { value: cell.text, allowed: allowed.join(', ') });
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
  fail: Fail,
  changes: string[],
  draft: LineDraft,
): void {
  const cell = row.fields.currency ?? { kind: 'absent' as const };
  if (blocked('currency')) return;
  if (cell.kind === 'clear') {
    fail('currency', 'currency is required.', 'CSV_VALUE_REQUIRED');
    return;
  }
  if (cell.kind === 'absent' || cell.kind === 'blank') {
    if (creating) fail('currency', 'currency is required.', 'CSV_VALUE_REQUIRED');
    return;
  }
  if (!/^[A-Za-z]{3}$/.test(cell.text.trim())) {
    fail('currency', 'currency must be 3 letters.', 'CSV_CURRENCY_INVALID', { value: cell.text });
    return;
  }
  const code = cell.text.trim().toUpperCase();
  const allowed = input.catalog.allowedCurrencies;
  if (allowed && allowed.length > 0 && !allowed.includes(code)) {
    fail('currency', `currency '${code}' is not allowed.`, 'BUDGET_FILE_CURRENCY_NOT_ALLOWED', { value: code });
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
  fail: Fail,
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
      fail(owner.id, `${owner.id} is invalid.`, 'CSV_EMAIL_INVALID', { value: cell.text });
      continue;
    }
    const user = findUser(input.catalog.users, cell.text);
    if (!user) {
      fail(owner.id, `${owner.id} '${cell.text}' was not found.`, 'CSV_REFERENCE_NOT_FOUND', { value: cell.text });
      miss(bag, 'users', cell.text);
      continue;
    }
    const current = (owner.stored ?? '').toLowerCase() === user.email.toLowerCase();
    if (user.status !== 'enabled' && !current) {
      fail(owner.id, `${owner.id} '${cell.text}' is not an active user.`, 'BUDGET_FILE_USER_NOT_ACTIVE', { value: cell.text });
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
  fail: Fail,
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
    fail('project', `project '${cell.text}' is not a project number.`, 'BUDGET_FILE_NOT_PROJECT_NUMBER', { value: cell.text });
    return;
  }
  const project = input.catalog.projects.find((item) => item.itemNumber === parsed);
  if (!project) {
    fail('project', `project '${cell.text}' was not found.`, 'CSV_REFERENCE_NOT_FOUND', { value: cell.text });
    miss(bag, 'projects', cell.text.trim());
    return;
  }
  const changed = live?.projectNumber !== parsed;
  if (changed) changes.push('project');
  writeField(draft, creating, changed, 'project_id', project.id);
}

function resolveAnalytics(
  input: PreflightInput,
  nature: BudgetNature,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: Fail,
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
    if (dimension?.appliesTo && dimension.appliesTo !== nature) {
      // A dimension of the other nature: its column stays empty on this row (`-` too).
      fail(column, notApplicableDimensionMessage({ name: dimension.axisName, applies_to: dimension.appliesTo }),
        'CSV_DIMENSION_APPLIES_TO', { name: dimension.axisName || code, nature: natureLabel(dimension.appliesTo) });
      continue;
    }
    if (cell.kind === 'clear') {
      if (current) {
        changes.push(column);
        draft.analytics.push({ code, categoryId: null, createName: null });
      }
      continue;
    }
    if (!dimension) continue;
    const table = translationTableOf(dimension);
    const found = findListed(bag, column, dimension.axisName, cell.text, row.line, dimension.values,
      (text, values) => translatedValues(table, text, values));
    if (found.kind === 'many') {
      fail(column, `Value '${cell.text}' matches more than one value of ${code}.`, 'BUDGET_FILE_VALUE_AMBIGUOUS', { value: cell.text });
      continue;
    }
    if (found.kind === 'one') {
      const value = found.row;
      noteMatch(bag, row.line, found);
      const same = (current ?? '').toLowerCase() === value.name.toLowerCase();
      if (!isActiveAt(value.disabledAt) && !same) {
        fail(column, `${value.name} is disabled. Pick an enabled value.`, 'BUDGET_FILE_DISABLED', { value: value.name });
        continue;
      }
      if (value.appliesTo && value.appliesTo !== nature && !same) {
        fail(column, `${value.name} is for ${value.appliesTo.toUpperCase()} lines only. Pick a value for ${natureLabel(nature)} lines.`,
          'BUDGET_FILE_FOR_NATURE_ONLY', { value: value.name, nature: value.appliesTo.toUpperCase() });
        continue;
      }
      if (!same) changes.push(column);
      if (creating || !same) draft.analytics.push({ code, categoryId: value.id, createName: null });
      continue;
    }
    try {
      const name = normalizeAnalyticsName(cell.text);
      const enabledValues = dimension.values.filter((value) => isActiveAt(value.disabledAt));
      if (input.access && !dimension.openValues) {
        // A closed list gets values from the dimension page only (spec §3.5, §4.2).
        const refused = bag.refusedDimensions.get(code) ?? new Map<string, string>();
        if (!refused.has(accentFreeKey(name))) refused.set(accentFreeKey(name), name);
        bag.refusedDimensions.set(code, refused);
        fail(column, closedDimensionValueMessage(name, code), 'BUDGET_FILE_DIMENSION_CLOSED', { value: name, name: dimension.axisName || code });
        noteCandidates(bag, column, dimension.axisName, cell.text, 'refused', row.line, enabledValues);
        continue;
      }
      // Two spellings of one new value (`Revue privée`, `Revue privee`) are one value: the first one names it.
      const listed = bag.dimensions.get(code) ?? new Map<string, string>();
      const createName = listed.get(accentFreeKey(name)) ?? name;
      listed.set(accentFreeKey(name), createName);
      bag.dimensions.set(code, listed);
      changes.push(column);
      draft.analytics.push({ code, categoryId: null, createName });
      // One entry per value created, under the name it gets.
      noteCandidates(bag, column, dimension.axisName, createName, 'create', row.line, enabledValues, accentFreeKey(name));
    } catch (err) {
      const refusal = analyticsMessage(err, dimension.axisName || code, cell.text);
      fail(column, refusal.message, refusal.code, refusal.params);
    }
  }
  // Required dimensions of the row's nature, the ones whose column the file leaves out included.
  // The catalog holds the enabled dimensions of both natures. A new line needs a value (one the
  // load creates counts); an existing line may not clear one it holds, and is left alone otherwise.
  for (const dimension of input.catalog.dimensions) {
    if (!dimension.required || (dimension.appliesTo && dimension.appliesTo !== nature)) continue;
    const column = `analytics:${dimension.code}`;
    if (blocked(column)) continue;
    const cell = row.analytics[dimension.code] ?? { kind: 'absent' as const };
    const refused = creating ? cell.kind !== 'value' : cell.kind === 'clear' && !!live?.analytics[dimension.code];
    if (refused) {
      fail(column, requiredDimensionMessage({ name: dimension.axisName }), 'BUDGET_FILE_DIMENSION_REQUIRED', { name: dimension.axisName || dimension.code });
    }
  }
}

function resolveDates(
  input: PreflightInput,
  row: InterpretedRow,
  live: StoredLine | null,
  creating: boolean,
  blocked: (column: string) => boolean,
  fail: Fail,
  changes: string[],
  draft: LineDraft,
): void {
  const start = row.fields.effective_start ?? { kind: 'absent' as const };
  if (!blocked('effective_start')) {
    if (start.kind === 'clear') fail('effective_start', 'effective_start cannot be cleared.', 'BUDGET_FILE_CANNOT_BE_CLEARED');
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
  // A day is noon UTC; the stored instant's own day keeps its time of day (the export writes the day only).
  const instant = parsed.kind === 'instant'
    ? parsed.iso
    : keepStoredEndOfValidity(live?.endOfValidity ?? null, endOfValidityFromDate(parsed.isoDate).toISOString());
  const stored = live?.endOfValidity ? new Date(live.endOfValidity).toISOString() : null;
  const changed = stored !== instant;
  if (changed) changes.push('end_of_validity');
  writeField(draft, creating, changed, 'disabled_at', instant);
}

function resolveAmounts(
  input: PreflightInput,
  nature: BudgetNature,
  row: InterpretedRow,
  live: StoredLine | null,
  blocked: (column: string) => boolean,
  fail: Fail,
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
    // The freeze of the row's nature only: a column frozen for the other nature does not stop it.
    const frozenKey = `${nature}:${amount.year}:${MEASURE_FREEZE_COLUMN[amount.measure]}`;
    if (input.catalog.frozen.includes(frozenKey)) {
      const label = input.labels[amount.column] || amount.column;
      fail(amount.id, `${label} for ${amount.year} is frozen.`, 'BUDGET_FILE_FROZEN', { label, year: amount.year });
      continue;
    }
    const when = amount.month == null ? String(amount.year) : `${amount.year}-${String(amount.month).padStart(2, '0')}`;
    changes.push(`${amount.column} ${when}`);
    draft.amounts.push({ year: amount.year, measure: amount.measure, month: amount.month, cents: amount.cell.cents });
    if (live) noteCalculationLines(input, live, version, amount, draft);
  }
}

/**
 * A changed total or month on a column that follows its calculation lines (`computed` with lines):
 * the load writes the file's amounts and the lines stay as a reference, so the person is told once
 * per column and year. A column whose lines are already a reference is not.
 */
function noteCalculationLines(
  input: PreflightInput,
  live: StoredLine,
  version: StoredVersion | undefined,
  amount: InterpretedRow['amounts'][number],
  draft: LineDraft,
): void {
  const round = version?.rounds?.[amount.measure];
  if (!round || round.method !== 'computed' || round.lineCount === 0 || round.linesTotal == null) return;
  const key = `${amount.year}:${amount.measure}`;
  if (draft.calculationLines.has(key)) return;
  const item = lineRef(live.itemNumber);
  const total = formatCentsFixed(round.linesTotal);
  const column = columnOfMeasure(amount.measure);
  draft.calculationLines.set(key, {
    item,
    column,
    year: amount.year,
    count: round.lineCount,
    total,
    message: calculationLinesMessage(item, input.labels[column] || column, amount.year, round.lineCount, total),
  });
}

/**
 * `BL-83 · Revision 2026: 3 calculation lines (281 280) will no longer drive these amounts.` The total
 * is written as the app writes amounts: whole units, a space between thousands.
 */
function calculationLinesMessage(item: string, label: string, year: number, count: number, total: string): string {
  const shown = Math.round(Number(total)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const lines = count === 1 ? '1 calculation line' : `${count} calculation lines`;
  return `${item} · ${label} ${year}: ${lines} (${shown}) will no longer drive these amounts.`;
}

/** Cents as the app writes amounts: whole units, a space between thousands. */
function wholeUnits(cents: bigint): string {
  return Math.round(Number(formatCentsFixed(cents))).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * The consistency checks of a line the file creates or updates (lot I2 of 26.11.9), warnings only
 * (P3): an amount ten times above or below the line the row looks like, else the median of its
 * supplier's lines (same nature, currency, year and measure, three at least); a start after the last
 * year of the row's amounts, or an end before the first; a currency other than the paying company's.
 * Zeros and blank amounts are left out. One amount warning per row, the first.
 */
function checkConsistency(
  input: PreflightInput,
  nature: BudgetNature,
  row: InterpretedRow,
  live: StoredLine | null,
  draft: LineDraft,
  supplierId: string | null,
  companyId: string | null,
  bag: Bag,
): void {
  const warn = (sentence: BudgetFileSentence) => bag.consistency.push({ line: row.line, ...sentence });
  const sums = rowSums(row);
  const currency = String(draft.body.currency ?? live?.currency ?? '').trim().toUpperCase();
  const look = bag.lookTargets.get(row.line);
  for (const [key, cents] of sums) {
    const [year, measure] = key.split('|');
    const column = columnOfMeasure(measure as AmountMeasure);
    const label = input.labels[column] || column;
    const amount = wholeUnits(cents);
    if (look) {
      const other = (look.currency ?? '') === currency ? bag.index.totalOf(look, key) : undefined;
      if (other === undefined || !unusual(cents, other)) continue;
      const ref = lineRef(look.itemNumber);
      warn({
        message: `${label} ${year} at ${amount}, against ${wholeUnits(other)} on ${ref}.`,
        code: 'BUDGET_FILE_AMOUNT_FAR_FROM_LINE', params: { label, year: Number(year), amount, other: wholeUnits(other), ref },
      });
      break;
    }
    if (!supplierId || !currency) break;
    const median = bag.index.median(nature, supplierId, currency, key, live?.id ?? null);
    if (!median || !unusual(cents, median.cents)) continue;
    const supplier = input.catalog.suppliers.find((item) => item.id === supplierId)?.name ?? '';
    warn({
      message: `${label} ${year} at ${amount}, against a median of ${wholeUnits(median.cents)} on ${median.count} lines of ${supplier}.`,
      code: 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER',
      params: { label, year: Number(year), amount, median: wholeUnits(median.cents), count: median.count, supplier },
    });
    break;
  }
  const years = [...sums.keys()].map((key) => Number(key.split('|')[0]));
  if (years.length > 0) {
    const first = Math.min(...years);
    const last = Math.max(...years);
    const start = typeof draft.body.effective_start === 'string' ? draft.body.effective_start : live?.effectiveStart ?? '';
    if (start && Number(start.slice(0, 4)) > last) {
      warn({ message: `The line starts on ${start}, after its last amounts (${last}).`, code: 'BUDGET_FILE_START_AFTER_AMOUNTS', params: { start, year: last } });
    }
    const endValue = Object.prototype.hasOwnProperty.call(draft.body, 'disabled_at') ? draft.body.disabled_at : live?.endOfValidity;
    const end = typeof endValue === 'string' ? endValue.slice(0, 10) : '';
    if (end && Number(end.slice(0, 4)) < first) {
      warn({ message: `The line ends on ${end}, before its first amounts (${first}).`, code: 'BUDGET_FILE_END_BEFORE_AMOUNTS', params: { end, year: first } });
    }
  }
  const cell = row.fields.currency;
  const company = companyId ? input.catalog.companies.find((item) => item.id === companyId) : undefined;
  if (cell?.kind === 'value' && company?.baseCurrency) {
    const code = cell.text.trim().toUpperCase();
    if (code !== company.baseCurrency) {
      warn({
        message: `${code} is not the currency of ${company.name} (${company.baseCurrency}).`,
        code: 'BUDGET_FILE_CURRENCY_NOT_COMPANY', params: { currency: code, company: company.name, base: company.baseCurrency },
      });
    }
  }
}

function noteFreshness(row: InterpretedRow, live: StoredLine, bag: Bag): void {
  if (row.token.kind !== 'ok') return;
  const rowMismatch = row.token.rowVersion !== live.rowVersion;
  const years = row.token.years.filter((year) => {
    const version = live.versions.find((item) => item.year === year.year);
    return !version || version.budgetRev !== year.rev;
  }).map((year) => year.year);
  if (!rowMismatch && years.length === 0) return;
  const ref = lineRef(live.itemNumber);
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

/**
 * A new line that looks like an earlier row of the file, of its nature: OPEX by name and supplier,
 * CAPEX by name. A warning: the row is created. A row that looks like a stored line is decided before
 * (`decideLookalikes`).
 */
function duplicateHint(
  nature: BudgetNature,
  row: InterpretedRow,
  supplier: { id: string | null; createKey: string | null },
  newKeys: Map<string, number>,
): BudgetFileSentence | null {
  const name = textOf(row.fields.name);
  if (!name) return null;
  const key = duplicateKey(nature, name, supplier);
  if (!key) return null;
  const earlier = newKeys.get(key);
  if (earlier !== undefined) {
    return { message: `row ${row.line} looks like row ${earlier}`, code: 'BUDGET_FILE_LOOKS_LIKE_ROW', params: { line: row.line, row: earlier } };
  }
  return null;
}

function duplicateKey(nature: BudgetNature, name: string, supplier: { id: string | null; createKey: string | null }): string | null {
  const base = name.trim().toLowerCase();
  if (!base) return null;
  if (nature === 'capex') return `capex:name:${base}`;
  return `opex:name:${base}|${supplier.id ?? supplier.createKey ?? 'none'}`;
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

/** A list entry the matching reads: a supplier or a dimension value. */
type Listed = { name: string; disabledAt: string | null };

/** A match of `findListed`, with the proposal of Kad it came from. */
type ListedMatch<T> = NameMatch<T> & { column?: string; dimensionName?: string | null; value?: string; byModel?: boolean };

/**
 * The supplier or dimension value of `rows` a value of the file stands for. Kad's proposal for the
 * value comes first, accepted when it names an enabled value of the list (by its name, case aside);
 * else it is refused, and the value is matched as the file writes it. A match the person undid goes
 * no further than case. Every match beyond case is listed once the row uses it (`noteMatch`).
 */
function findListed<T extends Listed>(
  bag: Bag,
  column: string,
  dimensionName: string | null,
  cell: string,
  line: number,
  rows: readonly T[],
  translate?: (cell: string, rows: readonly T[]) => T[],
): ListedMatch<T> {
  const key = cellKey(column, cell);
  const state = bag.matching;
  const undone = state.unmatched.has(key);
  const proposal = state.proposals.get(key);
  if (proposal !== undefined && foldKey(proposal) !== foldKey(cell)) {
    if (undone) {
      state.applied.add(key);
    } else {
      const target = matchByName(rows, proposal, { beyondCase: false });
      if (target.kind === 'one' && isActiveAt(target.row.disabledAt)) {
        return { kind: 'one', row: target.row, how: 'exact', column, dimensionName, value: cell, byModel: true };
      }
      const refused = state.refused.get(key) ?? {
        column, name: dimensionName, value: cell.trim(),
        target: target.kind === 'one' ? target.row.name : proposal,
        reason: target.kind === 'one' ? 'disabled' as const : 'missing' as const,
        lines: [], count: 0,
      };
      addLine(refused, line);
      state.refused.set(key, refused);
    }
  }
  const found = matchByName(rows, cell, { beyondCase: !undone, translate });
  if (undone && found.kind !== 'one') {
    const would = matchByName(rows, cell, { beyondCase: true, translate });
    if (would.kind === 'one' && (would.how === 'accents' || would.how === 'translation')) state.applied.add(key);
  }
  return { ...found, column, dimensionName, value: cell };
}

/** Lists a match beyond case the row uses, with its line. */
function noteMatch<T extends Listed>(bag: Bag, line: number, found: ListedMatch<T>): void {
  if (found.kind !== 'one' || !found.column || found.value === undefined) return;
  const origin = found.byModel ? 'model' : 'server';
  if (origin === 'server' && found.how !== 'accents' && found.how !== 'translation') return;
  const key = cellKey(found.column, found.value);
  const entry = bag.matching.matches.get(key) ?? {
    column: found.column,
    name: found.dimensionName ?? null,
    value: found.value.trim(),
    target: found.row.name,
    origin,
    reason: found.byModel ? 'model' as const : found.how as 'accents' | 'translation',
    lines: [],
    count: 0,
    undoable: true as const,
  };
  addLine(entry, line);
  bag.matching.matches.set(key, entry);
}

/**
 * A value of the file nothing matched: the load creates it, or the check refuses it. Its closest
 * names in the workspace's list (`rows`: a reference list, never other budget lines, and empty for a
 * list the person may not read), once per value. A value created is keyed as its creation is
 * (`created`: two spellings, one value created, one entry), so that the entries of outcome create are
 * the values the load creates.
 */
function noteCandidates(
  bag: Bag,
  column: string,
  dimensionName: string | null,
  value: string,
  outcome: 'create' | 'refused',
  line: number,
  rows: ReadonlyArray<{ name: string }>,
  created?: string,
): void {
  const key = created === undefined ? cellKey(column, value) : `${column}\u0000create\u0000${created}`;
  const entry = bag.matching.candidates.get(key) ?? {
    column, name: dimensionName, value: value.trim(), outcome, lines: [], count: 0,
    candidates: closestNames(value, rows.map((row) => row.name)),
  };
  addLine(entry, line);
  bag.matching.candidates.set(key, entry);
}

function addLine(entry: { lines: number[]; count: number }, line: number): void {
  entry.count += 1;
  if (entry.lines.length < MATCH_LINE_LIMIT && !entry.lines.includes(line)) entry.lines.push(line);
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

/**
 * A new dimension value the analytics rules refuse: the English sentence, and the code and values the
 * dialog and Kad's card translate. `name` is the dimension's name, `value` the cell.
 */
function analyticsMessage(err: unknown, name: string, value: string): BudgetFileSentence {
  const response = (err as { getResponse?: () => unknown }).getResponse?.();
  const message = response && typeof response === 'object' && 'message' in response
    ? String((response as { message: unknown }).message)
    : (err as Error).message || 'The dimension value is not valid.';
  switch (message) {
    case ANALYTICS_NAME_REQUIRED_MESSAGE:
      return { message, code: 'CSV_VALUE_REQUIRED' };
    case ANALYTICS_NAME_TOO_LONG_MESSAGE:
      return { message, code: 'BUDGET_FILE_DIMENSION_VALUE_TOO_LONG', params: { name, max: ANALYTICS_NAME_MAX } };
    case ANALYTICS_NAME_CHARACTERS_MESSAGE:
      return { message, code: 'BUDGET_FILE_DIMENSION_VALUE_CHARACTERS', params: { name } };
    default:
      return { message, code: 'BUDGET_FILE_DIMENSION_VALUE_INVALID', params: { name, value } };
  }
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

function emptyBag(input: PreflightInput): Bag {
  const unmatched = new Map<string, BudgetFileChoice>();
  for (const choice of input.matching?.choices ?? []) {
    if (choice.kind === 'unmatch') unmatched.set(cellKey(choice.column, choice.value), choice);
  }
  const proposals = new Map<string, string>();
  for (const [column, values] of Object.entries(input.matching?.proposals ?? {})) {
    for (const [from, to] of Object.entries(values)) {
      if (from.trim() !== '' && String(to).trim() !== '') proposals.set(cellKey(column, from), String(to).trim());
    }
  }
  return {
    errors: [],
    matching: { unmatched, proposals, matches: new Map(), refused: new Map(), candidates: new Map(), applied: new Set() },
    missing: new Map(),
    suppliers: new Map(),
    dimensions: new Map(),
    refusedDimensions: new Map(),
    duplicates: [],
    supplierNames: [],
    costCenterCompanies: [],
    calculationLines: [],
    consistency: [],
    index: new LineIndex(input.names),
    lookalikes: [],
    lookTargets: new Map(),
    lookalikeChoices: [],
    deleted: [],
    changed: [],
    snapshot: [],
    created: [],
    updated: [],
    byNature: { created: { opex: 0, capex: 0 }, updated: { opex: 0, capex: 0 } },
    unchanged: 0,
    plans: [],
  };
}

function finish(input: PreflightInput, errors: Bag['errors'], bag: Bag, supplierNote: string | null, read: boolean): BudgetFileReport {
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
      byNature: bag.byNature,
    },
    changedSinceExport: bag.changed.slice(0, PREFLIGHT_LIST_LIMIT),
    changedSinceExportCount: bag.changed.length,
    warnings: {
      duplicates: bag.duplicates.slice(0, PREFLIGHT_LIST_LIMIT),
      duplicatesCount: bag.duplicates.length,
      ignoredColumns: input.read.ignoredColumns,
      supplierNames: bag.supplierNames.slice(0, PREFLIGHT_LIST_LIMIT),
      costCenterCompanies: bag.costCenterCompanies.slice(0, PREFLIGHT_LIST_LIMIT),
      calculationLines: bag.calculationLines.slice(0, PREFLIGHT_LIST_LIMIT),
      calculationLinesCount: bag.calculationLines.length,
      consistency: bag.consistency.slice(0, PREFLIGHT_LIST_LIMIT),
      consistencyCount: bag.consistency.length,
    },
    ...(read ? { lookalikes: lookalikesOf(bag) } : {}),
    creates: {
      dimensionValues: namesByDimension(input, bag.dimensions),
      suppliers: input.createSuppliers && input.canCreateSuppliers
        ? [...bag.suppliers.values()].slice(0, PREFLIGHT_LIST_LIMIT)
        : [],
      supplierCount: input.createSuppliers && input.canCreateSuppliers ? bag.suppliers.size : 0,
      dimensionValueCount: [...bag.dimensions.values()].reduce((sum, names) => sum + names.size, 0),
      ...(input.access ? { refusedDimensionValues: namesByDimension(input, bag.refusedDimensions) } : {}),
    },
    supplierMessage: supplierNote,
    ...(read ? { matching: matchingOf(input, bag) } : {}),
    snapshot: { lines: bag.snapshot },
    ...((input.read.sheetCount ?? 0) > 1 ? { firstSheetOnly: input.read.sheetName ?? '' } : {}),
    ...(input.access ? { dataAccessLimited: true as const } : {}),
  };
}

/** The rows that look like a stored line: the first ones, and the counts of what the check does with them. */
function lookalikesOf(bag: Bag): NonNullable<BudgetFileReport['lookalikes']> {
  const count = (outcome: BudgetFileLookalike['outcome']) => bag.lookalikes.filter((entry) => entry.outcome === outcome).length;
  return {
    lines: bag.lookalikes.slice(0, LOOKALIKE_LIST_LIMIT),
    targets: Object.fromEntries(bag.lookalikes.map((entry) => [String(entry.line), { item: entry.target.item, state: entry.target.state }])),
    count: bag.lookalikes.length,
    ignored: count('ignored'),
    created: count('created'),
    updated: count('updated'),
  };
}

/** The values of each dimension, by its code and its name (null for the unnamed default dimension). */
function namesByDimension(
  input: PreflightInput,
  byCode: Map<string, Map<string, string>>,
): Array<{ dimension: string; name: string | null; names: string[] }> {
  return [...byCode.entries()].map(([dimension, names]) => ({
    dimension,
    name: input.catalog.dimensions.find((item) => item.code === dimension)?.axisName ?? null,
    names: [...names.values()].slice(0, PREFLIGHT_LIST_LIMIT),
  }));
}

/**
 * The matching of the check: the matches beyond case, Kad's refused proposals, the values nothing
 * matched with their closest names, and the choices it followed (an undone match the file no longer
 * makes is dropped).
 */
function matchingOf(input: PreflightInput, bag: Bag): NonNullable<BudgetFileReport['matching']> {
  const state = bag.matching;
  const allowed = input.canCreateSuppliers;
  const choices: BudgetFileChoice[] = [...state.unmatched.entries()]
    .filter(([key]) => state.applied.has(key))
    .map(([, choice]) => choice);
  const chosen = createSuppliersChoice(input.matching?.choices ?? []);
  if (chosen !== undefined) choices.push({ kind: 'create_suppliers', value: chosen });
  choices.push(...bag.lookalikeChoices);
  return {
    matches: [...state.matches.values()].slice(0, MATCH_LIST_LIMIT),
    refusedProposals: [...state.refused.values()].slice(0, MATCH_LIST_LIMIT),
    candidates: [...state.candidates.values()].slice(0, MATCH_LIST_LIMIT),
    totals: { matches: state.matches.size, refusedProposals: state.refused.size, candidates: state.candidates.size },
    choices,
    createSuppliers: { allowed, value: allowed && input.createSuppliers },
  };
}

export function blankPreflightInput(scope: BudgetFileScope, read: BudgetFileRead, currentYear: number): PreflightInput {
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
