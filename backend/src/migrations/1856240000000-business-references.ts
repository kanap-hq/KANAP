import { MigrationInterface, QueryRunner } from 'typeorm';
import { withRlsDisabled } from '../common/migration-rls';

/** The types item_sequences accepted before (1854190000000), read from the database on 2026-11-15. */
const TYPES_BEFORE = `'task', 'request', 'project', 'document', 'application', 'asset', 'location', 'connection', 'interface', 'spend', 'capex', 'incident', 'contributor', 'technology'`;

type Family = {
  table: string;
  /** item_sequences.entity_type, as in SequenceEntityType (common/item-number.service.ts). */
  type: string;
  /** Shown before the number (SUP-3) and indexed with it; never stored on the row. */
  prefix: string;
  alias: string;
  label: string;
  summary: string;
  status: string;
  extra: string;
  /** Weight A of the vector, without the reference. */
  vectorA: string[];
  vectorBC: string;
  joins: string;
};

/** The five families, with their search index rows as 1854500000000 left them (label, summary, vector). */
const FAMILIES: Family[] = [
  {
    table: 'suppliers',
    type: 'supplier',
    prefix: 'SUP',
    alias: 's',
    label: 's.name',
    summary: `COALESCE(NULLIF(s.notes, ''), s.erp_supplier_id)`,
    status: 's.status::text',
    extra: `jsonb_build_object('erp_supplier_id', s.erp_supplier_id)`,
    vectorA: ['s.name'],
    vectorBC: `search_index_tsv('B', s.erp_supplier_id) || search_index_tsv('C', s.notes)`,
    joins: '',
  },
  {
    table: 'companies',
    type: 'company',
    prefix: 'COMP',
    alias: 'c',
    label: 'c.name',
    summary: `NULLIF(CONCAT_WS(', ', c.city, c.country_iso), '')`,
    status: 'c.status::text',
    extra: `jsonb_build_object('base_currency', c.base_currency)`,
    vectorA: ['c.name'],
    vectorBC: `search_index_tsv('B', CONCAT_WS(' ', c.country_iso, c.base_currency)) || search_index_tsv('C', CONCAT_WS(' ', c.city, c.address1, c.address2, c.postal_code, c.reg_number, c.vat_number, c.notes))`,
    joins: '',
  },
  {
    table: 'contacts',
    type: 'contact',
    prefix: 'CTCT',
    alias: 'c',
    label: `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.email)`,
    summary: `NULLIF(CONCAT_WS(' | ', c.job_title, sup.name, c.country), '')`,
    status: `CASE WHEN c.active THEN 'active' ELSE 'inactive' END`,
    extra: `jsonb_build_object('supplier', sup.name)`,
    vectorA: ['c.first_name', 'c.last_name', 'c.email'],
    vectorBC: `search_index_tsv('B', c.country) || search_index_tsv('C', CONCAT_WS(' ', c.job_title, c.phone, c.mobile, c.notes, sup.name))`,
    joins: 'LEFT JOIN suppliers sup ON sup.id = c.supplier_id AND sup.tenant_id = c.tenant_id',
  },
  {
    table: 'departments',
    type: 'department',
    prefix: 'DEPT',
    alias: 'd',
    label: 'd.name',
    summary: `COALESCE(NULLIF(d.description, ''), comp.name)`,
    status: 'd.status::text',
    extra: `jsonb_build_object('company', comp.name)`,
    vectorA: ['d.name'],
    vectorBC: `search_index_tsv('B', d.status::text) || search_index_tsv('C', CONCAT_WS(' ', d.description, comp.name))`,
    joins: 'LEFT JOIN companies comp ON comp.id = d.company_id AND comp.tenant_id = d.tenant_id',
  },
  {
    table: 'contracts',
    type: 'contract',
    prefix: 'CTR',
    alias: 'c',
    label: 'c.name',
    summary: `COALESCE(NULLIF(c.notes, ''), NULLIF(CONCAT_WS(' | ', comp.name, sup.name), ''))`,
    status: 'c.status::text',
    extra: `jsonb_build_object('company', comp.name, 'supplier', sup.name)`,
    vectorA: ['c.name'],
    vectorBC: `search_index_tsv('B', CONCAT_WS(' ', c.currency, c.billing_frequency)) || search_index_tsv('C', CONCAT_WS(' ', c.notes, comp.name, sup.name))`,
    joins: `LEFT JOIN companies comp ON comp.id = c.company_id AND comp.tenant_id = c.tenant_id
      LEFT JOIN suppliers sup ON sup.id = c.supplier_id AND sup.tenant_id = c.tenant_id`,
  },
];

const TYPES_AFTER = `${TYPES_BEFORE}, ${FAMILIES.map((f) => `'${f.type}'`).join(', ')}`;

/**
 * Takes the next number of the row's tenant in item_sequences when the row has none (the
 * application never writes it), as allocateSingle does; a number given (a copy, a restore, a seed)
 * is kept and the counter moved past it, never back. SECURITY INVOKER: item_sequences is under the
 * tenant policy and the limited role may write it. The type comes as the trigger's argument, so
 * the body names no table but item_sequences.
 */
const ASSIGN_FUNCTION = `
  CREATE OR REPLACE FUNCTION assign_item_number()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
  DECLARE
    allocated integer;
  BEGIN
    IF NEW.item_number IS NULL THEN
      INSERT INTO item_sequences (tenant_id, entity_type, next_val)
      VALUES (NEW.tenant_id, TG_ARGV[0], 2)
      ON CONFLICT (tenant_id, entity_type)
      DO UPDATE SET next_val = item_sequences.next_val + 1
      RETURNING next_val - 1 INTO allocated;
      NEW.item_number := allocated;
    ELSE
      INSERT INTO item_sequences (tenant_id, entity_type, next_val)
      VALUES (NEW.tenant_id, TG_ARGV[0], NEW.item_number + 1)
      ON CONFLICT (tenant_id, entity_type)
      DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val);
    END IF;
    RETURN NEW;
  END
  $fn$
`;

/** The refresh of a family's search index rows; `withReference` adds the prefix, the number and "SUP-3" at weight A. */
function refreshFunction(f: Family, withReference: boolean): string {
  const a = f.alias;
  const vectorA = withReference
    ? `CONCAT_WS(' ', '${f.prefix}-' || ${a}.item_number::text, ${f.vectorA.join(', ')})`
    : f.vectorA.length === 1 ? f.vectorA[0] : `CONCAT_WS(' ', ${f.vectorA.join(', ')})`;
  return `
  CREATE OR REPLACE FUNCTION search_index_refresh_${f.table}(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    DELETE FROM search_index si_del
    WHERE si_del.tenant_id = p_tenant
      AND si_del.entity_type = '${f.table}'
      AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
      AND NOT EXISTS (
        SELECT 1 FROM ${f.table} src
        WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
      );
    INSERT INTO search_index (
      tenant_id, entity_type, entity_id, ref_prefix, ref_number,
      label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
    )
    SELECT ${a}.tenant_id,
           '${f.table}',
           ${a}.id,
           ${withReference ? `'${f.prefix}'` : 'NULL'},
           ${withReference ? `${a}.item_number` : 'NULL'},
           ${f.label},
           ${f.summary},
           ${f.status},
           ${f.extra},
           search_index_tsv('A', ${vectorA}) || ${f.vectorBC},
           ${a}.updated_at,
           now()
    FROM ${f.table} ${a}
    ${f.joins}
    WHERE ${a}.tenant_id = p_tenant
      AND (p_ids IS NULL OR ${a}.id = ANY(p_ids))
    ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
      ref_prefix = EXCLUDED.ref_prefix,
      ref_number = EXCLUDED.ref_number,
      label = EXCLUDED.label,
      summary = EXCLUDED.summary,
      status = EXCLUDED.status,
      extra_json = EXCLUDED.extra_json,
      search_vector = EXCLUDED.search_vector,
      source_updated_at = EXCLUDED.source_updated_at,
      indexed_at = EXCLUDED.indexed_at;
  $fn$
`;
}

type FamilyResult = { tenants: number; numbered: number; repaired: number; reindexed: number; ms: number };

const LOG = '[Migration] BusinessReferences:';

/**
 * Business references for the suppliers, companies, contacts, departments and contracts (lot R1 of
 * release 26.11.9): an integer `item_number` per tenant, shown as SUP-n, COMP-n, CTCT-n, DEPT-n and
 * CTR-n (the prefix is never stored).
 *
 * 1. The column, and a BEFORE INSERT trigger on each table (`trg_<table>_item_number`,
 *    `assign_item_number('<type>')`) that takes the next number in item_sequences when the row has
 *    none: no creation path, raw seeds included, can leave a row without its number.
 * 2. item_sequences accepts the five types (the check copied from the database, plus five).
 * 3. The search index refresh of each family carries the reference (ref_prefix, ref_number, and
 *    "SUP-3" at weight A), SECURITY DEFINER and search_path repeated.
 * 4. Backfill, tenant by tenant with app.current_tenant set, the search index triggers of the five
 *    tables off meanwhile and each tenant's index refreshed once afterwards. Repair first: a number
 *    held by several rows stays with the earliest (created_at, id), the others lose it, as does a
 *    number below 1. The rows without a number are then numbered in (created_at, id) order after the
 *    tenant's highest number and its counter, and the counter is put past the highest number, never
 *    back. Counts per table: tenants, rows numbered, rows repaired, index refreshed, duration.
 * 5. UNIQUE (tenant_id, item_number), then NOT NULL.
 *
 * A rerun finds nothing to number and says so. The pending migrations share one transaction:
 * app.current_tenant is put back as found. down() removes the column, the triggers, the counters
 * of the five types and the reference from the index.
 */
export class BusinessReferences1856240000000 implements MigrationInterface {
  name = 'BusinessReferences1856240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    for (const f of FAMILIES) {
      await queryRunner.query(`ALTER TABLE ${f.table} ADD COLUMN IF NOT EXISTS item_number integer`);
    }
    await withRlsDisabled(queryRunner, ['item_sequences'], async () => {
      await queryRunner.query(`ALTER TABLE item_sequences DROP CONSTRAINT IF EXISTS item_sequences_entity_type_check`);
      await queryRunner.query(`
        ALTER TABLE item_sequences
        ADD CONSTRAINT item_sequences_entity_type_check
        CHECK (entity_type IN (${TYPES_AFTER}))
      `);
    });
    await queryRunner.query(ASSIGN_FUNCTION);
    for (const f of FAMILIES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS trg_${f.table}_item_number ON ${f.table}`);
      await queryRunner.query(`
        CREATE TRIGGER trg_${f.table}_item_number
        BEFORE INSERT ON ${f.table}
        FOR EACH ROW
        EXECUTE FUNCTION assign_item_number('${f.type}')
      `);
      await queryRunner.query(refreshFunction(f, true));
    }

    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    try {
      for (const f of FAMILIES) {
        const result = await backfill(queryRunner, f);
        if (result.numbered === 0 && result.repaired === 0) {
          console.log(`${LOG} ${f.table}: nothing to number (${result.tenants} tenant(s), ${result.reindexed} index refresh(es), ${result.ms} ms)`);
        } else {
          console.log(`${LOG} ${f.table}: ${result.numbered} row(s) numbered in ${result.tenants} tenant(s), ${result.repaired} repaired, ${result.reindexed} index refresh(es), ${result.ms} ms`);
        }
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    for (const f of FAMILIES) {
      await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_${f.table}_tenant_item_number ON ${f.table} (tenant_id, item_number)`);
      await queryRunner.query(`ALTER TABLE ${f.table} ALTER COLUMN item_number SET NOT NULL`);
    }
    console.log(`${LOG} done in ${Date.now() - started} ms`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    for (const f of FAMILIES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS trg_${f.table}_item_number ON ${f.table}`);
      await queryRunner.query(refreshFunction(f, false));
      await queryRunner.query(`DROP INDEX IF EXISTS uq_${f.table}_tenant_item_number`);
      await queryRunner.query(`ALTER TABLE ${f.table} DROP COLUMN IF EXISTS item_number`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS assign_item_number()`);

    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id::text AS id FROM tenants ORDER BY id`);
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        for (const f of FAMILIES) await queryRunner.query(`SELECT search_index_refresh_${f.table}($1::uuid)`, [tenant.id]);
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    await withRlsDisabled(queryRunner, ['item_sequences'], async () => {
      await queryRunner.query(`DELETE FROM item_sequences WHERE entity_type = ANY($1::text[])`, [FAMILIES.map((f) => f.type)]);
      await queryRunner.query(`ALTER TABLE item_sequences DROP CONSTRAINT IF EXISTS item_sequences_entity_type_check`);
      await queryRunner.query(`
        ALTER TABLE item_sequences
        ADD CONSTRAINT item_sequences_entity_type_check
        CHECK (entity_type IN (${TYPES_BEFORE}))
      `);
    });
  }
}

/** Repairs and numbers one family, tenant by tenant, and refreshes the index of the tenants it changed. */
async function backfill(queryRunner: QueryRunner, f: Family): Promise<FamilyResult> {
  const started = Date.now();
  // Every tenant holding a row, whether or not the tenants table still lists it: RLS off for this read only.
  const tenants: Array<{ tenant_id: string }> = await withRlsDisabled(queryRunner, [f.table], () =>
    queryRunner.query(`SELECT DISTINCT tenant_id::text AS tenant_id FROM ${f.table} ORDER BY 1`));
  const result: FamilyResult = { tenants: tenants.length, numbered: 0, repaired: 0, reindexed: 0, ms: 0 };
  await queryRunner.query(`ALTER TABLE ${f.table} DISABLE TRIGGER trg_search_index_${f.table}`);
  try {
    for (const { tenant_id: tenantId } of tenants) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const [{ n: repaired }]: Array<{ n: number }> = await queryRunner.query(
        `WITH ranked AS (
           SELECT id, row_number() OVER (PARTITION BY item_number ORDER BY created_at, id) AS rn
             FROM ${f.table}
            WHERE tenant_id = $1 AND item_number IS NOT NULL
         ),
         cleared AS (
           UPDATE ${f.table} t SET item_number = NULL
             FROM ranked r
            WHERE t.id = r.id AND t.tenant_id = $1 AND (r.rn > 1 OR t.item_number < 1)
           RETURNING 1
         )
         SELECT count(*)::int AS n FROM cleared`,
        [tenantId],
      );
      const [{ n: numbered }]: Array<{ n: number }> = await queryRunner.query(
        `WITH base AS (
           SELECT GREATEST(
             COALESCE((SELECT max(item_number) FROM ${f.table} WHERE tenant_id = $1), 0),
             COALESCE((SELECT next_val - 1 FROM item_sequences WHERE tenant_id = $1 AND entity_type = $2), 0)
           ) AS last
         ),
         ordered AS (
           SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
             FROM ${f.table}
            WHERE tenant_id = $1 AND item_number IS NULL
         ),
         numbered AS (
           UPDATE ${f.table} t SET item_number = base.last + o.rn
             FROM ordered o, base
            WHERE t.id = o.id AND t.tenant_id = $1
           RETURNING 1
         )
         SELECT count(*)::int AS n FROM numbered`,
        [tenantId, f.type],
      );
      await queryRunner.query(
        `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
         SELECT $1::uuid, $2, max(item_number) + 1 FROM ${f.table} WHERE tenant_id = $1
         HAVING max(item_number) IS NOT NULL
         ON CONFLICT (tenant_id, entity_type)
         DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val)`,
        [tenantId, f.type],
      );
      const [{ stale }]: Array<{ stale: boolean }> = await queryRunner.query(
        `SELECT EXISTS (
           SELECT 1 FROM ${f.table} t
             LEFT JOIN search_index si
               ON si.tenant_id = t.tenant_id AND si.entity_type = $2 AND si.entity_id = t.id
            WHERE t.tenant_id = $1 AND si.ref_number IS DISTINCT FROM t.item_number
         ) AS stale`,
        [tenantId, f.table],
      );
      if (numbered > 0 || repaired > 0 || stale) {
        await queryRunner.query(`SELECT search_index_refresh_${f.table}($1::uuid)`, [tenantId]);
        result.reindexed += 1;
      }
      result.numbered += numbered;
      result.repaired += repaired;
    }
  } finally {
    await queryRunner.query(`ALTER TABLE ${f.table} ENABLE TRIGGER trg_search_index_${f.table}`);
  }
  result.ms = Date.now() - started;
  return result;
}
