import { RICH_TEXT_HTML_ELEMENTS, isRichTextImageAttribute } from './richTextHtmlElements';

const FENCED_CODE_BLOCK_REGEX = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1\s*$/gm;
const URI_AUTOLINK_REGEX = /^<([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s>]+)>/;
const EMAIL_AUTOLINK_REGEX = /^<([^\s>@]+@[^\s>]+\.[^\s>]+)>/;
const BLANK_LINE_REGEX = /\n[ \t]*\n/;
// A link destination between angle brackets, with its optional title, up to the closing parenthesis.
const ANGLE_BRACKET_DESTINATION_REGEX = /^<[^<>\n]*>(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)/;
// An opening, closing or self-closed tag of an element accepted without attribute.
const BARE_ELEMENT_TAG_REGEX = new RegExp(`^<(/?)(${RICH_TEXT_HTML_ELEMENTS.bare.join('|')})[ \\t]*(/?)>`);
// An image tag on one line whose attributes all have a quoted value.
const IMAGE_TAG_REGEX = /^<img((?:[ \t]+[A-Za-z][\w:.-]*=(?:"[^"\n]*"|'[^'\n]*'))+)[ \t]*\/?>/;
const IMAGE_ATTRIBUTE_REGEX = /([A-Za-z][\w:.-]*)=(?:"([^"\n]*)"|'([^'\n]*)')/g;

function isEscaped(text: string, index: number): boolean {
  let backslashCount = 0;
  for (let current = index - 1; current >= 0 && text[current] === '\\'; current -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
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

    let fenceEnd = index;
    while (text[fenceEnd] === '`') {
      fenceEnd += 1;
    }
    const fence = text.slice(index, fenceEnd);
    const closingIndex = text.indexOf(fence, fenceEnd);

    // A code span ends with its paragraph: a lone backtick does not reach one of a later paragraph.
    if (closingIndex < 0 || BLANK_LINE_REGEX.test(text.slice(fenceEnd, closingIndex))) {
      result += text[index];
      index += 1;
      continue;
    }

    const token = `\x00IC${spans.length}\x00`;
    spans.push(text.slice(index, closingIndex + fence.length));
    result += token;
    index = closingIndex + fence.length;
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

/**
 * The tag at the start of `text` when it is one of `RICH_TEXT_HTML_ELEMENTS` in its accepted form,
 * written the way the editor reads it (a line break and an image are closed tags).
 */
function matchRichTextElementTag(
  text: string,
): { length: number; tag: string; name: string; closing: boolean } | null {
  const bare = text.match(BARE_ELEMENT_TAG_REGEX);
  if (bare) {
    const [whole, slash, name, selfClosed] = bare;
    const closing = slash !== '';
    if (name === 'br') return closing ? null : { length: whole.length, tag: '<br />', name, closing };
    return selfClosed ? null : { length: whole.length, tag: `<${slash}${name}>`, name, closing };
  }

  const image = text.match(IMAGE_TAG_REGEX);
  if (!image) return null;
  let hasSource = false;
  for (const [, name, doubleQuoted, singleQuoted] of image[1].matchAll(IMAGE_ATTRIBUTE_REGEX)) {
    if (!isRichTextImageAttribute(name, doubleQuoted ?? singleQuoted ?? '')) return null;
    if (name === 'src') hasSource = true;
  }
  return hasSource ? { length: image[0].length, tag: `<img${image[1]} />`, name: 'img', closing: false } : null;
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
  const fencedCodeBlocks: string[] = [];
  const withoutFences = String(markdown || '').replace(FENCED_CODE_BLOCK_REGEX, (match) => {
    const token = `\x00CB${fencedCodeBlocks.length}\x00`;
    fencedCodeBlocks.push(match);
    return token;
  });
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

    const element = keepRichTextElements ? matchRichTextElementTag(remaining) : null;
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
