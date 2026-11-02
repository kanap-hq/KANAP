import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit labels that carry a portfolio project, for the record history of the linked records
 * (lot 2, projects). This is the SQL copy of `portfolioProjectsParentRules` and of the project
 * entry of the task rule (`src/audit/record-history/records/portfolio_projects.ts`,
 * `TASK_PARENT_TABLES` in `src/audit/audit-parent-rules.ts`): a migration is frozen and must not
 * import those modules, and `__tests__/audit-parent-rules-projects.spec.ts` reads this file back
 * to check that both agree.
 *
 * The children whose audit row names the project in `record_id` (its team, budget lines,
 * applications, assets, technologies, dependencies, contacts, web links, effort allocations and
 * document edits) keep `parent_*` NULL on purpose: the history reads them by `record_id`, and the
 * new labels among them have no earlier row to fill.
 */
const PROJECT_LABELS = [
  'portfolio_project_phases',
  'portfolio_project_milestones',
  'portfolio_project_attachments',
  'portfolio_project_time_entries',
] as const;

/** The task label, and the record a task names by its type: the backfill covers the project type. */
const TASK_LABEL = 'tasks';
const TASK_TYPES = { project: 'portfolio_projects' } as const;

const ALL_LABELS: readonly string[] = [...PROJECT_LABELS, TASK_LABEL];

/** Audit rows read per statement: each UPDATE touches at most this many rows. */
const BATCH_SIZE = 50000;

const UUID_SQL = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;

/** A payload key as a uuid, from `after` then `before`; NULL when neither side holds one. */
function payloadUuid(a: string, key: string): string {
  return `CASE
        WHEN (${a}.after_json->>'${key}') ~ ${UUID_SQL} THEN (${a}.after_json->>'${key}')::uuid
        WHEN (${a}.before_json->>'${key}') ~ ${UUID_SQL} THEN (${a}.before_json->>'${key}')::uuid
      END`;
}

/** The first payload of a task row, `after` then `before`, whose type is covered and whose id is a uuid. */
function taskPayload(a: string): string {
  const qualifies = (side: string) => `(${a}.${side}->>'related_object_type') = ANY($3::text[])
          AND (${a}.${side}->>'related_object_id') ~ ${UUID_SQL}`;
  return `CASE
        WHEN ${qualifies('after_json')} THEN ${a}.after_json
        WHEN ${qualifies('before_json')} THEN ${a}.before_json
      END`;
}

/**
 * The parent table and id an audit row of the labels names. `$2` project labels, `$3` the task
 * types, `$4` their tables (same order).
 */
function candidateSql(a: string): string {
  return `CASE
      WHEN ${a}.table_name = ANY($2::text[]) THEN 'portfolio_projects'
      WHEN ${a}.table_name = '${TASK_LABEL}' THEN
        ($4::text[])[array_position($3::text[], (${taskPayload(a)})->>'related_object_type')]
    END AS candidate_table,
    CASE
      WHEN ${a}.table_name = ANY($2::text[]) THEN ${payloadUuid(a, 'project_id')}
      WHEN ${a}.table_name = '${TASK_LABEL}' THEN ((${taskPayload(a)})->>'related_object_id')::uuid
    END AS candidate_parent_id`;
}

/**
 * One batch: the tenant's next rows of the labels, newest first along `(tenant_id, created_at
 * DESC)`, after the last row of the previous batch, then the update of those that have no parent
 * yet and whose payload names a project of the same tenant. The keyset keeps every batch bounded;
 * a filled row is never rewritten.
 */
function batchSql(after: boolean): string {
  const keyset = after
    ? `AND a.created_at <= $7::timestamptz AND (a.created_at < $7::timestamptz OR a.id < $8::uuid)`
    : '';
  return `WITH candidates AS MATERIALIZED (
      SELECT a.id, a.created_at, a.table_name,
             ${candidateSql('a')}
        FROM audit_log a
       WHERE a.tenant_id = $1
         AND a.table_name = ANY($5::text[])
         ${keyset}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $6
    ), changed AS (
      UPDATE audit_log a
         SET parent_table = c.candidate_table,
             parent_id = c.candidate_parent_id
        FROM candidates c
       WHERE a.id = c.id
         AND a.tenant_id = $1
         AND a.parent_id IS NULL
         AND c.candidate_parent_id IS NOT NULL
         AND c.candidate_table = 'portfolio_projects'
         AND EXISTS (SELECT 1 FROM portfolio_projects p WHERE p.tenant_id = a.tenant_id AND p.id = c.candidate_parent_id)
      RETURNING a.table_name
    ), last AS (
      SELECT c.created_at::text AS at, c.id::text AS id FROM candidates c ORDER BY c.created_at ASC, c.id ASC LIMIT 1
    )
    SELECT (SELECT count(*)::int FROM candidates) AS scanned,
           (SELECT at FROM last) AS last_created_at,
           (SELECT id FROM last) AS last_id,
           (SELECT json_agg(f) FROM (SELECT table_name, count(*)::int AS n FROM changed GROUP BY table_name) f) AS filled`;
}

/** The rows of the labels still without a parent; a task counts only when it is of a covered type. */
const WITHOUT_PARENT_SQL = `SELECT a.table_name, count(*)::int AS n
     FROM audit_log a
    WHERE a.tenant_id = $1
      AND a.parent_id IS NULL
      AND a.table_name = ANY($2::text[])
      AND (a.table_name <> '${TASK_LABEL}'
        OR COALESCE(a.after_json->>'related_object_type', a.before_json->>'related_object_type') = ANY($3::text[]))
    GROUP BY a.table_name`;

type Count = { table_name: string; n: number };

function addCounts(target: Map<string, number>, rows: Count[]): void {
  for (const row of rows) target.set(row.table_name, (target.get(row.table_name) ?? 0) + Number(row.n));
}

type BatchResult = { scanned: number; last_created_at: string | null; last_id: string | null; filled: Count[] | null };

/**
 * `audit_log.parent_table` / `parent_id` for the project children whose audit row names the
 * project in the payload (`project_id`), and for the tasks of a project.
 *
 * The backfill runs tenant by tenant with `app.current_tenant` set (transaction-local), so RLS
 * stays ENABLE + FORCE on every table it reads, and its statements take no table lock beyond ROW
 * EXCLUSIVE (`tenants` is not under RLS). Each statement reads at most `batchSize` rows of the
 * tenant, newest first, after the last row of the previous batch, and fills those whose payload
 * names a project that exists in the tenant: one pass over each tenant's rows. A row whose project
 * cannot be found keeps `parent_*` NULL and is not rewritten, so a second run changes nothing. No
 * index is added: these labels are read by the parent columns (`idx_audit_log_tenant_parent_created`)
 * or by `record_id`.
 *
 * The label counts are logged, filled and left without a parent. The updated rows leave dead
 * versions behind: `VACUUM (ANALYZE) audit_log` after the deploy gives the space back.
 */
export class AuditLogParentProjects1855930000000 implements MigrationInterface {
  name = 'AuditLogParentProjects1855930000000';
  /** Rows per statement; the spec lowers it to run several batches on a few rows. */
  batchSize = BATCH_SIZE;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY created_at ASC, id ASC`);
    const taskTypes = Object.keys(TASK_TYPES);
    const taskTables = taskTypes.map((type) => TASK_TYPES[type as keyof typeof TASK_TYPES]);

    const filled = new Map<string, number>();
    const withoutParent = new Map<string, number>();
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        let last: { createdAt: string; id: string } | null = null;
        for (;;) {
          const params: unknown[] = [tenant.id, PROJECT_LABELS, taskTypes, taskTables, ALL_LABELS, this.batchSize];
          if (last) params.push(last.createdAt, last.id);
          const [batch]: BatchResult[] = await queryRunner.query(batchSql(last !== null), params);
          addCounts(filled, batch.filled ?? []);
          if (batch.scanned < this.batchSize || !batch.last_created_at || !batch.last_id) break;
          last = { createdAt: batch.last_created_at, id: batch.last_id };
        }
        addCounts(withoutParent, await queryRunner.query(WITHOUT_PARENT_SQL, [tenant.id, ALL_LABELS, taskTypes]));
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    logCounts(filled, withoutParent);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY created_at ASC, id ASC`);
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        await queryRunner.query(
          `UPDATE audit_log
              SET parent_table = NULL, parent_id = NULL
            WHERE tenant_id = $1 AND table_name = ANY($2::text[])
              AND parent_table = 'portfolio_projects'`,
          [tenant.id, ALL_LABELS],
        );
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }
  }
}

function logCounts(filled: Map<string, number>, missing: Map<string, number>): void {
  const prefix = '[Migration] AuditLogParentProjects:';
  const totalFilled = Array.from(filled.values()).reduce((sum, n) => sum + n, 0);
  const totalWithout = Array.from(missing.values()).reduce((sum, n) => sum + n, 0);
  if (totalFilled === 0) console.log(`${prefix} no audit row to fill, nothing changed`);
  else console.log(`${prefix} ${totalFilled} audit row(s) given a parent, ${totalWithout} left without one`);
  for (const label of ALL_LABELS) {
    console.log(`  ${label}: ${filled.get(label) ?? 0} filled, ${missing.get(label) ?? 0} without a parent`);
  }
}
