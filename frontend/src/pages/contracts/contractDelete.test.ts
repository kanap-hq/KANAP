import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../../locales/en/ops.json';
import fr from '../../locales/fr/ops.json';
import de from '../../locales/de/ops.json';
import es from '../../locales/es/ops.json';
import { contractDeleteImpactText, type ContractDeleteImpact } from './contractDelete';

const NOTHING: ContractDeleteImpact = {
  contracts: 1, budget_lines: 0, applications: 0, assets: 0, contacts: 0, tasks: 0, links: 0, attachments: 0, compliance_items: 0,
};

async function translator(lng: string, resources: unknown) {
  const i18n = i18next.createInstance();
  await i18n.init({ lng, resources: { [lng]: { ops: resources as Record<string, unknown> } }, defaultNS: 'ops', interpolation: { escapeValue: false } });
  return i18n.t.bind(i18n);
}

describe('contractDeleteImpactText', () => {
  it('says nothing when the contracts have no link and hold nothing', async () => {
    expect(contractDeleteImpactText(await translator('en', en), 'en', NOTHING)).toBeNull();
  });

  it('counts what loses its link and what goes with the contract', async () => {
    const t = await translator('en', en);
    expect(contractDeleteImpactText(t, 'en', {
      ...NOTHING, budget_lines: 3, applications: 1, assets: 2, contacts: 1, tasks: 2, links: 1, attachments: 2, compliance_items: 4,
    })).toBe(
      'These links are removed: 3 budget lines, 1 application, 2 assets, 1 contact, and 2 tasks. The linked items stay. '
      + 'Also deleted: 1 website link, 2 attachments, and 4 recorded requirements. This cannot be undone.',
    );
    expect(contractDeleteImpactText(t, 'en', { ...NOTHING, tasks: 1 })).toBe(
      'These links are removed: 1 task. The linked items stay. This cannot be undone.',
    );
    expect(contractDeleteImpactText(t, 'en', { ...NOTHING, attachments: 1 })).toBe('Also deleted: 1 attachment. This cannot be undone.');
  });

  it.each([['fr', fr], ['de', de], ['es', es]])('has every sentence in %s', async (lng, resources) => {
    const t = await translator(lng, resources);
    const text = contractDeleteImpactText(t, lng, {
      ...NOTHING, budget_lines: 2, applications: 2, assets: 2, contacts: 2, tasks: 2, links: 2, attachments: 2, compliance_items: 2,
    })!;
    expect(text).not.toMatch(/contracts\.delete|\{\{/);
    expect(text).toContain('2');
  });
});
