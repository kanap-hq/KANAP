import { BadRequestException, NotFoundException } from '@nestjs/common';
import { outsideParticipation, moduleRightRequired } from '../auth/module-right-required';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { singleChangedId } from '../audit/audit-parent-rules';
import { applicationParticipantCondition, resolveBusinessContributorScope, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { LINKED_MODULE_RESOURCES } from '../common/relations/linked-reads';
import { setOwnedLink, type OwnedLinkAudit } from '../common/relations/owned-link';
import { binder } from '../common/relations/related-objects';
import { canReadResource } from '../common/record-usages';
import { idsInScope } from '../portfolio/portfolio-linked-reads';
import { BUDGET_NATURES, naturesAnd } from '../spend/budget-nature';
import { assertLinesEditable, isLimitedTransaction } from '../data-access/line-write-checks';
import { assertContractsEditable } from '../data-access/contract-write-checks';
import { auditedLinkSet } from '../data-access/hidden-links';
import { lineMismatchesAgainstContract, type ContractLineMismatch } from './contract-line-match';

/**
 * What a contract is linked to, from the contract's side: its budget lines of both natures
 * (`contract_spend_items`), its applications (`application_contracts`), its assets
 * (`asset_contracts`) and its technologies (`technology_contracts`). Each set is listed and replaced as a whole,
 * and the Relations tab also reads them in one round trip and links one row at a time. Every statement carries the
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

/** The line a link-set write adds or removes, when exactly one changed: the line's history reads it. */
function singleLineParent(before: unknown, after: unknown): { table: 'spend_items'; id: string } | null {
  const id = singleChangedId(before, after);
  return id ? { table: 'spend_items', id } : null;
}

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
  /** Empty when the line agrees with the contract. Absent from a response that does not list lines. */
  mismatches: ContractLineMismatch[];
};

/**
 * The contract's budget lines (Budget tab), spec §5.4. `items` lists the lines the caller reads,
 * none without the right to read the budget; `hidden` counts the linked lines the list leaves out:
 * those outside a limited person's data access ("and 3 lines outside your access"), never named;
 * without the budget right, nothing is counted. `contract_spend_items` has
 * no data-access policy, so its links count directly: those whose line the policies hide (spec §6.6).
 */
export async function listContractBudgetLines(
  manager: EntityManager,
  contract: RelationsContract,
  readsBudget = true,
): Promise<{ items: ContractBudgetLine[]; hidden: number }> {
  // Without the budget right, the family is neither listed nor counted.
  if (!readsBudget) return { items: [], hidden: 0 };
  const hidden = await hiddenContractLineCount(manager, contract);
  const rows: Array<ContractBudgetLine & { item_number: number | string | null }> = await manager.query(
    `SELECT i.id, i.nature, i.item_number, i.product_name, i.paying_company_id AS company_id, comp.name AS company_name
       FROM contract_spend_items l
       JOIN spend_items i ON i.tenant_id = l.tenant_id AND i.id = l.spend_item_id${LINE_NATURES}
       LEFT JOIN companies comp ON comp.tenant_id = i.tenant_id AND comp.id = i.paying_company_id
      WHERE l.tenant_id = $1 AND l.contract_id = $2
      ORDER BY i.item_number ASC NULLS LAST, i.id ASC`,
    [contract.tenant_id, contract.id],
  );
  const items = rows.map((row) => ({ ...row, item_number: row.item_number == null ? null : Number(row.item_number) }));
  const mismatches = items.length === 0
    ? null
    : await lineMismatchesAgainstContract(manager, contract.tenant_id, contract.id, items.map((row) => row.id));
  return {
    items: items.map((row) => ({ ...row, mismatches: mismatches?.get(row.id) ?? [] })),
    hidden,
  };
}

/** The contract's links to lines a limited person cannot read; 0 for an unscoped person, without a query. */
export async function hiddenContractLineCount(manager: EntityManager, contract: RelationsContract): Promise<number> {
  if (!(await isLimitedTransaction(manager))) return 0;
  const [row]: Array<{ n: number }> = await manager.query(
    `SELECT count(*)::int AS n FROM contract_spend_items l
      WHERE l.tenant_id = $1 AND l.contract_id = $2
        AND NOT EXISTS (SELECT 1 FROM spend_items i WHERE i.tenant_id = l.tenant_id AND i.id = l.spend_item_id)`,
    [contract.tenant_id, contract.id],
  );
  return Number(row?.n ?? 0);
}

/** With `scope` (a Business Contributor), the applications they take part in only. */
export async function listContractApplications(
  manager: EntityManager,
  contract: RelationsContract,
  scope?: ParticipationAccessScope,
): Promise<{ items: Array<{ id: string; name: string }> }> {
  const params: unknown[] = [contract.tenant_id, contract.id];
  const items: Array<{ id: string; name: string }> = await manager.query(
    `SELECT a.id, a.name
       FROM application_contracts l
       JOIN applications a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
      WHERE l.tenant_id = $1 AND l.contract_id = $2${applicationScopeSql('a', params, scope)}
      ORDER BY a.name ASC, a.id ASC`,
    params,
  );
  return { items };
}

/** ` AND <participation>` on the applications alias for a Business Contributor; '' for everyone else. */
function applicationScopeSql(alias: string, params: unknown[], scope: ParticipationAccessScope | undefined): string {
  return scope ? ` AND ${applicationParticipantCondition(alias, binder(params)(scope.userId))}` : '';
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
 * contract, before and after the sorted ids. With `applicationScope` (a Business Contributor, the
 * applications set), the set is the applications they take part in: the others stay linked and
 * are counted in the audit row (`hidden_kept`), and adding one outside it is refused (403).
 */
export async function replaceContractRelations(
  deps: ContractRelationsDeps,
  set: ContractRelationSet,
  contract: RelationsContract,
  ids: string[],
  userId: string | null,
  applicationScope?: ParticipationAccessScope,
): Promise<{ ok: true; added: number; removed: number }> {
  const { manager } = deps;
  const t = SETS[set];
  // Stored ids are lower case: an upper-case id must compare equal to its stored twin.
  const nextIds = Array.from(new Set((ids || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))).sort();
  if (nextIds.some((id) => !UUID_RE.test(id))) throw new BadRequestException(t.notFound);
  // A contract read but not modifiable: the clear 403 before the row lock (which the UPDATE policy
  // would hide, answering as a missing contract) and before the link writes.
  await assertContractsEditable(manager, [contract.id]);
  const locked = await manager.query(
    `SELECT 1 FROM contracts WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
    [contract.tenant_id, contract.id],
  );
  if (locked.length === 0) throw new NotFoundException('Contract not found.');
  const current: Array<{ other_id: string }> = await manager.query(
    `SELECT DISTINCT l.${t.otherFk} AS other_id FROM ${t.links} l WHERE l.tenant_id = $1 AND l.contract_id = $2${t.linkScope}`,
    [contract.tenant_id, contract.id],
  );
  const scope = set === 'applications' ? applicationScope : undefined;
  const storedIds = current.map((row) => row.other_id);
  // A Business Contributor replaces the applications they see; the others are left as they are.
  const visible = scope ? await idsInScope(manager, 'applications', storedIds, scope) : null;
  const beforeIds = (visible ? storedIds.filter((id) => visible.has(id)) : storedIds).sort();
  const hiddenKept = storedIds.length - beforeIds.length;
  const removed = beforeIds.filter((id) => !nextIds.includes(id));
  const added = nextIds.filter((id) => !beforeIds.includes(id));

  if (nextIds.length) {
    const found: Array<{ id: string }> = await manager.query(t.exists, [contract.tenant_id, nextIds]);
    if (found.length !== nextIds.length) {
      // A hidden line answers as a missing one for a limited person; unscoped persons keep the 400.
      if (set === 'budget_lines' && await isLimitedTransaction(manager)) throw new NotFoundException('Budget line not found.');
      throw new BadRequestException(t.notFound);
    }
    // A line read but not modifiable: the clear 403 before the link INSERT policy refuses it. A
    // line that stays linked is not checked again: the replacement never rewrites its link.
    if (set === 'budget_lines') await assertLinesEditable(manager, added);
    if (scope && added.length) {
      const inScope = await idsInScope(manager, 'applications', added, scope);
      if (added.some((id) => !inScope.has(id))) throw outsideParticipation('applications', OUTSIDE_PARTICIPATION);
    }
  }

  let removedCount = removed.length;
  if (removed.length) {
    if (set === 'budget_lines') {
      // Deleting a link is a write on its line too: a read-only line refuses it (the link trigger).
      await assertLinesEditable(manager, removed);
      // Only the links to the lines the person reads: the join is filtered by the line policy.
      const [row]: Array<{ n: number }> = await manager.query(
        `WITH removed AS (
           DELETE FROM contract_spend_items l
            USING spend_items i
            WHERE l.tenant_id = $1 AND l.contract_id = $2
              AND i.tenant_id = l.tenant_id AND i.id = l.spend_item_id
              AND i.nature IN (${BUDGET_NATURES.map((nature) => `'${nature}'`).join(', ')})
              AND NOT (l.spend_item_id = ANY($3::uuid[]))
            RETURNING 1
         ) SELECT count(*)::int AS n FROM removed`,
        [contract.tenant_id, contract.id, nextIds],
      );
      removedCount = Number(row?.n ?? 0);
    } else {
      await manager.query(
        `DELETE FROM ${t.links} WHERE tenant_id = $1 AND contract_id = $2 AND ${t.otherFk} = ANY($3::uuid[])`,
        [contract.tenant_id, contract.id, removed],
      );
    }
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
    // The lines a limited person cannot read stayed linked: the audit row says how many (spec §6.6).
    // A Business Contributor's replacement keeps the applications outside their participation, counted the same way.
    const hidden = set === 'budget_lines' ? await hiddenContractLineCount(manager, contract) : hiddenKept;
    await deps.audit.log(
      {
        table: t.links,
        recordId: contract.id,
        action: 'update',
        before: auditedLinkSet({ ids: beforeIds }, hidden),
        after: auditedLinkSet({ ids: nextIds }, hidden),
        userId,
        // The line the set gained or lost, when the write changes exactly one: the line's history
        // reads this row. A replacement of two lines names no parent.
        ...(set === 'budget_lines' ? { parent: singleLineParent(beforeIds, nextIds) } : {}),
      },
      { manager },
    );
  }
  return { ok: true, added: added.length, removed: removedCount };
}

/**
 * The tab badges of a contract's page: its budget lines, and what its Relations tab shows. Each
 * family is counted, and enters `relations`, only as the tab shows it (`access`): the applications
 * for a reader of the applications (a Business Contributor's: those they take part in), the assets
 * and technologies for a reader of the infrastructure; `null` otherwise.
 */
export async function contractRelationCounts(manager: EntityManager, contract: RelationsContract, access: ContractRelationsAccess) {
  const params: unknown[] = [contract.tenant_id, contract.id];
  const scoped = access.applicationScope
    ? ` AND EXISTS (SELECT 1 FROM applications a WHERE a.tenant_id = l.tenant_id AND a.id = l.application_id${applicationScopeSql('a', params, access.applicationScope)})`
    : '';
  const [row]: Array<Record<string, string | number>> = await manager.query(
    `SELECT
       (SELECT count(*) FROM contract_spend_items l WHERE l.tenant_id = $1 AND l.contract_id = $2${SETS.budget_lines.linkScope}) AS budget_lines,
       (SELECT count(*) FROM application_contracts l WHERE l.tenant_id = $1 AND l.contract_id = $2${scoped}) AS applications,
       (SELECT count(*) FROM asset_contracts l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS assets,
       (SELECT count(*) FROM technology_contracts l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS technologies,
       (SELECT count(*) FROM contract_contacts l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS contacts,
       (SELECT count(*) FROM contract_links l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS links,
       (SELECT count(*) FROM contract_attachments l WHERE l.tenant_id = $1 AND l.contract_id = $2) AS attachments`,
    params,
  );
  const n = (key: string) => Number(row?.[key] ?? 0);
  const applications = access.applications ? n('applications') : null;
  const assets = access.infrastructure ? n('assets') : null;
  const technologies = access.infrastructure ? n('technologies') : null;
  const relations = (applications ?? 0) + (assets ?? 0) + (technologies ?? 0) + n('contacts') + n('links') + n('attachments');
  return {
    budget_lines: n('budget_lines'),
    applications,
    assets,
    technologies,
    contacts: n('contacts'),
    links: n('links'),
    attachments: n('attachments'),
    relations,
  };
}

/** The kinds the Relations tab links one at a time. */
export const CONTRACT_TAB_KINDS = ['applications', 'assets', 'technologies'] as const;
export type ContractTabKind = (typeof CONTRACT_TAB_KINDS)[number];

/** At most this many suggestions per rule, the same cap as the applications' Relations tab. */
const SUGGESTIONS_PER_RULE = 20;

/**
 * An application in service: the same rule as the application suggestions and `inServiceSql`
 * (`status` enabled, `disabled_at` unset or still to come).
 */
const applicationInService = (alias: string) =>
  `${alias}.status = 'enabled' AND (${alias}.disabled_at IS NULL OR ${alias}.disabled_at > now())`;

/** An asset that is not retired (`retired` is the locked lifecycle code, `assetInServiceSql`). */
const assetInService = (alias: string) => `${alias}.status IS DISTINCT FROM 'retired'`;

export type ContractRelatedApplication = {
  id: string;
  /** `APP-n`. */
  reference: string;
  name: string;
  lifecycle: string;
  business_criticality: string | null;
  status: string;
};

export type ContractRelatedAsset = {
  id: string;
  /** `AST-n`. */
  reference: string;
  name: string;
  kind: string;
  environment: string;
  status: string;
};

export type ContractRelatedTechnology = {
  id: string;
  /** `TEC-n`. */
  reference: string;
  name: string;
  family: string;
  /** The technology's editor. */
  vendor: string | null;
};

/** A suggestion, the same shape as the applications' (`via.kind` is the reason, `label` is null). */
export type ContractRelationSuggestion = {
  type: 'application' | 'asset';
  id: string;
  reference: string;
  name: string;
  via: { kind: 'same_supplier'; label: string | null };
};

export type ContractRelationsTab = {
  /** Null when the caller cannot read the applications. */
  applications: ContractRelatedApplication[] | null;
  /** Null when the caller cannot read the infrastructure. */
  assets: ContractRelatedAsset[] | null;
  /** Null when the caller cannot read the infrastructure. */
  technologies: ContractRelatedTechnology[] | null;
  suggestions: ContractRelationSuggestion[];
};

/**
 * What a contract's caller may see of its linked records, as on their own pages: a family whose
 * module the caller does not read is left out, with no counter.
 */
export type ContractRelationsAccess = {
  /** The caller reads the infrastructure: the assets and technologies, and the asset suggestions. */
  infrastructure: boolean;
  /** The caller reads the applications: the linked applications, and the application suggestions. */
  applications: boolean;
  /** A Business Contributor's application scope: the applications they take part in. Absent for everyone else. */
  applicationScope?: ParticipationAccessScope;
};

/** The caller's access, from a request past the permission guard. */
export async function contractRelationsAccess(req: any): Promise<ContractRelationsAccess> {
  const applications = canReadResource(req ?? {}, LINKED_MODULE_RESOURCES.applications);
  return {
    infrastructure: canReadResource(req ?? {}, LINKED_MODULE_RESOURCES.assets),
    applications,
    applicationScope: applications ? await resolveBusinessContributorScope(req, 'applications') : undefined,
  };
}

/**
 * A write on one family of the Relations tab needs a read of its module, even an empty replacement
 * (it would remove links the caller does not see): 403 otherwise.
 */
export function assertContractRelationRead(req: any, kind: ContractTabKind): void {
  if (!canReadResource(req ?? {}, LINKED_MODULE_RESOURCES[kind])) {
    throw moduleRightRequired(LINKED_MODULE_RESOURCES[kind], 'reader', `You cannot read ${kind}.`);
  }
}

const OUTSIDE_PARTICIPATION = 'You can only link applications you take part in.';

const BY_NAME = (left: { name: string; id: string }, right: { name: string; id: string }) =>
  left.name.toLowerCase().localeCompare(right.name.toLowerCase()) || left.id.localeCompare(right.id);

/**
 * The Relations tab in one round trip: the linked applications (null without a read of the
 * applications; a Business Contributor's: those they take part in), assets and technologies (null
 * without a read of the infrastructure), and suggestions of the contract's supplier. Web links,
 * attachments and contacts stay on their own routes. Ordered by name.
 */
export async function readContractRelations(
  manager: EntityManager,
  contract: RelationsContract & { supplier_id: string | null },
  opts: ContractRelationsAccess,
): Promise<ContractRelationsTab> {
  const appParams: unknown[] = [contract.tenant_id, contract.id];
  const applications: ContractRelatedApplication[] | null = opts.applications
    ? await manager.query(
      `SELECT a.id, a.sequential_id AS reference, a.name, a.lifecycle, a.criticality AS business_criticality, a.status::text AS status
         FROM application_contracts l
         JOIN applications a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
        WHERE l.tenant_id = $1 AND l.contract_id = $2${applicationScopeSql('a', appParams, opts.applicationScope)}
        ORDER BY lower(a.name), a.id`,
      appParams,
    )
    : null;
  const assets: ContractRelatedAsset[] | null = opts.infrastructure
    ? await manager.query(
      `SELECT a.id, a.asset_reference AS reference, a.name, a.kind, a.environment, a.status
         FROM asset_contracts l
         JOIN assets a ON a.tenant_id = l.tenant_id AND a.id = l.asset_id
        WHERE l.tenant_id = $1 AND l.contract_id = $2
        ORDER BY lower(a.name), a.id`,
      [contract.tenant_id, contract.id],
    )
    : null;
  const technologies: ContractRelatedTechnology[] | null = opts.infrastructure
    ? await manager.query(
      `SELECT t.id, 'TEC-' || t.item_number AS reference, t.name, t.family, t.editor AS vendor
         FROM technology_contracts l
         JOIN technologies t ON t.tenant_id = l.tenant_id AND t.id = l.technology_id
        WHERE l.tenant_id = $1 AND l.contract_id = $2
        ORDER BY lower(t.name), t.id`,
      [contract.tenant_id, contract.id],
    )
    : null;
  const suggestions = await contractSuggestions(manager, contract, opts);
  return { applications, assets, technologies, suggestions };
}

/**
 * Applications and assets of the contract's supplier that are not linked yet, at most
 * `SUGGESTIONS_PER_RULE` of each, that the caller can read. None when the contract has no supplier.
 * An application is in service, offered only to a reader of the applications, and inside a
 * Business Contributor's participation scope. An asset
 * is not retired, and is offered only to a reader of the infrastructure.
 */
async function contractSuggestions(
  manager: EntityManager,
  contract: RelationsContract & { supplier_id: string | null },
  opts: ContractRelationsAccess,
): Promise<ContractRelationSuggestion[]> {
  if (!contract.supplier_id) return [];
  const supplierId = contract.supplier_id;
  const applications = opts.applications ? await suggestApplications(manager, contract, supplierId, opts.applicationScope) : [];
  const assets = opts.infrastructure ? await suggestAssets(manager, contract, supplierId) : [];
  return [...applications, ...assets].sort(BY_NAME);
}

async function suggestApplications(
  manager: EntityManager,
  contract: RelationsContract,
  supplierId: string,
  scope: ParticipationAccessScope | undefined,
): Promise<ContractRelationSuggestion[]> {
  const params: unknown[] = [contract.tenant_id, contract.id, supplierId];
  const bind = binder(params);
  const scopeSql = scope ? `AND ${applicationParticipantCondition('a', bind(scope.userId))}` : '';
  const rows: Array<{ id: string; reference: string; name: string }> = await manager.query(
    `SELECT a.id, a.sequential_id AS reference, a.name
       FROM applications a
      WHERE a.tenant_id = $1 AND a.supplier_id = $3 AND ${applicationInService('a')}
        AND NOT EXISTS (
          SELECT 1 FROM application_contracts l
           WHERE l.tenant_id = a.tenant_id AND l.contract_id = $2 AND l.application_id = a.id
        )
        ${scopeSql}
      ORDER BY lower(a.name), a.id
      LIMIT ${SUGGESTIONS_PER_RULE}`,
    params,
  );
  return rows.map((row) => ({ ...row, type: 'application' as const, via: { kind: 'same_supplier' as const, label: null } }));
}

async function suggestAssets(
  manager: EntityManager,
  contract: RelationsContract,
  supplierId: string,
): Promise<ContractRelationSuggestion[]> {
  const rows: Array<{ id: string; reference: string; name: string }> = await manager.query(
    `SELECT a.id, a.asset_reference AS reference, a.name
       FROM assets a
       JOIN asset_support_info s ON s.tenant_id = a.tenant_id AND s.asset_id = a.id
      WHERE a.tenant_id = $1 AND s.vendor_id = $3 AND ${assetInService('a')}
        AND NOT EXISTS (
          SELECT 1 FROM asset_contracts l
           WHERE l.tenant_id = a.tenant_id AND l.contract_id = $2 AND l.asset_id = a.id
        )
      ORDER BY lower(a.name), a.id
      LIMIT ${SUGGESTIONS_PER_RULE}`,
    [contract.tenant_id, contract.id, supplierId],
  );
  return rows.map((row) => ({ ...row, type: 'asset' as const, via: { kind: 'same_supplier' as const, label: null } }));
}

export function contractRelationKindOrThrow(value: string): ContractTabKind {
  if (!(CONTRACT_TAB_KINDS as readonly string[]).includes(value)) throw new NotFoundException('Unknown relation type.');
  return value as ContractTabKind;
}

/**
 * Link or unlink one application, asset or technology. The contract's row is locked (FOR NO KEY
 * UPDATE). The audit row matches `replaceContractRelations`: the link table, `recordId` the
 * contract, `before` and `after` `{ ids }` of the sorted ids. Linking what is linked, or unlinking
 * what is not, changes nothing and writes no audit row. With `applicationScope` (a Business
 * Contributor), an application outside their participation is neither linked nor unlinked (403).
 */
export async function setContractRelation(
  deps: ContractRelationsDeps,
  kind: ContractTabKind,
  targetId: string,
  add: boolean,
  userId: string | null,
  loadOwner: () => Promise<{ id: string; tenantId: string }>,
  applicationScope?: ParticipationAccessScope,
): Promise<{ ok: true; changed: boolean }> {
  const set = SETS[kind];
  const audit: OwnedLinkAudit = {
    log: (entry, opts) => deps.audit.log(
      {
        table: entry.table,
        recordId: entry.recordId,
        action: 'update',
        before: { ids: entry.before },
        after: { ids: entry.after },
        userId: entry.userId,
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
    loadOwner,
    owner: { table: 'contracts', idColumn: 'id' },
    ownerNotFound: 'Contract not found.',
    link: { table: set.links, ownerColumn: 'contract_id', targetColumn: set.otherFk, notFound: set.notFound },
    applicationScope: kind === 'applications' ? applicationScope : undefined,
    audit,
  });
}
