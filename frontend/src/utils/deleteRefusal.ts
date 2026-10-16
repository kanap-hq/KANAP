import type { TFunction } from 'i18next';
import { joinNames } from '../pages/working-day-calendars/workingDayCalendarFields';

/**
 * A failed item of a bulk delete. `code`: a refusal the interface translates (`errors:<code>`),
 * with what still uses the item counted per kind (`usages`); `reason` is the English sentence.
 */
export type DeleteFailure = {
  reason?: string;
  code?: string;
  usages?: Array<{ type: string; total: number }>;
  /** Values the sentence names besides the counts: a frozen column and its year. */
  params?: Record<string, string | number>;
};

/** "2 contracts and 1 application", in the interface language. */
function usageList(usages: NonNullable<DeleteFailure['usages']>, t: TFunction, language: string): string {
  const parts = usages.map(({ type, total }) =>
    t(`common:delete.usages.${type}`, { count: total, defaultValue: `${total} ${type}` }) as string);
  return joinNames(parts, language);
}

/**
 * How many records hold the item, all kinds together: the count its sentence agrees with
 * ("Move it first" for one, "Move them first" for more). Absent without usages.
 */
export function usageTotal(usages: DeleteFailure['usages'] | null | undefined): { count: number } | Record<string, never> {
  const total = (usages ?? []).reduce((sum, usage) => sum + (Number(usage.total) || 0), 0);
  return total > 0 ? { count: total } : {};
}

/** What makes the delete of an item refused, counted: "2 contracts and 1 application". */
export function refusalCounts(failure: DeleteFailure, t: TFunction, language: string): string {
  return usageList(failure.usages ?? [], t, language);
}

/** Why an item was not deleted, in the interface language when the server gave a code. */
export function deleteFailureReason(failure: DeleteFailure, t: TFunction, language: string): string {
  const reason = failure.reason ?? '';
  if (!failure.code) return reason;
  return t(`errors:${failure.code}`, {
    ...(failure.params ?? {}),
    ...usageTotal(failure.usages),
    usages: usageList(failure.usages ?? [], t, language),
    defaultValue: reason,
  }) as string;
}
