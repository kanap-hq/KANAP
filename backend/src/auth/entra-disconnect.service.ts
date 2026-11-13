import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { EntityManager } from 'typeorm';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import { writeAuditLog } from '../audit/audit.service';
import { LINK_CONFIRMATION_HASH_PREFIX } from './entra-link-confirmation';

/** The shortest password, as for a password reset (`CompletePasswordResetDto`). */
export const LOCAL_PASSWORD_MIN_LENGTH = 8;

/**
 * What removing the workspace's Microsoft connection does to its accounts, for the confirmation:
 * among the linked accounts that may sign in with a password (enabled or invited, main role other
 * than Contact), how many keep a password and how many have none and set one with "Forgot
 * password". The administrator who disconnects counts with those who keep one: without a password,
 * they set it in the same confirmation (`password_required`).
 */
export type DisconnectSummary = {
  keep_password: number;
  need_password: number;
  password_required: boolean;
};

/** The SQL condition of an account linked to an identity provider. */
const LINKED = `(u.external_auth_provider IS NOT NULL OR u.external_subject IS NOT NULL)`;

/**
 * Removing the workspace's Microsoft connection (Administration > Authentication, Disconnect).
 * Every linked account of the workspace becomes local in the same transaction: its link is
 * removed, a password it holds stays, and "Forgot password" works for it again. No e-mail is sent.
 */
@Injectable()
export class EntraDisconnectService {
  constructor(
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
  ) {}

  async summary(manager: EntityManager, tenantId: string, actorId: string | null): Promise<DisconnectSummary> {
    const [row] = await manager.query(
      `SELECT
         count(*) FILTER (WHERE a.linked AND a.can_sign_in AND (a.has_password OR a.is_actor))::int AS keep_password,
         count(*) FILTER (WHERE a.linked AND a.can_sign_in AND NOT a.has_password AND NOT a.is_actor)::int AS need_password,
         COALESCE(bool_or(a.is_actor AND NOT a.has_password), false) AS password_required
       FROM (
         SELECT u.id = $2::uuid AS is_actor,
                ${LINKED} AS linked,
                COALESCE(u.password_hash, '') <> '' AS has_password,
                u.status IN ('enabled', 'invited') AND lower(trim(COALESCE(r.role_name, ''))) <> 'contact' AS can_sign_in
           FROM users u
           LEFT JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
          WHERE u.tenant_id = $1 AND (${LINKED} OR u.id = $2::uuid)
       ) a`,
      [tenantId, actorId],
    );
    return {
      keep_password: row?.keep_password ?? 0,
      need_password: row?.need_password ?? 0,
      password_required: row?.password_required === true,
    };
  }

  /**
   * Removes the connection in the caller's transaction (the request's). Locks, in this order: the
   * workspace's row, which a Microsoft sign-in that links an account holds while it does
   * (`lockTenantConnection`, FOR SHARE), then the accounts' rows by id (`lockPeople` order). The
   * workspace's row is taken FOR NO KEY UPDATE: it excludes that share lock, and leaves free the
   * key share lock every foreign key to the workspace takes, so the workspace's other writes go on
   * during a disconnect. An administrator
   * without a password gives one (`password`, at least `LOCAL_PASSWORD_MIN_LENGTH` characters),
   * written with the rest; one who has a password keeps it and `password` is ignored. A refusal
   * writes nothing. Pending link confirmations stop working: once connected again, an existing
   * account is linked by a new confirmation.
   */
  async disconnect(
    manager: EntityManager,
    input: { tenantId: string; actorId: string | null; password?: unknown },
  ): Promise<{ unlinked: number; entraTenantId: string }> {
    const { tenantId, actorId } = input;
    const [tenant] = await manager.query(
      `SELECT sso_provider, sso_enabled, entra_tenant_id FROM tenants WHERE id = $1 FOR NO KEY UPDATE`,
      [tenantId],
    );
    if (!tenant || tenant.sso_provider !== 'entra' || !tenant.entra_tenant_id) {
      throw new ConflictException({
        statusCode: 409,
        code: 'SSO_NOT_CONNECTED',
        message: 'Microsoft sign-in is not connected for this workspace.',
      });
    }

    const accounts: Array<{ id: string; is_actor: boolean; linked: boolean; has_password: boolean }> = await manager.query(
      `SELECT u.id, u.id = $2::uuid AS is_actor, ${LINKED} AS linked, COALESCE(u.password_hash, '') <> '' AS has_password
         FROM users u
        WHERE u.tenant_id = $1 AND (${LINKED} OR u.id = $2::uuid)
        ORDER BY u.id
        FOR UPDATE`,
      [tenantId, actorId],
    );
    const actor = accounts.find((account) => account.is_actor);
    const setsPassword = !!actor && !actor.has_password;
    if (setsPassword) {
      const password = input.password;
      if (typeof password !== 'string' || password.length < LOCAL_PASSWORD_MIN_LENGTH) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LOCAL_PASSWORD_REQUIRED',
          message: `Set a password of at least ${LOCAL_PASSWORD_MIN_LENGTH} characters for your own account to disconnect Microsoft sign-in.`,
        });
      }
      const hash = await argon2.hash(password, { type: argon2.argon2id });
      await manager.query(`UPDATE users SET password_hash = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, actor!.id, hash]);
    }

    const unlinked = await this.users.unlinkExternalSignIns(
      accounts.filter((account) => account.linked).map((account) => account.id),
      actorId,
      { manager, sourceRef: 'entra-disconnect' },
    );
    await manager.query(
      `UPDATE password_reset_tokens SET used_at = now()
        WHERE tenant_id = $1 AND used_at IS NULL AND token_hash LIKE $2`,
      [tenantId, `${LINK_CONFIRMATION_HASH_PREFIX}%`],
    );
    await this.tenants.updateTenant(
      tenantId,
      { sso_provider: 'none' as any, sso_enabled: false as any, entra_tenant_id: null as any, entra_metadata: null as any },
      { manager },
    );
    await writeAuditLog(manager, {
      table: 'tenants',
      recordId: tenantId,
      action: 'update',
      before: {
        sso_provider: tenant.sso_provider,
        entra_tenant_id: tenant.entra_tenant_id,
        sso_enabled: !!tenant.sso_enabled,
      },
      after: {
        sso_provider: 'none',
        entra_tenant_id: null,
        sso_enabled: false,
        accounts_made_local: unlinked.length,
        own_password_set: setsPassword,
      },
      userId: actorId,
      sourceRef: 'entra-disconnect',
    });
    return { unlinked: unlinked.length, entraTenantId: tenant.entra_tenant_id };
  }
}
