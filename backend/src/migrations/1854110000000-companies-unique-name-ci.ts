import { MigrationInterface, QueryRunner } from 'typeorm';
import { withRlsDisabled } from '../common/migration-rls';

type Renamed = { tenant_id: string; slug: string | null; id: string; from: string; to: string };

const INDEX = 'uq_companies_tenant_name_ci';

/**
 * Company names are unique in a tenant whatever their case: UNIQUE (tenant_id, lower(name)), as for
 * suppliers (1854100000000). Before it, nothing refused two companies of the same name.
 *
 * Names equal but for case may already exist. The earliest of each group (created_at, id) keeps its
 * name; each later one is renamed "<name> (2)", "(3)"... with the first number no other company of
 * the tenant uses, whatever its case. Each rename is logged (tenant, id, old and new names). Renames
 * run tenant by tenant with app.current_tenant set, so the search index trigger writes as it does
 * for the application. A rerun finds no duplicate and changes nothing.
 *
 * down() drops the index (the renamed names stay).
 */
export class CompaniesUniqueNameCi1854110000000 implements MigrationInterface {
  name = 'CompaniesUniqueNameCi1854110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const renamed = await renameDuplicates(queryRunner);
    logRenamed(renamed);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON companies (tenant_id, lower(name))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ${INDEX}`);
  }
}

/** Renames the later companies of each (tenant, lower(name)) group and returns what it renamed. */
async function renameDuplicates(queryRunner: QueryRunner): Promise<Renamed[]> {
  // Every tenant's duplicates and names: RLS off for the read only.
  const { later, names } = await withRlsDisabled(queryRunner, ['companies'], async () => {
    const later: Array<{ tenant_id: string; slug: string | null; id: string; name: string }> = await queryRunner.query(`
      SELECT r.tenant_id, t.slug, r.id::text AS id, r.name
        FROM (
          SELECT id, tenant_id, name, created_at,
                 row_number() OVER (PARTITION BY tenant_id, lower(name) ORDER BY created_at, id) AS rn
            FROM companies
        ) r
        LEFT JOIN tenants t ON t.id = r.tenant_id
       WHERE r.rn > 1
       ORDER BY t.slug NULLS LAST, r.tenant_id, lower(r.name), r.created_at, r.id`);
    const tenants = Array.from(new Set(later.map((row) => row.tenant_id)));
    const names: Array<{ tenant_id: string; name: string }> = tenants.length === 0 ? [] : await queryRunner.query(
      `SELECT tenant_id, name FROM companies WHERE tenant_id = ANY($1::uuid[])`,
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
      await queryRunner.query(`UPDATE companies SET name = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`, [to, row.id, row.tenant_id]);
      renamed.push({ tenant_id: row.tenant_id, slug: row.slug, id: row.id, from: row.name, to });
    }
  } finally {
    await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
  }
  return renamed;
}

function logRenamed(renamed: Renamed[]) {
  const prefix = '[Migration] CompaniesUniqueNameCi:';
  if (renamed.length === 0) {
    console.log(`${prefix} no company name differs from another only by case, nothing renamed`);
    return;
  }
  for (const row of renamed) {
    console.log(`${prefix} tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}): company ${row.id} renamed "${row.from}" to "${row.to}"`);
  }
}
