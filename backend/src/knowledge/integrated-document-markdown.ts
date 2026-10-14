import { marked } from 'marked';
import { htmlToMarkdown, isHtmlContent } from '../common/html-to-markdown';
import { buildInterfaceSpecificationMarkdown, InterfaceSpecificationSource } from './interface-specification-markdown';

/**
 * Markdown processing of the stored texts integrated documents are recovered
 * from. Runs in the Markdown workers: IntegratedDocumentsService calls it through
 * markdown-worker.ts, which bounds its time.
 */

type MarkdownToken = {
  type?: string;
  raw?: string;
  text?: string;
  [key: string]: unknown;
};

/** An inline image of a Markdown text: its source text and its target. */
export type InlineImageReference = {
  raw: string;
  target: string;
};

/** A legacy text (HTML or Markdown) as Markdown. */
export function prepareRecoveredContent(content: string | null | undefined): string | null {
  if (content == null) {
    return null;
  }
  const normalized = String(content);
  if (!normalized.trim()) {
    return '';
  }
  if (isHtmlContent(normalized)) {
    return htmlToMarkdown(normalized);
  }
  return normalized;
}

/** The specification document of an interface, legacy HTML texts converted. */
export function interfaceSpecificationMarkdown(row: InterfaceSpecificationSource): string {
  return buildInterfaceSpecificationMarkdown(row, (text) => (isHtmlContent(text) ? htmlToMarkdown(text) : text));
}

function parseMarkdownTokens(content: string): MarkdownToken[] | null {
  try {
    return marked.lexer(content, { gfm: true, breaks: true }) as MarkdownToken[];
  } catch {
    return null;
  }
}

function walkMarkdownToken(value: unknown, visit: (token: MarkdownToken) => void): void {
  if (!value || typeof value !== 'object') return;
  const token = value as MarkdownToken;
  if (typeof token.type !== 'string') return;

  visit(token);

  if (token.type === 'code' || token.type === 'codespan') {
    return;
  }

  for (const nested of Object.values(token)) {
    if (Array.isArray(nested)) {
      for (const child of nested) {
        walkMarkdownToken(child, visit);
      }
      continue;
    }
    if (nested && typeof nested === 'object') {
      walkMarkdownToken(nested, visit);
    }
  }
}

/** The inline images (Markdown images and `<img>` tags) of a Markdown text, in text order. */
export function collectInlineImageOccurrences(content: string | null | undefined): InlineImageReference[] {
  const text = String(content || '');
  if (!text.trim()) {
    return [];
  }

  const tokens = parseMarkdownTokens(text);
  if (tokens) {
    const occurrences: InlineImageReference[] = [];
    for (const token of tokens) {
      walkMarkdownToken(token, (current) => {
        if (current.type === 'image') {
          const raw = String(current.raw || '');
          const target = String((current as any).href || '').trim();
          if (!raw || !target) return;
          occurrences.push({ raw, target });
          return;
        }

        if (current.type !== 'html') {
          return;
        }

        const snippet = String(current.raw ?? current.text ?? '');
        if (!snippet || !/<img\b/i.test(snippet)) {
          return;
        }

        const imgRegex = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
        let match: RegExpExecArray | null;
        while ((match = imgRegex.exec(snippet)) !== null) {
          const raw = String(match[0] || '');
          const target = String(match[2] || '').trim();
          if (!raw || !target) continue;
          occurrences.push({ raw, target });
        }
      });
    }
    return occurrences;
  }

  const fallbackOccurrences: InlineImageReference[] = [];
  const markdownImageRegex = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownImageRegex.exec(text)) !== null) {
    const raw = String(markdownMatch[0] || '');
    const target = String(markdownMatch[1] || '').trim();
    if (!raw || !target) continue;
    fallbackOccurrences.push({ raw, target });
  }

  const htmlImageRegex = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlImageRegex.exec(text)) !== null) {
    const raw = String(htmlMatch[0] || '');
    const target = String(htmlMatch[2] || '').trim();
    if (!raw || !target) continue;
    fallbackOccurrences.push({ raw, target });
  }

  return fallbackOccurrences;
}
