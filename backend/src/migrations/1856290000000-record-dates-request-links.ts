import { MigrationInterface, QueryRunner } from 'typeorm';
// The live presenter on purpose: an update dates its record when the History tab shows it as a
// change, and the date follows what the page shows on the day of the installation. Only which rows
// a record reads is frozen below.
import { historyShowsRow } from '../audit/record-dating';

const LOG = '[migration 1856290000000 record-dates-request-links]';

/**
 * Which audit rows date which record, for the two families whose correspondence lot K2f widened:
 * an application and an asset now read the link a request holds to them
 * (`portfolio_request_applications`, `portfolio_request_assets`, by `record_id` and by parent),
 * the row each request replacement writes on the record at the other end
 * (`common/relations/linked-ends.ts`). The correspondence of `audit/record-dating.ts` for these two
 * tables as it stood when this migration was written; the others keep migration 1856277000000's.
 * `__tests__/record-dates-from-history.integration.spec.ts` compares this copy with the code.
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
  applications: {
    own: ['applications'],
    byRecord: ['application_capex_items', 'application_companies', 'application_contracts', 'application_data_residency', 'application_departments', 'application_owners', 'application_projects', 'application_spend_items', 'application_suites', 'application_support_contacts', 'portfolio_request_applications'],
    byParent: ['app_asset_assignments', 'app_instances', 'application_attachments', 'application_business_processes', 'application_capex_items', 'application_companies', 'application_contracts', 'application_data_residency', 'application_departments', 'application_links', 'application_owners', 'application_projects', 'application_spend_items', 'application_suites', 'application_support_contacts', 'application_technologies', 'portfolio_request_applications'],
    byPayload: { application_id: ['application_business_processes', 'application_technologies'] },
  },
  assets: {
    own: ['assets'],
    byRecord: ['asset_capex_items', 'asset_cluster_members', 'asset_contracts', 'asset_projects', 'asset_relations', 'asset_spend_items', 'asset_support_contacts', 'portfolio_request_assets'],
    byParent: ['asset_attachments', 'asset_capex_items', 'asset_cluster_members', 'asset_contracts', 'asset_hardware_info', 'asset_links', 'asset_projects', 'asset_relations', 'asset_spend_items', 'asset_support_contacts', 'asset_support_info', 'asset_technologies', 'portfolio_request_assets'],
    byPayload: { asset_id: ['asset_attachments', 'asset_hardware_info', 'asset_links', 'asset_support_info', 'asset_technologies'] },
  },
};

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

type Candidate = {
  record_id: string;
  audit_id: string;
  audit_record_id: string | null;
  action: string;
  table_name: string;
  before_json: unknown;
  after_json: unknown;
  rn: number;
};

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;
const sqlTextArray = (values: readonly string[]) => `ARRAY[${values.map(sqlText).join(', ')}]::text[]`;

/**
 * The audit rows that could date a batch of one table's records (`$2`, ids) in the tenant `$1`:
 * the rows its correspondence reads, later than the record's date. Of those, the latest row that is
 * not an update (a child added or removed: always an entry), and the updates later than it, which
 * the history may show as no change (`historyShowsRow` judges them); newest first, by record, the
 * rows `$3 < rn <= $3 + $4` of each record. Each branch starts from the records, so the read runs
 * on the indexes of the history page: `(tenant_id, record_id, created_at)`, `(tenant_id,
 * parent_table, parent_id, created_at)` and the partial index of each payload key (its labels are
 * written out, so that the planner proves the index's predicate). The payloads are read last, for
 * the rows returned only.
 */
function candidatesSql(table: string, dating: Dating): string {
  const own = sqlTextArray(dating.own);
  const branches = [
    `SELECT r.id AS record_id, a.id AS audit_id, a.created_at, a.action
       FROM recs r
       JOIN audit_log a ON a.tenant_id = $1 AND a.record_id = r.id AND a.created_at > r.updated_at
      WHERE a.table_name = ANY(${sqlTextArray([...dating.own, ...(dating.byRecord ?? [])])})
        AND NOT (a.table_name = ANY(${own}) AND a.action IN ('create', 'delete'))`,
  ];
  if (dating.byParent?.length) {
    branches.push(
      `SELECT r.id, a.id, a.created_at, a.action
         FROM recs r
         JOIN audit_log a ON a.tenant_id = $1 AND a.parent_table = ${sqlText(table)} AND a.parent_id = r.id AND a.created_at > r.updated_at
        WHERE a.table_name = ANY(${sqlTextArray(dating.byParent)})`,
    );
  }
  for (const [key, labels] of Object.entries(dating.byPayload ?? {})) {
    branches.push(
      `SELECT r.id, a.id, a.created_at, a.action
         FROM recs r
         JOIN audit_log a ON a.tenant_id = $1 AND a.table_name = ANY(${sqlTextArray(labels)})
          AND lower(COALESCE(a.after_json, a.before_json) ->> ${sqlText(key)}) = r.id::text AND a.created_at > r.updated_at`,
    );
  }
  return `WITH recs AS (
            SELECT t.id, t.updated_at FROM public.${quoteIdent(table)} t WHERE t.tenant_id = $1 AND t.id = ANY($2::uuid[])
          ), newer AS (
            ${branches.join('\n            UNION ALL\n            ')}
          ), floor AS (
            SELECT record_id, max(created_at) AS at FROM newer WHERE action <> 'update' GROUP BY record_id
          ), kept AS (
            SELECT n.record_id, n.audit_id, n.created_at,
                   row_number() OVER (PARTITION BY n.record_id ORDER BY n.created_at DESC, n.audit_id DESC)::int AS rn
              FROM newer n LEFT JOIN floor f ON f.record_id = n.record_id
             WHERE (n.action <> 'update' AND n.created_at = f.at)
                OR (n.action = 'update' AND (f.at IS NULL OR n.created_at > f.at))
          )
          SELECT k.record_id, k.audit_id, k.rn, a.record_id AS audit_record_id, a.action, a.table_name,
                 CASE WHEN a.action = 'update' THEN a.before_json END AS before_json,
                 CASE WHEN a.action = 'update' THEN a.after_json END AS after_json
            FROM kept k JOIN audit_log a ON a.tenant_id = $1 AND a.id = k.audit_id
           WHERE k.rn > $3 AND k.rn <= $3 + $4
           ORDER BY k.record_id, k.rn`;
}

/**
 * The applications and the assets take the date of the latest entry their history shows, when it
 * is later than their date, with the correspondence widened by lot K2f: the dating of
 * `audit/record-dating.ts` applied once to the audit log already written, as migration
 * 1856277000000 did for every family. Before K2f, the request's link rows named the request in
 * `record_id` and no parent: an installation has none that this correspondence adds, so a run on
 * one dates no record through them; it reapplies the rest of the correspondence, which dates
 * nothing on a database 1856277000000 and the dating code have kept. A date never moves back,
 * never past `now()`; a record with no such entry keeps its date. The update rows the history shows
 * as no change date nothing (`historyShowsRow`, the page's own filter).
 *
 * The same procedure as 1856277000000, copied rather than imported (a migration is frozen): tenant
 * by tenant with `app.current_tenant` set (transaction-local), RLS left ENABLE + FORCE everywhere
 * (the search index's date trigger writes `search_index`, also under FORCE RLS, in the record's
 * tenant); per table and tenant, batches of `batchSize` ids, `perRecord` rows per record, one
 * write that names `updated_at` alone, so the record's own date trigger and the search index sync
 * stay still and only the search entry's `source_updated_at` follows.
 *
 * Rerun-safe: a second run finds no entry later than the dates and writes nothing. A table missing,
 * or without its `updated_at`, is skipped with a log line; a row naming a deleted record finds
 * nothing to date.
 */
export class RecordDatesRequestLinks1856290000000 implements MigrationInterface {
  name = 'RecordDatesRequestLinks1856290000000';
  /** The correspondence this migration applies; its spec compares it with the dating code. */
  readonly dating = DATING;
  /** Records per read and write; the spec lowers it to run several batches on a few records. */
  batchSize = 500;
  /** Audit rows read per record at a time; a record whose rows read are all hidden reads the next ones. */
  perRecord = 50;

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
    // No `finally`: after a failed statement the transaction is aborted, a reset would fail in turn
    // and hide the cause; the setting is transaction-local and leaves with the rolled back transaction.
    for (const tenant of tenants) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
      const [{ has_log }]: Array<{ has_log: boolean }> = await queryRunner.query(
        `SELECT EXISTS (SELECT 1 FROM audit_log WHERE tenant_id = $1) AS has_log`,
        [tenant.id],
      );
      if (!has_log) continue;
      for (const table of tables) {
        const sql = candidatesSql(table, this.dating[table]);
        let after: string | null = null;
        for (;;) {
          const batch: Array<{ id: string }> = await queryRunner.query(
            `SELECT id FROM public.${quoteIdent(table)} WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id LIMIT $3`,
            [tenant.id, after, this.batchSize],
          );
          if (batch.length === 0) break;
          after = batch[batch.length - 1].id;
          const picked = await this.pick(queryRunner, sql, table, tenant.id, batch.map((row) => row.id));
          if (picked.size > 0) {
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
          if (batch.length < this.batchSize) break;
        }
      }
    }
    await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);

    for (const [table, count] of dated) console.log(`${LOG} ${table}: ${count} record(s) dated`);
    const total = Array.from(dated.values()).reduce((sum, count) => sum + count, 0);
    console.log(`${LOG} ${total} record(s) dated in ${tenants.length} tenant(s), ${Date.now() - started} ms`);
  }

  /**
   * The audit row that dates each record of the batch: its latest row the history shows, read
   * `perRecord` rows at a time; the next rows are read only for the records whose rows read so far
   * are all hidden (updates shown as no change).
   */
  private async pick(queryRunner: QueryRunner, sql: string, table: string, tenantId: string, ids: string[]): Promise<Map<string, string>> {
    const picked = new Map<string, string>();
    let pending = ids;
    for (let offset = 0; pending.length > 0; offset += this.perRecord) {
      const candidates: Candidate[] = await queryRunner.query(sql, [tenantId, pending, offset, this.perRecord]);
      const full = new Set<string>();
      for (const row of candidates) {
        if (row.rn === offset + this.perRecord) full.add(row.record_id);
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
      pending = Array.from(full).filter((id) => !picked.has(id));
    }
    return picked;
  }

  public async down(): Promise<void> {
    // Nothing to undo: a date taken from the history is the record's date, and the date it had
    // before is not kept anywhere.
  }
}
