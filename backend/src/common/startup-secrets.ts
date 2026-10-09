/**
 * Start-up checks of the secrets an operator sets in `.env`: `JWT_SECRET` and the password of the
 * administrator account created from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Each finding is one
 * `[SECURITY]` warning line that names the setting and what to do, never its value or length.
 * An installation keeps starting with the values it has.
 */

export const JWT_SECRET_MIN_LENGTH = 32;
export const BOOTSTRAP_PASSWORD_MIN_LENGTH = 12;

/**
 * The administrator passwords printed in `infra/.env.onprem.example` and in the on-premise guides
 * (`doc/help/docs/{en,fr,de,es}/on-premise/*.md`). A spec reads those files and fails when one of
 * their values is missing here (`common/__tests__/admin-password-policy.spec.ts`).
 */
export const PUBLISHED_EXAMPLE_PASSWORDS: readonly string[] = [
  'ChangeThisPassword123!',
  'ChangeMe123!',
  'ChangeThisAfterFirstLogin!',
  'AendernSie123!',
  'AendernSieDiesesPasswort123!',
  'CambieMe123!',
  'CambieEstaContraseña123!',
];

const PUBLISHED_EXAMPLE_SET = new Set(PUBLISHED_EXAMPLE_PASSWORDS.map((value) => value.toLowerCase()));

export const JWT_SECRET_WARNING =
  `[SECURITY] JWT_SECRET is shorter than ${JWT_SECRET_MIN_LENGTH} characters. Set a longer random value (for example the output of openssl rand -hex 32) and restart the API: everyone signs in again and pending password reset links stop working. A later version refuses a short JWT_SECRET on a new installation.`;

export const BOOTSTRAP_PASSWORD_WARNING =
  `[SECURITY] The account of ADMIN_EMAIL still has the password from ADMIN_PASSWORD, which is an example value from the documentation or shorter than ${BOOTSTRAP_PASSWORD_MIN_LENGTH} characters. Change this account's password (Forgot password on the sign-in page, or the Password Reset section of the on-premise operations guide). This line stops once the password is changed.`;

/** Warnings about `JWT_SECRET` (measured without its leading and trailing spaces), in any run mode. */
export function jwtSecretWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const secret = String(env.JWT_SECRET ?? '').trim();
  // A missing JWT_SECRET already stops the start-up (validateStartupEnv in common/env.ts).
  if (!secret) return [];
  return secret.length < JWT_SECRET_MIN_LENGTH ? [JWT_SECRET_WARNING] : [];
}

/** A published example value (any letter case) or a value shorter than 12 characters. */
export function isWeakBootstrapPassword(value: string): boolean {
  const password = String(value ?? '').trim();
  if (!password) return false;
  return password.length < BOOTSTRAP_PASSWORD_MIN_LENGTH || PUBLISHED_EXAMPLE_SET.has(password.toLowerCase());
}
