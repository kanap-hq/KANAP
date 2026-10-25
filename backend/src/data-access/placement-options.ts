import { EntityManager } from 'typeorm';
import { transactionDataAccessMode } from './data-access';

/**
 * Where a person may place a budget line or a contract (spec §2.3, §7.7): the paying companies and
 * cost centers the line's pickers propose, and every edit node, unfolded. Read from the edit
 * settings `data_access_apply` left on the current transaction, the same ones
 * `data_access_placable_line` and `data_access_placable_contract` test, so the pickers and the
 * server agree: a company of `companies` takes any of its cost centers (or none), a cost center of
 * `costCenters` takes its own company, and a contract may take any node of `editNodes` with a
 * company of `editNodeCompanies`. The server still refuses every other placement (403).
 */
export type PlacementOptions =
  | { limited: false }
  | {
      limited: true;
      all: boolean;
      companies: string[];
      /** The edit cost centers (groups left out: a line takes a cost center only). */
      costCenters: Array<{ id: string; companyId: string }>;
      /** The edit nodes, unfolded by `data_access_apply`: groups, sub-groups and centres (a contract's place). */
      editNodes: Array<{ id: string; companyId: string | null }>;
      /** Companies of the edit nodes (a group included, through its centres): the contract rule needs them (spec §2.3). */
      editNodeCompanies: string[];
    };

/** Unscoped (mode `all`): `{ limited: false }`, with no query beyond the mode. */
export async function readPlacementOptions(manager: EntityManager): Promise<PlacementOptions> {
  if ((await transactionDataAccessMode(manager)) !== 'limited') return { limited: false };
  const [row] = await manager.query(
    `SELECT
       coalesce(NULLIF(current_setting('app.da_edit_all', true), '')::boolean, false) AS all,
       to_jsonb(coalesce(NULLIF(current_setting('app.da_edit_companies', true), '')::uuid[], '{}'::uuid[])) AS companies,
       to_jsonb(coalesce(NULLIF(current_setting('app.da_edit_node_companies', true), '')::uuid[], '{}'::uuid[])) AS edit_node_companies,
       coalesce((
         SELECT jsonb_agg(jsonb_build_object('id', c.id, 'companyId', c.company_id) ORDER BY c.id)
         FROM cost_centers c
         WHERE c.tenant_id = app_current_tenant()
           AND c.id = ANY (coalesce(NULLIF(current_setting('app.da_edit_nodes', true), '')::uuid[], '{}'::uuid[]))
       ), '[]'::jsonb) AS edit_nodes`,
  );
  const editNodes: Array<{ id: string; companyId: string | null }> = Array.isArray(row?.edit_nodes) ? row.edit_nodes : [];
  return {
    limited: true,
    all: row?.all === true,
    companies: Array.isArray(row?.companies) ? row.companies : [],
    costCenters: editNodes
      .filter((node) => node.companyId != null)
      .map((node) => ({ id: node.id, companyId: node.companyId as string })),
    editNodes,
    editNodeCompanies: Array.isArray(row?.edit_node_companies) ? row.edit_node_companies : [],
  };
}
