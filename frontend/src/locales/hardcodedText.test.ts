import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import baseline from './hardcodedText.baseline.json';

// Every user-facing text goes through i18n. This scan finds English left in the JSX of the
// components: text between tags and the attributes a user reads or hears (labels, titles,
// placeholders, aria labels). The baseline lists the files that still hold some, with their
// count: a file may lose hard-coded texts, never gain one, and a file outside it holds none.
const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });

const READ_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'helperText']);
// Names, units and samples that read the same in every language.
const NEUTRAL = new Set(['KANAP', 'SSO', 'MFA', 'URL', 'SVG', 'PNG', 'GLPI', 'Netbox', 'RSS', 'ms', 'EUR', 'EUR, USD, GBP', 'DOC-', '#9BC1FF', 'https://...', 'https://example.com']);
const hasWords = (text: string) => /[A-Za-z]{2,}/.test(text.replace(/&[a-z]+;/gi, '')) && !NEUTRAL.has(text);

function hardcodedTexts(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      const text = node.getText(sf).replace(/\s+/g, ' ').trim();
      if (hasWords(text)) found.push(text);
    } else if (ts.isJsxAttribute(node) && READ_ATTRIBUTES.has(node.name.getText(sf)) && node.initializer) {
      const init = node.initializer;
      const literal = ts.isStringLiteral(init)
        ? init
        : ts.isJsxExpression(init) && init.expression
          && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
          ? init.expression
          : null;
      if (literal && hasWords(literal.text)) found.push(literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('hard-coded texts in components', () => {
  it('adds none beyond the baseline', () => {
    const allowed = baseline as Record<string, number>;
    const offenders = Object.entries(sources).flatMap(([path, source]) => {
      const file = path.replace(/^\.\.\//, '');
      const texts = hardcodedTexts(file, source);
      return texts.length > (allowed[file] ?? 0)
        ? [`${file}: ${texts.length} hard-coded (baseline ${allowed[file] ?? 0}): ${texts.join(' | ')}`]
        : [];
    });
    expect(offenders).toEqual([]);
  });
});
