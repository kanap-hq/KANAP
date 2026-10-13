import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { waitForBackgroundWork } from '../../common/background-work';
import { RATE_LIMITS } from '../../common/rate-limit';
import { DatabaseHitCounter, DatabaseThrottlerStorage } from '../../common/rate-limit-store';
import { LoginAttemptLimit } from '../login-attempt-limit';
import { RateLimitGuard } from '../../common/rate-limit.guard';
import { applyHttpMiddleware, applyTenancyAndPipeline } from '../../http-app';

// The sign-in limits with several API processes (API_WORKERS > 1): the whole application
// (AppModule with the HTTP wiring of main.ts) served twice on one database, as two cluster
// workers, and the sign-in route counted over both:
// - per client address: 60 sign-ins from one address (each for another account), spread over
//   the two processes, then the 61st, on either process, is refused with 429; another address
//   still signs in (401 for a wrong password, not 429);
// - per account and address (auth/login-attempt-limit.ts): 5 refused sign-ins for one account
//   from one address, spread over the two processes, then the 6th is refused with 429 even with
//   the right password; the same account from another address and another account from the same
//   address sign in; a successful sign-in clears the count; an address no account has gets the
//   same answers and the same refusal;
// - the counts are in rate_limit_hits, the storage every rate-limited route shares
//   (app.module.ts), whatever module declares the route: the application holds one
//   ThrottlerModule. With a second one (a module importing its own), which storage a route gets
//   depends on the order Nest resolves imports in, and differs between Nest versions.

process.env.KANAP_WORKER_COUNT = '2';
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.RATE_LIMIT_TRUST_PROXY = '1';
process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'rate-limit-spec-signing-key';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'rate-limit-spec';

type Served = { app: INestApplication; port: number };

async function serve(workerId: number): Promise<Served> {
  process.env.KANAP_WORKER_ID = String(workerId);
  // Loaded after the environment above: the modules read it when they load.
  const { AppModule } = require('../../app.module');
  const app: INestApplication = await NestFactory.create(AppModule, { logger: ['error'], abortOnError: false });
  applyHttpMiddleware(app);
  applyTenancyAndPipeline(app, app.get(DataSource));
  await app.listen(0, '127.0.0.1');
  // No scheduled job runs during the spec.
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => job.stop());
  return { app, port: (app.getHttpServer().address() as AddressInfo).port };
}

const PASSWORD = 'Probe-pass-2026';
const WRONG_PASSWORD = 'Not-the-password-1';

type Answer = { status: number; body: string; retryAfter: string | null };

/** One request on its own connection, so each lands on the process it names. */
async function signIn(served: Served, host: string, address: string, email: string, password = WRONG_PASSWORD) {
  return (await signInAnswer(served, host, address, email, password)).status;
}

function signInAnswer(served: Served, host: string, address: string, email: string, password = WRONG_PASSWORD) {
  const payload = Buffer.from(JSON.stringify({ email, password }));
  return new Promise<Answer>((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: served.port,
      method: 'POST',
      path: '/auth/login',
      agent: false,
      headers: {
        Host: host,
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
        'X-Forwarded-For': address,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        retryAfter: typeof res.headers['retry-after'] === 'string' ? res.headers['retry-after'] : null,
      }));
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('POST /auth/login: no answer within 10 s')));
    req.end(payload);
  });
}

function testOneStorageForTheApplication(served: Served) {
  const modules = [...(served.app as any).container.getModules().values()];
  const throttlers = modules.filter((moduleRef: any) => moduleRef.metatype === ThrottlerModule);
  assert.equal(throttlers.length, 1, 'one ThrottlerModule (app.module.ts), no module declares its own');
  const { AuthModule } = require('../../auth/auth.module');
  const guard: any = served.app.select(AuthModule).get(RateLimitGuard);
  assert.ok(guard.storageService instanceof DatabaseThrottlerStorage, 'the sign-in routes count in the database');
  const attempts: any = served.app.select(AuthModule).get(LoginAttemptLimit);
  assert.ok(attempts.counter instanceof DatabaseHitCounter, 'the attempts per account count in the database');
}

/** The answer of the address limit, to compare the account limit's with. */
let addressLimitAnswer: Answer | null = null;

async function testSignInLimitHoldsOverTwoProcesses(a: Served, b: Served, slug: string) {
  assert.equal(RATE_LIMITS.authLogin.limit, 60, 'the sign-in limit per address this spec counts on');
  const host = `${slug}.lvh.me`;
  const first = '198.51.100.21';
  // Each attempt for another account: the limit per account does not come into play.
  const email = () => `nobody-${randomUUID().slice(0, 8)}@example.com`;
  // One after the other: requests at once would wait for pool connections past the count's wait.
  const statuses: number[] = [];
  for (let i = 0; i < 60; i += 1) statuses.push(await signIn(i % 2 ? b : a, host, first, email()));
  assert.deepEqual([...new Set(statuses)], [401], 'sixty refused sign-ins, over both processes');
  addressLimitAnswer = await signInAnswer(b, host, first, email());
  assert.equal(addressLimitAnswer.status, 429, 'the 61st, on either process, is over the limit');
  assert.equal(await signIn(a, host, first, email()), 429, 'and on the first process too');
  assert.equal(await signIn(a, host, '198.51.100.22', email()), 401, 'another address still signs in');
  assert.equal(await signIn(b, host, '198.51.100.22', email()), 401);
}

async function testAccountLimitHoldsOverTwoProcesses(a: Served, b: Served, seed: Seed) {
  assert.deepEqual(RATE_LIMITS.authLoginFailures, { limit: 5, ttl: 15 * 60_000 }, 'the limit per account this spec counts on');
  const host = `${seed.slug}.lvh.me`;
  const refusedFiveTimes = async (email: string, address: string) => {
    const answers: Answer[] = [];
    for (const served of [a, b, a, b, a]) answers.push(await signInAnswer(served, host, address, email));
    assert.deepEqual(answers.map((x) => x.status), [401, 401, 401, 401, 401], `five refused sign-ins for ${email.split('-')[0]}, over both processes`);
    return answers[0];
  };

  // Five refusals for one account from one address, then the right password is refused too.
  const refused = await refusedFiveTimes(seed.ada, '198.51.100.31');
  const blocked = await signInAnswer(b, host, '198.51.100.31', seed.ada, PASSWORD);
  assert.equal(blocked.status, 429, 'the 6th, with the right password, on the other process');
  assert.equal(blocked.body, addressLimitAnswer?.body, 'the body of the address limit');
  assert.ok(Number(blocked.retryAfter) > 880 && Number(blocked.retryAfter) <= 900, `Retry-After ${blocked.retryAfter}`);
  assert.equal(await signIn(a, host, '198.51.100.31', seed.ada, PASSWORD), 429, 'and on the first process');
  assert.equal(await signIn(a, host, '198.51.100.32', seed.ada, PASSWORD), 201, 'the same account from another address signs in');
  assert.equal(await signIn(b, host, '198.51.100.31', seed.bob, PASSWORD), 201, 'another account from the same address signs in');
  assert.equal(await signIn(a, host, '198.51.100.31', seed.ada.toUpperCase(), PASSWORD), 429, 'the address typed counts in lower case');

  // An address no account has: the same answers, the same refusal.
  const unknown = `nobody-${randomUUID().slice(0, 8)}@example.com`;
  const unknownRefused = await refusedFiveTimes(unknown, '198.51.100.33');
  assert.equal(unknownRefused.body, refused.body, 'the same 401');
  const unknownBlocked = await signInAnswer(a, host, '198.51.100.33', unknown, PASSWORD);
  assert.equal(unknownBlocked.status, 429);
  assert.equal(unknownBlocked.body, blocked.body, 'the same 429');
  assert.ok(Math.abs(Number(unknownBlocked.retryAfter) - Number(blocked.retryAfter)) <= 5, 'the same wait');

  // A successful sign-in clears the count of its pair, on both processes.
  for (const served of [a, b, a, b]) assert.equal(await signIn(served, host, '198.51.100.34', seed.bob), 401);
  assert.equal(await signIn(b, host, '198.51.100.34', seed.bob, PASSWORD), 201);
  await refusedFiveTimes(seed.bob, '198.51.100.34');
  assert.equal(await signIn(b, host, '198.51.100.34', seed.bob, PASSWORD), 429, 'five new refusals after the success');
}

type Seed = { tenantId: string; slug: string; ada: string; bob: string };

/** A tenant with two accounts that may sign in with PASSWORD. */
async function seedTenant(): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `rate-limit-${tenantId.slice(0, 8)}`;
  // A recent rate refresh: a sign-in starts no exchange rate download during the spec.
  const metadata = JSON.stringify({ fx_last_login_refresh_at: new Date().toISOString() });
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Rate limit probe', 'active', $3::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, metadata],
  );
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [{ id: roleId }] = await manager.query(
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Probe member', null, false, false) RETURNING id`,
      [tenantId],
    );
    const user = async (name: string) => {
      const email = `${name}-${tenantId.slice(0, 8)}@example.com`;
      await manager.query(
        `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
         VALUES ($1, $2, 'Probe', $3, $4, $5, false, 'enabled')`,
        [tenantId, name, email, hash, roleId],
      );
      return email;
    };
    return { tenantId, slug, ada: await user('ada'), bob: await user('bob') };
  });
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const keysBefore = new Set<string>((await dataSource.query(`SELECT key FROM rate_limit_hits`)).map((r: any) => r.key));
  const seed = await seedTenant();
  const { tenantId, slug } = seed;
  const served: Served[] = [];
  const failures: string[] = [];
  try {
    served.push(await serve(1));
    served.push(await serve(2));
    for (const [label, test] of [
      ['testOneStorageForTheApplication', async () => testOneStorageForTheApplication(served[0])],
      ['testSignInLimitHoldsOverTwoProcesses', () => testSignInLimitHoldsOverTwoProcesses(served[0], served[1], slug)],
      ['testAccountLimitHoldsOverTwoProcesses', () => testAccountLimitHoldsOverTwoProcesses(served[0], served[1], seed)],
      ['testCountsAreInTheDatabase', async () => {
        const counted = (await dataSource.query(`SELECT key FROM rate_limit_hits`)).filter((r: any) => !keysBefore.has(r.key));
        assert.ok(counted.length >= 2, `the counts are in rate_limit_hits (${counted.length} new keys, one per address)`);
      }],
    ] as const) {
      try {
        await test();
        console.log(`ok - ${label}`);
      } catch (err) {
        failures.push(`${label}: ${(err as Error)?.message ?? err}`);
      }
    }
  } catch (err) {
    failures.push(`start: ${(err as Error)?.message ?? err}`);
  } finally {
    await waitForBackgroundWork(Date.now() + 5_000);
    for (const s of served) await s.app.close();
    const added = (await dataSource.query(`SELECT key FROM rate_limit_hits`)).map((r: any) => r.key).filter((key: string) => !keysBefore.has(key));
    if (added.length) await dataSource.query(`DELETE FROM rate_limit_hits WHERE key = ANY($1)`, [added]);
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      for (const table of ['audit_log', 'refresh_tokens', 'users', 'roles']) {
        await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
    }).catch(() => undefined);
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => undefined);
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`auth-rate-limit-processes.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('auth-rate-limit-processes.integration.spec: ok');
  process.exit(0);
}

void main();
