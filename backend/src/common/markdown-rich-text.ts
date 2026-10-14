import { BadRequestException } from '@nestjs/common';
import {
  containsInlineDataImageText,
  inspectMarkdownContent,
  isAllowedMarkdownHtmlSnippet,
  withoutDataImagePayloads,
} from './html-to-markdown';
import { assertWithinMarkdownParseBudget, isOverMarkdownParseBudget, markdownParseText } from './markdown-parse-budget';

/**
 * Largest Markdown content accepted on a write, in UTF-8 bytes of text. Inline
 * base64 images do not count (see `markdownTextSize`). Contents stored before
 * the limit stay readable and exportable; only a new, larger write is refused.
 * The time the parser may spend on a content is bounded separately
 * (markdown-parse-budget.ts).
 */
export const MARKDOWN_MAX_BYTES = 200 * 1024;

export const MARKDOWN_TOO_LARGE = 'MARKDOWN_TOO_LARGE';

type NormalizeMarkdownRichTextOptions = {
  fieldName?: string;
  /**
   * False for server-side processing of contents already stored (copies,
   * backfills, repairs, verification), which keep whatever size they had. Such a
   * content measured over the parse budget is kept as it is, without the checks
   * that need the parser.
   */
  enforceSizeLimit?: boolean;
};

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

function markdownTooLargeError(fieldName: string, size: number): BadRequestException {
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
  const size = markdownTextSize(String(value));
  if (size <= MARKDOWN_MAX_BYTES) return;
  throw markdownTooLargeError(fieldName, size);
}

export function normalizeMarkdownRichText(
  value: unknown,
  opts?: NormalizeMarkdownRichTextOptions,
): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const field = opts?.fieldName || 'content';

  const enforceSizeLimit = opts?.enforceSizeLimit !== false;
  if (enforceSizeLimit) {
    assertMarkdownSize(text, field);
    assertWithinMarkdownParseBudget(markdownParseText(text), field);
  } else if (isOverMarkdownParseBudget(markdownParseText(text))) {
    // A stored content the parser cannot handle within its budget stays as it is.
    return text;
  }

  const { rawHtmlSnippets, hasInlineDataImage } = inspectMarkdownContent(text);
  const disallowedHtml = rawHtmlSnippets.filter((snippet) => !isAllowedMarkdownHtmlSnippet(snippet));
  if (disallowedHtml.length > 0) {
    const example = disallowedHtml[0]
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    throw new BadRequestException(
      `${field} must be Markdown. Raw HTML is not allowed outside code blocks or inline code. ` +
      `Wrap HTML examples in backticks. Example: ${example}`,
    );
  }

  if (hasInlineDataImage) {
    throw new BadRequestException(
      `${field} cannot include inline base64 images. Upload images as attachments so content references S3 URLs.`,
    );
  }

  // Image payloads only leave the count when the parser sees an inline image (refused just above).
  if (enforceSizeLimit) {
    const size = Buffer.byteLength(text, 'utf8');
    if (size > MARKDOWN_MAX_BYTES) throw markdownTooLargeError(field, size);
  }

  return text;
}
