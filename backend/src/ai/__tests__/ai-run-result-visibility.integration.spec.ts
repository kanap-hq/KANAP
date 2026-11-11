// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EntityManager } from 'typeorm';
import dataSource from '../../data-source';
import { backendPath } from '../../common/__tests__/backend-root';
import { PermissionsService } from '../../permissions/permissions.service';
import { User } from '../../users/user.entity';
import { AiPolicyService } from '../ai-policy.service';
import { AiAgentControlService } from '../control-plane/agent-control/ai-agent-control.service';
import { AiEvidenceService } from '../control-plane/evidence/ai-evidence.service';
import { AiMcpAuditService } from '../control-plane/mcp/ai-mcp-audit.service';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';

// Who reads the result of a tool call, against PostgreSQL.
//
// The agents screens and the MCP journal list every run of the workspace. A run started by an
// agent is read in full by the roles of those screens. A run started by a person (a conversation
// with the assistant, a call through their MCP key or connection) shows its line to the same
// roles (who, when, which tool) and its result to that person and to an Administrator whose
// access to data is not limited. The rows are written here the way the dispatcher writes them, so
// a result kept before this rule existed is read under the same rule.

const TAG = randomBytes(4).toString('hex');
const executor = new AiTenantExecutionService(dataSource);
const summaries = new AiEvidenceService(null as any);

function policy(): AiPolicyService {
  const users = {
    findById: (id: string, opts: { manager: EntityManager }) =>
      opts.manager.getRepository(User).findOne({ where: { id }, relations: ['role'] }),
  };
  return new AiPolicyService(
    users as any,
    new PermissionsService({} as any, {} as any),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

const none = {} as any;
const control = new AiAgentControlService(
  none, none, none, none, none,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  undefined, undefined, undefined, undefined,
  policy(),
);
const journal = new AiMcpAuditService(policy());

type People = { author: string; agentReader: string; settingsAdmin: string; administrator: string };
type Runs = { chat: string; mcp: string; approval: string; agent: string; mcpFailed: string };
type Seed = { tenantId: string; people: People; runs: Runs };

// What each tool returned. A value of a person's run must reach nobody but its readers.
const RESULTS = {
  chat: [{ reference: `BL-${TAG}-chat`, y_budget: 4200 }],
  mcp: [{ reference: `CTR-${TAG}-mcp`, annual_amount: 9100 }],
  approval: [{ reference: `PRJ-${TAG}-approval`, status: 'executed' }],
  agent: [{ reference: `T-${TAG}-agent`, title: 'Printer offline' }],
};
type ResultRun = keyof typeof RESULTS;
const PERSON_RUNS = ['chat', 'mcp', 'approval'] as const;
const marker = (run: ResultRun) => String(RESULTS[run][0].reference);

// The values a person gave to an MCP tool. The journal of the administration shows them; the
// agents screens show the names of the arguments.
const ARGUMENT_VALUES = { mcp: `Renewal ${TAG} mcp`, mcpFailed: `Renewal ${TAG} failed` };
const MCP_RUNS = ['mcp', 'mcpFailed'] as const;

async function seed(): Promise<Seed> {
  const tenantId = randomUUID();
  const ids = () => ({ role: randomUUID(), user: randomUUID() });
  const author = ids();
  const agentReader = ids();
  const settingsAdmin = ids();
  const administrator = ids();
  const runs: Runs = { chat: randomUUID(), mcp: randomUUID(), approval: randomUUID(), agent: randomUUID(), mcpFailed: '' };
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Run results spec', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `run-results-${TAG}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const person = async (who: { role: string; user: string }, roleName: string, label: string, rights: Array<[string, string]>) => {
      await runner.query(
        `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
         VALUES ($1, $2, $3, 'Run results spec role', false, false, now(), now())`,
        [who.role, tenantId, roleName],
      );
      for (const [resource, level] of rights) {
        await runner.query(
          `INSERT INTO role_permissions (role_id, tenant_id, resource, level) VALUES ($1, $2, $3, $4)`,
          [who.role, tenantId, resource, level],
        );
      }
      await runner.query(
        `INSERT INTO users (id, tenant_id, email, first_name, last_name, role_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Ana', $4, $5, 'enabled', now(), now())`,
        [who.user, tenantId, `run-results-${label}-${TAG}@example.invalid`, label, who.role],
      );
    };
    await person(author, `Budget reader ${TAG}`, 'author', [['budget', 'reader']]);
    await person(agentReader, `Agent reader ${TAG}`, 'agent-reader', [['ai_agents', 'reader']]);
    await person(settingsAdmin, `AI settings ${TAG}`, 'settings-admin', [['ai_settings', 'admin']]);
    await person(administrator, 'Administrator', 'administrator', []);

    const run = async (
      key: ResultRun,
      origin: { channel: string; trigger: string; surface: string },
      capability: string,
      input: Record<string, unknown>,
      extra: { inputSummary?: Record<string, unknown>; metadata?: Record<string, unknown> } = {},
    ) => {
      const output = RESULTS[key];
      const inputSummary = JSON.stringify(extra.inputSummary ?? summaries.summarize(input));
      const outputSummary = JSON.stringify(summaries.summarize(output));
      const stepId = randomUUID();
      const toolId = randomUUID();
      await runner.query(
        `INSERT INTO ai_runs (id, tenant_id, user_id, invocation_channel, trigger_kind, status, input_summary, output_summary, metadata_json, completed_at)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6::jsonb, $7::jsonb, $8::jsonb, now())`,
        [runs[key], tenantId, author.user, origin.channel, origin.trigger, inputSummary, outputSummary, JSON.stringify(extra.metadata ?? null)],
      );
      await runner.query(
        `INSERT INTO ai_run_steps (id, tenant_id, run_id, step_index, kind, status, capability_name, capability_version, input_summary, output_summary, completed_at)
         VALUES ($1, $2, $3, 1, 'tool', 'completed', $4, '1.0.0', $5::jsonb, $6::jsonb, now())`,
        [stepId, tenantId, runs[key], capability, inputSummary, outputSummary],
      );
      await runner.query(
        `INSERT INTO ai_tool_executions (id, tenant_id, run_id, step_id, capability_name, capability_version, surface, effect, status, input_hash, input_summary, output_summary, duration_ms, completed_at)
         VALUES ($1, $2, $3, $4, $5, '1.0.0', $6, 'read', 'completed', $7, $8::jsonb, $9::jsonb, 12, now())`,
        [toolId, tenantId, runs[key], stepId, capability, origin.surface, summaries.hash(input), inputSummary, outputSummary],
      );
      await runner.query(
        `INSERT INTO ai_evidence (tenant_id, run_id, tool_execution_id, source_provider, source_object_type, source_object_id, trust_level, redaction_status, content_hash, summary, payload_json, retention_class, collected_at)
         VALUES ($1, $2, $3, 'kanap_domain', $4, $4, 'system', 'redacted', $5, $6, $7::jsonb, 'standard', now())`,
        [tenantId, runs[key], toolId, capability, summaries.hash(output), String(summaries.summarize(output).summary), JSON.stringify(output)],
      );
    };
    await run('chat', { channel: 'chat', trigger: 'human_user', surface: 'chat' }, 'query_entities', { entity_type: 'budget_lines' });
    const mcpInput = { entity_type: 'contracts', id: 'CTR-1', query: ARGUMENT_VALUES.mcp };
    await run('mcp', { channel: 'mcp', trigger: 'mcp_client', surface: 'mcp' }, 'get_entity_detail', mcpInput, {
      inputSummary: { ...summaries.summarize(mcpInput), arguments: mcpInput },
    });
    await run('approval', { channel: 'internal', trigger: 'human_user', surface: 'internal' }, 'execute_approved_preview', { preview_ids: [randomUUID()] }, {
      metadata: { transport: 'chat_approval_marker' },
    });
    await run('agent', { channel: 'internal', trigger: 'internal', surface: 'internal' }, 'ticketing.ticket.get', { ticket_id: '42' }, {
      metadata: { agent_definition_id: randomUUID() },
    });
    // A call that failed before the dispatch kept anything, as the MCP route records it.
    await journal.recordCall({ tenantId, manager: runner.manager }, {
      toolName: 'get_entity_detail',
      arguments: { entity_type: 'contracts', query: ARGUMENT_VALUES.mcpFailed },
      reason: 'not_found',
      message: 'Contract not found.',
      effect: 'read',
      capabilityVersion: '1.0.0',
      durationMs: 7,
      userId: author.user,
    });
    const recorded = await runner.query(
      `SELECT id::text AS id FROM ai_runs WHERE tenant_id = $1 AND invocation_channel = 'mcp' AND status = 'failed'`,
      [tenantId],
    );
    runs.mcpFailed = String(recorded[0].id);
    await runner.commitTransaction();
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
  return {
    tenantId,
    people: { author: author.user, agentReader: agentReader.user, settingsAdmin: settingsAdmin.user, administrator: administrator.user },
    runs,
  };
}

// Every path that returns what a tool call kept. A new one is added here and to RESULT_COLUMN_FILES.
type Ctx = { tenantId: string; userId: string; manager: EntityManager };
const RESULT_READS: Array<{ name: string; read: (ctx: Ctx, seed: Seed) => Promise<Record<keyof Runs, unknown>> }> = [
  {
    name: 'GET ai/admin/control-plane/runs',
    read: async (ctx, s) => {
      const { items } = await control.listRuns(ctx as any, { limit: 100 });
      return pick(s, (runId) => items.filter((item: any) => item.id === runId));
    },
  },
  {
    name: 'GET ai/admin/control-plane/runs/:id',
    read: async (ctx, s) => {
      const details: Record<string, unknown> = {};
      for (const runId of Object.values(s.runs)) details[runId] = await control.getRunDetail(ctx as any, runId);
      return pick(s, (runId) => details[runId]);
    },
  },
  {
    name: 'GET ai/admin/mcp-audit',
    read: async (ctx, s) => {
      const { items } = await journal.list(ctx as any, { limit: 100 });
      return pick(s, (runId) => items.filter((item) => item.run_id === runId));
    },
  },
];

function pick(s: Seed, of: (runId: string) => unknown): Record<keyof Runs, unknown> {
  return {
    chat: of(s.runs.chat),
    mcp: of(s.runs.mcp),
    approval: of(s.runs.approval),
    agent: of(s.runs.agent),
    mcpFailed: of(s.runs.mcpFailed),
  };
}

function as<T>(s: Seed, userId: string, fn: (ctx: Ctx) => Promise<T>, before?: (manager: EntityManager) => Promise<void>): Promise<T> {
  return executor.run(s.tenantId, async (manager) => {
    if (before) await before(manager);
    return fn({ tenantId: s.tenantId, userId, manager });
  });
}

/** For each read and each run: whether the answer carries the run's result. */
async function resultsSeen(s: Seed, userId: string, before?: (manager: EntityManager) => Promise<void>) {
  const seen: Record<string, Record<keyof Runs, { text: string; hasResult: boolean }>> = {};
  for (const path of RESULT_READS) {
    const answer = await as(s, userId, (ctx) => path.read(ctx, s), before);
    seen[path.name] = Object.fromEntries((Object.keys(answer) as Array<keyof Runs>).map((key) => {
      const text = JSON.stringify(answer[key]);
      return [key, { text, hasResult: key in RESULTS && text.includes(marker(key as ResultRun)) }];
    })) as Record<keyof Runs, { text: string; hasResult: boolean }>;
  }
  return seen;
}

const JOURNAL = 'GET ai/admin/mcp-audit';
const journalReads = (path: string, run: keyof Runs) => path !== JOURNAL || (MCP_RUNS as readonly string[]).includes(run);
// The routes of the agents screens: the journal belongs to the administration.
const AGENT_SCREEN_READS = RESULT_READS.filter((entry) => entry.name !== JOURNAL);

async function testOtherPeoplesRunsShowTheirLineWithoutTheResult(s: Seed) {
  for (const reader of [s.people.agentReader, s.people.settingsAdmin]) {
    const seen = await resultsSeen(s, reader);
    for (const path of RESULT_READS) {
      for (const run of PERSON_RUNS) {
        if (!journalReads(path.name, run)) continue;
        const { text, hasResult } = seen[path.name][run];
        assert.equal(hasResult, false, `${path.name} gave the result of the ${run} run: ${text.slice(0, 400)}`);
        for (const value of Object.values(RESULTS[run][0])) {
          assert.equal(text.includes(JSON.stringify(value)), false, `${path.name} gave ${JSON.stringify(value)} of the ${run} run`);
        }
        // The line stays: the run, its author, the tool.
        assert.ok(text.includes(s.runs[run]), `${path.name} lost the line of the ${run} run`);
        assert.ok(text.includes(s.people.author), `${path.name} lost the author of the ${run} run`);
      }
    }
    const detail: any = await as(s, reader, (ctx) => control.getRunDetail(ctx as any, s.runs.chat));
    assert.equal(detail.run.user_id, s.people.author);
    assert.ok(detail.run.started_at);
    assert.equal(detail.tool_executions[0].capability_name, 'query_entities');
    assert.equal(detail.tool_executions[0].status, 'completed');
    assert.equal(detail.run_steps[0].capability_name, 'query_entities');
    assert.equal(detail.evidence.length, 1);
    assert.equal(detail.evidence[0].source_object_type, 'query_entities');
    assert.equal(detail.evidence[0].payload_json, null);
    assert.equal(detail.evidence[0].summary, null);
    assert.equal(detail.run.output_summary, null);
    assert.equal(detail.tool_executions[0].output_summary, null);
    assert.equal(detail.run_steps[0].output_summary, null);
    const page = await as(s, reader, (ctx) => journal.list(ctx as any, { limit: 100 }));
    const line = page.items.find((item) => item.run_id === s.runs.mcp)!;
    assert.equal(line.capability_name, 'get_entity_detail');
    assert.equal(line.user_id, s.people.author);
    assert.equal(line.output_summary, null);
  }
}

async function testTheAgentsScreensNameTheArgumentsOfAnotherPersonsMcpCall(s: Seed) {
  for (const reader of [s.people.agentReader, s.people.settingsAdmin]) {
    const seen = await resultsSeen(s, reader);
    for (const path of AGENT_SCREEN_READS) {
      for (const run of MCP_RUNS) {
        const { text } = seen[path.name][run];
        assert.equal(text.includes(ARGUMENT_VALUES[run]), false, `${path.name} gave an argument value of the ${run} call: ${text.slice(0, 400)}`);
        assert.ok(text.includes(s.runs[run]), `${path.name} lost the line of the ${run} call`);
        assert.ok(text.includes(s.people.author), `${path.name} lost the author of the ${run} call`);
      }
    }
    // The tool and the names of its arguments stay.
    const detail: any = await as(s, reader, (ctx) => control.getRunDetail(ctx as any, s.runs.mcp));
    for (const line of [detail.tool_executions[0], detail.run_steps[0]]) {
      assert.equal(line.capability_name, 'get_entity_detail');
      assert.equal(line.input_summary.summary, 'Object keys: entity_type, id, query');
      assert.equal('arguments' in line.input_summary, false);
    }
    const failed: any = await as(s, reader, (ctx) => control.getRunDetail(ctx as any, s.runs.mcpFailed));
    assert.equal(failed.tool_executions[0].capability_name, 'get_entity_detail');
    assert.equal(failed.tool_executions[0].status, 'failed');
    assert.equal(failed.tool_executions[0].input_summary, null);
    assert.equal(failed.run.input_summary, null);
  }
  // The journal of the administration keeps the values: it is where a call is read with its arguments.
  const page = await as(s, s.people.settingsAdmin, (ctx) => journal.list(ctx as any, { limit: 100 }));
  for (const run of MCP_RUNS) {
    const line: any = page.items.find((item) => item.run_id === s.runs[run])!;
    assert.equal(line.input_summary.arguments.query, ARGUMENT_VALUES[run]);
  }
  // The person who made the call and an Administrator read the values on the agents screens too.
  for (const reader of [s.people.author, s.people.administrator]) {
    const seen = await resultsSeen(s, reader);
    for (const path of AGENT_SCREEN_READS) {
      for (const run of MCP_RUNS) {
        assert.ok(seen[path.name][run].text.includes(ARGUMENT_VALUES[run]), `${path.name} lost an argument value of the ${run} call for its reader`);
      }
    }
  }
}

async function testAnAgentRunStaysReadableInFull(s: Seed) {
  const seen = await resultsSeen(s, s.people.agentReader);
  for (const path of RESULT_READS.filter((entry) => entry.name !== 'GET ai/admin/mcp-audit')) {
    assert.equal(seen[path.name].agent.hasResult, true, `${path.name} lost the result of the agent run`);
  }
  const detail: any = await as(s, s.people.agentReader, (ctx) => control.getRunDetail(ctx as any, s.runs.agent));
  assert.deepEqual(detail.evidence[0].payload_json, RESULTS.agent);
  assert.ok(detail.evidence[0].summary.includes(marker('agent')));
  assert.ok(detail.tool_executions[0].output_summary.summary.includes(marker('agent')));
}

async function assertReadsEveryResult(s: Seed, userId: string, who: string) {
  const seen = await resultsSeen(s, userId);
  for (const run of PERSON_RUNS) {
    assert.equal(seen['GET ai/admin/control-plane/runs/:id'][run].hasResult, true, `${who} does not read the result of the ${run} run`);
    assert.equal(seen['GET ai/admin/control-plane/runs'][run].hasResult, true, `${who} does not read the summary of the ${run} run in the list`);
  }
  assert.equal(seen['GET ai/admin/mcp-audit'].mcp.hasResult, true, `${who} does not read the result of the MCP call in the journal`);
  const detail: any = await as(s, userId, (ctx) => control.getRunDetail(ctx as any, s.runs.chat));
  assert.deepEqual(detail.evidence[0].payload_json, RESULTS.chat);
}

async function testTheAuthorReadsTheirOwnResults(s: Seed) {
  await assertReadsEveryResult(s, s.people.author, 'the author');
}

async function testAnAdministratorWithAllDataReadsEveryResult(s: Seed) {
  await assertReadsEveryResult(s, s.people.administrator, 'the Administrator');
}

async function testAnAdministratorWithLimitedDataAccessReadsNoOtherResult(s: Seed) {
  // The access the request's transaction runs under is the one that counts.
  const limited = async (manager: EntityManager) => {
    await manager.query(`SELECT set_config('app.da_mode', 'limited', true)`);
  };
  const seen = await resultsSeen(s, s.people.administrator, limited);
  for (const path of RESULT_READS) {
    for (const run of PERSON_RUNS) {
      if (!journalReads(path.name, run)) continue;
      assert.equal(seen[path.name][run].hasResult, false, `${path.name} gave the result of the ${run} run under a limited access`);
    }
  }
}

// The non-test sources that name a kept result. Each one either withholds it by the run's origin,
// only writes it, or reads it for the agent's own work.
const RESULT_COLUMN_FILES: Record<string, 'withheld by run origin' | 'writes' | 'agent work'> = {
  'ai/control-plane/agent-control/agent-control-serializers.util.ts': 'withheld by run origin',
  'ai/control-plane/mcp/ai-mcp-audit.service.ts': 'withheld by run origin',
  'ai/control-plane/dispatcher/ai-capability-dispatcher.service.ts': 'writes',
  'ai/control-plane/evidence/ai-evidence.service.ts': 'writes',
  'ai/control-plane/agent-control/ai-agent-control.service.ts': 'writes',
  'ai/control-plane/automation/ai-automation-job-catalog.service.ts': 'agent work',
};

function testEverySourceThatNamesAKeptResultIsClassified() {
  const root = backendPath('src');
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'migrations') walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.entity.ts')) {
        if (/\b(payload_json|output_summary)\b/.test(readFileSync(full, 'utf8'))) found.add(relative(root, full).split('\\').join('/'));
      }
    }
  };
  walk(root);
  assert.deepEqual(Array.from(found).sort(), Object.keys(RESULT_COLUMN_FILES).sort());
  for (const [file, kind] of Object.entries(RESULT_COLUMN_FILES)) {
    if (kind !== 'withheld by run origin') continue;
    const source = readFileSync(join(root, file), 'utf8');
    assert.match(source, /resultsReadable/, `${file} returns a kept result without asking who reads it`);
  }
}

async function main() {
  await dataSource.initialize();
  const tests: Array<[string, (s: Seed) => Promise<void> | void]> = [
    ['other people\'s runs show their line without the result', testOtherPeoplesRunsShowTheirLineWithoutTheResult],
    ['the agents screens name the arguments of another person\'s MCP call, without their values', testTheAgentsScreensNameTheArgumentsOfAnotherPersonsMcpCall],
    ['an agent run stays readable in full', testAnAgentRunStaysReadableInFull],
    ['the author reads their own results', testTheAuthorReadsTheirOwnResults],
    ['an Administrator with all data reads every result', testAnAdministratorWithAllDataReadsEveryResult],
    ['an Administrator under a limited data access reads no other result', testAnAdministratorWithLimitedDataAccessReadsNoOtherResult],
    ['every source that names a kept result is classified', testEverySourceThatNamesAKeptResultIsClassified],
  ];
  let failed = 0;
  let s: Seed | null = null;
  try {
    s = await seed();
    for (const [name, test] of tests) {
      try {
        await test(s);
        console.log(`ok - ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL - ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    if (s) await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [s.tenantId]).catch(() => undefined);
    await dataSource.destroy();
  }
  if (failed > 0) {
    console.error(`${failed} of ${tests.length} failed`);
    process.exit(1);
  }
  console.log('ai-run-result-visibility.integration.spec: all passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
