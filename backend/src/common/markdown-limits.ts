import { BadRequestException } from '@nestjs/common';

/**
 * Size limit of a Markdown content, checked on the main thread of the API.
 *
 * Each function here scans the text once, without the Markdown parser: the
 * parser and the other text conversions run in the Markdown workers
 * (markdown-worker.ts).
 */

/**
 * Largest Markdown content accepted on a write, in UTF-8 bytes of text. Inline
 * base64 images do not count (see `markdownTextSize`). Contents stored before
 * the limit stay readable and exportable; only a new, larger write is refused.
 */
export const MARKDOWN_MAX_BYTES = 200 * 1024;

export const MARKDOWN_TOO_LARGE = 'MARKDOWN_TOO_LARGE';

const DATA_IMAGE_PAYLOAD_REGEX = /(data:image\/[a-z0-9.+-]+;base64,)[a-z0-9+/=]+/gi;

/**
 * The text with each base64 run after a `data:image/...;base64,` prefix cut to one
 * character, as the parser sees it: an inline image payload is not parsed. The cut
 * keeps the prefix, so the URI is still recognised as an inline image. It changes
 * no Markdown structure: the payload alphabet (letters, digits, "+", "/" and "=")
 * holds no delimiter that acts in the middle of a line. It can shorten an
 * unquoted HTML attribute value, which only leads to more refusals of raw HTML.
 */
export function withoutDataImagePayloads(content: string): string {
  return String(content || '').replace(DATA_IMAGE_PAYLOAD_REGEX, '$1A');
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
 * to the last ">" is searched, so every tag match succeeds at once. One difference
 * with a tag read up to its closing quote: a quoted `src` value holding a ">" before
 * the end of its quotes is not recognised here (a base64 image never holds one).
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

/**
 * Size of the text of a Markdown content in UTF-8 bytes. The base64 payloads of
 * inline images are left out only when the text holds an inline image (Markdown
 * image or `<img>` tag with a `data:image/...;base64,` source); any other text
 * counts in full.
 */
export function markdownTextSize(value: string): number {
  const text = String(value ?? '');
  const cut = withoutDataImagePayloads(text);
  if (cut.length === text.length || !containsInlineDataImageText(text)) {
    return Buffer.byteLength(text, 'utf8');
  }
  return Buffer.byteLength(cut, 'utf8');
}

export function markdownTooLargeError(fieldName: string, size: number): BadRequestException {
  return new BadRequestException({
    code: MARKDOWN_TOO_LARGE,
    message: `${fieldName} is too long: ${Math.ceil(size / 1024)} KB of text, the limit is ${MARKDOWN_MAX_BYTES / 1024} KB.`,
    field: fieldName,
    max_bytes: MARKDOWN_MAX_BYTES,
  });
}

/** Refuses a Markdown content larger than `MARKDOWN_MAX_BYTES` with a 400 `MARKDOWN_TOO_LARGE`. */
export function assertMarkdownSize(value: unknown, fieldName = 'content'): void {
  if (value == null) return;
  const text = String(value);
  // The whole text within the limit: its text without image payloads is too.
  if (Buffer.byteLength(text, 'utf8') <= MARKDOWN_MAX_BYTES) return;
  const size = markdownTextSize(text);
  if (size <= MARKDOWN_MAX_BYTES) return;
  throw markdownTooLargeError(fieldName, size);
}
