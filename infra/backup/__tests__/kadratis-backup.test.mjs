// node --test infra/backup/__tests__/*.test.mjs
//
// Runs infra/backup/kadratis-backup with fake pg_dump, runuser, rclone, age, curl and date placed
// first in PATH. The fakes note their arguments; no network, no database, no rclone or age needed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'kadratis-backup');
const ROOTS = [];
after(() => ROOTS.forEach((r) => rmSync(r, { recursive: true, force: true })));

const SECRETS = {
  BACKUP_S3_ACCESS_KEY_ID: 'WRITEKEYID0123456789',
  BACKUP_S3_SECRET_ACCESS_KEY: 'write-secret-6f1c2d9e8a7b',
  ATTACHMENTS_S3_ACCESS_KEY_ID: 'FILESKEYID0123456789',
  ATTACHMENTS_S3_SECRET_ACCESS_KEY: 'files-secret-4b3a2c1d0e9f',
  SIGNAL_PATH: 'ping-token-9d8c7b6a5f4e',
  HETZNER_API_TOKEN: 'hcloud-token-1a2b3c4d5e6f',
  HOST_SIGNAL_PATH: 'host-ping-token-0f1e2d3c',
};

// The fakes note each call in $FAKE_LOG; rclone plays a small S3 target ($FAKE_S3) and source ($FAKE_SOURCE).
const FAKES = join(dirname(fileURLToPath(import.meta.url)), 'fakes');

function setup({ settings = {}, mode = 0o600, hetznerImages = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kadratis-backup-'));
  ROOTS.push(root);
  const dir = join(root, 'fake');
  mkdirSync(dir, { recursive: true });
  const source = join(root, 'source');
  mkdirSync(join(source, 'tenant-a'), { recursive: true });
  writeFileSync(join(source, 'tenant-a', 'invoice.pdf'), 'CLEAR ATTACHMENT CONTENT');
  const conf = join(root, 'etc');
  mkdirSync(conf);
  writeFileSync(join(conf, 'app.env'), 'APP_SECRET=CLEAR CONFIG CONTENT\n');
  if (hetznerImages) writeFileSync(join(dir, 'hetzner.json'), JSON.stringify({ images: hetznerImages }));
  const values = {
    BACKUP_AGE_RECIPIENTS: 'age1qqqqtestrecipient0000000000000000000000000000000000000000',
    BACKUP_S3_ENDPOINT: 'https://s3.example.com',
    BACKUP_S3_REGION: 'example-region',
    BACKUP_S3_BUCKET: 'backup-bucket',
    BACKUP_S3_PREFIX: 'nightly',
    BACKUP_S3_ACCESS_KEY_ID: SECRETS.BACKUP_S3_ACCESS_KEY_ID,
    BACKUP_S3_SECRET_ACCESS_KEY: SECRETS.BACKUP_S3_SECRET_ACCESS_KEY,
    BACKUP_DB_NAME: 'kanap',
    ATTACHMENTS_S3_ENDPOINT: 'http://127.0.0.1:9000',
    ATTACHMENTS_S3_BUCKET: 'files-bucket',
    ATTACHMENTS_S3_ACCESS_KEY_ID: SECRETS.ATTACHMENTS_S3_ACCESS_KEY_ID,
    ATTACHMENTS_S3_SECRET_ACCESS_KEY: SECRETS.ATTACHMENTS_S3_SECRET_ACCESS_KEY,
    BACKUP_CONFIG_FILES: `"${join(conf, 'app.env')}"`,
    BACKUP_WORK_DIR: join(root, 'work'),
    BACKUP_SUCCESS_URL: `https://signal.example.com/${SECRETS.SIGNAL_PATH}`,
    ...settings,
  };
  const envFile = join(root, 'kadratis-backup.env');
  const lines = Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`);
  writeFileSync(envFile, `# test settings\n${lines.join('\n')}\n`);
  chmodSync(envFile, mode);
  return { root, dir, envFile, values, conf, work: values.BACKUP_WORK_DIR, s3: join(root, 's3'), source };
}

function run(ctx, env = {}, args = ['--env-file', ctx.envFile], command = SCRIPT) {
  const res = spawnSync(command, args, {
    encoding: 'utf8',
    env: {
      PATH: `${FAKES}:${process.env.PATH}`,
      HOME: ctx.root,
      FAKE_DIR: ctx.dir,
      FAKE_LOG: join(ctx.dir, 'calls'),
      FAKE_S3: ctx.s3,
      FAKE_SOURCE: ctx.source,
      ...env,
    },
  });
  return { ...res, output: res.stdout + res.stderr };
}

// One line per fake call: tool, settings and rclone secrets in its environment, lock descriptor.
const spy = (ctx) => read(join(ctx.dir, 'spy')).split('\n').filter(Boolean).map((l) => {
  const [tool, names, fd] = l.split('|');
  return { tool, names: names.split(' ').filter(Boolean), fd };
});
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const calls = (ctx) => read(join(ctx.dir, 'calls')).split('\n').filter(Boolean);
const curlUrls = (ctx) => read(join(ctx.dir, 'curl-urls')).split('\n').filter(Boolean);
const signals = (ctx) => curlUrls(ctx).filter((u) => u.includes(SECRETS.SIGNAL_PATH));
const hostSignals = (ctx) => curlUrls(ctx).filter((u) => u.includes(SECRETS.HOST_SIGNAL_PATH));
const hetznerCalls = (ctx) => curlUrls(ctx).filter((u) => u.includes('/images?'));

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [p.slice(base.length + 1)];
  });
}

const storedObjects = (ctx) => listFiles(ctx.s3);

// Files the work directory may hold after a run: the lock and the copy of the attachments.
function assertNoClearLeftover(ctx) {
  const left = listFiles(ctx.work).filter((f) => f !== 'kadratis-backup.lock' && !f.startsWith('files/'));
  assert.deepEqual(left, [], `left in the work directory: ${left.join(', ')}`);
  for (const f of listFiles(ctx.work)) {
    assert.doesNotMatch(read(join(ctx.work, f)), /PGDMP|CLEAR CONFIG/, `${f} holds clear data`);
  }
  for (const f of storedObjects(ctx)) {
    assert.doesNotMatch(read(join(ctx.s3, f)), /PGDMP|CLEAR/, `${f} was uploaded in the clear`);
  }
}

function assertNoSecret(text) {
  for (const [name, value] of Object.entries(SECRETS)) assert.ok(!text.includes(value), `${name} leaked`);
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString().replace(/\.\d+Z$/, '+00:00');
const HETZNER = {
  HETZNER_API_TOKEN: SECRETS.HETZNER_API_TOKEN,
  HETZNER_SERVER_ID: '4242',
  HETZNER_API_URL: 'http://127.0.0.1:9/v1',
  HETZNER_BACKUP_SUCCESS_URL: `https://signal.example.com/${SECRETS.HOST_SIGNAL_PATH}`,
};

test('a night stores three encrypted objects under a new UTC prefix, then signals once', () => {
  const ctx = setup();
  const res = run(ctx);
  assert.equal(res.status, 0, res.output);
  const objects = storedObjects(ctx).sort();
  assert.equal(objects.length, 3, objects.join(', '));
  const night = objects[0].split('/').slice(0, 3).join('/');
  assert.match(night, /^backup-bucket\/nightly\/\d{4}-\d{2}-\d{2}T\d{6}Z$/);
  assert.deepEqual(objects, ['attachments.tar.age', 'config.tar.age', 'database.dump.age'].map((n) => `${night}/${n}`));
  // The fake age wrote base64 behind a marker: decode to check what each object holds.
  const content = (name) => Buffer.from(read(join(ctx.s3, night, name)).split('\n')[1], 'base64').toString('latin1');
  assert.match(content('database.dump.age'), /PGDMP clear dump end/);
  assert.match(content('attachments.tar.age'), /CLEAR ATTACHMENT CONTENT/);
  assert.match(content('config.tar.age'), /CLEAR CONFIG CONTENT/);
  assert.equal(signals(ctx).length, 1);
  assert.match(res.stderr, /success signal sent to https:\/\/signal\.example\.com\/\.\.\./);
  assert.ok(calls(ctx).some((c) => c.startsWith('pg_dump -Fc -d kanap')));
  assert.ok(calls(ctx).some((c) => /^age -e -r age1qqqq\S+ -o /.test(c)));
  assertNoClearLeftover(ctx);
});

test('the target only sees listings and write-only uploads: no sync, move, delete or read', () => {
  const ctx = setup();
  assert.equal(run(ctx).status, 0);
  const target = calls(ctx).filter((c) => c.startsWith('rclone') && c.includes(' target:'));
  assert.ok(target.length >= 5, target.join('\n'));
  for (const c of target) {
    const sub = c.split(' ').filter((a) => !a.startsWith('--') && a !== '/dev/null')[1];
    assert.ok(['lsf', 'copyto'].includes(sub), `unexpected target command: ${c}`);
    if (sub === 'copyto') {
      assert.match(c, / --s3-no-head( |$)/);
      assert.match(c, / --s3-no-check-bucket( |$)/);
      assert.match(c, / --no-check-dest( |$)/);
      assert.match(c, / --retries 1( |$)/, 'an upload is never repeated as a whole');
      assert.match(c, /^rclone --config \/dev\/null copyto \/\S+ target:/, 'uploads go from a local file to the target');
    }
    if (sub === 'lsf') assert.match(c, / lsf --format sp --files-only target:/);
  }
  assert.equal(target.filter((c) => c.includes(' copyto ')).length, 3);
  const source = calls(ctx).filter((c) => c.includes(' source:'));
  assert.deepEqual(source.map((c) => c.split(' ')[3]), ['lsf', 'sync'], 'the attachments source is only read');
  assert.match(source[1], / sync source:files-bucket \//);
});

test('each night writes new names, and a night prefix that already exists is refused', () => {
  const ctx = setup();
  assert.equal(run(ctx, { FAKE_NIGHT: '2026-11-14T020000Z' }).status, 0);
  assert.equal(run(ctx, { FAKE_NIGHT: '2026-11-15T020000Z' }).status, 0);
  const nights = new Set(storedObjects(ctx).map((o) => o.split('/')[2]));
  assert.deepEqual([...nights].sort(), ['2026-11-14T020000Z', '2026-11-15T020000Z']);
  const uploads = calls(ctx).filter((c) => c.includes(' copyto '));
  const dests = uploads.map((c) => c.split(' ').find((a) => a.startsWith('target:')));
  assert.equal(new Set(dests).size, dests.length, 'a name was written twice');

  const before = calls(ctx).length;
  const again = run(ctx, { FAKE_NIGHT: '2026-11-15T020000Z' });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists in the target bucket/);
  assert.ok(!calls(ctx).slice(before).some((c) => c.includes(' copyto ')));
  assert.equal(signals(ctx).length, 2);
});

const FAILURES = [
  ['target unreachable', { FAKE_FAIL_LSF: '1' }, 'target check'],
  ['pg_dump fails', { FAKE_FAIL_PG_DUMP: '1' }, 'database'],
  ['attachments source fails', { FAKE_FAIL_SYNC: '1' }, 'attachments'],
  ['encryption fails', { FAKE_FAIL_AGE: '1' }, 'database'],
  ['upload refused (wrong key)', { FAKE_FAIL_COPYTO: '1' }, 'upload'],
  ['listing shows another size', { FAKE_LSF_SIZE_DELTA: '1' }, 'upload check'],
];
for (const [name, env, step] of FAILURES) {
  test(`a failed step stops the night with no signal and no clear file left: ${name}`, () => {
    const ctx = setup();
    const res = run(ctx, env);
    assert.notEqual(res.status, 0, res.output);
    assert.match(res.stderr, new RegExp(`backup FAILED during step '${step}' \\(exit \\d+\\): no success signal sent`));
    assert.equal(signals(ctx).length, 0);
    assertNoClearLeftover(ctx);
    assertNoSecret(res.output);
  });
}

test('a missing configuration file stops the night before it starts', () => {
  const ctx = setup({ settings: { BACKUP_CONFIG_FILES: '/nonexistent/kadratis.env' } });
  const res = run(ctx);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /BACKUP_CONFIG_FILES: \/nonexistent\/kadratis\.env not found/);
  assert.deepEqual(calls(ctx), []);
  assert.equal(signals(ctx).length, 0);
  assertNoClearLeftover(ctx);
});

test('a failed success signal makes the run fail, after the night is stored', () => {
  const ctx = setup();
  const res = run(ctx, { FAKE_FAIL_SIGNAL: '1' });
  assert.notEqual(res.status, 0);
  assert.equal(storedObjects(ctx).length, 3);
  assert.match(res.stderr, /stored, but the success signal to https:\/\/signal\.example\.com\/\.\.\. failed/);
  assertNoSecret(res.output);
});

test('settings readable by other users, or holding keys that do not belong here, are refused', () => {
  for (const mode of [0o644, 0o640, 0o604]) {
    const ctx = setup({ mode });
    const res = run(ctx);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /can be read by other users/);
    assert.deepEqual(calls(ctx), [], 'nothing ran');
  }
  const restore = setup({ settings: { RESTORE_S3_ACCESS_KEY_ID: 'READKEY' } });
  assert.match(run(restore).stderr, /RESTORE_S3_ACCESS_KEY_ID does not belong on this server/);
  const priv = setup({ settings: { BACKUP_AGE_RECIPIENTS: `AGE-SECRET-KEY-1${'Q'.repeat(58)}` } });
  assert.match(run(priv).stderr, /holds an age private key/);
  // The model file names the key format in a comment: that is not a key.
  const example = setup({ settings: { BACKUP_SUCCESS_URL: undefined } });
  writeFileSync(example.envFile, `# Never put the private key (AGE-SECRET-KEY-...) here\n${readFileSync(example.envFile, 'utf8')}`);
  assert.equal(run(example).status, 0);
  const unknown = setup({ settings: { BACKUP_S3_BUKET: 'typo' } });
  assert.match(run(unknown).stderr, /unknown setting BACKUP_S3_BUKET/);
  const missing = setup({ settings: { BACKUP_S3_BUCKET: undefined } });
  assert.match(run(missing).stderr, /BACKUP_S3_BUCKET is not set/);
  for (const ctx of [restore, priv, unknown, missing]) assert.deepEqual(calls(ctx), []);
});

test('the settings file is read as data, never run as shell code', () => {
  const root = mkdtempSync(join(tmpdir(), 'kadratis-backup-pwn-'));
  ROOTS.push(root);
  // A value no check refuses, carrying commands that would succeed in a writable directory.
  const value = `$(touch ${root}/a)\`touch ${root}/b\`;touch ${root}/c`;
  const ctx = setup({ settings: { BACKUP_S3_REGION: `"${value}"` } });
  const res = run(ctx);
  assert.equal(res.status, 0, res.output);
  assert.deepEqual(readdirSync(root), [], 'a command of the settings file ran');
  assert.ok(calls(ctx).some((c) => c.startsWith('rclone')), 'the night ran with that value');
});

test('a second run waits for nothing: it is refused while a night holds the lock', () => {
  const ctx = setup();
  mkdirSync(ctx.work, { recursive: true });
  const res = run(ctx, {}, ['-n', join(ctx.work, 'kadratis-backup.lock'), SCRIPT, '--env-file', ctx.envFile], 'flock');
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /another backup is running/);
  assert.ok(!calls(ctx).some((c) => c.startsWith('pg_dump') || c.includes(' copyto ')));
});

test('without Hetzner settings, the API is never called and nothing is said about it', () => {
  const ctx = setup();
  const res = run(ctx);
  assert.equal(res.status, 0);
  assert.deepEqual(hetznerCalls(ctx), []);
  assert.doesNotMatch(res.output, /host backup|hetzner/i);
});

test('with Hetzner settings, the second signal depends on the age of the newest server backup', () => {
  const fresh = setup({ settings: HETZNER, hetznerImages: [{ id: 1, status: 'available', created: hoursAgo(40), created_from: { id: 4242, name: 'srv' } }, { id: 2, status: 'available', created: hoursAgo(3) }] });
  const r1 = run(fresh);
  assert.equal(r1.status, 0, r1.output);
  assert.equal(hetznerCalls(fresh).length, 1);
  assert.match(hetznerCalls(fresh)[0], /^http:\/\/127\.0\.0\.1:9\/v1\/images\?type=backup&bound_to=4242$/);
  assert.equal(hostSignals(fresh).length, 1);
  assert.equal(signals(fresh).length, 1);
  assert.match(r1.stderr, /newest provider backup is 3 h old/);

  const stale = setup({ settings: HETZNER, hetznerImages: [{ id: 1, status: 'available', created: hoursAgo(30) }] });
  const r2 = run(stale);
  assert.equal(r2.status, 0, 'a stale server backup never fails the backup itself');
  assert.equal(hostSignals(stale).length, 0);
  assert.equal(signals(stale).length, 1);
  assert.match(r2.stderr, /newest provider backup is 30 h old \(limit 26 h\): no signal sent/);

  const limit = setup({ settings: { ...HETZNER, HETZNER_BACKUP_MAX_AGE_HOURS: '48' }, hetznerImages: [{ id: 1, status: 'available', created: hoursAgo(30) }] });
  assert.equal(run(limit).status, 0);
  assert.equal(hostSignals(limit).length, 1, 'the limit is a setting');

  const none = setup({ settings: HETZNER, hetznerImages: [] });
  assert.equal(run(none).status, 0);
  assert.equal(hostSignals(none).length, 0);

  const refused = setup({ settings: HETZNER, hetznerImages: [] });
  const r3 = run(refused, { FAKE_FAIL_HETZNER: '1' });
  assert.equal(r3.status, 0);
  assert.equal(hostSignals(refused).length, 0);
  assert.equal(signals(refused).length, 1);
  for (const r of [r1, r2, r3]) assertNoSecret(r.output);
});

test('the two signals are independent: a failed night still reports a recent server backup', () => {
  const ctx = setup({ settings: HETZNER, hetznerImages: [{ id: 1, status: 'available', created: hoursAgo(2) }] });
  const res = run(ctx, { FAKE_FAIL_PG_DUMP: '1' });
  assert.notEqual(res.status, 0);
  assert.equal(signals(ctx).length, 0);
  assert.equal(hostSignals(ctx).length, 1);
});

test('no secret reaches the output, a command line or the log of calls', () => {
  const ctx = setup({ settings: HETZNER, hetznerImages: [{ id: 1, status: 'available', created: hoursAgo(1) }] });
  const res = run(ctx);
  assert.equal(res.status, 0, res.output);
  assertNoSecret(res.output);
  // Keys travel in the environment of rclone and URLs and tokens on curl's stdin, never as arguments.
  assertNoSecret(read(join(ctx.dir, 'calls')));
  assert.ok(spy(ctx).some((l) => l.tool === 'rclone' && l.names.includes('RCLONE_CONFIG_TARGET_SECRET_ACCESS_KEY')), 'rclone got the target keys');
});

// --- Fixes after the adversarial review -------------------------------------------------------

const modeOf = (p) => statSync(p).mode & 0o777;

test('the work directory is the script\'s own, and an existing one keeps its mode', () => {
  assert.match(read(join(dirname(SCRIPT), 'kadratis-backup.env.example')), /^BACKUP_WORK_DIR=\/var\/lib\/kadratis-backup$/m);
  assert.match(read(SCRIPT), /BACKUP_WORK_DIR:=\/var\/lib\/kadratis-backup\}/);
  const ctx = setup();
  mkdirSync(ctx.work, { mode: 0o755 });
  chmodSync(ctx.work, 0o755);
  assert.equal(run(ctx).status, 0);
  assert.equal(modeOf(ctx.work), 0o755, 'the script changed the mode of an existing directory');
  const fresh = setup();
  assert.equal(run(fresh).status, 0);
  assert.equal(modeOf(fresh.work), 0o700);
});

test('a work directory other users may write to is refused, untouched', () => {
  for (const mode of [0o770, 0o757, 0o1777]) {
    const ctx = setup();
    mkdirSync(ctx.work);
    chmodSync(ctx.work, mode);
    const res = run(ctx);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /can be written by other users .*chmod 700/);
    assert.equal(statSync(ctx.work).mode & 0o7777, mode);
    assert.deepEqual(readdirSync(ctx.work), []);
    assert.deepEqual(calls(ctx), []);
  }
});

test('symbolic links in or as the work directory are refused before anything runs', () => {
  const cases = [
    ['work directory', (ctx, victim) => symlinkSync(victim, ctx.work)],
    ['files', (ctx, victim) => { mkdirSync(ctx.work, { mode: 0o700 }); symlinkSync(victim, join(ctx.work, 'files')); }],
    ['lock', (ctx, victim) => { mkdirSync(ctx.work, { mode: 0o700 }); symlinkSync(join(victim, 'keep.txt'), join(ctx.work, 'kadratis-backup.lock')); }],
    ['outgoing', (ctx, victim) => { mkdirSync(ctx.work, { mode: 0o700 }); symlinkSync(victim, join(ctx.work, 'outgoing.old')); }],
  ];
  for (const [name, plant] of cases) {
    const ctx = setup();
    const victim = join(ctx.root, 'victim');
    mkdirSync(victim, { mode: 0o755 });
    chmodSync(victim, 0o755);
    writeFileSync(join(victim, 'keep.txt'), 'KEEP');
    plant(ctx, victim);
    const res = run(ctx);
    assert.notEqual(res.status, 0, name);
    assert.match(res.stderr, /is a symbolic link/, name);
    assert.deepEqual(readdirSync(victim), ['keep.txt'], name);
    assert.equal(read(join(victim, 'keep.txt')), 'KEEP', name);
    assert.equal(modeOf(victim), 0o755, name);
    assert.deepEqual(calls(ctx), [], name);
  }
});

test('absurd work directories are refused', () => {
  for (const dir of ['/', 'relative/dir', '/var/lib/with space', '/var/lib/../etc']) {
    const ctx = setup({ settings: { BACKUP_WORK_DIR: `"${dir}"` } });
    const res = run(ctx);
    assert.notEqual(res.status, 0, dir);
    assert.match(res.stderr, /BACKUP_WORK_DIR must be/, dir);
  }
});

test('leftovers of a killed night are removed by the next one', () => {
  const ctx = setup();
  mkdirSync(join(ctx.work, 'outgoing.AbC123'), { recursive: true, mode: 0o700 });
  chmodSync(ctx.work, 0o700);
  writeFileSync(join(ctx.work, 'outgoing.AbC123', 'database.dump.age'), 'FAKE-AGE\nold');
  assert.equal(run(ctx).status, 0);
  assert.deepEqual(readdirSync(ctx.work).filter((f) => f.startsWith('outgoing.')), []);
});

test('Hetzner numbers with a leading zero or other forms are refused, with no signal', () => {
  for (const settings of [{ HETZNER_BACKUP_MAX_AGE_HOURS: '048' }, { HETZNER_BACKUP_MAX_AGE_HOURS: '0' }, { HETZNER_SERVER_ID: '0042' }]) {
    const ctx = setup({ settings: { ...HETZNER, ...settings }, hetznerImages: [{ id: 1, status: 'available', created: hoursAgo(30) }] });
    const res = run(ctx);
    assert.equal(res.status, 0, res.output);
    assert.match(res.stderr, /warning: host backup check skipped/);
    assert.doesNotMatch(res.stderr, /syntax error|value too great/);
    assert.equal(hostSignals(ctx).length, 0, JSON.stringify(settings));
    assert.equal(signals(ctx).length, 1);
  }
});

test('Hetzner images are read as JSON: only available backups count, not labels', () => {
  const creating = setup({ settings: HETZNER, hetznerImages: [{ id: 2, status: 'creating', created: hoursAgo(1) }, { id: 1, status: 'available', created: hoursAgo(30) }] });
  const r1 = run(creating);
  assert.equal(r1.status, 0);
  assert.match(r1.stderr, /30 h old \(limit 26 h\)/);
  assert.equal(hostSignals(creating).length, 0);
  const label = setup({ settings: HETZNER, hetznerImages: [{ id: 1, status: 'available', labels: { created: hoursAgo(1) }, created: hoursAgo(30) }] });
  run(label);
  assert.equal(hostSignals(label).length, 0);
});

test('without jq, the Hetzner check warns and the backup goes on', () => {
  const ctx = setup({ settings: HETZNER, hetznerImages: [{ id: 1, status: 'available', created: hoursAgo(1) }] });
  const bin = join(ctx.root, 'bin-without-jq');
  mkdirSync(bin);
  for (const d of process.env.PATH.split(':')) {
    if (!d || !existsSync(d)) continue;
    for (const name of readdirSync(d)) {
      if (name === 'jq' || existsSync(join(bin, name))) continue;
      try { symlinkSync(join(d, name), join(bin, name)); } catch { /* duplicate name */ }
    }
  }
  const res = run(ctx, { PATH: `${FAKES}:${bin}` });
  assert.equal(res.status, 0, res.output);
  assert.match(res.stderr, /warning: host backup check: jq is not installed/);
  assert.equal(hostSignals(ctx).length, 0);
  assert.equal(signals(ctx).length, 1);
});

test('a configuration file that is a symbolic link is archived with its content', () => {
  const ctx = setup();
  const link = join(ctx.conf, 'live.pem');
  writeFileSync(join(ctx.conf, 'cert-1.pem'), 'CERTIFICATE CONTENT');
  symlinkSync(join(ctx.conf, 'cert-1.pem'), link);
  writeFileSync(ctx.envFile, read(ctx.envFile).replace(/^BACKUP_CONFIG_FILES=.*$/m, `BACKUP_CONFIG_FILES=${link}`));
  assert.equal(run(ctx).status, 0);
  const obj = storedObjects(ctx).find((o) => o.endsWith('config.tar.age'));
  const tarball = Buffer.from(read(join(ctx.s3, obj)).split('\n')[1], 'base64').toString('latin1');
  assert.match(tarball, /CERTIFICATE CONTENT/);
});

test('settings present in the environment reach no child, and each rclone only its own keys', () => {
  const ctx = setup({ settings: HETZNER, hetznerImages: [{ id: 1, status: 'available', created: hoursAgo(1) }] });
  const env = { ...ctx.values, RESTORE_S3_ACCESS_KEY_ID: 'READKEY', RESTORE_S3_SECRET_ACCESS_KEY: 'READSECRET' };
  for (const k of Object.keys(env)) env[k] = String(env[k]).replace(/^"(.*)"$/, '$1');
  const res = run(ctx, env);
  assert.equal(res.status, 0, res.output);
  const lines = spy(ctx);
  for (const tool of ['pg_dump', 'runuser', 'tar', 'age', 'curl']) {
    const seen = lines.filter((l) => l.tool === tool);
    assert.ok(seen.length > 0, `${tool} did not run`);
    for (const l of seen) assert.deepEqual(l.names, [], `${tool} received ${l.names.join(', ')}`);
  }
  const rclone = lines.filter((l) => l.tool === 'rclone');
  const target = calls(ctx).filter((c) => c.startsWith('rclone')).map((c) => c.includes(' target:'));
  assert.equal(rclone.length, target.length);
  rclone.forEach((l, i) => assert.deepEqual(l.names, [target[i] ? 'RCLONE_CONFIG_TARGET_SECRET_ACCESS_KEY' : 'RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY']));
});

test('the service reads no EnvironmentFile and starts after the clock is set', () => {
  const unit = read(join(dirname(SCRIPT), 'kadratis-backup.service'));
  assert.doesNotMatch(unit, /^EnvironmentFile=/m);
  assert.match(unit, /^ExecStart=\/usr\/local\/sbin\/kadratis-backup --env-file \/etc\/kadratis-backup\.env$/m);
  assert.match(unit, /^After=.*\btime-sync\.target\b/m);
  assert.doesNotMatch(read(join(dirname(SCRIPT), 'kadratis-backup.env.example')), /EnvironmentFile=\)/);
});

test('the lock descriptor reaches no child process', () => {
  const ctx = setup({ settings: HETZNER, hetznerImages: [{ id: 1, status: 'available', created: hoursAgo(1) }] });
  assert.equal(run(ctx).status, 0);
  const leaks = spy(ctx).filter((l) => l.fd === 'fd9').map((l) => l.tool);
  assert.deepEqual(leaks, []);
});

test('signal addresses are logged as scheme and host only, whatever their form', () => {
  for (const url of ['https://signal.example.com?token=S3CRETVALUE', 'https://user:S3CRETVALUE@signal.example.com/x', 'https://signal.example.com#S3CRETVALUE', 'https://signal.example.com:8443/S3CRETVALUE?x=1']) {
    const ctx = setup({ settings: { BACKUP_SUCCESS_URL: url } });
    const res = run(ctx);
    assert.equal(res.status, 0, res.output);
    assert.doesNotMatch(res.output, /S3CRETVALUE|user/, url);
    assert.match(res.stderr, /success signal sent to https:\/\/signal\.example\.com(:8443)?\/\.\.\./, url);
  }
});

test('an empty attachments bucket never empties a local copy that holds files', () => {
  const first = setup();
  rmSync(first.source, { recursive: true });
  mkdirSync(first.source);
  const r0 = run(first);
  assert.equal(r0.status, 0, 'a new installation has no attachments yet');
  const ctx = setup();
  assert.equal(run(ctx, { FAKE_NIGHT: '2026-11-14T020000Z' }).status, 0);
  rmSync(ctx.source, { recursive: true });
  mkdirSync(ctx.source);
  const res = run(ctx, { FAKE_NIGHT: '2026-11-15T020000Z' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /attachments bucket files-bucket is empty, but the local copy .* holds 1 files/);
  assert.equal(read(join(ctx.work, 'files', 'tenant-a', 'invoice.pdf')), 'CLEAR ATTACHMENT CONTENT');
  assert.equal(signals(ctx).length, 1, 'only the first night signalled');
  assert.equal(calls(ctx).filter((c) => c.includes(' sync ')).length, 1, 'the second night did not sync');
});

test('the settings model reaches the file storage of the installation example from the host', () => {
  const example = read(join(dirname(SCRIPT), 'kadratis-backup.env.example'));
  assert.match(example, /^ATTACHMENTS_S3_ENDPOINT=http:\/\/172\.17\.0\.1:9000$/m);
});
