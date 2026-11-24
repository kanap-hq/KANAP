import { validate as isUuid } from 'uuid';
import type { EntityManager } from 'typeorm';
import { tenantSeedLanguage } from '../analytics/recommended-dimensions.seed';
import type { CsvLanguage } from '../common/csv-sheet';
import { shippedLabelIn } from '../it-ops-settings/catalog-shipped-labels';
import type { CatalogLabel, ItOpsCatalogLabels } from '../it-ops-settings/it-ops-settings.service';
import { APPLICATION_FIXED_LABELS } from '../applications/application-fixed-labels';
import { BUDGET_COLUMN_LABELS, localizedBudgetColumnName } from '../budget-columns/budget-column-labels';
import type { BudgetColumnsSettings } from '../budget-columns/budget-columns.util';
import { formatAllocationMethodLabel } from '../spend/allocation-utils';
import type { BudgetColumn } from '../spend/amounts-write.util';
import { CHARGEBACK_EXPORT_LABELS } from '../spend/chargeback-report.export';
import { END_OF_SUPPORT_EXPORT_LABELS } from '../technologies/reports/end-of-support-export-labels';
import { aiScreenLanguage } from './ai-unread-families';
import { VULNERABILITY_STATE_LABELS } from './ai-write-texts';
import { countryNameIn } from './import/ai-import-countries';
import {
  BILLING_FREQUENCY_LABELS,
  BUDGET_NATURE_LABELS,
  codeLabels,
  COST_CENTER_KIND_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  LINE_USAGE_LABELS,
  PROCESS_TYPE_LABELS,
  PROJECT_ORIGIN_LABELS,
  PROJECT_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  RUN_BUILD_LABELS,
  SUPPLIER_CONTACT_ROLE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type AiImportCodeLabels,
} from './import/ai-import-code-labels';

/**
 * The name of a code next to the code, in what Kad and the MCP server read (lot K2d): a value of a
 * fixed list or of the workspace's catalog arrives with `<field>_name`, the word the screen shows
 * in the reader's language. The code stays: the model filters and writes with it, and quotes the
 * name. A list exists once on the server; adding one is an entry of `AI_CODE_LISTS` and of
 * `AI_NAMED_FIELDS`, and a fixed list's copy is checked against the screens' locale object by
 * `ai-code-names.spec.ts`.
 */

export type AiNamesLanguage = CsvLanguage;

/** The catalog lists a screen names a stored code from (IT settings and classification catalog). */
export type AiCatalogListName = keyof ItOpsCatalogLabels;

/**
 * A fixed list: `screen`, the locale object of the screens that names it (`namespace:path`), and the
 * server's copy of its words. `keys` gives the locale key of a code that is not the code itself
 * (`pre_prod` is `preProd`); `aliases` reads another stored form as a code.
 */
export type AiFixedCodeList = {
  kind: 'fixed';
  screen: string;
  labels: AiImportCodeLabels;
  keys?: Readonly<Record<string, string>>;
  aliases?: Readonly<Record<string, string>>;
};

/**
 * A catalog list of the workspace, named as its screens name it (`localizeCatalogItem`): the
 * workspace's translation, else the shipped word while the workspace keeps the shipped value, else
 * the workspace's own label. A list the workspace did not translate keeps its own label.
 */
export type AiCatalogCodeList = { kind: 'catalog'; list: AiCatalogListName };

/** A country by its two-letter code, named in the reader's language as the screens name it (`countryNameFor`). */
export type AiCountryCodeList = { kind: 'country' };

/** A language of the profile (`en`, `fr-FR`), named as the Profile screen names it (`SUPPORTED_LANGUAGES`). */
export type AiLanguageCodeList = { kind: 'language' };

/**
 * A budget column (`budget`, `review`, `forecast`, `actual`, `landing`), named as the screens name
 * it: the workspace's name for the column, else the product name in the reader's language.
 */
export type AiBudgetColumnCodeList = { kind: 'budgetColumn'; aliases: Readonly<Record<string, BudgetColumn>> };

/** The name from the first list that knows the code (an asset's provider: a server provider, else a hosting type). */
export type AiFirstOfCodeList = { kind: 'firstOf'; lists: readonly AiCodeList[] };

export type AiCodeList = AiFixedCodeList | AiCatalogCodeList | AiCountryCodeList | AiLanguageCodeList | AiBudgetColumnCodeList | AiFirstOfCodeList;

/** A field holding a code, or several separated by ", " (`multi`). */
export type AiCodeField = { list: AiCodeList; multi?: boolean };

const fixed = (screen: string, labels: AiImportCodeLabels, extra: Pick<AiFixedCodeList, 'keys' | 'aliases'> = {}): AiFixedCodeList => ({
  kind: 'fixed', screen, labels, ...extra,
});
const catalog = (list: AiCatalogListName): AiCatalogCodeList => ({ kind: 'catalog', list });

/**
 * A list copied from an export's words (`labels`, per language), taking for each code the export's
 * key (`keys`): the server keeps one copy of a screen's words.
 */
function fromExport(labels: Readonly<Record<AiNamesLanguage, Readonly<Record<string, string>>>>, keys: Readonly<Record<string, string>>): AiImportCodeLabels {
  const pick = (language: AiNamesLanguage) => Object.fromEntries(Object.entries(keys).map(([code, key]) => [code, labels[language][key]]));
  return { en: pick('en'), fr: pick('fr'), de: pick('de'), es: pick('es') };
}

/** A list held by code, then language (`APPLICATION_FIXED_LABELS`). */
function byCode(labels: Readonly<Record<string, Readonly<Record<AiNamesLanguage, string>>>>): AiImportCodeLabels {
  return codeLabels(Object.fromEntries(Object.entries(labels).map(([code, words]) => [code, [words.en, words.fr, words.de, words.es] as const])));
}

/** The keys of an export's words with a prefix (`type_technology`), by code. */
function prefixed(prefix: string, codes: readonly string[]): Record<string, string> {
  return Object.fromEntries(codes.map((code) => [code, `${prefix}${code}`]));
}

/** A record's enabled or disabled status, as the lists name it. */
export const ENABLED_STATUS_LABELS = codeLabels({
  enabled: ['Enabled', 'Activé', 'Aktiviert', 'Activado'],
  disabled: ['Disabled', 'Désactivé', 'Deaktiviert', 'Desactivado'],
});

/** A contact's status (`active` false is inactive). */
export const CONTACT_STATUS_LABELS = codeLabels({
  active: ['Active', 'Actif', 'Aktiv', 'Activo'],
  inactive: ['Inactive', 'Inactif', 'Inaktiv', 'Inactivo'],
});

/** The environment of a deployment or an asset. */
export const ENVIRONMENT_LABELS = codeLabels({
  prod: ['Prod', 'Prod', 'Prod', 'Prod'],
  pre_prod: ['Pre-prod', 'Pré-prod', 'Pre-Prod', 'Pre-prod'],
  qa: ['QA', 'QA', 'QA', 'QA'],
  test: ['Test', 'Test', 'Test', 'Test'],
  dev: ['Dev', 'Dev', 'Dev', 'Dev'],
  sandbox: ['Sandbox', 'Bac à sable', 'Sandbox', 'Sandbox'],
});

/** An application's hosting model. */
export const HOSTING_MODEL_LABELS = codeLabels({
  on_premise: ['On premise', 'Sur site', 'On-Premise', 'Local'],
  saas: ['SaaS', 'SaaS', 'SaaS', 'SaaS'],
  public_cloud: ['Public cloud', 'Cloud public', 'Public Cloud', 'Cloud público'],
  private_cloud: ['Private cloud', 'Cloud privé', 'Private Cloud', 'Cloud privado'],
});

/** The allocation method of a budget line's year, as the Allocations tab names it. */
export const ALLOCATION_METHOD_LABELS = codeLabels({
  default: ['Default', 'Par défaut', 'Standard', 'Predeterminado'],
  headcount: ['Headcount', 'Effectif', 'Mitarbeiterzahl', 'Plantilla'],
  it_users: ['IT users', 'Utilisateurs IT', 'IT-Benutzer', 'Usuarios IT'],
  turnover: ['Turnover', "Chiffre d'affaires", 'Umsatz', 'Facturación'],
  manual_company: ['Manual by company', 'Manuel par société', 'Manuell nach Unternehmen', 'Manual por empresa'],
  manual_department: ['Manual by department', 'Manuel par département', 'Manuell nach Abteilung', 'Manual por departamento'],
  manual_pct: ['Manual percentages', 'Pourcentages manuels', 'Manuelle Prozentsätze', 'Porcentajes manuales'],
});

/** An application owner's type. */
export const OWNER_TYPE_LABELS = codeLabels({
  business: ['Business', 'Métier', 'Fachbereich', 'Negocio'],
  it: ['IT', 'IT', 'IT', 'IT'],
});

/** Whether a record has vulnerabilities to review, as the Vulnerabilities filter of the lists names it. */
export const VULNERABILITY_PRESENCE_LABELS = codeLabels({
  severe: ['With severe vulnerabilities', 'Avec des vulnérabilités graves', 'Mit schwerwiegenden Schwachstellen', 'Con vulnerabilidades graves'],
  any: ['With vulnerabilities', 'Avec des vulnérabilités', 'Mit Schwachstellen', 'Con vulnerabilidades'],
  none: ['Without', 'Sans', 'Ohne', 'Sin'],
});

/** A chart of accounts' scope, as the chart dialog names its two choices. */
export const CHART_SCOPE_LABELS = codeLabels({
  COUNTRY: ['One country', 'Un pays', 'Ein Land', 'Un país'],
  GLOBAL: ['All countries', 'Tous les pays', 'Alle Länder', 'Todos los países'],
});

/** A connection's topology. */
export const TOPOLOGY_LABELS = codeLabels({
  server_to_server: ['Server to server', 'Serveur à serveur', 'Server zu Server', 'Servidor a servidor'],
  multi_server: ['Multi-server', 'Multi-serveur', 'Multi-Server', 'Multi-servidor'],
});

/** How a connection's risk is set. */
export const RISK_MODE_LABELS = codeLabels({
  manual: ['Manual', 'Manuel', 'Manuell', 'Manual'],
  derived: ['Derived', 'Dérivé', 'Abgeleitet', 'Derivado'],
});

/** An interface's route type. */
export const ROUTE_TYPE_LABELS = codeLabels({
  direct: ['Direct', 'Direct', 'Direkt', 'Directo'],
  via_middleware: ['Via middleware', 'Via middleware', 'Über Middleware', 'Vía middleware'],
});

/** A data access node's type, as the Type column of the data access dialog names it. */
export const DATA_ACCESS_NODE_TYPE_LABELS = codeLabels({
  all: ['Everything', 'Tout', 'Alles', 'Todo'],
  company: ['Company', 'Société', 'Unternehmen', 'Empresa'],
  cost_center: ['Cost center', 'Centre de coûts', 'Kostenstelle', 'Centro de coste'],
});

/** A cost center node's kind, as the same column names a group. */
export const DATA_ACCESS_NODE_KIND_LABELS = codeLabels({
  group: ['Cost center group', 'Groupe de centres', 'Kostenstellengruppe', 'Grupo de centros'],
  cost_center: ['Cost center', 'Centre de coûts', 'Kostenstelle', 'Centro de coste'],
});

/** A data access node's level. */
export const DATA_ACCESS_LEVEL_LABELS = codeLabels({
  read: ['Read', 'Lecture', 'Lesen', 'Lectura'],
  edit: ['Edit', 'Saisie', 'Bearbeiten', 'Edición'],
});

/** A person's data access, as the two choices of their Data access panel name it. */
export const DATA_ACCESS_MODE_LABELS = codeLabels({
  all: ['All data', 'Toutes les données', 'Alle Daten', 'Todos los datos'],
  limited: ['Limited to', 'Limité à', 'Begrenzt auf', 'Limitado a'],
});

/** A knowledge document's status. */
export const DOCUMENT_STATUS_LABELS = codeLabels({
  archived: ['Archived', 'Archivé', 'Archiviert', 'Archivado'],
  draft: ['Draft', 'Brouillon', 'Entwurf', 'Borrador'],
  in_review: ['In review', 'En revue', 'In Prüfung', 'En revisión'],
  obsolete: ['Obsolete', 'Obsolète', 'Veraltet', 'Obsoleto'],
  published: ['Published', 'Publié', 'Veröffentlicht', 'Publicado'],
});

/** A role's badge on the Roles screen; a custom role shows none, and its code has no name. */
export const ROLE_TYPE_LABELS = codeLabels({
  built_in: ['Built-in', 'Intégré', 'Integriert', 'Integrado'],
  system: ['System', 'Système', 'System', 'Sistema'],
});

/** The record a task belongs to, as the task's context names its family. */
export const TASK_RELATED_LABELS = codeLabels({
  standalone: ['Standalone', 'Autonome', 'Eigenständig', 'Independiente'],
  project: ['Project', 'Projet', 'Projekt', 'Proyecto'],
  budget_line: ['Budget', 'Budget', 'Budget', 'Presupuesto'],
  contract: ['Contract', 'Contrat', 'Vertrag', 'Contrato'],
  incident: ['Incident', 'Incident', 'Vorfall', 'Incidente'],
});

/** A technology's or a version's support state, as the versions of a technology name it. */
export const SUPPORT_STATUS_LABELS = codeLabels({
  supported: ['Supported', 'Supportée', 'Unterstützt', 'Con soporte'],
  ending_soon: ['Ending soon', 'Fin proche', 'Endet bald', 'Finaliza pronto'],
  extended_support: ['Extended support', 'Support étendu', 'Erweiterter Support', 'Soporte extendido'],
  out_of_support: ['Out of support', 'Hors support', 'Kein Support', 'Sin soporte'],
  unknown: ['Date unknown', 'Date inconnue', 'Datum unbekannt', 'Fecha desconocida'],
});

/** A CVE's severity, as the vulnerabilities page names it (`unknown`: not rated). */
export const VULNERABILITY_SEVERITY_LABELS = codeLabels({
  critical: ['Critical', 'Critique', 'Kritisch', 'Crítica'],
  high: ['High', 'Élevée', 'Hoch', 'Alta'],
  medium: ['Medium', 'Moyenne', 'Mittel', 'Media'],
  low: ['Low', 'Faible', 'Niedrig', 'Baja'],
  none: ['None', 'Aucune', 'Keine', 'Ninguna'],
  unknown: ['Not rated', 'Non évaluée', 'Nicht bewertet', 'Sin evaluar'],
});

/** The feed of a CVE's score or match, as the Source badge names it. */
export const VULNERABILITY_FEED_LABELS = codeLabels({
  nvd: ['NVD', 'NVD', 'NVD', 'NVD'],
  cve_org: ['Publisher', 'Éditeur', 'Hersteller', 'Editor'],
});

/**
 * Where an exchange rate comes from, as the Currency settings name it: the source of a year's set
 * under its year, the estimate mark and the manual footnote. The reporting currency's own rate
 * (`identity`) shows no source and has no name.
 */
export const RATE_SOURCE_LABELS = codeLabels({
  'world-bank-annual': ['Annual avg', 'Moyenne annuelle', 'Jahresdurchschnitt', 'Media anual'],
  'world-bank-quarterly': ['Quarterly avg', 'Moyenne trimestrielle', 'Quartalsdurchschnitt', 'Media trimestral'],
  'exchangerateapi-spot': ['Live spot', 'Spot en temps réel', 'Live-Spot', 'Spot en tiempo real'],
  'world-bank-forward': ['Forward estimate', 'Estimation à terme', 'Terminschätzung', 'Estimación a futuro'],
  estimate: ['estimate', 'estimation', 'Schätzung', 'estimación'],
  manual: ['Rate entered manually', 'Taux saisi manuellement', 'Manuell erfasster Kurs', 'Tipo introducido manualmente'],
});

/** The languages of a profile, each in its own words, as the Profile screen lists them. */
export const LANGUAGE_NATIVE_NAMES: Readonly<Record<AiNamesLanguage, string>> = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
};

/** The state of a contract's current term, as the State column of the Contracts list names it. */
export const CONTRACT_TERM_STATE_LABELS = codeLabels({
  to_decide: ['To decide', 'À décider', 'Zu entscheiden', 'Por decidir'],
  in_progress: ['In progress', 'En cours', 'Laufend', 'En curso'],
  renewed: ['Renewed', 'Reconduit', 'Verlängert', 'Renovado'],
  ending: ['Ends without renewal', 'Fin sans reconduction', 'Endet ohne Verlängerung', 'Termina sin renovación'],
  expired: ['Expired', 'Échu', 'Abgelaufen', 'Vencido'],
});

/** The locale key of a code written in snake case where the screens' keys are in camel case. */
function camelKeys(labels: AiImportCodeLabels): Record<string, string> {
  return Object.fromEntries(Object.keys(labels.en).map((code) => [code, code.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())]));
}

/**
 * The budget lines carry their allocation method as the budget list writes it ("Manual %",
 * `formatAllocationMethodLabel`), which their filters and groups also take: that stored form reads
 * as its code.
 */
const ALLOCATION_METHOD_ALIASES: Record<string, string> = Object.fromEntries(
  Object.keys(ALLOCATION_METHOD_LABELS.en)
    .map((code) => [formatAllocationMethodLabel(code), code])
    .filter(([label]) => !!label),
);

export const AI_CODE_LISTS = {
  enabled: fixed('common:statuses', ENABLED_STATUS_LABELS),
  contactStatus: fixed('master-data:contacts.status', CONTACT_STATUS_LABELS),
  lifecycle: catalog('lifecycleStates'),
  applicationCategory: catalog('applicationCategories'),
  businessCriticality: catalog('businessCriticalityLevels'),
  cyberCriticality: catalog('cyberCriticalityLevels'),
  recoveryWave: catalog('recoveryWaves'),
  dataClass: catalog('dataClasses'),
  hostingType: catalog('hostingTypes'),
  incidentCategory: catalog('incidentCategories'),
  serverKind: catalog('serverKinds'),
  adminZone: catalog('adminZones'),
  networkSegment: catalog('networkSegments'),
  technologyFamily: catalog('technologyFamilies'),
  interfaceDataCategory: catalog('interfaceDataCategories'),
  environment: fixed('it:enums.environment', ENVIRONMENT_LABELS, { keys: camelKeys(ENVIRONMENT_LABELS) }),
  hostingModel: fixed('it:enums.hostingModel', HOSTING_MODEL_LABELS, { keys: camelKeys(HOSTING_MODEL_LABELS) }),
  projectStatus: fixed('portfolio:statuses.project', PROJECT_STATUS_LABELS),
  projectOrigin: fixed('portfolio:origin', PROJECT_ORIGIN_LABELS),
  requestStatus: fixed('portfolio:statuses.request', REQUEST_STATUS_LABELS),
  taskStatus: fixed('portfolio:statuses.task', TASK_STATUS_LABELS),
  taskPriority: fixed('portfolio:priority', TASK_PRIORITY_LABELS),
  incidentStatus: fixed('it:enums.incidentStatus', INCIDENT_STATUS_LABELS),
  incidentSeverity: fixed('it:enums.incidentSeverity', INCIDENT_SEVERITY_LABELS),
  contractTermState: fixed('ops:contracts.list.states', CONTRACT_TERM_STATE_LABELS),
  billingFrequency: fixed('ops:contracts.billing', BILLING_FREQUENCY_LABELS),
  contactRole: fixed('master-data:contacts.roles', SUPPLIER_CONTACT_ROLE_LABELS),
  ownerType: fixed('admin:auditLogs.values.ownerType', OWNER_TYPE_LABELS),
  allocationMethod: fixed('admin:auditLogs.values.allocationMethod', ALLOCATION_METHOD_LABELS, {
    keys: camelKeys(ALLOCATION_METHOD_LABELS),
    aliases: ALLOCATION_METHOD_ALIASES,
  }),
  budgetNature: fixed('admin:auditLogs.values.nature', BUDGET_NATURE_LABELS),
  lineUsage: fixed('admin:auditLogs.values.lineTypeUsage', LINE_USAGE_LABELS),
  runBuild: fixed('admin:auditLogs.values.runBuild', RUN_BUILD_LABELS),
  costCenterKind: fixed('admin:auditLogs.values.costCenterKind', COST_CENTER_KIND_LABELS),
  processType: fixed('master-data:businessProcesses.types', PROCESS_TYPE_LABELS),
  vulnerabilityState: fixed('admin:auditLogs.values.vulnerabilityState', VULNERABILITY_STATE_LABELS as AiImportCodeLabels),
  vulnerabilityPresence: fixed('it:pages.technologies.vulnerabilityFilter', VULNERABILITY_PRESENCE_LABELS),
  classificationReview: fixed('it:classification', byCode(APPLICATION_FIXED_LABELS.classification_review_state), {
    keys: { incomplete: 'to_complete', stale: 'review_needed', reviewed: 'reviewed' },
  }),
  usersMode: fixed('admin:auditLogs.values.usersMode', byCode(APPLICATION_FIXED_LABELS.users_mode), {
    keys: camelKeys(byCode(APPLICATION_FIXED_LABELS.users_mode)),
  }),
  country: { kind: 'country' },
  language: { kind: 'language' },
  serverProvider: catalog('serverProviders'),
  assetProvider: { kind: 'firstOf', lists: [catalog('serverProviders'), catalog('hostingTypes')] },
  chartScope: fixed('master-data:coa.createDialog', CHART_SCOPE_LABELS, { keys: { COUNTRY: 'scopeCountry', GLOBAL: 'scopeGlobal' } }),
  topology: fixed('it:enums.topology', TOPOLOGY_LABELS, { keys: camelKeys(TOPOLOGY_LABELS) }),
  riskMode: fixed('it:enums.riskMode', RISK_MODE_LABELS),
  routeType: fixed('it:enums.routeType', ROUTE_TYPE_LABELS, { keys: camelKeys(ROUTE_TYPE_LABELS) }),
  dataAccessNodeType: fixed('admin:dataAccess.types', DATA_ACCESS_NODE_TYPE_LABELS, {
    keys: { all: 'everything', company: 'company', cost_center: 'costCenter' },
  }),
  dataAccessNodeKind: fixed('admin:dataAccess.types', DATA_ACCESS_NODE_KIND_LABELS, {
    keys: { group: 'costCenterGroup', cost_center: 'costCenter' },
  }),
  dataAccessLevel: fixed('admin:dataAccess.access', DATA_ACCESS_LEVEL_LABELS),
  dataAccessMode: fixed('admin:dataAccess', DATA_ACCESS_MODE_LABELS, { keys: { all: 'allData', limited: 'limitedTo' } }),
  documentStatus: fixed('knowledge:statuses', DOCUMENT_STATUS_LABELS),
  roleType: fixed('admin:roles.badges', ROLE_TYPE_LABELS, { keys: camelKeys(ROLE_TYPE_LABELS) }),
  endOfSupportType: fixed('it:pages.endOfSupport.types', fromExport(END_OF_SUPPORT_EXPORT_LABELS,
    prefixed('type_', ['technology', 'operating_system', 'application', 'hardware']))),
  endOfSupportState: fixed('it:pages.endOfSupport.states', fromExport(END_OF_SUPPORT_EXPORT_LABELS,
    prefixed('state_', ['out_of_support', 'extended_support', 'upcoming']))),
  endOfSupportMilestone: fixed('it:pages.endOfSupport.milestones', fromExport(END_OF_SUPPORT_EXPORT_LABELS,
    prefixed('milestone_', ['end_of_life', 'support_contract']))),
  supportGap: fixed('it:pages.endOfSupport.gaps', fromExport(END_OF_SUPPORT_EXPORT_LABELS, prefixed('gap_', [
    'application_without_server', 'vm_without_host', 'technology_not_installed', 'technology_without_hosting_type',
    'database_server_without_dbms', 'sso_application_without_identity', 'link_without_version', 'version_without_end_date',
  ]))),
  // The family of a record to complete, as the end of support report's export names it.
  recordToComplete: fixed('it:', fromExport(END_OF_SUPPORT_EXPORT_LABELS, {
    application: 'type_application', asset: 'record_asset', technology: 'type_technology',
  }), {
    keys: {
      application: 'pages.endOfSupport.types.application',
      asset: 'workspace.application.relations.types.asset',
      technology: 'pages.endOfSupport.types.technology',
    },
  }),
  taskRelated: fixed('common:relatedObject.types', TASK_RELATED_LABELS, { keys: camelKeys(TASK_RELATED_LABELS) }),
  supportStatus: fixed('it:workspace.technology.versions.status', SUPPORT_STATUS_LABELS, {
    keys: { supported: 'supported', ending_soon: 'ending_soon', extended_support: 'extended', out_of_support: 'ended', unknown: 'unknown' },
  }),
  vulnerabilitySeverity: fixed('it:pages.vulnerabilities.severities', VULNERABILITY_SEVERITY_LABELS),
  vulnerabilityFeed: fixed('it:pages.vulnerabilities.feeds.badge', VULNERABILITY_FEED_LABELS),
  budgetColumn: { kind: 'budgetColumn', aliases: { review: 'revision', actual: 'follow_up' } },
  // A chargeback row's level, as the report's columns and its common costs row name it.
  chargebackLevel: fixed('ops:reports', fromExport(CHARGEBACK_EXPORT_LABELS, {
    company: 'company', department: 'department', common: 'commonCosts',
  }), {
    keys: { company: 'columns.company', department: 'columns.department', common: 'globalChargeback.commonCosts' },
  }),
  rateSource: fixed('ops:operations.currency', RATE_SOURCE_LABELS, {
    keys: {
      'world-bank-annual': 'annualAvg',
      'world-bank-quarterly': 'quarterlyAvg',
      'exchangerateapi-spot': 'liveSpot',
      'world-bank-forward': 'forwardEstimate',
      estimate: 'estimateMark',
      manual: 'manualFootnote',
    },
  }),
} as const satisfies Record<string, AiCodeList>;

const L = AI_CODE_LISTS;
const one = (list: AiCodeList): AiCodeField => ({ list });
const many = (list: AiCodeList): AiCodeField => ({ list, multi: true });

/**
 * The named fields of each family, by the key the read results carry: an item's `status` and its
 * `metadata` keys, the registry field (filters, groups, filter values) and the key of the detail's
 * `data`. The fields of the registries not named yet are in `ai-code-names.inventory.ts`.
 */
export const AI_NAMED_FIELDS: Readonly<Record<string, Readonly<Record<string, AiCodeField>>>> = {
  applications: {
    status: one(L.enabled),
    lifecycle: one(L.lifecycle),
    category: one(L.applicationCategory),
    criticality: one(L.businessCriticality),
    cyber_criticality: one(L.cyberCriticality),
    recovery_wave: one(L.recoveryWave),
    data_class: one(L.dataClass),
    environment: one(L.environment),
    environments: many(L.environment),
    hosting_model: one(L.hostingModel),
    hosting_types: many(L.hostingType),
    classification_review_state: one(L.classificationReview),
    users_mode: one(L.usersMode),
    data_residency: many(L.country),
    vulnerabilities: one(L.vulnerabilityPresence),
  },
  assets: {
    status: one(L.lifecycle),
    kind: one(L.serverKind),
    environment: one(L.environment),
    hosting_type: one(L.hostingType),
    admin_zone: one(L.adminZone),
    network_segment: one(L.networkSegment),
    provider: one(L.assetProvider),
    vulnerabilities: one(L.vulnerabilityPresence),
  },
  interfaces: {
    // An interface's `status` is its lifecycle.
    status: one(L.lifecycle),
    lifecycle: one(L.lifecycle),
    criticality: one(L.businessCriticality),
    data_class: one(L.dataClass),
    data_category: one(L.interfaceDataCategory),
    binding_environments: many(L.environment),
    integration_route_type: one(L.routeType),
  },
  connections: {
    status: one(L.lifecycle),
    lifecycle: one(L.lifecycle),
    criticality: one(L.businessCriticality),
    data_class: one(L.dataClass),
    topology: one(L.topology),
    risk_mode: one(L.riskMode),
  },
  technologies: {
    status: one(L.lifecycle),
    lifecycle: one(L.lifecycle),
    family: one(L.technologyFamily),
    hosting_type: one(L.hostingType),
    admin_zone: one(L.adminZone),
    support_status: one(L.supportStatus),
  },
  technology_versions: {
    // A version's `status` is its support state.
    status: one(L.supportStatus),
    support_status: one(L.supportStatus),
    lifecycle: one(L.lifecycle),
    family: one(L.technologyFamily),
  },
  locations: {
    hosting_type: one(L.hostingType),
    // A location on premises carries its operating company's name instead, which no list names.
    provider: one(L.serverProvider),
    country: one(L.country),
    country_iso: one(L.country),
  },
  projects: {
    status: one(L.projectStatus),
    origin: one(L.projectOrigin),
  },
  requests: {
    status: one(L.requestStatus),
  },
  tasks: {
    status: one(L.taskStatus),
    priority: one(L.taskPriority),
    priority_level: one(L.taskPriority),
    related: one(L.taskRelated),
  },
  incidents: {
    status: one(L.incidentStatus),
    severity: one(L.incidentSeverity),
    category: one(L.incidentCategory),
  },
  contracts: {
    status: one(L.enabled),
    term_state: one(L.contractTermState),
    billing_frequency: one(L.billingFrequency),
  },
  contacts: {
    status: one(L.contactStatus),
    supplier_role: one(L.contactRole),
    country: one(L.country),
  },
  budget_lines: {
    status: one(L.enabled),
    nature: one(L.budgetNature),
    run_build: one(L.runBuild),
    allocation_method: one(L.allocationMethod),
    next_year_allocation_method: one(L.allocationMethod),
    allocation_method_label: one(L.allocationMethod),
    next_year_allocation_method_label: one(L.allocationMethod),
  },
  chargeback: {
    // A chargeback row's `status` is its level.
    status: one(L.chargebackLevel),
    level: one(L.chargebackLevel),
    nature: one(L.budgetNature),
    column: one(L.budgetColumn),
  },
  chargeback_lines: {
    column: one(L.budgetColumn),
    // A chargeback line's `status` is its allocation method.
    status: one(L.allocationMethod),
    allocation_method: one(L.allocationMethod),
    nature: one(L.budgetNature),
  },
  accounts: {
    status: one(L.enabled),
    nature: one(L.lineUsage),
  },
  analytics_categories: {
    status: one(L.enabled),
    applies_to: one(L.lineUsage),
  },
  business_processes: {
    status: one(L.enabled),
    process_type: one(L.processType),
  },
  cost_centers: {
    status: one(L.enabled),
    kind: one(L.costCenterKind),
  },
  companies: { status: one(L.enabled), country: one(L.country), country_iso: one(L.country) },
  chart_of_accounts: { scope: one(L.chartScope), country_iso: one(L.country) },
  suppliers: { status: one(L.enabled) },
  departments: { status: one(L.enabled) },
  users: { status: one(L.enabled), data_access: one(L.dataAccessMode), locale: one(L.language) },
  analytics_axes: { status: one(L.enabled), applies_to: one(L.lineUsage), required_for: many(L.budgetNature) },
  working_day_calendars: { status: one(L.enabled) },
  vulnerabilities: {
    // A vulnerability row's `status` is its review state.
    status: one(L.vulnerabilityState),
    state: one(L.vulnerabilityState),
    severity: one(L.vulnerabilitySeverity),
    score_source: one(L.vulnerabilityFeed),
    sources: many(L.vulnerabilityFeed),
  },
  data_access: {
    // A data access row's `status` is its level.
    status: one(L.dataAccessLevel),
    access: one(L.dataAccessLevel),
    node_type: one(L.dataAccessNodeType),
    node_kind: one(L.dataAccessNodeKind),
  },
  documents: { status: one(L.documentStatus) },
  roles: {
    // A role's `status` is its type.
    status: one(L.roleType),
    type: one(L.roleType),
  },
  role_permissions: { role_type: one(L.roleType) },
  support_deadlines: {
    // A deadline's `status` is its state.
    status: one(L.endOfSupportState),
    state: one(L.endOfSupportState),
    subject_type: one(L.endOfSupportType),
    milestone: one(L.endOfSupportMilestone),
  },
  support_gaps: {
    // A gap row's `status` is its gap.
    status: one(L.supportGap),
    gap: one(L.supportGap),
    subject_type: one(L.recordToComplete),
    related_type: one(L.recordToComplete),
  },
  exchange_rates: {
    // A rate's `status` is its source.
    status: one(L.rateSource),
    source: one(L.rateSource),
  },
};

/**
 * The child rows of a detail whose fields hold codes: family, then the key of the list in `data`
 * (an array, or an object with `items`), then the field.
 */
export const AI_NAMED_CHILD_FIELDS: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, AiCodeField>>>>>> = {
  applications: {
    owners: { owner_type: one(L.ownerType) },
    instances: { environment: one(L.environment) },
    deployments: { environment: one(L.environment) },
  },
  budget_lines: {
    // A line's contacts are typed by the contact types (`contacts.roles`), as the screen shows them.
    contacts: { role: one(L.contactRole) },
    financial_versions: { allocation_method: one(L.allocationMethod), resolved_allocation_method: one(L.allocationMethod) },
  },
  contracts: {
    contacts: { role: one(L.contactRole) },
  },
};

/** One catalog value's name in `language`, as the screen localizes it. */
export function catalogValueName(list: AiCatalogListName, option: CatalogLabel, language: AiNamesLanguage): string | null {
  return option.translations?.[language]?.label?.trim()
    || shippedLabelIn(list, option, language)
    || option.label
    || null;
}

/**
 * Names codes in one language. The catalog lists come from the workspace (`getCatalogLabels`);
 * without them, a catalog value has no name. The budget columns take the workspace's names
 * (`readBudgetColumns`); without them, the product's. A code no list knows has no name either: it
 * stays as stored, without an error.
 */
export class AiCodeNamer {
  constructor(
    readonly language: AiNamesLanguage,
    private readonly catalogs: Partial<ItOpsCatalogLabels> | null = null,
    private readonly budgetColumns: BudgetColumnsSettings | null = null,
  ) {}

  /** The name of one code, or null. */
  name(list: AiCodeList, code: unknown): string | null {
    if (typeof code !== 'string' || code === '') return null;
    if (list.kind === 'fixed') {
      const words = list.labels[this.language];
      const key = list.aliases?.[code] ?? code;
      return Object.hasOwn(words, key) ? words[key] : null;
    }
    if (list.kind === 'country') return countryNameIn(code, this.language);
    if (list.kind === 'language') {
      const language = aiScreenLanguage(code);
      return language ? LANGUAGE_NATIVE_NAMES[language] : null;
    }
    if (list.kind === 'budgetColumn') {
      const column = (list.aliases[code] ?? code) as BudgetColumn;
      if (!Object.hasOwn(BUDGET_COLUMN_LABELS.en, column)) return null;
      return this.budgetColumns
        ? localizedBudgetColumnName(this.budgetColumns, column, this.language)
        : BUDGET_COLUMN_LABELS[this.language][column];
    }
    if (list.kind === 'firstOf') {
      for (const each of list.lists) {
        const name = this.name(each, code);
        if (name !== null) return name;
      }
      return null;
    }
    const options = this.catalogs?.[list.list];
    if (!Array.isArray(options)) return null;
    const option = options.find((item) => item.code === code)
      ?? options.find((item) => item.code.toLowerCase() === code.toLowerCase());
    return option ? catalogValueName(list.list, option, this.language) : null;
  }

  /** The name of a field's value: each code of a multi-valued field, the unknown ones as they are. */
  fieldName(field: AiCodeField, value: unknown): string | null {
    if (!field.multi) return this.name(field.list, value);
    if (typeof value !== 'string' || value.trim() === '') return null;
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    const names = parts.map((part) => this.name(field.list, part));
    if (names.every((name) => name === null)) return null;
    return parts.map((part, index) => names[index] ?? part).join(', ');
  }
}

/**
 * The language codes are named in: the person's language when their profile sets one, else the
 * screen they ask from (the chat), else the workspace's language. The MCP server has no screen:
 * the person behind the key, else the workspace.
 */
export async function aiNamesLanguage(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  userId: string | null | undefined,
  screenLanguage?: string | null,
): Promise<AiNamesLanguage> {
  // A caller that is not a person of the workspace (a test or system id) has no profile to read.
  if (userId && isUuid(userId)) {
    const rows: Array<{ locale: string | null }> = await manager.query(
      'SELECT locale FROM users WHERE tenant_id = $1 AND id = $2',
      [tenantId, userId],
    );
    const own = aiScreenLanguage(rows[0]?.locale);
    if (own) return own;
  }
  const screen = aiScreenLanguage(screenLanguage);
  if (screen) return screen;
  const tenants: Array<{ metadata: unknown }> = await manager.query('SELECT metadata FROM tenants WHERE id = $1', [tenantId]);
  return tenantSeedLanguage(tenants[0]?.metadata);
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** `row` with `<key>_name` next to each named key it holds; an existing key is never replaced. */
function withNames(row: Json, fields: Readonly<Record<string, AiCodeField>>, namer: AiCodeNamer): Json {
  let output: Json | null = null;
  for (const [key, field] of Object.entries(fields)) {
    const nameKey = `${key}_name`;
    if (!Object.hasOwn(row, key) || Object.hasOwn(row, nameKey)) continue;
    const name = namer.fieldName(field, row[key]);
    if (name === null) continue;
    output ??= { ...row };
    output[nameKey] = name;
  }
  return output ?? row;
}

/** An item of a list or a search (`AiEntitySummaryDto`): its `status` and its `metadata`. */
function isSummary(value: Json): boolean {
  return typeof value.type === 'string' && 'label' in value && 'status' in value && 'metadata' in value;
}

function nameSummary(item: Json, namer: AiCodeNamer): Json {
  const fields = AI_NAMED_FIELDS[item.type as string];
  if (!fields) return item;
  const top = fields.status ? withNames(item, { status: fields.status }, namer) : item;
  if (!isObject(top.metadata)) return top;
  const metadata = withNames(top.metadata, fields, namer);
  return metadata === top.metadata ? top : { ...top, metadata };
}

/** Every summary the value holds, named (the items of a list, a search, a context, a detail's `entity`). */
function nameSummaries(value: unknown, namer: AiCodeNamer): unknown {
  if (Array.isArray(value)) return value.map((entry) => nameSummaries(entry, namer));
  if (!isObject(value)) return value;
  if (isSummary(value)) return nameSummary(value, namer);
  let output: Json | null = null;
  for (const [key, entry] of Object.entries(value)) {
    const next = nameSummaries(entry, namer);
    if (next === entry) continue;
    output ??= { ...value };
    output[key] = next;
  }
  return output ?? value;
}

function nameRows(rows: unknown, fields: Readonly<Record<string, AiCodeField>>, namer: AiCodeNamer): unknown {
  if (Array.isArray(rows)) return rows.map((row) => (isObject(row) ? withNames(row, fields, namer) : row));
  if (isObject(rows) && Array.isArray(rows.items)) return { ...rows, items: nameRows(rows.items, fields, namer) };
  return rows;
}

/** A detail's `data`: its own fields and those of its child rows. */
function nameDetailData(family: string, data: Json, namer: AiCodeNamer): Json {
  let output = withNames(data, AI_NAMED_FIELDS[family] ?? {}, namer);
  for (const [key, fields] of Object.entries(AI_NAMED_CHILD_FIELDS[family] ?? {})) {
    if (!Object.hasOwn(output, key)) continue;
    const rows = nameRows(output[key], fields, namer);
    if (rows !== output[key]) output = { ...output, [key]: rows };
  }
  return output;
}

function usesBudgetColumns(list: AiCodeList): boolean {
  return list.kind === 'budgetColumn' || (list.kind === 'firstOf' && list.lists.some(usesBudgetColumns));
}

/** Whether naming a family's codes needs the workspace's budget column names (`readBudgetColumns`). */
export function aiFamilyNamesBudgetColumns(family: unknown): boolean {
  if (typeof family !== 'string') return false;
  return Object.values(AI_NAMED_FIELDS[family] ?? {}).some((field) => usesBudgetColumns(field.list));
}

/** The read tools whose results carry codes, and the MCP server's same tools. */
export const AI_CODE_NAMED_TOOLS = [
  'search_all',
  'query_entities',
  'get_entity_detail',
  'get_entity_context',
  'aggregate_entities',
  'get_filter_values',
] as const;
export type AiCodeNamedTool = (typeof AI_CODE_NAMED_TOOLS)[number];

/**
 * A read tool's result with the name of each code it holds: `<field>_name` next to a field of an
 * item or of a detail (and of its child rows), `key_name` and `then_key_name` next to a group of an
 * aggregate, and `names` (field, then code, then name) next to the filter values. Nothing is
 * renamed or removed.
 */
export function withCodeNames(tool: AiCodeNamedTool, input: unknown, output: unknown, namer: AiCodeNamer): unknown {
  if (!isObject(output)) return output;
  const args = isObject(input) ? input : {};
  const family = typeof args.entity_type === 'string' ? args.entity_type : '';
  if (tool === 'aggregate_entities') return nameAggregate(family, args, output, namer);
  if (tool === 'get_filter_values') return nameFilterValues(family, output, namer);
  const named = nameSummaries(output, namer) as Json;
  if (tool !== 'get_entity_detail' || !isObject(named.data)) return named;
  const detailFamily = isObject(named.entity) && typeof named.entity.type === 'string' ? named.entity.type : family;
  const data = nameDetailData(detailFamily, named.data, namer);
  return data === named.data ? named : { ...named, data };
}

function nameAggregate(family: string, args: Json, output: Json, namer: AiCodeNamer): Json {
  if (!Array.isArray(output.groups)) return output;
  const fields = AI_NAMED_FIELDS[family] ?? {};
  const byField = typeof args.group_by === 'string' ? fields[args.group_by] : undefined;
  const thenField = typeof args.then_by === 'string' ? fields[args.then_by] : undefined;
  if (!byField && !thenField) return output;
  const groups = output.groups.map((group) => {
    if (!isObject(group)) return group;
    const key = byField ? namer.fieldName(byField, group.key) : null;
    const thenKey = thenField ? namer.fieldName(thenField, group.then_key) : null;
    if (key === null && thenKey === null) return group;
    return { ...group, ...(key !== null ? { key_name: key } : {}), ...(thenKey !== null ? { then_key_name: thenKey } : {}) };
  });
  return { ...output, groups };
}

function nameFilterValues(family: string, output: Json, namer: AiCodeNamer): Json {
  if (!isObject(output.values) || Object.hasOwn(output, 'names')) return output;
  const fields = AI_NAMED_FIELDS[family] ?? {};
  const names: Record<string, Record<string, string>> = {};
  for (const [key, values] of Object.entries(output.values)) {
    const field = fields[key];
    if (!field || !Array.isArray(values)) continue;
    for (const value of values) {
      const name = namer.fieldName(field, value);
      if (name !== null) (names[key] ??= {})[String(value)] = name;
    }
  }
  return Object.keys(names).length ? { ...output, names } : output;
}
