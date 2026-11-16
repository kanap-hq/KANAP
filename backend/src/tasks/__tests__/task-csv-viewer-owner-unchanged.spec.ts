/**
 * The task import's second pass (viewers and owners) writes a task only when its viewers or owners
 * change: a task the file leaves as it is keeps its `updated_at`, and a person who reads it without
 * the right to change it gets no refusal for a row that changes nothing.
 */
import * as assert from 'node:assert/strict';
import { TasksCsvService } from '../tasks-csv.service';

const TENANT = 't1';
const ADA = 'user-ada';
const BOB = 'user-bob';

function csv(content: string): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8') } as Express.Multer.File;
}

/** A manager that answers the pass's reads with one task and records every statement. */
function taskManager(task: { viewer_ids: string[]; owner_ids: string[] }) {
  const statements: string[] = [];
  return {
    statements,
    query: async (sql: string) => {
      statements.push(sql);
      if (/FROM users/.test(sql)) return [{ id: ADA, email: 'ada@example.com' }, { id: BOB, email: 'bob@example.com' }];
      if (/FROM tasks/.test(sql)) return [{ id: 'task-1', ...task }];
      if (/UPDATE tasks/.test(sql)) return [{ n: 1 }];
      return [];
    },
  } as any;
}

const updates = (statements: string[]) => statements.filter((sql) => /UPDATE tasks/.test(sql));

async function run(file: string, task: { viewer_ids: string[]; owner_ids: string[] }): Promise<string[]> {
  const svc = new (TasksCsvService as any)(null, null, null);
  const manager = taskManager(task);
  await svc.handleViewerOwnerImport(csv(file), { manager, tenantId: TENANT });
  return updates(manager.statements);
}

async function testUnchangedTaskIsNotWritten() {
  const file = 'title;viewer_email_1;viewer_email_2;owner_email_1\r\nMigration;bob@example.com;ada@example.com;ada@example.com\r\n';
  // Same people, in another order: nothing changes.
  assert.deepEqual(await run(file, { viewer_ids: [ADA, BOB], owner_ids: [ADA] }), []);
}

async function testChangedTaskIsWritten() {
  const file = 'title;viewer_email_1;owner_email_1\r\nMigration;bob@example.com;ada@example.com\r\n';
  assert.equal((await run(file, { viewer_ids: [ADA], owner_ids: [ADA] })).length, 1);
  // Only the owners' columns: the viewers are not compared nor written.
  const owners = await run('title;owner_email_1\r\nMigration;bob@example.com\r\n', { viewer_ids: [ADA], owner_ids: [ADA] });
  assert.equal(owners.length, 1);
  assert.ok(!/viewer_ids/.test(owners[0]), owners[0]);
  assert.deepEqual(await run('title;owner_email_1\r\nMigration;ada@example.com\r\n', { viewer_ids: [BOB], owner_ids: [ADA] }), []);
}

(async () => {
  await testUnchangedTaskIsNotWritten();
  await testChangedTaskIsWritten();
  console.log('Task CSV viewer and owner pass tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
