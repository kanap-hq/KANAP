/**
 * What a service desk agent reads. A ticket item is public when the ticketing system marks it
 * public; any other item is internal. The agent's internal notes setting decides whether the
 * model calls of the triage read every item of the ticket ('used', also when the setting is
 * absent) or its public items only ('ignored'). A reply cites the documents of the libraries
 * the agent may cite.
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
 * The conversation gate as the action planner reads it. The gate decides on the whole thread;
 * with internal notes ignored, the model does not get its message fingerprints, which may hold
 * the text of the latest message.
 */
export function conversationGateTheAgentReads(
  gate: object,
  internalNotes: AgentInternalNotesSetting,
): Record<string, unknown> {
  const view: Record<string, unknown> = { ...gate };
  if (internalNotes === 'ignored') {
    delete view.latest_ticket_note_fingerprint;
    delete view.latest_requester_message_fingerprint;
  }
  return view;
}
