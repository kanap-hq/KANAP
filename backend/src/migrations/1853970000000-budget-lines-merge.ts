import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] BudgetLinesMerge:';
/** Rows named in a tenant's log line (precedent 1853690000000). */
const NAMED_ROWS = 50;
const MEASURES = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;
/**
 * A table that received at least this many rows in a tenant's run is analyzed at once, in the
 * transaction: with the statistics of before (an empty `spend_amounts`, say), the planner reads it
 * by a nested loop in the next statements, which grows with the square of the rows (measured: the
 * months of 5,000 lines took 94 s that way).
 */
const LARGE_COPY = 1000;

/** The CPX number a line of `spend_items` keeps in `legacy_number` (NULL when it has none). */
const CPX_NUMBER = (alias: string) => `(substring(${alias}.legacy_number FROM '^CPX-([0-9]+)$'))::int`;

/** The 16 pairs: the CAPEX table, its twin of the single family. */
const PAIRS = [
  ['capex_items', 'spend_items'],
  ['capex_versions', 'spend_versions'],
  ['capex_amounts', 'spend_amounts'],
  ['capex_version_totals', 'spend_version_totals'],
  ['capex_round_inputs', 'spend_round_inputs'],
  ['capex_round_input_lines', 'spend_round_input_lines'],
  ['capex_allocations', 'spend_allocations'],
  ['capex_item_analytics_values', 'spend_item_analytics_values'],
  ['capex_item_contacts', 'spend_item_contacts'],
  ['capex_links', 'spend_links'],
  ['capex_attachments', 'spend_attachments'],
  ['application_capex_items', 'application_spend_items'],
  ['asset_capex_items', 'asset_spend_items'],
  ['contract_capex_items', 'contract_spend_items'],
  ['portfolio_project_capex', 'portfolio_project_opex'],
  ['portfolio_request_capex', 'portfolio_request_opex'],
] as const;
const CAPEX_TABLES: string[] = PAIRS.map(([capex]) => capex);
const SPEND_TABLES: string[] = PAIRS.map(([, spend]) => spend);
/** Row level security is lifted on these (migrations run without app.current_tenant), restored as found. */
const RLS_TABLES = [...CAPEX_TABLES, ...SPEND_TABLES, 'search_index', 'item_sequences'];
/** The totals triggers of the family, checked fired (O or A) once restored. */
const TOTALS_TRIGGERS = ['insert', 'update', 'delete', 'truncate'].map((event) => `spend_amounts_version_totals_${event}`);

/**
 * One child table of a line, copied from its CAPEX table to the single family (order of the
 * foreign keys, exploration report §1.7). `columns`: each target column with the source expression
 * (`c`: the source row). `lines` names the line set the rows belong to (an SQL set of line ids);
 * `candidate(lines)` is a predicate on `c`: the rows of those lines, whatever their state;
 * `eligible`: those copied (their parent copied in this run, the line's tenant, `$1`).
 */
type ChildCopy = {
  key: string;
  label: string;
  source: string;
  target: string;
  identity: string[];
  columns: Array<[string, string]>;
  candidate: (lines: string) => string;
  eligible: string;
  /** The id of the source row's CAPEX line (`c`), named when a line already moved lacks the row. */
  lineOf: string;
  /** Temp table that records the ids copied (the parents of the next copies). */
  record?: 'z1_versions' | 'z1_rounds';
  /** Why a candidate left out is left out, for the log. */
  removed: string;
};

const same = (columns: string[]): Array<[string, string]> => columns.map((column) => [column, `c.${column}`]);
const versionsOf = (lines: string) => `(SELECT v.id FROM capex_versions v WHERE v.capex_item_id IN ${lines})`;
const roundsOf = (lines: string) => `(SELECT r.id FROM capex_round_inputs r JOIN capex_versions v ON v.id = r.version_id WHERE v.capex_item_id IN ${lines})`;
const OF_VERSION_COPIED = `c.tenant_id = $1 AND c.version_id IN (SELECT id FROM z1_versions)`;
const LINE_OF_VERSION = '(SELECT v.capex_item_id FROM capex_versions v WHERE v.id = c.version_id)';
const LINE_OF_ROUND = '(SELECT v.capex_item_id FROM capex_round_inputs r JOIN capex_versions v ON v.id = r.version_id WHERE r.id = c.round_input_id)';
const OTHER_TENANT = 'row of another tenant than its line';
const PARENT_LEFT = 'parent left out, or row of another tenant than its line';

const CHILDREN: ChildCopy[] = [
  {
    key: 'versions', label: 'version(s)', source: 'capex_versions', target: 'spend_versions', identity: ['id'],
    columns: [
      ['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['spend_item_id', 'c.capex_item_id'],
      ...same(['version_name', 'input_grain', 'is_approved', 'as_of_date', 'budget_year', 'notes', 'fx_rate_set_id', 'reporting_currency',
        'allocation_method', 'allocation_driver', 'budget_rev', 'budget_changed_at', 'created_at', 'updated_at']),
    ],
    lineOf: 'c.capex_item_id',
    candidate: (lines) => `c.capex_item_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    record: 'z1_versions',
    removed: OTHER_TENANT,
  },
  {
    key: 'months', label: 'month(s)', source: 'capex_amounts', target: 'spend_amounts', identity: ['id'],
    columns: same(['id', 'tenant_id', 'version_id', 'period', ...MEASURES, 'created_at', 'updated_at']),
    lineOf: LINE_OF_VERSION,
    candidate: (lines) => `c.version_id IN ${versionsOf(lines)}`,
    eligible: OF_VERSION_COPIED,
    removed: PARENT_LEFT,
  },
  {
    key: 'totals', label: 'version total(s)', source: 'capex_version_totals', target: 'spend_version_totals', identity: ['version_id'],
    columns: same(['version_id', 'tenant_id', ...MEASURES, 'updated_at']),
    lineOf: LINE_OF_VERSION,
    candidate: (lines) => `c.version_id IN ${versionsOf(lines)}`,
    eligible: OF_VERSION_COPIED,
    removed: PARENT_LEFT,
  },
  {
    key: 'rounds', label: 'column round(s)', source: 'capex_round_inputs', target: 'spend_round_inputs', identity: ['id'],
    columns: same(['id', 'tenant_id', 'version_id', 'measure', 'period_start', 'period_end', 'method', 'spread_profile_name',
      'last_calculation', 'updated_by', 'fte', 'created_at', 'updated_at']),
    lineOf: LINE_OF_VERSION,
    candidate: (lines) => `c.version_id IN ${versionsOf(lines)}`,
    eligible: OF_VERSION_COPIED,
    record: 'z1_rounds',
    removed: PARENT_LEFT,
  },
  {
    key: 'costedLines', label: 'costed line(s)', source: 'capex_round_input_lines', target: 'spend_round_input_lines', identity: ['id'],
    columns: same(['id', 'tenant_id', 'round_input_id', 'sort', 'label', 'quantity_unit', 'quantity', 'unit_price', 'price_basis', 'frequency',
      'days_per_month', 'working_day_profile_id', 'period_start', 'period_end', 'created_at', 'updated_at']),
    lineOf: LINE_OF_ROUND,
    candidate: (lines) => `c.round_input_id IN ${roundsOf(lines)}`,
    eligible: `c.tenant_id = $1 AND c.round_input_id IN (SELECT id FROM z1_rounds)`,
    removed: PARENT_LEFT,
  },
  {
    key: 'allocations', label: 'allocation(s)', source: 'capex_allocations', target: 'spend_allocations', identity: ['id'],
    columns: same(['id', 'tenant_id', 'version_id', 'company_id', 'department_id', 'allocation_pct', 'is_system_generated', 'rule_id',
      'materialized_from', 'created_at', 'updated_at']),
    lineOf: LINE_OF_VERSION,
    candidate: (lines) => `c.version_id IN ${versionsOf(lines)}`,
    // The OPEX table refuses a company or department that does not exist (foreign keys); the CAPEX one never checked.
    eligible: `${OF_VERSION_COPIED}
      AND EXISTS (SELECT 1 FROM companies co WHERE co.tenant_id = $1 AND co.id = c.company_id)
      AND (c.department_id IS NULL OR EXISTS (SELECT 1 FROM departments d WHERE d.tenant_id = $1 AND d.id = c.department_id))`,
    removed: 'company or department missing, or parent left out',
  },
  {
    key: 'dimensionValues', label: 'dimension value(s)', source: 'capex_item_analytics_values', target: 'spend_item_analytics_values',
    identity: ['tenant_id', 'item_id', 'axis_id'],
    columns: same(['tenant_id', 'item_id', 'axis_id', 'category_id', 'created_at', 'updated_at']),
    lineOf: 'c.item_id',
    candidate: (lines) => `c.item_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    removed: OTHER_TENANT,
  },
  {
    key: 'contacts', label: 'contact(s)', source: 'capex_item_contacts', target: 'spend_item_contacts', identity: ['id'],
    columns: [['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['spend_item_id', 'c.capex_item_id'], ...same(['contact_id', 'role', 'origin', 'created_at', 'updated_at'])],
    lineOf: 'c.capex_item_id',
    candidate: (lines) => `c.capex_item_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    removed: OTHER_TENANT,
  },
  {
    key: 'webLinks', label: 'web link(s)', source: 'capex_links', target: 'spend_links', identity: ['id'],
    columns: [['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['spend_item_id', 'c.capex_item_id'], ...same(['description', 'url', 'created_at'])],
    lineOf: 'c.capex_item_id',
    candidate: (lines) => `c.capex_item_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    removed: OTHER_TENANT,
  },
  {
    key: 'attachments', label: 'attachment(s)', source: 'capex_attachments', target: 'spend_attachments', identity: ['id'],
    columns: [['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['spend_item_id', 'c.capex_item_id'],
      ...same(['original_filename', 'stored_filename', 'mime_type', 'size', 'storage_path', 'uploaded_at'])],
    lineOf: 'c.capex_item_id',
    candidate: (lines) => `c.capex_item_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    removed: OTHER_TENANT,
  },
  {
    key: 'applicationLinks', label: 'application link(s)', source: 'application_capex_items', target: 'application_spend_items', identity: ['id'],
    columns: [['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['application_id', 'c.application_id'], ['spend_item_id', 'c.capex_item_id'], ['created_at', 'c.created_at']],
    lineOf: 'c.capex_item_id',
    candidate: (lines) => `c.capex_item_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    removed: OTHER_TENANT,
  },
  {
    key: 'assetLinks', label: 'asset link(s)', source: 'asset_capex_items', target: 'asset_spend_items', identity: ['id'],
    columns: [['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['asset_id', 'c.asset_id'], ['spend_item_id', 'c.capex_item_id'], ['created_at', 'c.created_at']],
    lineOf: 'c.capex_item_id',
    candidate: (lines) => `c.capex_item_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    removed: OTHER_TENANT,
  },
  {
    key: 'contractLinks', label: 'contract link(s)', source: 'contract_capex_items', target: 'contract_spend_items', identity: ['id'],
    columns: [['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['contract_id', 'c.contract_id'], ['spend_item_id', 'c.capex_item_id'], ['created_at', 'c.created_at']],
    lineOf: 'c.capex_item_id',
    candidate: (lines) => `c.capex_item_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    removed: OTHER_TENANT,
  },
  {
    key: 'projectLinks', label: 'project link(s)', source: 'portfolio_project_capex', target: 'portfolio_project_opex', identity: ['id'],
    columns: [['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['project_id', 'c.project_id'], ['opex_id', 'c.capex_id'], ['created_at', 'c.created_at']],
    lineOf: 'c.capex_id',
    candidate: (lines) => `c.capex_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    removed: OTHER_TENANT,
  },
  {
    key: 'requestLinks', label: 'request link(s)', source: 'portfolio_request_capex', target: 'portfolio_request_opex', identity: ['id'],
    columns: [['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['request_id', 'c.request_id'], ['opex_id', 'c.capex_id'], ['created_at', 'c.created_at']],
    lineOf: 'c.capex_id',
    candidate: (lines) => `c.capex_id IN ${lines}`,
    eligible: 'c.tenant_id = $1',
    removed: OTHER_TENANT,
  },
];

/** The lines of this run, of this tenant (`z1_lines`), and the lines not moved yet (any tenant), as SQL sets. */
const RUN_LINES = '(SELECT id FROM z1_lines)';
/**
 * The CAPEX lines still to move: not in spend_items yet, of a tenant no earlier run moved. A tenant
 * with at least one CAPEX line already in spend_items (its UUID in both tables) was moved before
 * (`z1_moved_tenants`, filled before any write): a line of capex_items it lacks in spend_items was
 * deleted since the move, and is left alone (named in the log), never copied again.
 */
const PENDING_LINES = `(SELECT x.id FROM capex_items x
  WHERE NOT EXISTS (SELECT 1 FROM spend_items l WHERE l.id = x.id)
    AND x.tenant_id NOT IN (SELECT m.tenant_id FROM z1_moved_tenants m))`;
/** The tenants with a CAPEX line already in spend_items (same UUID, same tenant), as found before any write. */
const MOVED_TENANTS_SQL = `SELECT DISTINCT s.tenant_id FROM spend_items s
  JOIN capex_items c ON c.id = s.id AND c.tenant_id = s.tenant_id
 WHERE s.nature = 'capex'`;

/** A supplier kept only when it exists in the line's tenant (the OPEX table has the foreign key the CAPEX one lacked). */
const SUPPLIER = `CASE WHEN EXISTS (SELECT 1 FROM suppliers sp WHERE sp.tenant_id = c.tenant_id AND sp.id = c.supplier_id) THEN c.supplier_id END`;

/** The columns of a CAPEX line in `spend_items` (the number apart): title in `product_name`, notes kept, no OPEX description. */
const LINE_COLUMNS: Array<[string, string]> = [
  ['id', 'c.id'], ['tenant_id', 'c.tenant_id'], ['nature', `'capex'`], ['legacy_number', `'CPX-' || c.item_number`],
  ['paying_company_id', 'c.paying_company_id'], ['product_name', 'c.description'], ['description', 'NULL::text'], ['supplier_id', SUPPLIER],
  ...same(['account_id', 'currency', 'effective_start', 'legacy_effective_end', 'status', 'disabled_at', 'owner_it_id', 'owner_business_id',
    'analytics_category_id', 'project_id']),
  ['contract_id', 'NULL::uuid'],
  ...same(['cost_center_id', 'run_build', 'notes', 'created_at', 'updated_at', 'row_version', 'ppe_type', 'investment_type', 'priority']),
];

type TenantRow = { id: string; slug: string | null };
type Counts = Record<string, number>;

/** An UPDATE through the query runner returns [rows, count]: every count goes through a CTE. */
async function countOf(queryRunner: QueryRunner, statement: string, params: unknown[] = []): Promise<number> {
  const [{ n }]: Array<{ n: number }> = await queryRunner.query(`WITH changed AS (${statement} RETURNING 1) SELECT count(*)::int AS n FROM changed`, params);
  return n;
}

async function scalar(queryRunner: QueryRunner, sql: string, params: unknown[] = []): Promise<number> {
  const [{ n }]: Array<{ n: number | string | null }> = await queryRunner.query(sql, params);
  return Number(n ?? 0);
}

const tenantName = (tenant: TenantRow) => `${tenant.slug || '(no slug)'} (${tenant.id})`;

/**
 * The single family of budget lines, data part (plan planning/budget-unifie.md, lot Z1, §5; brief
 * planning/budget-unifie/lot-z1-brief.md §2): every CAPEX line moves from the `capex_*` tables into
 * `spend_*`, with its nature, its UUID and every child, in the transaction of the pending
 * migrations (1853960000000 prepared the schema).
 *
 * 0. With row level security lifted on the 32 tables, `search_index` and `item_sequences`, and the
 *    user triggers of the `spend_*` tables off (both restored as found, also on failure: the copy
 *    moves neither `budget_rev`, nor `row_version`, nor a total, nor the search index):
 * 1. Checks, before any write, failing fast with the ids named: the tables and columns exist; the
 *    totals triggers fire; the lines an earlier run moved hold their children; no CAPEX row to move
 *    shares its UUID with a row of its twin table; no CPX number to keep is held by another line;
 *    the numbers fit. Per tenant (app.current_tenant set): the lines and rows to
 *    move and those left out, logged. CAPEX rows of a tenant that no longer exists stay where they
 *    are (unreachable before as after), counted.
 * 2. OPEX lines without a legacy number get `OPX-<number>` (lot Z0 left the lines created since
 *    without one).
 * 3. Per tenant, in (created_at, id) order, app.current_tenant set, the setting found put back:
 *    - the CAPEX lines not in `spend_items` yet: nature `capex`, `product_name` = the CAPEX title,
 *      `description` NULL, `notes` kept, the three CAPEX enums, `legacy_number` = `CPX-<old number>`,
 *      `item_number` = the next BL numbers after GREATEST(the tenant's highest line number, the
 *      `spend` sequence - 1), in (created_at, id) order (a number once given is never given again);
 *      a supplier the tenant does not have is left empty (counted);
 *    - their children, in foreign key order, each row whose parent was copied in this run and of
 *      the line's tenant: versions, months, version totals (as stored), column rounds, costed
 *      lines, allocations (left out when their company or department does not exist), dimension
 *      values, contacts, web links, attachments (the stored file is shared, never copied),
 *      application, asset, contract, project and request links. Tasks keep their type
 *      (`capex_item`) and line id; the audit log keeps its labels;
 *    - version totals that differ from their months (a stale stored total) are computed again,
 *      counted;
 *    - checks, an exception otherwise: every row copied is in its new table with the same UUID
 *      and the same values (`row_version`, `budget_rev` included), the BL numbers are the next
 *      ones, each measure of the months sums the same, each total equals its months.
 *    - one log line: the counts, what was left out (the first 50 rows named).
 * 4. Sequences: `spend` = the last BL number + 1; `capex` kept above every CPX number (the CAPEX API
 *    still gives new lines a CPX number).
 * 5. Every tenant's line entries indexed again (time logged); `ANALYZE` of the tables written.
 * 6. Every CAPEX line of an existing tenant is in `spend_items`, the totals triggers fire: else an
 *    exception. The totals of each nature are logged.
 *
 * A second run moves nothing, renumbers nothing, completes missing legacy numbers and checks
 * again. A tenant with a CAPEX line already in `spend_items` was moved by an earlier run: none of
 * its lines is copied again (a line of capex_items missing from spend_items was deleted since the
 * move: left alone, named in the log), and each of its lines already there must hold all its
 * children, else an exception names it before any write. The totals triggers are checked before
 * any write too. The `capex_*` tables keep their rows (lot Z2 drops them).
 *
 * down() moves the CAPEX lines back: it refuses a CAPEX line the `capex_*` tables cannot hold (an
 * enum empty, a contract set), then, per tenant, deletes the CAPEX rows whose line is gone, copies
 * every CAPEX line and child back (upsert by UUID, `item_number` from the legacy CPX number or the
 * `capex` sequence, `description` = the title, an OPEX description joined to the notes), checks the
 * copy, and deletes the CAPEX lines from `spend_*`. It restores metadata: a stored file deleted
 * since is not brought back. The rows up() left out in `capex_*` (an allocation to a company or
 * department that does not exist, a child of another tenant than its line) are lost: down()
 * deletes the dormant children of each line before copying back what `spend_*` holds, and they are
 * not there. up() named them in its log.
 */
export class BudgetLinesMerge1853970000000 implements MigrationInterface {
  name = 'BudgetLinesMerge1853970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await assertTablesPresent(queryRunner);
    const foundTenant = await currentTenantSetting(queryRunner);
    await withoutRowSecurity(queryRunner, RLS_TABLES, async () => {
      const tenants: TenantRow[] = await queryRunner.query(`SELECT id::text AS id, slug FROM tenants ORDER BY created_at ASC, id ASC`);
      try {
        // A temporary table, no data written: the tenants an earlier run moved, as found now.
        await queryRunner.query(`CREATE TEMP TABLE IF NOT EXISTS z1_moved_tenants (tenant_id uuid PRIMARY KEY) ON COMMIT DROP`);
        await queryRunner.query(`TRUNCATE z1_moved_tenants`);
        await queryRunner.query(`INSERT INTO z1_moved_tenants (tenant_id) ${MOVED_TENANTS_SQL}`);
        await precheck(queryRunner, tenants);
        await withoutUserTriggers(queryRunner, SPEND_TABLES, async () => {
          await queryRunner.query(`CREATE TEMP TABLE IF NOT EXISTS z1_lines (id uuid PRIMARY KEY) ON COMMIT DROP`);
          await queryRunner.query(`CREATE TEMP TABLE IF NOT EXISTS z1_versions (id uuid PRIMARY KEY) ON COMMIT DROP`);
          await queryRunner.query(`CREATE TEMP TABLE IF NOT EXISTS z1_rounds (id uuid PRIMARY KEY) ON COMMIT DROP`);
          const opexNumbered = await countOf(
            queryRunner,
            `UPDATE spend_items s SET legacy_number = 'OPX-' || s.item_number
              WHERE s.nature = 'opex' AND s.legacy_number IS NULL
                AND NOT EXISTS (SELECT 1 FROM spend_items o WHERE o.tenant_id = s.tenant_id AND o.legacy_number = 'OPX-' || s.item_number)`,
          );
          if (opexNumbered > 0) console.log(`${LOG_PREFIX} ${opexNumbered} OPEX line(s) given their legacy number OPX-n`);
          let moved = 0;
          for (const tenant of tenants) {
            await setTenant(queryRunner, tenant.id);
            moved += await mergeTenant(queryRunner, tenant);
          }
          for (const tenant of tenants) {
            await setTenant(queryRunner, tenant.id);
            await advanceSequences(queryRunner, tenant.id);
          }
          if (moved > 0) {
            for (const table of SPEND_TABLES) await queryRunner.query(`ANALYZE ${table}`);
          }
        });
        await assertTotalsTriggersFire(queryRunner);
        const reindexMs = await reindexLines(queryRunner, tenants);
        await finalCheck(queryRunner, tenants);
        console.log(`${LOG_PREFIX} done in ${Date.now() - started} ms (search index of the lines rebuilt in ${reindexMs} ms)`);
      } finally {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [foundTenant]).catch(() => undefined);
      }
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const started = Date.now();
    await assertTablesPresent(queryRunner);
    const foundTenant = await currentTenantSetting(queryRunner);
    await withoutRowSecurity(queryRunner, RLS_TABLES, async () => {
      const tenants: TenantRow[] = await queryRunner.query(`SELECT id::text AS id, slug FROM tenants ORDER BY created_at ASC, id ASC`);
      try {
        await assertRestorable(queryRunner);
        await withoutUserTriggers(queryRunner, [...CAPEX_TABLES, ...SPEND_TABLES], async () => {
          for (const tenant of tenants) {
            await setTenant(queryRunner, tenant.id);
            await restoreTenant(queryRunner, tenant);
          }
          for (const table of CAPEX_TABLES) await queryRunner.query(`ANALYZE ${table}`);
        });
        console.log(`${LOG_PREFIX} reverted in ${Date.now() - started} ms; the CAPEX lines are back in the capex_* tables`);
      } finally {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [foundTenant]).catch(() => undefined);
      }
    });
  }
}

/* ------------------------------------------------------------------ up ---- */

async function assertTablesPresent(queryRunner: QueryRunner): Promise<void> {
  const missing: Array<{ name: string }> = await queryRunner.query(
    `SELECT t.name FROM unnest($1::text[]) AS t(name) WHERE to_regclass(t.name) IS NULL`,
    [[...CAPEX_TABLES, ...SPEND_TABLES, 'search_index', 'item_sequences', 'tenants']],
  );
  if (missing.length > 0) throw new Error(`${LOG_PREFIX} table(s) missing: ${missing.map((row) => row.name).join(', ')}; nothing was changed.`);
  const columns: Array<{ name: string }> = await queryRunner.query(
    `SELECT c.name FROM unnest($1::text[]) AS c(name)
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns i
                         WHERE i.table_schema = current_schema() AND i.table_name = 'spend_items' AND i.column_name = c.name)`,
    [['nature', 'legacy_number', 'ppe_type', 'investment_type', 'priority']],
  );
  if (columns.length > 0) {
    throw new Error(`${LOG_PREFIX} spend_items lacks ${columns.map((row) => row.name).join(', ')} (migrations 1853950000000 and 1853960000000); nothing was changed.`);
  }
}

async function currentTenantSetting(queryRunner: QueryRunner): Promise<string> {
  const [row] = await queryRunner.query(`SELECT coalesce(current_setting('app.current_tenant', true), '') AS tenant`);
  return String(row?.tenant ?? '');
}

async function setTenant(queryRunner: QueryRunner, tenantId: string): Promise<void> {
  await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

/** The ids of up to `limit` rows a query returns, as text. */
async function ids(queryRunner: QueryRunner, sql: string, params: unknown[] = [], limit = 5): Promise<string[]> {
  const rows: Array<{ id: string }> = await queryRunner.query(`SELECT x.id::text AS id FROM (${sql}) x LIMIT ${limit}`, params);
  return rows.map((row) => row.id);
}

/** Step 1: nothing is written before these pass. */
async function precheck(queryRunner: QueryRunner, tenants: TenantRow[]): Promise<void> {
  // The totals triggers must fire once the copy is done: a trigger found disabled stays disabled
  // (withoutUserTriggers restores what it found), so it is refused here, before any write.
  await assertTotalsTriggersFire(queryRunner);
  await assertMovedLinesComplete(queryRunner, tenants);
  // A CAPEX line whose UUID another row of spend_items holds (an OPEX line, or a line of another tenant).
  const lineClash = await ids(
    queryRunner,
    `SELECT c.id FROM capex_items c JOIN spend_items s ON s.id = c.id WHERE NOT (s.nature = 'capex' AND s.tenant_id = c.tenant_id) ORDER BY c.id`,
  );
  if (lineClash.length > 0) {
    throw new Error(`${LOG_PREFIX} CAPEX line(s) ${lineClash.join(', ')} share their UUID with another line of spend_items; nothing was changed. Each must be looked at by hand.`);
  }
  // A child of a line still to move whose UUID its twin table already holds.
  for (const child of CHILDREN) {
    if (child.identity.length !== 1 || child.identity[0] !== 'id') continue;
    const clash = await ids(
      queryRunner,
      `SELECT c.id FROM ${child.source} c JOIN ${child.target} t ON t.id = c.id WHERE ${child.candidate(PENDING_LINES)} ORDER BY c.id`,
    );
    if (clash.length > 0) {
      throw new Error(`${LOG_PREFIX} ${child.source} row(s) ${clash.join(', ')} share their UUID with a row of ${child.target}; nothing was changed. Each must be looked at by hand.`);
    }
  }
  // A CPX number to keep that another line already holds as its legacy number.
  const numberClash = await ids(
    queryRunner,
    `SELECT c.id FROM capex_items c
      WHERE c.id IN ${PENDING_LINES}
        AND EXISTS (SELECT 1 FROM spend_items s WHERE s.tenant_id = c.tenant_id AND s.legacy_number = 'CPX-' || c.item_number)
      ORDER BY c.id`,
  );
  if (numberClash.length > 0) {
    throw new Error(`${LOG_PREFIX} CAPEX line(s) ${numberClash.join(', ')}: their CPX number is already another line's legacy number; nothing was changed.`);
  }
  const orphans = await scalar(
    queryRunner,
    `SELECT count(*)::int AS n FROM capex_items c WHERE c.id IN ${PENDING_LINES} AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = c.tenant_id)`,
  );
  if (orphans > 0) {
    console.log(`${LOG_PREFIX} ${orphans} CAPEX line(s) of a tenant that no longer exists stay in capex_items (unreachable, as before)`);
  }
  for (const tenant of tenants) {
    await setTenant(queryRunner, tenant.id);
    const [plan] = await queryRunner.query(
      `SELECT count(*)::int AS lines,
              GREATEST(
                (SELECT coalesce(max(s.item_number), 0) FROM spend_items s WHERE s.tenant_id = $1),
                (SELECT coalesce(max(q.next_val) - 1, 0) FROM item_sequences q WHERE q.tenant_id = $1 AND q.entity_type = 'spend')
              )::bigint AS base
         FROM capex_items c WHERE c.tenant_id = $1 AND c.id IN ${PENDING_LINES}`,
      [tenant.id],
    );
    const lines = Number(plan.lines);
    if (lines === 0) continue;
    if (Number(plan.base) + lines > 2147483647) {
      throw new Error(`${LOG_PREFIX} tenant ${tenantName(tenant)}: ${lines} CAPEX line(s) after number ${plan.base} do not fit the line numbers; nothing was changed.`);
    }
    const pending = `(SELECT x.id FROM capex_items x WHERE x.tenant_id = $1 AND x.id IN ${PENDING_LINES})`;
    const left: string[] = [];
    for (const child of CHILDREN) {
      const candidates = await scalar(queryRunner, `SELECT count(*)::int AS n FROM ${child.source} c WHERE ${child.candidate(pending)}`, [tenant.id]);
      if (candidates > 0) left.push(`${candidates} ${child.label}`);
    }
    const suppliers = await scalar(
      queryRunner,
      `SELECT count(*)::int AS n FROM capex_items c WHERE c.tenant_id = $1 AND c.id IN ${PENDING_LINES} AND c.supplier_id IS NOT NULL AND (${SUPPLIER}) IS NULL`,
      [tenant.id],
    );
    console.log(
      `${LOG_PREFIX} check: tenant ${tenantName(tenant)}: ${lines} CAPEX line(s) to move after number ${plan.base}`
        + (left.length ? ` with ${left.join(', ')}` : '')
        + (suppliers ? `; ${suppliers} unknown supplier(s) to leave empty` : ''),
    );
  }
}

/**
 * Step 1, the tenants an earlier run moved (`z1_moved_tenants`): each of their CAPEX lines already in
 * spend_items must hold there every row the move copies, in each child table (the version totals
 * apart: derived, kept by the triggers). A run moves a line with its children in one transaction;
 * a line there without them comes from a manual change, which the migration refuses to guess
 * about: an exception names the lines and, per table, the rows missing.
 */
async function assertMovedLinesComplete(queryRunner: QueryRunner, tenants: TenantRow[]): Promise<void> {
  const moved: Array<{ id: string }> = await queryRunner.query(`SELECT tenant_id::text AS id FROM z1_moved_tenants ORDER BY 1`);
  const byId = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  for (const { id: t } of moved) {
    const tenant = byId.get(t) ?? { id: t, slug: null };
    await setTenant(queryRunner, t);
    const lines = `(SELECT s.id FROM spend_items s JOIN capex_items x ON x.id = s.id AND x.tenant_id = s.tenant_id
                     WHERE s.tenant_id = $1 AND s.nature = 'capex')`;
    const missing: string[] = [];
    const named = new Set<string>();
    for (const child of CHILDREN) {
      if (child.key === 'totals') continue;
      // The rows the move copied: of the line's tenant, their parent moved too (in spend_*).
      const copied = child.eligible.replace(/z1_versions/g, 'spend_versions').replace(/z1_rounds/g, 'spend_round_inputs');
      const rows: Array<{ line: string; n: number }> = await queryRunner.query(
        `SELECT ${child.lineOf}::text AS line, count(*)::int AS n
           FROM ${child.source} c
          WHERE ${child.candidate(lines)} AND ${copied}
            AND NOT EXISTS (SELECT 1 FROM ${child.target} d WHERE ${child.identity.map((key) => `d.${key} = c.${key}`).join(' AND ')})
          GROUP BY 1 ORDER BY 1`,
        [t],
      );
      if (rows.length === 0) continue;
      missing.push(`${rows.reduce((sum, row) => sum + Number(row.n), 0)} ${child.label} of ${child.source} not in ${child.target}`);
      for (const row of rows) named.add(row.line);
    }
    if (missing.length > 0) {
      const shown = [...named].slice(0, 5);
      throw new Error(
        `${LOG_PREFIX} tenant ${tenantName(tenant)}: CAPEX line(s) ${shown.join(', ')}${named.size > shown.length ? ` and ${named.size - shown.length} more` : ''}`
          + ` are in spend_items without all their children (${missing.join('; ')}); nothing was changed.`
          + ' A run moves a line with its children: this state comes from a manual change, look at it by hand.',
      );
    }
  }
}

/** Step 3 for one tenant: the CAPEX lines not moved yet, and their children. Returns the lines moved. */
async function mergeTenant(queryRunner: QueryRunner, tenant: TenantRow): Promise<number> {
  const t = tenant.id;
  for (const table of ['z1_lines', 'z1_versions', 'z1_rounds']) await queryRunner.query(`TRUNCATE ${table}`);
  // A CAPEX line already moved without its legacy number (a second run): its CPX number back.
  const completed = await countOf(
    queryRunner,
    `UPDATE spend_items s SET legacy_number = 'CPX-' || c.item_number
       FROM capex_items c
      WHERE s.tenant_id = $1 AND s.nature = 'capex' AND s.legacy_number IS NULL AND c.id = s.id AND c.tenant_id = s.tenant_id
        AND NOT EXISTS (SELECT 1 FROM spend_items o WHERE o.tenant_id = s.tenant_id AND o.legacy_number = 'CPX-' || c.item_number)`,
    [t],
  );
  const [{ moved }] = await queryRunner.query(`SELECT EXISTS (SELECT 1 FROM z1_moved_tenants WHERE tenant_id = $1) AS moved`, [t]);
  if (moved) {
    // Moved by an earlier run: its CAPEX lines missing from spend_items were deleted since, left alone.
    const left: Array<{ id: string }> = await queryRunner.query(
      `SELECT c.id::text AS id FROM capex_items c
        WHERE c.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM spend_items s WHERE s.id = c.id)
        ORDER BY c.created_at, c.id`,
      [t],
    );
    if (left.length > 0 || completed > 0) {
      const shown = left.slice(0, NAMED_ROWS).map((row) => row.id);
      console.log(
        `${LOG_PREFIX} tenant ${tenantName(tenant)}: moved by an earlier run, nothing to move`
          + (completed ? `; ${completed} CAPEX legacy number(s) completed` : '')
          + (left.length ? `; ${left.length} line(s) of capex_items not in spend_items (deleted since the move) left alone: ${shown.join(', ')}${left.length > shown.length ? `; and ${left.length - shown.length} more` : ''}` : ''),
      );
    }
    return 0;
  }
  const base = await scalar(
    queryRunner,
    `SELECT GREATEST(
              (SELECT coalesce(max(s.item_number), 0) FROM spend_items s WHERE s.tenant_id = $1),
              (SELECT coalesce(max(q.next_val) - 1, 0) FROM item_sequences q WHERE q.tenant_id = $1 AND q.entity_type = 'spend')
            )::int AS n`,
    [t],
  );
  const suppliers = await queryRunner.query(
    `SELECT c.id::text AS id FROM capex_items c
      WHERE c.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM spend_items s WHERE s.id = c.id)
        AND c.supplier_id IS NOT NULL AND (${SUPPLIER}) IS NULL
      ORDER BY c.created_at, c.id`,
    [t],
  ) as Array<{ id: string }>;
  const lineColumns = LINE_COLUMNS.map(([column]) => column);
  let lines: number;
  try {
    lines = await scalar(
      queryRunner,
      `WITH todo AS (
         SELECT c.*, row_number() OVER (ORDER BY c.created_at, c.id) AS rn
           FROM capex_items c
          WHERE c.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM spend_items s WHERE s.id = c.id)
       ), ins AS (
         INSERT INTO spend_items (item_number, ${lineColumns.join(', ')})
         SELECT $2::int + c.rn, ${LINE_COLUMNS.map(([, expr]) => expr).join(', ')}
           FROM todo c
         RETURNING id
       ), rec AS (
         INSERT INTO z1_lines (id) SELECT id FROM ins RETURNING 1
       )
       SELECT count(*)::int AS n FROM rec`,
      [t, base],
    );
  } catch (error) {
    throw new Error(`${LOG_PREFIX} tenant ${tenantName(tenant)}: the CAPEX lines could not be copied: ${(error as Error).message}`);
  }
  if (lines >= LARGE_COPY) await analyze(queryRunner, ['spend_items', 'z1_lines']);
  if (lines === 0) {
    if (completed > 0) console.log(`${LOG_PREFIX} tenant ${tenantName(tenant)}: nothing to move; ${completed} CAPEX legacy number(s) completed`);
    return 0;
  }

  const counts: Counts = {};
  const removed: string[] = [];
  const removedCounts: string[] = [];
  for (const child of CHILDREN) {
    const columns = child.columns.map(([column]) => column);
    const insert = `INSERT INTO ${child.target} (${columns.join(', ')})
      SELECT ${child.columns.map(([, expr]) => expr).join(', ')}
        FROM ${child.source} c
       WHERE ${child.candidate(RUN_LINES)} AND ${child.eligible}
      RETURNING ${child.record ? 'id' : '1'}`;
    // No "not already there" test against the target: none of these rows can be there. The lines
    // are those inserted in this run; precheck() refused a child UUID its twin table holds, and the
    // other keys (version totals, dimension values) hang on a version or line inserted in this run.
    // A duplicate would fail the unique key, rolling everything back. Such a test would read the
    // target while the statement fills it: a nested loop over a table that grows (see LARGE_COPY).
    try {
      counts[child.key] = child.record
        ? await scalar(queryRunner, `WITH ins AS (${insert}), rec AS (INSERT INTO ${child.record} (id) SELECT id FROM ins RETURNING 1) SELECT count(*)::int AS n FROM rec`, [t])
        : await scalar(queryRunner, `WITH ins AS (${insert}) SELECT count(*)::int AS n FROM ins`, [t]);
    } catch (error) {
      throw new Error(`${LOG_PREFIX} tenant ${tenantName(tenant)}: ${child.source} could not be copied to ${child.target}: ${(error as Error).message}`);
    }
    if (counts[child.key] >= LARGE_COPY) await analyze(queryRunner, child.record ? [child.target, child.record] : [child.target]);
    const leftOut: Array<{ id: string }> = await queryRunner.query(
      `SELECT ${child.identity.length === 1 ? `c.${child.identity[0]}::text` : `concat_ws('/', ${child.identity.map((key) => `c.${key}::text`).join(', ')})`} AS id
         FROM ${child.source} c
        WHERE ${child.candidate(RUN_LINES)} AND NOT (${child.eligible})
        ORDER BY 1`,
      [t],
    );
    if (leftOut.length > 0) {
      removedCounts.push(`${leftOut.length} ${child.label} (${child.removed})`);
      for (const row of leftOut) removed.push(`${child.source} ${row.id}`);
    }
  }

  const repairedTotals = await repairTotals(queryRunner, t);
  await verifyTenant(queryRunner, tenant, base, lines);

  for (const id of suppliers.map((row) => row.id)) removed.push(`supplier of line ${id}`);
  const shown = removed.slice(0, NAMED_ROWS);
  console.log(
    `${LOG_PREFIX} tenant ${tenantName(tenant)}: ${lines} line(s) (BL-${base + 1} to BL-${base + lines})`
      + CHILDREN.map((child) => `, ${counts[child.key] ?? 0} ${child.label}`).join('')
      + (completed ? `; ${completed} legacy number(s) completed` : '')
      + `; left out: ${removedCounts.length || suppliers.length ? [...removedCounts, ...(suppliers.length ? [`${suppliers.length} unknown supplier(s) left empty`] : [])].join(', ') : 'nothing'}`
      + (repairedTotals ? `; ${repairedTotals} stale version total(s) computed again` : '')
      + (shown.length ? `. Named: ${shown.join('; ')}${removed.length > shown.length ? `; and ${removed.length - shown.length} more` : ''}` : ''),
  );
  return lines;
}

/** A version's totals from its months of its own budget year (1853720000000's invariant). */
const RECOMPUTED_TOTALS = `SELECT v.id AS version_id, v.tenant_id,
         ${MEASURES.map((m) => `coalesce(sum(a.${m}) FILTER (WHERE EXTRACT(YEAR FROM a.period) = v.budget_year), 0) AS ${m}`).join(', ')}
    FROM spend_versions v
    LEFT JOIN spend_amounts a ON a.tenant_id = v.tenant_id AND a.version_id = v.id
   WHERE v.tenant_id = $1 AND v.id IN (SELECT id FROM z1_versions)
   GROUP BY v.id, v.tenant_id`;

/** The moved versions whose stored totals differ from their months: computed again (a stale CAPEX total). */
async function repairTotals(queryRunner: QueryRunner, tenantId: string): Promise<number> {
  return scalar(
    queryRunner,
    `WITH r AS (${RECOMPUTED_TOTALS}),
     stale AS (
       SELECT r.* FROM r LEFT JOIN spend_version_totals t ON t.version_id = r.version_id
        WHERE ${MEASURES.map((m) => `coalesce(t.${m}, 0) <> r.${m}`).join(' OR ')}
     ),
     fixed AS (
       INSERT INTO spend_version_totals (version_id, tenant_id, ${MEASURES.join(', ')}, updated_at)
       SELECT version_id, tenant_id, ${MEASURES.join(', ')}, now() FROM stale
       ON CONFLICT (version_id) DO UPDATE SET ${MEASURES.map((m) => `${m} = EXCLUDED.${m}`).join(', ')}, updated_at = EXCLUDED.updated_at
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM fixed`,
    [tenantId],
  );
}

/** Step 3, checks: an exception rolls the whole migration back. */
async function verifyTenant(queryRunner: QueryRunner, tenant: TenantRow, base: number, lines: number): Promise<void> {
  const t = tenant.id;
  const fail = (what: string) => {
    throw new Error(`${LOG_PREFIX} tenant ${tenantName(tenant)}: ${what}; nothing was changed.`);
  };
  // Every line copied, same UUID, same values (row_version included), the next BL numbers in (created_at, id) order.
  const lineDiff = await ids(
    queryRunner,
    `SELECT c.id FROM capex_items c
      WHERE c.tenant_id = $1 AND c.id IN ${RUN_LINES}
        AND NOT EXISTS (
          SELECT 1 FROM spend_items d
           WHERE d.id = c.id AND (${LINE_COLUMNS.map(([column]) => `d.${column}`).join(', ')}) IS NOT DISTINCT FROM (${LINE_COLUMNS.map(([, expr]) => expr).join(', ')})
        )
      ORDER BY c.id`,
    [t],
  );
  if (lineDiff.length > 0) fail(`line(s) ${lineDiff.join(', ')} differ from their CAPEX row once copied`);
  const missingSource = await scalar(queryRunner, `SELECT count(*)::int AS n FROM z1_lines z WHERE NOT EXISTS (SELECT 1 FROM capex_items c WHERE c.id = z.id AND c.tenant_id = $1)`, [t]);
  if (missingSource > 0) fail(`${missingSource} line(s) copied have no CAPEX row of the tenant`);
  const [numbers] = await queryRunner.query(
    `SELECT count(*)::int AS n, min(s.item_number)::int AS lo, max(s.item_number)::int AS hi,
            bool_and(s.item_number = $2::int + o.rn) AS ordered
       FROM spend_items s
       JOIN (SELECT c.id, row_number() OVER (ORDER BY c.created_at, c.id) AS rn FROM capex_items c WHERE c.id IN ${RUN_LINES}) o ON o.id = s.id
      WHERE s.tenant_id = $1`,
    [t, base],
  );
  if (Number(numbers.n) !== lines || Number(numbers.lo) !== base + 1 || Number(numbers.hi) !== base + lines || numbers.ordered !== true) {
    fail(`the BL numbers of the lines copied are not BL-${base + 1} to BL-${base + lines} in (created_at, id) order`);
  }
  // Every child copied, same identity, same values (budget_rev included); the version totals apart (computed again when stale).
  for (const child of CHILDREN) {
    if (child.key === 'totals') continue;
    const diff = await ids(
      queryRunner,
      `SELECT ${child.identity.length === 1 ? `c.${child.identity[0]}::text` : `concat_ws('/', ${child.identity.map((key) => `c.${key}::text`).join(', ')})`} AS id
         FROM ${child.source} c
        WHERE ${child.candidate(RUN_LINES)} AND ${child.eligible}
          AND NOT EXISTS (
            SELECT 1 FROM ${child.target} d
             WHERE ${child.identity.map((key) => `d.${key} = c.${key}`).join(' AND ')}
               AND (${child.columns.map(([column]) => `d.${column}`).join(', ')}) IS NOT DISTINCT FROM (${child.columns.map(([, expr]) => expr).join(', ')})
          )
        ORDER BY 1`,
      [t],
    );
    if (diff.length > 0) fail(`${child.source} row(s) ${diff.join(', ')} are not in ${child.target} as they were`);
  }
  // Each measure of the months sums the same, to the cent.
  const [sums] = await queryRunner.query(
    `SELECT ${MEASURES.map((m) => `(SELECT coalesce(sum(a.${m}), 0) FROM spend_amounts a WHERE a.tenant_id = $1 AND a.version_id IN (SELECT id FROM z1_versions))
              = (SELECT coalesce(sum(c.${m}), 0) FROM capex_amounts c WHERE ${OF_VERSION_COPIED}) AS ${m}`).join(', ')}`,
    [t],
  );
  const unequal = MEASURES.filter((m) => sums[m] !== true);
  if (unequal.length > 0) fail(`the months of the copied versions do not sum the same (${unequal.join(', ')})`);
  // Each total equals its months.
  const totals = await ids(
    queryRunner,
    `SELECT r.version_id AS id FROM (${RECOMPUTED_TOTALS}) r LEFT JOIN spend_version_totals t ON t.version_id = r.version_id
      WHERE ${MEASURES.map((m) => `coalesce(t.${m}, 0) <> r.${m}`).join(' OR ')}
      ORDER BY 1`,
    [t],
  );
  if (totals.length > 0) fail(`the totals of version(s) ${totals.join(', ')} differ from their months`);
}

/** Step 4: `spend` after the last BL number, `capex` after every CPX number. */
async function advanceSequences(queryRunner: QueryRunner, tenantId: string): Promise<void> {
  await queryRunner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     SELECT $1::uuid, 'spend', max(s.item_number) + 1 FROM spend_items s WHERE s.tenant_id = $1 HAVING count(*) > 0
     ON CONFLICT (tenant_id, entity_type) DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val)`,
    [tenantId],
  );
  await queryRunner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     SELECT $1::uuid, 'capex', max(n) + 1 FROM (
       SELECT ${CPX_NUMBER('s')} AS n FROM spend_items s WHERE s.tenant_id = $1 AND s.nature = 'capex'
       UNION ALL SELECT c.item_number FROM capex_items c WHERE c.tenant_id = $1
     ) x WHERE n IS NOT NULL HAVING count(*) > 0
     ON CONFLICT (tenant_id, entity_type) DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val)`,
    [tenantId],
  );
}

/** Step 5: every tenant's line entries, of both natures, from the single family. */
async function reindexLines(queryRunner: QueryRunner, tenants: TenantRow[]): Promise<number> {
  const started = Date.now();
  for (const tenant of tenants) {
    await setTenant(queryRunner, tenant.id);
    await queryRunner.query(`SELECT search_index_refresh_spend_items($1::uuid)`, [tenant.id]);
    await queryRunner.query(`SELECT search_index_refresh_capex_items($1::uuid)`, [tenant.id]);
  }
  return Date.now() - started;
}

async function assertTotalsTriggersFire(queryRunner: QueryRunner): Promise<void> {
  const rows: Array<{ name: string; enabled: string | null }> = await queryRunner.query(
    `SELECT n.name, t.tgenabled::text AS enabled
       FROM unnest($1::text[]) AS n(name)
       LEFT JOIN pg_trigger t ON t.tgrelid = 'spend_amounts'::regclass AND t.tgname = n.name AND NOT t.tgisinternal`,
    [TOTALS_TRIGGERS],
  );
  const wrong = rows.filter((row) => row.enabled !== 'O' && row.enabled !== 'A');
  if (wrong.length > 0) {
    throw new Error(`${LOG_PREFIX} the totals trigger(s) ${wrong.map((row) => `${row.name} (${row.enabled ?? 'missing'})`).join(', ')} do not fire; nothing was changed.`);
  }
}

/** Step 6. */
async function finalCheck(queryRunner: QueryRunner, tenants: TenantRow[]): Promise<void> {
  const lost = await ids(
    queryRunner,
    `SELECT c.id FROM capex_items c JOIN tenants t ON t.id = c.tenant_id
      WHERE c.tenant_id NOT IN (SELECT m.tenant_id FROM z1_moved_tenants m)
        AND NOT EXISTS (SELECT 1 FROM spend_items s WHERE s.id = c.id AND s.tenant_id = c.tenant_id AND s.nature = 'capex')
      ORDER BY c.id`,
  );
  if (lost.length > 0) throw new Error(`${LOG_PREFIX} CAPEX line(s) ${lost.join(', ')} are not in spend_items; nothing was changed.`);
  const rows: Array<Record<string, string | number>> = await queryRunner.query(
    `SELECT i.nature, count(DISTINCT i.id)::int AS lines, count(DISTINCT v.id)::int AS versions, count(a.id)::int AS months,
            ${MEASURES.map((m) => `coalesce(sum(a.${m}), 0)::text AS ${m}`).join(', ')}
       FROM spend_items i
       JOIN tenants tn ON tn.id = i.tenant_id
       LEFT JOIN spend_versions v ON v.tenant_id = i.tenant_id AND v.spend_item_id = i.id
       LEFT JOIN spend_amounts a ON a.tenant_id = v.tenant_id AND a.version_id = v.id
      GROUP BY i.nature ORDER BY i.nature`,
  );
  for (const row of rows) {
    console.log(
      `${LOG_PREFIX} all tenants (${tenants.length}): ${row.nature}: ${row.lines} line(s), ${row.versions} version(s), ${row.months} month(s); `
        + MEASURES.map((m) => `${m} ${row[m]}`).join(', '),
    );
  }
}

/* ---------------------------------------------------------------- down ---- */

/** The CAPEX table, its columns and the expression of each from the single family (`s`: the row of `spend_*`). */
type BackCopy = { source: string; target: string; identity: string[]; columns: Array<[string, string]>; lines: (tenant: string) => string };

const capexLinesOf = () => `(SELECT l.id FROM spend_items l WHERE l.tenant_id = $1 AND l.nature = 'capex')`;
const versionsBack = `(SELECT v.id FROM spend_versions v WHERE v.tenant_id = $1 AND v.spend_item_id IN ${capexLinesOf()})`;
const roundsBack = `(SELECT r.id FROM spend_round_inputs r WHERE r.tenant_id = $1 AND r.version_id IN ${versionsBack})`;
const sameS = (columns: string[]): Array<[string, string]> => columns.map((column) => [column, `s.${column}`]);

/** The CPX number of a CAPEX line moved back: its legacy number, else one given by `capex_seq` (z1_cpx). */
const BACK_NUMBER = `COALESCE(${CPX_NUMBER('s')}, (SELECT z.n FROM z1_cpx z WHERE z.id = s.id))`;
/** The OPEX description of a CAPEX line (none unless written after the move) joins its notes. */
const BACK_NOTES = `CASE WHEN NULLIF(s.description, '') IS NULL THEN s.notes
  WHEN NULLIF(s.notes, '') IS NULL THEN s.description
  ELSE s.description || E'\\n\\n' || s.notes END`;

const BACK_LINE_COLUMNS: Array<[string, string]> = [
  ['id', 's.id'], ['tenant_id', 's.tenant_id'], ['item_number', BACK_NUMBER], ['description', 's.product_name'],
  ...sameS(['ppe_type', 'investment_type', 'priority', 'currency', 'effective_start', 'legacy_effective_end', 'status']),
  ['notes', BACK_NOTES],
  ...sameS(['created_at', 'updated_at', 'paying_company_id', 'disabled_at', 'account_id', 'project_id', 'supplier_id', 'owner_it_id',
    'owner_business_id', 'analytics_category_id', 'cost_center_id', 'run_build', 'row_version']),
];

const BACK_CHILDREN: BackCopy[] = [
  {
    source: 'spend_versions', target: 'capex_versions', identity: ['id'],
    columns: [['id', 's.id'], ['tenant_id', 's.tenant_id'], ['capex_item_id', 's.spend_item_id'],
      ...sameS(['version_name', 'input_grain', 'is_approved', 'as_of_date', 'budget_year', 'notes', 'fx_rate_set_id', 'reporting_currency',
        'allocation_method', 'allocation_driver', 'budget_rev', 'budget_changed_at', 'created_at', 'updated_at'])],
    lines: () => `s.tenant_id = $1 AND s.spend_item_id IN ${capexLinesOf()}`,
  },
  {
    source: 'spend_amounts', target: 'capex_amounts', identity: ['id'],
    columns: sameS(['id', 'tenant_id', 'version_id', 'period', ...MEASURES, 'created_at', 'updated_at']),
    lines: () => `s.tenant_id = $1 AND s.version_id IN ${versionsBack}`,
  },
  {
    source: 'spend_version_totals', target: 'capex_version_totals', identity: ['version_id'],
    columns: sameS(['version_id', 'tenant_id', ...MEASURES, 'updated_at']),
    lines: () => `s.tenant_id = $1 AND s.version_id IN ${versionsBack}`,
  },
  {
    source: 'spend_round_inputs', target: 'capex_round_inputs', identity: ['id'],
    columns: sameS(['id', 'tenant_id', 'version_id', 'measure', 'period_start', 'period_end', 'method', 'spread_profile_name', 'last_calculation',
      'updated_by', 'fte', 'created_at', 'updated_at']),
    lines: () => `s.tenant_id = $1 AND s.version_id IN ${versionsBack}`,
  },
  {
    source: 'spend_round_input_lines', target: 'capex_round_input_lines', identity: ['id'],
    columns: sameS(['id', 'tenant_id', 'round_input_id', 'sort', 'label', 'quantity_unit', 'quantity', 'unit_price', 'price_basis', 'frequency',
      'days_per_month', 'working_day_profile_id', 'period_start', 'period_end', 'created_at', 'updated_at']),
    lines: () => `s.tenant_id = $1 AND s.round_input_id IN ${roundsBack}`,
  },
  {
    source: 'spend_allocations', target: 'capex_allocations', identity: ['id'],
    columns: [...sameS(['id', 'tenant_id', 'version_id', 'company_id', 'department_id', 'allocation_pct']),
      ['is_system_generated', 'COALESCE(s.is_system_generated, false)'], ...sameS(['rule_id', 'materialized_from', 'created_at', 'updated_at'])],
    lines: () => `s.tenant_id = $1 AND s.version_id IN ${versionsBack}`,
  },
  {
    source: 'spend_item_analytics_values', target: 'capex_item_analytics_values', identity: ['tenant_id', 'item_id', 'axis_id'],
    columns: sameS(['tenant_id', 'item_id', 'axis_id', 'category_id', 'created_at', 'updated_at']),
    lines: () => `s.tenant_id = $1 AND s.item_id IN ${capexLinesOf()}`,
  },
  {
    source: 'spend_item_contacts', target: 'capex_item_contacts', identity: ['id'],
    columns: [['id', 's.id'], ['tenant_id', 's.tenant_id'], ['capex_item_id', 's.spend_item_id'], ...sameS(['contact_id', 'role', 'origin', 'created_at', 'updated_at'])],
    lines: () => `s.tenant_id = $1 AND s.spend_item_id IN ${capexLinesOf()}`,
  },
  {
    source: 'spend_links', target: 'capex_links', identity: ['id'],
    columns: [['id', 's.id'], ['tenant_id', 's.tenant_id'], ['capex_item_id', 's.spend_item_id'], ...sameS(['description', 'url', 'created_at'])],
    lines: () => `s.tenant_id = $1 AND s.spend_item_id IN ${capexLinesOf()}`,
  },
  {
    source: 'spend_attachments', target: 'capex_attachments', identity: ['id'],
    columns: [['id', 's.id'], ['tenant_id', 's.tenant_id'], ['capex_item_id', 's.spend_item_id'],
      ...sameS(['original_filename', 'stored_filename', 'mime_type', 'size', 'storage_path', 'uploaded_at'])],
    lines: () => `s.tenant_id = $1 AND s.spend_item_id IN ${capexLinesOf()}`,
  },
  {
    source: 'application_spend_items', target: 'application_capex_items', identity: ['id'],
    columns: [['id', 's.id'], ['tenant_id', 's.tenant_id'], ['application_id', 's.application_id'], ['capex_item_id', 's.spend_item_id'], ['created_at', 's.created_at']],
    lines: () => `s.tenant_id = $1 AND s.spend_item_id IN ${capexLinesOf()}`,
  },
  {
    source: 'asset_spend_items', target: 'asset_capex_items', identity: ['id'],
    columns: [['id', 's.id'], ['tenant_id', 's.tenant_id'], ['asset_id', 's.asset_id'], ['capex_item_id', 's.spend_item_id'], ['created_at', 's.created_at']],
    lines: () => `s.tenant_id = $1 AND s.spend_item_id IN ${capexLinesOf()}`,
  },
  {
    source: 'contract_spend_items', target: 'contract_capex_items', identity: ['id'],
    columns: [['id', 's.id'], ['tenant_id', 's.tenant_id'], ['contract_id', 's.contract_id'], ['capex_item_id', 's.spend_item_id'], ['created_at', 's.created_at']],
    lines: () => `s.tenant_id = $1 AND s.spend_item_id IN ${capexLinesOf()}`,
  },
  {
    source: 'portfolio_project_opex', target: 'portfolio_project_capex', identity: ['id'],
    columns: [['id', 's.id'], ['tenant_id', 's.tenant_id'], ['project_id', 's.project_id'], ['capex_id', 's.opex_id'], ['created_at', 's.created_at']],
    lines: () => `s.tenant_id = $1 AND s.opex_id IN ${capexLinesOf()}`,
  },
  {
    source: 'portfolio_request_opex', target: 'portfolio_request_capex', identity: ['id'],
    columns: [['id', 's.id'], ['tenant_id', 's.tenant_id'], ['request_id', 's.request_id'], ['capex_id', 's.opex_id'], ['created_at', 's.created_at']],
    lines: () => `s.tenant_id = $1 AND s.opex_id IN ${capexLinesOf()}`,
  },
];

/** The CAPEX children of a dormant line deleted before the copy back: everything of the line goes back. */
const CAPEX_CHILD_DELETES: Array<{ table: string; column: string }> = [
  { table: 'capex_versions', column: 'capex_item_id' },
  { table: 'capex_item_analytics_values', column: 'item_id' },
  { table: 'capex_item_contacts', column: 'capex_item_id' },
  { table: 'capex_links', column: 'capex_item_id' },
  { table: 'capex_attachments', column: 'capex_item_id' },
  { table: 'application_capex_items', column: 'capex_item_id' },
  { table: 'asset_capex_items', column: 'capex_item_id' },
  { table: 'contract_capex_items', column: 'capex_item_id' },
  { table: 'portfolio_project_capex', column: 'capex_id' },
  { table: 'portfolio_request_capex', column: 'capex_id' },
];

/** The children of `spend_*` without a foreign key to their line, deleted with it by hand. */
const SPEND_UNKEYED: Array<{ table: string; column: string }> = [
  { table: 'spend_links', column: 'spend_item_id' },
  { table: 'spend_attachments', column: 'spend_item_id' },
  { table: 'contract_spend_items', column: 'spend_item_id' },
];

/** down(), before any write: a CAPEX line the capex_* tables cannot hold refuses the whole revert. */
async function assertRestorable(queryRunner: QueryRunner): Promise<void> {
  const enums = await ids(
    queryRunner,
    `SELECT s.id FROM spend_items s WHERE s.nature = 'capex' AND (s.ppe_type IS NULL OR s.investment_type IS NULL OR s.priority IS NULL) ORDER BY s.id`,
  );
  if (enums.length > 0) {
    throw new Error(`${LOG_PREFIX} down: CAPEX line(s) ${enums.join(', ')} have no PP&E type, investment type or priority, which capex_items requires; nothing was changed. Set them first.`);
  }
  const orphans = await ids(queryRunner, `SELECT s.id FROM spend_items s WHERE s.nature = 'capex' AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = s.tenant_id) ORDER BY s.id`);
  if (orphans.length > 0) {
    throw new Error(`${LOG_PREFIX} down: CAPEX line(s) ${orphans.join(', ')} belong to a tenant that no longer exists; nothing was changed.`);
  }
  const contracts = await ids(queryRunner, `SELECT s.id FROM spend_items s WHERE s.nature = 'capex' AND s.contract_id IS NOT NULL ORDER BY s.id`);
  if (contracts.length > 0) {
    throw new Error(`${LOG_PREFIX} down: CAPEX line(s) ${contracts.join(', ')} have a contract_id, which capex_items cannot hold; nothing was changed. Clear it first (the contract links stay).`);
  }
}

/** down(), one tenant: its CAPEX lines back into capex_*, checked, then out of spend_*. */
async function restoreTenant(queryRunner: QueryRunner, tenant: TenantRow): Promise<void> {
  const t = tenant.id;
  const lines = await scalar(queryRunner, `SELECT count(*)::int AS n FROM spend_items WHERE tenant_id = $1 AND nature = 'capex'`, [t]);
  // The dormant lines whose line is gone (deleted since the move) go, with their children.
  const gone = await countOf(
    queryRunner,
    `DELETE FROM capex_items c WHERE c.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM spend_items s WHERE s.id = c.id AND s.nature = 'capex')`,
    [t],
  );
  if (lines === 0) {
    if (gone > 0) console.log(`${LOG_PREFIX} down: tenant ${tenantName(tenant)}: ${gone} dormant CAPEX line(s) deleted since the move removed`);
    return;
  }
  // CPX numbers for the CAPEX lines without one, after every CPX number of the tenant.
  await queryRunner.query(`CREATE TEMP TABLE IF NOT EXISTS z1_cpx (id uuid PRIMARY KEY, n int NOT NULL) ON COMMIT DROP`);
  await queryRunner.query(`TRUNCATE z1_cpx`);
  const numbered = await countOf(
    queryRunner,
    `INSERT INTO z1_cpx (id, n)
     SELECT s.id, b.base + row_number() OVER (ORDER BY s.created_at, s.id)
       FROM spend_items s,
            (SELECT GREATEST(
               (SELECT coalesce(max(${CPX_NUMBER('x')}), 0) FROM spend_items x WHERE x.tenant_id = $1 AND x.nature = 'capex'),
               (SELECT coalesce(max(q.next_val) - 1, 0) FROM item_sequences q WHERE q.tenant_id = $1 AND q.entity_type = 'capex'),
               (SELECT coalesce(max(c.item_number), 0) FROM capex_items c WHERE c.tenant_id = $1)
             ) AS base) b
      WHERE s.tenant_id = $1 AND s.nature = 'capex' AND ${CPX_NUMBER('s')} IS NULL`,
    [t],
  );
  // The children of the dormant lines go: each comes back from spend_* (a row deleted since stays deleted).
  for (const child of CAPEX_CHILD_DELETES) {
    await queryRunner.query(`DELETE FROM ${child.table} WHERE ${child.column} IN (SELECT c.id FROM capex_items c WHERE c.tenant_id = $1)`, [t]);
  }
  const columns = BACK_LINE_COLUMNS.map(([column]) => column);
  await queryRunner.query(
    `INSERT INTO capex_items (${columns.join(', ')})
     SELECT ${BACK_LINE_COLUMNS.map(([, expr]) => expr).join(', ')} FROM spend_items s WHERE s.tenant_id = $1 AND s.nature = 'capex'
     ON CONFLICT (id) DO UPDATE SET ${columns.filter((column) => column !== 'id').map((column) => `${column} = EXCLUDED.${column}`).join(', ')}`,
    [t],
  );
  if (lines >= LARGE_COPY) await analyze(queryRunner, ['capex_items']);
  const counts: string[] = [];
  for (const child of BACK_CHILDREN) {
    const childColumns = child.columns.map(([column]) => column);
    const n = await countOf(
      queryRunner,
      `INSERT INTO ${child.target} (${childColumns.join(', ')})
       SELECT ${child.columns.map(([, expr]) => expr).join(', ')} FROM ${child.source} s WHERE ${child.lines(t)}`,
      [t],
    );
    counts.push(`${n} ${child.target}`);
    if (n >= LARGE_COPY) await analyze(queryRunner, [child.target]);
  }
  // Checks: every line and child back, same identity and values.
  const lineDiff = await ids(
    queryRunner,
    `SELECT s.id FROM spend_items s WHERE s.tenant_id = $1 AND s.nature = 'capex'
        AND NOT EXISTS (SELECT 1 FROM capex_items d WHERE d.id = s.id
          AND (${columns.map((column) => `d.${column}`).join(', ')}) IS NOT DISTINCT FROM (${BACK_LINE_COLUMNS.map(([, expr]) => expr).join(', ')}))
      ORDER BY s.id`,
    [t],
  );
  if (lineDiff.length > 0) throw new Error(`${LOG_PREFIX} down: tenant ${tenantName(tenant)}: line(s) ${lineDiff.join(', ')} not back as they were; nothing was changed.`);
  for (const child of BACK_CHILDREN) {
    const diff = await ids(
      queryRunner,
      `SELECT ${child.identity.length === 1 ? `s.${child.identity[0]}::text` : `concat_ws('/', ${child.identity.map((key) => `s.${key}::text`).join(', ')})`} AS id
         FROM ${child.source} s WHERE ${child.lines(t)}
          AND NOT EXISTS (SELECT 1 FROM ${child.target} d WHERE ${child.identity.map((key) => `d.${key} = s.${key}`).join(' AND ')}
            AND (${child.columns.map(([column]) => `d.${column}`).join(', ')}) IS NOT DISTINCT FROM (${child.columns.map(([, expr]) => expr).join(', ')}))
        ORDER BY 1`,
      [t],
    );
    if (diff.length > 0) throw new Error(`${LOG_PREFIX} down: tenant ${tenantName(tenant)}: ${child.source} row(s) ${diff.join(', ')} not back in ${child.target}; nothing was changed.`);
  }
  // The CAPEX lines leave spend_*: the children without a key first, the rest by cascade.
  for (const child of SPEND_UNKEYED) {
    await queryRunner.query(`DELETE FROM ${child.table} WHERE tenant_id = $1 AND ${child.column} IN ${capexLinesOf()}`, [t]);
  }
  const removed = await countOf(queryRunner, `DELETE FROM spend_items WHERE tenant_id = $1 AND nature = 'capex'`, [t]);
  await queryRunner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     SELECT $1::uuid, 'capex', max(c.item_number) + 1 FROM capex_items c WHERE c.tenant_id = $1 HAVING count(*) > 0
     ON CONFLICT (tenant_id, entity_type) DO UPDATE SET next_val = GREATEST(item_sequences.next_val, EXCLUDED.next_val)`,
    [t],
  );
  console.log(
    `${LOG_PREFIX} down: tenant ${tenantName(tenant)}: ${removed} CAPEX line(s) back in capex_items (${numbered} given a new CPX number), `
      + `${counts.join(', ')}; ${gone} dormant line(s) deleted since the move removed`,
  );
}

/* ------------------------------------------------------------- helpers ---- */

/** Fresh statistics for tables just filled in this transaction (see LARGE_COPY). */
async function analyze(queryRunner: QueryRunner, tables: string[]): Promise<void> {
  for (const table of tables) await queryRunner.query(`ANALYZE ${table}`);
}

/**
 * Runs `fn` with row level security off on the tables, then restores what was found, also when
 * `fn` fails (1853910000000). After a failed statement the transaction is aborted and refuses the
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
 * (1853880000000's `withoutTrigger`, for every trigger of several tables); restored like
 * `withoutRowSecurity`.
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
