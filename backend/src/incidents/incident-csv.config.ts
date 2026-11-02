import {
  CsvEntityConfig,
  CsvExportContext,
  CsvFieldType,
  CsvImportContext,
} from '../common/csv';
import { formatCsvDateTime, instantInTimeZone, type CsvLanguage } from '../common/csv-sheet';
import { allocateItemNumbers } from '../common/item-number.service';
import { parseItemNumber } from '../common/parse-item-number';
import { normalizeMarkdownRichText } from '../common/markdown-worker';
import { findCatalogOption, requireImportCatalogs } from '../it-ops-settings/catalog-resolve';
import { sameAsStoredWithDocuments } from '../knowledge/integrated-document-bodies';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, isReservedIncidentStatusMove } from './incident.entity';
import { incidentVisibleToViewer, type IncidentViewer } from './incident-visibility';

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

const IMPORT_STATUS_RESERVED_CODE = 'CSV_INCIDENT_STATUS_RESERVED';

function importViewer(context: CsvImportContext): IncidentViewer {
  return context.viewer ?? { userId: context.userId ?? null, isAdmin: context.isAdmin === true };
}

const UNKNOWN_REF_HINT = 'Leave the ref column empty to create new incidents.';

/**
 * Accept an incident reference (INC-12), a bare item number, or nothing.
 * Kept in sync with the ref stripping done on the raw rows in beforeValidate,
 * which is what identity resolution matches on.
 */
function parseRef(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;
  const match = REF_INPUT_RE.exec(text);
  if (!match) {
    throw new Error(
      `Invalid reference "${value}". Use the incident reference (INC-12), or leave the column empty to create a new incident.`,
    );
  }
  const number = parseItemNumber(match[1]);
  if (number == null) {
    throw new Error(
      `Invalid reference "${value}". Use the incident reference (INC-12), or leave the column empty to create a new incident.`,
    );
  }
  return number;
}

/**
 * Date + time entry, read in the zone the column's header names (`detected_at
 * (Europe/Paris)`, as the export writes it), UTC when it names none. Accepts the
 * export's form (`16/10/2026 10:38`, `2026-10-16 10:38`), the European formats
 * Excel produces, a plain day (the zone's midnight) and ISO with its own offset
 * (2026-09-02T14:32:00Z), which wins over the header.
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
    const time = hour == null ? null : `${pad(hour)}:${minute}:${second ?? '00'}`;
    const read = instantInTimeZone(`${year}-${pad(month)}-${pad(day)}`, time, timeZone);
    if (!isNaN(read.getTime())) return read;
  }

  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date in ${column}: "${value}". Use 2026-09-02, 2026-09-02T14:32:00Z or 02/09/2026 14:32.`);
  }
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
    throw new Error(`Invalid ${column}: "${value}". Valid values: ${valid.join(', ')}`);
  }
  return normalized;
}

/**
 * Users are preloaded by email; fall back to "First Last" (the names the app
 * shows everywhere) using the same cache, so both spellings import.
 */
const userNameIndexes = new WeakMap<Map<string, any>, Map<string, string>>();

function resolveUser(value: string, column: string, context: CsvImportContext): string | null {
  const text = value.trim();
  if (text === '') return null;

  const users = context.resolverCache.get('users');
  if (!users) return null;

  const byEmail = users.get(text.toLowerCase());
  if (byEmail) return byEmail.id;

  let byName = userNameIndexes.get(users);
  if (!byName) {
    byName = new Map<string, string>();
    for (const user of users.values()) {
      const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim().toLowerCase();
      if (name && !byName.has(name)) byName.set(name, user.id);
    }
    userNameIndexes.set(users, byName);
  }

  const resolved = byName.get(text.toLowerCase().replace(/\s+/g, ' '));
  if (!resolved) {
    throw new Error(`User not found for ${column}: "${value}". Use the account email or the exact "First Last" name.`);
  }
  return resolved;
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

export const incidentCsvConfig: CsvEntityConfig = {
  entityName: 'incident',
  // The sheet of an xlsx export: the list's title on screen.
  sheetNames: { en: 'Incident register', fr: 'Registre des incidents', de: 'Vorfallsregister', es: 'Registro de incidentes' },
  tableName: 'incidents',
  displayName: 'Incidents',
  // INC-N is the register's identity; the export writes it, the import matches on it.
  upsertKey: ['item_number'],
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
      importTransformFn: (value: string, _row: Record<string, string>, context: CsvImportContext) =>
        resolveUser(value, 'reporter', context),
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
      importTransformFn: (value: string, _row: Record<string, string>, context: CsvImportContext) =>
        resolveUser(value, 'owner', context),
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
   * Identity resolution reads the raw cells, so INC-12 has to become 12 before
   * the existing incidents are loaded. Mutating `raw` here is what the import
   * service then matches and parses.
   */
  beforeValidate: async (rows, context) => {
    const itemNumbers: number[] = [];
    for (const row of rows) {
      const value = row.raw.ref;
      if (typeof value !== 'string') continue;
      const match = REF_INPUT_RE.exec(value.trim());
      if (match) {
        const number = parseItemNumber(match[1]);
        if (number == null) {
          row.errors.push({
            row: row.rowNumber,
            column: 'ref',
            message: `Invalid reference "${value}". Use the incident reference (INC-12), or leave the column empty to create a new incident.`,
          });
          continue;
        }
        row.raw.ref = match[1];
        itemNumbers.push(number);
      }
    }
    if (itemNumbers.length === 0 || !context.manager?.query) return;

    const existing: Array<{
      item_number: number;
      confidential: boolean;
      reporter_user_id: string | null;
      owner_user_id: string | null;
    }> = await context.manager.query(
      `SELECT item_number, confidential, reporter_user_id, owner_user_id
       FROM incidents WHERE tenant_id = $1 AND item_number = ANY($2::int[])`,
      [context.tenantId, itemNumbers],
    );
    const viewer = importViewer(context);
    const hidden = new Set(
      existing
        .filter((row) => !incidentVisibleToViewer(row, viewer))
        .map((row) => row.item_number),
    );
    if (hidden.size === 0) return;
    for (const row of rows) {
      const n = Number(row.raw.ref);
      if (!hidden.has(n)) continue;
      row.errors.push({
        row: row.rowNumber,
        column: 'ref',
        message: `Unknown incident reference(s): INC-${n}. ${UNKNOWN_REF_HINT}`,
      });
    }
  },

  /**
   * Blank cells a full replace emptied, by the rules of beforeCommit: a blank boolean is false,
   * a blank confidential flag keeps the stored one (a new row gets false there). Applied here
   * too, so the preflight's check of emptied columns sees the same values as the load.
   *
   * The forward-only lifecycle is checked here, on the matched stored row: a status that moves
   * backwards, or to `cancelled`, is reserved to `incidents:admin` (Reopen or Cancel). A
   * contributor gets a row error, with the INC-N reference, in both the preflight and the load.
   */
  afterValidate: async (rows, context) => {
    const viewer = importViewer(context);
    for (const row of rows) {
      for (const column of ['personal_data_affected', 'authority_notification_required']) {
        if (row.parsed[column] === null) row.parsed[column] = false;
      }
      if (row.parsed.confidential === null) delete row.parsed.confidential;

      // insert_only skips the matched rows; they cannot move a stored status.
      if (viewer.isAdmin || context.params.operation === 'insert_only' || row.isInsert || row.errors.length > 0) continue;
      const previous = row.existingEntity?.status;
      const next = row.parsed.status;
      if (!isReservedIncidentStatusMove(next, previous)) continue;
      const reference = incidentLabel(row.existingEntity);
      row.errors.push({
        row: row.rowNumber,
        column: 'status',
        message: importStatusReservedMessage(reference, previous, next),
        code: IMPORT_STATUS_RESERVED_CODE,
        params: { reference, from: String(previous), to: String(next) },
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
      // The export writes instants to the second: the stored instant at that precision is the same value.
      for (const column of DATE_TIME_COLUMNS) {
        if (next[column] instanceof Date && stored[column] instanceof Date
          && Math.floor(stored[column].getTime() / 1000) * 1000 === next[column].getTime()) next[column] = stored[column];
      }
      // As beforeCommit: blank booleans are false, a blank confidential flag keeps the stored one.
      for (const column of ['personal_data_affected', 'authority_notification_required']) {
        if (column in next) next[column] = next[column] ?? false;
      }
      if (next.confidential == null) delete next.confidential;
      if (!next.category) return;
      const resolved = findCatalogOption(next.category, categories)?.code;
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
          throw new Error(
            `${incidentLabel(entity)}: unknown category "${entity.category}". ` +
            `Use one of ${categories.map((c) => c.label).join(', ')}, or add it under IT settings first.`,
          );
        }
        entity.category = resolved;
      }

      // Booleans have a false default: a blank cell clears them.
      entity.personal_data_affected = entity.personal_data_affected ?? false;
      entity.authority_notification_required = entity.authority_notification_required ?? false;
      if (!entity.id) {
        entity.confidential = entity.confidential ?? false;
      }

      if (entity.id) {
        entity.updated_by = context.userId ?? null;
        // Columns the database refuses to clear. Blanking them in replace mode
        // would silently rewrite the record, so say so instead.
        for (const column of ['status', 'detected_at'] as const) {
          if (entity[column] == null) {
            throw new Error(
              `${incidentLabel(entity)}: "${column}" cannot be cleared. Provide a value, or import in enrich mode.`,
            );
          }
        }
      } else {
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
          throw new Error(importStatusReservedMessage(incidentLabel(entity), row.status, String(entity.status)));
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
