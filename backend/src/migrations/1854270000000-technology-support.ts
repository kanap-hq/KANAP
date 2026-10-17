import { MigrationInterface, QueryRunner } from 'typeorm';

/** Written as the comment of the unique key this migration adds, so down() drops only that one. */
const MARK = 'TechnologySupport1854270000000';
const LOG_PREFIX = '[Migration] TechnologySupport:';
const CONTACTS_KEY = 'contacts_tenant_id_id_key';

/**
 * The support of a technology (lot T1c), as an application has it: its support contacts (editor,
 * integrator, internal team) and its support notes.
 *
 * The applications' and the assets' support contacts live in a table per object
 * (`application_support_contacts`, `asset_support_contacts`), each with its own key to its object:
 * neither can hold a technology. `technology_support_contacts` follows them, with composite keys
 * `(tenant_id, technology_id)` and `(tenant_id, contact_id)` so that a link names a technology and a
 * contact of its own tenant (foreign-key checks bypass row level security), one row per contact
 * (UNIQUE (tenant_id, technology_id, contact_id)), RLS enabled and forced and the policy
 * `technology_support_contacts_tenant_isolation` (USING and WITH CHECK).
 *
 * 1. `contacts` gets UNIQUE (tenant_id, id) unless a unique key on these columns exists; `id` is
 *    its primary key, no row can violate it.
 * 2. `technologies.support_notes` (text, null).
 * 3. The table, its indexes, RLS and policy.
 *
 * The table is new and holds nothing: no backfill, row level security is never disabled. Every
 * step looks at the catalog or uses IF NOT EXISTS: a second run changes nothing. down() drops the
 * table, the column and the unique key this migration added.
 */
export class TechnologySupport1854270000000 implements MigrationInterface {
  name = 'TechnologySupport1854270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const added = await addUniqueIfAbsent(queryRunner, 'contacts', CONTACTS_KEY, ['tenant_id', 'id']);

    await queryRunner.query(`ALTER TABLE technologies ADD COLUMN IF NOT EXISTS support_notes text NULL`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS technology_support_contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        technology_id uuid NOT NULL,
        contact_id uuid NOT NULL,
        role text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT technology_support_contacts_role_check CHECK (role IS NULL OR char_length(role) <= 200),
        CONSTRAINT technology_support_contacts_key UNIQUE (tenant_id, technology_id, contact_id),
        CONSTRAINT technology_support_contacts_technology_fk
          FOREIGN KEY (tenant_id, technology_id) REFERENCES technologies (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT technology_support_contacts_contact_fk
          FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id) ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_technology_support_contacts_contact ON technology_support_contacts (tenant_id, contact_id)`,
    );
    await queryRunner.query(`ALTER TABLE technology_support_contacts ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE technology_support_contacts FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS technology_support_contacts_tenant_isolation ON technology_support_contacts`);
    await queryRunner.query(`
      CREATE POLICY technology_support_contacts_tenant_isolation ON technology_support_contacts
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    `);

    console.log(`${LOG_PREFIX} table and column ready, ${added ? `unique key added: ${CONTACTS_KEY}` : 'unique key already present'}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS technology_support_contacts`);
    await queryRunner.query(`ALTER TABLE IF EXISTS technologies DROP COLUMN IF EXISTS support_notes`);
    // Only the key this migration added: an equivalent key found in place is left as it was.
    const marked = await queryRunner.query(
      `SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'contacts'::regclass AND c.conname = $1
          AND obj_description(c.oid, 'pg_constraint') = $2`,
      [CONTACTS_KEY, MARK],
    );
    if (marked.length > 0) await queryRunner.query(`ALTER TABLE contacts DROP CONSTRAINT ${CONTACTS_KEY}`);
  }
}

/**
 * Adds `name` UNIQUE (columns) and marks it, unless a unique key on exactly these columns already
 * exists (a constraint or a plain unique index a foreign key can reference; an index left invalid by
 * a failed concurrent build does not count). Same check as `1854190000000`. True when added.
 */
async function addUniqueIfAbsent(queryRunner: QueryRunner, table: string, name: string, columns: string[]): Promise<boolean> {
  const existing = await queryRunner.query(
    `SELECT 1
     FROM pg_index i
     WHERE i.indrelid = $1::regclass
       AND i.indisunique AND i.indimmediate AND i.indisvalid AND i.indisready
       AND i.indpred IS NULL AND i.indexprs IS NULL
       AND i.indnkeyatts = cardinality($2::text[])
       AND (
         SELECT array_agg(a.attname::text ORDER BY a.attname::text)
         FROM unnest((i.indkey::int2[])[0:i.indnkeyatts - 1]) AS k(attnum)
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       ) = (SELECT array_agg(c ORDER BY c) FROM unnest($2::text[]) AS c)`,
    [table, columns],
  );
  if (existing.length > 0) return false;
  await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${columns.join(', ')})`);
  await queryRunner.query(`COMMENT ON CONSTRAINT ${name} ON ${table} IS '${MARK}'`);
  return true;
}
