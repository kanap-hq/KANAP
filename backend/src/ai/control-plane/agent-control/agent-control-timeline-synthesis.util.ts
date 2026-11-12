import { PRODUCT_NAME } from '../../../config/product';
import { decodeHtmlEntities, decodeNumericHtmlEntities, HTML_TEXT_ENTITIES } from '../../../common/html-entities';
import { isRecord } from '../../../common/object-guards';
import { TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY, TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY } from '../capability/capability-contract';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { MAX_INTERNAL_NOTE_CHARS, MAX_PUBLIC_REPLY_CHARS } from '../providers/ticket-safety';
import { ticketLooksFrench } from './agent-control-knowledge.util';
import { clampText } from './agent-control-util';
import { isPublicTicketItem } from './agent-ticket-sources';
import type { ConversationActionGate, KnowledgeSearchItem, TicketLike, TicketNoteLike, TicketTimelineEntry, WebSearchResultItem } from './ai-agent-control.service';
import { ReplySynthesisRejectedSource, ReplySynthesisResult, ReplySynthesisSource } from './ai-reply-synthesis.service';
import {
  HTML_TAGS,
  removeThematicBreakLines,
  replaceMarkdownLinks,
  SPACES_BEFORE_LINE_BREAKS,
  untilLast,
} from '../../../common/text-scan';

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

/**
 * The frame of the internal note the triage proposes to the technicians (headings and fixed
 * sentences), in the tenant's language (`tenants.metadata.language`, English otherwise), as the
 * reply to the requester follows the ticket's. What the models write stays in their language.
 */
export type TriageNoteLanguage = 'en' | 'fr' | 'de' | 'es';

type TriageNoteTexts = {
  header: string;
  footer: string;
  ticket: (id: string, title: string) => string;
  status: (value: string) => string;
  priority: (value: string) => string;
  historyHeading: string;
  noHistory: string;
  initialTicket: string;
  agentActor: string;
  requesterActor: string;
  supportActor: string;
  visibility: { public: string; internal: string };
  technicianBrief: string;
  administrativeSourcesHeading: string;
  administrativeReplyReason: string;
  escalationReason: string;
  synthesisUnavailable: string;
  unvalidatedCandidate: string;
  untitledDocument: string;
  untitledSource: string;
  fallbackKnowledgeHeading: string;
  fallbackWebHeading: string;
  noFallbackSource: string;
  usedSources: string;
  rejectedSources: string;
  none: string;
  noneRecorded: string;
  recommendedReply: string;
  noSynthesisBrief: string;
  noReliableAnswer: string;
  uncertainty: string;
  validationNote: (reason: string) => string;
  omitted: (count: number, kind: 'used' | 'rejected') => string;
};

const TRIAGE_NOTE_TEXTS: Record<TriageNoteLanguage, TriageNoteTexts> = {
  en: {
    header: `[${PRODUCT_NAME} triage proposal]`,
    footer: `No external change has been made. This note was prepared by ${PRODUCT_NAME} and requires human approval before posting.`,
    ticket: (id, title) => `Ticket #${id} - ${title}`,
    status: (value) => `Status: ${value}`,
    priority: (value) => `Priority: ${value}`,
    historyHeading: 'Ticket history considered:',
    noHistory: '- No ticket history entries were available.',
    initialTicket: 'initial ticket',
    agentActor: `${PRODUCT_NAME} agent`,
    requesterActor: 'requester/public user',
    supportActor: 'support/internal',
    visibility: { public: 'public', internal: 'internal' },
    technicianBrief: 'Technician brief:',
    administrativeSourcesHeading: 'Candidate sources reviewed (not used by the administrative reply; no article body copied):',
    administrativeReplyReason: 'The agent answered with an administrative reply (see the proposed requester reply on this ticket); no knowledge-sourced answer was required.',
    escalationReason: 'The agent escalated this ticket internally; no requester reply was prepared.',
    synthesisUnavailable: 'AI reply synthesis was unavailable or skipped. Review the possible sources above and complete the requester answer manually before approving.',
    unvalidatedCandidate: ' [unvalidated candidate]',
    untitledDocument: 'Untitled document',
    untitledSource: 'Untitled source',
    fallbackKnowledgeHeading: 'Possible sources found (fallback mode; no article body copied):',
    fallbackWebHeading: 'Web leads (not validated):',
    noFallbackSource: '- No source candidate was retrieved.',
    usedSources: 'Used sources:',
    rejectedSources: 'Rejected/off-topic sources:',
    none: '- None',
    noneRecorded: '- None recorded',
    recommendedReply: 'Recommended reply to requester:',
    noSynthesisBrief: 'No synthesis brief was produced.',
    noReliableAnswer: 'No reliable source-grounded answer was produced; the requester reply will ask a technician to follow up.',
    uncertainty: 'Uncertainty: technician confirmation is recommended before approval.',
    validationNote: (reason) => `Synthesis validation note: ${reason}.`,
    omitted: (count, kind) => `- ${count} more ${kind === 'used' ? 'used' : 'rejected'} source(s) omitted from this compact note.`,
  },
  fr: {
    header: `[Proposition de ${PRODUCT_NAME} pour le ticket]`,
    footer: `Aucune modification externe n'a été faite. Cette note a été préparée par ${PRODUCT_NAME} et doit être approuvée par une personne avant publication.`,
    ticket: (id, title) => `Ticket #${id} - ${title}`,
    status: (value) => `Statut : ${value}`,
    priority: (value) => `Priorité : ${value}`,
    historyHeading: 'Historique du ticket pris en compte :',
    noHistory: '- Aucun élément d\'historique du ticket n\'était disponible.',
    initialTicket: 'ticket initial',
    agentActor: `agent ${PRODUCT_NAME}`,
    requesterActor: 'demandeur/utilisateur public',
    supportActor: 'support/interne',
    visibility: { public: 'public', internal: 'interne' },
    technicianBrief: 'Note pour le technicien :',
    administrativeSourcesHeading: 'Sources candidates examinées (non utilisées par la réponse administrative ; aucun corps d\'article recopié) :',
    administrativeReplyReason: 'L\'agent a répondu par une réponse administrative (voir la réponse proposée au demandeur sur ce ticket) ; aucune réponse sourcée n\'était nécessaire.',
    escalationReason: 'L\'agent a transmis ce ticket en interne ; aucune réponse au demandeur n\'a été préparée.',
    synthesisUnavailable: 'La rédaction de la réponse par l\'IA était indisponible ou n\'a pas eu lieu. Examinez les sources possibles ci-dessus et complétez la réponse au demandeur avant d\'approuver.',
    unvalidatedCandidate: ' [candidat non validé]',
    untitledDocument: 'Document sans titre',
    untitledSource: 'Source sans titre',
    fallbackKnowledgeHeading: 'Sources possibles trouvées (mode dégradé ; aucun corps d\'article recopié) :',
    fallbackWebHeading: 'Pistes web (non validées) :',
    noFallbackSource: '- Aucune source candidate n\'a été trouvée.',
    usedSources: 'Sources utilisées :',
    rejectedSources: 'Sources écartées ou hors sujet :',
    none: '- Aucune',
    noneRecorded: '- Aucune enregistrée',
    recommendedReply: 'Réponse recommandée au demandeur :',
    noSynthesisBrief: 'Aucune note de synthèse n\'a été produite.',
    noReliableAnswer: 'Aucune réponse fiable fondée sur une source n\'a été produite ; la réponse au demandeur indiquera qu\'un technicien va reprendre la demande.',
    uncertainty: 'Incertitude : une confirmation par un technicien est recommandée avant approbation.',
    validationNote: (reason) => `Note de validation de la rédaction : ${reason}.`,
    omitted: (count, kind) => `- ${count} autre(s) source(s) ${kind === 'used' ? 'utilisée(s)' : 'écartée(s)'} non reprise(s) dans cette note courte.`,
  },
  de: {
    header: `[${PRODUCT_NAME}-Vorschlag zum Ticket]`,
    footer: `Es wurde keine externe Änderung vorgenommen. Diese Notiz wurde von ${PRODUCT_NAME} vorbereitet und muss vor dem Veröffentlichen von einer Person freigegeben werden.`,
    ticket: (id, title) => `Ticket #${id} - ${title}`,
    status: (value) => `Status: ${value}`,
    priority: (value) => `Priorität: ${value}`,
    historyHeading: 'Berücksichtigter Ticketverlauf:',
    noHistory: '- Es lagen keine Einträge im Ticketverlauf vor.',
    initialTicket: 'ursprüngliches Ticket',
    agentActor: `${PRODUCT_NAME}-Agent`,
    requesterActor: 'Anfragende Person/öffentlicher Benutzer',
    supportActor: 'Support/intern',
    visibility: { public: 'öffentlich', internal: 'intern' },
    technicianBrief: 'Hinweis für den Techniker:',
    administrativeSourcesHeading: 'Geprüfte mögliche Quellen (von der administrativen Antwort nicht verwendet; kein Artikeltext übernommen):',
    administrativeReplyReason: 'Der Agent hat mit einer administrativen Antwort geantwortet (siehe die vorgeschlagene Antwort an die anfragende Person in diesem Ticket); eine auf Wissen gestützte Antwort war nicht erforderlich.',
    escalationReason: 'Der Agent hat dieses Ticket intern weitergeleitet; es wurde keine Antwort an die anfragende Person vorbereitet.',
    synthesisUnavailable: 'Die KI-Antwort war nicht verfügbar oder wurde übersprungen. Prüfen Sie die oben genannten möglichen Quellen und vervollständigen Sie die Antwort an die anfragende Person vor der Freigabe.',
    unvalidatedCandidate: ' [nicht validierter Kandidat]',
    untitledDocument: 'Dokument ohne Titel',
    untitledSource: 'Quelle ohne Titel',
    fallbackKnowledgeHeading: 'Gefundene mögliche Quellen (Ausweichmodus; kein Artikeltext übernommen):',
    fallbackWebHeading: 'Hinweise aus dem Web (nicht validiert):',
    noFallbackSource: '- Es wurde keine mögliche Quelle gefunden.',
    usedSources: 'Verwendete Quellen:',
    rejectedSources: 'Verworfene oder themenfremde Quellen:',
    none: '- Keine',
    noneRecorded: '- Keine erfasst',
    recommendedReply: 'Empfohlene Antwort an die anfragende Person:',
    noSynthesisBrief: 'Es wurde kein Hinweis aus der Antworterstellung erzeugt.',
    noReliableAnswer: 'Es wurde keine verlässliche, auf Quellen gestützte Antwort erstellt; die Antwort an die anfragende Person kündigt die Rückmeldung eines Technikers an.',
    uncertainty: 'Unsicherheit: Eine Bestätigung durch einen Techniker wird vor der Freigabe empfohlen.',
    validationNote: (reason) => `Prüfhinweis zur Antworterstellung: ${reason}.`,
    omitted: (count, kind) => `- ${count} weitere ${kind === 'used' ? 'verwendete' : 'verworfene'} Quelle(n) in dieser kurzen Notiz ausgelassen.`,
  },
  es: {
    header: `[Propuesta de ${PRODUCT_NAME} para el ticket]`,
    footer: `No se ha realizado ningún cambio externo. Esta nota la ha preparado ${PRODUCT_NAME} y debe aprobarla una persona antes de publicarse.`,
    ticket: (id, title) => `Ticket #${id} - ${title}`,
    status: (value) => `Estado: ${value}`,
    priority: (value) => `Prioridad: ${value}`,
    historyHeading: 'Historial del ticket considerado:',
    noHistory: '- No había entradas disponibles en el historial del ticket.',
    initialTicket: 'ticket inicial',
    agentActor: `agente de ${PRODUCT_NAME}`,
    requesterActor: 'solicitante/usuario público',
    supportActor: 'soporte/interno',
    visibility: { public: 'público', internal: 'interno' },
    technicianBrief: 'Nota para el técnico:',
    administrativeSourcesHeading: 'Fuentes candidatas revisadas (no utilizadas por la respuesta administrativa; no se ha copiado el cuerpo de ningún artículo):',
    administrativeReplyReason: 'El agente respondió con una respuesta administrativa (consulte la respuesta propuesta al solicitante en este ticket); no se necesitaba una respuesta basada en la base de conocimiento.',
    escalationReason: 'El agente ha escalado este ticket internamente; no se ha preparado ninguna respuesta al solicitante.',
    synthesisUnavailable: 'La redacción de la respuesta por la IA no estaba disponible o no se realizó. Revise las fuentes posibles indicadas arriba y complete la respuesta al solicitante antes de aprobar.',
    unvalidatedCandidate: ' [candidato no validado]',
    untitledDocument: 'Documento sin título',
    untitledSource: 'Fuente sin título',
    fallbackKnowledgeHeading: 'Fuentes posibles encontradas (modo alternativo; no se ha copiado el cuerpo de ningún artículo):',
    fallbackWebHeading: 'Pistas web (no validadas):',
    noFallbackSource: '- No se encontró ninguna fuente candidata.',
    usedSources: 'Fuentes utilizadas:',
    rejectedSources: 'Fuentes descartadas o fuera de tema:',
    none: '- Ninguna',
    noneRecorded: '- Ninguna registrada',
    recommendedReply: 'Respuesta recomendada al solicitante:',
    noSynthesisBrief: 'No se generó ninguna nota de la redacción.',
    noReliableAnswer: 'No se generó ninguna respuesta fiable basada en fuentes; la respuesta al solicitante indicará que un técnico retomará la solicitud.',
    uncertainty: 'Incertidumbre: se recomienda la confirmación de un técnico antes de aprobar.',
    validationNote: (reason) => `Nota de validación de la redacción: ${reason}.`,
    omitted: (count, kind) => `- ${count} fuente(s) ${kind === 'used' ? 'utilizada(s)' : 'descartada(s)'} más omitida(s) en esta nota breve.`,
  },
};

/** The note language of a tenant language (`fr-FR` gives `fr`); English for anything else. */
export function triageNoteLanguage(value: string | null | undefined): TriageNoteLanguage {
  const base = String(value ?? '').trim().toLowerCase().split(/[-_]/, 1)[0];
  return base === 'fr' || base === 'de' || base === 'es' ? base : 'en';
}

function noteTexts(language: TriageNoteLanguage | null | undefined): TriageNoteTexts {
  return TRIAGE_NOTE_TEXTS[language ?? 'en'] ?? TRIAGE_NOTE_TEXTS.en;
}

/** The header and the closing line of a triage note the agent posts in a ticket (English). */
export const TRIAGE_NOTE_HEADER = TRIAGE_NOTE_TEXTS.en.header;
export const TRIAGE_NOTE_FOOTER = TRIAGE_NOTE_TEXTS.en.footer;

/**
 * Marks of a body the agent wrote. The literals are those of tickets written before the product
 * name became a constant: they stay recognised after a rename, as the current marks are.
 */
const AGENT_BODY_MARKS = [
  '[kanap triage proposal]',
  'this note was prepared by kanap',
  `[${PRODUCT_NAME} triage proposal]`.toLocaleLowerCase(),
  `this note was prepared by ${PRODUCT_NAME}`.toLocaleLowerCase(),
  'prepared by the agent control center',
  // The header of a note written in the tenant's language.
  ...Object.values(TRIAGE_NOTE_TEXTS).map((texts) => texts.header.toLocaleLowerCase()),
];

export function isKanapMarkedBody(value: string): boolean {
  const normalized = normalizeTimelineBody(value).toLocaleLowerCase();
  return AGENT_BODY_MARKS.some((mark) => normalized.includes(mark));
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
    // A message the ticketing system does not mark public is internal.
    const visibility: TicketTimelineEntry['visibility'] = isPublicTicketItem(note) ? 'public' : 'internal';
    const body = normalizeKnowledgeReplyText(note.body);
    const normalizedBody = normalizeTimelineBody(body);
    const markedKanap = kanapPublicBodies.has(normalizedBody) || isKanapMarkedBody(body) || note.authorRole === 'kanap_agent';
    const actor = markedKanap
      ? 'kanap_agent'
      : note.authorRole === 'requester'
        ? 'requester_candidate'
        : visibility === 'internal' || note.authorRole === 'support'
          ? 'support_or_unknown'
          : 'requester_candidate';
    const actorSource: TicketTimelineEntry['actorSource'] = markedKanap
      ? 'kanap_marker'
      : note.authorRole === 'requester'
        ? 'provider_requester_user'
        : visibility === 'internal' || note.authorRole === 'support'
          ? 'provider_support_user'
          : 'public_non_kanap_followup';
    const createdTime = parseTime(note.createdAt);
    const updatedTime = ticketNoteTime(note);
    entries.push({
      id: `followup:${note.id}`,
      kind: 'followup',
      visibility,
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

export function timelineSummaryLines(timeline: TicketTimelineEntry[], language: TriageNoteLanguage = 'en'): string[] {
  const texts = noteTexts(language);
  if (timeline.length === 0) {
    return [texts.noHistory];
  }
  return timeline.slice(-8).map((entry) => {
    const at = entry.createdAt ? entry.createdAt.slice(0, 19).replace('T', ' ') : texts.initialTicket;
    const actor = entry.actor === 'kanap_agent'
      ? texts.agentActor
      : entry.actor === 'requester_candidate'
        ? texts.requesterActor
        : texts.supportActor;
    return `- ${at} / ${actor} / ${texts.visibility[entry.visibility] ?? entry.visibility}: ${clampText(entry.body, 220)}`;
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
  language: TriageNoteLanguage = 'en',
): string {
  const texts = noteTexts(language);
  const technicianBrief = plannerOutcome
    ? (plannerOutcome.reason?.trim()
      || (plannerOutcome.kind === 'administrative_reply' ? texts.administrativeReplyReason : texts.escalationReason))
    : texts.synthesisUnavailable;
  return renderProviderBody([
    texts.header,
    texts.ticket(ticket.id, ticket.title),
    ticket.status ? texts.status(ticket.status) : null,
    ticket.priority ? texts.priority(ticket.priority) : null,
    '',
    texts.historyHeading,
    ...timelineSummaryLines(timeline, language),
    '',
    // An escalation omits candidate sources. An administrative reply keeps knowledge and web
    // results together under its own heading: they are context the reply did not use. The
    // synthesis fallback is the note a technician reads as "sources found", so unvalidated web
    // results get a separate heading there and never sit under the knowledge one.
    ...(plannerOutcome?.kind === 'escalation'
      ? []
      : plannerOutcome?.kind === 'administrative_reply'
        ? [
          texts.administrativeSourcesHeading,
          ...fallbackSourceLines(knowledgeItems, webResults, 8, language),
          '',
        ]
        : [
          ...synthesisFallbackSourceSections(knowledgeItems, webResults, 8, language),
          '',
        ]),
    texts.technicianBrief,
    technicianBrief,
    '',
    texts.footer,
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
  const decoded = decodeHtmlEntities(
    decodeNumericHtmlEntities(String(value ?? '').replace(/\r\n/g, '\n'))
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(untilLast('>', /<li\b[^>]*>/gi), '- ')
      .replace(/<\/li>/gi, '\n')
      .replace(HTML_TAGS, ' '),
    { entities: KNOWLEDGE_REPLY_TEXT_ENTITIES, ignoreCase: true },
  );
  const withoutImages = replaceMarkdownLinks(decoded, true, (alt) => alt.trim() ? `[image: ${alt.trim()}]` : '');
  const withoutLinks = replaceMarkdownLinks(withoutImages, false, (label) => label);
  return removeThematicBreakLines(withoutLinks.replace(/^#{1,6}\s+/gm, ''))
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/[<>]/g, '')
    .replace(SPACES_BEFORE_LINE_BREAKS, '\n')
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
    .replace(SPACES_BEFORE_LINE_BREAKS, '\n')
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

export function sourceLineFromKnowledge(item: KnowledgeSearchItem, index: number, language: TriageNoteLanguage = 'en'): string {
  const texts = noteTexts(language);
  const ref = sanitizeInlineForProvider(item.ref ?? item.id ?? `document-${index + 1}`, 80);
  const title = sanitizeInlineForProvider(item.title ?? texts.untitledDocument, 180);
  // Be explicit when a candidate was retrieved but not validated by the interpreter, so the
  // technician knows it still needs a relevance check (it never grounded an automated reply).
  const suffix = item.validation_status === 'unvalidated' ? texts.unvalidatedCandidate : '';
  return `- ${ref} - ${title}${suffix}`;
}

export function sourceLineFromWeb(item: WebSearchResultItem): string {
  const title = sanitizeInlineForProvider(item.title || item.url, 180);
  const url = sanitizeInlineForProvider(item.url, 500);
  return `- ${title} (${url})`;
}

// Knowledge lines keep their place at the front of the shared cap, then web lines fill what remains.
function limitedFallbackSourceLines(
  knowledgeItems: KnowledgeSearchItem[],
  webResults: WebSearchResultItem[],
  limit: number,
  language: TriageNoteLanguage,
): { knowledge: string[]; web: string[] } {
  const knowledge = knowledgeItems.map((item, index) => sourceLineFromKnowledge(item, index, language));
  const web = webResults.map(sourceLineFromWeb);
  const keptKnowledge = knowledge.slice(0, limit);
  const keptWeb = web.slice(0, Math.max(0, limit - keptKnowledge.length));
  return { knowledge: keptKnowledge, web: keptWeb };
}

export function fallbackSourceLines(
  knowledgeItems: KnowledgeSearchItem[],
  webResults: WebSearchResultItem[],
  limit: number,
  language: TriageNoteLanguage = 'en',
): string[] {
  const { knowledge, web } = limitedFallbackSourceLines(knowledgeItems, webResults, limit, language);
  const lines = [...knowledge, ...web];
  return lines.length > 0 ? lines : [noteTexts(language).noFallbackSource];
}

// Synthesis-failure note only. Knowledge keeps the existing heading. Web results, when any
// survive the cap, are listed under their own heading. A web-only note shows only that heading.
// An empty retrieval still says no candidate was retrieved, under the knowledge heading.
function synthesisFallbackSourceSections(
  knowledgeItems: KnowledgeSearchItem[],
  webResults: WebSearchResultItem[],
  limit: number,
  language: TriageNoteLanguage,
): string[] {
  const texts = noteTexts(language);
  const { knowledge, web } = limitedFallbackSourceLines(knowledgeItems, webResults, limit, language);
  const sections: string[] = [];
  if (knowledge.length > 0 || web.length === 0) {
    sections.push(
      texts.fallbackKnowledgeHeading,
      ...(knowledge.length > 0 ? knowledge : [texts.noFallbackSource]),
    );
  }
  if (web.length > 0) {
    if (sections.length > 0) sections.push('');
    sections.push(texts.fallbackWebHeading, ...web);
  }
  return sections;
}

export function synthesisSourceLine(source: ReplySynthesisSource, language: TriageNoteLanguage = 'en'): string {
  const title = sanitizeInlineForProvider(source.title, 180) || noteTexts(language).untitledSource;
  if (source.kind === 'knowledge') {
    const ref = sanitizeInlineForProvider(source.ref ?? 'knowledge', 80) || 'knowledge';
    return `- ${ref} - ${title}`;
  }
  const url = source.url ? sanitizeInlineForProvider(source.url, 500) : '';
  return `- ${title}${url ? ` (${url})` : ''}`;
}

export function rejectedSynthesisSourceLine(source: ReplySynthesisRejectedSource, language: TriageNoteLanguage = 'en'): string {
  return `${synthesisSourceLine(source, language)}: ${sanitizeInlineForProvider(source.reason, 220)}`;
}

export function limitedSourceLines(
  lines: string[],
  maxLines: number,
  kind: 'used' | 'rejected',
  language: TriageNoteLanguage = 'en',
): string[] {
  if (lines.length <= maxLines) {
    return lines;
  }
  return [
    ...lines.slice(0, maxLines),
    noteTexts(language).omitted(lines.length - maxLines, kind),
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
  const sourceLines = synthesis.used_sources.map((source) => synthesisSourceLine(source));
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
  language: TriageNoteLanguage = 'en',
): string {
  const texts = noteTexts(language);
  const used = limitedSourceLines(
    synthesis.used_sources.map((source) => synthesisSourceLine(source, language)),
    MAX_SYNTHESIS_NOTE_SOURCES,
    'used',
    language,
  );
  const rejected = limitedSourceLines(
    synthesis.rejected_sources.map((source) => rejectedSynthesisSourceLine(source, language)),
    MAX_SYNTHESIS_NOTE_REJECTIONS,
    'rejected',
    language,
  );
  const technicianBrief = sanitizeForProvider(
    synthesis.technician_brief || texts.noSynthesisBrief,
    MAX_INTERNAL_SYNTHESIS_BRIEF_CHARS,
  );
  const recommendedReply = synthesis.usable
    ? sanitizeForProvider(synthesis.requester_reply, MAX_INTERNAL_RECOMMENDED_REPLY_CHARS)
    : texts.noReliableAnswer;
  return renderProviderBody([
    texts.header,
    texts.ticket(ticket.id, ticket.title),
    ticket.status ? texts.status(ticket.status) : null,
    ticket.priority ? texts.priority(ticket.priority) : null,
    '',
    texts.historyHeading,
    ...timelineSummaryLines(timeline, language).slice(-4),
    '',
    texts.technicianBrief,
    technicianBrief,
    '',
    texts.usedSources,
    ...(used.length > 0 ? used : [texts.none]),
    '',
    texts.rejectedSources,
    ...(rejected.length > 0 ? rejected : [texts.noneRecorded]),
    '',
    texts.recommendedReply,
    recommendedReply,
    '',
    synthesis.needs_human_review ? texts.uncertainty : null,
    synthesis.fallback_reason ? texts.validationNote(synthesis.fallback_reason) : null,
    '',
    texts.footer,
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
