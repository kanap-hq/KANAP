import type { EntityManager } from 'typeorm';
import type { BudgetNature } from '../../spend/budget-nature';
import {
  columnsLeftToCheck,
  loadEntryCheckSettings,
  readAccountExpectations,
  readColumnsToCheckOnAnyAccount,
  withinEndOfValidity,
  type ColumnAfterWrite,
} from '../../spend/budget-line-entry-check';
import type { AiMutationPreviewChangeDto } from '../ai.types';
import { AiWriteLanguage, ENTRY_CHECK_WARNING_FIELD, quantityPriceExpectedWarning } from '../ai-write-texts';

/**
 * The warning of Kad's budget cards when their write leaves a column "To check" (lot B12b): the
 * line's account, or its consolidation account, expects quantity and price, and Kad writes totals
 * only (a line's amounts, a new line with its amounts), moves the line with its amounts onto
 * such an account, or extends the end of validity of a line on one to a year with such amounts. The rule is the line's (`spend/budget-line-entry-check.ts`), read before the
 * write; the card names the line's own account, never the consolidation account (a person who does
 * not read the accounts is not told it). Stored on the card when it is prepared, said while it
 * waits for approval: the approval writes as for any card, and the card once written does not say
 * it again. A warning, never a refusal.
 */
export type AiEntryCheckWarning = { kind: 'amounts' | 'account'; account: string };

/** The key of the warning in the card's `current_values`. */
export const ENTRY_CHECK_STORE_KEY = 'entry_check';

/** The account as the cards name it, `6100 - Software`, when it expects quantity and price; null otherwise. */
async function expectedAccountLabel(manager: EntityManager, tenantId: string, accountId: unknown): Promise<string | null> {
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (!id) return null;
  if (!(await readAccountExpectations(manager, tenantId, [id])).has(id)) return null;
  const rows: Array<{ label: string }> = await manager.query(
    `SELECT concat_ws(' - ', account_number::text, NULLIF(btrim(account_name), '')) AS label FROM accounts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return rows[0]?.label ?? null;
}

/**
 * The warning of a write of totals on one line (`columns`: the columns it writes, each with its
 * total for the year once written), on `accountId`: when one of them will be to check.
 */
export async function amountsEntryCheckWarning(
  manager: EntityManager,
  tenantId: string,
  line: { nature: BudgetNature; accountId: unknown; endOfValidity?: string | Date | null },
  columns: readonly ColumnAfterWrite[],
): Promise<AiEntryCheckWarning | null> {
  if (columns.length === 0) return null;
  const account = await expectedAccountLabel(manager, tenantId, line.accountId);
  if (!account) return null;
  const left = columnsLeftToCheck(await loadEntryCheckSettings(manager, tenantId), line.nature, columns, line.endOfValidity ?? null);
  return left.length > 0 ? { kind: 'amounts', account } : null;
}

/**
 * The warning of a change of a line's account or end of validity (`change`: the values the card
 * writes, absent when it keeps the stored one), on its columns as they stand: a move onto an
 * account that expects quantity and price, when one of them will be to check there, up to the end
 * the line will have; on the same account, an end of validity that brings back a year with such a
 * column (lot B12b).
 */
export async function accountEntryCheckWarning(
  manager: EntityManager,
  tenantId: string,
  itemId: string,
  change: { accountId?: unknown; endOfValidity?: unknown },
): Promise<AiEntryCheckWarning | null> {
  const rows: Array<{ account_id: string | null; disabled_at: Date | null }> = await manager.query(
    `SELECT account_id, disabled_at FROM spend_items WHERE tenant_id = $1 AND id = $2`, [tenantId, itemId]);
  if (rows.length === 0) return null;
  const stored = rows[0];
  const moved = change.accountId !== undefined && change.accountId !== stored.account_id;
  const account = await expectedAccountLabel(manager, tenantId, moved ? change.accountId : stored.account_id);
  if (!account) return null;
  const end = (value: unknown) => (typeof value === 'string' || value instanceof Date ? value : null);
  const columns = (await readColumnsToCheckOnAnyAccount(manager, tenantId, [itemId], undefined, true)).get(itemId) ?? [];
  const after = withinEndOfValidity(columns, change.endOfValidity !== undefined ? end(change.endOfValidity) : stored.disabled_at);
  if (moved) return after.length > 0 ? { kind: 'account', account } : null;
  const before = new Set(withinEndOfValidity(columns, stored.disabled_at).map((column) => `${column.year}:${column.measure}`));
  return after.some((column) => !before.has(`${column.year}:${column.measure}`)) ? { kind: 'account', account } : null;
}

function storedWarning(value: unknown): AiEntryCheckWarning | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { kind, account } = value as Record<string, unknown>;
  return (kind === 'amounts' || kind === 'account') && typeof account === 'string' ? { kind, account } : null;
}

/**
 * The card's entry of its stored warning (`current_values.entry_check`), while the card waits for
 * approval: the card's way of warning (an entry beside its changes, as an incident's closure),
 * labelled as the list's column, "To check".
 */
export function entryCheckWarningChange(
  currentValues: Record<string, unknown> | null | undefined,
  status: string,
  language: AiWriteLanguage,
): Record<string, AiMutationPreviewChangeDto> {
  const warning = status === 'pending' ? storedWarning(currentValues?.[ENTRY_CHECK_STORE_KEY]) : null;
  if (!warning) return {};
  return {
    [ENTRY_CHECK_WARNING_FIELD]: { label: 'To check', from: null, to: quantityPriceExpectedWarning(language, warning.kind, warning.account), format: 'text' },
  };
}
