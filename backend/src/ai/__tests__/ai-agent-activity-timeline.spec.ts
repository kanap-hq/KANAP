import * as assert from 'node:assert/strict';
import {
  AGENT_ACTIVITY_TYPES,
  AgentActivityType,
  auditActivityType,
  auditActivityTypeSql,
  compareActivityEntries,
  decodeActivityCursor,
  encodeActivityCursor,
  mergeActivityPage,
} from '../control-plane/agent-control/ai-agent-activity-timeline';
import {
  ACTIVITY_RETENTION_DEFAULT_DAYS,
  ACTIVITY_RETENTION_MAX_DAYS,
  ACTIVITY_RETENTION_MIN_DAYS,
  activityRetentionDaysForDefinition,
  clampActivityRetentionDays,
  normalizeQueuePolicyRetention,
  retentionCutoff,
  runIdsSafeToPurge,
} from '../control-plane/agent/ai-agent-activity-retention';
import { AiAgentActivityRetentionService } from '../control-plane/agent/ai-agent-activity-retention.service';

// ---------------------------------------------------------------------------
// 1. Audit-event classification — the "Checks" activity category.
// ---------------------------------------------------------------------------

function testAuditTypeMapping() {
  const cases: Array<[{ event_type: string; severity?: string | null }, AgentActivityType]> = [
    [{ event_type: 'poller_cycle_completed', severity: 'info' }, 'check'],
    [{ event_type: 'poller_cycle_skipped', severity: 'info' }, 'check'],
    // A failed cycle is an error first — checks are the healthy-path category.
    [{ event_type: 'poller_cycle_failed', severity: 'error' }, 'error'],
    [{ event_type: 'poller_cycle_completed', severity: 'error' }, 'error'],
    // Pause wins over everything, including a paused poller cycle.
    [{ event_type: 'poller_paused_by_emergency_pause', severity: 'info' }, 'pause'],
    [{ event_type: 'emergency_pause_created', severity: 'info' }, 'pause'],
    [{ event_type: 'work_item_processing_failed', severity: 'error' }, 'error'],
    // Acknowledging a needs-attention row is an operator ruling, not a config change.
    [{ event_type: 'agent_attention_acknowledged', severity: 'info' }, 'decision'],
    [{ event_type: 'agent_config_updated', severity: 'info' }, 'configuration'],
    [{ event_type: 'agent_autonomy_granted', severity: 'info' }, 'configuration'],
    [{ event_type: 'ingestion_settings_updated', severity: null }, 'configuration'],
    [{ event_type: 'daily_cap_reached', severity: 'warning' }, 'configuration'],
  ];
  for (const [event, expected] of cases) {
    assert.equal(auditActivityType(event), expected, `${event.event_type} should classify as ${expected}`);
  }
  assert.ok(AGENT_ACTIVITY_TYPES.includes('check'), 'check must be an exposed activity type');
}

function testAuditTypeSqlMirrorsTheClassifier() {
  // No filtering needed when every audit-backed type is wanted.
  assert.equal(auditActivityTypeSql('event', new Set(AGENT_ACTIVITY_TYPES)), null);
  // Only non-audit types wanted: the audit stream must return nothing.
  assert.equal(auditActivityTypeSql('event', new Set<AgentActivityType>(['proposal', 'execution'])), 'false');

  // "decision" is audit-backed too now: acknowledgements must survive the filter.
  const decisionOnly = auditActivityTypeSql('event', new Set<AgentActivityType>(['decision']));
  assert.ok(decisionOnly && decisionOnly.includes("LIKE '%attention_acknowledged%'"),
    'decision filter must select acknowledgements');
  assert.ok(decisionOnly!.includes("NOT lower(event.event_type) LIKE 'poller_cycle%'"),
    'decision filter must exclude checks');

  const checkOnly = auditActivityTypeSql('event', new Set<AgentActivityType>(['check']));
  assert.ok(checkOnly && checkOnly.includes("LIKE 'poller_cycle%'"), 'check filter must select poller cycles');
  assert.ok(checkOnly!.includes("NOT lower(event.event_type) LIKE '%pause%'"), 'check filter must exclude pauses');
  assert.ok(checkOnly!.includes("severity = 'error'"), 'check filter must exclude failed cycles');

  const configOnly = auditActivityTypeSql('event', new Set<AgentActivityType>(['configuration']));
  assert.ok(configOnly && configOnly.includes("NOT lower(event.event_type) LIKE 'poller_cycle%'"),
    'configuration must no longer swallow poller cycles');
  assert.ok(configOnly!.includes("NOT lower(event.event_type) LIKE '%attention_acknowledged%'"),
    'configuration must no longer swallow acknowledgements');

  const errorOnly = auditActivityTypeSql('event', new Set<AgentActivityType>(['error']));
  assert.ok(errorOnly && !errorOnly.includes("LIKE 'poller_cycle%'"), 'error filter is independent of the check clause');

  // Two types combine as a disjunction, never as an intersection.
  const both = auditActivityTypeSql('event', new Set<AgentActivityType>(['check', 'pause']));
  assert.ok(both && both.includes(' OR '), 'multiple wanted types must OR together');
}

// ---------------------------------------------------------------------------
// 2. Keyset pagination.
// ---------------------------------------------------------------------------

type Entry = { id: string; at: string; source: string };

function syntheticEntries(): Entry[] {
  // Three interleaved sources, as the real timeline merges them.
  const base = Date.UTC(2026, 7, 11, 10, 0, 0);
  const entries: Entry[] = [];
  for (let index = 0; index < 8; index += 1) {
    entries.push({ id: `action:${index}:proposal`, at: new Date(base - index * 60_000).toISOString(), source: 'action' });
    entries.push({ id: `audit:${index}`, at: new Date(base - index * 60_000 - 20_000).toISOString(), source: 'audit' });
    entries.push({ id: `approval:${index}`, at: new Date(base - index * 60_000 - 40_000).toISOString(), source: 'approval' });
  }
  return entries;
}

function testCursorRoundTrip() {
  const entry = { id: 'action:7:proposal', at: '2026-08-11T10:00:00.000Z' };
  const cursor = encodeActivityCursor(entry);
  assert.deepEqual(decodeActivityCursor(cursor), entry);
  assert.equal(decodeActivityCursor(null), null);
  assert.equal(decodeActivityCursor(''), null);
  assert.equal(decodeActivityCursor('not-a-cursor'), null);
  assert.equal(decodeActivityCursor(Buffer.from('nope', 'utf8').toString('base64url')), null);
}

function testPaginationWalksEveryEntryExactlyOnce() {
  const all = syntheticEntries();
  const limit = 5;
  const seen: Entry[] = [];
  let cursor = decodeActivityCursor(null);
  for (let page = 0; page < 20; page += 1) {
    const result = mergeActivityPage(all, limit, cursor);
    assert.ok(result.items.length <= limit, 'a page never exceeds the limit');
    // Newest first, inside the page and across pages.
    for (let index = 1; index < result.items.length; index += 1) {
      assert.ok(compareActivityEntries(result.items[index - 1], result.items[index]) < 0, 'page must be sorted newest first');
    }
    if (seen.length > 0 && result.items.length > 0) {
      assert.ok(
        compareActivityEntries(seen[seen.length - 1], result.items[0]) < 0,
        'the next page must start strictly after the previous page',
      );
    }
    seen.push(...result.items);
    if (!result.nextCursor) break;
    cursor = decodeActivityCursor(result.nextCursor);
    assert.ok(cursor, 'the emitted cursor must decode');
  }
  assert.equal(seen.length, all.length, 'every entry is returned exactly once across pages');
  assert.equal(new Set(seen.map((entry) => entry.id)).size, all.length, 'no duplicates across pages');
}

function testPaginationStopsWithoutCursorOnTheLastPage() {
  const all = syntheticEntries().slice(0, 4);
  const result = mergeActivityPage(all, 10, null);
  assert.equal(result.items.length, 4);
  assert.equal(result.nextCursor, null, 'a partial page must not advertise another one');

  const exact = mergeActivityPage(all, 4, null);
  assert.equal(exact.nextCursor, null, 'a page that exactly consumes the entries must not advertise another one');
}

function testPaginationHandlesIdenticalTimestamps() {
  const at = '2026-08-11T10:00:00.000Z';
  const all = ['a', 'b', 'c', 'd'].map((id) => ({ id: `audit:${id}`, at, source: 'audit' }));
  const first = mergeActivityPage(all, 2, null);
  assert.deepEqual(first.items.map((entry) => entry.id), ['audit:a', 'audit:b']);
  const second = mergeActivityPage(all, 2, decodeActivityCursor(first.nextCursor));
  assert.deepEqual(second.items.map((entry) => entry.id), ['audit:c', 'audit:d'], 'ties must not be skipped or repeated');
  assert.equal(second.nextCursor, null);
}

// ---------------------------------------------------------------------------
// 3. Retention setting + purge guardrails.
// ---------------------------------------------------------------------------

function testRetentionClamping() {
  assert.equal(clampActivityRetentionDays(undefined), ACTIVITY_RETENTION_DEFAULT_DAYS);
  assert.equal(clampActivityRetentionDays('nonsense'), ACTIVITY_RETENTION_DEFAULT_DAYS);
  assert.equal(clampActivityRetentionDays(0), ACTIVITY_RETENTION_MIN_DAYS);
  assert.equal(clampActivityRetentionDays(-40), ACTIVITY_RETENTION_MIN_DAYS);
  assert.equal(clampActivityRetentionDays(1), ACTIVITY_RETENTION_MIN_DAYS);
  assert.equal(clampActivityRetentionDays(10_000), ACTIVITY_RETENTION_MAX_DAYS);
  assert.equal(clampActivityRetentionDays(45.9), 45);
  assert.equal(clampActivityRetentionDays('60'), 60);

  assert.equal(activityRetentionDaysForDefinition(null), ACTIVITY_RETENTION_DEFAULT_DAYS);
  assert.equal(activityRetentionDaysForDefinition({ queue_policy_json: null }), ACTIVITY_RETENTION_DEFAULT_DAYS);
  assert.equal(activityRetentionDaysForDefinition({ queue_policy_json: {} }), ACTIVITY_RETENTION_DEFAULT_DAYS);
  assert.equal(activityRetentionDaysForDefinition({ queue_policy_json: { activity_retention_days: 3 } }), ACTIVITY_RETENTION_MIN_DAYS);
  assert.equal(activityRetentionDaysForDefinition({ queue_policy_json: { activity_retention_days: 45 } }), 45);

  // Server-side clamp on the persisted payload: the client is never trusted.
  assert.deepEqual(
    normalizeQueuePolicyRetention({ enabled: true, activity_retention_days: 3650 }),
    { enabled: true, activity_retention_days: ACTIVITY_RETENTION_MAX_DAYS },
  );
  assert.deepEqual(
    normalizeQueuePolicyRetention({ enabled: true, activity_retention_days: 2 }),
    { enabled: true, activity_retention_days: ACTIVITY_RETENTION_MIN_DAYS },
  );
  assert.deepEqual(normalizeQueuePolicyRetention({ enabled: true }), { enabled: true }, 'other keys are untouched');
  assert.deepEqual(normalizeQueuePolicyRetention({ activity_retention_days: null }), {}, 'clearing falls back to the default');
  assert.equal(normalizeQueuePolicyRetention(null), null);

  const cutoff = retentionCutoff(new Date('2026-08-11T00:00:00.000Z'), 30);
  assert.equal(cutoff.toISOString(), '2026-07-12T00:00:00.000Z');
  // Even a poisoned stored value cannot widen the purge beyond the floor.
  assert.equal(
    retentionCutoff(new Date('2026-08-11T00:00:00.000Z'), 0).toISOString(),
    '2026-08-04T00:00:00.000Z',
  );
}

function testRunsReferencedByOpenProposalsSurvive() {
  const candidates = ['run-pending', 'run-approved', 'run-executed', 'run-orphan'];
  const safe = runIdsSafeToPurge(candidates, [
    { run_id: 'run-pending', status: 'pending' },
    { run_id: 'run-approved', status: 'approved' },
    { run_id: 'run-executed', status: 'executed' },
    { run_id: 'run-executed', status: 'rejected' },
    { run_id: 'run-not-a-candidate', status: 'pending' },
    { run_id: null, status: 'pending' },
  ]);
  assert.deepEqual(safe, ['run-executed', 'run-orphan']);
  // A single open proposal is enough to hold the whole run back.
  assert.deepEqual(
    runIdsSafeToPurge(['run-mixed'], [
      { run_id: 'run-mixed', status: 'executed' },
      { run_id: 'run-mixed', status: 'pending' },
    ]),
    [],
  );
}

// A small stand-in for Postgres: enough of the purge statements to observe what
// the service actually deletes, and strict about the tenant predicate.
function createFakeDatabase(seed: {
  tenants: string[];
  definitions: Array<{ id: string; tenant_id: string; queue_policy_json: Record<string, unknown> | null }>;
  audit: Array<{ id: string; tenant_id: string; agent_definition_id: string; created_at: string }>;
  actions: Array<{ id: string; tenant_id: string; agent_definition_id: string | null; run_id: string | null; status: string; created_at: string }>;
  runs: Array<{ id: string; tenant_id: string; agent_definition_id: string | null; created_at: string }>;
}) {
  const state = {
    audit: [...seed.audit],
    actions: [...seed.actions],
    runs: [...seed.runs],
  };
  const statements: Array<{ sql: string; params: any[] }> = [];
  const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const query = async (rawSql: string, params: any[] = []): Promise<any> => {
    const sql = flat(rawSql);
    statements.push({ sql, params });
    if (sql.startsWith('SELECT id FROM tenants')) {
      return seed.tenants.map((id) => ({ id }));
    }
    // Every other statement is tenant-scoped, by contract.
    assert.ok(sql.includes('tenant_id = $1'), `statement must be tenant-scoped: ${sql}`);
    const tenantId = params[0];
    // The unlinks that make the deletes independent of FK trigger order: the
    // fake keeps no tool executions, so there is nothing to change.
    if (/^UPDATE (ai_tool_executions SET approval_id|ai_evidence SET tool_execution_id|ai_action_requests SET tool_execution_id) = NULL /.test(sql)) {
      return [];
    }
    if (sql.includes('FROM ai_agent_definitions')) {
      return seed.definitions.filter((row) => row.tenant_id === tenantId);
    }
    if (sql.startsWith('SELECT id FROM ai_agent_audit_events')) {
      const [, definitionId, cutoff, limit] = params;
      return state.audit
        .filter((row) => row.tenant_id === tenantId && row.agent_definition_id === definitionId && row.created_at < cutoff)
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .slice(0, limit)
        .map((row) => ({ id: row.id }));
    }
    if (sql.startsWith('DELETE FROM ai_agent_audit_events')) {
      const ids = new Set<string>(params[1]);
      state.audit = state.audit.filter((row) => !(row.tenant_id === tenantId && ids.has(row.id)));
      return [];
    }
    if (sql.startsWith('SELECT id FROM ai_action_requests')) {
      const [, definitionId, cutoff, statuses, limit] = params;
      return state.actions
        .filter((row) => row.tenant_id === tenantId
          && row.agent_definition_id === definitionId
          && row.created_at < cutoff
          && (statuses as string[]).includes(row.status))
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .slice(0, limit)
        .map((row) => ({ id: row.id }));
    }
    if (sql.startsWith('DELETE FROM ai_action_requests')) {
      const ids = new Set<string>(params[1]);
      state.actions = state.actions.filter((row) => !(row.tenant_id === tenantId && ids.has(row.id)));
      return [];
    }
    if (sql.startsWith('SELECT id FROM ai_runs')) {
      const [, definitionId, cutoff, limit, offset] = params;
      return state.runs
        .filter((row) => row.tenant_id === tenantId && row.agent_definition_id === definitionId && row.created_at < cutoff)
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .slice(offset, offset + limit)
        .map((row) => ({ id: row.id }));
    }
    if (sql.startsWith('SELECT run_id, status FROM ai_action_requests')) {
      const ids = new Set<string>(params[1]);
      return state.actions
        .filter((row) => row.tenant_id === tenantId && row.run_id && ids.has(row.run_id))
        .map((row) => ({ run_id: row.run_id, status: row.status }));
    }
    if (sql.startsWith('DELETE FROM ai_runs')) {
      const ids = new Set<string>(params[1]);
      state.runs = state.runs.filter((row) => !(row.tenant_id === tenantId && ids.has(row.id)));
      return [];
    }
    throw new Error(`Unsupported statement in the purge fake: ${sql}`);
  };
  return { state, statements, manager: { query } as any };
}

async function testPurgeCronGuardrails() {
  const now = new Date('2026-08-11T00:00:00.000Z');
  const old = '2026-06-01T00:00:00.000Z';   // ~70 days before now
  const recent = '2026-08-10T00:00:00.000Z';
  const db = createFakeDatabase({
    tenants: ['tenant-a', 'tenant-b'],
    definitions: [
      { id: 'agent-a', tenant_id: 'tenant-a', queue_policy_json: { activity_retention_days: 30 } },
      // No retention configured: falls back to the 30-day default.
      { id: 'agent-b', tenant_id: 'tenant-b', queue_policy_json: null },
    ],
    audit: [
      { id: 'audit-old', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', created_at: old },
      { id: 'audit-recent', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', created_at: recent },
      { id: 'audit-other-tenant', tenant_id: 'tenant-b', agent_definition_id: 'agent-b', created_at: old },
    ],
    actions: [
      { id: 'act-executed', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', run_id: 'run-executed', status: 'executed', created_at: old },
      { id: 'act-pending', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', run_id: 'run-pending', status: 'pending', created_at: old },
      { id: 'act-approved', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', run_id: 'run-approved', status: 'approved', created_at: old },
      { id: 'act-recent', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', run_id: null, status: 'executed', created_at: recent },
    ],
    runs: [
      { id: 'run-executed', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', created_at: old },
      { id: 'run-pending', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', created_at: old },
      { id: 'run-approved', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', created_at: old },
      { id: 'run-orphan', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', created_at: old },
      { id: 'run-recent', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', created_at: recent },
      { id: 'run-chat', tenant_id: 'tenant-a', agent_definition_id: null, created_at: old },
      { id: 'run-other-tenant', tenant_id: 'tenant-b', agent_definition_id: 'agent-b', created_at: old },
    ],
  });

  const service = new AiAgentActivityRetentionService({} as any, { register: () => undefined } as any);
  const summary = await service.run({ manager: db.manager, now });

  assert.equal(summary.tenantsProcessed, 2);
  assert.equal(summary.agentsProcessed, 2);
  assert.deepEqual(summary.errors, []);

  // Audit events: old go, recent stay, and the other tenant's row is only ever
  // touched under its own tenant id.
  assert.deepEqual(
    db.state.audit.map((row) => row.id).sort(),
    ['audit-recent'],
    'audit events past retention are purged for every tenant',
  );

  // Proposals: terminal + old go; pending/approved and recent stay.
  assert.deepEqual(
    db.state.actions.map((row) => row.id).sort(),
    ['act-approved', 'act-pending', 'act-recent'],
    'only terminal proposals past retention are purged',
  );

  // Runs: the guardrail keeps the traces of proposals still awaiting a decision
  // or an execution; chat runs (no agent) are out of scope entirely.
  assert.deepEqual(
    db.state.runs.map((row) => row.id).sort(),
    ['run-approved', 'run-chat', 'run-pending', 'run-recent'],
    'runs referenced by non-terminal proposals must survive',
  );
  assert.equal(summary.runsKept, 2, 'both held-back runs are reported');
  // tenant-a: run-executed + run-orphan; tenant-b: its own old run, purged
  // under its own tenant id (each tenant is processed in its own pass).
  assert.equal(summary.runs, 3, 'purgeable runs of both tenants are deleted');

  // Tenant isolation: no statement ever ran without a tenant id, and each
  // tenant only ever saw its own.
  const scoped = db.statements.filter((entry) => !entry.sql.startsWith('SELECT id FROM tenants'));
  assert.ok(scoped.length > 0);
  for (const entry of scoped) {
    assert.ok(['tenant-a', 'tenant-b'].includes(entry.params[0]), `tenant id missing from ${entry.sql}`);
  }
  // Deletes are batched by id, never issued as an open-ended DELETE ... WHERE created_at.
  for (const entry of scoped.filter((item) => item.sql.startsWith('DELETE'))) {
    assert.ok(entry.sql.includes('id = ANY($2::uuid[])'), `delete must target explicit ids: ${entry.sql}`);
  }
  // Each proposal or run batch is preceded by the unlinks of its second FK path,
  // for the same ids.
  const expectedUnlinks: Record<string, string[]> = {
    'DELETE FROM ai_action_requests': ['UPDATE ai_tool_executions SET approval_id = NULL'],
    'DELETE FROM ai_runs': [
      'UPDATE ai_evidence SET tool_execution_id = NULL',
      'UPDATE ai_action_requests SET tool_execution_id = NULL',
    ],
  };
  for (const [index, entry] of scoped.entries()) {
    const prefix = Object.keys(expectedUnlinks).find((key) => entry.sql.startsWith(key));
    if (!prefix) continue;
    const unlinks = expectedUnlinks[prefix];
    const preceding = scoped.slice(index - unlinks.length, index);
    assert.deepEqual(
      preceding.map((item) => unlinks.find((unlink) => item.sql.startsWith(unlink)) ?? item.sql),
      unlinks,
      `${prefix} must follow its unlinks`,
    );
    for (const item of preceding) {
      assert.deepEqual(item.params, entry.params, `${prefix} unlinks must target the same tenant and ids`);
    }
  }
}

async function testPurgeRespectsAShorterRetention() {
  const now = new Date('2026-08-11T00:00:00.000Z');
  const db = createFakeDatabase({
    tenants: ['tenant-a'],
    // Below the floor: clamped up to 7 days, so the 10-day-old event stays.
    definitions: [{ id: 'agent-a', tenant_id: 'tenant-a', queue_policy_json: { activity_retention_days: 1 } }],
    audit: [
      { id: 'audit-3d', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', created_at: '2026-08-08T00:00:00.000Z' },
      { id: 'audit-10d', tenant_id: 'tenant-a', agent_definition_id: 'agent-a', created_at: '2026-08-01T00:00:00.000Z' },
    ],
    actions: [],
    runs: [],
  });
  const service = new AiAgentActivityRetentionService({} as any, { register: () => undefined } as any);
  await service.run({ manager: db.manager, now });
  assert.deepEqual(
    db.state.audit.map((row) => row.id),
    ['audit-3d'],
    'a below-floor retention is clamped to 7 days server-side',
  );
}

async function run() {
  testAuditTypeMapping();
  testAuditTypeSqlMirrorsTheClassifier();
  testCursorRoundTrip();
  testPaginationWalksEveryEntryExactlyOnce();
  testPaginationStopsWithoutCursorOnTheLastPage();
  testPaginationHandlesIdenticalTimestamps();
  testRetentionClamping();
  testRunsReferencedByOpenProposalsSurvive();
  await testPurgeCronGuardrails();
  await testPurgeRespectsAShorterRetention();
  console.log('ai-agent-activity-timeline.spec: all tests passed');
}

void run();
