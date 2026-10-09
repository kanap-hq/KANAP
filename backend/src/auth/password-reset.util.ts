import type { StringValue } from 'ms';
import * as jwt from 'jsonwebtoken';
import { getPasswordResetSecret } from './token-secret.util';
import { PASSWORD_RESET_PURPOSE } from './access-token.util';
import { ISSUED_TOKEN_ALGORITHM } from './jwt-algorithms';

const DEFAULT_TTL: StringValue | number = '1h';

export type PasswordResetTokenPayload = {
  purpose: typeof PASSWORD_RESET_PURPOSE;
  sub: string;
  email: string;
  tenant_id?: string | null;
  jti: string;
};

export function getPasswordResetTtl(): StringValue | number {
  const raw = process.env.PASSWORD_RESET_TTL;
  if (!raw) return DEFAULT_TTL;
  const trimmed = raw.trim();
  if (trimmed === '') return DEFAULT_TTL;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && num > 0) return num;
  return trimmed as StringValue;
}

export function getPasswordResetExpirationMinutes() {
  const ttl = getPasswordResetTtl();
  if (typeof ttl === 'number') {
    return Math.max(1, Math.round(ttl / 60));
  }
  const normalized = ttl.trim().toLowerCase();
  if (normalized.endsWith('h')) {
    const hours = Number(normalized.slice(0, -1));
    return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 60;
  }
  if (normalized.endsWith('m')) {
    const minutes = Number(normalized.slice(0, -1));
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 60;
  }
  const seconds = Number(normalized);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.max(1, Math.round(seconds / 60));
  }
  return 60;
}

export function createPasswordResetToken(user: { id: string; email: string; tenant_id?: string | null }, jti: string) {
  // Signing key: `PASSWORD_RESET_SECRET` when configured, otherwise a key derived from
  // `JWT_SECRET` with the `kanap:v1:password-reset` label — never `JWT_SECRET` itself, which is
  // what made a reset link usable as an access token (constat n°2).
  const secret = getPasswordResetSecret();
  const payload: PasswordResetTokenPayload = {
    purpose: PASSWORD_RESET_PURPOSE,
    sub: user.id,
    email: user.email,
    tenant_id: user.tenant_id ?? null,
    jti,
  };
  const expiresIn = getPasswordResetTtl();
  return jwt.sign(payload, secret, { algorithm: ISSUED_TOKEN_ALGORITHM, expiresIn });
}
