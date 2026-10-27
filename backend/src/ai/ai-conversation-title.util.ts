// Keep the conversion in sync with frontend/src/ai/utils/conversationTitle.ts, which cleans
// the titles stored before this helper existed.

const CONVERSATION_TITLE_MAX_LENGTH = 100;

/**
 * Title of a conversation from its first message: plain text (the label of a Markdown link,
 * the alt text of an image, no address and no emphasis, heading or quote marks), cut at 100
 * characters after the conversion so that a link is never cut in the middle.
 */
export function conversationTitleFromMessage(message: string): string {
  return message
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)?/g, '$1')
    .replace(/!?\[([^\]\n]*)$/, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CONVERSATION_TITLE_MAX_LENGTH)
    .trim();
}
