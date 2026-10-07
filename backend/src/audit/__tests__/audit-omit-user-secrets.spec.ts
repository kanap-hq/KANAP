import * as assert from 'node:assert/strict';
import { getMetadataArgsStorage } from 'typeorm';
import { AuditService, omitAuditSecrets } from '../audit.service';
import { User } from '../../users/user.entity';
import { UsersService, userAuditSnapshot } from '../../users/users.service';

// The audit log never holds a user's password hash or MFA secret: users
// service writes leave them out, AuditService.log removes them from any value
// whatever the table, and the user entity does not read them by default.

const SECRET_KEYS = ['password_hash', 'mfa_secret'];

function secretKeysIn(value: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) {
        if (SECRET_KEYS.includes(key)) found.push(key);
        visit(item);
      }
    }
  };
  visit(JSON.parse(JSON.stringify(value ?? null)));
  return found;
}

function createAuditService() {
  const inserted: any[] = [];
  const repo = { insert: async (row: any) => { inserted.push(row); } };
  const manager = { getRepository: () => repo };
  return { service: new AuditService({ manager } as any), inserted };
}

async function testAuditServiceOmitsSecretsFromAnyValue() {
  const { service, inserted } = createAuditService();
  const at = new Date('2026-01-02T03:04:05.000Z');
  const before = { email: 'ada@example.com', password_hash: 'hash-value', mfa_secret: null, created_at: at };
  const after = {
    title: 'Review',
    assignee: { email: 'bob@example.com', password_hash: 'hash-value', mfa_secret: 'secret-value' },
    watchers: [{ id: 1, mfa_secret: 'secret-value' }, { id: 2 }, 'plain', null],
  };
  const beforeCopy = JSON.parse(JSON.stringify(before));
  const afterCopy = JSON.parse(JSON.stringify(after));

  await service.log({ table: 'tasks', recordId: null, action: 'update', before, after, userId: null });

  const row = inserted[0];
  assert.deepEqual(secretKeysIn(row.before_json), [], 'before_json holds no secret key');
  assert.deepEqual(secretKeysIn(row.after_json), [], 'after_json holds no secret key, nested ones included');
  assert.deepEqual(row.before_json, { email: 'ada@example.com', created_at: at });
  assert.equal(row.before_json.created_at, at, 'a date is kept as is');
  assert.deepEqual(row.after_json, {
    title: 'Review',
    assignee: { email: 'bob@example.com' },
    watchers: [{ id: 1 }, { id: 2 }, 'plain', null],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(before)), beforeCopy, 'the input is not modified');
  assert.deepEqual(JSON.parse(JSON.stringify(after)), afterCopy, 'the input is not modified');

  // Values without the keys are written as they were.
  const plain = { name: 'Supplier', tags: ['a'], nested: { note: 'password_hash' } };
  assert.equal(omitAuditSecrets(plain), plain, 'a value without the keys is returned as is');
  assert.equal(omitAuditSecrets(null), null);
  assert.equal(omitAuditSecrets('text'), 'text');
  await service.log({ table: 'suppliers', action: 'create', before: null, after: plain });
  assert.equal(inserted[1].after_json, plain);
  assert.equal(inserted[1].before_json, null);
}

function createUsersService(user: Record<string, unknown>) {
  const logged: any[] = [];
  const repo = {
    findOne: async () => ({ ...user }),
    save: async (row: any) => row,
    manager: {},
  };
  const manager: any = {
    getRepository: (entity: { name?: string }) => {
      if (entity?.name === 'User') return repo;
      return { create: (row: any) => row, save: async () => undefined, delete: async () => undefined };
    },
  };
  const billing = { getSubscriptionSummary: async () => ({ seat_limit: null, seats_used: 0 }) };
  const email = { sendUserInviteEmail: async () => undefined };
  const audit = { log: async (entry: any) => { logged.push(entry); } };
  const service = new UsersService(repo as any, {} as any, {} as any, {} as any, billing as any, email as any, audit as any);
  return { service, manager, logged };
}

/** Even when the loaded user carries the secrets, enable, disable and invite leave them out. */
async function testUserStatusChangesLogNoSecrets() {
  const user = {
    id: 'u-1', email: 'ada@example.com', tenant_id: 't-1', status: 'disabled', locale: 'en',
    role: { role_name: 'Reader' }, external_auth_provider: null,
    password_hash: 'hash-value', mfa_secret: 'secret-value',
  };

  const enable = createUsersService(user);
  await enable.service.enableUser('u-1', 'admin-1', { manager: enable.manager });
  const disable = createUsersService({ ...user, status: 'enabled' });
  await disable.service.disableUser('u-1', 'admin-1', { manager: disable.manager });
  const invite = createUsersService(user);
  await invite.service.inviteUser('u-1', 'admin-1', 'https://example.com', { manager: invite.manager });

  for (const [name, logged] of [['enable', enable.logged], ['disable', disable.logged], ['invite', invite.logged]] as const) {
    assert.equal(logged.length, 1, `${name}: one audit entry`);
    assert.deepEqual(secretKeysIn(logged[0].before), [], `${name}: before holds no secret key`);
    assert.deepEqual(secretKeysIn(logged[0].after), [], `${name}: after holds no secret key`);
    assert.equal(logged[0].after.email, 'ada@example.com', `${name}: the rest of the user is kept`);
  }

  const snapshot = userAuditSnapshot(user as any);
  assert.deepEqual(Object.keys(snapshot).filter((key) => SECRET_KEYS.includes(key)), []);
  assert.equal(user.password_hash, 'hash-value', 'the snapshot is a copy');
}

function testUserSecretsAreNotReadByDefault() {
  for (const property of SECRET_KEYS) {
    const column = getMetadataArgsStorage().columns.find((args) => args.target === User && args.propertyName === property);
    assert.ok(column, `${property} is a column`);
    assert.equal(column!.options.select, false, `${property} is not read by default`);
  }
}

async function run() {
  process.env.JWT_SECRET ??= 'audit-omit-user-secrets-spec-secret';
  await testAuditServiceOmitsSecretsFromAnyValue();
  await testUserStatusChangesLogNoSecrets();
  testUserSecretsAreNotReadByDefault();
  console.log('audit-omit-user-secrets.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
