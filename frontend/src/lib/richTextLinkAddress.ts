/**
 * The address a link of a rich text opens: an `http`, `https` or `mailto` address, a path of the
 * application or an anchor of the page, as the reading view of a rich text (`MarkdownContent`).
 * Null for any other address: it shows as text.
 */
export function richTextLinkAddress(url: string | null | undefined): string | null {
  const address = String(url ?? '').trim();
  if (/^(?:https?|mailto):/i.test(address) || address.startsWith('/') || address.startsWith('#')) return address;
  return null;
}
