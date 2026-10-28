import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';

// A module right refusal is written once, through `moduleRightRequired`, so the screen can name the
// missing right (`errors:MODULE_RIGHT_REQUIRED`). This inventory fails when a hand-written
// `new ForbiddenException('...')` or `new ForbiddenException(`...`)` with one of the old sentences
// comes back in the backend sources. It reads files outside its own folder: `backendPath()`, never
// `__dirname` (the compiled tree has no `.ts` file).

const FORBIDDEN_REFUSAL = /new\s+ForbiddenException\(\s*(['`])(You cannot read|You cannot edit|Missing required permission|You need |Platform admin)/g;

/**
 * A hand-written refusal kept on purpose: its condition accepts `budget_ops:admin` or the admin
 * right of the record's own scope (`companies` or `departments`), so no single module right names
 * it. The rest of that file stays under the inventory.
 */
const ALLOWED_REFUSALS = [
  {
    file: 'src/master-data/master-data-access.util.ts',
    prefix: 'You need ',
    reason: 'budget_ops:admin or companies/departments:admin: several possible rights',
  },
];

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
  const root = backendPath('src');
  const failures: string[] = [];
  for (const file of sourceFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(FORBIDDEN_REFUSAL)) {
      const relative = path.relative(backendPath(), file);
      if (ALLOWED_REFUSALS.some((allowed) => allowed.file === relative && allowed.prefix === match[2])) continue;
      failures.push(
        `${relative}:${lineOf(source, match.index ?? 0)}: new ForbiddenException(${match[1]}${match[2]}...) ` +
        'is a module right refusal written by hand. Use moduleRightRequired(resource, level, message) ' +
        'from src/auth/module-right-required.ts so the screen can name the missing right.',
      );
    }
  }
  assert.deepEqual(failures, [], `Hand-written module right refusals found:\n${failures.join('\n')}`);
  console.log('module-refusals.inventory.spec: ok');
}

run();
