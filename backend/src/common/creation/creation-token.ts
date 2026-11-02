import { ForbiddenException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { getCreationTokenSecret } from '../../auth/token-secret.util';

/**
 * The token that lets the person who just created a record cancel that creation (the "Cancel
 * creation" action of a record page), even without the delete right, for that record only.
 *
 * It is `<issuedAt>.<signature>`: an HMAC-SHA256, under the `creation` family key
 * (`auth/token-secret.util.ts`), of the tenant, the record family, the record id, the creator and
 * the issue time. Nothing is stored: the verifier recomputes the signature from the request's own
 * tenant, person and record, so a token is worth nothing for another of them. It expires after
 * `CREATION_TOKEN_TTL_MS`.
 */

export const CREATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Another API instance may run a little ahead: a token from up to a minute in the future is accepted. */
const CLOCK_SKEW_MS = 60 * 1000;

export type CreationTokenSubject = {
  tenantId: string;
  /** The record family, as the route names it (`applications`). */
  family: string;
  recordId: string;
  userId: string;
};

function requireSubject(subject: CreationTokenSubject): void {
  for (const key of ['tenantId', 'family', 'recordId', 'userId'] as const) {
    const value = subject[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`A creation token needs a ${key}`);
    }
  }
}

function sign(subject: CreationTokenSubject, issuedAt: number, env: NodeJS.ProcessEnv): Buffer {
  // A separator no field can hold keeps two subjects from signing the same text.
  const text = ['kanap-creation', subject.tenantId, subject.family, subject.recordId.toLowerCase(), subject.userId, String(issuedAt)].join('\n');
  return createHmac('sha256', getCreationTokenSecret(env)).update(text, 'utf8').digest();
}

export function issueCreationToken(
  subject: CreationTokenSubject,
  options: { now?: number; env?: NodeJS.ProcessEnv } = {},
): string {
  requireSubject(subject);
  const issuedAt = Math.floor(options.now ?? Date.now());
  return `${issuedAt}.${sign(subject, issuedAt, options.env ?? process.env).toString('base64url')}`;
}

/** True when `token` was issued for this subject and has not expired. Never throws on a bad token. */
export function verifyCreationToken(
  token: unknown,
  subject: CreationTokenSubject,
  options: { now?: number; env?: NodeJS.ProcessEnv } = {},
): boolean {
  if (typeof token !== 'string' || token.length > 200) return false;
  const match = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  try {
    requireSubject(subject);
  } catch {
    return false;
  }
  const issuedAt = Number(match[1]);
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + CLOCK_SKEW_MS || now - issuedAt > CREATION_TOKEN_TTL_MS) return false;
  const expected = sign(subject, issuedAt, options.env ?? process.env);
  const given = Buffer.from(match[2], 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** 403 `CREATION_CANCEL_EXPIRED`: the token is missing, foreign or expired, so the record is deleted as any other. */
export function creationCancelExpired(): ForbiddenException {
  return new ForbiddenException({ code: 'CREATION_CANCEL_EXPIRED', message: 'This record is no longer being created.' });
}
