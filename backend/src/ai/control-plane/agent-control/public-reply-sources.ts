/**
 * What a public reply may read. The requester reads the messages the ticketing system marks
 * public; a message it does not mark public is internal. A public reply is written from the
 * public items of the ticket and from the documents of the libraries the agent may cite. The
 * decisions of the triage and the texts for a technician (brief, internal note) read every
 * item of the ticket.
 */
export function isPublicTicketItem(item: { visibility?: unknown } | null | undefined): boolean {
  return item?.visibility === 'public';
}

export function publicTicketItems<T extends { visibility?: unknown }>(items: readonly T[]): T[] {
  return items.filter(isPublicTicketItem);
}

/**
 * Decisions read every item of the ticket. When a decision asks for a text to the requester,
 * the call that writes it receives one value of this closed list and no free text of the
 * decision (reasoning, reason, draft).
 */
export const ADMINISTRATIVE_REPLY_INTENTS = ['close_reply', 'acknowledgement', 'other'] as const;
export type AdministrativeReplyIntent = typeof ADMINISTRATIVE_REPLY_INTENTS[number];

/** A value outside the closed list becomes `other`. */
export function administrativeReplyIntent(value: unknown): AdministrativeReplyIntent {
  return (ADMINISTRATIVE_REPLY_INTENTS as readonly unknown[]).includes(value)
    ? value as AdministrativeReplyIntent
    : 'other';
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
