import i18next, { type i18n as I18n } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { interfaceRouteIntro, legTypeLabel, routeTypeLabel } from './interfaceLegType';

const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;

async function instance(lng: string): Promise<I18n> {
  const resources: Record<string, Record<string, unknown>> = {};
  for (const language of LANGUAGES) {
    resources[language] = { it: (await import(`../locales/${language}/it.json`)).default };
  }
  const i18n = i18next.createInstance();
  await i18n.init({ lng, fallbackLng: 'en', ns: ['it'], defaultNS: 'it', resources: resources as any, interpolation: { escapeValue: false } });
  return i18n;
}

describe('interface route and leg labels', () => {
  const i18n: Record<string, I18n> = {};
  beforeAll(async () => {
    for (const language of LANGUAGES) i18n[language] = await instance(language);
  });

  it('names the route type in the reader language', () => {
    expect(routeTypeLabel(i18n.fr.t, 'via_middleware')).toBe('Via middleware');
    expect(routeTypeLabel(i18n.de.t, 'via_middleware')).toBe('Über Middleware');
    expect(routeTypeLabel(i18n.fr.t, 'direct')).toBe('Direct');
    expect(routeTypeLabel(i18n.fr.t, null)).toBe('');
    expect(routeTypeLabel(i18n.fr.t, 'other')).toBe('other');
  });

  it('lists the middleware legs with the labels of the bindings matrix', () => {
    expect(interfaceRouteIntro(i18n.fr.t, 'via_middleware'))
      .toBe('Type de route : via middleware. Tronçons : Extraction, Transformation, Chargement.');
    expect(interfaceRouteIntro(i18n.en.t, 'via_middleware'))
      .toBe('Route type: via middleware. Legs: Extract, Transform, Load.');
    expect(legTypeLabel(i18n.es.t, 'load')).toBe('Carga');
  });

  it('never shows a raw leg code in any language', () => {
    for (const language of LANGUAGES) {
      for (const route of ['via_middleware', 'direct']) {
        expect(interfaceRouteIntro(i18n[language].t, route)).not.toMatch(/EXTRACT|TRANSFORM|LOAD|DIRECT/);
      }
    }
  });
});
