import * as assert from 'node:assert/strict';
import {
  PortfolioUpcomingReportService,
  normalizeProjectDays,
  normalizeRequestDays,
  normalizeTaskDays,
} from '../services/portfolio-upcoming-report.service';

type Call = { sql: string; params: any[] };
type Block = 'tasks' | 'projectEnds' | 'projectStarts' | 'pendingRequests' | 'requestDeliveries';

/** Which block a statement feeds, told apart by the date predicate it carries. */
const blockOf = (sql: string): Block => {
  if (sql.includes('FROM tasks t')) return 'tasks';
  if (sql.includes('p.planned_end <=')) return 'projectEnds';
  if (sql.includes('p.planned_start <=')) return 'projectStarts';
  if (sql.includes('r.created_at::date <')) return 'pendingRequests';
  if (sql.includes('r.target_delivery_date BETWEEN')) return 'requestDeliveries';
  throw new Error(`Unexpected statement: ${sql}`);
};

/** A stand-in for the tenant-bound manager: each block gets its canned rows. */
function stubManager(results: Partial<Record<Block, Array<Record<string, unknown>>>> = {}) {
  const calls = new Map<Block, Call>();
  // Two queries in flight at once are the node-postgres warning
  // (`client.query() when the client is already executing a query`).
  let busy = 0;
  const manager = {
    query: async (sql: string, params: any[]) => {
      if (busy > 0) throw new Error('client.query() when the client is already executing a query');
      busy += 1;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        const block = blockOf(sql);
        assert.ok(!calls.has(block), `one statement per block (${block})`);
        calls.set(block, { sql, params });
        return results[block] ?? [];
      } finally {
        busy -= 1;
      }
    },
  } as any;
  return { manager, calls };
}

const daysBetween = (from: string, to: string) =>
  (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000;

async function run() {
  /* ----------------------------------------------------------------- */
  /*  Horizon normalisation                                            */
  /* ----------------------------------------------------------------- */

  assert.equal(normalizeTaskDays(7), 7);
  assert.equal(normalizeTaskDays('30'), 30);
  assert.equal(normalizeTaskDays(undefined), 14, 'tasks default to 14 days');
  assert.equal(normalizeTaskDays(60), 14, 'a horizon the block does not offer reads as its default');
  assert.equal(normalizeProjectDays('90'), 90);
  assert.equal(normalizeProjectDays(undefined), 30, 'projects default to 30 days');
  assert.equal(normalizeProjectDays(14), 30);
  assert.equal(normalizeRequestDays('60'), 60);
  assert.equal(normalizeRequestDays(undefined), 30, 'requests default to 30 days');
  assert.equal(normalizeRequestDays('soon'), 30);

  /* ----------------------------------------------------------------- */
  /*  Predicates, bounds and statuses                                  */
  /* ----------------------------------------------------------------- */

  const svc = new PortfolioUpcomingReportService();
  const tenantId = '11111111-1111-1111-1111-111111111111';

  const plain = stubManager();
  const report = await svc.getReport(
    tenantId,
    { taskDays: 7, projectDays: 60, requestDays: 14, timeZone: 'Pacific/Auckland' },
    { manager: plain.manager },
  );
  const expectedAsOf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  assert.equal(report.asOf, expectedAsOf, 'today is read in the viewer zone');
  assert.equal(plain.calls.size, 5, 'one statement per block');

  assert.equal(report.tasks.horizonDays, 7);
  assert.equal(daysBetween(report.asOf, report.tasks.until), 7);
  assert.equal(report.projectEnds.horizonDays, 60);
  assert.equal(daysBetween(report.asOf, report.projectEnds.until), 60);
  assert.equal(report.projectStarts.until, report.projectEnds.until, 'starts share the project horizon');
  assert.equal(report.requestDeliveries.until, report.projectEnds.until, 'deliveries share the project horizon');
  assert.equal(report.pendingRequests.thresholdDays, 14);
  // Created on or before today minus 14 days, written as an exclusive bound on the day after.
  assert.equal(daysBetween(report.pendingRequests.createdBefore, report.asOf), 13);

  for (const [block, call] of plain.calls) {
    assert.equal(call.params[0], tenantId, `${block} is filtered on the tenant`);
    assert.ok(/\b[a-z]\.tenant_id = \$1\b/.test(call.sql), `${block} carries the tenant predicate`);
    assert.ok(!call.sql.includes(report.asOf), `${block}: days are bound, never interpolated`);
  }

  const tasks = plain.calls.get('tasks')!;
  assert.deepEqual(tasks.params.slice(1, 4), [
    ['open', 'in_progress', 'pending', 'in_testing'],
    report.asOf,
    report.tasks.until,
  ]);
  assert.ok(tasks.sql.includes('t.due_date BETWEEN $3::date AND $4::date'), 'due days are an inclusive window');
  assert.ok(tasks.sql.includes('s.due_date < $3::date'), 'late tasks are those due before today');
  assert.ok(tasks.sql.includes("t.related_object_type IS NULL OR t.related_object_type = 'project'"));

  const ends = plain.calls.get('projectEnds')!;
  assert.deepEqual(ends.params.slice(1, 4), [
    ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold'],
    report.asOf,
    report.projectEnds.until,
  ]);
  assert.ok(ends.sql.includes('p.planned_end BETWEEN $3::date AND $4::date'));
  assert.ok(ends.sql.includes('s.planned_end < $3::date'), 'passed ends are counted before today');

  const starts = plain.calls.get('projectStarts')!;
  assert.deepEqual(starts.params.slice(1, 4), [['waiting_list', 'planned'], report.asOf, report.projectStarts.until]);
  assert.ok(starts.sql.includes('p.planned_start BETWEEN $3::date AND $4::date'));

  const pending = plain.calls.get('pendingRequests')!;
  assert.deepEqual(pending.params.slice(1, 3), [['pending_review'], report.pendingRequests.createdBefore]);
  // The request list compares the same plain day, so the figure and its link agree.
  assert.ok(pending.sql.includes('r.created_at::date < $3::date'));

  const deliveries = plain.calls.get('requestDeliveries')!;
  assert.deepEqual(deliveries.params.slice(1, 4), [
    ['pending_review', 'candidate', 'approved', 'on_hold'],
    report.asOf,
    report.requestDeliveries.until,
  ]);
  assert.ok(deliveries.sql.includes('r.target_delivery_date BETWEEN $3::date AND $4::date'));

  // No filter, no filter SQL.
  for (const [block, call] of plain.calls) {
    assert.ok(!call.sql.includes('portfolio_team_member_configs'), `${block}: no team filter unless asked`);
    assert.ok(!call.sql.includes('ANY($5'), `${block}: no extra parameter unless asked`);
  }

  /* ----------------------------------------------------------------- */
  /*  Project and team filters                                         */
  /* ----------------------------------------------------------------- */

  const filtered = stubManager();
  await svc.getReport(
    tenantId,
    { timeZone: 'Europe/Paris', projectIds: ['p-1'], teamIds: ['team-1'] },
    { manager: filtered.manager },
  );
  const ft = filtered.calls.get('tasks')!;
  assert.ok(ft.sql.includes("t.related_object_type = 'project' AND t.related_object_id::text = ANY($5::text[])"));
  assert.ok(ft.sql.includes('t.assignee_user_id IN (SELECT tmc.user_id FROM portfolio_team_member_configs'));
  assert.deepEqual(ft.params.slice(4), [['p-1'], ['team-1']]);
  for (const block of ['projectEnds', 'projectStarts'] as const) {
    const call = filtered.calls.get(block)!;
    assert.ok(call.sql.includes('p.id::text = ANY($5::text[])'), `${block}: project filter`);
    assert.ok(call.sql.includes('portfolio_team_member_configs'), `${block}: team filter`);
    assert.deepEqual(call.params.slice(4), [['p-1'], ['team-1']]);
  }
  const fp = filtered.calls.get('pendingRequests')!;
  assert.ok(fp.sql.includes('FROM portfolio_request_projects rpf'), 'requests: linked project filter');
  assert.ok(fp.sql.includes('portfolio_team_member_configs'));
  assert.deepEqual(fp.params.slice(3), [['p-1'], ['team-1']]);
  const fd = filtered.calls.get('requestDeliveries')!;
  assert.ok(fd.sql.includes('FROM portfolio_request_projects rpf'));
  assert.deepEqual(fd.params.slice(4), [['p-1'], ['team-1']]);

  /* ----------------------------------------------------------------- */
  /*  Rows and counts                                                  */
  /* ----------------------------------------------------------------- */

  const withRows = stubManager({
    tasks: [
      {
        overdue: 4,
        id: 't1',
        item_number: 12,
        title: 'Label the cellar',
        status: 'open',
        due_date: '2026-09-25',
        priority_level: 'high',
        task_type_name: 'Task',
        assignee_name: 'Alice Martin',
        project_id: 'p1',
        project_number: 3,
        project_name: 'Cellar probes',
      },
      {
        overdue: 4,
        id: 't2',
        item_number: 13,
        title: 'Standalone',
        status: 'pending',
        due_date: '2026-09-26',
        priority_level: 'normal',
        task_type_name: null,
        assignee_name: null,
        project_id: null,
        project_number: null,
        project_name: null,
      },
    ],
    // An empty window still reports what is already past, through the left join.
    projectEnds: [{ passed: 2, id: null }],
    pendingRequests: [
      {
        id: 'r1',
        item_number: 7,
        name: 'New probe',
        status: 'pending_review',
        source_name: 'Business',
        created_on: '2026-07-01',
        target_delivery_date: null,
        requestor_name: 'Bob Durand',
      },
    ],
  });
  const full = await svc.getReport(tenantId, { timeZone: 'Europe/Paris' }, { manager: withRows.manager });
  assert.equal(full.tasks.overdueCount, 4);
  assert.deepEqual(full.tasks.rows.map((row) => row.ref), ['T-12', 'T-13']);
  assert.equal(full.tasks.rows[0].itemPath, '/portfolio/tasks/T-12/overview');
  assert.deepEqual(full.tasks.rows[0].project, {
    ref: 'PRJ-3',
    name: 'Cellar probes',
    itemPath: '/portfolio/projects/PRJ-3/summary',
  });
  assert.equal(full.tasks.rows[1].project, null);
  assert.equal(full.projectEnds.passedCount, 2);
  assert.deepEqual(full.projectEnds.rows, []);
  assert.equal(full.pendingRequests.rows[0].ref, 'REQ-7');
  assert.equal(full.pendingRequests.rows[0].itemPath, '/portfolio/requests/REQ-7/summary');
  assert.equal(full.pendingRequests.rows[0].createdOn, '2026-07-01');
  assert.deepEqual(full.requestDeliveries.rows, []);

  console.log('portfolio-upcoming-report.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
