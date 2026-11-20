// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { Asset } from '../asset.entity';
import { assetCsvConfig } from '../asset-csv.config';
import { AssetsCsvService } from '../assets-csv.service';
import { AssetsListService } from '../services/assets-list.service';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import type { CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { TechnologyCatalogService } from '../../technologies/catalog/technology-catalog.service';
import { OperatingSystemService } from '../../technologies/operating-system.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { asset, member } from '../../technologies/__tests__/technologies.fixtures';

// The Cluster Membership column of the asset CSV (lot A2 of the clusters pass), against a real
// database: the export writes the names of the real clusters; the import resolves each name to one
// cluster of the tenant, refuses the rest with coded row errors at the check and at the load, and
// writes the memberships by the clearing rule (D21 of 26.11.9, T-I6d): a filled cell is the whole
// list (the asset leaves the clusters it does not name), `-` takes the asset out of all of them, a
// blank cell keeps them; the links removed are counted (`cleared`) at the check as at the load. The
// legacy `assets.cluster` text is never read nor written. The operating system follows the same rule.

const csvSettings: any = {
  serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  domains: [],
  adminZones: [],
  ipAddressTypes: [],
  technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES,
  hostingTypes: DEFAULT_HOSTING_TYPES,
};
const audit = { log: async () => undefined };
const itOps = { getSettings: async () => csvSettings, getSettingsForWrite: async () => csvSettings };
const operatingSystems = new OperatingSystemService(audit as any, itOps as any, new TechnologyCatalogService(audit as any, itOps as any));
const resolver = new CsvResolverService();
const importer = new CsvImportService(resolver, new CsvJsonValidators());

function csvFile(content: string): Express.Multer.File {
  const text = '﻿' + content;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'assets.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

const header = 'name;location_reference;kind;environment;is_cluster;cluster';

function importCsv(runner: QueryRunner, tenantId: string, rows: string[], params: Partial<CsvImportParams>, head = header): Promise<CsvImportResult> {
  return importer.import(assetCsvConfig, csvFile([head, ...rows].join('\n')), { dryRun: false, operation: 'upsert', ...params }, {
    manager: runner.manager, tenantId, userId: null, isAdmin: true, itOpsSettings: csvSettings,
  });
}

async function seedLocation(runner: QueryRunner, tenantId: string) {
  const locationId = randomUUID();
  await runner.query(
    `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem')`,
    [locationId, tenantId],
  );
  return locationId;
}

async function place(runner: QueryRunner, tenantId: string, locationId: string) {
  await runner.query(`UPDATE assets SET location_id = $2, provider = 'on_prem' WHERE tenant_id = $1`, [tenantId, locationId]);
}

/** Every membership of the tenant, as `cluster>member`. */
async function memberships(runner: QueryRunner, tenantId: string): Promise<string[]> {
  const rows: Array<{ pair: string }> = await runner.query(
    `SELECT c.name || '>' || a.name AS pair
       FROM asset_cluster_members m
       JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id
       JOIN assets a ON a.tenant_id = m.tenant_id AND a.id = m.asset_id
      WHERE m.tenant_id = $1
      ORDER BY 1`,
    [tenantId],
  );
  return rows.map((row) => row.pair);
}

async function legacyTexts(runner: QueryRunner, tenantId: string): Promise<string[]> {
  const rows: Array<{ text: string }> = await runner.query(
    `SELECT name || '=' || cluster AS text FROM assets WHERE tenant_id = $1 AND cluster IS NOT NULL ORDER BY name`,
    [tenantId],
  );
  return rows.map((row) => row.text);
}

async function testExport() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'acc-x');
    const beta = await asset(runner, tenantId, 'beta-cl', true);
    const alpha = await asset(runner, tenantId, 'Alpha-cl', true);
    const twice = await asset(runner, tenantId, 'node-twice');
    const lonely = await asset(runner, tenantId, 'node-lonely');
    await member(runner, tenantId, beta, twice);
    await member(runner, tenantId, alpha, twice);
    await runner.query(`UPDATE assets SET cluster = 'LEGACY' WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, [lonely, beta]]);

    const service = new AssetsCsvService(
      runner.manager.getRepository(Asset),
      new CsvExportService(resolver),
      importer,
      itOps as any,
      operatingSystems,
      new AssetsListService(runner.manager.getRepository(Asset)),
    );
    // The export keeps the list's order: sorted by name, as the screen asks.
    const exported = await service.export({ manager: runner.manager, tenantId, language: 'fr', scope: 'data', fields: ['name', 'cluster'], query: { sort: 'name:ASC' } });
    const lines = exported.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.deepEqual(lines.slice(1), ['Alpha-cl;', 'beta-cl;', 'node-lonely;', 'node-twice;Alpha-cl, beta-cl']);
  });
}

async function testImport() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'acc-i');
    const locationId = await seedLocation(runner, tenantId);
    const clA = await asset(runner, tenantId, 'cl-a', true);
    await asset(runner, tenantId, 'cl-b', true);
    const node1 = await asset(runner, tenantId, 'node-1');
    await asset(runner, tenantId, 'node-2');
    await member(runner, tenantId, clA, node1);
    await place(runner, tenantId, locationId);
    // The legacy text is never read: a blank cell, or no column, leaves the real clusters alone.
    await runner.query(`UPDATE assets SET cluster = 'cl-b' WHERE tenant_id = $1 AND name = 'node-2'`, [tenantId]);

    // A filled cell is the whole list: node-1 leaves cl-a, said at the check (one link cleared). An
    // empty cell keeps; the names ignore case and spaces.
    const named = ['node-1;LOC-1;vm;prod;no; CL-B ', 'node-2;LOC-1;vm;prod;no;'];
    let result = await importCsv(runner, tenantId, named, { dryRun: true });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.updated, result.unchanged, result.cleared], [1, 1, 1]);
    result = await importCsv(runner, tenantId, named, {});
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.updated, result.unchanged, result.cleared], [1, 1, 1]);
    assert.deepEqual(await memberships(runner, tenantId), ['cl-b>node-1']);
    result = await importCsv(runner, tenantId, ['node-2;LOC-1;vm;prod;no'], { dryRun: true }, 'name;location_reference;kind;environment;is_cluster');
    assert.deepEqual([result.updated, result.unchanged, result.cleared], [0, 1, 0]);

    // The same list is unchanged; a longer one adds and clears nothing.
    result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no;cl-b'], { dryRun: true });
    assert.deepEqual([result.unchanged, result.updated, result.cleared], [1, 0, 0]);
    result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no;cl-b, cl-a'], {});
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 0]);
    assert.deepEqual(await memberships(runner, tenantId), ['cl-a>node-1', 'cl-b>node-1']);

    // `-` takes the asset out of every cluster, two links; on an asset in none, nothing changes.
    result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no;-'], { dryRun: true });
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 2]);
    result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no;-'], {});
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 2]);
    assert.deepEqual(await memberships(runner, tenantId), []);
    result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no;__CLEAR__', 'node-2;LOC-1;vm;prod;no;-'], { dryRun: true });
    assert.deepEqual([result.ok, result.unchanged, result.cleared], [true, 2, 0]);
    await member(runner, tenantId, clA, node1);

    // A new asset joins; a cluster the file creates is named by another row; `-` on a new asset is blank.
    result = await importCsv(runner, tenantId, [
      'node-new;LOC-1;vm;prod;no;cl-a, cl-new',
      'cl-new;LOC-1;vm;prod;yes;',
      'node-2;LOC-1;vm;prod;no;cl-new',
      'node-bare;LOC-1;vm;prod;no;-',
    ], {});
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.inserted, result.updated, result.cleared], [3, 1, 0]);
    assert.deepEqual(await memberships(runner, tenantId), ['cl-a>node-1', 'cl-a>node-new', 'cl-new>node-2', 'cl-new>node-new']);
    assert.deepEqual(await legacyTexts(runner, tenantId), ['node-2=cl-b']);
  });
}

/**
 * The operating system cell: blank keeps the marked link, `-` removes it (one value cleared, said at
 * the check), and `-` on an asset without one changes nothing.
 */
async function testOperatingSystem() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'acc-os');
    const locationId = await seedLocation(runner, tenantId);
    const server = await asset(runner, tenantId, 'srv-os');
    await asset(runner, tenantId, 'srv-bare');
    await place(runner, tenantId, locationId);
    const ubuntu = await operatingSystems.resolve(runner.manager, tenantId, 'Ubuntu 22.04', { create: true });
    await operatingSystems.setOperatingSystem(runner.manager, tenantId, server, ubuntu, 'manual');
    const head = 'name;location_reference;kind;environment;operating_system';

    let result = await importCsv(runner, tenantId, ['srv-os;LOC-1;vm;prod;', 'srv-bare;LOC-1;vm;prod;-'], { dryRun: true }, head);
    assert.deepEqual([result.ok, result.unchanged, result.cleared], [true, 2, 0], JSON.stringify(result.errors));
    result = await importCsv(runner, tenantId, ['srv-os;LOC-1;vm;prod;'], {}, head);
    assert.equal(await operatingSystems.labelOf(runner.manager, tenantId, server), 'Ubuntu 22.04 LTS');

    result = await importCsv(runner, tenantId, ['srv-os;LOC-1;vm;prod;-'], { dryRun: true }, head);
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 1], JSON.stringify(result.errors));
    result = await importCsv(runner, tenantId, ['srv-os;LOC-1;vm;prod;-'], {}, head);
    assert.deepEqual([result.ok, result.updated, result.cleared], [true, 1, 1], JSON.stringify(result.errors));
    assert.equal(await operatingSystems.labelOf(runner.manager, tenantId, server), null);
  });
}

/**
 * An export read back changes nothing (T-I6d): an asset in two clusters keeps both, and a stored
 * text "-" (written `'-` by the export) is a value, never a `-` that clears.
 */
async function testRoundTrip() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'acc-rt');
    const locationId = await seedLocation(runner, tenantId);
    const alpha = await asset(runner, tenantId, 'alpha-cl', true);
    const beta = await asset(runner, tenantId, 'beta-cl', true);
    const twice = await asset(runner, tenantId, 'node-twice');
    const dash = await asset(runner, tenantId, '-');
    await member(runner, tenantId, alpha, twice);
    await member(runner, tenantId, beta, twice);
    await member(runner, tenantId, alpha, dash);
    await place(runner, tenantId, locationId);
    await runner.query(`UPDATE assets SET hostname = '-', aliases = ARRAY['-'] WHERE tenant_id = $1 AND id = $2`, [tenantId, dash]);

    const service = new AssetsCsvService(
      runner.manager.getRepository(Asset),
      new CsvExportService(resolver),
      importer,
      itOps as any,
      operatingSystems,
      new AssetsListService(runner.manager.getRepository(Asset)),
    );
    const exported = await service.export({ manager: runner.manager, tenantId, language: 'fr', scope: 'data', preset: 'enrichment', query: { sort: 'name:ASC' } });
    const content = exported.content.replace(/^﻿/, '');
    assert.ok(content.includes("'-"), content);
    for (const dryRun of [true, false]) {
      const result = await importer.import(assetCsvConfig, csvFile(content), { dryRun, operation: 'upsert' }, {
        manager: runner.manager, tenantId, userId: null, isAdmin: true, itOpsSettings: csvSettings, language: 'fr',
      });
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.deepEqual([result.updated, result.unchanged, result.inserted, result.cleared], [0, 4, 0, 0]);
    }
    assert.deepEqual(await memberships(runner, tenantId), ['alpha-cl>-', 'alpha-cl>node-twice', 'beta-cl>node-twice']);
    const [stored] = await runner.query(`SELECT hostname, aliases FROM assets WHERE id = $1`, [dash]);
    assert.deepEqual([stored.hostname, stored.aliases], ['-', ['-']]);
  });
}

async function testErrors() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'acc-e');
    const locationId = await seedLocation(runner, tenantId);
    const clA = await asset(runner, tenantId, 'cl-a', true);
    await asset(runner, tenantId, 'cl-b', true);
    await asset(runner, tenantId, 'dup', true);
    await asset(runner, tenantId, 'DUP', true);
    const clOs = await asset(runner, tenantId, 'cl-os', true);
    const node1 = await asset(runner, tenantId, 'node-1');
    await asset(runner, tenantId, 'node-2');
    await member(runner, tenantId, clA, node1);
    await place(runner, tenantId, locationId);
    const ubuntu = await operatingSystems.resolve(runner.manager, tenantId, 'Ubuntu 22.04', { create: true });
    await operatingSystems.setOperatingSystem(runner.manager, tenantId, clOs, ubuntu, 'manual');

    const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
      ['node-2;LOC-1;vm;prod;no;ghost', 'CSV_CLUSTER_NOT_FOUND', { name: 'ghost' }],
      ['node-2;LOC-1;vm;prod;no;Dup', 'CSV_CLUSTER_AMBIGUOUS', { name: 'Dup' }],
      ['node-2;LOC-1;vm;prod;no;node-1', 'CSV_CLUSTER_NOT_A_CLUSTER', { name: 'node-1' }],
      ['cl-b;LOC-1;vm;prod;yes;cl-a', 'cluster_member_is_cluster', { name: 'cl-b' }],
      ['node-2;LOC-1;vm;prod;yes;cl-a', 'cluster_member_is_cluster', { name: 'node-2' }],
      ['node-2;LOC-1;vm;prod;no;node-2', 'cluster_member_self', undefined],
      ['node-2;LOC-1;vm;prod;no;cl-os', 'cluster_os_with_members', { os: 'Ubuntu 22.04 LTS' }],
      ['node-new;LOC-1;vm;prod;no;cl-a, ghost', 'CSV_CLUSTER_NOT_FOUND', { name: 'ghost' }],
    ];
    for (const dryRun of [true, false]) {
      for (const [row, code, params] of cases) {
        const result = await importCsv(runner, tenantId, [row], { dryRun });
        assert.equal(result.ok, false, row);
        assert.deepEqual(result.errors.map((e) => [e.row, e.column, e.code, e.params]), [[2, 'cluster', code, params]], row);
      }
      // A cluster whose operating system the same file sets gets no member either.
      const withOs = await importCsv(runner, tenantId, ['cl-b;LOC-1;vm;prod;yes;;Debian 12', 'node-2;LOC-1;vm;prod;no;cl-b;'], { dryRun }, `${header};operating_system`);
      assert.deepEqual(withOs.errors.map((e) => [e.row, e.column, e.code]), [[3, 'cluster', 'cluster_os_with_members']]);
      // A cluster whose operating system the same file clears (`-`) accepts the member.
      const cleared = await importCsv(runner, tenantId, ['cl-os;LOC-1;vm;prod;yes;;-', 'node-2;LOC-1;vm;prod;no;cl-os;'], { dryRun: true }, `${header};operating_system`);
      assert.equal(cleared.ok, true, JSON.stringify(cleared.errors));
    }
    assert.deepEqual(await memberships(runner, tenantId), ['cl-a>node-1']);
    assert.equal((await runner.query(`SELECT count(*)::int AS count FROM assets WHERE tenant_id = $1 AND name = 'node-new'`, [tenantId]))[0].count, 0);

    // At the load, the cleared operating system goes first, then the member joins.
    const loaded = await importCsv(runner, tenantId, ['cl-os;LOC-1;vm;prod;yes;;-', 'node-2;LOC-1;vm;prod;no;cl-os;'], {}, `${header};operating_system`);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.deepEqual(await memberships(runner, tenantId), ['cl-a>node-1', 'cl-os>node-2']);
    assert.equal(await operatingSystems.labelOf(runner.manager, tenantId, clOs), null);

    // A member added between the check and the write: the write checks again, on the locked rows,
    // and stops the import before anything is written (the check is skipped here to stand for it).
    const late = { ...assetCsvConfig, afterValidate: undefined };
    const lateImport = (rows: string[], head = header) => importer.import(late, csvFile([head, ...rows].join('\n')),
      { dryRun: false, operation: 'upsert' },
      { manager: runner.manager, tenantId, userId: null, isAdmin: true, itOpsSettings: csvSettings });
    const switched = await lateImport(['cl-a;LOC-1;vm;prod;no;']);
    assert.deepEqual(switched.errors.map((e) => [e.code, (e.params as any)?.reason]), [
      ['CSV_IMPORT_FAILED', 'cl-a: This cluster still has 1 member(s). Remove them first.'],
    ]);
    assert.equal((await runner.query(`SELECT is_cluster FROM assets WHERE id = $1`, [clA]))[0].is_cluster, true);
    const withOsLate = await lateImport(['cl-a;LOC-1;vm;prod;yes;;Debian 12'], `${header};operating_system`);
    assert.deepEqual(withOsLate.errors.map((e) => [e.code, (e.params as any)?.reason]), [
      ['CSV_IMPORT_FAILED', 'cl-a: This cluster has members: it has no operating system.'],
    ]);
    assert.equal(await operatingSystems.labelOf(runner.manager, tenantId, clA), null);
  });
}

runSpecs('asset-csv-cluster.integration.spec.ts', [
  ['the export writes the names of the real clusters', testExport],
  ['a filled cell replaces the clusters, `-` clears them, a blank cell keeps them, counted', testImport],
  ['the operating system: blank keeps, `-` removes the link', testOperatingSystem],
  ['an export read back changes nothing', testRoundTrip],
  ['the import refuses each wrong name at the check and at the load', testErrors],
]);
