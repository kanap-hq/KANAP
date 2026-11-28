import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { GlpiLastTest1856350000000 } from '../../migrations/1856350000000-glpi-last-test';
import { AiSettingsService } from '../ai-settings.service';

// The last GLPI test lives in `ai_settings.glpi_last_test`. The migration reruns. A test is
// written only while the row still holds the address and tokens it ran on, through its own
// statement: a save of the row never writes it back, and a save that changes the address or a
// token empties it. The GET view reads it; the audit entry never holds it.

const URL_A = 'https://glpi.example.com/';
const LAST_TEST = { ok: true, tested_at: '2026-11-26T10:42:00.000Z' };

function service(audits: any[] = []) {
  return new AiSettingsService(
    dataSource.getRepository('AiSettings') as any,
    { validate: () => [], get: () => true } as any,
    { encrypt: (value: string) => `enc:${value}`, canEncrypt: () => true } as any,
    {} as any,
    { readiness: async () => ({ errors: [], errorCode: null, usesBuiltin: false, builtinIdentity: null }) } as any,
    { log: async (entry: any) => { audits.push(entry); } } as any,
  );
}

async function seed(runner: QueryRunner, lastTest: unknown = null): Promise<{ tenantId: string; id: string }> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'GLPI last test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `glpi-last-test-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const rows = await runner.query(
    `INSERT INTO ai_settings (tenant_id, glpi_enabled, glpi_url, glpi_user_token_encrypted, glpi_app_token_encrypted, glpi_last_test)
     VALUES ($1, true, $2, 'enc:user', 'enc:app', $3::jsonb) RETURNING id`,
    [tenantId, URL_A, lastTest == null ? null : JSON.stringify(lastTest)],
  );
  return { tenantId, id: rows[0].id };
}

const read = async (runner: QueryRunner, id: string) => (await runner.query(
  `SELECT glpi_url, glpi_user_token_encrypted, glpi_last_test FROM ai_settings WHERE id = $1`,
  [id],
))[0];

async function inTransaction(name: string, fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
    console.log(`ok - ${name}`);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await inTransaction('the migration reruns and leaves every workspace without a test', async (runner) => {
      const migration = new GlpiLastTest1856350000000();
      await migration.up(runner);
      await migration.up(runner);
      const columns = await runner.query(
        `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'glpi_last_test'`,
      );
      assert.deepEqual(columns, [{ data_type: 'jsonb', is_nullable: 'YES' }]);
    });

    await inTransaction('a test is written for the values it ran on, not once they changed', async (runner) => {
      const { tenantId, id } = await seed(runner);
      const snapshot = { id, tenant_id: tenantId, glpi_url: URL_A, glpi_user_token_encrypted: 'enc:user', glpi_app_token_encrypted: 'enc:app' };
      assert.equal(await service().recordGlpiTest(runner.manager, snapshot, LAST_TEST), true);
      assert.deepEqual((await read(runner, id)).glpi_last_test, LAST_TEST);

      // The token was replaced while the test ran: its outcome describes a token that is gone.
      await runner.query(`UPDATE ai_settings SET glpi_user_token_encrypted = 'enc:other' WHERE id = $1`, [id]);
      const later = { ok: false, tested_at: '2026-11-27T08:00:00.000Z' };
      assert.equal(await service().recordGlpiTest(runner.manager, snapshot, later), false);
      assert.deepEqual((await read(runner, id)).glpi_last_test, LAST_TEST);
      assert.equal(await service().recordGlpiTest(runner.manager, { ...snapshot, glpi_url: 'https://glpi2.example.com/' }, later), false);
    });

    await inTransaction('a save of other settings keeps the test, a new token or address empties it', async (runner) => {
      const { tenantId, id } = await seed(runner, LAST_TEST);
      const audits: any[] = [];
      let saved = await service(audits).update(tenantId, { glpi_enabled: false }, { manager: runner.manager });
      assert.deepEqual((await service().toView(saved, { manager: runner.manager })).glpi_last_test, LAST_TEST);
      assert.deepEqual((await read(runner, id)).glpi_last_test, LAST_TEST);

      // A test written after the read of a save is not written back by it.
      await runner.query(`UPDATE ai_settings SET glpi_last_test = $2::jsonb WHERE id = $1`, [id, JSON.stringify({ ok: false, tested_at: '2026-11-27T09:00:00.000Z' })]);
      saved = await service(audits).update(tenantId, { conversation_retention_days: 30 }, { manager: runner.manager });
      assert.equal((await read(runner, id)).glpi_last_test.ok, false);

      saved = await service(audits).update(tenantId, { glpi_url: URL_A, glpi_user_token: 'rotated' }, { manager: runner.manager });
      assert.equal((await service().toView(saved, { manager: runner.manager })).glpi_last_test, null);
      assert.equal((await read(runner, id)).glpi_last_test, null);
      assert.equal(audits.at(-1).after.glpi_user_token_replaced, true);
      assert.doesNotMatch(JSON.stringify(audits), /glpi_last_test|tested_at|rotated|enc:/);

      await runner.query(`UPDATE ai_settings SET glpi_last_test = $2::jsonb WHERE id = $1`, [id, JSON.stringify(LAST_TEST)]);
      await service(audits).update(tenantId, { glpi_url: 'https://glpi2.example.com', glpi_user_token: 'new' }, { manager: runner.manager });
      assert.equal((await read(runner, id)).glpi_last_test, null);
    });

    await inTransaction('an empty address removes the connection and its test', async (runner) => {
      const { tenantId, id } = await seed(runner, LAST_TEST);
      await service().update(tenantId, { glpi_url: '' }, { manager: runner.manager });
      const row = await read(runner, id);
      assert.equal(row.glpi_url, null);
      assert.equal(row.glpi_user_token_encrypted, null);
      assert.equal(row.glpi_last_test, null);
      const [{ glpi_enabled }] = await runner.query(`SELECT glpi_enabled FROM ai_settings WHERE id = $1`, [id]);
      assert.equal(glpi_enabled, false);
    });

    await inTransaction('another workspace never sees the test', async (runner) => {
      const { id } = await seed(runner, LAST_TEST);
      const { tenantId: other } = await seed(runner);
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [other]);
      assert.equal((await runner.query(`SELECT 1 FROM ai_settings WHERE id = $1`, [id])).length, 0);
    });
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
