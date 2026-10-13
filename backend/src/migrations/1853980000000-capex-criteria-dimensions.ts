import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] CapexCriteriaDimensions:';
/** Rows named in a tenant's log line (precedent 1853690000000). */
const NAMED_ROWS = 50;
/** The tables up() writes, analyzed at its end (in the transaction, like lot Z1). */
const ANALYZED_TABLES = ['analytics_axes', 'analytics_categories', 'spend_item_analytics_values'];

/**
 * The three CAPEX criteria and their dimensions: the column of `spend_items` (its enum type), the
 * dimension's code (the column's name), its English name, its values in the enum's order with the
 * enum value each replaces. A copy of `analytics/capex-dimensions.seed.ts` (a migration never
 * depends on application code, which moves); a spec checks both are equal.
 */
export const CAPEX_CRITERIA = [
  {
    code: 'ppe_type',
    enumType: 'ppe_type',
    name: 'PP&E type',
    values: [
      { key: 'hardware', name: 'Hardware' },
      { key: 'software', name: 'Software' },
    ],
  },
  {
    code: 'investment_type',
    enumType: 'capex_investment_type',
    name: 'Investment type',
    values: [
      { key: 'replacement', name: 'Replacement' },
      { key: 'capacity', name: 'Capacity' },
      { key: 'productivity', name: 'Productivity' },
      { key: 'security', name: 'Security' },
      { key: 'conformity', name: 'Conformity' },
      { key: 'business_growth', name: 'Business growth' },
      { key: 'other', name: 'Other' },
    ],
  },
  {
    code: 'priority',
    enumType: 'priority_level',
    name: 'Priority',
    values: [
      { key: 'mandatory', name: 'Mandatory' },
      { key: 'high', name: 'High' },
      { key: 'medium', name: 'Medium' },
      { key: 'low', name: 'Low' },
    ],
  },
] as const;

type Criterion = (typeof CAPEX_CRITERIA)[number];

/** The seed's statements, a copy of `CAPEX_DIMENSION_SQL` (`analytics/capex-dimensions.seed.ts`); a spec checks both are equal. */
export const CAPEX_DIMENSION_SQL = {
  /** The tenant's dimension of a code (unique per tenant, case-insensitive), whatever its settings. */
  findAxis: `SELECT id::text AS id, name, applies_to, required, status::text AS status, sort_order
       FROM analytics_axes
      WHERE tenant_id = $1 AND lower(code) = lower($2)`,
  /** Whether a dimension of the tenant already has the name (unique per tenant, case-insensitive). */
  nameTaken: `SELECT EXISTS (SELECT 1 FROM analytics_axes WHERE tenant_id = $1 AND lower(name) = lower($2)) AS taken`,
  /** A new CAPEX dimension, after the tenant's last one (D4): used for CAPEX lines, required, enabled. */
  insertAxis: `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, applies_to, required, status)
     SELECT $1, $2, $3, LEAST(coalesce(max(a.sort_order), 0)::bigint + 1, 2147483647)::int, 'capex', true, 'enabled'
       FROM analytics_axes a
      WHERE a.tenant_id = $1
     ON CONFLICT DO NOTHING
     RETURNING id::text AS id`,
  /** A value the dimension lacks (by name, case-insensitive), after its last one (D3), for both line types. */
  insertValue: `INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order, status)
     SELECT $1, $2, $3, LEAST(coalesce(max(c.sort_order), 0)::bigint + 1, 2147483647)::int, 'enabled'
       FROM analytics_categories c
      WHERE c.tenant_id = $1 AND c.axis_id = $2
     HAVING NOT coalesce(bool_or(lower(c.name) = lower($3)), false)
     ON CONFLICT DO NOTHING
     RETURNING id::text AS id`,
} as const;

/** The names a new dimension tries, in order, while a dimension of the tenant holds one (copy of the seed's; not exported: TypeORM reads every exported function of a migration file as a migration). */
function capexDimensionNameCandidate(name: string, attempt: number): string {
  if (attempt === 0) return name;
  return attempt === 1 ? `${name} (CAPEX)` : `${name} (CAPEX ${attempt})`;
}

/** Row level security is lifted on these (migrations run without app.current_tenant), restored as found. */
const RLS_TABLES = ['analytics_axes', 'analytics_categories', 'spend_item_analytics_values', 'spend_items', 'search_index'];

/* ---- The CAPEX line entry of the search index (1853960000000's, recopied: its helpers are private) ---- */

const ANALYTICS_EXTRA = `CASE WHEN la.analytics_display IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('analytics', la.analytics_display) END`;
const ANALYTICS_VECTOR = `search_index_tsv('B', la.analytics_text)`;
const UPSERT = `ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
        ref_prefix = EXCLUDED.ref_prefix,
        ref_number = EXCLUDED.ref_number,
        label = EXCLUDED.label,
        summary = EXCLUDED.summary,
        status = EXCLUDED.status,
        extra_json = EXCLUDED.extra_json,
        search_vector = EXCLUDED.search_vector,
        source_updated_at = EXCLUDED.source_updated_at,
        indexed_at = EXCLUDED.indexed_at`;

/** The CAPEX number of a line of `spend_items` (its legacy `CPX-n`), its own number when it has none. */
const CPX_NUMBER = (alias: string) => `COALESCE((substring(${alias}.legacy_number FROM '^CPX-([0-9]+)$'))::int, ${alias}.item_number)`;

/** 1853960000000's `refreshFunctionSql` for the CAPEX lines of `spend_items`. */
function capexRefreshSql(select: string): string {
  const table = 'spend_items';
  const lineWhere = `nature = 'capex'`;
  const alias = 'ci';
  const from = `FROM spend_items ci
        LEFT JOIN companies comp ON comp.id = ci.paying_company_id AND comp.tenant_id = ci.tenant_id
        LEFT JOIN suppliers sup ON sup.id = ci.supplier_id AND sup.tenant_id = ci.tenant_id
        LEFT JOIN LATERAL search_index_line_analytics(ci.tenant_id, 'capex', ci.id) la ON true`;
  const byIds = (ids: boolean, column: string) => (ids ? `\n           AND ${column} = ANY (p_ids)` : '');
  const purge = (ids: boolean) => `DELETE FROM search_index si_del
         WHERE si_del.tenant_id = p_tenant
           AND si_del.entity_type = 'capex_items'${byIds(ids, 'si_del.entity_id')}
           AND NOT EXISTS (
             SELECT 1 FROM ${table} src
             WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant AND src.${lineWhere}
           );`;
  const upsert = (ids: boolean) => `INSERT INTO search_index (
          tenant_id, entity_type, entity_id, ref_prefix, ref_number,
          label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
        )
        ${select}
        ${from}
         WHERE ${alias}.tenant_id = p_tenant AND ${alias}.${lineWhere}${byIds(ids, `${alias}.id`)}
        ${UPSERT};`;
  return `
    CREATE OR REPLACE FUNCTION search_index_refresh_capex_items(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
    RETURNS void LANGUAGE plpgsql AS $fn$
    BEGIN
      IF p_ids IS NULL THEN
        ${purge(false)}
        ${upsert(false)}
      ELSE
        ${purge(true)}
        ${upsert(true)}
      END IF;
    END
    $fn$
  `;
}

/** The entry's columns; `criteria` adds the three CAPEX enums to the summary and the B terms (lot Z1's body). */
function capexEntrySelect(criteria: boolean): string {
  const summaryCriteria = criteria ? ', ci.ppe_type::text, ci.investment_type' : '';
  const termCriteria = criteria ? 'ci.ppe_type::text, ci.investment_type, ci.priority, ' : '';
  return `SELECT ci.tenant_id,
             'capex_items',
             ci.id,
             'CPX',
             ${CPX_NUMBER('ci')},
             ci.product_name,
             NULLIF(CONCAT_WS(' | ', comp.name, sup.name${summaryCriteria}), ''),
             ci.status::text,
             jsonb_build_object('paying_company', comp.name, 'supplier', sup.name) || ${ANALYTICS_EXTRA},
             search_index_tsv('A', CONCAT_WS(' ', 'CPX-' || ${CPX_NUMBER('ci')}::text, ci.product_name))
               || search_index_tsv('B', CONCAT_WS(' ', ${termCriteria}ci.currency))
               || ${ANALYTICS_VECTOR}
               || search_index_tsv('C', CONCAT_WS(' ', ci.notes, comp.name, sup.name)),
             ci.updated_at,
             now()`;
}

/** The CAPEX entry without the three enums: their values are the line's dimension values (lot S, already indexed). */
export const CAPEX_REFRESH = capexRefreshSql(capexEntrySelect(false));
/** Lot Z1's body (1853960000000), for down(). */
export const CAPEX_REFRESH_PREVIOUS = capexRefreshSql(capexEntrySelect(true));

type TenantRow = { id: string; slug: string | null };

const tenantName = (tenant: TenantRow) => `${tenant.slug || '(no slug)'} (${tenant.id})`;

/** An UPDATE or INSERT through the query runner: every count goes through a CTE. */
async function countOf(queryRunner: QueryRunner, statement: string, params: unknown[] = []): Promise<number> {
  const [{ n }]: Array<{ n: number }> = await queryRunner.query(`WITH changed AS (${statement} RETURNING 1) SELECT count(*)::int AS n FROM changed`, params);
  return n;
}

async function scalar(queryRunner: QueryRunner, sql: string, params: unknown[] = []): Promise<number> {
  const [{ n }]: Array<{ n: number | string | null }> = await queryRunner.query(sql, params);
  return Number(n ?? 0);
}

/** The ids of up to `limit` rows a query returns, as text. */
async function ids(queryRunner: QueryRunner, sql: string, params: unknown[] = [], limit = NAMED_ROWS): Promise<string[]> {
  const rows: Array<{ id: string }> = await queryRunner.query(`SELECT x.id::text AS id FROM (${sql}) x LIMIT ${limit}`, params);
  return rows.map((row) => row.id);
}

const named = (list: string[], total: number) => `${list.join(', ')}${total > list.length ? `; and ${total - list.length} more` : ''}`;

/** The CAPEX lines of the tenant (`$1`) whose criterion column is set / empty. */
const linesWith = (criterion: Criterion) => `SELECT i.id FROM spend_items i
  WHERE i.tenant_id = $1 AND i.nature = 'capex' AND i.${criterion.code} IS NOT NULL`;
const linesWithout = (criterion: Criterion) => `SELECT i.id FROM spend_items i
  WHERE i.tenant_id = $1 AND i.nature = 'capex' AND i.${criterion.code} IS NULL ORDER BY i.created_at, i.id`;

/**
 * The three CAPEX criteria become dimensions (plan planning/budget-unifie.md, lot C1, PR C1a;
 * brief planning/budget-unifie/lot-c1-brief.md §3). Runs in the transaction of the pending
 * migrations, after lot Z1 (1853970000000), unattended in production.
 *
 * 1. Checks before any write: the tables, columns, enum types and search functions exist; each
 *    enum value has a value in the table. Per active tenant, logged: the CAPEX lines to link, a
 *    dimension of a criterion's code already there (kept as it is), a name another dimension
 *    holds (the new one gets " (CAPEX)").
 * 2. With row level security lifted on the tables written and the user triggers of
 *    `spend_item_analytics_values` off (its `row_version` and search index statement triggers:
 *    the lines keep their `row_version`, so exported `kanap_token`s and open workspaces stay
 *    valid), both restored as found, also on failure. For each active tenant (`deleted_at IS
 *    NULL`; a deleted tenant has no dimension), in (created_at, id) order, app.current_tenant set,
 *    the setting found put back at the end:
 *    - the three dimensions (code `ppe_type`, `investment_type`, `priority`; English names; used
 *      for CAPEX lines; required; enabled; after the tenant's last dimension, in that order) and
 *      their values (English names, in the enum's order), with the seed's SQL: a dimension by its
 *      code, a value by its name in it; a dimension of that code already there is kept as it is
 *      and only gets the values it lacks;
 *    - each CAPEX line whose column holds a value gets the link to the value of that name, unless
 *      it already has one on the dimension (never changed); a line whose column is empty gets no
 *      link (counted, named);
 *    - check, an exception otherwise (the whole transaction rolls back): no CAPEX line with a
 *      column set lacks a link on the dimension;
 *    - one log line: the dimensions created or kept, the values created, the links created and
 *      kept, the lines without a value; the links kept that name another value than the column
 *      (written before this run, or by a version run again after a revert: never changed) and the
 *      links on a value CAPEX lines cannot choose (disabled, or for OPEX lines only, on a
 *      dimension kept as it is), the line, the column and the value or the reason given; the
 *      first 50 lines named each time.
 * 3. `search_index_refresh_capex_items` loses the three enums from the summary and the B terms
 *    (the dimension values are already indexed, lot S); every tenant's CAPEX lines are indexed
 *    again, one tenant at a time with its app.current_tenant. `ANALYZE` of the tables written.
 *
 * The columns stay (nullable on `spend_items` since lot Z1; lot C2 drops them with the enum
 * types); the code no longer reads or writes them. A second run creates nothing, renumbers
 * nothing and checks again.
 *
 * down() puts lot Z1's search body back, then, for each CAPEX line, computes the three columns
 * again from its values on the dimensions of those codes, by name (case-insensitive, a space for
 * an underscore: "Business growth" is `business_growth`); a value an administrator added, or no
 * value, gives an empty column (counted, named), which 1853970000000's down() then refuses. A
 * tenant without a dimension of a criterion's code (deleted before this migration ran) keeps that
 * column as it is (its lines counted). The
 * lines keep their `row_version` (their triggers off). It deletes no dimension, value or link:
 * they are the tenant's data now. The full revert is this migration, then lot Z1's.
 */
export class CapexCriteriaDimensions1853980000000 implements MigrationInterface {
  name = 'CapexCriteriaDimensions1853980000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await assertPresent(queryRunner);
    const foundTenant = await currentTenantSetting(queryRunner);
    try {
      await withoutRowSecurity(queryRunner, RLS_TABLES, async () => {
        const tenants: TenantRow[] = await queryRunner.query(
          `SELECT id::text AS id, slug FROM tenants WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC`,
        );
        await precheck(queryRunner, tenants);
        const totals = { created: 0, kept: 0, values: 0, links: 0, empty: 0 };
        await withoutUserTriggers(queryRunner, ['spend_item_analytics_values'], async () => {
          for (const tenant of tenants) {
            await setTenant(queryRunner, tenant.id);
            const outcome = await convertTenant(queryRunner, tenant);
            totals.created += outcome.created;
            totals.kept += outcome.kept;
            totals.values += outcome.values;
            totals.links += outcome.links;
            totals.empty += outcome.empty;
          }
        });
        await queryRunner.query(CAPEX_REFRESH);
        const reindexMs = await reindexCapexLines(queryRunner);
        await assertSearchBodyWithoutCriteria(queryRunner);
        // Fresh statistics for the rows written, as lot Z1 does: the list and report queries join them.
        for (const table of ANALYZED_TABLES) await queryRunner.query(`ANALYZE ${table}`);
        console.log(
          `${LOG_PREFIX} done in ${Date.now() - started} ms: ${tenants.length} active tenant(s), `
            + `${totals.created} dimension(s) created, ${totals.kept} kept, ${totals.values} value(s) created, `
            + `${totals.links} link(s) created, ${totals.empty} empty CAPEX field(s) left without a value; `
            + `CAPEX search entries rebuilt in ${reindexMs} ms`,
        );
      });
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [foundTenant]).catch(() => undefined);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await assertPresent(queryRunner);
    const foundTenant = await currentTenantSetting(queryRunner);
    try {
      await withoutRowSecurity(queryRunner, RLS_TABLES, async () => {
        // Every tenant: a CAPEX line of a tenant deleted since gets its columns back too.
        const tenants: TenantRow[] = await queryRunner.query(`SELECT id::text AS id, slug FROM tenants ORDER BY created_at ASC, id ASC`);
        await queryRunner.query(CAPEX_REFRESH_PREVIOUS);
        let changed = 0;
        let empty = 0;
        let leftAsIs = 0;
        await withoutUserTriggers(queryRunner, ['spend_items'], async () => {
          for (const tenant of tenants) {
            await setTenant(queryRunner, tenant.id);
            const outcome = await restoreTenant(queryRunner, tenant);
            changed += outcome.changed;
            empty += outcome.empty;
            leftAsIs += outcome.leftAsIs;
          }
        });
        const reindexMs = await reindexCapexLines(queryRunner);
        console.log(
          `${LOG_PREFIX} reverted in ${Date.now() - started} ms: ${changed} CAPEX line(s) got their columns back from their values, `
            + `${leftAsIs} left as they are for a criterion without a dimension, `
            + `${empty} line(s) with an empty column; dimensions, values and links kept; CAPEX search entries rebuilt in ${reindexMs} ms`,
        );
      });
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [foundTenant]).catch(() => undefined);
    }
  }
}

/* ------------------------------------------------------------------ up ---- */

async function assertPresent(queryRunner: QueryRunner): Promise<void> {
  const missing: Array<{ name: string }> = await queryRunner.query(
    `SELECT t.name FROM unnest($1::text[]) AS t(name) WHERE to_regclass(t.name) IS NULL`,
    [[...RLS_TABLES, 'tenants']],
  );
  if (missing.length > 0) throw new Error(`${LOG_PREFIX} table(s) missing: ${missing.map((row) => row.name).join(', ')}; nothing was changed.`);
  const columns: Array<{ name: string }> = await queryRunner.query(
    `SELECT c.name FROM unnest($1::text[]) AS c(name)
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns i
                         WHERE i.table_schema = current_schema() AND i.table_name = 'spend_items' AND i.column_name = c.name)`,
    [['nature', 'legacy_number', ...CAPEX_CRITERIA.map((criterion) => criterion.code)]],
  );
  if (columns.length > 0) {
    throw new Error(`${LOG_PREFIX} spend_items lacks ${columns.map((row) => row.name).join(', ')} (lot Z1, 1853960000000); nothing was changed.`);
  }
  const functions: Array<{ name: string }> = await queryRunner.query(
    `SELECT f.name FROM unnest($1::text[]) AS f(name) WHERE to_regprocedure(f.name) IS NULL`,
    [['search_index_refresh_capex_items(uuid, uuid[])', 'search_index_line_analytics(uuid, text, uuid)', 'search_index_tsv("char", text)']],
  );
  if (functions.length > 0) {
    throw new Error(`${LOG_PREFIX} function(s) missing: ${functions.map((row) => row.name).join(', ')}; nothing was changed.`);
  }
  // Each value an enum can hold has its value in the table (a label added by hand would get no link).
  for (const criterion of CAPEX_CRITERIA) {
    const labels: Array<{ label: string }> = await queryRunner.query(
      `SELECT e.enumlabel::text AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1 AND t.typnamespace = to_regnamespace(current_schema()) ORDER BY e.enumsortorder`,
      [criterion.enumType],
    );
    if (labels.length === 0) throw new Error(`${LOG_PREFIX} the enum type ${criterion.enumType} is missing; nothing was changed.`);
    const known = new Set<string>(criterion.values.map((value) => value.key));
    const unknown = labels.map((row) => row.label).filter((label) => !known.has(label));
    if (unknown.length > 0) {
      throw new Error(`${LOG_PREFIX} ${criterion.enumType} holds ${unknown.join(', ')}, which no value of the ${criterion.code} dimension stands for; nothing was changed.`);
    }
  }
}

async function currentTenantSetting(queryRunner: QueryRunner): Promise<string> {
  const [row] = await queryRunner.query(`SELECT coalesce(current_setting('app.current_tenant', true), '') AS tenant`);
  return String(row?.tenant ?? '');
}

async function setTenant(queryRunner: QueryRunner, tenantId: string): Promise<void> {
  await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

/** Step 1: nothing is written. Logs the tenants with CAPEX lines, a dimension kept or a name taken. */
async function precheck(queryRunner: QueryRunner, tenants: TenantRow[]): Promise<void> {
  let lines = 0;
  let withLines = 0;
  for (const tenant of tenants) {
    const notes: string[] = [];
    const count = await scalar(queryRunner, `SELECT count(*)::int AS n FROM spend_items WHERE tenant_id = $1 AND nature = 'capex'`, [tenant.id]);
    if (count > 0) {
      lines += count;
      withLines += 1;
      const set: string[] = [];
      for (const criterion of CAPEX_CRITERIA) {
        set.push(`${criterion.code} ${await scalar(queryRunner, `SELECT count(*)::int AS n FROM (${linesWith(criterion)}) x`, [tenant.id])}`);
      }
      notes.push(`${count} CAPEX line(s) to link (column set: ${set.join(', ')})`);
    }
    for (const criterion of CAPEX_CRITERIA) {
      const [axis] = await queryRunner.query(CAPEX_DIMENSION_SQL.findAxis, [tenant.id, criterion.code]);
      if (axis) {
        notes.push(`the ${criterion.code} dimension exists ("${axis.name ?? ''}", used for ${axis.applies_to ?? 'both'}, `
          + `${axis.required ? 'required' : 'optional'}, ${axis.status}): kept as it is`);
        continue;
      }
      const [{ taken }] = await queryRunner.query(CAPEX_DIMENSION_SQL.nameTaken, [tenant.id, criterion.name]);
      if (taken) notes.push(`another dimension is named "${criterion.name}": the ${criterion.code} dimension gets a suffix`);
    }
    if (notes.length > 0) console.log(`${LOG_PREFIX} check: tenant ${tenantName(tenant)}: ${notes.join('; ')}`);
  }
  console.log(`${LOG_PREFIX} check: ${tenants.length} active tenant(s), ${lines} CAPEX line(s) in ${withLines} of them`);
}

/** The dimension of a criterion for one tenant, created or found, with its missing values (the seed's logic). */
async function ensureDimension(
  queryRunner: QueryRunner,
  tenantId: string,
  criterion: Criterion,
): Promise<{ axisId: string; created: boolean; name: string | null; valuesCreated: number }> {
  let created = false;
  let [axis] = await queryRunner.query(CAPEX_DIMENSION_SQL.findAxis, [tenantId, criterion.code]);
  if (!axis) {
    let name: string = criterion.name;
    for (let attempt = 0; ; attempt += 1) {
      name = capexDimensionNameCandidate(criterion.name, attempt);
      const [{ taken }] = await queryRunner.query(CAPEX_DIMENSION_SQL.nameTaken, [tenantId, name]);
      if (!taken) break;
    }
    const [inserted] = await queryRunner.query(CAPEX_DIMENSION_SQL.insertAxis, [tenantId, criterion.code, name]);
    created = !!inserted;
    [axis] = await queryRunner.query(CAPEX_DIMENSION_SQL.findAxis, [tenantId, criterion.code]);
    if (!axis) throw new Error(`${LOG_PREFIX} the ${criterion.code} dimension could not be created; nothing was changed.`);
  }
  let valuesCreated = 0;
  for (const value of criterion.values) {
    const rows = await queryRunner.query(CAPEX_DIMENSION_SQL.insertValue, [tenantId, axis.id, value.name]);
    valuesCreated += rows.length;
  }
  return { axisId: axis.id, created, name: axis.name ?? null, valuesCreated };
}

/** Step 2 for one tenant (app.current_tenant set). */
async function convertTenant(
  queryRunner: QueryRunner,
  tenant: TenantRow,
): Promise<{ created: number; kept: number; values: number; links: number; empty: number }> {
  const t = tenant.id;
  const parts: string[] = [];
  const emptyParts: string[] = [];
  const outcome = { created: 0, kept: 0, values: 0, links: 0, empty: 0 };
  for (const criterion of CAPEX_CRITERIA) {
    const dimension = await ensureDimension(queryRunner, t, criterion);
    if (dimension.created) outcome.created += 1;
    else outcome.kept += 1;
    outcome.values += dimension.valuesCreated;
    const keys = criterion.values.map((value) => value.key);
    const names = criterion.values.map((value) => value.name);
    // The value of the line's column, by name in the dimension; a link already there is kept.
    const linked = await countOf(
      queryRunner,
      `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id)
       SELECT i.tenant_id, i.id, $2::uuid, c.id
         FROM spend_items i
         JOIN unnest($3::text[], $4::text[]) AS m(key, name) ON m.key = i.${criterion.code}::text
         JOIN analytics_categories c ON c.tenant_id = $1 AND c.axis_id = $2::uuid AND lower(c.name) = lower(m.name)
        WHERE i.tenant_id = $1 AND i.nature = 'capex' AND i.${criterion.code} IS NOT NULL
       ON CONFLICT (tenant_id, item_id, axis_id) DO NOTHING`,
      [t, dimension.axisId, keys, names],
    );
    const set = await scalar(queryRunner, `SELECT count(*)::int AS n FROM (${linesWith(criterion)}) x`, [t]);
    const missing = await ids(
      queryRunner,
      `${linesWith(criterion)} AND NOT EXISTS (
         SELECT 1 FROM spend_item_analytics_values v WHERE v.tenant_id = $1 AND v.item_id = i.id AND v.axis_id = $2::uuid)
       ORDER BY i.id`,
      [t, dimension.axisId],
      5,
    );
    if (missing.length > 0) {
      throw new Error(
        `${LOG_PREFIX} tenant ${tenantName(tenant)}: CAPEX line(s) ${missing.join(', ')} hold a ${criterion.code} `
          + `and no value on the ${criterion.code} dimension after the conversion; nothing was changed.`,
      );
    }
    // A link kept that names another value than the column (written before this run, or by a version
    // run again after a revert): never changed, the lines named so that they can be fixed by hand.
    const differsSql = `SELECT i.id, i.${criterion.code}::text AS col, c.name AS value
         FROM spend_items i
         JOIN spend_item_analytics_values v ON v.tenant_id = $1 AND v.item_id = i.id AND v.axis_id = $2::uuid
         JOIN analytics_categories c ON c.tenant_id = $1 AND c.id = v.category_id
        WHERE i.tenant_id = $1 AND i.nature = 'capex' AND i.${criterion.code} IS NOT NULL
          AND lower(regexp_replace(btrim(c.name), '\\s+', '_', 'g')) <> i.${criterion.code}::text
        ORDER BY i.created_at, i.id`;
    const differs = await scalar(queryRunner, `SELECT count(*)::int AS n FROM (${differsSql}) x`, [t, dimension.axisId]);
    // A link on a value CAPEX lines cannot choose (a dimension kept as it is: a value of that name
    // disabled, or for OPEX lines only): kept, the data stays, the lines named with the reason.
    const unusableSql = `SELECT i.id, c.name AS value,
              CASE WHEN c.status <> 'enabled' OR (c.disabled_at IS NOT NULL AND c.disabled_at <= now()) THEN 'disabled' ELSE 'opex only' END AS reason
         FROM spend_items i
         JOIN spend_item_analytics_values v ON v.tenant_id = $1 AND v.item_id = i.id AND v.axis_id = $2::uuid
         JOIN analytics_categories c ON c.tenant_id = $1 AND c.id = v.category_id
        WHERE i.tenant_id = $1 AND i.nature = 'capex'
          AND (c.status <> 'enabled' OR (c.disabled_at IS NOT NULL AND c.disabled_at <= now()) OR c.applies_to = 'opex')
        ORDER BY i.created_at, i.id`;
    const unusable = await scalar(queryRunner, `SELECT count(*)::int AS n FROM (${unusableSql}) x`, [t, dimension.axisId]);
    const emptyCount = await scalar(queryRunner, `SELECT count(*)::int AS n FROM (${linesWithout(criterion)}) x`, [t]);
    outcome.links += linked;
    outcome.empty += emptyCount;
    const label = dimension.created ? `created as "${dimension.name}"` : `kept ("${dimension.name ?? ''}")`;
    let part = `${criterion.code} ${label}, ${dimension.valuesCreated} value(s) created, ${linked} link(s) created`
      + (set > linked ? `, ${set - linked} kept` : '');
    if (differs > 0) {
      const rows: Array<{ id: string; col: string; value: string }> = await queryRunner.query(
        `SELECT x.id::text AS id, x.col, x.value FROM (${differsSql}) x LIMIT ${NAMED_ROWS}`, [t, dimension.axisId]);
      part += ` (${differs} kept link(s) name another value than the line's column: `
        + `${named(rows.map((row) => `${row.id} (column ${row.col}, value ${row.value})`), differs)})`;
    }
    if (unusable > 0) {
      const rows: Array<{ id: string; value: string; reason: string }> = await queryRunner.query(
        `SELECT x.id::text AS id, x.value, x.reason FROM (${unusableSql}) x LIMIT ${NAMED_ROWS}`, [t, dimension.axisId]);
      part += ` (${unusable} link(s) on a value CAPEX lines cannot choose: `
        + `${named(rows.map((row) => `${row.id} (${row.value}, ${row.reason})`), unusable)})`;
    }
    parts.push(part);
    if (emptyCount > 0) {
      const shown = await ids(queryRunner, linesWithout(criterion), [t]);
      emptyParts.push(`${emptyCount} without ${criterion.code}: ${named(shown, emptyCount)}`);
    }
  }
  console.log(
    `${LOG_PREFIX} tenant ${tenantName(tenant)}: ${parts.join('; ')}`
      + (emptyParts.length > 0 ? `; CAPEX lines left without a value: ${emptyParts.join('; ')}` : ''),
  );
  return outcome;
}

/** Step 3: the CAPEX line entries of every tenant, from the body now in place. Returns the time taken. */
async function reindexCapexLines(queryRunner: QueryRunner): Promise<number> {
  const started = Date.now();
  const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id::text AS id FROM tenants ORDER BY created_at ASC, id ASC`);
  for (const tenant of tenants) {
    await setTenant(queryRunner, tenant.id);
    await queryRunner.query(`SELECT search_index_refresh_capex_items($1::uuid)`, [tenant.id]);
  }
  return Date.now() - started;
}

async function assertSearchBodyWithoutCriteria(queryRunner: QueryRunner): Promise<void> {
  const [row] = await queryRunner.query(
    `SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('search_index_refresh_capex_items(uuid, uuid[])')`,
  );
  const source = String(row?.prosrc ?? '');
  const left = CAPEX_CRITERIA.map((criterion) => criterion.code).filter((code) => source.includes(`ci.${code}`));
  if (!source || left.length > 0) {
    throw new Error(`${LOG_PREFIX} search_index_refresh_capex_items still reads ${left.join(', ') || 'nothing'}; nothing was changed.`);
  }
}

/* ---------------------------------------------------------------- down ---- */

/** The column of a criterion computed from the line's value on the dimension of that code, by name. */
function columnFromValue(criterion: Criterion): string {
  return `(SELECT e.enumlabel::text::${criterion.enumType}
             FROM spend_item_analytics_values v
             JOIN analytics_axes a ON a.tenant_id = v.tenant_id AND a.id = v.axis_id AND lower(a.code) = '${criterion.code}'
             JOIN analytics_categories c ON c.tenant_id = v.tenant_id AND c.id = v.category_id
             JOIN pg_enum e ON e.enumtypid = '${criterion.enumType}'::regtype
                           AND e.enumlabel::text = lower(regexp_replace(btrim(c.name), '\\s+', '_', 'g'))
            WHERE v.tenant_id = i.tenant_id AND v.item_id = i.id)`;
}

/**
 * down(), one tenant (app.current_tenant set): the columns of its CAPEX lines from their values, for
 * the criteria the tenant has a dimension of; a column of a criterion without one (a tenant deleted
 * before this migration ran, a dimension deleted since) is left as it is, its lines counted.
 */
async function restoreTenant(
  queryRunner: QueryRunner,
  tenant: TenantRow,
): Promise<{ changed: number; empty: number; leftAsIs: number }> {
  const t = tenant.id;
  const found: Array<{ code: string }> = await queryRunner.query(
    `SELECT DISTINCT lower(a.code) AS code FROM analytics_axes a WHERE a.tenant_id = $1 AND lower(a.code) = ANY($2::text[])`,
    [t, CAPEX_CRITERIA.map((criterion) => criterion.code)],
  );
  const present = CAPEX_CRITERIA.filter((criterion) => found.some((row) => row.code === criterion.code));
  const absent = CAPEX_CRITERIA.filter((criterion) => !present.includes(criterion));
  const changed = present.length === 0 ? 0 : await countOf(
    queryRunner,
    `UPDATE spend_items i
        SET ${present.map((criterion) => `${criterion.code} = ${columnFromValue(criterion)}`).join(',\n            ')}
      WHERE i.tenant_id = $1 AND i.nature = 'capex'
        AND (${present.map((criterion) => `i.${criterion.code}`).join(', ')})
            IS DISTINCT FROM (${present.map((criterion) => columnFromValue(criterion)).join(', ')})`,
    [t],
  );
  const leftAsIs = absent.length === 0 ? 0 : await scalar(
    queryRunner,
    `SELECT count(*)::int AS n FROM spend_items i WHERE i.tenant_id = $1 AND i.nature = 'capex'`,
    [t],
  );
  const emptySql = `SELECT i.id FROM spend_items i
     WHERE i.tenant_id = $1 AND i.nature = 'capex'
       AND (${CAPEX_CRITERIA.map((criterion) => `i.${criterion.code} IS NULL`).join(' OR ')})
     ORDER BY i.created_at, i.id`;
  const empty = await scalar(queryRunner, `SELECT count(*)::int AS n FROM (${emptySql}) x`, [t]);
  if (changed > 0 || empty > 0 || leftAsIs > 0) {
    const shown = empty > 0 ? await ids(queryRunner, emptySql, [t]) : [];
    console.log(
      `${LOG_PREFIX} down: tenant ${tenantName(tenant)}: ${changed} CAPEX line(s) got their columns from their values`
        + (leftAsIs > 0
          ? `; ${leftAsIs} line(s) left as they are for ${absent.map((criterion) => criterion.code).join(', ')} (no dimension of that code)`
          : '')
        + (empty > 0 ? `; ${empty} line(s) with an empty column (no value, or a value added since): ${named(shown, empty)}` : ''),
    );
  }
  return { changed, empty, leftAsIs };
}

/* ------------------------------------------------------------- helpers ---- */

/**
 * Runs `fn` with row level security off on the tables, then restores what was found, also when
 * `fn` fails (1853970000000). After a failed statement the transaction is aborted and refuses the
 * restore: its rollback restores the state then, and the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, tables: string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ table: string; enabled: boolean; forced: boolean }> = [];
  for (const table of tables) {
    const [state] = await queryRunner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass($1)`,
      [table],
    );
    states.push({ table, enabled: !!state?.enabled, forced: !!state?.forced });
  }
  for (const state of states) {
    if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} DISABLE ROW LEVEL SECURITY`);
  }
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const state of states) {
        if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} ENABLE ROW LEVEL SECURITY`);
        if (state.forced) await queryRunner.query(`ALTER TABLE ${state.table} FORCE ROW LEVEL SECURITY`);
      }
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}

/** How `pg_trigger.tgenabled` reads back once enabled again: origin (the default), always, replica. */
const ENABLE_TRIGGER: Record<string, string> = { O: 'ENABLE TRIGGER', A: 'ENABLE ALWAYS TRIGGER', R: 'ENABLE REPLICA TRIGGER' };

/**
 * Runs `fn` with every enabled user trigger of the tables disabled, then enables each as found
 * (1853970000000); restored like `withoutRowSecurity`.
 */
async function withoutUserTriggers<T>(queryRunner: QueryRunner, tables: string[], fn: () => Promise<T>): Promise<T> {
  const found: Array<{ table: string; trigger: string; enable: string }> = await queryRunner.query(
    `SELECT c.relname AS "table", t.tgname AS trigger, t.tgenabled::text AS enabled
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.oid = ANY (SELECT to_regclass(x)::oid FROM unnest($1::text[]) AS x)
      ORDER BY c.relname, t.tgname`,
    [tables],
  ).then((rows: Array<{ table: string; trigger: string; enabled: string }>) => rows
    .filter((row) => ENABLE_TRIGGER[row.enabled])
    .map((row) => ({ table: row.table, trigger: row.trigger, enable: ENABLE_TRIGGER[row.enabled] })));
  for (const { table, trigger } of found) await queryRunner.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const { table, trigger, enable } of found) await queryRunner.query(`ALTER TABLE ${table} ${enable} ${trigger}`);
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
