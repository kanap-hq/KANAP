import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { Features } from '../../config/features';
import { AuthController } from '../../auth/auth.controller';
import { UsersController } from '../../users/users.controller';
import { PortfolioWeeklyReportController } from '../../portfolio/portfolio-weekly-report.controller';
import { ScheduledNotificationsService } from '../../notifications/scheduled-notifications.service';
import { resolveNotificationBaseUrl, resolveTenantAppBaseUrl } from '../url';

// Absolute links to the application (password reset, invitation, sign-in redirects, notification
// and export links) come from the configuration. The request's Host, X-Forwarded-Host and
// X-Forwarded-Proto never change them, except in development mode on a local development host.

const MANAGED_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL'];

async function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of new Set([...MANAGED_KEYS, ...Object.keys(values)])) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withFeatures<T>(values: { SINGLE_TENANT: boolean }, fn: () => Promise<T> | T): Promise<T> {
  const previous = { SINGLE_TENANT: Features.SINGLE_TENANT, EMAIL_ENABLED: Features.EMAIL_ENABLED };
  (Features as any).SINGLE_TENANT = values.SINGLE_TENANT;
  (Features as any).EMAIL_ENABLED = true;
  try {
    return await fn();
  } finally {
    (Features as any).SINGLE_TENANT = previous.SINGLE_TENANT;
    (Features as any).EMAIL_ENABLED = previous.EMAIL_ENABLED;
  }
}

const ON_PREMISE = { APP_BASE_URL: 'https://kanap.example.test' };
const CLOUD = { APP_BASE_URL: 'https://app.kanap.net', APP_URL: 'https://app.kanap.net' };
const WORKSTATION = { APP_BASE_URL: 'http://localhost:5173', APP_URL: 'https://app.dev.kanap.net' };

function requestOn(host: string, options: { forwardedHost?: string; proto?: string; tenantSlug?: string } = {}) {
  const headers: Record<string, string> = { host };
  if (options.forwardedHost) headers['x-forwarded-host'] = options.forwardedHost;
  headers['x-forwarded-proto'] = options.proto ?? 'https';
  return { protocol: 'http', headers, tenant: options.tenantSlug ? { slug: options.tenantSlug } : null } as any;
}

function createAuthController(options: { userExists: boolean }) {
  const sent: Array<{ to: string; resetUrl: string }> = [];
  const lookups: string[] = [];
  const controller = new AuthController(
    { createPasswordResetToken: async () => 'reset-token', getPasswordResetExpirationMinutes: () => 60 } as any,
    {
      findByEmail: async (email: string) => {
        lookups.push(email);
        return options.userExists ? { id: 'user-1', email, locale: null, external_auth_provider: null } : null;
      },
    } as any,
    {} as any,
    {} as any,
    { sendPasswordResetEmail: async (input: { to: string; resetUrl: string }) => { sent.push(input); } } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { controller, sent, lookups };
}

async function resetLinkFor(req: any): Promise<string> {
  const { controller, sent } = createAuthController({ userExists: true });
  const answer = await controller.requestPasswordReset({ email: 'person@example.test' }, req);
  assert.deepEqual(answer, { ok: true });
  assert.equal(sent.length, 1);
  return sent[0].resetUrl;
}

async function inviteBaseFor(req: any): Promise<string> {
  let captured = '';
  const controller = new UsersController(
    { inviteUser: async (_id: string, _actor: string | null, baseUrl: string) => { captured = baseUrl; return { id: 'user-1' }; } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  await controller.invite('user-1', { ...req, user: { sub: 'admin-1' } });
  return captured;
}

const OTHER_HOST = 'other.example.test';

async function testConfiguredLinksIgnoreRequestHost() {
  for (const appEnv of [undefined, 'production']) {
    const label = appEnv ?? 'APP_ENV absent';

    await withFeatures({ SINGLE_TENANT: true }, () => withEnv({ APP_ENV: appEnv, ...ON_PREMISE }, async () => {
      for (const req of [
        requestOn(OTHER_HOST, { tenantSlug: 'default' }),
        requestOn('kanap.example.test', { forwardedHost: OTHER_HOST, proto: 'http', tenantSlug: 'default' }),
      ]) {
        assert.equal(await resetLinkFor(req), 'https://kanap.example.test/reset-password#token=reset-token', `${label}: single-tenant reset`);
        assert.equal(await inviteBaseFor(req), 'https://kanap.example.test', `${label}: single-tenant invitation`);
      }
    }));

    await withFeatures({ SINGLE_TENANT: false }, () => withEnv({ APP_ENV: appEnv, ...CLOUD }, async () => {
      for (const req of [
        requestOn(OTHER_HOST, { tenantSlug: 'acme' }),
        requestOn('acme.kanap.net', { forwardedHost: OTHER_HOST, proto: 'http', tenantSlug: 'acme' }),
      ]) {
        assert.equal(await resetLinkFor(req), 'https://acme.kanap.net/reset-password#token=reset-token', `${label}: multi-tenant reset`);
        assert.equal(await inviteBaseFor(req), 'https://acme.kanap.net', `${label}: multi-tenant invitation`);
      }
      // Sign-in redirects and knowledge links: the tenant's configured address.
      assert.equal(resolveTenantAppBaseUrl(requestOn(OTHER_HOST), 'acme'), 'https://acme.kanap.net', `${label}: tenant redirect`);
      // Notification links: same derivation.
      assert.equal(resolveNotificationBaseUrl('acme'), 'https://acme.kanap.net', `${label}: notification`);
      // XLSX export links.
      const exportController = new PortfolioWeeklyReportController({} as any);
      assert.equal(
        (exportController as any).resolveExportBaseUrl(requestOn(OTHER_HOST, { tenantSlug: 'acme' }), 'acme'),
        'https://acme.kanap.net',
        `${label}: export`,
      );
    }));
  }
}

async function testDevelopmentKeepsLocalDevelopmentHosts() {
  await withFeatures({ SINGLE_TENANT: false }, () => withEnv({ APP_ENV: 'development', ...WORKSTATION }, async () => {
    // Local development hosts: the link follows the request, as on the developer stack.
    assert.equal(
      await resetLinkFor(requestOn('fromage.lvh.me', { proto: 'http', tenantSlug: 'fromage' })),
      'http://fromage.lvh.me/reset-password#token=reset-token',
    );
    assert.equal(await inviteBaseFor(requestOn('fromage.lvh.me', { proto: 'http', tenantSlug: 'fromage' })), 'http://fromage.lvh.me');
    assert.equal(
      await resetLinkFor(requestOn('fromage.dev.kanap.net', { proto: 'http', tenantSlug: 'fromage' })),
      'http://fromage.dev.kanap.net/reset-password#token=reset-token',
    );
    // Sign-in callback on the tunnel apex: back to the tenant on the same development domain.
    assert.equal(resolveTenantAppBaseUrl(requestOn('dev.kanap.net', { proto: 'http' }), 'fromage'), 'http://fromage.dev.kanap.net');
    assert.equal(resolveTenantAppBaseUrl(requestOn('fromage.lvh.me', { proto: 'http' }), 'fromage'), 'http://fromage.lvh.me');

    // Any other host: the configured link.
    assert.equal(
      await resetLinkFor(requestOn(OTHER_HOST, { tenantSlug: 'fromage' })),
      'https://fromage.dev.kanap.net/reset-password#token=reset-token',
    );
    assert.equal(
      await resetLinkFor(requestOn('fromage.lvh.me', { forwardedHost: OTHER_HOST, tenantSlug: 'fromage' })),
      'https://fromage.dev.kanap.net/reset-password#token=reset-token',
    );
    assert.equal(resolveTenantAppBaseUrl(requestOn(OTHER_HOST), 'fromage'), 'https://fromage.dev.kanap.net');
    assert.equal(resolveNotificationBaseUrl('fromage'), 'https://fromage.dev.kanap.net');
  }));
}

function isNotConfigured(error: unknown): boolean {
  return error instanceof BadRequestException && /application URL is not configured/.test(error.message);
}

async function testMissingConfigurationIsExplicit() {
  for (const appEnv of [undefined, 'qa']) {
    await withFeatures({ SINGLE_TENANT: true }, () => withEnv({ APP_ENV: appEnv }, async () => {
      // Reset request: the same answer whether the account exists or not, and no lookup at all.
      for (const userExists of [true, false]) {
        const { controller, sent, lookups } = createAuthController({ userExists });
        await assert.rejects(
          () => controller.requestPasswordReset({ email: 'person@example.test' }, requestOn('kanap.example.test')),
          isNotConfigured,
        );
        assert.equal(sent.length, 0);
        assert.deepEqual(lookups, []);
      }
      // Invitation: the administrator gets the message.
      await assert.rejects(() => inviteBaseFor(requestOn('kanap.example.test')), isNotConfigured);
      // Sign-in redirects and notification links refuse as well.
      assert.throws(() => resolveTenantAppBaseUrl(requestOn('kanap.example.test'), 'default'), isNotConfigured);
      assert.throws(() => resolveNotificationBaseUrl('default'), /application URL is not configured/);
      // The export keeps relative links.
      const exportController = new PortfolioWeeklyReportController({} as any);
      assert.equal((exportController as any).resolveExportBaseUrl(requestOn('kanap.example.test'), 'default'), null);
    }));
  }
}

async function testScheduledNotificationsSkipWithoutConfiguration() {
  await withFeatures({ SINGLE_TENANT: true }, () => withEnv({ APP_ENV: undefined }, async () => {
    const warnings: string[] = [];
    const service = new ScheduledNotificationsService(
      { query: async () => { throw new Error('the run must not reach the database'); } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (service as any).logger = { log: () => undefined, debug: () => undefined, warn: (line: string) => warnings.push(line) };

    const expirations = await service.checkExpirations();
    const weekly = await service.sendWeeklyReviews();
    assert.equal(expirations.skipped_reason, 'application URL is not configured');
    assert.equal(weekly.skipped_reason, 'application URL is not configured');
    assert.deepEqual(expirations.errors, []);
    assert.deepEqual(weekly.errors, []);
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((line) => line.includes('application URL is not configured')));
  }));
}

async function run() {
  await testConfiguredLinksIgnoreRequestHost();
  await testDevelopmentKeepsLocalDevelopmentHosts();
  await testMissingConfigurationIsExplicit();
  await testScheduledNotificationsSkipWithoutConfiguration();
  console.log('app-links.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
