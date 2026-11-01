import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { StatusState } from '../../common/status';
import { STARTING_COMPANY_CITY, TenantBaselineService, baseCurrencyForCountry } from '../tenant-baseline.service';

// The outcome of the default global chart of accounts (TenantBaselineService): created from the
// template, skipped when no template is marked to load by default, failed (logged, never thrown).
// Fakes only: outside a transaction the savepoint helper runs the step directly.

function service(opts: { template: boolean; failOn?: string }) {
  const calls: string[] = [];
  const step = (name: string, result: unknown = undefined) => async () => {
    calls.push(name);
    if (opts.failOn === name) throw new Error(`${name} failed`);
    return result;
  };
  const coas = {
    create: step('create', { id: 'coa-1' }),
    loadTemplateIntoCoa: step('load'),
    setGlobalDefault: step('default'),
    setConsolidation: step('consolidation'),
  };
  const manager = {
    query: async () => (opts.template ? [{ id: 'tpl-1', template_code: 'IFRS', template_name: 'IFRS' }] : []),
  };
  return { svc: new TenantBaselineService({} as any, coas as any, {} as any, {} as any), manager: manager as any, calls };
}

async function testOutcomes() {
  const created = service({ template: true });
  assert.equal(await created.svc.provisionDefaultGlobalCoa(created.manager), 'provisioned');
  assert.deepEqual(created.calls, ['create', 'load', 'default', 'consolidation']);

  const skipped = service({ template: false });
  assert.equal(await skipped.svc.provisionDefaultGlobalCoa(skipped.manager), 'skipped');
  assert.deepEqual(skipped.calls, []);

  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const failed = service({ template: true, failOn: 'load' });
    assert.equal(await failed.svc.provisionDefaultGlobalCoa(failed.manager), 'failed');
    assert.deepEqual(failed.calls, ['create', 'load']);
  } finally {
    console.warn = warn;
  }
}

function testBaseCurrencyForCountry() {
  assert.equal(baseCurrencyForCountry('FR'), 'EUR');
  assert.equal(baseCurrencyForCountry(' fr '), 'EUR');
  assert.equal(baseCurrencyForCountry('DE'), 'EUR');
  assert.equal(baseCurrencyForCountry('ES'), 'EUR');
  assert.equal(baseCurrencyForCountry('IT'), 'EUR');
  assert.equal(baseCurrencyForCountry('NL'), 'EUR');
  assert.equal(baseCurrencyForCountry('BE'), 'EUR');
  assert.equal(baseCurrencyForCountry('US'), 'USD');
  assert.equal(baseCurrencyForCountry('us'), 'USD');
  assert.equal(baseCurrencyForCountry('GB'), 'GBP');
  assert.equal(baseCurrencyForCountry('CH'), 'CHF');
  assert.equal(baseCurrencyForCountry('JP'), null, 'a country outside the map stays empty');
  assert.equal(baseCurrencyForCountry(''), null);
  assert.equal(baseCurrencyForCountry(null), null);
  assert.equal(baseCurrencyForCountry(undefined), null);
}

async function testStartingCompanyCurrency() {
  const calls: Array<{ body: Record<string, unknown>; userId: string | undefined }> = [];
  const companies = {
    create: async (body: Record<string, unknown>, userId?: string) => {
      calls.push({ body, userId });
      return { id: 'co-1' };
    },
  };
  const svc = new TenantBaselineService({} as never, {} as never, companies as never, {} as never);
  const manager = {} as never;
  await svc.createStartingCompany(manager, { companyName: 'Acme', countryIso: 'FR', actorId: 'user-1' });
  await svc.createStartingCompany(manager, { companyName: 'Acme US', countryIso: 'US', actorId: null });
  await svc.createStartingCompany(manager, { companyName: 'Acme Japan', countryIso: 'JP', actorId: 'user-2' });

  assert.equal(STARTING_COMPANY_CITY, 'Unknown');
  assert.deepEqual(calls[0], {
    body: {
      name: 'Acme',
      country_iso: 'FR',
      city: STARTING_COMPANY_CITY,
      base_currency: 'EUR',
      status: StatusState.ENABLED,
    },
    userId: 'user-1',
  });
  assert.equal(calls[1].body.base_currency, 'USD');
  assert.equal(calls[1].body.city, STARTING_COMPANY_CITY);
  assert.equal(calls[1].userId, undefined);
  assert.equal(calls[2].body.base_currency, null);
  assert.equal(calls[2].body.country_iso, 'JP');
  assert.equal(calls[2].userId, 'user-2');
}

testOutcomes()
  .then(() => {
    testBaseCurrencyForCountry();
    return testStartingCompanyCurrency();
  })
  .then(() => console.log('tenant-baseline.service.spec: ok'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
