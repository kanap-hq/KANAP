import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { TaskTypeCodes1854130000000 } from '../../migrations/1854130000000-task-type-codes';

// Migration 1854130000000 against a seeded dirty database, in one transaction rolled back at the
// end. It starts from its down() (no `code` column) and succeeds with no manual step:
// - a type whose name is still a shipped default, in any case, gets that default's code;
// - a renamed default and a type the tenant added keep no code;
// - two types matching the same default in a tenant: the earliest (created_at, id) gets the code,
//   the other is logged and left without one;
// - counts are logged per tenant, RLS is put back as found, a code is unique per tenant, and a
//   rerun changes nothing.

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function inRollback(fn: (runner: QueryRunner) => Promise<void>) {
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

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  const slug = `${tag}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Task type codes', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  return { tenantId, slug };
}

/** Inserts a task type in the current tenant; `minutes` orders created_at. */
async function taskType(runner: QueryRunner, tenantId: string, name: string, minutes: number): Promise<string> {
  const rows = await runner.query(
    `INSERT INTO portfolio_task_types (tenant_id, name, created_at, updated_at)
     VALUES ($1, $2, now() - make_interval(mins => $3::int), now()) RETURNING id`,
    [tenantId, name, 100 - minutes],
  );
  return rows[0].id as string;
}

async function codesOf(runner: QueryRunner, tenantId: string): Promise<Record<string, string | null>> {
  await setTenant(runner, tenantId);
  const rows: Array<{ name: string; code: string | null }> = await runner.query(
    `SELECT name, code FROM portfolio_task_types WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  await setTenant(runner, '');
  return Object.fromEntries(rows.map((row) => [row.name, row.code]));
}

async function rlsStates(runner: QueryRunner) {
  return runner.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relrowsecurity ORDER BY relname`,
  );
}

/** Runs `fn` and returns what it logged. */
async function logged(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

async function testBackfill() {
  await inRollback(async (runner) => {
    const migration = new TaskTypeCodes1854130000000();
    await migration.down(runner);
    const [{ n: columns }] = await runner.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'portfolio_task_types' AND column_name = 'code'`,
    );
    assert.equal(columns, 0, 'down() removes the column');
    const rlsBefore = await rlsStates(runner);

    const a = await seedTenant(runner, 'tt-codes-a');
    await setTenant(runner, a.tenantId);
    const keptTask = await taskType(runner, a.tenantId, 'Task', 1);
    const duplicateTask = await taskType(runner, a.tenantId, 'task', 2);
    await taskType(runner, a.tenantId, 'Anomalie', 3); // the shipped Bug, renamed
    await taskType(runner, a.tenantId, 'PROBLEM', 4);
    await taskType(runner, a.tenantId, 'Change', 5); // added by the tenant
    // No Incident in this tenant (deleted).

    const b = await seedTenant(runner, 'tt-codes-b');
    await setTenant(runner, b.tenantId);
    await taskType(runner, b.tenantId, 'Incident', 1);
    await taskType(runner, b.tenantId, 'Bug', 2);
    await setTenant(runner, '');

    const log = await logged(() => migration.up(runner));

    assert.deepEqual(await codesOf(runner, a.tenantId), {
      Anomalie: null,
      Change: null,
      PROBLEM: 'problem',
      Task: 'task',
      task: null,
    });
    assert.deepEqual(await codesOf(runner, b.tenantId), { Bug: 'bug', Incident: 'incident' });
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');

    assert.match(log, new RegExp(`tenant ${a.slug} \\(${a.tenantId}\\): 2 task type\\(s\\) given their code`));
    assert.match(log, new RegExp(`tenant ${b.slug} \\(${b.tenantId}\\): 2 task type\\(s\\) given their code`));
    assert.match(
      log,
      new RegExp(`tenant ${a.slug} \\(${a.tenantId}\\): task type ${duplicateTask} "task" also matches the shipped "Task", left without a code \\(kept by ${keptTask}\\)`),
    );

    const [index] = await runner.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'portfolio_task_types' AND indexname = 'IDX_portfolio_task_types_tenant_code'`,
    );
    assert.match(index?.indexdef ?? '', /UNIQUE INDEX .* \(tenant_id, code\) WHERE \(code IS NOT NULL\)/);

    // A code is unique per tenant.
    await setTenant(runner, a.tenantId);
    await runner.query('SAVEPOINT dup_code');
    await assert.rejects(
      runner.query(`UPDATE portfolio_task_types SET code = 'task' WHERE id = $1`, [duplicateTask]),
      /IDX_portfolio_task_types_tenant_code|duplicate key/,
    );
    await runner.query('ROLLBACK TO SAVEPOINT dup_code');
    // A rename keeps the code, and the rerun does not hand it to the duplicate.
    await runner.query(`UPDATE portfolio_task_types SET name = 'Tâche' WHERE id = $1`, [keptTask]);
    await setTenant(runner, '');

    const rerun = await logged(() => migration.up(runner));
    assert.doesNotMatch(rerun, /given their code/, 'a rerun gives no code');
    assert.deepEqual(await codesOf(runner, a.tenantId), {
      Anomalie: null,
      Change: null,
      PROBLEM: 'problem',
      Tâche: 'task',
      task: null,
    });
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found after a rerun');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testBackfill]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 8).join(' | ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`task-type-codes.migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('task-type-codes.migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
