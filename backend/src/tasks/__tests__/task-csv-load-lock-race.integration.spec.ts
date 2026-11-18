import 'dotenv/config';
import 'reflect-metadata';
import type { EntityManager } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { assert, assertSucceeded, progress, Race, runRaceSpecs, settle, sql, withRace } from '../../spend/__tests__/race-harness';
import { TasksCsvService } from '../tasks-csv.service';

// The load of the shared CSV import (lot I6 of 26.11.9, pass F): it works from the records it finds,
// locked `FOR UPDATE` and read again in its transaction, in the order of their ids. A column the file
// leaves out keeps the record as it is when written: a move saved on the screen during the load is
// kept, whether it lands before the lock (read again) or after (it waits, then applies). Two loads
// that cross the same records wait for each other and never deadlock. The path is the same for the
// six imports of the shared import; the tasks show it.

function importTasks(manager: EntityManager, tenantId: string, csv: string) {
  const resolver = new CsvResolverService();
  const service = new TasksCsvService(null as any, new CsvExportService(resolver), new CsvImportService(resolver, new CsvJsonValidators()));
  const file = { buffer: Buffer.from(csv, 'utf8'), originalname: 'tasks.csv', mimetype: 'text/csv', size: csv.length } as Express.Multer.File;
  return service.import(file, { dryRun: false, operation: 'upsert' }, { manager, tenantId, userId: null, isAdmin: true, access: { isAdmin: true } as any });
}

type Seeded = { p1: string; p2: string; build: string; run: string; tasks: string[] };

/** Two projects with a phase each, and tasks of the first one, in its phase Build. */
async function seedTasks(race: Race, count: number): Promise<Seeded> {
  return race.seedWith(async (runner) => {
    const [p1] = await runner.query(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'P1', 1) RETURNING id`, [race.tenantId]);
    const [p2] = await runner.query(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'P2', 2) RETURNING id`, [race.tenantId]);
    const [build] = await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Build') RETURNING id`, [race.tenantId, p1.id]);
    const [run] = await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Run') RETURNING id`, [race.tenantId, p2.id]);
    const tasks: string[] = [];
    for (let n = 1; n <= count; n += 1) {
      const [task] = await runner.query(
        `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, phase_id, labels, viewer_ids, owner_ids)
         VALUES ($1, $2, $3, 'open', 'project', $4, $5, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
        [race.tenantId, n, `Task ${n}`, p1.id, build.id],
      );
      tasks.push(task.id);
    }
    return { p1: p1.id, p2: p2.id, build: build.id, run: run.id, tasks };
  });
}

/** The screen moves the task to P2, phase Run, and saves. */
function moveToP2(manager: EntityManager, seeded: Seeded, taskId: string) {
  return manager.query(`UPDATE tasks SET related_object_id = $2, phase_id = $3 WHERE id = $1`, [taskId, seeded.p2, seeded.run]);
}

async function stateOf(race: Race, seeded: Seeded, taskId: string) {
  return race.readOne(
    `SELECT title, related_object_id = $2 AS on_p2, phase_id = $3 AS in_run FROM tasks WHERE id = $1`,
    [taskId, seeded.p2, seeded.run],
  );
}

/** The move lands after the import found the task, before it locked it: the load reads it again and keeps it. */
async function moveBeforeTheLockIsKept() {
  await withRace('csv-load-before-lock', async (race) => {
    const seeded = await seedTasks(race, 1);
    const [taskId] = seeded.tasks;
    const importer = await race.open('task import');
    const screen = await race.open('the screen');
    const found = race.gate(importer, { label: 'the task found', when: 'after', match: (text) => /^\s*SELECT \* FROM tasks WHERE tenant_id = \$1 AND id = ANY/.test(text) && !/FOR UPDATE/.test(text) });
    const work = race.start(importer, (manager) => importTasks(manager, race.tenantId, `id;title\n${taskId};Renamed`));
    assert.equal(await progress(work, { party: importer, gate: found }), 'gated', 'harness: the import pauses once it found the task');
    const move = race.start(screen, (manager) => moveToP2(manager, seeded, taskId));
    assert.equal(await progress(move, { party: screen }), 'settled', 'the move is saved while the import pauses');
    assertSucceeded(await settle(move), 'the move');
    found.release();
    const result = await settle(work);
    assertSucceeded(result, 'the import');
    assert.equal((result as any).value.ok, true, JSON.stringify((result as any).value.errors));
    assert.deepEqual(await stateOf(race, seeded, taskId), { title: 'Renamed', on_p2: true, in_run: true }, 'the move is kept, the title written');
  });
}

/** The move comes once the load locked the task: it waits for the import, then applies. */
async function moveAfterTheLockWaits() {
  await withRace('csv-load-after-lock', async (race) => {
    const seeded = await seedTasks(race, 1);
    const [taskId] = seeded.tasks;
    const importer = await race.open('task import');
    const screen = await race.open('the screen');
    const locked = race.gate(importer, { label: 'the task locked', when: 'after', match: sql.lockOn('tasks') });
    const work = race.start(importer, (manager) => importTasks(manager, race.tenantId, `id;title\n${taskId};Renamed`));
    assert.equal(await progress(work, { party: importer, gate: locked }), 'gated', 'the load locks the task it found');
    const move = race.start(screen, (manager) => moveToP2(manager, seeded, taskId));
    assert.equal(await progress(move, { party: screen }), 'blocked', 'the move waits for the import');
    locked.release();
    assertSucceeded(await settle(work), 'the import');
    assertSucceeded(await settle(move), 'the move');
    assert.deepEqual(await stateOf(race, seeded, taskId), { title: 'Renamed', on_p2: true, in_run: true }, 'the import, then the move');
  });
}

/** Two loads that name the same two tasks in opposite orders: the second waits for the first, no deadlock. */
async function crossedLoadsDoNotDeadlock() {
  await withRace('csv-load-crossed', async (race) => {
    const seeded = await seedTasks(race, 2);
    const [t1, t2] = seeded.tasks;
    const first = await race.open('first import');
    const second = await race.open('second import');
    const locked = race.gate(first, { label: 'both tasks locked', when: 'after', match: sql.lockOn('tasks') });
    const a = race.start(first, (manager) => importTasks(manager, race.tenantId, `id;title\n${t1};A1\n${t2};A2`));
    assert.equal(await progress(a, { party: first, gate: locked }), 'gated', 'the first load locks both tasks');
    const b = race.start(second, (manager) => importTasks(manager, race.tenantId, `id;title\n${t2};B2\n${t1};B1`));
    assert.equal(await progress(b, { party: second }), 'blocked', 'the second load waits for the first');
    locked.release();
    assertSucceeded(await settle(a), 'the first import');
    assertSucceeded(await settle(b), 'the second import');
    const titles = await race.read(`SELECT title FROM tasks WHERE id = ANY($1::uuid[]) ORDER BY item_number`, [[t1, t2]]);
    assert.deepEqual(titles.map((row: any) => row.title), ['B1', 'B2'], 'the second load wrote last');
  });
}

void runRaceSpecs('Shared CSV import load lock', [
  ['a move saved before the load locks the task is kept', moveBeforeTheLockIsKept],
  ['a move saved once the load locked the task waits, then applies', moveAfterTheLockWaits],
  ['two loads crossing the same tasks wait for each other, no deadlock', crossedLoadsDoNotDeadlock],
]);
