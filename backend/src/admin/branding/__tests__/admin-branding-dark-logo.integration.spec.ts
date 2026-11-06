// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import dataSource from '../../../data-source';
import { buildAccessTokenPayload } from '../../../auth/auth.service';
import { AuthService } from '../../../auth/auth.service';
import { StripeConfigService } from '../../../billing/stripe/stripe.config';
import { StripeClientService } from '../../../billing/stripe/stripe.client';
import { ListContextsService } from '../../../common/list-context/list-contexts.service';
import { StorageService } from '../../../common/storage/storage.service';
import { useRequestPipeline } from '../../../common/request-pipeline';
import { EmailService } from '../../../email/email.service';
import { PermissionsService } from '../../../permissions/permissions.service';
import { RolePermission } from '../../../permissions/role-permission.entity';
import { UserPageRole } from '../../../permissions/user-page-role.entity';
import { TrialSignup } from '../../../public/trial-signup.entity';
import { TurnstileService } from '../../../public/turnstile.service';
import { DemoDataService } from '../../../demo-data/demo-data.service';
import { PublicController } from '../../../public/public.controller';
import { TenantBaselineService } from '../../../tenants/tenant-baseline.service';
import { TenantsService } from '../../../tenants/tenants.service';
import { brandingLogoPaths, Tenant } from '../../../tenants/tenant.entity';
import { User } from '../../../users/user.entity';
import { UsersService } from '../../../users/users.service';
import { createRaceTenant, dropRaceTenant, seed } from '../../../spend/__tests__/race-harness';
import { AdminBrandingController } from '../admin-branding.controller';

// An administrator gives the workspace a second logo for dark mode. Each logo is stored
// under its own key, served by `GET /public/branding/logo` (`variant=dark` for the dark
// one) and named in `GET /public/tenant-info`. Removing one leaves the other, a reset
// removes both, and every stored logo is listed for the purge and the orphan cleanup.

process.env.JWT_SECRET = process.env.JWT_SECRET || `branding-dark-${randomUUID()}`;

// A 1x1 PNG: the upload checks the file's signature.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const objects = new Map<string, Buffer>();
const deleted: string[] = [];
const storageStub = {
  putObject: async ({ key, body }: { key: string; body: Buffer }) => { objects.set(key, Buffer.from(body)); },
  getObjectStream: async (key: string) => {
    const body = objects.get(key);
    if (!body) throw new Error('NoSuchKey');
    return { stream: Readable.from([body]), contentType: 'image/png', contentLength: body.length };
  },
  headObject: async () => null,
  deleteObject: async (key: string) => { deleted.push(key); objects.delete(key); },
  getPresignedUrl: async () => '',
  listObjects: async function* listObjects() { /* unused */ },
};

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
  controllers: [AdminBrandingController, PublicController],
  providers: [
    ListContextsService,
    { provide: DataSource, useValue: dataSource },
    {
      provide: TenantsService,
      useFactory: () => new TenantsService(dataSource.getRepository(Tenant), undefined as any, undefined as any),
    },
    { provide: StorageService, useValue: storageStub },
    { provide: UsersService, useFactory: () => new (UsersService as any)(dataSource.getRepository(User)) },
    {
      provide: PermissionsService,
      useFactory: () => new PermissionsService(
        dataSource.getRepository(UserPageRole),
        dataSource.getRepository(RolePermission),
      ),
    },
    { provide: StripeConfigService, useValue: { isConfigured: () => false } },
    { provide: TenantBaselineService, useValue: {} },
    { provide: EmailService, useValue: {} },
    { provide: AuthService, useValue: {} },
    { provide: getRepositoryToken(TrialSignup), useValue: {} },
    { provide: TurnstileService, useValue: {} },
    { provide: StripeClientService, useValue: {} },
    { provide: DemoDataService, useValue: {} },
  ],
})
class BrandingDarkLogoProbeModule {}

type Person = { id: string; email: string; tenant_id: string };

async function main() {
  assert.deepEqual(brandingLogoPaths(null), []);
  assert.deepEqual(brandingLogoPaths({ logo_storage_path: 'a', logo_dark_storage_path: 'b' }), ['a', 'b']);
  assert.deepEqual(brandingLogoPaths({ logo_dark_storage_path: 'b', logo_storage_path: '' }), ['b']);

  await dataSource.initialize();
  let tenantId: string | undefined;
  let app: INestApplication | undefined;
  try {
    tenantId = await createRaceTenant('branding-dark');
    const id = tenantId;
    const people = await seed(id, async (runner) => {
      const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
      const roleId = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Administrator') RETURNING id`, [id]);
      await runner.query(
        `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'users', 'admin')`,
        [id, roleId],
      );
      const email = `branding-dark-${randomUUID()}@example.invalid`;
      const userId = await one(
        `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status)
         VALUES ($1, $2, 'Branding', 'Admin', $3, 'enabled') RETURNING id`,
        [id, roleId, email],
      );
      const [row] = await runner.query(`SELECT slug FROM tenants WHERE id = $1`, [id]);
      return { admin: { id: userId, email, tenant_id: id } as Person, slug: row.slug as string };
    });

    app = await NestFactory.create(BrandingDarkLogoProbeModule, { logger: false, abortOnError: false });
    app.use((req: any, _res: any, next: () => void) => {
      req.tenant = { id, slug: people.slug, name: 'probe' };
      next();
    });
    useRequestPipeline(app, dataSource);
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const authorization = `Bearer ${jwt.sign(buildAccessTokenPayload(people.admin), process.env.JWT_SECRET as string, { expiresIn: '10m' })}`;

    const upload = async (query: string, name: string) => {
      const form = new FormData();
      form.append('file', new Blob([PNG], { type: 'image/png' }), name);
      const res = await fetch(`${base}/admin/branding/logo${query}`, { method: 'POST', headers: { authorization }, body: form });
      return { status: res.status, json: await res.json().catch(() => null) as any };
    };
    const call = async (method: string, path: string) => {
      const res = await fetch(`${base}${path}`, { method, headers: { authorization } });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: res.status, json, text };
    };
    const branding = async () => {
      const [row] = await dataSource.query(`SELECT branding FROM tenants WHERE id = $1`, [id]);
      return row.branding as Record<string, any>;
    };
    const lightKey = `files/${id}/branding/logo.png`;
    const darkKey = `files/${id}/branding/logo-dark.png`;

    const refused = await upload('?variant=sepia', 'x.png');
    assert.equal(refused.status, 400, 'an unknown variant is refused');
    assert.equal(objects.size, 0);

    const light = await upload('', 'light.png');
    assert.equal(light.status, 201, JSON.stringify(light.json));
    assert.equal(light.json.has_logo, true);
    assert.equal(light.json.has_dark_logo, false);

    let info = await call('GET', '/public/tenant-info');
    assert.equal(info.json.logoPath, '/public/branding/logo');
    assert.equal(info.json.darkLogoPath, null, 'no dark logo yet');

    const dark = await upload('?variant=dark', 'dark.png');
    assert.equal(dark.status, 201, JSON.stringify(dark.json));
    assert.equal(dark.json.has_logo, true, 'the light logo stays');
    assert.equal(dark.json.has_dark_logo, true);
    assert.equal(dark.json.logo_version, 2, 'each upload moves the version that refreshes both URLs');
    assert.deepEqual([...objects.keys()].sort(), [darkKey, lightKey].sort(), 'each logo has its own key');
    let stored = await branding();
    assert.equal(stored.logo_storage_path, lightKey);
    assert.equal(stored.logo_dark_storage_path, darkKey);

    const settings = await call('GET', '/admin/branding/settings');
    assert.equal(settings.json.has_dark_logo, true);

    info = await call('GET', '/public/tenant-info');
    assert.equal(info.json.darkLogoPath, '/public/branding/logo?variant=dark');
    assert.equal(info.json.logoVersion, 2);

    const served = await fetch(`${base}/public/branding/logo?variant=dark`);
    assert.equal(served.status, 200);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);

    const removedDark = await call('DELETE', '/admin/branding/logo?variant=dark');
    assert.equal(removedDark.status, 200, removedDark.text);
    assert.equal(removedDark.json.has_dark_logo, false);
    assert.equal(removedDark.json.has_logo, true, 'removing the dark logo keeps the light one');
    assert.deepEqual(deleted, [darkKey]);
    stored = await branding();
    assert.equal(stored.logo_dark_storage_path, undefined);
    assert.equal(stored.logo_storage_path, lightKey);
    assert.equal((await fetch(`${base}/public/branding/logo?variant=dark`)).status, 404);
    assert.equal((await fetch(`${base}/public/branding/logo`)).status, 200);

    // Only a dark logo: tenant-info still carries the version its URL needs.
    const onlyLight = await call('DELETE', '/admin/branding/logo');
    assert.equal(onlyLight.json.has_logo, false);
    await upload('?variant=dark', 'dark.png');
    info = await call('GET', '/public/tenant-info');
    assert.equal(info.json.logoPath, null);
    assert.equal(info.json.darkLogoPath, '/public/branding/logo?variant=dark');
    assert.equal(typeof info.json.logoVersion, 'number');

    await upload('', 'light.png');
    deleted.length = 0;
    const reset = await call('POST', '/admin/branding/reset');
    assert.equal(reset.status, 201, reset.text);
    assert.equal(reset.json.has_logo, false);
    assert.equal(reset.json.has_dark_logo, false);
    assert.deepEqual(deleted.sort(), [darkKey, lightKey].sort(), 'a reset removes both logos');
    stored = await branding();
    assert.equal(stored.logo_storage_path, undefined);
    assert.equal(stored.logo_dark_storage_path, undefined);

    console.log('admin branding dark logo: ok');
  } finally {
    await app?.close().catch((error) => console.error(error));
    if (tenantId) await dropRaceTenant(tenantId).catch((error) => console.error(error));
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

main().catch((error) => {
  const text = error instanceof Error ? error.stack || error.message : String(error);
  console.error(text);
  process.exit(1);
});
