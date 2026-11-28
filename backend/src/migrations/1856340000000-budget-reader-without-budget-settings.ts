import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] BudgetReaderWithoutBudgetSettings:';

/** The shipped role, recognised by its name and `is_built_in`, never by its name alone. */
const ROLE = 'Budget Reader';

/** `budget_ops` and the names `permissions.service.ts` reads as it (`RESOURCE_ALIASES`). */
const BUDGET_OPS_NAMES = ['budget_ops', 'budget-ops', 'budget_operations', 'budget-admin', 'budget_admin'];

/** One budget administration row of a built-in Budget Reader, with its role's tenant. */
type Row = { id: string; role_id: string; tenant_id: string; slug: string | null; resource: string; level: string };

/**
 * The shipped Budget Reader role reads the budget lines, not the budget settings: it no longer
 * holds budget administration (`budget_ops`). The Budget Member keeps `budget_ops:reader`, the
 * Budget Administrator `budget_ops:admin`. A role a tenant created, a copy of a shipped role
 * included, keeps its rights. `seedTenantDefaults` no longer gives the right to the Budget Reader
 * and merges the shipped rights without deleting any, so a tenant reset does not bring it back.
 *
 * up(), with row level security lifted on `role_permissions` and `roles` and put back as found:
 * 1. Lists the `budget_ops` rows, under that name or one read as it, of every role with
 *    `is_built_in` and the name "Budget Reader", in every tenant and whatever their level (the
 *    product locks the rights of a built-in role: another level comes from a direct write).
 * 2. Deletes them; one log line per role changed (its tenant, the rows removed) and a summary.
 * 3. Checks that none is left, an exception otherwise (so the transaction is rolled back).
 * A second run finds none: it writes nothing.
 *
 * down() gives `budget_ops:reader` back to every built-in Budget Reader that holds none of these
 * names. The rows up() removed under another name or at another level come back as
 * `budget_ops:reader`, the right the role was seeded with.
 */
export class BudgetReaderWithoutBudgetSettings1856340000000 implements MigrationInterface {
  name = 'BudgetReaderWithoutBudgetSettings1856340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await withoutRowSecurity(queryRunner, ['role_permissions', 'roles'], async () => {
      const rows: Row[] = await queryRunner.query(
        `SELECT rp.id::text AS id, r.id::text AS role_id, r.tenant_id::text AS tenant_id, t.slug::text AS slug, rp.resource, rp.level
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           LEFT JOIN tenants t ON t.id = r.tenant_id
          WHERE r.is_built_in AND r.role_name = $1 AND rp.resource = ANY ($2::text[])
          ORDER BY t.slug NULLS LAST, r.tenant_id, r.id, rp.resource`,
        [ROLE, BUDGET_OPS_NAMES],
      );
      if (rows.length === 0) {
        await assertNoneLeft(queryRunner, 'up');
        console.log(`${LOG_PREFIX} no built-in ${ROLE} holds budget administration; nothing to remove (${Date.now() - started} ms)`);
        return;
      }

      const removed = await countOf(queryRunner, `DELETE FROM role_permissions WHERE id = ANY ($1::uuid[])`, [rows.map((row) => row.id)]);
      await assertNoneLeft(queryRunner, 'up');

      const byRole = new Map<string, Row[]>();
      for (const row of rows) byRole.set(row.role_id, [...(byRole.get(row.role_id) ?? []), row]);
      for (const [roleId, own] of byRole) {
        const removedRows = own.map((row) => `${row.resource}=${row.level}`).join(', ');
        console.log(`${LOG_PREFIX} tenant ${tenantName(own[0].slug, own[0].tenant_id)}: built-in role "${ROLE}" (${roleId}): ${removedRows} removed`);
      }
      const tenants = new Set(rows.map((row) => row.tenant_id)).size;
      console.log(
        `${LOG_PREFIX} done in ${Date.now() - started} ms: ${removed} row(s) removed from ${byRole.size} built-in ${ROLE} role(s) of ${tenants} tenant(s)`,
      );
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await withoutRowSecurity(queryRunner, ['role_permissions', 'roles'], async () => {
      const restored = await countOf(
        queryRunner,
        `INSERT INTO role_permissions (role_id, resource, level, tenant_id)
         SELECT r.id, 'budget_ops', 'reader', r.tenant_id
           FROM roles r
          WHERE r.is_built_in AND r.role_name = $1
            AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.resource = ANY ($2::text[]))`,
        [ROLE, BUDGET_OPS_NAMES],
      );
      const [{ n }]: Array<{ n: number }> = await queryRunner.query(
        `SELECT count(*)::int AS n FROM roles r
          WHERE r.is_built_in AND r.role_name = $1
            AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.resource = ANY ($2::text[]))`,
        [ROLE, BUDGET_OPS_NAMES],
      );
      if (n > 0) throw new Error(`${LOG_PREFIX} down: ${n} built-in ${ROLE} role(s) without budget administration; nothing was changed.`);
      console.log(`${LOG_PREFIX} reverted in ${Date.now() - started} ms: ${restored} built-in ${ROLE} role(s) read budget administration again`);
    });
  }
}

const tenantName = (slug: string | null, id: string) => `${slug || '(no slug)'} (${id})`;

async function assertNoneLeft(queryRunner: QueryRunner, step: string): Promise<void> {
  const [{ n }]: Array<{ n: number }> = await queryRunner.query(
    `SELECT count(*)::int AS n
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
      WHERE r.is_built_in AND r.role_name = $1 AND rp.resource = ANY ($2::text[])`,
    [ROLE, BUDGET_OPS_NAMES],
  );
  if (n > 0) throw new Error(`${LOG_PREFIX} ${step}: ${n} budget administration row(s) left on a built-in ${ROLE}; nothing was changed.`);
}

/** An UPDATE, DELETE or INSERT through the query runner returns [rows, count]: the count goes through a CTE. */
async function countOf(queryRunner: QueryRunner, statement: string, params: unknown[] = []): Promise<number> {
  const [{ n }]: Array<{ n: number }> = await queryRunner.query(`WITH changed AS (${statement} RETURNING 1) SELECT count(*)::int AS n FROM changed`, params);
  return n;
}

/**
 * Runs `fn` with row level security off on the tables, then restores what was found, also when
 * `fn` fails (1853970000000). After a failed statement the transaction is aborted and refuses the
 * restore: its rollback restores the state then, and the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, tables: string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ table: string; enabled: boolean; forced: boolean }> = [];
  for (const table of tables) {
    const [state] = await queryRunner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass($1)`,
      [table],
    );
    states.push({ table, enabled: !!state?.enabled, forced: !!state?.forced });
  }
  for (const state of states) {
    if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} DISABLE ROW LEVEL SECURITY`);
  }
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const state of states) {
        if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} ENABLE ROW LEVEL SECURITY`);
        if (state.forced) await queryRunner.query(`ALTER TABLE ${state.table} FORCE ROW LEVEL SECURITY`);
      }
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
