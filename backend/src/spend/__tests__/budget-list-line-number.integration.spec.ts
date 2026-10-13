import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { budgetListAggregate } from '../budget-list/budget-list.service';
import { SUMMARY_SCOPES } from '../spend-summary.builder';
import { realSummaryDeps } from './oracle/oracle-deps';
import { assert, inRolledBackTransaction, runSpecs, seedItem, seedTenant } from './round-inputs.fixtures';

// `line_number`, the field the reports of one nature group a line on (lot OPS): the line's own number, its
// BL-n reference, in every scope. Through the CAPEX routes `item_number` is the CPX number, so a report of
// CAPEX lines that linked `BL-<item_number>` would open another line.

type Scope = 'opex' | 'capex' | 'all';

async function numbers(runner: QueryRunner, scope: Scope) {
  const config = SUMMARY_SCOPES[scope];
  const answer = await budgetListAggregate(
    config,
    realSummaryDeps(SUMMARY_SCOPES.opex),
    {},
    { groupBy: ['id', 'item_number', 'line_number'], measures: [] },
    runner.manager,
  );
  return Object.fromEntries(answer.groups.map((group) => [String(group.keys[0]), [String(group.keys[1]), String(group.keys[2])]]));
}

async function testLineNumberInEveryScope() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'line-number');
    // OPEX BL-3; CAPEX BL-500001 whose CPX number is 1 (`seedItem`: legacy_number CPX-1).
    const opex = await seedItem(runner, 'opex', tenantId, 3, 'Licences');
    const capex = await seedItem(runner, 'capex', tenantId, 1, 'Servers');

    assert.deepEqual(await numbers(runner, 'capex'), { [capex]: ['1', '500001'] }, 'CAPEX: item_number is the CPX number, line_number the BL number');
    assert.deepEqual(await numbers(runner, 'opex'), { [opex]: ['3', '3'] }, 'OPEX: both are the BL number');
    assert.deepEqual(
      await numbers(runner, 'all'),
      { [opex]: ['3', '3'], [capex]: ['500001', '500001'] },
      'all lines: both are the BL number',
    );
  });
}

void runSpecs('budget-list-line-number.integration.spec', [
  ['line_number is the BL number in the CAPEX, OPEX and all scopes', testLineNumberInEveryScope],
]);
