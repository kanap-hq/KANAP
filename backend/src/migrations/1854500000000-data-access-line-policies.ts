import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] DataAccessLinePolicies:';
const LIMITED_ROLE = 'kanap_data_limited';

/*
 * The settings of data_access_apply() (spec §6.3), each read once per statement through an
 * uncorrelated scalar subquery (an InitPlan). The arrays are cast inside the subquery, then cast
 * again outside it: the outer cast (same type, no node) keeps `= ANY (...)` an array comparison
 * instead of a subquery comparison, and the inner one parses the literal once. The form of the
 * spec, `(SELECT NULLIF(...))::uuid[]` with the cast outside only, parses the array literal on
 * every row: measured 3 080 ms against 28 ms over 300 000 rows with a 40-uuid list.
 */
const setting = (name: string) => `NULLIF(current_setting('app.da_${name}', true), '')`;
const MODE_LIMITED = `(SELECT ${setting('mode')}) IS NOT DISTINCT FROM 'limited'`;
const USER = `(SELECT ${setting('user')}::uuid)`;
const READ_ALL = `coalesce((SELECT ${setting('read_all')}::boolean), false)`;
const EDIT_ALL = `coalesce((SELECT ${setting('edit_all')}::boolean), false)`;
const uuidList = (name: string) => `(SELECT ${setting(name)}::uuid[])::uuid[]`;
const READ_COMPANIES = uuidList('read_companies');
const EDIT_COMPANIES = uuidList('edit_companies');
const READ_NODES = uuidList('read_nodes');
const EDIT_NODES = uuidList('edit_nodes');

/** lisible_ligne (spec §6.4) on the line `p` (a column prefix: `spend_items.` or `i.`). */
const readableLine = (p: string) => `(${READ_ALL}
      OR ${p}paying_company_id = ANY (${READ_COMPANIES})
      OR ${p}cost_center_id = ANY (${READ_NODES})
      OR ${p}owner_it_id = ${USER}
      OR ${p}owner_business_id = ${USER})`;

/**
 * placable_ligne (spec §6.4). data_access_placable_line() is its single definition; it holds
 * subqueries, so PostgreSQL never inlines it and runs it per row. The policies therefore test the
 * cheap necessary conditions first, with the settings read once per statement, and call the
 * function only for a centre in the edit nodes, where it decides (the company of that centre).
 */
const placableLine = (company: string, centre: string) => `(${EDIT_ALL}
      OR ${company} = ANY (${EDIT_COMPANIES})
      OR (${centre} = ANY (${EDIT_NODES}) AND data_access_placable_line(${company}, ${centre})))`;

/** modifiable_ligne (spec §6.4): placement allowed by an edit node, or a responsible person. */
const modifiableLine = (p: string) => `(${EDIT_ALL}
      OR ${p}paying_company_id = ANY (${EDIT_COMPANIES})
      OR ${p}owner_it_id = ${USER}
      OR ${p}owner_business_id = ${USER}
      OR (${p}cost_center_id = ANY (${EDIT_NODES})
          AND data_access_placable_line(${p}paying_company_id, ${p}cost_center_id)))`;

/**
 * How a table that follows a line reaches its line id. A child names it in a column; a grandchild
 * names its version (or its round input), and a SECURITY DEFINER helper returns the line of that
 * version without reading `spend_versions` under its policy: the policy subquery then cites one
 * table with a policy, `spend_items`, whose policy cites none (spec §6.4, "profondeur").
 */
type LineReach =
  | { kind: 'column'; column: string }
  | { kind: 'version'; column: string }
  | { kind: 'round_input'; column: string };

function lineRef(table: string, reach: LineReach): string {
  const col = `${table}.${reach.column}`;
  if (reach.kind === 'column') return col;
  if (reach.kind === 'version') return `data_access_line_of_version(${col})`;
  return `data_access_line_of_round_input(${col})`;
}

/** Parent line readable: the subquery reads spend_items under its own SELECT policy. */
const parentLineReadable = (ref: string) => `(${READ_ALL}
      OR EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref}))`;

/** Parent line modifiable: readable by its SELECT policy, and modifiable_ligne. */
const parentLineModifiable = (ref: string) => `(${EDIT_ALL}
      OR EXISTS (SELECT 1 FROM public.spend_items i WHERE i.id = ${ref} AND ${modifiableLine('i.')}))`;

type Command = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
type PolicyRow = { table: string; command: Command; using: string | null; check: string | null };

/** Every policy starts with the refusal of the role taken without context (spec §6.4). */
const guarded = (expr: string) => `${MODE_LIMITED} AND ${expr}`;

/**
 * The tables that follow a line (data-access-tables.inventory.ts, class follows_line), with how
 * each reaches its line. Run 2B adds its tables in other lists below, not here.
 */
const FOLLOWS_LINE: Array<{ table: string; reach: LineReach }> = [
  { table: 'spend_versions', reach: { kind: 'column', column: 'spend_item_id' } },
  { table: 'spend_item_analytics_values', reach: { kind: 'column', column: 'item_id' } },
  { table: 'spend_item_contacts', reach: { kind: 'column', column: 'spend_item_id' } },
  { table: 'spend_links', reach: { kind: 'column', column: 'spend_item_id' } },
  { table: 'spend_attachments', reach: { kind: 'column', column: 'spend_item_id' } },
  { table: 'spend_tasks', reach: { kind: 'column', column: 'item_id' } },
  { table: 'spend_amounts', reach: { kind: 'version', column: 'version_id' } },
  { table: 'spend_allocations', reach: { kind: 'version', column: 'version_id' } },
  { table: 'spend_round_inputs', reach: { kind: 'version', column: 'version_id' } },
  { table: 'spend_version_totals', reach: { kind: 'version', column: 'version_id' } },
  { table: 'spend_round_input_lines', reach: { kind: 'round_input', column: 'round_input_id' } },
];

function linePolicies(): PolicyRow[] {
  const t = 'spend_items';
  return [
    { table: t, command: 'SELECT', using: guarded(readableLine(`${t}.`)), check: null },
    {
      table: t,
      command: 'INSERT',
      using: null,
      check: guarded(placableLine(`${t}.paying_company_id`, `${t}.cost_center_id`)),
    },
    { table: t, command: 'UPDATE', using: guarded(modifiableLine(`${t}.`)), check: guarded(modifiableLine(`${t}.`)) },
    // Deleting a line is reserved to unscoped persons (spec §2.7, §4.1).
    { table: t, command: 'DELETE', using: 'false', check: null },
  ];
}

function followsLinePolicies(): PolicyRow[] {
  const rows: PolicyRow[] = [];
  for (const { table, reach } of FOLLOWS_LINE) {
    const ref = lineRef(table, reach);
    const readable = guarded(parentLineReadable(ref));
    const modifiable = guarded(parentLineModifiable(ref));
    rows.push(
      { table, command: 'SELECT', using: readable, check: null },
      { table, command: 'INSERT', using: null, check: modifiable },
      { table, command: 'UPDATE', using: modifiable, check: modifiable },
      { table, command: 'DELETE', using: modifiable, check: null },
    );
  }
  return rows;
}

/** The whole expected set. Run 2B appends its builders here. Not exported: TypeORM instantiates every export of a migration file. */
function dataAccessPolicyRows(): PolicyRow[] {
  return [...linePolicies(), ...followsLinePolicies()];
}

function dataAccessPolicyName(row: Pick<PolicyRow, 'table' | 'command'>): string {
  return `${row.table}_data_access_${row.command.toLowerCase()}`;
}

/** A dollar-quoted SQL literal whose tag cannot occur in the text. */
function literal(text: string | null): string {
  if (text === null) return 'NULL::text';
  if (text.includes('$p$')) throw new Error('policy text contains the quote tag $p$');
  return `$p$${text}$p$`;
}

/**
 * Trigger functions that maintain derived data from the budget block (spec §6.5): SECURITY DEFINER,
 * so a change by a limited person recalculates over the whole tenant (the tenant policies still
 * apply, by FORCE row level security). ALTER FUNCTION keeps each body. Inventory:
 * data-access/data-access-tables.inventory.ts (class definer).
 */
const DEFINER_FUNCTIONS = [
  'budget_version_totals_rebuild',
  'search_index_delete',
  'search_index_refresh_accounts',
  'search_index_refresh_analytics_categories',
  'search_index_refresh_applications',
  'search_index_refresh_assets',
  'search_index_refresh_budget_lines',
  'search_index_refresh_business_processes',
  'search_index_refresh_capex_items',
  'search_index_refresh_chart_of_accounts',
  'search_index_refresh_companies',
  'search_index_refresh_connections',
  'search_index_refresh_contacts',
  'search_index_refresh_contracts',
  'search_index_refresh_departments',
  'search_index_refresh_documents',
  'search_index_refresh_incidents',
  'search_index_refresh_interfaces',
  'search_index_refresh_locations',
  'search_index_refresh_projects',
  'search_index_refresh_requests',
  'search_index_refresh_spend_items',
  'search_index_refresh_suppliers',
  'search_index_refresh_tasks',
  'search_index_refresh_technologies',
  'search_index_refresh_users',
  'search_index_sync_accounts',
  'search_index_sync_analytics_categories',
  'search_index_sync_applications',
  'search_index_sync_assets',
  'search_index_sync_business_processes',
  'search_index_sync_chart_of_accounts',
  'search_index_sync_companies',
  'search_index_sync_connections',
  'search_index_sync_contacts',
  'search_index_sync_contracts',
  'search_index_sync_departments',
  'search_index_sync_documents',
  'search_index_sync_incident_review_binding',
  'search_index_sync_incident_review_document',
  'search_index_sync_incidents',
  'search_index_sync_interfaces',
  'search_index_sync_link_application_owners',
  'search_index_sync_link_business_process_category_links',
  'search_index_sync_link_connection_protocols',
  'search_index_sync_link_contract_spend_items',
  'search_index_sync_link_location_sub_items',
  'search_index_sync_link_portfolio_project_team',
  'search_index_sync_link_portfolio_request_team',
  'search_index_sync_link_portfolio_team_member_configs',
  'search_index_sync_locations',
  'search_index_sync_portfolio_projects',
  'search_index_sync_portfolio_requests',
  'search_index_sync_spend_items',
  'search_index_sync_suppliers',
  'search_index_sync_tasks',
  'search_index_sync_technologies',
  'search_index_sync_users',
  'spend_allocations_budget_rev',
  'spend_amounts_version_totals',
  'spend_amounts_version_totals_truncate',
  'spend_item_analytics_values_row_version',
  'spend_item_analytics_values_search_index',
  'spend_round_input_lines_budget_rev',
  'spend_round_inputs_budget_rev',
  'spend_versions_budget_year_guard',
];
/**
 * Of those, the ones created without a search_path: up() pins it (a SECURITY DEFINER function
 * must not resolve names through its caller's path), down() resets it. Listed so down() resets
 * only these; up() checks the catalog and pins any listed function that lacks it.
 */
const DEFINER_PATH_ADDED = DEFINER_FUNCTIONS.filter((name) =>
  name.startsWith('search_index_') && name !== 'search_index_refresh_budget_lines',
);

/**
 * Data-scoped access, lot 2, run 2A (planning/data-scoped-access/spec.md §4.1, §6.4, §6.5, §9.1):
 * the database rules on the budget lines and the tables that follow them.
 *
 * 1. `data_access_placable_line(company, centre)` and `data_access_placable_contract(company,
 *    place)` (spec §6.4, the contract one used from lot 5), and the SECURITY DEFINER helpers
 *    `data_access_line_of_version(version)` and `data_access_line_of_round_input(round_input)`.
 * 2. `data_access_expected_policies()` and `data_access_sync_policies()` replaced: the expected
 *    list and the policy bodies come from one list (dataAccessPolicyRows()); the sync grants as in
 *    lot 1, drops the stray policies, then drops and recreates each expected policy, and refuses a
 *    list that differs from data_access_expected_policies().
 * 3. The placement trigger of the lines (spec §6.4): BEFORE UPDATE OF paying_company_id,
 *    cost_center_id, SECURITY INVOKER; in mode limited, a new place outside
 *    data_access_placable_line() is refused with 42501.
 * 4. The trigger functions that maintain derived data become SECURITY DEFINER, search_path pinned.
 * 5. One sync under lock_timeout 5 s: without the role it does nothing, and nothing changes for
 *    anyone; with it, the policies apply only to the transactions that took the role.
 *
 * Idempotent (CREATE OR REPLACE, DROP ... IF EXISTS, catalog checks). down() restores the lot 1
 * functions, syncs (the policies go), drops the trigger and the functions, and reverts the
 * trigger functions to SECURITY INVOKER.
 */
export class DataAccessLinePolicies1854500000000 implements MigrationInterface {
  name = 'DataAccessLinePolicies1854500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await createPlacementFunctions(queryRunner);
    await createPolicyFunctions(queryRunner);
    await createPlacementTrigger(queryRunner);
    const pinned = await makeDefiners(queryRunner);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`SELECT data_access_sync_policies()`);
    const roleRows = await queryRunner.query(`SELECT to_regrole($1) IS NOT NULL AS present`, [LIMITED_ROLE]);
    await queryRunner.query(`SET LOCAL lock_timeout = DEFAULT`);

    console.log(
      `${LOG_PREFIX} ${dataAccessPolicyRows().length} expected policies, placement trigger ready, `
      + `${DEFINER_FUNCTIONS.length} trigger functions SECURITY DEFINER (search_path pinned on ${pinned}); `
      + `limited role ${roleRows?.[0]?.present ? 'present, policies created' : 'absent, no policy created'}`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await restoreLotOneFunctions(queryRunner);
    // The expected list is empty again: the sync drops every policy on the role.
    await queryRunner.query(`SELECT data_access_sync_policies()`);
    await queryRunner.query(`SET LOCAL lock_timeout = DEFAULT`);

    await queryRunner.query(`DROP TRIGGER IF EXISTS spend_items_data_access_placement ON spend_items`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_spend_items_placement()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_line_of_round_input(uuid)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_line_of_version(uuid)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_placable_contract(uuid, uuid)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_placable_line(uuid, uuid)`);

    await queryRunner.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT p.oid::regprocedure AS fn, p.proname = ANY (${arrayLiteral(DEFINER_PATH_ADDED)}) AS reset_path
          FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (${arrayLiteral(DEFINER_FUNCTIONS)})
        LOOP
          EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', r.fn);
          IF r.reset_path THEN
            EXECUTE format('ALTER FUNCTION %s RESET search_path', r.fn);
          END IF;
        END LOOP;
      END
      $$
    `);
  }
}

function arrayLiteral(values: string[]): string {
  return `ARRAY[${values.map((v) => `'${v}'`).join(', ')}]::text[]`;
}

async function createPlacementFunctions(queryRunner: QueryRunner): Promise<void> {
  // placable_ligne (spec §2.3, §6.4): the single definition, called by the policies (behind their
  // cheap tests), the placement trigger and, from lot 3, the "editable" column and the write
  // checks. No SET clause and schema-qualified names, so a call costs no configuration switch.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_placable_line(p_company uuid, p_cost_center uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    AS $fn$
      SELECT coalesce(
        ${EDIT_ALL}
        OR p_company = ANY (${EDIT_COMPANIES})
        OR (p_cost_center = ANY (${EDIT_NODES})
            AND p_company = (SELECT c.company_id FROM public.cost_centers c WHERE c.id = p_cost_center)),
        false)
    $fn$
  `);

  // placable_contrat (spec §6.4), used by the contract policies and trigger of lot 5.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_placable_contract(p_company uuid, p_place uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    AS $fn$
      SELECT coalesce(
        ${EDIT_ALL}
        OR p_company = ANY (${EDIT_COMPANIES})
        OR (p_place = ANY (${EDIT_NODES}) AND p_company = ANY (${uuidList('edit_node_companies')})),
        false)
    $fn$
  `);

  // The line of a version, and of a round input, read without the data-access policies (owner:
  // the application role, which no data-access policy targets; the tenant policy still applies).
  // They return an id the caller already names by its child row, nothing else.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_line_of_version(p_version uuid)
    RETURNS uuid
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      SELECT v.spend_item_id FROM public.spend_versions v WHERE v.id = p_version
    $fn$
  `);
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_line_of_round_input(p_round_input uuid)
    RETURNS uuid
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      SELECT v.spend_item_id
      FROM public.spend_round_inputs r
      JOIN public.spend_versions v ON v.id = r.version_id
      WHERE r.id = p_round_input
    $fn$
  `);
}

async function createPolicyFunctions(queryRunner: QueryRunner): Promise<void> {
  const rows = dataAccessPolicyRows();
  const expectedValues = rows
    .map((r) => `('${dataAccessPolicyName(r)}', '${r.table}', '${r.command}')`)
    .join(',\n        ');
  const definitionValues = rows
    .map((r) => `('${r.table}', '${r.command}', ${literal(r.using)}, ${literal(r.check)})`)
    .join(',\n          ');

  // The single source of the policies the database must hold (policy, table, command).
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_expected_policies()
    RETURNS TABLE (policy_name text, table_name text, command text)
    LANGUAGE sql
    STABLE
    SET search_path = public, pg_temp
    AS $fn$
      SELECT v.policy_name, v.table_name, v.command
      FROM (VALUES
        ${expectedValues}
      ) AS v(policy_name, table_name, command)
    $fn$
  `);

  // Grants as in lot 1, the stray policies dropped, then each expected policy dropped and created
  // from the definitions below (one row per policy: table, command, USING, WITH CHECK). Policy
  // DDL takes an exclusive lock on its table: callers set lock_timeout, the function does not.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_sync_policies()
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_role oid := to_regrole('${LIMITED_ROLE}');
      r record;
      v_name text;
      v_expected int;
      v_created int := 0;
    BEGIN
      IF v_role IS NULL THEN
        RETURN;
      END IF;

      IF NOT has_schema_privilege(v_role, 'public', 'USAGE') THEN
        GRANT USAGE ON SCHEMA public TO ${LIMITED_ROLE};
      END IF;
      FOR r IN SELECT t.relname, t.is_sequence FROM data_access_grant_targets() t LOOP
        IF r.is_sequence THEN
          EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO ${LIMITED_ROLE}', r.relname);
        ELSE
          EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO ${LIMITED_ROLE}', r.relname);
        END IF;
      END LOOP;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${LIMITED_ROLE};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO ${LIMITED_ROLE};

      -- Every policy that targets the role and is not expected goes.
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

      -- The definitions and data_access_expected_policies() are written from one list: a pair
      -- that drifted apart is refused (the whole sync rolls back) rather than leave a limited
      -- person refused or uncovered.
      SELECT count(*) INTO v_expected FROM data_access_expected_policies();
      FOR r IN
        SELECT d.table_name, d.command, d.using_expr, d.check_expr
        FROM (VALUES
          ${definitionValues}
        ) AS d(table_name, command, using_expr, check_expr)
      LOOP
        v_name := r.table_name || '_data_access_' || lower(r.command);
        IF NOT EXISTS (
          SELECT 1 FROM data_access_expected_policies() e
          WHERE e.policy_name = v_name AND e.table_name = r.table_name AND e.command = r.command
        ) THEN
          RAISE EXCEPTION 'data access: policy % is defined but not expected', v_name;
        END IF;
        v_created := v_created + 1;
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_name, r.table_name);
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO ${LIMITED_ROLE}%s%s',
                       v_name, r.table_name, r.command,
                       CASE WHEN r.using_expr IS NULL THEN '' ELSE ' USING (' || r.using_expr || ')' END,
                       CASE WHEN r.check_expr IS NULL THEN '' ELSE ' WITH CHECK (' || r.check_expr || ')' END);
      END LOOP;
      IF v_created <> v_expected THEN
        RAISE EXCEPTION 'data access: % policies expected, % defined', v_expected, v_created;
      END IF;
    END
    $fn$
  `);
  await queryRunner.query(`REVOKE EXECUTE ON FUNCTION data_access_sync_policies() FROM PUBLIC`);
}

async function createPlacementTrigger(queryRunner: QueryRunner): Promise<void> {
  // The policies do not see the old row: without this trigger, a responsible person would move
  // the line to any company while keeping the participation (spec §6.4). A value set to itself is
  // no move. SECURITY INVOKER: it reads the settings of the transaction.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_spend_items_placement()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = public, pg_temp
    AS $fn$
    BEGIN
      IF NULLIF(current_setting('app.da_mode', true), '') IS DISTINCT FROM 'limited' THEN
        RETURN NEW;
      END IF;
      IF NEW.paying_company_id IS NOT DISTINCT FROM OLD.paying_company_id
         AND NEW.cost_center_id IS NOT DISTINCT FROM OLD.cost_center_id THEN
        RETURN NEW;
      END IF;
      IF NOT data_access_placable_line(NEW.paying_company_id, NEW.cost_center_id) THEN
        RAISE EXCEPTION 'permission denied: this place is outside your data access'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$
  `);
  await queryRunner.query(`DROP TRIGGER IF EXISTS spend_items_data_access_placement ON spend_items`);
  await queryRunner.query(`
    CREATE TRIGGER spend_items_data_access_placement
    BEFORE UPDATE OF paying_company_id, cost_center_id ON spend_items
    FOR EACH ROW EXECUTE FUNCTION data_access_spend_items_placement()
  `);
}

/** SECURITY DEFINER on each listed function, search_path pinned where missing; returns how many were pinned. */
async function makeDefiners(queryRunner: QueryRunner): Promise<number> {
  const rows = await queryRunner.query(
    `SELECT p.oid::regprocedure::text AS fn, p.proname::text AS name,
            NOT coalesce(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'), false) AS needs_path
     FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY ($1::text[])`,
    [DEFINER_FUNCTIONS],
  );
  const found = new Set(rows.map((r: any) => r.name));
  const missing = DEFINER_FUNCTIONS.filter((name) => !found.has(name));
  if (missing.length > 0) console.log(`${LOG_PREFIX} functions not found, skipped: ${missing.join(', ')}`);
  let pinned = 0;
  for (const row of rows) {
    await queryRunner.query(`ALTER FUNCTION ${row.fn} SECURITY DEFINER`);
    if (row.needs_path) {
      await queryRunner.query(`ALTER FUNCTION ${row.fn} SET search_path = public, pg_temp`);
      pinned += 1;
    }
  }
  return pinned;
}

/** The lot 1 bodies of the two functions this migration replaces (1854400000000). */
async function restoreLotOneFunctions(queryRunner: QueryRunner): Promise<void> {
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
      -- No TRUNCATE, no UPDATE on sequences (no request path calls setval). Relation by relation,
      -- only those the application role owns (data_access_grant_targets(), the availability check
      -- uses it too): a relation of another owner may give it no right, and GRANT would fail.
      FOR r IN SELECT t.relname, t.is_sequence FROM data_access_grant_targets() t LOOP
        IF r.is_sequence THEN
          EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO ${LIMITED_ROLE}', r.relname);
        ELSE
          EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO ${LIMITED_ROLE}', r.relname);
        END IF;
      END LOOP;
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
}
