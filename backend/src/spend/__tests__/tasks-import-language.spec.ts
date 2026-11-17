/**
 * The task import refuses an unknown status with the names of the screen's language (lot I2 of
 * 26.11.9, C3): its route reads the screen's `language` as the projects, requests and incidents
 * routes do, and Kad's runner hands the person's language to it. No database: the import is stubbed.
 */
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { TasksController } from '../tasks.controller';
import { AiImportRunnerService } from '../../ai/import/ai-import-runner.service';

function recorder() {
  const calls: Array<Record<string, unknown>> = [];
  return { calls, import: async (_file: unknown, _params: unknown, opts: Record<string, unknown>) => { calls.push(opts); return { ok: true }; } };
}

async function testRoute() {
  const csv = recorder();
  const controller = new (TasksController as any)(null, null, null, null, null, null, csv, null, null, null, null);
  const req = { tenant: { id: 't1' }, user: { sub: 'u1' }, queryRunner: { manager: { query: async () => [{ locale: 'de' }] } } };
  const file = { buffer: Buffer.from('title\r\nA\r\n') };
  await controller.importCsv(file, 'true', 'enrich', 'upsert', 'fr', undefined, req);
  assert.equal(csv.calls[0].language, 'fr', 'the screen\'s language');
  await controller.importCsv(file, 'true', 'enrich', 'upsert', undefined, undefined, req);
  assert.equal(csv.calls[1].language, 'de', 'the person\'s own when the screen sends none');
}

async function testKad() {
  const tasks = recorder();
  const runner = Object.create(AiImportRunnerService.prototype);
  runner.tasks = tasks;
  runner.incidentViewer = async () => ({ userId: 'u1', isAdmin: false });
  // The person's rights, read once by the run (lot I3 of 26.11.9).
  runner.policy = { effectiveAccess: async () => ({ isAdmin: false, permissions: {} }) };
  await runner.runRows('tasks', { file: Buffer.from(''), dryRun: true, language: 'es', context: { manager: {}, tenantId: 't1', userId: 'u1' } });
  assert.equal(tasks.calls[0].language, 'es');
}

(async () => {
  await testRoute();
  await testKad();
  console.log('tasks-import-language.spec: ok');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
