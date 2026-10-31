// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
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
import { Tenant } from '../../../tenants/tenant.entity';
import { User } from '../../../users/user.entity';
import { UsersService } from '../../../users/users.service';
import { createRaceTenant, dropRaceTenant, seed } from '../../../spend/__tests__/race-harness';
import { AdminBrandingController } from '../admin-branding.controller';

// An administrator renames the organisation from Branding. The display name
// changes everywhere `GET /public/tenant-info` is read; the slug, the workspace
// address, stays. A person without users:admin is refused, and an empty name
// or one longer than 120 characters is refused. The platform console is refused
// by the same host check as the other branding routes.

process.env.JWT_SECRET = process.env.JWT_SECRET || `branding-name-${randomUUID()}`;

const storageStub = {
  putObject: async () => undefined,
  getObjectStream: async () => { throw new Error('unused'); },
  headObject: async () => null,
  deleteObject: async () => undefined,
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
class BrandingNameProbeModule {}

type Person = { id: string; email: string; tenant_id: string };

async function main() {
  await dataSource.initialize();
  let tenantId: string | undefined;
  let app: INestApplication | undefined;
  try {
    tenantId = await createRaceTenant('branding-name');
    const id = tenantId;
    const people = await seed(id, async (runner) => {
      await runner.query(
        `UPDATE tenants
         SET name = 'Acme',
             branding = COALESCE(branding, '{}'::jsonb) || '{"primary_color_light":"#112233"}'::jsonb
         WHERE id = $1`,
        [id],
      );
      const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
      const insertPerson = async (roleName: string, resource: string, level: string) => {
        const roleId = await one(
          `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`,
          [id, roleName],
        );
        await runner.query(
          `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`,
          [id, roleId, resource, level],
        );
        const email = `branding-name-${randomUUID()}@example.invalid`;
        const userId = await one(
          `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status)
           VALUES ($1, $2, 'Branding', 'Person', $3, 'enabled') RETURNING id`,
          [id, roleId, email],
        );
        return { id: userId, email, tenant_id: id };
      };
      // Role name Administrator grants every level. The member role does not.
      const admin = await insertPerson('Administrator', 'users', 'admin');
      const member = await insertPerson('Branding people member', 'users', 'member');
      const [row] = await runner.query(`SELECT slug FROM tenants WHERE id = $1`, [id]);
      return { admin, member, slug: row.slug as string };
    });

    app = await NestFactory.create(BrandingNameProbeModule, { logger: false, abortOnError: false });
    app.use((req: any, _res: any, next: () => void) => {
      const headerTenant = req.headers['x-probe-tenant'];
      if (typeof headerTenant === 'string' && headerTenant) {
        req.tenant = { id: headerTenant, slug: req.headers['x-probe-slug'], name: 'probe' };
      }
      if (req.headers['x-probe-platform'] === '1') req.isPlatformHost = true;
      next();
    });
    useRequestPipeline(app, dataSource);
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    const token = (user: Person) => jwt.sign(
      buildAccessTokenPayload(user),
      process.env.JWT_SECRET as string,
      { expiresIn: '10m' },
    );

    const call = async (
      method: string,
      path: string,
      user: Person | null,
      body?: unknown,
      extra: Record<string, string> = {},
    ) => {
      const headers: Record<string, string> = {
        'x-probe-tenant': id,
        'x-probe-slug': people.slug,
        ...extra,
      };
      if (user) headers.authorization = `Bearer ${token(user)}`;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
      return { status: res.status, json, text };
    };

    const stored = async () => {
      const [row] = await dataSource.query(`SELECT slug, name, branding FROM tenants WHERE id = $1`, [id]);
      return row as { slug: string; name: string; branding: { primary_color_light?: string } };
    };

    const settings = await call('GET', '/admin/branding/settings', people.admin);
    assert.equal(settings.status, 200, settings.text);
    assert.equal(settings.json.name, 'Acme');

    const refused = await call('PATCH', '/admin/branding/settings', people.member, { name: 'Denied' });
    assert.equal(refused.status, 403, refused.text);
    assert.equal((await stored()).name, 'Acme', 'a non-administrator changes nothing');

    for (const name of ['', '   ', 'A'.repeat(121)]) {
      const answer = await call('PATCH', '/admin/branding/settings', people.admin, { name });
      assert.equal(answer.status, 400, `${JSON.stringify(name)} → ${answer.text}`);
      assert.equal((await stored()).name, 'Acme', 'a refused name is not stored');
    }

    const renamed = await call('PATCH', '/admin/branding/settings', people.admin, {
      name: '  Northwind Traders  ',
      slug: 'taken-over',
    });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal(renamed.json.name, 'Northwind Traders');
    let row = await stored();
    assert.equal(row.name, 'Northwind Traders');
    assert.equal(row.slug, people.slug, 'the slug is not written');
    assert.equal(row.branding.primary_color_light, '#112233', 'the colour saved earlier stays');

    const boundary = 'B'.repeat(120);
    const atLimit = await call('PATCH', '/admin/branding/settings', people.admin, { name: boundary });
    assert.equal(atLimit.status, 200, atLimit.text);
    assert.equal((await stored()).name, boundary);

    const platform = await call(
      'PATCH',
      '/admin/branding/settings',
      people.admin,
      { name: 'Platform' },
      { 'x-probe-platform': '1' },
    );
    assert.equal(platform.status, 403, platform.text);
    assert.equal((await stored()).name, boundary, 'the platform console is left out');

    const info = await call('GET', '/public/tenant-info', null);
    assert.equal(info.status, 200, info.text);
    assert.equal(info.json.name, boundary);
    assert.equal(info.json.slug, people.slug);
    assert.equal(info.json.primaryColorLight, '#112233');

    const colorOnly = await call('PATCH', '/admin/branding/settings', people.admin, { primary_color_dark: '#abcdef' });
    assert.equal(colorOnly.status, 200, colorOnly.text);
    assert.equal(colorOnly.json.name, boundary, 'a colour save leaves the name');
    row = await stored();
    assert.equal(row.name, boundary);
    assert.equal(row.slug, people.slug);
    assert.equal(row.branding.primary_color_light, '#112233');

    const after = await call('GET', '/admin/branding/settings', people.admin);
    assert.equal(after.status, 200, after.text);
    assert.equal(after.json.name, boundary);

    console.log('admin branding name: ok');
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
