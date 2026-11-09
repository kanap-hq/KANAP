import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { Features } from '../../config/features';
import { isReservedTenantSlug, listReservedTenantSlugs } from '../tenant-slug-policy';
import { TenantsService } from '../tenants.service';

// Reserved slugs: refused for a new tenant (creation, trial sign-up, change of slug). The cloud
// subdomains (dev, qa, mail, status...) are reserved in multi-tenant mode only, and a tenant
// that already holds one of them keeps it.

const CLOUD_SUBDOMAINS = ['dev', 'qa', 'doc', 'send', 'tenants', 'mail', 'autodiscover', 'status', 'kanap'];
const ALWAYS_RESERVED = ['www', 'api', 'admin', 'billing', 'account', 'platform-admin', 'app', 'nextcloud', 'migration', 'example'];

function testReservedNames() {
  for (const slug of [...CLOUD_SUBDOMAINS, ...ALWAYS_RESERVED]) {
    assert.equal(isReservedTenantSlug(slug, false), true, `multi-tenant: ${slug}`);
    assert.equal(isReservedTenantSlug(` ${slug.toUpperCase()} `, false), true, `multi-tenant, case and spaces: ${slug}`);
  }
  for (const slug of ALWAYS_RESERVED) {
    assert.equal(isReservedTenantSlug(slug, true), true, `single-tenant: ${slug}`);
  }
  // On-premise: no subdomain, so the slug of a new installation is refused for no more names than before.
  for (const slug of CLOUD_SUBDOMAINS) {
    assert.equal(isReservedTenantSlug(slug, true), false, `single-tenant: ${slug}`);
  }
  for (const slug of ['acme', 'fromage', 'dev-team', 'qa1', 'kanap-co', 'statusboard']) {
    assert.equal(isReservedTenantSlug(slug, false), false, `free: ${slug}`);
  }
  assert.deepEqual([...listReservedTenantSlugs(true)], ALWAYS_RESERVED);
  assert.deepEqual([...listReservedTenantSlugs(false)], [...ALWAYS_RESERVED, ...CLOUD_SUBDOMAINS]);
}

function fakeService(existing: { id: string; slug: string; name: string }) {
  const updates: unknown[] = [];
  const row = { ...existing, is_system_tenant: false };
  const repo: any = {
    metadata: { findColumnWithPropertyName: () => true },
    findOne: async () => ({ ...row }),
    update: async (_where: unknown, columns: Record<string, unknown>) => { updates.push(columns); Object.assign(row, columns); },
  };
  return { service: new TenantsService(repo, null as any, null as any), updates };
}

async function testExistingTenantKeepsItsSlug() {
  const { service, updates } = fakeService({ id: 't-1', slug: 'status', name: 'Status Inc' });
  const renamed = await service.updateTenant('t-1', { name: 'Status Group' });
  assert.equal(renamed.name, 'Status Group');
  // Sending its own slug back (a settings form saves every field) is not a change of slug.
  await service.updateTenant('t-1', { slug: 'Status', name: 'Status Group' } as any);
  assert.deepEqual(updates, [{ name: 'Status Group' }, { slug: 'status', name: 'Status Group' }]);

  const other = fakeService({ id: 't-2', slug: 'acme', name: 'Acme' });
  await assert.rejects(() => other.service.updateTenant('t-2', { slug: 'status' } as any), BadRequestException);
  assert.deepEqual(other.updates, []);
}

async function testNewTenantIsRefused() {
  const { service } = fakeService({ id: 't-1', slug: 'acme', name: 'Acme' });
  const refuseReads = async () => { throw new Error('the reserved check comes before any read'); };
  const manager: any = { getRepository: () => ({ findOne: refuseReads, create: refuseReads, save: refuseReads }) };
  for (const slug of ['kanap', 'qa', 'autodiscover']) {
    await assert.rejects(() => service.createTenant({ slug, name: 'New' }, { manager }), BadRequestException, slug);
  }
}

async function main() {
  // The service reads the deployment mode: the cloud, whatever DEPLOYMENT_MODE the shell carries.
  (Features as any).SINGLE_TENANT = false;
  testReservedNames();
  await testExistingTenantKeepsItsSlug();
  await testNewTenantIsRefused();
  console.log('tenant-slug-policy.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
