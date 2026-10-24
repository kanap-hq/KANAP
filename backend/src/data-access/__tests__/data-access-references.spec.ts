// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { TasksService } from '../../spend/tasks.service';
import { DashboardDataService } from '../../dashboard/dashboard-data.service';
import { readLineLineage } from '../../spend/budget-line-lineage';
import { LIMITED_ROLE, PgClient, roleExists, sqlStateIn } from './data-access-test-helpers';
import { nextItemNumber, Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 4 run 4A (planning/data-scoped-access/spec.md §5.4 "Champ simple",
 * §6.6): a visible object that names one line the person cannot read shows the line's reference
 * alone (`BL-n`), on the reference example of lot 2 (`data-access-line-seed.ts`).
 *
 * - Tasks (list and detail): Marta, assignee of a task on L1 (which she cannot read) and of a task
 *   on a CAPEX line of FR, reads `related_object_name` = `BL-n` with `related_object_hidden`; her
 *   task on L4 (which she reads) shows its name; Ulla (mode all) reads the names, no flag.
 * - Lineage: L4 continues L1, a CAPEX line of FR continues L2. Marta reads L4's predecessor and
 *   L2's successor as `{ id: null, reference: BL-n, nature: null, hidden: true }`; Ulla as before.
 * - `data_access_reference`: `BL-n` whatever the nature; a lineage asked from a line the person
 *   cannot read is NULL; an unknown type raises 22023.
 * - Tasks list sorted or filtered on the object: a hidden line's task by its `BL-n`.
 * - Dashboard "dormant tasks" tile: Marta's task on L1 names `BL-n` without the line's id; Ulla
 *   reads the name and the id.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

async function as<T>(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<T>): Promise<T> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    return await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

type Extra = { capex: string; capexNumber: number; numbers: Record<string, number>; tasks: { onL1: string; onL4: string; onCapex: string } };

async function seedExtra(runner: QueryRunner, s: Seed): Promise<Extra> {
  const capexNumber = nextItemNumber();
  const capex = (await runner.query(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, nature, predecessor_id)
     VALUES ($1, 'DA capex line', 'EUR', '2027-01-01', $2, $3, 'capex', $4) RETURNING id`,
    [s.tenantId, capexNumber, s.fr, s.lines.L2],
  ))[0].id as string;
  await runner.query(`UPDATE spend_items SET predecessor_id = $2 WHERE id = $1`, [s.lines.L4, s.lines.L1]);
  const numbers = Object.fromEntries((await runner.query(
    `SELECT id::text, item_number FROM spend_items WHERE tenant_id = $1`, [s.tenantId],
  )).map((r: any) => [r.id, Number(r.item_number)]));
  const task = async (title: string, type: string, objectId: string) => (await runner.query(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, assignee_user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [s.tenantId, title, nextItemNumber(), type, objectId, s.persons.marta],
  ))[0].id as string;
  return {
    capex,
    capexNumber,
    numbers,
    tasks: {
      onL1: await task('Task on L1', 'spend_item', s.lines.L1),
      onL4: await task('Task on L4', 'spend_item', s.lines.L4),
      onCapex: await task('Task on the CAPEX line', 'capex_item', capex),
    },
  };
}

async function testTasks(runner: QueryRunner, s: Seed, x: Extra): Promise<void> {
  const svc = new TasksService(undefined as any);
  const read = async (m: EntityManager) => {
    const list = await svc.listAllTasks({ page: 1, limit: 100 }, { manager: m, tenantId: s.tenantId });
    const byId = new Map(list.items.map((row) => [row.id, row] as const));
    const detail = await svc.getOne(x.tasks.onL1, { manager: m, tenantId: s.tenantId });
    return { byId, detail };
  };
  const pick = (row: any) => ({ name: row?.related_object_name, hidden: row?.related_object_hidden, reference: row?.related_object_reference });
  /** The line id a row carries: none for a hidden line (review M1), as Plaid, MCP and the export. */
  const lineId = (row: any) => row?.related_object_id;

  const marta = await as(runner, s.persons.marta, read);
  const bl = (id: string) => `BL-${x.numbers[id]}`;
  assert.deepEqual(pick(marta.byId.get(x.tasks.onL1)), { name: bl(s.lines.L1), hidden: true, reference: undefined }, 'Marta: the task on L1 names BL-n');
  assert.deepEqual(pick(marta.byId.get(x.tasks.onCapex)), { name: `BL-${x.capexNumber}`, hidden: true, reference: undefined }, 'a CAPEX line too');
  assert.deepEqual(pick(marta.byId.get(x.tasks.onL4)), { name: `DA line L4 ${s.tenantId.slice(0, 8)}`, hidden: undefined, reference: undefined }, 'a line she reads: its name');
  assert.deepEqual(pick(marta.detail), { name: bl(s.lines.L1), hidden: true, reference: undefined }, 'the detail as the list');
  assert.equal(lineId(marta.byId.get(x.tasks.onL1)), null, 'Marta: no id of the hidden line in the list');
  assert.equal(lineId(marta.byId.get(x.tasks.onCapex)), null, 'nor of the hidden CAPEX line');
  assert.equal(lineId(marta.detail), null, 'nor in the detail');
  assert.equal(lineId(marta.byId.get(x.tasks.onL4)), s.lines.L4, 'a line she reads keeps its id');

  const ulla = await as(runner, s.persons.ulla, read);
  assert.deepEqual(pick(ulla.byId.get(x.tasks.onL1)), { name: `DA line L1 ${s.tenantId.slice(0, 8)}`, hidden: undefined, reference: undefined }, 'Ulla: the name, no flag');
  assert.deepEqual(pick(ulla.detail), pick(ulla.byId.get(x.tasks.onL1)));
  assert.equal(lineId(ulla.detail), s.lines.L1, 'Ulla: the id');
  assert.ok([...ulla.byId.values()].every((row) => !('related_object_hidden' in row) && !('related_object_reference' in row)), 'unscoped rows unchanged');
  console.log('  tasks: a hidden line shows as BL-n with related_object_hidden and no id (list and detail); unscoped unchanged: OK');
}

async function testLineage(runner: QueryRunner, s: Seed, x: Extra): Promise<void> {
  const lineage = (m: EntityManager, id: string) => readLineLineage(m, s.tenantId, id);
  const bl = (id: string) => `BL-${x.numbers[id]}`;

  const marta = await as(runner, s.persons.marta, async (m) => ({
    l4: await lineage(m, s.lines.L4),
    l2: await lineage(m, s.lines.L2),
    l3: await lineage(m, s.lines.L3),
    fromHidden: (await m.query(`SELECT data_access_reference('line_predecessor', $1) AS r`, [s.lines.L1]))[0].r,
  }));
  assert.deepEqual(marta.l4, { predecessor: { id: null, reference: bl(s.lines.L1), nature: null, hidden: true }, successor: null }, 'Marta: L4 follows a line she cannot read');
  assert.deepEqual(marta.l2, { predecessor: null, successor: { id: null, reference: bl(x.capex), nature: null, hidden: true, from_year: null } }, 'Marta: L2 is replaced by a line she cannot read');
  assert.deepEqual(marta.l3, { predecessor: null, successor: null });
  assert.equal(marta.fromHidden, null, 'the lineage of a line she cannot read: NULL');

  const ulla = await as(runner, s.persons.ulla, async (m) => ({ l4: await lineage(m, s.lines.L4), l2: await lineage(m, s.lines.L2) }));
  assert.deepEqual(ulla.l4, { predecessor: { id: s.lines.L1, reference: bl(s.lines.L1), nature: 'opex' }, successor: null });
  assert.deepEqual(ulla.l2, { predecessor: null, successor: { id: x.capex, reference: bl(x.capex), nature: 'capex', from_year: 2027 } });

  const client = clientOf(runner);
  assert.equal(await sqlStateIn(client, () => client.query(`SELECT data_access_reference('line', $1)`, [s.lines.L1])), '22023', 'unknown type');
  const unscoped = (await runner.query(
    `SELECT data_access_reference('task', $1) AS capex, data_access_reference('line_successor', $2) AS successor`, [x.tasks.onCapex, s.lines.L2],
  ))[0];
  assert.deepEqual(unscoped, { capex: `BL-${x.capexNumber}`, successor: bl(x.capex) }, 'BL-n whatever the nature');
  console.log('  lineage: a hidden predecessor or successor shows as BL-n without id; data_access_reference gives BL-n: OK');
}

async function testTaskSortAndFilter(runner: QueryRunner, s: Seed, x: Extra): Promise<void> {
  const svc = new TasksService(undefined as any);
  const ours = new Set(Object.values(x.tasks));
  const ids = async (m: EntityManager, query: Record<string, unknown>) => (await svc.listAllTasks({ page: 1, limit: 100, ...query }, { manager: m, tenantId: s.tenantId }))
    .items.map((row) => row.id).filter((id) => ours.has(id));
  const marta = await as(runner, s.persons.marta, async (m) => ({
    sorted: await ids(m, { sort: 'related_object_name:ASC' }),
    filtered: await ids(m, { filters: JSON.stringify({ related_object_name: { filter: `BL-${x.numbers[s.lines.L1]}` } }) }),
  }));
  // BL-n sorts before "DA line L4 …"; without the reference the hidden lines' tasks came last (NULL).
  assert.equal(marta.sorted[2], x.tasks.onL4, `Marta: the hidden lines' tasks sort by BL-n, before L4's: ${marta.sorted.join(', ')}`);
  assert.ok(marta.filtered.includes(x.tasks.onL1), 'Marta: the filter finds the task by BL-n');
  assert.ok(!marta.filtered.includes(x.tasks.onL4), 'and not a task on another line');
  console.log('  tasks list: a hidden line sorts and filters by its BL-n: OK');
}

async function testStaleTasks(runner: QueryRunner, s: Seed, x: Extra): Promise<void> {
  const svc = new DashboardDataService();
  // A threshold of -1 day takes every open task, the seed's included (updated just now).
  const read = (person: string) => as(runner, person, async (m) => new Map(
    (await svc.getStaleTasks(person, 'all', -1, 100, { manager: m })).map((row) => [row.id, row] as const),
  ));
  const pick = (row: any) => ({ id: row?.relatedObjectId, name: row?.relatedObjectName });

  const marta = await read(s.persons.marta);
  assert.deepEqual(pick(marta.get(x.tasks.onL1)), { id: null, name: `BL-${x.numbers[s.lines.L1]}` }, 'Marta: the dormant task on L1 names BL-n, no id');
  assert.deepEqual(pick(marta.get(x.tasks.onCapex)), { id: null, name: `BL-${x.capexNumber}` }, 'a CAPEX line too');
  assert.deepEqual(pick(marta.get(x.tasks.onL4)), { id: s.lines.L4, name: `DA line L4 ${s.tenantId.slice(0, 8)}` }, 'a line she reads: its name and id');

  const ulla = await read(s.persons.ulla);
  assert.deepEqual(pick(ulla.get(x.tasks.onL1)), { id: s.lines.L1, name: `DA line L1 ${s.tenantId.slice(0, 8)}` }, 'Ulla: the name and the id');
  console.log('  dashboard dormant tasks: a hidden line shows as BL-n without id; unscoped unchanged: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access references: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access references of invisible lines (lot 4, run 4A)');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      const x = await seedExtra(runner, s);
      await testLineage(runner, s, x);
      await testTasks(runner, s, x);
      await testStaleTasks(runner, s, x);
      await testTaskSortAndFilter(runner, s, x);
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
