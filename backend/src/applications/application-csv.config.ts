import { catalogFromMetadata, catalogToMetadata } from '../it-ops-settings/classification-catalog';
import { findCatalogOption, requireImportCatalogs, resolveCatalogCode } from '../it-ops-settings/catalog-resolve';
import { APPLICATION_NAME_MAX, applicationNameKey, assertApplicationDates, codedErrorOf } from './application-rules';
import { CLASSIFICATION_INPUT_FIELDS, classificationPatch } from './services/application-classification';
import {
  ArrayStrategy,
  CsvEntityConfig,
  CsvFieldDefinition,
  CsvFieldType,
  CsvExportContext,
  CsvImportContext,
  CsvImportRow,
} from '../common/csv';
import { vulnerabilityCsvFields } from '../vulnerabilities/vulnerability-list-column';
import { assertMarkdownSize } from '../common/markdown-limits';
import { sameStoredValues } from '../common/csv-sheet/unchanged';
import { formatApplicationCategoryOptions, ItOpsSettings } from '../it-ops-settings/it-ops-settings.service';

const OWNER_COLUMN = /^(business|it)_owner_email_/;

/** The status as the screen names it, in the language of the file. */
const APPLICATION_STATUS_LABELS: Record<CsvExportContext['language'], Record<string, string>> = {
  en: { enabled: 'Enabled', disabled: 'Disabled' },
  fr: { enabled: 'Activé', disabled: 'Désactivé' },
  de: { enabled: 'Aktiviert', disabled: 'Deaktiviert' },
  es: { enabled: 'Activado', disabled: 'Desactivado' },
};

function resolveApplicationCatalogs(entity: any, settings: ItOpsSettings): void {
  if (entity.category) entity.category = resolveCatalogCode(entity.category, settings.applicationCategories);
  if (entity.lifecycle) entity.lifecycle = resolveCatalogCode(entity.lifecycle, settings.lifecycleStates);
  if (Array.isArray(entity.access_methods)) entity.access_methods = entity.access_methods.map((item: string) => resolveCatalogCode(item, settings.accessMethods) ?? item);
}

const OWNER_TYPES = ['business', 'it'] as const;

/** The non-empty owner cells of a row, by owner type; a type whose columns are all absent is left out. */
function ownerCells(raw: Record<string, string>): Map<'business' | 'it', string[]> {
  const cells = new Map<'business' | 'it', string[]>();
  for (const ownerType of OWNER_TYPES) {
    const columns = [1, 2, 3, 4].map((i) => `${ownerType}_owner_email_${i}`).filter((column) => column in raw);
    if (columns.length) cells.set(ownerType, columns.map((column) => (raw[column] || '').trim().toLowerCase()).filter(Boolean));
  }
  return cells;
}

/**
 * The owners a row leaves on an application, as `owner_type:user_id`. Per owner type, the emails
 * the columns name; when every cell of a type is empty, the stored owners of that type stay, except
 * in replace mode where they go. Unknown emails are refused before (`owner_email_unknown`).
 */
export function csvOwnerKeys(
  raw: Record<string, string>,
  userByEmail: Map<string, string>,
  stored: string[] = [],
  mode: 'replace' | 'enrich' = 'enrich',
): string[] {
  const cells = ownerCells(raw);
  const keys: string[] = [];
  for (const ownerType of OWNER_TYPES) {
    const emails = cells.get(ownerType);
    if (!emails || (emails.length === 0 && mode !== 'replace')) {
      keys.push(...stored.filter((key) => key.startsWith(`${ownerType}:`)));
      continue;
    }
    for (const email of emails) {
      const userId = userByEmail.get(email);
      if (userId && !keys.includes(`${ownerType}:${userId}`)) keys.push(`${ownerType}:${userId}`);
    }
  }
  return keys;
}

/** The tenant's users by lower-case email. */
export async function usersByEmail(manager: any, tenantId: string): Promise<Map<string, string>> {
  const users = await manager.query(`SELECT id, email FROM users WHERE tenant_id = $1`, [tenantId]);
  return new Map<string, string>(users.map((u: any) => [String(u.email).toLowerCase(), u.id]));
}

/**
 * The checks the API applies, run on every row in the dry run and the load alike: unknown owner
 * emails, catalog values matching no code or name, names (too long, taken, ambiguous), dates out of
 * order and a suite unchecked while it has children.
 */
async function validateApplicationRows(rows: CsvImportRow[], context: CsvImportContext, settings: ItOpsSettings): Promise<void> {
  const fail = (row: CsvImportRow, code: string, message: string, params?: Record<string, string | number>, column?: string) =>
    row.errors.push({ row: row.rowNumber, ...(column ? { column } : {}), message, code, ...(params ? { params } : {}) });
  const userByEmail = await usersByEmail(context.manager, context.tenantId);
  const keys = [...new Set(rows.map((row) => applicationNameKey(row.raw.name)).filter(Boolean))];
  const holders: Array<{ id: string; name: string; sequential_id: string | null; key: string }> = keys.length === 0 ? [] : await context.manager.query(
    `SELECT id::text AS id, name, sequential_id, lower(btrim(name)) AS key
       FROM applications WHERE tenant_id = $1 AND lower(btrim(name)) = ANY($2)
      ORDER BY created_at ASC, id ASC`,
    [context.tenantId, keys],
  );
  const holdersByKey = new Map<string, typeof holders>();
  for (const holder of holders) holdersByKey.set(holder.key, [...(holdersByKey.get(holder.key) ?? []), holder]);
  const unsuited = rows.filter((row) => row.existingEntity?.is_suite && row.parsed.is_suite === false).map((row) => row.existingEntity.id);
  const children: Array<{ suite_id: string; count: number }> = unsuited.length === 0 ? [] : await context.manager.query(
    `SELECT suite_id::text AS suite_id, count(*)::int AS count FROM application_suites WHERE tenant_id = $1 AND suite_id = ANY($2) GROUP BY suite_id`,
    [context.tenantId, unsuited],
  );
  const childCount = new Map(children.map((row) => [row.suite_id, row.count]));
  const catalogAllowed = {
    lifecycle: formatApplicationCategoryOptions(settings.lifecycleStates),
    category: formatApplicationCategoryOptions(settings.applicationCategories),
  };

  for (const row of rows) {
    const name = String(row.raw.name ?? '').trim();
    const existing = row.existingEntity;
    const named = holdersByKey.get(applicationNameKey(name)) ?? [];
    if (name.length > APPLICATION_NAME_MAX) {
      fail(row, 'name_too_long', `name must be at most ${APPLICATION_NAME_MAX} characters`, { max: APPLICATION_NAME_MAX }, 'name');
    } else if (name && !existing && named.length) {
      fail(row, 'name_taken', `Another application is already named "${named[0].name}"`, { name: named[0].name, ref: named[0].sequential_id || named[0].name }, 'name');
    } else if (name && existing) {
      const matchedById = String(row.raw.id ?? '').trim() === String(existing.id);
      const others = named.filter((holder) => holder.id !== String(existing.id));
      if (!matchedById && named.length > 1) {
        fail(row, 'name_ambiguous', `${named.length} applications are named "${name}"; add the id column to choose one`, { name, count: named.length }, 'name');
      } else if (matchedById && others.length && applicationNameKey(name) !== applicationNameKey(existing.name)) {
        fail(row, 'name_taken', `Another application is already named "${others[0].name}"`, { name: others[0].name, ref: others[0].sequential_id || others[0].name }, 'name');
      }
    }

    for (const [column, options, code] of [['lifecycle', settings.lifecycleStates, 'lifecycle_invalid'], ['category', settings.applicationCategories, 'category_invalid']] as const) {
      const value = String(row.raw[column] ?? '').trim();
      if (!value) continue;
      let found = null;
      try { found = findCatalogOption(value, options as any[]); } catch { found = null; }
      if (!found) {
        const allowed = catalogAllowed[column];
        fail(row, code, `Unknown ${column} "${value}"; use a code or a name of the catalog: ${allowed}`, { value, allowed }, column);
      }
    }

    for (const ownerType of OWNER_TYPES) {
      for (const email of ownerCells(row.raw).get(ownerType) ?? []) {
        if (!userByEmail.has(email)) fail(row, 'owner_email_unknown', `No user with the email ${email}`, { email });
      }
    }

    const date = (field: string) => (field in row.parsed ? row.parsed[field] : existing?.[field]);
    try {
      assertApplicationDates({ go_live_date: date('go_live_date'), end_of_support_date: date('end_of_support_date'), retired_date: date('retired_date') });
    } catch (error: any) {
      fail(row, 'dates_inconsistent', error.message, codedErrorOf(error).params);
    }

    const count = existing ? childCount.get(String(existing.id)) ?? 0 : 0;
    if (count > 0) fail(row, 'suite_has_children', `Detach the ${count} child applications first`, { count }, 'is_suite');
  }
}

/** The ISO country codes of a `data_residency` cell. */
export function csvResidencyCodes(value: string | undefined): string[] {
  return [...new Set((value || '').split(',').map((code) => code.trim().toUpperCase()).filter((code) => code.length === 2))];
}

/** Same members, in any order. */
export function sameKeys(a: string[] | undefined, b: string[]): boolean {
  const left = [...new Set(a ?? [])].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((key, i) => key === right[i]);
}

function groupKeys<T>(rows: T[], id: (row: T) => string, key: (row: T) => string): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const row of rows) byId.set(id(row), [...(byId.get(id(row)) ?? []), key(row)]);
  return byId;
}

/** A classification field the import reads (`__CLEAR__` in a cell empties it). */
function classificationField(field: string): CsvFieldDefinition {
  return {
    csvColumn: field, entityProperty: field, type: CsvFieldType.STRING, required: false, defaultExport: true,
    label: field.endsWith('_minutes') ? `${field} (integer minutes; __CLEAR__ to clear)` : `${field} (__CLEAR__ to clear)`, group: 'Classification',
  };
}

/** A field of the classification review: export only. */
function classificationReviewField(field: string): CsvFieldDefinition {
  return {
    csvColumn: field, entityProperty: field, type: CsvFieldType.STRING, importable: false, exportable: true, defaultExport: false, label: field, group: 'Classification',
  };
}

/**
 * CSV configuration for Applications entity (V2)
 *
 * Changes from V1:
 * - Owner emails use numbered columns (business_owner_email_1..4, it_owner_email_1..4)
 * - Removed deprecated fields: hosting_model, sso_enabled, mfa_supported, environment (use AppInstance)
 *
 * Column order: id, reference (APP-n, export only), name, then ApplicationWorkspacePage.tsx tab by tab:
 * - Overview: description, lifecycle, properties (category to retirement), owners, users, support notes
 * - Operations: access methods, external facing, ETL, suite, vulnerabilities
 * - Compliance: the classification panel, top to bottom
 * - Not on the workspace: status, licensing, notes, timestamps
 */
export const applicationCsvConfig: CsvEntityConfig = {
  entityName: 'application',
  // The sheet of an xlsx export: the list's title on screen.
  sheetNames: { en: 'Applications', fr: 'Applications', de: 'Anwendungen', es: 'Aplicaciones' },
  tableName: 'applications',
  displayName: 'Applications',
  upsertKey: ['name'],
  // Same rule as the unique names: `lower(btrim(name))`.
  upsertKeyIgnoresOuterSpaces: true,
  fields: [
    // === IDENTITY ===
    {
      csvColumn: 'id',
      entityProperty: 'id',
      type: CsvFieldType.STRING,
      isIdentityColumn: true,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'ID',
      group: 'Identity',
    },
    {
      // The business reference the list shows (APP-n): export only, ignored on import.
      csvColumn: 'reference',
      entityProperty: 'sequential_id',
      type: CsvFieldType.STRING,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Reference',
      group: 'Identity',
    },
    {
      csvColumn: 'name',
      entityProperty: 'name',
      type: CsvFieldType.STRING,
      required: true,
      defaultExport: true,
      label: 'Name',
      group: 'Overview',
    },

    // === OVERVIEW TAB (header, description, properties, support) ===
    {
      csvColumn: 'description',
      entityProperty: 'description',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Description',
      group: 'Overview',
      // The description is the source of the overview document: same size limit as on the page.
      importTransformFn: (value: string) => {
        assertMarkdownSize(value, 'description');
        return value;
      },
    },
    {
      csvColumn: 'lifecycle',
      entityProperty: 'lifecycle',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Lifecycle',
      group: 'Overview',
    },
    {
      csvColumn: 'category',
      entityProperty: 'category',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Category',
      group: 'Overview',
    },
    {
      csvColumn: 'supplier_name',
      entityProperty: 'supplier_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'suppliers',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Supplier',
      group: 'Overview',
    },
    {
      csvColumn: 'editor',
      entityProperty: 'editor',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Publisher',
      group: 'Overview',
    },
    {
      csvColumn: 'version',
      entityProperty: 'version',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Version',
      group: 'Version',
    },
    {
      csvColumn: 'go_live_date',
      entityProperty: 'go_live_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Go Live Date',
      group: 'Version',
    },
    {
      csvColumn: 'end_of_support_date',
      entityProperty: 'end_of_support_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'End of Support Date',
      group: 'Version',
    },
    {
      csvColumn: 'retired_date',
      entityProperty: 'retired_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: false,
      label: 'Retired Date',
      group: 'Version',
    },
    // These fields use COMPUTED for export (reading from _owners) but are importable
    // Import is handled by handleOwnerImport in the service
    {
      csvColumn: 'business_owner_email_1',
      entityProperty: '_owners',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Business Owner 1 Email',
      group: 'Owners',
      exportFn: (entity: any) => {
        const owners = entity._owners || [];
        const business = owners.filter((o: any) => o.owner_type === 'business');
        return business[0]?.user?.email || '';
      },
    },
    {
      csvColumn: 'business_owner_email_2',
      entityProperty: '_owners',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Business Owner 2 Email',
      group: 'Owners',
      exportFn: (entity: any) => {
        const owners = entity._owners || [];
        const business = owners.filter((o: any) => o.owner_type === 'business');
        return business[1]?.user?.email || '';
      },
    },
    {
      csvColumn: 'business_owner_email_3',
      entityProperty: '_owners',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Business Owner 3 Email',
      group: 'Owners',
      exportFn: (entity: any) => {
        const owners = entity._owners || [];
        const business = owners.filter((o: any) => o.owner_type === 'business');
        return business[2]?.user?.email || '';
      },
    },
    {
      csvColumn: 'business_owner_email_4',
      entityProperty: '_owners',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Business Owner 4 Email',
      group: 'Owners',
      exportFn: (entity: any) => {
        const owners = entity._owners || [];
        const business = owners.filter((o: any) => o.owner_type === 'business');
        return business[3]?.user?.email || '';
      },
    },
    {
      csvColumn: 'it_owner_email_1',
      entityProperty: '_owners',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'IT Owner 1 Email',
      group: 'Owners',
      exportFn: (entity: any) => {
        const owners = entity._owners || [];
        const it = owners.filter((o: any) => o.owner_type === 'it');
        return it[0]?.user?.email || '';
      },
    },
    {
      csvColumn: 'it_owner_email_2',
      entityProperty: '_owners',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'IT Owner 2 Email',
      group: 'Owners',
      exportFn: (entity: any) => {
        const owners = entity._owners || [];
        const it = owners.filter((o: any) => o.owner_type === 'it');
        return it[1]?.user?.email || '';
      },
    },
    {
      csvColumn: 'it_owner_email_3',
      entityProperty: '_owners',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'IT Owner 3 Email',
      group: 'Owners',
      exportFn: (entity: any) => {
        const owners = entity._owners || [];
        const it = owners.filter((o: any) => o.owner_type === 'it');
        return it[2]?.user?.email || '';
      },
    },
    {
      csvColumn: 'it_owner_email_4',
      entityProperty: '_owners',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'IT Owner 4 Email',
      group: 'Owners',
      exportFn: (entity: any) => {
        const owners = entity._owners || [];
        const it = owners.filter((o: any) => o.owner_type === 'it');
        return it[3]?.user?.email || '';
      },
    },
    {
      csvColumn: 'users_mode',
      entityProperty: 'users_mode',
      type: CsvFieldType.ENUM,
      enumValues: ['manual', 'it_users', 'headcount'],
      exportable: true,
      importable: false,
      defaultExport: false,
      label: 'Users Mode',
      group: 'Users',
    },
    {
      csvColumn: 'users_year',
      entityProperty: 'users_year',
      type: CsvFieldType.NUMBER,
      exportable: true,
      importable: false,
      defaultExport: false,
      label: 'Users Year',
      group: 'Users',
    },
    {
      csvColumn: 'users_override',
      entityProperty: 'users_override',
      type: CsvFieldType.NUMBER,
      exportable: true,
      importable: false,
      defaultExport: false,
      label: 'Users Override',
      group: 'Users',
    },
    {
      csvColumn: 'support_notes',
      entityProperty: 'support_notes',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Support Notes',
      group: 'Technical',
    },

    // === OPERATIONS TAB ===
    {
      csvColumn: 'access_methods',
      entityProperty: 'access_methods',
      type: CsvFieldType.ARRAY,
      arrayStrategy: ArrayStrategy.COMMA_SEPARATED,
      required: false,
      defaultExport: false,
      label: 'Access Methods',
      group: 'Technical',
    },
    {
      csvColumn: 'external_facing',
      entityProperty: 'external_facing',
      type: CsvFieldType.BOOLEAN,
      required: false,
      defaultExport: true,
      label: 'External Facing',
      group: 'Technical',
    },
    {
      csvColumn: 'etl_enabled',
      entityProperty: 'etl_enabled',
      type: CsvFieldType.BOOLEAN,
      required: false,
      defaultExport: false,
      label: 'Data Integration / ETL',
      group: 'Technical',
    },
    {
      csvColumn: 'is_suite',
      entityProperty: 'is_suite',
      type: CsvFieldType.BOOLEAN,
      required: false,
      defaultExport: false,
      label: 'Can Have Child Apps',
      group: 'Overview',
    },
    ...vulnerabilityCsvFields('Vulnerabilities'),

    // === COMPLIANCE TAB ===
    {
      csvColumn: 'criticality',
      entityProperty: 'criticality',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Business criticality (code or name; __CLEAR__ to clear)',
      group: 'Overview',
    },
    classificationField('cyber_criticality'),
    {
      csvColumn: 'data_class',
      entityProperty: 'data_class',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Data confidentiality',
      group: 'Compliance',
    },
    {
      csvColumn: 'contains_pii',
      entityProperty: 'contains_pii',
      type: CsvFieldType.BOOLEAN,
      required: false,
      defaultExport: true,
      label: 'Contains PII',
      group: 'Compliance',
    },
    {
      csvColumn: 'data_residency',
      entityProperty: '_data_residency_csv',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      defaultExport: true,
      label: 'Data Residency (ISO codes)',
      group: 'Compliance',
      exportFn: (entity: any, context: CsvExportContext) => {
        const residency = entity._dataResidency;
        if (Array.isArray(residency)) {
          return residency.map((r: any) => r.country_iso).join(', ');
        }
        return '';
      },
    },
    classificationField('recovery_wave'),
    classificationField('rto_minutes'),
    classificationField('rpo_minutes'),
    {
      csvColumn: 'last_dr_test',
      entityProperty: 'last_dr_test',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: false,
      label: 'Last DR Test',
      group: 'Compliance',
    },
    classificationField('classification_justification'),
    classificationReviewField('classification_revision'),
    classificationReviewField('classification_review_state'),
    classificationReviewField('classification_reviewed_at'),

    // === NOT ON THE WORKSPACE ===
    {
      csvColumn: 'status',
      entityProperty: 'status',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Status',
      group: 'Overview',
      exportFn: (entity: any, context: CsvExportContext) => {
        const status = String(entity.status ?? '');
        return APPLICATION_STATUS_LABELS[context.language]?.[status] ?? status;
      },
    },
    {
      csvColumn: 'licensing',
      entityProperty: 'licensing',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Licensing',
      group: 'Other',
    },
    {
      csvColumn: 'notes',
      entityProperty: 'notes',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Notes',
      group: 'Other',
    },
    {
      csvColumn: 'created_at',
      entityProperty: 'created_at',
      type: CsvFieldType.DATE,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Created At',
      group: 'Timestamps',
    },
    {
      csvColumn: 'updated_at',
      entityProperty: 'updated_at',
      type: CsvFieldType.DATE,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Updated At',
      group: 'Timestamps',
    },
  ],

  // Export presets
  exportPresets: [
    {
      name: 'enrichment',
      label: 'Data Enrichment',
      // Only importable fields - excludes computed fields like data_residency, created_at, updated_at
      fields: [
        'id', 'name', 'description', 'category', 'supplier_name', 'editor',
        'criticality', 'cyber_criticality', 'recovery_wave', 'rto_minutes', 'rpo_minutes', 'classification_justification', 'lifecycle', 'is_suite',
        'version', 'go_live_date', 'end_of_support_date', 'retired_date',
        'licensing', 'notes',
        'access_methods', 'external_facing', 'etl_enabled', 'support_notes',
        'data_class', 'last_dr_test', 'contains_pii',
        'business_owner_email_1', 'business_owner_email_2', 'business_owner_email_3', 'business_owner_email_4',
        'it_owner_email_1', 'it_owner_email_2', 'it_owner_email_3', 'it_owner_email_4',
      ],
    },
  ],

  /**
   * Hook to resolve settings-backed and enum fields before commit.
   * Accepts both codes and labels for: category, lifecycle, data_class, criticality
   */
  afterValidate: async (rows, context) => {
    const settings = await requireImportCatalogs(context);
    const catalog = catalogFromMetadata(catalogToMetadata(settings));
    await validateApplicationRows(rows, context, settings);
    for (const row of rows) {
      // Persist this through the relation handler, never as an application column.
      delete row.parsed._data_residency_csv;
      // The yes/no and the day as their typed columns read them, in the language of the file.
      const typed = { contains_pii: row.parsed.contains_pii, last_dr_test: row.parsed.last_dr_test };
      // Empty and absent classification cells preserve values in BOTH modes, rows in error included.
      for (const field of CLASSIFICATION_INPUT_FIELDS) delete row.parsed[field];
      if (row.errors.length) continue;
      const input: Record<string, any> = {};
      for (const field of CLASSIFICATION_INPUT_FIELDS) {
        const raw = row.raw[field];
        if (raw === undefined || raw === null || String(raw).trim() === '') continue;
        if (String(raw).trim() === '__CLEAR__') input[field] = null;
        else if (field.endsWith('_minutes')) input[field] = Number(raw);
        else if (field === 'contains_pii' || field === 'last_dr_test') input[field] = typed[field];
        else input[field] = raw;
      }
      try { Object.assign(row.parsed, classificationPatch(input, row.existingEntity ?? null, catalog)); }
      catch (error: any) { row.errors.push({ row: row.rowNumber, message: error.message, ...codedErrorOf(error) }); }
    }
  },

  /**
   * The row as the commit stores it (catalog names resolved, classification patched), plus the
   * owners and the data residency ApplicationsCsvService writes after the import.
   */
  sameAsStored: async (rows, context) => {
    const settings = await requireImportCatalogs(context);
    const ids = rows.map((row) => row.existingEntity.id);
    const [owners, residency, users] = ids.length === 0 ? [[], [], []] : await Promise.all([
      context.manager.query(
        `SELECT application_id, user_id, owner_type FROM application_owners WHERE tenant_id = $1 AND application_id = ANY($2)`,
        [context.tenantId, ids],
      ),
      context.manager.query(
        `SELECT application_id, country_iso FROM application_data_residency WHERE tenant_id = $1 AND application_id = ANY($2)`,
        [context.tenantId, ids],
      ),
      usersByEmail(context.manager, context.tenantId),
    ]);
    const userByEmail = users as unknown as Map<string, string>;
    const ownersById = groupKeys(owners, (o: any) => o.application_id, (o: any) => `${o.owner_type}:${o.user_id}`);
    const residencyById = groupKeys(residency, (r: any) => r.application_id, (r: any) => String(r.country_iso).trim().toUpperCase());

    return rows.map((row) => {
      const stored = row.existingEntity;
      if (Object.keys(row.raw).some((key) => OWNER_COLUMN.test(key))) {
        const storedOwners = ownersById.get(stored.id) ?? [];
        if (!sameKeys(storedOwners, csvOwnerKeys(row.raw, userByEmail, storedOwners, context.params.mode))) return false;
      }
      // An empty residency cell keeps the stored countries, except in replace mode, where it clears them.
      const codes = csvResidencyCodes(row.raw.data_residency);
      const residencyWritten = codes.length > 0 || (row.raw.data_residency !== undefined && context.params.mode === 'replace');
      if (residencyWritten && !sameKeys(residencyById.get(stored.id), codes)) return false;

      const next = { ...row.parsed };
      delete next._owners;
      try {
        resolveApplicationCatalogs(next, settings);
      } catch {
        return false;
      }
      return sameStoredValues(stored, next);
    });
  },

  beforeCommit: async (entities: any[], context: CsvImportContext) => {
    // Effective catalogs (defaults included), the same ones the export writes names from.
    const settings = await requireImportCatalogs(context);
    for (const entity of entities) resolveApplicationCatalogs(entity, settings);
  },
};
