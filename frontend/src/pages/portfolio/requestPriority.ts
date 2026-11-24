/**
 * Priority a request shows.
 *
 * An override shows its value, whether or not a criterion is answered.
 * Otherwise the score shows only when a criterion that is enabled now has a
 * stored answer. An answer on a disabled or deleted criterion does not count.
 *
 * A null catalogue means the enabled set could not be read: the stored score
 * stays, so a failed read does not blank every priority. `criteriaValues`
 * omitted means the answers were not on the payload, and the stored score
 * stays for the same reason. `null` or an object is the stored map.
 */
export function displayedRequestPriority(input: {
  priorityScore: number | string | null | undefined;
  priorityOverride?: boolean | null;
  overrideValue?: number | string | null;
  criteriaValues?: Record<string, unknown> | null;
  enabledCriterionIds: readonly string[] | null;
}): number | null {
  if (input.priorityOverride) {
    return finiteNumber(input.overrideValue ?? input.priorityScore);
  }
  if (input.enabledCriterionIds == null || input.criteriaValues === undefined) {
    return finiteNumber(input.priorityScore);
  }
  if (!hasAnsweredEnabledCriterion(input.criteriaValues, input.enabledCriterionIds)) {
    return null;
  }
  return finiteNumber(input.priorityScore);
}

function hasAnsweredEnabledCriterion(
  criteriaValues: Record<string, unknown> | null,
  enabledCriterionIds: readonly string[],
): boolean {
  if (!criteriaValues || enabledCriterionIds.length === 0) return false;
  for (const id of enabledCriterionIds) {
    const value = criteriaValues[id];
    if (value == null) continue;
    if (String(value).trim() !== '') return true;
  }
  return false;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
