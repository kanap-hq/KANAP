import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AiExecutionContextWithManager } from '../../ai.types';
import {
  compileSystemPrompt,
  CompiledGuidance,
  RUNTIME_SAFETY_FLOOR_INTERPRETER,
  RUNTIME_SAFETY_FLOOR_PLANNER,
} from './ai-agent-prompt-compiler.service';
import { AiAgentLlmClient, agentCallCostEur } from './ai-agent-llm-client';
import { TicketNeedRepresentation } from './ai-ticket-need-representation.types';
import { estimateJsonTokens } from './json-token-estimate';
import { HTML_TAGS } from '../../../common/text-scan';

export type KnowledgePlannerTicket = {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
};

export type KnowledgePlannerTimelineEntry = {
  id: string;
  actor: 'requester_candidate' | 'kanap_agent' | 'support_or_unknown';
  visibility: 'public' | 'internal';
  body: string;
  createdAt: string | null;
};

export type KnowledgePlannerCandidate = {
  ref: string | null;
  title: string | null;
  summary: string | null;
  snippet: string | null;
  status: string | null;
  search_queries: string[];
  match_count?: number | null;
  score?: number | null;
};

export type KnowledgeSearchPlan = {
  source: 'llm' | 'deterministic' | 'llm_fallback';
  need: TicketNeedRepresentation | null;
  intent: string | null;
  language: string | null;
  positive_terms: string[];
  negative_terms: string[];
  queries: string[];
  rationale: string | null;
  confidence: number | null;
  model: string | null;
  warnings: string[];
};

export type KnowledgeResultInterpretation = {
  source: 'llm' | 'deterministic' | 'llm_fallback';
  selected_refs: string[];
  rejected: Array<{ ref: string; reason: string }>;
  facet_match?: {
    same_application?: boolean | null;
    same_symptom?: boolean | null;
    same_error_code?: boolean | null;
    doc_type_fit?: 'procedure' | 'reference' | 'spec' | 'recipe' | 'unknown' | null;
  } | null;
  needs_human_review: boolean;
  confidence: number | null;
  rationale: string | null;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  estimated_tokens: number;
  estimated_cost_eur: number;
  latency_ms: number | null;
  warnings: string[];
};

const MAX_PLAN_QUERIES = 10;
const MAX_QUERY_CHARS = 120;
const MAX_TERMS = 10;
const MAX_INTERPRETER_CANDIDATES = 16;
// Background stage: give reasoning models room to think before emitting JSON.
// Override per deployment via AI_AGENT_KNOWLEDGE_LLM_TIMEOUT_MS.
const DEFAULT_LLM_TIMEOUT_MS = 120_000;
// Generous output budgets so verbose / reasoning models do not truncate the JSON
// (finish_reason=length). Override per deployment via the *_MAX_TOKENS env vars.
const MAX_KNOWLEDGE_PLANNER_OUTPUT_TOKENS = 4000;
const MAX_KNOWLEDGE_INTERPRETER_OUTPUT_TOKENS = 4000;
const LEXICAL_STOPWORDS = new Set([
  'avec', 'avoir', 'besoin', 'c\'est', 'cest', 'cherche', 'chercher', 'comment', 'dans',
  'des', 'donc', 'elle', 'est', 'etes', 'etre', 'faire', 'faut', 'for', 'from', 'have',
  'how', 'les', 'looking', 'mais', 'mes', 'mon', 'need', 'not', 'pas', 'plaisir', 'plus',
  'pour', 'preference', 'recherche', 'sans', 'style', 'sur', 'the', 'une', 'vous', 'with',
]);

const SearchPlanSchema = z.object({
  intent: z.string().trim().min(1).max(280).nullable().optional(),
  language: z.string().trim().min(2).max(24).nullable().optional(),
  positive_terms: z.array(z.string().trim().min(1).max(60)).max(MAX_TERMS).optional(),
  negative_terms: z.array(z.string().trim().min(1).max(60)).max(MAX_TERMS).optional(),
  queries: z.array(z.string().trim().min(1).max(MAX_QUERY_CHARS)).min(1).max(MAX_PLAN_QUERIES),
  rationale: z.string().trim().max(360).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

const ResultInterpretationSchema = z.object({
  selected_refs: z.array(z.string().trim().min(1).max(80)).max(3),
  rejected: z.array(z.object({
    ref: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(240),
  })).max(10).optional(),
  facet_match: z.object({
    same_application: z.boolean().nullable().optional(),
    same_symptom: z.boolean().nullable().optional(),
    same_error_code: z.boolean().nullable().optional(),
    doc_type_fit: z.enum(['procedure', 'reference', 'spec', 'recipe', 'unknown']).nullable().optional(),
  }).nullable().optional(),
  needs_human_review: z.boolean().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  rationale: z.string().trim().max(420).nullable().optional(),
});

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(HTML_TAGS, ' ')
    .replace(/[’`]/g, '\'')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAccents(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function compact(value: string | null | undefined, max: number): string {
  const normalized = normalizeText(value);
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function uniqueStrings(values: Array<string | null | undefined>, max = 50): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = stripAccents(normalized).toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= max) break;
  }
  return result;
}

function boundedConfidence(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) return null;
  return Math.max(0, Math.min(1, Number(value)));
}

function extractTermsFromLatestMessage(latestRequesterMessage: string | null): {
  positiveTerms: string[];
  negativeTerms: string[];
} {
  const message = normalizeText(latestRequesterMessage);
  const normalized = stripAccents(message).toLocaleLowerCase();
  const negativeTerms: string[] = [];
  const positiveTerms: string[] = [];

  const dislikePatterns = [
    /\b(?:je\s+n[' ]?aime\s+pas|j[' ]?aime\s+pas|pas|sans|eviter|éviter|avoid|not)\s+(?:le|la|les|du|de|des|un|une|the|a|an)?\s*([\p{L}\p{N}' -]{3,50})/giu,
  ];
  for (const pattern of dislikePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(message)) != null) {
      const term = normalizeText(match[1])
        .replace(/[.!?;:,].*$/g, '')
        .trim();
      if (term) negativeTerms.push(term);
    }
  }

  const lexicalTokens = (message.match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? [])
    .filter((token) => !LEXICAL_STOPWORDS.has(stripAccents(token).toLocaleLowerCase()));
  positiveTerms.push(...lexicalTokens.slice(0, MAX_TERMS * 2));
  if (/\b(autre|alternative|plutot|plutôt|instead|another)\b/.test(normalized)) {
    positiveTerms.push('alternative');
  }

  return {
    positiveTerms: uniqueStrings(positiveTerms, MAX_TERMS),
    negativeTerms: uniqueStrings(negativeTerms, MAX_TERMS),
  };
}

function latestRequesterMessage(timeline: KnowledgePlannerTimelineEntry[]): string | null {
  for (let index = timeline.length - 1; index >= 0; index--) {
    const entry = timeline[index];
    if (entry.actor === 'requester_candidate' && entry.body.trim()) {
      return entry.body;
    }
  }
  return null;
}

function previousAgentAnswer(timeline: KnowledgePlannerTimelineEntry[]): string | null {
  for (let index = timeline.length - 1; index >= 0; index--) {
    const entry = timeline[index];
    if (entry.actor === 'kanap_agent' && entry.body.trim()) {
      return entry.body;
    }
  }
  return null;
}

function deterministicBaseQueries(input: {
  ticket: KnowledgePlannerTicket;
  timeline: KnowledgePlannerTimelineEntry[];
  positiveTerms: string[];
  negativeTerms: string[];
}): string[] {
  const latest = latestRequesterMessage(input.timeline);
  const title = normalizeText(input.ticket.title);
  const description = normalizeText(input.ticket.description);
  const normalizedLatest = stripAccents(latest ?? '').toLocaleLowerCase();
  const normalizedAll = stripAccents([title, description, latest].join(' ')).toLocaleLowerCase();
  const queries: string[] = [];

  for (const term of input.positiveTerms) {
    queries.push(term, stripAccents(term));
  }

  const tokens = uniqueStrings((normalizedAll.match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [])
    .filter((token) => !LEXICAL_STOPWORDS.has(token)), 12);
  if (tokens.length > 0) {
    queries.push(tokens.slice(0, 4).join(' '), tokens.slice(0, 6).join(' '));
  }
  if (normalizedLatest) {
    const latestTokens = uniqueStrings((normalizedLatest.match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [])
      .filter((token) => !LEXICAL_STOPWORDS.has(token)), 8);
    if (latestTokens.length > 0) {
      queries.push(latestTokens.slice(0, 5).join(' '));
    }
  }

  queries.push(title);

  return uniqueStrings(queries, MAX_PLAN_QUERIES);
}

function normalizeQueries(values: string[]): string[] {
  const expanded: string[] = [];
  for (const value of values) {
    const query = compact(value, MAX_QUERY_CHARS)
      .replace(/^["'([{]+/g, '')
      .replace(/["')}\].,:;!?]+$/g, '')
      .trim();
    if (!query) continue;
    expanded.push(query);
    const stripped = stripAccents(query);
    if (stripped !== query) expanded.push(stripped);
  }
  return uniqueStrings(expanded, MAX_PLAN_QUERIES);
}

function candidateRef(candidate: KnowledgePlannerCandidate): string | null {
  return candidate.ref?.trim() || null;
}

function candidateScoreSortValue(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : Number.NEGATIVE_INFINITY;
}

function sortPlannerCandidates(candidates: KnowledgePlannerCandidate[]): KnowledgePlannerCandidate[] {
  return [...candidates].sort((left, right) => {
    const scoreDelta = candidateScoreSortValue(right.score) - candidateScoreSortValue(left.score);
    if (scoreDelta !== 0) return scoreDelta;
    const matchDelta = (right.match_count ?? right.search_queries.length) - (left.match_count ?? left.search_queries.length);
    if (matchDelta !== 0) return matchDelta;
    return String(left.title ?? left.ref ?? '').localeCompare(String(right.title ?? right.ref ?? ''));
  });
}

function normalizedCandidateText(candidate: KnowledgePlannerCandidate): string {
  return stripAccents([
    candidate.title,
    candidate.summary,
    candidate.snippet,
  ].filter(Boolean).join(' ')).toLocaleLowerCase();
}

function normalizedSearchText(value: string | null | undefined): string {
  return stripAccents(normalizeText(value)).toLocaleLowerCase();
}

function requestNeedText(input: {
  ticket: KnowledgePlannerTicket;
  timeline: KnowledgePlannerTimelineEntry[];
}): string {
  return normalizedSearchText([
    input.ticket.title,
    input.ticket.description,
    latestRequesterMessage(input.timeline),
  ].filter(Boolean).join(' '));
}

function lexicalVariantsForPositiveTerm(term: string): string[] {
  const normalized = normalizedSearchText(term);
  return uniqueStrings([
    normalized,
    normalized.replace(/s$/i, ''),
  ], 4).map(normalizedSearchText).filter((value) => value.length >= 3);
}

function termMatchesText(term: string, text: string): boolean {
  return lexicalVariantsForPositiveTerm(term).some((variant) => text.includes(variant));
}

function trustedPositiveTerms(input: {
  plan: KnowledgeSearchPlan;
  ticket: KnowledgePlannerTicket;
  timeline: KnowledgePlannerTimelineEntry[];
}): string[] {
  const needText = requestNeedText(input);
  const extracted = extractTermsFromLatestMessage(needText).positiveTerms;
  const planTermsInRequest = input.plan.positive_terms.filter((term) => termMatchesText(term, needText));
  const trusted = uniqueStrings([...extracted, ...planTermsInRequest], MAX_TERMS);
  return trusted.length > 0 ? trusted : input.plan.positive_terms;
}

function positiveTermHitCount(text: string, terms: string[]): number {
  return terms.filter((term) => termMatchesText(term, text)).length;
}

function positiveQueryHitCount(candidate: KnowledgePlannerCandidate, terms: string[]): number {
  const queryText = normalizedSearchText(candidate.search_queries.join(' '));
  return positiveTermHitCount(queryText, terms);
}

function exactLikePositiveHitCount(text: string, terms: string[]): number {
  return terms.filter((term) => /[0-9]/.test(term) && termMatchesText(term, text)).length;
}

function candidateLexicalScoreBoost(candidate: KnowledgePlannerCandidate): number {
  const score = candidateScoreSortValue(candidate.score);
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(Math.log1p(score), 4);
}

@Injectable()
export class AiKnowledgeSearchPlannerService {
  private readonly logger = new Logger(AiKnowledgeSearchPlannerService.name);

  constructor(
    private readonly llmClient: AiAgentLlmClient,
  ) {}

  async planKnowledgeSearch(
    context: AiExecutionContextWithManager,
    input: {
      ticket: KnowledgePlannerTicket;
      timeline: KnowledgePlannerTimelineEntry[];
      profile?: CompiledGuidance | null;
    },
  ): Promise<KnowledgeSearchPlan> {
    const fallback = this.buildDeterministicPlan(input);
    if (process.env.AI_AGENT_KNOWLEDGE_LLM_PLANNER === '0') {
      return fallback;
    }

    try {
      const result = await this.llmClient.callStructuredJsonModel(context, {
        taskName: 'knowledge_search_plan',
        systemPrompt: compileSystemPrompt(RUNTIME_SAFETY_FLOOR_PLANNER, input.profile),
        userPayload: {
          task: 'Generate a knowledge search plan.',
          rules: [
            'Retrieve knowledge that directly answers the requester need.',
            'Do not generate policy, off-topic handling, or helpdesk procedure queries unless the requester explicitly asks for those.',
            'Prefer short keyword queries over full natural-language sentences.',
          ],
          schema: {
            intent: 'short natural-language interpretation of the current requester need',
            language: 'ticket language such as fr or en',
            positive_terms: ['concepts to search for'],
            negative_terms: ['concepts explicitly refused or to avoid'],
            queries: ['1-8 short search strings, ordered from most specific to fallback'],
            rationale: 'one short audit sentence, no hidden reasoning',
            confidence: '0..1',
          },
          ticket: {
            id: input.ticket.id,
            title: input.ticket.title,
            description: compact(input.ticket.description, 800),
            status: input.ticket.status ?? null,
            priority: input.ticket.priority ?? null,
          },
          latest_requester_message: compact(latestRequesterMessage(input.timeline), 900),
          previous_agent_answer: compact(previousAgentAnswer(input.timeline), 900),
          recent_timeline: input.timeline.slice(-8).map((entry) => ({
            actor: entry.actor,
            visibility: entry.visibility,
            created_at: entry.createdAt,
            body: compact(entry.body, 420),
          })),
        },
        maxTokens: MAX_KNOWLEDGE_PLANNER_OUTPUT_TOKENS,
        maxTokensEnvName: 'AI_AGENT_KNOWLEDGE_PLANNER_MAX_TOKENS',
        timeoutEnvName: 'AI_AGENT_KNOWLEDGE_LLM_TIMEOUT_MS',
        defaultTimeoutMs: DEFAULT_LLM_TIMEOUT_MS,
        schema: SearchPlanSchema,
      });
      if (!result) return fallback;
      if (!result.ok) {
        const message = result.metadata.failure?.message ?? 'invalid structured JSON';
        this.logger.warn(`Knowledge search LLM planner fallback: ${message}`);
        return {
          ...fallback,
          source: 'llm_fallback',
          warnings: [...fallback.warnings, `LLM planner JSON invalid: ${message.slice(0, 220)}`],
        };
      }
      const parsed = result.value;
      const queries = normalizeQueries([
        ...(parsed.queries ?? []).slice(0, 5),
        ...fallback.queries,
      ]);
      if (queries.length === 0) return fallback;
      return {
        source: 'llm',
        need: fallback.need,
        intent: parsed.intent ?? fallback.intent,
        language: parsed.language ?? fallback.language,
        positive_terms: uniqueStrings([...(parsed.positive_terms ?? []), ...fallback.positive_terms], MAX_TERMS),
        negative_terms: uniqueStrings([...(parsed.negative_terms ?? []), ...fallback.negative_terms], MAX_TERMS),
        queries,
        rationale: parsed.rationale ?? null,
        confidence: boundedConfidence(parsed.confidence),
        model: `${result.runtime.providerId}:${result.runtime.model}`,
        warnings: result.metadata.retry_attempted
          ? [...fallback.warnings, 'LLM planner JSON was repaired after one retry.']
          : fallback.warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'LLM planning failed.');
      this.logger.warn(`Knowledge search LLM planner fallback: ${message}`);
      return {
        ...fallback,
        source: 'llm_fallback',
        warnings: [...fallback.warnings, `LLM planner unavailable: ${message.slice(0, 220)}`],
      };
    }
  }

  async interpretKnowledgeResults(
    context: AiExecutionContextWithManager,
    input: {
      plan: KnowledgeSearchPlan;
      ticket: KnowledgePlannerTicket;
      timeline: KnowledgePlannerTimelineEntry[];
      candidates: KnowledgePlannerCandidate[];
      profile?: CompiledGuidance | null;
    },
  ): Promise<KnowledgeResultInterpretation> {
    const fallback = this.buildDeterministicInterpretation(input);
    if (input.candidates.length === 0 || process.env.AI_AGENT_KNOWLEDGE_LLM_PLANNER === '0') {
      return fallback;
    }
    const rankedCandidates = sortPlannerCandidates(input.candidates);
    const userPayload = {
      task: 'Select relevant knowledge documents from retrieved candidates.',
      schema: {
        selected_refs: ['document refs to use, max 3'],
        rejected: [{ ref: 'document ref', reason: 'short audit reason' }],
        facet_match: {
          same_application: 'true when selected docs match the requested app/module',
          same_symptom: 'true when selected docs match the requested symptom/outcome',
          same_error_code: 'true when selected docs match an exact requested code/ref',
          doc_type_fit: 'procedure | reference | spec | recipe | unknown',
        },
        needs_human_review: 'true when no reliable candidate exists or confidence is low',
        confidence: '0..1',
        rationale: 'one short audit sentence, no hidden reasoning',
      },
      search_plan: {
        intent: input.plan.intent,
        positive_terms: input.plan.positive_terms,
        negative_terms: input.plan.negative_terms,
        queries: input.plan.queries,
        need: input.plan.need,
      },
      ticket: {
        title: input.ticket.title,
        description: compact(input.ticket.description, 500),
        latest_requester_message: compact(latestRequesterMessage(input.timeline), 700),
        previous_agent_answer: compact(previousAgentAnswer(input.timeline), 700),
      },
      candidates: rankedCandidates.slice(0, MAX_INTERPRETER_CANDIDATES).map((candidate) => ({
        ref: candidate.ref,
        title: candidate.title,
        summary: compact(candidate.summary, 280),
        snippet: compact(candidate.snippet, 280),
        status: candidate.status,
        search_queries: candidate.search_queries.slice(0, 4),
        match_count: candidate.match_count ?? candidate.search_queries.length,
        score: candidate.score ?? null,
      })),
      ranking_notes: [
        '`score` is the lexical relevance rank; treat it as a strong signal, but judge final relevance from the content.',
        '`match_count` is the number of generated/planned queries that retrieved the document.',
        'Exact-code, same-application, and same-symptom facet matches are strong validation signals.',
        'Reject documents whose type conflicts with the requester need instead of selecting a generic high-score candidate.',
      ],
    };

    try {
      const result = await this.llmClient.callStructuredJsonModel(context, {
        taskName: 'knowledge_result_interpretation',
        systemPrompt: compileSystemPrompt(RUNTIME_SAFETY_FLOOR_INTERPRETER, input.profile),
        userPayload,
        maxTokens: MAX_KNOWLEDGE_INTERPRETER_OUTPUT_TOKENS,
        maxTokensEnvName: 'AI_AGENT_KNOWLEDGE_INTERPRETER_MAX_TOKENS',
        timeoutEnvName: 'AI_AGENT_KNOWLEDGE_LLM_TIMEOUT_MS',
        defaultTimeoutMs: DEFAULT_LLM_TIMEOUT_MS,
        schema: ResultInterpretationSchema,
      });
      if (!result) return fallback;
      const actualInputTokens = result.usage ? result.usage.input_tokens : estimateJsonTokens(userPayload);
      const actualOutputTokens = result.usage ? result.usage.output_tokens : estimateJsonTokens(result.text ?? '');
      const usageFields = {
        model: result.runtime ? `${result.runtime.providerId}:${result.runtime.model}` : null,
        usage: result.usage,
        estimated_tokens: actualInputTokens + actualOutputTokens,
        estimated_cost_eur: agentCallCostEur(actualInputTokens, actualOutputTokens, result.runtime, result.usage),
        latency_ms: result.latencyMs,
      };
      if (!result.ok) {
        const message = result.metadata.failure?.message ?? 'invalid structured JSON';
        this.logger.warn(`Knowledge result LLM interpreter fallback: ${message}`);
        return {
          ...fallback,
          source: 'llm_fallback',
          ...usageFields,
          warnings: [...fallback.warnings, `LLM interpreter JSON invalid: ${message.slice(0, 220)}`],
        };
      }
      const parsed = result.value;
      const knownRefs = new Set(input.candidates.map(candidateRef).filter((ref): ref is string => !!ref));
      const selectedRefs = uniqueStrings(parsed.selected_refs, 3).filter((ref) => knownRefs.has(ref));
      const rejected = (parsed.rejected ?? [])
        .filter((entry) => knownRefs.has(entry.ref))
        .map((entry) => ({ ref: entry.ref, reason: entry.reason }));
      return {
        source: 'llm',
        selected_refs: selectedRefs,
        rejected,
        facet_match: parsed.facet_match ?? null,
        needs_human_review: parsed.needs_human_review ?? selectedRefs.length === 0,
        confidence: boundedConfidence(parsed.confidence),
        rationale: parsed.rationale ?? null,
        ...usageFields,
        warnings: result.metadata.retry_attempted
          ? [...fallback.warnings, 'LLM interpreter JSON was repaired after one retry.']
          : fallback.warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'LLM interpretation failed.');
      this.logger.warn(`Knowledge result LLM interpreter fallback: ${message}`);
      return {
        ...fallback,
        source: 'llm_fallback',
        warnings: [...fallback.warnings, `LLM interpreter unavailable: ${message.slice(0, 220)}`],
      };
    }
  }

  private buildDeterministicPlan(input: {
    ticket: KnowledgePlannerTicket;
    timeline: KnowledgePlannerTimelineEntry[];
  }): KnowledgeSearchPlan {
    const latest = latestRequesterMessage(input.timeline);
    const extracted = extractTermsFromLatestMessage([
      input.ticket.title,
      input.ticket.description,
      latest,
    ].filter(Boolean).join(' '));
    const queries = normalizeQueries(deterministicBaseQueries({
      ticket: input.ticket,
      timeline: input.timeline,
      positiveTerms: extracted.positiveTerms,
      negativeTerms: extracted.negativeTerms,
    }));
    return {
      source: 'deterministic',
      need: null,
      intent: latest ? compact(latest, 240) : compact(input.ticket.title, 180),
      language: /[àâçéèêëîïôûùüÿœ]/i.test([input.ticket.title, input.ticket.description, latest].join(' ')) ? 'fr' : null,
      positive_terms: extracted.positiveTerms,
      negative_terms: extracted.negativeTerms,
      queries: queries.length > 0 ? queries : normalizeQueries([input.ticket.title, input.ticket.description ?? '']),
      rationale: 'Deterministic fallback extracted requester intent and short keyword searches.',
      confidence: null,
      model: null,
      warnings: [],
    };
  }

  private buildDeterministicInterpretation(input: {
    plan: KnowledgeSearchPlan;
    ticket: KnowledgePlannerTicket;
    timeline: KnowledgePlannerTimelineEntry[];
    candidates: KnowledgePlannerCandidate[];
  }): KnowledgeResultInterpretation {
    const positiveTerms = trustedPositiveTerms(input);
    const negativeTerms = input.plan.negative_terms
      .map((term) => stripAccents(term).toLocaleLowerCase())
      .filter((term) => term.length >= 3);
    const scored = input.candidates.map((candidate, index) => {
      const text = normalizedCandidateText(candidate);
      const conflicts = negativeTerms.filter((term) => text.includes(term));
      const queryHits = positiveQueryHitCount(candidate, positiveTerms);
      const matchCount = candidate.match_count ?? candidate.search_queries.length;
      const title = stripAccents(candidate.title ?? '').toLocaleLowerCase();
      const positiveHits = positiveTermHitCount(text, positiveTerms);
      const exactLikeHits = exactLikePositiveHitCount(text, positiveTerms);
      const score = (positiveHits * 6)
        + (queryHits * 1.1)
        + candidateLexicalScoreBoost(candidate)
        + (Math.min(matchCount, 3) * 0.4)
        + (title ? 0.5 : 0)
        - (conflicts.length * 8)
        - index * 0.01;
      return { candidate, score, conflicts, positiveHits, exactLikeHits };
    }).sort((left, right) => right.score - left.score);

    const rejected = scored
      .filter((entry) => entry.conflicts.length > 0)
      .map((entry) => ({
        ref: candidateRef(entry.candidate) ?? 'unknown',
        reason: `Conflicts with requester preference: ${entry.conflicts.join(', ')}`,
      }))
      .filter((entry) => entry.ref !== 'unknown');
    const selectedEntries = scored
      .filter((entry) => {
        const requiredPositiveHits = Math.min(2, Math.max(1, positiveTerms.length));
        return entry.conflicts.length === 0
          && entry.score >= 2
          && (entry.positiveHits >= requiredPositiveHits || entry.exactLikeHits > 0);
      })
      .slice(0, 3);
    const selected = selectedEntries
      .map((entry) => candidateRef(entry.candidate))
      .filter((ref): ref is string => !!ref);
    const weakBestCandidate = selected.length === 0 && scored.length > 0;

    return {
      source: 'deterministic',
      selected_refs: selected,
      rejected,
      facet_match: null,
      needs_human_review: selected.length === 0 || selectedEntries.some((entry) => entry.score < 4),
      confidence: selected.length > 0 ? 0.58 : 0.34,
      rationale: selected.length > 0
        ? 'Deterministic ranking selected candidates that matched positive search terms and avoided explicit negative terms.'
        : weakBestCandidate
          ? 'Deterministic fallback found no candidate with enough lexical evidence for the requester need.'
          : 'No deterministic candidate satisfied the requester constraints.',
      model: null,
      usage: null,
      estimated_tokens: 0,
      estimated_cost_eur: 0,
      latency_ms: null,
      warnings: weakBestCandidate ? ['Deterministic fallback withheld weak lexical candidates for human review.'] : [],
    };
  }

}
