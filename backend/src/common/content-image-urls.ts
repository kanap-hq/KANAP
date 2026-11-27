import { findMarkdownImageTargets, isRegExpSpace } from './text-scan';

/** A word character of `\b` in a regular expression. */
function isWordCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f;
}

function isQuoteCode(code: number): boolean {
  return code === 0x22 || code === 0x27;
}

/**
 * The values of `src` attributes that name an inline image: what
 * `/\bsrc\s*=\s*["']([^"']*\/inline(?:\/[^"']*)?)["']/gi` captures, read once in time proportional
 * to the length of the text. A value runs from its quote to the next quote (either kind), and it
 * names an inline image when it holds `/inline/` or ends with `/inline`.
 */
function findInlineSourceValues(content: string): string[] {
  const values: string[] = [];
  // `src` in any case, as the `i` flag reads it (ASCII letters only).
  const isSrcAt = (index: number) => (content.charCodeAt(index) | 0x20) === 0x73
    && (content.charCodeAt(index + 1) | 0x20) === 0x72
    && (content.charCodeAt(index + 2) | 0x20) === 0x63;
  let at = 0;
  while (at + 3 <= content.length) {
    if (!isSrcAt(at)) {
      at += 1;
      continue;
    }
    let next = at + 1;
    if (at === 0 || !isWordCode(content.charCodeAt(at - 1))) {
      let i = at + 3;
      while (i < content.length && isRegExpSpace(content.charCodeAt(i))) i += 1;
      if (content.charCodeAt(i) === 0x3d) {
        i += 1;
        while (i < content.length && isRegExpSpace(content.charCodeAt(i))) i += 1;
        if (isQuoteCode(content.charCodeAt(i))) {
          const start = i + 1;
          let end = start;
          while (end < content.length && !isQuoteCode(content.charCodeAt(end))) end += 1;
          const value = content.slice(start, end);
          if (end < content.length && (value.includes('/inline/') || value.endsWith('/inline'))) {
            values.push(value);
            next = end + 1;
          }
        }
      }
    }
    at = next;
  }
  return values;
}

export function extractInlineImageUrls(content: string | null): string[] {
  if (!content) return [];

  const urls: string[] = [];

  // Markdown may include raw <img ...> tags (e.g., resized images in MDXEditor).
  for (const value of findInlineSourceValues(content)) {
    const raw = value.trim();
    if (!raw) continue;
    urls.push(raw);
  }

  // Markdown images: ![alt](url) or ![alt](<url>)
  for (const target of findMarkdownImageTargets(content)) {
    const raw = target.trim();
    if (!raw || !raw.includes('/inline')) continue;
    urls.push(raw);
  }

  return [...new Set(urls)];
}
