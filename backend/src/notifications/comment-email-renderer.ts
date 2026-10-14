import { sanitizeRichHtmlForEmail } from '../common/html-sanitizer';
import { HTML_TAGS, untilLast } from '../common/text-scan';

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
};

const MAX_TEXT_PREVIEW_LENGTH = 280;

export interface RenderCommentForEmailParams {
  commentHtml: string;
  tenantBaseUrl: string;
  tenantSlug?: string | null;
  /** The HTML was cleaned for an email already (sanitizeRichHtmlForEmail): it is not cleaned again. */
  sanitized?: boolean;
}

export interface RenderedCommentForEmail {
  html: string;
  textPreview: string;
}

export function renderCommentForEmail(params: RenderCommentForEmailParams): RenderedCommentForEmail {
  const sanitized = params.sanitized ? String(params.commentHtml || '').trim() : sanitizeCommentHtml(params.commentHtml);
  const withAbsoluteUrls = rewriteCommentUrls(sanitized, params.tenantBaseUrl, params.tenantSlug ?? null);

  const html = withAbsoluteUrls.trim() || '<p>(No comment content)</p>';
  const text = buildTextPreview(html);

  return {
    html,
    textPreview: text,
  };
}

function sanitizeCommentHtml(rawHtml: string): string {
  const cleaned = sanitizeRichHtmlForEmail(rawHtml);
  let html = String(cleaned || '').trim();
  if (!html) return '';

  return html;
}

function rewriteCommentUrls(html: string, tenantBaseUrl: string, tenantSlug: string | null): string {
  const origin = resolveOrigin(tenantBaseUrl);
  if (!origin) return html;

  return html.replace(
    /(\b(?:src|href)\s*=\s*)(["'])([^"']*)(\2)/gi,
    (_fullMatch, prefix: string, quote: string, urlValue: string) => {
      const rewritten = rewriteSingleUrl(urlValue, origin, tenantSlug);
      return `${prefix}${quote}${rewritten}${quote}`;
    },
  );
}

function rewriteSingleUrl(rawUrl: string, origin: string, tenantSlug: string | null): string {
  const value = String(rawUrl || '').trim();
  if (!value) return value;

  const lower = value.toLowerCase();
  if (
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('cid:') ||
    lower.startsWith('data:') ||
    lower.startsWith('#')
  ) {
    return value;
  }

  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
  if (isAbsolute) {
    try {
      const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return value;
      }
      const canonicalInlinePath = canonicalizeInlinePath(parsed.pathname, tenantSlug);
      if (canonicalInlinePath) {
        if (parsed.origin === origin) {
          return `${origin}${canonicalInlinePath}${parsed.search}${parsed.hash}`;
        }
        // Preserve explicit cross-origin URLs to avoid breaking installations
        // where API/media is intentionally served from a separate host.
        return value;
      }
      return value;
    } catch {
      return value;
    }
  }

  if (value.startsWith('/')) {
    const pathOnly = extractPath(value);
    const suffix = value.slice(pathOnly.length);
    const canonicalInlinePath = canonicalizeInlinePath(pathOnly, tenantSlug) || pathOnly;
    return `${origin}${canonicalInlinePath}${suffix}`;
  }

  return value;
}

function extractPath(urlPath: string): string {
  const queryIndex = urlPath.indexOf('?');
  const hashIndex = urlPath.indexOf('#');
  const cutAt = [queryIndex, hashIndex].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return cutAt === undefined ? urlPath : urlPath.slice(0, cutAt);
}

function canonicalizeInlinePath(pathname: string, tenantSlug: string | null): string | null {
  const portfolioWithApi = pathname.match(
    /^\/api\/portfolio\/(projects|requests)\/inline\/([^/]+)\/([a-f0-9-]+)$/i,
  );
  if (portfolioWithApi) {
    const itemType = portfolioWithApi[1];
    const slug = resolveSlug(portfolioWithApi[2], tenantSlug);
    if (!slug) return null;
    return `/api/portfolio/${itemType}/inline/${slug}/${portfolioWithApi[3]}`;
  }

  const portfolioNoApi = pathname.match(
    /^\/portfolio\/(projects|requests)\/inline\/([^/]+)\/([a-f0-9-]+)$/i,
  );
  if (portfolioNoApi) {
    const itemType = portfolioNoApi[1];
    const slug = resolveSlug(portfolioNoApi[2], tenantSlug);
    if (!slug) return null;
    return `/api/portfolio/${itemType}/inline/${slug}/${portfolioNoApi[3]}`;
  }

  const tasksWithApi = pathname.match(
    /^\/api\/tasks\/attachments\/([^/]+)\/([a-f0-9-]+)\/inline$/i,
  );
  if (tasksWithApi) {
    const slug = resolveSlug(tasksWithApi[1], tenantSlug);
    if (!slug) return null;
    return `/api/tasks/attachments/${slug}/${tasksWithApi[2]}/inline`;
  }

  const tasksNoApi = pathname.match(
    /^\/tasks\/attachments\/([^/]+)\/([a-f0-9-]+)\/inline$/i,
  );
  if (tasksNoApi) {
    const slug = resolveSlug(tasksNoApi[1], tenantSlug);
    if (!slug) return null;
    return `/api/tasks/attachments/${slug}/${tasksNoApi[2]}/inline`;
  }

  return null;
}

function resolveSlug(slugFromPath: string, fallbackSlug: string | null): string | null {
  if (isValidSlug(slugFromPath)) return slugFromPath;
  if (fallbackSlug && isValidSlug(fallbackSlug)) return fallbackSlug;
  return null;
}

function isValidSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/i.test(value);
}

function resolveOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

function buildTextPreview(html: string): string {
  const plain = htmlToPlainText(html);
  if (!plain) return '(No comment content)';
  if (plain.length <= MAX_TEXT_PREVIEW_LENGTH) return plain;
  return `${plain.slice(0, MAX_TEXT_PREVIEW_LENGTH).trimEnd()}...`;
}

function htmlToPlainText(html: string): string {
  const withLineBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|tr)\s*>/gi, '\n')
    .replace(untilLast('>', /<\s*li\b[^>]*>/gi), '- ');

  const withoutTags = withLineBreaks.replace(HTML_TAGS, ' ');
  const decoded = decodeHtmlEntities(withoutTags);
  const normalized = decoded
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return normalized;
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity || '').toLowerCase();

    if (ENTITY_MAP[key]) return ENTITY_MAP[key];

    if (key.startsWith('#x')) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }

    if (key.startsWith('#')) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }

    return match;
  });
}
