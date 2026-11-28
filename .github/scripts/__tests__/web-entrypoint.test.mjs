// Tests of frontend/nginx/docker-entrypoint.sh, the start-up script of the web image: defaults,
// validation of KANAP_WEB_PORT and KANAP_API_UPSTREAM, the listen on [::] and the user line.
// The script runs under sh in a scratch folder: its three paths point there, and `id` and `nginx`
// are stand-ins found first on the PATH (`nginx` records its arguments and returns). The image
// itself is checked by check-web-image.sh.
//
//   node --test .github/scripts/__tests__/web-entrypoint.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENTRYPOINT = readFileSync(join(ROOT, 'frontend/nginx/docker-entrypoint.sh'), 'utf8');
// The template as the image holds it: the Dockerfile replaces the CSP token at build time.
const TEMPLATE = readFileSync(join(ROOT, 'frontend/nginx/default.conf.template'), 'utf8').replaceAll('__KANAP_API_ORIGIN__', '');

function withPaths(script, paths) {
  let result = script;
  for (const [name, value] of Object.entries(paths)) {
    const line = new RegExp(`^${name}=.*$`, 'm');
    assert.ok(line.test(result), `${name}= is set in docker-entrypoint.sh`);
    result = result.replace(line, `${name}='${value}'`);
  }
  return result;
}

function start(t, env, { uid = 101, ipv6 = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'web-entrypoint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'id'), `#!/bin/sh\necho ${uid}\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'nginx'), `#!/bin/sh\nprintf '%s\\n' "$@" >'${join(dir, 'nginx-args')}'\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'template'), TEMPLATE);
  if (ipv6) writeFileSync(join(dir, 'if_inet6'), '');
  const run = join(dir, 'run');
  writeFileSync(join(dir, 'entrypoint.sh'), withPaths(ENTRYPOINT, { conf_dir: run, template: join(dir, 'template'), ipv6_flag: join(dir, 'if_inet6') }));
  const result = spawnSync('sh', [join(dir, 'entrypoint.sh')], {
    env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
  const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  const args = read(join(dir, 'nginx-args'));
  return {
    status: result.status,
    stderr: result.stderr,
    conf: read(join(run, 'default.conf')),
    userConf: read(join(run, 'user.conf')),
    nginxArgs: args === null ? null : args.trimEnd().split('\n'),
  };
}

const lines = (conf, directive) => (conf ?? '').split('\n').filter((line) => new RegExp(`^\\s*${directive} `).test(line)).map((line) => line.trim());

test('starts nginx on port 80 with the API at api:8080 by default', (t) => {
  for (const env of [{}, { KANAP_WEB_PORT: '', KANAP_API_UPSTREAM: '' }]) {
    const outcome = start(t, env);
    assert.equal(outcome.stderr, '');
    assert.equal(outcome.status, 0);
    assert.deepEqual(outcome.nginxArgs, ['-g', 'daemon off;']);
    assert.deepEqual(lines(outcome.conf, 'listen'), ['listen 80;']);
    assert.deepEqual(lines(outcome.conf, 'proxy_pass'), [
      'proxy_pass http://api:8080/;',
      'proxy_pass http://api:8080;',
      'proxy_pass http://api:8080;',
    ]);
  }
});

test('replaces the two tokens as text and changes nothing else', (t) => {
  // No envsubst: the nginx variables and the VITE_* variables of an env_file stay as they are.
  const upstream = 'kadratis-api.kadratis.svc.cluster.local:8080';
  const outcome = start(t, { KANAP_WEB_PORT: '8080', KANAP_API_UPSTREAM: upstream, VITE_API_URL: '/elsewhere', host: 'x' });
  assert.equal(outcome.status, 0);
  assert.equal(outcome.conf, TEMPLATE.replaceAll('__KANAP_WEB_PORT__', '8080').replaceAll('__KANAP_API_UPSTREAM__', upstream));
  assert.ok(outcome.conf.includes('proxy_set_header Host $host;'));
});

test('accepts an IPv4 address, an IPv6 address in brackets, a name without port, and ports 1 to 65535', (t) => {
  for (const upstream of ['10.0.0.12:8080', '[fd00::12]:8080', 'api', 'api_1.internal:65535']) {
    const outcome = start(t, { KANAP_API_UPSTREAM: upstream });
    assert.equal(outcome.status, 0, upstream);
    assert.equal(lines(outcome.conf, 'proxy_pass')[0], `proxy_pass http://${upstream}/;`);
  }
  for (const port of ['1', '8080', '65535']) {
    const outcome = start(t, { KANAP_WEB_PORT: port });
    assert.equal(outcome.status, 0, port);
    assert.deepEqual(lines(outcome.conf, 'listen'), [`listen ${port};`]);
  }
});

test('listens on [::] as well when the system has IPv6', (t) => {
  assert.deepEqual(lines(start(t, { KANAP_WEB_PORT: '8080' }, { ipv6: true }).conf, 'listen'), ['listen 8080;', 'listen [::]:8080;']);
  assert.deepEqual(lines(start(t, {}, { ipv6: true }).conf, 'listen'), ['listen 80;', 'listen [::]:80;']);
  assert.deepEqual(lines(start(t, {}, { ipv6: false }).conf, 'listen'), ['listen 80;']);
});

test('names the nginx user only when the container runs as root', (t) => {
  assert.equal(start(t, {}, { uid: 0 }).userConf, 'user nginx;\n');
  assert.equal(start(t, {}, { uid: 101 }).userConf, '');
  assert.equal(start(t, {}, { uid: 12345 }).userConf, '');
});

test('refuses an invalid port with one line that names the variable', (t) => {
  for (const port of ['abc', '0', '080', '65536', '99999999999999999999', '-1', '80 ', '8080;', '1e3']) {
    const outcome = start(t, { KANAP_WEB_PORT: port });
    assert.deepEqual({ port, status: outcome.status, nginx: outcome.nginxArgs, conf: outcome.conf }, { port, status: 1, nginx: null, conf: null });
    assert.match(outcome.stderr, /KANAP_WEB_PORT/);
    assert.equal(outcome.stderr.trim().split('\n').length, 1, outcome.stderr);
  }
});

test('refuses an invalid API address with a line that names the variable', (t) => {
  for (const upstream of ['api:8080;', 'api 8080', 'api}', 'api{', 'a$b:8080', 'api:8080/x', ':8080', '-api', 'api#', "api'", 'http://api:8080', 'api\n:8080']) {
    const outcome = start(t, { KANAP_API_UPSTREAM: upstream });
    assert.deepEqual({ upstream, status: outcome.status, nginx: outcome.nginxArgs, conf: outcome.conf }, { upstream, status: 1, nginx: null, conf: null });
    assert.match(outcome.stderr, /KANAP_API_UPSTREAM/);
  }
});
