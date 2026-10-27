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
import {
  curatedStaleWarning, githubRepoOf, hasImagesSection, imagesSection, imagesToPromote, isImageTag, parseDigests,
  pickPromotionRun, runIdFromDispatch,
} from '../release.mjs';

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
const dispatched = path.join(dir, 'dispatched');
const out = (value) => process.stdout.write(typeof value === 'string' ? value + '\\n' : JSON.stringify(value));
const notes = () => fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
const runs = [...(answers.imageRuns ?? []), ...(answers.mainRunsBefore ?? []), ...(answers.promoteRuns ?? [])];
if (line === 'auth status') process.exit(0);
else if (line.startsWith('pr list') && line.includes('--state merged')) out(answers.merged ?? []);
else if (line.startsWith('pr list') && line.includes('--head')) out(answers.open ?? []);
else if (args[0] === 'pr' && args[1] === 'view' && answers.prs?.[args[2]]) out(answers.prs[args[2]]);
else if (line.startsWith('pr create')) out('https://github.com/kanap-hq/KANAP/pull/9');
else if (line.startsWith('release view') && fs.existsSync(released)) out({ url: 'https://github.com/kanap-hq/KANAP/releases/tag/' + args[2], body: fs.readFileSync(released, 'utf8') });
else if (line.startsWith('release view')) { process.stderr.write('release not found\\n'); process.exit(1); }
else if (line.startsWith('release create')) { fs.writeFileSync(released, notes()); out('https://github.com/kanap-hq/KANAP/releases/tag/' + args[2]); }
else if (line.startsWith('release edit')) fs.writeFileSync(released, notes());
else if (line.startsWith('release upload')) process.exit(0);
else if (line.startsWith('run list') && line.includes('--branch main --event workflow_dispatch')) out([...(answers.mainRunsBefore ?? []), ...(fs.existsSync(dispatched) ? answers.promoteRuns ?? [] : [])]);
else if (line.startsWith('run list')) out(answers.imageRuns ?? []);
else if (args[0] === 'run' && args[1] === 'view' && runs.some((run) => String(run.databaseId) === args[2])) out(runs.find((run) => String(run.databaseId) === args[2]));
else if (args[0] === 'run' && args[1] === 'download') fs.writeFileSync(path.join(args[args.indexOf('--dir') + 1], 'digests.txt'), answers.digests ?? '');
else if (line.startsWith('workflow run')) { fs.writeFileSync(dispatched, line); if (answers.dispatchOutput) out(answers.dispatchOutput); }
else { process.stderr.write('fake gh: unexpected call: ' + line + '\\n'); process.exit(3); }
`;

// ghcr.io as an anonymous client sees it: a pull token, then the manifest of <image>:<tag>. A
// version tag is on DIGESTS[image] unless the image is in answers.private; the stable and YY.M
// tags are on it once the promotion has been dispatched, on answers.preset[image][tag] before.
const FAKE_CURL = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.FAKE_GH_DIR;
const url = process.argv[process.argv.length - 1];
fs.appendFileSync(path.join(dir, 'curl.log'), url + '\\n');
const answers = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
if (url.startsWith('https://ghcr.io/token?')) { process.stdout.write('{"token":"anonymous"}\\n200'); process.exit(0); }
const match = /^https:\\/\\/ghcr\\.io\\/v2\\/[^/]+\\/([^/]+)\\/manifests\\/(.+)$/.exec(url);
if (!match) { process.stderr.write('fake curl: unexpected url ' + url + '\\n'); process.exit(3); }
const [, image, tag] = match;
let digest = null;
if (tag === 'stable' || /^\\d+\\.\\d+$/.test(tag)) digest = fs.existsSync(path.join(dir, 'dispatched')) ? answers.registry?.[image] : answers.preset?.[image]?.[tag] ?? null;
else if (!(answers.private ?? []).includes(image)) digest = answers.registry?.[image];
if ((answers.private ?? []).includes(image)) process.stdout.write('HTTP/2 401\\r\\n\\r\\n');
else if (digest) process.stdout.write('HTTP/2 200\\r\\ndocker-content-digest: ' + digest + '\\r\\n\\r\\n');
else process.stdout.write('HTTP/2 404\\r\\n\\r\\n');
`;

const IMAGES = ['kanap-api', 'kanap-api-tools', 'kanap-web', 'kanap-marketing'];
const DIGESTS = Object.fromEntries(IMAGES.map((image, i) => [image, `sha256:${String(i + 1).repeat(64)}`]));
const digestsTxt = (version) => IMAGES.map((image) => `${image} ${version} ghcr.io/kanap-hq/${image}@${DIGESTS[image]}`).join('\n');

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
function fixture({ tags = {}, stable = null, workflow = false } = {}) {
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
  const release = commit(seed, 'Release 26.10.1 (#3)', {
    'CHANGELOG.md': `# Changelog\n\nEvery published version.\n\n${ENTRY}`,
    ...(workflow ? { '.github/workflows/release-images.yml': 'name: Release images\n' } : {}),
  });
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
  writeFileSync(path.join(bin, 'curl'), FAKE_CURL);
  chmodSync(path.join(bin, 'curl'), 0o755);
  const run = (databaseId, extra) => ({ databaseId, status: 'completed', conclusion: 'success', url: `https://github.com/kanap-hq/KANAP/actions/runs/${databaseId}`, ...extra });
  const answer = (changes = {}) => writeJson(path.join(ghDir, 'answers.json'), {
    merged: [{ number: 3, title: 'Release 26.10.1', mergeCommit: { oid: release } }, { number: 30, title: 'Release 26.10.12', mergeCommit: { oid: second } }],
    prs: {
      2: { number: 2, title: 'Faster lists', body: '## Changes\n\nx\n\n## Release notes\n\n- Budget lists open faster.\n\n## Verification\n' },
      3: { number: 3, title: 'Release 26.10.1', body: ENTRY },
    },
    imageRuns: [run(10, { headSha: second, event: 'push', createdAt: '2026-10-27T09:00:00Z' }), run(11, { headSha: release, event: 'push', createdAt: '2026-10-27T10:00:00Z' })],
    promoteRuns: [run(12, { headSha: release, event: 'workflow_dispatch', displayTitle: 'promote 26.10.1', createdAt: '2026-10-27T11:00:00Z' })],
    digests: digestsTxt('26.10.1'),
    registry: DIGESTS,
    ...changes,
  });
  answer();

  const env = { ...process.env, ...GIT_ENV, FAKE_GH_DIR: ghDir, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  return {
    base, bare, clone, shas, answer, ghRun: run,
    release: (body) => writeFileSync(path.join(ghDir, 'released'), body),
    notes: () => readFileSync(path.join(ghDir, 'released'), 'utf8'),
    run: (...args) => {
      const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: clone, encoding: 'utf8', env });
      return { status: result.status, output: `${result.stdout}${result.stderr}` };
    },
    calls: () => (existsSync(path.join(ghDir, 'calls.log')) ? readFileSync(path.join(ghDir, 'calls.log'), 'utf8') : ''),
    curls: () => (existsSync(path.join(ghDir, 'curl.log')) ? readFileSync(path.join(ghDir, 'curl.log'), 'utf8') : ''),
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
    assert.match(output, new RegExp(`would wait for the run of release-images\\.yml on ${sha}: gh run list --repo kanap-hq/KANAP --workflow release-images\\.yml --branch v26\\.10\\.1 --json `));
    assert.match(output, /would run: gh run download "<run>" --repo kanap-hq\/KANAP --name image-digests /);
    assert.match(output, /\| `kanap-marketing` \| `ghcr\.io\/kanap-hq\/kanap-marketing@sha256:<digest>` \|\n\nProvenance: `gh attestation verify oci:\/\/ghcr\.io\/kanap-hq\/kanap-api@sha256:<digest> -R kanap-hq\/KANAP --signer-workflow kanap-hq\/KANAP\/\.github\/workflows\/release-images\.yml --source-ref refs\/tags\/v26\.10\.1`/);
    assert.match(output, /would run, unless every stable and 26\.10 tag is already on the version: gh workflow run release-images\.yml --repo kanap-hq\/KANAP --ref main -f promote=26\.10\.1\n/);
    // Order: tag, images, release, inventory, promotion, stable.
    const order = ['git push origin v26.10.1', 'would wait for the run', 'gh release create', 'gh release upload', 'gh workflow run', ':refs/heads/stable'].map((text) => output.indexOf(text));
    assert.deepEqual(order.slice().sort((a, b) => a - b), order, `steps in order: ${order}`);
    assert.ok(!order.includes(-1), `every step printed: ${order}`);
    assert.equal(repo.remote('v26.10.1'), '');
    assert.equal(repo.remote('stable'), repo.shas.first);
    assert.doesNotMatch(repo.calls(), /release create|release upload|run list|workflow run/);
    assert.equal(repo.curls(), '');
  });

  it('waits for the images, releases them with their digests, promotes them and creates stable, then keeps everything on a rerun', () => {
    const repo = fixture();
    const first = repo.run('publish', '26.10.1');
    assert.equal(first.status, 0, first.output);
    assert.equal(repo.remote('v26.10.1'), repo.shas.release);
    assert.equal(repo.remote('stable'), repo.shas.release);
    assert.match(repo.calls(), /^run list --repo kanap-hq\/KANAP --workflow release-images\.yml --branch v26\.10\.1 --json /m);
    assert.match(repo.calls(), /^run download 11 --repo kanap-hq\/KANAP --name image-digests --dir \S+$/m);
    assert.match(repo.curls(), /^https:\/\/ghcr\.io\/v2\/kanap-hq\/kanap-web\/manifests\/26\.10\.1$/m);
    assert.match(repo.calls(), /^release create v26\.10\.1 --repo kanap-hq\/KANAP --title KANAP 26\.10\.1 · Action required --notes-file \S+$/m);
    const notes = repo.notes();
    assert.ok(notes.startsWith('First version.'), notes);
    assert.ok(notes.endsWith(`| \`kanap-marketing\` | \`ghcr.io/kanap-hq/kanap-marketing@${DIGESTS['kanap-marketing']}\` |\n\nProvenance: \`gh attestation verify oci://ghcr.io/kanap-hq/kanap-api@${DIGESTS['kanap-api']} -R kanap-hq/KANAP --signer-workflow kanap-hq/KANAP/.github/workflows/release-images.yml --source-ref refs/tags/v26.10.1\`\n`), notes);
    const upload = repo.calls().split('\n').find((line) => line.startsWith('release upload'));
    for (const file of ['sbom-backend.cdx.json', 'sbom-frontend.cdx.json', 'sbom-marketing-web.cdx.json', 'THIRD-PARTY-NOTICES.txt']) {
      assert.ok(upload.includes(`/${file}`), `${file} uploaded: ${upload}`);
    }
    assert.match(upload, / --clobber --repo kanap-hq\/KANAP$/);
    assert.match(repo.calls(), /^workflow run release-images\.yml --repo kanap-hq\/KANAP --ref main -f promote=26\.10\.1$/m);
    assert.match(first.output, /stable and 26\.10 images on 26\.10\.1 \(https:\/\/github\.com\/kanap-hq\/KANAP\/actions\/runs\/12\)/);
    assert.equal(git(repo.clone, 'worktree', 'list').split('\n').length, 1, 'the inventory worktree is removed');

    const again = repo.run('publish', '26.10.1', '--no-sbom');
    assert.equal(again.status, 0, again.output);
    assert.match(again.output, /Tag v26\.10\.1 already on/);
    assert.match(again.output, /Release v26\.10\.1 already exists: kept\./);
    assert.match(again.output, /The stable and 26\.10 images are already on 26\.10\.1\./);
    assert.match(again.output, /stable already on/);
    assert.equal(repo.calls().match(/release create/g).length, 1);
    assert.equal(repo.calls().match(/workflow run/g).length, 1);
    assert.doesNotMatch(repo.calls(), /release edit/);
  });

  it('completes a release created without the Images section instead of creating it again', () => {
    const repo = fixture({ tags: { 'v26.10.1': 'release' } });
    repo.release('First version.\n');
    const { status, output } = repo.run('publish', '26.10.1', '--no-sbom');
    assert.equal(status, 0, output);
    assert.match(output, /Release v26\.10\.1 exists without the Images section: completed\./);
    assert.match(repo.calls(), /^release edit v26\.10\.1 --repo kanap-hq\/KANAP --notes-file \S+$/m);
    assert.doesNotMatch(repo.calls(), /release create/);
    assert.match(repo.notes(), /^First version\.\n\n### Images\n\n\| Image \| Reference \|\n/);
  });

  it('stops before the release when the image workflow failed', () => {
    const repo = fixture();
    repo.answer({ imageRuns: [repo.ghRun(11, { headSha: repo.shas.release, event: 'push', createdAt: '2026-10-27T10:00:00Z', conclusion: 'failure' })] });
    const { status, output } = repo.run('publish', '26.10.1', '--no-sbom');
    assert.equal(status, 1, output);
    assert.match(output, /the image workflow failed, the release was not created and stable was not moved: https:\/\/github\.com\/kanap-hq\/KANAP\/actions\/runs\/11/);
    assert.equal(repo.remote('v26.10.1'), repo.shas.release, 'the tag stays');
    assert.equal(repo.remote('stable'), '');
    assert.doesNotMatch(repo.calls(), /release create|run download|workflow run/);
  });

  it('stops with the way to make a package public when an anonymous pull fails', () => {
    const repo = fixture();
    repo.answer({ private: ['kanap-web', 'kanap-api-tools'] });
    const { status, output } = repo.run('publish', '26.10.1', '--no-sbom');
    assert.equal(status, 2, output);
    assert.match(output, /an anonymous pull of kanap-api-tools:26\.10\.1, kanap-web:26\.10\.1 fails: the package is not public\. For each one: organisation kanap-hq -> Packages -> <image> -> Package settings -> Change visibility -> Public\. Then rerun publish 26\.10\.1/);
    assert.equal(repo.remote('stable'), '');
    assert.doesNotMatch(repo.calls(), /release create|workflow run/);
  });

  it('refuses digests.txt when an image is missing', () => {
    const repo = fixture();
    repo.answer({ digests: digestsTxt('26.10.1').split('\n').slice(0, 3).join('\n') });
    const { status, output } = repo.run('publish', '26.10.1', '--no-sbom');
    assert.equal(status, 1, output);
    assert.match(output, /digests\.txt: no digest for kanap-marketing/);
    assert.doesNotMatch(repo.calls(), /release create/);
  });

  it('publishes without images under --no-images', () => {
    const repo = fixture();
    const { status, output } = repo.run('publish', '26.10.1', '--no-sbom', '--no-images');
    assert.equal(status, 0, output);
    assert.match(output, /Images skipped \(--no-images\)/);
    assert.equal(repo.remote('stable'), repo.shas.release);
    assert.doesNotMatch(repo.calls(), /run list|run download|workflow run/);
    assert.equal(repo.curls(), '');
    assert.doesNotMatch(repo.notes(), /### Images/);
  });

  it('refuses --no-images for a version whose commit holds the image workflow', () => {
    const repo = fixture({ workflow: true });
    const { status, output } = repo.run('publish', '26.10.1', '--no-sbom', '--no-images');
    assert.equal(status, 2, output);
    assert.match(output, /--no-images is for a version older than the image workflow, and [0-9a-f]+ holds \.github\/workflows\/release-images\.yml\. Without a run for the tag, start it: gh workflow run release-images\.yml --repo kanap-hq\/KANAP --ref v26\.10\.1/);
    assert.equal(repo.remote('v26.10.1'), '', 'nothing is written');
    assert.equal(repo.remote('stable'), '');
  });

  it('waits for the promotion run whose URL gh workflow run prints', () => {
    const repo = fixture();
    repo.answer({ dispatchOutput: 'https://github.com/kanap-hq/KANAP/actions/runs/12' });
    const { status, output } = repo.run('publish', '26.10.1', '--no-sbom');
    assert.equal(status, 0, output);
    assert.match(repo.calls(), /^run view 12 --repo kanap-hq\/KANAP --json databaseId,status,conclusion,url,headSha,createdAt,event,displayTitle$/m);
    assert.match(output, /stable and 26\.10 images on 26\.10\.1 \(https:\/\/github\.com\/kanap-hq\/KANAP\/actions\/runs\/12\)/);
  });

  it('without a run URL, takes the new run titled promote <version>, not an older one or another kind', () => {
    const repo = fixture();
    repo.answer({
      mainRunsBefore: [
        repo.ghRun(5, { displayTitle: 'promote 26.10.1', event: 'workflow_dispatch', conclusion: 'failure', createdAt: '2999-01-01T00:00:00Z' }),
        repo.ghRun(6, { displayTitle: 'marketing from main', event: 'workflow_dispatch', createdAt: '2999-01-02T00:00:00Z' }),
      ],
    });
    const { status, output } = repo.run('publish', '26.10.1', '--no-sbom');
    assert.equal(status, 0, output);
    assert.match(output, /\(https:\/\/github\.com\/kanap-hq\/KANAP\/actions\/runs\/12\)/);
  });

  it('promotes again when stable is on the version but YY.M is not', () => {
    const repo = fixture();
    repo.answer({ preset: Object.fromEntries(IMAGES.map((image) => [image, { stable: DIGESTS[image] }])) });
    const { status, output } = repo.run('publish', '26.10.1', '--no-sbom');
    assert.equal(status, 0, output);
    assert.match(repo.calls(), /^workflow run release-images\.yml --repo kanap-hq\/KANAP --ref main -f promote=26\.10\.1$/m);
    assert.match(repo.curls(), /\/manifests\/26\.10$/m);
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
    assert.doesNotMatch(output, /gh workflow run/, 'no stable image moves either');
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

describe('images', () => {
  const owner = 'kanap-hq';

  it('accepts only version tags vYY.M.N', () => {
    for (const tag of ['v26.10.1', 'v26.1.12', 'v27.12.3']) assert.equal(isImageTag(tag), true, tag);
    for (const tag of ['26.10.1', 'v26.10.0', 'v26.0.1', 'v26.13.1', 'v26.010.1', 'v26.10.01', 'v0.0.0-test', 'v26.10.1-rc1', 'v2026.10.1', '', null]) {
      assert.equal(isImageTag(tag), false, String(tag));
    }
  });

  it('reads digests.txt in the order of the images, whatever the order of its lines', () => {
    const text = `\n${digestsTxt('26.11.1').split('\n').reverse().join('\n')}\n`;
    const entries = parseDigests(text, '26.11.1', owner);
    assert.deepEqual(entries.map((entry) => entry.image), IMAGES);
    assert.deepEqual(entries[0], { image: 'kanap-api', ref: `ghcr.io/kanap-hq/kanap-api@${DIGESTS['kanap-api']}`, name: 'ghcr.io/kanap-hq/kanap-api', digest: DIGESTS['kanap-api'] });
  });

  it('refuses a digests.txt that does not describe the four images of the version', () => {
    const lines = digestsTxt('26.11.1').split('\n');
    const refused = (text, pattern) => assert.throws(() => parseDigests(text, '26.11.1', owner), pattern);
    refused(lines.slice(1).join('\n'), /no digest for kanap-api$/);
    refused([...lines, lines[0]].join('\n'), /kanap-api is listed twice/);
    refused(digestsTxt('26.11.2'), /kanap-api is tagged 26\.11\.2, not 26\.11\.1/);
    refused(lines.join('\n').replace('ghcr.io/kanap-hq/kanap-web@', 'ghcr.io/someone/kanap-web@'), /kanap-web points at ghcr\.io\/someone\/kanap-web@/);
    refused(lines.join('\n').replace('ghcr.io/kanap-hq/kanap-web@', 'ghcr.io/kanap-hq/kanap-api@'), /kanap-web points at ghcr\.io\/kanap-hq\/kanap-api@/);
    refused([...lines, `kanap-other 26.11.1 ghcr.io/kanap-hq/kanap-other@${DIGESTS['kanap-api']}`].join('\n'), /unknown image kanap-other/);
    refused(lines.join('\n').replace(DIGESTS['kanap-web'], 'sha256:abc'), /unexpected line "kanap-web /);
    refused(lines.join('\n').replace(`@${DIGESTS['kanap-web']}`, ':26.11.1'), /unexpected line "kanap-web /);
    refused('', /no digest for kanap-api, kanap-api-tools, kanap-web, kanap-marketing/);
  });

  it('writes the Images section from the digests', () => {
    const section = imagesSection(parseDigests(digestsTxt('26.11.1'), '26.11.1', owner), 'kanap-hq/KANAP', '26.11.1');
    assert.equal(section, [
      '### Images',
      '',
      '| Image | Reference |',
      '|---|---|',
      ...IMAGES.map((image) => `| \`${image}\` | \`ghcr.io/kanap-hq/${image}@${DIGESTS[image]}\` |`),
      '',
      `Provenance: \`gh attestation verify oci://ghcr.io/kanap-hq/kanap-api@${DIGESTS['kanap-api']} -R kanap-hq/KANAP`
        + ' --signer-workflow kanap-hq/KANAP/.github/workflows/release-images.yml --source-ref refs/tags/v26.11.1`',
    ].join('\n'));
    assert.equal(hasImagesSection(`Notes.\n\n${section}\n`), true);
    assert.equal(hasImagesSection('Notes.\n\n#### Images\n'), false);
    assert.equal(hasImagesSection(null), false);
  });

  it('promotes the images where stable or YY.M is not on the version', () => {
    const entries = parseDigests(digestsTxt('26.11.1'), '26.11.1', owner);
    const tags = ['stable', '26.11'];
    const on = (digest) => ({ stable: digest, '26.11': digest });
    const all = Object.fromEntries(IMAGES.map((image) => [image, on(DIGESTS[image])]));
    assert.deepEqual(imagesToPromote(entries, all, tags), []);
    assert.deepEqual(imagesToPromote(entries, { ...all, 'kanap-web': on(null) }, tags), ['kanap-web']);
    assert.deepEqual(imagesToPromote(entries, { ...all, 'kanap-api': on(DIGESTS['kanap-web']) }, tags), ['kanap-api']);
    // stable moved, YY.M not yet: an interrupted promotion is not taken for a finished one.
    assert.deepEqual(imagesToPromote(entries, { ...all, 'kanap-web': { stable: DIGESTS['kanap-web'], '26.11': null } }, tags), ['kanap-web']);
    assert.deepEqual(imagesToPromote(entries, { ...all, 'kanap-web': { stable: DIGESTS['kanap-web'] } }, tags), ['kanap-web']);
    assert.deepEqual(imagesToPromote(entries, {}, tags), IMAGES);
    assert.deepEqual(imagesToPromote(entries, null, tags), IMAGES);
  });

  it('reads the run id in the output of gh workflow run', () => {
    assert.equal(runIdFromDispatch('Created workflow_dispatch event for release-images.yml at main\nhttps://github.com/kanap-hq/KANAP/actions/runs/123456789\n'), 123456789);
    assert.equal(runIdFromDispatch('Created workflow_dispatch event for release-images.yml at main\n'), null);
    assert.equal(runIdFromDispatch(null), null);
  });

  it('picks the new run titled promote <version>, never one listed before the dispatch', () => {
    const run = (databaseId, displayTitle, createdAt) => ({ databaseId, displayTitle, createdAt });
    const runs = [
      run(5, 'promote 26.11.1', '2026-11-03T10:05:00Z'),
      run(6, 'marketing from main', '2026-11-03T10:06:00Z'),
      run(7, 'promote 26.11.2', '2026-11-03T10:07:00Z'),
      run(8, 'promote 26.11.1', '2026-11-03T10:04:00Z'),
    ];
    assert.equal(pickPromotionRun(runs, '26.11.1', [5])?.databaseId, 8);
    assert.equal(pickPromotionRun(runs, '26.11.1', [])?.databaseId, 5);
    assert.equal(pickPromotionRun(runs, '26.11.1', [5, 8]), null);
    assert.equal(pickPromotionRun(runs, '26.11.3', []), null);
    assert.equal(pickPromotionRun(null, '26.11.1', null), null);
  });

  it('reads the GitHub repository of a remote URL', () => {
    for (const url of ['git@github.com:kanap-hq/KANAP.git', 'https://github.com/kanap-hq/KANAP.git', 'https://github.com/kanap-hq/KANAP', 'ssh://git@github.com/kanap-hq/KANAP.git', 'git@github.com:kanap-hq/KANAP.git\n']) {
      assert.equal(githubRepoOf(url), 'kanap-hq/KANAP', url);
    }
    assert.equal(githubRepoOf('git@github.com:someone/KANAP-fork.git'), 'someone/KANAP-fork');
    for (const url of ['/tmp/origin.git', 'https://gitlab.com/kanap-hq/KANAP.git', 'https://github.com/kanap-hq', '', null]) {
      assert.equal(githubRepoOf(url), null, String(url));
    }
  });
});
