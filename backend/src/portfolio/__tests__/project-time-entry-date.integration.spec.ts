// @database-spec
import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioTimesheetService, localTodayYmd } from '../services/portfolio-timesheet.service';
import { UserTimeAggregateService } from '../services/user-time-aggregate.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// A project time entry takes a calendar day. A day ten days ago is stored and counted in its
// month; an invalid day or a future day is refused. Moving the day moves the monthly aggregate.

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The 15th of the month before `ymd`, always a different month and in the past. */
function previousMonthMid(ymd: string): string {
  const [year, month] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 15)).toISOString().slice(0, 10);
}

function monthOf(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function service(runner: QueryRunner) {
  return new PortfolioTimesheetService(
    runner.manager.getRepository(PortfolioProject),
    { log: async () => undefined } as any,
    new UserTimeAggregateService(),
  );
}

async function seedProject(runner: QueryRunner, tenantId: string): Promise<{ projectId: string; userId: string }> {
  const roleId = (await runner.query(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Member') RETURNING id`,
    [tenantId],
  ))[0].id as string;
  const userId = (await runner.query(
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name)
     VALUES ($1, $2, $3, 'Ada', 'Martin') RETURNING id`,
    [tenantId, `time-${tenantId.slice(0, 8)}@example.test`, roleId],
  ))[0].id as string;
  const projectId = (await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number)
     VALUES ($1, 'Time project', 1) RETURNING id`,
    [tenantId],
  ))[0].id as string;
  return { projectId, userId };
}

async function months(runner: QueryRunner, userId: string): Promise<Array<{ month: string; hours: number }>> {
  const rows: Array<{ month: string; hours: string }> = await runner.query(
    `SELECT to_char(year_month, 'YYYY-MM-DD') AS month, project_hours::float AS hours
     FROM user_time_monthly_aggregates
     WHERE user_id = $1
     ORDER BY 1`,
    [userId],
  );
  return rows.map((row) => ({ month: row.month, hours: Number(row.hours) }));
}

async function storedDay(runner: QueryRunner, entryId: string): Promise<string> {
  const rows: Array<{ day: string }> = await runner.query(
    `SELECT to_char(logged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
     FROM portfolio_project_time_entries WHERE id = $1`,
    [entryId],
  );
  return rows[0].day;
}

async function refusal(fn: () => Promise<unknown>): Promise<BadRequestException> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof BadRequestException, `expected a 400, got ${(err as Error).message}`);
    assert.equal((err as BadRequestException).getStatus(), 400);
    return err as BadRequestException;
  }
  throw new Error('expected a refusal');
}

async function testBackdatedEntryIsCountedInItsMonth() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'time-day');
    const { projectId, userId } = await seedProject(runner, tenantId);
    const svc = service(runner);
    const day = addDays(localTodayYmd(), -10);
    const opts = { manager: runner.manager };

    const created = await svc.createTimeEntry(
      projectId,
      { category: 'it', user_id: userId, hours: 4, logged_at: day },
      tenantId,
      userId,
      opts,
    );
    assert.equal(await storedDay(runner, created.id), day);
    assert.deepEqual(await months(runner, userId), [{ month: monthOf(day), hours: 4 }]);

    const moved = previousMonthMid(day);
    await svc.updateTimeEntry(created.id, { logged_at: moved }, userId, false, opts);
    assert.equal(await storedDay(runner, created.id), moved);
    assert.deepEqual(await months(runner, userId), [{ month: monthOf(moved), hours: 4 }]);
  });
}

async function testInvalidOrFutureDateIsRefused() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'time-refuse');
    const { projectId, userId } = await seedProject(runner, tenantId);
    const svc = service(runner);
    const day = addDays(localTodayYmd(), -10);
    const opts = { manager: runner.manager };
    const created = await svc.createTimeEntry(
      projectId,
      { category: 'it', user_id: userId, hours: 2, logged_at: day },
      tenantId,
      userId,
      opts,
    );

    const create = (loggedAt: string) => svc.createTimeEntry(
      projectId,
      { category: 'it', user_id: userId, hours: 1, logged_at: loggedAt },
      tenantId,
      userId,
      opts,
    );
    const missing = await refusal(() => create(''));
    assert.match(missing.message, /required/);
    const invalid = await refusal(() => create('2026-02-31'));
    assert.match(invalid.message, /YYYY-MM-DD/);
    const stamped = await refusal(() => create(`${day}T00:00:00.000Z`));
    assert.match(stamped.message, /YYYY-MM-DD/);
    const future = await refusal(() => create(addDays(localTodayYmd(), 1)));
    assert.match(future.message, /future/);
    const moved = await refusal(() => svc.updateTimeEntry(
      created.id,
      { logged_at: addDays(localTodayYmd(), 1) },
      userId,
      false,
      opts,
    ));
    assert.match(moved.message, /future/);
    assert.equal(await storedDay(runner, created.id), day, 'a refused update leaves the day');
    assert.deepEqual(await months(runner, userId), [{ month: monthOf(day), hours: 2 }]);
  });
}

runSpecs('project time entry date', [
  ['a day ten days ago is stored and counted in its month', testBackdatedEntryIsCountedInItsMonth],
  ['an invalid or future day is refused', testInvalidOrFutureDateIsRefused],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
