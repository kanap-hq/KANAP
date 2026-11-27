import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { assetCsvConfig } from '../asset-csv.config';

// Lot K2c of 26.12.1, third pass: rule P7 (maintainer, 2026-11-23) on the subnet of an IP address in
// the asset import, as the API applies it. A row that puts a retired subnet on a new asset, or on an
// asset that does not hold it, is refused with its coded message and the subnets allowed; a row that
// repeats the retired subnet its asset already holds passes.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const importer = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());

function file(content: string): Express.Multer.File {
  const text = '﻿' + content;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'import.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-csv-subnet-catalog');
      const locationId = randomUUID();
      await runner.query(
        `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem')`,
        [locationId, tenantId],
      );
      const holdIp = JSON.stringify([{ type: 'host', ip: '10.9.0.5', subnet_cidr: '10.9.0.0/24' }]);
      const otherIp = JSON.stringify([{ type: 'host', ip: '10.1.0.5', subnet_cidr: '10.1.0.0/24' }]);
      for (const [name, ips] of [['holder', holdIp], ['other', otherIp]]) {
        await runner.query(
          `INSERT INTO assets (tenant_id, name, kind, environment, location_id, ip_addresses) VALUES ($1, $2, 'vm', 'prod', $3, $4::jsonb)`,
          [tenantId, name, locationId, ips],
        );
      }
      const itOpsSettings: any = {
        serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
        lifecycleStates: [{ code: 'active', label: 'Active' }],
        ipAddressTypes: [{ code: 'host', label: 'Host' }],
        subnets: [
          { location_id: locationId, cidr: '10.1.0.0/24', network_zone: 'lan' },
          { location_id: locationId, cidr: '10.9.0.0/24', network_zone: 'lan', deprecated: true },
        ],
      };
      const csv = [
        'name;location_reference;kind;environment;ip_1_type;ip_1_address;ip_1_subnet_cidr',
        'new one;LOC-1;vm;prod;host;10.9.0.6;10.9.0.0/24',
        'holder;LOC-1;vm;prod;host;10.9.0.5;10.9.0.0/24',
        'other;LOC-1;vm;prod;host;10.9.0.7;10.9.0.0/24',
      ].join('\n');
      const result = await importer.import(assetCsvConfig, file(csv), { dryRun: true, operation: 'upsert' }, {
        manager: runner.manager, tenantId, userId: null, isAdmin: true, itOpsSettings,
      });
      const subnet = result.errors.filter((error: any) => error.column === 'ip_1_subnet_cidr');
      assert.deepEqual(subnet.map((error: any) => [error.row, error.code, error.params]), [
        [2, 'catalog_value_retired', { value: '10.9.0.0/24', allowed: '10.1.0.0/24' }],
        [4, 'catalog_value_retired', { value: '10.9.0.0/24', allowed: '10.1.0.0/24' }],
      ], 'the new asset and the asset that does not hold it are refused');
      assert.deepEqual(result.errors.filter((error: any) => error.row === 3), [], 'the holder repeats its subnet: no error');
    });
  } finally {
    await dataSource.destroy();
  }
  console.log('asset-csv-subnet-catalog.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
