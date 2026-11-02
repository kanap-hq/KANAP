import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { costCenterLabel } from '../cost-centers/cost-center-tree.util';
import { resolveBudgetLine } from '../common/resolve-item-id';
import { loadAccessTree, subtreeIds, type AccessTree } from '../data-access/data-access-tree';
import { BUDGET_NATURES, naturesAnd } from '../spend/budget-nature';

/**
 * Whether a budget line and a contract disagree on paying company, cost center, supplier or
 * currency. Computed when the link is read, never stored: a later edit of either record shows up
 * on the next read. A mismatch does not refuse the link.
 *
 * Cost center: no check when the contract has none. A group matches a line whose center is the
 * group or anywhere under it (`subtreeIds`). Any other node matches by equality only, including
 * a center that happens to have children. A missing center row has no kind, so it matches by
 * equality and contributes no label.
 * Supplier: no check when the line has none.
 * Currency: compared after trim and upper case, so `char(3)` padding and `eur` / `EUR` agree.
 */

export const CONTRACT_LINE_MISMATCH_FIELDS = ['paying_company', 'cost_center', 'supplier', 'currency'] as const;
export type ContractLineMismatchField = (typeof CONTRACT_LINE_MISMATCH_FIELDS)[number];

export type ContractLineMismatch = {
  field: ContractLineMismatchField;
  line_value: string | null;
  contract_value: string | null;
};

const MAX_CONSISTENCY_IDS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_NATURES = naturesAnd('i', BUDGET_NATURES);

type LineSide = {
  id: string;
  paying_company_id: string | null;
  paying_company_name: string | null;
  cost_center_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  currency: string | null;
};

type ContractSide = {
  id: string;
  company_id: string | null;
  company_name: string | null;
  cost_center_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  cost_center_kind: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  currency: string | null;
};

/** Comma-separated uuids, at most 100. Empty is none. Anything else is 400. */
export function parseConsistencyIds(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (typeof raw !== 'string') throw new BadRequestException('ids must be a comma-separated list of identifiers.');
  const parts = raw.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length > MAX_CONSISTENCY_IDS) throw new BadRequestException(`At most ${MAX_CONSISTENCY_IDS} identifiers.`);
  if (parts.some((id) => !UUID_RE.test(id))) throw new BadRequestException('ids must be a comma-separated list of identifiers.');
  return [...new Set(parts)];
}

function normId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  return text || null;
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  return normId(left) === normId(right);
}

function textOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

/** The code shown for a mismatch. Blank is null. `eur` and `EUR ` are both `EUR`. */
export function matchCurrency(value: string | null | undefined): string | null {
  const text = textOrNull(value);
  return text ? text.toUpperCase() : null;
}

function centerLabel(code: string | null, name: string | null): string | null {
  const normalizedCode = textOrNull(code);
  const normalizedName = textOrNull(name);
  if (normalizedCode && normalizedName) return costCenterLabel({ code: normalizedCode, name: normalizedName });
  return normalizedName || normalizedCode;
}

function mismatch(field: ContractLineMismatchField, lineValue: string | null, contractValue: string | null): ContractLineMismatch {
  return { field, line_value: lineValue, contract_value: contractValue };
}

/**
 * The differences, in field order. `groupMembers` answers the centers under a group (the group
 * included). It is only called for a contract center whose kind is `group`.
 */
export function contractLineMismatches(
  line: LineSide,
  contract: ContractSide,
  groupMembers: (rootId: string) => Set<string>,
): ContractLineMismatch[] {
  const out: ContractLineMismatch[] = [];
  if (!sameId(line.paying_company_id, contract.company_id)) {
    out.push(mismatch('paying_company', textOrNull(line.paying_company_name), textOrNull(contract.company_name)));
  }
  if (contract.cost_center_id) {
    const insideGroup = contract.cost_center_kind === 'group'
      && normId(line.cost_center_id) != null
      && groupMembers(contract.cost_center_id).has(normId(line.cost_center_id)!);
    const sameCenter = contract.cost_center_kind === 'group'
      ? insideGroup
      : sameId(line.cost_center_id, contract.cost_center_id);
    if (!sameCenter) {
      out.push(mismatch(
        'cost_center',
        centerLabel(line.cost_center_code, line.cost_center_name),
        centerLabel(contract.cost_center_code, contract.cost_center_name),
      ));
    }
  }
  if (line.supplier_id && !sameId(line.supplier_id, contract.supplier_id)) {
    out.push(mismatch('supplier', textOrNull(line.supplier_name), textOrNull(contract.supplier_name)));
  }
  const lineCurrency = matchCurrency(line.currency);
  const contractCurrency = matchCurrency(contract.currency);
  if (lineCurrency !== contractCurrency) out.push(mismatch('currency', lineCurrency, contractCurrency));
  return out;
}

/** One note per difference for a scalar metadata field. Null when the two records agree. */
export function contractMismatchNote(mismatches: readonly ContractLineMismatch[]): string | null {
  if (mismatches.length === 0) return null;
  return mismatches
    .map((row) => `${row.field}: ${row.line_value ?? '(not set)'} / ${row.contract_value ?? '(not set)'}`)
    .join('; ');
}

function groupMembersOf(tree: AccessTree): (rootId: string) => Set<string> {
  const cache = new Map<string, Set<string>>();
  return (rootId) => {
    let set = cache.get(rootId);
    if (!set) {
      set = new Set(subtreeIds(tree, rootId).map((id) => id.toLowerCase()));
      cache.set(rootId, set);
    }
    return set;
  };
}

async function membersFor(manager: EntityManager, tenantId: string, needsTree: boolean): Promise<(rootId: string) => Set<string>> {
  if (!needsTree) return () => new Set();
  return groupMembersOf(await loadAccessTree(manager, tenantId));
}

const CONTRACT_MATCH_SQL = `SELECT c.id, c.company_id, comp.name AS company_name,
            c.cost_center_id, cc.code AS cost_center_code, cc.name AS cost_center_name, cc.kind AS cost_center_kind,
            c.supplier_id, sup.name AS supplier_name, c.currency
       FROM contracts c
       LEFT JOIN companies comp ON comp.tenant_id = c.tenant_id AND comp.id = c.company_id
       LEFT JOIN cost_centers cc ON cc.tenant_id = c.tenant_id AND cc.id = c.cost_center_id
       LEFT JOIN suppliers sup ON sup.tenant_id = c.tenant_id AND sup.id = c.supplier_id`;

const LINE_MATCH_SQL = `SELECT i.id, i.paying_company_id, comp.name AS paying_company_name,
            i.cost_center_id, cc.code AS cost_center_code, cc.name AS cost_center_name,
            i.supplier_id, sup.name AS supplier_name, i.currency
       FROM spend_items i
       LEFT JOIN companies comp ON comp.tenant_id = i.tenant_id AND comp.id = i.paying_company_id
       LEFT JOIN cost_centers cc ON cc.tenant_id = i.tenant_id AND cc.id = i.cost_center_id
       LEFT JOIN suppliers sup ON sup.tenant_id = i.tenant_id AND sup.id = i.supplier_id`;

async function loadContract(manager: EntityManager, tenantId: string, contractId: string): Promise<ContractSide | null> {
  const rows: ContractSide[] = await manager.query(
    `${CONTRACT_MATCH_SQL} WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, contractId],
  );
  return rows[0] ?? null;
}

async function loadLines(manager: EntityManager, tenantId: string, lineIds: string[]): Promise<LineSide[]> {
  if (lineIds.length === 0) return [];
  return manager.query(
    `${LINE_MATCH_SQL} WHERE i.tenant_id = $1 AND i.id = ANY($2::uuid[])${LINE_NATURES}`,
    [tenantId, lineIds],
  );
}

/**
 * Mismatches of the lines the caller can read against one contract. Null when the contract itself
 * is not readable: the caller then has no value from it. A line the caller cannot read is absent.
 */
export async function lineMismatchesAgainstContract(
  manager: EntityManager,
  tenantId: string,
  contractId: string,
  lineIds: string[],
): Promise<Map<string, ContractLineMismatch[]> | null> {
  const contract = await loadContract(manager, tenantId, contractId);
  if (!contract) return null;
  const lines = await loadLines(manager, tenantId, lineIds);
  const members = await membersFor(manager, tenantId, contract.cost_center_kind === 'group');
  return new Map(lines.map((line) => [line.id, contractLineMismatches(line, contract, members)]));
}

/**
 * Mismatches of the contracts the caller can read against one budget line. Null when the line
 * itself is not readable. A contract the caller cannot read is absent.
 */
export async function contractMismatchesAgainstLine(
  manager: EntityManager,
  tenantId: string,
  lineId: string,
  contractIds: string[],
): Promise<Map<string, ContractLineMismatch[]> | null> {
  const lines = await loadLines(manager, tenantId, [lineId]);
  const line = lines[0];
  if (!line) return null;
  if (contractIds.length === 0) return new Map();
  const contracts: ContractSide[] = await manager.query(
    `${CONTRACT_MATCH_SQL} WHERE c.tenant_id = $1 AND c.id = ANY($2::uuid[])`,
    [tenantId, contractIds],
  );
  const members = await membersFor(manager, tenantId, contracts.some((contract) => contract.cost_center_kind === 'group'));
  return new Map(contracts.map((contract) => [contract.id, contractLineMismatches(line, contract, members)]));
}

export type ConsistencyItem = { id: string; mismatches: ContractLineMismatch[] };

/**
 * Candidates of the contract's budget-line picker. Without the budget right the answer is empty
 * and no line is read. The contract must already have been found under the caller's access.
 */
export async function contractBudgetLineConsistency(
  manager: EntityManager,
  contract: { id: string; tenant_id: string },
  rawIds: unknown,
  readsBudget: boolean,
): Promise<{ items: ConsistencyItem[] }> {
  const ids = parseConsistencyIds(rawIds);
  if (!readsBudget || ids.length === 0) return { items: [] };
  const found = await lineMismatchesAgainstContract(manager, contract.tenant_id, contract.id, ids);
  if (!found) throw new NotFoundException('Contract not found.');
  return { items: ids.filter((id) => found.has(id)).map((id) => ({ id, mismatches: found.get(id)! })) };
}

/**
 * Candidates of the line's contract picker. The line must be readable (404 otherwise, including
 * outside data access). Without the contracts right the answer is empty and no contract is read.
 */
export async function budgetLineContractConsistency(
  manager: EntityManager,
  ref: string,
  rawIds: unknown,
  readsContracts: boolean,
): Promise<{ items: ConsistencyItem[] }> {
  const resolved = await resolveBudgetLine(ref, manager);
  const [row]: Array<{ tenant_id: string }> = await manager.query(
    `SELECT tenant_id FROM spend_items i WHERE i.tenant_id = app_current_tenant() AND i.id = $1${LINE_NATURES}`,
    [resolved.id],
  );
  if (!row) throw new NotFoundException('Budget line not found');
  const ids = parseConsistencyIds(rawIds);
  if (!readsContracts || ids.length === 0) return { items: [] };
  const found = await contractMismatchesAgainstLine(manager, row.tenant_id, resolved.id, ids);
  if (!found) throw new NotFoundException('Budget line not found');
  return { items: ids.filter((id) => found.has(id)).map((id) => ({ id, mismatches: found.get(id)! })) };
}
