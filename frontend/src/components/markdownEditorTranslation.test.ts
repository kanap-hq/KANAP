import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { markdownEditorTranslation } from './markdownEditorTranslation';
import en from '../locales/en/common.json';
import fr from '../locales/fr/common.json';
import de from '../locales/de/common.json';
import es from '../locales/es/common.json';

// Every text the rich-text editor shows (toolbar buttons, tooltips, dialogs) goes through its
// translation function. This reads the keys the installed version asks for, so an upgrade that
// adds one fails here until the locale files hold it.
// The frontend type-checks without Node's types: the two calls this test needs, typed here.
type DirEntry = { name: string; isDirectory(): boolean };
type NodeFs = {
  readdirSync(dir: string, options: { withFileTypes: true }): DirEntry[];
  readFileSync(file: string, encoding: 'utf8'): string;
};
const nodeProcess = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs } }).process;

function libraryKeys(): string[] {
  const fs = nodeProcess.getBuiltinModule('node:fs');
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(/\bt\(\s*"([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)) keys.add(match[1]);
      }
    }
  };
  walk(`${nodeProcess.cwd()}/node_modules/@mdxeditor/editor/dist`);
  return [...keys].sort();
}

const lookup = (bundle: unknown, key: string) =>
  `markdownEditor.mdx.${key}`.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], bundle);

describe('rich-text editor texts', () => {
  const keys = libraryKeys();

  it('finds the keys of the installed editor', () => {
    expect(keys).toContain('toolbar.bold');
    expect(keys).toContain('toolbar.image');
  });

  it.each([['en', en], ['fr', fr], ['de', de], ['es', es]] as const)('%s holds every editor text', (_lng, bundle) => {
    expect(keys.filter((key) => typeof lookup(bundle, key) !== 'string')).toEqual([]);
  });

  it('shows the toolbar in the reader\'s language, with its values filled in', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'fr', resources: { fr: { common: fr } }, ns: ['common'], defaultNS: 'common', interpolation: { escapeValue: false } });
    const translate = markdownEditorTranslation(instance.t);
    expect(translate('toolbar.bold', 'Bold')).toBe('Gras');
    expect(translate('toolbar.image', 'Insert image')).toBe('Insérer une image');
    expect(translate('toolbar.blockTypes.heading', 'Heading {{level}}', { level: 2 })).toBe('Titre 2');
    expect(translate('toolbar.unknownKey', 'Fallback')).toBe('Fallback');
  });
});
