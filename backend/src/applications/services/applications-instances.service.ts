import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Application } from '../application.entity';
import { PortfolioProject } from '../../portfolio/portfolio-project.entity';
import { AuditService } from '../../audit/audit.service';
import { ApplicationsBaseService, ServiceOpts } from './applications-base.service';
import { projectParticipantCondition } from '../../auth/business-contributor-scope';
import { assertScopeNatures, linkedLineOf, natureAnd, type BudgetNature } from '../../spend/budget-nature';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LinkedItemKind = 'spend' | 'capex' | 'contract' | 'project';

/** Row shape of each list: the item's own label column, as the workspace relations panel reads it. */
type LinkedItemRow = {
  spend: { id: string; product_name: string };
  capex: { id: string; description: string };
  contract: { id: string; name: string };
};

type LinkedItemTable = { links: string; items: string; itemFk: string; label: string; unique: string; notFound: string; nature?: BudgetNature };

// Table and column names come only from here: never from the caller. `unique`
// is the link table's unique key, the target of the insert's ON CONFLICT.
// `nature`: the OPEX lines of `spend_items` (`spend/budget-nature.ts`): a
// replacement lists, checks, keeps and removes the links of those lines only,
// never a link of the application to a line of another nature.
const LINKED_ITEMS: Record<LinkedItemKind, LinkedItemTable> = {
  spend: {
    links: 'application_spend_items',
    items: 'spend_items',
    itemFk: 'spend_item_id',
    label: 'product_name',
    unique: '(tenant_id, application_id, spend_item_id)',
    notFound: 'One or more OPEX items were not found.',
    nature: 'opex',
  },
  capex: {
    links: 'application_capex_items',
    items: 'capex_items',
    itemFk: 'capex_item_id',
    label: 'description',
    unique: '(tenant_id, application_id, capex_item_id)',
    notFound: 'One or more CAPEX items were not found.',
  },
  contract: {
    links: 'application_contracts',
    items: 'contracts',
    itemFk: 'contract_id',
    label: 'name',
    unique: '(tenant_id, application_id, contract_id)',
    notFound: 'One or more contracts were not found.',
  },
  project: {
    links: 'application_projects',
    items: 'portfolio_projects',
    itemFk: 'project_id',
    label: 'name',
    unique: '(application_id, project_id)',
    notFound: 'One or more projects were not found.',
  },
};

assertScopeNatures('applications LINKED_ITEMS', LINKED_ITEMS, (t) => t.items);

/** ` AND` the link `alias` names a line of the entry's nature; empty for an entry without one. */
function linkedNature(t: LinkedItemTable, alias: string): string {
  return linkedLineOf(`${alias}.tenant_id`, `${alias}.${t.itemFk}`, t.nature, t.items);
}

/**
 * Service for managing application relations (spend items, capex items, contracts, projects).
 */
@Injectable()
export class ApplicationsInstancesService extends ApplicationsBaseService {
  constructor(
    @InjectRepository(Application) appRepo: Repository<Application>,
    @InjectRepository(PortfolioProject) private readonly projectRepo: Repository<PortfolioProject>,
    private readonly audit: AuditService,
  ) {
    super(appRepo);
  }

  // Relations - OPEX and CAPEX lines, contracts
  async listLinkedSpendItems(appId: string, opts?: ServiceOpts) {
    return { items: await this.listLinkedItems('spend', appId, opts) };
  }

  async bulkReplaceLinkedSpendItems(appId: string, spendItemIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.replaceLinkedItems('spend', appId, spendItemIds, userId, opts);
  }

  async listLinkedCapexItems(appId: string, opts?: ServiceOpts) {
    return { items: await this.listLinkedItems('capex', appId, opts) };
  }

  async bulkReplaceLinkedCapexItems(appId: string, capexItemIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.replaceLinkedItems('capex', appId, capexItemIds, userId, opts);
  }

  async listLinkedContracts(appId: string, opts?: ServiceOpts) {
    return { items: await this.listLinkedItems('contract', appId, opts) };
  }

  async bulkReplaceLinkedContracts(appId: string, contractIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.replaceLinkedItems('contract', appId, contractIds, userId, opts);
  }

  /** The application's lines or contracts, as `{ id, product_name }` (OPEX), `{ id, description }` (CAPEX) or `{ id, name }` (contracts). */
  private async listLinkedItems<K extends keyof LinkedItemRow>(kind: K, appId: string, opts?: ServiceOpts): Promise<Array<LinkedItemRow[K]>> {
    const t = LINKED_ITEMS[kind];
    const mg = this.getManager(opts);
    const app = await this.ensureApp(appId, mg, opts?.accessScope);
    return mg.query(
      `SELECT i.id, i.${t.label}
       FROM ${t.links} l
       JOIN ${t.items} i ON i.id = l.${t.itemFk} AND i.tenant_id = l.tenant_id${natureAnd('i', t.nature)}
       WHERE l.tenant_id = $1 AND l.application_id = $2`,
      [app.tenant_id, app.id],
    );
  }

  /**
   * Replace the application's lines, contracts or projects with `itemIds`
   * (trimmed, lower-cased, deduplicated). Every id must name a row of the
   * tenant: foreign-key checks bypass RLS, so the ids are resolved here (400
   * otherwise). The application's row is locked first (FOR NO KEY UPDATE, which
   * the link keys' FOR KEY SHARE checks do not wait for): a second replacement
   * of the same application waits, then reads the set the first one committed,
   * so the last one wins and its audit row matches what is stored. A link
   * another writer has just inserted is skipped, not duplicated. One audit row
   * on the link table when the set changes: `recordId` the application, before
   * and after the sorted ids.
   */
  private async replaceLinkedItems(
    kind: LinkedItemKind,
    appId: string,
    itemIds: string[],
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    const t = LINKED_ITEMS[kind];
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const tenantId = await this.getCurrentTenantId(mg);
    // Stored ids are lower case: an upper-case id must compare equal to its stored twin.
    const nextIds = Array.from(new Set((itemIds || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))).sort();
    if (nextIds.some((id) => !UUID_RE.test(id))) throw new BadRequestException(t.notFound);
    const locked = await mg.query(
      `SELECT 1 FROM applications WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
      [tenantId, resolvedAppId],
    );
    if (locked.length === 0) throw new NotFoundException('Application not found');
    if (nextIds.length) {
      const found: Array<{ id: string }> = await mg.query(
        `SELECT id FROM ${t.items} WHERE tenant_id = $1 AND id = ANY($2::uuid[])${natureAnd(null, t.nature)}`,
        [tenantId, nextIds],
      );
      if (found.length !== nextIds.length) throw new BadRequestException(t.notFound);
    }

    const existing: Array<{ item_id: string }> = await mg.query(
      `SELECT l.${t.itemFk} AS item_id FROM ${t.links} l WHERE l.tenant_id = $1 AND l.application_id = $2${linkedNature(t, 'l')}`,
      [tenantId, resolvedAppId],
    );
    const beforeState = Array.from(new Set(existing.map((r) => r.item_id))).sort();
    const [{ n: removed }] = await mg.query(
      `WITH d AS (
         DELETE FROM ${t.links} l
         WHERE l.tenant_id = $1 AND l.application_id = $2 AND l.${t.itemFk} <> ALL($3::uuid[])${linkedNature(t, 'l')}
         RETURNING 1
       )
       SELECT count(*)::int AS n FROM d`,
      [tenantId, resolvedAppId, nextIds],
    );
    const [{ n: added }] = await mg.query(
      `WITH ins AS (
         INSERT INTO ${t.links} (tenant_id, application_id, ${t.itemFk})
         SELECT $1, $2, item_id FROM unnest($3::uuid[]) AS item_id
         ON CONFLICT ${t.unique} DO NOTHING
         RETURNING 1
       )
       SELECT count(*)::int AS n FROM ins`,
      [tenantId, resolvedAppId, nextIds],
    );
    if (JSON.stringify(beforeState) !== JSON.stringify(nextIds)) {
      await this.audit.log(
        {
          table: t.links,
          recordId: resolvedAppId,
          action: 'update',
          before: beforeState,
          after: nextIds,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    return { ok: true, added, removed };
  }

  // Projects
  async listProjects(applicationId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const app = await this.ensureApp(applicationId, mg, opts?.accessScope);
    const params: unknown[] = [app.tenant_id, app.id];
    const projectScopeSql = opts?.projectAccessScope
      ? (() => {
        params.push(opts.projectAccessScope.userId);
        return `AND ${projectParticipantCondition('p', `$${params.length}`)}`;
      })()
      : '';
    const rows = await mg.query(
      `SELECT l.project_id as id, p.name
       FROM application_projects l
       JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
       WHERE l.tenant_id = $1 AND l.application_id = $2
         ${projectScopeSql}
       ORDER BY p.name ASC`,
      params,
    );
    return { items: rows };
  }

  async bulkReplaceProjects(applicationId: string, projectIds: string[], userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    await this.replaceLinkedItems('project', applicationId, projectIds, userId, { manager: mg });
    return this.listProjects(applicationId, { manager: mg });
  }
}
