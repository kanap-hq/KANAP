import type { EntityManager } from 'typeorm';
import type { BudgetNature } from '../../spend/budget-nature';
import {
  columnsLeftToCheck,
  loadEntryCheckSettings,
  readAccountExpectations,
  readColumnsToCheckOnAnyAccount,
  type ColumnAfterWrite,
} from '../../spend/budget-line-entry-check';
import type { AiMutationPreviewChangeDto } from '../ai.types';
import { AiWriteLanguage, ENTRY_CHECK_WARNING_FIELD, quantityPriceExpectedWarning } from '../ai-write-texts';

/**
 * The warning of Kad's budget cards when their write leaves a column "To check" (lot B12b): the
 * line's account, or its consolidation account, expects quantity and price, and Kad writes totals
 * only (a line's amounts, a new line with its amounts) or moves the line with its amounts onto
 * such an account. The rule is the line's (`spend/budget-line-entry-check.ts`), read before the
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

/** The warning of a move of lines onto `accountId`: when one of their columns, as it stands, will be to check there. */
export async function accountEntryCheckWarning(
  manager: EntityManager,
  tenantId: string,
  itemIds: readonly string[],
  accountId: unknown,
): Promise<AiEntryCheckWarning | null> {
  const account = await expectedAccountLabel(manager, tenantId, accountId);
  if (!account) return null;
  const columns = await readColumnsToCheckOnAnyAccount(manager, tenantId, itemIds);
  return columns.size > 0 ? { kind: 'account', account } : null;
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
