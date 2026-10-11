import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] BudgetRight:';

/**
 * The levels the permission guard of before lot R gave access with (`permission.guard.ts`, `RANK`).
 * `manager`, a level of before the RBAC overhaul that the CHECK still accepts, is not among them:
 * the guard ranked it 0, so such a row opened no route, and it opens none after this migration.
 */
const EFFECTIVE_RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

/** The description `seedTenantDefaults` gave the built-in Budget Administrator role, before and since lot R. */
const BUDGET_ADMIN_ROLE = 'Budget Administrator';
const BUDGET_ADMIN_BEFORE = 'Full control over budget management including OPEX, CAPEX, contracts, and reporting';
const BUDGET_ADMIN_AFTER = 'Full control over budget management including budget lines, contracts, and reporting';

/** One `opex`, `capex` or `budget` row, with its role and the tenants of both. */
type RightRow = {
  role_id: string;
  role_name: string;
  role_tenant: string;
  role_slug: string | null;
  resource: 'opex' | 'capex' | 'budget';
  level: string;
  row_tenant: string | null;
  row_slug: string | null;
};

/** A role and the `budget` level it ends with (null: no budget right). */
type RolePlan = { role_id: string; role_name: string; tenant_id: string; slug: string | null; rows: RightRow[]; level: string | null };

/** A row the guard of before lot R read and gave access with: of its role's tenant (row level security), at a ranked level. */
function isEffective(row: RightRow): boolean {
  return row.row_tenant === row.role_tenant && EFFECTIVE_RANK[row.level] !== undefined;
}

/** The highest effective level of the rows, or null when none gives access. */
function highestEffective(rows: RightRow[]): string | null {
  let best: string | null = null;
  for (const row of rows) {
    if (!isEffective(row)) continue;
    if (!best || EFFECTIVE_RANK[row.level] > EFFECTIVE_RANK[best]) best = row.level;
  }
  return best;
}

const tenantName = (slug: string | null, id: string | null) => `${slug || '(no slug)'} (${id ?? 'none'})`;

/** The roles of the rows, in their order, each with its rows. */
function byRole(rows: RightRow[], level: (rows: RightRow[]) => string | null): RolePlan[] {
  const plans = new Map<string, RolePlan>();
  for (const row of rows) {
    let plan = plans.get(row.role_id);
    if (!plan) {
      plan = { role_id: row.role_id, role_name: row.role_name, tenant_id: row.role_tenant, slug: row.role_slug, rows: [], level: null };
      plans.set(row.role_id, plan);
    }
    plan.rows.push(row);
  }
  for (const plan of plans.values()) plan.level = level(plan.rows);
  return [...plans.values()];
}

/**
 * One right for every budget line (plan planning/budget-unifie.md, amendment of U5, lot R): the
 * permission resources `opex` and `capex` become the single resource `budget`, whatever the
 * nature of the line. The nature stays a property of the line (the nature predicate of every
 * query, the `/capex-items*` aliases, the freeze by nature under `budget_ops` do not change).
 *
 * The rule: after the migration, each role opens what it opened before on its better nature. Its
 * `budget` level is the highest of its effective `opex` and `capex` levels, as the permission
 * guard of before lot R read them (`reader < contributor < member < admin`); a row that guard gave
 * no access with gives none: a `manager` row (ranked 0), a row whose `tenant_id` is not its role's
 * (row level security hid it). A role whose two levels differed, or that had one of the two only,
 * gets the higher on every budget line, as decided.
 *
 * up(), with row level security lifted on `role_permissions` and `roles` and put back as found:
 * 1. The tenants of before lot R are those with an `opex` or `capex` row on one of their roles
 *    (every tenant of before has one: its Administrator role holds all of them). In those tenants
 *    only, every role with an `opex`, `capex` or `budget` row is planned: `budget` = its highest
 *    effective `opex` or `capex` level, or no `budget` right when none is effective. A `budget` row
 *    already there (no code read it before lot R) does not count: it is replaced, or deleted.
 * 2. `INSERT ... ON CONFLICT (role_id, resource) DO UPDATE` writes each planned level with the
 *    role's tenant; the `budget` row of a role left without a level is deleted; then every `opex`
 *    and `capex` row goes.
 * 3. The built-in Budget Administrator role whose description is still the one seeded before lot R
 *    gets the one seeded since; a description changed by hand is left as it is. Counted.
 * 4. One log line per tenant (roles merged), one per role whose two levels differed, that had one
 *    of them only, a row that gave no access (`manager`, another tenant's, named with both
 *    tenants) or a `budget` row already (levels before, level after), and a summary.
 * 5. Checks, an exception otherwise (so the transaction is rolled back): no `opex` or `capex` row
 *    is left, and every planned role holds `budget` at its level, or none.
 * A second run finds no tenant of before lot R: it changes no right (the `budget` rows of a tenant
 * already merged are its own) and checks again.
 *
 * down() copies each role's `budget` level onto `opex` and `capex` (the highest effective level of
 * its `budget` row and of any `opex` or `capex` row left), deletes `budget`, and puts the
 * description of before back on a built-in Budget Administrator that still has the one of up().
 * The levels a role had on OPEX and CAPEX before up(), when they differed, the `manager` rows and
 * the rows up() deleted are not restorable: both natures get the merged level (like
 * 1837000000000, which cannot restore what it folded).
 */
export class BudgetRight1853990000000 implements MigrationInterface {
  name = 'BudgetRight1853990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await withoutRowSecurity(queryRunner, ['role_permissions', 'roles'], async () => {
      const rows = await rowsOfTenantsBeforeR(queryRunner);
      const plans = byRole(rows, (own) => highestEffective(own.filter((row) => row.resource !== 'budget')));
      const kept = plans.filter((plan) => plan.level !== null);
      const dropped = plans.filter((plan) => plan.level === null && plan.rows.some((row) => row.resource === 'budget'));

      if (kept.length > 0) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, resource, level, tenant_id)
           SELECT p.role_id, 'budget', p.level, p.tenant_id
             FROM unnest($1::uuid[], $2::text[], $3::uuid[]) AS p(role_id, level, tenant_id)
           ON CONFLICT (role_id, resource) DO UPDATE
             SET level = EXCLUDED.level, tenant_id = EXCLUDED.tenant_id, updated_at = now()
           WHERE role_permissions.level IS DISTINCT FROM EXCLUDED.level
              OR role_permissions.tenant_id IS DISTINCT FROM EXCLUDED.tenant_id`,
          [kept.map((p) => p.role_id), kept.map((p) => p.level), kept.map((p) => p.tenant_id)],
        );
      }
      if (dropped.length > 0) {
        await queryRunner.query(
          `DELETE FROM role_permissions WHERE resource = 'budget' AND role_id = ANY ($1::uuid[])`,
          [dropped.map((p) => p.role_id)],
        );
      }
      const removed = await countOf(queryRunner, `DELETE FROM role_permissions WHERE resource IN ('opex', 'capex')`);
      const described = await countOf(
        queryRunner,
        `UPDATE roles SET role_description = $1 WHERE is_built_in AND role_name = $2 AND role_description = $3`,
        [BUDGET_ADMIN_AFTER, BUDGET_ADMIN_ROLE, BUDGET_ADMIN_BEFORE],
      );

      await assertNoneLeft(queryRunner, ['opex', 'capex'], 'up');
      await assertLevels(queryRunner, plans.map((p) => ({ role_id: p.role_id, resource: 'budget', level: p.level })), 'up');

      logMerge(plans);
      const ms = Date.now() - started;
      const descriptions = `${described} built-in ${BUDGET_ADMIN_ROLE} description(s) updated`;
      if (plans.length === 0 && removed === 0) {
        console.log(`${LOG_PREFIX} no opex or capex right left; nothing to merge; ${descriptions} (${ms} ms)`);
      } else {
        const tenants = new Set(plans.map((p) => p.tenant_id)).size;
        console.log(
          `${LOG_PREFIX} done in ${ms} ms: ${plans.length} role(s) of ${tenants} tenant(s) merged, ${kept.length} with a budget right, `
          + `${plans.length - kept.length} without; ${plans.filter(isListed).length} listed above; ${removed} opex/capex row(s) removed; ${descriptions}`,
        );
      }
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await withoutRowSecurity(queryRunner, ['role_permissions', 'roles'], async () => {
      const rows = await rowsOfRolesWithBudget(queryRunner);
      const plans = byRole(rows, highestEffective);
      const kept = plans.filter((plan) => plan.level !== null);
      if (kept.length > 0) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, resource, level, tenant_id)
           SELECT p.role_id, n.resource, p.level, p.tenant_id
             FROM unnest($1::uuid[], $2::text[], $3::uuid[]) AS p(role_id, level, tenant_id)
            CROSS JOIN (VALUES ('opex'), ('capex')) AS n(resource)
           ON CONFLICT (role_id, resource) DO UPDATE
             SET level = EXCLUDED.level, tenant_id = EXCLUDED.tenant_id, updated_at = now()
           WHERE role_permissions.level IS DISTINCT FROM EXCLUDED.level
              OR role_permissions.tenant_id IS DISTINCT FROM EXCLUDED.tenant_id`,
          [kept.map((p) => p.role_id), kept.map((p) => p.level), kept.map((p) => p.tenant_id)],
        );
      }
      const removed = await countOf(queryRunner, `DELETE FROM role_permissions WHERE resource = 'budget'`);
      const described = await countOf(
        queryRunner,
        `UPDATE roles SET role_description = $1 WHERE is_built_in AND role_name = $2 AND role_description = $3`,
        [BUDGET_ADMIN_BEFORE, BUDGET_ADMIN_ROLE, BUDGET_ADMIN_AFTER],
      );
      await assertNoneLeft(queryRunner, ['budget'], 'down');
      await assertLevels(
        queryRunner,
        kept.flatMap((p) => [
          { role_id: p.role_id, resource: 'opex', level: p.level },
          { role_id: p.role_id, resource: 'capex', level: p.level },
        ]),
        'down',
      );
      console.log(
        `${LOG_PREFIX} reverted in ${Date.now() - started} ms: ${kept.length} role(s) hold opex and capex at their budget level `
        + `(${removed} budget row(s) removed; ${described} built-in ${BUDGET_ADMIN_ROLE} description(s) put back); `
        + 'the levels that differed before up() and the rows up() deleted are not restorable',
      );
    });
  }
}

const RIGHT_ROW_COLUMNS = `r.id::text AS role_id, r.role_name, r.tenant_id::text AS role_tenant, rt.slug::text AS role_slug,
       rp.resource, rp.level, rp.tenant_id::text AS row_tenant, wt.slug::text AS row_slug`;

/**
 * The `opex`, `capex` and `budget` rows of the roles of the tenants of before lot R (a tenant with
 * an `opex` or `capex` row on one of its roles), ordered for the log.
 */
async function rowsOfTenantsBeforeR(queryRunner: QueryRunner): Promise<RightRow[]> {
  return queryRunner.query(
    `SELECT ${RIGHT_ROW_COLUMNS}
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       LEFT JOIN tenants rt ON rt.id = r.tenant_id
       LEFT JOIN tenants wt ON wt.id = rp.tenant_id
      WHERE rp.resource IN ('opex', 'capex', 'budget')
        AND r.tenant_id IN (SELECT r2.tenant_id FROM role_permissions rp2 JOIN roles r2 ON r2.id = rp2.role_id
                             WHERE rp2.resource IN ('opex', 'capex'))
      ORDER BY rt.slug NULLS LAST, r.tenant_id, r.role_name, r.id, rp.resource DESC`,
  );
}

/** The `opex`, `capex` and `budget` rows of the roles that hold a `budget` row (down()). */
async function rowsOfRolesWithBudget(queryRunner: QueryRunner): Promise<RightRow[]> {
  return queryRunner.query(
    `SELECT ${RIGHT_ROW_COLUMNS}
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       LEFT JOIN tenants rt ON rt.id = r.tenant_id
       LEFT JOIN tenants wt ON wt.id = rp.tenant_id
      WHERE rp.resource IN ('opex', 'capex', 'budget')
        AND r.id IN (SELECT role_id FROM role_permissions WHERE resource = 'budget')
      ORDER BY rt.slug NULLS LAST, r.tenant_id, r.role_name, r.id, rp.resource DESC`,
  );
}

const ofResource = (plan: RolePlan, resource: RightRow['resource']) => plan.rows.filter((row) => row.resource === resource);

/**
 * A role named in the log: its effective OPEX and CAPEX levels differed (one of them absent
 * included), or it had a row that gave no access (`manager`, another tenant's) or a `budget` row.
 */
function isListed(plan: RolePlan): boolean {
  const opex = highestEffective(ofResource(plan, 'opex'));
  const capex = highestEffective(ofResource(plan, 'capex'));
  return opex !== capex || plan.rows.some((row) => row.resource === 'budget' || !isEffective(row));
}

/** `opex=admin`, `capex=manager (no access)`, `opex=admin (row of tenant x (id), never read)`, `budget=admin (no effect before lot R)`. */
function describeRow(row: RightRow): string {
  const notes: string[] = [];
  if (row.row_tenant !== row.role_tenant) notes.push(`row of tenant ${tenantName(row.row_slug, row.row_tenant)}, never read`);
  else if (EFFECTIVE_RANK[row.level] === undefined) notes.push('no access');
  if (row.resource === 'budget') notes.push('no effect before lot R');
  return `${row.resource}=${row.level}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`;
}

function logMerge(plans: RolePlan[]): void {
  const byTenant = new Map<string, RolePlan[]>();
  for (const plan of plans) {
    const list = byTenant.get(plan.tenant_id) ?? [];
    list.push(plan);
    byTenant.set(plan.tenant_id, list);
  }
  for (const roles of byTenant.values()) {
    const tenant = tenantName(roles[0].slug, roles[0].tenant_id);
    console.log(`${LOG_PREFIX} tenant ${tenant}: ${roles.length} role(s) merged into budget`);
    for (const plan of roles.filter(isListed)) {
      const before = (['opex', 'capex', 'budget'] as const)
        .flatMap((resource) => {
          const own = ofResource(plan, resource);
          if (own.length === 0) return resource === 'budget' ? [] : [`${resource}=none`];
          return own.map(describeRow);
        })
        .join(', ');
      const after = plan.level ? `budget=${plan.level}` : 'no budget right';
      console.log(`${LOG_PREFIX} tenant ${tenant}: role "${plan.role_name}" (${plan.role_id}): ${before} -> ${after}`);
    }
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
  expected: Array<{ role_id: string; resource: string; level: string | null }>,
  step: string,
): Promise<void> {
  if (expected.length === 0) return;
  // An expected level of null: no row of that resource.
  const wrong: Array<{ role_id: string; resource: string; expected: string | null; found: string | null }> = await queryRunner.query(
    `SELECT e.role_id::text AS role_id, e.resource, e.level AS expected, rp.level AS found
       FROM unnest($1::uuid[], $2::text[], $3::text[]) AS e(role_id, resource, level)
       LEFT JOIN role_permissions rp ON rp.role_id = e.role_id AND rp.resource = e.resource
      WHERE rp.level IS DISTINCT FROM e.level
      LIMIT 5`,
    [expected.map((e) => e.role_id), expected.map((e) => e.resource), expected.map((e) => e.level)],
  );
  if (wrong.length > 0) {
    const named = wrong.map((w) => `${w.role_id} ${w.resource}=${w.found ?? 'none'} (expected ${w.expected ?? 'none'})`).join(', ');
    throw new Error(`${LOG_PREFIX} ${step}: role(s) ${named}; nothing was changed.`);
  }
}

/** An UPDATE or DELETE through the query runner returns [rows, count]: the count goes through a CTE. */
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
