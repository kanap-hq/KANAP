import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from './backend-root';

// A 403 carries a translatable `code` (and `params` when it names a right, a family or a module),
// so the screen shows it in the language of the person (`errors:<code>`). This inventory fails
// when a refusal leaves without a code:
//   - `new ForbiddenException('...')`, a template or a constant (`new ForbiddenException(MESSAGE)`);
//   - `new ForbiddenException()` with no body;
//   - `new ForbiddenException({ ... })` whose object names no `code` (an `error` other than
//     'Forbidden' counts: the screen reads it as the code);
//   - `new HttpException('...', 403)` or `HttpStatus.FORBIDDEN` with a bare sentence.
// Write it through `codedForbidden(code, message, params?)`, `moduleRightRequired(...)` or one of
// the helpers of `src/auth/module-right-required.ts`, or with an object holding a `code`.
// It then collects the literal codes of `codedForbidden(` and of that object (a `code` property,
// or an `error` other than 'Forbidden' when there is no `code`) and fails when one of them has no
// message in `frontend/src/locales/{en,fr,de,es}/errors.json`, naming the code and the language.
// A first argument of `codedForbidden(` that is not a string literal fails too, so the check
// cannot be skipped by passing a variable. A ternary in an object still counts: each branch that
// is a string literal is a code.
// It reads files outside its own folder: `backendPath()`, never `__dirname` (the compiled tree
// has no `.ts` file).

const BARE_FORBIDDEN = /new\s+ForbiddenException\(\s*(?:['"`]|\)|[A-Za-z_$][\w$]*\s*[,)])/g;
const BARE_HTTP_EXCEPTION = /new\s+HttpException\(\s*(?:['"`]|[A-Za-z_$][\w$]*\s*,)[^;]*?,\s*(?:403|HttpStatus\.FORBIDDEN)\s*\)/g;
const OBJECT_FORBIDDEN = /new\s+ForbiddenException\(\s*\{/g;
const CODE_KEY = /(?:^|[{,\s])code\s*[:,}]|(?:^|[{,\s])error\s*:(?!\s*['"`]Forbidden['"`])/;
const CODED_FORBIDDEN_CALL = /codedForbidden\s*\(/g;
const ERROR_LOCALES = ['en', 'fr', 'de', 'es'] as const;

/** The object literal that opens at `open` (a `{`), braces balanced, strings skipped. */
function objectAt(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function skipSpace(source: string, index: number): number {
  let i = index;
  while (i < source.length && (source[i] === ' ' || source[i] === '\n' || source[i] === '\r' || source[i] === '\t')) i += 1;
  return i;
}

/** A quote-delimited literal starting at `start`, or null when it is not one (an interpolation counts as none). */
function readStringLiteral(source: string, start: number): { value: string; end: number } | null {
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') {
      const next = source[i + 1];
      if (next === undefined) return null;
      value += next;
      i += 1;
      continue;
    }
    if (quote === '`' && char === '$' && source[i + 1] === '{') return null;
    if (char === quote) return { value, end: i + 1 };
    if (char === '\n' && quote !== '`') return null;
    value += char;
  }
  return null;
}

/**
 * The string literals a code expression resolves to. A plain literal is itself. A ternary
 * contributes the literals of its two branches, not of its condition (`condition ? 'A' : 'B'`).
 * Anything else (a variable, a call) contributes none.
 */
function expressionCodes(expression: string): string[] {
  const text = expression.trim();
  if (!text) return [];
  const literal = readStringLiteral(text, 0);
  if (literal && literal.end === text.length) return [literal.value];
  const branches = splitTernary(text);
  if (!branches) return [];
  return [...expressionCodes(branches[0]), ...expressionCodes(branches[1])];
}

/** The two branches of a top-level ternary, or null. `?.` and `??` are not a ternary. */
function splitTernary(text: string): [string, string] | null {
  let depth = 0;
  let quote: string | null = null;
  let question = -1;
  let pending = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (char === '?' && text[i + 1] !== '.' && text[i + 1] !== '?') {
      if (question < 0) question = i;
      pending += 1;
      continue;
    }
    if (char === ':' && question >= 0) {
      pending -= 1;
      if (pending === 0) return [text.slice(question + 1, i), text.slice(i + 1)];
    }
  }
  return null;
}

/** The value of a top-level `name` property, or null when the object does not name it. A shorthand is its name. */
function topLevelProperty(objectText: string, name: string): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < objectText.length; i += 1) {
    const char = objectText[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      continue;
    }
    if (depth !== 1 || !objectText.startsWith(name, i)) continue;
    let separator = i - 1;
    while (separator >= 0 && /\s/.test(objectText[separator])) separator -= 1;
    if (separator < 0 || (objectText[separator] !== '{' && objectText[separator] !== ',')) continue;
    const after = skipSpace(objectText, i + name.length);
    const next = objectText[after];
    if (next !== ':' && next !== ',' && next !== '}') continue;
    if (next !== ':') return name;
    const valueStart = skipSpace(objectText, after + 1);
    let nested = 0;
    let valueQuote: string | null = null;
    for (let j = valueStart; j < objectText.length; j += 1) {
      const valueChar = objectText[j];
      if (valueQuote) {
        if (valueChar === '\\') j += 1;
        else if (valueChar === valueQuote) valueQuote = null;
        continue;
      }
      if (valueChar === "'" || valueChar === '"' || valueChar === '`') {
        valueQuote = valueChar;
        continue;
      }
      if (valueChar === '{' || valueChar === '(' || valueChar === '[') nested += 1;
      else if (valueChar === '}' || valueChar === ')' || valueChar === ']') {
        if (nested === 0) return objectText.slice(valueStart, j);
        nested -= 1;
      } else if (valueChar === ',' && nested === 0) {
        return objectText.slice(valueStart, j);
      }
    }
    return objectText.slice(valueStart);
  }
  return null;
}

/**
 * Literal codes of a `new ForbiddenException({ ... })` body. `code` wins over `error`, as the
 * screen does. `error: 'Forbidden'` is Nest's generic name, not a translatable code.
 */
function literalCodes(objectText: string): string[] {
  const code = topLevelProperty(objectText, 'code');
  if (code !== null) return expressionCodes(code);
  const error = topLevelProperty(objectText, 'error');
  if (error === null) return [];
  return expressionCodes(error).filter((value) => value !== 'Forbidden');
}

/** Calls of `codedForbidden(`. The declaration is skipped. `code` is null when the first argument is not a string literal. */
function codedForbiddenCalls(source: string): Array<{ index: number; code: string | null }> {
  const calls: Array<{ index: number; code: string | null }> = [];
  for (const match of source.matchAll(CODED_FORBIDDEN_CALL)) {
    const index = match.index ?? 0;
    if (/function\s*$/.test(source.slice(Math.max(0, index - 16), index))) continue;
    const argStart = skipSpace(source, index + match[0].length);
    const literal = readStringLiteral(source, argStart);
    if (!literal) {
      calls.push({ index, code: null });
      continue;
    }
    const next = source[skipSpace(source, literal.end)];
    calls.push({ index, code: next === ',' || next === ')' ? literal.value : null });
  }
  return calls;
}

function errorCatalog(lang: string): Record<string, unknown> {
  const text = fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', lang, 'errors.json'), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

function run(): void {
  const failures: string[] = [];
  const codes = new Map<string, string>();
  const messageFailures: string[] = [];
  const remember = (code: string, where: string) => {
    if (!codes.has(code)) codes.set(code, where);
  };
  for (const file of sourceFiles(backendPath('src'))) {
    const relative = path.relative(backendPath(), file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    const hits = [...source.matchAll(BARE_FORBIDDEN), ...source.matchAll(BARE_HTTP_EXCEPTION)].map((match) => match.index ?? 0);
    for (const match of source.matchAll(OBJECT_FORBIDDEN)) {
      const index = match.index ?? 0;
      const objectText = objectAt(source, index + match[0].length - 1);
      if (!CODE_KEY.test(objectText)) hits.push(index);
      const where = `${relative}:${lineOf(source, index)}`;
      for (const code of literalCodes(objectText)) remember(code, where);
    }
    for (const call of codedForbiddenCalls(source)) {
      const where = `${relative}:${lineOf(source, call.index)}`;
      if (call.code === null) {
        messageFailures.push(
          `${where}: codedForbidden() first argument is not a string literal. ` +
          'Write the code in quotes so it can be checked against the four errors.json files.',
        );
      } else {
        remember(call.code, where);
      }
    }
    for (const index of hits) {
      failures.push(
        `${relative}:${lineOf(source, index)}: a 403 with no code. Use codedForbidden(code, message, params?) ` +
        'or moduleRightRequired(...) from src/auth/module-right-required.ts, and add errors:<code> to the four locales.',
      );
    }
  }
  assert.deepEqual(failures, [], `403 refusals with no code found:\n${failures.join('\n')}`);

  const catalogs = new Map(ERROR_LOCALES.map((lang) => [lang, errorCatalog(lang)]));
  for (const [code, where] of codes) {
    for (const lang of ERROR_LOCALES) {
      if (typeof catalogs.get(lang)?.[code] !== 'string') {
        messageFailures.push(`${lang}: errors.json has no message for ${code} (${where})`);
      }
    }
  }
  assert.deepEqual(messageFailures, [], `coded 403 messages:\n${messageFailures.join('\n')}`);
  console.log(`coded-forbidden.inventory.spec: ok (${codes.size} codes)`);
}

run();
