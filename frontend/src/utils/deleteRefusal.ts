import type { TFunction } from 'i18next';
import { joinNames } from '../pages/working-day-calendars/workingDayCalendarFields';
import { dataAccessSentence } from './apiErrorMessage';

/**
 * A failed item of a bulk delete. `code`: a refusal the interface translates (`errors:<code>`),
 * with what still uses the item counted per kind (`usages`); `reason` is the English sentence.
 */
export type DeleteFailure = {
  reason?: string;
  /** The server's sentence, on a refusal answered as an error (403 `DATA_ACCESS_LIMITED`). */
  message?: string;
  code?: string;
  usages?: Array<{ type: string; total: number }>;
  /** Values the sentence names besides the counts: a frozen column and its year. */
  params?: Record<string, string | number>;
};

/** "2 contracts and 1 application", in the interface language. */
function usageLabels(usages: NonNullable<DeleteFailure['usages']>, t: TFunction): string[] {
  return usages.map(({ type, total }) =>
    t(`common:delete.usages.${type}`, { count: total, defaultValue: `${total} ${type}` }) as string);
}

function usageList(usages: NonNullable<DeleteFailure['usages']>, t: TFunction, language: string): string {
  return joinNames(usageLabels(usages, t), language);
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

/** What a delete removes, then its links, in one list: "its description, 2 deployments and its links". */
export function removedWithLinks(usages: NonNullable<DeleteFailure['usages']>, links: string, t: TFunction, language: string): string {
  return joinNames([...usageLabels(usages, t), links], language);
}

/** Why an item was not deleted, in the interface language when the server gave a code. */
export function deleteFailureReason(failure: DeleteFailure, t: TFunction, language: string): string {
  const reason = failure.reason ?? '';
  if (!failure.code) return reason;
  // A data access refusal carries its sentence, translated as every refusal of that code is.
  if (failure.code === 'DATA_ACCESS_LIMITED') {
    const sentence = failure.message ?? reason;
    return dataAccessSentence(sentence, t as never) ?? sentence;
  }
  return t(`errors:${failure.code}`, {
    ...(failure.params ?? {}),
    ...usageTotal(failure.usages),
    usages: usageList(failure.usages ?? [], t, language),
    defaultValue: reason,
  }) as string;
}
