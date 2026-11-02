import * as assert from 'node:assert/strict';
import { TasksService } from '../../spend/tasks.service';
import { compileRequestLinkFilter } from '../portfolio-requests.service';
import { PortfolioAssigneeAttentionService } from '../services/portfolio-assignee-attention.service';
import { PortfolioFlowReportService } from '../services/portfolio-flow-report.service';
import { compileProjectLinkFilter } from '../services/portfolio-projects-list.service';
import { PortfolioReportFilterValuesService } from '../services/portfolio-report-filter-values.service';
import {
  projectInvolvesUsersSql,
  projectProjectTeamPredicates,
  requestInvolvesUsersSql,
  requestProjectTeamPredicates,
  taskProjectTeamPredicates,
} from '../services/portfolio-report-filters';
import { PortfolioWeeklyReportService } from '../services/portfolio-weekly-report.service';

/**
 * The project and team filters of the portfolio reports, read on the statements themselves,
 * and the hidden list filters the reports link with: a figure stays clickable only while the
 * list it opens applies exactly the same rule.
 */

type Call = { sql: string; params: any[] };

const TENANT = '44dd2037-a4a7-4943-8b63-5b2c95cff52b';
const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const T1 = '33333333-3333-3333-3333-333333333333';

const recorder = (answer: (sql: string) => any[] = () => []) => {
  const calls: Call[] = [];
  // Two queries in flight at once are the node-postgres warning
  // (`client.query() when the client is already executing a query`).
  let busy = 0;
  const manager: any = {
    query: async (sql: string, params: any[]) => {
      if (busy > 0) throw new Error('client.query() when the client is already executing a query');
      busy += 1;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        calls.push({ sql, params });
        return answer(sql);
      } finally {
        busy -= 1;
      }
    },
  };
  return { manager, calls };
};

/** The placeholder the value was bound to, read off the statement's own parameter list. */
const placeholderOf = (call: Call, value: unknown): string => {
  const index = call.params.findIndex((param) => JSON.stringify(param) === JSON.stringify(value));
  assert.ok(index >= 0, `bound parameter ${JSON.stringify(value)} not found`);
  return `$${index + 1}`;
};

const PROJECT_ROLES = ['business_sponsor_id', 'business_lead_id', 'it_sponsor_id', 'it_lead_id'];
const REQUEST_ROLES = ['requestor_id', 'created_by_id', ...PROJECT_ROLES];

async function run() {
  /* ----------------------------------------------------------------- */
  /*  The team rules, frozen                                           */
  /* ----------------------------------------------------------------- */

  // A project involves its sponsors, its leads and its project team; a request adds its
  // requestor and its author and reads its own team. The list scopes, the report filters and
  // the hidden list filters all go through these two functions.
  const projectRule = projectInvolvesUsersSql('x', '(U)');
  for (const role of PROJECT_ROLES) assert.ok(projectRule.includes(`x.${role} IN (U)`), role);
  assert.ok(projectRule.includes('FROM portfolio_project_team pt'));
  assert.ok(projectRule.includes('pt.user_id IN (U)'));
  const requestRule = requestInvolvesUsersSql('x', '(U)');
  for (const role of REQUEST_ROLES) assert.ok(requestRule.includes(`x.${role} IN (U)`), role);
  assert.ok(requestRule.includes('FROM portfolio_request_team rt'));
  assert.ok(requestRule.includes('rt.user_id IN (U)'));

  // Nothing asked, nothing added.
  assert.deepEqual(taskProjectTeamPredicates([], 't', {}), []);
  assert.deepEqual(projectProjectTeamPredicates([], 'p', { projectIds: [' '], teamIds: [] }), []);
  assert.deepEqual(requestProjectTeamPredicates([], 'r', {}), []);

  /* ----------------------------------------------------------------- */
  /*  Filter values                                                    */
  /* ----------------------------------------------------------------- */

  const values = recorder((sql) =>
    sql.includes('portfolio_projects')
      ? [
          { id: P1, item_number: 3, name: 'Cellar', status: 'in_progress' },
          { id: P2, item_number: 1, name: 'Aging', status: 'done' },
        ]
      : [{ id: T1, name: 'Cheese makers' }],
  );
  const filterValues = await new PortfolioReportFilterValuesService().list(TENANT, { manager: values.manager });
  assert.equal(values.calls.length, 2, 'two statements, no query per item');
  for (const call of values.calls) {
    assert.equal(call.params[0], TENANT);
    assert.ok(call.sql.includes('tenant_id = $1'));
  }
  const projectCall = values.calls.find((call) => call.sql.includes('portfolio_projects'))!;
  assert.deepEqual(projectCall.params[1], ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold']);
  assert.ok(/WHEN p\.status = ANY\(\$2::text\[\]\) THEN 0\s+WHEN p\.status = 'done' THEN 1\s+WHEN p\.status = 'cancelled' THEN 2/.test(projectCall.sql), 'open first, then done, then cancelled');
  assert.ok(projectCall.sql.indexOf('p.name ASC') > projectCall.sql.indexOf('CASE'), 'name after the status rank');
  const teamCall = values.calls.find((call) => call.sql.includes('portfolio_teams'))!;
  assert.ok(teamCall.sql.includes('t.is_active = TRUE'));
  assert.ok(teamCall.sql.includes('ORDER BY t.display_order ASC, t.name ASC'));
  assert.deepEqual(filterValues, {
    projects: [
      { id: P1, ref: 'PRJ-3', name: 'Cellar', status: 'in_progress' },
      { id: P2, ref: 'PRJ-1', name: 'Aging', status: 'done' },
    ],
    teams: [{ id: T1, name: 'Cheese makers' }],
  });
  await assert.rejects(() => new PortfolioReportFilterValuesService().list(TENANT, {}));

  /* ----------------------------------------------------------------- */
  /*  Weekly report                                                    */
  /* ----------------------------------------------------------------- */

  const weeklyBase = {
    tenantId: TENANT,
    startDate: '2026-09-14',
    endDate: '2026-09-20',
    timeZone: 'Europe/Paris',
    groupBy: 'person' as const,
  };
  const taskRow = {
    record_id: 'task-1',
    name: 'Probe',
    item_number: 1,
    status: 'open',
    live_created_day: '2026-09-15',
    created_day: '2026-09-15',
    update_count: 0,
    changed_fields: [],
    creator_user_id: 'u1',
    modifier_user_ids: [],
  };
  const weekly = recorder((sql) => (sql.includes('JOIN tasks t ON t.id = a.record_id') ? [taskRow] : []));
  await new PortfolioWeeklyReportService().list(
    { ...weeklyBase, projectIds: [P1, P1, ' '], teamIds: [T1], sourceIds: ['s1'] },
    { manager: weekly.manager },
  );
  assert.equal(weekly.calls.length, 5, 'three entities, the time, the people');
  const [wRequests, wProjects, wTasks, wTime, wPeople] = weekly.calls;

  for (const call of [wRequests, wProjects, wTasks, wTime, wPeople]) {
    assert.equal(call.params[0], TENANT);
    assert.ok(!call.sql.includes(P1), 'an id is never interpolated into the SQL');
    assert.ok(!call.sql.includes(T1), 'an id is never interpolated into the SQL');
  }

  // Tasks: the project they hang off, the team of their assignee.
  {
    const project = placeholderOf(wTasks, [P1]);
    const team = placeholderOf(wTasks, [T1]);
    assert.ok(wTasks.sql.includes(`(t.related_object_type = 'project' AND t.related_object_id::text = ANY(${project}::text[]))`));
    assert.ok(wTasks.sql.includes(`t.assignee_user_id IN (SELECT tmc.user_id FROM portfolio_team_member_configs tmc WHERE tmc.tenant_id = t.tenant_id AND tmc.team_id::text = ANY(${team}::text[]))`));
    // The other filters keep their own numbering after the project and team ones.
    assert.ok(wTasks.sql.includes(`COALESCE(t.source_id, pp.source_id)::text = ANY(${placeholderOf(wTasks, ['s1'])}::text[])`));
  }
  // Projects: the project itself, the team rule of the project list.
  {
    const project = placeholderOf(wProjects, [P1]);
    const team = placeholderOf(wProjects, [T1]);
    assert.ok(wProjects.sql.includes(`p.id::text = ANY(${project}::text[])`));
    assert.ok(wProjects.sql.includes(`p.business_sponsor_id IN (SELECT tmc.user_id FROM portfolio_team_member_configs tmc WHERE tmc.tenant_id = p.tenant_id AND tmc.team_id::text = ANY(${team}::text[]))`));
    assert.ok(wProjects.sql.includes('FROM portfolio_project_team pt'));
  }
  // Requests: linked to the project, the team rule of the request list.
  {
    const project = placeholderOf(wRequests, [P1]);
    const team = placeholderOf(wRequests, [T1]);
    assert.ok(wRequests.sql.includes('FROM portfolio_request_projects rpf'));
    assert.ok(wRequests.sql.includes('rpf.tenant_id = r.tenant_id'));
    assert.ok(wRequests.sql.includes(`rpf.project_id::text = ANY(${project}::text[])`));
    assert.ok(wRequests.sql.includes(`r.requestor_id IN (SELECT tmc.user_id FROM portfolio_team_member_configs tmc WHERE tmc.tenant_id = r.tenant_id AND tmc.team_id::text = ANY(${team}::text[]))`));
  }
  // Time: the project's tasks and the project itself, the team's members.
  {
    assert.ok(wTime.sql.includes('task_time_entries tte'));
    // A standalone task's time is other time: its missing type must not drop it from both sides.
    assert.ok(wTime.sql.includes("COALESCE(t.related_object_type = 'project', FALSE) AS is_project"));
    const project = placeholderOf(wTime, [P1]);
    const team = placeholderOf(wTime, [T1]);
    assert.deepEqual(wTime.params.slice(0, 4), [TENANT, '2026-09-14', 'Europe/Paris', '2026-09-20'], 'fixed parameters first');
    assert.ok(wTime.sql.includes(`t.related_object_type = 'project' AND t.related_object_id::text = ANY(${project}::text[])`));
    assert.ok(wTime.sql.includes(`pte.project_id::text = ANY(${project}::text[])`));
    assert.ok(wTime.sql.includes(`tte.user_id IN (SELECT tmc.user_id FROM portfolio_team_member_configs tmc WHERE tmc.tenant_id = $1 AND tmc.team_id::text = ANY(${team}::text[]))`));
    assert.ok(wTime.sql.includes(`pte.user_id IN (SELECT tmc.user_id FROM portfolio_team_member_configs tmc WHERE tmc.tenant_id = $1 AND tmc.team_id::text = ANY(${team}::text[]))`));
  }
  // People: only the people the filtered rows and the filtered time name.
  assert.ok(wPeople.sql.includes('FROM users u'));
  assert.deepEqual(wPeople.params[1], ['u1']);

  // Without the filters, none of it.
  const plainWeekly = recorder((sql) => (sql.includes('JOIN tasks t ON t.id = a.record_id') ? [taskRow] : []));
  await new PortfolioWeeklyReportService().list(weeklyBase, { manager: plainWeekly.manager });
  for (const call of plainWeekly.calls) {
    assert.ok(!call.sql.includes('portfolio_team_member_configs tmc'), 'no team predicate');
    assert.ok(!call.sql.includes('related_object_id::text = ANY('), 'no project predicate');
    assert.ok(!call.sql.includes('project_id::text = ANY('), 'no project predicate');
    assert.ok(!call.sql.includes('p.id::text = ANY('), 'no project predicate');
  }
  assert.equal(plainWeekly.calls[3].params.length, 4, 'the time query keeps its four parameters');

  // One filter alone: the team only leaves the project out.
  const teamOnly = recorder();
  await new PortfolioWeeklyReportService().list({ ...weeklyBase, groupBy: 'type', teamIds: [T1] }, { manager: teamOnly.manager });
  for (const call of teamOnly.calls) {
    assert.ok(call.sql.includes('portfolio_team_member_configs tmc'));
    assert.ok(!call.sql.includes('related_object_id::text = ANY('));
    assert.ok(!call.sql.includes('rpf.project_id'));
    assert.ok(!call.sql.includes('p.id::text = ANY('));
  }

  /* ----------------------------------------------------------------- */
  /*  Flow report                                                      */
  /* ----------------------------------------------------------------- */

  const flow = recorder();
  const flowReport = await new PortfolioFlowReportService().getReport(
    TENANT,
    { weeks: 8, months: 6, timeZone: 'Europe/Paris', projectIds: [P1, ' '], teamIds: [T1, T1] },
    { manager: flow.manager },
  );
  assert.deepEqual(flowReport.projectIds, [P1], 'echoed, normalised');
  assert.deepEqual(flowReport.teamIds, [T1]);
  assert.equal(flow.calls.length, 12);
  for (const call of flow.calls) {
    const project = placeholderOf(call, [P1]);
    const team = placeholderOf(call, [T1]);
    const liveEnd = call.sql.indexOf('audit AS') >= 0 ? call.sql.indexOf('audit AS') : call.sql.length;
    const isTask = call.sql.includes('FROM tasks t');
    const isRequest = call.sql.includes('FROM portfolio_requests r');
    const predicate = isTask
      ? `t.related_object_id::text = ANY(${project}::text[])`
      : isRequest
        ? `rpf.project_id::text = ANY(${project}::text[])`
        : `p.id::text = ANY(${project}::text[])`;
    assert.ok(call.sql.includes(predicate), predicate);
    assert.ok(call.sql.indexOf(predicate) < liveEnd, 'the predicate sits inside the live rows');
    assert.ok(call.sql.includes(`tmc.team_id::text = ANY(${team}::text[])`));
    assert.equal(call.params[0], TENANT);
  }
  const plainFlow = recorder();
  const plainFlowReport = await new PortfolioFlowReportService().getReport(TENANT, { weeks: 8, months: 6 }, { manager: plainFlow.manager });
  assert.deepEqual(plainFlowReport.projectIds, []);
  assert.deepEqual(plainFlowReport.teamIds, []);
  for (const call of plainFlow.calls) {
    assert.ok(!call.sql.includes('portfolio_team_member_configs tmc'));
    assert.ok(!call.sql.includes('related_object_id::text = ANY('));
    assert.ok(!call.sql.includes('rpf.project_id'));
  }

  /* ----------------------------------------------------------------- */
  /*  Attention by assignee                                            */
  /* ----------------------------------------------------------------- */

  const attention = recorder((sql) =>
    sql.includes('assignee_user_id IS NULL') ? [{ open: 0, overdue: 0, stale: 0 }] : [],
  );
  await new PortfolioAssigneeAttentionService().getReport(
    TENANT,
    { staleDays: 14, timeZone: 'Europe/Paris', projectIds: [P1], teamIds: [T1] },
    { manager: attention.manager },
  );
  assert.equal(attention.calls.length, 2);
  for (const call of attention.calls) {
    assert.deepEqual(call.params.slice(4), [[P1], [T1]], 'after the four fixed parameters');
    assert.ok(call.sql.includes(`t.related_object_id::text = ANY($5::text[])`));
    assert.ok(call.sql.includes('tmc.tenant_id = t.tenant_id AND tmc.team_id::text = ANY($6::text[])'));
  }
  // The unassigned line: no assignee can belong to a team, so it counts nothing under the filter.
  const unassignedCall = attention.calls.find((call) => call.sql.includes('assignee_user_id IS NULL'))!;
  assert.ok(unassignedCall.sql.includes('t.assignee_user_id IS NULL AND'));
  const plainAttention = recorder((sql) =>
    sql.includes('assignee_user_id IS NULL') ? [{ open: 0, overdue: 0, stale: 0 }] : [],
  );
  await new PortfolioAssigneeAttentionService().getReport(TENANT, { staleDays: 14 }, { manager: plainAttention.manager });
  for (const call of plainAttention.calls) {
    assert.equal(call.params.length, 4);
    assert.ok(!call.sql.includes('portfolio_team_member_configs tmc'));
  }

  /* ----------------------------------------------------------------- */
  /*  List filters the links carry                                     */
  /* ----------------------------------------------------------------- */

  // Tasks: the project by id and the team of the assignee, bound, tenant-scoped.
  const tasks = recorder((sql) => (sql.includes('COUNT(*)') ? [{ count: 0 }] : []));
  await new TasksService(null as any).listAllTasks(
    {
      filters: JSON.stringify({
        related_object_type: { filterType: 'set', values: ['project'] },
        related_object_id: { filterType: 'set', values: [P1, P2] },
        assignee_team_id: { filterType: 'set', values: [T1] },
      }),
    },
    { manager: tasks.manager, tenantId: TENANT },
  );
  const taskCount = tasks.calls[0];
  assert.equal(taskCount.params[0], TENANT);
  {
    const p1 = placeholderOf(taskCount, P1);
    const p2 = placeholderOf(taskCount, P2);
    assert.ok(taskCount.sql.includes(`t.related_object_id IN (${p1}, ${p2})`));
    const team = placeholderOf(taskCount, [T1]);
    assert.ok(/t\.assignee_user_id IN \(\s*SELECT user_id FROM portfolio_team_member_configs\s*WHERE team_id::text = ANY\(\$\d+::text\[\]\) AND tenant_id = \$1\s*\)/.test(taskCount.sql));
    assert.ok(taskCount.sql.includes(`team_id::text = ANY(${team}::text[])`));
  }
  const emptyTeam = recorder((sql) => (sql.includes('COUNT(*)') ? [{ count: 0 }] : []));
  await new TasksService(null as any).listAllTasks(
    { filters: JSON.stringify({ assignee_team_id: { filterType: 'set', values: [null] } }) },
    { manager: emptyTeam.manager, tenantId: TENANT },
  );
  assert.ok(emptyTeam.calls[0].sql.includes('AND 1=0'), 'no team value matches nothing');

  // Projects: the project by id, and the team rule of the list's own scope.
  let n = 0;
  const next = () => `p${n++}`;
  assert.equal(compileProjectLinkFilter('status', { filterType: 'set', values: ['x'] }, next), undefined);
  assert.deepEqual(compileProjectLinkFilter('id', { filterType: 'set', values: [P1] }, next), {
    sql: 'p.id::text IN (:...p0)',
    params: { p0: [P1] },
  });
  const projectTeam = compileProjectLinkFilter('involved_team_id', { filterType: 'set', values: [T1] }, next)!;
  assert.deepEqual(projectTeam.params, { p1: [T1] });
  assert.ok(projectTeam.sql.includes('tmc.tenant_id = p.tenant_id'));
  assert.ok(projectTeam.sql.includes('tmc.team_id::text IN (:...p1)'));
  for (const role of PROJECT_ROLES) assert.ok(projectTeam.sql.includes(`p.${role} IN`), role);
  assert.ok(projectTeam.sql.includes('FROM portfolio_project_team pt'));
  assert.deepEqual(compileProjectLinkFilter('id', { filterType: 'set', values: [null] }, next), { sql: '1=0', params: {} });

  // Requests: linked to the project, and the team rule of the list's own scope.
  n = 0;
  assert.equal(compileRequestLinkFilter('status', { filterType: 'set', values: ['x'] }, next), undefined);
  const linked = compileRequestLinkFilter('linked_project_id', { filterType: 'set', values: [P1] }, next)!;
  assert.deepEqual(linked.params, { p0: [P1] });
  assert.ok(linked.sql.includes('FROM portfolio_request_projects rpf'));
  assert.ok(linked.sql.includes('rpf.tenant_id = r.tenant_id'));
  assert.ok(linked.sql.includes('rpf.project_id::text = ANY(:p0::text[])'));
  const requestTeam = compileRequestLinkFilter('involved_team_id', { filterType: 'set', values: [T1] }, next)!;
  assert.deepEqual(requestTeam.params, { p1: [T1] });
  assert.ok(requestTeam.sql.includes('tmc.tenant_id = r.tenant_id'));
  for (const role of REQUEST_ROLES) assert.ok(requestTeam.sql.includes(`r.${role} IN`), role);
  assert.ok(requestTeam.sql.includes('FROM portfolio_request_team rt'));

  console.log('portfolio-report-project-team-filters.spec.ts: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
