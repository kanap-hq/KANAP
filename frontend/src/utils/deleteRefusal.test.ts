import i18next, { type i18n as I18n } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { assetDeleteWarningLines, deleteFailureReason, type AssetDeleteWarning } from './deleteRefusal';

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

  it('keeps a closed or cancelled incident in the register, in each language', () => {
    const refusal = { code: 'INCIDENT_CLOSED_OR_CANCELLED', usages: [] };
    expect(deleteFailureReason(refusal, i18n.en.t, 'en')).toBe('This incident is closed or cancelled: it stays in the register.');
    expect(deleteFailureReason(refusal, i18n.fr.t, 'fr')).toBe('Cet incident est clôturé ou annulé : il reste au registre.');
    expect(deleteFailureReason(refusal, i18n.de.t, 'de')).toBe('Dieser Vorfall ist geschlossen oder abgebrochen: Er bleibt im Register.');
    expect(deleteFailureReason(refusal, i18n.es.t, 'es')).toBe('Este incidente está cerrado o cancelado: permanece en el registro.');
    for (const language of LANGUAGES) {
      expect(i18n[language].exists('errors:INCIDENT_CLOSED_OR_CANCELLED'), language).toBe(true);
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
    expect(deleteFailureReason(asset, i18n.fr.t, 'fr')).toBe('Cet actif est utilisé par 1 connexion. Retirez-le de là avant de le supprimer.');
    const location = (total: number) => ({ code: 'LOCATION_IN_USE', usages: [{ type: 'assets', total }] });
    expect(deleteFailureReason(location(1), i18n.en.t, 'en')).toBe('This location still holds 1 asset. Move it to another location before deleting this one.');
    expect(deleteFailureReason(location(3), i18n.en.t, 'en')).toBe('This location still holds 3 assets. Move them to another location before deleting this one.');
    expect(deleteFailureReason(location(3), i18n.fr.t, 'fr')).toBe('Ce site porte encore 3 actifs : rattachez-les à un autre site avant de supprimer celui-ci.');
    // Every sentence that points back at what holds the record has both forms, in each language.
    const codes = ['ASSET_IN_USE', 'COST_CENTER_HAS_NODES', 'CHART_OF_ACCOUNTS_IN_USE', 'ANALYTICS_DIMENSION_HAS_VALUES', 'TEAM_NOT_EMPTY',
      'ROLE_IN_USE', 'DEPLOYMENT_IN_USE', 'INTERFACE_HAS_BINDINGS', 'KNOWLEDGE_FOLDER_HAS_SUBFOLDERS', 'LOCATION_IN_USE'];
    for (const language of LANGUAGES) {
      for (const code of codes) {
        expect(i18n[language].exists(`errors:${code}_one`), `${language} ${code}_one`).toBe(true);
        expect(i18n[language].exists(`errors:${code}_other`), `${language} ${code}_other`).toBe(true);
      }
    }
  });

  it('names the applications that still use an asset, then the others', () => {
    const refusal = {
      code: 'ASSET_IN_USE',
      usages: [{ type: 'app_assignments', total: 2 }],
      applications: ['CheeseTrack', 'Sage X3'],
    };
    expect(deleteFailureReason(refusal, i18n.en.t, 'en'))
      .toBe('This asset is used by 2 application assignments (CheeseTrack and Sage X3). Remove it from them before deleting it.');
    expect(deleteFailureReason(refusal, i18n.fr.t, 'fr'))
      .toBe('Cet actif est utilisé par 2 affectations à des applications (CheeseTrack et Sage X3). Retirez-le de chacun d\'eux avant de le supprimer.');
    const many = {
      code: 'ASSET_IN_USE',
      usages: [{ type: 'app_assignments', total: 5 }],
      applications: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'],
    };
    expect(deleteFailureReason(many, i18n.en.t, 'en')).toContain('(Alpha, Bravo, Charlie, and 2 others)');
    expect(deleteFailureReason(many, i18n.fr.t, 'fr')).toContain('(Alpha, Bravo, Charlie et 2 autres)');
  });

  it('names up to five connections by reference and name, then how many more', () => {
    const one = {
      code: 'ASSET_IN_USE',
      usages: [{ type: 'connections', total: 1 }],
      connections: ['CONN-4 · Paris to Gouda'],
    };
    expect(deleteFailureReason(one, i18n.en.t, 'en'))
      .toBe('This asset is used by 1 connection (CONN-4 · Paris to Gouda). Remove it from there before deleting it.');
    expect(deleteFailureReason(one, i18n.fr.t, 'fr'))
      .toBe('Cet actif est utilisé par 1 connexion (CONN-4 · Paris to Gouda). Retirez-le de là avant de le supprimer.');
    expect(deleteFailureReason(one, i18n.de.t, 'de'))
      .toBe('Dieses Asset wird noch verwendet: 1 Verbindung (CONN-4 · Paris to Gouda). Entfernen Sie es dort, bevor Sie es löschen.');
    expect(deleteFailureReason(one, i18n.es.t, 'es'))
      .toBe('Este activo se usa en 1 conexión (CONN-4 · Paris to Gouda). Quítelo de allí antes de eliminarlo.');
    const both = {
      code: 'ASSET_IN_USE',
      usages: [{ type: 'app_assignments', total: 1 }, { type: 'connections', total: 1 }],
      applications: ['CheeseTrack'],
      connections: ['CONN-4 · Paris to Gouda'],
    };
    expect(deleteFailureReason(both, i18n.en.t, 'en'))
      .toBe('This asset is used by 1 application assignment (CheeseTrack) and 1 connection (CONN-4 · Paris to Gouda). Remove it from them before deleting it.');
    const many = {
      code: 'ASSET_IN_USE',
      usages: [{ type: 'connections', total: 7 }],
      connections: ['CONN-1 · A', 'CONN-2 · B', 'CONN-3 · C', 'CONN-4 · D', 'CONN-5 · E'],
    };
    expect(deleteFailureReason(many, i18n.en.t, 'en'))
      .toContain('(CONN-1 · A, CONN-2 · B, CONN-3 · C, CONN-4 · D, CONN-5 · E and 2 more)');
    expect(deleteFailureReason(many, i18n.fr.t, 'fr'))
      .toContain('(CONN-1 · A, CONN-2 · B, CONN-3 · C, CONN-4 · D, CONN-5 · E et 2 autres)');
    expect(deleteFailureReason({ ...one, usages: [{ type: 'connections', total: 2 }] }, i18n.en.t, 'en'))
      .toContain('(CONN-4 · Paris to Gouda and 1 more)');
  });

  it('keeps the reason of a failure without a code', () => {
    expect(deleteFailureReason({ reason: 'This line has amounts in a frozen budget column.' }, i18n.fr.t, 'fr'))
      .toBe('This line has amounts in a frozen budget column.');
  });

  describe('assetDeleteWarningLines', () => {
    const relation = (name: string, type = 'depends_on') => ({ id: name, name, relation_type: type, direction: 'outgoing' });
    const warning = (patch: Partial<AssetDeleteWarning>): AssetDeleteWarning => ({
      id: 'a', name: 'srv', member_of: [], member_count: 0, stops_hosting: [], relations: [], relations_total: 0, ...patch,
    });

    it('names the cluster a server leaves, in the interface language', () => {
      const one = warning({ member_of: [{ id: 'c', name: 'PAR-SQL-CL01' }] });
      expect(assetDeleteWarningLines(one, i18n.en.t, 'en')).toEqual(['Member of PAR-SQL-CL01: it will leave this cluster.']);
      expect(assetDeleteWarningLines(one, i18n.fr.t, 'fr')).toEqual(['Membre de PAR-SQL-CL01 : il quittera ce cluster.']);
      const two = warning({ member_of: [{ id: 'c', name: 'CL-1' }, { id: 'd', name: 'CL-2' }] });
      expect(assetDeleteWarningLines(two, i18n.en.t, 'en')).toEqual(['Member of CL-1 and CL-2: it will leave these clusters.']);
    });

    it('names the applications a server stops hosting through its clusters', () => {
      const two = warning({ stops_hosting: ['CheeseTrack', 'Sage X3'] });
      expect(assetDeleteWarningLines(two, i18n.en.t, 'en')).toEqual(['It will no longer host CheeseTrack and Sage X3.']);
      expect(assetDeleteWarningLines(two, i18n.fr.t, 'fr')).toEqual(["Il n'hébergera plus CheeseTrack et Sage X3."]);
      expect(assetDeleteWarningLines(warning({ stops_hosting: ['CheeseTrack'] }), i18n.de.t, 'de'))
        .toEqual(['Es hostet CheeseTrack nicht mehr.']);
      expect(assetDeleteWarningLines(warning({ stops_hosting: ['CheeseTrack'] }), i18n.es.t, 'es'))
        .toEqual(['Ya no alojará CheeseTrack.']);
      const many = warning({ stops_hosting: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'] });
      expect(assetDeleteWarningLines(many, i18n.en.t, 'en')).toEqual(['It will no longer host Alpha, Bravo, Charlie and 2 more.']);
      expect(assetDeleteWarningLines(many, i18n.fr.t, 'fr')).toEqual(["Il n'hébergera plus Alpha, Bravo, Charlie et 2 autres."]);
    });

    it('counts the members a cluster lets go', () => {
      expect(assetDeleteWarningLines(warning({ member_count: 2 }), i18n.fr.t, 'fr')).toEqual(['Cluster de 2 membres : ils perdront leur cluster.']);
      expect(assetDeleteWarningLines(warning({ member_count: 1 }), i18n.en.t, 'en')).toEqual(['Cluster of 1 member: it will lose its cluster.']);
    });

    it('counts the links and names the first assets, then the others', () => {
      const few = warning({ relations: [relation('PAR-ESX-01'), relation('PAR-ESX-02')], relations_total: 2 });
      expect(assetDeleteWarningLines(few, i18n.en.t, 'en')).toEqual(['2 links will be removed: PAR-ESX-01 and PAR-ESX-02.']);
      const many = warning({ relations: ['A', 'B', 'C', 'D', 'E'].map((name) => relation(name)), relations_total: 12 });
      expect(assetDeleteWarningLines(many, i18n.en.t, 'en')).toEqual(['12 links will be removed: A, B, C and 9 more.']);
      expect(assetDeleteWarningLines(many, i18n.fr.t, 'fr')).toEqual(['12 liens seront supprimés : A, B, C et 9 autres.']);
      // Two links to one asset name it once and count both.
      const twice = warning({ relations: [relation('A'), relation('A', 'contains')], relations_total: 2 });
      expect(assetDeleteWarningLines(twice, i18n.en.t, 'en')).toEqual(['2 links will be removed: A.']);
    });

    it('gives one line per case and none for an asset without any', () => {
      const all = warning({
        member_of: [{ id: 'c', name: 'CL' }], member_count: 3, stops_hosting: ['CheeseTrack'],
        relations: [relation('X')], relations_total: 1,
      });
      expect(assetDeleteWarningLines(all, i18n.en.t, 'en')).toEqual([
        'Member of CL: it will leave this cluster.',
        'It will no longer host CheeseTrack.',
        'Cluster of 3 members: they will lose their cluster.',
        '1 link will be removed: X.',
      ]);
      expect(assetDeleteWarningLines(warning({}), i18n.en.t, 'en')).toEqual([]);
    });

    it('has every sentence in each language, in both plural forms', () => {
      for (const language of LANGUAGES) {
        for (const key of ['memberOf', 'hasMembers', 'links', 'more']) {
          for (const form of ['one', 'other']) {
            expect(i18n[language].exists(`common:delete.assetWarning.${key}_${form}`), `${language} ${key}_${form}`).toBe(true);
          }
        }
        expect(i18n[language].exists('common:delete.assetWarning.stopsHosting'), `${language} stopsHosting`).toBe(true);
        expect(i18n[language].exists('common:delete.anyway'), `${language} anyway`).toBe(true);
      }
    });
  });
});
