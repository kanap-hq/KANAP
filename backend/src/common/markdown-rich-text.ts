import { BadRequestException } from '@nestjs/common';
import { inspectMarkdownContent, isAllowedMarkdownHtmlSnippet, withoutDataImagePayloads } from './html-to-markdown';

/**
 * Largest Markdown content accepted on a write, in UTF-8 bytes of text. Inline
 * base64 images do not count (see `markdownTextSize`). Contents stored before
 * the limit stay readable and exportable; only a new, larger write is refused.
 */
export const MARKDOWN_MAX_BYTES = 200 * 1024;

export const MARKDOWN_TOO_LARGE = 'MARKDOWN_TOO_LARGE';

type NormalizeMarkdownRichTextOptions = {
  fieldName?: string;
  /**
   * False for server-side processing of contents already stored (backfills,
   * repairs, verification), which keep whatever size they had.
   */
  enforceSizeLimit?: boolean;
};

/** Size of the text of a Markdown content in UTF-8 bytes, inline base64 image payloads left out. */
export function markdownTextSize(value: string): number {
  return Buffer.byteLength(withoutDataImagePayloads(value), 'utf8');
}

/** Refuses a Markdown content larger than `MARKDOWN_MAX_BYTES` with a 400 `MARKDOWN_TOO_LARGE`. */
export function assertMarkdownSize(value: unknown, fieldName = 'content'): void {
  if (value == null) return;
  const size = markdownTextSize(String(value));
  if (size <= MARKDOWN_MAX_BYTES) return;
  throw new BadRequestException({
    code: MARKDOWN_TOO_LARGE,
    message:
      `${fieldName} is too long: ${Math.ceil(size / 1024)} KB of text, the limit is ${MARKDOWN_MAX_BYTES / 1024} KB. ` +
      'Split the content into several documents.',
    field: fieldName,
    max_bytes: MARKDOWN_MAX_BYTES,
  });
}

export function normalizeMarkdownRichText(
  value: unknown,
  opts?: NormalizeMarkdownRichTextOptions,
): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const field = opts?.fieldName || 'content';

  if (opts?.enforceSizeLimit !== false) {
    assertMarkdownSize(text, field);
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

  return text;
}
