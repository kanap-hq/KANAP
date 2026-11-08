import type { StringValue } from 'ms';
import * as jwt from 'jsonwebtoken';
import { getPasswordResetSecret } from './token-secret.util';
import { PASSWORD_RESET_PURPOSE } from './access-token.util';
import { ISSUED_TOKEN_ALGORITHM } from './jwt-algorithms';
import { linkTtlMinutes, parseInviteLinkTtl, parsePasswordResetTtl } from './token-ttl.util';

export type PasswordResetTokenPayload = {
  purpose: typeof PASSWORD_RESET_PURPOSE;
  sub: string;
  email: string;
  tenant_id?: string | null;
  jti: string;
};

export function getPasswordResetTtl(): StringValue | number {
  const ttl = parsePasswordResetTtl(process.env.PASSWORD_RESET_TTL);
  return typeof ttl === 'number' ? ttl : ttl as StringValue;
}

/** Lifetime of an invitation link (`INVITE_LINK_TTL`, 7 days by default). */
export function getInviteLinkTtl(): StringValue | number {
  const ttl = parseInviteLinkTtl(process.env.INVITE_LINK_TTL);
  return typeof ttl === 'number' ? ttl : ttl as StringValue;
}

export function getPasswordResetExpirationMinutes() {
  return linkTtlMinutes(getPasswordResetTtl());
}

export function getInviteLinkExpirationMinutes() {
  return linkTtlMinutes(getInviteLinkTtl());
}

/**
 * A link that sets the account's password. A reset link lasts `PASSWORD_RESET_TTL`; an invitation
 * passes `getInviteLinkTtl()`. Both are accepted by the same route, each until its own expiry (the
 * token's `exp` and the stored `expires_at`, both from this lifetime).
 */
export function createPasswordResetToken(
  user: { id: string; email: string; tenant_id?: string | null },
  jti: string,
  expiresIn: StringValue | number = getPasswordResetTtl(),
) {
  // Signing key: `PASSWORD_RESET_SECRET` when configured, otherwise a key derived from
  // `JWT_SECRET` with the `kanap:v1:password-reset` label, never `JWT_SECRET` itself: a reset
  // link is signed with a key of its own and is refused as an access token.
  const secret = getPasswordResetSecret();
  const payload: PasswordResetTokenPayload = {
    purpose: PASSWORD_RESET_PURPOSE,
    sub: user.id,
    email: user.email,
    tenant_id: user.tenant_id ?? null,
    jti,
  };
  return jwt.sign(payload, secret, { algorithm: ISSUED_TOKEN_ALGORITHM, expiresIn });
}
