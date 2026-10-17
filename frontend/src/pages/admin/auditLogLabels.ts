import { foldText } from '../../utils/foldText';

/**
 * Plain-language labels of the audit log: the tables it names (`auditLogs.tableNames.<table>`)
 * and its sign-in, session and export rows (backend `audit/security-events.ts`). The codes stay
 * as stored; the page shows these labels (`admin` namespace, `auditLogs.*`), and an unknown code
 * shows as it is. Every audited table has a label (auditTableNames.test.ts).
 */

/** `table_name` of sign-in and session events. */
export const AUTH_EVENT_TABLE = 'auth';
/** `table_name` of exports. */
export const EXPORT_EVENT_TABLE = 'export';

/** The actions of sign-in, session and export rows (`auditLogs.actions.<action>`). */
export const AUDIT_EVENT_ACTIONS = [
  'login',
  'login_failed',
  'logout',
  'refresh_denied',
  'password_reset_requested',
  'password_reset_completed',
  'sso_login',
  'sso_login_failed',
  'mcp_connection_refused',
  'export',
] as const;

/** Why a sign-in or session request was refused, or how a sign-in was made (`source_ref` of `auth` rows). */
export const AUTH_EVENT_REASONS = [
  'bad_password',
  'unknown_user',
  'no_password',
  'disabled',
  'not_allowed',
  'invalid_token',
  'expired',
  'external_account',
  'email_not_sent',
  'tenant_mismatch',
  'sso_not_configured',
  'email_unverified',
  'invalid_state',
  'sso_failed',
  'provisioning',
  'too_many_attempts',
] as const;

/**
 * What an export row exported (`after_json.resource`), to its label key
 * (`auditLogs.exportResources.<key>`). One entry per export route of the API.
 */
export const EXPORT_RESOURCE_KEYS: Readonly<Record<string, string>> = {
  accounts: 'accounts',
  'admin/coa-templates': 'coaTemplates',
  'analytics-categories': 'analyticsCategories',
  applications: 'applications',
  assets: 'assets',
  'audit-logs': 'auditLog',
  'budget-lines/budget-file': 'budgetFile',
  'business-processes': 'businessProcesses',
  'capex-items/budget-file': 'capexBudgetFile',
  'chart-of-accounts/accounts': 'chartOfAccounts',
  companies: 'companies',
  contacts: 'contacts',
  contracts: 'contracts',
  'contracts/compliance-register': 'contractComplianceRegister',
  'cost-centers': 'costCenters',
  departments: 'departments',
  document: 'document',
  incidents: 'incidents',
  'incidents/report': 'incidentReport',
  knowledge: 'knowledgeDocument',
  'portfolio/projects': 'projects',
  'portfolio/reports/weekly': 'weeklyReport',
  'portfolio/requests': 'requests',
  'spend-items/budget-file': 'opexBudgetFile',
  suppliers: 'suppliers',
  tasks: 'tasks',
  'technologies/applications': 'technologyApplications',
  'technologies/reports/end-of-support': 'endOfSupportReport',
  users: 'users',
  vulnerabilities: 'vulnerabilities',
  'working-day-profiles': 'workingDayCalendars',
};

/** The label key of an export row's resource, or null for a resource without one. */
export function exportResourceKey(resource: unknown): string | null {
  if (typeof resource !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(EXPORT_RESOURCE_KEYS, resource) ? EXPORT_RESOURCE_KEYS[resource] : null;
}

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The search parameter carrying the table codes whose label matches the search (backend `parseSearchTables`). */
export const SEARCH_TABLES_PARAM = 'q_tables';

/**
 * The tables whose label, in the reader's language, holds the searched text ("fournisseur" →
 * `supplier_contacts`, `suppliers`), accents and case aside, as the server folds a search. The
 * server matches the stored codes only: the page sends these codes with the search. Nothing for a
 * text under two characters, which the codes already match.
 */
export function auditTablesMatchingSearch(q: string | null | undefined, t: Translate): string[] {
  const text = foldText(String(q ?? '').trim());
  if (text.length < 2) return [];
  const labels = (t as unknown as (key: string, options: { returnObjects: true }) => unknown)('auditLogs.tableNames', { returnObjects: true });
  if (!labels || typeof labels !== 'object') return [];
  return Object.entries(labels as Record<string, unknown>)
    .filter(([, label]) => typeof label === 'string' && foldText(label).includes(text))
    .map(([code]) => code)
    .sort();
}

/** The search parameters of a text: the codes of the matching tables, when there are some. */
export function auditSearchParams(q: string | null | undefined, t: Translate): Record<string, string> {
  const codes = auditTablesMatchingSearch(q, t);
  return codes.length > 0 ? { [SEARCH_TABLES_PARAM]: codes.join(',') } : {};
}

/** The fields of an audit row the labels read. */
export type AuditRowLike = {
  table_name?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  source?: string | null;
  source_ref?: string | null;
  after_json?: any;
};

/** The person of a row: their name (their address only when they have no name), else who or what wrote it. */
export function auditUserLabel(row: AuditRowLike | null | undefined, t: Translate): string {
  if (!row) return '';
  if (row.user_name) return row.user_name;
  if (row.user_email) return row.user_email;
  if (row.user_id) {
    const id = String(row.user_id).slice(0, 8);
    return t('auditLogs.values.unknownUser', { id, defaultValue: `Unknown (${id}...)` });
  }
  // A sign-in attempt that named no account of the workspace.
  if (row.table_name === AUTH_EVENT_TABLE) return t('auditLogs.values.unknownAccount');
  if (String(row.source || '').toLowerCase() === 'webhook') return t('auditLogs.sources.webhook');
  return t('auditLogs.sources.system');
}

/** The table cell: what an export exported, else the table's label. */
export function auditTableLabel(row: AuditRowLike | null | undefined, t: Translate): string {
  const table = String(row?.table_name || '');
  if (table === EXPORT_EVENT_TABLE) {
    const key = exportResourceKey(row?.after_json?.resource);
    return key ? t(`auditLogs.exportResources.${key}`) : t(`auditLogs.tableNames.${EXPORT_EVENT_TABLE}`);
  }
  return auditTableFilterLabel(table, t);
}

/** A table in the reader's language (the table filter, the detail): its label, else the stored name. */
export function auditTableFilterLabel(table: string | null, t: Translate): string {
  if (!table) return t('auditLogs.shared.empty');
  return t(`auditLogs.tableNames.${table}`, { defaultValue: table });
}

/** The reason of a sign-in or session event in plain language; other rows keep their reference. */
export function auditReasonLabel(row: AuditRowLike | null | undefined, t: Translate): string {
  const ref = row?.source_ref ?? '';
  if (!ref) return '';
  if (row?.table_name !== AUTH_EVENT_TABLE) return ref;
  return t(`auditLogs.reasons.${ref}`, { defaultValue: ref });
}
