/**
 * Ordering shared by the contributors list, the workspace prev/next
 * navigation and the skills matrix (`skillsMatrix.ts`), so walking a
 * contributor's neighbours follows the list exactly: teams alphabetically,
 * "Unassigned" last, API order inside a group.
 *
 * Pure, without a single import. The skills matrix export of the API runs the
 * same code: the backend holds a byte-identical copy in
 * `backend/src/portfolio/shared/`, checked by
 * `backend/src/spend/reports/__tests__/report-shared-copies.spec.ts`. Change
 * this file, then copy it there.
 */

export const UNASSIGNED_GROUP = 'unassigned';

export type ContributorGroupable = { id: string; item_number?: number; team_id?: string | null };
export type ContributorFilterable = { employment_type_id?: string | null };
export type TeamLike = { id: string; name: string };

export function groupContributorsByTeam<T extends ContributorGroupable>(
  contributors: T[],
  teams: TeamLike[],
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const team of teams) groups[team.id] = [];
  groups[UNASSIGNED_GROUP] = [];
  for (const contributor of contributors) {
    const key = contributor.team_id && groups[contributor.team_id] ? contributor.team_id : UNASSIGNED_GROUP;
    groups[key].push(contributor);
  }
  return groups;
}

/** The contract type filter of the page: 'all', or the id of one contract type. */
export function filterContributorsByEmploymentType<T extends ContributorFilterable>(contributors: T[], employmentTypeId: string): T[] {
  if (employmentTypeId === 'all') return contributors;
  return contributors.filter((contributor) => contributor.employment_type_id === employmentTypeId);
}

/** `compare` orders the team names: a collator of the language (`new Intl.Collator(language).compare`). */
export function sortGroupIds(
  groupIds: string[],
  teamName: (groupId: string) => string,
  compare: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): string[] {
  return [...groupIds].sort((a, b) => {
    if (a === UNASSIGNED_GROUP) return 1;
    if (b === UNASSIGNED_GROUP) return -1;
    return compare(teamName(a), teamName(b));
  });
}

/** Flat list in display order (what the list page renders top to bottom). */
export function orderContributors<T extends ContributorGroupable>(
  contributors: T[],
  teams: TeamLike[],
  unassignedLabel: string,
): T[] {
  const groups = groupContributorsByTeam(contributors, teams);
  const teamName = (groupId: string) => (
    groupId === UNASSIGNED_GROUP ? unassignedLabel : teams.find((team) => team.id === groupId)?.name || ''
  );
  return sortGroupIds(Object.keys(groups), teamName).flatMap((groupId) => groups[groupId]);
}
