import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { waitForBackgroundWork } from '../../common/background-work';
import { RATE_LIMITS } from '../../common/rate-limit';
import { DatabaseThrottlerStorage } from '../../common/rate-limit-store';
import { RateLimitGuard } from '../../common/rate-limit.guard';
import { applyHttpMiddleware, applyTenancyAndPipeline } from '../../http-app';

// The sign-in limit with several API processes (API_WORKERS > 1): the whole application
// (AppModule with the HTTP wiring of main.ts) served twice on one database, as two cluster
// workers, and the sign-in route counted per client address over both:
// - 5 refused sign-ins from one address, spread over the two processes, then the 6th, on either
//   process, is refused with 429;
// - another address still signs in (401 for a wrong password, not 429);
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

/** One request on its own connection, so each lands on the process it names. */
function signIn(served: Served, host: string, address: string, email: string) {
  const payload = Buffer.from(JSON.stringify({ email, password: 'Not-the-password-1' }));
  return new Promise<number>((resolve, reject) => {
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
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
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
}

async function testSignInLimitHoldsOverTwoProcesses(a: Served, b: Served, slug: string) {
  assert.equal(RATE_LIMITS.authLogin.limit, 5, 'the sign-in limit this spec counts on');
  const host = `${slug}.lvh.me`;
  const email = `nobody-${randomUUID().slice(0, 8)}@example.com`;
  const first = '198.51.100.21';
  const statuses: number[] = [];
  for (const served of [a, b, a, b, a]) statuses.push(await signIn(served, host, first, email));
  assert.deepEqual(statuses, [401, 401, 401, 401, 401], 'five refused sign-ins, over both processes');
  assert.equal(await signIn(b, host, first, email), 429, 'the 6th, on the other process, is over the limit');
  assert.equal(await signIn(a, host, first, email), 429, 'and on the first process too');
  assert.equal(await signIn(a, host, '198.51.100.22', email), 401, 'another address still signs in');
  assert.equal(await signIn(b, host, '198.51.100.22', email), 401);
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const tenantId = randomUUID();
  const slug = `rate-limit-${tenantId.slice(0, 8)}`;
  const keysBefore = new Set<string>((await dataSource.query(`SELECT key FROM rate_limit_hits`)).map((r: any) => r.key));
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Rate limit probe', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  const served: Served[] = [];
  const failures: string[] = [];
  try {
    served.push(await serve(1));
    served.push(await serve(2));
    for (const [label, test] of [
      ['testOneStorageForTheApplication', async () => testOneStorageForTheApplication(served[0])],
      ['testSignInLimitHoldsOverTwoProcesses', () => testSignInLimitHoldsOverTwoProcesses(served[0], served[1], slug)],
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
      await manager.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
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
