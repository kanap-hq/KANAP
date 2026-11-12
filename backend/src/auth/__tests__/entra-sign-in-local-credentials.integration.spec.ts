// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { EntraDirectorySyncService } from '../entra-directory-sync.service';
import { EntraController } from '../entra.controller';

// A Microsoft sign-in that links an existing account writes only the link: the account's local
// password and its two-step secret stay as they were.

const TENANT_ID = randomUUID();
const DIRECTORY_ID = randomUUID();

async function inTenant<T>(fn: (manager: any) => Promise<T>): Promise<T> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT_ID]);
    return fn(manager);
  });
}

async function seed(email: string): Promise<string> {
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, sso_provider, entra_tenant_id, sso_enabled, created_at, updated_at)
     VALUES ($1, $2, 'Entra local credentials', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb,
             'entra', $3, true, now(), now())`,
    [TENANT_ID, `entra-credentials-${TENANT_ID.slice(0, 8)}`, DIRECTORY_ID],
  );
  return inTenant(async (manager) => {
    const [role] = await manager.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Budget Reader') RETURNING id`, [TENANT_ID]);
    const [user] = await manager.query(
      `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status, password_hash, mfa_enabled, mfa_secret)
       VALUES ($1, $2, 'Local', 'Person', $3, 'enabled', 'stored-password-hash', true, 'stored-mfa-secret') RETURNING id`,
      [TENANT_ID, role.id, email],
    );
    return user.id as string;
  });
}

function controller() {
  // The directory side is not reached: no Graph profile, no reporting line.
  const directorySync = new EntraDirectorySyncService(dataSource, null as any, null as any, null as any, null as any, null as any);
  return new EntraController(
    { signLoginHandoff: () => 'handoff' } as any,
    {} as any,
    {} as any,
    {} as any,
    dataSource,
    new AuditService(dataSource.getRepository(AuditLog)),
    {} as any,
    directorySync,
    {} as any,
  );
}

async function signInWithMicrosoft(claims: Record<string, unknown>) {
  let location = '';
  await (controller() as any).handleLoginCallback(
    TENANT_ID,
    'entra-credentials',
    '/',
    claims,
    null,
    { headers: { host: 'entra-credentials.lvh.me' }, protocol: 'http' },
    { redirect: (url: string) => { location = url; } },
  );
  return location;
}

async function account(userId: string) {
  return inTenant(async (manager) => {
    const [row] = await manager.query(
      `SELECT external_auth_provider, external_subject, password_hash, mfa_enabled, mfa_secret FROM users WHERE id = $1`,
      [userId],
    );
    return row;
  });
}

async function testLinkKeepsLocalCredentials() {
  const email = `local-${TENANT_ID.slice(0, 8)}@example.invalid`;
  const userId = await seed(email);
  const location = await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: email.toUpperCase() });
  assert.match(location, /\/login\/callback#handoff=/);

  const after = await account(userId);
  assert.equal(after.external_auth_provider, 'entra');
  assert.equal(after.password_hash, 'stored-password-hash', 'the local password stays');
  assert.equal(after.mfa_enabled, true);
  assert.equal(after.mfa_secret, 'stored-mfa-secret', 'the two-step secret stays');
}

async function cleanup() {
  await inTenant(async (manager) => {
    await manager.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [TENANT_ID]);
    await manager.query(`DELETE FROM users WHERE tenant_id = $1`, [TENANT_ID]);
    await manager.query(`DELETE FROM roles WHERE tenant_id = $1`, [TENANT_ID]);
  }).catch(() => undefined);
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [TENANT_ID]).catch(() => undefined);
}

async function main() {
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://lvh.me';
  await dataSource.initialize();
  try {
    await testLinkKeepsLocalCredentials();
  } finally {
    await cleanup();
    await dataSource.destroy();
  }
  console.log('entra-sign-in-local-credentials.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
