import * as assert from 'node:assert/strict';
import { Features } from '../../config/features';
import { getRuntimeMode, validateStartupEnv } from '../env';
import { resolveAppBaseUrl } from '../url';
import { createOriginPolicy } from '../cors-policy';
import { isPlatformAdmin } from '../../auth/platform-admin.util';
import { isSecureRequest, setRefreshTokenCookie } from '../../auth/auth-cookie.util';

// Run mode: APP_ENV (or NODE_ENV when APP_ENV is absent) gives development, production or
// unspecified. Only development turns on the workstation conveniences; production keeps the
// blocking start-up checks and the forced Secure cookie; unspecified applies the production rules
// to links, origins and platform administration and only warns at start-up.

const MANAGED_KEYS = [
  'APP_ENV',
  'NODE_ENV',
  'APP_BASE_URL',
  'PUBLIC_APP_URL',
  'APP_URL',
  'CORS_ORIGINS',
  'PLATFORM_ADMIN_EMAILS',
  'PLATFORM_ADMIN_HOST',
  'DATABASE_URL',
  'JWT_SECRET',
];

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of new Set([...MANAGED_KEYS, ...Object.keys(values)])) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function withSingleTenant<T>(singleTenant: boolean, fn: () => T): T {
  const previous = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = singleTenant;
  try {
    return fn();
  } finally {
    (Features as any).SINGLE_TENANT = previous;
  }
}

type ModeCase = { label: string; env: Record<string, string | undefined>; mode: 'development' | 'production' | 'unspecified' };

const MODE_CASES: ModeCase[] = [
  { label: 'APP_ENV absent', env: {}, mode: 'unspecified' },
  { label: 'APP_ENV=production', env: { APP_ENV: 'production' }, mode: 'production' },
  { label: 'APP_ENV=prod', env: { APP_ENV: 'prod' }, mode: 'production' },
  { label: 'APP_ENV=development', env: { APP_ENV: 'development' }, mode: 'development' },
  { label: 'APP_ENV=dev', env: { APP_ENV: 'dev' }, mode: 'development' },
  { label: 'APP_ENV=local', env: { APP_ENV: 'local' }, mode: 'development' },
  { label: 'APP_ENV=test', env: { APP_ENV: 'test' }, mode: 'development' },
  { label: 'APP_ENV=qa', env: { APP_ENV: 'qa' }, mode: 'unspecified' },
  { label: 'only NODE_ENV=production', env: { NODE_ENV: 'production' }, mode: 'production' },
  { label: 'only NODE_ENV=development', env: { NODE_ENV: 'development' }, mode: 'development' },
  { label: 'APP_ENV=qa with NODE_ENV=production', env: { APP_ENV: 'qa', NODE_ENV: 'production' }, mode: 'unspecified' },
];

function testModeMatrix() {
  for (const testCase of MODE_CASES) {
    withEnv(testCase.env, () => {
      assert.equal(getRuntimeMode(), testCase.mode, testCase.label);
    });
  }
}

const UNKNOWN_HOST_REQUEST = {
  protocol: 'http',
  headers: { host: 'other.example.test', 'x-forwarded-host': 'other.example.test', 'x-forwarded-proto': 'https' },
  tenant: { slug: 'default' },
};

const LOCAL_DEV_HOST_REQUEST = {
  protocol: 'http',
  headers: { host: 'fromage.lvh.me', 'x-forwarded-proto': 'http' },
  tenant: { slug: 'default' },
};

function testDecisionsPerMode() {
  for (const testCase of MODE_CASES) {
    const development = testCase.mode === 'development';
    const production = testCase.mode === 'production';

    // Links: an unknown request host never changes the link; a local development host keeps
    // the link on that host in development mode only.
    withSingleTenant(true, () => withEnv({ ...testCase.env, APP_BASE_URL: 'https://kanap.example.test' }, () => {
      assert.equal(resolveAppBaseUrl(UNKNOWN_HOST_REQUEST), 'https://kanap.example.test', `${testCase.label}: unknown host`);
      assert.equal(
        resolveAppBaseUrl(LOCAL_DEV_HOST_REQUEST),
        development ? 'http://fromage.lvh.me' : 'https://kanap.example.test',
        `${testCase.label}: local development host`,
      );
    }));

    // CORS_ORIGINS empty: every origin in development; production does not start; otherwise only
    // the configured address and the address of the request.
    withEnv({ ...testCase.env, APP_BASE_URL: 'https://kanap.example.test', CORS_ORIGINS: undefined }, () => {
      const policy = createOriginPolicy({ singleTenant: true });
      const other = policy.check({ origin: 'https://other.example.test', host: 'kanap.example.test' });
      const configured = policy.check({ origin: 'https://kanap.example.test', host: '127.0.0.1:8080' });
      assert.equal(other.allowed, development, `${testCase.label}: unlisted origin with CORS_ORIGINS empty`);
      assert.equal(configured.allowed, true, `${testCase.label}: configured origin with CORS_ORIGINS empty`);
      const startup = () => validateStartupEnv(
        { ...process.env, DATABASE_URL: 'postgres://example.test/db', JWT_SECRET: 'run-mode-spec-secret' },
        { singleTenant: true },
      );
      if (production) assert.throws(startup, /CORS_ORIGINS must be set in production/, testCase.label);
      else assert.doesNotThrow(startup, testCase.label);
    });

    // Platform administration: the `*` allowlist is a development convenience.
    withSingleTenant(false, () => withEnv({ ...testCase.env, PLATFORM_ADMIN_EMAILS: '*' }, () => {
      assert.equal(isPlatformAdmin({ email: 'ops@example.test' }), development, `${testCase.label}: * allowlist`);
    }));
    withSingleTenant(false, () => withEnv({ ...testCase.env, PLATFORM_ADMIN_EMAILS: 'ops@example.test' }, () => {
      assert.equal(isPlatformAdmin({ email: 'ops@example.test' }), true, `${testCase.label}: listed email`);
    }));

    // Refresh cookie: Secure is forced in production only; elsewhere it follows the request.
    withEnv(testCase.env, () => {
      const plainHttp = { secure: false, protocol: 'http', headers: {} };
      const forwardedHttps = { secure: false, protocol: 'http', headers: { 'x-forwarded-proto': 'https' } };
      assert.equal(isSecureRequest(plainHttp), production, `${testCase.label}: plain HTTP request`);
      assert.equal(isSecureRequest(forwardedHttps), true, `${testCase.label}: HTTPS behind a proxy`);
      const options: Array<Record<string, any>> = [];
      setRefreshTokenCookie({ cookie: (_n: string, _v: string, o: Record<string, any>) => options.push(o) } as any, 'token', 60, isSecureRequest(plainHttp));
      assert.equal(options[0]?.secure, production, `${testCase.label}: Secure attribute over HTTP`);
    });
  }
}

const BASE_STARTUP_ENV = { DATABASE_URL: 'postgres://example.test/db', JWT_SECRET: 'run-mode-spec-secret' };

function testStartupChecks() {
  // Unspecified, nothing configured: warnings, one line each, no throw.
  const unspecified = validateStartupEnv({ ...BASE_STARTUP_ENV }, { singleTenant: true });
  assert.equal(unspecified.mode, 'unspecified');
  assert.ok(unspecified.warnings.some((line) => line.startsWith('[ENV]') && line.includes('APP_ENV')), 'run mode warning');
  assert.ok(unspecified.warnings.some((line) => line.startsWith('[CONFIG]') && line.includes('Set APP_BASE_URL')), 'APP_BASE_URL warning');
  assert.ok(unspecified.warnings.some((line) => line.startsWith('[CORS]') && line.includes('Set CORS_ORIGINS')), 'CORS_ORIGINS warning');
  assert.ok(unspecified.warnings.every((line) => !line.includes('\n')), 'one line each');

  // APP_ENV=qa behaves the same way.
  assert.doesNotThrow(() => validateStartupEnv({ ...BASE_STARTUP_ENV, APP_ENV: 'qa' }, { singleTenant: false }));

  // Explicit production: the same refusals as before.
  assert.throws(
    () => validateStartupEnv({ ...BASE_STARTUP_ENV, APP_ENV: 'production', CORS_ORIGINS: 'https://kanap.example.test' }, { singleTenant: true }),
    /APP_BASE_URL environment variable is required/,
  );
  assert.throws(
    () => validateStartupEnv({ ...BASE_STARTUP_ENV, APP_ENV: 'production', APP_BASE_URL: 'https://kanap.example.test' }, { singleTenant: true }),
    /CORS_ORIGINS must be set in production/,
  );
  const production = validateStartupEnv(
    { ...BASE_STARTUP_ENV, APP_ENV: 'production', APP_BASE_URL: 'https://kanap.example.test', CORS_ORIGINS: 'https://kanap.example.test' },
    { singleTenant: true },
  );
  assert.deepEqual(production.warnings, []);

  // Missing database or signing key still stops every mode.
  assert.throws(() => validateStartupEnv({ JWT_SECRET: 'x' }, { singleTenant: true }), /DATABASE_URL/);
  assert.throws(() => validateStartupEnv({ DATABASE_URL: 'postgres://example.test/db' }, { singleTenant: true }), /JWT_SECRET/);

  // Development without CORS_ORIGINS: the existing warning, no run-mode warning.
  const development = validateStartupEnv({ ...BASE_STARTUP_ENV, APP_ENV: 'development', APP_BASE_URL: 'http://localhost:5173' }, { singleTenant: false });
  assert.deepEqual(development.warnings, ['[CORS] CORS_ORIGINS not set; allowing all origins (development only)']);
}

testModeMatrix();
testDecisionsPerMode();
testStartupChecks();
console.log('run-mode.spec: ok');
