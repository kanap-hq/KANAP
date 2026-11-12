// Markdown reports: one run, and the comparison of two runs. Pure functions.
import { FAMILIES, FAMILY_LABELS } from './dataset.mjs';
import { formatRate, LOSS_STAGES } from './score.mjs';

const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const seconds = (ms) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
const usd = (value) => `$${(value ?? 0).toFixed(4)}`;
const yesNo = (value) => (value == null ? '' : value ? 'yes' : 'no');

function scoreTable(scores) {
  const lines = [
    '| Family | Tickets | Right document in the first 5 | Right document cited | Right abstention | Draft or obsolete cited | Median time | Cost |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const family of FAMILIES) {
    const s = scores.byFamily[family];
    if (!s) continue;
    lines.push(`| ${FAMILY_LABELS[family]} | ${s.tickets} | ${formatRate(s.top5)} | ${formatRate(s.cited)} | ${formatRate(s.abstention)} | ${s.forbidden_cited} | ${seconds(s.median_ms)} | ${usd(s.cost_usd)} |`);
  }
  const t = scores.total;
  lines.push(`| **Total** | ${t.tickets} | **${formatRate(t.top5)}** | **${formatRate(t.cited)}** | **${formatRate(t.abstention)}** | ${t.forbidden_cited} | ${seconds(t.median_ms)} | ${usd(t.cost_usd)} |`);
  return lines.join('\n');
}

export function buildRunReport({ meta, results, scores }) {
  const out = [];
  out.push(`# Knowledge search bench: ${meta.tenant}${meta.label ? ` (${meta.label})` : ''}`);
  out.push('');
  out.push(`- Served version: ${meta.served_version ?? 'unknown'} at the start, ${meta.served_version_end ?? 'unknown'} at the end; bench commit: ${meta.bench_commit ?? 'unknown'}`);
  const interrupted = results.filter((r) => r.interruptions?.length).map((r) => r.n);
  if (interrupted.length) out.push(`- Replayed after an API outage (not counted as misses): tickets ${interrupted.join(', ')}`);
  out.push(`- Started ${meta.started_at}, finished ${meta.finished_at ?? 'unfinished'}; ${results.length} tickets, ${scores.total.errors} failed runs`);
  out.push(`- Cost at list price of the included model: ${usd(scores.total.cost_usd)} in total, ${usd(scores.total.cost_usd / Math.max(1, results.length))} per triage; median time ${seconds(scores.total.median_ms)}, longest ${seconds(scores.total.max_ms)}`);
  out.push('');
  out.push('## The three numbers');
  out.push('');
  out.push(scoreTable(scores));
  out.push('');
  out.push('## Where the expected document was lost');
  out.push('');
  const lossKeys = Object.keys(LOSS_STAGES).filter((k) => scores.losses[k]?.length);
  if (!lossKeys.length) out.push('No loss.');
  for (const key of lossKeys) out.push(`- ${LOSS_STAGES[key]}: ${scores.losses[key].length} (tickets ${scores.losses[key].join(', ')})`);
  const wrongAbstention = results.filter((r) => r.verdict.abstention === false).map((r) => r.n);
  if (wrongAbstention.length) out.push(`- no document answers, yet a document was cited: tickets ${wrongAbstention.join(', ')}`);
  const forbidden = results.filter((r) => r.verdict.forbidden_cited).map((r) => r.n);
  if (forbidden.length) out.push(`- a draft or obsolete document was cited: tickets ${forbidden.join(', ')}`);
  out.push('');
  out.push('## Tickets');
  out.push('');
  out.push('| # | Family | Lang | Expected | Rank | First five after the merge | Interpreter kept | Cited | Verdict | Time | Cost |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of [...results].sort((a, b) => a.n - b.n)) {
    const v = r.verdict;
    let verdict;
    if (r.error) verdict = `error: ${r.error.slice(0, 80)}`;
    else if (v.abstention != null) verdict = v.abstention ? 'right abstention' : 'cited a document';
    else verdict = v.cited ? 'cited' : LOSS_STAGES[v.loss_stage] ?? 'missed';
    if (v.forbidden_cited) verdict += ' (draft or obsolete cited)';
    out.push(`| ${r.n} | ${r.family} | ${r.lang} | ${cell((r.expected ?? []).join(', ') || 'none')} | ${v.expected_rank ?? ''} | ${cell((r.top5 ?? []).join(', '))} | ${cell((r.interpretation?.selected ?? []).join(', '))} | ${cell((r.cited ?? []).join(', '))} | ${cell(verdict)} | ${seconds(r.duration_ms)} | ${usd(r.cost_usd)} |`);
  }
  out.push('');
  out.push('## Generated queries of the missed tickets');
  out.push('');
  const missed = results.filter((r) => r.verdict.cited === false || r.verdict.abstention === false || r.verdict.forbidden_cited);
  if (!missed.length) out.push('None.');
  for (const r of missed.sort((a, b) => a.n - b.n)) {
    out.push(`- **#${r.n}** (${r.family}, ${r.lang}, need language ${r.need_language ?? '?'}; planner: ${(r.planner?.actions ?? []).join(', ') || 'none'}${r.planner?.reply_kind ? `, ${r.planner.reply_kind}` : ''}):`);
    for (const q of r.per_query ?? []) out.push(`  - \`${cell(q.query)}\` -> ${q.result_count ?? '?'} results, kept ${cell(q.kept.join(', ')) || 'none'}`);
  }
  out.push('');
  return out.join('\n');
}

export function buildCompareReport({ a, b }) {
  const name = (run) => `${run.meta.tenant}${run.meta.label ? ` (${run.meta.label})` : ''}`;
  const out = [`# Comparison: A = ${name(a)}, B = ${name(b)}`, ''];
  out.push('| Family | First 5, A | First 5, B | Cited, A | Cited, B | Abstention, A | Abstention, B |');
  out.push('|---|---|---|---|---|---|---|');
  for (const family of [...FAMILIES, 'total']) {
    const sa = family === 'total' ? a.scores.total : a.scores.byFamily[family];
    const sb = family === 'total' ? b.scores.total : b.scores.byFamily[family];
    if (!sa && !sb) continue;
    const label = family === 'total' ? '**Total**' : FAMILY_LABELS[family];
    const f = (s, key) => (s ? formatRate(s[key]) : 'n/a');
    out.push(`| ${label} | ${f(sa, 'top5')} | ${f(sb, 'top5')} | ${f(sa, 'cited')} | ${f(sb, 'cited')} | ${f(sa, 'abstention')} | ${f(sb, 'abstention')} |`);
  }
  out.push('');
  out.push(`Cost: A ${usd(a.scores.total.cost_usd)}, B ${usd(b.scores.total.cost_usd)}. Median time: A ${seconds(a.scores.total.median_ms)}, B ${seconds(b.scores.total.median_ms)}.`);
  out.push('');
  out.push('## Tickets whose verdict differs');
  out.push('');
  const byN = new Map(b.results.map((r) => [r.n, r]));
  const summary = (r) => {
    if (!r) return 'not played';
    const v = r.verdict;
    if (v.abstention != null) return v.abstention ? 'abstained' : `cited ${(r.cited ?? []).join(', ')}`;
    return `top5 ${yesNo(v.top5)}, cited ${yesNo(v.cited)}${v.loss_stage ? ` (${v.loss_stage})` : ''}`;
  };
  let changed = 0;
  for (const ra of [...a.results].sort((x, y) => x.n - y.n)) {
    const rb = byN.get(ra.n);
    if (summary(ra) === summary(rb)) continue;
    changed++;
    out.push(`- #${ra.n} (${ra.family}): A ${summary(ra)}; B ${summary(rb)}`);
  }
  if (!changed) out.push('None.');
  out.push('');
  return out.join('\n');
}
