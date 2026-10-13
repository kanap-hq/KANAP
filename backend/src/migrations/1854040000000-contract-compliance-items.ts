import { MigrationInterface, QueryRunner } from 'typeorm';

/** Written as the comment of the unique key this migration adds to `contracts`, so down() drops only that one. */
const MARK = 'ContractComplianceItems1854040000000';
const CONTRACTS_TENANT_KEY = 'contracts_tenant_id_id_key';

/**
 * The compliance register of the contracts (lot CC): one row per contract and requirement, holding
 * what the user recorded (state, reference, who and when). What a contract is expected to hold is
 * computed on the fly from its applications and assets (`contracts/contract-compliance.ts`), never
 * stored. `requirement` is a text code with no check constraint: v1 has a fixed list in code, and a
 * list per tenant can come later without a migration.
 *
 * 1. `contracts` gets UNIQUE (tenant_id, id), unless a unique key on exactly these columns exists:
 *    `id` is the primary key, so no row can violate it and nothing needs repairing.
 * 2. `contract_compliance_items`, with RLS (ENABLE + FORCE) and the policy
 *    `contract_compliance_items_tenant_isolation` (USING and WITH CHECK). Its contract is referenced
 *    by (tenant_id, contract_id) -> contracts (tenant_id, id) ON DELETE CASCADE: foreign-key checks
 *    bypass RLS, so the composite key is what stops a row from naming another tenant's contract, and
 *    the rows go with their contract like the contract's other links.
 *
 * The table is new and holds nothing yet: there is no backfill, and RLS is never disabled. Every
 * step looks at the catalog or uses IF NOT EXISTS, so a second run changes nothing.
 */
export class ContractComplianceItems1854040000000 implements MigrationInterface {
  name = 'ContractComplianceItems1854040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await addUniqueIfAbsent(queryRunner, 'contracts', CONTRACTS_TENANT_KEY, ['tenant_id', 'id']);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contract_compliance_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        contract_id uuid NOT NULL,
        requirement text NOT NULL,
        state text NULL,
        reference text NULL,
        updated_by uuid NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT contract_compliance_items_state_check
          CHECK (state IS NULL OR state IN ('present', 'absent', 'not_applicable')),
        CONSTRAINT contract_compliance_items_reference_check
          CHECK (reference IS NULL OR char_length(reference) <= 500),
        CONSTRAINT contract_compliance_items_requirement_check
          CHECK (requirement ~ '^[a-z][a-z0-9_]{0,63}$'),
        CONSTRAINT contract_compliance_items_contract_requirement_key
          UNIQUE (tenant_id, contract_id, requirement),
        CONSTRAINT contract_compliance_items_contract_fk
          FOREIGN KEY (tenant_id, contract_id) REFERENCES contracts (tenant_id, id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`ALTER TABLE contract_compliance_items ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE contract_compliance_items FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS contract_compliance_items_tenant_isolation ON contract_compliance_items`);
    await queryRunner.query(`
      CREATE POLICY contract_compliance_items_tenant_isolation ON contract_compliance_items
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS contract_compliance_items`);
    // Only the key this migration added: an equivalent key found in place is left as it was.
    const marked = await queryRunner.query(
      `SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'contracts'::regclass AND c.conname = $1
          AND obj_description(c.oid, 'pg_constraint') = $2`,
      [CONTRACTS_TENANT_KEY, MARK],
    );
    if (marked.length > 0) await queryRunner.query(`ALTER TABLE contracts DROP CONSTRAINT ${CONTRACTS_TENANT_KEY}`);
  }
}

/**
 * Adds `name` UNIQUE (columns) and marks it, unless a unique key on exactly these columns already
 * exists (a constraint or a plain unique index a foreign key can reference; an index left invalid by
 * a failed concurrent build does not count). Same check as `1853690000000`.
 */
async function addUniqueIfAbsent(queryRunner: QueryRunner, table: string, name: string, columns: string[]): Promise<void> {
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
  if (existing.length > 0) return;
  await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${columns.join(', ')})`);
  await queryRunner.query(`COMMENT ON CONSTRAINT ${name} ON ${table} IS '${MARK}'`);
}
