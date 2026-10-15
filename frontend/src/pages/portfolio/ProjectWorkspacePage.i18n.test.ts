import { describe, expect, it } from 'vitest';
import source from './ProjectWorkspacePage.tsx?raw';
import en from '../../locales/en/portfolio.json';
import fr from '../../locales/fr/portfolio.json';
import de from '../../locales/de/portfolio.json';
import es from '../../locales/es/portfolio.json';

function has(tree: unknown, path: string): boolean {
  let node: unknown = tree;
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

describe('ProjectWorkspacePage i18n', () => {
  it('reads every portfolio key it names from the four locales', () => {
    const keys = Array.from(new Set(Array.from(source.matchAll(/\bt\(\s*'portfolio:([\w.]+)'/g), (m) => m[1])));
    expect(keys.length).toBeGreaterThan(0);
    for (const [language, tree] of Object.entries({ en, fr, de, es })) {
      const missing = keys.filter((key) => !has(tree, key) && !has(tree, `${key}_one`));
      expect(missing, language).toEqual([]);
    }
  });
});
