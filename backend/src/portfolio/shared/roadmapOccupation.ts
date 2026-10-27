/**
 * The occupation tables of the roadmap generator, read from the answer of
 * `POST /portfolio/reports/roadmap/generate` (`occupation`, `teamOccupation`): the weeks, the
 * contributors grouped by team, the teams, the rounded percentages and their averages. The screen
 * (`components/RoadmapGenerator.tsx`) draws them, its PNG paints them, and the API writes the same
 * tables into its export (`POST /portfolio/reports/roadmap/occupation/export`).
 *
 * Pure, without a single import. The backend holds a byte-identical copy in
 * `backend/src/portfolio/shared/`, checked by
 * `backend/src/spend/reports/__tests__/report-shared-copies.spec.ts`: change this file, then copy it
 * there. Names come in already translated (`words`); `compare` orders them (a collator of the
 * language, `new Intl.Collator(language).compare`). Percentages are whole numbers (`85` for 85 %).
 */

export type RoadmapOccupationEntry = {
  contributorId: string;
  contributorName: string;
  teamId: string | null;
  teamName: string | null;
  /** The Monday of the week, `YYYY-MM-DD`. */
  week: string;
  occupationPct: number | null;
};

export type RoadmapTeamOccupationEntry = {
  teamId: string | null;
  teamName: string | null;
  week: string;
  occupationPct: number | null;
};

export type ContributorOccupationRow = {
  contributorId: string;
  contributorName: string;
  teamId: string | null;
  teamName: string;
  weekOccupation: Map<string, number | null>;
};

export type ContributorOccupationGroup = {
  teamId: string | null;
  teamName: string;
  rows: ContributorOccupationRow[];
};

export type TeamOccupationRow = {
  teamId: string | null;
  teamName: string;
  weekOccupation: Map<string, number | null>;
};

export interface RoadmapOccupationTables {
  /** Every week of either list, in order. */
  weekKeys: string[];
  contributorGroups: ContributorOccupationGroup[];
  teamRows: TeamOccupationRow[];
  /** Per week: the rounded mean of the contributors' rounded percentages. */
  contributorAverages: Map<string, number | null>;
  /** Per week: the rounded mean of the teams' rounded percentages. */
  teamAverages: Map<string, number | null>;
}

/** The rounded mean of the values that are set, null when none is. */
export function roundedMean(values: ReadonlyArray<number | null | undefined>): number | null {
  const set = values.filter((value): value is number => value != null);
  return set.length > 0 ? Math.round(set.reduce((a, b) => a + b, 0) / set.length) : null;
}

/** The ISO week of a week start (`2026-01-05` is week 2 of 2026); `{0, 0}` for a date nobody can read. */
export function isoWeekParts(weekStartYmd: string): { week: number; year: number } {
  const base = new Date(`${weekStartYmd}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return { week: 0, year: 0 };
  const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year };
}

const rounded = (pct: number | null) => (pct == null ? null : Math.round(pct));

export function buildRoadmapOccupation(
  occupation: ReadonlyArray<RoadmapOccupationEntry>,
  teamOccupation: ReadonlyArray<RoadmapTeamOccupationEntry>,
  words: { noTeam: string },
  compare: (a: string, b: string) => number,
): RoadmapOccupationTables {
  const keys = new Set<string>();
  for (const entry of occupation) keys.add(entry.week);
  for (const entry of teamOccupation) keys.add(entry.week);
  const weekKeys = Array.from(keys).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const rowsByContributor = new Map<string, ContributorOccupationRow>();
  for (const entry of occupation) {
    const existing = rowsByContributor.get(entry.contributorId) ?? {
      contributorId: entry.contributorId,
      contributorName: entry.contributorName,
      teamId: entry.teamId,
      teamName: entry.teamName || words.noTeam,
      weekOccupation: new Map<string, number | null>(),
    };
    existing.weekOccupation.set(entry.week, rounded(entry.occupationPct));
    rowsByContributor.set(entry.contributorId, existing);
  }

  const groupsByTeam = new Map<string, ContributorOccupationGroup>();
  for (const row of rowsByContributor.values()) {
    const teamKey = row.teamId || 'no-team';
    const existing = groupsByTeam.get(teamKey) ?? {
      teamId: row.teamId,
      teamName: row.teamName || words.noTeam,
      rows: [],
    };
    existing.rows.push(row);
    groupsByTeam.set(teamKey, existing);
  }
  const contributorGroups = Array.from(groupsByTeam.values());
  contributorGroups.sort((a, b) => compare(a.teamName, b.teamName) || compare(a.teamId || '', b.teamId || ''));
  for (const group of contributorGroups) {
    group.rows.sort((a, b) => compare(a.contributorName, b.contributorName) || compare(a.contributorId, b.contributorId));
  }

  const rowsByTeam = new Map<string, TeamOccupationRow>();
  for (const entry of teamOccupation) {
    const teamKey = entry.teamId || 'no-team';
    const existing = rowsByTeam.get(teamKey) ?? {
      teamId: entry.teamId,
      teamName: entry.teamName || words.noTeam,
      weekOccupation: new Map<string, number | null>(),
    };
    existing.weekOccupation.set(entry.week, rounded(entry.occupationPct));
    rowsByTeam.set(teamKey, existing);
  }
  const teamRows = Array.from(rowsByTeam.values())
    .sort((a, b) => compare(a.teamName, b.teamName) || compare(a.teamId || '', b.teamId || ''));

  const contributorAverages = new Map<string, number | null>();
  const teamAverages = new Map<string, number | null>();
  for (const weekKey of weekKeys) {
    contributorAverages.set(weekKey, roundedMean(
      contributorGroups.flatMap((group) => group.rows.map((row) => row.weekOccupation.get(weekKey))),
    ));
    teamAverages.set(weekKey, roundedMean(teamRows.map((row) => row.weekOccupation.get(weekKey))));
  }

  return { weekKeys, contributorGroups, teamRows, contributorAverages, teamAverages };
}
