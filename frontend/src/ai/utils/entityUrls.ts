/**
 * Frontend mirror of backend ENTITY_URL_BUILDERS (ai-chat-orchestrator.service.ts).
 * Shared knowledge of which entity types are clickable to a workspace page.
 *
 * Keep in sync with both:
 * - backend/src/ai/ai-chat-orchestrator.service.ts (linkifyPreviewSummary)
 * - frontend/src/App.tsx route declarations
 *
 * Sub-entities of master-data without a workspace page (accounts, chart_of_accounts,
 * analytics_categories) are intentionally absent — better return null
 * than render a dead link in the @-mention picker.
 */
const ENTITY_URL_BUILDERS: Record<string, (id: string) => string> = {
  documents: (id) => `/knowledge/${id}`,
  tasks: (id) => `/portfolio/tasks/${id}`,
  projects: (id) => `/portfolio/projects/${id}`,
  requests: (id) => `/portfolio/requests/${id}`,
  applications: (id) => `/it/applications/${id}`,
  assets: (id) => `/it/assets/${id}`,
  incidents: (id) => `/it/incidents/${id}`,
  connections: (id) => `/it/connections/${id}`,
  interfaces: (id) => `/it/interfaces/${id}`,
  locations: (id) => `/it/locations/${id}`,
  contracts: (id) => `/ops/contracts/${id}`,
  spend_items: (id) => `/ops/opex/${id}`,
  capex_items: (id) => `/ops/capex/${id}`,
  companies: (id) => `/master-data/companies/${id}`,
  contacts: (id) => `/master-data/contacts/${id}`,
  departments: (id) => `/master-data/departments/${id}`,
  suppliers: (id) => `/master-data/suppliers/${id}`,
  business_processes: (id) => `/master-data/business-processes/${id}`,
};

export function buildEntityUrl(entityType: string, id: string): string | null {
  const builder = ENTITY_URL_BUILDERS[entityType];
  return builder ? builder(id) : null;
}

export function isLinkableEntityType(entityType: string): boolean {
  return entityType in ENTITY_URL_BUILDERS;
}

/**
 * Map between KANAP type prefixes (case-insensitive) and the canonical entity_type.
 *
 * Two flavours of prefixes coexist here:
 *   1. "Native ref prefixes" (T, DOC, PRJ, REQ, INC, OPX, CPX) that the backend's buildRef() turns
 *      into a real entity ref like "T-5" or "DOC-152". These let us also surface
 *      a tier-1 boost on item_number when the user types `@T-5`.
 *   2. "Type tokens" for entities the data model doesn't number (APP, AST, CONN, …).
 *      These are conventional shorthand — applications are stored as plain "Blouway"
 *      / "Factiva" names but users say "@APP" to mean "filter to applications".
 *
 * Both classes are treated identically at the picker level: matching the prefix
 * narrows the search to that single entity_type. The native-ref class additionally
 * benefits from the backend's parseNumericRef() boost when the suffix is a number.
 */
const TYPE_PREFIX_TO_ENTITY_TYPE: Record<string, string> = {
  // Native ref prefixes (item_number → ref via buildRef)
  T: 'tasks',
  DOC: 'documents',
  PRJ: 'projects',
  REQ: 'requests',
  INC: 'incidents',
  OPX: 'spend_items',
  CPX: 'capex_items',
  // Type tokens for entities without a built-in ref
  APP: 'applications',
  AST: 'assets',
  CONN: 'connections',
  INT: 'interfaces',
  LOC: 'locations',
  CTR: 'contracts',
  COMP: 'companies',
  CONT: 'contacts',
  DEPT: 'departments',
  SUP: 'suppliers',
  BP: 'business_processes',
};

/**
 * Parse an @-mention query into an optional narrowed entity_type and the actual
 * search term to send to the backend.
 *
 * Recognised patterns (case-insensitive):
 *   "T"          → { entityType: 'tasks',        searchTerm: '' }     // bare prefix → recent tasks
 *   "T-"         → { entityType: 'tasks',        searchTerm: '' }     // dash alone, same as bare
 *   "T-5"        → { entityType: 'tasks',        searchTerm: '5' }    // T-5 + tasks containing "5"
 *   "PRJ"        → { entityType: 'projects',     searchTerm: '' }
 *   "APP"        → { entityType: 'applications', searchTerm: '' }
 *   "DOC-conf"   → { entityType: 'documents',    searchTerm: 'conf' }
 *   "backup"     → { entityType: null,           searchTerm: 'backup' }  // not a prefix → text search
 *   "TASK"       → { entityType: null,           searchTerm: 'TASK' }    // unrecognised prefix → text search
 */
export function parseAtMentionQuery(query: string): { entityType: string | null; entityTypes?: string[]; searchTerm: string } {
  const trimmed = query.trim();
  if (!trimmed) return { entityType: null, searchTerm: '' };
  // Match alphabetic prefix optionally followed by `-<suffix>`.
  const match = trimmed.match(/^([A-Za-z]+)(?:-(.*))?$/);
  if (!match) return { entityType: null, searchTerm: trimmed };
  const prefix = match[1].toUpperCase();
  const entityType = TYPE_PREFIX_TO_ENTITY_TYPE[prefix];
  if (entityType) return { entityType, entityTypes: [entityType], searchTerm: match[2] || '' };

  // While the user is still typing a known token (`@D`, `@DO`, `@AS`, `@CO`, ...),
  // narrow to matching entity families instead of firing a noisy cross-type text search.
  const matchingEntityTypes = Array.from(new Set(
    Object.entries(TYPE_PREFIX_TO_ENTITY_TYPE)
      .filter(([candidate]) => candidate.startsWith(prefix))
      .map(([, type]) => type),
  ));
  if (matchingEntityTypes.length > 0) {
    return {
      entityType: matchingEntityTypes.length === 1 ? matchingEntityTypes[0] : null,
      entityTypes: matchingEntityTypes,
      searchTerm: match[2] || '',
    };
  }

  return { entityType: null, searchTerm: trimmed };
}

/** @deprecated kept for backwards compatibility — prefer parseAtMentionQuery. */
export function detectEntityTypeFromQuery(query: string): string | null {
  return parseAtMentionQuery(query).entityType;
}
