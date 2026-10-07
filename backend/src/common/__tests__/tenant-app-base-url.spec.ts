import * as assert from 'node:assert/strict';
import { Features } from '../../config/features';
import { resolveTenantAppBaseUrl } from '../url';

// Multi-tenant (cloud): each tenant has its own subdomain, derived from the
// configured application URL in production and from the request host
// elsewhere. Pins the current behaviour.

const ENV_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL'] as const;

function withEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const savedSingleTenant = Features.SINGLE_TENANT;
  Features.SINGLE_TENANT = false;
  try {
    fn();
  } finally {
    Features.SINGLE_TENANT = savedSingleTenant;
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function request(host: string, extra: Record<string, string> = {}) {
  return { headers: { host, ...extra }, protocol: 'http' };
}

function testProductionCloud() {
  withEnv({ APP_ENV: 'production', APP_BASE_URL: 'https://kanap.net' }, () => {
    assert.equal(resolveTenantAppBaseUrl(request('acme.kanap.net'), 'acme'), 'https://acme.kanap.net');
  });
}

function testQaHost() {
  withEnv({ APP_ENV: 'qa', APP_BASE_URL: 'https://qa.kanap.net' }, () => {
    assert.equal(resolveTenantAppBaseUrl(request('acme.qa.kanap.net'), 'acme'), 'http://acme.qa.kanap.net');
    assert.equal(
      resolveTenantAppBaseUrl(request('acme.qa.kanap.net', { 'x-forwarded-proto': 'https' }), 'acme'),
      'https://acme.qa.kanap.net',
    );
  });
}

function testDevHost() {
  withEnv({}, () => {
    assert.equal(resolveTenantAppBaseUrl(request('fromage.lvh.me'), 'fromage'), 'http://fromage.lvh.me');
  });
}

function testCustomDomainProduction() {
  withEnv({ APP_ENV: 'production', APP_BASE_URL: 'https://app.example.com' }, () => {
    assert.equal(resolveTenantAppBaseUrl(request('app.example.com'), 'acme'), 'https://acme.example.com');
  });
}

function main() {
  const tests = [testProductionCloud, testQaHost, testDevHost, testCustomDomainProduction];
  for (const test of tests) {
    test();
    console.log(`ok - ${test.name}`);
  }
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
