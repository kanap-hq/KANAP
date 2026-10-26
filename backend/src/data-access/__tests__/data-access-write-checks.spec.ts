// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import {
  assertDataAccessWritten,
  assertLineContractReadable,
  assertLinesEditable,
  DATA_ACCESS_CONTRACT_NOT_FOUND_MESSAGE,
  DATA_ACCESS_LEAVES_ACCESS_MESSAGE,
  DATA_ACCESS_PLACEMENT_MESSAGE,
  DATA_ACCESS_READ_ONLY_LINE_MESSAGE,
  DataAccessLimitedException,
} from '../line-write-checks';
import { resolveItemWrite } from '../../spend/item-write.util';
import { lockBudgetLine, lockBudgetVersions } from '../../spend/budget-locks';
import { DATA_ACCESS_READ_ONLY_TASK_MESSAGE, prepareTaskWrite } from '../../tasks/task-data-access';
import { writeTaskColumns } from '../../tasks/task-column-write';
import { Task } from '../../tasks/task.entity';
import { LIMITED_ROLE, PgClient, roleExists } from './data-access-test-helpers';
import { nextItemNumber, Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 3 run 3B (planning/data-scoped-access/spec.md §2.3, §4.4, §5.4, §6.7,
 * §6.8): the write checks, through the real write gate of the lines (`resolveItemWrite`), the budget
 * locks and the task writes, on the reference example of lot 2 (`data-access-line-seed.ts`), in one
 * rolled-back transaction, each person in a savepoint after `applyDataAccess`.
 *
 * - a limited person gets the clear 403 `DATA_ACCESS_LIMITED` on a placement out of access, on a
 *   read-only line (its update, its lock, the lock of its version), on an owner change that would
 *   take the line out of their access; never a write that did not happen;
 * - a contract they cannot read and a contract that does not exist give the same 404;
 * - a task: read-only for an observer (403); handed over by its assignee who cannot read its line,
 *   the person stays an observer (`stillFollowing`), the row stays visible;
 * - an unscoped person: same answers as before, and the checks run no query.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

async function refusedWith(fn: () => Promise<unknown>, message: string, status = 403): Promise<void> {
  await assert.rejects(fn, (err: any) => {
    assert.equal(err?.getStatus?.(), status, `status ${status}: ${err?.message}`);
    if (status === 403) {
      assert.ok(err instanceof DataAccessLimitedException);
      assert.equal((err.getResponse() as any).code, 'DATA_ACCESS_LIMITED');
    }
    assert.equal(err.message, message);
    return true;
  });
}

/** Runs `fn` as `person` in a savepoint, rolled back after. */
async function as(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<void>): Promise<void> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

async function lineRow(m: EntityManager, id: string) {
  const [row] = await m.query(`SELECT * FROM spend_items WHERE id = $1`, [id]);
  return row;
}

async function testLineGate(runner: QueryRunner, s: Seed) {
  const { persons: p } = s;
  const body = (company: string, centre: string | null) => ({
    product_name: 'New', currency: 'EUR', effective_start: '2026-01-01', paying_company_id: company, cost_center_id: centre,
  });
  // Rita: INF-FR edit. FR/INF-FR is hers; FR/INF-ES and ES/INF-FR are not.
  await as(runner, p.rita, async (m) => {
    await resolveItemWrite(m, 'opex', body(s.fr, s.infFr), null);
    await refusedWith(() => resolveItemWrite(m, 'opex', body(s.fr, s.infEs), null), DATA_ACCESS_PLACEMENT_MESSAGE);
    await refusedWith(() => resolveItemWrite(m, 'opex', body(s.es, s.infFr), null), DATA_ACCESS_PLACEMENT_MESSAGE);
    // L1 is hers: an edit passes, a move to Spain does not; L3 (paid by ES on INF-FR) is read only.
    const l1 = await lineRow(m, s.lines.L1);
    await resolveItemWrite(m, 'opex', { notes: 'x' }, l1);
    await refusedWith(() => resolveItemWrite(m, 'opex', { paying_company_id: s.es }, l1), DATA_ACCESS_PLACEMENT_MESSAGE);
    const l3 = await lineRow(m, s.lines.L3);
    await refusedWith(() => resolveItemWrite(m, 'opex', { notes: 'x' }, l3), DATA_ACCESS_READ_ONLY_LINE_MESSAGE);
    // The lock of a read-only line and of its version: 403, never "gone"; a hidden line stays gone.
    await refusedWith(() => lockBudgetLine(m, 'opex', s.tenantId, s.lines.L3), DATA_ACCESS_READ_ONLY_LINE_MESSAGE);
    await refusedWith(() => lockBudgetVersions(m, 'opex', s.tenantId, [s.versions.L3]), DATA_ACCESS_READ_ONLY_LINE_MESSAGE);
    assert.equal(await lockBudgetLine(m, 'opex', s.tenantId, s.lines.L5), false, 'L5 is out of read access: gone');
    assert.equal(await lockBudgetLine(m, 'opex', s.tenantId, s.lines.L1), true);
    // A child write by id: the checks before a delete or an insert.
    await refusedWith(() => assertLinesEditable(m, [s.lines.L3]), DATA_ACCESS_READ_ONLY_LINE_MESSAGE);
    await assertLinesEditable(m, [s.lines.L1, s.lines.L5]);
    await refusedWith(() => assertDataAccessWritten(m, 0), DATA_ACCESS_READ_ONLY_LINE_MESSAGE);
  });
  // Nina has no node: she edits the lines she owns, places none, and cannot hand one over (the
  // new row would leave her access: 42501 without the check).
  const owned = (await runner.query(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id, owner_it_id)
     VALUES (app_current_tenant(), 'DA 3B owned', 'EUR', '2026-01-01', $1, $2, $3, $4) RETURNING id`,
    [nextItemNumber(), s.fr, s.infEs, p.nina],
  ))[0].id as string;
  await as(runner, p.nina, async (m) => {
    const line = await lineRow(m, owned);
    await resolveItemWrite(m, 'opex', { notes: 'x' }, line);
    await refusedWith(() => resolveItemWrite(m, 'opex', { owner_it_id: p.marta }, line), DATA_ACCESS_LEAVES_ACCESS_MESSAGE);
    await refusedWith(() => resolveItemWrite(m, 'opex', { paying_company_id: s.es, cost_center_id: null }, line), DATA_ACCESS_PLACEMENT_MESSAGE);
  });
  await as(runner, p.marta, async (m) => {
    // L5 (ES, no centre) is Marta's; she may hand it over: the company keeps it in her access.
    const l5 = await lineRow(m, s.lines.L5);
    await resolveItemWrite(m, 'opex', { owner_it_id: p.paul }, l5);
  });
  // Ulla (mode all): unchanged answers, and no query from the checks.
  await as(runner, p.ulla, async (m) => {
    await resolveItemWrite(m, 'opex', body(s.fr, s.infEs), null);
    assert.equal(await lockBudgetLine(m, 'opex', s.tenantId, s.lines.L3), true);
    let queries = 0;
    const original = runner.query.bind(runner);
    (runner as any).query = (...args: any[]) => { queries += 1; return (original as any)(...args); };
    try {
      await assertLinesEditable(m, [s.lines.L3]);
      await assertDataAccessWritten(m, 0);
      await assertLineContractReadable(m, s.lines.L3);
    } finally {
      (runner as any).query = original;
    }
    assert.equal(queries, 0, 'an unscoped person: the checks run no query');
  });
  console.log('  line gate: placement, read-only line, owner change, locks, unscoped unchanged and without query: OK');
}

async function testContract(runner: QueryRunner, s: Seed) {
  const q = (sql: string, params?: unknown[]) => runner.query(sql, params as any[]);
  const supplier = (await q(`INSERT INTO suppliers (tenant_id, name) VALUES (app_current_tenant(), 'DA 3B supplier') RETURNING id`))[0].id;
  const contract = async (company: string) => (await q(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES (app_current_tenant(), $1, $2, $3, '2026-01-01') RETURNING id`,
    [`DA 3B contract ${company.slice(0, 4)}`, company, supplier],
  ))[0].id as string;
  const french = await contract(s.fr);
  const spanish = await contract(s.es);
  const missing = '00000000-0000-4000-8000-000000000001';
  await as(runner, s.persons.marta, async (m) => {
    const l4 = await lineRow(m, s.lines.L4);
    await resolveItemWrite(m, 'opex', { contract_id: spanish }, l4);
    await refusedWith(() => resolveItemWrite(m, 'opex', { contract_id: french }, l4), DATA_ACCESS_CONTRACT_NOT_FOUND_MESSAGE, 404);
    await refusedWith(() => resolveItemWrite(m, 'opex', { contract_id: missing }, l4), DATA_ACCESS_CONTRACT_NOT_FOUND_MESSAGE, 404);
  });
  await as(runner, s.persons.ulla, async (m) => {
    const l4 = await lineRow(m, s.lines.L4);
    await resolveItemWrite(m, 'opex', { contract_id: french }, l4);
    await refusedWith(() => resolveItemWrite(m, 'opex', { contract_id: missing }, l4), 'Contract not found.', 400);
  });
  console.log('  contract of a line: an unreadable contract answers like a missing one (404), unscoped unchanged: OK');
}

async function testTasks(runner: QueryRunner, s: Seed) {
  const { persons: p } = s;
  const q = (sql: string, params?: unknown[]) => runner.query(sql, params as any[]);
  let number = 900000 + Math.floor(Math.random() * 1000);
  const task = async (line: string, assignee: string | null, viewers: string[]) => (await q(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, assignee_user_id, owner_ids, viewer_ids)
     VALUES (app_current_tenant(), 'DA 3B task', $1, 'spend_item', $2, $3, '[]'::jsonb, $4::jsonb) RETURNING id`,
    [number++, line, assignee, JSON.stringify(viewers)],
  ))[0].id as string;
  // L5 is out of Rita's read access; she is assigned. L3 she reads only; she observes its task.
  const handed = await task(s.lines.L5, p.rita, []);
  const observed = await task(s.lines.L3, null, [p.rita]);
  await as(runner, p.rita, async (m) => {
    const repo = m.getRepository(Task);
    const existing = (await repo.findOne({ where: { id: handed } }))!;
    const write = await prepareTaskWrite(m, existing, { assignee_user_id: p.marta });
    assert.equal(write.stillFollowing, true);
    const saved = await writeTaskColumns(repo, existing, write.changes);
    assert.equal(saved.assignee_user_id, p.marta);
    assert.deepEqual(saved.viewer_ids, [p.rita], 'the person stays an observer');

    const watched = (await repo.findOne({ where: { id: observed } }))!;
    await refusedWith(() => prepareTaskWrite(m, watched, { title: 'Changed' }), DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
    // Without the pre-check, the UPDATE touches no row: the clear 403, never the task read back.
    await refusedWith(() => writeTaskColumns(repo, watched, { title: 'Changed' }), DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
  });
  await as(runner, p.marta, async (m) => {
    // L4 is Marta's: a handover there needs no observer (she reads the line).
    const own = await task(s.lines.L4, p.marta, []);
    const repo = m.getRepository(Task);
    const write = await prepareTaskWrite(m, (await repo.findOne({ where: { id: own } }))!, { assignee_user_id: p.paul });
    assert.equal(write.stillFollowing, false);
    assert.equal(write.changes.viewer_ids, undefined);
  });
  console.log('  tasks: read-only task refused (403, before and at the UPDATE), handover keeps the person as observer: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access write checks: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access write checks (lot 3, run 3B)');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      await testLineGate(runner, s);
      await testContract(runner, s);
      await testTasks(runner, s);
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
