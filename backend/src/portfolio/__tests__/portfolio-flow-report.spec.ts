import * as assert from 'node:assert/strict';
import {
  PortfolioFlowReportService,
  buildMonths,
  buildWeeks,
  monthBucketOf,
  normalizeFlowMonths,
  normalizeFlowWeeks,
  shiftDay,
  todayIn,
} from '../services/portfolio-flow-report.service';
import { parseCsvIds } from '../services/portfolio-report-filters';

type Call = { sql: string; params: any[] };

/**
 * A stand-in for the tenant-bound manager. It recognises each statement by a fragment of its
 * text, so the assembly can be tested without a database while still proving that every query
 * filters on the tenant and passes the zone as a bound parameter.
 */
function stubManager(answers: {
  periods: Record<string, Array<Record<string, unknown>>>;
  totals: Record<string, Array<Record<string, unknown>>>;
  taskAge: Array<Record<string, unknown>>;
  createdAge: Record<string, Array<Record<string, unknown>>>;
  openItems: Record<string, Array<Record<string, unknown>>>;
}) {
  const calls: Call[] = [];
  const manager = {
    query: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.includes('open_tasks AS')) return answers.taskAge;
      // The creation-age query has no table parameter: it is recognised by its open statuses.
      if (sql.includes('GROUP BY l.status, age_days')) {
        const first = String((params[1] ?? [])[0]);
        return answers.createdAge[first === 'pending_review' ? 'requests' : 'projects'] ?? [];
      }
      const table = String(params[1]);
      if (sql.includes('open_items AS')) return answers.openItems[table] ?? [];
      if (sql.includes('open_at_end AS')) return answers.periods[table] ?? [];
      return answers.totals[table] ?? [];
    },
  } as any;
  return { manager, calls };
}

/** One (status, age) group as the creation-age query hands it over. */
const ageGroup = (status: string, ageDays: number, n = 1) => ({ status, age_days: ageDays, n });

/** One open item as the by-status query hands it over. */
const openItem = (
  itemNumber: number,
  status: string,
  ageDays: number,
  extra: Record<string, unknown> = {},
) => ({
  id: `id-${itemNumber}`,
  item_number: itemNumber,
  name: `Item ${itemNumber}`,
  status,
  status_since: '2026-01-15',
  age_days: ageDays,
  planned_end: null,
  planned_end_passed: false,
  ...extra,
});

async function run() {
  /* ----------------------------------------------------------------- */
  /*  Period normalisation                                             */
  /* ----------------------------------------------------------------- */

  assert.equal(normalizeFlowWeeks(8), 8);
  assert.equal(normalizeFlowWeeks('13'), 13);
  assert.equal(normalizeFlowWeeks(' 26 '), 26);
  assert.equal(normalizeFlowWeeks(12), 13);
  assert.equal(normalizeFlowWeeks(0), 13);
  assert.equal(normalizeFlowWeeks(-26), 13);
  assert.equal(normalizeFlowWeeks(undefined), 13);
  assert.equal(normalizeFlowWeeks('all'), 13);
  assert.equal(normalizeFlowWeeks('13; DROP TABLE audit_log'), 13);

  assert.equal(normalizeFlowMonths(6), 6);
  assert.equal(normalizeFlowMonths('12'), 12);
  assert.equal(normalizeFlowMonths(' 24 '), 24);
  assert.equal(normalizeFlowMonths(18), 12);
  assert.equal(normalizeFlowMonths(0), 12);
  assert.equal(normalizeFlowMonths(-6), 12);
  assert.equal(normalizeFlowMonths(undefined), 12);
  assert.equal(normalizeFlowMonths('all'), 12);
  assert.equal(normalizeFlowMonths('12; DROP TABLE audit_log'), 12);
  // The two horizons are read from two different parameters and never share a value.
  assert.equal(normalizeFlowWeeks(12), 13);
  assert.equal(normalizeFlowMonths(13), 12);

  /* ----------------------------------------------------------------- */
  /*  Week bounds                                                      */
  /* ----------------------------------------------------------------- */

  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');

  // A Wednesday: the last week starts on the Monday and stops today, earlier weeks are full.
  const midWeek = buildWeeks('2026-09-23', 13);
  assert.equal(midWeek.length, 13);
  assert.deepEqual(midWeek[12], { periodStart: '2026-09-21', periodEnd: '2026-09-23' });
  assert.deepEqual(midWeek[11], { periodStart: '2026-09-14', periodEnd: '2026-09-20' });
  assert.deepEqual(midWeek[0], { periodStart: '2026-06-29', periodEnd: '2026-07-05' });

  // A Sunday closes its own week; a Monday opens a one-day week.
  assert.deepEqual(buildWeeks('2026-09-20', 8)[7], { periodStart: '2026-09-14', periodEnd: '2026-09-20' });
  assert.deepEqual(buildWeeks('2026-09-21', 8)[7], { periodStart: '2026-09-21', periodEnd: '2026-09-21' });

  // 8, 13 and 26 all end on the same day and only differ by how far back they start.
  for (const weeks of [8, 13, 26]) {
    const bounds = buildWeeks('2026-09-23', weeks);
    assert.equal(bounds.length, weeks);
    assert.equal(bounds[bounds.length - 1].periodEnd, '2026-09-23');
    assert.equal(bounds[0].periodStart, shiftDay('2026-09-21', -7 * (weeks - 1)));
    for (let index = 1; index < bounds.length; index += 1) {
      assert.equal(bounds[index].periodStart, shiftDay(bounds[index - 1].periodStart, 7));
    }
  }

  /* ----------------------------------------------------------------- */
  /*  Month bounds                                                     */
  /* ----------------------------------------------------------------- */

  // The month in progress stops on today; the ones before it run to their own last day.
  const twelve = buildMonths('2026-09-22', 12);
  assert.equal(twelve.length, 12);
  assert.deepEqual(twelve[11], { periodStart: '2026-09-01', periodEnd: '2026-09-22' });
  assert.deepEqual(twelve[10], { periodStart: '2026-08-01', periodEnd: '2026-08-31' });
  assert.deepEqual(twelve[0], { periodStart: '2025-10-01', periodEnd: '2025-10-31' });

  // 24 months back from a January crosses two year boundaries and lands on February 2024.
  const fromJanuary = buildMonths('2026-01-07', 24);
  assert.equal(fromJanuary.length, 24);
  assert.deepEqual(fromJanuary[23], { periodStart: '2026-01-01', periodEnd: '2026-01-07' });
  assert.deepEqual(fromJanuary[22], { periodStart: '2025-12-01', periodEnd: '2025-12-31' });
  assert.deepEqual(fromJanuary[12], { periodStart: '2025-02-01', periodEnd: '2025-02-28' });
  assert.deepEqual(fromJanuary[0], { periodStart: '2024-02-01', periodEnd: '2024-02-29' });

  // Short months and a leap February keep their real length, and the months never overlap.
  const leap = buildMonths('2024-03-31', 6);
  assert.deepEqual(leap[4], { periodStart: '2024-02-01', periodEnd: '2024-02-29' });
  assert.deepEqual(leap[3], { periodStart: '2024-01-01', periodEnd: '2024-01-31' });
  assert.deepEqual(leap[5], { periodStart: '2024-03-01', periodEnd: '2024-03-31' });
  for (let index = 1; index < leap.length; index += 1) {
    assert.equal(leap[index].periodStart, shiftDay(leap[index - 1].periodEnd, 1));
  }

  // The last day of a month is still the month in progress, not the whole month plus a day.
  assert.deepEqual(buildMonths('2026-04-30', 6)[5], { periodStart: '2026-04-01', periodEnd: '2026-04-30' });

  /* ----------------------------------------------------------------- */
  /*  Creation age brackets                                            */
  /* ----------------------------------------------------------------- */

  assert.equal(monthBucketOf(0), 'underOneMonth');
  assert.equal(monthBucketOf(29), 'underOneMonth');
  assert.equal(monthBucketOf(30), 'oneToThreeMonths');
  assert.equal(monthBucketOf(91), 'oneToThreeMonths');
  assert.equal(monthBucketOf(92), 'threeToSixMonths');
  assert.equal(monthBucketOf(182), 'threeToSixMonths');
  assert.equal(monthBucketOf(183), 'overSixMonths');
  assert.equal(monthBucketOf(4000), 'overSixMonths');

  /* ----------------------------------------------------------------- */
  /*  A zone west of UTC                                               */
  /* ----------------------------------------------------------------- */

  const OriginalDate = Date;
  const freeze = (iso: string) => {
    const fixed = new OriginalDate(iso).getTime();
    (global as any).Date = class extends OriginalDate {
      constructor(...args: any[]) {
        // @ts-expect-error the real constructor takes the forwarded arguments
        super(...(args.length ? args : [fixed]));
      }
      static now() {
        return fixed;
      }
    };
  };

  try {
    // 2026-09-21 07:30 UTC is 2026-09-21 00:30 in Los Angeles: a Monday, so a one-day week.
    freeze('2026-09-21T07:30:00Z');
    assert.equal(todayIn('America/Los_Angeles'), '2026-09-21');
    assert.equal(todayIn('Europe/Paris'), '2026-09-21');
    const monday = buildWeeks(todayIn('America/Los_Angeles'), 8);
    assert.deepEqual(monday[7], { periodStart: '2026-09-21', periodEnd: '2026-09-21' });
    assert.deepEqual(monday[0], { periodStart: '2026-08-03', periodEnd: '2026-08-09' });

    // An hour earlier it is still Sunday in Los Angeles while Paris is already on Monday.
    freeze('2026-09-21T06:30:00Z');
    assert.equal(todayIn('America/Los_Angeles'), '2026-09-20');
    assert.equal(todayIn('Europe/Paris'), '2026-09-21');
    assert.deepEqual(buildWeeks(todayIn('America/Los_Angeles'), 13)[12], {
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
    });
    assert.deepEqual(buildWeeks(todayIn('America/Los_Angeles'), 26)[0], {
      periodStart: '2026-03-23',
      periodEnd: '2026-03-29',
    });

    // The first minutes of a month in Auckland are still the previous month in Paris, and the
    // 24-month window follows the zone it is read in, year change included.
    freeze('2025-12-31T12:00:00Z');
    assert.equal(todayIn('Pacific/Auckland'), '2026-01-01');
    assert.equal(todayIn('Europe/Paris'), '2025-12-31');
    const auckland = buildMonths(todayIn('Pacific/Auckland'), 24);
    assert.deepEqual(auckland[23], { periodStart: '2026-01-01', periodEnd: '2026-01-01' });
    assert.deepEqual(auckland[0], { periodStart: '2024-02-01', periodEnd: '2024-02-29' });
    const paris = buildMonths(todayIn('Europe/Paris'), 24);
    assert.deepEqual(paris[23], { periodStart: '2025-12-01', periodEnd: '2025-12-31' });
    assert.deepEqual(paris[0], { periodStart: '2024-01-01', periodEnd: '2024-01-31' });
  } finally {
    (global as any).Date = OriginalDate;
  }

  /* ----------------------------------------------------------------- */
  /*  Response assembly                                                */
  /* ----------------------------------------------------------------- */

  const svc = new PortfolioFlowReportService();
  const tenantId = '44dd2037-a4a7-4943-8b63-5b2c95cff52b';

  const { manager, calls } = stubManager({
    periods: {
      tasks: [
        { idx: 1, created: 4, closed: 1, open_at_end: 3 },
        { idx: 2, created: 2, closed: 5, open_at_end: 9 },
        { idx: 13, created: 3, closed: 2, open_at_end: 7 },
      ],
      portfolio_requests: [{ idx: 2, created: 1, closed: 0, open_at_end: 2 }],
      portfolio_projects: [],
    },
    totals: {
      tasks: [
        {
          open_now: 7,
          closed_count: 6,
          measured_count: 6,
          median_days: 12.44,
          by_type: [
            { taskTypeId: 't1', taskTypeName: 'Bug', taskTypeCode: 'bug', closedCount: 4, measuredCount: 4, medianDays: 8.2 },
            { taskTypeId: null, taskTypeName: null, closedCount: 2, measuredCount: 2, medianDays: 21 },
          ],
          by_outcome: null,
          done: null,
        },
      ],
      // Two of the five closed requests were imported already closed: they are counted, never
      // measured, and the medians ignore them.
      portfolio_requests: [
        {
          open_now: 4,
          closed_count: 5,
          measured_count: 3,
          median_days: 9,
          by_type: null,
          by_outcome: {
            converted: { closedCount: 3, measuredCount: 2, medianDays: 6.25 },
            rejected: { closedCount: 2, measuredCount: 1, medianDays: 14 },
          },
          done: null,
        },
      ],
      // Every project closing is a creation row: nothing is measurable, so no median at all.
      portfolio_projects: [
        {
          open_now: 14,
          closed_count: 4,
          measured_count: 0,
          median_days: null,
          by_type: null,
          by_outcome: null,
          done: { closedCount: 2, measuredCount: 0, medianDays: null, withPlannedEnd: 0, medianOverrunDays: null },
        },
      ],
    },
    taskAge: [
      {
        task_type_id: 't1',
        task_type_name: 'Bug',
        up_to_7: 2,
        from_8_to_30: 1,
        from_31_to_90: 0,
        over_90: 3,
        total: 6,
      },
      {
        task_type_id: null,
        task_type_name: null,
        up_to_7: 1,
        from_8_to_30: 0,
        from_31_to_90: 0,
        over_90: 0,
        total: 1,
      },
    ],
    createdAge: {
      requests: [
        ageGroup('pending_review', 12),
        ageGroup('pending_review', 200),
        ageGroup('approved', 91),
        // A status nobody reports on any more: it belongs to no fixed row and is left out.
        ageGroup('archived', 5),
      ],
      projects: [
        ageGroup('in_progress', 29),
        ageGroup('in_progress', 30, 2),
        ageGroup('waiting_list', 182),
        ageGroup('on_hold', 183),
      ],
    },
    openItems: {
      tasks: [
        openItem(1, 'open', 10),
        // Thirty days in the status is the threshold itself, so this one is not stuck yet.
        openItem(3, 'open', 30),
        openItem(2, 'in_progress', 31),
      ],
      portfolio_requests: [
        openItem(3, 'pending_review', 12),
        openItem(4, 'pending_review', 200),
        openItem(7, 'approved', 91),
        openItem(9, 'archived', 300),
      ],
      portfolio_projects: [
        openItem(1, 'in_progress', 29, { planned_end: '2026-02-01', planned_end_passed: true }),
        openItem(2, 'in_progress', 92, { planned_end: '2027-02-01', planned_end_passed: false }),
        openItem(5, 'waiting_list', 182),
        openItem(6, 'on_hold', 183, { planned_end: '2025-09-09', planned_end_passed: true }),
      ],
    },
  });

  const report = await svc.getReport(
    tenantId,
    { weeks: 'nonsense', months: 'nonsense', timeZone: 'Europe/Paris' },
    { manager },
  );

  assert.equal(report.weeks, 13);
  assert.equal(report.months, 12);
  assert.equal(report.timeZone, 'Europe/Paris');
  assert.equal(report.flow.tasks.granularity, 'week');
  assert.equal(report.flow.requests.granularity, 'month');
  assert.equal(report.flow.projects.granularity, 'month');
  assert.equal(report.flow.tasks.periods.length, 13);
  assert.equal(report.flow.requests.periods.length, 12);
  assert.equal(report.flow.projects.periods.length, 12);
  assert.equal(report.startDate, report.flow.tasks.periods[0].periodStart);
  assert.equal(report.monthsStartDate, report.flow.requests.periods[0].periodStart);
  assert.equal(report.endDate, report.flow.tasks.periods[12].periodEnd);
  assert.equal(report.endDate, report.flow.requests.periods[11].periodEnd);
  // The month window always reaches further back than the 13-week one.
  assert.ok(report.monthsStartDate < report.startDate);

  // Ordinality maps onto the window: row idx 1 is the oldest period, a missing row reads as zero.
  assert.deepEqual(
    { ...report.flow.tasks.periods[0], periodStart: 'x', periodEnd: 'x' },
    { periodStart: 'x', periodEnd: 'x', created: 4, closed: 1, openAtEnd: 3 },
  );
  assert.equal(report.flow.tasks.periods[1].created, 2);
  assert.equal(report.flow.tasks.periods[1].openAtEnd, 9);
  assert.equal(report.flow.tasks.periods[5].created, 0);
  assert.equal(report.flow.requests.periods[1].created, 1);
  assert.equal(report.flow.projects.periods[0].created, 0);

  assert.equal(report.flow.tasks.openNow, 7);
  assert.equal(report.flow.tasks.periods[12].openAtEnd, report.flow.tasks.openNow);
  assert.equal(report.flow.requests.openNow, 4);
  assert.equal(report.flow.projects.openNow, 14);

  /* ----------------------------------------------------------------- */
  /*  Lead time                                                        */
  /* ----------------------------------------------------------------- */

  assert.deepEqual(report.leadTime.tasks, { closedCount: 6, measuredCount: 6, medianDays: 12.4 });
  assert.deepEqual(report.leadTime.tasksByType, [
    { taskTypeId: 't1', taskTypeName: 'Bug', taskTypeCode: 'bug', closedCount: 4, measuredCount: 4, medianDays: 8.2 },
    { taskTypeId: null, taskTypeName: null, taskTypeCode: null, closedCount: 2, measuredCount: 2, medianDays: 21 },
  ]);
  // The closings stay at five, the median is read on the three real transitions.
  assert.deepEqual(report.leadTime.requests, {
    closedCount: 5,
    measuredCount: 3,
    medianDays: 9,
    converted: { closedCount: 3, measuredCount: 2, medianDays: 6.3 },
    rejected: { closedCount: 2, measuredCount: 1, medianDays: 14 },
  });
  // Nothing measurable: the closings are still counted, every median reads as nothing.
  assert.deepEqual(report.leadTime.projects, {
    closedCount: 4,
    measuredCount: 0,
    medianDays: null,
    done: { closedCount: 2, measuredCount: 0, medianDays: null, withPlannedEnd: 0, medianOverrunDays: null },
  });

  /* ----------------------------------------------------------------- */
  /*  Age of the open tasks                                            */
  /* ----------------------------------------------------------------- */

  assert.deepEqual(report.age.tasks.rows[1], {
    taskTypeId: null,
    taskTypeName: null,
    taskTypeCode: null,
    buckets: { upTo7: 1, from8To30: 0, from31To90: 0, over90: 0 },
    total: 1,
  });
  assert.deepEqual(report.age.tasks.total, {
    taskTypeId: null,
    taskTypeName: null,
    taskTypeCode: null,
    buckets: { upTo7: 3, from8To30: 1, from31To90: 0, over90: 3 },
    total: 7,
  });

  /* ----------------------------------------------------------------- */
  /*  How long ago the open work was created                           */
  /* ----------------------------------------------------------------- */

  // The rows follow the journey and stay in place even when nobody sits in the status.
  assert.deepEqual(
    report.age.requests.rows.map((row) => row.status),
    ['pending_review', 'candidate', 'approved', 'on_hold'],
  );
  assert.deepEqual(
    report.age.projects.rows.map((row) => row.status),
    ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold'],
  );
  assert.deepEqual(report.age.requests.rows[0], {
    status: 'pending_review',
    buckets: { underOneMonth: 1, oneToThreeMonths: 0, threeToSixMonths: 0, overSixMonths: 1 },
    total: 2,
  });
  assert.deepEqual(report.age.requests.rows[1], {
    status: 'candidate',
    buckets: { underOneMonth: 0, oneToThreeMonths: 0, threeToSixMonths: 0, overSixMonths: 0 },
    total: 0,
  });
  // 91 days is still the one-to-three bracket, 92 would not be.
  assert.equal(report.age.requests.rows[2].buckets.oneToThreeMonths, 1);
  // A request sitting in a status the report does not follow is left out of every figure.
  assert.equal(report.age.requests.total.total, 3);
  // The creation-age table holds figures only: its cells open a list, not an inner panel.
  assert.equal((report.age.requests as any).items, undefined);
  assert.equal((report.age.requests.total as any).plannedEndPassed, undefined);

  // 29 days is under a month, 30 days is not: the in-progress projects split, and a group of
  // two items on the same day lands whole in its bracket.
  assert.deepEqual(report.age.projects.rows[2], {
    status: 'in_progress',
    buckets: { underOneMonth: 1, oneToThreeMonths: 2, threeToSixMonths: 0, overSixMonths: 0 },
    total: 3,
  });
  assert.equal(report.age.projects.rows[0].buckets.threeToSixMonths, 1);
  assert.equal(report.age.projects.rows[4].buckets.overSixMonths, 1);
  assert.deepEqual(report.age.projects.total, {
    status: 'total',
    buckets: { underOneMonth: 1, oneToThreeMonths: 2, threeToSixMonths: 1, overSixMonths: 1 },
    total: 5,
  });

  /* ----------------------------------------------------------------- */
  /*  Where the open work sits, and what does not move                 */
  /* ----------------------------------------------------------------- */

  assert.equal(report.byStatus.tasks.thresholdDays, 30);
  assert.equal(report.byStatus.requests.thresholdDays, 91);
  assert.equal(report.byStatus.projects.thresholdDays, 91);

  assert.deepEqual(
    report.byStatus.tasks.rows.map((row) => row.status),
    ['open', 'in_progress', 'pending', 'in_testing'],
  );
  // Thirty days in the status is not "over thirty days": the threshold day itself still moves.
  assert.deepEqual(report.byStatus.tasks.rows[0], { status: 'open', open: 2, stuck: 0 });
  assert.deepEqual(report.byStatus.tasks.rows[1], { status: 'in_progress', open: 1, stuck: 1 });
  assert.deepEqual(report.byStatus.tasks.total, { status: 'total', open: 3, stuck: 1 });
  // Only the stuck items travel, and a task opens on its own workspace tab.
  assert.equal(report.byStatus.tasks.items.length, 1);
  assert.deepEqual(report.byStatus.tasks.items[0], {
    id: 'id-2',
    ref: 'T-2',
    itemPath: '/portfolio/tasks/T-2/overview',
    name: 'Item 2',
    status: 'in_progress',
    statusSince: '2026-01-15',
  });

  // 91 days is the request threshold itself, so that one is not stuck; the status the report
  // does not follow is left out of the figures and of the list.
  assert.deepEqual(report.byStatus.requests.rows[0], { status: 'pending_review', open: 2, stuck: 1 });
  assert.deepEqual(report.byStatus.requests.rows[2], { status: 'approved', open: 1, stuck: 0 });
  assert.deepEqual(report.byStatus.requests.total, { status: 'total', open: 3, stuck: 1 });
  assert.deepEqual(report.byStatus.requests.items.map((item) => item.ref), ['REQ-4']);
  assert.equal(report.byStatus.requests.items[0].itemPath, '/portfolio/requests/REQ-4/summary');
  assert.equal(report.byStatus.requests.items[0].plannedEnd, undefined);
  assert.equal(report.byStatus.requests.rows[0].plannedEndPassed, undefined);

  // Projects carry the planned end on the row and on the item.
  assert.deepEqual(report.byStatus.projects.rows[2], {
    status: 'in_progress',
    open: 2,
    stuck: 1,
    plannedEndPassed: 1,
  });
  assert.deepEqual(report.byStatus.projects.total, {
    status: 'total',
    open: 4,
    stuck: 3,
    plannedEndPassed: 2,
  });
  assert.deepEqual(report.byStatus.projects.items.map((item) => item.ref), ['PRJ-2', 'PRJ-5', 'PRJ-6']);
  assert.deepEqual(report.byStatus.projects.items[2], {
    id: 'id-6',
    ref: 'PRJ-6',
    itemPath: '/portfolio/projects/PRJ-6/summary',
    name: 'Item 6',
    status: 'on_hold',
    statusSince: '2026-01-15',
    plannedEnd: '2025-09-09',
    plannedEndPassed: true,
  });

  // The stuck column is a subset of the open one, row by row and on the total.
  for (const table of [report.byStatus.tasks, report.byStatus.requests, report.byStatus.projects]) {
    assert.equal(table.total.open, table.rows.reduce((sum, row) => sum + row.open, 0));
    assert.equal(table.total.stuck, table.rows.reduce((sum, row) => sum + row.stuck, 0));
    assert.equal(table.items.length, table.total.stuck);
    for (const row of table.rows) assert.ok(row.stuck <= row.open);
  }

  // Every row total is the sum of its brackets, and the table total is the sum of the rows.
  for (const table of [report.age.requests, report.age.projects]) {
    for (const row of [...table.rows, table.total]) {
      assert.equal(
        row.total,
        Object.values(row.buckets).reduce((sum, value) => sum + value, 0),
      );
    }
    assert.equal(
      table.total.total,
      table.rows.reduce((sum, row) => sum + row.total, 0),
    );
  }

  /* ----------------------------------------------------------------- */
  /*  Tenant safety and statement shape                                */
  /* ----------------------------------------------------------------- */

  // Six for the three flows, one for the task age, two for the creation age, three for the
  // by-status tables: twelve statements, no query per item anywhere.
  assert.equal(calls.length, 12);
  for (const call of calls) {
    assert.equal(call.params[0], tenantId, 'every statement is filtered on the tenant');
    assert.ok(call.sql.includes('tenant_id = $1'), 'the tenant predicate is in the SQL');
    assert.ok(!call.sql.includes('Europe/Paris'), 'the zone is never interpolated into the SQL');
    assert.ok(call.params.includes('Europe/Paris'), 'the zone travels as a bound parameter');
  }

  const taskPeriods = calls.find(
    (call) => call.sql.includes('open_at_end AS') && String(call.params[1]) === 'tasks',
  )!;
  assert.equal(taskPeriods.params.length, 6, 'the period query uses every parameter it is handed');
  assert.deepEqual(taskPeriods.params[2], ['done', 'cancelled']);
  assert.equal(taskPeriods.params[4].length, 13);
  assert.equal(taskPeriods.params[5].length, 13);

  const requestPeriods = calls.find(
    (call) => call.sql.includes('open_at_end AS') && String(call.params[1]) === 'portfolio_requests',
  )!;
  assert.equal(requestPeriods.params[4].length, 12, 'requests are read month by month');
  assert.equal(requestPeriods.params[4][0], report.monthsStartDate);

  const totalsCall = calls.find((call) => call.sql.includes('lead_time AS') && String(call.params[1]) === 'tasks')!;
  assert.deepEqual(totalsCall.params[6], ['open', 'in_progress', 'pending', 'in_testing']);
  assert.equal(totalsCall.params[7], report.startDate);
  assert.equal(totalsCall.params[8], report.endDate);

  const requestTotals = calls.find(
    (call) => call.sql.includes('lead_time AS') && String(call.params[1]) === 'portfolio_requests',
  )!;
  assert.deepEqual(requestTotals.params[2], ['converted', 'rejected']);
  assert.deepEqual(requestTotals.params[6], ['pending_review', 'candidate', 'approved', 'on_hold']);
  // The closings of a request or a project are counted over the month window, not the week one.
  assert.equal(requestTotals.params[7], report.monthsStartDate);
  assert.equal(requestTotals.params[8], report.endDate);

  // The creation age is read on the live rows only: no audit table, no event history.
  const projectCreatedAge = calls.find(
    (call) => call.sql.includes('GROUP BY l.status, age_days') && String((call.params[1] ?? [])[0]) === 'waiting_list',
  )!;
  assert.ok(!projectCreatedAge.sql.includes('audit_log'));
  assert.ok(projectCreatedAge.sql.includes('l.created_at AT TIME ZONE $3'));
  assert.equal(projectCreatedAge.params[3], report.endDate);

  const projectByStatus = calls.find(
    (call) => call.sql.includes('open_items AS') && String(call.params[1]) === 'portfolio_projects',
  )!;
  assert.deepEqual(projectByStatus.params[2], ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold']);
  assert.equal(projectByStatus.params[4], report.endDate, 'the age is read against the report day');
  // The clock starts on the last event that brought the item to the status it holds now, and
  // falls back to the creation instant when the audit never mentions a status.
  assert.ok(projectByStatus.sql.includes('e.status = o.status'));
  assert.ok(projectByStatus.sql.includes('COALESCE(en.created_at, o.created_at)'));
  assert.ok(projectByStatus.sql.includes('o.planned_end < $5::date'));

  /* ----------------------------------------------------------------- */
  /*  Source and category filters                                      */
  /* ----------------------------------------------------------------- */

  /** A stub that answers nothing: these checks read the statements, not the figures. */
  const emptyAnswers = () => ({
    periods: {},
    totals: {},
    taskAge: [],
    createdAge: {},
    openItems: {},
  });

  // Blanks and duplicates are dropped, and what survives comes back on the response so the
  // page can trust the population every figure was read on.
  const filtered = stubManager(emptyAnswers());
  const filteredReport = await svc.getReport(
    tenantId,
    {
      weeks: 13,
      months: 12,
      timeZone: 'Europe/Paris',
      sourceIds: ['s1', ' s2 ', 's1', '   '],
      categoryIds: ['c1'],
    },
    { manager: filtered.manager },
  );
  assert.deepEqual(filteredReport.sourceIds, ['s1', 's2']);
  assert.deepEqual(filteredReport.categoryIds, ['c1']);

  // Every one of the twelve statements carries the filter, and numbers it on its own parameter
  // list: the period query stops at $6, the totals query at $9, the age queries earlier still.
  assert.equal(filtered.calls.length, 12);
  for (const call of filtered.calls) {
    const count = call.params.length;
    assert.deepEqual(call.params[count - 2], ['s1', 's2'], 'the sources travel as a bound parameter');
    assert.deepEqual(call.params[count - 1], ['c1'], 'the categories travel as a bound parameter');
    // The shape of the left-hand side is entity-specific and checked below; here it is the
    // numbering that matters, one statement at a time.
    assert.ok(call.sql.includes(`source_id)::text = ANY($${count - 1}::text[])`)
      || call.sql.includes(`.source_id::text = ANY($${count - 1}::text[])`));
    assert.ok(call.sql.includes(`category_id)::text = ANY($${count}::text[])`)
      || call.sql.includes(`.category_id::text = ANY($${count}::text[])`));
    assert.ok(!call.sql.includes("'s1'"), 'a value is never interpolated into the SQL');
  }

  // The filter narrows the live rows themselves, so the audit history, the stock, the age and
  // the medians are all read on the same population.
  const filteredTaskStatus = filtered.calls.find(
    (call) => call.sql.includes('open_items AS') && String(call.params[1]) === 'tasks',
  )!;
  assert.ok(
    filteredTaskStatus.sql.indexOf('COALESCE(t.source_id, pp.source_id)::text')
      < filteredTaskStatus.sql.indexOf('audit AS'),
    'the predicate sits inside the live CTE',
  );

  // A task reads its source and its category through its project when it carries none, the way
  // the task list resolves them: the report and the list it opens count the same population.
  for (const call of filtered.calls.filter((entry) => String(entry.params[1]) === 'tasks')) {
    assert.ok(call.sql.includes('COALESCE(t.source_id, pp.source_id)::text = ANY('));
    assert.ok(call.sql.includes('COALESCE(t.category_id, pp.category_id)::text = ANY('));
    assert.ok(call.sql.includes('LEFT JOIN portfolio_projects pp'));
    assert.ok(call.sql.includes("t.related_object_type = 'project'"));
    assert.ok(call.sql.includes('pp.tenant_id = t.tenant_id'), 'the project join stays on the tenant');
    assert.ok(!/[^(]t\.source_id::text/.test(call.sql), 'the task value alone is never the filter');
  }
  // The task age query is read on the same live rows, project join included.
  const taskAgeCall = filtered.calls.find((call) => call.sql.includes('open_tasks AS'))!;
  assert.ok(taskAgeCall.sql.includes('COALESCE(t.source_id, pp.source_id)::text = ANY('));

  // A request and a project carry their own value: no join, no fallback.
  const requestStatus = filtered.calls.find(
    (call) => call.sql.includes('open_items AS') && String(call.params[1]) === 'portfolio_requests',
  )!;
  assert.ok(requestStatus.sql.includes('r.category_id::text = ANY('));
  assert.ok(requestStatus.sql.includes('r.source_id::text = ANY('));
  assert.ok(!requestStatus.sql.includes('COALESCE(r.'));
  assert.ok(!requestStatus.sql.includes('portfolio_projects pp'));
  const projectStatus = filtered.calls.find(
    (call) => call.sql.includes('open_items AS') && String(call.params[1]) === 'portfolio_projects',
  )!;
  assert.ok(projectStatus.sql.includes('p.source_id::text = ANY('));
  assert.ok(!projectStatus.sql.includes('COALESCE(p.'));

  // One filter on its own leaves the other one out entirely.
  const sourceOnly = stubManager(emptyAnswers());
  const sourceOnlyReport = await svc.getReport(
    tenantId,
    { weeks: 8, months: 6, timeZone: 'Europe/Paris', sourceIds: ['s1'], categoryIds: [] },
    { manager: sourceOnly.manager },
  );
  assert.deepEqual(sourceOnlyReport.categoryIds, []);
  for (const call of sourceOnly.calls) {
    assert.ok(!call.sql.includes('category_id::text'));
    assert.ok(call.sql.includes(`source_id)::text = ANY($${call.params.length}::text[])`)
      || call.sql.includes(`.source_id::text = ANY($${call.params.length}::text[])`));
  }

  // No filter at all reads exactly the statements the report always read.
  const unfiltered = stubManager(emptyAnswers());
  const unfilteredReport = await svc.getReport(
    tenantId,
    { weeks: 13, months: 12, timeZone: 'Europe/Paris', sourceIds: [], categoryIds: undefined },
    { manager: unfiltered.manager },
  );
  assert.deepEqual(unfilteredReport.sourceIds, []);
  assert.deepEqual(unfilteredReport.categoryIds, []);
  for (const call of unfiltered.calls) {
    assert.ok(!call.sql.includes('source_id::text'));
    assert.ok(!call.sql.includes('category_id::text'));
  }
  const unfilteredPeriods = unfiltered.calls.find(
    (call) => call.sql.includes('open_at_end AS') && String(call.params[1]) === 'tasks',
  )!;
  assert.equal(unfilteredPeriods.params.length, 6);

  /* ----------------------------------------------------------------- */
  /*  Query string parsing                                             */
  /* ----------------------------------------------------------------- */

  assert.deepEqual(parseCsvIds('s1,s2'), ['s1', 's2']);
  assert.deepEqual(parseCsvIds(' s1 , , s2 '), ['s1', 's2']);
  assert.deepEqual(parseCsvIds(['s1', 's2']), ['s1', 's2']);
  assert.deepEqual(parseCsvIds(''), []);
  assert.deepEqual(parseCsvIds(undefined), []);
  assert.deepEqual(parseCsvIds(null), []);

  // A manager is mandatory: the report has no way to reach a tenant-scoped connection without it.
  await assert.rejects(() => svc.getReport(tenantId, {}, {}));

  console.log('portfolio-flow-report.spec.ts: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
