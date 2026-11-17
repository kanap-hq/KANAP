import {
  ArrayStrategy,
  CsvEntityConfig,
  CsvExportContext,
  CsvFieldType,
  CsvImportContext,
  CsvImportRow,
} from '../common/csv';
import { allocateItemNumbers } from '../common/item-number.service';
import { richTextCell } from '../common/csv/rich-text-cell';
import { sameStoredValues } from '../common/csv-sheet/unchanged';
import { incidentViewerForSql, incidentVisibilitySql, taskIncidentVisibilitySql, type IncidentViewer } from '../incidents/incident-visibility';
import { contractReference, contractReferenceNumber } from '../contracts/contract-reference';
import type { CsvLanguage } from '../common/csv-sheet';
import type { CsvCallerAccess, CsvImportParams } from '../common/csv';
import { hasLevel } from '../common/relations/relations-access';
import { findRecordByName, noteNameMatch, noteRefusedProposal, proposalFor, takeProposal, undoneMatch, type MatchHow } from '../common/name-matching';
import { budgetLineReference } from '../spend/budget-nature';

/** The label of a contract outside the person's access, as the tasks list writes it (`ops:contracts.outsideYourAccess`). */
export const CONTRACT_OUTSIDE_ACCESS: Record<CsvLanguage, string> = {
  en: 'Contract outside your access',
  fr: 'Contrat hors de votre accès',
  de: 'Vertrag außerhalb Ihres Zugriffs',
  es: 'Contrato fuera de su acceso',
};

export const TASK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Status label to code mapping
const statusLookup = new Map<string, string>([
  // Codes map to themselves
  ['open', 'open'],
  ['in_progress', 'in_progress'],
  ['pending', 'pending'],
  ['in_testing', 'in_testing'],
  ['done', 'done'],
  ['cancelled', 'cancelled'],
  // Common labels
  ['in progress', 'in_progress'],
  ['active', 'in_progress'],
  ['working', 'in_progress'],
  ['in testing', 'in_testing'],
  ['testing', 'in_testing'],
  ['completed', 'done'],
  ['complete', 'done'],
  ['finished', 'done'],
  ['closed', 'done'],
  ['canceled', 'cancelled'],
  ['cancelled', 'cancelled'],
]);

// Priority level label to code mapping
const priorityLookup = new Map<string, string>([
  // Codes map to themselves
  ['blocker', 'blocker'],
  ['high', 'high'],
  ['normal', 'normal'],
  ['low', 'low'],
  ['optional', 'optional'],
  // Common labels
  ['critical', 'blocker'],
  ['urgent', 'blocker'],
  ['medium', 'normal'],
  ['default', 'normal'],
  ['nice to have', 'optional'],
  ['nice-to-have', 'optional'],
]);

// Related object type label to code mapping
const objectTypeLookup = new Map<string, string>([
  // Codes map to themselves
  ['spend_item', 'spend_item'],
  ['contract', 'contract'],
  ['capex_item', 'capex_item'],
  ['project', 'project'],
  ['incident', 'incident'],
  // Common labels
  ['spend item', 'spend_item'],
  ['spend', 'spend_item'],
  ['capex item', 'capex_item'],
  ['capex', 'capex_item'],
]);

/** Status, priority and related object type accept a code or a common label. */
function normalizeTaskCodes(entity: any): void {
  for (const [key, lookup] of [['status', statusLookup], ['priority_level', priorityLookup], ['related_object_type', objectTypeLookup]] as const) {
    if (!entity[key]) continue;
    const resolved = lookup.get(String(entity[key]).trim().toLowerCase());
    if (resolved) entity[key] = resolved;
  }
}

/** The users a row's numbered email columns name, in order; null when none. */
function csvUserIds(raw: Record<string, string>, prefix: string, userByEmail: Map<string, string>): string[] | null {
  const ids: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const id = userByEmail.get((raw[`${prefix}_${i}`] || '').trim().toLowerCase());
    if (id) ids.push(id);
  }
  return ids.length > 0 ? ids : null;
}

const hasColumns = (raw: Record<string, string>, prefix: string) => [1, 2, 3, 4].some((i) => `${prefix}_${i}` in raw);

/**
 * The classification a task of a project takes from its project when it has none of its own: the
 * task list shows `COALESCE(task, project)` (`TasksService.listAllTasks`), and so does the export.
 */
export const TASK_INHERITED_CLASSIFICATION = ['source_id', 'category_id', 'stream_id', 'company_id'] as const;

type ProjectClassification = Record<(typeof TASK_INHERITED_CLASSIFICATION)[number], string | null>;

/** The classification of the projects named, by lower-case id; ids that are not uuids are left out. */
export async function taskProjectClassifications(
  manager: { query: (sql: string, params: unknown[]) => Promise<any> },
  tenantId: string,
  projectIds: string[],
): Promise<Map<string, ProjectClassification>> {
  const ids = [...new Set(projectIds.map((id) => String(id).trim().toLowerCase()).filter((id) => TASK_UUID_RE.test(id)))];
  if (ids.length === 0) return new Map();
  const rows: Array<ProjectClassification & { id: string }> = await manager.query(
    `SELECT id::text AS id, source_id::text AS source_id, category_id::text AS category_id,
            stream_id::text AS stream_id, company_id::text AS company_id
       FROM portfolio_projects
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The tables a task's related object is named in. `where`: a `spend_item` names an OPEX line
 * (`spend/budget-nature.ts`). `module` and `ref`: a family named by its name, found accents aside
 * for a person who reads that module (lot I3 of 26.11.9), and its business reference. `reader`: the
 * module a person reads to have Kad's proposal for the type taken, when it is not `module`: an
 * incident is named by its reference (`INC-n`), which keeps its reading, so Kad's `INC-n` is judged
 * as the cell would be, for a reader of the incidents (T-I3i).
 */
const RELATED_OBJECT_TABLES: Record<string, { table: string; nameColumn: string; where?: string; module?: string; reader?: string; ref?: (itemNumber: unknown) => string | null }> = {
  project: { table: 'portfolio_projects', nameColumn: 'name', module: 'portfolio_projects', ref: (n) => (n == null ? null : `PRJ-${n}`) },
  spend_item: { table: 'spend_items', nameColumn: 'product_name', where: ` AND nature = 'opex'`, module: 'budget', ref: (n) => budgetLineReference(n as number | null) },
  contract: { table: 'contracts', nameColumn: 'name', module: 'contracts', ref: (n) => contractReference(n as number | null) },
  capex_item: { table: 'spend_items', nameColumn: 'product_name', where: ` AND nature = 'capex'`, module: 'budget', ref: (n) => budgetLineReference(n as number | null) },
  incident: { table: 'incidents', nameColumn: "'INC-' || item_number::text", reader: 'incidents' },
};

/** What a name of a related object finds: nothing, several records (named), or one record and how. */
export type RelatedObjectLookup =
  | { kind: 'none' }
  | { kind: 'many'; names: string[] }
  | { kind: 'one'; id: string; how: MatchHow; target: string; ref: string | null };

/**
 * The record each name of a related object of one type finds: a contract is also named by its
 * reference (`CTR-12`), as the task list shows it, and the reference wins over a contract that
 * would carry it as its name. Else by its name case aside (the first record read wins, as before),
 * then accents aside when `beyondCase` says so for that name (a family named by its name: not an
 * incident's `INC-n`); several names there are an ambiguity. The rows are read in the person's
 * transaction: for a person limited by data access, a contract or a line outside their access is no
 * row, so it is neither found nor named. A restricted incident the `viewer` does not see (neither
 * incidents:admin, its reporter nor its owner) is no row either, as on the incidents screen; without a
 * viewer, none is seen. Null for a type that has no names.
 */
export async function relatedObjectsByName(
  manager: { query: (sql: string, params: unknown[]) => Promise<any> },
  tenantId: string,
  type: string,
  names: string[],
  options: { beyondCase?: (name: string) => boolean; viewer?: IncidentViewer | null } = {},
): Promise<((name: string) => RelatedObjectLookup) | null> {
  const mapping = RELATED_OBJECT_TABLES[type];
  if (!mapping) return null;
  const { table, nameColumn, where } = mapping;
  const beyondCase = (name: string) => !!mapping.module && options.beyondCase?.(name) === true;
  const itemNumber = mapping.ref ? ', item_number' : '';
  // Beyond case, every name of the family is a candidate; else only the names of the file, case aside.
  const params: unknown[] = [tenantId];
  const byName = names.some(beyondCase)
    ? ''
    : ` AND LOWER(${nameColumn}) = ANY($${params.push(names.map((name) => name.toLowerCase()))})`;
  const visible = type === 'incident' ? incidentVisibilitySql(table, incidentViewerForSql(options.viewer), params) : '';
  const read: Array<{ id: string; name: string | null; item_number?: unknown }> = await manager.query(
    `SELECT id, ${nameColumn} AS name${itemNumber} FROM ${table} WHERE tenant_id = $1${where ?? ''}${byName}${visible}`,
    params,
  );
  const rows = read.filter((row): row is { id: string; name: string; item_number?: unknown } => typeof row.name === 'string' && row.name.trim() !== '');
  const refOf = (row: { item_number?: unknown }) => mapping.ref?.(row.item_number ?? null) ?? null;
  const idByNumber = new Map<number, string>();
  if (type === 'contract') {
    const numbers = names.map((name) => contractReferenceNumber(name)).filter((n): n is number => n !== null);
    if (numbers.length > 0) {
      const byNumber: Array<{ id: string; item_number: number }> = await manager.query(
        `SELECT id, item_number FROM contracts WHERE tenant_id = $1 AND item_number = ANY($2::int[])`,
        [tenantId, numbers],
      );
      for (const row of byNumber) idByNumber.set(Number(row.item_number), row.id);
    }
  }
  return (name: string): RelatedObjectLookup => {
    const reference = type === 'contract' ? contractReferenceNumber(name) : null;
    const byReference = reference !== null ? idByNumber.get(reference) : undefined;
    if (byReference) return { kind: 'one', id: byReference, how: 'exact', target: name, ref: contractReference(reference) };
    const found = findRecordByName(rows, name, { beyondCase: beyondCase(name), caseBlind: true, label: refOf });
    if (found.kind === 'one') return { kind: 'one', id: found.row.id, how: found.how, target: found.row.name, ref: refOf(found.row) };
    return found.kind === 'many' ? { kind: 'many', names: found.names } : { kind: 'none' };
  };
}

/** The id each name of a related object of one type finds (`relatedObjectsByName`); undefined for none or several. */
export async function relatedObjectIdsByName(
  manager: { query: (sql: string, params: unknown[]) => Promise<any> },
  tenantId: string,
  type: string,
  names: string[],
  options: { beyondCase?: (name: string) => boolean; viewer?: IncidentViewer | null } = {},
): Promise<((name: string) => string | undefined) | null> {
  const lookup = await relatedObjectsByName(manager, tenantId, type, names, options);
  if (!lookup) return null;
  return (name: string) => {
    const found = lookup(name);
    return found.kind === 'one' ? found.id : undefined;
  };
}

/**
 * Whether a name of a related object of `type` (or of a phase, `portfolio_projects`) is found accents
 * aside: the person reads the family's module and has not undone that match.
 */
export function relatedObjectBeyondCase(
  access: CsvCallerAccess | null | undefined,
  unmatched: CsvImportParams['unmatched'],
  column: string,
  module: string | undefined,
): (name: string) => boolean {
  const reads = !!module && !!access && hasLevel(access, module, 'reader');
  return (name: string) => reads && !undoneMatch(unmatched, column, name);
}

/** The hidden contract's label in any of the export's languages, lower case. */
const CONTRACT_OUTSIDE_ACCESS_LABELS = new Set(Object.values(CONTRACT_OUTSIDE_ACCESS).map((label) => label.toLowerCase()));

/** Whether a related object name is the label of a contract outside the exporting person's access. */
export function isContractOutsideAccessLabel(name: unknown): boolean {
  return CONTRACT_OUTSIDE_ACCESS_LABELS.has(String(name ?? '').trim().toLowerCase());
}

/**
 * A limited person's tasks export leaves out the object they cannot read (`TasksCsvService.export`):
 * a contract by the list's label and an empty id, a budget line by an empty id and name. Read back
 * on a task of that type, the row keeps the task's stored object, in full replace as in enrich mode.
 * The label never names a contract: a labelled row without a stored contract to keep is refused.
 */
function keepObjectsOutsideAccess(rows: CsvImportRow[], operation: string): void {
  for (const row of rows) {
    if (row.errors.length > 0 || String(row.raw.related_object_id ?? '').trim()) continue;
    const type = objectTypeLookup.get(String(row.raw.related_object_type ?? '').trim().toLowerCase());
    const name = String(row.raw.related_object_name ?? '').trim();
    const labelled = type === 'contract' && isContractOutsideAccessLabel(name);
    const hiddenLine = (type === 'spend_item' || type === 'capex_item') && !name;
    if (!labelled && !hiddenLine) continue;
    const stored = row.existingEntity;
    if (stored?.related_object_id && stored.related_object_type === type) {
      row.parsed.related_object_id = stored.related_object_id;
      delete row.parsed._related_object_name;
      continue;
    }
    // Rows the operation skips are not checked.
    if (!labelled || (row.isInsert ? operation === 'update_only' : operation === 'insert_only')) continue;
    row.errors.push({
      row: row.rowNumber,
      column: 'related_object_name',
      message: `"${name}" was not found.`,
      code: 'CSV_REFERENCE_NOT_FOUND',
      params: { value: name },
    });
  }
}

/** A row the operation skips (an insert in update-only, an update in insert-only): not checked. */
function skippedByOperation(row: CsvImportRow, operation: string): boolean {
  return row.isInsert ? operation === 'update_only' : operation === 'insert_only';
}

/** A value of the row once imported: the file's, else the stored one (none for a new task). */
function importedValue(row: CsvImportRow, key: string): any {
  return Object.prototype.hasOwnProperty.call(row.parsed, key) ? row.parsed[key] : row.existingEntity?.[key];
}

/** Whether the row's own cell gives the related object's id (merge mode copies the stored id into a blank one). */
function givesRelatedObjectId(row: CsvImportRow): boolean {
  return String(row.raw.related_object_id ?? '').trim() !== '';
}

/**
 * The related object a row names by its name (lot I3 of 26.11.9), found at the check as at the load,
 * as `relatedObjectsByName` finds it: case aside, then accents aside for a person who reads its
 * family. A match beyond case is listed; a name nothing finds, or several, refuses the row. A row
 * that gives the object's id is left as it is: the id wins. A row of an existing task that names its
 * object without its id (a blank cell, or no column) has the name read as for a new task, whatever
 * object the task has: the stored one leaves the row unchanged, another one moves the task (fixes C).
 * The label of an object outside the person's access was settled before (`keepObjectsOutsideAccess`).
 * The commit resolves nothing more.
 * Kad's proposal for a name comes first: the record it names, exactly or case aside (a contract also
 * by its reference, an incident by its `INC-n`), in a family the person reads, is a match of origin
 * model; otherwise the proposal is listed as refused and the name is found by its own rule.
 */
async function resolveRelatedObjects(rows: CsvImportRow[], context: CsvImportContext): Promise<void> {
  const byType = new Map<string, CsvImportRow[]>();
  for (const row of rows) {
    if (row.errors.length > 0 || skippedByOperation(row, context.params.operation)) continue;
    const name = String(row.parsed._related_object_name ?? '').trim();
    if (!name || givesRelatedObjectId(row)) continue;
    const type = objectTypeLookup.get(String(importedValue(row, 'related_object_type') ?? '').trim().toLowerCase());
    if (!type || (type === 'contract' && isContractOutsideAccessLabel(name))) continue;
    byType.set(type, [...(byType.get(type) ?? []), row]);
  }
  for (const [type, typeRows] of byType) {
    const beyondCase = relatedObjectBeyondCase(context.access, context.params.unmatched, 'related_object_name', RELATED_OBJECT_TABLES[type]?.module);
    const names = typeRows.map((row) => String(row.parsed._related_object_name).trim());
    const lookup = await relatedObjectsByName(context.manager, context.tenantId, type, names, { beyondCase, viewer: context.viewer });
    if (!lookup) continue;
    const proposalOf = (name: string) => (undoneMatch(context.params.unmatched, 'related_object_name', name)
      ? undefined
      : proposalFor(context.params.proposals, 'related_object_name', name));
    const proposals = [...new Set(names.map(proposalOf).filter((proposal): proposal is string => proposal !== undefined))];
    const module = RELATED_OBJECT_TABLES[type]?.module ?? RELATED_OBJECT_TABLES[type]?.reader;
    const reads = !!module && !!context.access && hasLevel(context.access, module, 'reader');
    const proposed = proposals.length > 0 && reads ? await relatedObjectsByName(context.manager, context.tenantId, type, proposals, { viewer: context.viewer }) : null;
    for (const row of typeRows) {
      const name = String(row.parsed._related_object_name).trim();
      const proposal = proposalOf(name);
      if (proposal !== undefined) {
        const target = proposed?.(proposal);
        if (target?.kind === 'one') {
          row.parsed.related_object_id = target.id;
          delete row.parsed._related_object_name;
          if (context.nameMatches) {
            noteNameMatch(context.nameMatches, {
              column: 'related_object_name', name: null, value: name, target: target.target, ref: target.ref,
              origin: 'model', reason: 'model', undoable: true,
            }, row.rowNumber);
          }
          continue;
        }
        if (context.refusedProposals) {
          noteRefusedProposal(context.refusedProposals, { column: 'related_object_name', name: null, value: name, target: proposal, reason: 'missing' }, row.rowNumber);
        }
      }
      const found = lookup(name);
      if (found.kind === 'one') {
        row.parsed.related_object_id = found.id;
        delete row.parsed._related_object_name;
        if (found.how === 'accents' && context.nameMatches) {
          noteNameMatch(context.nameMatches, {
            column: 'related_object_name', name: null, value: name, target: found.target, ref: found.ref,
            origin: 'server', reason: 'accents', undoable: true,
          }, row.rowNumber);
        }
        continue;
      }
      const names = found.kind === 'many' ? found.names.join(', ') : '';
      row.errors.push(found.kind === 'many'
        ? { row: row.rowNumber, column: 'related_object_name', message: `"${name}" may designate several records: ${names}`, code: 'CSV_NAME_AMBIGUOUS_AMONG', params: { value: name, names } }
        : { row: row.rowNumber, column: 'related_object_name', message: `"${name}" was not found.`, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: name } });
    }
  }
}

/** The related object type a row's task has once imported, as a code (`incident`, `project`...); '' for none. */
function importedObjectType(row: CsvImportRow): string {
  const value = String(importedValue(row, 'related_object_type') ?? '').trim().toLowerCase();
  return objectTypeLookup.get(value) ?? value;
}

/**
 * A row that gives an incident by its id (lot I3 of 26.11.9, fixes E): the incident must be one the
 * person sees, as by its `INC-n` (`relatedObjectsByName`). A restricted incident the `viewer` does not
 * see (neither incidents:admin, its reporter nor its owner) is refused as not found, like an id that
 * names no incident.
 */
async function checkIncidentIds(rows: CsvImportRow[], context: CsvImportContext): Promise<void> {
  const giving = rows.filter((row) => row.errors.length === 0 && !skippedByOperation(row, context.params.operation)
    && givesRelatedObjectId(row) && importedObjectType(row) === 'incident');
  if (giving.length === 0) return;
  const idOf = (row: CsvImportRow) => String(row.raw.related_object_id).trim();
  const ids = [...new Set(giving.map(idOf).filter((id) => TASK_UUID_RE.test(id)).map((id) => id.toLowerCase()))];
  const params: unknown[] = [context.tenantId, ids];
  const visible = incidentVisibilitySql('i', incidentViewerForSql(context.viewer), params);
  const seen: Array<{ id: string }> = ids.length === 0 ? [] : await context.manager.query(
    `SELECT i.id::text AS id FROM incidents i WHERE i.tenant_id = $1 AND i.id = ANY($2::uuid[])${visible}`,
    params,
  );
  const found = new Set(seen.map((row) => row.id.toLowerCase()));
  for (const row of giving) {
    const id = idOf(row);
    if (found.has(id.toLowerCase())) continue;
    row.errors.push({ row: row.rowNumber, column: 'related_object_id', message: `"${id}" was not found.`, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: id } });
  }
}

/**
 * The phase of a project task is its project's (lot I3 of 26.11.9). The shared lookup finds the
 * file's phase name anywhere in the workspace, case aside only (`nameMatchedByConfig`); here, in the
 * task's project, at the check as at the load: Kad's proposal first, for a person who reads the
 * projects (a match of origin model; otherwise refused); then the name as the lookup found it when
 * that phase is the project's; else the project's phase of that name case aside, then accents aside
 * for a person who reads the projects and has not undone that match (a match, listed). Several: the
 * row is refused. None: refused when the workspace has the name elsewhere; otherwise the lookup's
 * warning stands (the phase is cleared, or kept on an update in merge mode), as before. A phase on a
 * task outside a project is not imported (`followTaskObjects`), and Kad's proposal for it is refused.
 */
async function anchorPhases(rows: CsvImportRow[], context: CsvImportContext): Promise<void> {
  const { params } = context;
  const state = { matches: context.nameMatches ?? new Map(), refused: context.refusedProposals ?? new Map() };
  const reads = !!context.access && hasLevel(context.access, 'portfolio_projects', 'reader');
  const naming = rows
    .filter((row) => row.errors.length === 0 && !skippedByOperation(row, params.operation))
    .filter((row) => String(row.raw.phase_name ?? '').trim())
    .map((row) => {
      const type = String(importedValue(row, 'related_object_type') ?? '').trim().toLowerCase();
      const id = importedValue(row, 'related_object_id');
      const projectId = type === 'project' && id ? String(id).trim().toLowerCase() : null;
      return { row, projectId: projectId && TASK_UUID_RE.test(projectId) ? projectId : null };
    });
  for (const { row, projectId } of naming) {
    if (projectId) continue;
    const cell = String(row.raw.phase_name).trim();
    const proposal = undoneMatch(params.unmatched, 'phase_name', cell) ? undefined : proposalFor(params.proposals, 'phase_name', cell);
    if (proposal !== undefined) noteRefusedProposal(state.refused, { column: 'phase_name', name: null, value: cell, target: proposal, reason: 'missing' }, row.rowNumber);
  }
  const candidates = naming.filter((entry): entry is { row: CsvImportRow; projectId: string } => !!entry.projectId);
  if (candidates.length === 0) return;
  const parsedIds = candidates.map((entry) => String(entry.row.parsed.phase_id ?? '')).filter((id) => TASK_UUID_RE.test(id));
  const phases: Array<{ id: string; name: string; project_id: string }> = await context.manager.query(
    `SELECT id::text AS id, name, project_id::text AS project_id FROM portfolio_project_phases
      WHERE tenant_id = $1 AND (project_id = ANY($2::uuid[]) OR id = ANY($3::uuid[]))`,
    [context.tenantId, [...new Set(candidates.map((entry) => entry.projectId))], [...new Set(parsedIds)]],
  );
  const phaseById = new Map(phases.map((phase) => [phase.id.toLowerCase(), phase]));
  const MISSING = new Set(['CSV_REFERENCE_NOT_FOUND_CLEARED', 'CSV_REFERENCE_NOT_FOUND_KEPT']);
  for (const { row, projectId } of candidates) {
    const cell = String(row.raw.phase_name).trim();
    const own = phases.filter((phase) => phase.project_id.toLowerCase() === projectId);
    const missing = row.warnings.find((warning) => warning.column === 'phase_name' && MISSING.has(String(warning.code)));
    const take = (phase: { id: string }) => {
      row.parsed.phase_id = phase.id;
      if (missing) row.warnings.splice(row.warnings.indexOf(missing), 1);
    };
    const proposed = takeProposal(state, {
      proposals: params.proposals, unmatched: params.unmatched, column: 'phase_name', value: cell, line: row.rowNumber, rows: own, reads, caseBlind: true,
    });
    if (proposed) {
      take(proposed);
      continue;
    }
    if (!missing && phaseById.get(String(row.parsed.phase_id ?? '').toLowerCase())?.project_id.toLowerCase() === projectId) continue;
    const beyondCase = relatedObjectBeyondCase(context.access, params.unmatched, 'phase_name', 'portfolio_projects')(cell);
    const found = findRecordByName(own, cell, { beyondCase, caseBlind: true });
    if (found.kind === 'one') {
      take(found.row);
      if (found.how === 'accents') {
        noteNameMatch(state.matches, {
          column: 'phase_name', name: null, value: cell, target: found.row.name, ref: null,
          origin: 'server', reason: 'accents', undoable: true,
        }, row.rowNumber);
      }
      continue;
    }
    // Nothing anywhere in the workspace: the lookup's warning stands, as before.
    if (missing && found.kind === 'none') continue;
    const names = found.kind === 'many' ? found.names.join(', ') : '';
    row.errors.push(found.kind === 'many'
      ? { row: row.rowNumber, column: 'phase_name', message: `"${cell}" may designate several phases of the project: ${names}`, code: 'CSV_NAME_AMBIGUOUS_AMONG', params: { value: cell, names } }
      : { row: row.rowNumber, column: 'phase_name', message: `Phase "${cell}" does not exist in the task's project.`, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: cell } });
  }
}

/** The fields of a task its object rules (`TasksUnifiedService`), and the table their stored names are read in. */
const TASK_OBJECT_FIELDS = [
  { key: 'phase_id', column: 'phase_name', table: 'portfolio_project_phases' },
  { key: 'source_id', column: 'source_name', table: 'portfolio_sources' },
  { key: 'category_id', column: 'category_name', table: 'portfolio_categories' },
  { key: 'stream_id', column: 'stream_name', table: 'portfolio_streams' },
  { key: 'company_id', column: 'company_name', table: 'companies' },
] as const;

/** What the shared lookup said of a reference cell nothing found. */
const LOOKUP_MISSES = new Set(['CSV_REFERENCE_NOT_FOUND_CLEARED', 'CSV_REFERENCE_NOT_FOUND_KEPT']);

/**
 * A task's object rules its phase and its classification, as on the task screen (lot I3 of 26.11.9,
 * fixes C, E and F): only a project task has a phase; a task of a budget line, a contract or an
 * incident has no source, category, stream or company. A row whose task cannot have a field it fills
 * has that cell left out, and said on it (`CSV_TASK_PHASE_OUTSIDE_PROJECT`,
 * `CSV_TASK_CLASSIFICATION_NOT_ALLOWED`); the row is not refused. A task the row moves to another
 * object without that cell (a blank cell in merge mode, or no column) loses what its new object does
 * not allow, cleared and said removed by the stored name (`CSV_TASK_PHASE_CLEARED_OUTSIDE_PROJECT`,
 * `CSV_TASK_CLASSIFICATION_CLEARED`; correctifs G); a task that keeps its object keeps what it has, as
 * on the screen. Moved to another project, the phase of the same name there, case aside, is taken, as
 * the commit always did; otherwise it is cleared and said not found in that project
 * (`CSV_REFERENCE_NOT_FOUND_CLEARED`, the rule of `clearKeptReferencesOfChangedOwners`). The load no
 * longer fails on it.
 */
async function followTaskObjects(rows: CsvImportRow[], context: CsvImportContext): Promise<void> {
  const clears: Array<{ row: CsvImportRow; key: string; column: string; projectId: string | null }> = [];
  for (const row of rows) {
    if (row.errors.length > 0 || skippedByOperation(row, context.params.operation)) continue;
    const type = importedObjectType(row);
    const stored = row.existingEntity;
    const moved = !!stored && String(stored.related_object_id ?? '').toLowerCase() !== String(importedValue(row, 'related_object_id') ?? '').trim().toLowerCase();
    for (const { key, column } of TASK_OBJECT_FIELDS) {
      const allowed = key === 'phase_id' ? type === 'project' : type === '' || type === 'project';
      const cell = String(row.raw[column] ?? '').trim();
      if (!allowed && cell) {
        row.warnings = row.warnings.filter((warning) => warning.column !== column || !LOOKUP_MISSES.has(String(warning.code)));
        row.warnings.push(key === 'phase_id'
          ? { row: row.rowNumber, column, message: `"${cell}" is not imported: only a project task has a phase.`, code: 'CSV_TASK_PHASE_OUTSIDE_PROJECT', params: { value: cell } }
          : { row: row.rowNumber, column, message: `"${cell}" is not imported: only a standalone or project task has a classification.`, code: 'CSV_TASK_CLASSIFICATION_NOT_ALLOWED', params: { value: cell } });
        if (moved) row.parsed[key] = null;
        else delete row.parsed[key];
        continue;
      }
      if (!moved || !stored[key] || cell || String(importedValue(row, key) ?? '') !== String(stored[key])) continue;
      if (!allowed) clears.push({ row, key, column, projectId: null });
      else if (key === 'phase_id') {
        const projectId = importedProjectId(row);
        if (projectId && TASK_UUID_RE.test(projectId)) clears.push({ row, key, column, projectId });
      }
    }
  }
  if (clears.length === 0) return;
  const ids = [...new Set(clears.map(({ row, key }) => String(row.existingEntity[key])))];
  const projectIds = [...new Set(clears.map((clear) => clear.projectId).filter((id): id is string => !!id))];
  const named: Array<{ id: string; name: string; project_id: string | null }> = await context.manager.query(
    [
      `SELECT id::text AS id, name, project_id::text AS project_id FROM portfolio_project_phases
        WHERE tenant_id = $1 AND (id = ANY($2::uuid[]) OR project_id = ANY($3::uuid[]))`,
      ...TASK_OBJECT_FIELDS.filter((field) => field.key !== 'phase_id')
        .map((field) => `SELECT id::text, name, NULL FROM ${field.table} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`),
    ].join(' UNION ALL '),
    [context.tenantId, ids, projectIds],
  );
  const byId = new Map(named.map((record) => [record.id.toLowerCase(), record]));
  for (const { row, key, column, projectId } of clears) {
    const storedRecord = byId.get(String(row.existingEntity[key]).toLowerCase());
    if (projectId) {
      if (!storedRecord || storedRecord.project_id?.toLowerCase() === projectId) continue;
      const name = storedRecord.name.toLowerCase();
      const same = named.find((record) => record.project_id?.toLowerCase() === projectId && record.name.toLowerCase() === name);
      if (same) {
        row.parsed[key] = same.id;
        continue;
      }
    }
    row.parsed[key] = null;
    if (!storedRecord) continue;
    const value = storedRecord.name;
    row.warnings.push(projectId
      ? { row: row.rowNumber, column, message: `${TASK_OBJECT_FIELDS.find((field) => field.key === key)!.table} not found: "${value}" (set to null)`, code: 'CSV_REFERENCE_NOT_FOUND_CLEARED', params: { value } }
      : key === 'phase_id'
        ? { row: row.rowNumber, column, message: `"${value}" is removed: only a project task has a phase.`, code: 'CSV_TASK_PHASE_CLEARED_OUTSIDE_PROJECT', params: { value } }
        : { row: row.rowNumber, column, message: `"${value}" is removed: only a standalone or project task has a classification.`, code: 'CSV_TASK_CLASSIFICATION_CLEARED', params: { value } });
  }
}

/** The numbered e-mail columns of a task's people lists, and the stored list each one writes. */
const PEOPLE_LISTS = [{ prefix: 'viewer_email', key: 'viewer_ids' }, { prefix: 'owner_email', key: 'owner_ids' }] as const;

/** A task's stored list of people (jsonb) names the same people as the file, in any order. */
function samePeople(stored: unknown, next: string[]): boolean {
  const current = Array.isArray(stored) ? stored.map(String) : [];
  const wanted = new Set(next);
  return current.length === wanted.size && current.every((id) => wanted.has(id));
}

/** Whether a row keeps its stored list of `prefix` (`importPeople` said so on one of its cells). */
function keepsStoredPeople(warnings: ReadonlyArray<{ row: number; column?: string; code?: string }>, row: number, prefix: string): boolean {
  return warnings.some((warning) => warning.row === row && warning.code === 'CSV_REFERENCE_NOT_FOUND_KEPT' && !!warning.column?.startsWith(`${prefix}_`));
}

/**
 * Viewers and owners: the row's lists, written with the task the import writes (lot I3 of 26.11.9,
 * review fixes: the task whose related object the import found, Kad's proposal and an undone match
 * included). A list the file leaves out (none of its numbered columns) is not touched; a list that
 * names the people the task has, in any order, is left as it is. An e-mail nothing finds is said at
 * the check as at the load: in merge mode, on a row that updates a task, the stored list is kept whole
 * (`CSV_REFERENCE_NOT_FOUND_KEPT`); elsewhere the e-mail is skipped (`CSV_REFERENCE_NOT_FOUND_SKIPPED`).
 * The people are read once, by the file's e-mails.
 */
async function importPeople(rows: CsvImportRow[], context: CsvImportContext): Promise<void> {
  const checked = rows.filter((row) => row.errors.length === 0 && !skippedByOperation(row, context.params.operation));
  const cells = checked.flatMap((row) => PEOPLE_LISTS.flatMap(({ prefix }) => [1, 2, 3, 4]
    .map((i) => ({ row, column: `${prefix}_${i}`, value: String(row.raw[`${prefix}_${i}`] ?? '').trim() }))
    .filter((cell) => cell.value)));
  const known: Array<{ id: string; email: string }> = cells.length === 0 ? [] : await context.manager.query(
    `SELECT id::text AS id, lower(email) AS email FROM users WHERE tenant_id = $1 AND lower(email) = ANY($2::text[])`,
    [context.tenantId, [...new Set(cells.map((cell) => cell.value.toLowerCase()))]],
  );
  const userByEmail = new Map(known.map((user) => [user.email, user.id]));
  for (const { row, column, value } of cells) {
    if (userByEmail.has(value.toLowerCase())) continue;
    const keep = context.params.mode === 'enrich' && !row.isInsert;
    row.warnings.push({
      row: row.rowNumber,
      column,
      message: `user not found: "${value}" (${keep ? 'kept' : 'skipped'})`,
      code: keep ? 'CSV_REFERENCE_NOT_FOUND_KEPT' : 'CSV_REFERENCE_NOT_FOUND_SKIPPED',
      params: { value },
    });
  }
  for (const row of checked) {
    for (const { prefix, key } of PEOPLE_LISTS) {
      if (!hasColumns(row.raw, prefix) || keepsStoredPeople(row.warnings, row.rowNumber, prefix)) continue;
      const ids = csvUserIds(row.raw, prefix, userByEmail) ?? [];
      if (row.isInsert || !samePeople(row.existingEntity?.[key], ids)) row.parsed[key] = ids;
    }
  }
}

/** The project a matched row's task belongs to once imported (the file's, else the stored one); null when none. */
function importedProjectId(row: CsvImportRow): string | null {
  const stored = row.existingEntity;
  const pick = (key: string) => (Object.prototype.hasOwnProperty.call(row.parsed, key) ? row.parsed[key] : stored[key]);
  const type = String(pick('related_object_type') ?? '').trim().toLowerCase();
  const id = pick('related_object_id');
  return type === 'project' && id ? String(id).trim().toLowerCase() : null;
}

/**
 * CSV configuration for Tasks entity
 *
 * Column order: id, reference (T-n, export only), title, description, then the TaskWorkspacePage.tsx
 * sidebar top to bottom:
 * - Context: related object, phase
 * - Details: task type, priority, status
 * - Classification: source, category, stream, company
 * - People: requestor, assignee, viewers, then owners (not on the page)
 * - Dates: start_date, due_date
 * - Not on the page: labels
 */
export const taskCsvConfig: CsvEntityConfig = {
  entityName: 'task',
  // The sheet of an xlsx export: the list's title on screen.
  sheetNames: { en: 'Tasks', fr: 'Tâches', de: 'Aufgaben', es: 'Tareas' },
  tableName: 'tasks',
  displayName: 'Tasks',
  // For linked tasks: title + related_object_id. For standalone: title alone (matched via id).
  upsertKey: ['title'],
  fields: [
    // === IDENTITY ===
    {
      csvColumn: 'id',
      entityProperty: 'id',
      type: CsvFieldType.STRING,
      isIdentityColumn: true,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'ID',
      group: 'Identity',
    },
    {
      // The business reference the list shows (T-n): export only, ignored on import.
      csvColumn: 'reference',
      entityProperty: 'item_number',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Reference',
      group: 'Identity',
      exportFn: (entity: any) => (entity.item_number ? `T-${entity.item_number}` : ''),
    },
    {
      csvColumn: 'title',
      entityProperty: 'title',
      type: CsvFieldType.STRING,
      required: true,
      defaultExport: true,
      label: 'Title',
      group: 'Basic',
    },

    // === BODY ===
    {
      csvColumn: 'description',
      entityProperty: 'description',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Description',
      group: 'Basic',
      // The description is rich text: same rules as in the task editor.
      importTransformFn: richTextCell('description'),
    },

    // === SIDEBAR: CONTEXT ===
    {
      csvColumn: 'related_object_type',
      entityProperty: 'related_object_type',
      type: CsvFieldType.ENUM,
      enumValues: ['spend_item', 'contract', 'capex_item', 'project', 'incident'],
      required: false, // Optional for standalone tasks
      defaultExport: true,
      label: 'Related Object Type',
      group: 'Context',
    },
    {
      csvColumn: 'related_object_id',
      entityProperty: 'related_object_id',
      type: CsvFieldType.STRING,
      required: false, // Not required if related_object_name is provided
      exportable: true,
      importable: true,
      defaultExport: true,
      label: 'Related Object ID',
      group: 'Context',
    },
    {
      csvColumn: 'related_object_name',
      entityProperty: '_related_object_name', // Temporary field for import; pre-loaded for export
      type: CsvFieldType.COMPUTED,
      required: false,
      exportable: true,
      importable: true,
      defaultExport: true,
      label: 'Related Object Name',
      group: 'Context',
      // Export reads pre-loaded _relatedObjectName (set by TasksCsvService.export)
      exportFn: (entity: any) => entity._relatedObjectName ?? '',
    },
    {
      csvColumn: 'phase_name',
      entityProperty: 'phase_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_project_phases',
      fkLookupColumn: 'name',
      // Found in the task's project, beyond case and with Kad's proposals, by `anchorPhases`.
      nameMatchedByConfig: true,
      keptWith: ['related_object_type', 'related_object_id'],
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Phase',
      group: 'Context',
    },

    // === SIDEBAR: DETAILS ===
    {
      csvColumn: 'task_type_name',
      entityProperty: 'task_type_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_task_types',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Task Type',
      group: 'Context',
    },
    {
      csvColumn: 'priority_level',
      entityProperty: 'priority_level',
      type: CsvFieldType.ENUM,
      enumValues: ['blocker', 'high', 'normal', 'low', 'optional'],
      required: false,
      defaultExport: true,
      label: 'Priority Level',
      group: 'Context',
    },
    {
      csvColumn: 'status',
      entityProperty: 'status',
      type: CsvFieldType.ENUM,
      enumValues: ['open', 'in_progress', 'pending', 'in_testing', 'done', 'cancelled'],
      required: false,
      defaultExport: true,
      label: 'Status',
      group: 'Status',
    },

    // === SIDEBAR: CLASSIFICATION (a project task shows its project's when it has none) ===
    {
      csvColumn: 'source_name',
      entityProperty: 'source_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_sources',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: false,
      label: 'Source',
      group: 'Context',
    },
    {
      csvColumn: 'category_name',
      entityProperty: 'category_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_categories',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Category',
      group: 'Context',
    },
    {
      csvColumn: 'stream_name',
      entityProperty: 'stream_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_streams',
      fkLookupColumn: 'name',
      keptWith: ['category_id'],
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Stream',
      group: 'Context',
    },
    {
      csvColumn: 'company_name',
      entityProperty: 'company_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'companies',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: false,
      label: 'Company',
      group: 'Context',
    },

    // === SIDEBAR: PEOPLE (owners are not on the page) ===
    {
      csvColumn: 'creator_email',
      entityProperty: 'creator_id',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Requestor Email',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        if (!entity.creator_id) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === entity.creator_id) {
            return user._originalLookupValue ?? '';
          }
        }
        return '';
      },
    },
    {
      csvColumn: 'assignee_email',
      entityProperty: 'assignee_user_id',
      type: CsvFieldType.FK_BY_EMAIL,
      fkEntity: 'users',
      fkLookupColumn: 'email',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Assignee Email',
      group: 'People',
    },
    {
      csvColumn: 'viewer_email_1',
      entityProperty: '_viewer_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Viewer Email 1',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.viewer_ids;
        if (!Array.isArray(ids) || !ids[0]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[0]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'viewer_email_2',
      entityProperty: '_viewer_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Viewer Email 2',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.viewer_ids;
        if (!Array.isArray(ids) || !ids[1]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[1]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'viewer_email_3',
      entityProperty: '_viewer_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Viewer Email 3',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.viewer_ids;
        if (!Array.isArray(ids) || !ids[2]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[2]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'viewer_email_4',
      entityProperty: '_viewer_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Viewer Email 4',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.viewer_ids;
        if (!Array.isArray(ids) || !ids[3]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[3]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'owner_email_1',
      entityProperty: '_owner_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: false,
      label: 'Owner Email 1',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.owner_ids;
        if (!Array.isArray(ids) || !ids[0]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[0]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'owner_email_2',
      entityProperty: '_owner_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: false,
      label: 'Owner Email 2',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.owner_ids;
        if (!Array.isArray(ids) || !ids[1]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[1]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'owner_email_3',
      entityProperty: '_owner_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: false,
      label: 'Owner Email 3',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.owner_ids;
        if (!Array.isArray(ids) || !ids[2]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[2]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'owner_email_4',
      entityProperty: '_owner_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: false,
      label: 'Owner Email 4',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.owner_ids;
        if (!Array.isArray(ids) || !ids[3]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[3]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },

    // === SIDEBAR: DATES ===
    {
      csvColumn: 'start_date',
      entityProperty: 'start_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Start Date',
      group: 'Dates',
    },
    {
      csvColumn: 'due_date',
      entityProperty: 'due_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Due Date',
      group: 'Dates',
    },

    // === NOT ON THE PAGE ===
    {
      csvColumn: 'labels',
      entityProperty: 'labels',
      type: CsvFieldType.ARRAY,
      arrayStrategy: ArrayStrategy.COMMA_SEPARATED,
      required: false,
      defaultExport: true,
      label: 'Labels',
      group: 'Other',
    },
  ],

  // Export presets
  exportPresets: [
    {
      name: 'enrichment',
      label: 'Data Enrichment',
      // Only importable fields - excludes computed fields like creator_email
      fields: [
        'id', 'title', 'description',
        'related_object_type', 'related_object_id', 'related_object_name', 'phase_name',
        'priority_level', 'category_name', 'stream_name',
        'status', 'start_date', 'due_date',
        'assignee_email',
        'viewer_email_1', 'viewer_email_2', 'viewer_email_3', 'viewer_email_4',
        'owner_email_1', 'owner_email_2', 'owner_email_3', 'owner_email_4',
        'labels',
      ],
    },
  ],

  /**
   * A row that names a task by id must not reach a task of a restricted incident the
   * importer cannot see: the id reads as nonexistent, so update-only refuses the row
   * and upsert never overwrites the hidden record.
   */
  beforeValidate: async (rows, context) => {
    const viewer = context.viewer;
    if (!viewer || viewer.isAdmin) return;
    const ids = Array.from(new Set(rows
      .map((row) => String(row.raw.id ?? '').trim())
      .filter((id) => TASK_UUID_RE.test(id))));
    if (ids.length === 0) return;
    const params: unknown[] = [context.tenantId, ids];
    const visible = taskIncidentVisibilitySql('t', viewer, params).replace(/^\s*AND\s+/, '');
    if (!visible) return;
    const hiddenRows: Array<{ id: string }> = await context.manager.query(
      `SELECT t.id::text AS id
       FROM tasks t
       WHERE t.tenant_id = $1
         AND t.id = ANY($2::uuid[])
         AND NOT (${visible})`,
      params,
    );
    if (hiddenRows.length === 0) return;
    const hidden = new Set(hiddenRows.map((row) => row.id.toLowerCase()));
    for (const row of rows) {
      const id = String(row.raw.id ?? '').trim().toLowerCase();
      if (hidden.has(id)) {
        row.errors.push({ row: row.rowNumber, column: 'id', message: 'Task not found' });
      }
    }
  },

  /**
   * The object a limited person's export leaves out stays the task's (`keepObjectsOutsideAccess`).
   * The export writes the classification a project task inherits (TASK_INHERITED_CLASSIFICATION). Read
   * back, a cell equal to the project's value on a task that has no value of its own is the inherited
   * value, left as it is: the task keeps following its project. Any other value is the task's own.
   */
  afterValidate: async (rows, context) => {
    keepObjectsOutsideAccess(rows, context.params.operation);
    await checkIncidentIds(rows, context);
    await resolveRelatedObjects(rows, context);
    await anchorPhases(rows, context);
    await followTaskObjects(rows, context);
    await importPeople(rows, context);
    const matched = rows
      .filter((row) => row.errors.length === 0 && row.existingEntity)
      .map((row) => ({ row, projectId: importedProjectId(row) }))
      .filter((entry): entry is { row: CsvImportRow; projectId: string } => !!entry.projectId);
    if (matched.length === 0) return;
    const projects = await taskProjectClassifications(context.manager, context.tenantId, matched.map((entry) => entry.projectId));
    for (const { row, projectId } of matched) {
      const project = projects.get(projectId);
      if (!project) continue;
      for (const key of TASK_INHERITED_CLASSIFICATION) {
        const value = row.parsed[key];
        if (value == null || row.existingEntity[key] != null || project[key] == null) continue;
        if (String(value).toLowerCase() === project[key]!.toLowerCase()) delete row.parsed[key];
      }
    }
  },

  /**
   * The row as the commit stores it: codes normalized, the related object named by its id, the
   * phase re-anchored to the task's project, and the viewers and owners `importPeople` set.
   */
  sameAsStored: async (rows, context) => {
    const phaseIds = [...new Set(rows.flatMap((row) => [row.parsed.phase_id, row.existingEntity.phase_id]).filter(Boolean))];
    const phases = rows.length === 0 || phaseIds.length === 0 ? [] : await context.manager.query(
      `SELECT id, name, project_id FROM portfolio_project_phases WHERE tenant_id = $1 AND id = ANY($2)`,
      [context.tenantId, phaseIds],
    );
    const phaseById = new Map<string, any>(phases.map((p: any) => [p.id, p]));

    return rows.map((row) => {
      const stored = row.existingEntity;
      const next: Record<string, any> = { ...row.parsed };
      normalizeTaskCodes(next);
      // A name is read at the check (`resolveRelatedObjects`): a name still there on a row that gives
      // no id was not resolved, and is not proven equal. A row that gives the id keeps it, whatever its name.
      if (next._related_object_name && !givesRelatedObjectId(row)) return false;
      const relatedId = next.related_object_id ?? stored.related_object_id;
      delete next._related_object_name;

      // The phase resolver matches names tenant-wide; the commit moves the phase to the task's
      // project. The stored phase is kept when it is that project's phase of the same name.
      const parsedPhase = phaseById.get(next.phase_id);
      const storedPhase = phaseById.get(stored.phase_id);
      if (parsedPhase && storedPhase && parsedPhase.id !== storedPhase.id
        && next.related_object_type === 'project' && parsedPhase.project_id !== relatedId
        && storedPhase.project_id === relatedId
        && String(storedPhase.name).toLowerCase() === String(parsedPhase.name).toLowerCase()) {
        next.phase_id = storedPhase.id;
      }

      delete next._viewer_emails;
      delete next._owner_emails;
      return sameStoredValues(stored, next);
    });
  },

  /**
   * Hook to normalize status, priority_level, related_object_type values and resolve
   * related_object_name to related_object_id before commit.
   * Accepts both codes and common labels for enum fields.
   */
  beforeCommit: async (entities: any[], context: CsvImportContext) => {
    // First pass: normalize enum values
    for (const entity of entities) normalizeTaskCodes(entity);

    // Second pass: resolve related_object_name to related_object_id
    // Group entities by type to batch queries
    const byType = new Map<string, Array<{ entity: any; name: string }>>();

    for (const entity of entities) {
      // Skip if already has an ID or no name provided
      if (entity.related_object_id) {
        // Clean up temporary field
        delete entity._related_object_name;
        continue;
      }

      const name = entity._related_object_name;
      if (!name || !entity.related_object_type) {
        // Validation will catch missing required fields
        delete entity._related_object_name;
        continue;
      }

      const type = entity.related_object_type;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push({ entity, name: String(name).trim() });
    }

    // Resolve names to IDs for each type (`relatedObjectIdsByName`: a spend_item names an OPEX line,
    // a contract is also named by its reference).
    for (const [type, items] of byType.entries()) {
      const idOf = await relatedObjectIdsByName(context.manager, context.tenantId, type, items.map((i) => i.name), { viewer: context.viewer });
      if (!idOf) continue;

      // Resolve each entity
      for (const { entity, name } of items) {
        const id = idOf(name);
        if (id) {
          entity.related_object_id = id;
        } else {
          throw new Error(
            `Related object not found: "${name}" (type: ${type}). ` +
            `Make sure the ${type.replace('_', ' ')} exists before importing tasks.`,
          );
        }
        // Clean up temporary field
        delete entity._related_object_name;
      }
    }

    // A budget line named by its id: the task takes the type of the line's nature (`spend_item` for
    // an OPEX line, `capex_item` for a CAPEX line), whatever the file says. A file exported before
    // the line changed type (lot M) keeps naming the type of before; a task of that type on the line
    // would be shown by no reader. An id that names no budget line is left as it is.
    const budgetLineTasks = entities.filter(
      (e) => (e.related_object_type === 'spend_item' || e.related_object_type === 'capex_item') && e.related_object_id,
    );
    if (budgetLineTasks.length > 0) {
      const lineIds = [...new Set(budgetLineTasks.map((e) => String(e.related_object_id)))]
        .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      const lineRows: Array<{ id: string; nature: string }> = lineIds.length > 0
        ? await context.manager.query(
          // Both natures on purpose: the nature read here is the answer (`spend/budget-nature.ts`).
          `SELECT id::text AS id, nature FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND nature IN ('opex', 'capex')`,
          [context.tenantId, lineIds],
        )
        : [];
      const natureById = new Map(lineRows.map((row) => [row.id.toLowerCase(), row.nature]));
      for (const entity of budgetLineTasks) {
        const nature = natureById.get(String(entity.related_object_id).toLowerCase());
        if (nature) entity.related_object_type = nature === 'capex' ? 'capex_item' : 'spend_item';
      }
    }

    // Re-scope phase_id: the generic FK resolver matches phase names
    // tenant-wide, so a repeated name ("Design", "Build") can resolve to
    // another project's phase. Re-anchor each phase to the task's project.
    const phaseEntities = entities.filter(
      (e) => e.phase_id && e.related_object_type === 'project' && e.related_object_id,
    );
    if (phaseEntities.length > 0) {
      const phaseIds = [...new Set(phaseEntities.map((e) => e.phase_id))];
      const phaseRows = await context.manager.query(
        `SELECT id, name, project_id FROM portfolio_project_phases WHERE tenant_id = $1 AND id = ANY($2)`,
        [context.tenantId, phaseIds],
      );
      const phaseById = new Map<string, any>(phaseRows.map((p: any) => [p.id, p]));
      const misScoped = phaseEntities.filter((e) => {
        const phase = phaseById.get(e.phase_id);
        return phase && phase.project_id !== e.related_object_id;
      });
      if (misScoped.length > 0) {
        const projectIds = [...new Set(misScoped.map((e) => e.related_object_id))];
        const names = [...new Set(misScoped.map((e) => String(phaseById.get(e.phase_id).name).toLowerCase()))];
        const scopedRows = await context.manager.query(
          `SELECT id, name, project_id FROM portfolio_project_phases WHERE tenant_id = $1 AND project_id = ANY($2) AND LOWER(name) = ANY($3)`,
          [context.tenantId, projectIds, names],
        );
        const scopedByKey = new Map<string, string>(
          scopedRows.map((p: any) => [`${p.project_id}|${String(p.name).toLowerCase()}`, p.id]),
        );
        for (const entity of misScoped) {
          const phaseName = String(phaseById.get(entity.phase_id).name);
          const scopedId = scopedByKey.get(`${entity.related_object_id}|${phaseName.toLowerCase()}`);
          if (scopedId) {
            entity.phase_id = scopedId;
          } else {
            throw new Error(
              `Phase "${phaseName}" does not exist in the project of task "${entity.title}". ` +
              `Create the phase in that project first, or clear the phase_name column.`,
            );
          }
        }
      }
    }

    // Final validation: linked tasks require related_object_id
    // Standalone tasks (no related_object_type) are allowed
    for (const entity of entities) {
      const hasType = !!entity.related_object_type;
      const hasId = !!entity.related_object_id;

      if (hasType && !hasId) {
        // Has type but no ID - error, should have been resolved from name
        throw new Error(
          `Task "${entity.title}" has a related_object_type but no related_object_id. ` +
          `Provide either related_object_id or related_object_name to link the task.`,
        );
      }

      // Standalone tasks are valid - no type and no id
    }

    // The viewers and owners are in viewer_ids and owner_ids (`importPeople`); drop the temp props
    // so they never reach save/audit.
    for (const entity of entities) {
      delete entity._viewer_emails;
      delete entity._owner_emails;
    }

    // Assign item_numbers to new entities
    const newEntities = entities.filter(e => !e.item_number);
    if (newEntities.length > 0) {
      const firstNumber = await allocateItemNumbers(
        'task', context.tenantId, newEntities.length, context.manager,
      );
      newEntities.forEach((e, i) => { e.item_number = firstNumber + i; });
    }
  },
};
