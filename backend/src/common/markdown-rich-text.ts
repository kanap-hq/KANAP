import { BadRequestException } from '@nestjs/common';
import { inspectMarkdownContent, isAllowedMarkdownHtmlSnippet } from './html-to-markdown';
import { assertMarkdownSize, MARKDOWN_MAX_BYTES, markdownTooLargeError } from './markdown-limits';

/**
 * Checks of a Markdown content with the Markdown parser. Runs in the Markdown
 * workers: the API calls it through `normalizeMarkdownRichText` of
 * markdown-worker.ts, which bounds its time.
 */

type NormalizeMarkdownRichTextOptions = {
  fieldName?: string;
  /**
   * False for server-side processing of contents already stored (copies,
   * backfills, repairs, verification), which keep whatever size they had.
   */
  enforceSizeLimit?: boolean;
};

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
