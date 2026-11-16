/**
 * How a version label written in a file, a screen or by Kad finds a version of a technology (lot I3
 * of 26.11.9, T-I3e). One rule for every place that resolves a label:
 * - the same label, case aside: that version;
 * - else, among the technology's versions, the only one that answers one of two prefix rules (a
 *   match, listed by the imports and undoable), where the words that follow the shorter label hold
 *   no digit (they name an edition, never another version: `11` is not `11 SP1`, `2012` not `2012 R2`):
 *   - the stored label starts with the written one, then a space (`22.04` finds `22.04 LTS`);
 *   - the written label starts with the stored one, then a space (`2022 Datacenter` finds `2022`);
 *     when several stored labels prefix it, the longest wins (`2012 R2 Datacenter` finds `2012 R2`);
 * - else nothing: the caller creates the version as written (`22.04.3 LTS` stays a version of its own).
 * The screens' version picker holds a copy (`frontend/src/pages/it/components/versionLabelMatch.ts`),
 * so that it offers the version the server will take: change both, `version-label-rule` runs the
 * same cases on each.
 */

export type VersionLabelMatch<T> =
  | { kind: 'none' }
  | { kind: 'exact'; row: T }
  | { kind: 'prefix'; row: T };

function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Whether `longer` is `shorter` followed by a space and words without a digit. */
function editionOf(longer: string, shorter: string): boolean {
  return longer.startsWith(`${shorter} `) && !/\d/.test(longer.slice(shorter.length));
}

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
