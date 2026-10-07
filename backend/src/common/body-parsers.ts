import * as express from 'express';
import type { RequestHandler } from 'express';

// JSON bodies keep their 20 MB limit.
export const JSON_BODY_LIMIT = '20mb';
// No route of the API takes a form-encoded body (the Entra sign-in returns in
// the query string, the public forms post JSON): a small limit is enough.
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
