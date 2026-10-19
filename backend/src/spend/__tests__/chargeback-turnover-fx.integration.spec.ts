import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ChargebackReportService } from '../chargeback-report.service';
import { seedCompany } from './cost-center.fixtures';
import {
  assert,
  inRolledBackTransaction,
  repeat,
  runSpecs,
  seedLine,
  seedTenant,
} from './round-inputs.fixtures';

// The chargeback's turnover indicators are in the reporting currency: each company's turnover,
// entered in millions of its base currency, is converted at the year's rates with the rule of
// the report's amounts (the versions' frozen rate set, else the live rates of the year), so the
// IT costs vs turnover ratio and the global turnover never mix currencies.
// Fixture: Paris 0.07 M EUR, New York 0.035 M USD (USD at 0.9 live, 0.8 in the frozen set); one
// EUR line of 1,200 split 50/50.

const YEAR = 2034;

type Seed = { tenantId: string; paris: string; newYork: string; versionId: string };

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = await seedTenant(runner, 'chargeback-fx');
  const { companyId: paris } = await seedCompany(runner, tenantId, 'Paris');
  const { companyId: newYork } = await seedCompany(runner, tenantId, 'New York');
  await runner.query(`UPDATE companies SET base_currency = 'EUR' WHERE id = $1`, [paris]);
  await runner.query(`UPDATE companies SET base_currency = 'USD' WHERE id = $1`, [newYork]);
  for (const [companyId, turnover] of [[paris, '0.07'], [newYork, '0.035']]) {
    await runner.query(
      `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, turnover) VALUES ($1, $2, $3, 10, $4)`,
      [tenantId, companyId, YEAR, turnover],
    );
  }
  const { itemId, versionId } = await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat('100', 12) });
  await runner.query(`UPDATE spend_items SET paying_company_id = $2 WHERE id = $1`, [itemId, paris]);
  return { tenantId, paris, newYork, versionId };
}

/** `rates`: `<rate set or live>:<year>:<currency>` to the rate into EUR; anything else is missing (rate 1). */
function fakeFx(rates: Record<string, number>) {
  return {
    resolveRates: async (_tenantId: string, lookups: any[]) => {
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
      return { settings: { reportingCurrency: 'EUR' }, map };
    },
    convertValue: (value: number, rate: number) => Math.round(value * rate * 100) / 100,
  };
}

/** Every version split 50/50 between Paris and New York. */
function service(seeded: Seed, rates: Record<string, number>) {
  const calculator = {
    computeForVersions: async (versions: Array<{ id: string }>) => new Map(versions.map((v) => [
      v.id,
      {
        resolvedMethod: 'manual_company',
        shares: [
          { company_id: seeded.paris, department_id: null, allocation_pct: 50 },
          { company_id: seeded.newYork, department_id: null, allocation_pct: 50 },
        ],
      },
    ])),
  };
  return new ChargebackReportService(undefined as any, calculator as any, fakeFx(rates) as any);
}

async function testTurnoverIndicatorsAreInTheReportingCurrency() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    const svc = service(seeded, { [`live:${YEAR}:USD`]: 0.9 });
    const opts = { manager: runner.manager };

    const global = await svc.generateGlobal(YEAR, 'budget', seeded.tenantId, opts);
    const kpi = new Map(global.kpis.map((row) => [row.companyId, row]));
    assert.equal(kpi.get(seeded.paris)!.turnover, 70000);
    assert.equal(kpi.get(seeded.paris)!.costVsTurnoverPct, 0.86, '600 / 70,000');
    // 35,000 USD at 0.9: 31,500 EUR. Unconverted it read 600 / 35,000 = 1.71 %.
    assert.equal(kpi.get(seeded.newYork)!.turnover, 31500);
    assert.equal(kpi.get(seeded.newYork)!.turnoverRaw, 35000, 'the raw turnover stays in the base currency');
    assert.equal(kpi.get(seeded.newYork)!.costVsTurnoverPct, 1.9, '600 / 31,500');
    assert.deepEqual(global.warnings, []);

    const company = await svc.generateCompany(YEAR, 'budget', seeded.newYork, seeded.tenantId, opts);
    assert.equal(company.company.turnover, 31500);
    assert.equal(company.company.costVsTurnoverPct, 1.9);
    assert.equal(company.kpis[0].costVsTurnoverPct, 1.9);
    // The global turnover adds EUR to EUR: 70,000 + 31,500, not 70,000 + 35,000.
    assert.equal(company.globalKpi.turnover, 101500);
    assert.equal(company.globalKpi.costVsTurnoverPct, 1.18, '1,200 / 101,500');
  });
}

async function testFrozenVersionsConvertAtTheirRateSet() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    const [set] = await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', '{"USD": 0.8}'::jsonb) RETURNING id`,
      [seeded.tenantId, YEAR],
    );
    await runner.query(`UPDATE spend_versions SET fx_rate_set_id = $2 WHERE id = $1`, [seeded.versionId, set.id]);
    const svc = service(seeded, { [`live:${YEAR}:USD`]: 0.9, [`${set.id}:${YEAR}:USD`]: 0.8 });

    const company = await svc.generateCompany(YEAR, 'budget', seeded.newYork, seeded.tenantId, { manager: runner.manager });
    assert.equal(company.company.turnover, 28000, '35,000 USD at the frozen 0.8');
    assert.equal(company.company.costVsTurnoverPct, 2.14, '600 / 28,000');
    assert.equal(company.globalKpi.turnover, 98000);
  });
}

async function testMissingRateCountsUnconvertedWithAWarning() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    const svc = service(seeded, {});
    const global = await svc.generateGlobal(YEAR, 'budget', seeded.tenantId, { manager: runner.manager });
    const newYork = global.kpis.find((row) => row.companyId === seeded.newYork)!;
    assert.equal(newYork.turnover, 35000, 'as the amounts: rate 1 until the rate is fetched');
    assert.deepEqual(global.warnings, [{ code: 'turnover_fx_missing', currencies: ['USD'], year: YEAR, reportingCurrency: 'EUR' }]);
  });
}

async function testAVersionNotCountedGivesNoWarning() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    // A second line with nothing in the year: the report does not count it.
    const { versionId: empty } = await seedLine(runner, 'opex', seeded.tenantId, YEAR, {}, 2);
    const jpy = { code: 'turnover_fx_missing', currencies: ['JPY'], year: YEAR, reportingCurrency: 'EUR' };
    const shares = [{ company_id: seeded.paris, department_id: null, allocation_pct: 100 }];
    const svc = new ChargebackReportService(undefined as any, {
      computeForVersions: async (versions: Array<{ id: string }>) => new Map(versions.map((v) => [
        v.id,
        // Only the empty line's split counted a turnover without a rate.
        { resolvedMethod: 'turnover', shares, warning: v.id === empty ? jpy : null },
      ])),
    } as any, fakeFx({ [`live:${YEAR}:USD`]: 0.9 }) as any);
    const global = await svc.generateGlobal(YEAR, 'budget', seeded.tenantId, { manager: runner.manager });
    assert.equal(global.total, 1200);
    assert.deepEqual(global.warnings, [], 'the warning of a version the report does not count is not shown');

    const counted = new ChargebackReportService(undefined as any, {
      computeForVersions: async (versions: Array<{ id: string }>) => new Map(versions.map((v) => [
        v.id,
        { resolvedMethod: 'turnover', shares, warning: v.id === seeded.versionId ? jpy : null },
      ])),
    } as any, fakeFx({ [`live:${YEAR}:USD`]: 0.9 }) as any);
    const report = await counted.generateGlobal(YEAR, 'budget', seeded.tenantId, { manager: runner.manager });
    assert.deepEqual(report.warnings, [jpy], 'the warning of a counted version is shown');
  });
}

void runSpecs('chargeback-turnover-fx.integration.spec', [
  ['testAVersionNotCountedGivesNoWarning', testAVersionNotCountedGivesNoWarning],
  ['testTurnoverIndicatorsAreInTheReportingCurrency', testTurnoverIndicatorsAreInTheReportingCurrency],
  ['testFrozenVersionsConvertAtTheirRateSet', testFrozenVersionsConvertAtTheirRateSet],
  ['testMissingRateCountsUnconvertedWithAWarning', testMissingRateCountsUnconvertedWithAWarning],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
