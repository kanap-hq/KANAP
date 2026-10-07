import { BadRequestException } from '@nestjs/common';
import { And, EntityManager, Equal, FindOperator, Raw } from 'typeorm';
import { AuditSourceOptions } from '../audit/audit.service';

/**
 * The consolidation chart (plan planning/coa-consolidation-chart.md): at most one chart per
 * tenant (`chart_of_accounts.is_consolidation`) holds the group accounts every local account
 * maps to through `accounts.consolidation_account_number`. The number is the key: the
 * consolidation name and description of an account are derived from the consolidation
 * chart's account of that number. An account whose number is absent from the consolidation
 * chart is "outside"; one without a number is "unmapped". Without a consolidation chart, an
 * account with a number has no status (null): there is nothing to be in or outside of.
 *
 * Every query here carries an explicit tenant predicate on top of row level security.
 */

export const CURRENT_TENANT = `current_setting('app.current_tenant', true)::uuid`;

export const CONSOLIDATION_STATUSES = ['mapped', 'outside', 'unmapped'] as const;
export type ConsolidationStatus = (typeof CONSOLIDATION_STATUSES)[number];

/** The `consolidationStatus` query parameter of the accounts lists (absent or empty: no filter). */
export function parseConsolidationStatus(raw: unknown): ConsolidationStatus | undefined {
  if (raw == null || raw === '') return undefined;
  const value = String(raw).trim().toLowerCase();
  if ((CONSOLIDATION_STATUSES as readonly string[]).includes(value)) return value as ConsolidationStatus;
  throw new BadRequestException(`consolidationStatus must be one of: ${CONSOLIDATION_STATUSES.join(', ')}`);
}

/** The account numbers of the tenant's consolidation chart (empty when it has none). */
const CONSOLIDATION_NUMBERS_SQL = `
  SELECT ca.account_number
  FROM accounts ca
  JOIN chart_of_accounts cc ON cc.id = ca.coa_id AND cc.tenant_id = ca.tenant_id
  WHERE cc.is_consolidation
    AND cc.tenant_id = ${CURRENT_TENANT}
    AND ca.tenant_id = ${CURRENT_TENANT}`;

/** True when the tenant has a consolidation chart. */
const HAS_CONSOLIDATION_CHART_SQL = `
  EXISTS (SELECT 1 FROM chart_of_accounts cc WHERE cc.is_consolidation AND cc.tenant_id = ${CURRENT_TENANT})`;

/**
 * A find condition on `consolidation_account_number` that keeps the accounts of one status.
 * Without a consolidation chart, `mapped` and `outside` keep nothing (no account has them).
 */
export function consolidationStatusCondition(status: ConsolidationStatus): FindOperator<any> {
  switch (status) {
    case 'unmapped':
      return Raw((alias) => `${alias} IS NULL`);
    case 'mapped':
      return Raw((alias) => `${alias} IN (${CONSOLIDATION_NUMBERS_SQL})`);
    case 'outside':
      return Raw((alias) => `${alias} IS NOT NULL AND ${HAS_CONSOLIDATION_CHART_SQL} AND ${alias} NOT IN (${CONSOLIDATION_NUMBERS_SQL})`);
  }
}

/** Both conditions on one column: `extra` added to what the where clause already holds. */
export function andCondition(existing: unknown, extra: FindOperator<any>): FindOperator<any> {
  if (existing === undefined) return extra;
  const current = existing instanceof FindOperator ? existing : Equal(existing);
  return And(current, extra);
}

/**
 * Locks the tenant's charts against role changes for the rest of the transaction, in id
 * order. Every chart writer takes it first (role changes, chart updates and deletes), so
 * they queue behind each other, and behind the account writes that hold the charts
 * `FOR SHARE` (see `lockConsolidationChartId`). `FOR NO KEY UPDATE`: the key-share locks of
 * foreign key checks (an account or a company inserted into a chart) do not wait for it.
 */
export async function lockTenantCharts(mg: EntityManager) {
  await mg.query(`SELECT id FROM chart_of_accounts WHERE tenant_id = ${CURRENT_TENANT} ORDER BY id FOR NO KEY UPDATE`);
}

/**
 * The tenant's consolidation chart id, or null, for an account write: read under a
 * `FOR SHARE` lock that holds off role changes until the write commits, or waits for a
 * role change in progress and sees its outcome. Take it before any account row lock.
 *
 * Every chart of the tenant is locked, not only the holder: a read that waited behind a role
 * change rechecks its condition on the rows it had found, so a condition on the role would
 * drop the old holder and never see the new one. Without one, the locked rows come back as
 * the role change left them.
 */
export async function lockConsolidationChartId(mg: EntityManager): Promise<string | null> {
  const rows: Array<{ id: string; is_consolidation: boolean }> = await mg.query(
    `SELECT id::text AS id, is_consolidation FROM chart_of_accounts
     WHERE tenant_id = ${CURRENT_TENANT}
     ORDER BY id
     FOR SHARE`,
  );
  return rows.find((row) => row.is_consolidation)?.id ?? null;
}

/** The name and description an account of the consolidation chart gives the accounts mapped to it. */
export type ConsolidationAccount = { name: string; description: string | null };

/** The accounts of `chartId` with these numbers, by number (one query). */
export async function consolidationAccounts(
  mg: EntityManager,
  chartId: string,
  numbers: Array<number | null | undefined>,
): Promise<Map<number, ConsolidationAccount>> {
  const wanted = Array.from(new Set(numbers.filter((n): n is number => n != null).map(Number)));
  if (wanted.length === 0) return new Map();
  const rows: Array<{ account_number: number; account_name: string; description: string | null }> = await mg.query(
    `SELECT account_number, account_name, description FROM accounts
     WHERE tenant_id = ${CURRENT_TENANT} AND coa_id = $1::uuid AND account_number = ANY($2::int[])`,
    [chartId, wanted],
  );
  return new Map(rows.map((r) => [Number(r.account_number), { name: r.account_name, description: r.description ?? null }]));
}

/**
 * The tenant's consolidation chart (null when it has none) and which of these consolidation
 * numbers exist in it (one query).
 */
export type ConsolidationLookup = { chartId: string | null; numbers: Set<number> };

export async function consolidationLookup(mg: EntityManager, numbers: Array<number | null | undefined>): Promise<ConsolidationLookup> {
  const wanted = Array.from(new Set(numbers.filter((n): n is number => n != null).map(Number)));
  // No number asked: every account is unmapped, whatever the chart.
  if (wanted.length === 0) return { chartId: null, numbers: new Set() };
  const [row]: Array<{ chart_id: string; numbers: number[] }> = await mg.query(
    `SELECT cc.id::text AS chart_id,
            COALESCE(array_agg(ca.account_number) FILTER (WHERE ca.account_number IS NOT NULL), '{}') AS numbers
     FROM chart_of_accounts cc
     LEFT JOIN accounts ca
       ON ca.tenant_id = cc.tenant_id AND ca.coa_id = cc.id AND ca.account_number = ANY($1::int[])
     WHERE cc.tenant_id = ${CURRENT_TENANT} AND cc.is_consolidation
     GROUP BY cc.id`,
    [wanted],
  );
  return { chartId: row?.chart_id ?? null, numbers: new Set((row?.numbers ?? []).map(Number)) };
}

export function consolidationStatusOf(number: number | null | undefined, lookup: ConsolidationLookup): ConsolidationStatus | null {
  if (number == null) return 'unmapped';
  if (!lookup.chartId) return null;
  return lookup.numbers.has(Number(number)) ? 'mapped' : 'outside';
}

/** Who made a change, for the audit lines written in SQL. */
export type AuditActor = { userId?: string | null; audit?: AuditSourceOptions };

/** The audit columns `AuditService.log` fills from the actor: user, source (user or system by default), reference. */
function actorParams(actor: AuditActor): [string | null, string, string | null] {
  const userId = actor.userId ?? null;
  return [userId, actor.audit?.source ?? (userId ? 'user' : 'system'), actor.audit?.sourceRef ?? null];
}

/**
 * The audit line of each account rewritten by the `changed` CTE of a statement (columns `id`,
 * `before`, `after`), in the shape `AuditService.log` writes. `$user`, `$source` and `$ref` are
 * the placeholders of the actor's parameters.
 */
function auditChangedSql(user: string, source: string, ref: string) {
  return `audited AS (
       INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, source, source_ref, created_at)
       SELECT 'accounts', id, 'update', before, after, ${user}::uuid, ${source}::text, ${ref}::text, clock_timestamp()
       FROM changed
     )`;
}

// A statement led by UPDATE comes back from TypeORM as [rows, count]: the writes below are
// wrapped in CTEs and read with a SELECT, which returns the rows.

/**
 * Sets the consolidation name and description of every tenant account mapped to an account
 * of `chartId` from that account (accounts already in line are left alone), with one audit
 * line per account rewritten, all in one statement. Returns how many were rewritten.
 */
export async function resyncFromChart(mg: EntityManager, chartId: string, actor: AuditActor): Promise<number> {
  const [row]: Array<{ count: number }> = await mg.query(
    `WITH src AS (
       SELECT account_number, account_name, description
       FROM accounts
       WHERE tenant_id = ${CURRENT_TENANT} AND coa_id = $1::uuid
     ),
     prev AS (
       SELECT a.*
       FROM accounts a
       JOIN src ON src.account_number = a.consolidation_account_number
       WHERE a.tenant_id = ${CURRENT_TENANT}
         AND (a.consolidation_account_name IS DISTINCT FROM src.account_name
              OR a.consolidation_account_description IS DISTINCT FROM src.description)
     ),
     changed AS (
       UPDATE accounts a
       SET consolidation_account_name = src.account_name,
           consolidation_account_description = src.description,
           updated_at = now()
       FROM prev
       JOIN src ON src.account_number = prev.consolidation_account_number
       WHERE a.id = prev.id AND a.tenant_id = ${CURRENT_TENANT}
       RETURNING a.id, to_jsonb(prev) AS before, to_jsonb(a) AS after
     ),
     ${auditChangedSql('$2', '$3', '$4')}
     SELECT COUNT(*)::int AS count FROM changed`,
    [chartId, ...actorParams(actor)],
  );
  return row?.count ?? 0;
}

/**
 * Points every tenant account mapped to one of `fromNumbers` (other than `excludeId`) at the
 * consolidation account `to`: its number, name and description, with one audit line per
 * account rewritten, all in one statement. Used when an account of the consolidation chart is
 * created, renamed, described or renumbered, or joins the chart. Returns how many were rewritten.
 */
export async function remapToConsolidationAccount(
  mg: EntityManager,
  fromNumbers: number[],
  to: { number: number; name: string; description: string | null },
  excludeId: string,
  actor: AuditActor,
): Promise<number> {
  const numbers = Array.from(new Set(fromNumbers.map(Number)));
  if (numbers.length === 0) return 0;
  const [row]: Array<{ count: number }> = await mg.query(
    `WITH prev AS (
       SELECT a.*
       FROM accounts a
       WHERE a.tenant_id = ${CURRENT_TENANT}
         AND a.consolidation_account_number = ANY($1::int[])
         AND a.id <> $2::uuid
         AND (a.consolidation_account_number IS DISTINCT FROM $3::int
              OR a.consolidation_account_name IS DISTINCT FROM $4::text
              OR a.consolidation_account_description IS DISTINCT FROM $5::text)
     ),
     changed AS (
       UPDATE accounts a
       SET consolidation_account_number = $3::int,
           consolidation_account_name = $4::text,
           consolidation_account_description = $5::text,
           updated_at = now()
       FROM prev
       WHERE a.id = prev.id AND a.tenant_id = ${CURRENT_TENANT}
       RETURNING a.id, to_jsonb(prev) AS before, to_jsonb(a) AS after
     ),
     ${auditChangedSql('$6', '$7', '$8')}
     SELECT COUNT(*)::int AS count FROM changed`,
    [numbers, excludeId, to.number, to.name, to.description, ...actorParams(actor)],
  );
  return row?.count ?? 0;
}

/** An audit line of an account write, kept to be written with the others of a CSV import. */
export type AccountAuditRow = { recordId: string; action: 'create' | 'update'; before: unknown; after: unknown };

/** Writes these audit lines on `accounts` in one statement, in the shape `AuditService.log` writes. */
export async function insertAccountAudits(mg: EntityManager, rows: AccountAuditRow[], actor: AuditActor) {
  if (rows.length === 0) return;
  await mg.query(
    `INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, source, source_ref, created_at)
     SELECT 'accounts', t.record_id, t.action, t.before_json::jsonb, t.after_json::jsonb, $5::uuid, $6::text, $7::text, clock_timestamp()
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) WITH ORDINALITY AS t(record_id, action, before_json, after_json, n)
     ORDER BY t.n`,
    [
      rows.map((row) => row.recordId),
      rows.map((row) => row.action),
      rows.map((row) => (row.before == null ? null : JSON.stringify(row.before))),
      rows.map((row) => (row.after == null ? null : JSON.stringify(row.after))),
      ...actorParams(actor),
    ],
  );
}
