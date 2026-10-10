import { QueryRunner } from 'typeorm';
import { BudgetLinesNature1853960000000 } from '../../migrations/1853960000000-budget-lines-nature';
import { BudgetLinesMerge1853970000000 } from '../../migrations/1853970000000-budget-lines-merge';

/**
 * The CAPEX lines of spend_items that other specs left behind and that the down() of
 * 1853970000000 refuses (`assertRestorable`): a line of a tenant deleted since (`dropRaceTenant`
 * deletes a tenant even when lines remain, and spend_items has no key to tenants), a line without
 * one of its CAPEX fields, a line with a contract. Only a test lane's database holds them. Repaired
 * in the caller's transaction, which the specs roll back: an orphan line goes (its children with it,
 * by their keys), the others get the fields down() needs. A spec that undoes lot Z1 then reads its
 * own rows only, whatever ran on the lane before it. Row level security of spend_items and
 * search_index is lifted for the repair and put back as found.
 */
export async function repairLotZ1Residue(runner: QueryRunner): Promise<void> {
  // spend_items hides other tenants' rows; its search trigger writes search_index for each line.
  const tables = ['spend_items', 'search_index'];
  const found: Array<{ name: string; enabled: boolean; forced: boolean }> = await runner.query(
    `SELECT relname AS name, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = ANY($1::regclass[])`,
    [tables],
  );
  for (const table of found) if (table.enabled) await runner.query(`ALTER TABLE ${table.name} DISABLE ROW LEVEL SECURITY`);
  // A failed statement aborts the transaction: the caller's rollback then puts row level security back.
  await runner.query(
    `DELETE FROM spend_items s WHERE s.nature = 'capex' AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = s.tenant_id)`,
  );
  await runner.query(
    `UPDATE spend_items
        SET ppe_type = coalesce(ppe_type, 'hardware'), investment_type = coalesce(investment_type, 'replacement'),
            priority = coalesce(priority, 'medium'), contract_id = NULL
      WHERE nature = 'capex' AND (ppe_type IS NULL OR investment_type IS NULL OR priority IS NULL OR contract_id IS NOT NULL)`,
  );
  for (const table of found) {
    if (table.enabled) await runner.query(`ALTER TABLE ${table.name} ENABLE ROW LEVEL SECURITY`);
    if (table.forced) await runner.query(`ALTER TABLE ${table.name} FORCE ROW LEVEL SECURITY`);
  }
}

/**
 * Lot Z1 undone in the caller's transaction (newest migration first: the CAPEX lines back in
 * capex_*, as before 1853960000000), after the residue of other specs is repaired. Run as a
 * migration runs, without a tenant; the caller captures the log.
 */
export async function undoLotZ1(runner: QueryRunner): Promise<void> {
  await repairLotZ1Residue(runner);
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  await new BudgetLinesMerge1853970000000().down(runner);
  await new BudgetLinesNature1853960000000().down(runner);
}
