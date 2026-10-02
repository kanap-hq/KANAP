import { createSecretKey, KeyObject } from 'crypto';
import { requireJwtSecret } from '../common/env';

/**
 * The access-token verification key, built once.
 *
 * Every authenticated request verifies its token. Given the secret as a string, jsonwebtoken
 * first tries to read it as a public key (`createPublicKey`, which throws), then builds the
 * secret key, on every call. On Node 20 (the image's runtime) the failed attempt alone costs
 * about 0.9 ms of main-thread time: a verification took about 980 µs, 19 µs with the key built
 * once (measured in the image). Given a KeyObject it does neither. The key is rebuilt only if
 * `JWT_SECRET` changes (specs set it per file; a running API never changes it).
 */
let cached: { secret: string; key: KeyObject } | null = null;

export function accessTokenVerifyKey(env: NodeJS.ProcessEnv = process.env): KeyObject {
  const secret = requireJwtSecret(env);
  if (!cached || cached.secret !== secret) {
    cached = { secret, key: createSecretKey(Buffer.from(secret, 'utf8')) };
  }
  return cached.key;
}
