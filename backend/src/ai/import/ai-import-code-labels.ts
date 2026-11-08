import type { CsvLanguage } from '../../common/csv-sheet';

/**
 * The names of the fixed lists an import template offers, in the four languages, copied from the
 * words the screens show. The mapping card shows the name of the person's language, and the reader
 * accepts a name from any language as the code.
 *
 * `codeLabels` takes each code as en, fr, de, es. `AI_IMPORT_CODE_LISTS` says which locale object
 * the words come from; the mapping spec checks them.
 *
 * The application users mode is not a column of the template: its CSV field is not importable.
 */

/** The name of each code, in en, fr, de and es. */
export type AiImportCodeLabels = Readonly<Record<CsvLanguage, Readonly<Record<string, string>>>>;

/** `names` is en, fr, de, es. */
function codeLabels(entries: Record<string, readonly [string, string, string, string]>): AiImportCodeLabels {
  const labels: Record<CsvLanguage, Record<string, string>> = { en: {}, fr: {}, de: {}, es: {} };
  for (const [code, [en, fr, de, es]] of Object.entries(entries)) {
    labels.en[code] = en;
    labels.fr[code] = fr;
    labels.de[code] = de;
    labels.es[code] = es;
  }
  return labels;
}

export const TASK_STATUS_LABELS = codeLabels({
  open: ['Open', 'Ouvert', 'Offen', 'Abierta'],
  in_progress: ['In progress', 'En cours', 'In Bearbeitung', 'En curso'],
  pending: ['Pending', 'En attente', 'Ausstehend', 'Pendiente'],
  in_testing: ['In testing', 'En test', 'Im Test', 'En pruebas'],
  done: ['Done', 'Terminé', 'Erledigt', 'Completada'],
  cancelled: ['Cancelled', 'Annulé', 'Abgebrochen', 'Cancelada'],
});

export const PROJECT_STATUS_LABELS = codeLabels({
  waiting_list: ['Waiting list', 'Liste d\'attente', 'Warteliste', 'Lista de espera'],
  planned: ['Planned', 'Planifié', 'Geplant', 'Planificado'],
  in_progress: ['In progress', 'En cours', 'In Bearbeitung', 'En curso'],
  in_testing: ['In testing', 'En test', 'Im Test', 'En pruebas'],
  on_hold: ['On hold', 'Suspendu', 'Pausiert', 'En pausa'],
  done: ['Done', 'Terminé', 'Erledigt', 'Completado'],
  cancelled: ['Cancelled', 'Annulé', 'Abgebrochen', 'Cancelado'],
});

export const REQUEST_STATUS_LABELS = codeLabels({
  pending_review: ['Pending review', 'En attente de revue', 'Prüfung ausstehend', 'Pendiente de revisión'],
  candidate: ['Candidate', 'Candidat', 'Kandidat', 'Candidata'],
  approved: ['Approved', 'Approuvé', 'Genehmigt', 'Aprobada'],
  on_hold: ['On hold', 'Suspendu', 'Pausiert', 'En pausa'],
  rejected: ['Rejected', 'Rejeté', 'Abgelehnt', 'Rechazada'],
  converted: ['Converted', 'Converti', 'Konvertiert', 'Convertida'],
});

export const TASK_PRIORITY_LABELS = codeLabels({
  blocker: ['Blocker', 'Bloquant', 'Blocker', 'Bloqueante'],
  high: ['High', 'Haute', 'Hoch', 'Alta'],
  normal: ['Medium', 'Moyenne', 'Mittel', 'Media'],
  low: ['Low', 'Basse', 'Niedrig', 'Baja'],
  optional: ['Optional', 'Optionnelle', 'Optional', 'Opcional'],
});

export const RELATED_OBJECT_LABELS = codeLabels({
  spend_item: ['OPEX', 'OPEX', 'OPEX', 'OPEX'],
  contract: ['Contract', 'Contrat', 'Vertrag', 'Contrato'],
  capex_item: ['CAPEX', 'CAPEX', 'CAPEX', 'CAPEX'],
  project: ['Project', 'Projet', 'Projekt', 'Proyecto'],
  incident: ['Incident', 'Incident', 'Vorfall', 'Incidente'],
});

export const PROJECT_ORIGIN_LABELS = codeLabels({
  standard: ['Request', 'Demande', 'Anfrage', 'Solicitud'],
  fast_track: ['Fast-track', 'Fast-track', 'Fast-track', 'Fast-track'],
  legacy: ['Legacy', 'Historique', 'Altbestand', 'Histórico'],
});

export const COST_CENTER_KIND_LABELS = codeLabels({
  group: ['Group', 'Groupe', 'Gruppe', 'Grupo'],
  cost_center: ['Cost center', 'Centre de coûts', 'Kostenstelle', 'Centro de coste'],
});

export const PROCESS_TYPE_LABELS = codeLabels({
  management: ['Management', 'Pilotage', 'Führungsprozess', 'Estratégico'],
  core: ['Core', 'Réalisation', 'Kernprozess', 'Operativo'],
  support: ['Support', 'Support', 'Unterstützungsprozess', 'Apoyo'],
});

/** An account's nature and an analytics value's "used for": OPEX only, CAPEX only. */
export const LINE_USAGE_LABELS = codeLabels({
  opex: ['OPEX only', 'OPEX uniquement', 'Nur OPEX', 'Solo OPEX'],
  capex: ['CAPEX only', 'CAPEX uniquement', 'Nur CAPEX', 'Solo CAPEX'],
});

/** A budget line's nature, as the budget screen names the line type. */
export const BUDGET_NATURE_LABELS = codeLabels({
  opex: ['OPEX', 'OPEX', 'OPEX', 'OPEX'],
  capex: ['CAPEX', 'CAPEX', 'CAPEX', 'CAPEX'],
});

export const INCIDENT_SEVERITY_LABELS = codeLabels({
  critical: ['Critical', 'Critique', 'Kritisch', 'Crítica'],
  major: ['Major', 'Majeure', 'Hoch', 'Alta'],
  minor: ['Minor', 'Mineure', 'Mittel', 'Media'],
  low: ['Low', 'Faible', 'Niedrig', 'Baja'],
});

export const INCIDENT_STATUS_LABELS = codeLabels({
  open: ['Open', 'Ouvert', 'Offen', 'Abierto'],
  in_progress: ['In progress', 'En cours', 'In Bearbeitung', 'En curso'],
  resolved: ['Resolved', 'Résolu', 'Behoben', 'Resuelto'],
  closed: ['Closed', 'Clôturé', 'Geschlossen', 'Cerrado'],
  cancelled: ['Cancelled', 'Annulé', 'Abgebrochen', 'Cancelado'],
});

export const BILLING_FREQUENCY_LABELS = codeLabels({
  monthly: ['Monthly', 'Mensuelle', 'Monatlich', 'Mensual'],
  quarterly: ['Quarterly', 'Trimestrielle', 'Vierteljährlich', 'Trimestral'],
  annual: ['Annual', 'Annuelle', 'Jährlich', 'Anual'],
  other: ['Other', 'Autre', 'Sonstige', 'Otra'],
});

export const RUN_BUILD_LABELS = codeLabels({
  run: ['Run', 'Run', 'Run', 'Run'],
  build: ['Build', 'Build', 'Build', 'Build'],
});

/** Where each list's words live in `frontend/src/locales/<lang>/<namespace>.json`. */
export const AI_IMPORT_CODE_LISTS: ReadonlyArray<{
  namespace: string;
  /** The object in that file whose keys are the codes. */
  path: string;
  labels: AiImportCodeLabels;
}> = [
  { namespace: 'portfolio', path: 'statuses.task', labels: TASK_STATUS_LABELS },
  { namespace: 'portfolio', path: 'statuses.project', labels: PROJECT_STATUS_LABELS },
  { namespace: 'portfolio', path: 'statuses.request', labels: REQUEST_STATUS_LABELS },
  { namespace: 'portfolio', path: 'priority', labels: TASK_PRIORITY_LABELS },
  { namespace: 'portfolio', path: 'context', labels: RELATED_OBJECT_LABELS },
  { namespace: 'portfolio', path: 'origin', labels: PROJECT_ORIGIN_LABELS },
  { namespace: 'master-data', path: 'costCenters.kinds', labels: COST_CENTER_KIND_LABELS },
  { namespace: 'master-data', path: 'businessProcesses.types', labels: PROCESS_TYPE_LABELS },
  { namespace: 'master-data', path: 'shared.lineTypeUsage', labels: LINE_USAGE_LABELS },
  { namespace: 'ops', path: 'operations.scope', labels: BUDGET_NATURE_LABELS },
  { namespace: 'it', path: 'enums.incidentSeverity', labels: INCIDENT_SEVERITY_LABELS },
  { namespace: 'it', path: 'enums.incidentStatus', labels: INCIDENT_STATUS_LABELS },
  { namespace: 'ops', path: 'contracts.billing', labels: BILLING_FREQUENCY_LABELS },
  { namespace: 'ops', path: 'opex.runBuild', labels: RUN_BUILD_LABELS },
];

/** The CSV enums. A budget nature and an account nature share their codes and stay hand-written. */
const CSV_ENUM_LISTS: readonly AiImportCodeLabels[] = [
  TASK_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  RELATED_OBJECT_LABELS,
  PROJECT_ORIGIN_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
];

/** The screen names of a CSV enum, when the import templates offer that list. */
export function labelsForEnum(codes: readonly string[] | undefined): AiImportCodeLabels | undefined {
  if (!codes?.length) return undefined;
  return CSV_ENUM_LISTS.find((labels) => {
    const known = Object.keys(labels.en);
    return known.length === codes.length && known.every((code) => codes.includes(code));
  });
}
