import { MigrationInterface, QueryRunner } from 'typeorm';
import { Decimal } from '../common/decimal';
import { CostingInputError } from '../spend/costing.util';
import { computeLinesResult, costLine, LinesResult, readLines } from '../spend/round-inputs.util';
import { loadWorkingDayProfiles } from '../working-day-profiles/working-day-profiles.util';

const LOG_PREFIX = '[Migration] RoundInputsLinesResult:';

/** At most this many skipped rounds per table are named in the boot log. */
const LOG_ROWS = 50;

/** Rounds read, computed and written per chunk, within a tenant. */
const BATCH = 500;

const TARGETS = [
  { scope: 'opex', rounds: 'spend_round_inputs', lines: 'spend_round_input_lines' },
  { scope: 'capex', rounds: 'capex_round_inputs', lines: 'capex_round_input_lines' },
] as const;

type Target = (typeof TARGETS)[number];

/**
 * The rounds to fill: an FTE from their lines, amounts that do not follow
 * them, a spread, quarterly or copy calculation without the result of the
 * lines. Also checked again by the update, so a round is written once.
 */
const TO_FILL = `r.fte IS NOT NULL AND r.method <> 'computed'
  AND r.last_calculation->>'kind' IN ('annual', 'quarterly', 'copy')
  AND NOT (r.last_calculation ? 'lines_result')`;

type Round = { id: string; tenant_id: string; period_start: string; fte: string };
type Skipped = { round: Round; reason: string; detail: string };
/** What one table's run did: counts, and the first LOG_ROWS skipped rounds to name. */
type Report = { updated: number; fteDiffers: number; skipped: number; byReason: Map<string, number>; named: Skipped[] };

/**
 * The result of their lines on the rounds that keep an FTE while their
 * amounts no longer follow the lines (FTE reports, lot 2a). A spread or a
 * copy of reference lines now keeps what the lines give as `lines_result` in
 * the round's calculation (`spend/round-inputs.util.ts`, `LinesResult`); the
 * rounds written before lost it with their `computed` calculation.
 *
 * For each OPEX and CAPEX round with `fte` set, `method` other than
 * `computed`, an `annual`, `quarterly` or `copy` calculation and no
 * `lines_result`: its stored lines are computed for the round's year with the
 * calendars as they are now (the application's costing code and calendar
 * days: `computeLinesResult`, `loadWorkingDayProfiles`) and the result is
 * added to the calculation. Nothing else changes: not `fte` (a copy of
 * reference lines kept the source's; the log counts the rounds whose lines
 * now give another FTE), not `updated_at`, not the lines.
 *
 * - Tenant by tenant, in chunks of BATCH rounds (in id order): a chunk's
 *   rounds, their lines and the calendars they name are read in three
 *   statements, computed, then written in one statement before the next
 *   chunk is read.
 * - A round whose lines cannot be computed (no stored lines, a calendar
 *   without working days for the year, an amount over the limits) is
 *   skipped and logged with the reason, never a failure.
 * - Migrations run without app.current_tenant and FORCE binds the owner, so
 *   row level security is disabled on the rounds, their lines and the
 *   calendars while they are read and written, then restored as found
 *   (ENABLE + FORCE today).
 * - The round table's update trigger (`<table>_budget_rev_update`,
 *   1853850000000) is disabled meanwhile and restored as found. The result
 *   of the lines is derived data: the versions must keep their `budget_rev`
 *   and `budget_changed_at` (a bump would show every line concerned as
 *   changed since its budget file export, by nobody, at deploy time). Run
 *   as a migration, without a tenant context, the trigger would bump nothing
 *   anyway: it is not SECURITY DEFINER, and FORCE row level security on the
 *   versions hides every version from its update. Disabling it guards the
 *   other cases: a run with a tenant context set, or a later change of the
 *   versions' row level security.
 *
 * Idempotent: a second run finds only the rounds it skipped, and skips them
 * again. down() is a no-op (see there).
 */
export class RoundInputsLinesResult1853880000000 implements MigrationInterface {
  name = 'RoundInputsLinesResult1853880000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const target of TARGETS) {
      const report = await withoutRowSecurity(queryRunner, [target.rounds, target.lines, 'working_day_profiles'], () =>
        withoutTrigger(queryRunner, target.rounds, `${target.rounds}_budget_rev_update`, () => fill(queryRunner, target)));
      logReport(target, report);
    }
  }

  public async down(): Promise<void> {
    // Nothing to undo: `lines_result` is optional, the code before this
    // migration ignores it, and removing it would only lose the result of
    // the lines again. The rounds keep their amounts, method, FTE and lines.
    console.log(`${LOG_PREFIX} down() leaves the lines' result on the rounds (optional data, ignored by older code)`);
  }
}

/**
 * Computes and writes the result of the lines of every round to fill of one
 * table, tenant by tenant, in chunks of BATCH rounds. A chunk starts after
 * the last round id of the one before: a skipped round still matches TO_FILL.
 */
async function fill(queryRunner: QueryRunner, target: Target): Promise<Report> {
  const report: Report = { updated: 0, fteDiffers: 0, skipped: 0, byReason: new Map(), named: [] };
  const skip = (round: Round, reason: string, detail: string) => {
    report.skipped++;
    report.byReason.set(reason, (report.byReason.get(reason) ?? 0) + 1);
    if (report.named.length < LOG_ROWS) report.named.push({ round, reason, detail });
  };
  const tenants: Array<{ tenant_id: string }> = await queryRunner.query(
    `SELECT DISTINCT r.tenant_id FROM ${target.rounds} r WHERE ${TO_FILL} ORDER BY r.tenant_id`,
  );
  for (const { tenant_id: tenantId } of tenants) {
    let after: string | null = null;
    for (;;) {
      const rounds: Round[] = await queryRunner.query(
        `SELECT r.id, r.tenant_id, to_char(r.period_start, 'YYYY-MM-DD') AS period_start, r.fte::text AS fte
         FROM ${target.rounds} r
         WHERE r.tenant_id = $1 AND ${TO_FILL} AND ($2::uuid IS NULL OR r.id > $2::uuid)
         ORDER BY r.id
         LIMIT ${BATCH}`,
        [tenantId, after],
      );
      if (rounds.length === 0) break;
      after = rounds[rounds.length - 1].id;

      const lines = await readLines(queryRunner.manager, target.scope, tenantId, rounds.map((round) => round.id));
      const calendarIds = [...lines.values()].flat().flatMap((line) => (line.working_day_profile_id ? [line.working_day_profile_id] : []));
      const calendars = await loadWorkingDayProfiles(queryRunner, tenantId, calendarIds);

      const results: Record<string, LinesResult> = {};
      for (const round of rounds) {
        const own = lines.get(round.id) ?? [];
        if (own.length === 0) {
          skip(round, 'no stored lines', 'the round has an FTE but no line');
          continue;
        }
        try {
          // The round's period lies in its version's year (`saveRoundInput` checks it), as do its lines.
          const result = computeLinesResult(own.map(costLine), Number(round.period_start.slice(0, 4)), calendars);
          results[round.id] = result;
          if (Decimal.from(result.fte).cmp(round.fte) !== 0) report.fteDiffers++;
        } catch (err) {
          skip(round, skipReason(err), err instanceof Error ? err.message : String(err));
        }
      }
      if (Object.keys(results).length === 0) continue;

      const [{ n }]: Array<{ n: number }> = await queryRunner.query(
        `WITH written AS (
           UPDATE ${target.rounds} r
              SET last_calculation = r.last_calculation || jsonb_build_object('lines_result', u.value)
             FROM jsonb_each($2::jsonb) AS u(key, value)
            WHERE r.tenant_id = $1 AND r.id = u.key::uuid AND ${TO_FILL}
           RETURNING r.id
         )
         SELECT count(*)::int AS n FROM written`,
        [tenantId, JSON.stringify(results)],
      );
      report.updated += Number(n);
    }
  }
  return report;
}

/** Why the lines of a round cannot be computed, as a category for the counts. */
function skipReason(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (/has no working days for \d{4}/.test(message)) return 'a calendar has no working days for the year';
  if (/choose a calendar for a price per day/.test(message)) return 'a calendar was not found';
  return err instanceof CostingInputError ? 'the lines cannot be computed' : 'the computation failed';
}

function logReport(target: Target, report: Report) {
  const { skipped } = report;
  if (report.updated === 0 && skipped === 0) {
    console.log(`${LOG_PREFIX} ${target.rounds}: no round to fill`);
    return;
  }
  const reasons = [...report.byReason].map(([reason, count]) => `${count} ${reason}`).join(', ');
  console.log(
    `${LOG_PREFIX} ${target.rounds}: ${report.updated} round(s) given the result of their lines`
      + ` (${report.fteDiffers} whose lines now give another FTE than the stored one, kept)`
      + `, ${skipped} skipped${skipped > 0 ? ` (${reasons})` : ''}`,
  );
  for (const s of report.named) {
    console.log(`  skipped round ${s.round.id} (tenant ${s.round.tenant_id}): ${s.reason}: ${s.detail}`);
  }
  if (skipped > LOG_ROWS) console.log(`  ... and ${skipped - LOG_ROWS} more`);
}

/**
 * Runs `fn` with row level security off on the tables, then restores what
 * was found, also when `fn` or the disabling of a later table fails (as in
 * 1853730000000). After a failed statement the transaction is aborted and
 * refuses the restore: its rollback restores the state then, and the first
 * error is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, tables: readonly string[], fn: () => Promise<T>): Promise<T> {
  // Each table's state, kept as soon as it is read: a failure on a later table still restores the earlier ones.
  const states: Array<{ table: string; enabled: boolean; forced: boolean }> = [];
  let failed = false;
  try {
    for (const table of tables) {
      const [state] = await queryRunner.query(
        `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
        [table],
      );
      states.push({ table, enabled: !!state?.enabled, forced: !!state?.forced });
      if (state?.enabled) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
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

/** Runs `fn` with the named trigger disabled, when it exists and is enabled, then enables it as found; restored like `withoutRowSecurity`. */
async function withoutTrigger<T>(queryRunner: QueryRunner, table: string, trigger: string, fn: () => Promise<T>): Promise<T> {
  const [state] = await queryRunner.query(
    `SELECT tgenabled::text AS enabled FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2 AND NOT tgisinternal`,
    [table, trigger],
  );
  const enable = state ? ENABLE_TRIGGER[String(state.enabled)] : undefined;
  if (enable) await queryRunner.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      if (enable) await queryRunner.query(`ALTER TABLE ${table} ${enable} ${trigger}`);
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
