import * as assert from 'node:assert/strict';
import { PortfolioWeeklyReportService } from '../services/portfolio-weekly-report.service';

/**
 * The "Changes" of the modified lists: the full status chain, and every changed field as its
 * value before and after the period, references named. The statements are stubbed: what is
 * checked is the row shaping, the name lookups and the SQL rules that drop a reverted field
 * and the noise.
 */

const TENANT = '44dd2037-a4a7-4943-8b63-5b2c95cff52b';

const taskRow = (over: Record<string, any> = {}) => ({
  record_id: 'task-1',
  name: 'Tune the cellar probes',
  item_number: 1,
  source_id: null,
  source_name: null,
  category_id: null,
  category_name: null,
  stream_id: null,
  stream_name: null,
  company_name: null,
  status: 'in_testing',
  live_created_day: '2026-09-01',
  created_day: null,
  modified_day: '2026-09-16',
  closed_day: null,
  update_count: 3,
  status_chain: [],
  field_changes: [],
  priority: 70,
  task_type_id: null,
  task_type_name: null,
  ...over,
});

type Call = { sql: string; params: any[] };

function stub(tasks: any[], lookups: Record<string, Array<{ id: string; name: string }>>) {
  const calls: Call[] = [];
  const manager: any = {
    query: async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.includes('JOIN tasks t ON t.id = a.record_id')) return tasks;
      for (const [table, rows] of Object.entries(lookups)) {
        if (sql.includes(`FROM ${table} r\n`)) return rows.filter((row) => params[1].includes(row.id));
      }
      return [];
    },
  };
  return { manager, calls };
}

const query = {
  tenantId: TENANT,
  startDate: '2026-09-14',
  endDate: '2026-09-20',
  timeZone: 'Europe/Paris',
  entities: ['task' as const],
};

async function run() {
  const rows = [
    taskRow({
      record_id: 't1',
      item_number: 1,
      // Three moves: open → in progress → in testing → done.
      status_chain: ['open', 'in_progress', 'in_testing', 'done'],
      field_changes: [
        { key: 'assignee_user_id', before: 'u-thomas', after: 'u-isabelle' },
        { key: 'due_date', before: null, after: '2026-09-30' },
        { key: 'labels', before: [], after: ['cellar', 'probe'] },
        { key: 'description', before: `<p>${'Long cellar note. '.repeat(8)}</p>`, after: null },
        { key: 'task_type_id', before: 'tt-gone', after: 'tt-bug' },
      ],
    }),
    taskRow({
      record_id: 't2',
      item_number: 2,
      // A gap in the audit trail repeats a status: shown once.
      status_chain: ['open', 'in_progress', 'in_progress', 'done'],
      field_changes: [{ key: 'assignee_user_id', before: null, after: 'u-thomas' }],
    }),
    // No status move at all.
    taskRow({ record_id: 't3', item_number: 3, status_chain: [], field_changes: [] }),
  ];

  const { manager, calls } = stub(rows, {
    users: [
      { id: 'u-thomas', name: 'Thomas Berger' },
      { id: 'u-isabelle', name: 'Isabelle Moreau' },
    ],
    // tt-gone was deleted: nothing comes back for it.
    portfolio_task_types: [{ id: 'tt-bug', name: 'Bug' }],
  });
  const svc = new PortfolioWeeklyReportService();
  const result = await svc.list(query, { manager });

  const [t1, t2, t3] = result.tasks.modified;
  assert.equal(result.tasks.modified.length, 3);

  // The whole chain, in order.
  assert.deepEqual(t1.changes?.statusChain, ['open', 'in_progress', 'in_testing', 'done']);
  // Consecutive repeats merged.
  assert.deepEqual(t2.changes?.statusChain, ['open', 'in_progress', 'done']);
  assert.deepEqual(t3.changes, { statusChain: [], fields: [] });

  const field = (key: string) => t1.changes?.fields.find((entry) => entry.key === key);
  // A user id reads as the person's name.
  assert.deepEqual(field('assignee_user_id'), {
    key: 'assignee_user_id',
    before: 'Thomas Berger',
    after: 'Isabelle Moreau',
    kind: 'ref',
  });
  // An empty value stays null, whatever the other side is.
  assert.deepEqual(field('due_date'), { key: 'due_date', before: null, after: '2026-09-30', kind: 'date' });
  assert.deepEqual(t2.changes?.fields[0], { key: 'assignee_user_id', before: null, after: 'Thomas Berger', kind: 'ref' });
  // A list reads as its item count.
  assert.deepEqual(field('labels'), { key: 'labels', before: '0', after: '2', kind: 'list' });
  // A long text is plain words cut at 60 characters.
  const description = field('description');
  assert.equal(description?.kind, 'text');
  assert.equal(description?.after, null);
  assert.ok(description?.before?.endsWith('…'));
  assert.ok(!description?.before?.includes('<p>'));
  assert.ok((description?.before?.length ?? 0) <= 61);
  // A reference whose record is gone reads as unknown, never as its id.
  assert.deepEqual(field('task_type_id'), { key: 'task_type_id', before: '', after: 'Bug', kind: 'ref' });

  // One lookup per table over every row, tenant bound, never one per row.
  const userLookups = calls.filter((call) => call.sql.includes('FROM users r'));
  assert.equal(userLookups.length, 1, 'one user lookup for the whole report');
  assert.equal(userLookups[0].params[0], TENANT);
  assert.deepEqual([...userLookups[0].params[1]].sort(), ['u-isabelle', 'u-thomas']);
  assert.ok(userLookups[0].sql.includes('r.tenant_id = $1'));
  assert.equal(calls.filter((call) => call.sql.includes('FROM portfolio_task_types r')).length, 1);

  // The SQL keeps the first "before" and the last "after" of each key, drops a key back to
  // its starting value, and ignores the noise.
  const taskSql = calls.find((call) => call.sql.includes('JOIN tasks t ON t.id = a.record_id'))!;
  assert.ok(taskSql.sql.includes('fs.before_value IS DISTINCT FROM fs.after_value'));
  assert.ok(taskSql.sql.includes('(array_agg(fm.before_value ORDER BY fm.created_at ASC, fm.id ASC))[1]'));
  assert.ok(taskSql.sql.includes('(array_agg(fm.after_value ORDER BY fm.created_at DESC, fm.id DESC))[1]'));
  assert.ok(taskSql.sql.includes('NOT (keys.k = ANY($6::text[]))'));
  assert.ok(taskSql.sql.includes("left(keys.k, 2) <> '__'"));
  for (const key of ['updated_at', 'status', 'id', 'tenant_id', 'item_number', 'related_object_type']) {
    assert.ok(taskSql.params[5].includes(key), `${key} is noise`);
  }

  // The export writes it all on one cell, in English.
  const { manager: exportManager } = stub(rows, {
    users: [
      { id: 'u-thomas', name: 'Thomas Berger' },
      { id: 'u-isabelle', name: 'Isabelle Moreau' },
    ],
    portfolio_task_types: [{ id: 'tt-bug', name: 'Bug' }],
  });
  const csv = await svc.exportCsv(query, { manager: exportManager });
  const line = csv.content.split('\n').find((entry) => entry.startsWith('T-1;'));
  assert.ok(line, 'the modified task has its line');
  assert.ok(
    line!.includes('Open → In progress → In testing → Done; Assignee: Thomas Berger → Isabelle Moreau; '),
    line,
  );
  assert.ok(line!.includes('Description: Long cellar note.'));
  assert.ok(line!.includes('… → empty'));
  assert.ok(line!.includes('Due date: empty → 2026-09-30'));
  assert.ok(line!.includes('Labels: 0 items → 2 items'));
  assert.ok(line!.includes('Task type: unknown → Bug'));

  await runOriginTask();
  console.log('portfolio-weekly-report-changes.spec.ts: ok');
}

/**
 * A request whose origin task went with a deleted budget line: the audit row carries the
 * task's label under `origin_task` (the id under a technical `__` key the SQL drops), so the
 * line names the task instead of "unknown".
 */
async function runOriginTask() {
  const requestRow = taskRow({
    record_id: 'r1',
    name: 'Cellar probes request',
    item_number: 12,
    status: 'pending_review',
    field_changes: [{ key: 'origin_task', before: 'T-12: Tune the cellar probes', after: null }],
  });
  delete (requestRow as any).priority;
  delete (requestRow as any).task_type_id;
  delete (requestRow as any).task_type_name;
  const requestStub = () => {
    const manager: any = {
      query: async (sql: string) => (sql.includes('JOIN portfolio_requests r ON r.id = a.record_id') ? [requestRow] : []),
    };
    return manager;
  };
  const requestQuery = { ...query, entities: ['request' as const] };
  const svc = new PortfolioWeeklyReportService();
  const result = await svc.list(requestQuery, { manager: requestStub() });
  assert.deepEqual(result.requests.modified[0].changes?.fields, [
    { key: 'origin_task', before: 'T-12: Tune the cellar probes', after: null, kind: 'text' },
  ]);
  const csv = await svc.exportCsv(requestQuery, { manager: requestStub() });
  const line = csv.content.split('\n').find((entry) => entry.startsWith('REQ-12;'));
  assert.ok(line?.includes('Origin task: T-12: Tune the cellar probes → empty'), line);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
