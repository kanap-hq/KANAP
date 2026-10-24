// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import {
  DATA_ACCESS_FUNCTIONS,
  DATA_ACCESS_TABLES,
  DATA_ACCESS_VIEWS,
  DONE_POLICY_RUNS,
} from '../data-access-tables.inventory';
import { APP_URL, LIMITED_ROLE, PgClient, connect, roleExists } from './data-access-test-helpers';

/**
 * Data-scoped access inventories, lot 2 part (planning/data-scoped-access/spec.md §10.3): the
 * catalog of the migrated database against data-access/data-access-tables.inventory.ts, both ways.
 * Read-only, as the application role.
 */

let client: PgClient;

function diff(label: string, found: string[], listed: string[]): void {
  const f = new Set(found);
  const l = new Set(listed);
  const missing = [...f].filter((x) => !l.has(x)).sort();
  const stale = [...l].filter((x) => !f.has(x)).sort();
  assert.deepEqual(missing, [], `${label}: found in the catalog, not in the inventory`);
  assert.deepEqual(stale, [], `${label}: in the inventory, not found by the catalog rules`);
}

const ROOTS = ['spend_items', 'spend_versions', 'contracts', 'tasks'];
const PARENT_CLASSES = new Set(['follows_line', 'follows_contract', 'task_element']);

async function fkTables(): Promise<string[]> {
  const parents = new Set([
    ...ROOTS,
    ...DATA_ACCESS_TABLES.filter((t) => PARENT_CLASSES.has(t.cls)).map((t) => t.table),
  ]);
  const { rows } = await client.query(`
    SELECT DISTINCT c.conrelid::regclass::text AS child
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.connamespace = 'public'::regnamespace
      AND c.confrelid::regclass::text = ANY ($1::text[])
      AND c.conrelid <> c.confrelid`, [[...parents]]);
  return rows.map((r) => r.child);
}

async function polymorphicTables(): Promise<string[]> {
  const { rows } = await client.query(`
    SELECT DISTINCT a.table_name::text AS t
    FROM information_schema.columns a
    JOIN information_schema.columns b
      ON b.table_schema = a.table_schema AND b.table_name = a.table_name
    JOIN pg_class k
      ON k.relname = a.table_name AND k.relnamespace = 'public'::regnamespace AND k.relkind IN ('r', 'p')
    WHERE a.table_schema = 'public'
      AND (
        (a.column_name ~ '^.+_(type|kind)$'
         AND b.column_name IN (regexp_replace(a.column_name, '_(type|kind)$', '_id'),
                               regexp_replace(a.column_name, '_(type|kind)$', '_ref')))
        OR (a.column_name = 'table_name' AND b.column_name = 'record_id')
      )`);
  return rows.map((r) => r.t);
}

async function testTables(): Promise<void> {
  const seen = new Set<string>();
  for (const entry of DATA_ACCESS_TABLES) {
    assert.ok(!seen.has(entry.table), `${entry.table}: listed once`);
    seen.add(entry.table);
    assert.ok(entry.reason.trim().length > 0, `${entry.table}: a reason`);
    assert.equal(entry.cls === 'excluded', entry.policies === null, `${entry.table}: an excluded table has no policy run, the others one`);
  }
  const found = new Set([...(await fkTables()), ...(await polymorphicTables()), 'spend_items', 'contracts', 'tasks']);
  diff('tables (foreign key and polymorphic rules)', [...found], DATA_ACCESS_TABLES.map((t) => t.table));
  console.log(`  tables: ${found.size} found by the rules, all classified: OK`);
}

function scopedTables(): string[] {
  return DATA_ACCESS_TABLES.filter((t) => t.cls !== 'excluded').map((t) => t.table);
}

async function testViews(): Promise<void> {
  const { rows } = await client.query(`
    SELECT DISTINCT v.relname::text AS view, coalesce(v.reloptions::text[] @> ARRAY['security_invoker=true'], false) AS invoker
    FROM pg_class v
    JOIN pg_rewrite r ON r.ev_class = v.oid
    JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid AND d.refclassid = 'pg_class'::regclass
    JOIN pg_class t ON t.oid = d.refobjid
    WHERE v.relnamespace = 'public'::regnamespace AND v.relkind IN ('v', 'm')
      AND t.oid <> v.oid AND t.relname = ANY ($1::text[])`, [scopedTables()]);
  diff('views reading a scoped table', rows.map((r) => r.view), DATA_ACCESS_VIEWS.map((v) => v.view));
  console.log(`  views and materialized views reading a scoped table: ${rows.length}, all classified: OK`);
}

async function testFunctions(): Promise<void> {
  const { rows } = await client.query(`
    SELECT p.proname::text AS name, p.prosecdef AS definer, p.proconfig AS config,
           EXISTS (SELECT 1 FROM unnest($1::text[]) t WHERE p.prosrc ~ ('\\m' || t || '\\M')) AS reads_scoped
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`,
  [scopedTables()]);
  const byName = new Map<string, any>();
  for (const row of rows) {
    assert.ok(!byName.has(row.name), `${row.name}: one function of that name (an overload needs its own entry)`);
    byName.set(row.name, row);
  }
  const listed = new Map(DATA_ACCESS_FUNCTIONS.map((f) => [f.name, f]));
  assert.equal(listed.size, DATA_ACCESS_FUNCTIONS.length, 'each function listed once');

  const found = rows.filter((r) => r.reads_scoped || r.definer).map((r) => r.name);
  diff('functions (body names a scoped table, or SECURITY DEFINER)', found, [...listed.keys()]);

  for (const entry of DATA_ACCESS_FUNCTIONS) {
    const fn = byName.get(entry.name);
    if (entry.cls === 'definer') {
      assert.equal(fn.definer, true, `${entry.name}: SECURITY DEFINER (spec §6.5)`);
      assert.ok((fn.config ?? []).includes('search_path=public, pg_temp'), `${entry.name}: search_path = public, pg_temp`);
    } else if (entry.cls === 'access') {
      assert.ok(entry.name.startsWith('data_access_'), `${entry.name}: an access function is a data_access_* function`);
      if (fn.definer) {
        assert.ok((fn.config ?? []).includes('search_path=public, pg_temp'), `${entry.name}: search_path = public, pg_temp`);
      }
    } else {
      assert.equal(fn.definer, false, `${entry.name}: stays SECURITY INVOKER`);
    }
  }
  const definers = rows.filter((r) => r.definer).map((r) => r.name);
  for (const name of definers) {
    assert.ok(['definer', 'access'].includes(listed.get(name)!.cls), `${name}: a SECURITY DEFINER function is a definer or access entry`);
  }
  console.log(`  functions: ${found.length} found (${definers.length} SECURITY DEFINER), all classified: OK`);
}

async function testPolicies(hasRole: boolean): Promise<void> {
  const { rows: expected } = await client.query(
    `SELECT policy_name, table_name, command FROM data_access_expected_policies() ORDER BY 1`,
  );
  const due = DATA_ACCESS_TABLES.filter((t) => t.policies !== null && DONE_POLICY_RUNS.includes(t.policies)).map((t) => t.table);
  diff('tables of the expected policies (inventory runs done)', [...new Set(expected.map((e) => e.table_name))], due);
  for (const e of expected) {
    assert.equal(e.policy_name, `${e.table_name}_data_access_${e.command.toLowerCase()}`, `${e.policy_name}: named <table>_data_access_<command>`);
  }

  const { rows: actual } = await client.query(`
    SELECT p.polname::text AS policy_name, c.relname::text AS table_name, p.polpermissive AS permissive,
           p.polroles = ARRAY[to_regrole($1)::oid] AS role_only,
           CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS command
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relnamespace = 'public'::regnamespace
      AND (p.polname ~ '_data_access_(select|insert|update|delete|all)$'
           OR (to_regrole($1) IS NOT NULL AND to_regrole($1)::oid = ANY (p.polroles)))
    ORDER BY 1`, [LIMITED_ROLE]);
  if (!hasRole) {
    assert.deepEqual(actual, [], 'role absent: no data-access policy');
    console.log(`  policies: ${expected.length} expected, none created without the role: OK`);
    return;
  }
  for (const p of actual) {
    assert.equal(p.permissive, false, `${p.policy_name}: AS RESTRICTIVE`);
    assert.equal(p.role_only, true, `${p.policy_name}: TO ${LIMITED_ROLE} only`);
  }
  const key = (r: any) => `${r.table_name}.${r.policy_name}.${r.command}`;
  diff('policies (expected against pg_policy)', actual.map(key), expected.map(key));
  console.log(`  policies: ${expected.length} expected, all created, restrictive, on the role only: OK`);
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  try {
    const hasRole = await roleExists(client);
    console.log(`data access tables inventory (role ${hasRole ? 'installed' : 'absent'})`);
    await testTables();
    await testViews();
    await testFunctions();
    await testPolicies(hasRole);
    console.log('data access tables inventory: all checks passed');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
