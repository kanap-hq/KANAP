import { Injectable } from '@nestjs/common';
import { DocumentExportService, ExportImageFetchOptions } from '../../common/document-export.service';
import { normalizeReportTimeZone } from '../../common/report-period';
import { shippedLabelIn } from '../../it-ops-settings/catalog-shipped-labels';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { isIncidentReviewSystemTemplate } from '../../knowledge/integrated-document.constants';
import { incidentRef } from './incidents-base.service';
import { IncidentRecordOpts, IncidentRecordService } from './incident-record.service';

export const REPORT_LANGS = ['en', 'fr', 'de', 'es'] as const;
export type ReportLang = (typeof REPORT_LANGS)[number];

export type ReportLabels = {
  severity: Record<string, string>;
  status: Record<string, string>;
  taskStatus: Record<string, string>;
  kind: Record<string, string>;
  fieldStatus: string;
  fieldSeverity: string;
  detected: string;
  started: string;
  resolved: string;
  closed: string;
  properties: string;
  category: string;
  reporter: string;
  owner: string;
  externalRef: string;
  created: string;
  updated: string;
  description: string;
  reviewVersion: string;
  journal: string;
  occurredAt: string;
  recordedAt: string;
  author: string;
  kindHeader: string;
  content: string;
  systemAuthor: string;
  /** The fixed sentences of system entries, stored in English, by stored text. */
  systemEntries: Record<string, string>;
  unknownAuthor: string;
  linkedObjects: string;
  assets: string;
  applications: string;
  technologies: string;
  tasks: string;
  taskAssignee: string;
  taskDue: string;
  documents: string;
  compliance: string;
  personalData: string;
  authorityRequired: string;
  notifiedOn: string;
  partiesInformed: string;
  yes: string;
  no: string;
  attachments: string;
  filename: string;
  size: string;
  uploaded: string;
  generatedOn: string;
};

export type IncidentReportIncident = {
  id?: string;
  item_number: number | string;
  title?: string | null;
  category?: string | null;
  severity?: string | null;
  status?: string | null;
  started_at?: Date | string | null;
  detected_at?: Date | string | null;
  resolved_at?: Date | string | null;
  closed_at?: Date | string | null;
  reporter_name?: string | null;
  owner_name?: string | null;
  source_ref?: string | null;
  description?: string | null;
  personal_data_affected?: boolean | string | number | null;
  authority_notification_required?: boolean | string | number | null;
  authority_notified_at?: Date | string | null;
  notified_parties?: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
};

export type IncidentReportEntry = {
  kind?: string | null;
  content?: string | null;
  changed_fields?: Record<string, { from: unknown; to: unknown }> | null;
  occurred_at?: Date | string | null;
  created_at?: Date | string | null;
  author_name?: string | null;
};

export type IncidentReportLinked = { name?: string | null; reference?: string | null };
export type IncidentReportTask = {
  item_number?: number | string | null;
  title?: string | null;
  status?: string | null;
  /** Resolved by `IncidentRecordService.load` from the tasks' assignee. */
  assignee_name?: string | null;
  due_date?: Date | string | null;
};
export type IncidentReportDocument = { item_number?: number | string | null; title?: string | null };
export type IncidentReportAttachment = {
  original_filename?: string | null;
  size?: number | string | null;
  uploaded_at?: Date | string | null;
};

/** The `incidents:review` integrated document, as `IncidentRecordService.load` returns it. */
export type IncidentReportReview = {
  document_id?: string | null;
  item_number?: number | string | null;
  content_markdown?: string | null;
};

export type IncidentReportRecord = {
  incident: IncidentReportIncident;
  review?: IncidentReportReview | null;
  entries?: IncidentReportEntry[];
  assets?: IncidentReportLinked[] | null;
  applications?: IncidentReportLinked[] | null;
  technologies?: IncidentReportLinked[] | null;
  tasks?: IncidentReportTask[] | null;
  documents?: { access?: string; items?: IncidentReportDocument[] } | IncidentReportDocument[];
  attachments?: IncidentReportAttachment[];
  categoryLabel?: string | null;
};

const LABELS: Record<ReportLang, ReportLabels> = {
  en: {
    severity: { critical: 'Critical', major: 'Major', minor: 'Minor', low: 'Low' },
    status: { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled' },
    taskStatus: { open: 'Open', in_progress: 'In progress', pending: 'Pending', in_testing: 'In testing', done: 'Done', cancelled: 'Cancelled' },
    kind: {
      note: 'Note',
      status_change: 'Status change',
      severity_change: 'Severity change',
      reopen: 'Reopened',
      link_change: 'Links updated',
      system: 'System',
    },
    fieldStatus: 'Status',
    fieldSeverity: 'Severity',
    detected: 'Detected',
    started: 'Started',
    resolved: 'Resolved',
    closed: 'Closed',
    properties: 'Properties',
    category: 'Category',
    reporter: 'Reporter',
    owner: 'Owner',
    externalRef: 'External reference',
    created: 'Created',
    updated: 'Updated',
    description: 'Description',
    reviewVersion: 'Incident review version {version}',
    journal: 'Journal',
    occurredAt: 'Occurred at',
    recordedAt: 'Recorded at',
    author: 'Author',
    kindHeader: 'Kind',
    content: 'Content',
    systemAuthor: 'System',
    systemEntries: {
      'Incident logged': 'Incident logged',
      'Imported from CSV': 'Imported from CSV',
      'Incident review imported from CSV': 'Incident review imported from CSV',
      'Incident review imported': 'Incident review imported',
    },
    unknownAuthor: 'Unknown',
    linkedObjects: 'Linked objects',
    assets: 'Assets',
    applications: 'Applications',
    technologies: 'Technologies',
    tasks: 'Tasks',
    taskAssignee: 'Assignee',
    taskDue: 'Due {date}',
    documents: 'Documents',
    compliance: 'Compliance',
    personalData: 'Personal data affected',
    authorityRequired: 'Authority notification required',
    notifiedOn: 'Notified on',
    partiesInformed: 'Parties informed',
    yes: 'Yes',
    no: 'No',
    attachments: 'Attachments',
    filename: 'File name',
    size: 'Size',
    uploaded: 'Uploaded',
    generatedOn: 'Generated on {date} by KANAP',
  },
  fr: {
    severity: { critical: 'Critique', major: 'Majeure', minor: 'Mineure', low: 'Faible' },
    status: { open: 'Ouvert', in_progress: 'En cours', resolved: 'Résolu', closed: 'Clôturé', cancelled: 'Annulé' },
    taskStatus: { open: 'Ouvert', in_progress: 'En cours', pending: 'En attente', in_testing: 'En test', done: 'Terminé', cancelled: 'Annulé' },
    kind: {
      note: 'Note',
      status_change: 'Changement de statut',
      severity_change: 'Changement de gravité',
      reopen: 'Rouvert',
      link_change: 'Liens mis à jour',
      system: 'Système',
    },
    fieldStatus: 'Statut',
    fieldSeverity: 'Gravité',
    detected: 'Détecté',
    started: 'Débuté',
    resolved: 'Résolu',
    closed: 'Clôturé',
    properties: 'Propriétés',
    category: 'Catégorie',
    reporter: 'Déclarant',
    owner: 'Responsable',
    externalRef: 'Référence externe',
    created: 'Créé',
    updated: 'Modifié',
    description: 'Description',
    reviewVersion: "Revue d'incident version {version}",
    journal: 'Journal',
    occurredAt: 'Survenu le',
    recordedAt: 'Enregistré le',
    author: 'Auteur',
    kindHeader: 'Type',
    content: 'Contenu',
    systemAuthor: 'Système',
    systemEntries: {
      'Incident logged': 'Incident enregistré',
      'Imported from CSV': 'Importé depuis un fichier CSV',
      'Incident review imported from CSV': 'Revue d’incident importée depuis un fichier CSV',
      'Incident review imported': 'Revue d’incident importée',
    },
    unknownAuthor: 'Inconnu',
    linkedObjects: 'Objets liés',
    assets: 'Actifs',
    applications: 'Applications',
    technologies: 'Technologies',
    tasks: 'Tâches',
    taskAssignee: 'Assigné à',
    taskDue: 'Échéance {date}',
    documents: 'Documents',
    compliance: 'Conformité',
    personalData: 'Données personnelles concernées',
    authorityRequired: "Notification à l'autorité requise",
    notifiedOn: 'Notifié le',
    partiesInformed: 'Parties informées',
    yes: 'Oui',
    no: 'Non',
    attachments: 'Pièces jointes',
    filename: 'Nom du fichier',
    size: 'Taille',
    uploaded: 'Téléversé le',
    generatedOn: 'Généré le {date} par KANAP',
  },
  de: {
    severity: { critical: 'Kritisch', major: 'Hoch', minor: 'Mittel', low: 'Niedrig' },
    status: { open: 'Offen', in_progress: 'In Bearbeitung', resolved: 'Behoben', closed: 'Geschlossen', cancelled: 'Abgebrochen' },
    taskStatus: { open: 'Offen', in_progress: 'In Bearbeitung', pending: 'Ausstehend', in_testing: 'Im Test', done: 'Erledigt', cancelled: 'Abgebrochen' },
    kind: {
      note: 'Notiz',
      status_change: 'Statusänderung',
      severity_change: 'Änderung des Schweregrads',
      reopen: 'Wieder geöffnet',
      link_change: 'Verknüpfungen aktualisiert',
      system: 'System',
    },
    fieldStatus: 'Status',
    fieldSeverity: 'Schweregrad',
    detected: 'Erkannt',
    started: 'Begonnen',
    resolved: 'Behoben',
    closed: 'Geschlossen',
    properties: 'Eigenschaften',
    category: 'Kategorie',
    reporter: 'Melder',
    owner: 'Verantwortlicher',
    externalRef: 'Externe Referenz',
    created: 'Erstellt',
    updated: 'Aktualisiert',
    description: 'Beschreibung',
    reviewVersion: 'Vorfallanalyse Version {version}',
    journal: 'Verlauf',
    occurredAt: 'Eingetreten am',
    recordedAt: 'Erfasst am',
    author: 'Autor',
    kindHeader: 'Art',
    content: 'Inhalt',
    systemAuthor: 'System',
    systemEntries: {
      'Incident logged': 'Vorfall erfasst',
      'Imported from CSV': 'Aus CSV importiert',
      'Incident review imported from CSV': 'Vorfallanalyse aus CSV importiert',
      'Incident review imported': 'Vorfallanalyse importiert',
    },
    unknownAuthor: 'Unbekannt',
    linkedObjects: 'Verknüpfte Objekte',
    assets: 'Assets',
    applications: 'Anwendungen',
    technologies: 'Technologien',
    tasks: 'Aufgaben',
    taskAssignee: 'Zugewiesen an',
    taskDue: 'Fällig am {date}',
    documents: 'Dokumente',
    compliance: 'Compliance',
    personalData: 'Personenbezogene Daten betroffen',
    authorityRequired: 'Meldung an die Behörde erforderlich',
    notifiedOn: 'Gemeldet am',
    partiesInformed: 'Informierte Parteien',
    yes: 'Ja',
    no: 'Nein',
    attachments: 'Anhänge',
    filename: 'Dateiname',
    size: 'Größe',
    uploaded: 'Hochgeladen',
    generatedOn: 'Erzeugt am {date} von KANAP',
  },
  es: {
    severity: { critical: 'Crítica', major: 'Alta', minor: 'Media', low: 'Baja' },
    status: { open: 'Abierto', in_progress: 'En curso', resolved: 'Resuelto', closed: 'Cerrado', cancelled: 'Cancelado' },
    taskStatus: { open: 'Abierta', in_progress: 'En curso', pending: 'Pendiente', in_testing: 'En pruebas', done: 'Completada', cancelled: 'Cancelada' },
    kind: {
      note: 'Nota',
      status_change: 'Cambio de estado',
      severity_change: 'Cambio de gravedad',
      reopen: 'Reabierto',
      link_change: 'Vínculos actualizados',
      system: 'Sistema',
    },
    fieldStatus: 'Estado',
    fieldSeverity: 'Gravedad',
    detected: 'Detectado',
    started: 'Inicio',
    resolved: 'Resuelto',
    closed: 'Cerrado',
    properties: 'Propiedades',
    category: 'Categoría',
    reporter: 'Notificante',
    owner: 'Responsable',
    externalRef: 'Referencia externa',
    created: 'Creado',
    updated: 'Actualizado',
    description: 'Descripción',
    reviewVersion: 'Revisión del incidente versión {version}',
    journal: 'Diario',
    occurredAt: 'Ocurrido el',
    recordedAt: 'Registrado el',
    author: 'Autor',
    kindHeader: 'Tipo',
    content: 'Contenido',
    systemAuthor: 'Sistema',
    systemEntries: {
      'Incident logged': 'Incidente registrado',
      'Imported from CSV': 'Importado desde CSV',
      'Incident review imported from CSV': 'Revisión del incidente importada desde CSV',
      'Incident review imported': 'Revisión del incidente importada',
    },
    unknownAuthor: 'Desconocido',
    linkedObjects: 'Objetos vinculados',
    assets: 'Activos',
    applications: 'Aplicaciones',
    technologies: 'Tecnologías',
    tasks: 'Tareas',
    taskAssignee: 'Asignada a',
    taskDue: 'Vence el {date}',
    documents: 'Documentos',
    compliance: 'Conformidad',
    personalData: 'Datos personales afectados',
    authorityRequired: 'Notificación a la autoridad requerida',
    notifiedOn: 'Notificado el',
    partiesInformed: 'Partes informadas',
    yes: 'Sí',
    no: 'No',
    attachments: 'Adjuntos',
    filename: 'Nombre de archivo',
    size: 'Tamaño',
    uploaded: 'Subido',
    generatedOn: 'Generado el {date} por KANAP',
  },
};

const DATE_LOCALES: Record<ReportLang, string> = {
  en: 'en-GB',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
};

export function normalizeReportLang(lang?: string | null): ReportLang {
  const value = String(lang || '').trim().toLowerCase();
  return (REPORT_LANGS as readonly string[]).includes(value) ? (value as ReportLang) : 'en';
}

export function labelsFor(lang: ReportLang): ReportLabels {
  return LABELS[lang];
}

export function reportPdfFilename(itemNumber: number | string): string {
  return `${incidentRef(Number(itemNumber))}-incident-report.pdf`;
}

/** Visible PDF heading (Pandoc document title). Not repeated as a Markdown H1. */
export function reportHeading(itemNumber: number | string, title: string): string {
  const cleaned = String(title || '').replace(/\s+/g, ' ').trim();
  const ref = incidentRef(Number(itemNumber));
  return cleaned ? `${ref} · ${cleaned}` : ref;
}

export function escapeMd(value: unknown, forTable = false): string {
  let text = value == null ? '' : String(value);
  if (forTable) text = text.replace(/\r?\n+/g, ' ').trim();
  text = text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/#/g, '\\#')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  if (!forTable) {
    // Line-start block markers: bullets, quotes, setext underlines, fences.
    // `*`, `#` and `>` are already neutralised above.
    text = text
      // Leading indentation would open an indented code block (4 spaces / tab)
      // and carries no meaning in a paragraph anyway.
      .replace(/^[ \t]+/gm, '')
      .replace(/^([-+=~])/gm, '\\$1')
      // Ordered lists: a backslash only escapes punctuation, so escape the
      // delimiter ("1\.") rather than the digit ("\1." renders literally).
      .replace(/^(\d+)([.)])/gm, '$1\\$2')
      // Single newlines are soft breaks in GFM (joined into one paragraph);
      // two trailing spaces keep the author's line breaks in the PDF.
      .replace(/\r?\n/g, '  \n');
  }
  return text;
}

function hasText(value: unknown): boolean {
  return String(value ?? '').trim().length > 0;
}

function isTrue(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export { normalizeReportTimeZone };

export function formatDateTime(
  value: Date | string | null | undefined,
  lang: ReportLang,
  timeZone?: string | null,
): string | null {
  const date = toDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(DATE_LOCALES[lang], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: normalizeReportTimeZone(timeZone),
    timeZoneName: 'short',
  }).format(date);
}

/**
 * The journal's two date columns. A numeric day, then the time and its zone, so the cell is two
 * lines instead of a long month name wrapping once per word. The line separator is not a newline:
 * a newline would break the Markdown table. `table` turns it into a `<br>`.
 */
const JOURNAL_DATE_BREAK = '\u2028';

export function formatJournalDateTime(
  value: Date | string | null | undefined,
  lang: ReportLang,
  timeZone?: string | null,
): string | null {
  const date = toDate(value);
  if (!date) return null;
  const zone = normalizeReportTimeZone(timeZone);
  const day = new Intl.DateTimeFormat(DATE_LOCALES[lang], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: zone,
  }).format(date);
  const clock = new Intl.DateTimeFormat(DATE_LOCALES[lang], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short',
  }).format(date);
  return `${day}${JOURNAL_DATE_BREAK}${clock}`;
}

/**
 * A calendar date without a time (`tasks.due_date` is a `date` column). The date part is read
 * as YYYY-MM-DD and formatted in UTC, so the time zone of the reader never shifts it by a day.
 * A full timestamp is still formatted as its UTC calendar date.
 */
function formatDateOnly(value: Date | string | null | undefined, lang: ReportLang): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const calendar = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = calendar
    ? new Date(Date.UTC(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3])))
    : toDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(DATE_LOCALES[lang], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatSize(bytes: number, lang: ReportLang): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(bytes) : size.toLocaleString(DATE_LOCALES[lang], { maximumFractionDigits: 1 });
  return `${rounded} ${units[unit]}`;
}

function lookup(map: Record<string, string>, code: unknown): string {
  const key = String(code || '').trim();
  return map[key] || key;
}

function describeChange(field: string, change: { from: unknown; to: unknown }, labels: ReportLabels): string {
  const label = field === 'status' ? labels.fieldStatus : field === 'severity' ? labels.fieldSeverity : field;
  const format = (value: unknown) => {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
    if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
    if (field === 'status') return lookup(labels.status, value);
    if (field === 'severity') return lookup(labels.severity, value);
    return String(value);
  };
  return `${label}: ${format(change.from)} → ${format(change.to)}`;
}

/**
 * `changed_fields.review_version` carries `{ document_id, version_number, revision }`
 * (§3.3). It is rendered as a readable version reference in the four report
 * languages, with the DOC-N business reference — never the document UUID.
 */
function describeReviewVersion(
  change: { from: unknown; to: unknown },
  labels: ReportLabels,
  review?: IncidentReportReview | null,
): string | null {
  const to = change?.to;
  if (!to || typeof to !== 'object' || Array.isArray(to)) return null;
  const value = to as Record<string, unknown>;
  const version = Number(value.version_number);
  if (!Number.isFinite(version) || version <= 0) return null;

  const label = labels.reviewVersion.replace('{version}', String(version));
  const documentId = String(value.document_id ?? '').trim();
  const reviewDocumentId = String(review?.document_id ?? '').trim();
  const itemNumber = Number(review?.item_number);
  if (documentId && reviewDocumentId && documentId === reviewDocumentId && Number.isFinite(itemNumber) && itemNumber > 0) {
    return `${label} (DOC-${itemNumber})`;
  }
  return label;
}

function journalContent(
  entry: IncidentReportEntry,
  labels: ReportLabels,
  review?: IncidentReportReview | null,
): string {
  const parts: string[] = [];
  if (entry.kind !== 'link_change' && entry.changed_fields) {
    for (const [field, change] of Object.entries(entry.changed_fields)) {
      if (!change || typeof change !== 'object') continue;
      if (field === 'review_version') {
        const rendered = describeReviewVersion(change, labels, review);
        if (rendered) parts.push(rendered);
        continue;
      }
      parts.push(describeChange(field, change, labels));
    }
  }
  if (hasText(entry.content)) parts.push(entryContent(entry, labels));
  return parts.join('\n');
}

/** A system entry's fixed sentence in the report's language; anything else as written. */
function entryContent(entry: IncidentReportEntry, labels: ReportLabels): string {
  const content = String(entry.content);
  if (entry.kind !== 'system') return content;
  return Object.prototype.hasOwnProperty.call(labels.systemEntries, content) ? labels.systemEntries[content] : content;
}

function authorName(entry: IncidentReportEntry, labels: ReportLabels): string {
  if (hasText(entry.author_name)) return String(entry.author_name);
  if (entry.kind === 'system') return labels.systemAuthor;
  return labels.unknownAuthor;
}

function linkedLine(item: IncidentReportLinked): string {
  const name = String(item.name || '').trim();
  const reference = String(item.reference || '').trim();
  if (reference && name) return `${escapeMd(reference)} · ${escapeMd(name)}`;
  return escapeMd(reference || name);
}

function documentItems(documents: IncidentReportRecord['documents']): IncidentReportDocument[] {
  if (!documents) return [];
  if (Array.isArray(documents)) return documents;
  if (documents.access === 'restricted') return [];
  return Array.isArray(documents.items) ? documents.items : [];
}

function propertyRow(label: string, value: string | null | undefined): string | null {
  if (!hasText(value)) return null;
  return `- **${label}:** ${escapeMd(value)}`;
}

function heading(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}

export function normalizeReviewMarkdown(value: string | null | undefined): string {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

/**
 * True when the review carries nothing an author wrote: either blank, or
 * exactly the five system headings of the §3.2 template in one of the interface
 * languages, in the same order and with nothing else. Headings are never stripped
 * to decide this — a free heading such as `## Main router outage` is real content —
 * and the current library template is never consulted: it may have changed since
 * the incident was created.
 */
export function isSystemTemplateOnlyReview(markdown: string | null | undefined): boolean {
  const text = normalizeReviewMarkdown(markdown);
  if (!text.trim()) return true;
  return isIncidentReviewSystemTemplate(text);
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

/**
 * Relative widths of the journal table, in Pandoc's order: occurrence, recording, author,
 * kind, content. Pandoc's GFM reader turns them into default-width columns in its JSON AST,
 * so the table helper also writes a raw HTML marker that `DocumentExportService` reads back
 * before the Typst pass.
 *
 * Each date column is wide enough for the numeric day on one line and the time with its zone
 * on the next (Europe, UTC, a one-digit GMT offset) on the PDF page. The content column stays
 * wider than those two date columns together.
 */
const JOURNAL_COLUMN_WEIGHTS = [12, 12, 5, 5, 26];

function escapeTableCell(value: string): string {
  return String(value).split(JOURNAL_DATE_BREAK).map((part) => escapeMd(part, true)).join('<br>');
}

function table(headers: string[], rows: string[][], weights?: number[]): string {
  const head = `| ${headers.map((h) => escapeTableCell(h)).join(' | ')} |`;
  const sep = `| ${headers.map((_, index) => {
    const weight = Math.max(1, Math.round(weights?.[index] ?? 1));
    return '-'.repeat(Math.max(3, weight * 3));
  }).join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((cell) => escapeTableCell(cell)).join(' | ')} |`);
  // Pandoc's GFM reader does not keep the separator widths through its JSON AST; the
  // marker carries them past that boundary. It is an HTML comment, invisible in the PDF.
  const marker = weights ? `<!-- kanap:table-widths=${weights.join(',')} -->\n` : '';
  return [`${marker}${head}`, sep, ...body].join('\n');
}

export function buildMarkdown(
  record: IncidentReportRecord,
  lang: ReportLang,
  labels: ReportLabels,
  timeZone?: string | null,
): string {
  const incident = record.incident;
  const sections: string[] = [];
  const tz = normalizeReportTimeZone(timeZone);
  const when = (value: Date | string | null | undefined) => formatDateTime(value, lang, tz);

  const headerLines = [
    `- **${labels.fieldSeverity}:** ${escapeMd(lookup(labels.severity, incident.severity))}`,
    `- **${labels.fieldStatus}:** ${escapeMd(lookup(labels.status, incident.status))}`,
  ];
  const detected = when(incident.detected_at);
  const started = when(incident.started_at);
  const resolved = when(incident.resolved_at);
  const closed = when(incident.closed_at);
  if (detected) headerLines.push(`- **${labels.detected}:** ${escapeMd(detected)}`);
  if (started) headerLines.push(`- **${labels.started}:** ${escapeMd(started)}`);
  if (resolved) headerLines.push(`- **${labels.resolved}:** ${escapeMd(resolved)}`);
  if (closed) headerLines.push(`- **${labels.closed}:** ${escapeMd(closed)}`);
  sections.push(headerLines.join('\n'));

  const categoryValue = hasText(record.categoryLabel)
    ? String(record.categoryLabel)
    : hasText(incident.category)
      ? String(incident.category)
      : null;
  const propertyRows = [
    propertyRow(labels.category, categoryValue),
    propertyRow(labels.reporter, incident.reporter_name),
    propertyRow(labels.owner, incident.owner_name),
    propertyRow(labels.externalRef, incident.source_ref),
    propertyRow(labels.created, when(incident.created_at)),
    propertyRow(labels.updated, when(incident.updated_at)),
  ].filter((row): row is string => !!row);
  if (propertyRows.length) {
    sections.push(`${heading(2, labels.properties)}\n\n${propertyRows.join('\n')}`);
  }

  // Short description: still a plain-text column, so it stays escaped.
  if (hasText(incident.description)) {
    sections.push(`${heading(2, labels.description)}\n\n${escapeMd(incident.description)}`);
  }

  // The review document is Markdown authored in the editor: inserted as-is
  // (images included), never escaped, never wrapped in an extra heading.
  const reviewMarkdown = normalizeReviewMarkdown(record.review?.content_markdown);
  if (!isSystemTemplateOnlyReview(reviewMarkdown)) {
    sections.push(reviewMarkdown.trim());
  }

  const entries = record.entries || [];
  if (entries.length) {
    const journalWhen = (value: Date | string | null | undefined) => formatJournalDateTime(value, lang, tz) || '';
    const rows = entries.map((entry) => [
      journalWhen(entry.occurred_at),
      journalWhen(entry.created_at),
      authorName(entry, labels),
      lookup(labels.kind, entry.kind || 'note'),
      journalContent(entry, labels, record.review),
    ]);
    sections.push(
      `${heading(2, labels.journal)}\n\n${table(
        [labels.occurredAt, labels.recordedAt, labels.author, labels.kindHeader, labels.content],
        rows,
        JOURNAL_COLUMN_WEIGHTS,
      )}`,
    );
  }

  const assets = (record.assets || []).filter((item) => hasText(item.name) || hasText(item.reference));
  const applications = (record.applications || []).filter((item) => hasText(item.name) || hasText(item.reference));
  const technologies = (record.technologies || []).filter((item) => hasText(item.name) || hasText(item.reference));
  const tasks = (record.tasks || []).filter((item) => item.item_number != null || hasText(item.title));
  const documents = documentItems(record.documents).filter((item) => item.item_number != null || hasText(item.title));
  const linkedParts: string[] = [];
  if (assets.length) {
    linkedParts.push(`${heading(3, labels.assets)}\n\n${bulletList(assets.map(linkedLine))}`);
  }
  if (applications.length) {
    linkedParts.push(`${heading(3, labels.applications)}\n\n${bulletList(applications.map(linkedLine))}`);
  }
  if (technologies.length) {
    linkedParts.push(`${heading(3, labels.technologies)}\n\n${bulletList(technologies.map(linkedLine))}`);
  }
  if (tasks.length) {
    linkedParts.push(`${heading(3, labels.tasks)}\n\n${bulletList(tasks.map((task) => {
      const refPart = task.item_number != null ? `T-${Number(task.item_number)}` : '';
      const assignee = hasText(task.assignee_name) ? `${labels.taskAssignee}: ${task.assignee_name}` : '';
      const dueDate = formatDateOnly(task.due_date, lang);
      const due = dueDate ? labels.taskDue.replace('{date}', dueDate) : '';
      const bits = [refPart, task.title, lookup(labels.taskStatus, task.status), assignee, due]
        .filter(hasText)
        .map((bit) => escapeMd(bit));
      return bits.join(' · ');
    }))}`);
  }
  if (documents.length) {
    linkedParts.push(`${heading(3, labels.documents)}\n\n${bulletList(documents.map((doc) => {
      const refPart = doc.item_number != null ? `DOC-${Number(doc.item_number)}` : '';
      const bits = [refPart, doc.title].filter(hasText).map((bit) => escapeMd(bit));
      return bits.join(' · ');
    }))}`);
  }
  if (linkedParts.length) {
    sections.push(`${heading(2, labels.linkedObjects)}\n\n${linkedParts.join('\n\n')}`);
  }

  const complianceRows = [
    `- **${labels.personalData}:** ${isTrue(incident.personal_data_affected) ? labels.yes : labels.no}`,
    `- **${labels.authorityRequired}:** ${isTrue(incident.authority_notification_required) ? labels.yes : labels.no}`,
  ];
  const notifiedOn = when(incident.authority_notified_at);
  if (notifiedOn) complianceRows.push(`- **${labels.notifiedOn}:** ${escapeMd(notifiedOn)}`);
  if (hasText(incident.notified_parties)) {
    complianceRows.push(`- **${labels.partiesInformed}:** ${escapeMd(incident.notified_parties)}`);
  }
  const complianceHasSignal =
    isTrue(incident.personal_data_affected)
    || isTrue(incident.authority_notification_required)
    || !!notifiedOn
    || hasText(incident.notified_parties);
  if (complianceHasSignal) {
    sections.push(`${heading(2, labels.compliance)}\n\n${complianceRows.join('\n')}`);
  }

  const attachments = (record.attachments || []).filter((item) => hasText(item.original_filename));
  if (attachments.length) {
    const rows = attachments.map((item) => [
      String(item.original_filename || ''),
      item.size == null || item.size === '' ? '' : formatSize(Number(item.size), lang),
      when(item.uploaded_at) || '',
    ]);
    sections.push(
      `${heading(2, labels.attachments)}\n\n${table([labels.filename, labels.size, labels.uploaded], rows)}`,
    );
  }

  const generated = when(new Date()) || '';
  sections.push(labels.generatedOn.replace('{date}', generated));

  return sections.join('\n\n');
}

function resolveCategoryLabel(
  code: string | null | undefined,
  options: Array<{ code: string; label?: string | null }>,
  language: ReportLang,
): string | null {
  const value = String(code || '').trim();
  if (!value) return null;
  const match = options.find((option) => option.code === value);
  if (!match) return value;
  // Shipped catalogue text in the report's language. A name the tenant typed stays as stored.
  return shippedLabelIn('incidentCategories', match, language) ?? (match.label || value);
}

/** Record options plus the request cookie, forwarded to inline image fetches. */
export type IncidentReportOpts = IncidentRecordOpts & {
  imageFetchCookie?: string | null;
  /** Résolution interne des images inline (voir `InlineImageResolverService`). */
  resolveInlineImage?: ExportImageFetchOptions['resolveInlineImage'];
};

@Injectable()
export class IncidentReportService {
  constructor(
    private readonly records: IncidentRecordService,
    private readonly documentExport: DocumentExportService,
    private readonly itOps: ItOpsSettingsService,
  ) {}

  async exportPdf(id: string, lang: string | undefined, opts: IncidentReportOpts, timeZone?: string) {
    const locale = normalizeReportLang(lang);
    const labels = labelsFor(locale);
    const record = await this.records.load(id, {
      manager: opts.manager,
      tenantId: opts.tenantId,
      userId: opts.userId ?? null,
      viewer: opts.viewer,
      technologies: opts.technologies,
      applications: opts.applications,
      applicationScope: opts.applicationScope,
      tasks: opts.tasks,
    });
    const settings = await this.itOps.getSettings(String(opts.tenantId), { manager: opts.manager });
    const markdown = buildMarkdown(
      { ...record, categoryLabel: resolveCategoryLabel(record.incident.category, settings.incidentCategories, locale) },
      locale,
      labels,
      timeZone,
    );
    // The review can embed inline images served by `/knowledge/inline/...`.
    // They are resolved internally from storage with the caller's identity, which
    // removes the dependency on the session cookie and on the URL host; the cookie
    // is still forwarded for internal targets the resolver does not recognize, and
    // the export service applies its own allowed-host list on top.
    const exportOptions: ExportImageFetchOptions = {};
    if (opts.imageFetchCookie) {
      exportOptions.imageFetchHeaders = { Cookie: opts.imageFetchCookie };
    }
    if (opts.resolveInlineImage) {
      exportOptions.resolveInlineImage = opts.resolveInlineImage;
    }
    const exported = await this.documentExport.exportMarkdown(
      markdown,
      'pdf',
      reportHeading(record.incident.item_number, String(record.incident.title || '')),
      Object.keys(exportOptions).length > 0 ? exportOptions : undefined,
    );
    return { ...exported, filename: reportPdfFilename(record.incident.item_number) };
  }
}
