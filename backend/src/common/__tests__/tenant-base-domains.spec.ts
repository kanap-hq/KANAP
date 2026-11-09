import * as assert from 'node:assert/strict';
import { Features } from '../../config/features';
import { createOriginPolicy, tenantSlugForRequest } from '../cors-policy';
import { tenantBaseDomains } from '../tenant-base-domains';
import { createRequestTenancyMiddleware, tenantSlugFromHost } from '../tenancy/request-tenancy.middleware';
import {
  developmentRequestOrigin,
  isLocalDevelopmentHost,
  resolveConfiguredAppBaseUrl,
  resolveTenantAppBaseUrl,
} from '../url';

// TENANT_BASE_DOMAINS: the domains the tenants are served under (`<slug>.<domain>`), cloud only.
// Empty or absent, the hosts are read exactly as before the variable existed: the tables below
// were recorded on the code without it.

const MANAGED_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL', 'TENANT_BASE_DOMAINS'];

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T, singleTenant = false): T {
  const previous = new Map<string, string | undefined>();
  for (const key of new Set([...MANAGED_KEYS, ...Object.keys(values)])) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const previousSingleTenant = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = singleTenant;
  try {
    return fn();
  } finally {
    (Features as any).SINGLE_TENANT = previousSingleTenant;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function requestOn(host: string, proto = 'https') {
  return { protocol: 'http', headers: { host, 'x-forwarded-proto': proto }, tenant: null } as any;
}

/** The values the variable takes when it is "not set". */
const UNSET_VALUES: Array<string | undefined> = [undefined, '', '  ', ' , ,'];

// Host -> tenantSlugFromHost, as the code read it before TENANT_BASE_DOMAINS.
const LEGACY_SLUGS: Array<[string, string | null]> = [
  ['', null],
  ['acme.lvh.me', 'acme'],
  ['www.lvh.me', null],
  ['lvh.lvh.me', null],
  ['lvh.me', null],
  ['a.b.lvh.me', 'a.b'],
  ['acme.dev.kanap.net', 'acme'],
  ['www.dev.kanap.net', null],
  ['dev.kanap.net', null],
  ['acme.qa.kanap.net', 'acme'],
  ['www.qa.kanap.net', null],
  ['qa.kanap.net', null],
  ['acme.kanap.net', 'acme'],
  ['app.kanap.net', 'app'],
  ['platform-admin.kanap.net', 'platform-admin'],
  ['www.kanap.net', null],
  ['kanap.net', null],
  ['a.b.kanap.net', 'a.b'],
  ['acme.notkanap.net', null],
  ['acme.kanap.net.evil.org', null],
  ['localhost', null],
  ['acme.localhost', null],
  ['example.com', null],
  ['acme.example.com', null],
  ['app.example.com', null],
];

// Configured address -> link base of the tenant `acme` (multi-tenant).
const LEGACY_LINKS: Array<[Record<string, string>, string | null]> = [
  [{}, null],
  [{ APP_BASE_URL: 'https://kanap.net' }, 'https://acme.kanap.net'],
  [{ APP_BASE_URL: 'https://www.kanap.net' }, 'https://acme.kanap.net'],
  [{ APP_BASE_URL: 'https://app.kanap.net' }, 'https://acme.kanap.net'],
  [{ APP_BASE_URL: 'https://qa.kanap.net' }, 'https://acme.qa.kanap.net'],
  [{ APP_BASE_URL: 'https://app.qa.kanap.net' }, 'https://acme.qa.kanap.net'],
  [{ APP_BASE_URL: 'https://dev.kanap.net' }, 'https://acme.dev.kanap.net'],
  [{ APP_BASE_URL: 'http://lvh.me:5173' }, 'http://acme.lvh.me:5173'],
  [{ APP_BASE_URL: 'http://www.lvh.me' }, 'http://acme.lvh.me'],
  [{ APP_BASE_URL: 'http://localhost:5173' }, 'http://localhost:5173'],
  [{ APP_BASE_URL: 'https://app.example.com' }, 'https://acme.example.com'],
  [{ APP_BASE_URL: 'https://example.com' }, 'https://example.com'],
  [{ APP_BASE_URL: 'https://kanap.example.test' }, 'https://kanap.example.test'],
  [{ APP_BASE_URL: 'https://example.com', APP_URL: 'https://app.kanap.net' }, 'https://acme.kanap.net'],
  [{ PUBLIC_APP_URL: 'https://kanap.net:8443/' }, 'https://acme.kanap.net:8443'],
];

// Development mode, no configured address: request host -> link base of `acme`
// (resolveTenantAppBaseUrl), null when it throws.
const LEGACY_DEV_TENANT_LINKS: Array<[string, string | null]> = [
  ['other.lvh.me', 'https://acme.lvh.me'],
  ['lvh.me', 'https://acme.lvh.me'],
  ['acme.dev.kanap.net', 'https://acme.dev.kanap.net'],
  ['other.dev.kanap.net', 'https://acme.dev.kanap.net'],
  ['dev.kanap.net', 'https://acme.dev.kanap.net'],
  ['localhost', 'https://localhost'],
  ['fromage.localhost', 'https://fromage.localhost'],
  ['acme.qa.kanap.net', null],
  ['acme.kanap.net', null],
  ['acme.example.com', null],
];

// Host -> isLocalDevelopmentHost.
const LEGACY_DEV_HOSTS: Array<[string, boolean]> = [
  ['lvh.me', true],
  ['acme.lvh.me', true],
  ['localhost', true],
  ['fromage.localhost', true],
  ['dev.kanap.net', true],
  ['acme.dev.kanap.net', true],
  ['qa.kanap.net', false],
  ['acme.qa.kanap.net', false],
  ['kanap.net', false],
  ['acme.kanap.net', false],
  ['example.com', false],
  ['acme.example.com', false],
];

function devTenantLink(host: string): string | null {
  try {
    return resolveTenantAppBaseUrl(requestOn(host), 'acme');
  } catch {
    return null;
  }
}

function testUnsetListKeepsTodaysReading() {
  for (const value of UNSET_VALUES) {
    const label = `TENANT_BASE_DOMAINS=${JSON.stringify(value)}`;
    withEnv({ TENANT_BASE_DOMAINS: value }, () => {
      for (const [host, slug] of LEGACY_SLUGS) {
        assert.equal(tenantSlugFromHost(host), slug, `${label}: slug of ${host}`);
      }
      for (const [host, expected] of LEGACY_DEV_HOSTS) {
        assert.equal(isLocalDevelopmentHost(host), expected, `${label}: development host ${host}`);
      }
    });
    for (const [config, expected] of LEGACY_LINKS) {
      const env = { ...config, TENANT_BASE_DOMAINS: value };
      assert.equal(resolveConfiguredAppBaseUrl('acme', env, false), expected, `${label}: links of ${JSON.stringify(config)}`);
    }
    // Without a tenant, and in single-tenant mode, the first configured address as written.
    assert.equal(resolveConfiguredAppBaseUrl(null, { APP_BASE_URL: 'https://kanap.net', TENANT_BASE_DOMAINS: value }, false), 'https://kanap.net');
    assert.equal(resolveConfiguredAppBaseUrl('acme', { APP_BASE_URL: 'https://kanap.net', TENANT_BASE_DOMAINS: value }, true), 'https://kanap.net');

    withEnv({ APP_ENV: 'development', TENANT_BASE_DOMAINS: value }, () => {
      for (const [host, expected] of LEGACY_DEV_TENANT_LINKS) {
        assert.equal(devTenantLink(host), expected, `${label}: development links of acme on ${host}`);
      }
      assert.equal(developmentRequestOrigin(requestOn('acme.dev.kanap.net')), 'https://acme.dev.kanap.net');
      assert.equal(developmentRequestOrigin(requestOn('acme.lvh.me', 'http')), 'http://acme.lvh.me');
      assert.equal(developmentRequestOrigin(requestOn('acme.qa.kanap.net')), null);
      assert.equal(developmentRequestOrigin(requestOn('acme.kanap.net')), null);
    });
    withEnv({ APP_ENV: 'production', TENANT_BASE_DOMAINS: value }, () => {
      assert.equal(developmentRequestOrigin(requestOn('acme.lvh.me')), null);
      assert.equal(developmentRequestOrigin(requestOn('acme.dev.kanap.net')), null);
    });
  }
}

const PRODUCTION_LIST = 'kanap.net, Example.COM ';

function testListedDomainsGiveTheTenant() {
  withEnv({ TENANT_BASE_DOMAINS: PRODUCTION_LIST }, () => {
    const cases: Array<[string, string | null]> = [
      ['acme.kanap.net', 'acme'],
      ['acme.example.com', 'acme'],
      ['acme-2.example.com', 'acme-2'],
      // Apex and www: the public site.
      ['example.com', null],
      ['www.example.com', null],
      ['kanap.net', null],
      ['www.kanap.net', null],
      // One level of subdomain only.
      ['a.b.example.com', null],
      ['a.b.kanap.net', null],
      ['acme.qa.kanap.net', null],
      // The domain ends at a dot.
      ['acme.example.com.evil.org', null],
      ['acme.notexample.com', null],
      ['acmeexample.com', null],
      ['example.com.', null],
      // Not listed: the built-in domains are replaced, not added to.
      ['acme.example.org', null],
      // The development rules stay as they are.
      ['acme.lvh.me', 'acme'],
      ['www.lvh.me', null],
      ['acme.localhost', null],
      ['localhost', null],
    ];
    for (const [host, slug] of cases) {
      assert.equal(tenantSlugFromHost(host), slug, `slug of ${host}`);
    }
    // A listed environment domain reads as a slug under a shorter listed domain: reserved names.
    assert.equal(tenantSlugFromHost('qa.kanap.net'), 'qa');
  });

  // QA lists its own domains: the production domain is no longer read.
  withEnv({ TENANT_BASE_DOMAINS: 'qa.kanap.net,qa.example.com' }, () => {
    assert.equal(tenantSlugFromHost('acme.qa.kanap.net'), 'acme');
    assert.equal(tenantSlugFromHost('acme.qa.example.com'), 'acme');
    assert.equal(tenantSlugFromHost('qa.example.com'), null);
    assert.equal(tenantSlugFromHost('acme.kanap.net'), null);
    assert.equal(tenantSlugFromHost('acme.example.com'), null);
  });

  // Nested listed domains: the longest one wins, whatever the order of the list.
  withEnv({ TENANT_BASE_DOMAINS: 'kanap.net,qa.kanap.net' }, () => {
    assert.equal(tenantSlugFromHost('acme.qa.kanap.net'), 'acme');
    assert.equal(tenantSlugFromHost('acme.kanap.net'), 'acme');
    assert.equal(tenantSlugFromHost('qa.kanap.net'), null);
  });

  // An entry that is not a domain name is ignored (with a warning); nothing valid left = not set.
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (line: string) => { warnings.push(line); };
  try {
    assert.deepEqual(tenantBaseDomains({ TENANT_BASE_DOMAINS: 'https://example.com, example.org' }, false), ['example.org']);
    assert.equal(tenantBaseDomains({ TENANT_BASE_DOMAINS: '*.example.com' }, false), null);
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = warn;
  }
}

function testLinksFollowTheListedDomains() {
  const links: Array<[Record<string, string>, string | null]> = [
    // The trap: the links of a second-domain configuration go to the tenant, not to the apex.
    [{ APP_BASE_URL: 'https://example.com' }, 'https://acme.example.com'],
    [{ APP_BASE_URL: 'https://www.example.com' }, 'https://acme.example.com'],
    [{ APP_BASE_URL: 'https://app.example.com' }, 'https://acme.example.com'],
    [{ APP_BASE_URL: 'https://example.com:8443' }, 'https://acme.example.com:8443'],
    [{ APP_BASE_URL: 'https://kanap.net' }, 'https://acme.kanap.net'],
    [{ APP_BASE_URL: 'https://app.kanap.net' }, 'https://acme.kanap.net'],
    [{ APP_BASE_URL: 'http://lvh.me:5173' }, 'http://acme.lvh.me:5173'],
    // A domain outside the list is not derived (no `app.` rule): the first address as written.
    [{ APP_BASE_URL: 'https://other.example.org', APP_URL: 'https://app.example.org' }, 'https://other.example.org'],
    [{ APP_BASE_URL: 'https://other.example.org', APP_URL: 'https://app.example.com' }, 'https://acme.example.com'],
  ];
  for (const [config, expected] of links) {
    const env = { ...config, TENANT_BASE_DOMAINS: PRODUCTION_LIST };
    assert.equal(resolveConfiguredAppBaseUrl('acme', env, false), expected, `links of ${JSON.stringify(config)}`);
  }
  assert.equal(resolveConfiguredAppBaseUrl(null, { APP_BASE_URL: 'https://example.com', TENANT_BASE_DOMAINS: PRODUCTION_LIST }, false), 'https://example.com');

  // Development mode: a host of the list keeps its links on itself, as dev.kanap.net does.
  withEnv({ APP_ENV: 'development', TENANT_BASE_DOMAINS: 'dev.kanap.net,dev.example.com' }, () => {
    assert.equal(isLocalDevelopmentHost('acme.dev.example.com'), true);
    assert.equal(isLocalDevelopmentHost('acme.lvh.me'), true);
    assert.equal(isLocalDevelopmentHost('acme.example.com'), false);
    assert.equal(developmentRequestOrigin(requestOn('acme.dev.example.com')), 'https://acme.dev.example.com');
    assert.equal(devTenantLink('other.dev.example.com'), 'https://acme.dev.example.com');
    assert.equal(devTenantLink('acme.dev.kanap.net'), 'https://acme.dev.kanap.net');
    assert.equal(devTenantLink('fromage.localhost'), 'https://fromage.localhost');
  });
  // Elsewhere, the list never makes a host a development host.
  for (const mode of ['production', 'qa', undefined]) {
    withEnv({ APP_ENV: mode, TENANT_BASE_DOMAINS: PRODUCTION_LIST, APP_BASE_URL: 'https://example.com' }, () => {
      assert.equal(isLocalDevelopmentHost('acme.example.com'), false, `mode ${mode}`);
      assert.equal(developmentRequestOrigin(requestOn('acme.example.com')), null, `mode ${mode}`);
      assert.equal(devTenantLink('other.example.com'), 'https://acme.example.com', `mode ${mode}`);
    });
  }
}

function testCorsOfATenantUnderTheSecondDomain() {
  const env = {
    APP_ENV: 'production',
    APP_BASE_URL: 'https://kanap.net',
    CORS_ORIGINS: 'https://*.kanap.net,https://*.example.com',
    TENANT_BASE_DOMAINS: PRODUCTION_LIST,
  };
  const policy = createOriginPolicy({ env, singleTenant: false });
  const check = (origin: string, host: string, policyEnv: NodeJS.ProcessEnv = env, p = policy) =>
    p.check({ origin, host, tenantSlug: tenantSlugForRequest({ headers: { host } }, policyEnv) });

  // Rule d: the pattern entry, for the tenant the host names only.
  assert.deepEqual(check('https://acme.example.com', 'acme.example.com:3000'), { allowed: true, rule: 'tenant-pattern' });
  assert.deepEqual(check('https://other.example.com', 'acme.example.com:3000'), { allowed: false });
  // The configured address (rule b) comes first for the tenant on the first domain.
  assert.deepEqual(check('https://acme.kanap.net', 'acme.kanap.net:3000'), { allowed: true, rule: 'application' });

  // Rule b: the tenant's configured address, derived on the listed second domain.
  const secondEnv = { APP_ENV: 'production', APP_BASE_URL: 'https://example.com', CORS_ORIGINS: 'https://partner.example.org', TENANT_BASE_DOMAINS: PRODUCTION_LIST };
  const second = createOriginPolicy({ env: secondEnv, singleTenant: false });
  assert.deepEqual(check('https://acme.example.com', 'acme.example.com:3000', secondEnv, second), { allowed: true, rule: 'application' });
  assert.deepEqual(check('https://other.example.com', 'acme.example.com:3000', secondEnv, second), { allowed: false });

  // Without the list, the second domain names no tenant.
  const unlistedEnv = { ...env, TENANT_BASE_DOMAINS: '' };
  const unlisted = createOriginPolicy({ env: unlistedEnv, singleTenant: false });
  assert.equal(tenantSlugForRequest({ headers: { host: 'acme.example.com' } }, unlistedEnv), null);
  assert.deepEqual(check('https://acme.example.com', 'acme.example.com:3000', unlistedEnv, unlisted), { allowed: false });
}

async function testTenancyMiddlewareReadsTheList() {
  const lookups: unknown[][] = [];
  const middleware = (singleTenant: boolean) => createRequestTenancyMiddleware({
    query: async (_sql, params) => { lookups.push(params); return [{ id: 't-1', slug: String(params[0]), name: 'Acme' }]; },
    singleTenant,
    defaultTenantSlug: 'default',
    platformAdminHost: 'platform-admin.kanap.net',
    marketingRedirectUrl: 'https://www.kanap.net',
  });
  const run = async (singleTenant: boolean, host: string) => {
    const req: any = { headers: { host }, method: 'GET', path: '/spend-items', originalUrl: '/spend-items' };
    const res: any = { status: () => res, json: () => res, setHeader: () => undefined };
    await middleware(singleTenant)(req, res, () => undefined);
    return req.tenant?.slug ?? null;
  };
  await withEnvAsync({ TENANT_BASE_DOMAINS: PRODUCTION_LIST }, async () => {
    assert.equal(await run(false, 'acme.example.com:443'), 'acme');
    assert.equal(await run(false, 'www.example.com'), null);
    assert.deepEqual(lookups, [['acme']]);
  });
}

async function withEnvAsync<T>(values: Record<string, string | undefined>, fn: () => Promise<T>, singleTenant = false): Promise<T> {
  const previous = { env: process.env.TENANT_BASE_DOMAINS, singleTenant: Features.SINGLE_TENANT };
  if (values.TENANT_BASE_DOMAINS === undefined) delete process.env.TENANT_BASE_DOMAINS;
  else process.env.TENANT_BASE_DOMAINS = values.TENANT_BASE_DOMAINS;
  (Features as any).SINGLE_TENANT = singleTenant;
  try {
    return await fn();
  } finally {
    (Features as any).SINGLE_TENANT = previous.singleTenant;
    if (previous.env === undefined) delete process.env.TENANT_BASE_DOMAINS;
    else process.env.TENANT_BASE_DOMAINS = previous.env;
  }
}

async function testSingleTenantIgnoresTheList() {
  // On-premise: one domain, the configured address as written, the Host never read.
  assert.equal(tenantBaseDomains({ TENANT_BASE_DOMAINS: PRODUCTION_LIST }, true), null);
  assert.equal(
    resolveConfiguredAppBaseUrl('acme', { APP_BASE_URL: 'https://example.com', TENANT_BASE_DOMAINS: PRODUCTION_LIST }, true),
    'https://example.com',
  );
  withEnv({ TENANT_BASE_DOMAINS: PRODUCTION_LIST }, () => {
    for (const [host, slug] of LEGACY_SLUGS) {
      assert.equal(tenantSlugFromHost(host), slug, `single-tenant: slug of ${host}`);
    }
    for (const [host, expected] of LEGACY_DEV_HOSTS) {
      assert.equal(isLocalDevelopmentHost(host), expected, `single-tenant: development host ${host}`);
    }
  }, true);
  const single = createOriginPolicy({ env: { APP_ENV: 'production', APP_BASE_URL: 'https://example.com', CORS_ORIGINS: 'https://example.com', TENANT_BASE_DOMAINS: PRODUCTION_LIST }, singleTenant: true });
  assert.deepEqual(single.check({ origin: 'https://acme.example.com', host: 'example.com:3000', tenantSlug: null }), { allowed: false });

  let looked: unknown[] | null = null;
  const middleware = createRequestTenancyMiddleware({
    query: async (_sql, params) => { looked = params; return [{ id: 't-1', slug: 'default', name: 'Default' }]; },
    singleTenant: true,
    defaultTenantSlug: 'default',
    platformAdminHost: '',
    marketingRedirectUrl: 'https://www.kanap.net',
  });
  const req: any = { headers: { host: 'acme.example.com' }, method: 'GET', path: '/spend-items', originalUrl: '/spend-items' };
  await withEnvAsync({ TENANT_BASE_DOMAINS: PRODUCTION_LIST }, () => middleware(req, {} as any, () => undefined), true);
  assert.deepEqual(looked, ['default']);
  assert.equal(req.tenant.slug, 'default');
}

async function main() {
  testUnsetListKeepsTodaysReading();
  testListedDomainsGiveTheTenant();
  testLinksFollowTheListedDomains();
  testCorsOfATenantUnderTheSecondDomain();
  await testTenancyMiddlewareReadsTheList();
  await testSingleTenantIgnoresTheList();
  console.log('tenant-base-domains.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
