import 'dotenv/config';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ChargebackReportService, ChargebackScope, resolveChargebackScope } from '../chargeback-report.service';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import { SpendVersion } from '../spend-version.entity';
import { CapexAllocationsService, SpendAllocationsService } from '../spend-allocations.service';
import { seedCompany } from './cost-center.fixtures';
import { withRlsLifted } from '../../common/__tests__/rls-bypass.fixtures';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  Kind,
  repeat,
  runSpecs,
  seedItem,
  seedLine,
  seedTenant,
  seedVersion,
  setTenant,
} from './round-inputs.fixtures';

// The chargeback and the allocation calculators read one tenant only, by an
// explicit tenant_id predicate on every query, not only through RLS: with RLS
// lifted on the tables they read, tenant B's lines, amounts, companies and
// metrics of the same year stay out of tenant A's report and shares, and a
// calculator call mixing versions of two tenants throws.
// The scope (plan planning/budget-tab-redesign, lot R): OPEX by default, CAPEX or
// both on request, any other value a 400; a CAPEX line without an allocation of
// its own follows the year's default rule, as an OPEX line does.

const YEAR = 2033;

// The tables the chargeback and the calculators read, with RLS lifted for
// `app` (see `withRlsLifted`: never against a database a live API uses).
// The lines of both natures are in `spend_*` since lot Z1.
const BYPASS_TABLES = [
  'spend_items', 'spend_versions', 'spend_amounts', 'spend_allocations',
  'companies', 'company_metrics', 'departments', 'department_metrics', 'allocation_rules',
];

type TenantSeed = {
  tenantId: string;
  companyIds: string[];
  versions: Record<Kind, string>;
  /** A version of the same line in the next year, where no company has metrics. */
  nextYearVersions: Record<Kind, string>;
};

/** A tenant with companies of the given headcounts, and one OPEX and one CAPEX line paid by the first company. */
async function seedTenantData(runner: QueryRunner, tag: string, headcounts: number[], monthly: string): Promise<TenantSeed> {
  const tenantId = await seedTenant(runner, tag);
  const companyIds: string[] = [];
  for (const [index, headcount] of headcounts.entries()) {
    const { companyId } = await seedCompany(runner, tenantId, `${tag} company ${index + 1}`);
    await runner.query(
      `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount) VALUES ($1, $2, $3, $4)`,
      [tenantId, companyId, YEAR, headcount],
    );
    companyIds.push(companyId);
  }
  const versions = {} as Record<Kind, string>;
  const nextYearVersions = {} as Record<Kind, string>;
  for (const kind of ['opex', 'capex'] as Kind[]) {
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat(monthly, 12) });
    await runner.query(`UPDATE spend_items SET paying_company_id = $2 WHERE id = $1`, [itemId, companyIds[0]]);
    versions[kind] = versionId;
    nextYearVersions[kind] = await seedVersion(runner, kind, tenantId, itemId, YEAR + 1);
  }
  return { tenantId, companyIds, versions, nextYearVersions };
}

/** Tenant A (current) and tenant B with lines, amounts, companies and metrics in the same year, RLS lifted. */
async function withTwoTenants(fn: (runner: QueryRunner, a: TenantSeed, b: TenantSeed) => Promise<void>) {
  await withRlsLifted(BYPASS_TABLES, async (runner) => {
    const a = await seedTenantData(runner, 'chargeback-a', [10, 30], '10');
    const b = await seedTenantData(runner, 'chargeback-b', [60], '100');
    await setTenant(runner, a.tenantId);
    const [{ n }] = await runner.query(
      `SELECT count(*)::int AS n FROM spend_versions WHERE budget_year = $1 AND tenant_id = ANY($2::uuid[])`,
      [YEAR, [a.tenantId, b.tenantId]],
    );
    // An OPEX and a CAPEX version per tenant, both in spend_versions since lot Z1.
    assert.equal(n, 4, 'with RLS lifted, the session sees both tenants');
    await fn(runner, a, b);
  });
}

function chargeback(fxCalls: string[]) {
  const fxRates = {
    resolveRates: async (tenantId: string) => {
      fxCalls.push(tenantId);
      return { settings: { reportingCurrency: 'EUR' }, map: new Map() };
    },
    convertValue: (value: number, rate: number) => value * rate,
  };
  const calculator = new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
  return new ChargebackReportService(undefined as any, calculator, fxRates as any);
}

async function testChargebackReadsOneTenant() {
  await withTwoTenants(async (runner, a, b) => {
    const fxCalls: string[] = [];
    const svc = chargeback(fxCalls);
    const opts = { manager: runner.manager };
    const [a1, a2] = a.companyIds;

    const global = await svc.generateGlobal(YEAR, 'budget', a.tenantId, opts);
    assert.equal(global.total, 120, 'only tenant A\'s line (12 x 10)');
    assert.deepEqual(
      global.companies.map((row) => [row.companyId, row.amount]).sort(),
      [[a1, 30], [a2, 90]].sort(),
      'the default headcount spread uses tenant A\'s companies only (10 and 30)',
    );
    assert.deepEqual(global.kpis.map((row) => row.headcount).sort(), [10, 30]);
    // The amounts' rates, then the turnovers' (the turnover indicators are in the reporting currency).
    assert.deepEqual(fxCalls, [a.tenantId, a.tenantId], 'the FX rates are those of the tenant given');

    const company = await svc.generateCompany(YEAR, 'budget', a1, a.tenantId, opts);
    assert.equal(company.company.total, 30);
    assert.equal(company.company.paid, 120, 'A1 pays tenant A\'s line');
    assert.deepEqual(company.items.map((row) => row.versionId), [a.versions.opex]);
    assert.equal(company.globalKpi!.headcount, 40, 'the global headcount sums tenant A\'s companies');

    const foreign = await svc.generateCompany(YEAR, 'budget', b.companyIds[0], a.tenantId, opts);
    assert.equal(foreign.company.name, 'Unknown company', 'a company of tenant B is not read');
    assert.equal(foreign.company.headcount, null, 'nor its metrics');
    assert.equal(foreign.company.total, 0);

    const base = await (svc as any).computeBase(YEAR, 'budget', a.tenantId, opts);
    assert.deepEqual(Array.from(base.versionMeta.keys()), [a.versions.opex]);
    assert.deepEqual(Array.from(base.companyById.keys()).sort(), [a1, a2].sort());
    assert.deepEqual(Array.from(base.companyMetrics.keys()).sort(), [a1, a2].sort());

    // Each scope reads tenant A's lines of its natures only.
    const expected: Record<ChargebackScope, { total: number; versions: string[] }> = {
      opex: { total: 120, versions: [a.versions.opex] },
      capex: { total: 120, versions: [a.versions.capex] },
      all: { total: 240, versions: [a.versions.opex, a.versions.capex] },
    };
    for (const scope of ['opex', 'capex', 'all'] as ChargebackScope[]) {
      const scoped = await svc.generateGlobal(YEAR, 'budget', a.tenantId, { ...opts, scope });
      assert.equal(scoped.total, expected[scope].total, `${scope}: tenant A's lines only`);
      assert.equal(scoped.scope, scope, `${scope}: the report names its scope`);
      const scopedCompany = await svc.generateCompany(YEAR, 'budget', a1, a.tenantId, { ...opts, scope });
      assert.deepEqual(scopedCompany.items.map((row) => row.versionId).sort(), [...expected[scope].versions].sort(), `${scope}: tenant A's versions`);
      const scopedBase = await (svc as any).computeBase(YEAR, 'budget', a.tenantId, { ...opts, scope });
      assert.deepEqual(Array.from(scopedBase.companyById.keys()).sort(), [a1, a2].sort(), `${scope}: tenant A's companies`);
    }

    await assert.rejects(
      () => svc.generateGlobal(YEAR, 'budget', '', opts),
      (err: unknown) => err instanceof InternalServerErrorException,
      'no tenant, no report',
    );
  });
}

/**
 * OPEX by default; CAPEX and both natures on request. A CAPEX line without an allocation of its
 * own follows the year's default rule (here IT users, not the headcount), and the "All" figures
 * are the sum of the OPEX and the CAPEX ones; the OPEX figures do not move.
 */
async function testChargebackScopes() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'chargeback-scope');
    const companies: string[] = [];
    for (const [index, [headcount, itUsers]] of [[20, 10], [20, 30]].entries()) {
      const { companyId } = await seedCompany(runner, tenantId, `Scope company ${index + 1}`);
      await runner.query(
        `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, it_users) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, companyId, YEAR, headcount, itUsers],
      );
      companies.push(companyId);
    }
    const [c1, c2] = companies;
    await runner.query(
      `INSERT INTO allocation_rules (tenant_id, fiscal_year, method, mode, company_ids, status) VALUES ($1, $2, 'it_users', 'auto', NULL, 'enabled')`,
      [tenantId, YEAR],
    );
    // The OPEX line is spread by hand 50/50; the CAPEX line has no allocation of its own.
    const opex = await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat('10', 12) }, 1);
    const capex = await seedLine(runner, 'capex', tenantId, YEAR, { planned: repeat('100', 12) }, 2);
    await runner.query(`UPDATE spend_items SET paying_company_id = $2 WHERE tenant_id = $1 AND id = ANY($3::uuid[])`, [tenantId, c1, [opex.itemId, capex.itemId]]);
    await runner.query(`UPDATE spend_versions SET allocation_method = 'manual_pct' WHERE id = $1`, [opex.versionId]);
    await runner.query(
      `INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES ($1, $2, $3, 50), ($1, $2, $4, 50)`,
      [tenantId, opex.versionId, c1, c2],
    );
    const [{ capex_number: capexNumber }] = await runner.query(`SELECT item_number AS capex_number FROM spend_items WHERE id = $1`, [capex.itemId]);

    const svc = chargeback([]);
    const opts = { manager: runner.manager };
    const amounts = (rows: Array<{ companyId: string; amount: number }>) => Object.fromEntries(rows.map((row) => [row.companyId, row.amount]));

    const byDefault = await svc.generateGlobal(YEAR, 'budget', tenantId, opts);
    const opexOnly = await svc.generateGlobal(YEAR, 'budget', tenantId, { ...opts, scope: 'opex' });
    assert.deepEqual(byDefault, opexOnly, 'no scope is the OPEX scope');
    assert.equal(opexOnly.scope, 'opex');
    assert.equal(opexOnly.total, 120, 'the OPEX line only');
    assert.deepEqual(amounts(opexOnly.companies), { [c1]: 60, [c2]: 60 }, 'its own allocation');

    const capexOnly = await svc.generateGlobal(YEAR, 'budget', tenantId, { ...opts, scope: 'capex' });
    assert.equal(capexOnly.total, 1200, 'the CAPEX line only, its amount of the year');
    assert.deepEqual(amounts(capexOnly.companies), { [c1]: 300, [c2]: 900 }, 'the year\'s default rule: IT users 10 and 30');
    assert.deepEqual(amounts(capexOnly.companies.map((row) => ({ companyId: row.companyId, amount: row.paid }))), { [c1]: 1200, [c2]: 0 }, 'paid by its paying company');

    const all = await svc.generateGlobal(YEAR, 'budget', tenantId, { ...opts, scope: 'all' });
    assert.equal(all.total, 1320, 'both lines');
    assert.deepEqual(amounts(all.companies), { [c1]: 360, [c2]: 960 }, 'the sum of the two scopes');
    assert.deepEqual(all.intercompanyFlows.map((row) => [row.payerId, row.consumerId, row.amount]), [[c1, c2, 960]], 'the flows of both lines');

    const company = await svc.generateCompany(YEAR, 'budget', c2, tenantId, { ...opts, scope: 'all' });
    assert.equal(company.scope, 'all');
    assert.equal(company.company.total, 960);
    assert.deepEqual(
      company.items.map((row) => [row.versionId, row.nature, row.itemNumber, row.allocationMethod, row.amount]),
      [[capex.versionId, 'capex', Number(capexNumber), 'it_users', 900], [opex.versionId, 'opex', 1, 'manual_pct', 60]],
      'each line with its nature, its BL number and its method',
    );
    const opexCompany = await svc.generateCompany(YEAR, 'budget', c2, tenantId, opts);
    assert.deepEqual(opexCompany.items.map((row) => row.versionId), [opex.versionId], 'the OPEX company report leaves the CAPEX line out');
    assert.equal(opexCompany.company.total, 60);

    // Any other scope is refused, by the service and by the controller's parser.
    await assert.rejects(
      () => svc.generateGlobal(YEAR, 'budget', tenantId, { ...opts, scope: 'depreciation' as any }),
      (err: unknown) => err instanceof BadRequestException,
      'an unknown scope is a 400',
    );
    for (const raw of [undefined, null, '']) assert.equal(resolveChargebackScope(raw), 'opex', `${String(raw)}: OPEX`);
    for (const raw of ['opex', 'capex', 'all']) assert.equal(resolveChargebackScope(raw), raw);
    for (const raw of ['OPEX', 'both', ['opex', 'capex'], 'constructor', 'toString']) {
      assert.throws(() => resolveChargebackScope(raw), BadRequestException, `${JSON.stringify(raw)} is a 400`);
    }
  });
}

async function testCalculatorsReadOneTenant() {
  await withTwoTenants(async (runner, a, b) => {
    const opts = { manager: runner.manager, tenantId: a.tenantId };
    const scopes = [
      {
        kind: 'opex' as Kind,
        calculator: new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any),
        load: (id: string) => runner.manager.getRepository(SpendVersion).findOneByOrFail({ id }),
      },
      {
        kind: 'capex' as Kind,
        calculator: new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any),
        load: (id: string) => runner.manager.getRepository(SpendVersion).findOneByOrFail({ id }),
      },
    ];
    for (const { kind, calculator, load } of scopes) {
      const versionA = await load(a.versions[kind]);
      const versionB = await load(b.versions[kind]);
      const shares = (await (calculator as any).computeForVersions([versionA], opts)).get(versionA.id)?.shares ?? [];
      assert.deepEqual(
        shares.map((share: any) => [share.company_id, share.allocation_pct]).sort(),
        [[a.companyIds[0], 25], [a.companyIds[1], 75]].sort(),
        `${kind}: the default headcount spread uses tenant A's companies only`,
      );
      // No metrics in the next year: an even split over the enabled companies, tenant A's only.
      const nextYear = await load(a.nextYearVersions[kind]);
      const evenShares = (await (calculator as any).computeForVersions([nextYear], opts)).get(nextYear.id)?.shares ?? [];
      assert.deepEqual(
        evenShares.map((share: any) => [share.company_id, share.allocation_pct]).sort(),
        [[a.companyIds[0], 50], [a.companyIds[1], 50]].sort(),
        `${kind}: the even split uses tenant A's companies only`,
      );

      await assert.rejects(
        () => (calculator as any).computeForVersions([versionA, versionB], opts),
        (err: unknown) => err instanceof InternalServerErrorException,
        `${kind}: versions of two tenants throw`,
      );
      await assert.rejects(
        () => (calculator as any).computeForVersions([versionB], opts),
        (err: unknown) => err instanceof InternalServerErrorException,
        `${kind}: a version of another tenant throws`,
      );
    }
  });
}

const calculators = {
  opex: () => new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any),
  capex: () => new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any),
};
const VERSION_ENTITY = { opex: SpendVersion, capex: SpendVersion } as const;

/**
 * One call over two years reads the companies once and keeps, for each year,
 * those enabled in it: a company disabled mid second year counts in both years,
 * one disabled mid first year in the first only. No metrics: an even split.
 */
async function testCalculatorsKeepEachYearsCompanies() {
  await inRolledBackTransaction(async (runner) => {
    const firstYear = YEAR + 3;
    const tenantId = await seedTenant(runner, 'chargeback-years');
    const { companyId: enabled } = await seedCompany(runner, tenantId, 'Always enabled');
    const { companyId: endsSecond } = await seedCompany(runner, tenantId, 'Ends mid second year');
    const { companyId: endsFirst } = await seedCompany(runner, tenantId, 'Ends mid first year');
    await runner.query(`UPDATE companies SET disabled_at = $2 WHERE id = $1`, [endsSecond, `${firstYear + 1}-06-30T12:00:00Z`]);
    await runner.query(`UPDATE companies SET disabled_at = $2 WHERE id = $1`, [endsFirst, `${firstYear}-06-30T12:00:00Z`]);

    for (const kind of ['opex', 'capex'] as Kind[]) {
      const itemId = await seedItem(runner, kind, tenantId, 1, 'Two years');
      const ids = [await seedVersion(runner, kind, tenantId, itemId, firstYear), await seedVersion(runner, kind, tenantId, itemId, firstYear + 1)];
      const versions = await Promise.all(ids.map((id) => runner.manager.getRepository<any>(VERSION_ENTITY[kind]).findOneByOrFail({ id })));
      const result = await (calculators[kind]() as any).computeForVersions(versions, { manager: runner.manager, tenantId });
      const companiesOf = (id: string) => (result.get(id)?.shares ?? []).map((share: any) => share.company_id).sort();
      assert.deepEqual(companiesOf(ids[0]), [enabled, endsSecond, endsFirst].sort(), `${kind}: the first year counts all three companies`);
      assert.deepEqual(companiesOf(ids[1]), [enabled, endsSecond].sort(), `${kind}: the second year leaves out the company that ended in the first`);
      assert.deepEqual(
        (result.get(ids[1])?.shares ?? []).map((share: any) => share.allocation_pct),
        [50, 50],
        `${kind}: an even split over the second year's two companies`,
      );
    }
  });
}

/** Manual percentages name companies of the version's tenant only (RLS lifted, so the predicate refuses). */
async function testManualPercentagesRefuseForeignCompanies() {
  await withTwoTenants(async (runner, a, b) => {
    const services = {
      opex: new SpendAllocationsService(undefined as any, undefined as any, calculators.opex(), captureAudit() as any),
      capex: new CapexAllocationsService(undefined as any, undefined as any, calculators.capex(), captureAudit() as any),
    };
    const opts = { manager: runner.manager, tenantId: a.tenantId };
    for (const kind of ['opex', 'capex'] as Kind[]) {
      const table = 'spend_versions';
      const allocations = 'spend_allocations';
      const versionId = a.versions[kind];
      await runner.query(`UPDATE ${table} SET allocation_method = 'manual_pct' WHERE id = $1`, [versionId]);

      await assert.rejects(
        () => services[kind].bulkUpsert(versionId, [
          { company_id: a.companyIds[0], department_id: null, allocation_pct: 50 },
          { company_id: b.companyIds[0], department_id: null, allocation_pct: 50 },
        ], 'user', opts),
        (err: unknown) => err instanceof BadRequestException && err.message === 'One or more companies were not found.',
        `${kind}: a company of tenant B is refused`,
      );
      const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${allocations} WHERE version_id = $1`, [versionId]);
      assert.equal(n, 0, `${kind}: nothing is saved`);

      const saved = await services[kind].bulkUpsert(versionId, [
        { company_id: a.companyIds[0], department_id: null, allocation_pct: 40 },
        { company_id: a.companyIds[1], department_id: null, allocation_pct: 60 },
      ], 'user', opts);
      assert.deepEqual([saved.updated, saved.total_pct], [2, 100], `${kind}: tenant A's companies are accepted`);
    }
  });
}

void runSpecs('chargeback-tenant.integration.spec', [
  ['testChargebackReadsOneTenant', testChargebackReadsOneTenant],
  ['testChargebackScopes', testChargebackScopes],
  ['testCalculatorsReadOneTenant', testCalculatorsReadOneTenant],
  ['testCalculatorsKeepEachYearsCompanies', testCalculatorsKeepEachYearsCompanies],
  ['testManualPercentagesRefuseForeignCompanies', testManualPercentagesRefuseForeignCompanies],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
