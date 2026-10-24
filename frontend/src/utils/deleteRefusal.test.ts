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
    const kinds = [
      'budget_lines', 'contracts', 'applications', 'assets', 'cost_centers', 'departments', 'users', 'locations', 'tasks',
      'interfaces', 'projects', 'requests', 'team_members', 'allocation_rules',
    ];
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

  it('says an object is linked to lines outside the data access, from a delete check or a refused delete', () => {
    const refusal = { code: 'APPLICATION_HIDDEN_LINES', usages: [], params: { count: 3 } };
    expect(deleteFailureReason(refusal, i18n.en.t, 'en')).toBe('This application is linked to 3 lines outside your access.');
    expect(deleteFailureReason({ ...refusal, code: 'PROJECT_HIDDEN_LINES', params: { count: 1 } }, i18n.fr.t, 'fr'))
      .toBe('Ce projet est lié à 1 ligne hors de votre accès.');
    // The 403 of the delete itself, by its sentence.
    const refused = { code: 'DATA_ACCESS_LIMITED', message: 'This asset is linked to 2 lines outside your access.' };
    expect(deleteFailureReason(refused, i18n.es.t, 'es')).toBe('Este activo está vinculado a 2 líneas fuera de su acceso.');
    for (const language of LANGUAGES) {
      for (const type of ['APPLICATION', 'ASSET', 'TECHNOLOGY', 'PROJECT', 'REQUEST']) {
        expect(deleteFailureReason({ code: `${type}_HIDDEN_LINES`, usages: [], params: { count: 2 } }, i18n[language].t, language), `${language} ${type}`)
          .toMatch(/ 2 /);
      }
    }
  });

  it('says how many compliance requirements a refused contract has recorded, in each language', () => {
    const refusal = { code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', usages: [{ type: 'compliance_requirements', total: 3 }] };
    expect(deleteFailureReason(refusal, i18n.en.t, 'en'))
      .toBe('This contract has 3 recorded compliance requirements. Disable it instead of deleting it.');
    expect(deleteFailureReason({ ...refusal, usages: [{ type: 'compliance_requirements', total: 1 }] }, i18n.en.t, 'en'))
      .toBe('This contract has 1 recorded compliance requirement. Disable it instead of deleting it.');
    expect(deleteFailureReason(refusal, i18n.fr.t, 'fr'))
      .toBe('Ce contrat a 3 exigences de conformité renseignées. Désactivez-le plutôt que de le supprimer.');
    for (const language of LANGUAGES) {
      expect(i18n[language].exists('errors:CONTRACT_HAS_COMPLIANCE_RECORDS'), language).toBe(true);
      expect(deleteFailureReason(refusal, i18n[language].t, language), language).toMatch(/ 3 /);
    }
  });

  it('counts the new kinds of a company refusal', () => {
    const refusal = {
      code: 'COMPANY_IN_USE',
      usages: [{ type: 'departments', total: 2 }, { type: 'users', total: 14 }, { type: 'team_members', total: 1 }],
    };
    expect(deleteFailureReason(refusal, i18n.fr.t, 'fr'))
      .toBe("Cette société est utilisée par 2 départements, 14 utilisateurs et 1 membre d'équipe. Désactivez-la plutôt que de la supprimer.");
    expect(deleteFailureReason(refusal, i18n.de.t, 'de'))
      .toBe('Dieses Unternehmen wird noch verwendet: 2 Abteilungen, 14 Benutzer und 1 Teammitglied. Deaktivieren Sie es, statt es zu löschen.');
  });

  it('names the values a refusal carries: a frozen column and its year', () => {
    const frozen = { reason: 'English', code: 'BUDGET_LINE_FROZEN', usages: [], params: { column: 'Budget', year: 2026 } };
    expect(deleteFailureReason(frozen, i18n.fr.t, 'fr')).toMatch(/^Cette ligne a des montants dans Budget 2026, une colonne budgétaire gelée\./);
    expect(deleteFailureReason(frozen, i18n.en.t, 'en')).toMatch(/^This line has amounts in Budget 2026, a frozen budget column\./);
  });

  it('words what to do with what holds the record in the singular when there is one', () => {
    const nodes = (total: number) => ({ code: 'COST_CENTER_HAS_NODES', usages: [{ type: 'nodes', total }] });
    expect(deleteFailureReason(nodes(1), i18n.fr.t, 'fr')).toBe('Ce groupe contient 1 élément. Déplacez-le ou supprimez-le d’abord.');
    expect(deleteFailureReason(nodes(2), i18n.fr.t, 'fr')).toBe('Ce groupe contient 2 éléments. Déplacez-les ou supprimez-les d’abord.');
    expect(deleteFailureReason(nodes(1), i18n.en.t, 'en')).toBe('This group contains 1 node. Move or delete it first.');
    const folder = { code: 'KNOWLEDGE_FOLDER_HAS_SUBFOLDERS', usages: [{ type: 'sub_folders', total: 1 }] };
    expect(deleteFailureReason(folder, i18n.fr.t, 'fr')).toBe('Ce dossier contient encore 1 sous-dossier. Déplacez-le ou supprimez-le d’abord.');
    const asset = { code: 'ASSET_IN_USE', usages: [{ type: 'connections', total: 1 }] };
    expect(deleteFailureReason(asset, i18n.fr.t, 'fr')).toBe('Cet actif est utilisé par 1 connexion. Retirez-le de cet élément avant de le supprimer.');
    // Every sentence that points back at what holds the record has both forms, in each language.
    const codes = ['ASSET_IN_USE', 'COST_CENTER_HAS_NODES', 'CHART_OF_ACCOUNTS_IN_USE', 'ANALYTICS_DIMENSION_HAS_VALUES', 'TEAM_NOT_EMPTY',
      'ROLE_IN_USE', 'DEPLOYMENT_IN_USE', 'INTERFACE_HAS_BINDINGS', 'KNOWLEDGE_FOLDER_HAS_SUBFOLDERS'];
    for (const language of LANGUAGES) {
      for (const code of codes) {
        expect(i18n[language].exists(`errors:${code}_one`), `${language} ${code}_one`).toBe(true);
        expect(i18n[language].exists(`errors:${code}_other`), `${language} ${code}_other`).toBe(true);
      }
    }
  });

  it('keeps the reason of a failure without a code', () => {
    expect(deleteFailureReason({ reason: 'This line has amounts in a frozen budget column.' }, i18n.fr.t, 'fr'))
      .toBe('This line has amounts in a frozen budget column.');
  });
});
