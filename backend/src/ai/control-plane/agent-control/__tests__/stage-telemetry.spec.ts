import * as assert from 'node:assert/strict';
import { AiAgentControlService, RUN_STEP_STAGES } from '../ai-agent-control.service';

/**
 * Telemetry contract for the agentic stages.
 *
 * Ten near-identical writers collapsed into `recordStageRunStep` and `recordStageUsage`. The
 * risk in that move is not the refactor itself but the values it carries: the run detail view
 * groups steps by `kind`/`capability_name`, and the usage tiles read `usage_json[stageKey]` /
 * `cost_json[stageKey]`. A wrong key is silent -- the tile just shows nothing -- so both the
 * stage table and the written shape are pinned here.
 */

const RUN_STEP_STAGE_EXPECTATIONS = {
  synthesis: { kind: 'synthesis', capabilityName: 'answer_synthesis' },
  diagnosticBrief: { kind: 'synthesis', capabilityName: 'diagnostic_brief_synthesis' },
  needRepresentation: { kind: 'need_representation', capabilityName: 'ticket_need_representation' },
  evidenceExtraction: { kind: 'evidence_extraction', capabilityName: 'ticket_image_evidence_extraction' },
};

function testStageTableMatchesTheFormerPerStageMethods() {
  assert.deepEqual(RUN_STEP_STAGES, RUN_STEP_STAGE_EXPECTATIONS);
}

/** Captures what the run-step writer saves. */
function createRunStepContext() {
  const saved: any[] = [];
  const context = {
    tenantId: 'tenant-1',
    manager: {
      getRepository: () => ({
        create: (payload: any) => payload,
        save: async (payload: any) => {
          saved.push(payload);
          return payload;
        },
      }),
    },
  };
  return { context, saved };
}

async function testRunStepWritesTheStageIdentity() {
  for (const [name, stage] of Object.entries(RUN_STEP_STAGES)) {
    const { context, saved } = createRunStepContext();
    const method = (AiAgentControlService.prototype as any).recordStageRunStep;

    await method.call(null, context, stage, {
      runId: 'run-1',
      stepIndex: 3,
      status: 'completed',
      inputSummary: { a: 1 },
      outputSummary: { b: 2 },
    });

    assert.equal(saved.length, 1, `${name}: one run step is written`);
    const row = saved[0];
    assert.equal(row.tenant_id, 'tenant-1');
    assert.equal(row.run_id, 'run-1');
    assert.equal(row.step_index, 3);
    assert.equal(row.status, 'completed');
    assert.equal(row.kind, stage.kind, `${name}: kind`);
    assert.equal(row.capability_name, stage.capabilityName, `${name}: capability name`);
    assert.equal(row.capability_version, '1.0.0', `${name}: default capability version`);
    assert.deepEqual(row.input_summary, { a: 1 });
    assert.deepEqual(row.output_summary, { b: 2 });
    assert.equal(row.error_message, null);
    assert.ok(row.started_at instanceof Date && row.completed_at instanceof Date && row.created_at instanceof Date);
  }
}

async function testRunStepCarriesAnExplicitVersionAndError() {
  const { context, saved } = createRunStepContext();
  const method = (AiAgentControlService.prototype as any).recordStageRunStep;

  await method.call(
    null,
    context,
    { kind: 'synthesis', capabilityName: 'answer_synthesis', capabilityVersion: '2.0.0' },
    {
      runId: 'run-2',
      stepIndex: 0,
      status: 'failed',
      inputSummary: {},
      outputSummary: {},
      errorMessage: 'boom',
    },
  );

  assert.equal(saved[0].capability_version, '2.0.0');
  assert.equal(saved[0].error_message, 'boom');
  assert.equal(saved[0].status, 'failed');
}

/** Captures the usage mirror updates. */
function createUsageContext() {
  const run: any = { id: 'run-1', tenant_id: 'tenant-1', usage_json: null, cost_json: null };
  const saves: any[] = [];
  const context = {
    tenantId: 'tenant-1',
    manager: {
      getRepository: () => ({
        findOne: async () => run,
        save: async (entity: any) => {
          saves.push(JSON.parse(JSON.stringify(entity)));
          return entity;
        },
      }),
    },
  };
  return { context, run, saves };
}

const STAGE_KEYS = [
  'synthesis',
  'diagnostic_brief',
  'need_representation',
  'knowledge_interpretation',
  'evidence_extraction',
  'action_planner',
];

async function testUsageMirrorWritesEveryStageKey() {
  for (const stageKey of STAGE_KEYS) {
    const { context, saves } = createUsageContext();
    const method = (AiAgentControlService.prototype as any).recordStageUsage;

    await method.call(null, context, stageKey, 'run-1', {
      usage: { input_tokens: 11, output_tokens: 22 },
      estimated_tokens: 33,
      estimated_cost_eur: 0.44,
      model: 'test-model',
    });

    assert.equal(saves.length, 1, `${stageKey}: the run is saved once`);
    assert.deepEqual(saves[0].usage_json[stageKey], {
      input_tokens: 11,
      output_tokens: 22,
      estimated_tokens: 33,
    });
    assert.deepEqual(saves[0].cost_json[stageKey], {
      estimated_cost_eur: 0.44,
      model: 'test-model',
    });
  }
}

async function testUsageMirrorKeepsTheCacheTokensTheProviderReported() {
  const { context, saves } = createUsageContext();
  const method = (AiAgentControlService.prototype as any).recordStageUsage;

  await method.call(null, context, 'synthesis', 'run-1', {
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 80, cache_write_input_tokens: 15 },
    estimated_tokens: 110,
    estimated_cost_eur: 0.01,
    model: 'anthropic:claude-sonnet-5-5',
  });
  assert.deepEqual(saves[0].usage_json.synthesis, {
    input_tokens: 100,
    output_tokens: 10,
    cache_read_input_tokens: 80,
    cache_write_input_tokens: 15,
    estimated_tokens: 110,
  });
}

async function testUsageMirrorMergesRatherThanReplaces() {
  const { context, run, saves } = createUsageContext();
  run.usage_json = { synthesis: { input_tokens: 1, output_tokens: 1, estimated_tokens: 1 } };
  run.cost_json = { synthesis: { estimated_cost_eur: 0.1, model: 'first' } };
  const method = (AiAgentControlService.prototype as any).recordStageUsage;

  await method.call(null, context, 'action_planner', 'run-1', {
    usage: { input_tokens: 5, output_tokens: 6 },
    estimated_tokens: 7,
    estimated_cost_eur: 0.2,
    model: 'second',
  });

  // The earlier stage must survive: stages accumulate on the same run.
  assert.ok(saves[0].usage_json.synthesis, 'the previous stage usage is kept');
  assert.ok(saves[0].usage_json.action_planner, 'the new stage usage is added');
  assert.ok(saves[0].cost_json.synthesis, 'the previous stage cost is kept');
  assert.equal(saves[0].cost_json.action_planner.model, 'second');
}

async function testUsageMirrorToleratesAMissingResult() {
  const { context, saves } = createUsageContext();
  const method = (AiAgentControlService.prototype as any).recordStageUsage;

  await method.call(null, context, 'synthesis', 'run-1', undefined);

  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].usage_json.synthesis, {
    input_tokens: null,
    output_tokens: null,
  });
  // The persisted shape (captured through JSON, like the jsonb column) simply omits
  // estimated_tokens, because an undefined value has no key in JSON. Same as before.
  assert.equal(saves[0].cost_json.synthesis.estimated_cost_eur, undefined);
  assert.equal(saves[0].cost_json.synthesis.model, null);
}

async function testUsageMirrorStopsWhenTheRunIsGone() {
  const context = {
    tenantId: 'tenant-1',
    manager: { getRepository: () => ({ findOne: async () => null, save: async () => undefined }) },
  };
  const method = (AiAgentControlService.prototype as any).recordStageUsage;

  // Must not throw: the run may have been purged between the stage and the mirror.
  await method.call(null, context, 'synthesis', 'gone', { estimated_tokens: 1 });
}

async function run() {
  testStageTableMatchesTheFormerPerStageMethods();
  await testRunStepWritesTheStageIdentity();
  await testRunStepCarriesAnExplicitVersionAndError();
  await testUsageMirrorWritesEveryStageKey();
  await testUsageMirrorKeepsTheCacheTokensTheProviderReported();
  await testUsageMirrorMergesRatherThanReplaces();
  await testUsageMirrorToleratesAMissingResult();
  await testUsageMirrorStopsWhenTheRunIsGone();
}

void run();
