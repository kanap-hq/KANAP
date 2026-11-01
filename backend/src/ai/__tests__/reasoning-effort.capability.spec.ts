import * as assert from 'node:assert/strict';
import {
  anthropicModelEfforts,
  anthropicModelSupportsEffort,
  reasoningEffortSupport,
  reasoningEffortToSend,
} from '../providers/reasoning-effort.capability';

// The levels each provider and model accept: the configuration checks them, the calls send them
// and the AI model dialog offers them.

const ALL = ['low', 'medium', 'high', 'xhigh', 'max'];

function testAnthropicLevelsPerModel() {
  const expected: Array<[string, string[]]> = [
    ['claude-opus-4-5', ['low', 'medium', 'high']],
    ['claude-opus-4-5-20251101', ['low', 'medium', 'high']],
    ['claude-opus-4-6', ['low', 'medium', 'high', 'max']],
    ['claude-sonnet-4-6', ['low', 'medium', 'high', 'max']],
    ['claude-opus-4-7', ALL],
    ['anthropic.claude-opus-4-8', ALL],
    ['claude-opus-5-5', ALL],
    ['claude-sonnet-5', ALL],
    ['claude-sonnet-5-5', ALL],
    ['claude-haiku-5-5', ALL],
    ['claude-fable-5-1', ALL],
    ['claude-mythos-5', ALL],
    // No effort field at all.
    ['claude-haiku-4-5', []],
    ['claude-sonnet-4-5', []],
    ['claude-sonnet-4-20250514', []],
    ['claude-opus-4-1', []],
    ['claude-opus-4-20250514', []],
    ['claude-3-5-sonnet-latest', []],
    ['some-other-model', []],
    ['', []],
  ];
  for (const [model, levels] of expected) {
    assert.deepEqual(anthropicModelEfforts(model), levels, model);
    assert.equal(anthropicModelSupportsEffort(model), levels.length > 0, model);
    assert.deepEqual(reasoningEffortSupport('anthropic', model), { levels, serverMayIgnore: false }, model);
  }
}

function testOtherProviders() {
  // OpenAI: every level KANAP stores is one of OpenAI's names, sent as set.
  assert.deepEqual(reasoningEffortSupport('openai', 'gpt-5.5'), { levels: ALL, serverMayIgnore: false });
  // Ollama and custom endpoints: KANAP cannot know the server, which may ignore the field.
  for (const provider of ['ollama', 'custom', null]) {
    assert.deepEqual(reasoningEffortSupport(provider, 'deepseek-v4'), { levels: ALL, serverMayIgnore: true }, String(provider));
  }
}

function testEffortToSend() {
  assert.equal(reasoningEffortToSend('anthropic', 'claude-haiku-5-5', 'medium'), 'medium');
  assert.equal(reasoningEffortToSend('anthropic', 'claude-haiku-4-5', 'medium'), null);
  assert.equal(reasoningEffortToSend('anthropic', 'claude-sonnet-4-6', 'xhigh'), null);
  assert.equal(reasoningEffortToSend('anthropic', 'claude-opus-4-5', 'max'), null);
  assert.equal(reasoningEffortToSend('anthropic', 'claude-opus-5-5', null), null);
  assert.equal(reasoningEffortToSend('openai', 'gpt-5.5', 'xhigh'), 'xhigh');
  assert.equal(reasoningEffortToSend('custom', 'deepseek-v4', 'max'), 'max');
  assert.equal(reasoningEffortToSend('ollama', 'qwen3', undefined), null);
}

testAnthropicLevelsPerModel();
testOtherProviders();
testEffortToSend();
console.log('reasoning-effort.capability.spec: all assertions passed');
