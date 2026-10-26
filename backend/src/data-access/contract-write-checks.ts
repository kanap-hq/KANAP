import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  DATA_ACCESS_CONTRACT_NOT_FOUND_MESSAGE,
  DATA_ACCESS_PLACEMENT_MESSAGE,
  DataAccessLimitedException,
  isLimitedTransaction,
} from './line-write-checks';

/**
 * Data-scoped access, lot 5 run 5B: the checks a write on a contract or its children runs before
 * writing, in a limited transaction (planning/data-scoped-access/spec.md §4.3, §6.7, §6.8). The
 * database refuses a write outside the person's access anyway (42501, or an UPDATE that touches no
 * row); these checks turn it into a clear 403 `DATA_ACCESS_LIMITED` first, and a hidden contract
 * stays a 404.
 *
 * The rules stay in the database: each check calls the SQL functions of lots 2 and 5
 * (`data_access_placable_contract`, `data_access_contract_modifiable`,
 * `data_access_contract_visible`). An unscoped person costs no query: the mode comes from the
 * runner `applyDataAccess` served (`transactionDataAccessMode`).
 */

/** A contract read but not modifiable (an owner out of the edit nodes, a contract opened through a visible line). */
export const DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE = 'This contract is read only in your access.';

/** modifiable_contrat (spec §6.4) on the contract aliased `c.` (with its dot), by the SQL function of lot 5. */
export function contractEditableSql(alias: string): string {
  return `data_access_contract_modifiable(${alias}id)`;
}

function distinctIds(ids: Iterable<string | null | undefined>): string[] {
  return Array.from(new Set(Array.from(ids).filter((id): id is string => typeof id === 'string' && id !== '')));
}

/** A contract placed (created, or moved to another company or place) where the person may place it. */
export async function assertContractPlacement(
  manager: EntityManager,
  companyId: string | null,
  costCenterId: string | null,
): Promise<void> {
  if (!(await isLimitedTransaction(manager))) return;
  const [row] = await manager.query(`SELECT data_access_placable_contract($1::uuid, $2::uuid) AS placable`, [companyId, costCenterId]);
  if (row?.placable !== true) throw new DataAccessLimitedException(DATA_ACCESS_PLACEMENT_MESSAGE);
}

/** Refuses (403) when one of the contracts is readable but not modifiable by the person. */
export async function assertContractsEditable(manager: EntityManager, contractIds: Iterable<string | null | undefined>): Promise<void> {
  const ids = distinctIds(contractIds);
  if (ids.length === 0 || !(await isLimitedTransaction(manager))) return;
  const rows = await manager.query(
    `SELECT c.id FROM contracts c WHERE c.id = ANY($1::uuid[]) AND NOT ${contractEditableSql('c.')} LIMIT 1`,
    [ids],
  );
  if (rows.length > 0) throw new DataAccessLimitedException(DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE);
}

/**
 * `editable` for a contract read by id (spec §6.7): whether the person may modify it, by the same
 * SQL function as the policies, in a limited transaction only; nothing (no query) for an unscoped
 * person, whose contracts are all editable as before.
 */
export async function contractEditableField(manager: EntityManager, contractId: string): Promise<{ editable?: boolean }> {
  if (!(await isLimitedTransaction(manager))) return {};
  const [row] = await manager.query(`SELECT ${contractEditableSql('c.')} AS editable FROM contracts c WHERE c.id = $1`, [contractId]);
  return { editable: row?.editable === true };
}

/** The same per id, for a page of rows: no query for an unscoped person. */
export async function contractEditableFields(
  manager: EntityManager,
  contractIds: Iterable<string | null | undefined>,
): Promise<Map<string, boolean>> {
  const ids = distinctIds(contractIds);
  const out = new Map<string, boolean>();
  if (ids.length === 0 || !(await isLimitedTransaction(manager))) return out;
  const rows: Array<{ id: string; editable: boolean }> = await manager.query(
    `SELECT c.id, ${contractEditableSql('c.')} AS editable FROM contracts c WHERE c.id = ANY($1::uuid[])`,
    [ids],
  );
  for (const row of rows) out.set(row.id, row.editable === true);
  return out;
}

/**
 * The contract a link names (spec §5.4, §6.4): a limited person links only a contract they can
 * read; one they cannot read and one that does not exist get the same 404, so the foreign key
 * tells nothing.
 */
export async function assertContractReadable(manager: EntityManager, contractId: string | null | undefined): Promise<void> {
  if (!contractId || !(await isLimitedTransaction(manager))) return;
  const [row] = await manager.query(`SELECT data_access_contract_visible($1::uuid) AS visible`, [contractId]);
  if (row?.visible !== true) throw new NotFoundException(DATA_ACCESS_CONTRACT_NOT_FOUND_MESSAGE);
}
