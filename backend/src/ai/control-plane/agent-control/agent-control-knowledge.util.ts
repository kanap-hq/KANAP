import { decodeHtmlEntities, HTML_TEXT_ENTITIES } from '../../../common/html-entities';
import { isRecord } from '../../../common/object-guards';
import { clampText, trimmedString } from './agent-control-util';
import type { ActionPlannerPromptInput } from './ai-agent-action-planner.service';
import type {
  KnowledgePlannerCandidate,
  KnowledgeResultInterpretation,
  KnowledgeSearchPlan,
} from './ai-knowledge-search-planner.service';
import type { TicketEvidenceExtractionResult } from './ai-ticket-evidence-extraction.service';
import type { ReplySynthesisResult } from './ai-reply-synthesis.service';
import type { TicketNeedRepresentationBuildResult } from './ai-ticket-need-representation.service';
import type { KnowledgeQueryDerivation } from './ai-ticket-need-representation.types';
// Type-only import from the service this module was extracted from: types are erased at
// compile time, so this introduces no runtime cycle while the header is being split up.
import type {
  KnowledgeSearchAttempt,
  KnowledgeSearchItem,
  MergedKnowledgeCandidate,
  TicketLike,
  TicketTimelineEntry,
  WebSearchResultItem,
} from './ai-agent-control.service';
import { HTML_TAGS, trailingRun } from '../../../common/text-scan';

/**
 * Knowledge retrieval, search planning and interpretation for ticketing triage.
 *
 * Extracted verbatim from the module-level header of ai-agent-control.service.ts, together
 * with the three query-shaping constants it uses (one of which is a 58-line stop-word list
 * that sat immediately above it).
 */

export const KNOWLEDGE_QUERY_STOP_WORDS = new Set([
  'a',
  'about',
  'ai',
  'aide',
  'aider',
  'an',
  'and',
  'avec',
  'besoin',
  'can',
  'ce',
  'ces',
  'cette',
  'choix',
  'de',
  'des',
  'du',
  'en',
  'est',
  'et',
  'for',
  'faut',
  'help',
  'i',
  'in',
  'is',
  'j',
  'je',
  'la',
  'le',
  'les',
  'm',
  'me',
  'mon',
  'need',
  'notre',
  'nous',
  'of',
  'on',
  'ou',
  'our',
  'please',
  'pour',
  'pouvez',
  's',
  'sur',
  'the',
  'this',
  'ticket',
  'ton',
  'un',
  'une',
  'urgent',
  'urgemment',
  'vous',
  'with',
]);
export const MAX_KNOWLEDGE_DOCUMENTS_FOR_REPLY = 3;
export const MAX_KNOWLEDGE_QUERY_CANDIDATES = 10;
// The searches of one triage: the derived queries (MAX_DERIVED_QUERIES of the need step), one per
// document language among them.
export const MAX_KNOWLEDGE_SEARCH_QUERIES = 12;

export const MIN_KNOWLEDGE_RELEVANCE_SCORE = 0.00001;
export const MIN_KNOWLEDGE_LEXICAL_OVERLAP = 1;

export function ticketLooksFrench(ticket: TicketLike): boolean {
  const text = `${ticket.title} ${ticket.description ?? ''}`.toLocaleLowerCase();
  return /[àâçéèêëîïôùûüÿœæ]/i.test(text)
    || /\b(bonjour|besoin|merci|recette|vous|pouvez|aider|demande|incident)\b/.test(text);
}

export function normalizeKnowledgeText(value: string | null | undefined): string {
  return decodeHtmlEntities(
    String(value ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(HTML_TAGS, ' '),
    { entities: HTML_TEXT_ENTITIES, ignoreCase: true },
  )
    .replace(/[’`]/g, '\'')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanKnowledgeCandidate(value: string | null | undefined): string {
  const normalized = normalizeKnowledgeText(value)
    .replace(/^[\s"'([{]+/g, '')
    .replace(trailingRun('"\')}].,:;!?', true), '')
    .trim();
  return clampText(normalized, 160);
}

export function uniqueKnowledgeCandidates(values: string[], max = MAX_KNOWLEDGE_QUERY_CANDIDATES): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const value of values) {
    const candidate = cleanKnowledgeCandidate(value);
    if (!candidate) continue;
    if (extractKnowledgeTokens(candidate).length === 0) continue;
    const key = candidate.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
    if (candidates.length >= max) break;
  }
  return candidates;
}

export function extractKnowledgePhrases(value: string): string[] {
  const text = normalizeKnowledgeText(value);
  if (!text) return [];

  const phrases: string[] = [];
  const patterns = [
    /\b(?:recette|procedure|documentation|document|doc|article|kb)\s+(?:de|du|des|d[' ]?un|d[' ]?une|d'|pour|sur|about|for|on)\s+([^.!?;:\n]{3,100})/giu,
    /\b(?:need|besoin|cherche|recherche|looking\s+for)\s+(?:a|an|the|de|du|des|d[' ]?un|d[' ]?une|d'|pour)?\s*([^.!?;:\n]{3,100})/giu,
    /\b(?:erreur|error|incident|alerte|alert|probleme|problem|issue|panne)\s+([^.!?;:\n]{3,100})/giu,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) {
        phrases.push(match[1]);
      }
    }
  }
  return phrases;
}

export function extractKnowledgeTokens(value: string, maxTokens = 8): string[] {
  const normalized = normalizeKnowledgeText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}'-]+/gu, ' ');
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const rawToken of normalized.split(/\s+/)) {
    for (const token of rawToken.split(/['-]/)) {
      const cleaned = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (
        cleaned.length < 3
        || KNOWLEDGE_QUERY_STOP_WORDS.has(cleaned)
        || seen.has(cleaned)
      ) {
        continue;
      }
      seen.add(cleaned);
      tokens.push(cleaned);
      if (tokens.length >= maxTokens) {
        return tokens;
      }
    }
  }
  return tokens;
}

export function buildKnowledgeQuery(ticket: TicketLike): string {
  return clampText([
    ticket.title,
    ticket.description,
  ].filter((entry) => !!entry).join(' '), 480);
}

export function buildKnowledgeQueryCandidates(ticket: TicketLike): string[] {
  const fullQuery = buildKnowledgeQuery(ticket);
  const sourceText = [
    ticket.title,
    ticket.description,
  ].filter((entry) => !!entry).join(' ');
  const tokens = extractKnowledgeTokens(sourceText);
  return uniqueKnowledgeCandidates([
    ...extractKnowledgePhrases(sourceText),
    tokens.slice(0, 4).join(' '),
    tokens.slice(0, 6).join(' '),
    ticket.title,
    fullQuery,
  ]);
}

export function buildShortKnowledgeQueryCandidates(ticket: TicketLike): string[] {
  const sourceText = [
    ticket.title,
    ticket.description,
  ].filter((entry) => !!entry).join(' ');
  const tokens = extractKnowledgeTokens(sourceText, 24);
  return uniqueKnowledgeCandidates([
    ...extractKnowledgePhrases(sourceText),
    tokens.slice(0, 4).join(' '),
    tokens.slice(0, 6).join(' '),
    tokens.slice(-4).join(' '),
    tokens.slice(-6).join(' '),
    extractKnowledgeTokens(ticket.title ?? '').slice(0, 5).join(' '),
  ]);
}

export function buildWebSearchQueryCandidates(
  ticket: TicketLike,
  timeline: TicketTimelineEntry[],
  knowledgeCandidates: string[],
): string[] {
  return uniqueKnowledgeCandidates([
    latestRequesterBody(timeline) ?? '',
    ticket.description ?? '',
    buildKnowledgeQuery(ticket),
    ...knowledgeCandidates,
    ...buildKnowledgeQueryCandidates(ticket),
    ticket.title ?? '',
  ]);
}

export function stripKnowledgeAccents(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function latestRequesterBody(timeline: TicketTimelineEntry[]): string | null {
  const entry = [...timeline].reverse().find((candidate) => candidate.actor === 'requester_candidate' && candidate.body.trim());
  return entry?.body ?? null;
}

export function extractKnowledgePreferenceTerms(timeline: TicketTimelineEntry[]): {
  positiveTerms: string[];
  negativeTerms: string[];
} {
  const latest = latestRequesterBody(timeline) ?? '';
  const positiveTerms: string[] = [];
  const negativeTerms: string[] = [];

  positiveTerms.push(...extractKnowledgeTokens(latest, 16));

  const negativePattern = /\b(?:je\s+n[' ]?aime\s+pas|j[' ]?aime\s+pas|pas|sans|eviter|éviter|avoid|not)\s+(?:le|la|les|du|de|des|un|une|the|a|an)?\s*([\p{L}\p{N}' -]{3,50})/giu;
  let match: RegExpExecArray | null;
  while ((match = negativePattern.exec(latest)) != null) {
    const term = normalizeKnowledgeText(match[1]).replace(/[.!?;:,].*$/g, '').trim();
    if (term) {
      negativeTerms.push(term);
    }
  }

  return {
    positiveTerms: uniqueKnowledgeCandidates(positiveTerms),
    negativeTerms: uniqueKnowledgeCandidates(negativeTerms),
  };
}

export function buildFallbackKnowledgeSearchPlan(
  ticket: TicketLike,
  timeline: TicketTimelineEntry[],
  queries: string[],
): KnowledgeSearchPlan {
  const preferences = extractKnowledgePreferenceTerms(timeline);
  return {
    source: 'deterministic',
    need: null,
    intent: latestRequesterBody(timeline) ?? ticket.title,
    language: ticketLooksFrench(ticket) ? 'fr' : null,
    positive_terms: preferences.positiveTerms,
    negative_terms: preferences.negativeTerms,
    queries,
    rationale: 'Deterministic fallback extracted requester lexical keywords.',
    confidence: null,
    model: null,
    warnings: [],
  };
}

function knowledgeLibraryId(item: Record<string, unknown>): string | null {
  const library = isRecord(item.library) ? item.library : null;
  const id = library?.id ?? item.library_id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

export function knowledgeItemsFromOutput(value: unknown): KnowledgeSearchItem[] {
  const record = isRecord(value) ? value : null;
  const items = Array.isArray(record?.items) ? record.items : [];
  const numericScore = (item: Record<string, unknown>): number | null => {
    const numeric = Number(item.score ?? item.rank);
    return Number.isFinite(numeric) ? numeric : null;
  };
  return items
    .filter(isRecord)
    .slice(0, 5)
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : undefined,
      ref: typeof item.ref === 'string' ? item.ref : null,
      title: typeof item.title === 'string' ? item.title : null,
      summary: typeof item.summary === 'string' ? item.summary : null,
      snippet: typeof item.snippet === 'string' ? item.snippet : null,
      content_markdown: typeof item.content_markdown === 'string' ? item.content_markdown : null,
      status: typeof item.status === 'string' ? item.status : null,
      updated_at: typeof item.updated_at === 'string' ? item.updated_at : null,
      score: numericScore(item),
      library_id: knowledgeLibraryId(item),
      fallback: item.fallback === true,
    }));
}

/**
 * The passages a `get_document` call in passages mode returns (`KnowledgeService.getDocumentSearchPassages`):
 * at most `maxPassages`, each at most `maxChars`. Null when the output holds none.
 */
export function knowledgePassagesFromOutput(
  value: unknown,
  maxPassages: number,
  maxChars: number,
): { matched: boolean; passages: string[] } | null {
  if (!isRecord(value) || !Array.isArray(value.passages)) {
    return null;
  }
  const passages = value.passages
    .filter((passage): passage is string => typeof passage === 'string')
    .map((passage) => clampText(normalizeKnowledgeText(passage), maxChars))
    .filter((passage) => passage.length > 0)
    .slice(0, maxPassages);
  return passages.length > 0 ? { matched: value.matched === true, passages } : null;
}

/** One query for the passages of a candidate: the words of the queries that found it, at most `maxChars`. */
export function knowledgePassageQuery(searchQueries: string[], maxChars: number): string {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const query of searchQueries) {
    for (const word of normalizeKnowledgeText(query).split(/\s+/)) {
      const key = stripKnowledgeAccents(word).toLocaleLowerCase();
      if (!word || seen.has(key)) continue;
      if ([...words, word].join(' ').length > maxChars) return words.join(' ');
      seen.add(key);
      words.push(word);
    }
  }
  return words.join(' ');
}

const WEB_TEXT_ENTITIES = { amp: '&', quot: '"', '#39': '\'', lt: '<', gt: '>' };

export function stripWebText(value: string): string {
  return decodeHtmlEntities(String(value || '').replace(HTML_TAGS, ' '), {
    entities: WEB_TEXT_ENTITIES,
    ignoreCase: true,
  })
    .replace(/\s+/g, ' ')
    .trim();
}

export function webSearchItemsFromOutput(value: unknown): WebSearchResultItem[] {
  const record = isRecord(value) ? value : null;
  const items = Array.isArray(record?.items) ? record.items : [];
  const seen = new Set<string>();
  const results: WebSearchResultItem[] = [];
  for (const item of items.filter(isRecord)) {
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const title = stripWebText(typeof item.title === 'string' ? item.title : '');
    const description = stripWebText(typeof item.description === 'string' ? item.description : '');
    if (!url || (!title && !description)) {
      continue;
    }
    const key = url.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push({ title, url, description });
    if (results.length >= 5) {
      break;
    }
  }
  return results;
}

export function knowledgeDocumentFromOutput(searchItem: KnowledgeSearchItem, value: unknown): KnowledgeSearchItem | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    ...searchItem,
    id: typeof value.id === 'string' ? value.id : searchItem.id,
    ref: typeof value.ref === 'string' ? value.ref : searchItem.ref ?? null,
    title: typeof value.title === 'string' ? value.title : searchItem.title ?? null,
    summary: typeof value.summary === 'string' ? value.summary : searchItem.summary ?? null,
    status: typeof value.status === 'string' ? value.status : searchItem.status ?? null,
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : searchItem.updated_at ?? null,
    content_markdown: typeof value.content_markdown === 'string' ? value.content_markdown : searchItem.content_markdown ?? null,
    score: searchItem.score ?? null,
    library_id: knowledgeLibraryId(value) ?? searchItem.library_id ?? null,
  };
}

export function knowledgeDocumentRef(item: KnowledgeSearchItem): string | null {
  return trimmedString(item.ref) ?? trimmedString(item.id);
}

export function knowledgeCandidateKey(item: KnowledgeSearchItem): string | null {
  const ref = knowledgeDocumentRef(item);
  return ref ? ref.toLocaleLowerCase() : null;
}

export function knowledgeScoreSortValue(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : Number.NEGATIVE_INFINITY;
}

export function mergeKnowledgeAttempts(attempts: KnowledgeSearchAttempt[]): MergedKnowledgeCandidate[] {
  const byKey = new Map<string, MergedKnowledgeCandidate>();
  for (const attempt of attempts) {
    for (const item of attempt.items) {
      const key = knowledgeCandidateKey(item);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) {
        existing.search_queries = Array.from(new Set([...existing.search_queries, attempt.query]));
        existing.summary = existing.summary ?? item.summary ?? null;
        existing.snippet = existing.snippet ?? item.snippet ?? null;
        existing.content_markdown = existing.content_markdown ?? item.content_markdown ?? null;
        existing.status = existing.status ?? item.status ?? null;
        existing.updated_at = existing.updated_at ?? item.updated_at ?? null;
        // A document is a fallback result only when every search that found it fell back.
        existing.fallback = existing.fallback === true && item.fallback === true;
        const nextScore = Math.max(knowledgeScoreSortValue(existing.score), knowledgeScoreSortValue(item.score));
        existing.score = nextScore === Number.NEGATIVE_INFINITY ? null : nextScore;
      } else {
        byKey.set(key, {
          ...item,
          search_queries: [attempt.query],
        });
      }
    }
  }
  return Array.from(byKey.values())
    .map((candidate) => ({
      ...candidate,
      match_count: candidate.search_queries.length,
    }))
    .sort((left, right) => {
      const scoreDelta = knowledgeScoreSortValue(right.score) - knowledgeScoreSortValue(left.score);
      if (scoreDelta !== 0) return scoreDelta;
      const matchDelta = (right.match_count ?? right.search_queries.length) - (left.match_count ?? left.search_queries.length);
      if (matchDelta !== 0) return matchDelta;
      return String(left.title ?? left.ref ?? left.id ?? '').localeCompare(String(right.title ?? right.ref ?? right.id ?? ''));
    });
}

export function plannerCandidatesFromKnowledge(candidates: MergedKnowledgeCandidate[]): KnowledgePlannerCandidate[] {
  return candidates.map((candidate) => ({
    ref: knowledgeDocumentRef(candidate),
    title: candidate.title ?? null,
    summary: candidate.summary ?? null,
    snippet: candidate.snippet ?? null,
    status: candidate.status ?? null,
    search_queries: candidate.search_queries,
    match_count: candidate.match_count ?? candidate.search_queries.length,
    score: candidate.score ?? null,
    fallback: candidate.fallback === true,
    passages: candidate.passages ?? null,
    passages_matched: candidate.passages_matched ?? null,
  }));
}

// #3 — non-destructive interpreter. `selected` means VALIDATED BY THE LLM INTERPRETER; a lexical
// heuristic is never a validation. When the interpreter cannot validate (LLM fallback, or LLM
// returned no usable selection), the retrieved, non-rejected candidates are returned as
// `unvalidated` — never zeroed (regression #47, where DOC-165 was retrieved but discarded). They
// are handed to synthesis as candidates to judge and surfaced for human review; they never count
// as selected sources, and #4 keeps any public reply behind a usable synthesis. `rejected`
// (interpretation rejections / negative-term conflicts) is always excluded from both.
export function applyKnowledgeInterpretation(
  candidates: MergedKnowledgeCandidate[],
  interpretation: KnowledgeResultInterpretation,
): { selected: KnowledgeSearchItem[]; unvalidated: KnowledgeSearchItem[] } {
  if (candidates.length === 0) {
    return { selected: [], unvalidated: [] };
  }
  const rejected = new Set(interpretation.rejected.map((entry) => entry.ref.toLocaleLowerCase()));
  const notRejected = candidates.filter((candidate) => {
    const ref = knowledgeDocumentRef(candidate);
    return !ref || !rejected.has(ref.toLocaleLowerCase());
  });
  // A fallback result becomes a source only when the model interpreter selects it, having read
  // its passages: it is never handed on as an unvalidated candidate.
  const unvalidated = notRejected.filter((candidate) => candidate.fallback !== true);
  if (interpretation.source === 'llm') {
    const selectedRefs = new Set(interpretation.selected_refs.map((ref) => ref.toLocaleLowerCase()));
    if (selectedRefs.size > 0) {
      const selectedItems = notRejected.filter((candidate) => {
        const ref = knowledgeDocumentRef(candidate);
        return !!ref && selectedRefs.has(ref.toLocaleLowerCase());
      });
      if (selectedItems.length > 0) {
        return { selected: selectedItems, unvalidated: [] };
      }
    }
  }
  // No LLM validation: keep the retrieved candidates as unvalidated (already score-sorted by
  // mergeKnowledgeAttempts), fallback results excepted.
  return { selected: [], unvalidated };
}

export function knowledgeRelevanceTerms(ticket: TicketLike): string[] {
  return extractKnowledgeTokens(buildKnowledgeQuery(ticket))
    .filter((token) => token.length >= 4);
}

export function knowledgeItemLexicalOverlap(item: KnowledgeSearchItem, terms: string[]): number {
  if (terms.length === 0) return 0;
  const text = stripKnowledgeAccents(normalizeKnowledgeText([
    item.title,
    item.summary,
    item.snippet,
    item.content_markdown,
  ].filter(Boolean).join(' '))).toLocaleLowerCase();
  return terms.filter((term) => text.includes(stripKnowledgeAccents(term).toLocaleLowerCase())).length;
}

export function filterKnowledgeItemsByRelevance(
  ticket: TicketLike,
  items: KnowledgeSearchItem[],
): {
  items: KnowledgeSearchItem[];
  dropped: Array<{ ref: string | null; title: string | null; score: number | null; lexical_overlap: number; reason: string }>;
} {
  if (items.length === 0) {
    return { items, dropped: [] };
  }
  const terms = knowledgeRelevanceTerms(ticket);
  if (terms.length === 0) {
    return { items, dropped: [] };
  }
  const kept: KnowledgeSearchItem[] = [];
  const dropped: Array<{ ref: string | null; title: string | null; score: number | null; lexical_overlap: number; reason: string }> = [];
  for (const item of items) {
    const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : null;
    const lexicalOverlap = knowledgeItemLexicalOverlap(item, terms);
    if ((score != null && score >= MIN_KNOWLEDGE_RELEVANCE_SCORE) || lexicalOverlap >= MIN_KNOWLEDGE_LEXICAL_OVERLAP) {
      kept.push(item);
      continue;
    }
    dropped.push({
      ref: knowledgeDocumentRef(item),
      title: item.title ?? null,
      score,
      lexical_overlap: lexicalOverlap,
      reason: 'below_relevance_threshold',
    });
  }
  return { items: kept, dropped };
}

export function plannerKnowledgeSummary(
  items: KnowledgeSearchItem[],
  lowRelevanceCount: number,
  interpretation: KnowledgeResultInterpretation,
  plan: KnowledgeSearchPlan,
  queryDerivation: KnowledgeQueryDerivation,
): NonNullable<ActionPlannerPromptInput['knowledge_summary']> {
  return {
    // count = validated (interpreter-selected) sources; unvalidated_count = retrieved-but-
    // unvalidated candidates the planner may still attempt a sourced answer on (synthesis judges).
    count: items.filter((item) => item.validation_status !== 'unvalidated').length,
    unvalidated_count: items.filter((item) => item.validation_status === 'unvalidated').length,
    low_relevance_count: lowRelevanceCount,
    items: items.slice(0, MAX_KNOWLEDGE_DOCUMENTS_FOR_REPLY).map((item) => ({
      ref: knowledgeDocumentRef(item),
      title: item.title ?? null,
      score: item.score ?? null,
      validation_status: item.validation_status ?? 'selected',
      search_queries: Array.isArray((item as MergedKnowledgeCandidate).search_queries)
        ? (item as MergedKnowledgeCandidate).search_queries.slice(0, 4)
        : [],
    })),
    interpretation: serializeKnowledgeInterpretation(interpretation),
    need: plan.need ? { ...plan.need } : null,
    query_derivation: serializeKnowledgeQueryDerivation(queryDerivation),
  };
}

/** What the action planner reads of the reply synthesis, when it ran before the planner. */
export function plannerSourcedReplySummary(
  synthesis: ReplySynthesisResult | null,
): NonNullable<ActionPlannerPromptInput['sourced_reply']> {
  if (!synthesis) {
    return { attempted: false };
  }
  return {
    attempted: true,
    usable: synthesis.usable,
    used_sources: synthesis.used_sources.map((source) => ({ ref: source.ref ?? source.url, title: source.title })),
    rejected_sources: synthesis.rejected_sources.map((source) => ({
      ref: source.ref ?? source.url,
      title: source.title,
      reason: clampText(source.reason, 240),
    })),
    confidence: synthesis.confidence,
    reply_preview: synthesis.usable ? clampText(synthesis.requester_reply, 400) || null : null,
  };
}

export function plannerWebSummary(
  items: WebSearchResultItem[],
  status: string,
  query: string | null,
): NonNullable<ActionPlannerPromptInput['web_summary']> {
  return {
    count: items.length,
    status,
    query,
    items: items.slice(0, 5).map((item) => ({
      title: item.title || item.url,
      url: item.url,
    })),
  };
}

export function buildFallbackKnowledgeInterpretation(
  plan: KnowledgeSearchPlan,
  candidates: MergedKnowledgeCandidate[],
): KnowledgeResultInterpretation {
  const negativeTerms = plan.negative_terms
    .map((term) => stripKnowledgeAccents(term).toLocaleLowerCase())
    .filter((term) => term.length >= 3);
  const positiveTerms = plan.positive_terms
    .map((term) => stripKnowledgeAccents(term).toLocaleLowerCase())
    .filter((term) => term.length >= 3);
  const scored = candidates.map((candidate, index) => {
    const text = stripKnowledgeAccents([
      candidate.title,
      candidate.summary,
      candidate.snippet,
    ].filter(Boolean).join(' ')).toLocaleLowerCase();
    const conflicts = negativeTerms.filter((term) => text.includes(term));
    const positiveHits = positiveTerms.filter((term) => text.includes(term)).length;
    const score = (positiveHits * 4) + (candidate.search_queries.length * 2) - (conflicts.length * 8) - index * 0.01;
    return { candidate, conflicts, score };
  }).sort((left, right) => right.score - left.score);
  const rejected = scored
    .filter((entry) => entry.conflicts.length > 0)
    .map((entry) => ({
      ref: knowledgeDocumentRef(entry.candidate) ?? 'unknown',
      reason: `Conflicts with requester preference: ${entry.conflicts.join(', ')}`,
    }))
    .filter((entry) => entry.ref !== 'unknown');
  const selectedRefs = scored
    .filter((entry) => entry.conflicts.length === 0)
    .slice(0, 3)
    .map((entry) => knowledgeDocumentRef(entry.candidate))
    .filter((ref): ref is string => !!ref);
  return {
    source: 'deterministic',
    selected_refs: selectedRefs,
    rejected,
    facet_match: null,
    confidence: selectedRefs.length > 0 ? 0.58 : 0.34,
    rationale: selectedRefs.length > 0
      ? 'Deterministic ranking selected candidates that matched positive search terms and avoided explicit negative terms.'
      : 'No deterministic candidate satisfied the requester constraints.',
    model: null,
    usage: null,
    estimated_tokens: 0,
    estimated_cost_eur: 0,
    latency_ms: null,
    warnings: [],
  };
}

export function serializeKnowledgeSearchPlan(plan: KnowledgeSearchPlan): Record<string, unknown> {
  return {
    source: plan.source,
    need: plan.need,
    intent: plan.intent,
    language: plan.language,
    positive_terms: plan.positive_terms,
    negative_terms: plan.negative_terms,
    queries: plan.queries,
    rationale: plan.rationale,
    confidence: plan.confidence,
    model: plan.model,
    warnings: plan.warnings,
  };
}

export function serializeKnowledgeNeedRepresentation(result: TicketNeedRepresentationBuildResult | null): Record<string, unknown> | null {
  if (!result) return null;
  return {
    source: result.source,
    model: result.model,
    usage: result.usage,
    estimated_tokens: result.estimated_tokens,
    estimated_cost_eur: result.estimated_cost_eur,
    latency_ms: result.latency_ms,
    warnings: result.warnings,
    need: result.need,
  };
}

export function serializeKnowledgeQueryDerivation(derivation: KnowledgeQueryDerivation): Record<string, unknown> {
  return {
    source: derivation.source,
    queries: derivation.queries,
    exact_queries: derivation.exact_queries,
    language_queries: derivation.language_queries,
    facet_queries: derivation.facet_queries,
    fallback_queries: derivation.fallback_queries,
    dropped_queries: derivation.dropped_queries,
    warnings: derivation.warnings,
  };
}

export function serializeTicketImageExtraction(result: TicketEvidenceExtractionResult): Record<string, unknown> {
  return {
    attachment_refs: result.attachmentRefs,
    evidence: result.evidence,
    warnings: result.warnings,
    skipped_reason: result.skippedReason,
    model: result.model,
    usage: result.usage,
    estimated_tokens: result.estimated_tokens,
    estimated_cost_eur: result.estimated_cost_eur,
    latency_ms: result.latency_ms,
  };
}

/**
 * What the reply to the requester reads of the interpretation when the agent read internal notes:
 * the documents retained or rejected and the facets, without the texts the interpreter wrote after
 * reading the ticket (its rationale, its reasons, its warnings).
 */
export function knowledgeInterpretationWithoutTexts(interpretation: KnowledgeResultInterpretation): Record<string, unknown> {
  return {
    source: interpretation.source,
    selected_refs: interpretation.selected_refs,
    rejected_refs: interpretation.rejected.map((entry) => entry.ref),
    facet_match: interpretation.facet_match ?? null,
    confidence: interpretation.confidence,
  };
}

export function serializeKnowledgeInterpretation(interpretation: KnowledgeResultInterpretation): Record<string, unknown> {
  return {
    source: interpretation.source,
    selected_refs: interpretation.selected_refs,
    rejected: interpretation.rejected,
    facet_match: interpretation.facet_match ?? null,
    confidence: interpretation.confidence,
    rationale: interpretation.rationale,
    model: interpretation.model,
    usage: interpretation.usage,
    estimated_tokens: interpretation.estimated_tokens,
    estimated_cost_eur: interpretation.estimated_cost_eur,
    latency_ms: interpretation.latency_ms,
    warnings: interpretation.warnings,
  };
}
