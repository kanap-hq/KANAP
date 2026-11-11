import { matchRichTextHtmlTag } from './richTextHtmlElements';

// The line that opens a fenced block: the fence may sit in a list item or a quote, at any indent.
const FENCE_OPENING_REGEX = /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])[ \t])*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSING_REGEX = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/;
const URI_AUTOLINK_REGEX = /^<([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s>]+)>/;
const EMAIL_AUTOLINK_REGEX = /^<([^\s>@]+@[^\s>]+\.[^\s>]+)>/;
// A link destination between angle brackets, with its optional title, up to the closing parenthesis.
const ANGLE_BRACKET_DESTINATION_REGEX = /^<[^<>\n]*>(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)/;

function isEscaped(text: string, index: number): boolean {
  let backslashCount = 0;
  for (let current = index - 1; current >= 0 && text[current] === '\\'; current -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

/**
 * Takes the fenced blocks out of the text, line by line: a block runs from its opening fence to a
 * line that holds only a fence of the same character, at least as long, or to the end of the text.
 */
function stashFencedCodeBlocks(text: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const lines: string[] = [];
  let open: { mark: string; length: number; lines: string[] } | null = null;
  const closeBlock = (block: string[]) => {
    lines.push(`\x00CB${blocks.length}\x00`);
    blocks.push(block.join('\n'));
  };

  for (const line of text.split('\n')) {
    if (open) {
      open.lines.push(line);
      const closing = line.match(FENCE_CLOSING_REGEX)?.[1];
      if (closing && closing[0] === open.mark && closing.length >= open.length) {
        closeBlock(open.lines);
        open = null;
      }
      continue;
    }
    const opening = line.match(FENCE_OPENING_REGEX);
    // A fence of backticks has no backtick after it on its line.
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      open = { mark: opening[1][0], length: opening[1].length, lines: [line] };
    } else {
      lines.push(line);
    }
  }
  if (open) closeBlock(open.lines);

  return { text: lines.join('\n'), blocks };
}

/** The index of the run of exactly `length` backticks that closes a code span, in its paragraph, or -1. */
function findClosingBacktickRun(text: string, from: number, length: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '\n' && isBlankLineAhead(text, index)) return -1;
    if (text[index] !== '`') continue;
    let end = index;
    while (text[end] === '`') end += 1;
    if (end - index === length) return index;
    index = end - 1;
  }
  return -1;
}

function stashInlineCodeSpans(text: string): { text: string; spans: string[] } {
  const spans: string[] = [];
  let result = '';

  for (let index = 0; index < text.length;) {
    if (text[index] !== '`') {
      result += text[index];
      index += 1;
      continue;
    }

    let runEnd = index;
    while (text[runEnd] === '`') {
      runEnd += 1;
    }
    const length = runEnd - index;
    const closingIndex = findClosingBacktickRun(text, runEnd, length);

    // A run of backticks that nothing closes in its paragraph is text.
    if (closingIndex < 0) {
      result += text.slice(index, runEnd);
      index = runEnd;
      continue;
    }

    const token = `\x00IC${spans.length}\x00`;
    spans.push(text.slice(index, closingIndex + length));
    result += token;
    index = closingIndex + length;
  }

  return { text: result, spans };
}

function restorePlaceholders(text: string, tokens: string[], prefix: 'CB' | 'IC'): string {
  return text.replace(new RegExp(`\\x00${prefix}(\\d+)\\x00`, 'g'), (_match, index) => {
    return tokens[Number(index)] || '';
  });
}

function shouldSkipAngleBracketSanitization(text: string, index: number): boolean {
  if (isEscaped(text, index)) {
    return true;
  }

  // The destination of a link or an image written between angle brackets: `[text](<address>)`.
  return text.slice(Math.max(0, index - 2), index) === '](' && ANGLE_BRACKET_DESTINATION_REGEX.test(text.slice(index));
}

function isBlankLineAhead(text: string, lineEndIndex: number): boolean {
  let index = lineEndIndex + 1;
  while (text[index] === ' ' || text[index] === '\t') index += 1;
  return text[index] === '\n';
}

export function hasPotentiallyUnsafeMdxPaste(text: string): boolean {
  return /<\S/.test(String(text || ''));
}

/**
 * Escapes every less-than sign the editor would read as the start of a tag, outside code, and
 * writes an automatic link as a Markdown link. With `keepRichTextElements`, the tags of
 * `RICH_TEXT_HTML_ELEMENTS` are left for the editor to read as elements.
 */
export function sanitizeMarkdownForMdxPaste(
  markdown: string,
  { keepRichTextElements = false }: { keepRichTextElements?: boolean } = {},
): string {
  const { text: withoutFences, blocks: fencedCodeBlocks } = stashFencedCodeBlocks(String(markdown || ''));
  const { text: sanitizedBase, spans: inlineCodeSpans } = stashInlineCodeSpans(withoutFences);

  let result = '';
  // Kept opening tags that wait for their closing tag, with their place in `result`. The editor
  // reads a tag as an element only when it is closed in its own paragraph, in order: a tag that
  // is not stays text.
  const openTags: Array<{ name: string; at: number }> = [];
  const escapeOpenTags = () => {
    while (openTags.length > 0) {
      const { at } = openTags.pop()!;
      result = `${result.slice(0, at)}\\${result.slice(at)}`;
    }
  };

  for (let index = 0; index < sanitizedBase.length;) {
    const current = sanitizedBase[index];
    if (current === '\n' && openTags.length > 0 && isBlankLineAhead(sanitizedBase, index)) {
      escapeOpenTags();
    }
    if (current !== '<' || shouldSkipAngleBracketSanitization(sanitizedBase, index)) {
      result += current;
      index += 1;
      continue;
    }

    const remaining = sanitizedBase.slice(index);
    const uriMatch = remaining.match(URI_AUTOLINK_REGEX);
    if (uriMatch) {
      const target = uriMatch[1];
      result += `[${target}](${target})`;
      index += uriMatch[0].length;
      continue;
    }

    const emailMatch = remaining.match(EMAIL_AUTOLINK_REGEX);
    if (emailMatch) {
      const email = emailMatch[1];
      result += `[${email}](mailto:${email})`;
      index += emailMatch[0].length;
      continue;
    }

    const element = keepRichTextElements ? matchRichTextHtmlTag(remaining) : null;
    const closesOpenTag = element?.closing && openTags[openTags.length - 1]?.name === element.name;
    if (element && (!element.closing || closesOpenTag)) {
      if (closesOpenTag) {
        openTags.pop();
      } else if (element.name !== 'br' && element.name !== 'img') {
        openTags.push({ name: element.name, at: result.length });
      }
      result += element.tag;
      index += element.length;
      continue;
    }

    if (sanitizedBase[index + 1] && !/\s/.test(sanitizedBase[index + 1])) {
      result += '\\<';
      index += 1;
      continue;
    }

    result += current;
    index += 1;
  }

  escapeOpenTags();

  return restorePlaceholders(restorePlaceholders(result, inlineCodeSpans, 'IC'), fencedCodeBlocks, 'CB');
}

/**
 * The form in which the editor is given a stored text to read: what it shows is what the text
 * says. A tag outside `RICH_TEXT_HTML_ELEMENTS` shows as text. `plain` shows the accepted tags as
 * text too, for a text whose accepted tags the editor cannot read (never closed, closed in the
 * wrong order). This form is only for the editor: the stored text changes when a person edits it.
 */
export function toEditorDisplayMarkdown(markdown: string, { plain = false }: { plain?: boolean } = {}): string {
  return sanitizeMarkdownForMdxPaste(markdown, { keepRichTextElements: !plain });
}
