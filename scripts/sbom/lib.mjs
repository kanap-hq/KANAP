// Shared by generate.mjs and check-licenses.mjs: the production packages of a package-lock.json
// (lockfile version 2 or later) and the license rules. No dependency, no network.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FOLDERS = ['backend', 'frontend', 'marketing/web'];
export const DEFAULT_EXCEPTIONS = path.join(ROOT, 'scripts', 'sbom', 'license-exceptions.json');

export class InputError extends Error {}

export function readJsonFile(file) {
  if (!existsSync(file)) throw new InputError(`missing file: ${file}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new InputError(`cannot read ${file}: ${err.message}`);
  }
}

// A folder (holding package-lock.json) or a lockfile path, resolved from `base`.
export function lockfilePath(target, base = ROOT) {
  const full = path.resolve(base, target);
  return full.endsWith('.json') ? full : path.join(full, 'package-lock.json');
}

const NODE_MODULES = 'node_modules/';

// The packages `npm ci --omit=dev` installs: every entry under node_modules/ except the
// dev-only ones and links to local folders. Optional packages for other platforms are kept:
// they are part of what a production install may fetch. One package per name and version,
// at the first path the lockfile lists for it.
export function productionPackages(lock, source = 'package-lock.json') {
  if (!lock || typeof lock.packages !== 'object' || lock.packages === null) {
    throw new InputError(`${source}: no "packages" map (lockfile version 2 or later is required)`);
  }
  const byId = new Map();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.includes(NODE_MODULES) || !entry || entry.dev || entry.link) continue;
    const name = entry.name ?? key.slice(key.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
    if (typeof entry.version !== 'string' || entry.version === '') {
      throw new InputError(`${source}: ${key} has no version`);
    }
    const id = `${name}@${entry.version}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      name,
      version: entry.version,
      license: entry.license,
      path: key,
      resolved: typeof entry.resolved === 'string' ? entry.resolved : null,
      integrity: typeof entry.integrity === 'string' ? entry.integrity : null,
    });
  }
  return [...byId.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

// The written exceptions: { "exceptions": [{ name, version, license, reason }] }. The license is
// the one the package declares (read from its own files when the lockfile has none); the reason
// says why the package is accepted.
export function loadExceptions(file = DEFAULT_EXCEPTIONS) {
  const data = readJsonFile(file);
  if (!data || !Array.isArray(data.exceptions)) throw new InputError(`${file}: an "exceptions" array is required`);
  const byId = new Map();
  data.exceptions.forEach((entry, index) => {
    for (const field of ['name', 'version', 'license', 'reason']) {
      if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') {
        throw new InputError(`${file}: exception ${index + 1} needs a non-empty "${field}"`);
      }
    }
    const id = `${entry.name}@${entry.version}`;
    if (byId.has(id)) throw new InputError(`${file}: ${id} is listed twice`);
    byId.set(id, { id, name: entry.name, version: entry.version, license: entry.license, reason: entry.reason });
  });
  return byId;
}

// Refused license families: GPL, AGPL, SSPL, and UNLICENSED (no license granted). LGPL and MPL
// (copyleft limited to the library or the file) and every other SPDX identifier are accepted.
// A custom reference (LicenseRef-, DocumentRef-) is not readable without its text.
function refusedId(id) {
  if (/^(GPL|AGPL|SSPL)(-|\+|$)/i.test(id)) return `${id} (GPL, AGPL and SSPL licenses are refused)`;
  if (/^UNLICENSED$/i.test(id)) return `${id} (no license granted)`;
  if (/^(LicenseRef|DocumentRef)-/i.test(id)) return `${id} (custom license, not readable without its text)`;
  return null;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;
const OPERATORS = new Set(['AND', 'OR', 'WITH']);

// Parses an SPDX license expression (identifiers, AND, OR, WITH, parentheses) into a tree, or
// returns null when the text is not one.
function parseExpression(text) {
  const tokens = text.replace(/[()]/g, ' $& ').trim().split(/\s+/);
  let pos = 0;
  const peek = () => (tokens[pos] ?? '').toUpperCase();
  function primary() {
    const token = tokens[pos];
    if (token === '(') {
      pos += 1;
      const node = or();
      if (tokens[pos] !== ')') throw new Error('missing )');
      pos += 1;
      return node;
    }
    if (!token || !ID.test(token) || OPERATORS.has(token.toUpperCase())) throw new Error('identifier expected');
    pos += 1;
    if (peek() === 'WITH') {
      pos += 1;
      const exception = tokens[pos];
      if (!exception || !ID.test(exception) || OPERATORS.has(exception.toUpperCase())) throw new Error('exception expected');
      pos += 1;
    }
    return { id: token };
  }
  function and() {
    const items = [primary()];
    while (peek() === 'AND') {
      pos += 1;
      items.push(primary());
    }
    return items.length === 1 ? items[0] : { and: items };
  }
  function or() {
    const items = [and()];
    while (peek() === 'OR') {
      pos += 1;
      items.push(and());
    }
    return items.length === 1 ? items[0] : { or: items };
  }
  try {
    const tree = or();
    return pos === tokens.length ? tree : null;
  } catch {
    return null;
  }
}

// { ok, reasons }: an OR expression passes when one choice passes, an AND expression when
// every part passes.
function evaluateTree(node) {
  if (node.id) {
    const reason = refusedId(node.id);
    return reason ? { ok: false, reasons: [reason] } : { ok: true, reasons: [] };
  }
  const results = (node.and ?? node.or).map(evaluateTree);
  const ok = node.and ? results.every((r) => r.ok) : results.some((r) => r.ok);
  return { ok, reasons: ok ? [] : results.flatMap((r) => r.reasons) };
}

// Checks one license value as the lockfile holds it. Returns { ok: true } or
// { ok: false, problem }.
export function evaluateLicense(value) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { ok: false, problem: 'no license in the lockfile' };
  }
  if (typeof value !== 'string') return { ok: false, problem: `license is not an SPDX expression: ${JSON.stringify(value)}` };
  const tree = parseExpression(value.trim());
  if (!tree) return { ok: false, problem: `license is not an SPDX expression: ${value}` };
  const result = evaluateTree(tree);
  return result.ok ? { ok: true } : { ok: false, problem: `refused license: ${result.reasons.join(', ')}` };
}

// A single SPDX identifier, or null for an expression or an unreadable value.
export function singleLicenseId(value) {
  if (typeof value !== 'string') return null;
  const tree = parseExpression(value.trim());
  return tree && tree.id ? tree.id : null;
}

// The license to report for a package: the exception's when there is one, else the lockfile's.
export function reportedLicense(pkg, exceptions) {
  const exception = exceptions?.get(pkg.id);
  if (exception) return exception.license;
  return typeof pkg.license === 'string' && pkg.license.trim() !== '' ? pkg.license.trim() : null;
}
