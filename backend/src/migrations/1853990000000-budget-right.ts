import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] BudgetRight:';

/** The order of the levels. `manager`, a level of before the RBAC overhaul the CHECK still accepts, counts as `member`. */
const LEVEL_RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, manager: 3, admin: 4 };

type RightRow = {
  role_id: string;
  tenant_id: string;
  slug: string | null;
  role_name: string;
  opex: string | null;
  capex: string | null;
  budget: string | null;
};

type Planned = RightRow & { level: string };

/** An `opex` or `capex` row whose tenant is not its role's, deleted unmerged. */
type Stray = { role_id: string; role_tenant: string; row_tenant: string | null; resource: string; level: string };

/** Rows named in a log line (precedent 1853970000000). */
const NAMED_ROWS = 50;

/** The highest of the levels given (`manager` written `member`), or null when none is. */
function highest(levels: Array<string | null>): string | null {
  let best: string | null = null;
  for (const level of levels) {
    if (!level) continue;
    if (!best || (LEVEL_RANK[level] ?? 0) > (LEVEL_RANK[best] ?? 0)) best = level;
  }
  return best === 'manager' ? 'member' : best;
}

const tenantName = (row: { slug: string | null; tenant_id: string }) => `${row.slug || '(no slug)'} (${row.tenant_id})`;
const shown = (level: string | null) => level ?? 'none';

/**
 * One right for every budget line (plan planning/budget-unifie.md, amendment of U5, lot R): the
 * permission resources `opex` and `capex` become the single resource `budget`, whatever the
 * nature of the line. The nature stays a property of the line (the nature predicate of every
 * query, the `/capex-items*` aliases, the freeze by nature under `budget_ops` do not change).
 *
 * up(), with row level security lifted on `role_permissions` and `roles` and put back as found:
 * 1. For each role with an `opex` or `capex` row: `budget` = the highest of its `opex`, `capex`
 *    and any `budget` row already there (`reader < contributor < member < admin`, `manager` read
 *    as `member`); a role with one of the two rows gets that row's level. Nobody loses access; a
 *    role whose levels differed, or that had one of the two rows only, gains the higher level on
 *    every budget line. Only the rows of the role's own tenant count: a row whose `tenant_id` is
 *    not its role's was never read (row level security), so it opens nothing and is deleted.
 * 2. `INSERT ... ON CONFLICT (role_id, resource) DO UPDATE` writes that level with the role's
 *    tenant (an existing `budget` row is part of the maximum, so a higher one is kept), then every
 *    `opex` and `capex` row goes.
 * 3. One log line per tenant (roles merged), one per role whose levels differed or that had a
 *    single row (tenant, role, levels before, level after), and a summary.
 * 4. Checks, an exception otherwise (so the transaction is rolled back): no `opex` or `capex` row
 *    is left, and every role merged holds `budget` at the level expected.
 * A second run finds no `opex` or `capex` row: it writes nothing and checks again.
 *
 * down() copies each role's `budget` level onto `opex` and `capex` (the highest of `budget` and
 * of any `opex` or `capex` row there, as the code of lot R reads them), then deletes `budget`. The
 * levels a role had on OPEX and CAPEX before up(), when they differed, are not restorable: both
 * get the merged level (like 1837000000000, which cannot restore what it folded).
 */
export class BudgetRight1853990000000 implements MigrationInterface {
  name = 'BudgetRight1853990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await withoutRowSecurity(queryRunner, ['role_permissions', 'roles'], async () => {
      const rows = await rightsOf(queryRunner, ['opex', 'capex']);
      const planned: Planned[] = rows.map((row) => ({ ...row, level: highest([row.opex, row.capex, row.budget]) as string }));

      if (planned.length > 0) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, resource, level, tenant_id)
           SELECT p.role_id, 'budget', p.level, p.tenant_id
             FROM unnest($1::uuid[], $2::text[], $3::uuid[]) AS p(role_id, level, tenant_id)
           ON CONFLICT (role_id, resource) DO UPDATE
             SET level = EXCLUDED.level, tenant_id = EXCLUDED.tenant_id, updated_at = now()
           WHERE role_permissions.level IS DISTINCT FROM EXCLUDED.level
              OR role_permissions.tenant_id IS DISTINCT FROM EXCLUDED.tenant_id`,
          [planned.map((p) => p.role_id), planned.map((p) => p.level), planned.map((p) => p.tenant_id)],
        );
      }
      const strays: Stray[] = await queryRunner.query(
        `WITH gone AS (
           DELETE FROM role_permissions rp USING roles r
            WHERE rp.role_id = r.id AND rp.resource IN ('opex', 'capex') AND rp.tenant_id IS DISTINCT FROM r.tenant_id
           RETURNING rp.role_id::text AS role_id, r.tenant_id::text AS role_tenant, rp.tenant_id::text AS row_tenant, rp.resource, rp.level)
         SELECT * FROM gone ORDER BY role_id, resource`,
      );
      const removed = await countOf(queryRunner, `DELETE FROM role_permissions WHERE resource IN ('opex', 'capex')`);

      await assertNoneLeft(queryRunner, ['opex', 'capex'], 'up');
      await assertLevels(queryRunner, planned.map((p) => ({ role_id: p.role_id, resource: 'budget', level: p.level })), 'up');

      logMerge(planned, strays);
      const ms = Date.now() - started;
      if (planned.length === 0 && removed + strays.length === 0) {
        console.log(`${LOG_PREFIX} no opex or capex right left; nothing to merge (${ms} ms)`);
      } else {
        const tenants = new Set(planned.map((p) => p.tenant_id)).size;
        const differing = planned.filter(differs).length;
        console.log(
          `${LOG_PREFIX} done in ${ms} ms: ${planned.length} role(s) of ${tenants} tenant(s) hold budget, `
          + `${differing} of them with different levels, a single row or a budget row before (listed above); ${removed + strays.length} opex/capex row(s) removed`,
        );
      }
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await withoutRowSecurity(queryRunner, ['role_permissions', 'roles'], async () => {
      const rows = await rightsOf(queryRunner, ['budget']);
      const planned: Planned[] = rows.map((row) => ({ ...row, level: highest([row.budget, row.opex, row.capex]) as string }));
      if (planned.length > 0) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, resource, level, tenant_id)
           SELECT p.role_id, n.resource, p.level, p.tenant_id
             FROM unnest($1::uuid[], $2::text[], $3::uuid[]) AS p(role_id, level, tenant_id)
            CROSS JOIN (VALUES ('opex'), ('capex')) AS n(resource)
           ON CONFLICT (role_id, resource) DO UPDATE
             SET level = EXCLUDED.level, tenant_id = EXCLUDED.tenant_id, updated_at = now()
           WHERE role_permissions.level IS DISTINCT FROM EXCLUDED.level
              OR role_permissions.tenant_id IS DISTINCT FROM EXCLUDED.tenant_id`,
          [planned.map((p) => p.role_id), planned.map((p) => p.level), planned.map((p) => p.tenant_id)],
        );
      }
      const removed = await countOf(queryRunner, `DELETE FROM role_permissions WHERE resource = 'budget'`);
      await assertNoneLeft(queryRunner, ['budget'], 'down');
      await assertLevels(
        queryRunner,
        planned.flatMap((p) => [
          { role_id: p.role_id, resource: 'opex', level: p.level },
          { role_id: p.role_id, resource: 'capex', level: p.level },
        ]),
        'down',
      );
      console.log(
        `${LOG_PREFIX} reverted in ${Date.now() - started} ms: ${planned.length} role(s) hold opex and capex at their budget level `
        + `(${removed} budget row(s) removed); the levels that differed before up() are not restorable`,
      );
    });
  }
}

/**
 * Each role with a row of `resources`, of its own tenant, with its `opex`, `capex` and `budget`
 * levels (one row each at most: UNIQUE (role_id, resource)). Ordered for the log.
 */
async function rightsOf(queryRunner: QueryRunner, resources: string[]): Promise<RightRow[]> {
  return queryRunner.query(
    `SELECT r.id::text AS role_id, r.tenant_id::text AS tenant_id, t.slug::text AS slug, r.role_name,
            max(rp.level) FILTER (WHERE rp.resource = 'opex') AS opex,
            max(rp.level) FILTER (WHERE rp.resource = 'capex') AS capex,
            max(rp.level) FILTER (WHERE rp.resource = 'budget') AS budget
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
       LEFT JOIN tenants t ON t.id = r.tenant_id
      WHERE rp.resource IN ('opex', 'capex', 'budget')
      GROUP BY r.id, r.tenant_id, t.slug, r.role_name
     HAVING bool_or(rp.resource = ANY ($1::text[]))
      ORDER BY t.slug NULLS LAST, r.tenant_id, r.role_name, r.id`,
    [resources],
  );
}

/**
 * A role whose levels differed, that had one of the two rows only, a `manager` row, or a `budget`
 * row already (no code read it before lot R: from now on it counts).
 */
function differs(p: Planned): boolean {
  return p.opex !== p.capex || p.opex === 'manager' || p.budget !== null;
}

function logMerge(planned: Planned[], strays: Stray[]): void {
  const byTenant = new Map<string, Planned[]>();
  for (const p of planned) {
    const list = byTenant.get(p.tenant_id) ?? [];
    list.push(p);
    byTenant.set(p.tenant_id, list);
  }
  for (const roles of byTenant.values()) {
    const tenant = tenantName(roles[0]);
    console.log(`${LOG_PREFIX} tenant ${tenant}: ${roles.length} role(s) merged into budget`);
    for (const p of roles.filter(differs)) {
      const before = `opex=${shown(p.opex)}, capex=${shown(p.capex)}${p.budget ? `, budget=${p.budget}` : ''}`;
      console.log(`${LOG_PREFIX} tenant ${tenant}: role "${p.role_name}" (${p.role_id}): ${before} -> budget=${p.level}`);
    }
  }
  if (strays.length > 0) {
    const named = strays.slice(0, NAMED_ROWS)
      .map((row) => `role ${row.role_id} of tenant ${row.role_tenant}: ${row.resource}=${row.level} written for tenant ${row.row_tenant ?? 'none'}`)
      .join('; ');
    const more = strays.length > NAMED_ROWS ? `; and ${strays.length - NAMED_ROWS} more` : '';
    console.log(`${LOG_PREFIX} ${strays.length} opex/capex row(s) of another tenant than their role (never read) deleted: ${named}${more}`);
  }
}

async function assertNoneLeft(queryRunner: QueryRunner, resources: string[], step: string): Promise<void> {
  const [{ n }]: Array<{ n: number }> = await queryRunner.query(
    `SELECT count(*)::int AS n FROM role_permissions WHERE resource = ANY ($1::text[])`,
    [resources],
  );
  if (n > 0) throw new Error(`${LOG_PREFIX} ${step}: ${n} ${resources.join('/')} row(s) left after the merge; nothing was changed.`);
}

async function assertLevels(
  queryRunner: QueryRunner,
  expected: Array<{ role_id: string; resource: string; level: string }>,
  step: string,
): Promise<void> {
  if (expected.length === 0) return;
  const wrong: Array<{ role_id: string; resource: string; expected: string; found: string | null }> = await queryRunner.query(
    `SELECT e.role_id::text AS role_id, e.resource, e.level AS expected, rp.level AS found
       FROM unnest($1::uuid[], $2::text[], $3::text[]) AS e(role_id, resource, level)
       LEFT JOIN role_permissions rp ON rp.role_id = e.role_id AND rp.resource = e.resource
      WHERE rp.level IS DISTINCT FROM e.level
      LIMIT 5`,
    [expected.map((e) => e.role_id), expected.map((e) => e.resource), expected.map((e) => e.level)],
  );
  if (wrong.length > 0) {
    const named = wrong.map((w) => `${w.role_id} ${w.resource}=${w.found ?? 'none'} (expected ${w.expected})`).join(', ');
    throw new Error(`${LOG_PREFIX} ${step}: role(s) ${named}; nothing was changed.`);
  }
}

/** A DELETE through the query runner returns [rows, count]: the count goes through a CTE. */
async function countOf(queryRunner: QueryRunner, statement: string): Promise<number> {
  const [{ n }]: Array<{ n: number }> = await queryRunner.query(`WITH changed AS (${statement} RETURNING 1) SELECT count(*)::int AS n FROM changed`);
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
