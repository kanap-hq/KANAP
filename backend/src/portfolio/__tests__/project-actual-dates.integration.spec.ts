// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import {
  inRolledBackTransaction,
  managedDocumentServices,
  seedCreationTenant,
} from '../../common/creation/__tests__/creation-cancel.fixtures';
import { portfolioProjectCsvConfig } from '../portfolio-project-csv.config';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';
import { PortfolioStatusService } from '../services/portfolio-status.service';

// Actual start and actual end come from the status (In progress, Done) and from the projects
// import. Creation and update refuse both fields. The actual start is written once, the first
// time the project moves to In progress: a resume after On hold or In testing keeps that date.
// The baseline (planned dates and estimated effort) is captured the same way: the first move
// to In progress stores it, and a later return keeps it. A project with no baseline stored
// still gets one from its current plan.

const PAST_START = '2020-01-15';
const importer = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());

function crudFor(runner: QueryRunner) {
  const manager = runner.manager;
  return new PortfolioProjectsCrudService(
    undefined as any,
    undefined as any,
    new AuditService(manager.getRepository(AuditLog)),
    undefined as any,
    { getProjectRecipients: async () => [], notifyStatusChange: () => undefined, notifyTeamAdded: () => undefined } as any,
    new ItemNumberService() as any,
    managedDocumentServices(manager),
  );
}

function statusFor(runner: QueryRunner) {
  return new PortfolioStatusService(
    undefined as any,
    undefined as any,
    { getProjectRecipients: async () => [], notifyStatusChange: () => undefined, notifyComment: () => undefined } as any,
    new AuditService(runner.manager.getRepository(AuditLog)),
  );
}

function messageOf(err: unknown): string {
  if (!(err instanceof BadRequestException)) return '';
  const response = err.getResponse();
  return `${err.message} ${typeof response === 'string' ? response : JSON.stringify(response)}`;
}

async function expectRefused(run: () => Promise<unknown>, field: string) {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof BadRequestException, `expected 400, got ${err}`);
    assert.match(messageOf(err), new RegExp(`\\b${field}\\b`));
    return true;
  });
}

async function datesOf(runner: QueryRunner, id: string) {
  const [row] = await runner.query(
    `SELECT name, status,
            to_char(actual_start, 'YYYY-MM-DD') AS actual_start,
            to_char(actual_end, 'YYYY-MM-DD') AS actual_end
     FROM portfolio_projects WHERE id = $1`,
    [id],
  );
  return row as { name: string; status: string; actual_start: string | null; actual_end: string | null };
}

async function projectReady(
  crud: PortfolioProjectsCrudService,
  runner: QueryRunner,
  tenantId: string,
  creatorId: string,
  name: string,
) {
  const opts = { manager: runner.manager };
  const created: { id: string } = await crud.create({
    name,
    origin: 'fast_track',
    planned_start: '2024-03-01',
    planned_end: '2024-09-30',
    estimated_effort_it: 12,
  } as any, tenantId, creatorId, opts);
  return created;
}

async function testCreateAndUpdateRefuseActualDates() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId } = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const crud = crudFor(runner);
    const opts = { manager: runner.manager };

    await expectRefused(
      () => crud.create({ name: 'Refused start', origin: 'fast_track', actual_start: '2020-01-01' } as any, tenantId, creatorId, opts),
      'actual_start',
    );
    await expectRefused(
      () => crud.create({ name: 'Refused end', origin: 'fast_track', actual_end: '2020-06-01' } as any, tenantId, creatorId, opts),
      'actual_end',
    );
    const [created] = await runner.query(
      `SELECT count(*)::int AS n FROM portfolio_projects WHERE tenant_id = $1 AND name IN ('Refused start', 'Refused end')`,
      [tenantId],
    );
    assert.equal(created.n, 0, 'a refused creation writes nothing');

    const project = await projectReady(crud, runner, tenantId, creatorId, 'Dates stay');
    const before = await datesOf(runner, project.id);
    await expectRefused(
      () => crud.update(project.id, { name: 'Renamed by start', actual_start: '2020-01-01' } as any, tenantId, creatorId, opts),
      'actual_start',
    );
    await expectRefused(
      () => crud.update(project.id, { name: 'Renamed by end', actual_end: '2020-06-01' } as any, tenantId, creatorId, opts),
      'actual_end',
    );
    assert.deepEqual(await datesOf(runner, project.id), before, 'a refused update writes nothing');

    await expectRefused(
      () => crud.convertFromRequest(randomUUID(), { actual_start: '2020-01-01', actual_end: '2020-06-01' } as any, tenantId, creatorId, opts),
      'actual_start',
    );
  });
}

async function moveByUpdate(
  crud: PortfolioProjectsCrudService,
  id: string,
  status: string,
  tenantId: string,
  userId: string,
  runner: QueryRunner,
) {
  await crud.update(id, { status } as any, tenantId, userId, { manager: runner.manager });
}

async function testUpdateKeepsTheFirstActualStart() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId } = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const crud = crudFor(runner);
    const project = await projectReady(crud, runner, tenantId, creatorId, 'Resume by update');

    await moveByUpdate(crud, project.id, 'in_progress', tenantId, creatorId, runner);
    const started = await datesOf(runner, project.id);
    assert.equal(started.status, 'in_progress');
    assert.ok(started.actual_start, 'the first move to In progress sets the actual start');
    assert.equal(started.actual_end, null);

    await runner.query(`UPDATE portfolio_projects SET actual_start = $2 WHERE id = $1`, [project.id, PAST_START]);
    await moveByUpdate(crud, project.id, 'on_hold', tenantId, creatorId, runner);
    await moveByUpdate(crud, project.id, 'in_progress', tenantId, creatorId, runner);
    assert.equal((await datesOf(runner, project.id)).actual_start, PAST_START, 'a resume after On hold keeps the first actual start');

    await moveByUpdate(crud, project.id, 'in_testing', tenantId, creatorId, runner);
    await moveByUpdate(crud, project.id, 'in_progress', tenantId, creatorId, runner);
    assert.equal((await datesOf(runner, project.id)).actual_start, PAST_START, 'a return from In testing keeps the first actual start');

    await moveByUpdate(crud, project.id, 'done', tenantId, creatorId, runner);
    const done = await datesOf(runner, project.id);
    assert.equal(done.status, 'done');
    assert.equal(done.actual_start, PAST_START);
    assert.ok(done.actual_end, 'moving to Done sets the actual end');
  });
}

async function decide(
  status: PortfolioStatusService,
  id: string,
  newStatus: string,
  tenantId: string,
  userId: string,
  runner: QueryRunner,
) {
  await status.addComment(id, 'Status decision', null, tenantId, userId, {
    manager: runner.manager,
    isDecision: true,
    newStatus,
  });
}

const FIRST_PLAN = {
  planned_start: '2024-03-01',
  planned_end: '2024-09-30',
  estimated_effort_it: 12,
  estimated_effort_business: 4,
};

const REVISED_PLAN = {
  planned_start: '2024-04-10',
  planned_end: '2024-12-15',
  estimated_effort_it: 20,
  estimated_effort_business: 9,
};

const REPLACEMENT_PLAN = {
  planned_start: '2025-01-06',
  planned_end: '2025-06-30',
  estimated_effort_it: 7,
  estimated_effort_business: 2,
};

const EMPTY_BASELINE = {
  baseline_start_date: null,
  baseline_end_date: null,
  baseline_effort_it: null,
  baseline_effort_business: null,
};

type Plan = {
  planned_start: string;
  planned_end: string;
  estimated_effort_it: number;
  estimated_effort_business: number;
};

function baselineFrom(plan: Plan) {
  return {
    baseline_start_date: plan.planned_start,
    baseline_end_date: plan.planned_end,
    baseline_effort_it: plan.estimated_effort_it,
    baseline_effort_business: plan.estimated_effort_business,
  };
}

async function planAndBaseline(runner: QueryRunner, id: string) {
  const [row] = await runner.query(
    `SELECT status,
            to_char(planned_start, 'YYYY-MM-DD') AS planned_start,
            to_char(planned_end, 'YYYY-MM-DD') AS planned_end,
            estimated_effort_it::float AS estimated_effort_it,
            estimated_effort_business::float AS estimated_effort_business,
            to_char(baseline_start_date, 'YYYY-MM-DD') AS baseline_start_date,
            to_char(baseline_end_date, 'YYYY-MM-DD') AS baseline_end_date,
            baseline_effort_it::float AS baseline_effort_it,
            baseline_effort_business::float AS baseline_effort_business
     FROM portfolio_projects WHERE id = $1`,
    [id],
  );
  return row as {
    status: string;
    planned_start: string;
    planned_end: string;
    estimated_effort_it: number;
    estimated_effort_business: number;
    baseline_start_date: string | null;
    baseline_end_date: string | null;
    baseline_effort_it: number | null;
    baseline_effort_business: number | null;
  };
}

function storedBaseline(row: Awaited<ReturnType<typeof planAndBaseline>>) {
  return {
    baseline_start_date: row.baseline_start_date,
    baseline_end_date: row.baseline_end_date,
    baseline_effort_it: row.baseline_effort_it,
    baseline_effort_business: row.baseline_effort_business,
  };
}

function storedPlan(row: Awaited<ReturnType<typeof planAndBaseline>>): Plan {
  return {
    planned_start: row.planned_start,
    planned_end: row.planned_end,
    estimated_effort_it: row.estimated_effort_it,
    estimated_effort_business: row.estimated_effort_business,
  };
}

async function projectWithPlan(
  crud: PortfolioProjectsCrudService,
  runner: QueryRunner,
  tenantId: string,
  creatorId: string,
  name: string,
  plan: Plan,
) {
  return crud.create({
    name,
    origin: 'fast_track',
    ...plan,
  } as any, tenantId, creatorId, { manager: runner.manager }) as Promise<{ id: string }>;
}

async function setPlan(
  crud: PortfolioProjectsCrudService,
  id: string,
  plan: Plan,
  tenantId: string,
  userId: string,
  runner: QueryRunner,
) {
  await crud.update(id, { ...plan } as any, tenantId, userId, { manager: runner.manager });
}

async function clearBaseline(runner: QueryRunner, id: string) {
  await runner.query(
    `UPDATE portfolio_projects
     SET baseline_start_date = NULL, baseline_end_date = NULL,
         baseline_effort_it = NULL, baseline_effort_business = NULL
     WHERE id = $1`,
    [id],
  );
}

// Both status paths (the project update and a decision) capture the baseline once.
async function keepsTheFirstBaseline(
  runner: QueryRunner,
  tenantId: string,
  creatorId: string,
  crud: PortfolioProjectsCrudService,
  name: string,
  move: (id: string, status: string) => Promise<void>,
) {
  const project = await projectWithPlan(crud, runner, tenantId, creatorId, name, FIRST_PLAN);
  assert.deepEqual(storedBaseline(await planAndBaseline(runner, project.id)), EMPTY_BASELINE, 'a new project stores no baseline');

  await move(project.id, 'in_progress');
  const captured = await planAndBaseline(runner, project.id);
  assert.equal(captured.status, 'in_progress');
  assert.deepEqual(storedBaseline(captured), baselineFrom(FIRST_PLAN), 'the first move to In progress captures the four baseline fields');

  await setPlan(crud, project.id, REVISED_PLAN, tenantId, creatorId, runner);
  const revised = await planAndBaseline(runner, project.id);
  assert.deepEqual(storedPlan(revised), REVISED_PLAN, 'the plan changes after the baseline is stored');
  assert.deepEqual(storedBaseline(revised), baselineFrom(FIRST_PLAN), 'changing the plan leaves the baseline');

  await move(project.id, 'on_hold');
  await move(project.id, 'in_progress');
  assert.deepEqual(storedBaseline(await planAndBaseline(runner, project.id)), baselineFrom(FIRST_PLAN), 'a return from On hold keeps the first baseline');

  await move(project.id, 'in_testing');
  await move(project.id, 'in_progress');
  assert.deepEqual(storedBaseline(await planAndBaseline(runner, project.id)), baselineFrom(FIRST_PLAN), 'a return from In testing keeps the first baseline');

  await move(project.id, 'on_hold');
  await move(project.id, 'waiting_list');
  await move(project.id, 'in_progress');
  assert.deepEqual(storedBaseline(await planAndBaseline(runner, project.id)), baselineFrom(FIRST_PLAN), 'a return from the waiting list keeps the first baseline');

  await move(project.id, 'on_hold');
  await move(project.id, 'planned');
  await move(project.id, 'in_progress');
  assert.deepEqual(storedBaseline(await planAndBaseline(runner, project.id)), baselineFrom(FIRST_PLAN), 'a return from Planned keeps the first baseline');

  await move(project.id, 'on_hold');
  await clearBaseline(runner, project.id);
  await setPlan(crud, project.id, REPLACEMENT_PLAN, tenantId, creatorId, runner);
  assert.deepEqual(storedBaseline(await planAndBaseline(runner, project.id)), EMPTY_BASELINE, 'the four baseline fields can be absent');
  await move(project.id, 'in_progress');
  const recaptured = await planAndBaseline(runner, project.id);
  assert.equal(recaptured.status, 'in_progress');
  assert.deepEqual(storedPlan(recaptured), REPLACEMENT_PLAN);
  assert.deepEqual(storedBaseline(recaptured), baselineFrom(REPLACEMENT_PLAN), 'a move to In progress with no baseline stored captures the current plan');
}

async function testUpdateKeepsTheFirstBaseline() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId } = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const crud = crudFor(runner);
    await keepsTheFirstBaseline(runner, tenantId, creatorId, crud, 'Baseline by update', (id, status) =>
      moveByUpdate(crud, id, status, tenantId, creatorId, runner),
    );
  });
}

async function testDecisionKeepsTheFirstBaseline() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId } = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const crud = crudFor(runner);
    const decisions = statusFor(runner);
    await keepsTheFirstBaseline(runner, tenantId, creatorId, crud, 'Baseline by decision', (id, status) =>
      decide(decisions, id, status, tenantId, creatorId, runner),
    );
  });
}

async function testDecisionKeepsTheFirstActualStart() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId } = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const crud = crudFor(runner);
    const status = statusFor(runner);
    const project = await projectReady(crud, runner, tenantId, creatorId, 'Resume by decision');

    await decide(status, project.id, 'in_progress', tenantId, creatorId, runner);
    assert.ok((await datesOf(runner, project.id)).actual_start, 'the first decision to In progress sets the actual start');

    await runner.query(`UPDATE portfolio_projects SET actual_start = $2 WHERE id = $1`, [project.id, PAST_START]);
    await decide(status, project.id, 'on_hold', tenantId, creatorId, runner);
    await decide(status, project.id, 'in_progress', tenantId, creatorId, runner);
    const resumed = await datesOf(runner, project.id);
    assert.equal(resumed.status, 'in_progress');
    assert.equal(resumed.actual_start, PAST_START, 'a decision that resumes the project keeps the first actual start');

    await decide(status, project.id, 'done', tenantId, creatorId, runner);
    const done = await datesOf(runner, project.id);
    assert.equal(done.actual_start, PAST_START);
    assert.ok(done.actual_end, 'a decision that moves the project to Done sets the actual end');
  });
}

function csvFile(text: string): Express.Multer.File {
  const content = '﻿' + text;
  return { buffer: Buffer.from(content, 'utf8'), originalname: 'projects.csv', mimetype: 'text/csv', size: content.length } as Express.Multer.File;
}

async function testImportWritesActualDates() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId } = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const loaded = await importer.import(
      portfolioProjectCsvConfig,
      csvFile('name;status;actual_start;actual_end\nCellar sensors;planned;2020-01-15;2021-06-30'),
      { dryRun: false, operation: 'upsert' },
      { manager: runner.manager, tenantId, userId: null, isAdmin: true },
    );
    assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
    assert.equal(loaded.inserted, 1);
    const [row] = await runner.query(
      `SELECT to_char(actual_start, 'YYYY-MM-DD') AS actual_start,
              to_char(actual_end, 'YYYY-MM-DD') AS actual_end
       FROM portfolio_projects WHERE tenant_id = $1 AND name = 'Cellar sensors'`,
      [tenantId],
    );
    assert.deepEqual(row, { actual_start: '2020-01-15', actual_end: '2021-06-30' });
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testCreateAndUpdateRefuseActualDates();
    console.log('  ok testCreateAndUpdateRefuseActualDates');
    await testUpdateKeepsTheFirstActualStart();
    console.log('  ok testUpdateKeepsTheFirstActualStart');
    await testDecisionKeepsTheFirstActualStart();
    console.log('  ok testDecisionKeepsTheFirstActualStart');
    await testUpdateKeepsTheFirstBaseline();
    console.log('  ok testUpdateKeepsTheFirstBaseline');
    await testDecisionKeepsTheFirstBaseline();
    console.log('  ok testDecisionKeepsTheFirstBaseline');
    await testImportWritesActualDates();
    console.log('  ok testImportWritesActualDates');
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
  console.log('project-actual-dates.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
