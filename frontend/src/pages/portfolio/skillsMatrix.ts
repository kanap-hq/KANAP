/**
 * The skills matrix of the contributors page: which contributors and which skills it shows, in which
 * order, their levels and their summaries, and how the grid turns when the skills hold the columns.
 * The screen (`components/ContributorsSkillsMatrix.tsx`) draws it and the API writes the same grid
 * into its export (`GET /portfolio/team-members/skills-matrix/export`).
 *
 * Pure: the only import is `./contributorsOrdering`. The backend holds a byte-identical copy of both
 * files in `backend/src/portfolio/shared/`, checked by
 * `backend/src/spend/reports/__tests__/report-shared-copies.spec.ts`: change this file, then copy it
 * there. Names come in already translated (`words`); `compare` orders them (a collator of the
 * language, `new Intl.Collator(language).compare`).
 */

import { groupContributorsByTeam, sortGroupIds, UNASSIGNED_GROUP } from './contributorsOrdering';

export const MIN_SKILL_LEVEL = 1;
export const MAX_SKILL_LEVEL = 4;

/** Older records may still carry a 0 ("no knowledge", dropped 2026-09): show it as the lowest level. */
export const clampSkillLevel = (level: number) => Math.min(MAX_SKILL_LEVEL, Math.max(MIN_SKILL_LEVEL, Number.isFinite(level) ? level : MIN_SKILL_LEVEL));

/** A level of 3 or 4 means the person can carry the skill on their own. */
export const AUTONOMOUS_LEVEL = 3;

/** Which side of the grid carries the contributors in its columns. */
export type SkillsMatrixOrientation = 'contributors' | 'skills';
export const SKILLS_MATRIX_ORIENTATIONS: readonly SkillsMatrixOrientation[] = ['contributors', 'skills'];

export type SkillsMatrixContributor = {
  id: string;
  item_number: number;
  user_display_name: string;
  user_email: string;
  skills?: Array<{ skill_id: string; proficiency: number }> | null;
  team_id?: string | null;
};

export type SkillsMatrixSkill = { id: string; category: string; name: string; enabled: boolean };
export type SkillsMatrixTeam = { id: string; name: string };

/** The names of the team groups that are no team of the list. */
export type SkillsMatrixWords = { unassigned: string; unknownTeam: string };

/** Why the grid is empty, the key of its message (`contributors.matrix.<key>` in `portfolio.json`). */
export type SkillsMatrixEmpty = 'noContributors' | 'noSkills' | 'allFiltered' | 'noDeclaredSkills';

/** Declared levels, and those at the autonomous level or above. */
export type SkillsMatrixCounts = { declared: number; autonomous: number };

export type SkillsMatrixContributorEntry<C extends SkillsMatrixContributor = SkillsMatrixContributor> = {
  kind: 'contributor';
  id: string;
  label: string;
  itemNumber: number;
  teamLabel: string;
  contributor: C;
  /** Over the skills the grid shows. */
  counts: SkillsMatrixCounts;
};

export type SkillsMatrixSkillEntry = {
  kind: 'skill';
  id: string;
  label: string;
  category: string;
  /** Over the contributors the grid shows. */
  counts: SkillsMatrixCounts;
};

export type SkillsMatrixGroup<E> = { key: string; label: string; entries: E[] };

export type SkillsMatrixAxis<C extends SkillsMatrixContributor = SkillsMatrixContributor> =
  | { kind: 'contributor'; groups: Array<SkillsMatrixGroup<SkillsMatrixContributorEntry<C>>>; entries: Array<SkillsMatrixContributorEntry<C>> }
  | { kind: 'skill'; groups: Array<SkillsMatrixGroup<SkillsMatrixSkillEntry>>; entries: SkillsMatrixSkillEntry[] };

export interface SkillsMatrix<C extends SkillsMatrixContributor = SkillsMatrixContributor> {
  /** Every category holding an enabled skill, in order: the category filters. */
  categories: string[];
  contributorAxis: Extract<SkillsMatrixAxis<C>, { kind: 'contributor' }>;
  skillAxis: Extract<SkillsMatrixAxis<C>, { kind: 'skill' }>;
  /** The level of a contributor in a skill, undefined when none is declared. */
  levelOf: (contributorId: string, skillId: string) => number | undefined;
  /** Set when the grid has nothing to show. */
  empty: SkillsMatrixEmpty | null;
}

export interface SkillsMatrixInput<C extends SkillsMatrixContributor> {
  /** Already narrowed by the contract type filter of the page (`filterContributorsByEmploymentType`). */
  contributors: C[];
  teams: SkillsMatrixTeam[];
  skills: SkillsMatrixSkill[];
  /** The team filter of the page: 'all', a team id, or 'unassigned'. */
  teamId: string;
  showUnused: boolean;
  /** Category names switched off. */
  hiddenCategories: readonly string[];
  words: SkillsMatrixWords;
  compare: (a: string, b: string) => number;
}

export function countLevels(levels: Array<number | undefined>): SkillsMatrixCounts {
  let declared = 0;
  let autonomous = 0;
  for (const level of levels) {
    if (!level) continue;
    declared += 1;
    if (level >= AUTONOMOUS_LEVEL) autonomous += 1;
  }
  return { declared, autonomous };
}

/** A contributor's summary: autonomous over declared (`2/5`), empty when nothing is declared. */
export function contributorSummary(counts: SkillsMatrixCounts): string {
  return counts.declared > 0 ? `${counts.autonomous}/${counts.declared}` : '';
}

/** A contributor's name in the grid: the display name, else the email. */
export function contributorLabel(contributor: SkillsMatrixContributor): string {
  return contributor.user_display_name || contributor.user_email;
}

export function buildSkillsMatrix<C extends SkillsMatrixContributor>(input: SkillsMatrixInput<C>): SkillsMatrix<C> {
  const { contributors, teams, skills, teamId, showUnused, hiddenCategories, words, compare } = input;

  const teamName = (groupId: string) => (
    groupId === UNASSIGNED_GROUP
      ? words.unassigned
      : teams.find((team) => team.id === groupId)?.name || words.unknownTeam
  );

  // Contributors follow the list view exactly: teams alphabetically, unassigned last.
  const grouped = groupContributorsByTeam(contributors, teams);
  const groupIds = teamId === 'all' ? Object.keys(grouped) : [teamId].filter((id) => grouped[id]);
  const contributorGroups = sortGroupIds(groupIds, teamName, compare)
    .map((groupId) => ({ groupId, rows: grouped[groupId] || [] }))
    .filter(({ rows }) => rows.length > 0);
  const visibleContributors = contributorGroups.flatMap((group) => group.rows);

  const levels = new Map<string, number>();
  for (const contributor of contributors) {
    for (const entry of contributor.skills ?? []) {
      levels.set(`${contributor.id}:${entry.skill_id}`, clampSkillLevel(entry.proficiency));
    }
  }
  const levelOf = (contributorId: string, skillId: string) => levels.get(`${contributorId}:${skillId}`);

  const byCategory = new Map<string, SkillsMatrixSkill[]>();
  for (const skill of skills) {
    if (!skill.enabled) continue;
    byCategory.set(skill.category, [...(byCategory.get(skill.category) ?? []), skill]);
  }
  const categoryLists = [...byCategory.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([category, list]) => ({ category, skills: [...list].sort((a, b) => compare(a.name, b.name)) }));
  const shownCategories = categoryLists.filter(({ category }) => !hiddenCategories.includes(category));

  const skillGroups = shownCategories
    .map(({ category, skills: list }) => ({
      category,
      skills: showUnused ? list : list.filter((skill) => visibleContributors.some((row) => levelOf(row.id, skill.id))),
    }))
    .filter(({ skills: list }) => list.length > 0);
  const visibleSkills = skillGroups.flatMap((group) => group.skills);

  const contributorEntryGroups = contributorGroups.map(({ groupId, rows }) => ({
    key: groupId,
    label: teamName(groupId),
    entries: rows.map<SkillsMatrixContributorEntry<C>>((row) => ({
      kind: 'contributor',
      id: row.id,
      label: contributorLabel(row),
      itemNumber: row.item_number,
      teamLabel: teamName(groupId),
      contributor: row,
      counts: countLevels(visibleSkills.map((skill) => levelOf(row.id, skill.id))),
    })),
  }));

  const skillEntryGroups = skillGroups.map(({ category, skills: list }) => ({
    key: category,
    label: category,
    entries: list.map<SkillsMatrixSkillEntry>((skill) => ({
      kind: 'skill',
      id: skill.id,
      label: skill.name,
      category,
      counts: countLevels(visibleContributors.map((row) => levelOf(row.id, skill.id))),
    })),
  }));

  const empty: SkillsMatrixEmpty | null = (() => {
    if (visibleContributors.length === 0) return 'noContributors';
    if (categoryLists.length === 0) return 'noSkills';
    if (shownCategories.length === 0) return 'allFiltered';
    // Every remaining skill was dropped for being unused, which the category filters cannot
    // explain: point at the toggle that would bring them back.
    if (visibleSkills.length === 0) return showUnused ? 'allFiltered' : 'noDeclaredSkills';
    return null;
  })();

  return {
    categories: categoryLists.map(({ category }) => category),
    contributorAxis: {
      kind: 'contributor',
      groups: contributorEntryGroups,
      entries: contributorEntryGroups.flatMap((group) => group.entries),
    },
    skillAxis: {
      kind: 'skill',
      groups: skillEntryGroups,
      entries: skillEntryGroups.flatMap((group) => group.entries),
    },
    levelOf,
    empty,
  };
}

/**
 * The grid as laid out: the axis in the columns, the axis in the rows, and the level at a row and a
 * column. Contributors hold the columns by default (a catalogue is usually the longer axis).
 */
export function orientSkillsMatrix<C extends SkillsMatrixContributor>(
  matrix: SkillsMatrix<C>,
  orientation: SkillsMatrixOrientation,
): { columns: SkillsMatrixAxis<C>; rows: SkillsMatrixAxis<C>; levelAt: (rowId: string, columnId: string) => number | undefined } {
  const columns: SkillsMatrixAxis<C> = orientation === 'contributors' ? matrix.contributorAxis : matrix.skillAxis;
  const rows: SkillsMatrixAxis<C> = orientation === 'contributors' ? matrix.skillAxis : matrix.contributorAxis;
  const levelAt = (rowId: string, columnId: string) => (
    rows.kind === 'contributor' ? matrix.levelOf(rowId, columnId) : matrix.levelOf(columnId, rowId)
  );
  return { columns, rows, levelAt };
}
