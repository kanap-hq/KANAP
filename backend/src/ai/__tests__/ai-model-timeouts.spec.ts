import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { AiModelConfigsController } from '../ai-model-configs.controller';
import {
  AGENT_STAGE_DEFAULT_TIMEOUT_MS,
  AGENT_STAGE_TIMEOUT_ENV_NAMES,
  appliedModelTimeouts,
} from '../ai-model-timeouts';

// The AI models page shows, under an empty timeout, the limits that apply when a model has
// none of its own: the assistant's and the agent stages', read as the calls read them.

const AGENT_STAGE_FILES = [
  'ai-agent-action-planner.service.ts',
  'ai-diagnostic-brief-synthesis.service.ts',
  'ai-knowledge-search-planner.service.ts',
  'ai-reply-synthesis.service.ts',
  'ai-ticket-evidence-extraction.service.ts',
  'ai-ticket-need-representation.service.ts',
];

function testDefaults() {
  assert.deepEqual(appliedModelTimeouts({}), { chat_ms: 300_000, agent_ms_min: 120_000, agent_ms_max: 120_000 });
}

function testVariablesAreReadAsTheCallsReadThem() {
  const empty = Object.fromEntries(AGENT_STAGE_TIMEOUT_ENV_NAMES.map((name) => [name, '  ']));
  assert.deepEqual(
    appliedModelTimeouts({ AI_CHAT_PROVIDER_TIMEOUT_MS: '', ...empty }),
    { chat_ms: 300_000, agent_ms_min: 120_000, agent_ms_max: 120_000 },
    'empty values fall back to the defaults',
  );
  for (const invalid of ['abc', '0', '-5', '1.5e3x']) {
    const timeouts = appliedModelTimeouts({ AI_CHAT_PROVIDER_TIMEOUT_MS: invalid });
    assert.equal(timeouts.chat_ms, 300_000, `the assistant ignores ${invalid}`);
  }
  assert.equal(appliedModelTimeouts({ AI_CHAT_PROVIDER_TIMEOUT_MS: ' 450000 ' }).chat_ms, 450_000);
  // A stage variable is read with parseInt, as the agent calls read it: "90000ms" is 90 000.
  assert.equal(appliedModelTimeouts({ AI_AGENT_REPLY_SYNTHESIS_TIMEOUT_MS: '90000ms' }).agent_ms_min, 90_000);
  assert.equal(appliedModelTimeouts({ AI_AGENT_REPLY_SYNTHESIS_TIMEOUT_MS: '0' }).agent_ms_min, 120_000);
  assert.equal(appliedModelTimeouts({ AI_AGENT_REPLY_SYNTHESIS_TIMEOUT_MS: 'abc' }).agent_ms_min, 120_000);
  assert.deepEqual(
    appliedModelTimeouts({ AI_AGENT_VISION_EXTRACTION_TIMEOUT_MS: '180000', AI_AGENT_KNOWLEDGE_LLM_TIMEOUT_MS: '60000' }),
    { chat_ms: 300_000, agent_ms_min: 60_000, agent_ms_max: 180_000 },
    'stages that differ give a range',
  );
}

function testProcessEnvIsReadAtTheCall() {
  const saved = process.env.AI_AGENT_ACTION_PLANNER_TIMEOUT_MS;
  try {
    process.env.AI_AGENT_ACTION_PLANNER_TIMEOUT_MS = '240000';
    assert.equal(appliedModelTimeouts().agent_ms_max, 240_000);
  } finally {
    if (saved === undefined) delete process.env.AI_AGENT_ACTION_PLANNER_TIMEOUT_MS;
    else process.env.AI_AGENT_ACTION_PLANNER_TIMEOUT_MS = saved;
  }
}

function testTheListIsTheOneTheStagesPass() {
  const names = new Set<string>();
  for (const file of AGENT_STAGE_FILES) {
    const source = fs.readFileSync(backendPath('src', 'ai', 'control-plane', 'agent-control', file), 'utf8');
    const passed = [...source.matchAll(/timeoutEnvName:\s*'([A-Z_]+)'/g)].map((match) => match[1]);
    assert.ok(passed.length > 0, `${file} passes a timeout variable`);
    passed.forEach((name) => names.add(name));
    // Every default the stage passes is the module's default.
    const defaults = [...source.matchAll(/defaultTimeoutMs:\s*([A-Z_]+)/g)].map((match) => match[1]);
    assert.ok(defaults.length > 0, `${file} passes a default timeout`);
    for (const constant of new Set(defaults)) {
      const declared = source.match(new RegExp(`const ${constant} = ([\\d_]+);`));
      assert.ok(declared, `${file} declares ${constant}`);
      assert.equal(Number(declared![1].replace(/_/g, '')), AGENT_STAGE_DEFAULT_TIMEOUT_MS, `${file}: ${constant}`);
    }
  }
  // No other file of the backend passes a stage variable.
  const others = fs.readdirSync(backendPath('src', 'ai', 'control-plane', 'agent-control'))
    .filter((file) => file.endsWith('.ts') && !AGENT_STAGE_FILES.includes(file))
    .filter((file) => /timeoutEnvName:\s*'/.test(
      fs.readFileSync(backendPath('src', 'ai', 'control-plane', 'agent-control', file), 'utf8'),
    ));
  assert.deepEqual(others, []);
  assert.deepEqual([...names].sort(), [...AGENT_STAGE_TIMEOUT_ENV_NAMES].sort());
}

function controller(tier: 'full' | 'assignment') {
  const config = {
    id: '00000000-0000-4000-8000-0000000000aa',
    name: 'Local',
    status: 'active',
    is_default: false,
    supports_vision: false,
    provider: 'ollama',
    llm_timeout_ms: null,
  };
  return new AiModelConfigsController(
    { run: async (_tenantId: string, fn: (manager: unknown) => unknown) => fn({}) } as any,
    { resolveModelConfigReadTier: async () => tier } as any,
    { list: async () => [config] } as any,
    {} as any,
    { canEncrypt: () => true } as any,
  );
}

const REQ = { tenant: { id: '00000000-0000-4000-8000-000000000001' }, user: { sub: 'user-1' } } as any;

async function testTheFullListCarriesTheAppliedLimits() {
  const saved = process.env.AI_CHAT_PROVIDER_TIMEOUT_MS;
  try {
    process.env.AI_CHAT_PROVIDER_TIMEOUT_MS = '600000';
    const full = await controller('full').list(REQ) as Record<string, unknown>;
    assert.deepEqual(full.applied_timeouts, { chat_ms: 600_000, agent_ms_min: 120_000, agent_ms_max: 120_000 });
  } finally {
    if (saved === undefined) delete process.env.AI_CHAT_PROVIDER_TIMEOUT_MS;
    else process.env.AI_CHAT_PROVIDER_TIMEOUT_MS = saved;
  }
}

async function testTheAssignmentListDoesNot() {
  const reduced = await controller('assignment').list(REQ) as Record<string, unknown>;
  assert.equal('applied_timeouts' in reduced, false);
  assert.deepEqual(Object.keys(reduced).sort(), ['model_configs', 'secret_writable']);
  assert.deepEqual(Object.keys((reduced.model_configs as object[])[0]).sort(), ['id', 'is_default', 'name', 'status', 'supports_vision']);
}

async function run() {
  testDefaults();
  testVariablesAreReadAsTheCallsReadThem();
  testProcessEnvIsReadAtTheCall();
  testTheListIsTheOneTheStagesPass();
  await testTheFullListCarriesTheAppliedLimits();
  await testTheAssignmentListDoesNot();
  console.log('ai-model-timeouts.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
