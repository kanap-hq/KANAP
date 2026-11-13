import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { EntraDisconnectedAccountsLocal1856230000000 as Migration } from '../../migrations/1856230000000-entra-disconnected-accounts-local';

// Migration 1856230000000, against a seeded database: in a workspace whose Microsoft connection was
// removed before the disconnect made accounts local, every linked account becomes local (the three
// link columns cleared, a stored password kept, one history entry each written by the migration)
// and its pending link confirmations stop working. A connected workspace is left alone, also one
// whose directory sync is off. A second run changes nothing. It runs without app.current_tenant,
// as migrations do, and puts that setting back as it found it.

const migration = new Migration();
const LOG_PREFIX = '[Migration] EntraDisconnectedAccountsLocal:';
const SOURCE_REF = 'migration:1856230000000-entra-disconnected-accounts-local';

async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { logs.push(args.map(String).join(' ')); };
  try {
    await fn();
    return logs;
  } finally {
    console.log = original;
  }
}

async function setTenant(runner: QueryRunner, tenantId: string | null) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId ?? '']);
}

type Tenant = { id: string; slug: string; users: Record<string, string> };

/** A workspace in the given connection state, with its accounts (`linked`: Microsoft link; `password`: one stored). */
async function seedTenant(
  runner: QueryRunner,
  tag: string,
  connection: { provider: string; directory: boolean; syncOn: boolean },
  accounts: Record<string, { linked: boolean; password: boolean }>,
): Promise<Tenant> {
  const id = randomUUID();
  const slug = `edl-${tag}-${id.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, sso_provider, sso_enabled, entra_tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, $4, $5, $6, now(), now())`,
    [id, slug, `Disconnected accounts ${tag}`, connection.provider, connection.syncOn, connection.directory ? randomUUID() : null],
  );
  await setTenant(runner, id);
  const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name, is_system) VALUES ($1, 'Budget Reader', false) RETURNING id`, [id]);
  const users: Record<string, string> = {};
  for (const [key, account] of Object.entries(accounts)) {
    const [row] = await runner.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, password_hash,
                          external_auth_provider, external_subject, external_synced_at)
       VALUES ($1, $2, $3, 'Tester', $4, 'enabled', $5, $6, $7, $8) RETURNING id`,
      [
        id, `${key}-${id.slice(0, 8)}@example.test`, key, role.id, account.password ? `stored-hash-${key}` : null,
        account.linked ? 'entra' : null, account.linked ? `oid-${key}` : null, account.linked ? new Date('2026-11-10T10:00:00Z') : null,
      ],
    );
    users[key] = row.id;
    // A pending link confirmation and a pending password reset for every account.
    await runner.query(
      `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour'), ($1, $2, $4, now() + interval '1 hour')`,
      [id, row.id, `entra-link:${randomUUID()}`, `reset-${randomUUID()}`],
    );
  }
  await setTenant(runner, null);
  return { id, slug, users };
}

type AccountState = { provider: string | null; subject: string | null; synced: boolean; hash: string | null };

async function state(runner: QueryRunner, tenant: Tenant) {
  await setTenant(runner, tenant.id);
  const users = await runner.query(
    `SELECT first_name, external_auth_provider, external_subject, external_synced_at, password_hash FROM users WHERE tenant_id = $1`,
    [tenant.id],
  );
  const tokens = await runner.query(
    `SELECT u.first_name, t.token_hash LIKE 'entra-link:%' AS link, t.used_at IS NOT NULL AS used
       FROM password_reset_tokens t JOIN users u ON u.id = t.user_id WHERE t.tenant_id = $1`,
    [tenant.id],
  );
  const history = await runner.query(
    `SELECT record_id, user_id, source, before_json, after_json FROM audit_log
      WHERE tenant_id = $1 AND table_name = 'users' AND source_ref = $2 ORDER BY record_id`,
    [tenant.id, SOURCE_REF],
  );
  await setTenant(runner, null);
  const accounts: Record<string, AccountState> = {};
  for (const row of users) {
    accounts[row.first_name] = {
      provider: row.external_auth_provider,
      subject: row.external_subject,
      synced: row.external_synced_at !== null,
      hash: row.password_hash,
    };
  }
  const voided: Record<string, { link: boolean; reset: boolean }> = {};
  for (const row of tokens) {
    voided[row.first_name] ??= { link: false, reset: false };
    voided[row.first_name][row.link ? 'link' : 'reset'] = row.used;
  }
  return { accounts, voided, history };
}

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

const LOCAL: Omit<AccountState, 'hash'> = { provider: null, subject: null, synced: false };
const LINKED = (key: string): Omit<AccountState, 'hash'> => ({ provider: 'entra', subject: `oid-${key}`, synced: true });
const without = ({ hash: _hash, ...rest }: AccountState) => rest;

async function testDisconnectedWorkspacesBecomeLocal() {
  await inRolledBackTransaction(async (runner) => {
    const accounts = {
      withPassword: { linked: true, password: true },
      withoutPassword: { linked: true, password: false },
      local: { linked: false, password: true },
    };
    const disconnected = await seedTenant(runner, 'off', { provider: 'none', directory: false, syncOn: false }, accounts);
    // An interrupted state: the provider still says entra, the directory is gone. Sign-in refuses it.
    const halfway = await seedTenant(runner, 'half', { provider: 'entra', directory: false, syncOn: true }, { linked: { linked: true, password: false } });
    const connected = await seedTenant(runner, 'on', { provider: 'entra', directory: true, syncOn: true }, accounts);
    // Connected with the directory sync off: Microsoft sign-in still works there.
    const syncOff = await seedTenant(runner, 'nosync', { provider: 'entra', directory: true, syncOn: false }, { linked: { linked: true, password: false } });

    const connectedBefore = await state(runner, connected);
    const syncOffBefore = await state(runner, syncOff);
    const foundBefore = randomUUID();
    await setTenant(runner, foundBefore);
    const logs = await captureLogs(() => migration.up(runner));
    const [{ setting }] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS setting`);
    assert.equal(setting, foundBefore, 'the tenant setting is put back');
    await setTenant(runner, null);

    const off = await state(runner, disconnected);
    assert.deepEqual(without(off.accounts.withPassword), LOCAL, 'linked account with a password made local');
    assert.equal(off.accounts.withPassword.hash, 'stored-hash-withPassword', 'its password stays');
    assert.deepEqual(without(off.accounts.withoutPassword), LOCAL, 'linked account without a password made local');
    assert.equal(off.accounts.withoutPassword.hash, null);
    assert.equal(off.accounts.local.hash, 'stored-hash-local', 'local account untouched');
    assert.deepEqual(off.voided, {
      withPassword: { link: true, reset: false },
      withoutPassword: { link: true, reset: false },
      local: { link: true, reset: false },
    }, 'link confirmations voided, password resets kept');
    assert.deepEqual(
      off.history.map((row: any) => ({ id: row.record_id, by: row.user_id, source: row.source, before: row.before_json.external_auth_provider, after: row.after_json })),
      [disconnected.users.withPassword, disconnected.users.withoutPassword].sort().map((id) => ({
        id, by: null, source: 'system', before: 'entra',
        after: { external_auth_provider: null, external_subject: null, external_synced_at: null },
      })),
      'one history entry per account made local',
    );

    const half = await state(runner, halfway);
    assert.deepEqual(without(half.accounts.linked), LOCAL, 'a workspace without a directory is not connected');
    assert.deepEqual(half.voided, { linked: { link: true, reset: false } });

    assert.deepEqual(await state(runner, connected), connectedBefore, 'connected workspace untouched');
    assert.deepEqual(without((await state(runner, syncOff)).accounts.linked), LINKED('linked'), 'sync off: still connected');
    assert.deepEqual(await state(runner, syncOff), syncOffBefore);

    assert.ok(logs.some((line) => line.startsWith(LOG_PREFIX) && line.includes(disconnected.slug) && line.includes('2 account(s) made local') && line.includes('3 pending link confirmation(s) voided')), logs.join('\n'));
    assert.ok(!logs.some((line) => line.includes(connected.slug) || line.includes(syncOff.slug)), 'nothing logged for connected workspaces');

    const second = await captureLogs(() => migration.up(runner));
    assert.deepEqual(await state(runner, disconnected), off, 'a second run changes nothing');
    assert.ok(second.some((line) => line.startsWith(LOG_PREFIX) && line.includes(': 0 account(s) made local, 0 pending link confirmation(s) voided')), second.join('\n'));
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testDisconnectedWorkspacesBecomeLocal]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`entra-disconnected-accounts-local-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('entra-disconnected-accounts-local-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
