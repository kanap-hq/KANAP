import { describe, expect, it } from 'vitest';

// The texts load per language and namespace on demand (#617). A static import of a locale file
// puts that file in the entry chunk for every user: app code reads texts through i18n instead.
// `src/i18n` itself is the one place that knows where the files are.
const sources = import.meta.glob<string>(
  ['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../i18n/**', '!../test/**'],
  { query: '?raw', import: 'default', eager: true },
);
const LOCALE_IMPORT = /from\s+['"][^'"]*locales\/[a-z]{2}\/[^'"]+\.json['"]|import\(\s*['"][^'"]*locales\/[a-z]{2}\/[^'"]+\.json['"]/;

describe('locale files', () => {
  it('are never imported directly by app code', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    const offenders = Object.entries(sources)
      .filter(([, text]) => LOCALE_IMPORT.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
