import * as assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';
import { loadBudgetRuntime, mergeNeeds } from '../budget-list.runtime';
import { budgetRuntimeNeeds } from '../budget-list.config';
import { checksNamedByFilter } from '../../budget-line-checks';

/**
 * `loadBudgetRuntime` reads on the request's transaction manager, one connection: no two of its
 * statements may be in flight at once (`pg` warns and queues them). A fake manager counts them;
 * the FX table and every pre-read are asked for, so each branch runs.
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const SCOPE = { scope: 'opex', itemTable: 'spend_items', nature: 'opex' } as any;

function managerStub() {
  const seen: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const manager = {
    query: async (sql: string) => {
      seen.push(sql);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Let a second caller start if one is launched: a concurrent query would then be seen.
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        if (sql.includes('FROM spend_items i')) return [{ raw: 'EUR', cur: 'EUR' }];
        if (sql.includes('currency_rate_sets')) return [];
        if (sql.includes('FROM analytics_axes')) return [{ id: 'axis-1', is_default: true, applies_to: null }];
        if (sql.includes('FROM cost_centers cc')) return [];
        if (sql.includes('FROM allocation_rules')) return [];
        throw new Error(`Unexpected statement: ${sql}`);
      } finally {
        inFlight -= 1;
      }
    },
  } as unknown as EntityManager;
  return { manager, seen, peak: () => peak };
}

/**
 * `to_check` (D12): a statement whose only use of the field is a filter on some checks evaluates
 * those alone, and loads the quantity and price settings only when that check is among them.
 */
async function testChecksNeeded() {
  const set = (values: unknown[], extra: Record<string, unknown> = {}) => ({ filterType: 'set', values, ...extra });
  assert.deepEqual(checksNamedByFilter(set(['coa_mismatch'])), ['coa_mismatch']);
  assert.deepEqual(checksNamedByFilter(set(['coa_mismatch', 'quantity_price'])), ['quantity_price', 'coa_mismatch'], 'in the table\'s order');
  assert.deepEqual(checksNamedByFilter(set([])), [], 'no box: no check');
  for (const model of [set([null]), set(['coa_mismatch', null]), set(['coa_mismatch'], { mode: 'exclude' }), set(['other']),
    { filterType: 'text', type: 'contains', filter: 'coa' }, { operator: 'OR', conditions: [set(['coa_mismatch'])] }, null, 'coa_mismatch']) {
    assert.equal(checksNamedByFilter(model), null, `every check for ${JSON.stringify(model)}`);
  }
  const filters = { to_check: set(['coa_mismatch']) };
  assert.deepEqual(budgetRuntimeNeeds(2026, ['product_name', 'to_check'], false, filters).checks, ['coa_mismatch'], 'the filter alone: its check');
  assert.deepEqual(budgetRuntimeNeeds(2026, ['to_check', 'to_check'], false, filters).checks, ['quantity_price', 'coa_mismatch'], 'sorted on it too: every check');
  assert.deepEqual(budgetRuntimeNeeds(2026, ['to_check'], false).checks, ['quantity_price', 'coa_mismatch'], 'no filter on it: every check');
  assert.equal(budgetRuntimeNeeds(2026, ['product_name'], false, filters).checks, undefined, 'the field not read: nothing');
  assert.deepEqual(mergeNeeds(budgetRuntimeNeeds(2026, ['to_check'], false, filters), budgetRuntimeNeeds(2026, ['to_check'], false)).checks,
    ['quantity_price', 'coa_mismatch'], 'merged with the filter values of the field: every check');

  const fxRates = {} as any;
  const coaOnly = managerStub();
  const runtime = await loadBudgetRuntime(SCOPE, { fxRates }, coaOnly.manager, TENANT, 2026, { checks: ['coa_mismatch'] });
  assert.deepEqual(runtime.checks, ['coa_mismatch']);
  assert.equal(runtime.entryCheck, undefined, 'the quantity and price settings are not read');
  assert.equal(coaOnly.seen.length, 0);
}

async function run() {
  await testChecksNeeded();
  const { manager, seen, peak } = managerStub();
  const fxRates = {
    resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
    convertValue: (value: number) => value,
  } as any;
  const runtime = await loadBudgetRuntime(
    SCOPE,
    { fxRates },
    manager,
    TENANT,
    2026,
    { fxYears: [2026], axes: true, costCenters: true, ruleYears: [2026] },
    { accounts: true },
  );
  assert.equal(peak(), 1, `one statement at a time (${seen.length} statements)`);
  assert.equal(seen.length, 5, 'the two FX reads and the three pre-reads all ran');
  assert.ok(runtime.fx, 'the FX table is there');
  assert.deepEqual(runtime.axes, { ids: ['axis-1'], defaultAxisId: 'axis-1', appliesTo: [null] });
  assert.deepEqual(runtime.costCenters, []);
  assert.ok(runtime.ruleLabels?.has(2026), 'the allocation label is there');
  assert.equal(runtime.canReadAccounts, true);

  // A runtime that needs nothing reads nothing.
  const quiet = managerStub();
  await loadBudgetRuntime(SCOPE, { fxRates }, quiet.manager, TENANT, 2026, {});
  assert.equal(quiet.seen.length, 0);
  console.log('budget-list.runtime.spec: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
