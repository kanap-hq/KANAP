/**
 * What a public reply may read. The requester reads the messages the ticketing system marks
 * public; a message it does not mark public is internal. A public reply is written from the
 * public items of the ticket and from the documents of the libraries the agent may cite. An
 * internal note proposed to a technician may read every item of the ticket.
 */
export function isPublicTicketItem(item: { visibility?: unknown } | null | undefined): boolean {
  return item?.visibility === 'public';
}

export function publicTicketItems<T extends { visibility?: unknown }>(items: readonly T[]): T[] {
  return items.filter(isPublicTicketItem);
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
