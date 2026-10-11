import { ItemNumberService } from '../../common/item-number.service';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { seedRoleUser, seedTypeChangeLine, seedTypeChangeWorld, typeChangeService } from './budget-line-type-change.fixtures';
import { amountsService, captureAudit, noFreeze } from './round-inputs.fixtures';
import { assert, assertClean, assertSucceeded, describe, httpStatus, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Races of the change of type of a budget line (lot M, `budget-line-type-change.service.ts`),
// forced at fixed points, never by timing (`race-harness.ts`).
//
// 1. A change from 2026 moves the versions of 2026 and after to a new line of the other type. A
//    budget cell save of a moved version that read the version's line before the change committed
//    then locks that line, which is still there and of its nature: the version lock names the
//    nature (`lockBudgetVersions`), so the version is gone for it (404), and the cell is never
//    written through the line it left. The invariant "a version changes line only to a line of the
//    other nature" (`budget-locks.ts`, `lockVersionWithLine`).
// 2. The same save holding the line first: the change waits, then moves the version with the cell.
// 3. A task created on the line while its type changes in place: the creation reads the line FOR
//    SHARE, so it waits for the change, then finds a line of the other nature (404). Without that
//    lock it saved a task of the type of before, which no reader shows (an orphan).
// 4. The task created first: the change waits for it, then moves it with the others.
// Each race runs on its own committed tenant, removed afterwards; never on `appdb`.

const SET = 2026;

function tasksService() {
  const none = undefined as any;
  return new TasksUnifiedService(
    none, captureAudit() as any, none, none, { getTaskRecipients: async () => [] } as any, new ItemNumberService(),
    { logChange: async () => undefined } as any, { cleanupOrphanedImages: async () => undefined } as any, none,
  );
}

async function seedRace(race: { tenantId: string; seedWith: <T>(fn: (runner: any) => Promise<T>) => Promise<T> }) {
  return race.seedWith(async (runner) => {
    const w = await seedTypeChangeWorld(runner, race.tenantId);
    const member = await seedRoleUser(runner, race.tenantId, 'member', { budget: 'member', tasks: 'member' });
    const line = await seedTypeChangeLine(runner, w, { itemNumber: 990281 });
    const [{ row_version }] = await runner.query(`SELECT row_version FROM spend_items WHERE id = $1`, [line.id]);
    return { w, member, line, rowVersion: Number(row_version) };
  });
}

const datedBody = (w: { requiredAxis: { id: string; first: string } }, rowVersion: number) => ({
  row_version: rowVersion, from_year: SET, analytics_values: { [w.requiredAxis.id]: w.requiredAxis.first },
});

async function cellAfterChange() {
  await withRace('type-change-cell', async (race) => {
    const { w, member, line, rowVersion } = await seedRace(race);
    const version = line.versions[SET];
    const cell = await race.open('budget cell');
    const changer = await race.open('type change');

    // The cell save read the version's line, not locked yet.
    const read = race.gate(cell, { label: 'read the version\'s line', when: 'after', match: sql.select('spend_versions') });
    const cellWork = race.start(cell, (manager) => amountsService('opex', captureAudit(), noFreeze).bulkUpsert(
      version, { kind: 'monthly', year: SET, months: [{ period: `${SET}-03-01`, planned: 123 }] }, null, { manager },
    ));
    assert.equal(await progress(cellWork, { party: cell, gate: read }), 'gated', 'harness: the cell save pauses after reading the version');

    const changeWork = race.start(changer, (manager) => typeChangeService(undefined as any, captureAudit()).change(
      'opex', line.id, datedBody(w, rowVersion), member, { manager, tenantId: race.tenantId },
    ));
    assert.equal(await progress(changeWork, { party: changer }), 'settled', 'the change does not wait for a read');
    read.release();
    const [cellDone, changeDone] = await Promise.all([settle(cellWork), settle(changeWork)]);
    assertSucceeded(changeDone, 'the type change');
    assert.ok(!cellDone.ok && httpStatus(cellDone.error) === 404, `the cell save finds the version gone (404); it ended with ${describe(cellDone)}`);

    const newId = (changeDone as { value: { id: string } }).value.id;
    const [state] = await race.read(
      `SELECT v.spend_item_id, (SELECT planned::text FROM spend_amounts WHERE version_id = v.id AND period = '${SET}-03-01') AS march
         FROM spend_versions v WHERE v.id = $1`,
      [version],
    );
    assert.deepEqual(state, { spend_item_id: newId, march: '100.00' }, 'the version moved, its month not written');
  });
}

async function cellBeforeChange() {
  await withRace('type-change-cell-first', async (race) => {
    const { w, member, line, rowVersion } = await seedRace(race);
    const version = line.versions[SET];
    const cell = await race.open('budget cell');
    const changer = await race.open('type change');

    const held = race.gate(cell, { label: 'locked the line', when: 'after', match: sql.lockOn('spend_items') });
    const cellWork = race.start(cell, (manager) => amountsService('opex', captureAudit(), noFreeze).bulkUpsert(
      version, { kind: 'monthly', year: SET, months: [{ period: `${SET}-03-01`, planned: 123 }] }, null, { manager },
    ));
    assert.equal(await progress(cellWork, { party: cell, gate: held }), 'gated', 'harness: the cell save holds the line');

    const changeWork = race.start(changer, (manager) => typeChangeService(undefined as any, captureAudit()).change(
      'opex', line.id, datedBody(w, rowVersion), member, { manager, tenantId: race.tenantId },
    ));
    assert.equal(await progress(changeWork, { party: changer }), 'blocked', 'the change waits for the line');
    held.release();
    const [cellDone, changeDone] = await Promise.all([settle(cellWork), settle(changeWork)]);
    assertSucceeded(cellDone, 'the cell save');
    assertSucceeded(changeDone, 'the type change');
    const newId = (changeDone as { value: { id: string } }).value.id;
    const [state] = await race.read(
      `SELECT v.spend_item_id, (SELECT planned::text FROM spend_amounts WHERE version_id = v.id AND period = '${SET}-03-01') AS march
         FROM spend_versions v WHERE v.id = $1`,
      [version],
    );
    assert.deepEqual(state, { spend_item_id: newId, march: '123.00' }, 'the version moved with the cell');
  });
}

async function taskAfterChange() {
  await withRace('type-change-task', async (race) => {
    const { member, line, rowVersion } = await seedRace(race);
    const changer = await race.open('type change');
    const creator = await race.open('task creation');

    const locked = race.gate(changer, { label: 'locked the line', when: 'after', match: sql.lockOn('spend_items') });
    const changeWork = race.start(changer, (manager) => typeChangeService(undefined as any, captureAudit()).change(
      'opex', line.id, { row_version: rowVersion }, member, { manager, tenantId: race.tenantId },
    ));
    assert.equal(await progress(changeWork, { party: changer, gate: locked }), 'gated', 'harness: the change holds the line');

    const taskWork = race.start(creator, (manager) => tasksService().createForTarget(
      { type: 'spend_item', id: line.id, payload: { title: 'Created during the change' } }, member, { manager, tenantId: race.tenantId },
    ));
    assert.equal(await progress(taskWork, { party: creator }), 'blocked', 'the task creation waits for the line');
    locked.release();
    const [changeDone, taskDone] = await Promise.all([settle(changeWork), settle(taskWork)]);
    assertSucceeded(changeDone, 'the type change');
    assertClean(taskDone, 'the task creation', [404]);
    assert.equal(taskDone.ok, false, 'the task is refused for a line of the other nature');
    const tasks = await race.read(`SELECT title, related_object_type FROM tasks WHERE related_object_id = $1 ORDER BY title`, [line.id]);
    assert.deepEqual(tasks, [{ title: 'Type change task', related_object_type: 'capex_item' }], 'no task of the type of before');
  });
}

async function taskBeforeChange() {
  await withRace('type-change-task-first', async (race) => {
    const { member, line, rowVersion } = await seedRace(race);
    const changer = await race.open('type change');
    const creator = await race.open('task creation');

    const read = race.gate(creator, { label: 'read the line FOR SHARE', when: 'after', match: (text) => /FOR SHARE/i.test(text) && /spend_items/i.test(text) });
    const taskWork = race.start(creator, (manager) => tasksService().createForTarget(
      { type: 'spend_item', id: line.id, payload: { title: 'Created before the change' } }, member, { manager, tenantId: race.tenantId },
    ));
    assert.equal(await progress(taskWork, { party: creator, gate: read }), 'gated', 'harness: the task creation holds the line');

    const changeWork = race.start(changer, (manager) => typeChangeService(undefined as any, captureAudit()).change(
      'opex', line.id, { row_version: rowVersion }, member, { manager, tenantId: race.tenantId },
    ));
    assert.equal(await progress(changeWork, { party: changer }), 'blocked', 'the change waits for the task creation');
    read.release();
    const [taskDone, changeDone] = await Promise.all([settle(taskWork), settle(changeWork)]);
    assertSucceeded(taskDone, 'the task creation');
    assertSucceeded(changeDone, 'the type change');
    const tasks = await race.read(`SELECT title, related_object_type FROM tasks WHERE related_object_id = $1 ORDER BY title`, [line.id]);
    assert.deepEqual(tasks, [
      { title: 'Created before the change', related_object_type: 'capex_item' },
      { title: 'Type change task', related_object_type: 'capex_item' },
    ], 'both tasks follow the line');
  });
}

void runRaceSpecs('Budget line type change races', [
  ['a cell save of a moved version, its line read before the change: 404, nothing written through the old line', cellAfterChange],
  ['a cell save holding the line: the change waits, then moves the version with the cell', cellBeforeChange],
  ['a task created during an in-place change: it waits, then 404, no task of the type of before', taskAfterChange],
  ['a task created before the change: the change waits, then moves it', taskBeforeChange],
]);
