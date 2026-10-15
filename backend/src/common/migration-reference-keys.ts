import type { QueryRunner } from 'typeorm';
import { withRlsDisabled } from './migration-rls';

/**
 * A foreign key a migration puts on a reference column, on data nobody inspected. It never fails
 * on that data: rows that name a row missing in their tenant (a reference to another tenant's row
 * counts as missing, the application never shows it) are
 * - `keep`: left as they are, for a NOT NULL column with no value to fall back on. The key is
 *   added NOT VALID, so it checks every new write at once, and validated once no such row is left;
 * - `clear`: set to NULL, for a nullable column;
 * - `delete`: deleted, for a link row that means nothing without its target.
 * Counts are logged per tenant. The repair runs tenant by tenant with app.current_tenant set, so
 * the row triggers (search index and others) write as they do for the application. A rerun
 * validates a key left NOT VALID once its rows are fixed, and changes nothing on a key in place.
 */
export type ReferenceKey = {
  table: string;
  column: string;
  refTable: string;
  /** The key's name; the other single-column keys of the column into `refTable` are replaced by it. */
  name: string;
  onDelete: 'RESTRICT' | 'SET NULL' | 'CASCADE';
  orphans: 'keep' | 'clear' | 'delete';
};

const ACTION_CODE: Record<ReferenceKey['onDelete'], string> = { RESTRICT: 'r', 'SET NULL': 'n', CASCADE: 'c' };

type Orphans = { tenant_id: string; slug: string | null; n: number; ids: string[] };

/** The single-column keys of `table.column` into `refTable`. */
async function keysOf(queryRunner: QueryRunner, key: ReferenceKey) {
  return (await queryRunner.query(
    `SELECT c.conname, c.confdeltype AS action, c.convalidated AS validated
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.conrelid = $1::regclass AND c.confrelid = $2::regclass
        AND array_length(c.conkey, 1) = 1 AND a.attname = $3`,
    [key.table, key.refTable, key.column],
  )) as Array<{ conname: string; action: string; validated: boolean }>;
}

/** The rows naming a row missing in their tenant, per tenant (every tenant: RLS off for the read). */
async function orphansOf(queryRunner: QueryRunner, key: ReferenceKey): Promise<Orphans[]> {
  return withRlsDisabled(queryRunner, [key.table, key.refTable], () =>
    queryRunner.query(
      `SELECT x.tenant_id, t.slug, count(*)::int AS n, (array_agg(x.id::text ORDER BY x.id))[1:20] AS ids
         FROM ${key.table} x
         LEFT JOIN tenants t ON t.id = x.tenant_id
        WHERE x.${key.column} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${key.refTable} r WHERE r.id = x.${key.column} AND r.tenant_id = x.tenant_id)
        GROUP BY x.tenant_id, t.slug
        ORDER BY t.slug NULLS LAST, x.tenant_id`,
    ),
  );
}

/** Clears or deletes the rows of `orphans`, tenant by tenant with the tenant set. */
async function repair(queryRunner: QueryRunner, key: ReferenceKey, orphans: Orphans[], log: (line: string) => void) {
  const statement = key.orphans === 'clear'
    ? `UPDATE ${key.table} x SET ${key.column} = NULL`
    : `DELETE FROM ${key.table} x`;
  try {
    for (const group of orphans) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [group.tenant_id]);
      const [{ n }] = await queryRunner.query(
        `WITH changed AS (
           ${statement}
            WHERE x.tenant_id = $1 AND x.${key.column} IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM ${key.refTable} r WHERE r.id = x.${key.column} AND r.tenant_id = $1)
           RETURNING 1
         ) SELECT count(*)::int AS n FROM changed`,
        [group.tenant_id],
      );
      log(`tenant ${group.slug ?? '(unknown)'} (${group.tenant_id}): ${key.table}.${key.column}: ${n} row(s) naming a missing ${key.refTable} row ${key.orphans === 'clear' ? 'cleared' : 'deleted'}`);
    }
  } finally {
    await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
  }
}

export async function ensureReferenceKey(queryRunner: QueryRunner, key: ReferenceKey, log: (line: string) => void): Promise<void> {
  const label = `${key.table}.${key.column}`;
  const keys = await keysOf(queryRunner, key);
  const own = keys.find((k) => k.conname === key.name && k.action === ACTION_CODE[key.onDelete]);
  if (own?.validated && keys.length === 1) {
    log(`${label}: ${key.name} in place`);
    return;
  }

  let orphans = await orphansOf(queryRunner, key);
  if (orphans.length > 0 && key.orphans !== 'keep') {
    await repair(queryRunner, key, orphans, log);
    orphans = await orphansOf(queryRunner, key);
  }

  if (!own) {
    for (const k of keys) await queryRunner.query(`ALTER TABLE ${key.table} DROP CONSTRAINT ${k.conname}`);
    await queryRunner.query(
      `ALTER TABLE ${key.table} ADD CONSTRAINT ${key.name} FOREIGN KEY (${key.column}) REFERENCES ${key.refTable}(id) ON DELETE ${key.onDelete} NOT VALID`,
    );
    const was = keys.map((k) => `${k.conname} (${k.action})`).join(', ') || 'no key';
    log(`${label}: ${key.name} ON DELETE ${key.onDelete} added, replacing ${was}`);
  } else {
    for (const k of keys) if (k !== own) await queryRunner.query(`ALTER TABLE ${key.table} DROP CONSTRAINT ${k.conname}`);
  }

  if (orphans.length === 0 || own?.validated) {
    await queryRunner.query(`ALTER TABLE ${key.table} VALIDATE CONSTRAINT ${key.name}`);
    log(`${label}: ${key.name} validated`);
    return;
  }
  for (const group of orphans) {
    log(
      `tenant ${group.slug ?? '(unknown)'} (${group.tenant_id}): ${label}: ${group.n} row(s) name a missing ${key.refTable} row ` +
        `(${group.ids.join(', ')}${group.n > group.ids.length ? ', ...' : ''}); ${key.name} stays NOT VALID until they are fixed`,
    );
  }
}
