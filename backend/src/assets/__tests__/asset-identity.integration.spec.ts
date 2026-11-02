import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import dataSource from '../../data-source';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Asset } from '../asset.entity';
import { AssetsCsvService } from '../assets-csv.service';
import { AssetsListService } from '../services/assets-list.service';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsValidationService } from '../services/assets-validation.service';

// A name or a FQDN another asset of the tenant already carries is a 409, on create and on change.
// Comparison ignores case and the spaces around the value. A duplicate that is already stored
// stays editable while that value does not change. The CSV import reports the same codes as row
// errors. There is no database constraint.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const settings = {
  serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
  serverProviders: [{ code: 'other', label: 'Other' }],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  domains: [
    { code: 'corp', label: 'Corporate', dns_suffix: 'example.com' },
    { code: 'workgroup', label: 'Workgroup', dns_suffix: '' },
  ],
  adminZones: [],
  ipAddressTypes: [{ code: 'host', label: 'Host' }],
  subnets: [],
};

function file(content: string): Express.Multer.File {
  const text = '﻿' + content;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'import.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

async function conflict(run: () => Promise<unknown>): Promise<{ code: string; params: { ref: string; name?: string; fqdn?: string } }> {
  try {
    await run();
  } catch (err) {
    assert.ok(err instanceof ConflictException, String(err));
    assert.equal(err.getStatus(), 409);
    return err.getResponse() as { code: string; params: { ref: string } };
  }
  assert.fail('expected a 409');
}

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-identity');
      const itOps = { getSettingsForWrite: async () => settings, getSettings: async () => settings } as any;
      const crud = new AssetsCrudService(
        runner.manager.getRepository(Asset),
        {} as any,
        { log: async () => undefined } as any,
        new AssetsValidationService(itOps),
        {} as any,
        { labelOf: async () => null } as any,
      );
      const csv = new AssetsCsvService(
        runner.manager.getRepository(Asset),
        {} as any,
        new CsvImportService(new CsvResolverService(), new CsvJsonValidators()),
        itOps,
        { labelsOf: async () => new Map() } as any,
        new AssetsListService(runner.manager.getRepository(Asset)),
      );
      const opts = { manager: runner.manager, tenantId };
      const siteId = randomUUID();
      await runner.query(`INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-0', 'Site', 'on_prem')`, [siteId, tenantId]);
      const create = (name: string, hostname: string | null, domain: string | null = 'corp') => crud.create(
        { name, kind: 'vm', provider: 'other', environment: 'prod', hostname, domain, location_id: siteId } as any,
        tenantId,
        null,
        opts,
      );

      const first = await create('NYC-SW-01', 'nyc-sw-01');
      const [storedFirst] = await runner.query(`SELECT asset_reference, fqdn FROM assets WHERE id = $1`, [first.id]);
      assert.match(storedFirst.asset_reference, /^AST-\d+$/);
      first.asset_reference = storedFirst.asset_reference;
      const taken = await conflict(() => create('  nyc-sw-01  ', 'other-host'));
      assert.equal(taken.code, 'asset_name_taken');
      assert.equal(taken.params.ref, first.asset_reference);
      assert.equal(taken.params.name, 'NYC-SW-01');

      const fqdn = await conflict(() => create('Other switch', 'NYC-SW-01', 'corp'));
      assert.equal(fqdn.code, 'asset_fqdn_taken');
      assert.equal(fqdn.params.ref, first.asset_reference);
      assert.equal(fqdn.params.fqdn, 'nyc-sw-01.example.com');

      const second = await create('Other switch', 'other-switch');
      const renamedHost = await conflict(() => crud.update(second.id, { hostname: 'nyc-sw-01' } as any, tenantId, null, opts));
      assert.equal(renamedHost.code, 'asset_fqdn_taken');
      await crud.update(second.id, { hostname: 'OTHER-SWITCH' } as any, tenantId, null, opts);
      const [sameFqdn] = await runner.query(`SELECT fqdn FROM assets WHERE id = $1`, [second.id]);
      assert.equal(sameFqdn.fqdn, 'other-switch.example.com');

      const bare = await create('No host', null, null);
      const alsoBare = await create('No host either', null, null);
      assert.equal(bare.fqdn, null);
      assert.equal(alsoBare.fqdn, null);

      await runner.query(
        `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, hostname, domain, fqdn)
         VALUES ($1, 'NYC-SW-01', 'vm', 'other', 'prod', 'active', 'dup-host', 'corp', 'dup-host.example.com')`,
        [tenantId],
      );
      const [dup] = await runner.query(
        `SELECT id, asset_reference FROM assets WHERE tenant_id = $1 AND hostname = 'dup-host'`,
        [tenantId],
      );
      const kept = await crud.update(dup.id, { notes: 'still shared' } as any, tenantId, null, opts);
      assert.equal(kept.name, 'NYC-SW-01');
      assert.equal(kept.notes, 'still shared');
      const renamed = await conflict(() => crud.update(second.id, { name: 'nyc-sw-01' } as any, tenantId, null, opts));
      assert.equal(renamed.code, 'asset_name_taken');
      assert.match(renamed.params.ref, /^AST-\d+$/);

      await runner.query(
        `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-1', 'Paris', 'on_prem')`,
        [randomUUID(), tenantId],
      );
      const params = { dryRun: true, mode: 'enrich' as const, operation: 'upsert' as const };
      const duplicateHost = await csv.import(
        file('name;location_reference;kind;environment;hostname;domain\nBrand new;LOC-1;vm;prod;nyc-sw-01;corp'),
        params,
        opts,
      );
      assert.equal(duplicateHost.ok, false);
      assert.deepEqual(duplicateHost.errors.map((error) => [error.column, error.code, error.params?.ref]), [
        ['hostname', 'asset_fqdn_taken', first.asset_reference],
      ]);

      const rename = await csv.import(
        file(`id;name;location_reference;kind;environment\n${second.id};NYC-SW-01;LOC-1;vm;prod`),
        params,
        opts,
      );
      assert.equal(rename.ok, false);
      const nameHolders = await runner.query(
        `SELECT asset_reference FROM assets WHERE tenant_id = $1 AND lower(btrim(name)) = 'nyc-sw-01'`,
        [tenantId],
      );
      assert.ok(nameHolders.some((row: { asset_reference: string }) => row.asset_reference === rename.errors.find((error) => error.code === 'asset_name_taken')?.params?.ref));

      const pair = await csv.import(
        file('name;location_reference;kind;environment;hostname;domain\nAlpha;LOC-1;vm;prod;shared;corp\nBeta;LOC-1;vm;prod;shared;Corporate'),
        params,
        opts,
      );
      assert.deepEqual(pair.errors.map((error) => [error.row, error.code]), [[3, 'asset_fqdn_taken']]);

      const touched = await csv.import(
        file('name;location_reference;kind;environment;notes\nNYC-SW-01;LOC-1;vm;prod;from csv'),
        { ...params, dryRun: false },
        opts,
      );
      assert.equal(touched.ok, true, JSON.stringify(touched.errors));
      const notes = await runner.query(
        `SELECT notes FROM assets WHERE tenant_id = $1 AND lower(btrim(name)) = 'nyc-sw-01'`,
        [tenantId],
      );
      assert.equal(notes.length, 2);
      assert.equal(notes.filter((row: { notes: string | null }) => row.notes === 'from csv').length, 1);
    });
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('asset identity integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
