// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { readContractBudgetCoverage } from '../../contracts/contract-budget';
import { ContractsService } from '../../contracts/contracts.service';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import { realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import { LIMITED_ROLE, PgClient, roleExists } from './data-access-test-helpers';
import { seedContracts, type ContractSeed } from './data-access-contract-seed';

/**
 * Data-scoped access, lot 5 run 5C (planning/data-scoped-access/spec.md §5.4 "Chiffres d'un objet
 * visible", §6.6, §10.3 "Divulgations"): the coverage of a contract runs through
 * `withFullDataAccess`, from `contract-budget.ts`, for the contract page and the contracts list.
 *
 * - `readContractBudgetCoverage` enters a read-only window under the limited role (a write answers
 *   25006 there) and gives the limited role back; an unscoped person gets the same figures without
 *   a window.
 * - CE is linked to L1 (hidden from Marta), L5 (visible) and L6 (hidden): Marta's coverage of CE is
 *   the unscoped one (300, the three lines), while the page's line list holds L5 alone (100, one
 *   line) and the list's `linked_lines_count` counts it alone. No id or name of L1 or L6 leaves the
 *   window.
 * - The list's footer totals count the visible contracts only: Marta reads CE and CX, so their
 *   linked sum is 300, where the unscoped list totals every contract (500).
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
const YEAR = 2026;
const deps = realSummaryDeps(SUMMARY_SCOPES.opex);

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

/** The service with the given rate source (the budget figures read the rates through it). */
function service(fxRates: any = deps.fxRates): ContractsService {
  const args: any[] = Array.from({ length: 10 }, () => undefined);
  args[4] = { log: async () => undefined };
  args[9] = fxRates;
  return new (ContractsService as any)(...args);
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

const coverageQuery = { year: String(YEAR), column: 'planned' };
const listQuery = { budget_year: String(YEAR), budget_column: 'planned', limit: '50' };

async function testWindow(runner: QueryRunner, s: ContractSeed): Promise<void> {
  await as(runner, s.persons.marta, async (m) => {
    assert.equal(await role(m), LIMITED_ROLE);
    // The window is read only: the rate source runs one statement inside the coverage of CE.
    let writeState: string | null = null;
    const fxRates = Object.create(deps.fxRates) as any;
    fxRates.resolveRates = async (tenantId: string, codes: string[], opts?: { manager?: EntityManager }) => {
      if (opts?.manager && writeState === null) {
        // Its own savepoint: the refusal aborts the statement, not the coverage window.
        await opts.manager.query('SAVEPOINT coverage_probe');
        try {
          await opts.manager.query(`UPDATE spend_items SET product_name = product_name WHERE false`);
          writeState = 'written';
        } catch (error: any) {
          writeState = String(error?.code ?? error?.message ?? '');
        } finally {
          await opts.manager.query('ROLLBACK TO SAVEPOINT coverage_probe');
        }
      }
      return deps.fxRates.resolveRates(tenantId, codes as any, opts as any);
    };
    const coverage = await readContractBudgetCoverage(
      { fxRates },
      m,
      s.tenantId,
      [YEAR],
      'planned',
      [s.contracts.CE],
    );
    assert.equal(writeState, '25006', 'a write inside the coverage window: read-only transaction');
    assert.equal(await role(m), LIMITED_ROLE, 'the limited role is back after the coverage window');
    const row = coverage.rows.find((entry) => entry.year === YEAR);
    assert.equal(Number(row?.linked), 300, 'CE: the three linked lines, L1 and L6 included');
    assert.equal(JSON.stringify(coverage).includes(s.lines.L1), false, 'no hidden line id in the window result');
    assert.equal(JSON.stringify(coverage).includes(s.lines.L6), false, 'no hidden line id in the window result');
  });
  console.log('  coverage window: read only (25006), limited role back, hidden lines counted: OK');
}

async function testCoverageFigures(runner: QueryRunner, s: ContractSeed): Promise<void> {
  const svc = service();
  // The unscoped reference, read as the application role.
  const baseline = await svc.budgetCoverage(s.contracts.CE, coverageQuery, { manager: runner.manager, budgetAccess: true });
  const baselineRow = baseline.years.find((row: any) => row.year === YEAR);
  assert.equal(Number(baselineRow?.linked), 300);
  const baselineList = await svc.list(listQuery, { manager: runner.manager, budgetAccess: true });
  const baselineRowOfList = (baselineList.items as any[]).find((row) => row.id === s.contracts.CE);

  await as(runner, s.persons.marta, async (m) => {
    const page = await svc.budgetCoverage(s.contracts.CE, coverageQuery, { manager: m, budgetAccess: true });
    assert.deepEqual(page.years.find((row: any) => row.year === YEAR), baselineRow, 'Marta: the coverage of CE equals the unscoped one');
    assert.deepEqual(page.lines.map((line: any) => [line.id, line.amount]), [[s.lines.L5, 100]], 'the page lists the line she reads alone');
    assert.equal(JSON.stringify(page).includes(s.lines.L1), false, 'no id of a hidden line leaves the window');
    assert.equal(JSON.stringify(page).includes(s.lines.L6), false, 'no id of a hidden line leaves the window');
    assert.equal(JSON.stringify(page).includes('DA line L1'), false, 'no name of a hidden line leaves the window');
    assert.equal(JSON.stringify(page).includes('DA line L6'), false, 'no name of a hidden line leaves the window');

    const links = await svc.listBudgetLines(s.contracts.CE, { manager: m });
    assert.deepEqual(links.items.map((line) => line.id), [s.lines.L5], 'the Budget tab: the visible line alone');
    assert.equal(links.hidden, 2, 'and the two lines outside her access, counted');

    const pageList = await svc.list(listQuery, { manager: m, budgetAccess: true });
    const ids = (pageList.items as any[]).map((row) => row.id).sort();
    assert.deepEqual(ids, [s.contracts.CE, s.contracts.CX].sort(), 'the list holds the visible contracts only');
    const ce = (pageList.items as any[]).find((row) => row.id === s.contracts.CE);
    assert.equal(ce.budget_linked, baselineRowOfList.budget_linked, 'the row shows the full coverage, as the page');
    assert.equal(ce.budget_linked, 300);
    assert.equal(ce.linked_lines_count, 1, 'the linked-lines column counts the lines she reads');
    const totals = await svc.totals(listQuery, { manager: m, tenantId: s.tenantId, budgetAccess: true });
    assert.equal(totals.budget?.linked, 300, 'the footer counts the visible contracts only (CE)');
    assert.equal(JSON.stringify(pageList).includes(s.lines.L1), false, 'no hidden line id in the list');
    assert.equal(JSON.stringify(pageList).includes(s.lines.L6), false, 'no hidden line id in the list');

    // The contracts CSV export follows the list (spec §5.6): the visible rows alone.
    const csv = await svc.exportCsv('data', { manager: m, budgetAccess: true, language: 'en', listQuery: {} });
    assert.ok(csv.content.includes('DA contract CE'), 'the export has CE');
    assert.ok(csv.content.includes('DA contract CX'), 'the export has CX');
    for (const hidden of ['CF', 'CL', 'CN', 'CH']) {
      assert.equal(csv.content.includes(`DA contract ${hidden} `), false, `the export leaves ${hidden} out`);
    }

    // The dashboard renewals tile calls this list (sort next_due_date, a date filter): the same
    // visible contracts, never a hidden one.
    const renewalTile = await svc.list({
      limit: '5',
      sort: 'next_due_date:ASC',
      filters: JSON.stringify({ next_due_date: { filterType: 'date', type: 'greaterThanOrEqual', dateFrom: '2020-01-01' } }),
    }, { manager: m, budgetAccess: true });
    assert.deepEqual((renewalTile.items as any[]).map((row) => row.id).sort(), [s.contracts.CE, s.contracts.CX].sort(), 'the renewals tile sees the visible contracts');
  });

  await applyDataAccess(runner, s.persons.ulla);
  // The unscoped footer totals every contract: CE 300 plus CF 100 and CL 100, on L1.
  const unscopedTotals = await svc.totals(listQuery, { manager: runner.manager, tenantId: s.tenantId, budgetAccess: true });
  assert.equal(unscopedTotals.budget?.linked, 500, 'the unscoped footer counts every contract');
  const unscopedCsv = await svc.exportCsv('data', { manager: runner.manager, budgetAccess: true, language: 'en', listQuery: {} });
  for (const contract of ['CF', 'CE', 'CL', 'CN', 'CH', 'CX']) {
    assert.ok(unscopedCsv.content.includes(`DA contract ${contract} `), `the unscoped export has ${contract}`);
  }
  console.log('  coverage of a contract with hidden lines: page and list equal the unscoped figure, linked lines visible only: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access contract coverage: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access contract coverage (lot 5, run 5C)');
    await runner.startTransaction();
    try {
      const s = await seedContracts(clientOf(runner));
      await testWindow(runner, s);
      await testCoverageFigures(runner, s);
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
