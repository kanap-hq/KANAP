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

// The limits of session renewal (`POST /auth/refresh`), over HTTP, with one trusted proxy. First
// counted in rate_limit_hits, as with several API processes (API_WORKERS > 1):
// - per client address and tenant: 120 renewals from one address, each with its own refresh
//   token, pass; the 121st within the minute is refused with 429 and Retry-After; the same
//   address in another tenant, and another address, still renew;
// - per refresh token (auth/refresh-session-limit.ts), checked first: the 31st renewal of one
//   token within the minute is refused with 429 and Retry-After; after 125 renewals of one token
//   from one address, a neighbour with another token, same address and tenant, still renews (the
//   refused renewals did not count against the address); the same token from another address, or
//   sent in the body, stays refused; a cookie and a body with different tokens count under the
//   cookie's token; a refused origin counts nothing for the token;
// - a request without a token gets the 400 of the route and counts against the address limit
//   only, which still stops it at 121;
// - the stored keys are SHA-256 hashes: no refresh token appears in clear in rate_limit_hits.
// Then the same token cases on the memory path of one process (no KANAP_WORKER_COUNT), which
// writes nothing to rate_limit_hits.

process.env.KANAP_WORKER_COUNT = '2';
process.env.KANAP_WORKER_ID = '1';
process.env.RATE_LIMIT_ENABLED = 'true';
// One listed origin, so that any other origin is refused whatever the mode of the machine.
process.env.CORS_ORIGINS = 'https://app.refresh-probe.example.invalid';
process.env.JWT_SECRET ||= 'refresh-rate-limit-spec-signing-key';

const RENEWED = { access_token: 'access-token', expires_in: 900, refresh_expires_in: 14_400 };

/** The probe module; without a storage, the address limit counts in memory. */
function probeModule(storage?: DatabaseThrottlerStorage) {
  @Module({
    imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 10 }], ...(storage ? { storage } : {}) })],
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
  return RefreshRateLimitProbeModule;
}

async function createApp(storage?: DatabaseThrottlerStorage): Promise<INestApplication> {
  const app = await NestFactory.create(probeModule(storage), { logger: false, abortOnError: false });
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

/**
 * Every token sent, the keys the requests may have counted (the address, and the token the route
 * renews: the cookie, else the body) and every key they could touch, for the checks and the
 * clean-up.
 */
const tokensSent = new Set<string>();
const keysCounted = new Set<string>();
const keysToClean = new Set<string>();

async function refresh(
  app: INestApplication,
  tenantId: string,
  address: string,
  sent: { cookie?: string; body?: string; origin?: string } = {},
): Promise<Answer> {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': address,
    'x-probe-tenant': tenantId,
  };
  if (sent.origin) headers.origin = sent.origin;
  const counted = [addressKey(address, tenantId)];
  const renewed = sent.cookie ?? sent.body;
  if (renewed) counted.push(refreshSessionKey(tenantId, renewed));
  for (const key of counted) keysCounted.add(key);
  for (const key of counted) keysToClean.add(key);
  for (const token of [sent.cookie, sent.body]) {
    if (!token) continue;
    tokensSent.add(token);
    keysToClean.add(refreshSessionKey(tenantId, token));
  }
  if (sent.cookie) headers.cookie = `refresh_token=${encodeURIComponent(sent.cookie)}`;
  const res = await fetch(`http://127.0.0.1:${port}/auth/refresh`, {
    method: 'POST',
    headers,
    body: JSON.stringify(sent.body ? { refresh_token: sent.body } : {}),
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

const LOOPED = 125;
const octet = () => 1 + Math.floor(Math.random() * 250);

/**
 * The cases of the limit per refresh token, on either path. Returns the looping token and a token
 * sent only in the body next to another cookie, for the checks of the stored rows.
 */
async function tokenLimitCases(app: INestApplication, tenant: string, path: string) {
  const per = RATE_LIMITS.authRefreshSession.limit;
  const looper = `203.0.113.${octet()}`;
  const looperElsewhere = `2001:db8::2:${randomUUID().slice(0, 4)}`;
  const pairs = `198.18.0.${octet()}`;
  const guarded = `198.18.1.${octet()}`;

  // 30 renewals of one token, then 429 for the rest of its 125 renewals.
  const loop = newToken();
  for (let i = 1; i <= LOOPED; i += 1) {
    const answer = await refresh(app, tenant, looper, { cookie: loop });
    if (i <= per) assert.equal(answer.status, 201, `${path}: renewal ${i} of one token`);
    else assertRetryAfter(answer, `${path}: renewal ${i} of one token`);
  }
  assert.equal((await refresh(app, tenant, looper, { cookie: newToken() })).status, 201, `${path}: a neighbour with another token, same address and tenant, renews`);
  assertRetryAfter(await refresh(app, tenant, looperElsewhere, { cookie: loop }), `${path}: the same token from another address`);
  assertRetryAfter(await refresh(app, tenant, looper, { body: loop }), `${path}: the same token sent in the body`);

  // A cookie and a body with different tokens count under the cookie's token.
  const cookie = newToken();
  for (let i = 1; i <= per; i += 1) {
    assert.equal((await refresh(app, tenant, pairs, { cookie, body: newToken() })).status, 201, `${path}: renewal ${i} of a cookie with a new body token`);
  }
  const bodyOnly = newToken();
  assertRetryAfter(await refresh(app, tenant, pairs, { cookie, body: bodyOnly }), `${path}: the 31st renewal of the cookie, whatever the body`);
  assert.equal((await refresh(app, tenant, pairs, { cookie: newToken(), body: loop })).status, 201, `${path}: a blocked token in the body next to another cookie`);

  // A refused origin counts nothing for the token.
  const origin = 'https://refused-origin.example.invalid';
  const kept = newToken();
  for (let i = 1; i <= per + 1; i += 1) {
    assert.equal((await refresh(app, tenant, guarded, { cookie: kept, origin })).status, 403, `${path}: renewal ${i} from a refused origin`);
  }
  assert.equal((await refresh(app, tenant, guarded, { cookie: kept })).status, 201, `${path}: the token renews after the refused origins`);

  return { loop, bodyOnly };
}

async function main() {
  assert.deepEqual(RATE_LIMITS.authRefresh, { limit: 120, ttl: 60_000 }, '120 renewals a minute per client address');
  assert.deepEqual(RATE_LIMITS.authRefreshSession, { limit: 30, ttl: 60_000 }, '30 renewals a minute per refresh token');

  await dataSource.initialize();
  try {
    const tenant = randomUUID();
    const otherTenant = randomUUID();
    const crowd = `198.51.100.${octet()}`;
    const tokenless = `192.0.2.${octet()}`;
    const elsewhere = `2001:db8::1:${randomUUID().slice(0, 4)}`;

    // Counted in rate_limit_hits, as with several API processes.
    const app = await createApp(new DatabaseThrottlerStorage(dataSource));
    try {
      // Per client address and tenant: 120 renewals, each with its own token, then 429.
      for (let i = 1; i <= RATE_LIMITS.authRefresh.limit; i += 1) {
        assert.equal((await refresh(app, tenant, crowd, { cookie: newToken() })).status, 201, `renewal ${i} from one address`);
      }
      assertRetryAfter(await refresh(app, tenant, crowd, { cookie: newToken() }), 'the 121st renewal from one address');
      assert.equal((await refresh(app, otherTenant, crowd, { cookie: newToken() })).status, 201, 'the same address in another tenant renews');
      assert.equal((await refresh(app, tenant, elsewhere, { cookie: newToken() })).status, 201, 'another address renews');

      const { loop, bodyOnly } = await tokenLimitCases(app, tenant, 'database');

      // Without a token: the 400 of the route, under the address limit only.
      for (let i = 1; i <= RATE_LIMITS.authRefresh.limit; i += 1) {
        assert.equal((await refresh(app, tenant, tokenless)).status, 400, `renewal ${i} without a token`);
      }
      assertRetryAfter(await refresh(app, tenant, tokenless), 'the 121st renewal without a token');

      // The stored keys: hashes, no token in clear.
      const [loopRow] = await dataSource.query(`SELECT key, hits FROM rate_limit_hits WHERE key = $1`, [refreshSessionKey(tenant, loop)]);
      assert.ok(loopRow, 'the count of the looping token is in rate_limit_hits');
      assert.match(loopRow.key, /^[0-9a-f]{64}$/, 'its key is a SHA-256 hash');
      assert.equal(Number(loopRow.hits), RATE_LIMITS.authRefreshSession.limit + 1, 'the 31st renewal counted, the ones refused while blocked did not');
      const [{ count: bodyRows }] = await dataSource.query(`SELECT count(*)::int AS count FROM rate_limit_hits WHERE key = $1`, [refreshSessionKey(tenant, bodyOnly)]);
      assert.equal(bodyRows, 0, 'a body token sent next to a cookie is not counted');
      // Every address and every renewed token has its row, but one: the other address that only
      // sent the blocked looping token, refused by the token limit before its address was counted.
      const [{ count: rows }] = await dataSource.query(`SELECT count(*)::int AS count FROM rate_limit_hits WHERE key = ANY($1)`, [[...keysCounted]]);
      assert.equal(rows, keysCounted.size - 1, 'one row per token and per address, each under its hash');
      const [{ count: inClear }] = await dataSource.query(
        `SELECT count(*)::int AS count FROM rate_limit_hits WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) t WHERE strpos(key, t) > 0)`,
        [[...tokensSent]],
      );
      assert.equal(inClear, 0, 'no refresh token in clear in rate_limit_hits');
    } finally {
      await app.close();
    }

    // The memory path of one process.
    delete process.env.KANAP_WORKER_COUNT;
    delete process.env.KANAP_WORKER_ID;
    const memoryTenant = randomUUID();
    const before = new Set(keysToClean);
    const memoryApp = await createApp();
    try {
      await tokenLimitCases(memoryApp, memoryTenant, 'memory');
    } finally {
      await memoryApp.close();
    }
    const memoryKeys = [...keysToClean].filter((key) => !before.has(key));
    const [{ count: memoryRows }] = await dataSource.query(`SELECT count(*)::int AS count FROM rate_limit_hits WHERE key = ANY($1)`, [memoryKeys]);
    assert.equal(memoryRows, 0, 'the memory path writes nothing to rate_limit_hits');
    console.log('refresh-rate-limit.integration.spec: ok');
  } finally {
    try {
      await dataSource.query(`DELETE FROM rate_limit_hits WHERE key = ANY($1)`, [[...keysToClean]]);
    } finally {
      await dataSource.destroy();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
