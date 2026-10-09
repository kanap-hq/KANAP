import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import dataSource from '../../data-source';
import { ACCESS_TOKEN_PURPOSE } from '../../auth/access-token.util';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const API_URL = process.env.CLASSIFICATION_TEST_API_URL ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';

type Identity = { roleId: string; userId: string; email: string; borrowedRole?: boolean };

async function main() {
  if (!DATABASE_URL.endsWith('/kanap_classification_v1_test')) throw new Error('Only isolated kanap_classification_v1_test is allowed');
  if (API_URL !== 'http://localhost:8086') throw new Error('CLASSIFICATION_TEST_API_URL must be exactly http://localhost:8086');
  if (JWT_SECRET !== 'classification-local-test-only-secret') throw new Error('Unexpected JWT_SECRET for isolated HTTP smoke');

  await dataSource.initialize();
  const manager = dataSource.manager;
  const tenants = await manager.query(`SELECT id FROM tenants WHERE slug = 'classification-test' LIMIT 1`);
  assert.equal(tenants.length, 1, 'isolated classification-test tenant must exist');
  const tenantId: string = tenants[0].id;
  const identities: Identity[] = [];
  const applicationIds: string[] = [];

  const createIdentity = async (label: string, permissions: Record<string, string>, roleName?: string): Promise<Identity> => {
    const identity: Identity = { roleId: randomUUID(), userId: randomUUID(), email: `${label}-${randomUUID()}@test.invalid` };
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
    identities.push(identity);
    return identity;
  };

  const request = async (identity: Identity, path: string, init: RequestInit = {}) => {
    const token = jwt.sign({ purpose: ACCESS_TOKEN_PURPOSE, sub: identity.userId, email: identity.email, role: 'temporary', tenant_id: tenantId }, JWT_SECRET, { expiresIn: '5m' });
    return fetch(`${API_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  };

  try {
    const reader = await createIdentity('applications-reader', { applications: 'reader' });
    const member = await createIdentity('applications-member', { applications: 'member' });
    const unrelated = await createIdentity('settings-reader', { settings: 'reader' });

    const catalogResponse = await request(reader, '/applications/classification-catalog');
    assert.equal(catalogResponse.status, 200);
    const catalog: any = await catalogResponse.json();
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
      serverKinds: [{ code: 'vm', label: 'Virtual machine', is_physical: true }],
    }) });
    if (patched.status !== 200) throw new Error(`settings PATCH returned ${patched.status}: ${await patched.text()}`);
    const saved: any = await patched.json();
    assert.equal(saved.accessMethods.find((row: any) => row.label === `Kiosk ${stamp}`)?.code, `kiosk_${stamp}`, 'a code is generated from the name');
    assert.equal(saved.ipAddressTypes.find((row: any) => row.label === `Storage ${stamp}`)?.code, `storage_${stamp}`);
    assert.equal(saved.serverKinds.find((row: any) => row.code === 'vm')?.is_physical, true, 'is_physical reaches the server');
    const usageResponse = await request(settingsAdmin, '/it-ops/settings/usage?list=accessMethods&code=web');
    assert.equal(usageResponse.status, 200);
    const usage: any = await usageResponse.json();
    assert.ok(typeof usage.total === 'number' && Array.isArray(usage.usage));
    const clash = await request(settingsAdmin, '/it-ops/settings', { method: 'PATCH', body: JSON.stringify({ accessMethods: [{ code: 'web', label: 'Web' }, { label: 'web' }] }) });
    assert.equal(clash.status, 400);
    assert.match(((await clash.json()) as any).message, /clashes with/);
    assert.equal((await request(reader, '/applications', { method: 'POST', body: JSON.stringify({ name: 'reader denied' }) })).status, 403);
    assert.equal((await request(reader, `/applications/${randomUUID()}/classification-review`, { method: 'POST', body: JSON.stringify({ expected_revision: 0 }) })).status, 403);
    assert.equal((await request(unrelated, '/applications/classification-catalog')).status, 403);
    assert.equal((await request(unrelated, '/applications/classification-summary')).status, 403);
    const summaryResponse = await request(reader, '/applications/classification-summary?include_inactive=true');
    assert.equal(summaryResponse.status, 200);
    const summary: any = await summaryResponse.json();
    assert.deepEqual(Object.keys(summary).sort(), ['incomplete', 'reviewed', 'stale', 'total']);
    assert.equal(summary.reviewed + summary.stale + summary.incomplete, summary.total);

    // Recovery dependencies: readers may, a Business Contributor (restricted scope) may not, like interface routes.
    const contributor = await createIdentity('business-contributor', { applications: 'reader' }, 'Business Contributor');
    const anyApp = await manager.query(`SELECT id FROM applications WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    const dependenciesPath = `/applications/${anyApp[0]?.id ?? randomUUID()}/recovery-dependencies`;
    assert.equal((await request(unrelated, dependenciesPath)).status, 403);
    assert.equal((await request(contributor, dependenciesPath)).status, 403, 'restricted readers must not see interface references');
    if (anyApp[0]) {
      const dependenciesResponse = await request(reader, dependenciesPath);
      assert.equal(dependenciesResponse.status, 200);
      assert.ok(Array.isArray(((await dependenciesResponse.json()) as any).items));
    }

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
    if (createResponse.status !== 201) throw new Error(`member create returned ${createResponse.status}: ${await createResponse.text()}`);
    const application: any = await createResponse.json();
    applicationIds.push(application.id);

    const reviewResponse = await request(member, `/applications/${application.id}/classification-review`, {
      method: 'POST',
      body: JSON.stringify({ expected_revision: application.classification_revision }),
    });
    if (reviewResponse.status !== 201) throw new Error(`member review returned ${reviewResponse.status}: ${await reviewResponse.text()}`);
    const reviewed: any = await reviewResponse.json();
    assert.equal(reviewed.classification_review_state, 'reviewed');

    console.log('PASS: HTTP classification permissions catalog/settings/create/review guards');
  } finally {
    await manager.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.current_tenant',$1,true)`, [tenantId]);
      if (applicationIds.length) await tx.query(`DELETE FROM applications WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, applicationIds]);
      const userIds = identities.map((identity) => identity.userId);
      const roleIds = identities.filter((identity) => !identity.borrowedRole).map((identity) => identity.roleId);
      if (userIds.length) {
        await tx.query(`DELETE FROM audit_log WHERE tenant_id=$1 AND user_id = ANY($2::uuid[])`, [tenantId, userIds]);
        await tx.query(`DELETE FROM users WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, userIds]);
      }
      if (roleIds.length) {
        await tx.query(`DELETE FROM role_permissions WHERE tenant_id=$1 AND role_id = ANY($2::uuid[])`, [tenantId, roleIds]);
        await tx.query(`DELETE FROM roles WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, roleIds]);
      }
    });
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
