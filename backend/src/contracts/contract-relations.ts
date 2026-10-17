import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { BUDGET_NATURES, naturesAnd } from '../spend/budget-nature';

/**
 * What a contract is linked to, from the contract's side: its budget lines of both natures
 * (`contract_spend_items`), its applications (`application_contracts`), its assets
 * (`asset_contracts`) and its technologies (`technology_contracts`). Each set is listed and replaced as a whole. Every statement carries the
 * contract's tenant besides RLS. A replacement locks the contract's row first (FOR NO KEY UPDATE):
 * a second replacement of the same set waits, then reads what the first one committed, so the
 * last one wins and its audit row matches what is stored. A link written meanwhile from the other
 * side (a line, an application, an asset) is skipped by `ON CONFLICT DO NOTHING`.
 */

export type ContractRelationsDeps = {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
};

/** The contract, as read under the current tenant (its `tenant_id` scopes every statement). */
export type RelationsContract = { id: string; tenant_id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Both natures of `spend_items`, named on every statement that reads the lines (`spend/budget-nature.ts`). */
const LINE_NATURES = naturesAnd('i', BUDGET_NATURES);

// Table and column names come only from here, never from the caller.
const SETS = {
  budget_lines: {
    links: 'contract_spend_items',
    otherFk: 'spend_item_id',
    // The links to a line of either nature: the lines are the budget's only (`spend_items`).
    linkScope: ` AND EXISTS (SELECT 1 FROM spend_items i WHERE i.tenant_id = l.tenant_id AND i.id = l.spend_item_id${LINE_NATURES})`,
    exists: `SELECT i.id FROM spend_items i WHERE i.tenant_id = $1 AND i.id = ANY($2::uuid[])${LINE_NATURES}`,
    notFound: 'One or more budget lines not found.',
  },
  applications: {
    links: 'application_contracts',
    otherFk: 'application_id',
    linkScope: '',
    exists: `SELECT id FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    notFound: 'One or more applications not found.',
  },
  assets: {
    links: 'asset_contracts',
    otherFk: 'asset_id',
    linkScope: '',
    exists: `SELECT id FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    notFound: 'One or more assets not found.',
  },
  technologies: {
    links: 'technology_contracts',
    otherFk: 'technology_id',
    linkScope: '',
    exists: `SELECT id FROM technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    notFound: 'One or more technologies not found.',
  },
} as const;

export type ContractRelationSet = keyof typeof SETS;

export type ContractBudgetLine = {
  id: string;
  nature: 'opex' | 'capex';
  item_number: number | null;
  product_name: string;
  company_id: string | null;
  company_name: string | null;
};

export async function listContractBudgetLines(manager: EntityManager, contract: RelationsContract): Promise<{ items: ContractBudgetLine[] }> {
  const rows: Array<ContractBudgetLine & { item_number: number | string | null }> = await manager.query(
    `SELECT i.id, i.nature, i.item_number, i.product_name, i.paying_company_id AS company_id, comp.name AS company_name
       FROM contract_spend_items l
       JOIN spend_items i ON i.tenant_id = l.tenant_id AND i.id = l.spend_item_id${LINE_NATURES}
       LEFT JOIN companies comp ON comp.tenant_id = i.tenant_id AND comp.id = i.paying_company_id
      WHERE l.tenant_id = $1 AND l.contract_id = $2
      ORDER BY i.item_number ASC NULLS LAST, i.id ASC`,
    [contract.tenant_id, contract.id],
  );
  return { items: rows.map((row) => ({ ...row, item_number: row.item_number == null ? null : Number(row.item_number) })) };
}

export async function listContractApplications(manager: EntityManager, contract: RelationsContract): Promise<{ items: Array<{ id: string; name: string }> }> {
  const items: Array<{ id: string; name: string }> = await manager.query(
    `SELECT a.id, a.name
       FROM application_contracts l
       JOIN applications a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
      WHERE l.tenant_id = $1 AND l.contract_id = $2
      ORDER BY a.name ASC, a.id ASC`,
    [contract.tenant_id, contract.id],
  );
  return { items };
}

export async function listContractAssets(manager: EntityManager, contract: RelationsContract): Promise<{ items: Array<{ id: string; name: string }> }> {
  const items: Array<{ id: string; name: string }> = await manager.query(
    `SELECT a.id, a.name
       FROM asset_contracts l
       JOIN assets a ON a.tenant_id = l.tenant_id AND a.id = l.asset_id
      WHERE l.tenant_id = $1 AND l.contract_id = $2
      ORDER BY a.name ASC, a.id ASC`,
    [contract.tenant_id, contract.id],
  );
  return { items };
}

export async function listContractTechnologies(
  manager: EntityManager,
  contract: RelationsContract,
): Promise<{ items: Array<{ id: string; name: string; reference: string }> }> {
  const items: Array<{ id: string; name: string; reference: string }> = await manager.query(
    `SELECT t.id, t.name, 'TEC-' || t.item_number AS reference
       FROM technology_contracts l
       JOIN technologies t ON t.tenant_id = l.tenant_id AND t.id = l.technology_id
      WHERE l.tenant_id = $1 AND l.contract_id = $2
      ORDER BY t.name ASC, t.id ASC`,
    [contract.tenant_id, contract.id],
  );
  return { items };
}

/**
 * Replace one set of the contract's links with `ids` (trimmed, deduplicated). Every id must name a
 * row of the tenant (a budget line of either nature, an application, an asset, a technology): 400 otherwise,
 * and nothing is written. One audit row on the link table when the set changes: `recordId` the
 * contract, before and after the sorted ids.
 */
export async function replaceContractRelations(
  deps: ContractRelationsDeps,
  set: ContractRelationSet,
  contract: RelationsContract,
  ids: string[],
  userId: string | null,
): Promise<{ ok: true; added: number; removed: number }> {
  const { manager } = deps;
  const t = SETS[set];
  // Stored ids are lower case: an upper-case id must compare equal to its stored twin.
  const nextIds = Array.from(new Set((ids || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))).sort();
  if (nextIds.some((id) => !UUID_RE.test(id))) throw new BadRequestException(t.notFound);
  const locked = await manager.query(
    `SELECT 1 FROM contracts WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
    [contract.tenant_id, contract.id],
  );
  if (locked.length === 0) throw new NotFoundException('Contract not found.');
  if (nextIds.length) {
    const found: Array<{ id: string }> = await manager.query(t.exists, [contract.tenant_id, nextIds]);
    if (found.length !== nextIds.length) throw new BadRequestException(t.notFound);
  }

  const current: Array<{ other_id: string }> = await manager.query(
    `SELECT DISTINCT l.${t.otherFk} AS other_id FROM ${t.links} l WHERE l.tenant_id = $1 AND l.contract_id = $2${t.linkScope}`,
    [contract.tenant_id, contract.id],
  );
  const beforeIds = current.map((row) => row.other_id).sort();
  const removed = beforeIds.filter((id) => !nextIds.includes(id));
  const added = nextIds.filter((id) => !beforeIds.includes(id));

  if (removed.length) {
    await manager.query(
      `DELETE FROM ${t.links} WHERE tenant_id = $1 AND contract_id = $2 AND ${t.otherFk} = ANY($3::uuid[])`,
      [contract.tenant_id, contract.id, removed],
    );
  }
  if (added.length) {
    await manager.query(
      `INSERT INTO ${t.links} (tenant_id, contract_id, ${t.otherFk})
       SELECT $1, $2, other_id FROM unnest($3::uuid[]) AS other_id
       ON CONFLICT DO NOTHING`,
      [contract.tenant_id, contract.id, added],
    );
  }
  if (removed.length || added.length) {
    await deps.audit.log(
      { table: t.links, recordId: contract.id, action: 'update', before: { ids: beforeIds }, after: { ids: nextIds }, userId },
      { manager },
    );
  }
  return { ok: true, added: added.length, removed: removed.length };
}

/**
 * The tab badges of a contract's page: its budget lines, and what its Relations tab shows. The
 * technologies are counted, and enter `relations`, only for a caller who reads the infrastructure
 * (`technologies`): the tab shows their section to that caller only; `null` otherwise.
 */
export async function contractRelationCounts(manager: EntityManager, contract: RelationsContract, opts: { technologies: boolean } = { technologies: false }) {
  const [row]: Array<Record<string, string | number>> = await manager.query(
    `SELECT
       (SELECT count(*) FROM contract_spend_items l WHERE l.tenant_id = $1 AND l.contract_id = $2${SETS.budget_lines.linkScope}) AS budget_lines,
       (SELECT count(*) FROM application_contracts l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS applications,
       (SELECT count(*) FROM asset_contracts l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS assets,
       (SELECT count(*) FROM technology_contracts l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS technologies,
       (SELECT count(*) FROM contract_contacts l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS contacts,
       (SELECT count(*) FROM contract_links l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS links,
       (SELECT count(*) FROM contract_attachments l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS attachments`,
    [contract.tenant_id, contract.id],
  );
  const n = (key: string) => Number(row?.[key] ?? 0);
  const technologies = opts.technologies ? n('technologies') : null;
  const relations = n('applications') + n('assets') + (technologies ?? 0) + n('contacts') + n('links') + n('attachments');
  return {
    budget_lines: n('budget_lines'),
    applications: n('applications'),
    assets: n('assets'),
    technologies,
    contacts: n('contacts'),
    links: n('links'),
    attachments: n('attachments'),
    relations,
  };
}
