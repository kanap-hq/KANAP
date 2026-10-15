import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foreign keys on the references of a contract, which had none: a supplier or a company that a
 * contract names can no longer be deleted (ON DELETE RESTRICT), and a deleted owner leaves the
 * contract without one (ON DELETE SET NULL, like the owners of cost centers, business processes,
 * incidents and budget lines).
 *
 * `supplier_id` and `company_id` are NOT NULL: a contract whose supplier or company is missing
 * cannot be repaired here. The migration looks for such contracts first, across every tenant, and
 * fails before adding any key when it finds one, listing tenant, contract and the missing
 * reference. A reference to a row of another tenant counts as missing: the application never
 * shows it. Fix those contracts (choose an existing supplier or company), then deploy again.
 * An owner that is missing, or belongs to another tenant, is cleared (logged per tenant).
 *
 * Read-only check to run on a server before the deploy, in psql as a superuser (RLS does not
 * apply to it; as the table owner, run it once per tenant after
 * `SELECT set_config('app.current_tenant', '<tenant uuid>', true)`):
 *
 *   BEGIN READ ONLY;
 *   SELECT t.slug, c.tenant_id, c.id, c.name,
 *          s.id IS NULL AS supplier_missing, co.id IS NULL AS company_missing,
 *          c.owner_user_id IS NOT NULL AND u.id IS NULL AS owner_missing
 *     FROM contracts c
 *     LEFT JOIN tenants t ON t.id = c.tenant_id
 *     LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.tenant_id = c.tenant_id
 *     LEFT JOIN companies co ON co.id = c.company_id AND co.tenant_id = c.tenant_id
 *     LEFT JOIN users u ON u.id = c.owner_user_id AND u.tenant_id = c.tenant_id
 *    WHERE s.id IS NULL OR co.id IS NULL OR (c.owner_user_id IS NOT NULL AND u.id IS NULL)
 *    ORDER BY t.slug, c.name;
 *   ROLLBACK;
 *
 * Rows with `supplier_missing` or `company_missing` stop this migration; `owner_missing` ones
 * are cleared by it.
 *
 * Migrations run without app.current_tenant and FORCE RLS applies to the owner, so RLS is
 * disabled on the four tables around the reads, then put back as found. The owner repair runs
 * per tenant with app.current_tenant set, since an update of a contract refreshes its search
 * index row through a trigger. A rerun adds only the keys still missing.
 */

type Key = { name: string; column: string; table: string; onDelete: 'RESTRICT' | 'SET NULL' };

const KEYS: readonly Key[] = [
  { name: 'fk_contracts_supplier', column: 'supplier_id', table: 'suppliers', onDelete: 'RESTRICT' },
  { name: 'fk_contracts_company', column: 'company_id', table: 'companies', onDelete: 'RESTRICT' },
  { name: 'fk_contracts_owner_user', column: 'owner_user_id', table: 'users', onDelete: 'SET NULL' },
];

const READ_TABLES = ['contracts', 'suppliers', 'companies', 'users'] as const;

const PREFIX = '[Migration] ContractsReferenceKeys:';

type Orphan = {
  slug: string | null;
  tenant_id: string;
  id: string;
  name: string;
  supplier_missing: boolean;
  company_missing: boolean;
};

type OrphanOwner = { slug: string | null; tenant_id: string; id: string };

export class ContractsReferenceKeys1854070000000 implements MigrationInterface {
  name = 'ContractsReferenceKeys1854070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = new Set<string>(
      (
        await queryRunner.query(
          `SELECT conname FROM pg_constraint WHERE conrelid = 'contracts'::regclass AND contype = 'f' AND conname = ANY($1)`,
          [KEYS.map((key) => key.name)],
        )
      ).map((row: { conname: string }) => row.conname),
    );
    const missing = KEYS.filter((key) => !existing.has(key.name));
    if (missing.length === 0) {
      console.log(`${PREFIX} the keys exist, nothing to do`);
      return;
    }

    const { orphans, owners } = await withRlsDisabled(queryRunner, READ_TABLES, async () => ({
      orphans: (await queryRunner.query(`
        SELECT t.slug, c.tenant_id, c.id, c.name,
               s.id IS NULL AS supplier_missing, co.id IS NULL AS company_missing
          FROM contracts c
          LEFT JOIN tenants t ON t.id = c.tenant_id
          LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.tenant_id = c.tenant_id
          LEFT JOIN companies co ON co.id = c.company_id AND co.tenant_id = c.tenant_id
         WHERE s.id IS NULL OR co.id IS NULL
         ORDER BY t.slug NULLS LAST, c.tenant_id, lower(c.name), c.id
      `)) as Orphan[],
      owners: (await queryRunner.query(`
        SELECT t.slug, c.tenant_id, c.id
          FROM contracts c
          LEFT JOIN tenants t ON t.id = c.tenant_id
         WHERE c.owner_user_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.owner_user_id AND u.tenant_id = c.tenant_id)
         ORDER BY t.slug NULLS LAST, c.tenant_id, c.id
      `)) as OrphanOwner[],
    }));

    if (orphans.length > 0) {
      throw new Error(orphanReport(orphans));
    }
    console.log(`${PREFIX} every contract names an existing supplier and company of its tenant`);

    await clearOwners(queryRunner, owners);

    for (const key of missing) {
      await queryRunner.query(
        `ALTER TABLE contracts ADD CONSTRAINT ${key.name} FOREIGN KEY (${key.column}) REFERENCES ${key.table}(id) ON DELETE ${key.onDelete}`,
      );
      console.log(`${PREFIX} added ${key.name} (contracts.${key.column} -> ${key.table}, ON DELETE ${key.onDelete})`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const key of KEYS) {
      await queryRunner.query(`ALTER TABLE contracts DROP CONSTRAINT IF EXISTS ${key.name}`);
    }
  }
}

/** Runs `fn` with RLS disabled on `tables`, then puts back the state found (ENABLE, FORCE). */
async function withRlsDisabled<T>(queryRunner: QueryRunner, tables: readonly string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ relname: string; enabled: boolean; forced: boolean }> = await queryRunner.query(
    `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
       FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`,
    [tables],
  );
  for (const table of tables) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  try {
    return await fn();
  } finally {
    for (const state of states) {
      if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.relname} ENABLE ROW LEVEL SECURITY`);
      if (state.forced) await queryRunner.query(`ALTER TABLE ${state.relname} FORCE ROW LEVEL SECURITY`);
    }
  }
}

/** Clears the missing owners, tenant by tenant with the tenant set (the search index trigger writes as it). */
async function clearOwners(queryRunner: QueryRunner, owners: OrphanOwner[]): Promise<void> {
  if (owners.length === 0) {
    console.log(`${PREFIX} no contract owner to clear`);
    return;
  }
  const byTenant = new Map<string, OrphanOwner[]>();
  for (const row of owners) byTenant.set(row.tenant_id, [...(byTenant.get(row.tenant_id) ?? []), row]);
  try {
    for (const [tenantId, rows] of byTenant) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const [{ n }] = await queryRunner.query(
        `WITH changed AS (
           UPDATE contracts SET owner_user_id = NULL
            WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND owner_user_id IS NOT NULL
           RETURNING 1
         ) SELECT count(*)::int AS n FROM changed`,
        [tenantId, rows.map((row) => row.id)],
      );
      console.log(`${PREFIX} tenant ${rows[0].slug ?? '(unknown)'} (${tenantId}): owner cleared on ${n} contract(s) (owner missing): ${rows.map((row) => row.id).join(', ')}`);
    }
  } finally {
    await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
  }
}

function orphanReport(orphans: Orphan[]): string {
  const lines = orphans.map((row) => {
    const what = [row.supplier_missing ? 'supplier' : null, row.company_missing ? 'company' : null].filter(Boolean).join(' and ');
    return `  tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}): contract ${row.id} "${row.name}": ${what} missing`;
  });
  return [
    `${PREFIX} ${orphans.length} contract(s) name a supplier or a company that does not exist in their tenant. ` +
      'No key was added. Choose an existing supplier or company on these contracts, then run the migrations again:',
    ...lines,
  ].join('\n');
}
