// Cuts and publishes a KANAP version (see doc/releasing.md). No dependency: it runs git, npm
// and gh, and works from any directory of the repository.
//
//   node scripts/release/release.mjs prepare <version> [--since <ref>] [--commit] [--dry-run]
//   node scripts/release/release.mjs publish <version> [--dry-run] [--no-sbom]
//
// prepare: in a worktree outside the repository (../kanap-release/v<version>, branch
// release/v<version> from origin/main), sets both package.json files to the version, inserts an
// empty CHANGELOG.md entry and writes a draft (../kanap-release/v<version>-release-notes.md) with
// the "Release notes" section of every pull request merged since the previous version. --since
// gives the starting point of the first release, when no version tag exists yet. Once the entry
// is written, the same command with --commit commits "Release <version>", pushes the branch,
// opens the pull request and puts it in the merge queue. A product in
// backend/src/technologies/catalog/curated/ whose oldest checked_on is more than 120 days
// old prints a warning. The warning never stops the command.
//
// publish: once the release pull request has merged, tags its merge commit v<version>, creates
// the GitHub release from the CHANGELOG.md entry, attaches the component inventory
// (scripts/sbom/generate.mjs) and moves the stable branch to the tag. Every step checks what
// exists first: a rerun after a failure only does what is missing. A tag is never moved and no
// push is forced.
//
// --dry-run runs every read (git fetch included) and prints each write instead of running it.
// Exit status: 2 for a usage or input mistake, 1 for any other failure.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  InputError, compareVersions, entrySkeleton, extractEntry, extractReleaseNotes, insertEntry,
  isUnchangedSkeleton, latestVersion, missingPrNumbers, parseVersion, prNumbersOf, tagOf, versionOfTag,
} from './changelog.mjs';

const REPO = 'kanap-hq/KANAP';
const PACKAGE_FOLDERS = ['backend', 'frontend'];
const RELEASE_FILES = [
  'backend/package.json', 'backend/package-lock.json',
  'frontend/package.json', 'frontend/package-lock.json',
  'CHANGELOG.md',
];
const USAGE = [
  'usage: node scripts/release/release.mjs prepare <version> [--since <ref>] [--commit] [--dry-run]',
  '       node scripts/release/release.mjs publish <version> [--dry-run] [--no-sbom]',
].join('\n');

let dryRun = false;

const CURATED_DIR = path.join('backend', 'src', 'technologies', 'catalog', 'curated');
const CURATED_STALE_DAYS = 120;
const DAY_MS = 86400000;

// A real ISO day, or null. Rejects a day that does not exist (2026-02-31).
function isoDayMs(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const ms = Date.UTC(year, month - 1, date);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== date) return null;
  return ms;
}

/**
 * Warning when a KANAP-maintained product was last checked more than `maxDays` before `today`.
 * `products` is `{ key, checkedOn }[]`, `checkedOn` the oldest ISO day of that product (null when
 * none parses, which counts as stale). Returns null when every product is fresh. Never throws.
 */
export function curatedStaleWarning(products, today, maxDays = CURATED_STALE_DAYS) {
  const todayMs = isoDayMs(today);
  if (todayMs === null || !Array.isArray(products)) return null;
  const stale = [];
  for (const product of products) {
    const checkedMs = isoDayMs(product?.checkedOn);
    if (checkedMs === null || todayMs - checkedMs > maxDays * DAY_MS) {
      if (product?.key) stale.push(String(product.key));
    }
  }
  if (stale.length === 0) return null;
  const keys = stale.slice().sort();
  return `Warning: curated catalog: ${keys.length} product(s) checked more than ${maxDays} days ago: ${keys.join(', ')} (run the technology-catalog-curation skill)`;
}

function curatedProducts(root) {
  let names;
  try {
    names = readdirSync(path.join(root, CURATED_DIR));
  } catch {
    return [];
  }
  const products = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const key = name.slice(0, -'.json'.length);
    let checkedOn = null;
    try {
      const doc = JSON.parse(readFileSync(path.join(root, CURATED_DIR, name), 'utf8'));
      const days = (Array.isArray(doc.versions) ? doc.versions : [])
        .map((version) => version?.checked_on)
        .filter((day) => isoDayMs(day) !== null)
        .sort();
      checkedOn = days[0] ?? null;
    } catch {
      checkedOn = null;
    }
    products.push({ key, checkedOn });
  }
  return products;
}

function warnCuratedCatalog(root) {
  const line = curatedStaleWarning(curatedProducts(root), new Date().toISOString().slice(0, 10));
  if (line) console.log(line);
}

function parseArgs(argv) {
  const [command, version, ...rest] = argv;
  if (!['prepare', 'publish'].includes(command) || !version || version.startsWith('--')) throw new InputError(USAGE);
  const allowed = command === 'prepare' ? ['--since', '--commit', '--dry-run'] : ['--dry-run', '--no-sbom'];
  const options = { command, version, since: null, commit: false, dryRun: false, sbom: true };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!allowed.includes(flag)) throw new InputError(`unknown argument for ${command}: ${flag}\n${USAGE}`);
    if (flag === '--since') {
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) throw new InputError('--since needs a value');
      options.since = value;
      i += 1;
    } else if (flag === '--commit') options.commit = true;
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--no-sbom') options.sbom = false;
  }
  parseVersion(version);
  return options;
}

function quote(arg) {
  return /^[\w@%+=:,./^-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
}

function show(cmd, args, cwd) {
  return `${cwd ? `(cd ${quote(cwd)} && ` : ''}${[cmd, ...args].map(quote).join(' ')}${cwd ? ')' : ''}`;
}

// Runs a command and returns { status, stdout, stderr }. A command that cannot start throws.
function exec(cmd, args, { cwd, inherit = false } = {}) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`cannot run ${cmd}: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: (result.stderr ?? '').trim() };
}

function failure(cmd, args, cwd, result) {
  return new Error(`${show(cmd, args, cwd)} failed (exit ${result.status})${result.stderr ? `: ${result.stderr}` : ''}`);
}

// A read: always runs, printed under --dry-run. Returns stdout, throws on a non-zero exit.
function read(cmd, args, cwd) {
  if (dryRun) console.log(`  $ ${show(cmd, args, cwd)}`);
  const result = exec(cmd, args, { cwd });
  if (result.status !== 0) throw failure(cmd, args, cwd, result);
  return result.stdout;
}

// A read whose non-zero exit is an answer, not a failure.
function probe(cmd, args, cwd) {
  if (dryRun) console.log(`  $ ${show(cmd, args, cwd)}`);
  return exec(cmd, args, { cwd });
}

// A write: printed and skipped under --dry-run. Returns stdout (null under --dry-run).
function write(cmd, args, { cwd, inherit = false } = {}) {
  if (dryRun) {
    console.log(`  would run: ${show(cmd, args, cwd)}`);
    return null;
  }
  console.log(`  + ${show(cmd, args, cwd)}`);
  const result = exec(cmd, args, { cwd, inherit });
  if (result.status !== 0) throw failure(cmd, args, cwd, result);
  return result.stdout;
}

function writeText(file, content) {
  if (dryRun) {
    console.log(`  would write: ${file}`);
    return;
  }
  writeFileSync(file, content);
}

function checkGh() {
  const result = probe('gh', ['auth', 'status']);
  if (result.status !== 0) throw new InputError(`gh is not signed in (gh auth status: ${result.stderr || `exit ${result.status}`}). Run gh auth login first.`);
}

// The version tags of origin: Map tag -> commit SHA (annotated tags peeled).
function remoteTags(root) {
  const tags = new Map();
  for (const line of read('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v*'], root).split('\n')) {
    const match = /^([0-9a-f]+)\s+refs\/tags\/(.+?)(\^\{\})?$/.exec(line.trim());
    if (!match) continue;
    if (match[3] || !tags.has(match[2])) tags.set(match[2], match[1]);
  }
  return tags;
}

function remoteBranch(root, branch) {
  const line = read('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], root).trim();
  return line ? line.split(/\s+/)[0] : null;
}

function isAncestor(root, ancestor, descendant) {
  const result = probe('git', ['merge-base', '--is-ancestor', ancestor, descendant], root);
  if (result.status > 1) throw failure('git', ['merge-base', '--is-ancestor', ancestor, descendant], root, result);
  return result.status === 0;
}

function prView(number) {
  const result = probe('gh', ['pr', 'view', String(number), '--repo', REPO, '--json', 'number,title,body']);
  if (result.status !== 0) return { number, title: '(could not be read)', notes: null, error: result.stderr || `exit ${result.status}` };
  const pr = JSON.parse(result.stdout);
  return { number, title: pr.title, notes: extractReleaseNotes(pr.body) };
}

// ---------------------------------------------------------------- prepare

function notesDraft(version, base, prs) {
  const withNotes = prs.filter((pr) => pr.notes);
  const without = prs.filter((pr) => !pr.notes);
  const section = (pr) => [
    `### #${pr.number} ${pr.title}`,
    '',
    pr.notes ? pr.notes.replace(/^(#{3,})\s/gm, '#$1 ') : (pr.error ? `_Could not be read: ${pr.error}_` : '_No release notes section._'),
    '',
  ];
  const lines = [
    `# Release notes draft for ${version}`,
    '',
    `Pull requests merged since ${base}: ${prs.length} (${withNotes.length} with a release notes section, ${without.length} without).`,
    'Write the CHANGELOG.md entry from these notes. This file is never committed.',
    '',
    '## With release notes',
    '',
    ...withNotes.flatMap(section),
  ];
  if (without.length) lines.push('## Without a release notes section', '', ...without.flatMap(section));
  return { text: `${lines.join('\n').trimEnd()}\n`, withNotes: withNotes.length, without: without.length };
}

function packageVersions(dir, folder) {
  const pkg = JSON.parse(readFileSync(path.join(dir, folder, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(dir, folder, 'package-lock.json'), 'utf8'));
  return [pkg.version, lock.version, lock.packages?.['']?.version];
}

function prepare(root, options) {
  const { version } = options;
  const tag = tagOf(version);
  const branch = `release/${tag}`;
  console.log(`${dryRun ? 'Dry run: nothing is written. ' : ''}Preparing ${version}.`);

  checkGh();
  read('git', ['fetch', 'origin', '--tags'], root);
  const latest = latestVersion(remoteTags(root).keys());
  let base;
  if (latest) {
    if (compareVersions(version, latest) <= 0) throw new InputError(`${version} must be greater than the latest version, ${latest}`);
    base = tagOf(latest);
    if (options.since) console.log(`Notice: --since is ignored, the previous version ${latest} is the starting point.`);
  } else {
    if (!options.since) throw new InputError('no version tag exists yet: the first release needs --since <ref> (the commit the notes start from)');
    if (probe('git', ['rev-parse', '--verify', '--quiet', `${options.since}^{commit}`], root).status !== 0) {
      throw new InputError(`--since ${options.since} is not a commit of this repository`);
    }
    base = options.since;
  }
  console.log(`Starting point: ${base}.`);

  // 1. The worktree, outside the repository.
  const releaseDir = path.resolve(root, '..', 'kanap-release');
  const dir = path.join(releaseDir, tag);
  const draftFile = path.join(releaseDir, `${tag}-release-notes.md`);
  let ready = existsSync(dir);
  if (ready) {
    const current = read('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim();
    if (current !== branch) throw new InputError(`${dir} exists on branch ${current}, not ${branch}: remove it (git worktree remove ${dir}) or check it out on ${branch}`);
    console.log(`Worktree: ${dir} (reused).`);
  } else {
    write('git', ['worktree', 'add', dir, '-b', branch, 'origin/main'], { cwd: root });
    ready = !dryRun;
    console.log(`Worktree: ${dir}.`);
  }

  // 2. Versions and the empty entry, once.
  const changelogFile = path.join(dir, 'CHANGELOG.md');
  const changelog = ready && existsSync(changelogFile) ? readFileSync(changelogFile, 'utf8') : '';
  if (ready && extractEntry(changelog, version)) {
    console.log(`CHANGELOG.md already has the ${version} entry: kept.`);
  } else {
    for (const folder of PACKAGE_FOLDERS) {
      write('npm', ['version', version, '--no-git-tag-version'], { cwd: path.join(dir, folder) });
      if (!dryRun) {
        const found = packageVersions(dir, folder);
        if (found.some((value) => value !== version)) {
          throw new Error(`${folder}: npm version left package.json / package-lock.json at ${found.join(' / ')}, expected ${version}`);
        }
      }
    }
    const migrations = read('git', ['diff', '--name-only', '--diff-filter=A', `${base}..origin/main`, '--', 'backend/src/migrations'], root)
      .split('\n').filter((file) => file.endsWith('.ts')).map((file) => path.basename(file, '.ts'));
    const skeleton = entrySkeleton({ version, date: new Date().toISOString().slice(0, 10), migrations });
    writeText(changelogFile, insertEntry(changelog, skeleton));
    console.log(`CHANGELOG.md entry ${dryRun ? 'to insert' : 'inserted'}:\n\n${skeleton}`);
  }

  // 3. The notes of the merged pull requests.
  const subjects = read('git', ['log', '--format=%s', `${base}..origin/main`], root).split('\n').filter(Boolean);
  const prs = prNumbersOf(subjects).map(prView);
  const draft = notesDraft(version, base, prs);
  writeText(draftFile, draft.text);
  if (dryRun) console.log(`\n${draft.text}`);
  console.log(`Release notes draft: ${draftFile}`);
  console.log(`${prs.length} pull requests merged since ${base}: ${draft.withNotes} with a release notes section, ${draft.without} without.`);
  warnCuratedCatalog(root);

  if (!options.commit) {
    console.log(`\nNext: write the ${version} entry in ${changelogFile} from the draft, then run:`);
    console.log(`  node scripts/release/release.mjs prepare ${version} --commit`);
    return;
  }

  // 4. Commit, push, pull request, merge queue.
  const entry = ready && existsSync(changelogFile) ? extractEntry(readFileSync(changelogFile, 'utf8'), version) : null;
  if (entry && isUnchangedSkeleton(entry.body)) {
    throw new InputError(`the ${version} entry is still empty (no Changes or Fixes item, summary placeholder unchanged): write it in ${changelogFile} first`);
  }
  if (!entry && !dryRun) throw new InputError(`${changelogFile} has no ${version} entry`);
  if (!entry) console.log('(The entry is checked once it is written.)');
  const pending = entry ? read('git', ['status', '--porcelain', '--', ...RELEASE_FILES], dir).trim() : 'not written yet';
  if (pending) {
    write('git', ['add', '--', ...RELEASE_FILES], { cwd: dir });
    write('git', ['commit', '-m', `Release ${version}`], { cwd: dir });
  } else {
    console.log('Nothing new to commit in the release files.');
  }
  write('git', ['push', '-u', 'origin', branch], { cwd: dir });

  const open = JSON.parse(read('gh', ['pr', 'list', '--repo', REPO, '--head', branch, '--state', 'open', '--json', 'number,url']));
  let number;
  let url;
  if (open.length) {
    ({ number, url } = open[0]);
    console.log(`Pull request #${number} already open: reused.`);
  } else {
    let bodyFile = path.join(tmpdir(), `kanap-release-${tag}-body.md`);
    if (!dryRun) {
      bodyFile = path.join(mkdtempSync(path.join(tmpdir(), 'kanap-release-')), 'body.md');
      writeFileSync(bodyFile, `${entry.heading}\n\n${entry.body}\n`);
    }
    const out = write('gh', ['pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--title', `Release ${version}`, '--body-file', bodyFile], { cwd: dir });
    if (!dryRun) rmSync(path.dirname(bodyFile), { recursive: true, force: true });
    if (out !== null) {
      url = out.trim().split('\n').pop();
      number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
      if (!number) throw new Error(`gh pr create answered "${out.trim()}": no pull request URL`);
    }
  }
  write('bash', ['.github/scripts/queue-stack.sh', String(number ?? '<pr>')], { cwd: root, inherit: true });
  console.log(`\nRelease pull request: ${url ?? '(created by the commands above)'}`);
  console.log(`Once it has merged: node scripts/release/release.mjs publish ${version}`);
}

// ---------------------------------------------------------------- publish

function showFile(root, sha, file) {
  const result = probe('git', ['show', `${sha}:${file}`], root);
  if (result.status !== 0) throw new InputError(`${file} cannot be read at ${sha}: ${result.stderr}`);
  return result.stdout;
}

function sbom(root, tag) {
  const work = dryRun ? path.join(tmpdir(), 'kanap-release-sbom-XXXX') : mkdtempSync(path.join(tmpdir(), 'kanap-release-sbom-'));
  const tree = path.join(work, 'tree');
  const out = path.join(work, 'out');
  try {
    write('git', ['worktree', 'add', '--detach', tree, tag], { cwd: root });
    write('node', ['scripts/sbom/generate.mjs', '--out', out], { cwd: tree });
    const files = dryRun ? [path.join(out, '*')] : readdirSync(out).sort().map((name) => path.join(out, name));
    write('gh', ['release', 'upload', tag, ...files, '--clobber', '--repo', REPO]);
    return files.map((file) => path.basename(file));
  } catch (err) {
    throw new Error(`The inventory step failed, the stable branch was not moved: ${err.message}\n`
      + `The tag and the release are in place. Fix the cause, then rerun publish: it keeps what exists.`);
  } finally {
    if (dryRun) {
      console.log(`  would run: ${show('git', ['worktree', 'remove', '--force', tree], root)}`);
    } else {
      if (existsSync(tree)) exec('git', ['worktree', 'remove', '--force', tree], { cwd: root });
      rmSync(work, { recursive: true, force: true });
    }
  }
}

function publish(root, options) {
  const { version } = options;
  const tag = tagOf(version);
  console.log(`${dryRun ? 'Dry run: nothing is written. ' : ''}Publishing ${version}.`);

  checkGh();
  read('git', ['fetch', 'origin', '--tags'], root);

  // 1. The merge commit of the release pull request.
  const title = `Release ${version}`;
  const found = JSON.parse(read('gh', ['pr', 'list', '--repo', REPO, '--state', 'merged', '--search', `${title} in:title`, '--json', 'number,title,mergeCommit']));
  const releases = found.filter((pr) => pr.title === title);
  if (releases.length !== 1) {
    throw new InputError(releases.length
      ? `several merged pull requests are titled "${title}": ${releases.map((pr) => `#${pr.number}`).join(', ')}`
      : `no merged pull request is titled "${title}": run prepare ${version} --commit and wait for the merge queue`);
  }
  const pr = releases[0];
  const sha = pr.mergeCommit?.oid;
  if (!sha) throw new InputError(`#${pr.number} has no merge commit`);
  if (!isAncestor(root, sha, 'origin/main')) throw new InputError(`the merge commit ${sha} of #${pr.number} is not on origin/main`);
  console.log(`Release pull request #${pr.number}, merge commit ${sha}.`);

  // 2. The content of that commit.
  for (const folder of PACKAGE_FOLDERS) {
    const file = `${folder}/package.json`;
    const found = JSON.parse(showFile(root, sha, file)).version;
    if (found !== version) throw new InputError(`${file} is at ${found} in ${sha}, not ${version}`);
  }
  const entry = extractEntry(showFile(root, sha, 'CHANGELOG.md'), version);
  if (!entry) throw new InputError(`CHANGELOG.md has no ${version} entry in ${sha}`);

  // 3. Pull requests merged after prepare and absent from the entry.
  const tags = remoteTags(root);
  const previous = latestVersion([...tags.keys()].filter((name) => {
    const v = versionOfTag(name);
    return v !== null && compareVersions(v, version) < 0;
  }));
  if (previous) {
    const subjects = read('git', ['log', '--format=%s', `${tags.get(tagOf(previous))}..${sha}`], root).split('\n').filter(Boolean);
    const missing = missingPrNumbers(entry.body, prNumbersOf(subjects).filter((n) => n !== pr.number));
    if (missing.length) {
      console.log(`Warning: merged since ${tagOf(previous)} and not cited in the entry: ${missing.map((n) => `#${n}`).join(', ')}`);
    }
  }

  // 4. The tag, never moved.
  if (tags.has(tag)) {
    if (tags.get(tag) !== sha) throw new InputError(`the tag ${tag} already points at ${tags.get(tag)}, not at ${sha}: a tag is never moved`);
    console.log(`Tag ${tag} already on ${sha}: kept.`);
  } else {
    const local = probe('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], root);
    if (local.status === 0 && local.stdout.trim() !== sha) {
      throw new InputError(`the local tag ${tag} points at ${local.stdout.trim()}, not at ${sha}: delete it (git tag -d ${tag}) and rerun`);
    }
    if (local.status !== 0) write('git', ['tag', '-a', tag, '-m', `KANAP ${version}`, sha], { cwd: root });
    write('git', ['push', 'origin', tag], { cwd: root });
  }

  // 5. The GitHub release.
  let releaseUrl;
  const view = probe('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'url']);
  if (view.status === 0) {
    releaseUrl = JSON.parse(view.stdout).url;
    console.log(`Release ${tag} already exists: kept.`);
  } else if (/not found/i.test(view.stderr)) {
    let notesFile = path.join(tmpdir(), `kanap-release-${tag}-notes.md`);
    if (!dryRun) {
      notesFile = path.join(mkdtempSync(path.join(tmpdir(), 'kanap-release-')), 'notes.md');
      writeFileSync(notesFile, `${entry.body}\n`);
    }
    const out = write('gh', ['release', 'create', tag, '--repo', REPO, '--title', entry.title, '--notes-file', notesFile]);
    if (!dryRun) rmSync(path.dirname(notesFile), { recursive: true, force: true });
    releaseUrl = out?.trim().split('\n').pop();
  } else {
    throw failure('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'url'], null, view);
  }

  // 6. The component inventory.
  const attached = options.sbom ? sbom(root, tag) : [];
  if (!options.sbom) console.log('Inventory skipped (--no-sbom).');

  // 7. stable, fast-forward only.
  const stable = remoteBranch(root, 'stable');
  if (stable === sha) {
    console.log(`stable already on ${sha}.`);
  } else {
    if (stable && !isAncestor(root, stable, sha)) {
      throw new InputError(`stable (${stable}) is not an ancestor of ${sha}: stable must be fast-forwardable to the new version. Find out why it moved before publishing.`);
    }
    write('git', ['push', 'origin', `${sha}:refs/heads/stable`], { cwd: root });
  }

  console.log(`\n${dryRun ? 'Dry run done. Would publish' : 'Published'} ${version}:`);
  console.log(`  tag:      ${tag} -> ${sha}`);
  console.log(`  release:  ${entry.title}${releaseUrl ? ` (${releaseUrl})` : ''}`);
  console.log(`  files:    ${attached.length ? attached.join(', ') : 'none'}`);
  console.log(`  stable:   ${sha}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  dryRun = options.dryRun;
  const top = exec('git', ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) throw new InputError('run this script inside the KANAP repository');
  const root = top.stdout.trim();
  if (options.command === 'prepare') prepare(root, options);
  else publish(root, options);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof InputError ? `Error: ${err.message}` : err.message ?? err);
    process.exit(err instanceof InputError ? 2 : 1);
  }
}
