import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication, Module, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OpsMetricsStore } from '../../admin/ops/ops-metrics.store';

// applyHttpMiddleware (http-app.ts), the HTTP set-up of the served API, applies the trusted proxy
// count of RATE_LIMIT_TRUST_PROXY to the Express application, and prints the [RATE-LIMIT]
// start-up line in the lead process only (the single process, or worker 1).

// The deployment mode is read when config/features.ts loads: set it before http-app.ts loads.
process.env.DEPLOYMENT_MODE = 'single-tenant';
const PROCESS_VARIABLES = ['RATE_LIMIT_TRUST_PROXY', 'KANAP_WORKER_ID', 'KANAP_WORKER_COUNT', 'CORS_ORIGINS'] as const;
for (const key of PROCESS_VARIABLES) delete process.env[key];
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyHttpMiddleware } = require('../../http-app') as typeof import('../../http-app');

@Controller('probe')
class WiringProbeController {
  @Get('address')
  address(@Req() req: any) {
    return { ip: req.ip };
  }
}

@Module({ controllers: [WiringProbeController], providers: [OpsMetricsStore] })
class WiringProbeModule {}

type Outcome = { trustProxy: unknown; ip: string; rateLimitLines: string[] };

async function serve(env: Partial<Record<(typeof PROCESS_VARIABLES)[number], string>>): Promise<Outcome> {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn };
  const capture = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (text.startsWith('[RATE-LIMIT]')) lines.push(text);
  };
  for (const key of PROCESS_VARIABLES) delete process.env[key];
  Object.assign(process.env, env);
  const app: INestApplication = await NestFactory.create(WiringProbeModule, { logger: false });
  try {
    console.log = capture;
    console.warn = capture;
    try {
      applyHttpMiddleware(app);
    } finally {
      console.log = original.log;
      console.warn = original.warn;
    }
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/probe/address`, {
      headers: { 'x-forwarded-for': '192.0.2.1, 198.51.100.7, 203.0.113.9' },
    });
    assert.equal(res.status, 200);
    const { ip } = (await res.json()) as { ip: string };
    return { trustProxy: app.getHttpAdapter().getInstance().get('trust proxy'), ip, rateLimitLines: lines };
  } finally {
    await app.close();
    for (const key of PROCESS_VARIABLES) delete process.env[key];
  }
}

async function testDefaultSingleTenant() {
  // Unset in single-tenant mode: one trusted proxy, the rightmost entry is the client.
  const outcome = await serve({});
  assert.equal(outcome.trustProxy, 1, 'one trusted proxy by default in single-tenant mode');
  assert.equal(outcome.ip, '203.0.113.9');
  assert.equal(outcome.rateLimitLines.length, 1, 'the single process prints the start-up line');
  assert.match(outcome.rateLimitLines[0], /behind 1 trusted proxy .*not set, single-tenant default/);
}

async function testConfiguredCount() {
  const two = await serve({ RATE_LIMIT_TRUST_PROXY: '2' });
  assert.equal(two.trustProxy, 2);
  assert.equal(two.ip, '198.51.100.7');

  const none = await serve({ RATE_LIMIT_TRUST_PROXY: 'false' });
  assert.equal(none.trustProxy, false);
  assert.ok(none.ip === '127.0.0.1' || none.ip === '::ffff:127.0.0.1', `the connection address, got ${none.ip}`);
}

async function testLeadProcessOnly() {
  const lead = await serve({ KANAP_WORKER_ID: '1', KANAP_WORKER_COUNT: '2' });
  assert.equal(lead.rateLimitLines.length, 1, 'worker 1 prints the start-up line');

  const other = await serve({ KANAP_WORKER_ID: '2', KANAP_WORKER_COUNT: '2' });
  assert.deepEqual(other.rateLimitLines, [], 'worker 2 prints no start-up line');
  assert.equal(other.trustProxy, 1, 'every worker applies the setting');
  assert.equal(other.ip, '203.0.113.9');
}

async function run() {
  await testDefaultSingleTenant();
  await testConfiguredCount();
  await testLeadProcessOnly();
  console.log('client-address-wiring.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
