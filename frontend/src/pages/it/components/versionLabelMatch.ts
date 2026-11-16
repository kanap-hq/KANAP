/**
 * How a version label the person types finds a version of a technology: a copy of the server's rule
 * (`backend/src/technologies/version-label-match.ts`, lot I3 of 26.11.9, T-I3e), so that the picker
 * offers the version the server takes for that label rather than a new one. Change both:
 * `backend/src/technologies/__tests__/version-label-rule.integration.spec.ts` runs the same cases on each.
 * - the same label, case aside: that version;
 * - else the only version that answers a prefix rule, where the words that follow the shorter label
 *   hold no digit (`22.04` finds `22.04 LTS`, `2022 Datacenter` finds `2022`; `11` is not `11 SP1`);
 *   when several stored labels prefix the written one, the longest wins;
 * - else nothing: the label is a version of its own.
 */

function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Whether `longer` is `shorter` followed by a space and words without a digit. */
function editionOf(longer: string, shorter: string): boolean {
  return longer.startsWith(`${shorter} `) && !/\d/.test(longer.slice(shorter.length));
}

export type VersionLabelMatch<T> =
  | { kind: 'none' }
  | { kind: 'exact'; row: T }
  | { kind: 'prefix'; row: T };

/**
 * The version of `versions` the label `written` names. `prefix: false` (a match the person undid)
 * keeps the equality, case aside, alone.
 */
export function matchVersionLabel<T extends { label: string }>(
  versions: readonly T[],
  written: string,
  options: { prefix: boolean } = { prefix: true },
): VersionLabelMatch<T> {
  const key = labelKey(written);
  if (!key) return { kind: 'none' };
  const exact = versions.find((version) => labelKey(version.label) === key);
  if (exact) return { kind: 'exact', row: exact };
  if (!options.prefix) return { kind: 'none' };
  const longer = versions.filter((version) => editionOf(labelKey(version.label), key));
  const shorter = versions
    .filter((version) => editionOf(key, labelKey(version.label)))
    .sort((a, b) => labelKey(b.label).length - labelKey(a.label).length);
  const candidates = [...longer, ...shorter.slice(0, 1)];
  return candidates.length === 1 ? { kind: 'prefix', row: candidates[0] } : { kind: 'none' };
}
