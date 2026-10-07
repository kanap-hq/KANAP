import * as assert from 'node:assert/strict';
import {
  createRequestTenancyMiddleware,
  RequestTenancyOptions,
  TENANT_RESETTING_CODE,
  tenantSlugFromHost,
} from '../request-tenancy.middleware';
import { TenancyMiddleware } from '../tenancy.middleware';

// The tenancy middleware main.ts mounts (plan planning/perf-scale, lot 1D): a
// failed tenant lookup (pool exhausted, database down) answers 503 busy with
// Retry-After instead of going on without a tenant (fake 401s, "Tenant
// context is required", a logout in the browser). The other answers are
// unchanged: unknown tenant 404, apex without tenant, single-tenant not ready
// 503 TENANT_NOT_READY. The liveness route (/health) is never looked up (lot 4,
// review): it goes on without a tenant and costs no database connection. A
// tenant being reset to its starting state (sample data) refuses its write
// requests with 409 tenant_resetting; reads and the session routes go on.

type Captured = { status?: number; body?: any; headers: Record<string, string>; nextCalled: boolean; tenant?: unknown };

function fakeResponse(captured: Captured) {
  const res: any = {
    headersSent: false,
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    status(code: number) { captured.status = code; return res; },
    json(body: unknown) { captured.body = body; return res; },
  };
  return res;
}

async function run(options: Partial<RequestTenancyOptions>, host: string, path = '/spend-items', method = 'GET'): Promise<Captured> {
  const middleware = createRequestTenancyMiddleware({
    query: async () => [],
    singleTenant: false,
    defaultTenantSlug: 'default',
    platformAdminHost: 'admin.kanap.net',
    marketingRedirectUrl: 'https://www.kanap.net',
    ...options,
  });
  const captured: Captured = { headers: {}, nextCalled: false };
  const req: any = { headers: { host }, method, originalUrl: path, path };
  await middleware(req, fakeResponse(captured), () => { captured.nextCalled = true; });
  captured.tenant = req.tenant;
  return captured;
}

const tenantRow = { id: 't-1', slug: 'acme', name: 'Acme' };
const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

async function testLookupFailureAnswersBusy() {
  const poolTimeout = async () => { throw new Error('timeout exceeded when trying to connect'); };
  for (const [label, options, host] of [
    ['subdomain', {}, 'acme.kanap.net'],
    ['platform admin host', {}, 'admin.kanap.net'],
    ['single tenant', { singleTenant: true }, 'kanap.example.com'],
  ] as const) {
    const res = await quietly(() => run({ ...options, query: poolTimeout }, host));
    assert.equal(res.nextCalled, false, `${label}: the request does not go on without its tenant`);
    assert.equal(res.status, 503, `${label}: 503`);
    assert.equal(res.body?.code, 'busy', `${label}: code busy`);
    assert.equal(res.headers['retry-after'], '2', `${label}: Retry-After`);
  }
}

/**
 * The liveness probe never looks the tenant up, in both modes: no database connection, never
 * refused because the pool is busy, and 200 even before the single tenant is provisioned (the
 * process is alive). Any other route is still looked up and refused.
 */
async function testHealthIsNeverLookedUp() {
  let queries = 0;
  const poolTimeout = async () => { queries += 1; throw new Error('timeout exceeded when trying to connect'); };
  for (const [label, options, host] of [
    ['single tenant', { singleTenant: true }, 'kanap.example.com'],
    ['subdomain', {}, 'acme.kanap.net'],
    ['platform admin host', {}, 'admin.kanap.net'],
  ] as const) {
    for (const path of ['/health', '/api/health', '/health/', '/ops/metrics', '/api/ops/metrics']) {
      const res = await quietly(() => run({ ...options, query: poolTimeout }, host, path));
      assert.equal(res.nextCalled, true, `${label} ${path}: goes on`);
      assert.equal(res.status, undefined, `${label} ${path}: not answered`);
      assert.equal(res.tenant, null, `${label} ${path}: without a tenant`);
    }
    assert.equal(queries, 0, `${label}: no lookup for the liveness route`);
    const other = await quietly(() => run({ ...options, query: poolTimeout }, host, '/health/details'));
    assert.equal(other.status, 503, `${label}: only the liveness route itself is exempt`);
    queries = 0;
  }
  const notReady = await run({ singleTenant: true, query: async () => [] }, 'x', '/health');
  assert.equal(notReady.nextCalled, true, 'single tenant not provisioned yet: /health still answers');
  const otherNotReady = await run({ singleTenant: true, query: async () => [] }, 'x', '/spend-items');
  assert.equal(otherNotReady.body?.error, 'TENANT_NOT_READY', 'the other routes still answer TENANT_NOT_READY');
}

async function testOtherAnswersUnchanged() {
  const found = await run({ query: async () => [tenantRow] }, 'acme.kanap.net');
  assert.equal(found.nextCalled, true);
  assert.deepEqual(found.tenant, { slug: 'acme', id: 't-1', name: 'Acme' });

  const unknown = await run({ query: async () => [] }, 'nobody.kanap.net');
  assert.equal(unknown.nextCalled, false);
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'TENANT_NOT_FOUND', marketingUrl: 'https://www.kanap.net' });

  let queried = false;
  const apex = await run({ query: async () => { queried = true; return []; } }, 'www.kanap.net');
  assert.equal(apex.nextCalled, true);
  assert.equal(apex.tenant, null);
  assert.equal(queried, false, 'an apex host needs no lookup');

  const notReady = await run({ singleTenant: true, query: async () => [] }, 'anything');
  assert.equal(notReady.status, 503);
  assert.equal(notReady.body?.error, 'TENANT_NOT_READY');

  const platform = await run({ query: async () => [] }, 'admin.kanap.net');
  assert.equal(platform.status, 503);
  assert.deepEqual(platform.body, { error: 'PLATFORM_ADMIN_TENANT_MISSING' });

  const params: unknown[][] = [];
  const single = await run({ singleTenant: true, defaultTenantSlug: 'onprem', query: async (_sql, p) => { params.push(p); return [tenantRow]; } }, 'x');
  assert.equal(single.nextCalled, true);
  assert.deepEqual(params, [['onprem']]);
}

async function testNextErrorIsNotALookupFailure() {
  const middleware = createRequestTenancyMiddleware({
    query: async () => [tenantRow], singleTenant: false, defaultTenantSlug: 'default', platformAdminHost: '', marketingRedirectUrl: '',
  });
  const captured: Captured = { headers: {}, nextCalled: false };
  await assert.rejects(
    middleware({ headers: { host: 'acme.lvh.me' } } as any, fakeResponse(captured), () => { throw new Error('downstream'); }),
    /downstream/,
  );
  assert.equal(captured.status, undefined, 'an error after the lookup is not answered 503 busy');
}

function testSlugs() {
  assert.equal(tenantSlugFromHost('acme.lvh.me'), 'acme');
  assert.equal(tenantSlugFromHost('www.lvh.me'), null);
  assert.equal(tenantSlugFromHost('acme.dev.kanap.net'), 'acme');
  assert.equal(tenantSlugFromHost('dev.kanap.net'), null);
  assert.equal(tenantSlugFromHost('acme.qa.kanap.net'), 'acme');
  assert.equal(tenantSlugFromHost('qa.kanap.net'), null);
  assert.equal(tenantSlugFromHost('acme.kanap.net'), 'acme');
  assert.equal(tenantSlugFromHost('www.kanap.net'), null);
  assert.equal(tenantSlugFromHost('kanap.net'), null);
  assert.equal(tenantSlugFromHost('example.com'), null);
}

/** The NestJS-level TenancyMiddleware answers the same 503 busy. */
async function testClassMiddleware() {
  const failing = new TenancyMiddleware({ resolveFromHost: async () => { throw new Error('pool exhausted'); } } as any);
  const captured: Captured = { headers: {}, nextCalled: false };
  await quietly(() => failing.use({ headers: { host: 'acme.kanap.net' }, path: '/spend-items', method: 'GET' } as any, fakeResponse(captured), () => { captured.nextCalled = true; }));
  assert.equal(captured.nextCalled, false);
  assert.equal(captured.status, 503);
  assert.equal(captured.body?.code, 'busy');

  const unknown = new TenancyMiddleware({ resolveFromHost: async () => null } as any);
  const req: any = { headers: { host: 'nobody.kanap.net' }, path: '/spend-items' };
  const after: Captured = { headers: {}, nextCalled: false };
  await unknown.use(req, fakeResponse(after), () => { after.nextCalled = true; });
  assert.equal(after.nextCalled, true, 'an unknown tenant keeps going without tenant, as before');
  assert.equal(req.tenant, null);
}

/**
 * A tenant whose sample data status is `resetting` (demo-data.service.ts): its write requests
 * are refused with 409 tenant_resetting before any route runs, in every way a tenant is
 * resolved. Reads go on, as do the token refresh and the sign-out (they touch only the sessions
 * the reset keeps; a refused refresh signs the user out). Other tenants and other statuses are
 * not affected.
 */
async function testWritesRefusedWhileResetting() {
  const sql: string[] = [];
  const resetting = async (query: string) => { sql.push(query); return [{ ...tenantRow, demo_status: 'resetting' }]; };
  for (const [label, options, host] of [
    ['subdomain', {}, 'acme.kanap.net'],
    ['platform admin host', {}, 'admin.kanap.net'],
    ['single tenant', { singleTenant: true }, 'kanap.example.com'],
  ] as const) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/spend-items', '/auth/login', '/api/tasks/import']) {
        const res = await run({ ...options, query: resetting }, host, path, method);
        assert.equal(res.nextCalled, false, `${label} ${method} ${path}: refused`);
        assert.equal(res.status, 409, `${label} ${method} ${path}: 409`);
        assert.equal(res.body?.code, TENANT_RESETTING_CODE, `${label} ${method} ${path}: code`);
        assert.match(String(res.body?.message), /being reset/);
      }
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const res = await run({ ...options, query: resetting }, host, '/spend-items', method);
      assert.equal(res.nextCalled, true, `${label} ${method}: a read goes on`);
      assert.equal(res.status, undefined);
    }
    for (const path of ['/auth/refresh', '/api/auth/refresh', '/auth/logout', '/api/auth/logout', '/auth/refresh/']) {
      const res = await run({ ...options, query: resetting }, host, path, 'POST');
      assert.equal(res.nextCalled, true, `${label} POST ${path}: the session route goes on`);
    }
  }
  assert.ok(sql.length > 0 && sql.every((query) => /metadata->'demo'->>'status' AS demo_status/.test(query)), 'the lookup reads the status');

  for (const status of [null, undefined, 'idle', 'loading', 'loaded', 'failed', 'RESETTING']) {
    const res = await run({ query: async () => [{ ...tenantRow, demo_status: status as any }] }, 'acme.kanap.net', '/spend-items', 'POST');
    assert.equal(res.nextCalled, true, `status ${String(status)}: a write goes on`);
    assert.equal(res.status, undefined);
  }

  // Only the tenant being reset: the same request on another tenant's host goes on.
  const bySlug = async (_query: string, params: unknown[]) =>
    params[0] === 'acme' ? [{ ...tenantRow, demo_status: 'resetting' }] : [{ id: 't-2', slug: 'other', name: 'Other', demo_status: null }];
  assert.equal((await run({ query: bySlug }, 'acme.kanap.net', '/spend-items', 'POST')).status, 409);
  const other = await run({ query: bySlug }, 'other.kanap.net', '/spend-items', 'POST');
  assert.equal(other.nextCalled, true, 'another tenant is not affected');
  assert.deepEqual(other.tenant, { slug: 'other', id: 't-2', name: 'Other' });
}

async function main() {
  await testLookupFailureAnswersBusy();
  await testHealthIsNeverLookedUp();
  await testOtherAnswersUnchanged();
  await testNextErrorIsNotALookupFailure();
  testSlugs();
  await testClassMiddleware();
  await testWritesRefusedWhileResetting();
  console.log('request-tenancy.middleware.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
