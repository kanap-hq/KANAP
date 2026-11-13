import 'dotenv/config';
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, withRace } from '../../spend/__tests__/race-harness';
import { Asset } from '../asset.entity';
import { lockAssetNames } from '../asset-rules';
import { AssetsCsvService } from '../assets-csv.service';

// The tenant row lock of the asset CSV import (lot F2 of 26.11.8, review fixes): FOR NO KEY UPDATE,
// as the settings save and the classification catalog. It still excludes a settings save and the
// share lock every asset writer takes first (`lockAssetNames`), and leaves alone the foreign key
// checks of the tenant's other tables: an unrelated insert of the tenant does not wait for an import.

function settings(manager: EntityManager) {
  return new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), new AuditService(manager.getRepository(AuditLog)));
}

function importAssets(manager: EntityManager, tenantId: string) {
  const csv = new AssetsCsvService(
    manager.getRepository(Asset), null as any, new CsvImportService(new CsvResolverService(), new CsvJsonValidators()), settings(manager), null as any, null as any,
  );
  const text = '﻿name;kind;environment\nRace asset;vm;prod';
  const file = { buffer: Buffer.from(text, 'utf8'), originalname: 'assets.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
  return csv.import(file, { dryRun: true, mode: 'enrich', operation: 'upsert' }, { manager, tenantId, userId: null });
}

async function tenantInsertsDoNotWaitForAnImport() {
  await withRace('assets-csv-tenant', async (race) => {
    const importer = await race.open('asset import');
    const other = await race.open('another person of the tenant');
    const saver = await race.open('a settings save');
    const writer = await race.open('an asset writer');
    const holds = race.gate(importer, { label: 'lock the tenant row', when: 'after', match: (text) => /FROM tenants WHERE id = \$1 FOR (NO KEY )?UPDATE/.test(text) });
    const importWork = race.start(importer, (manager) => importAssets(manager, race.tenantId));
    assert.equal(await progress(importWork, { party: importer, gate: holds }), 'gated', 'harness: the import must pause holding the tenant row');

    const insert = race.start(other, (manager) => manager.query(
      `INSERT INTO list_contexts (tenant_id, id, list_key, state) VALUES ($1, $2, '/assets', '{}'::jsonb)`,
      [race.tenantId, randomBytes(16).toString('base64url').slice(0, 22)],
    ));
    assert.equal(await progress(insert, { party: other }), 'settled', 'an insert of the tenant does not wait for the import');
    assertSucceeded(await settle(insert), 'the insert');

    const save = race.start(saver, (manager) => settings(manager).updateSettings(race.tenantId, {}, { manager }));
    assert.equal(await progress(save, { party: saver }), 'blocked', 'a settings save waits for the import');
    const assetWrite = race.start(writer, (manager) => lockAssetNames(manager, race.tenantId));
    assert.equal(await progress(assetWrite, { party: writer }), 'blocked', 'an asset writer waits for the import');

    holds.release();
    assertSucceeded(await settle(importWork), 'the import');
    assertSucceeded(await settle(save), 'the settings save');
    assertSucceeded(await settle(assetWrite), 'the asset writer');
  });
}

void runRaceSpecs('Asset CSV import tenant lock', [
  ['an insert of the tenant does not wait for an asset import; a settings save and an asset writer do', tenantInsertsDoNotWaitForAnImport],
]);
