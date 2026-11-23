import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import type { EntityManager } from 'typeorm';
import { bulkListChanged } from '../../common/bulk-edit/bulk-edit';
import { UUID_RE } from '../../common/relations/relation-target';
import { BULK_WRITE_TIMEOUTS } from '../../common/request-db-timeouts';
import { BULK_EDIT_EMPTIED, BULK_EDIT_HIDDEN, bulkEditListGrewText } from '../ai-bulk-edit-texts';
import { personWriteLanguage, type AiWriteLanguage } from '../ai-write-texts';
import type { AiBulkEditPreviewDto, AiExecutionContextWithManager, AiMutationPreviewDto } from '../ai.types';

/**
 * What Kad's changes in bulk share (lot K1 of 26.11.9), whatever the list: the tools, the bounded
 * waits of their transactions and the filter values they take. Each list's operation runs the
 * common contract of the screen (`common/bulk-edit/bulk-edit.ts`) through its service.
 */

/** Kad's tools of a change in bulk: one card for many rows, never a step of `prepare_mutation_plan`. */
export const AI_BULK_EDIT_TOOLS: ReadonlySet<string> = new Set(['bulk_update_budget_lines', 'bulk_update_applications']);

/**
 * A stored tool message of a bulk card, replayed to the model with the counts of the newest card of
 * its chain (review of lot K2e): the boxes replace the card without the model, which would otherwise
 * answer "how many?" with the first card's counts. Only the card's text and summary change; the list
 * stays the screen's (`bulk_edit` is never in the model's output). Any other message is left as it is.
 */
export function replayLatestBulkCard(content: string, previews: readonly AiMutationPreviewDto[]): string {
  let parsed: { tool_name?: unknown; result?: Record<string, unknown> } | null = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  const result = parsed?.result;
  if (!parsed || !AI_BULK_EDIT_TOOLS.has(String(parsed.tool_name)) || !result || typeof result.preview_id !== 'string') return content;
  const newest = [...previews].reverse().find((preview) => preview.replaces_preview_id === result.preview_id);
  if (!newest) return content;
  return JSON.stringify({ ...parsed, result: { ...result, changes: newest.changes, summary: newest.summary, error_message: newest.error_message } });
}

/**
 * What `prepare_mutation_plan` says of the changes in bulk (lot K1): on dev, "do it in bulk" on the category of
 * applications, a field the bulk tools do not take, gave a plan of four cards of one application each, offered
 * without a word that the category is not changed in bulk.
 */
export const MUTATION_PLAN_IS_NOT_BULK = 'A plan of cards that each change one record is not a change in bulk: never present it as one. '
  + 'When the person asks to change budget lines or applications in bulk on a field that bulk_update_budget_lines or bulk_update_applications does not take, '
  + 'first say in the answer that this field is not changed in bulk and which fields are, then prepare the cards.';

/**
 * The exception to "one card per record" of the write rules (lot K2e of 26.12.1, decision P6 of
 * Fried): one field a bulk tool changes, set to the same value on two records or more of its family,
 * named or described by a filter, is one card of that tool; different values stay one card per
 * record. On QA (26.11.9), "the business criticality of APP-a and APP-b to low" gave two cards to
 * approve one by one, the rules asking one preview per record. Null when the person is offered
 * neither tool.
 */
export function bulkEditToolRule(toolNames: readonly string[]): string | null {
  const families = [
    { tool: 'bulk_update_applications', rows: 'applications', fields: 'business owners, IT owners, category, lifecycle, business criticality, cyber criticality' },
    { tool: 'bulk_update_budget_lines', rows: 'budget lines', fields: 'cost center, account, paying company, supplier, IT owner, business owner, run or build, the value of a dimension' },
  ].filter((family) => toolNames.includes(family.tool));
  if (families.length === 0) return null;
  const each = families.map((family) => `\`${family.tool}\` for ${family.rows} (${family.fields})`).join('; ');
  return `Exception, the change in bulk: one of these fields set to the same value on two records or more of the family, whether the person names them (references or names) or describes them, is one card of its bulk tool, never one card per record nor a plan: ${each}. `
    + 'That card lists each record it changes with its value before, and the person leaves out the ones they do not want before approving. '
    + 'Different values, several fields or a field outside these lists stay one card per record.';
}

export const BULK_EDIT_PLAN_REFUSAL = 'A change in bulk (bulk_update_budget_lines, bulk_update_applications) changes its rows in one card and cannot be part of a mutation plan: call it on its own.';

const WAITS_SAVEPOINT = 'ai_bulk_edit_waits';

/**
 * The waits of a change in bulk in Kad's transaction, as the screen's route (`BULK_WRITE_TIMEOUTS`):
 * a row held by another transaction gives up after `lockTimeoutMs` (55P03: the tool answers busy,
 * the card stays to approve), one statement after `statementTimeoutMs`. They hold for the card's
 * count or write only (`withAiBulkEditWaits`); no idle limit is set. Mutable for the specs only.
 */
export const AI_BULK_EDIT_DB_TIMEOUTS: { lockTimeoutMs: number; statementTimeoutMs: number } = {
  lockTimeoutMs: BULK_WRITE_TIMEOUTS.lockTimeoutMs!,
  statementTimeoutMs: BULK_WRITE_TIMEOUTS.statementTimeoutMs!,
};

/**
 * Runs a card's count or its write under the waits, then puts back the transaction's own: the next
 * cards of "Approve all" run in the same transaction. In a savepoint of its own: on an error, the
 * rollback to it takes the waits back too (`set_config(…, true)`), even in an aborted transaction,
 * and nothing the card ran stays.
 */
export async function withAiBulkEditWaits<T>(manager: EntityManager, run: () => Promise<T>): Promise<T> {
  const [before]: Array<{ lock: string; statement: string }> = await manager.query(
    `SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement`,
  );
  const set = (lock: string, statement: string) => manager.query(
    `SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)`,
    [lock, statement],
  );
  await manager.query(`SAVEPOINT ${WAITS_SAVEPOINT}`);
  await set(`${AI_BULK_EDIT_DB_TIMEOUTS.lockTimeoutMs}ms`, `${AI_BULK_EDIT_DB_TIMEOUTS.statementTimeoutMs}ms`);
  let result: T;
  try {
    result = await run();
  } catch (error) {
    try {
      await manager.query(`ROLLBACK TO SAVEPOINT ${WAITS_SAVEPOINT}`);
      await manager.query(`RELEASE SAVEPOINT ${WAITS_SAVEPOINT}`);
    } catch {
      // The connection is gone: the card's own error says more.
    }
    throw error;
  }
  await manager.query(`RELEASE SAVEPOINT ${WAITS_SAVEPOINT}`);
  await set(before.lock, before.statement);
  return result;
}

/**
 * Whether a part of the filter names no value (`[]`, `{ not: [] }`, a blank text): such a part is no
 * criterion, and an empty exclusion would reach the whole list (or open the disabled rows).
 */
export function isEmptyAiBulkFilterValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object' && 'not' in value) {
    const not = (value as { not: unknown }).not;
    return !Array.isArray(not) || not.length === 0;
  }
  return false;
}

/** The filter values of `query_entities` (same shapes). */
export const AI_BULK_FILTER_VALUE = z.union([
  z.array(z.union([z.string(), z.null()])),
  z.object({ not: z.array(z.union([z.string(), z.null()])) }).strict(),
  z.string(),
  z.object({ op: z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'between']), value: z.number(), valueTo: z.number().optional() }),
  z.object({ op: z.enum(['eq', 'before', 'after', 'between']), value: z.string().trim().min(1), valueTo: z.string().trim().min(1).optional() }),
]);

/**
 * The card of a change in bulk lists each record it changes (lot K2e of 26.12.1, decision P6 of
 * Fried): up to this many, every one with a box to leave it out. Beyond, the card counts them and
 * names the first five, as before, and the model offers to narrow (`bulkEditTooLongNote`). The
 * import card's choices take the same bound.
 */
export const AI_BULK_EDIT_LIST_MAX = 200;

type Words = Record<AiWriteLanguage, string>;

/**
 * A record as the card stores it (`current_values.bulk_list`): `before`, a key of the list's
 * `words` (null: empty); `hidden`, a value before the person may not read, never stored.
 */
export type AiBulkListRow = { id: string; ref: string; title: string; before: string | null; hidden?: true; kept: boolean; changed?: boolean };
/** The list a card stores: its records, and the values before in words, in each language, once each. */
export type AiBulkList = { rows: AiBulkListRow[]; words: Record<string, Words> };

/** The list a card stores, or null (a card of more than `AI_BULK_EDIT_LIST_MAX` records, or made before lot K2e). */
export function storedBulkList(currentValues: Record<string, unknown> | null | undefined): AiBulkList | null {
  const list = currentValues?.bulk_list as AiBulkList | undefined;
  return list && Array.isArray(list.rows) && list.words && typeof list.words === 'object' ? list : null;
}

/** The records the person left out of the card (`mutation_input.excluded`), part of the card's input. */
export function bulkExcluded(mutation: Record<string, unknown> | null | undefined): string[] {
  return Array.isArray(mutation?.excluded) ? (mutation!.excluded as unknown[]).map((id) => String(id)) : [];
}

/**
 * The selection the count and the write run on: the card's own (`selection`, as the model gave it),
 * less the records left out: `exclude_ids` for a filter, the ids taken out for chosen records. Null
 * when no chosen record is kept: nothing to count.
 */
export function effectiveBulkSelection(mutation: Record<string, unknown>): Record<string, unknown> | null {
  const selection = mutation.selection as Record<string, unknown> | undefined;
  if (!selection || typeof selection !== 'object') return null;
  const excluded = bulkExcluded(mutation);
  if (excluded.length === 0) return selection;
  if (selection.all === true) return { ...selection, exclude_ids: excluded };
  const left = new Set(excluded);
  const ids = (Array.isArray(selection.ids) ? selection.ids as string[] : []).filter((id) => !left.has(String(id).toLowerCase()));
  return ids.length > 0 ? { ...selection, ids } : null;
}

/**
 * The 409 of a card recounted past `AI_BULK_EDIT_LIST_MAX` records (review of lot K2e): records
 * entered the selection since the count. A card beyond the bound lists nothing, so its records left
 * out could no longer be seen nor ticked again: the recount is refused, the card stays as it was
 * (its approval then meets the list changed since its count) and the person asks for a new one.
 */
export async function bulkListGrew(context: AiExecutionContextWithManager): Promise<ConflictException> {
  const language = await personWriteLanguage(context.manager, context.tenantId, context.userId, context.screenLanguage);
  return new ConflictException({ code: 'bulk_list_grew', message: bulkEditListGrewText(language, AI_BULK_EDIT_LIST_MAX) });
}

/** `excluded` of the route: ids, lower case, without repeats, sorted, at most `AI_BULK_EDIT_LIST_MAX`. */
export function parseBulkExclusions(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new BadRequestException('excluded must be a list of record ids.');
  const ids = Array.from(new Set(raw.map((id) => String(id ?? '').trim().toLowerCase())));
  if (ids.some((id) => !UUID_RE.test(id))) throw new BadRequestException('excluded must be record ids.');
  if (ids.length > AI_BULK_EDIT_LIST_MAX) throw new BadRequestException(`At most ${AI_BULK_EDIT_LIST_MAX} records are left out.`);
  return ids.sort();
}

/** `APP-12`, `BL-7`: by the number of the reference, then by its text. */
function byReference(a: { ref: string }, b: { ref: string }): number {
  const number = (ref: string) => Number(ref.match(/(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  return number(a.ref) - number(b.ref) || a.ref.localeCompare(b.ref);
}

/**
 * The list of a recounted card, read again whole: the records left out unticked (so that they can be
 * ticked again), the others kept.
 */
export function bulkListLeftOut(list: AiBulkList, excluded: readonly string[]): AiBulkList {
  const left = new Set(excluded);
  return { ...list, rows: list.rows.map((row) => ({ ...row, kept: !left.has(row.id) })) };
}

/** The list of a card once approved: each kept record marked changed, or not. */
export function bulkListApplied(list: AiBulkList, changedIds: readonly string[]): AiBulkList {
  const changed = new Set(changedIds.map((id) => id.toLowerCase()));
  return { ...list, rows: list.rows.map((row) => ({ ...row, changed: row.kept && changed.has(row.id) })) };
}

/**
 * The write of a card that lists its records changes none it did not keep (review of lot K2e): a
 * record reached unchanged at the count (not listed), or refused there (counted without a box), that
 * the write would change refuses the whole write as a list changed since the count. Run in the
 * card's savepoint (`withAiBulkEditWaits`): nothing of the write stays.
 */
export function assertBulkWriteKept(list: AiBulkList | null, changedIds: readonly string[]): void {
  if (!list) return;
  const kept = new Set(list.rows.filter((row) => row.kept).map((row) => row.id.toLowerCase()));
  if (changedIds.some((id) => !kept.has(id.toLowerCase()))) throw bulkListChanged();
}

/** A list stored on a card, sorted by reference. */
export function sortedBulkList(list: AiBulkList): AiBulkList {
  return { ...list, rows: [...list.rows].sort(byReference) };
}

/** The list of a card for the screen, in the person's language. */
export function bulkEditPreviewDto(
  list: AiBulkList,
  field: string,
  after: string | null,
  language: AiWriteLanguage,
): AiBulkEditPreviewDto {
  const rows = list.rows.map((row) => {
    const state = row.hidden ? 'hidden' as const : row.before === null ? 'empty' as const : 'value' as const;
    const before = state === 'hidden'
      ? BULK_EDIT_HIDDEN[language]
      : state === 'empty' ? BULK_EDIT_EMPTIED[language] : (list.words[row.before!]?.[language] ?? row.before!);
    return {
      id: row.id,
      ref: row.ref,
      title: row.title,
      before,
      before_state: state,
      kept: row.kept,
      ...(row.changed === undefined ? {} : { changed: row.changed }),
    };
  });
  const kept = rows.filter((row) => row.kept).length;
  return {
    field,
    after: after ?? BULK_EDIT_EMPTIED[language],
    after_empty: after === null,
    rows,
    kept,
    excluded: rows.length - kept,
  };
}
