// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { EntityManager, QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvImportResult } from '../../common/csv';
import dataSource from '../../data-source';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { inRolledBackTransaction, managedDocumentServices, seedCreationTenant } from '../../common/creation/__tests__/creation-cancel.fixtures';
import { PortfolioProjectsCsvService } from '../portfolio-projects-csv.service';
import { PortfolioRequestsCsvService } from '../portfolio-requests-csv.service';
import { TasksCsvService } from '../../tasks/tasks-csv.service';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';

// Imports and the pairs of a record (lot I7a of 26.12.1). P12: a name two streams share ("Ops" in IT and
// in Business) is looked up in the row's category, given or stored (a task of a project: its project's);
// still several, the row is refused naming the categories. P13: the stream gives its category, a category
// changed alone drops a stream of another one, and a pair that contradicts itself is a row error. A file
// exported then imported again changes nothing, a record saved before the rule included.

type Seed = Awaited<ReturnType<typeof seed>>;
type Service = PortfolioRequestsCsvService | PortfolioProjectsCsvService | TasksCsvService;

async function seed(runner: QueryRunner) {
  const base = await seedCreationTenant(runner, { portfolio_projects: 'admin', portfolio_requests: 'admin', tasks: 'admin', users: 'admin' });
  const { tenantId } = base;
  const id = () => randomUUID();
  const ids = { it: id(), biz: id(), opsIt: id(), opsBiz: id(), devIt: id(), runBiz: id(), companyA: id(), companyB: id(), finA: id(), finB: id() };
  await runner.query(`INSERT INTO portfolio_categories (id, tenant_id, name) VALUES ($1, $3, 'IT'), ($2, $3, 'Business')`, [ids.it, ids.biz, tenantId]);
  await runner.query(
    `INSERT INTO portfolio_streams (id, tenant_id, category_id, name)
     VALUES ($1, $5, $6, 'Ops'), ($2, $5, $7, 'Ops'), ($3, $5, $6, 'Dev'), ($4, $5, $7, 'Run')`,
    [ids.opsIt, ids.opsBiz, ids.devIt, ids.runBiz, tenantId, ids.it, ids.biz],
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

function servicesFor(manager: EntityManager) {
  const resolver = new CsvResolverService();
  const exporter = new CsvExportService(resolver);
  const importer = new CsvImportService(resolver, new CsvJsonValidators());
  const documents = managedDocumentServices(manager);
  return {
    requests: new PortfolioRequestsCsvService(null as any, exporter, importer, documents),
    projects: new PortfolioProjectsCsvService(null as any, exporter, importer, documents),
    tasks: new TasksCsvService(null as any, exporter, importer),
  };
}

async function run(service: Service, runner: QueryRunner, data: Seed, csv: string, dryRun: boolean): Promise<CsvImportResult> {
  const file = { buffer: Buffer.from(csv, 'utf8'), originalname: 'import.csv', mimetype: 'text/csv', size: csv.length } as Express.Multer.File;
  return (service as any).import(file, { dryRun, operation: 'upsert' }, {
    manager: runner.manager, tenantId: data.tenantId, userId: data.creatorId, isAdmin: true, access: { isAdmin: true },
  });
}

/** The check, then the load: both agree; the counts. */
async function load(service: Service, runner: QueryRunner, data: Seed, csv: string) {
  const check = await run(service, runner, data, csv, true);
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  const loaded = await run(service, runner, data, csv, false);
  assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
  const counts = (result: CsvImportResult) => ({ inserted: result.inserted, updated: result.updated, unchanged: result.unchanged, cleared: result.cleared });
  assert.deepEqual(counts(loaded), counts(check), 'the load does what the check said');
  return counts(loaded);
}

/** The row errors of a check, by code and the params that matter. */
async function refusals(service: Service, runner: QueryRunner, data: Seed, csv: string) {
  const check = await run(service, runner, data, csv, true);
  assert.equal(check.ok, false, 'the file is refused');
  return check.errors.map((error: any) => ({ code: error.code, column: error.column, params: error.params }));
}

async function pair(runner: QueryRunner, table: string, id: string, columns = 'category_id, stream_id, company_id, department_id') {
  const [stored] = await runner.query(`SELECT ${columns} FROM ${table} WHERE id = $1`, [id]);
  return stored;
}

async function request(runner: QueryRunner, data: Seed, n: number, values: { category: string | null; stream: string | null; company?: string | null; department?: string | null }) {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO portfolio_requests (id, tenant_id, item_number, name, status, category_id, stream_id, company_id, department_id)
     VALUES ($1, $2, $3, $4, 'pending_review', $5, $6, $7, $8)`,
    [id, data.tenantId, n, `Request ${n}`, values.category, values.stream, values.company ?? null, values.department ?? null],
  );
  return id;
}

async function testRequests() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { ids } = data;
    const { requests } = servicesFor(runner.manager);

    // New requests: a shared name found in the row's category, a unique one giving its category.
    assert.deepEqual(await load(requests, runner, data, 'name;category_name;stream_name\nWith category;Business;Ops\nWithout category;;Dev'), { inserted: 2, updated: 0, unchanged: 0, cleared: 0 });
    const created = await runner.query(`SELECT name, category_id, stream_id FROM portfolio_requests WHERE tenant_id = $1 ORDER BY name`, [data.tenantId]);
    assert.deepEqual(created, [
      { name: 'With category', category_id: ids.biz, stream_id: ids.opsBiz },
      { name: 'Without category', category_id: ids.it, stream_id: ids.devIt },
    ]);
    // A shared name with no category: the categories that have one are named.
    assert.deepEqual(await refusals(requests, runner, data, 'name;stream_name\nAmbiguous;Ops'), [
      { code: 'CSV_STREAM_IN_SEVERAL_CATEGORIES', column: 'stream_name', params: { value: 'Ops', parents: 'Business, IT', columns: 'category_name' } },
    ]);
    // A pair that contradicts itself, and the same for a department.
    assert.deepEqual(await refusals(requests, runner, data, 'name;category_name;stream_name\nWrong;IT;Run'), [
      { code: 'STREAM_OUTSIDE_CATEGORY', column: 'stream_name', params: { child: 'Run', childParent: 'Business', parent: 'IT' } },
    ]);
    assert.deepEqual(await refusals(requests, runner, data, 'name;department_name\nAmbiguous;Finance'), [
      { code: 'CSV_DEPARTMENT_IN_SEVERAL_COMPANIES', column: 'department_name', params: { value: 'Finance', parents: 'Alpha, Beta', columns: 'company_name' } },
    ]);

    // Stored requests: the stream alone, in the stored category; a stream of another category refused.
    const dev = await request(runner, data, 11, { category: ids.it, stream: ids.devIt });
    assert.deepEqual(await load(requests, runner, data, `id;stream_name\n${dev};Ops`), { inserted: 0, updated: 1, unchanged: 0, cleared: 0 });
    assert.equal((await pair(runner, 'portfolio_requests', dev)).stream_id, ids.opsIt, 'the Ops of the stored category');
    assert.deepEqual((await refusals(requests, runner, data, `id;stream_name\n${dev};Run`)).map((error) => error.code), ['STREAM_OUTSIDE_CATEGORY']);
    // The category changed alone drops the stream, counted; the company changed alone, the department.
    const moved = await request(runner, data, 12, { category: ids.it, stream: ids.opsIt, company: ids.companyA, department: ids.finA });
    assert.deepEqual(await load(requests, runner, data, `id;category_name;company_name\n${moved};Business;Beta`), { inserted: 0, updated: 1, unchanged: 0, cleared: 2 });
    assert.deepEqual(await pair(runner, 'portfolio_requests', moved), { category_id: ids.biz, stream_id: null, company_id: ids.companyB, department_id: null });
    // The category changed with the stream given back as stored (a file of every column): dropped as well.
    const sentBack = await request(runner, data, 16, { category: ids.it, stream: ids.devIt });
    assert.deepEqual(await load(requests, runner, data, `id;category_name;stream_name\n${sentBack};Business;Dev`), { inserted: 0, updated: 1, unchanged: 0, cleared: 1 });
    assert.deepEqual(await pair(runner, 'portfolio_requests', sentBack, 'category_id, stream_id'), { category_id: ids.biz, stream_id: null });
    // The department by its stored company.
    const finance = await request(runner, data, 13, { category: null, stream: null, company: ids.companyB });
    assert.deepEqual(await load(requests, runner, data, `id;department_name\n${finance};Finance`), { inserted: 0, updated: 1, unchanged: 0, cleared: 0 });
    assert.equal((await pair(runner, 'portfolio_requests', finance)).department_id, ids.finB);

    // The round trip: shared names and a request saved before the rule change nothing.
    const incoherent = await request(runner, data, 14, { category: ids.it, stream: ids.opsBiz, company: ids.companyA, department: ids.finB });
    const coherent = await request(runner, data, 15, { category: ids.biz, stream: ids.opsBiz, company: ids.companyB, department: ids.finB });
    const exported = String((await requests.export({ manager: runner.manager, tenantId: data.tenantId, language: 'en', ids: [incoherent, coherent] } as any)).content).replace(/^﻿/, '');
    assert.deepEqual(await load(requests, runner, data, exported), { inserted: 0, updated: 0, unchanged: 2, cleared: 0 }, 'an export imported as it is');
    assert.deepEqual(await pair(runner, 'portfolio_requests', incoherent), { category_id: ids.it, stream_id: ids.opsBiz, company_id: ids.companyA, department_id: ids.finB });
    // The request saved before the rule, changed on another field.
    assert.deepEqual(await load(requests, runner, data, `id;name\n${incoherent};Renamed`), { inserted: 0, updated: 1, unchanged: 0, cleared: 0 });
    assert.deepEqual(await pair(runner, 'portfolio_requests', incoherent), { category_id: ids.it, stream_id: ids.opsBiz, company_id: ids.companyA, department_id: ids.finB });
  });
}

async function testProjects() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { ids } = data;
    const { projects } = servicesFor(runner.manager);
    const project = async (n: number, category: string | null, stream: string | null) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress, category_id, stream_id)
         VALUES ($1, $2, $3, $4, 'in_progress', 'fast_track', 0, $5, $6)`,
        [id, data.tenantId, n, `Project ${n}`, category, stream],
      );
      return id;
    };
    const business = await project(1, ids.biz, null);
    const none = await project(2, null, null);
    const incoherent = await project(3, ids.it, ids.opsBiz);
    assert.deepEqual(await load(projects, runner, data, `id;stream_name\n${business};Ops`), { inserted: 0, updated: 1, unchanged: 0, cleared: 0 });
    assert.equal((await pair(runner, 'portfolio_projects', business)).stream_id, ids.opsBiz, 'the Ops of the stored category');
    assert.deepEqual((await refusals(projects, runner, data, `id;stream_name\n${none};Ops`)).map((error) => [error.code, error.params?.parents]), [['CSV_STREAM_IN_SEVERAL_CATEGORIES', 'Business, IT']]);
    assert.deepEqual((await refusals(projects, runner, data, `id;category_name;stream_name\n${none};IT;Run`)).map((error) => error.code), ['STREAM_OUTSIDE_CATEGORY']);
    const exported = String((await projects.export({ manager: runner.manager, tenantId: data.tenantId, language: 'en', ids: [incoherent, business] } as any)).content).replace(/^﻿/, '');
    assert.deepEqual(await load(projects, runner, data, exported), { inserted: 0, updated: 0, unchanged: 2, cleared: 0 }, 'an export imported as it is');
    assert.deepEqual(await pair(runner, 'portfolio_projects', incoherent, 'category_id, stream_id'), { category_id: ids.it, stream_id: ids.opsBiz });
  });
}

async function testTasks() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { ids, tenantId } = data;
    const { tasks } = servicesFor(runner.manager);
    const project = randomUUID();
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress, category_id, stream_id)
       VALUES ($1, $2, 1, 'Business project', 'in_progress', 'fast_track', 0, $3, $4)`,
      [project, tenantId, ids.biz, ids.runBiz],
    );
    const task = async (n: number) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO tasks (id, tenant_id, item_number, title, status, related_object_type, related_object_id) VALUES ($1, $2, $3, $4, 'open', 'project', $5)`,
        [id, tenantId, n, `Task ${n}`, project],
      );
      return id;
    };
    const [named, wrong] = [await task(1), await task(2)];
    // The shared name in the category the task shows, its project's.
    assert.deepEqual(await load(tasks, runner, data, `id;stream_name\n${named};Ops`), { inserted: 0, updated: 1, unchanged: 0, cleared: 0 });
    assert.deepEqual(await pair(runner, 'tasks', named, 'category_id, stream_id'), { category_id: null, stream_id: ids.opsBiz });
    // A stream of another category than the one it shows.
    assert.deepEqual((await refusals(tasks, runner, data, `id;stream_name\n${wrong};Dev`)).map((error) => error.code), ['STREAM_OUTSIDE_CATEGORY']);
    // A task of an IT project moved to Business shows no stream, never the project's Ops (A2, A4).
    const itProject = randomUUID();
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress, category_id, stream_id)
       VALUES ($1, $2, 2, 'IT project', 'in_progress', 'fast_track', 0, $3, $4)`,
      [itProject, tenantId, ids.it, ids.opsIt],
    );
    const moved = randomUUID();
    await runner.query(
      `INSERT INTO tasks (id, tenant_id, item_number, title, status, related_object_type, related_object_id, category_id) VALUES ($1, $2, 3, 'Moved', 'open', 'project', $3, $4)`,
      [moved, tenantId, itProject, ids.biz],
    );
    // The round trip of tasks that follow their project, of the one with its own stream, and of the moved one.
    const exported = String((await tasks.export({ manager: runner.manager, tenantId, language: 'en' } as any)).content).replace(/^﻿/, '');
    assert.deepEqual(await load(tasks, runner, data, exported), { inserted: 0, updated: 0, unchanged: 3, cleared: 0 }, 'an export imported as it is');
    assert.deepEqual(await pair(runner, 'tasks', moved, 'category_id, stream_id'), { category_id: ids.biz, stream_id: null });
  });
}

async function testUsers() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { ids } = data;
    const manager = runner.manager;
    const users = new UsersService(manager.getRepository(User), {} as any, {} as any, {} as any, {} as any, {} as any, undefined, undefined);
    const [person] = await runner.query(`SELECT email FROM users WHERE id = $1`, [data.creatorId]);
    const check = async (csv: string) => {
      const file = { buffer: Buffer.from(csv, 'utf8'), originalname: 'users.csv', mimetype: 'text/csv', size: csv.length } as Express.Multer.File;
      return users.importCsv({ file, dryRun: true, userId: data.creatorId }, { manager }) as any;
    };
    const ambiguous = await check(`email;department_name\n${person.email};Finance`);
    assert.deepEqual(ambiguous.errors.map((error: any) => [error.code, error.params?.parents]), [['CSV_DEPARTMENT_IN_SEVERAL_COMPANIES', 'Alpha, Beta']]);
    const named = await check(`email;company_name;department_name\n${person.email};Beta;Finance`);
    assert.deepEqual(named.errors, [], 'the department of the company the row names');
    await runner.query(`UPDATE users SET company_id = $2 WHERE id = $1`, [data.creatorId, ids.companyA]);
    const stored = await check(`email;department_name\n${person.email};Finance`);
    assert.deepEqual(stored.errors, [], 'the department of the stored company');
  });
}

async function main() {
  const specs: Array<[string, () => Promise<void>]> = [
    ['requests: shared names, pairs and the round trip', testRequests],
    ['projects: shared names, pairs and the round trip', testProjects],
    ['tasks: the category they show from their project', testTasks],
    ['people: a department shared by two companies', testUsers],
  ];
  await dataSource.initialize();
  let failed = 0;
  try {
    for (const [name, spec] of specs) {
      try {
        await spec();
        console.log(`ok - ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`not ok - ${name}\n${(error as Error).stack}`);
      }
    }
  } finally {
    await closeMarkdownWorkers();
    await dataSource.destroy();
  }
  process.exit(failed ? 1 : 0);
}

void main();
