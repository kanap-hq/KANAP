// @throwaway-db-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { AiSecretCipherService } from '../../ai/ai-secret-cipher.service';
import { Features } from '../../config/features';
import { assertThrowawayConnection, assertThrowawayDatabase } from '../../common/__tests__/throwaway-database';
import { missingEncryptionSecretWarning } from '../settings-encryption-secret';
import { InstallationAiSettings1856320000000 as Migration } from '../../migrations/1856320000000-installation-ai-settings';
import { InstallationSettingsController } from '../installation-settings.controller';
import { InstallationSettingsService } from '../installation-settings.service';
import { InstallationSettingsSnapshot } from '../installation-settings.snapshot';
import { AI_INSTALLATION_DOMAIN } from '../ai-installation-settings.domain';
import { InstallationDomain } from '../installation-settings';

// The installation settings against a real database (a throwaway one: the table is shared by the
// whole installation and the concurrent case commits):
// - the migration: down then up, rerun, one row only, nullable columns, no tenant_id, no RLS;
// - reading creates no row; a write creates it, then updates it; one audit entry per write with
//   the changed settings only, the web search key as a boolean, never the key or its cipher text;
// - a setting the file gives is locked; an unreadable file value is said; refusals by code;
// - a key without an encryption key is refused; the former and the new name of the key read the
//   same stored secret;
// - two writes at once: one row, the second sees the first;
// - a second process (another snapshot) sees a write at its next refresh, 30 seconds later
//   (simulated clock);
// - the start-up warning when the encryption key is missing while secrets are stored.

const SPEC = 'installation-settings.integration.spec';
const ENV_NAMES = [
  'SETTINGS_ENCRYPTION_SECRET', 'AI_SETTINGS_ENCRYPTION_SECRET', 'BRAVE_SEARCH_API_KEY',
  'AI_CHAT_MAX_TOKENS', 'AI_AGENT_VISION_MAX_IMAGES', 'AI_AGENT_VISION_MAX_IMAGE_BYTES',
];
const SECRET = 'installation-settings-spec-secret';
const BRAVE_KEY = 'brave-spec-key-0123456789';

type Seeded = { tenantId: string; slug: string; userId: string };

function services(): { service: InstallationSettingsService; snapshot: InstallationSettingsSnapshot } {
  const snapshot = new InstallationSettingsSnapshot();
  const audit = new AuditService(dataSource.getRepository(AuditLog));
  return { service: new InstallationSettingsService(dataSource, audit, new AiSecretCipherService(), snapshot), snapshot };
}

/** The transactions begun, for `each` to end those a failed test left open. */
const begun: QueryRunner[] = [];

async function begin(tenantId: string): Promise<QueryRunner> {
  const runner = dataSource.createQueryRunner();
  begun.push(runner);
  await runner.connect();
  await runner.startTransaction();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return runner;
}

async function finish(runner: QueryRunner, outcome: 'commit' | 'rollback') {
  if (runner.isReleased) return;
  try {
    if (runner.isTransactionActive) await (outcome === 'commit' ? runner.commitTransaction() : runner.rollbackTransaction());
  } finally {
    await runner.release();
  }
}

async function seed(): Promise<Seeded> {
  const tenantId = randomUUID();
  const slug = `installation-settings-${tenantId.slice(0, 8)}`;
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Installation settings', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  const runner = await begin(tenantId);
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Administrator', 'spec', false, false) RETURNING id`,
    [tenantId],
  );
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, email, role_id, status) VALUES ($1, $2, $3, $4, 'enabled')`,
    [userId, tenantId, `installation-${userId.slice(0, 8)}@example.invalid`, role.id],
  );
  await finish(runner, 'commit');
  return { tenantId, slug, userId };
}

async function remove(seeded: Seeded) {
  const runner = await begin(seeded.tenantId);
  for (const table of ['audit_log', 'ai_settings', 'users', 'roles']) {
    await runner.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [seeded.tenantId]);
  }
  await finish(runner, 'commit');
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [seeded.tenantId]);
}

async function auditEntries(runner: QueryRunner, tenantId: string) {
  return runner.query(
    `SELECT action, before_json, after_json, user_id, record_id
       FROM audit_log WHERE tenant_id = $1 AND table_name = 'installation_ai_settings' ORDER BY created_at, id`,
    [tenantId],
  );
}

async function refusalCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof BadRequestException, `a 400, got ${String(error)}`);
    return String((error.getResponse() as Record<string, unknown>).code);
  }
  assert.fail('expected a refusal');
}

/** Until the condition holds, at most `rounds` turns of the event loop (no timer: setInterval is simulated). */
async function eventually(condition: () => boolean, rounds = 200) {
  for (let round = 0; round < rounds && !condition(); round += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(condition(), 'the condition holds');
}

async function testMigration() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const migration = new Migration();
    await migration.down(runner);
    const [gone] = await runner.query(`SELECT to_regclass('installation_ai_settings') AS t`);
    assert.equal(gone.t, null, 'down drops the table');
    await migration.up(runner);
    await migration.up(runner);
    const columns: Array<{ column_name: string; is_nullable: string }> = await runner.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'installation_ai_settings' ORDER BY column_name`,
    );
    assert.deepEqual(columns.map((c) => `${c.column_name}:${c.is_nullable}`), [
      'chat_max_tokens:YES', 'id:NO', 'singleton:NO', 'ticket_max_image_bytes:YES', 'ticket_max_images:YES',
      'updated_at:NO', 'web_search_api_key_encrypted:YES',
    ]);
    const [security] = await runner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'installation_ai_settings'::regclass`);
    assert.deepEqual(security, { relrowsecurity: false, relforcerowsecurity: false }, 'no row level security');
    await runner.query(`INSERT INTO installation_ai_settings (chat_max_tokens) VALUES (100)`);
    for (const [sql, label] of [
      [`INSERT INTO installation_ai_settings (chat_max_tokens) VALUES (200)`, 'a second row'],
      [`INSERT INTO installation_ai_settings (singleton) VALUES (false)`, 'singleton false'],
      [`UPDATE installation_ai_settings SET ticket_max_images = 11`, '11 images'],
      [`UPDATE installation_ai_settings SET chat_max_tokens = 0`, 'zero tokens'],
    ]) {
      await runner.query('SAVEPOINT refused');
      await assert.rejects(() => runner.query(sql), Error, label);
      await runner.query('ROLLBACK TO SAVEPOINT refused');
    }
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM installation_ai_settings`);
    assert.equal(n, 1, 'one row');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testWritesAuditAndLocks(seeded: Seeded) {
  const { service, snapshot } = services();
  const runner = await begin(seeded.tenantId);
  try {
    const manager = runner.manager;
    const context = { manager, userId: seeded.userId };
    const rows = async () => (await runner.query(`SELECT count(*)::int AS n FROM installation_ai_settings`))[0].n;

    const empty = await service.getState('ai', manager);
    assert.equal(await rows(), 0, 'reading creates no row');
    assert.deepEqual(empty.settings.web_search_api_key, { has_value: false, stored_unreadable: false, source: 'default', locked: false, file_unreadable: false });
    assert.deepEqual(empty.settings.chat_max_tokens, {
      value: 16384, default: 16384, source: 'default', locked: false, file_unreadable: false, min: 1, max: 2147483647,
    });
    assert.equal(empty.encryption_available, true);

    const created = await service.update('ai', { chat_max_tokens: 4096, web_search_api_key: `  ${BRAVE_KEY}  ` }, context);
    assert.equal(await rows(), 1);
    assert.equal((created.settings.chat_max_tokens as any).value, 4096);
    assert.equal(created.settings.chat_max_tokens.source, 'database');
    assert.deepEqual(created.settings.web_search_api_key, { has_value: true, stored_unreadable: false, source: 'database', locked: false, file_unreadable: false });
    assert.equal(snapshot.value(AI_INSTALLATION_DOMAIN, 'web_search_api_key'), null, 'the snapshot waits for the commit');
    const [stored] = await runner.query(`SELECT web_search_api_key_encrypted AS cipher FROM installation_ai_settings`);
    assert.ok(stored.cipher && !String(stored.cipher).includes(BRAVE_KEY), 'the key is stored encrypted');

    await service.update('ai', { ticket_max_images: 3 }, context);
    await service.update('ai', { ticket_max_images: 3, chat_max_tokens: 4096 }, context); // nothing changes
    const cleared = await service.update('ai', { web_search_api_key: null }, context);
    assert.equal(cleared.settings.web_search_api_key.source, 'default');

    const entries = await auditEntries(runner, seeded.tenantId);
    assert.deepEqual(entries.map((e: any) => [e.action, e.before_json, e.after_json]), [
      ['create', null, { chat_max_tokens: 4096, web_search_key_set: true }],
      ['update', { ticket_max_images: null }, { ticket_max_images: 3 }],
      ['update', { web_search_key_set: true }, { web_search_key_set: false }],
    ]);
    assert.ok(entries.every((e: any) => e.user_id === seeded.userId), 'the author is named');
    const everything = JSON.stringify({ entries, created, cleared, empty });
    assert.ok(!everything.includes(BRAVE_KEY) && !everything.includes(String(stored.cipher)), 'neither the key nor its cipher text leaves');

    // Refusals, by code.
    assert.equal(await refusalCode(service.update('ai', { ticket_max_images: 11 }, context)), 'installation_setting_invalid');
    assert.equal(await refusalCode(service.update('ai', { ticket_max_images: 0 }, context)), 'installation_setting_invalid');
    assert.equal(await refusalCode(service.update('ai', { chat_max_tokens: 1.5 }, context)), 'installation_setting_invalid');
    assert.equal(await refusalCode(service.update('ai', { chat_max_tokens: '4096' }, context)), 'installation_setting_invalid');
    assert.equal(await refusalCode(service.update('ai', { chat_max_tokens: 2147483648 }, context)), 'installation_setting_invalid');
    assert.equal(await refusalCode(service.update('ai', { model: 'x' }, context)), 'installation_setting_unknown');
    assert.equal(await refusalCode(service.update('ai', [] as unknown, context)), 'installation_setting_invalid');

    // The file wins and locks the setting; an unreadable file value counts as absent.
    process.env.AI_CHAT_MAX_TOKENS = '9000';
    const locked = await service.getState('ai', manager);
    assert.deepEqual([locked.settings.chat_max_tokens.source, locked.settings.chat_max_tokens.locked, (locked.settings.chat_max_tokens as any).value], ['file', true, 9000]);
    assert.equal(await refusalCode(service.update('ai', { chat_max_tokens: 5000 }, context)), 'installation_setting_locked');
    process.env.AI_CHAT_MAX_TOKENS = '0';
    const unreadable = await service.getState('ai', manager);
    assert.deepEqual([unreadable.settings.chat_max_tokens.source, unreadable.settings.chat_max_tokens.file_unreadable, (unreadable.settings.chat_max_tokens as any).value], ['database', true, 4096]);
    assert.deepEqual(service.fileWarnings(), [
      '[CONFIG] AI_CHAT_MAX_TOKENS cannot be read (a positive whole number is expected): it is ignored, the value set on the screen or the default applies.',
    ]);
    delete process.env.AI_CHAT_MAX_TOKENS;

    // The encryption key: without it a key is refused (clearing is not); the new name reads what the former name stored.
    await service.update('ai', { web_search_api_key: BRAVE_KEY }, context);
    delete process.env.AI_SETTINGS_ENCRYPTION_SECRET;
    assert.equal(await refusalCode(service.update('ai', { web_search_api_key: 'another' }, context)), 'settings_encryption_unavailable');
    assert.equal((await service.getState('ai', manager)).encryption_available, false);
    process.env.SETTINGS_ENCRYPTION_SECRET = SECRET;
    const reread = await service.getState('ai', manager);
    assert.deepEqual([reread.settings.web_search_api_key.source, (reread.settings.web_search_api_key as any).has_value], ['database', true], 'the new name decrypts the stored key');
    delete process.env.SETTINGS_ENCRYPTION_SECRET;
    process.env.AI_SETTINGS_ENCRYPTION_SECRET = SECRET;
  } finally {
    await finish(runner, 'rollback');
  }
}

async function testConcurrentWritesAndRefresh(seeded: Seeded) {
  const first = services();
  const second = services();
  const t1 = await begin(seeded.tenantId);
  const t2 = await begin(seeded.tenantId);
  try {
    await first.service.update('ai', { chat_max_tokens: 1000 }, { manager: t1.manager, userId: seeded.userId });
    let settled = false;
    const pending = second.service.update('ai', { ticket_max_images: 4 }, { manager: t2.manager, userId: seeded.userId })
      .finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, false, 'the second write waits for the first');
    await finish(t1, 'commit');
    await pending;
    await finish(t2, 'commit');
  } finally {
    await finish(t1, 'rollback').catch(() => undefined);
    await finish(t2, 'rollback').catch(() => undefined);
  }
  const [row] = await dataSource.query(`SELECT count(*) OVER ()::int AS n, chat_max_tokens, ticket_max_images FROM installation_ai_settings`);
  assert.deepEqual(row, { n: 1, chat_max_tokens: 1000, ticket_max_images: 4 }, 'one row with both writes');
  const reader = await begin(seeded.tenantId);
  const entries = await auditEntries(reader, seeded.tenantId);
  await finish(reader, 'rollback');
  assert.deepEqual(entries.map((e: any) => [e.action, e.before_json, e.after_json]), [
    ['create', null, { chat_max_tokens: 1000 }],
    ['update', { ticket_max_images: null }, { ticket_max_images: 4 }],
  ]);

  // A third process loads, then sees the next write at its refresh, 30 seconds later.
  const third = services();
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    await third.service.start({ warn: false });
    assert.equal(third.snapshot.value(AI_INSTALLATION_DOMAIN, 'chat_max_tokens'), 1000);
    const writer = await begin(seeded.tenantId);
    await first.service.update('ai', { chat_max_tokens: 2000 }, { manager: writer.manager, userId: seeded.userId });
    await finish(writer, 'commit');
    await first.service.refresh(); // the controller, once the response is sent
    assert.equal(first.snapshot.value(AI_INSTALLATION_DOMAIN, 'chat_max_tokens'), 2000, 'the writing process after the commit');
    mock.timers.tick(29_999);
    for (let round = 0; round < 20; round += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(third.snapshot.value(AI_INSTALLATION_DOMAIN, 'chat_max_tokens'), 1000, 'not before 30 seconds');
    mock.timers.tick(1);
    await eventually(() => third.snapshot.value(AI_INSTALLATION_DOMAIN, 'chat_max_tokens') === 2000);
  } finally {
    third.service.stop();
    mock.timers.reset();
  }
}

/** Runs every test, says each failure, then fails once: one red does not hide the next. */
async function each(tests: Array<[string, () => Promise<void>]>) {
  const failures: string[] = [];
  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`not ok - ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const runner of begun.splice(0)) await finish(runner, 'rollback').catch(() => undefined);
  }
  assert.deepEqual(failures, [], 'every test passes');
}

/** A request as the controller receives it: its transaction, and a response that ends when the spec says so. */
function requestOf(runner: QueryRunner, seeded: Seeded) {
  const res = new EventEmitter();
  return { ctx: { manager: runner.manager, userId: seeded.userId, tenantId: seeded.tenantId } as any, req: { res }, res };
}

/** After the response: the refresh the controller starts (a few turns of the event loop), then its end. */
async function refreshed(started: Array<Promise<void>>) {
  for (let round = 0; round < 20 && started.length === 0; round += 1) await new Promise((resolve) => setImmediate(resolve));
  await Promise.all(started);
}

/** The refreshes the controller starts, to wait for them. */
function watchRefreshes(service: InstallationSettingsService): Array<Promise<void>> {
  const started: Array<Promise<void>> = [];
  const refresh = service.refresh.bind(service);
  service.refresh = (...args: Parameters<InstallationSettingsService['refresh']>) => {
    const promise = refresh(...args);
    started.push(promise);
    return promise;
  };
  return started;
}

/**
 * The snapshot follows what is committed, never a transaction (the controller refreshes it once
 * the response is sent): a rolled back write leaves it as it was; a committed one reaches it after
 * the response, which already carries the new value; a refresh begun before a commit and ended
 * after the refresh that follows the commit does not bring the former row back.
 */
async function testSnapshotFollowsTheCommit(seeded: Seeded) {
  const chat = (snapshot: InstallationSettingsSnapshot) => snapshot.value(AI_INSTALLATION_DOMAIN, 'chat_max_tokens');
  await dataSource.query(`DELETE FROM installation_ai_settings`);

  await each([
    ['a rolled back write leaves the snapshot and the switch', async () => {
      const { service, snapshot } = services();
      const controller = new InstallationSettingsController(service);
      await service.refresh();
      const switchBefore = Features.AI_WEB_SEARCH_READY;
      const refreshes = watchRefreshes(service);
      const runner = await begin(seeded.tenantId);
      const request = requestOf(runner, seeded);
      const answer = await (controller as any).updateAi({ chat_max_tokens: 4000, web_search_api_key: BRAVE_KEY }, request.ctx, request.req);
      assert.equal(answer.settings.chat_max_tokens.value, 4000, 'the answer carries the value');
      assert.equal(chat(snapshot), 16384, 'the snapshot waits for the end of the request');
      await finish(runner, 'rollback');
      request.res.emit('close');
      await refreshed(refreshes);
      assert.equal(chat(snapshot), 16384, 'the snapshot keeps the committed value');
      assert.equal(snapshot.value(AI_INSTALLATION_DOMAIN, 'web_search_api_key'), null, 'no key in the snapshot');
      assert.equal(Features.AI_WEB_SEARCH_READY, switchBefore, 'the switch does not move');
      const [{ n }] = await dataSource.query(`SELECT count(*)::int AS n FROM installation_ai_settings`);
      assert.equal(n, 0, 'no row');
    }],
    ['a committed write reaches the snapshot once the response is sent', async () => {
      const { service, snapshot } = services();
      const controller = new InstallationSettingsController(service);
      await service.refresh();
      const refreshes = watchRefreshes(service);
      const runner = await begin(seeded.tenantId);
      const request = requestOf(runner, seeded);
      const answer = await (controller as any).updateAi({ chat_max_tokens: 5000, web_search_api_key: BRAVE_KEY }, request.ctx, request.req);
      assert.equal(answer.settings.chat_max_tokens.value, 5000, 'the answer carries the new value');
      assert.equal(answer.settings.chat_max_tokens.source, 'database');
      assert.equal(chat(snapshot), 16384, 'not before the commit');
      await finish(runner, 'commit');
      assert.equal(refreshes.length, 0, 'no refresh before the response is sent');
      request.res.emit('finish');
      await refreshed(refreshes);
      assert.equal(refreshes.length, 1, 'one refresh after the response');
      assert.equal(chat(snapshot), 5000, 'the snapshot follows the commit');
      assert.equal(Features.AI_WEB_SEARCH_READY, true, 'the switch follows the committed key');
    }],
    ['a refresh begun before a commit does not bring the former row back', async () => {
      const { service, snapshot } = services();
      const controller = new InstallationSettingsController(service);
      await service.refresh();
      const formerValue = chat(snapshot);
      const [former] = await dataSource.query(
        `SELECT id, web_search_api_key_encrypted, chat_max_tokens, ticket_max_images, ticket_max_image_bytes FROM installation_ai_settings`,
      );
      // A refresh of the same process that read the former row and ends late.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const slowSource = { manager: { query: async () => { await gate; return former ? [former] : []; } } };
      const slow = new InstallationSettingsService(slowSource as any, new AuditService(dataSource.getRepository(AuditLog)), new AiSecretCipherService(), snapshot);
      const late = slow.refresh();
      const refreshes = watchRefreshes(service);
      const runner = await begin(seeded.tenantId);
      const request = requestOf(runner, seeded);
      await (controller as any).updateAi({ chat_max_tokens: 6000 }, request.ctx, request.req);
      await finish(runner, 'commit');
      request.res.emit('finish');
      await refreshed(refreshes);
      if (refreshes.length === 0) await service.refresh();
      assert.equal(chat(snapshot), 6000, 'the refresh after the commit');
      release();
      await late;
      assert.notEqual(formerValue, 6000);
      assert.equal(chat(snapshot), 6000, 'the late refresh is dropped');
    }],
  ]);
  await dataSource.query(`DELETE FROM installation_ai_settings`);
  const cleanup = await begin(seeded.tenantId);
  await cleanup.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [seeded.tenantId]);
  await finish(cleanup, 'commit');
}

/**
 * A key stored under another encryption key than today's: the state says a value is stored that
 * cannot be read (`stored_unreadable`), without counting it as set; a new key or a clear works,
 * and the audit says a key was stored before.
 */
async function testUnreadableStoredKey(seeded: Seeded) {
  const { service } = services();
  const runner = await begin(seeded.tenantId);
  try {
    const context = { manager: runner.manager, userId: seeded.userId };
    await service.update('ai', { web_search_api_key: BRAVE_KEY }, context);
    process.env.AI_SETTINGS_ENCRYPTION_SECRET = `${SECRET}-other`;
    const state = await service.getState('ai', runner.manager);
    assert.deepEqual(state.settings.web_search_api_key, {
      has_value: false, stored_unreadable: true, source: 'default', locked: false, file_unreadable: false,
    }, 'a stored key that cannot be read is said');

    const replaced = await service.update('ai', { web_search_api_key: 'replacement-key' }, context);
    assert.deepEqual(replaced.settings.web_search_api_key, {
      has_value: true, stored_unreadable: false, source: 'database', locked: false, file_unreadable: false,
    }, 'a new key is stored under the encryption key of today');

    process.env.AI_SETTINGS_ENCRYPTION_SECRET = SECRET;
    const unreadableAgain = await service.getState('ai', runner.manager);
    assert.equal((unreadableAgain.settings.web_search_api_key as any).stored_unreadable, true, 'the former key cannot read it');
    const cleared = await service.update('ai', { web_search_api_key: null }, context);
    assert.deepEqual(cleared.settings.web_search_api_key, {
      has_value: false, stored_unreadable: false, source: 'default', locked: false, file_unreadable: false,
    }, 'cleared');

    const entries = await auditEntries(runner, seeded.tenantId);
    assert.deepEqual(entries.slice(-2).map((e: any) => [e.before_json, e.after_json]), [
      [{ web_search_key_set: true }, { web_search_key_set: true }],
      [{ web_search_key_set: true }, { web_search_key_set: false }],
    ], 'the audit says a key was stored');
  } finally {
    process.env.AI_SETTINGS_ENCRYPTION_SECRET = SECRET;
    await finish(runner, 'rollback');
  }
}

/**
 * The start-up warning: no encryption key while encrypted secrets are stored. The installation
 * table in both modes; the workspace's secrets on-premise only (in the cloud a read without a
 * tenant finds none). The key set: nothing to say.
 */
async function testMissingKeyWarning(seeded: Seeded) {
  const [{ n: platformRows }] = await dataSource.query(`SELECT count(*)::int AS n FROM platform_ai_config`);
  const warn = (singleTenant: boolean, env: NodeJS.ProcessEnv = {}) =>
    missingEncryptionSecretWarning(dataSource, { singleTenant, tenantSlug: seeded.slug, env });
  assert.equal(await warn(false, { SETTINGS_ENCRYPTION_SECRET: SECRET }), null, 'the key is set');
  if (platformRows === 0) {
    assert.equal(await warn(false), null, 'nothing stored (cloud)');
    assert.equal(await warn(true), null, 'nothing stored (on-premise)');

    // The secret columns come from the declarations: a secret of a new domain is read too.
    const specDomain: InstallationDomain = {
      name: 'spec',
      table: 'installation_spec_settings',
      settings: [{ key: 'spec_token', column: 'spec_token_encrypted', env: 'SPEC_TOKEN', type: 'secret', auditKey: 'spec_token_set' }],
    };
    await dataSource.query(`CREATE TABLE installation_spec_settings (singleton boolean NOT NULL DEFAULT true UNIQUE, spec_token_encrypted text)`);
    try {
      await dataSource.query(`INSERT INTO installation_spec_settings (spec_token_encrypted) VALUES ('v1:a:b:c')`);
      const options = { singleTenant: false, tenantSlug: seeded.slug, env: {}, domains: [AI_INSTALLATION_DOMAIN, specDomain] };
      const line = await missingEncryptionSecretWarning(dataSource, options as Parameters<typeof missingEncryptionSecretWarning>[1]);
      assert.ok(line?.startsWith('[SECRETS] SETTINGS_ENCRYPTION_SECRET is not set'), `a secret of another domain (${String(line)})`);
    } finally {
      await dataSource.query(`DROP TABLE installation_spec_settings`);
    }
  }
  await dataSource.query(`INSERT INTO installation_ai_settings (web_search_api_key_encrypted) VALUES ('v1:a:b:c')`);
  const line = await warn(false);
  assert.ok(line?.startsWith('[SECRETS] SETTINGS_ENCRYPTION_SECRET is not set while encrypted secrets are stored'), String(line));
  assert.ok(await warn(true), 'on-premise too');
  await dataSource.query(`DELETE FROM installation_ai_settings`);

  const runner = await begin(seeded.tenantId);
  await runner.query(`INSERT INTO ai_settings (tenant_id, llm_api_key_encrypted) VALUES ($1, 'v1:a:b:c')`, [seeded.tenantId]);
  await finish(runner, 'commit');
  assert.ok(await warn(true), "on-premise: the workspace's secrets");
  if (platformRows === 0) assert.equal(await warn(false), null, "cloud: the workspaces' secrets are not read");
}

async function run() {
  assertThrowawayDatabase(SPEC);
  const savedEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
  process.env.AI_SETTINGS_ENCRYPTION_SECRET = SECRET;
  const savedFeature = Features.AI_WEB_SEARCH_READY;
  await dataSource.initialize();
  let seeded: Seeded | null = null;
  let original: Record<string, unknown> | null = null;
  try {
    await assertThrowawayConnection(dataSource, SPEC);
    [original] = await dataSource.query(`SELECT * FROM installation_ai_settings`);
    await dataSource.query(`DELETE FROM installation_ai_settings`);
    seeded = await seed();
    await testSnapshotFollowsTheCommit(seeded);
    await testUnreadableStoredKey(seeded);
    await testMigration();
    await testWritesAuditAndLocks(seeded);
    await testConcurrentWritesAndRefresh(seeded);
    await dataSource.query(`DELETE FROM installation_ai_settings`);
    await testMissingKeyWarning(seeded);
  } finally {
    await dataSource.query(`DELETE FROM installation_ai_settings`).catch(() => undefined);
    if (original) {
      const columns = Object.keys(original);
      await dataSource.query(
        `INSERT INTO installation_ai_settings (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
        columns.map((column) => original![column]),
      );
    }
    if (seeded) await remove(seeded);
    await dataSource.destroy();
    Features.AI_WEB_SEARCH_READY = savedFeature;
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  console.log(`${SPEC}: ok`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
