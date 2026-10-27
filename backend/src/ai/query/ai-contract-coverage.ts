import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../../auth/business-contributor-scope';

/**
 * What contracts cover, read for the assistant from the contracts' side: their applications
 * (`application_contracts`), assets (`asset_contracts`) and technologies (`technology_contracts`),
 * by batch of contract ids, each statement on the tenant. The caller decides which families the
 * person reads (`AiQueryExecutor.readableLinks`); a Business Contributor's applications are those
 * of their participation (`applicationScope`), as their applications list.
 */

/** A record a contract covers: its business reference and its name. */
export type ContractCoveredRecord = { id: string; reference: string | null; name: string };

export type ContractCoveredFamily = 'applications' | 'assets' | 'technologies';

const COVERED_SQL: Record<ContractCoveredFamily, { select: string; from: string }> = {
  applications: {
    select: `NULLIF(r.sequential_id, '') AS reference, r.name`,
    from: `application_contracts l JOIN applications r ON r.tenant_id = l.tenant_id AND r.id = l.application_id`,
  },
  assets: {
    select: `NULLIF(r.asset_reference, '') AS reference, r.name`,
    from: `asset_contracts l JOIN assets r ON r.tenant_id = l.tenant_id AND r.id = l.asset_id`,
  },
  technologies: {
    select: `CASE WHEN r.item_number IS NULL THEN NULL ELSE 'TEC-' || r.item_number END AS reference, r.name`,
    from: `technology_contracts l JOIN technologies r ON r.tenant_id = l.tenant_id AND r.id = l.technology_id`,
  },
};

/** The records of `family` each contract of `contractIds` covers, ordered by name. */
export async function loadContractCoverage(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  family: ContractCoveredFamily,
  contractIds: string[],
  applicationScope?: ParticipationAccessScope,
): Promise<Map<string, ContractCoveredRecord[]>> {
  const byContract = new Map<string, ContractCoveredRecord[]>();
  if (contractIds.length === 0) return byContract;
  const { select, from } = COVERED_SQL[family];
  const params: unknown[] = [tenantId, contractIds];
  let scope = '';
  if (family === 'applications' && applicationScope) {
    params.push(applicationScope.userId);
    scope = ` AND ${applicationParticipantCondition('r', `$${params.length}`)}`;
  }
  const rows: Array<ContractCoveredRecord & { contract_id: string }> = await manager.query(
    `SELECT l.contract_id::text AS contract_id, r.id::text AS id, ${select}
       FROM ${from}
      WHERE l.tenant_id = $1 AND l.contract_id = ANY($2::uuid[])${scope}
      ORDER BY lower(r.name), r.id`,
    params,
  );
  for (const { contract_id, ...record } of rows) {
    byContract.set(contract_id, [...(byContract.get(contract_id) ?? []), record]);
  }
  return byContract;
}

/** The covered records as one line, `APP-8 SAP S/4HANA, APP-9 SAP BW`, for a list item. */
export function coveredRecordsText(records: ContractCoveredRecord[] | undefined): string {
  return (records ?? []).map((record) => [record.reference, record.name].filter(Boolean).join(' ')).join(', ');
}
