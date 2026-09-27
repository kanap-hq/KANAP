import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { FreezeService } from '../freeze.service';
import {
  assert,
  inRolledBackTransaction,
  runSpecs,
  seedLine,
  seedTenant,
  setBudgetColumns,
} from '../../spend/__tests__/round-inputs.fixtures';

// Freezing the tenant's default column pins the year's FX rate set on the
// versions of that year and scope; unfreezing it unpins. Other columns do not.

const YEAR = 2031;

async function pinnedRateSet(runner: QueryRunner, versionId: string, table = 'spend_versions'): Promise<string | null> {
  const [row] = await runner.query(`SELECT fx_rate_set_id FROM ${table} WHERE id = $1`, [versionId]);
  return row.fx_rate_set_id;
}

async function testDefaultColumnPinsFx() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'fx-pin');
    await setBudgetColumns(runner, tenantId, { default_column: 'committed' });
    const opex = await seedLine(runner, 'opex', tenantId, YEAR);
    const capex = await seedLine(runner, 'capex', tenantId, YEAR);
    const [{ id: rateSetId }] = await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', '{}'::jsonb) RETURNING id`,
      [tenantId, YEAR],
    );
    const refreshed: number[] = [];
    const freeze = new FreezeService(
      undefined as any,
      { refreshTenant: async (_tenant: string, year: number) => { refreshed.push(year); } } as any,
      { getLatestRateSet: async () => ({ id: rateSetId }) } as any,
      { getSettings: async () => ({ reportingCurrency: 'EUR' }) } as any,
    );
    const opts = { manager: runner.manager };

    await freeze.freeze(YEAR, [{ scope: 'opex', columns: ['budget'] }], null, opts);
    assert.equal(await pinnedRateSet(runner, opex.versionId), null, 'Budget is not the default column: no pin');
    assert.deepEqual(refreshed, []);

    await freeze.freeze(YEAR, [{ scope: 'opex', columns: ['revision'] }], null, opts);
    assert.equal(await pinnedRateSet(runner, opex.versionId), rateSetId, 'freezing the default column pins the rate set');
    assert.equal(await pinnedRateSet(runner, capex.versionId, 'capex_versions'), null, 'only the frozen scope is pinned');
    assert.deepEqual(refreshed, [YEAR]);

    await freeze.unfreeze(YEAR, [{ scope: 'opex', columns: ['budget'] }], null, opts);
    assert.equal(await pinnedRateSet(runner, opex.versionId), rateSetId, 'unfreezing another column keeps the pin');
    await freeze.unfreeze(YEAR, [{ scope: 'opex', columns: ['revision'] }], null, opts);
    assert.equal(await pinnedRateSet(runner, opex.versionId), null, 'unfreezing the default column unpins');

    // Freezing every column includes the default one.
    await freeze.freeze(YEAR, [{ scope: 'capex' }], null, opts);
    assert.equal(await pinnedRateSet(runner, capex.versionId, 'capex_versions'), rateSetId);
  });
}

void runSpecs('freeze-fx-pin.integration.spec', [
  ['testDefaultColumnPinsFx', testDefaultColumnPinsFx],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
