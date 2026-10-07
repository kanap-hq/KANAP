import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { UnauthorizedException } from '@nestjs/common';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { AuthService } from '../../auth/auth.service';
import { Company } from '../../companies/company.entity';
import { Department } from '../../departments/department.entity';
import { User } from '../user.entity';
import { UsersService } from '../users.service';

// The user password hash and MFA secret are not read by default (`select:
// false`), against a real database: the usual reads of a user leave them
// out, sign-in reads the hash and still accepts the right password only,
// saving a user read without them keeps their stored values, a password
// change still writes the hash, and none of these writes puts them in the
// audit log.

const PASSWORD = 'Initial-pass-1';
const NEXT_PASSWORD = 'Next-pass-2';
const MFA_SECRET = 'secret-value';

function hasSecretKey(value: unknown): boolean {
  return /"(password_hash|mfa_secret)"/.test(JSON.stringify(value ?? null));
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const manager = runner.manager;
    const tenantId = randomUUID();
    const tag = tenantId.slice(0, 8);
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'User secrets', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `user-secrets-${tag}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'Secrets reader', 'Secrets reader', false, false, now(), now())`,
      [roleId, tenantId],
    );
    const email = `ada-${tag}@example.com`;
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const [{ id: userId }] = await runner.query(
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, mfa_secret, role_id, mfa_enabled, status)
       VALUES ($1, 'Ada', 'Lovelace', $2, $3, $4, $5, false, 'enabled') RETURNING id`,
      [tenantId, email, hash, MFA_SECRET, roleId],
    );
    const stored = async () => {
      const [row] = await runner.query(`SELECT password_hash, mfa_secret FROM users WHERE id = $1`, [userId]);
      return row as { password_hash: string | null; mfa_secret: string | null };
    };

    const users = new UsersService(
      manager.getRepository(User),
      manager.getRepository(Company),
      manager.getRepository(Department),
      {} as any,
      { getSubscriptionSummary: async () => ({ seat_limit: null, seats_used: 0 }) } as any,
      {} as any,
      new AuditService(manager.getRepository(AuditLog)),
    );
    const auth = new AuthService(users, {} as any, {} as any);
    const opts = { manager };

    // The usual reads leave both columns out.
    const reads: Array<[string, unknown]> = [
      ['findById', await users.findById(userId, opts)],
      ['findByEmail', await users.findByEmail(email, opts)],
      ['find', await manager.getRepository(User).find({ where: { id: userId } })],
      ['list', (await users.list({ limit: 100 }, { manager, adminView: true })).items.filter((item: any) => item.id === userId)],
    ];
    for (const [name, value] of reads) {
      assert.ok(value && JSON.stringify(value).includes(email), `${name}: the user is read`);
      assert.equal(hasSecretKey(value), false, `${name}: no password hash or MFA secret`);
    }

    // Sign-in reads the hash, with the role.
    const forSignIn = await users.findByEmailForSignIn(email, opts);
    assert.equal(forSignIn?.password_hash, hash, 'sign-in reads the hash');
    assert.equal(forSignIn?.role?.role_name, 'Secrets reader', 'sign-in reads the role');
    assert.equal(forSignIn?.mfa_secret, undefined, 'sign-in does not read the MFA secret');
    assert.equal(await users.findByEmailForSignIn(`nobody-${tag}@example.com`, opts), null);
    assert.equal((await auth.validateUser(email, PASSWORD, manager)).id, userId, 'the right password signs in');
    const invalid = (err: unknown) => err instanceof UnauthorizedException && (err.getResponse() as any)?.code === 'INVALID_CREDENTIALS';
    await assert.rejects(auth.validateUser(email, 'Wrong-pass-0', manager), invalid, 'a wrong password is refused');

    // Saving a user read without the columns keeps their stored values.
    await users.disableUser(userId, null, opts);
    await users.enableUser(userId, null, opts);
    await users.updateUser(userId, { first_name: 'Ada B.' }, { actorUserId: null, canManageUsers: true }, opts);
    assert.deepEqual(await stored(), { password_hash: hash, mfa_secret: MFA_SECRET }, 'status and profile changes keep both columns');
    assert.equal((await auth.validateUser(email, PASSWORD, manager)).id, userId, 'the password still signs in');

    // A password change still writes the hash.
    await users.updateUser(userId, { password: NEXT_PASSWORD }, null, opts);
    const changed = await stored();
    assert.notEqual(changed.password_hash, hash, 'the hash changed');
    assert.equal(changed.mfa_secret, MFA_SECRET);
    assert.equal((await auth.validateUser(email, NEXT_PASSWORD, manager)).id, userId, 'the new password signs in');
    await assert.rejects(auth.validateUser(email, PASSWORD, manager), invalid, 'the old password is refused');

    // None of these writes put the columns in the audit log.
    const auditRows = await runner.query(
      `SELECT action, before_json, after_json FROM audit_log WHERE record_id = $1 ORDER BY created_at`,
      [userId],
    );
    assert.equal(auditRows.length, 4, 'disable, enable, profile and password changes are logged');
    for (const row of auditRows) {
      assert.equal(hasSecretKey(row.before_json) || hasSecretKey(row.after_json), false, `audit ${row.action}: no secret`);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('user-secrets-reads.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
