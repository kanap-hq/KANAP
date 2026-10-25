// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { PlacementOptions, readPlacementOptions } from '../placement-options';
import { LIMITED_ROLE, NodeSpec, PgClient, roleExists, seedNodes, seedPerson, seedRole } from './data-access-test-helpers';
import { Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 3 run 3D (planning/data-scoped-access/spec.md §2.3, §7.7): the placement
 * options the line's company and cost-center pickers propose (`GET /data-access/placement-options`),
 * on the reference example of lot 2, each person in a savepoint after `applyDataAccess`.
 *
 * - a limited person gets the companies and cost centers of their edit access, and each one is a
 *   placement `data_access_placable_line` accepts; a read-only access proposes nothing;
 * - `editNodes` carries the edit nodes unfolded, groups and sub-groups included (the contract place
 *   picker); `costCenters` keeps the cost centers only (a line takes no group);
 * - Edit on everything answers `all: true`;
 * - an unscoped person (mode all, or Administrator) gets `{ limited: false }`, with no query beyond
 *   the mode.
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

async function placable(m: EntityManager, companyId: string, costCenterId: string | null): Promise<boolean> {
  const [row] = await m.query(`SELECT data_access_placable_line($1::uuid, $2::uuid) AS ok`, [companyId, costCenterId]);
  return row?.ok === true;
}

async function placableContract(m: EntityManager, companyId: string, placeId: string | null): Promise<boolean> {
  const [row] = await m.query(`SELECT data_access_placable_contract($1::uuid, $2::uuid) AS ok`, [companyId, placeId]);
  return row?.ok === true;
}

function limited(options: PlacementOptions) {
  assert.equal(options.limited, true);
  return options as Extract<PlacementOptions, { limited: true }>;
}

/** The endpoint aggregates the nodes by id: assert them in that order. */
function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

async function testOptions(runner: QueryRunner, s: Seed) {
  const { persons: p } = s;

  // Company ES in edit: the company, and the cost centers of ES the tree unfolds.
  await as(runner, p.marta, async (m) => {
    const o = limited(await readPlacementOptions(m));
    assert.equal(o.all, false);
    assert.deepEqual(o.companies, [s.es]);
    assert.deepEqual(o.costCenters, [{ id: s.infEs, companyId: s.es }]);
    assert.deepEqual(o.editNodes, [{ id: s.infEs, companyId: s.es }], 'the unfolded edit nodes');
    assert.deepEqual(o.editNodeCompanies, [s.es], 'the edit centres of the company carry its company');
    assert.equal(await placable(m, s.es, null), true);
    assert.equal(await placable(m, s.fr, null), false);
  });

  // INF-FR in edit inside INF in read: that cost center on its company only; the group (no company) is left out.
  await as(runner, p.rita, async (m) => {
    const o = limited(await readPlacementOptions(m));
    assert.equal(o.all, false);
    assert.deepEqual(o.companies, []);
    assert.deepEqual(o.costCenters, [{ id: s.infFr, companyId: s.fr }]);
    assert.deepEqual(o.editNodes, [{ id: s.infFr, companyId: s.fr }]);
    assert.deepEqual(o.editNodeCompanies, [s.fr], 'the contract rule: the edit node company');
    assert.equal(await placable(m, s.fr, s.infFr), true);
    assert.equal(await placable(m, s.es, s.infEs), false);
  });

  // A group in edit: the endpoint unfolds it, as `data_access_apply` does, so a contract may take
  // the group, its sub-groups and its centres; a line still takes the centres alone.
  const groupRole = await seedRole(clientOf(runner), s.tenantId, 'Data access group editor');
  const groupEditor = await seedPerson(clientOf(runner), s.tenantId, 'limited', groupRole);
  const groupNodes: NodeSpec[] = [{ type: 'cost_center', id: s.inf, access: 'edit' }];
  await seedNodes(clientOf(runner), s.tenantId, groupEditor, groupNodes);
  await as(runner, groupEditor, async (m) => {
    const o = limited(await readPlacementOptions(m));
    assert.deepEqual(
      o.editNodes,
      byId([
        { id: s.inf, companyId: null },
        { id: s.infEs, companyId: s.es },
        { id: s.infFr, companyId: s.fr },
      ]),
      'the group and its centres, unfolded',
    );
    assert.deepEqual(
      o.costCenters,
      byId([
        { id: s.infEs, companyId: s.es },
        { id: s.infFr, companyId: s.fr },
      ]),
      'the line picker keeps cost centers only: a group is no place for a line',
    );
    assert.deepEqual([...o.editNodeCompanies].sort(), [s.es, s.fr].sort());
    assert.equal(await placableContract(m, s.fr, s.inf), true, 'the contract may sit on the group');
    assert.equal(await placableContract(m, s.es, s.infEs), true);
    assert.equal(await placable(m, s.es, s.inf), false, 'a line may not sit on the group');
    assert.equal(await placable(m, s.es, s.infEs), true);
  });

  // Read only, and no node: nothing to place on.
  for (const person of [p.paul, p.rob, p.nina]) {
    await as(runner, person, async (m) => {
      const o = limited(await readPlacementOptions(m));
      assert.deepEqual(
        { all: o.all, companies: o.companies, costCenters: o.costCenters, editNodes: o.editNodes, editNodeCompanies: o.editNodeCompanies },
        { all: false, companies: [], costCenters: [], editNodes: [], editNodeCompanies: [] },
      );
    });
  }

  // Edit on everything: limited (totals on the access), every placement allowed.
  await as(runner, p.claire, async (m) => {
    const o = limited(await readPlacementOptions(m));
    assert.equal(o.all, true);
    assert.deepEqual(o.editNodes, []);
    assert.equal(await placable(m, s.fr, null), true);
  });
  console.log('  limited persons: edit companies, cost centers and unfolded edit nodes, each accepted by the placement functions: OK');

  // Unscoped: no query beyond the mode (applyDataAccess remembered it on the runner).
  for (const person of [p.ulla, p.admin]) {
    await as(runner, person, async (m) => {
      const original = m.query.bind(m);
      let queries = 0;
      (m as any).query = async (...args: any[]) => { queries += 1; return (original as any)(...args); };
      try {
        assert.deepEqual(await readPlacementOptions(m), { limited: false });
      } finally {
        delete (m as any).query;
      }
      assert.equal(queries, 0, 'no query for an unscoped person');
    });
  }
  console.log('  unscoped persons: { limited: false } with no query: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access placement options: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access placement options (lot 3, run 3D)');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      await testOptions(runner, s);
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
