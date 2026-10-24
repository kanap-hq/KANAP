import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { SecurityEventsService } from '../../audit/security-events.service';
import { BillingService } from '../../billing/billing.service';
import { applyTrustProxy, resolveTrustProxy } from '../../common/client-address';
import { RATE_LIMITS } from '../../common/rate-limit';
import { DatabaseThrottlerStorage } from '../../common/rate-limit-store';
import { FxIngestionService } from '../../currency/fx-ingestion.service';
import { EmailService } from '../../email/email.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { TenantsService } from '../../tenants/tenants.service';
import { UsersService } from '../../users/users.service';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { LoginAttemptLimit } from '../login-attempt-limit';
import { refreshSessionKey } from '../refresh-session-limit';

// The limits of session renewal (`POST /auth/refresh`), over HTTP, counted in rate_limit_hits as
// with several API processes (API_WORKERS > 1), one trusted proxy:
// - per client address and tenant: 120 renewals from one address, each with its own refresh
//   token, pass; the 121st within the minute is refused with 429 and Retry-After; the same
//   address in another tenant, and another address, still renew;
// - per refresh token (auth/refresh-session-limit.ts): the 11th renewal of one token within the
//   minute is refused with 429 and Retry-After, under the address limit; another token from the
//   same address renews; the same token from another address, or sent in the body, stays refused;
// - a request without a token gets the 400 of the route and counts against the address limit
//   only, which still stops it at 121;
// - the stored keys are SHA-256 hashes: no refresh token appears in clear in rate_limit_hits.

process.env.KANAP_WORKER_COUNT = '2';
process.env.KANAP_WORKER_ID = '1';
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.JWT_SECRET ||= 'refresh-rate-limit-spec-signing-key';

const RENEWED = { access_token: 'access-token', expires_in: 900, refresh_expires_in: 14_400 };

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 10 }], storage: new DatabaseThrottlerStorage(dataSource) }),
  ],
  controllers: [AuthController],
  providers: [
    { provide: DataSource, useValue: dataSource },
    { provide: AuthService, useValue: { refreshAccessToken: async () => RENEWED } },
    { provide: UsersService, useValue: {} },
    { provide: PermissionsService, useValue: {} },
    { provide: BillingService, useValue: {} },
    { provide: EmailService, useValue: {} },
    { provide: FxIngestionService, useValue: {} },
    { provide: TenantsService, useValue: {} },
    { provide: SecurityEventsService, useValue: { recordAuthEvent: async () => undefined } },
    { provide: LoginAttemptLimit, useValue: {} },
  ],
})
class RefreshRateLimitProbeModule {}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(RefreshRateLimitProbeModule, { logger: false, abortOnError: false });
  applyTrustProxy(app.getHttpAdapter().getInstance(), resolveTrustProxy('1', false));
  // The tenant middleware's job, from a header.
  app.use((req: any, _res: any, next: () => void) => {
    const tenantId = req.headers['x-probe-tenant'];
    if (tenantId) req.tenant = { id: tenantId, slug: 'refresh-probe', name: 'Refresh probe' };
    next();
  });
  await app.listen(0, '127.0.0.1');
  return app;
}

type Answer = { status: number; retryAfter: string | null };

/** Every token sent and every key the requests may have written, for the checks and the clean-up. */
const tokensSent = new Set<string>();
const keysTouched = new Set<string>();

async function refresh(
  app: INestApplication,
  tenantId: string,
  address: string,
  token: { cookie?: string; body?: string } = {},
): Promise<Answer> {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': address,
    'x-probe-tenant': tenantId,
  };
  keysTouched.add(addressKey(address, tenantId));
  for (const sent of [token.cookie, token.body]) {
    if (!sent) continue;
    tokensSent.add(sent);
    keysTouched.add(refreshSessionKey(tenantId, sent));
  }
  if (token.cookie) headers.cookie = `refresh_token=${encodeURIComponent(token.cookie)}`;
  const res = await fetch(`http://127.0.0.1:${port}/auth/refresh`, {
    method: 'POST',
    headers,
    body: JSON.stringify(token.body ? { refresh_token: token.body } : {}),
    signal: AbortSignal.timeout(5000),
  });
  await res.text();
  return { status: res.status, retryAfter: res.headers.get('retry-after') };
}

const newToken = () => `rt-${randomUUID()}-${randomUUID()}`;

/** The key of the address limit (ThrottlerGuard.generateKey with the tracker of TenantRateLimitGuard). */
const addressKey = (address: string, tenantId: string) =>
  createHash('sha256').update(`AuthController-refreshToken-default-${address}:${tenantId}`).digest('hex');

function assertRetryAfter(answer: Answer, label: string) {
  assert.equal(answer.status, 429, label);
  const seconds = Number(answer.retryAfter);
  assert.ok(seconds >= 1 && seconds <= 60, `${label}: Retry-After ${answer.retryAfter}`);
}

async function main() {
  assert.deepEqual(RATE_LIMITS.authRefresh, { limit: 120, ttl: 60_000 }, '120 renewals a minute per client address');
  assert.deepEqual(RATE_LIMITS.authRefreshSession, { limit: 10, ttl: 60_000 }, '10 renewals a minute per refresh token');

  await dataSource.initialize();
  const app = await createApp();
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  const octet = () => 1 + Math.floor(Math.random() * 250);
  const crowd = `198.51.100.${octet()}`;
  const looper = `203.0.113.${octet()}`;
  const tokenless = `192.0.2.${octet()}`;
  const elsewhere = `2001:db8::1:${randomUUID().slice(0, 4)}`;
  const looperElsewhere = `2001:db8::2:${randomUUID().slice(0, 4)}`;
  try {
    // Per client address and tenant: 120 renewals, each with its own token, then 429.
    for (let i = 1; i <= RATE_LIMITS.authRefresh.limit; i += 1) {
      assert.equal((await refresh(app, tenant, crowd, { cookie: newToken() })).status, 201, `renewal ${i} from one address`);
    }
    assertRetryAfter(await refresh(app, tenant, crowd, { cookie: newToken() }), 'the 121st renewal from one address');
    assert.equal((await refresh(app, otherTenant, crowd, { cookie: newToken() })).status, 201, 'the same address in another tenant renews');
    assert.equal((await refresh(app, tenant, elsewhere, { cookie: newToken() })).status, 201, 'another address renews');

    // Per refresh token: 10 renewals, then 429 under the address limit.
    const loop = newToken();
    for (let i = 1; i <= RATE_LIMITS.authRefreshSession.limit; i += 1) {
      assert.equal((await refresh(app, tenant, looper, { cookie: loop })).status, 201, `renewal ${i} of one token`);
    }
    assertRetryAfter(await refresh(app, tenant, looper, { cookie: loop }), 'the 11th renewal of one token');
    assert.equal((await refresh(app, tenant, looper, { cookie: newToken() })).status, 201, 'another token from the same address renews');
    assertRetryAfter(await refresh(app, tenant, looperElsewhere, { cookie: loop }), 'the same token from another address');
    assertRetryAfter(await refresh(app, tenant, looper, { body: loop }), 'the same token sent in the body');

    // Without a token: the 400 of the route, under the address limit only.
    for (let i = 1; i <= RATE_LIMITS.authRefresh.limit; i += 1) {
      assert.equal((await refresh(app, tenant, tokenless)).status, 400, `renewal ${i} without a token`);
    }
    assertRetryAfter(await refresh(app, tenant, tokenless), 'the 121st renewal without a token');

    // The stored keys: hashes, no token in clear.
    const [loopRow] = await dataSource.query(`SELECT key, hits FROM rate_limit_hits WHERE key = $1`, [refreshSessionKey(tenant, loop)]);
    assert.ok(loopRow, 'the count of the looping token is in rate_limit_hits');
    assert.match(loopRow.key, /^[0-9a-f]{64}$/, 'its key is a SHA-256 hash');
    assert.equal(Number(loopRow.hits), RATE_LIMITS.authRefreshSession.limit + 1, 'the 11th renewal counted, the ones refused while blocked did not');
    const [{ count: crowdRows }] = await dataSource.query(`SELECT count(*)::int AS count FROM rate_limit_hits WHERE key = ANY($1)`, [[...keysTouched]]);
    // Every key sent has its row, but the token of the 121st renewal from one address: refused
    // by the address limit, before its token was counted.
    assert.equal(crowdRows, keysTouched.size - 1, 'one row per token and per address, each under its hash');
    const [{ count: inClear }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM rate_limit_hits WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) t WHERE strpos(key, t) > 0)`,
      [[...tokensSent]],
    );
    assert.equal(inClear, 0, 'no refresh token in clear in rate_limit_hits');
    console.log('refresh-rate-limit.integration.spec: ok');
  } finally {
    await app.close();
    await dataSource.query(`DELETE FROM rate_limit_hits WHERE key = ANY($1)`, [[...keysTouched]]).catch(() => undefined);
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
