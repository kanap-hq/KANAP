import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] OrganizationRight:';

/** A role that gets `organization:admin`, with the `organization` row it may hold already. */
type PlannedRole = {
  role_id: string;
  role_name: string;
  tenant_id: string;
  slug: string | null;
  administrator: boolean;
  /** The role's `organization` row before the migration (null: none). */
  level: string | null;
  row_tenant: string | null;
};

/** What up() does to a planned role. */
type Action = 'insert' | 'update' | 'keep';

const tenantName = (slug: string | null, id: string) => `${slug || '(no slug)'} (${id})`;

/**
 * The `organization` right: Admin › Branding, Admin › Authentication and Admin › Audit
 * log move from `users:admin` to `organization` (reader, admin). After the migration, every role
 * keeps the pages it opened.
 *
 * up(), without `app.current_tenant`, with row level security lifted on `role_permissions` and
 * `roles` and put back as found:
 * 1. The planned roles: each role with a `users:admin` row of its own tenant (a row of another
 *    tenant was hidden by row level security and opened nothing), and each Administrator role,
 *    recognised by its name as PermissionGuard does (`lower(role_name) = 'administrator'`; the
 *    system role names are reserved), even without a `users` row: the Roles screen and the
 *    assistant read its rows.
 * 2. A planned role without an `organization` row gets `organization:admin`, written with the
 *    role's tenant (`ON CONFLICT (role_id, resource) DO NOTHING`). An Administrator whose row is
 *    below admin is put back to admin. A custom role's row of its own tenant at `reader` or
 *    `admin` is kept as it is (a row set by hand: the roles screen did not validate resource
 *    names); at any other level (`manager`, which PermissionGuard does not rank, `member`,
 *    `contributor`) it is set to admin, as the role's `users:admin` gives. A row whose tenant is
 *    not its role's opened nothing: it is rewritten as `organization:admin` of the role's tenant.
 * 3. Checks, an exception otherwise (the transaction is rolled back): every planned role holds an
 *    `organization` row of its own tenant, at admin for an Administrator.
 * 4. One log line per tenant with a role given the right, one per role whose row was rewritten or
 *    kept below admin, a summary with the counts. No audit entry (a migration writes none).
 * A second run plans the same roles and writes no row.
 *
 * down() deletes every `organization` row, a row set by hand before up() included. A role given
 * `users:admin` after up() never had the three pages through `organization`: down() gives them
 * back through `users:admin` (the code of before reads it).
 */
export class OrganizationRight1856330000000 implements MigrationInterface {
  name = 'OrganizationRight1856330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await withoutRowSecurity(queryRunner, ['role_permissions', 'roles'], async () => {
      const planned: PlannedRole[] = await queryRunner.query(
        `SELECT r.id::text AS role_id, r.role_name, r.tenant_id::text AS tenant_id, t.slug::text AS slug,
                lower(r.role_name) = 'administrator' AS administrator,
                o.level, o.tenant_id::text AS row_tenant
           FROM roles r
           LEFT JOIN tenants t ON t.id = r.tenant_id
           LEFT JOIN role_permissions o ON o.role_id = r.id AND o.resource = 'organization'
          WHERE lower(r.role_name) = 'administrator'
             OR EXISTS (
                  SELECT 1 FROM role_permissions u
                   WHERE u.role_id = r.id AND u.resource = 'users' AND u.level = 'admin' AND u.tenant_id = r.tenant_id
                )
          ORDER BY t.slug NULLS LAST, r.tenant_id, r.role_name, r.id`,
      );
      const actions = new Map(planned.map((role) => [role.role_id, actionFor(role)]));
      const toInsert = planned.filter((role) => actions.get(role.role_id) === 'insert');
      const toUpdate = planned.filter((role) => actions.get(role.role_id) === 'update');

      const inserted = toInsert.length === 0 ? 0 : await countOf(
        queryRunner,
        `INSERT INTO role_permissions (role_id, resource, level, tenant_id)
         SELECT p.role_id, 'organization', 'admin', p.tenant_id
           FROM unnest($1::uuid[], $2::uuid[]) AS p(role_id, tenant_id)
         ON CONFLICT (role_id, resource) DO NOTHING`,
        [toInsert.map((role) => role.role_id), toInsert.map((role) => role.tenant_id)],
      );
      const updated = toUpdate.length === 0 ? 0 : await countOf(
        queryRunner,
        `UPDATE role_permissions rp
            SET level = 'admin', tenant_id = p.tenant_id, updated_at = now()
           FROM unnest($1::uuid[], $2::uuid[]) AS p(role_id, tenant_id)
          WHERE rp.role_id = p.role_id AND rp.resource = 'organization'`,
        [toUpdate.map((role) => role.role_id), toUpdate.map((role) => role.tenant_id)],
      );

      await assertPlannedRolesHoldTheRight(queryRunner, planned);

      logChanges(planned, actions);
      const tenants = new Set(planned.map((role) => role.tenant_id)).size;
      const administrators = planned.filter((role) => role.administrator).length;
      const kept = planned.length - toInsert.length - toUpdate.length;
      const otherLevel = toUpdate.filter((role) => !isReaderOrAdmin(role.level)).length;
      console.log(
        `${LOG_PREFIX} done in ${Date.now() - started} ms: ${planned.length} role(s) of ${tenants} tenant(s) planned `
        + `(${administrators} Administrator, ${planned.length - administrators} with users:admin); `
        + `${inserted} organization:admin row(s) added, ${updated} row(s) set to admin `
        + `(${otherLevel} of them at a level other than reader or admin), ${kept} row(s) already there kept`,
      );
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await withoutRowSecurity(queryRunner, ['role_permissions'], async () => {
      const removed = await countOf(queryRunner, `DELETE FROM role_permissions WHERE resource = 'organization'`);
      console.log(`${LOG_PREFIX} reverted in ${Date.now() - started} ms: ${removed} organization row(s) removed`);
    });
  }
}

const isReaderOrAdmin = (level: string | null) => level === 'reader' || level === 'admin';

/**
 * Insert: no row. Update: a row of another tenant (it opened nothing), a row at a level other than
 * reader or admin, or an Administrator below admin. Keep: the role's own row at reader or admin, of
 * a custom role, or of an Administrator at admin.
 */
function actionFor(role: PlannedRole): Action {
  if (role.level === null) return 'insert';
  if (role.row_tenant !== role.tenant_id) return 'update';
  if (!isReaderOrAdmin(role.level)) return 'update';
  if (role.administrator && role.level !== 'admin') return 'update';
  return 'keep';
}

function logChanges(planned: PlannedRole[], actions: Map<string, Action>): void {
  const byTenant = new Map<string, PlannedRole[]>();
  for (const role of planned) {
    const list = byTenant.get(role.tenant_id) ?? [];
    list.push(role);
    byTenant.set(role.tenant_id, list);
  }
  for (const roles of byTenant.values()) {
    const tenant = tenantName(roles[0].slug, roles[0].tenant_id);
    const added = roles.filter((role) => actions.get(role.role_id) === 'insert').length;
    if (added > 0) console.log(`${LOG_PREFIX} tenant ${tenant}: ${added} role(s) given organization:admin`);
    for (const role of roles) {
      const action = actions.get(role.role_id);
      // Named: a row rewritten, or a custom role's row below admin, kept (a row at admin is the right given).
      if (action === 'insert' || (action === 'keep' && role.level === 'admin')) continue;
      const before = role.row_tenant !== role.tenant_id
        ? `organization=${role.level} (row of tenant ${role.row_tenant}, never read)`
        : `organization=${role.level}`;
      const after = action === 'update' ? 'organization=admin' : 'kept';
      console.log(`${LOG_PREFIX} tenant ${tenant}: role "${role.role_name}" (${role.role_id}): ${before} -> ${after}`);
    }
  }
}

async function assertPlannedRolesHoldTheRight(queryRunner: QueryRunner, planned: PlannedRole[]): Promise<void> {
  if (planned.length === 0) return;
  const wrong: Array<{ role_id: string; level: string | null; row_tenant: string | null }> = await queryRunner.query(
    `SELECT p.role_id::text AS role_id, rp.level, rp.tenant_id::text AS row_tenant
       FROM unnest($1::uuid[], $2::uuid[], $3::boolean[]) AS p(role_id, tenant_id, administrator)
       LEFT JOIN role_permissions rp ON rp.role_id = p.role_id AND rp.resource = 'organization'
      WHERE rp.id IS NULL
         OR rp.tenant_id IS DISTINCT FROM p.tenant_id
         OR (p.administrator AND rp.level <> 'admin')
      LIMIT 5`,
    [planned.map((role) => role.role_id), planned.map((role) => role.tenant_id), planned.map((role) => role.administrator)],
  );
  if (wrong.length > 0) {
    const named = wrong.map((w) => `${w.role_id} organization=${w.level ?? 'none'}${w.row_tenant ? ` (tenant ${w.row_tenant})` : ''}`).join(', ');
    throw new Error(`${LOG_PREFIX} role(s) ${named} do not hold the organization right after the migration; nothing was changed.`);
  }
}

/** An UPDATE or DELETE through the query runner returns [rows, count]: the count goes through a CTE. */
async function countOf(queryRunner: QueryRunner, statement: string, params: unknown[] = []): Promise<number> {
  const [{ n }]: Array<{ n: number }> = await queryRunner.query(`WITH changed AS (${statement} RETURNING 1) SELECT count(*)::int AS n FROM changed`, params);
  return n;
}

/**
 * Runs `fn` with row level security off on the tables, then restores what was found, also when
 * `fn` fails (copy of 1853990000000). After a failed statement the transaction is aborted and
 * refuses the restore: its rollback restores the state then, and the error of `fn` is the one
 * reported.
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
