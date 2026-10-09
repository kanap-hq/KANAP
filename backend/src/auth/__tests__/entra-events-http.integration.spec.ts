import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { BadRequestException, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { SecurityEventsService } from '../../audit/security-events.service';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { waitForBackgroundWork } from '../../common/background-work';
import { applyTrustProxy, resolveTrustProxy } from '../../common/client-address';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { RATE_LIMITS } from '../../common/rate-limit';
import { RateLimitGuard } from '../../common/rate-limit.guard';
import { useRequestPipeline } from '../../common/request-pipeline';
import { NotificationsService } from '../../notifications/notifications.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { TenantsService } from '../../tenants/tenants.service';
import { UsersService } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { EntraAuthService } from '../entra-auth.service';
import { EntraDirectorySyncService } from '../entra-directory-sync.service';
import { EntraController } from '../entra.controller';

// Failed single sign-on requests, over HTTP against the database, with the
// production request pipeline (common/request-pipeline.ts) and one trusted
// proxy:
// - a request where nothing verifies (no valid state, no valid hand-off) on a
//   host whose tenant has no single sign-on writes no audit row, however many
//   of them arrive;
// - on a host whose tenant has single sign-on set up, each such request writes
//   one `sso_login_failed` row, and the sign-in rate limit bounds them;
// - `GET /auth/entra/callback` and `POST /auth/entra/session` answer 429 past
//   the single sign-on rate limit (RATE_LIMITS.ssoSignIn), counted per client
//   address and wider than the password sign-in limit.

const LIMIT = RATE_LIMITS.ssoSignIn.limit;

/** The directory side: no state and no hand-off verifies. */
const entra = {
  handleCallback: async () => {
    throw new BadRequestException('Invalid Entra state');
  },
  peekState: () => null,
  verifyLoginHandoff: () => {
    throw new BadRequestException('Invalid Entra login session');
  },
};

/** The tenant registry, read from the database (single sign-on columns only). */
const tenants = {
  findById: async (id: string) => {
    const rows = await dataSource.query(`SELECT id, slug, sso_provider, entra_tenant_id FROM tenants WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },
};

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 10 }] })],
  controllers: [EntraController],
  providers: [
    ListContextsService,
    RateLimitGuard,
    { provide: DataSource, useValue: dataSource },
    { provide: EntraAuthService, useValue: entra },
    { provide: TenantsService, useValue: tenants },
    { provide: AuthService, useValue: {} },
    { provide: UsersService, useValue: {} },
    { provide: AuditService, useValue: {} },
    { provide: NotificationsService, useValue: {} },
    { provide: EntraDirectorySyncService, useValue: {} },
    // For the guards of the setup routes, which these requests never reach.
    { provide: PermissionsService, useValue: {} },
    { provide: StripeConfigService, useValue: {} },
    { provide: SecurityEventsService, useFactory: () => new SecurityEventsService(dataSource) },
  ],
})
class EntraEventsProbeModule {}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(EntraEventsProbeModule, { logger: false, abortOnError: false });
  applyTrustProxy(app.getHttpAdapter().getInstance(), resolveTrustProxy('1', false));
  // The tenant middleware's job, from a header.
  app.use((req: any, _res: any, next: () => void) => {
    const tenantId = req.headers['x-probe-tenant'];
    if (tenantId) req.tenant = { id: tenantId, slug: 'entra-events-probe', name: 'Entra events probe' };
    next();
  });
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  return app;
}

type Route = 'callback' | 'session';

async function call(app: INestApplication, route: Route, tenantId: string, clientAddress: string): Promise<number> {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const headers = { 'x-probe-tenant': tenantId, 'x-forwarded-for': `192.0.2.1, ${clientAddress}`, 'content-type': 'application/json' };
  const res = route === 'callback'
    ? await fetch(`http://127.0.0.1:${port}/auth/entra/callback?code=c&state=s`, { headers, redirect: 'manual', signal: AbortSignal.timeout(5000) })
    : await fetch(`http://127.0.0.1:${port}/auth/entra/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ handoff: 'h' }),
      signal: AbortSignal.timeout(5000),
    });
  await res.text();
  return res.status;
}

async function seedTenant(tag: string, sso: boolean): Promise<string> {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, sso_provider, entra_tenant_id, created_at, updated_at)
     VALUES ($1, $2, 'Entra events probe', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, $3, $4, now(), now())`,
    [tenantId, `entra-events-${tag}-${tenantId.slice(0, 8)}`, sso ? 'entra' : 'none', sso ? 'probe-directory' : null],
  );
  return tenantId;
}

async function authRows(tenantId: string): Promise<Array<{ action: string; source_ref: string | null; ip: string | null }>> {
  assert.equal(await waitForBackgroundWork(Date.now() + 5000), 0, 'event writes finished');
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return manager.query(
      `SELECT action, source_ref, after_json->>'ip' AS ip FROM audit_log WHERE table_name = 'auth' ORDER BY created_at, id`,
    );
  });
}

async function cleanup(tenantIds: string[]) {
  for (const tenantId of tenantIds) {
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await manager.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    }).catch(() => undefined);
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => undefined);
  }
}

async function main() {
  const unhandled: unknown[] = [];
  process.on('unhandledRejection', (reason) => unhandled.push(reason));
  process.env.RATE_LIMIT_ENABLED = 'true';

  await dataSource.initialize();
  const plain = await seedTenant('plain', false);
  const sso = await seedTenant('sso', true);
  const app = await createApp();
  try {
    assert.ok(LIMIT > RATE_LIMITS.authLogin.limit, 'single sign-on has its own, wider budget');

    // A run of requests that verify nothing, on a host without single sign-on, from two
    // addresses (each up to the limit): every one refused, no row.
    for (let i = 1; i <= 2; i += 1) {
      for (let n = 0; n < LIMIT; n += 1) {
        assert.equal(await call(app, 'callback', plain, `198.51.100.${i}`), 400);
        assert.equal(await call(app, 'session', plain, `198.51.100.${i}`), 400);
      }
    }
    assert.deepEqual(await authRows(plain), [], 'no row for requests where nothing verifies');

    // Past the limit, from one address: 429 on both routes. Another address still gets through.
    assert.equal(await call(app, 'callback', plain, '198.51.100.1'), 429);
    assert.equal(await call(app, 'session', plain, '198.51.100.1'), 429);
    assert.equal(await call(app, 'callback', plain, '198.51.100.99'), 400);

    // A host with single sign-on set up: one row per refused request, at most the limit per
    // address and route; past it, 429 and no row.
    for (let n = 0; n < LIMIT; n += 1) {
      assert.equal(await call(app, 'callback', sso, '203.0.113.5'), 400);
      assert.equal(await call(app, 'session', sso, '203.0.113.5'), 400);
    }
    assert.equal(await call(app, 'callback', sso, '203.0.113.5'), 429);
    assert.equal(await call(app, 'session', sso, '203.0.113.5'), 429);
    const rows = await authRows(sso);
    assert.equal(rows.length, 2 * LIMIT);
    assert.equal(rows.filter((row) => row.action === 'sso_login_failed' && row.source_ref === 'invalid_state').length, LIMIT);
    assert.equal(rows.filter((row) => row.action === 'sso_login_failed' && row.source_ref === 'invalid_token').length, LIMIT);
    assert.ok(rows.every((row) => row.ip === '203.0.113.5'), 'the client address the trusted proxy appended');
    assert.deepEqual(await authRows(plain), [], 'still no row on the host without single sign-on');

    assert.deepEqual(unhandled, [], 'no unhandled rejection');
  } finally {
    await app.close();
    await cleanup([plain, sso]);
    await dataSource.destroy();
  }
  console.log('entra-events-http.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
