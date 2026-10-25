// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { shareRecipientsWhoCannotOpen } from '../can-read';
import { NotificationsService } from '../../notifications/notifications.service';
import { ScheduledNotificationsService } from '../../notifications/scheduled-notifications.service';
import { SpendItemsService } from '../../spend/spend-items.service';
import { SpendItem } from '../../spend/spend-item.entity';
import { TaskActivitiesService } from '../../tasks/task-activities.service';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { Task } from '../../tasks/task.entity';
import { PortfolioActivity } from '../../portfolio/portfolio-activity.entity';
import { existingRecentItems } from '../../dashboard/recent-items';
import { readBudgetLineMeta } from '../../spend/item-meta';
import { LIMITED_ROLE, PgClient, roleExists, sorted } from './data-access-test-helpers';
import { nextItemNumber, Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 4 run 4C (planning/data-scoped-access/spec.md §5.6, §10.5): the paths that
 * send or show an object to a person, on the reference example of lot 2 (`data-access-line-seed.ts`;
 * Marta reads L2 to L5, Paul L1 to L4, Nina L6 and L7, Ulla everything).
 *
 * - Notifications of a task (status change, comment, unified action: `getTaskRecipients`): the
 *   named persons (assignee, owners, observers) always; the creator of a task of a line only when
 *   they can read it. A comment written by Paul on a task of L1 created by Marta reaches its named
 *   persons, not Marta. The weekly review lists a task Marta only created on L4, not on L1.
 * - "Send the link": the task and line shares answer `cannot_open` with the chosen persons who
 *   cannot open the object, by name; the link goes to everyone. A sender asking about an object
 *   out of their own access learns nothing, nor does one sharing a task whose line is hidden to
 *   them (no `cannot_open` at all).
 * - Recent items: a limited person gets back only the records they can read (a hidden line and a
 *   hidden task leave the list like deleted ones); Ulla gets every existing record.
 * - Object history: the task history and the line meta answer the same 404 (or null) for a hidden
 *   object and a random id; a visible object answers.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
const none = undefined as any;

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

async function as<T>(runner: QueryRunner, person: string | null, fn: (m: EntityManager) => Promise<T>): Promise<T> {
  await runner.query('SAVEPOINT person');
  try {
    if (person) await applyDataAccess(runner, person);
    return await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

async function rejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return null;
}

type Tasks = { l1ByMarta: string; l4ByMarta: string; l1ByUlla: string; free: string };

async function seedTasks(runner: QueryRunner, s: Seed): Promise<Tasks> {
  const task = async (title: string, type: string | null, objectId: string | null, creator: string, extra: { assignee?: string; owners?: string[] } = {}) => (await runner.query(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, creator_id, assignee_user_id, owner_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING id`,
    [s.tenantId, title, nextItemNumber(), type, objectId, creator, extra.assignee ?? null, JSON.stringify(extra.owners ?? [])],
  ))[0].id as string;
  return {
    // Marta created it; Nina is its assignee and Paul its owner (named, whatever their access).
    l1ByMarta: await task('L1 task by Marta', 'spend_item', s.lines.L1, s.persons.marta, { assignee: s.persons.nina, owners: [s.persons.paul] }),
    l4ByMarta: await task('L4 task by Marta', 'spend_item', s.lines.L4, s.persons.marta, { assignee: s.persons.nina }),
    l1ByUlla: await task('L1 task by Ulla', 'spend_item', s.lines.L1, s.persons.ulla, { assignee: s.persons.nina }),
    free: await task('Task without object by Marta', null, null, s.persons.marta, { assignee: s.persons.nina }),
  };
}

async function testNotificationRecipients(runner: QueryRunner, s: Seed, t: Tasks): Promise<void> {
  const notifications = new NotificationsService(none, none, none, none);
  const ids = async (m: EntityManager, taskId: string) => sorted((await notifications.getTaskRecipients(taskId, m)).map((r) => r.userId));
  const { marta, nina, paul, ulla } = s.persons;
  for (const actor of [paul, ulla, null]) {
    await as(runner, actor, async (m) => {
      assert.deepEqual(await ids(m, t.l1ByMarta), sorted([nina, paul]), 'L1: the named persons, not Marta who only created it');
      assert.deepEqual(await ids(m, t.l4ByMarta), sorted([marta, nina]), 'L4: Marta reads the line, she hears of it');
      assert.deepEqual(await ids(m, t.l1ByUlla), sorted([nina, ulla]), 'Ulla (mode all) created it: she hears of it');
      assert.deepEqual(await ids(m, t.free), sorted([marta, nina]), 'a task without object is not scoped');
    });
  }

  // A comment by Paul on the L1 task: the notification goes to the named persons only.
  const sent: any[] = [];
  const fake = { getTaskRecipients: notifications.getTaskRecipients.bind(notifications), notifyComment: async (p: any) => { sent.push(p); } };
  const activities = new TaskActivitiesService(
    runner.manager.getRepository(PortfolioActivity), runner.manager.getRepository(Task), fake as any, {} as any, { log: async () => undefined } as any,
  );
  await as(runner, paul, (m) => activities.create(t.l1ByMarta, { type: 'comment', content: 'Budget question' } as any, s.tenantId, paul, { manager: m }));
  assert.equal(sent.length, 1, 'one comment notification');
  assert.deepEqual(sorted(sent[0].recipients.map((r: any) => r.userId)), sorted([nina, paul]), 'comment: Nina and Paul (the author is skipped later), not Marta');

  // The weekly review's task lists, as the service reads them: a task Marta only created is listed
  // when she can read it, in the top tasks and in the tasks closed in the week.
  const scheduled = new ScheduledNotificationsService(none, none, none, none, none, none);
  const week = { start: new Date(Date.now() - 7 * 86400000).toISOString(), end: new Date(Date.now() + 86400000).toISOString() };
  const top = await scheduled.weeklyReviewTasks(runner.manager, s.tenantId, marta, week.start, week.end);
  assert.deepEqual(sorted(top.topTasks.map((r) => r.id)), sorted([t.l4ByMarta, t.free]), 'weekly review: the L1 task Marta created is not listed to her');
  await as(runner, null, async (m) => {
    await m.query(`UPDATE tasks SET status = 'done', updated_at = now() WHERE tenant_id = $1`, [s.tenantId]);
    const closed = await scheduled.weeklyReviewTasks(m, s.tenantId, marta, week.start, week.end);
    assert.deepEqual(sorted(closed.tasksClosed.map((r) => r.id)), sorted([t.l4ByMarta, t.free]), 'weekly review, closed tasks: nor the closed one');
    // Paul is the L1 task's owner: named, it is listed to him whatever his access.
    const paulClosed = await scheduled.weeklyReviewTasks(m, s.tenantId, paul, week.start, week.end);
    assert.deepEqual(paulClosed.tasksClosed.map((r) => r.id), [t.l1ByMarta], 'weekly review: a named person is listed');
  });
  console.log('  notifications: named persons always, the creator of a line task only when she can read it (recipients, comment, weekly review): OK');
}

async function testShare(runner: QueryRunner, s: Seed, t: Tasks): Promise<void> {
  const { marta, nina, paul, ulla } = s.persons;
  await runner.query(`UPDATE users SET first_name = 'Nina', last_name = 'Noel' WHERE id = $1`, [nina]);
  const users: Array<{ userId: string; email: string; firstName: string | null; lastName: string | null }> = await runner.query(
    `SELECT id AS "userId", email, first_name AS "firstName", last_name AS "lastName" FROM users WHERE id = ANY($1::uuid[])`,
    [[marta, nina, paul, ulla]],
  );
  const row = (id: string) => ({ ...users.find((u) => u.userId === id)! });
  const nameOf = (id: string) => (id === nina ? 'Nina Noel' : row(id).email);

  const shares: any[] = [];
  const unified = new TasksUnifiedService(
    runner.manager.getRepository(Task), none, none, none, { notifyShare: (p: any) => { shares.push(p); } } as any, none, none, none, none,
  );
  // Marta shares the L4 task (she reads L4) with Nina (assignee), Paul (reads L4), Ulla and an address.
  const out = await as(runner, marta, (m) => unified.share(
    t.l4ByMarta, { recipient_user_ids: [nina, paul, ulla], recipient_emails: ['buyer@example.invalid'] } as any, s.tenantId, marta, { manager: m },
  ));
  assert.deepEqual(out, { success: true, cannot_open: [] }, 'the L4 task: everyone chosen can open it');
  assert.equal(shares.length, 1);
  assert.deepEqual(sorted(shares[0].recipients.map((r: any) => r.userId)), sorted([nina, paul, ulla]), 'sent to all');

  // Paul shares the L1 task: Marta only created it, she cannot open it; sent anyway.
  const paulShare = await as(runner, paul, (m) => unified.share(
    t.l1ByMarta, { recipient_user_ids: [marta, ulla] } as any, s.tenantId, paul, { manager: m },
  ));
  assert.deepEqual(paulShare, { success: true, cannot_open: [{ id: marta, name: nameOf(marta) }] }, 'Marta cannot open the L1 task');
  assert.deepEqual(sorted(shares[1].recipients.map((r: any) => r.userId)), sorted([marta, ulla]), 'never blocked');

  // Marta takes part in a task of L1, a line she cannot read: sharing it says nothing of who can
  // open it (that would tell where L1 sits); sent to all the same.
  const l1ForMarta = (await runner.query(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, creator_id, assignee_user_id)
     VALUES ($1, 'L1 task for Marta', $2, 'spend_item', $3, $4, $5) RETURNING id`,
    [s.tenantId, nextItemNumber(), s.lines.L1, ulla, marta],
  ))[0].id as string;
  const hiddenLine = await as(runner, marta, (m) => unified.share(
    l1ForMarta, { recipient_user_ids: [nina, paul] } as any, s.tenantId, marta, { manager: m },
  ));
  assert.deepEqual(hiddenLine, { success: true }, 'a task of a line hidden to the sender: no cannot_open list');
  assert.deepEqual(sorted(shares[2].recipients.map((r: any) => r.userId)), sorted([nina, paul]), 'sent to all');

  // A line, through its share route: Paul shares L4 with Nina (no access) and Marta; sent to both.
  const lines = new SpendItemsService(
    runner.manager.getRepository(SpendItem), none, none, none, none, none, none, none, none, { notifyShare: (p: any) => { shares.push(p); } } as any, none,
  );
  const line = await as(runner, paul, (m) => lines.share(s.lines.L4, { recipient_user_ids: [nina, marta] } as any, s.tenantId, paul, { manager: m }));
  assert.deepEqual(line, { success: true, cannot_open: [{ id: nina, name: 'Nina Noel' }] }, 'L4: Nina cannot open it, named by her name');
  assert.deepEqual(sorted(shares[shares.length - 1].recipients.map((r: any) => r.userId)), sorted([nina, marta]), 'the line: sent to both');
  // Ulla (unscoped sender) shares L1 with Marta.
  const unscoped = await as(runner, ulla, (m) => shareRecipientsWhoCannotOpen(m, 'spend_item', s.lines.L1, [row(marta), row(paul)]));
  assert.deepEqual(unscoped, [{ id: marta, name: nameOf(marta) }], 'an unscoped sender is warned too');
  // A sender asking about a line out of her access learns nothing.
  const blind = await as(runner, marta, (m) => shareRecipientsWhoCannotOpen(m, 'spend_item', s.lines.L1, [row(nina)]));
  assert.deepEqual(blind, [], 'Marta cannot see L1: no answer');
  // A contract (lot 5): a limited sender who cannot see it learns nothing; an unscoped sender is
  // warned about a person who cannot open it.
  const supplier = (await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Share supplier') RETURNING id`, [s.tenantId]))[0].id;
  const contract = (await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Share contract', $2, $3, '2026-01-01') RETURNING id`,
    [s.tenantId, s.fr, supplier],
  ))[0].id;
  assert.deepEqual(await as(runner, marta, (m) => shareRecipientsWhoCannotOpen(m, 'contract', contract, [row(nina)])), [], 'Marta cannot see the contract: no answer');
  assert.deepEqual(
    await as(runner, ulla, (m) => shareRecipientsWhoCannotOpen(m, 'contract', contract, [row(nina)])),
    [{ id: nina, name: nameOf(nina) }],
    'an unscoped sender: Nina cannot open the contract',
  );
  console.log('  "Send the link": cannot_open names the chosen persons who cannot open the task or line; sent to all; nothing about a hidden object: OK');
}

async function testRecentItems(runner: QueryRunner, s: Seed, t: Tasks): Promise<void> {
  const items = [
    { type: 'spend_item', id: s.lines.L1 },
    { type: 'spend_item', id: s.lines.L4 },
    { type: 'capex_item', id: s.lines.L2 },
    { type: 'spend_item', id: randomUUID() },
    { type: 'task', id: t.l1ByUlla },
    { type: 'task', id: t.l4ByMarta },
    { type: 'task', id: t.free },
  ];
  const confirmed = async (person: string) => as(runner, person, async (m) =>
    sorted((await existingRecentItems(m, s.tenantId, items)).existing.map((r) => `${r.type}:${r.id}`)));
  assert.deepEqual(await confirmed(s.persons.marta), sorted([
    `spend_item:${s.lines.L4}`, `capex_item:${s.lines.L2}`, `task:${t.l4ByMarta}`, `task:${t.free}`,
  ]), 'Marta: L1 and the task of L1 she is not named on are not confirmed');
  assert.deepEqual(await confirmed(s.persons.ulla), sorted([
    `spend_item:${s.lines.L1}`, `spend_item:${s.lines.L4}`, `capex_item:${s.lines.L2}`,
    `task:${t.l1ByUlla}`, `task:${t.l4ByMarta}`, `task:${t.free}`,
  ]), 'Ulla: every existing record');
  console.log('  recent items: only the visible records come back to a limited person; everything existing to Ulla: OK');
}

async function testHistory(runner: QueryRunner, s: Seed, t: Tasks): Promise<void> {
  const activities = new TaskActivitiesService(
    runner.manager.getRepository(PortfolioActivity), runner.manager.getRepository(Task), none, none, none,
  );
  await runner.query(
    `INSERT INTO portfolio_activities (tenant_id, task_id, type, content) VALUES ($1, $2, 'comment', 'About L1')`,
    [s.tenantId, t.l1ByUlla],
  );
  await as(runner, s.persons.marta, async (m) => {
    const hidden = await rejection(() => activities.listForTask(t.l1ByUlla, { manager: m }));
    const random = await rejection(() => activities.listForTask(randomUUID(), { manager: m }));
    assert.ok(hidden instanceof NotFoundException, 'task history of a hidden task: 404');
    assert.ok(random instanceof NotFoundException, 'task history of a random id: the same 404');
    assert.equal((hidden as NotFoundException).message, (random as NotFoundException).message, 'the same message');
    assert.ok(Array.isArray(await activities.listForTask(t.l4ByMarta, { manager: m })), 'a visible task: its history');

    assert.equal(await readBudgetLineMeta(m, 'opex', s.tenantId, s.lines.L1), null, 'line meta of a hidden line: none (404)');
    assert.equal(await readBudgetLineMeta(m, 'opex', s.tenantId, randomUUID()), null, 'line meta of a random id: none (404)');
    assert.ok(await readBudgetLineMeta(m, 'opex', s.tenantId, s.lines.L4), 'a visible line: its meta');
  });
  await as(runner, s.persons.ulla, async (m) => {
    const rows = await activities.listForTask(t.l1ByUlla, { manager: m });
    assert.equal(rows.length, 1, 'Ulla reads the history of the L1 task');
  });
  console.log('  object history: a hidden task or line answers as a random id (404); visible objects answer: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access notifications: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access notifications, share, recent items, history (lot 4, run 4C)');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      const t = await seedTasks(runner, s);
      await testNotificationRecipients(runner, s, t);
      await testShare(runner, s, t);
      await testRecentItems(runner, s, t);
      await testHistory(runner, s, t);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
