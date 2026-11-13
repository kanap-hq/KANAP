import { createHash } from 'crypto';
import type { EntityManager } from 'typeorm';

/**
 * Pending link confirmations are kept with the other e-mailed links, in `password_reset_tokens`.
 * Their hash carries a prefix of its own: the password routes look a link up by its plain SHA-256
 * (64 hex characters), which never starts with it, and a new confirmation replaces only the
 * previous confirmations of the account, never its password links.
 */
export const LINK_CONFIRMATION_HASH_PREFIX = 'entra-link:';

export function linkConfirmationHash(token: string): string {
  const digest = createHash('sha256').update(token).digest('hex');
  return LINK_CONFIRMATION_HASH_PREFIX + digest.slice(0, 64 - LINK_CONFIRMATION_HASH_PREFIX.length);
}

/** How long a pending confirmation holds off a new one for the same account. */
export const LINK_CONFIRMATION_RESEND_MINUTES = 5;

/**
 * Reads the workspace's Microsoft connection and holds its row (share lock) for the rest of the
 * transaction. A sign-in or a confirmation that links an account takes it before the account's
 * row: a disconnect, which locks the workspace's row to write it and then every linked account,
 * waits for it, and one that starts after the disconnect reads the disconnected workspace and
 * links nothing.
 */
export async function lockTenantConnection(
  manager: EntityManager,
  tenantId: string,
): Promise<{ sso_provider: string | null; entra_tenant_id: string | null } | null> {
  const rows = await manager.query(
    `SELECT sso_provider, entra_tenant_id FROM tenants WHERE id = $1 FOR SHARE`,
    [tenantId],
  );
  return rows[0] ?? null;
}

/**
 * Locks the account's row for the rest of the transaction, so that requests and confirmations of
 * one account run one after the other. Returns the account, or null when it no longer exists.
 */
export async function lockAccountForLink(
  manager: EntityManager,
  tenantId: string,
  userId: string,
): Promise<{ id: string; email: string; status: string; external_auth_provider: string | null; has_password: boolean } | null> {
  const rows = await manager.query(
    `SELECT id, email, status, external_auth_provider, COALESCE(password_hash, '') <> '' AS has_password
     FROM users WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, userId],
  );
  return rows[0] ?? null;
}

/** Whether the account has a usable confirmation sent less than `LINK_CONFIRMATION_RESEND_MINUTES` ago. */
export async function hasRecentLinkConfirmation(manager: EntityManager, tenantId: string, userId: string): Promise<boolean> {
  const rows = await manager.query(
    `SELECT 1 FROM password_reset_tokens
     WHERE tenant_id = $1 AND user_id = $2 AND token_hash LIKE $3 AND used_at IS NULL AND expires_at > now()
       AND created_at > now() - make_interval(mins => $4)
     LIMIT 1`,
    [tenantId, userId, `${LINK_CONFIRMATION_HASH_PREFIX}%`, LINK_CONFIRMATION_RESEND_MINUTES],
  );
  return rows.length > 0;
}

/**
 * Stores a confirmation for the account; the account's earlier confirmations stop working. The
 * caller holds the account's row (`lockAccountForLink`).
 */
export async function storeLinkConfirmation(
  manager: EntityManager,
  input: { tenantId: string; userId: string; token: string; expiresAt: Date },
): Promise<void> {
  await manager.query(
    `UPDATE password_reset_tokens SET used_at = now()
     WHERE tenant_id = $1 AND user_id = $2 AND used_at IS NULL AND token_hash LIKE $3`,
    [input.tenantId, input.userId, `${LINK_CONFIRMATION_HASH_PREFIX}%`],
  );
  await manager.query(
    `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at, used_at)
     VALUES ($1, $2, $3, $4, NULL)`,
    [input.tenantId, input.userId, linkConfirmationHash(input.token), input.expiresAt],
  );
}

/**
 * Uses up a pending confirmation and returns the account it names; null when the link was already
 * used, replaced by a newer one, or has expired.
 */
export async function consumeLinkConfirmation(manager: EntityManager, tenantId: string, token: string): Promise<string | null> {
  const rows: Array<{ user_id: string }> = await manager.query(
    `WITH used AS (
       UPDATE password_reset_tokens SET used_at = now()
       WHERE tenant_id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id
     )
     SELECT user_id FROM used`,
    [tenantId, linkConfirmationHash(token)],
  );
  return rows[0]?.user_id ?? null;
}
