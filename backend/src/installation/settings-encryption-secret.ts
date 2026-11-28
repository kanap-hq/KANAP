/**
 * The key that encrypts the secrets Kadratis stores (AI provider keys, connection tokens, the
 * installation settings that are secrets): `SETTINGS_ENCRYPTION_SECRET`, or its former name
 * `AI_SETTINGS_ENCRYPTION_SECRET`. A value that is empty or made of spaces counts as absent.
 *
 * Both names set to different values refuse the start: the secrets already stored were encrypted
 * with the former one, and letting the new name win would make them unreadable without a word.
 * Both set to the same value, or one of them only: nothing to say.
 */
export const SETTINGS_ENCRYPTION_SECRET_VARIABLE = 'SETTINGS_ENCRYPTION_SECRET';
export const SETTINGS_ENCRYPTION_SECRET_FORMER_VARIABLE = 'AI_SETTINGS_ENCRYPTION_SECRET';

export class SettingsEncryptionSecretConflictError extends Error {
  constructor() {
    super(
      `FATAL: ${SETTINGS_ENCRYPTION_SECRET_VARIABLE} and ${SETTINGS_ENCRYPTION_SECRET_FORMER_VARIABLE} are both set, to different values. `
      + `The stored secrets were encrypted with ${SETTINGS_ENCRYPTION_SECRET_FORMER_VARIABLE}: keep one of the two names, with that value.`,
    );
    this.name = 'SettingsEncryptionSecretConflictError';
  }
}

function present(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The encryption key, or null when neither name is set. Throws when the two names disagree. */
export function settingsEncryptionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const current = present(env[SETTINGS_ENCRYPTION_SECRET_VARIABLE]);
  const former = present(env[SETTINGS_ENCRYPTION_SECRET_FORMER_VARIABLE]);
  if (current !== null && former !== null && current !== former) throw new SettingsEncryptionSecretConflictError();
  return current ?? former;
}
