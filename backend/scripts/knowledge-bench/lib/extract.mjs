// Reads what the bench needs from the answer of POST /ai/admin/control-plane/uat/ticketing-triage
// (the manual "test on a ticket" run of an agent): the chain's own record of each step.
// Pure: the response object in, a flat result out.
import { tenantTitle } from './dataset.mjs';

// List prices of the included model (Claude Haiku 5.5, USD per million tokens, prompts up to 100K).
// The built-in provider records 0 EUR per run: the bench prices the tokens itself.
export const HAIKU_PRICES_USD = { input: 0.10, output: 0.50, cacheWriteFactor: 1.25, cacheReadFactor: 0.1 };

/** USD of one stage. `input_tokens` counts the whole prompt, cached part included (as Kadratis records it). */
export function stageCostUsd(usage, prices = HAIKU_PRICES_USD) {
  if (!usage) return 0;
  const input = Math.max(0, Number(usage.input_tokens) || 0);
  const read = Math.min(input, Math.max(0, Number(usage.cache_read_input_tokens) || 0));
  const write = Math.min(input - read, Math.max(0, Number(usage.cache_write_input_tokens) || 0));
  const output = Math.max(0, Number(usage.output_tokens) || 0);
  const cost = (input - read - write) * prices.input
    + read * prices.input * prices.cacheReadFactor
    + write * prices.input * prices.cacheWriteFactor
    + output * prices.output;
  return cost / 1_000_000;
}

/** Map from the title a document carries in the tenant to the article key of the set. */
export function titleIndex(dataset) {
  const index = new Map();
  for (const article of dataset.articles) index.set(tenantTitle(article), article.key);
  return index;
}

const keyOf = (index, title) => index.get(title) ?? null;

export function extractTriage(response, dataset) {
  const index = titleIndex(dataset);
  const d = response?.diagnostic ?? {};
  const run = response?.detail?.run ?? {};
  const refToKey = new Map();
  const remember = (ref, title) => {
    if (ref && title && !refToKey.has(ref)) refToKey.set(ref, keyOf(index, title));
  };

  const candidates = (d.knowledge_candidates ?? []).map((c, i) => {
    remember(c.ref, c.title);
    return { rank: i + 1, ref: c.ref, key: keyOf(index, c.title), title: c.title, score: c.score ?? null, queries: c.search_queries ?? [] };
  });
  for (const r of d.knowledge_results ?? []) remember(r.ref, r.title);
  for (const r of d.knowledge_documents ?? []) remember(r.ref, r.title);

  const queries = d.knowledge_query_candidates ?? d.knowledge_query_derivation?.queries ?? [];
  const attempts = d.knowledge_query_attempts ?? [];
  // The chain keeps the first five results of each query; the candidates record which queries
  // brought each document, so the kept results of a query are the candidates that name it.
  const perQuery = queries.map((query) => {
    const attempt = attempts.find((a) => a.query === query);
    const kept = candidates.filter((c) => c.queries.includes(query)).map((c) => c.key ?? c.ref);
    return { query, result_count: attempt?.result_count ?? null, kept };
  });

  const interpretation = d.knowledge_result_interpretation ?? null;
  const selectedRefs = interpretation?.selected_refs ?? [];
  const rejectedRefs = (interpretation?.rejected ?? []).map((r) => r.ref);
  const readRefs = (d.knowledge_documents ?? []).map((r) => r.ref);

  const replyPayload = response?.public_reply_proposal?.output?.data?.actionPayload ?? null;
  const notePayload = response?.proposal?.output?.data?.actionPayload ?? null;
  const synthesis = d.synthesis ?? null;
  const usedSources = (synthesis?.synthesis_used_sources ?? []).filter((s) => s.kind === 'knowledge');
  for (const s of usedSources) remember(s.ref, s.title);
  const plannedReply = (d.action_planner?.planned_actions ?? []).find((a) => a.action_type === 'requester_reply') ?? null;
  const toKeys = (refs) => refs.map((ref) => refToKey.get(ref) ?? ref);

  const usage = run.usage_json ?? {};
  const stages = ['need_representation', 'knowledge_interpretation', 'action_planner', 'synthesis', 'technician_brief', 'administrative_reply'];
  const tokens = {};
  let costUsd = 0;
  for (const stage of stages) {
    if (!usage[stage]) continue;
    tokens[stage] = {
      input: usage[stage].input_tokens ?? 0,
      output: usage[stage].output_tokens ?? 0,
      cache_read: usage[stage].cache_read_input_tokens ?? 0,
      cache_write: usage[stage].cache_write_input_tokens ?? 0,
    };
    costUsd += stageCostUsd(usage[stage]);
  }
  const runMs = run.started_at && run.completed_at ? Date.parse(run.completed_at) - Date.parse(run.started_at) : null;

  return {
    run_id: run.id ?? d.run_id ?? null,
    run_status: run.status ?? null,
    run_ms: runMs,
    need_language: d.knowledge_search_plan?.language ?? d.knowledge_need_representation?.need?.language ?? null,
    queries,
    per_query: perQuery,
    merged: candidates.map(({ queries: _q, ...c }) => ({ ...c, query_count: _q.length })),
    top5: candidates.slice(0, 5).map((c) => c.key ?? c.ref),
    interpretation: interpretation ? {
      source: interpretation.source ?? null,
      selected: toKeys(selectedRefs),
      rejected: toKeys(rejectedRefs),
      confidence: interpretation.confidence ?? null,
      needs_human_review: interpretation.needs_human_review ?? null,
    } : null,
    read: toKeys(readRefs),
    planner: {
      reply_kind: plannedReply?.reply_kind ?? null,
      actions: (d.action_planner?.planned_actions ?? []).map((a) => a.action_type),
      fallback_reason: d.action_planner?.fallback_reason ?? null,
      rationale: d.action_planner?.rationale ?? null,
    },
    reply: replyPayload ? { body: replyPayload.body ?? null } : null,
    internal_note: notePayload ? { body: notePayload.body ?? notePayload.noteBody ?? null } : null,
    synthesis: synthesis ? {
      usable: synthesis.synthesis_usable ?? null,
      fallback_reason: synthesis.synthesis_fallback_reason ?? null,
      language: synthesis.synthesis_language ?? null,
      used: toKeys(usedSources.map((s) => s.ref)),
      rejected: toKeys((synthesis.synthesis_rejected_sources ?? []).map((s) => s.ref).filter(Boolean)),
    } : null,
    // A document counts as cited when the proposed requester reply carries it as a source, or
    // names its reference in the text.
    cited: replyPayload ? [...new Set([
      ...(synthesis?.synthesis_usable ? usedSources.map((s) => s.ref) : []),
      ...String(replyPayload.body ?? '').match(/\bDOC-\d+\b/g) ?? [],
    ])].map((ref) => refToKey.get(ref) ?? ref) : [],
    tokens,
    cost_usd: Number(costUsd.toFixed(6)),
    skipped_actions: d.skipped_actions ?? null,
  };
}
