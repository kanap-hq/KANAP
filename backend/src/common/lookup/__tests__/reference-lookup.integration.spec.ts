import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { LOOKUP_MAX_IDS, parseLookupIds, parseLookupRequest, runLookup } from '../reference-lookup';
import {
  lookupAccounts,
  lookupAnalyticsValues,
  lookupDepartments,
  lookupReference,
  SUPPLIER_LOOKUP,
  USER_LOOKUP,
} from '../reference-lookups';

// The reference lookups behind the pickers (common/lookup): accent and case
// folding, prefix-first order, the tenant predicate, the page size, the
// lifecycle (search offers active rows, ids return any), the scopes (a
// company's chart, a company's departments, a dimension's values), the people
// lookup (names only, the email for a nameless person or a name two accounts
// share), a row far beyond the old 1,000-row cap, the accounts a line type
// may use (`nature`) and the dimension values it may choose (`applies_to`),
// hydration by ids unfiltered.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const PAST = '2020-06-30T12:00:00Z';

async function insertTenant(runner: QueryRunner, label: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `lookup-${label}-${tenantId.slice(0, 8)}`, `Lookup ${label}`],
  );
  return tenantId;
}

async function useTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function withTenant(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await insertTenant(runner, 'a');
    await useTenant(runner, tenantId);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function insertSuppliers(runner: QueryRunner, tenantId: string, names: string[], extra: { disabled?: boolean; erp?: string } = {}) {
  const rows: Array<{ id: string; name: string }> = await runner.query(
    `INSERT INTO suppliers (tenant_id, name, erp_supplier_id, status, disabled_at)
     SELECT $1, n, $3, $4, $5 FROM unnest($2::text[]) AS n RETURNING id, name`,
    [tenantId, names, extra.erp ?? null, extra.disabled ? 'disabled' : 'enabled', extra.disabled ? PAST : null],
  );
  return new Map(rows.map((row) => [row.name, row.id]));
}

const names = (result: { items: Array<{ name?: unknown }> }) => result.items.map((item) => String(item.name));

async function testAccentAndCaseFolding() {
  await withTenant(async (runner, tenantId) => {
    await insertSuppliers(runner, tenantId, ['Société Générale Informatique', 'Électricité de Lyon', 'Plain supplier']);
    await insertSuppliers(runner, tenantId, ['Hidden ERP match'], { erp: 'ÉRP-4242' });
    const call = { manager: runner.manager, tenantId };
    assert.deepEqual(names(await lookupReference(call, SUPPLIER_LOOKUP, { q: 'societe' })), ['Société Générale Informatique']);
    assert.deepEqual(names(await lookupReference(call, SUPPLIER_LOOKUP, { q: 'GENERALE' })), ['Société Générale Informatique']);
    assert.deepEqual(names(await lookupReference(call, SUPPLIER_LOOKUP, { q: 'electricite' })), ['Électricité de Lyon']);
    assert.deepEqual(names(await lookupReference(call, SUPPLIER_LOOKUP, { q: 'erp-42' })), ['Hidden ERP match'], 'the ERP id is searched, folded');
    // LIKE wildcards are plain text: `%` matches only a `%`.
    assert.deepEqual(names(await lookupReference(call, SUPPLIER_LOOKUP, { q: '%' })), []);
  });
  console.log('ok - accents and case folded on both sides, ERP id searched, wildcards literal');
}

async function testPrefixFirstOrder() {
  await withTenant(async (runner, tenantId) => {
    await insertSuppliers(runner, tenantId, ['Alphabeta', 'Zeta Beta', 'Alpha Beta', 'Beta Corp', 'Bêta Systems', 'Unrelated']);
    const call = { manager: runner.manager, tenantId };
    assert.deepEqual(
      names(await lookupReference(call, SUPPLIER_LOOKUP, { q: 'beta' })),
      ['Beta Corp', 'Bêta Systems', 'Alpha Beta', 'Zeta Beta', 'Alphabeta'],
      'label starts with the text, then a word starts with it, then the rest; ICU order within each group',
    );
    assert.deepEqual(
      names(await lookupReference(call, SUPPLIER_LOOKUP, {})),
      ['Alpha Beta', 'Alphabeta', 'Beta Corp', 'Bêta Systems', 'Unrelated', 'Zeta Beta'],
      'no text: the first rows in ICU order',
    );
  });
  console.log('ok - prefix matches first, then word starts, then the rest');
}

async function testTenantPredicate() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantA = await insertTenant(runner, 'a');
    const tenantB = await insertTenant(runner, 'b');
    await useTenant(runner, tenantA);
    await insertSuppliers(runner, tenantA, ['Shared name A']);
    await useTenant(runner, tenantB);
    await insertSuppliers(runner, tenantB, ['Shared name B']);
    // The session is on tenant B, so RLS lets B's rows through: only the
    // statement's own tenant predicate can keep them out of A's lookup.
    const asA = await runLookup(runner.manager, tenantA, SUPPLIER_LOOKUP, { q: 'shared' });
    assert.deepEqual(asA.items, [], 'a lookup for tenant A never returns tenant B rows, whatever the session');
    const asB = await runLookup(runner.manager, tenantB, SUPPLIER_LOOKUP, { q: 'shared' });
    assert.deepEqual(names(asB), ['Shared name B']);
    const byIdsAsA = await runLookup(runner.manager, tenantA, SUPPLIER_LOOKUP, { ids: [String(asB.items[0] && (asB.items[0] as any).id)] });
    assert.deepEqual(byIdsAsA.items, [], 'ids of another tenant return nothing');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  console.log('ok - every statement carries its tenant predicate besides RLS');
}

async function testLimitAndCap() {
  await withTenant(async (runner, tenantId) => {
    await runner.query(
      `INSERT INTO suppliers (tenant_id, name) SELECT $1, 'Bulk supplier ' || lpad(g::text, 4, '0') FROM generate_series(1, 1100) g`,
      [tenantId],
    );
    const call = { manager: runner.manager, tenantId };
    const first = await lookupReference(call, SUPPLIER_LOOKUP, { q: 'bulk' });
    assert.equal(first.items.length, 30, 'default page: 30 rows');
    assert.equal(first.has_more, true);
    assert.equal((await lookupReference(call, SUPPLIER_LOOKUP, { q: 'bulk', limit: '5' })).items.length, 5);
    assert.equal((await lookupReference(call, SUPPLIER_LOOKUP, { q: 'bulk', limit: '1000' })).items.length, 50, 'capped at 50');
    const far = await lookupReference(call, SUPPLIER_LOOKUP, { q: 'supplier 1099' });
    assert.deepEqual(names(far), ['Bulk supplier 1099'], 'a row beyond the first 1,000 is found by typing');
    assert.equal(far.has_more, false);
  });
  console.log('ok - page of 30 by default, capped at 50, the 1,099th row findable');
}

async function testLifecycleAndIds() {
  await withTenant(async (runner, tenantId) => {
    const active = await insertSuppliers(runner, tenantId, ['Open vendor']);
    const closed = await insertSuppliers(runner, tenantId, ['Closed vendor'], { disabled: true });
    const call = { manager: runner.manager, tenantId };
    assert.deepEqual(names(await lookupReference(call, SUPPLIER_LOOKUP, { q: 'vendor' })), ['Open vendor'], 'search offers active rows');
    const ids = [closed.get('Closed vendor')!, active.get('Open vendor')!];
    const byIds = await lookupReference(call, SUPPLIER_LOOKUP, { ids: ids.join(','), q: 'nothing matches this' });
    assert.deepEqual(names(byIds).sort(), ['Closed vendor', 'Open vendor'], 'ids return any lifecycle and ignore the text');
    const repeated = await lookupReference(call, SUPPLIER_LOOKUP, { ids: [ids[0], 'not-a-uuid'] });
    assert.deepEqual(names(repeated), ['Closed vendor'], 'repeated ids parameter, malformed ids dropped');
    assert.deepEqual((await lookupReference(call, SUPPLIER_LOOKUP, { ids: 'not-a-uuid' })).items, []);
  });
  console.log('ok - search offers active rows; ids return chosen rows of any lifecycle');
}

function testParsing() {
  assert.equal(parseLookupIds(undefined), null);
  assert.equal(parseLookupIds(''), null);
  const id = randomUUID();
  assert.deepEqual(parseLookupIds(`${id.toUpperCase()}, ${id}`), [id], 'deduplicated, lower-cased');
  assert.throws(() => parseLookupIds(Array.from({ length: LOOKUP_MAX_IDS + 1 }, () => randomUUID()).join(',')), /At most 100 ids/);
  const long = parseLookupRequest({ q: `  ${'x'.repeat(300)}  ` });
  assert.equal(long.q?.length, 100, 'the text is trimmed and cut at 100 characters');
  assert.equal(parseLookupRequest({ limit: '-3' }).limit, null);
  console.log('ok - request parsing: ids, text, limit');
}

async function testUsersByNameOnly() {
  await withTenant(async (runner, tenantId) => {
    const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Lookup role') RETURNING id`, [tenantId]);
    const user = async (first: string | null, last: string | null, email: string, status = 'enabled') => (await runner.query(
      `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, role.id, first, last, email, status],
    ))[0].id as string;
    await user('Hélène', 'Dupré', 'hdupre@example.invalid');
    await user('Marc', 'Zola', 'helene.fake@example.invalid');
    await user('Albert', 'Dupont', 'adupont@example.invalid');
    const nameless = await user(null, null, 'noname@example.invalid');
    await user('Helene', 'Gone', 'gone@example.invalid', 'disabled');
    const call = { manager: runner.manager, tenantId };
    const found = await lookupReference(call, USER_LOOKUP, { q: 'helene' });
    assert.deepEqual(found.items.map((u: any) => `${u.first_name} ${u.last_name}`), ['Hélène Dupré'], 'names only: an email is not searched, disabled people are not offered');
    assert.equal((found.items[0] as any).email, null, 'no email for a person with a name');
    assert.deepEqual((await lookupReference(call, USER_LOOKUP, { q: 'dupre helene' })).items.length, 1, '"last first" is searched too');
    const all = await lookupReference(call, USER_LOOKUP, {});
    assert.deepEqual(all.items.map((u: any) => u.last_name ?? u.email), ['Dupont', 'Dupré', 'noname@example.invalid', 'Zola'], 'sorted by last name (email when no name)');
    const byEmail = await lookupReference(call, USER_LOOKUP, { q: 'noname' });
    assert.deepEqual(byEmail.items.map((u: any) => u.id), [nameless], 'a person without a name is found and shown by email');
    assert.equal((byEmail.items[0] as any).email, 'noname@example.invalid');
    assert.deepEqual((await lookupReference(call, USER_LOOKUP, { q: 'dup' })).items.map((u: any) => u.last_name), ['Dupont', 'Dupré'], 'a last name start ranks first');
  });
  console.log('ok - people: names only, last name order, email only for a nameless person');
}

async function testUsersSharingAName() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await insertTenant(runner, 'a');
    const otherTenant = await insertTenant(runner, 'b');
    const insertUsers = async (tenant: string, rows: Array<[string | null, string | null, string, string?]>) => {
      await useTenant(runner, tenant);
      const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Lookup role') RETURNING id`, [tenant]);
      const ids = new Map<string, string>();
      for (const [first, last, email, status] of rows) {
        const [row] = await runner.query(
          `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenant, role.id, first, last, email, status ?? 'enabled'],
        );
        ids.set(email, row.id);
      }
      return ids;
    };
    // The twin in the other tenant shares Unique Person's name: it must not count.
    await insertUsers(otherTenant, [['Unique', 'Person', 'unique.elsewhere@example.invalid']]);
    const ids = await insertUsers(tenantId, [
      ['Ana', 'Diaz', 'ana.user@example.invalid'],
      [' ana', 'diaz ', 'ana.admin@example.invalid'],
      ['Unique', 'Person', 'unique@example.invalid'],
      [null, null, 'nameless@example.invalid'],
      // A disabled account still makes a name shared: its stored assignments read the same everywhere.
      ['Bob', 'Martin', 'bob@example.invalid'],
      ['Bob', 'Martin', 'bob.old@example.invalid', 'disabled'],
    ]);
    const call = { manager: runner.manager, tenantId };
    const emailOf = new Map(
      (await lookupReference(call, USER_LOOKUP, { ids: Array.from(ids.values()).join(',') })).items.map((u: any) => [u.id, u.email]),
    );
    assert.equal(emailOf.get(ids.get('ana.user@example.invalid')!), 'ana.user@example.invalid', 'a shared name (case and spaces ignored) shows the email');
    assert.equal(emailOf.get(ids.get('ana.admin@example.invalid')!), 'ana.admin@example.invalid');
    assert.equal(emailOf.get(ids.get('unique@example.invalid')!), null, 'a unique name keeps no email, whatever another tenant holds');
    assert.equal(emailOf.get(ids.get('nameless@example.invalid')!), 'nameless@example.invalid', 'a nameless person keeps its email');
    assert.equal(emailOf.get(ids.get('bob@example.invalid')!), 'bob@example.invalid', 'a disabled twin makes the name shared');
    assert.equal(emailOf.get(ids.get('bob.old@example.invalid')!), 'bob.old@example.invalid', 'the disabled twin reads its email when hydrated');

    const byTwinEmail = await lookupReference(call, USER_LOOKUP, { q: 'ana.admin@' });
    assert.deepEqual(byTwinEmail.items.map((u: any) => u.id), [ids.get('ana.admin@example.invalid')], 'the email shown finds its account');
    assert.deepEqual((await lookupReference(call, USER_LOOKUP, { q: 'unique@example' })).items, [], 'a unique name is still not found by email');
    assert.deepEqual(
      (await lookupReference(call, USER_LOOKUP, { q: 'ana diaz' })).items.map((u: any) => u.email).sort(),
      ['ana.admin@example.invalid', 'ana.user@example.invalid'],
      'both twins are found by their name, each with its email',
    );

    // The knowledge contributor options label the same people the same way (enabled only).
    const knowledge = Object.create(KnowledgeService.prototype) as KnowledgeService;
    const options = await knowledge.listContributorOptions({ manager: runner.manager });
    const labels = new Map(options.map((option) => [option.email, option.label]));
    assert.equal(labels.get('ana.user@example.invalid'), 'ana.user@example.invalid');
    assert.equal(labels.get('ana.admin@example.invalid'), 'ana.admin@example.invalid');
    assert.equal(labels.get('bob@example.invalid'), 'bob@example.invalid', 'a disabled twin counts for the contributor options too');
    assert.equal(labels.get('unique@example.invalid'), 'Unique Person');
    assert.equal(labels.get('nameless@example.invalid'), 'nameless@example.invalid');
    assert.equal(labels.has('unique.elsewhere@example.invalid'), false);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  console.log('ok - people sharing a name show (and are found by) their email; unique names stay names only');
}

async function testScopes() {
  await withTenant(async (runner, tenantId) => {
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
    const chartA = await one(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'LKA', 'Chart A', 'FR') RETURNING id`, [tenantId]);
    const chartB = await one(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso, is_global_default) VALUES ($1, 'LKB', 'Chart B', 'FR', true) RETURNING id`, [tenantId]);
    const companyA = await one(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Company A', 'FR', 'Lyon', $2) RETURNING id`, [tenantId, chartA]);
    const companyNoChart = await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Company without chart', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    for (const [chart, number, name] of [[chartA, 6100, 'Software licences'], [chartA, 2610, 'Hardware 61'], [chartA, 6200, 'Logiciels réseau'], [chartB, 6100, 'Other chart licences']] as const) {
      await runner.query(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, $3, $4)`, [tenantId, chart, number, name]);
    }
    const call = { manager: runner.manager, tenantId };
    const chartAAccounts = await lookupAccounts(call, { companyId: companyA });
    assert.deepEqual(chartAAccounts.items.map((a: any) => Number(a.account_number)), [2610, 6100, 6200], "the company's chart only, by number");
    assert.deepEqual((await lookupAccounts(call, { companyId: companyA, q: '61' })).items.map((a: any) => a.account_name), ['Software licences', 'Hardware 61'], 'a number start ranks first');
    assert.deepEqual((await lookupAccounts(call, { companyId: companyA, q: 'logiciels reseau' })).items.length, 1);
    assert.deepEqual((await lookupAccounts(call, { companyId: companyNoChart })).items.map((a: any) => a.account_name), ['Other chart licences'], 'no chart: the global default chart');
    await assert.rejects(() => lookupAccounts(call, { companyId: 'nope' }), /companyId must be a uuid/);

    await runner.query(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Finance A'), ($1, $3, 'Finance B')`, [tenantId, companyA, companyNoChart]);
    assert.deepEqual(names(await lookupDepartments(call, { company_id: companyA, q: 'fin' })), ['Finance A'], "one company's departments");

    const axis1 = await one(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'lk1', 'Axis 1') RETURNING id`, [tenantId]);
    const axis2 = await one(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'lk2', 'Axis 2') RETURNING id`, [tenantId]);
    await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Réseau'), ($1, $3, 'Réseau bis')`, [tenantId, axis1, axis2]);
    assert.deepEqual(names(await lookupAnalyticsValues(call, { axis_id: axis1, q: 'reseau' })), ['Réseau'], "one dimension's values");
  });
  console.log("ok - scopes: a company's chart (global default without one), a company's departments, a dimension's values");
}

async function testAccountNature() {
  await withTenant(async (runner, tenantId) => {
    const [chart] = await runner.query(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'LKN', 'Chart N', 'FR') RETURNING id`, [tenantId]);
    const ids: Record<string, string> = {};
    for (const [number, name, nature] of [[6100, 'Licences', 'opex'], [2100, 'Servers', 'capex'], [6900, 'Shared', null]] as const) {
      const [row] = await runner.query(
        `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, nature) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, chart.id, number, name, nature],
      );
      ids[name] = row.id;
    }
    const call = { manager: runner.manager, tenantId };
    const offered = async (query: Record<string, unknown>) => (await lookupAccounts(call, { coaId: chart.id, ...query })).items.map((a: any) => `${a.account_name}:${a.nature ?? 'both'}`);
    assert.deepEqual(await offered({}), ['Servers:capex', 'Licences:opex', 'Shared:both'], 'no nature: every account, with its nature');
    assert.deepEqual(await offered({ nature: 'opex' }), ['Licences:opex', 'Shared:both'], 'OPEX lines: OPEX accounts and accounts for both');
    assert.deepEqual(await offered({ nature: 'capex' }), ['Servers:capex', 'Shared:both'], 'CAPEX lines: CAPEX accounts and accounts for both');
    assert.deepEqual(await offered({ nature: 'capex', q: 'lic' }), [], 'the search stays within the nature');
    const hydrated = await lookupAccounts(call, { nature: 'capex', ids: ids.Licences });
    assert.deepEqual(hydrated.items.map((a: any) => a.account_name), ['Licences'], 'ids hydrate an account of the other type');
    await assert.rejects(() => lookupAccounts(call, { nature: 'both' }), /nature must be 'opex' or 'capex'/);
  });
  console.log('ok - account nature: the accounts a line type may use, ids unfiltered');
}

async function testValueAppliesTo() {
  await withTenant(async (runner, tenantId) => {
    const [axis] = await runner.query(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'lkv', 'Nature') RETURNING id`, [tenantId]);
    const [otherAxis] = await runner.query(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'lkw', 'Other') RETURNING id`, [tenantId]);
    const ids: Record<string, string> = {};
    for (const [name, appliesTo] of [['Abonnements SaaS', 'opex'], ['Matériel', 'capex'], ['Licences', null]] as const) {
      const [row] = await runner.query(
        `INSERT INTO analytics_categories (tenant_id, axis_id, name, applies_to) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, axis.id, name, appliesTo],
      );
      ids[name] = row.id;
    }
    await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Elsewhere')`, [tenantId, otherAxis.id]);
    const call = { manager: runner.manager, tenantId };
    const offered = async (query: Record<string, unknown>) =>
      (await lookupAnalyticsValues(call, { axis_id: axis.id, ...query })).items.map((v: any) => `${v.name}:${v.applies_to ?? 'both'}`);
    assert.deepEqual(await offered({}), ['Abonnements SaaS:opex', 'Licences:both', 'Matériel:capex'], 'no type: every value, with its type');
    assert.deepEqual(await offered({ applies_to: 'opex' }), ['Abonnements SaaS:opex', 'Licences:both'], 'OPEX lines: OPEX values and values for both');
    assert.deepEqual(await offered({ applies_to: 'capex' }), ['Licences:both', 'Matériel:capex'], 'CAPEX lines: CAPEX values and values for both');
    assert.deepEqual(await offered({ applies_to: 'capex', q: 'abon' }), [], 'the search stays within the type');
    assert.deepEqual(await offered({ applies_to: 'opex', q: 'abon' }), ['Abonnements SaaS:opex']);
    assert.deepEqual(await offered({ applies_to: '' }), ['Abonnements SaaS:opex', 'Licences:both', 'Matériel:capex'], 'blank is no filter');
    const hydrated = await lookupAnalyticsValues(call, { applies_to: 'capex', ids: ids['Abonnements SaaS'] });
    assert.deepEqual(hydrated.items.map((v: any) => [v.name, v.applies_to]), [['Abonnements SaaS', 'opex']], 'ids hydrate a value of the other type');
    await assert.rejects(() => lookupAnalyticsValues(call, { axis_id: axis.id, applies_to: 'both' }), /applies_to must be 'opex' or 'capex'\./);
  });
  console.log('ok - value applies_to: the values a line type may choose, ids unfiltered');
}

async function main() {
  await dataSource.initialize();
  try {
    testParsing();
    await testAccentAndCaseFolding();
    await testPrefixFirstOrder();
    await testTenantPredicate();
    await testLimitAndCap();
    await testLifecycleAndIds();
    await testUsersByNameOnly();
    await testUsersSharingAName();
    await testScopes();
    await testAccountNature();
    await testValueAppliesTo();
    console.log('reference-lookup.integration.spec: ok');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
