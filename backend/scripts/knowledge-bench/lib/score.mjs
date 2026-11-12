// The three numbers of the bench, per ticket and per family. Pure functions.
import { FAMILIES } from './dataset.mjs';

// Where the expected document was lost, in the order of the chain.
export const LOSS_STAGES = {
  never_found: 'never found by the search',
  outside_top5: 'found outside the first five, not retained',
  not_retained: 'in the first five, set aside by the interpreter',
  no_reply: 'retained, no requester reply proposed',
  not_cited: 'reply proposed, document not cited',
  error: 'run failed',
};

/**
 * Verdict of one ticket. `ticket`: the set entry. `run`: the result of extractTriage, or
 * { error } when the run failed.
 * - top5: an expected document is among the first five candidates after the merge (null when none is expected).
 * - cited: an expected document is cited by the proposed requester reply (null when none is expected).
 * - abstention: nothing expected, and the reply cites no document beyond the ticket's `acceptable` ones (null otherwise).
 * - forbidden_cited: a draft or obsolete document named by the ticket is cited.
 */
export function verdictOf(ticket, run) {
  const expected = ticket.expected ?? [];
  const forbidden = ticket.forbidden ?? [];
  if (!run || run.error) {
    return {
      top5: expected.length ? false : null,
      cited: expected.length ? false : null,
      abstention: expected.length ? null : false,
      forbidden_cited: false,
      loss_stage: 'error',
      expected_rank: null,
    };
  }
  const merged = run.merged ?? [];
  const keys = merged.map((c) => c.key ?? c.ref);
  const rankOf = (key) => { const i = keys.indexOf(key); return i < 0 ? null : i + 1; };
  const cited = run.cited ?? [];
  const forbiddenCited = forbidden.some((key) => cited.includes(key));
  if (!expected.length) {
    // `acceptable`: a published document whose citation is no fault (it says what is current).
    const acceptable = ticket.acceptable ?? [];
    return {
      top5: null,
      cited: null,
      abstention: cited.every((key) => acceptable.includes(key)),
      forbidden_cited: forbiddenCited,
      loss_stage: null,
      expected_rank: null,
    };
  }
  const ranks = expected.map(rankOf).filter((r) => r != null);
  const bestRank = ranks.length ? Math.min(...ranks) : null;
  const top5 = bestRank != null && bestRank <= 5;
  const isCited = expected.some((key) => cited.includes(key));
  let lossStage = null;
  if (!isCited) {
    const read = run.read ?? [];
    const retained = expected.some((key) => read.includes(key));
    if (bestRank == null) lossStage = 'never_found';
    else if (!retained) lossStage = top5 ? 'not_retained' : 'outside_top5';
    else if (!run.reply) lossStage = 'no_reply';
    else lossStage = 'not_cited';
  }
  return { top5, cited: isCited, abstention: null, forbidden_cited: forbiddenCited, loss_stage: lossStage, expected_rank: bestRank };
}

function rate(values) {
  const counted = values.filter((v) => v != null);
  return { hits: counted.filter(Boolean).length, total: counted.length };
}

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Aggregates the per-ticket results (each { n, family, verdict, cost_usd, duration_ms }). */
export function scoreResults(results) {
  const block = (rows) => ({
    tickets: rows.length,
    top5: rate(rows.map((r) => r.verdict.top5)),
    cited: rate(rows.map((r) => r.verdict.cited)),
    abstention: rate(rows.map((r) => r.verdict.abstention)),
    forbidden_cited: rows.filter((r) => r.verdict.forbidden_cited).length,
    errors: rows.filter((r) => r.error).length,
    cost_usd: rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0),
    median_ms: median(rows.map((r) => r.duration_ms)),
    max_ms: rows.reduce((max, r) => Math.max(max, r.duration_ms ?? 0), 0),
  });
  const byFamily = {};
  for (const family of FAMILIES) {
    const rows = results.filter((r) => r.family === family);
    if (rows.length) byFamily[family] = block(rows);
  }
  const losses = {};
  for (const r of results) {
    const stage = r.verdict.loss_stage;
    if (stage) (losses[stage] ??= []).push(r.n);
  }
  return { total: block(results), byFamily, losses };
}

export const formatRate = ({ hits, total }) => (total ? `${hits}/${total} (${Math.round((hits / total) * 100)} %)` : 'n/a');
