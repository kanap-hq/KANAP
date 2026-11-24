import type { CsvFieldDefinition, CsvImportContext, CsvImportParams, CsvImportRow, CsvPendingName } from './csv-field.types';
import type { CsvResolverService } from './csv-resolver.service';
import { importCell, noteCleared } from './csv-import-cells';
import { noteNameMatch } from '../name-matching';
import { membershipMessage, settleMembership, type MembershipKind, type MembershipPair } from '../record-membership';

/**
 * Imports and the pairs of a record (lot I7a of 26.12.1): a stream in its category, a department in its
 * company, by the one rule of `common/record-membership.ts`.
 *
 * P12: a name several records share (two streams "Ops" of two categories) is looked up in the row's
 * parent: the parent the row changes, else the stored record of that name, else the parent the row
 * or the record gives (a task of a project: its project's, `inheritedValues`). Still several, or none:
 * the row is refused, naming the parents that have one. P13: the child gives its parent, a parent
 * changed alone drops a child of another parent, and a pair that contradicts itself is a row error.
 * Only what the row changes is checked: a file exported then imported again changes nothing.
 */

type Inherited = Map<CsvImportRow, Record<string, string | null>> | null;

/** The kind of each family whose names several records share. */
const KIND_OF: Record<string, MembershipKind> = { portfolio_streams: 'stream', departments: 'department' };

interface ImportPair {
  pair: MembershipPair;
  child: CsvFieldDefinition;
  parent: CsvFieldDefinition | null;
  fkEntity: string;
  parentEntity: string;
}

const has = (values: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(values, key);
const sameId = (left: unknown, right: unknown) => String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase();

/** The pairs among the import's fields: a single reference to a family with a parent, and the field of that parent. */
function importPairs(fields: CsvFieldDefinition[], resolver: CsvResolverService): ImportPair[] {
  const pairs: ImportPair[] = [];
  for (const child of fields) {
    const parent = child.fkEntity && !child.arrayIndex ? resolver.parentOf(child.fkEntity) : null;
    if (!parent || !KIND_OF[child.fkEntity!]) continue;
    pairs.push({
      pair: { kind: KIND_OF[child.fkEntity!], child: child.entityProperty, parent: parent.column },
      child,
      parent: fields.find((field) => field.entityProperty === parent.column) ?? null,
      fkEntity: child.fkEntity!,
      parentEntity: parent.entity,
    });
  }
  return pairs;
}

/** A row the operation does not write (the shared import skips it): nothing to settle there. */
function skipped(row: CsvImportRow, operation: CsvImportParams['operation']): boolean {
  return !!row.leftOut || (operation === 'update_only' && row.isInsert) || (operation === 'insert_only' && !row.isInsert);
}

/** Whether the row gives a field: its cell holds a value or `-`, and the field is still in the row. */
function gives(row: CsvImportRow, field: CsvFieldDefinition | null): boolean {
  return !!field && importCell(row.raw, field.csvColumn).kind !== 'blank' && has(row.parsed, field.entityProperty);
}

/** The record as stored, the inherited values standing where it has none of its own. */
function storedOf(row: CsvImportRow, inherited: Inherited): Record<string, unknown> | null {
  const stored = row.existingEntity ?? null;
  const shown = inherited?.get(row);
  if (!shown) return stored;
  const values: Record<string, unknown> = { ...(stored ?? {}) };
  for (const [key, value] of Object.entries(shown)) if (values[key] == null) values[key] = value;
  return values;
}

/** The names of records of a family, by id, from the import's cache. */
function namesOf(resolver: CsvResolverService, entityType: string, context: CsvImportContext): Map<string, string> {
  const names = new Map<string, string>();
  for (const [id, name] of resolver.buildReverseLookup(entityType, context.resolverCache)) names.set(String(id).toLowerCase(), name);
  return names;
}

/**
 * The names several records share, looked up in the row's parent. `final`: the last pass, after the
 * config's hooks; before it, a name whose parent is not known yet waits when the config gives inherited
 * values. A name settled by its accents is a match the result lists.
 */
export function settlePendingNames(
  rows: CsvImportRow[],
  fields: CsvFieldDefinition[],
  context: CsvImportContext,
  resolver: CsvResolverService,
  options: { inherited: Inherited; final: boolean; waits: boolean },
): void {
  const pairs = importPairs(fields, resolver);
  for (const row of rows) {
    if (!row.pendingNames?.length) continue;
    if (row.errors.length > 0 || skipped(row, context.params.operation)) {
      if (options.final) row.pendingNames = [];
      continue;
    }
    const left: CsvPendingName[] = [];
    for (const pending of row.pendingNames) {
      const pair = pairs.find((candidate) => candidate.child.entityProperty === pending.property);
      if (!pair) continue;
      const parentKey = pair.pair.parent;
      const stored = storedOf(row, options.inherited);
      const parentChanged = gives(row, pair.parent) && !sameId(row.parsed[parentKey], stored?.[parentKey]);
      const storedChild = pending.entries.find((entry) => sameId(entry.id, stored?.[pending.property]));
      const parent = gives(row, pair.parent) ? row.parsed[parentKey] : (row.parsed[parentKey] ?? stored?.[parentKey]);
      let chosen = !parentChanged ? storedChild : undefined;
      if (!chosen && parent) {
        const inParent = pending.entries.filter((entry) => sameId(entry[parentKey], parent));
        if (inParent.length === 1) chosen = inParent[0];
      }
      if (chosen) {
        row.parsed[pending.property] = chosen.id;
        if (pending.how === 'accents' && context.nameMatches) {
          const { target, ref } = resolver.describeEntry(pending.fkEntity, chosen as any);
          noteNameMatch(context.nameMatches, {
            column: pending.column, name: null, value: pending.value, target, ref, origin: 'server', reason: 'accents', undoable: true,
          }, row.rowNumber);
        }
        continue;
      }
      if (!parent && options.waits && !options.final) {
        left.push(pending);
        continue;
      }
      const parentNames = namesOf(resolver, pair.parentEntity, context);
      const parents = [...new Set(pending.entries.map((entry) => String(entry[parentKey] ?? '').toLowerCase()))]
        .map((id) => parentNames.get(id) ?? id)
        .sort((left, right) => left.localeCompare(right))
        .join(', ');
      const columns = pair.parent?.csvColumn ?? parentKey;
      const code = pair.pair.kind === 'stream' ? 'CSV_STREAM_IN_SEVERAL_CATEGORIES' : 'CSV_DEPARTMENT_IN_SEVERAL_COMPANIES';
      const plural = pair.pair.kind === 'stream' ? 'categories' : 'companies';
      row.errors.push({
        row: row.rowNumber,
        column: pending.column,
        code,
        message: `"${pending.value}" names a ${pair.pair.kind} in each of the ${plural} ${parents}: give one of them in ${columns}.`,
        params: { value: pending.value, parents, columns },
      });
    }
    row.pendingNames = left;
  }
}

/**
 * The pair check of each row that changes a stream, a category, a department or a company: the parent
 * a child gives is filled, a child its parent's change drops is cleared (and counted), a pair that
 * contradicts itself is a row error naming the child and both parents.
 */
export function checkImportMembership(
  rows: CsvImportRow[],
  fields: CsvFieldDefinition[],
  context: CsvImportContext,
  resolver: CsvResolverService,
  inherited: Inherited,
): void {
  const pairs = importPairs(fields, resolver);
  if (pairs.length === 0) return;
  const entityOfKind = new Map(pairs.map((pair) => [pair.pair.kind, pair.fkEntity]));
  const parentOf = (kind: MembershipKind, id: string) => {
    const fkEntity = entityOfKind.get(kind);
    const parent = fkEntity ? resolver.parentOf(fkEntity) : null;
    const entry = fkEntity ? resolver.entryById(fkEntity, id, context.resolverCache) : null;
    return entry && parent ? (entry[parent.column] ?? null) : undefined;
  };
  for (const row of rows) {
    if (row.errors.length > 0 || skipped(row, context.params.operation)) continue;
    const given: Record<string, unknown> = {};
    for (const pair of pairs) {
      if (gives(row, pair.child)) given[pair.pair.child] = row.parsed[pair.pair.child];
      if (gives(row, pair.parent)) given[pair.pair.parent] = row.parsed[pair.pair.parent];
    }
    if (Object.keys(given).length === 0) continue;
    const stored = storedOf(row, inherited);
    const { values, conflict } = settleMembership(pairs.map((pair) => pair.pair), given, stored, parentOf);
    if (conflict) {
      const pair = pairs.find((candidate) => candidate.pair === conflict.pair)!;
      const childEntry = resolver.entryById(pair.fkEntity, conflict.childId, context.resolverCache);
      const parentNames = namesOf(resolver, pair.parentEntity, context);
      const nameOf = (id: string) => parentNames.get(id.toLowerCase()) ?? id;
      const refusal = membershipMessage(conflict.pair.kind, {
        child: String(childEntry?._originalLookupValue ?? conflict.childId),
        childParent: nameOf(conflict.childParentId),
        parent: nameOf(conflict.parentId),
      });
      row.errors.push({ row: row.rowNumber, column: pair.child.csvColumn, ...refusal });
      continue;
    }
    for (const [key, value] of Object.entries(values)) {
      // A child given back as stored, with its parent changed, is dropped as well (`settleMembership`).
      if (sameId(row.parsed[key], value)) continue;
      if (value == null && row.parsed[key] != null && row.existingEntity?.[key] != null) noteCleared(row, 1);
      row.parsed[key] = value;
    }
  }
}
