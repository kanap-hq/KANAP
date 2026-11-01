import type { EntityManager } from 'typeorm';

/**
 * The sentences the backend writes itself around a write, in the person's language: the stops of
 * the write guards, the summaries of the preview cards and the messages written after an approval
 * or a rejection. The model writes everything else.
 *
 * English keeps the sentences each operation writes itself. French, German and Spanish name the
 * change once, as on a stamp: the action alone while it waits, then the card's status word and
 * the action ("Rejeté : création de la tâche « Migration »."), so no word has to agree with it.
 */

export type AiWriteLanguage = 'en' | 'fr' | 'de' | 'es';
export type AiTranslatedWriteLanguage = Exclude<AiWriteLanguage, 'en'>;

/** The person's stored locale (`fr-FR` reads as `fr`); English when it is missing or unknown. */
export function aiWriteLanguage(locale: string | null | undefined): AiWriteLanguage {
  const code = String(locale ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return code === 'fr' || code === 'de' || code === 'es' ? code : 'en';
}

/** The language of the person a write belongs to, read from their stored locale. */
export async function personWriteLanguage(
  manager: EntityManager,
  tenantId: string,
  userId: string | null | undefined,
): Promise<AiWriteLanguage> {
  if (!userId) return 'en';
  const rows: unknown = await manager.query(
    'SELECT locale FROM users WHERE tenant_id = $1 AND id = $2',
    [tenantId, userId],
  );
  const row = Array.isArray(rows) ? rows[0] as { locale?: string | null } | undefined : undefined;
  return aiWriteLanguage(row?.locale ?? null);
}

type Texts = Record<AiWriteLanguage, string>;
type TranslatedTexts = Record<AiTranslatedWriteLanguage, string>;

/** A bulk change whose previews do not cover every record it concerns: nothing was changed. */
const BULK_PREVIEWS_INCOMPLETE: Texts = {
  en: 'I could not prepare a preview for every record this request concerns. Nothing has been changed.',
  fr: "Je n'ai pas pu préparer un aperçu pour chaque élément concerné par cette demande. Rien n'a été modifié.",
  de: 'Ich konnte nicht für jedes von dieser Anfrage betroffene Element eine Vorschau vorbereiten. Es wurde nichts geändert.',
  es: 'No he podido preparar una vista previa para cada elemento afectado por esta solicitud. No se ha modificado nada.',
};

/** A change the model described or asked about without preparing its preview: nothing was changed. */
const WRITE_PREVIEW_MISSING: Texts = {
  en: 'I could not prepare this change for your approval. Nothing has been changed.',
  fr: "Je n'ai pas pu préparer cette modification pour votre approbation. Rien n'a été modifié.",
  de: 'Ich konnte diese Änderung nicht zur Genehmigung vorbereiten. Es wurde nichts geändert.',
  es: 'No he podido preparar este cambio para su aprobación. No se ha modificado nada.',
};

export function bulkPreviewsIncompleteText(language: AiWriteLanguage): string {
  return BULK_PREVIEWS_INCOMPLETE[language];
}

export function writePreviewMissingText(language: AiWriteLanguage): string {
  return WRITE_PREVIEW_MISSING[language];
}

// ---------------------------------------------------------------------------------------------
// Preview summaries
// ---------------------------------------------------------------------------------------------

/** The status words of the preview card (`ai:previewStatuses`), written before the action. */
const STATUS_WORDS: Record<AiTranslatedWriteLanguage, Record<'executed' | 'rejected' | 'expired' | 'failed', string>> = {
  fr: { executed: 'Appliqué', rejected: 'Rejeté', expired: 'Expiré', failed: 'Échec' },
  de: { executed: 'Angewendet', rejected: 'Abgelehnt', expired: 'Abgelaufen', failed: 'Fehlgeschlagen' },
  es: { executed: 'Aplicada', rejected: 'Rechazada', expired: 'Caducada', failed: 'Fallida' },
};

const COLON: TranslatedTexts = { fr: ' : ', de: ': ', es: ': ' };

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** A name in the quotation marks of the language. */
export function quoted(language: AiWriteLanguage, text: string): string {
  switch (language) {
    case 'fr': return `« ${text} »`;
    case 'de': return `„${text}“`;
    case 'es': return `«${text}»`;
    default: return `"${text}"`;
  }
}

/** "Label : value." in the punctuation of the language. */
export function labelled(language: AiWriteLanguage, label: string, value: string | number): string {
  return `${label}${language === 'fr' ? ' : ' : ': '}${value}.`;
}

/**
 * The summary of a preview in French, German or Spanish: the action while it waits (with its
 * details), then the status word and the action. A failure that has an error message shows it,
 * as in English.
 */
export function previewSummaryText(
  language: AiTranslatedWriteLanguage,
  status: string,
  action: string,
  details: { pending?: string[]; executed?: string[]; errorMessage?: string | null } = {},
): string {
  const extra = (lines: string[] | undefined) => (lines && lines.length > 0 ? ` ${lines.join(' ')}` : '');
  if (status === 'failed' && details.errorMessage) return details.errorMessage;
  if (status === 'pending') return `${capitalize(action)}.${extra(details.pending)}`;
  const word = STATUS_WORDS[language][status as keyof (typeof STATUS_WORDS)['fr']];
  if (!word) return `${capitalize(action)}.`;
  return `${word}${COLON[language]}${action}.${status === 'executed' ? extra(details.executed) : ''}`;
}

/** The action phrases of the summaries, by operation. */
export const writeActionText = {
  createTask(language: AiTranslatedWriteLanguage, p: { subject: string; on: string | null; standalone: boolean }): string {
    switch (language) {
      case 'fr': return p.standalone
        ? `création de la tâche autonome ${p.subject}`
        : `création de la tâche ${p.subject}${p.on ? ` sur ${p.on}` : ''}`;
      case 'de': return p.standalone
        ? `Eigenständige Aufgabe ${p.subject} erstellen`
        : `Aufgabe ${p.subject}${p.on ? ` für ${p.on}` : ''} erstellen`;
      case 'es': return p.standalone
        ? `creación de la tarea independiente ${p.subject}`
        : `creación de la tarea ${p.subject}${p.on ? ` en ${p.on}` : ''}`;
    }
  },
  importTicket(
    language: AiTranslatedWriteLanguage,
    p: { ticketId: string; provider: string | null; subject: string; on: string | null },
  ): string {
    switch (language) {
      case 'fr': {
        const ticket = p.provider ? `ticket n° ${p.ticketId} de ${p.provider}` : `ticket GLPI n° ${p.ticketId}`;
        return `import du ${ticket} en tâche ${p.subject}${p.on ? ` sur ${p.on}` : ''}`;
      }
      case 'de': {
        const ticket = p.provider ? `Ticket Nr. ${p.ticketId} von ${p.provider}` : `GLPI-Ticket Nr. ${p.ticketId}`;
        return `${ticket} als Aufgabe ${p.subject}${p.on ? ` für ${p.on}` : ''} importieren`;
      }
      case 'es': {
        const ticket = p.provider ? `ticket n.º ${p.ticketId} de ${p.provider}` : `ticket de GLPI n.º ${p.ticketId}`;
        return `importación del ${ticket} como tarea ${p.subject}${p.on ? ` en ${p.on}` : ''}`;
      }
    }
  },
  addTaskComment(language: AiTranslatedWriteLanguage, ref: string): string {
    switch (language) {
      case 'fr': return `nouveau commentaire sur ${ref}`;
      case 'de': return `Kommentar zu ${ref} hinzufügen`;
      case 'es': return `nuevo comentario en ${ref}`;
    }
  },
  changeTaskStatus(language: AiTranslatedWriteLanguage, ref: string, from: string, to: string): string {
    switch (language) {
      case 'fr': return `changement de statut de ${ref} (${from} → ${to})`;
      case 'de': return `Status von ${ref} ändern (${from} → ${to})`;
      case 'es': return `cambio de estado de ${ref} (${from} → ${to})`;
    }
  },
  changeTaskAssignee(language: AiTranslatedWriteLanguage, ref: string, from: string, to: string): string {
    switch (language) {
      case 'fr': return `changement d'assignation de ${ref} (${from} → ${to})`;
      case 'de': return `Zuweisung von ${ref} ändern (${from} → ${to})`;
      case 'es': return `cambio de asignación de ${ref} (${from} → ${to})`;
    }
  },
  /** A change of fields of a record named by its reference (a task, a document). */
  updateRecord(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `modification de ${subject}`;
      case 'de': return `${subject} ändern`;
      case 'es': return `modificación de ${subject}`;
    }
  },
  createDocument(language: AiTranslatedWriteLanguage, subject: string, library: string | null): string {
    switch (language) {
      case 'fr': return `création du document ${subject}${library ? ` dans ${library}` : ''}`;
      case 'de': return `Dokument ${subject}${library ? ` in ${library}` : ''} erstellen`;
      case 'es': return `creación del documento ${subject}${library ? ` en ${library}` : ''}`;
    }
  },
  updateDocumentContent(language: AiTranslatedWriteLanguage, ref: string): string {
    switch (language) {
      case 'fr': return `modification du contenu de ${ref}`;
      case 'de': return `Inhalt von ${ref} ändern`;
      case 'es': return `modificación del contenido de ${ref}`;
    }
  },
  updateDocumentLinks(language: AiTranslatedWriteLanguage, ref: string): string {
    switch (language) {
      case 'fr': return `modification des liens de ${ref}`;
      case 'de': return `Verknüpfungen von ${ref} ändern`;
      case 'es': return `modificación de los vínculos de ${ref}`;
    }
  },
  /** The creation or the change of a record of a module or of master data, by its entity type. */
  writeRecord(language: AiTranslatedWriteLanguage, action: 'create' | 'update', entityType: string, subject: string): string {
    const noun = RECORD_NOUNS[entityType] ?? RECORD_NOUNS.default;
    switch (language) {
      case 'fr': return `${action === 'create' ? 'création' : 'modification'} ${noun.fr} ${subject}`;
      case 'de': return `${noun.de} ${subject} ${action === 'create' ? 'erstellen' : 'ändern'}`;
      case 'es': return `${action === 'create' ? 'creación' : 'modificación'} ${noun.es} ${subject}`;
    }
  },
  updateRelations(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `modification des relations de ${subject}`;
      case 'de': return `Beziehungen von ${subject} ändern`;
      case 'es': return `modificación de las relaciones de ${subject}`;
    }
  },
  /** A technology adopted from the KANAP catalog: the record comes from the catalog, not typed. */
  adoptTechnology(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `adoption de ${quoted(language, subject)} depuis le catalogue KANAP`;
      case 'de': return `${quoted(language, subject)} aus dem KANAP-Katalog übernehmen`;
      case 'es': return `adopción de ${quoted(language, subject)} del catálogo KANAP`;
    }
  },
  /** The links of a technology to its applications and servers. */
  updateTechnologyLinks(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `modification des liens de ${subject}`;
      case 'de': return `Verknüpfungen von ${subject} ändern`;
      case 'es': return `modificación de los vínculos de ${subject}`;
    }
  },
  /** The versions of a technology: added and changed in one preview. */
  updateTechnologyVersions(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `modification des versions de ${subject}`;
      case 'de': return `Versionen von ${subject} ändern`;
      case 'es': return `modificación de las versiones de ${subject}`;
    }
  },
  /** The owners and support contacts of a technology. */
  updateTechnologyPeople(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `modification des responsables et contacts de ${subject}`;
      case 'de': return `Verantwortliche und Kontakte von ${subject} ändern`;
      case 'es': return `modificación de los responsables y contactos de ${subject}`;
    }
  },
  /** The web links of a technology. */
  updateTechnologyWebLinks(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `modification des liens web de ${subject}`;
      case 'de': return `Weblinks von ${subject} ändern`;
      case 'es': return `modificación de los enlaces web de ${subject}`;
    }
  },
  /** The vulnerability alert setting and the version exceptions of a technology. */
  setTechnologyVulnerabilityAlerts(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `modification des alertes de vulnérabilité de ${subject}`;
      case 'de': return `Sicherheitswarnungen von ${subject} ändern`;
      case 'es': return `modificación de las alertas de vulnerabilidades de ${subject}`;
    }
  },
  /** A journal note on an incident: the journal only takes additions. */
  addIncidentNote(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `ajout d'une note à l'incident ${subject}`;
      case 'de': return `Notiz zum Vorfall ${subject} hinzufügen`;
      case 'es': return `adición de una nota al incidente ${subject}`;
    }
  },
  /** The links of an incident, added and removed in one preview. */
  updateIncidentLinks(language: AiTranslatedWriteLanguage, subject: string): string {
    switch (language) {
      case 'fr': return `modification des liens de l'incident ${subject}`;
      case 'de': return `Verknüpfungen des Vorfalls ${subject} ändern`;
      case 'es': return `modificación de los vínculos del incidente ${subject}`;
    }
  },
  /** An administrator changes the state of an incident; the reason is mandatory. */
  changeIncidentState(
    language: AiTranslatedWriteLanguage,
    action: 'reopen' | 'cancel',
    subject: string,
  ): string {
    switch (language) {
      case 'fr': return action === 'reopen'
        ? `réouverture de l'incident ${subject}`
        : `annulation de l'incident ${subject}`;
      case 'de': return action === 'reopen'
        ? `Vorfall ${subject} wieder öffnen`
        : `Vorfall ${subject} abbrechen`;
      case 'es': return action === 'reopen'
        ? `reapertura del incidente ${subject}`
        : `cancelación del incidente ${subject}`;
    }
  },
  /** An administrator restricts an incident or lifts its confidentiality. */
  setIncidentConfidentiality(
    language: AiTranslatedWriteLanguage,
    confidential: boolean,
    subject: string,
  ): string {
    switch (language) {
      case 'fr': return confidential
        ? `passage de l'incident ${subject} en confidentiel`
        : `levée de la confidentialité de l'incident ${subject}`;
      case 'de': return confidential
        ? `Vorfall ${subject} als vertraulich markieren`
        : `Vertraulichkeit des Vorfalls ${subject} aufheben`;
      case 'es': return confidential
        ? `marcado del incidente ${subject} como confidencial`
        : `levantamiento de la confidencialidad del incidente ${subject}`;
    }
  },
  /** The deletion of one record, the only irreversible write: one record at a time, under approval. */
  deleteRecord(language: AiTranslatedWriteLanguage, entityType: string, subject: string): string {
    const noun = RECORD_NOUNS[entityType] ?? RECORD_NOUNS.default;
    switch (language) {
      case 'fr': return `suppression ${noun.fr} ${subject}`;
      case 'de': return `${noun.de} ${subject} löschen`;
      case 'es': return `eliminación ${noun.es} ${subject}`;
    }
  },
  writeFinancialPlan(
    language: AiTranslatedWriteLanguage,
    action: 'create_version' | 'update_version' | 'upsert_amounts' | 'replace_allocations',
    subject: string,
  ): string {
    const texts: Record<typeof action, TranslatedTexts> = {
      create_version: {
        fr: `création d'une version budgétaire pour ${subject}`,
        de: `Budgetversion für ${subject} erstellen`,
        es: `creación de una versión presupuestaria para ${subject}`,
      },
      update_version: {
        fr: `modification de la version budgétaire ${subject}`,
        de: `Budgetversion ${subject} ändern`,
        es: `modificación de la versión presupuestaria ${subject}`,
      },
      upsert_amounts: {
        fr: `modification des montants de ${subject}`,
        de: `Beträge von ${subject} ändern`,
        es: `modificación de los importes de ${subject}`,
      },
      replace_allocations: {
        fr: `remplacement des ventilations de ${subject}`,
        de: `Zuordnungen von ${subject} ersetzen`,
        es: `sustitución de las asignaciones de ${subject}`,
      },
    };
    return texts[action][language];
  },
};

/**
 * The record of each entity type with its article: "de l'application" in French, "del contrato"
 * in Spanish, the noun alone in German (its phrases end with the verb).
 */
const RECORD_NOUNS: Record<string, TranslatedTexts> = {
  applications: { fr: "de l'application", de: 'Anwendung', es: 'de la aplicación' },
  assets: { fr: "de l'actif", de: 'Asset', es: 'del activo' },
  contracts: { fr: 'du contrat', de: 'Vertrag', es: 'del contrato' },
  projects: { fr: 'du projet', de: 'Projekt', es: 'del proyecto' },
  requests: { fr: 'de la demande', de: 'Anfrage', es: 'de la solicitud' },
  interfaces: { fr: "de l'interface", de: 'Schnittstelle', es: 'de la interfaz' },
  connections: { fr: 'de la connexion', de: 'Verbindung', es: 'de la conexión' },
  budget_lines: { fr: 'de la ligne budgétaire', de: 'Budgetzeile', es: 'de la línea presupuestaria' },
  incidents: { fr: "de l'incident", de: 'Vorfall', es: 'del incidente' },
  technologies: { fr: 'de la technologie', de: 'Technologie', es: 'de la tecnología' },
  companies: { fr: 'de la société', de: 'Unternehmen', es: 'de la empresa' },
  departments: { fr: 'du département', de: 'Abteilung', es: 'del departamento' },
  suppliers: { fr: 'du fournisseur', de: 'Lieferant', es: 'del proveedor' },
  contacts: { fr: 'du contact', de: 'Kontakt', es: 'del contacto' },
  tasks: { fr: 'de la tâche', de: 'Aufgabe', es: 'de la tarea' },
  accounts: { fr: 'du compte', de: 'Konto', es: 'de la cuenta' },
  chart_of_accounts: { fr: 'du plan comptable', de: 'Kontenplan', es: 'del plan de cuentas' },
  analytics_categories: { fr: 'de la valeur de dimension', de: 'Dimensionswert', es: 'del valor de dimensión' },
  business_processes: { fr: 'du processus métier', de: 'Geschäftsprozess', es: 'del proceso de negocio' },
  locations: { fr: 'du site', de: 'Standort', es: 'de la ubicación' },
  documents: { fr: 'du document', de: 'Dokument', es: 'del documento' },
  default: { fr: "de l'élément", de: 'Element', es: 'del elemento' },
};

/** The card's warning on a closure: the record freezes and only an administrator reopens it. */
const INCIDENT_CLOSURE_WARNING: Texts = {
  en: 'This closes and freezes the incident: only an administrator can reopen it.',
  fr: "Cette clôture fige l'incident : seul un administrateur pourra le rouvrir.",
  de: 'Dies schließt und sperrt den Vorfall: Nur ein Administrator kann ihn wieder öffnen.',
  es: 'Esto cierra y bloquea el incidente: solo un administrador podrá reabrirlo.',
};

/** The card's warning on a cancellation: the record freezes until an administrator reopens it. */
const INCIDENT_CANCEL_WARNING: Texts = {
  en: 'This cancellation freezes the incident: only an administrator can reopen it.',
  fr: "Cette annulation fige l'incident : seul un administrateur pourra le rouvrir.",
  de: 'Diese Annullierung sperrt den Vorfall: Nur ein Administrator kann ihn wieder öffnen.',
  es: 'Esta anulación bloquea el incidente: solo un administrador podrá reabrirlo.',
};

/** The card's warning when the change makes the restricted incident disappear for the person. */
const INCIDENT_ACCESS_WARNING: Texts = {
  en: 'After this change, only register administrators, the reporter and the owner can open it. You will be taken back to the register.',
  fr: "Après cette modification, seuls les administrateurs du registre, le déclarant et le responsable pourront l'ouvrir. Vous serez renvoyé vers le registre.",
  de: 'Nach dieser Änderung können nur noch Registeradministratoren, der Melder und der Verantwortliche ihn öffnen. Sie werden zum Register zurückgeführt.',
  es: 'Tras este cambio, solo los administradores del registro, el notificante y el responsable podrán abrirlo. Volverá al registro.',
};

export function incidentClosureWarning(language: AiWriteLanguage): string {
  return INCIDENT_CLOSURE_WARNING[language];
}

export function incidentCancelWarning(language: AiWriteLanguage): string {
  return INCIDENT_CANCEL_WARNING[language];
}

export function incidentAccessWarning(language: AiWriteLanguage): string {
  return INCIDENT_ACCESS_WARNING[language];
}

/** The three families of an incident's links, named as the Relations tab names them. */
const INCIDENT_LINK_KIND_LABELS: Record<'assets' | 'applications' | 'technologies', Texts> = {
  assets: { en: 'Linked assets', fr: 'Actifs liés', de: 'Verknüpfte Assets', es: 'Activos vinculados' },
  applications: { en: 'Linked applications', fr: 'Applications liées', de: 'Verknüpfte Anwendungen', es: 'Aplicaciones vinculadas' },
  technologies: { en: 'Linked technologies', fr: 'Technologies liées', de: 'Verknüpfte Technologien', es: 'Tecnologías vinculadas' },
};

export function incidentLinkKindText(
  language: AiWriteLanguage,
  kind: 'assets' | 'applications' | 'technologies',
): string {
  return INCIDENT_LINK_KIND_LABELS[kind][language];
}

/** The journal note card: its title and the optional event time. */
export function incidentNoteLabel(language: AiWriteLanguage): string {
  return { en: 'Note', fr: 'Note', de: 'Notiz', es: 'Nota' }[language];
}

export function incidentOccurredAtLabel(language: AiWriteLanguage): string {
  return { en: 'Occurred at', fr: "Date de l'événement", de: 'Zeitpunkt', es: 'Fecha del evento' }[language];
}

/** The mandatory reason of a reopen or a cancellation, as the screen asks for it. */
export function incidentReasonLabel(language: AiWriteLanguage): string {
  return { en: 'Reason', fr: 'Raison', de: 'Grund', es: 'Motivo' }[language];
}

export type IncidentLinkCardGroup = {
  /** The links the preview adds, as "AST-12 - name". */
  add: string[];
  /** The links it removes. */
  remove: string[];
  /** Links already present: nothing is written for them. */
  already: string[];
  /** Links already absent: nothing is written for them. */
  absent: string[];
};

/**
 * The markdown block of one link family on the card: what the approval adds and removes, then
 * the links it leaves as they are. Empty blocks are left out, so a preview with nothing to write
 * still says what it found.
 */
export function incidentLinkCardText(language: AiWriteLanguage, group: IncidentLinkCardGroup): string {
  const headings = {
    add: { en: 'Added', fr: 'Ajoutés', de: 'Hinzugefügt', es: 'Añadidos' }[language],
    remove: { en: 'Removed', fr: 'Retirés', de: 'Entfernt', es: 'Retirados' }[language],
    already: { en: 'Already linked', fr: 'Déjà liés', de: 'Bereits verknüpft', es: 'Ya vinculados' }[language],
    absent: { en: 'Not linked', fr: 'Pas liés', de: 'Nicht verknüpft', es: 'No vinculados' }[language],
  };
  const blocks: string[] = [];
  for (const key of ['add', 'remove', 'already', 'absent'] as const) {
    const items = group[key].filter((item) => item.trim().length > 0);
    if (items.length === 0) continue;
    blocks.push([`**${headings[key]}**`, ...items.map((item) => `- ${escapeMarkdownLabel(item)}`)].join('\n'));
  }
  return blocks.join('\n\n');
}

/** A record's label is data, not Markdown: escape the characters that would style the card. */
export function escapeMarkdownLabel(value: string): string {
  return value
    // The escape character itself first, so the backslashes added below stay single.
    .replace(/\\/g, '\\\\')
    .replace(/~/g, '\\~')
    // A leading list marker, quote or ordered-list number would structure the line.
    .replace(/^([>+-])/, '\\$1')
    .replace(/^(\d+)\./, '$1\\.')
    .replace(/([*_\[\]`#])/g, '\\$1');
}

/** The tech-link card group: the four headings of one kind, with the server wording for `already`. */
export type TechnologyLinkCardGroup = {
  add: string[];
  remove: string[];
  already: string[];
  absent: string[];
};

export type TechnologyAdoptionCard = {
  /** The code of the family the adoption writes; the card shows it as its own field. */
  family: string;
  /** The catalog entry's key, listed when the adoption completes a hand-typed record. */
  catalog_key?: string | null;
  versions: number;
  support_from: string | null;
  support_to: string | null;
  /** The hand-typed record the adoption completes, when the catalog entry has one of its name. */
  completes?: { reference: string; missing_versions: string[]; fills_description: boolean } | null;
};

/**
 * The catalog block of an adoption preview: the versions it brings, with the range of their
 * end-of-support dates. A completion under an existing hand-typed record says so and lists what
 * the adoption adds (the catalog key, the missing versions, the description when the record has
 * none). The family is a field of its own on the card, named from the tenant's list on the
 * frontend, in the person's language. The fields the person added are listed apart from this block.
 */
export function technologyAdoptionCardText(language: AiWriteLanguage, adoption: TechnologyAdoptionCard): string {
  const count = adoption.versions;
  const from = adoption.support_from;
  const to = adoption.support_to;
  const versions = {
    en: count === 1 ? '1 version' : `${count} versions`,
    fr: count === 1 ? '1 version' : `${count} versions`,
    de: count === 1 ? '1 Version' : `${count} Versionen`,
    es: count === 1 ? '1 versión' : `${count} versiones`,
  }[language];
  const range = from && to
    ? {
      en: `end of support from ${from} to ${to}`,
      fr: `fin de support de ${from} à ${to}`,
      de: `Supportende von ${from} bis ${to}`,
      es: `fin de soporte de ${from} a ${to}`,
    }[language]
    : from
      ? { en: `end of support from ${from}`, fr: `fin de support à partir du ${from}`, de: `Supportende ab ${from}`, es: `fin de soporte desde el ${from}` }[language]
      : to
        ? { en: `end of support up to ${to}`, fr: `fin de support jusqu'au ${to}`, de: `Supportende bis ${to}`, es: `fin de soporte hasta el ${to}` }[language]
        : { en: 'no end-of-support date', fr: 'sans date de fin de support', de: 'ohne Supportende', es: 'sin fecha de fin de soporte' }[language];
  const separator = language === 'fr' ? ' : ' : ': ';
  if (adoption.completes) {
    const heading = {
      en: `Completes ${adoption.completes.reference} with the KANAP catalog`,
      fr: `Complète ${adoption.completes.reference} avec le catalogue KANAP`,
      de: `Ergänzt ${adoption.completes.reference} aus dem KANAP-Katalog`,
      es: `Completa ${adoption.completes.reference} con el catálogo KANAP`,
    }[language];
    const keyLabel = { en: 'Catalog key', fr: 'Clé de catalogue', de: 'Katalogschlüssel', es: 'Clave de catálogo' }[language];
    const missingLabel = { en: 'missing versions', fr: 'versions manquantes', de: 'fehlende Versionen', es: 'versiones que faltan' }[language];
    const description = {
      en: 'Description added (the record has none)',
      fr: "Description ajoutée (la fiche n'en a pas)",
      de: 'Beschreibung ergänzt (der Eintrag hat keine)',
      es: 'Descripción añadida (la ficha no tiene)',
    }[language];
    const lines = [`- ${keyLabel}${separator}${escapeMarkdownLabel(String(adoption.catalog_key ?? ''))}`];
    if (adoption.completes.missing_versions.length) {
      lines.push(`- ${adoption.completes.missing_versions.length} ${missingLabel}${separator}${adoption.completes.missing_versions.join(', ')}`);
    }
    if (adoption.completes.fills_description) lines.push(`- ${description}`);
    lines.push(`- ${versions}, ${range}`);
    return [`**${heading}**`, ...lines].join('\n');
  }
  const heading = {
    en: 'Adopted from the KANAP catalog',
    fr: 'Adoptée du catalogue KANAP',
    de: 'Aus dem KANAP-Katalog übernommen',
    es: 'Adoptada del catálogo KANAP',
  }[language];
  return [`**${heading}**`, `- ${versions}, ${range}`].join('\n');
}

/**
 * The versions of a technology as the card of `update_technology_versions` names them: an added
 * version with its end of support, a changed version with what moved, and, on the undo, the
 * versions the undo restores but does not remove.
 */
export type TechnologyVersionEditAdd = { label: string; end: string | null };
export type TechnologyVersionEditUpdate = {
  label: string;
  next_label: string | null;
  old_end: string | null;
  new_end: string | null;
  notes: 'updated' | 'cleared' | null;
  catalog: boolean;
};

export function technologyVersionEditCardText(
  language: AiWriteLanguage,
  edit: { add: TechnologyVersionEditAdd[]; update: TechnologyVersionEditUpdate[]; kept: string[] },
): string {
  const none = { en: 'none', fr: 'aucune', de: 'keine', es: 'ninguna' }[language];
  const noDate = { en: 'no support date', fr: 'sans date de support', de: 'ohne Supportdatum', es: 'sin fecha de soporte' }[language];
  const endOfSupport = { en: 'end of support', fr: 'fin de support', de: 'Supportende', es: 'fin de soporte' }[language];
  const newVersion = { en: 'new version', fr: 'nouvelle version', de: 'neue Version', es: 'nueva versión' }[language];
  const notesUpdated = { en: 'notes updated', fr: 'notes mises à jour', de: 'Notizen aktualisiert', es: 'notas actualizadas' }[language];
  const notesCleared = { en: 'notes cleared', fr: 'notes effacées', de: 'Notizen gelöscht', es: 'notas borradas' }[language];
  const catalog = { en: 'from the KANAP catalog', fr: 'du catalogue KANAP', de: 'aus dem KANAP-Katalog', es: 'del catálogo KANAP' }[language];
  const lines: string[] = [];
  for (const add of edit.add) {
    const end = add.end ? `${endOfSupport} ${add.end}` : noDate;
    lines.push(`- ${newVersion} ${add.label} (${end})`);
  }
  for (const update of edit.update) {
    const name = update.next_label ? `${update.label} → ${update.next_label}` : update.label;
    const parts: string[] = [];
    if (update.old_end !== update.new_end) {
      parts.push(`${endOfSupport} ${update.old_end ?? none} → ${update.new_end ?? none}`);
    }
    if (update.notes === 'updated') parts.push(notesUpdated);
    if (update.notes === 'cleared') parts.push(notesCleared);
    const suffix = update.catalog ? ` (${catalog})` : '';
    const colon = language === 'fr' ? ' : ' : ': ';
    lines.push(parts.length > 0 ? `- ${name}${colon}${parts.join('; ')}${suffix}` : `- ${name}${suffix}`);
  }
  const blocks: string[] = [];
  if (lines.length > 0) blocks.push(lines.join('\n'));
  if (edit.kept.length > 0) {
    const heading = { en: 'Kept', fr: 'Conservées', de: 'Beibehalten', es: 'Conservadas' }[language];
    const note = {
      en: 'the undo restores the changed versions, not the new one',
      fr: "l'annulation restaure les versions modifiées, pas la nouvelle",
      de: 'das Rückgängigmachen stellt die geänderten Versionen wieder her, nicht die neue',
      es: 'la anulación restaura las versiones modificadas, no la nueva',
    }[language];
    blocks.push([`**${heading}**`, ...edit.kept.map((label) => `- ${newVersion} ${label} (${note})`)].join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * The markdown block of the applications or the servers of a technology: what the approval adds
 * and removes, then what it leaves as it is. A server that already has the technology is listed as
 * equipped, not as linked. French and Spanish headings agree with the subject (`applications`
 * is feminine). Labels are data: they are escaped as the incident card escapes them.
 */
export function technologyLinkCardText(
  language: AiWriteLanguage,
  group: TechnologyLinkCardGroup,
  alreadyHeading: 'linked' | 'equipped' = 'linked',
  subject: 'applications' | 'servers' = 'servers',
): string {
  const headings = subject === 'applications'
    ? {
      add: { en: 'Added', fr: 'Ajoutées', de: 'Hinzugefügt', es: 'Añadidas' }[language],
      remove: { en: 'Removed', fr: 'Retirées', de: 'Entfernt', es: 'Retiradas' }[language],
      already: { en: 'Already linked', fr: 'Déjà liées', de: 'Bereits verknüpft', es: 'Ya vinculadas' }[language],
      absent: { en: 'Not linked', fr: 'Non liées', de: 'Nicht verknüpft', es: 'No vinculadas' }[language],
    }
    : {
      add: { en: 'Added', fr: 'Ajoutés', de: 'Hinzugefügt', es: 'Añadidos' }[language],
      remove: { en: 'Removed', fr: 'Retirés', de: 'Entfernt', es: 'Retirados' }[language],
      already: alreadyHeading === 'equipped'
        ? { en: 'Already equipped', fr: 'Déjà équipés', de: 'Bereits ausgestattet', es: 'Ya equipados' }[language]
        : { en: 'Already linked', fr: 'Déjà liés', de: 'Bereits verknüpft', es: 'Ya vinculados' }[language],
      absent: { en: 'Not linked', fr: 'Non liés', de: 'Nicht verknüpft', es: 'No vinculados' }[language],
    };
  const blocks: string[] = [];
  for (const key of ['add', 'remove', 'already', 'absent'] as const) {
    const items = group[key].filter((item) => item.trim().length > 0);
    if (items.length === 0) continue;
    blocks.push([`**${headings[key]}**`, ...items.map((item) => `- ${escapeMarkdownLabel(item)}`)].join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * A version as the technology card names it: the technology and its label with the existing end of
 * support date, or "new version 16, no support date" when the write creates it. Null is the
 * version-unknown link.
 */
export function technologyVersionCardText(
  language: AiWriteLanguage,
  technologyName: string,
  version: { label: string; created?: boolean; standard_support_end?: string | null; extended_support_end?: string | null } | null,
): string {
  if (!version) return { en: 'version unknown', fr: 'version inconnue', de: 'Version unbekannt', es: 'versión desconocida' }[language];
  const label = `${technologyName} ${version.label}`.trim();
  const end = version.extended_support_end ?? version.standard_support_end ?? null;
  if (version.created) {
    return {
      en: `new version ${version.label}, no support date`,
      fr: `nouvelle version ${version.label}, sans date de support`,
      de: `neue Version ${version.label}, ohne Supportdatum`,
      es: `nueva versión ${version.label}, sin fecha de soporte`,
    }[language];
  }
  if (end) {
    return {
      en: `${label} (existing, end of support ${end})`,
      fr: `${label} (existante, fin de support ${end})`,
      de: `${label} (vorhanden, Supportende ${end})`,
      es: `${label} (existente, fin de soporte ${end})`,
    }[language];
  }
  return {
    en: `${label} (existing, no support date)`,
    fr: `${label} (existante, sans date de support)`,
    de: `${label} (vorhanden, ohne Supportdatum)`,
    es: `${label} (existente, sin fecha de soporte)`,
  }[language];
}

/**
 * The versions a technology link write created on the way: an undo removes the links, never the
 * version. The card says so, in the person's language.
 */
export function technologyKeptVersionCardText(language: AiWriteLanguage, labels: string[]): string | null {
  if (labels.length === 0) return null;
  const heading = { en: 'Kept', fr: 'Conservées', de: 'Beibehalten', es: 'Conservadas' }[language];
  const note = {
    en: 'the undo removes the links, not the version',
    fr: "l'annulation retire les liens, pas la version",
    de: 'das Rückgängigmachen entfernt die Verknüpfungen, nicht die Version',
    es: 'la anulación quita los vínculos, no la versión',
  }[language];
  return [`**${heading}**`, ...labels.map((label) => `- ${technologyVersionCardText(language, '', { label, created: true })} (${note})`)].join('\n');
}

/** The four groups of a person or a web-link card: what the approval adds, removes and leaves as it is. */
export type TechnologyPersonCardGroup = {
  add: string[];
  remove: string[];
  already: string[];
  absent: string[];
};

const OWNER_TYPE_WORDS = {
  it: { en: 'IT owner', fr: 'responsable IT', de: 'IT-Verantwortlicher', es: 'responsable de TI' },
  business: { en: 'business owner', fr: 'responsable métier', de: 'Fachverantwortlicher', es: 'responsable de negocio' },
} as const;

/** `Paul Martin (IT owner)`: the name only, never an email (the interface shows names). */
export function technologyOwnerLine(language: AiWriteLanguage, name: string, ownerType: 'it' | 'business'): string {
  return `${escapeMarkdownLabel(name)} (${OWNER_TYPE_WORDS[ownerType][language]})`;
}

export function technologyOwnerCardText(language: AiWriteLanguage, group: TechnologyPersonCardGroup): string | null {
  const headings = {
    add: { en: 'Added', fr: 'Ajoutés', de: 'Hinzugefügt', es: 'Añadidos' }[language],
    remove: { en: 'Removed', fr: 'Retirés', de: 'Entfernt', es: 'Retirados' }[language],
    already: { en: 'Already owners', fr: 'Déjà responsables', de: 'Bereits verantwortlich', es: 'Ya responsables' }[language],
    absent: { en: 'Not owners', fr: 'Non responsables', de: 'Nicht verantwortlich', es: 'No responsables' }[language],
  };
  return personCard(group, headings);
}

/** `Oracle Support (role: Support)`: the contact's name and its role on the technology. */
export function technologyContactLine(language: AiWriteLanguage, name: string, role: string | null): string {
  const text = escapeMarkdownLabel(name);
  if (!role) return text;
  const label = { en: 'role', fr: 'rôle', de: 'Rolle', es: 'rol' }[language];
  const separator = language === 'fr' ? ' : ' : ': ';
  return `${text} (${label}${separator}${escapeMarkdownLabel(role)})`;
}

export function technologyContactCardText(language: AiWriteLanguage, group: TechnologyPersonCardGroup): string | null {
  const headings = {
    add: { en: 'Added', fr: 'Ajoutés', de: 'Hinzugefügt', es: 'Añadidos' }[language],
    remove: { en: 'Removed', fr: 'Retirés', de: 'Entfernt', es: 'Retirados' }[language],
    already: { en: 'Already listed', fr: 'Déjà listés', de: 'Bereits gelistet', es: 'Ya listados' }[language],
    absent: { en: 'Not listed', fr: 'Non listés', de: 'Nicht gelistet', es: 'No listados' }[language],
  };
  return personCard(group, headings);
}

function personCard(group: TechnologyPersonCardGroup, headings: Record<'add' | 'remove' | 'already' | 'absent', string>): string | null {
  const blocks: string[] = [];
  for (const key of ['add', 'remove', 'already', 'absent'] as const) {
    const items = group[key].filter((item) => item.trim().length > 0);
    if (items.length === 0) continue;
    blocks.push([`**${headings[key]}**`, ...items.map((item) => `- ${item}`)].join('\n'));
  }
  return blocks.length ? blocks.join('\n\n') : null;
}

/** The undo card of a people write: the owners and contacts it puts back, in their previous order. */
export function technologyPeopleRestoreCardText(
  language: AiWriteLanguage,
  owners: string[],
  contacts: string[],
): { owners: string | null; contacts: string | null } {
  const ownerHeading = { en: 'Owners restored', fr: 'Responsables restaurés', de: 'Verantwortliche wiederhergestellt', es: 'Responsables restaurados' }[language];
  const contactHeading = { en: 'Support contacts restored', fr: 'Contacts de support restaurés', de: 'Supportkontakte wiederhergestellt', es: 'Contactos de soporte restaurados' }[language];
  return {
    owners: owners.length ? [`**${ownerHeading}**`, ...owners.map((line) => `- ${line}`)].join('\n') : null,
    contacts: contacts.length ? [`**${contactHeading}**`, ...contacts.map((line) => `- ${line}`)].join('\n') : null,
  };
}

/** The four groups of a web-link card, with the updated links already worded line by line. */
export type TechnologyWebLinkCardGroup = {
  add: string[];
  update: string[];
  remove: string[];
  already: string[];
  absent: string[];
};

/** `https://example.com (Runbook)`: a link with its description, when it has one. */
export function technologyWebLinkAddText(url: string, description: string | null): string {
  return description ? `${url} (${description})` : url;
}

/** `https://old → https://new (description: Runbook)` or `url (description cleared)`. */
export function technologyWebLinkUpdateText(
  language: AiWriteLanguage,
  before: { url: string; description: string | null },
  after: { url: string; description: string | null },
  descriptionGiven: boolean,
): string {
  const moved = before.url !== after.url ? `${before.url} → ${after.url}` : before.url;
  if (!descriptionGiven) return moved;
  const label = { en: 'description', fr: 'description', de: 'Beschreibung', es: 'descripción' }[language];
  const cleared = { en: 'cleared', fr: 'effacée', de: 'gelöscht', es: 'eliminada' }[language];
  const separator = language === 'fr' ? ' : ' : ': ';
  return after.description
    ? `${moved} (${label}${separator}${after.description})`
    : `${moved} (${label} ${cleared})`;
}

export function technologyWebLinkCardText(language: AiWriteLanguage, group: TechnologyWebLinkCardGroup): string | null {
  const headings = {
    add: { en: 'Added', fr: 'Ajoutés', de: 'Hinzugefügt', es: 'Añadidos' }[language],
    update: { en: 'Updated', fr: 'Modifiés', de: 'Geändert', es: 'Modificados' }[language],
    remove: { en: 'Removed', fr: 'Retirés', de: 'Entfernt', es: 'Retirados' }[language],
    already: { en: 'Already present', fr: 'Déjà présents', de: 'Bereits vorhanden', es: 'Ya presentes' }[language],
    absent: { en: 'Not present', fr: 'Non présents', de: 'Nicht vorhanden', es: 'No presentes' }[language],
  };
  const blocks: string[] = [];
  for (const key of ['add', 'update', 'remove', 'already', 'absent'] as const) {
    const items = group[key].filter((item) => item.trim().length > 0);
    if (items.length === 0) continue;
    blocks.push([`**${headings[key]}**`, ...items.map((item) => `- ${escapeMarkdownLabel(item)}`)].join('\n'));
  }
  return blocks.length ? blocks.join('\n\n') : null;
}

/** The alert state of a version: `true` and `false` are its own setting, `null` follows the technology. */
export function technologyAlertStateText(language: AiWriteLanguage, value: boolean | null): string {
  if (value === true) return { en: 'alerts on', fr: 'alertes activées', de: 'Warnungen aktiv', es: 'alertas activadas' }[language];
  if (value === false) return { en: 'alerts off', fr: 'alertes désactivées', de: 'Warnungen inaktiv', es: 'alertas desactivadas' }[language];
  return { en: 'follows the technology', fr: 'suit la technologie', de: 'folgt der Technologie', es: 'sigue la tecnología' }[language];
}

export type TechnologyAlertsCard = {
  /** The technology's setting before and after, when the request names it. */
  enabled: { from: boolean; to: boolean } | null;
  /** The version labels whose exceptions the setting clears. */
  cleared: string[];
  /** The exceptions the request sets, with the service packs each base release carries. */
  versions: Array<{ label: string; from: boolean | null; to: boolean | null; propagated: string[] }>;
};

/**
 * The vulnerability-alert block of a technology: the setting first (which clears the version
 * exceptions), then the version exceptions the request sets, with the service packs that follow a
 * base release. `pending` says "will be cleared"; an executed card says "cleared".
 */
export function technologyAlertsCardText(language: AiWriteLanguage, card: TechnologyAlertsCard, pending = true): string {
  const blocks: string[] = [];
  // The setting and what it clears are one list: the card's field label already names the setting.
  const state: string[] = [];
  if (card.enabled) {
    const on = { en: 'on', fr: 'activées', de: 'aktiv', es: 'activadas' }[language];
    const off = { en: 'off', fr: 'désactivées', de: 'inaktiv', es: 'desactivadas' }[language];
    state.push(`- ${card.enabled.to ? on : off}`);
  }
  if (card.cleared.length) {
    const count = card.cleared.length;
    const one = count === 1;
    const text = pending
      ? {
        en: `${count} version exception${one ? '' : 's'} will be cleared: ${card.cleared.join(', ')}`,
        fr: one
          ? `1 exception de version sera effacée : ${card.cleared.join(', ')}`
          : `${count} exceptions de version seront effacées : ${card.cleared.join(', ')}`,
        de: one
          ? `1 Versionsausnahme wird gelöscht: ${card.cleared.join(', ')}`
          : `${count} Versionsausnahmen werden gelöscht: ${card.cleared.join(', ')}`,
        es: one
          ? `1 excepción de versión se eliminará: ${card.cleared.join(', ')}`
          : `${count} excepciones de versión se eliminarán: ${card.cleared.join(', ')}`,
      }[language]
      : {
        en: `${count} version exception${one ? '' : 's'} cleared: ${card.cleared.join(', ')}`,
        fr: one
          ? `1 exception de version effacée : ${card.cleared.join(', ')}`
          : `${count} exceptions de version effacées : ${card.cleared.join(', ')}`,
        de: one
          ? `1 Versionsausnahme gelöscht: ${card.cleared.join(', ')}`
          : `${count} Versionsausnahmen gelöscht: ${card.cleared.join(', ')}`,
        es: one
          ? `1 excepción de versión eliminada: ${card.cleared.join(', ')}`
          : `${count} excepciones de versión eliminadas: ${card.cleared.join(', ')}`,
      }[language];
    state.push(`- ${text}`);
  }
  if (state.length) blocks.push(state.join('\n'));
  if (card.versions.length) {
    const label = { en: 'Versions', fr: 'Versions', de: 'Versionen', es: 'Versiones' }[language];
    const follow = {
      en: (base: string, packs: string[]) => `the service packs ${packs.join(', ')} follow base version ${base}`,
      fr: (base: string, packs: string[]) => `les service packs ${packs.join(', ')} suivent la version de base ${base}`,
      de: (base: string, packs: string[]) => `die Service Packs ${packs.join(', ')} folgen der Basisversion ${base}`,
      es: (base: string, packs: string[]) => `los service packs ${packs.join(', ')} siguen la versión base ${base}`,
    }[language];
    const colon = language === 'fr' ? ' : ' : ': ';
    const lines = card.versions.flatMap((version) => {
      const state = `${technologyAlertStateText(language, version.from)} → ${technologyAlertStateText(language, version.to)}`;
      const items = [`- ${version.label}${colon}${state}`];
      if (version.propagated.length) items.push(`  - ${follow(version.label, version.propagated)}`);
      return items;
    });
    blocks.push([`**${label}**`, ...lines].join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * The states of a vulnerability row, as the vulnerabilities page names them
 * (`pages.vulnerabilities.states`), in each language of the page.
 */
export const VULNERABILITY_STATE_LABELS: Readonly<Record<AiWriteLanguage, Readonly<Record<string, string>>>> = {
  en: { to_review: 'To review', handled: 'Handled', not_affected: 'Not affected' },
  fr: { to_review: 'À traiter', handled: 'Traitée', not_affected: 'Non concernée' },
  de: { to_review: 'Zu prüfen', handled: 'Behandelt', not_affected: 'Nicht betroffen' },
  es: { to_review: 'Por revisar', handled: 'Tratada', not_affected: 'No afectada' },
};

export function vulnerabilityStateLabel(state: string, language: AiWriteLanguage = 'en'): string {
  return VULNERABILITY_STATE_LABELS[language][state] ?? state;
}

/** `3 rows`, `1 ligne`, `2 Zeilen`, `1 fila`: the page's word for a vulnerability row. */
function vulnerabilityRowsText(language: AiWriteLanguage, count: number): string {
  const one = count === 1;
  const word = {
    en: one ? 'row' : 'rows',
    fr: one ? 'ligne' : 'lignes',
    de: one ? 'Zeile' : 'Zeilen',
    es: one ? 'fila' : 'filas',
  }[language];
  return `${count} ${word}`;
}

/** `2 CVEs` in English; the other languages write CVE as the page does, without a plural. */
function vulnerabilityCvesText(language: AiWriteLanguage, count: number): string {
  return language === 'en' ? `${count} CVE${count === 1 ? '' : 's'}` : `${count} CVE`;
}

/** The title of the card's target: the CVE count. */
export function vulnerabilityCveCountText(language: AiWriteLanguage, count: number): string {
  return vulnerabilityCvesText(language, count);
}

/** The action phrase of a change of vulnerability state, for the summaries in fr, de and es. */
export const vulnerabilityStateActionText = {
  change(language: AiTranslatedWriteLanguage, rows: number, state: string): string {
    const label = quoted(language, vulnerabilityStateLabel(state, language));
    switch (language) {
      case 'fr': return `passage de ${vulnerabilityRowsText(language, rows)} de vulnérabilités à l'état ${label}`;
      case 'de': return `${vulnerabilityRowsText(language, rows)} der Schwachstellen auf ${label} setzen`;
      case 'es': return `paso de ${vulnerabilityRowsText(language, rows)} de vulnerabilidades al estado ${label}`;
    }
  },
  undo(language: AiTranslatedWriteLanguage, rows: number): string {
    switch (language) {
      case 'fr': return `retour de ${vulnerabilityRowsText(language, rows)} de vulnérabilités à ${rows === 1 ? 'son' : 'leur'} état précédent`;
      case 'de': return `${vulnerabilityRowsText(language, rows)} der Schwachstellen auf den vorherigen Status zurücksetzen`;
      case 'es': return `retorno de ${vulnerabilityRowsText(language, rows)} de vulnerabilidades a su estado anterior`;
    }
  },
};

/** A row of the card: CVE, technology reference and name, version (null: not recorded). */
export type VulnerabilityStateCardRow = { cve_id: string; technology: string; technology_name: string; version: string | null };

export type VulnerabilityStateCard = {
  /** The rows named, the distinct CVE among them, and the rows the change writes. */
  rows: number;
  cves: number;
  changes: number;
  /** The states the written rows leave, in the page's order, and the state they take. */
  from: string[];
  to: string;
  /** The common note: text, null to clear every note, undefined when each row keeps its own. */
  note?: string | null;
  /** Up to five written rows; the card says how many more. */
  examples: VulnerabilityStateCardRow[];
  /** Written rows outside the vulnerability alerts, and rows that no longer match (back to review). */
  outsideAlerts: number;
  noLongerMatching: number;
};

/** `CVE-2024-1234 on TEC-3 PostgreSQL 14`, or `(version not recorded)`. */
export function vulnerabilityStateRowText(row: VulnerabilityStateCardRow, language: AiWriteLanguage = 'en'): string {
  const on = { en: 'on', fr: 'sur', de: 'auf', es: 'en' }[language];
  const missing = { en: 'version not recorded', fr: 'version non renseignée', de: 'Version nicht erfasst', es: 'versión no registrada' }[language];
  const version = row.version ? ` ${row.version}` : ` (${missing})`;
  return `${row.cve_id} ${on} ${row.technology} ${row.technology_name}${version}`;
}

/** Rows back to review that no longer match: the matching deletes them next time. */
function vulnerabilityNoLongerMatchingText(language: AiWriteLanguage, n: number): string {
  const one = n === 1;
  return {
    en: one
      ? '1 no longer matches and will disappear at the next matching'
      : `${n} no longer match and will disappear at the next matching`,
    fr: one
      ? '1 ne correspond plus et disparaîtra au prochain rapprochement'
      : `${n} ne correspondent plus et disparaîtront au prochain rapprochement`,
    de: one
      ? '1 trifft nicht mehr zu und verschwindet beim nächsten Abgleich'
      : `${n} treffen nicht mehr zu und verschwinden beim nächsten Abgleich`,
    es: one
      ? '1 ya no coincide y desaparecerá en el próximo cotejo'
      : `${n} ya no coinciden y desaparecerán en el próximo cotejo`,
  }[language];
}

/**
 * The card of a change of vulnerability state, as sober as the page's bulk dialog: the rows and
 * CVE, the states before and after, the note when one is given, up to five rows, and a line only
 * for what changes the decision (rows outside the alerts, rows that will disappear at the next
 * matching).
 */
export function vulnerabilityStateCardText(card: VulnerabilityStateCard, language: AiWriteLanguage = 'en'): string {
  const colon = language === 'fr' ? ' : ' : ': ';
  const rows = card.changes === card.rows
    ? vulnerabilityRowsText(language, card.rows)
    : {
      en: `${card.changes} of ${card.rows} rows`,
      fr: `${vulnerabilityRowsText(language, card.changes)} sur ${card.rows}`,
      de: `${card.changes} von ${card.rows} Zeilen`,
      es: `${vulnerabilityRowsText(language, card.changes)} de ${card.rows}`,
    }[language];
  const from = card.from.length
    ? card.from.map((state) => vulnerabilityStateLabel(state, language)).join(', ')
    : vulnerabilityStateLabel(card.to, language);
  const to = vulnerabilityStateLabel(card.to, language);
  const head = `${rows} (${vulnerabilityCvesText(language, card.cves)})${colon}`;
  const noteWord = { en: 'Note', fr: 'Note', de: 'Notiz', es: 'Nota' }[language];
  const noteText = card.note ? `${noteWord}${colon}${escapeMarkdownLabel(quoted(language, card.note))}` : null;
  // One block per line of meaning: a line right after a list item would join the item.
  const blocks: string[] = [];
  if (card.note !== undefined && card.from.every((state) => state === card.to)) {
    // The note alone changes: the state once, then the note ("Handled, note changed").
    const what = card.note
      ? { en: 'note changed', fr: 'note modifiée', de: 'Notiz geändert', es: 'nota modificada' }[language]
      : { en: 'note cleared', fr: 'note effacée', de: 'Notiz gelöscht', es: 'nota borrada' }[language];
    blocks.push(`${head}${to}, ${what}`);
    if (noteText) blocks.push(noteText);
  } else {
    blocks.push(`${head}${from} → ${to}`);
    if (card.note !== undefined) {
      blocks.push(noteText ?? { en: 'Note cleared', fr: 'Note effacée', de: 'Notiz gelöscht', es: 'Nota borrada' }[language]);
    }
  }
  const examples = card.examples.slice(0, 5);
  const more = card.changes - examples.length;
  if (examples.length > 0) {
    const andMore = {
      en: `and ${more} more`,
      fr: more === 1 ? 'et 1 autre' : `et ${more} autres`,
      de: `und ${more} weitere`,
      es: `y ${more} más`,
    }[language];
    blocks.push([
      ...examples.map((row) => `- ${escapeMarkdownLabel(vulnerabilityStateRowText(row, language))}`),
      ...(more > 0 ? [`- ${andMore}`] : []),
    ].join('\n'));
  }
  if (card.outsideAlerts > 0) {
    const one = card.outsideAlerts === 1;
    const n = card.outsideAlerts;
    blocks.push({
      en: one ? '1 is outside the vulnerability alerts' : `${n} are outside the vulnerability alerts`,
      fr: one ? "1 est hors des alertes de vulnérabilité" : `${n} sont hors des alertes de vulnérabilité`,
      de: one ? '1 ist nicht in den Schwachstellenwarnungen' : `${n} sind nicht in den Schwachstellenwarnungen`,
      es: one ? '1 está fuera de las alertas de vulnerabilidad' : `${n} están fuera de las alertas de vulnerabilidad`,
    }[language]);
  }
  if (card.noLongerMatching > 0) blocks.push(vulnerabilityNoLongerMatchingText(language, card.noLongerMatching));
  return blocks.join('\n\n');
}

export type VulnerabilityStateUndoCard = {
  /** The rows the change wrote, the distinct CVE among them, and the state they took. */
  rows: number;
  cves: number;
  from: string;
  /** Whether the change set a note: each group then names the note it gets back. */
  notes: boolean;
  /** The rows by the state and note they go back to. */
  groups: Array<{ state: string; note: string | null; rows: number }>;
  /** Rows going back to review that no longer match (deleted at the next matching). */
  noLongerMatching?: number;
};

/**
 * The card of the undo of a vulnerability state change: the rows and CVE, then each group with the
 * state (and the note, when the change set one) it goes back to. `pending` speaks in the future.
 */
export function vulnerabilityStateUndoCardText(card: VulnerabilityStateUndoCard, pending = true, language: AiWriteLanguage = 'en'): string {
  const one = card.rows === 1;
  const colon = language === 'fr' ? ' : ' : ': ';
  const back = {
    en: `back to ${one ? 'its' : 'their'} previous state`,
    fr: `retour à ${one ? 'son' : 'leur'} état précédent`,
    de: 'zurück auf den vorherigen Status',
    es: 'vuelta a su estado anterior',
  }[language];
  const head = `${vulnerabilityRowsText(language, card.rows)} (${vulnerabilityCvesText(language, card.cves)})${colon}`
    + `${vulnerabilityStateLabel(card.from, language)} → ${back}`;
  const lines = card.groups.map((group) => {
    const n = group.rows;
    const rows = vulnerabilityRowsText(language, n);
    const state = vulnerabilityStateLabel(group.state, language);
    const goes = {
      en: `${n} ${pending ? 'will go back' : 'back'} to ${state}`,
      fr: pending
        ? `${rows} ${n === 1 ? 'reviendra' : 'reviendront'} à l'état ${state}`
        : `${rows} ${n === 1 ? 'revenue' : 'revenues'} à l'état ${state}`,
      de: pending
        ? `${rows} ${n === 1 ? 'wird' : 'werden'} auf ${state} zurückgesetzt`
        : `${rows} auf ${state} zurückgesetzt`,
      es: pending
        ? `${rows} ${n === 1 ? 'volverá' : 'volverán'} al estado ${state}`
        : `${rows} ${n === 1 ? 'vuelta' : 'vueltas'} al estado ${state}`,
    }[language];
    const note = !card.notes
      ? ''
      : group.note
        ? `, ${{ en: 'note', fr: 'note', de: 'Notiz', es: 'nota' }[language]} ${quoted(language, group.note)}`
        : `, ${{ en: 'note cleared', fr: 'note effacée', de: 'Notiz gelöscht', es: 'nota borrada' }[language]}`;
    return `- ${escapeMarkdownLabel(`${goes}${note}`)}`;
  });
  const blocks = lines.length ? [head, lines.join('\n')] : [head];
  if (card.noLongerMatching) blocks.push(vulnerabilityNoLongerMatchingText(language, card.noLongerMatching));
  return blocks.join('\n\n');
}

/** The detail lines of a task preview: its assignee and its priority. */
export const taskDetailText = {
  assignee(language: AiTranslatedWriteLanguage, name: string): string {
    return labelled(language, { fr: 'Responsable', de: 'Zugewiesen an', es: 'Asignado a' }[language], name);
  },
  priority(language: AiTranslatedWriteLanguage, label: string): string {
    return labelled(language, { fr: 'Priorité', de: 'Priorität', es: 'Prioridad' }[language], label);
  },
};

/**
 * What a delete takes with the record, counted at the preview: the rows of the card's markdown
 * block, in the person's language, with the words of the record's screen. A family with no count
 * is left out; a contact's links stay anonymous when the person cannot read that family
 * (`readContactUsages` leaves the group out), and the linked records stay in every case.
 */
export type AiDeleteImpact = {
  counts: Record<string, number>;
  /** Links in families the person does not read (a contact's, a location's assets and documents), counted without naming them. */
  hidden?: number;
  /** Lines the card adds after the counts (a document's review or edit lock), already worded in the person's language. */
  notices?: string[];
  /** A document in review still deletes: the preview says so, as the Knowledge screen allows it. */
  inReview?: boolean;
  /** The person holding the document's edit lock, when it is not the deleter. */
  lockHolder?: string | null;
};

type DeleteImpactRow = {
  key: string;
  labels: Texts;
  /** The row counts links: the records stay, only their link to the deleted record goes. */
  link?: boolean;
};

const DELETE_IMPACT_ROWS: Record<string, ReadonlyArray<DeleteImpactRow>> = {
  tasks: [
    { key: 'activities', labels: { en: 'Comments and changes', fr: 'Commentaires et changements', de: 'Kommentare und Änderungen', es: 'Comentarios y cambios' } },
    { key: 'time_entries', labels: { en: 'Time entries', fr: 'Temps saisis', de: 'Erfasste Zeiten', es: 'Tiempos registrados' } },
    { key: 'attachments', labels: { en: 'Attachments', fr: 'Pièces jointes', de: 'Anhänge', es: 'Archivos adjuntos' } },
    { key: 'applications', link: true, labels: { en: 'Links to applications', fr: 'Liens aux applications', de: 'Verknüpfungen mit Anwendungen', es: 'Vínculos con aplicaciones' } },
    { key: 'assets', link: true, labels: { en: 'Links to assets', fr: 'Liens aux actifs', de: 'Verknüpfungen mit Assets', es: 'Vínculos con activos' } },
    { key: 'documents', link: true, labels: { en: 'Links to documents', fr: 'Liens aux documents', de: 'Verknüpfungen mit Dokumenten', es: 'Vínculos con documentos' } },
  ],
  contacts: [
    { key: 'suppliers', link: true, labels: { en: 'Links to suppliers', fr: 'Liens aux fournisseurs', de: 'Verknüpfungen mit Lieferanten', es: 'Vínculos con proveedores' } },
    { key: 'budget_lines', link: true, labels: { en: 'Links to budget lines', fr: 'Liens aux lignes budgétaires', de: 'Verknüpfungen mit Budgetzeilen', es: 'Vínculos con líneas presupuestarias' } },
    { key: 'contracts', link: true, labels: { en: 'Links to contracts', fr: 'Liens aux contrats', de: 'Verknüpfungen mit Verträgen', es: 'Vínculos con contratos' } },
    { key: 'applications', link: true, labels: { en: 'Links to applications', fr: 'Liens aux applications', de: 'Verknüpfungen mit Anwendungen', es: 'Vínculos con aplicaciones' } },
    { key: 'assets', link: true, labels: { en: 'Links to assets', fr: 'Liens aux actifs', de: 'Verknüpfungen mit Assets', es: 'Vínculos con activos' } },
    { key: 'technologies', link: true, labels: { en: 'Links to technologies', fr: 'Liens aux technologies', de: 'Verknüpfungen mit Technologien', es: 'Vínculos con tecnologías' } },
    { key: 'locations', link: true, labels: { en: 'Links to locations', fr: 'Liens aux sites', de: 'Verknüpfungen mit Standorten', es: 'Vínculos con ubicaciones' } },
    { key: 'projects', link: true, labels: { en: 'Links to projects', fr: 'Liens aux projets', de: 'Verknüpfungen mit Projekten', es: 'Vínculos con proyectos' } },
    { key: 'requests', link: true, labels: { en: 'Links to requests', fr: 'Liens aux demandes', de: 'Verknüpfungen mit Anfragen', es: 'Vínculos con solicitudes' } },
  ],
  locations: [
    { key: 'contacts', link: true, labels: { en: 'Links to contacts', fr: 'Liens aux contacts', de: 'Verknüpfungen mit Kontakten', es: 'Vínculos con contactos' } },
    { key: 'links', labels: { en: 'Links', fr: 'Liens', de: 'Verknüpfungen', es: 'Vínculos' } },
    { key: 'sub_items', labels: { en: 'Sub-items', fr: 'Sous-éléments', de: 'Unterelemente', es: 'Subelementos' } },
    { key: 'documents', link: true, labels: { en: 'Links to documents', fr: 'Liens aux documents', de: 'Verknüpfungen mit Dokumenten', es: 'Vínculos con documentos' } },
  ],
  budget_lines: spendDeleteRows(),
  connections: [
    { key: 'hops', labels: { en: 'Hops', fr: 'Sauts', de: 'Hops', es: 'Saltos' } },
    { key: 'servers', link: true, labels: { en: 'Links to servers', fr: 'Liens aux serveurs', de: 'Verknüpfungen mit Servern', es: 'Vínculos con servidores' } },
    { key: 'protocols', labels: { en: 'Protocols', fr: 'Protocoles', de: 'Protokolle', es: 'Protocolos' } },
    { key: 'interfaces', link: true, labels: { en: 'Interfaces that will lose this connection', fr: 'Interfaces qui perdront cette connexion', de: 'Schnittstellen, die diese Verbindung verlieren', es: 'Interfaces que perderán esta conexión' } },
    { key: 'documents', link: true, labels: { en: 'Links to documents', fr: 'Liens aux documents', de: 'Verknüpfungen mit Dokumenten', es: 'Vínculos con documentos' } },
  ],
  documents: [
    { key: 'versions', labels: { en: 'Versions', fr: 'Versions', de: 'Versionen', es: 'Versiones' } },
    { key: 'attachments', labels: { en: 'Attachments', fr: 'Pièces jointes', de: 'Anhänge', es: 'Archivos adjuntos' } },
    { key: 'citing_documents', link: true, labels: { en: 'Documents that cite it', fr: 'Documents qui le citent', de: 'Dokumente, die es zitieren', es: 'Documentos que lo citan' } },
    { key: 'cited_documents', link: true, labels: { en: 'Documents it cites', fr: "Documents qu'il cite", de: 'Dokumente, die es zitiert', es: 'Documentos que cita' } },
    { key: 'applications', link: true, labels: { en: 'Links to applications', fr: 'Liens aux applications', de: 'Verknüpfungen mit Anwendungen', es: 'Vínculos con aplicaciones' } },
    { key: 'assets', link: true, labels: { en: 'Links to assets', fr: 'Liens aux actifs', de: 'Verknüpfungen mit Assets', es: 'Vínculos con activos' } },
    { key: 'projects', link: true, labels: { en: 'Links to projects', fr: 'Liens aux projets', de: 'Verknüpfungen mit Projekten', es: 'Vínculos con proyectos' } },
    { key: 'requests', link: true, labels: { en: 'Links to requests', fr: 'Liens aux demandes', de: 'Verknüpfungen mit Anfragen', es: 'Vínculos con solicitudes' } },
    { key: 'tasks', link: true, labels: { en: 'Links to tasks', fr: 'Liens aux tâches', de: 'Verknüpfungen mit Aufgaben', es: 'Vínculos con tareas' } },
    { key: 'locations', link: true, labels: { en: 'Links to locations', fr: 'Liens aux sites', de: 'Verknüpfungen mit Standorten', es: 'Vínculos con ubicaciones' } },
    { key: 'connections', link: true, labels: { en: 'Links to connections', fr: 'Liens aux connexions', de: 'Verknüpfungen mit Verbindungen', es: 'Vínculos con conexiones' } },
    { key: 'interfaces', link: true, labels: { en: 'Links to interfaces', fr: 'Liens aux interfaces', de: 'Verknüpfungen mit Schnittstellen', es: 'Vínculos con interfaces' } },
    { key: 'incidents', link: true, labels: { en: 'Links to incidents', fr: 'Liens aux incidents', de: 'Verknüpfungen mit Vorfällen', es: 'Vínculos con incidentes' } },
    { key: 'derived_documents', link: true, labels: { en: 'Documents created from it', fr: 'Documents créés depuis ce modèle', de: 'Aus dieser Vorlage erstellte Dokumente', es: 'Documentos creados a partir de esta plantilla' } },
  ],
  interfaces: [
    { key: 'bindings', labels: { en: 'Bindings', fr: 'Liaisons', de: 'Bindungen', es: 'Enlaces' } },
    { key: 'connection_links', link: true, labels: { en: 'Links to connections', fr: 'Liens aux connexions', de: 'Verknüpfungen mit Verbindungen', es: 'Vínculos con conexiones' } },
    { key: 'integrated_documents', labels: { en: 'Integrated documents', fr: 'Documents intégrés', de: 'Integrierte Dokumente', es: 'Documentos integrados' } },
    { key: 'documents', link: true, labels: { en: 'Links to documents', fr: 'Liens aux documents', de: 'Verknüpfungen mit Dokumenten', es: 'Vínculos con documentos' } },
    { key: 'dependencies', link: true, labels: { en: 'Links to dependent interfaces', fr: 'Liens aux interfaces dépendantes', de: 'Verknüpfungen mit abhängigen Schnittstellen', es: 'Vínculos con interfaces dependientes' } },
    { key: 'attachments', labels: { en: 'Attachments', fr: 'Pièces jointes', de: 'Anhänge', es: 'Archivos adjuntos' } },
    { key: 'applications', link: true, labels: { en: 'Links to applications', fr: 'Liens aux applications', de: 'Verknüpfungen mit Anwendungen', es: 'Vínculos con aplicaciones' } },
  ],
};

/** The rows of a budget line's delete: one family, the same card for both natures. */
function spendDeleteRows(): ReadonlyArray<DeleteImpactRow> {
  return [
    { key: 'amount_versions', labels: { en: 'Versions with amounts', fr: 'Versions avec des montants', de: 'Versionen mit Beträgen', es: 'Versiones con importes' } },
    { key: 'amount_years', labels: { en: 'Years with amounts', fr: 'Années avec des montants', de: 'Jahre mit Beträgen', es: 'Años con importes' } },
    { key: 'tasks', labels: { en: 'Deleted tasks', fr: 'Tâches supprimées', de: 'Gelöschte Aufgaben', es: 'Tareas eliminadas' } },
    { key: 'request_origins', link: true, labels: { en: 'Requests that lose their origin task', fr: "Demandes qui perdent leur tâche d'origine", de: 'Anfragen, die ihre Ursprungsaufgabe verlieren', es: 'Solicitudes que pierden su tarea de origen' } },
    { key: 'attachments', labels: { en: 'Attachments', fr: 'Pièces jointes', de: 'Anhänge', es: 'Archivos adjuntos' } },
    { key: 'contracts', link: true, labels: { en: 'Links to contracts', fr: 'Liens aux contrats', de: 'Verknüpfungen mit Verträgen', es: 'Vínculos con contratos' } },
    { key: 'projects', link: true, labels: { en: 'Links to projects', fr: 'Liens aux projets', de: 'Verknüpfungen mit Projekten', es: 'Vínculos con proyectos' } },
    { key: 'requests', link: true, labels: { en: 'Links to requests', fr: 'Liens aux demandes', de: 'Verknüpfungen mit Anfragen', es: 'Vínculos con solicitudes' } },
    { key: 'applications', link: true, labels: { en: 'Links to applications', fr: 'Liens aux applications', de: 'Verknüpfungen mit Anwendungen', es: 'Vínculos con aplicaciones' } },
    { key: 'assets', link: true, labels: { en: 'Links to assets', fr: 'Liens aux actifs', de: 'Verknüpfungen mit Assets', es: 'Vínculos con activos' } },
    { key: 'technologies', link: true, labels: { en: 'Links to technologies', fr: 'Liens aux technologies', de: 'Verknüpfungen mit Technologien', es: 'Vínculos con tecnologías' } },
    { key: 'contacts', link: true, labels: { en: 'Links to contacts', fr: 'Liens aux contacts', de: 'Verknüpfungen mit Kontakten', es: 'Vínculos con contactos' } },
    { key: 'links', labels: { en: 'Links', fr: 'Liens', de: 'Verknüpfungen', es: 'Vínculos' } },
    { key: 'dimension_values', labels: { en: 'Dimension values', fr: 'Valeurs de dimensions', de: 'Dimensionswerte', es: 'Valores de dimensiones' } },
  ];
}

const DELETE_IMPACT_OTHER: Texts = {
  en: 'Other links', fr: "D'autres rattachements", de: 'Weitere Verknüpfungen', es: 'Otros vínculos',
};

const DELETE_IMPACT_NONE: Record<string, Texts> = {
  tasks: { en: 'Nothing else is deleted with this task.', fr: 'Aucun autre élément ne part avec cette tâche.', de: 'Sonst wird mit dieser Aufgabe nichts gelöscht.', es: 'No se elimina nada más con esta tarea.' },
  contacts: { en: 'No links.', fr: 'Aucun rattachement.', de: 'Keine Verknüpfungen.', es: 'Sin vínculos.' },
  locations: { en: 'Nothing else is deleted with this location.', fr: 'Aucun autre élément ne part avec ce site.', de: 'Sonst wird mit diesem Standort nichts gelöscht.', es: 'No se elimina nada más con esta ubicación.' },
  budget_lines: { en: 'Nothing else is deleted with this line.', fr: 'Aucun autre élément ne part avec cette ligne.', de: 'Sonst wird mit dieser Zeile nichts gelöscht.', es: 'No se elimina nada más con esta línea.' },
  connections: { en: 'Nothing else is deleted with this connection.', fr: 'Aucun autre élément ne part avec cette connexion.', de: 'Sonst wird mit dieser Verbindung nichts gelöscht.', es: 'No se elimina nada más con esta conexión.' },
  interfaces: { en: 'Nothing else is deleted with this interface.', fr: 'Aucun autre élément ne part avec cette interface.', de: 'Sonst wird mit dieser Schnittstelle nichts gelöscht.', es: 'No se elimina nada más con esta interfaz.' },
  documents: { en: 'Nothing else is deleted with this document.', fr: 'Aucun autre élément ne part avec ce document.', de: 'Sonst wird mit diesem Dokument nichts gelöscht.', es: 'No se elimina nada más con este documento.' },
};

const DELETE_IMPACT_CLOSING: Record<string, Texts> = {
  contacts: { en: 'The linked records stay.', fr: 'Les fiches liées restent.', de: 'Die verknüpften Einträge bleiben.', es: 'Los registros vinculados se conservan.' },
  connections: { en: 'The interfaces themselves are not deleted.', fr: 'Les interfaces elles-mêmes ne sont pas supprimées.', de: 'Die Schnittstellen selbst werden nicht gelöscht.', es: 'Las interfaces en sí no se eliminan.' },
  interfaces: { en: 'The connections stay.', fr: 'Les connexions sont conservées.', de: 'Die Verbindungen bleiben erhalten.', es: 'Las conexiones se conservan.' },
};

/**
 * The line a document's preview adds when it is in review or locked for editing: the delete stays
 * possible, as the Knowledge screen allows it, so the card says what is true rather than refusing.
 */
export function documentDeleteNoticeText(
  language: AiWriteLanguage,
  state: { inReview?: boolean; lockHolder?: string | null },
): string[] {
  const notices: string[] = [];
  if (state.inReview) {
    notices.push({
      en: 'In review. The delete remains possible.',
      fr: 'En cours de relecture. La suppression reste possible.',
      de: 'In Prüfung. Das Löschen bleibt möglich.',
      es: 'En revisión. La eliminación sigue siendo posible.',
    }[language]);
  }
  const holder = String(state.lockHolder ?? '').trim();
  if (holder) {
    notices.push({
      en: `Locked for editing by ${holder}. The delete remains possible.`,
      fr: `Verrouillé pour édition par ${holder}. La suppression reste possible.`,
      de: `Zur Bearbeitung gesperrt von ${holder}. Das Löschen bleibt möglich.`,
      es: `Bloqueado para edición por ${holder}. La eliminación sigue siendo posible.`,
    }[language]);
  }
  return notices;
}

/** Families whose unnamed count may include records deleted with the line (a budget line's tasks). */
const HIDDEN_INCLUDES_DELETED = new Set(['budget_lines']);

/** The markdown list of what goes with a deleted record, in the person's language. */
export function deletionImpactText(language: AiWriteLanguage, entityType: string, impact: AiDeleteImpact): string {
  const colon = language === 'fr' ? ' : ' : ': ';
  const shownRows = (DELETE_IMPACT_ROWS[entityType] ?? [])
    .filter((row) => Number(impact.counts?.[row.key] ?? 0) > 0);
  const lines = shownRows.map((row) => `- ${row.labels[language]}${colon}${Number(impact.counts[row.key])}`);
  let showsLink = shownRows.some((row) => row.link === true);
  if (Number(impact.hidden ?? 0) > 0) {
    lines.push(`- ${DELETE_IMPACT_OTHER[language]}${colon}${Number(impact.hidden)}`);
    // A budget line's hidden count may hold its tasks, which are deleted: the card must not say they stay.
    if (!HIDDEN_INCLUDES_DELETED.has(entityType)) showsLink = true;
  }
  for (const notice of impact.notices ?? []) {
    if (notice.trim()) lines.push(`- ${notice.trim()}`);
  }
  if (lines.length === 0) {
    return DELETE_IMPACT_NONE[entityType]?.[language] ?? DELETE_IMPACT_NONE.tasks[language];
  }
  // A family whose card shows a link to records that stay says so, as a contact's card does;
  // a connection and an interface keep the closing that names what stays for them.
  const closing = DELETE_IMPACT_CLOSING[entityType]?.[language]
    ?? (showsLink ? DELETE_IMPACT_CLOSING.contacts[language] : null);
  return closing ? `${lines.join('\n')}\n\n${closing}` : lines.join('\n');
}

/** The counts of a ticket import, as "label: count" so no plural has to agree. */
export const ticketImportDetailText = {
  imagesQueued: (language: AiTranslatedWriteLanguage, count: number) => labelled(language, {
    fr: 'Images intégrées à importer', de: 'Eingebettete Bilder zum Import', es: 'Imágenes incrustadas por importar',
  }[language], count),
  followupsQueued: (language: AiTranslatedWriteLanguage, count: number) => labelled(language, {
    fr: 'Suivis publics à importer en commentaires',
    de: 'Öffentliche Follow-ups, die als Kommentare importiert werden',
    es: 'Seguimientos públicos por importar como comentarios',
  }[language], count),
  privateFollowupsSkipped: (language: AiTranslatedWriteLanguage, count: number) => labelled(language, {
    fr: 'Suivis privés ignorés', de: 'Übersprungene private Follow-ups', es: 'Seguimientos privados omitidos',
  }[language], count),
  imagesImported: (language: AiTranslatedWriteLanguage, imported: number, total: number) => labelled(language, {
    fr: 'Images intégrées importées', de: 'Importierte eingebettete Bilder', es: 'Imágenes incrustadas importadas',
  }[language], `${imported} ${{ fr: 'sur', de: 'von', es: 'de' }[language]} ${total}`),
  followupsImported: (language: AiTranslatedWriteLanguage, imported: number, total: number) => labelled(language, {
    fr: 'Suivis publics importés en commentaires',
    de: 'Als Kommentare importierte öffentliche Follow-ups',
    es: 'Seguimientos públicos importados como comentarios',
  }[language], `${imported} ${{ fr: 'sur', de: 'von', es: 'de' }[language]} ${total}`),
  imageWarnings: (language: AiTranslatedWriteLanguage, count: number) => labelled(language, {
    fr: "Avertissements lors de l'import des images",
    de: 'Warnungen beim Bildimport',
    es: 'Advertencias al importar las imágenes',
  }[language], count),
};

/** The values of a ticket import card: its source and its counts. English keeps its wording. */
export const ticketImportCardText = {
  source(language: AiWriteLanguage, ticketId: string, provider: string | null, url: string | null): string {
    const ticket = {
      en: provider ? `Ticket #${ticketId} from ${provider}` : `GLPI Ticket #${ticketId}`,
      fr: provider ? `Ticket n° ${ticketId} de ${provider}` : `Ticket GLPI n° ${ticketId}`,
      de: provider ? `Ticket Nr. ${ticketId} von ${provider}` : `GLPI-Ticket Nr. ${ticketId}`,
      es: provider ? `Ticket n.º ${ticketId} de ${provider}` : `Ticket de GLPI n.º ${ticketId}`,
    }[language];
    return url ? `${ticket} (${url})` : ticket;
  },
  none: (language: AiWriteLanguage) => ({ en: 'None', fr: 'Aucun', de: 'Keine', es: 'Ninguno' }[language]),
  queued: (language: AiWriteLanguage, count: number) => ({
    en: `${count} queued for import`, fr: `${count} à importer`, de: `${count} zum Import`, es: `${count} por importar`,
  }[language]),
  followups(language: AiWriteLanguage, publicCount: number, privateSkipped: number): string {
    if (language === 'en') {
      if (publicCount > 0) return `${publicCount} public queued as comments${privateSkipped > 0 ? `, ${privateSkipped} private skipped` : ''}`;
      return privateSkipped > 0 ? `${privateSkipped} private skipped` : 'None';
    }
    const colon = language === 'fr' ? ' : ' : ': ';
    const parts = [
      ...(publicCount > 0 ? [`${{ fr: 'publics, en commentaires', de: 'öffentlich, als Kommentare', es: 'públicos, como comentarios' }[language]}${colon}${publicCount}`] : []),
      ...(privateSkipped > 0 ? [`${{ fr: 'privés ignorés', de: 'private übersprungen', es: 'privados omitidos' }[language]}${colon}${privateSkipped}`] : []),
    ];
    return parts.length > 0 ? capitalize(parts.join(', ')) : ticketImportCardText.none(language);
  },
  followupImages(language: AiWriteLanguage, imported: number, total: number): string {
    if (total <= 0) return ticketImportCardText.none(language);
    if (imported <= 0) return language === 'en' ? `${total} queued` : ticketImportCardText.queued(language, total);
    return {
      en: `${imported} imported of ${total} queued`,
      fr: `${imported} importées sur ${total}`,
      de: `${imported} von ${total} importiert`,
      es: `${imported} importadas de ${total}`,
    }[language];
  },
};

/** The task statuses and priorities of the task screens (`portfolio:statuses.task`, `portfolio:priority`). */
const TASK_STATUS_LABELS: Record<AiWriteLanguage, Record<string, string>> = {
  en: { open: 'Open', in_progress: 'In progress', pending: 'Pending', in_testing: 'In testing', done: 'Done', cancelled: 'Cancelled' },
  fr: { open: 'Ouvert', in_progress: 'En cours', pending: 'En attente', in_testing: 'En test', done: 'Terminé', cancelled: 'Annulé' },
  de: { open: 'Offen', in_progress: 'In Bearbeitung', pending: 'Ausstehend', in_testing: 'Im Test', done: 'Erledigt', cancelled: 'Abgebrochen' },
  es: { open: 'Abierta', in_progress: 'En curso', pending: 'Pendiente', in_testing: 'En pruebas', done: 'Completada', cancelled: 'Cancelada' },
};

const TASK_PRIORITY_LABELS: Record<AiWriteLanguage, Record<string, string>> = {
  en: { blocker: 'Blocker', high: 'High', normal: 'Medium', low: 'Low', optional: 'Optional' },
  fr: { blocker: 'Bloquant', high: 'Haute', normal: 'Moyenne', low: 'Basse', optional: 'Optionnelle' },
  de: { blocker: 'Blocker', high: 'Hoch', normal: 'Mittel', low: 'Niedrig', optional: 'Optional' },
  es: { blocker: 'Bloqueante', high: 'Alta', normal: 'Media', low: 'Baja', optional: 'Opcional' },
};

const UNASSIGNED: Texts = { en: 'Unassigned', fr: 'Non assigné', de: 'Nicht zugewiesen', es: 'Sin asignar' };

function taskCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** A task status as the task screens show it; the stored code when it is unknown. */
export function taskStatusText(language: AiWriteLanguage, status: string | null | undefined): string | null {
  if (!status) return null;
  return TASK_STATUS_LABELS[language][taskCode(status)] ?? status;
}

/** A task priority as the task screens show it; the stored code when it is unknown. */
export function taskPriorityText(language: AiWriteLanguage, priority: string | null | undefined): string | null {
  if (!priority) return null;
  return TASK_PRIORITY_LABELS[language][taskCode(priority)] ?? priority;
}

export function unassignedText(language: AiWriteLanguage): string {
  return UNASSIGNED[language];
}

// ---------------------------------------------------------------------------------------------
// Fixed preview errors and the messages written after an approval or a rejection
// ---------------------------------------------------------------------------------------------

export const PREVIEW_EXPIRED_MESSAGE = 'Preview expired before approval.';
export const PREVIEW_DATA_BUSY_MESSAGE =
  'The data this change writes was busy with another operation, so nothing was changed. Approve it again in a moment.';

/** A closure whose review is being edited by someone else (the 423 of the review lock). */
export const PREVIEW_INCIDENT_REVIEW_LOCKED_MESSAGE =
  'The incident review is being edited by someone else, so nothing was changed. Try again once that edit is saved or its lock is released.';

const FIXED_PREVIEW_ERRORS: Record<string, TranslatedTexts> = {
  [PREVIEW_EXPIRED_MESSAGE]: {
    fr: "L'aperçu a expiré avant l'approbation.",
    de: 'Die Vorschau ist vor der Genehmigung abgelaufen.',
    es: 'La vista previa caducó antes de la aprobación.',
  },
  [PREVIEW_DATA_BUSY_MESSAGE]: {
    fr: "Les données que cette modification écrit étaient occupées par une autre opération : rien n'a été modifié. Approuvez-la de nouveau dans un instant.",
    de: 'Die Daten, die diese Änderung schreibt, waren durch einen anderen Vorgang belegt. Es wurde nichts geändert. Genehmigen Sie sie gleich noch einmal.',
    es: 'Los datos que escribe este cambio estaban ocupados por otra operación, así que no se ha modificado nada. Vuelva a aprobarlo en un momento.',
  },
  [PREVIEW_INCIDENT_REVIEW_LOCKED_MESSAGE]: {
    fr: "La revue de l'incident est en cours de modification par une autre personne : rien n'a été modifié. Réessayez quand cette modification sera enregistrée ou son verrou levé.",
    de: 'Die Vorfallprüfung wird gerade von einer anderen Person bearbeitet, daher wurde nichts geändert. Versuchen Sie es erneut, sobald diese Bearbeitung gespeichert oder ihre Sperre aufgehoben ist.',
    es: 'Otra persona está editando la revisión del incidente, así que no se ha modificado nada. Vuelva a intentarlo cuando se guarde esa edición o se libere su bloqueo.',
  },
};

/** Whether a preview error is one the backend writes itself (expired, data busy), in every language. */
export function isFixedPreviewError(message: string | null | undefined): boolean {
  return message != null && Object.prototype.hasOwnProperty.call(FIXED_PREVIEW_ERRORS, message);
}

/** A preview error the backend writes itself, in the person's language; any other error as it is. */
export function previewErrorText(language: AiWriteLanguage, message: string | null | undefined): string | null {
  if (message == null) return null;
  if (language === 'en') return message;
  return FIXED_PREVIEW_ERRORS[message]?.[language] ?? message;
}

/** The messages of a preview result when its summary is empty, by status. */
const RESULT_FALLBACKS: Record<'executed' | 'rejected' | 'failed' | 'expired' | 'other', Texts> = {
  executed: {
    en: 'The approved change has been executed.',
    fr: 'La modification approuvée a été appliquée.',
    de: 'Die genehmigte Änderung wurde angewendet.',
    es: 'Se ha aplicado el cambio aprobado.',
  },
  rejected: {
    en: 'The preview was rejected.',
    fr: "L'aperçu a été rejeté.",
    de: 'Die Vorschau wurde abgelehnt.',
    es: 'Se ha rechazado la vista previa.',
  },
  failed: {
    en: 'The approved change failed.',
    fr: "La modification approuvée n'a pas pu être appliquée.",
    de: 'Die genehmigte Änderung ist fehlgeschlagen.',
    es: 'No se ha podido aplicar el cambio aprobado.',
  },
  expired: {
    en: 'The preview expired before approval.',
    fr: "L'aperçu a expiré avant l'approbation.",
    de: 'Die Vorschau ist vor der Genehmigung abgelaufen.',
    es: 'La vista previa caducó antes de la aprobación.',
  },
  other: {
    en: 'The backend processed the preview action.',
    fr: "L'action sur l'aperçu a été traitée.",
    de: 'Die Aktion zur Vorschau wurde verarbeitet.',
    es: 'Se ha procesado la acción sobre la vista previa.',
  },
};

export function previewResultFallbackText(
  language: AiWriteLanguage,
  status: 'executed' | 'rejected' | 'failed' | 'expired' | 'other',
): string {
  return RESULT_FALLBACKS[status][language];
}

/** "Error: …" after a result whose change failed. */
export function previewErrorLine(language: AiWriteLanguage, message: string): string {
  return `${{ en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' }[language]}${language === 'fr' ? ' : ' : ': '}${message}`;
}

/** The first line of the message after several previews were approved or rejected at once. */
export function previewBatchText(
  language: AiWriteLanguage,
  counts: { applied: number; rejected: number; failed: number; expired: number; unchanged: number },
): string {
  const words: Record<keyof typeof counts, Texts> = {
    applied: { en: 'applied', fr: 'appliqués', de: 'angewendet', es: 'aplicadas' },
    rejected: { en: 'rejected', fr: 'rejetés', de: 'abgelehnt', es: 'rechazadas' },
    failed: { en: 'failed', fr: 'en échec', de: 'fehlgeschlagen', es: 'fallidas' },
    expired: { en: 'expired', fr: 'expirés', de: 'abgelaufen', es: 'caducadas' },
    unchanged: { en: 'unchanged', fr: 'inchangés', de: 'unverändert', es: 'sin cambios' },
  };
  const keys = (Object.keys(words) as Array<keyof typeof counts>).filter((key) => counts[key] > 0);
  if (language === 'en') {
    const parts = keys.map((key) => `${counts[key]} ${words[key].en}`);
    return parts.length > 0 ? `Preview batch completed: ${parts.join(', ')}.` : 'Preview batch completed.';
  }
  const head: TranslatedTexts = { fr: 'Aperçus traités', de: 'Vorschauen verarbeitet', es: 'Vistas previas procesadas' };
  if (keys.length === 0) return `${head[language]}.`;
  const colon = language === 'fr' ? ' : ' : ': ';
  return `${head[language]} (${keys.map((key) => `${words[key][language]}${colon}${counts[key]}`).join(', ')}).`;
}

export const previewBatchDetailText = {
  failuresHeading: (language: AiWriteLanguage) => ({ en: 'Failures:', fr: 'Échecs :', de: 'Fehler:', es: 'Errores:' }[language]),
  moreFailures: (language: AiWriteLanguage, count: number) => (language === 'en'
    ? `${count} more failed previews.`
    : labelled(language, { fr: 'Autres échecs', de: 'Weitere Fehler', es: 'Otros errores' }[language], count)),
  noErrorDetail: (language: AiWriteLanguage) => ({
    en: 'No error detail was returned.',
    fr: "Aucun détail d'erreur n'a été renvoyé.",
    de: 'Es wurden keine Fehlerdetails zurückgegeben.',
    es: 'No se ha devuelto ningún detalle del error.',
  }[language]),
};

/** The line announcing previews a plan prepared after an approval, then "N more." */
export const followUpPreviewText = {
  heading: (language: AiWriteLanguage, count: number) => (language === 'en'
    ? `${count} dependent preview${count > 1 ? 's are' : ' is'} now prepared and waiting for explicit approval.`
    : labelled(language, {
      fr: 'Aperçus dépendants prêts, en attente de votre approbation',
      de: 'Abhängige Vorschauen bereit, die auf Ihre Genehmigung warten',
      es: 'Vistas previas dependientes listas, a la espera de su aprobación',
    }[language], count)),
  more: (language: AiWriteLanguage, count: number) => (language === 'en'
    ? `${count} more.`
    : labelled(language, { fr: 'Autres', de: 'Weitere', es: 'Otras' }[language], count)),
};
