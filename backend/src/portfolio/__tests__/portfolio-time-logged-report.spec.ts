import * as assert from 'node:assert/strict';
import { buildMonths, todayIn } from '../services/portfolio-flow-report.service';
import {
  normalizeTimeLoggedMonths,
  PortfolioTimeLoggedReportService,
} from '../services/portfolio-time-logged-report.service';

type Call = { sql: string; params: any[] };

/**
 * A stand-in for the tenant-bound manager: the hours statement is recognised by its union, the
 * people statement by its `users` table. Every call is kept so the SQL and its bound parameters
 * can be checked.
 */
function stubManager(hours: Array<Record<string, unknown>>, people: Array<Record<string, unknown>>) {
  const calls: Call[] = [];
  const manager = {
    query: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.includes('UNION ALL')) return hours;
      if (sql.includes('FROM users u')) return people;
      throw new Error(`Unexpected statement: ${sql}`);
    },
  } as any;
  return { manager, calls };
}

const person = (
  userId: string,
  name: string,
  team: { id: string; name: string; order: number } | null,
  extra: Record<string, unknown> = {},
) => ({
  user_id: userId,
  name,
  item_number: extra.item_number ?? null,
  team_id: team?.id ?? null,
  team_name: team?.name ?? null,
  team_order: team?.order ?? null,
  is_contributor: extra.is_contributor ?? true,
});

const hoursRow = (userId: string | null, month: string, isProject: boolean, hours: number | string) => ({
  user_id: userId,
  month,
  is_project: isProject,
  hours,
});

const TENANT = '00000000-0000-0000-0000-000000000001';
const INFRA = { id: 'team-infra', name: 'Infrastructure', order: 0 };
const APPS = { id: 'team-apps', name: 'Business applications', order: 1 };

async function run() {
  /* ----------------------------------------------------------------- */
  /*  Horizon                                                          */
  /* ----------------------------------------------------------------- */

  assert.equal(normalizeTimeLoggedMonths(6), 6);
  assert.equal(normalizeTimeLoggedMonths('12'), 12);
  assert.equal(normalizeTimeLoggedMonths(24), 6);
  assert.equal(normalizeTimeLoggedMonths(undefined), 6);
  assert.equal(normalizeTimeLoggedMonths('all'), 6);

  const svc = new PortfolioTimeLoggedReportService();
  const today = todayIn('UTC');
  const months6 = buildMonths(today, 6).map((bound) => bound.periodStart.slice(0, 7));
  const months12 = buildMonths(today, 12).map((bound) => bound.periodStart.slice(0, 7));
  const [first, second] = months6;
  const current = months6[5];

  {
    const { manager, calls } = stubManager([], []);
    const report = await svc.getReport(TENANT, { months: 12, timeZone: 'Europe/Paris' }, { manager });
    assert.deepEqual(report.months, months12);
    assert.equal(report.months.length, 12);
    assert.equal(report.months[11], today.slice(0, 7), 'the month in progress is the last one');
    assert.equal(report.series.length, 12);
    assert.deepEqual(report.teams, []);
    assert.deepEqual(report.totals, {
      projectDays: 0,
      otherDays: 0,
      totalDays: 0,
      contributorsWithoutEntries: 0,
      contributorsTotal: 0,
    });
    // The window opens on the first day of the oldest month and closes today, in the zone given.
    const hoursCall = calls.find((call) => call.sql.includes('UNION ALL'))!;
    assert.deepEqual(hoursCall.params.slice(0, 4), [TENANT, `${months12[0]}-01`, 'Europe/Paris', todayIn('Europe/Paris')]);
  }

  {
    const { manager } = stubManager([], []);
    const report = await svc.getReport(TENANT, {}, { manager });
    assert.deepEqual(report.months, months6, 'six months by default');
  }

  /* ----------------------------------------------------------------- */
  /*  Assembly                                                         */
  /* ----------------------------------------------------------------- */

  const hours = [
    // Alice: project and other time in the first month, 3 × 1.5 h of project time rounds once.
    hoursRow('u-alice', first, true, '4.50'),
    hoursRow('u-alice', first, false, '8'),
    hoursRow('u-alice', current, true, '1.5'),
    // Bob, other time only.
    hoursRow('u-bob', second, false, 2),
    // Chloé has no team.
    hoursRow('u-chloe', second, true, 16),
    // Entries without a person.
    hoursRow(null, current, false, 4),
    // Outside the window: ignored.
    hoursRow('u-bob', '1999-01', false, 80),
  ];
  const people = [
    person('u-bob', 'Bob Durand', APPS, { item_number: 3 }),
    person('u-alice', 'Alice Martin', APPS, { item_number: 12 }),
    person('u-dan', 'Dan Petit', INFRA, { item_number: 7 }),
    person('u-chloe', 'Chloé Blanc', null, { is_contributor: false }),
    person('u-eve', 'Eve Roux', null, { item_number: 9 }),
  ];

  const { manager, calls } = stubManager(hours, people);
  const report = await svc.getReport(TENANT, { months: 6, timeZone: 'UTC' }, { manager });

  // Every statement is tenant-bound, the zone and the window travel as parameters.
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.params[0], TENANT);
  const hoursSql = calls[0].sql;
  assert.match(hoursSql, /FROM task_time_entries tte/);
  assert.match(hoursSql, /JOIN tasks t ON t\.id = tte\.task_id AND t\.tenant_id = \$1/);
  assert.match(hoursSql, /WHERE tte\.tenant_id = \$1/);
  assert.match(hoursSql, /FROM portfolio_project_time_entries pte/);
  assert.match(hoursSql, /WHERE pte\.tenant_id = \$1/);
  assert.match(hoursSql, /date_trunc\('month', e\.logged_at AT TIME ZONE \$3\)/);
  assert.match(hoursSql, /COALESCE\(t\.related_object_type = 'project', FALSE\) AS is_project/);
  assert.match(hoursSql, /GROUP BY e\.user_id, month, e\.is_project/);
  assert.doesNotMatch(hoursSql, /notes/, 'the notes of an entry are never read');
  const peopleCall = calls[1];
  assert.match(peopleCall.sql, /WHERE u\.tenant_id = \$1/);
  assert.match(peopleCall.sql, /mc\.tenant_id = \$1/);
  assert.match(peopleCall.sql, /pt\.tenant_id = \$1/);
  assert.deepEqual([...peopleCall.params[1]].sort(), ['u-alice', 'u-bob', 'u-chloe']);
  assert.doesNotMatch(peopleCall.sql, /u\.email AS/, 'names only, never an email');

  // Totals: project and other apart, rounded once from the summed hours.
  // Project: 4.5 + 1.5 + 16 = 22 h = 2.75 d → 2.8. Other: 8 + 2 + 4 = 14 h = 1.75 d → 1.8.
  // Total: 36 h = 4.5 d, and not 2.8 + 1.8 = 4.6.
  assert.equal(report.totals.projectDays, 2.8);
  assert.equal(report.totals.otherDays, 1.8);
  assert.equal(report.totals.totalDays, 4.5);
  // Four contributor profiles (Chloé has none), Dan and Eve logged nothing.
  assert.equal(report.totals.contributorsTotal, 4);
  assert.equal(report.totals.contributorsWithoutEntries, 2);

  // The series is the whole scope month by month, the person-less entries included.
  assert.deepEqual(report.series[0], { month: first, projectDays: 0.6, otherDays: 1, totalDays: 1.6 });
  assert.deepEqual(report.series[1], { month: second, projectDays: 2, otherDays: 0.3, totalDays: 2.3 });
  assert.deepEqual(report.series[5], { month: current, projectDays: 0.2, otherDays: 0.5, totalDays: 0.7 });
  assert.equal(report.series.length, 6);

  // Teams in display order, the group without a team last.
  assert.deepEqual(
    report.teams.map((team) => team.teamName),
    ['Infrastructure', 'Business applications', null],
  );
  const [infra, apps, noTeam] = report.teams;

  // A contributor without entries is listed all the same, with empty cells.
  assert.deepEqual(infra.members.map((member) => member.name), ['Dan Petit']);
  assert.equal(infra.members[0].contributorRef, 'CTR-7');
  assert.equal(infra.members[0].cells.length, 6);
  assert.ok(infra.members[0].cells.every((cell) => cell.projectDays === 0 && cell.otherDays === 0));
  assert.ok(infra.cells.every((cell) => cell.projectDays === 0 && cell.otherDays === 0));

  // People in alphabetical order, never by value.
  assert.deepEqual(apps.members.map((member) => member.name), ['Alice Martin', 'Bob Durand']);
  assert.deepEqual(apps.members[0].cells[0], { month: first, projectDays: 0.6, otherDays: 1, totalDays: 1.6 });
  // A team is the sum of its people, rounded from its hours.
  assert.deepEqual(apps.cells[0], { month: first, projectDays: 0.6, otherDays: 1, totalDays: 1.6 });
  assert.deepEqual(apps.cells[1], { month: second, projectDays: 0, otherDays: 0.3, totalDays: 0.3 });
  assert.deepEqual(apps.cells[5], { month: current, projectDays: 0.2, otherDays: 0, totalDays: 0.2 });

  // No team: people without a team or a profile, then the unknown user.
  assert.equal(noTeam.teamId, null);
  assert.deepEqual(noTeam.members.map((member) => [member.userId, member.name]), [
    ['u-chloe', 'Chloé Blanc'],
    ['u-eve', 'Eve Roux'],
    [null, ''],
  ]);
  assert.equal(noTeam.members[0].contributorRef, null);
  assert.deepEqual(noTeam.members[2].cells[5], { month: current, projectDays: 0, otherDays: 0.5, totalDays: 0.5 });
  assert.deepEqual(noTeam.cells[1], { month: second, projectDays: 2, otherDays: 0, totalDays: 2 });
  assert.deepEqual(noTeam.cells[5], { month: current, projectDays: 0, otherDays: 0.5, totalDays: 0.5 });

  // The unknown user line only exists when such entries do.
  {
    const { manager: plain } = stubManager([hoursRow('u-alice', first, true, 8)], [person('u-alice', 'Alice Martin', APPS)]);
    const plainReport = await svc.getReport(TENANT, {}, { manager: plain });
    assert.deepEqual(plainReport.teams.map((team) => team.teamId), ['team-apps']);
  }

  /* ----------------------------------------------------------------- */
  /*  Project and team filters                                         */
  /* ----------------------------------------------------------------- */

  {
    const { manager: filtered, calls: filteredCalls } = stubManager([], []);
    await svc.getReport(
      TENANT,
      { months: 6, timeZone: 'UTC', projectIds: ['p-1', ' p-1 ', ''], teamIds: ['team-apps'] },
      { manager: filtered },
    );
    const [hoursCall, peopleCall2] = filteredCalls;
    // The project keeps the entries on its tasks and the ones logged on it directly.
    assert.match(
      hoursCall.sql,
      /AND t\.related_object_type = 'project' AND t\.related_object_id::text = ANY\(\$5::text\[\]\)/,
    );
    assert.match(hoursCall.sql, /AND pte\.project_id::text = ANY\(\$5::text\[\]\)/);
    // The team keeps its members' entries, members read on the same tenant.
    assert.match(hoursCall.sql, /AND tte\.user_id IN \(SELECT tmc\.user_id FROM portfolio_team_member_configs tmc WHERE tmc\.tenant_id = \$1 AND tmc\.team_id::text = ANY\(\$6::text\[\]\)\)/);
    assert.match(hoursCall.sql, /AND pte\.user_id IN \(SELECT tmc\.user_id/);
    assert.deepEqual(hoursCall.params.slice(4), [['p-1'], ['team-apps']]);
    // The people are the team's contributors.
    assert.match(peopleCall2.sql, /mc\.id IS NOT NULL AND u\.id IN \(SELECT tmc\.user_id FROM portfolio_team_member_configs tmc WHERE tmc\.tenant_id = \$1 AND tmc\.team_id::text = ANY\(\$3::text\[\]\)\)/);
    assert.deepEqual(peopleCall2.params[2], ['team-apps']);
  }

  {
    const { manager: unfiltered, calls: unfilteredCalls } = stubManager([], []);
    await svc.getReport(TENANT, { projectIds: [], teamIds: [] }, { manager: unfiltered });
    assert.doesNotMatch(unfilteredCalls[0].sql, /ANY\(\$5/);
    assert.equal(unfilteredCalls[0].params.length, 4);
    assert.equal(unfilteredCalls[1].params.length, 2);
  }

  // A manager is required: the report never runs outside a tenant-bound transaction.
  await assert.rejects(() => svc.getReport(TENANT, {}, {}), /tenant-bound EntityManager/);

  console.log('portfolio-time-logged-report.spec: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
