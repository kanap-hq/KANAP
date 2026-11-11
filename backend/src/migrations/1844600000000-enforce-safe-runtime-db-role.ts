import { MigrationInterface, QueryRunner } from "typeorm";

type RoleStateRow = {
  current_user: string;
  is_superuser: boolean | 't' | 'f';
  can_bypass_rls: boolean | 't' | 'f';
};

function toBoolean(value: boolean | 't' | 'f' | null | undefined): boolean {
  return value === true || value === 't';
}

function isProtectedRole(roleName: string): boolean {
  return roleName === 'postgres' || roleName.startsWith('pg_');
}

function formatFlags(role: { isSuperuser: boolean; canBypassRls: boolean }): string {
  const flags: string[] = [];
  if (role.isSuperuser) flags.push('SUPERUSER');
  if (role.canBypassRls) flags.push('BYPASSRLS');
  return flags.join(', ');
}

export class EnforceSafeRuntimeDbRole1844600000000 implements MigrationInterface {
  name = 'EnforceSafeRuntimeDbRole1844600000000'

  private async loadRoleState(queryRunner: QueryRunner): Promise<{
    currentUser: string;
    isSuperuser: boolean;
    canBypassRls: boolean;
  }> {
    const rows = await queryRunner.query(`
      SELECT current_user AS current_user,
             COALESCE(r.rolsuper, false) AS is_superuser,
             COALESCE(r.rolbypassrls, false) AS can_bypass_rls
      FROM pg_roles r
      WHERE r.rolname = current_user
    `) as RoleStateRow[];

    const row = rows?.[0];
    if (!row?.current_user) {
      throw new Error('Unable to determine PostgreSQL role safety for current_user');
    }

    return {
      currentUser: String(row.current_user),
      isSuperuser: toBoolean(row.is_superuser),
      canBypassRls: toBoolean(row.can_bypass_rls),
    };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const current = await this.loadRoleState(queryRunner);
    if (!current.isSuperuser && !current.canBypassRls) {
      return;
    }

    const currentFlags = formatFlags(current);
    if (isProtectedRole(current.currentUser)) {
      throw new Error(
        `Unsafe DATABASE_URL role "${current.currentUser}" with ${currentFlags}. `
        + 'Kadratis refuses to run migrations as protected cluster-admin PostgreSQL roles. '
        + 'Create a dedicated application role without SUPERUSER/BYPASSRLS and point DATABASE_URL to it.',
      );
    }

    console.log(
      `[Migration] Hardening PostgreSQL role "${current.currentUser}" from ${currentFlags} to NOSUPERUSER NOBYPASSRLS`,
    );
    try {
      await queryRunner.query(`
        DO $$ BEGIN
          EXECUTE format('ALTER ROLE %I NOSUPERUSER NOBYPASSRLS', current_user);
        END $$;
      `);
    } catch (error: any) {
      const detail = typeof error?.detail === 'string' ? error.detail : '';
      const message = typeof error?.message === 'string' ? error.message : String(error);
      const bootstrapRoleFailure = /bootstrap user/i.test(detail) || /bootstrap user/i.test(message);
      if (error?.code === '0A000' && bootstrapRoleFailure) {
        throw new Error(
          `Unsafe DATABASE_URL role "${current.currentUser}" with ${currentFlags}. `
          + 'PostgreSQL will not remove SUPERUSER from the cluster bootstrap role. '
          + 'Use a dedicated application role for DATABASE_URL instead of the initdb/bootstrap user, then rerun migrations.',
        );
      }
      throw error;
    }

    const hardened = await this.loadRoleState(queryRunner);
    if (hardened.isSuperuser || hardened.canBypassRls) {
      throw new Error(
        `Failed to harden PostgreSQL role "${hardened.currentUser}" for native RLS enforcement. `
        + `Current flags: ${formatFlags(hardened)}`,
      );
    }

    console.log(
      `[Migration] PostgreSQL role "${hardened.currentUser}" is ready for native RLS enforcement`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op: never re-grant SUPERUSER or BYPASSRLS on rollback
  }
}
