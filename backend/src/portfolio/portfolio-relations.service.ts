import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { setOwnedLink } from '../common/relations/owned-link';
import { binder, type RelationLinkTable } from '../common/relations/related-objects';
import { parseTargetId } from '../common/relations/relation-target';
import { readRelationsBudgetColumn } from '../common/relations/relations-budget-column';
import {
  listRelatedApplications,
  listRelatedAssets,
  listRelatedBudgetLines,
  listRelatedBusinessProcesses,
  listRelatedPortfolioItems,
  listRelatedTechnologies,
  type RelatedApplication,
  type RelatedAsset,
  type RelatedBudgetLine,
  type RelatedBusinessProcess,
  type RelatedPortfolioItem,
  type RelatedTechnology,
} from '../common/relations/related-objects';
import { FxRateService } from '../currency/fx-rate.service';
import { BUDGET_NATURES, linkedLineOf, naturesAnd, type BudgetNature } from '../spend/budget-nature';
import { lockProject } from './project-budget-links.util';
import { PortfolioRequestsService } from './portfolio-requests.service';
import { PortfolioProjectsService } from './services/portfolio-projects.service';

/**
 * The Relations tab of a portfolio project (lot R2c). One round trip lists every section.
 * A section the caller cannot read is null.
 *
 * Applications, assets and budget lines keep the activity their bulk replacement already writes
 * (`portfolio_activities`). The stored set is read under the project row lock and replaced with
 * that set plus or minus one id, so a link the caller cannot see stays. The line's nature chooses
 * the OPEX or the CAPEX replacement (`project-budget-links.util.ts`).
 * A technology has no such effect: `setOwnedLink` writes one row and one audit entry on
 * `technology_projects`. Source requests are read only: the conversion of a request writes them.
 *
 * A request's applications, assets and budget lines keep the same activity, through the request's
 * own replacement, under a lock of the request row. Its business processes have no activity on
 * that replacement: `setOwnedLink` writes one row and one audit entry on
 * `portfolio_request_business_processes`. Resulting projects are read only.
 */

export const PROJECT_RELATION_KINDS = ['budget_lines', 'applications', 'assets', 'technologies'] as const;
export type ProjectRelationKind = (typeof PROJECT_RELATION_KINDS)[number];

/** The module a section reads. Assets and technologies are the infrastructure. */
export const PROJECT_RELATION_READS = {
  budget_lines: 'budget',
  applications: 'applications',
  assets: 'infrastructure',
  technologies: 'infrastructure',
  source_requests: 'portfolio_requests',
} as const;

export type ProjectRelationsAccess = Record<keyof typeof PROJECT_RELATION_READS, boolean>;

export type ProjectRelationsContext = {
  manager: EntityManager;
  tenantId: string;
  userId: string | null;
  access: ProjectRelationsAccess;
  /** A Business Contributor's application scope. Absent for everyone else. */
  applicationScope?: ParticipationAccessScope;
  /** A Business Contributor's request scope, for the source requests. */
  requestScope?: ParticipationAccessScope;
};

export type ProjectRelations = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: RelatedBudgetLine[] | null;
  applications: RelatedApplication[] | null;
  assets: RelatedAsset[] | null;
  technologies: RelatedTechnology[] | null;
  source_requests: RelatedPortfolioItem[] | null;
};

const PROJECT_LINES = { links: 'portfolio_project_opex', owner: 'project_id', target: 'opex_id' };
const PROJECT_APPLICATIONS = { links: 'application_projects', owner: 'project_id', target: 'application_id' };
const PROJECT_ASSETS = { links: 'asset_projects', owner: 'project_id', target: 'asset_id' };
const PROJECT_TECHNOLOGIES = { links: 'technology_projects', owner: 'project_id', target: 'technology_id' };
const PROJECT_SOURCE_REQUESTS = { links: 'portfolio_request_projects', owner: 'project_id', target: 'request_id' };

/** The refusal the project's own bulk replacement already uses. */
const APPLICATIONS_NOT_FOUND = 'One or more applications were not found';
const ASSETS_NOT_FOUND = 'One or more assets were not found';
const BUDGET_LINE_NOT_FOUND = 'Budget line not found.';
const TECHNOLOGY_NOT_FOUND = 'One or more technologies not found.';

const TECHNOLOGY_LINK = {
  table: 'technology_projects',
  ownerColumn: 'project_id',
  targetColumn: 'technology_id',
  notFound: TECHNOLOGY_NOT_FOUND,
} as const;

export const REQUEST_RELATION_KINDS = ['budget_lines', 'applications', 'assets', 'processes'] as const;
export type RequestRelationKind = (typeof REQUEST_RELATION_KINDS)[number];

/** The module a request section reads. */
export const REQUEST_RELATION_READS = {
  budget_lines: 'budget',
  applications: 'applications',
  assets: 'infrastructure',
  processes: 'business_processes',
  resulting_projects: 'portfolio_projects',
} as const;

export type RequestRelationsAccess = Record<keyof typeof REQUEST_RELATION_READS, boolean>;

export type RequestRelationsContext = {
  manager: EntityManager;
  tenantId: string;
  userId: string | null;
  access: RequestRelationsAccess;
  /** `business_processes:member`. A process link needs it on top of the read. */
  writes: { processes: boolean };
  /** A Business Contributor's application scope. Absent for everyone else. */
  applicationScope?: ParticipationAccessScope;
  /** A Business Contributor's project scope, for the projects the request produced. */
  projectScope?: ParticipationAccessScope;
};

export type RequestRelations = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: RelatedBudgetLine[] | null;
  applications: RelatedApplication[] | null;
  assets: RelatedAsset[] | null;
  processes: RelatedBusinessProcess[] | null;
  resulting_projects: RelatedPortfolioItem[] | null;
};

const REQUEST_LINES = { links: 'portfolio_request_opex', owner: 'request_id', target: 'opex_id' };
const REQUEST_APPLICATIONS = { links: 'portfolio_request_applications', owner: 'request_id', target: 'application_id' };
const REQUEST_ASSETS = { links: 'portfolio_request_assets', owner: 'request_id', target: 'asset_id' };
const REQUEST_PROCESSES = { links: 'portfolio_request_business_processes', owner: 'request_id', target: 'business_process_id' };
const REQUEST_PROJECTS = { links: 'portfolio_request_projects', owner: 'request_id', target: 'project_id' };

const PROCESSES_NOT_FOUND = 'One or more business processes were not found.';

const PROCESS_LINK = {
  table: 'portfolio_request_business_processes',
  ownerColumn: 'request_id',
  targetColumn: 'business_process_id',
  notFound: PROCESSES_NOT_FOUND,
} as const;

export function projectRelationKindOrThrow(value: string): ProjectRelationKind {
  if (!(PROJECT_RELATION_KINDS as readonly string[]).includes(value)) throw new NotFoundException('Unknown relation type.');
  return value as ProjectRelationKind;
}

export function requestRelationKindOrThrow(value: string): RequestRelationKind {
  if (!(REQUEST_RELATION_KINDS as readonly string[]).includes(value)) throw new NotFoundException('Unknown relation type.');
  return value as RequestRelationKind;
}

@Injectable()
export class PortfolioRelationsService {
  constructor(
    private readonly projects: PortfolioProjectsService,
    private readonly requests: PortfolioRequestsService,
    private readonly fxRates: FxRateService,
    private readonly audit: AuditService,
  ) {}

  /** The tab in one round trip. The project must exist in the tenant (404 otherwise). */
  async getProjectRelations(projectId: string, ctx: ProjectRelationsContext): Promise<ProjectRelations> {
    const mg = ctx.manager;
    const project = await this.readProject(mg, ctx.tenantId, projectId);
    const tenantId = project.tenant_id;
    const { year, measure, budget_column } = await readRelationsBudgetColumn(mg, tenantId);
    // One query after the other: the request's connection runs them in turn.
    const budgetLines = ctx.access.budget_lines
      ? await listRelatedBudgetLines(mg, this.fxRates, PROJECT_LINES, tenantId, project.id, year, measure)
      : null;
    const applications = ctx.access.applications
      ? await listRelatedApplications(mg, PROJECT_APPLICATIONS, tenantId, project.id, ctx.applicationScope)
      : null;
    const assets = ctx.access.assets ? await listRelatedAssets(mg, PROJECT_ASSETS, tenantId, project.id) : null;
    const technologies = ctx.access.technologies
      ? await listRelatedTechnologies(mg, PROJECT_TECHNOLOGIES, tenantId, project.id)
      : null;
    const sourceRequests = ctx.access.source_requests
      ? await listRelatedPortfolioItems(mg, PROJECT_SOURCE_REQUESTS, 'portfolio_requests', tenantId, project.id, ctx.requestScope)
      : null;
    return {
      year,
      budget_column,
      budget_lines: budgetLines,
      applications,
      assets,
      technologies,
      source_requests: sourceRequests,
    };
  }

  /**
   * Link or unlink one row. `loadOwner` runs after the target id is checked, so a bad id is 400
   * before a missing project is 404. Linking what is linked, or unlinking what is not, changes
   * nothing and writes no activity and no audit row.
   */
  async setProjectLink(
    kind: ProjectRelationKind,
    targetId: string,
    add: boolean,
    ctx: ProjectRelationsContext,
    loadOwner: () => Promise<{ id: string; tenantId: string }>,
  ): Promise<{ ok: true; changed: boolean }> {
    if (!ctx.access[kind]) {
      throw new ForbiddenException(kind === 'technologies' ? 'You cannot read technologies.' : 'You cannot read this module.');
    }
    if (kind === 'technologies') {
      return setOwnedLink({
        manager: ctx.manager,
        userId: ctx.userId,
        kind,
        targetId,
        add,
        allowed: true,
        loadOwner,
        owner: { table: 'portfolio_projects', idColumn: 'id' },
        ownerNotFound: 'Project not found',
        link: TECHNOLOGY_LINK,
        audit: this.audit,
      });
    }
    const id = parseTargetId(targetId);
    const owner = await loadOwner();
    const mg = ctx.manager;
    if (!(await lockProject(mg, owner.tenantId, owner.id))) throw new NotFoundException('Project not found');
    if (kind === 'budget_lines') return this.setProjectBudgetLine(mg, owner.tenantId, owner.id, id, add, ctx.userId);
    if (kind === 'applications') {
      await this.assertApplicationVisible(mg, owner.tenantId, id, ctx.applicationScope);
      const current = await this.linkIds(mg, PROJECT_APPLICATIONS, owner.tenantId, owner.id);
      return this.replaceOne(current, id, add, (next) => this.projects.bulkReplaceLinkedApplications(owner.id, next, { manager: mg, userId: ctx.userId }));
    }
    await this.assertAssetExists(mg, owner.tenantId, id);
    const current = await this.linkIds(mg, PROJECT_ASSETS, owner.tenantId, owner.id);
    return this.replaceOne(current, id, add, (next) => this.projects.bulkReplaceLinkedAssets(owner.id, next, { manager: mg, userId: ctx.userId }));
  }

  private async readProject(mg: EntityManager, tenantId: string, projectId: string): Promise<{ id: string; tenant_id: string }> {
    const rows: Array<{ id: string; tenant_id: string }> = await mg.query(
      `SELECT id, tenant_id FROM portfolio_projects WHERE tenant_id = $1 AND id = $2`,
      [tenantId, projectId],
    );
    if (!rows[0]) throw new NotFoundException('Project not found');
    return rows[0];
  }

  /** The line's nature, or 400. The link is then written by the replacement of that nature only. */
  private async setProjectBudgetLine(
    mg: EntityManager,
    tenantId: string,
    projectId: string,
    id: string,
    add: boolean,
    userId: string | null,
  ): Promise<{ ok: true; changed: boolean }> {
    const nature = await this.budgetNature(mg, tenantId, id);
    if (!nature) throw new BadRequestException(BUDGET_LINE_NOT_FOUND);
    const current = await this.linkIds(mg, PROJECT_LINES, tenantId, projectId, linkedLineOf('l.tenant_id', 'l.opex_id', nature));
    const replace = nature === 'opex'
      ? (next: string[]) => this.projects.bulkReplaceOpex(projectId, next, { manager: mg, userId })
      : (next: string[]) => this.projects.bulkReplaceCapex(projectId, next, { manager: mg, userId });
    return this.replaceOne(current, id, add, replace);
  }

  private async budgetNature(mg: EntityManager, tenantId: string, id: string): Promise<BudgetNature | null> {
    const rows: Array<{ nature: BudgetNature }> = await mg.query(
      `SELECT nature FROM spend_items WHERE tenant_id = $1 AND id = $2${naturesAnd(null, BUDGET_NATURES)}`,
      [tenantId, id],
    );
    return rows[0]?.nature ?? null;
  }

  /** 400 for an unknown application and for one outside the caller's participation scope. */
  private async assertApplicationVisible(
    mg: EntityManager,
    tenantId: string,
    id: string,
    scope: ParticipationAccessScope | undefined,
  ): Promise<void> {
    const params: unknown[] = [tenantId, id];
    const bind = binder(params);
    const scopeSql = scope ? `AND ${applicationParticipantCondition('a', bind(scope.userId))}` : '';
    const rows: unknown[] = await mg.query(
      `SELECT 1 FROM applications a WHERE a.tenant_id = $1 AND a.id = $2 ${scopeSql}`,
      params,
    );
    if (rows.length === 0) throw new BadRequestException(APPLICATIONS_NOT_FOUND);
  }

  private async assertAssetExists(mg: EntityManager, tenantId: string, id: string): Promise<void> {
    const rows: unknown[] = await mg.query(
      `SELECT 1 FROM assets WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (rows.length === 0) throw new BadRequestException(ASSETS_NOT_FOUND);
  }

  /** Every stored id of the link, lower case. `extraSql` narrows a budget link to one nature. */
  private async linkIds(
    mg: EntityManager,
    t: RelationLinkTable & { target: string },
    tenantId: string,
    ownerId: string,
    extraSql = '',
  ): Promise<string[]> {
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT l.${t.target} AS id FROM ${t.links} l WHERE l.tenant_id = $1 AND l.${t.owner} = $2${extraSql}`,
      [tenantId, ownerId],
    );
    return Array.from(new Set(rows.map((row) => String(row.id).toLowerCase()))).sort();
  }

  /**
   * Hand the whole stored set, plus or minus `id`, to the replacement that owns it.
   * The set includes a link the caller cannot see: the replacement rewrites every row it is
   * given, and dropping an invisible id would remove it.
   */
  private async replaceOne(
    current: string[],
    id: string,
    add: boolean,
    replace: (next: string[]) => Promise<unknown>,
  ): Promise<{ ok: true; changed: boolean }> {
    if (current.includes(id) === add) return { ok: true, changed: false };
    const next = (add ? [...current, id] : current.filter((value) => value !== id)).sort();
    await replace(next);
    return { ok: true, changed: true };
  }

  /** The request's tab in one round trip. The request must exist in the tenant (404 otherwise). */
  async getRequestRelations(requestId: string, ctx: RequestRelationsContext): Promise<RequestRelations> {
    const mg = ctx.manager;
    const request = await this.readRequest(mg, ctx.tenantId, requestId);
    const tenantId = request.tenant_id;
    const { year, measure, budget_column } = await readRelationsBudgetColumn(mg, tenantId);
    const budgetLines = ctx.access.budget_lines
      ? await listRelatedBudgetLines(mg, this.fxRates, REQUEST_LINES, tenantId, request.id, year, measure)
      : null;
    const applications = ctx.access.applications
      ? await listRelatedApplications(mg, REQUEST_APPLICATIONS, tenantId, request.id, ctx.applicationScope)
      : null;
    const assets = ctx.access.assets ? await listRelatedAssets(mg, REQUEST_ASSETS, tenantId, request.id) : null;
    const processes = ctx.access.processes
      ? await listRelatedBusinessProcesses(mg, REQUEST_PROCESSES, tenantId, request.id)
      : null;
    const resultingProjects = ctx.access.resulting_projects
      ? await listRelatedPortfolioItems(mg, REQUEST_PROJECTS, 'portfolio_projects', tenantId, request.id, ctx.projectScope)
      : null;
    return {
      year,
      budget_column,
      budget_lines: budgetLines,
      applications,
      assets,
      processes,
      resulting_projects: resultingProjects,
    };
  }

  /**
   * Link or unlink one row of a request. A business process also needs `writes.processes`
   * (`business_processes:member`): 403 `You cannot edit this module.` with the read alone.
   * The same order as a project: a bad id is 400 before a missing request is 404.
   */
  async setRequestLink(
    kind: RequestRelationKind,
    targetId: string,
    add: boolean,
    ctx: RequestRelationsContext,
    loadOwner: () => Promise<{ id: string; tenantId: string }>,
  ): Promise<{ ok: true; changed: boolean }> {
    if (!ctx.access[kind]) throw new ForbiddenException('You cannot read this module.');
    if (kind === 'processes') {
      if (!ctx.writes.processes) throw new ForbiddenException('You cannot edit this module.');
      return setOwnedLink({
        manager: ctx.manager,
        userId: ctx.userId,
        kind,
        targetId,
        add,
        allowed: true,
        loadOwner,
        owner: { table: 'portfolio_requests', idColumn: 'id' },
        ownerNotFound: 'Request not found',
        link: PROCESS_LINK,
        audit: this.audit,
      });
    }
    const id = parseTargetId(targetId);
    const owner = await loadOwner();
    const mg = ctx.manager;
    if (!(await this.lockRequest(mg, owner.tenantId, owner.id))) throw new NotFoundException('Request not found');
    if (kind === 'budget_lines') return this.setRequestBudgetLine(mg, owner.tenantId, owner.id, id, add, ctx.userId);
    if (kind === 'applications') {
      await this.assertApplicationVisible(mg, owner.tenantId, id, ctx.applicationScope);
      const current = await this.linkIds(mg, REQUEST_APPLICATIONS, owner.tenantId, owner.id);
      return this.replaceOne(current, id, add, (next) => this.requests.bulkReplaceApplications(owner.id, next, { manager: mg, userId: ctx.userId }));
    }
    await this.assertAssetExists(mg, owner.tenantId, id);
    const current = await this.linkIds(mg, REQUEST_ASSETS, owner.tenantId, owner.id);
    return this.replaceOne(current, id, add, (next) => this.requests.bulkReplaceAssets(owner.id, next, { manager: mg, userId: ctx.userId }));
  }

  private async readRequest(mg: EntityManager, tenantId: string, requestId: string): Promise<{ id: string; tenant_id: string }> {
    const rows: Array<{ id: string; tenant_id: string }> = await mg.query(
      `SELECT id, tenant_id FROM portfolio_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, requestId],
    );
    if (!rows[0]) throw new NotFoundException('Request not found');
    return rows[0];
  }

  /** Locks the request (FOR NO KEY UPDATE); false when it is gone. */
  private async lockRequest(mg: EntityManager, tenantId: string, requestId: string): Promise<boolean> {
    const rows: unknown[] = await mg.query(
      `SELECT 1 FROM portfolio_requests WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
      [tenantId, requestId],
    );
    return rows.length > 0;
  }

  /** The line's nature, or 400. The link is then written by the replacement of that nature only. */
  private async setRequestBudgetLine(
    mg: EntityManager,
    tenantId: string,
    requestId: string,
    id: string,
    add: boolean,
    userId: string | null,
  ): Promise<{ ok: true; changed: boolean }> {
    const nature = await this.budgetNature(mg, tenantId, id);
    if (!nature) throw new BadRequestException(BUDGET_LINE_NOT_FOUND);
    const current = await this.linkIds(mg, REQUEST_LINES, tenantId, requestId, linkedLineOf('l.tenant_id', 'l.opex_id', nature));
    const replace = nature === 'opex'
      ? (next: string[]) => this.requests.bulkReplaceOpex(requestId, next, { manager: mg, userId })
      : (next: string[]) => this.requests.bulkReplaceCapex(requestId, next, { manager: mg, userId });
    return this.replaceOne(current, id, add, replace);
  }
}
