import * as assert from 'node:assert/strict';
import {
  PortfolioAssigneeAttentionService,
  normalizeStaleDays,
} from '../services/portfolio-assignee-attention.service';

type Call = { sql: string; params: any[] };

/**
 * A stand-in for the tenant-bound manager. The two statements are told apart by a fragment of
 * their text, so the assembly can be tested without a database while still proving that both
 * filter on the tenant.
 */
function stubManager(people: Array<Record<string, unknown>>, unassigned: Record<string, unknown>) {
  const calls: Call[] = [];
  // Two queries in flight at once are the node-postgres warning
  // (`client.query() when the client is already executing a query`).
  let busy = 0;
  const manager = {
    query: async (sql: string, params: any[]) => {
      if (busy > 0) throw new Error('client.query() when the client is already executing a query');
      busy += 1;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        calls.push({ sql, params });
        return sql.includes('assignee_user_id IS NULL') ? [unassigned] : people;
      } finally {
        busy -= 1;
      }
    },
  } as any;
  return { manager, calls };
}

const person = (over: Record<string, unknown>) => ({
  user_id: 'u',
  name: 'Someone',
  item_number: null,
  team_id: null,
  team_name: null,
  open: 1,
  overdue: 0,
  stale: 0,
  ...over,
});

async function run() {
  /* ----------------------------------------------------------------- */
  /*  Window normalisation                                             */
  /* ----------------------------------------------------------------- */

  assert.equal(normalizeStaleDays(7), 7);
  assert.equal(normalizeStaleDays('30'), 30);
  assert.equal(normalizeStaleDays(14), 14);
  assert.equal(normalizeStaleDays(undefined), 14, 'no window asked for reads as the default');
  assert.equal(normalizeStaleDays(21), 14, 'a window nobody offers reads as the default');
  assert.equal(normalizeStaleDays('soon'), 14);

  /* ----------------------------------------------------------------- */
  /*  Days in the viewer's zone                                        */
  /* ----------------------------------------------------------------- */

  const svc = new PortfolioAssigneeAttentionService();
  const tenantId = '11111111-1111-1111-1111-111111111111';

  const zoned = stubManager([], { open: 0, overdue: 0, stale: 0 });
  const zonedReport = await svc.getReport(
    tenantId,
    { staleDays: 7, timeZone: 'Pacific/Auckland' },
    { manager: zoned.manager },
  );
  const expectedAsOf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  assert.equal(zonedReport.asOf, expectedAsOf, 'today is read in the viewer zone, not in UTC');
  const asOfDate = new Date(`${zonedReport.asOf}T00:00:00Z`);
  const staleDate = new Date(`${zonedReport.staleBefore}T00:00:00Z`);
  assert.equal((asOfDate.getTime() - staleDate.getTime()) / 86400000, 7, 'the window is a whole number of days');
  assert.equal(zonedReport.staleDays, 7);
  assert.deepEqual(zonedReport.teams, []);
  assert.deepEqual(zonedReport.totals, { open: 0, overdue: 0, stale: 0 });

  // Both statements carry the tenant and the two days as bound parameters.
  assert.equal(zoned.calls.length, 2);
  for (const call of zoned.calls) {
    assert.equal(call.params[0], tenantId, 'every statement is filtered on the tenant');
    assert.ok(call.sql.includes('t.tenant_id = $1'), 'the tenant predicate is in the SQL');
    assert.deepEqual(call.params[1], ['open', 'in_progress', 'pending', 'in_testing']);
    assert.equal(call.params[2], zonedReport.asOf);
    assert.equal(call.params[3], zonedReport.staleBefore);
    assert.ok(!call.sql.includes(zonedReport.asOf), 'the days are never interpolated into the SQL');
    assert.ok(
      call.sql.includes("t.related_object_type IS NULL OR t.related_object_type = 'project'"),
      'only standalone and project tasks count',
    );
    // The list writes the same expression, so the figure and its link agree.
    assert.ok(call.sql.includes('t.updated_at::date <'), 'no movement is a plain day comparison');
  }

  /* ----------------------------------------------------------------- */
  /*  Groups, order and sums                                           */
  /* ----------------------------------------------------------------- */

  const { manager, calls } = stubManager(
    [
      person({ user_id: 'u3', name: 'Zoe Blanc', team_id: 't2', team_name: 'Infrastructure', open: 2, overdue: 1, stale: 2 }),
      person({ user_id: 'u1', name: 'Alice Martin', team_id: 't1', team_name: 'Applications', item_number: 12, open: 9, overdue: 5, stale: 6 }),
      person({ user_id: 'u4', name: 'Marc Petit', open: 5, overdue: 5, stale: 5 }),
      person({ user_id: 'u2', name: 'Bob Durand', team_id: 't1', team_name: 'Applications', item_number: 3, open: 4, overdue: 3, stale: 4 }),
    ],
    { open: 3, overdue: 0, stale: 3 },
  );

  const report = await svc.getReport(tenantId, { staleDays: 14, timeZone: 'Europe/Paris' }, { manager });

  assert.deepEqual(
    report.teams.map((team) => team.teamName),
    ['Applications', 'Infrastructure', null],
    'teams read by name, the people without a team last',
  );
  assert.equal(report.teams[2].teamId, null);

  const applications = report.teams[0];
  assert.deepEqual(
    applications.members.map((member) => member.name),
    ['Alice Martin', 'Bob Durand'],
    'members read by name',
  );
  assert.deepEqual(
    { open: applications.open, overdue: applications.overdue, stale: applications.stale },
    { open: 13, overdue: 8, stale: 10 },
    'a team counts what its members count',
  );
  assert.equal(applications.members[0].contributorRef, 'CTR-12');
  assert.equal(report.teams[2].members[0].contributorRef, null, 'no profile, no contributor reference');

  assert.deepEqual(report.unassigned, { open: 3, overdue: 0, stale: 3 });
  assert.deepEqual(report.totals, { open: 23, overdue: 14, stale: 20 }, 'the total covers the groups and the unassigned');
  assert.equal(
    report.totals.open,
    report.teams.reduce((sum, team) => sum + team.open, 0) + report.unassigned.open,
  );
  assert.equal(calls.length, 2, 'two statements, never one per person');

  // A manager is mandatory: the report has no way to reach a tenant-scoped connection without it.
  await assert.rejects(() => svc.getReport(tenantId, {}, {}));

  console.log('portfolio-assignee-attention.spec.ts: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
