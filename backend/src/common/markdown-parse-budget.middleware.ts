import type { RequestHandler } from 'express';
import { collectJsonStrings, MARKDOWN_PARSE_CHECK_MAX_CHARS, noteMarkdownParseBudget } from './markdown-parse-budget';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Measures, off the main thread, the long strings of a JSON body before the
 * request goes further (markdown-parse-budget.ts). Nothing is refused here: a
 * string over the parse budget is refused by the parser if the route reads it as
 * Markdown, and is left alone otherwise. Installed after the body parsers and
 * before the tenant transaction opens, so no database connection waits on it.
 */
export function createMarkdownParseBudgetMiddleware(): RequestHandler {
  return (req, _res, next) => {
    const body = (req as { body?: unknown }).body;
    if (!METHODS_WITH_BODY.has(req.method) || !body || typeof body !== 'object' || Buffer.isBuffer(body)) {
      next();
      return;
    }
    const strings = collectJsonStrings(body);
    if (strings.length === 0) {
      next();
      return;
    }
    noteMarkdownParseBudget(strings, { fieldName: 'body', maxChars: MARKDOWN_PARSE_CHECK_MAX_CHARS })
      .then(() => next(), () => next());
  };
}
