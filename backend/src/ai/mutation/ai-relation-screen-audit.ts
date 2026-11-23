import type { EntityManager } from 'typeorm';
import type { AuditService } from '../../audit/audit.service';
import { auditedLinkSet, hiddenLineCount, type HiddenLineOwner } from '../../data-access/hidden-links';
import { auditTableOf, BUDGET_NATURES, linkedLineOf } from '../../spend/budget-nature';
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
 *   contacts; an asset's relations and cluster members) is one row: the stored set before and
 *   after, in the screen's form;
 * - a link the Relations tab adds or removes one at a time (`setOwnedLink`, and an application's
 *   contracts, which replace the set plus or minus one) is one row per link added or removed, the
 *   removals first, each from the set the previous one left. A budget line's link is labelled by
 *   the line's nature (`auditTableOf`) and counts the lines the person cannot read
 *   (`auditedLinkSet`); from an asset the line is the row's parent, so its own history shows it;
 * - the web links and the server assignments are audited row by row by the writer itself
 *   (`ROW_AUDITED_RELATIONS`), as the screen audits each link.
 *
 * Relations without an entry here keep the assistant's own summary row until they get theirs.
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

/** One link table of the Relations tab, by audit label: its stored set, as the tab reads it. */
type ToggleSet = { label: string; sql: string; line: boolean };

/**
 * One row per link added or removed (`setOwnedLink`): each one from the set the previous one left,
 * the removals first. `form` gives the screen's before and after values for a set, `hidden` the
 * lines the person cannot read, kept and counted.
 */
function toggles(
  sets: ToggleSet[],
  form: (set: string[], hidden: number) => unknown,
  hiddenOwner: HiddenLineOwner | null,
  lineParent = false,
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
            // The asset's Relations tab names the line it added or removed: the line's history shows it.
            ...(step.set.line && lineParent ? { parent: { table: 'spend_items' as const, id: step.id } } : {}),
          },
          { manager: context.manager },
        );
      }
    },
  };
}

/** A budget line link of each nature, as the Relations tab reads it (`setOwnedLink`, `linkedLineOf`). */
function lineSets(table: string, ownerColumn: string): ToggleSet[] {
  return BUDGET_NATURES.map((nature) => ({
    label: auditTableOf(nature, table),
    sql: `SELECT l.spend_item_id AS id FROM ${table} l WHERE l.tenant_id = $1 AND l.${ownerColumn} = $2${linkedLineOf('l.tenant_id', 'l.spend_item_id', nature)}`,
    line: true,
  }));
}

function plainSet(table: string, ownerColumn: string, targetColumn: string): ToggleSet[] {
  return [{ label: table, sql: `SELECT l.${targetColumn} AS id FROM ${table} l WHERE l.tenant_id = $1 AND l.${ownerColumn} = $2`, line: false }];
}

/** The application's form of a link set: the sorted ids, with the count of hidden lines (`auditedLinkSet`). */
const applicationSet = (set: string[], hidden: number) => auditedLinkSet(set, hidden);
/** The asset's form (`AssetRelationsTabService.idsAudit`): the same set under `ids`. */
const assetSet = (set: string[], hidden: number) => ({ ids: auditedLinkSet(set, hidden) });

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
  'applications.budget_lines': toggles(lineSets('application_spend_items', 'application_id'), applicationSet, 'application'),
  'applications.contracts': toggles(plainSet('application_contracts', 'application_id', 'contract_id'), applicationSet, null),
  'applications.projects': toggles(plainSet('application_projects', 'application_id', 'project_id'), applicationSet, null),
  // The asset's Relations tab (`AssetRelationsTabService.setLink`).
  'assets.budget_lines': toggles(lineSets('asset_spend_items', 'asset_id'), assetSet, 'asset', true),
  'assets.contracts': toggles(plainSet('asset_contracts', 'asset_id', 'contract_id'), assetSet, null),
  'assets.projects': toggles(plainSet('asset_projects', 'asset_id', 'project_id'), assetSet, null),
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
};

/** The relations whose writer audits each row as the screen does (web links, server assignments). */
export const ROW_AUDITED_RELATIONS: ReadonlySet<string> = new Set([
  'applications.links',
  'applications.asset_assignments',
  'assets.links',
]);

export function screenTraceOf(sourceEntity: string, relation: string): ScreenTrace | null {
  return SCREEN_TRACES[`${sourceEntity}.${relation}`] ?? null;
}
