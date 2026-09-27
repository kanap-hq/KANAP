import 'dotenv/config';
import dataSource from '../../data-source';
import { SpendItemsService } from '../spend-items.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import {
  assert,
  inRolledBackTransaction,
  Kind,
  repeat,
  runSpecs,
  seedLine,
  seedTenant,
} from './round-inputs.fixtures';

// The yearly totals of one item (trend chart) carry the five columns,
// Forecast included, and only the current tenant's rows.

const YEAR = 2031;

function yearlyTotals(kind: Kind) {
  // The method only needs the manager it is given.
  const svc = Object.create((kind === 'opex' ? SpendItemsService : CapexItemsService).prototype);
  return (itemId: string, manager: any) => svc.yearlyTotals(itemId, YEAR, YEAR + 1, { manager });
}

async function testYearlyTotals(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-yearly`);
    const { itemId } = await seedLine(runner, kind, tenantId, YEAR, {
      planned: repeat('10', 12), committed: repeat('2', 12), forecast: repeat('7', 12), actual: repeat('1', 12), expected_landing: repeat('3', 12),
    });
    const result = await yearlyTotals(kind)(itemId, runner.manager);
    assert.deepEqual(result.items, [
      { year: YEAR, budget: 120, revision: 24, forecast: 84, actual: 12, landing: 36 },
      { year: YEAR + 1, budget: 0, revision: 0, forecast: 0, actual: 0, landing: 0 },
    ], `${kind}: five columns per year`);

    // Another tenant in the session sees nothing of this item.
    await seedTenant(runner, `${kind}-yearly-other`);
    const other = await yearlyTotals(kind)(itemId, runner.manager);
    assert.equal(other.items[0].budget, 0, `${kind}: another tenant reads zeros`);
  });
}

void runSpecs('yearly-totals.integration.spec', [
  ['testYearlyTotals(opex)', () => testYearlyTotals('opex')],
  ['testYearlyTotals(capex)', () => testYearlyTotals('capex')],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
