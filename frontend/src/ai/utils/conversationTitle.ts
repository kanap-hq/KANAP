// Keep in sync with backend/src/ai/ai-conversation-title.util.ts.

/**
 * Plain text for a conversation title: the label of a Markdown link, the alt text of an
 * image, no address and no emphasis, heading or quote marks. Titles stored before the
 * server did this conversion may end inside a link (they were cut at 100 characters):
 * an unterminated link or image keeps its label too.
 */
export function plainConversationTitle(text: string): string {
  return text
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)?/g, '$1')
    .replace(/!?\[([^\]\n]*)$/, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
