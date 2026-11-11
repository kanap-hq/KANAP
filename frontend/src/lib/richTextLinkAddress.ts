/**
 * The schemes of the addresses a link of a rich text opens, in lower case. A link with any other
 * scheme shows as text. The server holds the same list, `RICH_TEXT_LINK_SCHEMES` in
 * `backend/src/common/html-to-markdown.ts`, and refuses a write with a link of another scheme: a
 * spec of the server (`rich-text-html-rule.spec.ts`) reads this file and compares the two lists.
 * That spec reads the list below as written: keep it one plain list of names.
 */
export const RICH_TEXT_LINK_SCHEMES = ['http', 'https', 'mailto', 'tel'] as const;

const LINK_SCHEME_REGEX = new RegExp(`^(?:${RICH_TEXT_LINK_SCHEMES.join('|')}):`, 'i');

/**
 * The address a link of a rich text opens: an address with a scheme of `RICH_TEXT_LINK_SCHEMES`,
 * a path of the application or an anchor of the page, in the editor and in the reading view of a
 * rich text (`MarkdownContent`). Null for any other address: it shows as text.
 */
export function richTextLinkAddress(url: string | null | undefined): string | null {
  const address = String(url ?? '').trim();
  if (LINK_SCHEME_REGEX.test(address) || address.startsWith('/') || address.startsWith('#')) return address;
  return null;
}
