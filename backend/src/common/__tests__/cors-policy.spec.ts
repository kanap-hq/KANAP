import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as express from 'express';
import { validateStartupEnv } from '../env';
import { createCorsMiddlewares, createOriginPolicy, createRefusedOriginLog, OriginPolicy } from '../cors-policy';

// Browser origins allowed with cookies: exact CORS_ORIGINS entries, the configured application
// address, the address of the request itself; a pattern entry only for the tenant the request
// targets (multi-tenant). A refused origin gets a short 403 without Access-Control-Allow-* headers.

type Answer = { status: number; headers: http.IncomingHttpHeaders; body: string };

async function withServer<T>(policy: OriginPolicy, fn: (port: number, refused: string[]) => Promise<T>, env: NodeJS.ProcessEnv = {}): Promise<T> {
  const refused: string[] = [];
  const app = express();
  app.use(...createCorsMiddlewares(policy, { logRefusal: (origin) => refused.push(origin), env }));
  app.post('/auth/refresh', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/public/tenant-info', (_req, res) => {
    res.json({ ok: true });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn((server.address() as AddressInfo).port, refused);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function send(port: number, options: { method?: string; path?: string; host: string; origin?: string; extra?: Record<string, string> }): Promise<Answer> {
  const headers: Record<string, string> = { host: options.host, ...(options.extra ?? {}) };
  if (options.origin) headers.origin = options.origin;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: options.method ?? 'POST', path: options.path ?? '/auth/refresh', headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function corsHeaderNames(answer: Answer): string[] {
  return Object.keys(answer.headers).filter((name) => name.startsWith('access-control-allow-'));
}

const CLOUD_ENV = {
  CORS_ORIGINS: 'https://*.kanap.net',
  APP_BASE_URL: 'https://app.kanap.net',
  APP_URL: 'https://app.kanap.net',
  PLATFORM_ADMIN_HOST: 'platform-admin.kanap.net',
};

async function testMultiTenantPatternIsLimitedToTheTargetTenant() {
  for (const appEnv of ['production', undefined]) {
    const env = { ...CLOUD_ENV, APP_ENV: appEnv };
    const policy = createOriginPolicy({ env, singleTenant: false });
    await withServer(policy, async (port, refused) => {
      const own = await send(port, { host: 'acme.kanap.net', origin: 'https://acme.kanap.net' });
      assert.equal(own.status, 200, 'origin of the tenant the request targets');
      assert.equal(own.headers['access-control-allow-origin'], 'https://acme.kanap.net');
      assert.equal(own.headers['access-control-allow-credentials'], 'true');

      for (const origin of ['https://other.kanap.net', 'https://www.kanap.net', 'https://kanap.net', 'https://acme.qa.kanap.net', 'https://acme.kanap.net:8443']) {
        const answer = await send(port, { host: 'acme.kanap.net', origin });
        assert.equal(answer.status, 403, `${origin} on acme.kanap.net`);
        assert.deepEqual(corsHeaderNames(answer), [], `${origin}: no CORS headers`);
        assert.match(answer.body, /Origin not allowed/);
      }
      assert.deepEqual(refused.slice(0, 2), ['https://other.kanap.net', 'https://www.kanap.net']);

      // Preflight: refused without CORS headers, allowed with them.
      const refusedPreflight = await send(port, {
        method: 'OPTIONS',
        host: 'acme.kanap.net',
        origin: 'https://other.kanap.net',
        extra: { 'access-control-request-method': 'POST' },
      });
      assert.equal(refusedPreflight.status, 403);
      assert.deepEqual(corsHeaderNames(refusedPreflight), []);
      const allowedPreflight = await send(port, {
        method: 'OPTIONS',
        host: 'acme.kanap.net',
        origin: 'https://acme.kanap.net',
        extra: { 'access-control-request-method': 'POST' },
      });
      assert.equal(allowedPreflight.status, 204);
      assert.equal(allowedPreflight.headers['access-control-allow-origin'], 'https://acme.kanap.net');

      // No Origin: server-to-server calls, webhooks, scripts.
      assert.equal((await send(port, { host: 'acme.kanap.net' })).status, 200);
      // The marketing site calls /api/public/* on its own host.
      assert.equal((await send(port, { method: 'GET', path: '/public/tenant-info', host: 'www.kanap.net', origin: 'https://www.kanap.net' })).status, 200);
      // The platform console on its own host.
      assert.equal((await send(port, { host: 'platform-admin.kanap.net', origin: 'https://platform-admin.kanap.net' })).status, 200);
    }, env);
  }

  // Decision level: the configured tenant address, and a pattern without a targeted tenant.
  const policy = createOriginPolicy({ env: { ...CLOUD_ENV, APP_ENV: 'production', CORS_ORIGINS: 'https://kanap.example.test' }, singleTenant: false });
  assert.deepEqual(policy.check({ origin: 'https://acme.kanap.net', host: 'api.internal', tenantSlug: 'acme' }), { allowed: true, rule: 'application' });
  assert.deepEqual(policy.check({ origin: 'https://other.kanap.net', host: 'api.internal', tenantSlug: 'acme' }), { allowed: false });
  const patternPolicy = createOriginPolicy({ env: { ...CLOUD_ENV, APP_ENV: 'production' }, singleTenant: false });
  assert.deepEqual(patternPolicy.check({ origin: 'https://acme.kanap.net', host: 'kanap.net', tenantSlug: null }), { allowed: false });
}

async function testSameAddressAsHost() {
  const policy = createOriginPolicy({ env: { APP_ENV: 'production', CORS_ORIGINS: 'https://kanap.example.test' }, singleTenant: true });
  await withServer(policy, async (port) => {
    assert.equal((await send(port, { host: 'kanap.other-name.test:8443', origin: 'https://kanap.other-name.test:8443' })).status, 200);
    assert.equal((await send(port, { host: 'kanap.other-name.test', origin: 'https://kanap.other-name.test' })).status, 200);
    // Same host name, another port: another address.
    assert.equal((await send(port, { host: 'kanap.other-name.test:8443', origin: 'https://kanap.other-name.test:9443' })).status, 403);
    assert.equal((await send(port, { host: 'kanap.other-name.test', origin: 'https://kanap.other-name.test:9443' })).status, 403);
  });
}

async function testSingleTenantPatternStillAcceptedWithWarning() {
  const env = {
    CORS_ORIGINS: 'https://*.example.test',
    APP_BASE_URL: 'https://kanap.example.test',
    DATABASE_URL: 'postgres://example.test/db',
    JWT_SECRET: 'cors-policy-spec-secret',
  };
  const policy = createOriginPolicy({ env, singleTenant: true });
  assert.deepEqual(policy.check({ origin: 'https://intranet.example.test', host: '127.0.0.1:8080' }), { allowed: true, rule: 'pattern' });
  assert.deepEqual(policy.check({ origin: 'https://intranet.other.test', host: '127.0.0.1:8080' }), { allowed: false });
  const report = validateStartupEnv(env, { singleTenant: true });
  assert.ok(
    report.warnings.some((line) => line.includes('https://*.example.test') && line.includes('exact address')),
    'start-up warning for the pattern entry',
  );
}

async function testEmptyListOutsideDevelopment() {
  const env = { APP_BASE_URL: 'https://kanap.example.test', DATABASE_URL: 'postgres://example.test/db', JWT_SECRET: 'cors-policy-spec-secret' };
  // Unspecified mode: the API starts, with a warning.
  const report = validateStartupEnv(env, { singleTenant: true });
  assert.ok(report.warnings.some((line) => line.startsWith('[CORS]') && line.includes('CORS_ORIGINS')));

  const policy = createOriginPolicy({ env, singleTenant: true });
  await withServer(policy, async (port) => {
    // Behind a reverse proxy that does not keep Host: the configured address is still allowed.
    const configured = await send(port, { host: '127.0.0.1:8080', origin: 'https://kanap.example.test' });
    assert.equal(configured.status, 200);
    assert.equal(configured.headers['access-control-allow-origin'], 'https://kanap.example.test');
    const other = await send(port, { host: 'kanap.example.test', origin: 'https://other.example.test' });
    assert.equal(other.status, 403);
    assert.deepEqual(corsHeaderNames(other), []);
    assert.equal((await send(port, { host: 'kanap.example.test', origin: 'https://kanap.example.test' })).status, 200);
  });
}

function testDevelopmentKeepsPatternsAsWritten() {
  const listed = createOriginPolicy({
    env: { APP_ENV: 'development', CORS_ORIGINS: 'http://localhost:*,http://*.lvh.me:*' },
    singleTenant: false,
  });
  assert.equal(listed.check({ origin: 'http://fromage.lvh.me:5173', host: 'api:8080', tenantSlug: null }).allowed, true);
  assert.equal(listed.check({ origin: 'http://localhost:3000', host: 'api:8080', tenantSlug: null }).allowed, true);
  assert.equal(listed.check({ origin: 'https://fromage.dev.kanap.net', host: 'fromage.dev.kanap.net', tenantSlug: 'fromage' }).allowed, true);
  assert.equal(listed.check({ origin: 'https://other.example.test', host: 'fromage.lvh.me', tenantSlug: 'fromage' }).allowed, false);

  const open = createOriginPolicy({ env: { APP_ENV: 'development' }, singleTenant: false });
  assert.deepEqual(open.check({ origin: 'https://other.example.test', host: 'fromage.lvh.me' }), { allowed: true, rule: 'open' });
}

function testRefusalLogIsThrottled() {
  const lines: string[] = [];
  let clock = 0;
  const log = createRefusedOriginLog((line) => lines.push(line), () => clock);
  log('https://other.example.test');
  log('https://other.example.test');
  log('https://second.example.test');
  clock = 30_000;
  log('https://other.example.test');
  clock = 61_000;
  log('https://other.example.test');
  assert.deepEqual(lines, [
    '[CORS] Rejected origin: "https://other.example.test"',
    '[CORS] Rejected origin: "https://second.example.test"',
    '[CORS] Rejected origin: "https://other.example.test"',
  ]);
}

async function run() {
  await testMultiTenantPatternIsLimitedToTheTargetTenant();
  await testSameAddressAsHost();
  await testSingleTenantPatternStillAcceptedWithWarning();
  await testEmptyListOutsideDevelopment();
  testDevelopmentKeepsPatternsAsWritten();
  testRefusalLogIsThrottled();
  console.log('cors-policy.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
