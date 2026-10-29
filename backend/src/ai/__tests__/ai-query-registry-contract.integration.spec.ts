import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { ensureDefaultAnalyticsAxis } from '../../analytics/analytics-axes.util';
import { seedMonths, seedVersion } from '../../spend/__tests__/round-inputs.fixtures';

// The contract between the AI query registries (`query/registries/*`) and the list services
// they call, for every entity family. Plaid chat and the MCP server read through them.
//
// - Every sort field a registry advertises is applied: the list's statements differ between
//   asc and desc, and from a sort the service does not know (which falls back to its own
//   default column, `SERVICE_FALLBACK_SORT`, or fails). Every filter field is applied: the
//   statements differ from the unfiltered ones. Checked on the SQL each call sends, so the
//   check does not depend on the data's values (ties, nulls).
// - Every shape of filter the adapter sends for a field (each number and date operator, a blank
//   date, a set to exclude) is accepted by the list, through the queries and the aggregates: the
//   lists answer 400 to a filter on a column they do not hold or a model its type cannot take,
//   and an AI answer must never meet one.
// - On seeded data, two rows per family created a year apart: created_at desc lists the newer
//   first, asc the older first, and each item carries its created_at.
// - A sort field the registry does not advertise is never dropped silently: the result names it
//   in `sort_ignored`, with the order it applied and the fields it could have used.
// - Page sizes: the default, the general maximum and the family maximum (`aiQueryLimit`); a
//   reduced page size is named in `limit_capped`.
// - The currency of the amounts: budget lines in the tenant's reporting currency
//   (`amounts_currency`), in lists, sums and details; contracts in each contract's own; a line's
//   years without a rate named in `amounts_fx_missing_years`; a sum's amounts left out for lack
//   of a rate named in `amounts_fx_missing` and in the note.
// - A field flagged `sortable` is a sort field, and the other way around.
// - The budget lines' consolidation account reaches the accounts (the engine's `cons_labels`) for
//   a reader of accounts, in its filter, its sort and its group: the list engine receives the
//   person's access, without which the field reads null for everyone.
// - The chargeback reports (`chargeback`, `chargeback_lines`) read one year and, for the lines, one
//   company: every call names them (`REQUIRED_FILTERS`); their year takes `eq` only, any other
//   operator refused in words.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-query-contract-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

/**
 * The families the assistant reads in memory from the screen's service (the two End of support
 * report lists, the roles and their rights, Admin › Data access): their filters and sorts change the rows, never the
 * statements they send. Their behaviour is asserted on `filters_applied` and the result, and by
 * their own spec.
 */
const IN_MEMORY_FAMILIES = new Set(['support_gaps', 'support_deadlines', 'roles', 'role_permissions', 'data_access', 'chargeback', 'chargeback_lines']);

/** The year of the seeded chargeback: outside the window of the budget line fields (y-2 to y+2). */
const CHARGEBACK_YEAR = 2031;

/**
 * The filters a family needs on every call: the chargeback reports of the seeded year, the company
 * report of Company 1. Merged into each call that does not name the field.
 */
const REQUIRED_FILTERS: Record<string, Record<string, unknown>> = {
  chargeback: { year: { op: 'eq', value: CHARGEBACK_YEAR } },
  chargeback_lines: { year: { op: 'eq', value: CHARGEBACK_YEAR }, company: 'Company 1' },
};

/** Number fields that take one value (`eq`): a report reads one year, the other operators are refused. */
const EQ_ONLY_FIELDS: Record<string, Set<string>> = { chargeback: new Set(['year']), chargeback_lines: new Set(['year']) };

function withRequired(input: Record<string, unknown>): Record<string, unknown> {
  const required = REQUIRED_FILTERS[String(input.entity_type)];
  if (!required) return input;
  return { ...input, filters: { ...required, ...((input.filters as Record<string, unknown> | undefined) ?? {}) } };
}

/**
 * The column a list service sorts on when it does not know the requested one. A sort field on
 * that column cannot be told apart from the fallback by its statements; it is checked on data.
 */
const SERVICE_FALLBACK_SORT: Record<string, string> = {
  analytics_categories: 'sort_order',
  applications: 'created_at',
  assets: 'created_at',
  budget_lines: 'created_at',
  business_processes: 'name',
  companies: 'name',
  connections: 'created_at',
  contacts: 'created_at',
  contracts: 'next_due_date',
  departments: 'name',
  documents: 'updated_at',
  incidents: 'detected_at',
  interfaces: 'interface_reference',
  locations: 'created_at',
  projects: 'created_at',
  requests: 'created_at',
  tasks: 'created_at',
  technologies: 'name',
  technology_versions: 'technology',
  users: 'last_name',
  vulnerabilities: 'exploited',
};

const OLDER = '2030-01-15T10:00:00.000Z';
const NEWER = '2031-01-15T10:00:00.000Z';

type Harness = { app: any; dataSource: DataSource; executor: any; aggregates: any; registries: any };
type Seed = { tenantId: string; userId: string; rows: Record<string, { older: string; newer: string }> };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-query-registry-contract.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const registries = require('../query/registries');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), executor: app.get(AiQueryExecutor), aggregates: app.get(AiAggregateExecutor), registries };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

/** Two rows per family, `older` and `newer` by created_at (both later than any other row of the tenant). */
async function seedTenant(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-contract-${tag}`, `AI contract ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const roleId = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Administrator', 'Administrator', false, false, now(), now())`, [tenantId]);
  const axisId = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
  // A second role with two rights: `roles` and `role_permissions` list at least two rows.
  const readerRoleId = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Contract Reader', 'Reads the contract spec', false, false, now(), now())`, [tenantId]);
  for (const resource of ['budget', 'suppliers']) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, readerRoleId, resource]);
  }

  const rows: Seed['rows'] = {};
  const pair = async (family: string, insert: (n: number, createdAt: string) => Promise<string>) => {
    rows[family] = { older: await insert(1, OLDER), newer: await insert(2, NEWER) };
  };

  await pair('users', (n, at) => insertId(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, created_at, updated_at)
     VALUES ($1, $2, 'Contract', $3, $4, false, 'enabled', $5, $5)`,
    [tenantId, `User${n}`, `contract-${n}-${tag}@example.test`, roleId, at]));
  const userId = rows.users.newer;
  // Two persons in limited access, one with a node and one without: `data_access` lists two rows.
  for (const [n, node] of [[3, true], [4, false]] as Array<[number, boolean]>) {
    const limitedId = await insertId(runner,
      `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, data_access_mode, created_at, updated_at)
       VALUES ($1, $2, 'Contract', $3, $4, false, 'enabled', 'limited', now(), now())`,
      [tenantId, `User${n}`, `contract-${n}-${tag}@example.test`, readerRoleId]);
    if (node) {
      await runner.query(`INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, access) VALUES ($1, $2, 'all', 'read')`, [tenantId, limitedId]);
    }
  }
  await pair('companies', (n, at) => insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, created_at, updated_at) VALUES ($1, $2, 'FR', 'Paris', $3, $3)`,
    [tenantId, `Company ${n}`, at]));
  const companyId = rows.companies.older;
  await pair('departments', (n, at) => insertId(runner,
    `INSERT INTO departments (tenant_id, company_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, companyId, `Department ${n}`, at]));
  await pair('suppliers', (n, at) => insertId(runner,
    `INSERT INTO suppliers (tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
    [tenantId, `Supplier ${n}`, at]));
  const supplierId = rows.suppliers.older;
  await pair('contacts', (n, at) => insertId(runner,
    `INSERT INTO contacts (tenant_id, email, first_name, last_name, supplier_id, created_at, updated_at) VALUES ($1, $2, 'Contact', $3, $4, $5, $5)`,
    [tenantId, `contact-${n}-${tag}@example.test`, `Number ${n}`, supplierId, at]));
  await pair('chart_of_accounts', (n, at) => insertId(runner,
    `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, created_at, updated_at) VALUES ($1, $2, $3, 'GLOBAL', $4, $4)`,
    [tenantId, `COA${n}`, `Chart ${n}`, at]));
  await pair('accounts', (n, at) => insertId(runner,
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
    [tenantId, rows.chart_of_accounts.older, 6000 + n, `Account ${n}`, at]));
  await pair('analytics_categories', (n, at) => insertId(runner,
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
    [tenantId, axisId, `Category ${n}`, n, at]));
  await pair('business_processes', (n, at) => insertId(runner,
    `INSERT INTO business_processes (tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
    [tenantId, `Process ${n}`, at]));
  await pair('locations', (n, at) => insertId(runner,
    `INSERT INTO locations (tenant_id, name, hosting_type, location_reference, created_at, updated_at) VALUES ($1, $2, 'on_premise', $3, $4, $4)`,
    [tenantId, `Location ${n}`, `LOC-${n}`, at]));
  // The two applications reach their end of support within the year (the deadlines family needs rows).
  await pair('applications', (n, at) => insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, end_of_support_date, created_at, updated_at)
     VALUES ($1, $2, $3, CURRENT_DATE + $4::int, $5, $5)`,
    [tenantId, `Application ${n}`, `APP-${n}`, n === 1 ? 30 : 60, at]));
  await pair('assets', (n, at) => insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, created_at, updated_at) VALUES ($1, $2, 'server', 'prod', $3, $3)`,
    [tenantId, `Asset ${n}`, at]));
  await pair('interfaces', (n, at) => insertId(runner,
    `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category,
                             integration_route_type, interface_reference, created_at, updated_at)
     VALUES ($1, $2, 'Contract', $3, $4, 'master_data', 'direct', $5, $6, $6)`,
    [tenantId, `Interface ${n}`, rows.applications.older, rows.applications.newer, `INT-${n}`, at]));
  await pair('connections', (n, at) => insertId(runner,
    `INSERT INTO connections (tenant_id, name, topology, connection_reference, created_at, updated_at) VALUES ($1, $2, 'server_to_server', $3, $4, $4)`,
    [tenantId, `Connection ${n}`, `CONN-${n}`, at]));
  await pair('contracts', (n, at) => insertId(runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, created_at, updated_at) VALUES ($1, $2, $3, $4, '2026-01-01', $5, $5)`,
    [tenantId, `Contract ${n}`, companyId, supplierId, at]));
  // The budget lines are one family for the AI: the older row is OPEX, the newer CAPEX.
  await pair('budget_lines', (n, at) => {
    const nature = n === 1 ? 'opex' : 'capex';
    return insertId(runner,
      `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number, paying_company_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'EUR', '2026-01-01', $4, $5, $6, $6)`,
      [tenantId, nature, `${nature} line ${n}`, n, companyId, at]);
  });
  // The chargeback reports of CHARGEBACK_YEAR: both lines, spread evenly over the two companies.
  for (const itemId of [rows.budget_lines.older, rows.budget_lines.newer]) {
    const versionId = await seedVersion(runner, 'opex', tenantId, itemId, CHARGEBACK_YEAR);
    await seedMonths(runner, 'opex', tenantId, versionId, CHARGEBACK_YEAR, { planned: [1200, ...Array(11).fill(0)] });
  }
  await pair('projects', (n, at) => insertId(runner,
    `INSERT INTO portfolio_projects (tenant_id, name, item_number, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, `Project ${n}`, n, at]));
  await pair('requests', (n, at) => insertId(runner,
    `INSERT INTO portfolio_requests (tenant_id, name, item_number, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, `Request ${n}`, n, at]));
  await pair('tasks', (n, at) => insertId(runner,
    `INSERT INTO tasks (tenant_id, title, item_number, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, `Task ${n}`, n, at]));
  const libraryId = await insertId(runner,
    `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Contract library', $2)`, [tenantId, `contract-${tag}`]);
  await pair('documents', (n, at) => insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'published', $5, $5)`,
    [tenantId, libraryId, `Document ${n}`, n, at]));
  await pair('incidents', (n, at) => insertId(runner,
    `INSERT INTO incidents (tenant_id, title, item_number, severity, created_at, updated_at) VALUES ($1, $2, $3, 'minor', $4, $4)`,
    [tenantId, `Incident ${n}`, n, at]));
  await pair('technologies', (n, at) => insertId(runner,
    `INSERT INTO technologies (tenant_id, name, item_number, editor, created_at, updated_at) VALUES ($1, $2, $3, 'Contract Inc.', $4, $4)`,
    [tenantId, `Technology ${n}`, n, at]));
  // One row per version of a technology: the two rows hang on the older technology.
  await pair('technology_versions', (n, at) => insertId(runner,
    `INSERT INTO technology_versions (tenant_id, technology_id, label, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
    [tenantId, rows.technologies.older, `Contract ${n}`, at]));
  // The CVE cache is shared by every tenant; the rows are this tenant's, first detected a year apart.
  const cves = [1, 2].map((n) => `CVE-2098-${`${tag.replace(/\D/g, '')}0000`.slice(0, 4)}${n}`);
  await runner.query(`INSERT INTO vulnerability_cves (cve_id, severity) VALUES ($1, 'high'), ($2, 'low') ON CONFLICT DO NOTHING`, cves);
  await pair('vulnerabilities', (n, at) => insertId(runner,
    `INSERT INTO technology_vulnerabilities (tenant_id, technology_id, cve_id, match_basis, detected_at, updated_at) VALUES ($1, $2, $3, 'version_unknown', $4, $4)`,
    [tenantId, rows.technologies.older, cves[n - 1], at]));

  return { tenantId, userId, rows };
}

function context(runner: QueryRunner, seed: Seed) {
  return {
    tenantId: seed.tenantId,
    userId: seed.userId,
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: runner.manager,
  };
}

type Run = { error: string | null; ids: string[]; sql: string; result: any };

/** One query in a savepoint, with the statements it sent (numbers masked: parameter counters, limits). */
async function runQuery(runner: QueryRunner, executor: any, ctx: any, requested: Record<string, unknown>): Promise<Run> {
  const input = withRequired(requested);
  await runner.query('SAVEPOINT contract_query');
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, params?: unknown[], ...rest: unknown[]) => {
    statements.push(`${sql}\n${JSON.stringify(params ?? [])}`.replace(/\d+/g, 'N'));
    return original(sql, params as any[], ...(rest as []));
  };
  try {
    const result = await executor.execute(ctx, input);
    (runner as any).query = original;
    await runner.query('RELEASE SAVEPOINT contract_query');
    return { error: null, ids: result.items.map((item: any) => item.id), sql: statements.join('\n'), result };
  } catch (error: any) {
    (runner as any).query = original;
    await runner.query('ROLLBACK TO SAVEPOINT contract_query');
    return { error: String(error?.message ?? error), ids: [], sql: '', result: null };
  }
}

function probeValue(entityType: string, name: string, field: any): unknown {
  if (EQ_ONLY_FIELDS[entityType]?.has(name)) return { op: 'eq', value: 2999 };
  if (field.type === 'set') return [field.values?.find((value: unknown) => value !== null) ?? '__contract_probe__'];
  if (field.type === 'text') return '__contract_probe__';
  if (field.type === 'number') return { op: 'gt', value: 123456789 };
  return { op: 'after', value: '2999-01-01' };
}

async function testStaticConsistency(harness: Harness) {
  for (const [entityType, registry] of Object.entries<any>(harness.registries.aiEntityRegistries)) {
    for (const [name, field] of Object.entries<any>(registry.fields)) {
      const listed = Object.prototype.hasOwnProperty.call(registry.sortFields, name);
      assert.equal(field.sortable === true, listed, `${entityType}.${name}: flagged sortable exactly when it is a sort field`);
      if (listed) {
        // A task's `related` sorts on the family the assistant displays (`related_family`), not on
        // the stored type the screen filters (`related_object_type`, lot 3 point 8).
        const sortKey = entityType === 'tasks' && name === 'related' ? 'related_family' : field.grid;
        assert.equal(registry.sortFields[name], sortKey, `${entityType}.${name}: sorts on the displayed column`);
      }
    }
    // The report rows are computed from the live tables and carry no created_at of their own.
    if (!IN_MEMORY_FAMILIES.has(entityType)) {
      for (const name of ['created_at', 'updated_at']) {
        assert.ok(registry.sortFields[name], `${entityType}: sorts on ${name}`);
      }
    }
    assert.ok(registry.sortFields[registry.defaultSort.field] ?? registry.defaultSort.field, `${entityType}: default sort`);
  }
}

async function testEveryAdvertisedSortAndFilterApplies(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const failures: string[] = [];
  for (const entityType of Object.keys(harness.registries.aiEntityRegistries)) {
    const registry = await harness.registries.resolveAiEntityRegistry(ctx, entityType);
    // An unknown column, through the registry so the executor passes it on: the service's own fallback.
    registry.sortFields.__contract_probe__ = '__no_such_column__';
    let unknownAsc: Run;
    let unknownDesc: Run;
    try {
      unknownAsc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field: '__contract_probe__', direction: 'asc' } });
      unknownDesc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field: '__contract_probe__', direction: 'desc' } });
    } finally {
      delete registry.sortFields.__contract_probe__;
    }
    const unfiltered = await runQuery(runner, harness.executor, ctx, { entity_type: entityType });
    assert.equal(unfiltered.error, null, `${entityType}: the default query runs (${unfiltered.error})`);
    assert.ok(unfiltered.ids.length >= 2, `${entityType}: the seeded rows are listed (${unfiltered.ids.length})`);

    const inMemory = IN_MEMORY_FAMILIES.has(entityType);
    for (const [field, grid] of Object.entries<string>(registry.sortFields)) {
      const asc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field, direction: 'asc' } });
      const desc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field, direction: 'desc' } });
      const label = `${entityType} sort ${field} (${grid})`;
      if (asc.error || desc.error) failures.push(`${label}: fails: ${asc.error ?? desc.error}`);
      else if (asc.result.sort_ignored.length || desc.result.sort_ignored.length) failures.push(`${label}: reported as ignored`);
      else if (inMemory) {
        // The rows are ordered in memory: the statements cannot tell, the applied order can.
        const applied = (run: Run) => run.result.sort?.field;
        if (applied(asc) !== field || applied(desc) !== field) failures.push(`${label}: the result names another order`);
      } else if (asc.sql === desc.sql) failures.push(`${label}: asc and desc send the same statements`);
      else if (!unknownAsc.error && asc.sql === unknownAsc.sql && desc.sql === unknownDesc.sql && SERVICE_FALLBACK_SORT[entityType] !== grid) {
        failures.push(`${label}: sorts like an unknown column (the service falls back to ${SERVICE_FALLBACK_SORT[entityType] ?? 'its default'})`);
      }
    }

    for (const [field, definition] of Object.entries<any>(registry.fields)) {
      const filtered = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, filters: { [field]: probeValue(entityType, field, definition) } });
      const label = `${entityType} filter ${field} (${definition.grid}, ${definition.type})`;
      if (filtered.error) failures.push(`${label}: fails: ${filtered.error}`);
      else if (filtered.result.filters_ignored.length) failures.push(`${label}: reported as ignored`);
      else if (inMemory && !filtered.result.filters_applied.includes(field)) failures.push(`${label}: not named as applied`);
      else if (!inMemory && filtered.sql === unfiltered.sql) failures.push(`${label}: sends the same statements as no filter`);
    }
  }
  assert.deepEqual(failures, [], `every advertised sort and filter applies:\n${failures.join('\n')}`);
}

/** The consolidation account reads the accounts for the administrator of the seed, never a null column. */
async function testConsolidationReadsTheAccounts(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const filtered = await runQuery(runner, harness.executor, ctx, { entity_type: 'budget_lines', filters: { consolidation_account: ['[601] Software'] } });
  assert.equal(filtered.error, null, `the filter runs (${filtered.error})`);
  assert.ok(filtered.sql.includes('cons_labels'), 'the filter reads the consolidation accounts');
  const sorted = await runQuery(runner, harness.executor, ctx, { entity_type: 'budget_lines', sort: { field: 'consolidation_account', direction: 'asc' } });
  assert.ok(sorted.sql.includes('cons_labels'), 'the sort reads them');
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, params?: unknown[], ...rest: unknown[]) => {
    statements.push(sql);
    return original(sql, params as any[], ...(rest as []));
  };
  try {
    await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'consolidation_account' });
  } finally {
    (runner as any).query = original;
  }
  assert.ok(statements.some((sql) => sql.includes('cons_labels')), 'the group reads them');
}

/** Budget lines grouped by line: each line by its reference and title, never by its id (lot L8 C). */
async function testBudgetLineGroup(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const result = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line' });
  const groups = [...result.groups].sort((a: any, b: any) => String(a.key).localeCompare(String(b.key)));
  assert.deepEqual(groups.map((group: any) => [group.key, group.title, group.count]), [['BL-1', 'opex line 1', 1], ['BL-2', 'capex line 2', 1]], 'one group per line, by reference and title');
  const ids = [seed.rows.budget_lines.older, seed.rows.budget_lines.newer];
  assert.equal(ids.some((id) => JSON.stringify(result).includes(id)), false, 'no line id in the result');
}

async function testCreatedAtOrderOnSeededRows(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  for (const [entityType, { older, newer }] of Object.entries(seed.rows)) {
    const desc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field: 'created_at', direction: 'desc' } });
    assert.equal(desc.error, null, `${entityType}: created_at desc runs (${desc.error})`);
    assert.deepEqual(desc.result.sort, { field: 'created_at', direction: 'desc' }, `${entityType}: the result names its order`);
    assert.deepEqual(desc.ids.slice(0, 2), [newer, older], `${entityType}: created_at desc lists the latest created first`);
    assert.equal(desc.result.items[0].created_at, NEWER, `${entityType}: an item carries its created_at`);
    const asc = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, sort: { field: 'created_at', direction: 'asc' } });
    assert.ok(asc.ids.indexOf(older) < asc.ids.indexOf(newer) && asc.ids.indexOf(older) >= 0, `${entityType}: created_at asc lists the older first`);
  }
}

async function testUnknownSortIsReported(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const registry = harness.registries.aiEntityRegistries.applications;
  const { result } = await runQuery(runner, harness.executor, ctx, { entity_type: 'applications', sort: { field: 'creation_date', direction: 'desc' } });
  assert.deepEqual(result.sort_ignored, ['creation_date'], 'the unknown field is named');
  assert.deepEqual(result.sort, registry.defaultSort, 'the result names the order it applied');
  assert.ok(result.sortable_fields.includes('created_at') && result.sortable_fields.includes('sequential_id'), 'the fields it could have used');
  assert.equal(result.complete, false, 'a result in another order than asked is not complete');
  assert.equal(result.items.length, 2, 'the items still come, in the default order');

  const known = await runQuery(runner, harness.executor, ctx, { entity_type: 'applications', sort: { field: 'sequential_id', direction: 'desc' } });
  assert.deepEqual(known.result.sort_ignored, [], 'a known field ignores nothing');
  assert.deepEqual(known.ids, [seed.rows.applications.newer, seed.rows.applications.older], 'APP-2 before APP-1');
}

async function testPageSizes(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const { AI_QUERY_DEFAULT_LIMIT, AI_QUERY_MAX_LIMIT, AI_QUERY_FAMILY_MAX_LIMIT } = require('../query/ai-query.executor');
  const limitOf = async (entityType: string, limit?: number) =>
    (await runQuery(runner, harness.executor, ctx, { entity_type: entityType, ...(limit ? { limit } : {}) })).result.limit;
  assert.equal(await limitOf('suppliers'), AI_QUERY_DEFAULT_LIMIT, 'the default page size');
  assert.equal(await limitOf('suppliers', 7), 7, 'a smaller page size is kept');
  assert.equal(await limitOf('suppliers', 500), AI_QUERY_MAX_LIMIT, 'a larger one is reduced to the maximum');
  const capped = await runQuery(runner, harness.executor, ctx, { entity_type: 'budget_lines', limit: 31 });
  assert.deepEqual(capped.result.limit_capped, { requested: 31, applied: 30 }, 'a reduced page size is named');
  const kept = await runQuery(runner, harness.executor, ctx, { entity_type: 'budget_lines', limit: 30 });
  assert.equal(kept.result.limit_capped, undefined, 'a page size within the maximum is not');
  for (const [entityType, max] of Object.entries<number>(AI_QUERY_FAMILY_MAX_LIMIT)) {
    assert.equal(await limitOf(entityType, 500), max, `${entityType}: its own maximum`);
    assert.equal(await limitOf(entityType), Math.min(AI_QUERY_DEFAULT_LIMIT, max), `${entityType}: its default`);
  }
  const page = await runQuery(runner, harness.executor, ctx, { entity_type: 'suppliers', limit: 1, page: 2, sort: { field: 'created_at', direction: 'desc' } });
  assert.deepEqual(page.ids, [seed.rows.suppliers.older], 'page 2 of 1 is the second row');
  assert.equal(page.result.truncated, false, 'the last page is not truncated');
}

async function testAmountsCurrency(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  // Not the lines' currency (EUR): the amounts follow the tenant's reporting currency.
  await runner.query(`UPDATE tenants SET metadata = metadata || '{"reporting_currency":"CHF"}'::jsonb WHERE id = $1`, [seed.tenantId]);
  for (const entityType of ['budget_lines']) {
    const { result, error } = await runQuery(runner, harness.executor, ctx, { entity_type: entityType });
    assert.equal(error, null, `${entityType}: runs (${error})`);
    assert.equal(result.amounts_currency, 'CHF', `${entityType}: the amounts are in the reporting currency`);
    assert.match(result.amounts_currency_note, /CHF is the reporting currency/, `${entityType}: the note says so`);
    assert.equal(result.items[0].metadata.currency, 'EUR', `${entityType}: the item keeps its own currency`);
    assert.equal(result.items[0].metadata.amounts_fx_missing_years, null, `${entityType}: no year without a rate`);

    const sum = await harness.aggregates.execute(ctx, { entity_type: entityType, group_by: 'currency', metric: 'y_budget', function: 'sum' });
    assert.equal(sum.amounts_currency, 'CHF', `${entityType}: a sum of amounts names their currency`);
    assert.deepEqual(sum.amounts_fx_missing, [], `${entityType}: no amount left out`);
    assert.doesNotMatch(sum.amounts_currency_note, /not included/, `${entityType}: nothing to tell`);
    const count = await harness.aggregates.execute(ctx, { entity_type: entityType, group_by: 'currency' });
    assert.equal(count.amounts_currency, undefined, `${entityType}: a count has no currency`);
    assert.equal(count.amounts_fx_missing, undefined, `${entityType}: a count leaves nothing out`);
    const fte = await harness.aggregates.execute(ctx, { entity_type: entityType, group_by: 'currency', metric: 'y_budget_fte', function: 'sum' });
    assert.equal(fte.amounts_currency, undefined, `${entityType}: nor an FTE`);

    const detail = await harness.executor.executeDetail(ctx, { entity_type: entityType, entity_id: seed.rows[entityType].newer });
    assert.equal(detail.amounts_currency, 'CHF', `${entityType}: the detail names the currency of its amounts`);
    assert.match(detail.amounts_currency_note, /versions\.\*\.totals and financial_versions are in the line's own currency/, `${entityType}: and which ones are the line's`);
  }

  const contracts = await runQuery(runner, harness.executor, ctx, { entity_type: 'contracts' });
  assert.equal(contracts.result.amounts_currency, null, 'contracts: no single currency');
  assert.match(contracts.result.amounts_currency_note, /each contract's own currency/, 'contracts: each its own');
  const contractSum = await harness.aggregates.execute(ctx, { entity_type: 'contracts', group_by: 'currency', metric: 'yearly_amount', function: 'sum' });
  assert.match(contractSum.amounts_currency_note, /do not add up/, 'contracts: a sum warns across currencies');
  const users = await runQuery(runner, harness.executor, ctx, { entity_type: 'users' });
  assert.equal('amounts_currency' in users.result, false, 'a family without amounts says nothing');

  // An EUR line with an amount this year, and no EUR rate into CHF: left out of the sum, named.
  const year = new Date().getFullYear();
  const versionId = await seedVersion(runner, 'opex', seed.tenantId, seed.rows.budget_lines.newer, year);
  await seedMonths(runner, 'opex', seed.tenantId, versionId, year, { planned: [1200, ...Array(11).fill(0)] });
  const leftOut = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'currency', metric: 'y_budget', function: 'sum' });
  assert.deepEqual(leftOut.amounts_fx_missing, [{ currency: 'EUR', year, lines: 1 }], 'the pair and its lines');
  assert.equal(Number(leftOut.groups.find((group: any) => group.key === 'EUR')?.value), 0, 'the 1,200 EUR are left out, never counted at 1');
  assert.match(leftOut.amounts_currency_note, new RegExp(`EUR ${year} \\(1 line\\)`), 'the note names the pair');
  assert.match(leftOut.amounts_currency_note, /Tell the user that those amounts are not included/, 'and asks to say so');

  const { budgetFxMissingYears } = require('../query/ai-query.executor');
  const reporting = (currency: string, fx_source: string) => ({ reporting: { currency, reporting_currency: 'EUR', fx_source } });
  const row = { versions: { y: reporting('USD', 'missing'), yPlus1: reporting('USD', 'live'), yMinus1: reporting('EUR', 'missing') } };
  assert.deepEqual(budgetFxMissingYears(row, 2026), [2026], 'a year without a rate for another currency is named, not the reporting currency');
}

/** Every filter value the AI may send for a field, one per shape the adapter turns it into. */
function filterShapes(entityType: string, name: string, field: any): Array<[string, unknown]> {
  if (EQ_ONLY_FIELDS[entityType]?.has(name)) return [['eq', { op: 'eq', value: CHARGEBACK_YEAR }]];
  if (field.type === 'set') {
    const value = field.values?.find((entry: unknown) => entry !== null) ?? '__contract_probe__';
    return [['set', [value]], ['set with blank', [value, null]], ['set to exclude', { not: [value] }]];
  }
  if (field.type === 'text') return [['text', '__contract_probe__']];
  if (field.type === 'number') {
    return [...['eq', 'gt', 'gte', 'lt', 'lte'].map((op): [string, unknown] => [op, { op, value: 3 }]), ['between', { op: 'between', value: 1, valueTo: 9 }]];
  }
  return [
    ...['eq', 'before', 'after'].map((op): [string, unknown] => [op, { op, value: '2026-02-03' }]),
    ['between', { op: 'between', value: '2026-01-01', valueTo: '2026-12-31' }],
    ...(field.blankable ? [['blank', [null]] as [string, unknown]] : []),
  ];
}

/** One aggregate in a savepoint: its error, if any. */
async function runAggregate(runner: QueryRunner, aggregates: any, ctx: any, input: Record<string, unknown>): Promise<string | null> {
  await runner.query('SAVEPOINT contract_aggregate');
  try {
    const result = await aggregates.execute(ctx, withRequired(input));
    await runner.query('RELEASE SAVEPOINT contract_aggregate');
    return result?.status === 'invalid_filter' ? `invalid filter ${JSON.stringify(result.filters_ignored)}` : null;
  } catch (error: any) {
    await runner.query('ROLLBACK TO SAVEPOINT contract_aggregate');
    return String(error?.message ?? error);
  }
}

async function testEveryFilterShapeIsAccepted(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const failures: string[] = [];
  let checked = 0;
  for (const entityType of Object.keys(harness.registries.aiEntityRegistries)) {
    const registry = await harness.registries.resolveAiEntityRegistry(ctx, entityType);
    const groupBy = Object.entries<any>(registry.fields).find(([, field]) => field.groupable)?.[0];
    for (const [name, field] of Object.entries<any>(registry.fields)) {
      for (const [shape, value] of filterShapes(entityType, name, field)) {
        checked += 1;
        const label = `${entityType} filter ${name} (${field.grid}, ${shape})`;
        const query = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, filters: { [name]: value } });
        if (query.error) failures.push(`${label}: the query fails: ${query.error}`);
        if (!groupBy) continue;
        const error = await runAggregate(runner, harness.aggregates, ctx, { entity_type: entityType, group_by: groupBy, filters: { [name]: value } });
        // A shape the adapter does not send for this column (an exclude set where the list has no exclude mode) is reported, not sent.
        if (error && !(shape === 'set to exclude' && /invalid filter/.test(error))) failures.push(`${label}: the aggregate fails: ${error}`);
      }
    }
  }
  // A year of the chargeback reports takes one value: any other operator is refused in words.
  for (const [entityType, fields] of Object.entries(EQ_ONLY_FIELDS)) {
    for (const name of fields) {
      for (const op of ['gt', 'gte', 'lt', 'lte']) {
        const refused = await runQuery(runner, harness.executor, ctx, { entity_type: entityType, filters: { [name]: { op, value: 2026 } } });
        if (!/reads one year/.test(refused.error ?? '')) failures.push(`${entityType} filter ${name} ${op}: not refused in words (${refused.error})`);
      }
    }
  }
  assert.ok(checked > 100, `the filter shapes are checked (${checked})`);
  assert.deepEqual(failures, [], `every filter the AI may send is accepted:\n${failures.join('\n')}`);
}

async function run() {
  const harness = await createHarness();
  // The vulnerabilities family is read with the vulnerability feed on only.
  const { Features } = require('../../config/features');
  const feed = Features.VULNERABILITY_FEED_ENABLED;
  Features.VULNERABILITY_FEED_ENABLED = true;
  try {
    await testStaticConsistency(harness);
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const seed = await seedTenant(runner);
      await testEveryAdvertisedSortAndFilterApplies(harness, runner, seed);
      await testEveryFilterShapeIsAccepted(harness, runner, seed);
      await testConsolidationReadsTheAccounts(harness, runner, seed);
      await testBudgetLineGroup(harness, runner, seed);
      await testCreatedAtOrderOnSeededRows(harness, runner, seed);
      await testUnknownSortIsReported(harness, runner, seed);
      await testPageSizes(harness, runner, seed);
      await testAmountsCurrency(harness, runner, seed);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    Features.VULNERABILITY_FEED_ENABLED = feed;
    await harness.app.close();
  }
  console.log('ai-query-registry-contract.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
