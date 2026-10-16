import { MigrationInterface, QueryRunner } from 'typeorm';
import { withRlsDisabled } from '../common/migration-rls';

type Renamed = { tenant_id: string; slug: string | null; id: string; from: string; to: string };

const INDEX = 'uq_suppliers_tenant_name_ci';
const OLD_CONSTRAINT = 'uq_suppliers_tenant_name';

/**
 * Supplier names are unique in a tenant whatever their case: UNIQUE (tenant_id, lower(name))
 * replaces the case-sensitive UNIQUE (tenant_id, name). The service already refused "sap" when
 * "SAP" existed; the index makes the database agree.
 *
 * Names that differ only by case may exist from before the service check. The earliest of each
 * group (created_at, id) keeps its name; each later one is renamed "<name> (2)", "(3)"... with the
 * first number no other supplier of the tenant uses, whatever its case. Each rename is logged
 * (tenant, id, old and new names). Renames run tenant by tenant with app.current_tenant set, so the
 * search index trigger writes as it does for the application. A rerun finds no duplicate and
 * changes nothing.
 *
 * down() puts back the case-sensitive constraint (the renamed names stay).
 */
export class SuppliersUniqueNameCi1854100000000 implements MigrationInterface {
  name = 'SuppliersUniqueNameCi1854100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const renamed = await renameDuplicates(queryRunner);
    logRenamed(renamed);
    await queryRunner.query(`ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS ${OLD_CONSTRAINT}`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON suppliers (tenant_id, lower(name))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ${INDEX}`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'suppliers'::regclass AND conname = '${OLD_CONSTRAINT}') THEN
          ALTER TABLE suppliers ADD CONSTRAINT ${OLD_CONSTRAINT} UNIQUE (tenant_id, name);
        END IF;
      END $$;
    `);
  }
}

/** Renames the later suppliers of each (tenant, lower(name)) group and returns what it renamed. */
async function renameDuplicates(queryRunner: QueryRunner): Promise<Renamed[]> {
  // Every tenant's duplicates and names: RLS off for the read only.
  const { later, names } = await withRlsDisabled(queryRunner, ['suppliers'], async () => {
    const later: Array<{ tenant_id: string; slug: string | null; id: string; name: string }> = await queryRunner.query(`
      SELECT r.tenant_id, t.slug, r.id::text AS id, r.name
        FROM (
          SELECT id, tenant_id, name, created_at,
                 row_number() OVER (PARTITION BY tenant_id, lower(name) ORDER BY created_at, id) AS rn
            FROM suppliers
        ) r
        LEFT JOIN tenants t ON t.id = r.tenant_id
       WHERE r.rn > 1
       ORDER BY t.slug NULLS LAST, r.tenant_id, lower(r.name), r.created_at, r.id`);
    const tenants = Array.from(new Set(later.map((row) => row.tenant_id)));
    const names: Array<{ tenant_id: string; name: string }> = tenants.length === 0 ? [] : await queryRunner.query(
      `SELECT tenant_id, name FROM suppliers WHERE tenant_id = ANY($1::uuid[])`,
      [tenants],
    );
    return { later, names };
  });
  if (later.length === 0) return [];

  const taken = new Map<string, Set<string>>();
  for (const row of names) {
    const set = taken.get(row.tenant_id) ?? new Set<string>();
    set.add(row.name.toLowerCase());
    taken.set(row.tenant_id, set);
  }
  const renamed: Renamed[] = [];
  try {
    for (const row of later) {
      const used = taken.get(row.tenant_id)!;
      let n = 2;
      while (used.has(`${row.name} (${n})`.toLowerCase())) n += 1;
      const to = `${row.name} (${n})`;
      used.add(to.toLowerCase());
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [row.tenant_id]);
      await queryRunner.query(`UPDATE suppliers SET name = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`, [to, row.id, row.tenant_id]);
      renamed.push({ tenant_id: row.tenant_id, slug: row.slug, id: row.id, from: row.name, to });
    }
  } finally {
    await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
  }
  return renamed;
}

function logRenamed(renamed: Renamed[]) {
  const prefix = '[Migration] SuppliersUniqueNameCi:';
  if (renamed.length === 0) {
    console.log(`${prefix} no supplier name differs from another only by case, nothing renamed`);
    return;
  }
  for (const row of renamed) {
    console.log(`${prefix} tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}): supplier ${row.id} renamed "${row.from}" to "${row.to}"`);
  }
}
