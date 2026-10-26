import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CurrencyController } from '../currency.controller';

/**
 * Saving the settings never waits for the fetch: it saves (currency rows in the
 * request transaction), queues the refresh to start after the response and
 * after the follow-up has read the pairs already stored, and answers the
 * settings with the years queued. A reporting currency outside the ISO list is
 * refused before any read or write.
 */

type Settings = {
  reportingCurrency: string;
  defaultSpendCurrency: string;
  defaultCapexCurrency: string;
  allowedCurrencies: string[] | null;
};

function settings(reportingCurrency: string): Settings {
  return {
    reportingCurrency,
    defaultSpendCurrency: 'EUR',
    defaultCapexCurrency: 'EUR',
    allowedCurrencies: null,
  };
}

function harness(opts: { before: string; after: string }) {
  const order: string[] = [];
  const ensured: string[][] = [];
  const queued: Array<{ years: number[]; opts: any }> = [];
  const years = [2019, 2024, 2025, 2026, 2027, 2028];
  let releaseSnapshot: () => void = () => undefined;
  const snapshotHold = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
  const currency = {
    getSettings: async () => {
      order.push('read');
      return settings(opts.before);
    },
    updateSettings: async () => {
      order.push('update');
      return settings(opts.after);
    },
    ensureCurrencyRecords: async (codes: Iterable<string>) => {
      order.push('ensure');
      ensured.push(Array.from(codes));
    },
  };
  const fxIngestion = {
    holdForRateSnapshot: () => snapshotHold,
    queueManualRefresh: async (_tenantId: string, calledYears: number[], callOpts: any) => {
      order.push('queue');
      queued.push({ years: calledYears, opts: callOpts });
      return 'queued';
    },
    refreshWithin: async () => {
      throw new Error('the save does not wait for the fetch');
    },
    refreshTenant: async () => {
      throw new Error('the save does not fetch in the request');
    },
  };
  const manualRates = {
    reportingChangeYears: async () => years,
  };
  const manager = { query: async () => [] };
  const api = new CurrencyController(currency as any, fxIngestion as any, manualRates as any, { manager } as any);
  const res = new EventEmitter() as EventEmitter & { writableFinished?: boolean };
  const req = { tenant: { id: 'tenant-1' }, user: { sub: null }, queryRunner: { manager }, res };
  return { api, req, res, order, ensured, queued, years, releaseSnapshot };
}

async function testUnchangedReportingCurrencyQueuesTheCurrentYear() {
  const { api, req, order, ensured, queued } = harness({ before: 'EUR', after: 'EUR' });
  const saved = await api.updateSettings({ defaultSpendCurrency: 'USD' }, req);
  assert.equal(saved.reportingCurrency, 'EUR');
  assert.deepEqual(saved.refreshYears, [new Date().getFullYear()]);
  assert.deepEqual(ensured, [], 'no insert outside the settings save');
  assert.deepEqual(order, ['read', 'update', 'queue']);
  assert.deepEqual(queued[0].years, [new Date().getFullYear()]);
  assert.equal(queued[0].opts.label, 'currency-settings');
  console.log('ok - a save that keeps the reporting currency queues the current year and answers at once');
}

async function testChangedCurrencyQueuesEveryYearAfterTheResponse() {
  const { api, req, res, order, ensured, queued, years, releaseSnapshot } = harness({ before: 'EUR', after: 'CHF' });
  const saved = await api.updateSettings({ reportingCurrency: 'chf' }, req);
  assert.equal(saved.reportingCurrency, 'CHF');
  assert.deepEqual(saved.refreshYears, years);
  assert.equal('completed' in saved, false);
  assert.deepEqual(ensured, [], 'the currency row is inserted by the settings save, in the request transaction');
  assert.deepEqual(order, ['read', 'update', 'queue']);
  assert.deepEqual(queued[0].years, years);
  assert.equal(queued[0].opts.label, 'reporting-currency');
  assert.equal(queued[0].opts.reportingCurrency, 'CHF');
  let started = false;
  void queued[0].opts.startAfter.then(() => { started = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, false, 'the run waits for the response (the commit)');
  res.emit('finish');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, false, 'the run also waits until the follow-up has read the stored pairs');
  releaseSnapshot();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, true);
  console.log('ok - a new reporting currency queues every year in use, started once the save has committed and the pairs are counted');
}

async function testUnknownReportingCurrencyIsRefused() {
  const { api, req, order, queued } = harness({ before: 'EUR', after: 'EUR' });
  const bodies = [
    ...['XYZ', 'EU', '12A'].map((code) => ({ reportingCurrency: code })),
    { defaultSpendCurrency: 'XTS' },
    { defaultCapexCurrency: 'ABC' },
    { allowedCurrencies: ['EUR', 'XTS'] },
  ];
  for (const body of bodies) {
    await assert.rejects(
      api.updateSettings(body, req),
      (error: any) => {
        assert.equal(error.getStatus(), 400);
        assert.equal(error.getResponse().code, 'currency_invalid');
        return true;
      },
    );
  }
  assert.deepEqual(order, [], 'refused before any read or write');
  assert.deepEqual(queued, []);
  console.log('ok - a reporting, default or allowed currency outside the ISO list answers 400 currency_invalid');
}

(async () => {
  await testUnchangedReportingCurrencyQueuesTheCurrentYear();
  await testChangedCurrencyQueuesEveryYearAfterTheResponse();
  await testUnknownReportingCurrencyIsRefused();
  console.log('fx-reporting-change.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
