import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import baseline from './hardcodedText.baseline.json';

// Every user-facing text goes through i18n. This scan finds English left in the components: text
// between tags, the attributes a user reads or hears (labels, titles, placeholders, aria labels,
// and any prop named like one, such as `saveLabel` or `nameHeader`), the literal branches of a
// condition or fallback given to them, the default values of such props, the same names in object
// literals (`'aria-label': ...`, `title: ...`, `label: ...`) and grid column headers. The
// baseline lists the files that still hold some, with their count: a file may lose hard-coded
// texts, never gain one, and a file outside it holds none.
const sources = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });

const READ_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'helperText']);
// Names, units and samples that read the same in every language.
const NEUTRAL = new Set(['KANAP', 'SSO', 'MFA', 'URL', 'SVG', 'PNG', 'GLPI', 'Netbox', 'RSS', 'ms', 'EUR', 'EUR, USD, GBP', 'DOC-', '#9BC1FF', 'https://...', 'https://example.com', 'RTO', 'RPO', 'Logo', 'PDF', 'DOCX', 'ODT']);
const hasWords = (text: string) => /[A-Za-z]{2,}/.test(text.replace(/&[a-z]+;/gi, '')) && !NEUTRAL.has(text)
  && !/^#[0-9a-f]{3,8}$/i.test(text);
// A prop named like a read attribute: `saveLabel`, `emptyLabel`, `nameHeader`, `ariaLabel`...
const READ_PROP = /^(aria-label|ariaLabel|label|title|placeholder|helperText|alt|tooltip|[A-Za-z]+(Label|Title|Placeholder|Header|Tooltip))$/;
// In an object literal these names hold a text for the user, `label` included: option lists and
// status maps take their names from the locale files, not from an English fallback.
const READ_PROPERTY = new Set(['aria-label', 'ariaLabel', 'title', 'tooltip', 'placeholder', 'helperText', 'label']);
// A key, an id or a file name ('title', 'task-description', 'origin.customerId') is no text.
const isIdentifier = (text: string) => /^[a-z][A-Za-z0-9_.-]*$/.test(text);
const literalText = (node: ts.Node | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
// The literal texts an expression can evaluate to through conditions and fallbacks.
function branchTexts(node: ts.Expression): string[] {
  if (ts.isParenthesizedExpression(node)) return branchTexts(node.expression);
  if (ts.isConditionalExpression(node)) return [...branchTexts(node.whenTrue), ...branchTexts(node.whenFalse)];
  if (ts.isBinaryExpression(node)
    && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    return [...branchTexts(node.left), ...branchTexts(node.right)];
  }
  const text = literalText(node);
  return text !== null ? [text] : [];
}

function hardcodedTexts(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      const text = node.getText(sf).replace(/\s+/g, ' ').trim();
      if (hasWords(text)) found.push(text);
    } else if (ts.isJsxAttribute(node) && READ_PROP.test(node.name.getText(sf)) && node.initializer) {
      const init = node.initializer;
      const standard = READ_ATTRIBUTES.has(node.name.getText(sf));
      if (ts.isStringLiteral(init)) {
        if (hasWords(init.text) && (standard || !isIdentifier(init.text))) found.push(init.text);
      } else if (ts.isJsxExpression(init) && init.expression) {
        const direct = literalText(init.expression);
        if (direct !== null) {
          if (hasWords(direct) && (standard || !isIdentifier(direct))) found.push(direct);
        } else {
          found.push(...branchTexts(init.expression).filter((text) => hasWords(text) && !isIdentifier(text)));
        }
      }
    } else if (ts.isBindingElement(node) && node.initializer && READ_PROP.test((node.propertyName ?? node.name).getText(sf))) {
      const text = literalText(node.initializer);
      if (text !== null && hasWords(text) && !isIdentifier(text)) found.push(text);
    } else if (ts.isPropertyAssignment(node) && READ_PROPERTY.has(node.name.getText(sf).replace(/^['"]|['"]$/g, ''))) {
      found.push(...branchTexts(node.initializer).filter((text) => hasWords(text) && !isIdentifier(text)));
    } else if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'headerName'
      && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
      && hasWords(node.initializer.text)) {
      found.push(node.initializer.text);
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

  // A picker with a hidden label still needs its field's name: without `label` it falls back to a
  // generic one ("Company", "Cost center") that may not be the field's ("Parent group").
  it('names every picker whose label is hidden', () => {
    const NO_LABEL_PROP = new Set(['RelatedObjectSelect']);
    const offenders = Object.entries(sources).flatMap(([path, source]) => {
      const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const found: string[] = [];
      const visit = (node: ts.Node) => {
        if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && !NO_LABEL_PROP.has(node.tagName.getText(sf))) {
          const names = node.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText(sf));
          if (names.includes('hideLabel') && !names.includes('label')) {
            found.push(`${path.replace(/^\.\.\//, '')}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${node.tagName.getText(sf)}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return found;
    });
    expect(offenders).toEqual([]);
  });

  // A text that trails off ("Loading...") is written with the ellipsis character in the locale
  // files. Three dots at the end of a string in component code is a text that skipped i18n.
  it('ends no string with three dots', () => {
    const offenders = Object.entries(sources).flatMap(([path, source]) => {
      const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const found: string[] = [];
      const visit = (node: ts.Node) => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || node.kind === ts.SyntaxKind.JsxText)
          && /[A-Za-z]\.\.\.\s*$/.test(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : node.getText(sf))) {
          found.push(`${path.replace(/^\.\.\//, '')}: ${node.getText(sf).trim()}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return found;
    });
    expect(offenders).toEqual([]);
  });
});
