import { BadRequestException, NotFoundException } from '@nestjs/common';
import { outsideParticipation, moduleRightRequired } from '../../auth/module-right-required';
import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition, ParticipationAccessScope, projectParticipantCondition } from '../../auth/business-contributor-scope';
import { BUDGET_NATURES, linkedLineOf, naturesAnd, type BudgetNature } from '../../spend/budget-nature';
import { assertLinesEditable, DATA_ACCESS_CONTRACT_NOT_FOUND_MESSAGE, isLimitedTransaction } from '../../data-access/line-write-checks';
import { auditedLinkSet, hiddenLineCount, type HiddenLineOwner } from '../../data-access/hidden-links';
import { binder } from './related-objects';
import { parseTargetId } from './relation-target';

/**
 * The kinds `setOwnedLink` writes one row at a time. Incidents stay with their own service.
 * `applications`, `assets`, `technologies` and `processes` are a row of that table in the tenant,
 * or 400 with the caller's `notFound`.
 */
export type OwnedRelationKind = 'budget_lines' | 'contracts' | 'projects' | 'applications' | 'assets' | 'technologies' | 'processes';

/** The module each link reads: a denied `allowed` names it in the coded refusal. */
const OWNED_LINK_RESOURCES: Record<OwnedRelationKind, string> = {
  budget_lines: 'budget',
  contracts: 'contracts',
  projects: 'portfolio_projects',
  applications: 'applications',
  assets: 'infrastructure',
  technologies: 'infrastructure',
  processes: 'business_processes',
};

/** Existence of an application, an asset, a technology or a business process. The table names come only from here. */
/** The owners whose hidden lines `data_access_hidden_count` counts, by their table. */
const HIDDEN_LINE_OWNERS: Record<string, HiddenLineOwner> = {
  applications: 'application',
  assets: 'asset',
  technologies: 'technology',
  portfolio_projects: 'project',
  portfolio_requests: 'request',
};

const ROW_TARGETS = {
  applications: 'applications',
  assets: 'assets',
  technologies: 'technologies',
  processes: 'business_processes',
} as const;

/** The owner row, locked FOR NO KEY UPDATE. Table and column names come from the callers' constants. */
export type OwnedRelationOwner = { table: string; idColumn: string };

/**
 * One link table of the owner. `notFound` is the 400 when the target row is missing.
 * `auditTable` is the audit label when it differs from `table` (a CAPEX line's links keep
 * `application_capex_items`); it receives the line's nature.
 */
export type OwnedRelationLink = {
  table: string;
  ownerColumn: string;
  targetColumn: string;
  notFound: string;
  auditTable?: string | ((nature: BudgetNature) => string);
};

export type OwnedLinkAudit = {
  log: (
    entry: { table: string; recordId: string; action: 'update'; before: unknown; after: unknown; userId: string | null },
    opts: { manager: EntityManager },
  ) => Promise<unknown>;
};

/**
 * The project exists and, when `scope` is set, the caller participates in it.
 * 400 `One or more projects were not found.` otherwise (or `notFound` when given).
 */
export async function assertProjectVisible(
  mg: EntityManager,
  tenantId: string,
  projectId: string,
  scope?: ParticipationAccessScope,
  notFound = 'One or more projects were not found.',
): Promise<void> {
  const params: unknown[] = [tenantId, projectId];
  const bind = binder(params);
  const scopeSql = scope ? `AND ${projectParticipantCondition('p', bind(scope.userId))}` : '';
  const rows: unknown[] = await mg.query(
    `SELECT 1 FROM portfolio_projects p WHERE p.tenant_id = $1 AND p.id = $2 ${scopeSql}`,
    params,
  );
  if (rows.length === 0) throw new BadRequestException(notFound);
}

/**
 * Link (`add`) or unlink one budget line, contract, project, application, asset, technology or
 * business process the owner holds.
 *
 * (1) `allowed` false → 403. (2) A bad target id → 400, before the owner is read.
 * (3) `loadOwner`, then the owner row locked FOR NO KEY UPDATE (a budget line read but not
 * modifiable: 403). (5) A budget line's nature,
 * or 400. (6) A contract's existence. (7) A project's visibility. An application, an asset, a
 * technology or a business process exists in the tenant, or 400 with `notFound`; with
 * `applicationScope`, an application outside the person's participation is 403. (8) The stored set
 * (a budget line: the links of that nature only). (9) Linking what is linked, or unlinking
 * what is not, changes nothing and writes no audit row. Otherwise one INSERT or DELETE and
 * one audit row: `recordId` the owner, before and after the sorted ids.
 *
 * Table and column names come from the callers' constants only. A DELETE through the query
 * runner returns `[rows, count]`: both writes are counted through a CTE.
 */
export async function setOwnedLink(args: {
  manager: EntityManager;
  userId: string | null;
  kind: OwnedRelationKind;
  targetId: string;
  add: boolean;
  /** `ctx.access[kind]`. False → 403 `You cannot read this module.` */
  allowed: boolean;
  /**
   * The owner, resolved after the target id is checked, so a bad id is 400 before a missing
   * owner is 404. Returns the owner's id and the tenant its row carries.
   */
  loadOwner: () => Promise<{ id: string; tenantId: string }>;
  owner: OwnedRelationOwner;
  /** 404 when the locked owner row is missing. */
  ownerNotFound: string;
  link: OwnedRelationLink;
  projectScope?: ParticipationAccessScope;
  /** A Business Contributor's applications: linked and unlinked inside their participation only. */
  applicationScope?: ParticipationAccessScope;
  audit: OwnedLinkAudit;
}): Promise<{ ok: true; changed: boolean }> {
  if (!args.allowed) throw moduleRightRequired(OWNED_LINK_RESOURCES[args.kind], 'reader', 'You cannot read this module.');
  const id = parseTargetId(args.targetId);
  const loaded = await args.loadOwner();
  const tenantId = loaded.tenantId;
  const locked: unknown[] = await args.manager.query(
    `SELECT 1 FROM ${args.owner.table} WHERE tenant_id = $1 AND ${args.owner.idColumn} = $2 FOR NO KEY UPDATE`,
    [tenantId, loaded.id],
  );
  if (locked.length === 0) {
    // The lock passes the UPDATE policy: a budget line the person reads but may not modify takes
    // none. The clear 403 for it (a plain read), else absent (data-scoped access, spec §6.7).
    if (args.owner.table === 'spend_items') await assertLinesEditable(args.manager, [loaded.id]);
    throw new NotFoundException(args.ownerNotFound);
  }

  let nature: BudgetNature | undefined;
  if (args.kind === 'budget_lines') {
    const lines: Array<{ nature: BudgetNature }> = await args.manager.query(
      `SELECT nature FROM spend_items WHERE tenant_id = $1 AND id = $2${naturesAnd(null, BUDGET_NATURES)}`,
      [tenantId, id],
    );
    if (!lines[0]) throw new BadRequestException(args.link.notFound);
    nature = lines[0].nature;
  } else if (args.kind === 'contracts') {
    const rows: unknown[] = await args.manager.query(`SELECT 1 FROM contracts WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    if (rows.length === 0) {
      // A hidden contract answers as a missing one for a limited person; unscoped persons keep the 400.
      if (await isLimitedTransaction(args.manager)) throw new NotFoundException(DATA_ACCESS_CONTRACT_NOT_FOUND_MESSAGE);
      throw new BadRequestException(args.link.notFound);
    }
  } else if (args.kind === 'projects') {
    await assertProjectVisible(args.manager, tenantId, id, args.projectScope, args.link.notFound);
  } else {
    const rows: unknown[] = await args.manager.query(
      `SELECT 1 FROM ${ROW_TARGETS[args.kind]} WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (rows.length === 0) throw new BadRequestException(args.link.notFound);
    if (args.kind === 'applications' && args.applicationScope) {
      const inScope: unknown[] = await args.manager.query(
        `SELECT 1 FROM applications a WHERE a.tenant_id = $1 AND a.id = $2 AND ${applicationParticipantCondition('a', '$3')}`,
        [tenantId, id, args.applicationScope.userId],
      );
      if (inScope.length === 0) throw outsideParticipation('applications', 'You can only link applications you take part in.');
    }
  }

  const scopeSql = nature ? linkedLineOf('l.tenant_id', `l.${args.link.targetColumn}`, nature) : '';
  const current: Array<{ id: string }> = await args.manager.query(
    `SELECT l.${args.link.targetColumn} AS id FROM ${args.link.table} l WHERE l.tenant_id = $1 AND l.${args.link.ownerColumn} = $2${scopeSql}`,
    [tenantId, loaded.id],
  );
  const before = Array.from(new Set(current.map((row) => String(row.id).toLowerCase()))).sort();
  if (before.includes(id) === args.add) return { ok: true, changed: false };

  const [{ n }]: Array<{ n: number }> = await args.manager.query(
    args.add
      ? `WITH c AS (INSERT INTO ${args.link.table} (tenant_id, ${args.link.ownerColumn}, ${args.link.targetColumn}) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1)
         SELECT count(*)::int AS n FROM c`
      : `WITH c AS (DELETE FROM ${args.link.table} WHERE tenant_id = $1 AND ${args.link.ownerColumn} = $2 AND ${args.link.targetColumn} = $3 RETURNING 1)
         SELECT count(*)::int AS n FROM c`,
    [tenantId, loaded.id, id],
  );
  if (Number(n) === 0) return { ok: true, changed: false };
  const after = (args.add ? [...before, id] : before.filter((value) => value !== id)).sort();
  const auditTable = typeof args.link.auditTable === 'function'
    ? args.link.auditTable(nature as BudgetNature)
    : (args.link.auditTable ?? args.link.table);
  // The lines a limited person cannot read stay linked: the audit row says how many (spec §6.6).
  const hiddenOwner = args.kind === 'budget_lines' ? HIDDEN_LINE_OWNERS[args.owner.table] : undefined;
  const hidden = hiddenOwner ? await hiddenLineCount(args.manager, hiddenOwner, loaded.id) : 0;
  await args.audit.log(
    { table: auditTable, recordId: loaded.id, action: 'update', before: auditedLinkSet(before, hidden), after: auditedLinkSet(after, hidden), userId: args.userId },
    { manager: args.manager },
  );
  return { ok: true, changed: true };
}
