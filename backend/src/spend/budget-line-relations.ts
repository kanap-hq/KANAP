import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  applicationParticipantCondition,
  type ParticipationAccessScope,
} from '../auth/business-contributor-scope';
import { setOwnedLink, type OwnedLinkAudit, type OwnedRelationLink } from '../common/relations/owned-link';
import { moduleRightRequired } from '../auth/module-right-required';
import {
  binder,
  listRelatedApplications,
  listRelatedAssets,
  listRelatedContracts,
  listRelatedProjects,
  listRelatedTechnologies,
  type RelatedApplication,
  type RelatedAsset,
  type RelatedContract,
  type RelatedProject,
  type RelatedTechnology,
} from '../common/relations/related-objects';
import { parseTargetId } from '../common/relations/relation-target';
import { resolveBudgetLine } from '../common/resolve-item-id';
import { auditTableOf, linkedLineOf, natureAnd, naturesAnd, BUDGET_NATURES, type BudgetNature } from './budget-nature';
import { assertLinesEditable, isLimitedTransaction } from '../data-access/line-write-checks';
import { contractMismatchesAgainstLine, type ContractLineMismatch } from '../contracts/contract-line-match';

/**
 * The Relations tab of a budget line (OPEX or CAPEX, one table). One round trip lists every
 * section. A section the caller cannot read is null. Contacts, web links and attachments stay
 * on their own routes.
 *
 * Applications, technologies, contracts and projects have no effect on the line's bulk replacement
 * beyond the rows and, for applications and technologies, an audit of the sorted ids on the line.
 * `setOwnedLink` writes one row under the line lock and the same audit. Projects and contracts
 * gained that audit here: their bulk replacement wrote none.
 * An asset link is the asset's own audit (`assets-relations.service.ts`): `recordId` is the asset,
 * `before` and `after` are `{ ids }` of the line ids of this nature. `setOwnedLink` records the
 * owner, so the asset link is written here.
 */

export const BUDGET_LINE_RELATION_KINDS = ['projects', 'applications', 'technologies', 'contracts', 'assets'] as const;
export type BudgetLineRelationKind = (typeof BUDGET_LINE_RELATION_KINDS)[number];

/** The module a section reads. Technologies and assets are the infrastructure. */
export const BUDGET_LINE_RELATION_READS = {
  projects: 'portfolio_projects',
  applications: 'applications',
  technologies: 'infrastructure',
  contracts: 'contracts',
  assets: 'infrastructure',
} as const;

export type BudgetLineRelationsAccess = Record<keyof typeof BUDGET_LINE_RELATION_READS, boolean>;

export type BudgetLineRelationsContext = {
  manager: EntityManager;
  userId: string | null;
  access: BudgetLineRelationsAccess;
  /** A Business Contributor's application scope. Absent for everyone else. */
  applicationScope?: ParticipationAccessScope;
  /** A Business Contributor's project scope. Absent for everyone else. */
  projectScope?: ParticipationAccessScope;
};

/** A suggestion, the contract tab's shape (`via.kind` is the reason, `label` is null). */
export type BudgetLineSuggestion = {
  type: 'application' | 'contract';
  id: string;
  /** `APP-n` for an application. Null for a contract: a contract has no business reference. */
  reference: string | null;
  name: string;
  via: { kind: 'same_supplier'; label: null };
};

/** A contract linked to the line, with the fields that differ from the line (empty when they agree). */
export type BudgetLineContractRow = RelatedContract & { mismatches: ContractLineMismatch[] };

export type BudgetLineRelations = {
  projects: RelatedProject[] | null;
  applications: RelatedApplication[] | null;
  technologies: RelatedTechnology[] | null;
  contracts: BudgetLineContractRow[] | null;
  /** The linked contracts the contracts policy hides from a limited person (spec §5.4). */
  contracts_hidden: number;
  assets: RelatedAsset[] | null;
  suggestions: BudgetLineSuggestion[];
};

type BudgetLineRow = { id: string; tenant_id: string; nature: BudgetNature; supplier_id: string | null };

export type BudgetLineRelationsDeps = {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
};

const PROJECTS = { links: 'portfolio_project_opex', owner: 'opex_id', target: 'project_id' } as const;
const APPLICATIONS = { links: 'application_spend_items', owner: 'spend_item_id', target: 'application_id' } as const;
const TECHNOLOGIES = { links: 'technology_spend_items', owner: 'spend_item_id', target: 'technology_id' } as const;
const CONTRACTS = { links: 'contract_spend_items', owner: 'spend_item_id' } as const;
const ASSETS = { links: 'asset_spend_items', owner: 'spend_item_id', target: 'asset_id' } as const;

const APPLICATIONS_NOT_FOUND = 'One or more applications were not found.';
const TECHNOLOGIES_NOT_FOUND = 'One or more technologies were not found.';
const CONTRACTS_NOT_FOUND = 'One or more contracts not found.';
const PROJECTS_NOT_FOUND = 'One or more projects not found';
const ASSETS_NOT_FOUND = 'One or more assets were not found';
const LINE_NOT_FOUND = 'Budget line not found';

/** At most this many suggestions per rule, the same cap as the contract Relations tab. */
const SUGGESTIONS_PER_RULE = 20;

/** In service, or active: `status` enabled and `disabled_at` unset or still to come. */
const inService = (alias: string) =>
  `${alias}.status = 'enabled' AND (${alias}.disabled_at IS NULL OR ${alias}.disabled_at > now())`;

const BY_NAME = (left: { name: string; id: string }, right: { name: string; id: string }) =>
  left.name.toLowerCase().localeCompare(right.name.toLowerCase()) || left.id.localeCompare(right.id);

const LINE_LINKS: Record<Exclude<BudgetLineRelationKind, 'assets'>, OwnedRelationLink> = {
  projects: {
    table: PROJECTS.links,
    ownerColumn: PROJECTS.owner,
    targetColumn: PROJECTS.target,
    notFound: PROJECTS_NOT_FOUND,
  },
  applications: {
    table: APPLICATIONS.links,
    ownerColumn: APPLICATIONS.owner,
    targetColumn: APPLICATIONS.target,
    notFound: APPLICATIONS_NOT_FOUND,
  },
  technologies: {
    table: TECHNOLOGIES.links,
    ownerColumn: TECHNOLOGIES.owner,
    targetColumn: TECHNOLOGIES.target,
    notFound: TECHNOLOGIES_NOT_FOUND,
  },
  contracts: {
    table: CONTRACTS.links,
    ownerColumn: CONTRACTS.owner,
    targetColumn: 'contract_id',
    notFound: CONTRACTS_NOT_FOUND,
  },
};

export function budgetLineRelationKindOrThrow(value: string): BudgetLineRelationKind {
  if (!(BUDGET_LINE_RELATION_KINDS as readonly string[]).includes(value)) {
    throw new NotFoundException('Unknown relation type.');
  }
  return value as BudgetLineRelationKind;
}

/** The line in the current tenant, by uuid or by its reference (`BL-n`, `OPX-n`, `CPX-n`). */
async function loadBudgetLine(manager: EntityManager, ref: string): Promise<BudgetLineRow> {
  const resolved = await resolveBudgetLine(ref, manager);
  const [line]: Array<BudgetLineRow> = await manager.query(
    `SELECT id, tenant_id, nature, supplier_id
       FROM spend_items
      WHERE tenant_id = app_current_tenant() AND id = $1${naturesAnd(null, BUDGET_NATURES)}`,
    [resolved.id],
  );
  if (!line) throw new NotFoundException(LINE_NOT_FOUND);
  return { ...line, supplier_id: line.supplier_id ?? null };
}

/**
 * The tab in one round trip. The line must exist in the tenant (404 otherwise). Projects and
 * applications follow a Business Contributor's participation. Assets are the links of the line's
 * nature, which the line id already is.
 */
export async function readBudgetLineRelations(
  manager: EntityManager,
  ref: string,
  ctx: Omit<BudgetLineRelationsContext, 'manager' | 'userId'>,
): Promise<BudgetLineRelations> {
  const line = await loadBudgetLine(manager, ref);
  const { access } = ctx;
  // One query after the other: the request's connection runs them in turn.
  const projects = access.projects
    ? await listRelatedProjects(manager, PROJECTS, line.tenant_id, line.id, ctx.projectScope)
    : null;
  const applications = access.applications
    ? await listRelatedApplications(manager, APPLICATIONS, line.tenant_id, line.id, ctx.applicationScope)
    : null;
  const technologies = access.technologies
    ? await listRelatedTechnologies(manager, TECHNOLOGIES, line.tenant_id, line.id)
    : null;
  const linkedContracts = access.contracts
    ? await listRelatedContracts(manager, CONTRACTS, line.tenant_id, line.id)
    : null;
  const contractMismatches = linkedContracts && linkedContracts.length > 0
    ? await contractMismatchesAgainstLine(manager, line.tenant_id, line.id, linkedContracts.map((row) => row.id))
    : null;
  const contracts = linkedContracts
    ? linkedContracts.map((row) => ({ ...row, mismatches: contractMismatches?.get(row.id) ?? [] }))
    : null;
  const contractsHidden = access.contracts ? await hiddenLineContractCount(manager, line.tenant_id, line.id) : 0;
  const assets = access.assets
    ? await listRelatedAssets(manager, ASSETS, line.tenant_id, line.id)
    : null;
  const suggestions = await lineSuggestions(manager, line, ctx);
  return { projects, applications, technologies, contracts, contracts_hidden: contractsHidden, assets, suggestions };
}

/**
 * The contracts linked through `contract_spend_items` that a limited person cannot read (spec §5.4
 * "liste de liens", "et N contrats hors de votre accès"). The link table has no policy, so the
 * count is the links whose contract the contract policy hides; 0 without a query when unscoped.
 */
async function hiddenLineContractCount(manager: EntityManager, tenantId: string, lineId: string): Promise<number> {
  if (!(await isLimitedTransaction(manager))) return 0;
  const [row]: Array<{ n: number }> = await manager.query(
    `SELECT count(DISTINCT l.contract_id)::int AS n
       FROM contract_spend_items l
      WHERE l.tenant_id = $1 AND l.spend_item_id = $2
        AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.tenant_id = l.tenant_id AND c.id = l.contract_id)`,
    [tenantId, lineId],
  );
  return Number(row?.n ?? 0);
}

/**
 * Applications and contracts of the line's supplier that are not linked yet, at most
 * `SUGGESTIONS_PER_RULE` of each, that the caller can read. None when the line has no supplier.
 * An application is in service, offered to a reader of the applications, and inside a Business
 * Contributor's participation scope. A contract is active under the same status rule, offered to
 * a reader of the contracts. Contracts have no participation scope.
 */
async function lineSuggestions(
  manager: EntityManager,
  line: BudgetLineRow,
  ctx: Omit<BudgetLineRelationsContext, 'manager' | 'userId'>,
): Promise<BudgetLineSuggestion[]> {
  if (!line.supplier_id) return [];
  const applications = ctx.access.applications
    ? await suggestApplications(manager, line, line.supplier_id, ctx.applicationScope)
    : [];
  const contracts = ctx.access.contracts ? await suggestContracts(manager, line, line.supplier_id) : [];
  return [...applications, ...contracts].sort(BY_NAME);
}

async function suggestApplications(
  manager: EntityManager,
  line: BudgetLineRow,
  supplierId: string,
  scope: ParticipationAccessScope | undefined,
): Promise<BudgetLineSuggestion[]> {
  const params: unknown[] = [line.tenant_id, line.id, supplierId];
  const bind = binder(params);
  const scopeSql = scope ? `AND ${applicationParticipantCondition('a', bind(scope.userId))}` : '';
  const rows: Array<{ id: string; reference: string; name: string }> = await manager.query(
    `SELECT a.id, a.sequential_id AS reference, a.name
       FROM applications a
      WHERE a.tenant_id = $1 AND a.supplier_id = $3 AND ${inService('a')}
        AND NOT EXISTS (
          SELECT 1 FROM application_spend_items l
           WHERE l.tenant_id = a.tenant_id AND l.spend_item_id = $2 AND l.application_id = a.id
        )
        ${scopeSql}
      ORDER BY lower(a.name), a.id
      LIMIT ${SUGGESTIONS_PER_RULE}`,
    params,
  );
  return rows.map((row) => ({ ...row, type: 'application' as const, via: { kind: 'same_supplier' as const, label: null } }));
}

async function suggestContracts(
  manager: EntityManager,
  line: BudgetLineRow,
  supplierId: string,
): Promise<BudgetLineSuggestion[]> {
  const rows: Array<{ id: string; name: string }> = await manager.query(
    `SELECT c.id, c.name
       FROM contracts c
      WHERE c.tenant_id = $1 AND c.supplier_id = $3 AND ${inService('c')}
        AND NOT EXISTS (
          SELECT 1 FROM contract_spend_items l
           WHERE l.tenant_id = c.tenant_id AND l.spend_item_id = $2 AND l.contract_id = c.id
        )
      ORDER BY lower(c.name), c.id
      LIMIT ${SUGGESTIONS_PER_RULE}`,
    [line.tenant_id, line.id, supplierId],
  );
  return rows.map((row) => ({
    ...row,
    type: 'contract' as const,
    reference: null,
    via: { kind: 'same_supplier' as const, label: null },
  }));
}

/**
 * 400 for an unknown application and for one outside the caller's participation scope.
 * The same message as the line's application replacement, so a hidden row is not revealed.
 */
async function assertApplicationVisible(
  manager: EntityManager,
  tenantId: string,
  id: string,
  scope: ParticipationAccessScope,
): Promise<void> {
  const params: unknown[] = [tenantId, id];
  const bind = binder(params);
  const rows: unknown[] = await manager.query(
    `SELECT 1 FROM applications a
      WHERE a.tenant_id = $1 AND a.id = $2 AND ${applicationParticipantCondition('a', bind(scope.userId))}`,
    params,
  );
  if (rows.length === 0) throw new BadRequestException(APPLICATIONS_NOT_FOUND);
}

/** The audit label of a line link. Technologies keep one table name for both natures. */
function auditLabel(kind: Exclude<BudgetLineRelationKind, 'assets'>, nature: BudgetNature): string {
  if (kind === 'technologies') return TECHNOLOGIES.links;
  return auditTableOf(nature, LINE_LINKS[kind].table);
}

/**
 * Link or unlink one row. A missing read of the target module is 403 before the id is parsed,
 * so a bad id does not reveal the module. A bad id is 400 before a missing line is 404.
 * Linking what is linked, or unlinking what is not, changes nothing and writes no audit row.
 * A Business Contributor cannot add or remove an application or a project they cannot see.
 */
export async function setBudgetLineRelation(
  deps: BudgetLineRelationsDeps,
  kindValue: string,
  ref: string,
  targetId: string,
  add: boolean,
  userId: string | null,
  ctx: Omit<BudgetLineRelationsContext, 'manager' | 'userId'>,
): Promise<{ ok: true; changed: boolean }> {
  const kind = budgetLineRelationKindOrThrow(kindValue);
  if (!ctx.access[kind]) {
    throw moduleRightRequired(
      BUDGET_LINE_RELATION_READS[kind],
      'reader',
      kind === 'technologies' ? 'You cannot read technologies.' : 'You cannot read this module.',
    );
  }
  if (kind === 'assets') return setAssetLink(deps, ref, targetId, add, userId);
  const held = { nature: 'opex' as BudgetNature };
  const audit: OwnedLinkAudit = {
    log: (entry, opts) => deps.audit.log(
      {
        table: auditLabel(kind, held.nature),
        recordId: entry.recordId,
        action: 'update',
        before: entry.before,
        after: entry.after,
        userId: entry.userId,
        // The record is the line (`loadOwner`). The application, technology, contract and project
        // labels are shared with the other side, whose record is the other object: the line names
        // itself as parent from this side.
        parent: { table: 'spend_items', id: entry.recordId },
      },
      opts,
    ),
  };
  return setOwnedLink({
    manager: deps.manager,
    userId,
    kind,
    targetId,
    add,
    allowed: true,
    loadOwner: async () => {
      const line = await loadBudgetLine(deps.manager, ref);
      held.nature = line.nature;
      // Before the lock and the delete: a contributor must not drop a link they cannot see.
      if (kind === 'applications' && ctx.applicationScope) {
        await assertApplicationVisible(deps.manager, line.tenant_id, parseTargetId(targetId), ctx.applicationScope);
      }
      return { id: line.id, tenantId: line.tenant_id };
    },
    owner: { table: 'spend_items', idColumn: 'id' },
    ownerNotFound: LINE_NOT_FOUND,
    link: LINE_LINKS[kind],
    projectScope: kind === 'projects' ? ctx.projectScope : undefined,
    audit,
  });
}

/**
 * Link or unlink one asset of the line. The audit follows the asset's replacement: the link
 * table (the CAPEX label for a CAPEX line), `recordId` the asset, `{ ids }` the sorted line ids
 * of this nature. The asset's replacement logs every call and does not sort; this one logs only
 * when the set changes, and sorts the ids. The line row is locked first.
 */
async function setAssetLink(
  deps: BudgetLineRelationsDeps,
  ref: string,
  targetId: string,
  add: boolean,
  userId: string | null,
): Promise<{ ok: true; changed: boolean }> {
  const assetId = parseTargetId(targetId);
  const line = await loadBudgetLine(deps.manager, ref);
  const lineId = String(line.id).toLowerCase();
  const locked: unknown[] = await deps.manager.query(
    `SELECT 1 FROM spend_items WHERE tenant_id = $1 AND id = $2${natureAnd(null, line.nature)} FOR NO KEY UPDATE`,
    [line.tenant_id, line.id],
  );
  if (locked.length === 0) {
    // A readable line the person may not modify takes no lock: the clear 403, else absent.
    await assertLinesEditable(deps.manager, [line.id]);
    throw new NotFoundException(LINE_NOT_FOUND);
  }
  const exists: unknown[] = await deps.manager.query(
    `SELECT 1 FROM assets WHERE tenant_id = $1 AND id = $2`,
    [line.tenant_id, assetId],
  );
  if (exists.length === 0) throw new BadRequestException(ASSETS_NOT_FOUND);

  const natureSql = linkedLineOf('l.tenant_id', 'l.spend_item_id', line.nature);
  const current: Array<{ id: string }> = await deps.manager.query(
    `SELECT l.spend_item_id AS id FROM asset_spend_items l WHERE l.tenant_id = $1 AND l.asset_id = $2${natureSql}`,
    [line.tenant_id, assetId],
  );
  const before = Array.from(new Set(current.map((row) => String(row.id).toLowerCase()))).sort();
  if (before.includes(lineId) === add) return { ok: true, changed: false };

  const [{ n }]: Array<{ n: number }> = await deps.manager.query(
    add
      ? `WITH c AS (
           INSERT INTO asset_spend_items (tenant_id, asset_id, spend_item_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1
         ) SELECT count(*)::int AS n FROM c`
      : `WITH c AS (
           DELETE FROM asset_spend_items
            WHERE tenant_id = $1 AND asset_id = $2 AND spend_item_id = $3
           RETURNING 1
         ) SELECT count(*)::int AS n FROM c`,
    [line.tenant_id, assetId, line.id],
  );
  if (Number(n) === 0) return { ok: true, changed: false };
  const after = (add ? [...before, lineId] : before.filter((id) => id !== lineId)).sort();
  await deps.audit.log(
    {
      table: auditTableOf(line.nature, ASSETS.links),
      recordId: assetId,
      action: 'update',
      before: { ids: before },
      after: { ids: after },
      userId,
      // The audit row names the asset; the line is the parent this write knows (`ids` may hold several).
      parent: { table: 'spend_items', id: line.id },
    },
    { manager: deps.manager },
  );
  return { ok: true, changed: true };
}
