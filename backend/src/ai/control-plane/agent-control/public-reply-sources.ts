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
 * decision (reasoning, reason, draft). Each value has a fixed writing instruction in the code
 * of that call; a value outside the list writes nothing.
 */
export const ADMINISTRATIVE_REPLY_INTENTS = [
  'close_reply',
  'acknowledgement',
  'request_information',
  'awaiting_requester',
  'escalation_notice',
  'resolution_confirmation',
] as const;
export type AdministrativeReplyIntent = typeof ADMINISTRATIVE_REPLY_INTENTS[number];

/** When the decision may choose each value. Read by the call that decides, never by the one that writes. */
export const ADMINISTRATIVE_REPLY_INTENT_USES: Record<AdministrativeReplyIntent, string> = {
  close_reply: 'the ticket is closed after a period without activity; pair it with a terminal status_update',
  acknowledgement: 'confirm that the request was received and that the support team is looking into it',
  request_information: 'ask the requester for a detail the support team needs to handle the request',
  awaiting_requester: 'the ticket waits for an action of the requester; pair it with a status_update to the pending status',
  escalation_notice: 'the ticket is passed to the team that handles it; pair it with an assignment_update',
  resolution_confirmation: 'ask the requester to confirm that the issue is resolved',
};

/** A value of the closed list, or null for anything else. */
export function administrativeReplyIntent(value: unknown): AdministrativeReplyIntent | null {
  return (ADMINISTRATIVE_REPLY_INTENTS as readonly unknown[]).includes(value)
    ? value as AdministrativeReplyIntent
    : null;
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
