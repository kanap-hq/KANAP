import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractTriage, stageCostUsd } from '../lib/extract.mjs';

const dataset = {
  articles: [
    { key: 'vpn', title: 'VPN guide', source: 'fixture' },
    { key: 'r2-old', title: 'Old VPN', source: 'bench' },
  ],
};

const response = {
  diagnostic: {
    knowledge_query_candidates: ['vpn rejected', 'forticlient'],
    knowledge_query_attempts: [{ query: 'vpn rejected', result_count: 2 }, { query: 'forticlient', result_count: 1 }],
    knowledge_candidates: [
      { ref: 'DOC-1', title: 'VPN guide', score: 3, search_queries: ['vpn rejected', 'forticlient'] },
      { ref: 'DOC-9', title: '[R2] Old VPN', score: 1, search_queries: ['vpn rejected'] },
    ],
    knowledge_result_interpretation: { source: 'llm', selected_refs: ['DOC-1'], rejected: [{ ref: 'DOC-9', reason: 'draft' }], confidence: 0.8 },
    knowledge_documents: [{ ref: 'DOC-1', title: 'VPN guide' }],
    action_planner: { planned_actions: [{ action_type: 'requester_reply', reply_kind: 'sourced_answer' }, { action_type: 'internal_note' }] },
    synthesis: { synthesis_usable: true, synthesis_used_sources: [{ kind: 'knowledge', ref: 'DOC-1', title: 'VPN guide' }] },
  },
  public_reply_proposal: { output: { data: { actionPayload: { body: 'Clear the saved password.\n\nSources:\n- DOC-1 - VPN guide' } } } },
  detail: {
    run: {
      id: 'run-1',
      status: 'completed',
      started_at: '2026-11-12T10:00:00.000Z',
      completed_at: '2026-11-12T10:00:20.000Z',
      usage_json: { synthesis: { input_tokens: 1_000_000, output_tokens: 0, cache_write_input_tokens: 0, cache_read_input_tokens: 0 } },
    },
  },
};

test('the triage answer becomes queries, kept results, interpreter choice, citations and cost', () => {
  const r = extractTriage(response, dataset);
  assert.deepEqual(r.top5, ['vpn', 'r2-old']);
  assert.deepEqual(r.per_query[0], { query: 'vpn rejected', result_count: 2, kept: ['vpn', 'r2-old'] });
  assert.deepEqual(r.per_query[1].kept, ['vpn']);
  assert.deepEqual(r.interpretation.selected, ['vpn']);
  assert.deepEqual(r.interpretation.rejected, ['r2-old']);
  assert.deepEqual(r.read, ['vpn']);
  assert.deepEqual(r.cited, ['vpn']);
  assert.equal(r.planner.reply_kind, 'sourced_answer');
  assert.equal(r.run_ms, 20_000);
  assert.equal(r.cost_usd, 0.1);
});

test('without a requester reply nothing is cited', () => {
  const r = extractTriage({ ...response, public_reply_proposal: null }, dataset);
  assert.deepEqual(r.cited, []);
});

test('cached input is priced at the cache rates', () => {
  const cost = stageCostUsd({ input_tokens: 1_000_000, cache_read_input_tokens: 500_000, cache_write_input_tokens: 500_000, output_tokens: 1_000_000 });
  assert.equal(Number(cost.toFixed(4)), Number((0.5 * 0.1 * 0.1 + 0.5 * 0.1 * 1.25 + 0.5).toFixed(4)));
});
