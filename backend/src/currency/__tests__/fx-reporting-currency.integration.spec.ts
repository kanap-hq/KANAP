import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import * as engine from '../../spend/budget-list/budget-list.service';
import { realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import {
  assert,
  inRolledBackTransaction,
  runSpecs,
  seedItem,
  seedMonths,
  seedTenant,
  seedVersion,
} from '../../spend/__tests__/round-inputs.fixtures';

// A frozen year keeps the rates of its freeze. After the reporting currency
// changes, the budget list converts that result at the live rate of the old
// base. Switching back restores the figures from before the change.
// @database-spec: opens the data-source. Run it on a dedicated database, never appdb.

const Y = new Date().getFullYear();
const scope = SUMMARY_SCOPES.opex;
const deps = realSummaryDeps(scope);

async function setReporting(runner: QueryRunner, tenantId: string, code: string) {
  await runner.query(
    `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [tenantId, JSON.stringify({ reporting_currency: code })],
  );
}

const tests: Array<[string, () => Promise<void>]> = [
  ['a frozen year converts at the live rate of its old base and returns to the same total', () => inRolledBackTransaction(async (runner) => {
    const [{ current }] = await runner.query(`SELECT current_database() AS current`);
    assert.notEqual(current, 'appdb', 'this spec must not write the dev database');
    const tenantId = await seedTenant(runner, 'fx-cross');
    await runner.query(
      `INSERT INTO currencies (code, name) VALUES ('EUR', 'Euro'), ('USD', 'US dollar'), ('CHF', 'Swiss franc')
       ON CONFLICT (code) DO NOTHING`,
    );
    const [pinned] = await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, captured_at)
       VALUES ($1, $2, 'EUR', $3::jsonb, now() - interval '1 year') RETURNING id`,
      [tenantId, Y, JSON.stringify({ USD: 0.5, CHF: 4 })],
    );
    // A newer EUR set must not replace the pin, before the change or after the switch back.
    await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates)
       VALUES ($1, $2, 'EUR', $3::jsonb)`,
      [tenantId, Y, JSON.stringify({ USD: 0.9, CHF: 1.1 })],
    );
    await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates)
       VALUES ($1, $2, 'CHF', $3::jsonb)`,
      [tenantId, Y, JSON.stringify({ EUR: 0.5 })],
    );

    let number = 0;
    const line = async (name: string, currency: string, planned: number) => {
      number += 1;
      const itemId = await seedItem(runner, 'opex', tenantId, number, name);
      await runner.query(`UPDATE spend_items SET currency = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, itemId, currency]);
      const versionId = await seedVersion(runner, 'opex', tenantId, itemId, Y);
      await runner.query(`UPDATE spend_versions SET fx_rate_set_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, versionId, pinned.id]);
      await seedMonths(runner, 'opex', tenantId, versionId, Y, { planned: [planned, ...Array(11).fill(0)] });
    };
    await line('Euro line', 'EUR', 1000);
    await line('Dollar line', 'USD', 400);
    await line('Franc line', 'CHF', 100);

    // 1000 + 400 × 0.5 + 100 × 4. The newer EUR set (USD 0.9) does not apply.
    const before = await engine.budgetListTotals(scope, deps, { includeDisabled: 'true', amounts: 'yBudget' }, runner.manager);
    assert.equal(before.reportingCurrency, 'EUR');
    assert.equal(before.yBudget, 1600);
    assert.deepEqual(before.fxMissing, []);

    await setReporting(runner, tenantId, 'CHF');
    const switched = await engine.budgetListTotals(scope, deps, { includeDisabled: 'true', amounts: 'yBudget' }, runner.manager);
    assert.equal(switched.reportingCurrency, 'CHF');
    // 1600 × 0.5, the live EUR→CHF rate: 1000 × 0.5 + 400 × 0.5 × 0.5 + 100 × 4 × 0.5.
    assert.equal(switched.yBudget, 800);
    assert.deepEqual(switched.fxMissing, []);

    await setReporting(runner, tenantId, 'EUR');
    const back = await engine.budgetListTotals(scope, deps, { includeDisabled: 'true', amounts: 'yBudget' }, runner.manager);
    assert.equal(back.reportingCurrency, 'EUR');
    assert.equal(back.yBudget, before.yBudget);
    assert.deepEqual(back.fxMissing, []);
  })],
];

runSpecs('fx-reporting-currency.integration.spec', tests).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
