import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { compareText, textSortKey } from '../list-sort';
import { exportListQuery } from '../pagination';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { CompaniesService } from '../../companies/companies.service';
import { ContactsService } from '../../contacts/contacts.service';
import { DepartmentsService } from '../../departments/departments.service';
import { AssetsListService } from '../../assets/services/assets-list.service';
import { LocationsService } from '../../locations/locations.service';

// Lists sort text alphabetically, ignoring case and accents ("Okta" before "OVHcloud", "Élodie"
// among the Es), with the shared helpers (`common/list-sort.ts`); and a CSV export asked with
// `rows=list` holds what the list shows (search, filters, Show scope, sort), the whole register
// otherwise.

const NAMES = ['OVHcloud', 'Zoé', 'Eric', 'Okta', 'Élodie'];
const ALPHABETICAL = ['Élodie', 'Eric', 'Okta', 'OVHcloud', 'Zoé'];
const PAST = '2020-06-30T12:00:00Z';
const audit = { log: async () => undefined } as any;

async function withTenant(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'List sort test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `list-sort-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** The data lines of a CSV file, whatever its separator. */
function lines(content: string): string[] {
  return content.replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
}

/** The order in which the names appear in an exported file (in one column, or in any). */
function namesIn(content: string, names: string[], column?: number): string[] {
  return lines(content)
    .map((line) => {
      const cells = line.split(/[;,]/);
      return names.find((name) => (column === undefined ? cells.includes(name) : cells[column] === name));
    })
    .filter((name): name is string => !!name);
}

async function testHelpers() {
  await withTenant(async (runner) => {
    const key = await textSortKey(runner.manager);
    const rows: Array<{ v: string }> = await runner.query(
      `SELECT v FROM (VALUES ${NAMES.map((_n, i) => `($${i + 1})`).join(', ')}) t(v) ORDER BY ${key('t.v')}`,
      NAMES,
    );
    assert.deepEqual(rows.map((row) => row.v), ALPHABETICAL, 'SQL text sort key');
  });
  assert.deepEqual([...NAMES].sort(compareText), ALPHABETICAL, 'in-memory text order');
  assert.deepEqual(['CC10', 'cc2', 'CC1'].sort(compareText), ['CC1', 'cc2', 'CC10'], 'in-memory order reads numbers naturally');
  assert.equal(exportListQuery({ scope: 'data', language: 'fr' }), undefined, 'no rows=list: the whole register');
  assert.deepEqual(
    exportListQuery({ scope: 'data', language: 'fr', rows: 'list', q: 'o', sort: 'name:DESC', page: '3', limit: '20' }),
    { q: 'o', sort: 'name:DESC', page: '1', limit: '50000' },
    'rows=list: the list query, every page up to 50,000 rows (the dialog warns past EXPORT_ROW_LIMIT, kept equal)',
  );
}

async function testSuppliers() {
  await withTenant(async (runner, tenantId) => {
    const svc = new SuppliersService(undefined as any, audit);
    const opts = { manager: runner.manager };
    for (const name of NAMES) await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, name]);
    await runner.query(`INSERT INTO suppliers (tenant_id, name, status, disabled_at) VALUES ($1, 'Oracle', 'disabled', $2)`, [tenantId, PAST]);

    const listed = await svc.list({ sort: 'name:ASC' }, opts);
    assert.deepEqual(listed.items.map((s) => s.name), ALPHABETICAL, 'suppliers list: alphabetical');
    const desc = await svc.listIds({ sort: 'name:DESC' }, opts);
    assert.deepEqual(desc.ids, [...listed.items].reverse().map((s) => s.id), 'suppliers ids: the reverse order');

    const all = await svc.exportCsv('data', { ...opts, language: 'en' });
    assert.deepEqual(namesIn(all.content, [...NAMES, 'Oracle']), ['Élodie', 'Eric', 'Okta', 'Oracle', 'OVHcloud', 'Zoé'], 'suppliers export: the whole register');

    const listQuery = exportListQuery({ scope: 'data', rows: 'list', q: 'o', sort: 'name:DESC', status: 'enabled' });
    const shown = await svc.exportCsv('data', { ...opts, language: 'en', listQuery });
    assert.deepEqual(namesIn(shown.content, [...NAMES, 'Oracle']), ['Zoé', 'OVHcloud', 'Okta', 'Élodie'], 'suppliers export: search, scope and sort');

    const filters = JSON.stringify({ name: { filterType: 'text', type: 'startsWith', filter: 'o' } });
    const filtered = await svc.exportCsv('data', { ...opts, language: 'en', listQuery: exportListQuery({ rows: 'list', filters, includeDisabled: '1', sort: 'name:ASC' }) });
    assert.deepEqual(namesIn(filtered.content, [...NAMES, 'Oracle']), ['Okta', 'Oracle', 'OVHcloud'], 'suppliers export: column filter and Show all');
  });
}

async function testCompaniesAndDepartments() {
  await withTenant(async (runner, tenantId) => {
    const companies = new CompaniesService(undefined as any, audit, { list: async () => ({ items: [] }) } as any);
    const departments = new DepartmentsService(undefined as any, undefined as any, audit);
    const opts = { manager: runner.manager };
    const ids: string[] = [];
    for (const name of NAMES) {
      const [row] = await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Paris') RETURNING id`, [tenantId, name]);
      ids.push(row.id);
    }
    await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, status, disabled_at) VALUES ($1, 'Orange', 'FR', 'Paris', 'disabled', $2)`, [tenantId, PAST]);
    for (const name of NAMES) await runner.query(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3)`, [tenantId, ids[0], name]);

    assert.deepEqual((await companies.list({ sort: 'name:ASC' }, opts)).items.map((c: any) => c.name), ALPHABETICAL, 'companies list: alphabetical');
    const year = String(new Date().getFullYear());
    assert.deepEqual((await companies.list({ sort: 'name:ASC', year }, opts)).items.map((c: any) => c.name), ALPHABETICAL, 'companies list with a year: alphabetical');
    const companyIds = await companies.listIds({ sort: 'name:ASC' }, opts);
    assert.deepEqual(companyIds.ids.length, NAMES.length, 'companies ids: enabled only');
    assert.deepEqual((await departments.list({ sort: 'name:ASC' }, opts)).items.map((d: any) => d.name), ALPHABETICAL, 'departments list: alphabetical');
    assert.equal((await departments.list({ sort: 'company_name:DESC' }, opts)).items.length, NAMES.length, 'departments list: by company name');

    const all = await companies.exportCsv('data', { ...opts, language: 'en' });
    assert.equal(namesIn(all.content, [...NAMES, 'Orange']).length, 6, 'companies export: the whole register, disabled included');
    const shown = await companies.exportCsv('data', { ...opts, language: 'en', listQuery: exportListQuery({ rows: 'list', q: 'o', sort: 'name:ASC', status: 'enabled' }) });
    assert.deepEqual(namesIn(shown.content, [...NAMES, 'Orange']), ['Élodie', 'Okta', 'OVHcloud', 'Zoé'], 'companies export: search, scope and sort');
    const disabled = await companies.exportCsv('data', { ...opts, language: 'en', listQuery: exportListQuery({ rows: 'list', status: 'disabled' }) });
    assert.deepEqual(namesIn(disabled.content, [...NAMES, 'Orange']), ['Orange'], 'companies export: the Show scope');

    const deptShown = await departments.exportCsv('data', { ...opts, language: 'en', listQuery: exportListQuery({ rows: 'list', sort: 'name:DESC', filters: JSON.stringify({ name: { filterType: 'text', type: 'contains', filter: 'e' } }) }) });
    assert.deepEqual(namesIn(deptShown.content, NAMES, 1), ['Eric', 'Élodie'], 'departments export: column filter and sort');
  });
}

async function testContacts() {
  await withTenant(async (runner, tenantId) => {
    const svc = new ContactsService(undefined as any, undefined as any, undefined as any, audit as any, undefined as any);
    const opts = { manager: runner.manager, tenantId };
    for (const [index, name] of NAMES.entries()) {
      await runner.query(`INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Ann', $2, $3)`, [tenantId, name, `c${index}@test.ex`]);
    }
    assert.deepEqual((await svc.list({ sort: 'last_name:ASC' }, opts)).items.map((c: any) => c.last_name), ALPHABETICAL, 'contacts list: alphabetical');
    const ids = await svc.listIds({ sort: 'last_name:ASC' }, opts);
    assert.equal(ids.ids.length, NAMES.length, 'contacts ids');
    const all = await svc.exportCsv('data', opts);
    assert.equal(namesIn(all.content, NAMES).length, NAMES.length, 'contacts export: the whole register');
    const shown = await svc.exportCsv('data', { ...opts, listQuery: exportListQuery({ rows: 'list', q: 'o', sort: 'last_name:DESC' }) });
    assert.deepEqual(namesIn(shown.content, NAMES), ['Zoé', 'OVHcloud', 'Okta', 'Élodie'], 'contacts export: search and sort');
  });
}

/** One list per query style: raw SQL (assets), TypeORM find options (locations), query builder (companies above). */
async function testQueryFamilies() {
  await withTenant(async (runner, tenantId) => {
    const opts = { manager: runner.manager, tenantId };
    for (const [index, name] of NAMES.entries()) {
      await runner.query(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'vm', 'prod')`, [tenantId, name]);
      await runner.query(`INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, $2, 'on_prem', $3)`, [tenantId, name, `LOC-T${index}`]);
    }
    const assets = new AssetsListService(undefined as any);
    const assetPage = await assets.list({ sort: 'name:ASC' }, opts as any);
    assert.deepEqual(assetPage.items.map((a: any) => a.name), ALPHABETICAL, 'assets list (raw SQL): alphabetical');
    const assetIds = await assets.listIds({ sort: 'name:DESC' }, opts as any);
    assert.deepEqual(assetIds.ids, [...assetPage.items].reverse().map((a: any) => a.id), 'assets ids (raw SQL): the reverse order');

    const locations = new LocationsService(undefined as any, audit, undefined as any, undefined as any);
    const locationPage = await locations.list({ sort: 'name:ASC' }, opts);
    assert.deepEqual(locationPage.items.map((l: any) => l.name), ALPHABETICAL, 'locations list (find options): alphabetical');
    const created = await locations.list({ sort: 'created_at:DESC', limit: '2', page: '2' }, opts);
    assert.equal(created.items.length, 2, 'locations list: a plain column still pages');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testHelpers();
    await testSuppliers();
    await testCompaniesAndDepartments();
    await testContacts();
    await testQueryFamilies();
  } finally {
    await dataSource.destroy();
  }
  console.log('list-export-sort.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
