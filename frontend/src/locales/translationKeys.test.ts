import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A call `t('portfolio:some.key', 'English default')` whose key is missing from the locale files
// shows its English default in every language. This scan resolves every `t()` call that names its
// namespace with a literal key, as i18next does: the named namespace, then `common` (fallbackNS),
// and a plural key through its `_one` / `_other` forms.
const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../**/*.d.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const bundles = import.meta.glob<Record<string, unknown>>('./*/*.json', { import: 'default', eager: true });
const LANGUAGES = ['en', 'fr', 'de', 'es'];

function has(lng: string, ns: string, key: string): boolean {
  const parts = key.split('.');
  const last = parts.pop() as string;
  const parent = parts.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], bundles[`./${lng}/${ns}.json`]);
  if (!parent || typeof parent !== 'object') return false;
  const node = parent as Record<string, unknown>;
  return typeof node[last] === 'string' || typeof node[`${last}_other`] === 'string';
}

function namespacedKeys(file: string, source: string): { line: number; ns: string; key: string }[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { line: number; ns: string; key: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      const first = node.arguments[0];
      if (name === 't' && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        const match = /^([a-z-]+):([\w.-]+)$/.exec(first.text);
        if (match && `./en/${match[1]}.json` in bundles) {
          found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, ns: match[1], key: match[2] });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('translation keys named in the code', () => {
  it('exist in every language', () => {
    const offenders = Object.entries(sources).flatMap(([path, source]) => {
      const file = path.replace(/^\.\.\//, '');
      return namespacedKeys(file, source).flatMap(({ line, ns, key }) => {
        const missing = LANGUAGES.filter((lng) => !has(lng, ns, key) && !has(lng, 'common', key));
        return missing.length ? [`${file}:${line} ${ns}:${key} (${missing.join(', ')})`] : [];
      });
    });
    expect(offenders).toEqual([]);
  });
});
