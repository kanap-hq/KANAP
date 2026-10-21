// node --test scripts/release/__tests__/*.test.mjs
//
// release.mjs against a throwaway repository: a bare "origin", a clone the script runs in, and a
// fake gh first on PATH that answers from canned JSON and logs every call. Nothing reaches GitHub.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { curatedStaleWarning } from '../release.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'release.mjs');
const ROOT = path.resolve(HERE, '..', '..', '..');
const work = mkdtempSync(path.join(tmpdir(), 'kanap-release-'));
after(() => rmSync(work, { recursive: true, force: true }));

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

const FAKE_GH = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const line = args.join(' ');
const dir = process.env.FAKE_GH_DIR;
fs.appendFileSync(path.join(dir, 'calls.log'), line + '\\n');
const answers = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
const released = path.join(dir, 'released');
const out = (value) => process.stdout.write(typeof value === 'string' ? value + '\\n' : JSON.stringify(value));
if (line === 'auth status') process.exit(0);
else if (line.startsWith('pr list') && line.includes('--state merged')) out(answers.merged ?? []);
else if (line.startsWith('pr list') && line.includes('--head')) out(answers.open ?? []);
else if (args[0] === 'pr' && args[1] === 'view' && answers.prs?.[args[2]]) out(answers.prs[args[2]]);
else if (line.startsWith('pr create')) out('https://github.com/kanap-hq/KANAP/pull/9');
else if (line.startsWith('release view') && fs.existsSync(released)) out({ url: 'https://github.com/kanap-hq/KANAP/releases/tag/' + args[2] });
else if (line.startsWith('release view')) { process.stderr.write('release not found\\n'); process.exit(1); }
else if (line.startsWith('release create')) { fs.writeFileSync(released, line); out('https://github.com/kanap-hq/KANAP/releases/tag/' + args[2]); }
else if (line.startsWith('release upload')) process.exit(0);
else { process.stderr.write('fake gh: unexpected call: ' + line + '\\n'); process.exit(3); }
`;

let counter = 0;

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function setVersion(dir, version) {
  for (const folder of ['backend', 'frontend']) {
    writeJson(path.join(dir, folder, 'package.json'), { name: `kanap-${folder}`, version, license: 'AGPL-3.0-only' });
    writeJson(path.join(dir, folder, 'package-lock.json'), {
      name: `kanap-${folder}`, version, lockfileVersion: 3, requires: true,
      packages: { '': { name: `kanap-${folder}`, version, license: 'AGPL-3.0-only' } },
    });
  }
}

function commit(dir, subject, files = {}) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', subject);
  return git(dir, 'rev-parse', 'HEAD');
}

const ENTRY = '## 26.10.1 (2026-10-11) · Action required\n\nFirst version.\n\n### Changes\n- Faster lists\n\n### On-premise\n- Action required: set `APP_BASE_URL`.\n';

// origin (bare) <- seed: #1 initial import, #2 a feature with a migration, #3 the release commit
// of 26.10.1. The script runs in a fresh clone; the release worktrees land next to it.
function fixture({ tags = {}, stable = null } = {}) {
  const base = path.join(work, `case-${(counter += 1)}`);
  const bare = path.join(base, 'origin.git');
  const seed = path.join(base, 'seed');
  const clone = path.join(base, 'repo');
  const ghDir = path.join(base, 'gh');
  const bin = path.join(base, 'bin');
  mkdirSync(seed, { recursive: true });
  mkdirSync(ghDir);
  mkdirSync(bin);
  git(base, 'init', '-q', '--bare', '-b', 'main', bare);
  git(seed, 'init', '-q', '-b', 'main');

  setVersion(seed, '0.1.0');
  cpSync(path.join(ROOT, 'scripts', 'sbom'), path.join(seed, 'scripts', 'sbom'), { recursive: true, filter: (src) => !src.includes('__tests__') });
  writeJson(path.join(seed, 'marketing', 'web', 'package-lock.json'), { name: 'web', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'web', version: '1.0.0' } } });
  const first = commit(seed, 'Initial import (#1)', {
    'CHANGELOG.md': '# Changelog\n\nEvery published version.\n',
    'backend/src/migrations/1000-init.ts': '',
    '.github/scripts/queue-stack.sh': 'echo "queue-stack $*" >> "$FAKE_GH_DIR/queue.log"\n',
  });
  const second = commit(seed, 'Faster lists (#2)', { 'backend/src/migrations/2000-lists.ts': '' });
  const side = git(seed, 'commit-tree', '-p', first, '-m', 'Side commit', `${second}^{tree}`);
  setVersion(seed, '26.10.1');
  const release = commit(seed, 'Release 26.10.1 (#3)', { 'CHANGELOG.md': `# Changelog\n\nEvery published version.\n\n${ENTRY}` });
  const shas = { first, second, side, release };
  git(seed, 'push', '-q', bare, 'main');
  for (const [tag, at] of Object.entries(tags)) {
    git(seed, 'tag', '-a', tag, '-m', tag, shas[at]);
    git(seed, 'push', '-q', bare, tag);
  }
  if (stable) git(seed, 'push', '-q', bare, `${shas[stable]}:refs/heads/stable`);
  git(base, 'clone', '-q', bare, clone);

  writeFileSync(path.join(bin, 'gh'), FAKE_GH);
  chmodSync(path.join(bin, 'gh'), 0o755);
  const answer = (changes = {}) => writeJson(path.join(ghDir, 'answers.json'), {
    merged: [{ number: 3, title: 'Release 26.10.1', mergeCommit: { oid: release } }, { number: 30, title: 'Release 26.10.12', mergeCommit: { oid: second } }],
    prs: {
      2: { number: 2, title: 'Faster lists', body: '## Changes\n\nx\n\n## Release notes\n\n- Budget lists open faster.\n\n## Verification\n' },
      3: { number: 3, title: 'Release 26.10.1', body: ENTRY },
    },
    ...changes,
  });
  answer();

  const env = { ...process.env, ...GIT_ENV, FAKE_GH_DIR: ghDir, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  return {
    base, bare, clone, shas, answer,
    run: (...args) => {
      const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: clone, encoding: 'utf8', env });
      return { status: result.status, output: `${result.stdout}${result.stderr}` };
    },
    calls: () => (existsSync(path.join(ghDir, 'calls.log')) ? readFileSync(path.join(ghDir, 'calls.log'), 'utf8') : ''),
    queued: () => (existsSync(path.join(ghDir, 'queue.log')) ? readFileSync(path.join(ghDir, 'queue.log'), 'utf8') : ''),
    remote: (ref) => spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: bare, encoding: 'utf8' }).stdout.trim(),
  };
}

describe('publish', () => {
  it('prints the tag on the merge commit, the release and the stable push under --dry-run', () => {
    const repo = fixture({ tags: { 'v26.9.1': 'first' }, stable: 'first' });
    const { status, output } = repo.run('publish', '26.10.1', '--dry-run');
    assert.equal(status, 0, output);
    const sha = repo.shas.release;
    assert.match(output, new RegExp(`would run: \\(cd \\S+ && git tag -a v26\\.10\\.1 -m "KANAP 26\\.10\\.1" ${sha}\\)`));
    assert.match(output, /would run: \(cd \S+ && git push origin v26\.10\.1\)/);
    assert.match(output, /would run: gh release create v26\.10\.1 --repo kanap-hq\/KANAP --title "KANAP 26\.10\.1 · Action required" --notes-file /);
    assert.match(output, /would run: \(cd \S+ && git worktree add --detach \S+ v26\.10\.1\)/);
    assert.match(output, /would run: \(cd \S+ && node scripts\/sbom\/generate\.mjs --out \S+\)/);
    assert.match(output, /would run: gh release upload v26\.10\.1 \S+ --clobber --repo kanap-hq\/KANAP/);
    assert.match(output, new RegExp(`would run: \\(cd \\S+ && git push origin ${sha}:refs/heads/stable\\)`));
    assert.match(output, /Warning: merged since v26\.9\.1 and not cited in the entry: #2\n/);
    assert.equal(repo.remote('v26.10.1'), '');
    assert.equal(repo.remote('stable'), repo.shas.first);
    assert.doesNotMatch(repo.calls(), /release create|release upload/);
  });

  it('tags, releases, attaches the inventory and creates stable, then keeps everything on a rerun', () => {
    const repo = fixture();
    const first = repo.run('publish', '26.10.1');
    assert.equal(first.status, 0, first.output);
    assert.equal(repo.remote('v26.10.1'), repo.shas.release);
    assert.equal(repo.remote('stable'), repo.shas.release);
    assert.match(repo.calls(), /^release create v26\.10\.1 --repo kanap-hq\/KANAP --title KANAP 26\.10\.1 · Action required --notes-file \S+$/m);
    const upload = repo.calls().split('\n').find((line) => line.startsWith('release upload'));
    for (const file of ['sbom-backend.cdx.json', 'sbom-frontend.cdx.json', 'sbom-marketing-web.cdx.json', 'THIRD-PARTY-NOTICES.txt']) {
      assert.ok(upload.includes(`/${file}`), `${file} uploaded: ${upload}`);
    }
    assert.match(upload, / --clobber --repo kanap-hq\/KANAP$/);
    assert.equal(git(repo.clone, 'worktree', 'list').split('\n').length, 1, 'the inventory worktree is removed');

    const again = repo.run('publish', '26.10.1', '--no-sbom');
    assert.equal(again.status, 0, again.output);
    assert.match(again.output, /Tag v26\.10\.1 already on/);
    assert.match(again.output, /Release v26\.10\.1 already exists: kept\./);
    assert.match(again.output, /stable already on/);
    assert.equal(repo.calls().match(/release create/g).length, 1);
  });

  it('refuses a release commit whose package.json has another version', () => {
    const repo = fixture();
    repo.answer({ merged: [{ number: 3, title: 'Release 26.10.1', mergeCommit: { oid: repo.shas.second } }] });
    const { status, output } = repo.run('publish', '26.10.1', '--dry-run');
    assert.equal(status, 2, output);
    assert.match(output, /backend\/package\.json is at 0\.1\.0 in [0-9a-f]+, not 26\.10\.1/);
  });

  it('never moves a tag that points at another commit', () => {
    const repo = fixture({ tags: { 'v26.10.1': 'second' } });
    const { status, output } = repo.run('publish', '26.10.1', '--dry-run');
    assert.equal(status, 2, output);
    assert.match(output, /the tag v26\.10\.1 already points at [0-9a-f]+, not at [0-9a-f]+: a tag is never moved/);
  });

  it('stops when stable cannot be fast-forwarded to the new version', () => {
    const repo = fixture({ stable: 'side' });
    const { status, output } = repo.run('publish', '26.10.1', '--dry-run', '--no-sbom');
    assert.equal(status, 2, output);
    assert.match(output, /stable \([0-9a-f]+\) is not an ancestor of [0-9a-f]+: stable must be fast-forwardable/);
    assert.doesNotMatch(output, /would run: .*refs\/heads\/stable/);
  });

  it('stops when no release pull request has merged', () => {
    const repo = fixture();
    repo.answer({ merged: [] });
    const { status, output } = repo.run('publish', '26.10.1', '--dry-run');
    assert.equal(status, 2, output);
    assert.match(output, /no merged pull request is titled "Release 26\.10\.1"/);
  });
});

describe('prepare', () => {
  it('needs --since for the first release', () => {
    const { status, output } = fixture().run('prepare', '26.10.2', '--dry-run');
    assert.equal(status, 2, output);
    assert.match(output, /the first release needs --since <ref>/);
  });

  it('refuses a version that is not above the latest tag', () => {
    const { status, output } = fixture({ tags: { 'v26.10.1': 'release' } }).run('prepare', '26.10.1', '--dry-run');
    assert.equal(status, 2, output);
    assert.match(output, /26\.10\.1 must be greater than the latest version, 26\.10\.1/);
  });

  it('prints the worktree and version commands and lists the notes under --dry-run', () => {
    const repo = fixture();
    const { status, output } = repo.run('prepare', '26.10.2', '--since', repo.shas.first, '--dry-run');
    assert.equal(status, 0, output);
    assert.match(output, /would run: \(cd \S+ && git worktree add \S+kanap-release\/v26\.10\.2 -b release\/v26\.10\.2 origin\/main\)/);
    assert.match(output, /would run: \(cd \S+\/v26\.10\.2\/backend && npm version 26\.10\.2 --no-git-tag-version\)/);
    assert.match(output, /would run: \(cd \S+\/v26\.10\.2\/frontend && npm version 26\.10\.2 --no-git-tag-version\)/);
    assert.match(output, /- Migrations: run automatically at start \(2000-lists\)\./);
    assert.match(output, /### #2 Faster lists\n\n- Budget lists open faster\.\n/);
    assert.match(output, /## Without a release notes section\n\n### #3 Release 26\.10\.1\n\n_No release notes section\._/);
    assert.match(output, /2 pull requests merged since [0-9a-f]+: 1 with a release notes section, 1 without\./);
    assert.equal(existsSync(path.join(repo.base, 'kanap-release')), false);
  });

  it('bumps, waits for a written entry, then commits, pushes, opens and queues the pull request', () => {
    const repo = fixture({ tags: { 'v26.10.1': 'release' } });
    const dir = path.join(repo.base, 'kanap-release', 'v26.10.2');
    const first = repo.run('prepare', '26.10.2', '--since', 'ignored');
    assert.equal(first.status, 0, first.output);
    assert.match(first.output, /Notice: --since is ignored/);
    for (const folder of ['backend', 'frontend']) {
      assert.equal(JSON.parse(readFileSync(path.join(dir, folder, 'package.json'), 'utf8')).version, '26.10.2');
      assert.equal(JSON.parse(readFileSync(path.join(dir, folder, 'package-lock.json'), 'utf8')).version, '26.10.2');
    }
    const changelog = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /\n## 26\.10\.2 \(\d{4}-\d{2}-\d{2}\)\n\nOne or two lines[^]*- Migrations: none\n- Recommended: none\n\n## 26\.10\.1 /);
    assert.match(readFileSync(path.join(repo.base, 'kanap-release', 'v26.10.2-release-notes.md'), 'utf8'), /merged since v26\.10\.1: 0 /);

    const empty = repo.run('prepare', '26.10.2', '--commit');
    assert.equal(empty.status, 2, empty.output);
    assert.match(empty.output, /the 26\.10\.2 entry is still empty/);

    writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog.replace('### Fixes\n', '### Fixes\n- Exports keep their dates (#4)\n'));
    const dry = repo.run('prepare', '26.10.2', '--commit', '--dry-run');
    assert.equal(dry.status, 0, dry.output);
    assert.match(dry.output, /would run: \(cd \S+ && git commit -m "Release 26\.10\.2"\)/);
    assert.match(dry.output, /would run: \(cd \S+ && gh pr create --repo kanap-hq\/KANAP --base main --head release\/v26\.10\.2 --title "Release 26\.10\.2" --body-file \S+\)/);
    assert.equal(repo.remote('release/v26.10.2'), '');
    const done = repo.run('prepare', '26.10.2', '--commit');
    assert.equal(done.status, 0, done.output);
    assert.match(done.output, /CHANGELOG\.md already has the 26\.10\.2 entry: kept\./);
    assert.equal(git(repo.bare, 'log', '-1', '--format=%s', 'release/v26.10.2'), 'Release 26.10.2');
    assert.equal(JSON.parse(git(repo.bare, 'show', 'release/v26.10.2:frontend/package-lock.json')).packages[''].version, '26.10.2');
    assert.match(repo.calls(), /^pr create --repo kanap-hq\/KANAP --base main --head release\/v26\.10\.2 --title Release 26\.10\.2 --body-file \S+$/m);
    assert.equal(repo.queued(), 'queue-stack 9\n');
    assert.match(done.output, /Release pull request: https:\/\/github\.com\/kanap-hq\/KANAP\/pull\/9/);
  });
});

describe('curated catalog age', () => {
  // 2026-06-23 is 120 days before 2026-10-21; 2026-06-22 is 121.
  it('stays quiet at 120 days and names whatever is older', () => {
    assert.equal(curatedStaleWarning([{ key: 'fresh', checkedOn: '2026-06-23' }], '2026-10-21'), null);
    assert.equal(curatedStaleWarning([{ key: 'fresh', checkedOn: '2026-10-20' }], '2026-10-21'), null);
    assert.equal(
      curatedStaleWarning([
        { key: 'zeta', checkedOn: '2026-06-22' },
        { key: 'alpha', checkedOn: '2026-10-20' },
        { key: 'mid', checkedOn: null },
      ], '2026-10-21'),
      'Warning: curated catalog: 2 product(s) checked more than 120 days ago: mid, zeta (run the technology-catalog-curation skill)',
    );
    assert.equal(curatedStaleWarning([], '2026-10-21'), null);
  });

  it('prepare warns from the oldest checked_on and still exits 0', () => {
    const repo = fixture();
    const dir = path.join(repo.clone, 'backend/src/technologies/catalog/curated');
    const today = new Date().toISOString().slice(0, 10);
    writeJson(path.join(dir, 'old-os.json'), { versions: [{ checked_on: '2020-01-01' }] });
    writeJson(path.join(dir, 'mixed.json'), { versions: [{ checked_on: today }, { checked_on: '2020-01-02' }] });
    writeJson(path.join(dir, 'fresh.json'), { versions: [{ checked_on: today }] });
    writeFileSync(path.join(dir, 'broken.json'), '{');
    const { status, output } = repo.run('prepare', '26.10.2', '--since', repo.shas.first, '--dry-run');
    assert.equal(status, 0, output);
    assert.match(output, /Warning: curated catalog: 3 product\(s\) checked more than 120 days ago: broken, mixed, old-os \(run the technology-catalog-curation skill\)/);
    assert.equal(existsSync(path.join(repo.base, 'kanap-release')), false);
  });
});
