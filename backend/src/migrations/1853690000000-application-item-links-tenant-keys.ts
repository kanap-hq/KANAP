import { MigrationInterface, QueryRunner } from 'typeorm';

/** Written as the comment of each unique key this migration creates, so down() drops only those. */
const MARK = 'ApplicationItemLinksTenantKeys1853690000000';
const LOG_PREFIX = '[Migration] ApplicationItemLinksTenantKeys:';

type LinkTable = {
  table: 'application_capex_items' | 'application_spend_items';
  items: 'capex_items' | 'spend_items';
  itemFk: 'capex_item_id' | 'spend_item_id';
  /** The link's unique key on (tenant_id, application_id, itemFk). */
  unique: string;
  /** The single-column keys created by 1758908000000, restored by down(). */
  legacyAppFk: string;
  legacyItemFk: string;
  /** The composite tenant keys that replace them. */
  appFk: string;
  itemFkName: string;
};

const LINKS: LinkTable[] = [
  {
    table: 'application_capex_items',
    items: 'capex_items',
    itemFk: 'capex_item_id',
    unique: 'uq_app_capex',
    legacyAppFk: 'fk_app_capex_app',
    legacyItemFk: 'fk_app_capex_item',
    appFk: 'application_capex_items_application_fk',
    itemFkName: 'application_capex_items_capex_item_fk',
  },
  {
    table: 'application_spend_items',
    items: 'spend_items',
    itemFk: 'spend_item_id',
    unique: 'uq_app_spend',
    legacyAppFk: 'fk_app_spend_app',
    legacyItemFk: 'fk_app_spend_item',
    appFk: 'application_spend_items_application_fk',
    itemFkName: 'application_spend_items_spend_item_fk',
  },
];

const PARENTS = ['applications', 'spend_items', 'capex_items'] as const;
const TABLES = [...PARENTS, ...LINKS.map((l) => l.table)];

/** At most this many deleted links of each kind are named in the boot log. */
const LOG_ROWS = 50;

/** A deleted link, as the boot log names it. */
type DeletedLink = {
  id: string;
  tenant_id: string | null;
  application_id: string;
  item_id: string;
  /** Orphans: whether the application or the line is the missing one. */
  app_missing?: boolean;
  item_missing?: boolean;
  /** Links between tenants: the tenants of the application and of the line. */
  app_tenant?: string;
  item_tenant?: string;
};

type Repairs = {
  orphans: DeletedLink[];
  nullDeleted: DeletedLink[];
  crossTenant: DeletedLink[];
  duplicatesDeleted: number;
  nullFilled: number;
};

/**
 * Tenant keys on the links between applications and OPEX / CAPEX lines
 * (application_spend_items, application_capex_items).
 *
 * Foreign-key checks bypass RLS, so the single-column keys let a link name
 * another tenant's application or line, and application_capex_items had no
 * unique key at all (its entity declared one, no migration created it), so
 * two concurrent writes could store the same link twice. This migration
 * repairs what would violate the new keys, then adds them, on any database.
 * It runs in the migration transaction (TypeORM's default) and first locks
 * the five tables.
 *
 * 1. Repair, per link table, with RLS disabled on the link table and on the
 *    three parent tables (migrations run without app.current_tenant and FORCE
 *    binds the owner, so a read of the parents would otherwise see nothing),
 *    restored to ENABLE + FORCE afterwards, the state found:
 *    - a link whose application or line does not exist is deleted. Nobody can
 *      see it (every reader joins the parent) and ON DELETE CASCADE would have
 *      removed it. A tenant import runs with the key triggers off, so a link
 *      exported without its other tenant's line arrives this way;
 *    - a link without tenant takes its application's tenant when its line has
 *      the same one; when they differ, it is deleted;
 *    - a link whose tenant differs from its application's or its line's is
 *      deleted;
 *    - duplicates on (tenant, application, line) keep the earliest link
 *      (created_at, then id) and lose the others. A link without tenant
 *      counts under the tenant it is about to take, and the duplicates go
 *      before it takes it, so uq_app_spend never sees a clash.
 *    An application or a line without tenant (tenant_id is NOT NULL on every
 *    KANAP database) leaves its links with no tenant to be checked against:
 *    the migration stops with a sentence naming them instead of guessing.
 *    The link tables carry no trigger and nothing references them, so the
 *    deletes and the update cascade nowhere. When something was repaired, one
 *    line per table gives the counts, followed by the links deleted as
 *    orphans or across tenants (id, tenants, application, line; at most
 *    LOG_ROWS of each kind): evidence of the writes that produced them.
 * 2. tenant_id NOT NULL on both link tables (already so on every database
 *    created by 1758908000000).
 * 3. UNIQUE (tenant_id, id) on applications, spend_items and capex_items,
 *    unless an equivalent unique key exists.
 * 4. uq_app_capex UNIQUE (tenant_id, application_id, capex_item_id); the same
 *    for uq_app_spend should a database lack it (1758908000000 creates it).
 * 5. The single-column foreign keys of both link tables are replaced by
 *    (tenant_id, application_id) -> applications (tenant_id, id) and
 *    (tenant_id, item) -> the line's table (tenant_id, id), ON DELETE CASCADE
 *    as before: a link naming another tenant's application or line fails in
 *    the database, raw SQL included.
 *
 * Every step looks at the catalog before acting: a second run repairs,
 * creates and logs nothing. The unique keys this migration creates carry the
 * comment MARK, so down() can tell them from keys that existed before.
 *
 * down() drops the composite keys, restores the single-column keys and drops
 * the unique keys marked by up(). It keeps tenant_id NOT NULL and does not
 * restore the rows up() deleted: the pre-deploy snapshot is the recovery.
 */
export class ApplicationItemLinksTenantKeys1853690000000 implements MigrationInterface {
  name = 'ApplicationItemLinksTenantKeys1853690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await lockTables(queryRunner);
    for (const table of TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
    const repaired: Array<[LinkTable, Repairs]> = [];
    for (const link of LINKS) {
      repaired.push([link, await repair(queryRunner, link)]);
    }
    for (const table of TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    for (const [link, counts] of repaired) logRepairs(link, counts);

    for (const link of LINKS) {
      const [{ notnull }] = await queryRunner.query(
        `SELECT attnotnull AS notnull FROM pg_attribute WHERE attrelid = $1::regclass AND attname = 'tenant_id'`,
        [link.table],
      );
      if (!notnull) await queryRunner.query(`ALTER TABLE ${link.table} ALTER COLUMN tenant_id SET NOT NULL`);
    }

    for (const table of PARENTS) {
      await addUniqueIfAbsent(queryRunner, table, `${table}_tenant_id_id_key`, ['tenant_id', 'id']);
    }
    for (const link of LINKS) {
      await addUniqueIfAbsent(queryRunner, link.table, link.unique, ['tenant_id', 'application_id', link.itemFk]);
    }

    for (const link of LINKS) {
      for (const name of await singleColumnKeys(queryRunner, link.table, 'application_id', 'applications')) {
        await queryRunner.query(`ALTER TABLE ${link.table} DROP CONSTRAINT "${name}"`);
      }
      for (const name of await singleColumnKeys(queryRunner, link.table, link.itemFk, link.items)) {
        await queryRunner.query(`ALTER TABLE ${link.table} DROP CONSTRAINT "${name}"`);
      }
      if (!(await hasConstraint(queryRunner, link.table, link.appFk))) {
        await queryRunner.query(`
          ALTER TABLE ${link.table}
          ADD CONSTRAINT ${link.appFk} FOREIGN KEY (tenant_id, application_id)
          REFERENCES applications (tenant_id, id) ON DELETE CASCADE
        `);
      }
      if (!(await hasConstraint(queryRunner, link.table, link.itemFkName))) {
        await queryRunner.query(`
          ALTER TABLE ${link.table}
          ADD CONSTRAINT ${link.itemFkName} FOREIGN KEY (tenant_id, ${link.itemFk})
          REFERENCES ${link.items} (tenant_id, id) ON DELETE CASCADE
        `);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows deleted by up() are not restored; tenant_id stays NOT NULL.
    await lockTables(queryRunner);
    for (const link of LINKS) {
      await queryRunner.query(`ALTER TABLE ${link.table} DROP CONSTRAINT IF EXISTS ${link.appFk}`);
      await queryRunner.query(`ALTER TABLE ${link.table} DROP CONSTRAINT IF EXISTS ${link.itemFkName}`);
      if ((await singleColumnKeys(queryRunner, link.table, 'application_id', 'applications')).length === 0) {
        await queryRunner.query(`
          ALTER TABLE ${link.table}
          ADD CONSTRAINT ${link.legacyAppFk} FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
        `);
      }
      if ((await singleColumnKeys(queryRunner, link.table, link.itemFk, link.items)).length === 0) {
        await queryRunner.query(`
          ALTER TABLE ${link.table}
          ADD CONSTRAINT ${link.legacyItemFk} FOREIGN KEY (${link.itemFk}) REFERENCES ${link.items}(id) ON DELETE CASCADE
        `);
      }
    }
    for (const table of TABLES) {
      const marked: Array<{ name: string }> = await queryRunner.query(
        `SELECT conname AS name FROM pg_constraint
         WHERE conrelid = $1::regclass AND contype = 'u' AND obj_description(oid, 'pg_constraint') = $2`,
        [table, MARK],
      );
      for (const { name } of marked) {
        await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT "${name}"`);
      }
    }
  }
}

/**
 * The five tables, exclusively, until the migration transaction ends, taken
 * up front in one statement: no write lands between the repair and the new
 * keys, and no later statement of the migration waits for a lock. LOCK TABLE
 * refuses to run outside a transaction, so a run without one stops here,
 * before any change.
 */
async function lockTables(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`LOCK TABLE ${TABLES.join(', ')} IN ACCESS EXCLUSIVE MODE`);
}

/**
 * Stops the migration when a link's application or line has no tenant: there
 * is nothing to check the link's tenant against. tenant_id is NOT NULL on the
 * three parent tables of every KANAP database, so this only guards a damaged one.
 */
async function assertParentsHaveTenant(queryRunner: QueryRunner, link: LinkTable): Promise<void> {
  const rows: Array<{ id: string; total: number }> = await queryRunner.query(`
    SELECT l.id, count(*) OVER ()::int AS total
    FROM ${link.table} l
    JOIN applications a ON a.id = l.application_id
    JOIN ${link.items} i ON i.id = l.${link.itemFk}
    WHERE a.tenant_id IS NULL OR i.tenant_id IS NULL
    ORDER BY l.id
    LIMIT 20
  `);
  if (rows.length === 0) return;
  throw new Error(
    `${LOG_PREFIX} ${rows[0].total} row(s) of ${link.table} link an application or a line that has no tenant, ` +
      `so their tenant cannot be checked (ids: ${rows.map((r) => r.id).join(', ')}${rows[0].total > rows.length ? ', ...' : ''}). ` +
      `Give these applications and lines their tenant, then run the migrations again.`,
  );
}

async function repair(queryRunner: QueryRunner, link: LinkTable): Promise<Repairs> {
  const { table, items, itemFk } = link;
  const count = async (sql: string): Promise<number> => (await queryRunner.query(sql))[0].n;

  // The application or the line does not exist: the link is dead.
  const orphans: DeletedLink[] = await queryRunner.query(`
    WITH d AS (
      DELETE FROM ${table} l
      WHERE NOT EXISTS (SELECT 1 FROM applications a WHERE a.id = l.application_id)
         OR NOT EXISTS (SELECT 1 FROM ${items} i WHERE i.id = l.${itemFk})
      RETURNING l.id, l.tenant_id, l.application_id, l.${itemFk} AS item_id,
        NOT EXISTS (SELECT 1 FROM applications a WHERE a.id = l.application_id) AS app_missing,
        NOT EXISTS (SELECT 1 FROM ${items} i WHERE i.id = l.${itemFk}) AS item_missing
    )
    SELECT * FROM d ORDER BY id
  `);
  await assertParentsHaveTenant(queryRunner, link);

  // No tenant, and the application and the line belong to different tenants.
  const nullDeleted: DeletedLink[] = await queryRunner.query(`
    WITH d AS (
      DELETE FROM ${table} l
      USING applications a, ${items} i
      WHERE a.id = l.application_id AND i.id = l.${itemFk}
        AND l.tenant_id IS NULL AND a.tenant_id <> i.tenant_id
      RETURNING l.id, l.tenant_id, l.application_id, l.${itemFk} AS item_id, a.tenant_id AS app_tenant, i.tenant_id AS item_tenant
    )
    SELECT * FROM d ORDER BY id
  `);
  const crossTenant: DeletedLink[] = await queryRunner.query(`
    WITH d AS (
      DELETE FROM ${table} l
      USING applications a, ${items} i
      WHERE a.id = l.application_id AND i.id = l.${itemFk}
        AND l.tenant_id IS NOT NULL AND (l.tenant_id <> a.tenant_id OR l.tenant_id <> i.tenant_id)
      RETURNING l.id, l.tenant_id, l.application_id, l.${itemFk} AS item_id, a.tenant_id AS app_tenant, i.tenant_id AS item_tenant
    )
    SELECT * FROM d ORDER BY id
  `);
  // What remains has a consistent tenant, or none with application and line agreeing:
  // COALESCE gives the tenant each link has or is about to take.
  const duplicatesDeleted = await count(`
    WITH ranked AS (
      SELECT l.id, row_number() OVER (
        PARTITION BY COALESCE(l.tenant_id, a.tenant_id), l.application_id, l.${itemFk}
        ORDER BY l.created_at ASC NULLS LAST, l.id ASC
      ) AS rn
      FROM ${table} l
      JOIN applications a ON a.id = l.application_id
    ),
    d AS (
      DELETE FROM ${table} l
      USING ranked r
      WHERE l.id = r.id AND r.rn > 1
      RETURNING l.id
    )
    SELECT count(*)::int AS n FROM d
  `);
  const nullFilled = await count(`
    WITH u AS (
      UPDATE ${table} l
      SET tenant_id = a.tenant_id
      FROM applications a
      WHERE a.id = l.application_id AND l.tenant_id IS NULL
      RETURNING l.id
    )
    SELECT count(*)::int AS n FROM u
  `);
  return { orphans, nullDeleted, crossTenant, duplicatesDeleted, nullFilled };
}

function logRepairs(link: LinkTable, counts: Repairs) {
  const { orphans, nullDeleted, crossTenant, duplicatesDeleted, nullFilled } = counts;
  if (orphans.length + nullDeleted.length + crossTenant.length + duplicatesDeleted + nullFilled === 0) return;
  console.log(
    `${LOG_PREFIX} ${link.table}: ${orphans.length} link(s) to a missing application or line deleted, ` +
      `${duplicatesDeleted} duplicate link(s) deleted, ` +
      `${crossTenant.length} link(s) to another tenant's application or line deleted, ` +
      `${nullFilled} link(s) without tenant given their application's tenant, ` +
      `${nullDeleted.length} link(s) without tenant deleted (application and line of different tenants)`,
  );
  const missing = (gone?: boolean) => (gone ? ' (missing)' : '');
  logRows('missing application or line', orphans, (r) =>
    `link ${r.id} (tenant ${r.tenant_id ?? 'none'}): application ${r.application_id}${missing(r.app_missing)}, line ${r.item_id}${missing(r.item_missing)}`,
  );
  logRows('another tenant', crossTenant, (r) =>
    `link ${r.id} (tenant ${r.tenant_id}): application ${r.application_id} (tenant ${r.app_tenant}), line ${r.item_id} (tenant ${r.item_tenant})`,
  );
  logRows('without tenant', nullDeleted, (r) =>
    `link ${r.id}: application ${r.application_id} (tenant ${r.app_tenant}), line ${r.item_id} (tenant ${r.item_tenant})`,
  );
}

function logRows(kind: string, rows: DeletedLink[], describe: (row: DeletedLink) => string) {
  for (const row of rows.slice(0, LOG_ROWS)) console.log(`  ${kind}: deleted ${describe(row)}`);
  if (rows.length > LOG_ROWS) console.log(`  ${kind}: ... and ${rows.length - LOG_ROWS} more`);
}

/**
 * Adds `name` UNIQUE (columns) and marks it, unless a unique key on exactly
 * these columns already exists (as a constraint or a plain unique index that
 * a foreign key can reference; an index left invalid by a failed concurrent
 * build does not count).
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

/** Names of the foreign keys of `table` on `column` alone that reference `parent`. */
async function singleColumnKeys(queryRunner: QueryRunner, table: string, column: string, parent: string): Promise<string[]> {
  const rows: Array<{ name: string }> = await queryRunner.query(
    `SELECT c.conname AS name
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = $3
     WHERE c.contype = 'f' AND c.conrelid = $1::regclass AND c.confrelid = $2::regclass
       AND c.conkey = ARRAY[a.attnum]::int2[]
     ORDER BY c.conname`,
    [table, parent, column],
  );
  return rows.map((r) => r.name);
}

async function hasConstraint(queryRunner: QueryRunner, table: string, name: string): Promise<boolean> {
  const rows = await queryRunner.query(`SELECT 1 FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2`, [
    table,
    name,
  ]);
  return rows.length > 0;
}
