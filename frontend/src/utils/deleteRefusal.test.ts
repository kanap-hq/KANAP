import i18next, { type i18n as I18n } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { deleteFailureReason } from './deleteRefusal';

const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;

async function instance(lng: string): Promise<I18n> {
  const resources: Record<string, Record<string, unknown>> = {};
  for (const language of LANGUAGES) {
    resources[language] = {
      common: (await import(`../locales/${language}/common.json`)).default,
      errors: (await import(`../locales/${language}/errors.json`)).default,
    };
  }
  const i18n = i18next.createInstance();
  await i18n.init({ lng, fallbackLng: 'en', ns: ['common', 'errors'], defaultNS: 'common', resources: resources as any, interpolation: { escapeValue: false } });
  return i18n;
}

const SUPPLIER_REFUSAL = {
  name: 'Acme',
  reason: 'Cannot delete supplier "Acme": it is used by 2 contracts and 1 application. Disable it instead.',
  code: 'SUPPLIER_IN_USE',
  usages: [{ type: 'contracts', total: 2 }, { type: 'applications', total: 1 }],
};

describe('deleteFailureReason', () => {
  const i18n: Record<string, I18n> = {};
  beforeAll(async () => {
    for (const language of LANGUAGES) i18n[language] = await instance(language);
  });

  it('says what uses a supplier, counted per kind, in the interface language', () => {
    expect(deleteFailureReason(SUPPLIER_REFUSAL, i18n.en.t, 'en'))
      .toBe('This supplier is used by 2 contracts and 1 application. Disable it instead of deleting it.');
    expect(deleteFailureReason(SUPPLIER_REFUSAL, i18n.fr.t, 'fr'))
      .toBe('Ce fournisseur est utilisé par 2 contrats et 1 application. Désactivez-le plutôt que de le supprimer.');
  });

  it('names a company, with three kinds listed', () => {
    const refusal = {
      reason: 'Cannot delete company "Lyon": it is used by 1 budget line, 3 contracts and 2 cost centers. Disable it instead.',
      code: 'COMPANY_IN_USE',
      usages: [{ type: 'budget_lines', total: 1 }, { type: 'contracts', total: 3 }, { type: 'cost_centers', total: 2 }],
    };
    expect(deleteFailureReason(refusal, i18n.en.t, 'en'))
      .toBe('This company is used by 1 budget line, 3 contracts, and 2 cost centers. Disable it instead of deleting it.');
    expect(deleteFailureReason(refusal, i18n.fr.t, 'fr'))
      .toBe('Cette société est utilisée par 1 ligne budgétaire, 3 contrats et 2 centres de coûts. Désactivez-la plutôt que de la supprimer.');
  });

  it('has the sentences and every kind in each language', () => {
    const kinds = ['budget_lines', 'contracts', 'applications', 'assets', 'cost_centers'];
    for (const language of LANGUAGES) {
      for (const code of ['SUPPLIER_IN_USE', 'COMPANY_IN_USE']) {
        expect(i18n[language].exists(`errors:${code}`), `${language} errors:${code}`).toBe(true);
      }
      for (const kind of kinds) {
        for (const count of [1, 2]) {
          const text = i18n[language].t(`common:delete.usages.${kind}`, { count });
          expect(text, `${language} ${kind} ${count}`).toMatch(new RegExp(`^${count} \\S`));
        }
      }
    }
  });

  it('keeps the reason of a failure without a code', () => {
    expect(deleteFailureReason({ reason: 'This line has amounts in a frozen budget column.' }, i18n.fr.t, 'fr'))
      .toBe('This line has amounts in a frozen budget column.');
  });
});
