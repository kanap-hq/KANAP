import {
  CsvEntityConfig,
  CsvExportContext,
  CsvFieldType,
  CsvImportContext,
  importCell,
  refuseClear,
} from '../common/csv';
import { CsvCellError, CsvImportRow } from '../common/csv/csv-field.types';
import { isCalendarDate } from '../common/report-period';
import {
  accentFreeKey, foldKey, noteNameMatch, noteRefusedProposal, proposalFor, undoneMatch, type MatchHow,
} from '../common/name-matching';
import { formatCsvDateTime, instantInTimeZone, type CsvLanguage } from '../common/csv-sheet';
import { allocateItemNumbers } from '../common/item-number.service';
import { parseItemNumber } from '../common/parse-item-number';
import { normalizeMarkdownRichText } from '../common/markdown-worker';
import { findCatalogOption, offeredCatalogList, requireImportCatalogs, type CatalogOptionLike } from '../it-ops-settings/catalog-resolve';
import { keepStoredSlotBodies, sameAsStoredWithDocuments } from '../knowledge/integrated-document-bodies';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, isReservedIncidentStatusMove } from './incident.entity';
import { incidentVisibleToViewer, type IncidentViewer, type IncidentVisibilityRow } from './incident-visibility';
import { numberedReference } from '../common/csv-sheet/master-data';

/**
 * The headers of the register's file in each language. The export writes them, and the import
 * accepts them as well as the technical columns (`ref`, `title`, ...), so a file exported in
 * French reads back in French or in any other language.
 */
const INCIDENT_CSV_HEADERS: Record<string, Record<CsvLanguage, string>> = {
  ref: { en: 'Ref', fr: 'Réf.', de: 'Ref.', es: 'Ref.' },
  title: { en: 'Title', fr: 'Titre', de: 'Titel', es: 'Título' },
  category: { en: 'Category', fr: 'Catégorie', de: 'Kategorie', es: 'Categoría' },
  severity: { en: 'Severity', fr: 'Gravité', de: 'Schweregrad', es: 'Gravedad' },
  status: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  confidential: {
    en: 'Restricted to register administrators',
    fr: 'Restreint aux administrateurs du registre',
    de: 'Auf Registeradministratoren beschränkt',
    es: 'Restringido a administradores del registro',
  },
  started_at: { en: 'Started', fr: 'Début', de: 'Beginn', es: 'Inicio' },
  detected_at: { en: 'Detected', fr: 'Détecté', de: 'Erkannt', es: 'Detectado' },
  resolved_at: { en: 'Resolved', fr: 'Résolu', de: 'Behoben', es: 'Resuelto' },
  closed_at: { en: 'Closed', fr: 'Clôturé', de: 'Geschlossen', es: 'Cerrado' },
  reporter: { en: 'Reporter', fr: 'Déclarant', de: 'Melder', es: 'Notificante' },
  owner: { en: 'Owner', fr: 'Responsable', de: 'Verantwortlicher', es: 'Responsable' },
  description: { en: 'Description', fr: 'Description', de: 'Beschreibung', es: 'Descripción' },
  review: { en: 'Incident review', fr: "Revue d'incident", de: 'Vorfallsanalyse', es: 'Revisión de incidente' },
  source_ref: { en: 'External reference', fr: 'Référence externe', de: 'Externe Referenz', es: 'Referencia externa' },
  personal_data_affected: {
    en: 'Personal data affected',
    fr: 'Données personnelles concernées',
    de: 'Personenbezogene Daten betroffen',
    es: 'Datos personales afectados',
  },
  authority_notification_required: {
    en: 'Authority notification required',
    fr: 'Notification aux autorités requise',
    de: 'Meldung an Behörde erforderlich',
    es: 'Requiere notificación a la autoridad',
  },
  authority_notified_at: { en: 'Notified on', fr: 'Notifié le', de: 'Gemeldet am', es: 'Notificado el' },
  notified_parties: { en: 'Parties informed', fr: 'Parties informées', de: 'Informierte Parteien', es: 'Partes informadas' },
};

/** The severity as the screen names it, in the language of the file. */
const INCIDENT_SEVERITY_LABELS: Record<CsvLanguage, Record<string, string>> = {
  en: { critical: 'Critical', major: 'Major', minor: 'Minor', low: 'Low' },
  fr: { critical: 'Critique', major: 'Majeure', minor: 'Mineure', low: 'Faible' },
  de: { critical: 'Kritisch', major: 'Hoch', minor: 'Mittel', low: 'Niedrig' },
  es: { critical: 'Crítica', major: 'Alta', minor: 'Media', low: 'Baja' },
};

/** The status as the screen names it, in the language of the file. */
const INCIDENT_STATUS_LABELS: Record<CsvLanguage, Record<string, string>> = {
  en: { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled' },
  fr: { open: 'Ouvert', in_progress: 'En cours', resolved: 'Résolu', closed: 'Clôturé', cancelled: 'Annulé' },
  de: { open: 'Offen', in_progress: 'In Bearbeitung', resolved: 'Behoben', closed: 'Geschlossen', cancelled: 'Abgebrochen' },
  es: { open: 'Abierto', in_progress: 'En curso', resolved: 'Resuelto', closed: 'Cerrado', cancelled: 'Cancelado' },
};

/** The code of a value written in any of the four languages, or null when no label matches. */
function codeFromLabels(
  value: string,
  labels: Record<CsvLanguage, Record<string, string>>,
): string | null {
  const text = value.trim().toLowerCase().normalize('NFC');
  for (const byCode of Object.values(labels)) {
    for (const [code, label] of Object.entries(byCode)) {
      if (label.toLowerCase().normalize('NFC') === text) return code;
    }
  }
  return null;
}

/**
 * CSV configuration for the incident register.
 *
 * Column order: ref (INC-N), title, then the overview of IncidentWorkspacePage.tsx: description,
 * incident review (the integrated document, virtual column), then the properties drawer top to
 * bottom (category to notified parties).
 *
 * Import is a first-class path: customers arrive with an Excel register.
 * A row with a known ref updates that incident (closure lock does not apply to
 * imports), a row with a blank ref inserts and gets its INC-N allocated in bulk.
 * Timeline entries are never imported; each inserted row gets one 'system' entry.
 */

const REF_INPUT_RE = /^(?:INC[-\s]?)?(\d+)$/i;

/** Reason written on the entries an import creates (inserted rows, Reopen and Cancel moves). */
export const IMPORT_ENTRY_CONTENT = 'Imported from CSV';

/** Rows inserted by the current import, marked in beforeCommit, journalled in afterCommit. */
const insertedByImport = new WeakSet<object>();

/**
 * The rows whose reference names an incident the person does not read, with its number: kept out of
 * the load's lookup by `beforeValidate`, so the load neither finds nor locks it, and given back to the
 * row by `settleRows` (lot I6c of 26.12.1).
 */
const hiddenReferences = new WeakMap<object, number>();

/**
 * `review` is a virtual column. It is parsed onto the entity like any other
 * field, then moved off it in `beforeCommit` into this map, so `repo.save`
 * (and the audit snapshot it feeds) never sees a column `incidents` does not
 * have. `IncidentsCsvService` drains it in `afterCommit`.
 */
export const REVIEW_ENTITY_PROPERTY = 'review';
const pendingReviewByEntity = new WeakMap<object, string | null>();

/** Status the row had before the import, for the closure snapshot in afterCommit. */
const previousStatusByEntity = new WeakMap<object, string | null>();

/** True when the row carried a `review` cell (even an empty one). */
export function hasPendingIncidentReview(entity: object): boolean {
  return pendingReviewByEntity.has(entity);
}

/** Reads and clears the pending review body for one imported row. */
export function takePendingIncidentReview(entity: object): string | null {
  const value = pendingReviewByEntity.get(entity) ?? null;
  pendingReviewByEntity.delete(entity);
  return value;
}

/**
 * True while this row is being inserted by the current import.
 *
 * The authoritative insert marker: an existing row can never be mistaken for a
 * new one, which `previousStatus === null` cannot guarantee (that value is also
 * null once it has been consumed, or when the pre-image read came back empty).
 * Cleared by the base `afterCommit`, which runs after the review hooks.
 */
export function wasInsertedByImport(entity: object): boolean {
  return insertedByImport.has(entity);
}

/** Status of the row before this import: null for an inserted incident. */
export function takePreviousIncidentStatus(entity: object): string | null {
  const value = previousStatusByEntity.get(entity) ?? null;
  previousStatusByEntity.delete(entity);
  return value;
}

function incidentLabel(entity: any): string {
  return entity.item_number ? `INC-${entity.item_number}` : `"${entity.title ?? ''}"`;
}

/** The refusal of a status move only an administrator may make by import. */
export function importStatusReservedMessage(label: string, from: string, to: string): string {
  return `${label}: status cannot change from "${from}" to "${to}" through import. `
    + 'Only a register administrator can do that; use Reopen or Cancel in the app instead.';
}

/**
 * The status as the file names it, the same words the status column exports.
 * An unknown code stays the code. Without a file language, the code stays too.
 */
function incidentStatusLabel(code: unknown, language: CsvLanguage | undefined): string {
  const value = String(code);
  if (!language) return value;
  return INCIDENT_STATUS_LABELS[language]?.[value] ?? value;
}

const IMPORT_STATUS_RESERVED_CODE = 'CSV_INCIDENT_STATUS_RESERVED';
const IMPORT_REFERENCE_INVALID_CODE = 'CSV_INCIDENT_REFERENCE_INVALID';

/** The refusal of a ref cell that is not an incident reference (INC-12) or a bare number. */
function invalidReferenceMessage(value: string): string {
  return `Invalid reference "${value}". Use the incident reference (INC-12), or leave the column empty to create a new incident.`;
}

/** The refusal of a category that is not in the register's list. The English sentence stays for the API. */
function unknownCategoryMessage(label: string, category: string, names: string): string {
  return `${label}: unknown category "${category}". Use one of ${names}, or add it under IT settings first.`;
}

function importViewer(context: CsvImportContext): IncidentViewer {
  return context.viewer ?? { userId: context.userId ?? null, isAdmin: context.isAdmin === true };
}

const UNKNOWN_REF_HINT = 'Leave the ref column empty to create new incidents.';

/**
 * The refusal of a reference the import does not find for the person (lot I6c of 26.12.1): no
 * incident of the workspace has it, or the person does not read that incident (a confidential one
 * outside their participation). One answer for both, as the reference lookup of the other families
 * (`CSV_RECORD_REFERENCE_NOT_FOUND`): nothing tells a hidden incident from a missing one.
 */
function unknownReferenceError(row: { rowNumber: number }, itemNumber: number): CsvImportRow['errors'][number] {
  const reference = `INC-${itemNumber}`;
  return {
    row: row.rowNumber,
    column: 'ref',
    message: `"${reference}" is no reference in this workspace. ${UNKNOWN_REF_HINT}`,
    code: 'CSV_RECORD_REFERENCE_NOT_FOUND',
    params: { value: reference },
  };
}

/**
 * Accept an incident reference (INC-12), a bare item number, or nothing.
 * Kept in sync with the ref stripping done on the raw rows in beforeValidate,
 * which is what identity resolution matches on.
 */
function parseRef(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;
  const match = REF_INPUT_RE.exec(text);
  const number = match ? parseItemNumber(match[1]) : null;
  if (number == null) {
    throw new CsvCellError(IMPORT_REFERENCE_INVALID_CODE, invalidReferenceMessage(value), { value });
  }
  return number;
}

function refuseDate(column: string, value: string): never {
  throw new CsvCellError(
    'CSV_DATE_INVALID',
    `Invalid date in ${column}: "${value}". Use 2026-09-02, 2026-09-02T14:32:00Z or 02/09/2026 14:32.`,
    { value },
  );
}

/**
 * Date + time entry, read in the zone the column's header names (`detected_at
 * (Europe/Paris)`, as the export writes it), UTC when it names none. Accepts the
 * export's form (`16/10/2026 10:38`, `2026-10-16 10:38`), the European formats
 * Excel produces, a plain day (the zone's midnight) and ISO with its own offset
 * (2026-09-02T14:32:00Z), which wins over the header. A day that is not on the
 * calendar (`31/31/2026`) is refused: the clock math would roll it into another month.
 */
function parseDateTime(value: string, column: string, timeZone = 'UTC'): Date | null {
  const text = value.trim();
  if (text === '') return null;
  const pad = (part: string) => part.padStart(2, '0');

  const yearFirst = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  const euro = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  const parts = yearFirst
    ? [yearFirst[1], yearFirst[2], yearFirst[3], yearFirst[4], yearFirst[5], yearFirst[6]]
    : euro ? [euro[3], euro[2], euro[1], euro[4], euro[5], euro[6]] : null;
  if (parts) {
    const [year, month, day, hour, minute, second] = parts;
    const isoDay = `${year}-${pad(month)}-${pad(day)}`;
    if (!isCalendarDate(isoDay)) refuseDate(column, value);
    const time = hour == null ? null : `${pad(hour)}:${minute}:${second ?? '00'}`;
    const read = instantInTimeZone(isoDay, time, timeZone);
    if (!isNaN(read.getTime())) return read;
  }

  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) refuseDate(column, value);
  return parsed;
}

/** Codes and labels both accepted: "In progress", "in progress", "in_progress" and "En cours" all mean in_progress. */
function parseCode(
  value: string,
  valid: readonly string[],
  column: string,
  labels?: Record<CsvLanguage, Record<string, string>>,
): string {
  const fromLabel = labels ? codeFromLabels(value, labels) : null;
  if (fromLabel) return fromLabel;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!valid.includes(normalized)) {
    const allowed = valid.join(', ');
    throw new CsvCellError(
      'CSV_ENUM_INVALID',
      `Invalid ${column}: "${value}". Valid values: ${allowed}`,
      { value, allowed },
    );
  }
  return normalized;
}

/**
 * Users are preloaded by e-mail. A name matches in either order ("First Last" or "Last First"),
 * repeated spaces aside: case aside (one step, as before lot I3: two people whose names differ only by
 * case are both named), then accents aside for a person whose rights the import knows and who has not
 * undone that match (a match, listed; `common/name-matching.ts`). The first step that finds anyone
 * decides: several people there refuse the cell (`CSV_NAME_AMBIGUOUS_AMONG`, named by e-mail). The cache includes disabled
 * accounts, so a disabled account with the same name as an enabled one makes the name ambiguous.
 * One person counts once per spelling, even when both orders produce it ("Anna Anna", or a person
 * with only one name filled). Kad's proposal comes first: an e-mail or a name, exactly or case aside.
 */
type NamedPerson = { id: string; email: string; name: string };
type PeopleIndex = Record<'case' | 'accents', Map<string, Map<string, NamedPerson>>>;

const userNameIndexes = new WeakMap<Map<string, any>, PeopleIndex>();

/** The spelling the import compares at each step: trimmed, inner spaces collapsed, case aside, then accents aside. */
function personNameKeys(value: string): Record<keyof PeopleIndex, string> {
  const spaced = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return { case: foldKey(spaced), accents: accentFreeKey(spaced) };
}

function peopleByName(users: Map<string, any>): PeopleIndex {
  const cached = userNameIndexes.get(users);
  if (cached) return cached;

  const index: PeopleIndex = { case: new Map(), accents: new Map() };
  for (const [email, user] of users) {
    const id = user?.id;
    if (typeof id !== 'string' || id === '') continue;
    const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    const orders = [name, `${user.last_name ?? ''} ${user.first_name ?? ''}`];
    for (const level of ['case', 'accents'] as const) {
      for (const order of orders) {
        const spelling = personNameKeys(order)[level];
        if (!spelling) continue;
        let people = index[level].get(spelling);
        if (!people) {
          people = new Map();
          index[level].set(spelling, people);
        }
        // The id is the key, so both orders of one person stay a single candidate.
        if (!people.has(id)) people.set(id, { id, email: String(email), name });
      }
    }
  }
  userNameIndexes.set(users, index);
  return index;
}

/** The people a name finds at the first step that finds anyone (`accents` only `beyondCase`). */
function findPeople(users: Map<string, any>, text: string, beyondCase: boolean): { people: NamedPerson[]; how: MatchHow } {
  const index = peopleByName(users);
  const keys = personNameKeys(text);
  for (const level of beyondCase ? (['case', 'accents'] as const) : (['case'] as const)) {
    const people = index[level].get(keys[level]);
    if (people && people.size > 0) return { people: [...people.values()], how: level };
  }
  return { people: [], how: 'case' };
}

function resolveUser(value: string, column: string, context: CsvImportContext, line: number): string | null {
  const text = value.trim();
  if (text === '') return null;

  const users = context.resolverCache.get('users');
  if (!users) return null;

  const byEmail = users.get(text.toLowerCase());
  if (byEmail) return byEmail.id;

  const { params } = context;
  const reads = !!context.access;
  const undone = undoneMatch(params.unmatched, column, text);
  const note = (person: NamedPerson, origin: 'server' | 'model') => {
    if (!context.nameMatches) return;
    noteNameMatch(context.nameMatches, {
      column, name: null, value: text, target: person.name, ref: null, origin, reason: origin === 'model' ? 'model' : 'accents', undoable: true,
    }, line);
  };
  const proposal = undone ? undefined : proposalFor(params.proposals, column, text);
  if (proposal !== undefined) {
    const proposedByEmail = reads ? users.get(proposal.toLowerCase()) : undefined;
    const proposed = proposedByEmail?.id
      ? [{ id: proposedByEmail.id, email: proposal.toLowerCase(), name: `${proposedByEmail.first_name ?? ''} ${proposedByEmail.last_name ?? ''}`.trim() }]
      : reads ? findPeople(users, proposal, false).people : [];
    // The server's own match first (lot I6b of 26.12.1): Kad naming the person the cell finds alone is
    // no proposal to list, taken or refused; the cell follows its own rule below.
    const own = proposed.length === 1 ? findPeople(users, text, reads).people : [];
    const same = own.length === 1 && own[0].id === proposed[0].id;
    if (proposed.length === 1 && !same) {
      note(proposed[0], 'model');
      return proposed[0].id;
    }
    if (!same && context.refusedProposals) {
      noteRefusedProposal(context.refusedProposals, { column, name: null, value: text, target: proposal, reason: 'missing' }, line);
    }
  }

  const found = findPeople(users, text, reads && !undone);
  if (found.people.length === 0) {
    throw new CsvCellError(
      'CSV_REFERENCE_NOT_FOUND',
      `User not found for ${column}: "${value}". Use the account e-mail or the name in either order ("First Last" or "Last First").`,
      { value: text },
    );
  }
  if (found.people.length === 1) {
    if (found.how === 'accents') note(found.people[0], 'server');
    return found.people[0].id;
  }

  const emails = found.people
    .map((person) => person.email)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  throw new CsvCellError(
    'CSV_NAME_AMBIGUOUS_AMONG',
    `Several people match ${column} "${value}": ${emails.join(', ')}. Use the account e-mail.`,
    { value: text, names: emails.join(', ') },
  );
}

const DATE_TIME_COLUMNS = ['started_at', 'detected_at', 'resolved_at', 'closed_at', 'authority_notified_at'] as const;

function dateTimeField(csvColumn: (typeof DATE_TIME_COLUMNS)[number], label: string, group: string) {
  return {
    csvColumn,
    entityProperty: csvColumn,
    type: CsvFieldType.STRING,
    required: false,
    defaultExport: true,
    label,
    group,
    // The header names the zone of the cells: `detected_at (Europe/Paris)`.
    zonedDateTime: true,
    importTransformFn: (value: string, _row: Record<string, string>, context: CsvImportContext) =>
      parseDateTime(value, csvColumn, context?.timeZones?.[csvColumn]),
    // The export language's day and the time of the exporting user's zone (`16/10/2026 10:38`);
    // `parseDateTime` reads it back in the zone the header names.
    exportFn: (entity: Record<string, unknown>, context: CsvExportContext) => {
      const value = entity[csvColumn];
      return value == null || value === '' ? '' : formatCsvDateTime(value as Date | string, context.language, context.timeZone);
    },
  };
}

function textField(csvColumn: string, label: string, group: string) {
  return {
    csvColumn,
    entityProperty: csvColumn,
    type: CsvFieldType.STRING,
    required: false,
    defaultExport: true,
    label,
    group,
  };
}

/**
 * An unknown category, or a retired one the incident does not hold (rule P7), as a row error of the
 * check and of the load. A name that matches several categories stays the write-time refusal: that
 * sentence is not one of these row errors.
 */
async function refuseUnknownCategories(rows: CsvImportRow[], context: CsvImportContext): Promise<void> {
  const filled = rows.filter((row) => {
    const category = row.parsed.category;
    return category != null && String(category).trim() !== '';
  });
  if (filled.length === 0) return;
  const categories = (await requireImportCatalogs(context)).incidentCategories;
  const names = categories.map((category) => category.label).join(', ');
  for (const row of filled) {
    const category = String(row.parsed.category);
    let resolved: CatalogOptionLike | null;
    try {
      resolved = findCatalogOption(category, categories);
    } catch {
      continue;
    }
    const label = incidentLabel(row.existingEntity?.item_number ? row.existingEntity : { title: row.parsed.title });
    if (resolved) {
      // Rule P7: a retired category only on the incident the row updates, when it already holds it.
      const held = row.isInsert ? null : row.existingEntity?.category ?? null;
      if (!resolved.deprecated || held === resolved.code) continue;
      const allowed = offeredCatalogList(categories, held);
      const name = resolved.label || resolved.code;
      row.errors.push({
        row: row.rowNumber,
        column: 'category',
        message: `${label}: the category "${name}" is no longer offered. Use one of ${allowed}.`,
        code: 'catalog_value_retired',
        params: { value: name, allowed, valueCode: resolved.code, list: 'incidentCategories' },
      });
      continue;
    }
    row.errors.push({
      row: row.rowNumber,
      column: 'category',
      message: unknownCategoryMessage(label, category, names),
      code: 'CSV_ENUM_INVALID',
      params: { value: category, allowed: names },
    });
  }
}

export const incidentCsvConfig: CsvEntityConfig = {
  entityName: 'incident',
  // The sheet of an xlsx export: the list's title on screen.
  sheetNames: { en: 'Incident register', fr: 'Registre des incidents', de: 'Vorfallsregister', es: 'Registro de incidentes' },
  tableName: 'incidents',
  displayName: 'Incidents',
  // INC-N is the register's identity; the export writes it, the import matches on it.
  upsertKey: ['item_number'],
  // How the check names a record a row updates (Q1 of 26.11.9).
  recordLabel: (entity) => ({ ref: numberedReference('INC', entity.item_number), name: String(entity.title ?? '') }),
  // Column headers in the file's language; the import accepts them as well as the technical names.
  headerLabels: INCIDENT_CSV_HEADERS,
  fields: [
    // === IDENTITY ===
    {
      csvColumn: 'ref',
      entityProperty: 'item_number',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Reference',
      group: 'Identity',
      importTransformFn: (value: string) => parseRef(value),
    },
    {
      csvColumn: 'title',
      entityProperty: 'title',
      type: CsvFieldType.STRING,
      required: true,
      defaultExport: true,
      label: 'Title',
      group: 'Overview',
    },

    // === OVERVIEW TAB (description, review, properties) ===
    textField('description', 'Description', 'Record'),
    // Virtual column: the review lives in the `incidents:review` integrated
    // document, not on `incidents` (§3.8). `beforeCommit` moves it off the
    // entity so nothing tries to save a `review` column, and the CSV service
    // writes it through the dedicated import primitive after the upsert.
    // The Markdown is validated here, so a dry run reports a bad cell without
    // provisioning or writing anything.
    {
      csvColumn: 'review',
      entityProperty: REVIEW_ENTITY_PROPERTY,
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Incident review',
      group: 'Record',
      // Processed in the Markdown workers, within the time budget of the file's rich-text cells.
      importTransformFn: async (value: string, _row: Record<string, string>, context: CsvImportContext) =>
        await normalizeMarkdownRichText(value, { fieldName: 'review', budget: context.markdownBudget }) ?? '',
    },
    {
      csvColumn: 'category',
      entityProperty: 'category',
      // Settings-backed (incidentCategories): codes and labels are resolved in
      // beforeCommit, so no hard-coded enum gate here (same pattern as asset.kind).
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Category',
      group: 'Overview',
    },
    {
      csvColumn: 'severity',
      entityProperty: 'severity',
      type: CsvFieldType.STRING,
      enumValues: [...INCIDENT_SEVERITIES],
      required: true,
      defaultExport: true,
      label: 'Severity',
      group: 'Overview',
      exportFn: (entity: any, context: CsvExportContext) =>
        INCIDENT_SEVERITY_LABELS[context.language]?.[String(entity.severity)] ?? String(entity.severity ?? ''),
      importTransformFn: (value: string) => parseCode(value, INCIDENT_SEVERITIES, 'severity', INCIDENT_SEVERITY_LABELS),
    },
    {
      csvColumn: 'status',
      entityProperty: 'status',
      type: CsvFieldType.STRING,
      enumValues: [...INCIDENT_STATUSES],
      required: false,
      defaultExport: true,
      label: 'Status',
      group: 'Overview',
      exportFn: (entity: any, context: CsvExportContext) =>
        INCIDENT_STATUS_LABELS[context.language]?.[String(entity.status)] ?? String(entity.status ?? ''),
      importTransformFn: (value: string) => parseCode(value, INCIDENT_STATUSES, 'status', INCIDENT_STATUS_LABELS),
    },
    {
      csvColumn: 'confidential',
      entityProperty: 'confidential',
      type: CsvFieldType.BOOLEAN,
      required: false,
      defaultExport: true,
      label: 'Restricted to register administrators',
      group: 'Overview',
    },
    dateTimeField('started_at', 'Started', 'Timeline'),
    dateTimeField('detected_at', 'Detected', 'Timeline'),
    dateTimeField('resolved_at', 'Resolved', 'Timeline'),
    dateTimeField('closed_at', 'Closed', 'Timeline'),
    {
      csvColumn: 'reporter',
      entityProperty: 'reporter_user_id',
      type: CsvFieldType.FK_BY_EMAIL,
      fkEntity: 'users',
      fkLookupColumn: 'email',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Reporter',
      group: 'People',
      importTransformFn: (value: string, _row: Record<string, string>, context: CsvImportContext, line = 0) =>
        resolveUser(value, 'reporter', context, line),
    },
    {
      csvColumn: 'owner',
      entityProperty: 'owner_user_id',
      type: CsvFieldType.FK_BY_EMAIL,
      fkEntity: 'users',
      fkLookupColumn: 'email',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Owner',
      group: 'People',
      importTransformFn: (value: string, _row: Record<string, string>, context: CsvImportContext, line = 0) =>
        resolveUser(value, 'owner', context, line),
    },
    textField('source_ref', 'External reference', 'Source'),
    {
      csvColumn: 'personal_data_affected',
      entityProperty: 'personal_data_affected',
      type: CsvFieldType.BOOLEAN,
      required: false,
      defaultExport: true,
      label: 'Personal data affected',
      group: 'Compliance',
    },
    {
      csvColumn: 'authority_notification_required',
      entityProperty: 'authority_notification_required',
      type: CsvFieldType.BOOLEAN,
      required: false,
      defaultExport: true,
      label: 'Authority notification required',
      group: 'Compliance',
    },
    dateTimeField('authority_notified_at', 'Authority notified on', 'Compliance'),
    textField('notified_parties', 'Parties informed', 'Compliance'),
  ],

  /**
   * Identity resolution reads the raw cells, so INC-12 (or INC-0012) has to become 12 before the
   * existing incidents are loaded. Mutating `raw` here is what the import service then matches and
   * parses. A reference that is no number (`INC-3000000000`) is left as it came: the cell's own
   * reading refuses it, once.
   *
   * Then whether the person reads each incident named, on a read that locks nothing (lot I6c of
   * 26.12.1): the reference of one they do not read is taken off the row, so the load does not find,
   * lock or wait for it, as for a reference no incident has; `settleRows` gives it back.
   */
  beforeValidate: async (rows, context) => {
    const named = new Map<number, CsvImportRow[]>();
    for (const row of rows) {
      const value = row.raw.ref;
      if (typeof value !== 'string') continue;
      const match = REF_INPUT_RE.exec(value.trim());
      const number = match ? parseItemNumber(match[1]) : null;
      if (number == null) continue;
      row.raw.ref = String(number);
      named.set(number, [...(named.get(number) ?? []), row]);
    }
    if (named.size === 0) return;
    const viewer = importViewer(context);
    const stored: Array<{ item_number: number } & IncidentVisibilityRow> = await context.manager.query(
      `SELECT item_number, confidential, reporter_user_id, owner_user_id FROM incidents
       WHERE tenant_id = $1 AND item_number = ANY($2::int[])`,
      [context.tenantId, [...named.keys()]],
    );
    for (const incident of stored) {
      if (incidentVisibleToViewer(incident, viewer)) continue;
      for (const row of named.get(Number(incident.item_number)) ?? []) {
        hiddenReferences.set(row.raw, Number(incident.item_number));
        row.raw.ref = '';
      }
    }
  },

  /**
   * A reference that names no incident the person reads (lot I6c of 26.12.1): none of the workspace,
   * or one they do not read (confidential, outside their participation). Both rows are read as a row
   * that finds no incident, refused on the reference with one same error, at the check and at the
   * load: the stored incident a hidden reference finds is never the row's, so nothing of it (its
   * values, its title, its category, its state) reaches the report.
   */
  settleRows: async (rows, context) => {
    const viewer = importViewer(context);
    // "Update only" skips a row that finds no incident, as it always has: one the person does not
    // read alike.
    const updateOnly = context.params.operation === 'update_only';
    return rows.map(({ raw, rowNumber, found }) => {
      const hidden = hiddenReferences.get(raw);
      if (hidden !== undefined) {
        // Its reference back on the row, for the file's duplicates and the cell's reading.
        raw.ref = String(hidden);
        hiddenReferences.delete(raw);
      }
      const itemNumber = typeof raw.ref === 'string' && /^\d+$/.test(raw.ref) ? parseItemNumber(raw.ref) : null;
      if (itemNumber == null) return { entity: found ?? null };
      // At the load, `found` is the incident as locked: the rule read again on it.
      if (found && incidentVisibleToViewer(found, viewer)) return { entity: found };
      if (updateOnly) return { entity: null };
      return { entity: null, errors: [unknownReferenceError({ rowNumber }, itemNumber)] };
    });
  },

  /**
   * The clearing rule (D21 of 26.11.9, T-I6f): a blank cell keeps the stored value (the shared import
   * copies it); `-` on the yes/no columns, the status and the detection time is left cleared for the
   * shared import to refuse (`CSV_VALUE_CANNOT_BE_CLEARED`: they cannot be empty), and `-` on the review
   * is refused here: the review is a versioned document, emptied on the screen. On a new incident `-`
   * reads as a blank cell.
   *
   * The forward-only lifecycle is checked here, on the matched stored row: a status that moves
   * backwards, or to `cancelled`, is reserved to `incidents:admin` (Reopen or Cancel). A
   * contributor gets a row error, with the INC-N reference, in both the preflight and the load.
   */
  afterValidate: async (rows, context) => {
    // A reference `beforeValidate` took off a row comes back through `settleRows`: a row it never came
    // back to would become a new incident. Nothing is written then.
    if (rows.some((row) => hiddenReferences.has(row.raw))) {
      throw new Error('Incident import: internal error, a reference taken off a row was not given back by settleRows.');
    }
    // A review cell that repeats its document is kept as stored, whatever tags it holds.
    await keepStoredSlotBodies(rows, context, 'incidents', { [REVIEW_ENTITY_PROPERTY]: 'review' });
    // The comparison swallows an unknown category, and the commit throw does not run on the check.
    // The row error is what the person reads, on the check and on the load.
    await refuseUnknownCategories(rows, context);
    const viewer = importViewer(context);
    for (const row of rows) {
      // A matched row an insert-only import skips is not checked.
      if (!row.isInsert && context.params.operation !== 'insert_only' && importCell(row.raw, 'review').kind === 'clear') refuseClear(row, 'review');

      // insert_only skips the matched rows; they cannot move a stored status. A cleared status is refused.
      if (viewer.isAdmin || context.params.operation === 'insert_only' || row.isInsert || row.errors.length > 0) continue;
      if (importCell(row.raw, 'status').kind === 'clear') continue;
      const previous = row.existingEntity?.status;
      const next = row.parsed.status;
      if (!isReservedIncidentStatusMove(next, previous)) continue;
      const reference = incidentLabel(row.existingEntity);
      const from = incidentStatusLabel(previous, context.language);
      const to = incidentStatusLabel(next, context.language);
      row.errors.push({
        row: row.rowNumber,
        column: 'status',
        message: importStatusReservedMessage(reference, from, to),
        code: IMPORT_STATUS_RESERVED_CODE,
        params: { reference, from, to },
      });
    }
  },

  /**
   * The category is resolved to its code and the review compared with its document (a blank
   * review cell leaves it as it is); the other columns as stored.
   */
  sameAsStored: async (rows, context) => {
    const categories = (await requireImportCatalogs(context)).incidentCategories;
    return sameAsStoredWithDocuments(rows, context, 'incidents', { [REVIEW_ENTITY_PROPERTY]: 'review' }, (next, stored) => {
      // A cell is as stored when the stored instant, written as the export writes it in the zone the
      // cell was read in, gives the same text: to the second, and either pass of the hour the clocks
      // repeat (`25/10/2026 02:30` in Paris) is the one stored. An export imported again changes nothing.
      for (const column of DATE_TIME_COLUMNS) {
        const zone = context.timeZones?.[column] ?? 'UTC';
        if (next[column] instanceof Date && stored[column] instanceof Date
          && formatCsvDateTime(stored[column], 'en', zone) === formatCsvDateTime(next[column], 'en', zone)) next[column] = stored[column];
      }
      if (!next.category) return;
      const resolved = findCatalogOption(next.category, categories)?.code;
      // Not shown: an unresolved category counts as a change. The row error is added in afterValidate.
      if (!resolved) throw new Error(`unknown category "${next.category}"`);
      next.category = resolved;
    }, { blankKeepsDocument: true });
  },

  /**
   * Resolve settings-backed categories, fill the NOT NULL columns and allocate
   * INC-N for every new row in one bulk sequence bump.
   */
  beforeCommit: async (entities: any[], context: CsvImportContext) => {
    // Virtual column: move `review` off the entity before anything saves it.
    for (const entity of entities) {
      if (!Object.prototype.hasOwnProperty.call(entity, REVIEW_ENTITY_PROPERTY)) continue;
      const value = entity[REVIEW_ENTITY_PROPERTY];
      pendingReviewByEntity.set(entity, value == null ? null : String(value));
      delete entity[REVIEW_ENTITY_PROPERTY];
    }

    // Effective catalog (defaults included), the same one the export writes names from.
    const categories = (await requireImportCatalogs(context)).incidentCategories;

    for (const entity of entities) {
      if (entity.category) {
        const resolved = findCatalogOption(entity.category, categories)?.code;
        if (!resolved) {
          throw new Error(unknownCategoryMessage(
            incidentLabel(entity),
            String(entity.category),
            categories.map((c) => c.label).join(', '),
          ));
        }
        entity.category = resolved;
      }

      if (entity.id) {
        // A stored incident keeps what a blank cell leaves; `-` on a value that cannot be empty
        // (the yes/no columns, the status, the detection time) is refused by the shared import.
        entity.updated_by = context.userId ?? null;
      } else {
        // A new incident: the yes/no columns a blank cell leaves are no.
        entity.personal_data_affected = entity.personal_data_affected ?? false;
        entity.authority_notification_required = entity.authority_notification_required ?? false;
        entity.confidential = entity.confidential ?? false;
        entity.created_by = context.userId ?? null;
        entity.status = entity.status ?? 'open';
        entity.detected_at = entity.detected_at ?? new Date();
      }
    }

    // A ref that matched nothing is a typo, not a new incident: INC-N is allocated, never chosen.
    const unknownRefs = entities.filter((e) => !e.id && e.item_number).map((e) => `INC-${e.item_number}`);
    if (unknownRefs.length > 0) {
      throw new Error(
        `Unknown incident reference(s): ${unknownRefs.join(', ')}. ${UNKNOWN_REF_HINT}`,
      );
    }

    const updateEntities = entities.filter((entity) => entity.id);
    if (updateEntities.length > 0) {
      // §3.8: the row lock is taken here, and every right (visibility, the
      // confidentiality transition) is decided on that locked initial state,
      // before any part of the row is applied. It is also the incident half of
      // the §3.3 "incident row first, document second" ordering: the review
      // writes happen later in the same transaction.
      const existing: Array<{
        id: string;
        item_number: number;
        status: string;
        confidential: boolean;
        reporter_user_id: string | null;
        owner_user_id: string | null;
      }> = await context.manager.query(
        `SELECT id, item_number, status, confidential, reporter_user_id, owner_user_id
         FROM incidents WHERE id = ANY($1::uuid[]) AND tenant_id = $2
         ORDER BY id
         FOR UPDATE`,
        [updateEntities.map((entity) => entity.id), context.tenantId],
      );
      const byId = new Map(existing.map((row) => [row.id, row]));
      const viewer = importViewer(context);
      const hidden = updateEntities.filter((entity) => {
        const row = byId.get(entity.id);
        return row && !incidentVisibleToViewer(row, viewer);
      });
      if (hidden.length > 0) {
        throw new Error(
          `Unknown incident reference(s): ${hidden.map((entity) => incidentLabel(entity)).join(', ')}. ${UNKNOWN_REF_HINT}`,
        );
      }
      const lifts = updateEntities.filter(
        (entity) => entity.confidential === false && byId.get(entity.id)?.confidential === true,
      );
      if (lifts.length > 0 && !viewer.isAdmin) {
        throw new Error(
          'Only a register administrator can lift the restriction on a confidential incident.',
        );
      }
      for (const entity of updateEntities) {
        const row = byId.get(entity.id);
        // The authoritative check, on the locked pre-image: afterValidate saw the
        // row before the lock, and another transaction may have closed it since.
        if (row && !viewer.isAdmin && isReservedIncidentStatusMove(entity.status, row.status)) {
          throw new Error(importStatusReservedMessage(
            incidentLabel(entity),
            incidentStatusLabel(row.status, context.language),
            incidentStatusLabel(entity.status, context.language),
          ));
        }
        if (entity.confidential == null) {
          entity.confidential = row?.confidential ?? false;
        }
        previousStatusByEntity.set(entity, row?.status ?? null);
      }
    }

    const newEntities = entities.filter((e) => !e.item_number);
    if (newEntities.length > 0) {
      const firstNumber = await allocateItemNumbers(
        'incident', context.tenantId, newEntities.length, context.manager,
      );
      newEntities.forEach((e, i) => {
        e.item_number = firstNumber + i;
        insertedByImport.add(e);
      });
    }
  },

  /**
   * One 'system' journal entry per imported incident. The register must show
   * where a record came from; the timeline itself is never imported.
   */
  afterCommit: async (entities: any[], context: CsvImportContext) => {
    const insertedIds: string[] = [];
    for (const entity of entities) {
      if (insertedByImport.delete(entity) && entity.id) insertedIds.push(entity.id);
    }
    if (insertedIds.length === 0) return;

    await context.manager.query(
      `INSERT INTO incident_entries (tenant_id, incident_id, kind, content, author_id)
       SELECT $1, incident_id, 'system', $3, $4 FROM unnest($2::uuid[]) AS incident_id`,
      [context.tenantId, insertedIds, IMPORT_ENTRY_CONTENT, context.userId ?? null],
    );
  },
};
