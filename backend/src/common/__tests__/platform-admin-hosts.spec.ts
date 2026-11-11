import * as assert from 'node:assert/strict';
import { tenantSlugForRequest } from '../cors-policy';
import { parsePlatformAdminHosts, platformAdminHosts } from '../platform-admin-hosts';
import { createRequestTenancyMiddleware } from '../tenancy/request-tenancy.middleware';

// PLATFORM_ADMIN_HOST lists the hosts of the platform console: an environment served under two
// domains has the console on each of them. Before, the setting held one host, and the console's
// name under the other domain opened the system tenant as an ordinary workspace.

const CONSOLE = { id: 't-platform', slug: 'platform-admin', name: 'Platform' };

async function tenancy(platformAdminHost: string, host: string) {
  const slugs: unknown[] = [];
  const middleware = createRequestTenancyMiddleware({
    query: async (_sql, params) => { slugs.push(params[0]); return [CONSOLE]; },
    singleTenant: false,
    defaultTenantSlug: 'default',
    platformAdminHost,
    marketingRedirectUrl: 'https://www.kanap.net',
  });
  const req: any = { headers: { host }, method: 'GET', originalUrl: '/admin/tenants', path: '/admin/tenants' };
  let nextCalled = false;
  await middleware(req, {} as any, () => { nextCalled = true; });
  return { isPlatformHost: req.isPlatformHost === true, tenant: req.tenant, nextCalled, slugs };
}

function testParsing() {
  assert.deepEqual(parsePlatformAdminHosts(undefined), []);
  assert.deepEqual(parsePlatformAdminHosts('  '), []);
  assert.deepEqual(parsePlatformAdminHosts('platform-admin.kanap.net'), ['platform-admin.kanap.net']);
  assert.deepEqual(
    parsePlatformAdminHosts(' Platform-Admin.Kanap.net , platform-admin.example.com,,platform-admin.kanap.net '),
    ['platform-admin.kanap.net', 'platform-admin.example.com'],
    'spaces, case, empty entries and repeats are ignored; the order is kept',
  );
  assert.deepEqual(platformAdminHosts({ PLATFORM_ADMIN_HOST: 'a.test,b.test' }), ['a.test', 'b.test']);
  assert.deepEqual(platformAdminHosts({}), []);
}

async function testEveryListedHostIsTheConsole() {
  const list = 'platform-admin.kanap.net,platform-admin.example.com';
  for (const host of ['platform-admin.kanap.net', 'platform-admin.example.com', 'PLATFORM-ADMIN.example.com:443']) {
    const seen = await tenancy(list, host);
    assert.equal(seen.isPlatformHost, true, `${host} is the console`);
    assert.deepEqual(seen.tenant, CONSOLE);
    assert.equal(seen.nextCalled, true);
    assert.deepEqual(seen.slugs, ['platform-admin']);
  }
  // One host, as before: only that one is the console.
  const single = await tenancy('platform-admin.kanap.net', 'platform-admin.kanap.net');
  assert.equal(single.isPlatformHost, true);
  // A workspace host is never the console, and an empty setting names no console.
  assert.equal((await tenancy(list, 'acme.kanap.net')).isPlatformHost, false);
  assert.equal((await tenancy('', 'platform-admin.kanap.net')).isPlatformHost, false);
}

function testCorsReadsTheSameList() {
  const env = { PLATFORM_ADMIN_HOST: 'admin.kanap.net, admin.example.com' } as NodeJS.ProcessEnv;
  assert.equal(tenantSlugForRequest({ headers: { host: 'admin.kanap.net' } }, env), 'platform-admin');
  assert.equal(tenantSlugForRequest({ headers: { host: 'admin.example.com:443' } }, env), 'platform-admin');
  assert.notEqual(tenantSlugForRequest({ headers: { host: 'admin.other.test' } }, env), 'platform-admin');
}

async function main() {
  testParsing();
  await testEveryListedHostIsTheConsole();
  testCorsReadsTheSameList();
  console.log('platform-admin-hosts.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
