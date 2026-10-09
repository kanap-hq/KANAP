import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import * as argon2 from 'argon2';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { SecurityEventsService } from '../../audit/security-events.service';
import { BillingService } from '../../billing/billing.service';
import { waitForBackgroundWork } from '../../common/background-work';
import { applyTrustProxy, resolveTrustProxy } from '../../common/client-address';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';
import { Company } from '../../companies/company.entity';
import { Features } from '../../config/features';
import { FxIngestionService } from '../../currency/fx-ingestion.service';
import { Department } from '../../departments/department.entity';
import { EmailService } from '../../email/email.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { TenantsService } from '../../tenants/tenants.service';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { PasswordResetToken } from '../password-reset-token.entity';
import { RefreshToken } from '../refresh-token.entity';

// Sign-in and session events, over HTTP against the database, with the
// production request pipeline (common/request-pipeline.ts) and one trusted
// proxy:
// - a sign-in, a refused sign-in (wrong password, unknown account, disabled
//   account), a refused session renewal, a sign-out, a password reset request
//   and its completion each write one `auth` row in the tenant's audit log,
//   with the client address (the entry the trusted proxy appended) and the
//   user agent; a refused sign-in is written apart from its rolled-back
//   transaction;
// - the responses are the ones the routes gave before: same status, same body;
// - no row holds a password, a token, a hash, a reset link, or the address of
//   an account the tenant does not have;
// - each tenant gets its own rows only;
// - a write that fails or hangs changes nothing to the responses.

const PASSWORD = 'Probe-pass-2026';
const NEXT_PASSWORD = 'Probe-next-2026';
const USER_AGENT = 'Probe-agent/1.0';
const FORWARDED_FOR = '192.0.2.1, 198.51.100.7';
const CLIENT_ADDRESS = '198.51.100.7';

type Seed = { tenantId: string; slug: string; ada: { id: string; email: string }; bob: { id: string; email: string } };

/** The data source the event writer uses: the real one, or one whose connections fail or never come. */
let eventsMode: 'database' | 'failing' | 'hanging' = 'database';
const eventsDataSource = {
  createQueryRunner: () => {
    if (eventsMode === 'failing') throw new Error('events database unavailable');
    if (eventsMode === 'hanging') {
      return { connect: () => new Promise(() => undefined), release: async () => undefined, isTransactionActive: false };
    }
    return dataSource.createQueryRunner();
  },
};

const sentResets: Array<{ to: string; resetUrl: string }> = [];

function createUsersService() {
  return new UsersService(
    dataSource.getRepository(User),
    dataSource.getRepository(Company),
    dataSource.getRepository(Department),
    {} as any,
    { getSubscriptionSummary: async () => ({ seat_limit: null, seats_used: 0 }) } as any,
    {} as any,
    new AuditService(dataSource.getRepository(AuditLog)),
  );
}

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 10 }] })],
  controllers: [AuthController],
  providers: [
    ListContextsService,
    { provide: DataSource, useValue: dataSource },
    { provide: UsersService, useFactory: createUsersService },
    {
      provide: AuthService,
      useFactory: (users: UsersService) => new AuthService(users, dataSource.getRepository(RefreshToken), dataSource.getRepository(PasswordResetToken)),
      inject: [UsersService],
    },
    { provide: SecurityEventsService, useFactory: () => new SecurityEventsService(eventsDataSource as any) },
    { provide: PermissionsService, useValue: {} },
    { provide: BillingService, useValue: {} },
    { provide: EmailService, useValue: { sendPasswordResetEmail: async (input: { to: string; resetUrl: string }) => { sentResets.push(input); } } },
    { provide: FxIngestionService, useValue: { maybeRefreshOnLogin: async () => undefined } },
    { provide: TenantsService, useValue: {} },
  ],
})
class AuthEventsProbeModule {}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AuthEventsProbeModule, { logger: false });
  applyTrustProxy(app.getHttpAdapter().getInstance(), resolveTrustProxy('1', false));
  // The tenant middleware's job, from a header.
  app.use((req: any, _res: any, next: () => void) => {
    const tenantId = req.headers['x-probe-tenant'];
    if (tenantId) req.tenant = { id: tenantId, slug: req.headers['x-probe-slug'], name: 'Auth events probe' };
    next();
  });
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  return app;
}

/** A request that gets no answer within `timeoutMs` fails the spec (no spec run waits forever). */
async function post(app: INestApplication, seed: Seed, path: string, body: Record<string, unknown>, timeoutMs = 5000) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  let res: Awaited<ReturnType<typeof fetch>>;
  let text: string;
  try {
    res = await fetch(`http://127.0.0.1:${port}/auth/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        'x-forwarded-for': FORWARDED_FOR,
        'x-probe-tenant': seed.tenantId,
        'x-probe-slug': seed.slug,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (error) {
    if ((error as Error)?.name === 'TimeoutError') throw new Error(`POST /auth/${path}: no answer within ${timeoutMs} ms`);
    throw error;
  }
  const cookie = res.headers.getSetCookie().find((line) => line.startsWith('refresh_token='));
  return { status: res.status, body: text ? JSON.parse(text) : null, refreshToken: cookie ? decodeURIComponent(cookie.split(';')[0].split('=')[1]) : null };
}

/** The response is out; the event, written apart and not awaited, may still be on its way. */
async function settled() {
  assert.equal(await waitForBackgroundWork(Date.now() + 5000), 0, 'event writes finished');
}

async function authRows(tenantId: string): Promise<any[]> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return manager.query(
      `SELECT table_name, action, record_id, user_id, source, source_ref, before_json, after_json
         FROM audit_log WHERE table_name = 'auth' ORDER BY created_at, id`,
    );
  });
}

async function seedTenant(tag: string): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `auth-events-${tag}-${tenantId.slice(0, 8)}`;
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Auth events probe', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [{ id: roleId }] = await manager.query(
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Probe member', null, false, false) RETURNING id`,
      [tenantId],
    );
    const user = async (name: string, status: string) => {
      const email = `${name}-${tenantId.slice(0, 8)}@example.com`;
      const [{ id }] = await manager.query(
        `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
         VALUES ($1, $2, 'Probe', $3, $4, $5, false, $6) RETURNING id`,
        [tenantId, name, email, hash, roleId, status],
      );
      return { id, email };
    };
    return { tenantId, slug, ada: await user('ada', 'enabled'), bob: await user('bob', 'disabled') };
  });
}

async function cleanup(seeds: Seed[]) {
  for (const seed of seeds) {
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [seed.tenantId]);
      for (const table of ['audit_log', 'refresh_tokens', 'password_reset_tokens', 'users', 'roles']) {
        await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [seed.tenantId]);
      }
    }).catch(() => undefined);
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [seed.tenantId]).catch(() => undefined);
  }
}

const DETAILS = { ip: CLIENT_ADDRESS, user_agent: USER_AGENT };
const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' };

function event(action: string, userId: string | null, reason: string | null) {
  return { table_name: 'auth', action, record_id: userId, user_id: userId, source: 'user', source_ref: reason, before_json: null, after_json: DETAILS };
}

async function main() {
  const unhandled: unknown[] = [];
  process.on('unhandledRejection', (reason) => unhandled.push(reason));
  process.env.RATE_LIMIT_ENABLED = 'false';
  process.env.APP_BASE_URL = 'https://kanap.example.test';
  process.env.JWT_SECRET ||= 'auth-events-spec-signing-key-0123456789';
  (Features as any).EMAIL_ENABLED = true;

  await dataSource.initialize();
  const a = await seedTenant('a');
  const b = await seedTenant('b');
  const app = await createApp();
  const secrets: string[] = [PASSWORD, NEXT_PASSWORD, '$argon2'];
  try {
    // A sign-in: 201 with the tokens, one `login` row with the address and the agent.
    const signedIn = await post(app, a, 'login', { email: a.ada.email, password: PASSWORD });
    assert.equal(signedIn.status, 201);
    assert.equal(typeof signedIn.body.access_token, 'string');
    assert.ok(signedIn.refreshToken, 'the refresh cookie is set');
    secrets.push(signedIn.body.access_token, signedIn.refreshToken!);
    await settled();
    assert.deepEqual(await authRows(a.tenantId), [event('login', a.ada.id, null)]);

    // Refused sign-ins: the same 401 as before, and a row written although the sign-in rolled back.
    const wrong = await post(app, a, 'login', { email: a.ada.email, password: 'Wrong-pass-0' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, INVALID_CREDENTIALS);
    const unknownEmail = `nobody-${a.tenantId.slice(0, 8)}@example.com`;
    const unknown = await post(app, a, 'login', { email: unknownEmail, password: PASSWORD });
    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown.body, INVALID_CREDENTIALS, 'an unknown account gets the same answer');
    const disabled = await post(app, a, 'login', { email: a.bob.email, password: PASSWORD });
    assert.equal(disabled.status, 401);
    assert.deepEqual(disabled.body, { code: 'USER_DISABLED', message: 'User disabled' });
    secrets.push('Wrong-pass-0', unknownEmail);
    await settled();
    assert.deepEqual((await authRows(a.tenantId)).slice(1), [
      event('login_failed', a.ada.id, 'bad_password'),
      event('login_failed', null, 'unknown_user'),
      event('login_failed', a.bob.id, 'disabled'),
    ]);

    // Session renewal: a valid one writes nothing, a refused one the same 401 and a row.
    assert.equal((await post(app, a, 'refresh', { refresh_token: signedIn.refreshToken })).status, 201);
    const refused = await post(app, a, 'refresh', { refresh_token: 'unknown-session-value' });
    assert.equal(refused.status, 401);
    assert.deepEqual(refused.body, { message: 'Invalid refresh token', error: 'Unauthorized', statusCode: 401 });
    secrets.push('unknown-session-value');
    // Sign-out: a row when it closes a session, none when there is no session left.
    assert.deepEqual((await post(app, a, 'logout', { refresh_token: signedIn.refreshToken })).body, { ok: true });
    assert.deepEqual((await post(app, a, 'logout', { refresh_token: signedIn.refreshToken })).body, { ok: true });
    await settled();
    assert.deepEqual((await authRows(a.tenantId)).slice(4), [
      event('refresh_denied', null, 'invalid_token'),
      event('logout', a.ada.id, null),
    ]);

    // Password reset: the request (known and unknown address) and the completion.
    assert.deepEqual((await post(app, a, 'password-reset/request', { email: a.ada.email })).body, { ok: true });
    assert.deepEqual((await post(app, a, 'password-reset/request', { email: unknownEmail })).body, { ok: true });
    assert.equal(sentResets.length, 1, 'one e-mail, for the known account');
    const token = new URL(sentResets[0].resetUrl).hash.replace('#token=', '');
    secrets.push(decodeURIComponent(token), sentResets[0].resetUrl);
    assert.deepEqual((await post(app, a, 'password-reset/complete', { token: decodeURIComponent(token), password: NEXT_PASSWORD })).body, { ok: true });
    await settled();
    assert.deepEqual((await authRows(a.tenantId)).slice(6), [
      event('password_reset_requested', a.ada.id, null),
      event('password_reset_requested', null, 'unknown_user'),
      event('password_reset_completed', a.ada.id, null),
    ]);

    // Another tenant: its own rows only. An address of tenant A tried on tenant B is not kept.
    assert.equal((await post(app, b, 'login', { email: b.ada.email, password: PASSWORD })).status, 201);
    assert.equal((await post(app, b, 'login', { email: a.ada.email, password: NEXT_PASSWORD })).status, 401);
    await settled();
    assert.deepEqual(await authRows(b.tenantId), [event('login', b.ada.id, null), event('login_failed', null, 'unknown_user')]);
    assert.equal((await authRows(a.tenantId)).length, 9, 'tenant A has no new row');

    // Nothing secret in any row: no password, token, hash, reset link, nor the unknown address.
    const stored = JSON.stringify([...(await authRows(a.tenantId)), ...(await authRows(b.tenantId))]);
    for (const value of secrets) assert.ok(!stored.includes(value), `a row holds ${value.slice(0, 12)}...`);
    for (const row of [...(await authRows(a.tenantId)), ...(await authRows(b.tenantId))]) {
      assert.deepEqual(Object.keys(row.after_json).sort(), ['ip', 'user_agent']);
    }

    // A write that fails changes no response, and rejects nothing.
    eventsMode = 'failing';
    const okWhileFailing = await post(app, a, 'login', { email: a.ada.email, password: NEXT_PASSWORD });
    assert.equal(okWhileFailing.status, 201);
    assert.equal(typeof okWhileFailing.body.access_token, 'string');
    const refusedWhileFailing = await post(app, a, 'login', { email: a.ada.email, password: PASSWORD });
    assert.equal(refusedWhileFailing.status, 401);
    assert.deepEqual(refusedWhileFailing.body, INVALID_CREDENTIALS);
    await settled();
    assert.equal((await authRows(a.tenantId)).length, 9, 'no row while the writes fail');

    // A write that never ends does not hold the response back (each answer within 3 s, or the spec fails).
    eventsMode = 'hanging';
    const started = Date.now();
    const refusedWhileHanging = await post(app, a, 'login', { email: a.ada.email, password: PASSWORD }, 3000);
    assert.equal(refusedWhileHanging.status, 401);
    assert.deepEqual(refusedWhileHanging.body, INVALID_CREDENTIALS);
    const okWhileHanging = await post(app, a, 'login', { email: a.ada.email, password: NEXT_PASSWORD }, 3000);
    assert.equal(okWhileHanging.status, 201);
    assert.ok(Date.now() - started < 3000, `answered in ${Date.now() - started} ms`);

    assert.deepEqual(unhandled, [], 'no unhandled rejection');
  } finally {
    await app.close();
    eventsMode = 'database';
    await cleanup([a, b]);
    await dataSource.destroy();
  }
  console.log('auth-events-http.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
