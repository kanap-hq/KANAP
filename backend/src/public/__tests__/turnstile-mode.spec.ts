import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Features } from '../../config/features';
import { TurnstileService } from '../turnstile.service';

// The public-form CAPTCHA mode: an explicit CAPTCHA_MODE always wins. Unset, a single-tenant
// install runs with the CAPTCHA off in every run mode (no Turnstile keys needed at start-up),
// and a multi-tenant install in production enforces it.

const ENV_KEYS = ['APP_ENV', 'NODE_ENV', 'CAPTCHA_MODE', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'] as const;
const SITE_KEY_REQUIRED = { message: 'FATAL: TURNSTILE_SITE_KEY is required when CAPTCHA_MODE=enforce' };

function withConfig(singleTenant: boolean, env: Record<string, string>, fn: () => Promise<void> | void) {
  return async () => {
    const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    const savedSingleTenant = Features.SINGLE_TENANT;
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, env);
    (Features as any).SINGLE_TENANT = singleTenant;
    try {
      await fn();
    } finally {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      (Features as any).SINGLE_TENANT = savedSingleTenant;
    }
  };
}

const testSingleTenantProductionWithoutKeys = withConfig(true, { APP_ENV: 'production' }, async () => {
  const service = new TurnstileService();
  assert.equal(service.getClientConfig().mode, 'off');
  assert.equal(service.getClientConfig().enabled, false);
  await service.verifyOrThrow({ token: null, action: 'contact' });
});

const testSingleTenantExplicitEnforceWithoutKeys = withConfig(
  true,
  { APP_ENV: 'production', CAPTCHA_MODE: 'enforce' },
  () => {
    assert.throws(() => new TurnstileService(), SITE_KEY_REQUIRED);
  },
);

const testMultiTenantProductionWithoutKeys = withConfig(false, { APP_ENV: 'production' }, () => {
  assert.throws(() => new TurnstileService(), SITE_KEY_REQUIRED);
});

async function main() {
  await testSingleTenantProductionWithoutKeys();
  await testSingleTenantExplicitEnforceWithoutKeys();
  await testMultiTenantProductionWithoutKeys();
  console.log('turnstile-mode.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
