import * as assert from 'node:assert/strict';
import { PortfolioRequestsService } from '../portfolio-requests.service';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';
import { PortfolioDependenciesService } from '../services/portfolio-dependencies.service';

/**
 * Replacing a request's or a project's team, applications, assets or budget lines reads the names
 * before and after on the request's connection. Two queries in flight at once are the
 * node-postgres warning (`client.query() when the client is already executing a query`).
 *
 * The history specs of these services run against PostgreSQL. This one is the connection guard:
 * each replacement keeps one id and drops another, so both name reads run.
 */
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRJ = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const USER_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const APP_A = '11111111-1111-4111-8111-111111111111';
const APP_B = '22222222-2222-4222-8222-222222222222';
const ASSET_A = '33333333-3333-4333-8333-333333333333';
const ASSET_B = '44444444-4444-4444-8444-444444444444';
const LINE_A = '55555555-5555-4555-8555-555555555555';
const LINE_B = '66666666-6666-4666-8666-666666666666';

const ACTOR = { manager: null as unknown, userId: USER_A };

function connection() {
  let busy = 0;
  const queries: string[] = [];
  async function occupy<T>(sql: string, work: () => T): Promise<T> {
    if (busy > 0) throw new Error('client.query() when the client is already executing a query');
    busy += 1;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      if (sql) queries.push(sql);
      return work();
    } finally {
      busy -= 1;
    }
  }
  const idList = (params: unknown[] = []) => (params.find((param) => Array.isArray(param)) as string[] | undefined) ?? [];
  const manager = {
    query: (sql: string, params: unknown[] = []) => occupy(sql, () => {
      if (/current_setting\('app\.da_mode'/.test(sql)) return [{ limited: false }];
      if (/FOR NO KEY UPDATE/.test(sql)) return [1];
      if (/\bDELETE FROM\b|\bINSERT INTO\b/i.test(sql)) return [];
      if (/FROM portfolio_request_applications/i.test(sql) && !/JOIN/i.test(sql)) {
        return [{ id: '1', application_id: APP_A }, { id: '2', application_id: APP_B }];
      }
      if (/FROM portfolio_request_assets/i.test(sql) && !/JOIN/i.test(sql)) {
        return [{ id: '1', asset_id: ASSET_A }, { id: '2', asset_id: ASSET_B }];
      }
      if (/FROM application_projects/i.test(sql) && !/JOIN/i.test(sql)) {
        return [{ application_id: APP_A }, { application_id: APP_B }];
      }
      if (/FROM asset_projects/i.test(sql) && !/JOIN/i.test(sql)) {
        return [{ asset_id: ASSET_A }, { asset_id: ASSET_B }];
      }
      const ids = idList(params).map((id) => String(id).toLowerCase());
      if (/FROM users/i.test(sql)) return ids.map((id) => ({ id, first_name: 'Ann', last_name: id.slice(0, 4), email: null }));
      if (/FROM applications/i.test(sql)) return ids.map((id) => ({ id, name: `App ${id.slice(0, 4)}` }));
      if (/FROM assets/i.test(sql)) return ids.map((id) => ({ id, name: `Asset ${id.slice(0, 4)}` }));
      if (/spend_items/i.test(sql)) return ids.map((id) => ({ id, product_name: `Line ${id.slice(0, 4)}`, description: null }));
      return [];
    }),
    getRepository(entity: { name?: string }) {
      const name = entity?.name ?? '';
      return {
        find: () => occupy('', () => {
          if (name === 'PortfolioRequestTeam' || name === 'PortfolioProjectTeam') {
            return [
              { user_id: USER_A, request_id: REQ, project_id: PRJ, role: 'business_team' },
              { user_id: USER_B, request_id: REQ, project_id: PRJ, role: 'business_team' },
            ];
          }
          if (name === 'PortfolioRequestOpex' || name === 'PortfolioProjectOpex') {
            return [
              { opex_id: LINE_A, request_id: REQ, project_id: PRJ },
              { opex_id: LINE_B, request_id: REQ, project_id: PRJ },
            ];
          }
          return [];
        }),
        findOne: (opts?: { where?: { id?: string } }) => occupy('', () => ({
          id: opts?.where?.id,
          tenant_id: TENANT,
          name: 'Record',
        })),
        create: (row: unknown) => row,
        save: (row: unknown) => occupy('', () => row),
        remove: (row: unknown) => occupy('', () => row),
      };
    },
  };
  ACTOR.manager = manager;
  return { manager, queries };
}

const quiet = { notifyTeamAdded() {}, notifyItLeadOfTeamChange() {} };
const audit = { log: async () => undefined };
const stub = () => ({}) as any;

function requestsOf(manager: object) {
  return new PortfolioRequestsService(
    { manager } as any,
    audit as any,
    stub(),
    stub(),
    stub(),
    quiet as any,
    stub(),
    stub(),
    stub(),
  );
}

function projectsOf(manager: object) {
  return new PortfolioProjectsCrudService(
    { manager } as any,
    { manager } as any,
    audit as any,
    stub(),
    quiet as any,
    stub(),
    stub(),
  );
}

function dependenciesOf(manager: object) {
  return new PortfolioDependenciesService({ manager } as any, audit as any);
}

const names = (queries: string[], table: string) => queries.filter((sql) => new RegExp(`SELECT id, name\\s+FROM ${table}`, 'i').test(sql));

async function testGuardRejectsTwoQueriesAtOnce() {
  const { manager } = connection();
  await assert.rejects(
    () => Promise.all([manager.query('SELECT 1'), manager.query('SELECT 2')]),
    /already executing a query/,
  );
}

async function testRequestLinkReadsRunOneAfterTheOther() {
  const { manager, queries } = connection();
  const requests = requestsOf(manager);
  const opts = { manager: manager as any, userId: USER_A };

  assert.deepEqual(await requests.bulkReplaceTeam(REQ, 'business_team', [USER_A], opts), { ok: true, added: 0, removed: 1 });
  assert.equal(queries.filter((sql) => /FROM users/i.test(sql)).length, 2);

  const beforeApps = queries.length;
  assert.deepEqual(await requests.bulkReplaceApplications(REQ, [APP_A], opts), { ok: true, count: 1 });
  assert.equal(names(queries.slice(beforeApps), 'applications').length, 2);

  const beforeAssets = queries.length;
  assert.deepEqual(await requests.bulkReplaceAssets(REQ, [ASSET_A], opts), { ok: true, count: 1 });
  assert.equal(names(queries.slice(beforeAssets), 'assets').length, 2);

  for (const [kind, call] of [
    ['capex', () => requests.bulkReplaceCapex(REQ, [LINE_A], opts)],
    ['opex', () => requests.bulkReplaceOpex(REQ, [LINE_A], opts)],
  ] as const) {
    const before = queries.length;
    assert.deepEqual(await call(), { ok: true, added: 0, removed: 1 }, kind);
    assert.ok(queries.slice(before).filter((sql) => /product_name/.test(sql)).length >= 2, kind);
  }
}

async function testProjectLinkReadsRunOneAfterTheOther() {
  const { manager, queries } = connection();
  const projects = projectsOf(manager);
  const dependencies = dependenciesOf(manager);
  const opts = { manager: manager as any, userId: USER_A };

  assert.deepEqual(await projects.bulkReplaceTeam(PRJ, 'it_team', [USER_A], opts), { ok: true, added: 0, removed: 1 });
  assert.equal(queries.filter((sql) => /FROM users/i.test(sql)).length, 2);

  for (const [kind, call] of [
    ['capex', () => projects.bulkReplaceCapex(PRJ, [LINE_A], opts)],
    ['opex', () => projects.bulkReplaceOpex(PRJ, [LINE_A], opts)],
  ] as const) {
    const before = queries.length;
    assert.deepEqual(await call(), { ok: true, added: 0, removed: 1 }, kind);
    assert.ok(queries.slice(before).filter((sql) => /product_name/.test(sql)).length >= 2, kind);
  }

  const beforeApps = queries.length;
  assert.deepEqual((await dependencies.bulkReplaceLinkedApplications(PRJ, [APP_A], opts)).items, []);
  assert.equal(names(queries.slice(beforeApps), 'applications').length, 2);

  const beforeAssets = queries.length;
  assert.deepEqual((await dependencies.bulkReplaceLinkedAssets(PRJ, [ASSET_A], opts)).items, []);
  assert.equal(names(queries.slice(beforeAssets), 'assets').length, 2);
}

(async () => {
  await testGuardRejectsTwoQueriesAtOnce();
  await testRequestLinkReadsRunOneAfterTheOther();
  await testProjectLinkReadsRunOneAfterTheOther();
  console.log('portfolio-link-writes-connection.spec.ts: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
