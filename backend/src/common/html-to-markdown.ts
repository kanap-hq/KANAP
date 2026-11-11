import { marked } from 'marked';
import TurndownService = require('turndown');
import { containsInlineDataImageText, withoutDataImagePayloads } from './markdown-limits';

/**
 * HTML and Markdown conversions with the Markdown parser and turndown. Runs in
 * the Markdown workers: the API calls these functions through markdown-worker.ts,
 * which bounds their time.
 */

const HTML_TAG_REGEX_FALLBACK = /<\/?(p|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|a|img|table|thead|tbody|tr|td|th|div|span|br|hr|mark|u)\b[^>]*>/i;
const MARKDOWN_AUTOLINK_REGEX_FALLBACK = /^<https?:\/\/[^>\s]+>$/i;

/**
 * The only HTML tags a rich-text field accepts on a write. Everything else in the
 * text is Markdown. These are the forms the editor writes, in lower case:
 * - `paired`: an opening and a closing tag, without any attribute (`<u>`, `</u>`);
 * - `lineBreak`: `<br>`, `<br/>` or `<br />`, without any attribute;
 * - `imageAttributes`: an `<img>` tag on one line with these attributes only, each
 *   with a quoted value, and a source that is a path of the application or an
 *   `http(s)` address; a width and a height are whole numbers.
 * The editor holds the same list, `RICH_TEXT_HTML_ELEMENTS` in
 * `frontend/src/lib/richTextHtmlElements.ts`, and shows any other tag as text. A
 * change of one list is made in the other: `rich-text-html-rule.spec.ts` reads the
 * editor's file and compares the two lists, and the test of each side keeps a copy
 * of the accepted and refused forms.
 */
export const RICH_TEXT_ALLOWED_HTML = {
  paired: ['u', 'sub', 'sup'],
  lineBreak: 'br',
  imageAttributes: ['src', 'alt', 'title', 'width', 'height'],
} as const;

/**
 * The schemes of the addresses a link opens, in lower case. An image opens the same addresses
 * without the phone number. The editor holds the same list, `RICH_TEXT_LINK_SCHEMES` in
 * `frontend/src/lib/richTextLinkAddress.ts`, and shows a link of another scheme as text:
 * `rich-text-html-rule.spec.ts` reads the editor's file and compares the two lists.
 */
export const RICH_TEXT_LINK_SCHEMES = ['http', 'https', 'mailto', 'tel'] as const;

const schemeRegex = (schemes: readonly string[]) => new RegExp(`^(?:${schemes.join('|')}):`, 'i');
const LINK_SCHEME_REGEX = schemeRegex(RICH_TEXT_LINK_SCHEMES);
const IMAGE_SCHEME_REGEX = schemeRegex(RICH_TEXT_LINK_SCHEMES.filter((scheme) => scheme !== 'tel'));

const PAIRED_TAG_REGEX = new RegExp(`^</?(?:${RICH_TEXT_ALLOWED_HTML.paired.join('|')})>$`);
const LINE_BREAK_TAG_REGEX = new RegExp(`^<${RICH_TEXT_ALLOWED_HTML.lineBreak}(?: ?/)?>$`);
// An image tag on one line whose attributes all have a quoted value.
const IMAGE_TAG_REGEX = /^<img((?:[ \t]+[a-z]+=(?:"[^"\n]*"|'[^'\n]*'))+)[ \t]*\/?>$/;
const IMAGE_ATTRIBUTE_REGEX = /([a-z]+)=(?:"([^"\n]*)"|'([^'\n]*)')/g;
const ALLOWED_IMG_ATTRS = new Set<string>(RICH_TEXT_ALLOWED_HTML.imageAttributes);
const DATA_IMAGE_URI_REGEX = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: '\'',
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

type MarkdownToken = {
  type?: string;
  raw?: string;
  text?: string;
  [key: string]: unknown;
};

function normalizeSnippet(value: unknown): string {
  return String(value ?? '').trim();
}

function decodeHtmlEntities(text: string): string {
  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity || '').toLowerCase();
    if (HTML_ENTITY_MAP[key]) {
      return HTML_ENTITY_MAP[key];
    }
    if (key.startsWith('#x')) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }
    if (key.startsWith('#')) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }
    return match;
  });
}

/** An image is served by a web address or by a path of the application. */
function isAllowedImageSrc(value: string): boolean {
  const src = String(value || '').trim();
  return /^https?:\/\//i.test(src) || src.startsWith('/');
}

/** Whether `<img>` may carry this attribute with this value. */
function isAllowedImageAttribute(name: string, value: string): boolean {
  if (!ALLOWED_IMG_ATTRS.has(name)) return false;
  if (name === 'src') return isAllowedImageSrc(value);
  if (name === 'width' || name === 'height') return /^\d{1,5}$/.test(value);
  return true;
}

/**
 * Whether a link, or an image, may have this address: an address with a scheme of
 * `RICH_TEXT_LINK_SCHEMES` (an image has no phone number), or an address without a scheme (a
 * path, a query, an anchor). An address whose first segment holds a colon, or a character
 * reference that may stand for one, has a scheme.
 */
function isAllowedLinkAddress(value: string, image = false): boolean {
  const address = String(value || '').trim().replace(/\\([!-/:-@[-`{-~])/g, '$1');
  if ((image ? IMAGE_SCHEME_REGEX : LINK_SCHEME_REGEX).test(address)) return true;
  // Up to the first "/" or "?", without its anchor (a "#" after "&" starts a character reference).
  const firstSegment = (/^[^/?]*/.exec(address)?.[0] ?? '').replace(/(?<!&)#.*$/s, '');
  return !/:|&(?:#x?[0-9a-f]+|[a-z][a-z0-9]*);/i.test(firstSegment);
}

function isDataImageUri(value: string): boolean {
  return DATA_IMAGE_URI_REGEX.test(String(value || '').trim());
}

function hasDataImageInHtmlSnippet(snippet: string): boolean {
  const value = normalizeSnippet(snippet);
  if (!value || !/<img\b/i.test(value)) return false;
  const imgRegex = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(value)) !== null) {
    const src = match[2] ?? match[3] ?? '';
    if (isDataImageUri(src)) return true;
  }
  return false;
}

/** Whether `value` is one tag of `RICH_TEXT_ALLOWED_HTML`, in its accepted form. */
export function isAllowedMarkdownHtmlSnippet(value: string): boolean {
  const snippet = normalizeSnippet(value);
  if (!snippet) return false;
  if (PAIRED_TAG_REGEX.test(snippet) || LINE_BREAK_TAG_REGEX.test(snippet)) return true;
  const image = IMAGE_TAG_REGEX.exec(snippet);
  if (!image) return false;

  let hasSource = false;
  for (const [, name, doubleQuoted, singleQuoted] of image[1].matchAll(IMAGE_ATTRIBUTE_REGEX)) {
    if (!isAllowedImageAttribute(name, doubleQuoted ?? singleQuoted ?? '')) return false;
    if (name === 'src') hasSource = true;
  }
  return hasSource;
}

function parseTokens(content: string): MarkdownToken[] | null {
  try {
    // Inline image payloads are not parsed (see withoutDataImagePayloads).
    return marked.lexer(withoutDataImagePayloads(content), { gfm: true, breaks: true }) as MarkdownToken[];
  } catch {
    return null;
  }
}

function getRootHtmlSnippets(tokens: MarkdownToken[]): string[] {
  return tokens
    .filter((token) => token.type && token.type !== 'space')
    .filter((token) => token.type === 'html')
    .map((token) => normalizeSnippet(token.raw ?? token.text ?? ''))
    .filter(Boolean);
}

function isLegacyHtmlFromTokens(tokens: MarkdownToken[]): boolean {
  const significant = tokens.filter((token) => token.type && token.type !== 'space');
  if (significant.length === 0) return false;
  if (!significant.every((token) => token.type === 'html')) return false;
  const snippets = getRootHtmlSnippets(significant);
  if (snippets.length === 0) return false;
  if (snippets.every((snippet) => isAllowedMarkdownHtmlSnippet(snippet))) return false;
  return true;
}

/**
 * Visits every token of a parsed text: the tokens of a list, of a quote, of a table
 * and of its cells (a cell is an object without a type), down to the inline ones.
 *
 * Text shown as code holds no tag: a fenced block and an inline code span are not
 * entered. An indented block is read as prose: readers of the same text that do not
 * know indented code would read its tags.
 */
function walkMarkedToken(value: unknown, visit: (token: MarkdownToken) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const child of value) walkMarkedToken(child, visit);
    return;
  }

  const token = value as MarkdownToken;
  if (typeof token.type === 'string') {
    visit(token);
    if (token.type === 'codespan') return;
    if (token.type === 'code') {
      if (token.codeBlockStyle !== 'indented') return;
      // Read again without any indent, in one pass: the parser takes one level off at a time.
      const prose = String(token.text ?? '').replace(/^[ \t]+/gm, '');
      // A block the parser cannot read again is checked as a whole, like the text of a tag.
      walkMarkedToken(parseTokens(prose) ?? [{ type: 'html', raw: prose }], visit);
      return;
    }
  }

  for (const nested of Object.values(token)) {
    walkMarkedToken(nested, visit);
  }
}

/**
 * The first tag outside `RICH_TEXT_ALLOWED_HTML` in the text of an HTML token, or
 * null. A tag starts at a "<" followed by a letter, "/", "!" or "?" and ends at the
 * next ">" outside quotes; one left open is refused. One pass over the text.
 */
function firstRefusedHtmlTag(raw: string): string | null {
  let index = 0;
  while (index < raw.length) {
    const start = raw.indexOf('<', index);
    if (start === -1) return null;
    if (!/[A-Za-z/!?]/.test(raw.charAt(start + 1))) {
      index = start + 1;
      continue;
    }
    let end = start + 1;
    let quote = '';
    for (; end < raw.length; end += 1) {
      const char = raw[end];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === '\'') {
        quote = char;
      } else if (char === '>') {
        break;
      }
    }
    if (end >= raw.length) return raw.slice(start);
    const tag = raw.slice(start, end + 1);
    if (!isAllowedMarkdownHtmlSnippet(tag)) return tag;
    index = end + 1;
  }
  return null;
}

// The start of a tag of the list in a text the parser read as prose: the name, then a
// space, "/", "{", ">" or the end of the text.
const LISTED_TAG_START_REGEX = new RegExp(
  `</?(?:${[...RICH_TEXT_ALLOWED_HTML.paired, RICH_TEXT_ALLOWED_HTML.lineBreak, 'img'].join('|')})(?=[\\s/{>]|$)`,
);

/**
 * The start of a tag of the list left in prose, up to its ">" when it has one, or null.
 * The parser reads a tag of the list in its accepted form as an HTML token: one it left in
 * prose is written in another form (`<u $name="…">`), which a reader of the same text that
 * takes more forms of attributes would read as a tag.
 */
function firstListedTagInProse(raw: string): string | null {
  const start = raw.search(LISTED_TAG_START_REGEX);
  if (start === -1) return null;
  const end = raw.indexOf('>', start);
  return end === -1 ? raw.slice(start) : raw.slice(start, end + 1);
}

/**
 * The text of a link definition where a tag may sit: its label and its title, without what a
 * backslash makes text. Its address between angle brackets is no tag. A definition whose label
 * starts with "^" is a note for the readers that know notes: its whole text counts.
 */
function definitionText(token: MarkdownToken): string {
  const raw = String(token.raw ?? '');
  const text = String(token.tag ?? '').startsWith('^')
    ? raw
    : raw.replace(/^(\s*\[(?:\\.|[^\]\\])*\]:\s*)<[^<>\n]*>/, '$1');
  return text.replace(/\\[!-/:-@[-`{-~]/g, '');
}

/** What a write refuses in a text, as it is written; `address` is set for a link, an image or a link definition refused for its address. */
type RefusedContent = { written: string; address: boolean };

/**
 * What a parsed text holds that a write refuses, one entry per token, each once: a tag outside
 * `RICH_TEXT_ALLOWED_HTML`, in the text of a link definition too, and a link, an image or a
 * link definition whose address is neither one of `RICH_TEXT_LINK_SCHEMES` nor a relative one
 * (`isAllowedLinkAddress`), as it is written.
 */
function collectRefusedContent(tokens: MarkdownToken[]): RefusedContent[] {
  const refused: RefusedContent[] = [];
  const seen = new Set<string>();

  walkMarkedToken(tokens, (current) => {
    let tag: string | null = null;
    let address = false;
    if (current.type === 'html') {
      tag = firstRefusedHtmlTag(String(current.raw ?? current.text ?? ''));
    } else if (current.type === 'text' && !Array.isArray(current.tokens)) {
      tag = firstListedTagInProse(String(current.raw ?? ''));
    } else if (current.type === 'link' || current.type === 'image' || current.type === 'def') {
      const href = String(current.href ?? '');
      const written = String(current.raw ?? href).trim();
      // An address written in a sentence, without brackets, is text. An inline base64 image has
      // its own refusal (`tokensContainDataImage`).
      const checked = /^[[!<]/.test(written) && !(current.type === 'image' && isDataImageUri(href));
      address = checked && !isAllowedLinkAddress(href, current.type === 'image');
      if (address) tag = written;
      else if (current.type === 'def') tag = firstRefusedHtmlTag(definitionText(current));
    }
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    refused.push({ written: tag, address });
  });

  return refused;
}

function collectRefusedHtml(tokens: MarkdownToken[]): string[] {
  return collectRefusedContent(tokens).map((content) => content.written);
}

/**
 * Whether the text holds one of the known HTML tags. The test runs on the text up
 * to its last ">", so every candidate tag has a closing ">" ahead of it and the
 * first candidate matches at once (linear time).
 */
function hasHtmlTagText(text: string): boolean {
  const lastClose = text.lastIndexOf('>');
  if (lastClose === -1) return false;
  return HTML_TAG_REGEX_FALLBACK.test(text.slice(0, lastClose + 1));
}

/** For a text the parser could not read: every tag of the text counts, code included. */
function findRefusedHtmlInText(text: string): string[] {
  const tag = firstRefusedHtmlTag(text);
  return tag ? [tag] : [];
}

/** The HTML tags of a Markdown content that a rich-text write refuses (see `RICH_TEXT_ALLOWED_HTML`). */
export function findRefusedHtml(content: string): string[] {
  const text = String(content || '').trim();
  if (!text) return [];

  const tokens = parseTokens(text);
  return tokens ? collectRefusedHtml(tokens) : findRefusedHtmlInText(text);
}

// What stays as written in prose: a tag of the list in its accepted form (an image is
// checked with its attributes), an automatic link, an automatic e-mail link.
const KEPT_IN_PROSE_REGEX = new RegExp(
  [
    `</?(?:${RICH_TEXT_ALLOWED_HTML.paired.join('|')})>`,
    `<${RICH_TEXT_ALLOWED_HTML.lineBreak}(?: ?/)?>`,
    IMAGE_TAG_REGEX.source.slice(1, -1),
    '<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\\s<>]*>',
    '<[^\\s<>@]+@[^\\s<>]+>',
  ].join('|'),
  'y',
);
const FENCE_OPENING_REGEX = /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])[ \t])*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSING_REGEX = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/;

/** The index of the run of exactly `length` backticks that closes a code span opened before `from`, or -1. */
function closingBacktickRun(text: string, from: number, length: number): number {
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\n') {
      // A code span ends with its paragraph.
      let next = index + 1;
      while (text[next] === ' ' || text[next] === '\t') next += 1;
      if (next >= text.length || text[next] === '\n') return -1;
    }
    if (char !== '`') continue;
    let end = index;
    while (text[end] === '`') end += 1;
    if (end - index === length) return index;
    index = end - 1;
  }
  return -1;
}

/** Puts a backslash before each "<" of `prose` that starts a tag, outside its inline code spans. */
function escapeTagsInProse(prose: string): string {
  let result = '';
  let index = 0;
  while (index < prose.length) {
    const char = prose[index];
    if (char === '\\') {
      result += prose.slice(index, index + 2);
      index += 2;
    } else if (char === '`') {
      let end = index;
      while (prose[end] === '`') end += 1;
      const closing = closingBacktickRun(prose, end, end - index);
      const next = closing === -1 ? end : closing + (end - index);
      result += prose.slice(index, next);
      index = next;
    } else if (char === '<' && /[A-Za-z/!?]/.test(prose.charAt(index + 1))) {
      KEPT_IN_PROSE_REGEX.lastIndex = index;
      const kept = KEPT_IN_PROSE_REGEX.exec(prose)?.[0];
      if (kept && (!kept.startsWith('<img') || isAllowedMarkdownHtmlSnippet(kept))) {
        result += kept;
        index += kept.length;
      } else {
        result += '\\<';
        index += 1;
      }
    } else {
      result += char;
      index += 1;
    }
  }
  return result;
}

/** `escapeTagsInProse` on the text outside its fenced blocks, which are found line by line. */
function escapeTagsOutsideCode(text: string): string {
  const parts: string[] = [];
  let prose: string[] = [];
  let fence: { mark: string; length: number } | null = null;
  const endProse = () => {
    if (prose.length > 0) parts.push(escapeTagsInProse(prose.join('\n')));
    prose = [];
  };

  for (const line of text.split('\n')) {
    if (fence) {
      parts.push(line);
      const closing = FENCE_CLOSING_REGEX.exec(line)?.[1];
      if (closing && closing[0] === fence.mark && closing.length >= fence.length) fence = null;
      continue;
    }
    const opening = FENCE_OPENING_REGEX.exec(line);
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      endProse();
      parts.push(line);
      fence = { mark: opening[1][0], length: opening[1].length };
    } else {
      prose.push(line);
    }
  }
  endProse();
  return parts.join('\n');
}

/**
 * The same text with every tag outside `RICH_TEXT_ALLOWED_HTML` written as text: a
 * backslash goes before its "<", and nothing is removed. For a text read from another
 * system, which nobody is there to correct. Code keeps its text, and a text that is
 * rewritten takes Unix line ends. When the parser still
 * reads a tag (it does not cut the code where the scan does), every "<" that starts a
 * tag takes the backslash, in code too.
 */
export function escapeRefusedHtml(content: string): string {
  const written = String(content || '');
  if (findRefusedHtml(written).length === 0) return written;
  // Rewritten with Unix line ends, as the parser reads a text: a line that ends a fence ends there.
  const text = written.replace(/\r\n?/g, '\n');
  const escapeEvery = (marks: RegExp) => text.replace(marks, (match, backslashes: string, mark: string) => (
    backslashes.length % 2 === 1 ? match : `${backslashes}\\${mark}`
  ));
  for (const candidate of [escapeTagsOutsideCode(text), escapeEvery(/(\\*)(<)(?=[A-Za-z/!?])/g)]) {
    const escaped = escapeOtherAddresses(candidate);
    if (findRefusedHtml(escaped).length === 0) return escaped;
  }
  return escapeEvery(/(\\*)(<(?=[A-Za-z/!?])|\[)/g);
}

/**
 * The same text with every link, image and link definition the rule refuses for its address
 * written as text: its opening bracket takes a backslash. A link by reference follows its
 * definition, so the text is read again until nothing is left, three times at most.
 */
function escapeOtherAddresses(text: string): string {
  let escaped = text;
  for (let round = 0; round < 3; round += 1) {
    // As written: `[text](address)`, `![text](address)`, `[label]: address`, `<address>`.
    const refused = findRefusedHtml(escaped).filter((written) => /^!?\[|^<[^\s<>]*[:@][^\s<>]*>$/.test(written));
    if (refused.length === 0) break;
    for (const written of refused) {
      escaped = escaped.split(written).join(written.replace(/[[<]/, '\\$&'));
    }
  }
  return escaped;
}

function tokensContainDataImage(tokens: MarkdownToken[]): boolean {
  let found = false;
  walkMarkedToken(tokens, (current) => {
    if (found) return;
    if (current.type === 'image') {
      const href = String((current as any).href ?? '').trim();
      if (isDataImageUri(href)) {
        found = true;
      }
      return;
    }
    if (current.type === 'html') {
      const snippet = normalizeSnippet(current.raw ?? current.text ?? '');
      if (hasDataImageInHtmlSnippet(snippet)) {
        found = true;
      }
    }
  });
  return found;
}

export function containsInlineDataImage(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return false;

  const tokens = parseTokens(text);
  return tokens ? tokensContainDataImage(tokens) : containsInlineDataImageText(text);
}

/**
 * What a write refuses in a Markdown content and its inline base64 images, from a single parse:
 * `refusedHtml` holds everything refused, in the order of the text, and `refusedAddresses` those
 * of its entries that are a link or an image refused for its address.
 */
export function inspectMarkdownContent(
  content: string,
): { refusedHtml: string[]; refusedAddresses: string[]; hasInlineDataImage: boolean } {
  const text = String(content || '').trim();
  if (!text) return { refusedHtml: [], refusedAddresses: [], hasInlineDataImage: false };

  const tokens = parseTokens(text);
  if (tokens) {
    const refused = collectRefusedContent(tokens);
    return {
      refusedHtml: refused.map((entry) => entry.written),
      refusedAddresses: refused.filter((entry) => entry.address).map((entry) => entry.written),
      hasInlineDataImage: tokensContainDataImage(tokens),
    };
  }
  return { refusedHtml: findRefusedHtmlInText(text), refusedAddresses: [], hasInlineDataImage: containsInlineDataImageText(text) };
}

export function isHtmlContent(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return false;

  const tokens = parseTokens(text);
  if (tokens) {
    return isLegacyHtmlFromTokens(tokens);
  }

  if (MARKDOWN_AUTOLINK_REGEX_FALLBACK.test(text)) return false;
  return hasHtmlTagText(text);
}

export function resolveHtmlContentSource(content: string): string {
  const text = String(content || '').trim();
  if (!text) return '';
  if (isHtmlContent(text)) {
    return text;
  }

  const decoded = decodeHtmlEntities(text).trim();
  if (decoded && decoded !== text && isHtmlContent(decoded)) {
    return decoded;
  }

  return text;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

turndown.addRule('taskListItem', {
  filter: (node: any) => node?.nodeName === 'LI' && node?.getAttribute?.('data-type') === 'taskItem',
  replacement: (content: string, node: any) => {
    const checked = node?.getAttribute?.('data-checked') === 'true';
    const text = String(content || '').trim();
    return `- [${checked ? 'x' : ' '}] ${text}\n`;
  },
});

// Markdown has no native underline/highlight syntax in our target format.
turndown.addRule('dropMarkFormatting', {
  filter: 'mark',
  replacement: (content: string) => content,
});

turndown.addRule('dropUnderlineFormatting', {
  filter: 'u',
  replacement: (content: string) => content,
});

export function htmlToMarkdown(content: string): string {
  const source = resolveHtmlContentSource(content);
  if (!source) return '';
  if (!isHtmlContent(source)) return source;
  return turndown.turndown(source);
}
