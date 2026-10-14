import { marked } from 'marked';
import TurndownService = require('turndown');

const HTML_TAG_REGEX_FALLBACK = /<\/?(p|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|a|img|table|thead|tbody|tr|td|th|div|span|br|hr|mark|u)\b[^>]*>/i;
const MARKDOWN_AUTOLINK_REGEX_FALLBACK = /^<https?:\/\/[^>\s]+>$/i;
const IMG_TAG_ONLY_REGEX = /^<img\b[\s\S]*\/?>$/i;
const IMG_ATTR_REGEX = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
const ALLOWED_IMG_ATTRS = new Set(['src', 'alt', 'title', 'width', 'height']);
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

export function isAllowedMarkdownHtmlSnippet(value: string): boolean {
  const snippet = normalizeSnippet(value);
  if (!snippet) return false;
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

const DATA_IMAGE_PAYLOAD_REGEX = /(data:image\/[a-z0-9.+-]+;base64,)[a-z0-9+/=]+/gi;

/**
 * The text with each base64 image payload cut to one character. An inline image
 * is not text: it neither counts toward the size of a Markdown content nor goes
 * through the Markdown parser. The cut keeps the `data:image/...;base64,` prefix,
 * so the URI is still recognised as an inline image, and changes no Markdown
 * structure (the payload alphabet, letters, digits, "+", "/" and "=", holds no
 * delimiter that acts in the middle of a line).
 */
export function withoutDataImagePayloads(content: string): string {
  return String(content || '').replace(DATA_IMAGE_PAYLOAD_REGEX, '$1A');
}

function parseTokens(content: string): MarkdownToken[] | null {
  try {
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

function walkMarkedToken(value: unknown, visit: (token: MarkdownToken) => void): void {
  if (!value || typeof value !== 'object') return;
  const token = value as MarkdownToken;
  if (typeof token.type !== 'string') return;

  visit(token);

  // HTML inside fenced/indented code or inline code is valid and must not be flagged.
  if (token.type === 'code' || token.type === 'codespan') {
    return;
  }

  for (const nested of Object.values(token)) {
    if (Array.isArray(nested)) {
      for (const child of nested) {
        walkMarkedToken(child, visit);
      }
      continue;
    }
    if (nested && typeof nested === 'object') {
      walkMarkedToken(nested, visit);
    }
  }
}

function collectRawHtmlSnippets(tokens: MarkdownToken[]): string[] {
  const snippets: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    walkMarkedToken(token, (current) => {
      if (current.type !== 'html') return;
      const snippet = normalizeSnippet(current.raw ?? current.text ?? '');
      if (!snippet || seen.has(snippet)) return;
      seen.add(snippet);
      snippets.push(snippet);
    });
  }

  return snippets;
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

function findRawHtmlSnippetsInText(text: string): string[] {
  if (MARKDOWN_AUTOLINK_REGEX_FALLBACK.test(text)) return [];
  if (!hasHtmlTagText(text)) return [];
  const fallbackSnippet = normalizeSnippet(text);
  return fallbackSnippet ? [fallbackSnippet] : [];
}

export function findRawHtmlSnippets(content: string): string[] {
  const text = String(content || '').trim();
  if (!text) return [];

  const tokens = parseTokens(text);
  return tokens ? collectRawHtmlSnippets(tokens) : findRawHtmlSnippetsInText(text);
}

function tokensContainDataImage(tokens: MarkdownToken[]): boolean {
  let found = false;
  for (const token of tokens) {
    walkMarkedToken(token, (current) => {
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
    if (found) break;
  }
  return found;
}

const DATA_IMAGE_TARGET_STICKY_REGEX = /\s*<?data:image\/[a-z0-9.+-]+;base64,[^)>\s]/iy;
const DATA_IMAGE_SRC_REGEX = /\bsrc\s*=\s*(["'])data:image\/[a-z0-9.+-]+;base64,/gi;

/**
 * `![alt](data:image/...;base64,...)` in text that could not be tokenized: one
 * pass over the text, where a "]" closes the alt text opened by the last "![".
 */
function hasMarkdownDataImageText(text: string): boolean {
  let altOpen = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '!' && text[index + 1] === '[') {
      altOpen = true;
      index += 1;
      continue;
    }
    if (char !== ']') continue;
    const opened = altOpen;
    altOpen = false;
    if (!opened || text[index + 1] !== '(') continue;
    DATA_IMAGE_TARGET_STICKY_REGEX.lastIndex = index + 2;
    if (DATA_IMAGE_TARGET_STICKY_REGEX.test(text)) return true;
  }
  return false;
}

/**
 * `<img ... src="data:image/...;base64,...">` in text that could not be tokenized.
 * Each tag is cut at its first ">" (a base64 payload holds none), and only text up
 * to the last ">" is searched, so every tag match succeeds at once.
 */
function hasHtmlDataImageText(text: string): boolean {
  const lastClose = text.lastIndexOf('>');
  if (lastClose === -1) return false;
  const tags = text.slice(0, lastClose + 1).match(/<img\b[^>]*>/gi) || [];
  return tags.some((tag) => {
    const lastQuote: Record<string, number> = { '"': tag.lastIndexOf('"'), '\'': tag.lastIndexOf('\'') };
    const srcRegex = new RegExp(DATA_IMAGE_SRC_REGEX.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = srcRegex.exec(tag)) !== null) {
      // The quoted value must be closed before the end of the tag.
      if (lastQuote[match[1]] >= srcRegex.lastIndex) return true;
    }
    return false;
  });
}

/** Inline base64 image check for text the Markdown parser could not tokenize. */
export function containsInlineDataImageText(content: string): boolean {
  const text = withoutDataImagePayloads(String(content || '').trim());
  if (!text) return false;
  return hasMarkdownDataImageText(text) || hasHtmlDataImageText(text);
}

export function containsInlineDataImage(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return false;

  const tokens = parseTokens(text);
  return tokens ? tokensContainDataImage(tokens) : containsInlineDataImageText(text);
}

/** Raw HTML snippets and inline base64 images of a Markdown content, from a single parse. */
export function inspectMarkdownContent(content: string): { rawHtmlSnippets: string[]; hasInlineDataImage: boolean } {
  const text = String(content || '').trim();
  if (!text) return { rawHtmlSnippets: [], hasInlineDataImage: false };

  const tokens = parseTokens(text);
  if (tokens) {
    return { rawHtmlSnippets: collectRawHtmlSnippets(tokens), hasInlineDataImage: tokensContainDataImage(tokens) };
  }
  return { rawHtmlSnippets: findRawHtmlSnippetsInText(text), hasInlineDataImage: containsInlineDataImageText(text) };
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
