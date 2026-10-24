import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { taskParticipantCondition, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { setOwnedLink, type OwnedLinkAudit, type OwnedRelationLink } from '../common/relations/owned-link';
import { readRelationsBudgetColumn } from '../common/relations/relations-budget-column';
import {
  binder,
  dateText,
  readRelatedBudgetLines,
  listRelatedContracts,
  listRelatedIncidents,
  listRelatedProjects,
  type RelatedAsset,
  type RelatedBudgetLine,
  type RelatedContract,
  type RelatedIncident,
  type RelatedProject,
} from '../common/relations/related-objects';
import { parseTargetId, UUID_RE } from '../common/relations/relation-target';
import { FxRateService } from '../currency/fx-rate.service';
import type { IncidentViewer } from '../incidents/incident-visibility';
import { IncidentRelationsService } from '../incidents/services/incident-relations.service';
import { auditTableOf, type BudgetNature } from '../spend/budget-nature';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';
import { AssetsRelationsService } from './services/assets-relations.service';

/**
 * The Relations tab of an asset (lot R2h) in one round trip: the relations between assets in
 * their four directions, then budget lines (OPEX and CAPEX), contracts, projects, tasks and
 * incidents. A section the caller cannot read is null. Web links and attachments stay on their
 * own routes and are only counted here. The impact and the technologies keep their own sections.
 *
 * Writes go one link at a time, the asset row locked first:
 * - relations between assets through `AssetsRelationsService` (`addRelation`, `removeRelation`):
 *   the audit entry lists the source asset's relations, which `setOwnedLink` does not write;
 * - budget lines, contracts and projects through `setOwnedLink`, with the asset's audit form
 *   (`recordId` the asset, `{ ids }` before and after; a CAPEX line under `asset_capex_items`,
 *   as the budget line writes it from its side). Projects gained that audit: their replacement
 *   wrote none;
 * - tasks through `TasksUnifiedService`, the stored set plus or minus one task, so each task
 *   records the change in its activity;
 * - incidents through `IncidentRelationsService` (visibility, open state, incident lock, journal).
 */

/** The four directions of a relation between assets, as the tab shows them. */
export const ASSET_DIRECTIONS = ['contains', 'contained_by', 'depends_on', 'depended_on_by'] as const;
export type AssetDirection = (typeof ASSET_DIRECTIONS)[number];

export const ASSET_RELATION_KINDS = [...ASSET_DIRECTIONS, 'budget_lines', 'contracts', 'projects', 'tasks', 'incidents'] as const;
export type AssetRelationKind = (typeof ASSET_RELATION_KINDS)[number];

/** The module each section reads. The relations between assets are the asset's own (infrastructure). */
export const ASSET_RELATION_READS = {
  budget_lines: 'budget',
  contracts: 'contracts',
  projects: 'portfolio_projects',
  tasks: 'tasks',
  incidents: 'incidents',
} as const;

export type AssetRelationsAccess = Record<keyof typeof ASSET_RELATION_READS, boolean>;

export type AssetRelationsContext = {
  manager: EntityManager;
  tenantId: string;
  userId: string | null;
  access: AssetRelationsAccess;
  /** An incident link is written in the incident's journal: it needs `incidents:contributor`. */
  writes: { incidents: boolean };
  /** A Business Contributor's participation scopes. Absent for everyone else. */
  scopes: { project?: ParticipationAccessScope; task?: ParticipationAccessScope };
  /** Confidential incidents show only to their reporter, owner and the registry admins. */
  incidentViewer: IncidentViewer;
};

/** A task linked to the asset, the application tab's fields. */
export type AssetRelatedTask = {
  id: string;
  item_number: number | null;
  title: string;
  status: string | null;
  assignee_name: string | null;
  due_date: string | null;
};

export type AssetRelationsCounts = {
  assets: number;
  budget_lines: number;
  contracts: number;
  projects: number;
  tasks: number;
  incidents: number;
  links: number;
  attachments: number;
  /** The Relations badge: every row above except `assets` (the Dependencies tab), each section only when the caller can read it. */
  total: number;
};

export type AssetRelationsTab = {
  year: number;
  budget_column: { key: string; label: string };
  assets: Record<AssetDirection, RelatedAsset[]>;
  budget_lines: RelatedBudgetLine[] | null;
  /** The linked lines `budget_lines` leaves out, counted (`readRelatedBudgetLines`). */
  budget_lines_hidden: number;
  contracts: RelatedContract[] | null;
  projects: RelatedProject[] | null;
  tasks: AssetRelatedTask[] | null;
  incidents: RelatedIncident[] | null;
  counts: AssetRelationsCounts;
};

type AssetRow = { id: string; tenant_id: string };

const LINES = { links: 'asset_spend_items', owner: 'asset_id' } as const;
const CONTRACTS = { links: 'asset_contracts', owner: 'asset_id' } as const;
const PROJECTS = { links: 'asset_projects', owner: 'asset_id' } as const;
const INCIDENTS = { table: 'incident_assets', column: 'asset_id' } as const;

const OWNED_LINKS: Record<'budget_lines' | 'contracts' | 'projects', OwnedRelationLink> = {
  budget_lines: {
    table: LINES.links,
    ownerColumn: LINES.owner,
    targetColumn: 'spend_item_id',
    notFound: 'Budget line not found.',
    auditTable: (nature: BudgetNature) => auditTableOf(nature, LINES.links),
  },
  contracts: {
    table: CONTRACTS.links,
    ownerColumn: CONTRACTS.owner,
    targetColumn: 'contract_id',
    notFound: 'One or more contracts were not found',
  },
  projects: {
    table: PROJECTS.links,
    ownerColumn: PROJECTS.owner,
    targetColumn: 'project_id',
    notFound: 'One or more projects not found',
  },
};

/** A direction as the stored row: who holds the relation (`source`) and its type. */
const DIRECTION_ROWS: Record<AssetDirection, { type: 'contains' | 'depends_on'; outgoing: boolean }> = {
  contains: { type: 'contains', outgoing: true },
  contained_by: { type: 'contains', outgoing: false },
  depends_on: { type: 'depends_on', outgoing: true },
  depended_on_by: { type: 'depends_on', outgoing: false },
};

const ASSET_NOT_FOUND = 'Asset not found';

export function assetRelationKindOrThrow(value: string): AssetRelationKind {
  if (!(ASSET_RELATION_KINDS as readonly string[]).includes(value)) {
    throw new NotFoundException('Unknown relation type.');
  }
  return value as AssetRelationKind;
}

/** The asset in the tenant, by uuid or by its reference (`AST-n`). 404 otherwise. */
async function loadAsset(mg: EntityManager, tenantId: string, ref: string): Promise<AssetRow> {
  const value = String(ref || '').trim();
  let rows: AssetRow[] = [];
  if (UUID_RE.test(value)) {
    rows = await mg.query(`SELECT id, tenant_id FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, value.toLowerCase()]);
  } else if (/^AST-\d+$/i.test(value)) {
    rows = await mg.query(`SELECT id, tenant_id FROM assets WHERE tenant_id = $1 AND asset_reference = $2`, [tenantId, value.toUpperCase()]);
  }
  if (!rows[0]) throw new NotFoundException(ASSET_NOT_FOUND);
  return rows[0];
}

async function lockAsset(mg: EntityManager, asset: AssetRow): Promise<void> {
  const locked: unknown[] = await mg.query(
    `SELECT 1 FROM assets WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
    [asset.tenant_id, asset.id],
  );
  if (locked.length === 0) throw new NotFoundException(ASSET_NOT_FOUND);
}

@Injectable()
export class AssetRelationsTabService {
  constructor(
    private readonly relations: AssetsRelationsService,
    private readonly fxRates: FxRateService,
    private readonly tasks: TasksUnifiedService,
    private readonly incidents: IncidentRelationsService,
    private readonly audit: AuditService,
  ) {}

  /** The tab in one round trip. One query after the other: the request's connection runs them in turn. */
  async read(ref: string, ctx: AssetRelationsContext): Promise<AssetRelationsTab> {
    const mg = ctx.manager;
    const asset = await loadAsset(mg, ctx.tenantId, ref);
    const tenantId = asset.tenant_id;
    const { year, measure, budget_column } = await readRelationsBudgetColumn(mg, tenantId);
    const assets = await this.listAssetRelations(mg, asset);
    const { budget_lines, budget_lines_hidden } = await readRelatedBudgetLines(
      mg, this.fxRates, LINES, 'asset', tenantId, asset.id, year, measure, ctx.access.budget_lines,
    );
    const contracts = ctx.access.contracts ? await listRelatedContracts(mg, CONTRACTS, tenantId, asset.id) : null;
    const projects = ctx.access.projects ? await listRelatedProjects(mg, PROJECTS, tenantId, asset.id, ctx.scopes.project) : null;
    const tasks = ctx.access.tasks ? await this.listTasks(mg, tenantId, asset.id, ctx.scopes.task) : null;
    const incidents = ctx.access.incidents
      ? await listRelatedIncidents(mg, tenantId, INCIDENTS, asset.id, ctx.incidentViewer)
      : null;
    const [other]: Array<{ links: number; attachments: number }> = await mg.query(
      `SELECT (SELECT count(*)::int FROM asset_links WHERE tenant_id = $1 AND asset_id = $2) AS links,
              (SELECT count(*)::int FROM asset_attachments WHERE tenant_id = $1 AND asset_id = $2) AS attachments`,
      [tenantId, asset.id],
    );
    const counts = {
      assets: ASSET_DIRECTIONS.reduce((sum, direction) => sum + assets[direction].length, 0),
      budget_lines: budget_lines?.length ?? 0,
      contracts: contracts?.length ?? 0,
      projects: projects?.length ?? 0,
      tasks: tasks?.length ?? 0,
      incidents: incidents?.length ?? 0,
      links: Number(other?.links ?? 0),
      attachments: Number(other?.attachments ?? 0),
    };
    const { assets: _assets, ...otherCounts } = counts;
    const total = Object.values(otherCounts).reduce((sum, n) => sum + n, 0);
    return { year, budget_column, assets, budget_lines, budget_lines_hidden, contracts, projects, tasks, incidents, counts: { ...counts, total } };
  }

  /**
   * Link (`add`) or unlink one object. An unknown kind is 404. A missing read of the target module
   * is 403 before the id is parsed; a bad id is 400 before a missing asset is 404. Linking what is
   * linked, or unlinking what is not, changes nothing and writes no audit row.
   */
  async setLink(
    kindValue: string,
    ref: string,
    targetId: string,
    add: boolean,
    ctx: AssetRelationsContext,
  ): Promise<{ ok: true; changed: boolean }> {
    const kind = assetRelationKindOrThrow(kindValue);
    const mg = ctx.manager;
    if (kind === 'budget_lines' || kind === 'contracts' || kind === 'projects') {
      return setOwnedLink({
        manager: mg,
        userId: ctx.userId,
        kind,
        targetId,
        add,
        allowed: ctx.access[kind],
        loadOwner: async () => {
          const asset = await loadAsset(mg, ctx.tenantId, ref);
          return { id: asset.id, tenantId: asset.tenant_id };
        },
        owner: { table: 'assets', idColumn: 'id' },
        ownerNotFound: ASSET_NOT_FOUND,
        link: OWNED_LINKS[kind],
        projectScope: kind === 'projects' ? ctx.scopes.project : undefined,
        audit: this.idsAudit(),
      });
    }
    if (kind === 'tasks' || kind === 'incidents') {
      if (!ctx.access[kind]) throw new ForbiddenException('You cannot read this module.');
      if (kind === 'incidents' && !ctx.writes.incidents) throw new ForbiddenException('You cannot edit this module.');
    }
    const id = parseTargetId(targetId);
    const asset = await loadAsset(mg, ctx.tenantId, ref);
    const tenantId = asset.tenant_id;
    const userId = ctx.userId;

    if (kind === 'tasks') {
      await lockAsset(mg, asset);
      return this.setTaskLink(mg, asset, id, add, ctx);
    }
    if (kind === 'incidents') {
      await lockAsset(mg, asset);
      // The incident's own service: visibility first, the open state, the incident row lock, the
      // journal entry and the audit; the set is read under that lock.
      const res = await this.incidents.setAssetLink(id, asset.id, add, userId, { manager: mg, tenantId, viewer: ctx.incidentViewer });
      return { ok: true, changed: res.changed };
    }

    // A relation between assets is stored on its source: this asset for `contains` and
    // `depends_on`, the other one for `contained_by` and `depended_on_by`. The service locks the
    // source and audits its relations, exactly as the asset's own replacement does.
    if (id === String(asset.id).toLowerCase()) throw new BadRequestException('Asset cannot have a relation to itself');
    // The other asset first, so a missing one is the same 400 whichever side holds the relation.
    const other: unknown[] = await mg.query(`SELECT 1 FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    if (other.length === 0) throw new BadRequestException('One or more related assets were not found');
    const row = DIRECTION_ROWS[kind];
    const [source, related] = row.outgoing ? [asset.id, id] : [id, asset.id];
    const opts = { manager: mg, tenantId };
    const changed = add
      ? await this.relations.addRelation(source, related, row.type, tenantId, userId, opts)
      : await this.relations.removeRelation(source, related, row.type, tenantId, userId, opts);
    return { ok: true, changed };
  }

  /**
   * The stored set plus or minus one task, replaced by the task service, which checks the id
   * (400 `Invalid task_ids`) and records the change in each task's activity. Only the tasks the
   * caller can read are compared and touched: a task outside a Business Contributor's scope
   * reads as absent.
   */
  private async setTaskLink(
    mg: EntityManager,
    asset: AssetRow,
    taskId: string,
    add: boolean,
    ctx: AssetRelationsContext,
  ): Promise<{ ok: true; changed: boolean }> {
    const params: unknown[] = [asset.tenant_id, asset.id];
    const bind = binder(params);
    const scopeSql = ctx.scopes.task ? `AND ${taskParticipantCondition('t', bind(ctx.scopes.task.userId))}` : '';
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT l.task_id::text AS id FROM task_assets l JOIN tasks t ON t.id = l.task_id AND t.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.asset_id = $2 ${scopeSql}`,
      params,
    );
    const current = rows.map((row) => String(row.id).toLowerCase());
    if (current.includes(taskId) === add) return { ok: true, changed: false };
    const next = add ? [...current, taskId] : current.filter((value) => value !== taskId);
    await this.tasks.bulkReplaceTasksForAsset(asset.id, next, {
      manager: mg,
      tenantId: asset.tenant_id,
      userId: ctx.userId,
      accessScope: ctx.scopes.task,
    });
    return { ok: true, changed: true };
  }

  /** The asset's audit form of a link set: the label `setOwnedLink` resolved, `{ ids }` before and after. */
  private idsAudit(): OwnedLinkAudit {
    return {
      log: (entry, opts) => this.audit.log(
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
  }

  /** The relations of the asset in both directions, with the other asset's fields, by name. */
  private async listAssetRelations(mg: EntityManager, asset: AssetRow): Promise<Record<AssetDirection, RelatedAsset[]>> {
    const rows: Array<RelatedAsset & { relation_type: 'contains' | 'depends_on'; outgoing: boolean }> = await mg.query(
      `SELECT r.relation_type, (r.asset_id = $2) AS outgoing,
              a.id, a.asset_reference AS reference, a.name, a.kind, a.environment, a.status
         FROM asset_relations r
         JOIN assets a ON a.tenant_id = r.tenant_id
                      AND a.id = CASE WHEN r.asset_id = $2 THEN r.related_asset_id ELSE r.asset_id END
        WHERE r.tenant_id = $1 AND (r.asset_id = $2 OR r.related_asset_id = $2)
        ORDER BY lower(a.name), a.id`,
      [asset.tenant_id, asset.id],
    );
    const out: Record<AssetDirection, RelatedAsset[]> = { contains: [], contained_by: [], depends_on: [], depended_on_by: [] };
    for (const { relation_type, outgoing, ...related } of rows) {
      const direction = ASSET_DIRECTIONS.find((d) => DIRECTION_ROWS[d].type === relation_type && DIRECTION_ROWS[d].outgoing === outgoing);
      if (direction) out[direction].push(related);
    }
    return out;
  }

  /** Tasks linked to the asset, open ones first, then by due date. */
  private async listTasks(mg: EntityManager, tenantId: string, assetId: string, scope?: ParticipationAccessScope): Promise<AssetRelatedTask[]> {
    const params: unknown[] = [tenantId, assetId];
    const bind = binder(params);
    const scopeSql = scope ? `AND ${taskParticipantCondition('t', bind(scope.userId))}` : '';
    return mg.query(
      `SELECT t.id, t.item_number, t.title, t.status,
              NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS assignee_name,
              ${dateText('t.due_date')} AS due_date
         FROM task_assets l
         JOIN tasks t ON t.id = l.task_id AND t.tenant_id = l.tenant_id
         LEFT JOIN users u ON u.id = t.assignee_user_id AND u.tenant_id = t.tenant_id
        WHERE l.tenant_id = $1 AND l.asset_id = $2 ${scopeSql}
        ORDER BY (COALESCE(t.status, '') IN ('done', 'cancelled')) ASC, t.due_date ASC NULLS LAST, t.item_number ASC NULLS LAST, t.id`,
      params,
    );
  }
}
