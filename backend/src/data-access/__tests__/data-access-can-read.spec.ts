// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { LIMITED_ROLE, NodeSpec, PgClient, roleExists, seedNodes, seedPerson, seedRole, seedTree, sorted, sqlStateIn } from './data-access-test-helpers';
import { ALL, applyPerson, EXPECTED, LABELS, LimitedPerson, nextItemNumber, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 4 run 4C (planning/data-scoped-access/spec.md §5.6, §6.6):
 * `data_access_can_read(p_user, p_type, p_id)`.
 *
 * - Unfolding: on the tree of `data-access-apply.spec.ts`, for each person (company, group, centre,
 *   mixed read and edit nodes, all in read or edit, no node), the lines the function says the
 *   person can read are exactly those the person reads after `data_access_apply` (one line per
 *   centre and per company).
 * - Reference example of lot 2 (`data-access-line-seed.ts`): every limited person reads the lines
 *   of EXPECTED, participations included (Nina, owner of L6 and L7); the Administrator and Ulla
 *   (mode all) read everything; an unknown person reads nothing; an unknown type raises 22023; an
 *   object that does not exist gives NULL.
 * - Tasks: on L1, which Marta cannot read, she reads the tasks she is assignee, owner or observer
 *   of, not the one she only created; a task without object, yes; a contract task follows the
 *   contract (lisible_contrat). From lot 5 a contract follows the same rule: its company, its
 *   place, its owner, or one of its readable lines.
 * - Caller limited: the object must be visible to the caller, otherwise NULL; the limited role
 *   can execute the function. Role taken without context: NULL.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

async function canRead(client: PgClient, user: string, type: string, id: string): Promise<boolean | null> {
  return (await client.query(`SELECT data_access_can_read($1, $2, $3) AS r`, [user, type, id])).rows[0].r;
}

async function inSavepoint<T>(client: PgClient, fn: () => Promise<T>): Promise<T> {
  await client.query('SAVEPOINT can_read_spec');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT can_read_spec');
  }
}

async function testUnfoldingMatchesApply(client: PgClient): Promise<void> {
  const tree = await seedTree(client);
  const { c1, c2, c3 } = tree.companies;
  const { g1, g1a, k1, k2, k3, k4, k5 } = tree.nodes;
  const member = await seedRole(client, tree.tenantId, 'Member');
  const lines: string[] = [];
  const line = async (company: string | null, centre: string | null) => {
    const { rows } = await client.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id)
       VALUES ($1, 'Unfolding line', 'EUR', '2026-01-01', $2, $3, $4) RETURNING id`,
      [tree.tenantId, nextItemNumber(), company, centre],
    );
    lines.push(rows[0].id);
  };
  for (const centre of [k1, k2, k3, k4, k5]) await line(null, centre);
  for (const company of [c1, c2, c3]) await line(company, null);
  await line(null, null);

  const cases: Array<[string, NodeSpec[]]> = [
    ['mixed (apply spec P)', [
      { type: 'company', id: c1, access: 'read' },
      { type: 'cost_center', id: g1a, access: 'edit' },
      { type: 'cost_center', id: k5, access: 'read' },
    ]],
    ['mixed (apply spec Q)', [
      { type: 'cost_center', id: g1, access: 'read' },
      { type: 'company', id: c2, access: 'edit' },
    ]],
    ['company in edit', [{ type: 'company', id: c1, access: 'edit' }]],
    ['centre in read', [{ type: 'cost_center', id: k1, access: 'read' }]],
    ['all in read', [{ type: 'all', access: 'read' }]],
    ['all in edit', [{ type: 'all', access: 'edit' }]],
    ['no node', []],
  ];
  for (const [label, nodes] of cases) {
    const person = await seedPerson(client, tree.tenantId, 'limited', member);
    await seedNodes(client, tree.tenantId, person, nodes);
    const applied = await inSavepoint(client, async () => {
      assert.equal(await applyPerson(client, person), 'limited');
      return (await client.query(`SELECT id::text FROM spend_items WHERE tenant_id = $1`, [tree.tenantId])).rows.map((r) => r.id);
    });
    const answered: string[] = [];
    for (const id of lines) if (await canRead(client, person, 'spend_item', id)) answered.push(id);
    assert.deepEqual(sorted(answered), sorted(applied), `${label}: data_access_can_read unfolds the nodes as data_access_apply`);
  }
  console.log(`  unfolding: ${cases.length} node sets, the lines answered are those data_access_apply shows: OK`);
}

async function testReferenceExample(client: PgClient): Promise<void> {
  const s = await seed(client);
  const persons: Array<LimitedPerson | 'admin' | 'ulla'> = ['marta', 'paul', 'rita', 'claire', 'rob', 'nina', 'admin', 'ulla'];
  for (const person of persons) {
    const expected = person === 'admin' || person === 'ulla' ? ALL : EXPECTED[person].readable;
    for (const label of LABELS) {
      assert.equal(await canRead(client, s.persons[person], 'spend_item', s.lines[label]), expected.includes(label), `${person} reads ${label}: ${expected.includes(label)}`);
    }
  }
  assert.equal(await canRead(client, randomUUID(), 'spend_item', s.lines.L1), false, 'unknown person: false');
  assert.equal(await canRead(client, s.persons.ulla, 'spend_item', randomUUID()), null, 'unknown line: NULL');
  assert.equal(await sqlStateIn(client, () => canRead(client, s.persons.ulla, 'line', s.lines.L1)), '22023', 'unknown type');

  const q = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows;
  const task = async (title: string, type: string | null, objectId: string | null, cols: Record<string, unknown> = {}) => {
    const names = Object.keys(cols);
    return (await q(
      `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id${names.map((n) => `, ${n}`).join('')})
       VALUES ($1, $2, $3, $4, $5${names.map((_n, i) => `, $${i + 6}`).join('')}) RETURNING id`,
      [s.tenantId, title, nextItemNumber(), type, objectId, ...names.map((n) => cols[n])],
    ))[0].id as string;
  };
  const marta = s.persons.marta;
  const tasks = {
    assignee: await task('L1, Marta assignee', 'spend_item', s.lines.L1, { assignee_user_id: marta }),
    owner: await task('L1, Marta owner', 'spend_item', s.lines.L1, { owner_ids: JSON.stringify([marta]) }),
    observer: await task('L1, Marta observer', 'spend_item', s.lines.L1, { viewer_ids: JSON.stringify([marta]) }),
    creator: await task('L1, Marta creator', 'spend_item', s.lines.L1, { creator_id: marta }),
    free: await task('No object', null, null),
  };
  const supplier = (await q(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Can read supplier') RETURNING id`, [s.tenantId]))[0].id;
  const contract = async (company: string, centre: string | null) => (await q(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, cost_center_id)
     VALUES ($1, 'Can read contract', $2, $3, '2026-01-01', $4) RETURNING id`,
    [s.tenantId, company, supplier, centre],
  ))[0].id as string;
  const cf = await contract(s.fr, s.infFr);
  const ce = await contract(s.es, null);
  const cfTask = await task('Contract FR', 'contract', cf);
  const ceTask = await task('Contract ES', 'contract', ce);

  const expectations: Array<[string, string, string, boolean]> = [
    ['marta', 'task', tasks.assignee, true],
    ['marta', 'task', tasks.owner, true],
    ['marta', 'task', tasks.observer, true],
    ['marta', 'task', tasks.creator, false],
    ['marta', 'task', tasks.free, true],
    ['marta', 'task', cfTask, false],
    ['marta', 'task', ceTask, true],
    ['paul', 'task', tasks.creator, true],
    ['paul', 'task', cfTask, true],
    ['nina', 'task', cfTask, false],
    ['admin', 'task', tasks.creator, true],
    ['marta', 'contract', ce, true],
    ['marta', 'contract', cf, false],
    ['paul', 'contract', cf, true],
    ['nina', 'contract', ce, false],
    ['nina', 'contract', cf, false],
    ['rob', 'contract', cf, true],
    ['admin', 'contract', ce, true],
  ];
  for (const [person, type, id, expected] of expectations) {
    assert.equal(await canRead(client, s.persons[person as keyof typeof s.persons], type, id), expected, `${person} reads ${type} ${id}: ${expected}`);
  }
  assert.equal(await canRead(client, marta, 'contract', randomUUID()), null, 'unknown contract: NULL');
  assert.equal(await canRead(client, marta, 'task', randomUUID()), null, 'unknown task: NULL');
  console.log('  reference example: lines of EXPECTED, participations, Administrator, mode all, unknown person, tasks and contracts: OK');

  // A limited caller asks from an object it sees; otherwise NULL. The limited role executes it.
  await inSavepoint(client, async () => {
    assert.equal(await applyPerson(client, marta), 'limited');
    assert.equal(await canRead(client, s.persons.ulla, 'spend_item', s.lines.L1), null, 'Marta asks about L1, which she cannot read: NULL');
    assert.equal(await canRead(client, s.persons.ulla, 'spend_item', s.lines.L4), true, 'Marta asks about L4 for Ulla');
    assert.equal(await canRead(client, s.persons.paul, 'spend_item', s.lines.L4), true, 'Paul reads L4');
    assert.equal(await canRead(client, s.persons.nina, 'spend_item', s.lines.L4), false, 'Nina does not read L4');
    assert.equal(await canRead(client, s.persons.paul, 'task', tasks.creator), null, 'a task Marta only created on L1: hidden from her, NULL');
    assert.equal(await canRead(client, s.persons.nina, 'task', tasks.observer), false, 'Marta observes the task; Nina cannot read it');
    assert.equal(await canRead(client, s.persons.paul, 'task', tasks.observer), true);
    assert.equal(await canRead(client, s.persons.nina, 'contract', ce), false, 'Marta reads CE: Nina, who does not, is false');
    assert.equal(await canRead(client, s.persons.ulla, 'contract', cf), null, 'Marta asks about CF, which she cannot read: NULL');
    assert.equal(await canRead(client, s.persons.ulla, 'contract', ce), true, 'Marta asks about CE for Ulla');
  });
  await inSavepoint(client, async () => {
    await client.query(`SET LOCAL ROLE ${LIMITED_ROLE}`);
    assert.equal(await canRead(client, s.persons.ulla, 'spend_item', s.lines.L1), null, 'role without context: NULL');
  });
  console.log('  limited caller: NULL for an object out of its access, answers otherwise; role without context: NULL: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const client = clientOf(runner);
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access can_read: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data_access_can_read (lot 4, run 4C)');
    await runner.startTransaction();
    try {
      await testUnfoldingMatchesApply(client);
      await testReferenceExample(client);
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
