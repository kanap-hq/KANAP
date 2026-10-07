import * as assert from 'node:assert/strict';
import { Features } from '../../config/features';
import { resolveAppBaseUrl } from '../url';

// E-mail links sent in answer to a request (password reset, invitation) open
// the tenant address of the request. Outside development mode the address comes
// from the configuration only; in development mode it follows a local
// development host. Multi-tenant mode here; single-tenant cases are in
// request-app-base-url.single-tenant.spec.ts.

const ENV_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL', 'MARKETING_BASE_URL'] as const;

const PROD_CLOUD = {
  APP_ENV: 'production',
  APP_BASE_URL: 'https://kanap.net',
  APP_URL: 'https://app.kanap.net',
  MARKETING_BASE_URL: 'https://kanap.net',
};

function withConfig(env: Record<string, string>, singleTenant: boolean, fn: () => void) {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedSingleTenant = Features.SINGLE_TENANT;
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  (Features as any).SINGLE_TENANT = singleTenant;
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    (Features as any).SINGLE_TENANT = savedSingleTenant;
  }
}

function testProductionTenantAddress() {
  withConfig(PROD_CLOUD, false, () => {
    assert.equal(
      resolveAppBaseUrl({ tenant: { slug: 'acme' }, headers: { host: 'acme.kanap.net' } }),
      'https://acme.kanap.net',
    );
  });
}

function testProductionIgnoresRequestHeaders() {
  withConfig(PROD_CLOUD, false, () => {
    assert.equal(
      resolveAppBaseUrl({
        tenant: { slug: 'acme' },
        headers: { host: 'other.example.com', 'x-forwarded-host': 'other.example.com', 'x-forwarded-proto': 'http' },
      }),
      'https://acme.kanap.net',
    );
  });
}

function testProductionWithoutTenantUnchanged() {
  withConfig(PROD_CLOUD, false, () => {
    assert.equal(resolveAppBaseUrl({ tenant: null, headers: { host: 'kanap.net' } }), 'https://kanap.net');
  });
}

function testDevelopmentFollowsTheRequestHost() {
  withConfig({ APP_ENV: 'development' }, false, () => {
    assert.equal(
      resolveAppBaseUrl({ tenant: { slug: 'fromage' }, headers: { host: 'fromage.lvh.me' } }),
      'http://fromage.lvh.me',
    );
    assert.equal(
      resolveAppBaseUrl({
        tenant: { slug: 'fromage' },
        headers: { host: 'fromage.dev.kanap.net', 'x-forwarded-proto': 'https' },
      }),
      'https://fromage.dev.kanap.net',
    );
  });
}

testProductionTenantAddress();
testProductionIgnoresRequestHeaders();
testProductionWithoutTenantUnchanged();
testDevelopmentFollowsTheRequestHost();
console.log('request-app-base-url.spec: ok');
