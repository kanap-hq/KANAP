import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';
import {
  DATA_ACCESS_LINK_WRITES,
  DATA_ACCESS_WRITE_ROOTS,
  DATA_ACCESS_WRITES,
  DataAccessWriteEntry,
} from '../data-access-writes.inventory';

/**
 * Data-scoped access, lot 3: the inventory of the writes on budget lines, their children, their
 * tasks and the links to them (`data-access/data-access-writes.inventory.ts`, spec §6.7). Plain
 * file scan, no database:
 * 1. every write site under `spend/` and `tasks/` is listed, per member, with its count; a new
 *    site, a new member or a changed count fails until it is classified, and an entry with no site
 *    in the code fails too;
 * 2. the link writes listed outside those folders still exist with the same count.
 */

const SRC = backendPath('src');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out.sort();
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

const MEMBER = /^ {2}(?:(?:public|private|protected|static|readonly|async|override)\s+)*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/;
const TOP_FUNCTION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const TOP_CONST = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/;
const NOT_MEMBERS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'super', 'function']);

/** The method or function around line `index`: the last head above it. */
function memberAt(lines: string[], index: number): string {
  for (let i = index; i >= 0; i -= 1) {
    const member = MEMBER.exec(lines[i]);
    if (member && !NOT_MEMBERS.has(member[1])) return member[1];
    const top = TOP_FUNCTION.exec(lines[i]) ?? TOP_CONST.exec(lines[i]);
    if (top) return top[1];
  }
  return '?';
}

/** A TypeORM write call, or a raw INSERT, UPDATE or DELETE. */
const WRITE = /(?<![\w$])(?:[A-Za-z_$][\w$]*\s*\)?\s*)\.(save|update|delete|remove|insert|upsert|softDelete)\s*\(|\b(INSERT\s+INTO|UPDATE\s+[a-z_${}]+\s+SET|UPDATE\s+[a-z_${}.]+\s*$|DELETE\s+FROM)\b/gm;
/** Receivers that are collections, never a repository: `ids.delete(`, `seen.add(`... */
const NOT_A_REPOSITORY = /^(requested|seen|ids|map|set|keys|pending|cache|byId|wanted|remaining|names|visited|out|result|found|missing|existing[A-Z]\w*Ids|[a-z]\w*(Set|Map|Ids|Keys))$/;

const key = (file: string, member: string) => `${file}#${member}`;

function scanFile(rel: string, into: Map<string, number>): void {
  const lines = codeOf(fs.readFileSync(path.join(SRC, rel), 'utf8')).split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(WRITE)) {
      const head = line.slice(0, (match.index ?? 0) + match[0].length);
      const receiver = /([A-Za-z_$][\w$.]*)\s*\)?\s*\.(save|update|delete|remove|insert|upsert|softDelete)\s*\($/.exec(head)?.[1];
      if (receiver && NOT_A_REPOSITORY.test(receiver.split('.').pop() ?? '')) continue;
      const k = key(rel, memberAt(lines, index));
      into.set(k, (into.get(k) ?? 0) + 1);
    }
  });
}

function checkEntries(entries: DataAccessWriteEntry[], listed: Map<string, DataAccessWriteEntry>): void {
  for (const entry of entries) {
    const k = key(entry.file, entry.member);
    assert.ok(!listed.has(k), `listed twice: ${k}`);
    listed.set(k, entry);
    assert.ok(entry.reason.trim().length > 0, `${k}: a reason is required`);
    assert.ok(entry.count > 0, `${k}: a count is required`);
  }
}

function testRoots(): void {
  const found = new Map<string, number>();
  for (const root of DATA_ACCESS_WRITE_ROOTS) {
    for (const file of listFiles(path.join(SRC, root))) scanFile(path.relative(SRC, file).split(path.sep).join('/'), found);
  }
  const listed = new Map<string, DataAccessWriteEntry>();
  checkEntries(DATA_ACCESS_WRITES, listed);
  for (const entry of DATA_ACCESS_WRITES) {
    assert.ok(DATA_ACCESS_WRITE_ROOTS.some((root) => entry.file.startsWith(`${root}/`)), `${entry.file}: outside the scanned folders, list it with the link writes`);
  }
  const missing = [...found.keys()].filter((k) => !listed.has(k)).sort();
  const stale = [...listed.keys()].filter((k) => !found.has(k)).sort();
  assert.deepEqual(missing, [], `write sites to classify in data-access/data-access-writes.inventory.ts:\n${missing.join('\n')}`);
  assert.deepEqual(stale, [], `inventory entries with no write site in the code:\n${stale.join('\n')}`);
  const changed = [...found].filter(([k, count]) => listed.get(k)!.count !== count)
    .map(([k, count]) => `${k}: ${count} sites in the code, ${listed.get(k)!.count} listed`);
  assert.deepEqual(changed, [], `write sites changed since they were classified (look at them, then update the count):\n${changed.join('\n')}`);
  const sites = [...found.values()].reduce((sum, n) => sum + n, 0);
  const byHandling = new Map<string, number>();
  for (const entry of DATA_ACCESS_WRITES) byHandling.set(entry.handling, (byHandling.get(entry.handling) ?? 0) + entry.count);
  const summary = [...byHandling].sort().map(([h, n]) => `${h} ${n}`).join(', ');
  console.log(`  writes under ${DATA_ACCESS_WRITE_ROOTS.join(', ')}: ${found.size} members, ${sites} sites classified (${summary}): OK`);
}

function testLinkWrites(): void {
  const listed = new Map<string, DataAccessWriteEntry>();
  checkEntries(DATA_ACCESS_LINK_WRITES, listed);
  const found = new Map<string, number>();
  for (const file of new Set(DATA_ACCESS_LINK_WRITES.map((entry) => entry.file))) {
    assert.ok(DATA_ACCESS_WRITE_ROOTS.every((root) => !file.startsWith(`${root}/`)), `${file}: under a scanned folder, list it with the writes`);
    assert.ok(fs.existsSync(path.join(SRC, file)), `file is gone: ${file}`);
    scanFile(file, found);
  }
  const changed = [...listed].filter(([k, entry]) => found.get(k) !== entry.count)
    .map(([k, entry]) => `${k}: ${found.get(k) ?? 0} sites in the code, ${entry.count} listed`);
  assert.deepEqual(changed, [], `link writes changed since they were classified:\n${changed.join('\n')}`);
  console.log(`  link writes from the other object's side: ${listed.size} members classified: OK`);
}

function main(): void {
  testRoots();
  testLinkWrites();
  console.log('data-access-writes-inventory.spec: all passed');
}

main();
