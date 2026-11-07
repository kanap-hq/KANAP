import * as assert from 'node:assert/strict';
import { PublicController } from '../public.controller';
import { PRODUCT_NAME } from '../../config/product';

/**
 * `GET /public/manifest.webmanifest` names an installed app after the workspace's organisation (the
 * product name when none was chosen, on the platform host and on the apex), and
 * `GET /public/tenant-info` gives the frontend that name as `displayName`. The tenancy middleware
 * sets `req.tenant` with the tenant's name in both modes (single-tenant: the default tenant).
 */

function controller(tenantRow: { name: string | null; branding?: unknown } | null) {
  const instance = Object.create(PublicController.prototype) as PublicController;
  (instance as any).tenants = { findById: async () => tenantRow };
  return instance;
}

function manifestFor(req: any): { headers: Record<string, string>; body: any } {
  const headers: Record<string, string> = {};
  let body = '';
  const res = {
    setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    send: (text: string) => { body = text; },
  };
  controller(null).webAppManifest(req, res as any);
  return { headers, body: JSON.parse(body) };
}

function testManifestNamesTheWorkspace() {
  const { headers, body } = manifestFor({ tenant: { id: 't1', slug: 'acme', name: 'Acme Industries' } });
  assert.match(headers['content-type'], /^application\/manifest\+json/);
  assert.equal(body.name, 'Acme Industries');
  assert.equal(body.short_name, 'Acme Industries');
  assert.equal(body.start_url, '/');
  assert.deepEqual(body.icons.map((icon: any) => icon.src), ['/icon-192.png', '/icon-512.png']);
}

function testManifestFallsBackToTheProduct() {
  assert.equal(manifestFor({ tenant: { id: 't1', slug: 'default', name: 'My Organization' } }).body.name, PRODUCT_NAME);
  assert.equal(manifestFor({ tenant: { id: 't1', slug: 'acme', name: '  ' } }).body.name, PRODUCT_NAME);
  assert.equal(manifestFor({ tenant: null }).body.name, PRODUCT_NAME);
  assert.equal(manifestFor({ isPlatformHost: true, tenant: { id: 'p', slug: 'platform-admin', name: 'Platform' } }).body.name, PRODUCT_NAME);
}

async function testTenantInfoDisplayName() {
  const named = await controller({ name: 'Acme Industries', branding: {} }).tenantInfo({ tenant: { id: 't1', slug: 'acme' } });
  assert.equal((named as any).name, 'Acme Industries');
  assert.equal((named as any).displayName, 'Acme Industries');
  const unnamed = await controller({ name: 'My Organization', branding: {} }).tenantInfo({ tenant: { id: 't1', slug: 'default' } });
  assert.equal((unnamed as any).name, 'My Organization', 'the stored name is unchanged');
  assert.equal((unnamed as any).displayName, null);
}

async function main() {
  testManifestNamesTheWorkspace();
  testManifestFallsBackToTheProduct();
  await testTenantInfoDisplayName();
  console.log('web-app-manifest.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
