import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import dataSource from '../../data-source';
import { SpendItemsCsvService } from '../spend-items-csv.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { ItemNumberService } from '../../common/item-number.service';

// The OPEX and CAPEX sample files in doc/samples pass the importers: a dry run
// in an empty tenant (with the company the CAPEX sample names) has no error.

const SAMPLES = join(__dirname, '..', '..', '..', '..', 'doc', 'samples');
const noAudit = { log: async () => undefined };
const noFreeze = { assertNotFrozen: async () => undefined };

function opexImporter(): any {
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[7] = noAudit;
  args[8] = noFreeze;
  args[9] = { getSettings: async () => ({ allowedCurrencies: null }) };
  args[10] = new ItemNumberService();
  return new (SpendItemsCsvService as any)(...args);
}

function capexImporter(): any {
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[5] = noAudit;
  args[6] = noFreeze;
  args[7] = { resolveRates: async () => ({ map: new Map(), settings: { allowedCurrencies: null } }) };
  args[9] = { syncFromSupplier: async () => undefined };
  args[10] = new ItemNumberService();
  return new (CapexItemsService as any)(...args);
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Sample files test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `samples-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Acme Corp', 'FR', 'Lyon')`, [tenantId]);

    for (const [file, importer] of [['opex.csv', opexImporter()], ['spend_items.csv', opexImporter()], ['capex.csv', capexImporter()]] as const) {
      const buffer = readFileSync(join(SAMPLES, file));
      const result = await importer.importCsv({ file: { buffer }, dryRun: true, userId: null }, { manager: runner.manager });
      assert.deepEqual(result.errors, [], `doc/samples/${file}: no import error`);
      assert.equal(result.ok, true, `doc/samples/${file}: accepted`);
      const rows = buffer.toString('utf8').trim().split('\n').length - 1;
      assert.equal(result.total, rows, `doc/samples/${file}: ${rows} row(s) read`);
      console.log(`doc/samples/${file}: dry run ok, ${result.total} row(s)`);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('csv-samples.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
