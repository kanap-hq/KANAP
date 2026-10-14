/**
 * Text processing of the Markdown a document import produces (pandoc output).
 * Runs in the Markdown workers: DocumentImportService calls it through
 * markdown-worker.ts, which bounds its time.
 */

/** An image of an imported Markdown text, with what its rewrite needs. */
export type ImportedImageReference = {
  kind: 'markdown' | 'html';
  raw: string;
  target: string;
  index: number;
  /** For an `<img>` tag: the alt text and title of the Markdown image that replaces it. */
  alt?: string;
  title?: string | null;
};

/**
 * Applies `replace` to the text up to the end of the last `closer` (compared
 * without case) and keeps the rest as it is. For a pattern that runs from an
 * opening mark to the next `closer`, the result is the same as on the whole text:
 * no match can end after the last closer. Each opening mark before it then has a
 * closer ahead, so a lazy match never scans to the end of the text again
 * (linear time).
 */
function replaceBeforeLastCloser(text: string, closer: string, replace: (head: string) => string): string {
  const end = text.toLowerCase().lastIndexOf(closer.toLowerCase());
  if (end === -1) return text;
  const cut = end + closer.length;
  return replace(text.slice(0, cut)) + text.slice(cut);
}

export function readHtmlAttribute(rawHtml: string, attributeName: string): string | null {
  const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*([\"'])(.*?)\\1`, 'i');
  const match = rawHtml.match(pattern);
  return match?.[2] ? String(match[2]) : null;
}

export function escapeMarkdownImageText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function stripHtmlToText(html: string): string {
  let text = String(html || '');
  text = text.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<\/p\s*>/gi, ' ');
  text = text.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*\/?>/g, '');
  text = decodeHtmlEntities(text);
  return text.replace(/\s+/g, ' ').trim();
}

function convertHtmlTableToGfm(html: string): string {
  const rows: string[][] = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const text = stripHtmlToText(cellMatch[1]).replace(/\|/g, '\\|');
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return '';

  // Normalize column count.
  const maxCols = Math.max(...rows.map((r) => r.length));
  for (const row of rows) {
    while (row.length < maxCols) row.push('');
  }

  // First row becomes the header (pandoc puts <th> in a <thead>).
  const lines: string[] = [];
  lines.push('| ' + rows[0].map((c) => c || ' ').join(' | ') + ' |');
  lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
  for (let i = 1; i < rows.length; i++) {
    lines.push('| ' + rows[i].map((c) => c || ' ').join(' | ') + ' |');
  }

  return '\n' + lines.join('\n') + '\n';
}

/**
 * Post-processes pandoc GFM output to produce clean markdown that:
 * 1. Passes the backend `content_markdown` validation (no raw HTML).
 * 2. Parses without errors in the frontend MDXEditor (JSX/MDX rules).
 *
 * Pandoc falls back to raw HTML for constructs GFM cannot represent
 * (tables with column widths, merged cells, autolinks, etc.).
 */
export function sanitizeForMdxEditor(markdown: string): string {
  // Protect fenced code blocks from processing.
  const codeBlocks: string[] = [];
  let result = String(markdown || '').replace(
    /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1\s*$/gm,
    (match) => {
      const i = codeBlocks.length;
      codeBlocks.push(match);
      return `\x00CB${i}\x00`;
    },
  );

  // Convert HTML tables to GFM markdown tables.
  result = replaceBeforeLastCloser(result, '</table>', (head) => head.replace(/<table\b[\s\S]*?<\/table>/gi, (html) => convertHtmlTableToGfm(html)));

  // Convert URI autolinks <scheme://…> to standard markdown links.
  // MDX treats <https://…> as JSX and fails on the :// namespace syntax.
  result = result.replace(/<([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s>]+)>/g, '[$1]($1)');

  // Convert email autolinks <user@host> to markdown mailto links.
  result = result.replace(/<([^\s>@]+@[^\s>]+\.[^\s>]+)>/g, '[$1](mailto:$1)');

  // Convert semantic HTML breaks/rules to markdown equivalents.
  result = result.replace(/<br\s*\/?>/gi, '\n');
  result = result.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Convert <img> tags to markdown images before stripping HTML.
  result = result.replace(
    /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi,
    (match, _q, src) => {
      const alt = escapeMarkdownImageText(readHtmlAttribute(match, 'alt') || '');
      return `![${alt}](${src})`;
    },
  );

  // Strip HTML comments (e.g. pandoc bookmarks, drawing group markers).
  result = replaceBeforeLastCloser(result, '-->', (head) => head.replace(/<!--[\s\S]*?-->/g, ''));

  // Strip block-level and inline HTML tags, keeping text content.
  result = result.replace(/<\/p\s*>/gi, '\n\n');
  result = result.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*\/?>/g, '');

  // Decode common HTML entities left by stripped HTML.
  result = decodeHtmlEntities(result);

  // Collapse excessive blank lines.
  result = result.replace(/\n{3,}/g, '\n\n');

  // Restore code blocks.
  result = result.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[Number(i)]);

  return result;
}

/** The images of an imported Markdown text, in text order. */
export function findImportedImageReferences(markdown: string): ImportedImageReference[] {
  const text = String(markdown || '');
  const occurrences: ImportedImageReference[] = [];

  const markdownImageRegex = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownImageRegex.exec(text)) !== null) {
    const raw = String(markdownMatch[0] || '');
    const target = String(markdownMatch[1] || '').trim();
    const index = Number(markdownMatch.index || 0);
    if (!raw || !target) continue;
    occurrences.push({ kind: 'markdown', raw, target, index });
  }

  const htmlImageRegex = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlImageRegex.exec(text)) !== null) {
    const raw = String(htmlMatch[0] || '');
    const target = String(htmlMatch[2] || '').trim();
    const index = Number(htmlMatch.index || 0);
    if (!raw || !target) continue;
    occurrences.push({
      kind: 'html',
      raw,
      target,
      index,
      alt: escapeMarkdownImageText(readHtmlAttribute(raw, 'alt') || ''),
      title: readHtmlAttribute(raw, 'title'),
    });
  }

  return occurrences.sort((a, b) => a.index - b.index);
}
