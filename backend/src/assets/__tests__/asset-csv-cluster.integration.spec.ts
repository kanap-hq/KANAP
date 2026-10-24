// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { Asset } from '../asset.entity';
import { assetCsvConfig } from '../asset-csv.config';
import { AssetsCsvService } from '../assets-csv.service';
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
// writes the memberships (enrich adds, replace also takes the asset out of the clusters it does not
// name). The legacy `assets.cluster` text is never read nor written.

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
  return importer.import(assetCsvConfig, csvFile([head, ...rows].join('\n')), { dryRun: false, mode: 'enrich', operation: 'upsert', ...params }, {
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
    );
    const exported = await service.export({ manager: runner.manager, tenantId, language: 'fr', scope: 'data', fields: ['name', 'cluster'] });
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

    // Enrich adds; an empty cell changes nothing; the names ignore case and spaces.
    let result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no; CL-B ', 'node-2;LOC-1;vm;prod;no;'], {});
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await memberships(runner, tenantId), ['cl-a>node-1', 'cl-b>node-1']);

    // Unchanged: enrich naming a cluster it already has.
    result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no;cl-b'], { dryRun: true });
    assert.deepEqual([result.unchanged, result.updated], [1, 0]);

    // Replace: the asset leaves the clusters its cell does not name.
    result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no;cl-b'], { mode: 'replace', dryRun: true });
    assert.deepEqual([result.ok, result.unchanged, result.updated], [true, 0, 1]);
    result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no;cl-b'], { mode: 'replace' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await memberships(runner, tenantId), ['cl-b>node-1']);
    result = await importCsv(runner, tenantId, ['node-1;LOC-1;vm;prod;no;cl-b'], { mode: 'replace', dryRun: true });
    assert.deepEqual([result.unchanged, result.updated], [1, 0]);

    // A new asset joins; a cluster the file creates is named by another row.
    result = await importCsv(runner, tenantId, [
      'node-new;LOC-1;vm;prod;no;cl-a, cl-new',
      'cl-new;LOC-1;vm;prod;yes;',
      'node-2;LOC-1;vm;prod;no;cl-new',
    ], {});
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.inserted, result.updated], [2, 1]);
    assert.deepEqual(await memberships(runner, tenantId), ['cl-a>node-new', 'cl-b>node-1', 'cl-new>node-2', 'cl-new>node-new']);
    assert.deepEqual(await legacyTexts(runner, tenantId), []);
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
      ['node-2;LOC-1;vm;prod;no;cl-os', 'cluster_os_with_members', { os: 'Ubuntu 22.04' }],
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
      // A cluster whose operating system the same file clears (full replace) accepts the member.
      const cleared = await importCsv(runner, tenantId, ['cl-os;LOC-1;vm;prod;yes;;', 'node-2;LOC-1;vm;prod;no;cl-os;'], { dryRun: true, mode: 'replace' }, `${header};operating_system`);
      assert.equal(cleared.ok, true, JSON.stringify(cleared.errors));
    }
    assert.deepEqual(await memberships(runner, tenantId), ['cl-a>node-1']);
    assert.equal((await runner.query(`SELECT count(*)::int AS count FROM assets WHERE tenant_id = $1 AND name = 'node-new'`, [tenantId]))[0].count, 0);

    // At the load, the cleared operating system goes first, then the member joins.
    const loaded = await importCsv(runner, tenantId, ['cl-os;LOC-1;vm;prod;yes;;', 'node-2;LOC-1;vm;prod;no;cl-os;'], { mode: 'replace' }, `${header};operating_system`);
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.deepEqual(await memberships(runner, tenantId), ['cl-a>node-1', 'cl-os>node-2']);
    assert.equal(await operatingSystems.labelOf(runner.manager, tenantId, clOs), null);

    // A member added between the check and the write: the write checks again, on the locked rows,
    // and stops the import before anything is written (the check is skipped here to stand for it).
    const late = { ...assetCsvConfig, afterValidate: undefined };
    const lateImport = (rows: string[], head = header) => importer.import(late, csvFile([head, ...rows].join('\n')),
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
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
  ['the import adds, replaces, creates and detects an unchanged row', testImport],
  ['the import refuses each wrong name at the check and at the load', testErrors],
]);
