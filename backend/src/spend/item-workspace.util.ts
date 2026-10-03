import { EntityManager } from 'typeorm';
import { deriveStatusFromDisabledAt, StatusState } from '../common/status';
import type { CostCenterKind } from '../cost-centers/cost-center.entity';
import { AmountScope } from './amounts-write.util';

/**
 * What the OPEX and CAPEX workspaces read besides the line itself, in one
 * statement each instead of one request per picker or per relation:
 * - the labels of the line's references, so the pickers show the chosen
 *   supplier, company, account, owners and cost center without loading their
 *   lists (and a member without access to the users page sees the owners'
 *   names; the cost center brings its company and budget holder);
 * - the number of each relation, for the Relations tab badge.
 * Every statement carries the line's tenant besides RLS.
 */

/** Table and column names come only from here: never from the caller. */
const SCOPES = {
  opex: {
    contracts: { table: 'contract_spend_items', fk: 'spend_item_id' },
    applications: { table: 'application_spend_items', fk: 'spend_item_id' },
    projects: { table: 'portfolio_project_opex', fk: 'opex_id' },
    links: { table: 'spend_links', fk: 'spend_item_id' },
    attachments: { table: 'spend_attachments', fk: 'spend_item_id' },
  },
  capex: {
    contracts: { table: 'contract_capex_items', fk: 'capex_item_id' },
    applications: { table: 'application_capex_items', fk: 'capex_item_id' },
    projects: { table: 'portfolio_project_capex', fk: 'capex_id' },
    links: { table: 'capex_links', fk: 'capex_item_id' },
    attachments: { table: 'capex_attachments', fk: 'capex_item_id' },
  },
} as const;

export type ItemReferenceIds = {
  tenant_id: string;
  supplier_id?: string | null;
  paying_company_id?: string | null;
  account_id?: string | null;
  owner_it_id?: string | null;
  owner_business_id?: string | null;
  cost_center_id?: string | null;
};

type UserLabel = { id: string; first_name: string | null; last_name: string | null; email: string | null };

/** The line's cost center as a node of the tree reads (`cost-center-tree.util.ts`): effective status, owner name. */
export type CostCenterReference = {
  id: string;
  code: string;
  name: string;
  kind: CostCenterKind;
  status: 'enabled' | 'disabled';
  company_id: string | null;
  company_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
};

/** The picker options of the line's references (the shapes of the lookups in common/lookup). */
export type ItemReferences = {
  supplier: { id: string; name: string; erp_supplier_id: string | null; status: string } | null;
  paying_company: { id: string; name: string } | null;
  account: { id: string; account_number: number; account_name: string; description: string | null; coa_id: string | null } | null;
  owner_it: UserLabel | null;
  owner_business: UserLabel | null;
  cost_center: CostCenterReference | null;
};

// The email only for a person without a name, as the user lookup returns it.
const userJson = (alias: string) => `json_build_object(
  'id', ${alias}.id, 'first_name', ${alias}.first_name, 'last_name', ${alias}.last_name,
  'email', CASE WHEN btrim(coalesce(${alias}.first_name, '') || ' ' || coalesce(${alias}.last_name, '')) = '' THEN ${alias}.email END)`;

export async function loadItemReferences(manager: EntityManager, item: ItemReferenceIds): Promise<ItemReferences> {
  const [row] = await manager.query(
    `SELECT
       (SELECT json_build_object('id', s.id, 'name', s.name, 'erp_supplier_id', s.erp_supplier_id, 'status', s.status)
          FROM suppliers s WHERE s.tenant_id = $1 AND s.id = $2) AS supplier,
       (SELECT json_build_object('id', c.id, 'name', c.name)
          FROM companies c WHERE c.tenant_id = $1 AND c.id = $3) AS paying_company,
       (SELECT json_build_object('id', a.id, 'account_number', a.account_number, 'account_name', a.account_name,
                                 'description', a.description, 'coa_id', a.coa_id)
          FROM accounts a WHERE a.tenant_id = $1 AND a.id = $4) AS account,
       (SELECT ${userJson('u')} FROM users u WHERE u.tenant_id = $1 AND u.id = $5) AS owner_it,
       (SELECT ${userJson('u')} FROM users u WHERE u.tenant_id = $1 AND u.id = $6) AS owner_business,
       (SELECT json_build_object('id', cc.id, 'code', cc.code, 'name', cc.name, 'kind', cc.kind,
                                 'disabled_at', cc.disabled_at, 'company_id', cc.company_id, 'company_name', c.name,
                                 'owner_user_id', cc.owner_user_id,
                                 'owner_name', CASE WHEN u.id IS NULL THEN NULL
                                   ELSE COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) END)
          FROM cost_centers cc
          LEFT JOIN companies c ON c.tenant_id = cc.tenant_id AND c.id = cc.company_id
          LEFT JOIN users u ON u.tenant_id = cc.tenant_id AND u.id = cc.owner_user_id
         WHERE cc.tenant_id = $1 AND cc.id = $7) AS cost_center`,
    [
      item.tenant_id,
      item.supplier_id ?? null,
      item.paying_company_id ?? null,
      item.account_id ?? null,
      item.owner_it_id ?? null,
      item.owner_business_id ?? null,
      item.cost_center_id ?? null,
    ],
  );
  return {
    supplier: row?.supplier ?? null,
    paying_company: row?.paying_company ?? null,
    account: row?.account ? { ...row.account, account_number: Number(row.account.account_number) } : null,
    owner_it: row?.owner_it ?? null,
    owner_business: row?.owner_business ?? null,
    cost_center: row?.cost_center ? costCenterReference(row.cost_center) : null,
  };
}

function costCenterReference(raw: Record<string, any>): CostCenterReference {
  return {
    id: raw.id,
    code: raw.code,
    name: raw.name,
    kind: raw.kind,
    // The status the tree shows: a node past its end of validity reads as disabled.
    status: deriveStatusFromDisabledAt(raw.disabled_at) === StatusState.DISABLED ? 'disabled' : 'enabled',
    company_id: raw.company_id ?? null,
    company_name: raw.company_name ?? null,
    owner_user_id: raw.owner_user_id ?? null,
    owner_name: raw.owner_name ?? null,
  };
}

export type ItemRelationCounts = {
  contracts: number;
  applications: number;
  projects: number;
  links: number;
  attachments: number;
  total: number;
};

/**
 * The counts the Relations tab lists: links to rows that exist (the lists join
 * their target), the line's websites and attachments.
 */
export async function countItemRelations(
  manager: EntityManager,
  scope: AmountScope,
  item: { id: string; tenant_id: string },
): Promise<ItemRelationCounts> {
  const t = SCOPES[scope];
  const [row] = await manager.query(
    `SELECT
       (SELECT count(*) FROM ${t.contracts.table} l JOIN contracts c ON c.tenant_id = l.tenant_id AND c.id = l.contract_id
         WHERE l.tenant_id = $1 AND l.${t.contracts.fk} = $2)::int AS contracts,
       (SELECT count(*) FROM ${t.applications.table} l JOIN applications a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
         WHERE l.tenant_id = $1 AND l.${t.applications.fk} = $2)::int AS applications,
       (SELECT count(*) FROM ${t.projects.table} l JOIN portfolio_projects p ON p.tenant_id = l.tenant_id AND p.id = l.project_id
         WHERE l.tenant_id = $1 AND l.${t.projects.fk} = $2)::int AS projects,
       (SELECT count(*) FROM ${t.links.table} WHERE tenant_id = $1 AND ${t.links.fk} = $2)::int AS links,
       (SELECT count(*) FROM ${t.attachments.table} WHERE tenant_id = $1 AND ${t.attachments.fk} = $2)::int AS attachments`,
    [item.tenant_id, item.id],
  );
  const counts = {
    contracts: Number(row?.contracts) || 0,
    applications: Number(row?.applications) || 0,
    projects: Number(row?.projects) || 0,
    links: Number(row?.links) || 0,
    attachments: Number(row?.attachments) || 0,
  };
  return { ...counts, total: counts.contracts + counts.applications + counts.projects + counts.links + counts.attachments };
}
