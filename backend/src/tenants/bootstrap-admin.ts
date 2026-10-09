import * as argon2 from 'argon2';
import { DataSource, EntityManager } from 'typeorm';
import { Role } from '../roles/role.entity';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.entity';
import { RolePermission } from '../permissions/role-permission.entity';
import { RESOURCES } from '../permissions/permissions.service';
import { BOOTSTRAP_PASSWORD_WARNING, isWeakBootstrapPassword } from '../common/startup-secrets';

export type BootstrapAdministratorOutcome = 'tenant-missing' | 'created' | 'restored' | 'unchanged';

export type BootstrapAdministratorResult = {
  outcome: BootstrapAdministratorOutcome;
  /** `[SECURITY]` lines for the caller to print once per start. */
  warnings: string[];
};

export type BootstrapAdministratorParams = {
  tenantSlug: string;
  email: string;
  password: string;
  /**
   * Compare the account's password with `password` (at most one argon2 verification) and report a
   * published example value or a short one. The lead process only, so the line prints once.
   */
  checkPassword: boolean;
  /** Prefix of the log lines, for example `[on-prem] `. */
  logPrefix?: string;
};

/**
 * An active administrator: an enabled user of the tenant who holds the Administrator role (as main
 * role `users.role_id` or through a `user_roles` link) and can sign in with its main role. Password
 * sign-in accepts a main role that is Administrator or not a system role (auth.service.ts); sign-in
 * through the identity provider accepts any main role. So a local account whose main role is
 * Contact does not count, even with an Administrator link.
 */
const ACTIVE_ADMINISTRATOR_EXISTS = `
  SELECT EXISTS (
    SELECT 1 FROM users u
      JOIN roles main ON main.tenant_id = u.tenant_id AND main.id = u.role_id
     WHERE u.tenant_id = $1
       AND u.status = 'enabled'
       AND (
         lower(main.role_name) = 'administrator'
         OR EXISTS (
           SELECT 1 FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
            WHERE ur.tenant_id = u.tenant_id AND ur.user_id = u.id
              AND lower(r.role_name) = 'administrator'
         )
       )
       AND (
         lower(main.role_name) = 'administrator'
         OR NOT coalesce(main.is_system, false)
         OR u.external_auth_provider IS NOT NULL
       )
  ) AS found`;

/**
 * The administrator account of `ADMIN_EMAIL`, at start-up (`SEED_ADMIN=true`, and every
 * single-tenant start). The Administrator and Contact system roles and the Administrator
 * permissions are kept in place. The account itself is created only when the tenant has no active
 * administrator, and an existing account is never changed, except in that same case: then it is
 * restored as an enabled administrator whose only primary role is Administrator, its password kept
 * (set from `password` only for a local account that has none; an account of the identity provider
 * gets no local password). Runs in one transaction in the tenant's context.
 */
export async function ensureBootstrapAdministrator(
  dataSource: DataSource,
  params: BootstrapAdministratorParams,
): Promise<BootstrapAdministratorResult> {
  const prefix = params.logPrefix ?? '';
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const [tenant] = await runner.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [params.tenantSlug]);
    const tenantId = tenant?.id as string | undefined;
    if (!tenantId) {
      // eslint-disable-next-line no-console
      console.warn(`${prefix}Admin seed skipped: tenant '${params.tenantSlug}' not found`);
      await runner.rollbackTransaction();
      return { outcome: 'tenant-missing', warnings: [] };
    }
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await runner.query(`SELECT set_config('app.default_tenant_slug', $1, true)`, [params.tenantSlug]);

    const manager = runner.manager;
    const adminRole = await ensureSystemRoles(manager, tenantId);

    const [account]: Array<{ id: string; password_hash: string | null; external_auth_provider: string | null }> = await manager.query(
      `SELECT id, password_hash, external_auth_provider FROM users WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
      [tenantId, params.email],
    );
    const [{ found: hasActiveAdministrator }] = await manager.query(ACTIVE_ADMINISTRATOR_EXISTS, [tenantId]);

    let outcome: BootstrapAdministratorOutcome;
    // Whether the account's password was set from `password` by this call.
    let passwordSetNow = false;
    if (hasActiveAdministrator) {
      outcome = 'unchanged';
      // eslint-disable-next-line no-console
      console.log(
        `${prefix}Administrator account ${params.email} ${account ? 'left unchanged' : 'not created'}: the workspace has an active administrator`,
      );
    } else if (!account) {
      const userRepo = manager.getRepository(User);
      const saved = await userRepo.save(userRepo.create({
        email: params.email,
        password_hash: await argon2.hash(params.password, { type: argon2.argon2id }),
        tenant_id: tenantId,
        role_id: adminRole.id,
        status: 'enabled',
      }));
      await ensurePrimaryUserRole(manager, tenantId, saved.id, adminRole.id);
      outcome = 'created';
      passwordSetNow = true;
      // eslint-disable-next-line no-console
      console.log(`${prefix}Created administrator account ${params.email}: the workspace had no active administrator`);
    } else {
      await manager.query(
        `UPDATE users SET role_id = $3, status = 'enabled', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, account.id, adminRole.id],
      );
      // A local account without a password (a directory contact, an invitation) gets the start-up
      // one, otherwise nobody could sign in with it. An account of the identity provider never
      // holds a local password (auth.service.ts, password reset).
      const signsInThroughProvider = account.external_auth_provider != null;
      passwordSetNow = !account.password_hash && !signsInThroughProvider && params.password.trim() !== '';
      if (passwordSetNow) {
        await manager.query(
          `UPDATE users SET password_hash = $3 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, account.id, await argon2.hash(params.password, { type: argon2.argon2id })],
        );
      }
      await ensurePrimaryUserRole(manager, tenantId, account.id, adminRole.id);
      outcome = 'restored';
      // eslint-disable-next-line no-console
      console.warn(
        `${prefix}Restored ${params.email} as an enabled administrator: the workspace had no active administrator`
          + (passwordSetNow
            ? ' (password set from ADMIN_PASSWORD: the account had none)'
            : signsInThroughProvider && !account.password_hash
              ? ' (no local password: the account signs in through the identity provider; without it, see the Password Reset section of the on-premise operations guide)'
              : ' (password unchanged)'),
      );
    }

    await runner.commitTransaction();

    const warnings: string[] = [];
    if (params.checkPassword && isWeakBootstrapPassword(params.password)) {
      const storedHash = account?.password_hash ?? null;
      const accountUsesPassword = passwordSetNow
        || (storedHash !== null && (await passwordMatches(storedHash, params.password)));
      if (accountUsesPassword) warnings.push(BOOTSTRAP_PASSWORD_WARNING);
    }
    return { outcome, warnings };
  } catch (err) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
  }
}

async function passwordMatches(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A stored value that is not an argon2 hash cannot be the start-up password.
    return false;
  }
}

/** The Administrator and Contact system roles, and full permissions for Administrator on every resource. */
async function ensureSystemRoles(manager: EntityManager, tenantId: string): Promise<Role> {
  const roleRepo = manager.getRepository(Role);
  const rolePermRepo = manager.getRepository(RolePermission);
  const ensureRole = async (roleName: string, description: string): Promise<Role> => {
    let role = await roleRepo.findOne({ where: { tenant_id: tenantId, role_name: roleName } });
    if (!role) {
      role = await roleRepo.save(roleRepo.create({ tenant_id: tenantId, role_name: roleName, role_description: description, is_system: true }));
    }
    if (!role.is_system) {
      role.is_system = true as any;
      await roleRepo.save(role);
    }
    return role;
  };
  const adminRole = await ensureRole('Administrator', 'Full system administrator with access to all features');
  await ensureRole('Contact', 'Directory contact without app access by default');

  for (const resource of RESOURCES) {
    const existing = await rolePermRepo.findOne({ where: { tenant_id: tenantId, role_id: adminRole.id, resource } });
    if (!existing) {
      await rolePermRepo.save(rolePermRepo.create({ tenant_id: tenantId, role_id: adminRole.id, resource, level: 'admin' as any }));
    } else if (existing.level !== 'admin') {
      existing.level = 'admin' as any;
      await rolePermRepo.save(existing);
    }
  }
  return adminRole;
}

/**
 * The user's link to the Administrator role, marked primary, and the only primary one: the role
 * screens list primary links first and save the first one as the main role. Other links are kept.
 */
async function ensurePrimaryUserRole(manager: EntityManager, tenantId: string, userId: string, roleId: string) {
  await manager.query(
    `UPDATE user_roles SET is_primary = false WHERE tenant_id = $1 AND user_id = $2 AND role_id <> $3 AND is_primary`,
    [tenantId, userId, roleId],
  );
  const userRoleRepo = manager.getRepository(UserRole);
  const existing = await userRoleRepo.findOne({ where: { tenant_id: tenantId, user_id: userId, role_id: roleId } });
  if (!existing) {
    await userRoleRepo.save(userRoleRepo.create({ tenant_id: tenantId, user_id: userId, role_id: roleId, is_primary: true }));
  } else if (!existing.is_primary) {
    existing.is_primary = true;
    await userRoleRepo.save(existing);
  }
}
