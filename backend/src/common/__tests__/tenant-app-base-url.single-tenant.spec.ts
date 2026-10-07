import * as assert from 'node:assert/strict';

// On-premise (single-tenant) has one address: the configured application URL.
// Links in e-mails and sign-in redirects built for the `default` tenant must
// use it as is, never a host derived from the tenant slug.

process.env.DEPLOYMENT_MODE = 'single-tenant';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Features } = require('../../config/features');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveTenantAppBaseUrl } = require('../url');

const ENV_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL'] as const;

function withEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function request(host: string, extra: Record<string, string> = {}) {
  return { headers: { host, ...extra }, protocol: 'http' };
}

function testModeIsSingleTenant() {
  assert.equal(Features.SINGLE_TENANT, true);
}

function testAppSubdomainNonProduction() {
  withEnv({ APP_BASE_URL: 'https://app.acme-corp.com' }, () => {
    assert.equal(
      resolveTenantAppBaseUrl(request('app.acme-corp.com'), 'default'),
      'https://app.acme-corp.com',
    );
  });
}

function testAppSubdomainProduction() {
  withEnv({ NODE_ENV: 'production', APP_BASE_URL: 'https://app.acme-corp.com' }, () => {
    assert.equal(
      resolveTenantAppBaseUrl(request('app.acme-corp.com'), 'default'),
      'https://app.acme-corp.com',
    );
  });
}

function testOtherSubdomain() {
  withEnv({ APP_BASE_URL: 'https://kanap.acme-corp.com' }, () => {
    assert.equal(
      resolveTenantAppBaseUrl(request('kanap.acme-corp.com'), 'default'),
      'https://kanap.acme-corp.com',
    );
  });
}

function testForwardedHostIgnored() {
  withEnv({ APP_BASE_URL: 'https://app.acme-corp.com' }, () => {
    assert.equal(
      resolveTenantAppBaseUrl(
        request('app.acme-corp.com', { 'x-forwarded-host': 'default.evil.test', 'x-forwarded-proto': 'http' }),
        'default',
      ),
      'https://app.acme-corp.com',
    );
  });
}

function testKnowledgeReviewLinks() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { KnowledgeController } = require('../../knowledge/knowledge.controller');
  const controller = new KnowledgeController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  withEnv({ APP_BASE_URL: 'https://app.acme-corp.com' }, () => {
    const req = { ...request('app.acme-corp.com'), tenant: { slug: 'default' } };
    assert.equal((controller as any).resolveWorkflowBaseUrl(req), 'https://app.acme-corp.com');
  });
}

function main() {
  const tests = [
    testModeIsSingleTenant,
    testAppSubdomainNonProduction,
    testAppSubdomainProduction,
    testOtherSubdomain,
    testForwardedHostIgnored,
    testKnowledgeReviewLinks,
  ];
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
