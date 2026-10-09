import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication, Module, Post, Req, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import { applyTrustProxy, clientAddress, resolveTrustProxy } from '../client-address';
import { RATE_LIMITS } from '../rate-limit';
import { RateLimitGuard } from '../rate-limit.guard';

// Over HTTP: the client address follows the number of trusted proxies (the entry the outermost
// trusted proxy appended to X-Forwarded-For, or the connection without a proxy), and the login
// limit counts per client address, so two clients behind the same proxy keep separate counts.

@Controller('probe')
class ClientAddressProbeController {
  @Get('address')
  address(@Req() req: any) {
    return { address: clientAddress(req) };
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.authLogin })
  login() {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 10 }] })],
  controllers: [ClientAddressProbeController],
})
class ClientAddressProbeModule {}

async function createApp(trustProxy: string): Promise<INestApplication> {
  const app = await NestFactory.create(ClientAddressProbeModule, { logger: false });
  applyTrustProxy(app.getHttpAdapter().getInstance(), resolveTrustProxy(trustProxy, false));
  await app.listen(0, '127.0.0.1');
  return app;
}

function baseUrl(app: INestApplication): string {
  const { port } = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function addressFor(app: INestApplication, headers: Record<string, string>): Promise<string | null> {
  const res = await fetch(`${baseUrl(app)}/probe/address`, { headers });
  assert.equal(res.status, 200);
  return ((await res.json()) as any).address;
}

async function login(app: INestApplication, forwardedFor?: string): Promise<number> {
  const headers: Record<string, string> = forwardedFor ? { 'x-forwarded-for': forwardedFor } : {};
  const res = await fetch(`${baseUrl(app)}/probe/login`, { method: 'POST', headers });
  await res.arrayBuffer();
  return res.status;
}

const isLoopback = (address: string | null) => address === '127.0.0.1' || address === '::ffff:127.0.0.1';

async function withApp(trustProxy: string, fn: (app: INestApplication) => Promise<void>) {
  const app = await createApp(trustProxy);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function testAddressByHops() {
  const twoEntries = { 'x-forwarded-for': '198.51.100.7, 203.0.113.9' };
  const threeEntries = { 'x-forwarded-for': '192.0.2.1, 198.51.100.7, 203.0.113.9' };
  const otherHeaders = { 'cf-connecting-ip': '192.0.2.50', 'x-real-ip': '192.0.2.70' };

  // No trusted proxy: the connection, whatever the headers say.
  await withApp('false', async (app) => {
    assert.ok(isLoopback(await addressFor(app, {})));
    assert.ok(isLoopback(await addressFor(app, { ...twoEntries, ...otherHeaders })));
  });

  // One proxy: the entry it appended, the last one.
  await withApp('true', async (app) => {
    assert.equal(await addressFor(app, { 'x-forwarded-for': '198.51.100.7' }), '198.51.100.7');
    assert.equal(await addressFor(app, twoEntries), '203.0.113.9');
    assert.equal(await addressFor(app, { ...threeEntries, ...otherHeaders }), '203.0.113.9');
    assert.ok(isLoopback(await addressFor(app, otherHeaders)), 'without X-Forwarded-For, the connection');
  });

  // Two proxies: the entry the outer one appended, second from the right.
  await withApp('2', async (app) => {
    assert.equal(await addressFor(app, twoEntries), '198.51.100.7');
    assert.equal(await addressFor(app, { ...threeEntries, ...otherHeaders }), '198.51.100.7');
    assert.equal(await addressFor(app, { 'x-forwarded-for': '198.51.100.7' }), '198.51.100.7', 'a shorter chain gives its first entry');
  });
}

async function testLoginLimitPerAddress() {
  const { limit } = RATE_LIMITS.authLogin;

  // Behind one proxy: each client has its own count.
  await withApp('true', async (app) => {
    for (let i = 0; i < limit; i += 1) assert.equal(await login(app, '198.51.100.7'), 201, `client A, attempt ${i + 1}`);
    assert.equal(await login(app, '198.51.100.7'), 429, 'client A over the limit');
    assert.equal(await login(app, '192.0.2.99, 198.51.100.7'), 429, 'entries left of the trusted one do not change the count');
    assert.equal(await login(app, '198.51.100.8'), 201, 'client B keeps its own count');
  });

  // No trusted proxy: one count per connection address, X-Forwarded-For is not read.
  await withApp('false', async (app) => {
    for (let i = 0; i < limit; i += 1) assert.equal(await login(app, `198.51.100.${10 + i}`), 201);
    assert.equal(await login(app, '198.51.100.99'), 429);
  });
}

async function run() {
  process.env.RATE_LIMIT_ENABLED = 'true';
  await testAddressByHops();
  await testLoginLimitPerAddress();
  console.log('client-address-http.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
