import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { assetCsvConfig } from '../asset-csv.config';

// The asset CSV dry run refuses a bad host name, a malformed IP, an unknown catalog value and an
// impossible date, each as a coded row error. Loading that date returns the same error and leaves
// the transaction usable: PostgreSQL used to abort it and the API answered 500.
// A row without a site is a row error (CSV_VALUE_REQUIRED) and a file without the site column is refused.
// An ip_2 address with an empty ip_1 cell is a row error (asset_ip_gap). A file that simply has no
// ip_1 column is left alone.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const itOpsSettings: any = {
  serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  domains: [{ code: 'corp', label: 'Corporate' }],
  adminZones: [{ code: 'tier_0', label: 'Tier 0' }],
  ipAddressTypes: [{ code: 'host', label: 'Host' }],
};

const importer = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());

function file(content: string): Express.Multer.File {
  const text = '﻿' + content;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'import.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

const COLUMNS = ['name', 'location_reference', 'kind', 'environment', 'hostname', 'domain', 'status', 'admin_zone', 'go_live_date', 'ip_1_type', 'ip_1_address', 'ip_2_type', 'ip_2_address'] as const;

function csvRow(name: string, patch: Partial<Record<(typeof COLUMNS)[number], string>>): string {
  const cells = Object.fromEntries(COLUMNS.map((column) => [column, ''])) as Record<string, string>;
  cells.name = name;
  cells.location_reference = 'LOC-1';
  cells.kind = 'vm';
  cells.environment = 'prod';
  Object.assign(cells, patch);
  return COLUMNS.map((column) => cells[column]).join(';');
}

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-csv-validation');
      await runner.query(
        `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem')`,
        [randomUUID(), tenantId],
      );
      const context = { manager: runner.manager, tenantId, userId: null, itOpsSettings };
      const params = { dryRun: true, mode: 'enrich' as const, operation: 'upsert' as const };

      const csv = [
        COLUMNS.join(';'),
        csvRow('Bad host', { hostname: 'qa c4!' }),
        csvRow('Bad octets', { ip_1_type: 'host', ip_1_address: '999.999.1.1' }),
        csvRow('Bad text', { ip_1_type: 'host', ip_1_address: 'not-an-ip' }),
        csvRow('Bad kind', { kind: 'Foo' }),
        csvRow('Bad domain', { domain: 'nosuch' }),
        csvRow('Bad life', { status: 'Nope' }),
        csvRow('Bad zone', { admin_zone: 'Nowhere' }),
        csvRow('Bad euro', { go_live_date: '31/02/2025' }),
        csvRow('Bad iso', { go_live_date: '2025-02-31' }),
        csvRow('Bad gap', { ip_2_type: 'host', ip_2_address: '10.2.2.2' }),
        csvRow('Bad type', { ip_1_type: 'Foo', ip_1_address: '10.3.3.3' }),
        csvRow('No site', { location_reference: '' }),
      ].join('\n');

      const dryRun = await importer.import(assetCsvConfig, file(csv), params, context);
      assert.equal(dryRun.ok, false);
      assert.equal(dryRun.inserted, 0);
      assert.deepEqual(
        dryRun.errors.map((error) => ({
          row: error.row,
          column: error.column,
          code: error.code,
          value: error.params?.value,
          slot: error.params?.slot,
          earlier: error.params?.earlier,
        })),
        [
          { row: 2, column: 'hostname', code: 'asset_hostname_invalid', value: 'qa c4!', slot: undefined, earlier: undefined },
          { row: 3, column: 'ip_1_address', code: 'asset_ip_invalid', value: '999.999.1.1', slot: undefined, earlier: undefined },
          { row: 4, column: 'ip_1_address', code: 'asset_ip_invalid', value: 'not-an-ip', slot: undefined, earlier: undefined },
          { row: 5, column: 'kind', code: 'asset_kind_invalid', value: 'Foo', slot: undefined, earlier: undefined },
          { row: 6, column: 'domain', code: 'asset_domain_invalid', value: 'nosuch', slot: undefined, earlier: undefined },
          { row: 7, column: 'status', code: 'asset_lifecycle_invalid', value: 'Nope', slot: undefined, earlier: undefined },
          { row: 8, column: 'admin_zone', code: 'asset_admin_zone_invalid', value: 'Nowhere', slot: undefined, earlier: undefined },
          { row: 9, column: 'go_live_date', code: 'CSV_DATE_INVALID', value: '31/02/2025', slot: undefined, earlier: undefined },
          { row: 10, column: 'go_live_date', code: 'CSV_DATE_INVALID', value: '2025-02-31', slot: undefined, earlier: undefined },
          { row: 11, column: 'ip_2_address', code: 'asset_ip_gap', value: undefined, slot: 2, earlier: 1 },
          { row: 12, column: 'ip_1_type', code: 'asset_ip_type_invalid', value: 'Foo', slot: undefined, earlier: undefined },
          { row: 13, column: 'location_reference', code: 'CSV_VALUE_REQUIRED', value: undefined, slot: undefined, earlier: undefined },
        ],
      );

      // The load of an impossible date must return, not throw, and write nothing.
      const loaded = await runner.manager.transaction(async (manager) => importer.import(
        assetCsvConfig,
        file('name;location_reference;kind;environment;go_live_date\nDated;LOC-1;vm;prod;31/02/2025'),
        { ...params, dryRun: false },
        { ...context, manager },
      ));
      assert.equal(loaded.ok, false);
      assert.deepEqual(loaded.errors.map((error) => [error.column, error.code, error.params?.value]), [
        ['go_live_date', 'CSV_DATE_INVALID', '31/02/2025'],
      ]);
      const [none] = await runner.query(`SELECT count(*)::int AS n FROM assets WHERE tenant_id = $1`, [tenantId]);
      assert.equal(none.n, 0);

      // Every asset has a site: a file without the column is refused as a whole.
      const noColumn = await importer.import(assetCsvConfig, file('name;kind;environment\nNo column;vm;prod'), params, context);
      assert.equal(noColumn.ok, false);
      assert.deepEqual(noColumn.errors.map((error) => [error.row, error.code, error.params?.missing]), [
        [0, 'CSV_HEADER_MISSING_COLUMNS', 'location_reference'],
      ]);

      const secondOnly = await importer.import(
        assetCsvConfig,
        file('name;location_reference;kind;environment;ip_2_type;ip_2_address\nSecond only;LOC-1;vm;prod;host;10.4.4.4'),
        params,
        context,
      );
      assert.equal(secondOnly.ok, true, JSON.stringify(secondOnly.errors));
      assert.deepEqual(secondOnly.errors.filter((error) => error.code === 'asset_ip_gap'), []);

      const good = await importer.import(
        assetCsvConfig,
        file([
          'name;location_reference;kind;environment;hostname;domain;status;admin_zone;go_live_date;ip_1_type;ip_1_address',
          'Good server;LOC-1;Virtual machine;prod;srv01;Corporate;Active;tier_0;02/09/2026;Host;10.9.9.9',
          'Leap server;LOC-1;vm;prod;srv02;corp;active;tier_0;29/02/2024;host;10.9.9.10',
        ].join('\n')),
        { ...params, dryRun: false },
        context,
      );
      assert.equal(good.ok, true, JSON.stringify(good.errors));
      assert.equal(good.inserted, 2);
      const stored = await runner.query(
        `SELECT name, kind, domain, status, admin_zone, hostname, go_live_date::text AS go_live_date, ip_addresses
           FROM assets WHERE tenant_id = $1 ORDER BY name`,
        [tenantId],
      );
      assert.deepEqual(stored.map((row: any) => ({
        name: row.name,
        kind: row.kind,
        domain: row.domain,
        status: row.status,
        admin_zone: row.admin_zone,
        hostname: row.hostname,
        go_live_date: row.go_live_date,
        ip: row.ip_addresses,
      })), [
        {
          name: 'Good server', kind: 'vm', domain: 'corp', status: 'active', admin_zone: 'tier_0',
          hostname: 'srv01', go_live_date: '2026-09-02',
          ip: [{ type: 'host', ip: '10.9.9.9', subnet_cidr: null }],
        },
        {
          name: 'Leap server', kind: 'vm', domain: 'corp', status: 'active', admin_zone: 'tier_0',
          hostname: 'srv02', go_live_date: '2024-02-29',
          ip: [{ type: 'host', ip: '10.9.9.10', subnet_cidr: null }],
        },
      ]);

      // A stored host name or address an older rule let through does not block the row while the
      // file keeps it; the same value on a new asset, or a changed one, is checked.
      await runner.query(
        `UPDATE assets SET hostname = 'legacy host', ip_addresses = '[{"type":"host","ip":"10.9.9.300","subnet_cidr":null}]'::jsonb
          WHERE tenant_id = $1 AND name = 'Good server'`,
        [tenantId],
      );
      const kept = await importer.import(
        assetCsvConfig,
        file([
          'name;location_reference;kind;environment;hostname;ip_1_type;ip_1_address',
          'Good server;LOC-1;vm;prod;legacy host;host;10.9.9.300',
          'New twin;LOC-1;vm;prod;legacy twin;host;10.9.9.300',
          'Leap server;LOC-1;vm;prod;srv 02;host;10.9.9.301',
        ].join('\n')),
        params,
        context,
      );
      assert.deepEqual(kept.errors.map((error) => [error.row, error.column, error.code]), [
        [3, 'hostname', 'asset_hostname_invalid'],
        [3, 'ip_1_address', 'asset_ip_invalid'],
        [4, 'hostname', 'asset_hostname_invalid'],
        [4, 'ip_1_address', 'asset_ip_invalid'],
      ]);
    });
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('asset csv validation integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
