import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ChargebackReportService } from '../chargeback-report.service';
import { describeAllocationWarning } from '../allocation-distribution';
import { seedCompany } from './cost-center.fixtures';
import {
  assert,
  inRolledBackTransaction,
  repeat,
  runSpecs,
  seedLine,
  seedTenant,
} from './round-inputs.fixtures';

// A budget line whose currency has no rate for the year is never counted at 1: the chargeback
// leaves its amounts out of every sum (paid, consumed, departments, intercompany, KPIs), so the
// report balances on what it counts, and one `amount_fx_missing` warning names every pair.
// Fixture: Paris (EUR) and New York; every line split 50/50 between them.
// - BL-1, EUR, 1,200, paid by Paris;
// - BL-2, JPY, 1,200, paid by New York;
// - BL-3, JPY, 600, paid by Paris.

const YEAR = 2035;

type Seed = { tenantId: string; paris: string; newYork: string; eurVersion: string };

async function seed(runner: QueryRunner): Promise<Seed> {
  await runner.query(`INSERT INTO currencies (code, name) VALUES ('EUR', 'Euro'), ('JPY', 'Yen') ON CONFLICT (code) DO NOTHING`);
  const tenantId = await seedTenant(runner, 'chargeback-amount-fx');
  const { companyId: paris } = await seedCompany(runner, tenantId, 'Paris');
  const { companyId: newYork } = await seedCompany(runner, tenantId, 'New York');
  const lines: Array<[number, string, string, string]> = [
    [1, 'EUR', '100', paris],
    [2, 'JPY', '100', newYork],
    [3, 'JPY', '50', paris],
  ];
  let eurVersion = '';
  for (const [itemNumber, currency, monthly, payer] of lines) {
    const { itemId, versionId } = await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat(monthly, 12) }, itemNumber);
    await runner.query(`UPDATE spend_items SET currency = $2, paying_company_id = $3 WHERE id = $1`, [itemId, currency, payer]);
    if (currency === 'EUR') eurVersion = versionId;
  }
  return { tenantId, paris, newYork, eurVersion };
}

/** `rates`: `live:<year>:<currency>` to the rate into EUR; any other currency is `missing`. */
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

const sum = (values: number[]) => Math.round(values.reduce((acc, v) => acc + v, 0) * 100) / 100;

async function testAVersionWithoutARateIsLeftOutOfEverySum() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    const svc = service(seeded, {});
    const opts = { manager: runner.manager };

    const global = await svc.generateGlobal(YEAR, 'budget', seeded.tenantId, opts);
    assert.equal(global.total, 1200, 'the EUR line only, not 1,200 + 1,200 + 600 at 1');
    assert.equal(global.totalRaw, 1200, 'the raw total leaves the line out too');
    const companies = new Map(global.companies.map((row) => [row.companyId, row]));
    assert.equal(companies.get(seeded.paris)!.amount, 600);
    assert.equal(companies.get(seeded.paris)!.paid, 1200);
    assert.equal(companies.get(seeded.newYork)!.amount, 600);
    assert.equal(companies.get(seeded.newYork)?.paid ?? 0, 0, 'New York pays only a JPY line');
    // The report balances on what it counts: consumed = paid = total, nets sum to zero.
    assert.equal(sum(global.companies.map((row) => row.amount)), global.total);
    assert.equal(sum(global.companies.map((row) => row.paid)), global.total);
    assert.equal(sum(global.companies.map((row) => row.net)), 0);
    assert.equal(sum(global.detailed.map((row) => row.amount)), global.total);
    assert.equal(sum(global.kpis.map((row) => row.amount)), global.total);
    assert.deepEqual(
      global.intercompanyFlows.map((row) => [row.payerId, row.consumerId, row.amount]),
      [[seeded.paris, seeded.newYork, 600]],
      'no flow from New York for its JPY line',
    );
    const expected = { code: 'amount_fx_missing', items: [{ currency: 'JPY', year: YEAR, lines: 2 }], reportingCurrency: 'EUR' };
    assert.deepEqual(global.warnings, [expected], 'one warning, the pair listed once with its two lines');
    assert.equal(
      describeAllocationWarning(expected as any),
      `No EUR exchange rate for JPY in ${YEAR} (2 lines): the amounts of those lines are left out of the totals until the rate is available.`,
    );

    const company = await svc.generateCompany(YEAR, 'budget', seeded.newYork, seeded.tenantId, opts);
    assert.equal(company.total, 600);
    assert.equal(company.totalRaw, 600);
    assert.equal(company.company.paid, 0);
    assert.deepEqual(company.items.map((row) => row.versionId), [seeded.eurVersion], 'the JPY lines are not listed at 0');
    assert.equal(company.itemsTotal, 600);
    assert.equal(sum(company.departments.map((row) => row.amount)), 600);
    assert.deepEqual(company.intercompany!.receivables, []);
    assert.deepEqual(company.intercompany!.payables.map((row) => [row.payerId, row.amount]), [[seeded.paris, 600]]);
    assert.equal(company.globalKpi.amount, 1200);
    assert.deepEqual(company.warnings, [expected]);
  });
}

async function testWithTheRateEveryLineCounts() {
  await inRolledBackTransaction(async (runner) => {
    const seeded = await seed(runner);
    const svc = service(seeded, { [`live:${YEAR}:JPY`]: 0.01 });
    const global = await svc.generateGlobal(YEAR, 'budget', seeded.tenantId, { manager: runner.manager });
    // 1,200 + 12 + 6.
    assert.equal(global.total, 1218);
    assert.equal(sum(global.companies.map((row) => row.paid)), 1218);
    assert.deepEqual(global.warnings, []);
  });
}

void runSpecs('chargeback-amount-fx.integration.spec', [
  ['testAVersionWithoutARateIsLeftOutOfEverySum', testAVersionWithoutARateIsLeftOutOfEverySum],
  ['testWithTheRateEveryLineCounts', testWithTheRateEveryLineCounts],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
