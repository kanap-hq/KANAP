import { describe, expect, it } from 'vitest';
import { buildOrgForest, contributorName, type OrgContributor } from './orgChart';

const INTERNAL = 'type-internal';
const EXTERNAL = 'type-external';

function person(
  index: number,
  name: string,
  overrides: Partial<OrgContributor> = {},
): OrgContributor {
  return {
    id: `c-${index}`,
    item_number: index,
    user_id: `u-${index}`,
    user_display_name: name,
    user_email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    user_status: 'enabled',
    employment_type_id: INTERNAL,
    employment_type_name: 'Internal',
    manager_user_id: null,
    skills: [],
    ...overrides,
  };
}

/**
 * Ada reports to a director who is not a contributor, so she tops the chart.
 * Cleo is external, Eve is disabled; each has one report of their own, which is
 * what the reattachment rule is about.
 */
const TEAM: OrgContributor[] = [
  person(1, 'Ada Lovelace', { manager_user_id: 'u-director' }),
  person(2, 'Ben Carter', { manager_user_id: 'u-1' }),
  person(3, 'Cleo Marsh', { manager_user_id: 'u-1', employment_type_id: EXTERNAL, employment_type_name: 'External' }),
  person(4, 'Dan Reed', { manager_user_id: 'u-3' }),
  person(5, 'Eve Nunes', { manager_user_id: 'u-1', user_status: 'disabled' }),
  person(6, 'Finn Adler', { manager_user_id: 'u-5' }),
];

const names = (nodes: { name: string }[]) => nodes.map((node) => node.name);
const childrenOf = (forest: ReturnType<typeof buildOrgForest>, name: string) => (
  names(forest.nodes.find((node) => node.name === name)?.children ?? [])
);
const find = (forest: ReturnType<typeof buildOrgForest>, name: string) => (
  forest.nodes.find((node) => node.name === name)
);

describe('buildOrgForest', () => {
  it('builds the forest from the manager links, skipping disabled accounts', () => {
    const forest = buildOrgForest({ contributors: TEAM });

    // Ada's own manager is not a contributor, so she is the only root.
    expect(names(forest.roots)).toEqual(['Ada Lovelace']);
    expect(childrenOf(forest, 'Ada Lovelace')).toEqual(['Ben Carter', 'Cleo Marsh', 'Finn Adler']);
    expect(childrenOf(forest, 'Cleo Marsh')).toEqual(['Dan Reed']);
    expect(find(forest, 'Eve Nunes')).toBeUndefined();
    expect(find(forest, 'Ada Lovelace')?.reference).toBe('MEM-1');
  });

  it('lays every managerless contributor out as its own root', () => {
    const forest = buildOrgForest({
      contributors: [
        person(1, 'Ada Lovelace'),
        person(2, 'Ben Carter'),
        person(3, 'Cleo Marsh', { manager_user_id: 'u-2' }),
      ],
    });

    expect(names(forest.roots)).toEqual(['Ada Lovelace', 'Ben Carter']);
    expect(childrenOf(forest, 'Ben Carter')).toEqual(['Cleo Marsh']);
  });

  it('makes the report of a manager who is not a contributor a root', () => {
    const forest = buildOrgForest({
      contributors: [person(1, 'Ada Lovelace', { manager_user_id: 'u-outside' })],
    });

    expect(names(forest.roots)).toEqual(['Ada Lovelace']);
    expect(find(forest, 'Ada Lovelace')?.via).toEqual([]);
  });

  it('roots the chart on one contributor when a reference is given', () => {
    const forest = buildOrgForest({ contributors: TEAM, rootReference: 'MEM-3' });

    expect(names(forest.roots)).toEqual(['Cleo Marsh']);
    expect(names(forest.nodes)).toEqual(['Cleo Marsh', 'Dan Reed']);
    expect(forest.rootMissing).toBe(false);
  });

  it('falls back to the forest and says so when the reference is unknown', () => {
    const forest = buildOrgForest({ contributors: TEAM, rootReference: 'MEM-99' });

    expect(forest.rootMissing).toBe(true);
    expect(names(forest.roots)).toEqual(['Ada Lovelace']);
  });

  it('reattaches the reports of a hidden contract type to the nearest visible ancestor', () => {
    const forest = buildOrgForest({ contributors: TEAM, hiddenEmploymentTypeIds: [EXTERNAL] });

    expect(find(forest, 'Cleo Marsh')).toBeUndefined();
    expect(childrenOf(forest, 'Ada Lovelace')).toEqual(['Ben Carter', 'Dan Reed', 'Finn Adler']);
    // The hint names the manager the reader can no longer see.
    expect(find(forest, 'Dan Reed')?.via).toEqual(['Cleo Marsh']);
    expect(find(forest, 'Ben Carter')?.via).toEqual([]);
  });

  it('names every manager skipped on the way up, nearest first', () => {
    const forest = buildOrgForest({
      contributors: [
        person(1, 'Ada Lovelace'),
        person(2, 'Ben Carter', { manager_user_id: 'u-1', employment_type_id: EXTERNAL }),
        person(3, 'Cleo Marsh', { manager_user_id: 'u-2', employment_type_id: EXTERNAL }),
        person(4, 'Dan Reed', { manager_user_id: 'u-3' }),
      ],
      hiddenEmploymentTypeIds: [EXTERNAL],
    });

    expect(childrenOf(forest, 'Ada Lovelace')).toEqual(['Dan Reed']);
    expect(find(forest, 'Dan Reed')?.via).toEqual(['Cleo Marsh', 'Ben Carter']);
  });

  it('reattaches the report of a disabled manager, then puts them back on demand', () => {
    const without = buildOrgForest({ contributors: TEAM });
    expect(childrenOf(without, 'Ada Lovelace')).toContain('Finn Adler');
    expect(find(without, 'Finn Adler')?.via).toEqual(['Eve Nunes']);

    const withDisabled = buildOrgForest({ contributors: TEAM, includeDisabled: true });
    expect(childrenOf(withDisabled, 'Ada Lovelace')).toEqual([
      'Ben Carter', 'Cleo Marsh', 'Eve Nunes',
    ]);
    expect(childrenOf(withDisabled, 'Eve Nunes')).toEqual(['Finn Adler']);
    expect(find(withDisabled, 'Finn Adler')?.via).toEqual([]);
  });

  it('leaves the root alone when a branch chart starts under a hidden manager', () => {
    const forest = buildOrgForest({
      contributors: TEAM,
      hiddenEmploymentTypeIds: [EXTERNAL],
      rootReference: 'MEM-4',
    });

    expect(names(forest.roots)).toEqual(['Dan Reed']);
    expect(find(forest, 'Dan Reed')?.via).toEqual([]);
  });

  it('keeps only the levels asked for below the root', () => {
    const all = buildOrgForest({ contributors: TEAM });
    expect(names(all.nodes)).toHaveLength(5);

    const oneLevel = buildOrgForest({ contributors: TEAM, maxDepth: 1 });
    expect(names(oneLevel.nodes)).toEqual(['Ada Lovelace', 'Ben Carter', 'Cleo Marsh', 'Finn Adler']);
    // The last visible level reports no children, so no chevron invites a click.
    expect(childrenOf(oneLevel, 'Cleo Marsh')).toEqual([]);

    const twoLevels = buildOrgForest({ contributors: TEAM, maxDepth: 2 });
    expect(childrenOf(twoLevels, 'Cleo Marsh')).toEqual(['Dan Reed']);
    expect(find(twoLevels, 'Dan Reed')?.depth).toBe(2);
  });

  it('survives a stored cycle instead of looping, and loses nobody', () => {
    const forest = buildOrgForest({
      contributors: [
        person(1, 'Ada Lovelace', { manager_user_id: 'u-2' }),
        person(2, 'Ben Carter', { manager_user_id: 'u-1' }),
        person(3, 'Cleo Marsh', { manager_user_id: 'u-2' }),
      ],
    });

    expect(names(forest.roots)).toEqual(['Ada Lovelace']);
    expect(names(forest.nodes).sort()).toEqual(['Ada Lovelace', 'Ben Carter', 'Cleo Marsh']);
  });

  it('survives a contributor who is their own manager', () => {
    const forest = buildOrgForest({
      contributors: [person(1, 'Ada Lovelace', { manager_user_id: 'u-1' })],
    });

    expect(names(forest.roots)).toEqual(['Ada Lovelace']);
  });

  it('offers the visible contributors as the options of the root picker', () => {
    const forest = buildOrgForest({ contributors: TEAM, hiddenEmploymentTypeIds: [EXTERNAL] });

    expect(forest.eligible.map(contributorName)).toEqual([
      'Ada Lovelace', 'Ben Carter', 'Dan Reed', 'Finn Adler',
    ]);
  });

  it('falls back to the e-mail only when a contributor has no name at all', () => {
    const forest = buildOrgForest({
      contributors: [person(1, '', { user_display_name: '   ', user_email: 'ada@example.com' })],
    });

    expect(names(forest.roots)).toEqual(['ada@example.com']);
  });
});
