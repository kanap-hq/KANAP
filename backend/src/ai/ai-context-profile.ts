import type { AiQueryEntityType, AiToolListItemDto, AiToolName } from './ai.types';
import type { AiProviderToolDef } from './providers/ai-provider.types';

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
  'update_entity_relations',
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

function containsAny(text: string, patterns: RegExp[]): boolean {
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
  { pattern: /\/ops\/contracts\//i, entityType: 'contracts' },
  { pattern: /\/ops\/capex\//i, entityType: 'capex_items' },
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
const FINANCIAL_ENTITY_TYPES = new Set<AiQueryEntityType>(['capex_items', 'spend_items']);

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

function isMinimalDirectRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80 || hasEntityReference(trimmed)) return false;
  return /^(hi|hello|hey|bonjour|bonsoir|salut|merci|thanks|thank you|ok|okay|oui|non|ca va|ça va|help|aide)[\s!.?]*$/i
    .test(trimmed);
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

function classifyAiContextProfile(userMessage: string): ClassifiedContextProfile {
  const raw = String(userMessage || '');
  const text = normalizeText(raw);
  const referencedTypes = extractReferencedEntityTypes(raw);
  const hasUnknownReference = hasEntityReference(raw) && referencedTypes.size === 0;
  const needsWeb = containsAny(text, [
    // Not the bare word "forecast": it names a budget column; a weather forecast matches below.
    /\b(web|internet|online|google|site web|actualite|eol|end of life|weather|meteo)\b/,
    /\b(latest|current|derniere)\b.*\b(version|release)\b/,
    /\b(demain|today|tomorrow)\b.*\b(meteo|weather|forecast)\b/,
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

  const isWrite = containsAny(text, [
    /\b(create|creer|cree|add|ajoute|ajouter|change|changer|update|mettre a jour|modifie|modifier|delete|supprime|(?:re)?assign(?:e|er|es|ez|ed|ing|s)?|link|lier|unlink|delier|convert|convertir|import|publish|publier|mark|set|passer|passe)\b/,
    /\b(add|ajoute|ajouter)\b.*\b(comment|commentaire)\b/,
  ]);

  if (isWrite) {
    const isRelationWrite = containsAny(text, [
      /\b(relation|relationship|link|linked|lier|relier|associer|rattacher|connect|connecter|unlink|delier)\b/,
    ]);
    const hasDocumentIntent = containsAny(text, [
      /\b(document|documents|doc|docs|knowledge|article|page|library|folder|markdown)\b/,
    ]);
    const hasTaskIntent = containsAny(text, [
      /\b(task|tasks|ticket|tickets|tache|taches|todo|to-do|assignee|echeance|due date|priority|priorite|commentaire|comment)\b/,
      /\b(en cours|in progress|open|done|termine|terminee|clos|closed|pending|a faire|to do)\b/,
    ]);

    if (isRelationWrite) {
      return { profile: withWebCapability(PROFILES.write_relation, needsWeb), explicitIntent: true };
    }
    if (containsAny(text, [/\b(document|doc|knowledge|article|page|library|folder|markdown)\b/])) {
      return { profile: withWebCapability(PROFILES.write_document, needsWeb), explicitIntent: true };
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
    if (hasTaskIntent) {
      return { profile: withWebCapability(PROFILES.write_task, needsWeb), explicitIntent: true };
    }
    if (containsAny(text, [/\b(budget|opex|capex|spend|expense|financial|finance|forecast|plan)\b/])) {
      return { profile: withWebCapability(PROFILES.write_financial, needsWeb), explicitIntent: true };
    }
    if (containsAny(text, [/\b(company|supplier|contact|department|location|account|master data|referentiel|referential)\b/])) {
      return { profile: withWebCapability(PROFILES.write_master_data, needsWeb), explicitIntent: true };
    }
    if (containsAny(text, [/\b(application|applications|asset|assets|project|projects|request|requests|contract|contracts|interface|connection|location)\b/])) {
      return { profile: withWebCapability(PROFILES.write_business, needsWeb), explicitIntent: true };
    }
    return { profile: withWebCapability(PROFILES.write_general, needsWeb), explicitIntent: true };
  }

  if (needsWeb) {
    return { profile: PROFILES.web, explicitIntent: true };
  }

  if (containsAny(text, [
    /\b(document|documents|doc|docs|knowledge|knowledge base|article|articles|page|pages|backup|backups)\b/,
    /\b(find|search|cherche|chercher|trouve|trouver)\b.*\b(doc|document|knowledge|backup)\b/,
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
    /\b(quel|quelle|quels|quelles|what|which)\b.*\b(contenu|content|valeur|value|statut|status|commentaire|comment|texte|text|champ|field)\b/,
    /\b(souhaitez|souhaites|voulez|veux|want|would you like|which one|lequel|laquelle)\b/,
    /\b(precise|precisez|indiquer|indiquez|provide|specify|confirm|confirmez|choisir|choose)\b/,
    /\b(preview|previews|plan de mutation|mutation plan|approuver|approve|rejeter|reject|rejet|approbation|approval)\b/,
  ]);
}

function isWriteTargetCorrectionPrompt(content: string): boolean {
  const text = normalizeText(content);
  return containsAny(text, [
    /\b(exclu|exclus|exclure|exclude|excluded|retire|retirer|enleve|enlever|skip|ignore|ignored|relance|relancer)\b/,
    /\b(ne veux|ne veut|don't want|do not want|dont want)\b.*\b(tache|taches|task|tasks|cible|cibles|target|targets)\b/,
    /\b(deja|already)\b.*\b(ferme|fermee|fermees|termine|terminee|terminees|done|completed|closed|cancelled|canceled)\b/,
    /\b(?:seulement|uniquement|only|que|qu['’][a-z]+)\b.*\b(actif|active|actives|ouvert|ouverte|open|pending|in progress|en cours)\b/,
    /\b(encore|still)\b.*\b(actif|active|actives|ouvert|ouverte|open|pending|in progress|en cours)\b/,
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
