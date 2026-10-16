import { describe, expect, it } from 'vitest';

// Prose rule (AGENTS.md): no em dash, no en dash and no " -- " used as a dash, in the UI texts
// and in the user manual. Use a colon, a period or parentheses.
const DASH = /—|–| -- /;

// Allowed exceptions, each with its reason. Keep this list short and explicit.
// The empty-value glyph: the app shows "—" alone in a cell or field that has no value.
const EMPTY_VALUE = '—';
// The manual names that glyph, in bold, where it explains what an empty value means.
const EMPTY_VALUE_IN_MANUAL = '**—**';
// Numeric ranges ("0–7 d", "5–120 seconds"): an en dash between two digits marks a range.
const NUMERIC_RANGE = /(?<=\d)–(?=\d)/g;

const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;

const localeFiles = import.meta.glob<{ default: Record<string, unknown> }>('./{en,fr,de,es}/*.json', { eager: true });

function strings(tree: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof tree === 'string') return [[path.join('.'), tree]];
  if (!tree || typeof tree !== 'object') return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => strings(value, [...path, key]));
}

function hasDash(text: string): boolean {
  return DASH.test(text.replace(NUMERIC_RANGE, ''));
}

// The manual, read at run time from the repository root: the frontend image holds no doc file,
// so nothing here may import one. A checkout without the manual skips that check.
type NodeFs = {
  existsSync(path: URL): boolean;
  readdirSync(path: URL, options: { recursive: true }): string[];
  readFileSync(path: URL, encoding: 'utf8'): string;
};
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): NodeFs } }).process.getBuiltinModule('node:fs');
// Through a variable: Vite rewrites `new URL('…', import.meta.url)` into an asset URL.
const TEST_FILE = import.meta.url;
const MANUAL = new URL('../../../doc/help/docs/', TEST_FILE);
const manualFound = fs.existsSync(MANUAL);
if (!manualFound) console.warn(`Skipping the manual dash check: ${MANUAL.pathname} is missing.`);

// Code may hold dashes (`--dry-run`, `git diff -- FILE`, a sample output): drop fenced blocks
// and inline code before checking a page.
function prose(markdown: string): string[] {
  let fence: string | null = null;
  return markdown.split('\n').map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return '';
    }
    if (marker) {
      fence = marker;
      return '';
    }
    return line.replace(/(`+)[^`]*?\1/g, '');
  });
}

describe('no dashes', () => {
  it('in the locale texts', () => {
    const offenders = Object.entries(localeFiles).flatMap(([file, module]) =>
      strings(module.default)
        .filter(([, text]) => text !== EMPTY_VALUE && hasDash(text))
        .map(([key, text]) => `${file} ${key}: ${text}`),
    );
    expect(Object.keys(localeFiles).length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it.skipIf(!manualFound)('in the user manual, outside code', () => {
    const offenders: string[] = [];
    let pages = 0;
    for (const language of LANGUAGES) {
      const root = new URL(`${language}/`, MANUAL);
      for (const page of fs.readdirSync(root, { recursive: true }).filter((name) => name.endsWith('.md'))) {
        pages += 1;
        prose(fs.readFileSync(new URL(page, root), 'utf8')).forEach((line, index) => {
          if (hasDash(line.split(EMPTY_VALUE_IN_MANUAL).join(''))) {
            offenders.push(`${language}/${page}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(pages).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
