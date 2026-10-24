import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';
import {
  DATA_ACCESS_PATHS,
  DATA_ACCESS_PATHS_IGNORED_FILES,
  DataAccessPathSite,
} from '../data-access-paths.inventory';

/**
 * Data-scoped access inventories, lot 1 part (planning/data-scoped-access/spec.md §10.3). Plain
 * file scans, no database:
 * 1. `data_access_apply` is called once, from `data-access/data-access.ts`, and `applyDataAccess`
 *    only from the call points of spec §6.3: a new call site is added here on purpose.
 * 2. Role changes (`SET ROLE`, `RESET ROLE`, `set_config('role'`) appear only in the foundations
 *    migration (inside `data_access_apply`), in `withFullDataAccess` (`data-access/full-data-access.ts`)
 *    and in the data-access specs; `withFullDataAccess` is called from the chargeback report only
 *    (spec §6.6, §10.3 "Divulgations").
 * 3. Every path outside the tenant interceptor (`@SkipTenantTransaction()`, `{ transaction: false }`,
 *    `tenantExecutor.run(`, `withTenantExecution(`, `withTenant(`) is classified in
 *    `data-access/data-access-paths.inventory.ts`, and the inventory names no site that is gone.
 *    Each entry counts its call sites in its member, and a class-level `@SkipTenantTransaction()`
 *    lists the route methods of its class: a second call in a classified member, or a new route in
 *    a classified controller, fails until it is looked at.
 */

const SRC = backendPath('src');

function listFiles(root: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'ci-dist' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (accept(full)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function isTest(rel: string): boolean {
  return rel.split('/').includes('__tests__') || /\.spec\.ts$/.test(rel);
}

/** Source files of `src`, relative to it, without the tests. */
function sourceFiles(): string[] {
  return listFiles(SRC, (f) => f.endsWith('.ts'))
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((rel) => !isTest(rel));
}

/** The text with comment lines blanked (line numbers kept): a mention in a comment is no site. */
function codeOf(text: string): string {
  let inBlock = false;
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      return '';
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      return '';
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
    return line;
  }).join('\n');
}

function count(text: string, pattern: RegExp): number {
  return (text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)) ?? []).length;
}

// ---------------------------------------------------------------------------------------------
// 1. Calls of the function.

/** `applyDataAccess(` calls per file (spec §6.3): the interceptor, the reconnection, runWithContext, the inline attachments. */
const APPLY_CALLS: Record<string, number> = {
  'common/tenant.interceptor.ts': 1,
  'common/import-connection.ts': 1,
  'ai/execution/ai-tenant-execution.service.ts': 1,
  // canAccessInlineAttachment (option applyDataAccess) and the knowledge inline route.
  'knowledge/knowledge.service.ts': 2,
};

/** The inline-attachment routes that ask canAccessInlineAttachment to apply the access. */
const APPLY_OPTION_USERS: Record<string, number> = {
  'spend/tasks.controller.ts': 1,
  'portfolio/services/portfolio-attachments.service.ts': 1,
  'portfolio/portfolio-requests.controller.ts': 1,
};

function testCallsOfTheFunction(): void {
  const sqlCalls: Record<string, number> = {};
  const applyCalls: Record<string, number> = {};
  const optionUsers: Record<string, number> = {};
  for (const rel of sourceFiles()) {
    if (rel.startsWith('migrations/')) continue;
    const code = codeOf(fs.readFileSync(path.join(SRC, rel), 'utf8'));
    const sql = count(code, /\bdata_access_apply\s*\(/);
    if (sql) sqlCalls[rel] = sql;
    const calls = count(code, /\bapplyDataAccess\s*\(/) - count(code, /\bfunction\s+applyDataAccess\s*\(/);
    if (calls) applyCalls[rel] = calls;
    const option = count(code, /\bapplyDataAccess\s*:\s*true\b/);
    if (option) optionUsers[rel] = option;
  }
  assert.deepEqual(sqlCalls, { 'data-access/data-access.ts': 1 }, 'data_access_apply is called from data-access/data-access.ts only');
  assert.deepEqual(applyCalls, APPLY_CALLS, 'applyDataAccess is called from the call points of spec §6.3 only');
  assert.deepEqual(optionUsers, APPLY_OPTION_USERS, 'the inline-attachment routes apply the access');
  console.log('  calls of data_access_apply and applyDataAccess: OK');
}

// ---------------------------------------------------------------------------------------------
// 2. Role changes.

/** `SET [LOCAL|SESSION] ROLE` (not `SET role = ...`, a column), `RESET ROLE`, `set_config('role'`. */
const ROLE_CHANGE = /\bSET\s+(?:LOCAL\s+|SESSION\s+)?ROLE\b(?!\s*=)|\bRESET\s+ROLE\b|\bset_config\s*\(\s*'role'/i;

const ROLE_CHANGE_ALLOWED = new Set([
  // data_access_apply takes the limited role.
  'src/migrations/1854400000000-data-access-foundations.ts',
  // The availability check tries SET LOCAL ROLE in a rolled-back transaction (spec §6.2).
  'src/data-access/data-access-availability.ts',
  // withFullDataAccess leaves the limited role for one read-only window (spec §6.6).
  'src/data-access/full-data-access.ts',
]);

/** `withFullDataAccess(` calls per file, outside its definition: the chargeback report only (spec §6.6). */
const FULL_DATA_ACCESS_CALLS: Record<string, number> = {
  'spend/chargeback-report.service.ts': 1,
};

function testRoleChanges(): void {
  const root = backendPath();
  const files = [
    ...listFiles(backendPath('src'), (f) => /\.(ts|js|sql)$/.test(f)),
    ...listFiles(backendPath('scripts'), (f) => /\.(ts|js|mjs|cjs|sql|sh)$/.test(f)),
  ].map((f) => path.relative(root, f).split(path.sep).join('/'));
  const found = files.filter((rel) => {
    if (rel.startsWith('src/data-access/__tests__/')) return false;
    return ROLE_CHANGE.test(fs.readFileSync(path.join(root, rel), 'utf8'));
  });
  assert.deepEqual(found.sort(), [...ROLE_CHANGE_ALLOWED].sort(), 'role changes only in data_access_apply and withFullDataAccess (and the data-access specs)');

  const calls: Record<string, number> = {};
  for (const rel of sourceFiles()) {
    if (rel.startsWith('migrations/')) continue;
    const code = codeOf(fs.readFileSync(path.join(SRC, rel), 'utf8'));
    const n = count(code, /\bwithFullDataAccess\s*(?:<[^()]*>)?\s*\(/) - count(code, /\bfunction\s+withFullDataAccess\s*(?:<[^()]*>)?\s*\(/);
    if (n) calls[rel] = n;
  }
  assert.deepEqual(calls, FULL_DATA_ACCESS_CALLS, 'withFullDataAccess is called from the chargeback report only');
  console.log('  role changes, withFullDataAccess called from the chargeback report only: OK');
}

// ---------------------------------------------------------------------------------------------
// 3. Paths outside the interceptor.

const MEMBER = /^ {2}(?:(?:public|private|protected|static|readonly|async|override)\s+)*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/;
const TOP_FUNCTION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const TOP_CONST = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/;
const CLASS = /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const NOT_MEMBERS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'super', 'function']);

/** The member (method, function) around a line: the nearest declaration above it. */
function enclosingMember(lines: string[], index: number, rel: string): string {
  for (let i = index; i >= 0; i -= 1) {
    const line = lines[i];
    const member = MEMBER.exec(line);
    if (member && !NOT_MEMBERS.has(member[1])) return member[1];
    const top = TOP_FUNCTION.exec(line) ?? TOP_CONST.exec(line);
    if (top) return top[1];
  }
  throw new Error(`${rel}:${index + 1}: no enclosing member found`);
}

const ROUTE_DECORATOR = /^ {2}@(?:Get|Post|Put|Patch|Delete|All|Head|Options|Sse)\s*\(/;

/** The route methods of the class declared at `classIndex` (up to its closing brace at column 0). */
function routeMethods(lines: string[], classIndex: number, rel: string): string[] {
  const routes: string[] = [];
  for (let i = classIndex + 1; i < lines.length && !/^}/.test(lines[i]); i += 1) {
    if (!ROUTE_DECORATOR.test(lines[i])) continue;
    let j = i + 1;
    for (; j < Math.min(lines.length, i + 12); j += 1) {
      if (/^ {2}@/.test(lines[j])) continue;
      const member = MEMBER.exec(lines[j]);
      if (member && !NOT_MEMBERS.has(member[1])) {
        routes.push(member[1]);
        break;
      }
    }
    if (j >= Math.min(lines.length, i + 12)) throw new Error(`${rel}:${i + 1}: no method found for the route decorator`);
    i = j;
  }
  return routes.sort();
}

/**
 * The target of a `@SkipTenantTransaction()` line: its method, or its class with the class's route
 * methods (class-level decorator).
 */
function decoratedTarget(lines: string[], index: number, rel: string): { member: string; routes?: string[] } {
  for (let i = index + 1; i < Math.min(lines.length, index + 12); i += 1) {
    const cls = CLASS.exec(lines[i]);
    if (cls) return { member: cls[1], routes: routeMethods(lines, i, rel) };
    const member = MEMBER.exec(lines[i]);
    if (member && !NOT_MEMBERS.has(member[1])) return { member: member[1] };
  }
  throw new Error(`${rel}:${index + 1}: no target found for @SkipTenantTransaction()`);
}

type FoundSite = { file: string; member: string; site: DataAccessPathSite; count: number; routes?: string[] };

const SITE_PATTERNS: Array<{ site: DataAccessPathSite; pattern: RegExp }> = [
  { site: 'transaction_false', pattern: /\btransaction\s*:\s*false\b/g },
  { site: 'tenant_executor_run', pattern: /\btenantExecutor\s*\.\s*run\s*\(/g },
  { site: 'with_tenant_execution', pattern: /\bwithTenantExecution\s*\(/g },
  { site: 'with_tenant', pattern: /\bwithTenant\s*\(/g },
];

const key = (s: { file: string; member: string; site: string }) => `${s.file}#${s.member}#${s.site}`;

function scanPaths(): FoundSite[] {
  const found = new Map<string, FoundSite>();
  const add = (site: Omit<FoundSite, 'count'>) => {
    const existing = found.get(key(site));
    if (existing) existing.count += 1;
    else found.set(key(site), { ...site, count: 1 });
  };
  for (const rel of sourceFiles()) {
    if (rel in DATA_ACCESS_PATHS_IGNORED_FILES) continue;
    const code = codeOf(fs.readFileSync(path.join(SRC, rel), 'utf8'));
    const lines = code.split('\n');
    lines.forEach((line, index) => {
      if (/@SkipTenantTransaction\s*\(\s*\)/.test(line)) {
        add({ file: rel, ...decoratedTarget(lines, index, rel), site: 'skip_tenant_transaction' });
      }
    });
    for (const { site, pattern } of SITE_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const before = code.slice(0, match.index ?? 0);
        if (/\bfunction\s*$/.test(before)) continue;
        const index = before.split('\n').length - 1;
        add({ file: rel, member: enclosingMember(lines, index, rel), site });
      }
    }
  }
  return [...found.values()];
}

function testPathsInventory(): void {
  const found = new Map(scanPaths().map((site) => [key(site), site]));
  const listed = new Map<string, (typeof DATA_ACCESS_PATHS)[number]>();
  for (const entry of DATA_ACCESS_PATHS) {
    const k = key(entry);
    assert.ok(!listed.has(k), `listed twice: ${k}`);
    listed.set(k, entry);
    assert.ok(entry.reason.trim().length > 0, `${k}: a reason is required`);
  }
  for (const rel of Object.keys(DATA_ACCESS_PATHS_IGNORED_FILES)) {
    assert.ok(fs.existsSync(path.join(SRC, rel)), `ignored file is gone: ${rel}`);
  }
  const missing = [...found.keys()].filter((k) => !listed.has(k)).sort();
  const stale = [...listed.keys()].filter((k) => !found.has(k)).sort();
  assert.deepEqual(missing, [], `sites to classify in data-access/data-access-paths.inventory.ts:\n${missing.join('\n')}`);
  assert.deepEqual(stale, [], `inventory entries with no site in the code:\n${stale.join('\n')}`);

  // Same number of call sites per member, same route methods per classified controller.
  const changed: string[] = [];
  for (const [k, site] of found) {
    const entry = listed.get(k)!;
    const expected = entry.count ?? 1;
    if (site.count !== expected) changed.push(`${k}: ${site.count} call sites in the code, ${expected} listed`);
    const routes = site.routes ?? [];
    const listedRoutes = [...(entry.routes ?? [])].sort();
    if (routes.join(',') !== listedRoutes.join(',')) {
      changed.push(`${k}: routes in the code [${routes.join(', ')}], listed [${listedRoutes.join(', ')}]`);
    }
  }
  assert.deepEqual(changed, [], `sites changed since they were classified (look at them, then update the count or the routes):\n${changed.join('\n')}`);
  const calls = [...found.values()].reduce((sum, site) => sum + site.count, 0);
  console.log(`  paths outside the interceptor: ${found.size} sites (${calls} calls) classified: OK`);
}

function main(): void {
  testCallsOfTheFunction();
  testRoleChanges();
  testPathsInventory();
  console.log('data-access-inventory.spec: all passed');
}

main();
