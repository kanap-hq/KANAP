export type TranslationValue = string | { [key: string]: TranslationValue };
export type TranslationTree = { [key: string]: TranslationValue };

/**
 * The texts of every language, one lazy chunk per `../locales/<language>/<namespace>.json` file:
 * the app downloads only what it uses. Any JSON file added there is picked up.
 */
export const localeLoaders: Record<string, () => Promise<TranslationTree>> = import.meta.glob<TranslationTree>(
  '../locales/*/*.json',
  { import: 'default' },
);

/**
 * Every text already in memory, by the same paths. Only the test source (`localeSource.eager.ts`,
 * swapped in by `src/test/setup.ts`) sets it; the app starts from the downloads above.
 */
export const bundledLocales: Record<string, TranslationTree> | null = null;
