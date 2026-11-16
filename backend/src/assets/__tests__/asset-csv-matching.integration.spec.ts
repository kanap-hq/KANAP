// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { assetCsvConfig } from '../asset-csv.config';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import type { CsvCallerAccess, CsvImportParams, CsvImportResult } from '../../common/csv/csv-field.types';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { TechnologyCatalogService } from '../../technologies/catalog/technology-catalog.service';
import { OperatingSystemService } from '../../technologies/operating-system.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { asset } from '../../technologies/__tests__/technologies.fixtures';

// Lot I3 of 26.11.9. The servers import:
// - resolves the operating system at the check too, writing nothing: a version found by a prefix
//   rule (`Ubuntu 22.04` for `22.04 LTS`) is a match, listed and undoable; a version to create is
//   said (`CSV_TECHNOLOGY_VERSION_CREATED`); a file read again is unchanged (T-I3e);
// - never guesses a type: `Cloud` is refused like any type the catalog does not have (T-I3f);
// - finds a cluster by its name exactly or case aside, then accents aside for a person who reads
//   the servers; Kad's proposals are taken for a cluster the person reads (T-I3a).

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
const itOps = { getSettings: async () => csvSettings };
const operatingSystems = new OperatingSystemService(audit as any, itOps as any, new TechnologyCatalogService(audit as any, itOps as any));
const importer = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
const ADMIN: CsvCallerAccess = { isAdmin: true };

function csvFile(lines: string[]): Express.Multer.File {
  const text = lines.join('\n');
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'assets.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

function importCsv(runner: QueryRunner, tenantId: string, lines: string[], params: Partial<CsvImportParams>, access?: CsvCallerAccess): Promise<CsvImportResult> {
  return importer.import(assetCsvConfig, csvFile(lines), { dryRun: true, mode: 'enrich', operation: 'upsert', ...params }, {
    manager: runner.manager, tenantId, userId: null, isAdmin: true, itOpsSettings: csvSettings, access,
  });
}

async function seedLocation(runner: QueryRunner, tenantId: string) {
  await runner.query(
    `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem')`,
    [randomUUID(), tenantId],
  );
}

const listed = (result: CsvImportResult) =>
  (result.matches ?? []).map((match) => `${match.column}:${match.value}>${match.target}:${match.reason}:${match.origin}:${match.lines.join('|')}:${match.undoable}`);
const codes = (result: CsvImportResult) => result.errors.map((error) => [error.row, error.column, error.code]);

async function systems(runner: QueryRunner, tenantId: string): Promise<Record<string, string>> {
  const ids: Array<{ id: string; name: string }> = await runner.query(`SELECT id, name FROM assets WHERE tenant_id = $1`, [tenantId]);
  const labels = await operatingSystems.labelsOf(runner.manager, tenantId, ids.map((row) => row.id));
  return Object.fromEntries(ids.filter((row) => labels.has(row.id)).map((row) => [row.name, labels.get(row.id)!]).sort());
}

const OS_HEADER = 'name;location_reference;kind;environment;operating_system';

async function testOperatingSystemAtTheCheck() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'asset-csv-os-match');
    await seedLocation(runner, tenantId);
    const file = [
      OS_HEADER,
      'srv-a;LOC-1;vm;prod;Ubuntu 22.04',
      'srv-b;LOC-1;vm;prod;Ubuntu 22.04.3 LTS',
      'srv-c;LOC-1;vm;prod;Windows Server 2022 Datacenter',
    ];
    const check = await importCsv(runner, tenantId, file, {}, ADMIN);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual(listed(check), [
      'operating_system:Ubuntu 22.04>Ubuntu 22.04 LTS:version:server:2:true',
      'operating_system:Windows Server 2022 Datacenter>Windows Server 2022:version:server:4:true',
    ]);
    assert.deepEqual(
      check.warnings.filter((w) => w.code === 'CSV_TECHNOLOGY_VERSION_CREATED').map((w) => [w.row, w.column, w.params]),
      [[3, 'operating_system', { value: '22.04.3 LTS' }]],
    );
    assert.equal((await runner.query(`SELECT 1 FROM technologies WHERE tenant_id = $1`, [tenantId])).length, 0, 'the check writes nothing');

    const load = await importCsv(runner, tenantId, file, { dryRun: false }, ADMIN);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual(load.matches, check.matches, 'the load lists the same matches');
    assert.deepEqual(await systems(runner, tenantId), {
      'srv-a': 'Ubuntu 22.04 LTS', 'srv-b': 'Ubuntu 22.04.3 LTS', 'srv-c': 'Windows Server 2022',
    });

    const again = await importCsv(runner, tenantId, file, {}, ADMIN);
    assert.equal(again.unchanged, 3, `the file read again changes nothing: ${JSON.stringify(again)}`);

    const undone = await importCsv(runner, tenantId, [OS_HEADER, 'srv-a;LOC-1;vm;prod;Ubuntu 22.04'], {
      dryRun: false, unmatched: [{ column: 'operating_system', value: 'Ubuntu 22.04' }],
    }, ADMIN);
    assert.equal(undone.ok, true, JSON.stringify(undone.errors));
    assert.equal(undone.matches, undefined);
    assert.deepEqual(undone.warnings.map((w) => w.code), ['CSV_TECHNOLOGY_VERSION_CREATED']);
    assert.equal((await systems(runner, tenantId))['srv-a'], 'Ubuntu 22.04', 'undone: created as written');

    const proposed = await importCsv(runner, tenantId, [OS_HEADER, 'srv-d;LOC-1;vm;prod;Ubu 24', 'srv-e;LOC-1;vm;prod;Zz OS'], {
      dryRun: false, proposals: { operating_system: { 'Ubu 24': 'Ubuntu 24.04 LTS', 'Zz OS': 'Nothing 1' } },
    }, ADMIN);
    assert.equal(proposed.ok, true, JSON.stringify(proposed.errors));
    assert.deepEqual(listed(proposed), ['operating_system:Ubu 24>Ubuntu 24.04 LTS:model:model:2:true']);
    assert.deepEqual(proposed.refusedProposals?.map((entry) => [entry.value, entry.target]), [['Zz OS', 'Nothing 1']]);
    const stored = await systems(runner, tenantId);
    assert.equal(stored['srv-d'], 'Ubuntu 24.04 LTS', 'the proposal is written');
    assert.equal(stored['srv-e'], 'Zz OS', 'a refused proposal leaves the cell to its own rule');
  });
}

async function testCloudIsNoType() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'asset-csv-cloud');
    await seedLocation(runner, tenantId);
    const check = await importCsv(runner, tenantId, ['name;location_reference;kind;environment', 'srv-cloud;LOC-1;Cloud;prod'], {}, ADMIN);
    assert.deepEqual(check.errors.map((error) => [error.row, error.column, error.code, error.params]), [[2, 'kind', 'asset_kind_invalid', { value: 'Cloud' }]]);
  });
}

async function testClusterNames() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'asset-csv-cluster-names');
    await seedLocation(runner, tenantId);
    await asset(runner, tenantId, 'Grappe Réseau', true);
    await asset(runner, tenantId, 'Pôle A', true);
    await asset(runner, tenantId, 'Pole Á', true);
    const header = 'name;location_reference;kind;environment;is_cluster;cluster';
    const file = [header, 'node-1;LOC-1;vm;prod;no;Grappe Reseau', 'node-2;LOC-1;vm;prod;no;Pole A'];
    const check = await importCsv(runner, tenantId, file, {}, ADMIN);
    assert.deepEqual(codes(check), [[3, 'cluster', 'CSV_NAME_AMBIGUOUS_AMONG']]);
    assert.deepEqual(listed(check), ['cluster:Grappe Reseau>Grappe Réseau:accents:server:2:true']);
    assert.equal(check.matches?.[0].ref?.startsWith('AST-'), true, 'the cluster is named by its reference');

    const load = await importCsv(runner, tenantId, [header, 'node-1;LOC-1;vm;prod;no;Grappe Reseau'], { dryRun: false }, ADMIN);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    const members: Array<{ pair: string }> = await runner.query(
      `SELECT c.name || '>' || a.name AS pair FROM asset_cluster_members m
         JOIN assets c ON c.id = m.cluster_id JOIN assets a ON a.id = m.asset_id WHERE m.tenant_id = $1`,
      [tenantId],
    );
    assert.deepEqual(members.map((row) => row.pair), ['Grappe Réseau>node-1']);

    const undone = await importCsv(runner, tenantId, [header, 'node-3;LOC-1;vm;prod;no;Grappe Reseau'], {
      unmatched: [{ column: 'cluster', value: 'Grappe Reseau' }],
    }, ADMIN);
    assert.deepEqual(codes(undone), [[2, 'cluster', 'CSV_CLUSTER_NOT_FOUND']], 'undone: unknown');
    const internal = await importCsv(runner, tenantId, [header, 'node-3;LOC-1;vm;prod;no;Grappe Reseau'], {});
    assert.deepEqual(codes(internal), [[2, 'cluster', 'CSV_CLUSTER_NOT_FOUND']], 'without the rights: case aside only');

    const proposed = await importCsv(runner, tenantId, [header, 'node-3;LOC-1;vm;prod;no;Réseau, Pole A'], {
      proposals: { cluster: { 'Réseau': 'Grappe Réseau', 'Pole A': 'Pôle A' } },
    }, ADMIN);
    assert.equal(proposed.ok, true, JSON.stringify(proposed.errors));
    assert.deepEqual(listed(proposed), [
      'cluster:Réseau>Grappe Réseau:model:model:2:true',
      'cluster:Pole A>Pôle A:model:model:2:true',
    ]);
  });
}

void runSpecs('asset-csv-matching.integration.spec.ts', [
  ['operating system at the check', testOperatingSystemAtTheCheck],
  ['Cloud is no type', testCloudIsNoType],
  ['cluster names', testClusterNames],
]);
