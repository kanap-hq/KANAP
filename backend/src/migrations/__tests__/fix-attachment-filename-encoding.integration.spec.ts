import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { FixAttachmentFilenameEncoding1816000000000 } from '../1816000000000-fix-attachment-filename-encoding';

// Migration 1816000000000 repairs attachment names multer stored as latin1.
// An UPDATE answers [rows, rowCount], so the logged count is the row count:
// a tenant with no attachment stays silent, and one garbled name is reported
// as 1 and rewritten. The whole run is one transaction, rolled back at the end.
// @database-spec

const migration = new FixAttachmentFilenameEncoding1816000000000();
const GARBLED = 'rapport-Ã©tÃ©.pdf';
const REPAIRED = 'rapport-été.pdf';

async function logged(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function withRollback(fn: (runner: QueryRunner) => Promise<void>) {
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

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `fn-${tag}-${tenantId.slice(0, 8)}`, `Filename ${tag}`],
  );
  return tenantId;
}

async function attach(runner: QueryRunner, tenantId: string, taskId: string, name: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await runner.query(
    `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, $3, 'stored.pdf', 'spec/stored.pdf')`,
    [tenantId, taskId, name],
  );
}

function fixedLines(lines: string[]): string[] {
  return lines.filter((line) => line.includes('Fixed '));
}

/** No attachment is silent. One garbled name is counted as 1 and repaired; a sound name stays. */
async function testCountAndRepair() {
  await withRollback(async (runner) => {
    const emptyId = await seedTenant(runner, 'empty');
    const fileId = await seedTenant(runner, 'file');
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [fileId]);
    const [task] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title) VALUES ($1, 1, 'Filename') RETURNING id`,
      [fileId],
    );
    await attach(runner, fileId, task.id, GARBLED);
    await attach(runner, fileId, task.id, REPAIRED);
    await attach(runner, fileId, task.id, 'notes.pdf');
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);

    const lines = await logged(() => migration.up(runner));
    const ours = fixedLines(lines).filter((line) => line.includes(emptyId) || line.includes(fileId));
    assert.deepEqual(ours, [
      `[Migration] Fixed 1 garbled filename(s) in task_attachments for tenant ${fileId}`,
    ], `only the changed row is logged (${ours.join(' / ')})`);
    assert.equal(lines.some((line) => line.includes(emptyId)), false, 'a tenant without attachments prints nothing');

    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [fileId]);
    const names: Array<{ original_filename: string }> = await runner.query(
      `SELECT original_filename FROM task_attachments WHERE tenant_id = $1 ORDER BY original_filename`,
      [fileId],
    );
    assert.deepEqual(names.map((row) => row.original_filename), ['notes.pdf', REPAIRED, REPAIRED]);

    const again = await logged(() => migration.up(runner));
    const oursAgain = fixedLines(again).filter((line) => line.includes(emptyId) || line.includes(fileId));
    assert.deepEqual(oursAgain, [], `a second run changes nothing (${oursAgain.join(' / ')})`);
  });
}

(async () => {
  await dataSource.initialize();
  try {
    await testCountAndRepair();
  } finally {
    await dataSource.destroy();
  }
  console.log('fix-attachment-filename-encoding.integration.spec: ok');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
