// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { readDataAccessProfile } from '../data-access-profile';
import {
  APP_URL,
  PgClient,
  connect,
  seedNodes,
  seedPerson,
  seedRole,
  seedTree,
} from './data-access-test-helpers';

/**
 * The `dataAccess` part of `GET /auth/me` (planning/data-scoped-access/spec.md §6.7, §8): shape,
 * mode `all`, Administrator in mode `limited` (reads as `all`), and a limited person with a company,
 * a group, a centre and an "all" node. Runs as the application role in a rolled-back transaction.
 */

const AVAILABLE = { available: true, missing: [] };

function managerOf(client: PgClient) {
  return { query: async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows };
}

async function main(): Promise<void> {
  const client = await connect(APP_URL);
  try {
    await client.query('BEGIN');
    const tree = await seedTree(client);
    const reader = await seedRole(client, tree.tenantId, 'Reader');
    const admin = await seedRole(client, tree.tenantId, ' Administrator ');
    const manager = managerOf(client);

    // Mode all: no node, the modules and the availability as given.
    const everyone = await seedPerson(client, tree.tenantId, 'all', reader);
    await seedNodes(client, tree.tenantId, everyone, [{ type: 'company', id: tree.companies.c1, access: 'read' }]);
    assert.deepEqual(await readDataAccessProfile(manager, everyone, AVAILABLE), {
      available: true,
      modules: ['budget', 'contracts'],
      mode: 'all',
      nodes: [],
    });

    // Administrator: all, whatever the column says.
    const administrator = await seedPerson(client, tree.tenantId, 'limited', admin);
    await seedNodes(client, tree.tenantId, administrator, [{ type: 'company', id: tree.companies.c1, access: 'edit' }]);
    const adminProfile = await readDataAccessProfile(manager, administrator, { available: false, missing: ['role'] });
    assert.equal(adminProfile.mode, 'all', 'an Administrator reads as all');
    assert.deepEqual(adminProfile.nodes, []);
    assert.equal(adminProfile.available, false, 'availability passed through');

    // Limited: an all node first, then companies, then centres and groups, with names.
    const limited = await seedPerson(client, tree.tenantId, 'limited', reader);
    await seedNodes(client, tree.tenantId, limited, [
      { type: 'cost_center', id: tree.nodes.k1, access: 'edit' },
      { type: 'cost_center', id: tree.nodes.g1, access: 'read' },
      { type: 'company', id: tree.companies.c2, access: 'read' },
      { type: 'all', access: 'read' },
    ]);
    const { rows: names } = await client.query(`SELECT id, name FROM companies WHERE id = $1`, [tree.companies.c2]);
    const profile = await readDataAccessProfile(manager, limited, AVAILABLE);
    assert.equal(profile.mode, 'limited');
    assert.deepEqual(profile.modules, ['budget', 'contracts']);
    assert.deepEqual(profile.nodes, [
      { type: 'all', id: null, name: null, access: 'read' },
      { type: 'company', id: tree.companies.c2, name: names[0].name, access: 'read' },
      { type: 'cost_center', id: tree.nodes.g1, code: 'G1', name: 'G1', kind: 'group', access: 'read' },
      { type: 'cost_center', id: tree.nodes.k1, code: 'K1', name: 'K1', kind: 'cost_center', access: 'edit' },
    ]);

    // Limited with no node: limited, empty list (never everything).
    const nobody = await seedPerson(client, tree.tenantId, 'limited', reader);
    const empty = await readDataAccessProfile(manager, nobody, AVAILABLE);
    assert.equal(empty.mode, 'limited');
    assert.deepEqual(empty.nodes, []);

    console.log('data-access-profile.spec: all passed');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
