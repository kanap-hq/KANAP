import { EntityManager } from 'typeorm';
import { transactionDataAccessMode } from './data-access';

/**
 * Where a person may place a budget line (spec §2.3, §7.7): the paying companies and cost centers
 * the line's pickers propose. Read from the edit settings `data_access_apply` left on the current
 * transaction, the same ones `data_access_placable_line` tests, so the pickers and the server agree:
 * a company of `companies` takes any of its cost centers (or none), a cost center of `costCenters`
 * takes its own company. The server still refuses every other placement (403).
 */
export type PlacementOptions =
  | { limited: false }
  | { limited: true; all: boolean; companies: string[]; costCenters: Array<{ id: string; companyId: string }> };

/** Unscoped (mode `all`): `{ limited: false }`, with no query beyond the mode. */
export async function readPlacementOptions(manager: EntityManager): Promise<PlacementOptions> {
  if ((await transactionDataAccessMode(manager)) !== 'limited') return { limited: false };
  const [row] = await manager.query(
    `SELECT
       coalesce(NULLIF(current_setting('app.da_edit_all', true), '')::boolean, false) AS all,
       to_jsonb(coalesce(NULLIF(current_setting('app.da_edit_companies', true), '')::uuid[], '{}'::uuid[])) AS companies,
       coalesce((
         SELECT jsonb_agg(jsonb_build_object('id', c.id, 'companyId', c.company_id) ORDER BY c.id)
         FROM cost_centers c
         WHERE c.tenant_id = app_current_tenant()
           AND c.company_id IS NOT NULL
           AND c.id = ANY (coalesce(NULLIF(current_setting('app.da_edit_nodes', true), '')::uuid[], '{}'::uuid[]))
       ), '[]'::jsonb) AS cost_centers`,
  );
  return {
    limited: true,
    all: row?.all === true,
    companies: Array.isArray(row?.companies) ? row.companies : [],
    costCenters: Array.isArray(row?.cost_centers) ? row.cost_centers : [],
  };
}
