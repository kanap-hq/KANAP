import * as assert from 'node:assert/strict';
import { PortfolioProjectsListService } from '../services/portfolio-projects-list.service';
import { timelineStart } from '../services/portfolio-timeline-start';
import { localTodayYmd } from '../services/portfolio-timesheet.service';

// The planning timeline opens on the same calendar day, brought back to the
// target month's last day. The value is a YYYY-MM-DD date, with no time.

assert.equal(timelineStart('2026-05-31', 3), '2026-02-28', '31 May minus 3 months');
assert.equal(timelineStart('2026-03-31', 1), '2026-02-28', '31 March minus 1 month');
assert.equal(timelineStart('2024-03-31', 1), '2024-02-29', '31 March minus 1 month, leap year');
assert.equal(timelineStart('2026-12-31', 1), '2026-11-30', '31 December minus 1 month');
assert.equal(timelineStart('2026-06-15', 6), '2025-12-15', 'a day the target month has');

type Call = { sql: string; params: unknown[] };

function stubManager(projects: Array<{ id: string }>) {
  const calls: Call[] = [];
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return sql.includes('FROM portfolio_projects p') ? projects : [];
    },
  };
  return { manager, calls };
}

async function run() {
  const svc = new PortfolioProjectsListService({} as never);
  const today = localTodayYmd();

  const empty = stubManager([]);
  const defaults = await svc.getTimelineData({}, { manager: empty.manager as never });
  const defaultStart = timelineStart(today, 3);
  assert.equal(defaults.viewStart, defaultStart, 'the default window is 3 months back');
  assert.equal(empty.calls.length, 1, 'no projects, so no dependency or milestone query');
  assert.equal(typeof empty.calls[0].params[0], 'string');
  assert.deepEqual(empty.calls[0].params, [defaultStart]);
  assert.match(defaultStart, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(empty.calls[0].sql.includes('p.planned_end >= $1::date'), 'planned ends compare as dates');
  assert.ok(empty.calls[0].sql.includes('p.actual_end >= $1::date'), 'actual ends compare as dates');

  const withRows = stubManager([{ id: 'p1' }]);
  const ranged = await svc.getTimelineData({ months: 6 }, { manager: withRows.manager as never });
  const start = timelineStart(today, 6);
  assert.equal(ranged.viewStart, start);
  assert.equal(withRows.calls[0].params[0], start);
  const milestones = withRows.calls.find((call) => call.sql.includes('portfolio_project_milestones'));
  assert.ok(milestones, 'milestones are loaded with the projects');
  assert.equal(milestones.params[1], start);
  assert.ok(milestones.sql.includes('m.target_date >= $2::date'), 'milestone days compare as dates');

  console.log('portfolio-timeline-start.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
