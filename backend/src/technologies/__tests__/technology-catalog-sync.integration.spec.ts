// @database-spec
import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { withTenant } from '../../common/tenant-runner';
import { Features } from '../../config/features';
import { assert, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologyCatalogSyncService, type CatalogRuntime, type TenantSyncResult } from '../catalog/technology-catalog-sync.service';
import { mergeProduct, versionsOfReleases } from '../catalog/catalog-releases';
import type { CatalogLanguage, CatalogProduct, CatalogVersion } from '../catalog/technology-catalog.service';
import * as shippedFile from '../catalog/technologies.catalog.json';
import { VulnerabilityMatchService } from '../../vulnerabilities/vulnerability-match.service';
import { asset, installed, services, technology, type AuditEntry } from './technologies.fixtures';

// The living catalog (lot C4, withdrawals and description corrections in lot C5): the sync of a
// tenant's adopted technologies (new version added, a date that follows the catalog, a value the
// tenant typed kept, a version the tenant deleted not created again, CPE identifiers added and
// withdrawn, a description that follows or stays, a technology adopted before the living catalog,
// the other tenant untouched), then the scheduled run against a fake endoflife.date served on
// 127.0.0.1 (cache, cadence, retries, a product read less than 20 hours ago skipped) and with the
// gate off. The cache rows of the run are committed: `postgresql` and `nginx`, deleted before and after.

const KEYS = ['postgresql', 'nginx'];
const HOUR = 60 * 60 * 1000;

/**
 * Days relative to the day the shipped file was read (`source.retrieved_on`): a cache read counts
 * only after that day, so the dates of these cases follow the file and survive a rebuild.
 */
const RETRIEVED_ON = String((shippedFile as unknown as { source: { retrieved_on: string } }).source.retrieved_on);
function shippedDay(offset: number): string {
  return new Date(Date.parse(`${RETRIEVED_ON}T00:00:00.000Z`) + offset * 24 * HOUR).toISOString().slice(0, 10);
}

function syncService(audit: AuditEntry[] = [], events?: { emit: (event: { technologyId: string; products: string[] }) => Promise<void> }) {
  const { catalog } = services(audit);
  const auditLog = { log: async (entry: AuditEntry) => void audit.push(entry) };
  return { catalog, sync: new TechnologyCatalogSyncService(dataSource, { register: () => undefined } as any, catalog, auditLog as any, events as any) };
}

function withoutCpe(product: CatalogProduct, dropped: string[]): CatalogProduct {
  const gone = new Set(dropped.map((p) => p.toLowerCase()));
  return { ...product, cpe_products: product.cpe_products.filter((p) => !gone.has(p.toLowerCase())) };
}

/** `shippedProduct` answers `product` for `key` until the returned function puts the real one back. */
function stubShipped(catalog: { shippedProduct: (key: string) => CatalogProduct | undefined }, key: string, product: CatalogProduct | undefined) {
  const real = catalog.shippedProduct.bind(catalog);
  catalog.shippedProduct = (asked: string) => (asked === key ? product : real(asked));
  return () => { catalog.shippedProduct = real; };
}

function counts(result: TenantSyncResult) {
  const { dates_kept: _kept, malformed_states: _malformed, ...rest } = result;
  return rest;
}

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

type Row = { label: string; standard_support_end: string | null; extended_support_end: string | null; catalog_key: string | null };
async function versionsOf(runner: QueryRunner, technologyId: string): Promise<Map<string, Row>> {
  const rows: Row[] = await runner.query(
    `SELECT label, to_char(standard_support_end, 'YYYY-MM-DD') AS standard_support_end,
            to_char(extended_support_end, 'YYYY-MM-DD') AS extended_support_end, catalog_key
       FROM technology_versions WHERE technology_id = $1`,
    [technologyId],
  );
  return new Map(rows.map((r) => [r.label, r]));
}

/** The shipped PostgreSQL entry one year later: every standard end moved, and a version 99 published. */
function livingPostgres(shipped: CatalogProduct, extraCpe: string[] = []): CatalogProduct {
  const moved = (date: string | null) => (date ? `${Number(date.slice(0, 4)) + 1}${date.slice(4)}` : null);
  const versions: CatalogVersion[] = [
    { key: '99', label: '99', cpe_version: null, build_prefixes: [], release_date: '2026-10-01', standard_support_end: '2031-11-13', extended_support_end: null },
    ...shipped.versions.map((v) => ({ ...v, standard_support_end: moved(v.standard_support_end) })),
  ];
  return { ...shipped, cpe_products: [...shipped.cpe_products, ...extraCpe], versions };
}

async function testSyncOfATenant() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const { catalog, sync } = syncService(audit);
    const tenantId = await seedTenant(runner, 'cat-sync');
    const other = await seedTenant(runner, 'cat-sync-other');
    await setTenant(runner, other);
    const otherTech = (await catalog.adopt('postgresql', { manager: runner.manager, tenantId: other })).technology.id;
    const otherBefore = await versionsOf(runner, otherTech);

    await setTenant(runner, tenantId);
    const opts = { manager: runner.manager, tenantId };
    const { technology } = await catalog.adopt('postgresql', opts);
    const [{ catalog_state: state }] = await runner.query(`SELECT catalog_state FROM technologies WHERE id = $1`, [technology.id]);
    assert.deepEqual(state.cpe_products, ['a:postgresql:postgresql'], 'the adoption records what it offered');
    assert.equal(state.versions['17'].standard_support_end, '2029-11-08');

    // The tenant's own changes: a date typed on 17, version 13 deleted, the identifier removed.
    await runner.query(`UPDATE technology_versions SET standard_support_end = '2029-12-31' WHERE technology_id = $1 AND label = '17'`, [technology.id]);
    await runner.query(`DELETE FROM technology_versions WHERE technology_id = $1 AND label = '13'`, [technology.id]);
    await runner.query(`UPDATE technologies SET cpe_products = '{}' WHERE id = $1`, [technology.id]);

    const shipped = catalog.shippedProduct('postgresql')!;
    const products = new Map([['postgresql', livingPostgres(shipped, ['a:kanapspec:postgres'])]]);
    const result = await sync.syncTenant(runner.manager, tenantId, products);
    assert.deepEqual(counts(result), { technologies: 1, versions_added: 1, versions_updated: 6, cpe_added: 1, cpe_removed: 0, cve_names_added: 0, cve_names_removed: 0, descriptions_updated: 0, versions_attached: 0, errors: [] });

    const after = await versionsOf(runner, technology.id);
    assert.deepEqual(after.get('99'), { label: '99', standard_support_end: '2031-11-13', extended_support_end: null, catalog_key: 'postgresql:99' },
      'the new version comes with its dates and its catalog provenance');
    assert.equal(after.get('18')!.standard_support_end, '2031-11-14', 'a date the catalog wrote follows it');
    assert.equal(after.get('17')!.standard_support_end, '2029-12-31', 'a date the tenant typed stays');
    assert.ok(!after.has('13'), 'a version the tenant deleted is not created again');
    const [tech] = await runner.query(`SELECT cpe_products FROM technologies WHERE id = $1`, [technology.id]);
    assert.deepEqual(tech.cpe_products, ['a:kanapspec:postgres'], 'a new identifier is added, the one the tenant removed is not');
    assert.equal(audit.filter((a) => a.recordId === technology.id && (a.after as any)?.catalog_sync).length, 1, 'one audit row per technology changed');

    const statements: string[] = [];
    const watched = { query: (sql: string, params?: unknown[]) => { statements.push(sql); return runner.manager.query(sql, params); } };
    assert.deepEqual(counts(await sync.syncTenant(watched as any, tenantId, products)), { technologies: 0, versions_added: 0, versions_updated: 0, cpe_added: 0, cpe_removed: 0, cve_names_added: 0, cve_names_removed: 0, descriptions_updated: 0, versions_attached: 0, errors: [] },
      'a second sync changes nothing');
    assert.ok(!statements.some((sql) => /UPDATE technologies|INSERT INTO technology_versions|UPDATE technology_versions/.test(sql)),
      'nor writes anything: the state read back in another key order is the same');

    // The catalog moves again: 18 follows, 17 keeps the tenant's date even when the catalog goes back to its own.
    const again = livingPostgres(shipped);
    again.versions = again.versions.map((v) => (v.key === '18' ? { ...v, standard_support_end: '2033-01-01' } : v.key === '17' ? { ...v, standard_support_end: '2029-11-08' } : v));
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', again]]));
    const third = await versionsOf(runner, technology.id);
    assert.equal(third.get('18')!.standard_support_end, '2033-01-01');
    assert.equal(third.get('17')!.standard_support_end, '2029-12-31');

    // Contradictory dates: the tenant's extended end would fall before the catalog's new standard end.
    await runner.query(`UPDATE technology_versions SET extended_support_end = '2030-01-01' WHERE technology_id = $1 AND label = '16'`, [technology.id]);
    const later = livingPostgres(shipped);
    later.versions = later.versions.map((v) => (v.key === '16' ? { ...v, standard_support_end: '2030-06-30' } : v));
    const contradicted = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', later]]));
    assert.deepEqual(contradicted.dates_kept, ['postgresql 16'], 'the date not applied is logged');
    const fourth = await versionsOf(runner, technology.id);
    assert.deepEqual([fourth.get('16')!.standard_support_end, fourth.get('16')!.extended_support_end], ['2029-11-09', '2030-01-01'],
      'a version whose dates would contradict each other is left as it is');

    await setTenant(runner, other);
    assert.deepEqual(await versionsOf(runner, otherTech), otherBefore, 'the other tenant is untouched by this sync');
  });
}

/** A technology adopted before the living catalog starts from the shipped catalog. */
async function testTechnologyAdoptedBefore() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-old');
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
    await runner.query(`UPDATE technologies SET catalog_state = NULL WHERE id = $1`, [technology.id]);
    await runner.query(`DELETE FROM technology_versions WHERE technology_id = $1 AND label = '12'`, [technology.id]);
    await runner.query(`UPDATE technology_versions SET standard_support_end = '2030-01-31' WHERE technology_id = $1 AND label = '18'`, [technology.id]);
    const shipped = catalog.shippedProduct('postgresql')!;
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', livingPostgres(shipped)]]));
    const after = await versionsOf(runner, technology.id);
    assert.ok(after.has('99'), 'a version published since is added');
    assert.ok(!after.has('12'), 'a shipped version it lacks counts as deleted by the tenant');
    assert.equal(after.get('18')!.standard_support_end, '2030-01-31', 'a value that differs from the shipped one is the tenant\'s');
    assert.equal(after.get('16')!.standard_support_end, '2029-11-09', 'a value equal to the shipped one follows');
    const [{ catalog_state: state }] = await runner.query(`SELECT catalog_state FROM technologies WHERE id = $1`, [technology.id]);
    assert.ok(state && state.versions['99'] && state.versions['12'], 'the state is written');
  });
}

/** C4 review S3: an unreadable state brings nothing back that the tenant deleted. */
async function testMalformedState() {
  for (const raw of ['[]', '{"versions":"x"}', '{}', '{"cpe_products":["a"],"versions":{"17":"x"}}']) {
    await inRolledBackTransaction(async (runner) => {
      const { catalog, sync } = syncService();
      const tenantId = await seedTenant(runner, 'cat-sync-bad');
      const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
      await runner.query(`DELETE FROM technology_versions WHERE technology_id = $1 AND label = '13'`, [technology.id]);
      await runner.query(`UPDATE technologies SET cpe_products = '{}', catalog_state = $2::jsonb WHERE id = $1`, [technology.id, raw]);
      const result = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', livingPostgres(catalog.shippedProduct('postgresql')!)]]));
      assert.deepEqual(result.malformed_states, ['postgresql'], raw);
      const after = await versionsOf(runner, technology.id);
      assert.ok(!after.has('13') && after.has('99'), `${raw}: the deleted version stays deleted, a new one comes`);
      const [tech] = await runner.query(`SELECT cpe_products, catalog_state FROM technologies WHERE id = $1`, [technology.id]);
      assert.deepEqual(tech.cpe_products, [], `${raw}: the identifier the tenant removed is not added back`);
      assert.ok(Array.isArray(tech.catalog_state.cpe_products), 'the state is rewritten in shape');
    });
  }
}

/** C4 review S4 and finding 4: an empty cpe_version on a version of the catalog is completed. */
async function testEmptyCpeVersion() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-cpe');
    const { technology } = await catalog.adopt('ibm-mq', { manager: runner.manager, tenantId });
    const shipped = catalog.shippedProduct('ibm-mq')!;
    const expected = new Map(shipped.versions.map((v) => [v.label, v.cpe_version]));
    assert.ok([...expected.values()].some((v) => v !== null));
    // Adopted before C4 and before the catalog had these values: no state, every cpe_version empty.
    await runner.query(`UPDATE technology_versions SET cpe_version = NULL WHERE technology_id = $1`, [technology.id]);
    await runner.query(`UPDATE technologies SET catalog_state = NULL WHERE id = $1`, [technology.id]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['ibm-mq', shipped]]));
    const read = async () => new Map((await runner.query(`SELECT label, cpe_version FROM technology_versions WHERE technology_id = $1`, [technology.id]))
      .map((r: any) => [r.label, r.cpe_version]));
    assert.deepEqual(await read(), expected, 'every empty cpe_version is completed');
    // With a state: emptied by hand, it is completed again.
    const label = shipped.versions.find((v) => v.cpe_version)!.label;
    await runner.query(`UPDATE technology_versions SET cpe_version = NULL WHERE technology_id = $1 AND label = $2`, [technology.id, label]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['ibm-mq', shipped]]));
    assert.equal((await read()).get(label), expected.get(label));
  });
}

/** C4 review S5 and S6: a withdrawn date never erases one; a contradicting date alone is left. */
async function testWithdrawnAndContradictingDates() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-dates');
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
    const shipped = catalog.shippedProduct('postgresql')!;
    const withVersion = (key: string, change: Partial<CatalogVersion>) => ({ ...shipped, versions: shipped.versions.map((v) => (v.key === key ? { ...v, ...change } : v)) });
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withVersion('17', { standard_support_end: null })]]));
    assert.equal((await versionsOf(runner, technology.id)).get('17')!.standard_support_end, '2029-11-08', 'a date withdrawn upstream stays');
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withVersion('17', { standard_support_end: '2030-01-15' })]]));
    assert.equal((await versionsOf(runner, technology.id)).get('17')!.standard_support_end, '2030-01-15', 'and follows the catalog when a date comes back');

    await runner.query(`UPDATE technology_versions SET extended_support_end = '2030-02-01' WHERE technology_id = $1 AND label = '17'`, [technology.id]);
    const result = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withVersion('17', { standard_support_end: '2030-06-01', cpe_version: '17.0' })]]));
    assert.deepEqual(result.dates_kept, ['postgresql 17']);
    const [row] = await runner.query(
      `SELECT to_char(standard_support_end, 'YYYY-MM-DD') AS s, to_char(extended_support_end, 'YYYY-MM-DD') AS e, cpe_version FROM technology_versions WHERE technology_id = $1 AND label = '17'`,
      [technology.id],
    );
    assert.deepEqual(row, { s: '2030-01-15', e: '2030-02-01', cpe_version: '17.0' }, 'only the date in cause is left, the rest follows');
  });
}

/** C4 review S7 and finding 2: a version typed before the catalog had it is attached and completed. */
async function testTypedVersionIsAttached() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const { catalog, sync } = syncService(audit);
    const tenantId = await seedTenant(runner, 'cat-sync-typed');
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
    // As a server import or a link typing a version creates it (`resolveVersionLabel`): a label, nothing else.
    await runner.query(`INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '99')`, [tenantId, technology.id]);
    await runner.query(`INSERT INTO technology_versions (tenant_id, technology_id, label, extended_support_end) VALUES ($1, $2, 'V20', '2034-01-01')`, [tenantId, technology.id]);
    const shipped = catalog.shippedProduct('postgresql')!;
    const living = livingPostgres(shipped);
    living.versions.unshift({ key: 'v20', label: 'v20', cpe_version: '20', build_prefixes: ['20.0'], release_date: '2026-10-10', standard_support_end: '2032-01-01', extended_support_end: '2035-01-01' });
    const result = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', living]]));
    assert.equal(result.versions_attached, 2);
    assert.equal(result.versions_added, 0);
    const after = await versionsOf(runner, technology.id);
    assert.deepEqual(after.get('99'), { label: '99', standard_support_end: '2031-11-13', extended_support_end: null, catalog_key: 'postgresql:99' });
    assert.deepEqual(after.get('V20'), { label: 'V20', standard_support_end: '2032-01-01', extended_support_end: '2034-01-01', catalog_key: 'postgresql:v20' },
      'attached without case; the date the tenant gave stays');
    const [prefixes] = await runner.query(`SELECT build_prefixes, cpe_version FROM technology_versions WHERE technology_id = $1 AND label = 'V20'`, [technology.id]);
    assert.deepEqual(prefixes, { build_prefixes: ['20.0'], cpe_version: '20' });
    assert.ok(audit.some((a) => (a.after as any)?.catalog_sync?.versions_attached?.length === 2));
    // Attached, the empty fields now follow the catalog; the tenant's date stays.
    living.versions[0] = { ...living.versions[0], standard_support_end: '2032-06-01', extended_support_end: '2036-01-01' };
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', living]]));
    const later = (await versionsOf(runner, technology.id)).get('V20')!;
    assert.deepEqual([later.standard_support_end, later.extended_support_end], ['2032-06-01', '2034-01-01']);
  });
}

/** C4 review, finding 9: a SQL Server release added by the living catalog brings its CPE product. */
async function testReleaseProduct() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-sql');
    const { technology } = await catalog.adopt('mssqlserver', { manager: runner.manager, tenantId });
    const live = versionsOfReleases([{ name: '18.0', label: '2028', releaseDate: '2026-10-01', eolFrom: '2034-01-01' }], shippedDay(1), 'mssqlserver');
    const result = await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', mergeProduct(catalog.shippedProduct('mssqlserver')!, live)]]));
    assert.deepEqual([result.versions_added, result.cpe_added], [1, 1]);
    const [tech] = await runner.query(`SELECT cpe_products FROM technologies WHERE id = $1`, [technology.id]);
    assert.ok(tech.cpe_products.includes('a:microsoft:sql_server_2028'));
    assert.equal((await versionsOf(runner, technology.id)).get('2028')!.catalog_key, 'mssqlserver:18.0');
  });
}

/** An empty description the catalog never filled receives the catalog's, in the tenant's language, once. */
async function testDescriptionFilled() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const { catalog, sync } = syncService(audit);
    const tenantId = await seedTenant(runner, 'cat-sync-desc');
    await runner.query(`UPDATE tenants SET metadata = '{"language":"fr"}'::jsonb WHERE id = $1`, [tenantId]);
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId, language: 'en' });
    const shipped = catalog.shippedProduct('postgresql')!;
    const english = catalog.description('postgresql', 'en')!;
    const french = catalog.description('postgresql', 'fr')!;
    assert.ok(french && french !== english);
    const read = async () => (await runner.query(`SELECT description FROM technologies WHERE id = $1`, [technology.id]))[0].description;

    assert.equal(await read(), english, 'adopted in English');
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    assert.equal(await read(), english, 'a tenant language does not rewrite a description the catalog did not change');

    // Adopted before the catalog had descriptions: empty, no state.
    await runner.query(`UPDATE technologies SET description = '  ', catalog_state = NULL WHERE id = $1`, [technology.id]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    assert.equal(await read(), french, 'filled in the tenant language');
    assert.ok(audit.some((a) => (a.after as any)?.catalog_sync?.description_filled === true));
    const [{ catalog_state: state }] = await runner.query(`SELECT catalog_state FROM technologies WHERE id = $1`, [technology.id]);
    assert.equal(state.description, french, 'remembered');

    await runner.query(`UPDATE technologies SET description = 'Our main database' WHERE id = $1`, [technology.id]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    assert.equal(await read(), 'Our main database', 'a description changed since stays');
    await runner.query(`UPDATE technologies SET description = NULL WHERE id = $1`, [technology.id]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    assert.equal(await read(), null, 'a description the tenant emptied stays empty');

    await runner.query(`UPDATE technologies SET description = E'\\n', catalog_state = catalog_state - 'description' WHERE id = $1`, [technology.id]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    assert.equal(await read(), '\n', 'a line break is a description, so it is not filled');
  });
}

/** A tenant without a language of its own: the language most of its enabled users chose. */
async function testDescriptionInUsersLanguage() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-users');
    const role = (await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Catalog sync users') RETURNING id`, [tenantId]))[0].id;
    const users: Array<[string, string]> = [['fr', 'enabled'], ['fr', 'enabled'], ['en', 'enabled'], ['de', 'disabled'], ['de', 'disabled'], ['de', 'disabled']];
    for (const [index, [locale, status]] of users.entries()) {
      await runner.query(
        `INSERT INTO users (tenant_id, role_id, email, locale, status) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, role, `u${index}-${tenantId.slice(0, 8)}@example.invalid`, locale, status],
      );
    }
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId, language: 'en' });
    await runner.query(`UPDATE technologies SET description = NULL, catalog_state = NULL WHERE id = $1`, [technology.id]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', catalog.shippedProduct('postgresql')!]]));
    const [{ description }] = await runner.query(`SELECT description FROM technologies WHERE id = $1`, [technology.id]);
    assert.equal(description, catalog.description('postgresql', 'fr'), 'French, as most enabled users (disabled ones do not count)');
  });
}

/**
 * C5: an identifier the shipped catalog withdraws, still held (without case), is removed, audited
 * and matched again. One the tenant added stays. A second pass writes nothing.
 */
async function testShippedIdentifierWithdrawn() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const emitted: Array<{ technologyId: string; products: string[] }> = [];
    const { catalog, sync } = syncService(audit, { emit: async (event) => { emitted.push({ technologyId: event.technologyId, products: [...event.products] }); } });
    const tenantId = await seedTenant(runner, 'cat-sync-drop');
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
    const shipped = catalog.shippedProduct('postgresql')!;
    const dropped = shipped.cpe_products[0];
    await runner.query(`UPDATE technologies SET cpe_products = $2 WHERE id = $1`, [technology.id, ['A:PostgreSQL:PostgreSQL', 'a:tenant:own']]);
    const versionId = (await runner.query(`SELECT id FROM technology_versions WHERE technology_id = $1 AND label = '16'`, [technology.id]))[0].id;
    await installed(runner, tenantId, await asset(runner, tenantId, 'SRV-PG'), technology.id, versionId);
    const cveDropped = 'CVE-2099-45055';
    const cveKept = 'CVE-2099-45056';
    await runner.query(
      `INSERT INTO vulnerability_cves (cve_id, summary, severity, nvd_status) VALUES ($1, 'Dropped product', 'high', 'Analyzed'), ($2, 'Kept product', 'medium', 'Analyzed')`,
      [cveDropped, cveKept],
    );
    await runner.query(
      `INSERT INTO vulnerability_cve_matches (cve_id, product, criteria, vulnerable) VALUES ($1, $2, 'cpe:2.3:' || $2 || ':*', true), ($3, $4, 'cpe:2.3:' || $4 || ':*', true)`,
      [cveDropped, dropped, cveKept, 'a:tenant:own'],
    );
    const matcher = new VulnerabilityMatchService();
    assert.equal((await matcher.matchTenant(runner.manager, tenantId, technology.id)).added, 2, 'both products match the version in use');

    // PostgreSQL publishes one identifier: emptying the list is an intentional withdrawal, so the
    // stub says `noCpe`. An empty list without that mark withdraws nothing.
    const withdrawn = { ...withoutCpe(shipped, [dropped]), noCpe: 'The shipped entry withdraws its identifier.' as const };
    const restore = stubShipped(catalog, 'postgresql', withdrawn);
    try {
      await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withdrawn]]));
      const [tech] = await runner.query(`SELECT cpe_products, catalog_state FROM technologies WHERE id = $1`, [technology.id]);
      assert.deepEqual(tech.cpe_products, ['a:tenant:own'], 'the shipped identifier is removed, the one the tenant added stays');
      assert.deepEqual(tech.catalog_state.cpe_products, [], 'the state lists what is still offered');
      const row = audit.find((entry) => (entry.after as any)?.catalog_sync?.cpe_products_removed?.length);
      assert.deepEqual((row?.after as any).catalog_sync.cpe_products_removed, [dropped]);
      assert.equal((row as any)?.source, 'system');
      assert.equal((row as any)?.sourceRef, 'technology-catalog');
      assert.deepEqual(emitted, [{ technologyId: technology.id, products: [] }], 'matched again, with nothing new to collect');
      assert.equal((await matcher.matchTenant(runner.manager, tenantId, technology.id)).removed, 1, 'the row of the removed product disappears');
      const left = await runner.query(`SELECT cve_id FROM technology_vulnerabilities WHERE technology_id = $1`, [technology.id]);
      assert.deepEqual(left.map((r: { cve_id: string }) => r.cve_id), [cveKept]);

      const statements: string[] = [];
      const watched = { query: (sql: string, params?: unknown[]) => { statements.push(sql); return runner.manager.query(sql, params); } };
      const before = audit.length;
      await sync.syncTenant(watched as any, tenantId, new Map([['postgresql', withdrawn]]));
      assert.equal(audit.length, before, 'a second pass writes no audit');
      assert.ok(!statements.some((sql) => /UPDATE technologies|INSERT INTO technology_versions|UPDATE technology_versions/.test(sql)), 'a second pass writes nothing');
    } finally {
      restore();
    }
  });
}

/**
 * C5: an identifier the catalog wrote and the tenant still holds is withdrawn with the shipped
 * file, offered again later, and replaced. One the tenant removed stays out. One the tenant types
 * again after that removal is the tenant's: a later shipped withdrawal leaves it.
 */
async function testCpeRemovalRules() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const { catalog, sync } = syncService(audit);
    const tenantId = await seedTenant(runner, 'cat-sync-rules');
    const { technology: adopted } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
    const shipped = catalog.shippedProduct('postgresql')!;
    const dropped = shipped.cpe_products[0];
    const read = async () => (await runner.query(`SELECT cpe_products, catalog_state FROM technologies WHERE id = $1`, [adopted.id]))[0];
    const withdrawn = { ...withoutCpe(shipped, [dropped]), noCpe: 'The shipped entry withdraws its identifier.' as const };

    const restore = stubShipped(catalog, 'postgresql', withdrawn);
    try {
      await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withdrawn]]));
    } finally {
      restore();
    }
    let tech = await read();
    assert.deepEqual(tech.cpe_products, [], 'the shipped catalog withdrew the identifier it wrote');
    assert.ok(!tech.catalog_state.cpe_products.includes(dropped), 'it leaves the state');

    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    tech = await read();
    assert.deepEqual(tech.cpe_products, [dropped], 'offered again later, it comes back');
    assert.ok(tech.catalog_state.cpe_products.includes(dropped));
    assert.ok(tech.catalog_state.cpe_written.includes(dropped), 'coming back counts as written by the catalog');

    const replacement = 'a:postgresql:postgresql_server';
    const replaced = { ...shipped, cpe_products: [replacement] };
    const restoreReplaced = stubShipped(catalog, 'postgresql', replaced);
    try {
      const result = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', replaced]]));
      assert.deepEqual([result.cpe_added, result.cpe_removed], [1, 1]);
    } finally {
      restoreReplaced();
    }
    tech = await read();
    assert.deepEqual(tech.cpe_products, [replacement], 'a correction replaces the identifier');
    assert.deepEqual(tech.catalog_state.cpe_products, [replacement]);
    const row = [...audit].reverse().find((entry) => (entry.after as any)?.catalog_sync?.cpe_products_added?.length);
    assert.deepEqual((row?.after as any).catalog_sync.cpe_products_removed, [dropped]);
    assert.deepEqual((row?.after as any).catalog_sync.cpe_products_added, [replacement]);

    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    await runner.query(`UPDATE technologies SET cpe_products = '{}' WHERE id = $1`, [adopted.id]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    tech = await read();
    assert.deepEqual(tech.cpe_products, [], 'an identifier the tenant removed does not come back');
    assert.ok(tech.catalog_state.cpe_products.includes(dropped), 'it stays in the state while the catalog offers it');
    assert.ok(!tech.catalog_state.cpe_written.includes(dropped), 'a tenant removal leaves the written list');

    await runner.query(`UPDATE technologies SET cpe_products = $2 WHERE id = $1`, [adopted.id, [dropped]]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withoutCpe(shipped, [dropped])]]));
    tech = await read();
    assert.deepEqual(tech.cpe_products, [dropped], 'an endoflife.date answer without the identifier removes nothing');

    const restoreAgain = stubShipped(catalog, 'postgresql', withdrawn);
    try {
      await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withdrawn]]));
    } finally {
      restoreAgain();
    }
    tech = await read();
    assert.deepEqual(tech.cpe_products, [dropped], 'typed again by the tenant, a shipped withdrawal leaves it');
  });
}

/** C5 review P3: an identifier the tenant typed, then one held before adoption, is never withdrawn. */
async function testTenantTypedIdentifierIsNotWithdrawn() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-typed');
    const { technology: adopted } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
    const shipped = catalog.shippedProduct('postgresql')!;
    const own = 'a:kanapreview:pg_extension';
    await runner.query(`UPDATE technologies SET cpe_products = cpe_products || $2::text[] WHERE id = $1`, [adopted.id, [own]]);
    const offering = { ...shipped, cpe_products: [...shipped.cpe_products, own] };
    const restoreOffer = stubShipped(catalog, 'postgresql', offering);
    try {
      await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', offering]]));
    } finally {
      restoreOffer();
    }
    const [mid] = await runner.query(`SELECT cpe_products, catalog_state FROM technologies WHERE id = $1`, [adopted.id]);
    assert.ok(!mid.catalog_state.cpe_written.includes(own), 'an identifier the tenant already held is not a catalog write');
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    const [tech] = await runner.query(`SELECT cpe_products FROM technologies WHERE id = $1`, [adopted.id]);
    assert.ok(tech.cpe_products.includes(own), 'the shipped file dropping an identifier the tenant typed leaves it');
    assert.ok(tech.cpe_products.includes(shipped.cpe_products[0]), 'the identifier the catalog wrote stays while the file still lists it');
  });

  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-preheld');
    const shipped = catalog.shippedProduct('postgresql')!;
    const held = shipped.cpe_products[0];
    const id = await technology(runner, tenantId, 1, 'PostgreSQL', 'database');
    await runner.query(`UPDATE technologies SET cpe_products = $2 WHERE id = $1`, [id, [held, 'a:tenant:own']]);
    const adopted = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
    assert.equal(adopted.technology.id, id, 'adoption attaches the catalog to the technology of the same name');
    const [row] = await runner.query(`SELECT catalog_state FROM technologies WHERE id = $1`, [id]);
    assert.deepEqual(row.catalog_state.cpe_written, [], 'identifiers already held are not catalog writes');
    const withdrawn = { ...withoutCpe(shipped, [held]), noCpe: 'The shipped entry withdraws its identifier.' as const };
    const restore = stubShipped(catalog, 'postgresql', withdrawn);
    try {
      await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withdrawn]]));
    } finally {
      restore();
    }
    const [tech] = await runner.query(`SELECT cpe_products FROM technologies WHERE id = $1`, [id]);
    assert.ok(tech.cpe_products.includes(held), 'an identifier held before adoption is not withdrawn');
    assert.ok(tech.cpe_products.includes('a:tenant:own'), 'an identifier the tenant added stays');
  });
}

/**
 * C5: without a usable state, nothing is removed. The state written on that pass does not record
 * an identifier the shipped file no longer lists, so a later pass does not remove it either: a
 * missing state cannot tell it from an identifier the tenant added.
 */
async function testNoUsableStateRemovesNothing() {
  for (const raw of [null, '[]']) {
    await inRolledBackTransaction(async (runner) => {
      const { catalog, sync } = syncService();
      const tenantId = await seedTenant(runner, 'cat-sync-nostate');
      const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
      const shipped = catalog.shippedProduct('postgresql')!;
      const held = ['A:PostgreSQL:PostgreSQL', 'a:tenant:own'];
      await runner.query(`UPDATE technologies SET cpe_products = $2, catalog_state = $3::jsonb WHERE id = $1`, [technology.id, held, raw]);
      const withdrawn = withoutCpe(shipped, [shipped.cpe_products[0]]);
      const restore = stubShipped(catalog, 'postgresql', withdrawn);
      try {
        await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withdrawn]]));
        await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withdrawn]]));
      } finally {
        restore();
      }
      const [tech] = await runner.query(`SELECT cpe_products FROM technologies WHERE id = $1`, [technology.id]);
      assert.deepEqual(tech.cpe_products, held, `${raw === null ? 'no state' : raw}: nothing is removed`);
    });
  }
}

/**
 * C5 review P1 and P2: an identifier the cache added (a release product) stays when the cache is
 * missing or empty, and one the tenant then removed does not come back when the cache returns.
 */
async function testCacheIdentifierIsNotWithdrawnByAMissingCache() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const { catalog, sync } = syncService(audit);
    const tenantId = await seedTenant(runner, 'cat-sync-cache');
    const { technology } = await catalog.adopt('mssqlserver', { manager: runner.manager, tenantId });
    const shipped = catalog.shippedProduct('mssqlserver')!;
    const live = versionsOfReleases([{ name: '18.0', label: '2028', releaseDate: '2026-10-01', eolFrom: '2034-01-01' }], shippedDay(1), 'mssqlserver');
    const year = 'a:microsoft:sql_server_2028';
    const read = async () => (await runner.query(`SELECT cpe_products, catalog_state FROM technologies WHERE id = $1`, [technology.id]))[0];
    const holds = async () => (await read()).cpe_products.includes(year);
    const removed = () => audit.some((entry) => (entry.after as { catalog_sync?: { cpe_products_removed?: string[] } })?.catalog_sync?.cpe_products_removed?.includes(year));

    await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', mergeProduct(shipped, live)]]));
    assert.equal(await holds(), true, 'the cache adds the release identifier');
    assert.ok(!(await read()).catalog_state.shipped_cpe.includes(year), 'the shipped file did not list it');

    await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', mergeProduct(shipped, null)]]));
    assert.equal(await holds(), true, 'a missing cache removes nothing');
    assert.equal(removed(), false, 'the audit records no removal');
    assert.ok((await read()).catalog_state.cpe_products.includes(year), 'the identifier stays in the state');

    await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', mergeProduct(shipped, live)]]));
    await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', mergeProduct(shipped, [])]]));
    assert.equal(await holds(), true, 'an empty endoflife.date release list removes nothing');

    await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', mergeProduct(shipped, live)]]));
    await runner.query(`UPDATE technologies SET cpe_products = array_remove(cpe_products, $2) WHERE id = $1`, [technology.id, year]);
    await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', mergeProduct(shipped, live)]]));
    assert.equal(await holds(), false, 'an identifier the tenant removed stays out while the cache offers it');
    await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', mergeProduct(shipped, null)]]));
    await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', mergeProduct(shipped, live)]]));
    assert.equal(await holds(), false, 'a missing cache does not undo the tenant removal when the cache returns');
  });
}

/** C5 review B1: a readable state from before `shipped_cpe` withdraws nothing and records the shipped file. */
async function testStateWithoutShippedCpeRemovesNothing() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-c4');
    const { technology } = await catalog.adopt('mssqlserver', { manager: runner.manager, tenantId });
    const shipped = catalog.shippedProduct('mssqlserver')!;
    const dropped = shipped.cpe_products[0];
    const [{ catalog_state: state }] = await runner.query(`SELECT catalog_state FROM technologies WHERE id = $1`, [technology.id]);
    delete state.shipped_cpe;
    await runner.query(`UPDATE technologies SET catalog_state = $2::jsonb WHERE id = $1`, [technology.id, JSON.stringify(state)]);
    const withdrawn = withoutCpe(shipped, [dropped]);
    const restore = stubShipped(catalog, 'mssqlserver', withdrawn);
    try {
      await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', withdrawn]]));
      let [tech] = await runner.query(`SELECT cpe_products, catalog_state FROM technologies WHERE id = $1`, [technology.id]);
      assert.ok(tech.cpe_products.includes(dropped), 'a state without shipped_cpe withdraws nothing');
      assert.deepEqual(tech.catalog_state.shipped_cpe, [...withdrawn.cpe_products].sort(), 'the pass records the shipped file as it is now');
      await sync.syncTenant(runner.manager, tenantId, new Map([['mssqlserver', withdrawn]]));
      [tech] = await runner.query(`SELECT cpe_products FROM technologies WHERE id = $1`, [technology.id]);
      assert.ok(tech.cpe_products.includes(dropped), 'the following pass does not withdraw it either');
    } finally {
      restore();
    }
  });
}

/** C5 review B1: a shipped file that loses every identifier, and is not marked `noCpe`, withdraws nothing. */
async function testEmptyShippedFileWithdrawsNothing() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const warnings: string[] = [];
    const logger = (sync as unknown as { logger: { warn: (message: string) => void } }).logger;
    const warn = logger.warn.bind(logger);
    logger.warn = (message: string) => { warnings.push(message); warn(message); };
    const tenantId = await seedTenant(runner, 'cat-sync-empty');
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
    const shipped = catalog.shippedProduct('postgresql')!;
    const read = async () => (await runner.query(`SELECT cpe_products, catalog_state FROM technologies WHERE id = $1`, [technology.id]))[0];
    const before = (await read()).catalog_state.shipped_cpe;

    const emptied = { ...shipped, cpe_products: [] as string[] };
    const restore = stubShipped(catalog, 'postgresql', emptied);
    try {
      await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', emptied]]));
      const tech = await read();
      assert.deepEqual(tech.cpe_products, shipped.cpe_products, 'an emptied shipped file withdraws nothing');
      assert.deepEqual(tech.catalog_state.shipped_cpe, before, 'the previous shipped identifiers stay recorded');
      assert.ok(warnings.some((line) => line.includes('postgresql') && line.includes('noCpe')), 'the pass logs it');
    } finally {
      restore();
    }

    const marked = { ...emptied, noCpe: 'The entry no longer has a CPE identifier.' as const };
    const restoreMarked = stubShipped(catalog, 'postgresql', marked);
    try {
      await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', marked]]));
      const tech = await read();
      assert.deepEqual(tech.cpe_products, [], 'an entry marked noCpe withdraws the identifiers it listed');
      assert.deepEqual(tech.catalog_state.shipped_cpe, [], 'the empty shipped file is recorded once it is explicit');
    } finally {
      restoreMarked();
    }
  });
}

/**
 * A key the shipped file no longer lists is not a withdrawal. The living product does not
 * stand in for the file: identifiers stay, `shipped_cpe` stays, and versions still follow.
 */
async function testMissingShippedProductWithdrawsNothing() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-noship');
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
    const shipped = catalog.shippedProduct('postgresql')!;
    const [{ catalog_state: before }] = await runner.query(`SELECT catalog_state FROM technologies WHERE id = $1`, [technology.id]);
    const living = livingPostgres(shipped);
    living.cpe_products = [];
    const restore = stubShipped(catalog, 'postgresql', undefined);
    try {
      const result = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', living]]));
      assert.equal(result.cpe_removed, 0);
      const [tech] = await runner.query(`SELECT cpe_products, catalog_state FROM technologies WHERE id = $1`, [technology.id]);
      assert.deepEqual(tech.cpe_products, shipped.cpe_products, 'a missing shipped entry withdraws nothing');
      assert.deepEqual(tech.catalog_state.shipped_cpe, before.shipped_cpe, 'shipped_cpe is not taken from the living product');
      const versions = await versionsOf(runner, technology.id);
      const moved = living.versions.find((version) => version.key === '18')!;
      assert.equal(versions.get('18')!.standard_support_end, moved.standard_support_end, 'versions still follow the living product');
    } finally {
      restore();
    }
  });
}

/**
 * C5 review P4: a description follows the catalog in the language it was written in.
 * An English adoption on a French tenant stays English the next night. Without
 * `description_language`, the language whose catalog text equals the remembered description
 * is recorded, and nothing is rewritten when none equals it.
 */
async function testDescriptionLanguageStays() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const { catalog, sync } = syncService(audit);
    const tenantId = await seedTenant(runner, 'cat-sync-lang');
    await runner.query(`UPDATE tenants SET metadata = '{"language":"fr"}'::jsonb WHERE id = $1`, [tenantId]);
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId, language: 'en' });
    const english = catalog.description('postgresql', 'en')!;
    const french = catalog.description('postgresql', 'fr')!;
    assert.notEqual(english, french);
    const shipped = catalog.shippedProduct('postgresql')!;
    const read = async () => (await runner.query(`SELECT description, catalog_state FROM technologies WHERE id = $1`, [technology.id]))[0];

    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    let row = await read();
    assert.equal(row.description, english, 'adopted in English on a French tenant: the next night leaves it');
    assert.equal(row.catalog_state.description_language, 'en');
    assert.equal(row.catalog_state.description, english);
    assert.equal(audit.filter((entry) => (entry.after as any)?.catalog_sync?.description_updated === true).length, 0);

    await runner.query(`UPDATE technologies SET catalog_state = catalog_state - 'description_language' WHERE id = $1`, [technology.id]);
    const originalText = catalog.textIn.bind(catalog);
    const texts: Partial<Record<CatalogLanguage, string>> = {};
    catalog.textIn = (key: string, language: CatalogLanguage) => (key === 'postgresql' && texts[language] !== undefined ? texts[language]! : originalText(key, language));
    texts.fr = 'Texte français révisé.';
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    row = await read();
    assert.equal(row.description, english, 'a French revision does not rewrite an English description');
    assert.equal(row.catalog_state.description_language, 'en', 'the language is the one whose catalog text equals the remembered description');
    assert.equal(row.catalog_state.description, english);

    texts.en = 'A revised English description.';
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    row = await read();
    assert.equal(row.description, texts.en, 'the catalog text in the recorded language replaces it');
    assert.equal(row.catalog_state.description, texts.en);
    assert.equal(row.catalog_state.description_language, 'en');

    await runner.query(
      `UPDATE technologies SET description = 'Hand written', catalog_state = jsonb_set(catalog_state, '{description}', '"Hand written"') - 'description_language' WHERE id = $1`,
      [technology.id],
    );
    texts.en = 'Brand new English.';
    texts.fr = 'Texte français encore révisé.';
    const before = audit.length;
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    row = await read();
    assert.equal(row.description, 'Hand written', 'a remembered text that equals no catalog language stays');
    assert.equal(row.catalog_state.description, 'Hand written');
    assert.equal(row.catalog_state.description_language ?? null, null);
    assert.equal(audit.length, before, 'nothing is audited when the description stays');
  });
}

/** C5 review P5: a trailing line break is the tenant's text. Nothing follows, and the state stays. */
async function testDescriptionNewlineStays() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const { catalog, sync } = syncService(audit);
    const tenantId = await seedTenant(runner, 'cat-sync-nl');
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId, language: 'en' });
    const original = catalog.description.bind(catalog);
    const originalText = catalog.textIn.bind(catalog);
    const english = original('postgresql', 'en')!;
    let next: string | null = english;
    catalog.description = (key: string, language: CatalogLanguage) => (key === 'postgresql' ? next : original(key, language));
    catalog.textIn = (key: string, language: CatalogLanguage) => (key === 'postgresql' ? next : originalText(key, language));
    await runner.query(`UPDATE technologies SET description = $2 WHERE id = $1`, [technology.id, `${english}\n`]);
    next = 'A revised catalog description.';
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', catalog.shippedProduct('postgresql')!]]));
    const [tech] = await runner.query(`SELECT description, catalog_state FROM technologies WHERE id = $1`, [technology.id]);
    assert.equal(tech.description, `${english}\n`, 'a trailing line break keeps the description');
    assert.equal(tech.catalog_state.description, english, 'the state keeps the text the catalog wrote');
    assert.equal(audit.filter((entry) => (entry.after as any)?.catalog_sync?.description_updated === true).length, 0);
  });
}

/** C5: a description the tenant left unchanged follows the catalog; one the tenant changed stays. */
async function testDescriptionFollows() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const { catalog, sync } = syncService(audit);
    const tenantId = await seedTenant(runner, 'cat-sync-follow');
    const { technology } = await catalog.adopt('postgresql', { manager: runner.manager, tenantId, language: 'en' });
    const original = catalog.description.bind(catalog);
    const originalText = catalog.textIn.bind(catalog);
    const english = original('postgresql', 'en')!;
    let next: string | null = english;
    // The follow reads `textIn` (that language only). Stub both, or the English fallback of
    // `description` would hide a missing translation.
    const revised = (key: string, language: CatalogLanguage) => (key === 'postgresql' ? next : original(key, language));
    catalog.description = revised;
    catalog.textIn = (key: string, language: CatalogLanguage) => (key === 'postgresql' ? next : originalText(key, language));
    const shipped = catalog.shippedProduct('postgresql')!;
    const read = async () => (await runner.query(`SELECT description, catalog_state FROM technologies WHERE id = $1`, [technology.id]))[0];

    await runner.query(`UPDATE technologies SET description = $2 WHERE id = $1`, [technology.id, `  ${english}  `]);
    next = 'A revised catalog description.';
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    let row = await read();
    assert.equal(row.description, `  ${english}  `, 'a space the tenant added keeps the description');
    assert.equal(row.catalog_state.description, english, 'the state keeps the text the catalog wrote');
    assert.equal(audit.filter((entry) => (entry.after as any)?.catalog_sync?.description_updated === true).length, 0);

    await runner.query(`UPDATE technologies SET description = $2 WHERE id = $1`, [technology.id, english]);
    const followed = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    assert.equal(followed.descriptions_updated, 1, 'the summary counts a description the catalog replaced');
    row = await read();
    assert.equal(row.description, next, 'the same text follows the catalog');
    assert.equal(row.catalog_state.description, next);
    assert.equal(audit.filter((entry) => (entry.after as any)?.catalog_sync?.description_updated === true).length, 1);

    const statements: string[] = [];
    const watched = { query: (sql: string, params?: unknown[]) => { statements.push(sql); return runner.manager.query(sql, params); } };
    const before = audit.length;
    await sync.syncTenant(watched as any, tenantId, new Map([['postgresql', shipped]]));
    assert.equal(audit.length, before, 'a second pass writes no audit');
    assert.ok(!statements.some((sql) => /UPDATE technologies|INSERT INTO technology_versions|UPDATE technology_versions/.test(sql)), 'a second pass writes nothing');

    await runner.query(`UPDATE technologies SET description = 'Kept by the tenant' WHERE id = $1`, [technology.id]);
    next = 'Another catalog revision.';
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    row = await read();
    assert.equal(row.description, 'Kept by the tenant', 'a description the tenant changed stays');
    assert.equal(row.catalog_state.description, 'A revised catalog description.');

    await runner.query(`UPDATE technologies SET description = $2 WHERE id = $1`, [technology.id, row.catalog_state.description]);
    next = null;
    await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', shipped]]));
    row = await read();
    assert.equal(row.description, 'A revised catalog description.', 'a description the catalog withdraws leaves the text');
  });
}

/** C5: of two tenants, the one that changed the description keeps it; the other follows the catalog. */
async function testTwoTenantsOneFollows() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const original = catalog.description.bind(catalog);
    const originalText = catalog.textIn.bind(catalog);
    let next: string | null = original('postgresql', 'en');
    catalog.description = (key: string, language: CatalogLanguage) => (key === 'postgresql' ? next : original(key, language));
    catalog.textIn = (key: string, language: CatalogLanguage) => (key === 'postgresql' ? next : originalText(key, language));
    const left = await seedTenant(runner, 'cat-sync-left');
    const right = await seedTenant(runner, 'cat-sync-right');
    const adopted = async (tenantId: string) => {
      await setTenant(runner, tenantId);
      return (await catalog.adopt('postgresql', { manager: runner.manager, tenantId, language: 'en' })).technology.id;
    };
    const a = await adopted(left);
    const b = await adopted(right);
    await setTenant(runner, left);
    await runner.query(`UPDATE technologies SET description = 'Ours' WHERE id = $1`, [a]);
    next = 'Shared catalog text.';
    const shipped = catalog.shippedProduct('postgresql')!;
    await sync.syncTenant(runner.manager, left, new Map([['postgresql', shipped]]));
    await setTenant(runner, right);
    await sync.syncTenant(runner.manager, right, new Map([['postgresql', shipped]]));
    await setTenant(runner, left);
    const [leftRow] = await runner.query(`SELECT description FROM technologies WHERE id = $1`, [a]);
    await setTenant(runner, right);
    const [rightRow] = await runner.query(`SELECT description FROM technologies WHERE id = $1`, [b]);
    assert.equal(leftRow.description, 'Ours', 'the tenant that changed the description keeps it');
    assert.equal(rightRow.description, 'Shared catalog text.', 'the other tenant follows the catalog');
  });
}

// --- The scheduled run against a fake endoflife.date -------------------------------------------

type Answer = { status: number; body?: unknown };
let answer: (slug: string) => Answer = () => ({ status: 404 });
const requests: string[] = [];
let baseUrl = '';
let clock = Date.parse(`${shippedDay(1)}T04:40:00.000Z`);
const sleeps: number[] = [];

async function serve() {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const match = /^\/api\/v1\/products\/([a-z0-9._-]+)$/.exec(req.url ?? '');
    const slug = match?.[1] ?? '';
    requests.push(slug);
    const a = answer(slug);
    res.writeHead(a.status, { 'Content-Type': a.status === 200 ? 'application/json' : 'text/html' });
    res.end(a.status === 200 ? JSON.stringify(a.body) : '<html>error</html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1` };
}

function runtime(): CatalogRuntime {
  return {
    baseUrl, fetch: (input, init) => fetch(input, init),
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock, spacingMs: 1000, retryDelayMs: 30_000,
  };
}

class SpecSync extends TechnologyCatalogSyncService {
  tenants: string[] = [];
  protected async tenantIds() { return this.tenants; }
}

function postgresReleases() {
  return {
    schema_version: '1.2.0',
    result: {
      name: 'postgresql',
      releases: [
        { name: '19', label: '19', releaseDate: '2026-09-30', eolFrom: '2031-11-13' },
        { name: '18', label: '18', releaseDate: '2025-09-25', eolFrom: '2031-01-31' },
        { name: '17', label: '17', releaseDate: '2024-09-26', eolFrom: '2029-11-08' },
      ],
    },
  };
}

async function cleanCache() {
  await dataSource.query(`DELETE FROM technology_catalog_products WHERE catalog_key = ANY($1::text[])`, [KEYS]);
}

async function withCommittedTenant(fn: (tenantId: string, technologyIds: Record<string, string>) => Promise<void>) {
  const [tenant] = await dataSource.query(
    `INSERT INTO tenants (slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ('catalog-sync-spec-' || substr(md5(random()::text), 1, 8), 'Catalog sync spec', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())
     RETURNING id`,
  );
  try {
    const { catalog } = syncService();
    const ids: Record<string, string> = {};
    await withTenant(dataSource, tenant.id, async (mg) => {
      for (const key of KEYS) ids[key] = (await catalog.adopt(key, { manager: mg, tenantId: tenant.id })).technology.id;
    });
    await fn(tenant.id, ids);
  } finally {
    await withTenant(dataSource, tenant.id, (mg) => mg.query(`DELETE FROM technologies WHERE tenant_id = $1`, [tenant.id]));
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
}

async function testRunRefreshesThenSyncs() {
  const enabled = Features.TECHNOLOGY_CATALOG_SYNC_ENABLED;
  (Features as any).TECHNOLOGY_CATALOG_SYNC_ENABLED = true;
  try {
    await withCommittedTenant(async (tenantId, ids) => {
      const { catalog } = syncService();
      const sync = new SpecSync(dataSource, { register: () => undefined } as any, catalog, { log: async () => undefined } as any);
      sync.tenants = [tenantId];
      requests.length = 0;
      sleeps.length = 0;
      answer = (slug) => (slug === 'postgresql' ? { status: 200, body: postgresReleases() } : { status: 503 });
      await assert.rejects(sync.run(runtime()), /Partial failure, 1 error\(s\): nginx: endoflife.date answered HTTP 503/,
        'a product that failed makes the run a visible partial failure, once everything else is done');
      assert.deepEqual(requests, ['nginx', 'nginx', 'nginx', 'postgresql'], 'a failure of the service is tried three times, then the next product');
      assert.deepEqual(sleeps, [30_000, 60_000, 1000], 'retries wait 30 s then 60 s, then one request a second');
      const cache = await dataSource.query(
        `SELECT catalog_key, jsonb_array_length(versions) AS n, last_success_at IS NOT NULL AS ok, last_error FROM technology_catalog_products
          WHERE catalog_key = ANY($1::text[]) ORDER BY catalog_key`,
        [KEYS],
      );
      assert.deepEqual(cache.map((c: any) => [c.catalog_key, c.n, c.ok, !!c.last_error]), [['nginx', 0, false, true], ['postgresql', 3, true, false]]);
      const versions = await withTenant(dataSource, tenantId, (mg) => mg.query(
        `SELECT label, to_char(standard_support_end, 'YYYY-MM-DD') AS d, catalog_key FROM technology_versions WHERE technology_id = $1 AND label IN ('19', '18')`,
        [ids.postgresql],
      ));
      assert.deepEqual(versions.sort((a: any, b: any) => a.label.localeCompare(b.label)), [
        { label: '18', d: '2031-01-31', catalog_key: 'postgresql:18' },
        { label: '19', d: '2031-11-13', catalog_key: 'postgresql:19' },
      ], 'the version published since is added and the new date followed, right after the refresh');

      // The next run, two hours later: PostgreSQL is fresh, nginx is tried again first.
      requests.length = 0;
      clock += 2 * HOUR;
      answer = () => ({ status: 404 });
      await assert.rejects(sync.run(runtime()), /No product could be read/, 'a run where every product read failed is recorded as failed');
      assert.deepEqual(requests, ['nginx'], 'a product read less than 20 hours ago is not read again; a 404 is not retried');
      requests.length = 0;
      answer = () => ({ status: 404 });
      clock += 21 * HOUR;
      await assert.rejects(sync.run(runtime()), /No product could be read/, 'a run where every product failed is recorded as failed');
      assert.deepEqual(requests.sort(), ['nginx', 'postgresql']);
      const [kept] = await dataSource.query(`SELECT jsonb_array_length(versions) AS n FROM technology_catalog_products WHERE catalog_key = 'postgresql'`);
      assert.equal(kept.n, 3, 'a failed read keeps the last versions');
    });
  } finally {
    (Features as any).TECHNOLOGY_CATALOG_SYNC_ENABLED = enabled;
  }
}

async function testGateOff() {
  const enabled = Features.TECHNOLOGY_CATALOG_SYNC_ENABLED;
  (Features as any).TECHNOLOGY_CATALOG_SYNC_ENABLED = false;
  try {
    await cleanCache();
    await withCommittedTenant(async (tenantId, ids) => {
      const { catalog } = syncService();
      const sync = new SpecSync(dataSource, { register: () => undefined } as any, catalog, { log: async () => undefined } as any);
      sync.tenants = [tenantId];
      requests.length = 0;
      await withTenant(dataSource, tenantId, (mg) => mg.query(`UPDATE technologies SET catalog_state = NULL WHERE tenant_id = $1`, [tenantId]));
      const summary = await sync.run({ ...runtime(), fetch: async () => { throw new Error('no request leaves with the gate off'); } });
      assert.deepEqual([requests.length, summary.requests, summary.refresh_enabled, summary.tenants_synced, summary.cpe_removed, summary.descriptions_updated], [0, 0, false, 1, 0, 0]);
      const [row] = await withTenant(dataSource, tenantId, (mg) => mg.query(`SELECT catalog_state FROM technologies WHERE id = $1`, [ids.postgresql]));
      assert.ok(row.catalog_state?.versions?.['18'], 'the shipped catalog is still synced');
    });
  } finally {
    (Features as any).TECHNOLOGY_CATALOG_SYNC_ENABLED = enabled;
  }
}

/** C4 review, finding 1 (S1, S2) and 5: unusable values never reach the cache, nor block anything. */
async function testUnusableAnswers() {
  const enabled = Features.TECHNOLOGY_CATALOG_SYNC_ENABLED;
  (Features as any).TECHNOLOGY_CATALOG_SYNC_ENABLED = true;
  try {
    await cleanCache();
    await withCommittedTenant(async (tenantId, ids) => {
      const { catalog } = syncService();
      const sync = new SpecSync(dataSource, { register: () => undefined } as any, catalog, { log: async () => undefined } as any);
      sync.tenants = [tenantId];
      clock += 48 * HOUR;
      answer = (slug) => ({
        status: 200,
        body: slug === 'postgresql'
          ? { result: { releases: [
            { name: '99', label: '99', releaseDate: '2026-10-01', eolFrom: '2031-11-13' },
            { name: '98', label: '98', releaseDate: '2026-09-01', eolFrom: '2031-02-30' },
            { name: ' ', releaseDate: '2026-08-01', eolFrom: '2031-01-01' },
          ] } }
          : { result: { releases: [{ name: '1.99', label: '1.99', releaseDate: '2026-10-01', eolFrom: '2028-01-01' }] } },
      });
      const summary = await sync.run(runtime());
      assert.deepEqual([summary.refreshed, summary.rejected_releases, summary.errors], [2, 2, []]);
      const [cached] = await dataSource.query(`SELECT versions FROM technology_catalog_products WHERE catalog_key = 'postgresql'`);
      assert.deepEqual(cached.versions.map((x: any) => x.key), ['99'], 'an impossible date or a blank name never reaches the cache');
      const labels = await withTenant(dataSource, tenantId, (mg) => mg.query(
        `SELECT technology_id, label FROM technology_versions WHERE technology_id = ANY($1::uuid[]) AND label IN ('99', '98', '1.99')`,
        [[ids.postgresql, ids.nginx]],
      ));
      assert.deepEqual(labels.map((r: any) => r.label).sort(), ['1.99', '99'], 'both products are synced');

      // A cache row written by hand (or an older KANAP) with a value the database refuses.
      await dataSource.query(
        `UPDATE technology_catalog_products SET versions = versions || $1::jsonb WHERE catalog_key = 'postgresql'`,
        [JSON.stringify([{ key: '97', label: '97', cpe_version: null, build_prefixes: [], release_date: '2026-01-01', standard_support_end: '2031-02-30', extended_support_end: null }])],
      );
      // The adoption reads the cache against the real clock: the sync ran on the spec's clock.
      const [{ last_success_at: syncedAt }] = await dataSource.query(`SELECT last_success_at FROM technology_catalog_products WHERE catalog_key = 'postgresql'`);
      await dataSource.query(`UPDATE technology_catalog_products SET last_success_at = now() WHERE catalog_key = 'postgresql'`);
      const [other] = await dataSource.query(
        `INSERT INTO tenants (slug, name, status, metadata, branding, created_at, updated_at)
         VALUES ('catalog-sync-spec-' || substr(md5(random()::text), 1, 8), 'Catalog sync spec', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())
         RETURNING id`,
      );
      // An adoption reads the cache at the real time, and the cache was read at the spec's clock:
      // the adoption takes that clock too, or the row is a week old once the real date moves on.
      const read = catalog.effectiveProducts.bind(catalog);
      catalog.effectiveProducts = (manager, keys, opts = {}) => read(manager, keys, { now: clock, ...opts });
      try {
        const adopted = await withTenant(dataSource, other.id, (mg) => catalog.adopt('postgresql', { manager: mg, tenantId: other.id }));
        assert.equal(adopted.created, true, 'the adoption never fails because of the cache');
        const keys = await withTenant(dataSource, other.id, (mg) => mg.query(`SELECT label FROM technology_versions WHERE technology_id = $1 AND label IN ('99', '97')`, [adopted.technology.id]));
        assert.deepEqual(keys.map((r: any) => r.label), ['99']);
      } finally {
        await withTenant(dataSource, other.id, (mg) => mg.query(`DELETE FROM technologies WHERE tenant_id = $1`, [other.id]));
        await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [other.id]);
        await dataSource.query(`UPDATE technology_catalog_products SET last_success_at = $1 WHERE catalog_key = 'postgresql'`, [syncedAt]);
      }

      // An answer over 1 MB is refused, not retried, and the run says so.
      requests.length = 0;
      clock += 48 * HOUR;
      answer = (slug) => (slug === 'nginx'
        ? { status: 200, body: { result: { releases: [], padding: 'x'.repeat(1_100_000) } } }
        : { status: 200, body: postgresReleases() });
      await assert.rejects(sync.run(runtime()), /nginx: endoflife.date answered more than 1048576 bytes/);
      assert.deepEqual(requests.sort(), ['nginx', 'postgresql']);
    });
  } finally {
    (Features as any).TECHNOLOGY_CATALOG_SYNC_ENABLED = enabled;
    await cleanCache();
  }
}

/** A product whose values the database refuses holds back its own technology only. */
async function testOneProductFails() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-sync-fail');
    const pg = (await catalog.adopt('postgresql', { manager: runner.manager, tenantId })).technology.id;
    const ngx = (await catalog.adopt('nginx', { manager: runner.manager, tenantId })).technology.id;
    const postgres = catalog.shippedProduct('postgresql')!;
    const nginx = catalog.shippedProduct('nginx')!;
    const bad: CatalogVersion = { key: '99', label: 'x'.repeat(150), cpe_version: null, build_prefixes: [], release_date: '2026-10-01', standard_support_end: null, extended_support_end: null };
    const good: CatalogVersion = { key: '1.99', label: '1.99', cpe_version: null, build_prefixes: [], release_date: '2026-10-01', standard_support_end: '2028-01-01', extended_support_end: null };
    const result = await sync.syncTenant(runner.manager, tenantId, new Map([
      ['postgresql', { ...postgres, versions: [bad, ...postgres.versions] }],
      ['nginx', { ...nginx, versions: [good, ...nginx.versions] }],
    ]));
    assert.equal(result.versions_added, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^postgresql: /);
    assert.ok((await versionsOf(runner, ngx)).has('1.99'), 'the other product is synced');
    assert.equal((await versionsOf(runner, pg)).size, postgres.versions.length, 'the failing one is left as it was');
  });
}

/** C4 review, finding 3 (scenario C): the shipped file wins over a stale cache, and with the gate off. */
async function testStaleCache() {
  const enabled = Features.TECHNOLOGY_CATALOG_SYNC_ENABLED;
  try {
    await inRolledBackTransaction(async (runner) => {
      const { catalog } = syncService();
      const shipped = catalog.shippedProduct('postgresql')!;
      const cached = [
        { key: '99', label: '99', cpe_version: null, build_prefixes: [], release_date: '2026-10-01', standard_support_end: '2031-11-13', extended_support_end: null },
        { ...shipped.versions.find((x) => x.key === '17')!, standard_support_end: '2027-01-01' },
      ];
      const at = async (lastSuccess: string, now: string, gate = true) => {
        (Features as any).TECHNOLOGY_CATALOG_SYNC_ENABLED = gate;
        await runner.query(
          `INSERT INTO technology_catalog_products (catalog_key, versions, last_success_at, last_attempt_at) VALUES ('postgresql', $1::jsonb, $2, $2)
           ON CONFLICT (catalog_key) DO UPDATE SET versions = EXCLUDED.versions, last_success_at = EXCLUDED.last_success_at`,
          [JSON.stringify(cached), lastSuccess],
        );
        const product = (await catalog.effectiveProducts(runner.manager, ['postgresql'], { now: Date.parse(now) })).get('postgresql')!;
        return [product.versions.some((x) => x.key === '99'), product.versions.find((x) => x.key === '17')!.standard_support_end];
      };
      const own = shipped.versions.find((x) => x.key === '17')!.standard_support_end;
      assert.deepEqual(await at(`${shippedDay(1)}T10:00:00Z`, `${shippedDay(2)}T00:00:00Z`), [true, '2027-01-01'], 'a cache read after the shipped file counts');
      assert.deepEqual(await at(`${shippedDay(-1)}T10:00:00Z`, `${shippedDay(0)}T00:00:00Z`), [false, own], 'a shipped file built after the last read wins');
      assert.deepEqual(await at(`${shippedDay(1)}T10:00:00Z`, `${shippedDay(14)}T00:00:00Z`), [false, own], 'a product not read for a week falls back to the shipped file');
      assert.deepEqual(await at(`${shippedDay(1)}T10:00:00Z`, `${shippedDay(2)}T00:00:00Z`, false), [false, own], 'gate off: the shipped file only');
    });
  } finally {
    (Features as any).TECHNOLOGY_CATALOG_SYNC_ENABLED = enabled;
  }
}

/**
 * CVE.org names follow the CPE rules. A new technology receives the catalog's names. A technology
 * of the same name keeps a name it already holds (its own text) and gains the others. The sync
 * adds a name the catalog gains, leaves a name the tenant removed, removes a name only when the
 * catalog wrote it and the shipped file dropped it, and removes nothing from a state without the
 * name keys. An empty name list does withdraw.
 */
async function testCveNames() {
  await inRolledBackTransaction(async (runner) => {
    const audit: AuditEntry[] = [];
    const emitted: Array<{ technologyId: string; products: string[] }> = [];
    const { catalog, sync } = syncService(audit, { emit: async (event) => { emitted.push({ technologyId: event.technologyId, products: [...event.products] }); } });
    const entry = catalog.shippedProduct('postgresql')!;
    const previous = entry.cve_names;
    const alpha = { vendor: 'PostgreSQL', product: 'PostgreSQL', version: null as string | null };
    const beta = { vendor: 'PostgreSQL', product: 'PostgreSQL Global Development Group', version: null as string | null };
    const gamma = { vendor: 'PostgreSQL', product: 'libpq', version: '16' };
    entry.cve_names = [beta, alpha];
    const read = async (id: string) => (await runner.query(`SELECT cve_names, catalog_state FROM technologies WHERE id = $1`, [id]))[0];
    try {
      const tenantId = await seedTenant(runner, 'cat-cve-names');
      const created = await catalog.adopt('postgresql', { manager: runner.manager, tenantId });
      let row = await read(created.technology.id);
      assert.deepEqual(row.cve_names, [alpha, beta], 'a new technology receives the names, sorted');
      assert.deepEqual(row.catalog_state.cve_names, [alpha, beta]);
      assert.deepEqual(row.catalog_state.shipped_cve_names, [alpha, beta]);
      assert.deepEqual(row.catalog_state.cve_names_written, [alpha, beta]);
      assert.equal((await catalog.adopt('postgresql', { manager: runner.manager, tenantId })).created, false, 'adopting again adds nothing');

      const other = await seedTenant(runner, 'cat-cve-names-held');
      const heldId = await technology(runner, other, 4, 'PostgreSQL');
      await runner.query(`UPDATE technologies SET cve_names = $2::jsonb WHERE tenant_id = $1 AND id = $3`, [other, JSON.stringify([
        { vendor: 'postgresql', product: 'POSTGRESQL', version: null },
        { vendor: 'Tenant', product: 'Own', version: null },
      ]), heldId]);
      const linked = await catalog.adopt('postgresql', { manager: runner.manager, tenantId: other });
      assert.equal(linked.created, false);
      assert.equal(linked.technology.id, heldId);
      row = await read(heldId);
      assert.deepEqual(row.cve_names, [
        { vendor: 'postgresql', product: 'POSTGRESQL', version: null },
        beta,
        { vendor: 'Tenant', product: 'Own', version: null },
      ], 'a name already held stays, with its text');
      assert.deepEqual(row.catalog_state.cve_names_written, [beta], 'only the name this adoption added counts as written');

      await setTenant(runner, tenantId);
      const id = created.technology.id;
      const gained = { ...entry, cve_names: [alpha, beta, gamma] };
      const added = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', gained]]));
      assert.deepEqual([added.cve_names_added, added.cve_names_removed], [1, 0]);
      row = await read(id);
      assert.deepEqual(row.cve_names, [gamma, alpha, beta], 'a name the catalog gains is added');
      assert.deepEqual(emitted, [{ technologyId: id, products: [] }], 'a name change is matched again, with nothing new to collect');
      const synced = audit.filter((item) => item.recordId === id && (item.after as { catalog_sync?: { cve_names_added?: unknown } }).catalog_sync?.cve_names_added);
      assert.deepEqual((synced.at(-1)?.after as { catalog_sync: { cve_names_added: unknown } }).catalog_sync.cve_names_added, [gamma]);

      await runner.query(`UPDATE technologies SET cve_names = $2::jsonb WHERE id = $1`, [id, JSON.stringify([gamma, alpha])]);
      emitted.length = 0;
      const kept = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', gained]]));
      assert.deepEqual([kept.cve_names_added, kept.cve_names_removed], [0, 0]);
      row = await read(id);
      assert.deepEqual(row.cve_names, [gamma, alpha], 'a name the tenant removed stays removed');
      assert.ok(row.catalog_state.cve_names.some((item: { product: string }) => item.product === beta.product), 'it stays offered');
      assert.deepEqual(emitted, [], 'nothing changed, so nothing is matched again');

      const dropped = { ...entry, cve_names: [beta] };
      const restoreDropped = stubShipped(catalog, 'postgresql', dropped);
      try {
        emitted.length = 0;
        const withdrawn = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', dropped]]));
        assert.equal(withdrawn.cve_names_removed, 1);
        row = await read(id);
        assert.deepEqual(row.cve_names, [gamma], 'a name the catalog wrote is removed when the shipped file drops it');
        assert.deepEqual(emitted, [{ technologyId: id, products: [] }]);
      } finally {
        restoreDropped();
      }

      await runner.query(`UPDATE technologies SET cve_names = $2::jsonb WHERE id = $1`, [id, JSON.stringify([gamma, alpha])]);
      row = await read(id);
      delete row.catalog_state.shipped_cve_names;
      delete row.catalog_state.cve_names_written;
      await runner.query(`UPDATE technologies SET catalog_state = $2::jsonb WHERE id = $1`, [id, JSON.stringify(row.catalog_state)]);
      const withoutAlpha = { ...entry, cve_names: [beta] };
      const restoreBare = stubShipped(catalog, 'postgresql', withoutAlpha);
      try {
        const bare = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', withoutAlpha]]));
        assert.equal(bare.cve_names_removed, 0);
        row = await read(id);
        assert.deepEqual(row.cve_names, [gamma, alpha], 'a state without the name keys removes nothing');
        assert.deepEqual(row.catalog_state.shipped_cve_names, [beta]);
      } finally {
        restoreBare();
      }

      const known = { ...row.catalog_state, cve_names: [alpha], shipped_cve_names: [alpha], cve_names_written: [alpha] };
      await runner.query(
        `UPDATE technologies SET cve_names = $2::jsonb, catalog_state = $3::jsonb WHERE id = $1`,
        [id, JSON.stringify([alpha]), JSON.stringify(known)],
      );
      const emptied = { ...entry, cve_names: [] as NonNullable<CatalogProduct['cve_names']> };
      const restoreEmpty = stubShipped(catalog, 'postgresql', emptied);
      try {
        const gone = await sync.syncTenant(runner.manager, tenantId, new Map([['postgresql', emptied]]));
        assert.equal(gone.cve_names_removed, 1, 'an empty name list withdraws a name the catalog wrote');
        assert.deepEqual((await read(id)).cve_names, []);
      } finally {
        restoreEmpty();
      }
    } finally {
      if (previous === undefined) delete entry.cve_names;
      else entry.cve_names = previous;
    }
  });
}

/**
 * AIX keys the release (`7.3`), not the technology level. A later level keeps that key and
 * refreshes the dates, instead of inserting a row the label constraint drops.
 */
async function testAixTechnologyLevel() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog, sync } = syncService();
    const tenantId = await seedTenant(runner, 'cat-aix-tl');
    const { technology } = await catalog.adopt('ibm-aix', { manager: runner.manager, tenantId });
    const before = await versionsOf(runner, technology.id);
    assert.equal(before.get('7.3')!.catalog_key, 'ibm-aix:7.3');
    assert.equal(before.get('7.3')!.standard_support_end, '2028-12-31');
    const [stored] = await runner.query(
      `SELECT build_prefixes FROM technology_versions WHERE technology_id = $1 AND label = '7.3'`,
      [technology.id],
    );
    assert.deepEqual(stored.build_prefixes, []);

    const shipped = catalog.shippedProduct('ibm-aix')!;
    const newer = versionsOfReleases(
      [{ name: '7.3.5', label: '7.3 TL5', releaseDate: '2026-10-01', eolFrom: '2031-12-31' }],
      shippedDay(1),
      'ibm-aix',
    );
    assert.deepEqual(
      newer.map((version) => [version.key, version.label, version.build_prefixes, version.standard_support_end]),
      [['7.3', '7.3', [], '2031-12-31']],
    );
    const living: CatalogProduct = {
      ...shipped,
      versions: [newer[0], ...shipped.versions.filter((version) => version.key !== '7.3')],
    };
    const result = await sync.syncTenant(runner.manager, tenantId, new Map([['ibm-aix', living]]));
    assert.equal(result.versions_added, 0, 'the new technology level does not insert a second 7.3');
    assert.equal(result.versions_updated, 1);
    const after = await versionsOf(runner, technology.id);
    assert.equal(after.size, before.size);
    assert.deepEqual(after.get('7.3'), {
      label: '7.3',
      standard_support_end: '2031-12-31',
      extended_support_end: null,
      catalog_key: 'ibm-aix:7.3',
    });
    assert.equal(after.get('7.2')!.catalog_key, 'ibm-aix:7.2');
    assert.equal(after.get('7.2')!.standard_support_end, before.get('7.2')!.standard_support_end);
  });
}

async function main() {
  const fake = await serve();
  baseUrl = fake.baseUrl;
  try {
    await runSpecs('technology catalog sync', [
      ['clean start', cleanCache],
      ['sync of a tenant', testSyncOfATenant],
      ['AIX technology level updates 7.3', testAixTechnologyLevel],
      ['technology adopted before the living catalog', testTechnologyAdoptedBefore],
      ['unreadable catalog state', testMalformedState],
      ['empty cpe_version completed', testEmptyCpeVersion],
      ['withdrawn and contradicting dates', testWithdrawnAndContradictingDates],
      ['version typed before the catalog had it', testTypedVersionIsAttached],
      ['a SQL Server release brings its CPE product', testReleaseProduct],
      ['empty description filled once', testDescriptionFilled],
      ['shipped identifier withdrawn and matched again', testShippedIdentifierWithdrawn],
      ['CPE removal rules', testCpeRemovalRules],
      ['CVE.org names', testCveNames],
      ['tenant-typed identifier is not withdrawn', testTenantTypedIdentifierIsNotWithdrawn],
      ['no usable state removes nothing', testNoUsableStateRemovesNothing],
      ['cache identifier survives a missing cache', testCacheIdentifierIsNotWithdrawnByAMissingCache],
      ['state without shipped_cpe removes nothing', testStateWithoutShippedCpeRemovesNothing],
      ['empty shipped file withdraws nothing', testEmptyShippedFileWithdrawsNothing],
      ['missing shipped entry withdraws nothing', testMissingShippedProductWithdrawsNothing],
      ['description stays in the language it was written', testDescriptionLanguageStays],
      ['description with a trailing line break stays', testDescriptionNewlineStays],
      ['description follows the catalog', testDescriptionFollows],
      ['two tenants, one follows', testTwoTenantsOneFollows],
      ['description in the users\' language', testDescriptionInUsersLanguage],
      ['scheduled run: refresh then sync', testRunRefreshesThenSyncs],
      ['gate off: no request, shipped catalog synced', testGateOff],
      ['unusable answers of endoflife.date', testUnusableAnswers],
      ['one product fails, the others are synced', testOneProductFails],
      ['stale cache', testStaleCache],
      ['clean end', cleanCache],
    ]);
  } finally {
    fake.server.close();
  }
}

void main();
