import * as assert from 'node:assert/strict';
import AdmZip = require('adm-zip');
import { PortfolioWeeklyReportController } from '../portfolio-weekly-report.controller';
import { PortfolioWeeklyReportService } from '../services/portfolio-weekly-report.service';

/**
 * The weekly report's classification filters, read on the statements themselves: a task's
 * source and category are the inherited ones, the way the task list resolves them, so the
 * report and the list a reader opens next count the same population.
 */
async function run() {
  const tenantId = '44dd2037-a4a7-4943-8b63-5b2c95cff52b';
  const calls: Array<{ sql: string; params: any[] }> = [];
  const manager: any = {
    query: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      return [];
    },
  };

  const svc = new PortfolioWeeklyReportService();
  await svc.list(
    {
      tenantId,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      timeZone: 'Europe/Paris',
      sourceIds: ['s1', ' s2 ', 's1'],
      categoryIds: ['c1'],
      streamIds: [],
      taskTypeIds: [],
    },
    { manager },
  );

  assert.equal(calls.length, 3, 'one statement per entity, no query per item');
  const [requests, projects, tasks] = calls;

  // Requests and projects carry their own value: no fallback, no project join.
  for (const call of [requests, projects]) {
    assert.ok(!call.sql.includes('COALESCE(') || !call.sql.includes('source_id, pp.source_id'));
    assert.ok(!call.sql.includes('portfolio_projects pp'));
  }
  assert.ok(requests.sql.includes('r.source_id::text = ANY('));
  assert.ok(requests.sql.includes('r.category_id::text = ANY('));
  assert.ok(projects.sql.includes('p.source_id::text = ANY('));
  assert.ok(projects.sql.includes('p.category_id::text = ANY('));

  // Tasks read the inherited value, through a tenant-bound join on the project they hang off.
  assert.ok(tasks.sql.includes('COALESCE(t.source_id, pp.source_id)::text = ANY('));
  assert.ok(tasks.sql.includes('COALESCE(t.category_id, pp.category_id)::text = ANY('));
  assert.ok(tasks.sql.includes('LEFT JOIN portfolio_projects pp'));
  assert.ok(tasks.sql.includes("t.related_object_type = 'project'"));
  assert.ok(tasks.sql.includes('pp.tenant_id = t.tenant_id'));
  assert.ok(!/[^(]t\.source_id::text = ANY/.test(tasks.sql), 'the task value alone is never the filter');
  // The scope of the report is untouched by the filter.
  assert.ok(tasks.sql.includes("(t.related_object_type IS NULL OR t.related_object_type = 'project')"));

  // Blanks and duplicates are dropped, and every value travels as a bound parameter.
  for (const call of calls) {
    assert.equal(call.params[0], tenantId, 'every statement is filtered on the tenant');
    assert.ok(call.sql.includes('tenant_id = $1'));
    assert.ok(!call.sql.includes("'s1'"), 'a value is never interpolated into the SQL');
    assert.deepEqual(call.params[call.params.length - 1], ['c1']);
    assert.deepEqual(call.params[call.params.length - 2], ['s1', 's2']);
  }

  // With no filter the statements read exactly what they always read.
  const plain: Array<{ sql: string; params: any[] }> = [];
  const plainManager: any = {
    query: async (sql: string, params: any[]) => {
      plain.push({ sql, params });
      return [];
    },
  };
  await svc.list(
    { tenantId, startDate: '2026-08-01', endDate: '2026-08-31', timeZone: 'Europe/Paris' },
    { manager: plainManager },
  );
  for (const call of plain) {
    assert.ok(!call.sql.includes('source_id::text = ANY('));
    assert.ok(!call.sql.includes('category_id::text = ANY('));
    assert.ok(!call.sql.includes('sr.status::text = ANY('), 'no status filter without a status');
  }

  /* ---------------------------------------------------------------- */
  /*  Status reached                                                  */
  /* ---------------------------------------------------------------- */

  // The status reached is the one left by the last status event of the period, never the live
  // status. A task moved in_progress -> done inside the period and reopened after it reached
  // `done` (its live status is `open`): it matches `done`, not `open`. The stub cannot run the
  // SQL, so what is pinned here is that rule on the statements themselves.
  const statusCalls: Array<{ sql: string; params: any[] }> = [];
  const statusManager: any = {
    query: async (sql: string, params: any[]) => {
      statusCalls.push({ sql, params });
      return [];
    },
  };
  await svc.list(
    {
      tenantId,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      timeZone: 'Europe/Paris',
      statuses: ['done', ' cancelled ', 'done', ''],
    },
    { manager: statusManager },
  );
  assert.equal(statusCalls.length, 3);
  for (const call of statusCalls) {
    // One expression, the same in the three statements, read off the period's events.
    assert.ok(call.sql.includes('status_reached AS ('));
    assert.ok(call.sql.includes('LEFT JOIN status_reached sr ON sr.record_id = a.record_id'));
    assert.ok(/status_reached AS \([\s\S]*?ORDER BY pe\.record_id, pe\.created_at DESC, pe\.id DESC/.test(call.sql),
      'the last event of the period wins');
    assert.ok(/status_reached AS \([\s\S]*?pe\.action = 'create'/.test(call.sql), 'a creation sets a status too');
    const predicate = call.sql.match(/sr\.status::text = ANY\(\$(\d+)::text\[\]\)/);
    assert.ok(predicate, 'the filter reads the status reached');
    assert.deepEqual(call.params[Number(predicate![1]) - 1], ['done', 'cancelled']);
    // The fixed parameters keep their place: the filter comes after them.
    assert.ok(Number(predicate![1]) > 6);
    assert.ok(!/(?<![a-z_])[rpt]\.status::text = ANY/.test(call.sql), 'the live status is never the filter');
  }

  /* ---------------------------------------------------------------- */
  /*  Company                                                         */
  /* ---------------------------------------------------------------- */

  const rawRow = (over: Record<string, any>) => ({
    record_id: 'x1',
    name: 'Row',
    item_number: 1,
    source_id: null,
    source_name: null,
    category_id: null,
    category_name: null,
    stream_id: null,
    stream_name: null,
    company_name: 'Fromage & Co SA',
    status: 'open',
    live_created_day: '2026-08-02',
    created_day: '2026-08-02',
    modified_day: null,
    closed_day: null,
    update_count: 0,
    status_from: null,
    status_to: null,
    changed_fields: [],
    ...over,
  });
  const companyCalls: Array<{ sql: string; params: any[] }> = [];
  const companyManager: any = {
    query: async (sql: string, params: any[]) => {
      companyCalls.push({ sql, params });
      if (sql.includes('JOIN tasks t ON')) return [rawRow({ company_name: null })];
      return [rawRow({})];
    },
  };
  const withCompany = await svc.list(
    { tenantId, startDate: '2026-08-01', endDate: '2026-08-31', timeZone: 'Europe/Paris' },
    { manager: companyManager },
  );
  assert.equal(withCompany.requests.created[0].company, 'Fromage & Co SA');
  assert.equal(withCompany.projects.created[0].company, 'Fromage & Co SA');
  assert.equal(withCompany.tasks.created[0].company, null);
  const [reqSql, prjSql, taskSql] = companyCalls.map((call) => call.sql);
  assert.ok(reqSql.includes('LEFT JOIN companies co ON co.id = r.company_id AND co.tenant_id = r.tenant_id'));
  assert.ok(prjSql.includes('LEFT JOIN companies co ON co.id = p.company_id AND co.tenant_id = p.tenant_id'));
  assert.ok(
    taskSql.includes('LEFT JOIN companies co ON co.id = COALESCE(t.company_id, pp.company_id) AND co.tenant_id = t.tenant_id'),
    'a task inherits the company of its project',
  );

  /* ---------------------------------------------------------------- */
  /*  Type (entities)                                                 */
  /* ---------------------------------------------------------------- */

  // Only the objects asked for are queried; the others come back empty and stay out of the
  // exports.
  const typeCalls: Array<{ sql: string; params: any[] }> = [];
  const typeManager: any = {
    query: async (sql: string, params: any[]) => {
      typeCalls.push({ sql, params });
      return [rawRow({})];
    },
  };
  const periodOnly = { tenantId, startDate: '2026-08-01', endDate: '2026-08-31', timeZone: 'Europe/Paris' };
  const projectsOnly = await svc.list({ ...periodOnly, entities: ['project'] }, { manager: typeManager });
  assert.equal(typeCalls.length, 1, 'one statement: the projects');
  assert.ok(typeCalls[0].sql.includes('JOIN portfolio_projects p ON p.id = a.record_id'));
  assert.equal(projectsOnly.projects.created.length, 1);
  assert.deepEqual(projectsOnly.requests, { created: [], modified: [], closed: [] });
  assert.deepEqual(projectsOnly.tasks, { created: [], modified: [], closed: [] });

  typeCalls.length = 0;
  const csv = await svc.exportCsv({ ...periodOnly, entities: ['request', 'task'] }, { manager: typeManager });
  assert.equal(typeCalls.length, 2);
  assert.ok(csv.content.includes('Requests created'));
  assert.ok(csv.content.includes('Tasks created'));
  assert.ok(!csv.content.includes('Projects created'), 'no block for an object left out');

  const xlsx = await svc.exportXlsx({ ...periodOnly, entities: ['task'] }, null, { manager: typeManager });
  const workbook = new AdmZip(xlsx.content).readAsText('xl/workbook.xml');
  assert.ok(workbook.includes('name="Tasks"'));
  assert.ok(!workbook.includes('name="Requests"') && !workbook.includes('name="Projects"'), 'one sheet only');

  // No object named reads as all three.
  typeCalls.length = 0;
  await svc.list({ ...periodOnly, entities: [] }, { manager: typeManager });
  assert.equal(typeCalls.length, 3);

  // The query string: unknown values are dropped, duplicates too, nothing left means all.
  const controller: any = new PortfolioWeeklyReportController(svc);
  const ctx: any = { tenantId };
  const parse = (entities: string) =>
    controller.parseQuery({ startDate: '2026-08-01', endDate: '2026-08-31', entities }, ctx).entities;
  assert.deepEqual(parse('project,task,project'), ['project', 'task']);
  assert.deepEqual(parse('request,bogus'), ['request']);
  assert.deepEqual(parse('bogus'), []);
  assert.deepEqual(parse(''), []);

  // The filter lists (sources, categories, streams, task types) share the request's connection.
  let busy = 0;
  const filterCalls: string[] = [];
  const filterManager = {
    query: async (sql: string) => {
      if (busy > 0) throw new Error('client.query() when the client is already executing a query');
      busy += 1;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        filterCalls.push(sql);
        return [];
      } finally {
        busy -= 1;
      }
    },
  };
  const values = await svc.listFilterValues(tenantId, { manager: filterManager as any });
  assert.deepEqual(values, { sources: [], categories: [], streams: [], taskTypes: [] });
  assert.equal(filterCalls.length, 4, 'one statement per list, one after the other');

  console.log('portfolio-weekly-report-filters.spec.ts: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
