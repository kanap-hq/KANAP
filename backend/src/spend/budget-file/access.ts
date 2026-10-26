import { EntityManager } from 'typeorm';
import { isLimitedTransaction, lineEditableSql } from '../../data-access/line-write-checks';
import { BudgetFileAccess, planBudgetFile, PreflightInput } from './preflight';
import { BudgetFileLinePlan, BudgetFileReport, StoredLine } from './types';

/**
 * The budget file within a limited person's access (planning/data-scoped-access spec §4.2). The
 * rules stay in the database: the lines the person may modify (`data_access_line_editable`) and
 * the places a line may go (`data_access_placable_line`) are the answers of the SQL functions of
 * lots 2 and 3, the same ones the line write gate (`item-write.util.ts`) and the policies call.
 * The plan (`preflight.ts`) reads them from `BudgetFileAccess`. An unscoped person gets no access
 * object and costs no query: the file behaves as before.
 */

/** In a limited transaction: the stored lines the person may modify. Undefined otherwise. */
export async function loadFileAccess(manager: EntityManager, stored: readonly StoredLine[]): Promise<BudgetFileAccess | undefined> {
  if (!(await isLimitedTransaction(manager))) return undefined;
  const ids = stored.map((line) => line.id);
  const rows: Array<{ id: string }> = ids.length === 0 ? [] : await manager.query(
    `SELECT i.id::text AS id FROM spend_items i WHERE i.id = ANY($1::uuid[]) AND ${lineEditableSql('i.')}`,
    [ids],
  );
  return { editable: new Set(rows.map((row) => row.id)), places: new Map(), wanted: new Map() };
}

/**
 * The plan, with a limited person's places answered by the database: a first plan collects the
 * places it needs (new lines, moves, owner changes), one statement answers them, a second plan
 * uses the answers. Without access, the plan as before.
 */
export async function planWithAccess(
  manager: EntityManager,
  input: PreflightInput,
): Promise<{ report: BudgetFileReport; plans: BudgetFileLinePlan[] }> {
  const access = input.access;
  const first = planBudgetFile(input);
  if (!access || access.wanted.size === 0) return first;
  const places = [...access.wanted.entries()];
  const rows: Array<{ placable: boolean; editable: boolean }> = await manager.query(
    `SELECT data_access_placable_line(t.company, t.centre) AS placable,
            data_access_line_editable(t.company, t.centre, t.owner_it, t.owner_business) AS editable
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[]) WITH ORDINALITY AS t(company, centre, owner_it, owner_business, n)
      ORDER BY t.n`,
    [
      places.map(([, place]) => place.companyId),
      places.map(([, place]) => place.costCenterId),
      places.map(([, place]) => place.ownerItId),
      places.map(([, place]) => place.ownerBusinessId),
    ],
  );
  places.forEach(([key], index) => {
    access.places.set(key, { placable: rows[index]?.placable === true, editable: rows[index]?.editable === true });
  });
  access.wanted.clear();
  return planBudgetFile(input);
}
