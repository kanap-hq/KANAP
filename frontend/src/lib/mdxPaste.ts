import { matchRichTextHtmlTag } from './richTextHtmlElements';

// The line that opens a fenced block: the fence may sit in a list item or a quote, at any indent.
const FENCE_OPENING_REGEX = /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])[ \t])*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSING_REGEX = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/;
// What may be an automatic link: no space and no angle bracket between its angle brackets.
const AUTOLINK_CANDIDATE_REGEX = /<([^\s<>]+)>/y;
// A link destination between angle brackets, with its optional title, up to the closing parenthesis.
const ANGLE_BRACKET_DESTINATION_REGEX = /<[^<>\n]*>(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)/y;

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

/**
 * Finds the run of exactly `length` backticks that closes a code span, in its paragraph: its index,
 * or -1. A search that finds nothing reads its paragraph to the end once: it keeps the last run of
 * each length it met, and the next searches of the same paragraph answer from that.
 */
function createClosingBacktickRunFinder(text: string): (from: number, length: number) => number {
  let paragraphEnd = -1;
  let lastRunByLength = new Map<number, number>();

  return (from, length) => {
    if (from < paragraphEnd && (lastRunByLength.get(length) ?? -1) < from) return -1;

    const met = new Map<number, number>();
    let index = from;
    for (; index < text.length; index += 1) {
      if (text[index] === '\n' && isBlankLineAhead(text, index)) break;
      if (text[index] !== '`') continue;
      let end = index;
      while (text[end] === '`') end += 1;
      if (end - index === length) return index;
      met.set(end - index, index);
      index = end - 1;
    }
    paragraphEnd = index;
    lastRunByLength = met;
    return -1;
  };
}

function stashInlineCodeSpans(text: string): { text: string; spans: string[] } {
  const spans: string[] = [];
  const findClosingBacktickRun = createClosingBacktickRunFinder(text);
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
    const closingIndex = findClosingBacktickRun(runEnd, length);

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
  if (text[index - 1] !== '(' || text[index - 2] !== ']') return false;
  ANGLE_BRACKET_DESTINATION_REGEX.lastIndex = index;
  return ANGLE_BRACKET_DESTINATION_REGEX.test(text);
}

/**
 * The Markdown link of an automatic link, from the text between its angle brackets: a web
 * address, a mail address with or without its scheme. Null for anything else, which is text.
 */
function autolinkAsMarkdownLink(target: string): string | null {
  if (/^(?:https?:\/\/|mailto:)./i.test(target)) return `[${target}](${target})`;
  // An e-mail address: a name without a scheme, an at sign, then a domain with a dot inside it.
  const at = target.indexOf('@');
  if (at < 1 || target.lastIndexOf(':', at) !== -1) return null;
  const dot = target.indexOf('.', at + 2);
  return dot !== -1 && dot < target.length - 1 ? `[${target}](mailto:${target})` : null;
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

  // The result, in pieces: the text between two rewritten places is copied as it is.
  const pieces: string[] = [];
  let copiedTo = 0;
  const rewrite = (index: number, length: number, piece: string) => {
    if (index > copiedTo) pieces.push(sanitizedBase.slice(copiedTo, index));
    pieces.push(piece);
    copiedTo = index + length;
  };
  // Kept opening tags that wait for their closing tag, with their piece of the result. The editor
  // reads a tag as an element only when it is closed in its own paragraph, in order: a tag that
  // is not stays text.
  const openTags: Array<{ name: string; piece: number }> = [];
  const escapeOpenTags = () => {
    for (const { piece } of openTags) pieces[piece] = `\\${pieces[piece]}`;
    openTags.length = 0;
  };

  for (let index = 0; index < sanitizedBase.length; index += 1) {
    const current = sanitizedBase[index];
    if (current === '\n' && openTags.length > 0 && isBlankLineAhead(sanitizedBase, index)) {
      escapeOpenTags();
    }
    if (current !== '<' || shouldSkipAngleBracketSanitization(sanitizedBase, index)) continue;

    AUTOLINK_CANDIDATE_REGEX.lastIndex = index;
    const autolink = AUTOLINK_CANDIDATE_REGEX.exec(sanitizedBase);
    const link = autolink ? autolinkAsMarkdownLink(autolink[1]) : null;
    if (autolink && link) {
      rewrite(index, autolink[0].length, link);
      index += autolink[0].length - 1;
      continue;
    }

    const element = keepRichTextElements ? matchRichTextHtmlTag(sanitizedBase, index) : null;
    const closesOpenTag = element?.closing && openTags[openTags.length - 1]?.name === element.name;
    if (element && (!element.closing || closesOpenTag)) {
      rewrite(index, element.length, element.tag);
      if (closesOpenTag) {
        openTags.pop();
      } else if (element.name !== 'br' && element.name !== 'img') {
        openTags.push({ name: element.name, piece: pieces.length - 1 });
      }
      index += element.length - 1;
      continue;
    }

    // The editor reads a less-than sign as text only before a space or a tab of its line.
    const next = sanitizedBase[index + 1];
    if (next !== ' ' && next !== '\t') {
      rewrite(index, 1, '\\<');
    }
  }

  escapeOpenTags();
  pieces.push(sanitizedBase.slice(copiedTo));
  const result = pieces.join('');

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
