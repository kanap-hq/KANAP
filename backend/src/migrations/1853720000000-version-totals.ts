import { MigrationInterface, QueryRunner } from 'typeorm';

/** The five budget columns of an amounts row, in the order of `SUMMARY_COLUMNS`. */
const MEASURES = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

const SCOPES = [
  { label: 'OPEX', totals: 'spend_version_totals', amounts: 'spend_amounts', versions: 'spend_versions' },
  { label: 'CAPEX', totals: 'capex_version_totals', amounts: 'capex_amounts', versions: 'capex_versions' },
] as const;

type Scope = (typeof SCOPES)[number];

const REBUILD_FUNCTION = 'budget_version_totals_rebuild';

const triggerFunction = (scope: Scope) => `${scope.amounts}_version_totals`;
const triggerName = (scope: Scope, event: 'insert' | 'update' | 'delete') => `${scope.amounts}_version_totals_${event}`;

/** A month `a` of the version `v`'s own budget year: the only months a version's totals count. */
const ownYear = (a: string, v: string) => `${a}.period >= make_date(${v}.budget_year, 1, 1) AND ${a}.period < make_date(${v}.budget_year + 1, 1, 1)`;

/** `a OR b OR …` over the five deltas of the change set `c`: the version's amounts changed. */
const changed = MEASURES.map((m) => `c.${m} <> 0`).join(' OR ');

/** The change set of one statement: one entry per version, unnested from the function's arrays. */
const CHANGES = `unnest(k_tenant, k_version, k_year, ${MEASURES.map((m) => `d_${m}`).join(', ')}, k_gained, k_lost)
      AS c(tenant_id, version_id, budget_year, ${MEASURES.join(', ')}, gained, lost)`;

/** SELECT … INTO the function's arrays from a grouped change set `c`. */
const INTO_ARRAYS = `SELECT array_agg(c.tenant_id), array_agg(c.version_id), array_agg(c.budget_year),
           ${MEASURES.map((m) => `array_agg(c.${m})`).join(', ')}, array_agg(c.gained), array_agg(c.lost)
      INTO k_tenant, k_version, k_year, ${MEASURES.map((m) => `d_${m}`).join(', ')}, k_gained, k_lost`;

/**
 * The months of a transition table that fall in their version's own budget
 * year, with the sign of their side (+ after the statement, - before it).
 * The version is read under the caller's RLS and must carry the months'
 * tenant, like the aggregate the list engine ran (`v.tenant_id = a.tenant_id`).
 * A month of a deleted version (a cascade) finds no version: nothing to do,
 * the version's totals row goes with it.
 */
function signedRows(scope: Scope, table: 'new_rows' | 'old_rows'): string {
  const sign = table === 'new_rows' ? '' : '-';
  return `SELECT r.tenant_id, r.version_id, v.budget_year, ${sign}1 AS side,
                 ${MEASURES.map((m) => `${sign}coalesce(r.${m}, 0) AS ${m}`).join(', ')}
            FROM ${table} r
            JOIN ${scope.versions} v ON v.id = r.version_id AND v.tenant_id = r.tenant_id
           WHERE ${ownYear('r', 'v')}`;
}

/** One entry per version of the rows given: their net change, and whether the version gained or lost own-year months. */
function grouped(rows: string): string {
  return `(SELECT s.tenant_id, s.version_id, s.budget_year,
                 ${MEASURES.map((m) => `sum(s.${m}) AS ${m}`).join(', ')},
                 bool_or(s.side > 0) AND NOT bool_or(s.side < 0) AS gained,
                 bool_or(s.side < 0) AND NOT bool_or(s.side > 0) AS lost
            FROM (${rows}) s
           GROUP BY s.tenant_id, s.version_id, s.budget_year) c`;
}

/**
 * The statement trigger function of one amounts table. Each AFTER statement
 * trigger (insert, update, delete) calls it with its transition tables:
 *
 * 1. The statement's net change per version, over the months of the
 *    version's own budget year only: + the rows after the statement, - the
 *    rows before it, NULL as 0 (`COALESCE(SUM(x), 0)` equals
 *    `SUM(COALESCE(x, 0))`). A version "gained" months when the statement
 *    brought it own-year rows and took none away (an insert, or an update
 *    moving months in), and "lost" months in the opposite case (a delete, or an
 *    update moving months out).
 * 2. Versions that had months before: add the change, only when an amount changed.
 * 3. Versions that gained months: upsert the change when an amount changed,
 *    then make sure the row exists even for months holding only zeros.
 * 4. Versions that lost months: delete the row once no own-year month is left.
 *
 * Deltas commute, so concurrent writes of one version add up whatever their
 * order (the totals row is the only point where they queue). Lock order: a
 * statement locks its months, then the version's totals row. A write that
 * changes no amount (the zero months a budget write creates first, a no-op
 * update) never locks an existing totals row, so a write that created months
 * and then waits for a month held by another write cannot deadlock with it.
 * Deletes never insert a row.
 *
 * Lot 3B (planning/perf-scale) adds its `budget_rev` bump of the versions
 * touched as one more step on the same change set.
 */
function triggerFunctionSql(scope: Scope): string {
  return `
    CREATE OR REPLACE FUNCTION ${triggerFunction(scope)}() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    DECLARE
      k_tenant uuid[];
      k_version uuid[];
      k_year int[];
      ${MEASURES.map((m) => `d_${m} numeric[];`).join('\n      ')}
      k_gained boolean[];
      k_lost boolean[];
    BEGIN
      -- 1. Net change of the statement per version, own-year months only.
      IF TG_OP = 'INSERT' THEN
        ${INTO_ARRAYS}
          FROM ${grouped(signedRows(scope, 'new_rows'))};
      ELSIF TG_OP = 'DELETE' THEN
        ${INTO_ARRAYS}
          FROM ${grouped(signedRows(scope, 'old_rows'))};
      ELSE
        ${INTO_ARRAYS}
          FROM ${grouped(`${signedRows(scope, 'new_rows')} UNION ALL ${signedRows(scope, 'old_rows')}`)};
      END IF;
      IF k_version IS NULL THEN
        RETURN NULL; -- no own-year month of an existing version was touched
      END IF;

      -- 2. Versions that had months before the statement: add the change.
      IF TG_OP <> 'INSERT' THEN
        UPDATE ${scope.totals} t
           SET ${MEASURES.map((m) => `${m} = t.${m} + c.${m}`).join(', ')}, updated_at = now()
          FROM ${CHANGES}
         WHERE NOT c.gained AND t.version_id = c.version_id AND t.tenant_id = c.tenant_id
           AND (${changed});
      END IF;

      -- 3. Versions that gained months: their row, created when missing.
      IF true = ANY (k_gained) THEN
        INSERT INTO ${scope.totals} AS t (tenant_id, version_id, ${MEASURES.join(', ')})
        SELECT c.tenant_id, c.version_id, ${MEASURES.map((m) => `c.${m}`).join(', ')}
          FROM ${CHANGES}
         WHERE c.gained AND (${changed})
        ON CONFLICT (version_id) DO UPDATE
           SET ${MEASURES.map((m) => `${m} = t.${m} + excluded.${m}`).join(', ')}, updated_at = now();
        INSERT INTO ${scope.totals} (tenant_id, version_id)
        SELECT c.tenant_id, c.version_id
          FROM ${CHANGES}
         WHERE c.gained
        ON CONFLICT (version_id) DO NOTHING;
      END IF;

      -- 4. Versions that lost months: no row once no own-year month is left.
      IF true = ANY (k_lost) THEN
        DELETE FROM ${scope.totals} t
         USING ${CHANGES}
         WHERE c.lost AND t.version_id = c.version_id AND t.tenant_id = c.tenant_id
           AND NOT EXISTS (
             SELECT 1 FROM ${scope.amounts} a
              WHERE a.tenant_id = c.tenant_id AND a.version_id = c.version_id
                AND a.period >= make_date(c.budget_year, 1, 1) AND a.period < make_date(c.budget_year + 1, 1, 1)
           );
      END IF;
      RETURN NULL;
    END
    $fn$
  `;
}

/** Recompute one scope's totals from its amounts: insert the missing rows, correct the wrong ones, delete the extra ones. */
function rebuildScopeSql(scope: Scope): string {
  const totals = MEASURES.map((m) => `t.${m}`).join(', ');
  const expected = MEASURES.map((m) => `excluded.${m}`).join(', ');
  return `
      -- Writers wait, readers go on: no write can slip between the sums and their storage.
      LOCK TABLE ${scope.amounts} IN SHARE MODE;
      RETURN QUERY
      WITH expected AS (
        SELECT a.tenant_id, a.version_id, ${MEASURES.map((m) => `sum(coalesce(a.${m}, 0)) AS ${m}`).join(', ')}
          FROM ${scope.amounts} a
          JOIN ${scope.versions} v ON v.id = a.version_id AND v.tenant_id = a.tenant_id
         WHERE (p_tenant IS NULL OR a.tenant_id = p_tenant) AND ${ownYear('a', 'v')}
         GROUP BY a.tenant_id, a.version_id
      ),
      written AS (
        INSERT INTO ${scope.totals} AS t (tenant_id, version_id, ${MEASURES.join(', ')})
        SELECT tenant_id, version_id, ${MEASURES.join(', ')} FROM expected
        ON CONFLICT (version_id) DO UPDATE
           SET tenant_id = excluded.tenant_id, ${MEASURES.map((m) => `${m} = excluded.${m}`).join(', ')}, updated_at = now()
         WHERE (t.tenant_id, ${totals}) IS DISTINCT FROM (excluded.tenant_id, ${expected})
        RETURNING t.tenant_id, (t.xmax = 0) AS inserted
      ),
      removed AS (
        DELETE FROM ${scope.totals} t
         WHERE (p_tenant IS NULL OR t.tenant_id = p_tenant)
           AND NOT EXISTS (
             SELECT 1 FROM ${scope.versions} v
               JOIN ${scope.amounts} a ON a.version_id = v.id AND a.tenant_id = v.tenant_id
              WHERE v.id = t.version_id AND v.tenant_id = t.tenant_id AND ${ownYear('a', 'v')}
           )
        RETURNING t.tenant_id
      ),
      counts AS (
        SELECT tenant_id, count(*) FILTER (WHERE inserted) AS inserted, count(*) FILTER (WHERE NOT inserted) AS corrected, 0::bigint AS removed
          FROM written GROUP BY tenant_id
        UNION ALL
        SELECT tenant_id, 0, 0, count(*) FROM removed GROUP BY tenant_id
      )
      SELECT '${scope.label}'::text, tenant_id, sum(inserted)::bigint, sum(corrected)::bigint, sum(removed)::bigint
        FROM counts GROUP BY tenant_id;`;
}

/**
 * The rebuild, as a database function: the migration's backfill, the tenant
 * import (`scripts/tenant-import.sh`, whose triggers are off while it loads)
 * and a repair after anything that bypasses the triggers (TRUNCATE, a session
 * in `session_replication_role = replica`, a raw change of a version's
 * budget_year). It runs as the caller: under RLS it sees the session tenant
 * only, so give that tenant (NULL = every tenant, which needs RLS off or a
 * superuser). Returns one row per scope and tenant changed.
 */
function rebuildFunctionSql(): string {
  return `
    CREATE OR REPLACE FUNCTION ${REBUILD_FUNCTION}(p_tenant uuid DEFAULT NULL)
    RETURNS TABLE (scope text, tenant_id uuid, inserted bigint, corrected bigint, removed bigint)
    LANGUAGE plpgsql AS $fn$
    #variable_conflict use_column
    BEGIN
      ${SCOPES.map(rebuildScopeSql).join('\n')}
    END
    $fn$
  `;
}

type RebuildRow = { scope: string; tenant_id: string; slug: string | null; inserted: string; corrected: string; removed: string };

/**
 * Budget totals per version, maintained by the database (plan
 * planning/perf-scale, lot 2A): `spend_version_totals` and
 * `capex_version_totals` hold one row per version with the sums of the five
 * amount columns over the months of the version's own budget year, in the
 * line's currency: exactly what the list engine aggregated from `*_amounts` on
 * every request (`EXTRACT(YEAR FROM period) = budget_year`, months and
 * version of the same tenant). A month stored outside its version's year
 * counts nowhere, as before.
 *
 * - version_id is the primary key (one row per version) and references the
 *   version ON DELETE CASCADE: deleting a version, a line or a tenant removes
 *   the row. A version's budget year never changes (services and AI refuse
 *   it); a raw change needs a rebuild.
 * - A row exists exactly when the version has at least one month in its year
 *   (all zeros or NULL included), like the aggregate that returned a row only
 *   for versions with months: the summary converts and reports a version
 *   only when it has one.
 * - numeric without a scale, NOT NULL DEFAULT 0: the type `SUM()` returns, so
 *   the cents the builder reads are the aggregate's to the cent, and twelve
 *   months of numeric(18,2) can never overflow it.
 * - fillfactor 80 leaves room for HOT updates: every amounts write updates a
 *   row, and no measure column is indexed.
 * - Maintained by AFTER statement triggers on each amounts table (one per
 *   event: PostgreSQL refuses transition tables on a multi-event trigger),
 *   applying the statement's net change (see triggerFunctionSql). TRUNCATE and
 *   `session_replication_role = replica` bypass them: rebuild afterwards with
 *   budget_version_totals_rebuild(). The triggers run as the caller, under RLS
 *   (they read the versions and write the totals of the session tenant): a
 *   migration that writes amounts with RLS disabled must disable it on the
 *   versions and totals tables too.
 * - Derived data: not exported by scripts/tenant-export.sh; the import
 *   rebuilds it.
 *
 * Idempotent and self-healing: every object is created if missing or
 * replaced, then the backfill recomputes every version from its amounts,
 * inserting missing rows, correcting wrong ones and deleting extra ones, and
 * logs the counts per tenant. Migrations run without app.current_tenant and
 * these tables are FORCE ROW LEVEL SECURITY, so RLS is disabled on the
 * amounts, versions and totals tables around the backfill and restored to
 * ENABLE + FORCE, the state found. The backfill holds a SHARE lock on the
 * amounts tables.
 *
 * down() drops the triggers, the functions and both tables.
 */
export class VersionTotals1853720000000 implements MigrationInterface {
  name = 'VersionTotals1853720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const scope of SCOPES) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS ${scope.totals} (
          version_id uuid NOT NULL REFERENCES ${scope.versions}(id) ON DELETE CASCADE,
          tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
          ${MEASURES.map((m) => `${m} numeric NOT NULL DEFAULT 0,`).join('\n          ')}
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT ${scope.totals}_pkey PRIMARY KEY (version_id)
        ) WITH (fillfactor = 80)
      `);
      await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_${scope.totals}_tenant ON ${scope.totals} (tenant_id)`);
      await queryRunner.query(`ALTER TABLE ${scope.totals} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${scope.totals} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${scope.totals}_tenant_isolation ON ${scope.totals}`);
      await queryRunner.query(`
        CREATE POLICY ${scope.totals}_tenant_isolation ON ${scope.totals} FOR ALL
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
      `);

      await queryRunner.query(triggerFunctionSql(scope));
      for (const event of ['insert', 'update', 'delete'] as const) {
        const transition = event === 'insert' ? 'NEW TABLE AS new_rows'
          : event === 'delete' ? 'OLD TABLE AS old_rows'
            : 'OLD TABLE AS old_rows NEW TABLE AS new_rows';
        await queryRunner.query(`DROP TRIGGER IF EXISTS ${triggerName(scope, event)} ON ${scope.amounts}`);
        await queryRunner.query(`
          CREATE TRIGGER ${triggerName(scope, event)}
          AFTER ${event.toUpperCase()} ON ${scope.amounts}
          REFERENCING ${transition}
          FOR EACH STATEMENT EXECUTE FUNCTION ${triggerFunction(scope)}()
        `);
      }
    }
    await queryRunner.query(rebuildFunctionSql());

    // Backfill: every tenant at once, RLS off around it (no tenant in a migration).
    const tables = SCOPES.flatMap((scope) => [scope.amounts, scope.versions, scope.totals]);
    for (const table of tables) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    let rows: RebuildRow[] = [];
    try {
      rows = await queryRunner.query(`
        SELECT r.scope, r.tenant_id::text AS tenant_id, t.slug,
               r.inserted::text AS inserted, r.corrected::text AS corrected, r.removed::text AS removed
          FROM ${REBUILD_FUNCTION}(NULL) r
          LEFT JOIN tenants t ON t.id = r.tenant_id
         ORDER BY t.slug NULLS LAST, r.tenant_id, r.scope DESC
      `);
    } finally {
      for (const table of tables) {
        await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      }
    }
    logRebuild(rows);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${REBUILD_FUNCTION}(uuid)`);
    for (const scope of [...SCOPES].reverse()) {
      for (const event of ['insert', 'update', 'delete'] as const) {
        await queryRunner.query(`DROP TRIGGER IF EXISTS ${triggerName(scope, event)} ON ${scope.amounts}`);
      }
      await queryRunner.query(`DROP FUNCTION IF EXISTS ${triggerFunction(scope)}()`);
      await queryRunner.query(`DROP TABLE IF EXISTS ${scope.totals}`);
    }
  }
}

function logRebuild(rows: RebuildRow[]) {
  const prefix = '[Migration] VersionTotals:';
  if (rows.length === 0) {
    console.log(`${prefix} every version total already matches its amounts, nothing written`);
    return;
  }
  for (const row of rows) {
    console.log(
      `${prefix} tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}) ${row.scope}:`
      + ` ${row.inserted} row(s) inserted, ${row.corrected} corrected, ${row.removed} removed`,
    );
  }
}
