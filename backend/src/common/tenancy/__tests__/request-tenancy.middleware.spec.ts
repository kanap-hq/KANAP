import * as assert from 'node:assert/strict';
import { createRequestTenancyMiddleware, RequestTenancyOptions, tenantSlugFromHost } from '../request-tenancy.middleware';
import { TenancyMiddleware } from '../tenancy.middleware';

// The tenancy middleware main.ts mounts (plan planning/perf-scale, lot 1D): a
// failed tenant lookup (pool exhausted, database down) answers 503 busy with
// Retry-After instead of going on without a tenant (fake 401s, "Tenant
// context is required", a logout in the browser). The other answers are
// unchanged: unknown tenant 404, apex without tenant, single-tenant not ready
// 503 TENANT_NOT_READY. The liveness route (/health) is never refused because
// the lookup failed: it goes on without a tenant.

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

async function run(options: Partial<RequestTenancyOptions>, host: string, path = '/spend-items'): Promise<Captured> {
  const middleware = createRequestTenancyMiddleware({
    query: async () => [],
    singleTenant: false,
    defaultTenantSlug: 'default',
    platformAdminHost: 'admin.kanap.net',
    marketingRedirectUrl: 'https://www.kanap.net',
    ...options,
  });
  const captured: Captured = { headers: {}, nextCalled: false };
  const req: any = { headers: { host }, method: 'GET', originalUrl: path, path };
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

/** A busy pool never fails the liveness probe: /health goes on without a tenant, in both modes. */
async function testHealthGoesOnWhenTheLookupFails() {
  const poolTimeout = async () => { throw new Error('timeout exceeded when trying to connect'); };
  for (const [label, options, host] of [
    ['single tenant', { singleTenant: true }, 'kanap.example.com'],
    ['subdomain', {}, 'acme.kanap.net'],
  ] as const) {
    for (const path of ['/health', '/api/health']) {
      const res = await quietly(() => run({ ...options, query: poolTimeout }, host, path));
      assert.equal(res.nextCalled, true, `${label} ${path}: goes on`);
      assert.equal(res.status, undefined, `${label} ${path}: not answered 503`);
      assert.equal(res.tenant, null, `${label} ${path}: without a tenant`);
    }
    // Any other route is still refused.
    const other = await quietly(() => run({ ...options, query: poolTimeout }, host, '/health/details'));
    assert.equal(other.status, 503, `${label}: only the liveness route itself is exempt`);
  }
  // A tenant that is not provisioned yet still answers TENANT_NOT_READY on /health (no lookup failure).
  const notReady = await run({ singleTenant: true, query: async () => [] }, 'x', '/health');
  assert.equal(notReady.status, 503);
  assert.equal(notReady.body?.error, 'TENANT_NOT_READY');
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

async function main() {
  await testLookupFailureAnswersBusy();
  await testHealthGoesOnWhenTheLookupFails();
  await testOtherAnswersUnchanged();
  await testNextErrorIsNotALookupFailure();
  testSlugs();
  await testClassMiddleware();
  console.log('request-tenancy.middleware.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
