// Lists the direct npm dependencies of backend, frontend and marketing/web whose latest published major
// is ahead of the major resolved in the folder's package-lock.json, then the Node versions of the
// Dockerfiles and CI and the GitHub Actions versions. Run it at the start of each delivery to keep the
// "Planned major upgrades" table of doc/dependency-exceptions.md current:
//   node scripts/deps/outdated-majors.mjs [--json]

import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const FOLDERS = ['backend', 'frontend', 'marketing/web'];
const CONCURRENCY = 12;
const asJson = process.argv.includes('--json');

class InputError extends Error {}

function readJson(relPath) {
  const full = path.join(ROOT, relPath);
  if (!existsSync(full)) throw new InputError(`missing file: ${relPath}`);
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch (err) {
    throw new InputError(`cannot read ${relPath}: ${err.message}`);
  }
}

function readText(relPath) {
  try {
    return readFileSync(path.join(ROOT, relPath), 'utf8');
  } catch (err) {
    throw new InputError(`cannot read ${relPath}: ${err.message}`);
  }
}

function majorOf(version) {
  const match = /^v?(\d+)/.exec(String(version ?? '').trim());
  return match ? Number(match[1]) : null;
}

// An alias such as "npm:string-width@^4.2.0" resolves to another registry name.
function registryName(name, spec) {
  if (typeof spec === 'string' && spec.startsWith('npm:')) {
    const target = spec.slice(4);
    const at = target.lastIndexOf('@');
    return at > 0 ? target.slice(0, at) : target;
  }
  return name;
}

function collectDependencies() {
  const entries = [];
  for (const folder of FOLDERS) {
    const pkg = readJson(path.join(folder, 'package.json'));
    const lock = readJson(path.join(folder, 'package-lock.json'));
    const packages = lock.packages ?? {};
    for (const [field, kind] of [['dependencies', 'prod'], ['devDependencies', 'dev']]) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        const resolved = packages[`node_modules/${name}`]?.version ?? null;
        entries.push({ folder, name, registry: registryName(name, spec), kind, resolved });
      }
    }
  }
  return entries;
}

function npmViewVersion(name) {
  return new Promise((resolve) => {
    execFile('npm', ['view', name, 'version', '--json'], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        const reason = (stderr || err.message || '').split('\n').find((line) => line.trim()) ?? 'npm view failed';
        resolve({ error: reason.trim() });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({ version: Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed });
      } catch {
        resolve({ error: 'unexpected npm view output' });
      }
    });
  });
}

async function latestVersions(names) {
  const results = new Map();
  const queue = [...names];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const name = queue.shift();
      results.set(name, await npmViewVersion(name));
    }
  });
  await Promise.all(workers);
  return results;
}

function findDockerfiles() {
  const found = [];
  const walk = (relDir) => {
    const full = path.join(ROOT, relDir);
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const rel = path.join(relDir, entry.name);
      if (entry.isDirectory()) {
        if (relDir.startsWith('marketing')) walk(rel);
      } else if (entry.name.startsWith('Dockerfile')) {
        found.push(rel);
      }
    }
  };
  for (const dir of ['backend', 'frontend', 'marketing']) walk(dir);
  return found.sort();
}

function collectRuntime() {
  const node = [];
  for (const file of findDockerfiles()) {
    readText(file).split('\n').forEach((line, index) => {
      const match = /^\s*FROM\s+node:(\S+)/i.exec(line);
      if (match) node.push({ source: `${file}:${index + 1}`, version: match[1] });
    });
  }

  const actions = [];
  const workflowDir = '.github/workflows';
  if (!existsSync(path.join(ROOT, workflowDir))) throw new InputError(`missing folder: ${workflowDir}`);
  const workflows = readdirSync(path.join(ROOT, workflowDir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  for (const name of workflows) {
    const file = path.join(workflowDir, name);
    readText(file).split('\n').forEach((line, index) => {
      const nodeMatch = /^\s*node-version:\s*['"]?([^'"\s#]+)/.exec(line);
      if (nodeMatch) node.push({ source: `${file}:${index + 1}`, version: nodeMatch[1] });
      // An action pinned to a commit SHA carries its version in the comment: `@<sha> # v4.4.0`.
      const actionMatch = /uses:\s*(actions\/[\w.-]+)@(\S+)(?:\s+#\s*(\S+))?/.exec(line);
      if (actionMatch) actions.push({ source: `${file}:${index + 1}`, action: actionMatch[1], version: actionMatch[3] ?? actionMatch[2] });
    });
  }
  return { node, actions };
}

function byFolderThenName(a, b) {
  return a.folder.localeCompare(b.folder) || (a.package ?? a.name).localeCompare(b.package ?? b.name);
}

async function main() {
  const entries = collectDependencies();
  const runtime = collectRuntime();
  const latest = await latestVersions([...new Set(entries.map((e) => e.registry))]);

  const behind = [];
  const notes = [];
  for (const entry of entries.sort(byFolderThenName)) {
    const result = latest.get(entry.registry);
    const row = { folder: entry.folder, package: entry.name, resolved: entry.resolved, latest: result.version ?? null, kind: entry.kind };
    if (result.error) {
      notes.push({ ...row, note: `lookup failed: ${result.error}` });
    } else if (entry.resolved === null) {
      notes.push({ ...row, note: 'not found in package-lock.json' });
    } else if (majorOf(result.version) > majorOf(entry.resolved)) {
      behind.push(row);
    }
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ behind, notes, node: runtime.node, actions: runtime.actions }, null, 2)}\n`);
    return;
  }

  const header = ['folder', 'package', 'resolved', 'latest', 'kind'];
  const rows = [...behind, ...notes].sort(byFolderThenName).map((r) => [
    r.folder, r.package, r.resolved ?? '-', r.latest ?? '-', r.note ? `${r.kind}  (${r.note})` : r.kind,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const format = (cells) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ');

  console.log(`Direct dependencies behind their latest major: ${behind.length}`);
  console.log(format(header));
  for (const row of rows) console.log(format(row));
  console.log('');
  console.log('Node versions');
  for (const n of runtime.node) console.log(`  ${n.source}  node ${n.version}`);
  console.log('');
  console.log('GitHub Actions');
  for (const a of runtime.actions) console.log(`  ${a.source}  ${a.action}@${a.version}`);
}

main().catch((err) => {
  console.error(err instanceof InputError ? err.message : err);
  process.exit(1);
});
