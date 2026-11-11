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
 * text is Markdown. These are the forms the editor writes:
 * - `paired`: an opening and a closing tag, without any attribute (`<u>`, `</u>`);
 * - `lineBreak`: `<br>`, `<br/>` or `<br />`, without any attribute;
 * - `imageAttributes`: an `<img>` tag with these attributes only, quoted, and a
 *   source that is an address of the application or an `http(s)` address.
 * The editor keeps the same list and shows any other tag as text: its own
 * constant (the Markdown editor under `frontend/src/components/`) follows this one.
 */
export const RICH_TEXT_ALLOWED_HTML = {
  paired: ['u', 'sub', 'sup'],
  lineBreak: 'br',
  imageAttributes: ['src', 'alt', 'title', 'width', 'height'],
} as const;

const PAIRED_TAG_REGEX = new RegExp(`^</?(?:${RICH_TEXT_ALLOWED_HTML.paired.join('|')})>$`);
const LINE_BREAK_TAG_REGEX = new RegExp(`^<${RICH_TEXT_ALLOWED_HTML.lineBreak}(?: ?/)?>$`);
const IMG_TAG_ONLY_REGEX = /^<img\b[\s\S]*\/?>$/i;
const IMG_ATTR_REGEX = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
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

function isAllowedImageSrc(value: string): boolean {
  const src = String(value || '').trim();
  if (!src) return false;
  if (/^javascript:/i.test(src)) return false;
  if (/^https?:\/\//i.test(src)) return true;
  if (/^\/\//.test(src)) return true;
  if (src.startsWith('/')) return true;
  return false;
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

/** Whether `value` is one tag of `RICH_TEXT_ALLOWED_HTML`. */
export function isAllowedMarkdownHtmlSnippet(value: string): boolean {
  const snippet = normalizeSnippet(value);
  if (!snippet) return false;
  if (PAIRED_TAG_REGEX.test(snippet) || LINE_BREAK_TAG_REGEX.test(snippet)) return true;
  if (!IMG_TAG_ONLY_REGEX.test(snippet)) return false;

  const attrsChunk = snippet
    .replace(/^<img\b/i, '')
    .replace(/\/?>$/i, '');
  const attrs: Record<string, string> = {};
  const attrRegex = new RegExp(IMG_ATTR_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrsChunk)) !== null) {
    const name = String(match[1] || '').toLowerCase();
    const valuePart = match[3] ?? match[4] ?? '';
    if (!ALLOWED_IMG_ATTRS.has(name)) return false;
    attrs[name] = String(valuePart);
  }

  attrRegex.lastIndex = 0;
  const leftovers = attrsChunk
    .replace(attrRegex, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (leftovers.length > 0) return false;

  if (!isAllowedImageSrc(attrs.src || '')) return false;
  if (Object.prototype.hasOwnProperty.call(attrs, 'width') && !/^\d{1,5}$/.test(attrs.width)) return false;
  if (Object.prototype.hasOwnProperty.call(attrs, 'height') && !/^\d{1,5}$/.test(attrs.height)) return false;

  return true;
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
      const prose = String(token.text ?? '');
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

/** The tags of a parsed text outside `RICH_TEXT_ALLOWED_HTML`, one per HTML token, each once. */
function collectRefusedHtml(tokens: MarkdownToken[]): string[] {
  const refused: string[] = [];
  const seen = new Set<string>();

  walkMarkedToken(tokens, (current) => {
    if (current.type !== 'html') return;
    const tag = firstRefusedHtmlTag(String(current.raw ?? current.text ?? ''));
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    refused.push(tag);
  });

  return refused;
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

/** Refused HTML tags and inline base64 images of a Markdown content, from a single parse. */
export function inspectMarkdownContent(content: string): { refusedHtml: string[]; hasInlineDataImage: boolean } {
  const text = String(content || '').trim();
  if (!text) return { refusedHtml: [], hasInlineDataImage: false };

  const tokens = parseTokens(text);
  if (tokens) {
    return { refusedHtml: collectRefusedHtml(tokens), hasInlineDataImage: tokensContainDataImage(tokens) };
  }
  return { refusedHtml: findRefusedHtmlInText(text), hasInlineDataImage: containsInlineDataImageText(text) };
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
