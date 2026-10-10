import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import { CapexItemsService } from '../spend-items.service';
import {
  inRolledBackTransaction,
  repeat,
  seedItem,
  seedMonths,
  seedTenant,
  seedVersion,
} from '../../spend/__tests__/round-inputs.fixtures';

// The CAPEX summary accepts `years` like OPEX: the requested years add to the
// fixed window (Y-2..Y+2), every year read gets a `y<year>` slot (same shape
// as the fixed ones, five totals each), the fixed slots are unchanged.

const identityFx = {
  resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
  convertValue: (amount: number, rate: number) => amount * rate,
};
const noAllocations = { computeForVersions: async () => new Map() };

function capexItems(): { summary: (...args: any[]) => Promise<any> } {
  // The constructor of the OPEX twin since lot Z1 (`spend-items.service.ts`).
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[4] = noAllocations;
  args[6] = identityFx;
  return new (CapexItemsService as any)(...args);
}

async function testRequestedYearsGetSlots() {
  await inRolledBackTransaction(async (runner) => {
    const Y = new Date().getFullYear();
    const [later, afterThat] = [Y + 3, Y + 4];
    const tenantId = await seedTenant(runner, 'capex-years');
    const itemId = await seedItem(runner, 'capex', tenantId, 1);
    const current = await seedVersion(runner, 'capex', tenantId, itemId, Y);
    await seedMonths(runner, 'capex', tenantId, current, Y, { planned: repeat('10', 12) });
    const first = await seedVersion(runner, 'capex', tenantId, itemId, later);
    await seedMonths(runner, 'capex', tenantId, first, later, { planned: repeat('100', 12), committed: repeat('0.10', 12) });
    const second = await seedVersion(runner, 'capex', tenantId, itemId, afterThat);
    await seedMonths(runner, 'capex', tenantId, second, afterThat, { committed: repeat('50', 12) });

    const svc = capexItems();
    const plain = (await svc.summary({}, { manager: runner.manager })).items[0];
    const withYears = (await svc.summary({ years: `${later},${afterThat},abc,0999` }, { manager: runner.manager })).items[0];

    const fixedKeys = ['yMinus2', 'yMinus1', 'y', 'yPlus1', 'yPlus2'];
    const windowKeys = [Y - 2, Y - 1, Y, Y + 1, Y + 2].map((year) => `y${year}`);
    for (const key of [...fixedKeys, ...windowKeys]) {
      assert.deepEqual(withYears.versions[key], plain.versions[key], `slot ${key} unchanged`);
    }
    assert.equal(withYears.versions.y.totals.budget, 120, 'the current year is still read');
    assert.deepEqual(withYears.versions[`y${Y}`], withYears.versions.y, 'the current year reads the same under both keys');
    assert.deepEqual(
      Object.keys(withYears.versions),
      [...fixedKeys, ...windowKeys, `y${later}`, `y${afterThat}`],
      'one slot per valid requested year, nothing for invalid entries',
    );
    assert.deepEqual(withYears.versions[`y${later}`].totals, { budget: 1200, revision: 1.2, forecast: 0, follow_up: 0, landing: 0 });
    assert.equal(withYears.versions[`y${later}`].year, later);
    assert.equal(withYears.versions[`y${later}`].version_id, first);
    assert.equal(withYears.versions[`y${later}`].reporting.budget, 1200, 'the slot carries reporting totals like the fixed ones');
    assert.deepEqual(withYears.versions[`y${afterThat}`].totals, { budget: 0, revision: 600, forecast: 0, follow_up: 0, landing: 0 });
    assert.deepEqual(Object.keys(plain.versions), [...fixedKeys, ...windowKeys], 'without years, the fixed window only');

    // A requested year without a version reads as the fixed slots do.
    const empty = (await svc.summary({ years: String(Y + 6) }, { manager: runner.manager })).items[0];
    assert.deepEqual(empty.versions[`y${Y + 6}`].totals, { budget: 0, revision: 0, forecast: 0, follow_up: 0, landing: 0 });
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testRequestedYearsGetSlots();
  } finally {
    await dataSource.destroy();
  }
  console.log('capex-summary-years.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
