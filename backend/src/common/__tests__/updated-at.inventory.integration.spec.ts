// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { aiEntityRegistries } from '../../ai/query/registries';
import { UPDATED_AT_FAMILIES, UPDATED_AT_TABLES, UPDATED_AT_TECHNICAL_REASONS } from '../updated-at.inventory';
import { updatedAtColumns } from '../updated-at-trigger';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The modification date the database keeps (migration 1856270000000), against a real database,
// in transactions rolled back at the end:
// - the inventory: every family of the assistant's and the MCP server's queries names its table or
//   why it shows no date; each table of the inventory has its trigger, enabled, on
//   `stamp_updated_at()`, whose WHEN clause compares exactly the columns of today but the
//   technical ones, and no other table has one;
// - on every table of the inventory, by raw SQL (the path no service guards): a changed column
//   takes now(); a row written back as it was, or changed in its technical columns only, keeps
//   its date; a statement that writes `updated_at` itself keeps its value.

const OLD_DATE = '2020-01-02T03:04:05.000Z';

type Case = {
  /** A column a person edits, set to a new text. */
  edit: string;
  /** The technical columns' new values, as SQL expressions. */
  technical?: Record<string, string>;
};

/** A person of the row's tenant, for the author columns. */
const PERSON = (table: string) => `(SELECT id FROM users WHERE tenant_id = ${table}.tenant_id LIMIT 1)`;

const STATUS_FLIP = `CASE WHEN status = 'enabled' THEN 'disabled' ELSE 'enabled' END::status_state`;

const CASES: Record<string, Case> = {
  accounts: { edit: 'description', technical: { status: STATUS_FLIP } },
  analytics_axes: { edit: 'description', technical: { status: STATUS_FLIP, sort_order: 'sort_order + 1' } },
  analytics_categories: { edit: 'description', technical: { status: STATUS_FLIP, sort_order: 'sort_order + 1' } },
  applications: { edit: 'description' },
  assets: { edit: 'notes' },
  business_processes: { edit: 'description', technical: { status: STATUS_FLIP } },
  chart_of_accounts: { edit: 'name' },
  companies: { edit: 'notes', technical: { status: STATUS_FLIP } },
  connections: { edit: 'description' },
  contacts: { edit: 'notes' },
  contracts: { edit: 'notes', technical: { status: STATUS_FLIP } },
  departments: { edit: 'description', technical: { status: STATUS_FLIP } },
  documents: {
    edit: 'summary',
    technical: {
      search_vector: `to_tsvector('simple', 'reindexed')`,
      revision: 'revision + 1',
      current_version_number: 'current_version_number + 1',
      created_by: PERSON('documents'),
      updated_by: PERSON('documents'),
    },
  },
  incidents: { edit: 'description', technical: { created_by: PERSON('incidents'), updated_by: PERSON('incidents') } },
  interfaces: { edit: 'overview_notes' },
  locations: { edit: 'additional_info' },
  portfolio_projects: { edit: 'purpose', technical: { priority_score: '42' } },
  portfolio_requests: { edit: 'purpose', technical: { priority_score: '42', created_by_id: PERSON('portfolio_requests') } },
  roles: { edit: 'role_description' },
  spend_items: { edit: 'description', technical: { status: STATUS_FLIP, row_version: 'row_version + 1' } },
  suppliers: { edit: 'notes', technical: { status: STATUS_FLIP } },
  tasks: { edit: 'description', technical: { creator_id: PERSON('tasks') } },
  technologies: { edit: 'notes', technical: { catalog_state: `'{"synced": true}'::jsonb` } },
  technology_versions: { edit: 'notes' },
  technology_vulnerabilities: { edit: 'note', technical: { state_changed_by: PERSON('technology_vulnerabilities') } },
  users: {
    edit: 'job_title',
    technical: {
      last_login_at: `now() - interval '1 day'`,
      external_synced_at: `now() - interval '1 day'`,
      password_hash: `'rehashed'`,
      mfa_secret: `'rotated'`,
    },
  },
  working_day_profiles: { edit: 'description', technical: { status: STATUS_FLIP } },
};

/** One row in every table of the inventory, for one tenant: the id of each. */
async function seedRows(runner: QueryRunner, tenantId: string): Promise<Record<string, string>> {
  const one = async (sql: string, params: unknown[] = []) => (await runner.query(sql, [tenantId, ...params]))[0].id as string;
  const ids: Record<string, string> = {};
  ids.chart_of_accounts = await one(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'UPD', 'Chart', 'FR') RETURNING id`);
  ids.accounts = await one(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6100, 'Account') RETURNING id`, [ids.chart_of_accounts]);
  ids.analytics_axes = await one(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'upd', 'Axis') RETURNING id`);
  ids.analytics_categories = await one(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Value') RETURNING id`, [ids.analytics_axes]);
  ids.applications = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Application A') RETURNING id`);
  const target = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Application B') RETURNING id`);
  ids.assets = await one(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Server', 'vm', 'prod') RETURNING id`);
  ids.business_processes = await one(`INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Process') RETURNING id`);
  ids.companies = await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Company', 'FR', 'Lyon') RETURNING id`);
  ids.suppliers = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier') RETURNING id`);
  ids.connections = await one(`INSERT INTO connections (tenant_id, name, topology, connection_reference) VALUES ($1, 'Connection', 'point_to_point', 'CONN-1') RETURNING id`);
  ids.contacts = await one(`INSERT INTO contacts (tenant_id, email) VALUES ($1, 'contact@example.test') RETURNING id`);
  ids.contracts = await one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Contract', $2, $3, '2026-01-01') RETURNING id`,
    [ids.companies, ids.suppliers],
  );
  ids.departments = await one(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Department') RETURNING id`, [ids.companies]);
  const library = await one(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Library', 'library') RETURNING id`);
  ids.documents = await one(`INSERT INTO documents (tenant_id, item_number, title, library_id) VALUES ($1, 1, 'Document', $2) RETURNING id`, [library]);
  ids.incidents = await one(`INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 1, 'Incident', 'minor') RETURNING id`);
  ids.interfaces = await one(
    `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category, integration_route_type, interface_reference)
     VALUES ($1, 'Interface', 'Purpose', $2, $3, 'master_data', 'direct', 'INT-1') RETURNING id`,
    [ids.applications, target],
  );
  ids.locations = await one(`INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Site', 'on_premise', 'LOC-1') RETURNING id`);
  ids.portfolio_projects = await one(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Project', 1) RETURNING id`);
  ids.portfolio_requests = await one(`INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES ($1, 'Request', 1) RETURNING id`);
  ids.roles = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Updated at role') RETURNING id`);
  ids.spend_items = await one(
    `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status)
     VALUES ($1, 'opex', 1, 'Line', 'EUR', '2026-01-01', 'enabled') RETURNING id`,
  );
  ids.tasks = await one(`INSERT INTO tasks (tenant_id, title, item_number) VALUES ($1, 'Task', 1) RETURNING id`);
  ids.technologies = await one(`INSERT INTO technologies (tenant_id, item_number, name) VALUES ($1, 1, 'Technology') RETURNING id`);
  ids.technology_versions = await one(`INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '1.0') RETURNING id`, [ids.technologies]);
  ids.technology_vulnerabilities = await one(
    `INSERT INTO technology_vulnerabilities (tenant_id, technology_id, cve_id, match_basis) VALUES ($1, $2, 'CVE-2026-0001', 'version_unknown') RETURNING id`,
    [ids.technologies],
  );
  ids.users = await one(`INSERT INTO users (tenant_id, email, role_id) VALUES ($1, 'person@example.test', $2) RETURNING id`, [ids.roles]);
  ids.working_day_profiles = await one(`INSERT INTO working_day_profiles (tenant_id, code, name) VALUES ($1, 'UPD', 'Calendar') RETURNING id`);
  return ids;
}

async function testInventoryMatchesTheDatabase() {
  await inRolledBackTransaction(async (runner) => {
    for (const family of Object.keys(aiEntityRegistries)) {
      assert.ok(family in UPDATED_AT_FAMILIES, `${family}: the family names its table or why it shows no date`);
    }
    for (const [family, table] of Object.entries(UPDATED_AT_FAMILIES)) {
      if (typeof table === 'string') assert.ok(table in UPDATED_AT_TABLES, `${family}: its table ${table} keeps its date`);
    }
    for (const technical of Object.values(UPDATED_AT_TABLES)) {
      for (const column of technical) assert.ok(UPDATED_AT_TECHNICAL_REASONS[column], `${column}: a reason`);
    }

    const rows: Array<{ table: string; name: string; enabled: string; definition: string; qual: string | null; columns: string[]; by_number: Record<string, string> }> = await runner.query(
      `SELECT c.relname AS table, t.tgname AS name, t.tgenabled::text AS enabled, pg_get_triggerdef(t.oid) AS definition,
              t.tgqual AS qual,
              ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
              (SELECT jsonb_object_agg(a.attnum, a.attname) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS by_number
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND p.proname = 'stamp_updated_at'
        ORDER BY c.relname`,
    );
    assert.deepEqual(rows.map((row) => row.table), Object.keys(UPDATED_AT_TABLES).sort(), 'one trigger per table of the inventory, and none elsewhere');
    for (const row of rows) {
      assert.equal(row.name, `${row.table}_updated_at`, `${row.table}: the trigger's name`);
      assert.equal(row.enabled, 'O', `${row.table}: the trigger is enabled`);
      assert.match(
        row.definition,
        /^CREATE TRIGGER \w+ BEFORE UPDATE ON public\.\w+ FOR EACH ROW WHEN \(.+\) EXECUTE FUNCTION stamp_updated_at\(\)$/,
        `${row.table}: ${row.definition}`,
      );
      for (const column of ['updated_at', ...UPDATED_AT_TABLES[row.table]]) assert.ok(row.columns.includes(column), `${row.table}: the column ${column} exists`);
      // The columns the WHEN clause compares (its Var nodes, NEW and OLD alike), against those of today.
      const compared = [...new Set([...(row.qual ?? '').matchAll(/\{VAR :varno \d+ :varattno (\d+)/g)].map((m) => row.by_number[m[1]] ?? `#${m[1]}`))].sort();
      const expected = ['updated_at', ...(await updatedAtColumns(runner, row.table)).map((column) => column.name)].sort();
      const missing = expected.filter((column) => !compared.includes(column));
      const extra = compared.filter((column) => !expected.includes(column));
      assert.deepEqual(
        { missing, extra },
        { missing: [], extra: [] },
        `${row.table}: the trigger does not compare exactly the columns of today. A migration that adds or drops a column of ${row.table} `
          + `calls syncUpdatedAtTrigger(queryRunner, '${row.table}') (common/updated-at-trigger.ts); a column whose change alone is no edit `
          + `goes to the technical columns of ${row.table} in common/updated-at.inventory.ts, with its reason, and the trigger is synced again. `
          + `Faced with "cannot drop column ... because other objects depend on it", do not follow the CASCADE hint (it drops the trigger): `
          + `call dropUpdatedAtTriggers(queryRunner, ['${row.table}']) before the change and syncUpdatedAtTrigger after it.`,
      );
    }
    const [fn] = await runner.query(
      `SELECT p.prosecdef AS definer, p.proconfig AS config FROM pg_proc p WHERE p.proname = 'stamp_updated_at'`,
    );
    assert.equal(fn.definer, false, 'the function runs with the rights of the writer: it reads no table');
    assert.deepEqual(fn.config, ['search_path=public, pg_temp'], 'its search path is pinned');
  });
}

async function testEveryTableKeepsItsDate() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'updated-at');
    const ids = await seedRows(runner, tenantId);
    assert.deepEqual(Object.keys(CASES).sort(), Object.keys(UPDATED_AT_TABLES).sort(), 'one case per table of the inventory');
    const dateOf = async (table: string) => {
      const [row] = await runner.query(`SELECT updated_at = now() AS now, updated_at FROM ${table} WHERE id = $1`, [ids[table]]);
      return row.now ? 'now' : new Date(row.updated_at).toISOString();
    };
    const update = (table: string, set: string) => runner.query(`UPDATE ${table} SET ${set} WHERE id = $1`, [ids[table]]);

    for (const [table, spec] of Object.entries(CASES)) {
      await update(table, `updated_at = '${OLD_DATE}'`);
      assert.equal(await dateOf(table), OLD_DATE, `${table}: a statement that writes the date keeps its value`);

      await update(table, `${spec.edit} = ${spec.edit}`);
      assert.equal(await dateOf(table), OLD_DATE, `${table}: a row written back as it was keeps its date`);

      const technical = Object.entries(spec.technical ?? {});
      assert.deepEqual(technical.map(([column]) => column), [...UPDATED_AT_TABLES[table]], `${table}: the case writes every technical column`);
      if (technical.length) {
        await update(table, technical.map(([column, value]) => `${column} = ${value}`).join(', '));
        assert.equal(await dateOf(table), OLD_DATE, `${table}: a change of the technical columns alone keeps the date`);
      }

      await update(table, `${spec.edit} = 'Edited ${randomUUID()}'`);
      assert.equal(await dateOf(table), 'now', `${table}: a changed column dates the row`);

      await update(table, `${spec.edit} = 'Edited again', updated_at = '${OLD_DATE}'`);
      // Raw SQL only (a statement that writes `tasks.owner_ids` and its own date, for instance): the
      // entities never write the date (`update: false`), the application dates on purpose through touchUpdatedAt.
      assert.equal(await dateOf(table), OLD_DATE, `${table}: a raw SQL change dated by its own statement keeps that date`);
    }
  });
}

void runSpecs('updated-at.inventory.integration.spec', [
  ['inventory matches the database', testInventoryMatchesTheDatabase],
  ['every table keeps its date', testEveryTableKeepsItsDate],
]);
