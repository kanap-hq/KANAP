import { marked } from 'marked';
import { sanitizeRichHtmlForEmail } from './html-sanitizer';
import { renderMarkdownInWorker } from './markdown-parse-budget';

export function renderMarkdownToHtml(content: string): string {
  const text = String(content || '').trim();
  if (!text) return '';
  return sanitizeRichHtmlForEmail(String(marked.parse(text, { async: false, gfm: true, breaks: true })));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The text as plain paragraphs: what an email shows when the Markdown cannot be rendered. */
export function renderPlainTextToHtml(content: string): string {
  const text = String(content || '').trim();
  if (!text) return '';
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return sanitizeRichHtmlForEmail(
    paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).split('\n').join('<br>\n')}</p>`).join('\n'),
  );
}

/**
 * `renderMarkdownToHtml` for stored contents (emails): the parser runs in a
 * worker thread with a time budget (markdown-parse-budget.ts). A content it
 * cannot render within the budget is shown as plain text. When no worker can
 * start, the content is rendered here as before, plain text on a parser error.
 */
export async function renderMarkdownToHtmlBounded(content: string): Promise<string> {
  const text = String(content || '').trim();
  if (!text) return '';
  const rendered = await renderMarkdownInWorker(text);
  if (rendered.status === 'ok') return sanitizeRichHtmlForEmail(rendered.html);
  if (rendered.status === 'unavailable') {
    try {
      return renderMarkdownToHtml(text);
    } catch {
      return renderPlainTextToHtml(text);
    }
  }
  return renderPlainTextToHtml(text);
}
