// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { withFullDataAccess } from '../full-data-access';
import { DataAccessLimitedException } from '../line-write-checks';
import { AllocationCalculatorService } from '../../spend/allocation-calculator.service';
import {
  ChargebackReportService,
  CompanyChargebackReportResponse,
  DATA_ACCESS_CHARGEBACK_COMPANY_MESSAGE,
} from '../../spend/chargeback-report.service';
import { LIMITED_ROLE, PgClient, roleExists } from './data-access-test-helpers';
import { Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 4 run 4A (planning/data-scoped-access/spec.md §5.2, §5.3, §6.6): the
 * chargeback report and `withFullDataAccess`, on the reference example of lot 2
 * (`data-access-line-seed.ts`), in one rolled-back transaction, each person in a savepoint after
 * `applyDataAccess`.
 *
 * Shares (manual percentages, 100 planned per line in 2026): L1 (FR / INF-FR) 60 % FR and 40 % ES
 * down to an ES department; L4 (ES / INF-ES) 50 % FR, 50 % ES; every other line 100 % FR.
 *
 * - `withFullDataAccess`: the window reads every line, refuses a write (25006), and gives the
 *   limited role back, also after an error; outside a limited transaction it is a plain call.
 * - Marta (company ES): the ES report holds every share charged to ES, L1 (which she cannot read)
 *   as a label without its id; no group total, no other company's indicators, no warning naming
 *   a line she cannot read. The FR report: 403 `DATA_ACCESS_LIMITED`.
 * - Paul and Rita (cost-centre nodes), Nina (no node): no company report.
 * - Claire ("all" node): every line readable, no group total.
 * - Ulla (mode all) and the Administrator: the report as without data access.
 * - The global report of a limited person counts the lines they read only.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
const YEAR = 2026;

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

function service(): ChargebackReportService {
  const fxRates = {
    resolveRates: async () => ({ settings: { reportingCurrency: 'EUR' }, map: new Map() }),
    convertValue: (value: number, rate: number) => value * rate,
  };
  const calculator = new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
  return new ChargebackReportService(undefined as any, calculator, fxRates as any);
}

/** Runs `fn` as `person` in a savepoint, rolled back after. */
async function as<T>(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<T>): Promise<T> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    return await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

async function role(m: EntityManager): Promise<string> {
  return (await m.query(`SELECT current_setting('role') AS r`))[0].r;
}

async function countLines(m: EntityManager, tenantId: string): Promise<number> {
  return (await m.query(`SELECT count(*)::int AS n FROM spend_items WHERE tenant_id = $1`, [tenantId]))[0].n;
}

type Shares = { departmentEs: string };

/** The shares of the scenario, as the application role. */
async function seedShares(runner: QueryRunner, s: Seed): Promise<Shares> {
  const departmentEs = (await runner.query(
    `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Finance ES') RETURNING id`, [s.tenantId, s.es],
  ))[0].id as string;
  await runner.query(`UPDATE spend_versions SET allocation_method = 'manual_pct' WHERE tenant_id = $1`, [s.tenantId]);
  await runner.query(`DELETE FROM spend_allocations WHERE version_id = ANY($1::uuid[])`, [[s.versions.L1, s.versions.L4]]);
  const share = (version: string, company: string, pct: number, department: string | null = null) => runner.query(
    `INSERT INTO spend_allocations (tenant_id, version_id, company_id, department_id, allocation_pct) VALUES ($1, $2, $3, $4, $5)`,
    [s.tenantId, version, company, department, pct],
  );
  await share(s.versions.L1, s.fr, 60);
  await share(s.versions.L1, s.es, 40, departmentEs);
  await share(s.versions.L4, s.fr, 50);
  await share(s.versions.L4, s.es, 50);
  return { departmentEs };
}

const UNSCOPED_ITEM_KEYS = [
  'allocationMethod', 'allocationMethodLabel', 'amount', 'amountRaw', 'itemId', 'itemName', 'itemNumber', 'nature', 'sharePct', 'versionId',
].sort();

async function testWindow(runner: QueryRunner, s: Seed): Promise<void> {
  const { persons: p } = s;
  await as(runner, p.marta, async (m) => {
    assert.equal(await role(m), LIMITED_ROLE);
    assert.equal(await countLines(m, s.tenantId), 4, 'Marta reads L2 to L5');
    const inside = await withFullDataAccess(m, async (full) => ({
      lines: await countLines(full, s.tenantId),
      role: await role(full),
      readOnly: (await full.query(`SELECT current_setting('transaction_read_only') AS v`))[0].v,
      mode: (await full.query(`SELECT current_setting('app.da_mode') AS v`))[0].v,
    }));
    assert.deepEqual(inside, { lines: 7, role: 'none', readOnly: 'on', mode: 'limited' }, 'the window reads every line, read only, settings kept');
    assert.equal(await role(m), LIMITED_ROLE, 'the limited role is back');
    assert.equal(await countLines(m, s.tenantId), 4, 'the policies apply again');
    assert.equal((await m.query(`SELECT current_setting('transaction_read_only') AS v`))[0].v, 'off', 'read-write again');

    // A write inside the window is refused, and the window still closes.
    await assert.rejects(
      withFullDataAccess(m, (full) => full.query(`UPDATE spend_items SET product_name = 'x' WHERE tenant_id = $1`, [s.tenantId])),
      (err: any) => err?.code === '25006',
      'a write inside the window: read-only transaction (25006)',
    );
    assert.equal(await role(m), LIMITED_ROLE, 'the role is back after a refused write');
    await assert.rejects(
      withFullDataAccess(m, (full) => full.query(`INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, 'Leak', 'FR', 'Lyon', 'enabled')`, [s.tenantId])),
      (err: any) => err?.code === '25006',
    );
    // An error of the code (no SQL error): same.
    await assert.rejects(withFullDataAccess(m, async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await role(m), LIMITED_ROLE, 'the role is back after an error');
    assert.equal(await countLines(m, s.tenantId), 4, 'the transaction goes on under the limited role');
    assert.equal((await m.query(`SELECT count(*)::int AS n FROM spend_items WHERE product_name = 'x'`))[0].n, 0, 'nothing was written');
  });

  // Unscoped: nothing to leave, a plain call (no read-only window).
  await as(runner, p.ulla, async (m) => {
    const inside = await withFullDataAccess(m, async (full) => ({
      role: await role(full),
      readOnly: (await full.query(`SELECT current_setting('transaction_read_only') AS v`))[0].v,
    }));
    assert.deepEqual(inside, { role: 'none', readOnly: 'off' });
  });
  console.log('  withFullDataAccess: reads every line, read only (25006), limited role back after it and after an error: OK');
}

async function refused(fn: () => Promise<unknown>, who: string): Promise<void> {
  await assert.rejects(fn, (err: any) => {
    assert.ok(err instanceof DataAccessLimitedException, `${who}: DataAccessLimitedException, got ${err?.message}`);
    assert.equal(err.getStatus(), 403);
    assert.equal((err.getResponse() as any).code, 'DATA_ACCESS_LIMITED');
    assert.equal(err.message, DATA_ACCESS_CHARGEBACK_COMPANY_MESSAGE);
    return true;
  }, who);
}

function byLine(report: CompanyChargebackReportResponse, s: Seed) {
  const labelOf = (name: string) => (Object.keys(s.lines) as Array<keyof Seed['lines']>).find((l) => name.startsWith(`DA line ${l} `));
  return new Map(report.items.map((row) => [labelOf(row.itemName), row] as const));
}

async function testChargeback(runner: QueryRunner, s: Seed, shares: Shares): Promise<void> {
  const { persons: p } = s;
  const svc = service();
  const company = (m: EntityManager, companyId: string) => svc.generateCompany(YEAR, 'budget', companyId, s.tenantId, { manager: m });
  const global = (m: EntityManager) => svc.generateGlobal(YEAR, 'budget', s.tenantId, { manager: m });

  // Before any access is applied on this runner: the report as it always was.
  const baselineEs = await company(runner.manager, s.es);

  // Unscoped (mode all) and the Administrator: unchanged.
  for (const [who, person] of [['ulla', p.ulla], ['admin', p.admin]] as const) {
    const report = await as(runner, person, (m) => company(m, s.es));
    assert.deepEqual(report, baselineEs, `${who}: the same report as without data access`);
  }
  assert.equal(baselineEs.total, 90, 'ES is charged 40 (L1) + 50 (L4)');
  assert.ok(baselineEs.globalKpi, 'unscoped: the group total');
  assert.equal(baselineEs.globalKpi!.amount, 700);
  assert.equal('dataAccessLimited' in baselineEs, false);
  for (const row of baselineEs.items) assert.deepEqual(Object.keys(row).sort(), UNSCOPED_ITEM_KEYS, 'unscoped: the item rows of before');
  assert.ok(baselineEs.warnings.some((w) => typeof w === 'string' && w.includes('DA line L6')), 'unscoped: the warning on L6 (no paying company)');

  // Marta, company ES: every share charged to ES, L1 without its id.
  const marta = await as(runner, p.marta, (m) => company(m, s.es));
  assert.equal(marta.total, 90, 'Marta: every share charged to ES, including L1 she cannot read');
  assert.equal(marta.company.paid, 300, 'ES pays L3, L4, L5');
  assert.equal(marta.globalKpi, null, 'no group total');
  assert.equal(marta.dataAccessLimited, true);
  assert.deepEqual(marta.kpis.map((k) => k.companyId), [s.es], 'the indicators of ES only');
  const rows = byLine(marta, s);
  assert.deepEqual([...rows.keys()].sort(), ['L1', 'L4']);
  const l1 = rows.get('L1')!;
  assert.deepEqual(
    { itemId: l1.itemId, readable: l1.readable, amount: l1.amount, pct: l1.allocationPct, payer: l1.payingCompanyId, departments: l1.departments, number: l1.itemNumber != null },
    { itemId: null, readable: false, amount: 40, pct: 40, payer: s.fr, departments: ['Finance ES'], number: true },
    'L1: reference, label, payer, percentage, amount and department; no id (no link)',
  );
  assert.ok(l1.payingCompanyName?.startsWith('Alpha France'));
  const l4 = rows.get('L4')!;
  assert.deepEqual(
    { itemId: l4.itemId, readable: l4.readable, amount: l4.amount, pct: l4.allocationPct, payer: l4.payingCompanyId, departments: l4.departments },
    { itemId: s.lines.L4, readable: true, amount: 50, pct: 50, payer: s.es, departments: [] },
  );
  assert.deepEqual(marta.departments.map((d) => [d.departmentId, d.amount]).sort(), [[null, 50], [shares.departmentEs, 40]].sort());
  assert.deepEqual(marta.intercompany?.payables.map((r) => [r.payerId, r.amount]), [[s.fr, 40]], 'FR pays 40 charged to ES');
  assert.deepEqual(marta.intercompany?.receivables.map((r) => [r.consumerId, r.amount]), [[s.fr, 250]], 'ES pays 250 charged to FR (L3, L4, L5)');
  for (const w of marta.warnings) {
    assert.ok(!(typeof w === 'string' && /DA line L(1|6|7) /.test(w)), `no warning names a line Marta cannot read: ${JSON.stringify(w)}`);
  }
  // The same shares as unscoped, line by line.
  const baselineRows = byLine(baselineEs, s);
  for (const [label, row] of rows) assert.equal(row.amount, baselineRows.get(label)!.amount, `${label}: same amount as unscoped`);

  await as(runner, p.marta, (m) => refused(() => company(m, s.fr), 'Marta, FR report'));
  for (const who of ['paul', 'rita', 'nina'] as const) {
    for (const companyId of [s.fr, s.es]) {
      await as(runner, p[who], (m) => refused(() => company(m, companyId), `${who}: a cost-centre node opens no company report`));
    }
  }

  // Claire, "all": every line readable, still no group total.
  const claire = await as(runner, p.claire, (m) => company(m, s.fr));
  assert.equal(claire.globalKpi, null);
  assert.equal(claire.items.length, 7);
  assert.ok(claire.items.every((row) => row.readable === true && row.itemId), 'Claire reads every line');

  // The global report: the lines the person reads only.
  const baselineGlobal = await as(runner, p.ulla, (m) => global(m));
  assert.equal(baselineGlobal.total, 700);
  const martaGlobal = await as(runner, p.marta, (m) => global(m));
  assert.equal(martaGlobal.total, 400, 'Marta: L2 to L5 only');
  const paulGlobal = await as(runner, p.paul, (m) => global(m));
  assert.equal(paulGlobal.total, 400, 'Paul: L1 to L4 only');
  console.log('  chargeback: company nodes see every share charged to them, hidden lines without id, no group total; others refused; global on visible lines: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access chargeback: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access chargeback and withFullDataAccess (lot 4, run 4A)');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      const shares = await seedShares(runner, s);
      await testChargeback(runner, s, shares);
      await testWindow(runner, s);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
