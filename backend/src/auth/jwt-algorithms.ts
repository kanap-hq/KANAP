import type { Algorithm } from 'jsonwebtoken';

/**
 * Signing algorithms, one list per token family. Every `jwt.sign` names the algorithm it signs
 * with, and every `jwt.verify` names the algorithms it accepts, so a token is only accepted in
 * the algorithm its family is issued with.
 *
 * - Tokens this API issues (access, password reset, SSO state, SSO login handoff) are signed with
 *   HS256 and accepted in HS256 only.
 * - Provisioning tokens are issued outside this repository with a shared secret
 *   (`token-secret.util.ts`): any HMAC algorithm is accepted.
 * - Entra ID tokens are signed by Microsoft with RS256 and checked against its published keys.
 */
export const ISSUED_TOKEN_ALGORITHM: Algorithm = 'HS256';

export const ISSUED_TOKEN_ALGORITHMS: readonly Algorithm[] = Object.freeze([ISSUED_TOKEN_ALGORITHM]);

export const PROVISIONING_TOKEN_ALGORITHMS: readonly Algorithm[] = Object.freeze<Algorithm[]>(['HS256', 'HS384', 'HS512']);

export const ENTRA_ID_TOKEN_ALGORITHMS: readonly Algorithm[] = Object.freeze<Algorithm[]>(['RS256']);
