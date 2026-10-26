import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Asset } from '../asset.entity';
import { AssetsCsvService } from '../assets-csv.service';
import { AssetsListService } from '../services/assets-list.service';

// A French export writes the screen's labels. A label the tenant typed stays. Importing that file,
// or the same labels in the other languages, resolves them back to codes and reports no row error.
// The export is the list: a search keeps only the assets the list would show.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const settings = {
  serverKinds: [
    { code: 'physical_server', label: 'Physical Server' },
    { code: 'boite', label: 'Boîte atelier' },
  ],
  serverProviders: [{ code: 'other', label: 'Other' }],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  domains: [],
  adminZones: [
    { code: 'tier_0', label: 'Tier 0 (core of trust)' },
    { code: 'atelier', label: 'Atelier' },
  ],
  ipAddressTypes: [{ code: 'host', label: 'Host' }],
  subnets: [],
};

function fileOf(content: string): Express.Multer.File {
  const text = content.charCodeAt(0) === 0xfeff ? content : `\uFEFF${content}`;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'import.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

function tableOf(content: string): Array<Record<string, string>> {
  const lines = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const split = (line: string) => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else current += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ';') { cells.push(current); current = ''; }
      else current += ch;
    }
    cells.push(current);
    return cells;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(split(line).map((cell, index) => [header[index], cell])));
}

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-csv-export');
      const itOps = { getSettingsForWrite: async () => settings, getSettings: async () => settings } as any;
      const resolver = new CsvResolverService();
      const csv = new AssetsCsvService(
        runner.manager.getRepository(Asset),
        new CsvExportService(resolver),
        new CsvImportService(resolver, new CsvJsonValidators()),
        itOps,
        { labelsOf: async () => new Map() } as any,
        new AssetsListService(runner.manager.getRepository(Asset)),
      );
      const opts = { manager: runner.manager, tenantId };
      const locationId = randomUUID();
      await runner.query(
        `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type, provider)
         VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem', 'other')`,
        [locationId, tenantId],
      );
      const insert = (name: string, kind: string, adminZone: string) => runner.query(
        `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, admin_zone, location_id, hostname, ip_addresses)
         VALUES ($1, $2, $3, 'other', 'prod', 'active', $4, $5, $6, $7::jsonb)`,
        [tenantId, name, kind, adminZone, locationId, name.toLowerCase(), JSON.stringify([{ type: 'host', ip: '10.1.1.1', subnet_cidr: null }])],
      );
      await insert('Alpha', 'physical_server', 'tier_0');
      await insert('Beta', 'boite', 'atelier');

      const french = await csv.export({ ...opts, language: 'fr' });
      const rows = tableOf(french.content);
      const alpha = rows.find((row) => row.name === 'Alpha');
      const beta = rows.find((row) => row.name === 'Beta');
      assert.ok(alpha, 'Alpha is in the French export');
      assert.equal(alpha.kind, 'Serveur physique');
      assert.equal(alpha.status, 'Actif');
      assert.equal(alpha.admin_zone, 'Tier 0 (cœur de confiance)');
      assert.equal(alpha.ip_1_type, 'Hôte');
      assert.equal(alpha.environment, 'Prod');
      assert.ok(beta);
      assert.equal(beta.kind, 'Boîte atelier', 'a label the tenant typed stays');
      assert.equal(beta.admin_zone, 'Atelier');
      assert.equal(rows.some((row) => row.kind === 'physical_server' || row.kind === 'Physical Server'), false);
      assert.equal(rows.some((row) => row.admin_zone === 'tier_0'), false);
      assert.equal(rows.some((row) => row.ip_1_type === 'Host'), false);

      const searched = tableOf((await csv.export({ ...opts, language: 'fr', query: { q: 'Alpha' } })).content);
      assert.deepEqual(searched.map((row) => row.name), ['Alpha']);

      const reimported = await csv.import(fileOf(french.content), { dryRun: false, mode: 'enrich', operation: 'upsert' }, opts);
      assert.equal(reimported.ok, true, JSON.stringify(reimported.errors));
      assert.equal(reimported.errors.length, 0);
      const stored = await runner.query(
        `SELECT name, kind, status, environment, admin_zone, ip_addresses FROM assets WHERE tenant_id = $1 ORDER BY name`,
        [tenantId],
      );
      assert.deepEqual(stored.map((row: { name: string; kind: string; environment: string; admin_zone: string; ip_addresses: Array<{ type: string }> }) => ({
        name: row.name,
        kind: row.kind,
        environment: row.environment,
        admin_zone: row.admin_zone,
        ip: row.ip_addresses?.[0]?.type,
      })), [
        { name: 'Alpha', kind: 'physical_server', environment: 'prod', admin_zone: 'tier_0', ip: 'host' },
        { name: 'Beta', kind: 'boite', environment: 'prod', admin_zone: 'atelier', ip: 'host' },
      ]);

      const labels = await csv.import(fileOf([
        'name;location_reference;kind;environment;status;admin_zone;ip_1_type;ip_1_address',
        'De box;LOC-1;Physischer Server;Pré-prod;Aktiv;Tier 0 (Vertrauenskern);Host;10.2.2.2',
        'Es box;LOC-1;Servidor físico;Bac à sable;Activo;Tier 0 (núcleo de confianza);Host;10.3.3.3',
        'En box;LOC-1;Physical server;prod;Active;Tier 0 (core of trust);Host;10.4.4.4',
      ].join('\n')), { dryRun: false, mode: 'enrich', operation: 'upsert' }, opts);
      assert.equal(labels.ok, true, JSON.stringify(labels.errors));
      const coded = await runner.query(
        `SELECT name, kind, status, environment, admin_zone FROM assets WHERE tenant_id = $1 AND name IN ('De box', 'Es box', 'En box') ORDER BY name`,
        [tenantId],
      );
      assert.deepEqual(coded, [
        { name: 'De box', kind: 'physical_server', status: 'active', environment: 'pre_prod', admin_zone: 'tier_0' },
        { name: 'En box', kind: 'physical_server', status: 'active', environment: 'prod', admin_zone: 'tier_0' },
        { name: 'Es box', kind: 'physical_server', status: 'active', environment: 'sandbox', admin_zone: 'tier_0' },
      ]);
      const refused = await csv.import(fileOf(
        'name;location_reference;kind;environment\nNope env;LOC-1;Physical server;atelier',
      ), { dryRun: true, mode: 'enrich', operation: 'upsert' }, opts);
      assert.equal(refused.ok, false);
      assert.equal(refused.errors.some((error) => error.column === 'environment'), true);

      // A filter the server cannot read is the request's fault.
      await assert.rejects(
        () => csv.export({ ...opts, language: 'en', query: { filters: '{not json' } }),
        (error: any) => error?.getStatus?.() === 400,
      );

      // The export holds every matching asset, past the navigation's 10,000 ids.
      await runner.query(
        `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, location_id)
         SELECT $1, 'Bulk ' || g, 'physical_server', 'other', 'prod', 'active', $2
         FROM generate_series(1, 10050) AS g`,
        [tenantId, locationId],
      );
      const everything = tableOf((await csv.export({ ...opts, language: 'en', query: { q: 'Bulk' } })).content);
      assert.equal(everything.length, 10050);
    });
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('asset csv export integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
