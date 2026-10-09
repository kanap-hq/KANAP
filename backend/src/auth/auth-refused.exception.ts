import { UnauthorizedException } from '@nestjs/common';
import type { AuthEventReason } from '../audit/security-events';

/**
 * A refused sign-in or session renewal. The client gets the same 401 as with a plain
 * `UnauthorizedException` built from `response`; `reason` and `userId` (the account, when the
 * request named a known one) only go to the security log (security-events.ts).
 */
export class AuthRefusedException extends UnauthorizedException {
  constructor(
    response: string | Record<string, unknown>,
    readonly reason: AuthEventReason,
    readonly userId: string | null = null,
  ) {
    super(response);
  }
}

/** The reason and account of a refusal, or null for any other error. */
export function authRefusalOf(error: unknown): { reason: AuthEventReason; userId: string | null } | null {
  if (!(error instanceof AuthRefusedException)) return null;
  return { reason: error.reason, userId: error.userId };
}
