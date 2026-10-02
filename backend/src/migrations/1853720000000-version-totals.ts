import { MigrationInterface, QueryRunner } from 'typeorm';

/** The five budget columns of an amounts row, in the order of `SUMMARY_COLUMNS`. */
const MEASURES = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

const SCOPES = [
  { label: 'OPEX', totals: 'spend_version_totals', amounts: 'spend_amounts', versions: 'spend_versions' },
  { label: 'CAPEX', totals: 'capex_version_totals', amounts: 'capex_amounts', versions: 'capex_versions' },
] as const;

type Scope = (typeof SCOPES)[number];

const REBUILD_FUNCTION = 'budget_version_totals_rebuild';

/** Pinned on every function below: the tables live in public, and pg_temp comes last so no temporary table can stand in for one. */
const SEARCH_PATH = 'SET search_path = public, pg_temp';

const triggerFunction = (scope: Scope) => `${scope.amounts}_version_totals`;
const truncateFunction = (scope: Scope) => `${scope.amounts}_version_totals_truncate`;
const yearGuard = (scope: Scope) => `${scope.versions}_budget_year_guard`;
const triggerName = (scope: Scope, event: 'insert' | 'update' | 'delete' | 'truncate') => `${scope.amounts}_version_totals_${event}`;

/**
 * A month `a` of the version `v`'s own budget year: the only months a
 * version's totals count. The list engine's own predicate, total for any
 * budget_year (make_date fails on year 0).
 */
const ownYear = (a: string, v: string) => `EXTRACT(YEAR FROM ${a}.period) = ${v}.budget_year`;

/** `a OR b OR …` over the five deltas of the change set `c`: the version's amounts changed. */
const changed = MEASURES.map((m) => `c.${m} <> 0`).join(' OR ');

/** The change set of one statement: one entry per version, unnested from the function's arrays. */
const CHANGES = `unnest(k_tenant, k_version, ${MEASURES.map((m) => `d_${m}`).join(', ')}, k_gained)
      AS c(tenant_id, version_id, ${MEASURES.join(', ')}, gained)`;

/** SELECT … INTO the function's arrays (and the number of versions whose amounts changed) from a grouped change set `c`. */
const INTO_ARRAYS = `SELECT array_agg(c.tenant_id), array_agg(c.version_id),
           ${MEASURES.map((m) => `array_agg(c.${m})`).join(', ')}, array_agg(c.gained),
           count(*) FILTER (WHERE ${changed})
      INTO k_tenant, k_version, ${MEASURES.map((m) => `d_${m}`).join(', ')}, k_gained, n_changed`;

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
  return `SELECT r.tenant_id, r.version_id, ${sign}1 AS side,
                 ${MEASURES.map((m) => `${sign}coalesce(r.${m}, 0) AS ${m}`).join(', ')}
            FROM ${table} r
            JOIN ${scope.versions} v ON v.id = r.version_id AND v.tenant_id = r.tenant_id
           WHERE ${ownYear('r', 'v')}`;
}

/** One entry per version of the rows given: its net change, and whether the statement only brought it own-year months. */
function grouped(rows: string): string {
  return `(SELECT s.tenant_id, s.version_id,
                 ${MEASURES.map((m) => `sum(s.${m}) AS ${m}`).join(', ')},
                 NOT bool_or(s.side < 0) AS gained
            FROM (${rows}) s
           GROUP BY s.tenant_id, s.version_id) c`;
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
 *    moving months in).
 * 2. When the amounts of more than one version changed, their existing rows
 *    are locked first, in version_id order: two statements writing several
 *    versions take the rows in the same order and cannot deadlock on them.
 * 3. Versions that had months before the statement: add the change, only
 *    when an amount changed.
 * 4. Versions that gained months, in version_id order: upsert the change when
 *    an amount changed, then make sure the row exists even for months holding
 *    only zeros.
 *
 * What concurrent writes are guaranteed. Every change of a totals row is an
 * increment (`x = x + delta`) computed from the statement's own transition
 * rows, never from a read of the amounts. Under READ COMMITTED, an UPDATE (or
 * ON CONFLICT DO UPDATE) that finds the row changed by a transaction still
 * running waits for it, then adds its delta to the row as that transaction
 * left it; a transaction that rolls back takes its delta with it. So once
 * concurrent writers of a version have committed, in whatever order, its row
 * holds the sums of its committed months. Under REPEATABLE READ or
 * SERIALIZABLE the second writer of a row fails with a serialization error
 * (40001) instead: no delta is lost, that transaction is retried or fails.
 *
 * This needs the row to be there for every delta. The first statement that
 * brings a version an own-year month creates it (a concurrent creator waits
 * for the uncommitted row, then adds to it), and the triggers never delete it,
 * not even when the version's last month goes: deciding that the last month
 * went means reading the amounts, and such a read misses the months of
 * transactions still running, so the row would go while one of them still had
 * a delta to add. The row goes with its version (ON DELETE CASCADE). Deletes
 * never insert a row.
 *
 * Lock order: a statement locks its months, then the totals rows. A write
 * that changes no amount (the zero months a budget write creates first, a
 * no-op update, the delete of a zero month) never locks an existing totals
 * row, so a write that created months and then waits for a month held by
 * another write cannot deadlock with it.
 *
 * Lot 3B (planning/perf-scale) adds its `budget_rev` bump of the versions
 * touched as one more step on the same change set.
 */
function triggerFunctionSql(scope: Scope): string {
  return `
    CREATE OR REPLACE FUNCTION ${triggerFunction(scope)}() RETURNS trigger
    LANGUAGE plpgsql ${SEARCH_PATH} AS $fn$
    DECLARE
      k_tenant uuid[];
      k_version uuid[];
      ${MEASURES.map((m) => `d_${m} numeric[];`).join('\n      ')}
      k_gained boolean[];
      n_changed bigint;
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

      -- 2. Several versions changed: lock their rows in version_id order first.
      IF n_changed > 1 THEN
        PERFORM 1
           FROM ${scope.totals} t, ${CHANGES}
          WHERE t.version_id = c.version_id AND t.tenant_id = c.tenant_id AND (${changed})
          ORDER BY t.version_id
            FOR NO KEY UPDATE OF t;
      END IF;

      -- 3. Versions that had months before the statement: add the change.
      IF TG_OP <> 'INSERT' THEN
        UPDATE ${scope.totals} t
           SET ${MEASURES.map((m) => `${m} = t.${m} + c.${m}`).join(', ')}, updated_at = now()
          FROM ${CHANGES}
         WHERE NOT c.gained AND t.version_id = c.version_id AND t.tenant_id = c.tenant_id
           AND (${changed});
      END IF;

      -- 4. Versions that gained months: their row, created when missing. Never deleted here.
      IF true = ANY (k_gained) THEN
        INSERT INTO ${scope.totals} AS t (tenant_id, version_id, ${MEASURES.join(', ')})
        SELECT c.tenant_id, c.version_id, ${MEASURES.map((m) => `c.${m}`).join(', ')}
          FROM ${CHANGES}
         WHERE c.gained AND (${changed})
         ORDER BY c.version_id
        ON CONFLICT (version_id) DO UPDATE
           SET ${MEASURES.map((m) => `${m} = t.${m} + excluded.${m}`).join(', ')}, updated_at = now();
        INSERT INTO ${scope.totals} (tenant_id, version_id)
        SELECT c.tenant_id, c.version_id
          FROM ${CHANGES}
         WHERE c.gained
         ORDER BY c.version_id
        ON CONFLICT (version_id) DO NOTHING;
      END IF;
      RETURN NULL;
    END
    $fn$
  `;
}

/**
 * TRUNCATE of an amounts table bypasses the row and statement triggers: every
 * month of every tenant is gone, so the totals go too (no row is a valid
 * state for a version without months). TRUNCATE ignores RLS, and so does this.
 */
function truncateFunctionSql(scope: Scope): string {
  return `
    CREATE OR REPLACE FUNCTION ${truncateFunction(scope)}() RETURNS trigger
    LANGUAGE plpgsql ${SEARCH_PATH} AS $fn$
    BEGIN
      TRUNCATE ${scope.totals};
      RETURN NULL;
    END
    $fn$
  `;
}

/**
 * The triggers count a month by its version's budget year, so that year must
 * not change once the version has months (services and the AI already refuse
 * it). An AFTER row trigger, run only when the year changes: it refuses the
 * change when the version has a month (any year), and when it cannot see the
 * months (RLS on the amounts, the session on another tenant or none, like a
 * migration that turned RLS off on the versions only). A month inserted
 * meanwhile cannot slip through: budget_year is in a unique index, so the
 * update locks the version FOR UPDATE, which waits for (or holds back) the
 * foreign key check of an amounts insert.
 */
function yearGuardSql(scope: Scope): string {
  return `
    CREATE OR REPLACE FUNCTION ${yearGuard(scope)}() RETURNS trigger
    LANGUAGE plpgsql ${SEARCH_PATH} AS $fn$
    BEGIN
      IF row_security_active('${scope.amounts}') AND app_current_tenant() IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'The budget year of version % cannot change: its months in ${scope.amounts} are hidden by row level security (set app.current_tenant to the version''s tenant)', NEW.id
          USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM ${scope.amounts} a WHERE a.tenant_id = NEW.tenant_id AND a.version_id = NEW.id) THEN
        RAISE EXCEPTION 'The budget year of version % cannot change: it has months in ${scope.amounts}, which ${scope.totals} counts by that year', NEW.id
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NULL;
    END
    $fn$
  `;
}

/**
 * Recompute one scope's totals from its amounts: insert the missing rows,
 * correct the wrong ones, and set back to zero a non-zero row of a version
 * without own-year months. It never deletes a row and never creates one for a
 * version without months, so an all-zero row the triggers left is kept: a
 * rebuild writes nothing exactly when the verify script finds a match.
 */
function rebuildScopeSql(scope: Scope): string {
  const stored = MEASURES.map((m) => `t.${m}`).join(', ');
  const expected = MEASURES.map((m) => `excluded.${m}`).join(', ');
  return `
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
         WHERE (t.tenant_id, ${stored}) IS DISTINCT FROM (excluded.tenant_id, ${expected})
        RETURNING t.tenant_id, (t.xmax = 0) AS inserted
      ),
      zeroed AS (
        UPDATE ${scope.totals} t
           SET ${MEASURES.map((m) => `${m} = 0`).join(', ')}, updated_at = now()
         WHERE (p_tenant IS NULL OR t.tenant_id = p_tenant)
           AND (${stored}) IS DISTINCT FROM (${MEASURES.map(() => '0').join(', ')})
           AND NOT EXISTS (SELECT 1 FROM expected e WHERE e.version_id = t.version_id)
        RETURNING t.tenant_id
      ),
      changes AS (
        SELECT tenant_id, inserted FROM written
        UNION ALL
        SELECT tenant_id, false FROM zeroed
      )
      SELECT '${scope.label}'::text, tenant_id, count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
        FROM changes GROUP BY tenant_id;`;
}

/**
 * The rebuild, as a database function: the migration's backfill, the tenant
 * import (`scripts/tenant-import.sh`, whose triggers are off while it loads)
 * and a repair after anything that bypasses the triggers (a session in
 * `session_replication_role = replica`, a trigger disabled by hand). It runs
 * as the caller: under RLS it sees the session tenant only, so give that
 * tenant (NULL = every tenant, which needs RLS off or a superuser). Returns
 * one row per scope and tenant changed.
 *
 * It first takes a SHARE lock on both amounts tables, in one statement and a
 * fixed order: writers of the amounts wait until it commits, readers go on,
 * so no write can slip between the sums and their storage. A writer already
 * running makes it wait, and every write queued behind it waits too: outside
 * a maintenance window, run it with a `lock_timeout`. Use it in READ
 * COMMITTED (each statement then reads after the lock).
 */
function rebuildFunctionSql(): string {
  return `
    CREATE FUNCTION ${REBUILD_FUNCTION}(p_tenant uuid DEFAULT NULL)
    RETURNS TABLE (scope text, tenant_id uuid, inserted bigint, corrected bigint)
    LANGUAGE plpgsql ${SEARCH_PATH} AS $fn$
    #variable_conflict use_column
    BEGIN
      LOCK TABLE ${SCOPES.map((scope) => scope.amounts).sort().join(', ')} IN SHARE MODE;
      ${SCOPES.map(rebuildScopeSql).join('\n')}
    END
    $fn$
  `;
}

type RebuildRow = { scope: string; tenant_id: string; slug: string | null; inserted: string; corrected: string };

type RlsState = { name: string; enabled: boolean; forced: boolean };

async function restoreRls(queryRunner: QueryRunner, states: RlsState[]) {
  for (const state of states) {
    await queryRunner.query(`ALTER TABLE ${state.name} ${state.enabled ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE ${state.name} ${state.forced ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY`);
  }
}

/**
 * Budget totals per version, maintained by the database (plan
 * planning/perf-scale, lot 2A): `spend_version_totals` and
 * `capex_version_totals` hold the sums of the five amount columns over the
 * months of a version's own budget year, in the line's currency: exactly what
 * the list engine aggregated from `*_amounts` on every request
 * (`EXTRACT(YEAR FROM period) = budget_year`, months and version of the same
 * tenant). A month stored outside its version's year counts nowhere, as
 * before.
 *
 * The invariant, per version:
 * - a version with at least one month in its own budget year has exactly one
 *   row, holding the sums of those months (NULL as 0);
 * - a version without such a month has no row, or a row of zeros (it had
 *   months once: the triggers never delete a row, see triggerFunctionSql).
 * Read a missing row as zeros and the stored sums always equal the months'.
 * The readers report a version when it has a row, like the aggregate that
 * returned a row only for versions with months; they differ only for a
 * version whose own-year months were all deleted while it stays, which no app
 * path does (an item delete removes its months and its versions in one
 * transaction): such a version now reports zeros instead of nothing.
 *
 * - version_id is the primary key (one row per version) and references the
 *   version ON DELETE CASCADE: deleting a version, a line or a tenant removes
 *   the row. A version's budget year cannot change once it has months
 *   (yearGuardSql).
 * - numeric without a scale, NOT NULL DEFAULT 0: the type `SUM()` returns, so
 *   the cents the builder reads are the aggregate's to the cent, and twelve
 *   months of numeric(18,2) can never overflow it.
 * - fillfactor 80 leaves room for HOT updates: every amounts write updates a
 *   row, and no measure column is indexed.
 * - Maintained by AFTER statement triggers on each amounts table (one per
 *   event: PostgreSQL refuses transition tables on a multi-event trigger),
 *   applying the statement's net change (see triggerFunctionSql); a TRUNCATE
 *   of an amounts table truncates its totals. `session_replication_role =
 *   replica` bypasses them all: rebuild afterwards with
 *   budget_version_totals_rebuild(). The triggers run as the caller, under
 *   RLS (they read the versions and write the totals of the session tenant):
 *   a migration that writes amounts with RLS disabled must disable it on the
 *   versions and totals tables too.
 * - Derived data: not exported by scripts/tenant-export.sh; the import
 *   rebuilds it.
 *
 * Idempotent and self-healing: every object is created if missing or
 * replaced, then the backfill recomputes every version from its amounts
 * (inserting missing rows, correcting wrong ones) and logs the counts per
 * tenant. Migrations run without app.current_tenant and these tables are
 * FORCE ROW LEVEL SECURITY, so RLS is disabled on the amounts, versions and
 * totals tables around the backfill, then put back as it was found (read from
 * pg_class first). When the backfill fails inside the migration transaction
 * (TypeORM's default), the original error is rethrown and the rollback puts
 * RLS back; any further statement there would only fail with 25P02 and hide
 * it. The backfill holds a SHARE lock on the amounts tables.
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
      await queryRunner.query(truncateFunctionSql(scope));
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${triggerName(scope, 'truncate')} ON ${scope.amounts}`);
      await queryRunner.query(`
        CREATE TRIGGER ${triggerName(scope, 'truncate')}
        AFTER TRUNCATE ON ${scope.amounts}
        FOR EACH STATEMENT EXECUTE FUNCTION ${truncateFunction(scope)}()
      `);

      await queryRunner.query(yearGuardSql(scope));
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${yearGuard(scope)} ON ${scope.versions}`);
      await queryRunner.query(`
        CREATE TRIGGER ${yearGuard(scope)}
        AFTER UPDATE OF budget_year ON ${scope.versions}
        FOR EACH ROW WHEN (OLD.budget_year IS DISTINCT FROM NEW.budget_year)
        EXECUTE FUNCTION ${yearGuard(scope)}()
      `);
    }
    // Dropped first: CREATE OR REPLACE cannot change the columns a function returns.
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${REBUILD_FUNCTION}(uuid)`);
    await queryRunner.query(rebuildFunctionSql());

    // Backfill: every tenant at once, RLS off around it (no tenant in a migration).
    const tables = SCOPES.flatMap((scope) => [scope.amounts, scope.versions, scope.totals]);
    const found: RlsState[] = await queryRunner.query(
      `SELECT c.relname::text AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
         FROM pg_class c WHERE c.oid = ANY($1::regclass[]) ORDER BY c.relname`,
      [tables],
    );
    for (const table of tables) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    let rows: RebuildRow[];
    try {
      rows = await queryRunner.query(`
        SELECT r.scope, r.tenant_id::text AS tenant_id, t.slug, r.inserted::text AS inserted, r.corrected::text AS corrected
          FROM ${REBUILD_FUNCTION}(NULL) r
          LEFT JOIN tenants t ON t.id = r.tenant_id
         ORDER BY t.slug NULLS LAST, r.tenant_id, r.scope DESC
      `);
    } catch (error) {
      // Outside a transaction nothing rolls back: put RLS back, then report the backfill's own error.
      if (!queryRunner.isTransactionActive) {
        await restoreRls(queryRunner, found).catch((restoreError) => {
          console.error('[Migration] VersionTotals: RLS could not be restored after the failed backfill', restoreError);
        });
      }
      throw error;
    }
    await restoreRls(queryRunner, found);
    logRebuild(rows);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${REBUILD_FUNCTION}(uuid)`);
    for (const scope of [...SCOPES].reverse()) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${yearGuard(scope)} ON ${scope.versions}`);
      await queryRunner.query(`DROP FUNCTION IF EXISTS ${yearGuard(scope)}()`);
      for (const event of ['insert', 'update', 'delete', 'truncate'] as const) {
        await queryRunner.query(`DROP TRIGGER IF EXISTS ${triggerName(scope, event)} ON ${scope.amounts}`);
      }
      await queryRunner.query(`DROP FUNCTION IF EXISTS ${truncateFunction(scope)}()`);
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
    console.log(`${prefix} tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}) ${row.scope}: ${row.inserted} row(s) inserted, ${row.corrected} corrected`);
  }
}
