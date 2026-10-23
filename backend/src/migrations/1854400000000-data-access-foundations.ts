import { MigrationInterface, QueryRunner } from 'typeorm';

/** Written as the comment of each unique key this migration adds, so down() drops only those. */
const MARK = 'DataAccessFoundations1854400000000';
const LOG_PREFIX = '[Migration] DataAccessFoundations:';
const LIMITED_ROLE = 'kanap_data_limited';

/**
 * Data-scoped access, lot 1: the foundations (planning/data-scoped-access/spec.md §3, §6.2, §6.3,
 * §9.1). Nothing changes for anyone: every person stays in mode `all`, no data-access policy
 * exists, and the limited role is only taken by `data_access_apply()` for a limited person.
 *
 * 1. `users`: `data_access_mode` (text, NOT NULL DEFAULT 'all', 'all' or 'limited'),
 *    `data_access_updated_at`, `data_access_updated_by` (no foreign key, like the other
 *    `updated_by`). A constant default is instant and keeps the raw seed inserts valid; the check
 *    is created with the column, so no row can violate it and no repair is needed.
 * 2. UNIQUE (tenant_id, id) on `users` and `companies`, unless a unique key on these columns
 *    exists: `id` is their primary key, no row can violate it, no repair is needed. The composite
 *    keys of `user_data_access_nodes` reference them (foreign-key checks bypass row level
 *    security, so the tenant is part of every key).
 * 3. `user_data_access_nodes`: the nodes of a limited person (all, a company, a cost-centre group
 *    or centre), each read or edit; one node once per person; RLS enabled and forced with the
 *    tenant policy.
 * 4. `contracts.cost_center_id`, composite key to `cost_centers` ON DELETE RESTRICT, and its
 *    index. The entity and the API do not read it before lot 5.
 * 5. The functions `data_access_expected_policies()` (empty in lot 1), `data_access_sync_policies()`
 *    (grants of the limited role, stray policies dropped), `data_access_apply(uuid)` and
 *    `data_access_ctx()`, then one sync when the role exists (it is created per server by
 *    infra/scripts/data-access-role.sql).
 *
 * No backfill, row level security is never disabled. Every step looks at the catalog or uses
 * IF NOT EXISTS / CREATE OR REPLACE: a second run changes nothing. down() revokes what the sync
 * granted, then drops the functions, the table, the columns and the unique keys it added.
 */
export class DataAccessFoundations1854400000000 implements MigrationInterface {
  name = 'DataAccessFoundations1854400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. users: the mode and who last changed it.
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS data_access_mode text NOT NULL DEFAULT 'all'`);
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS data_access_updated_at timestamptz NULL`);
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS data_access_updated_by uuid NULL`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'users'::regclass AND conname = 'users_data_access_mode_check'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_data_access_mode_check
            CHECK (data_access_mode IN ('all', 'limited'));
        END IF;
      END
      $$;
    `);

    // 2. Unique keys the composite foreign keys need.
    const usersKey = await addUniqueIfAbsent(queryRunner, 'users', 'users_tenant_id_id_key', ['tenant_id', 'id']);
    const companiesKey = await addUniqueIfAbsent(queryRunner, 'companies', 'companies_tenant_id_id_key', ['tenant_id', 'id']);

    // 3. The nodes of a limited person.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_data_access_nodes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        node_type text NOT NULL,
        company_id uuid NULL,
        cost_center_id uuid NULL,
        access text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NULL,
        CONSTRAINT user_data_access_nodes_node_type_check
          CHECK (node_type IN ('all', 'company', 'cost_center')),
        CONSTRAINT user_data_access_nodes_access_check CHECK (access IN ('read', 'edit')),
        CONSTRAINT user_data_access_nodes_reference_check CHECK (
          (node_type = 'all' AND company_id IS NULL AND cost_center_id IS NULL)
          OR (node_type = 'company' AND company_id IS NOT NULL AND cost_center_id IS NULL)
          OR (node_type = 'cost_center' AND cost_center_id IS NOT NULL AND company_id IS NULL)
        ),
        CONSTRAINT user_data_access_nodes_user_fk FOREIGN KEY (tenant_id, user_id)
          REFERENCES users (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT user_data_access_nodes_company_fk FOREIGN KEY (tenant_id, company_id)
          REFERENCES companies (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT user_data_access_nodes_cost_center_fk FOREIGN KEY (tenant_id, cost_center_id)
          REFERENCES cost_centers (tenant_id, id) ON DELETE RESTRICT
      )
    `);
    // One node once per person, whatever its access.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_data_access_nodes_all
      ON user_data_access_nodes (tenant_id, user_id) WHERE node_type = 'all'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_data_access_nodes_company
      ON user_data_access_nodes (tenant_id, user_id, company_id) WHERE node_type = 'company'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_data_access_nodes_cost_center
      ON user_data_access_nodes (tenant_id, user_id, cost_center_id) WHERE node_type = 'cost_center'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_data_access_nodes_tenant_user
      ON user_data_access_nodes (tenant_id, user_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_data_access_nodes_tenant_company
      ON user_data_access_nodes (tenant_id, company_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_data_access_nodes_tenant_cost_center
      ON user_data_access_nodes (tenant_id, cost_center_id)
    `);
    await queryRunner.query(`ALTER TABLE user_data_access_nodes ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE user_data_access_nodes FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS user_data_access_nodes_tenant_isolation ON user_data_access_nodes`);
    await queryRunner.query(`
      CREATE POLICY user_data_access_nodes_tenant_isolation ON user_data_access_nodes
      USING (tenant_id = app_current_tenant())
      WITH CHECK (tenant_id = app_current_tenant())
    `);

    // 4. The place of a contract in the tree (empty: nobody can guess who manages a contract).
    await queryRunner.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS cost_center_id uuid NULL`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'contracts'::regclass AND conname = 'contracts_cost_center_fk'
        ) THEN
          ALTER TABLE contracts ADD CONSTRAINT contracts_cost_center_fk
            FOREIGN KEY (tenant_id, cost_center_id) REFERENCES cost_centers (tenant_id, id) ON DELETE RESTRICT;
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_contracts_tenant_cost_center ON contracts (tenant_id, cost_center_id)
    `);

    // 5. Functions.
    await createFunctions(queryRunner);

    // Policy DDL takes an exclusive lock on its table: wait 5 s at most, then fail the migration
    // (it is rerun at the next start). In lot 1 the sync only grants and drops strays.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`SELECT data_access_sync_policies()`);
    const roleRows = await queryRunner.query(`SELECT to_regrole($1) IS NOT NULL AS present`, [LIMITED_ROLE]);
    await queryRunner.query(`SET LOCAL lock_timeout = DEFAULT`);

    console.log(
      `${LOG_PREFIX} columns, table and functions ready; `
      + `users key ${usersKey ? 'added' : 'already present'}, companies key ${companiesKey ? 'added' : 'already present'}; `
      + `limited role ${roleRows?.[0]?.present ? 'present, grants synchronised' : 'absent, nothing granted'}`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // What the sync granted to the role, in this database (the role itself is the script's).
    await queryRunner.query(`
      DO $$
      DECLARE
        v_role oid := to_regrole('${LIMITED_ROLE}');
      BEGIN
        IF v_role IS NULL THEN
          RETURN;
        END IF;
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${LIMITED_ROLE};
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${LIMITED_ROLE};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${LIMITED_ROLE};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${LIMITED_ROLE};
        -- Only a direct grant: on PostgreSQL 15 the role reaches public through PUBLIC, which stays.
        IF EXISTS (
          SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
          WHERE n.nspname = 'public' AND a.grantee = v_role
        ) THEN
          REVOKE ALL ON SCHEMA public FROM ${LIMITED_ROLE};
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_ctx()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_apply(uuid)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_sync_policies()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_expected_policies()`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_contracts_tenant_cost_center`);
    await queryRunner.query(`ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_cost_center_fk`);
    await queryRunner.query(`ALTER TABLE contracts DROP COLUMN IF EXISTS cost_center_id`);

    await queryRunner.query(`DROP TABLE IF EXISTS user_data_access_nodes`);

    // Only the keys this migration added: an equivalent key found in place is left as it was.
    await dropMarkedUnique(queryRunner, 'companies', 'companies_tenant_id_id_key');
    await dropMarkedUnique(queryRunner, 'users', 'users_tenant_id_id_key');

    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_data_access_mode_check`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS data_access_updated_by`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS data_access_updated_at`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS data_access_mode`);
  }
}

async function createFunctions(queryRunner: QueryRunner): Promise<void> {
  // The single source of the data-access policies the database must hold: (policy, table,
  // command), command one of SELECT, INSERT, UPDATE, DELETE, ALL. Empty until lot 2, which
  // replaces it (CREATE OR REPLACE, same signature) and calls the sync.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_expected_policies()
    RETURNS TABLE (policy_name text, table_name text, command text)
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $fn$
      SELECT NULL::text, NULL::text, NULL::text WHERE false
    $fn$
  `);

  // Grants of the limited role in this database, then its policies. Called by the migrations that
  // change the expected list and by the API at start (lot 1 run B). Policy DDL takes an exclusive
  // lock: callers set lock_timeout, the function does not.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_sync_policies()
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_role oid := to_regrole('${LIMITED_ROLE}');
      r record;
    BEGIN
      IF v_role IS NULL THEN
        RETURN;
      END IF;

      -- PUBLIC usually holds USAGE on public already; on PostgreSQL 15 the application role holds a
      -- direct grant without grant option there, so grant only when the role lacks it.
      IF NOT has_schema_privilege(v_role, 'public', 'USAGE') THEN
        GRANT USAGE ON SCHEMA public TO ${LIMITED_ROLE};
      END IF;
      -- No TRUNCATE, no UPDATE on sequences (no request path calls setval).
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${LIMITED_ROLE};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${LIMITED_ROLE};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${LIMITED_ROLE};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO ${LIMITED_ROLE};

      -- Policies: every policy that targets the role and is not expected goes, so a down() that
      -- shrinks the expected list and calls the sync removes its own. Lot 2 adds the creation of
      -- the expected ones (DROP POLICY IF EXISTS, then CREATE) after this loop.
      FOR r IN
        SELECT p.polname, c.relname
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND v_role = ANY (p.polroles)
          AND NOT EXISTS (
            SELECT 1 FROM data_access_expected_policies() e
            WHERE e.policy_name = p.polname AND e.table_name = c.relname
          )
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', r.polname, r.relname);
      END LOOP;
    END
    $fn$
  `);
  await queryRunner.query(`REVOKE EXECUTE ON FUNCTION data_access_sync_policies() FROM PUBLIC`);

  // Sets the access of a person for the current transaction (spec §6.3). SECURITY INVOKER:
  // PostgreSQL refuses a role change inside a SECURITY DEFINER function. Reads the person and the
  // nodes under the caller's tenant (app.current_tenant is set by the caller).
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_apply(p_user uuid)
    RETURNS text
    LANGUAGE plpgsql
    VOLATILE
    SECURITY INVOKER
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_tenant uuid := app_current_tenant();
      v_role oid;
      v_mode text;
      v_read_all boolean;
      v_edit_all boolean;
      v_read_companies text;
      v_edit_companies text;
      v_read_nodes text;
      v_edit_nodes text;
      v_edit_node_companies text;
    BEGIN
      -- Once the role is taken (second call in a limited transaction, used by the preview), users,
      -- roles, user_roles and user_data_access_nodes are read as ${LIMITED_ROLE}: it has the grants
      -- and no data-access policy on them. Lot 2 must keep these four tables free of data-access
      -- policies, or this re-read breaks.

      -- 1. Person not found in the tenant: refused, never everything.
      SELECT u.data_access_mode INTO v_mode
      FROM users u
      WHERE u.id = p_user AND u.tenant_id = v_tenant;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'data access: person not found' USING ERRCODE = 'KDA02';
      END IF;

      -- 2. All data: nothing changes.
      IF v_mode = 'all' THEN
        RETURN 'all';
      END IF;

      -- 3. Administrator, by role name, as auth/business-contributor-scope.ts: nothing changes.
      IF EXISTS (
        SELECT 1
        FROM (
          SELECT u.role_id FROM users u WHERE u.id = p_user AND u.tenant_id = v_tenant
          UNION
          SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = p_user AND ur.tenant_id = v_tenant
        ) assigned
        JOIN roles r ON r.id = assigned.role_id AND r.tenant_id = v_tenant
        WHERE lower(trim(r.role_name)) = 'administrator'
      ) THEN
        RETURN 'all';
      END IF;

      -- 4. Availability: the role exists, the session role does not inherit it, every expected
      -- policy exists, restrictive, on the expected command and targeting the role. When the
      -- transaction already runs as the role (second call), the role it came from is not visible
      -- any more: the inheritance check ran at the first call.
      v_role := to_regrole('${LIMITED_ROLE}');
      IF v_role IS NULL THEN
        RAISE EXCEPTION 'data access unavailable' USING ERRCODE = 'KDA01';
      END IF;
      IF current_user <> '${LIMITED_ROLE}' AND pg_has_role(current_user, v_role, 'USAGE') THEN
        RAISE EXCEPTION 'data access unavailable' USING ERRCODE = 'KDA01';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM data_access_expected_policies() e
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = e.table_name
            AND p.polname = e.policy_name
            AND NOT p.polpermissive
            AND v_role = ANY (p.polroles)
            AND p.polcmd::text = CASE upper(e.command)
              WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w'
              WHEN 'DELETE' THEN 'd' WHEN 'ALL' THEN '*' END
        )
      ) THEN
        RAISE EXCEPTION 'data access unavailable' USING ERRCODE = 'KDA01';
      END IF;

      -- 5. The nodes, the tree unfolded. A company node brings the company and its centres; a
      -- group brings itself, its subgroups and their centres, whatever their company; a centre
      -- brings itself. Disabled nodes count (disabling a node does not change access). Every edit
      -- node is also a read node.
      WITH RECURSIVE seeds AS (
        SELECT n.node_type, n.company_id, n.cost_center_id, n.access
        FROM user_data_access_nodes n
        WHERE n.tenant_id = v_tenant AND n.user_id = p_user
      ),
      tree (id, company_id, access) AS (
        SELECT c.id, c.company_id, s.access
        FROM seeds s
        JOIN cost_centers c ON c.tenant_id = v_tenant AND c.id = s.cost_center_id
        WHERE s.node_type = 'cost_center'
        UNION
        SELECT c.id, c.company_id, s.access
        FROM seeds s
        JOIN cost_centers c ON c.tenant_id = v_tenant AND c.company_id = s.company_id
        WHERE s.node_type = 'company'
        UNION
        SELECT ch.id, ch.company_id, t.access
        FROM tree t
        JOIN cost_centers ch ON ch.tenant_id = v_tenant AND ch.parent_id = t.id
      )
      SELECT
        EXISTS (SELECT 1 FROM seeds WHERE node_type = 'all'),
        EXISTS (SELECT 1 FROM seeds WHERE node_type = 'all' AND access = 'edit'),
        coalesce((SELECT array_agg(DISTINCT company_id ORDER BY company_id) FROM seeds
                  WHERE node_type = 'company'), '{}'::uuid[])::text,
        coalesce((SELECT array_agg(DISTINCT company_id ORDER BY company_id) FROM seeds
                  WHERE node_type = 'company' AND access = 'edit'), '{}'::uuid[])::text,
        coalesce((SELECT array_agg(DISTINCT id ORDER BY id) FROM tree), '{}'::uuid[])::text,
        coalesce((SELECT array_agg(DISTINCT id ORDER BY id) FROM tree WHERE access = 'edit'), '{}'::uuid[])::text,
        coalesce((SELECT array_agg(DISTINCT company_id ORDER BY company_id) FROM tree
                  WHERE access = 'edit' AND company_id IS NOT NULL), '{}'::uuid[])::text
      INTO v_read_all, v_edit_all, v_read_companies, v_edit_companies, v_read_nodes, v_edit_nodes,
           v_edit_node_companies;

      -- 6. The nine settings in one statement, then no JIT (it would compile the policy
      -- expressions on every statement), then the role.
      PERFORM
        set_config('app.da_mode', 'limited', true),
        set_config('app.da_user', p_user::text, true),
        set_config('app.da_read_all', CASE WHEN v_read_all THEN 'true' ELSE 'false' END, true),
        set_config('app.da_edit_all', CASE WHEN v_edit_all THEN 'true' ELSE 'false' END, true),
        set_config('app.da_read_companies', v_read_companies, true),
        set_config('app.da_edit_companies', v_edit_companies, true),
        set_config('app.da_read_nodes', v_read_nodes, true),
        set_config('app.da_edit_nodes', v_edit_nodes, true),
        set_config('app.da_edit_node_companies', v_edit_node_companies, true);
      PERFORM set_config('jit', 'off', true);
      BEGIN
        PERFORM set_config('role', '${LIMITED_ROLE}', true);
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'data access unavailable' USING ERRCODE = 'KDA01';
      END;

      -- 7.
      RETURN 'limited';
    END
    $fn$
  `);

  // The access of the current transaction as typed JSON, for the application's "editable" column
  // (lot 3); the policies read the settings directly. A setting cleared by a rollback reads ''.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_ctx()
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $fn$
      SELECT CASE
        WHEN NULLIF(current_setting('app.da_mode', true), '') = 'limited' THEN jsonb_build_object(
          'mode', 'limited',
          'user', NULLIF(current_setting('app.da_user', true), '')::uuid,
          'read_all', coalesce(NULLIF(current_setting('app.da_read_all', true), '')::boolean, false),
          'edit_all', coalesce(NULLIF(current_setting('app.da_edit_all', true), '')::boolean, false),
          'read_companies', to_jsonb(coalesce(NULLIF(current_setting('app.da_read_companies', true), '')::uuid[], '{}'::uuid[])),
          'edit_companies', to_jsonb(coalesce(NULLIF(current_setting('app.da_edit_companies', true), '')::uuid[], '{}'::uuid[])),
          'read_nodes', to_jsonb(coalesce(NULLIF(current_setting('app.da_read_nodes', true), '')::uuid[], '{}'::uuid[])),
          'edit_nodes', to_jsonb(coalesce(NULLIF(current_setting('app.da_edit_nodes', true), '')::uuid[], '{}'::uuid[])),
          'edit_node_companies', to_jsonb(coalesce(NULLIF(current_setting('app.da_edit_node_companies', true), '')::uuid[], '{}'::uuid[]))
        )
        ELSE '{"mode":"all"}'::jsonb
      END
    $fn$
  `);
}

/**
 * Adds `name` UNIQUE (columns) and marks it, unless a unique key on exactly these columns already
 * exists (a constraint or a plain unique index a foreign key can reference; an index left invalid by
 * a failed concurrent build does not count). Same check as `1854270000000`. True when added.
 */
async function addUniqueIfAbsent(queryRunner: QueryRunner, table: string, name: string, columns: string[]): Promise<boolean> {
  const existing = await queryRunner.query(
    `SELECT 1
     FROM pg_index i
     WHERE i.indrelid = $1::regclass
       AND i.indisunique AND i.indimmediate AND i.indisvalid AND i.indisready
       AND i.indpred IS NULL AND i.indexprs IS NULL
       AND i.indnkeyatts = cardinality($2::text[])
       AND (
         SELECT array_agg(a.attname::text ORDER BY a.attname::text)
         FROM unnest((i.indkey::int2[])[0:i.indnkeyatts - 1]) AS k(attnum)
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       ) = (SELECT array_agg(c ORDER BY c) FROM unnest($2::text[]) AS c)`,
    [table, columns],
  );
  if (existing.length > 0) return false;
  await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${columns.join(', ')})`);
  await queryRunner.query(`COMMENT ON CONSTRAINT ${name} ON ${table} IS '${MARK}'`);
  return true;
}

async function dropMarkedUnique(queryRunner: QueryRunner, table: string, name: string): Promise<void> {
  const marked = await queryRunner.query(
    `SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = $1::regclass AND c.conname = $2
        AND obj_description(c.oid, 'pg_constraint') = $3`,
    [table, name, MARK],
  );
  if (marked.length > 0) await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
}
