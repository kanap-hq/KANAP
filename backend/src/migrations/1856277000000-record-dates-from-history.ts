import { MigrationInterface, QueryRunner } from 'typeorm';
import { historyShowsRow } from '../audit/record-dating';

const LOG = '[migration 1856277000000 record-dates-from-history]';

/**
 * Which audit rows date which record: the correspondence of `audit/record-dating.ts`
 * (`historyRecordsReading`) for the tables of `common/updated-at.inventory.ts` that have a history,
 * as it stood when this migration was written. A migration keeps its own copy:
 * `__tests__/record-dates-from-history.integration.spec.ts` compares it with the code.
 * - `own`: the record's own labels, read by `record_id` (its own creation and deletion date nothing);
 * - `byRecord`: child labels whose `record_id` is the record;
 * - `byParent`: child labels read by `parent_table` / `parent_id`;
 * - `byPayload`: payload key → child labels whose `after_json` (else `before_json`) names the record.
 */
type Dating = {
  own: readonly string[];
  byRecord?: readonly string[];
  byParent?: readonly string[];
  byPayload?: Readonly<Record<string, readonly string[]>>;
};

const DATING: Readonly<Record<string, Dating>> = {
  accounts: { own: ['accounts'] },
  analytics_axes: { own: ['analytics_axes'], byParent: ['analytics_categories'] },
  analytics_categories: { own: ['analytics_categories'] },
  applications: {
    own: ['applications'],
    byRecord: ['application_capex_items', 'application_companies', 'application_contracts', 'application_data_residency', 'application_departments', 'application_owners', 'application_projects', 'application_spend_items', 'application_suites', 'application_support_contacts'],
    byParent: ['app_asset_assignments', 'app_instances', 'application_attachments', 'application_business_processes', 'application_capex_items', 'application_companies', 'application_contracts', 'application_data_residency', 'application_departments', 'application_links', 'application_owners', 'application_projects', 'application_spend_items', 'application_suites', 'application_support_contacts', 'application_technologies'],
    byPayload: { application_id: ['application_business_processes', 'application_technologies'] },
  },
  assets: {
    own: ['assets'],
    byRecord: ['asset_capex_items', 'asset_cluster_members', 'asset_contracts', 'asset_projects', 'asset_relations', 'asset_spend_items', 'asset_support_contacts'],
    byParent: ['asset_attachments', 'asset_capex_items', 'asset_cluster_members', 'asset_contracts', 'asset_hardware_info', 'asset_links', 'asset_projects', 'asset_relations', 'asset_spend_items', 'asset_support_contacts', 'asset_support_info', 'asset_technologies'],
    byPayload: { asset_id: ['asset_attachments', 'asset_hardware_info', 'asset_links', 'asset_support_info', 'asset_technologies'] },
  },
  business_processes: { own: ['business_processes'], byRecord: ['application_business_processes'], byParent: ['application_business_processes'] },
  companies: { own: ['companies'], byParent: ['company_metrics'] },
  connections: { own: ['connections'], byParent: ['connection_legs'] },
  contacts: {
    own: ['contacts'],
    byParent: ['capex_item_contacts', 'contract_contacts', 'spend_item_contacts', 'supplier_contacts'],
    byPayload: { contact_id: ['capex_item_contacts', 'contract_contacts', 'spend_item_contacts', 'supplier_contacts'] },
  },
  contracts: {
    own: ['contracts'],
    byRecord: ['application_contracts', 'asset_contracts', 'contract_capex_items', 'contract_spend_items', 'technology_contracts'],
    byParent: ['application_contracts', 'asset_contracts', 'contract_attachments', 'contract_capex_items', 'contract_compliance_items', 'contract_contacts', 'contract_links', 'contract_spend_items', 'tasks', 'technology_contracts'],
  },
  departments: { own: ['departments'], byParent: ['department_metrics'] },
  documents: { own: ['documents'], byParent: ['document_attachments'] },
  incidents: {
    own: ['incidents'],
    byRecord: ['incident_applications', 'incident_assets', 'incident_technologies'],
    byParent: ['incident_applications', 'incident_assets', 'incident_attachments', 'incident_technologies', 'tasks'],
  },
  interfaces: {
    own: ['interfaces'],
    byRecord: ['interface_companies', 'interface_data_residency', 'interface_dependencies', 'interface_key_identifiers', 'interface_legs', 'interface_links', 'interface_owners'],
    byParent: ['interface_attachments', 'interface_bindings', 'interface_companies', 'interface_data_residency', 'interface_dependencies', 'interface_key_identifiers', 'interface_legs', 'interface_links', 'interface_mapping_groups', 'interface_mapping_rules', 'interface_mapping_sets', 'interface_owners'],
  },
  locations: { own: ['locations'], byParent: ['location_contacts', 'location_links', 'location_sub_items', 'location_user_contacts'] },
  portfolio_projects: {
    own: ['portfolio_projects'],
    byRecord: ['application_projects', 'asset_projects', 'portfolio_project_capex', 'portfolio_project_contacts', 'portfolio_project_dependencies', 'portfolio_project_documents', 'portfolio_project_effort_allocations', 'portfolio_project_opex', 'portfolio_project_team', 'portfolio_project_urls', 'technology_projects'],
    byParent: ['application_projects', 'asset_projects', 'portfolio_project_attachments', 'portfolio_project_capex', 'portfolio_project_contacts', 'portfolio_project_dependencies', 'portfolio_project_documents', 'portfolio_project_effort_allocations', 'portfolio_project_milestones', 'portfolio_project_opex', 'portfolio_project_phases', 'portfolio_project_team', 'portfolio_project_time_entries', 'portfolio_project_urls', 'tasks', 'technology_projects'],
  },
  portfolio_requests: {
    own: ['portfolio_requests'],
    byRecord: ['portfolio_request_applications', 'portfolio_request_assets', 'portfolio_request_business_processes', 'portfolio_request_capex', 'portfolio_request_contacts', 'portfolio_request_dependencies', 'portfolio_request_documents', 'portfolio_request_opex', 'portfolio_request_team', 'portfolio_request_urls'],
    byParent: ['portfolio_request_applications', 'portfolio_request_assets', 'portfolio_request_attachments', 'portfolio_request_business_processes', 'portfolio_request_capex', 'portfolio_request_contacts', 'portfolio_request_dependencies', 'portfolio_request_documents', 'portfolio_request_opex', 'portfolio_request_team', 'portfolio_request_urls'],
  },
  spend_items: {
    own: ['capex_items', 'spend_items'],
    byParent: ['application_capex_items', 'application_spend_items', 'asset_capex_items', 'asset_spend_items', 'capex_allocations', 'capex_amounts', 'capex_attachments', 'capex_item_contacts', 'capex_links', 'capex_round_inputs', 'capex_versions', 'contract_capex_items', 'contract_spend_items', 'portfolio_project_capex', 'portfolio_project_opex', 'portfolio_request_capex', 'portfolio_request_opex', 'spend_allocations', 'spend_amounts', 'spend_attachments', 'spend_item_contacts', 'spend_links', 'spend_round_inputs', 'spend_versions', 'tasks', 'technology_spend_items'],
  },
  suppliers: { own: ['suppliers'], byParent: ['supplier_contacts'] },
  tasks: { own: ['tasks'], byRecord: ['task_applications', 'task_assets'], byParent: ['task_applications', 'task_assets', 'task_attachments', 'task_time_entries'] },
  technologies: {
    own: ['technologies'],
    byRecord: ['application_technologies', 'asset_technologies', 'technology_contracts', 'technology_owners', 'technology_projects', 'technology_spend_items', 'technology_support_contacts', 'technology_versions'],
    byParent: ['application_technologies', 'asset_technologies', 'technology_attachments', 'technology_contracts', 'technology_links', 'technology_owners', 'technology_projects', 'technology_spend_items', 'technology_support_contacts', 'technology_versions', 'technology_vulnerabilities'],
    byPayload: { technology_id: ['technology_attachments', 'technology_links', 'technology_vulnerabilities'] },
  },
  working_day_profiles: { own: ['working_day_profiles'] },
};

const UUID_TEXT = `'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`;

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

type Candidate = {
  record_id: string;
  audit_id: string;
  audit_record_id: string | null;
  action: string;
  table_name: string;
  before_json: unknown;
  after_json: unknown;
};

/**
 * The audit rows of one table's records in the tenant `$1` that could date them: the rows its
 * correspondence reads, later than the record's date. Of those, the latest row that is not an
 * update (a child added or removed: always an entry), and the updates later than it, which the
 * history may show as no change (`historyShowsRow` judges them). Newest first, by record.
 */
function candidatesSql(table: string, dating: Dating): { sql: string; params: unknown[] } {
  const params: unknown[] = [null, [...dating.own, ...(dating.byRecord ?? [])], dating.own, table, dating.byParent ?? []];
  const columns = 'a.id AS audit_id, a.record_id AS audit_record_id, a.created_at, a.action, a.table_name, a.before_json, a.after_json';
  const branches = [
    `SELECT a.record_id AS record_id, ${columns}
       FROM audit_log a
      WHERE a.tenant_id = $1 AND a.table_name = ANY($2::text[]) AND a.record_id IS NOT NULL
        AND NOT (a.table_name = ANY($3::text[]) AND a.action IN ('create', 'delete'))`,
    `SELECT a.parent_id, ${columns}
       FROM audit_log a
      WHERE a.tenant_id = $1 AND a.parent_table = $4 AND a.parent_id IS NOT NULL AND a.table_name = ANY($5::text[])`,
  ];
  for (const [key, labels] of Object.entries(dating.byPayload ?? {})) {
    params.push(labels);
    const named = `lower(COALESCE(a.after_json, a.before_json) ->> '${key.replace(/'/g, "''")}')`;
    branches.push(
      `SELECT CASE WHEN ${named} ~ ${UUID_TEXT} THEN (${named})::uuid END, ${columns}
         FROM audit_log a
        WHERE a.tenant_id = $1 AND a.table_name = ANY($${params.length}::text[]) AND ${named} ~ ${UUID_TEXT}`,
    );
  }
  return {
    params,
    sql: `WITH hits AS (
            ${branches.join('\n            UNION ALL\n            ')}
          ), newer AS (
            SELECT h.* FROM hits h
              JOIN public.${quoteIdent(table)} t ON t.tenant_id = $1 AND t.id = h.record_id
             WHERE h.created_at > t.updated_at
          ), floor AS (
            SELECT record_id, max(created_at) AS at FROM newer WHERE action <> 'update' GROUP BY record_id
          )
          SELECT n.record_id, n.audit_id, n.audit_record_id, n.action, n.table_name,
                 CASE WHEN n.action = 'update' THEN n.before_json END AS before_json,
                 CASE WHEN n.action = 'update' THEN n.after_json END AS after_json
            FROM newer n LEFT JOIN floor f ON f.record_id = n.record_id
           WHERE (n.action <> 'update' AND n.created_at = f.at)
              OR (n.action = 'update' AND (f.at IS NULL OR n.created_at > f.at))
           ORDER BY n.record_id, n.created_at DESC, n.audit_id DESC`,
  };
}

/**
 * The records that existed before their history dated them (migration 1856270000000, lot I7c)
 * take the date of the latest entry their history shows, when it is later than their date: the
 * dating of `audit/record-dating.ts` applied once to the audit log already written. A date never
 * moves back, never past `now()`; a record with no such entry keeps its date. The update rows the
 * history shows as no change (a record saved unchanged, a set written back as it was) date
 * nothing, as for a new entry: `historyShowsRow`, the page's own filter.
 *
 * Tenant by tenant with `app.current_tenant` set (transaction-local), RLS left ENABLE + FORCE
 * everywhere: the date trigger of the search index (`search_index_stamp_source()`, migration
 * 1856275000000) writes `search_index`, also under FORCE RLS, and finds the entries only in the
 * record's tenant. Per table and tenant, one read (the candidates, each statement with its
 * `tenant_id` predicate) and one write; the write names `updated_at` alone, so the record's own
 * date trigger (its WHEN compares the other columns, and the date moved) and the search index
 * sync stay still, and only the search entry's `source_updated_at` follows.
 *
 * Rerun-safe: a second run finds no entry later than the dates and writes nothing. A table missing,
 * or without its `updated_at`, is skipped with a log line; a row naming a deleted record finds
 * nothing to date.
 */
export class RecordDatesFromHistory1856277000000 implements MigrationInterface {
  name = 'RecordDatesFromHistory1856277000000';
  /** The correspondence this migration applies; its spec compares it with the dating code. */
  readonly dating = DATING;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    const present: Array<{ table: string }> = await queryRunner.query(
      `SELECT c.relname::text AS table
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
          AND c.relname = ANY($1::text[]) AND a.attname = 'updated_at' AND a.attnum > 0 AND NOT a.attisdropped`,
      [Object.keys(DATING)],
    );
    const tables = Object.keys(DATING).filter((table) => present.some((row) => row.table === table)).sort();
    for (const table of Object.keys(DATING).filter((name) => !tables.includes(name))) {
      console.warn(`${LOG} ${table}: table or updated_at column missing, skipped`);
    }

    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY created_at ASC, id ASC`);
    const dated = new Map<string, number>(tables.map((table) => [table, 0]));
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        const [{ has_log }]: Array<{ has_log: boolean }> = await queryRunner.query(
          `SELECT EXISTS (SELECT 1 FROM audit_log WHERE tenant_id = $1) AS has_log`,
          [tenant.id],
        );
        if (!has_log) continue;
        for (const table of tables) {
          const { sql, params } = candidatesSql(table, this.dating[table]);
          params[0] = tenant.id;
          const candidates: Candidate[] = await queryRunner.query(sql, params);
          const picked = new Map<string, string>();
          for (const row of candidates) {
            if (picked.has(row.record_id)) continue;
            const shown = row.action !== 'update' || historyShowsRow(table, {
              table: row.table_name,
              recordId: row.audit_record_id,
              action: row.action,
              before: row.before_json,
              after: row.after_json,
            }, row.record_id);
            if (shown) picked.set(row.record_id, row.audit_id);
          }
          if (picked.size === 0) continue;
          const [{ count }]: Array<{ count: number }> = await queryRunner.query(
            `WITH picked AS (
               SELECT p.record_id, LEAST(a.created_at, now()) AS at
                 FROM unnest($2::uuid[], $3::uuid[]) AS p(record_id, audit_id)
                 JOIN audit_log a ON a.tenant_id = $1 AND a.id = p.audit_id
             ), changed AS (
               UPDATE public.${quoteIdent(table)} t SET updated_at = p.at
                 FROM picked p
                WHERE t.tenant_id = $1 AND t.id = p.record_id AND t.updated_at < p.at
               RETURNING 1
             )
             SELECT count(*)::int AS count FROM changed`,
            [tenant.id, Array.from(picked.keys()), Array.from(picked.values())],
          );
          dated.set(table, (dated.get(table) ?? 0) + count);
        }
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    for (const [table, count] of dated) console.log(`${LOG} ${table}: ${count} record(s) dated`);
    const total = Array.from(dated.values()).reduce((sum, count) => sum + count, 0);
    console.log(`${LOG} ${total} record(s) dated in ${tenants.length} tenant(s), ${Date.now() - started} ms`);
  }

  public async down(): Promise<void> {
    // Nothing to undo: a date taken from the history is the record's date, and the date it had
    // before is not kept anywhere.
  }
}
