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
];

const ENTITY_INSPECTION_TOOLS: AiToolName[] = [
  'search_all',
  'describe_entity_filters',
  'query_entities',
  'get_filter_values',
  'get_entity_detail',
  'get_entity_context',
  'get_entity_comments',
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
  // The budget line references the screens show, including the legacy OPEX wording of a request.
  { pattern: /\b(?:BL|OPEX|OPX|CPX)-\d+\b/i, entityType: 'budget_lines' },
  // Read only for now: kept out of BUSINESS_ENTITY_TYPES until technologies have a write.
  { pattern: /\bTEC-\d+\b/i, entityType: 'technologies' },
  // Read only: a CVE id names the vulnerability rows of that CVE.
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
  'locations',
  'projects',
  'requests',
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

function extractReferencedEntityTypes(rawText: string): Set<AiQueryEntityType> {
  const referenced = new Set<AiQueryEntityType>();
  for (const entry of CANONICAL_REF_ENTITY_TYPES) {
    if (entry.pattern.test(rawText)) {
      referenced.add(entry.entityType);
    }
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
const INCIDENT_STATE_WORD_RE = /\b(clos|closed|ferme|fermee|fermer|resolu|resolue|resolved|resous|resoudre|resolve|rouvert|reopened|rouvre|rouvrir|reopen|annule|annulee|annuler|cancel|cancelled|canceled|leve|levee|lever|lift|lifted|confidentialite|confidentiality|confidentiel|confidentielle|confidential|public|publique)\b/;

/** The imperative verbs of an incident lifecycle change: "Rouvre INC-3", "Clos INC-7". */
const INCIDENT_LIFECYCLE_IMPERATIVE_RE = /^(?:merci de |please |peux[- ]tu |pouvez[- ]vous |could you |can you )?(clos|close|ferme|fermer|passe|passer|mets|mettre|marque|marquer|resous|resoudre|resolve|rouvre|rouvrir|reopen|annule|annuler|cancel|leve|lever|lift|rends|rendre|make)\b/;

/** These verbs only change the state they name: "Passe INC-3 en résolu", "Rends INC-3 public". */
const INCIDENT_LIFECYCLE_VERBS_WITH_STATE = new Set([
  'passe', 'passer', 'mets', 'mettre', 'marque', 'marquer', 'rends', 'rendre', 'make',
]);

/** A stated change without an imperative: "INC-3 ne doit plus être confidentiel". */
const INCIDENT_STATE_DIRECTIVE_RE = /\b(?:ne )?(?:doit|devrait|should|must) (?:plus |moins )?(?:etre|be) (?:plus |moins )?(?:confidentiel|confidentielle|confidential|public|publique|closed|clos|resolu|resolved|ferme|fermee)\b/;

/**
 * A lifecycle write on one incident: an INC reference and an imperative verb, never a state word
 * alone. A read verb or a question keeps the record read: "Show closed incidents", "Les incidents
 * clos de APP-3", "INC-3 a-t-il été rouvert ?".
 */
function hasIncidentLifecycleWrite(
  text: string,
  hasIncidentReference: boolean,
  question: boolean,
  asksToReadIncident: boolean,
): boolean {
  if (!hasIncidentReference || question || asksToReadIncident) return false;
  if (INCIDENT_STATE_DIRECTIVE_RE.test(text)) return true;
  const imperative = text.match(INCIDENT_LIFECYCLE_IMPERATIVE_RE);
  if (!imperative) return false;
  return INCIDENT_LIFECYCLE_VERBS_WITH_STATE.has(imperative[1])
    ? INCIDENT_STATE_WORD_RE.test(text)
    : true;
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

  const hasIncidentReference = referencedTypes.has('incidents');
  // A confidentiality phrase names an incident change even when the person leaves the reference
  // implicit ("plus confidentiel", "lève la confidentialité").
  const hasIncidentConfidentialityIntent = containsAny(text, [
    /\bplus confidentiel\b/,
    /\bmoins confidentiel\b/,
    wordsInOrder(/\b(?:leve|lever|lift)\b/, /\b(?:confidentialite|confidentiality)\b/),
  ]);
  const hasIncidentIntent = hasIncidentReference || /\bincidents?\b/.test(text)
    || hasIncidentConfidentialityIntent;
  const question = isQuestion(raw, text);
  // A polite request ends on a question mark: "tu peux passer la T-49 en cours ?".
  const hasPoliteRequest = /^(?:tu peux|peux[- ]tu|pouvez[- ]vous|can you|could you|would you|please|merci de)\b/.test(text);
  const hasTaskReference = hasReferenceInGroup(referencedTypes, TASK_ENTITY_TYPES);
  // The names of a task, tested before the incident intent: "une tâche pour suivre l'incident".
  const hasTaskNameIntent = containsAny(text, [
    /\b(task|tasks|ticket|tickets|tache|taches|todo|to-do|assignee|echeance|due date)\b/,
  ]);
  const mentionsDocument = containsAny(text, [
    /\b(document|documents|doc|docs|knowledge|article|page|library|folder|markdown)\b/,
  ]);
  // A read verb keeps the journal and the notes a read: "Montre le journal de INC-3".
  const asksToReadIncident = containsAny(text, [
    /\b(montre|montrer|affiche|afficher|show|list|liste|quel|quelle|quels|quelles|what|which)\b/,
  ]);
  // "note", "journal" and "log" are a write on an incident unless the person asks a question.
  const hasIncidentNoteIntent = hasIncidentIntent && !question && !asksToReadIncident
    && containsAny(text, [/\b(note|notes|journal|log|logs)\b/]);
  // An incident state or a confidentiality change needs an INC reference and an imperative verb:
  // "Les incidents clos de APP-3" and "Show closed incidents" stay reads. A question asks about
  // the fact: "INC-3 a-t-il été rouvert ?".
  const hasIncidentLifecycleIntent = hasIncidentIntent
    && hasIncidentLifecycleWrite(text, hasIncidentReference, question, asksToReadIncident);
  // A status word with a task reference closes the task only with a write verb: "Clos la tâche
  // T-4" writes, "Show open tasks of T-4" and "T-4 est en cours" read.
  const hasTaskStatusIntent = hasTaskReference && (!question || hasPoliteRequest) && !asksToReadIncident
    && !containsAny(text, [/\b(is|are|was|were|est|sont|etait|etaient)\b/])
    && containsAny(text, [/\b(clos|closed|ferme|fermer|rouvre|rouvrir|reopen|passe|passer|mets|mettre|marque|marquer|mark|close)\b/]);
  // A status verb on a project reference is the project status change: "Passe PRJ-3 en cours",
  // "Annule le projet PRJ-3". "Passe" alone is not a write: "INC-3 clos hier, que s'est-il passé".
  const hasProjectStatusIntent = !hasIncidentReference && (!question || hasPoliteRequest) && !asksToReadIncident
    && hasReferenceInGroup(referencedTypes, new Set<AiQueryEntityType>(['projects']))
    && containsAny(text, [/\b(passe|passer|mets|mettre|marque|marquer|annule|annuler|cancel)\b/]);
  const isWrite = containsAny(text, [
    /\b(create|creer|cree|add|ajoute|ajouter|change|changer|update|mets? a jour|mettre a jour|modifie|modifier|delete|supprime|(?:re)?assign(?:e|er|es|ez|ed|ing|s)?|link|lier|lie|lies|relie|relier|unlink|delier|delie|delies|delier|detache|detaches|detacher|retire|retires|retirer|enleve|enleves|enlever|associe|associes|rattache|rattaches|convert|convertir|import|publish|publier|mark|set)\b/,
    wordsInOrder(/\b(?:add|ajoute|ajouter)\b/, /\b(?:comment|commentaire)\b/),
    // A status or lifecycle word with an incident reference is an incident change: "clos INC-7",
    // "Résous INC-3", "Rouvre INC-3", "Annule INC-3", "Lève la confidentialité de INC-3".
    // In a question it names a fact to read: "INC-3 est-il clos ?", "INC-3 a-t-il été rouvert ?".
    ...(hasIncidentLifecycleIntent
      ? [/\b(clos|closed|ferme|fermer|resolu|resolue|resolved|resous|resoudre|resolve|rouvre|rouvrir|reopen|annule|annuler|cancel|leve|lever|lift|confidentialite|confidentiality|confidentiel|confidentielle|confidential|public|publique)\b/]
      : []),
    ...(hasIncidentNoteIntent ? [/\b(note|notes|journal|log|logs)\b/] : []),
    ...(hasTaskStatusIntent ? [/\b(clos|closed|ferme|fermer|rouvre|rouvrir|reopen|passe|passer|mets|mettre|marque|marquer|mark|close|done|termine|terminee|pending|in progress|en cours|attente|waiting)\b/] : []),
    // A task status verb with a task reference is a write even in a proposal ("Voulez-vous que je
    // passe T-4 en cours ?"), while "que s'est-il passé" names no task.
    ...(hasTaskReference && containsAny(text, [/\b(passe|passer|mets|mettre|marque|marquer)\b/])
      ? [/\b(passe|passer|mets|mettre|marque|marquer)\b/]
      : []),
    ...(hasProjectStatusIntent ? [/\b(passe|passer|mets|mettre|marque|marquer|annule|annuler|cancel)\b/] : []),
    ...(createsIncident(text, raw) ? [/\bincident\b/] : []),
  ]);

  if (isWrite) {
    // The French unlink verbs only name a link with an INC reference or the word incident:
    // "Retire le responsable de la tâche T-4" is a task field write.
    const isRelationWrite = containsAny(text, [
      /\b(relation|relationship|link|linked|lier|lie|lies|relier|relie|associer|associe|associes|rattacher|rattache|connect|connecter|unlink)\b/,
      ...(hasIncidentIntent
        ? [/\b(delie|delies|delier|detache|detaches|detacher|retire|retires|retirer|enleve|enleves|enlever)\b/]
        : []),
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
    if (hasReferenceInGroup(referencedTypes, MASTER_DATA_ENTITY_TYPES)) {
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
    if (containsAny(text, [/\b(company|supplier|contact|department|location|account|master data|referentiel|referential)\b/])) {
      return { profile: withWebCapability(PROFILES.write_master_data, needsWeb), explicitIntent: true };
    }
    if (containsAny(text, [/\b(application|applications|asset|assets|project|projects|request|requests|contract|contracts|interface|connection|location|incident|incidents)\b/])) {
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
