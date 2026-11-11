import { BadRequestException } from '@nestjs/common';
import { escapeRefusedHtml, inspectMarkdownContent } from './html-to-markdown';
import { assertMarkdownSize, MARKDOWN_MAX_BYTES, markdownHtmlNotAllowedError, markdownTooLargeError } from './markdown-limits';

/**
 * Checks of a Markdown content with the Markdown parser. Runs in the Markdown
 * workers: the API calls it through `normalizeMarkdownRichText` of
 * markdown-worker.ts, which bounds its time.
 */

type NormalizeMarkdownRichTextOptions = {
  fieldName?: string;
  /**
   * True for server-side processing of contents already stored (copies,
   * backfills, repairs, verification): they keep whatever size and HTML tags
   * they had. Only a write is held to the size limit and to the accepted tags.
   */
  storedContent?: boolean;
  /**
   * True for a text an automatic import reads from another system (a ticket):
   * nobody is there to correct it, so a tag outside the accepted list is kept as
   * text (`escapeRefusedHtml`) instead of refusing the write.
   */
  thirdPartyText?: boolean;
};

export function normalizeMarkdownRichText(
  value: unknown,
  opts?: NormalizeMarkdownRichTextOptions,
): string | null {
  if (value == null) return null;
  let text = String(value).trim();
  if (!text) return null;
  const field = opts?.fieldName || 'content';

  const isWrite = opts?.storedContent !== true;
  if (isWrite) {
    assertMarkdownSize(text, field);
  }

  let { refusedHtml, hasInlineDataImage } = inspectMarkdownContent(text);
  if (isWrite && refusedHtml.length > 0 && opts?.thirdPartyText === true) {
    text = escapeRefusedHtml(text);
    ({ refusedHtml, hasInlineDataImage } = inspectMarkdownContent(text));
  }
  if (isWrite && refusedHtml.length > 0) {
    throw markdownHtmlNotAllowedError(field, refusedHtml[0]);
  }

  if (hasInlineDataImage) {
    throw new BadRequestException(
      `${field} cannot include inline base64 images. Upload images as attachments so content references S3 URLs.`,
    );
  }

  // Image payloads only leave the count when the parser sees an inline image (refused just above).
  if (isWrite) {
    const size = Buffer.byteLength(text, 'utf8');
    if (size > MARKDOWN_MAX_BYTES) throw markdownTooLargeError(field, size);
  }

  return text;
}
