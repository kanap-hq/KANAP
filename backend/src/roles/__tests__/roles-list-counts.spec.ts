import * as assert from 'node:assert/strict';
import { userAssignedRolesSql } from '../../users/user-access-sql';
import { RolesController } from '../roles.controller';
import { RolesService } from '../roles.service';

/**
 * The roles list counts people with one GROUP BY: the primary role and `user_roles`, each person
 * once (`userAssignedRolesSql`). A count per role used to run at once on the request's single
 * connection, which node-postgres warns about (`client.query() when the client is already
 * executing a query`; an error in pg 9). The fake connection below fails the spec when two of its
 * queries are in flight together.
 */

type CountRow = { role_id: string; user_count: number | string };

function requestConnection(opts: { roles: Array<Record<string, unknown>>; counts: CountRow[] }) {
  let busy = 0;
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  async function occupy<T>(sql: string, work: () => T, params?: unknown[]): Promise<T> {
    if (busy > 0) throw new Error('client.query() when the client is already executing a query');
    busy += 1;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      calls.push({ sql, params });
      return work();
    } finally {
      busy -= 1;
    }
  }
  const manager = {
    query(sql: string, params?: unknown[]) {
      return occupy(sql, () => (/from\s+user_roles/i.test(sql) ? opts.counts : []), params);
    },
    getRepository(entity: { name?: string }) {
      const name = entity?.name ?? 'unknown';
      return {
        find: () => occupy(`find ${name}`, () => (name === 'Role' ? opts.roles : [])),
        count: () => occupy(`count ${name}`, () => 0),
      };
    },
  };
  return { manager, calls };
}

function controllerFor(manager: object) {
  const unused = { manager: { getRepository() { throw new Error('the request manager is the one to use'); } } };
  return new RolesController(
    new RolesService(unused as never, unused as never),
    {} as never,
    {} as never,
    {} as never,
    { manager } as never,
    {} as never,
  );
}

async function testGuardRejectsTwoQueriesAtOnce() {
  const { manager } = requestConnection({ roles: [], counts: [] });
  await assert.rejects(
    () => Promise.all([manager.query('SELECT 1'), manager.query('SELECT 2')]),
    /already executing a query/,
  );
}

async function testRolesListCountsWithOneGroupedQuery() {
  const roles = [
    { id: '11111111-1111-4111-8111-111111111111', role_name: 'Administrator', role_description: null, is_system: true },
    { id: '22222222-2222-4222-8222-222222222222', role_name: 'Reader', role_description: 'Reads', is_system: false },
  ];
  const { manager, calls } = requestConnection({
    roles,
    counts: [{ role_id: roles[0].id, user_count: '4' }],
  });
  const result = await controllerFor(manager).getRoles({ queryRunner: { manager } });
  assert.equal(result.items[0].is_system, true);
  assert.deepEqual(
    result.items.map((role) => ({ role_name: role.role_name, user_count: role.user_count })),
    [
      { role_name: 'Administrator', user_count: 4 },
      { role_name: 'Reader', user_count: 0 },
    ],
  );
  const grouped = calls.filter((call) => /user_roles/i.test(call.sql));
  assert.equal(grouped.length, 1, 'one count for the whole list');
  assert.ok(grouped[0].sql.includes(userAssignedRolesSql('u')), 'the primary role and user_roles, the same union as the people list');
  assert.match(grouped[0].sql, /COUNT\(DISTINCT u\.id\)/);
  assert.match(grouped[0].sql, /FROM users u/);
  assert.match(grouped[0].sql, /GROUP BY assigned\.role_id/);
  assert.match(grouped[0].sql, /u\.tenant_id = app_current_tenant\(\)/);
  assert.deepEqual(grouped[0].params, [roles.map((role) => role.id)]);
  assert.equal(calls.filter((call) => call.sql.startsWith('count ')).length, 0);
}

async function testEmptyRoleListSkipsTheCount() {
  const { manager, calls } = requestConnection({ roles: [], counts: [{ role_id: 'x', user_count: 9 }] });
  const result = await controllerFor(manager).getRoles({ queryRunner: { manager } });
  assert.deepEqual(result.items, []);
  assert.equal(calls.some((call) => /user_roles/i.test(call.sql)), false);
}

async function run() {
  await testGuardRejectsTwoQueriesAtOnce();
  await testRolesListCountsWithOneGroupedQuery();
  await testEmptyRoleListSkipsTheCount();
  console.log('roles-list-counts.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
