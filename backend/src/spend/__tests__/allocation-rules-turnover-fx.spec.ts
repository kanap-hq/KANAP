import * as assert from 'node:assert/strict';
import { EntityManager } from 'typeorm';
import { AllocationRulesService } from '../allocation-rules.service';
import { AllocationRule } from '../allocation-rule.entity';
import { Company } from '../../companies/company.entity';
import { CompanyMetric } from '../../companies/company-metric.entity';

/**
 * The default method's preview splits a selection by turnover in the reporting currency, at the
 * rates the year's versions use: the rate set the year is frozen at, else the live rates.
 * Fixture: 70 M EUR (Paris) and 35 M USD (New York), USD at 0.9 live and 0.8 in `set-1`.
 */

const TENANT = 't1';
const YEAR = 2026;

const companies = [
  { id: 'paris', tenant_id: TENANT, base_currency: 'EUR', disabled_at: null },
  { id: 'newyork', tenant_id: TENANT, base_currency: 'USD', disabled_at: null },
];
const metrics = [
  { company_id: 'paris', fiscal_year: YEAR, headcount: 100, it_users: 80, turnover: '70' },
  { company_id: 'newyork', fiscal_year: YEAR, headcount: 100, it_users: 20, turnover: '35' },
];
const rule = { tenant_id: TENANT, fiscal_year: YEAR, mode: 'manual_company', method: 'turnover', company_ids: ['paris', 'newyork'] };

/** `frozenSet`: the rate set the year's versions carry (null: not frozen). */
function fakeManager(frozenSet: string | null) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    queries,
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/FROM spend_versions/.test(sql)) return frozenSet ? [{ id: frozenSet }] : [];
      if (/INSERT INTO allocation_rules/.test(sql)) return [{ ...rule, id: 'r1', status: 'active', inserted: false }];
      throw new Error(`unexpected query ${sql}`);
    },
    getRepository: (entity: unknown) => ({
      find: async () => {
        if (entity === AllocationRule) return [rule];
        if (entity === Company) return companies;
        if (entity === CompanyMetric) return metrics;
        throw new Error(`unexpected repository ${String((entity as any)?.name)}`);
      },
      findOne: async () => (entity === AllocationRule ? rule : null),
    }),
  };
  return manager as unknown as EntityManager & { queries: typeof queries };
}

function fakeFx(rates: Record<string, number>) {
  const calls: any[] = [];
  return {
    calls,
    resolveRates: async (tenantId: string, lookups: any[]) => {
      calls.push({ tenantId, lookups });
      const map = new Map<string, any>();
      for (const l of lookups) {
        const currency = String(l.sourceCurrency).toUpperCase();
        const key = `${l.rateSetId || 'live'}:${l.fiscalYear}:${currency}`;
        const rate = currency === 'EUR' ? 1 : rates[key];
        map.set(key, {
          rate: rate ?? 1, rateSetId: l.rateSetId ?? null, fiscalYear: l.fiscalYear, reportingCurrency: 'EUR',
          source: currency === 'EUR' ? 'identity' : rate != null ? 'live' : 'missing', capturedAt: null,
        });
      }
      return { map, settings: { reportingCurrency: 'EUR' } };
    },
  };
}

function service(fx: any) {
  return new AllocationRulesService(undefined as any, { log: async () => undefined } as any, fx);
}

function pct(shares: Array<{ company_id: string; allocation_pct: number }>) {
  return Object.fromEntries(shares.map((s) => [s.company_id, s.allocation_pct]));
}

async function testPreviewOfAnUnfrozenYearUsesTheLiveRates() {
  const fx = fakeFx({ [`live:${YEAR}:USD`]: 0.9, [`set-1:${YEAR}:USD`]: 0.8 });
  const manager = fakeManager(null);
  const resolved = await service(fx).resolve(TENANT, YEAR, { manager });
  // 70 / (70 + 31.5).
  assert.deepEqual(pct(resolved.shares), { paris: 68.9655, newyork: 31.0345 });
  assert.equal(resolved.preview_warning, null);
  const yearSets = manager.queries.filter((q) => /FROM spend_versions/.test(q.sql));
  assert.equal(yearSets.length, 1);
  assert.match(yearSets[0].sql, /tenant_id = \$1/);
  assert.deepEqual(yearSets[0].params, [TENANT, YEAR]);
}

async function testPreviewOfAFrozenYearUsesItsRateSet() {
  const fx = fakeFx({ [`live:${YEAR}:USD`]: 0.9, [`set-1:${YEAR}:USD`]: 0.8 });
  const resolved = await service(fx).resolve(TENANT, YEAR, { manager: fakeManager('set-1') });
  // As the Allocations tab of the year's versions: 35 × 0.8 = 28.
  assert.deepEqual(pct(resolved.shares), { paris: 71.4286, newyork: 28.5714 });
  assert.deepEqual(fx.calls.map((c) => c.lookups.map((l: any) => l.rateSetId)), [['set-1', 'set-1']]);
}

async function testSavingARuleChecksTheSelectionWithoutRates() {
  const fx = fakeFx({ [`live:${YEAR}:USD`]: 0.9 });
  const resolved = await service(fx).setTenantMethod(TENANT, YEAR, { mode: 'manual_company', method: 'turnover', company_ids: ['paris', 'newyork'] }, 'u1', { manager: fakeManager(null) });
  assert.deepEqual(pct(resolved.shares), { paris: 68.9655, newyork: 31.0345 });
  // The save check does not read rates. A turnover without a rate is left out when the split
  // is computed. The only read of the rates is the preview's.
  assert.equal(fx.calls.length, 1);
}

async function testSavingARuleStillRefusesAMissingTurnover() {
  const fx = fakeFx({});
  const manager = fakeManager(null);
  const original = metrics[1].turnover;
  (metrics[1] as any).turnover = null;
  try {
    await assert.rejects(
      () => service(fx).setTenantMethod(TENANT, YEAR, { mode: 'manual_company', method: 'turnover', company_ids: ['paris', 'newyork'] }, 'u1', { manager }),
      /Provide turnover values for the selected companies/,
    );
  } finally {
    (metrics[1] as any).turnover = original;
  }
  assert.equal(fx.calls.length, 0);
  assert.ok(!manager.queries.some((q) => /INSERT INTO allocation_rules/.test(q.sql)), 'nothing is saved');
}

Promise.resolve()
  .then(testPreviewOfAnUnfrozenYearUsesTheLiveRates)
  .then(testSavingARuleChecksTheSelectionWithoutRates)
  .then(testSavingARuleStillRefusesAMissingTurnover)
  .then(testPreviewOfAFrozenYearUsesItsRateSet)
  .then(() => console.log('allocation-rules-turnover-fx: ok'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
