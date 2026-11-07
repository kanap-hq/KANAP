import type { PermissionLevel } from '../../permissions/permissions.service';

/** The imports Plaid maps a spreadsheet onto (`ai-import-targets.ts`). */
export const AI_IMPORT_KEYS = [
  'applications', 'assets', 'portfolio_projects', 'portfolio_requests', 'tasks', 'incidents',
  'budget_lines', 'contracts', 'suppliers', 'contacts', 'companies', 'departments', 'cost_centers',
  'accounts', 'analytics_categories', 'business_processes', 'working_day_calendars',
  'technology_asset_links', 'technology_application_links',
] as const;
export type AiImportKey = (typeof AI_IMPORT_KEYS)[number];

/**
 * The rights of an import, as its import route: the module and level of `@RequireLevel`, a module
 * the route also reads, and `@ReservedToUnscopedDataAccess`. `ai-import-targets.spec.ts` compares
 * them with the routes.
 */
export interface AiImportAccess {
  resource: string;
  level: PermissionLevel;
  /** A module the route also reads (the application links read applications). */
  alsoReads?: string;
  /** Refused to a person whose access is limited. */
  reservedToUnscoped: boolean;
}

export const AI_IMPORT_ACCESS: Readonly<Record<AiImportKey, AiImportAccess>> = {
  applications: { resource: 'applications', level: 'admin', reservedToUnscoped: false },
  assets: { resource: 'infrastructure', level: 'admin', reservedToUnscoped: false },
  portfolio_projects: { resource: 'portfolio_projects', level: 'admin', reservedToUnscoped: false },
  portfolio_requests: { resource: 'portfolio_requests', level: 'admin', reservedToUnscoped: false },
  tasks: { resource: 'tasks', level: 'admin', reservedToUnscoped: true },
  incidents: { resource: 'incidents', level: 'contributor', reservedToUnscoped: false },
  budget_lines: { resource: 'budget', level: 'admin', reservedToUnscoped: false },
  contracts: { resource: 'contracts', level: 'admin', reservedToUnscoped: true },
  suppliers: { resource: 'suppliers', level: 'admin', reservedToUnscoped: true },
  contacts: { resource: 'contacts', level: 'admin', reservedToUnscoped: true },
  companies: { resource: 'companies', level: 'admin', reservedToUnscoped: true },
  departments: { resource: 'departments', level: 'admin', reservedToUnscoped: true },
  cost_centers: { resource: 'cost_centers', level: 'admin', reservedToUnscoped: true },
  accounts: { resource: 'accounts', level: 'admin', reservedToUnscoped: true },
  analytics_categories: { resource: 'analytics', level: 'admin', reservedToUnscoped: true },
  business_processes: { resource: 'business_processes', level: 'admin', reservedToUnscoped: true },
  working_day_calendars: { resource: 'working_day_profiles', level: 'admin', reservedToUnscoped: false },
  technology_asset_links: { resource: 'infrastructure', level: 'member', reservedToUnscoped: false },
  technology_application_links: { resource: 'infrastructure', level: 'member', alsoReads: 'applications', reservedToUnscoped: false },
};

/** The rights of an import named by its key, null for an unknown one. */
/**
 * The imports that replace every value of a record they update, a blank cell clearing it, and read
 * every column of their template: the master data imports and the technology links. The other imports
 * run in the screen's "merge" mode, where a blank cell keeps the stored value.
 */
export const AI_IMPORT_WHOLE_ROWS: ReadonlySet<AiImportKey> = new Set<AiImportKey>([
  'contracts', 'suppliers', 'contacts', 'companies', 'departments', 'cost_centers', 'accounts',
  'analytics_categories', 'business_processes', 'working_day_calendars',
  'technology_asset_links', 'technology_application_links',
]);

export function aiImportAccess(key: unknown): AiImportAccess | null {
  const normalized = String(key ?? '').trim();
  return Object.prototype.hasOwnProperty.call(AI_IMPORT_ACCESS, normalized) ? AI_IMPORT_ACCESS[normalized as AiImportKey] : null;
}

/** The modules the imports belong to, once each. */
export const AI_IMPORT_RESOURCES: readonly string[] = [...new Set(Object.values(AI_IMPORT_ACCESS).map((access) => access.resource))];
