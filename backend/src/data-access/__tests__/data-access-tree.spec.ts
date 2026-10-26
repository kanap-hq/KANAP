// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import appDataSource from '../../data-source';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { withTenantExecution } from '../../common/tenant-runner';
import {
  APP_URL,
  LIMITED_ROLE,
  PgClient,
  connect,
  parseUuidArray,
  readSettings,
  roleExists,
  sorted,
} from './data-access-test-helpers';
import { Seed, seed } from './data-access-line-seed';
import {
  AccessNodeRow,
  loadAccessTree,
  nodeCoversCenter,
  nodeCoversCompany,
  unfoldAccess,
} from '../data-access-tree';

/**
 * Data-scoped access, lot 6 (planning/data-scoped-access/spec.md §2.2, §7.2): the TypeScript
 * unfolding of the tree (`data-access-tree.ts`) is the one `data_access_apply` writes into its
 * settings. Every seeded limited person's sets are compared with the settings the function really
 * leaves in a transaction; the "who sees a company / a cost centre" predicates are checked on the
 * reference example (Alpha France, Alpha Espagne, Infrastructure, INF-FR, INF-ES).
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
let client: PgClient;
let s: Seed;

async function storedNodes(userId: string): Promise<AccessNodeRow[]> {
  await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [s.tenantId]);
  return (await client.query(
    `SELECT id, node_type, access, company_id, cost_center_id
       FROM user_data_access_nodes
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY id`,
    [s.tenantId, userId],
  )).rows as AccessNodeRow[];
}

async function appliedSettings(userId: string): Promise<Record<string, string | null>> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    await client.query(`SELECT data_access_apply($1)`, [userId]);
    return await readSettings(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

function asSet(literal: string | null): Set<string> {
  return new Set(parseUuidArray(literal));
}

async function testUnfolding() {
  const tree = await loadAccessTree({ query: async (sql, params) => (await client.query(sql, params)).rows }, s.tenantId);
  for (const person of ['marta', 'paul', 'rita', 'claire', 'rob', 'nina'] as const) {
    const userId = s.persons[person];
    const nodes = await storedNodes(userId);
    const unfolded = unfoldAccess(nodes, tree);
    const settings = await appliedSettings(userId);
    assert.equal(settings['app.da_read_all'] === 'true', unfolded.readAll, `${person}: read_all`);
    assert.equal(settings['app.da_edit_all'] === 'true', unfolded.editAll, `${person}: edit_all`);
    assert.deepEqual(sorted(parseUuidArray(settings['app.da_read_companies'])), sorted([...unfolded.readCompanies]), `${person}: read companies`);
    assert.deepEqual(sorted(parseUuidArray(settings['app.da_edit_companies'])), sorted([...unfolded.editCompanies]), `${person}: edit companies`);
    assert.deepEqual(sorted(parseUuidArray(settings['app.da_read_nodes'])), sorted([...unfolded.readCenters]), `${person}: read nodes`);
    assert.deepEqual(sorted(parseUuidArray(settings['app.da_edit_nodes'])), sorted([...unfolded.editCenters]), `${person}: edit nodes`);
    assert.deepEqual(
      sorted(parseUuidArray(settings['app.da_edit_node_companies'])),
      sorted([...unfolded.editCenterCompanies]),
      `${person}: edit node companies`,
    );
  }
  console.log('  the TS unfolding equals the settings of data_access_apply for the six seeded persons: OK');
}

async function testWhoSeesPredicates() {
  const tree = await loadAccessTree({ query: async (sql, params) => (await client.query(sql, params)).rows }, s.tenantId);
  const nodesOf = async (person: keyof Seed['persons']) => storedNodes(s.persons[person]);

  // Company ES: Marta (company node), Paul and Rita (group INF covers INF-ES), Claire and Rob
  // (Tout). Nina sees no part of it.
  const seesCompany = async (person: keyof Seed['persons']) =>
    (await nodesOf(person)).some((node) => nodeCoversCompany(node, s.es, tree));
  assert.equal(await seesCompany('marta'), true, 'Marta sees Alpha Espagne');
  assert.equal(await seesCompany('paul'), true, 'Paul sees Alpha Espagne through INF');
  assert.equal(await seesCompany('rita'), true, 'Rita sees Alpha Espagne through INF');
  assert.equal(await seesCompany('claire'), true, 'Claire sees all');
  assert.equal(await seesCompany('rob'), true, 'Rob sees all');
  assert.equal(await seesCompany('nina'), false, 'Nina has no node');

  // Company FR: the group nodes cover INF-FR; Marta's company node ES covers no FR centre.
  assert.equal((await nodesOf('marta')).some((node) => nodeCoversCompany(node, s.fr, tree)), false, 'Marta does not see Alpha France');
  assert.equal((await nodesOf('paul')).some((node) => nodeCoversCompany(node, s.fr, tree)), true, 'Paul sees Alpha France through INF');
  assert.equal((await nodesOf('rita')).some((node) => nodeCoversCompany(node, s.fr, tree)), true, 'Rita sees Alpha France through INF');

  // Cost centre INF-FR: direct for Rita (edit). Paul inherits from INF (read). Claire through Tout.
  const infFr = tree.centers.get(s.infFr)!;
  const inf = tree.centers.get(s.inf)!;
  const marta = await nodesOf('marta');
  const paul = await nodesOf('paul');
  const rita = await nodesOf('rita');
  const claire = await nodesOf('claire');
  assert.equal(marta.some((node) => nodeCoversCenter(node, infFr, tree).covered), false, 'Marta does not see INF-FR');
  assert.equal(paul.some((node) => nodeCoversCenter(node, infFr, tree).covered), true, 'Paul sees INF-FR through INF');
  assert.equal(rita.some((node) => nodeCoversCenter(node, infFr, tree).covered), true, 'Rita sees INF-FR directly');
  assert.equal(claire.some((node) => nodeCoversCenter(node, infFr, tree).covered), true, 'Claire sees INF-FR through Tout');
  // The group itself is covered by its own node and by Tout, not by a company node.
  assert.equal(inf.kind, 'group');
  assert.equal(rita.some((node) => node.node_type === 'cost_center' && node.cost_center_id === s.inf), true, 'Rita names INF itself');
  assert.equal(paul.some((node) => nodeCoversCenter(node, inf, tree).covered), true, 'Paul sees the group INF');
  console.log('  company and cost-centre coverage on the reference example: OK');
}

async function cleanup() {
  if (!s) return;
  await withTenantExecution(dataSource, s.tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
    .catch((error) => console.error(`could not purge ${s.tenantId}:`, error));
  await client.query(`DELETE FROM tenants WHERE id = $1`, [s.tenantId])
    .catch((error: unknown) => console.error(`could not delete ${s.tenantId}:`, error));
}

async function run() {
  client = await connect(APP_URL);
  await dataSource.initialize();
  try {
    const hasRole = await roleExists(client);
    console.log(`data access tree (role ${hasRole ? 'installed' : 'absent'})`);
    if (!hasRole) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log('data access tree: role absent, skipped');
      return;
    }
    await client.query('BEGIN');
    try {
      s = await seed(client);
      await client.query('COMMIT');
      await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [s.tenantId]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    await testUnfolding();
    await testWhoSeesPredicates();
    console.log('data access tree: all passed');
  } finally {
    try {
      await cleanup();
    } finally {
      await dataSource.destroy();
      await client.end();
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
