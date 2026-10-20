import * as assert from 'node:assert/strict';
import {
  MANUAL_RATE_CURRENCY_CODE,
  MANUAL_RATE_CURRENCY_MESSAGE,
  ManualRatesService,
} from '../manual-rates.service';

/**
 * The impact of a reporting-currency change: manual rates of the current base,
 * frozen versions by year, and whether the new code joins the allowed list.
 */

function service(allowed: string[] | null) {
  const settings = {
    getSettings: async () => ({
      reportingCurrency: 'EUR',
      defaultSpendCurrency: 'EUR',
      defaultCapexCurrency: 'EUR',
      allowedCurrencies: allowed,
    }),
  };
  const manager = {
    query: async (sql: string) => {
      if (sql.includes('currency_rate_sets')) {
        return [{
          fiscal_year: 2024,
          rates: { EUR: 1, USD: 1.7, GBP: 0.85, XPF: null },
          rate_sources: { EUR: 'identity', USD: 'manual', GBP: 'world-bank-annual', XPF: 'manual' },
        }];
      }
      if (sql.includes('spend_versions')) return [{ year: 2023, count: 1 }, { year: 2024, count: 2 }];
      return [];
    },
  };
  return {
    service: new ManualRatesService(settings as any, {} as any, {} as any, {} as any),
    manager,
  };
}

async function testImpactListsManualRatesOfTheCurrentBase() {
  const { service: rates, manager } = service(['EUR', 'USD']);
  const impact = await rates.reportingChangeImpact('tenant-1', 'chf', manager as any);
  assert.deepEqual(impact, {
    manualRates: [{ currency: 'USD', year: 2024, rate: 1.7 }],
    frozenVersions: [{ year: 2023, count: 1 }, { year: 2024, count: 2 }],
    allowedAdded: true,
  });
  const already = await rates.reportingChangeImpact('tenant-1', 'USD', manager as any);
  assert.equal(already.allowedAdded, false);
  assert.deepEqual(already.manualRates, impact.manualRates);
  console.log('ok - the impact names manual rates of the current base, frozen versions, and a currency the allowed list will gain');
}

async function testUnrestrictedListAddsNothing() {
  const { service: rates, manager } = service(null);
  const impact = await rates.reportingChangeImpact('tenant-1', 'CHF', manager as any);
  assert.equal(impact.allowedAdded, false);
  console.log('ok - an unrestricted currency list adds nothing');
}

async function testUnknownCodeIsRejected() {
  const { service: rates, manager } = service(null);
  await assert.rejects(
    () => rates.reportingChangeImpact('tenant-1', 'ZZZ', manager as any),
    (error: any) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().code, MANUAL_RATE_CURRENCY_CODE);
      assert.equal(error.getResponse().message, MANUAL_RATE_CURRENCY_MESSAGE);
      return true;
    },
  );
  console.log('ok - a code outside the ISO list is rejected');
}

(async () => {
  await testImpactListsManualRatesOfTheCurrentBase();
  await testUnrestrictedListAddsNothing();
  await testUnknownCodeIsRejected();
  console.log('fx-reporting-impact.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
