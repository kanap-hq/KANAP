import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { moduleRightRequired } from '../auth/module-right-required';
import { RECORD_HISTORY, recordHistoryEntry } from '../audit/record-history.inventory';
import {
  RecordHistoryService,
  type RecordHistoryActor,
  type RecordHistorySubject,
} from '../audit/record-history.service';
import { resolveBudgetLine, resolveToUuid } from '../common/resolve-item-id';
import { BUDGET_LINE_TABLE } from '../spend/budget-nature';
import { entityNotFound, isUuid } from './ai-entity-reference.util';
import { AiPolicyService, missingRightMessage } from './ai-policy.service';
import { AiQueryExecutor } from './query/ai-query.executor';
import {
  AI_DETAIL_ENTITY_TYPES,
  type AiDetailEntityType,
  type AiExecutionContextWithManager,
  type AiQueryEntityType,
} from './ai.types';

/**
 * The history of one record for Plaid and the MCP server (`get_record_history`), read by the
 * service of the History tab (`audit/record-history.service.ts`): the same entries, the same
 * rights, the same data access. Nothing is rebuilt here.
 *
 * The families with a history are the AI families whose table is in the history inventory
 * (`audit/record-history.inventory.ts`): a budget line is `spend_items` (both natures), a project
 * `portfolio_projects`, a request `portfolio_requests`, every other family carries its table's name. A table that joins the inventory with the name of an AI family
 * becomes readable here with no change; a table no AI family reads (cost centers, analytics
 * dimensions, working-day calendars) stays out.
 */

function aiFamilyOfHistoryTable(table: string): AiDetailEntityType | null {
  if (table === BUDGET_LINE_TABLE) return 'budget_lines';
  if (table === 'portfolio_projects') return 'projects';
  if (table === 'portfolio_requests') return 'requests';
  return (AI_DETAIL_ENTITY_TYPES as readonly string[]).includes(table) ? table as AiDetailEntityType : null;
}

/** AI family → the table of `GET /records/:table/:id/history`. */
export const AI_RECORD_HISTORY_TABLES: ReadonlyMap<AiDetailEntityType, string> = new Map(
  Object.keys(RECORD_HISTORY).flatMap((table) => {
    const family = aiFamilyOfHistoryTable(table);
    return family ? [[family, table] as const] : [];
  }),
);

/** The AI families whose records have a History tab, sorted. */
export const AI_RECORD_HISTORY_ENTITY_TYPES: readonly AiDetailEntityType[] = Array.from(AI_RECORD_HISTORY_TABLES.keys()).sort();

/** The families in plain words: "budget lines", "business processes". */
export const AI_RECORD_HISTORY_FAMILY_WORDS = AI_RECORD_HISTORY_ENTITY_TYPES.map((type) => type.replace(/_/g, ' ')).join(', ');

/** The refusal of a family whose records have no History tab, with the families that have one. */
export function noRecordHistoryMessage(entityType: string): string {
  return `This record has no history in KANAP: ${String(entityType).replace(/_/g, ' ')} have no History tab. `
    + `The records with a history are: ${AI_RECORD_HISTORY_FAMILY_WORDS}.`;
}

/** What the entries are, said with every page. */
export const AI_RECORD_HISTORY_NOTE = 'These are the entries of the record\'s History tab in KANAP, newest first, and nothing more: '
  + 'an update with no visible change is left out, and a reference the person may not read is given as hidden '
  + '(deleted when the record no longer exists). next_cursor reads the older entries.';

export type GetRecordHistoryInput = {
  entity_type: AiDetailEntityType;
  entity_id: string;
  cursor?: string;
  limit?: number;
};

export type AiRecordHistoryEntryDto = {
  at: string;
  action: string;
  actor: RecordHistoryActor;
  subject: RecordHistorySubject;
  changes: unknown[];
};

export type AiRecordHistoryDto = {
  entity: { type: AiDetailEntityType; id: string };
  items: AiRecordHistoryEntryDto[];
  returned: number;
  next_cursor: string | null;
  truncated: boolean;
  complete: boolean;
  note: string;
};

/**
 * A value of an entry without the uuid of a reference that has a business one (`TEC-3`, `BL-5`):
 * the answer names the reference. A reference without one keeps its id, the only handle on it.
 */
function withoutRawIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRawIds);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const named = typeof record.kind === 'string' && typeof record.id === 'string'
    && typeof record.reference === 'string' && record.reference.trim() !== '';
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !(named && key === 'id'))
      .map(([key, entry]) => [key, withoutRawIds(entry)]),
  );
}

/**
 * A budget line by the reference a screen shows: `OPX-n` (or `OPEX-n`) as the OPEX list reads it,
 * `CPX-n` (or `CAPEX-n`) as the CAPEX list reads it, `BL-n` and a bare number as the neutral
 * reference of either nature.
 */
async function budgetLineId(value: string, manager: EntityManager): Promise<string> {
  const ref = value.replace(/^OPEX-/i, 'OPX-').replace(/^CAPEX-/i, 'CPX-');
  const prefix = ref.match(/^([A-Z]+)-\d+$/i)?.[1]?.toUpperCase();
  if (prefix === 'OPX') return resolveToUuid(ref, 'spend', manager);
  if (prefix === 'CPX') return resolveToUuid(ref, 'capex', manager);
  return (await resolveBudgetLine(ref, manager)).id;
}

/**
 * The pages read at most for one call when they come back empty with a cursor: the History tab
 * leaves out an update with no visible change, so a page of such updates is empty though older
 * entries exist.
 */
const MAX_HISTORY_PAGE_READS = 5;

function isModuleRightRefusal(error: unknown): boolean {
  if (!(error instanceof ForbiddenException)) return false;
  const response = error.getResponse();
  return !!response && typeof response === 'object' && (response as { code?: unknown }).code === 'MODULE_RIGHT_REQUIRED';
}

@Injectable()
export class AiRecordHistoryService {
  constructor(
    private readonly policy: AiPolicyService,
    private readonly queryExecutor: AiQueryExecutor,
    private readonly history: RecordHistoryService,
  ) {}

  /** The record an `entity_id` names, in the person's transaction; a name or reference that matches none is not found. */
  private async recordId(context: AiExecutionContextWithManager, entityType: AiDetailEntityType, rawId: string): Promise<string> {
    const value = String(rawId ?? '').trim();
    if (isUuid(value)) return value;
    try {
      if (entityType === 'budget_lines') return await budgetLineId(value, context.manager);
      if (entityType === 'documents') {
        if (/^DOC-\d+$/i.test(value)) return await resolveToUuid(value, 'document', context.manager);
        throw entityNotFound(entityType, value);
      }
      return await this.queryExecutor.resolveDetailEntityId(context, entityType as AiQueryEntityType, value);
    } catch (error) {
      // A malformed or unknown reference reads as every other read's "not found".
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw entityNotFound(entityType, value);
      throw error;
    }
  }

  async getRecordHistory(context: AiExecutionContextWithManager, input: GetRecordHistoryInput): Promise<AiRecordHistoryDto> {
    const table = AI_RECORD_HISTORY_TABLES.get(input.entity_type);
    if (!table) throw new BadRequestException(noRecordHistoryMessage(input.entity_type));
    const entry = recordHistoryEntry(table)!;

    await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);
    const id = await this.recordId(context, input.entity_type, input.entity_id);
    const access = await this.policy.effectiveAccess(context, context.manager);

    const reader = { tenantId: context.tenantId, userId: context.userId, isAdmin: access.isAdmin, permissions: access.permissions, manager: context.manager };
    let page;
    try {
      // An empty page with a cursor is read past, up to MAX_HISTORY_PAGE_READS pages; then what is
      // read is given with its cursor.
      let cursor = input.cursor ?? null;
      for (let reads = 1; ; reads += 1) {
        page = await this.history.list(reader, table, id, { cursor, limit: input.limit });
        if (page.items.length > 0 || page.nextCursor === null || reads >= MAX_HISTORY_PAGE_READS) break;
        cursor = page.nextCursor;
      }
    } catch (error) {
      // The record is read first under the person's access: missing, out of access or of another
      // tenant alike, it is not found, and no partial history is served.
      if (error instanceof NotFoundException) throw entityNotFound(input.entity_type, input.entity_id);
      if (isModuleRightRefusal(error)) {
        throw moduleRightRequired(entry.module, entry.level, missingRightMessage(entry.module, entry.level));
      }
      throw error;
    }

    const items = page.items.map((item): AiRecordHistoryEntryDto => ({
      at: item.at,
      action: item.action,
      actor: item.actor,
      subject: withoutRawIds(item.subject) as RecordHistorySubject,
      changes: item.changes.map(withoutRawIds),
    }));
    return {
      entity: { type: input.entity_type, id: input.entity_id },
      items,
      returned: items.length,
      next_cursor: page.nextCursor,
      truncated: page.nextCursor !== null,
      complete: !input.cursor && page.nextCursor === null,
      note: AI_RECORD_HISTORY_NOTE,
    };
  }
}
