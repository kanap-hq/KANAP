import { BadRequestException } from '@nestjs/common';
import { And, EntityManager, Equal, FindOperator, Raw } from 'typeorm';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';

/**
 * The consolidation chart (plan planning/coa-consolidation-chart.md): at most one chart per
 * tenant (`chart_of_accounts.is_consolidation`) holds the group accounts every local account
 * maps to through `accounts.consolidation_account_number`. The number is the key: the
 * consolidation name and description of an account are derived from the consolidation
 * chart's account of that number. An account whose number is absent from the consolidation
 * chart (or when the tenant has none) is "outside"; one without a number is "unmapped".
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

/** A find condition on `consolidation_account_number` that keeps the accounts of one status. */
export function consolidationStatusCondition(status: ConsolidationStatus): FindOperator<any> {
  switch (status) {
    case 'unmapped':
      return Raw((alias) => `${alias} IS NULL`);
    case 'mapped':
      return Raw((alias) => `${alias} IN (${CONSOLIDATION_NUMBERS_SQL})`);
    case 'outside':
      return Raw((alias) => `${alias} IS NOT NULL AND ${alias} NOT IN (${CONSOLIDATION_NUMBERS_SQL})`);
  }
}

/** Both conditions on one column: `extra` added to what the where clause already holds. */
export function andCondition(existing: unknown, extra: FindOperator<any>): FindOperator<any> {
  if (existing === undefined) return extra;
  const current = existing instanceof FindOperator ? existing : Equal(existing);
  return And(current, extra);
}

// A statement led by UPDATE comes back from TypeORM as [rows, count]: the writes below are
// wrapped in a CTE and read with a SELECT, which returns the rows.

/** The tenant's consolidation chart id, or null. */
export async function consolidationChartId(mg: EntityManager): Promise<string | null> {
  const rows: Array<{ id: string }> = await mg.query(
    `SELECT id::text AS id FROM chart_of_accounts WHERE tenant_id = ${CURRENT_TENANT} AND is_consolidation LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

/** The consolidation numbers found in the tenant's consolidation chart (none without a chart). */
export type ConsolidationLookup = { numbers: Set<number> };

/** Which of these consolidation numbers exist in the tenant's consolidation chart (one query). */
export async function consolidationLookup(mg: EntityManager, numbers: Array<number | null | undefined>): Promise<ConsolidationLookup> {
  const wanted = Array.from(new Set(numbers.filter((n): n is number => n != null).map(Number)));
  if (wanted.length === 0) return { numbers: new Set() };
  const rows: Array<{ account_number: number }> = await mg.query(
    `SELECT ca.account_number
     FROM accounts ca
     JOIN chart_of_accounts cc ON cc.id = ca.coa_id AND cc.tenant_id = ca.tenant_id
     WHERE cc.tenant_id = ${CURRENT_TENANT} AND ca.tenant_id = ${CURRENT_TENANT}
       AND cc.is_consolidation AND ca.account_number = ANY($1::int[])`,
    [wanted],
  );
  return { numbers: new Set(rows.map((r) => Number(r.account_number))) };
}

export function consolidationStatusOf(number: number | null | undefined, lookup: ConsolidationLookup): ConsolidationStatus {
  if (number == null) return 'unmapped';
  return lookup.numbers.has(Number(number)) ? 'mapped' : 'outside';
}

type ChangedAccount = { before: Record<string, any>; after: Record<string, any> };

/**
 * Sets the consolidation name and description of every tenant account mapped to an account
 * of `chartId` from that account (accounts already in line are left alone). Returns the
 * accounts rewritten, before and after.
 */
export async function resyncFromChart(mg: EntityManager, chartId: string): Promise<ChangedAccount[]> {
  return mg.query(
    `WITH src AS (
       SELECT account_number, account_name, description
       FROM accounts
       WHERE tenant_id = ${CURRENT_TENANT} AND coa_id = $1
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
       RETURNING to_jsonb(prev) AS before, to_jsonb(a) AS after
     )
     SELECT before, after FROM changed`,
    [chartId],
  );
}

/**
 * Points every tenant account mapped to one of `fromNumbers` (other than `excludeId`) at the
 * consolidation account `to`: its number, name and description. Used when an account of the
 * consolidation chart is created, renamed, described or renumbered. Returns the accounts
 * rewritten, before and after.
 */
export async function remapToConsolidationAccount(
  mg: EntityManager,
  fromNumbers: number[],
  to: { number: number; name: string; description: string | null },
  excludeId: string,
): Promise<ChangedAccount[]> {
  const numbers = Array.from(new Set(fromNumbers.map(Number)));
  if (numbers.length === 0) return [];
  return mg.query(
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
       RETURNING to_jsonb(prev) AS before, to_jsonb(a) AS after
     )
     SELECT before, after FROM changed`,
    [numbers, excludeId, to.number, to.name, to.description],
  );
}

/** One audit line per account rewritten (the audit helper has no bulk form). */
export async function auditChangedAccounts(
  audit: AuditService,
  mg: EntityManager,
  changed: ChangedAccount[],
  userId: string | null | undefined,
  source?: AuditSourceOptions,
) {
  for (const row of changed) {
    await audit.log(
      {
        table: 'accounts',
        recordId: row.after?.id ?? null,
        action: 'update',
        before: row.before,
        after: row.after,
        userId: userId ?? null,
        source: source?.source,
        sourceRef: source?.sourceRef ?? null,
      },
      { manager: mg },
    );
  }
}
