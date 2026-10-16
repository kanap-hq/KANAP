import type { TranslationTree } from './localeSource';

// Test-only replacement of `localeSource.ts` (see `src/test/setup.ts`): every language is bundled,
// so i18next starts synchronously with all of them. Never imported by the app.
export const bundledLocales: Record<string, TranslationTree> = import.meta.glob<TranslationTree>('../locales/*/*.json', {
  eager: true,
  import: 'default',
});

export const localeLoaders: Record<string, () => Promise<TranslationTree>> = Object.fromEntries(
  Object.entries(bundledLocales).map(([path, tree]) => [path, () => Promise.resolve(tree)]),
);
