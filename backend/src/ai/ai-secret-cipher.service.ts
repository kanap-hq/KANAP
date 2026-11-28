import { BadRequestException, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { settingsEncryptionSecret } from '../installation/settings-encryption-secret';

const ENCRYPTION_VERSION = 'v1';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

// The key is SETTINGS_ENCRYPTION_SECRET, or its former name AI_SETTINGS_ENCRYPTION_SECRET
// (installation/settings-encryption-secret.ts).
@Injectable()
export class AiSecretCipherService {
  canEncrypt(): boolean {
    return settingsEncryptionSecret() !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.canEncrypt()) {
      throw new BadRequestException('AI secret storage is not configured on this instance.');
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.getKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      ENCRYPTION_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(payload: string): string {
    if (!this.canEncrypt()) {
      throw new BadRequestException('AI secret storage is not configured on this instance.');
    }

    const [version, ivEncoded, tagEncoded, ciphertextEncoded] = payload.split(':');
    if (
      version !== ENCRYPTION_VERSION
      || !ivEncoded
      || !tagEncoded
      || !ciphertextEncoded
    ) {
      throw new Error('Unsupported encrypted payload');
    }

    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.getKey(),
      Buffer.from(ivEncoded, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private getKey(): Buffer {
    const raw = settingsEncryptionSecret();
    if (raw === null) {
      throw new BadRequestException('AI secret storage is not configured on this instance.');
    }
    return createHash('sha256').update(raw, 'utf8').digest();
  }
}
