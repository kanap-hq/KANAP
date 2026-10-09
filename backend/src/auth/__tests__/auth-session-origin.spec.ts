import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { Features } from '../../config/features';
import { AuthController } from '../auth.controller';
import { REFRESH_TOKEN_COOKIE_NAME } from '../auth-cookie.util';

// POST /auth/refresh and POST /auth/logout rely on the refresh cookie: they apply the origin
// policy of CORS themselves. An Origin that is not allowed (or, without Origin, a Referer whose
// origin is not allowed) is answered 403 before any cookie is touched or any token issued or
// revoked. Without Origin or Referer (a client that is not a browser) nothing changes.

const MANAGED_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL', 'CORS_ORIGINS', 'PLATFORM_ADMIN_HOST'];

async function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const key of new Set([...MANAGED_KEYS, ...Object.keys(values)])) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const singleTenant = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = false;
  try {
    await fn();
  } finally {
    (Features as any).SINGLE_TENANT = singleTenant;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createController() {
  const calls = { refreshed: [] as string[], revoked: [] as string[] };
  const controller = new AuthController(
    {
      refreshAccessToken: async (token: string) => {
        calls.refreshed.push(token);
        return { access_token: 'new-access-token', expires_in: 900, refresh_expires_in: 14_400 };
      },
      revokeToken: async (token: string) => {
        calls.revoked.push(token);
      },
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { recordAuthEvent: async () => undefined } as any,
  );
  const cookies: Array<{ name: string; value: string; options: Record<string, any> }> = [];
  const response = {
    cookie: (name: string, value: string, options: Record<string, any>) => {
      cookies.push({ name, value, options });
    },
  } as any;
  return { controller, calls, cookies, response };
}

function request(headers: Record<string, string>) {
  return {
    tenant: { slug: 'acme' },
    headers: { host: 'acme.kanap.net', cookie: `${REFRESH_TOKEN_COOKIE_NAME}=cookie-token`, 'x-forwarded-proto': 'https', ...headers },
  };
}

function isForbidden(error: unknown): boolean {
  return error instanceof ForbiddenException && error.getStatus() === 403;
}

const REFUSED_HEADERS: Array<Record<string, string>> = [
  { origin: 'https://other.kanap.net' },
  { origin: 'https://www.kanap.net' },
  { referer: 'https://other.kanap.net/some/page' },
];

const ALLOWED_HEADERS: Array<Record<string, string>> = [
  { origin: 'https://acme.kanap.net' },
  { referer: 'https://acme.kanap.net/portfolio' },
  {},
];

async function testRefusedOrigins() {
  for (const headers of REFUSED_HEADERS) {
    const refresh = createController();
    await assert.rejects(() => refresh.controller.refreshToken({}, request(headers), refresh.response), isForbidden, JSON.stringify(headers));
    assert.deepEqual(refresh.calls.refreshed, [], 'no token issued');
    assert.deepEqual(refresh.cookies, [], 'cookie unchanged');

    const logout = createController();
    await assert.rejects(() => logout.controller.logout({}, request(headers), logout.response), isForbidden, JSON.stringify(headers));
    assert.deepEqual(logout.calls.revoked, [], 'no token revoked');
    assert.deepEqual(logout.cookies, [], 'cookie unchanged');
  }
}

async function testAllowedOriginsKeepCurrentBehavior() {
  for (const headers of ALLOWED_HEADERS) {
    const refresh = createController();
    const answer = await refresh.controller.refreshToken({}, request(headers), refresh.response);
    assert.equal(answer.access_token, 'new-access-token');
    assert.deepEqual(refresh.calls.refreshed, ['cookie-token']);
    assert.equal(refresh.cookies[0]?.name, REFRESH_TOKEN_COOKIE_NAME);
    assert.equal(refresh.cookies[0]?.value, 'cookie-token');

    const logout = createController();
    assert.deepEqual(await logout.controller.logout({}, request(headers), logout.response), { ok: true });
    assert.deepEqual(logout.calls.revoked, ['cookie-token']);
    assert.equal(logout.cookies[0]?.options?.maxAge, 0);
  }

  // A client that is not a browser sends the token in the body, without Origin or Referer.
  const bodyClient = createController();
  const answer = await bodyClient.controller.refreshToken(
    { refresh_token: 'body-token' },
    { tenant: { slug: 'acme' }, headers: { host: 'acme.kanap.net' } },
    bodyClient.response,
  );
  assert.equal(answer.access_token, 'new-access-token');
  assert.deepEqual(bodyClient.calls.refreshed, ['body-token']);
}

async function run() {
  for (const appEnv of ['production', undefined]) {
    await withEnv(
      { APP_ENV: appEnv, CORS_ORIGINS: 'https://*.kanap.net', APP_BASE_URL: 'https://app.kanap.net', APP_URL: 'https://app.kanap.net' },
      async () => {
        await testRefusedOrigins();
        await testAllowedOriginsKeepCurrentBehavior();
      },
    );
  }
  console.log('auth-session-origin.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
