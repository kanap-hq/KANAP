import * as assert from 'node:assert/strict';
import { AuthController } from '../auth.controller';
import { Features } from '../../config/features';

// The password reset e-mail links to the tenant address of the request
// (`https://<slug>.kanap.net`), not to the configured marketing address.

const ENV_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL', 'MARKETING_BASE_URL'] as const;

async function testResetLinkOpensTheTenantAddress() {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedFeatures = { SINGLE_TENANT: Features.SINGLE_TENANT, EMAIL_ENABLED: Features.EMAIL_ENABLED };
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    APP_ENV: 'production',
    APP_BASE_URL: 'https://kanap.net',
    APP_URL: 'https://app.kanap.net',
    MARKETING_BASE_URL: 'https://kanap.net',
  });
  (Features as any).SINGLE_TENANT = false;
  (Features as any).EMAIL_ENABLED = true;
  try {
    const sent: any[] = [];
    const auth = {
      createPasswordResetToken: async () => 'reset-token',
      getPasswordResetExpirationMinutes: () => 60,
    };
    const users = {
      findByEmail: async (email: string) => ({ id: 'u-1', email, locale: 'en', external_auth_provider: null }),
    };
    const emails = { sendPasswordResetEmail: async (params: any) => { sent.push(params); } };
    const controller = new AuthController(
      auth as any, users as any, {} as any, {} as any, emails as any, {} as any, {} as any, {} as any,
      { recordAuthEvent: async () => undefined } as any,
    );

    const result = await controller.requestPasswordReset(
      { email: 'User@Example.invalid' },
      { tenant: { slug: 'acme' }, headers: { host: 'acme.kanap.net' } },
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].resetUrl, 'https://acme.kanap.net/reset-password#token=reset-token');
  } finally {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    Object.assign(Features as any, savedFeatures);
  }
}

testResetLinkOpensTheTenantAddress()
  .then(() => console.log('password-reset-link.spec: ok'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
