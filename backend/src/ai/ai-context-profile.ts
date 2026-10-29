import type { AiQueryEntityType, AiToolListItemDto, AiToolName } from './ai.types';
import type { AiProviderToolDef } from './providers/ai-provider.types';
import { wordsInOrder } from '../common/text-scan';

export type AiContextProfileName =
  | 'minimal'
  | 'read_query'
  | 'knowledge'
  | 'entity_inspection'
  | 'write_task'
  | 'write_document'
  | 'write_business'
  | 'write_master_data'
  | 'write_financial'
  | 'write_relation'
  | 'write_general'
  | 'web';

export type AiContextPromptMode = 'minimal' | 'read' | 'knowledge' | 'entity' | 'write' | 'web';

export type AiContextProfile = {
  name: AiContextProfileName;
  promptMode: AiContextPromptMode;
  reason: string;
  toolNames: AiToolName[];
  includeDomainVocabulary: boolean;
  includeReadableEntityTypes: boolean;
  includeToolGuidelines: boolean;
  includeWriteGuidelines: boolean;
  includeWritableFields: boolean;
  includeWebGuidelines: boolean;
};

export type AiContextProfileTurnMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
};

type ClassifiedContextProfile = {
  profile: AiContextProfile;
  explicitIntent: boolean;
};

const COMMON_READ_TOOLS: AiToolName[] = [
  'search_all',
  'describe_entity_filters',
  'query_entities',
  'aggregate_entities',
  'get_filter_values',
  'get_entity_detail',
  // The related records of one record (what runs on a server, which applications use a
  // technology), for a question that names it without a reference.
  'get_entity_context',
  // Who changed a record and when ("Qui a modifié AST-3 ?"), from its History tab.
  'get_record_history',
];

const ENTITY_INSPECTION_TOOLS: AiToolName[] = [
  'search_all',
  'describe_entity_filters',
  'query_entities',
  'get_filter_values',
  'get_entity_detail',
  'get_entity_context',
  'get_entity_comments',
  'get_record_history',
  'search_knowledge',
  'get_document',
];

const KNOWLEDGE_TOOLS: AiToolName[] = [
  'search_knowledge',
  'get_document',
  'describe_entity_filters',
  'query_entities',
  'get_entity_detail',
];

const TASK_WRITE_TOOLS: AiToolName[] = [
  'search_all',
  'describe_entity_filters',
  'query_entities',
  'get_filter_values',
  'get_entity_detail',
  'get_entity_context',
  'get_entity_comments',
  'prepare_mutation_plan',
  'import_ticket',
  'create_task',
  'update_task_fields',
  'update_task_status',
  'update_task_assignees',
  'update_task_assignee',
  'add_task_comment',
  'delete_record',
  'undo_preview',
];

const DOCUMENT_WRITE_TOOLS: AiToolName[] = [
  'search_knowledge',
  'get_document',
  'search_all',
  'query_entities',
  'get_entity_detail',
  'get_entity_context',
  'get_entity_comments',
  'prepare_mutation_plan',
  'create_document',
  'update_document_content',
  'update_document_metadata',
  'update_document_relations',
  'delete_record',
  'undo_preview',
];

const BUSINESS_WRITE_TOOLS: AiToolName[] = [
  'search_all',
  'describe_entity_filters',
  'query_entities',
  'get_filter_values',
  'get_entity_detail',
  'get_entity_context',
  'prepare_mutation_plan',
  'create_business_record',
  'update_business_record',
  'add_incident_note',
  'update_incident_links',
  'update_technology_links',
  'update_technology_versions',
  'update_technology_people',
  'update_technology_web_links',
  'set_technology_vulnerability_alerts',
  'change_vulnerability_state',
  'change_incident_state',
  'set_incident_confidentiality',
  'update_entity_relations',
  'delete_record',
  'undo_preview',
];

const MASTER_DATA_WRITE_TOOLS: AiToolName[] = [
  'search_all',
  'describe_entity_filters',
  'query_entities',
  'get_filter_values',
  'get_entity_detail',
  'prepare_mutation_plan',
  'create_master_data_record',
  'update_master_data_record',
  'update_entity_relations',
  'delete_record',
  'undo_preview',
];

const FINANCIAL_WRITE_TOOLS: AiToolName[] = [
  'search_all',
  'describe_entity_filters',
  'query_entities',
  'aggregate_entities',
  'get_filter_values',
  'get_entity_detail',
  'prepare_mutation_plan',
  'write_financial_plan',
  'delete_record',
  'undo_preview',
];

const RELATION_WRITE_TOOLS: AiToolName[] = [
  'search_all',
  'query_entities',
  'describe_entity_filters',
  'get_filter_values',
  'get_entity_detail',
  'get_entity_context',
  'prepare_mutation_plan',
  'update_entity_relations',
  'update_document_relations',
  'update_incident_links',
  'update_technology_links',
  'update_technology_web_links',
  'undo_preview',
];

function uniqueToolNames(groups: AiToolName[][]): AiToolName[] {
  const seen = new Set<AiToolName>();
  const result: AiToolName[] = [];
  for (const group of groups) {
    for (const name of group) {
      if (seen.has(name)) continue;
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

const GENERAL_WRITE_TOOLS = uniqueToolNames([
  COMMON_READ_TOOLS,
  ENTITY_INSPECTION_TOOLS,
  TASK_WRITE_TOOLS,
  DOCUMENT_WRITE_TOOLS,
  BUSINESS_WRITE_TOOLS,
  MASTER_DATA_WRITE_TOOLS,
  FINANCIAL_WRITE_TOOLS,
  RELATION_WRITE_TOOLS,
]);

function buildProfile(
  name: AiContextProfileName,
  promptMode: AiContextPromptMode,
  reason: string,
  toolNames: AiToolName[],
  overrides: Partial<Omit<AiContextProfile, 'name' | 'promptMode' | 'reason' | 'toolNames'>> = {},
): AiContextProfile {
  return {
    name,
    promptMode,
    reason,
    toolNames,
    includeDomainVocabulary: promptMode !== 'minimal' && promptMode !== 'web',
    includeReadableEntityTypes: promptMode !== 'minimal' && promptMode !== 'web',
    includeToolGuidelines: promptMode !== 'minimal',
    includeWriteGuidelines: promptMode === 'write',
    includeWritableFields: promptMode === 'write',
    includeWebGuidelines: promptMode === 'web',
    ...overrides,
  };
}

const PROFILES: Record<AiContextProfileName, AiContextProfile> = {
  minimal: buildProfile('minimal', 'minimal', 'low-context direct answer', [], {
    includeDomainVocabulary: false,
    includeReadableEntityTypes: false,
    includeToolGuidelines: false,
    includeWriteGuidelines: false,
    includeWritableFields: false,
    includeWebGuidelines: false,
  }),
  read_query: buildProfile('read_query', 'read', 'structured read/query request', COMMON_READ_TOOLS),
  knowledge: buildProfile('knowledge', 'knowledge', 'knowledge/document retrieval request', KNOWLEDGE_TOOLS),
  entity_inspection: buildProfile('entity_inspection', 'entity', 'specific entity inspection request', ENTITY_INSPECTION_TOOLS),
  write_task: buildProfile('write_task', 'write', 'task write-preview request', TASK_WRITE_TOOLS),
  write_document: buildProfile('write_document', 'write', 'document write-preview request', DOCUMENT_WRITE_TOOLS),
  write_business: buildProfile('write_business', 'write', 'business object write-preview request', BUSINESS_WRITE_TOOLS),
  write_master_data: buildProfile('write_master_data', 'write', 'master-data write-preview request', MASTER_DATA_WRITE_TOOLS),
  write_financial: buildProfile('write_financial', 'write', 'financial write-preview request', FINANCIAL_WRITE_TOOLS),
  write_relation: buildProfile('write_relation', 'write', 'relationship write-preview request', RELATION_WRITE_TOOLS),
  write_general: buildProfile('write_general', 'write', 'generic write-preview request', GENERAL_WRITE_TOOLS),
  web: buildProfile('web', 'web', 'web/current-information request', ['web_search'], {
    includeDomainVocabulary: false,
    includeReadableEntityTypes: false,
  }),
};

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function containsAny(text: string, patterns: Array<{ test(text: string): boolean }>): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

const CANONICAL_REF_ENTITY_TYPES: Array<{ pattern: RegExp; entityType: AiQueryEntityType }> = [
  { pattern: /\bAPP-\d+\b/i, entityType: 'applications' },
  { pattern: /\bAST-\d+\b/i, entityType: 'assets' },
  { pattern: /\bPRJ-\d+\b/i, entityType: 'projects' },
  { pattern: /\bREQ-\d+\b/i, entityType: 'requests' },
  { pattern: /\bT-\d+\b/i, entityType: 'tasks' },
  { pattern: /\bDOC-\d+\b/i, entityType: 'documents' },
  { pattern: /\bINC-\d+\b/i, entityType: 'incidents' },
  // The budget line references the screens show. `BL-n` alone is ambiguous ("bon de livraison"),
  // so it is read as a budget line only with a budget word in the phrase (see below).
  { pattern: /\b(?:OPEX|OPX|CPX)-\d+\b/i, entityType: 'budget_lines' },
  { pattern: /\bTEC-\d+\b/i, entityType: 'technologies' },
  // A CVE id names the vulnerability rows of that CVE.
  { pattern: /\bCVE-\d{4}-\d{4,}\b/i, entityType: 'vulnerabilities' },
];

const URL_ENTITY_TYPES: Array<{ pattern: RegExp; entityType: AiQueryEntityType }> = [
  { pattern: /\/knowledge\//i, entityType: 'documents' },
  { pattern: /\/portfolio\/tasks\//i, entityType: 'tasks' },
  { pattern: /\/portfolio\/projects\//i, entityType: 'projects' },
  { pattern: /\/portfolio\/requests\//i, entityType: 'requests' },
  { pattern: /\/it\/applications\//i, entityType: 'applications' },
  { pattern: /\/it\/assets\//i, entityType: 'assets' },
  { pattern: /\/it\/incidents\//i, entityType: 'incidents' },
  { pattern: /\/it\/connections\//i, entityType: 'connections' },
  { pattern: /\/it\/interfaces\//i, entityType: 'interfaces' },
  { pattern: /\/it\/locations\//i, entityType: 'locations' },
  { pattern: /\/it\/technologies\//i, entityType: 'technologies' },
  { pattern: /\/it\/vulnerabilities\b/i, entityType: 'vulnerabilities' },
  { pattern: /\/ops\/contracts\//i, entityType: 'contracts' },
  // The neutral path and the two legacy paths: one family, both natures.
  { pattern: /\/ops\/(?:budget|opex|capex)\/[^/?#]+/i, entityType: 'budget_lines' },
  { pattern: /\/master-data\/companies\//i, entityType: 'companies' },
  { pattern: /\/master-data\/contacts\//i, entityType: 'contacts' },
  { pattern: /\/master-data\/departments\//i, entityType: 'departments' },
  { pattern: /\/master-data\/suppliers\//i, entityType: 'suppliers' },
  { pattern: /\/master-data\/business-processes\//i, entityType: 'business_processes' },
];

const TASK_ENTITY_TYPES = new Set<AiQueryEntityType>(['tasks']);
const DOCUMENT_ENTITY_TYPES = new Set<AiQueryEntityType>(['documents']);
const BUSINESS_ENTITY_TYPES = new Set<AiQueryEntityType>([
  'applications',
  'assets',
  'incidents',
  'connections',
  'contracts',
  'interfaces',
  'technologies',
  'locations',
  'projects',
  'requests',
  'vulnerabilities',
]);
const MASTER_DATA_ENTITY_TYPES = new Set<AiQueryEntityType>([
  'accounts',
  'analytics_categories',
  'business_processes',
  'chart_of_accounts',
  'companies',
  'contacts',
  'departments',
  'suppliers',
  'users',
]);
const FINANCIAL_ENTITY_TYPES = new Set<AiQueryEntityType>(['budget_lines']);

/** The words that disambiguate a `BL-n` from a delivery note ("bon de livraison"). */
const BUDGET_WORD_RE = /\b(?:budget|budgets|ligne|lignes|line|lines|opex|capex)\b/i;

function extractReferencedEntityTypes(rawText: string): Set<AiQueryEntityType> {
  const referenced = new Set<AiQueryEntityType>();
  for (const entry of CANONICAL_REF_ENTITY_TYPES) {
    if (entry.pattern.test(rawText)) {
      referenced.add(entry.entityType);
    }
  }
  // A legacy BL reference names a budget line only when the phrase talks about the budget too.
  if (/\bBL-\d+\b/i.test(rawText) && BUDGET_WORD_RE.test(rawText)) {
    referenced.add('budget_lines');
  }
  for (const entry of URL_ENTITY_TYPES) {
    if (entry.pattern.test(rawText)) {
      referenced.add(entry.entityType);
    }
  }
  return referenced;
}

function hasReferenceInGroup(referencedTypes: Set<AiQueryEntityType>, group: Set<AiQueryEntityType>): boolean {
  for (const entityType of referencedTypes) {
    if (group.has(entityType)) return true;
  }
  return false;
}

function hasEntityReference(text: string): boolean {
  return /\b[A-Z]{1,6}-\d+\b/.test(text) || /\/(?:portfolio|it|ops|knowledge|master-data)\//i.test(text);
}

function withWebCapability(profile: AiContextProfile, needsWeb: boolean): AiContextProfile {
  if (!needsWeb || profile.toolNames.includes('web_search')) {
    return profile;
  }
  return {
    ...profile,
    reason: `${profile.reason}; current/web lookup requested`,
    toolNames: [...profile.toolNames, 'web_search'],
    includeWebGuidelines: true,
  };
}

const SOCIAL_MESSAGE_RE = /^(hi|hello|hey|bonjour|bonsoir|salut|merci|thanks|thank you|ca va|ça va|help|aide)[\s!.?]*$/i;

function isSocialMessage(text: string): boolean {
  return SOCIAL_MESSAGE_RE.test(text.trim());
}

function isMinimalDirectRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80 || hasEntityReference(trimmed)) return false;
  return isSocialMessage(trimmed) || /^(ok|okay|oui|non)[\s!.?]*$/i.test(trimmed);
}

function isReadOnlyChangeInquiry(rawText: string, text: string): boolean {
  const asksAboutPastChange = containsAny(text, [
    /\b(?:ce qui|qu[' -]?est[- ]?ce qui|quoi|what|which)\b[\s\S]{0,100}\b(?:a ete|ont ete|was|were)?\s*(?:modifie(?:e|es|s)?|change(?:e|es|s|d)?|updated)\b/,
    /\b(?:a ete|ont ete|was|were)\s+(?:modifie(?:e|es|s)?|change(?:e|es|s|d)?|updated)\b/,
    /\b(?:dernier|derniere|last|recent|recemment|recently)\b[\s\S]{0,80}\b(?:modifie(?:e|es|s)?|change(?:e|es|s|d)?|updated|mis a jour|mise a jour)\b/,
    /\b(?:modification|modifications|changement|changements|changes?)\b[\s\S]{0,80}\b(?:faite|faites|effectue|effectuees|apporte|apportees|recent|recemment|history|historique)\b/,
  ]);
  if (!asksAboutPastChange) {
    return false;
  }

  return rawText.includes('?') || containsAny(text, [
    /\b(?:quel|quelle|quels|quelles|quoi|what|which|comment|how|capable|peux|peut|can|could|dernier|derniere|last)\b/,
  ]);
}

function isAdvisoryFeatureImprovementQuestion(rawText: string, text: string): boolean {
  const asksForRecommendation = rawText.includes('?') || containsAny(text, [
    /\b(?:quel|quelle|quels|quelles|what|which|idee|idees|idea|recommend|recommande|suggest|suggere|serait|would be|devrait|should)\b/,
  ]);
  if (!asksForRecommendation) {
    return false;
  }

  return containsAny(text, [
    /\b(?:fonctionnalite|feature|capability|capacite)\b[\s\S]{0,140}\b(?:a ajouter|a ameliorer|a faire evoluer|ameliorer|evoluer|improve|to add|better|meilleur)\b/,
    /\b(?:a ajouter|a ameliorer|a faire evoluer|ameliorer|evoluer|improve|to add)\b[\s\S]{0,140}\b(?:fonctionnalite|feature|capability|capacite)\b/,
  ]);
}

/** A question asks for a fact: a status word in it stays a read ("INC-3 est-il clos ?"). */
function isQuestion(rawText: string, text: string): boolean {
  return rawText.includes('?') || containsAny(text, [
    /\b(?:qui|quand|when|who|est-il|est-elle|is it)\b/,
  ]);
}

/** "Ouvre / déclare / signale un incident", "open / report / log an incident": a creation. */
function createsIncident(text: string, rawText: string): boolean {
  const named = containsAny(text, [
    /\b(?:ouvre|ouvrir|declare|declarer|signale|signaler)\b[\s\S]{0,40}\bincident\b/,
    /\b(?:open|report|log)\s+(?:a|an|the)?\s*incident\b/,
  ]);
  if (!named) return false;
  // "Ouvre un incident" creates one. "Ouvre la fiche de l'incident INC-3" reads an existing
  // record: with an INC reference, only the indefinite article makes it a creation.
  return /\b(?:un|une|a|an)\s+incident\b/.test(text) || !/\bINC-\d+\b/i.test(rawText);
}

/** "Crée l'incident puis lie-le à..." starts an incident: the creation wins over the link branch. */
function createsIncidentRecord(text: string): boolean {
  return containsAny(text, [
    /\b(?:cree|creer|create|ouvre|ouvrir|open|declare|declarer|signale|signaler|report|log)\b(?:\s+\S+){0,3}\s+(?:un|une|an|a|the|l['’]|le|la)?\s*incident\b/,
  ]);
}

/** The words that name an incident state, a status or its confidentiality. */
const INCIDENT_STATE_WORD_RE = /\b(clos|closed|ferme|fermee|fermer|resolu|resolue|resolved|resous|resoudre|resolve|rouvert|reopened|rouvre|rouvrir|reopen|annule|annulee|annuler|cancel|cancelled|canceled|leve|levee|lever|lift|lifted|confidentialite|confidentiality|confidentiel|confidentielle|confidentiels|confidentielles|confidential|public|publique|publics|publiques|en cours|in progress|en attente|attente|waiting|pending|en analyse|analyse|analysis)\b/;

/** The verbs of an incident lifecycle change, in the imperative or after "je veux" / "please". */
const INCIDENT_LIFECYCLE_VERBS = 'clos|close|ferme|fermer|rouvre|rouvrir|reopen|annule|annuler|cancel|resous|resoudre|resolve|passe|passer|mets|mettre|marque|marquer|mark|set|move|change|leve|lever|lift|rends|rendre|make';

/** A salutation or a polite/wish turn before the verb does not break the imperative. */
const DIRECTIVE_PREFIX_RE = /^(?:(?:bonjour|bonsoir|salut|hello|hi|hey)[\s,!.]+)*(?:(?:je veux|je voudrais|il faut|tu peux|vous pouvez|peux[- ]tu|pouvez[- ]vous|i want to|i would like to|can you|could you|would you|please|merci de|merci|stp|svp)[\s,]+)*/;

function directiveHeadVerb(text: string): string | null {
  const head = text.replace(DIRECTIVE_PREFIX_RE, '');
  return head.match(new RegExp(`^(${INCIDENT_LIFECYCLE_VERBS})\\b`))?.[1] ?? null;
}

/** These verbs only change the state they name: "Passe INC-3 en résolu", "Rends INC-3 public". */
const INCIDENT_LIFECYCLE_VERBS_WITH_STATE = new Set([
  'passe', 'passer', 'mets', 'mettre', 'marque', 'marquer', 'mark',
  'rends', 'rendre', 'make', 'set', 'move', 'change',
]);

/** The state verbs that also cancel or close a task: "Annule T-4", "Close T-4". */
const TASK_STATUS_VERBS = new Set([
  'clos', 'close', 'ferme', 'fermer', 'rouvre', 'rouvrir', 'reopen',
  'passe', 'passer', 'mets', 'mettre', 'marque', 'marquer', 'mark',
  'annule', 'annuler', 'cancel', 'set', 'move',
]);

/** A stated change without an imperative: "INC-3 ne doit plus être confidentiel". */
const INCIDENT_STATE_DIRECTIVE_RE = /\b(?:ne )?(?:doit|devrait|should|must) (?:plus |moins )?(?:etre|be) (?:plus |moins )?(?:confidentiel|confidentielle|confidentiels|confidentielles|confidential|public|publique|publics|publiques|closed|clos|resolu|resolue|resolved|ferme|fermee|rouvert|reopened|annule|annulee|cancelled|canceled)\b/;

/** An explanation never changes the state: "Explique pourquoi INC-3 doit être confidentiel". */
const INCIDENT_READ_EXPLANATION_RE = /\b(?:explique|expliquer|pourquoi|why|explain)\b/;

/** The reflexive past is not the verb "passer": "Que s'est-il passé sur T-4 ?". */
const REFLEXIVE_PAST_RE = /qu['’]est[- ]ce qui s['’]est passe|s['’]est[- ](?:il|elle|on) passe|s['’]est passe|se passe/g;

function stripReflexivePast(text: string): string {
  return text.replace(REFLEXIVE_PAST_RE, ' ');
}

/**
 * "Installer", "déclarer" and "install", "declare" name a technology write only in the
 * imperative: "Installe nginx sur AST-12" writes, "nginx est installé sur AST-12 ?" reads. The
 * test runs on the raw text, before the accents go, so "installé" and "déclaré" never pass for
 * the imperative; a question never writes, whatever its verb ("Comment installer nginx ?").
 */
const TECHNOLOGY_WRITE_VERBS = new Set([
  'installe', 'installez', 'installer', 'install',
  'déclare', 'déclarez', 'déclarer', 'declare',
  'désinstalle', 'désinstallez', 'désinstaller', 'desinstalle', 'uninstall',
  'retire', 'retirez', 'retirer', 'remove',
  'enlève', 'enlevez', 'enlever',
  'détache', 'détachez', 'détacher', 'detach',
  'remplace', 'remplacez', 'remplacer', 'replace',
  'lie', 'liez', 'lier', 'link', 'unlink',
  'associe', 'associez', 'associer', 'attach',
  'rattache', 'rattachez', 'rattacher',
  'ajoute', 'ajoutez', 'ajouter', 'add',
  'mets', 'mettez', 'mettre',
  'enregistre', 'enregistrez', 'enregistrer', 'record',
  'change', 'changez', 'changer',
  'renomme', 'renommez', 'renommer', 'rename',
  'upgrade', 'passe', 'passez', 'passer',
  'marque', 'marquez', 'marquer', 'mark', 'set',
  'adopte', 'adoptez', 'adopter', 'adopt',
  'efface', 'effacez', 'effacer', 'erase', 'clear',
  'désactive', 'désactivez', 'désactiver', 'desactive', 'disable',
  'active', 'activez', 'activer', 'enable',
  'exclus', 'excluez', 'exclure', 'exclude',
  'indique', 'indiquez', 'indiquer', 'indicate',
  'turn',
  // Lot 5 review: the alert sentences the table adds.
  'réactive', 'réactivez', 'réactiver', 'reactive', 'reactivate',
  'stop',
  'remets', 'remettez', 'remettre',
]);

/** The head word of the request, after a salutation or a polite turn, raw and lower-case. */
function directiveFirstWord(rawText: string): string | null {
  const head = rawText.trim().replace(
    /^(?:(?:bonjour|bonsoir|salut|hello|hi|hey)[\s,!.]+)*(?:(?:je veux|je voudrais|il faut|tu peux|vous pouvez|peux[- ]tu|pouvez[- ]vous|i want to|i would like to|can you|could you|would you|please|merci de|merci|stp|svp)[\s,]+)*/i,
    '',
  );
  return head.match(/^([\p{L}'’-]+)/u)?.[1]?.toLowerCase() ?? null;
}

/** A question asks for a fact, whatever verb it quotes: "Comment installer nginx ?" reads. */
function isTechnologyQuestion(rawText: string): boolean {
  const raw = rawText.toLowerCase();
  return raw.includes('?') || /\b(?:comment|how|où|where|quel|quelle|quels|quelles|which|quand|when|qui|who)\b/.test(raw);
}

/**
 * The state verbs that only write a technology with a write complement: "Désactive les alertes de
 * failles de TEC-3" writes, "Active applications using PostgreSQL" reads. The complement is an
 * alert setting, a version number, a TEC reference or a named exception, as for `upgrade`.
 */
const TECHNOLOGY_STATE_WRITE_VERBS = new Set([
  'active', 'activez', 'activer', 'enable',
  'efface', 'effacez', 'effacer', 'erase', 'clear',
  'exclus', 'excluez', 'exclure', 'exclude',
  'désactive', 'désactivez', 'désactiver', 'desactive', 'disable',
  'réactive', 'réactivez', 'réactiver', 'reactive', 'reactivate',
]);

function hasTechnologyStateWriteComplement(rawText: string, text: string): boolean {
  return /\b(?:alertes?(?: de failles?)?|vulnerability alerts?)\b/.test(text)
    || /\bversions?\s+\S*\d/.test(text)
    || /\bTEC-\d+\b/i.test(rawText)
    || /\b(?:service packs?|exceptions? de version)\b/.test(text);
}

/**
 * A state verb that clears a field of a task: "Efface la description de la tâche T-4", "Clear the
 * due date of task T-12". A bare state verb stays a report ("Clear summary of PostgreSQL versions
 * in use").
 */
function hasTaskFieldStateWrite(rawText: string, text: string): boolean {
  if (isTechnologyQuestion(rawText)) return false;
  const first = directiveFirstWord(rawText);
  if (first == null || !['efface', 'effacez', 'effacer', 'erase', 'clear'].includes(first)) return false;
  const namesTask = /\b(?:task|tasks|tache|taches|t-\d+)\b/.test(text);
  const namesField = /\b(?:description|due date|echeance|date d echeance|assigne|assignee|priority|priorite|status|statut|comment|commentaire|notes?)\b/.test(text);
  return namesTask && namesField;
}

/**
 * A user administration write: "Désactive l'utilisateur Paul Martin", "Active le compte de Julie
 * Bernard". The screen changes the account status; the assistant has no user tool, so the write
 * profile carries the refusal instead of a read query.
 */
function hasUserAdministrationWrite(rawText: string, text: string): boolean {
  if (isTechnologyQuestion(rawText)) return false;
  const first = directiveFirstWord(rawText);
  if (first == null || !['active', 'activez', 'activer', 'enable', 'désactive', 'désactivez', 'désactiver', 'desactive', 'disable'].includes(first)) return false;
  if (/\b(?:utilisateur|utilisateurs|user|users)\b/.test(text)) return true;
  return /\bcompte\b[\s\S]{0,30}\b(?:de|d['’]|of)\b[\s\S]{0,40}[A-Z]/.test(rawText);
}

/** An imperative technology verb at the head: "Désinstalle nginx de AST-13", "Remove Java 8 from APP-3". */
function hasTechnologyWriteIntent(rawText: string, text: string): boolean {
  if (isTechnologyQuestion(rawText)) return false;
  const first = directiveFirstWord(rawText);
  if (first == null) return false;
  const lower = rawText.toLowerCase();
  // "Marque" is a noun in "Marque et modèle des serveurs…": it writes only with a technology
  // reference and a state word. "Indique" writes only a replacement.
  if (['marque', 'marquez', 'marquer', 'mark'].includes(first)) {
    return /\bTEC-\d+\b/i.test(rawText)
      && /\b(?:obsolete|obsolescent|obsolète|deprecated|retire|retired|retiree|remplacee?|remplaces?|replaced|fin de vie)\b/.test(lower);
  }
  if (['indique', 'indiquez', 'indiquer', 'indicate'].includes(first)) {
    return /\b(?:est|sont|is|are)\s+(?:remplacee?|remplaces?|replaced)\b[\s\S]{0,25}\b(?:par|by)\b/.test(lower);
  }
  if (first === 'turn') {
    return /\b(?:alertes? de failles?|vulnerability alerts?)\b/.test(lower);
  }
  // "Stop vulnerability alerts on Windows Server 2012" writes; "Stop the migration" does not.
  if (first === 'stop') {
    return /\b(?:alertes? de failles?|vulnerability alerts?)\b/.test(lower);
  }
  // A bare state verb here is a report or a screen word ("Active technologies with no IT owner",
  // "Clear summary of PostgreSQL versions in use"): it needs an alert, a version or a TEC.
  if (TECHNOLOGY_STATE_WRITE_VERBS.has(first)) {
    return hasTechnologyStateWriteComplement(rawText, text);
  }
  // A bare verb here is a noun or a report ("Upgrade path", "Replace candidates", "Install base",
  // "Record the end of support dates…"): it writes only with a version, "from … to", "with" or "on".
  if (['upgrade', 'replace', 'record', 'install'].includes(first)) {
    const rest = lower.slice(lower.indexOf(first) + first.length).trim();
    if (/^(?:path|options|candidates|base|count)\b/.test(rest)) return false;
    return /\b(?:from\b[\s\S]{0,80}\bto\b|with\b|on\b|sur\b|vers\b|version\b|\d)/.test(rest);
  }
  return TECHNOLOGY_WRITE_VERBS.has(first);
}

/**
 * A technology people write: "Make Paul Martin the IT owner of PostgreSQL", "Paul Martin devient
 * responsable IT de TEC-3", "Retire le contact Sage Support de PostgreSQL", "Ajoute Jean Dupont aux
 * contacts de support de Redis". The verb (or the stated change) and the owner/contact phrase are
 * both required, so a list of owners stays a read.
 */
function hasTechnologyPeopleWrite(rawText: string, text: string): boolean {
  if (isTechnologyQuestion(rawText)) return false;
  const first = directiveFirstWord(rawText);
  // "Make" writes people only in the form "Make <name> the IT owner of …" or "… the support
  // contact of …". A determiner or a pronoun after it opens a report: "Make a list of…",
  // "Make me a summary…".
  if (first === 'make') {
    const rest = text.slice(text.indexOf('make') + 4).trim();
    return /^(?!a\b|an\b|the\b|me\b|us\b)\S[\s\S]*?\bthe\s+(?:(?:it|business)\s+owner|support contacts?)\s+of\b/.test(rest);
  }
  const changeVerb = first != null && [
    'ajoute', 'ajoutez', 'ajouter', 'add',
    'retire', 'retirez', 'retirer', 'remove',
    'enlève', 'enlevez', 'enlever',
    'mets', 'mettez', 'mettre',
    'remplace', 'remplacez', 'remplacer', 'replace',
    'change', 'changez', 'changer',
    'assigne', 'assignez', 'assigner', 'assign',
    'affecte', 'affectez', 'affecter',
  ].includes(first);
  const statement = /\b(?:devient|deviennent|becomes?)\b/.test(text);
  if (!changeVerb && !statement) return false;
  const ownerPhrase = /\b(?:it owner|business owner|owners? of|responsable (?:it|metier)|responsables? (?:it|metier))\b/.test(text);
  const supportPhrase = /\b(?:support contacts?|contacts? de support|contacts? au support)\b/.test(text);
  // The contact of a technology names the support ("Sage Support", "contacts de support") or a
  // technology (a TEC reference, or a name followed by a version). "Retire le contact Marie
  // Durand de ACME" is the master data contact write, not a technology support contact.
  const namesSupport = /\bsupport\b/.test(text);
  const namesTechnology = /\bTEC-\d+\b/i.test(rawText)
    || /\b[A-Za-z][\w.-]*\s+v?\d+(?:\.\d+)*\b/.test(rawText);
  const contactPhrase = /\bcontact\b[\s\S]{0,60}\b(?:de|du|des|of|from)\b[\s\S]{0,40}[A-Z]/.test(rawText);
  return ownerPhrase || supportPhrase || (contactPhrase && (namesSupport || namesTechnology));
}

/**
 * A web link of a technology: "Ajoute un lien vers la documentation https://nginx.org/en/docs/ sur
 * nginx", "Add the release notes link https://… to PostgreSQL". The word link, an address and a
 * write verb; the URL's `docs` path must not send the phrase to the document write.
 */
function hasTechnologyWebLinkWrite(rawText: string, text: string): boolean {
  if (isTechnologyQuestion(rawText)) return false;
  if (!/\b(?:lien|links?)\b/.test(text) || !/\bhttps?:\/\/|\bwww\./.test(text)) return false;
  const first = directiveFirstWord(rawText);
  return first != null && [
    'ajoute', 'ajoutez', 'ajouter', 'add',
    'supprime', 'supprimez', 'supprimer', 'delete', 'remove',
    'retire', 'retirez', 'retirer',
    'change', 'changez', 'changer', 'update', 'mets', 'mettez', 'mettre',
    'modifie', 'modifiez', 'modifier',
  ].includes(first);
}

/**
 * A stated change: "CheeseTrack utilise maintenant Java 21", "CheeseTrack now uses Java 21",
 * "La version 16 de PostgreSQL finit son support le 31/12/2028", "TEC-3 est remplacée par TEC-7".
 * A question stays a read.
 */
function hasTechnologyChangeStatement(rawText: string, text: string): boolean {
  if (isTechnologyQuestion(rawText)) return false;
  return containsAny(text, [
    /\b(?:utilise|uses|runs|tourne)\b[\s\S]{0,40}\b(?:maintenant|now)\b/,
    /\b(?:maintenant|now)\b[\s\S]{0,40}\b(?:utilise|uses|runs|tourne)\b/,
    /\b(?:finit|finira|termine|terminera|ends?|end)\b[\s\S]{0,50}\b(?:support|soutien)\b[\s\S]{0,30}\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})\b/,
    /\b(?:support|soutien)\b[\s\S]{0,30}\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})\b[\s\S]{0,50}\b(?:finit|finira|termine|terminera|ends?|end)\b/,
    ...(/\bTEC-\d+\b/i.test(rawText)
      ? [/\b(?:est|sont|is|are)\s+(?:remplacee?|remplaces?|replaced)\b[\s\S]{0,25}\b(?:par|by)\b/]
      : []),
  ]);
}

/**
 * The states of a vulnerability row as the person says them, accents removed. "Résolue" and
 * "resolved" are task and incident words: they never name a vulnerability state.
 */
const VULNERABILITY_STATE_WORD_RE = /\b(?:traitee?s?|a traiter|a revoir|non concernee?s?|pas concernee?s?|corrigee?s?|acceptee?s?|handled|not affected|to review|fixed|accepted)\b/;

/** The verbs of a vulnerability state change, raw and lower-case; the first group needs a state word. */
const VULNERABILITY_STATE_VERBS = new Set([
  'passe', 'passez', 'passer', 'mets', 'mettez', 'mettre', 'remets', 'remettez', 'remettre',
  'marque', 'marquez', 'marquer', 'mark', 'set', 'move', 'change', 'changez', 'changer',
]);
/** These verbs name the change themselves: "Traite toutes les failles critiques de TEC-3". */
const VULNERABILITY_HANDLE_VERBS = new Set([
  'traite', 'traitez', 'traiter', 'handle', 'rouvre', 'rouvrez', 'rouvrir', 'reopen',
]);

/** Another family is the object of the phrase: "Mark the task T-5 about CVE-2024-3094 as resolved". */
const VULNERABILITY_OTHER_FAMILY_RE = /\b(?:t|inc|req|prj|doc|opex|opx|cpx|bl)-\d+\b|\b(?:tache|taches|task|tasks|ticket|tickets|demande|demandes|request|requests|incident|incidents|projet|projets|project|projects)\b/;

/** A handle verb names the rows right after itself, a determiner aside: "Traite toutes les failles de TEC-3". */
const VULNERABILITY_HANDLE_OBJECT_RE = /^\S+\s+(?:(?:(?:toutes|tous)\s+(?:les|ces|mes|nos|vos)|les|la|le|une?|des|du|de|ces|cette|cet|ce|mes|nos|vos|leurs?|the|a|an|all(?:\s+the)?|these|those|this|that|every|each|my|our|your)\s+|[ld]['’]\s*)?(?:cve-\d{4}-\d{4,}|faille|failles|vulnerabilite|vulnerabilites|vulnerability|vulnerabilities)\b/;

/** A handle verb on a report or a list is a read: "Traite les failles de TEC-3 dans un rapport". */
const VULNERABILITY_REPORT_WORD_RE = /\b(?:rapport|rapports|report|reports|csv|liste|listes|list|lists|tableau|tableaux|table|tables|export|exports|question|questions|resume|resumes|summary|summaries)\b/;

/**
 * A vulnerability state write: an imperative at the head, a CVE id or a vulnerability word, and a
 * state word unless the verb names the change ("Marque CVE-2024-1234 comme corrigée sur
 * PostgreSQL 14", "Traite toutes les failles critiques de TEC-3"). A question, the alert setting
 * ("Désactive les alertes de failles de TEC-3") and a phrase about a task, a request, an incident
 * or a project are not. A handle verb names the rows right after itself and no report.
 */
function hasVulnerabilityStateWrite(rawText: string, text: string): boolean {
  if (isTechnologyQuestion(rawText)) return false;
  const first = directiveFirstWord(rawText);
  if (first == null || (!VULNERABILITY_STATE_VERBS.has(first) && !VULNERABILITY_HANDLE_VERBS.has(first))) return false;
  if (/\b(?:alertes?|alerts?)\b/.test(text)) return false;
  if (VULNERABILITY_OTHER_FAMILY_RE.test(text)) return false;
  const namesVulnerability = /\bCVE-\d{4}-\d{4,}\b/i.test(rawText)
    || /\b(?:faille|failles|vulnerabilite|vulnerabilites|vulnerability|vulnerabilities|cve|cves)\b/.test(text);
  if (!namesVulnerability) return false;
  if (VULNERABILITY_HANDLE_VERBS.has(first)) {
    const head = text.trim().replace(DIRECTIVE_PREFIX_RE, '');
    return VULNERABILITY_HANDLE_OBJECT_RE.test(head) && !VULNERABILITY_REPORT_WORD_RE.test(text);
  }
  return VULNERABILITY_STATE_WORD_RE.test(text);
}

/** Undoing the last mutation is a write, never a read: "Undo that", "Annule l'aperçu". */
const UNDO_REQUEST_RE = /\bundo\b|\bannule (?:ce que|ceci|cela|la derniere|le dernier|la precedent|la precedente|les dernieres|l['’]apercu)\b|\bcancel (?:my |the )?(?:last|previous) (?:preview|change|modification|action)\b/;

/**
 * A lifecycle write on an incident: an imperative verb at the head (after a salutation or a polite
 * turn) naming an incident, an INC reference or a confidentiality change. A read word later does
 * not cancel the imperative; without one, a state word alone stays a read: "Show closed incidents",
 * "Les incidents clos de APP-3", "INC-3 a-t-il été rouvert ?".
 */
function hasIncidentLifecycleWrite(
  text: string,
  hasIncidentReference: boolean,
  hasIncidentConfidentialityIntent: boolean,
): boolean {
  const namesIncident = hasIncidentReference || /\bincidents?\b/.test(text)
    || hasIncidentConfidentialityIntent;
  if (!namesIncident) return false;
  const directiveVerb = directiveHeadVerb(text);
  if (directiveVerb) {
    return INCIDENT_LIFECYCLE_VERBS_WITH_STATE.has(directiveVerb)
      ? INCIDENT_STATE_WORD_RE.test(text) || hasIncidentConfidentialityIntent
      : true;
  }
  if (INCIDENT_READ_EXPLANATION_RE.test(text)) return false;
  return INCIDENT_STATE_DIRECTIVE_RE.test(text);
}

function classifyAiContextProfile(userMessage: string): ClassifiedContextProfile {
  const raw = String(userMessage || '');
  const text = normalizeText(raw);
  const referencedTypes = extractReferencedEntityTypes(raw);
  const hasUnknownReference = hasEntityReference(raw) && referencedTypes.size === 0;
  const needsWeb = containsAny(text, [
    // Not the bare word "forecast": it names a budget column; a weather forecast matches below.
    /\b(web|internet|online|google|site web|actualite|eol|end of life|weather|meteo)\b/,
    wordsInOrder(/\b(?:latest|current|derniere)\b/, /\b(?:version|release)\b/),
    wordsInOrder(/\b(?:demain|today|tomorrow)\b/, /\b(?:meteo|weather|forecast)\b/),
  ]);

  // A review is a read, not the "passe" write: "Passe en revue les technologies en fin de vie".
  if (/\b(?:passe|passer|pass|go through)\s+(?:en\s+)?revue\b/.test(text)) {
    return { profile: withWebCapability(PROFILES.read_query, needsWeb), explicitIntent: true };
  }
  // "Qui a changé … ?" asks who changed a value, not for a change.
  if (isQuestion(raw, text)
    && /^(?:qui a|who has|who changed|who modified|qui a modifie)\b[\s\S]{0,60}\b(?:change|modifie|updated?|edited?)\b/.test(text)) {
    return { profile: withWebCapability(PROFILES.read_query, needsWeb), explicitIntent: true };
  }

  if (isMinimalDirectRequest(raw)) {
    return { profile: PROFILES.minimal, explicitIntent: true };
  }

  if (isReadOnlyChangeInquiry(raw, text)) {
    if (containsAny(text, [/\b(document|documents|doc|docs|knowledge|article|page|library|folder)\b/])) {
      return { profile: withWebCapability(PROFILES.knowledge, needsWeb), explicitIntent: true };
    }
    if (hasEntityReference(raw) || containsAny(text, [/\b(?:ce qui|quoi|what|which)\b/])) {
      return { profile: withWebCapability(PROFILES.entity_inspection, needsWeb), explicitIntent: true };
    }
    return { profile: withWebCapability(PROFILES.read_query, needsWeb), explicitIntent: true };
  }

  if (isAdvisoryFeatureImprovementQuestion(raw, text)) {
    return { profile: withWebCapability(PROFILES.read_query, needsWeb), explicitIntent: true };
  }

  // Undoing the last mutation is a write of its own: "Undo that", "Annule l'aperçu".
  if (UNDO_REQUEST_RE.test(text)) {
    return { profile: withWebCapability(PROFILES.write_general, needsWeb), explicitIntent: true };
  }

  const hasIncidentReference = referencedTypes.has('incidents');
  // A confidentiality phrase names an incident change even when the person leaves the reference
  // implicit ("plus confidentiel", "lève la confidentialité").
  const hasIncidentConfidentialityIntent = containsAny(text, [
    /\bplus confidentiel(?:le|les|s)?\b/,
    /\bmoins confidentiel(?:le|les|s)?\b/,
    wordsInOrder(/\b(?:leve|levee|lever|lift|lifted)\b/, /\b(?:confidentialite|confidentiality)\b/),
  ]);
  const hasIncidentIntent = hasIncidentReference || /\bincidents?\b/.test(text)
    || hasIncidentConfidentialityIntent;
  const question = isQuestion(raw, text);
  const writeText = stripReflexivePast(text);
  // The people and web-link writes are decided on the raw text, before a document word or the
  // `docs` path of a link address sends them to another family.
  const hasTechnologyPeopleIntent = hasTechnologyPeopleWrite(raw, text);
  const hasTechnologyWebLinkIntent = hasTechnologyWebLinkWrite(raw, text);
  // A polite or wish turn before the verb still carries the request: "Peux-tu passer T-4 ?".
  const hasPoliteRequest = /^(?:(?:bonjour|bonsoir|salut|hello|hi|hey)[\s,!.]+)*(?:je veux|je voudrais|il faut|tu peux|peux[- ]tu|pouvez[- ]vous|i want to|i would like to|can you|could you|would you|please|merci de|stp|svp)\b/.test(text);
  const hasTaskReference = hasReferenceInGroup(referencedTypes, TASK_ENTITY_TYPES);
  // The names of a task, tested before the incident intent: "une tâche pour suivre l'incident".
  const hasTaskNameIntent = containsAny(text, [
    /\b(task|tasks|ticket|tickets|tache|taches|todo|to-do|assignee|echeance|due date)\b/,
  ]);
  const mentionsDocument = !hasTechnologyWebLinkIntent && containsAny(text, [
    /\b(document|documents|doc|docs|knowledge|article|page|library|folder|markdown)\b/,
  ]);
  // A read verb keeps the journal and the notes a read: "Montre le journal de INC-3".
  const asksToReadIncident = containsAny(text, [
    /\b(montre|montrer|affiche|afficher|show|list|liste|quel|quelle|quels|quelles|what|which)\b/,
  ]);
  // "note", "journal" and "log" are a write on an incident unless the person asks a question.
  const hasIncidentNoteIntent = hasIncidentIntent && !question && !asksToReadIncident
    && containsAny(text, [/\b(note|notes|journal|log|logs)\b/]);
  // An incident state or a confidentiality change is a write when an imperative verb opens the
  // phrase; a state word alone stays a read: "Show closed incidents", "Les incidents clos de
  // APP-3", "INC-3 a-t-il été rouvert ?".
  const hasIncidentLifecycleIntent = hasIncidentIntent
    && hasIncidentLifecycleWrite(text, hasIncidentReference, hasIncidentConfidentialityIntent);
  // A task status write opens with its verb: "Clos T-4, c'est terminé" writes even though the
  // sentence also says "est"; "T-4 est en cours" has no verb and reads.
  const directiveVerb = directiveHeadVerb(text);
  const namesTask = hasTaskReference || /\b(?:tasks|taches)\b/.test(text);
  const hasTaskStatusIntent = namesTask && directiveVerb != null && TASK_STATUS_VERBS.has(directiveVerb);
  // A proposal still carries the task write: "Voulez-vous que je passe T-4 en cours ?".
  const hasTaskProposalIntent = hasTaskReference
    && containsAny(writeText, [/\b(passe|passer|mets|mettre|marque|marquer)\b/]);
  // A status verb on a project reference is the project status change: "Passe PRJ-3 en cours",
  // "Annule le projet PRJ-3". "Passe" alone is not a write: "INC-3 clos hier, que s'est-il passé".
  const hasProjectStatusIntent = !hasIncidentReference && (!question || hasPoliteRequest) && !asksToReadIncident
    && hasReferenceInGroup(referencedTypes, new Set<AiQueryEntityType>(['projects']))
    && containsAny(writeText, [/\b(passe|passer|mets|mettre|marque|marquer|annule|annuler|cancel)\b/]);
  // Adding one record to another is a relation write: "Ajoute AST-12 à APP-3".
  const hasAddLinkIntent = referencedTypes.size >= 2 && !hasIncidentIntent && !hasTaskNameIntent
    && !mentionsDocument && containsAny(text, [/\b(?:ajoute|ajouter|add)\b/]);
  // Publishing a document is a document write: "Publie le document DOC-4", "Publie DOC-4".
  // The imperative or the infinitive only: "Liste les documents publiés" stays a read.
  const hasDocumentPublishIntent = (mentionsDocument || referencedTypes.has('documents'))
    && (containsAny(text, [/\bpublier\b/, /\bpublish\b/])
      || /^(?:(?:bonjour|bonsoir|salut|hello|hi|hey|please|merci de|stp|svp)[\s,!.]+)*publie\b/.test(text));
  // Making a document public is a document write: "Rends le document DOC-4 public".
  const hasDocumentPublicationIntent = mentionsDocument && containsAny(text, [
    /\b(?:rends|rendre|make)\b[\s\S]{0,40}\b(?:public|publique|publics|publiques)\b/,
  ]);
  // A technology link or a version written in the imperative ("Désinstalle nginx de AST-13",
  // "Declare Redis on AST-12") or stated with "now" ("CheeseTrack now uses Java 21"). The
  // imperative is read on the raw text, so "installé" stays a read.
  const hasTechnologyWrite = hasTechnologyWriteIntent(raw, text);
  const hasTechnologyChange = hasTechnologyChangeStatement(raw, text);
  const hasTaskFieldStateWriteIntent = hasTaskFieldStateWrite(raw, text);
  const hasUserAdministrationIntent = hasUserAdministrationWrite(raw, text);
  const hasVulnerabilityStateIntent = hasVulnerabilityStateWrite(raw, text);
  const isWrite = hasTechnologyPeopleIntent || hasTechnologyWebLinkIntent || hasTaskFieldStateWriteIntent
    || hasUserAdministrationIntent || hasVulnerabilityStateIntent || containsAny(writeText, [
    /\b(create|creer|cree|add|ajoute|ajouter|change|changer|update|mets? a jour|mettre a jour|modifie|modifier|delete|supprime|(?:re)?assign(?:e|er|es|ez|ed|ing|s)?|link|lier|lie|lies|relie|relier|unlink|delier|delie|delies|delier|detache|detaches|detacher|retire|retires|retirer|enleve|enleves|enlever|associe|associes|rattache|rattaches|convert|convertir|import|passe|passer|publish|publier|mark|set)\b/,
    wordsInOrder(/\b(?:add|ajoute|ajouter)\b/, /\b(?:comment|commentaire)\b/),
    // A status or lifecycle word with an incident reference is an incident change: "clos INC-7",
    // "Résous INC-3", "Rouvre INC-3", "Annule INC-3", "Lève la confidentialité de INC-3".
    // The lifecycle function already decided the write; the reference or the incident word makes
    // it true here ("Close INC-3", "INC-3 doit être rouvert").
    ...(hasIncidentLifecycleIntent ? [/\b(?:inc-\d+|incidents?)\b/] : []),
    ...(hasIncidentNoteIntent ? [/\b(note|notes|journal|log|logs)\b/] : []),
    ...(hasTaskStatusIntent ? [/\b(clos|closed|ferme|fermer|rouvre|rouvrir|reopen|passe|passer|mets|mettre|marque|marquer|mark|close|annule|annuler|cancel|set|move|done|termine|terminee|pending|in progress|en cours|attente|waiting)\b/] : []),
    ...(hasTaskProposalIntent ? [/\b(passe|passer|mets|mettre|marque|marquer)\b/] : []),
    ...(hasProjectStatusIntent ? [/\b(passe|passer|mets|mettre|marque|marquer|annule|annuler|cancel)\b/] : []),
    // A confidentiality change without an INC reference is still a write: "Lève la
    // confidentialité", "plus confidentiel". A question about it stays a read.
    ...(hasIncidentConfidentialityIntent && (!question || hasPoliteRequest)
      ? [/\b(?:plus confidentiel(?:le|les|s)?|moins confidentiel(?:le|les|s)?|leve|levee|lever|lift|lifted)\b/]
      : []),
    ...(hasDocumentPublishIntent ? [/\b(?:publie|publier|publish)\b/] : []),
    ...(hasDocumentPublicationIntent ? [/\b(?:public|publique|publics|publiques)\b/] : []),
    ...(hasTechnologyWrite || hasTechnologyChange
      ? [/\b(?:installe|installer|install|declare|declarer|desinstalle|uninstall|remove|detach|replace|remplace|renomme|renommer|rename|enregistre|upgrade|mets|mettez|mettre|utilise|uses|runs|tourne|maintenant|now|finit|finira|termine|terminera|ends?|marque|marquez|marquer|mark|adopte|adopter|adopt|efface|effacer|erase|clear|desactive|desactiver|disable|active|activer|enable|exclus|exclure|exclude|indique|indiquer|indicate|turn|reactive|reactivate|stop|remets|remettez|remettre)\b/]
      : []),
    ...(createsIncident(text, raw) ? [/\bincident\b/] : []),
  ]);

  if (isWrite) {
    // The French unlink verbs only name a link with an INC reference or the word incident:
    // "Retire le responsable de la tâche T-4" is a task field write.
    const isRelationWrite = containsAny(text, [
      /\b(relation|relationship|link|linked|lier|lie|lies|relier|relie|associer|associe|associes|rattacher|rattache|connect|connecter|unlink|installe|installer|install|declare|declarer|declares)\b/,
      ...(hasIncidentIntent
        ? [/\b(delie|delies|delier|detache|detaches|detacher|retire|retires|retirer|enleve|enleves|enlever)\b/]
        : []),
      ...(hasAddLinkIntent ? [/\b(?:ajoute|ajouter|add)\b/] : []),
    ]);
    const hasDocumentIntent = mentionsDocument;
    const hasTaskIntent = containsAny(text, [
      /\b(task|tasks|ticket|tickets|tache|taches|todo|to-do|assignee|echeance|due date|priority|priorite|commentaire|comment)\b/,
      /\b(en cours|in progress|done|termine|terminee|clos|closed|pending|a faire|to do)\b/,
    ]);

    // A plan that starts an incident and then links it stays a business write:
    // "Crée l'incident puis lie-le à AST-12 et APP-3".
    if (hasIncidentIntent && !hasTaskNameIntent && createsIncidentRecord(text)) {
      return { profile: withWebCapability(PROFILES.write_business, needsWeb), explicitIntent: true };
    }
    // An adoption and the vulnerability alerts of a technology are business writes without a
    // reference or a link verb: "Adopte Redis depuis le catalogue KANAP", "Turn alerts back on".
    if (hasTechnologyWrite && containsAny(text, [/\b(?:adopte|adopter|adopt)\b/])) {
      return { profile: withWebCapability(PROFILES.write_business, needsWeb), explicitIntent: true };
    }
    if (!question && containsAny(text, [/\b(?:alertes? de failles?|vulnerability alerts?)\b/])) {
      return { profile: withWebCapability(PROFILES.write_business, needsWeb), explicitIntent: true };
    }
    // The state of vulnerability rows: "Traite toutes les failles critiques de TEC-3".
    if (hasVulnerabilityStateIntent) {
      return { profile: withWebCapability(PROFILES.write_business, needsWeb), explicitIntent: true };
    }
    // A link verb with an incident reference is the incident links tool: "lie APP-2 à INC-3".
    if (hasIncidentReference && isRelationWrite) {
      return { profile: withWebCapability(PROFILES.write_business, needsWeb), explicitIntent: true };
    }
    if (isRelationWrite) {
      return { profile: withWebCapability(PROFILES.write_relation, needsWeb), explicitIntent: true };
    }
    if (containsAny(text, [/\b(document|doc|knowledge|article|page|library|folder|markdown)\b/])) {
      return { profile: withWebCapability(PROFILES.write_document, needsWeb), explicitIntent: true };
    }
    // A task on an incident uses create_task, which the task profile carries.
    if (hasTaskNameIntent) {
      return { profile: withWebCapability(PROFILES.write_task, needsWeb), explicitIntent: true };
    }
    if (hasReferenceInGroup(referencedTypes, TASK_ENTITY_TYPES)) {
      return { profile: withWebCapability(PROFILES.write_task, needsWeb), explicitIntent: true };
    }
    if (hasReferenceInGroup(referencedTypes, DOCUMENT_ENTITY_TYPES)) {
      return { profile: withWebCapability(PROFILES.write_document, needsWeb), explicitIntent: true };
    }
    if (hasReferenceInGroup(referencedTypes, FINANCIAL_ENTITY_TYPES)) {
      return { profile: withWebCapability(PROFILES.write_financial, needsWeb), explicitIntent: true };
    }
    if (!hasTechnologyPeopleIntent && hasReferenceInGroup(referencedTypes, MASTER_DATA_ENTITY_TYPES)) {
      return { profile: withWebCapability(PROFILES.write_master_data, needsWeb), explicitIntent: true };
    }
    if (hasReferenceInGroup(referencedTypes, BUSINESS_ENTITY_TYPES)) {
      return { profile: withWebCapability(PROFILES.write_business, needsWeb), explicitIntent: true };
    }
    if (hasUnknownReference) {
      return { profile: withWebCapability(PROFILES.write_general, needsWeb), explicitIntent: true };
    }
    if (hasDocumentIntent) {
      return { profile: withWebCapability(PROFILES.write_document, needsWeb), explicitIntent: true };
    }
    if (hasIncidentIntent) {
      return { profile: withWebCapability(PROFILES.write_business, needsWeb), explicitIntent: true };
    }
    if (hasTaskIntent) {
      return { profile: withWebCapability(PROFILES.write_task, needsWeb), explicitIntent: true };
    }
    if (containsAny(text, [/\b(budget|opex|capex|spend|expense|financial|finance|forecast|plan)\b/])) {
      return { profile: withWebCapability(PROFILES.write_financial, needsWeb), explicitIntent: true };
    }
    // A user account is not a master data record: "Active le compte de Julie Bernard" must not
    // offer the master data write tool, which cannot change a user.
    if (hasUserAdministrationIntent) {
      return { profile: withWebCapability(PROFILES.write_general, needsWeb), explicitIntent: true };
    }
    if (!hasTechnologyPeopleIntent && containsAny(text, [/\b(company|companies|supplier|suppliers|fournisseur|fournisseurs|contact|contacts|department|departement|service|location|site|account|compte|master data|referentiel|referential)\b/])) {
      return { profile: withWebCapability(PROFILES.write_master_data, needsWeb), explicitIntent: true };
    }
    if (containsAny(text, [/\b(application|applications|asset|assets|actif|actifs|server|servers|serveur|serveurs|project|projects|projet|projets|request|requests|demande|demandes|contract|contracts|contrat|contrats|interface|connection|location|incident|incidents|technologie|technologies|technology|version)\b/])) {
      return { profile: withWebCapability(PROFILES.write_business, needsWeb), explicitIntent: true };
    }
    return { profile: withWebCapability(PROFILES.write_general, needsWeb), explicitIntent: true };
  }

  if (needsWeb) {
    return { profile: PROFILES.web, explicitIntent: true };
  }

  // A plural family is a list query even when it names a record: "Les incidents clos de APP-3",
  // "Liste les tâches en cours du projet PRJ-3".
  const mentionsIncidentList = /\bincidents\b/.test(text);
  const mentionsTaskList = /\b(?:tasks|taches)\b/.test(text);
  if ((mentionsIncidentList || mentionsTaskList) && !mentionsDocument) {
    return { profile: PROFILES.read_query, explicitIntent: true };
  }

  // The public page of one incident is the record, not a knowledge document.
  if (hasIncidentReference && asksToReadIncident) {
    return { profile: PROFILES.entity_inspection, explicitIntent: true };
  }

  if (containsAny(text, [
    /\b(document|documents|doc|docs|knowledge|knowledge base|article|articles|page|pages|backup|backups)\b/,
    wordsInOrder(/\b(?:find|search|cherche|chercher|trouve|trouver)\b/, /\b(?:doc|document|knowledge|backup)\b/),
  ])) {
    return { profile: PROFILES.knowledge, explicitIntent: true };
  }

  if (hasEntityReference(raw) || containsAny(text, [
    /\b(summarize|resume|resumer|detail|details|context|contexte|commentaires?|comments?|history|historique)\b/,
  ])) {
    return { profile: PROFILES.entity_inspection, explicitIntent: true };
  }

  if (containsAny(text, [
    /\b(how many|combien|count|nombre|list|liste|show|montre|affiche|find|search|cherche|filter|filtre|status|statut|overdue|retard|due|echeance|priority|priorite|by status|par statut)\b/,
    /\b(tasks?|taches?|projects?|projets?|requests?|demandes?|applications?|assets?|contracts?|suppliers?|users?|people|documents?)\b/,
  ])) {
    return { profile: PROFILES.read_query, explicitIntent: true };
  }

  // Generic fallback: keep broad read capability so Plaid can discover unfamiliar but
  // data-oriented questions without loading write/web instructions by default.
  return { profile: PROFILES.read_query, explicitIntent: false };
}

function isAssistantContinuationPrompt(content: string): boolean {
  const text = normalizeText(content);
  return content.includes('?') || containsAny(text, [
    wordsInOrder(/\b(?:quel|quelle|quels|quelles|what|which)\b/, /\b(?:contenu|content|valeur|value|statut|status|commentaire|comment|texte|text|champ|field)\b/),
    /\b(souhaitez|souhaites|voulez|veux|want|would you like|which one|lequel|laquelle)\b/,
    /\b(precise|precisez|indiquer|indiquez|provide|specify|confirm|confirmez|choisir|choose)\b/,
    /\b(preview|previews|plan de mutation|mutation plan|approuver|approve|rejeter|reject|rejet|approbation|approval)\b/,
  ]);
}

function isWriteTargetCorrectionPrompt(content: string): boolean {
  const text = normalizeText(content);
  return containsAny(text, [
    /\b(exclu|exclus|exclure|exclude|excluded|retire|retirer|enleve|enlever|skip|ignore|ignored|relance|relancer)\b/,
    wordsInOrder(/\b(?:ne veux|ne veut|don't want|do not want|dont want)\b/, /\b(?:tache|taches|task|tasks|cible|cibles|target|targets)\b/),
    wordsInOrder(/\b(?:deja|already)\b/, /\b(?:ferme|fermee|fermees|termine|terminee|terminees|done|completed|closed|cancelled|canceled)\b/),
    wordsInOrder(/\b(?:seulement|uniquement|only|que|qu['’][a-z]+)\b/, /\b(?:actif|active|actives|ouvert|ouverte|open|pending|in progress|en cours)\b/),
    wordsInOrder(/\b(?:encore|still)\b/, /\b(?:actif|active|actives|ouvert|ouverte|open|pending|in progress|en cours)\b/),
  ]);
}

function shouldInheritPreviousWriteProfile(
  latest: ClassifiedContextProfile,
  previous: ClassifiedContextProfile,
  latestUserMessage: string,
  assistantMessage: string,
): boolean {
  if (previous.profile.promptMode !== 'write') {
    return false;
  }
  const isContinuationPrompt = isAssistantContinuationPrompt(assistantMessage);
  const isTargetCorrectionPrompt = isWriteTargetCorrectionPrompt(latestUserMessage);
  if (!isContinuationPrompt && !isTargetCorrectionPrompt) {
    return false;
  }
  if (latest.explicitIntent && latest.profile.promptMode !== 'minimal' && !isTargetCorrectionPrompt) {
    return false;
  }
  return latestUserMessage.trim().length > 0;
}

// An assistant message that ends on a question or an offer ("Dites-moi si vous voulez que je le fasse").
function isAssistantQuestionOrOffer(content: string): boolean {
  return isAssistantContinuationPrompt(content) || containsAny(normalizeText(content), [
    /\b(je peux|puis-je|dites-moi|i can|shall i|should i|let me know|ich kann|soll ich|sagen sie|puedo|digame|quiere|desea)\b/,
  ]);
}

// A short answer to that question or offer: an acceptance ("oui", "go ahead", "ja", "sí"), a name, a
// choice or a number. Thanks and greetings are not answers; a question is a request of its own.
function isShortReply(rawText: string, latest: ClassifiedContextProfile): boolean {
  const trimmed = rawText.trim();
  if (!trimmed || trimmed.includes('?') || isSocialMessage(trimmed)) return false;
  if (latest.profile.promptMode === 'minimal') return true;
  return !latest.explicitIntent && trimmed.length <= 60 && trimmed.split(/\s+/).length <= 4;
}

function lastPart(text: string, separator: RegExp): string {
  const parts = text.split(separator).map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

// The profile of what the assistant proposed, read from its last paragraph as if the user had
// written it. A write counts only when the closing sentence itself proposes it: a write word
// elsewhere in the paragraph usually describes the data ("qui peut modifier le budget").
function profileOfAssistantOffer(content: string): AiContextProfile | null {
  const paragraph = lastPart(content, /\n\s*\n/);
  const offer = classifyAiContextProfile(paragraph);
  if (!offer.explicitIntent || offer.profile.promptMode === 'minimal') return null;
  if (offer.profile.promptMode !== 'write') return offer.profile;
  const closing = classifyAiContextProfile(lastPart(paragraph, /(?<=[.!?…])\s+/));
  return closing.profile.promptMode === 'write' ? closing.profile : null;
}

// A short reply to an assistant question or offer takes the profile of that offer, else the one
// of the request it answers (other than a write: that one has its own rule above), else read.
function profileForShortReply(
  latest: ClassifiedContextProfile,
  previous: ClassifiedContextProfile,
  latestUserMessage: string,
  assistantMessage: string,
): AiContextProfile | null {
  if (!isShortReply(latestUserMessage, latest) || !isAssistantQuestionOrOffer(assistantMessage)) {
    return null;
  }
  const inherited = profileOfAssistantOffer(assistantMessage)
    ?? (previous.profile.promptMode !== 'minimal' && previous.profile.promptMode !== 'write'
      ? previous.profile
      : PROFILES.read_query);
  return { ...inherited, reason: `${inherited.reason}; reply to the assistant's question or offer` };
}

export function selectAiContextProfile(userMessage: string): AiContextProfile {
  return classifyAiContextProfile(userMessage).profile;
}

export function selectAiContextProfileForTurn(messages: AiContextProfileTurnMessage[]): AiContextProfile {
  const latestUserIndex = [...messages].reverse().findIndex((message) => message.role === 'user');
  if (latestUserIndex < 0) {
    return PROFILES.read_query;
  }

  const latestIndex = messages.length - 1 - latestUserIndex;
  const latestUserMessage = messages[latestIndex];
  const latest = classifyAiContextProfile(latestUserMessage.content);

  let previousUserIndex = -1;
  for (let index = latestIndex - 1; index >= 0; index--) {
    if (messages[index].role === 'user') {
      previousUserIndex = index;
      break;
    }
  }

  if (previousUserIndex >= 0) {
    let assistantBetween: AiContextProfileTurnMessage | null = null;
    for (let index = latestIndex - 1; index > previousUserIndex; index--) {
      if (messages[index].role === 'assistant' && messages[index].content.trim()) {
        assistantBetween = messages[index];
        break;
      }
    }

    if (assistantBetween) {
      const previous = classifyAiContextProfile(messages[previousUserIndex].content);
      if (shouldInheritPreviousWriteProfile(latest, previous, latestUserMessage.content, assistantBetween.content)) {
        return {
          ...previous.profile,
          reason: `${previous.profile.reason}; continuation of previous write request`,
        };
      }
      const replyProfile = profileForShortReply(latest, previous, latestUserMessage.content, assistantBetween.content);
      if (replyProfile) return replyProfile;
    }
  }

  return latest.profile;
}

export function filterProviderToolsForProfile<TTool extends Pick<AiProviderToolDef, 'name'>>(
  tools: TTool[],
  profile: AiContextProfile,
): TTool[] {
  return orderToolsForProfile(tools, profile);
}

export function filterToolListForProfile<TTool extends Pick<AiToolListItemDto, 'name'>>(
  tools: TTool[],
  profile: AiContextProfile,
): TTool[] {
  return orderToolsForProfile(tools, profile);
}

function orderToolsForProfile<TTool extends { name: string }>(
  tools: TTool[],
  profile: AiContextProfile,
): TTool[] {
  if (profile.promptMode === 'minimal') {
    return [];
  }

  if (profile.promptMode === 'web') {
    return tools.filter((tool) => tool.name === 'web_search');
  }

  const preferredOrder = new Map<string, number>(profile.toolNames.map((name, index) => [name, index]));
  const exposeWebSearch = profile.toolNames.includes('web_search') || profile.includeWebGuidelines;
  return tools
    .filter((tool) => tool.name !== 'web_search' || exposeWebSearch)
    .sort((left, right) => {
      const leftRank = preferredOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = preferredOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });
}

/** Legacy paths keep their numbering; the neutral path resolves the stored nature. */
export function budgetLineRefFromUrl(url: string): string | null {
  const match = url.match(/^\/ops\/(budget|opex|capex)\/([^/?#]+)/i);
  if (!match || match[2] === 'new') return null;
  let ref: string;
  try { ref = decodeURIComponent(match[2]).replace(/^(bl|opx|cpx)-/i, (prefix) => prefix.toUpperCase()); }
  catch { return null; }
  return /^\d+$/.test(ref) && match[1] !== 'budget'
    ? `${match[1] === 'capex' ? 'CPX' : 'OPX'}-${ref}` : ref;
}
