import { marked } from 'marked';
import { sanitizeRichHtmlForEmail } from './html-sanitizer';

/**
 * HTML of a Markdown content for an email. Runs in the Markdown workers: the API
 * calls it through `renderMarkdownEmailHtml` of markdown-worker.ts, which bounds
 * its time and falls back to plain text.
 */
export function renderMarkdownToHtml(content: string): string {
  const text = String(content || '').trim();
  if (!text) return '';
  return sanitizeRichHtmlForEmail(String(marked.parse(text, { async: false, gfm: true, breaks: true })));
}
