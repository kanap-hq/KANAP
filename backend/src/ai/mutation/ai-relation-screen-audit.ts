import type { EntityManager } from 'typeorm';
import type { AuditService } from '../../audit/audit.service';
import { singleChangedId, type AuditParent } from '../../audit/audit-parent-rules';
import { hiddenContractLineCount } from '../../contracts/contract-relations';
import { auditedLinkSet, hiddenLineCount, type HiddenLineOwner } from '../../data-access/hidden-links';
import { auditTableOf, BUDGET_NATURES, linkedLineOf, naturesAnd, type BudgetNature } from '../../spend/budget-nature';
import type { AiMutationAuditOptions } from './ai-mutation-audit.util';

/**
 * The audit trace a relation the assistant replaces leaves, in the form the screen writes for the
 * same gesture (lot K2b): the same tables, the same before and after values, the same records
 * marked, so the History tab reads it through the screen's presenters. The rows carry the card's
 * source (`ai_chat`, the preview id).
 *
 * The trace reads the stored state the screen reads, before and after the assistant's write, in
 * the approval's transaction:
 * - a set the screen replaces whole (an application's owners, companies, departments and support
 *   contacts; an asset's relations and cluster members; a contract's budget lines) is one row: the
 *   stored set before and after, in the screen's form;
 * - a link a Relations tab adds or removes one at a time (`setOwnedLink`, or a replacement of the
 *   set plus or minus one: an application's contracts, a project's and a request's applications,
 *   assets and lines) is one row per link added or removed, the removals first, each from the set
 *   the previous one left. A budget line's link is labelled by the line's nature (`auditTableOf`)
 *   and counts the lines the person cannot read (`auditedLinkSet`); the row names the parent the
 *   screen names (the line, the application or the asset toggled; from a line, the line itself);
 * - the rows the screen writes one per link (web links, server assignments, the contacts of a
 *   supplier, a contract or a line, a site's contacts and sub-locations) are audited row by row by
 *   the writer itself (`ROW_AUDITED_RELATIONS`).
 *
 * Every relation of the writer has one of the two (`ai-relation-mutation-support.service.spec.ts`).
 */

type TraceContext = { manager: EntityManager; tenantId: string; userId: string | null };

type ScreenTrace = {
  read: (context: TraceContext, sourceId: string) => Promise<unknown>;
  log: (context: TraceContext, audit: AuditService, source: AiMutationAuditOptions, sourceId: string, before: unknown) => Promise<void>;
};

function sortedIds(rows: Array<{ id: string }>): string[] {
  return Array.from(new Set(rows.map((row) => String(row.id).toLowerCase()))).sort();
}

/** One row on the record, when the stored set changed: the screen's whole-set replacement. */
function wholeSet(table: string, read: (context: TraceContext, sourceId: string) => Promise<unknown>): ScreenTrace {
  return {
    read,
    log: async (context, audit, source, sourceId, before) => {
      const after = await read(context, sourceId);
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      await audit.log(
        { table, recordId: sourceId, action: 'update', before, after, userId: context.userId, source: source.source, sourceRef: source.sourceRef },
        { manager: context.manager },
      );
    },
  };
}

const stateList = (sql: string) => async (context: TraceContext, sourceId: string): Promise<string[]> => {
  const rows: Array<{ state: string }> = await context.manager.query(sql, [context.tenantId, sourceId]);
  return rows.map((row) => String(row.state)).sort();
};

/**
 * One link table of a Relations tab, by audit label: its stored set, as the tab reads it. `line`: a
 * set of budget lines (the lines the person cannot read are counted). `parent`: the record the
 * screen names for the link toggled (`id`) from the source (`sourceId`).
 */
type ToggleSet = { label: string; sql: string; line: boolean; parent?: (sourceId: string, id: string) => AuditParent };

/**
 * One row per link added or removed (`setOwnedLink`): each one from the set the previous one left,
 * the removals first. `form` gives the screen's before and after values for a set, `hidden` the
 * lines the person cannot read, kept and counted.
 */
function toggles(
  sets: ToggleSet[],
  form: (set: string[], hidden: number) => unknown,
  hiddenOwner: HiddenLineOwner | null,
): ScreenTrace {
  const read = async (context: TraceContext, sourceId: string): Promise<Record<string, string[]>> => {
    const out: Record<string, string[]> = {};
    for (const set of sets) out[set.label] = sortedIds(await context.manager.query(set.sql, [context.tenantId, sourceId]));
    return out;
  };
  return {
    read,
    log: async (context, audit, source, sourceId, beforeValue) => {
      const before = beforeValue as Record<string, string[]>;
      const after = await read(context, sourceId);
      const steps: Array<{ set: ToggleSet; id: string; add: boolean }> = [];
      for (const add of [false, true]) {
        for (const set of sets) {
          const from = new Set(before[set.label]);
          const to = new Set(after[set.label]);
          const changed = add ? after[set.label].filter((id) => !from.has(id)) : before[set.label].filter((id) => !to.has(id));
          for (const id of changed) steps.push({ set, id, add });
        }
      }
      if (steps.length === 0) return;
      const hidden = hiddenOwner && sets.some((set) => set.line) ? await hiddenLineCount(context.manager, hiddenOwner, sourceId) : 0;
      const current: Record<string, string[]> = { ...before };
      for (const step of steps) {
        const previous = current[step.set.label];
        const next = (step.add ? [...previous, step.id] : previous.filter((id) => id !== step.id)).sort();
        current[step.set.label] = next;
        const kept = step.set.line ? hidden : 0;
        await audit.log(
          {
            table: step.set.label,
            recordId: sourceId,
            action: 'update',
            before: form(previous, kept),
            after: form(next, kept),
            userId: context.userId,
            source: source.source,
            sourceRef: source.sourceRef,
            ...(step.set.parent ? { parent: step.set.parent(sourceId, step.id) } : {}),
          },
          { manager: context.manager },
        );
      }
    },
  };
}

/** The line toggled is the row's parent: the line's history shows the link. */
const toggledLine = (_sourceId: string, id: string): AuditParent => ({ table: 'spend_items', id });

/**
 * A budget line link of each nature, as the Relations tab reads it (`setOwnedLink`, `linkedLineOf`):
 * labelled by the line's nature, `lineColumn` the link's column naming the line.
 */
function lineSets(table: string, ownerColumn: string, lineColumn: string, parent?: ToggleSet['parent']): ToggleSet[] {
  return BUDGET_NATURES.map((nature) => ({
    label: auditTableOf(nature, table),
    sql: `SELECT l.${lineColumn} AS id FROM ${table} l WHERE l.tenant_id = $1 AND l.${ownerColumn} = $2${linkedLineOf('l.tenant_id', `l.${lineColumn}`, nature)}`,
    line: true,
    parent,
  }));
}

function plainSet(table: string, ownerColumn: string, targetColumn: string, parent?: ToggleSet['parent']): ToggleSet[] {
  return [{ label: table, sql: `SELECT l.${targetColumn} AS id FROM ${table} l WHERE l.tenant_id = $1 AND l.${ownerColumn} = $2`, line: false, parent }];
}

/**
 * A budget line's own Relations tab (`setBudgetLineRelation`): the rows carry the label of the
 * line's nature (`application_capex_items` for a CAPEX line) and name the line as parent.
 */
function fromLine(table: string, lineColumn: string, targetColumn: string): ScreenTrace {
  const traces = new Map<BudgetNature, ScreenTrace>(BUDGET_NATURES.map((nature) => [
    nature,
    toggles(
      [{ ...plainSet(table, lineColumn, targetColumn)[0], label: auditTableOf(nature, table), parent: (lineId) => ({ table: 'spend_items', id: lineId }) }],
      (set) => set,
      null,
    ),
  ]));
  const natureOf = async (context: TraceContext, lineId: string): Promise<BudgetNature> => {
    const rows: Array<{ nature: BudgetNature }> = await context.manager.query(
      `SELECT nature FROM spend_items WHERE tenant_id = $1 AND id = $2${naturesAnd(null, BUDGET_NATURES)}`,
      [context.tenantId, lineId],
    );
    return rows[0]?.nature === 'capex' ? 'capex' : 'opex';
  };
  return {
    read: async (context, lineId) => {
      const nature = await natureOf(context, lineId);
      return { nature, set: await traces.get(nature)!.read(context, lineId) };
    },
    log: async (context, audit, source, lineId, before) => {
      const { nature, set } = before as { nature: BudgetNature; set: unknown };
      await traces.get(nature)!.log(context, audit, source, lineId, set);
    },
  };
}

/**
 * The contract's Budget tab (`replaceContractRelations`): one row on `contract_spend_items` for the
 * whole set, the lines of both natures the person reads, the hidden ones counted
 * (`hiddenContractLineCount`), and the line as parent when exactly one changed.
 */
const contractLines: ScreenTrace = (() => {
  const read = async (context: TraceContext, contractId: string): Promise<string[]> => sortedIds(await context.manager.query(
    `SELECT DISTINCT l.spend_item_id AS id FROM contract_spend_items l
      WHERE l.tenant_id = $1 AND l.contract_id = $2
        AND EXISTS (SELECT 1 FROM spend_items i WHERE i.tenant_id = l.tenant_id AND i.id = l.spend_item_id${naturesAnd('i', BUDGET_NATURES)})`,
    [context.tenantId, contractId],
  ));
  return {
    read,
    log: async (context, audit, source, contractId, beforeValue) => {
      const before = beforeValue as string[];
      const after = await read(context, contractId);
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      const hidden = await hiddenContractLineCount(context.manager, { id: contractId, tenant_id: context.tenantId });
      const lineId = singleChangedId(before, after);
      await audit.log(
        {
          table: 'contract_spend_items',
          recordId: contractId,
          action: 'update',
          before: auditedLinkSet({ ids: before }, hidden),
          after: auditedLinkSet({ ids: after }, hidden),
          userId: context.userId,
          source: source.source,
          sourceRef: source.sourceRef,
          parent: lineId ? { table: 'spend_items', id: lineId } : null,
        },
        { manager: context.manager },
      );
    },
  };
})();

/** The sorted ids of a link set, with the count of hidden lines (`auditedLinkSet`): the application's and the line's form. */
const idList = (set: string[], hidden: number) => auditedLinkSet(set, hidden);
/** The `{ ids }` form (`AssetRelationsTabService.idsAudit`, the project's and the request's replacements). */
const idsSet = (set: string[], hidden: number) => auditedLinkSet({ ids: set }, hidden);

const SCREEN_TRACES: Readonly<Record<string, ScreenTrace>> = {
  // `ApplicationsOwnersService`: the sorted `"<type>:<user_id>"`, company, department and
  // `"<contact_id>:<role>"` states of the whole set.
  'applications.owners': wholeSet('application_owners', stateList(
    `SELECT owner_type || ':' || user_id::text AS state FROM application_owners WHERE tenant_id = $1 AND application_id = $2`,
  )),
  'applications.companies': wholeSet('application_companies', stateList(
    `SELECT company_id::text AS state FROM application_companies WHERE tenant_id = $1 AND application_id = $2`,
  )),
  'applications.departments': wholeSet('application_departments', stateList(
    `SELECT department_id::text AS state FROM application_departments WHERE tenant_id = $1 AND application_id = $2`,
  )),
  'applications.support_contacts': wholeSet('application_support_contacts', stateList(
    `SELECT contact_id::text || ':' || COALESCE(role, '') AS state FROM application_support_contacts WHERE tenant_id = $1 AND application_id = $2`,
  )),
  // The application's Relations tab (`ApplicationsRelationsService.setLink`).
  'applications.budget_lines': toggles(lineSets('application_spend_items', 'application_id', 'spend_item_id'), idList, 'application'),
  'applications.contracts': toggles(plainSet('application_contracts', 'application_id', 'contract_id'), idList, null),
  'applications.projects': toggles(plainSet('application_projects', 'application_id', 'project_id'), idList, null),
  // The asset's Relations tab (`AssetRelationsTabService.setLink`).
  'assets.budget_lines': toggles(lineSets('asset_spend_items', 'asset_id', 'spend_item_id', toggledLine), idsSet, 'asset'),
  'assets.contracts': toggles(plainSet('asset_contracts', 'asset_id', 'contract_id'), idsSet, null),
  'assets.projects': toggles(plainSet('asset_projects', 'asset_id', 'project_id'), idsSet, null),
  // `AssetsRelationsService.bulkReplaceRelations` and `AssetsCrudService.replaceClusterMembers`.
  'assets.relations': wholeSet('asset_relations', async (context, assetId) => {
    const rows: Array<{ related_asset_id: string; relation_type: string }> = await context.manager.query(
      `SELECT related_asset_id::text AS related_asset_id, relation_type FROM asset_relations
        WHERE tenant_id = $1 AND asset_id = $2 ORDER BY created_at, id`,
      [context.tenantId, assetId],
    );
    return { relations: rows.map((row) => ({ related_asset_id: row.related_asset_id, relation_type: row.relation_type })) };
  }),
  'assets.cluster_members': wholeSet('asset_cluster_members', async (context, clusterId) => {
    const rows: Array<{ id: string }> = await context.manager.query(
      `SELECT asset_id::text AS id FROM asset_cluster_members WHERE tenant_id = $1 AND cluster_id = $2 ORDER BY created_at, asset_id`,
      [context.tenantId, clusterId],
    );
    return { members: rows.map((row) => row.id) };
  }),
  // No screen writes an asset's support contacts: the form of the application's, which the
  // contact presenter reads the same way.
  'assets.support_contacts': wholeSet('asset_support_contacts', stateList(
    `SELECT contact_id::text || ':' || COALESCE(role, '') AS state FROM asset_support_contacts WHERE tenant_id = $1 AND asset_id = $2`,
  )),
  'contracts.budget_lines': contractLines,
  // The line's Relations tab (`setBudgetLineRelation`).
  'budget_lines.applications': fromLine('application_spend_items', 'spend_item_id', 'application_id'),
  'budget_lines.projects': fromLine('portfolio_project_opex', 'opex_id', 'project_id'),
  'budget_lines.contracts': fromLine('contract_spend_items', 'spend_item_id', 'contract_id'),
  // The project's Relations tab (`PortfolioRelationsService.setProjectLink`): the replacement of the
  // set plus or minus one, which names the application, the asset or the line toggled.
  'projects.applications': toggles(plainSet('application_projects', 'project_id', 'application_id', (_projectId, id) => ({ table: 'applications', id })), idsSet, null),
  'projects.assets': toggles(plainSet('asset_projects', 'project_id', 'asset_id', (_projectId, id) => ({ table: 'assets', id })), idsSet, null),
  'projects.budget_lines': toggles(lineSets('portfolio_project_opex', 'project_id', 'opex_id', toggledLine), idsSet, 'project'),
  // The request's Relations tab (`setRequestLink`): its applications and assets name no parent.
  'requests.applications': toggles(plainSet('portfolio_request_applications', 'request_id', 'application_id'), idsSet, null),
  'requests.assets': toggles(plainSet('portfolio_request_assets', 'request_id', 'asset_id'), idsSet, null),
  'requests.budget_lines': toggles(lineSets('portfolio_request_opex', 'request_id', 'opex_id', toggledLine), idsSet, 'request'),
  'requests.business_processes': toggles(plainSet('portfolio_request_business_processes', 'request_id', 'business_process_id'), idList, null),
};

/**
 * The relations whose writer audits each row as the screen does: web links, server assignments,
 * the contacts of a supplier (`SupplierContactsService`), a contract or a line, a site's contacts
 * and sub-locations.
 */
export const ROW_AUDITED_RELATIONS: ReadonlySet<string> = new Set([
  'applications.links',
  'applications.asset_assignments',
  'assets.links',
  'suppliers.contacts',
  'contracts.contacts',
  'contracts.links',
  'budget_lines.contacts',
  'budget_lines.links',
  'locations.internal_contacts',
  'locations.external_contacts',
  'locations.links',
  'locations.sub_locations',
]);

export function screenTraceOf(sourceEntity: string, relation: string): ScreenTrace | null {
  return SCREEN_TRACES[`${sourceEntity}.${relation}`] ?? null;
}
