import i18next, { type i18n as I18n } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { environmentLabel } from './applicationEnvironments';

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

describe('environmentLabel', () => {
  const i18n: Record<string, I18n> = {};
  beforeAll(async () => {
    for (const language of LANGUAGES) i18n[language] = await instance(language);
  });

  it('uses the deployments-editor names, including codes written in upper case or with a hyphen', () => {
    expect(environmentLabel(i18n.fr.t, 'prod')).toBe('Prod');
    expect(environmentLabel(i18n.fr.t, 'PROD')).toBe('Prod');
    expect(environmentLabel(i18n.fr.t, 'pre_prod')).toBe('Pré-prod');
    expect(environmentLabel(i18n.fr.t, 'PRE-PROD')).toBe('Pré-prod');
    expect(environmentLabel(i18n.fr.t, 'qa')).toBe('QA');
    expect(environmentLabel(i18n.fr.t, 'sandbox')).toBe('Bac à sable');
    expect(environmentLabel(i18n.de.t, 'pre_prod')).toBe('Pre-Prod');
    expect(environmentLabel(i18n.en.t, 'dev')).toBe('Dev');
    expect(environmentLabel(i18n.es.t, 'test')).toBe('Test');
  });

  it('does not fall back to the upper-case code', () => {
    for (const language of LANGUAGES) {
      expect(environmentLabel(i18n[language].t, 'prod')).not.toBe('PROD');
      expect(environmentLabel(i18n[language].t, 'pre_prod')).not.toBe('PRE_PROD');
      expect(environmentLabel(i18n[language].t, 'pre_prod')).not.toBe('PRE-PROD');
      expect(environmentLabel(i18n[language].t, 'sandbox')).not.toBe('SANDBOX');
    }
  });

  it('returns an unknown code as stored, and a blank as empty', () => {
    expect(environmentLabel(i18n.fr.t, 'staging')).toBe('staging');
    expect(environmentLabel(i18n.fr.t, null)).toBe('');
    expect(environmentLabel(i18n.fr.t, '  ')).toBe('');
  });
});
