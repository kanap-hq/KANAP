import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from './backend-root';

// Markdown parsing and HTML conversion run only in the Markdown workers
// (common/markdown-worker.ts). The modules that do it, and the libraries they use,
// are loaded by the worker thread only: any other module of the API goes through
// the asynchronous functions of markdown-worker.ts. Type-only imports are allowed.

const SRC = backendPath('src');

/** Modules that run in the worker thread (paths from src/, without extension). */
const WORKER_MODULES = new Set([
  'common/markdown-worker.thread',
  'common/html-to-markdown',
  'common/markdown-rich-text',
  'common/markdown-search-text',
  'common/markdown-to-html',
  'common/document-import-markdown',
  'knowledge/integrated-document-markdown',
]);

const WORKER_LIBRARIES = new Set(['marked', 'turndown']);

/**
 * Modules that run before the API serves, where a long conversion holds no
 * request: database migrations, and the code only they call.
 */
const BEFORE_SERVING = [
  /^migrations\//,
  /^knowledge\/incident-review-provisioning$/,
];

const IMPORT_PATTERNS = [
  /^\s*import\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
  /^\s*export\s+(type\s+)?[^'";]*?\s+from\s+['"]([^'"]+)['"]/gm,
  /^\s*import\s+()\w+\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gm,
  /()(?:\brequire|\bimport)\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') files.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function moduleId(file: string): string {
  return path.relative(SRC, file).replace(/\\/g, '/').replace(/\.ts$/, '');
}

function valueImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const targets: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (match[1]) continue; // `import type` / `export type`
      const specifier = match[2];
      if (specifier.startsWith('.')) {
        targets.push(moduleId(path.resolve(path.dirname(file), specifier)));
      } else {
        targets.push(specifier.split('/')[0]);
      }
    }
  }
  return targets;
}

function testOnlyWorkerModulesLoadTheParser() {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 100, 'source files found');
  const offenders: string[] = [];
  for (const file of files) {
    const id = moduleId(file);
    if (WORKER_MODULES.has(id) || BEFORE_SERVING.some((pattern) => pattern.test(id))) continue;
    for (const target of valueImports(file)) {
      if (WORKER_MODULES.has(target) || WORKER_LIBRARIES.has(target)) offenders.push(`${id} -> ${target}`);
    }
  }
  assert.deepEqual(offenders, [], `modules of the main thread loading the parser:\n${offenders.join('\n')}`);
}

function testTheWorkerModulesExist() {
  for (const id of WORKER_MODULES) {
    assert.ok(fs.existsSync(path.join(SRC, `${id}.ts`)), `${id}.ts exists`);
  }
  // The check sees the imports it must refuse.
  const thread = valueImports(path.join(SRC, 'common', 'markdown-worker.thread.ts'));
  assert.ok(thread.includes('marked') && thread.includes('common/html-to-markdown'));
  const api = valueImports(path.join(SRC, 'common', 'markdown-worker.ts'));
  assert.ok(!api.some((target) => WORKER_MODULES.has(target)), 'the worker API loads no worker module');
}

testOnlyWorkerModulesLoadTheParser();
testTheWorkerModulesExist();
