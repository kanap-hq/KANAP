import { ForbiddenException, HttpStatus, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { transactionDataAccessMode } from './data-access';

/**
 * Data-scoped access, lot 3: the checks a write on a budget line or its children runs before
 * writing, in a limited transaction (planning/data-scoped-access/spec.md §6.7, §6.8). A refused
 * write must never look saved: the database refuses it anyway (42501, or an UPDATE that touches no
 * row), and these checks turn it into a clear 403 `DATA_ACCESS_LIMITED` first.
 *
 * The rules stay in the database: each check calls the SQL functions of lots 2 and 3
 * (`data_access_placable_line`, `data_access_line_editable`, `data_access_contract_visible`,
 * `data_access_line_of_version`, `data_access_line_of_round_input`). An unscoped person costs no
 * query: the mode comes from the runner `applyDataAccess` served (`transactionDataAccessMode`).
 *
 * A line out of read access has no row under its SELECT policy: the checks pass it over, and the
 * caller's own lookup answers 404 as for a missing line.
 */

export const DATA_ACCESS_PLACEMENT_MESSAGE = 'This company or cost center is not part of your access.';
export const DATA_ACCESS_READ_ONLY_LINE_MESSAGE = 'This line is read only in your access.';
/** An owner change that would take the line out of the person's own edit access (spec §6.8). */
export const DATA_ACCESS_LEAVES_ACCESS_MESSAGE =
  'This change would take the line out of your access. Keep yourself as an owner, or ask someone with access to its company.';
/** A contract a limited person cannot read answers as a missing one: the key is no existence oracle. */
export const DATA_ACCESS_CONTRACT_NOT_FOUND_MESSAGE = 'This contract does not exist.';

/** 403 `DATA_ACCESS_LIMITED` with a message that says what is out of access (and `extra` fields of the body, if any). */
export class DataAccessLimitedException extends ForbiddenException {
  constructor(message: string, extra?: Record<string, unknown>) {
    super({ ...extra, statusCode: HttpStatus.FORBIDDEN, error: 'Forbidden', code: 'DATA_ACCESS_LIMITED', message });
  }
}

/** modifiable_ligne (spec §6.4) on the line aliased `p` (with its dot), by the SQL function of lot 3. */
export function lineEditableSql(p: string): string {
  return `data_access_line_editable(${p}paying_company_id, ${p}cost_center_id, ${p}owner_it_id, ${p}owner_business_id)`;
}

export async function isLimitedTransaction(manager: EntityManager): Promise<boolean> {
  return (await transactionDataAccessMode(manager)) === 'limited';
}

/** A line placed (created, or moved to another company or cost center) where the person may place it. */
export async function assertLinePlacement(
  manager: EntityManager,
  companyId: string | null,
  costCenterId: string | null,
): Promise<void> {
  if (!(await isLimitedTransaction(manager))) return;
  const [row] = await manager.query(`SELECT data_access_placable_line($1::uuid, $2::uuid) AS placable`, [companyId, costCenterId]);
  if (row?.placable !== true) throw new DataAccessLimitedException(DATA_ACCESS_PLACEMENT_MESSAGE);
}

function distinctIds(ids: Iterable<string | null | undefined>): string[] {
  return Array.from(new Set(Array.from(ids).filter((id): id is string => typeof id === 'string' && id !== '')));
}

/** Refuses (403) when one of the lines is readable but not modifiable by the person. */
export async function assertLinesEditable(manager: EntityManager, lineIds: Iterable<string | null | undefined>): Promise<void> {
  const ids = distinctIds(lineIds);
  if (ids.length === 0 || !(await isLimitedTransaction(manager))) return;
  await refuseReadOnly(manager, `SELECT i.id FROM spend_items i WHERE i.id = ANY($1::uuid[]) AND NOT ${lineEditableSql('i.')} LIMIT 1`, [ids]);
}

/** The same check, for the lines of these versions. */
export async function assertVersionsEditable(manager: EntityManager, versionIds: Iterable<string | null | undefined>): Promise<void> {
  const ids = distinctIds(versionIds);
  if (ids.length === 0 || !(await isLimitedTransaction(manager))) return;
  await refuseReadOnly(
    manager,
    `SELECT i.id FROM spend_items i
      WHERE i.id IN (SELECT data_access_line_of_version(v) FROM unnest($1::uuid[]) AS v)
        AND NOT ${lineEditableSql('i.')} LIMIT 1`,
    [ids],
  );
}

/** The same check, for the lines of these round inputs. */
export async function assertRoundInputsEditable(manager: EntityManager, roundInputIds: Iterable<string | null | undefined>): Promise<void> {
  const ids = distinctIds(roundInputIds);
  if (ids.length === 0 || !(await isLimitedTransaction(manager))) return;
  await refuseReadOnly(
    manager,
    `SELECT i.id FROM spend_items i
      WHERE i.id IN (SELECT data_access_line_of_round_input(r) FROM unnest($1::uuid[]) AS r)
        AND NOT ${lineEditableSql('i.')} LIMIT 1`,
    [ids],
  );
}

/**
 * `editable` for a line read by id (spec §6.7): whether the person may modify it, by the same SQL
 * function as the policies, in a limited transaction only; nothing (no query) for an unscoped
 * person, whose lines are all editable as before.
 */
export async function lineEditableField(manager: EntityManager, lineId: string): Promise<{ editable?: boolean }> {
  if (!(await isLimitedTransaction(manager))) return {};
  const [row] = await manager.query(`SELECT ${lineEditableSql('i.')} AS editable FROM spend_items i WHERE i.id = $1`, [lineId]);
  return { editable: row?.editable === true };
}

async function refuseReadOnly(manager: EntityManager, sql: string, params: unknown[]): Promise<void> {
  const rows = await manager.query(sql, params);
  if (rows.length > 0) throw new DataAccessLimitedException(DATA_ACCESS_READ_ONLY_LINE_MESSAGE);
}

/**
 * The contract a line names (`spend_items.contract_id`, spec §5.4, §6.4): a limited person names
 * only a contract they can read; one they cannot read and one that does not exist get the same
 * 404, so the foreign key tells nothing. Lot 5 adds the trigger that refuses it in the database.
 */
export async function assertLineContractReadable(manager: EntityManager, contractId: string | null | undefined): Promise<void> {
  if (!contractId || !(await isLimitedTransaction(manager))) return;
  const [row] = await manager.query(`SELECT data_access_contract_visible($1::uuid) AS visible`, [contractId]);
  if (row?.visible !== true) throw new NotFoundException(DATA_ACCESS_CONTRACT_NOT_FOUND_MESSAGE);
}

/**
 * A write that counts the rows it touched (spec §6.7, "succès silencieux"): none touched in a
 * limited transaction means the policies hid the row from the write; the caller checked it exists
 * and is readable, so the line is read only for the person. Unscoped persons: no query, no change.
 */
export async function assertDataAccessWritten(manager: EntityManager, affected: number | null | undefined): Promise<void> {
  // A driver that reports no count (never PostgreSQL) leaves nothing to check.
  if (affected == null || affected > 0) return;
  if (await isLimitedTransaction(manager)) throw new DataAccessLimitedException(DATA_ACCESS_READ_ONLY_LINE_MESSAGE);
}
