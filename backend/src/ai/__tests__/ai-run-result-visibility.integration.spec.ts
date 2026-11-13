// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import dataSource from '../../data-source';
import { backendPath } from '../../common/__tests__/backend-root';
import { PermissionsService } from '../../permissions/permissions.service';
import { User } from '../../users/user.entity';
import { AiPolicyService } from '../ai-policy.service';
import { AiAgentControlService } from '../control-plane/agent-control/ai-agent-control.service';
import { AiActionRequestService } from '../control-plane/action-request/ai-action-request.service';
import { AiApprovalService } from '../control-plane/approval/ai-approval.service';
import { purgeAiConversations } from '../ai-conversation-purge';
import { AiEvidenceService } from '../control-plane/evidence/ai-evidence.service';
import { AiMcpAuditService } from '../control-plane/mcp/ai-mcp-audit.service';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';

// Who reads the result of a tool call, against PostgreSQL.
//
// The agents screens and the MCP journal list every run of the workspace. A run started by an
// agent is read in full by the roles of those screens. A run started by a person (a conversation
// with the assistant, a call through their MCP key or connection) shows its line to the same
// roles (who, when, which tool) and its result to its author, or to an Administrator, who reads
// all data. The rows are written here the way the dispatcher writes them, so a result kept before
// this rule existed is read under the same rule.

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
type Runs = { chat: string; mcp: string; approval: string; agent: string; mcpFailed: string; chatFailed: string };
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

// What a failed call says. The message of a failure quotes what the person asked for and what the
// tool found: it is read like a result. `thrown` is the failure of the call, `reported` the one a
// tool reports in its own output.
const ERRORS = {
  chatFailed: {
    thrown: `No budget line found matching "BL-${TAG}-missing". Also found: BL-${TAG}-near`,
    reported: `The supplier SUP-${TAG}-reported was not found`,
  },
  mcpFailed: { thrown: `No contract found matching "CTR-${TAG}-missing"` },
};
const ERROR_MARKERS = {
  chatFailed: [`BL-${TAG}-missing`, `BL-${TAG}-near`, `SUP-${TAG}-reported`],
  mcpFailed: [`CTR-${TAG}-missing`],
};
const FAILED_RUNS = ['chatFailed', 'mcpFailed'] as const;

// A write a run prepared, and its approval. Both keep the fingerprint of the arguments, and a
// failed one keeps the message of its failure, on the action and in its metadata. The `chat` run
// holds a person's, the `agent` run an agent's with the reply it drafted.
const ACTION_RUNS = ['chat', 'agent'] as const;
type ActionRun = typeof ACTION_RUNS[number];
const ACTIONS: Record<ActionRun, { id: string; approvalId: string; target: string; hash: string; approvalHash: string; error: string; retry: string }> = {
  chat: {
    id: randomUUID(), approvalId: randomUUID(), target: `PRJ-${TAG}`,
    hash: randomBytes(32).toString('hex'), approvalHash: randomBytes(32).toString('hex'),
    error: `Library LIB-${TAG}-missing not found`, retry: `Library LIB-${TAG}-retry not found`,
  },
  agent: {
    id: randomUUID(), approvalId: randomUUID(), target: `T-${TAG}`,
    hash: randomBytes(32).toString('hex'), approvalHash: randomBytes(32).toString('hex'),
    error: `Ticket T-${TAG}-locked is locked`, retry: `Ticket T-${TAG}-retry is locked`,
  },
};
const AGENT_DRAFT = `Reply ${TAG} draft`;
const actionMarkers = (run: ActionRun) => [ACTIONS[run].error, ACTIONS[run].retry, ACTIONS[run].hash, ACTIONS[run].approvalHash];

async function seed(): Promise<Seed> {
  const tenantId = randomUUID();
  const ids = () => ({ role: randomUUID(), user: randomUUID() });
  const author = ids();
  const agentReader = ids();
  const settingsAdmin = ids();
  const administrator = ids();
  const runs: Runs = { chat: randomUUID(), mcp: randomUUID(), approval: randomUUID(), agent: randomUUID(), mcpFailed: '', chatFailed: randomUUID() };
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
    // A failed write of each origin, approved before it ran.
    const action = async (
      key: ActionRun,
      row: { capability: string; userId: string | null; targetType: string; summary: Record<string, unknown>; payload: Record<string, unknown> | null; metadata: Record<string, unknown>; source: string },
    ) => {
      const kept = ACTIONS[key];
      await runner.query(
        `INSERT INTO ai_action_requests (id, tenant_id, run_id, user_id, capability_name, capability_version, effect, status, target_type, target_ref, input_hash, input_summary, action_payload_json, error_message, metadata_json, approved_at)
         VALUES ($1, $2, $3, $4, $5, '1.0.0', 'write', 'failed', $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, now())`,
        [kept.id, tenantId, runs[key], row.userId, row.capability, row.targetType, kept.target, kept.hash, JSON.stringify(row.summary), JSON.stringify(row.payload), kept.error, JSON.stringify({ ...row.metadata, last_execution_error: kept.retry, attention_acknowledged: { at: '2026-11-11T09:00:00.000Z' } })],
      );
      await runner.query(
        `INSERT INTO ai_approvals (id, tenant_id, action_request_id, capability_name, capability_version, source, status, actor_user_id, input_hash, decision_json, expires_at, decided_at)
         VALUES ($1, $2, $3, $4, '1.0.0', $5, 'approved', $6, $7, $8::jsonb, now() + interval '1 hour', now())`,
        [kept.approvalId, tenantId, kept.id, row.capability, row.source, row.userId ?? agentReader.user, kept.approvalHash, JSON.stringify({ input_hash: kept.approvalHash })],
      );
    };
    await action('chat', {
      capability: 'kanap.mutation_preview.execute_approved',
      userId: author.user,
      targetType: 'projects',
      summary: { tool_name: 'update_business_record', target_entity_type: 'projects', target_entity_id: null },
      payload: null,
      metadata: {},
      source: 'human_chat',
    });
    await action('agent', {
      capability: 'ticketing.ticket.public_reply.create',
      userId: null,
      targetType: 'ticket',
      summary: { target_ref: ACTIONS.agent.target },
      payload: { reply_body: AGENT_DRAFT },
      metadata: { agent_definition_id: randomUUID() },
      source: 'human_ui',
    });
    // A conversation whose first tool reported a failure in its output and whose second one threw.
    const failedInput = { entity_type: 'budget_lines', query: 'missing' };
    const failedInputSummary = JSON.stringify(summaries.summarize(failedInput));
    await runner.query(
      `INSERT INTO ai_runs (id, tenant_id, user_id, invocation_channel, trigger_kind, status, input_summary, output_summary, completed_at)
       VALUES ($1, $2, $3, 'chat', 'human_user', 'failed', $4::jsonb, $5::jsonb, now())`,
      [runs.chatFailed, tenantId, author.user, failedInputSummary, JSON.stringify({ error: ERRORS.chatFailed.thrown })],
    );
    const failedCalls: Array<{ status: string; message: string; metadata: Record<string, unknown> }> = [
      {
        status: 'provider_error',
        message: ERRORS.chatFailed.reported,
        metadata: {
          evidence_ids: [],
          provider_error: { error_code: 'not_found', message: ERRORS.chatFailed.reported, retryable: false, provider_request_id: null },
        },
      },
      { status: 'failed', message: ERRORS.chatFailed.thrown, metadata: {} },
    ];
    for (const [index, call] of failedCalls.entries()) {
      const stepId = randomUUID();
      await runner.query(
        `INSERT INTO ai_run_steps (id, tenant_id, run_id, step_index, kind, status, capability_name, capability_version, input_summary, error_message, completed_at)
         VALUES ($1, $2, $3, $4, 'tool', $5, 'query_entities', '1.0.0', $6::jsonb, $7, now())`,
        [stepId, tenantId, runs.chatFailed, index + 1, call.status, failedInputSummary, call.message],
      );
      await runner.query(
        `INSERT INTO ai_tool_executions (tenant_id, run_id, step_id, capability_name, capability_version, surface, effect, status, input_hash, input_summary, error_message, metadata_json, duration_ms, completed_at)
         VALUES ($1, $2, $3, 'query_entities', '1.0.0', 'chat', 'read', $4, $5, $6::jsonb, $7, $8::jsonb, 9, now())`,
        [tenantId, runs.chatFailed, stepId, call.status, summaries.hash(failedInput), failedInputSummary, call.message, JSON.stringify(call.metadata)],
      );
    }
    // A call that failed before the dispatch kept anything, as the MCP route records it.
    await journal.recordCall({ tenantId, manager: runner.manager }, {
      toolName: 'get_entity_detail',
      arguments: { entity_type: 'contracts', query: ARGUMENT_VALUES.mcpFailed },
      reason: 'not_found',
      message: ERRORS.mcpFailed.thrown,
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

// Every path that returns what a tool call kept. A new one is added here and to KEPT_COLUMN_FILES.
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
    chatFailed: of(s.runs.chatFailed),
  };
}

function as<T>(s: Seed, userId: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return executor.run(s.tenantId, (manager) => fn({ tenantId: s.tenantId, userId, manager }));
}

/** For each read and each run: whether the answer carries the run's result. */
async function resultsSeen(s: Seed, userId: string) {
  const seen: Record<string, Record<keyof Runs, { text: string; hasResult: boolean }>> = {};
  for (const path of RESULT_READS) {
    const answer = await as(s, userId, (ctx) => path.read(ctx, s));
    seen[path.name] = Object.fromEntries((Object.keys(answer) as Array<keyof Runs>).map((key) => {
      const text = JSON.stringify(answer[key]);
      return [key, { text, hasResult: key in RESULTS && text.includes(marker(key as ResultRun)) }];
    })) as Record<keyof Runs, { text: string; hasResult: boolean }>;
  }
  return seen;
}

const JOURNAL = 'GET ai/admin/mcp-audit';
const RUN_DETAIL = 'GET ai/admin/control-plane/runs/:id';
// Every path that returns an action or its approval, by the run that prepared it.
const ACTION_READS: Array<{ name: string; read: (ctx: Ctx, seed: Seed) => Promise<Record<ActionRun, unknown>> }> = [
  {
    name: 'GET ai/admin/control-plane/actions',
    read: async (ctx, s) => {
      const { items } = await control.listActionRequests(ctx as any, { status: 'all', limit: 100 });
      return { chat: items.filter((item: any) => item.run_id === s.runs.chat), agent: items.filter((item: any) => item.run_id === s.runs.agent) };
    },
  },
  {
    name: 'GET ai/admin/control-plane/runs/:id',
    read: async (ctx, s) => {
      const of = async (runId: string) => {
        const detail: any = await control.getRunDetail(ctx as any, runId);
        return { action_requests: detail.action_requests, approvals: detail.approvals };
      };
      return { chat: await of(s.runs.chat), agent: await of(s.runs.agent) };
    },
  },
  {
    name: 'GET ai/admin/control-plane/activity',
    read: async (ctx, s) => {
      const { items } = await control.listActivity(ctx as any, { limit: 100 });
      return { chat: items.filter((item: any) => item.runId === s.runs.chat), agent: items.filter((item: any) => item.runId === s.runs.agent) };
    },
  },
];

async function actionsSeen(s: Seed, userId: string): Promise<Record<string, Record<ActionRun, string>>> {
  const seen: Record<string, Record<ActionRun, string>> = {};
  for (const path of ACTION_READS) {
    const answer = await as(s, userId, (ctx) => path.read(ctx, s));
    seen[path.name] = { chat: JSON.stringify(answer.chat), agent: JSON.stringify(answer.agent) };
  }
  return seen;
}

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
      assert.deepEqual(line.input_summary, { summary: 'Object keys: entity_type, id, query' });
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

async function testAFailedRunOfAnotherPersonShowsHowItEndedWithoutTheMessage(s: Seed) {
  for (const reader of [s.people.agentReader, s.people.settingsAdmin]) {
    const seen = await resultsSeen(s, reader);
    for (const path of RESULT_READS) {
      for (const run of FAILED_RUNS) {
        if (!journalReads(path.name, run)) continue;
        const { text } = seen[path.name][run];
        for (const quoted of ERROR_MARKERS[run]) {
          assert.equal(text.includes(quoted), false, `${path.name} gave the message of the ${run} run: ${text.slice(0, 400)}`);
        }
        assert.ok(text.includes(s.runs[run]), `${path.name} lost the line of the ${run} run`);
        assert.ok(text.includes(s.people.author), `${path.name} lost the author of the ${run} run`);
      }
    }
    // The status and the coded reason stay.
    const detail: any = await as(s, reader, (ctx) => control.getRunDetail(ctx as any, s.runs.chatFailed));
    assert.equal(detail.run.status, 'failed');
    assert.deepEqual(detail.run_steps.map((step: any) => step.status).sort(), ['failed', 'provider_error']);
    assert.deepEqual(detail.tool_executions.map((tool: any) => tool.status).sort(), ['failed', 'provider_error']);
    for (const line of [...detail.run_steps, ...detail.tool_executions]) {
      assert.equal(line.capability_name, 'query_entities');
      assert.equal(line.error_message, null);
    }
    const reported = detail.tool_executions.find((tool: any) => tool.status === 'provider_error');
    assert.deepEqual(reported.metadata_json.provider_error, { error_code: 'not_found', retryable: false, provider_request_id: null });
    const page = await as(s, reader, (ctx) => journal.list(ctx as any, { limit: 100 }));
    const line = page.items.find((item) => item.run_id === s.runs.mcpFailed)!;
    assert.equal(line.capability_name, 'get_entity_detail');
    assert.equal(line.result, 'failed');
    assert.equal(line.reason, 'not_found');
    assert.equal(line.error_message, null);
  }
  // The person whose run it is and an Administrator read the messages.
  for (const reader of [s.people.author, s.people.administrator]) {
    const seen = await resultsSeen(s, reader);
    for (const run of FAILED_RUNS) {
      for (const quoted of ERROR_MARKERS[run]) {
        assert.ok(seen['GET ai/admin/control-plane/runs/:id'][run].text.includes(quoted), `the detail of the ${run} run lost ${quoted} for its reader`);
      }
    }
    // The list carries the failure of the run, the journal the one of the call.
    assert.ok(seen['GET ai/admin/control-plane/runs'].chatFailed.text.includes(ERROR_MARKERS.chatFailed[0]));
    assert.ok(seen[JOURNAL].mcpFailed.text.includes(ERROR_MARKERS.mcpFailed[0]));
    const detail: any = await as(s, reader, (ctx) => control.getRunDetail(ctx as any, s.runs.chatFailed));
    const reported = detail.tool_executions.find((tool: any) => tool.status === 'provider_error');
    assert.equal(reported.metadata_json.provider_error.message, ERRORS.chatFailed.reported);
  }
}

async function testTheFingerprintOfTheArgumentsIsReadLikeTheResult(s: Seed) {
  // A fingerprint confirms a guess on simple arguments. The ones the person reads on their own runs:
  const fingerprints = async (userId: string, run: keyof Runs): Promise<string[]> => {
    const detail: any = await as(s, userId, (ctx) => control.getRunDetail(ctx as any, s.runs[run]));
    return [
      detail.run.input_summary?.hash,
      ...detail.run_steps.map((step: any) => step.input_summary?.hash),
      ...detail.tool_executions.flatMap((tool: any) => [tool.input_hash, tool.input_summary?.hash]),
    ].filter((value) => typeof value === 'string' && value.length > 0);
  };
  for (const run of [...PERSON_RUNS, 'chatFailed'] as const) {
    const own = await fingerprints(s.people.author, run);
    assert.ok(own.length >= 3, `the ${run} run keeps the fingerprint of its arguments`);
    assert.deepEqual(await fingerprints(s.people.administrator, run), own);
    for (const reader of [s.people.agentReader, s.people.settingsAdmin]) {
      assert.deepEqual(await fingerprints(reader, run), []);
      const seen = await resultsSeen(s, reader);
      for (const path of AGENT_SCREEN_READS) {
        for (const fingerprint of own) {
          assert.equal(seen[path.name][run].text.includes(fingerprint), false, `${path.name} gave a fingerprint of the arguments of the ${run} run`);
        }
      }
      const detail: any = await as(s, reader, (ctx) => control.getRunDetail(ctx as any, s.runs[run]));
      for (const tool of detail.tool_executions) assert.equal(tool.input_hash, null);
    }
  }
  // An agent's run keeps them for the roles of the agents screens.
  assert.ok((await fingerprints(s.people.agentReader, 'agent')).length >= 3);
}

async function testAnActionOfAnotherPersonsRunShowsItsLineWithoutTheMessageOrTheFingerprint(s: Seed) {
  for (const reader of [s.people.agentReader, s.people.settingsAdmin]) {
    const seen = await actionsSeen(s, reader);
    for (const path of ACTION_READS) {
      const text = seen[path.name].chat;
      // A change Kad prepared in a conversation is approved there: the agent lists leave it out.
      if (path.name !== RUN_DETAIL) {
        assert.equal(text, '[]', `${path.name} lists a change prepared in a conversation`);
        assert.ok(seen[path.name].agent.includes(ACTIONS.agent.error), `${path.name} lost the message of the agent's action`);
        continue;
      }
      for (const kept of actionMarkers('chat')) {
        assert.equal(text.includes(kept), false, `${path.name} gave ${kept.slice(0, 40)} of another person's action: ${text.slice(0, 400)}`);
      }
      // The line stays: the action, its tool, its target, how it ended.
      assert.ok(text.includes(ACTIONS.chat.id), `${path.name} lost the line of the action`);
      assert.ok(text.includes('kanap.mutation_preview.execute_approved'), `${path.name} lost the tool of the action`);
      assert.ok(text.includes(ACTIONS.chat.target), `${path.name} lost the target of the action`);
      assert.ok(text.includes('failed'), `${path.name} lost the status of the action`);
      // An agent's action stays readable in full.
      assert.ok(seen[path.name].agent.includes(ACTIONS.agent.error), `${path.name} lost the message of the agent's action`);
      assert.ok(seen[path.name].agent.includes(AGENT_DRAFT), `${path.name} lost the draft of the agent's action`);
    }
    for (const kept of actionMarkers('agent')) {
      assert.ok(seen['GET ai/admin/control-plane/runs/:id'].agent.includes(kept), `the detail lost ${kept.slice(0, 40)} of the agent's action`);
    }
    const detail: any = await as(s, reader, (ctx) => control.getRunDetail(ctx as any, s.runs.chat));
    const [action] = detail.action_requests;
    assert.equal(action.user_id, s.people.author);
    assert.equal(action.status, 'failed');
    assert.equal(action.target_type, 'projects');
    assert.deepEqual(action.input_summary, { tool_name: 'update_business_record', target_entity_type: 'projects', target_entity_id: null });
    assert.ok(action.approved_at && action.created_at);
    for (const field of ['error_message', 'input_hash', 'idempotency_key', 'action_payload_json']) {
      assert.equal(action[field], null, `the action gave its ${field}`);
    }
    // Of its metadata, the line keeps that somebody acknowledged the failure.
    assert.deepEqual(action.metadata_json, { attention_acknowledged: { at: '2026-11-11T09:00:00.000Z' } });
    const [approval] = detail.approvals;
    assert.equal(approval.action_request_id, ACTIONS.chat.id);
    assert.equal(approval.status, 'approved');
    assert.equal(approval.actor_user_id, s.people.author);
    assert.ok(approval.decided_at);
    assert.equal(approval.input_hash, null);
    assert.equal(approval.decision_json, null);
  }
  // The person whose run prepared the action and an Administrator read all of it.
  for (const reader of [s.people.author, s.people.administrator]) {
    const seen = await actionsSeen(s, reader);
    for (const kept of actionMarkers('chat')) {
      assert.ok(seen[RUN_DETAIL].chat.includes(kept), `the detail lost ${kept.slice(0, 40)} for its reader`);
    }
    for (const path of ACTION_READS.filter((entry) => entry.name !== RUN_DETAIL)) {
      assert.equal(seen[path.name].chat, '[]', `${path.name} lists a change prepared in a conversation`);
    }
    assert.ok(seen['GET ai/admin/control-plane/actions'].agent.includes(ACTIONS.agent.hash));
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

async function testAnAdministratorReadsEveryResult(s: Seed) {
  await assertReadsEveryResult(s, s.people.administrator, 'the Administrator');
}

// A change Kad prepares in a conversation is approved there, by the person who asked for it. The
// agent screens neither list nor decide it, including a row an operator decided there before.
const actionRequests = new AiActionRequestService(null as any, null as any);
const approvalsService = new AiApprovalService(null as any, actionRequests);
const decisions = new AiAgentControlService(
  none, approvalsService, none, none, none,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  undefined, undefined, undefined, undefined,
  policy(),
);
const PREVIEW_STATES = ['approved', 'rejected', 'dismissed'] as const;
type PreviewRow = { preview: string; action: string };

async function seedConversationPreviews(s: Seed) {
  const conversation = randomUUID();
  const purgedConversation = randomUUID();
  const rows: Record<string, PreviewRow> = {};
  const witness = randomUUID();
  let orphan = '';
  await as(s, s.people.author, async ({ manager }) => {
    for (const id of [conversation, purgedConversation]) {
      await manager.query(
        `INSERT INTO ai_conversations (id, tenant_id, user_id, title) VALUES ($1, $2, $3, $4)`,
        [id, s.tenantId, s.people.author, `Previews ${TAG}`],
      );
    }
    const add = async (key: string, decidedOnAgentScreen: string | null, inConversation = conversation) => {
      const row = { preview: randomUUID(), action: randomUUID() };
      const task = randomUUID();
      await manager.query(
        `INSERT INTO ai_mutation_previews (id, tenant_id, conversation_id, user_id, tool_name, target_entity_type, target_entity_id, mutation_input, status, expires_at)
         VALUES ($1, $2, $3, $4, 'update_task_status', 'tasks', $5, '{}'::jsonb, 'pending', now() + interval '1 hour')`,
        [row.preview, s.tenantId, inConversation, s.people.author, task],
      );
      await manager.query(
        `INSERT INTO ai_action_requests (id, tenant_id, run_id, conversation_id, user_id, preview_id, capability_name, capability_version, effect, status, target_type, target_id, target_ref, input_hash, input_summary, expires_at, approved_at, rejected_at)
         VALUES ($1, $2, $9, $3, $4, $5, 'kanap.mutation_preview.execute_approved', '1.0.0', 'write', $6::text, 'tasks', $7::uuid, $7::text, $8, '{}'::jsonb, now() + interval '1 hour',
                 CASE WHEN $6::text = 'approved' THEN now() END, CASE WHEN $6::text = 'rejected' THEN now() END)`,
        [row.action, s.tenantId, inConversation, s.people.author, row.preview, decidedOnAgentScreen ?? 'pending', task, randomBytes(32).toString('hex'), s.runs.chat],
      );
      if (decidedOnAgentScreen) {
        await manager.query(
          `INSERT INTO ai_approvals (tenant_id, action_request_id, capability_name, capability_version, source, status, actor_user_id, input_hash, expires_at, decided_at)
           SELECT tenant_id, id, capability_name, capability_version, 'human_ui', $3, $4, input_hash, now() + interval '1 hour', now()
             FROM ai_action_requests WHERE tenant_id = $1 AND id = $2`,
          [s.tenantId, row.action, decidedOnAgentScreen, s.people.agentReader],
        );
      }
      rows[key] = row;
    };
    await add('fresh', null);
    for (const state of PREVIEW_STATES) {
      await add(`${state}:approve`, state);
      await add(`${state}:reject`, state);
    }
    // Its conversation deleted: the action keeps the capability, the preview link is cleared.
    await add('purged', null, purgedConversation);
    orphan = rows.purged.action;
    delete rows.purged;
    await purgeAiConversations(manager, s.tenantId, [purgedConversation]);
    // An agent's pending proposal, which the agent screens keep.
    await manager.query(
      `INSERT INTO ai_action_requests (id, tenant_id, capability_name, capability_version, effect, status, target_type, target_ref, idempotency_key, action_payload_json, provider_kind, provider_key, input_hash, input_summary, metadata_json, expires_at)
       VALUES ($1, $2, 'ticketing.ticket.internal_note.add_approved', '1.0.0', 'write', 'pending', 'ticket', $3, $4, $5::jsonb, 'ticketing', 'mock', $6, '{}'::jsonb, $7::jsonb, now() + interval '1 hour')`,
      [witness, s.tenantId, `T-${TAG}-witness`, randomBytes(16).toString('hex'), JSON.stringify({ ticketId: `T-${TAG}-witness`, body: 'Witness note.' }), randomBytes(32).toString('hex'), JSON.stringify({ agent_definition_id: randomUUID() })],
    );
  });
  const [purged] = await as(s, s.people.administrator, ({ manager }) => manager.query(
    `SELECT preview_id, conversation_id FROM ai_action_requests WHERE tenant_id = $1 AND id = $2`,
    [s.tenantId, orphan],
  ));
  assert.deepEqual(purged, { preview_id: null, conversation_id: null }, 'the purge kept the preview link');
  return { conversation, rows, orphan, witness };
}

async function decisionState(s: Seed, actionIds: string[]) {
  return as(s, s.people.administrator, async ({ manager }) => JSON.stringify(await manager.query(
    `SELECT a.id, a.status, a.approved_at, a.rejected_at, a.metadata_json,
            (SELECT count(*) FROM ai_approvals p WHERE p.tenant_id = a.tenant_id AND p.action_request_id = a.id) AS approvals
       FROM ai_action_requests a
      WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])
      ORDER BY a.id`,
    [s.tenantId, actionIds],
  )));
}

async function testAChangePreparedInAConversationIsDecidedThereByItsAuthorOnly(s: Seed) {
  const { conversation, rows, orphan, witness } = await seedConversationPreviews(s);
  const actionIds = [...Object.values(rows).map((row) => row.action), orphan];
  const people = [s.people.agentReader, s.people.settingsAdmin, s.people.administrator, s.people.author];

  // The agent screens: no row, no count, no entry.
  for (const reader of people) {
    const listed = await as(s, reader, (ctx) => control.listActionRequests(ctx as any, { status: 'all', limit: 100 }));
    assert.deepEqual(listed.items.filter((item: any) => actionIds.includes(item.id)), [], 'GET actions lists a conversation preview');
    assert.ok(listed.items.some((item: any) => item.id === ACTIONS.agent.id), 'GET actions lost the agent action');
    const pending = await as(s, reader, (ctx) => control.listActionRequests(ctx as any, { status: 'pending', limit: 100 }));
    assert.deepEqual(pending.items.map((item: any) => item.id), [witness], 'GET actions?status=pending lists a conversation preview');
    assert.deepEqual(await as(s, reader, (ctx) => control.getBadges(ctx as any)), { pendingApprovals: 1 });
    // The trace of the conversation's run reads them, offers no decision and counts none as pending.
    const detail: any = await as(s, reader, (ctx) => control.getRunDetail(ctx as any, s.runs.chat));
    for (const id of [rows.fresh.action, orphan]) {
      const traced = detail.action_requests.find((action: any) => action.id === id);
      assert.deepEqual(
        { can_execute: traced?.execution_readiness?.can_execute, can_reject: traced?.execution_readiness?.can_reject, blocked_reason: traced?.execution_readiness?.blocked_reason },
        { can_execute: false, can_reject: false, blocked_reason: 'AI action request not found.' },
        'the run trace offers a decision on a conversation preview',
      );
    }
    const runs = await as(s, reader, (ctx) => control.listRuns(ctx as any, { limit: 100 }));
    assert.equal(runs.items.find((item: any) => item.id === s.runs.chat)?.counts.pending_actions, 0, 'GET runs counts a conversation preview as pending');
    const activity = await as(s, reader, (ctx) => control.listActivity(ctx as any, { limit: 100 }));
    assert.deepEqual(activity.items.filter((entry: any) => actionIds.includes(entry.actionRequestId)), [], 'the activity lists a conversation preview');
    assert.ok(activity.items.some((entry: any) => entry.actionRequestId === ACTIONS.agent.id), 'the activity lost the agent action');
  }

  // Nobody decides it from the agent screens, and nobody but its author from a conversation.
  const before = await decisionState(s, [...actionIds, witness]);
  const unknownId = randomUUID();
  const refusedLikeAnUnknownId = async (who: string, label: string, call: (ctx: any, id: string) => Promise<unknown>) => {
    let unknown: unknown = null;
    await as(s, who, (ctx) => call(ctx, unknownId)).catch((error) => { unknown = error; });
    assert.ok(unknown instanceof NotFoundException, `${label}: an unknown id is not refused as unknown`);
    for (const action of actionIds) {
      await assert.rejects(
        () => as(s, who, (ctx) => call(ctx, action)),
        (error: unknown) => error instanceof NotFoundException && error.message === (unknown as Error).message,
        `${label} decided a conversation preview`,
      );
    }
  };
  for (const who of people) {
    await refusedLikeAnUnknownId(who, 'approve', (ctx, id) => decisions.approveActionRequest(ctx, id, { execute: false }));
    await refusedLikeAnUnknownId(who, 'reject', (ctx, id) => decisions.rejectActionRequest(ctx, id, null));
    await refusedLikeAnUnknownId(who, 'dismiss', (ctx, id) => decisions.dismissActionRequest(ctx, id, null));
    await refusedLikeAnUnknownId(who, 'bulk approve', (ctx, id) => decisions.approveActionRequestsBulk(ctx, { action_request_ids: [id], execute: false }));
    await refusedLikeAnUnknownId(who, 'bulk approve with an agent action', (ctx, id) => decisions.approveActionRequestsBulk(ctx, {
      action_request_ids: [witness, id],
      execute: false,
    }));
  }
  for (const who of [s.people.agentReader, s.people.administrator]) {
    for (const row of Object.values(rows)) {
      const chat = (ctx: Ctx) => ({ ...ctx, conversationId: conversation }) as any;
      await assert.rejects(() => as(s, who, (ctx) => approvalsService.approvePreviewFromChat(chat(ctx), row.preview)), NotFoundException);
      await assert.rejects(() => as(s, who, (ctx) => approvalsService.rejectPreviewFromChat(chat(ctx), row.preview)), NotFoundException);
    }
  }
  assert.equal(await decisionState(s, [...actionIds, witness]), before, 'a refused decision changed an action or wrote an approval');

  // Its author approves or rejects it in the conversation, whatever the agent screen decided before.
  for (const key of ['fresh', ...PREVIEW_STATES.flatMap((state) => [`${state}:approve`, `${state}:reject`])]) {
    const row = rows[key];
    const approve = key === 'fresh' || key.endsWith(':approve');
    await as(s, s.people.author, async (ctx) => {
      const chat = { ...ctx, conversationId: conversation } as any;
      const decided = approve
        ? await approvalsService.approvePreviewFromChat(chat, row.preview)
        : await approvalsService.rejectPreviewFromChat(chat, row.preview);
      assert.equal(decided.action.id, row.action, `${key}: the decision went to another action`);
      assert.equal(decided.approval.source, 'human_chat');
      assert.equal(decided.approval.actor_user_id, s.people.author);
      assert.equal(decided.action.status, approve ? 'approved' : 'rejected', key);
      if (approve) {
        // What the execution of the preview checks next.
        const durable = await approvalsService.resolveApprovedAction(chat, decided.action);
        assert.equal(durable.id, decided.approval.id, `${key}: the execution would not find the author's approval`);
      }
    });
  }
}

// The non-test sources that name what a run, an action or an approval keeps of a call: its
// result, its input and the message of its failure. Each one either returns it to a reader and
// withholds it by the run's origin, only writes it, reads it for the agent's own work (or derives
// a flag or a count from it, without returning it), or names another record that has columns of
// the same names (a write preview, a tool definition, a provider's answer). An entry that ends
// with `/` stands for every source below it.
type KeptColumnUse = 'withheld by run origin' | 'writes' | 'agent work' | 'another record';
const KEPT_COLUMNS = /\b(payload_json|output_summary|input_summary|input_hash|error_message)\b/;
const KEPT_COLUMN_FILES: Record<string, KeptColumnUse> = {
  'ai/control-plane/agent-control/agent-control-serializers.util.ts': 'withheld by run origin',
  'ai/control-plane/mcp/ai-mcp-audit.service.ts': 'withheld by run origin',
  'ai/control-plane/dispatcher/ai-capability-dispatcher.service.ts': 'writes',
  'ai/control-plane/evidence/ai-evidence.service.ts': 'writes',
  'ai/control-plane/agent-control/ai-agent-control.service.ts': 'withheld by run origin',
  'ai/control-plane/agent-control/agent-control-constants.util.ts': 'withheld by run origin',
  'ai/control-plane/automation/ai-automation-job-catalog.service.ts': 'agent work',
  'ai/ai.types.ts': 'another record',
  'ai/ai-tool.registry.ts': 'another record',
  'ai/ai-chat-orchestrator.service.ts': 'another record',
  'ai/ai-mutation-preview.service.ts': 'another record',
  'ai/mutation/': 'another record',
  'ai/glpi/glpi.service.ts': 'another record',
  'ai/control-plane/action-request/ai-action-request.service.ts': 'writes',
  'ai/control-plane/approval/ai-approval.service.ts': 'writes',
  'ai/control-plane/capability/ai-capability.registry.ts': 'writes',
  'ai/control-plane/agent/ai-agent-approval-lifecycle-sweeper.service.ts': 'writes',
  'ai/control-plane/agent/ai-agent-work-queue.service.ts': 'agent work',
  'ai/control-plane/agent-control/ai-agent-attention.util.ts': 'agent work',
};

function testEverySourceThatNamesAKeptColumnIsClassified() {
  const root = backendPath('src');
  const folders = Object.keys(KEPT_COLUMN_FILES).filter((entry) => entry.endsWith('/'));
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'migrations') walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.entity.ts')) {
        if (!KEPT_COLUMNS.test(readFileSync(full, 'utf8'))) continue;
        const file = relative(root, full).split('\\').join('/');
        found.add(folders.find((folder) => file.startsWith(folder)) ?? file);
      }
    }
  };
  walk(root);
  assert.deepEqual(Array.from(found).sort(), Object.keys(KEPT_COLUMN_FILES).sort());
  for (const [file, kind] of Object.entries(KEPT_COLUMN_FILES)) {
    if (kind !== 'withheld by run origin') continue;
    const source = readFileSync(join(root, file), 'utf8');
    assert.match(source, /resultsReadable/, `${file} returns what a run kept without asking who reads it`);
  }
}

async function main() {
  await dataSource.initialize();
  const tests: Array<[string, (s: Seed) => Promise<void> | void]> = [
    ['other people\'s runs show their line without the result', testOtherPeoplesRunsShowTheirLineWithoutTheResult],
    ['the agents screens name the arguments of another person\'s MCP call, without their values', testTheAgentsScreensNameTheArgumentsOfAnotherPersonsMcpCall],
    ['a failed run of another person shows how it ended, without the message', testAFailedRunOfAnotherPersonShowsHowItEndedWithoutTheMessage],
    ['the fingerprint of the arguments is read like the result', testTheFingerprintOfTheArgumentsIsReadLikeTheResult],
    ['an action of another person\'s run shows its line without the message or the fingerprint', testAnActionOfAnotherPersonsRunShowsItsLineWithoutTheMessageOrTheFingerprint],
    ['an agent run stays readable in full', testAnAgentRunStaysReadableInFull],
    ['the author reads their own results', testTheAuthorReadsTheirOwnResults],
    ['an Administrator reads every result', testAnAdministratorReadsEveryResult],
    ['a change prepared in a conversation is decided there, by its author only', testAChangePreparedInAConversationIsDecidedThereByItsAuthorOnly],
    ['every source that names what a run keeps of a call is classified', testEverySourceThatNamesAKeptColumnIsClassified],
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
