export type IntegratedDocumentSourceEntityType =
  | 'requests'
  | 'projects'
  | 'interfaces'
  | 'applications'
  | 'assets'
  | 'incidents';

export type ManagedDocsFolderSystemKey =
  | 'integrated_requests'
  | 'integrated_projects'
  | 'integrated_interfaces'
  | 'integrated_applications'
  | 'integrated_assets'
  | 'integrated_incidents';

export type IntegratedDocumentSlotKey =
  | 'purpose'
  | 'risks_mitigations'
  | 'specification'
  | 'overview'
  | 'review';

/** Source entity types that actually declare a slot below. */
export type IntegratedDocumentSlottedEntityType = Extract<
  IntegratedDocumentSourceEntityType,
  'requests' | 'projects' | 'interfaces' | 'applications' | 'incidents'
>;

/**
 * The one integrated document slot with rules of its own (§3.7): the incident
 * review. Every module that has to recognise it — the document ACL, the
 * provisioning primitive, the AI entity layer, the CSV import, the incident
 * record service — compares against this single pair instead of repeating the
 * two string literals.
 */
export const INCIDENT_REVIEW_SLOT = {
  sourceEntityType: 'incidents',
  slotKey: 'review',
} as const;

export const MANAGED_DOCS_LIBRARY_NAME = 'Managed Docs';
export const MANAGED_DOCS_LIBRARY_SLUG = 'managed-docs';
export const MANAGED_DOCS_LIBRARY_DISPLAY_ORDER = 2;

export type ManagedDocsFolderDefinition = {
  sourceEntityType: IntegratedDocumentSourceEntityType;
  systemKey: ManagedDocsFolderSystemKey;
  name: string;
  displayOrder: number;
};

export type IntegratedDocumentSlotDefinition = {
  sourceEntityType: IntegratedDocumentSlottedEntityType;
  slotKey: IntegratedDocumentSlotKey;
  displayName: string;
  folderSystemKey: ManagedDocsFolderSystemKey;
  documentTypeName: string;
  documentTypeSystemKey: string;
  documentTypeDescription: string;
  /** Defaults to `100 + index` in the seeded list; set it to keep a stable order across partial seeds. */
  documentTypeDisplayOrder?: number;
  templateTitle: string;
  templateSummary: string;
  templateContentMarkdown?: string;
};

export const MANAGED_DOCS_FOLDER_DEFINITIONS: ManagedDocsFolderDefinition[] = [
  { sourceEntityType: 'requests', systemKey: 'integrated_requests', name: 'Requests', displayOrder: 0 },
  { sourceEntityType: 'projects', systemKey: 'integrated_projects', name: 'Projects', displayOrder: 1 },
  { sourceEntityType: 'interfaces', systemKey: 'integrated_interfaces', name: 'Interfaces', displayOrder: 2 },
  { sourceEntityType: 'applications', systemKey: 'integrated_applications', name: 'Applications', displayOrder: 3 },
  { sourceEntityType: 'assets', systemKey: 'integrated_assets', name: 'Assets', displayOrder: 4 },
  { sourceEntityType: 'incidents', systemKey: 'integrated_incidents', name: 'Incidents', displayOrder: 5 },
];

export type IncidentReviewLanguage = 'en' | 'fr' | 'de' | 'es';

/**
 * Incident review body: the five sections the incident register used to hold as
 * plain-text columns, in each interface language. A new review starts from the
 * headings of the creating user's language (`incidentReviewTemplateFor`).
 */
export const INCIDENT_REVIEW_HEADINGS: Record<IncidentReviewLanguage, readonly string[]> = {
  en: ['Detailed description', 'Impact', 'Root cause', 'Corrective actions', 'Lessons learned'],
  fr: ['Description détaillée', 'Impact', 'Cause racine', 'Actions correctives', 'Enseignements'],
  de: ['Ausführliche Beschreibung', 'Auswirkungen', 'Grundursache', 'Korrekturmaßnahmen', 'Erkenntnisse'],
  es: ['Descripción detallada', 'Impacto', 'Causa raíz', 'Acciones correctivas', 'Lecciones aprendidas'],
};

/** The review template in one language: the five H2 headings, each followed by a blank line. */
export function incidentReviewTemplateMarkdown(language: IncidentReviewLanguage): string {
  return INCIDENT_REVIEW_HEADINGS[language].flatMap((heading) => [`## ${heading}`, '']).join('\n');
}

/** The template seeded as every tenant's library template (English: a tenant has no language). */
export const INCIDENT_REVIEW_TEMPLATE_CONTENT_MARKDOWN = incidentReviewTemplateMarkdown('en');

/** A user's locale (`fr`, `fr-FR`, null) as a review language; anything else is English. */
export function incidentReviewLanguage(locale: string | null | undefined): IncidentReviewLanguage {
  const language = String(locale ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return language === 'fr' || language === 'de' || language === 'es' ? language : 'en';
}

/**
 * True when the text is exactly the five system headings of one language, in order and with
 * nothing else (blank lines and surrounding spaces aside). Such a text carries nothing an
 * author wrote: an untouched review, or the shipped template.
 */
export function isIncidentReviewSystemTemplate(markdown: string | null | undefined): boolean {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  return Object.values(INCIDENT_REVIEW_HEADINGS).some((headings) => (
    lines.length === headings.length && lines.every((line, index) => line === `## ${headings[index]}`)
  ));
}

export const INTEGRATED_DOCUMENT_SLOT_DEFINITIONS: IntegratedDocumentSlotDefinition[] = [
  {
    sourceEntityType: 'applications',
    slotKey: 'overview',
    displayName: 'Overview',
    folderSystemKey: 'integrated_applications',
    documentTypeName: 'Application Overview',
    documentTypeSystemKey: 'application-overview',
    documentTypeDescription: 'Managed document type for application overview descriptions',
    templateTitle: 'Application Overview Template',
    templateSummary: 'Managed template for application overview descriptions',
    templateContentMarkdown: '',
  },
  {
    sourceEntityType: 'requests',
    slotKey: 'purpose',
    displayName: 'Purpose',
    folderSystemKey: 'integrated_requests',
    documentTypeName: 'Request Purpose',
    documentTypeSystemKey: 'integrated_request_purpose',
    documentTypeDescription: 'Managed document type for request purpose integrated docs',
    templateTitle: 'Request Purpose Template',
    templateSummary: 'Managed template for request purpose integrated documents',
  },
  {
    sourceEntityType: 'requests',
    slotKey: 'risks_mitigations',
    displayName: 'Risks & Mitigations',
    folderSystemKey: 'integrated_requests',
    documentTypeName: 'Request Risks & Mitigations',
    documentTypeSystemKey: 'integrated_request_risks_mitigations',
    documentTypeDescription: 'Managed document type for request risks and mitigations integrated docs',
    templateTitle: 'Request Risks & Mitigations Template',
    templateSummary: 'Managed template for request risks and mitigations integrated documents',
  },
  {
    sourceEntityType: 'projects',
    slotKey: 'purpose',
    displayName: 'Purpose',
    folderSystemKey: 'integrated_projects',
    documentTypeName: 'Project Purpose',
    documentTypeSystemKey: 'integrated_project_purpose',
    documentTypeDescription: 'Managed document type for project purpose integrated docs',
    templateTitle: 'Project Purpose Template',
    templateSummary: 'Managed template for project purpose integrated documents',
  },
  {
    sourceEntityType: 'interfaces',
    slotKey: 'specification',
    displayName: 'Specification',
    folderSystemKey: 'integrated_interfaces',
    documentTypeName: 'Interface Specification',
    documentTypeSystemKey: 'integrated_interface_specification',
    documentTypeDescription: 'Managed document type for interface specification integrated docs',
    templateTitle: 'Interface Specification Template',
    templateSummary: 'Managed template for interface specification integrated documents',
    templateContentMarkdown: [
      '## Business Purpose & Overview',
      '',
      '## Business Objects',
      '',
      '## Use Cases',
      '',
      '## Business Rules',
      '',
      '## Impact of Failure',
      '',
      '## Transformations Overview',
      '',
      '## Error Handling',
      '',
      '## Data & Compliance Notes',
      '',
    ].join('\n'),
  },
  {
    sourceEntityType: 'incidents',
    slotKey: 'review',
    displayName: 'Incident review',
    folderSystemKey: 'integrated_incidents',
    documentTypeName: 'Incident review',
    documentTypeSystemKey: 'integrated_incident_review',
    documentTypeDescription: 'Managed document type for incident review integrated docs',
    documentTypeDisplayOrder: 105,
    templateTitle: 'Incident Review Template',
    templateSummary: 'Managed template for incident review integrated documents',
    templateContentMarkdown: INCIDENT_REVIEW_TEMPLATE_CONTENT_MARKDOWN,
  },
];

/**
 * The slot's name at the end of a managed document's title (`APP-4 - CRM - Overview`), in each
 * interface language. A document takes the name in its creator's language (`users.locale`) and
 * keeps it: a rename of the record keeps the name the title already carries.
 */
export const INTEGRATED_DOCUMENT_SLOT_LABELS: Record<string, Record<IncidentReviewLanguage, string>> = {
  'applications:overview': { en: 'Overview', fr: "Vue d'ensemble", de: 'Übersicht', es: 'Visión general' },
  'requests:purpose': { en: 'Purpose', fr: 'Objectif', de: 'Zweck', es: 'Propósito' },
  'requests:risks_mitigations': { en: 'Risks & Mitigations', fr: 'Risques et atténuations', de: 'Risiken und Gegenmaßnahmen', es: 'Riesgos y mitigaciones' },
  'projects:purpose': { en: 'Purpose', fr: 'Objectif', de: 'Zweck', es: 'Propósito' },
  'interfaces:specification': { en: 'Specification', fr: 'Spécification', de: 'Spezifikation', es: 'Especificación' },
  'incidents:review': { en: 'Incident review', fr: "Revue d'incident", de: 'Vorfallanalyse', es: 'Revisión del incidente' },
};

/** The slot's name in one language; the English `displayName` when the table has none. */
export function integratedDocumentSlotLabel(definition: IntegratedDocumentSlotDefinition, language: IncidentReviewLanguage): string {
  return INTEGRATED_DOCUMENT_SLOT_LABELS[`${definition.sourceEntityType}:${definition.slotKey}`]?.[language] ?? definition.displayName;
}

/** Every name of the slot a title may carry: the English `displayName` first, then the other languages. */
export function integratedDocumentSlotLabels(definition: IntegratedDocumentSlotDefinition): string[] {
  const labels = INTEGRATED_DOCUMENT_SLOT_LABELS[`${definition.sourceEntityType}:${definition.slotKey}`];
  return [...new Set([definition.displayName, ...(labels ? Object.values(labels) : [])])];
}

export function getIntegratedDocumentSlotKey(
  sourceEntityType: IntegratedDocumentSlottedEntityType,
  slotKey: IntegratedDocumentSlotKey,
): string {
  return `${sourceEntityType}:${slotKey}`;
}
