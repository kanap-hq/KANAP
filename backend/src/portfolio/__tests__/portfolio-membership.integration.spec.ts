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
import { inRolledBackTransaction, managedDocumentServices, seedCreationTenant } from '../../common/creation/__tests__/creation-cancel.fixtures';
import { PortfolioRequest } from '../portfolio-request.entity';
import { PortfolioRequestsService } from '../portfolio-requests.service';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';
import { TeamMemberConfigService } from '../team-member-config.service';
import { TeamMemberConfig } from '../team-member-config.entity';
import { Task } from '../../tasks/task.entity';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';

// A stream belongs to its category, a department to its company (lot I7a of 26.12.1, P13), through the
// API: requests, projects (create, update, conversion of a request), tasks, contributors' defaults and
// people. The child gives its parent; a pair that contradicts itself is a 400 naming the child and both
// parents; a category changed alone drops a stream of another category (the screen used to hide that
// the server never did); a record saved before the rule stays writable while its pair is not touched.

type Seed = Awaited<ReturnType<typeof seed>>;

async function seed(runner: QueryRunner) {
  const base = await seedCreationTenant(runner, { portfolio_projects: 'admin', portfolio_requests: 'admin', tasks: 'admin' });
  const { tenantId } = base;
  const id = () => randomUUID();
  const ids = { it: id(), biz: id(), opsIt: id(), opsBiz: id(), devIt: id(), companyA: id(), companyB: id(), finA: id(), finB: id() };
  await runner.query(`INSERT INTO portfolio_categories (id, tenant_id, name) VALUES ($1, $3, 'IT'), ($2, $3, 'Business')`, [ids.it, ids.biz, tenantId]);
  await runner.query(
    `INSERT INTO portfolio_streams (id, tenant_id, category_id, name) VALUES ($1, $4, $5, 'Ops'), ($2, $4, $6, 'Ops'), ($3, $4, $5, 'Dev')`,
    [ids.opsIt, ids.opsBiz, ids.devIt, tenantId, ids.it, ids.biz],
  );
  await runner.query(
    `INSERT INTO companies (id, tenant_id, name, country_iso, city) VALUES ($1, $3, 'Alpha', 'FR', 'Lyon'), ($2, $3, 'Beta', 'FR', 'Brest')`,
    [ids.companyA, ids.companyB, tenantId],
  );
  await runner.query(
    `INSERT INTO departments (id, tenant_id, company_id, name) VALUES ($1, $3, $4, 'Finance'), ($2, $3, $5, 'Finance')`,
    [ids.finA, ids.finB, tenantId, ids.companyA, ids.companyB],
  );
  return { ...base, ids };
}

function services(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const documents = managedDocumentServices(manager);
  const quiet = { notifyTeamAdded: () => undefined, notifyItLeadOfTeamChange: () => undefined, getProjectRecipients: async () => [], notifyStatusChange: () => undefined };
  const requests = new PortfolioRequestsService(
    manager.getRepository(PortfolioRequest), audit, {} as any, {} as any, {} as any, quiet as any, new ItemNumberService(), {} as any, documents,
  );
  const projects = new PortfolioProjectsCrudService(
    manager.getRepository(PortfolioProject),
    manager.getRepository(PortfolioRequest),
    audit,
    { calculateEffortFromCriteria: async () => ({ estimated_effort_it: null, estimated_effort_business: null }) } as any,
    quiet as any,
    new ItemNumberService(),
    documents,
  );
  const tasks = new TasksUnifiedService(
    manager.getRepository(Task), audit, undefined as any, undefined as any, quiet as any, new ItemNumberService(),
    { logChange: async () => undefined } as any, undefined as any, undefined as any,
  );
  return { requests, projects, tasks, audit };
}

/** A 400 of `code`, naming the child and both parents. */
async function refused(write: Promise<unknown>, code: string, params: Record<string, string>) {
  await assert.rejects(write, (error: unknown) => {
    assert.ok(error instanceof BadRequestException, String(error));
    const body = (error as BadRequestException).getResponse() as any;
    assert.equal(body.code, code);
    assert.deepEqual(body.params, params);
    return true;
  });
}

async function row(runner: QueryRunner, table: string, id: string) {
  const columns = table === 'tasks' ? 'category_id, stream_id' : 'category_id, stream_id, company_id, department_id';
  const [stored] = await runner.query(`SELECT ${columns} FROM ${table} WHERE id = $1`, [id]);
  return stored;
}

/** Requests and projects: the same rule on create and update. */
async function testRequestsAndProjects() {
  await inRolledBackTransaction(async (runner) => {
    const data: Seed = await seed(runner);
    const { ids, tenantId, creatorId } = data;
    const { requests, projects } = services(runner);
    const opts = { manager: runner.manager };
    const families = [
      { table: 'portfolio_requests', create: (body: any) => requests.create(body, tenantId, creatorId, opts), update: (id: string, body: any) => requests.update(id, body, tenantId, creatorId, opts) },
      { table: 'portfolio_projects', create: (body: any) => projects.create({ origin: 'fast_track', ...body }, tenantId, creatorId, opts), update: (id: string, body: any) => projects.update(id, body, tenantId, creatorId, opts) },
    ];
    for (const family of families) {
      const label = family.table;
      // With the parent, and without it: the child gives its parent.
      const both: any = await family.create({ name: `${label} both`, category_id: ids.it, stream_id: ids.opsIt, company_id: ids.companyA, department_id: ids.finA });
      assert.deepEqual(await row(runner, family.table, both.id), { category_id: ids.it, stream_id: ids.opsIt, company_id: ids.companyA, department_id: ids.finA }, `${label}: with the parents`);
      const filled: any = await family.create({ name: `${label} filled`, stream_id: ids.opsBiz, department_id: ids.finB });
      assert.deepEqual(await row(runner, family.table, filled.id), { category_id: ids.biz, stream_id: ids.opsBiz, company_id: ids.companyB, department_id: ids.finB }, `${label}: the parents filled`);
      // A contradictory pair is refused, naming the child and both parents.
      await refused(family.create({ name: `${label} wrong`, category_id: ids.it, stream_id: ids.opsBiz }), 'STREAM_OUTSIDE_CATEGORY', { child: 'Ops', childParent: 'Business', parent: 'IT' });
      await refused(family.update(both.id, { department_id: ids.finB }), 'DEPARTMENT_OUTSIDE_COMPANY', { child: 'Finance', childParent: 'Beta', parent: 'Alpha' });
      await refused(family.update(both.id, { stream_id: ids.opsBiz }), 'STREAM_OUTSIDE_CATEGORY', { child: 'Ops', childParent: 'Business', parent: 'IT' });
      // The stream alone, in the record's category.
      await family.update(both.id, { stream_id: ids.devIt });
      assert.equal((await row(runner, family.table, both.id)).stream_id, ids.devIt, `${label}: the stream alone`);
      // The category changed alone drops the stream; the company changed alone drops the department.
      await family.update(both.id, { category_id: ids.biz, company_id: ids.companyB });
      assert.deepEqual(await row(runner, family.table, both.id), { category_id: ids.biz, stream_id: null, company_id: ids.companyB, department_id: null }, `${label}: the children dropped`);
      // A record saved before the rule: written on another field, and with its own pair sent again.
      await runner.query(`UPDATE ${family.table} SET category_id = $2, stream_id = $3 WHERE id = $1`, [filled.id, ids.it, ids.opsBiz]);
      await family.update(filled.id, { name: `${label} renamed` });
      await family.update(filled.id, { name: `${label} renamed again`, category_id: ids.it, stream_id: ids.opsBiz });
      assert.deepEqual(await row(runner, family.table, filled.id), { category_id: ids.it, stream_id: ids.opsBiz, company_id: ids.companyB, department_id: ids.finB }, `${label}: a stored disagreement stays`);
      // Its category set to the stream's one: the stream stays.
      await family.update(filled.id, { category_id: ids.biz });
      assert.equal((await row(runner, family.table, filled.id)).stream_id, ids.opsBiz, `${label}: a stream of the new category stays`);
    }
  });
}

/** The conversion of a request: the dialog's values over the request's, under the same rule. */
async function testConversion() {
  await inRolledBackTransaction(async (runner) => {
    const { ids, tenantId, creatorId } = await seed(runner);
    const { requests, projects } = services(runner);
    const opts = { manager: runner.manager };
    const request = async (name: string) => {
      const created: any = await requests.create({ name, category_id: ids.it, stream_id: ids.opsIt, company_id: ids.companyA, department_id: ids.finA } as any, tenantId, creatorId, opts);
      await runner.query(`UPDATE portfolio_requests SET status = 'approved' WHERE id = $1`, [created.id]);
      return created.id as string;
    };
    await refused(projects.convertFromRequest(await request('Wrong stream'), { stream_id: ids.opsBiz } as any, tenantId, creatorId, opts), 'STREAM_OUTSIDE_CATEGORY', { child: 'Ops', childParent: 'Business', parent: 'IT' });
    await refused(projects.convertFromRequest(await request('Wrong department'), { department_id: ids.finB } as any, tenantId, creatorId, opts), 'DEPARTMENT_OUTSIDE_COMPANY', { child: 'Finance', childParent: 'Beta', parent: 'Alpha' });
    const moved: any = await projects.convertFromRequest(await request('Other category'), { category_id: ids.biz } as any, tenantId, creatorId, opts);
    assert.deepEqual(await row(runner, 'portfolio_projects', moved.id), { category_id: ids.biz, stream_id: null, company_id: ids.companyA, department_id: ids.finA }, 'another category drops the stream');
    const kept: any = await projects.convertFromRequest(await request('As requested'), { category_id: null, stream_id: null } as any, tenantId, creatorId, opts);
    assert.deepEqual(await row(runner, 'portfolio_projects', kept.id), { category_id: ids.it, stream_id: ids.opsIt, company_id: ids.companyA, department_id: ids.finA }, 'empty overrides keep the request values');
  });
}

/** A request made from a task: the task's own stream and category, under the same rule. */
async function testRequestFromATask() {
  await inRolledBackTransaction(async (runner) => {
    const { ids, tenantId, creatorId } = await seed(runner);
    const manager = runner.manager;
    const requests = new PortfolioRequestsService(
      manager.getRepository(PortfolioRequest), new AuditService(manager.getRepository(AuditLog)), {} as any, {} as any,
      { logChange: async () => undefined } as any, {} as any, new ItemNumberService(), {} as any, managedDocumentServices(manager),
    );
    const task = async (n: number, category: string | null, stream: string | null) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO tasks (id, tenant_id, item_number, title, status, category_id, stream_id) VALUES ($1, $2, $3, $4, 'open', $5, $6)`,
        [id, tenantId, n, `Task ${n}`, category, stream],
      );
      return id;
    };
    // A stream without its category brings it.
    const alone: any = await requests.convertFromTask(await task(1, null, ids.opsBiz), {}, tenantId, creatorId, { manager });
    assert.deepEqual([alone.category_id, alone.stream_id], [ids.biz, ids.opsBiz], 'the category of the stream');
    const coherent: any = await requests.convertFromTask(await task(2, ids.it, ids.opsIt), {}, tenantId, creatorId, { manager });
    assert.deepEqual([coherent.category_id, coherent.stream_id], [ids.it, ids.opsIt]);
    // A task saved before the rule, its stream of another category: refused, naming both.
    await refused(requests.convertFromTask(await task(3, ids.it, ids.opsBiz), {}, tenantId, creatorId, { manager }), 'STREAM_OUTSIDE_CATEGORY', { child: 'Ops', childParent: 'Business', parent: 'IT' });
  });
}

/** Tasks: a task of a project shows its project's category and stream where it has none. */
async function testTasks() {
  await inRolledBackTransaction(async (runner) => {
    const { ids, tenantId, creatorId } = await seed(runner);
    const { projects, tasks } = services(runner);
    const opts = { manager: runner.manager, tenantId };
    const project: any = await projects.create({ name: 'Project IT', origin: 'fast_track', category_id: ids.it, stream_id: ids.opsIt } as any, tenantId, creatorId, { manager: runner.manager });
    const target = { type: 'project' as const, id: project.id };
    // Created with a stream only: the project's category stands, a stream of another one is refused.
    await refused(tasks.createForTarget({ ...target, payload: { title: 'Wrong', stream_id: ids.opsBiz } as any }, creatorId, opts), 'STREAM_OUTSIDE_CATEGORY', { child: 'Ops', childParent: 'Business', parent: 'IT' });
    const inherits: any = await tasks.createForTarget({ ...target, payload: { title: 'Inherits' } as any }, creatorId, opts);
    assert.deepEqual([inherits.category_id, inherits.stream_id], [ids.it, ids.opsIt], 'the project defaults');
    const dev: any = await tasks.createForTarget({ ...target, payload: { title: 'Dev', stream_id: ids.devIt } as any }, creatorId, opts);
    assert.deepEqual([dev.category_id, dev.stream_id], [ids.it, ids.devIt]);
    const business: any = await tasks.createForTarget({ ...target, payload: { title: 'Business', category_id: ids.biz } as any }, creatorId, opts);
    assert.deepEqual([business.category_id, business.stream_id], [ids.biz, null], 'another category drops the project stream');
    // A standalone task: the stream gives its category.
    const standalone: any = await tasks.createForTarget({ type: null, id: null, payload: { title: 'Alone', stream_id: ids.opsBiz } as any }, creatorId, opts);
    assert.deepEqual([standalone.category_id, standalone.stream_id], [ids.biz, ids.opsBiz]);
    // Updates, by id and through the project.
    await refused(tasks.updateById(dev.id, { stream_id: ids.opsBiz } as any, creatorId, opts), 'STREAM_OUTSIDE_CATEGORY', { child: 'Ops', childParent: 'Business', parent: 'IT' });
    await refused(tasks.updateForTarget({ ...target, payload: { id: dev.id, category_id: ids.it, stream_id: ids.opsBiz } as any }, creatorId, opts), 'STREAM_OUTSIDE_CATEGORY', { child: 'Ops', childParent: 'Business', parent: 'IT' });
    await tasks.updateById(dev.id, { category_id: ids.biz } as any, creatorId, opts);
    assert.deepEqual(await row(runner, 'tasks', dev.id), { category_id: ids.biz, stream_id: null }, 'the category alone drops the stream');
    await tasks.updateForTarget({ ...target, payload: { id: dev.id, stream_id: ids.opsBiz } as any }, creatorId, opts);
    assert.equal((await row(runner, 'tasks', dev.id)).stream_id, ids.opsBiz, 'the stream alone, in the task category');
    // A task saved before the rule stays writable on another field.
    await runner.query(`UPDATE tasks SET category_id = $2, stream_id = $3 WHERE id = $1`, [standalone.id, ids.it, ids.opsBiz]);
    await tasks.updateById(standalone.id, { title: 'Alone, renamed', category_id: ids.it } as any, creatorId, opts);
    assert.equal((await row(runner, 'tasks', standalone.id)).stream_id, ids.opsBiz, 'a stored disagreement stays');
  });
}

/** A contributor's default stream and a person's department, by the same rule. */
async function testContributorsAndPeople() {
  await inRolledBackTransaction(async (runner) => {
    const { ids, tenantId, creatorId } = await seed(runner);
    const manager = runner.manager;
    const contributors = new TeamMemberConfigService(
      manager.getRepository(TeamMemberConfig), new AuditService(manager.getRepository(AuditLog)), new ItemNumberService(), {} as any,
    );
    await refused(
      contributors.create({ user_id: creatorId, default_category_id: ids.it, default_stream_id: ids.opsBiz, employment_type_id: null } as any, tenantId, creatorId, { manager }),
      'STREAM_OUTSIDE_CATEGORY', { child: 'Ops', childParent: 'Business', parent: 'IT' },
    );
    const config: any = await contributors.create({ user_id: creatorId, default_stream_id: ids.opsBiz } as any, tenantId, creatorId, { manager });
    assert.deepEqual([config.default_category_id, config.default_stream_id], [ids.biz, ids.opsBiz], 'the default category filled');
    await contributors.update(config.id, { default_category_id: ids.it } as any, creatorId, { manager });
    const [defaults] = await runner.query(`SELECT default_category_id, default_stream_id FROM portfolio_team_member_configs WHERE id = $1`, [config.id]);
    assert.deepEqual(defaults, { default_category_id: ids.it, default_stream_id: null }, 'the default stream dropped');

    const users = new UsersService(manager.getRepository(User), {} as any, {} as any, {} as any, {} as any, {} as any, undefined, undefined);
    await refused(users.updateUser(creatorId, { company_id: ids.companyA, department_id: ids.finB } as any, undefined, { manager }), 'DEPARTMENT_OUTSIDE_COMPANY', { child: 'Finance', childParent: 'Beta', parent: 'Alpha' });
    await users.updateUser(creatorId, { department_id: ids.finB } as any, undefined, { manager });
    const person = async () => (await runner.query(`SELECT company_id, department_id FROM users WHERE id = $1`, [creatorId]))[0];
    assert.deepEqual(await person(), { company_id: ids.companyB, department_id: ids.finB }, 'the company filled');
    await users.updateUser(creatorId, { company_id: ids.companyA } as any, undefined, { manager });
    assert.deepEqual(await person(), { company_id: ids.companyA, department_id: null }, 'the department dropped');
  });
}

async function main() {
  await dataSource.initialize();
  const tests: Array<[string, () => Promise<void>]> = [
    ['requests and projects', testRequestsAndProjects],
    ['conversion of a request', testConversion],
    ['request made from a task', testRequestFromATask],
    ['tasks', testTasks],
    ['contributors and people', testContributorsAndPeople],
  ];
  const failures: string[] = [];
  try {
    for (const [name, test] of tests) {
      try {
        await test();
        console.log(`ok - ${name}`);
      } catch (error) {
        failures.push(name);
        console.error(`not ok - ${name}\n${(error as Error).stack}`);
      }
    }
  } finally {
    await closeMarkdownWorkers();
    await dataSource.destroy();
  }
  if (failures.length > 0) process.exit(1);
}

void main();
