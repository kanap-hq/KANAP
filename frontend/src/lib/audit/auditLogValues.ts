import { DASH } from '../../components/workspace/relations/helpers';
import { countryNameFor } from '../../i18n/countries';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import { formatItemRef } from '../../utils/item-ref';
import type { Translate } from './auditLogLabels';

/**
 * The readable face of an audit entry: the field rows the detail dialog shows, the reference of
 * the record it names, and the display text of a field value. Pure helpers, tested alone.
 */

export type AuditPayloadRow = {
  action?: string | null;
  table_name?: string | null;
  record_id?: string | null;
  before_json?: any;
  after_json?: any;
};

export type AuditFieldRow = {
  key: string;
  before?: unknown;
  after?: unknown;
  value?: unknown;
};

export type AuditFields = {
  /** `change`: one row per changed field, two value columns. `single`: one value column. */
  mode: 'change' | 'single';
  rows: AuditFieldRow[];
};

/** The text of a value cell, its full value for a tooltip, and whether it is a secondary label. */
export type AuditValue = {
  text: string;
  title?: string;
  secondary?: boolean;
};

export type AuditValueContext = {
  locale: string;
  t: Translate;
  /** The payload around the value, to read a neighbouring label (`supplier_name` for `supplier_id`). */
  snapshot?: unknown;
  /** The names of the users the dialog read in one lookup. */
  users?: ReadonlyMap<string, string>;
  /** The audited table. `status` and `mode` name different lists on different tables. */
  table?: string;
  /**
   * The tenant's label of a code of an IT catalog list (`applicationCategories`, `serverRoles`...),
   * as the record's screen shows it, or null when the tenant's catalog has no such code. Without
   * it, a catalog code reads with the shipped label.
   */
  catalogLabel?: (list: AuditCatalogList, code: string) => string | null;
};

/** The IT catalog lists an audit value may name, with a tenant label (`useItOpsEnumOptions`). */
export type AuditCatalogList = 'applicationCategories' | 'accessMethods' | 'incidentCategories' | 'serverRoles';

/** The catalog list of a field, by table when the field name is shared. */
export function auditCatalogList(field: string, table: string | undefined): AuditCatalogList | null {
  if (field === 'category') {
    return table === 'applications' ? 'applicationCategories' : table === 'incidents' ? 'incidentCategories' : null;
  }
  if (field === 'access_methods') return 'accessMethods';
  if (field === 'server_role') return 'serverRoles';
  return null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MIDNIGHT_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.\d+)?(?:Z|\+00:00)$/i;
const JSON_MAX_LENGTH = 120;

/** Fields that hold a person: resolved through the user lookup, never shown as an id. */
const USER_ID_FIELDS = new Set([
  'user_id',
  'updated_by',
  'owner_user_id',
  'created_by',
  'created_by_user_id',
  'creator_id',
  'reporter_user_id',
  'requestor_id',
  'revoked_by_user_id',
]);

/** Noise that stays in the raw JSON (created_at stays in a create, where it is the record's date). */
const OMITTED_FIELDS = new Set(['id', 'tenant_id', 'updated_at']);
/** Derived or internal columns the table never shows; the raw JSON keeps them. */
const NOISE_FIELDS = new Set(['search_vector', 'content_plain']);

/** Numeric identifiers a thousands separator would misread (an account number is not a quantity). */
const NUMBER_IDENTIFIER_FIELDS = new Set(['account_number', 'consolidation_account_number']);

/** Tables whose record is named by `item_number`, and the reference prefix of each. */
const RECORD_ITEM_TYPES: Record<string, Parameters<typeof formatItemRef>[0]> = {
  documents: 'document',
  incidents: 'incident',
  portfolio_projects: 'project',
  portfolio_requests: 'request',
  portfolio_team_member_configs: 'contributor',
  spend_items: 'budget',
  tasks: 'task',
  technologies: 'technology',
};

/**
 * Tables whose reference is a text column that already holds it (`APP-12`, `AST-31`).
 * These tables have no `item_number`.
 */
const RECORD_TEXT_FIELDS: Record<string, string> = {
  applications: 'sequential_id',
  assets: 'asset_reference',
  locations: 'location_reference',
  connections: 'connection_reference',
  interfaces: 'interface_reference',
};

/**
 * Enumerations whose screen labels already exist. Status on an incident uses its own list
 * (`it:enums.incidentStatus`); every other status uses `common:statuses`, like `lifecycle`.
 * Codes with an underscore are stored in snake case and labelled in camelCase
 * (`on_premise` → `hostingModel.onPremise`, `pre_prod` → `environment.preProd`).
 */
const ENUM_GROUPS: Record<string, string> = {
  environment: 'it:enums.environment',
  criticality: 'it:enums.criticality',
  hosting_model: 'it:enums.hostingModel',
  severity: 'it:enums.incidentSeverity',
  // The IT landscape's fixed lists, named as their screens name them.
  topology: 'it:enums.topology',
  risk_mode: 'it:enums.riskMode',
  leg_type: 'it:enums.legType',
  integration_route_type: 'it:enums.routeType',
  direction: 'auditLogs.values.direction',
  owner_type: 'auditLogs.values.ownerType',
  // An application server's role, named as the IT settings name the shipped roles.
  server_role: 'it:catalogDefaults.serverRoles',
  // An application's access methods, named as the IT settings name the shipped methods.
  access_methods: 'it:catalogDefaults.accessMethods',
  // How an application counts its users, as its Ownership section names the two methods.
  users_mode: 'auditLogs.values.usersMode',
  // The budget history's own enumerations, named as the line screens name them.
  input_grain: 'auditLogs.values.inputGrain',
  allocation_method: 'auditLogs.values.allocationMethod',
  allocation_driver: 'auditLogs.values.allocationDriver',
  method: 'auditLogs.values.roundInputMethod',
  nature: 'auditLogs.values.nature',
  run_build: 'auditLogs.values.runBuild',
  role: 'auditLogs.values.contactRole',
  // The contact's own field: the same roles as a link's `role`, under the screen's "Contact type".
  supplier_role: 'auditLogs.values.contactRole',
  origin: 'auditLogs.values.origin',
  applies_to: 'auditLogs.values.lineTypeUsage',
  vulnerability_state: 'auditLogs.values.vulnerabilityState',
  cyber_criticality: 'auditLogs.values.cyberCriticality',
  recovery_wave: 'auditLogs.values.recoveryWave',
  // The contract's own lists, named as its screens name them.
  billing_frequency: 'ops:contracts.billing',
  compliance_state: 'ops:contracts.compliance.states',
  // A task's priority, named as the task screen names it.
  priority_level: 'portfolio:priority',
  // The IT landscape's enum values the record history reaches: the data class uses the
  // classification catalog's own labels, the interface data categories and the endpoint entity
  // codes the IT settings' shipped labels.
  data_class: 'classification-catalog:dataClasses',
  data_category: 'it:catalogDefaults.interfaceDataCategories',
  source_entity_code: 'it:catalogDefaults.entities',
  destination_entity_code: 'it:catalogDefaults.entities',
  equipment_entity_code: 'it:catalogDefaults.entities',
};

/** `spread_profile_name` holds `flat` and `4-4-5`; its keys cannot use the stored code as is. */
const SPREAD_PROFILE_KEYS: Record<string, string> = {
  flat: 'flat',
  '4-4-5': 'p445',
};

/**
 * `mode` follows the table. Data access is also named from its snapshot, earlier in
 * `formatAuditValue`, because that payload carries the nodes next to the mode.
 */
const MODE_LABEL_KEYS: Record<string, Record<string, string>> = {
  user_data_access: {
    all: 'auditLogs.dataAccess.allData',
    limited: 'auditLogs.dataAccess.limitedTo',
  },
  allocation_rules: {
    auto: 'ops:operations.allocationDefault.modeAuto',
    manual_company: 'ops:operations.allocationDefault.modeManual',
  },
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitted(key: string, action: string): boolean {
  if (OMITTED_FIELDS.has(key) || NOISE_FIELDS.has(key) || key.startsWith('__')) return true;
  return key === 'created_at' && action !== 'create';
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.length === 0;
}

function isYearField(field: string): boolean {
  return field === 'year' || field.endsWith('_year');
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Array.from(keys).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

/** A payload that is not an object (an array, a string…) cannot be read as fields. */
export function auditHasNonObjectPayload(row: AuditPayloadRow | null | undefined): boolean {
  if (!row) return false;
  return (row.before_json != null && !isPlainObject(row.before_json))
    || (row.after_json != null && !isPlainObject(row.after_json));
}

/** The rows of the field table: the changed keys of an update, else the fields of the one side present. */
export function auditFields(row: AuditPayloadRow | null | undefined): AuditFields {
  if (!row) return { mode: 'single', rows: [] };
  const action = String(row.action || '').toLowerCase();
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};

  if (action === 'update') {
    return {
      mode: 'change',
      rows: changedKeys(before, after)
        .filter((key) => !omitted(key, action))
        .filter((key) => !isEmptyValue(before[key]) || !isEmptyValue(after[key]))
        .map((key) => ({ key, before: before[key], after: after[key] })),
    };
  }

  const source = action === 'delete'
    ? before
    : (Object.keys(after).length > 0 ? after : before);
  return {
    mode: 'single',
    rows: Object.keys(source)
      .filter((key) => !omitted(key, action))
      .map((key) => ({ key, value: source[key] })),
  };
}

/** The payload the detail reads around a value: the after side wins, the before side fills what it no longer holds. */
export function auditSnapshot(row: AuditPayloadRow | null | undefined): Record<string, unknown> {
  const before = isPlainObject(row?.before_json) ? row.before_json : {};
  const after = isPlainObject(row?.after_json) ? row.after_json : {};
  return { ...before, ...after };
}

export function isUserIdField(field: string): boolean {
  return USER_ID_FIELDS.has(field) || field.endsWith('_user_id');
}

export function isUserIdValue(field: string, value: unknown): value is string {
  return isUserIdField(field) && typeof value === 'string' && value.trim() !== '';
}

/** The people named by the field rows, for the one lookup of the dialog. */
export function auditUserIds(fields: AuditFields): string[] {
  const ids = new Set<string>();
  for (const row of fields.rows) {
    for (const value of [row.before, row.after, row.value]) {
      if (isUserIdValue(row.key, value)) ids.add(value.trim());
    }
  }
  return Array.from(ids).sort();
}

function storedTextRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

/** The business reference of the audited record (T-4, APP-12, AST-31…), when the payload has one. */
export function auditRecordRef(row: AuditPayloadRow | null | undefined): string | null {
  if (!row) return null;
  const table = String(row.table_name || '');
  const type = RECORD_ITEM_TYPES[table];
  const textField = RECORD_TEXT_FIELDS[table];
  for (const snapshot of [row.after_json, row.before_json]) {
    if (!isPlainObject(snapshot)) continue;
    const itemNumber = snapshot.item_number;
    if (type && (typeof itemNumber === 'number' || typeof itemNumber === 'string') && itemNumber !== '' && Number.isFinite(Number(itemNumber))) {
      return formatItemRef(type, Number(itemNumber));
    }
    const ref = textField ? storedTextRef(snapshot[textField]) : null;
    if (ref) return ref;
  }
  return null;
}

/** The record header: the business reference, else the identifier label with the stored id in the title. */
export function auditRecordLabel(
  row: AuditPayloadRow | null | undefined,
  t: Translate,
): { text: string; title?: string } | null {
  if (!row) return null;
  const ref = auditRecordRef(row);
  if (ref) return { text: ref };
  if (!row.record_id) return null;
  return { text: t('auditLogs.values.identifier'), title: row.record_id };
}

function identifier(context: AuditValueContext, id: string): AuditValue {
  return { text: context.t('auditLogs.values.identifier'), title: id, secondary: true };
}

/** A readable neighbour of an id in the same payload (`supplier_id` → `supplier_name`), if any. */
function neighbourName(snapshot: unknown, field: string): string | null {
  if (!isPlainObject(snapshot) || !field.endsWith('_id')) return null;
  const base = field.slice(0, -3);
  for (const suffix of ['_name', '_label', '_title', '_ref', '_reference', '']) {
    const value = snapshot[`${base}${suffix}`];
    if (typeof value === 'string' && value.trim() && !UUID_PATTERN.test(value.trim())) return value.trim();
  }
  return null;
}

function dateText(value: string, locale: string): string | null {
  if (DATE_ONLY_PATTERN.test(value)) return formatShortDate(value, locale, { year: 'always' }) || null;
  // A UTC midnight is a date, not a time that shifts with the reader's timezone.
  if (MIDNIGHT_UTC_PATTERN.test(value)) {
    return formatShortDate(value.slice(0, 10), locale, { year: 'always' }) || null;
  }
  if (DATE_TIME_PATTERN.test(value)) return formatShortDateTime(value, locale) || null;
  return null;
}

function screenLabel(context: AuditValueContext, key: string): string | null {
  const value = context.t(key, { defaultValue: '' });
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text === key) return null;
  return text;
}

/**
 * Snake case as stored, camelCase as the IT enum keys name it. Status keys stay snake case, and so
 * do the catalog lists whose locale keys are the stored codes (`data_category`, entity codes) and
 * the classification catalog's `{ label, description }` rows (`data_class`).
 */
function enumerationCode(field: string, code: string): string {
  if (field === 'status' || field === 'lifecycle' || field === 'vulnerability_state'
    || field === 'data_class' || field === 'data_category' || field === 'compliance_state'
    || field === 'source_entity_code' || field === 'destination_entity_code' || field === 'equipment_entity_code'
    || field === 'access_methods') return code;
  return code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** The screen label of a known enumeration, or null so an unknown code stays as stored. */
function enumerationLabel(field: string, code: string, context: AuditValueContext): string | null {
  // A tenant catalog code: the tenant's own label first, as the screen shows it, then the shipped one.
  const catalog = auditCatalogList(field, context.table);
  const tenantLabel = catalog ? context.catalogLabel?.(catalog, code) : null;
  if (tenantLabel) return tenantLabel;
  // The classification catalog nests each code under `label`/`description`; the other groups map
  // the code straight to the label.
  if (field === 'data_class') {
    return screenLabel(context, `classification-catalog:dataClasses.${code}.label`);
  }
  if (field === 'provider' && context.table === 'assets') {
    // The asset's provider is a hosting type when set, a server provider otherwise.
    return screenLabel(context, `it:catalogDefaults.hostingTypes.${code}`)
      ?? screenLabel(context, `it:catalogDefaults.serverProviders.${code}`);
  }
  if (field === 'spread_profile_name') {
    const key = SPREAD_PROFILE_KEYS[code];
    return key ? screenLabel(context, `auditLogs.values.spreadProfile.${key}`) : null;
  }
  if (field === 'mode') {
    const key = MODE_LABEL_KEYS[context.table ?? '']?.[code];
    return key ? screenLabel(context, key) : null;
  }
  // The account "nature" is its "Used for" (OPEX only, CAPEX only), not the line's own nature;
  // the cost-center kind is its "Type", with the stored snake-case code as the locale key.
  if (field === 'kind' && context.table === 'cost_centers') {
    return screenLabel(context, `auditLogs.values.costCenterKind.${code}`);
  }
  if (field === 'kind' && context.table === 'assets') {
    return screenLabel(context, `auditLogs.values.assetKind.${code}`);
  }
  if (field === 'family') {
    return screenLabel(context, `auditLogs.values.technologyFamily.${code}`);
  }
  // An incident's category: the shipped categories of the IT settings, as the register names them.
  if (field === 'category' && context.table === 'incidents') {
    return screenLabel(context, `it:catalogDefaults.incidentCategories.${code}`);
  }
  // An application's category: the shipped categories of the IT settings, keyed by the stored code.
  if (field === 'category' && context.table === 'applications') {
    return screenLabel(context, `it:catalogDefaults.applicationCategories.${code}`);
  }
  if (field === 'hosting_type') {
    return screenLabel(context, `auditLogs.values.hostingType.${code}`);
  }
  // A task's time entry: IT or business time, named as the work log names it.
  if (field === 'category' && context.table === 'tasks') {
    return screenLabel(context, `portfolio:dialogs.logTime.categories.${code}`);
  }
  const group = field === 'status'
    ? (context.table === 'incidents'
      ? 'it:enums.incidentStatus'
      : context.table === 'documents'
        ? 'knowledge:statuses'
        : context.table === 'tasks' ? 'portfolio:statuses.task' : 'common:statuses')
    : field === 'lifecycle'
      ? 'common:statuses'
      : field === 'nature' && context.table === 'accounts'
        ? 'auditLogs.values.accountNature'
        : ENUM_GROUPS[field];
  if (!group) return null;
  return screenLabel(context, `${group}.${enumerationCode(field, code)}`);
}

/** The country fields the screens show as "France (FR)", name then code. */
const COUNTRY_FIELDS = new Set(['country_iso', 'country']);

function countryText(field: string, value: string, locale: string): string | null {
  if (!COUNTRY_FIELDS.has(field) || !/^[A-Za-z]{2}$/.test(value.trim())) return null;
  const code = value.trim().toUpperCase();
  const name = countryNameFor(locale)(code);
  return name && name !== code ? `${name} (${code})` : null;
}

function scalarText(value: unknown, field: string, context: AuditValueContext): string {
  if (value === null || value === undefined) return DASH;
  if (typeof value === 'boolean') {
    return context.t(value ? 'auditLogs.values.yes' : 'auditLogs.values.no');
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString(context.locale) : String(value);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return DASH;
    return countryText(field, text, context.locale)
      ?? dateText(text, context.locale)
      ?? enumerationLabel(field, text, context)
      ?? value;
  }
  return String(value);
}

function compactJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text : String(value);
  } catch {
    return String(value);
  }
}

function jsonValue(value: unknown): AuditValue {
  const text = compactJson(value);
  if (text.length <= JSON_MAX_LENGTH) return { text };
  return { text: `${text.slice(0, JSON_MAX_LENGTH - 1)}…`, title: text };
}

/** The before/after of a `user_data_access` entry: `{ mode, nodes: [{ type, name, code, access }] }`. */
function isDataAccessSnapshot(snapshot: unknown): snapshot is { mode?: unknown; nodes?: unknown } {
  return isPlainObject(snapshot)
    && (snapshot.mode === 'all' || snapshot.mode === 'limited')
    && Array.isArray(snapshot.nodes);
}

function dataAccessModeText(value: unknown, context: AuditValueContext): AuditValue | null {
  if (value === 'all') return { text: context.t('auditLogs.dataAccess.allData') };
  if (value === 'limited') return { text: context.t('auditLogs.dataAccess.limitedTo') };
  return null;
}

function dataAccessNodeText(value: unknown, context: AuditValueContext): string | null {
  if (!isPlainObject(value)) return null;
  const access = value.access === 'edit'
    ? context.t('auditLogs.dataAccess.edit')
    : context.t('auditLogs.dataAccess.read');
  if (value.type === 'all') {
    return context.t('auditLogs.dataAccess.node', {
      name: context.t('auditLogs.dataAccess.everything'),
      access,
    });
  }
  const name = typeof value.name === 'string' && value.name.trim()
    ? value.name
    : (typeof value.code === 'string' ? value.code : '');
  if (!name) return null;
  return context.t('auditLogs.dataAccess.node', { name, access });
}

function dataAccessNodesText(value: unknown[], context: AuditValueContext): AuditValue {
  const texts = value.map((node) => dataAccessNodeText(node, context)).filter((text): text is string => !!text);
  if (texts.length === 0) return { text: context.t('auditLogs.dataAccess.noNodes') };
  return { text: texts.join(', ') };
}

/**
 * The text of a value cell: empty marker, yes/no, short dates, locale numbers, scalar lists,
 * one-line JSON for objects, the name of a person or a readable neighbour instead of an id,
 * and the screen label of a known enumeration. A code with no label stays as stored.
 */
export function formatAuditValue(value: unknown, field: string, context: AuditValueContext): AuditValue {
  if (value === null || value === undefined) return { text: DASH };
  if (field === 'mode' && isDataAccessSnapshot(context.snapshot)) {
    const mode = dataAccessModeText(value, context);
    if (mode) return mode;
  }
  if (field === 'nodes' && Array.isArray(value) && isDataAccessSnapshot(context.snapshot)) {
    return dataAccessNodesText(value, context);
  }
  if (typeof value === 'boolean') return { text: context.t(value ? 'auditLogs.values.yes' : 'auditLogs.values.no') };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { text: String(value) };
    // A year or an account number is a label, not a quantity: 2026 and 1300, never 2,026 or 1,300.
    return {
      text: isYearField(field) || NUMBER_IDENTIFIER_FIELDS.has(field)
        ? String(value)
        : value.toLocaleString(context.locale),
    };
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return { text: DASH };
    if (isUserIdField(field)) {
      const neighbour = neighbourName(context.snapshot, field);
      if (neighbour) return { text: neighbour };
      const name = context.users?.get(text);
      return name ? { text: name } : identifier(context, text);
    }
    const country = countryText(field, text, context.locale);
    if (country) return { text: country };
    const date = dateText(text, context.locale);
    if (date) return { text: date };
    if (UUID_PATTERN.test(text)) {
      const neighbour = neighbourName(context.snapshot, field);
      return neighbour ? { text: neighbour } : identifier(context, text);
    }
    const label = enumerationLabel(field, text, context);
    if (label) return { text: label };
    return { text: value };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { text: DASH };
    const scalars = value.every((item) => item === null || item === undefined || ['string', 'number', 'boolean'].includes(typeof item));
    if (scalars) return { text: value.map((item) => scalarText(item, field, context)).join(', ') };
    return jsonValue(value);
  }
  if (typeof value === 'object') return jsonValue(value);
  return { text: String(value) };
}
