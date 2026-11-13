/**
 * What a service desk agent reads. A ticket item is public when the ticketing system marks it
 * public; any other item is internal. The agent's internal notes setting decides whether the
 * triage reads every item of the ticket ('used', also when the setting is absent) or its public
 * items only ('ignored'). With 'used', the choice of the actions and the brief to the technician
 * read every item; a reply to the requester is written on the public items only, whatever the
 * setting. A reply cites the documents of the libraries the agent may cite.
 */
export const AGENT_INTERNAL_NOTES_SETTINGS = ['used', 'ignored'] as const;
export type AgentInternalNotesSetting = (typeof AGENT_INTERNAL_NOTES_SETTINGS)[number];

export function isPublicTicketItem(item: { visibility?: unknown } | null | undefined): boolean {
  return item?.visibility === 'public';
}

export function ticketItemsTheAgentReads<T extends { visibility?: unknown }>(
  items: readonly T[],
  internalNotes: AgentInternalNotesSetting,
): T[] {
  return internalNotes === 'ignored' ? items.filter(isPublicTicketItem) : [...items];
}

/**
 * The documents a public reply may cite. `citableLibraryIds` is the agent's library list;
 * null means the agent is set to cite every library it may read. With a list, a document
 * whose library is unknown is left out.
 */
export function citableKnowledgeDocuments<T extends { library_id?: string | null }>(
  documents: readonly T[],
  citableLibraryIds: readonly string[] | null | undefined,
): T[] {
  if (citableLibraryIds == null) return [...documents];
  const citable = new Set(citableLibraryIds.map((id) => id.toLowerCase()));
  return documents.filter((document) => !!document.library_id && citable.has(document.library_id.toLowerCase()));
}

/**
 * The screenshot evidence of the public items of a ticket: the attachments of its description and
 * of its public messages.
 */
export function imageEvidenceOfPublicItems<T extends { attachment_ref: string }>(
  evidence: readonly T[],
  ticket: { attachments?: ReadonlyArray<{ id?: string | null; target: string }> | null },
  notes: ReadonlyArray<{ visibility?: unknown; attachments?: ReadonlyArray<{ id?: string | null; target: string }> | null }>,
): T[] {
  const publicRefs = new Set(
    [...(ticket.attachments ?? []), ...notes.filter(isPublicTicketItem).flatMap((note) => note.attachments ?? [])]
      .map((ref) => ref.id ?? ref.target),
  );
  return evidence.filter((entry) => publicRefs.has(entry.attachment_ref));
}

/**
 * The fields of the conversation gate the action planner reads when internal notes are ignored:
 * what the gate decides and why. The gate decides on the whole thread; its dates, counters,
 * identifiers and message fingerprints stay out of the model call, and a field added to the gate
 * later stays out until it is listed here.
 */
const GATE_FIELDS_READ_WITH_INTERNAL_NOTES_IGNORED = [
  'can_prepare_internal_note',
  'can_prepare_public_reply',
  'can_prepare_sourced_answer',
  'can_prepare_administrative_close_reply',
  'internal_note_reason',
  'public_reply_reason',
  'sourced_answer_reason',
  'administrative_close_reply_reason',
] as const;

/** The conversation gate as the action planner reads it: whole with internal notes used. */
export function conversationGateTheAgentReads(
  gate: object,
  internalNotes: AgentInternalNotesSetting,
): Record<string, unknown> {
  const source = gate as Record<string, unknown>;
  if (internalNotes !== 'ignored') return { ...source };
  return Object.fromEntries(
    GATE_FIELDS_READ_WITH_INTERNAL_NOTES_IGNORED
      .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
      .map((field) => [field, source[field]]),
  );
}
