// Tests of .github/scripts/auto-queue.sh with a fake `gh` and a local `origin`.
//
// The fake gh answers the open pull requests from a JSON file, reports the failed `merge queue`
// checks listed there, and records each `gh pr merge`. Nothing reaches GitHub.
//
//   node --test .github/scripts/__tests__/auto-queue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'auto-queue.sh');
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();

// gh applies --jq itself, so the fake answers with the lines the script's --jq produces.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const statePath = process.env.FAKE_GH_STATE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
if (args[0] === 'api' && args[1] === 'graphql') {
  for (const p of state.prs) {
    console.log([p.number, p.head, !!p.draft, !!p.fork, p.author || 'kanap-it',
      !!p.queued, p.automerge || '-', p.mergeable || 'MERGEABLE'].join(' '));
  }
} else if (args[0] === 'api' && /check-runs/.test(args[1])) {
  const sha = args[1].split('/')[4];
  console.log((state.failed || []).includes(sha) ? 1 : 0);
} else if (args[0] === 'pr' && args[1] === 'merge' && args.includes('--disable-auto')) {
  state.disabled = (state.disabled || []).concat(Number(args[2]));
  fs.writeFileSync(statePath, JSON.stringify(state));
} else if (args[0] === 'pr' && args[1] === 'merge') {
  state.queuedNow = (state.queuedNow || []).concat(Number(args[2]));
  fs.writeFileSync(statePath, JSON.stringify(state));
} else {
  process.stderr.write('fake gh: unexpected call: ' + args.join(' ') + '\\n');
  process.exit(3);
}
`;

// A repository with main and three branches: a (on main), b (on a: a stack), c (on main).
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'auto-queue-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  git(root, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  git(root, 'clone', '--quiet', origin, work);
  git(work, 'checkout', '--quiet', '-b', 'main');
  const commit = (file) => {
    writeFileSync(join(work, file), file);
    git(work, 'add', file);
    git(work, 'commit', '--quiet', '-m', file);
    return git(work, 'rev-parse', 'HEAD');
  };
  commit('base');
  git(work, 'push', '--quiet', 'origin', 'main');
  const heads = {};
  git(work, 'checkout', '--quiet', '-b', 'a');
  heads.a = commit('a');
  git(work, 'checkout', '--quiet', '-b', 'b');
  heads.b = commit('b');
  git(work, 'checkout', '--quiet', '-b', 'c', 'main');
  heads.c = commit('c');
  // GitHub serves each pull request head as refs/pull/<n>/head.
  for (const [n, h] of [[1, heads.a], [2, heads.b], [3, heads.c]]) {
    git(work, 'push', '--quiet', 'origin', `${h}:refs/pull/${n}/head`);
  }
  const statePath = join(root, 'state.json');
  const run = (prs, extra = {}) => {
    writeFileSync(statePath, JSON.stringify({ prs, ...extra }));
    const r = spawnSync('bash', [SCRIPT], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...GIT_ENV,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_GH_STATE: statePath,
        GITHUB_REPOSITORY: 'owner/repo',
        AUTO_QUEUE_AUTHORS: 'kanap-it',
      },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const st = JSON.parse(readFileSync(statePath, 'utf8'));
    return { out: r.stdout, queued: st.queuedNow || [], disabled: st.disabled || [] };
  };
  return { heads, run };
}

test('queues the lowest ready pull request, one per run', (t) => {
  const { heads, run } = setup(t);
  const r = run([{ number: 1, head: heads.a }, { number: 3, head: heads.c }]);
  assert.deepEqual(r.queued, [1]);
  assert.match(r.out, /#1: queued; the others wait until it is in\./);
});

test('the next one goes once the previous one is in the queue', (t) => {
  const { heads, run } = setup(t);
  assert.deepEqual(run([{ number: 1, head: heads.a, queued: true }, { number: 3, head: heads.c }]).queued, [3]);
});

test('a pull request whose queueing is under way holds the others back', (t) => {
  const { heads, run } = setup(t);
  const r = run([{ number: 1, head: heads.a, automerge: new Date().toISOString() }, { number: 3, head: heads.c }]);
  assert.deepEqual(r.queued, []);
  assert.match(r.out, /#1: entering the merge queue/);
});

test('a queueing GitHub missed is turned off and on again after two minutes', (t) => {
  const { heads, run } = setup(t);
  const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const r = run([{ number: 1, head: heads.a, automerge: old }, { number: 3, head: heads.c }]);
  assert.deepEqual(r.disabled, [1]);
  assert.deepEqual(r.queued, [1]);
  assert.match(r.out, /#1: auto-merge on since .* and still not in the queue: turning it off and on\./);
});

test('a stacked pull request waits for the one below it, then follows it', (t) => {
  const { heads, run } = setup(t);
  // #2 contains #1, a draft: #2 must not overtake it; #3 is independent and goes.
  let r = run([{ number: 1, head: heads.a, draft: true }, { number: 2, head: heads.b }, { number: 3, head: heads.c }]);
  assert.match(r.out, /#2: waits until #1, below it in a stack, is in the merge queue\./);
  assert.deepEqual(r.queued, [3]);
  r = run([{ number: 1, head: heads.a, queued: true }, { number: 2, head: heads.b }]);
  assert.deepEqual(r.queued, [2]);
});

test('drafts, forks and other authors are left alone', (t) => {
  const { heads, run } = setup(t);
  const r = run([
    { number: 1, head: heads.a, draft: true },
    { number: 2, head: heads.b, fork: true },
    { number: 3, head: heads.c, author: 'someone' },
  ]);
  assert.deepEqual(r.queued, []);
  assert.match(r.out, /Nothing to queue\./);
});

test('one that failed in the queue or conflicts waits for a fix, and the next one goes', (t) => {
  const { heads, run } = setup(t);
  let r = run([{ number: 1, head: heads.a }, { number: 3, head: heads.c }], { failed: [heads.a] });
  assert.match(r.out, /#1: its current commit failed in the merge queue; it waits for a fix\./);
  assert.deepEqual(r.queued, [3]);
  const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  r = run([{ number: 1, head: heads.a, mergeable: 'CONFLICTING', automerge: old }, { number: 3, head: heads.c }]);
  assert.match(r.out, /#1: conflicts with main; it waits for a fix\./);
  assert.deepEqual(r.queued, [3]);
});

test('a pull request just sent keeps its place while GitHub shows it as conflicting', (t) => {
  const { heads, run } = setup(t);
  const r = run([{ number: 1, head: heads.a, mergeable: 'CONFLICTING', automerge: new Date().toISOString() }, { number: 3, head: heads.c }]);
  assert.match(r.out, /#1: entering the merge queue; the others wait until it is in\./);
  assert.deepEqual(r.queued, []);
});
