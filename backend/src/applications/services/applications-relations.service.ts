import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Application } from '../application.entity';
import { ApplicationsBaseService } from './applications-base.service';
import { ApplicationsInstancesService } from './applications-instances.service';
import {
  ParticipationAccessScope,
  projectParticipantCondition,
  requestParticipantCondition,
  taskParticipantCondition,
} from '../../auth/business-contributor-scope';
import { BUDGET_NATURES, linkedLineOf, naturesAnd, type BudgetNature } from '../../spend/budget-nature';
import { budgetColumnName, readBudgetColumns } from '../../budget-columns/budget-columns.util';
import {
  binder,
  dateText,
  listRelatedBudgetLines,
  listRelatedContracts,
  listRelatedProjects,
  type RelatedBudgetLine,
  type RelatedContract,
  type RelatedProject,
} from '../../common/relations/related-objects';
import { FxRateService } from '../../currency/fx-rate.service';
import { InterfacesService } from '../../interfaces/services/interfaces.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { TechnologyLinksService, type DeploymentServer, type LinkInput } from '../../technologies/technology-links.service';
import { technologyReference } from '../../technologies/technology-rows';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** At most this many suggestions per rule. */
export const SUGGESTIONS_PER_RULE = 20;

/** The kinds of objects the Relations tab links to an application. */
export const RELATION_KINDS = ['budget_lines', 'contracts', 'processes', 'projects', 'requests', 'tasks', 'technologies'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** Which modules the caller may read: a section the caller cannot read is `null`. */
export type RelationsAccess = Record<RelationKind, boolean>;

/**
 * The kinds whose link also needs the right to edit the other module (lot T2a): a technology
 * dependency needs `infrastructure:member`, a business process `business_processes:member`.
 */
export type RelationsWrites = { technologies: boolean; processes: boolean };

/** The participation scopes of a Business Contributor (none for everyone else). */
export type RelationsScopes = {
  application?: ParticipationAccessScope;
  project?: ParticipationAccessScope;
  request?: ParticipationAccessScope;
  task?: ParticipationAccessScope;
};

export type RelationsContext = {
  manager: EntityManager;
  tenantId: string;
  userId: string | null;
  access: RelationsAccess;
  /** The extra write rights of the kinds that need one (`RelationsWrites`). */
  writes: RelationsWrites;
  scopes: RelationsScopes;
};

export type { RelatedBudgetLine, RelatedContract, RelatedProject };
export type RelatedRequest = { id: string; item_number: number | null; name: string; status: string | null; target_delivery_date: string | null };
export type RelatedTask = {
  id: string;
  item_number: number | null;
  title: string;
  status: string | null;
  assignee_name: string | null;
  due_date: string | null;
};
export type RelationSuggestion = {
  type: 'budget_line' | 'contract' | 'project';
  id: string;
  item_number: number | null;
  name: string;
  via: { kind: 'same_supplier' | 'contract' | 'project' | 'task'; label: string | null };
};
/**
 * A technology of the application, once per technology: declared (a direct dependency, removable)
 * and/or hosted (carried by a server the application is deployed on, or by that server's host).
 * `versions` are the known versions of every row, `version_unknown` true when a row has none;
 * `standard_support_end` is the earliest end among those versions; `via` the servers of the hosted rows.
 * `declarations` are the application's own links (one per version declared), whose version the
 * screen changes through `PATCH /technologies/:id/application-links/:linkId`.
 */
export type RelatedTechnology = {
  id: string;
  reference: string | null;
  name: string | null;
  family: string | null;
  declared: boolean;
  hosted: boolean;
  versions: string[];
  version_unknown: boolean;
  standard_support_end: string | null;
  via: Array<{ asset_id: string; asset_name: string | null; host_name: string | null }>;
  declarations: Array<{ link_id: string; technology_version_id: string | null; version_label: string | null }>;
};
export type RelatedProcess = { id: string; name: string; status: string | null; owner_name: string | null };
export type ApplicationRelations = {
  year: number;
  budget_column: { key: string; label: string };
  budget_lines: RelatedBudgetLine[] | null;
  contracts: RelatedContract[] | null;
  projects: RelatedProject[] | null;
  requests: RelatedRequest[] | null;
  tasks: RelatedTask[] | null;
  technologies: RelatedTechnology[] | null;
  /** The servers the application is deployed on, offered to record a technology on; null with `technologies`. */
  deployment_servers: DeploymentServer[] | null;
  processes: RelatedProcess[] | null;
  suggestions: RelationSuggestion[];
  also: { assets: number; interfaces: number; documents: number };
};

/** The application's link tables of the shared listings (`common/relations/related-objects.ts`). */
const LINE_LINKS = { links: 'application_spend_items', owner: 'application_id' };
const CONTRACT_LINKS = { links: 'application_contracts', owner: 'application_id' };
const PROJECT_LINKS = { links: 'application_projects', owner: 'application_id' };
const ACTIVE_LINE = `i.status = 'enabled' AND (i.disabled_at IS NULL OR i.disabled_at > now())`;
const ACTIVE_CONTRACT = `c.status = 'enabled' AND (c.disabled_at IS NULL OR c.disabled_at > now())`;
const ACTIVE_PROJECT = `COALESCE(p.status, '') NOT IN ('done', 'cancelled')`;
/** The project a task belongs to: its related project, else the project of its phase. */
const TASK_PROJECT = `COALESCE(
  CASE WHEN t.related_object_type = 'project' THEN t.related_object_id END,
  (SELECT ph.project_id FROM portfolio_project_phases ph WHERE ph.id = t.phase_id AND ph.tenant_id = t.tenant_id)
)`;

/**
 * The Relations tab of an application in one round trip (lot R1): the budget lines with their
 * amount on the tenant's default column for the current year, the contracts with their current
 * end, the projects, requests and tasks linked directly, suggestions by four static rules, and the
 * counts of what is related elsewhere. Every statement carries `tenant_id` on each table and join
 * besides RLS; each section is one query over the application's ids, never a query per row.
 *
 * The links are written through the services that own them (`ApplicationsInstancesService`,
 * `TasksUnifiedService`, `PortfolioRequestsService`), so their validation and audit apply. A single
 * link or unlink reads the stored set under the application's row lock and replaces it with that
 * set plus or minus one id: a link another user made meanwhile is kept.
 */
@Injectable()
export class ApplicationsRelationsService extends ApplicationsBaseService {
  constructor(
    @InjectRepository(Application) appRepo: Repository<Application>,
    private readonly instances: ApplicationsInstancesService,
    private readonly fxRates: FxRateService,
    private readonly interfaces: InterfacesService,
    private readonly knowledge: KnowledgeService,
    private readonly tasks: TasksUnifiedService,
    @Inject(forwardRef(() => PortfolioRequestsService))
    private readonly requests: PortfolioRequestsService,
    private readonly technologyLinks: TechnologyLinksService,
  ) {
    super(appRepo);
  }

  // ==================== READ ====================

  async getRelations(appId: string, ctx: RelationsContext): Promise<ApplicationRelations> {
    const mg = ctx.manager;
    const app = await this.ensureApp(appId, mg, ctx.scopes.application);
    const tenantId = app.tenant_id;
    const year = new Date().getUTCFullYear();
    const columns = await readBudgetColumns(mg, tenantId);
    const measure = columns.default_column;

    // One after the other: the request's single connection runs its queries in turn anyway, and
    // pg refuses a query sent while another one runs (deprecated since pg 8, an error in pg 9).
    const budgetLines = ctx.access.budget_lines ? await this.listBudgetLines(mg, tenantId, app.id, year, measure) : null;
    const contracts = ctx.access.contracts ? await this.listContracts(mg, tenantId, app.id) : null;
    const projects = ctx.access.projects ? await this.listProjects(mg, tenantId, app.id, ctx.scopes.project) : null;
    const requests = ctx.access.requests ? await this.listRequests(mg, tenantId, app.id, ctx.scopes.request) : null;
    const tasks = ctx.access.tasks ? await this.listTasks(mg, tenantId, app.id, ctx.scopes.task) : null;
    const linkOpts = { manager: mg, tenantId, userId: ctx.userId };
    const technologies = ctx.access.technologies ? await this.listTechnologies(mg, tenantId, app.id, linkOpts) : null;
    const deploymentServers = ctx.access.technologies ? await this.technologyLinks.deploymentServersOfApplication(app.id, linkOpts) : null;
    const processes = ctx.access.processes
      ? ((await this.technologyLinks.processesOfApplication(app.id, linkOpts)).items as any[])
        .map((row): RelatedProcess => ({ id: row.id, name: row.name, status: row.status ?? null, owner_name: row.owner_name ?? null }))
      : null;
    const suggestions = await this.listSuggestions(mg, tenantId, app.id, app.supplier_id ?? null, ctx);
    const also = await this.countAlso(mg, tenantId, app.id, ctx);

    return {
      year,
      budget_column: { key: measure, label: budgetColumnName(columns, measure) },
      budget_lines: budgetLines,
      contracts,
      projects,
      requests,
      tasks,
      technologies,
      deployment_servers: deploymentServers,
      processes,
      suggestions,
      also,
    };
  }

  /**
   * The declarations are read here, for every state of the application: the technology layer
   * leaves out an application out of service, but the Operations tab must still show what it
   * declares, so that it can be withdrawn. The hosted rows come from the reach. The Relations
   * badge does not count these rows.
   */
  private async listTechnologies(mg: EntityManager, tenantId: string, appId: string, linkOpts: { manager: EntityManager; tenantId: string; userId: string | null }) {
    const declared: Array<{ id: string; technology_id: string; technology_version_id: string | null; name: string; item_number: number | null; family: string | null; version_label: string | null; standard_support_end: string | null }> = await mg.query(
      `SELECT d.id, d.technology_id, d.technology_version_id, t.name, t.item_number, t.family, v.label AS version_label,
              to_char(v.standard_support_end, 'YYYY-MM-DD') AS standard_support_end
         FROM application_technologies d
         JOIN technologies t ON t.id = d.technology_id AND t.tenant_id = d.tenant_id
         LEFT JOIN technology_versions v ON v.id = d.technology_version_id AND v.tenant_id = d.tenant_id
        WHERE d.tenant_id = $1 AND d.application_id = $2`,
      [tenantId, appId],
    );
    const hosted = (await this.technologyLinks.technologiesOfApplication(appId, linkOpts)).items.filter((row) => row.kind !== 'declared');
    return mergeTechnologies([
      ...declared.map((row): TechnologyMergeRow => ({
        technology_id: row.technology_id, technology_name: row.name, technology_reference: technologyReference(row.item_number), family: row.family,
        kind: 'declared', version_label: row.version_label, standard_support_end: row.standard_support_end,
        asset_id: null, asset_name: null, via_asset_name: null, link_id: row.id, technology_version_id: row.technology_version_id,
      })),
      ...hosted,
    ]);
  }

  private listBudgetLines(mg: EntityManager, tenantId: string, appId: string, year: number, measure: string): Promise<RelatedBudgetLine[]> {
    return listRelatedBudgetLines(mg, this.fxRates, LINE_LINKS, tenantId, appId, year, measure);
  }

  private listContracts(mg: EntityManager, tenantId: string, appId: string): Promise<RelatedContract[]> {
    return listRelatedContracts(mg, CONTRACT_LINKS, tenantId, appId);
  }

  private listProjects(mg: EntityManager, tenantId: string, appId: string, scope?: ParticipationAccessScope): Promise<RelatedProject[]> {
    return listRelatedProjects(mg, PROJECT_LINKS, tenantId, appId, scope);
  }

  private async listRequests(mg: EntityManager, tenantId: string, appId: string, scope?: ParticipationAccessScope): Promise<RelatedRequest[]> {
    const params: unknown[] = [tenantId, appId];
    const bind = binder(params);
    const scopeSql = scope ? `AND ${requestParticipantCondition('r', bind(scope.userId))}` : '';
    return mg.query(
      `SELECT r.id, r.item_number, r.name, r.status, ${dateText('r.target_delivery_date')} AS target_delivery_date
       FROM portfolio_request_applications l
       JOIN portfolio_requests r ON r.id = l.request_id AND r.tenant_id = l.tenant_id
       WHERE l.tenant_id = $1 AND l.application_id = $2 ${scopeSql}
       ORDER BY r.target_delivery_date ASC NULLS LAST, lower(r.name), r.id`,
      params,
    );
  }

  /** Tasks linked to the application itself, never through a linked project (fried, 2026-10-16). */
  private async listTasks(mg: EntityManager, tenantId: string, appId: string, scope?: ParticipationAccessScope): Promise<RelatedTask[]> {
    const params: unknown[] = [tenantId, appId];
    const bind = binder(params);
    const scopeSql = scope ? `AND ${taskParticipantCondition('t', bind(scope.userId))}` : '';
    return mg.query(
      `SELECT t.id, t.item_number, t.title, t.status,
              NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS assignee_name,
              ${dateText('t.due_date')} AS due_date
       FROM task_applications l
       JOIN tasks t ON t.id = l.task_id AND t.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = t.assignee_user_id AND u.tenant_id = t.tenant_id
       WHERE l.tenant_id = $1 AND l.application_id = $2 ${scopeSql}
       ORDER BY (COALESCE(t.status, '') IN ('done', 'cancelled')) ASC, t.due_date ASC NULLS LAST, t.item_number ASC NULLS LAST, t.id`,
      params,
    );
  }

  /**
   * Four static rules, at most `SUGGESTIONS_PER_RULE` rows each, over active objects not linked yet
   * and readable by the caller: A1 contracts and A2 lines of the application's supplier, A3 lines
   * of a linked contract or project, A4 projects that carry a task linked to the application. A
   * line found by A3 and A2 is suggested once, with the more specific A3.
   */
  private async listSuggestions(
    mg: EntityManager,
    tenantId: string,
    appId: string,
    supplierId: string | null,
    ctx: RelationsContext,
  ): Promise<RelationSuggestion[]> {
    const { access, scopes } = ctx;
    const notLinkedLine = `NOT EXISTS (SELECT 1 FROM application_spend_items al WHERE al.tenant_id = i.tenant_id AND al.application_id = $2 AND al.spend_item_id = i.id)`;
    const rules: Array<() => Promise<RelationSuggestion[]>> = [];

    // A1: contracts of the application's supplier.
    if (access.contracts && supplierId) {
      rules.push(() => mg.query(
        `SELECT c.id, c.name
         FROM contracts c
         WHERE c.tenant_id = $1 AND c.supplier_id = $3 AND ${ACTIVE_CONTRACT}
           AND NOT EXISTS (SELECT 1 FROM application_contracts al WHERE al.tenant_id = c.tenant_id AND al.application_id = $2 AND al.contract_id = c.id)
         ORDER BY lower(c.name), c.id
         LIMIT ${SUGGESTIONS_PER_RULE}`,
        [tenantId, appId, supplierId],
      ).then((rows: Array<{ id: string; name: string }>) => rows.map((row) => ({
        type: 'contract' as const, id: row.id, item_number: null, name: row.name, via: { kind: 'same_supplier' as const, label: null },
      }))));
    }

    if (access.budget_lines) {
      // A3: lines of a linked contract (contract read needed for its name) or of a linked project.
      const via: string[] = [];
      const params: unknown[] = [tenantId, appId];
      const bind = binder(params);
      if (access.contracts) {
        via.push(`SELECT cl.spend_item_id AS line_id, 'contract' AS kind, c.name AS label, lower(c.name) AS sort
          FROM application_contracts ac
          JOIN contracts c ON c.id = ac.contract_id AND c.tenant_id = ac.tenant_id
          JOIN contract_spend_items cl ON cl.contract_id = c.id AND cl.tenant_id = c.tenant_id
          WHERE ac.tenant_id = $1 AND ac.application_id = $2
          UNION ALL
          SELECT li.id, 'contract', c.name, lower(c.name)
          FROM application_contracts ac
          JOIN contracts c ON c.id = ac.contract_id AND c.tenant_id = ac.tenant_id
          JOIN spend_items li ON li.contract_id = c.id AND li.tenant_id = c.tenant_id${naturesAnd('li', BUDGET_NATURES)}
          WHERE ac.tenant_id = $1 AND ac.application_id = $2`);
      }
      if (access.projects) {
        const scopeSql = scopes.project ? `AND ${projectParticipantCondition('p', bind(scopes.project.userId))}` : '';
        via.push(`SELECT po.opex_id, 'project', 'PRJ-' || p.item_number, lpad(p.item_number::text, 12, '0')
          FROM application_projects ap
          JOIN portfolio_projects p ON p.id = ap.project_id AND p.tenant_id = ap.tenant_id
          JOIN portfolio_project_opex po ON po.project_id = p.id AND po.tenant_id = p.tenant_id
          WHERE ap.tenant_id = $1 AND ap.application_id = $2 ${scopeSql}
          UNION ALL
          SELECT li.id, 'project', 'PRJ-' || p.item_number, lpad(p.item_number::text, 12, '0')
          FROM application_projects ap
          JOIN portfolio_projects p ON p.id = ap.project_id AND p.tenant_id = ap.tenant_id
          JOIN spend_items li ON li.project_id = p.id AND li.tenant_id = p.tenant_id${naturesAnd('li', BUDGET_NATURES)}
          WHERE ap.tenant_id = $1 AND ap.application_id = $2 ${scopeSql}`);
      }
      const viaRules = () => via.length
        ? mg.query(
          `SELECT DISTINCT ON (i.id) i.id, i.item_number, i.product_name, v.kind, v.label
           FROM (${via.join(' UNION ALL ')}) v
           JOIN spend_items i ON i.id = v.line_id AND i.tenant_id = $1${naturesAnd('i', BUDGET_NATURES)}
           WHERE ${ACTIVE_LINE} AND ${notLinkedLine}
           ORDER BY i.id, v.kind, v.sort`,
          params,
        ).then((rows: Array<{ id: string; item_number: number | null; product_name: string; kind: 'contract' | 'project'; label: string }>) => rows
          .sort((a, b) => a.product_name.localeCompare(b.product_name) || a.id.localeCompare(b.id))
          .slice(0, SUGGESTIONS_PER_RULE))
        : Promise.resolve([]);
      // A2: lines of the application's supplier.
      const sameSupplier = () => supplierId
        ? mg.query(
          `SELECT i.id, i.item_number, i.product_name
           FROM spend_items i
           WHERE i.tenant_id = $1 AND i.supplier_id = $3${naturesAnd('i', BUDGET_NATURES)} AND ${ACTIVE_LINE} AND ${notLinkedLine}
           ORDER BY lower(i.product_name), i.id
           LIMIT ${SUGGESTIONS_PER_RULE}`,
          [tenantId, appId, supplierId],
        )
        : Promise.resolve([]);
      rules.push(async () => {
        const byLink = await viaRules();
        const bySupplier = await sameSupplier();
        const seen = new Set(byLink.map((row) => row.id));
        return [
          ...byLink.map((row) => ({
            type: 'budget_line' as const, id: row.id, item_number: row.item_number ?? null, name: row.product_name,
            via: { kind: row.kind, label: row.label },
          })),
          ...(bySupplier as Array<{ id: string; item_number: number | null; product_name: string }>)
            .filter((row) => !seen.has(row.id))
            .map((row) => ({
              type: 'budget_line' as const, id: row.id, item_number: row.item_number ?? null, name: row.product_name,
              via: { kind: 'same_supplier' as const, label: null },
            })),
        ];
      });
    }

    // A4: projects that carry a task linked to the application.
    if (access.projects && access.tasks) {
      const params: unknown[] = [tenantId, appId];
      const bind = binder(params);
      const taskScope = scopes.task ? `AND ${taskParticipantCondition('t', bind(scopes.task.userId))}` : '';
      const projectScope = scopes.project ? `AND ${projectParticipantCondition('p', bind(scopes.project.userId))}` : '';
      rules.push(() => mg.query(
        `SELECT p.id, p.item_number, p.name, min(t.item_number) AS task_number
         FROM task_applications ta
         JOIN tasks t ON t.id = ta.task_id AND t.tenant_id = ta.tenant_id
         JOIN portfolio_projects p ON p.id = ${TASK_PROJECT} AND p.tenant_id = t.tenant_id
         WHERE ta.tenant_id = $1 AND ta.application_id = $2 AND ${ACTIVE_PROJECT} ${taskScope} ${projectScope}
           AND NOT EXISTS (SELECT 1 FROM application_projects al WHERE al.tenant_id = p.tenant_id AND al.application_id = $2 AND al.project_id = p.id)
         GROUP BY p.id, p.item_number, p.name
         ORDER BY lower(p.name), p.id
         LIMIT ${SUGGESTIONS_PER_RULE}`,
        params,
      ).then((rows: Array<{ id: string; item_number: number | null; name: string; task_number: number | null }>) => rows.map((row) => ({
        type: 'project' as const, id: row.id, item_number: row.item_number ?? null, name: row.name,
        via: { kind: 'task' as const, label: row.task_number == null ? null : `T-${row.task_number}` },
      }))));
    }

    const out: RelationSuggestion[] = [];
    for (const rule of rules) out.push(...(await rule()));
    return out;
  }

  /** Assets through the deployments, interfaces as the Interfaces tab lists them, documents the caller can read. */
  private async countAlso(mg: EntityManager, tenantId: string, appId: string, ctx: RelationsContext) {
    const assetRows: Array<{ n: number }> = await mg.query(
        `SELECT count(DISTINCT aa.asset_id)::int AS n
         FROM app_instances ai
         JOIN app_asset_assignments aa ON aa.app_instance_id = ai.id AND aa.tenant_id = ai.tenant_id
         WHERE ai.tenant_id = $1 AND ai.application_id = $2`,
        [tenantId, appId],
    );
    // Interfaces are closed to a Business Contributor (`InterfacesController`).
    const interfaces = ctx.scopes.application
      ? 0
      : await this.interfaces.listByApplication(appId, tenantId, { manager: mg }).then((res: any) => (Array.isArray(res?.items) ? res.items.length : 0));
    const documents = await this.knowledge.listDocumentsForEntity('applications', appId, { manager: mg, userId: ctx.userId })
      .then((res) => Number(res?.total || 0));
    return { assets: Number(assetRows[0]?.n || 0), interfaces, documents };
  }

  // ==================== WRITE ====================

  /**
   * Link (`add`) or unlink one object. The application's row is locked first (the lock the
   * replacements take), the stored set is read, and the owning service replaces it with that set
   * plus or minus `targetId`: same validation, same audit, and a link made meanwhile by someone
   * else stays. Linking what is linked, or unlinking what is not, changes nothing. A technology is
   * declared with the version of `body` (`LinkInput`) and recorded on the deployment servers of
   * `body.asset_ids` (`TechnologyLinksService.declareApplicationTechnology`); `servers` then says
   * how many links were added and how many servers already had the technology. Recording on a
   * server needs `infrastructure:member`, the right the declaration already asks.
   */
  async setLink(
    kind: RelationKind,
    appId: string,
    targetId: string,
    add: boolean,
    ctx: RelationsContext,
    body: LinkInput & { asset_ids?: unknown } = {},
  ): Promise<{ ok: true; changed: boolean; servers?: { added: number; skipped: number } }> {
    if (!ctx.access[kind]) throw new ForbiddenException('You cannot read this module.');
    if ((kind === 'technologies' || kind === 'processes') && !ctx.writes[kind]) throw new ForbiddenException('You cannot edit this module.');
    const id = String(targetId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new BadRequestException('Invalid id.');
    const mg = ctx.manager;
    const app = await this.ensureApp(appId, mg, ctx.scopes.application);
    const tenantId = app.tenant_id;
    await mg.query(`SELECT 1 FROM applications WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`, [tenantId, app.id]);
    const userId = ctx.userId;

    // The technology layer writes its own links, idempotent and audited (`TechnologyLinksService`).
    if (kind === 'technologies') {
      const linkOpts = { manager: mg, tenantId, userId };
      if (!add) return { ok: true, changed: (await this.technologyLinks.setApplicationTechnology(app.id, id, false, {}, linkOpts)).changed };
      const res = await this.technologyLinks.declareApplicationTechnology(app.id, id, body ?? {}, linkOpts);
      return res.servers ? { ok: true, changed: res.changed, servers: res.servers } : { ok: true, changed: res.changed };
    }
    if (kind === 'processes') {
      const res = await this.technologyLinks.setProcessApplication(id, app.id, add, { manager: mg, tenantId, userId }, { scope: ctx.scopes.application });
      return { ok: true, changed: res.changed };
    }
    const apply = (current: string[]) => {
      const has = current.includes(id);
      if (has === add) return null;
      return add ? [...current, id] : current.filter((value) => value !== id);
    };

    if (kind === 'budget_lines') {
      const lines: Array<{ nature: BudgetNature }> = await mg.query(
        `SELECT nature FROM spend_items WHERE tenant_id = $1 AND id = $2${naturesAnd(null, BUDGET_NATURES)}`,
        [tenantId, id],
      );
      if (!lines[0]) throw new BadRequestException('Budget line not found.');
      const nature = lines[0].nature;
      const current = await this.idsOf(mg,
        `SELECT l.spend_item_id AS id FROM application_spend_items l WHERE l.tenant_id = $1 AND l.application_id = $2${linkedLineOf('l.tenant_id', 'l.spend_item_id', nature)}`,
        [tenantId, app.id]);
      const next = apply(current);
      if (!next) return { ok: true, changed: false };
      if (nature === 'opex') await this.instances.bulkReplaceLinkedSpendItems(app.id, next, userId, { manager: mg });
      else await this.instances.bulkReplaceLinkedCapexItems(app.id, next, userId, { manager: mg });
      return { ok: true, changed: true };
    }

    if (kind === 'contracts') {
      const current = await this.idsOf(mg, `SELECT contract_id AS id FROM application_contracts WHERE tenant_id = $1 AND application_id = $2`, [tenantId, app.id]);
      const next = apply(current);
      if (!next) return { ok: true, changed: false };
      await this.instances.bulkReplaceLinkedContracts(app.id, next, userId, { manager: mg });
      return { ok: true, changed: true };
    }

    if (kind === 'projects') {
      await this.assertProjectVisible(mg, tenantId, id, ctx.scopes.project);
      const current = await this.idsOf(mg, `SELECT project_id AS id FROM application_projects WHERE tenant_id = $1 AND application_id = $2`, [tenantId, app.id]);
      const next = apply(current);
      if (!next) return { ok: true, changed: false };
      await this.instances.bulkReplaceProjects(app.id, next, userId, { manager: mg });
      return { ok: true, changed: true };
    }

    if (kind === 'requests') {
      const result = await this.replaceRequestLinks(mg, tenantId, app.id, [id], add ? [id] : [], userId, ctx.scopes.request);
      return { ok: true, changed: result.added + result.removed > 0 };
    }

    // Tasks: the replacement only reads and writes the tasks the caller can read.
    const params: unknown[] = [tenantId, app.id];
    const bind = binder(params);
    const scopeSql = ctx.scopes.task ? `AND ${taskParticipantCondition('t', bind(ctx.scopes.task.userId))}` : '';
    const current = await this.idsOf(mg,
      `SELECT l.task_id::text AS id FROM task_applications l JOIN tasks t ON t.id = l.task_id AND t.tenant_id = l.tenant_id
       WHERE l.tenant_id = $1 AND l.application_id = $2 ${scopeSql}`,
      params);
    const next = apply(current);
    if (!next) return { ok: true, changed: false };
    await this.tasks.bulkReplaceTasksForApplication(app.id, next, { manager: mg, tenantId, userId, accessScope: ctx.scopes.task });
    return { ok: true, changed: true };
  }

  /**
   * Replace the requests linked to the application with `requestIds`. Only the requests the caller
   * can read are compared and touched (a Business Contributor's scope); each request that gains or
   * loses the application has its own list replaced by `PortfolioRequestsService`, which checks
   * the ids and records the change in the request's activity.
   */
  async bulkReplaceRequests(appId: string, requestIds: string[], ctx: RelationsContext): Promise<{ ok: true; added: number; removed: number }> {
    if (!ctx.access.requests) throw new ForbiddenException('You cannot read requests.');
    const mg = ctx.manager;
    const app = await this.ensureApp(appId, mg, ctx.scopes.application);
    await mg.query(`SELECT 1 FROM applications WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`, [app.tenant_id, app.id]);
    const ids = Array.from(new Set((requestIds || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean)));
    if (ids.some((id) => !UUID_RE.test(id))) throw new BadRequestException('One or more requests were not found.');
    const params: unknown[] = [app.tenant_id, app.id];
    const bind = binder(params);
    const scopeSql = ctx.scopes.request ? `AND ${requestParticipantCondition('r', bind(ctx.scopes.request.userId))}` : '';
    const current = await this.idsOf(mg,
      `SELECT l.request_id::text AS id FROM portfolio_request_applications l
       JOIN portfolio_requests r ON r.id = l.request_id AND r.tenant_id = l.tenant_id
       WHERE l.tenant_id = $1 AND l.application_id = $2 ${scopeSql}`,
      params);
    const affected = Array.from(new Set([...current, ...ids]));
    const counts = await this.replaceRequestLinks(mg, app.tenant_id, app.id, affected, ids, ctx.userId, ctx.scopes.request);
    return { ok: true, ...counts };
  }

  /**
   * For each request of `affected`, link the application when the request is in `linked`, unlink it
   * otherwise. Every affected id must name a request the caller can read (400 otherwise).
   */
  private async replaceRequestLinks(
    mg: EntityManager,
    tenantId: string,
    appId: string,
    affected: string[],
    linked: string[],
    userId: string | null,
    scope?: ParticipationAccessScope,
  ): Promise<{ added: number; removed: number }> {
    if (affected.length === 0) return { added: 0, removed: 0 };
    const params: unknown[] = [tenantId, affected];
    const bind = binder(params);
    const scopeSql = scope ? `AND ${requestParticipantCondition('r', bind(scope.userId))}` : '';
    const rows: Array<{ id: string; application_ids: string[] }> = await mg.query(
      `SELECT r.id::text AS id,
              ARRAY(SELECT l.application_id::text FROM portfolio_request_applications l
                    WHERE l.tenant_id = r.tenant_id AND l.request_id = r.id ORDER BY l.application_id) AS application_ids
       FROM portfolio_requests r
       WHERE r.tenant_id = $1 AND r.id = ANY($2::uuid[]) ${scopeSql}
       ORDER BY r.id`,
      params,
    );
    if (rows.length !== affected.length) throw new BadRequestException('One or more requests were not found.');
    const linkedSet = new Set(linked);
    let added = 0;
    let removed = 0;
    for (const row of rows) {
      const has = row.application_ids.includes(appId);
      const wants = linkedSet.has(row.id);
      if (has === wants) continue;
      const next = wants ? [...row.application_ids, appId] : row.application_ids.filter((value) => value !== appId);
      await this.requests.bulkReplaceApplications(row.id, next, { manager: mg, userId });
      if (wants) added += 1;
      else removed += 1;
    }
    return { added, removed };
  }

  private async assertProjectVisible(mg: EntityManager, tenantId: string, projectId: string, scope?: ParticipationAccessScope) {
    const params: unknown[] = [tenantId, projectId];
    const bind = binder(params);
    const scopeSql = scope ? `AND ${projectParticipantCondition('p', bind(scope.userId))}` : '';
    const rows = await mg.query(`SELECT 1 FROM portfolio_projects p WHERE p.tenant_id = $1 AND p.id = $2 ${scopeSql}`, params);
    if (rows.length === 0) throw new BadRequestException('One or more projects were not found.');
  }

  private async idsOf(mg: EntityManager, sql: string, params: unknown[]): Promise<string[]> {
    const rows: Array<{ id: string }> = await mg.query(sql, params);
    return Array.from(new Set(rows.map((row) => String(row.id).toLowerCase())));
  }
}

type ReachingRow = Awaited<ReturnType<TechnologyLinksService['technologiesOfApplication']>>['items'][number];
type TechnologyMergeRow = Pick<ReachingRow,
  'technology_id' | 'technology_name' | 'technology_reference' | 'family' | 'kind' | 'version_label' | 'standard_support_end' | 'asset_id' | 'asset_name' | 'via_asset_name'>
  & { link_id?: string | null; technology_version_id?: string | null };

/**
 * One row per technology from the rows of `technologiesOfApplication` (one per declaration, and
 * one per server, environment and version reached): a technology both declared and hosted shows
 * once, marked both ways. Sorted by name.
 */
export function mergeTechnologies(rows: TechnologyMergeRow[]): RelatedTechnology[] {
  const byId = new Map<string, RelatedTechnology & { versionSet: Set<string>; viaSet: Set<string> }>();
  for (const row of rows) {
    let tech = byId.get(row.technology_id);
    if (!tech) {
      tech = {
        id: row.technology_id, reference: row.technology_reference ?? null, name: row.technology_name, family: row.family,
        declared: false, hosted: false, versions: [], version_unknown: false, standard_support_end: null, via: [], declarations: [],
        versionSet: new Set(), viaSet: new Set(),
      };
      byId.set(row.technology_id, tech);
    }
    if (row.kind === 'declared') {
      tech.declared = true;
      if (row.link_id) tech.declarations.push({ link_id: row.link_id, technology_version_id: row.technology_version_id ?? null, version_label: row.version_label });
    } else tech.hosted = true;
    if (row.version_label) tech.versionSet.add(row.version_label);
    else tech.version_unknown = true;
    const end = row.standard_support_end;
    if (end && (!tech.standard_support_end || end < tech.standard_support_end)) tech.standard_support_end = end;
    if (row.kind !== 'declared' && row.asset_id && !tech.viaSet.has(row.asset_id)) {
      tech.viaSet.add(row.asset_id);
      tech.via.push({ asset_id: row.asset_id, asset_name: row.asset_name, host_name: row.via_asset_name });
    }
  }
  const byName = (a: string | null, b: string | null) => String(a ?? '').localeCompare(String(b ?? ''), 'en', { sensitivity: 'base' });
  return [...byId.values()]
    .map(({ versionSet, viaSet: _viaSet, ...tech }) => ({
      ...tech,
      versions: [...versionSet].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      via: tech.via.sort((a, b) => byName(a.asset_name, b.asset_name)),
      declarations: tech.declarations.sort((a, b) => String(a.version_label ?? '').localeCompare(String(b.version_label ?? ''), 'en', { numeric: true })),
    }))
    .sort((a, b) => byName(a.name, b.name) || a.id.localeCompare(b.id));
}

export function isRelationKind(value: string): value is RelationKind {
  return (RELATION_KINDS as readonly string[]).includes(value);
}

/** 404 for an unknown kind in the route. */
export function relationKindOrThrow(value: string): RelationKind {
  if (!isRelationKind(value)) throw new NotFoundException('Unknown relation type.');
  return value;
}
