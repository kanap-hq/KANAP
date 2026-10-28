// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import appDataSource from '../../data-source';
import { PgClient, NodeSpec, seedNodes, seedPerson, seedRole, seedTree, sorted } from './data-access-test-helpers';
import { peopleWithCostCenterAccess } from '../data-access-people';

/**
 * Data-scoped access, lot 4: `peopleWithCostCenterAccess`, the first group of the owner pickers of
 * a budget line. On the reference tree of the data-access specs (G1 > K1, G1A > K3; G2 > K4;
 * K5; companies C1, C2, C3):
 * - a node on the centre, on a parent group, on the centre's company and `all` cover it;
 * - a node on another centre does not;
 * - both groups need at least the reader right on `budget` (any role, primary or extra);
 * - a disabled person, a limited person without a node and a limited person off the centre are out;
 * - an Administrator is in without a `budget` permission row; a mode-all person is in with one.
 *
 * Needs the app role only (no data-access role switch): the statements run under RLS with the
 * tenant set, as a request does.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });

type Persons = Record<string, string>;

async function seedPersons(client: PgClient, tree: Awaited<ReturnType<typeof seedTree>>): Promise<Persons> {
  const tenantId = tree.tenantId;
  const budgetRole = await seedRole(client, tenantId, 'Budget member');
  const noBudgetRole = await seedRole(client, tenantId, 'No budget');
  const administratorRole = await seedRole(client, tenantId, 'Administrator');
  await client.query(
    `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'member')`,
    [tenantId, budgetRole],
  );

  const person = async (
    key: string,
    mode: 'all' | 'limited',
    roleId: string,
    nodes: NodeSpec[],
    status: 'enabled' | 'disabled' = 'enabled',
  ): Promise<string> => {
    const id = await seedPerson(client, tenantId, mode, roleId);
    await seedNodes(client, tenantId, id, nodes);
    await client.query(
      `UPDATE users SET first_name = $2, last_name = $3, status = $4::status_state WHERE id = $1`,
      [id, key, 'Spec', status],
    );
    return id;
  };

  return {
    onCenter: await person('on-center', 'limited', budgetRole, [{ type: 'cost_center', id: tree.nodes.k1, access: 'read' }]),
    onParent: await person('on-parent', 'limited', budgetRole, [{ type: 'cost_center', id: tree.nodes.g1, access: 'edit' }]),
    onCompany: await person('on-company', 'limited', budgetRole, [{ type: 'company', id: tree.companies.c1, access: 'read' }]),
    onAll: await person('on-all', 'limited', budgetRole, [{ type: 'all', access: 'read' }]),
    onOtherCenter: await person('on-other-center', 'limited', budgetRole, [{ type: 'cost_center', id: tree.nodes.k4, access: 'read' }]),
    noBudget: await person('no-budget', 'limited', noBudgetRole, [{ type: 'cost_center', id: tree.nodes.k1, access: 'read' }]),
    noNode: await person('no-node', 'limited', budgetRole, []),
    unscoped: await person('unscoped', 'all', budgetRole, []),
    unscopedNoBudget: await person('unscoped-no-budget', 'all', noBudgetRole, []),
    disabled: await person('disabled', 'all', budgetRole, [], 'disabled'),
    administrator: await person('administrator', 'limited', administratorRole, []),
    administratorAll: await person('administrator-all', 'all', administratorRole, []),
  };
}

async function run(): Promise<void> {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const client = {
      query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }),
    } as unknown as PgClient;
    console.log('people with cost centre access');
    await runner.startTransaction();
    try {
      const tree = await seedTree(client);
      const p = await seedPersons(client, tree);
      const manager = {
        query: async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows,
      };

      const onCenter = await peopleWithCostCenterAccess(manager, tree.tenantId, tree.nodes.k1);
      assert.deepEqual(sorted(onCenter), sorted([
        p.onCenter,
        p.onParent,
        p.onCompany,
        p.onAll,
        p.unscoped,
        p.administrator,
        p.administratorAll,
      ]), 'K1: centre, parent group, company of the centre, all, mode all with budget right, Administrators');

      const otherCenter = await peopleWithCostCenterAccess(manager, tree.tenantId, tree.nodes.k4);
      assert.deepEqual(sorted(otherCenter), sorted([
        p.onOtherCenter,
        p.onCompany,
        p.onAll,
        p.unscoped,
        p.administrator,
        p.administratorAll,
      ]), 'K4: its own node, the company C1 node, all, mode all, Administrators; the G1 group does not cover it');

      assert.deepEqual(await peopleWithCostCenterAccess(manager, tree.tenantId, randomUUID()), [], 'an unknown centre answers nothing');
      console.log('  centre, parent group, company, all, other centre, budget right, disabled, Administrator: OK');
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
