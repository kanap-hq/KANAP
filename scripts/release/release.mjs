// Cuts and publishes a KANAP version (see doc/releasing.md). No dependency: it runs git, npm
// and gh, and works from any directory of the repository.
//
//   node scripts/release/release.mjs prepare <version> [--since <ref>] [--commit] [--dry-run]
//   node scripts/release/release.mjs publish <version> [--dry-run] [--no-sbom] [--no-images]
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
// publish: once the release pull request has merged, tags its merge commit v<version>, waits
// for the CI to publish the images of the tag (.github/workflows/release-images.yml) and checks
// that anyone can pull them, creates the GitHub release from the CHANGELOG.md entry plus the
// image digests, attaches the component inventory (scripts/sbom/generate.mjs), points the
// `stable` and YY.M image tags at the version (a manual run of the same workflow) and moves the
// stable branch to the tag. Every step checks what exists first: a rerun after a failure only
// does what is missing. A tag is never moved and no push is forced. --no-images skips the image
// steps, for a version older than the image workflow only: it is refused when the tagged commit
// holds .github/workflows/release-images.yml. Without it, a version without images does not move
// stable.
//
// The GitHub repository is the one of the origin remote (kanap-hq/KANAP when origin is not on
// GitHub), so a trial run on a fork exercises every step against the fork.
//
// --dry-run prints each write instead of running it. It runs the git and GitHub reads that the
// steps before the images depend on (git fetch, the release pull request, the commit, the tags,
// the release, the stable branch). It reads neither the image workflow runs nor the registry:
// it prints the commands it would wait on and the Images section with placeholder digests.
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

// The repository gh acts on: the GitHub repository of origin (see main), this one otherwise.
const DEFAULT_REPO = 'kanap-hq/KANAP';
let repo = DEFAULT_REPO;
const PACKAGE_FOLDERS = ['backend', 'frontend'];
const RELEASE_FILES = [
  'backend/package.json', 'backend/package-lock.json',
  'frontend/package.json', 'frontend/package-lock.json',
  'CHANGELOG.md',
];
const USAGE = [
  'usage: node scripts/release/release.mjs prepare <version> [--since <ref>] [--commit] [--dry-run]',
  '       node scripts/release/release.mjs publish <version> [--dry-run] [--no-sbom] [--no-images]',
].join('\n');

// The images release-images.yml publishes for a version, in this order in digests.txt.
const IMAGES = ['kanap-api', 'kanap-api-tools', 'kanap-web', 'kanap-marketing'];
const IMAGE_WORKFLOW = 'release-images.yml';
const IMAGE_ARTIFACT = 'image-digests';
// Same form as the first step of release-images.yml.
const IMAGE_TAG = /^v\d{2}\.([1-9]|1[0-2])\.[1-9]\d*$/;
const RUN_FIELDS = 'databaseId,status,conclusion,url,headSha,createdAt,event,displayTitle';
const RUN_APPEAR_SECONDS = 120;
const RUN_WAIT_MINUTES = 45;
const POLL_SECONDS = 15;
const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

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

// ---------------------------------------------------------------- images (pure)

/** True for a tag release-images.yml builds images for: vYY.M.N. */
export function isImageTag(tag) {
  return IMAGE_TAG.test(String(tag ?? ''));
}

/** The registry namespace of a repository: its owner in lower case (ghcr.io/<owner>/<image>). */
export function registryOwner(repo) {
  return String(repo).split('/')[0].toLowerCase();
}

/**
 * Reads digests.txt of release-images.yml: one line per image, "<image> <version> <reference>",
 * the reference ghcr.io/<owner>/<image>@sha256:<64 hex>. Returns `{ image, ref, name, digest }[]`
 * in the order of IMAGES. Throws on a malformed line, another version or owner, an unknown or
 * repeated image, or a missing one.
 */
export function parseDigests(text, version, owner) {
  const found = new Map();
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const match = parts.length === 3 ? /^ghcr\.io\/([^/@\s]+)\/([^/@\s]+)@(sha256:[0-9a-f]{64})$/.exec(parts[2]) : null;
    if (!match) throw new Error(`digests.txt: unexpected line "${line}" (expected "<image> <version> ghcr.io/<owner>/<image>@sha256:<digest>")`);
    const [image, tag] = parts;
    if (!IMAGES.includes(image)) throw new Error(`digests.txt: unknown image ${image}`);
    if (tag !== version) throw new Error(`digests.txt: ${image} is tagged ${tag}, not ${version}`);
    if (match[1] !== owner || match[2] !== image) throw new Error(`digests.txt: ${image} points at ${parts[2]}, not at ghcr.io/${owner}/${image}`);
    if (found.has(image)) throw new Error(`digests.txt: ${image} is listed twice`);
    found.set(image, { image, ref: parts[2], name: `ghcr.io/${owner}/${image}`, digest: match[3] });
  }
  const missing = IMAGES.filter((image) => !found.has(image));
  if (missing.length) throw new Error(`digests.txt: no digest for ${missing.join(', ')}`);
  return IMAGES.map((image) => found.get(image));
}

/**
 * The GitHub repository (`owner/name`) of a remote URL: https, ssh or scp-like git@github.com
 * form, with or without .git. Null for any other host or form.
 */
export function githubRepoOf(url) {
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * The "### Images" section appended to the notes of a GitHub release. Its verify command accepts
 * only an attestation signed by release-images.yml of `repo` for the tag of the version.
 */
export function imagesSection(entries, repo, version) {
  return [
    '### Images',
    '',
    '| Image | Reference |',
    '|---|---|',
    ...entries.map((entry) => `| \`${entry.image}\` | \`${entry.ref}\` |`),
    '',
    `Provenance: \`gh attestation verify oci://${entries[0].ref} -R ${repo} --signer-workflow ${repo}/.github/workflows/${IMAGE_WORKFLOW} --source-ref refs/tags/${tagOf(version)}\``,
  ].join('\n');
}

/** True when release notes already hold the "### Images" section. */
export function hasImagesSection(body) {
  return /^### Images[ \t]*$/m.test(String(body ?? ''));
}

/**
 * The images where one of `tags` (stable and YY.M) is not on the digest of the version yet.
 * `current` maps an image to `{ <tag>: digest or null }`. An empty list: already promoted.
 */
export function imagesToPromote(entries, current, tags) {
  return entries
    .filter((entry) => tags.some((tag) => (current?.[entry.image]?.[tag] ?? null) !== entry.digest))
    .map((entry) => entry.image);
}

/** The run id in the output of `gh workflow run` (its run URL), or null when it gives none. */
export function runIdFromDispatch(output) {
  const match = /\/actions\/runs\/(\d+)/.exec(String(output ?? ''));
  return match ? Number(match[1]) : null;
}

/**
 * The promotion run of `version` among `runs` (gh run list, newest first or not): titled
 * "promote <version>" (run-name of release-images.yml) and absent from `knownIds`, the runs
 * listed before the dispatch. The newest such run, or null.
 */
export function pickPromotionRun(runs, version, knownIds) {
  const known = new Set([...(knownIds ?? [])].map(Number));
  return (runs ?? [])
    .filter((run) => run.displayTitle === `promote ${version}` && !known.has(Number(run.databaseId)))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

function parseArgs(argv) {
  const [command, version, ...rest] = argv;
  if (!['prepare', 'publish'].includes(command) || !version || version.startsWith('--')) throw new InputError(USAGE);
  const allowed = command === 'prepare' ? ['--since', '--commit', '--dry-run'] : ['--dry-run', '--no-sbom', '--no-images'];
  const options = { command, version, since: null, commit: false, dryRun: false, sbom: true, images: true };
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
    else if (flag === '--no-images') options.images = false;
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
  const result = probe('gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'number,title,body']);
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

  const open = JSON.parse(read('gh', ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number,url']));
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
    const out = write('gh', ['pr', 'create', '--repo', repo, '--base', 'main', '--head', branch, '--title', `Release ${version}`, '--body-file', bodyFile], { cwd: dir });
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
    write('gh', ['release', 'upload', tag, ...files, '--clobber', '--repo', repo]);
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

function sleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

// The newest run of the image workflow for `event` that `accept` takes, waiting up to
// RUN_APPEAR_SECONDS for it to show up. Null when none appears.
function findRun(args, accept) {
  const deadline = Date.now() + RUN_APPEAR_SECONDS * 1000;
  for (;;) {
    const runs = JSON.parse(read('gh', args)).filter(accept)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (runs.length) return runs[0];
    if (Date.now() >= deadline) return null;
    sleep(POLL_SECONDS);
  }
}

function runListArgs(extra) {
  return ['run', 'list', '--repo', repo, '--workflow', IMAGE_WORKFLOW, ...extra, '--json', RUN_FIELDS, '--limit', '20'];
}

// Waits for a run to complete, up to RUN_WAIT_MINUTES. Throws `failed(url)` unless it succeeded.
function waitRun(run, failed) {
  const deadline = Date.now() + RUN_WAIT_MINUTES * 60 * 1000;
  let state = run;
  let announced = false;
  while (state.status !== 'completed') {
    if (!announced) console.log(`Waiting for ${state.url} (up to ${RUN_WAIT_MINUTES} minutes).`);
    announced = true;
    if (Date.now() >= deadline) throw new Error(`${state.url} has not finished after ${RUN_WAIT_MINUTES} minutes. Rerun publish once it has: it starts again from there.`);
    sleep(POLL_SECONDS);
    state = { ...state, ...JSON.parse(read('gh', ['run', 'view', String(run.databaseId), '--repo', repo, '--json', 'status,conclusion,url'])) };
  }
  if (state.conclusion !== 'success') throw new Error(failed(state.url));
  return state;
}

// The manifest of `<name>:<reference>` as an anonymous client sees it: an anonymous pull token
// from ghcr.io, then a HEAD of the manifest. Returns { status, digest } (status 0 when no token
// was given).
function anonymousManifest(name, reference) {
  const repository = name.replace(/^ghcr\.io\//, '');
  const token = exec('curl', ['-sS', '-w', '\n%{http_code}', `https://ghcr.io/token?scope=repository:${repository}:pull`]);
  if (token.status !== 0) throw new Error(`curl could not reach ghcr.io (exit ${token.status}): ${token.stderr}`);
  const lines = token.stdout.trimEnd().split('\n');
  const code = Number(lines.pop());
  let value = null;
  try {
    value = code === 200 ? JSON.parse(lines.join('\n')).token : null;
  } catch {
    value = null;
  }
  if (!value) return { status: 0, digest: null };
  const head = exec('curl', ['-sS', '-I', '-H', `Authorization: Bearer ${value}`, '-H', `Accept: ${MANIFEST_TYPES}`,
    `https://ghcr.io/v2/${repository}/manifests/${reference}`]);
  if (head.status !== 0) throw new Error(`curl could not reach ghcr.io (exit ${head.status}): ${head.stderr}`);
  const statuses = [...head.stdout.matchAll(/^HTTP\/[\d.]+\s+(\d{3})/gm)];
  const status = statuses.length ? Number(statuses[statuses.length - 1][1]) : 0;
  const digest = /^docker-content-digest:\s*(sha256:[0-9a-f]{64})\s*$/im.exec(head.stdout)?.[1] ?? null;
  return { status, digest };
}

function placeholderImages(owner) {
  return IMAGES.map((image) => ({ image, ref: `ghcr.io/${owner}/${image}@sha256:<digest>`, name: `ghcr.io/${owner}/${image}`, digest: 'sha256:<digest>' }));
}

// Step 5: the newest run of release-images.yml for the tag (its push, or a manual run on it),
// its digests.txt, and an anonymous pull of each image at the version.
function waitForImages(version, tag, sha) {
  const owner = registryOwner(repo);
  if (!isImageTag(tag)) throw new InputError(`${tag} is not a version tag vYY.M.N: release-images.yml builds no image for it`);
  const list = runListArgs(['--branch', tag]);
  if (dryRun) {
    console.log(`  would wait for the run of ${IMAGE_WORKFLOW} on ${sha}: ${show('gh', list)}, then ${show('gh', ['run', 'view', '<run>', '--repo', repo, '--json', 'status,conclusion,url'])} until it completes (up to ${RUN_WAIT_MINUTES} minutes)`);
    console.log(`  would run: ${show('gh', ['run', 'download', '<run>', '--repo', repo, '--name', IMAGE_ARTIFACT, '--dir', '<tmp>'])}`);
    console.log(`  would check an anonymous pull of ${IMAGES.map((image) => `ghcr.io/${owner}/${image}:${version}`).join(', ')}`);
    return placeholderImages(owner);
  }
  const run = findRun(list, (candidate) => candidate.headSha === sha && ['push', 'workflow_dispatch'].includes(candidate.event));
  if (!run) {
    throw new Error(`no run of ${IMAGE_WORKFLOW} for ${tag} after ${RUN_APPEAR_SECONDS} seconds: the release was not created and stable was not moved. `
      + `Start it on the tag (${show('gh', ['workflow', 'run', IMAGE_WORKFLOW, '--repo', repo, '--ref', tag])}), then rerun publish ${version}.`);
  }
  waitRun(run, (url) => `the image workflow failed, the release was not created and stable was not moved: ${url}. `
    + `Fix the cause, rerun the failed jobs of that run (it reuses the images this commit already pushed), then rerun publish ${version}.`);
  console.log(`Images published by ${run.url}.`);

  const dir = mkdtempSync(path.join(tmpdir(), 'kanap-release-images-'));
  let entries;
  try {
    read('gh', ['run', 'download', String(run.databaseId), '--repo', repo, '--name', IMAGE_ARTIFACT, '--dir', dir]);
    entries = parseDigests(readFileSync(path.join(dir, 'digests.txt'), 'utf8'), version, owner);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const closed = [];
  for (const entry of entries) {
    const seen = anonymousManifest(entry.name, version);
    if (seen.status !== 200) {
      closed.push(entry.image);
    } else if (seen.digest !== entry.digest) {
      throw new Error(`${entry.name}:${version} is on ${seen.digest}, the image workflow published ${entry.digest}: find out why before going on`);
    }
  }
  if (closed.length) {
    throw new InputError(`an anonymous pull of ${closed.map((image) => `${image}:${version}`).join(', ')} fails: the package is not public. `
      + `For each one: organisation ${owner} -> Packages -> <image> -> Package settings -> Change visibility -> Public. `
      + `Then rerun publish ${version}: it starts again from here. The release was not created and stable was not moved.`);
  }
  console.log(`Anyone can pull the ${entries.length} images of ${version}.`);
  return entries;
}

// Step 8: stable and YY.M on the digests of the version (a manual run of release-images.yml).
function promoteImages(version, entries, tags) {
  const minor = version.split('.').slice(0, 2).join('.');
  const dispatch = ['workflow', 'run', IMAGE_WORKFLOW, '--repo', repo, '--ref', 'main', '-f', `promote=${version}`];
  const list = runListArgs(['--branch', 'main', '--event', 'workflow_dispatch']);
  const promoted = ['stable', minor];
  if (dryRun) {
    console.log(`  would run, unless every stable and ${minor} tag is already on the version: ${show('gh', dispatch)}`);
    console.log(`  then wait for the run it names, or the new run titled "promote ${version}" in ${show('gh', list)} (stable and ${minor} on the digests above)`);
    return;
  }
  const currentDigests = () => Object.fromEntries(entries.map((entry) => [entry.image,
    Object.fromEntries(promoted.map((tag) => [tag, anonymousManifest(entry.name, tag).digest]))]));
  if (imagesToPromote(entries, currentDigests(), promoted).length === 0) {
    console.log(`The stable and ${minor} images are already on ${version}.`);
    return;
  }
  const latest = latestVersion([...tags.keys(), tagOf(version)]);
  if (latest !== version) throw new InputError(`${latest} is newer than ${version}: the stable images never move back`);
  // gh prints the URL of the run it started when GitHub returns it. Otherwise the run is the new
  // one titled "promote <version>" (run-name of the workflow): the runs listed before the
  // dispatch are left out, which needs no clock.
  const known = JSON.parse(read('gh', list)).map((run) => run.databaseId);
  const id = runIdFromDispatch(write('gh', dispatch));
  const run = id
    ? JSON.parse(read('gh', ['run', 'view', String(id), '--repo', repo, '--json', RUN_FIELDS]))
    : findRun(list, (candidate) => pickPromotionRun([candidate], version, known) !== null);
  if (!run) throw new Error(`the promotion run of ${IMAGE_WORKFLOW} did not appear after ${RUN_APPEAR_SECONDS} seconds: check the Actions tab, then rerun publish`);
  waitRun(run, (url) => `the promotion of the images failed, stable was not moved: ${url}`);
  const left = imagesToPromote(entries, currentDigests(), promoted);
  if (left.length) throw new Error(`after ${run.url}, stable or ${minor} is still not on ${version} for ${left.join(', ')}: find out why, then rerun publish`);
  console.log(`stable and ${minor} images on ${version} (${run.url}).`);
}

function publish(root, options) {
  const { version } = options;
  const tag = tagOf(version);
  console.log(`${dryRun ? 'Dry run: nothing is written. ' : ''}Publishing ${version}.`);

  checkGh();
  read('git', ['fetch', 'origin', '--tags'], root);

  // 1. The merge commit of the release pull request.
  const title = `Release ${version}`;
  const found = JSON.parse(read('gh', ['pr', 'list', '--repo', repo, '--state', 'merged', '--search', `${title} in:title`, '--json', 'number,title,mergeCommit']));
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
  // --no-images would move the stable branch while the stable images stay on an older version.
  const workflowFile = `.github/workflows/${IMAGE_WORKFLOW}`;
  if (!options.images && probe('git', ['cat-file', '-e', `${sha}:${workflowFile}`], root).status === 0) {
    throw new InputError(`--no-images is for a version older than the image workflow, and ${sha} holds ${workflowFile}. `
      + `Without a run for the tag, start it: ${show('gh', ['workflow', 'run', IMAGE_WORKFLOW, '--repo', repo, '--ref', tag])}; `
      + `after a failed run, rerun its failed jobs. Then rerun publish ${version} without --no-images.`);
  }

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

  // 5. The images of the tag, published by the CI and public.
  let images = null;
  if (options.images) {
    images = waitForImages(version, tag, sha);
  } else {
    console.log('Images skipped (--no-images): the release gets no Images section and the stable images do not move.');
  }
  const section = images ? imagesSection(images, repo, version) : null;
  if (section && dryRun) console.log(`Images section of the release notes:\n\n${section}\n`);

  // 6. The GitHub release, its notes ending with the Images section.
  let releaseUrl;
  const viewArgs = ['release', 'view', tag, '--repo', repo, '--json', 'url,body'];
  const view = probe('gh', viewArgs);
  const notesFileWith = (text) => {
    if (dryRun) return path.join(tmpdir(), `kanap-release-${tag}-notes.md`);
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'kanap-release-')), 'notes.md');
    writeFileSync(file, text);
    return file;
  };
  if (view.status === 0) {
    const existing = JSON.parse(view.stdout);
    releaseUrl = existing.url;
    if (!section || hasImagesSection(existing.body)) {
      console.log(`Release ${tag} already exists: kept.`);
    } else {
      console.log(`Release ${tag} exists without the Images section: ${dryRun ? 'it would be completed' : 'completed'}.`);
      const notesFile = notesFileWith(`${String(existing.body ?? '').trimEnd()}\n\n${section}\n`);
      write('gh', ['release', 'edit', tag, '--repo', repo, '--notes-file', notesFile]);
      if (!dryRun) rmSync(path.dirname(notesFile), { recursive: true, force: true });
    }
  } else if (/not found/i.test(view.stderr)) {
    const notesFile = notesFileWith(`${entry.body}\n${section ? `\n${section}\n` : ''}`);
    const out = write('gh', ['release', 'create', tag, '--repo', repo, '--title', entry.title, '--notes-file', notesFile]);
    if (!dryRun) rmSync(path.dirname(notesFile), { recursive: true, force: true });
    releaseUrl = out?.trim().split('\n').pop();
  } else {
    throw failure('gh', viewArgs, null, view);
  }

  // 7. The component inventory.
  const attached = options.sbom ? sbom(root, tag) : [];
  if (!options.sbom) console.log('Inventory skipped (--no-sbom).');

  // stable must be fast-forwardable before any stable tag moves.
  const stable = remoteBranch(root, 'stable');
  if (stable && stable !== sha && !isAncestor(root, stable, sha)) {
    throw new InputError(`stable (${stable}) is not an ancestor of ${sha}: stable must be fast-forwardable to the new version. Find out why it moved before publishing.`);
  }

  // 8. The stable and YY.M images on the version.
  if (images) promoteImages(version, images, tags);

  // 9. The stable branch, fast-forward only.
  if (stable === sha) {
    console.log(`stable already on ${sha}.`);
  } else {
    write('git', ['push', 'origin', `${sha}:refs/heads/stable`], { cwd: root });
  }

  console.log(`\n${dryRun ? 'Dry run done. Would publish' : 'Published'} ${version}:`);
  console.log(`  tag:      ${tag} -> ${sha}`);
  console.log(`  images:   ${images ? images.map((item) => item.ref).join('\n            ') : 'none (--no-images)'}`);
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
  const origin = exec('git', ['remote', 'get-url', 'origin'], { cwd: root });
  repo = (origin.status === 0 && githubRepoOf(origin.stdout)) || DEFAULT_REPO;
  if (repo !== DEFAULT_REPO) console.log(`GitHub repository: ${repo} (from origin).`);
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
