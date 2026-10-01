import * as assert from 'node:assert/strict';
import type * as PlatformAdminUtil from '../platform-admin.util';

// `Features` reads DEPLOYMENT_MODE once, when it is first imported. Each mode
// is therefore tested on a fresh copy of the modules loaded under that mode, so
// the spec gives the same result whatever DEPLOYMENT_MODE the runner has.

type Mode = 'multi-tenant' | 'single-tenant';

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
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

/** `isPlatformAdmin` as loaded under `mode` (fresh `Features` included). */
function loadFor(mode: Mode): typeof PlatformAdminUtil.isPlatformAdmin {
  return withEnv({ DEPLOYMENT_MODE: mode }, () => {
    for (const path of ['../../config/features', '../platform-admin.util']) delete require.cache[require.resolve(path)];
    return (require('../platform-admin.util') as typeof PlatformAdminUtil).isPlatformAdmin;
  });
}

function testMultiTenant() {
  const isPlatformAdmin = loadFor('multi-tenant');

  withEnv({ PLATFORM_ADMIN_EMAILS: undefined, NODE_ENV: 'test', APP_ENV: 'test' }, () => {
    assert.equal(isPlatformAdmin({ email: 'admin@tenant.example', role: { role_name: 'Administrator' } }), false, 'no allowlist: nobody');
  });

  withEnv({ PLATFORM_ADMIN_EMAILS: 'ops@example.com', NODE_ENV: 'production', APP_ENV: 'production' }, () => {
    assert.equal(isPlatformAdmin({ email: 'ops@example.com', role: { role_name: 'Contact' } }), true, 'listed email');
    assert.equal(isPlatformAdmin({ email: 'OPS@example.com' }), true, 'case-insensitive');
    assert.equal(isPlatformAdmin({ email: 'admin@tenant.example', role: { role_name: 'Administrator' } }), false, 'a tenant administrator is not a platform admin');
  });

  withEnv({ PLATFORM_ADMIN_EMAILS: '*', NODE_ENV: 'production', APP_ENV: 'production' }, () => {
    assert.equal(isPlatformAdmin({ email: 'ops@example.com' }), false, 'wildcard refused in production');
  });

  withEnv({ PLATFORM_ADMIN_EMAILS: '*', NODE_ENV: 'development', APP_ENV: 'development' }, () => {
    assert.equal(isPlatformAdmin({ email: 'ops@example.com' }), true, 'wildcard outside production');
  });
}

function testSingleTenant() {
  const isPlatformAdmin = loadFor('single-tenant');

  withEnv({ PLATFORM_ADMIN_EMAILS: 'ops@example.com', NODE_ENV: 'production', APP_ENV: 'production' }, () => {
    assert.equal(isPlatformAdmin({ email: 'ops@example.com' }), false, 'on-premise: no platform admin, listed email included');
  });

  withEnv({ PLATFORM_ADMIN_EMAILS: '*', NODE_ENV: 'development', APP_ENV: 'development' }, () => {
    assert.equal(isPlatformAdmin({ email: 'ops@example.com' }), false, 'on-premise: no platform admin, wildcard included');
  });
}

testMultiTenant();
testSingleTenant();
console.log('platform-admin.util.spec: ok');
