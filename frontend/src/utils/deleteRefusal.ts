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
};

/** "2 contracts and 1 application", in the interface language. */
function usageList(usages: NonNullable<DeleteFailure['usages']>, t: TFunction, language: string): string {
  const parts = usages.map(({ type, total }) =>
    t(`common:delete.usages.${type}`, { count: total, defaultValue: `${total} ${type}` }) as string);
  return joinNames(parts, language);
}

/** Why an item was not deleted, in the interface language when the server gave a code. */
export function deleteFailureReason(failure: DeleteFailure, t: TFunction, language: string): string {
  const reason = failure.reason ?? '';
  if (!failure.code) return reason;
  return t(`errors:${failure.code}`, { usages: usageList(failure.usages ?? [], t, language), defaultValue: reason }) as string;
}
