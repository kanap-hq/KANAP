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
// It reads files outside its own folder: `backendPath()`, never `__dirname` (the compiled tree
// has no `.ts` file).

const BARE_FORBIDDEN = /new\s+ForbiddenException\(\s*(?:['"`]|\)|[A-Za-z_$][\w$]*\s*[,)])/g;
const BARE_HTTP_EXCEPTION = /new\s+HttpException\(\s*(?:['"`]|[A-Za-z_$][\w$]*\s*,)[^;]*?,\s*(?:403|HttpStatus\.FORBIDDEN)\s*\)/g;
const OBJECT_FORBIDDEN = /new\s+ForbiddenException\(\s*\{/g;
const CODE_KEY = /(?:^|[{,\s])code\s*[:,}]|(?:^|[{,\s])error\s*:(?!\s*['"`]Forbidden['"`])/;

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

function run(): void {
  const failures: string[] = [];
  for (const file of sourceFiles(backendPath('src'))) {
    const relative = path.relative(backendPath(), file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    const hits = [...source.matchAll(BARE_FORBIDDEN), ...source.matchAll(BARE_HTTP_EXCEPTION)].map((match) => match.index ?? 0);
    for (const match of source.matchAll(OBJECT_FORBIDDEN)) {
      const index = match.index ?? 0;
      if (!CODE_KEY.test(objectAt(source, index + match[0].length - 1))) hits.push(index);
    }
    for (const index of hits) {
      failures.push(
        `${relative}:${lineOf(source, index)}: a 403 with no code. Use codedForbidden(code, message, params?) ` +
        'or moduleRightRequired(...) from src/auth/module-right-required.ts, and add errors:<code> to the four locales.',
      );
    }
  }
  assert.deepEqual(failures, [], `403 refusals with no code found:\n${failures.join('\n')}`);
  console.log('coded-forbidden.inventory.spec: ok');
}

run();
