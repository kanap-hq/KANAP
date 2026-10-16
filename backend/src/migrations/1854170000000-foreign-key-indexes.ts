import { createHash } from 'node:crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An index leading with the columns of every foreign key that deletes or clears its rows
 * (ON DELETE CASCADE or SET NULL). Deleting the parent row runs `DELETE` or `UPDATE ... WHERE
 * <column> = $1` on the child table: without such an index it reads the whole table, every tenant
 * included, once per deleted parent row. An index on `(tenant_id, <column>)` does not lead with the
 * column and is read in full.
 *
 * The keys are read from the catalog when the migration runs: those of 1854160000000 and the older
 * ones alike, on any schema it meets. Names are deterministic and the statements use IF NOT EXISTS,
 * so a rerun creates nothing. Plain CREATE INDEX: the pending migrations run in one transaction
 * (TypeORM `all`, scripts/migrate-and-start.js), where CREATE INDEX CONCURRENTLY cannot run. The
 * tables concerned hold at most a few thousand rows on the local demo tenant (largest: budget
 * versions, budget lines, AI history), so each build takes milliseconds while the deploy holds
 * the API anyway. The spec `common/__tests__/reference-keys.inventory.integration.spec.ts` fails on
 * a new such key without its index.
 */

const UNINDEXED_DELETING_KEYS = `
  SELECT c.conrelid::regclass::text AS table_name, c.conname,
         array_agg(a.attname::text ORDER BY k.ord) AS columns
    FROM pg_constraint c
   CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND c.confdeltype IN ('c', 'n')
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_am am ON am.oid = ic.relam
        WHERE i.indrelid = c.conrelid AND i.indisvalid AND i.indpred IS NULL AND am.amname = 'btree'
          AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
          AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey)
   GROUP BY c.conrelid, c.conname
   ORDER BY 1, 2`;

/** `ix_fk_<table>_<columns>`, shortened with a hash past PostgreSQL's 63 characters. */
function foreignKeyIndexName(table: string, columns: readonly string[]): string {
  const name = `ix_fk_${table}_${columns.join('_')}`;
  if (name.length <= 63) return name;
  return `${name.slice(0, 54)}_${createHash('md5').update(name).digest('hex').slice(0, 8)}`;
}

const PREFIX = '[Migration] ForeignKeyIndexes:';

export class ForeignKeyIndexes1854170000000 implements MigrationInterface {
  name = 'ForeignKeyIndexes1854170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const keys: Array<{ table_name: string; conname: string; columns: string[] }> = await queryRunner.query(UNINDEXED_DELETING_KEYS);
    const created = new Set<string>();
    for (const key of keys) {
      const name = foreignKeyIndexName(key.table_name, key.columns);
      // Two keys on the same columns (users carried duplicates) share one index.
      if (created.has(name)) continue;
      created.add(name);
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS ${name} ON ${key.table_name} (${key.columns.map((column) => `"${column}"`).join(', ')})`,
      );
    }
    console.log(`${PREFIX} ${created.size} index(es) created for ${keys.length} key(s) that delete or clear rows`);
  }

  /** Drops the indexes this migration names (an index of that name made otherwise goes too). */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const indexes: Array<{ name: string }> = await queryRunner.query(
      `SELECT indexrelid::regclass::text AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'ix\\_fk\\_%'`,
    );
    for (const index of indexes) await queryRunner.query(`DROP INDEX IF EXISTS ${index.name}`);
  }
}
