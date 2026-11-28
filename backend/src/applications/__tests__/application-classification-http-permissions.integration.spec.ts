// @throwaway-db-spec: commits a temporary workspace with its users and roles; refuses a developer's appdb
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { ACCESS_TOKEN_PURPOSE } from '../../auth/access-token.util';
import { applyHttpMiddleware, applyTenancyAndPipeline } from '../../http-app';
import { catalogToMetadata, DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { assertThrowawayConnection, assertThrowawayDatabase } from '../../common/__tests__/throwaway-database';
import { cleanupTenants } from '../../admin/tenants/__tests__/tenant-reset-test-helpers';

// The permission guards of the classification routes, over HTTP: the whole application
// (AppModule with the HTTP wiring of main.ts) started in this process, on a temporary workspace
// of its own, removed at the end.

process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'classification-http-spec';
process.env.JWT_SECRET ||= 'classification-http-spec-secret-of-32-characters';
delete process.env.EMAIL_OVERRIDE;

type Identity = { roleId: string; userId: string; email: string; borrowedRole?: boolean };
type Answer = { status: number; text: string; body: any };

async function main() {
  assertThrowawayDatabase('application-classification-http-permissions.integration.spec.ts');
  const JWT_SECRET = process.env.JWT_SECRET as string;

  await dataSource.initialize();

  await assertThrowawayConnection(dataSource, 'application-classification-http-permissions.integration.spec.ts');
  const manager = dataSource.manager;
  const tenantId = randomUUID();
  const slug = `classification-http-${tenantId.slice(0, 8)}`;
  await manager.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Classification HTTP', 'active', $3::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, JSON.stringify({ it_ops: catalogToMetadata(DEFAULT_CLASSIFICATION_CATALOG) })],
  );
  // The workspace is committed: from here on, whatever fails, it is removed.
  let app: INestApplication | undefined;
  try {
    const { AppModule } = require('../../app.module');
    app = await NestFactory.create(AppModule, { logger: ['error'] });
    applyHttpMiddleware(app);
    applyTenancyAndPipeline(app, app.get(DataSource));
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;

    const createIdentity = async (label: string, permissions: Record<string, string>, roleName?: string): Promise<Identity> => {
      const identity: Identity = { roleId: randomUUID(), userId: randomUUID(), email: `${label}-${randomUUID()}@classification-http.example` };
      await manager.transaction(async (tx) => {
        await tx.query(`SELECT set_config('app.current_tenant',$1,true)`, [tenantId]);
        // A named role (e.g. the built-in Business Contributor) is reused when the tenant already has it.
        const existing = roleName ? await tx.query(`SELECT id FROM roles WHERE tenant_id=$1 AND LOWER(role_name)=LOWER($2) LIMIT 1`, [tenantId, roleName]) : [];
        if (existing[0]) { identity.roleId = existing[0].id; identity.borrowedRole = true; }
        else await tx.query(`INSERT INTO roles(id,tenant_id,role_name,role_description,is_system,is_built_in) VALUES ($1,$2,$3,'Temporary HTTP permissions smoke',false,false)`, [identity.roleId, tenantId, roleName ?? `HTTP smoke ${label} ${identity.roleId}`]);
        await tx.query(`INSERT INTO users(id,tenant_id,email,first_name,last_name,role_id,status) VALUES ($1,$2,$3,'HTTP','Smoke',$4,'enabled')`, [identity.userId, tenantId, identity.email, identity.roleId]);
        if (!identity.borrowedRole) for (const [resource, level] of Object.entries(permissions)) {
          await tx.query(`INSERT INTO role_permissions(tenant_id,role_id,resource,level) VALUES ($1,$2,$3,$4)`, [tenantId, identity.roleId, resource, level]);
        }
      });
      return identity;
    };

    // Node's fetch drops a custom Host header: the workspace comes from it, so http.request.
    const request = (identity: Identity, path: string, init: { method?: string; body?: string } = {}): Promise<Answer> => {
      const token = jwt.sign({ purpose: ACCESS_TOKEN_PURPOSE, sub: identity.userId, email: identity.email, role: 'temporary', tenant_id: tenantId }, JWT_SECRET, { expiresIn: '5m' });
      const payload = init.body ?? '';
      return new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: init.method ?? 'GET',
          path,
          timeout: 10_000,
          headers: {
            Host: `${slug}.lvh.me`,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(payload)),
          },
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let body: any = null;
            try { body = text ? JSON.parse(text) : null; } catch { /* text */ }
            resolve({ status: res.statusCode ?? 0, text, body });
          });
        });
        req.on('timeout', () => req.destroy(new Error(`${path}: no answer in 10 s`)));
        req.on('error', reject);
        req.end(payload);
      });
    };


    const reader = await createIdentity('applications-reader', { applications: 'reader' });
    const member = await createIdentity('applications-member', { applications: 'member' });
    const unrelated = await createIdentity('settings-reader', { settings: 'reader' });

    const catalogResponse = await request(reader, '/applications/classification-catalog');
    assert.equal(catalogResponse.status, 200);
    const catalog: any = catalogResponse.body;
    assert.ok(Array.isArray(catalog.businessCriticalityLevels) && catalog.businessCriticalityLevels.length > 0);
    assert.equal(catalog.businessMtdPresets, undefined);

    assert.equal((await request(reader, '/it-ops/settings', { method: 'PATCH', body: '{}' })).status, 403);
    assert.equal((await request(reader, '/it-ops/settings/usage?list=applicationCategories&code=analytics')).status, 403, 'usage needs settings:reader');

    // Settings admin: lists the old controller silently dropped are persisted, codes are generated, usage is readable.
    const settingsAdmin = await createIdentity('settings-admin', { settings: 'admin' });
    const stamp = randomUUID().slice(0, 8);
    const patched = await request(settingsAdmin, '/it-ops/settings', { method: 'PATCH', body: JSON.stringify({
      accessMethods: [{ code: 'web', label: 'Web' }, { label: `Kiosk ${stamp}` }],
      ipAddressTypes: [{ code: 'host', label: 'Host' }, { label: `Storage ${stamp}` }],
      serverKinds: [{ code: 'vm', label: `Virtual machine ${stamp}`, is_physical: true }],
    }) });
    if (patched.status !== 200) throw new Error(`settings PATCH returned ${patched.status}: ${patched.text}`);
    const saved: any = patched.body;
    assert.equal(saved.accessMethods.find((row: any) => row.label === `Kiosk ${stamp}`)?.code, `kiosk_${stamp}`, 'a code is generated from the name');
    assert.equal(saved.ipAddressTypes.find((row: any) => row.label === `Storage ${stamp}`)?.code, `storage_${stamp}`);
    assert.equal(saved.serverKinds.find((row: any) => row.code === 'vm')?.is_physical, true, 'is_physical reaches the server');
    const usageResponse = await request(settingsAdmin, '/it-ops/settings/usage?list=accessMethods&code=web');
    assert.equal(usageResponse.status, 200);
    const usage: any = usageResponse.body;
    assert.ok(typeof usage.total === 'number' && Array.isArray(usage.usage));
    const clash = await request(settingsAdmin, '/it-ops/settings', { method: 'PATCH', body: JSON.stringify({ accessMethods: [{ code: 'web', label: 'Web' }, { label: 'web' }] }) });
    assert.equal(clash.status, 400);
    assert.match((clash.body as any).message, /clashes with/);
    assert.equal((await request(reader, '/applications', { method: 'POST', body: JSON.stringify({ name: 'reader denied' }) })).status, 403);
    assert.equal((await request(reader, `/applications/${randomUUID()}/classification-review`, { method: 'POST', body: JSON.stringify({ expected_revision: 0 }) })).status, 403);
    assert.equal((await request(unrelated, '/applications/classification-catalog')).status, 403);
    assert.equal((await request(unrelated, '/applications/classification-summary')).status, 403);
    const summaryResponse = await request(reader, '/applications/classification-summary?include_inactive=true');
    assert.equal(summaryResponse.status, 200);
    const summary: any = summaryResponse.body;
    assert.deepEqual(Object.keys(summary).sort(), ['attention', 'incomplete', 'levels', 'reviewed', 'stale', 'total']);
    assert.equal(summary.reviewed + summary.stale + summary.incomplete, summary.total);

    // Recovery dependencies: readers may, a Business Contributor (restricted scope) may not, like interface routes.
    const contributor = await createIdentity('business-contributor', { applications: 'reader' }, 'Business Contributor');
    // An application of the workspace, read and written under it (FORCE RLS: no tenant, no row).
    const appId = await manager.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.current_tenant',$1,true)`, [tenantId]);
      return (await tx.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Recovery dependencies app') RETURNING id`, [tenantId]))[0].id as string;
    });
    const dependenciesPath = `/applications/${appId}/recovery-dependencies`;
    assert.equal((await request(unrelated, dependenciesPath)).status, 403);
    assert.equal((await request(contributor, dependenciesPath)).status, 403, 'restricted readers must not see interface references');
    const dependenciesResponse = await request(reader, dependenciesPath);
    assert.equal(dependenciesResponse.status, 200, `a reader reads the recovery dependencies: ${dependenciesResponse.text}`);
    assert.deepEqual((dependenciesResponse.body as any).items, [], 'an application with no interface has none');

    const createResponse = await request(member, '/applications', {
      method: 'POST',
      body: JSON.stringify({
        name: `HTTP classification ${randomUUID()}`,
        criticality: catalog.businessCriticalityLevels.find((row: any) => !row.deprecated)?.code,
        cyber_criticality: catalog.cyberCriticalityLevels.find((row: any) => !row.deprecated)?.code,
        data_class: catalog.dataClasses.find((row: any) => !row.deprecated)?.code,
        recovery_wave: catalog.recoveryWaves.find((row: any) => !row.deprecated)?.code,
        rpo_minutes: 0,
        classification_justification: 'HTTP permissions regression',
      }),
    });
    if (createResponse.status !== 201) throw new Error(`member create returned ${createResponse.status}: ${createResponse.text}`);
    const application: any = createResponse.body;

    const reviewResponse = await request(member, `/applications/${application.id}/classification-review`, {
      method: 'POST',
      body: JSON.stringify({ expected_revision: application.classification_revision }),
    });
    if (reviewResponse.status !== 201) throw new Error(`member review returned ${reviewResponse.status}: ${reviewResponse.text}`);
    const reviewed: any = reviewResponse.body;
    assert.equal(reviewed.classification_review_state, 'reviewed');

    console.log('PASS: HTTP classification permissions catalog/settings/create/review guards');
  } finally {
    await app?.close();
    await cleanupTenants([tenantId]);
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
