import { describe, expect, it } from 'vitest';
import en from '../../locales/en/ops.json';
import fr from '../../locales/fr/ops.json';
import de from '../../locales/de/ops.json';
import es from '../../locales/es/ops.json';

/**
 * The words the analytics report adds: the number of lines, the detail by line, the nature and the
 * hidden lines. Every language carries them, with the `{{count}}` placeholder of the singular and
 * plural forms; the screen renders them through `t`, never in code.
 */
const LOCALES = { en, fr, de, es } as const;
const KEYS = ['lines', 'nature', 'detail', 'hidden_one', 'hidden_other', 'split', 'opexShare', 'capexShare', 'splitChartTitle'] as const;

describe('the analytics report locale keys', () => {
  it.each(Object.entries(LOCALES))('%s carries every new key', (_language, locale) => {
    const words = (locale as typeof en).reports.analyticsCategory as unknown as Record<string, string>;
    for (const key of KEYS) {
      expect(words[key], key).toBeTypeOf('string');
      expect(words[key].trim(), key).not.toBe('');
    }
    expect(words.hidden_one).toContain('{{count}}');
    expect(words.hidden_other).toContain('{{count}}');
  });

  it('words the hidden lines in the report language, never in English', () => {
    expect(fr.reports.analyticsCategory.hidden_other).toBe('et {{count}} lignes hors de votre accès');
    expect(de.reports.analyticsCategory.hidden_other).toContain('außerhalb');
    expect(es.reports.analyticsCategory.hidden_other).toContain('fuera de su acceso');
  });
});
