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

const NAME_IN_TEXT_MAX_LENGTH = 60;

/**
 * A conversation title quoted inside a sentence (the delete dialog title): its plain text, cut
 * at a word with an ellipsis past 60 characters, as the list cuts it on one line.
 */
export function conversationNameInText(text: string): string {
  const plain = plainConversationTitle(text);
  if (plain.length <= NAME_IN_TEXT_MAX_LENGTH) return plain;
  const cut = plain.slice(0, NAME_IN_TEXT_MAX_LENGTH + 1);
  const space = cut.lastIndexOf(' ');
  const kept = space > NAME_IN_TEXT_MAX_LENGTH / 2 ? cut.slice(0, space) : cut.slice(0, NAME_IN_TEXT_MAX_LENGTH);
  return `${kept.replace(/[\s.,;:!?…]+$/, '')}…`;
}
