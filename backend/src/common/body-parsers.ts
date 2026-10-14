import * as express from 'express';
import type { RequestHandler } from 'express';

// JSON bodies keep their 20 MB limit.
export const JSON_BODY_LIMIT = '20mb';
// Only the MCP OAuth token and revocation routes take a form-encoded body (RFC 6749,
// ai/oauth); the Entra sign-in returns in the query string, the public forms post
// JSON: a small limit is enough.
export const URLENCODED_BODY_LIMIT = '64kb';

type VerifyFn = (req: any, res: any, buffer: Buffer, encoding: string) => void;

/**
 * The JSON and form-encoded body parsers of the API, installed by main.ts
 * before Nest's own (Nest then leaves `jsonParser` / `urlencodedParser` alone).
 */
export function createBodyParsers(verify?: VerifyFn): RequestHandler[] {
  return [
    express.json({ limit: JSON_BODY_LIMIT, ...(verify ? { verify } : {}) }),
    express.urlencoded({ limit: URLENCODED_BODY_LIMIT, extended: false, ...(verify ? { verify } : {}) }),
  ];
}
