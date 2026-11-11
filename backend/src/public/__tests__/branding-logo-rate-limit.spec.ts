import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { AuthService } from '../../auth/auth.service';
import { StripeClientService } from '../../billing/stripe/stripe.client';
import { applyTrustProxy, resolveTrustProxy } from '../../common/client-address';
import { RATE_LIMITS } from '../../common/rate-limit';
import { StorageService } from '../../common/storage/storage.service';
import { DemoDataService } from '../../demo-data/demo-data.service';
import { EmailService } from '../../email/email.service';
import { TenantBaselineService } from '../../tenants/tenant-baseline.service';
import { TenantsService } from '../../tenants/tenants.service';
import { UsersService } from '../../users/users.service';
import { PublicController } from '../public.controller';
import { TrialSignup } from '../trial-signup.entity';
import { TurnstileService } from '../turnstile.service';

// The workspace logo (`GET /public/branding/logo`) is served to every client address up to a wide
// per-minute budget, with the same answer as before (type, length, 300 seconds of browser cache);
// past the budget the address gets the 429 of the other limited routes, and another address keeps
// its own count. The limit holds in both modes: the route is the same in cloud and on-premise.

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const storageStub = {
  getObjectStream: async () => ({ stream: Readable.from([PNG]), contentType: 'image/png', contentLength: PNG.length }),
};
const tenantsStub = {
  findById: async () => ({
    id: TENANT_ID,
    branding: { logo_storage_path: 'files/tenant/branding/logo.png', logo_dark_storage_path: 'files/tenant/branding/logo-dark.png' },
  }),
};

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 10 }] })],
  controllers: [PublicController],
  providers: [
    { provide: TenantsService, useValue: tenantsStub },
    { provide: StorageService, useValue: storageStub },
    { provide: UsersService, useValue: {} },
    { provide: TenantBaselineService, useValue: {} },
    { provide: DataSource, useValue: {} },
    { provide: EmailService, useValue: {} },
    { provide: AuthService, useValue: {} },
    { provide: getRepositoryToken(TrialSignup), useValue: {} },
    { provide: TurnstileService, useValue: {} },
    { provide: StripeClientService, useValue: {} },
    { provide: DemoDataService, useValue: {} },
  ],
})
class BrandingLogoProbeModule {}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(BrandingLogoProbeModule, { logger: false });
  applyTrustProxy(app.getHttpAdapter().getInstance(), resolveTrustProxy('true', false));
  app.use((req: any, _res: unknown, next: () => void) => {
    req.tenant = { id: TENANT_ID };
    next();
  });
  await app.listen(0, '127.0.0.1');
  return app;
}

async function fetchLogo(app: INestApplication, address: string, variant?: string) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const query = variant ? `?variant=${variant}` : '';
  const res = await fetch(`http://127.0.0.1:${port}/public/branding/logo${query}`, {
    headers: { 'x-forwarded-for': address },
  });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body };
}

async function testLogoLimitPerAddress() {
  const budget = RATE_LIMITS.publicBrandingLogo;
  assert.ok(budget, 'the logo has its own budget');
  assert.equal(budget.ttl, 60_000, 'counted per minute');
  assert.ok(budget.limit >= 300, 'a wide budget: several hundred people behind one outbound address');

  const app = await createApp();
  try {
    const first = await fetchLogo(app, '198.51.100.7');
    assert.equal(first.status, 200, 'the logo is served');
    assert.equal(first.headers.get('content-type'), 'image/png');
    assert.equal(first.headers.get('content-length'), String(PNG.length));
    assert.equal(first.headers.get('cache-control'), 'public, max-age=300', 'the browser keeps it 300 seconds');
    assert.ok(first.body.equals(PNG), 'the stored image');

    // The light and the dark logo share the address's budget.
    for (let i = 1; i < budget.limit; i += 1) {
      const res = await fetchLogo(app, '198.51.100.7', i % 2 === 0 ? 'dark' : undefined);
      assert.equal(res.status, 200, `request ${i + 1} under the budget`);
    }
    const over = await fetchLogo(app, '198.51.100.7');
    assert.equal(over.status, 429, 'past the budget, the answer of the other limited routes');
    assert.match(over.body.toString('utf8'), /Too Many Requests/);

    const other = await fetchLogo(app, '198.51.100.8');
    assert.equal(other.status, 200, 'another address keeps its own count');
    assert.equal(other.headers.get('cache-control'), 'public, max-age=300');

    process.env.RATE_LIMIT_ENABLED = 'false';
    assert.equal((await fetchLogo(app, '198.51.100.7')).status, 200, 'with the limits turned off, the logo is served');
  } finally {
    process.env.RATE_LIMIT_ENABLED = 'true';
    await app.close();
  }
}

async function run() {
  process.env.RATE_LIMIT_ENABLED = 'true';
  await testLogoLimitPerAddress();
  console.log('branding-logo-rate-limit.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
