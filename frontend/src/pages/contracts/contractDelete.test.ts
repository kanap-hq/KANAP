import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../../locales/en/ops.json';
import fr from '../../locales/fr/ops.json';
import de from '../../locales/de/ops.json';
import es from '../../locales/es/ops.json';
import { contractDeleteImpactText, type ContractDeleteImpact } from './contractDelete';

const NOTHING: ContractDeleteImpact = {
  contracts: 1, budget_lines: 0, applications: 0, assets: 0, contacts: 0, tasks: 0, links: 0, attachments: 0, blocked: 0, recorded_requirements: 0, refused: [],
};

async function translator(lng: string, resources: unknown) {
  const i18n = i18next.createInstance();
  await i18n.init({ lng, resources: { [lng]: { ops: resources as Record<string, unknown> } }, defaultNS: 'ops', interpolation: { escapeValue: false } });
  return i18n.t.bind(i18n);
}

describe('contractDeleteImpactText', () => {
  it('says what happens to a contract linked to nothing', async () => {
    const t = await translator('en', en);
    expect(contractDeleteImpactText(t, 'en', NOTHING)).toEqual({
      text: 'This contract is linked to nothing and holds nothing. This cannot be undone.',
      dependants: false,
    });
    expect(contractDeleteImpactText(t, 'en', { ...NOTHING, contracts: 2 }).text)
      .toBe('These contracts are linked to nothing and hold nothing. This cannot be undone.');
  });

  it('counts what loses its link and what goes with the contract, tasks included', async () => {
    const t = await translator('en', en);
    expect(contractDeleteImpactText(t, 'en', {
      ...NOTHING, budget_lines: 3, applications: 1, assets: 2, contacts: 1, tasks: 2, links: 1, attachments: 2,
    })).toEqual({
      text: 'These links are removed: 3 budget lines, 1 application, 2 assets, and 1 contact. The linked items stay. '
        + 'Also deleted: 2 tasks, 1 website link, and 2 attachments. This cannot be undone.',
      dependants: true,
    });
    expect(contractDeleteImpactText(t, 'en', { ...NOTHING, tasks: 1 }).text).toBe('Also deleted: 1 task. This cannot be undone.');
  });

  it('leaves the refused contracts to the list of kept ones', async () => {
    const t = await translator('en', en);
    // One contract can go (a website link goes with it), two are refused: the text speaks of the one.
    expect(contractDeleteImpactText(t, 'en', { ...NOTHING, contracts: 1, blocked: 2, recorded_requirements: 5, links: 1 }).text)
      .toBe('Also deleted: 1 website link. This cannot be undone.');
    expect(contractDeleteImpactText(t, 'en', { ...NOTHING, contracts: 0, blocked: 1, recorded_requirements: 1 }))
      .toEqual({ text: '', dependants: false });
  });

  it.each([['fr', fr], ['de', de], ['es', es]])('has every sentence in %s', async (lng, resources) => {
    const t = await translator(lng, resources);
    for (const impact of [
      { ...NOTHING, budget_lines: 2, applications: 2, assets: 2, contacts: 2, tasks: 2, links: 2, attachments: 2, blocked: 2, recorded_requirements: 2 },
      NOTHING,
      { ...NOTHING, contracts: 2 },
    ]) {
      const { text } = contractDeleteImpactText(t, lng, impact);
      expect(text).not.toMatch(/contracts\.delete|\{\{/);
    }
  });
});
