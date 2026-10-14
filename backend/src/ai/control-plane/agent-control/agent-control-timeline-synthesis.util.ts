import { decodeHtmlEntities, decodeNumericHtmlEntities, HTML_TEXT_ENTITIES } from '../../../common/html-entities';
import { isRecord } from '../../../common/object-guards';
import { TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY, TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY } from '../capability/capability-contract';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { MAX_INTERNAL_NOTE_CHARS, MAX_PUBLIC_REPLY_CHARS } from '../providers/ticket-safety';
import { ticketLooksFrench } from './agent-control-knowledge.util';
import { adapterData, clampText } from './agent-control-util';
import type { ConversationActionGate, KnowledgeSearchItem, TicketLike, TicketNoteLike, TicketTimelineEntry, WebSearchResultItem } from './ai-agent-control.service';
import { ReplySynthesisRejectedSource, ReplySynthesisResult, ReplySynthesisSource } from './ai-reply-synthesis.service';

/**
 * Ticket timeline assembly and reply synthesis: turning notes and actions into a timeline,
 * deciding whether a conversation allows a reply, and rendering the requester reply, the
 * internal triage note and the status-update proposal.
 *
 * Timeline and synthesis live in one module because they call each other in both
 * directions; splitting them would only trade a file boundary for an import cycle.
 *
 * Extracted verbatim from the module-level header of ai-agent-control.service.ts.
 */

export const MAX_INTERNAL_SYNTHESIS_BRIEF_CHARS = 1000;
export const MAX_INTERNAL_RECOMMENDED_REPLY_CHARS = 900;
export const MAX_SYNTHESIS_NOTE_SOURCES = 6;
export const MAX_SYNTHESIS_NOTE_REJECTIONS = 6;

export const MAX_SYNTHESIZED_REQUESTER_BODY_CHARS = 10500;

export function actionRequestIdsFromCapabilityOutput(value: unknown): string[] {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) {
    return [];
  }
  const ids = new Set<string>();
  const direct = value.data.action_request_id;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    ids.add(direct.trim());
  }
  const nested = value.data.actionRequest;
  if (isRecord(nested) && typeof nested.id === 'string' && nested.id.trim().length > 0) {
    ids.add(nested.id.trim());
  }
  return Array.from(ids);
}

export function ticketNotesFromOutput(value: unknown): TicketNoteLike[] {
  const data = adapterData<{ notes?: unknown[] }>(value);
  const notes = Array.isArray(data?.notes) ? data.notes : [];
  return notes
    .filter(isRecord)
    .map((note): TicketNoteLike => {
      const visibility: TicketNoteLike['visibility'] = note.visibility === 'internal' ? 'internal' : 'public';
      return {
        id: typeof note.id === 'string' ? note.id : String(note.id ?? ''),
        visibility,
        authorId: typeof note.authorId === 'string' ? note.authorId : null,
        author: typeof note.author === 'string' ? note.author : null,
        authorRole: note.authorRole === 'requester' || note.authorRole === 'support' || note.authorRole === 'kanap_agent'
          ? note.authorRole
          : 'unknown',
        body: typeof note.body === 'string' ? note.body : '',
        createdAt: typeof note.createdAt === 'string' ? note.createdAt : '',
        updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : null,
        updateFingerprint: typeof note.updateFingerprint === 'string' ? note.updateFingerprint : null,
      };
    })
    .filter((note) => note.id.length > 0);
}

export function parseTime(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function isoFromTime(value: number | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}

export function actionPayloadBody(action: AiActionRequest): string | null {
  const payload = isRecord(action.action_payload_json) ? action.action_payload_json : null;
  const body = payload?.body ?? payload?.note_body ?? payload?.reply_body;
  return typeof body === 'string' && body.trim().length > 0 ? normalizeKnowledgeReplyText(body) : null;
}

export function actionPayloadVisibility(action: AiActionRequest): 'internal' | 'public' | null {
  const payload = isRecord(action.action_payload_json) ? action.action_payload_json : null;
  const visibility = payload?.visibility;
  if (visibility === 'internal' || visibility === 'public') {
    return visibility;
  }
  if (action.capability_name === TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY) {
    return 'internal';
  }
  if (action.capability_name === TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY) {
    return 'public';
  }
  return null;
}

export function actionProviderResultNoteId(action: AiActionRequest): string | null {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  const providerResult = isRecord(metadata?.provider_result) ? metadata.provider_result : null;
  const noteId = providerResult?.note_id ?? providerResult?.id;
  if (typeof noteId === 'string' && noteId.trim().length > 0) {
    return noteId.trim();
  }
  if (typeof noteId === 'number' && Number.isFinite(noteId)) {
    return String(noteId);
  }
  return null;
}

export function actionExecutedTime(action: AiActionRequest): number | null {
  return parseTime(action.executed_at) ?? parseTime(action.updated_at);
}

export function normalizeTimelineBody(value: string | null | undefined): string {
  return normalizeKnowledgeReplyText(value).replace(/\s+/g, ' ').trim();
}

export function ticketNoteTime(note: TicketNoteLike): number | null {
  return parseTime(note.updatedAt) ?? parseTime(note.createdAt);
}

export function ticketNoteFingerprint(note: TicketNoteLike): string {
  if (note.updateFingerprint && note.updateFingerprint.trim().length > 0) {
    return note.updateFingerprint.trim();
  }
  return JSON.stringify({
    id: note.id,
    visibility: note.visibility,
    author_id: note.authorId ?? null,
    author_role: note.authorRole ?? 'unknown',
    created_at: note.createdAt || null,
    updated_at: note.updatedAt ?? null,
    body: normalizeTimelineBody(note.body),
  });
}

export function latestTicketNote(notes: TicketNoteLike[]): TicketNoteLike | null {
  return [...notes]
    .sort((left, right) => {
      const rightTime = ticketNoteTime(right) ?? 0;
      const leftTime = ticketNoteTime(left) ?? 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return String(right.id).localeCompare(String(left.id));
    })[0] ?? null;
}

export function resolveActionProviderNote(action: AiActionRequest, notes: TicketNoteLike[]): TicketNoteLike | null {
  const providerNoteId = actionProviderResultNoteId(action);
  if (providerNoteId) {
    const exact = notes.find((note) => String(note.id) === providerNoteId);
    if (exact) {
      return exact;
    }
  }

  const visibility = actionPayloadVisibility(action);
  const body = actionPayloadBody(action);
  if (!visibility || !body) {
    return null;
  }
  const normalizedBody = normalizeTimelineBody(body);
  return notes
    .filter((note) => note.visibility === visibility && normalizeTimelineBody(note.body) === normalizedBody)
    .sort((left, right) => (ticketNoteTime(right) ?? 0) - (ticketNoteTime(left) ?? 0))[0] ?? null;
}

export function actionConversationTime(action: AiActionRequest, notes: TicketNoteLike[]): number | null {
  const providerNote = resolveActionProviderNote(action, notes);
  return providerNote ? ticketNoteTime(providerNote) : actionExecutedTime(action);
}

export function actionConversationTimeOrNull(action: AiActionRequest | null, notes: TicketNoteLike[]): number | null {
  return action ? actionConversationTime(action, notes) : null;
}

export function latestExecutedAction(actions: AiActionRequest[], capabilityName: string, notes: TicketNoteLike[]): AiActionRequest | null {
  return actions
    .filter((action) => action.capability_name === capabilityName && action.status === 'executed')
    .sort((left, right) => (actionConversationTime(right, notes) ?? 0) - (actionConversationTime(left, notes) ?? 0))[0] ?? null;
}

export function isKanapMarkedBody(value: string): boolean {
  const normalized = normalizeTimelineBody(value).toLocaleLowerCase();
  return normalized.includes('[kanap triage proposal]')
    || normalized.includes('this note was prepared by kanap')
    || normalized.includes('prepared by the agent control center');
}

export function buildTicketTimeline(
  ticket: TicketLike,
  notes: TicketNoteLike[],
  kanapPublicBodies: Set<string>,
): TicketTimelineEntry[] {
  const entries: TicketTimelineEntry[] = [];
  const description = normalizeKnowledgeReplyText(ticket.description);
  if (description) {
    entries.push({
      id: `ticket:${ticket.id}:description`,
      kind: 'description',
      visibility: 'public',
      actor: 'requester_candidate',
      actorSource: 'initial_ticket',
      actorId: null,
      body: description,
      createdAt: null,
      updatedAt: null,
      updateFingerprint: null,
    });
  }

  for (const note of notes) {
    const body = normalizeKnowledgeReplyText(note.body);
    const normalizedBody = normalizeTimelineBody(body);
    const markedKanap = kanapPublicBodies.has(normalizedBody) || isKanapMarkedBody(body) || note.authorRole === 'kanap_agent';
    const actor = markedKanap
      ? 'kanap_agent'
      : note.authorRole === 'requester'
        ? 'requester_candidate'
        : note.visibility === 'internal' || note.authorRole === 'support'
          ? 'support_or_unknown'
          : 'requester_candidate';
    const actorSource: TicketTimelineEntry['actorSource'] = markedKanap
      ? 'kanap_marker'
      : note.authorRole === 'requester'
        ? 'provider_requester_user'
        : note.visibility === 'internal' || note.authorRole === 'support'
          ? 'provider_support_user'
          : 'public_non_kanap_followup';
    const createdTime = parseTime(note.createdAt);
    const updatedTime = ticketNoteTime(note);
    entries.push({
      id: `followup:${note.id}`,
      kind: 'followup',
      visibility: note.visibility,
      actor,
      actorSource,
      actorId: note.authorId ?? null,
      body,
      createdAt: createdTime == null ? null : new Date(createdTime).toISOString(),
      updatedAt: updatedTime == null ? null : new Date(updatedTime).toISOString(),
      updateFingerprint: ticketNoteFingerprint(note),
    });
  }

  return entries.sort((left, right) => {
    const leftTime = parseTime(left.createdAt) ?? 0;
    const rightTime = parseTime(right.createdAt) ?? 0;
    return leftTime - rightTime;
  });
}

export function evaluateConversationGate(
  actions: AiActionRequest[],
  timeline: TicketTimelineEntry[],
  notes: TicketNoteLike[],
): ConversationActionGate {
  const lastInternal = latestExecutedAction(actions, TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY, notes);
  const lastPublic = latestExecutedAction(actions, TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY, notes);
  const latestNote = latestTicketNote(notes);
  const preparedAt = new Date().toISOString();
  const requesterSignals = timeline
    .filter((entry) => entry.actor === 'requester_candidate')
    .map((entry) => ({ entry, time: parseTime(entry.createdAt) }))
    .filter((signal): signal is { entry: TicketTimelineEntry; time: number } => signal.time != null)
    .sort((left, right) => right.time - left.time);
  const latestRequester = requesterSignals[0] ?? null;

  const decide = (lastAction: AiActionRequest | null, initialReason: string): { allowed: boolean; reason: string } => {
    if (!lastAction) {
      return { allowed: true, reason: initialReason };
    }
    const lastActionTime = actionConversationTime(lastAction, notes);
    if (!latestRequester || lastActionTime == null || latestRequester.time <= lastActionTime) {
      return { allowed: false, reason: 'waiting_for_new_requester_message' };
    }
    return { allowed: true, reason: 'new_requester_message_after_last_agent_action' };
  };

  const internalDecision = decide(lastInternal, 'no_prior_agent_internal_note');
  const publicDecision = decide(lastPublic, 'no_prior_agent_public_reply');
  return {
    can_prepare_internal_note: internalDecision.allowed,
    can_prepare_public_reply: publicDecision.allowed,
    can_prepare_sourced_answer: publicDecision.allowed,
    can_prepare_administrative_close_reply: true,
    internal_note_reason: internalDecision.reason,
    public_reply_reason: publicDecision.reason,
    sourced_answer_reason: publicDecision.reason,
    administrative_close_reply_reason: 'administrative_close_reply_dedup_guarded',
    latest_requester_message_at: isoFromTime(latestRequester?.time ?? null),
    latest_requester_message_id: latestRequester?.entry.id ?? null,
    last_agent_internal_note_at: isoFromTime(actionConversationTimeOrNull(lastInternal, notes)),
    last_agent_internal_note_action_id: lastInternal?.id ?? null,
    last_agent_public_reply_at: isoFromTime(actionConversationTimeOrNull(lastPublic, notes)),
    last_agent_public_reply_action_id: lastPublic?.id ?? null,
    requester_classification_confidence: latestRequester
      ? latestRequester.entry.actorSource === 'provider_requester_user' ? 'provider_requester_user' : 'public_non_kanap_followup'
      : (lastInternal || lastPublic) ? 'none' : 'initial_ticket',
    ticket_history_entry_count: notes.length,
    latest_ticket_note_id: latestNote?.id ?? null,
    latest_ticket_note_at: isoFromTime(latestNote ? ticketNoteTime(latestNote) : null),
    latest_ticket_note_fingerprint: latestNote ? ticketNoteFingerprint(latestNote) : null,
    latest_requester_message_fingerprint: latestRequester?.entry.updateFingerprint ?? null,
    prepared_at: preparedAt,
  };
}

export function timelineSummaryLines(timeline: TicketTimelineEntry[]): string[] {
  if (timeline.length === 0) {
    return ['- No ticket history entries were available.'];
  }
  return timeline.slice(-8).map((entry) => {
    const at = entry.createdAt ? entry.createdAt.slice(0, 19).replace('T', ' ') : 'initial ticket';
    const actor = entry.actor === 'kanap_agent'
      ? 'KANAP agent'
      : entry.actor === 'requester_candidate'
        ? 'requester/public user'
        : 'support/internal';
    return `- ${at} / ${actor} / ${entry.visibility}: ${clampText(entry.body, 220)}`;
  });
}

export function buildTriageNote(
  ticket: TicketLike,
  knowledgeItems: KnowledgeSearchItem[],
  timeline: TicketTimelineEntry[],
  webResults: WebSearchResultItem[] = [],
  // When the planner deliberately handled the ticket itself — an internal escalation (no
  // requester reply prepared) or a planner-authored administrative reply — the note states the
  // agent's rationale. The "synthesis unavailable, complete manually" boilerplate is only honest
  // when a knowledge-sourced answer was actually expected and failed. An escalation does not
  // present the (insufficient) candidate sources as "found"; an administrative reply keeps them
  // as context but labels them as unused.
  plannerOutcome: { kind: 'escalation' | 'administrative_reply'; reason: string | null } | null = null,
): string {
  const technicianBrief = plannerOutcome
    ? (plannerOutcome.reason?.trim()
      || (plannerOutcome.kind === 'administrative_reply'
        ? 'The agent answered with an administrative reply (see the proposed requester reply on this ticket); no knowledge-sourced answer was required.'
        : 'The agent escalated this ticket internally; no requester reply was prepared.'))
    : 'AI reply synthesis was unavailable or skipped. Review the possible sources above and complete the requester answer manually before approving.';
  return renderProviderBody([
    '[KANAP triage proposal]',
    `Ticket #${ticket.id} - ${ticket.title}`,
    ticket.status ? `Status: ${ticket.status}` : null,
    ticket.priority ? `Priority: ${ticket.priority}` : null,
    '',
    'Ticket history considered:',
    ...timelineSummaryLines(timeline),
    '',
    ...(plannerOutcome?.kind === 'escalation'
      ? []
      : [
        plannerOutcome?.kind === 'administrative_reply'
          ? 'Candidate sources reviewed (not used by the administrative reply; no article body copied):'
          : 'Possible sources found (fallback mode; no article body copied):',
        ...fallbackSourceLines(knowledgeItems, webResults, 8),
        '',
      ]),
    'Technician brief:',
    technicianBrief,
    '',
    'No external change has been made. This note was prepared by KANAP and requires human approval before posting.',
  ], MAX_INTERNAL_NOTE_CHARS);
}


export function configuredReplyLanguage(definition: AiAgentDefinition | null): string | null {
  const persona = isRecord(definition?.persona_json) ? definition.persona_json : {};
  const outputStyle = isRecord(persona.output_style) ? persona.output_style : {};
  const language = typeof outputStyle.language === 'string' ? outputStyle.language.trim().toLowerCase() : '';
  return ['fr', 'en', 'de', 'es'].includes(language) ? language : null;
}

export function resolveReplyLanguage(
  definition: AiAgentDefinition | null,
  ticket: TicketLike,
  knowledgeLanguage: string | null | undefined,
): string {
  return configuredReplyLanguage(definition)
    ?? knowledgeLanguage
    ?? (ticketLooksFrench(ticket) ? 'fr' : 'en');
}

// Angle brackets from the source become square brackets in reply text.
const KNOWLEDGE_REPLY_TEXT_ENTITIES = { ...HTML_TEXT_ENTITIES, lt: '[', gt: ']' };

export function normalizeKnowledgeReplyText(value: string | null | undefined): string {
  return decodeHtmlEntities(
    decodeNumericHtmlEntities(String(value ?? '').replace(/\r\n/g, '\n'))
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
    { entities: KNOWLEDGE_REPLY_TEXT_ENTITIES, ignoreCase: true },
  )
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt) => String(alt || '').trim() ? `[image: ${String(alt).trim()}]` : '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/[<>]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeForProvider(value: string | null | undefined, maxChars: number): string {
  const sanitized = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, 'javascript[:]')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (!sanitized) return '';
  return sanitized.length > maxChars ? `${sanitized.slice(0, maxChars - 3).trimEnd()}...` : sanitized;
}

export function sanitizeInlineForProvider(value: string | null | undefined, maxChars: number): string {
  return clampText(sanitizeForProvider(value, maxChars).replace(/\s+/g, ' '), maxChars);
}

export function renderProviderBody(lines: Array<string | null>, maxChars: number): string {
  return sanitizeForProvider(lines.filter((line): line is string => line !== null).join('\n'), maxChars);
}

export function latestRequesterExcerpt(timeline: TicketTimelineEntry[]): string | null {
  const entry = [...timeline].reverse().find((candidate) => candidate.actor === 'requester_candidate');
  return entry ? clampText(entry.body, 260) : null;
}

export function replyLocale(language: string | null | undefined, ticket: TicketLike): {
  greeting: string;
  sources: string;
  closing: string[];
  technicianWillConfirm: string;
  noReliableAnswer: string;
  possibleReferences: string;
  possibleReferencesIntro: string;
  latestRequester: (excerpt: string) => string;
} {
  const normalized = String(language ?? '').trim().toLocaleLowerCase();
  const useFrench = normalized.startsWith('fr') || (!normalized && ticketLooksFrench(ticket));
  if (useFrench) {
    return {
      greeting: 'Bonjour,',
      sources: 'Sources :',
      technicianWillConfirm: 'Un technicien du support vérifiera et complétera la réponse si nécessaire.',
      noReliableAnswer: 'Nous n\'avons pas trouvé d\'éléments suffisamment fiables pour vous proposer une réponse automatique complète sur cette demande.',
      possibleReferences: 'Références possibles :',
      possibleReferencesIntro: 'Nous avons trouvé des références possibles, mais un technicien doit confirmer lesquelles correspondent à votre situation avant de vous donner une réponse complète.',
      latestRequester: (excerpt) => `Dernier message demandeur pris en compte : ${excerpt}.`,
      closing: ['Cordialement,', 'L\'équipe support'],
    };
  }
  return {
    greeting: 'Hello,',
    sources: 'Sources:',
    technicianWillConfirm: 'A helpdesk technician will verify and complete the answer if needed.',
    noReliableAnswer: 'We could not find enough reliable information to propose a complete automated answer for this request.',
    possibleReferences: 'Possible references:',
    possibleReferencesIntro: 'We found possible references, but a technician needs to confirm which ones match your situation before giving you a complete answer.',
    latestRequester: (excerpt) => `Latest requester update considered: ${excerpt}.`,
    closing: ['Best regards,', 'The support team'],
  };
}

export function sourceLineFromKnowledge(item: KnowledgeSearchItem, index: number): string {
  const ref = sanitizeInlineForProvider(item.ref ?? item.id ?? `document-${index + 1}`, 80);
  const title = sanitizeInlineForProvider(item.title ?? 'Untitled document', 180);
  // Be explicit when a candidate was retrieved but not validated by the interpreter, so the
  // technician knows it still needs a relevance check (it never grounded an automated reply).
  const suffix = item.validation_status === 'unvalidated' ? ' [unvalidated candidate]' : '';
  return `- ${ref} - ${title}${suffix}`;
}

export function sourceLineFromWeb(item: WebSearchResultItem): string {
  const title = sanitizeInlineForProvider(item.title || item.url, 180);
  const url = sanitizeInlineForProvider(item.url, 500);
  return `- ${title} (${url})`;
}

export function fallbackSourceLines(
  knowledgeItems: KnowledgeSearchItem[],
  webResults: WebSearchResultItem[],
  limit: number,
): string[] {
  const lines = [
    ...knowledgeItems.map(sourceLineFromKnowledge),
    ...webResults.map(sourceLineFromWeb),
  ].slice(0, limit);
  return lines.length > 0 ? lines : ['- No source candidate was retrieved.'];
}

export function synthesisSourceLine(source: ReplySynthesisSource): string {
  const title = sanitizeInlineForProvider(source.title, 180) || 'Untitled source';
  if (source.kind === 'knowledge') {
    const ref = sanitizeInlineForProvider(source.ref ?? 'knowledge', 80) || 'knowledge';
    return `- ${ref} - ${title}`;
  }
  const url = source.url ? sanitizeInlineForProvider(source.url, 500) : '';
  return `- ${title}${url ? ` (${url})` : ''}`;
}

export function rejectedSynthesisSourceLine(source: ReplySynthesisRejectedSource): string {
  return `${synthesisSourceLine(source)}: ${sanitizeInlineForProvider(source.reason, 220)}`;
}

export function limitedSourceLines(lines: string[], maxLines: number, omittedLabel: string): string[] {
  if (lines.length <= maxLines) {
    return lines;
  }
  return [
    ...lines.slice(0, maxLines),
    `- ${lines.length - maxLines} more ${omittedLabel} omitted from this compact note.`,
  ];
}

export function renderSynthesizedRequesterReply(
  ticket: TicketLike,
  synthesis: ReplySynthesisResult,
): string {
  const locale = replyLocale(synthesis.language, ticket);
  if (!synthesis.usable) {
    return renderProviderBody([
      locale.greeting,
      '',
      locale.noReliableAnswer,
      '',
      locale.technicianWillConfirm,
      '',
      ...locale.closing,
    ], MAX_PUBLIC_REPLY_CHARS);
  }
  const sourceLines = synthesis.used_sources.map(synthesisSourceLine);
  const requesterBody = sanitizeForProvider(synthesis.requester_reply, MAX_SYNTHESIZED_REQUESTER_BODY_CHARS);
  return renderProviderBody([
    locale.greeting,
    '',
    requesterBody,
    '',
    ...(sourceLines.length > 0 ? [locale.sources, ...sourceLines, ''] : []),
    synthesis.needs_human_review ? locale.technicianWillConfirm : null,
    synthesis.needs_human_review ? '' : null,
    ...locale.closing,
  ], MAX_PUBLIC_REPLY_CHARS);
}

export function renderSynthesizedTriageNote(
  ticket: TicketLike,
  timeline: TicketTimelineEntry[],
  synthesis: ReplySynthesisResult,
): string {
  const used = limitedSourceLines(synthesis.used_sources.map(synthesisSourceLine), MAX_SYNTHESIS_NOTE_SOURCES, 'used source(s)');
  const rejected = limitedSourceLines(
    synthesis.rejected_sources.map(rejectedSynthesisSourceLine),
    MAX_SYNTHESIS_NOTE_REJECTIONS,
    'rejected source(s)',
  );
  const technicianBrief = sanitizeForProvider(
    synthesis.technician_brief || 'No synthesis brief was produced.',
    MAX_INTERNAL_SYNTHESIS_BRIEF_CHARS,
  );
  const recommendedReply = synthesis.usable
    ? sanitizeForProvider(synthesis.requester_reply, MAX_INTERNAL_RECOMMENDED_REPLY_CHARS)
    : 'No reliable source-grounded answer was produced; the requester reply will ask a technician to follow up.';
  return renderProviderBody([
    '[KANAP triage proposal]',
    `Ticket #${ticket.id} - ${ticket.title}`,
    ticket.status ? `Status: ${ticket.status}` : null,
    ticket.priority ? `Priority: ${ticket.priority}` : null,
    '',
    'Ticket history considered:',
    ...timelineSummaryLines(timeline).slice(-4),
    '',
    'Technician brief:',
    technicianBrief,
    '',
    'Used sources:',
    ...(used.length > 0 ? used : ['- None']),
    '',
    'Rejected/off-topic sources:',
    ...(rejected.length > 0 ? rejected : ['- None recorded']),
    '',
    'Recommended reply to requester:',
    recommendedReply,
    '',
    synthesis.needs_human_review ? 'Uncertainty: technician confirmation is recommended before approval.' : null,
    synthesis.fallback_reason ? `Synthesis validation note: ${synthesis.fallback_reason}.` : null,
    '',
    'No external change has been made. This note was prepared by KANAP and requires human approval before posting.',
  ], MAX_INTERNAL_NOTE_CHARS);
}

export function buildRequesterReply(
  ticket: TicketLike,
  knowledgeItems: KnowledgeSearchItem[],
  timeline: TicketTimelineEntry[] = [],
  webResults: WebSearchResultItem[] = [],
): string {
  const locale = replyLocale(null, ticket);
  const latestRequester = latestRequesterExcerpt(timeline);
  return renderProviderBody([
    locale.greeting,
    '',
    locale.noReliableAnswer,
    latestRequester ? locale.latestRequester(latestRequester) : null,
    '',
    locale.technicianWillConfirm,
    '',
    ...locale.closing,
  ], MAX_PUBLIC_REPLY_CHARS);
}

export function buildStatusUpdateProposal(
  lifecycle: Record<string, unknown> | null,
  shouldWaitForRequester: boolean,
): { transitionKey: string; reason: string } | null {
  if (!shouldWaitForRequester || lifecycle?.terminal === true) {
    return null;
  }
  const transitions = Array.isArray(lifecycle?.allowedTransitions)
    ? lifecycle.allowedTransitions.filter(isRecord)
    : [];
  const pending = transitions.find((transition) => transition.key === 'pending' && transition.destructive !== true);
  if (!pending) {
    return null;
  }
  return {
    transitionKey: 'pending',
    reason: 'A requester-facing answer is being prepared; move the ticket to pending/waiting state after approval so support waits for requester feedback.',
  };
}
