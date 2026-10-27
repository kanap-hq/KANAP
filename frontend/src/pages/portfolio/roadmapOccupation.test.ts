import { describe, expect, it } from 'vitest';
import { buildRoadmapOccupation, type RoadmapOccupationEntry, type RoadmapTeamOccupationEntry } from './roadmapOccupation';

/**
 * The screen's occupation tables word a missing team in the screen language: the API names it
 * `null`, and the shared module writes `words.noTeam`. Groups and their order stay the same.
 */
describe('buildRoadmapOccupation', () => {
  const compare = new Intl.Collator('en').compare;
  const occupation: RoadmapOccupationEntry[] = [
    { contributorId: 'ann', contributorName: 'Ann Durand', teamId: 'team-apps', teamName: 'Applications', week: '2026-01-05', occupationPct: 80 },
    { contributorId: 'bob', contributorName: 'Bob Klein', teamId: null, teamName: null, week: '2026-01-05', occupationPct: 50 },
    { contributorId: 'cyd', contributorName: 'Cyd Moreau', teamId: null, teamName: null, week: '2026-01-12', occupationPct: null },
  ];
  const teamOccupation: RoadmapTeamOccupationEntry[] = [
    { teamId: 'team-apps', teamName: 'Applications', week: '2026-01-05', occupationPct: 80 },
    { teamId: null, teamName: null, week: '2026-01-05', occupationPct: 50 },
  ];

  it('writes the translated word for a null team name, in the same groups and order', () => {
    const tables = buildRoadmapOccupation(occupation, teamOccupation, { noTeam: 'Aucune équipe' }, compare);
    expect(tables.contributorGroups.map((group) => [group.teamId, group.teamName])).toEqual([
      ['team-apps', 'Applications'],
      [null, 'Aucune équipe'],
    ]);
    expect(tables.teamRows.map((row) => [row.teamId, row.teamName])).toEqual([
      ['team-apps', 'Applications'],
      [null, 'Aucune équipe'],
    ]);
    // The two people without a team share one group; the label is never the English API word.
    expect(tables.contributorGroups[1].rows.map((row) => row.contributorName)).toEqual(['Bob Klein', 'Cyd Moreau']);
    expect(JSON.stringify(tables)).not.toContain('No team');
  });

  it('keeps a team name the API sends as it is', () => {
    const tables = buildRoadmapOccupation(
      [{ contributorId: 'ann', contributorName: 'Ann Durand', teamId: 'team-apps', teamName: 'Applications', week: '2026-01-05', occupationPct: 80 }],
      [{ teamId: 'team-apps', teamName: 'Applications', week: '2026-01-05', occupationPct: 80 }],
      { noTeam: 'Aucune équipe' },
      compare,
    );
    expect(tables.contributorGroups.map((group) => group.teamName)).toEqual(['Applications']);
    expect(tables.teamRows.map((row) => row.teamName)).toEqual(['Applications']);
  });
});
