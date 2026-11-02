import type { EntityManager } from 'typeorm';
import { withFullDataAccess } from '../../data-access/full-data-access';
import type { TenantRequest } from '../../common/decorators/tenant.decorator';
import { hasLevel } from '../../common/relations/relations-access';
import {
  applicationParticipantCondition,
  projectParticipantCondition,
  requestParticipantCondition,
  resolveBusinessContributorScopeForUser,
  taskParticipantCondition,
  type ParticipationAccessScope,
} from '../../auth/business-contributor-scope';
import {
  incidentVisibilitySql,
  taskIncidentVisibilitySql,
  type IncidentViewer,
} from '../../incidents/incident-visibility';

/**
 * The reference families of the record history: every kind of record a history value may name,
 * with the module that reads its screen, the table it reads, the label and business reference shown
 * instead of an id, and the rule its own screen adds beyond the tenant predicate, RLS and data
 * access.
 *
 * A record entry (`record-history.inventory.ts`) names the family whose rule decides whether the
 * person may read the record, so the record check and the reference resolution share one source of
 * truth (`familyVisibilitySql`, `recordIsVisible`). The families are declared ahead of the record
 * entries that will use them: a family run adds its record file, not this file.
 *
 * A family without a screen of its own (people, the chart of accounts) still has a module: the
 * screen that shows it. `null` is for people, whose name every person reads.
 */
export type FamilyKey =
  | 'user'
  | 'company'
  | 'supplier'
  | 'chart_of_accounts'
  | 'account'
  | 'project'
  | 'request'
  | 'contract'
  | 'cost_center'
  | 'contact'
  | 'application'
  | 'technology'
  | 'asset'
  | 'task'
  | 'budget_line'
  | 'location'
  | 'sub_location'
  | 'connection'
  | 'interface'
  | 'incident'
  | 'department'
  | 'business_process'
  | 'calendar'
  | 'analytics_axis'
  | 'analytics_category'
  | 'contributor'
  | 'document'
  | 'document_folder'
  | 'document_library'
  | 'document_type'
  | 'portfolio_source'
  | 'portfolio_category'
  | 'portfolio_stream';

type ParticipationResource = 'applications' | 'portfolio_projects' | 'portfolio_requests' | 'tasks';

/**
 * The extra rule a family's own screen applies, beyond the tenant predicate, RLS and data access.
 * `scope`: the Business Contributor participation of that resource. `closedToScope`: the family is
 * not readable at all once that resource has a limited scope (the screen refuses the page).
 * `incident`: the row may name a confidential incident, which its screen hides from a viewer
 * outside the register's rule. `confidentialIncident`: the row is an incident and the register's
 * own confidentiality rule applies. `natures`: the family's table holds both natures of a budget
 * line, which `AGENTS.md` asks every query to name.
 */
export type FamilyCodeCheckKey = 'knowledge_document' | 'knowledge_folder' | 'knowledge_library';

type FamilyVisibility = {
  scope?: ParticipationResource;
  closedToScope?: ParticipationResource;
  incident?: boolean;
  confidentialIncident?: boolean;
  natures?: boolean;
  /**
   * The family is read by code, not SQL: the screen's right does not fit a predicate on the row
   * (the Knowledge library ACL, with its restricted libraries and member levels). `recordIsVisible`
   * and `loadReferences` hand the ids to the check instead of filtering the rows themselves.
   */
  check?: FamilyCodeCheckKey;
};

type ReferenceFamily = {
  /** The permission resource that reads the family; null: every person (people). */
  module: string | null;
  table: string;
  /** The label expression, on the alias `r`. */
  label: string;
  /** The business reference expression, when the family has one. */
  reference?: string;
  /** The screen's own visibility rule; empty for the families RLS and data access decide alone. */
  visibility: FamilyVisibility;
};

/** One readable row of a family: its label and, when it has one, its business reference. */
export type ReferenceRow = { id: string; label: string | null; reference?: string | null };

/**
 * The families a history value may name, and how one row of each reads: the label shown instead of
 * the id, and the business reference where the family has one. Every query runs under
 * `ctx.manager`, so a family the person does not read (module) or a record outside their access
 * (RLS, data access) comes back empty and shows as `{ hidden: true, kind }`.
 */
export const REFERENCE_FAMILIES: Readonly<Record<FamilyKey, ReferenceFamily>> = {
  user: {
    module: null,
    table: 'users',
    label: `COALESCE(NULLIF(trim(concat_ws(' ', r.first_name, r.last_name)), ''), r.email)`,
    visibility: {},
  },
  company: { module: 'companies', table: 'companies', label: 'r.name', visibility: {} },
  supplier: { module: 'suppliers', table: 'suppliers', label: 'r.name', visibility: {} },
  chart_of_accounts: {
    module: 'accounts',
    table: 'chart_of_accounts',
    label: `r.code || ' · ' || r.name`,
    visibility: {},
  },
  account: {
    module: 'accounts',
    table: 'accounts',
    label: `'[' || r.account_number || '] ' || r.account_name`,
    visibility: {},
  },
  project: {
    module: 'portfolio_projects',
    table: 'portfolio_projects',
    label: 'r.name',
    reference: `'PRJ-' || r.item_number`,
    visibility: { scope: 'portfolio_projects' },
  },
  request: {
    module: 'portfolio_requests',
    table: 'portfolio_requests',
    label: 'r.name',
    reference: `'REQ-' || r.item_number`,
    visibility: { scope: 'portfolio_requests' },
  },
  contract: { module: 'contracts', table: 'contracts', label: 'r.name', visibility: {} },
  cost_center: { module: 'cost_centers', table: 'cost_centers', label: `r.code || ' · ' || r.name`, visibility: {} },
  contact: {
    module: 'contacts',
    table: 'contacts',
    label: `COALESCE(NULLIF(trim(concat_ws(' ', r.first_name, r.last_name)), ''), r.email)`,
    visibility: {},
  },
  application: {
    module: 'applications',
    table: 'applications',
    label: 'r.name',
    reference: 'r.sequential_id',
    visibility: { scope: 'applications' },
  },
  technology: {
    module: 'infrastructure',
    table: 'technologies',
    label: 'r.name',
    reference: `'TEC-' || r.item_number`,
    visibility: {},
  },
  asset: {
    module: 'infrastructure',
    table: 'assets',
    label: 'r.name',
    reference: 'r.asset_reference',
    visibility: {},
  },
  task: {
    module: 'tasks',
    table: 'tasks',
    label: 'r.title',
    reference: `'T-' || r.item_number`,
    visibility: { scope: 'tasks', incident: true },
  },
  budget_line: {
    module: 'budget',
    table: 'spend_items',
    label: `COALESCE(NULLIF(r.product_name, ''), NULLIF(r.description, ''))`,
    reference: `'BL-' || r.item_number`,
    visibility: { natures: true },
  },
  location: {
    module: 'locations',
    table: 'locations',
    label: 'r.name',
    reference: 'r.location_reference',
    visibility: {},
  },
  // `assets.sub_location_id` references `location_sub_items`, not `locations`: a family of its
  // own, read by the site module, so a sub-location is named (or withheld) for what it is.
  sub_location: {
    module: 'locations',
    table: 'location_sub_items',
    label: 'r.name',
    visibility: {},
  },
  connection: {
    module: 'infrastructure',
    table: 'connections',
    label: 'r.name',
    reference: 'r.connection_reference',
    visibility: {},
  },
  interface: {
    module: 'applications',
    table: 'interfaces',
    label: 'r.name',
    reference: 'r.interface_reference',
    // The interface page refuses a Business Contributor whose applications access is limited
    // (`assertUnrestrictedApplicationReader`): the family is not readable for them either.
    visibility: { closedToScope: 'applications' },
  },
  incident: {
    module: 'incidents',
    table: 'incidents',
    label: 'r.title',
    reference: `'INC-' || r.item_number`,
    // A confidential incident is read only by a registry admin, its reporter or its owner.
    visibility: { confidentialIncident: true },
  },
  department: { module: 'departments', table: 'departments', label: 'r.name', visibility: {} },
  business_process: { module: 'business_processes', table: 'business_processes', label: 'r.name', visibility: {} },
  calendar: {
    module: 'working_day_profiles',
    table: 'working_day_profiles',
    label: 'r.name',
    reference: 'r.code',
    visibility: {},
  },
  analytics_axis: {
    module: 'analytics',
    table: 'analytics_axes',
    // The screen names a dimension by its name (`Purpose`), never its code beside it.
    label: `COALESCE(NULLIF(r.name, ''), r.code)`,
    visibility: {},
  },
  analytics_category: {
    module: 'analytics',
    table: 'analytics_categories',
    label: 'r.name',
    visibility: {},
  },
  contributor: {
    module: 'portfolio_settings',
    table: 'portfolio_team_member_configs',
    // A contributor has no name of its own: the screen names the person the profile belongs to.
    label: `(SELECT COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)
               FROM users u
              WHERE u.tenant_id = r.tenant_id AND u.id = r.user_id)`,
    reference: `'CTR-' || r.item_number`,
    visibility: {},
  },
  // Knowledge documents and their contexts: the library ACL decides, in code (a restricted
  // library, a member level, or an incident review whose incident the person cannot see). The
  // folder follows its library; a document type is tenant-wide configuration.
  document: {
    module: 'knowledge',
    table: 'documents',
    label: 'r.title',
    reference: `'DOC-' || r.item_number`,
    visibility: { check: 'knowledge_document' },
  },
  document_folder: {
    module: 'knowledge',
    table: 'document_folders',
    label: 'r.name',
    visibility: { check: 'knowledge_folder' },
  },
  document_library: {
    module: 'knowledge',
    table: 'document_libraries',
    label: 'r.name',
    visibility: { check: 'knowledge_library' },
  },
  document_type: { module: 'knowledge', table: 'document_types', label: 'r.name', visibility: {} },
  // The portfolio classification (source, category, stream): tenant settings whose names every
  // reader of a project or a request sees on its page, so they are open like people's names.
  portfolio_source: { module: null, table: 'portfolio_sources', label: 'r.name', visibility: {} },
  portfolio_category: { module: null, table: 'portfolio_categories', label: 'r.name', visibility: {} },
  portfolio_stream: { module: null, table: 'portfolio_streams', label: 'r.name', visibility: {} },
};

export const FAMILY_KEYS = Object.keys(REFERENCE_FAMILIES) as FamilyKey[];

/** The permission resource that reads each family, for the inventory's own check (`record-history-inventory.spec.ts`). */
export const FAMILY_MODULES: Readonly<Record<FamilyKey, string | null>> = Object.fromEntries(
  FAMILY_KEYS.map((family) => [family, REFERENCE_FAMILIES[family].module]),
) as Record<FamilyKey, string | null>;

/** Whether the person's permissions open each family's module: null (people) is open to everyone. */
export function readableFamilies(ctx: Pick<TenantRequest, 'isAdmin' | 'permissions'>): Record<FamilyKey, boolean> {
  const readable = {} as Record<FamilyKey, boolean>;
  for (const family of FAMILY_KEYS) {
    const module = REFERENCE_FAMILIES[family].module;
    readable[family] = module === null || hasLevel(ctx, module, 'reader');
  }
  return readable;
}

/** The screen rule of each participation resource, as the Relations tabs apply it. */
const PARTICIPATION_CONDITIONS: Readonly<Record<ParticipationResource, (alias: string, userRef: string) => string>> = {
  applications: applicationParticipantCondition,
  portfolio_projects: projectParticipantCondition,
  portfolio_requests: requestParticipantCondition,
  tasks: taskParticipantCondition,
};

/** One family read by code: the ids the person may read, under the request transaction. */
export type FamilyCodeCheck = (ids: readonly string[]) => Promise<ReadonlySet<string>>;

/** Who the reference reads run for: the request transaction, the tenant and the person. */
export type ReferenceReader = {
  manager: EntityManager;
  tenantId: string;
  userId: string;
  isAdmin: boolean;
  viewer: IncidentViewer;
  /** The code checks of the families whose screen right is not SQL. A missing check hides its family. */
  checks?: Partial<Record<FamilyCodeCheckKey, FamilyCodeCheck>>;
};

/** The person's limited scope on a resource, resolved once per page and shared by the families. */
async function participationScope(
  reader: ReferenceReader,
  resource: ParticipationResource,
  scopes: Map<ParticipationResource, ParticipationAccessScope | undefined>,
): Promise<ParticipationAccessScope | undefined> {
  if (!scopes.has(resource)) {
    scopes.set(resource, await resolveBusinessContributorScopeForUser({
      manager: reader.manager,
      userId: reader.userId,
      tenantId: reader.tenantId,
      isAdmin: reader.isAdmin,
    }, resource));
  }
  return scopes.get(resource);
}

/**
 * The visibility predicate of one reference family, on the alias `r`, appended to `params`:
 * `$1` and `$2` are the caller's tenant and ids (or id), so a rule that needs a value starts at
 * `$3`. It is the family's own screen rule: the Business Contributor participation of its
 * resource (resolved once per page through `scopes`), the page a limited contributor cannot open,
 * the confidential incidents a task names or the family holds, and the two natures of a budget
 * line. RLS and data access stay the manager's job.
 */
export async function familyVisibilitySql(
  reader: ReferenceReader,
  family: FamilyKey,
  scopes: Map<ParticipationResource, ParticipationAccessScope | undefined>,
  params: unknown[],
): Promise<string> {
  const spec = REFERENCE_FAMILIES[family];
  if (spec.visibility.check) {
    throw new Error(`The reference family "${family}" is read by code (${spec.visibility.check}), not by SQL.`);
  }
  let visibilitySql = '';
  const scopeResource = spec.visibility.scope;
  if (scopeResource) {
    const scope = await participationScope(reader, scopeResource, scopes);
    if (scope) {
      params.push(scope.userId);
      visibilitySql += ` AND ${PARTICIPATION_CONDITIONS[scopeResource]('r', `$${params.length}`)}`;
    }
  }
  const closedResource = spec.visibility.closedToScope;
  if (closedResource && (await participationScope(reader, closedResource, scopes))) {
    // The screen throws for a limited contributor: no row of this family is readable.
    visibilitySql += ' AND FALSE';
  }
  if (spec.visibility.natures) visibilitySql += " AND r.nature IN ('opex', 'capex')";
  if (spec.visibility.incident) visibilitySql += taskIncidentVisibilitySql('r', reader.viewer, params);
  if (spec.visibility.confidentialIncident) visibilitySql += incidentVisibilitySql('r', reader.viewer, params);
  return visibilitySql;
}

/**
 * Whether the person may read one record, under the request's transaction: the same read the
 * reference resolution runs for a named id, with the record's own family rule. A false answer is
 * the 404 of `list`, never a 403: the record is outside the person's access or does not exist.
 */
export async function recordIsVisible(reader: ReferenceReader, family: FamilyKey, id: string): Promise<boolean> {
  const spec = REFERENCE_FAMILIES[family];
  const check = spec.visibility.check;
  if (check) {
    const readable = await runCodeCheck(reader, check, [id]);
    return readable.has(id.toLowerCase());
  }
  const params: unknown[] = [reader.tenantId, id];
  const visibilitySql = await familyVisibilitySql(reader, family, new Map(), params);
  const rows: Array<{ id: string }> = await reader.manager.query(
    `SELECT r.id::text AS id
       FROM ${spec.table} r
      WHERE r.tenant_id = $1 AND r.id = $2::uuid${visibilitySql}
      LIMIT 1`,
    params,
  );
  return rows.length > 0;
}

/** The ids a code check lets through, lower-cased; no check declared hides every id (fail closed). */
async function runCodeCheck(reader: ReferenceReader, check: FamilyCodeCheckKey, ids: readonly string[]): Promise<Set<string>> {
  const run = reader.checks?.[check];
  if (!run) return new Set();
  const readable = await run(ids);
  return new Set(Array.from(readable, (id) => id.toLowerCase()));
}

/** The rows a page may name, and the ids whose row no longer exists in the tenant. */
export type ReferenceResolution = {
  rows: Map<FamilyKey, Map<string, ReferenceRow>>;
  deleted: Map<FamilyKey, Set<string>>;
};

/** The ids of a family's table that still exist, read outside the person's screen scope, ids only. */
async function existingIds(reader: ReferenceReader, table: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const read = (manager: EntityManager) => manager.query(
    `SELECT r.id::text AS id FROM ${table} r WHERE r.tenant_id = $1 AND r.id = ANY($2::uuid[])`,
    [reader.tenantId, ids],
  );
  const runner = reader.manager.queryRunner;
  // A limited person runs in a transaction; outside the limited role the read is the same. The
  // window is read-only and gives the role back (`data-access/full-data-access.ts`): the answer is
  // a set of booleans, never a name or a field.
  const rows: Array<{ id: string }> = runner?.isTransactionActive
    ? await withFullDataAccess(reader.manager, read)
    : await read(reader.manager);
  return new Set(rows.map((row) => row.id.toLowerCase()));
}

/**
 * The rows of each family the person may name, under the tenant predicate, RLS and data access,
 * plus the rule the family's own screen applies:
 * - applications, projects and requests: a Business Contributor only sees the records they take
 *   part in, as the line's Relations tab and their own lists do;
 * - interfaces: a Business Contributor whose applications access is limited names none;
 * - incidents: a confidential incident names only its registry admins, reporter and owner;
 * - tasks: the same participation, then a task on a confidential incident the viewer may not see
 *   is absent, as the task list applies it;
 * - documents, folders and libraries: the code check decides, as the Knowledge screen does.
 *
 * An id the person may read but whose row is absent from its table is a deleted record: `deleted`
 * lists it so the presentation says "a deleted asset", never "an asset" (which means withheld).
 * The existence read runs outside the person's screen scope because a row they cannot see still
 * exists; it returns ids only, and the tenant predicate still applies. A module the person does
 * not read resolves nothing: the record stays hidden, never deleted.
 *
 * The scopes are read once per page, and only for a family the page names and the person may read.
 */
export async function resolveReferences(
  reader: ReferenceReader,
  ids: Map<FamilyKey, Set<string>>,
  readable: Record<FamilyKey, boolean>,
): Promise<ReferenceResolution> {
  const out = new Map<FamilyKey, Map<string, ReferenceRow>>();
  const deleted = new Map<FamilyKey, Set<string>>();
  const scopes = new Map<ParticipationResource, ParticipationAccessScope | undefined>();
  for (const family of FAMILY_KEYS) {
    const wanted = ids.get(family);
    if (!wanted || wanted.size === 0 || !readable[family]) {
      out.set(family, new Map());
      continue;
    }
    const spec = REFERENCE_FAMILIES[family];
    let readableIds = Array.from(wanted);
    let visibilitySql = '';
    if (spec.visibility.check) {
      // The code check is the screen rule: only the ids it lets through are read for their label.
      readableIds = Array.from(await runCodeCheck(reader, spec.visibility.check, readableIds));
    }
    const rows: ReferenceRow[] = readableIds.length === 0 ? [] : await (async () => {
      const params: unknown[] = [reader.tenantId, readableIds];
      if (!spec.visibility.check) {
        visibilitySql = await familyVisibilitySql(reader, family, scopes, params);
      }
      const reference = spec.reference ? `, ${spec.reference} AS reference` : '';
      return reader.manager.query(
        `SELECT r.id::text AS id, ${spec.label} AS label${reference}
           FROM ${spec.table} r
          WHERE r.tenant_id = $1 AND r.id = ANY($2::uuid[])${visibilitySql}`,
        params,
      );
    })();
    const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
    out.set(family, byId);
    const missing = Array.from(wanted).filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const present = await existingIds(reader, spec.table, missing);
      deleted.set(family, new Set(missing.filter((id) => !present.has(id))));
    }
  }
  return { rows: out, deleted };
}

/** The named rows of each family, without the deleted ids (the shape a reference reader expects). */
export async function loadReferences(
  reader: ReferenceReader,
  ids: Map<FamilyKey, Set<string>>,
  readable: Record<FamilyKey, boolean>,
): Promise<Map<FamilyKey, Map<string, ReferenceRow>>> {
  return (await resolveReferences(reader, ids, readable)).rows;
}
