import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  applyTrustProxy,
  clientAddress,
  defaultTrustProxyHops,
  MAX_TRUSTED_PROXY_HOPS,
  resolveTrustProxy,
  trustProxySettingFromEnv,
  trustProxyStartupLine,
} from '../client-address';
import { backendPath } from './backend-root';

// RATE_LIMIT_TRUST_PROXY: true (one proxy), false, or a number of proxies from 1 to 3. Unset or
// empty: one proxy in single-tenant mode, none in multi-tenant mode. Any other value is ignored
// with a warning and the default applies. One function gives the client address to every reader.

function testParsing() {
  const cases: Array<[string | undefined, boolean, number, 'configured' | 'default' | 'invalid']> = [
    ['true', true, 1, 'configured'],
    ['true', false, 1, 'configured'],
    [' TRUE ', false, 1, 'configured'],
    ['false', true, 0, 'configured'],
    ['false', false, 0, 'configured'],
    ['1', false, 1, 'configured'],
    ['2', true, 2, 'configured'],
    ['2', false, 2, 'configured'],
    ['3', false, 3, 'configured'],
    // Words the setting accepted as booleans before keep their meaning.
    ['yes', false, 1, 'configured'],
    ['on', false, 1, 'configured'],
    ['no', true, 0, 'configured'],
    ['off', true, 0, 'configured'],
    ['0', true, 0, 'configured'],
    // Outside the list: the default of the mode.
    ['4', true, 1, 'invalid'],
    ['4', false, 0, 'invalid'],
    ['10', false, 0, 'invalid'],
    ['-1', true, 1, 'invalid'],
    ['1.5', true, 1, 'invalid'],
    ['proxy', true, 1, 'invalid'],
    ['proxy', false, 0, 'invalid'],
    // Unset or empty: the default of the mode.
    ['', true, 1, 'default'],
    ['   ', false, 0, 'default'],
    [undefined, true, 1, 'default'],
    [undefined, false, 0, 'default'],
  ];
  for (const [raw, singleTenant, hops, source] of cases) {
    const setting = resolveTrustProxy(raw, singleTenant);
    const label = `${JSON.stringify(raw)} in ${singleTenant ? 'single' : 'multi'}-tenant mode`;
    assert.equal(setting.hops, hops, `${label}: hops`);
    assert.equal(setting.source, source, `${label}: source`);
    assert.equal(setting.singleTenant, singleTenant);
  }
  assert.equal(MAX_TRUSTED_PROXY_HOPS, 3);
  assert.equal(defaultTrustProxyHops(true), 1);
  assert.equal(defaultTrustProxyHops(false), 0);
  assert.equal(trustProxySettingFromEnv(true, {}).hops, 1);
  assert.equal(trustProxySettingFromEnv(true, { RATE_LIMIT_TRUST_PROXY: 'false' }).hops, 0, 'an explicit false applies');
  assert.equal(trustProxySettingFromEnv(false, { RATE_LIMIT_TRUST_PROXY: 'true' }).hops, 1);
}

function testStartupLine() {
  const configured = trustProxyStartupLine(resolveTrustProxy('2', true));
  assert.equal(configured.level, 'log');
  assert.match(configured.message, /^\[RATE-LIMIT\] /);
  assert.match(configured.message, /X-Forwarded-For behind 2 trusted proxies/);
  assert.match(configured.message, /RATE_LIMIT_TRUST_PROXY=2\)/);

  const none = trustProxyStartupLine(resolveTrustProxy('false', true));
  assert.equal(none.level, 'log');
  assert.match(none.message, /address of the connection, no trusted proxy \(/);

  const singleDefault = trustProxyStartupLine(resolveTrustProxy(undefined, true));
  assert.equal(singleDefault.level, 'warn', 'the single-tenant default is pointed out');
  assert.match(singleDefault.message, /behind 1 trusted proxy /);
  assert.match(singleDefault.message, /RATE_LIMIT_TRUST_PROXY not set, single-tenant default/);

  const multiDefault = trustProxyStartupLine(resolveTrustProxy(undefined, false));
  assert.equal(multiDefault.level, 'log');
  assert.match(multiDefault.message, /no trusted proxy.*not set, multi-tenant default/);

  const invalid = trustProxyStartupLine(resolveTrustProxy('proxy', true));
  assert.equal(invalid.level, 'warn');
  assert.match(invalid.message, /RATE_LIMIT_TRUST_PROXY="proxy" is not true, false or a number from 1 to 3: ignored, single-tenant default applied/);
  assert.equal(invalid.message.split('\n').length, 1, 'one line');
}

function testApply() {
  const calls: Array<[string, unknown]> = [];
  const app = { set: (name: string, value: unknown) => calls.push([name, value]) };
  applyTrustProxy(app, resolveTrustProxy('2', false));
  applyTrustProxy(app, resolveTrustProxy('false', false));
  assert.deepEqual(calls, [['trust proxy', 2], ['trust proxy', false]]);
}

function testClientAddressReadsTheResolvedAddressOnly() {
  // The address Express resolved with the trusted proxy count; headers are not read directly.
  const req = {
    ip: '198.51.100.7',
    headers: { 'cf-connecting-ip': '192.0.2.50', 'x-forwarded-for': '192.0.2.60, 198.51.100.7', 'x-real-ip': '192.0.2.70' },
  };
  assert.equal(clientAddress(req), '198.51.100.7');
  assert.equal(clientAddress({ ip: ' 203.0.113.4 ' }), '203.0.113.4');
  assert.equal(clientAddress({ ip: '' }), null);
  assert.equal(clientAddress({ headers: { 'cf-connecting-ip': '192.0.2.50' } } as any), null);
  assert.equal(clientAddress(undefined), null);
}

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') listSources(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function testSingleReaderAndWiring() {
  // No other backend file reads the client address headers or req.ip itself.
  const headerName = /['"`](x-forwarded-for|x-real-ip|cf-connecting-ip)['"`]/i;
  const ipRead = /\breq(uest)?\??\.ip\b/;
  const readers = listSources(backendPath('src'))
    .filter((file) => !file.endsWith(path.join('common', 'client-address.ts')))
    .filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return headerName.test(source) || ipRead.test(source);
    })
    .map((file) => path.relative(backendPath(), file));
  assert.deepEqual(readers, [], 'client address readers outside common/client-address.ts');

  const publicController = fs.readFileSync(backendPath('src', 'public', 'public.controller.ts'), 'utf8');
  assert.equal((publicController.match(/remoteIp: clientAddress\(req\)/g) ?? []).length, 3, 'the captcha checks use the shared address');

  const guard = fs.readFileSync(backendPath('src', 'common', 'rate-limit.guard.ts'), 'utf8');
  assert.match(guard, /return clientAddress\(req\) \?\? 'unknown'/, 'the rate limits count per shared address');
  // The wiring of http-app.ts is checked by calling it: client-address-wiring.spec.ts.
}

function run() {
  testParsing();
  testStartupLine();
  testApply();
  testClientAddressReadsTheResolvedAddressOnly();
  testSingleReaderAndWiring();
  console.log('client-address.spec: all assertions passed');
}

run();
