import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { CurrencySettingsService } from '../../../currency/currency-settings.service';
import dataSource from '../../../data-source';
import { BudgetFileService } from '../budget-file.service';
import { seedItem, seedTenant, seedVersion, setTenant } from '../../__tests__/round-inputs.fixtures';

// The loader against the schema. The transaction rolls back, so this writes nothing.
// @database-spec
// Run with DATABASE_URL on appdb_csvcopy, not appdb.

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await seedTenant(runner, 'csv-c2a');
    await setTenant(runner, tenantId);
    const itemId = await seedItem(runner, 'opex', tenantId, 1, 'Widget');
    const versionId = await seedVersion(runner, 'opex', tenantId, itemId, 2026);
    await runner.query(
      `INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, '2026-01-01', 100)`,
      [tenantId, versionId],
    );
    const service = new BudgetFileService({
      getSettings: async () => ({ allowedCurrencies: null, reportingCurrency: 'EUR', defaultSpendCurrency: 'EUR', defaultCapexCurrency: 'EUR' }),
    } as unknown as CurrencySettingsService);
    const caller = { manager: runner.manager, tenantId, userId: null };
    const exported = await service.exportFile('opex', [itemId], caller, {
      language: 'en', amountYears: '2026', columns: 'budget', detail: 'yearly',
    });
    assert.equal(exported.filename, 'opex.csv');
    assert.ok(exported.content.includes('OPX-1'), exported.content);
    assert.ok(exported.content.includes('Widget'));
    assert.ok(exported.content.includes('kanap_token'));
    assert.ok(exported.content.includes('100.00'), exported.content);
    const report = await service.preflight('opex', Buffer.from(exported.content), caller, {
      language: 'en', dateOrder: '', createSuppliers: false, canCreateSuppliers: false,
    });
    assert.equal(report.ok, true, JSON.stringify({ errors: report.errors, file: report.fileErrors, header: report.headerErrors }));
    assert.equal(report.changes.unchanged, 1);
    assert.equal(report.changes.updated, 0);
    assert.equal(report.changes.created, 0);
    assert.equal(report.snapshot.lines.length, 1);
    assert.equal(report.snapshot.lines[0].id, itemId);
    console.log('budget-file.integration.spec: ok');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
